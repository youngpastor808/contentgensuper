/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { doc, setDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { state } from './state';
import * as dom from './dom';
import { updateDynamicCreditCosts, CREDIT_COSTS } from './constants';
import { currentUser, userRecord, updateAuthUI, openAdminPanel, openLoginModal, enforceDesktopOfflineRestrictions, sha256Hex, isUserAdmin } from './auth';
import { renderHeaderAd } from './handlers-ads';
import { startAppFromLanding } from './handlers-misc';
import { renderSafeStatus, escapeHtml } from './utils';
import {
    adminTabUsersBtn,
    adminTabKeysBtn,
    adminTabCreditsBtn,
    adminTabMaintenanceBtn,
    adminSectionUsers,
    adminSectionKeys,
    adminSectionCredits,
    adminSectionMaintenance,
    adminSysGeminiAuthApiKeyBtn,
    adminSysGeminiAuthCookieBtn,
    adminSysGeminiKeyContainer,
    adminSysGeminiCookieContainer,
    adminSysGeminiKeyInput,
    adminSysGeminiPsidInput,
    adminSysGeminiPsidtsInput,
    adminSysGeminiPsidccInput,
    adminSysGeminiCompassInput,
    adminSysGeminiSidInput,
    adminSysGeminiHsidInput,
    adminSysGeminiSsidInput,
    adminSysElevenlabsKeyInput,
    adminSysDeepgramKeyInput,
    adminSysStabilityKeyInput,
    adminSysAi33KeyInput,
    adminSysPexelsKeyInput,
    adminSysGradioUrlInput,
    adminSysDisableImageGenToggle,
    adminSysImageGenBadge,
    adminSaveSystemKeysBtn,
    adminClearSystemKeysBtn,
    adminSystemKeysMsg,
    adminCostVideoGenInput,
    adminCostImageGeminiInput,
    adminCostImageImagenInput,
    adminCostAudioElevenlabsInput,
    adminCostAudioAlignedInput,
    adminCostAudioCloningInput,
    adminSaveCreditCostsBtn,
    adminResetCreditCostsBtn,
    adminCreditCostsMsg,
    adminMaintenanceToggle,
    adminShowAdsIconToggle,
    adminAdsIconStatusBadge,
    adminMaintenanceMessageInput,
    adminDesktopOfflineToggle,
    adminDesktopOfflineStatusBadge,
    adminSaveMaintenanceBtn,
    adminMaintenanceMsg,
    adminMaintenanceStatusBadge,
    maintenanceModeOverlay,
    maintenanceOverlayMessage,
    maintenanceOverlayAdminLoginBtn,
    appContainer,
    adminPanel
} from './dom';

let activeAdminGeminiAuthMode: 'apiKey' | 'webCookie' | 'openaiGateway' = 'apiKey';
let activeAdminVertexAuthMode: 'apiKey' | 'adc' = 'apiKey';

/**
 * Initializes real-time listener for settings/system_config Firestore document.
 */
export async function loadPrivateSystemConfigForAdmin(): Promise<void> {
    if (!db || !auth.currentUser || auth.currentUser.isAnonymous) return;
    const isAdmin = isUserAdmin();
    if (!isAdmin) return;

    try {
        const privateRef = doc(db, 'settings', 'system_config');
        const snapshot = await getDoc(privateRef);
        const data = snapshot.exists() ? snapshot.data() : {};
        state.privateSystemConfig = {
            systemGeminiApiKey: data.systemGeminiApiKey || '',
            systemGeminiAuthMode: (data.systemGeminiAuthMode === 'webCookie' ? 'webCookie' : (data.systemGeminiAuthMode === 'openaiGateway' ? 'openaiGateway' : 'apiKey')) as 'apiKey' | 'webCookie' | 'adc' | 'openaiGateway',
            systemGeminiProvider: data.systemGeminiProvider || 'aistudio',
            systemVertexAuthMode: (data.systemVertexAuthMode === 'adc' ? 'adc' : 'apiKey') as 'apiKey' | 'adc',
            systemVertexProjectId: data.systemVertexProjectId || '',
            systemVertexLocation: data.systemVertexLocation || 'us-central1',
            systemOpenaiApiKey: data.systemOpenaiApiKey || '',
            systemOpenaiBaseUrl: data.systemOpenaiBaseUrl || '',
            systemOpenaiModel: data.systemOpenaiModel || '',
            systemOpenaiImageModel: data.systemOpenaiImageModel || '',
            systemGeminiPsid: data.systemGeminiPsid || '',
            systemGeminiPsidts: data.systemGeminiPsidts || '',
            systemGeminiPsidcc: data.systemGeminiPsidcc || '',
            systemGeminiCompass: data.systemGeminiCompass || '',
            systemGeminiSid: data.systemGeminiSid || '',
            systemGeminiHsid: data.systemGeminiHsid || '',
            systemGeminiSsid: data.systemGeminiSsid || '',
            systemElevenlabsApiKey: data.systemElevenlabsApiKey || '',
            systemDeepgramApiKey: data.systemDeepgramApiKey || '',
            systemStabilityApiKey: data.systemStabilityApiKey || '',
            systemAi33ApiKey: data.systemAi33ApiKey || '',
            systemPexelsApiKey: data.systemPexelsApiKey || '',
            systemFreesoundApiKey: data.systemFreesoundApiKey || '',
            systemGradioTtsUrl: data.systemGradioTtsUrl || '',
            customFirebaseApiKey: data.customFirebaseApiKey || localStorage.getItem('custom_firebase_api_key') || '',
            desktopStudioPassword: data.desktopStudioPassword || '',
        };
        syncSystemConfigInputs();
    } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'settings/system_config');
    }
}

export function initSystemConfigListener(): () => void {
    if (!db) return () => {};

    const sysConfigDocRef = doc(db, 'settings', 'public_config');

    const unsubscribe = onSnapshot(sysConfigDocRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.data();
            Object.assign(state.systemConfig, {
                maintenanceMode: !!data.maintenanceMode,
                maintenanceMessage: data.maintenanceMessage || 'System is undergoing scheduled maintenance. Please check back shortly.',
                disableDesktopOfflineMode: !!data.disableDesktopOfflineMode,
                disableSystemImageGeneration: !!data.disableSystemImageGeneration,
                disableSystemVideoGeneration: !!data.disableSystemVideoGeneration,
                disableSystemAudioGeneration: !!data.disableSystemAudioGeneration,
                showAdsAdminButton: !!data.showAdsAdminButton,
                desktopStudioPasswordHash: data.desktopStudioPasswordHash || '',
                requireAdminApproval: data.requireAdminApproval !== undefined ? !!data.requireAdminApproval : true,
                enforceGuestRestrictions: data.enforceGuestRestrictions !== undefined ? !!data.enforceGuestRestrictions : true,
                guestExportPolicy: data.guestExportPolicy || 'watermark_320p',
                creditCosts: {
                    IMAGE_GENERATION_GEMINI: data.creditCosts?.IMAGE_GENERATION_GEMINI ?? 5,
                    IMAGE_GENERATION_IMAGEN: data.creditCosts?.IMAGE_GENERATION_IMAGEN ?? 10,
                    AUDIO_GENERATION_ELEVENLABS_INSTANT: data.creditCosts?.AUDIO_GENERATION_ELEVENLABS_INSTANT ?? 10,
                    AUDIO_GENERATION_ALIGNED: data.creditCosts?.AUDIO_GENERATION_ALIGNED ?? 5,
                    AUDIO_CLONING_MINIMAX: data.creditCosts?.AUDIO_CLONING_MINIMAX ?? 20,
                    VIDEO_GENERATION: data.creditCosts?.VIDEO_GENERATION ?? 100,
                    TEXT_GENERATION_PER_TOKEN: data.creditCosts?.TEXT_GENERATION_PER_TOKEN ?? (1 / 100),
                }
            });

            if (data.desktopStudioPasswordHash) {
                localStorage.setItem('cg_desktop_studio_password_hash', data.desktopStudioPasswordHash);
            }

            // Cache desktop setting for offline/cold boot persistence
            localStorage.setItem('cg_disable_desktop_offline_mode', String(!!data.disableDesktopOfflineMode));

            // Dynamically update runtime CREDIT_COSTS
            if (state.systemConfig.creditCosts) {
                updateDynamicCreditCosts(state.systemConfig.creditCosts);
            }

            // Sync inputs if not currently focused
            syncSystemConfigInputs();

            // Enforce Maintenance Mode
            applyMaintenanceModeState();

            // Enforce Desktop Offline Mode restrictions (kick out local/guest sessions if disabled)
            enforceDesktopOfflineRestrictions();

            // Refresh Auth UI for desktop offline button visibility
            updateAuthUI();

            // Refresh Header Ads (to toggle admin manage button visibility)
            renderHeaderAd();
        }
    }, (error) => {
        console.warn("[SystemConfig] public_config sync notice:", error);
    });

    return unsubscribe;
}

