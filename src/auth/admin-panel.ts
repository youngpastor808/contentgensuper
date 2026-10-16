import {
    doc,
    setDoc,
    updateDoc,
    collection,
    query,
    onSnapshot,
    serverTimestamp
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import * as dom from '../dom';
import * as ui from '../ui';
import { state } from '../state';
import { escapeHtml } from '../utils';
import { loadPrivateSystemConfigForAdmin } from '../handlers-admin-system';
import {
    currentUser,
    userRecord,
    isUserOwner,
    isUserAdmin,
    isUserReseller,
    isOwnerEmail,
    OWNER_EMAILS,
    SUPER_ADMIN_EMAILS,
    SUPER_ADMIN_EMAIL,
    clearAdminAddUserMsg,
    adminUsersUnsubscribe,
    setAdminUsersUnsubscribe,
    isUrlOrLink
} from './session';
import {
    normalizeEmail,
    getEmailTypoWarning,
    TYPO_DOMAINS,
    syncKnownAuthUsers
} from './dedup';
import {
    approveUserWithResellerCheck,
    updateUserRole,
    updateUserStatus,
    deleteUserRecord,
    transferOwnership
} from './admin-users';

export function openAdminPanel() {
    const isAdmin = isUserAdmin(currentUser, userRecord);
    const isReseller = !isAdmin && isUserReseller(userRecord);

    if (!currentUser || (!isAdmin && !isReseller)) {
        ui.showStatus('Unauthorized: administrator or reseller access required.', true, 3000);
        return;
    }

    clearAdminAddUserMsg();
    if (dom.adminPanel) dom.adminPanel.classList.remove('hidden');
    
    if (adminUsersUnsubscribe) {
        adminUsersUnsubscribe();
        setAdminUsersUnsubscribe(null);
    }

    const myUid = currentUser?.uid || '';

    // Auto-sync known accounts into Firestore when admin accesses the panel
    if (isAdmin) {
        loadPrivateSystemConfigForAdmin().catch(e => console.warn("Admin private config notice:", e));
        syncKnownAuthUsers(false).catch(e => console.warn("Admin auto-sync notice:", e));
    }

    // Update title
    if (dom.adminPanelTitle) {
        dom.adminPanelTitle.textContent = isAdmin 
            ? 'Admin & Reseller Management Panel' 
            : 'Reseller Quota & Member Approval';
    }

    // Configure form inputs visibility for reseller vs admin
    if (isReseller && !isAdmin) {
        if (dom.adminAddUserRoleSelect) {
            dom.adminAddUserRoleSelect.value = 'user';
            dom.adminAddUserRoleSelect.disabled = true;
        }
        if (dom.adminAddUserQuotaGroup) {
            dom.adminAddUserQuotaGroup.classList.add('hidden');
        }
        if (dom.adminTabKeysBtn) dom.adminTabKeysBtn.classList.add('hidden');
        if (dom.adminTabCreditsBtn) dom.adminTabCreditsBtn.classList.add('hidden');
        if (dom.adminTabMaintenanceBtn) dom.adminTabMaintenanceBtn.classList.add('hidden');
    } else {
        if (dom.adminAddUserRoleSelect) {
            dom.adminAddUserRoleSelect.disabled = false;
        }
        if (dom.adminAddUserQuotaGroup) {
            dom.adminAddUserQuotaGroup.classList.remove('hidden');
        }
        if (dom.adminTabKeysBtn) dom.adminTabKeysBtn.classList.remove('hidden');
        if (dom.adminTabCreditsBtn) dom.adminTabCreditsBtn.classList.remove('hidden');
        if (dom.adminTabMaintenanceBtn) dom.adminTabMaintenanceBtn.classList.remove('hidden');
    }

    // Self sync: preserve true role and never escalate non-admins to admin
    if (currentUser?.uid && userRecord) {
        const myEmail = (currentUser?.email || userRecord.email || '').toLowerCase().trim();
        const isOwner = isUserOwner(currentUser, userRecord) || isOwnerEmail(myEmail);
        const safeRole = isOwner ? 'owner' : (isUserAdmin(currentUser, userRecord) ? 'admin' : (userRecord.role || 'user'));
        const safeStatus = isOwner ? 'approved' : (userRecord.status || 'pending');
        const safeCredits = isOwner ? 1000000 : (userRecord.credits !== undefined ? userRecord.credits : 10000);
        setDoc(doc(db, 'users', currentUser.uid), {
            email: myEmail,
            displayName: userRecord.displayName || currentUser.displayName || (isOwner ? 'Bwaima Twaima' : 'User'),
            role: safeRole,
            status: safeStatus,
            credits: safeCredits,
            renderMinutesQuota: isOwner ? 999999 : (userRecord.renderMinutesQuota || 10),
            allowImageGeneration: isOwner ? true : userRecord.allowImageGeneration,
            allowAudioGeneration: isOwner ? true : userRecord.allowAudioGeneration,
            allowVideoGeneration: isOwner ? true : userRecord.allowVideoGeneration,
            allowCookieAuth: isOwner ? true : (typeof userRecord.allowCookieAuth === 'boolean' ? userRecord.allowCookieAuth : (userRecord.role === 'admin')),
            updatedAt: serverTimestamp()
        }, { merge: true }).catch(err => console.warn("Self-sync notice:", err));
    }

    const usersRef = collection(db, 'users');
    const q = query(usersRef);
    
    // Track transient visual states across real-time snapshot re-renders
    const pendingSaveVisuals = new Map<string, { username?: number, quota?: number, credits?: number, renderMinutes?: number, role?: number, status?: number }>();

    const unsub = onSnapshot(q, (snapshot) => {
        if (!dom.adminUsersList) return;
        dom.adminUsersList.innerHTML = '';
        
        const currentEmail = currentUser?.email?.toLowerCase().trim() || '';
        const currentUid = currentUser?.uid || '';
        const currentIsOwner = isUserOwner(currentUser, userRecord) || isOwnerEmail(currentEmail);
        const currentIsAdmin = isUserAdmin(currentUser, userRecord) || isOwnerEmail(currentEmail);
        const currentIsReseller = !currentIsAdmin && isUserReseller(userRecord);

        // Count approved users assigned by this reseller or created by them
        const approvedByMe = snapshot.docs.filter(d => {
            const data = d.data();
            const assignedClean = (data.assignedBy || '').trim().toLowerCase();
            const isAssigned = assignedClean && (assignedClean === currentEmail || (currentUid && assignedClean === currentUid.toLowerCase()));
            return data.status === 'approved' && isAssigned;
        }).length;

        const maxQuota = userRecord?.maxApprovedUsers || 5;

        // Show/hide reseller quota banner card
        if (currentIsReseller) {
            if (dom.adminQuotaCard) dom.adminQuotaCard.classList.remove('hidden');
            if (dom.adminQuotaText) {
                dom.adminQuotaText.textContent = `Active Reseller Quota: ${approvedByMe} of ${maxQuota} accounts approved. You can assign and approve up to ${maxQuota} members under your reseller rights.`;
            }
        } else if (currentIsAdmin) {
            if (dom.adminQuotaCard) dom.adminQuotaCard.classList.remove('hidden');
            if (dom.adminQuotaText) {
                dom.adminQuotaText.textContent = `System Administrator Mode: You have full access to manage roles, assign reseller approval quotas, and approve or ban users across the platform.`;
            }
        } else {
            if (dom.adminQuotaCard) dom.adminQuotaCard.classList.add('hidden');
        }

        if (snapshot.empty) {
            dom.adminUsersList.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-gray-400">No users found.</td></tr>';
            return;
        }

        const renderedEmails = new Set<string>();
        let renderedCount = 0;

        // Build set of all emails present in database to detect lookalike typos
        const allEmailsInList = new Set<string>();
        snapshot.docs.forEach(d => {
            const dData = d.data();
            const e = normalizeEmail(dData.email || dData.Email || (dData.displayName && dData.displayName.includes('@') ? dData.displayName : '') || (d.id.includes('@') ? d.id : ''));
            if (e && e.includes('@')) allEmailsInList.add(e);
        });

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            let userEmailClean = normalizeEmail(data.email || data.Email || '');
            if (!userEmailClean && data.displayName && data.displayName.includes('@')) {
                userEmailClean = normalizeEmail(data.displayName);
            }
            if (!userEmailClean && docSnap.id.includes('@')) {
                userEmailClean = normalizeEmail(docSnap.id);
            }
            
            const isDocOwner = isOwnerEmail(userEmailClean) || isOwnerEmail(data.email) || isOwnerEmail(docSnap.id) || (data.role === 'owner' && isOwnerEmail(userEmailClean));
            const isDocAdmin = !isDocOwner && (data.role === 'admin' || (SUPER_ADMIN_EMAILS.some(s => s.toLowerCase() === userEmailClean)));
            const userRole = isDocOwner ? 'owner' : (isDocAdmin ? 'admin' : (data.role || 'user'));
            const userStatus = isDocOwner ? 'approved' : (data.status || 'pending');

            // Auto-heal owner document in Firestore if out of sync
            if (isDocOwner && (data.role !== 'owner' || data.status !== 'approved' || (data.credits || 0) < 500000)) {
                updateDoc(docSnap.ref, {
                    role: 'owner',
                    status: 'approved',
                    credits: (typeof data.credits === 'number' && data.credits >= 500000) ? data.credits : 1000000,
                    renderMinutesQuota: 999999,
                    allowImageGeneration: true,
                    allowAudioGeneration: true,
                    allowVideoGeneration: true,
                    updatedAt: serverTimestamp()
                }).catch(e => console.warn("Auto-healing owner record notice:", e));
            } else if (!isDocOwner && data.role === 'owner') {
                // If any non-owner had role 'owner', correct to 'admin'
                updateDoc(docSnap.ref, {
                    role: 'admin',
                    status: data.status || 'approved',
                    updatedAt: serverTimestamp()
                }).catch(e => console.warn("Correcting non-owner role notice:", e));
            }

            const assignedByClean = (data.assignedBy || '').trim().toLowerCase();
            const isMe = (currentUid && docSnap.id === currentUid) || (currentEmail && userEmailClean === currentEmail);

            // STRICT SECURITY RULE: Non-admins (resellers/standard users) can ONLY EVER see themselves and accounts they assigned
            if (!currentIsAdmin) {
                // Never show any admin account or system admin to a reseller/non-admin
                if (userRole === 'admin' || userEmailClean === SUPER_ADMIN_EMAIL.toLowerCase()) {
                    return;
                }
                const isAssignedToMe = assignedByClean && (assignedByClean === currentEmail || (currentUid && assignedByClean === currentUid.toLowerCase()));
                if (!isMe && !isAssignedToMe) {
                    return; // Skip completely!
                }
            }
            
            // Skip duplicate rows for the exact same email
            if (userEmailClean) {
                if (renderedEmails.has(userEmailClean)) {
                    return;
                }
                renderedEmails.add(userEmailClean);
            }

            renderedCount++;

            // Detect typo domains (e.g. gmaiil.com) and lookalike accounts
            const typoWarning = getEmailTypoWarning(userEmailClean);
            let typoTargetEmail = '';
            if (typoWarning) {
                const parts = userEmailClean.split('@');
                const targetDomain = TYPO_DOMAINS[parts[1]];
                if (targetDomain) {
                    const candidate = `${parts[0]}@${targetDomain}`;
                    if (allEmailsInList.has(candidate) && candidate !== userEmailClean) {
                        typoTargetEmail = candidate;
                    }
                }
            }

            const tr = document.createElement('tr');
            tr.className = `border-b border-gray-700/60 hover:bg-gray-800/50 transition-colors ${typoTargetEmail ? 'bg-rose-950/20' : typoWarning ? 'bg-amber-950/20' : ''}`;
            
            const fallbackOwnerName = userEmailClean.includes('100') ? 'Bwaima 100' : 'Bwaima Twaima';
            const displayName = data.displayName || (data.email ? data.email.split('@')[0] : (isDocOwner ? fallbackOwnerName : 'User'));
            const userStatusClean = isDocOwner ? 'approved' : (data.status || 'pending');
            const resellerQuota = data.maxApprovedUsers ?? (userRole === 'reseller' ? 5 : '-');

            const isQuotaReached = currentIsReseller && approvedByMe >= maxQuota;

            const creditsVal = isDocOwner ? (typeof data.credits === 'number' && data.credits >= 1000000 ? data.credits : 1000000) : (data.credits !== undefined ? data.credits : 10000);
            const quotaVal = data.maxApprovedUsers ?? 5;
            const renderMinutesVal = isDocOwner ? 999999 : (data.renderMinutesQuota !== undefined ? data.renderMinutesQuota : 10);
            const renderMinutesUsedVal = data.renderMinutesUsed || 0;
            const allowImageGen = isDocOwner ? true : (typeof data.allowImageGeneration === 'boolean' 
                ? data.allowImageGeneration 
                : (userRole === 'admin'));
            const allowAudioGen = isDocOwner ? true : (typeof data.allowAudioGeneration === 'boolean' 
                ? data.allowAudioGeneration 
                : (userRole === 'admin'));
            const allowVideoGen = isDocOwner ? true : (typeof data.allowVideoGeneration === 'boolean' 
                ? data.allowVideoGeneration 
                : (userRole === 'admin'));
            const allowCookieAuth = isDocOwner ? true : (typeof data.allowCookieAuth === 'boolean' 
                ? data.allowCookieAuth 
                : (userRole === 'admin'));

            // Check transient visual states
            const transientState = pendingSaveVisuals.get(docSnap.id) || {};
            const isNameSaved = transientState.username && transientState.username > Date.now();
            const isQuotaSaved = transientState.quota && transientState.quota > Date.now();
            const isCreditsSaved = transientState.credits && transientState.credits > Date.now();
            const isRenderMinutesSaved = transientState.renderMinutes && transientState.renderMinutes > Date.now();
            const isRoleSaved = transientState.role && transientState.role > Date.now();
            const isStatusSaved = transientState.status && transientState.status > Date.now();

            const nameBtnClass = isNameSaved 
                ? 'save-username-admin-btn bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs transition-colors font-medium flex-shrink-0 cursor-pointer' 
                : 'save-username-admin-btn bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs transition-colors font-medium flex-shrink-0';
            const nameBtnText = isNameSaved ? 'Saved ✓' : 'Save';

            const quotaBtnClass = isQuotaSaved 
                ? 'save-quota-btn bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs transition-colors font-medium cursor-pointer' 
                : 'save-quota-btn bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded text-xs transition-colors font-medium';
            const quotaBtnText = isQuotaSaved ? 'Saved ✓' : 'Save';

            const creditsBtnClass = isCreditsSaved 
                ? 'save-credits-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer' 
                : 'save-credits-btn bg-amber-600 hover:bg-amber-500 text-black font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0';
            const creditsBtnText = isCreditsSaved ? 'Saved ✓' : 'Save';

            const renderMinutesBtnClass = isRenderMinutesSaved
                ? 'save-render-minutes-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer'
                : 'save-render-minutes-btn bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0';
            const renderMinutesBtnText = isRenderMinutesSaved ? 'Saved ✓' : 'Save';

            const safeDisplayName = escapeHtml(displayName);
            const safeEmail = escapeHtml(data.email || userEmailClean || '');
            const safeAssignedBy = escapeHtml(data.assignedBy || '');
            const safeDocId = escapeHtml(docSnap.id);
            const safeTypoTarget = typoTargetEmail ? escapeHtml(typoTargetEmail) : '';
            const safeTypoWarning = typoWarning ? escapeHtml(typoWarning) : '';
            const isSpamUrlName = isUrlOrLink(displayName);

            tr.innerHTML = `
                <td class="p-3">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        ${currentIsAdmin ? `
                            <input type="text" class="username-admin-input bg-gray-900 text-white border border-gray-600 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-purple-500 w-36 sm:w-44" value="${safeDisplayName}" data-id="${safeDocId}" data-saved="${safeDisplayName}">
                            <button class="${nameBtnClass}" data-id="${safeDocId}">${nameBtnText}</button>
                            ${isSpamUrlName ? `
                                <span class="text-[10px] bg-rose-950/90 text-rose-300 border border-rose-600/70 px-1.5 py-0.5 rounded font-mono font-semibold" title="User entered a URL/link as their display name">⚠️ Link in Name</span>
                                <button class="clean-spam-name-btn bg-slate-800 hover:bg-rose-900/60 text-rose-300 border border-rose-500/40 px-1.5 py-0.5 rounded text-[10px] font-semibold transition cursor-pointer" data-id="${safeDocId}" data-fallback="${safeEmail}">Clean</button>
                            ` : ''}
                        ` : `
                            <span class="font-semibold text-gray-200 text-xs">${safeDisplayName}</span>
                            ${isSpamUrlName ? `
                                <span class="text-[10px] bg-rose-950/90 text-rose-300 border border-rose-600/70 px-1.5 py-0.5 rounded font-mono font-semibold">⚠️ Link in Name</span>
                            ` : ''}
                        `}
                    </div>
                    <div class="text-[11px] text-gray-400 flex items-center gap-1.5 flex-wrap">
                        <span class="font-mono ${typoWarning ? 'text-amber-300 font-semibold underline decoration-wavy decoration-amber-500' : ''}">${safeEmail}</span>
                        ${safeTypoTarget ? `
                            <span class="text-[10px] bg-rose-950/90 text-rose-300 border border-rose-600/70 px-1.5 py-0.5 rounded font-mono font-semibold flex items-center gap-1" title="This account has a domain typo (double 'ii') and duplicates ${safeTypoTarget}. Click 'Scan Duplicates' or Delete to clean it up.">
                                ⚠️ Typo duplicate of ${safeTypoTarget}
                            </span>
                        ` : safeTypoWarning ? `
                            <span class="text-[10px] bg-amber-950/90 text-amber-300 border border-amber-600/70 px-1.5 py-0.5 rounded font-mono font-medium flex items-center gap-1" title="${safeTypoWarning}">
                                ⚠️ ${safeTypoWarning}
                            </span>
                        ` : ''}
                        ${isMe ? '<span class="text-[9px] bg-purple-600 px-1.5 py-0.2 rounded text-white font-semibold">You</span>' : ''}
                        ${currentIsAdmin && data.assignedBy ? `<span class="text-[10px] text-indigo-300 bg-indigo-950/70 px-1.5 py-0.5 rounded border border-indigo-700/40">By: ${safeAssignedBy}</span>` : ''}
                    </div>
                </td>
                <td class="p-3">
                    ${userRole === 'owner' ? `
                        <span class="px-2.5 py-1 rounded text-[11px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/60 inline-flex items-center gap-1 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                            👑 Owner
                        </span>
                    ` : currentIsAdmin ? `
                        <div class="flex items-center gap-1.5">
                            <select class="role-select bg-gray-800 text-white border border-gray-600 rounded p-1 text-xs ${isMe ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${safeDocId}" ${isMe ? 'disabled' : ''}>
                                <option value="user" ${userRole === 'user' ? 'selected' : ''}>User</option>
                                <option value="reseller" ${userRole === 'reseller' ? 'selected' : ''}>Reseller</option>
                                <option value="admin" ${userRole === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                            <span class="role-saved-badge text-[10px] text-emerald-400 font-mono font-medium ${isRoleSaved ? '' : 'hidden'}">✓ Saved</span>
                        </div>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${userRole === 'admin' ? 'bg-red-900/60 text-red-300 border border-red-700' : userRole === 'reseller' ? 'bg-purple-900/60 text-purple-300 border border-purple-700' : 'bg-gray-800 text-gray-300'}">
                            ${userRole}
                        </span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin && userRole === 'reseller' ? `
                        <div class="flex items-center gap-1">
                            <input type="number" min="1" max="1000" class="quota-input bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 text-xs w-16 focus:outline-none focus:border-purple-500" value="${quotaVal}" data-id="${safeDocId}" data-saved="${quotaVal}">
                            <button class="${quotaBtnClass}" data-id="${safeDocId}">${quotaBtnText}</button>
                        </div>
                    ` : userRole === 'reseller' ? `
                        <span class="text-xs font-mono text-purple-300">${resellerQuota} Users</span>
                    ` : `
                        <span class="text-xs text-gray-500">-</span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <div class="flex items-center gap-1">
                            <input type="number" min="0" step="1" class="credits-input bg-gray-900 text-yellow-300 font-mono font-bold border border-gray-600 rounded px-2 py-1 text-xs w-20 sm:w-24 focus:outline-none focus:border-yellow-500" value="${creditsVal}" data-id="${safeDocId}" data-saved="${creditsVal}">
                            <button class="${creditsBtnClass}" data-id="${safeDocId}">
                                ${creditsBtnText}
                            </button>
                            <button class="quick-add-10k-btn bg-yellow-900/60 hover:bg-yellow-800 text-yellow-300 border border-yellow-600/60 px-1.5 py-1 rounded text-[10px] font-mono transition-colors flex-shrink-0" data-id="${safeDocId}" title="Add +10,000 Credits to this user">
                                +10k
                            </button>
                        </div>
                    ` : `
                        <span class="text-xs font-mono font-bold text-yellow-400">${(data.credits !== undefined ? data.credits : 10000).toLocaleString()}</span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <div class="flex items-center gap-1">
                            <input type="number" min="0" step="10" class="render-minutes-input bg-gray-900 text-indigo-300 font-mono font-bold border border-gray-600 rounded px-2 py-1 text-xs w-16 focus:outline-none focus:border-indigo-500" value="${renderMinutesVal}" data-id="${safeDocId}" data-saved="${renderMinutesVal}" title="Total cloud render minutes quota">
                            <button class="${renderMinutesBtnClass}" data-id="${safeDocId}">
                                ${renderMinutesBtnText}
                            </button>
                            <button class="quick-add-60m-btn bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 px-1.5 py-1 rounded text-[10px] font-mono transition-colors flex-shrink-0" data-id="${safeDocId}" title="Add +60 Minutes Render Quota to this user">
                                +60m
                            </button>
                        </div>
                        <div class="text-[10px] text-zinc-400 font-mono mt-0.5">
                            Used: <span class="text-zinc-300 font-semibold">${renderMinutesUsedVal}m</span> / ${renderMinutesVal}m
                        </div>
                    ` : `
                        <div>
                            <span class="text-xs font-mono font-bold text-indigo-300">${renderMinutesVal}m</span>
                            <span class="text-[10px] text-zinc-400 font-mono block">Used: ${renderMinutesUsedVal}m</span>
                        </div>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <label class="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Toggle image generation access for this account (${userRole})">
                            <input type="checkbox" class="user-allow-image-gen-toggle w-4 h-4 text-purple-600 bg-gray-900 border-gray-600 rounded focus:ring-purple-500 cursor-pointer" data-id="${safeDocId}" ${allowImageGen ? 'checked' : ''}>
                            <span class="user-image-gen-label text-[11px] ${allowImageGen ? 'text-green-400 font-semibold' : 'text-gray-400'}">${allowImageGen ? 'Allowed' : 'Disabled'}</span>
                        </label>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${allowImageGen ? 'bg-green-900/60 text-green-300 border border-green-700' : 'bg-gray-800 text-gray-400 border border-gray-700'}">
                            ${allowImageGen ? 'Allowed' : 'Disabled'}
                        </span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <label class="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Toggle Gemini audio generation access for this account (${userRole})">
                            <input type="checkbox" class="user-allow-audio-gen-toggle w-4 h-4 text-indigo-600 bg-gray-900 border-gray-600 rounded focus:ring-indigo-500 cursor-pointer" data-id="${safeDocId}" ${allowAudioGen ? 'checked' : ''}>
                            <span class="user-audio-gen-label text-[11px] ${allowAudioGen ? 'text-green-400 font-semibold' : 'text-gray-400'}">${allowAudioGen ? 'Allowed' : 'Disabled'}</span>
                        </label>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${allowAudioGen ? 'bg-green-900/60 text-green-300 border border-green-700' : 'bg-gray-800 text-gray-400 border border-gray-700'}">
                            ${allowAudioGen ? 'Allowed' : 'Disabled'}
                        </span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <label class="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Toggle video generation (Veo / AI Video) access for this account (${userRole})">
                            <input type="checkbox" class="user-allow-video-gen-toggle w-4 h-4 text-emerald-600 bg-gray-900 border-gray-600 rounded focus:ring-emerald-500 cursor-pointer" data-id="${safeDocId}" ${allowVideoGen ? 'checked' : ''}>
                            <span class="user-video-gen-label text-[11px] ${allowVideoGen ? 'text-green-400 font-semibold' : 'text-gray-400'}">${allowVideoGen ? 'Allowed' : 'Disabled'}</span>
                        </label>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${allowVideoGen ? 'bg-green-900/60 text-green-300 border border-green-700' : 'bg-gray-800 text-gray-400 border border-gray-700'}">
                            ${allowVideoGen ? 'Allowed' : 'Disabled'}
                        </span>
                    `}
                </td>
                <td class="p-3">
                    ${currentIsAdmin ? `
                        <label class="inline-flex items-center gap-1.5 cursor-pointer select-none" title="Toggle Gemini Web Cookie access for this account (${userRole})">
                            <input type="checkbox" class="user-allow-cookie-auth-toggle w-4 h-4 text-blue-600 bg-gray-900 border-gray-600 rounded focus:ring-blue-500 cursor-pointer" data-id="${safeDocId}" ${allowCookieAuth ? 'checked' : ''}>
                            <span class="user-cookie-auth-label text-[11px] ${allowCookieAuth ? 'text-green-400 font-semibold' : 'text-gray-400'}">${allowCookieAuth ? 'Allowed' : 'Disabled'}</span>
                        </label>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${allowCookieAuth ? 'bg-green-900/60 text-green-300 border border-green-700' : 'bg-gray-800 text-gray-400 border border-gray-700'}">
                            ${allowCookieAuth ? 'Allowed' : 'Disabled'}
                        </span>
                    `}
                </td>
                <td class="p-3">
                    ${userRole === 'owner' ? `
                        <span class="px-2.5 py-1 rounded text-[11px] font-semibold uppercase bg-emerald-900/60 text-emerald-300 border border-emerald-700 inline-flex items-center gap-1 shadow-sm">
                            ✓ Approved
                        </span>
                    ` : currentIsAdmin ? `
                        <div class="flex items-center gap-1.5">
                            <select class="status-select rounded p-1 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-purple-500 ${
                                userStatusClean === 'approved' 
                                    ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-600 font-medium' 
                                    : userStatusClean === 'pending'
                                    ? 'bg-amber-950/80 text-amber-200 border border-amber-600 font-medium'
                                    : userStatusClean === 'banned'
                                    ? 'bg-rose-950/90 text-rose-200 border border-rose-600 font-semibold'
                                    : userStatusClean === 'restricted'
                                    ? 'bg-orange-950/80 text-orange-200 border border-orange-600 font-medium'
                                    : 'bg-red-950/80 text-red-200 border border-red-600 font-medium'
                            } ${isMe ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}" data-id="${safeDocId}" ${isMe ? 'disabled' : ''}>
                                <option value="pending" class="bg-gray-900 text-amber-300" ${userStatusClean === 'pending' ? 'selected' : ''}>⏳ Pending</option>
                                <option value="approved" class="bg-gray-900 text-emerald-300" ${userStatusClean === 'approved' ? 'selected' : ''}>✓ Approved</option>
                                <option value="restricted" class="bg-gray-900 text-orange-300" ${userStatusClean === 'restricted' ? 'selected' : ''}>⚠️ Restricted</option>
                                <option value="rejected" class="bg-gray-900 text-red-300" ${userStatusClean === 'rejected' ? 'selected' : ''}>✗ Rejected</option>
                                <option value="banned" class="bg-gray-900 text-rose-400 font-bold" ${userStatusClean === 'banned' ? 'selected' : ''}>🚫 Banned</option>
                            </select>
                            <span class="status-saved-badge text-[10px] text-emerald-400 font-mono font-medium ${isStatusSaved ? '' : 'hidden'}">✓ Saved</span>
                        </div>
                    ` : `
                        <span class="px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            userStatusClean === 'approved' 
                                ? 'bg-green-900/60 text-green-300 border border-green-700' 
                                : userStatusClean === 'pending' 
                                ? 'bg-amber-900/60 text-amber-300 border border-amber-700' 
                                : userStatusClean === 'banned'
                                ? 'bg-rose-950/90 text-rose-300 border border-rose-700 font-bold'
                                : 'bg-red-900/60 text-red-300 border border-red-700'
                        }">
                            ${userStatusClean === 'banned' ? '🚫 Banned' : userStatusClean === 'approved' ? '✓ Approved' : userStatusClean === 'pending' ? '⏳ Pending' : userStatusClean}
                        </span>
                    `}
                </td>
                <td class="p-3 text-right">
                    <div class="flex items-center justify-end gap-1.5 flex-wrap">
                        ${userRole === 'owner' ? `
                            <span class="text-[10px] text-amber-300/90 font-mono font-medium px-2 py-1 bg-amber-950/50 border border-amber-600/50 rounded flex items-center gap-1 shadow-sm" title="Permanent Workspace Owner cannot be deleted.">
                                👑 Permanent Owner
                            </span>
                        ` : ''}
                        ${currentIsOwner && userRole !== 'owner' && !isMe && userStatusClean === 'approved' ? `
                            <button class="transfer-ownership-btn bg-gray-900/80 hover:bg-amber-950/70 border border-gray-800 hover:border-amber-700/50 text-gray-400 hover:text-amber-300 px-2 py-1 rounded text-[11px] transition-all font-medium flex items-center gap-1 cursor-pointer opacity-70 hover:opacity-100" data-id="${safeDocId}" data-email="${safeEmail}" data-name="${safeDisplayName}" title="Transfer Workspace Ownership (Danger Zone)">
                                <svg class="w-3 h-3 text-amber-500/80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                                <span>Transfer...</span>
                            </button>
                        ` : ''}
                        ${(currentIsAdmin || currentIsReseller) && userStatusClean === 'pending' && !isMe ? `
                            <button class="approve-quick-btn ${isQuotaReached ? 'bg-gray-700 opacity-50 cursor-not-allowed text-gray-400' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} px-2.5 py-1 rounded text-xs transition-colors font-semibold cursor-pointer shadow-sm" data-id="${safeDocId}" ${isQuotaReached ? 'disabled title="Quota Reached"' : ''}>
                                ${isQuotaReached ? 'Quota Full' : '✓ Approve'}
                            </button>
                        ` : ''}
                        ${currentIsAdmin && userStatusClean === 'approved' && !isMe && userRole !== 'owner' ? `
                            <button class="quick-status-btn bg-amber-900/40 hover:bg-amber-800/70 border border-amber-600/50 text-amber-300 px-2 py-1 rounded text-[11px] transition-colors font-medium cursor-pointer" data-id="${safeDocId}" data-target-status="pending" title="Reset user status back to Pending">
                                ⏳ Set Pending
                            </button>
                            <button class="quick-status-btn bg-rose-950/60 hover:bg-rose-900/90 border border-rose-600/60 text-rose-300 px-2 py-1 rounded text-[11px] transition-colors font-medium cursor-pointer" data-id="${safeDocId}" data-target-status="banned" title="Immediately Ban this user">
                                🚫 Ban
                            </button>
                        ` : ''}
                        ${currentIsAdmin && (userStatusClean === 'banned' || userStatusClean === 'rejected' || userStatusClean === 'restricted') && !isMe && userRole !== 'owner' ? `
                            <button class="quick-status-btn bg-emerald-900/60 hover:bg-emerald-800 border border-emerald-600/60 text-emerald-300 px-2 py-1 rounded text-[11px] transition-colors font-medium cursor-pointer" data-id="${safeDocId}" data-target-status="approved" title="Unban / Approve this user">
                                ✓ Approve
                            </button>
                            <button class="quick-status-btn bg-amber-900/40 hover:bg-amber-800/70 border border-amber-600/50 text-amber-300 px-2 py-1 rounded text-[11px] transition-colors font-medium cursor-pointer" data-id="${safeDocId}" data-target-status="pending" title="Reset user status back to Pending">
                                ⏳ Set Pending
                            </button>
                        ` : ''}
                        ${currentIsReseller && userStatusClean === 'approved' && !isMe && !currentIsAdmin && userRole === 'user' ? `
                            <button class="reject-user-btn bg-amber-900/40 hover:bg-amber-800/80 border border-amber-700/50 text-amber-300 px-2 py-1 rounded text-xs transition-colors font-medium cursor-pointer" data-id="${safeDocId}">
                                Revoke
                            </button>
                        ` : ''}
                        ${currentIsAdmin && !isMe && userRole !== 'owner' ? `
                            <button class="delete-user-btn bg-red-900/40 hover:bg-red-800/80 border border-red-700/50 text-red-300 px-2.5 py-1 rounded text-xs transition-colors font-medium flex items-center gap-1 cursor-pointer" data-id="${safeDocId}" data-email="${safeEmail}">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                Delete
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
            dom.adminUsersList.appendChild(tr);
        });

        if (dom.adminUserCount) {
            dom.adminUserCount.textContent = String(renderedCount);
        }

        if (renderedCount === 0) {
            dom.adminUsersList.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-400">No users found under your account.</td></tr>';
        }

        // Add event listeners to buttons and inputs
        dom.adminUsersList.querySelectorAll('.username-admin-input').forEach(inputEl => {
            inputEl.addEventListener('input', (e) => {
                const input = e.currentTarget as HTMLInputElement;
                const userId = input.dataset.id!;
                const btn = dom.adminUsersList.querySelector(`.save-username-admin-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (btn) {
                    btn.textContent = 'Save';
                    btn.disabled = false;
                    btn.className = 'save-username-admin-btn bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded text-xs transition-colors font-medium flex-shrink-0 cursor-pointer';
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.save-username-admin-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.username-admin-input[data-id="${userId}"]`) as HTMLInputElement;
                if (!input) return;
                const newName = input.value.trim();
                if (!newName) return;
                try {
                    target.textContent = '...';
                    target.disabled = true;
                    
                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, username: Date.now() + 2500 });
                    
                    await updateDoc(doc(db, 'users', userId), {
                        displayName: newName,
                        updatedAt: serverTimestamp()
                    });
                    input.dataset.saved = newName;
                    target.textContent = 'Saved ✓';
                    target.disabled = false;
                    target.className = 'save-username-admin-btn bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs transition-colors font-medium flex-shrink-0 cursor-pointer';
                } catch (err) {
                    console.error("Failed to update user name:", err);
                    target.textContent = 'Error';
                    target.disabled = false;
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.clean-spam-name-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const fallbackEmail = target.dataset.fallback || '';
                const cleanName = (fallbackEmail ? fallbackEmail.split('@')[0] : 'User');
                try {
                    target.textContent = '...';
                    target.disabled = true;
                    await updateDoc(doc(db, 'users', userId), {
                        displayName: cleanName,
                        updatedAt: serverTimestamp()
                    });
                    ui.showStatus(`Cleaned display name to "${cleanName}"`, false, 3000);
                } catch (err) {
                    console.error("Failed to clean username:", err);
                    ui.showStatus("Failed to clean username", true, 3000);
                    target.textContent = 'Clean';
                    target.disabled = false;
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.quota-input').forEach(inputEl => {
            inputEl.addEventListener('input', (e) => {
                const input = e.currentTarget as HTMLInputElement;
                const userId = input.dataset.id!;
                const btn = dom.adminUsersList.querySelector(`.save-quota-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (btn) {
                    btn.textContent = 'Save';
                    btn.disabled = false;
                    btn.className = 'save-quota-btn bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded text-xs transition-colors font-medium cursor-pointer';
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.save-quota-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.quota-input[data-id="${userId}"]`) as HTMLInputElement;
                if (!input) return;
                const newQuota = parseInt(input.value.trim(), 10);
                if (isNaN(newQuota) || newQuota < 1) return;
                try {
                    target.textContent = '...';
                    target.disabled = true;
                    
                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, quota: Date.now() + 2500 });
                    
                    await updateDoc(doc(db, 'users', userId), {
                        maxApprovedUsers: newQuota,
                        updatedAt: serverTimestamp()
                    });
                    input.dataset.saved = String(newQuota);
                    target.textContent = 'Saved ✓';
                    target.disabled = false;
                    target.className = 'save-quota-btn bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs transition-colors font-medium cursor-pointer';
                } catch (err) {
                    console.error("Failed to update reseller quota:", err);
                    target.textContent = 'Error';
                    target.disabled = false;
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.credits-input').forEach(inputEl => {
            inputEl.addEventListener('input', (e) => {
                const input = e.currentTarget as HTMLInputElement;
                const userId = input.dataset.id!;
                const btn = dom.adminUsersList.querySelector(`.save-credits-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (btn) {
                    btn.textContent = 'Save';
                    btn.disabled = false;
                    btn.className = 'save-credits-btn bg-amber-600 hover:bg-amber-500 text-black font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.save-credits-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.credits-input[data-id="${userId}"]`) as HTMLInputElement;
                if (!input) return;
                const newCredits = parseInt(input.value.trim(), 10);
                if (isNaN(newCredits) || newCredits < 0) return;

                try {
                    target.textContent = '...';
                    target.disabled = true;
                    
                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, credits: Date.now() + 2500 });
                    
                    await updateDoc(doc(db, 'users', userId), {
                        credits: newCredits,
                        updatedAt: serverTimestamp()
                    });

                    // Sync local state if giving credits to self
                    if (currentUser && currentUser.uid === userId) {
                        state.userCredits = newCredits;
                        localStorage.setItem('userCredits', String(newCredits));
                        if (dom.userCreditsDisplay) {
                            ui.updateCreditsDisplay();
                        }
                    }

                    input.dataset.saved = String(newCredits);
                    target.textContent = 'Saved ✓';
                    target.disabled = false;
                    target.className = 'save-credits-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    ui.showStatus(`Updated credits to ${newCredits.toLocaleString()}!`, false, 2500);
                } catch (err: any) {
                    console.error("Failed to update user credits:", err);
                    target.textContent = 'Error';
                    target.disabled = false;
                    target.className = 'save-credits-btn bg-rose-600 hover:bg-rose-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    ui.showStatus(err.message || "Failed to update credits.", true, 3000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.quick-add-10k-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.credits-input[data-id="${userId}"]`) as HTMLInputElement;
                const saveBtn = dom.adminUsersList.querySelector(`.save-credits-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (!input) return;
                const currentVal = parseInt(input.value.trim(), 10) || 0;
                const newCredits = currentVal + 10000;
                input.value = String(newCredits);

                try {
                    target.textContent = '...';
                    target.disabled = true;
                    
                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, credits: Date.now() + 2500 });
                    
                    await updateDoc(doc(db, 'users', userId), {
                        credits: newCredits,
                        updatedAt: serverTimestamp()
                    });

                    // Sync local state if giving credits to self
                    if (currentUser && currentUser.uid === userId) {
                        state.userCredits = newCredits;
                        localStorage.setItem('userCredits', String(newCredits));
                        if (dom.userCreditsDisplay) {
                            ui.updateCreditsDisplay();
                        }
                    }

                    input.dataset.saved = String(newCredits);
                    if (saveBtn) {
                        saveBtn.textContent = 'Saved ✓';
                        saveBtn.className = 'save-credits-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    }

                    target.textContent = '+10k ✓';
                    ui.showStatus(`Granted +10,000 credits (Total: ${newCredits.toLocaleString()})`, false, 2500);
                    setTimeout(() => {
                        target.textContent = '+10k';
                        target.disabled = false;
                    }, 1500);
                } catch (err: any) {
                    console.error("Failed to add credits:", err);
                    target.textContent = 'Err';
                    target.disabled = false;
                    ui.showStatus(err.message || "Failed to add credits.", true, 3000);
                }
            });
        });

        // Cloud Render Minutes inputs and actions
        dom.adminUsersList.querySelectorAll('.render-minutes-input').forEach(inputEl => {
            inputEl.addEventListener('input', (e) => {
                const input = e.currentTarget as HTMLInputElement;
                const userId = input.dataset.id!;
                const btn = dom.adminUsersList.querySelector(`.save-render-minutes-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (btn) {
                    btn.textContent = 'Save';
                    btn.disabled = false;
                    btn.className = 'save-render-minutes-btn bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.save-render-minutes-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.render-minutes-input[data-id="${userId}"]`) as HTMLInputElement;
                if (!input) return;
                const newMinutes = parseInt(input.value.trim(), 10);
                if (isNaN(newMinutes) || newMinutes < 0) return;

                try {
                    target.textContent = '...';
                    target.disabled = true;

                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, renderMinutes: Date.now() + 2500 });

                    await updateDoc(doc(db, 'users', userId), {
                        renderMinutesQuota: newMinutes,
                        updatedAt: serverTimestamp()
                    });

                    // Sync local state if giving minutes to self
                    if (currentUser && currentUser.uid === userId) {
                        state.renderMinutesQuota = newMinutes;
                    }

                    input.dataset.saved = String(newMinutes);
                    target.textContent = 'Saved ✓';
                    target.disabled = false;
                    target.className = 'save-render-minutes-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    ui.showStatus(`Updated cloud render quota to ${newMinutes} minutes!`, false, 2500);
                } catch (err: any) {
                    console.error("Failed to update render minutes quota:", err);
                    target.textContent = 'Error';
                    target.disabled = false;
                    target.className = 'save-render-minutes-btn bg-rose-600 hover:bg-rose-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    ui.showStatus(err.message || "Failed to update cloud render quota.", true, 3000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.quick-add-60m-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const input = dom.adminUsersList.querySelector(`.render-minutes-input[data-id="${userId}"]`) as HTMLInputElement;
                const saveBtn = dom.adminUsersList.querySelector(`.save-render-minutes-btn[data-id="${userId}"]`) as HTMLButtonElement;
                if (!input) return;
                const currentVal = parseInt(input.value.trim(), 10) || 0;
                const newMinutes = currentVal + 60;
                input.value = String(newMinutes);

                try {
                    target.textContent = '...';
                    target.disabled = true;

                    const transientState = pendingSaveVisuals.get(userId) || {};
                    pendingSaveVisuals.set(userId, { ...transientState, renderMinutes: Date.now() + 2500 });

                    await updateDoc(doc(db, 'users', userId), {
                        renderMinutesQuota: newMinutes,
                        updatedAt: serverTimestamp()
                    });

                    if (currentUser && currentUser.uid === userId) {
                        state.renderMinutesQuota = newMinutes;
                    }

                    input.dataset.saved = String(newMinutes);
                    if (saveBtn) {
                        saveBtn.textContent = 'Saved ✓';
                        saveBtn.className = 'save-render-minutes-btn bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-2 py-1 rounded text-xs transition-colors flex-shrink-0 cursor-pointer';
                    }

                    target.textContent = '+60m ✓';
                    ui.showStatus(`Granted +60 minutes cloud render quota! (Total: ${newMinutes}m)`, false, 2500);
                    setTimeout(() => {
                        target.textContent = '+60m';
                        target.disabled = false;
                    }, 1500);
                } catch (err: any) {
                    console.error("Failed to add render minutes:", err);
                    target.textContent = 'Err';
                    target.disabled = false;
                    ui.showStatus(err.message || "Failed to add render minutes.", true, 3000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.user-allow-image-gen-toggle').forEach(checkboxEl => {
            checkboxEl.addEventListener('change', async (e) => {
                const target = e.target as HTMLInputElement;
                const userId = target.dataset.id!;
                const isAllowed = target.checked;
                const label = target.parentElement?.querySelector('.user-image-gen-label');
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        allowImageGeneration: isAllowed,
                        updatedAt: serverTimestamp()
                    });
                    if (currentUser && currentUser.uid === userId && userRecord) {
                        userRecord.allowImageGeneration = isAllowed;
                    }
                    if (label) {
                        label.textContent = isAllowed ? 'Allowed' : 'Disabled';
                        label.className = `user-image-gen-label text-[11px] ${isAllowed ? 'text-green-400 font-semibold' : 'text-gray-400'}`;
                    }
                } catch (err: any) {
                    console.error("Failed to update user image generation access:", err);
                    target.checked = !isAllowed;
                    ui.showStatus("Failed to update image generation access: " + (err.message || err), true, 4000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.user-allow-audio-gen-toggle').forEach(checkboxEl => {
            checkboxEl.addEventListener('change', async (e) => {
                const target = e.target as HTMLInputElement;
                const userId = target.dataset.id!;
                const isAllowed = target.checked;
                const label = target.parentElement?.querySelector('.user-audio-gen-label');
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        allowAudioGeneration: isAllowed,
                        updatedAt: serverTimestamp()
                    });
                    if (currentUser && currentUser.uid === userId && userRecord) {
                        userRecord.allowAudioGeneration = isAllowed;
                    }
                    if (label) {
                        label.textContent = isAllowed ? 'Allowed' : 'Disabled';
                        label.className = `user-audio-gen-label text-[11px] ${isAllowed ? 'text-green-400 font-semibold' : 'text-gray-400'}`;
                    }
                } catch (err: any) {
                    console.error("Failed to update user audio generation access:", err);
                    target.checked = !isAllowed;
                    ui.showStatus("Failed to update audio generation access: " + (err.message || err), true, 4000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.user-allow-video-gen-toggle').forEach(checkboxEl => {
            checkboxEl.addEventListener('change', async (e) => {
                const target = e.target as HTMLInputElement;
                const userId = target.dataset.id!;
                const isAllowed = target.checked;
                const label = target.parentElement?.querySelector('.user-video-gen-label');
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        allowVideoGeneration: isAllowed,
                        updatedAt: serverTimestamp()
                    });
                    if (currentUser && currentUser.uid === userId && userRecord) {
                        userRecord.allowVideoGeneration = isAllowed;
                    }
                    if (label) {
                        label.textContent = isAllowed ? 'Allowed' : 'Disabled';
                        label.className = `user-video-gen-label text-[11px] ${isAllowed ? 'text-green-400 font-semibold' : 'text-gray-400'}`;
                    }
                } catch (err: any) {
                    console.error("Failed to update user video generation access:", err);
                    target.checked = !isAllowed;
                    ui.showStatus("Failed to update video generation access: " + (err.message || err), true, 4000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.user-allow-cookie-auth-toggle').forEach(checkboxEl => {
            checkboxEl.addEventListener('change', async (e) => {
                const target = e.target as HTMLInputElement;
                const userId = target.dataset.id!;
                const isAllowed = target.checked;
                const label = target.parentElement?.querySelector('.user-cookie-auth-label');
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        allowCookieAuth: isAllowed,
                        updatedAt: serverTimestamp()
                    });
                    if (currentUser && currentUser.uid === userId && userRecord) {
                        userRecord.allowCookieAuth = isAllowed;
                        ui.updateGeminiApiKeyUiState();
                    }
                    if (label) {
                        label.textContent = isAllowed ? 'Allowed' : 'Disabled';
                        label.className = `user-cookie-auth-label text-[11px] ${isAllowed ? 'text-green-400 font-semibold' : 'text-gray-400'}`;
                    }
                    ui.showStatus(`Cookie API permission ${isAllowed ? 'enabled' : 'disabled'} for user.`, false, 2500);
                } catch (err: any) {
                    console.error("Failed to update user cookie access:", err);
                    target.checked = !isAllowed;
                    ui.showStatus("Failed to update cookie access: " + (err.message || err), true, 4000);
                }
            });
        });

        dom.adminUsersList.querySelectorAll('.role-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const target = e.target as HTMLSelectElement;
                const userId = target.dataset.id!;
                const badge = target.parentElement?.querySelector('.role-saved-badge') as HTMLElement | null;
                if (badge) {
                    badge.textContent = 'Saving...';
                    badge.classList.remove('hidden');
                }
                const transientState = pendingSaveVisuals.get(userId) || {};
                pendingSaveVisuals.set(userId, { ...transientState, role: Date.now() + 3000 });
                await updateUserRole(userId, target.value);
                if (badge) {
                    badge.textContent = '✓ Saved';
                    setTimeout(() => badge?.classList.add('hidden'), 2500);
                }
            });
        });
        
        dom.adminUsersList.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const target = e.target as HTMLSelectElement;
                const userId = target.dataset.id!;
                const badge = target.parentElement?.querySelector('.status-saved-badge') as HTMLElement | null;
                if (badge) {
                    badge.textContent = 'Saving...';
                    badge.classList.remove('hidden');
                }
                const transientState = pendingSaveVisuals.get(userId) || {};
                pendingSaveVisuals.set(userId, { ...transientState, status: Date.now() + 3000 });
                await updateUserStatus(userId, target.value);
                if (badge) {
                    badge.textContent = '✓ Saved';
                    setTimeout(() => badge?.classList.add('hidden'), 2500);
                }
            });
        });
        
        dom.adminUsersList.querySelectorAll('.approve-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                if (target.disabled) return;
                approveUserWithResellerCheck(target.dataset.id!, approvedByMe, maxQuota, currentIsReseller, currentIsAdmin);
            });
        });

        dom.adminUsersList.querySelectorAll('.quick-status-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const targetStatus = target.dataset.targetStatus || 'approved';
                target.disabled = true;
                await updateUserStatus(userId, targetStatus);
            });
        });

        dom.adminUsersList.querySelectorAll('.reject-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                updateUserStatus(target.dataset.id!, 'rejected');
            });
        });

        dom.adminUsersList.querySelectorAll('.transfer-ownership-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const userId = target.dataset.id!;
                const userEmail = target.dataset.email || '';
                const userName = target.dataset.name || userEmail;
                openTransferOwnershipModal(userId, userEmail, userName);
            });
        });

        dom.adminUsersList.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                deleteUserRecord(target.dataset.id!, target.dataset.email || '');
            });
        });
    }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'users');
    });

    setAdminUsersUnsubscribe(unsub);
}

