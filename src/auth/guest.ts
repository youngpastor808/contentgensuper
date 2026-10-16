import { state } from '../state';
import * as ui from '../ui';
import {
    isDesktopApp,
    isUserAdmin,
    showAuthError,
    hideAuthError,
    currentUser,
    userRecord,
    isGuestMode,
    setCurrentUser,
    setUserRecord,
    setIsGuestMode
} from './session';
import { updateAuthUI } from './profile-ui';

export function handleGuestLogin() {
    if (isDesktopApp() && state.systemConfig?.disableDesktopOfflineMode) {
        showAuthError("Desktop guest and offline access has been disabled by the administrator. Please log in with your registered account.");
        ui.showStatus("Desktop offline access is disabled by admin. Please log in.", true, 5000);
        return;
    }

    setIsGuestMode(true); // Guest mode will now enforce limits
    setUserRecord({
        email: 'guest@contentgen.ai',
        displayName: 'Guest Creator',
        status: 'approved',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date()
    });
    // Provide a mock user object so that other parts of the app think we have a real user
    setCurrentUser({
        uid: 'local_session_' + Date.now(),
        email: 'guest@contentgen.ai',
        displayName: 'Guest Creator',
    } as any);
    
    hideAuthError();
    updateAuthUI();
}

export function showGuestRestrictionModal(actionName: string = "Create Storyboard") {
    let modal = document.getElementById('guest-restriction-modal') as HTMLDivElement;
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'guest-restriction-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200';
        modal.innerHTML = `
            <div class="bg-gray-900 border border-indigo-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
                <div class="flex items-center gap-3 text-indigo-400">
                    <div class="p-2.5 bg-indigo-950/80 rounded-xl border border-indigo-500/30">
                        <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-white">Sign In Required</h3>
                        <p class="text-xs text-indigo-300">Guest Access Limit</p>
                    </div>
                </div>

                <div class="space-y-2 text-sm text-gray-300">
                    <p id="guest-modal-msg" class="leading-relaxed">
                        Guest mode is limited to script writing, style suggestions, and pre-production exploration.
                    </p>
                    <div class="text-xs text-indigo-200 font-medium bg-indigo-950/40 p-3 rounded-xl border border-indigo-500/20 space-y-1">
                        <div class="flex items-center gap-1.5 text-green-400 font-semibold">
                            <span>✓ Guest Mode:</span> Script Editor, Analysis, Style Suggestions
                        </div>
                        <div class="flex items-center gap-1.5 text-amber-300 font-semibold">
                            <span>🔒 Account Required:</span> Storyboards, Scene Generation, Audio TTS & Exports
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-3 pt-2">
                    <button id="guest-modal-login-btn" class="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-1.5 cursor-pointer">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"></path>
                        </svg>
                        <span>Sign In / Register</span>
                    </button>
                    <button id="guest-modal-close-btn" class="bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-2.5 px-4 rounded-xl text-sm transition border border-gray-700 cursor-pointer">
                        <span>Cancel</span>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('#guest-modal-close-btn')?.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.querySelector('#guest-modal-login-btn')?.addEventListener('click', () => {
            modal.classList.add('hidden');
            // Log out from guest mode and trigger the main auth overlay
            setIsGuestMode(false);
            setCurrentUser(null);
            setUserRecord(null);
            updateAuthUI();
        });
    }

    const msgEl = modal.querySelector('#guest-modal-msg');
    if (msgEl) {
        msgEl.innerHTML = `<strong class="text-white">${actionName}</strong> is a production feature reserved for registered accounts. Please log in or create an account to unlock storyboards, scene generation, audio TTS, and video rendering.`;
    }

    modal.classList.remove('hidden');
}

export function checkGuestRestriction(actionName: string = "Creating Storyboards"): boolean {
    const isAdmin = isUserAdmin(currentUser, userRecord);
    if (isAdmin) {
        return false;
    }

    const hasOwnKey = !!(
        state.userGeminiApiKey ||
        localStorage.getItem('userGeminiApiKey') ||
        state.openaiGatewayApiKey ||
        localStorage.getItem('openaiGatewayApiKey')
    );

    // If user is authenticated as registered account, verify approval status
    if (!isGuestMode && currentUser) {
        const status = userRecord?.status;
        if (status && status !== 'approved' && status !== 'active') {
            if (hasOwnKey) {
                return false; // Sensible escape for BYOK
            }
            if (status === 'banned' || status === 'restricted' || status === 'rejected') {
                ui.showStatus(`Action blocked: Account is ${status}.`, true, 5000);
            } else {
                ui.showStatus(`Action blocked: Your account is pending administrator approval.`, true, 5000);
            }
            updateAuthUI();
            return true;
        }
        return false;
    }
    // If guest restrictions are disabled globally by admin, allow
    if (state.systemConfig?.enforceGuestRestrictions === false) {
        return false;
    }
    // If the visitor/guest has supplied their own personal API key, allow them to use their own quota
    if (hasOwnKey) {
        return false;
    }

    // Block guest and display restriction modal
    showGuestRestrictionModal(actionName);
    return true;
}