/**
 * Syncs Firestore configuration to UI input controls
 */
export function syncSystemConfigInputs() {
    const sys = state.systemConfig;
    const priv = state.privateSystemConfig;
    if (!sys) return;

    // Sync Auth Mode UI
    activeAdminGeminiAuthMode = priv?.systemGeminiAuthMode === 'webCookie' ? 'webCookie' : (priv?.systemGeminiAuthMode === 'openaiGateway' ? 'openaiGateway' : 'apiKey');
    activeAdminVertexAuthMode = priv?.systemVertexAuthMode === 'adc' ? 'adc' : 'apiKey';
    updateAdminGeminiAuthUI();
    updateAdminVertexUITabs(priv?.systemGeminiProvider || "aistudio");
    updateAdminVertexAuthModeUI(activeAdminVertexAuthMode);

    if (dom.adminSysVertexProject && document.activeElement !== dom.adminSysVertexProject) {
        dom.adminSysVertexProject.value = priv?.systemVertexProjectId || "";
    }
    if (dom.adminSysVertexLocation && document.activeElement !== dom.adminSysVertexLocation) {
        dom.adminSysVertexLocation.value = priv?.systemVertexLocation || "us-central1";
    }

    if (dom.adminSysOpenaiKeyInput && document.activeElement !== dom.adminSysOpenaiKeyInput) {
        dom.adminSysOpenaiKeyInput.value = priv?.systemOpenaiApiKey || '';
    }
    if (dom.adminSysOpenaiBaseUrlInput && document.activeElement !== dom.adminSysOpenaiBaseUrlInput) {
        dom.adminSysOpenaiBaseUrlInput.value = priv?.systemOpenaiBaseUrl || 'https://api.openai.com/v1';
    }
    if (dom.adminSysOpenaiModelInput && document.activeElement !== dom.adminSysOpenaiModelInput) {
        dom.adminSysOpenaiModelInput.value = priv?.systemOpenaiModel || 'gpt-4o';
    }
    if (dom.adminSysOpenaiImageModelInput && document.activeElement !== dom.adminSysOpenaiImageModelInput) {
        dom.adminSysOpenaiImageModelInput.value = priv?.systemOpenaiImageModel || 'dall-e-3';
    }

    if (adminSysGeminiKeyInput && document.activeElement !== adminSysGeminiKeyInput) {
        adminSysGeminiKeyInput.value = priv?.systemGeminiApiKey || '';
    }
    if (adminSysGeminiPsidInput && document.activeElement !== adminSysGeminiPsidInput) {
        adminSysGeminiPsidInput.value = priv?.systemGeminiPsid || '';
    }
    if (adminSysGeminiPsidtsInput && document.activeElement !== adminSysGeminiPsidtsInput) {
        adminSysGeminiPsidtsInput.value = priv?.systemGeminiPsidts || '';
    }
    if (adminSysGeminiPsidccInput && document.activeElement !== adminSysGeminiPsidccInput) {
        adminSysGeminiPsidccInput.value = priv?.systemGeminiPsidcc || '';
    }
    if (adminSysGeminiCompassInput && document.activeElement !== adminSysGeminiCompassInput) {
        adminSysGeminiCompassInput.value = priv?.systemGeminiCompass || '';
    }
    if (adminSysGeminiSidInput && document.activeElement !== adminSysGeminiSidInput) {
        adminSysGeminiSidInput.value = priv?.systemGeminiSid || '';
    }
    if (adminSysGeminiHsidInput && document.activeElement !== adminSysGeminiHsidInput) {
        adminSysGeminiHsidInput.value = priv?.systemGeminiHsid || '';
    }
    if (adminSysGeminiSsidInput && document.activeElement !== adminSysGeminiSsidInput) {
        adminSysGeminiSsidInput.value = priv?.systemGeminiSsid || '';
    }
    if (adminSysElevenlabsKeyInput && document.activeElement !== adminSysElevenlabsKeyInput) {
        adminSysElevenlabsKeyInput.value = priv?.systemElevenlabsApiKey || '';
    }
    if (adminSysDeepgramKeyInput && document.activeElement !== adminSysDeepgramKeyInput) {
        adminSysDeepgramKeyInput.value = priv?.systemDeepgramApiKey || '';
    }
    if (adminSysStabilityKeyInput && document.activeElement !== adminSysStabilityKeyInput) {
        adminSysStabilityKeyInput.value = priv?.systemStabilityApiKey || '';
    }
    if (adminSysAi33KeyInput && document.activeElement !== adminSysAi33KeyInput) {
        adminSysAi33KeyInput.value = priv?.systemAi33ApiKey || '';
    }
    if (adminSysPexelsKeyInput && document.activeElement !== adminSysPexelsKeyInput) {
        adminSysPexelsKeyInput.value = priv?.systemPexelsApiKey || '';
    }
    if (adminSysGradioUrlInput && document.activeElement !== adminSysGradioUrlInput) {
        adminSysGradioUrlInput.value = priv?.systemGradioTtsUrl || '';
    }
    if (dom.adminSysFirebaseKeyInput && document.activeElement !== dom.adminSysFirebaseKeyInput) {
        dom.adminSysFirebaseKeyInput.value = priv?.customFirebaseApiKey || localStorage.getItem('custom_firebase_api_key') || '';
    }
    if (dom.adminSysDesktopPasswordInput && document.activeElement !== dom.adminSysDesktopPasswordInput) {
        dom.adminSysDesktopPasswordInput.value = priv?.desktopStudioPassword || localStorage.getItem('cg_desktop_studio_password') || '';
    }

    const activeDesktopPass = priv?.desktopStudioPassword || localStorage.getItem('cg_desktop_studio_password') || '';
    if (dom.adminDesktopPasswordInput && document.activeElement !== dom.adminDesktopPasswordInput) {
        dom.adminDesktopPasswordInput.value = activeDesktopPass;
    }
    updateDesktopPasswordBadge(activeDesktopPass);

    if (adminCostVideoGenInput && document.activeElement !== adminCostVideoGenInput) {
        adminCostVideoGenInput.value = String(sys.creditCosts?.VIDEO_GENERATION ?? 100);
    }
    if (adminCostImageGeminiInput && document.activeElement !== adminCostImageGeminiInput) {
        adminCostImageGeminiInput.value = String(sys.creditCosts?.IMAGE_GENERATION_GEMINI ?? 5);
    }
    if (adminCostImageImagenInput && document.activeElement !== adminCostImageImagenInput) {
        adminCostImageImagenInput.value = String(sys.creditCosts?.IMAGE_GENERATION_IMAGEN ?? 10);
    }
    if (adminCostAudioElevenlabsInput && document.activeElement !== adminCostAudioElevenlabsInput) {
        adminCostAudioElevenlabsInput.value = String(sys.creditCosts?.AUDIO_GENERATION_ELEVENLABS_INSTANT ?? 10);
    }
    if (adminCostAudioAlignedInput && document.activeElement !== adminCostAudioAlignedInput) {
        adminCostAudioAlignedInput.value = String(sys.creditCosts?.AUDIO_GENERATION_ALIGNED ?? 5);
    }
    if (adminCostAudioCloningInput && document.activeElement !== adminCostAudioCloningInput) {
        adminCostAudioCloningInput.value = String(sys.creditCosts?.AUDIO_CLONING_MINIMAX ?? 20);
    }

    if (adminMaintenanceToggle) {
        adminMaintenanceToggle.checked = !!sys.maintenanceMode;
    }
    if (adminShowAdsIconToggle) {
        adminShowAdsIconToggle.checked = !!sys.showAdsAdminButton;
    }
    updateAdsIconBadge(!!sys.showAdsAdminButton);
    if (adminMaintenanceMessageInput && document.activeElement !== adminMaintenanceMessageInput) {
        adminMaintenanceMessageInput.value = sys.maintenanceMessage || '';
    }

    if (adminDesktopOfflineToggle) {
        adminDesktopOfflineToggle.checked = !!sys.disableDesktopOfflineMode;
    }
    updateDesktopOfflineBadge(!!sys.disableDesktopOfflineMode);

    if (adminSysDisableImageGenToggle) {
        adminSysDisableImageGenToggle.checked = !!sys.disableSystemImageGeneration;
    }
    updateSystemImageGenBadge(!!sys.disableSystemImageGeneration);

    if (dom.adminSysDisableVideoGenToggle) {
        dom.adminSysDisableVideoGenToggle.checked = !!sys.disableSystemVideoGeneration;
    }
    updateSystemVideoGenBadge(!!sys.disableSystemVideoGeneration);

    if (dom.adminSysDisableAudioGenToggle) {
        dom.adminSysDisableAudioGenToggle.checked = !!sys.disableSystemAudioGeneration;
    }
    updateSystemAudioGenBadge(!!sys.disableSystemAudioGeneration);

    if (dom.adminSysRequireApprovalToggle) {
        dom.adminSysRequireApprovalToggle.checked = sys.requireAdminApproval !== undefined ? !!sys.requireAdminApproval : true;
    }
    updateRequireApprovalBadge(sys.requireAdminApproval !== undefined ? !!sys.requireAdminApproval : true);

    if (dom.adminSysGuestRestrictionsToggle) {
        dom.adminSysGuestRestrictionsToggle.checked = sys.enforceGuestRestrictions !== undefined ? !!sys.enforceGuestRestrictions : true;
    }
    updateGuestRestrictionsBadge(sys.enforceGuestRestrictions !== undefined ? !!sys.enforceGuestRestrictions : true);

    if (dom.adminSysGuestExportPolicySelect) {
        dom.adminSysGuestExportPolicySelect.value = sys.guestExportPolicy || 'watermark_320p';
    }
    updateGuestExportBadge(sys.guestExportPolicy || 'watermark_320p');
}

