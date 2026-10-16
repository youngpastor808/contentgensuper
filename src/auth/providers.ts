import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
    auth,
    db,
    provider,
    signInWithPopup,
    signInWithCredential,
    GoogleAuthProvider,
    signOut,
    User,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile
} from '../firebase';
import * as dom from '../dom';
import * as ui from '../ui';
import { state } from '../state';
import {
    currentUser,
    userRecord,
    userDocUnsubscribe,
    adminUsersUnsubscribe,
    setCurrentUser,
    setUserRecord,
    setIsGuestMode,
    setUserDocUnsubscribe,
    setAdminUsersUnsubscribe,
    isUserAdmin,
    isUserOwner,
    isOwnerEmail,
    showAuthError,
    showAuthSuccess,
    hideAuthError,
    formatAuthErrorMessage,
    isUrlOrLink
} from './session';
import { PENDING_SPENDS_KEY } from './credits';
import { loginAsLocalUser, verifyDesktopStudioPassword } from './desktop';
import { updateAuthUI } from './profile-ui';
import { getDocPermissionScore, executeDeduplication } from './dedup';

export function initGSI() {
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

export async function handleLogin() {
    hideAuthError();
    try {
        const cred = await signInWithPopup(auth, provider);
        setIsGuestMode(false);
        hideAuthError();
        if (cred.user) {
            setCurrentUser(cred.user);
            try {
                await checkAndCreateUser(cred.user);
            } catch (syncErr) {
                console.warn("Immediate profile sync note on Google login:", syncErr);
            }
        }
        updateAuthUI();
        const isOwner = isOwnerEmail(cred.user?.email || '');
        const isAutoApproved = state.systemConfig?.requireAdminApproval === false;
        const isBlocked = !isOwner && (userRecord?.status === 'banned' || userRecord?.status === 'restricted' || userRecord?.status === 'rejected');
        const isApproved = isOwner ||
            userRecord?.status === 'approved' ||
            userRecord?.status === 'active' ||
            (isAutoApproved && !isBlocked && userRecord?.status !== 'pending');

        if (isApproved && !isBlocked) {
            if (dom.authOverlay) dom.authOverlay.classList.add('hidden');
            if (dom.authFormContainer) dom.authFormContainer.classList.add('hidden');
            if (dom.authPendingCard) dom.authPendingCard.classList.add('hidden');
            if (dom.landingPage) dom.landingPage.classList.add('hidden');
            if (dom.appContainer) dom.appContainer.classList.remove('hidden');
            localStorage.setItem('hasStartedApp', 'true');
            ui.showStatus("Logged in successfully!", false, 3000);
        } else if (!isBlocked) {
            if (dom.authOverlay) dom.authOverlay.classList.remove('hidden');
            if (dom.authFormContainer) dom.authFormContainer.classList.add('hidden');
            if (dom.authPendingCard) dom.authPendingCard.classList.remove('hidden');
            if (dom.authPendingEmail) dom.authPendingEmail.textContent = cred.user?.email || '';
            if (dom.authTitle) dom.authTitle.textContent = "Approval Pending";
            if (dom.authMessage) dom.authMessage.textContent = "Your account is registered and awaiting administrator approval.";
            ui.showStatus("Logged in: Account is pending administrator approval.", false, 5000);
        }
    } catch (error: any) {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'your deployment domain';
        const projectId = firebaseConfig.projectId || 'paidproject-505110';
        const consoleSettingsUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
        const providersUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
        const gcpCredentialsUrl = `https://console.cloud.google.com/apis/credentials?project=${projectId}`;
        const redirectHandler = `https://${projectId}.firebaseapp.com/__/auth/handler`;

        if (error?.code === 'auth/cancelled-popup-request' || error?.code === 'auth/popup-closed-by-user') {
            console.log("Login popup request was cancelled or closed by user.");
            showAuthError(
                `ℹ️ Google Login was closed or blocked.\n` +
                `If Google displayed "flowName=GeneralOAuthFlow" or a redirect/access error inside the popup:\n` +
                `1. Check Firebase Sign-In Providers: ensure Google is enabled.\n` +
                `2. In Google Cloud Console Credentials, verify Authorized redirect URIs has:\n` +
                `   ${redirectHandler}\n` +
                `3. Or sign in instantly using Email/Password, Desktop Studio, or Continue as Guest!`
            );
            return;
        }
        console.warn("Login failed", error);
        const isApiKeyError = error?.code === 'auth/api-key-not-found' ||
            error?.code === 'auth/invalid-api-key' ||
            (typeof error?.message === 'string' && (error.message.includes('api-key-not-found') || error.message.includes('API Key not found') || error.message.includes('API key not valid')));

        if (isApiKeyError) {
            const enteredEmail = dom.authEmailInput?.value?.trim();
            if (enteredEmail) {
                ui.showStatus("Firebase cloud key restricted. Logging in with desktop workspace mode...", false, 4000);
                loginAsLocalUser(enteredEmail, dom.authUsernameInput?.value?.trim());
                return;
            } else {
                showAuthError("Firebase Web API key is not recognized or restricted by Google Cloud (Identity Toolkit API not enabled). Enter your email above and click 'Log In', or click 'Launch Desktop Creator Studio' / 'Continue as Guest'.");
                return;
            }
        }

        if (error?.code === 'auth/network-request-failed' || error?.code === 'auth/operation-not-supported-in-this-environment' || error?.code === 'auth/popup-blocked') {
            const enteredEmail = dom.authEmailInput?.value?.trim();
            if (enteredEmail && error?.code === 'auth/network-request-failed') {
                loginAsLocalUser(enteredEmail, dom.authUsernameInput?.value?.trim());
                return;
            } else {
                showAuthError("Google Popup Login is blocked or not supported in this iframe/WebView environment. Please sign up or log in using Email/Password, or click 'Continue as Guest'.");
                return;
            }
        }

        if (
            error?.code === 'auth/internal-error' ||
            error?.code === 'auth/invalid-credential' ||
            (typeof error?.message === 'string' && (
                error.message.includes('GeneralOAuthFlow') ||
                error.message.includes('redirect_uri_mismatch') ||
                error.message.includes('invalid_request')
            ))
        ) {
            showAuthError(
                `⚠️ Google OAuth Configuration Issue (flowName=GeneralOAuthFlow)\n\n` +
                `Google blocked the login request because your project's OAuth client is missing authorized redirect URIs or the Google provider is disabled in Firebase.\n\n` +
                `Quick Fix:\n` +
                `1. In Firebase Console (${providersUrl}), ensure "Google" is enabled.\n` +
                `2. In Google Cloud Console Credentials (${gcpCredentialsUrl}):\n` +
                `   Under OAuth 2.0 Client IDs, add this Authorized redirect URI:\n` +
                `   ${redirectHandler}\n` +
                `3. Add domain "${host}" to Firebase Authorized domains.\n\n` +
                `💡 Instant Access: You can log in with Email/Password or Continue as Guest right now!`
            );
            return;
        }

        if (error?.code === 'auth/unauthorized-domain' || (typeof error?.message === 'string' && error.message.includes('unauthorized-domain'))) {
            console.error(`[Firebase Auth] Domain unauthorized: "${host}". Add to Firebase Console Authorized Domains.`);

            showAuthError(
                `⚠️ Unauthorized Domain (${host})\n` +
                `Google Sign-In is blocked by Firebase because this deployment domain has not been added to your Firebase Authorized Domains.\n\n` +
                `How to fix in 1 minute:\n` +
                `1. Open Firebase Console:\n   ${consoleSettingsUrl}\n` +
                `2. Under "Authorized domains", click "Add domain"\n` +
                `3. Paste: ${host} and save.\n\n` +
                `💡 Tip: You can log in with Email/Password or Continue as Guest right now without domain authorization!`
            );

            ui.showConfirmation(
                'Firebase Auth: Add Authorized Domain',
                `Google Sign-In is blocked by Firebase because your deployment domain "${host}" is not on the Authorized Domains list.\n\n` +
                `Click "Open Firebase Console" to copy "${host}" and go to settings where you can add it.\n\n` +
                `(Email/Password sign-in and Guest access work immediately without domain authorization)`,
                () => {
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(host);
                            ui.showStatus(`Copied "${host}"! Opening Firebase settings...`, false, 5000);
                        }
                    } catch {}
                    window.open(consoleSettingsUrl, '_blank');
                },
                () => {}
            );
            return;
        }

        showAuthError(formatAuthErrorMessage(error));
    }
}

