/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, GenerateContentResponse, Type, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { state } from '../state';
import { PRIMARY_MODEL, SECONDARY_MODEL, TERTIARY_MODEL, TRANSCRIBE_MODEL, CREDIT_COSTS } from "../constants";
import { syncUserCredits, spendCreditsSecure } from '../authBridge';

export interface EffectiveGeminiAuth {
    mode: 'apiKey' | 'webCookie' | 'adc' | 'openaiGateway';
    provider?: 'aistudio' | 'vertex';
    vertexAuthMode?: 'apiKey' | 'adc';
    vertexProjectId?: string;
    vertexLocation?: string;
    apiKey?: string;
    cookies?: {
        '__Secure-1PSID': string;
        '__Secure-1PSIDTS'?: string;
        '__Secure-1PSIDCC'?: string;
        'COMPASS'?: string;
        'SID'?: string;
        'HSID'?: string;
        'SSID'?: string;
        [key: string]: string | undefined;
    };
    openaiGatewayBaseUrl?: string;
    openaiGatewayApiKey?: string;
    openaiGatewayModel?: string;
    openaiGatewayImageModel?: string;
    isPersonal: boolean;
}

/**
 * Strips markdown code fences from a string.
 * Note: Keep synchronized with server copy in server/_core/geminiCookieProxy.ts
 */
export function stripCodeFence(text: string): string {
    if (!text) return "";
    const lines = text.split("\n");
    const open = lines.findIndex(l => /^\s*```[a-zA-Z]*\s*$/.test(l));
    if (open === -1) return text.trim();

    let close = -1;
    for (let i = lines.length - 1; i > open; i--) {
        if (/^\s*```\s*$/.test(lines[i])) { close = i; break; }
    }
    return lines.slice(open + 1, close === -1 ? undefined : close).join("\n").trim();
}

/**
 * Strips Gemini thinking control tokens (<ctrl94>thought ... <ctrl95>)
 */
export function extractThinkingAndText(raw: string): { thinking: string; text: string } {
    if (!raw) return { thinking: "", text: "" };

    // Support standard <thought>...</thought> tags (Gemini reasoning) and <think>...</think> (DeepSeek R1)
    const thoughtRegex = /<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/i;
    const thoughtMatch = raw.match(thoughtRegex);
    if (thoughtMatch) {
        const thinking = thoughtMatch[1].trim();
        const text = raw.replace(thoughtRegex, "").trim();
        return { thinking, text };
    }

    // Handle unclosed <thought> or <think> tags if output was cut off or in progress
    const unclosedMatch = raw.match(/^<(?:think|thought)>([\s\S]*)/i);
    if (unclosedMatch && !raw.includes("</thought>") && !raw.includes("</think>")) {
        return { thinking: unclosedMatch[1].trim(), text: "" };
    }

    const startMarkers = ["<ctrl94>thought", "<ctrl94>"];
    let startIdx = -1;
    let startLen = 0;

    for (const marker of startMarkers) {
        const idx = raw.indexOf(marker);
        if (idx !== -1) {
            startIdx = idx;
            startLen = marker.length;
            break;
        }
    }

    if (startIdx === -1) {
        return { thinking: "", text: raw };
    }

    const endMarker = "<ctrl95>";
    const rest = raw.slice(startIdx + startLen);
    const endOffset = rest.indexOf(endMarker);

    if (endOffset === -1) {
        const thinking = rest.trim();
        const textBefore = raw.slice(0, startIdx).trim();
        return { thinking, text: textBefore };
    }

    const endIdx = startIdx + startLen + endOffset;
    const thinking = raw.slice(startIdx + startLen, endIdx).trim();
    const textBefore = raw.slice(0, startIdx);
    const textAfter = raw.slice(endIdx + endMarker.length);
    const cleanText = (textBefore + textAfter).trim();

    return { thinking, text: cleanText };
}

export function getEffectiveGeminiAuth(): EffectiveGeminiAuth {
    const priv = state.privateSystemConfig;

    // 0. Check OpenAI-Compatible Gateway mode
    if (state.geminiAuthMode === 'openaiGateway') {
        return {
            mode: 'openaiGateway',
            openaiGatewayBaseUrl: state.openaiGatewayBaseUrl || priv?.systemOpenaiBaseUrl || 'https://api.openai.com/v1',
            openaiGatewayApiKey: state.openaiGatewayApiKey || priv?.systemOpenaiApiKey || undefined,
            openaiGatewayModel: state.openaiGatewayModel || priv?.systemOpenaiModel || 'gpt-4o',
            openaiGatewayImageModel: state.openaiGatewayImageModel || priv?.systemOpenaiImageModel || 'dall-e-3',
            isPersonal: !!state.openaiGatewayApiKey
        };
    }

    // 1. Check user personal auth
    if (state.geminiProvider === 'vertex' && state.vertexAuthMode === 'adc') {
        return {
            mode: 'adc',
            provider: 'vertex',
            vertexAuthMode: 'adc',
            vertexProjectId: state.vertexProjectId || undefined,
            vertexLocation: state.vertexLocation || 'us-central1',
            isPersonal: true
        };
    }

    if (state.geminiAuthMode === 'apiKey' && state.userGeminiApiKey) {
        return {
            mode: 'apiKey',
            provider: state.geminiProvider,
            vertexAuthMode: state.vertexAuthMode || 'apiKey',
            vertexProjectId: state.vertexProjectId || undefined,
            vertexLocation: state.vertexLocation || undefined,
            apiKey: state.userGeminiApiKey,
            isPersonal: true
        };
    }

    // 2. Check user personal Web Cookie
    const userPsid = state.geminiPsid;
    if (state.geminiAuthMode === 'webCookie' && userPsid) {
        return {
            mode: 'webCookie',
            cookies: {
                '__Secure-1PSID': userPsid,
                '__Secure-1PSIDTS': state.geminiPsidts || '',
                '__Secure-1PSIDCC': state.geminiPsidcc || '',
                'COMPASS': state.geminiCompass || '',
                'SID': state.geminiSid || '',
                'HSID': state.geminiHsid || '',
                'SSID': state.geminiSsid || ''
            },
            isPersonal: true
        };
    }

    // 3. System-wide fallback configuration from privateSystemConfig
    if (priv) {
        if (priv.systemGeminiAuthMode === 'openaiGateway' && priv.systemOpenaiApiKey) {
            return {
                mode: 'openaiGateway',
                openaiGatewayBaseUrl: priv.systemOpenaiBaseUrl || 'https://api.openai.com/v1',
                openaiGatewayApiKey: priv.systemOpenaiApiKey,
                openaiGatewayModel: priv.systemOpenaiModel || 'gpt-4o',
                openaiGatewayImageModel: priv.systemOpenaiImageModel || 'dall-e-3',
                isPersonal: false
            };
        }
        if (priv.systemGeminiAuthMode === 'webCookie' && priv.systemGeminiPsid) {
            return {
                mode: 'webCookie',
                cookies: {
                    '__Secure-1PSID': priv.systemGeminiPsid,
                    '__Secure-1PSIDTS': priv.systemGeminiPsidts || '',
                    '__Secure-1PSIDCC': priv.systemGeminiPsidcc || '',
                    'COMPASS': priv.systemGeminiCompass || '',
                    'SID': priv.systemGeminiSid || '',
                    'HSID': priv.systemGeminiHsid || '',
                    'SSID': priv.systemGeminiSsid || ''
                },
                isPersonal: false
            };
        }
        if (priv.systemGeminiProvider === 'vertex' && priv.systemVertexAuthMode === 'adc') {
            return {
                mode: 'adc',
                provider: 'vertex',
                vertexAuthMode: 'adc',
                vertexProjectId: priv.systemVertexProjectId || undefined,
                vertexLocation: priv.systemVertexLocation || 'us-central1',
                isPersonal: false
            };
        }
        if (priv.systemGeminiApiKey) {
            return {
                mode: 'apiKey',
                provider: priv.systemGeminiProvider || 'aistudio',
                vertexAuthMode: priv.systemVertexAuthMode || 'apiKey',
                vertexProjectId: priv.systemVertexProjectId || undefined,
                vertexLocation: priv.systemVertexLocation || 'us-central1',
                apiKey: priv.systemGeminiApiKey,
                isPersonal: false
            };
        }
    }

    // Built-in / Server key or environment fallback
    if (state.geminiAuthMode === 'builtin' && (state as any).serverApiKey) {
        return { mode: 'apiKey', apiKey: (state as any).serverApiKey, isPersonal: false };
    }

    return { mode: 'apiKey', apiKey: process.env.API_KEY || 'dummy_key_for_proxy_mode', isPersonal: false };
}

