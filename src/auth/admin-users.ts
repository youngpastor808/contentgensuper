import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    getDocs,
    where,
    deleteDoc,
    addDoc,
    writeBatch,
    serverTimestamp
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import * as dom from '../dom';
import * as ui from '../ui';
import {
    currentUser,
    userRecord,
    isUserOwner,
    isUserAdmin,
    isUserReseller,
    isOwnerEmail,
    OWNER_EMAILS,
    showAdminAddUserMsg,
    clearAdminAddUserMsg,
    adminUsersUnsubscribe,
    setAdminUsersUnsubscribe,
    isUrlOrLink
} from './session';
import { recordDeletedUserEmail, normalizeEmail, getDocPermissionScore, executeDeduplication } from './dedup';
import { updateAuthUI } from './profile-ui';

export async function approveUserWithResellerCheck(userId: string, approvedByMe: number, maxQuota: number, isReseller: boolean, isAdmin: boolean) {
    if (isReseller && !isAdmin) {
        if (approvedByMe >= maxQuota) {
            ui.showStatus(`Quota Reached: You have already approved your maximum limit of ${maxQuota} members. Contact administrator for an increase.`, true, 5000);
            return;
        }
    }

    try {
        const userRef = doc(db, 'users', userId);
        const updatePayload: any = {
            status: 'approved',
            updatedAt: serverTimestamp()
        };
        if (isReseller) {
            updatePayload.approvedBy = currentUser?.email || currentUser?.uid;
        }
        await updateDoc(userRef, updatePayload);
        ui.showStatus('User successfully approved!', false, 3000);
    } catch (e: any) {
        console.error('Failed to approve user:', e);
        ui.showStatus('Error approving user: ' + (e?.message || e), true, 4000);
    }
}

