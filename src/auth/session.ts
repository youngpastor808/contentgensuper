import { auth, User } from '../firebase';
import * as dom from '../dom';
import { isUsingPersonalKey } from '../api/core';

export let currentUser: User | null = null;
export let userRecord: any = null;
export let isGuestMode: boolean = false;

export let adminUsersUnsubscribe: (() => void) | null = null;
export let userDocUnsubscribe: (() => void) | null = null;

export function setCurrentUser(user: User | null) {
    currentUser = user;
}

export function setUserRecord(record: any) {
    userRecord = record;
}

export function setIsGuestMode(val: boolean) {
    isGuestMode = val;
}

export function setAdminUsersUnsubscribe(fn: (() => void) | null) {
    adminUsersUnsubscribe = fn;
}

export function setUserDocUnsubscribe(fn: (() => void) | null) {
    userDocUnsubscribe = fn;
}

export const OWNER_EMAILS = [
    'youngpastor808@gmail.com',
    'bwaimatwaima@gmail.com'
];
export const SUPER_ADMIN_EMAILS = [
    'youngpastor808@gmail.com',
    'bwaimatwaima@gmail.com'
];
export const SUPER_ADMIN_EMAIL = 'youngpastor808@gmail.com';
export const ORIGINAL_OWNER_EMAIL = 'youngpastor808@gmail.com';

export function isOwnerEmail(email: string | null | undefined): boolean {
    if (!email) return false;
    const lower = email.toLowerCase().trim();
    return OWNER_EMAILS.some(o => o.toLowerCase().trim() === lower);
}

/**
 * Standardized Owner check.
 * The Owner holds top-level authority over the workspace, cannot be deleted, and can transfer ownership.
 */
export function isUserOwner(user: User | null = currentUser, record: any = userRecord): boolean {
    const email = (user?.email || record?.email || auth.currentUser?.email || '').trim().toLowerCase();
    if (isOwnerEmail(email)) return true;
    if (record?.role === 'owner' && isOwnerEmail(email)) return true;
    return false;
}

export function isImageGenAllowedForCurrentUser(): boolean {
    if (isGuestMode) return true;
    if (isUsingPersonalKey(true)) return true;
    // Explicit user-level permission switch (honored for both admins, resellers, and regular users)
    if (userRecord && typeof userRecord.allowImageGeneration === 'boolean') {
        return userRecord.allowImageGeneration;
    }
    // Fallback if unset: admins are enabled by default, normal users require explicit permission
    if (isUserAdmin(currentUser, userRecord)) return true;
    return false;
}

export function isAudioGenAllowedForCurrentUser(): boolean {
    if (isGuestMode) return true;
    if (isUsingPersonalKey(true)) return true;
    // Explicit user-level permission switch (honored for both admins, resellers, and regular users)
    if (userRecord && typeof userRecord.allowAudioGeneration === 'boolean') {
        return userRecord.allowAudioGeneration;
    }
    // Fallback if unset: admins are enabled by default, normal users require explicit permission
    if (isUserAdmin(currentUser, userRecord)) return true;
    return false;
}

export function isVideoGenAllowedForCurrentUser(): boolean {
    if (isGuestMode) return true;
    if (isUsingPersonalKey(true)) return true;
    // Explicit user-level permission switch (honored for both admins, resellers, and regular users)
    if (userRecord && typeof userRecord.allowVideoGeneration === 'boolean') {
        return userRecord.allowVideoGeneration;
    }
    // Fallback if unset: admins are enabled by default, normal users require explicit permission
    if (isUserAdmin(currentUser, userRecord)) return true;
    return false;
}

export function isCookieAuthAllowedForCurrentUser(user: User | null = currentUser, record: any = userRecord): boolean {
    if (isGuestMode) return false;
    // Explicit user-level permission switch (honored for both admins, resellers, and regular users)
    if (record && typeof record.allowCookieAuth === 'boolean') {
        return record.allowCookieAuth;
    }
    // Fallback if unset: admins/owners are enabled by default, normal users require explicit permission from admin
    if (isUserAdmin(user, record)) return true;
    return false;
}

/**
 * Standardized administrator check.
 * Verifies case-insensitively against owner, super admin email, and Firestore user role.
 */
