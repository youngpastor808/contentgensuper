import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { VertexAI } from '@google-cloud/vertexai';
import * as fs from 'fs';
import * as path from 'path';

if (!admin.apps.length) {
    admin.initializeApp();
}

function resolveFirestoreDatabaseId(): string {
    if (process.env.FIRESTORE_DATABASE_ID) return process.env.FIRESTORE_DATABASE_ID;
    try {
        const configPath = path.resolve(__dirname, '../firebase-applet-config.json');
        if (fs.existsSync(configPath)) {
            const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (raw.firestoreDatabaseId) return raw.firestoreDatabaseId;
        }
    } catch {}
    return '(default)';
}

export const FIRESTORE_DATABASE_ID = resolveFirestoreDatabaseId();
const db = getFirestore(FIRESTORE_DATABASE_ID);

async function deductCreditsHelper(uid: string, amount: number, reason: string, isPersonalKey: boolean = false) {
    if (amount <= 0) return { success: true, spent: 0 };
    
    // BYOK discount logic: personal keys get charged ~10% for using the platform
    const finalAmount = isPersonalKey ? Math.ceil(amount * 0.1) : amount;
    
    const userRef = db.collection('users').doc(uid);
    return db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) {
            throw new HttpsError('not-found', 'User profile does not exist.');
        }
        
        const data = userDoc.data() || {};
        if (data.status !== 'approved' && data.status !== 'active') {
            throw new HttpsError('permission-denied', 'Account is not approved.');
        }
        const currentCredits = typeof data.credits === 'number' ? data.credits : 0;
        
        if (currentCredits < finalAmount) {
            throw new HttpsError('failed-precondition', 'Insufficient credits.');
        }
        
        const newCredits = currentCredits - finalAmount;
        transaction.update(userRef, {
            credits: newCredits,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
            success: true,
            newCredits,
            spent: finalAmount,
            reason
        };
    });
}

export const proxyVertex = onCall({
    cors: true,
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be signed in to use Vertex AI proxy.');
    }

    const userDoc = await db.collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User profile does not exist.');
    }
    const userData = userDoc.data() || {};
    if (userData.status !== 'approved' && userData.status !== 'active') {
        throw new HttpsError('permission-denied', 'Account is not approved.');
    }

    const project = request.data?.project || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
    if (!project) throw new HttpsError('failed-precondition', 'Vertex project not configured on the server.');

    const model = String(request.data?.model || '');
    if (!/^(gemini-|imagen-|veo-|lyria-|learnlm-|models\/|gpt-|claude-|deepseek-|text-|chat-|google\/)/i.test(model)) {
        throw new HttpsError('invalid-argument', 'model not allowed');
    }

    const contents = request.data?.contents;
    if (!Array.isArray(contents) || JSON.stringify(contents).length > 200_000) {
        throw new HttpsError('invalid-argument', 'contents too large');
    }

    const gc = { ...(request.data?.generationConfig || {}) };
    gc.maxOutputTokens = Math.min(Number(gc.maxOutputTokens) || 8192, 32768);
    if (gc.temperature !== undefined) gc.temperature = Math.max(0, Math.min(Number(gc.temperature), 1.5));

    // deduct credits for system-funded ADC call
    const estCredits = /imagen-/.test(model) ? 300 : /veo-/.test(model) ? 2500
        : /^gemini-/.test(model) ? Math.max(1, Math.ceil(JSON.stringify(contents).length / 40)) : 1;
    await deductCreditsHelper(request.auth.uid, estCredits, 'vertex_adc_proxy', false);

    const location = request.data?.location || 'us-central1';

    try {
        const isNoDevInstruction = /transcribe|tts|imagen|image|veo|lyria/i.test(model);
        let finalContents: any = contents;
        if (isNoDevInstruction && request.data?.systemInstruction) {
            const sysText = request.data.systemInstruction;
            if (Array.isArray(finalContents)) {
                if (finalContents.length > 0 && finalContents[0]?.parts && Array.isArray(finalContents[0].parts)) {
                    finalContents = [{ ...finalContents[0], parts: [{ text: sysText }, ...finalContents[0].parts] }, ...finalContents.slice(1)];
                } else {
                    finalContents = [{ role: 'user', parts: [{ text: sysText }] }, ...finalContents];
                }
            } else if (finalContents?.parts && Array.isArray(finalContents.parts)) {
                finalContents = { ...finalContents, parts: [{ text: sysText }, ...finalContents.parts] };
            }
        }

        const isGlobalOnly = (m: string) => /preview|exp/i.test(m);
        const pickLocation = (model: string, configured: string) =>
          isGlobalOnly(model) ? 'global' : (configured || 'us-central1');

        const vertex = new VertexAI({
            project,
            location: pickLocation(model, location)
        });
        const generativeModel = vertex.getGenerativeModel({
            model,
            systemInstruction: (!isNoDevInstruction && request.data?.systemInstruction) ? { role: 'system', parts: [{ text: request.data.systemInstruction }] } : undefined,
            generationConfig: gc
        });
        const response = await generativeModel.generateContent({ contents: finalContents });
        return response.response;
    } catch (err: any) {
        console.error('[Vertex ADC Proxy Error]', err);
        throw new HttpsError('internal', err.message || 'Vertex AI ADC generation failed');
    }
});

