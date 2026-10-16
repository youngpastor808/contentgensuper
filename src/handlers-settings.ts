import { registerRestoreApiKeysFromCloudOrDB } from './apiKeysBootstrap';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import * as utils from './utils';
import type { SavedCustomVoice } from './types';
import { saveVersion } from './handlers-project';
import { drawVideoFrame } from './videoRenderer';
import { syncEffectsToUI } from './handlers-effects';
import { fetchAndPopulateVoices, fetchAndPopulateElevenLabsModels } from './audioPipeline';
import { db, auth } from './firebase';
import { currentUser, isGuest, isCookieAuthAllowedForCurrentUser } from './auth';
import { doc, getDoc, setDoc, serverTimestamp, deleteField } from 'firebase/firestore';

const GEMINI_COOKIE_STORAGE_KEYS = [
    'geminiPsid',
    'geminiPsidts',
    'geminiPsidcc',
    'geminiCompass',
    'geminiSid',
    'geminiHsid',
    'geminiSsid'
] as const;

export async function applyUpdatedGeminiCookies(cookies: Record<string, string>) {
    if (!cookies || typeof cookies !== 'object') return;
    let modified = false;

    if (cookies['__Secure-1PSID'] && cookies['__Secure-1PSID'] !== state.geminiPsid) {
        state.geminiPsid = cookies['__Secure-1PSID'];
        modified = true;
    }
    if (cookies['__Secure-1PSIDTS'] && cookies['__Secure-1PSIDTS'] !== state.geminiPsidts) {
        state.geminiPsidts = cookies['__Secure-1PSIDTS'];
        modified = true;
    }
    if (cookies['__Secure-1PSIDCC'] && cookies['__Secure-1PSIDCC'] !== state.geminiPsidcc) {
        state.geminiPsidcc = cookies['__Secure-1PSIDCC'];
        modified = true;
    }
    if (cookies['COMPASS'] && cookies['COMPASS'] !== state.geminiCompass) {
        state.geminiCompass = cookies['COMPASS'];
        modified = true;
    }
    if (cookies['SID'] && cookies['SID'] !== state.geminiSid) {
        state.geminiSid = cookies['SID'];
        modified = true;
    }
    if (cookies['HSID'] && cookies['HSID'] !== state.geminiHsid) {
        state.geminiHsid = cookies['HSID'];
        modified = true;
    }
    if (cookies['SSID'] && cookies['SSID'] !== state.geminiSsid) {
        state.geminiSsid = cookies['SSID'];
        modified = true;
    }

    sessionStorage.setItem('geminiCookieExpired', 'false');
    localStorage.setItem('geminiCookieExpired', 'false');

    if (dom.geminiPsidInput && state.geminiPsid) dom.geminiPsidInput.value = state.geminiPsid;
    if (dom.geminiPsidtsInput && state.geminiPsidts) dom.geminiPsidtsInput.value = state.geminiPsidts;
    if (dom.geminiPsidccInput && state.geminiPsidcc) dom.geminiPsidccInput.value = state.geminiPsidcc;
    if (dom.geminiCompassInput && state.geminiCompass) dom.geminiCompassInput.value = state.geminiCompass;
    if (dom.geminiSidInput && state.geminiSid) dom.geminiSidInput.value = state.geminiSid;
    if (dom.geminiHsidInput && state.geminiHsid) dom.geminiHsidInput.value = state.geminiHsid;
    if (dom.geminiSsidInput && state.geminiSsid) dom.geminiSsidInput.value = state.geminiSsid;

    try {
        await DB.put(constants.APP_STATE_STORE, {
            '__Secure-1PSID': state.geminiPsid,
            '__Secure-1PSIDTS': state.geminiPsidts,
            '__Secure-1PSIDCC': state.geminiPsidcc,
            'COMPASS': state.geminiCompass,
            'SID': state.geminiSid,
            'HSID': state.geminiHsid,
            'SSID': state.geminiSsid
        }, 'geminiWebCookies');
    } catch {}

    ui.updateApiStatusBadge();
}

function purgeLegacyGeminiCookieStorage() {
    // Retain cookies for session continuity across project resets and app restarts
}

async function restoreGeminiCookiesFromServer() {
    try {
        let cookies: Record<string, string> = {};

        // 1. Try local client-side IndexedDB store first
        try {
            const saved = await DB.get(constants.APP_STATE_STORE, 'geminiWebCookies');
            if (saved && typeof saved === 'object') {
                cookies = { ...saved };
            }
        } catch {}

        if (cookies['__Secure-1PSID']) state.geminiPsid = cookies['__Secure-1PSID'];
        if (cookies['__Secure-1PSIDTS']) state.geminiPsidts = cookies['__Secure-1PSIDTS'];
        if (cookies['__Secure-1PSIDCC']) state.geminiPsidcc = cookies['__Secure-1PSIDCC'];
        if (cookies['COMPASS']) state.geminiCompass = cookies['COMPASS'];
        if (cookies['SID']) state.geminiSid = cookies['SID'];
        if (cookies['HSID']) state.geminiHsid = cookies['HSID'];
        if (cookies['SSID']) state.geminiSsid = cookies['SSID'];

        if (dom.geminiPsidInput && state.geminiPsid) dom.geminiPsidInput.value = state.geminiPsid;
        if (dom.geminiPsidtsInput && state.geminiPsidts) dom.geminiPsidtsInput.value = state.geminiPsidts;
        if (dom.geminiPsidccInput && state.geminiPsidcc) dom.geminiPsidccInput.value = state.geminiPsidcc;
        if (dom.geminiCompassInput && state.geminiCompass) dom.geminiCompassInput.value = state.geminiCompass;
        if (dom.geminiSidInput && state.geminiSid) dom.geminiSidInput.value = state.geminiSid;
        if (dom.geminiHsidInput && state.geminiHsid) dom.geminiHsidInput.value = state.geminiHsid;
        if (dom.geminiSsidInput && state.geminiSsid) dom.geminiSsidInput.value = state.geminiSsid;

        ui.updateGeminiApiKeyUiState();
        ui.updateApiStatusBadge();
    } catch (e) {
        console.warn('Could not restore Gemini cookies from storage:', e);
    }
}
import { DB } from './db';
import * as constants from './constants';

// --- Global API Key Persistence & Cloud Sync ---