function isFreeOperation(operationType: 'text' | 'image' | 'audio' | 'video'): boolean {
    const auth = getEffectiveGeminiAuth();
    if (auth.isPersonal) {
        return true; // BYOK / personal key operations are free (no platform COGS)
    }
    return false;
}

// Non-blocking pre-flight read — does NOT guarantee credits will still be
// available when deductCredits runs. Use only for early UI feedback.
export async function checkCredits(estimatedAmount: number = 1, operationType: 'text' | 'image' | 'audio' | 'video' = 'text'): Promise<boolean> {
    if (isFreeOperation(operationType)) return true;

    if ((state.userCredits || 0) < estimatedAmount) {
        throw new Error("Insufficient credits. Please add more credits.");
    }
    return true;
}

// Atomically checks and deducts credits,
// preventing overdraft from concurrent requests.
export async function deductCredits(amount: number, operationType: 'text' | 'image' | 'audio' | 'video' = 'text'): Promise<boolean> {
    if (isFreeOperation(operationType)) return true;

    // BYOK discount logic: personal keys/adc get charged ~10% for using the platform
    const auth = getEffectiveGeminiAuth();
    const cost = auth.isPersonal ? Math.ceil(amount * 0.1) : amount;

    await spendCreditsSecure(cost, `${operationType}_operation`);
    return true;
}

const circuitBreaker = {
    failures: new Map<string, number>(),
    lastFailure: new Map<string, number>(),

    isOpen(service: string): boolean {
        const failures = this.failures.get(service) || 0;
        const lastFail = this.lastFailure.get(service) || 0;
        const timeSince = Date.now() - lastFail;

        if (failures >= 5 && timeSince < 120000) {
            return true;
        }

        if (timeSince > 120000) {
            this.failures.set(service, 0);
        }

        return false;
    },

    recordFailure(service: string): void {
        this.failures.set(service, (this.failures.get(service) || 0) + 1);
        this.lastFailure.set(service, Date.now());
    },

    recordSuccess(service: string): void {
        this.failures.set(service, 0);
    }
};

function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export function getApiKey(): string {
    const auth = getEffectiveGeminiAuth();
    return auth.apiKey || process.env.API_KEY || 'dummy_key_for_cookie_mode';
}

export function isUsingPersonalKey(forImageGeneration: boolean = false): boolean {
    const auth = getEffectiveGeminiAuth();
    return auth.isPersonal;
}

/**
 * Instantiates a GoogleGenAI client configured for AI Studio or Vertex AI
 */
export function createGoogleGenAIClient(apiKeyOverride?: string): GoogleGenAI {
    const auth = getEffectiveGeminiAuth();
    const apiKey = apiKeyOverride || auth.apiKey || getApiKey();
    if (!apiKey && !(auth.provider === 'vertex' && auth.vertexAuthMode === 'adc')) {
        throw new Error('No Gemini API key available.');
    }

    // If configured to use Vertex AI
    if (auth.provider === 'vertex' && auth.vertexProjectId) {
        return new GoogleGenAI({
            apiKey: auth.apiKey || 'dummy_key_for_vertex_mode',
            httpOptions: {
                baseUrl: `${window.location.origin}/api/genai`,
                headers: {
                    'x-vertex-project': auth.vertexProjectId,
                    'x-vertex-location': auth.vertexLocation || 'us-central1',
                    ...(auth.apiKey ? { 'x-goog-api-key': auth.apiKey } : {})
                }
            }
        });
    }

    // Standard Google AI Studio
    const isProxyMode = apiKey === 'dummy_key_for_cookie_mode' || (!auth.isPersonal && auth.mode === 'apiKey');
    return new GoogleGenAI({ 
        apiKey: isProxyMode ? 'dummy_key_for_proxy_mode' : (apiKey || 'dummy_key_for_proxy_mode'),
        httpOptions: {
            baseUrl: `${window.location.origin}/api/genai`,
            headers: (!isProxyMode && apiKey) ? { 'x-goog-api-key': apiKey } : undefined
        }
    });
}