/**
 * Updates System Image Generation Status Badge in Admin Panel
 */
export function updateSystemImageGenBadge(isDisabled: boolean) {
    if (!adminSysImageGenBadge) return;
    if (isDisabled) {
        adminSysImageGenBadge.textContent = "Disabled (Blocked)";
        adminSysImageGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-rose-950 text-rose-400 border border-rose-500/50 shadow-md";
    } else {
        adminSysImageGenBadge.textContent = "Allowed";
        adminSysImageGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40";
    }
}

export function updateSystemVideoGenBadge(isDisabled: boolean) {
    if (!dom.adminSysVideoGenBadge) return;
    if (isDisabled) {
        dom.adminSysVideoGenBadge.textContent = "Disabled (Blocked)";
        dom.adminSysVideoGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-rose-950 text-rose-400 border border-rose-500/50 shadow-md";
    } else {
        dom.adminSysVideoGenBadge.textContent = "Allowed";
        dom.adminSysVideoGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40";
    }
}

export function updateSystemAudioGenBadge(isDisabled: boolean) {
    if (!dom.adminSysAudioGenBadge) return;
    if (isDisabled) {
        dom.adminSysAudioGenBadge.textContent = "Disabled (Blocked)";
        dom.adminSysAudioGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-rose-950 text-rose-400 border border-rose-500/50 shadow-md";
    } else {
        dom.adminSysAudioGenBadge.textContent = "Allowed";
        dom.adminSysAudioGenBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40";
    }
}

export function updateRequireApprovalBadge(isRequired: boolean) {
    if (!dom.adminSysRequireApprovalBadge) return;
    if (isRequired) {
        dom.adminSysRequireApprovalBadge.textContent = "Approval Required (Pending by Default)";
        dom.adminSysRequireApprovalBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-950 text-amber-400 border border-amber-500/50 shadow-md";
    } else {
        dom.adminSysRequireApprovalBadge.textContent = "Auto-Approve";
        dom.adminSysRequireApprovalBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40";
    }
}

export function updateGuestRestrictionsBadge(isEnforced: boolean) {
    if (!dom.adminSysGuestRestrictionsBadge) return;
    if (isEnforced) {
        dom.adminSysGuestRestrictionsBadge.textContent = "Enforced (Protected)";
        dom.adminSysGuestRestrictionsBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40";
    } else {
        dom.adminSysGuestRestrictionsBadge.textContent = "Unrestricted";
        dom.adminSysGuestRestrictionsBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-950 text-amber-400 border border-amber-500/50 shadow-md";
    }
}

export function updateGuestExportBadge(policy: string) {
    if (!dom.adminSysGuestExportBadge) return;
    if (policy === 'block_all') {
        dom.adminSysGuestExportBadge.textContent = "Exports Blocked";
        dom.adminSysGuestExportBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-rose-950 text-rose-400 border border-rose-500/50 shadow-md";
    } else if (policy === 'unrestricted') {
        dom.adminSysGuestExportBadge.textContent = "Unrestricted (No Gating)";
        dom.adminSysGuestExportBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-600";
    } else {
        dom.adminSysGuestExportBadge.textContent = "320p + Watermark";
        dom.adminSysGuestExportBadge.className = "px-2 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-950 text-amber-400 border border-amber-500/40";
    }
}

/**
 * Updates Desktop Offline Status Badge in Admin Panel
 */
export function updateDesktopPasswordBadge(password: string) {
    if (!dom.adminDesktopPassBadge) return;
    const isDefault = !password || password.trim() === '13218361';
    if (isDefault) {
        dom.adminDesktopPassBadge.textContent = 'Default: 13218361';
        dom.adminDesktopPassBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-500/40';
    } else {
        dom.adminDesktopPassBadge.textContent = 'Custom Password Active';
        dom.adminDesktopPassBadge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-950 text-emerald-300 border border-emerald-500/40 shadow-sm';
    }
}

export function updateDesktopOfflineBadge(isDisabled: boolean) {
    if (!adminDesktopOfflineStatusBadge) return;
    if (isDisabled) {
        adminDesktopOfflineStatusBadge.textContent = 'Offline Access Blocked';
        adminDesktopOfflineStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-950 text-rose-400 border border-rose-500/50 shadow-md';
    } else {
        adminDesktopOfflineStatusBadge.textContent = 'Offline Access Allowed';
        adminDesktopOfflineStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40';
    }
}

/**
 * Updates Ads Management Icon Status Badge in Admin Panel
 */
export function updateAdsIconBadge(isVisible: boolean) {
    if (!adminAdsIconStatusBadge) return;
    if (isVisible) {
        adminAdsIconStatusBadge.textContent = 'Icon Visible';
        adminAdsIconStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-950 text-purple-400 border border-purple-500/40 shadow-md';
    } else {
        adminAdsIconStatusBadge.textContent = 'Icon Hidden';
        adminAdsIconStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-800 text-gray-400 border border-gray-600 shadow-md';
    }
}

/**
 * Checks maintenance mode and applies access lock if active and user is not admin
 */
export function applyMaintenanceModeState() {
    const sys = state.systemConfig;
    const isMaintenanceActive = !!sys?.maintenanceMode;
    const isAdmin = isUserAdmin();

    // Update Admin Status Badge
    if (adminMaintenanceStatusBadge) {
        if (isMaintenanceActive) {
            adminMaintenanceStatusBadge.textContent = 'Active (Maintenance Lock)';
            adminMaintenanceStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-950 text-amber-400 border border-amber-500/50 shadow-md';
        } else {
            adminMaintenanceStatusBadge.textContent = 'Inactive (Online)';
            adminMaintenanceStatusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/40';
        }
    }

    // Display overlay for non-admins if maintenance is enabled
    if (maintenanceModeOverlay) {
        if (isMaintenanceActive && !isAdmin) {
            maintenanceModeOverlay.classList.remove('hidden');
            if (maintenanceOverlayMessage) {
                maintenanceOverlayMessage.textContent = sys?.maintenanceMessage || 'System is undergoing scheduled maintenance. Please check back shortly.';
            }
        } else {
            maintenanceModeOverlay.classList.add('hidden');
        }
    }
}

/**
 * Tab switching helper for Admin Panel
 */
function switchAdminTab(tab: 'users' | 'keys' | 'credits' | 'maintenance') {
    const tabs = [
        { btn: adminTabUsersBtn, section: adminSectionUsers },
        { btn: adminTabKeysBtn, section: adminSectionKeys },
        { btn: adminTabCreditsBtn, section: adminSectionCredits },
        { btn: adminTabMaintenanceBtn, section: adminSectionMaintenance }
    ];

    tabs.forEach(({ btn, section }) => {
        if (btn && section) {
            btn.classList.remove('bg-purple-600', 'text-white', 'shadow-md');
            btn.classList.add('bg-gray-800', 'text-gray-300', 'hover:text-white', 'hover:bg-gray-700');
            section.classList.add('hidden');
        }
    });

    let activeBtn = adminTabUsersBtn;
    let activeSection = adminSectionUsers;

    if (tab === 'keys') {
        activeBtn = adminTabKeysBtn;
        activeSection = adminSectionKeys;
    } else if (tab === 'credits') {
        activeBtn = adminTabCreditsBtn;
        activeSection = adminSectionCredits;
    } else if (tab === 'maintenance') {
        activeBtn = adminTabMaintenanceBtn;
        activeSection = adminSectionMaintenance;
    }

    if (activeBtn && activeSection) {
        activeBtn.classList.remove('bg-gray-800', 'text-gray-300', 'hover:text-white', 'hover:bg-gray-700');
        activeBtn.classList.add('bg-purple-600', 'text-white', 'shadow-md');
        activeSection.classList.remove('hidden');
    }
}