export async function handleLogout() {
    try {
        setIsGuestMode(false);
        
        // Clean up Firestore listeners
        if (userDocUnsubscribe) {
            userDocUnsubscribe();
            setUserDocUnsubscribe(null);
        }
        if (adminUsersUnsubscribe) {
            adminUsersUnsubscribe();
            setAdminUsersUnsubscribe(null);
        }

        // Clean up active sessions and cached credentials
        localStorage.removeItem('local_auth_session');
        localStorage.removeItem('userCredits');
        localStorage.removeItem(PENDING_SPENDS_KEY);
        localStorage.removeItem('user_gemini_api_key');
        localStorage.removeItem('openai_gateway_api_key');
        localStorage.removeItem('elevenlabs_api_key');
        localStorage.removeItem('deepgram_api_key');
        localStorage.removeItem('stability_api_key');
        localStorage.removeItem('ai33_api_key');
        localStorage.removeItem('custom_firebase_api_key');
        localStorage.removeItem('cg_desktop_studio_password');

        try {
            sessionStorage.clear();
        } catch {}

        // Clear server proxy auth cookies
        try {
            fetch('/api/llm/clear-cookies', { method: 'POST', credentials: 'include' }).catch(() => {});
        } catch {}

        // Wipe in-memory provider API keys
        state.userGeminiApiKey = '';
        state.openaiGatewayApiKey = '';
        state.elevenlabsApiKey = '';
        state.deepgramApiKey = '';
        state.stabilityApiKey = '';
        state.ai33ApiKey = '';
        state.pexelsApiKey = '';
        state.freesoundApiKey = '';

        // Clear sensitive auth form inputs
        if (dom.authPasswordInput) dom.authPasswordInput.value = '';
        if (dom.authEmailInput) dom.authEmailInput.value = '';
        if (dom.authUsernameInput) dom.authUsernameInput.value = '';

        // Close dropdowns and privileged modals
        if (dom.userProfileDropdown) {
            dom.userProfileDropdown.classList.add('opacity-0');
            dom.userProfileDropdown.classList.add('hidden');
        }
        if (dom.mobileMenu) {
            dom.mobileMenu.classList.add('hidden');
        }
        if (dom.adminPanel && !dom.adminPanel.classList.contains('hidden')) {
            dom.adminPanel.classList.add('hidden');
        }

        if (auth.currentUser) {
            await signOut(auth);
        }
        setUserRecord(null);
        setCurrentUser(null);
        state.userCredits = 10000;
        dom.userCreditsDisplay && ui.updateCreditsDisplay();
        hideAuthError();
        updateAuthUI();
        ui.showStatus("Logged out successfully.", false, 2500);
    } catch (error) {
        console.error("Logout failed", error);
    }
}

