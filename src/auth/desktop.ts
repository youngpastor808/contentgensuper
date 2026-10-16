import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import { safeJsonStringify } from '../utils-core';
import {
  isUserAdmin,
  sha256Hex,
  showAuthError,
  hideAuthError,
  openLoginModal,
  currentUser,
  userRecord,
  isGuestMode,
  setCurrentUser,
  setUserRecord,
  setIsGuestMode,
} from './session';
import { syncUserCredits } from './credits';
import { updateAuthUI } from './profile-ui';

export function loginAsLocalUser(email: string, displayName?: string) {
  const cleanEmail = email.toLowerCase().trim();
  const name = displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'User');
  const uid = 'local_user_' + cleanEmail.replace(/[^a-z0-9]/g, '_');

  const savedCredits = localStorage.getItem('userCredits');
  const targetCredits = savedCredits !== null && !isNaN(Number(savedCredits)) ? Number(savedCredits) : 50000;

  const localUserObj = {
    uid,
    email: cleanEmail,
    displayName: name,
    photoURL: null,
  };

  // Never elevate unauthenticated local sessions to 'owner' or 'admin' based on typed email
  const record = {
    email: cleanEmail,
    displayName: name,
    status: 'approved',
    role: 'user',
    credits: targetCredits,
    renderMinutesQuota: 10,
    renderMinutesUsed: 0,
    allowImageGeneration: true,
    allowAudioGeneration: true,
    allowVideoGeneration: true,
    maxApprovedUsers: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  setCurrentUser(localUserObj as any);
  setUserRecord(record);
  setIsGuestMode(false);
  localStorage.setItem('local_auth_session', safeJsonStringify({ user: localUserObj, record }));
  syncUserCredits(targetCredits);

  try {
    setDoc(doc(db, 'users', uid), record, { merge: true }).catch((err) =>
      console.warn('Firestore sync skipped:', err)
    );
  } catch (e) {
    console.warn('Could not trigger Firestore doc creation for local user:', e);
  }

  hideAuthError();
  updateAuthUI();
  ui.showStatus(`Successfully logged in as ${name}!`, false, 4000);
}

export async function verifyDesktopStudioPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const trimmed = password.trim();

  // 1. Try server-side secure verification endpoint if available
  try {
    const resp = await fetch('/api/auth/verify-desktop-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: trimmed }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data?.valid) return true;
    } else if (resp.status === 401) {
      // Server has a password configured and explicitly rejected this attempt
      return false;
    }
    // If 404/403 (not configured on server), fall through to Firestore/hash verification
  } catch {
    // Server unreachable or offline — proceed to local/Firestore check
  }

  // 2. Check against private system config if loaded by administrator
  const adminSetPass = state.privateSystemConfig?.desktopStudioPassword;
  if (adminSetPass && adminSetPass.trim()) {
    if (trimmed === adminSetPass.trim()) return true;
  }

  // 3. Check against public config SHA-256 hash or cached hash
  const publicHash =
    state.systemConfig?.desktopStudioPasswordHash || localStorage.getItem('cg_desktop_studio_password_hash');
  if (publicHash) {
    const computed = await sha256Hex(trimmed);
    if (computed && computed === publicHash) return true;
  }

  return false;
}

export async function handleDesktopLogin() {
  if (state.systemConfig?.disableDesktopOfflineMode) {
    showAuthError(
      'Desktop full access offline mode has been disabled by the administrator. Please log in with your registered account.'
    );
    ui.showStatus('Desktop full access offline mode is disabled by admin.', true, 5000);
    return;
  }

  const enteredEmail = dom.authEmailInput?.value?.trim() || 'creator@contentgen.ai';
  const enteredUsername = dom.authUsernameInput?.value?.trim() || 'Desktop Creator';
  const enteredPassword = dom.authPasswordInput?.value?.trim() || '';

  if (!enteredPassword) {
    showAuthError('Please enter the Desktop Studio password.');
    dom.authPasswordInput?.focus();
    return;
  }

  const isValid = await verifyDesktopStudioPassword(enteredPassword);
  if (!isValid) {
    showAuthError(
      'Incorrect Desktop Studio password. Please enter the authorized desktop password configured by your administrator.'
    );
    if (dom.authPasswordInput) {
      dom.authPasswordInput.focus();
      dom.authPasswordInput.select();
    }
    return;
  }

  loginAsLocalUser(enteredEmail, enteredUsername);
}

export function enforceDesktopOfflineRestrictions() {
  if (state.systemConfig?.disableDesktopOfflineMode) {
    const isAdmin = isUserAdmin(currentUser, userRecord);
    const isLocalOrGuest =
      (currentUser as any)?.uid?.startsWith('local_user_') ||
      (currentUser as any)?.uid?.startsWith('local_session_') ||
      isGuestMode ||
      !!localStorage.getItem('local_auth_session');

    if (isLocalOrGuest && !isAdmin) {
      localStorage.removeItem('local_auth_session');
      setCurrentUser(null);
      setUserRecord(null);
      setIsGuestMode(false);
      openLoginModal();
      showAuthError(
        'Desktop offline mode has been disabled by the administrator. Please log in with your registered account.'
      );
      ui.showStatus('Desktop offline access disabled by admin. Please log in with an approved account.', true, 6000);
    }
  }
}