/**
 * Updates UI state for Admin Gemini Auth Mode (API Key vs Web Cookie)
 */
export function updateAdminGeminiAuthUI() {
    if (!adminSysGeminiAuthApiKeyBtn || !adminSysGeminiAuthCookieBtn) return;

    if (activeAdminGeminiAuthMode === 'apiKey') {
        adminSysGeminiAuthApiKeyBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition bg-purple-600 text-white shadow-sm';
        adminSysGeminiAuthCookieBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        if (dom.adminSysGeminiAuthOpenaiBtn) dom.adminSysGeminiAuthOpenaiBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        adminSysGeminiKeyContainer?.classList.remove('hidden');
        adminSysGeminiCookieContainer?.classList.add('hidden');
    } else if (activeAdminGeminiAuthMode === 'webCookie') {
        adminSysGeminiAuthCookieBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition bg-purple-600 text-white shadow-sm';
        adminSysGeminiAuthApiKeyBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        if (dom.adminSysGeminiAuthOpenaiBtn) dom.adminSysGeminiAuthOpenaiBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        adminSysGeminiKeyContainer?.classList.add('hidden');
        adminSysGeminiCookieContainer?.classList.remove('hidden');
    } else if (activeAdminGeminiAuthMode === 'openaiGateway') {
        if (dom.adminSysGeminiAuthOpenaiBtn) dom.adminSysGeminiAuthOpenaiBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition bg-indigo-600 text-white shadow-sm';
        adminSysGeminiAuthApiKeyBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        adminSysGeminiAuthCookieBtn.className = 'px-3 py-1 text-xs font-semibold rounded-md transition text-gray-400 hover:text-white';
        adminSysGeminiKeyContainer?.classList.add('hidden');
        adminSysGeminiCookieContainer?.classList.add('hidden');
    }
}

/**
 * Sets up tab switches & action button handlers for Admin Panel Expansion
 */