export async function syncAllApiKeysAndSettings() {
    const keyData = {
        userGeminiApiKey: state.userGeminiApiKey || '',
        geminiAuthMode: state.geminiAuthMode || 'builtin',
        geminiProvider: state.geminiProvider || 'aistudio',
        vertexAuthMode: state.vertexAuthMode || 'apiKey',
        vertexProjectId: state.vertexProjectId || '',
        vertexLocation: state.vertexLocation || '',
        openaiGatewayBaseUrl: state.openaiGatewayBaseUrl || '',
        openaiGatewayApiKey: state.openaiGatewayApiKey || '',
        openaiGatewayModel: state.openaiGatewayModel || '',
        openaiGatewayImageModel: state.openaiGatewayImageModel || '',
        geminiTextModel: state.currentTextModel || '',
        ai33ApiKey: state.ai33ApiKey || '',
        stabilityApiKey: state.stabilityApiKey || '',
        elevenlabsApiKey: state.elevenlabsApiKey || '',
        elevenlabsSelectedModel: state.elevenlabsSelectedModel || '',
        deepgramApiKey: state.deepgramApiKey || '',
        freesoundApiKey: state.freesoundApiKey || '',
        pexelsApiKey: state.pexelsApiKey || '',
        gradioTtsApiUrl: state.gradioTtsApiUrl || '',
    };

    // 1. Save or remove from localStorage
    if (keyData.userGeminiApiKey) {
        localStorage.setItem('userGeminiApiKey', keyData.userGeminiApiKey);
    } else {
        localStorage.removeItem('userGeminiApiKey');
    }

    if (keyData.geminiAuthMode) {
        localStorage.setItem("geminiAuthMode", keyData.geminiAuthMode);
    }
    if (keyData.geminiProvider) {
        localStorage.setItem("geminiProvider", keyData.geminiProvider);
    }
    if (keyData.vertexAuthMode) {
        localStorage.setItem("vertexAuthMode", keyData.vertexAuthMode);
    }
    if (keyData.vertexProjectId) {
        localStorage.setItem("vertexProjectId", keyData.vertexProjectId);
    } else {
        localStorage.removeItem("vertexProjectId");
    }
    if (keyData.vertexLocation) {
        localStorage.setItem("vertexLocation", keyData.vertexLocation);
    } else {
        localStorage.removeItem("vertexLocation");
    }

    if (keyData.openaiGatewayBaseUrl) {
        localStorage.setItem("openaiGatewayBaseUrl", keyData.openaiGatewayBaseUrl);
    } else {
        localStorage.removeItem("openaiGatewayBaseUrl");
    }
    if (keyData.openaiGatewayApiKey) {
        localStorage.setItem("openaiGatewayApiKey", keyData.openaiGatewayApiKey);
    } else {
        localStorage.removeItem("openaiGatewayApiKey");
    }
    if (keyData.openaiGatewayModel) {
        localStorage.setItem("openaiGatewayModel", keyData.openaiGatewayModel);
    } else {
        localStorage.removeItem("openaiGatewayModel");
    }
    if (keyData.openaiGatewayImageModel) {
        localStorage.setItem("openaiGatewayImageModel", keyData.openaiGatewayImageModel);
    } else {
        localStorage.removeItem("openaiGatewayImageModel");
    }

    purgeLegacyGeminiCookieStorage();

    if (keyData.geminiTextModel) {
        localStorage.setItem('geminiTextModel', keyData.geminiTextModel);
    }

    if (keyData.ai33ApiKey) {
        localStorage.setItem('ai33ApiKey', keyData.ai33ApiKey);
    } else {
        localStorage.removeItem('ai33ApiKey');
    }

    if (keyData.stabilityApiKey) {
        localStorage.setItem('stabilityApiKey', keyData.stabilityApiKey);
    } else {
        localStorage.removeItem('stabilityApiKey');
    }

    if (keyData.elevenlabsApiKey) {
        localStorage.setItem('elevenlabsApiKey', keyData.elevenlabsApiKey);
    } else {
        localStorage.removeItem('elevenlabsApiKey');
    }

    if (keyData.elevenlabsSelectedModel) {
        localStorage.setItem('elevenlabsSelectedModel', keyData.elevenlabsSelectedModel);
    }

    if (keyData.deepgramApiKey) {
        localStorage.setItem('deepgramApiKey', keyData.deepgramApiKey);
    } else {
        localStorage.removeItem('deepgramApiKey');
    }

    if (keyData.freesoundApiKey) {
        localStorage.setItem('freesoundApiKey', keyData.freesoundApiKey);
    } else {
        localStorage.removeItem('freesoundApiKey');
    }

    if (keyData.pexelsApiKey) {
        localStorage.setItem('pexelsApiKey', keyData.pexelsApiKey);
    } else {
        localStorage.removeItem('pexelsApiKey');
    }

    if (keyData.gradioTtsApiUrl) {
        localStorage.setItem('gradioTtsApiUrl', keyData.gradioTtsApiUrl);
    } else {
        localStorage.removeItem('gradioTtsApiUrl');
    }

    // 2. Save to IndexedDB backup
    try {
        await DB.put(constants.APP_STATE_STORE, keyData, 'persistentUserApiKeys');
    } catch (e) {
        console.warn("Could not save persistentUserApiKeys to IndexedDB backup:", e);
    }

    // 3. Sync with Firestore user cloud settings if logged in with Firebase Auth
    // Never attempt cloud sync for unauthenticated, guest, or local-only sessions
    const authenticatedUid = auth?.currentUser?.uid;
    const isLocalOrGuest = !authenticatedUid || isGuest() || !currentUser || String(currentUser.uid).startsWith('local_');

    if (!isLocalOrGuest && authenticatedUid) {
        try {
            const userSettingsRef = doc(db, 'users', authenticatedUid, 'settings', 'apiKeys');
            await setDoc(userSettingsRef, {
                ...keyData,
                geminiPsid: deleteField(),
                geminiPsidts: deleteField(),
                geminiPsidcc: deleteField(),
                geminiCompass: deleteField(),
                geminiSid: deleteField(),
                geminiHsid: deleteField(),
                geminiSsid: deleteField(),
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (e: any) {
            console.warn("Could not sync API keys to cloud (saved locally):", e?.message || e);
        }
    }
}

export function autoSaveApiKeysFromInputs() {
    // Only update UI button visibility while typing; do NOT mutate active state or turn on the active badge before saving
    ui.updateGeminiApiKeyUiState();
    ui.updateAi33ApiKeyUiState();
    ui.updateStabilityApiKeyUiState();
    ui.updateElevenlabsApiKeyUiState();
    ui.updateDeepgramApiKeyUiState();
    ui.updateFreesoundApiKeyUiState();
    ui.updatePexelsApiKeyUiState();
}

export async function restoreApiKeysFromCloudOrDB() {
    // 1. Try restore from IndexedDB
    try {
        const idbKeys = await DB.get(constants.APP_STATE_STORE, 'persistentUserApiKeys');
        if (idbKeys) {
            applyKeyDataToStateAndUI(idbKeys);
        }
    } catch (e) {
        console.warn("Could not restore API keys from IndexedDB:", e);
    }

    // 2. Try restore from Firestore if logged in with Firebase Auth
    const authenticatedUid = auth?.currentUser?.uid;
    const isLocalOrGuest = !authenticatedUid || isGuest() || !currentUser || String(currentUser.uid).startsWith('local_');

    if (!isLocalOrGuest && authenticatedUid) {
        try {
            const userSettingsRef = doc(db, 'users', authenticatedUid, 'settings', 'apiKeys');
            const snap = await getDoc(userSettingsRef);
            if (snap.exists()) {
                const cloudKeys = snap.data();
                applyKeyDataToStateAndUI(cloudKeys);
            } else if (state.userGeminiApiKey || state.ai33ApiKey || state.elevenlabsApiKey) {
                // If cloud has no keys yet, push local keys to cloud
                syncAllApiKeysAndSettings();
            }
        } catch (e: any) {
            console.warn("Could not restore cloud API keys (using offline cached keys):", e?.message || e);
        }
    }
}

function applyKeyDataToStateAndUI(data: Record<string, any>) {
    if (data.userGeminiApiKey && !state.userGeminiApiKey) {
        state.userGeminiApiKey = data.userGeminiApiKey;
        localStorage.setItem('userGeminiApiKey', data.userGeminiApiKey);
        if (dom.geminiApiKeyInput) dom.geminiApiKeyInput.value = data.userGeminiApiKey;
    }
    if (data.geminiAuthMode) {
        state.geminiAuthMode = data.geminiAuthMode;
        localStorage.setItem('geminiAuthMode', data.geminiAuthMode);
        if (dom.geminiAuthModeSelect) dom.geminiAuthModeSelect.value = data.geminiAuthMode;
    }
    if (data.geminiProvider) {
        state.geminiProvider = data.geminiProvider;
        localStorage.setItem('geminiProvider', data.geminiProvider);
    }
    if (data.vertexAuthMode) {
        state.vertexAuthMode = data.vertexAuthMode;
        localStorage.setItem('vertexAuthMode', data.vertexAuthMode);
        updateUserVertexAuthModeUI(data.vertexAuthMode);
    }
    if (data.vertexProjectId) {
        state.vertexProjectId = data.vertexProjectId;
        localStorage.setItem('vertexProjectId', data.vertexProjectId);
        if (dom.userVertexProjectInput) dom.userVertexProjectInput.value = data.vertexProjectId;
    }
    if (data.vertexLocation) {
        state.vertexLocation = data.vertexLocation;
        localStorage.setItem('vertexLocation', data.vertexLocation);
        if (dom.userVertexLocationInput) dom.userVertexLocationInput.value = data.vertexLocation;
    }
    if (data.openaiGatewayBaseUrl) {
        state.openaiGatewayBaseUrl = data.openaiGatewayBaseUrl;
        localStorage.setItem('openaiGatewayBaseUrl', data.openaiGatewayBaseUrl);
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = data.openaiGatewayBaseUrl;
    }
    if (data.openaiGatewayApiKey) {
        state.openaiGatewayApiKey = data.openaiGatewayApiKey;
        localStorage.setItem('openaiGatewayApiKey', data.openaiGatewayApiKey);
        if (dom.openaiGatewayApiKeyInput) dom.openaiGatewayApiKeyInput.value = data.openaiGatewayApiKey;
    }
    if (data.openaiGatewayModel) {
        state.openaiGatewayModel = data.openaiGatewayModel;
        localStorage.setItem('openaiGatewayModel', data.openaiGatewayModel);
        if (dom.openaiGatewayModelInput) dom.openaiGatewayModelInput.value = data.openaiGatewayModel;
    }
    if (data.openaiGatewayImageModel) {
        state.openaiGatewayImageModel = data.openaiGatewayImageModel;
        localStorage.setItem('openaiGatewayImageModel', data.openaiGatewayImageModel);
        if (dom.openaiGatewayImageModelInput) dom.openaiGatewayImageModelInput.value = data.openaiGatewayImageModel;
    }
    if (data.geminiTextModel) {
        state.currentTextModel = data.geminiTextModel;
        localStorage.setItem('geminiTextModel', data.geminiTextModel);
        if (dom.geminiTextModelSelect) dom.geminiTextModelSelect.value = data.geminiTextModel;
    }
    if (data.ai33ApiKey && !state.ai33ApiKey) {
        state.ai33ApiKey = data.ai33ApiKey;
        localStorage.setItem('ai33ApiKey', data.ai33ApiKey);
        if (dom.ai33ApiKeyInput) dom.ai33ApiKeyInput.value = data.ai33ApiKey;
    }
    if (data.stabilityApiKey && !state.stabilityApiKey) {
        state.stabilityApiKey = data.stabilityApiKey;
        localStorage.setItem('stabilityApiKey', data.stabilityApiKey);
        if (dom.stabilityApiKeyInput) dom.stabilityApiKeyInput.value = data.stabilityApiKey;
    }
    if (data.elevenlabsApiKey && !state.elevenlabsApiKey) {
        state.elevenlabsApiKey = data.elevenlabsApiKey;
        localStorage.setItem('elevenlabsApiKey', data.elevenlabsApiKey);
        if (dom.elevenlabsApiKeyInput) dom.elevenlabsApiKeyInput.value = data.elevenlabsApiKey;
    }
    if (data.elevenlabsSelectedModel) {
        state.elevenlabsSelectedModel = data.elevenlabsSelectedModel;
        localStorage.setItem('elevenlabsSelectedModel', data.elevenlabsSelectedModel);
    }
    if (data.deepgramApiKey && !state.deepgramApiKey) {
        state.deepgramApiKey = data.deepgramApiKey;
        localStorage.setItem('deepgramApiKey', data.deepgramApiKey);
        if (dom.deepgramApiKeyInput) dom.deepgramApiKeyInput.value = data.deepgramApiKey;
    }
    if (data.freesoundApiKey && !state.freesoundApiKey) {
        state.freesoundApiKey = data.freesoundApiKey;
        localStorage.setItem('freesoundApiKey', data.freesoundApiKey);
        if (dom.freesoundApiKeyInput) dom.freesoundApiKeyInput.value = data.freesoundApiKey;
    }
    if (data.pexelsApiKey && !state.pexelsApiKey) {
        state.pexelsApiKey = data.pexelsApiKey;
        localStorage.setItem('pexelsApiKey', data.pexelsApiKey);
        if (dom.pexelsApiKeyInput) dom.pexelsApiKeyInput.value = data.pexelsApiKey;
    }
    if (data.gradioTtsApiUrl && !state.gradioTtsApiUrl) {
        state.gradioTtsApiUrl = data.gradioTtsApiUrl;
        localStorage.setItem('gradioTtsApiUrl', data.gradioTtsApiUrl);
        if (dom.gradioTtsApiUrlInput) dom.gradioTtsApiUrlInput.value = data.gradioTtsApiUrl;
    }

    ui.updateGeminiApiKeyUiState();
    ui.updateAi33ApiKeyUiState();
    ui.updateStabilityApiKeyUiState();
    ui.updateElevenlabsApiKeyUiState();
    ui.updateDeepgramApiKeyUiState();
    ui.updateFreesoundApiKeyUiState();
    ui.updatePexelsApiKeyUiState();
    ui.updateApiStatusBadge();
}

// --- API Key Management ---

export function loadGeminiTextModel() {
    let model = localStorage.getItem('geminiTextModel');
    // Upgrade existing stored defaults from deprecated 3.7 and 3.5 models to 3.8
    if (!model || model === 'gemini-3.7-flash' || model === 'gemini-3.5-flash' || model === 'gemini-3.7' || model === 'gemini-3.5') {
        model = constants.PRIMARY_MODEL;
        localStorage.setItem('geminiTextModel', model);
    }

    if (model) {
        state.currentTextModel = model;
        if (dom.geminiTextModelSelect) dom.geminiTextModelSelect.value = model;
    } else {
        state.currentTextModel = dom.geminiTextModelSelect?.value || constants.PRIMARY_MODEL;
        if (dom.geminiTextModelSelect) dom.geminiTextModelSelect.value = state.currentTextModel;
    }
}

export function handleGeminiTextModelChange() {
    const model = dom.geminiTextModelSelect.value;
    state.currentTextModel = model;
    localStorage.setItem('geminiTextModel', model);
    syncAllApiKeysAndSettings();
}

/**
 * Sanitizes a cookie value by stripping leading prefix names, quotes, semicolons, and whitespace.
 */
export function cleanCookieValue(raw: string, expectedKey?: string): string {
    if (!raw) return '';
    let val = raw.trim();
    if (expectedKey && val.startsWith(`${expectedKey}=`)) {
        val = val.substring(expectedKey.length + 1).trim();
    }
    // Also remove generic key= pattern if present
    if (val.includes('=') && !val.startsWith('g.a') && !val.startsWith('sidts-')) {
        const parts = val.split('=');
        if (parts.length === 2) val = parts[1].trim();
    }
    // Strip wrapping quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).trim();
    }
    // Strip trailing semicolons
    if (val.endsWith(';')) val = val.slice(0, -1).trim();
    return val;
}

/**
 * Parses multi-cookie strings (e.g. copied from DevTools, cURL, JSON dumps, or document.cookie) and fills the fields.
 */
export function parseAndFillCookiesFromText(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    
    // Check if pasted content is a JSON object
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'object' && parsed !== null) {
                let found = false;
                if (parsed['__Secure-1PSID'] && dom.geminiPsidInput) { dom.geminiPsidInput.value = cleanCookieValue(parsed['__Secure-1PSID']); found = true; }
                if (parsed['__Secure-1PSIDTS'] && dom.geminiPsidtsInput) { dom.geminiPsidtsInput.value = cleanCookieValue(parsed['__Secure-1PSIDTS']); found = true; }
                if (parsed['__Secure-1PSIDCC'] && dom.geminiPsidccInput) { dom.geminiPsidccInput.value = cleanCookieValue(parsed['__Secure-1PSIDCC']); found = true; }
                if (parsed['COMPASS'] && dom.geminiCompassInput) { dom.geminiCompassInput.value = cleanCookieValue(parsed['COMPASS']); found = true; }
                if (parsed['SID'] && dom.geminiSidInput) { dom.geminiSidInput.value = cleanCookieValue(parsed['SID']); found = true; }
                if (parsed['HSID'] && dom.geminiHsidInput) { dom.geminiHsidInput.value = cleanCookieValue(parsed['HSID']); found = true; }
                if (parsed['SSID'] && dom.geminiSsidInput) { dom.geminiSsidInput.value = cleanCookieValue(parsed['SSID']); found = true; }
                if (found) {
                    ui.showStatus('✓ Auto-extracted cookies from JSON object!', false, 2500);
                    ui.updateGeminiApiKeyUiState();
                    return true;
                }
            }
        } catch {}
    }

    const hasPsid = trimmed.includes('__Secure-1PSID');
    const hasSemicolon = trimmed.includes(';') || trimmed.includes('\n');
    
    if (hasPsid || hasSemicolon || trimmed.includes('=')) {
        let psid = '';
        let psidts = '';
        let psidcc = '';
        let compass = '';
        let sid = '';
        let hsid = '';
        let ssid = '';

        // Match __Secure-1PSID
        const psidMatch = trimmed.match(/__Secure-1PSID=([^;\s\r\n]+)/);
        if (psidMatch) psid = psidMatch[1];

        // Match __Secure-1PSIDTS
        const psidtsMatch = trimmed.match(/__Secure-1PSIDTS=([^;\s\r\n]+)/);
        if (psidtsMatch) psidts = psidtsMatch[1];

        // Match __Secure-1PSIDCC
        const psidccMatch = trimmed.match(/__Secure-1PSIDCC=([^;\s\r\n]+)/);
        if (psidccMatch) psidcc = psidccMatch[1];

        // Match COMPASS
        const compassMatch = trimmed.match(/(?:^|;\s*|\s+)COMPASS=([^;\s\r\n]+)/i);
        if (compassMatch) compass = compassMatch[1];

        // Match SID (with boundary to avoid matching 1PSID/APISID/HSID/SSID)
        const sidMatch = trimmed.match(/(?:^|;\s*|\s+)SID=([^;\s\r\n]+)/);
        if (sidMatch) sid = sidMatch[1];

        // Match HSID
        const hsidMatch = trimmed.match(/(?:^|;\s*|\s+)HSID=([^;\s\r\n]+)/);
        if (hsidMatch) hsid = hsidMatch[1];

        // Match SSID
        const ssidMatch = trimmed.match(/(?:^|;\s*|\s+)SSID=([^;\s\r\n]+)/);
        if (ssidMatch) ssid = ssidMatch[1];

        if (psid || psidts || psidcc || compass || sid || hsid || ssid) {
            if (psid && dom.geminiPsidInput) dom.geminiPsidInput.value = cleanCookieValue(psid);
            if (psidts && dom.geminiPsidtsInput) dom.geminiPsidtsInput.value = cleanCookieValue(psidts);
            if (psidcc && dom.geminiPsidccInput) dom.geminiPsidccInput.value = cleanCookieValue(psidcc);
            if (compass && dom.geminiCompassInput) dom.geminiCompassInput.value = cleanCookieValue(compass);
            if (sid && dom.geminiSidInput) dom.geminiSidInput.value = cleanCookieValue(sid);
            if (hsid && dom.geminiHsidInput) dom.geminiHsidInput.value = cleanCookieValue(hsid);
            if (ssid && dom.geminiSsidInput) dom.geminiSsidInput.value = cleanCookieValue(ssid);
            ui.showStatus('✓ Auto-extracted cookies from pasted text!', false, 2500);
            ui.updateGeminiApiKeyUiState();
            return true;
        }
    }
    return false;
}

export function loadGeminiAuthMode() {
    let mode = localStorage.getItem('geminiAuthMode') as 'builtin' | 'apiKey' | 'webCookie' | 'openaiGateway';
    if (mode === 'webCookie' && !isCookieAuthAllowedForCurrentUser()) {
        mode = 'builtin';
        localStorage.setItem('geminiAuthMode', 'builtin');
    }
    if (mode) {
        state.geminiAuthMode = mode;
        if (dom.geminiAuthModeSelect) dom.geminiAuthModeSelect.value = mode;
    }

    const gatewayBaseUrl = localStorage.getItem('openaiGatewayBaseUrl');
    const gatewayApiKey = localStorage.getItem('openaiGatewayApiKey');
    const gatewayModel = localStorage.getItem('openaiGatewayModel');
    const gatewayImageModel = localStorage.getItem('openaiGatewayImageModel');

    if (gatewayBaseUrl) {
        state.openaiGatewayBaseUrl = gatewayBaseUrl;
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = gatewayBaseUrl;
    }
    if (gatewayApiKey) {
        state.openaiGatewayApiKey = gatewayApiKey;
        if (dom.openaiGatewayApiKeyInput) dom.openaiGatewayApiKeyInput.value = gatewayApiKey;
    }
    if (gatewayModel) {
        state.openaiGatewayModel = gatewayModel;
        if (dom.openaiGatewayModelInput) dom.openaiGatewayModelInput.value = gatewayModel;
    }
    if (gatewayImageModel) {
        state.openaiGatewayImageModel = gatewayImageModel;
        if (dom.openaiGatewayImageModelInput) dom.openaiGatewayImageModelInput.value = gatewayImageModel;
    }
    
    // We await restore in background so it doesn't block sync initialization
    restoreGeminiCookiesFromServer().then(() => {
        ui.updateGeminiApiKeyUiState();
        ui.updateApiStatusBadge();

        // Perform silent background health check if cookies are configured
        if (state.geminiAuthMode === 'webCookie' && state.geminiPsid && isCookieAuthAllowedForCurrentUser()) {
            testGeminiCookieHealth(false);
        }
    });
}

export function handleGeminiAuthModeChange() {
    let mode = dom.geminiAuthModeSelect.value as 'builtin' | 'apiKey' | 'webCookie' | 'openaiGateway';
    if (mode === 'webCookie' && !isCookieAuthAllowedForCurrentUser()) {
        ui.showStatus('Gemini Web Cookie mode is not enabled for your account. Please contact an administrator.', true, 4000);
        mode = 'builtin';
        dom.geminiAuthModeSelect.value = 'builtin';
    }
    state.geminiAuthMode = mode;
    localStorage.setItem('geminiAuthMode', mode);
    syncAllApiKeysAndSettings();
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();

    if (mode === 'webCookie' && state.geminiPsid && isCookieAuthAllowedForCurrentUser()) {
        testGeminiCookieHealth(false);
    }
}

/**
 * Tests the Gemini session cookies with Google server.
 */