export async function handleEmailLogin() {
    if (!dom.authEmailInput || !dom.authPasswordInput) return;
    const email = dom.authEmailInput.value.trim().toLowerCase();
    const password = dom.authPasswordInput.value;
    if (!email || !password) {
        showAuthError("Please enter email and password");
        return;
    }
    hideAuthError();

    const origLoginText = dom.authLoginEmailBtn ? dom.authLoginEmailBtn.innerHTML : 'Log In';
    if (dom.authLoginEmailBtn) {
        dom.authLoginEmailBtn.disabled = true;
        dom.authLoginEmailBtn.innerHTML = '<span class="inline-block animate-spin mr-1.5">⏳</span> Logging in...';
    }
    if (dom.authSignupEmailBtn) dom.authSignupEmailBtn.disabled = true;

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        localStorage.removeItem('local_auth_session');
        hideAuthError();
        if (dom.authPasswordInput) dom.authPasswordInput.value = '';

        if (cred.user) {
            setCurrentUser(cred.user);
            setIsGuestMode(false);
            try {
                await checkAndCreateUser(cred.user);
            } catch (syncErr) {
                console.warn("Immediate profile sync note on email login:", syncErr);
            }
        }

        updateAuthUI();

        const isOwner = isOwnerEmail(email);
        const isAutoApproved = state.systemConfig?.requireAdminApproval === false;
        const isBlocked = !isOwner && (userRecord?.status === 'banned' || userRecord?.status === 'restricted' || userRecord?.status === 'rejected');
        const isApproved = isOwner ||
            userRecord?.status === 'approved' ||
            userRecord?.status === 'active' ||
            (isAutoApproved && !isBlocked && userRecord?.status !== 'pending');

        if (isApproved && !isBlocked) {
            if (dom.authOverlay) dom.authOverlay.classList.add('hidden');
            if (dom.authFormContainer) dom.authFormContainer.classList.add('hidden');
            if (dom.authPendingCard) dom.authPendingCard.classList.add('hidden');
            if (dom.landingPage) dom.landingPage.classList.add('hidden');
            if (dom.appContainer) dom.appContainer.classList.remove('hidden');
            localStorage.setItem('hasStartedApp', 'true');
            ui.showStatus("Logged in successfully!", false, 3000);
        } else if (!isBlocked) {
            if (dom.authOverlay) dom.authOverlay.classList.remove('hidden');
            if (dom.authFormContainer) dom.authFormContainer.classList.add('hidden');
            if (dom.authPendingCard) dom.authPendingCard.classList.remove('hidden');
            if (dom.authPendingEmail) dom.authPendingEmail.textContent = email;
            if (dom.authTitle) dom.authTitle.textContent = "Approval Pending";
            if (dom.authMessage) dom.authMessage.textContent = "Your account is registered and awaiting administrator approval.";
            ui.showStatus("Logged in: Account is pending administrator approval.", false, 5000);
        }
    } catch (error: any) {
        console.warn("Email login attempt failed:", error?.code, error?.message);
        if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/user-not-found' || error?.code === 'auth/wrong-password') {
            showAuthError("Invalid email or password. If you were invited or pre-approved by an administrator, click 'Sign Up' to set your password and activate your account.");
            return;
        }
        if (error?.code === 'auth/operation-not-allowed' || (typeof error?.message === 'string' && error.message.includes('operation-not-allowed'))) {
            const projectId = firebaseConfig.projectId || 'paidproject-505110';
            const providersUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
            showAuthError(
                `⚠️ Email/Password Provider is Disabled in Firebase Console\n\n` +
                `Firebase requires the Email/Password sign-in method to be enabled in your Firebase project.\n\n` +
                `How to fix in 30 seconds:\n` +
                `1. Open Firebase Console: ${providersUrl}\n` +
                `2. Under "Sign-in providers", click "Email/Password"\n` +
                `3. Toggle "Enable" to ON and click "Save".\n\n` +
                `💡 You can also log in via Google or Continue as Guest in the meantime.`
            );
            ui.showConfirmation(
                'Firebase: Enable Email/Password Provider',
                `Firebase Email/Password authentication is currently disabled in your Firebase project (${projectId}).\n\n` +
                `Would you like to open Firebase Console > Authentication > Sign-in method to enable it now?`,
                () => {
                    window.open(providersUrl, '_blank');
                },
                () => {}
            );
            return;
        }
        if (error?.code === 'auth/network-request-failed' || (error?.code === 'auth/api-key-not-found' || error?.code === 'auth/invalid-api-key' || (typeof error?.message === 'string' && (error.message.includes('api-key-not-found') || error.message.includes('API Key not found') || error.message.includes('API key not valid'))))) {
            const isDesktopValid = await verifyDesktopStudioPassword(password);
            if (isDesktopValid) {
                const customUsername = dom.authUsernameInput?.value.trim();
                ui.showStatus("Desktop Studio password verified! Access granted in offline studio mode.", false, 4000);
                loginAsLocalUser(email, customUsername);
                return;
            } else {
                showAuthError("Cloud Firebase Authentication is unavailable. To access Desktop Studio offline, please enter the authorized desktop password, or click 'Continue as Guest'.");
                ui.showStatus("Invalid password for Desktop Studio offline access.", true, 5000);
                return;
            }
        }
        const formattedErr = formatAuthErrorMessage(error, 'login');
        showAuthError(formattedErr);
        ui.showStatus(formattedErr, true, 5000);
    } finally {
        if (dom.authLoginEmailBtn) {
            dom.authLoginEmailBtn.disabled = false;
            dom.authLoginEmailBtn.innerHTML = origLoginText;
        }
        if (dom.authSignupEmailBtn) dom.authSignupEmailBtn.disabled = false;
    }
}