export function setupAdminSystemTabHandlers() {
    // Gemini Auth Mode Toggles in Admin Panel
    adminSysGeminiAuthApiKeyBtn?.addEventListener('click', () => {
        activeAdminGeminiAuthMode = 'apiKey';
        updateAdminGeminiAuthUI();
        updateAdminVertexUITabs(state.privateSystemConfig?.systemGeminiProvider || "aistudio");
    });

    adminSysGeminiAuthCookieBtn?.addEventListener('click', () => {
        activeAdminGeminiAuthMode = 'webCookie';
        updateAdminGeminiAuthUI();
        updateAdminVertexUITabs(state.privateSystemConfig?.systemGeminiProvider || "aistudio");
    });

    dom.adminSysGeminiAuthOpenaiBtn?.addEventListener('click', () => {
        activeAdminGeminiAuthMode = 'openaiGateway';
        updateAdminGeminiAuthUI();
        const card = document.getElementById('admin-sys-openai-card');
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            card.classList.add('ring-2', 'ring-indigo-500');
            setTimeout(() => card.classList.remove('ring-2', 'ring-indigo-500'), 1500);
        }
    });

    // Preset handlers for Admin Gateway
    document.querySelectorAll<HTMLButtonElement>('[data-admin-gateway-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-admin-gateway-preset');
            const presets: Record<string, { baseUrl: string; model: string; imageModel?: string; placeholderKey: string }> = {
                experientiallabs: {
                    baseUrl: 'https://api.experientiallabs.ai/v1',
                    model: 'gemini-3.8-flash',
                    imageModel: 'dall-e-3',
                    placeholderKey: 'xpl_...'
                },
                openrouter: {
                    baseUrl: 'https://openrouter.ai/api/v1',
                    model: 'deepseek/deepseek-chat',
                    imageModel: 'black-forest-labs/flux-1-schnell',
                    placeholderKey: 'sk-or-v1-...'
                },
                openai: {
                    baseUrl: 'https://api.openai.com/v1',
                    model: 'gpt-4o',
                    imageModel: 'dall-e-3',
                    placeholderKey: 'sk-proj-...'
                },
                deepseek: {
                    baseUrl: 'https://api.deepseek.com/v1',
                    model: 'deepseek-chat',
                    placeholderKey: 'sk-...'
                },
                groq: {
                    baseUrl: 'https://api.groq.com/openai/v1',
                    model: 'llama-3.3-70b-versatile',
                    placeholderKey: 'gsk_...'
                },
                ollama: {
                    baseUrl: 'http://localhost:11434/v1',
                    model: 'llama3.2',
                    placeholderKey: 'ollama (optional)'
                }
            };
            const target = preset ? presets[preset] : null;
            if (!target) return;
            if (dom.adminSysOpenaiBaseUrlInput) dom.adminSysOpenaiBaseUrlInput.value = target.baseUrl;
            if (dom.adminSysOpenaiModelInput) dom.adminSysOpenaiModelInput.value = target.model;
            if (dom.adminSysOpenaiImageModelInput && target.imageModel && !dom.adminSysOpenaiImageModelInput.value) {
                dom.adminSysOpenaiImageModelInput.value = target.imageModel;
            }
            if (dom.adminSysOpenaiKeyInput && !dom.adminSysOpenaiKeyInput.value) {
                dom.adminSysOpenaiKeyInput.placeholder = target.placeholderKey;
            }
            showFeedback(adminSystemKeysMsg, `Applied ${(preset || '').toUpperCase()} preset to System OpenAI Gateway.`, 'info');
        });
    });

    // Test connection button for Admin OpenAI Gateway
    dom.adminTestOpenaiConnectionBtn?.addEventListener('click', async () => {
        const btn = dom.adminTestOpenaiConnectionBtn;
        const statusDiv = dom.adminOpenaiConnectionStatus;
        if (!btn || !statusDiv) return;

        let baseUrl = dom.adminSysOpenaiBaseUrlInput?.value.trim() || 'https://api.openai.com/v1';
        const apiKey = dom.adminSysOpenaiKeyInput?.value.trim() || '';
        const model = dom.adminSysOpenaiModelInput?.value.trim() || 'gpt-4o';

        if (/experientiallabs\.ai/i.test(baseUrl)) {
            baseUrl = 'https://api.experientiallabs.ai/v1';
            if (dom.adminSysOpenaiBaseUrlInput) dom.adminSysOpenaiBaseUrlInput.value = baseUrl;
        }

        if (!baseUrl) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            statusDiv.innerHTML = "❌ <strong>Missing Base URL</strong>: Please enter an API Base URL.";
            statusDiv.classList.remove('hidden');
            return;
        }

        statusDiv.classList.remove('hidden');
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-indigo-900/30 border border-indigo-500/50 text-indigo-200 animate-pulse";
        statusDiv.innerHTML = "📡 Connecting to Gateway & executing verification test...";

        btn.disabled = true;
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Testing...</span>`;

        try {
            const res = await fetch('/api/openai/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl, apiKey, model })
            });
            const result = await res.json();

            if (result.valid) {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-green-900/30 border border-green-500/50 text-green-300";
                renderSafeStatus(statusDiv, {
                    type: 'success',
                    title: 'Gateway Connected!',
                    message: result.message,
                    model: result.model,
                    latencyMs: result.latencyMs,
                    reply: result.reply
                });
            } else {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
                renderSafeStatus(statusDiv, {
                    type: 'error',
                    title: 'Connection Failed',
                    error: result.error || 'Gateway returned an error.',
                    rawError: result.rawError
                });
            }
        } catch (err: any) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            renderSafeStatus(statusDiv, {
                type: 'error',
                title: 'Network Error',
                error: err.message || 'Could not reach server proxy.'
            });
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    });

    // Test connection button for Admin System Gemini Key / Vertex
    dom.adminTestGeminiKeyBtn?.addEventListener('click', async () => {
        const btn = dom.adminTestGeminiKeyBtn;
        const statusDiv = dom.adminGeminiKeyStatus;
        if (!btn || !statusDiv) return;

        const provider = state.privateSystemConfig?.systemGeminiProvider || (dom.adminVertexFields?.classList.contains('hidden') ? 'aistudio' : 'vertex');
        const apiKey = dom.adminSysGeminiKeyInput?.value.trim() || state.privateSystemConfig?.systemGeminiApiKey || '';
        const project = dom.adminSysVertexProject?.value.trim() || state.privateSystemConfig?.systemVertexProjectId || '';
        const location = dom.adminSysVertexLocation?.value.trim() || state.privateSystemConfig?.systemVertexLocation || 'us-central1';
        const authMode = activeAdminVertexAuthMode || state.privateSystemConfig?.systemVertexAuthMode || 'apiKey';

        if (provider === 'aistudio' && !apiKey) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-amber-900/30 border border-amber-500/50 text-amber-300";
            statusDiv.textContent = "Please enter a System Gemini API key from Google AI Studio to test.";
            statusDiv.classList.remove("hidden");
            return;
        }

        if (provider === 'vertex' && authMode === 'apiKey' && !apiKey) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-amber-900/30 border border-amber-500/50 text-amber-300";
            statusDiv.textContent = "Please enter a Google Cloud API key with Vertex AI enabled, or select ADC Default mode.";
            statusDiv.classList.remove("hidden");
            return;
        }

        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-gray-900 border border-gray-700 text-gray-300";
        statusDiv.textContent = provider === 'vertex'
            ? (authMode === 'adc' ? "Connecting to Vertex AI via Server Application Default Credentials (ADC)..." : "Connecting to Vertex AI with API key...")
            : "Connecting to Google AI Studio...";
        statusDiv.classList.remove("hidden");
        btn.disabled = true;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Testing Connection...</span>`;

        try {
            const endpoint = provider === 'vertex' ? '/api/vertex/test' : '/api/gemini/test';
            const payload = provider === 'vertex'
                ? { authMode, apiKey, project, location, model: 'gemini-3.8-flash' }
                : { apiKey, provider, project, location, authMode };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await res.json();

            if (result.valid) {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-green-900/30 border border-green-500/50 text-green-300";
                renderSafeStatus(statusDiv, {
                    type: 'success',
                    title: 'Success!',
                    message: result.message,
                    latencyMs: result.latencyMs
                });
            } else {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
                renderSafeStatus(statusDiv, {
                    type: 'error',
                    title: 'Connection Failed',
                    code: result.code || 'ERROR',
                    error: result.error,
                    rawError: result.rawError
                });
            }
        } catch (err: any) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            renderSafeStatus(statusDiv, {
                type: 'error',
                title: 'Network Error',
                error: err.message || 'Could not reach server proxy.'
            });
        } finally {
            btn.disabled = false;
            refreshAdminGeminiKeyUI();
        }
    });

    // Fetch models button
    dom.adminFetchOpenaiModelsBtn?.addEventListener('click', async () => {
        const btn = dom.adminFetchOpenaiModelsBtn;
        let baseUrl = dom.adminSysOpenaiBaseUrlInput?.value.trim() || 'https://api.openai.com/v1';
        const apiKey = dom.adminSysOpenaiKeyInput?.value.trim() || '';
        if (!baseUrl) {
            showFeedback(adminSystemKeysMsg, 'Please enter a Base URL before fetching models.', 'error');
            return;
        }
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = 'Fetching...';
        try {
            const res = await fetch('/api/openai/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl, apiKey })
            });
            const data = await res.json();
            if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                const dl = document.getElementById('admin-openai-model-list');
                if (dl) {
                    dl.innerHTML = data.models.map((m: any) => {
                        const safeId = escapeHtml(String(m?.id ?? ''));
                        return `<option value="${safeId}">${safeId}</option>`;
                    }).join('');
                }
                showFeedback(adminSystemKeysMsg, `Fetched ${data.models.length} models from gateway!`, 'success');
            } else {
                showFeedback(adminSystemKeysMsg, data.error || 'No models returned by gateway.', 'error');
            }
        } catch (err: any) {
            showFeedback(adminSystemKeysMsg, `Error fetching models: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    // Tab switching
    adminTabUsersBtn?.addEventListener('click', () => switchAdminTab('users'));
    adminTabKeysBtn?.addEventListener('click', () => {
        switchAdminTab('keys');
        syncSystemConfigInputs();
    });
    adminTabCreditsBtn?.addEventListener('click', () => {
        switchAdminTab('credits');
        syncSystemConfigInputs();
    });
    adminTabMaintenanceBtn?.addEventListener('click', () => {
        switchAdminTab('maintenance');
        syncSystemConfigInputs();
    });

    // Toggle for Disabling System Image Generation
    adminSysDisableImageGenToggle?.addEventListener('change', () => {
        updateSystemImageGenBadge(!!adminSysDisableImageGenToggle.checked);
    });
    dom.adminSysDisableVideoGenToggle?.addEventListener("change", () => {
        updateSystemVideoGenBadge(!!dom.adminSysDisableVideoGenToggle.checked);
    });
    dom.adminSysDisableAudioGenToggle?.addEventListener("change", () => {
        updateSystemAudioGenBadge(!!dom.adminSysDisableAudioGenToggle.checked);
    });

    // Save System API Keys & Cookies
    dom.adminAuthAIStudioTab?.addEventListener("click", () => {
        if (state.privateSystemConfig) state.privateSystemConfig.systemGeminiProvider = "aistudio";
        updateAdminVertexUITabs("aistudio");
    });
    dom.adminAuthVertexTab?.addEventListener("click", () => {
        if (state.privateSystemConfig) state.privateSystemConfig.systemGeminiProvider = "vertex";
        updateAdminVertexUITabs("vertex");
    });
    dom.adminVertexAuthApiKeyBtn?.addEventListener("click", () => {
        activeAdminVertexAuthMode = "apiKey";
        if (state.privateSystemConfig) {
            state.privateSystemConfig.systemVertexAuthMode = "apiKey";
        }
        updateAdminVertexAuthModeUI("apiKey");
    });
    dom.adminVertexAuthAdcBtn?.addEventListener("click", () => {
        activeAdminVertexAuthMode = "adc";
        if (state.privateSystemConfig) {
            state.privateSystemConfig.systemVertexAuthMode = "adc";
        }
        updateAdminVertexAuthModeUI("adc");
    });

    adminSaveSystemKeysBtn?.addEventListener('click', async () => {
        if (!db) return;

        showFeedback(adminSystemKeysMsg, 'Saving system API credentials & cookies...', 'info');

        try {
            const sysConfigDocRef = doc(db, 'settings', 'system_config');
            await setDoc(sysConfigDocRef, {
                systemGeminiAuthMode: activeAdminGeminiAuthMode,
                systemGeminiProvider: state.privateSystemConfig?.systemGeminiProvider || 'aistudio',
                systemVertexAuthMode: activeAdminVertexAuthMode,
                systemVertexProjectId: dom.adminSysVertexProject?.value.trim() || '',
                systemVertexLocation: dom.adminSysVertexLocation?.value.trim() || 'us-central1',
                systemOpenaiApiKey: dom.adminSysOpenaiKeyInput?.value.trim() || '',
                systemOpenaiBaseUrl: dom.adminSysOpenaiBaseUrlInput?.value.trim() || '',
                systemOpenaiModel: dom.adminSysOpenaiModelInput?.value.trim() || '',
                systemOpenaiImageModel: dom.adminSysOpenaiImageModelInput?.value.trim() || '',
                systemGeminiApiKey: adminSysGeminiKeyInput?.value.trim() || '',
                systemGeminiPsid: adminSysGeminiPsidInput?.value.trim() || '',
                systemGeminiPsidts: adminSysGeminiPsidtsInput?.value.trim() || '',
                systemGeminiPsidcc: adminSysGeminiPsidccInput?.value.trim() || '',
                systemGeminiCompass: adminSysGeminiCompassInput?.value.trim() || '',
                systemGeminiSid: adminSysGeminiSidInput?.value.trim() || '',
                systemGeminiHsid: adminSysGeminiHsidInput?.value.trim() || '',
                systemGeminiSsid: adminSysGeminiSsidInput?.value.trim() || '',
                systemElevenlabsApiKey: adminSysElevenlabsKeyInput?.value.trim() || '',
                systemDeepgramApiKey: adminSysDeepgramKeyInput?.value.trim() || '',
                systemStabilityApiKey: adminSysStabilityKeyInput?.value.trim() || '',
                systemAi33ApiKey: adminSysAi33KeyInput?.value.trim() || '',
                systemPexelsApiKey: adminSysPexelsKeyInput?.value.trim() || '',
                systemGradioTtsUrl: adminSysGradioUrlInput?.value.trim() || '',
                customFirebaseApiKey: dom.adminSysFirebaseKeyInput?.value.trim() || '',
                desktopStudioPassword: dom.adminSysDesktopPasswordInput?.value.trim() || '',
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            const customFbKey = dom.adminSysFirebaseKeyInput?.value.trim() || '';
            if (customFbKey) {
                localStorage.setItem('custom_firebase_api_key', customFbKey);
            } else {
                localStorage.removeItem('custom_firebase_api_key');
            }

            const savedDesktopPass = dom.adminSysDesktopPasswordInput?.value.trim() || '';
            const desktopPassHash = savedDesktopPass ? await sha256Hex(savedDesktopPass) : '';

            try {
                if (savedDesktopPass) {
                    await fetch('/api/admin/set-desktop-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            newPassword: savedDesktopPass,
                            currentPassword: state.privateSystemConfig?.desktopStudioPassword || localStorage.getItem('cg_desktop_studio_password') || ''
                        })
                    });
                }
            } catch {}

            await setDoc(doc(db, 'settings', 'public_config'), {
                disableSystemImageGeneration: !!adminSysDisableImageGenToggle?.checked,
                disableSystemVideoGeneration: !!dom.adminSysDisableVideoGenToggle?.checked,
                disableSystemAudioGeneration: !!dom.adminSysDisableAudioGenToggle?.checked,
                requireAdminApproval: !!dom.adminSysRequireApprovalToggle?.checked,
                enforceGuestRestrictions: dom.adminSysGuestRestrictionsToggle ? !!dom.adminSysGuestRestrictionsToggle.checked : true,
                guestExportPolicy: dom.adminSysGuestExportPolicySelect ? dom.adminSysGuestExportPolicySelect.value : 'watermark_320p',
                desktopStudioPasswordHash: desktopPassHash,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            localStorage.setItem('cg_desktop_studio_password', savedDesktopPass);
            localStorage.setItem('cg_desktop_studio_password_hash', desktopPassHash);
            if (dom.adminDesktopPasswordInput) {
                dom.adminDesktopPasswordInput.value = savedDesktopPass;
            }
            updateDesktopPasswordBadge(savedDesktopPass);

            showFeedback(adminSystemKeysMsg, 'System API keys, cookies, and settings saved successfully!', 'success');
        } catch (err: any) {
            console.error('Failed to save system API keys:', err);
            showFeedback(adminSystemKeysMsg, `Error: ${err.message || 'Failed to save configuration'}`, 'error');
        }
    });

    // Clear System API Keys & Cookies
    adminClearSystemKeysBtn?.addEventListener('click', async () => {
        if (!db) return;

        showFeedback(adminSystemKeysMsg, 'Clearing system API credentials & cookies...', 'info');

        if (adminSysGeminiKeyInput) adminSysGeminiKeyInput.value = '';
        if (dom.adminSysVertexProject) dom.adminSysVertexProject.value = '';
        if (dom.adminSysVertexLocation) dom.adminSysVertexLocation.value = '';
        if (dom.adminSysOpenaiKeyInput) dom.adminSysOpenaiKeyInput.value = '';
        if (dom.adminSysOpenaiBaseUrlInput) dom.adminSysOpenaiBaseUrlInput.value = 'https://api.openai.com/v1';
        if (dom.adminSysOpenaiModelInput) dom.adminSysOpenaiModelInput.value = 'gpt-4o';
        if (dom.adminSysOpenaiImageModelInput) dom.adminSysOpenaiImageModelInput.value = 'dall-e-3';
        if (dom.adminOpenaiConnectionStatus) dom.adminOpenaiConnectionStatus.classList.add('hidden');
        if (adminSysGeminiPsidInput) adminSysGeminiPsidInput.value = '';
        if (adminSysGeminiPsidtsInput) adminSysGeminiPsidtsInput.value = '';
        if (adminSysGeminiPsidccInput) adminSysGeminiPsidccInput.value = '';
        if (adminSysGeminiCompassInput) adminSysGeminiCompassInput.value = '';
        if (adminSysGeminiSidInput) adminSysGeminiSidInput.value = '';
        if (adminSysGeminiHsidInput) adminSysGeminiHsidInput.value = '';
        if (adminSysGeminiSsidInput) adminSysGeminiSsidInput.value = '';
        if (adminSysElevenlabsKeyInput) adminSysElevenlabsKeyInput.value = '';
        if (adminSysDeepgramKeyInput) adminSysDeepgramKeyInput.value = '';
        if (adminSysStabilityKeyInput) adminSysStabilityKeyInput.value = '';
        if (adminSysAi33KeyInput) adminSysAi33KeyInput.value = '';
        if (adminSysPexelsKeyInput) adminSysPexelsKeyInput.value = '';
        if (adminSysGradioUrlInput) adminSysGradioUrlInput.value = '';
        if (adminSysDisableImageGenToggle) adminSysDisableImageGenToggle.checked = false;
        if (dom.adminSysDisableVideoGenToggle) dom.adminSysDisableVideoGenToggle.checked = false;
        if (dom.adminSysDisableAudioGenToggle) dom.adminSysDisableAudioGenToggle.checked = false;
        activeAdminGeminiAuthMode = 'apiKey';
        activeAdminVertexAuthMode = 'apiKey';
        updateAdminGeminiAuthUI();
        updateAdminVertexUITabs(state.privateSystemConfig?.systemGeminiProvider || "aistudio");
        updateAdminVertexAuthModeUI('apiKey');
        updateSystemImageGenBadge(false);
        updateSystemVideoGenBadge(false);
        updateSystemAudioGenBadge(false);

        try {
            const sysConfigDocRef = doc(db, 'settings', 'system_config');
            await setDoc(sysConfigDocRef, {
                systemGeminiAuthMode: 'apiKey',
                systemGeminiProvider: 'aistudio',
                systemVertexAuthMode: 'apiKey',
                systemVertexProjectId: '',
                systemVertexLocation: '',
                systemOpenaiApiKey: '',
                systemOpenaiBaseUrl: '',
                systemOpenaiModel: '',
                systemOpenaiImageModel: '',
                systemGeminiApiKey: '',
                systemGeminiPsid: '',
                systemGeminiPsidts: '',
                systemGeminiPsidcc: '',
                systemGeminiCompass: '',
                systemGeminiSid: '',
                systemGeminiHsid: '',
                systemGeminiSsid: '',
                systemElevenlabsApiKey: '',
                systemDeepgramApiKey: '',
                systemStabilityApiKey: '',
                systemAi33ApiKey: '',
                systemPexelsApiKey: '',
                systemGradioTtsUrl: '',
                disableSystemImageGeneration: false,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            showFeedback(adminSystemKeysMsg, 'System API keys and cookies cleared successfully!', 'success');
        } catch (err: any) {
            console.error('Failed to clear system API keys:', err);
            showFeedback(adminSystemKeysMsg, `Error: ${err.message || 'Failed to clear configuration'}`, 'error');
        }
    });

    // Save Dynamic Credit Costs
    adminSaveCreditCostsBtn?.addEventListener('click', async () => {
        if (!db) return;

        showFeedback(adminCreditCostsMsg, 'Updating credit rules...', 'info');

        try {
            const videoGenCost = Math.max(0, parseInt(adminCostVideoGenInput?.value || '100', 10));
            const geminiImgCost = Math.max(0, parseInt(adminCostImageGeminiInput?.value || '5', 10));
            const imagenImgCost = Math.max(0, parseInt(adminCostImageImagenInput?.value || '10', 10));
            const elevenlabsCost = Math.max(0, parseInt(adminCostAudioElevenlabsInput?.value || '10', 10));
            const alignedCost = Math.max(0, parseInt(adminCostAudioAlignedInput?.value || '5', 10));
            const cloningCost = Math.max(0, parseInt(adminCostAudioCloningInput?.value || '20', 10));

            const newCreditCosts = {
                VIDEO_GENERATION: videoGenCost,
                IMAGE_GENERATION_GEMINI: geminiImgCost,
                IMAGE_GENERATION_IMAGEN: imagenImgCost,
                AUDIO_GENERATION_ELEVENLABS_INSTANT: elevenlabsCost,
                AUDIO_GENERATION_ALIGNED: alignedCost,
                AUDIO_CLONING_MINIMAX: cloningCost,
                TEXT_GENERATION_PER_TOKEN: 1 / 100
            };

            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                creditCosts: newCreditCosts,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            updateDynamicCreditCosts(newCreditCosts);
            showFeedback(adminCreditCostsMsg, 'Credit costs updated live!', 'success');
        } catch (err: any) {
            console.error('Failed to save credit costs:', err);
            showFeedback(adminCreditCostsMsg, `Error: ${err.message || 'Failed to save credit costs'}`, 'error');
        }
    });

    // Reset Credit Costs
    adminResetCreditCostsBtn?.addEventListener('click', () => {
        if (adminCostVideoGenInput) adminCostVideoGenInput.value = '100';
        if (adminCostImageGeminiInput) adminCostImageGeminiInput.value = '5';
        if (adminCostImageImagenInput) adminCostImageImagenInput.value = '10';
        if (adminCostAudioElevenlabsInput) adminCostAudioElevenlabsInput.value = '10';
        if (adminCostAudioAlignedInput) adminCostAudioAlignedInput.value = '5';
        if (adminCostAudioCloningInput) adminCostAudioCloningInput.value = '20';
        showFeedback(adminCreditCostsMsg, 'Reset to default cost presets. Click Save to apply.', 'info');
    });

    // Dynamic toggle change update for desktop offline badge with instant auto-save to Firestore
    adminDesktopOfflineToggle?.addEventListener('change', async () => {
        const isBlocked = !!adminDesktopOfflineToggle.checked;
        updateDesktopOfflineBadge(isBlocked);

        if (!db) return;
        try {
            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                disableDesktopOfflineMode: isBlocked,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            localStorage.setItem('cg_disable_desktop_offline_mode', String(isBlocked));
            if (state.systemConfig) {
                state.systemConfig.disableDesktopOfflineMode = isBlocked;
            }
            enforceDesktopOfflineRestrictions();
            updateAuthUI();

            showFeedback(
                adminMaintenanceMsg,
                `Desktop Offline Mode is now ${isBlocked ? 'BLOCKED' : 'ALLOWED'} across all desktop clients. Setting saved!`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to auto-save desktop offline setting:', err);
            showFeedback(adminMaintenanceMsg, `Failed to update desktop setting: ${err.message || err}`, 'error');
            // Revert UI toggle on failure
            adminDesktopOfflineToggle.checked = !isBlocked;
            updateDesktopOfflineBadge(!isBlocked);
        }
    });

    // Dynamic toggle change update for requireAdminApproval
    dom.adminSysRequireApprovalToggle?.addEventListener('change', async () => {
        const isRequired = !!dom.adminSysRequireApprovalToggle?.checked;
        updateRequireApprovalBadge(isRequired);

        if (!db) return;
        try {
            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                requireAdminApproval: isRequired,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            if (state.systemConfig) {
                state.systemConfig.requireAdminApproval = isRequired;
            }
            showFeedback(
                adminMaintenanceMsg,
                `New User Policy: Approval is now ${isRequired ? 'REQUIRED (New users held in pending)' : 'AUTOMATIC (New users approved on signup)'}.`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to update requireAdminApproval:', err);
            showFeedback(adminMaintenanceMsg, `Failed to update approval policy: ${err.message || err}`, 'error');
            if (dom.adminSysRequireApprovalToggle) {
                dom.adminSysRequireApprovalToggle.checked = !isRequired;
            }
            updateRequireApprovalBadge(!isRequired);
        }
    });

    // Dynamic toggle change update for enforceGuestRestrictions
    dom.adminSysGuestRestrictionsToggle?.addEventListener('change', async () => {
        const isEnforced = !!dom.adminSysGuestRestrictionsToggle?.checked;
        updateGuestRestrictionsBadge(isEnforced);

        if (!db) return;
        try {
            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                enforceGuestRestrictions: isEnforced,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            if (state.systemConfig) {
                state.systemConfig.enforceGuestRestrictions = isEnforced;
            }
            showFeedback(
                adminMaintenanceMsg,
                `Guest Restrictions are now ${isEnforced ? 'ENFORCED (Protected against credit drain)' : 'UNRESTRICTED (Open guest test mode)'}.`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to update enforceGuestRestrictions:', err);
            showFeedback(adminMaintenanceMsg, `Failed to update guest policy: ${err.message || err}`, 'error');
            if (dom.adminSysGuestRestrictionsToggle) {
                dom.adminSysGuestRestrictionsToggle.checked = !isEnforced;
            }
            updateGuestRestrictionsBadge(!isEnforced);
        }
    });

    // Dynamic select change update for guestExportPolicy
    dom.adminSysGuestExportPolicySelect?.addEventListener('change', async () => {
        const policy = dom.adminSysGuestExportPolicySelect?.value || 'watermark_320p';
        updateGuestExportBadge(policy);

        if (!db) return;
        try {
            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                guestExportPolicy: policy,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            if (state.systemConfig) {
                state.systemConfig.guestExportPolicy = policy as any;
            }
            showFeedback(
                adminMaintenanceMsg,
                `Guest Export Policy updated to: ${policy === 'block_all' ? 'BLOCKED' : policy === 'unrestricted' ? 'UNRESTRICTED' : '320p + WATERMARK'}.`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to update guestExportPolicy:', err);
            showFeedback(adminMaintenanceMsg, `Failed to update export policy: ${err.message || err}`, 'error');
        }
    });

    // Password visibility toggle for Desktop Studio password
    let isDesktopPassVisible = false;
    dom.adminDesktopPasswordToggleBtn?.addEventListener('click', () => {
        if (!dom.adminDesktopPasswordInput) return;
        isDesktopPassVisible = !isDesktopPassVisible;
        dom.adminDesktopPasswordInput.type = isDesktopPassVisible ? 'text' : 'password';
        if (dom.adminDesktopPassEyeIcon) {
            if (isDesktopPassVisible) {
                dom.adminDesktopPassEyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/>`;
            } else {
                dom.adminDesktopPassEyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
            }
        }
    });

    async function executeSaveDesktopPassword(targetPass: string) {
        const trimmed = (targetPass || '').trim();
        if (!trimmed) {
            showFeedback(dom.adminDesktopPasswordMsg, 'Password cannot be empty. Please enter a valid password or click Reset to Default.', 'error');
            return;
        }
        if (trimmed.length < 4) {
            showFeedback(dom.adminDesktopPasswordMsg, 'Password must be at least 4 characters long.', 'error');
            return;
        }

        showFeedback(dom.adminDesktopPasswordMsg, 'Updating Desktop Studio access password...', 'info');

        try {
            const hash = await sha256Hex(trimmed);

            // 1. Notify local/container server endpoint
            try {
                await fetch('/api/admin/set-desktop-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        newPassword: trimmed,
                        currentPassword: state.privateSystemConfig?.desktopStudioPassword || localStorage.getItem('cg_desktop_studio_password') || ''
                    })
                });
            } catch (e) {
                console.warn('Server password endpoint update notice:', e);
            }

            // 2. Persist to Firestore if available
            if (db) {
                await setDoc(doc(db, 'settings', 'system_config'), {
                    desktopStudioPassword: trimmed,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userRecord?.email || currentUser?.email || 'admin'
                }, { merge: true });

                await setDoc(doc(db, 'settings', 'public_config'), {
                    desktopStudioPasswordHash: hash,
                    updatedAt: new Date().toISOString(),
                    updatedBy: userRecord?.email || currentUser?.email || 'admin'
                }, { merge: true });
            }

            // 3. Cache in local storage for offline state
            localStorage.setItem('cg_desktop_studio_password', trimmed);
            localStorage.setItem('cg_desktop_studio_password_hash', hash);

            if (!state.privateSystemConfig) state.privateSystemConfig = {};
            state.privateSystemConfig.desktopStudioPassword = trimmed;

            if (state.systemConfig) {
                state.systemConfig.desktopStudioPasswordHash = hash;
            }

            // 4. Synchronize UI inputs and badges
            if (dom.adminDesktopPasswordInput) dom.adminDesktopPasswordInput.value = trimmed;
            if (dom.adminSysDesktopPasswordInput) dom.adminSysDesktopPasswordInput.value = trimmed;
            updateDesktopPasswordBadge(trimmed);

            const isDef = trimmed === '13218361';
            showFeedback(
                dom.adminDesktopPasswordMsg,
                `Desktop Studio password ${isDef ? 'reset to default (13218361)' : 'successfully updated'}! Active immediately.`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to update desktop password:', err);
            showFeedback(dom.adminDesktopPasswordMsg, `Failed to update password: ${err.message || err}`, 'error');
        }
    }

    dom.adminSaveDesktopPasswordBtn?.addEventListener('click', () => {
        executeSaveDesktopPassword(dom.adminDesktopPasswordInput?.value || '');
    });

    dom.adminResetDesktopPasswordBtn?.addEventListener('click', () => {
        if (dom.adminDesktopPasswordInput) dom.adminDesktopPasswordInput.value = '13218361';
        executeSaveDesktopPassword('13218361');
    });

    // Dynamic toggle change update for ads icon badge
    adminShowAdsIconToggle?.addEventListener('change', () => {
        updateAdsIconBadge(!!adminShowAdsIconToggle.checked);
    });

    // Save Maintenance Mode & System Controls Settings
    adminSaveMaintenanceBtn?.addEventListener('click', async () => {
        if (!db) return;

        showFeedback(adminMaintenanceMsg, 'Updating system & maintenance settings...', 'info');

        try {
            const maintenanceMode = !!adminMaintenanceToggle?.checked;
            const maintenanceMessage = adminMaintenanceMessageInput?.value.trim() || 'System is undergoing scheduled maintenance. Please check back shortly.';
            const disableDesktopOfflineMode = !!adminDesktopOfflineToggle?.checked;
            const showAdsAdminButton = !!adminShowAdsIconToggle?.checked;

            const sysConfigDocRef = doc(db, 'settings', 'public_config');
            await setDoc(sysConfigDocRef, {
                maintenanceMode,
                maintenanceMessage,
                disableDesktopOfflineMode,
                showAdsAdminButton,
                updatedAt: new Date().toISOString(),
                updatedBy: userRecord?.email || currentUser?.email || 'admin'
            }, { merge: true });

            localStorage.setItem('cg_disable_desktop_offline_mode', String(disableDesktopOfflineMode));
            if (state.systemConfig) {
                state.systemConfig.disableDesktopOfflineMode = disableDesktopOfflineMode;
            }
            enforceDesktopOfflineRestrictions();
            updateAuthUI();

            updateDesktopOfflineBadge(disableDesktopOfflineMode);
            updateAdsIconBadge(showAdsAdminButton);
            showFeedback(
                adminMaintenanceMsg,
                `Settings applied! Ads Icon: ${showAdsAdminButton ? 'VISIBLE' : 'HIDDEN'} | Desktop Offline: ${disableDesktopOfflineMode ? 'BLOCKED' : 'ALLOWED'} | Maintenance: ${maintenanceMode ? 'ACTIVE' : 'OFF'}`,
                'success'
            );
        } catch (err: any) {
            console.error('Failed to update maintenance settings:', err);
            showFeedback(adminMaintenanceMsg, `Error: ${err.message || 'Failed to update system settings'}`, 'error');
        }
    });

    // Maintenance overlay login prompt
    maintenanceOverlayAdminLoginBtn?.addEventListener('click', () => {
        if (dom.landingPage && !dom.landingPage.classList.contains('hidden')) {
            startAppFromLanding();
        }
        if (maintenanceModeOverlay) {
            maintenanceModeOverlay.classList.add('hidden');
        }
        if (currentUser) {
            openAdminPanel();
        } else {
            openLoginModal();
        }
    });
}