export async function testGeminiCookieHealth(showToast = true) {
    const psid = cleanCookieValue(dom.geminiPsidInput?.value.trim() || state.geminiPsid || '');
    const psidts = cleanCookieValue(dom.geminiPsidtsInput?.value.trim() || state.geminiPsidts || '');
    const psidcc = cleanCookieValue(dom.geminiPsidccInput?.value.trim() || state.geminiPsidcc || '');
    const compass = cleanCookieValue(dom.geminiCompassInput?.value.trim() || state.geminiCompass || '');
    const sid = cleanCookieValue(dom.geminiSidInput?.value.trim() || state.geminiSid || '');
    const hsid = cleanCookieValue(dom.geminiHsidInput?.value.trim() || state.geminiHsid || '');
    const ssid = cleanCookieValue(dom.geminiSsidInput?.value.trim() || state.geminiSsid || '');

    if (!psid) {
        ui.updateGeminiCookieHealthUi('none');
        if (showToast) ui.showStatus('Please enter your __Secure-1PSID cookie to test.', true, 3000);
        return;
    }

    ui.updateGeminiCookieHealthUi('checking', 'Contacting Google to verify session...');

    try {
        const response = await fetch("/api/llm/test/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                cookies: {
                    '__Secure-1PSID': psid,
                    '__Secure-1PSIDTS': psidts,
                    '__Secure-1PSIDCC': psidcc,
                    'COMPASS': compass,
                    'SID': sid,
                    'HSID': hsid,
                    'SSID': ssid
                } 
            })
        });
        const text = await response.text();
        let data: any;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            const isHtml = text && text.trim().startsWith('<');
            const friendlyErr = isHtml
                ? 'Backend server is initializing or restarting. Please try verifying again in a few moments.'
                : `Server returned unexpected response (${response.status}): ${text.slice(0, 100) || 'Empty body'}`;
            data = { valid: false, error: friendlyErr };
        }
        
        if (data.valid) {
            const now = Date.now();
            sessionStorage.setItem('geminiCookieExpired', 'false');
            localStorage.setItem('geminiCookieExpired', 'false');
            sessionStorage.setItem('geminiCookieVerifiedAt', now.toString());
            if (data.updatedCookies) {
                await applyUpdatedGeminiCookies(data.updatedCookies);
            }
            ui.updateGeminiCookieHealthUi('valid', data.message || 'Connected to Gemini Web', now);
            ui.updateApiStatusBadge();
            if (showToast) {
                ui.showStatus('✓ Gemini session is active and valid!', false, 2500);
            }
        } else {
            sessionStorage.setItem('geminiCookieExpired', 'true');
            localStorage.setItem('geminiCookieExpired', 'true');
            ui.updateGeminiCookieHealthUi('invalid', data.error || 'Session expired or invalid', Date.now());
            ui.updateApiStatusBadge();
            if (showToast) {
                ui.showStatus('⚠️ Gemini session check failed: ' + (data.error || 'Session expired'), true, 4000);
            }
        }
    } catch (error: any) {
        sessionStorage.setItem('geminiCookieExpired', 'true');
        localStorage.setItem('geminiCookieExpired', 'true');
        ui.updateGeminiCookieHealthUi('invalid', `Network error checking session: ${error.message}`);
        ui.updateApiStatusBadge();
        if (showToast) {
            ui.showStatus('Error checking session: ' + error.message, true, 3000);
        }
    }
}

export async function saveGeminiCookie() {
    const rawPsid = dom.geminiPsidInput?.value || '';
    const rawPsidts = dom.geminiPsidtsInput?.value || '';
    const rawPsidcc = dom.geminiPsidccInput?.value || '';
    const rawCompass = dom.geminiCompassInput?.value || '';
    const rawSid = dom.geminiSidInput?.value || '';
    const rawHsid = dom.geminiHsidInput?.value || '';
    const rawSsid = dom.geminiSsidInput?.value || '';

    // Check if user pasted a multi-cookie string in psid input or anywhere
    if (rawPsid.includes('__Secure-1PSID') || rawPsid.includes(';') || rawPsid.includes('=')) {
        parseAndFillCookiesFromText(rawPsid);
    }

    const psid = cleanCookieValue(dom.geminiPsidInput?.value || '', '__Secure-1PSID');
    const psidts = cleanCookieValue(dom.geminiPsidtsInput?.value || '', '__Secure-1PSIDTS');
    const psidcc = cleanCookieValue(dom.geminiPsidccInput?.value || '', '__Secure-1PSIDCC');
    const compass = cleanCookieValue(dom.geminiCompassInput?.value || '', 'COMPASS');
    const sid = cleanCookieValue(dom.geminiSidInput?.value || '', 'SID');
    const hsid = cleanCookieValue(dom.geminiHsidInput?.value || '', 'HSID');
    const ssid = cleanCookieValue(dom.geminiSsidInput?.value || '', 'SSID');

    // Update cleaned values in inputs
    if (dom.geminiPsidInput) dom.geminiPsidInput.value = psid;
    if (dom.geminiPsidtsInput) dom.geminiPsidtsInput.value = psidts;
    if (dom.geminiPsidccInput) dom.geminiPsidccInput.value = psidcc;
    if (dom.geminiCompassInput) dom.geminiCompassInput.value = compass;
    if (dom.geminiSidInput) dom.geminiSidInput.value = sid;
    if (dom.geminiHsidInput) dom.geminiHsidInput.value = hsid;
    if (dom.geminiSsidInput) dom.geminiSsidInput.value = ssid;

    if (!psid) {
        ui.showStatus('Please provide your __Secure-1PSID cookie.', true, 3000);
        ui.updateGeminiCookieHealthUi('none');
        return;
    }

    ui.updateGeminiCookieHealthUi('checking', 'Verifying session credentials with Google...');
    
    try {
        const response = await fetch("/api/llm/test/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                cookies: {
                    '__Secure-1PSID': psid,
                    '__Secure-1PSIDTS': psidts,
                    '__Secure-1PSIDCC': psidcc,
                    'COMPASS': compass,
                    'SID': sid,
                    'HSID': hsid,
                    'SSID': ssid
                } 
            })
        });
        const text = await response.text();
        let data: any;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            const isHtml = text && text.trim().startsWith('<');
            const friendlyErr = isHtml
                ? 'Backend server is initializing or restarting. Please try verifying again in a few moments.'
                : `Server returned unexpected response (${response.status}): ${text.slice(0, 100) || 'Empty body'}`;
            data = { valid: false, error: friendlyErr };
        }
        
        if (data.valid) {
            const now = Date.now();
            const fresh = data.updatedCookies || {};
            state.geminiPsid = fresh['__Secure-1PSID'] || psid;
            state.geminiPsidts = fresh['__Secure-1PSIDTS'] || psidts;
            state.geminiPsidcc = fresh['__Secure-1PSIDCC'] || psidcc;
            state.geminiCompass = fresh['COMPASS'] || compass;
            state.geminiSid = fresh['SID'] || sid;
            state.geminiHsid = fresh['HSID'] || hsid;
            state.geminiSsid = fresh['SSID'] || ssid;
            
            await fetch('/api/llm/save-cookies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    cookies: {
                        '__Secure-1PSID': state.geminiPsid,
                        '__Secure-1PSIDTS': state.geminiPsidts,
                        '__Secure-1PSIDCC': state.geminiPsidcc,
                        'COMPASS': state.geminiCompass,
                        'SID': state.geminiSid,
                        'HSID': state.geminiHsid,
                        'SSID': state.geminiSsid
                    }
                })
            });

            try {
                await DB.put(constants.APP_STATE_STORE, {
                    '__Secure-1PSID': state.geminiPsid,
                    '__Secure-1PSIDTS': state.geminiPsidts,
                    '__Secure-1PSIDCC': state.geminiPsidcc,
                    'COMPASS': state.geminiCompass,
                    'SID': state.geminiSid,
                    'HSID': state.geminiHsid,
                    'SSID': state.geminiSsid
                }, 'geminiWebCookies');
            } catch {}

            sessionStorage.setItem('geminiCookieExpired', 'false');
            localStorage.setItem('geminiCookieExpired', 'false');
            sessionStorage.setItem('geminiCookieVerifiedAt', now.toString());
            syncAllApiKeysAndSettings();
            
            ui.updateGeminiCookieHealthUi('valid', data.message || 'Connected to Gemini Web', now);
            ui.showStatus('✓ Gemini cookies verified & saved securely!', false, 2500);
            ui.updateGeminiApiKeyUiState();
            ui.updateApiStatusBadge();
        } else {
            sessionStorage.setItem('geminiCookieExpired', 'true');
            localStorage.setItem('geminiCookieExpired', 'true');
            ui.updateGeminiCookieHealthUi('invalid', data.error || 'Google session invalid. Please copy fresh cookies.');
            ui.showStatus('⚠️ Cookie validation failed: ' + (data.error || 'Invalid session'), true, 4500);
        }
    } catch (error: any) {
        ui.updateGeminiCookieHealthUi('invalid', `Network error during verification: ${error.message}`);
        ui.showStatus('Error verifying cookies: ' + error.message, true, 3500);
    }
}

export async function clearGeminiCookie() {
    state.geminiPsid = null;
    state.geminiPsidts = null;
    state.geminiPsidcc = null;
    state.geminiCompass = null;
    state.geminiSid = null;
    state.geminiHsid = null;
    state.geminiSsid = null;

    try {
        await DB.delete(constants.APP_STATE_STORE, 'geminiWebCookies');
    } catch {}

    sessionStorage.removeItem('geminiCookieExpired');
    localStorage.removeItem('geminiCookieExpired');
    sessionStorage.removeItem('geminiCookieVerifiedAt');

    await fetch('/api/llm/clear-cookies', { method: 'POST', credentials: 'include' });
    if (dom.geminiPsidInput) dom.geminiPsidInput.value = '';
    if (dom.geminiPsidtsInput) dom.geminiPsidtsInput.value = '';
    if (dom.geminiPsidccInput) dom.geminiPsidccInput.value = '';
    if (dom.geminiCompassInput) dom.geminiCompassInput.value = '';
    if (dom.geminiSidInput) dom.geminiSidInput.value = '';
    if (dom.geminiHsidInput) dom.geminiHsidInput.value = '';
    if (dom.geminiSsidInput) dom.geminiSsidInput.value = '';

    try {
        await fetch('/api/llm/save-cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cookies: {} })
        });
    } catch (e) {
        console.warn('Failed to clear secure server cookies:', e);
    }

    ui.updateGeminiCookieHealthUi('none');
    ui.showStatus('Gemini cookies cleared.', false, 2000);
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();
    syncAllApiKeysAndSettings();
}

/**
 * Loads the user's Gemini API key from local storage.
 */
export function loadUserGeminiApiKey() {
    const key = localStorage.getItem('userGeminiApiKey');
    const storedProvider = localStorage.getItem('geminiProvider') as 'aistudio' | 'vertex' | null;
    let vertexAuthMode = (localStorage.getItem('vertexAuthMode') === 'adc' ? 'adc' : 'apiKey') as 'apiKey' | 'adc';
    const vertexProjectId = localStorage.getItem('vertexProjectId') || '';
    const vertexLocation = localStorage.getItem('vertexLocation') || 'us-central1';

    // Fall back to aistudio out-of-the-box if no API key exists and no preference is saved
    if (storedProvider) {
        state.geminiProvider = storedProvider;
    } else if (!key) {
        state.geminiProvider = 'vertex';
    }

    state.vertexAuthMode = vertexAuthMode;

    state.vertexProjectId = vertexProjectId || null;
    if (dom.userVertexProjectInput) dom.userVertexProjectInput.value = vertexProjectId;

    state.vertexLocation = vertexLocation;
    if (dom.userVertexLocationInput) dom.userVertexLocationInput.value = vertexLocation;
    
    // Update UI tabs
    updateUserVertexUITabs(state.geminiProvider);
    updateUserVertexAuthModeUI(state.vertexAuthMode || 'apiKey');

    if (key) {
        state.userGeminiApiKey = key;
        dom.geminiApiKeyInput.value = key;
    }
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();

    // Check server-side Vertex AI / Cloud Run environment configuration
    fetch('/api/vertex/config')
        .then(res => res.ok ? res.json() : null)
        .then(cfg => {
            if (cfg?.enabled) {
                if (!localStorage.getItem('vertexLocation') && cfg.location) {
                    if (dom.userVertexLocationInput) {
                        dom.userVertexLocationInput.value = cfg.location;
                    }
                }
                // Do not force Vertex mode automatically, let AI Studio remain the default
            }
        })
        .catch(() => {});
}

export function updateUserVertexUITabs(provider: 'aistudio' | 'vertex') {
    state.geminiProvider = provider;
    utils.dismissSafeStatus(dom.vertexConnectionStatus);
    utils.dismissSafeStatus(dom.geminiApiKeyStatus);
    if (!dom.userAuthAIStudioTab) return;
    if (provider === 'vertex') {
        dom.userAuthAIStudioTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded text-gray-400 hover:text-white transition-colors";
        dom.userAuthVertexTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded bg-blue-600 text-white transition-colors";
        dom.userVertexFields?.classList.remove('hidden');
        dom.userGeminiGetKeyLink?.classList.add('hidden');
    } else {
        dom.userAuthAIStudioTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded bg-blue-600 text-white transition-colors";
        dom.userAuthVertexTab.className = "flex-1 py-1 px-2 text-[11px] font-medium rounded text-gray-400 hover:text-white transition-colors";
        dom.userVertexFields?.classList.add('hidden');
        dom.userGeminiGetKeyLink?.classList.remove('hidden');
    }
    ui.updateGeminiApiKeyUiState();
}

export function updateUserVertexAuthModeUI(mode: 'apiKey' | 'adc') {
    state.vertexAuthMode = mode;
    localStorage.setItem('vertexAuthMode', mode);
    utils.dismissSafeStatus(dom.vertexConnectionStatus);
    utils.dismissSafeStatus(dom.geminiApiKeyStatus);
    if (!dom.userVertexAuthApiKeyBtn || !dom.userVertexAuthAdcBtn) return;
    if (mode === 'adc') {
        dom.userVertexAuthApiKeyBtn.className = "px-2.5 py-0.5 text-[10px] font-semibold rounded transition text-gray-400 hover:text-white";
        dom.userVertexAuthAdcBtn.className = "px-2.5 py-0.5 text-[10px] font-semibold rounded transition bg-blue-600 text-white";
        dom.userVertexAdcInfo?.classList.remove('hidden');
        if (dom.geminiApiKeyInput) {
            dom.geminiApiKeyInput.placeholder = "API Key (Optional when using server ADC)";
        }
    } else {
        dom.userVertexAuthApiKeyBtn.className = "px-2.5 py-0.5 text-[10px] font-semibold rounded transition bg-blue-600 text-white";
        dom.userVertexAuthAdcBtn.className = "px-2.5 py-0.5 text-[10px] font-semibold rounded transition text-gray-400 hover:text-white";
        dom.userVertexAdcInfo?.classList.add('hidden');
        if (dom.geminiApiKeyInput) {
            dom.geminiApiKeyInput.placeholder = "Enter your API key";
        }
    }
}

export async function testVertexConnection() {
    if (!dom.testVertexConnectionBtn || !dom.vertexConnectionStatus) return;
    
    const authMode = state.vertexAuthMode || 'apiKey';
    const apiKey = dom.geminiApiKeyInput?.value.trim() || '';
    const project = (dom.userVertexProjectInput?.value.trim() || state.vertexProjectId || '').replace(/[^a-zA-Z0-9-]/g, '');
    const location = dom.userVertexLocationInput?.value.trim() || state.vertexLocation || 'us-central1';
    const model = state.currentTextModel || localStorage.getItem('geminiTextModel') || constants.PRIMARY_MODEL;
    
    const statusDiv = dom.vertexConnectionStatus;
    const btn = dom.testVertexConnectionBtn;

    if (!apiKey && authMode === 'apiKey') {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-amber-900/30 border border-amber-500/50 text-amber-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'warning',
            title: 'Missing API Key',
            message: 'Please enter a Google Cloud API Key with Vertex AI API enabled to test.'
        });
        return;
    }
    
    // UI Reset
    statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-gray-900 border border-gray-700 text-gray-300";
    statusDiv.textContent = "Connecting to Vertex AI...";
    statusDiv.classList.remove("hidden");
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Testing...</span>`;

    try {
        const payload = { authMode, apiKey, project, location, model };
        let result;

        if (window.location.hostname.includes('web.app') || window.location.hostname.includes('firebaseapp.com')) {
            const { getFunctions, httpsCallable } = await import(/* @vite-ignore */ 'firebase/functions');
            const functions = getFunctions();
            const testFn = httpsCallable(functions, 'testVertex');
            const callRes = await testFn(payload);
            result = callRes.data;
        } else {
            const res = await fetch('/api/vertex/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            result = await res.json();
        }

        if (result.valid) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-green-900/30 border border-green-500/50 text-green-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'success',
                title: 'Success!',
                message: result.message,
                latencyMs: result.latencyMs
            });
        } else {
            const isIam = result.code === 'PERMISSION_DENIED' || /aiplatform.endpoints.predict|roles\/aiplatform.user/i.test(result.error || '');
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'error',
                title: isIam ? 'Vertex IAM Role Required' : 'Connection Failed',
                code: result.code || 'ERROR',
                error: result.error,
                rawError: result.rawError
            });
        }
    } catch (error: any) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Network Error',
            error: error.message || 'Could not reach the server to run the test.'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span>Test Connection</span>`;
    }
}

