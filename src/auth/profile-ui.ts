import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db, updateProfile, EmailAuthProvider, updatePassword, linkWithCredential, sendPasswordResetEmail } from '../firebase';
import * as dom from '../dom';
import * as ui from '../ui';
import { state } from '../state';
import { setAdUserRole } from '../handlers-ads';
import { applyMaintenanceModeState } from '../handlers-admin-system';
import {
    currentUser,
    userRecord,
    isGuestMode,
    isUserOwner,
    isUserAdmin,
    isUserReseller,
    isOwnerEmail,
    isDesktopApp,
    sha256Hex,
    openLoginModal,
    showAuthError,
    setCurrentUser,
    setUserRecord,
    setIsGuestMode,
    isUrlOrLink
} from './session';

export function updateAuthUI() {
    const activeUser = currentUser || (isGuestMode ? { displayName: userRecord?.displayName || 'Guest Creator', photoURL: null, email: userRecord?.email } : null);

    if (activeUser) {
        const isEffectiveAdmin = isUserAdmin(activeUser as any, userRecord);
        const isLocalOrGuest = (currentUser as any)?.uid?.startsWith('local_user_') ||
            (currentUser as any)?.uid?.startsWith('local_session_') ||
            isGuestMode ||
            !!localStorage.getItem('local_auth_session');

        if (state.systemConfig?.disableDesktopOfflineMode && isLocalOrGuest && !isEffectiveAdmin) {
            localStorage.removeItem('local_auth_session');
            setCurrentUser(null);
            setUserRecord(null);
            setIsGuestMode(false);
            openLoginModal();
            showAuthError("Desktop offline mode has been disabled by administrator. Please log in with your registered account.");
            return;
        }

        if (dom.loginBtn) dom.loginBtn.classList.add('hidden');
        if (dom.logoutBtn) dom.logoutBtn.classList.remove('hidden');
        if (dom.loginBtnMobile) dom.loginBtnMobile.classList.add('hidden');
        if (dom.logoutBtnMobile) dom.logoutBtnMobile.classList.remove('hidden');

        if (dom.userProfileDisplay) {
            dom.userProfileDisplay.classList.remove('hidden');
            if (dom.userProfilePic) {
                if (activeUser.photoURL) {
                    dom.userProfilePic.src = activeUser.photoURL;
                } else {
                    const displayName = userRecord?.displayName || activeUser.displayName || activeUser.email || 'User';
                    const initial = displayName[0].toUpperCase();
                    dom.userProfilePic.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=4f46e5&color=fff&size=64`;
                }
            }
            if (dom.userProfileName) {
                const name = userRecord?.displayName || activeUser.displayName || (activeUser.email ? activeUser.email.split('@')[0] : 'User');
                dom.userProfileName.textContent = isGuestMode ? `${name} (Preview)` : name;
            }
        }

        const isOwner = isOwnerEmail(activeUser.email) || isUserOwner(activeUser as any, userRecord);
        const isAutoApproved = state.systemConfig?.requireAdminApproval === false;
        const isBlocked = !isOwner && (userRecord?.status === 'banned' || userRecord?.status === 'restricted' || userRecord?.status === 'rejected');
        const isApproved = isOwner ||
            userRecord?.status === 'approved' ||
            userRecord?.status === 'active' ||
            isGuestMode ||
            (isAutoApproved && !isBlocked && userRecord?.status !== 'pending');

        if (isApproved && !isBlocked) {
            dom.authOverlay?.classList.add('hidden');
            dom.authPendingCard?.classList.add('hidden');
            dom.authFormContainer?.classList.add('hidden');
            
            // Automatically enter studio workspace
            if (dom.landingPage) dom.landingPage.classList.add('hidden');
            if (dom.appContainer) dom.appContainer.classList.remove('hidden');
            localStorage.setItem('hasStartedApp', 'true');
        } else {
            dom.authOverlay?.classList.remove('hidden');
            if (dom.authTitle) {
                if (userRecord?.status === 'banned') dom.authTitle.textContent = "Account Banned";
                else if (userRecord?.status === 'restricted') dom.authTitle.textContent = "Account Restricted";
                else if (userRecord?.status === 'rejected') dom.authTitle.textContent = "Request Rejected";
                else dom.authTitle.textContent = "Approval Pending";
            }
            if (dom.authMessage) {
                if (userRecord?.status === 'banned') dom.authMessage.textContent = "Your account has been banned by an administrator.";
                else if (userRecord?.status === 'restricted') dom.authMessage.textContent = "Your account is currently restricted.";
                else if (userRecord?.status === 'rejected') dom.authMessage.textContent = "Your access request was rejected.";
                else dom.authMessage.textContent = "Your account is registered and awaiting administrator approval.";
            }

            if (dom.authFormContainer) dom.authFormContainer.classList.add('hidden');
            if (dom.authActionBtn) dom.authActionBtn.classList.add('hidden');
            if (dom.authDesktopBtn) dom.authDesktopBtn.classList.add('hidden');
            if (dom.authDivider) dom.authDivider.classList.add('hidden');
            if (dom.desktopAppIndicator) dom.desktopAppIndicator.classList.add('hidden');

            if (!isBlocked) {
                if (dom.authPendingCard) {
                    dom.authPendingCard.classList.remove('hidden');
                    if (dom.authPendingEmail) {
                        dom.authPendingEmail.textContent = activeUser.email || userRecord?.email || 'Your account';
                    }
                }
            } else {
                dom.authPendingCard?.classList.add('hidden');
            }

            if (dom.authLogoutBtn) dom.authLogoutBtn.classList.remove('hidden');
        }

        const isAdmin = isUserAdmin(currentUser, userRecord);
        const isReseller = !isAdmin && isUserReseller(userRecord);
        const isManager = isAdmin || isReseller;
        setAdUserRole(isAdmin);

        if (isManager) {
            if (dom.authAdminBtn) {
                dom.authAdminBtn.classList.remove('hidden');
                dom.authAdminBtn.textContent = isAdmin ? 'Admin Dashboard' : 'Reseller Panel';
            }
            if (dom.adminNavBtn) {
                dom.adminNavBtn.classList.remove('hidden');
                dom.adminNavBtn.textContent = isAdmin ? 'Admin' : 'Reseller';
            }
        } else {
            dom.authAdminBtn?.classList.add('hidden');
            dom.adminNavBtn?.classList.add('hidden');
        }
    } else {
        setAdUserRole(false);
        if (dom.loginBtn) dom.loginBtn.classList.remove('hidden');
        if (dom.logoutBtn) dom.logoutBtn.classList.add('hidden');
        if (dom.loginBtnMobile) dom.loginBtnMobile.classList.remove('hidden');
        if (dom.logoutBtnMobile) dom.logoutBtnMobile.classList.add('hidden');
        if (dom.userProfileDisplay) dom.userProfileDisplay.classList.add('hidden');
        if (dom.userCreditsDisplay) dom.userCreditsDisplay.classList.add('hidden');
        if (dom.userCloudRenderDisplay) dom.userCloudRenderDisplay.classList.add('hidden');
        
        dom.authOverlay?.classList.remove('hidden');
        dom.authPendingCard?.classList.add('hidden');
        if (dom.authTitle) dom.authTitle.textContent = "Authentication Required";
        if (dom.authMessage) dom.authMessage.textContent = "Please log in to access ContentGen AI.";
        if (dom.authFormContainer) dom.authFormContainer.classList.remove('hidden');
        if (dom.authLogoutBtn) dom.authLogoutBtn.classList.add('hidden');
        if (dom.authAdminBtn) dom.authAdminBtn.classList.add('hidden');
        if (dom.adminNavBtn) dom.adminNavBtn.classList.add('hidden');

        if (isDesktopApp()) {
            if (dom.authActionBtn) dom.authActionBtn.classList.add('hidden');
            if (dom.authDivider) dom.authDivider.classList.add('hidden');
            if (!state.systemConfig?.disableDesktopOfflineMode) {
                dom.desktopAppIndicator?.classList.remove('hidden');
                dom.authDesktopBtn?.classList.remove('hidden');
                dom.authGuestBtn?.classList.remove('hidden');
            } else {
                dom.desktopAppIndicator?.classList.add('hidden');
                dom.authDesktopBtn?.classList.add('hidden');
                dom.authGuestBtn?.classList.add('hidden');
            }
        } else {
            if (dom.authActionBtn) dom.authActionBtn.classList.remove('hidden');
            if (dom.authDivider) dom.authDivider.classList.remove('hidden');
            dom.desktopAppIndicator?.classList.add('hidden');
            dom.authDesktopBtn?.classList.remove('hidden');
            dom.authGuestBtn?.classList.remove('hidden');
        }
    }

    applyMaintenanceModeState();
    ui.updateGeminiApiKeyUiState();
}

export function openProfileModal() {
    if (!currentUser) return;
    if (dom.userProfileModal) dom.userProfileModal.classList.remove('hidden');
    if (dom.profileEmailDisplay) dom.profileEmailDisplay.value = currentUser.email || '';
    if (dom.profileUsernameInput) dom.profileUsernameInput.value = userRecord?.displayName || currentUser.displayName || (currentUser.email ? currentUser.email.split('@')[0] : '');
    const isOwnerCurrent = isUserOwner(currentUser, userRecord) || isOwnerEmail(currentUser.email);
    if (dom.profileRoleBadge) dom.profileRoleBadge.textContent = isOwnerCurrent ? 'owner' : (userRecord?.role || 'user');
    if (dom.profileStatusBadge) dom.profileStatusBadge.textContent = isOwnerCurrent ? 'approved' : (userRecord?.status || 'pending');

    const profileCredits = document.getElementById('profile-credits-display');
    if (profileCredits) {
        profileCredits.textContent = Math.floor(state.userCredits || 0).toLocaleString();
    }
    const profileRenderMins = document.getElementById('profile-render-mins-display');
    if (profileRenderMins) {
        const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
        const used = state.renderMinutesUsed || 0;
        const remaining = Math.max(0, quota - used);
        profileRenderMins.textContent = `${Math.round(remaining)} mins`;
    }

    if (dom.profileMsg) {
        dom.profileMsg.textContent = '';
        dom.profileMsg.className = 'text-sm hidden text-center p-2 rounded';
    }

    refreshProfileAuthProviders();
}

export function refreshProfileAuthProviders() {
    if (!currentUser) return;
    const providers = currentUser.providerData || [];
    const hasGoogle = providers.some(p => p.providerId === 'google.com');
    const hasPassword = providers.some(p => p.providerId === 'password');

    if (dom.profileProviderGoogle) {
        dom.profileProviderGoogle.classList.toggle('hidden', !hasGoogle);
    }
    if (dom.profileProviderPassword) {
        dom.profileProviderPassword.classList.toggle('hidden', !hasPassword);
    }

    if (dom.profilePasswordSectionTitle) {
        dom.profilePasswordSectionTitle.innerHTML = hasPassword 
            ? '<span>🔑</span> Change Account Password' 
            : '<span>🔑</span> Set Password for Email Login';
    }
    if (dom.profilePasswordSectionDesc) {
        dom.profilePasswordSectionDesc.textContent = hasPassword
            ? 'Update your password for direct email/password sign-in.'
            : 'Add a password to sign in directly with your email alongside Google.';
    }
    if (dom.profileSavePasswordBtnText) {
        dom.profileSavePasswordBtnText.textContent = hasPassword ? 'Update Password' : 'Set Password';
    }

    // Reset password form inputs
    if (dom.profileNewPasswordInput) dom.profileNewPasswordInput.value = '';
    if (dom.profileConfirmPasswordInput) dom.profileConfirmPasswordInput.value = '';
    if (dom.profilePasswordMsg) {
        dom.profilePasswordMsg.textContent = '';
        dom.profilePasswordMsg.className = 'text-xs hidden p-2 rounded text-center';
    }
    if (dom.profilePasswordFieldsContainer) {
        dom.profilePasswordFieldsContainer.classList.add('hidden');
    }
    if (dom.toggleProfilePasswordBtn) {
        dom.toggleProfilePasswordBtn.textContent = 'Configure';
    }
}

export function toggleProfilePasswordFields() {
    if (!dom.profilePasswordFieldsContainer) return;
    const isHidden = dom.profilePasswordFieldsContainer.classList.contains('hidden');
    if (isHidden) {
        dom.profilePasswordFieldsContainer.classList.remove('hidden');
        if (dom.toggleProfilePasswordBtn) dom.toggleProfilePasswordBtn.textContent = 'Hide';
        dom.profileNewPasswordInput?.focus();
    } else {
        dom.profilePasswordFieldsContainer.classList.add('hidden');
        if (dom.toggleProfilePasswordBtn) dom.toggleProfilePasswordBtn.textContent = 'Configure';
    }
}

export function toggleProfilePasswordVisibility() {
    if (!dom.profileNewPasswordInput) return;
    const isPassword = dom.profileNewPasswordInput.type === 'password';
    dom.profileNewPasswordInput.type = isPassword ? 'text' : 'password';
    if (dom.profileConfirmPasswordInput) {
        dom.profileConfirmPasswordInput.type = isPassword ? 'text' : 'password';
    }
    if (dom.profileTogglePasswordVisibilityBtn) {
        dom.profileTogglePasswordVisibilityBtn.textContent = isPassword ? '🙈' : '👁️';
    }
}

export function showProfilePasswordMsg(msg: string, type: 'error' | 'success') {
    if (!dom.profilePasswordMsg) return;
    dom.profilePasswordMsg.textContent = msg;
    dom.profilePasswordMsg.classList.remove('hidden', 'bg-red-900/40', 'text-red-300', 'bg-green-900/40', 'text-green-300');
    if (type === 'error') {
        dom.profilePasswordMsg.classList.add('bg-red-900/40', 'text-red-300');
    } else {
        dom.profilePasswordMsg.classList.add('bg-green-900/40', 'text-green-300');
    }
}

export async function handleSendPasswordResetEmailFromProfile() {
    if (!currentUser || !currentUser.email) {
        showProfilePasswordMsg("No email address found for this account.", "error");
        return;
    }

    try {
        if (dom.profileSendResetEmailBtn) {
            dom.profileSendResetEmailBtn.disabled = true;
            dom.profileSendResetEmailBtn.textContent = 'Sending reset email...';
        }

        await sendPasswordResetEmail(auth, currentUser.email);
        showProfilePasswordMsg(`Reset email sent to ${currentUser.email}. Please check your inbox.`, "success");
    } catch (e: any) {
        console.error("Failed to send password reset email:", e);
        showProfilePasswordMsg(e.message || "Failed to send password reset email.", "error");
    } finally {
        if (dom.profileSendResetEmailBtn) {
            dom.profileSendResetEmailBtn.disabled = false;
            dom.profileSendResetEmailBtn.textContent = 'Send reset link to email';
        }
    }
}

export async function handleSetOrUpdatePassword() {
    if (!currentUser || !currentUser.email) {
        showProfilePasswordMsg("You must be logged in to set a password.", "error");
        return;
    }

    const newPassword = dom.profileNewPasswordInput?.value || '';
    const confirmPassword = dom.profileConfirmPasswordInput?.value || '';

    if (!newPassword) {
        showProfilePasswordMsg("Password cannot be empty.", "error");
        return;
    }

    if (newPassword.length < 6) {
        showProfilePasswordMsg("Password must be at least 6 characters.", "error");
        return;
    }

    if (newPassword !== confirmPassword) {
        showProfilePasswordMsg("Passwords do not match.", "error");
        return;
    }

    if ((currentUser as any)?.uid?.startsWith('local_') || !currentUser.providerData) {
        try {
            if (dom.profileSavePasswordBtn) dom.profileSavePasswordBtn.disabled = true;
            if (dom.profileSavePasswordBtnText) dom.profileSavePasswordBtnText.textContent = 'Saving...';
            const hashed = await sha256Hex(newPassword);
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, { passwordHash: hashed, updatedAt: serverTimestamp() }).catch(() => {});
            const savedSession = localStorage.getItem('local_auth_session');
            if (savedSession) {
                try {
                    const parsed = JSON.parse(savedSession);
                    if (parsed.record) parsed.record.passwordHash = hashed;
                    localStorage.setItem('local_auth_session', JSON.stringify(parsed));
                } catch {}
            }
            showProfilePasswordMsg("Desktop Studio password updated successfully!", "success");
            ui.showStatus("Desktop Studio password updated.", false, 3000);
            return;
        } catch (localErr: any) {
            showProfilePasswordMsg(localErr.message || "Failed to update desktop password", "error");
            return;
        } finally {
            if (dom.profileSavePasswordBtn) dom.profileSavePasswordBtn.disabled = false;
            if (dom.profileSavePasswordBtnText) dom.profileSavePasswordBtnText.textContent = 'Set Password';
        }
    }

    const hasPassword = currentUser.providerData?.some(p => p.providerId === 'password');

    try {
        if (dom.profileSavePasswordBtn) {
            dom.profileSavePasswordBtn.disabled = true;
        }
        if (dom.profileSavePasswordBtnText) {
            dom.profileSavePasswordBtnText.textContent = 'Saving...';
        }

        if (hasPassword) {
            // Already has password provider -> update password
            await updatePassword(currentUser, newPassword);
        } else {
            // Signed up via Google only -> link with EmailAuthProvider credential
            const credential = EmailAuthProvider.credential(currentUser.email, newPassword);
            try {
                await linkWithCredential(currentUser, credential);
            } catch (linkErr: any) {
                if (linkErr?.code === 'auth/provider-already-linked') {
                    await updatePassword(currentUser, newPassword);
                } else {
                    throw linkErr;
                }
            }
        }

        showProfilePasswordMsg(
            hasPassword 
                ? "Password updated successfully!" 
                : "Password set! You can now sign in using Google or your email & password.", 
            "success"
        );

        // Update provider badges & labels
        refreshProfileAuthProviders();
        if (dom.profilePasswordFieldsContainer) {
            dom.profilePasswordFieldsContainer.classList.remove('hidden');
        }
        if (dom.toggleProfilePasswordBtn) {
            dom.toggleProfilePasswordBtn.textContent = 'Hide';
        }

        ui.showStatus("Security credentials updated successfully.", false, 3000);
    } catch (e: any) {
        console.error("Failed to set/update password:", e);
        let errorMsg = e.message || "Failed to set password.";
        if (e.code === 'auth/operation-not-allowed' || (typeof e.message === 'string' && e.message.includes('operation-not-allowed'))) {
            const projectId = firebaseConfig.projectId || 'paidproject-505110';
            const providersUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
            errorMsg = "Email/Password sign-in provider is disabled in your Firebase project. In Firebase Console > Authentication > Sign-in method, please enable 'Email/Password'.";
            ui.showConfirmation(
                'Enable Email/Password in Firebase',
                `Firebase blocked setting an email password because the "Email/Password" sign-in provider is currently disabled in your Firebase project (${projectId}).\n\n` +
                `Would you like to open Firebase Console > Authentication > Sign-in method to turn it ON now?`,
                () => {
                    window.open(providersUrl, '_blank');
                },
                () => {}
            );
        } else if (e.code === 'auth/requires-recent-login') {
            errorMsg = "For security reasons, this action requires recent authentication. Please log out and sign back in, then try again.";
        } else if (e.code === 'auth/weak-password') {
            errorMsg = "The password is too weak. Please use at least 6 characters.";
        } else if (e.code === 'auth/email-already-in-use') {
            errorMsg = "This email is already associated with another password account.";
        }
        showProfilePasswordMsg(errorMsg, "error");
    } finally {
        if (dom.profileSavePasswordBtn) {
            dom.profileSavePasswordBtn.disabled = false;
        }
        if (dom.profileSavePasswordBtnText) {
            dom.profileSavePasswordBtnText.textContent = hasPassword ? 'Update Password' : 'Set Password';
        }
    }
}

export function closeProfileModal() {
    if (dom.userProfileModal) dom.userProfileModal.classList.add('hidden');
}

export async function handleSaveProfile() {
    if (!currentUser) return;
    const newUsername = dom.profileUsernameInput?.value.trim();
    if (!newUsername) {
        showProfileMsg("Username / Display Name cannot be empty", "error");
        return;
    }

    if (isUrlOrLink(newUsername)) {
        showProfileMsg("Username cannot be a website link or video URL. Please enter a valid name.", "error");
        return;
    }

    try {
        if (dom.saveProfileBtn) {
            dom.saveProfileBtn.disabled = true;
            dom.saveProfileBtn.textContent = 'Saving...';
        }

        // 1. Update Firebase Auth profile
        await updateProfile(currentUser, { displayName: newUsername });

        // 2. Update Firestore user document
        const userRef = doc(db, 'users', currentUser.uid);
        await updateDoc(userRef, {
            displayName: newUsername,
            updatedAt: serverTimestamp()
        });

        if (userRecord) {
            userRecord.displayName = newUsername;
        }

        updateAuthUI();
        showProfileMsg("Username updated successfully!", "success");

        setTimeout(() => {
            closeProfileModal();
        }, 1000);
    } catch (e: any) {
        console.error("Failed to update username:", e);
        showProfileMsg(e.message || "Failed to update username", "error");
    } finally {
        if (dom.saveProfileBtn) {
            dom.saveProfileBtn.disabled = false;
            dom.saveProfileBtn.textContent = 'Save Changes';
        }
    }
}

function showProfileMsg(msg: string, type: 'error' | 'success') {
    if (!dom.profileMsg) return;
    dom.profileMsg.textContent = msg;
    dom.profileMsg.classList.remove('hidden', 'bg-red-900/30', 'text-red-400', 'bg-green-900/30', 'text-green-400');
    if (type === 'error') {
        dom.profileMsg.classList.add('bg-red-900/30', 'text-red-400');
    } else {
        dom.profileMsg.classList.add('bg-green-900/30', 'text-green-400');
    }
}