export async function handleEmailSignup() {
    if (!dom.authEmailInput || !dom.authPasswordInput) return;
    const email = dom.authEmailInput.value.trim();
    const password = dom.authPasswordInput.value;
    const customUsername = dom.authUsernameInput?.value.trim() || '';

    if (customUsername && isUrlOrLink(customUsername)) {
        showAuthError("Usernames cannot be a website URL or video link (e.g. YouTube). Please enter your real name or nickname, or leave it blank.");
        return;
    }

    const displayName = customUsername || (email ? email.split('@')[0] : 'User');

    if (!email || !password) {
        showAuthError("Please enter email and password");
        return;
    }

    if (password.length < 6) {
        showAuthError("Password should be at least 6 characters.");
        return;
    }

    hideAuthError();

    const origSignupText = dom.authSignupEmailBtn ? dom.authSignupEmailBtn.innerHTML : 'Sign Up';
    if (dom.authSignupEmailBtn) {
        dom.authSignupEmailBtn.disabled = true;
        dom.authSignupEmailBtn.innerHTML = '<span class="inline-block animate-spin mr-1.5">⏳</span> Registering...';
    }
    if (dom.authLoginEmailBtn) dom.authLoginEmailBtn.disabled = true;

    try {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        localStorage.removeItem('local_auth_session');
        if (res.user) {
            try {
                await updateProfile(res.user, { displayName });
            } catch (pErr) {
                console.error("Failed to update user profile name:", pErr);
            }
            try {
                await sendEmailVerification(res.user);
            } catch (vErr) {
                console.warn("Could not send email verification:", vErr);
            }
            try {
                await checkAndCreateUser(res.user);
            } catch (uErr) {
                console.warn("User profile creation on signup:", uErr);
            }
            updateAuthUI();
        }
        hideAuthError();
        showAuthSuccess("Registration successful! Your account is registered and pending administrator approval.");
        ui.showStatus("Registration successful! Your account is pending administrator approval.", false, 6000);
    } catch (error: any) {
        console.warn("Email signup attempt failed:", error?.code, error?.message);
        const isApiKeyError = error?.code === 'auth/api-key-not-found' ||
            error?.code === 'auth/invalid-api-key' ||
            (typeof error?.message === 'string' && (error.message.includes('api-key-not-found') || error.message.includes('API Key not found') || error.message.includes('API key not valid')));
        if (error?.code === 'auth/operation-not-allowed' || (typeof error?.message === 'string' && error.message.includes('operation-not-allowed'))) {
            const projectId = firebaseConfig.projectId || 'paidproject-505110';
            const providersUrl = `https://console.firebase.google.com/project/${projectId}/authentication/providers`;
            showAuthError(
                `⚠️ Email/Password Provider Disabled in Firebase Console\n\n` +
                `Registration requires the Email/Password sign-in method to be turned ON in your Firebase project.\n\n` +
                `How to fix:\n` +
                `1. Open Firebase Console: ${providersUrl}\n` +
                `2. Under "Sign-in providers", click "Email/Password"\n` +
                `3. Enable "Email/Password" and click Save.\n\n` +
                `💡 You can also sign in via Google or Continue as Guest in the meantime.`
            );
            ui.showConfirmation(
                'Firebase: Enable Email/Password Provider',
                `Registration with Email/Password requires the provider to be enabled in Firebase Console (${projectId}).\n\n` +
                `Would you like to open Firebase Console to enable it now?`,
                () => {
                    window.open(providersUrl, '_blank');
                },
                () => {}
            );
            return;
        }
        if (error?.code === 'auth/network-request-failed' || error?.code === 'auth/internal-error' || isApiKeyError) {
            ui.showStatus("Firebase Auth cloud key restricted. Initializing workspace in desktop mode...", false, 4000);
            loginAsLocalUser(email, displayName);
            return;
        }
        const formattedErr = formatAuthErrorMessage(error, 'signup');
        showAuthError(formattedErr);
        ui.showStatus(formattedErr, true, 5000);
    } finally {
        if (dom.authSignupEmailBtn) {
            dom.authSignupEmailBtn.disabled = false;
            dom.authSignupEmailBtn.innerHTML = origSignupText;
        }
        if (dom.authLoginEmailBtn) dom.authLoginEmailBtn.disabled = false;
    }
}

