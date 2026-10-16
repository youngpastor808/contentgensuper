import { registerSyncUserCredits, registerSpendCreditsSecure } from '../authBridge';
import firebaseConfig from '../../firebase-applet-config.json';
import {
    auth,
    db,
    GoogleAuthProvider,
    signInWithCredential,
    onAuthStateChanged,
    handleFirestoreError,
    OperationType
} from '../firebase';
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    onSnapshot,
    serverTimestamp,
    addDoc
} from 'firebase/firestore';
import * as dom from '../dom';
import * as ui from '../ui';
import { state } from '../state';
import { restoreApiKeysFromCloudOrDB } from '../apiKeysBootstrap';
import { initSystemConfigListener } from '../handlers-admin-system';

// Import and re-export submodule functions and state
export * from './session';
import {
    currentUser,
    userRecord,
    isGuestMode,
    SUPER_ADMIN_EMAILS,
    SUPER_ADMIN_EMAIL,
    isUserOwner,
    isUserAdmin,
    isUserReseller,
    isUserManager,
    isImageGenAllowedForCurrentUser,
    isAudioGenAllowedForCurrentUser,
    isVideoGenAllowedForCurrentUser,
    isDesktopApp,
    isGuest,
    isApprovedMember,
    sha256Hex,
    formatAuthErrorMessage,
    openLoginModal,
    showAuthError,
    showAuthSuccess,
    hideAuthError,
    clearAdminAddUserMsg,
    showAdminAddUserMsg,
    userDocUnsubscribe,
    setUserDocUnsubscribe,
    setCurrentUser,
    setUserRecord,
    setIsGuestMode
} from './session';

import {
    queueOfflineSpend,
    flushPendingSpends,
    getFirebaseIdToken,
    spendCreditsSecure,
    syncUserCredits,
    recordRenderMinutesUsageSecure,
    refundRenderMinutesSecure
} from './credits';

import {
    verifyDesktopStudioPassword,
    loginAsLocalUser,
    handleDesktopLogin,
    enforceDesktopOfflineRestrictions
} from './desktop';

import {
    handleGuestLogin,
    showGuestRestrictionModal,
    checkGuestRestriction
} from './guest';

import {
    handleLogin,
    handleEmailLogin,
    handleEmailSignup,
    handlePasswordReset,
    handleLogout,
    handleCheckApprovalStatus,
    checkAndCreateUser,
    goBackToHome
} from './providers';

import {
    updateAuthUI,
    openProfileModal,
    closeProfileModal,
    handleSaveProfile,
    toggleProfilePasswordFields,
    toggleProfilePasswordVisibility,
    handleSendPasswordResetEmailFromProfile,
    handleSetOrUpdatePassword
} from './profile-ui';

import {
    recordDeletedUserEmail,
    normalizeEmail,
    getEmailTypoWarning,
    TYPO_DOMAINS,
    cleanupDuplicateUserDocs,
    syncKnownAuthUsers,
    restoreOwnerAccountsIfDeleted
} from './dedup';

import {
    approveUserWithResellerCheck,
    handleAdminAddUser,
    deleteUserRecord,
    updateUserStatus,
    updateUserRole,
    setUserRoleCloud,
    promoteUserToOwner,
    transferOwnership
} from './admin-users';

import {
    openAdminPanel,
    closeAdminPanel
} from './admin-panel';