export async function handleAdminAddUser() {
    if (!dom.adminAddUserEmailInput) return;
    const emailRaw = dom.adminAddUserEmailInput.value.trim().toLowerCase();
    let displayName = dom.adminAddUserNameInput?.value.trim() || emailRaw.split('@')[0];
    if (isUrlOrLink(displayName)) {
        displayName = emailRaw.split('@')[0];
    }
    const role = dom.adminAddUserRoleSelect?.value || 'user';
    const status = dom.adminAddUserStatusSelect?.value || 'approved';
    const credits = parseInt(dom.adminAddUserCreditsInput?.value || '10000', 10);
    const maxApprovedUsers = parseInt(dom.adminAddUserQuotaInput?.value || '10', 10);

    if (!emailRaw) {
        showAdminAddUserMsg("Please enter an email address.", "error");
        return;
    }

    const email = normalizeEmail(emailRaw);

    const isAdmin = isUserAdmin(currentUser, userRecord);
    const isReseller = !isAdmin && isUserReseller(userRecord);

    if (!isAdmin && !isReseller) {
        showAdminAddUserMsg("Unauthorized: Only administrators and authorized resellers can add or manage users.", "error");
        return;
    }

    // Force role to 'user' if non-admin reseller
    const finalRole = isAdmin ? role : 'user';

    try {
        if (dom.adminAddUserBtn) {
            dom.adminAddUserBtn.disabled = true;
            dom.adminAddUserBtn.innerHTML = '<span class="inline-block animate-spin mr-1">⏳</span> Provisioning...';
        }

        // Check if an existing profile exists with this email (or normalized email)
        const q = query(collection(db, 'users'), where('email', '==', email));
        const snap = await getDocs(q);

        if (!snap.empty) {
            const rawDocs: Array<{ id: string; data: any; ref: any }> = [];
            snap.forEach(d => rawDocs.push({ id: d.id, data: d.data(), ref: d.ref }));

            // Sort by permission and authority score: Highest permission document wins
            rawDocs.sort((a, b) => {
                const scoreA = getDocPermissionScore(a.id, a.data, email);
                const scoreB = getDocPermissionScore(b.id, b.data, email);
                return scoreB - scoreA;
            });

            const primaryDoc = rawDocs[0];
            const lowerPermissionDups = rawDocs.slice(1);

            const existing = primaryDoc.data;
            const updatePayload: any = {
                displayName: displayName || existing.displayName,
                role: finalRole,
                status: status,
                credits: !isNaN(credits) ? credits : (existing.credits || 10000),
                updatedAt: serverTimestamp()
            };
            if (finalRole === 'reseller' && !isNaN(maxApprovedUsers)) {
                updatePayload.maxApprovedUsers = maxApprovedUsers;
            }
            if (isReseller) {
                updatePayload.assignedBy = currentUser?.email || currentUser?.uid;
            }
            await setDoc(primaryDoc.ref, updatePayload, { merge: true });

            // Sync approvedEmails marker for pre-provisioned status
            try {
                await setDoc(doc(db, 'approvedEmails', email), {
                    role: finalRole,
                    status: status,
                    credits: updatePayload.credits,
                    assignedBy: isReseller ? (currentUser?.email || currentUser?.uid) : null,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (appErr) {
                console.debug("approvedEmails sync note:", appErr);
            }

            // Delete lower-permission duplicate documents for this email in Firebase
            for (const dup of lowerPermissionDups) {
                await deleteDoc(dup.ref).catch(err => console.warn(`Could not delete duplicate doc ${dup.id}:`, err));
            }

            showAdminAddUserMsg(`Updated profile for ${email} (${finalRole}, ${status}, ${credits.toLocaleString()} credits)${lowerPermissionDups.length > 0 ? ` and cleaned up ${lowerPermissionDups.length} duplicate document(s)` : ''}.`, "success");
        } else {
            const newUserData: any = {
                email: email,
                displayName: displayName || email.split('@')[0],
                role: finalRole,
                status: status,
                credits: !isNaN(credits) ? credits : 10000,
                renderMinutesQuota: 10,
                renderMinutesUsed: 0,
                allowImageGeneration: isAdmin,
                allowAudioGeneration: isAdmin,
                allowVideoGeneration: isAdmin,
                allowCookieAuth: isAdmin,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            if (finalRole === 'reseller') {
                newUserData.maxApprovedUsers = !isNaN(maxApprovedUsers) ? maxApprovedUsers : 10;
            }
            if (isReseller) {
                newUserData.assignedBy = currentUser?.email || currentUser?.uid;
                newUserData.approvedBy = currentUser?.email || currentUser?.uid;
            }
            await addDoc(collection(db, 'users'), newUserData);

            // Sync approvedEmails marker for pre-provisioned status
            try {
                await setDoc(doc(db, 'approvedEmails', email), {
                    role: finalRole,
                    status: status,
                    credits: newUserData.credits,
                    assignedBy: isReseller ? (currentUser?.email || currentUser?.uid) : null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (appErr) {
                console.debug("approvedEmails sync note:", appErr);
            }

            showAdminAddUserMsg(`Successfully provisioned new ${finalRole} profile for ${email}!`, "success");
        }

        // Clear form inputs
        if (dom.adminAddUserEmailInput) dom.adminAddUserEmailInput.value = '';
        if (dom.adminAddUserNameInput) dom.adminAddUserNameInput.value = '';
        if (dom.adminAddUserRoleSelect) dom.adminAddUserRoleSelect.value = 'user';
        if (dom.adminAddUserStatusSelect) dom.adminAddUserStatusSelect.value = 'approved';
        if (dom.adminAddUserCreditsInput) dom.adminAddUserCreditsInput.value = '10000';
        if (dom.adminAddUserQuotaGroup) dom.adminAddUserQuotaGroup.classList.add('hidden');
    } catch (e: any) {
        console.error("Failed to add user:", e);
        showAdminAddUserMsg(e.message || "Failed to add or update user profile.", "error");
    } finally {
        if (dom.adminAddUserBtn) {
            dom.adminAddUserBtn.disabled = false;
            dom.adminAddUserBtn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg> <span>Create / Pre-Approve User</span>';
        }
    }
}

export async function deleteUserRecord(userId: string, userEmail: string) {
    if (!userId) return;
    const cleanEmail = (userEmail || '').toLowerCase().trim();

    if (isOwnerEmail(cleanEmail) || (currentUser && userId === currentUser.uid)) {
        ui.showStatus("Error: Workspace Owner accounts cannot be deleted.", true, 5000);
        showAdminAddUserMsg("Error: Workspace Owner accounts cannot be deleted.", "error", 6000);
        return;
    }

    try {
        // Double-check Firestore document role before proceeding with deletion
        const userDocRef = doc(db, 'users', userId);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            if (data?.role === 'owner') {
                ui.showStatus("Error: The Workspace Owner account cannot be deleted.", true, 5000);
                showAdminAddUserMsg("Error: The Workspace Owner account cannot be deleted. You must transfer ownership first.", "error", 6000);
                return;
            }
        }

        ui.showStatus(`Deleting account ${cleanEmail || userId}...`, false);

        // 1. First record email in local and Firestore deleted list to prevent recreation
        recordDeletedUserEmail(cleanEmail);
        if (cleanEmail) {
            try {
                await setDoc(doc(db, 'deletedUsers', cleanEmail), {
                    email: cleanEmail,
                    deletedAt: serverTimestamp(),
                    deletedBy: currentUser?.email || currentUser?.uid
                }, { merge: true });
            } catch (delRecErr) {
                console.warn("Could not record deleted user in Firestore deletedUsers collection:", delRecErr);
            }
        }

        // 2. Clean up Firestore documents directly (primary UID doc and any orphaned duplicates)
        await deleteDoc(doc(db, 'users', userId));

        if (cleanEmail) {
            try {
                const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
                const snap = await getDocs(q);
                for (const d of snap.docs) {
                    if (d.id !== userId) {
                        await deleteDoc(d.ref).catch(() => {});
                    }
                }
            } catch (dupCleanErr) {
                console.warn("Could not clean duplicate email docs during delete:", dupCleanErr);
            }
        }

        ui.showStatus(`Successfully deleted user ${cleanEmail || userId}.`, false, 4000);
        showAdminAddUserMsg(`✓ Deleted user profile for ${cleanEmail || userId}.`, "success", 4000);
    } catch (e: any) {
        console.error('Failed to delete user:', e);
        ui.showStatus('Error deleting user: ' + (e?.message || e), true, 4000);
        showAdminAddUserMsg('Error deleting user: ' + (e?.message || e), "error", 6000);
    }
}

export function closeAdminPanel() {
    if (adminUsersUnsubscribe) {
        adminUsersUnsubscribe();
        setAdminUsersUnsubscribe(null);
    }
    clearAdminAddUserMsg();
    if (dom.adminPanel) dom.adminPanel.classList.add('hidden');
}

export async function updateUserStatus(userId: string, status: string) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        const existingData = userSnap.exists() ? userSnap.data() : null;

        if (existingData?.role === 'owner' && status !== 'approved') {
            ui.showStatus("Error: The Workspace Owner account cannot be disabled, rejected, or banned.", true, 5000);
            return;
        }

        await updateDoc(userRef, {
            status,
            updatedAt: serverTimestamp()
        });

        // Also sync any other duplicate document entries with the exact same email
        const userEmail = (existingData?.email || '').trim().toLowerCase();
        if (userEmail) {
            try {
                const q = query(collection(db, 'users'), where('email', '==', userEmail));
                const snap = await getDocs(q);
                for (const d of snap.docs) {
                    if (d.id !== userId && d.data().status !== status) {
                        await updateDoc(d.ref, {
                            status,
                            updatedAt: serverTimestamp()
                        }).catch(() => {});
                    }
                }
            } catch (dupErr) {
                console.warn("Error updating duplicates during status change:", dupErr);
            }
        }

        ui.showStatus(`✓ Saved: User status updated to "${status}" (saved automatically)`, false, 3000);
    } catch (e: any) {
        console.error("Failed to update status:", e);
        ui.showStatus("Failed to update user status: " + (e?.message || e), true, 4000);
    }
}

export async function setUserRoleCloud(targetEmail: string, role: string): Promise<{ success: boolean; message: string }> {
    const cleanEmail = (targetEmail || '').toLowerCase().trim();
    if (!cleanEmail || !role) {
        throw new Error("Target email and role are required.");
    }
    const callSetRole = httpsCallable<{ email: string; role: string }, { success: boolean; message: string }>(functions, "setUserRole");
    const result = await callSetRole({ email: cleanEmail, role: role.toLowerCase().trim() });
    return result.data;
}

export async function updateUserRole(userId: string, role: string) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        const existingData = userSnap.exists() ? userSnap.data() : null;

        if (existingData?.role === 'owner') {
            ui.showStatus("Error: The Workspace Owner's role cannot be modified directly. Please use 'Transfer Ownership' instead.", true, 5000);
            return;
        }

        if (role === 'owner') {
            ui.showStatus("To assign the Workspace Owner role, please use the 'Transfer Ownership' button.", true, 5000);
            return;
        }

        const userEmail = (existingData?.email || '').trim().toLowerCase();

        // 1. Invoke server-side setUserRole Cloud Function to set Auth Custom Claims & mirror Firestore
        if (userEmail) {
            try {
                const cloudRes = await setUserRoleCloud(userEmail, role);
                console.log("[updateUserRole] Server-side claim update succeeded:", cloudRes.message);
            } catch (cloudErr: any) {
                // If Cloud Function runs in environment without custom claims access, fallback to Firestore direct update
                console.warn("[updateUserRole] Cloud Function setUserRole notice (proceeding with direct DB sync):", cloudErr?.message || cloudErr);
            }
        }

        const updateData: any = {
            role,
            updatedAt: serverTimestamp()
        };
        if (role === 'reseller') {
            updateData.maxApprovedUsers = 10; // Default reseller quota
        }
        await updateDoc(userRef, updateData);

        // Also sync any other duplicate document entries with the exact same email
        if (userEmail) {
            try {
                const q = query(collection(db, 'users'), where('email', '==', userEmail));
                const snap = await getDocs(q);
                for (const d of snap.docs) {
                    if (d.id !== userId && d.data().role !== role) {
                        await updateDoc(d.ref, updateData).catch(() => {});
                    }
                }
            } catch (dupErr) {
                console.warn("Error updating duplicates during role change:", dupErr);
            }
        }

        ui.showStatus(`✓ Saved: User role updated to "${role}" (saved automatically)`, false, 3000);
    } catch (e: any) {
        console.error("Failed to update role:", e);
        ui.showStatus("Failed to update user role: " + (e?.message || e), true, 4000);
    }
}

/**
 * Securely calls the backend Cloud Function `setUserRole` to promote a user to owner,
 * assigning custom Auth token claims and updating Firestore in the secured server-side environment.
 */
export async function promoteUserToOwner(targetEmail: string): Promise<{ success: boolean; message: string }> {
    return setUserRoleCloud(targetEmail, "owner");
}

/**
 * Transfers Workspace Ownership from the current owner to another user.
 * Atomic update: promotes target user to 'owner' and transitions current owner to 'admin'.
 */
export async function transferOwnership(targetUserId: string, targetUserEmail: string, targetDisplayName?: string) {
    if (!targetUserId) return;
    if (!currentUser?.uid) {
        ui.showStatus("Authentication required to transfer ownership.", true, 4000);
        return;
    }

    if (!isUserOwner(currentUser, userRecord)) {
        ui.showStatus("Unauthorized: Only the current Workspace Owner can transfer ownership.", true, 5000);
        showAdminAddUserMsg("Unauthorized: Only the current Workspace Owner can transfer ownership.", "error", 5000);
        return;
    }

    const cleanTargetEmail = (targetUserEmail || '').toLowerCase().trim();
    const cleanCurrentEmail = (currentUser.email || userRecord?.email || '').toLowerCase().trim();

    if (targetUserId === currentUser.uid || (cleanTargetEmail && cleanTargetEmail === cleanCurrentEmail)) {
        ui.showStatus("You are already the Workspace Owner.", true, 4000);
        return;
    }

    try {
        ui.showStatus(`Transferring Workspace Ownership to ${cleanTargetEmail || targetUserId}...`, false);

        // 1. Assign server-side custom claims and owner role via Cloud Function
        if (cleanTargetEmail) {
            try {
                const cloudResult = await promoteUserToOwner(cleanTargetEmail);
                console.log("[TransferOwnership] Server-side promotion succeeded:", cloudResult.message);
            } catch (cloudFnErr: any) {
                console.warn("[TransferOwnership] Cloud Function assignOwnerRole notice:", cloudFnErr);
            }
        }

        const batch = writeBatch(db);

        // 2. Update current owner to Administrator
        const currentOwnerRef = doc(db, 'users', currentUser.uid);
        batch.set(currentOwnerRef, {
            role: 'admin',
            status: 'approved',
            updatedAt: serverTimestamp()
        }, { merge: true });

        // 3. Ensure target user document is set to 'owner' & 'approved'
        const targetUserRef = doc(db, 'users', targetUserId);
        batch.set(targetUserRef, {
            role: 'owner',
            status: 'approved',
            updatedAt: serverTimestamp()
        }, { merge: true });

        await batch.commit();

        // Update local session state
        if (userRecord) {
            userRecord.role = 'admin';
        }

        const nameLabel = targetDisplayName || cleanTargetEmail || 'the selected user';
        ui.showStatus(`Successfully transferred Workspace Ownership to ${nameLabel}! Your role is now Administrator.`, false, 6000);
        showAdminAddUserMsg(`✓ Workspace Ownership successfully transferred to ${nameLabel}.`, "success", 6000);
        updateAuthUI();
    } catch (e: any) {
        console.error("Failed to transfer ownership:", e);
        ui.showStatus("Failed to transfer ownership: " + (e?.message || e), true, 6000);
        showAdminAddUserMsg("Failed to transfer ownership: " + (e?.message || e), "error", 6000);
    }
}