export async function handlePasswordReset() {
    if (!dom.authEmailInput) return;
    const email = dom.authEmailInput.value.trim();
    if (!email) {
        showAuthError("Please enter your email address above, then click 'Forgot password?'.");
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        showAuthSuccess(`Password reset email sent to ${email}. Please check your inbox or spam folder.`);
    } catch (error: any) {
        console.error("Password reset failed", error);
        showAuthError(formatAuthErrorMessage(error, 'reset'));
    }
}

export async function handleCheckApprovalStatus() {
    if (!currentUser) {
        ui.showStatus("Please log in first.", true, 3000);
        return;
    }
    const origBtnText = dom.authCheckStatusBtn ? dom.authCheckStatusBtn.innerHTML : 'Check Approval Status';
    if (dom.authCheckStatusBtn) {
        dom.authCheckStatusBtn.disabled = true;
        dom.authCheckStatusBtn.innerHTML = '<span class="inline-block animate-spin mr-1.5">🔄</span> Checking...';
    }
    try {
        const snap = await getDoc(doc(db, 'users', currentUser.uid));
        if (snap.exists()) {
            const data = snap.data();
            setUserRecord({ ...userRecord, ...data });
            if (data.status === 'approved' || data.status === 'active') {
                ui.showStatus("🎉 Your account has been approved! Loading studio...", false, 4000);
                updateAuthUI();
            } else if (data.status === 'rejected' || data.status === 'banned') {
                ui.showStatus(`Account status: ${data.status}`, true, 4000);
                updateAuthUI();
            } else {
                ui.showStatus("Status: Pending admin approval. Please notify your administrator to activate your account.", false, 5000);
                updateAuthUI();
            }
        } else {
            ui.showStatus("Status: Pending profile initialization. Retrying...", false, 3000);
            if (currentUser) {
                await checkAndCreateUser(currentUser);
                updateAuthUI();
            }
        }
    } catch (e: any) {
        console.warn("Check status error:", e);
        ui.showStatus("Could not verify status: " + (e?.message || e), true, 4000);
    } finally {
        if (dom.authCheckStatusBtn) {
            dom.authCheckStatusBtn.disabled = false;
            dom.authCheckStatusBtn.innerHTML = origBtnText;
        }
    }
}