export const testVertex = onCall({
    cors: true,
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be signed in to test Vertex AI.');
    }

    const startTime = Date.now();
    const { authMode, apiKey, project: inputProject, location: inputLocation, model: inputModel } = request.data || {};
    const location = (inputLocation || 'us-central1').trim();
    if (!/^[a-z0-9-]+$/.test(location)) {
        throw new HttpsError('invalid-argument', 'Invalid GCP location region format.');
    }
    const model = inputModel || 'gemini-3.8-flash';
    const isGlobalOnly = (m: string) => /preview|exp/i.test(m);
    const pickLocation = (m: string, configured: string) =>
      isGlobalOnly(m) ? 'global' : (configured || 'us-central1');

    const targetLocation = pickLocation(model, location);
    const host = targetLocation === 'global'
      ? 'aiplatform.googleapis.com'
      : `${targetLocation}-aiplatform.googleapis.com`;

    if (authMode === 'apiKey') {
        const trimmedKey = (apiKey || '').trim();
        const project = (inputProject || '').trim();

        if (!trimmedKey) {
            return { valid: false, error: 'Vertex API key is required for API Key authentication mode.', code: 'MISSING_API_KEY' };
        }
        if (!project) {
            return { valid: false, error: 'GCP Project ID is required when connecting to Vertex AI with an API key.', code: 'MISSING_PROJECT_ID' };
        }

        const endpoint = `https://${host}/v1beta1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(targetLocation)}/publishers/google/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
        
        try {
            const probeRes = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: 'Respond with OK.' }] }],
                    generationConfig: { maxOutputTokens: 5 }
                })
            });
            const latencyMs = Date.now() - startTime;
            if (probeRes.ok) {
                return {
                    valid: true,
                    message: `Connected successfully to Vertex AI in project "${project}" (${targetLocation})`,
                    latencyMs,
                    project,
                    location: targetLocation
                };
            }
            const errData = await probeRes.json().catch(() => ({}));
            const errObj = errData?.error || {};
            const rawMessage = errObj.message || probeRes.statusText || 'Vertex AI API request failed';
            return {
                valid: false,
                error: rawMessage,
                code: errObj.status || `HTTP_${probeRes.status}`,
                latencyMs
            };
        } catch (e: any) {
            return { valid: false, error: e.message, latencyMs: Date.now() - startTime };
        }
    } else {
        const project = (inputProject || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim();
        if (!project) {
            return { valid: false, error: 'GCP Project ID is required.', code: 'MISSING_PROJECT_ID' };
        }
        try {
            const vertex = new VertexAI({ project, location: targetLocation });
            const generativeModel = vertex.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 5 } });
            await generativeModel.generateContent({ contents: [{ role: 'user', parts: [{ text: 'Respond with OK.' }] }] });
            return {
                valid: true,
                message: `Connected successfully to Vertex AI via ADC in project "${project}" (${targetLocation})`,
                latencyMs: Date.now() - startTime,
                project,
                location: targetLocation
            };
        } catch (e: any) {
            return { valid: false, error: e.message, latencyMs: Date.now() - startTime };
        }
    }
});

export const deleteUserByAdmin = onCall(async (request) => {
    // 1. Ensure the caller is signed in
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    // 2. Enforce admin or owner authorization
    const ownerEmail = "bwaimatwaima@gmail.com";
    const callerEmail = (request.auth.token.email || "").toLowerCase().trim();
    let isAuthorized = callerEmail === ownerEmail;
    if (!isAuthorized && request.auth.uid) {
        try {
            const callerDoc = await db.collection('users').doc(request.auth.uid).get();
            if (callerDoc.exists) {
                const role = callerDoc.data()?.role;
                if (role === 'admin' || role === 'owner') {
                    isAuthorized = true;
                }
            }
        } catch (authErr) {
            console.warn("Could not verify caller role:", authErr);
        }
    }
    if (!isAuthorized) {
        throw new HttpsError("permission-denied", "Unauthorized. Only administrators can delete accounts.");
    }

    const targetUid = request.data?.uid;
    const providedEmail = typeof request.data?.email === 'string' ? request.data.email.toLowerCase().trim() : '';

    if (!targetUid && !providedEmail) {
        throw new HttpsError("invalid-argument", "You must provide a target user UID or email.");
    }

    try {
        let authUserEmail = providedEmail;

        // 1. Delete the user from Firebase Authentication if UID exists
        let deletedFromAuth = false;
        if (targetUid) {
            try {
                const authUser = await admin.auth().getUser(targetUid).catch(() => null);
                if (authUser?.email) {
                    authUserEmail = authUser.email.toLowerCase().trim();
                }
                await admin.auth().deleteUser(targetUid);
                deletedFromAuth = true;
                console.log(`[Admin Auth Delete] Successfully deleted Auth UID: ${targetUid}`);
            } catch (authErr: any) {
                if (authErr.code !== 'auth/user-not-found') {
                    console.warn(`[Admin Auth Delete] Could not delete auth user ${targetUid}:`, authErr);
                }
            }
        }

        // Also look up and delete from Firebase Auth by email if UID was not an Auth UID or deletion did not happen yet
        if (authUserEmail && !deletedFromAuth) {
            try {
                const authUserByEmail = await admin.auth().getUserByEmail(authUserEmail).catch(() => null);
                if (authUserByEmail) {
                    await admin.auth().deleteUser(authUserByEmail.uid);
                    deletedFromAuth = true;
                    console.log(`[Admin Auth Delete] Successfully deleted Auth UID by email (${authUserEmail}): ${authUserByEmail.uid}`);
                }
            } catch (authEmailErr: any) {
                if (authEmailErr.code !== 'auth/user-not-found') {
                    console.warn(`[Admin Auth Delete] Could not delete auth user by email ${authUserEmail}:`, authEmailErr);
                }
            }
        }

        // 2. Perform cascading deletion across Firestore documents atomically
        const batch = db.batch();

        if (targetUid) {
            const userDocRef = db.collection('users').doc(targetUid);
            batch.delete(userDocRef);
        }

        if (authUserEmail) {
            const approvedDocRef = db.collection('approvedEmails').doc(authUserEmail);
            batch.delete(approvedDocRef);

            // Record in deletedUsers collection so auto-sync never resurrects them
            const deletedUserRef = db.collection('deletedUsers').doc(authUserEmail);
            batch.set(deletedUserRef, {
                email: authUserEmail,
                deletedAt: admin.firestore.FieldValue.serverTimestamp(),
                deletedBy: callerEmail
            });

            // Find and delete any secondary/duplicate documents by email
            const querySnap = await db.collection('users').where('email', '==', authUserEmail).get();
            querySnap.forEach((docSnap) => {
                batch.delete(docSnap.ref);
            });
        }

        await batch.commit();

        return {
            success: true,
            deletedFromAuth,
            message: `Successfully deleted user account and all associated Firestore records for UID "${targetUid || 'N/A'}" (${authUserEmail || 'no email'}).`
        };
    } catch (error: any) {
        console.error("Error in cascading admin user delete:", error);
        throw new HttpsError("internal", error.message || "Failed to completely delete user.");
    }
});

export const syncAuthUsersToFirestore = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be signed in.");
    }

    const ownerEmail = "bwaimatwaima@gmail.com";
    const callerEmail = (request.auth.token.email || "").toLowerCase().trim();
    let isAuthorized = callerEmail === ownerEmail;
    if (!isAuthorized && request.auth.uid) {
        try {
            const callerDoc = await db.collection('users').doc(request.auth.uid).get();
            if (callerDoc.exists) {
                const role = callerDoc.data()?.role;
                if (role === 'admin' || role === 'owner') {
                    isAuthorized = true;
                }
            }
        } catch (authErr) {
            console.warn("Could not verify caller role:", authErr);
        }
    }
    if (!isAuthorized) {
        throw new HttpsError("permission-denied", "Unauthorized. Only administrators can sync auth accounts.");
    }

    try {
        const deletedUsersSnap = await db.collection('deletedUsers').get();
        const deletedEmails = new Set<string>();
        deletedUsersSnap.forEach(d => {
            deletedEmails.add(d.id.toLowerCase().trim());
            const data = d.data();
            if (data.email) deletedEmails.add(data.email.toLowerCase().trim());
        });

        let syncedCount = 0;
        let totalUsers = 0;
        let pageToken: string | undefined = undefined;

        do {
            const listResult = await admin.auth().listUsers(1000, pageToken);
            totalUsers += listResult.users.length;
            pageToken = listResult.pageToken;

            for (const userRecord of listResult.users) {
                const email = (userRecord.email || "").toLowerCase().trim();
                if (!email || deletedEmails.has(email)) {
                    continue;
                }

                const userDocRef = db.collection('users').doc(userRecord.uid);
                const userSnap = await userDocRef.get();

                if (!userSnap.exists) {
                    const querySnap = await db.collection('users').where('email', '==', email).limit(50).get();
                    let existingData: any = null;
                    const oldDocRefs: admin.firestore.DocumentReference[] = [];

                    querySnap.forEach(d => {
                        if (d.id !== userRecord.uid) {
                            if (!existingData) existingData = d.data();
                            oldDocRefs.push(d.ref);
                        }
                    });

                    const isSuperAdmin = email === "bwaimatwaima@gmail.com" || email === "bwaima100@gmail.com";
                    const newDocData: any = {
                        email,
                        displayName: userRecord.displayName || existingData?.displayName || email.split('@')[0],
                        role: isSuperAdmin ? 'admin' : (existingData?.role || 'user'),
                        status: isSuperAdmin ? 'approved' : (existingData?.status || 'pending'),
                        credits: (typeof existingData?.credits === 'number') ? existingData.credits : 10000,
                        createdAt: existingData?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    if (existingData?.assignedBy) newDocData.assignedBy = existingData.assignedBy;
                    if (existingData?.maxApprovedUsers) newDocData.maxApprovedUsers = existingData.maxApprovedUsers;

                    await userDocRef.set(newDocData);
                    syncedCount++;

                    if (oldDocRefs.length > 0) {
                        const batch = db.batch();
                        let count = 0;
                        for (const oldRef of oldDocRefs) {
                            batch.delete(oldRef);
                            count++;
                            if (count >= 499) break; // keep safely below 500
                        }
                        if (count > 0) await batch.commit().catch(() => {});
                    }
                }
            }
        } while (pageToken);

        return {
            success: true,
            syncedCount,
            totalAuthUsers: totalUsers,
            message: `Successfully synchronized ${syncedCount} missing account(s) from Firebase Auth (${totalUsers} total registered auth users).`
        };
    } catch (error: any) {
        console.error("Error in syncAuthUsersToFirestore:", error);
        throw new HttpsError("internal", error.message || "Failed to sync auth users.");
    }
});

export const onUserCreated = onDocumentCreated(
    { document: 'users/{userId}', database: FIRESTORE_DATABASE_ID },
    async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    if (!data) return;

    const emailLower = (data.email || '').trim().toLowerCase();
    if (!emailLower) return;

    try {
        // 1. Check if user was deleted/banned to prevent unauthorized re-registration
        // MUST run BEFORE checking data.status !== 'pending'
        const delSnap = await db.collection('deletedUsers').doc(emailLower).get();
        if (delSnap.exists) {
            await snap.ref.update({
                status: 'rejected',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[Cloud Function] Rejected user ${event.params.userId} (${emailLower}) because email is in deletedUsers.`);
            return;
        }

        // Only process accounts that were initialized as pending for pre-provisioning / auto-approval
        if (data.status !== 'pending') return;

        // 2. Check for pre-approved markers or pre-created user records
        let preApprovedData: any = null;
        const markerSnap = await db.collection('approvedEmails').doc(emailLower).get();
        if (markerSnap.exists) {
            preApprovedData = markerSnap.data();
            await markerSnap.ref.delete().catch(() => {});
        }

        // Check if there was another user doc created by admin for this email
        const userQuerySnap = await db.collection('users').where('email', '==', emailLower).get();
        const otherDocs = userQuerySnap.docs.filter(d => d.id !== event.params.userId);
        if (otherDocs.length > 0) {
            // Sort deterministically: prefer reseller role or document with highest credits
            const sortedDocs = [...otherDocs].sort((a, b) => {
                const aData = a.data();
                const bData = b.data();
                if (aData.role === 'reseller' && bData.role !== 'reseller') return -1;
                if (bData.role === 'reseller' && aData.role !== 'reseller') return 1;
                return (bData.credits || 0) - (aData.credits || 0);
            });
            const preCreatedDoc = sortedDocs[0].data();
            if (!preApprovedData) preApprovedData = preCreatedDoc;
            for (const d of otherDocs) {
                await d.ref.delete().catch(() => {});
            }
        }

        if (preApprovedData) {
            const allowedRoles = ['user', 'reseller'];
            const updates: any = {
                status: preApprovedData.status || 'approved',
                role: allowedRoles.includes(preApprovedData.role) ? preApprovedData.role : 'user',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (preApprovedData.displayName) {
                updates.displayName = preApprovedData.displayName;
            }
            if (typeof preApprovedData.credits === 'number') {
                updates.credits = Math.min(preApprovedData.credits, 50000);
            }
            if (preApprovedData.assignedBy) {
                updates.assignedBy = preApprovedData.assignedBy;
            }
            if (typeof preApprovedData.maxApprovedUsers === 'number') {
                updates.maxApprovedUsers = Math.min(preApprovedData.maxApprovedUsers, 50);
            }
            await snap.ref.update(updates);
            console.log(`[Cloud Function] Auto-approved pre-provisioned user ${event.params.userId} (${emailLower}).`);
            return;
        }

        // 3. Fallback to public_config check
        const pubCfgSnap = await db.collection('settings').doc('public_config').get();
        const requireApproval = pubCfgSnap.exists && pubCfgSnap.data()?.requireAdminApproval === true;

        // If admin approval is NOT required, server-side auto-approve using Admin SDK
        if (!requireApproval) {
            await snap.ref.update({
                status: 'approved',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`[Cloud Function] Auto-approved user ${event.params.userId} because requireAdminApproval is false.`);
        }
    } catch (err) {
        console.error('Failed in onUserCreated auto-approval trigger:', err);
    }
});