export function sanitizeApiKey(raw: string | undefined | null): string {
    if (!raw) return '';
    let key = String(raw).trim();
    // Strip leading/trailing quotes or backticks
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")) || (key.startsWith('`') && key.endsWith('`'))) {
        key = key.slice(1, -1).trim();
    }
    // Strip prefixes like "export GEMINI_API_KEY=", "GEMINI_API_KEY=", "API_KEY:", "Bearer "
    key = key.replace(/^(export\s+)?([A-Z0-9_]+_KEY|apiKey|Authorization:\s*Bearer)\s*[:=]\s*/i, '').trim();
    // Strip zero-width, BOM, non-breaking space characters
    key = key.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
    // Strip all internal whitespace (spaces, tabs, newlines from multi-line terminal copy)
    key = key.replace(/\s+/g, '');
    return key;
}

/**
 * Tests the Gemini API key connection against Google AI Studio (or Vertex AI if selected).
 */
export async function testGeminiApiKeyConnection() {
    if (!dom.testGeminiApiKeyBtn || !dom.geminiApiKeyStatus) return;

    const provider = state.geminiProvider || 'aistudio';
    const rawInputKey = dom.geminiApiKeyInput?.value || '';
    const cleanedKey = sanitizeApiKey(rawInputKey) || sanitizeApiKey(state.userGeminiApiKey) || '';
    if (dom.geminiApiKeyInput && rawInputKey !== cleanedKey) {
        dom.geminiApiKeyInput.value = cleanedKey;
    }
    const apiKey = cleanedKey;
    const project = (dom.userVertexProjectInput?.value.trim() || state.vertexProjectId || '').replace(/[^a-zA-Z0-9-]/g, '');
    const location = dom.userVertexLocationInput?.value.trim() || state.vertexLocation || 'us-central1';
    const authMode = state.vertexAuthMode || 'apiKey';
    const model = state.currentTextModel || localStorage.getItem('geminiTextModel') || constants.PRIMARY_MODEL;

    const statusDiv = dom.geminiApiKeyStatus;
    const btn = dom.testGeminiApiKeyBtn;

    if (!apiKey && !(provider === 'vertex' && authMode === 'adc')) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-amber-900/30 border border-amber-500/50 text-amber-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'warning',
            title: 'Missing API Key',
            message: 'Please enter a Gemini API key to test.'
        });
        return;
    }

    // UI Reset
    statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-gray-900 border border-gray-700 text-gray-300";
    statusDiv.textContent = provider === 'vertex' ? "Connecting to Vertex AI..." : "Connecting to Google AI Studio...";
    statusDiv.classList.remove("hidden");
    btn.disabled = true;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Testing Key...</span>`;

    try {
        const payload = { apiKey, provider, project, location, authMode, model };
        let result: any;

        if (window.location.hostname.includes('web.app') || window.location.hostname.includes('firebaseapp.com')) {
            if (provider === 'vertex') {
                const { getFunctions, httpsCallable } = await import(/* @vite-ignore */ 'firebase/functions');
                const functions = getFunctions();
                const testFn = httpsCallable(functions, 'testVertex');
                const callRes = await testFn(payload);
                result = callRes.data;
            } else {
                const res = await fetch('/api/gemini/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                result = await res.json();
            }
        } else {
            const endpoint = provider === 'vertex' ? '/api/vertex/test' : '/api/gemini/test';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            result = await res.json();
        }

        if (result.valid) {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-green-900/30 border border-green-500/50 text-green-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'success',
                title: 'Success!',
                message: result.message,
                latencyMs: result.latencyMs
            });
        } else {
            const isInvalidKey = result.code === 'API_KEY_INVALID' || result.code === 400 || /API_KEY_INVALID|API key not valid/i.test(result.error || '') || /API_KEY_INVALID|API key not valid/i.test(result.rawError || '');
            const isPrepay = result.code === 'PREPAYMENT_DEPLETED' || /prepayment.*depleted|billing#prepay/i.test(result.error || '');
            const isIam = result.code === 'PERMISSION_DENIED' || /aiplatform.endpoints.predict|roles\/aiplatform.user/i.test(result.error || '');
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'error',
                title: isInvalidKey ? 'Invalid Gemini API Key' : isPrepay ? 'Prepayment Credits Depleted' : isIam ? 'Vertex IAM Role Required' : 'Connection Failed',
                code: result.code || 'ERROR',
                error: result.error,
                rawError: result.rawError
            });
        }
    } catch (error: any) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Network Error',
            error: error.message || 'Could not reach the server to run the test.'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span>Test Gemini API Key Connection</span>`;
    }
}

/**
 * Saves the user's Gemini API key to local storage.
 */
export function saveUserGeminiApiKey() {
    const rawKey = dom.geminiApiKeyInput?.value || '';
    const key = sanitizeApiKey(rawKey);
    if (dom.geminiApiKeyInput && rawKey !== key) {
        dom.geminiApiKeyInput.value = key;
    }
    if (state.geminiProvider === 'vertex') {
        state.vertexProjectId = dom.userVertexProjectInput?.value.trim() || null;
        state.vertexLocation = dom.userVertexLocationInput?.value.trim() || 'us-central1';
        if (state.vertexProjectId) {
            localStorage.setItem('vertexProjectId', state.vertexProjectId);
        } else {
            localStorage.removeItem('vertexProjectId');
        }
        if (state.vertexLocation) {
            localStorage.setItem('vertexLocation', state.vertexLocation);
        } else {
            localStorage.removeItem('vertexLocation');
        }
        localStorage.setItem('geminiProvider', 'vertex');
        localStorage.setItem('vertexAuthMode', state.vertexAuthMode || 'apiKey');
    } else {
        localStorage.setItem('geminiProvider', 'aistudio');
    }
    
    // In Vertex ADC mode, API key is optional because server credentials authenticate the call
    const canSave = key || (state.geminiProvider === 'vertex' && state.vertexAuthMode === 'adc');

    if (canSave) {
        state.userGeminiApiKey = key;
        if (key) {
            localStorage.setItem('userGeminiApiKey', key);
        } else {
            localStorage.removeItem('userGeminiApiKey');
        }
        syncAllApiKeysAndSettings();
        ui.showStatus('API Config saved.', false, 2000);
        ui.updateGeminiApiKeyUiState();
        ui.updateApiStatusBadge();
        ui.updateCreditsDisplay();
        ui.triggerApiKeySelectionFlow(); 
    }
}

/**
 * Clears the user's Gemini API key from local storage.
 */
export function clearUserGeminiApiKey() {
    state.userGeminiApiKey = null;
    state.vertexProjectId = null;
    state.vertexLocation = null;
    state.vertexAuthMode = 'apiKey';
    if (dom.geminiApiKeyInput) dom.geminiApiKeyInput.value = '';
    if (dom.userVertexProjectInput) dom.userVertexProjectInput.value = '';
    localStorage.removeItem('userGeminiApiKey');
    localStorage.removeItem('vertexProjectId');
    localStorage.removeItem('vertexLocation');
    localStorage.removeItem('vertexAuthMode');
    updateUserVertexAuthModeUI('apiKey');
    ui.showStatus('API Config cleared.', false, 2000);
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();
    ui.updateCreditsDisplay();
    ui.triggerApiKeySelectionFlow();
    syncAllApiKeysAndSettings();
}

/**
 * Saves OpenAI-compatible gateway settings.
 */
export function saveOpenaiGatewayConfig() {
    let baseUrl = dom.openaiGatewayBaseUrlInput?.value.trim() || '';
    const apiKey = dom.openaiGatewayApiKeyInput?.value.trim() || '';
    let model = dom.openaiGatewayModelInput?.value.trim() || 'gemini-3.8-flash';
    const imageModel = dom.openaiGatewayImageModelInput?.value.trim() || '';

    if (/experientiallabs\.ai/i.test(baseUrl)) {
        baseUrl = 'https://api.experientiallabs.ai/v1';
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = baseUrl;
        // If Experiential Labs, normalize deprecated Gemini 3.7 and 3.5 aliases to 3.8
        const lower = model.toLowerCase();
        if (lower === 'gemini-3.7' || lower === 'gemini 3.7' || lower === 'google/gemini-3.7-flash' || lower === 'gemini 3.7 flash' || lower === 'gemini-3.7-flash' ||
            lower === 'gemini-3.5' || lower === 'gemini 3.5' || lower === 'google/gemini-3.5-flash' || lower === 'gemini 3.5 flash' || lower === 'gemini-3.5-flash') {
            model = 'gemini-3.8-flash';
            if (dom.openaiGatewayModelInput) dom.openaiGatewayModelInput.value = model;
        }
    }

    state.openaiGatewayBaseUrl = baseUrl || null;
    state.openaiGatewayApiKey = apiKey || null;
    state.openaiGatewayModel = model || null;
    state.openaiGatewayImageModel = imageModel || null;
    state.geminiAuthMode = 'openaiGateway';
    localStorage.setItem('geminiAuthMode', 'openaiGateway');
    if (dom.geminiAuthModeSelect) dom.geminiAuthModeSelect.value = 'openaiGateway';

    if (baseUrl) {
        localStorage.setItem('openaiGatewayBaseUrl', baseUrl);
    } else {
        localStorage.removeItem('openaiGatewayBaseUrl');
    }

    if (apiKey) {
        localStorage.setItem('openaiGatewayApiKey', apiKey);
    } else {
        localStorage.removeItem('openaiGatewayApiKey');
    }

    if (model) {
        localStorage.setItem('openaiGatewayModel', model);
    } else {
        localStorage.removeItem('openaiGatewayModel');
    }

    if (imageModel) {
        localStorage.setItem('openaiGatewayImageModel', imageModel);
    } else {
        localStorage.removeItem('openaiGatewayImageModel');
    }

    syncAllApiKeysAndSettings();
    ui.showStatus('Gateway Config saved & activated.', false, 2000);
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();
}

/**
 * Clears OpenAI-compatible gateway settings.
 */
export function clearOpenaiGatewayConfig() {
    state.openaiGatewayBaseUrl = null;
    state.openaiGatewayApiKey = null;
    state.openaiGatewayModel = null;
    state.openaiGatewayImageModel = null;

    if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = '';
    if (dom.openaiGatewayApiKeyInput) dom.openaiGatewayApiKeyInput.value = '';
    if (dom.openaiGatewayModelInput) dom.openaiGatewayModelInput.value = '';
    if (dom.openaiGatewayImageModelInput) dom.openaiGatewayImageModelInput.value = '';
    if (dom.openaiConnectionStatus) {
        dom.openaiConnectionStatus.classList.add('hidden');
        dom.openaiConnectionStatus.innerHTML = '';
    }

    localStorage.removeItem('openaiGatewayBaseUrl');
    localStorage.removeItem('openaiGatewayApiKey');
    localStorage.removeItem('openaiGatewayModel');
    localStorage.removeItem('openaiGatewayImageModel');

    syncAllApiKeysAndSettings();
    ui.showStatus('Gateway Config cleared.', false, 2000);
    ui.updateGeminiApiKeyUiState();
    ui.updateApiStatusBadge();
}

/**
 * Tests connection to the configured OpenAI-compatible gateway.
 */
export async function testOpenaiGatewayConnection() {
    const btn = dom.testOpenaiConnectionBtn;
    const statusDiv = dom.openaiConnectionStatus;
    if (!btn || !statusDiv) return;

    let baseUrl = dom.openaiGatewayBaseUrlInput?.value.trim() || state.openaiGatewayBaseUrl || '';
    const apiKey = dom.openaiGatewayApiKeyInput?.value.trim() || state.openaiGatewayApiKey || '';
    const model = dom.openaiGatewayModelInput?.value.trim() || state.openaiGatewayModel || 'gpt-4o';

    if (/experientiallabs\.ai/i.test(baseUrl)) {
        baseUrl = 'https://api.experientiallabs.ai/v1';
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = baseUrl;
    }

    if (!baseUrl) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Missing Base URL',
            message: 'Please enter an API Base URL (e.g. https://openrouter.ai/api/v1).'
        });
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
            utils.renderSafeStatus(statusDiv, {
                type: 'success',
                title: 'Gateway Connected!',
                message: result.message,
                model: result.model,
                latencyMs: result.latencyMs,
                reply: result.reply
            });
        } else {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'error',
                title: 'Connection Failed',
                error: result.error || 'Gateway returned an error.',
                rawError: result.rawError
            });
        }
    } catch (err: any) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Network Error',
            error: err.message || 'Could not reach server proxy.'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

/**
 * Tests connection to the configured OpenAI-compatible gateway for Image Generation (by verifying the model exists).
 */
