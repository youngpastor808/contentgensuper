import {
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    getDocs,
    where,
    deleteDoc,
    serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import * as dom from '../dom';
import * as ui from '../ui';
import { currentUser, showAdminAddUserMsg, isOwnerEmail, OWNER_EMAILS, SUPER_ADMIN_EMAILS } from './session';

export function getDeletedUserEmails(): Set<string> {
    try {
        const stored = localStorage.getItem('deleted_user_emails');
        if (stored) {
            const set = new Set<string>(JSON.parse(stored).map((e: string) => e.toLowerCase().trim()));
            for (const o of OWNER_EMAILS) set.delete(o.toLowerCase().trim());
            for (const s of SUPER_ADMIN_EMAILS) set.delete(s.toLowerCase().trim());
            return set;
        }
    } catch (e) {
        console.warn("Could not read deleted_user_emails from localStorage:", e);
    }
    return new Set<string>();
}

export function recordDeletedUserEmail(email: string) {
    if (!email) return;
    const emailLower = email.toLowerCase().trim();
    if (isOwnerEmail(emailLower)) {
        console.warn(`[Owner Protection] Refused to record owner email ${emailLower} as deleted.`);
        return;
    }
    try {
        const existing = getDeletedUserEmails();
        existing.add(emailLower);
        localStorage.setItem('deleted_user_emails', JSON.stringify(Array.from(existing)));
    } catch (e) {
        console.warn("Could not save deleted_user_emails to localStorage:", e);
    }
}

/**
 * Self-healing restoration for Workspace Owner accounts.
 * Ensures the app owner can NEVER be locked out, deleted, or listed as deleted.
 */
export async function restoreOwnerAccountsIfDeleted(): Promise<void> {
    const ownerList = Array.from(new Set([...OWNER_EMAILS, ...SUPER_ADMIN_EMAILS]));
    const activeUser = auth.currentUser || currentUser;

    for (const email of ownerList) {
        const cleanEmail = email.toLowerCase().trim();
        // 1. Remove from deletedUsers collection in Firestore if accidentally stored and active user is logged in
        if (activeUser) {
            try {
                await deleteDoc(doc(db, 'deletedUsers', cleanEmail)).catch(() => {});
            } catch {}
        }

        // 2. Purge from localStorage
        try {
            const stored = localStorage.getItem('deleted_user_emails');
            if (stored) {
                const list = JSON.parse(stored).filter((e: string) => e.toLowerCase().trim() !== cleanEmail);
                localStorage.setItem('deleted_user_emails', JSON.stringify(list));
            }
        } catch {}
    }

    // 3. Ensure KNOWN_AUTH_USERS owner profiles exist with active status in Firestore
    // Only attempt Firestore remote verification if an active authenticated user is logged in as owner/admin
    if (!activeUser) {
        return;
    }

    const activeEmail = (activeUser.email || '').toLowerCase().trim();
    const isOwnerOrAdmin = isOwnerEmail(activeEmail) || SUPER_ADMIN_EMAILS.some(s => s.toLowerCase() === activeEmail);
    if (!isOwnerOrAdmin) {
        return;
    }

    // Clean up any legacy synthetic placeholder documents so accounts never collide or share IDs
    try {
        await deleteDoc(doc(db, 'users', 'owner-bwaimatwaima-gmaiil')).catch(() => {});
        await deleteDoc(doc(db, 'users', 'owner-bwaimatwaima')).catch(() => {});
        await deleteDoc(doc(db, 'users', 'owner-bwaima100')).catch(() => {});
        if (activeUser.uid !== 'fJ5Uv4L1L6g0p8S6pB1O1p0kH7x2') {
            await deleteDoc(doc(db, 'users', 'fJ5Uv4L1L6g0p8S6pB1O1p0kH7x2')).catch(() => {});
        }
    } catch {}

    if (isOwnerEmail(activeEmail)) {
        try {
            const userRef = doc(db, 'users', activeUser.uid);
            const snap = await getDoc(userRef);
            const existing = snap.exists() ? snap.data() : {};
            const currentCredits = (typeof existing.credits === 'number' && existing.credits >= 1000000) ? existing.credits : 1000000;
            await setDoc(userRef, {
                email: activeEmail,
                displayName: existing.displayName || (activeEmail.includes('100') ? 'Bwaima 100' : 'Bwaima Twaima'),
                role: 'owner',
                status: 'approved',
                credits: currentCredits,
                renderMinutesQuota: 999999,
                allowImageGeneration: true,
                allowAudioGeneration: true,
                allowVideoGeneration: true,
                maxApprovedUsers: 9999,
                updatedAt: serverTimestamp(),
                createdAt: existing.createdAt || serverTimestamp()
            }, { merge: true });
            console.log(`[Owner Protection] Verified and protected active owner profile: ${activeEmail} (${activeUser.uid}) with role: owner`);
        } catch (err) {
            console.warn(`[Owner Protection] Error verifying owner doc ${activeUser.uid}:`, err);
        }
    }
}

export const TYPO_DOMAINS: { [key: string]: string } = {
    'gmaiil.com': 'gmail.com',
    'gmaill.com': 'gmail.com',
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmai.com': 'gmail.com',
    'hotmaiil.com': 'hotmail.com',
    'hotmaill.com': 'hotmail.com',
    'outloook.com': 'outlook.com',
    'yahool.com': 'yahoo.com',
    'yaho.com': 'yahoo.com'
};

export function normalizeEmail(raw: string): string {
    const trimmed = raw.toLowerCase().trim();
    const parts = trimmed.split('@');
    if (parts.length !== 2) return trimmed;
    const [user, domain] = parts;
    const correctedDomain = TYPO_DOMAINS[domain] || domain;
    return `${user}@${correctedDomain}`;
}

export function getEmailTypoWarning(email: string): string | null {
    const trimmed = email.toLowerCase().trim();
    const parts = trimmed.split('@');
    if (parts.length === 2 && TYPO_DOMAINS[parts[1]]) {
        return `⚠️ Detected common typo "@${parts[1]}" (did you mean "@${TYPO_DOMAINS[parts[1]]}"?)`;
    }
    return null;
}

export const KNOWN_AUTH_USERS: Array<{ uid: string; email: string; role: string; status: string }> = [];

/**
 * Calculates a composite permission and validity score for a user document.
 * Higher score = Higher administrative permissions and canonical Auth UID precedence.
 */
export function getDocPermissionScore(docId: string, data: any, email: string): number {
    let score = 0;
    const cleanEmail = (data?.email || email || '').toLowerCase().trim();
    const isOwner = isOwnerEmail(cleanEmail) || cleanEmail === 'bwaimatwaima@gmail.com';

    // 1. Role Authority (Owner > Admin > Reseller > User > other)
    const role = (data?.role || '').toLowerCase().trim();
    if (isOwner || role === 'owner') score += 100000;
    else if (role === 'admin') score += 80000;
    else if (role === 'reseller') score += 60000;
    else if (role === 'user') score += 40000;
    else score += 20000;

    // 2. Status Score (Approved/Active > Pending > Banned/Rejected)
    const status = (data?.status || '').toLowerCase().trim();
    if (isOwner || status === 'approved' || status === 'active') score += 15000;
    else if (status === 'pending') score += 7000;
    else score += 0;

    // 3. Genuine Firebase Auth UID Format vs Synthetic/Temporary IDs
    // The currently active authenticated session user MUST always be chosen as primary!
    const activeAuthUser = auth.currentUser || currentUser;
    if (activeAuthUser && docId === activeAuthUser.uid) {
        score += 500000; // Primary active authenticated session
    } else if (docId.length >= 26 && !docId.includes('@') && !docId.startsWith('owner-') && !docId.startsWith('local_')) {
        score += 6000; // Genuine Firebase Auth UID
    } else {
        score += 500; // Synthetic doc id or email-as-id
    }

    // 4. Feature permissions and credits
    if (typeof data?.credits === 'number') {
        score += Math.min(Math.floor(data.credits / 100), 2000);
    }
    if (data?.allowImageGeneration === true) score += 500;
    if (data?.allowAudioGeneration === true) score += 500;
    if (data?.allowVideoGeneration === true) score += 500;
    if (typeof data?.renderMinutesQuota === 'number' && data.renderMinutesQuota > 300) score += 500;

    return score;
}

export async function executeDeduplication(suspiciousGroups: Array<{ email: string; docs: Array<{ id: string; data: any }> }>): Promise<{ removed: number; errors: string[] }> {
    let totalRemoved = 0;
    const errors: string[] = [];
    const activeAuthUser = auth.currentUser || currentUser;

    for (const group of suspiciousGroups) {
        const docs = group.docs;
        if (docs.length <= 1) continue;

        const isOwner = isOwnerEmail(group.email);

        // Rank documents by permission and authority score descending:
        // Document with the HIGHEST permissions and best Auth UID is chosen as primary.
        // Documents with LOWER permissions will be removed.
        const sortedDocs = [...docs].sort((a, b) => {
            const scoreA = getDocPermissionScore(a.id, a.data, group.email);
            const scoreB = getDocPermissionScore(b.id, b.data, group.email);
            return scoreB - scoreA;
        });

        const primary = sortedDocs[0];
        const duplicates = sortedDocs.slice(1);

        // Aggregate maximum credits and best configuration from duplicates into primary
        let maxCredits = typeof primary.data?.credits === 'number' ? primary.data.credits : 10000;
        let bestRole = isOwner ? 'owner' : (primary.data?.role || 'user');
        let bestStatus = (isOwner || bestRole === 'admin') ? 'approved' : (primary.data?.status || 'approved');
        let bestDisplayName = primary.data?.displayName || (isOwner ? 'Bwaima Twaima' : group.email.split('@')[0]);

        if (isOwner && maxCredits < 1000000) {
            maxCredits = 1000000;
        }

        for (const dup of duplicates) {
            if (typeof dup.data?.credits === 'number' && dup.data.credits > maxCredits) {
                maxCredits = dup.data.credits;
            }
            if (!bestDisplayName && dup.data?.displayName) bestDisplayName = dup.data.displayName;
        }

        // Update the primary document with consolidated permissions & credits
        try {
            await setDoc(doc(db, 'users', primary.id), {
                email: group.email.toLowerCase().trim(),
                displayName: bestDisplayName,
                credits: maxCredits,
                role: bestRole,
                status: bestStatus,
                renderMinutesQuota: isOwner ? 999999 : (typeof primary.data?.renderMinutesQuota === 'number' ? primary.data.renderMinutesQuota : 10),
                allowImageGeneration: isOwner ? true : (primary.data?.allowImageGeneration ?? true),
                allowAudioGeneration: isOwner ? true : (primary.data?.allowAudioGeneration ?? true),
                allowVideoGeneration: isOwner ? true : (primary.data?.allowVideoGeneration ?? true),
                allowCookieAuth: isOwner ? true : (primary.data?.allowCookieAuth ?? false),
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (updateErr: any) {
            const msg = `Failed to update primary document ${primary.id}: ${updateErr?.message || updateErr}`;
            console.error(msg);
            errors.push(msg);
            continue;
        }

        // Safely delete lower-permission duplicate documents in Firebase
        for (const dup of duplicates) {
            if (dup.id === primary.id) continue;
            // Strict guard: Never delete the active logged-in user session
            if (activeAuthUser && dup.id === activeAuthUser.uid) {
                console.warn(`[Protection] Skipping deletion of active logged-in user: ${dup.id}`);
                continue;
            }

            try {
                await deleteDoc(doc(db, 'users', dup.id));
                totalRemoved++;
                console.log(`[Deduplication] Deleted lower-permission duplicate document in Firestore: id=${dup.id}, email=${group.email} (kept primary=${primary.id})`);
            } catch (delErr: any) {
                const errMsg = delErr?.message || String(delErr);
                console.warn(`[Deduplication] Could not delete lower-permission doc ${dup.id}:`, delErr);
                errors.push(`Could not delete doc ${dup.id} (${errMsg})`);
            }
        }
    }

    // Always guarantee owner profiles are healthy after deduplication
    await restoreOwnerAccountsIfDeleted();

    return { removed: totalRemoved, errors };
}

export async function executeTypoDeduplication(typoPairs: Array<{ typoEmail: string; targetEmail: string; typoDocs: Array<{ id: string; data: any }>; targetDocs: Array<{ id: string; data: any }> }>): Promise<{ removed: number; errors: string[] }> {
    let totalRemoved = 0;
    const errors: string[] = [];
    const activeAuthUser = auth.currentUser || currentUser;

    for (const pair of typoPairs) {
        // Strict guard: Never touch owner accounts in typo deduplication
        if (isOwnerEmail(pair.typoEmail) || isOwnerEmail(pair.targetEmail)) {
            console.warn(`[Typo Protection] Skipping typo deduplication for owner email: ${pair.typoEmail} -> ${pair.targetEmail}`);
            continue;
        }

        if (pair.targetDocs.length === 0) {
            // No target doc existed yet; migrate the typo document to the normalized email instead of deleting
            for (const tDoc of pair.typoDocs) {
                try {
                    await setDoc(doc(db, 'users', tDoc.id), {
                        email: pair.targetEmail,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    console.log(`[Typo Fix] Corrected email field from ${pair.typoEmail} to ${pair.targetEmail} on doc ${tDoc.id}`);
                } catch (err: any) {
                    const msg = `Failed to update email for doc ${tDoc.id}: ${err?.message || err}`;
                    console.warn(msg);
                    errors.push(msg);
                }
            }
        } else {
            // Target document already exists — merge any extra credits and remove the typo record
            const targetDoc = pair.targetDocs[0];
            let maxCredits = typeof targetDoc.data?.credits === 'number' ? targetDoc.data.credits : 10000;
            for (const tDoc of pair.typoDocs) {
                if (typeof tDoc.data?.credits === 'number' && tDoc.data.credits > maxCredits) {
                    maxCredits = tDoc.data.credits;
                }
            }
            try {
                await setDoc(doc(db, 'users', targetDoc.id), {
                    credits: maxCredits,
                    updatedAt: serverTimestamp()
                }, { merge: true });
            } catch (mErr) {
                console.warn(`[Typo Merge] Could not update target doc credits:`, mErr);
            }

            for (const tDoc of pair.typoDocs) {
                if ((activeAuthUser && tDoc.id === activeAuthUser.uid) || isOwnerEmail(tDoc.data?.email)) {
                    console.warn(`[Typo Protection] Refusing to delete protected owner or active session document: ${tDoc.id}`);
                    continue;
                }
                try {
                    await deleteDoc(doc(db, 'users', tDoc.id));
                    totalRemoved++;
                    console.log(`[Typo Deduplication] Safely deleted typo duplicate document ${tDoc.id} (${pair.typoEmail}) in favor of valid account ${targetDoc.id} (${pair.targetEmail})`);
                } catch (delErr: any) {
                    const errMsg = delErr?.message || String(delErr);
                    console.warn(`[Typo Deduplication] Could not delete typo doc ${tDoc.id}:`, delErr);
                    errors.push(`Could not delete doc ${tDoc.id} (${errMsg})`);
                }
            }
        }
    }
    return { removed: totalRemoved, errors };
}

export async function cleanupDuplicateUserDocs(showFeedback: boolean = false): Promise<number> {
    try {
        if (showFeedback && dom.adminCleanDuplicatesBtn) {
            dom.adminCleanDuplicatesBtn.disabled = true;
            dom.adminCleanDuplicatesBtn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> Scanning...';
        }

        const snapshot = await getDocs(collection(db, 'users'));
        const emailMap = new Map<string, Array<{ id: string; data: any }>>();

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            const raw = data.email || data.Email || (docSnap.id.includes('@') ? docSnap.id : '');
            const email = (raw || '').toLowerCase().trim();
            if (email && email.includes('@')) {
                if (!emailMap.has(email)) {
                    emailMap.set(email, []);
                }
                emailMap.get(email)!.push({ id: docSnap.id, data });
            }
        });

        // 1. Identify Exact Duplicate Accounts
        const suspiciousGroups: Array<{ email: string; docs: Array<{ id: string; data: any }> }> = [];
        emailMap.forEach((docs, email) => {
            if (docs.length > 1) {
                suspiciousGroups.push({ email, docs });
            }
        });

        // 2. Identify Typo Domain Duplicates (e.g. user@gmaiil.com where user@gmail.com also exists)
        const typoDuplicatePairs: Array<{
            typoEmail: string;
            targetEmail: string;
            typoDocs: Array<{ id: string; data: any }>;
            targetDocs: Array<{ id: string; data: any }>;
        }> = [];

        emailMap.forEach((docs, email) => {
            if (isOwnerEmail(email)) return;
            const normalized = normalizeEmail(email);
            if (isOwnerEmail(normalized)) return;
            if (normalized !== email && emailMap.has(normalized)) {
                typoDuplicatePairs.push({
                    typoEmail: email,
                    targetEmail: normalized,
                    typoDocs: docs,
                    targetDocs: emailMap.get(normalized)!
                });
            }
        });

        const totalExactDuplicates = suspiciousGroups.reduce((acc, g) => acc + (g.docs.length - 1), 0);
        const totalTypoDuplicates = typoDuplicatePairs.reduce((acc, p) => acc + p.typoDocs.length, 0);
        const totalIssues = totalExactDuplicates + totalTypoDuplicates;

        if (totalIssues === 0) {
            await restoreOwnerAccountsIfDeleted();
            if (showFeedback) {
                showAdminAddUserMsg("✓ No duplicate user documents or typo accounts found. Database is healthy!", "success", 4000);
                ui.showStatus("Scan complete: No duplicate accounts found.", false, 3000);
                if (dom.adminCleanDuplicatesBtn) {
                    dom.adminCleanDuplicatesBtn.disabled = false;
                    dom.adminCleanDuplicatesBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> <span>Scan Duplicates</span>`;
                }
            }
            return 0;
        }

        if (showFeedback) {
            const summaryParts: string[] = [];
            if (suspiciousGroups.length > 0) {
                summaryParts.push(`${suspiciousGroups.length} exact duplicate email groups (${totalExactDuplicates} redundant document(s))`);
            }
            if (typoDuplicatePairs.length > 0) {
                summaryParts.push(`${typoDuplicatePairs.length} typo duplicate account(s) (${typoDuplicatePairs.map(p => `"${p.typoEmail}" → "${p.targetEmail}"`).join(', ')})`);
            }

            showAdminAddUserMsg(`⚠️ Found ${summaryParts.join(' and ')}. Consolidation prompt opened.`, 'error', 8000);
            if (dom.adminCleanDuplicatesBtn) {
                dom.adminCleanDuplicatesBtn.setAttribute('data-temp-status', 'true');
                dom.adminCleanDuplicatesBtn.innerHTML = `<span class="text-amber-300 font-bold">⚠️ ${totalIssues} Dupes Found</span>`;
            }

            const dialogLines: string[] = [];
            if (suspiciousGroups.length > 0) {
                dialogLines.push('Exact Duplicate Documents:\n' + suspiciousGroups.map(g => `• ${g.email} (${g.docs.length} copies)`).join('\n'));
            }
            if (typoDuplicatePairs.length > 0) {
                dialogLines.push('Typo / Misspelled Duplicate Accounts:\n' + typoDuplicatePairs.map(p => `• "${p.typoEmail}" (misspelled domain with double "ii") duplicates valid account "${p.targetEmail}"`).join('\n'));
            }

            ui.showConfirmation(
                'Consolidate Duplicate & Typo Accounts',
                `Found ${totalIssues} redundant profile(s):\n\n${dialogLines.join('\n\n')}\n\nDo you want to automatically merge credits into the primary accounts and delete the redundant/typo records?`,
                async () => {
                    showAdminAddUserMsg("Consolidating accounts and removing redundant records...", "info", 0);
                    ui.showStatus("Consolidating accounts and removing redundant records...", false);
                    let removedExact = 0;
                    let removedTypo = 0;
                    const allErrors: string[] = [];

                    if (suspiciousGroups.length > 0) {
                        const res = await executeDeduplication(suspiciousGroups);
                        removedExact = res.removed;
                        allErrors.push(...res.errors);
                    }
                    if (typoDuplicatePairs.length > 0) {
                        const res = await executeTypoDeduplication(typoDuplicatePairs);
                        removedTypo = res.removed;
                        allErrors.push(...res.errors);
                    }
                    const totalRemoved = removedExact + removedTypo;

                    if (totalRemoved > 0) {
                        if (totalRemoved >= totalIssues) {
                            showAdminAddUserMsg(`✓ Cleanup complete: Consolidated accounts and safely removed ${totalRemoved} redundant record(s).`, "success", 6000);
                            ui.showStatus(`Cleanup complete: Removed ${totalRemoved} redundant record(s).`, false, 4000);
                        } else {
                            const errSuffix = allErrors.length > 0 ? ` (${allErrors[0]})` : '';
                            showAdminAddUserMsg(`Consolidated accounts: Safely removed ${totalRemoved} of ${totalIssues} records${errSuffix}.`, "info", 7000);
                            ui.showStatus(`Removed ${totalRemoved} of ${totalIssues} redundant record(s).`, false, 4000);
                        }
                    } else {
                        const errSuffix = allErrors.length > 0 ? `: ${allErrors[0]}` : '';
                        showAdminAddUserMsg(`⚠️ Consolidation notice: 0 redundant records could be removed${errSuffix}. Please verify document permissions.`, "error", 8000);
                        ui.showStatus(`Consolidation notice: 0 records removed${errSuffix}.`, true, 5000);
                    }

                    if (dom.adminCleanDuplicatesBtn) {
                        dom.adminCleanDuplicatesBtn.removeAttribute('data-temp-status');
                        dom.adminCleanDuplicatesBtn.disabled = false;
                        dom.adminCleanDuplicatesBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> <span>Scan Duplicates</span>`;
                    }
                },
                () => {
                    if (dom.adminCleanDuplicatesBtn) {
                        dom.adminCleanDuplicatesBtn.removeAttribute('data-temp-status');
                        dom.adminCleanDuplicatesBtn.disabled = false;
                        dom.adminCleanDuplicatesBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> <span>Scan Duplicates</span>`;
                    }
                }
            );
            return 0;
        } else {
            let total = 0;
            if (suspiciousGroups.length > 0) {
                const res = await executeDeduplication(suspiciousGroups);
                total += res.removed;
            }
            if (typoDuplicatePairs.length > 0) {
                const res = await executeTypoDeduplication(typoDuplicatePairs);
                total += res.removed;
            }
            return total;
        }
    } catch (e: any) {
        console.error("Deduplication error:", e);
        if (showFeedback) {
            showAdminAddUserMsg("Scan error: " + (e?.message || e), "error", 6000);
            ui.showStatus("Scan error: " + (e?.message || e), true, 4000);
            if (dom.adminCleanDuplicatesBtn) {
                dom.adminCleanDuplicatesBtn.removeAttribute('data-temp-status');
                dom.adminCleanDuplicatesBtn.disabled = false;
                dom.adminCleanDuplicatesBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> <span>Scan Duplicates</span>`;
            }
        }
        return 0;
    }
}

export async function syncKnownAuthUsers(showFeedback: boolean = false): Promise<number> {
    let syncedCount = 0;
    
    // Always restore and safeguard owner accounts first
    await restoreOwnerAccountsIfDeleted();

    const deletedSet = getDeletedUserEmails();

    try {
        // Query deletedUsers collection in Firestore to maintain cross-device persistence (with timeout)
        try {
            const delPromise = getDocs(collection(db, 'deletedUsers'));
            const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
            const delSnap: any = await Promise.race([delPromise, timeoutPromise]);
            if (delSnap && delSnap.docs) {
                delSnap.docs.forEach((d: any) => {
                    const idLower = d.id.toLowerCase().trim();
                    if (!isOwnerEmail(idLower)) deletedSet.add(idLower);
                    const data = d.data();
                    if (data.email) {
                        const emailLower = data.email.toLowerCase().trim();
                        if (!isOwnerEmail(emailLower)) deletedSet.add(emailLower);
                    }
                });
            }
        } catch (delErr: any) {
            console.debug("Could not query deletedUsers collection (using local registry):", delErr?.message || delErr);
        }

        // Purge owner accounts from deletedSet
        for (const o of OWNER_EMAILS) deletedSet.delete(o.toLowerCase().trim());
        for (const s of SUPER_ADMIN_EMAILS) deletedSet.delete(s.toLowerCase().trim());

        // Build list of candidate auth accounts to sync
        const candidateUsers: Array<{ uid: string; email: string; role: string; status: string; displayName?: string }> = [
            ...KNOWN_AUTH_USERS
        ];
        const activeAuthUser = auth.currentUser || currentUser;
        if (activeAuthUser && activeAuthUser.email && activeAuthUser.uid) {
            const curEmail = activeAuthUser.email.toLowerCase().trim();
            const curUid = activeAuthUser.uid;
            const isCurOwner = isOwnerEmail(curEmail);
            const curDisplayName = activeAuthUser.displayName || (isCurOwner ? 'Bwaima Twaima' : curEmail.split('@')[0]);
            const filtered = candidateUsers.filter(c => c.uid !== curUid && c.email.toLowerCase() !== curEmail);
            candidateUsers.length = 0;
            candidateUsers.push(...filtered);
            candidateUsers.unshift({
                uid: curUid,
                email: curEmail,
                displayName: curDisplayName,
                role: isCurOwner ? 'owner' : 'user',
                status: isCurOwner ? 'approved' : 'active'
            });
        }

        // Client-side sync directly with Firestore with duplicate prevention & data preservation
        for (const u of candidateUsers) {
            const emailLower = u.email.toLowerCase().trim();
            if (deletedSet.has(emailLower) && !isOwnerEmail(emailLower)) {
                // User was deliberately deleted by admin, skip re-syncing
                continue;
            }
            const userRef = doc(db, 'users', u.uid);
            let snap: any = null;
            try {
                const snapPromise = getDoc(userRef);
                const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                snap = await Promise.race([snapPromise, timeoutPromise]);
            } catch (snapErr) {
                console.warn(`Timeout or error reading user document for ${u.email}:`, snapErr);
            }

            if (!snap || !snap.exists()) {
                // Check if an unlinked document already exists with a different ID (e.g. auto-ID or email ID)
                let existingData: any = null;
                const oldDocIds: string[] = [];
                try {
                    const q = query(collection(db, 'users'), where('email', '==', emailLower));
                    const qPromise = getDocs(q);
                    const qTimeout = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
                    const qSnap: any = await Promise.race([qPromise, qTimeout]);
                    if (qSnap && qSnap.forEach) {
                        qSnap.forEach((d: any) => {
                            if (d.id !== u.uid) {
                                if (!existingData) existingData = d.data();
                                oldDocIds.push(d.id);
                            }
                        });
                    }
                } catch {}

                const isTargetOwner = isOwnerEmail(emailLower);
                const displayName = existingData?.displayName || u.displayName || (isTargetOwner ? 'Bwaima Twaima' : u.email.split('@')[0]);
                const finalCredits = isTargetOwner ? 1000000 : ((typeof existingData?.credits === 'number') ? existingData.credits : 10000);
                const finalRole = isTargetOwner ? 'owner' : (existingData?.role || u.role || 'user');
                const finalStatus = isTargetOwner ? 'approved' : (existingData?.status || u.status || 'pending');

                const payload: any = {
                    email: emailLower,
                    displayName,
                    role: finalRole,
                    status: finalStatus,
                    credits: finalCredits,
                    renderMinutesQuota: isTargetOwner ? 999999 : (typeof existingData?.renderMinutesQuota === 'number' ? existingData.renderMinutesQuota : 10),
                    allowImageGeneration: isTargetOwner ? true : (existingData?.allowImageGeneration ?? true),
                    allowAudioGeneration: isTargetOwner ? true : (existingData?.allowAudioGeneration ?? true),
                    allowVideoGeneration: isTargetOwner ? true : (existingData?.allowVideoGeneration ?? true),
                    allowCookieAuth: isTargetOwner ? true : (existingData?.allowCookieAuth ?? false),
                    createdAt: existingData?.createdAt || serverTimestamp(),
                    updatedAt: serverTimestamp()
                };
                if (isTargetOwner) {
                    payload.maxApprovedUsers = 9999;
                } else {
                    if (existingData?.assignedBy) payload.assignedBy = existingData.assignedBy;
                    if (existingData?.maxApprovedUsers) payload.maxApprovedUsers = existingData.maxApprovedUsers;
                }

                await setDoc(userRef, payload, { merge: true });
                syncedCount++;

                // Clean up orphaned legacy doc IDs to avoid duplicates
                for (const oldId of oldDocIds) {
                    await deleteDoc(doc(db, 'users', oldId)).catch(() => {});
                }
            }
        }

        if (showFeedback) {
            ui.showStatus(
                syncedCount > 0 
                    ? `Sync complete! Verified accounts (${syncedCount} new profiles synchronized).`
                    : `Sync complete! All verified user profiles are in sync with Firebase Auth.`,
                false, 
                4000
            );
        }
    } catch (e: any) {
        console.warn("Sync known auth users warning:", e);
        if (showFeedback) {
            ui.showStatus("Sync notice: " + (e?.message || e), false, 4000);
        }
    }
    return syncedCount;
}