export async function checkAndCreateUser(user: User) {
    const userRef = doc(db, 'users', user.uid);
    try {
        const docSnap = await getDoc(userRef);
        const isAdmin = isUserAdmin(user, docSnap.exists() ? docSnap.data() : null);
        const defaultName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
        
        if (docSnap.exists()) {
            const rec = docSnap.data();
            setUserRecord(rec);
            
            if (rec.credits !== undefined && typeof rec.credits === 'number') {
                state.userCredits = rec.credits;
                localStorage.setItem('userCredits', String(rec.credits));
            } else {
                const initialCredits = 10000;
                state.userCredits = initialCredits;
                localStorage.setItem('userCredits', String(initialCredits));
                await updateDoc(userRef, { credits: initialCredits });
            }

            // Sync Render Minutes Quota & Usage (default: 10 minutes)
            state.renderMinutesQuota = typeof rec.renderMinutesQuota === 'number' ? rec.renderMinutesQuota : 10;
            state.renderMinutesUsed = typeof rec.renderMinutesUsed === 'number' ? rec.renderMinutesUsed : 0;

            // Auto-upgrade the main admin or owner role if needed
            const isOwner = isOwnerEmail(user.email) || isUserOwner(user, rec);
            if (isOwner) {
                if (rec.role !== 'owner' || rec.status !== 'approved' || (rec.credits || 0) < 500000) {
                    await updateDoc(userRef, {
                        status: 'approved',
                        role: 'owner',
                        credits: (typeof rec.credits === 'number' && rec.credits >= 1000000) ? rec.credits : 1000000,
                        renderMinutesQuota: 999999,
                        allowImageGeneration: true,
                        allowAudioGeneration: true,
                        allowVideoGeneration: true,
                        maxApprovedUsers: 9999,
                        updatedAt: serverTimestamp()
                    });
                    rec.status = 'approved';
                    rec.role = 'owner';
                    rec.credits = (typeof rec.credits === 'number' && rec.credits >= 1000000) ? rec.credits : 1000000;
                    rec.renderMinutesQuota = 999999;
                    rec.allowImageGeneration = true;
                    rec.allowAudioGeneration = true;
                    rec.allowVideoGeneration = true;
                    rec.maxApprovedUsers = 9999;
                    state.userCredits = rec.credits;
                    localStorage.setItem('userCredits', String(rec.credits));
                    setUserRecord(rec);
                }
            } else if (rec.role === 'admin' && rec.status !== 'approved') {
                await updateDoc(userRef, {
                    status: 'approved',
                    updatedAt: serverTimestamp()
                });
                rec.status = 'approved';
                setUserRecord(rec);
            }
        } else {
            const cleanUserEmail = user.email ? user.email.toLowerCase().trim() : '';
            const isOwner = isOwnerEmail(cleanUserEmail);
            const defaultInitialCredits = isOwner ? 1000000 : 10000;

            // Check if user was previously deleted by admin to prevent unauthorized re-entry (NEVER block owners)
            if (cleanUserEmail && !isAdmin && !isOwner) {
                try {
                    const delSnap = await getDoc(doc(db, 'deletedUsers', cleanUserEmail));
                    if (delSnap.exists()) {
                        setUserRecord(null);
                        ui.showStatus('Access denied: This account was deleted or rejected by an administrator.', true, 8000);
                        updateAuthUI();
                        return;
                    }
                } catch (delErr) {
                    console.warn("Could not check deletedUsers (ignoring non-fatal read error):", delErr);
                }
            } else if (isOwner && cleanUserEmail) {
                // Self-healing: if owner was ever in deletedUsers, remove it immediately
                try {
                    await deleteDoc(doc(db, 'deletedUsers', cleanUserEmail)).catch(() => {});
                } catch {}
            }

            // Check if an unlinked or pre-provisioned document already exists for this email in Firestore
            let preExistingData: any = null;
            const duplicateDocIds: string[] = [];
            if (cleanUserEmail) {
                try {
                    const eq = query(collection(db, 'users'), where('email', '==', cleanUserEmail));
                    const esnap = await getDocs(eq);
                    if (!esnap.empty) {
                        const candidates: Array<{ id: string; data: any }> = [];
                        esnap.forEach(d => {
                            if (d.id !== user.uid) {
                                candidates.push({ id: d.id, data: d.data() });
                                duplicateDocIds.push(d.id);
                            }
                        });
                        if (candidates.length > 0) {
                            candidates.sort((a, b) => getDocPermissionScore(b.id, b.data, cleanUserEmail) - getDocPermissionScore(a.id, a.data, cleanUserEmail));
                            preExistingData = candidates[0].data;
                        }
                    }
                } catch (qErr) {
                    console.debug("Silent pre-existing user search note:", qErr);
                }

                // Check approvedEmails collection as well
                if (!preExistingData) {
                    try {
                        const appSnap = await getDoc(doc(db, 'approvedEmails', cleanUserEmail));
                        if (appSnap.exists()) {
                            preExistingData = appSnap.data();
                        }
                    } catch {}
                }
            }

            const isAutoApproved = state.systemConfig?.requireAdminApproval === false;
            const finalRole = isOwner ? 'owner' : (preExistingData?.role || (isAdmin ? 'admin' : 'user'));
            const finalStatus = isOwner ? 'approved' : (preExistingData?.status ? preExistingData.status : (isAutoApproved ? 'approved' : 'pending'));
            const finalCredits = isOwner ? 1000000 : (typeof preExistingData?.credits === 'number' ? preExistingData.credits : defaultInitialCredits);
            let finalDisplayName = user.displayName || preExistingData?.displayName || (user.email ? user.email.split('@')[0] : defaultName);
            if (isUrlOrLink(finalDisplayName)) {
                finalDisplayName = cleanUserEmail ? cleanUserEmail.split('@')[0] : 'User';
            }

            const defaultRenderMinutesQuota = 10;
            const newUser: any = {
                email: cleanUserEmail,
                displayName: finalDisplayName,
                status: finalStatus,
                role: finalRole,
                credits: finalCredits,
                renderMinutesQuota: isOwner ? 999999 : (typeof preExistingData?.renderMinutesQuota === 'number' ? preExistingData.renderMinutesQuota : defaultRenderMinutesQuota),
                renderMinutesUsed: typeof preExistingData?.renderMinutesUsed === 'number' ? preExistingData.renderMinutesUsed : 0,
                allowImageGeneration: isOwner ? true : (preExistingData?.allowImageGeneration ?? true),
                allowAudioGeneration: isOwner ? true : (preExistingData?.allowAudioGeneration ?? true),
                allowVideoGeneration: isOwner ? true : (preExistingData?.allowVideoGeneration ?? true),
                createdAt: preExistingData?.createdAt || serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            if (isOwner) {
                newUser.maxApprovedUsers = 9999;
            } else {
                if (preExistingData?.assignedBy) newUser.assignedBy = preExistingData.assignedBy;
                if (preExistingData?.maxApprovedUsers) newUser.maxApprovedUsers = preExistingData.maxApprovedUsers;
            }

            try {
                await setDoc(userRef, newUser, { merge: true });
            } catch (saveErr) {
                console.warn("Could not setDoc on userRef, using local record:", saveErr);
            }
            setUserRecord(newUser);
            state.userCredits = newUser.credits;
            localStorage.setItem('userCredits', String(newUser.credits));

            // Clean up unlinked duplicate documents now that the canonical user.uid record exists
            for (const dupId of duplicateDocIds) {
                deleteDoc(doc(db, 'users', dupId)).catch(() => {});
            }

            if (!user.displayName && newUser.displayName) {
                try {
                    await updateProfile(user, { displayName: newUser.displayName });
                } catch (e) {
                    console.error("Failed to update profile display name:", e);
                }
            }
        }

        // Automatic deduplication: guarantee only ONE canonical document exists for this email with Auth UID
        if (user.email) {
            const cleanUserEmail = user.email.toLowerCase().trim();
            try {
                const dupQuery = query(collection(db, 'users'), where('email', '==', cleanUserEmail));
                const dupSnap = await getDocs(dupQuery);
                if (dupSnap.size > 1) {
                    const dupDocs: Array<{ id: string; data: any }> = [];
                    dupSnap.forEach(d => dupDocs.push({ id: d.id, data: d.data() }));
                    await executeDeduplication([{ email: cleanUserEmail, docs: dupDocs }]);
                }
            } catch (dupErr) {
                console.debug("Silent login dedup check skipped:", dupErr);
            }
        }
    } catch (e: any) {
        console.warn("Firestore user sync failed:", e?.message || e);
        // Ensure user is NEVER stranded without a valid userRecord after genuine Firebase Auth
        if (!userRecord && user) {
            const isOwner = isOwnerEmail(user.email);
            const isAdmin = isUserAdmin(user, null);
            const isAutoApproved = state.systemConfig?.requireAdminApproval === false;
            const fallbackRecord: any = {
                email: user.email ? user.email.toLowerCase().trim() : '',
                displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
                status: isOwner ? 'approved' : (isAutoApproved ? 'approved' : 'pending'),
                role: isOwner ? 'owner' : (isAdmin ? 'admin' : 'user'),
                credits: isOwner ? 1000000 : 10000,
                renderMinutesQuota: isOwner ? 999999 : 10,
                renderMinutesUsed: 0,
                allowImageGeneration: true,
                allowAudioGeneration: true,
                allowVideoGeneration: true,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            setUserRecord(fallbackRecord);
            state.userCredits = fallbackRecord.credits;
            localStorage.setItem('userCredits', String(fallbackRecord.credits));
        }
    }
}

export function goBackToHome() {
    if (dom.appContainer) dom.appContainer.classList.add('hidden');
    if (dom.landingPage) dom.landingPage.classList.remove('hidden');
}