export async function callGeminiWithRetries(
    apiCall: () => Promise<any>,
    maxRetries = 5,
    signal?: AbortSignal,
    model?: string,
    requestId?: string
): Promise<any> {
    let delay = 1000;

    for (let i = 0; i < maxRetries; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            const result = await apiCall();

            // Check for prompt-level blocking
            if (result?.promptFeedback?.blockReason) {
                 const reason = result.promptFeedback.blockReason;
                 const safetyError = new Error(`Blocked by API policy: ${reason}.`);
                 safetyError.name = 'SafetyError';
                 throw safetyError;
            }

            // Check for empty response
            const text = result.text?.trim();
            if (!text) {
                const finishReason = result.candidates?.[0]?.finishReason;
                if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'BLOCKLIST' || finishReason === 'SPII' || finishReason === 'OTHER') {
                    const safetyError = new Error(`AI generation blocked by safety filters (${finishReason}).`);
                    safetyError.name = 'SafetyError';
                    throw safetyError;
                }
                if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
                    console.error("Empty response. Finish reason:", finishReason);
                    throw new Error(`AI generation blocked or empty. Reason: ${finishReason}`);
                }
                throw new Error("The AI returned an empty response.");
            }

            return result;
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            console.error(`🔄 Attempt ${i + 1}/${maxRetries} failed:`, errorMessage);

            const isConstraintError = /constraint.*too.*tall|constraint.*size|constraint-is-too-big/i.test(errorMessage);
            if (isConstraintError) {
                const constraintError = new Error(errorMessage);
                constraintError.name = 'ConstraintSizeError';
                throw constraintError;
            }

            const isDevInstructionError = /developer instruction is not enabled/i.test(errorMessage);
            if (isDevInstructionError) {
                const devError = new Error(errorMessage);
                devError.name = 'DeveloperInstructionError';
                throw devError;
            }

            const isPrepaymentDepleted = /prepayment.*depleted|credits are depleted|billing#prepay|prepay/i.test(errorMessage);
            if (isPrepaymentDepleted) {
                const prepayMsg = 'Your Google AI Studio prepayment credits are depleted. Please visit https://ai.studio/projects to manage billing or add funds, or provide another Gemini API key in Settings.';
                console.error(`💳 [Gemini Billing Error]: ${prepayMsg}`);
                try {
                    import('../ui').then(ui => {
                        if (typeof ui.showStatus === 'function') {
                            ui.showStatus(prepayMsg, true, 12000, {
                                label: '⚙️ Settings',
                                onClick: () => {
                                    const settingsBtn = document.getElementById('settings-btn') || document.getElementById('api-keys-modal-btn');
                                    if (settingsBtn) settingsBtn.click();
                                }
                            });
                        }
                    });
                } catch {}
                const prepayErr = new Error(prepayMsg);
                prepayErr.name = 'PrepaymentCreditsDepletedError';
                throw prepayErr;
            }

            const isAuthError = /invalid authentication credentials|ACCESS_TOKEN_TYPE_UNSUPPORTED|OVERLOADED_CREDENTIALS|UNAUTHENTICATED|api key not valid|API_KEY_INVALID|unauthorized|invalid.*parameter|NOT_LOGGED_IN|Cookie session is invalid/i.test(errorMessage);
            const isFatal = error.name === 'FatalError' || isAuthError;

            if (/NOT_LOGGED_IN|Cookie session is invalid|Session expired/i.test(errorMessage)) {
                try {
                    sessionStorage.setItem('geminiCookieExpired', 'true');
                    localStorage.setItem('geminiCookieExpired', 'true');
                    import('../ui').then(ui => ui.updateApiStatusBadge());
                } catch {}
            }

            if (isFatal) {
                const friendlyMessage = (isAuthError && /invalid authentication credentials|ACCESS_TOKEN_TYPE_UNSUPPORTED|UNAUTHENTICATED|api key not valid|API_KEY_INVALID/i.test(errorMessage))
                    ? 'Gemini API authentication failed (401). Please verify your Gemini API key in Settings > Secrets (GEMINI_API_KEY) or enter your key in App Settings.'
                    : errorMessage;
                const fatalErr = new Error(friendlyMessage);
                fatalErr.name = 'FatalError';
                throw fatalErr;
            }

            const isSafetyError = /prohibited_content|blocked|safety/i.test(errorMessage) || error.name === 'SafetyError';
            if (isSafetyError) {
                error.name = 'SafetyError';
                throw error;
            }

            const isRateLimit = /quota|resource_exhausted|429|rate limit|rate exceeded|limit exceeded|too many requests/i.test(errorMessage);
            if (isRateLimit) {
                if (i < maxRetries - 1) {
                    const backoff = Math.min(16000, 2500 * Math.pow(2, i) + Math.random() * 1000);
                    console.warn(`⏳ Gemini rate limit hit on attempt ${i + 1}/${maxRetries}. Retrying in ${Math.round(backoff / 1000)}s...`);
                    try {
                        // Dynamic import handled inside the loop
                        const uiModule = await import('../ui');
                        if (uiModule && typeof uiModule.showStatus === 'function') {
                            uiModule.showStatus(`Rate limit hit. Retrying in ${Math.round(backoff / 1000)}s...`, true, 3000);
                        }
                    } catch (err) {
                        console.warn('Could not show rate limit UI status:', err);
                    }

                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(resolve, backoff);
                        if (signal) {
                            signal.addEventListener('abort', () => {
                                clearTimeout(timeout);
                                reject(new DOMException('Aborted', 'AbortError'));
                            }, { once: true });
                        }
                    });
                    continue;
                } else {
                    const fallbackError = new Error(errorMessage);
                    fallbackError.name = 'QuotaError';
                    throw fallbackError;
                }
            }

            const isFallbackError = /403|404|503|permission|not found|unavailable/i.test(errorMessage);
            if (isFallbackError) {
                const code = (error as any)?.status || (error as any)?.code || (error as any)?.cause?.[0]?.error?.status || '?';
                console.warn(`[gemini:${requestId || 'req'}] model=${model || 'unknown'} FAILED status=${code} msg=${errorMessage.slice(0, 200)}`);
                if (code === 'NOT_FOUND' || code === 'RESOURCE_EXHAUSTED' || code === 'PERMISSION_DENIED') {
                    try {
                        const uiModule = await import('../ui');
                        uiModule.logProductionStatus?.(`AI Studio rejected: ${code} (${model || 'unknown'}) — see console.`, true);
                    } catch {}
                }
                const fallbackError = new Error(errorMessage);
                fallbackError.name = 'QuotaError'; // Reuse QuotaError to trigger fallback in outer loop
                throw fallbackError;
            }

            if (i === maxRetries - 1) {
                error.message = `Failed after ${maxRetries} attempts: ${errorMessage}`;
                throw error;
            }

            const jitter = Math.random() * 1000;
            const cappedDelay = Math.min(delay, 32000);
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, cappedDelay + jitter);
                if (signal) {
                    signal.addEventListener('abort', () => {
                        clearTimeout(timeout);
                        reject(new DOMException('Aborted', 'AbortError'));
                    }, { once: true });
                }
            });
            delay *= 2;
        }
    }
}