// Re-export all public symbols for consumers
export {
    currentUser,
    userRecord,
    isGuestMode,
    SUPER_ADMIN_EMAILS,
    SUPER_ADMIN_EMAIL,
    isUserAdmin,
    isUserReseller,
    isUserManager,
    isImageGenAllowedForCurrentUser,
    isAudioGenAllowedForCurrentUser,
    isVideoGenAllowedForCurrentUser,
    isDesktopApp,
    isGuest,
    isApprovedMember,
    sha256Hex,
    formatAuthErrorMessage,
    openLoginModal,
    showAuthError,
    showAuthSuccess,
    hideAuthError,
    clearAdminAddUserMsg,
    showAdminAddUserMsg,
    queueOfflineSpend,
    flushPendingSpends,
    getFirebaseIdToken,
    spendCreditsSecure,
    syncUserCredits,
    recordRenderMinutesUsageSecure,
    refundRenderMinutesSecure,
    verifyDesktopStudioPassword,
    loginAsLocalUser,
    handleDesktopLogin,
    enforceDesktopOfflineRestrictions,
    handleGuestLogin,
    showGuestRestrictionModal,
    checkGuestRestriction,
    handleLogin,
    handleEmailLogin,
    handleEmailSignup,
    handlePasswordReset,
    handleLogout,
    handleCheckApprovalStatus,
    checkAndCreateUser,
    goBackToHome,
    updateAuthUI,
    openProfileModal,
    closeProfileModal,
    handleSaveProfile,
    toggleProfilePasswordFields,
    toggleProfilePasswordVisibility,
    handleSendPasswordResetEmailFromProfile,
    handleSetOrUpdatePassword,
    recordDeletedUserEmail,
    normalizeEmail,
    getEmailTypoWarning,
    TYPO_DOMAINS,
    cleanupDuplicateUserDocs,
    syncKnownAuthUsers,
    restoreOwnerAccountsIfDeleted,
    approveUserWithResellerCheck,
    handleAdminAddUser,
    deleteUserRecord,
    updateUserStatus,
    updateUserRole,
    setUserRoleCloud,
    promoteUserToOwner,
    transferOwnership,
    openAdminPanel,
    closeAdminPanel
};