export function isUserAdmin(user: User | null = currentUser, record: any = userRecord): boolean {
    if (isUserOwner(user, record)) return true;
    const email = (user?.email || record?.email || auth.currentUser?.email || '').trim().toLowerCase();
    if (isOwnerEmail(email)) return true;
    if (SUPER_ADMIN_EMAILS.some(s => s.toLowerCase().trim() === email) || email === SUPER_ADMIN_EMAIL.toLowerCase()) return true;
    return record?.role === 'admin' || record?.role === 'owner';
}

/**
 * Standardized reseller check.
 */
export function isUserReseller(record: any = userRecord): boolean {
    return record?.role === 'reseller';
}

/**
 * Standardized manager check (Admin or Reseller).
 */
export function isUserManager(user: User | null = currentUser, record: any = userRecord): boolean {
    return isUserAdmin(user, record) || isUserReseller(record);
}

export function isDesktopApp(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(
        (window as any).electronAPI ||
        window.location.protocol === 'file:' ||
        navigator.userAgent.toLowerCase().includes('electron')
    );
}

export function isGuest(): boolean {
    if (isGuestMode) return true;
    if (!currentUser) return true;
    if ((currentUser as any).isAnonymous) return true;
    if (typeof (currentUser as any).uid === 'string' && (currentUser as any).uid.startsWith('local_session_')) return true;
    return false;
}

export function isApprovedMember(user: User | null = currentUser, record: any = userRecord): boolean {
    if (isGuestMode) return false;
    if (!user && !record && !auth.currentUser) return false;
    if (isGuest()) return false;
    if (isUserOwner(user, record)) return true;
    if (isUserAdmin(user, record)) return true;
    const email = (user?.email || record?.email || auth.currentUser?.email || '').trim().toLowerCase();
    if (email && isOwnerEmail(email)) return true;
    const status = record?.status;
    return status === 'approved' || status === 'active';
}

export async function sha256Hex(text: string): Promise<string> {
    try {
        const msgUint8 = new TextEncoder().encode(text);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
        return '';
    }
}

export function formatAuthErrorMessage(error: any, action?: 'login' | 'signup' | 'reset'): string {
    const code = error?.code || '';
    const message = error?.message || '';
    if (code === 'auth/unauthorized-domain' || message.includes('auth/unauthorized-domain') || message.includes('unauthorized-domain')) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'your Google Cloud URL';
        return `Firebase Auth: Unauthorized Domain (${currentHost}). Google Sign-In requires your app domain to be added to Firebase Console > Authentication > Settings > Authorized domains. To resolve: click the link in the notification to add "${currentHost}". Alternatively, you can log in with Email/Password or Continue as Guest immediately.`;
    }
    if (code === 'auth/api-key-not-found' || code.includes('api-key-not-found') || message.includes('api-key-not-found') || message.includes('API Key not found') || message.includes('API key not valid')) {
        return 'Firebase Authentication API key is not recognized or restricted by Google Cloud (Identity Toolkit API not enabled for this key). Enter your email and click Log In to enter offline, or click "Launch Desktop Creator Studio" or "Continue as Guest".';
    }
    if (code === 'auth/network-request-failed' || message.includes('network-request-failed') || message.includes('Network request failed')) {
        return 'Network connection to Firebase Auth failed. This usually occurs if an ad blocker or privacy extension (e.g. uBlock, Brave Shields) is blocking Google authentication endpoints, or if your connection dropped. Please check your internet, disable ad blocking for this page, or click "Continue as Guest".';
    }
    if (code === 'auth/operation-not-allowed' || message.includes('auth/operation-not-allowed')) {
        return 'Email/Password sign-in provider is disabled in Firebase Console. Please enable "Email/Password" under Firebase Console > Authentication > Sign-in method. You can also sign in with Google or Continue as Guest.';
    }
    if (code === 'auth/email-already-in-use') {
        return 'This email is already registered. Please enter your password and click "Log In", or click "Forgot password?".';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        if (action === 'login') {
            return 'Invalid email or password. Click "Sign Up" to create an account, or "Continue as Guest" for instant access.';
        }
        return 'Invalid email or password.';
    }
    if (code === 'auth/invalid-email') {
        return 'Please enter a valid email address.';
    }
    if (code === 'auth/weak-password') {
        return 'Password should be at least 6 characters.';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
        return 'Sign-in popup was cancelled or closed. You can click "Continue as Guest" for instant access.';
    }
    if (code === 'auth/too-many-requests') {
        return 'Too many failed attempts. Reset your password or click "Continue as Guest".';
    }
    return message || 'Authentication failed. Click "Continue as Guest" to enter instantly.';
}