/**
 * Displays status feedback messages in admin panel
 */
function showFeedback(element: HTMLDivElement | null, msg: string, type: 'success' | 'error' | 'info') {
    if (!element) return;
    element.classList.remove('hidden', 'bg-emerald-950/80', 'text-emerald-300', 'border-emerald-500/50', 'bg-rose-950/80', 'text-rose-300', 'border-rose-500/50', 'bg-indigo-950/80', 'text-indigo-300', 'border-indigo-500/50');
    element.classList.add('border', 'p-2.5', 'rounded-lg', 'transition-all', 'duration-200');

    if (type === 'success') {
        element.classList.add('bg-emerald-950/80', 'text-emerald-300', 'border-emerald-500/50');
    } else if (type === 'error') {
        element.classList.add('bg-rose-950/80', 'text-rose-300', 'border-rose-500/50');
    } else {
        element.classList.add('bg-indigo-950/80', 'text-indigo-300', 'border-indigo-500/50');
    }

    element.textContent = msg;
    if (type !== 'info') {
        setTimeout(() => {
            element.classList.add('hidden');
        }, 5000);
    }
}

export function refreshAdminGeminiKeyUI() {
    const provider = state.privateSystemConfig?.systemGeminiProvider || (dom.adminVertexFields?.classList.contains('hidden') ? 'aistudio' : 'vertex');
    const authMode = activeAdminVertexAuthMode || state.privateSystemConfig?.systemVertexAuthMode || 'apiKey';

    if (provider === 'vertex') {
        if (authMode === 'adc') {
            dom.adminSysVertexAdcNotice?.classList.remove('hidden');
            dom.adminSysGeminiKeyWrapper?.classList.add('hidden');
        } else {
            dom.adminSysVertexAdcNotice?.classList.add('hidden');
            dom.adminSysGeminiKeyWrapper?.classList.remove('hidden');
            if (dom.adminSysGeminiKeyLabel) dom.adminSysGeminiKeyLabel.textContent = "Google Cloud Vertex API Key";
            if (dom.adminSysGeminiKeyInput) dom.adminSysGeminiKeyInput.placeholder = "API Key (Vertex AI API enabled)";
            if (dom.adminSysGeminiKeyHelp) dom.adminSysGeminiKeyHelp.textContent = "Google Cloud API key with Vertex AI API enabled for project predictions.";
        }
    } else {
        dom.adminSysVertexAdcNotice?.classList.add('hidden');
        dom.adminSysGeminiKeyWrapper?.classList.remove('hidden');
        if (dom.adminSysGeminiKeyLabel) dom.adminSysGeminiKeyLabel.textContent = "System Gemini API Key (AI Studio)";
        if (dom.adminSysGeminiKeyInput) dom.adminSysGeminiKeyInput.placeholder = "AIzaSy...";
        if (dom.adminSysGeminiKeyHelp) dom.adminSysGeminiKeyHelp.textContent = "Default key for storyboards, scripting, and Gemini image generation.";
    }

    if (dom.adminTestGeminiKeyBtn) {
        let label = 'Test Gemini Connection';
        if (provider === 'vertex') {
            label = authMode === 'adc' ? 'Test Vertex ADC Connection' : 'Test Vertex API Key';
        } else {
            label = 'Test AI Studio Connection';
        }
        dom.adminTestGeminiKeyBtn.innerHTML = `<svg class="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span>${label}</span>`;
    }
}