export function closeAdminPanel() {
    clearAdminAddUserMsg();
    if (dom.adminPanel) dom.adminPanel.classList.add('hidden');
    if (adminUsersUnsubscribe) {
        adminUsersUnsubscribe();
        setAdminUsersUnsubscribe(null);
    }
}

function openTransferOwnershipModal(userId: string, userEmail: string, userName: string) {
    let modal = document.getElementById('transfer-ownership-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'transfer-ownership-modal';
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in';
    
    const safeUserName = ui.escapeHtml(userName);
    const safeUserEmail = ui.escapeHtml(userEmail);

    modal.innerHTML = `
        <div class="bg-gray-900 border border-amber-800/80 rounded-2xl max-w-md w-full p-6 shadow-2xl text-gray-100 space-y-5 relative overflow-hidden">
            <div class="absolute -top-12 -right-12 w-32 h-32 bg-amber-600/10 rounded-full blur-2xl pointer-events-none"></div>
            
            <div class="flex items-center gap-3 border-b border-gray-800 pb-4">
                <div class="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-600/50 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                </div>
                <div>
                    <h3 class="text-base font-bold text-amber-200 tracking-wide">Danger Zone: Transfer Ownership</h3>
                    <p class="text-xs text-amber-400/80">Permanent Workspace Role Change</p>
                </div>
            </div>

            <div class="bg-amber-950/30 border border-amber-800/40 rounded-xl p-3.5 text-xs text-amber-200/90 leading-relaxed space-y-2">
                <p>Transfer full <strong>Workspace Ownership</strong> to:</p>
                <div class="bg-gray-950/90 p-2.5 rounded-lg border border-amber-900/50 font-mono text-amber-300 flex items-center justify-between text-[11px]">
                    <span class="font-semibold">${safeUserName}</span>
                    <span class="text-gray-400">${safeUserEmail}</span>
                </div>
                <ul class="list-disc list-inside space-y-1 text-gray-300 pt-1 text-[11px]">
                    <li>This user will become the permanent primary Owner.</li>
                    <li>Your account will become an Administrator.</li>
                    <li>You will no longer be able to delete or demote this account.</li>
                </ul>
            </div>

            <div class="space-y-2">
                <label class="block text-xs font-medium text-gray-300">
                    Type <code class="bg-gray-950 px-1.5 py-0.5 rounded text-amber-400 font-mono border border-gray-800">TRANSFER</code> to confirm:
                </label>
                <input type="text" id="transfer-confirm-input" placeholder="TRANSFER" class="w-full bg-gray-950 border border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono" />
            </div>

            <div class="flex items-center justify-end gap-3 pt-1">
                <button type="button" id="transfer-cancel-btn" class="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="transfer-submit-btn" disabled class="px-4 py-2 rounded-xl text-xs font-semibold bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed transition-all flex items-center gap-2">
                    <span>Confirm Transfer</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const input = modal.querySelector('#transfer-confirm-input') as HTMLInputElement;
    const submitBtn = modal.querySelector('#transfer-submit-btn') as HTMLButtonElement;
    const cancelBtn = modal.querySelector('#transfer-cancel-btn') as HTMLButtonElement;

    input?.focus();

    input?.addEventListener('input', () => {
        const val = input.value.trim();
        if (val === 'TRANSFER' || val.toLowerCase() === userEmail.toLowerCase()) {
            submitBtn.disabled = false;
            submitBtn.className = 'px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/40 border border-amber-400 transition-all cursor-pointer flex items-center gap-2';
        } else {
            submitBtn.disabled = true;
            submitBtn.className = 'px-4 py-2 rounded-xl text-xs font-semibold bg-gray-800 text-gray-500 border border-gray-700 cursor-not-allowed transition-all flex items-center gap-2';
        }
    });

    cancelBtn?.addEventListener('click', () => {
        modal?.remove();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    submitBtn?.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Transferring...';
        modal?.remove();
        await transferOwnership(userId, userEmail, userName);
    });
}