export async function testOpenaiGatewayImageConnection() {
    const btn = dom.testOpenaiImageConnectionBtn;
    const statusDiv = dom.openaiImageConnectionStatus;
    if (!btn || !statusDiv) return;

    let baseUrl = dom.openaiGatewayBaseUrlInput?.value.trim() || state.openaiGatewayBaseUrl || '';
    const apiKey = dom.openaiGatewayApiKeyInput?.value.trim() || state.openaiGatewayApiKey || '';
    const imageModel = dom.openaiGatewayImageModelInput?.value.trim() || state.openaiGatewayImageModel || 'dall-e-3';

    if (/experientiallabs\.ai/i.test(baseUrl)) {
        baseUrl = 'https://api.experientiallabs.ai/v1';
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = baseUrl;
    }

    if (!baseUrl) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Missing Base URL',
            error: 'Please enter an API Base URL.'
        });
        statusDiv.classList.remove('hidden');
        return;
    }

    statusDiv.classList.remove('hidden');
    statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-indigo-900/30 border border-indigo-500/50 text-indigo-200 animate-pulse";
    statusDiv.textContent = "📡 Connecting to Gateway & verifying image model...";

    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Testing...</span>`;

    try {
        const res = await fetch('/api/openai/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey })
        });
        const data = await res.json();

        if (data.models && Array.isArray(data.models)) {
            const exists = data.models.some((m: string) => m.toLowerCase() === imageModel.toLowerCase());
            if (exists) {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-green-900/30 border border-green-500/50 text-green-300";
                utils.renderSafeStatus(statusDiv, {
                    type: 'success',
                    title: 'Image Gateway Connected!',
                    message: `Model is available on this gateway.`,
                    model: imageModel
                });
            } else {
                statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-yellow-900/30 border border-yellow-500/50 text-yellow-300";
                utils.renderSafeStatus(statusDiv, {
                    type: 'warning',
                    title: 'Connected, but Model Not Found',
                    message: `Gateway is reachable, but model is not in the models list. It may still work if the gateway supports hidden models.`,
                    model: imageModel
                });
            }
        } else {
            statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
            utils.renderSafeStatus(statusDiv, {
                type: 'error',
                title: 'Connection Failed',
                error: data.error || 'Gateway returned an error.'
            });
        }
    } catch (err: any) {
        statusDiv.className = "mt-2 p-2 rounded text-[10px] leading-relaxed break-words bg-red-900/30 border border-red-500/50 text-red-300";
        utils.renderSafeStatus(statusDiv, {
            type: 'error',
            title: 'Network Error',
            error: err.message || 'Could not reach server proxy.'
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

async function doFetchOpenaiGatewayModels(btn: HTMLButtonElement) {
    let baseUrl = dom.openaiGatewayBaseUrlInput?.value.trim() || state.openaiGatewayBaseUrl || '';
    const apiKey = dom.openaiGatewayApiKeyInput?.value.trim() || state.openaiGatewayApiKey || '';

    if (/experientiallabs\.ai/i.test(baseUrl)) {
        baseUrl = 'https://api.experientiallabs.ai/v1';
        if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = baseUrl;
    }

    if (!baseUrl) {
        ui.showStatus('Please enter an API Base URL first.', true, 3000);
        return;
    }

    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> <span>Fetching...</span>`;

    try {
        const res = await fetch('/api/openai/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey })
        });
        const data = await res.json();

        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
            if (dom.openaiModelDatalist) {
                dom.openaiModelDatalist.innerHTML = '';
                data.models.forEach((m: string) => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    dom.openaiModelDatalist.appendChild(opt);
                });
            }

            if (dom.openaiImageModelDatalist) {
                const imageKeywords = /image|dall-e|flux|sdxl|diffusion|recraft|midjourney|paint|draw/i;
                const imgModels = data.models.filter((m: string) => imageKeywords.test(m));
                if (imgModels.length > 0) {
                    dom.openaiImageModelDatalist.innerHTML = '';
                    imgModels.forEach((m: string) => {
                        const opt = document.createElement('option');
                        opt.value = m;
                        dom.openaiImageModelDatalist.appendChild(opt);
                    });
                }
            }

            ui.showStatus(`✓ Loaded ${data.models.length} models from gateway!`, false, 3000);
        } else {
            ui.showStatus(data.error || 'No models returned by gateway.', true, 3000);
        }
    } catch (err: any) {
        ui.showStatus(`Failed to fetch models: ${err.message}`, true, 3000);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

/**
 * Fetches available models from the OpenAI-compatible gateway and populates the datalist.
 */
export async function fetchOpenaiGatewayModels() {
    if (dom.fetchOpenaiModelsBtn) {
        await doFetchOpenaiGatewayModels(dom.fetchOpenaiModelsBtn);
    }
}

export async function fetchOpenaiGatewayImageModels() {
    if (dom.fetchOpenaiImageModelsBtn) {
        await doFetchOpenaiGatewayModels(dom.fetchOpenaiImageModelsBtn);
    }
}

/**
 * Applies a preset gateway configuration (Experiential Labs, OpenRouter, OpenAI, DeepSeek, Groq, Ollama)
 */
export function applyOpenaiGatewayPreset(preset: 'openrouter' | 'openai' | 'deepseek' | 'groq' | 'ollama' | 'experientiallabs') {
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

    const target = presets[preset];
    if (!target) return;

    if (dom.openaiGatewayBaseUrlInput) dom.openaiGatewayBaseUrlInput.value = target.baseUrl;
    if (dom.openaiGatewayModelInput) dom.openaiGatewayModelInput.value = target.model;
    if (dom.openaiGatewayImageModelInput && target.imageModel && !dom.openaiGatewayImageModelInput.value) {
        dom.openaiGatewayImageModelInput.value = target.imageModel;
    }
    if (dom.openaiGatewayApiKeyInput && !dom.openaiGatewayApiKeyInput.value) {
        dom.openaiGatewayApiKeyInput.placeholder = target.placeholderKey;
    }

    state.geminiAuthMode = 'openaiGateway';
    localStorage.setItem('geminiAuthMode', 'openaiGateway');
    if (dom.geminiAuthModeSelect) dom.geminiAuthModeSelect.value = 'openaiGateway';

    ui.showStatus(`Applied ${preset.toUpperCase()} preset template (${target.model}).`, false, 2000);
}

/**
 * Loads the AI33 API key from local storage.
 */
export function loadAi33ApiKey() {
    const key = localStorage.getItem('ai33ApiKey');
    if (key) {
        state.ai33ApiKey = key;
        dom.ai33ApiKeyInput.value = key;
    }
    ui.updateAi33ApiKeyUiState();
}

/**
 * Saves the AI33 API key to local storage.
 */
export function saveAi33ApiKey() {
    const key = dom.ai33ApiKeyInput.value.trim();
    if (key) {
        state.ai33ApiKey = key;
        localStorage.setItem('ai33ApiKey', key);
        syncAllApiKeysAndSettings();
        ui.showStatus('AI33.pro API key saved.', false, 2000);
        ui.updateAi33ApiKeyUiState();
        ui.updateTimestampHint();
        
        // Refresh voices and models
        fetchAndPopulateVoices();
        fetchAndPopulateElevenLabsModels();
    }
}

/**
 * Clears the AI33 API key from local storage.
 */
export function clearAi33ApiKey() {
    state.ai33ApiKey = null;
    dom.ai33ApiKeyInput.value = '';
    localStorage.removeItem('ai33ApiKey');
    syncAllApiKeysAndSettings();
    ui.showStatus('AI33.pro API key cleared.', false, 2000);
    ui.updateAi33ApiKeyUiState();
    ui.updateTimestampHint();
    fetchAndPopulateVoices(); // Re-sync without this key
}

/**
 * Checks the status of a Gradio server.
 * @param url The base URL of the Gradio app.
 * @returns A promise resolving to the server's status.
 */
async function checkGradioServerStatus(url: string): Promise<{ status: 'online' | 'offline'; message: string }> {
    if (!url || !url.startsWith('http')) {
        return { status: 'offline', message: 'Invalid URL format.' };
    }
    
    const checkUrl = new URL('/config', url).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(checkUrl, {
            method: 'GET',
            signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data && data.version && data.components) {
                 return { status: 'online', message: 'Server is online and responding.' };
            } else {
                 return { status: 'offline', message: 'URL is reachable but not a valid Gradio API.' };
            }
        } else {
            return { status: 'offline', message: `Server responded with status ${response.status}.` };
        }
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return { status: 'offline', message: 'Connection timed out.' };
        }
        return { status: 'offline', message: 'Could not connect. Check CORS or server status.' };
    }
}

function updateGradioStatusBadge(status: 'online' | 'offline' | 'checking' | 'none', message?: string) {
    const badge = dom.gradioTtsStatusBadge;
    if (!badge) return;

    badge.className = 'text-[9px] font-bold px-2 py-0.5 rounded-full border';

    if (status === 'none') {
        badge.classList.add('hidden');
        return;
    }

    badge.classList.remove('hidden');
    badge.title = message || '';

    switch(status) {
        case 'online':
            badge.textContent = 'Online';
            badge.classList.add('bg-green-900/20', 'text-green-400', 'border-green-500/50');
            break;
        case 'offline':
            badge.textContent = 'Offline';
            badge.classList.add('bg-red-900/20', 'text-red-400', 'border-red-500/50');
            break;
        case 'checking':
            badge.textContent = 'Checking...';
            badge.classList.add('bg-yellow-900/20', 'text-yellow-400', 'border-yellow-500/50', 'animate-pulse');
            break;
    }
}

/**
 * Loads the Gradio TTS API URL from local storage and checks its status.
 */
export async function loadGradioTtsApiUrl() {
    const url = localStorage.getItem('gradioTtsApiUrl');
    if (url) {
        state.gradioTtsApiUrl = url;
        dom.gradioTtsApiUrlInput.value = url;
        updateGradioTtsApiUrlUiState();
        updateGradioStatusBadge('checking');
        const status = await checkGradioServerStatus(url);
        updateGradioStatusBadge(status.status, status.message);
    } else {
        updateGradioTtsApiUrlUiState();
        updateGradioStatusBadge('none');
    }
}

/**
 * Saves the Gradio TTS API URL to local storage and checks its status.
 */
export async function saveGradioTtsApiUrl() {
    const url = dom.gradioTtsApiUrlInput.value.trim();
    if (!url) {
        clearGradioTtsApiUrl();
        return;
    }
    
    updateGradioStatusBadge('checking');
    const status = await checkGradioServerStatus(url);

    state.gradioTtsApiUrl = url;
    localStorage.setItem('gradioTtsApiUrl', url);
    syncAllApiKeysAndSettings();
    updateGradioTtsApiUrlUiState();
    updateGradioStatusBadge(status.status, status.message);

    if (status.status === 'online') {
        ui.showStatus('Gradio URL saved. Server is online!', false, 3000);
    } else {
        ui.showStatus(`URL saved, but server appears offline. ${status.message}`, true, 5000);
    }
}

/**
 * Clears the Gradio TTS API URL from local storage.
 */
export function clearGradioTtsApiUrl() {
    state.gradioTtsApiUrl = null;
    dom.gradioTtsApiUrlInput.value = '';
    localStorage.removeItem('gradioTtsApiUrl');
    syncAllApiKeysAndSettings();
    ui.showStatus('Gradio TTS API URL cleared.', false, 2000);
    updateGradioTtsApiUrlUiState();
    updateGradioStatusBadge('none');
}

export function updateGradioTtsApiUrlUiState() {
    const hasUrl = !!dom.gradioTtsApiUrlInput.value.trim();
    dom.saveGradioTtsApiUrlBtn.textContent = hasUrl ? 'Update URL' : 'Save URL';
    dom.clearGradioTtsApiUrlBtn.classList.toggle('hidden', !hasUrl);
}

/**
 * Loads the Stability AI API key from local storage.
 */
export function loadStabilityApiKey() {
    const key = localStorage.getItem('stabilityApiKey');
    if (key) {
        state.stabilityApiKey = key;
        dom.stabilityApiKeyInput.value = key;
    }
    ui.updateStabilityApiKeyUiState();
}

/**
 * Saves the Stability AI API key to local storage.
 */
export function saveStabilityApiKey() {
    const key = dom.stabilityApiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('stabilityApiKey', key);
        state.stabilityApiKey = key;
        syncAllApiKeysAndSettings();
        ui.updateStabilityApiKeyUiState();
        ui.showStatus('Stability AI API key saved.', false, 2000);
    }
}

/**
 * Clears the Stability AI API key from local storage.
 */
export function clearStabilityApiKey() {
    state.stabilityApiKey = null;
    dom.stabilityApiKeyInput.value = '';
    localStorage.removeItem('stabilityApiKey');
    syncAllApiKeysAndSettings();
    ui.showStatus('Stability AI API key cleared.', false, 2000);
    ui.updateStabilityApiKeyUiState();
}

/**
 * Loads the Deepgram API key from local storage.
 */
export function loadDeepgramApiKey() {
    const key = localStorage.getItem('deepgramApiKey');
    if (key) {
        state.deepgramApiKey = key;
        dom.deepgramApiKeyInput.value = key;
    }
    ui.updateDeepgramApiKeyUiState();
}

export function loadWhisperModel() {
    const model = localStorage.getItem('whisperModel');
    if (model && dom.whisperModelSelect) {
        dom.whisperModelSelect.value = model;
    }
}

export async function handleDownloadWhisperModel() {
    if (!dom.whisperModelSelect) return;
    const selectedModel = dom.whisperModelSelect.value;
    
    // Save preference
    localStorage.setItem('whisperModel', selectedModel);
    
    // Call download endpoint
    if (dom.downloadWhisperModelBtn && dom.downloadWhisperText) {
        dom.downloadWhisperModelBtn.disabled = true;
        const originalText = dom.downloadWhisperText.textContent;
        dom.downloadWhisperText.textContent = "Downloading/Loading... (Please wait)";
        
        try {
            const res = await fetch('/api/transcribe/download-model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: selectedModel })
            });
            const data = await res.json();
            if (data.success) {
                ui.showStatus(`Successfully loaded offline model: ${selectedModel}`, false, 3000);
            } else {
                throw new Error(data.error || 'Failed to download model');
            }
        } catch (err: any) {
            ui.showStatus(`Error loading model: ${err.message}`, true, 5000);
        } finally {
            dom.downloadWhisperModelBtn.disabled = false;
            dom.downloadWhisperText.textContent = originalText;
        }
    }
}

/**
 * Saves the Deepgram API key to local storage.
 */
export function saveDeepgramApiKey() {
    const key = dom.deepgramApiKeyInput.value.trim();
    if (key) {
        state.deepgramApiKey = key;
        localStorage.setItem('deepgramApiKey', key);
        state.preferredTranscribeEngine = 'deepgram';
        localStorage.setItem('preferredTranscribeEngine', 'deepgram');
        if (dom.preferredTranscribeEngineSelect) {
            dom.preferredTranscribeEngineSelect.value = 'deepgram';
        }
        syncAllApiKeysAndSettings();
        ui.showStatus('⚡ Deepgram API key saved. Set as primary transcription & alignment engine.', false, 3000);
    }
    ui.updateDeepgramApiKeyUiState();
}

/**
 * Clears the Deepgram API key from local storage.
 */
export function clearDeepgramApiKey() {
    state.deepgramApiKey = null;
    dom.deepgramApiKeyInput.value = '';
    localStorage.removeItem('deepgramApiKey');
    syncAllApiKeysAndSettings();
    ui.showStatus('Deepgram API key cleared.', false, 2000);
    ui.updateDeepgramApiKeyUiState();
}

/**
 * Loads the ElevenLabs API key from local storage.
 */
export function loadElevenlabsApiKey() {
    const key = localStorage.getItem('elevenlabsApiKey');
    if (key) {
        state.elevenlabsApiKey = key;
        dom.elevenlabsApiKeyInput.value = key;
        const savedModel = localStorage.getItem('elevenlabsSelectedModel');
        if (savedModel) {
            state.elevenlabsSelectedModel = savedModel;
        }
        fetchAndPopulateElevenLabsModels();
        fetchAndPopulateVoices();
    }
    ui.updateElevenlabsApiKeyUiState();
}

/**
 * Loads the Pexels API key from local storage.
 */
export function loadPexelsApiKey() {
    const key = localStorage.getItem('pexelsApiKey');
    if (key) {
        state.pexelsApiKey = key;
        dom.pexelsApiKeyInput.value = key;
    }
    ui.updatePexelsApiKeyUiState();
}

/**
 * Saves the Pexels API key to local storage.
 */
export function savePexelsApiKey() {
    const key = dom.pexelsApiKeyInput.value.trim();
    if (key) {
        state.pexelsApiKey = key;
        localStorage.setItem('pexelsApiKey', key);
        syncAllApiKeysAndSettings();
        ui.showStatus('Pexels API key saved.', false, 2000);
    }
    ui.updatePexelsApiKeyUiState();
}

/**
 * Clears the Pexels API key from local storage.
 */
export function clearPexelsApiKey() {
    state.pexelsApiKey = null;
    dom.pexelsApiKeyInput.value = '';
    localStorage.removeItem('pexelsApiKey');
    syncAllApiKeysAndSettings();
    ui.updatePexelsApiKeyUiState();
}