function initGSI() {
    const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID || (firebaseConfig as any)?.oAuthClientId;
    if (!clientId) {
        console.warn("Google OAuth Client ID is not set. Falling back to signInWithPopup.");
        return;
    }

    const checkAndInit = () => {
        const google = (window as any).google;
        if (google && google.accounts && google.accounts.id) {
            google.accounts.id.initialize({
                client_id: clientId,
                callback: async (response: any) => {
                    hideAuthError();
                    try {
                        const credential = GoogleAuthProvider.credential(response.credential);
                        await signInWithCredential(auth, credential);
                        setIsGuestMode(false);
                        hideAuthError();
                        if (dom.authOverlay) dom.authOverlay.classList.add('hidden');
                    } catch (error: any) {
                        console.warn("GSI Login failed", error);
                        const isApiKeyError = error?.code === 'auth/api-key-not-found' ||
                            error?.code === 'auth/invalid-api-key' ||
                            (typeof error?.message === 'string' && (error.message.includes('api-key-not-found') || error.message.includes('API Key not found') || error.message.includes('API key not valid')));
                        if (isApiKeyError && response?.credential) {
                            try {
                                const base64Url = response.credential.split('.')[1];
                                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                                const jsonPayload = decodeURIComponent(atob(base64).split('').map((c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
                                const decoded = JSON.parse(jsonPayload);
                                if (decoded?.email) {
                                    ui.showStatus("Firebase Auth cloud key restricted. Connected via verified Google identity!", false, 4000);
                                    loginAsLocalUser(decoded.email, decoded.name);
                                    return;
                                }
                            } catch (jwtErr) {
                                console.warn("GSI credential fallback error:", jwtErr);
                            }
                        }
                        showAuthError(formatAuthErrorMessage(error));
                    }
                }
            });

            if (dom.gsiButtonContainer && !dom.authActionBtn) {
                google.accounts.id.renderButton(
                    dom.gsiButtonContainer,
                    { theme: "filled_blue", size: "large", type: "standard", shape: "rectangular", text: "continue_with", width: 250 }
                );
                dom.gsiButtonContainer.classList.remove('hidden');
            }
        } else {
            setTimeout(checkAndInit, 100);
        }
    };
    checkAndInit();
}

export function initAuth() {
    initGSI();
    initSystemConfigListener();
    restoreOwnerAccountsIfDeleted().catch(err => console.debug("Initial owner restoration note:", err));
    
    onAuthStateChanged(auth, async (user) => {
        setCurrentUser(user);
        if (user) {
            setIsGuestMode(false);
            localStorage.removeItem('local_auth_session');
        }
        
        if (userDocUnsubscribe) {
            userDocUnsubscribe();
            setUserDocUnsubscribe(null);
        }

        if (user) {
            try {
                await checkAndCreateUser(user);
                restoreApiKeysFromCloudOrDB();
                await flushPendingSpends();
                updateAuthUI();
            } catch (err) {
                console.error("Critical error during user initialization:", err);
                ui.showStatus("Error loading user profile. Please refresh or contact admin.", true, 5000);
            }
            
            // Listen to ongoing changes
            const unsub = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
                if (docSnap.exists()) {
                    const record = docSnap.data();
                    setUserRecord(record);
                    if (record.credits !== undefined && typeof record.credits === 'number') {
                        state.userCredits = record.credits;
                        localStorage.setItem('userCredits', String(record.credits));
                        dom.userCreditsDisplay && ui.updateCreditsDisplay();
                    }
                    if (record.renderMinutesQuota !== undefined && typeof record.renderMinutesQuota === 'number') {
                        state.renderMinutesQuota = record.renderMinutesQuota;
                    }
                    if (record.renderMinutesUsed !== undefined && typeof record.renderMinutesUsed === 'number') {
                        state.renderMinutesUsed = record.renderMinutesUsed;
                    }
                    updateAuthUI();
                }
            }, (err) => {
                handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
            });
            setUserDocUnsubscribe(unsub);
        } else if (!isGuestMode) {
            // Check for local auth session fallback
            const savedSession = localStorage.getItem('local_auth_session');
            if (savedSession) {
                try {
                    const parsed = JSON.parse(savedSession);
                    if (parsed?.user?.email) {
                        const cleanEmail = parsed.user.email.toLowerCase().trim();
                        const isAdmin = isUserAdmin(parsed.user, parsed.record);

                        if (state.systemConfig?.disableDesktopOfflineMode && !isAdmin) {
                            localStorage.removeItem('local_auth_session');
                            setUserRecord(null);
                            setCurrentUser(null);
                            openLoginModal();
                            return;
                        }

                        setCurrentUser(parsed.user);

                        const savedCredits = localStorage.getItem('userCredits');
                        const creditsNum = savedCredits !== null && !isNaN(Number(savedCredits))
                            ? Number(savedCredits)
                            : (parsed.record?.credits ?? 10000);

                        const isOwner = isUserOwner(parsed.user, parsed.record);
                        const effectiveRole = isOwner ? 'owner' : (parsed.record?.role || (isAdmin ? 'admin' : 'user'));
                        const rec = parsed.record || {
                            email: cleanEmail,
                            displayName: parsed.user.displayName || cleanEmail.split('@')[0],
                            status: 'approved',
                            role: effectiveRole,
                            credits: creditsNum,
                        };
                        rec.role = effectiveRole;
                        rec.status = rec.status || 'approved';
                        rec.credits = creditsNum;
                        setUserRecord(rec);

                        state.userCredits = creditsNum;
                        localStorage.setItem('userCredits', String(creditsNum));
                        if (dom.userCreditsDisplay) ui.updateCreditsDisplay();

                        // Sync user doc from Firestore if available
                        getDoc(doc(db, 'users', parsed.user.uid)).then(docSnap => {
                            if (docSnap.exists()) {
                                const data = docSnap.data();
                                const updatedRec = { ...(userRecord || {}), ...data };
                                setUserRecord(updatedRec);
                                try {
                                    parsed.record = updatedRec;
                                    localStorage.setItem('local_auth_session', JSON.stringify(parsed));
                                } catch {}
                                if (data.credits !== undefined && typeof data.credits === 'number') {
                                    state.userCredits = data.credits;
                                    localStorage.setItem('userCredits', String(data.credits));
                                    if (dom.userCreditsDisplay) ui.updateCreditsDisplay();
                                }
                                updateAuthUI();
                            }
                        }).catch(e => console.warn("Firestore sync notice:", e));
                    }
                } catch (e) {
                    console.warn("Error restoring local auth session:", e);
                }
                updateAuthUI();
            } else {
                // Do not automatically provide a Guest session, prompt for login instead
                openLoginModal();
            }
        }
    });

    dom.loginBtn?.addEventListener('click', openLoginModal);
    dom.loginBtnMobile?.addEventListener('click', openLoginModal);
    dom.logoutBtn?.addEventListener('click', handleLogout);
    dom.logoutBtnMobile?.addEventListener('click', handleLogout);
    dom.authActionBtn?.addEventListener('click', handleLogin);
    dom.authLogoutBtn?.addEventListener('click', handleLogout);
    dom.authAdminBtn?.addEventListener('click', openAdminPanel);
    dom.adminNavBtn?.addEventListener('click', openAdminPanel);
    dom.adminCloseBtn?.addEventListener('click', closeAdminPanel);
    dom.adminAddUserBtn?.addEventListener('click', handleAdminAddUser);
    dom.adminTestDuplicateBtn?.addEventListener('click', async () => {
        if (!dom.adminTestDuplicateBtn) return;
        dom.adminTestDuplicateBtn.disabled = true;
        dom.adminTestDuplicateBtn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> Adding...';
        try {
            const testEmail = 'test.duplicate@example.com';
            const testPayload: any = {
                email: testEmail,
                displayName: 'Test Duplicate Account',
                role: 'user',
                status: 'pending',
                credits: 500,
                assignedBy: currentUser?.email || 'admin',
                createdByAdmin: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            const newDocRef = await addDoc(collection(db, 'users'), testPayload);
            console.log(`[Test Duplicate] Created test document ${newDocRef.id} for ${testEmail}`);
            showAdminAddUserMsg(`Created test duplicate profile for "${testEmail}" (Doc ID: ${newDocRef.id.slice(0, 8)}...). Click 'Scan Duplicates' to test scanner and consolidation!`, "info", 8000);
        } catch (err: any) {
            console.error("Failed to create test duplicate:", err);
            showAdminAddUserMsg("Failed to create test duplicate: " + (err?.message || err), "error", 5000);
        } finally {
            if (dom.adminTestDuplicateBtn) {
                dom.adminTestDuplicateBtn.disabled = false;
                dom.adminTestDuplicateBtn.textContent = '+ Test Dup';
            }
        }
    });

    dom.adminCleanDuplicatesBtn?.addEventListener('click', async () => {
        if (dom.adminCleanDuplicatesBtn) {
            dom.adminCleanDuplicatesBtn.disabled = true;
            dom.adminCleanDuplicatesBtn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> Scanning...';
        }
        try {
            await cleanupDuplicateUserDocs(true);
        } finally {
            if (dom.adminCleanDuplicatesBtn && !dom.adminCleanDuplicatesBtn.getAttribute('data-temp-status')) {
                dom.adminCleanDuplicatesBtn.disabled = false;
                dom.adminCleanDuplicatesBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg> <span>Scan Duplicates</span>`;
            }
        }
    });

    dom.adminSyncAuthBtn?.addEventListener('click', async () => {
        if (dom.adminSyncAuthBtn) {
            dom.adminSyncAuthBtn.disabled = true;
            dom.adminSyncAuthBtn.innerHTML = '<span class="inline-block animate-spin mr-1">🔄</span> Syncing...';
        }
        try {
            showAdminAddUserMsg("Verifying and syncing user profiles with Firebase Auth...", "info", 0);
            const count = await syncKnownAuthUsers(true);
            showAdminAddUserMsg(
                count > 0 
                    ? `Auth sync complete: Synchronized ${count} profile(s).` 
                    : `Auth sync complete: All verified accounts are up to date.`,
                "success", 
                5000
            );
            if (dom.adminSyncAuthBtn) {
                dom.adminSyncAuthBtn.setAttribute('data-temp-status', 'true');
                dom.adminSyncAuthBtn.innerHTML = '<span class="text-emerald-400 font-bold">✓ Synced</span>';
                setTimeout(() => {
                    if (dom.adminSyncAuthBtn) {
                        dom.adminSyncAuthBtn.removeAttribute('data-temp-status');
                        dom.adminSyncAuthBtn.disabled = false;
                        dom.adminSyncAuthBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Sync Auth Accounts</span>`;
                    }
                }, 3000);
            }
        } catch (err: any) {
            showAdminAddUserMsg("Sync error: " + (err?.message || err), "error", 5000);
        } finally {
            if (dom.adminSyncAuthBtn && !dom.adminSyncAuthBtn.getAttribute('data-temp-status')) {
                dom.adminSyncAuthBtn.disabled = false;
                dom.adminSyncAuthBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Sync Auth Accounts</span>`;
            }
        }
    });

    // Dropdown toggle
    dom.userProfileDisplay?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dom.userProfileDropdown) {
            const isHidden = dom.userProfileDropdown.classList.contains('hidden');
            if (isHidden) {
                dom.userProfileDropdown.classList.remove('hidden');
                setTimeout(() => dom.userProfileDropdown.classList.remove('opacity-0'), 10);
            } else {
                dom.userProfileDropdown.classList.add('opacity-0');
                setTimeout(() => dom.userProfileDropdown.classList.add('hidden'), 200);
            }
        }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (dom.userProfileDropdown && !dom.userProfileDropdown.classList.contains('hidden') && dom.userProfileDisplay) {
            if (!dom.userProfileDisplay.contains(e.target as Node) && !dom.userProfileDropdown.contains(e.target as Node)) {
                dom.userProfileDropdown.classList.add('opacity-0');
                setTimeout(() => dom.userProfileDropdown.classList.add('hidden'), 200);
            }
        }
    });

    document.getElementById('admin-grant-self-50k-btn')?.addEventListener('click', async () => {
        if (!currentUser) {
            ui.showStatus("You must be logged in to grant self credits.", true, 3000);
            return;
        }
        const isAdmin = isUserAdmin(currentUser, userRecord);
        if (!isAdmin) {
            ui.showStatus("Unauthorized: Only administrators can grant credits.", true, 3000);
            return;
        }
        const currentVal = state.userCredits || 0;
        const newCredits = currentVal + 50000;
        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                credits: newCredits,
                updatedAt: serverTimestamp()
            });
            state.userCredits = newCredits;
            localStorage.setItem('userCredits', String(newCredits));
            if (dom.userCreditsDisplay) ui.updateCreditsDisplay();
            ui.showStatus(`Successfully granted self +50,000 credits! (Total: ${newCredits.toLocaleString()})`, false, 3500);
        } catch (err: any) {
            console.error("Failed to grant self credits:", err);
            ui.showStatus(err.message || "Failed to grant self credits.", true, 3000);
        }
    });
    dom.authLoginEmailBtn?.addEventListener('click', handleEmailLogin);
    dom.authSignupEmailBtn?.addEventListener('click', handleEmailSignup);
    dom.authGuestBtn?.addEventListener('click', handleGuestLogin);
    dom.authDesktopBtn?.addEventListener('click', handleDesktopLogin);
    dom.authResetPasswordBtn?.addEventListener('click', handlePasswordReset);
    dom.authBackBtn?.addEventListener('click', goBackToHome);
    dom.authCheckStatusBtn?.addEventListener('click', handleCheckApprovalStatus);
    dom.authSwitchAccountBtn?.addEventListener('click', handleLogout);

    // Profile Modal Listeners
    dom.editProfileBtn?.addEventListener('click', openProfileModal);
    dom.closeProfileModalBtn?.addEventListener('click', closeProfileModal);
    dom.cancelProfileBtn?.addEventListener('click', closeProfileModal);
    dom.saveProfileBtn?.addEventListener('click', handleSaveProfile);
    dom.toggleProfilePasswordBtn?.addEventListener('click', toggleProfilePasswordFields);
    dom.profileTogglePasswordVisibilityBtn?.addEventListener('click', toggleProfilePasswordVisibility);
    dom.profileSendResetEmailBtn?.addEventListener('click', handleSendPasswordResetEmailFromProfile);
    dom.profileSavePasswordBtn?.addEventListener('click', handleSetOrUpdatePassword);
    dom.userProfileModal?.addEventListener('click', (e) => {
        if (e.target === dom.userProfileModal) closeProfileModal();
    });
}

// Register credit bridge hooks
registerSyncUserCredits(syncUserCredits);
registerSpendCreditsSecure(spendCreditsSecure);