export function updateAdminVertexUITabs(provider: 'aistudio' | 'vertex') {
    if (state.privateSystemConfig) state.privateSystemConfig.systemGeminiProvider = provider;
    if (!dom.adminAuthAIStudioTab) return;
    if (provider === 'vertex') {
        dom.adminAuthAIStudioTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded text-gray-400 hover:text-white transition-colors";
        dom.adminAuthVertexTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded bg-purple-600 text-white transition-colors";
        dom.adminVertexFields?.classList.remove('hidden');
    } else {
        dom.adminAuthAIStudioTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded bg-purple-600 text-white transition-colors";
        dom.adminAuthVertexTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded text-gray-400 hover:text-white transition-colors";
        dom.adminVertexFields?.classList.add('hidden');
    }
    refreshAdminGeminiKeyUI();
}

export function updateAdminVertexAuthModeUI(mode: 'apiKey' | 'adc') {
    activeAdminVertexAuthMode = mode;
    if (state.privateSystemConfig) {
        state.privateSystemConfig.systemVertexAuthMode = mode;
    }
    if (!dom.adminVertexAuthApiKeyBtn || !dom.adminVertexAuthAdcBtn) return;
    if (mode === 'adc') {
        dom.adminVertexAuthApiKeyBtn.className = 'px-2.5 py-1 text-[10px] font-semibold rounded transition text-gray-400 hover:text-white';
        dom.adminVertexAuthAdcBtn.className = 'px-2.5 py-1 text-[10px] font-semibold rounded transition bg-purple-600 text-white shadow-sm';
        dom.adminVertexAdcInfo?.classList.remove('hidden');
    } else {
        dom.adminVertexAuthApiKeyBtn.className = 'px-2.5 py-1 text-[10px] font-semibold rounded transition bg-purple-600 text-white shadow-sm';
        dom.adminVertexAuthAdcBtn.className = 'px-2.5 py-1 text-[10px] font-semibold rounded transition text-gray-400 hover:text-white';
        dom.adminVertexAdcInfo?.classList.add('hidden');
    }
    refreshAdminGeminiKeyUI();
}