/**
 * Loads the Freesound API key from local storage.
 */
export function loadFreesoundApiKey() {
    const key = localStorage.getItem('freesoundApiKey');
    if (key) {
        state.freesoundApiKey = key;
        dom.freesoundApiKeyInput.value = key;
    }
    ui.updateFreesoundApiKeyUiState();
}

/**
 * Saves the ElevenLabs API key to local storage.
 */
export function saveElevenlabsApiKey() {
    const key = dom.elevenlabsApiKeyInput.value.trim();
    if (key) {
        state.elevenlabsApiKey = key;
        state.elevenlabsModelsFetched = false;
        state.elevenlabsVoicesFetched = false;
        state.elevenlabsModels = [];
        state.elevenlabsVoices = [];
        
        localStorage.setItem('elevenlabsApiKey', key);
        syncAllApiKeysAndSettings();
        ui.showStatus('ElevenLabs API key saved.', false, 2000);
        fetchAndPopulateElevenLabsModels();
        fetchAndPopulateVoices();
        ui.updateTimestampHint();
    }
    ui.updateElevenlabsApiKeyUiState();
}

/**
 * Saves the Freesound API key to local storage.
 */
export function saveFreesoundApiKey() {
    const key = dom.freesoundApiKeyInput.value.trim();
    if (key) {
        state.freesoundApiKey = key;
        localStorage.setItem('freesoundApiKey', key);
        syncAllApiKeysAndSettings();
        ui.showStatus('Freesound API key saved.', false, 2000);
    }
    ui.updateFreesoundApiKeyUiState();
}

/**
 * Clears the ElevenLabs API key from local storage.
 */
export function clearElevenlabsApiKey() {
    state.elevenlabsApiKey = null;
    state.elevenlabsModelsFetched = false;
    state.elevenlabsVoicesFetched = false;
    state.elevenlabsModels = [];
    state.elevenlabsVoices = [];

    dom.elevenlabsApiKeyInput.value = '';
    localStorage.removeItem('elevenlabsApiKey');
    localStorage.removeItem('elevenlabsSelectedModel');
    syncAllApiKeysAndSettings();
    
    fetchAndPopulateVoices();

    if (!state.ai33ApiKey) {
        dom.elevenlabsModelSelect.disabled = true;
        dom.elevenlabsModelSelect.innerHTML = '<option value="">Enter API Key First</option>';
    } else {
        fetchAndPopulateElevenLabsModels();
    }

    ui.showStatus('ElevenLabs API key cleared.', false, 2000);
    ui.updateElevenlabsApiKeyUiState();
    ui.updateTimestampHint();
}

/**
 * Clears the Freesound API key from local storage.
 */
export function clearFreesoundApiKey() {
    state.freesoundApiKey = null;
    dom.freesoundApiKeyInput.value = '';
    localStorage.removeItem('freesoundApiKey');
    syncAllApiKeysAndSettings();
    ui.showStatus('Freesound API key cleared.', false, 2000);
    ui.updateFreesoundApiKeyUiState();
}

/**
 * Handles changes to the ElevenLabs model selection.
 */
export function handleElevenlabsModelChange(event: Event) {
    const selectedModel = (event.target as HTMLSelectElement).value;
    state.elevenlabsSelectedModel = selectedModel;
    localStorage.setItem('elevenlabsSelectedModel', selectedModel);
}

/**
 * Handles the "Select API Key" button click to open the aistudio dialog.
 */
export async function handleSelectApiKey() {
    // @ts-ignore
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        try {
            // @ts-ignore
            await window.aistudio.openSelectKey();
            state.apiKeySelected = true;
            dom.apiKeyModal.classList.add('hidden');
        } catch (e) {
            console.error("Error opening select key dialog:", e);
        }
    }
}

// --- Other Settings Handlers ---

/**
 * Loads the Audio Ducking setting from local storage.
 */
export function loadAudioDuckingSetting() {
    const saved = localStorage.getItem('audioDuckingEnabled');
    state.audioDuckingEnabled = saved !== 'false'; // default true
    if (dom.enableAudioDuckingCheckbox) {
        dom.enableAudioDuckingCheckbox.checked = state.audioDuckingEnabled;
    }
    if (dom.videoExportAudioDuckingCheckbox) {
        dom.videoExportAudioDuckingCheckbox.checked = state.audioDuckingEnabled;
    }
}

/**
 * Handles toggling the Audio Ducking setting.
 */
export function handleAudioDuckingToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.audioDuckingEnabled = checked;
    localStorage.setItem('audioDuckingEnabled', String(checked));
    if (dom.enableAudioDuckingCheckbox) {
        dom.enableAudioDuckingCheckbox.checked = checked;
    }
    if (dom.videoExportAudioDuckingCheckbox) {
        dom.videoExportAudioDuckingCheckbox.checked = checked;
    }
}

/**
 * Loads the Audio Auto-Normalization setting from local storage.
 */
export function loadAudioNormalizeSetting() {
    const saved = localStorage.getItem('autoNormalizeAudio');
    state.autoNormalizeAudio = saved !== 'false'; // default true
    if (dom.enableAudioNormalizeCheckbox) {
        dom.enableAudioNormalizeCheckbox.checked = state.autoNormalizeAudio;
    }
    if (dom.videoExportNormalizeAudioCheckbox) {
        dom.videoExportNormalizeAudioCheckbox.checked = state.autoNormalizeAudio;
    }
}

/**
 * Handles toggling the Audio Auto-Normalization setting.
 */
export function handleAudioNormalizeToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.autoNormalizeAudio = checked;
    localStorage.setItem('autoNormalizeAudio', String(checked));
    if (dom.enableAudioNormalizeCheckbox) {
        dom.enableAudioNormalizeCheckbox.checked = checked;
    }
    if (dom.videoExportNormalizeAudioCheckbox) {
        dom.videoExportNormalizeAudioCheckbox.checked = checked;
    }
}

/**
 * Loads the Text Overlay setting from local storage.
 */
export function loadTextOverlaySetting() {
    const saved = localStorage.getItem('textOverlayEnabled');
    state.textOverlayEnabled = saved === 'true';
    if (dom.enableTextOverlayCheckbox) {
        dom.enableTextOverlayCheckbox.checked = state.textOverlayEnabled;
    }
}

/**
 * Handles toggling the Text Overlay setting.
 */
export function handleTextOverlayToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.textOverlayEnabled = checked;
    localStorage.setItem('textOverlayEnabled', String(checked));
}

/**
 * Synchronizes all Motion Graphics UI toggles across Settings, Storyboard Toolbar, and Graphic Inspector.
 */
export function syncMotionGraphicsUI(enabled: boolean = state.motionGraphicsEnabled) {
    if (dom.enableMotionGraphicsCheckbox) {
        dom.enableMotionGraphicsCheckbox.checked = enabled;
    }
    if (dom.toolbarEnableMotionGraphicsCheckbox) {
        dom.toolbarEnableMotionGraphicsCheckbox.checked = enabled;
    }
    if (dom.geEnableMotionGraphicsCheckbox) {
        dom.geEnableMotionGraphicsCheckbox.checked = enabled;
    }
    const statusBadge = document.getElementById('ge-motion-graphics-status-badge');
    if (statusBadge) {
        if (enabled) {
            statusBadge.textContent = 'Active';
            statusBadge.className = 'px-1.5 py-0.5 text-[10px] font-semibold rounded bg-teal-500/20 text-teal-300 border border-teal-500/30';
        } else {
            statusBadge.textContent = 'Disabled';
            statusBadge.className = 'px-1.5 py-0.5 text-[10px] font-semibold rounded bg-red-500/20 text-red-300 border border-red-500/30';
        }
    }
}

/**
 * Loads the Motion Graphics setting from local storage.
 */
export function loadMotionGraphicsSetting() {
    const saved = localStorage.getItem('motionGraphicsEnabled');
    state.motionGraphicsEnabled = saved !== 'false'; // Default is true
    syncMotionGraphicsUI(state.motionGraphicsEnabled);
}

export function syncOverlayIntensityUI(intensity: string = state.overlayIntensity) {
    document.querySelectorAll('[data-overlay-intensity]').forEach((el) => {
        const btn = el as HTMLElement;
        const isActive = btn.dataset.overlayIntensity === intensity;
        btn.classList.toggle('bg-teal-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-zinc-800', !isActive);
        btn.classList.toggle('text-gray-400', !isActive);
    });
}

export function loadOverlayIntensitySetting() {
    const saved = localStorage.getItem('overlayIntensity');
    state.overlayIntensity = (saved === 'minimal' || saved === 'aggressive') ? saved : 'medium';
    syncOverlayIntensityUI(state.overlayIntensity);
}

export function handleOverlayIntensityChange(intensity: 'minimal' | 'medium' | 'aggressive') {
    state.overlayIntensity = intensity;
    localStorage.setItem('overlayIntensity', intensity);
    syncOverlayIntensityUI(intensity);
}

export function syncAutoOverlaySfxUI(mode: string = state.autoOverlaySfxMode) {
    document.querySelectorAll('[data-overlay-sfx]').forEach((el) => {
        const btn = el as HTMLElement;
        const isActive = btn.dataset.overlaySfx === mode;
        btn.classList.toggle('bg-teal-600', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-zinc-800', !isActive);
        btn.classList.toggle('text-gray-400', !isActive);
    });
}

export function loadAutoOverlaySfxSetting() {
    const saved = localStorage.getItem('autoOverlaySfxMode');
    state.autoOverlaySfxMode = (saved === 'subtle' || saved === 'high-energy') ? saved : 'none';
    syncAutoOverlaySfxUI(state.autoOverlaySfxMode);
}

export function handleAutoOverlaySfxChange(mode: 'none' | 'subtle' | 'high-energy') {
    state.autoOverlaySfxMode = mode;
    localStorage.setItem('autoOverlaySfxMode', mode);
    syncAutoOverlaySfxUI(mode);
}

/**
 * Handles toggling the Motion Graphics setting.
 */
export function handleMotionGraphicsToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.motionGraphicsEnabled = checked;
    localStorage.setItem('motionGraphicsEnabled', String(checked));
    syncMotionGraphicsUI(checked);
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

/**
 * Loads the Safe Rephrase setting from local storage.
 */
export function loadSafeRephraseSetting() {
    const saved = localStorage.getItem('safeRephraseEnabled');
    state.safeRephraseEnabled = saved !== 'false'; 
    dom.enableSafeRephraseCheckbox.checked = state.safeRephraseEnabled;
}

/**
 * Handles toggling the Safe Rephrase setting.
 */
export function handleSafeRephraseToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.safeRephraseEnabled = checked;
    localStorage.setItem('safeRephraseEnabled', String(checked));
}

/**
 * Loads the Right Click setting from local storage.
 */
export function loadRightClickSetting() {
    const saved = localStorage.getItem('rightClickEnabled');
    if (saved !== null) {
        state.rightClickEnabled = saved === 'true';
    } else {
        state.rightClickEnabled = true; // Default to true if not set
    }
    dom.enableRightClickCheckbox.checked = state.rightClickEnabled;
}

/**
 * Handles toggling the Right Click setting.
 */
export function handleRightClickToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.rightClickEnabled = checked;
    localStorage.setItem('rightClickEnabled', String(checked));
}

/**
 * Loads the 2.5D Parallax setting from local storage.
 */
export function loadParallaxSetting() {
    const saved = localStorage.getItem('enableParallaxEffect');
    if (saved !== null) {
        state.enableParallaxEffect = saved === 'true';
    } else {
        state.enableParallaxEffect = true;
    }
    if (dom.enableParallaxCheckbox) {
        dom.enableParallaxCheckbox.checked = state.enableParallaxEffect;
    }

    const savedMode = localStorage.getItem('parallaxMode');
    if (savedMode === 'single_plate' || savedMode === 'multi_layer') {
        state.parallaxMode = savedMode;
    } else {
        state.parallaxMode = 'multi_layer';
    }
    if (dom.parallaxModeSelect) {
        dom.parallaxModeSelect.value = state.parallaxMode;
    }

    const savedDust = localStorage.getItem('parallaxDustParticles');
    if (savedDust !== null) {
        state.parallaxDustParticles = savedDust === 'true';
    } else {
        state.parallaxDustParticles = true;
    }
    if (dom.enableParallaxDustCheckbox) {
        dom.enableParallaxDustCheckbox.checked = state.parallaxDustParticles;
    }

    const savedDof = localStorage.getItem('parallaxDepthBlur');
    if (savedDof !== null) {
        state.parallaxDepthBlur = savedDof === 'true';
    } else {
        state.parallaxDepthBlur = true;
    }
    if (dom.enableParallaxDofCheckbox) {
        dom.enableParallaxDofCheckbox.checked = state.parallaxDepthBlur;
    }

    const subPanel = document.getElementById('parallax-suboptions-panel');
    if (subPanel) {
        subPanel.style.display = state.enableParallaxEffect ? 'block' : 'none';
    }
}

/**
 * Handles toggling the 2.5D Parallax setting.
 */