/**
 * HTTPS Callable Function (v2) to securely assign any valid role to a user.
 * Supports 'user', 'reseller', 'admin', and 'owner'.
 * - Updates Auth Custom Claims (request.auth.token.role) for instant, zero-read security rules
 * - Mirrors role in the target Firestore database (/users/{uid}) for UI querying and live dashboards
 * - Enforces privilege boundaries:
 *   - Super admins ("bwaimatwaima@gmail.com", "bwaima100@gmail.com") and Owners can assign any role.
 *   - Administrators can assign 'user' or 'reseller' (only owners/super-admins can assign 'admin' or 'owner').
 */
const VALID_ROLES = ["user", "reseller", "admin", "owner"];

export const setUserRole = onCall(async (request) => {
    // 1. Authentication check
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be authenticated.");
    }

    const callerEmail = request.auth.token.email ? request.auth.token.email.toLowerCase().trim() : "";
    const allowedSuperAdmins = ["bwaimatwaima@gmail.com", "bwaima100@gmail.com"];
    const isSuperAdmin = allowedSuperAdmins.includes(callerEmail);

    // Determine caller role from token claim or Firestore
    let callerRole = request.auth.token.role || "";
    const targetDb = getFirestore(FIRESTORE_DATABASE_ID || "ai-studio-contentgenaiprov-16f9e192-3344-47c8-bcaf-5b43f11d9024");

    if (!callerRole && !isSuperAdmin && request.auth.uid) {
        try {
            const callerDoc = await targetDb.collection("users").doc(request.auth.uid).get();
            if (callerDoc.exists) {
                callerRole = callerDoc.data()?.role || "";
            }
        } catch (readErr) {
            console.warn("Could not read caller doc in setUserRole:", readErr);
        }
    }

    const isOwner = isSuperAdmin || callerRole === "owner";
    const isAdmin = isOwner || callerRole === "admin";

    if (!isAdmin) {
        throw new HttpsError("permission-denied", "Unauthorized. Only administrators and workspace owners can update roles.");
    }

    const targetEmail = request.data?.email ? String(request.data.email).toLowerCase().trim() : "";
    const newRole = request.data?.role ? String(request.data.role).toLowerCase().trim() : "";

    if (!targetEmail || !newRole) {
        throw new HttpsError("invalid-argument", "Email and role are required.");
    }

    if (!VALID_ROLES.includes(newRole)) {
        throw new HttpsError("invalid-argument", `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    // Only owners/super-admins can assign 'owner' or 'admin' roles
    if ((newRole === "owner" || newRole === "admin") && !isOwner) {
        throw new HttpsError("permission-denied", "Only Workspace Owners can promote users to Admin or Owner.");
    }

    try {
        // Find the user in Firebase Auth
        const userRecord = await admin.auth().getUserByEmail(targetEmail);
        const uid = userRecord.uid;

        // 1. Update Custom Claims on Auth Token
        const existingClaims = userRecord.customClaims || {};
        await admin.auth().setCustomUserClaims(uid, {
            ...existingClaims,
            role: newRole,
        });

        // 2. Mirror in target Firestore database (/users/{uid})
        const updatePayload: Record<string, any> = {
            role: newRole,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (newRole === "owner" || newRole === "admin") {
            updatePayload.status = "approved";
        }
        await targetDb.collection("users").doc(uid).set(updatePayload, { merge: true });

        console.log(`[setUserRole] Successfully assigned role "${newRole}" to ${targetEmail} (UID: ${uid}) by ${callerEmail}`);
        return { success: true, message: `Successfully updated ${targetEmail} to ${newRole}.` };
    } catch (error: any) {
        console.error("Error in setUserRole:", error);
        throw new HttpsError("internal", error.message || "Failed to update role.");
    }
});

/**
 * Backward-compatible alias for assignOwnerRole, delegating to the server-side role assignment pipeline.
 */
export const assignOwnerRole = onCall(async (request) => {
    request.data = { ...(request.data || {}), role: "owner" };
    return (setUserRole as any)(request);
});