export function toVertexModelName(modelName?: string): string {
    const raw = (modelName || '').trim().replace(/[^a-zA-Z0-9._-]/g, "");
    if (!raw) return PRIMARY_MODEL;
    if (raw === 'gemini-3.7-flash' || raw === 'gemini-3.5-flash' || raw === 'gemini-3.7' || raw === 'gemini-3.5') {
        return PRIMARY_MODEL;
    }
    if (raw === 'gemini-flash-latest' || raw === 'gemini-flash' || raw === 'gemini-3.8-flash' || raw === 'gemini-3.6-flash' || raw === 'gemini-3-flash-preview' || raw === 'gemini-3.1-flash-lite') {
        return raw;
    }
    if (raw.includes('pro') && (raw.includes('3.') || raw.includes('3-') || raw === 'gemini-pro')) {
        return 'gemini-3.1-pro-preview';
    }
    return raw;
}

export const isGlobalOnly = (m: string) => /preview|exp/i.test(m);
export const pickLocation = (model: string, configured: string) =>
  isGlobalOnly(model) ? 'global' : (configured || 'us-central1');

async function callVertexWithADC(params: {
    project?: string;
    location?: string;
    model: string;
    contents: any;
    systemInstruction?: string;
    generationConfig?: any;
    apiKey?: string;
    authMode?: string;
}): Promise<any> {
    const vertexModel = toVertexModelName(params.model);
    const targetLocation = pickLocation(vertexModel, params.location || 'us-central1');
    const payload = {
        project: params.project || undefined,
        location: targetLocation,
        model: vertexModel,
        contents: params.contents,
        systemInstruction: params.systemInstruction,
        generationConfig: params.generationConfig,
        apiKey: params.apiKey || undefined,
        authMode: params.authMode || undefined
    };

    // 1. Try local/Node backend server endpoint first (Desktop, Electron, dev server)
    try {
        const localResp = await fetch('/api/vertex/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (localResp.ok) {
            const contentType = localResp.headers.get("content-type");
            if (contentType && contentType.includes("text/html")) {
                throw new Error("Received HTML response from Vertex proxy instead of JSON. The route might be missing or blocked.");
            }
            return await localResp.json();
        }
        if (localResp.status !== 404 && localResp.status !== 502 && localResp.status !== 503) {
            const errText = await localResp.text().catch(() => '');
            let errJson: any = {};
            try { errJson = JSON.parse(errText); } catch(e) {}
            throw new Error(errJson.error || `Vertex backend error: ${localResp.statusText} - ${errText.substring(0, 50)}`);
        }
    } catch (localErr: any) {
        if (localErr.message && !localErr.message.includes('Failed to fetch') && !localErr.message.includes('NetworkError')) {
            throw localErr;
        }
    }

    // 2. Cloud Function proxy (Web Deployment with Firebase)
    try {
        const { getFunctions, httpsCallable } = await import(/* @vite-ignore */ 'firebase/functions');
        const { app } = await import('../firebase');
        if (app) {
            const functions = getFunctions(app, params.location || 'us-central1');
            const proxyVertexFn = httpsCallable(functions, 'proxyVertex');
            const res: any = await proxyVertexFn(payload);
            return res.data;
        }
    } catch (cfErr: any) {
        console.error('Firebase Cloud Function Vertex proxy failed:', cfErr);
        throw new Error(cfErr.message || 'Vertex AI ADC proxy failed');
    }

    throw new Error('No Vertex AI backend or Cloud Function available for ADC authentication.');
}