export function handleParallaxToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.enableParallaxEffect = checked;
    localStorage.setItem('enableParallaxEffect', String(checked));
    
    const subPanel = document.getElementById('parallax-suboptions-panel');
    if (subPanel) {
        subPanel.style.display = checked ? 'block' : 'none';
    }

    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleParallaxModeChange(event: Event) {
    const mode = (event.target as HTMLSelectElement).value as 'multi_layer' | 'single_plate';
    state.parallaxMode = mode;
    localStorage.setItem('parallaxMode', mode);
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleParallaxDustToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.parallaxDustParticles = checked;
    localStorage.setItem('parallaxDustParticles', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleParallaxDofToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.parallaxDepthBlur = checked;
    localStorage.setItem('parallaxDepthBlur', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

/**
 * Loads the Blurred Background Effect setting from local storage.
 */
export function loadBgBlurSetting() {
    const saved = localStorage.getItem('enableBackgroundBlur');
    if (saved !== null) {
        state.enableBackgroundBlur = saved === 'true';
    } else {
        state.enableBackgroundBlur = false;
    }
    if (dom.enableBgBlurCheckbox) {
        dom.enableBgBlurCheckbox.checked = state.enableBackgroundBlur;
    }
    timelineState.setVideoEffects({ enableBackgroundBlur: state.enableBackgroundBlur });
}

/**
 * Handles toggling the Blurred Background Effect setting.
 */
export function handleBgBlurToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.enableBackgroundBlur = checked;
    timelineState.setVideoEffects({ enableBackgroundBlur: checked });
    localStorage.setItem('enableBackgroundBlur', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

/**
 * Loads cinematography settings from local storage and synchronizes DOM.
 */
export function loadCinematographySettings() {
    const savedPreset = localStorage.getItem('cinematographyPreset');
    if (savedPreset) {
        state.cinematographyPreset = savedPreset as any;
    }
    const savedIntensity = localStorage.getItem('cameraMotionIntensity');
    if (savedIntensity !== null) {
        const v = parseFloat(savedIntensity);
        state.cameraMotionIntensity = isNaN(v) ? 1.0 : v;
    }
    const savedHandheld = localStorage.getItem('cameraShakeHandheld');
    if (savedHandheld !== null) {
        state.cameraShakeHandheld = savedHandheld === 'true';
    }
    const savedLetterbox = localStorage.getItem('cinematicLetterbox');
    if (savedLetterbox !== null) {
        state.cinematicLetterbox = savedLetterbox === 'true';
    }
    const savedVignette = localStorage.getItem('cinematicVignette');
    if (savedVignette !== null) {
        state.cinematicVignette = savedVignette === 'true';
    }
    const savedGrid = localStorage.getItem('ruleOfThirdsGuide');
    if (savedGrid !== null) {
        state.ruleOfThirdsGuide = savedGrid === 'true';
    }

    if (dom.cinematographyStylePresetSelect) {
        dom.cinematographyStylePresetSelect.value = state.cinematographyPreset;
    }
    if (dom.cameraMotionIntensitySelect) {
        dom.cameraMotionIntensitySelect.value = String(state.cameraMotionIntensity);
    }
    if (dom.enableCameraHandheldCheckbox) {
        dom.enableCameraHandheldCheckbox.checked = state.cameraShakeHandheld;
    }
    if (dom.enableLetterboxCheckbox) {
        dom.enableLetterboxCheckbox.checked = state.cinematicLetterbox;
    }
    if (dom.enableCinematicVignetteCheckbox) {
        dom.enableCinematicVignetteCheckbox.checked = state.cinematicVignette;
    }
    if (dom.enableCompositionGridCheckbox) {
        dom.enableCompositionGridCheckbox.checked = state.ruleOfThirdsGuide;
    }
    syncEffectsToUI();
}

/**
 * Handles choosing a cinematography directing preset.
 */
export function handleCinematographyPresetChange(event: Event) {
    const preset = (event.target as HTMLSelectElement).value as 'balanced' | 'documentary' | 'trailer' | 'viral' | 'noir';
    state.cinematographyPreset = preset;
    localStorage.setItem('cinematographyPreset', preset);

    if (preset === 'documentary') {
        state.cameraMotionIntensity = 0.5;
        state.cameraShakeHandheld = true;
        state.cinematicVignette = true;
        state.cinematicLetterbox = false;
        if (dom.videoTransitionStyleSelect) {
            dom.videoTransitionStyleSelect.value = 'cross_dissolve';
            timelineState.setVideoTransitionStyle('cross_dissolve');
        }
    } else if (preset === 'trailer') {
        state.cameraMotionIntensity = 2.0;
        state.cameraShakeHandheld = true;
        state.cinematicLetterbox = true;
        state.cinematicVignette = true;
        if (dom.videoTransitionStyleSelect) {
            dom.videoTransitionStyleSelect.value = 'flash';
            timelineState.setVideoTransitionStyle('flash');
        }
    } else if (preset === 'viral') {
        state.cameraMotionIntensity = 1.5;
        state.cameraShakeHandheld = false;
        state.cinematicLetterbox = false;
        state.cinematicVignette = false;
        if (dom.videoTransitionStyleSelect) {
            dom.videoTransitionStyleSelect.value = 'zoom_dissolve';
            timelineState.setVideoTransitionStyle('zoom_dissolve');
        }
    } else if (preset === 'noir') {
        state.cameraMotionIntensity = 0.5;
        state.cameraShakeHandheld = true;
        state.cinematicLetterbox = true;
        state.cinematicVignette = true;
        if (dom.videoTransitionStyleSelect) {
            dom.videoTransitionStyleSelect.value = 'fade_to_black';
            timelineState.setVideoTransitionStyle('fade_to_black');
        }
    } else {
        // Balanced
        state.cameraMotionIntensity = 1.0;
        state.cameraShakeHandheld = false;
        state.cinematicLetterbox = false;
        state.cinematicVignette = false;
        if (dom.videoTransitionStyleSelect) {
            dom.videoTransitionStyleSelect.value = 'narrative_guided';
            timelineState.setVideoTransitionStyle('narrative_guided');
        }
    }

    // Synchronize UI controls
    if (dom.cameraMotionIntensitySelect) dom.cameraMotionIntensitySelect.value = String(state.cameraMotionIntensity);
    if (dom.enableCameraHandheldCheckbox) dom.enableCameraHandheldCheckbox.checked = state.cameraShakeHandheld;
    if (dom.enableLetterboxCheckbox) dom.enableLetterboxCheckbox.checked = state.cinematicLetterbox;
    if (dom.enableCinematicVignetteCheckbox) dom.enableCinematicVignetteCheckbox.checked = state.cinematicVignette;

    localStorage.setItem('cameraMotionIntensity', String(state.cameraMotionIntensity));
    localStorage.setItem('cameraShakeHandheld', String(state.cameraShakeHandheld));
    localStorage.setItem('cinematicLetterbox', String(state.cinematicLetterbox));
    localStorage.setItem('cinematicVignette', String(state.cinematicVignette));

    ui.showStatus(`Cinematography: switched to ${preset.toUpperCase()} style`, false, 2000);
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleCameraMotionIntensityChange(event: Event) {
    const val = parseFloat((event.target as HTMLSelectElement).value) || 1.0;
    state.cameraMotionIntensity = val;
    localStorage.setItem('cameraMotionIntensity', String(val));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleCameraHandheldToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.cameraShakeHandheld = checked;
    localStorage.setItem('cameraShakeHandheld', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleLetterboxToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.cinematicLetterbox = checked;
    localStorage.setItem('cinematicLetterbox', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleCinematicVignetteToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.cinematicVignette = checked;
    localStorage.setItem('cinematicVignette', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleCompositionGridToggle(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    state.ruleOfThirdsGuide = checked;
    localStorage.setItem('ruleOfThirdsGuide', String(checked));
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

/**
 * Loads the Instant Timestamps setting from local storage.
 */
export function loadInstantTimestampSetting() {
    const saved = localStorage.getItem('useInstantTimestamps');
    if (saved !== null) {
        state.useInstantTimestamps = saved === 'true';
    }
    dom.useInstantTimestampsCheckbox.checked = state.useInstantTimestamps;
    ui.updateTimestampHint();
}

/**
 * Handles toggling the Instant Timestamps setting.
 */
export function handleInstantTimestampToggle(event: Event) {
    const checkbox = event.target as HTMLInputElement;
    state.useInstantTimestamps = checkbox.checked;
    localStorage.setItem('useInstantTimestamps', String(checkbox.checked));
    
    ui.updateTimestampHint();
    
    ui.showStatus(
        checkbox.checked 
            ? 'Instant timestamps enabled' 
            : 'Using Gemini alignment for timestamps',
        false, 2000
    );
}

/**
 * Loads the Speech-to-Text & Audio Alignment Engine preference.
 */
export function loadPreferredTranscribeEngineSetting() {
    const saved = localStorage.getItem('preferredTranscribeEngine');
    if (saved && (saved === 'deepgram' || saved === 'whisper' || saved === 'gemini')) {
        state.preferredTranscribeEngine = saved;
    } else {
        state.preferredTranscribeEngine = 'deepgram';
    }
    if (dom.preferredTranscribeEngineSelect) {
        dom.preferredTranscribeEngineSelect.value = state.preferredTranscribeEngine;
    }
    const whisperSubpanel = document.getElementById('whisper-settings-subpanel');
    if (whisperSubpanel) {
        whisperSubpanel.classList.toggle('hidden', state.preferredTranscribeEngine !== 'whisper');
    }
}

/**
 * Handles changes to the Speech-to-Text & Audio Alignment Engine dropdown.
 */
export function handlePreferredTranscribeEngineChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    state.preferredTranscribeEngine = value;
    localStorage.setItem('preferredTranscribeEngine', value);

    const whisperSubpanel = document.getElementById('whisper-settings-subpanel');
    if (whisperSubpanel) {
        whisperSubpanel.classList.toggle('hidden', value !== 'whisper');
    }

    if (value === 'gemini') {
        ui.showStatus('✨ Gemini 3.5 Transcribe selected for audio transcription & alignment', false, 2500);
    } else if (value === 'deepgram') {
        ui.showStatus('⚡ Deepgram Nova-3 selected for audio transcription & alignment', false, 2500);
    } else if (value === 'whisper') {
        ui.showStatus('🎙️ Local Whisper selected for audio transcription', false, 2500);
    }
}

// --- Custom Voice Management (Unified AI33 v3 & Providers) ---

export function normalizeAi33VoiceId(provider: string, rawInput: string): { 
    fullVoiceId: string; 
    detectedProvider: 'elevenlabs' | 'minimax' | 'edge' | 'kokoro' | 'vbee' | 'fishaudio' | 'clone'; 
    rawId: string 
} {
    const trimmed = rawInput.trim();
    if (!trimmed) {
        const prov = (provider || 'elevenlabs').toLowerCase() as any;
        return { fullVoiceId: '', detectedProvider: prov, rawId: '' };
    }

    const knownPrefixes: Array<[string, 'elevenlabs' | 'minimax' | 'edge' | 'kokoro' | 'vbee' | 'fishaudio' | 'clone']> = [
        ['elevenlabs_', 'elevenlabs'],
        ['minimax_', 'minimax'],
        ['edge_', 'edge'],
        ['kokoro_', 'kokoro'],
        ['vbee_', 'vbee'],
        ['fishaudio_', 'fishaudio'],
        ['clone_', 'clone']
    ];

    for (const [prefix, prov] of knownPrefixes) {
        if (trimmed.toLowerCase().startsWith(prefix)) {
            return {
                fullVoiceId: trimmed,
                detectedProvider: prov,
                rawId: trimmed.substring(prefix.length)
            };
        }
    }

    const cleanProvider = (provider || 'elevenlabs').toLowerCase().replace('_', '') as 'elevenlabs' | 'minimax' | 'edge' | 'kokoro' | 'vbee' | 'fishaudio' | 'clone';
    return {
        fullVoiceId: `${cleanProvider}_${trimmed}`,
        detectedProvider: cleanProvider,
        rawId: trimmed
    };
}

export function getProviderBadge(provider: string): { emoji: string; label: string; colorClass: string } {
    switch ((provider || '').toLowerCase()) {
        case 'elevenlabs':
            return { emoji: '🎙️', label: 'ElevenLabs', colorClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40' };
        case 'edge':
            return { emoji: '🌐', label: 'Edge Neural', colorClass: 'bg-blue-950/60 text-blue-300 border-blue-500/40' };
        case 'kokoro':
            return { emoji: '🌸', label: 'Kokoro', colorClass: 'bg-pink-950/60 text-pink-300 border-pink-500/40' };
        case 'minimax':
            return { emoji: '🎭', label: 'Minimax', colorClass: 'bg-purple-950/60 text-purple-300 border-purple-500/40' };
        case 'vbee':
            return { emoji: '🇻🇳', label: 'Vbee', colorClass: 'bg-amber-950/60 text-amber-300 border-amber-500/40' };
        case 'fishaudio':
            return { emoji: '🐟', label: 'Fish Audio', colorClass: 'bg-teal-950/60 text-teal-300 border-teal-500/40' };
        case 'clone':
            return { emoji: '👤', label: 'Clone', colorClass: 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40' };
        default:
            return { emoji: '✨', label: provider || 'Custom', colorClass: 'bg-gray-900 text-gray-300 border-gray-700' };
    }
}

export function renderSavedVoicesInDropdown() {
    if (!dom.narrationVoiceSelect) return;

    // Remove any previously rendered custom groups or duplicates
    dom.narrationVoiceSelect.querySelectorAll('#saved-custom-voices-group, optgroup[label="🌟 Your Saved AI33 Voices (Custom)"], optgroup[label="Custom Voices"]').forEach(el => el.remove());

    if (state.savedCustomVoices.length === 0) {
        return;
    }

    const savedGroup = document.createElement('optgroup');
    savedGroup.label = '🌟 Your Saved & Cloned Voices (Custom)';
    savedGroup.id = 'saved-custom-voices-group';

    const pinnedGroup = dom.narrationVoiceSelect.querySelector('optgroup[label="⭐ Custom & Pinned"]');
    if (pinnedGroup && pinnedGroup.nextSibling) {
        dom.narrationVoiceSelect.insertBefore(savedGroup, pinnedGroup.nextSibling);
    } else {
        dom.narrationVoiceSelect.appendChild(savedGroup);
    }

    // Deduplicate savedCustomVoices by unique voiceId
    const seenIds = new Set<string>();
    state.savedCustomVoices.forEach(v => {
        if (!v.voiceId || seenIds.has(v.voiceId)) return;
        seenIds.add(v.voiceId);

        const opt = document.createElement('option');
        opt.value = v.voiceId;
        const badge = getProviderBadge(v.provider);
        opt.textContent = `${badge.emoji} [${badge.label}] ${v.name}`;
        opt.dataset.provider = 'ai33';
        savedGroup.appendChild(opt);
    });
}

export function renderStudioSavedVoicesList() {
    if (!dom.studioSavedVoicesList) return;

    if (dom.studioSavedVoicesCount) {
        dom.studioSavedVoicesCount.textContent = `${state.savedCustomVoices.length} saved`;
    }

    if (state.savedCustomVoices.length === 0) {
        dom.studioSavedVoicesList.innerHTML = `
            <div class="text-center py-6 text-gray-500 text-xs border border-dashed border-white/10 rounded-xl">
                No custom voices saved yet. Add one above by selecting provider and Voice ID!
            </div>
        `;
        return;
    }

    dom.studioSavedVoicesList.innerHTML = state.savedCustomVoices.map(v => {
        const badge = getProviderBadge(v.provider);
        return `
            <div class="flex items-center justify-between p-3 bg-black/60 border border-white/10 rounded-xl hover:border-white/20 transition group" data-voice-id="${v.voiceId}">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-bold border ${badge.colorClass} flex items-center gap-1 shrink-0">
                        <span>${badge.emoji}</span> ${badge.label}
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="text-xs font-bold text-white truncate">${v.name}</div>
                        <div class="text-[10px] font-mono text-gray-500 truncate" title="${v.voiceId}">${v.voiceId}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0 ml-3">
                    <button class="use-custom-voice-btn px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition" data-voice-id="${v.voiceId}">
                        Use
                    </button>
                    <button class="delete-custom-voice-btn p-1 text-gray-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition" title="Delete voice" data-voice-id="${v.voiceId}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Attach click handlers
    dom.studioSavedVoicesList.querySelectorAll('.use-custom-voice-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const vid = (e.currentTarget as HTMLElement).getAttribute('data-voice-id');
            if (vid) {
                dom.narrationVoiceSelect.value = vid;
                import('./videoController').then(m => m.handleVoiceSelectionChange());
                handleCustomVoiceUIVisibility();
                ui.showStatus(`Selected custom voice: ${vid}`, false, 2500);
                import('./audioPipeline').then(m => m.handleCloseCloningModal());
            }
        });
    });

    dom.studioSavedVoicesList.querySelectorAll('.delete-custom-voice-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const vid = (e.currentTarget as HTMLElement).getAttribute('data-voice-id');
            if (vid) {
                removeCustomVoiceById(vid);
            }
        });
    });
}

function generateVoiceId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : 'v_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

export function saveCustomVoice(provider: string, rawVoiceId: string, customName?: string): SavedCustomVoice | null {
    if (!rawVoiceId || !rawVoiceId.trim()) {
        ui.showStatus('Please enter a voice ID', true, 2000);
        return null;
    }

    const norm = normalizeAi33VoiceId(provider, rawVoiceId);
    if (!norm.rawId) {
        ui.showStatus('Invalid voice ID', true, 2000);
        return null;
    }

    const displayName = (customName && customName.trim()) 
        ? customName.trim() 
        : `${norm.detectedProvider.toUpperCase()} Voice (${norm.rawId.substring(0, 12)})`;

    // Check if already exists
    const existingIndex = state.savedCustomVoices.findIndex(v => v.voiceId === norm.fullVoiceId);
    if (existingIndex >= 0) {
        state.savedCustomVoices[existingIndex].name = displayName;
        state.savedCustomVoices[existingIndex].provider = norm.detectedProvider;
    } else {
        const newVoice: SavedCustomVoice = {
            id: generateVoiceId(),
            name: displayName,
            provider: norm.detectedProvider,
            voiceId: norm.fullVoiceId,
            rawVoiceId: norm.rawId,
            createdAt: Date.now()
        };
        state.savedCustomVoices.push(newVoice);
    }

    // Keep state.customVoiceIds in sync for backward compatibility
    state.customVoiceIds = state.savedCustomVoices.map(v => v.voiceId);

    // Persist
    localStorage.setItem('savedCustomVoices', JSON.stringify(state.savedCustomVoices));
    localStorage.setItem('customVoiceIds', JSON.stringify(state.customVoiceIds));
    saveVersion(false);

    // Refresh UI
    renderSavedVoicesInDropdown();
    renderStudioSavedVoicesList();

    // Select in dropdown
    dom.narrationVoiceSelect.value = norm.fullVoiceId;
    import('./videoController').then(m => m.handleVoiceSelectionChange());
    handleCustomVoiceUIVisibility();

    ui.showStatus(`✅ Saved custom voice "${displayName}" (${norm.fullVoiceId})`, false, 3000);
    return state.savedCustomVoices.find(v => v.voiceId === norm.fullVoiceId) || null;
}

export function removeCustomVoiceById(voiceId: string) {
    if (!voiceId) return;

    state.savedCustomVoices = state.savedCustomVoices.filter(v => v.voiceId !== voiceId && v.id !== voiceId && v.rawVoiceId !== voiceId);
    state.customVoiceIds = state.savedCustomVoices.map(v => v.voiceId);

    localStorage.setItem('savedCustomVoices', JSON.stringify(state.savedCustomVoices));
    localStorage.setItem('customVoiceIds', JSON.stringify(state.customVoiceIds));

    renderSavedVoicesInDropdown();
    renderStudioSavedVoicesList();

    if (dom.narrationVoiceSelect.value === voiceId) {
        dom.narrationVoiceSelect.selectedIndex = 0;
        import('./videoController').then(m => m.handleVoiceSelectionChange());
    }

    handleCustomVoiceUIVisibility();
    ui.showStatus(`Removed custom voice: ${voiceId}`, false, 2500);
    saveVersion(false);
}

/**
 * Loads custom voices from local storage and adds them to the narration dropdown and studio list.
 */
export function loadCustomVoices() {
    try {
        const rawSaved = localStorage.getItem('savedCustomVoices');
        if (rawSaved) {
            const parsed = JSON.parse(rawSaved) as SavedCustomVoice[];
            if (Array.isArray(parsed) && parsed.length > 0) {
                state.savedCustomVoices = parsed;
                state.customVoiceIds = parsed.map(v => v.voiceId);
            }
        } else {
            // Legacy migration from customVoiceIds
            const legacyIds = JSON.parse(localStorage.getItem('customVoiceIds') || '[]') as string[];
            if (Array.isArray(legacyIds) && legacyIds.length > 0) {
                state.savedCustomVoices = legacyIds.map(raw => {
                    const norm = normalizeAi33VoiceId('elevenlabs', raw);
                    return {
                        id: generateVoiceId(),
                        name: `${norm.detectedProvider.toUpperCase()} (${norm.rawId.substring(0, 10)})`,
                        provider: norm.detectedProvider,
                        voiceId: norm.fullVoiceId,
                        rawVoiceId: norm.rawId,
                        createdAt: Date.now()
                    };
                });
                state.customVoiceIds = state.savedCustomVoices.map(v => v.voiceId);
                localStorage.setItem('savedCustomVoices', JSON.stringify(state.savedCustomVoices));
            }
        }
    } catch (e) {
        console.error('Failed to load custom voices:', e);
    }

    renderSavedVoicesInDropdown();
    renderStudioSavedVoicesList();
    handleCustomVoiceUIVisibility();
}

/**
 * Shows or hides the "Remove Custom Voice" button based on the current selection.
 */
export function handleCustomVoiceUIVisibility() {
    if (!dom.removeCustomVoiceBtn || !dom.narrationVoiceSelect) return;
    const selectedValue = dom.narrationVoiceSelect.value;
    const isCustom = state.savedCustomVoices.some(v => v.voiceId === selectedValue) || 
                     state.customVoiceIds.includes(selectedValue) || 
                     selectedValue.startsWith('clone_');
    if (isCustom) {
        dom.removeCustomVoiceBtn.classList.remove('hidden');
    } else {
        dom.removeCustomVoiceBtn.classList.add('hidden');
    }
}

/**
 * Removes a selected custom voice from the dropdown and local storage.
 */
export function handleRemoveCustomVoice() {
    const selectedValue = dom.narrationVoiceSelect.value;
    removeCustomVoiceById(selectedValue);
}

/**
 * Updates the live prefix preview and auto-detects provider in the Quick Manual Voice ID panel.
 */
export function updateManualVoicePreview() {
    if (!dom.manualVoiceIdInput || !dom.manualVoiceProviderSelect) return;
    let provider = dom.manualVoiceProviderSelect.value || 'elevenlabs';
    const inputVal = dom.manualVoiceIdInput.value.trim();

    // Auto-detect provider if user pasted a prefixed string (e.g. edge_vi-VN-...)
    const detected = detectProviderFromId(inputVal);
    if (detected && detected !== provider) {
        provider = detected;
        dom.manualVoiceProviderSelect.value = provider;
        selectManualProviderPill(provider, false);
    }

    const norm = normalizeAi33VoiceId(provider, inputVal || 'your_voice_id');
    if (dom.manualVoicePreviewText) {
        dom.manualVoicePreviewText.textContent = norm.fullVoiceId;
    }
}

/**
 * Updates the live prefix preview and auto-detects provider in the Voice Studio modal.
 */
export function updateStudioVoicePreview() {
    if (!dom.studioVoiceIdInput || !dom.studioVoiceProviderSelect) return;
    let provider = dom.studioVoiceProviderSelect.value || 'elevenlabs';
    const inputVal = dom.studioVoiceIdInput.value.trim();

    // Auto-detect provider if user pasted a prefixed string
    const detected = detectProviderFromId(inputVal);
    if (detected && detected !== provider) {
        provider = detected;
        dom.studioVoiceProviderSelect.value = provider;
        selectStudioProviderPill(provider, false);
    }

    const norm = normalizeAi33VoiceId(provider, inputVal || 'your_voice_id');
    if (dom.studioVoicePreviewText) {
        dom.studioVoicePreviewText.textContent = norm.fullVoiceId;
    }
}

/**
 * Detects if a voice ID already starts with a recognized AI33 provider prefix.
 */
function detectProviderFromId(id: string): string | null {
    if (!id) return null;
    const lower = id.toLowerCase();
    const providers = ['elevenlabs', 'edge', 'kokoro', 'minimax', 'vbee', 'fishaudio', 'clone'];
    for (const p of providers) {
        if (lower.startsWith(`${p}_`)) return p;
    }
    return null;
}

/**
 * Visually highlights the selected provider pill in the quick manual panel.
 */
export function selectManualProviderPill(provider: string, updateSelect = true) {
    if (updateSelect && dom.manualVoiceProviderSelect) {
        dom.manualVoiceProviderSelect.value = provider;
    }
    if (dom.manualProviderPills) {
        dom.manualProviderPills.querySelectorAll('.provider-pill-item').forEach(btn => {
            const p = btn.getAttribute('data-provider');
            if (p === provider) {
                btn.className = 'provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-indigo-600 text-white border-indigo-400 cursor-pointer shadow-sm flex items-center gap-0.5 overflow-hidden';
            } else {
                btn.className = 'provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden';
            }
        });
    }
    updateManualVoicePreview();
}

/**
 * Visually highlights the selected provider pill in the Voice Studio modal.
 */
export function selectStudioProviderPill(provider: string, updateSelect = true) {
    if (updateSelect && dom.studioVoiceProviderSelect) {
        dom.studioVoiceProviderSelect.value = provider;
    }
    if (dom.studioProviderPills) {
        dom.studioProviderPills.querySelectorAll('.studio-provider-pill').forEach(btn => {
            const p = btn.getAttribute('data-provider');
            if (p === provider) {
                btn.className = 'studio-provider-pill active px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-indigo-600 text-white border-indigo-400 cursor-pointer flex items-center gap-1.5 shadow-sm';
            } else {
                btn.className = 'studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5';
            }
        });
    }
    updateStudioVoicePreview();
}

/**
 * Handles toggling the manual Voice ID input panel.
 */
export function handleToggleManualVoiceId() {
    if (!dom.manualVoiceIdPanel) return;
    const isHidden = dom.manualVoiceIdPanel.classList.contains('hidden');
    dom.manualVoiceIdPanel.classList.toggle('hidden', !isHidden);
    if (isHidden) {
        updateManualVoicePreview();
        if (dom.manualVoiceIdInput) dom.manualVoiceIdInput.focus();
    }
}

/**
 * Closes the quick manual Voice ID panel.
 */
export function handleCloseManualVoiceId() {
    if (dom.manualVoiceIdPanel) {
        dom.manualVoiceIdPanel.classList.add('hidden');
    }
}

/**
 * Validates a manual voice ID from sidebar quick panel, adds it to state/localStorage, and updates UI.
 */
export async function handleAddManualVoiceId() {
    const provider = dom.manualVoiceProviderSelect?.value || 'elevenlabs';
    const rawVoiceId = dom.manualVoiceIdInput?.value?.trim() || '';
    const name = dom.manualVoiceNameInput?.value?.trim() || '';

    const saved = saveCustomVoice(provider, rawVoiceId, name);
    if (saved) {
        if (dom.manualVoiceIdInput) dom.manualVoiceIdInput.value = '';
        if (dom.manualVoiceNameInput) dom.manualVoiceNameInput.value = '';
        handleCloseManualVoiceId();
    }
}

/**
 * Handles saving a custom voice from the Voice Studio modal.
 */
export function handleStudioSaveVoice() {
    const provider = dom.studioVoiceProviderSelect?.value || 'elevenlabs';
    const rawVoiceId = dom.studioVoiceIdInput?.value?.trim() || '';
    const name = dom.studioVoiceNameInput?.value?.trim() || '';

    const saved = saveCustomVoice(provider, rawVoiceId, name);
    if (saved) {
        if (dom.studioVoiceIdInput) dom.studioVoiceIdInput.value = '';
        if (dom.studioVoiceNameInput) dom.studioVoiceNameInput.value = '';
    }
}

/**
 * Switches between "Generate Audio", "Custom Voice IDs" and "Audio Sample Clone" tabs in the Voice Studio modal.
 */
export function switchVoiceStudioTab(tab: 'generate' | 'custom' | 'clone') {
    const defaultTabClass = "px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-xl border-b-2 border-transparent text-gray-400 hover:text-white hover:bg-white/5 transition flex items-center gap-2 cursor-pointer";
    const activeTabClass = "px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-xl border-b-2 border-indigo-500 text-white bg-white/10 transition flex items-center gap-2 cursor-pointer";

    if (dom.voiceStudioTabGenerate) dom.voiceStudioTabGenerate.className = defaultTabClass;
    if (dom.voiceStudioTabCustom) dom.voiceStudioTabCustom.className = defaultTabClass;
    if (dom.voiceStudioTabClone) dom.voiceStudioTabClone.className = defaultTabClass;

    dom.voiceStudioPanelGenerate?.classList.add('hidden');
    dom.voiceStudioPanelCustom?.classList.add('hidden');
    dom.voiceStudioPanelClone?.classList.add('hidden');

    if (tab === 'generate') {
        if (dom.voiceStudioTabGenerate) dom.voiceStudioTabGenerate.className = activeTabClass;
        dom.voiceStudioPanelGenerate?.classList.remove('hidden');
    } else if (tab === 'custom') {
        if (dom.voiceStudioTabCustom) dom.voiceStudioTabCustom.className = activeTabClass;
        dom.voiceStudioPanelCustom?.classList.remove('hidden');
        renderStudioSavedVoicesList();
        updateStudioVoicePreview();
    } else if (tab === 'clone') {
        if (dom.voiceStudioTabClone) dom.voiceStudioTabClone.className = activeTabClass;
        dom.voiceStudioPanelClone?.classList.remove('hidden');
    }
}

/**
 * Initializes provider pills listeners and input listeners.
 */
export function initVoiceProviderPillsAndListeners() {
    // Quick panel provider pills
    if (dom.manualProviderPills) {
        dom.manualProviderPills.querySelectorAll('.provider-pill-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const p = target.getAttribute('data-provider');
                if (p) selectManualProviderPill(p, true);
            });
        });
    }

    if (dom.manualVoiceProviderSelect) {
        dom.manualVoiceProviderSelect.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            selectManualProviderPill(val, false);
        });
    }

    if (dom.manualVoiceIdInput) {
        dom.manualVoiceIdInput.addEventListener('input', updateManualVoicePreview);
    }

    if (dom.closeManualVoiceIdBtn) {
        dom.closeManualVoiceIdBtn.addEventListener('click', handleCloseManualVoiceId);
    }

    // Studio modal provider pills
    if (dom.studioProviderPills) {
        dom.studioProviderPills.querySelectorAll('.studio-provider-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const p = target.getAttribute('data-provider');
                if (p) selectStudioProviderPill(p, true);
            });
        });
    }

    if (dom.studioVoiceProviderSelect) {
        dom.studioVoiceProviderSelect.addEventListener('change', (e) => {
            const val = (e.target as HTMLSelectElement).value;
            selectStudioProviderPill(val, false);
        });
    }

    if (dom.studioVoiceIdInput) {
        dom.studioVoiceIdInput.addEventListener('input', updateStudioVoicePreview);
    }
}


export function loadGraphicsThemeSettings() {
    const theme = localStorage.getItem('graphicsTheme');
    if (theme) state.graphicsTheme = theme;
    const accent = localStorage.getItem('graphicsAccentColor');
    if (accent) state.graphicsAccentColor = accent;

    const themeSelect = document.getElementById('graphics-theme-select') as HTMLSelectElement;
    if (themeSelect) themeSelect.value = state.graphicsTheme;
    const colorInput = document.getElementById('graphics-accent-color') as HTMLInputElement;
    if (colorInput) colorInput.value = state.graphicsAccentColor;
}

export function handleGraphicsThemeChange(event: Event) {
    const target = event.target as HTMLSelectElement | HTMLInputElement;
    if (target.id === 'graphics-theme-select') {
        state.graphicsTheme = target.value;
        localStorage.setItem('graphicsTheme', target.value);
    } else if (target.id === 'graphics-accent-color') {
        state.graphicsAccentColor = target.value;
        localStorage.setItem('graphicsAccentColor', target.value);
    }
    
    // Rerender video if paused
    import('./state-timeline').then(({ timelineState }) => {
        if (timelineState.videoGenerated) {
            import('./videoRenderer').then(({ drawVideoFrame }) => {
                drawVideoFrame(state.videoPauseTime || 0);
            });
        }
    });
}

registerRestoreApiKeysFromCloudOrDB(restoreApiKeysFromCloudOrDB);