export function showAuthError(msg: string) {
    if (dom.authErrorMsg) {
        dom.authErrorMsg.textContent = msg;
        dom.authErrorMsg.classList.remove('hidden', 'text-green-400');
        dom.authErrorMsg.classList.add('text-red-500');
    }
}

export function showAuthSuccess(msg: string) {
    if (dom.authErrorMsg) {
        dom.authErrorMsg.textContent = msg;
        dom.authErrorMsg.classList.remove('hidden', 'text-red-500');
        dom.authErrorMsg.classList.add('text-green-400');
    }
}

export function hideAuthError() {
    if (dom.authErrorMsg) {
        dom.authErrorMsg.classList.add('hidden');
    }
}

export function openLoginModal() {
    if (dom.appContainer && dom.appContainer.classList.contains('hidden')) {
        dom.appContainer.classList.remove('hidden');
        if (dom.landingPage) dom.landingPage.classList.add('hidden');
    }
    if (dom.authOverlay) {
        dom.authOverlay.classList.remove('hidden');
        if (dom.authFormContainer) dom.authFormContainer.classList.remove('hidden');
        if (dom.authPendingCard) dom.authPendingCard.classList.add('hidden');
        if (dom.authTitle) dom.authTitle.textContent = "Sign In or Register";
        if (dom.authMessage) dom.authMessage.textContent = "Log in to sync your cloud settings and project versions.";
    }
}

export function closeLoginModal() {
    if (dom.authOverlay) {
        dom.authOverlay.classList.add('hidden');
    }
}

let adminAddUserMsgTimeout: any = null;

export function clearAdminAddUserMsg() {
    if (adminAddUserMsgTimeout) {
        clearTimeout(adminAddUserMsgTimeout);
        adminAddUserMsgTimeout = null;
    }
    if (dom.adminAddUserMsg) {
        dom.adminAddUserMsg.textContent = '';
        dom.adminAddUserMsg.classList.add('hidden');
        dom.adminAddUserMsg.classList.remove('bg-red-900/40', 'text-red-300', 'border-red-700', 'bg-green-900/40', 'text-green-300', 'border-green-700', 'border');
    }
}

export function showAdminAddUserMsg(msg: string, type: 'error' | 'success' | 'info', durationMs: number = 4000) {
    if (!dom.adminAddUserMsg) return;
    if (adminAddUserMsgTimeout) {
        clearTimeout(adminAddUserMsgTimeout);
        adminAddUserMsgTimeout = null;
    }
    dom.adminAddUserMsg.textContent = msg;
    dom.adminAddUserMsg.classList.remove('hidden', 'bg-red-900/40', 'text-red-300', 'border-red-700', 'bg-green-900/40', 'text-green-300', 'border-green-700', 'bg-blue-900/40', 'text-blue-300', 'border-blue-700', 'border');
    if (type === 'error') {
        dom.adminAddUserMsg.classList.add('bg-red-900/40', 'text-red-300', 'border', 'border-red-700');
    } else if (type === 'info') {
        dom.adminAddUserMsg.classList.add('bg-blue-900/40', 'text-blue-300', 'border', 'border-blue-700');
    } else {
        dom.adminAddUserMsg.classList.add('bg-green-900/40', 'text-green-300', 'border', 'border-green-700');
    }
    if (durationMs > 0) {
        adminAddUserMsgTimeout = setTimeout(() => {
            clearAdminAddUserMsg();
        }, durationMs);
    }
}

/**
 * Validates whether a candidate username string is a website URL or link (e.g. YouTube, HTTP, WWW, or spam link).
 */
export function isUrlOrLink(str: string | null | undefined): boolean {
    if (!str) return false;
    const trimmed = str.trim();
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (/^www\./i.test(trimmed)) return true;
    if (/\b(youtu\.be|youtube\.com|t\.me|bit\.ly|tinyurl\.com)\b/i.test(trimmed)) return true;
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(trimmed) && !trimmed.includes('@')) return true;
    return false;
}