function parseVertexResponse(rawResult: any): GenerateContentResponse {
    let text = rawResult?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || rawResult?.text || '';
    return {
        text,
        candidates: rawResult?.candidates || [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
        usageMetadata: rawResult?.usageMetadata || { totalTokenCount: 0 },
        functionCalls: () => undefined
    } as any;
}

/**
 * Determines whether a given model supports developer/system instructions.
 * Dedicated speech-to-text models (e.g. gemini-3.5-transcribe), text-to-speech models
 * (gemini-3.1-flash-tts-preview), image generation models, and video/music models
 * return 400 "Developer instruction is not enabled for this model" when systemInstruction is passed.
 */
export function supportsDeveloperInstruction(modelName?: string): boolean {
    if (!modelName) return true;
    const name = modelName.toLowerCase();
    return !/transcribe|tts|imagen|image|veo|lyria/i.test(name);
}

/**
 * Safely merges a system instruction into the user content payload
 * for models that do not support the separate systemInstruction/developer instruction parameter.
 */
export function mergeSystemInstructionIntoContents(contents: any, systemInstruction?: string): any {
    if (!systemInstruction || !systemInstruction.trim()) return contents;
    const sysPrompt = systemInstruction.trim();

    if (typeof contents === 'string') {
        return `${sysPrompt}\n\n${contents}`;
    }

    if (contents && typeof contents === 'object' && Array.isArray(contents.parts)) {
        const clonedParts = [...contents.parts];
        const firstTextIdx = clonedParts.findIndex(p => typeof p?.text === 'string');
        if (firstTextIdx !== -1) {
            clonedParts[firstTextIdx] = {
                ...clonedParts[firstTextIdx],
                text: `${sysPrompt}\n\n${clonedParts[firstTextIdx].text}`
            };
        } else {
            clonedParts.push({ text: sysPrompt });
        }
        return { ...contents, parts: clonedParts };
    }

    if (Array.isArray(contents)) {
        const cloned = [...contents];
        if (cloned.length > 0) {
            if (typeof cloned[0] === 'string') {
                cloned[0] = `${sysPrompt}\n\n${cloned[0]}`;
                return cloned;
            } else if (cloned[0]?.parts && Array.isArray(cloned[0].parts)) {
                const parts = [...cloned[0].parts];
                const firstTextIdx = parts.findIndex(p => typeof p?.text === 'string');
                if (firstTextIdx !== -1) {
                    parts[firstTextIdx] = {
                        ...parts[firstTextIdx],
                        text: `${sysPrompt}\n\n${parts[firstTextIdx].text}`
                    };
                } else {
                    parts.push({ text: sysPrompt });
                }
                cloned[0] = { ...cloned[0], parts };
                return cloned;
            }
        }
        return [{ text: sysPrompt }, ...cloned];
    }

    return { parts: [{ text: sysPrompt }, contents] };
}

export async function generateContentWithFallback(params: {
    contents: any,
    model?: string,
    systemInstruction?: string,
    schema?: any,
    mimeType?: string,
    thinkingBudget?: number,
    maxOutputTokens?: number,
    requestId?: string,
    safetySettings?: any[]
}, signal?: AbortSignal): Promise<GenerateContentResponse> {
    const apiKey = getApiKey();
    const requestId = params.requestId || generateRequestId();
    const currentAuth = getEffectiveGeminiAuth();
    const activeEngineInfo = currentAuth.mode === 'openaiGateway'
        ? `OpenAI Gateway (${currentAuth.openaiGatewayModel || 'default'})`
        : `Gemini (${params.model || state.currentTextModel || 'fallback'})`;

    console.log(`[${requestId}] Starting LLM request via ${activeEngineInfo}`);

    const prepareConfig = (modelName: string) => {
        const config: any = {};
        if (params.systemInstruction && supportsDeveloperInstruction(modelName)) {
            config.systemInstruction = params.systemInstruction;
        }
        if (params.schema) {
            config.responseSchema = params.schema;
            config.responseMimeType = 'application/json';
        }
        if (params.mimeType) config.responseMimeType = params.mimeType;
        if (params.safetySettings) {
            config.safetySettings = params.safetySettings;
        } else {
            config.safetySettings = [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE }
            ];
        }

        if (params.thinkingBudget !== undefined && (modelName.includes('-pro') || modelName.includes('-thinking'))) {
            config.thinkingConfig = { thinkingBudget: params.thinkingBudget };
            const requestedMax = params.maxOutputTokens || 65536;
            config.maxOutputTokens = requestedMax;
        } else if (params.maxOutputTokens) {
            config.maxOutputTokens = params.maxOutputTokens;
        }
        return config;
    };

    function createTimeoutSignal(callerSignal?: AbortSignal, timeoutMs = 60000) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort(new DOMException(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, 'TimeoutError'));
        }, timeoutMs);

        const onAbort = () => {
            clearTimeout(timer);
            controller.abort(callerSignal?.reason || new DOMException('Aborted', 'AbortError'));
        };

        if (callerSignal) {
            if (callerSignal.aborted) {
                clearTimeout(timer);
                controller.abort(callerSignal.reason || new DOMException('Aborted', 'AbortError'));
            } else {
                callerSignal.addEventListener('abort', onAbort, { once: true });
            }
        }

        return {
            signal: controller.signal,
            cleanup: () => {
                clearTimeout(timer);
                if (callerSignal) {
                    callerSignal.removeEventListener('abort', onAbort);
                }
            }
        };
    }

    const makeApiCall = async (model: string, config: any, retries?: number) => {
        if (circuitBreaker.isOpen('gemini')) {
            throw new Error('Gemini API temporarily unavailable. Please try again in a few minutes.');
        }

        await checkCredits(1, 'text'); // Check before making the call

        try {
            let result: any;
            const auth = getEffectiveGeminiAuth();
            if (auth.mode === 'adc' || auth.provider === 'vertex') {
                result = await callGeminiWithRetries(async () => {
                    const vertexSupportsDev = supportsDeveloperInstruction(model);
                    const vertexContents = (!vertexSupportsDev && config.systemInstruction)
                        ? mergeSystemInstructionIntoContents(params.contents, config.systemInstruction)
                        : params.contents;
                    const rawVertexRes = await callVertexWithADC({
                        project: auth.vertexProjectId,
                        location: auth.vertexLocation,
                        model: model,
                        contents: vertexContents,
                        systemInstruction: vertexSupportsDev ? config.systemInstruction : undefined,
                        generationConfig: config,
                        apiKey: auth.apiKey,
                        authMode: auth.vertexAuthMode
                    });
                    let parsed = parseVertexResponse(rawVertexRes);
                    if (config.responseSchema || config.responseMimeType === 'application/json') {
                        const cleanText = stripCodeFence(parsed.text || '');
                        parsed = { ...parsed, text: cleanText } as any;
                    }
                    return parsed;
                }, retries, signal, model, requestId);
            } else if (auth.mode === 'webCookie' && auth.cookies?.['__Secure-1PSID']) {
                // Convert contents and attachments to messages format for our proxy
                let promptText = "";
                const attachments: any[] = [];

                if (typeof params.contents === "string") {
                    promptText = params.contents;
                } else if (params.contents?.parts) {
                    for (const p of params.contents.parts) {
                        if (p.text) promptText += (promptText ? "\n" : "") + p.text;
                        if (p.inlineData?.data) {
                            attachments.push({
                                mimeType: p.inlineData.mimeType || 'image/jpeg',
                                data: p.inlineData.data
                            });
                        }
                    }
                } else if (Array.isArray(params.contents)) {
                    for (const c of params.contents) {
                        if (typeof c === "string") {
                            promptText += (promptText ? "\n" : "") + c;
                        } else if (c?.text) {
                            promptText += (promptText ? "\n" : "") + c.text;
                        } else if (c?.inlineData?.data) {
                            attachments.push({
                                mimeType: c.inlineData.mimeType || 'image/jpeg',
                                data: c.inlineData.data
                            });
                        } else if (c?.parts) {
                            for (const p of c.parts) {
                                if (p.text) promptText += (promptText ? "\n" : "") + p.text;
                                if (p.inlineData?.data) {
                                    attachments.push({
                                        mimeType: p.inlineData.mimeType || 'image/jpeg',
                                        data: p.inlineData.data
                                    });
                                }
                            }
                        }
                    }
                }

                const isJsonMode = !!(config.responseSchema || config.responseMimeType === 'application/json' || params.schema || params.mimeType === 'application/json');
                if (isJsonMode) {
                    promptText += `\n\nCRITICAL INSTRUCTION: You are an automated data API backend. Output ONLY a valid raw JSON object/array matching the requested format. Do NOT include any conversational preamble (such as "I encountered", "Here is", "Sure", "I analyzed"), conversational pleasantries, notes, apologies, or markdown text outside the JSON. Start your response directly with { or [ and end with } or ].`;
                    if (config.responseSchema) {
                        promptText += `\nJSON Schema:\n${JSON.stringify(config.responseSchema, null, 2)}`;
                    }
                }

                let effectiveSysInstruction = config.systemInstruction || "";
                if (isJsonMode) {
                    effectiveSysInstruction = effectiveSysInstruction
                        ? `${effectiveSysInstruction} Output strictly valid JSON without conversational preamble, introduction, or markdown commentary.`
                        : "You are an expert data engine. Output strictly valid JSON without conversational preamble, introduction, or commentary.";
                }

                result = await callGeminiWithRetries(async () => {
                    const { signal: fetchSignal, cleanup } = createTimeoutSignal(signal, 60000);
                    let response: Response;
                    try {
                        response = await fetch("/api/llm/gemini", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            signal: fetchSignal,
                            body: JSON.stringify({
                                prompt: promptText,
                                systemInstruction: effectiveSysInstruction,
                                model: model,
                                tools: config.tools || undefined,
                                attachments: attachments.length > 0 ? attachments : undefined,
                                cookies: auth.cookies
                            })
                        });
                    } finally {
                        cleanup();
                    }
                    if (!response.ok) {
                        const errText = await response.text().catch(() => '');
                        let errData: any = {};
                        try { errData = JSON.parse(errText); } catch(e) {}
                        throw new Error(errData.error || `Web Cookie Proxy failed: ${response.statusText} - ${errText.substring(0, 50)}`);
                    }
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("text/html")) {
                        throw new Error("Received HTML response from proxy instead of JSON. You may need to refresh the page or check your API credits.");
                    }
                    const data = await response.json();
                    sessionStorage.setItem('geminiCookieExpired', 'false');
                    localStorage.setItem('geminiCookieExpired', 'false');
                    if (data.updatedCookies) {
                        import('../handlers-settings').then(h => h.applyUpdatedGeminiCookies(data.updatedCookies));
                    }
                    let generatedText = data.text || "";

                    const { text: cleanText } = extractThinkingAndText(generatedText);
                    generatedText = cleanText || generatedText;

                    if (config.responseSchema || config.responseMimeType === 'application/json') {
                        generatedText = stripCodeFence(generatedText);
                    }

                    // Build candidate parts (including tool calls if returned)
                    const candidateParts: any[] = [];
                    if (data.toolCalls && Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
                        for (const tc of data.toolCalls) {
                            candidateParts.push({
                                functionCall: {
                                    name: tc.name,
                                    args: tc.args || {}
                                }
                            });
                        }
                    } else {
                        candidateParts.push({ text: generatedText });
                    }

                    // Mock GenerateContentResponse
                    return {
                        text: generatedText,
                        thinking: data.thinking || undefined,
                        functionCalls: () => data.toolCalls || undefined,
                        candidates: [{
                            content: { parts: candidateParts },
                            finishReason: data.finishReason || (data.toolCalls ? 'FUNCTION_CALL' : 'STOP')
                        }],
                        usageMetadata: { totalTokenCount: 0 }
                    };
                }, retries, signal, model, requestId);
            } else if (auth.mode === 'openaiGateway') {
                const targetModel = auth.openaiGatewayModel?.trim() || model || 'gpt-4o';

                result = await callGeminiWithRetries(async () => {
                    const messages: any[] = [];
                    let systemPrompt = config.systemInstruction || '';
                    if (config.responseSchema) {
                        const isArraySchema = (config.responseSchema as any)?.type === 'ARRAY' || (config.responseSchema as any)?.type === 'array';
                        systemPrompt += (systemPrompt ? '\n\n' : '') +
                            'CRITICAL: Respond ONLY with valid JSON conforming to this schema:\n' +
                            JSON.stringify(config.responseSchema, null, 2);
                        if (isArraySchema) {
                            systemPrompt += '\n\nNote: If your environment requires a root JSON object, you may return {"shots": [...]} or {"items": [...]} containing the array elements.';
                        }
                    } else if (config.responseMimeType === 'application/json') {
                        systemPrompt += (systemPrompt ? '\n\n' : '') + 'CRITICAL: Respond ONLY with valid JSON. Do not include markdown formatting or commentary.';
                    }

                    if (systemPrompt) {
                        messages.push({ role: 'system', content: systemPrompt });
                    }

                    const formatParts = (parts: any[]) => {
                        const textParts: string[] = [];
                        const blocks: any[] = [];
                        for (const p of parts) {
                            if (p.text) {
                                textParts.push(p.text);
                                blocks.push({ type: 'text', text: p.text });
                            }
                            const rawInline = p.inlineData || p.inline_data;
                            if (rawInline) {
                                const rawData = typeof rawInline === 'string' ? rawInline : (rawInline.data || rawInline.bytes || '');
                                let mime = (rawInline.mimeType || rawInline.mime_type || '').toLowerCase();
                                if (!mime || mime === 'image/*' || mime === 'image') {
                                    mime = 'image/jpeg';
                                }
                                if (rawData) {
                                    let urlStr = '';
                                    if (rawData.startsWith('data:') || rawData.startsWith('http://') || rawData.startsWith('https://')) {
                                        urlStr = rawData;
                                    } else {
                                        urlStr = `data:${mime};base64,${rawData}`;
                                    }
                                    blocks.push({
                                        type: 'image_url',
                                        image_url: {
                                            url: urlStr
                                        }
                                    });
                                }
                            }
                        }
                        if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text;
                        if (blocks.every((b: any) => b.type === 'text')) return textParts.join('\n');
                        return blocks.length > 0 ? blocks : textParts.join('\n');
                    };

                    if (typeof params.contents === 'string') {
                        messages.push({ role: 'user', content: params.contents });
                    } else if (params.contents?.parts) {
                        const role = (params.contents.role === 'model' || params.contents.role === 'assistant') ? 'assistant' : 'user';
                        messages.push({ role, content: formatParts(params.contents.parts) });
                    } else if (Array.isArray(params.contents)) {
                        for (const item of params.contents) {
                            if (typeof item === 'string') {
                                messages.push({ role: 'user', content: item });
                            } else if (item?.parts) {
                                const role = (item.role === 'model' || item.role === 'assistant') ? 'assistant' : 'user';
                                messages.push({ role, content: formatParts(item.parts) });
                            } else if (item?.text) {
                                messages.push({ role: 'user', content: item.text });
                            }
                        }
                    } else if (params.contents) {
                        messages.push({ role: 'user', content: JSON.stringify(params.contents) });
                    }

                    const gatewayPayload: any = {
                        baseUrl: auth.openaiGatewayBaseUrl || 'https://openrouter.ai/api/v1',
                        apiKey: auth.openaiGatewayApiKey || undefined,
                        model: targetModel,
                        messages,
                        temperature: 0.7
                    };

                    if (config.responseSchema || config.responseMimeType === 'application/json') {
                        gatewayPayload.response_format = { type: 'json_object' };
                    }
                    if (config.maxOutputTokens) {
                        gatewayPayload.max_tokens = Math.min(config.maxOutputTokens, 16384);
                    }

                    const { signal: fetchSignal, cleanup } = createTimeoutSignal(signal, 60000);
                    let response: Response;
                    try {
                        response = await fetch('/api/openai/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            signal: fetchSignal,
                            body: JSON.stringify(gatewayPayload)
                        });
                    } finally {
                        cleanup();
                    }

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `OpenAI Gateway request failed: ${response.statusText}`);
                    }

                    const data = await response.json();
                    const choice = data.choices?.[0];
                    let replyText = choice?.message?.content || '';
                    const reasoning = choice?.message?.reasoning_content || choice?.message?.reasoning || '';

                    // If content was placed in reasoning_content instead of content
                    if (!replyText.trim() && reasoning) {
                        replyText = reasoning;
                    }

                    const { thinking, text: cleanText } = extractThinkingAndText(replyText);
                    replyText = cleanText || replyText;
                    const combinedThinking = thinking || reasoning || undefined;

                    if (config.responseSchema || config.responseMimeType === 'application/json') {
                        replyText = stripCodeFence(replyText);
                    }

                    return {
                        text: replyText,
                        thinking: combinedThinking,
                        functionCalls: () => undefined,
                        candidates: [{
                            content: {
                                parts: [{ text: replyText }]
                            },
                            finishReason: choice?.finish_reason || 'STOP'
                        }],
                        usageMetadata: {
                            totalTokenCount: data.usage?.total_tokens || 0
                        }
                    };
                }, retries, signal, targetModel, requestId);
            } else {
                const ai = createGoogleGenAIClient(apiKey);
                const supportsDev = supportsDeveloperInstruction(model);
                const effectiveContents = (!supportsDev && params.systemInstruction)
                    ? mergeSystemInstructionIntoContents(params.contents, params.systemInstruction)
                    : params.contents;
                try {
                    result = await callGeminiWithRetries(() => ai.models.generateContent({
                        model,
                        contents: effectiveContents,
                        config,
                    }), retries, signal, model, requestId);
                } catch (apiErr: any) {
                    const errMsg = apiErr.message || String(apiErr);
                    const isDevInstructionErr = apiErr.name === 'DeveloperInstructionError' || /developer instruction is not enabled/i.test(errMsg);

                    if (isDevInstructionErr && (config.systemInstruction || params.systemInstruction)) {
                        console.warn(`[${requestId}] Model ${model} rejected developer instructions. Seamlessly retrying with instructions merged into contents.`);
                        const fallbackConfig = { ...config };
                        delete fallbackConfig.systemInstruction;
                        const mergedContents = mergeSystemInstructionIntoContents(params.contents, config.systemInstruction || params.systemInstruction);

                        result = await callGeminiWithRetries(() => ai.models.generateContent({
                            model,
                            contents: mergedContents,
                            config: fallbackConfig,
                        }), retries, signal, model, requestId);
                    } else if ((apiErr.name === 'ConstraintSizeError' || /constraint.*too.*tall|constraint.*size|constraint-is-too-big/i.test(apiErr.message || '')) && config.responseSchema) {
                        console.warn(`[${requestId}] Schema exceeded server FST constraint size limits. Seamlessly falling back to prompt-guided JSON schema.`);
                        const fallbackConfig = { ...config };
                        delete fallbackConfig.responseSchema;
                        fallbackConfig.responseMimeType = 'application/json';

                        const schemaPrompt = `\n\n**JSON RESPONSE FORMAT (STRICT):**\nYou must respond ONLY with a valid JSON document matching this structure:\n${JSON.stringify(config.responseSchema, null, 2)}`;
                        if (supportsDeveloperInstruction(model)) {
                            fallbackConfig.systemInstruction = (fallbackConfig.systemInstruction || '') + schemaPrompt;
                            result = await callGeminiWithRetries(() => ai.models.generateContent({
                                model,
                                contents: effectiveContents,
                                config: fallbackConfig,
                            }), retries, signal, model, requestId);
                        } else {
                            delete fallbackConfig.systemInstruction;
                            const schemaContents = mergeSystemInstructionIntoContents(effectiveContents, schemaPrompt);
                            result = await callGeminiWithRetries(() => ai.models.generateContent({
                                model,
                                contents: schemaContents,
                                config: fallbackConfig,
                            }), retries, signal, model, requestId);
                        }
                    } else {
                        throw apiErr;
                    }
                }
            }

            // Validate that JSON requests actually returned JSON, not a conversational refusal
            if ((params.mimeType === 'application/json' || params.schema) && result?.text) {
                const textTrimmed = result.text.trim();
                const lower = textTrimmed.toLowerCase();
                const isRefusal = lower.startsWith('sorry') || 
                                  lower.startsWith('i am unable') || 
                                  lower.startsWith('i cannot') ||
                                  lower.startsWith("i'm having a hard time") ||
                                  lower.startsWith("i am having a hard time") ||
                                  lower.startsWith("i'm sorry") ||
                                  lower.startsWith("i can't") ||
                                  lower.includes("can i help you with something else") ||
                                  lower.includes("fulfilling your request") ||
                                  lower.includes("conversational response");
                if (isRefusal) {
                    console.warn(`[${requestId}] Model ${model} returned conversational refusal instead of JSON: "${textTrimmed.substring(0, 80)}...". Triggering model fallback...`);
                    const refusalErr: any = new Error(`Model ${model} returned conversational refusal instead of JSON.`);
                    refusalErr.name = 'ConversationalRefusalError';
                    throw refusalErr;
                }
            }

            circuitBreaker.recordSuccess('gemini');
            console.log(`[${requestId}] Success`);

            // Deduct credits based on token usage (30,000 tokens = 1000 credits)
            if (result.usageMetadata && result.usageMetadata.totalTokenCount) {
                const tokensUsed = result.usageMetadata.totalTokenCount;
                const creditsToDeduct = tokensUsed * CREDIT_COSTS.TEXT_GENERATION_PER_TOKEN;
                // We don't await this to avoid blocking the UI, but we could if we want strict enforcement
                deductCredits(creditsToDeduct, 'text').catch(console.error);
            }

            return result;
        } catch (error: any) {
            const isExpectedFallbackError = /quota|resource_exhausted|429|403|404|permission|not found|constraint|insufficient|developer instruction/i.test(error.message || String(error));
            if (!isExpectedFallbackError && error.name !== 'SafetyError' && error.name !== 'QuotaError' && error.name !== 'ConstraintSizeError' && error.name !== 'DeveloperInstructionError') {
                circuitBreaker.recordFailure('gemini');
            }
            if (!isExpectedFallbackError) {
                console.error(`[${requestId}] Failed:`, error);
            }
            throw error;
        }
    };

    // Strictly descending text model fallback hierarchy:
    // Pro (50) -> 3.8 Flash (40) -> 3.6 Flash (35) -> Flash Latest (30) -> 3.1 Flash Lite (20)
    const getModelRank = (modelName: string): number => {
        const name = (modelName || '').toLowerCase();
        if (name.includes('3.1-pro') || name.includes('-pro')) return 50;
        if (name.includes('3.8-flash') || name.includes('3.8')) return 40;
        if (name.includes('3.6-flash') || name.includes('3.6') || name === PRIMARY_MODEL.toLowerCase()) return 35;
        if (name === SECONDARY_MODEL.toLowerCase() || name.includes('flash-latest')) return 30;
        if (name.includes('transcribe') || name === TRANSCRIBE_MODEL.toLowerCase()) return 28;
        if (name.includes('3.1-flash-lite') || name === TERTIARY_MODEL.toLowerCase() || name.includes('flash-lite')) return 20;
        if (name.includes('3-flash')) return 20;
        return 20;
    };

    const TEXT_MODEL_FALLBACK_CHAIN = [
        PRIMARY_MODEL,       // "gemini-3.6-flash"
        'gemini-3.8-flash',
        SECONDARY_MODEL,     // "gemini-flash-latest"
        'gemini-3.1-pro-preview',
        TERTIARY_MODEL,      // "gemini-3.1-flash-lite"
        'gemini-3-flash-preview'
    ];

    // Priority: User's explicitly chosen model in UI/Settings (state.currentTextModel) takes precedence
    // for general text generation and reasoning tasks. Only specialized models (transcribe, tts, audio, image)
    // override the user's selected text model.
    const isSpecializedTask = !!(params.model && (
        params.model.includes('transcribe') ||
        params.model.includes('tts') ||
        params.model.includes('audio') ||
        params.model.includes('image')
    ));

    const startingModel = (isSpecializedTask ? params.model : (state.currentTextModel || params.model)) || PRIMARY_MODEL;
    const startRank = getModelRank(startingModel);

    // Fallback strictly to models that come AFTER the starting model in the fallback chain
    const startIndex = TEXT_MODEL_FALLBACK_CHAIN.indexOf(startingModel);
    const validFallbacks = startIndex >= 0 
        ? TEXT_MODEL_FALLBACK_CHAIN.slice(startIndex + 1)
        : TEXT_MODEL_FALLBACK_CHAIN.filter(m => getModelRank(m) < startRank && m !== startingModel);

    const modelsToTry = Array.from(new Set([startingModel, ...validFallbacks]));

    let lastError: any;
    for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        try {
            const config = prepareConfig(model);
            const result = await makeApiCall(model, config, i === 0 ? 2 : 1);
            
            // If we used a fallback model that succeeded, remember it so we don't waste time failing next request
            const defaultModel = state.currentTextModel || PRIMARY_MODEL;
            if (model !== defaultModel && (!params.model || params.model === defaultModel || !isSpecializedTask)) {
                console.log(`[${requestId}] Automatically changing default text model to ${model} after successful fallback.`);
                state.currentTextModel = model;
                
                try {
                    const uiModule = await import('../ui');
                    if (uiModule && typeof uiModule.showStatus === 'function') {
                        uiModule.showStatus(`Model ${defaultModel} limit reached. Switching to ${model}...`, true, 5000);
                    }
                } catch (e) {
                    console.error('Failed to show fallback status notification:', e);
                }
            }
            
            return result;
        } catch (error: any) {
            lastError = error;
            const errorMessage = error.message || String(error);

            // Cancel/abort stops immediately - do NOT walk fallback models
            if (signal?.aborted || error.name === 'AbortError' || /aborted/i.test(errorMessage)) {
                throw error;
            }

            // Safety policy violations must NOT be retried across fallback models
            if (error.name === 'SafetyError' || /safety|prohibited_content|blocked by api policy|finish reason: safety/i.test(errorMessage)) {
                throw error;
            }

            if (errorMessage.includes("Insufficient credits") || error.name === 'PrepaymentCreditsDepletedError' || /prepayment.*depleted|credits are depleted|billing#prepay/i.test(errorMessage)) {
                throw error;
            }

            const isFallbackError = error.name === 'QuotaError' || 
                                    error.name === 'DeveloperInstructionError' || 
                                    error.name === 'ConversationalRefusalError' ||
                                    /quota|resource_exhausted|429|403|404|503|permission|not found|unavailable|developer instruction|conversational refusal/i.test(errorMessage);

            if (isFallbackError) {
                console.log(`[${requestId}] Model ${model} unavailable. Trying next model...`);
                continue; // Immediately try next model
            }

            if (error.name === 'FatalError') {
                throw error;
            }

            console.log(`[${requestId}] Model ${model} encountered an error. Falling back to next model...`);
        }
    }

    if (lastError) {
        const lastMsg = lastError.message || String(lastError);
        if (/quota|resource_exhausted|429|rate limit|too many requests/i.test(lastMsg)) {
            const friendlyErr = new Error(
                'Gemini API quota or rate limit exceeded (RESOURCE_EXHAUSTED). Free tier rate limits were reached. Please wait a few seconds before retrying, or configure a personal Gemini API key in Settings.'
            );
            friendlyErr.name = 'QuotaError';
            throw friendlyErr;
        }
    }
    throw lastError;
}

export async function fixJsonWithGemini(badJson: string, errorMessage: string): Promise<GenerateContentResponse> {
    return await generateContentWithFallback({
        model: TERTIARY_MODEL,
        contents: `Fix this JSON: ${badJson}\nError: ${errorMessage}`,
        systemInstruction: "Output ONLY valid JSON.",
        mimeType: 'application/json'
    });
}
