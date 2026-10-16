/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from '@google/genai';
import { createGoogleGenAIClient, getApiKey, deductCredits, checkCredits, isUsingPersonalKey, getEffectiveGeminiAuth, generateContentWithFallback } from './core';
import { getStabilityApiKey } from './providers';
import type { AspectRatio } from '../types';
import { SECONDARY_MODEL, CREDIT_COSTS } from '../constants';
import { state } from '../state';
import { fetchImageAsBlob } from '../utils';
import { isImageGenAllowedForCurrentUser, setUserRecord } from '../auth';
import { db, auth as firebaseAuth } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { cleanBase64Image } from '../c2pa-cleaner';

export async function analyzeImageStyle(image: { data: string, mimeType: string }): Promise<string> {
    const prompt = `You are a world-class Art Director and prompt engineer for text-to-image AI. Your task is to analyze the provided image and extract ONLY its artistic style.

**DO NOT** describe the subject matter, characters, or specific objects in the image. Your focus is purely on the artistic technique and aesthetic qualities.

Generate a detailed, descriptive prompt that captures this unique style. Focus on keywords related to:
- Medium (e.g., oil painting, digital art, photograph)
- Lighting (e.g., chiaroscuro, golden hour, neon)
- Color palette (e.g., monochromatic, vibrant, pastel)
- Brushwork or texture (e.g., impasto, smooth, film grain)
- Composition style (e.g., symmetrical, minimalist)
- Overall mood and atmosphere (e.g., ethereal, gritty, nostalgic)

The output must be a single paragraph of keywords ready to be used in another AI image generator.`;

    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL,
        contents: { parts: [{ inlineData: image }, { text: prompt }] }
    });

    return response.text?.trim() || '';
}

/**
 * Sanitizes image prompts to prevent false-positive blocks from image generation
 * safety filters (e.g. Imagen). Focuses on neutralizing child/minor references and
 * sensitive social-context language that triggers filters even in literary contexts.
 *
 * This does NOT alter meaning or artistic intent — it rephrases for API compatibility.
 */
export function sanitizeImagePrompt(prompt: string): string {
    if (!prompt) return prompt;

    let p = prompt;

    // ── Age-specific child references → neutral "young student / young person" ──
    // Patterns like "8-year-old girl", "six year old boy", "8 yr old child"
    p = p.replace(/\b(\d+)[\s-]?(?:year[s]?[\s-]?old|yr[s]?[\s-]?old)\s+(?:girl|boy|child|kid|student)\b/gi,
        (_, age) => parseInt(age, 10) < 18 ? 'young student' : _);

    // "young girl", "little girl/boy", "small child", "young child"
    p = p.replace(/\b(?:young|little|small|tiny)\s+(?:girl|boy|child|kid)\b/gi, 'young student');

    // Standalone "child" or "children" in vulnerable contexts — replace with "student(s)"
    p = p.replace(/\bchild(?:ren)?\b/gi, (match) => match.endsWith('ren') ? 'students' : 'student');

    // Minor / juvenile / underage
    p = p.replace(/\b(?:minor|juvenile|underage)\b/gi, 'young person');

    // ── Shelter / homelessness → neutral cinematic space descriptions ──
    p = p.replace(/\bhomeless\s+shelter\b/gi, 'sparse temporary lodging');
    p = p.replace(/\bshelter\b/gi, 'temporary residence');
    p = p.replace(/\bhomeless(?:ness)?\b/gi, 'without a home');
    p = p.replace(/\bliving on the street[s]?\b/gi, 'living in hardship');

    // ── Remove distress language that compounds with child references ──
    p = p.replace(/\b(?:vulnerable|distressed|suffering|impoverished)\s+(?:student|young person|child|girl|boy)\b/gi,
        'young person');

    // ── Named character age anchors that were already extracted ──
    // e.g. "Ada (8-year-old...)" → replace age in anchor
    p = p.replace(/\(([^)]*)\b(\d+)[\s-]?year[s]?[\s-]?old([^)]*)\)/gi, (match, pre, age, post) => {
        if (parseInt(age, 10) < 18) {
            return `(${pre}young${post})`;
        }
        return match;
    });

    return p;
}

export { fetchImageAsBlob } from '../utils';

/**
 * Browser-level image fetcher.
 * Downloads image bytes directly from Google CDN (lh3.googleusercontent.com / gg-dl)
 * utilizing the user's browser residential IP, CORS headers, or Canvas element rendering
 * when datacenter backend servers get blocked by Google's anti-bot CDN firewalls.
 */
export async function fetchImageInBrowser(
    primaryUrl?: string,
    candidateUrls?: string[]
): Promise<{ base64: string; mimeType: string } | null> {
    const allUrls = [primaryUrl, ...(candidateUrls || [])]
        .filter((u): u is string => !!u && typeof u === 'string' && u.startsWith('http'));

    for (const url of allUrls) {
        try {
            console.log(`🌐 Browser downloading image via fetchImageAsBlob: ${url.slice(0, 65)}...`);
            const blob = await fetchImageAsBlob(url);
            if (blob && blob.size > 200) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const resStr = (reader.result as string) || '';
                        const comma = resStr.indexOf(',');
                        resolve(comma >= 0 ? resStr.slice(comma + 1) : resStr);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                if (base64 && base64.length > 100) {
                    console.log(`✅ Successfully fetched image as blob in browser (${blob.size} bytes)`);
                    return { base64, mimeType: blob.type || 'image/jpeg' };
                }
            }
        } catch (err: any) {
            console.warn(`Browser fetchImageAsBlob failed for ${url.slice(0, 50)}:`, err?.message || err);
        }
    }

    return null;
}

const IMAGE_MODEL_FALLBACKS: Record<string, string> = {
    'gemini-3-pro-image': 'gemini-3.1-flash-image',
    'gemini-3.1-flash-image': 'gemini-3.1-flash-lite-image',
    'gemini-3.1-flash-lite-image': ''
};

async function runImageGeneration(
    prompt: string,
    aspectRatio: AspectRatio,
    model: string,
    referenceImage?: { data: string, mimeType: string },
    maxRetries: number = 3
): Promise<{ base64?: string, mimeType?: string, engine: string, error?: any }> {
    const isPersonalKey = isUsingPersonalKey(true);
    const auth = getEffectiveGeminiAuth();
    const isAdcOrVertex = auth.provider === 'vertex' || auth.mode === 'adc';
    const hasPersonalKeyOrAdc = isPersonalKey || isAdcOrVertex;

    // Real-time live pre-flight check against Firestore for system API users
    if (!isPersonalKey && db && firebaseAuth.currentUser?.uid) {
        try {
            const [userSnap, sysSnap] = await Promise.all([
                getDoc(doc(db, 'users', firebaseAuth.currentUser.uid)),
                getDoc(doc(db, 'settings', 'public_config'))
            ]);
            if (userSnap.exists()) {
                setUserRecord(userSnap.data());
            }
            if (sysSnap.exists()) {
                Object.assign(state.systemConfig, sysSnap.data());
            }
        } catch (err) {
            console.debug('Pre-flight live permission check skipped/failed:', err);
        }
    }

    if (!isImageGenAllowedForCurrentUser()) {
        return {
            engine: 'access-denied',
            error: 'Image generation access is disabled for your account. Please ask an administrator to grant you Image Generation Access in the Admin Panel or configure your personal Gemini API key in Settings.'
        };
    }

    // Global admin setting: disable image generation when users are using the system API
    if (state.systemConfig?.disableSystemImageGeneration && !isPersonalKey) {
        return {
            engine: 'system-disabled',
            error: 'Image generation on the shared system API has been disabled by the administrator. Please configure your personal Gemini API key or Cookie in Advanced Settings to generate images.'
        };
    }

    const apiKey = getApiKey();
    let finalModel = model || 'gemini-3.1-flash-lite-image';
    if ((auth.provider === 'vertex' || auth.mode === 'adc') && !finalModel.startsWith('imagen-') && (finalModel.includes('flash-lite') || finalModel === 'gemini-3.1-flash-lite-image')) {
        finalModel = 'gemini-3.1-flash-image';
    }

    const isPremiumModel = ['gemini-3-pro-image', 'gemini-3.1-flash-image'].includes(finalModel);
    if (isPremiumModel && !hasPersonalKeyOrAdc) {
        return { engine: 'google', error: 'To use this model, please set up your paid API key under Advanced Settings.' };
    }

    const isImagen = finalModel.startsWith('imagen-');
    const finalPrompt = sanitizeImagePrompt(prompt);
    
    const cost = isImagen ? CREDIT_COSTS.IMAGE_GENERATION_IMAGEN : CREDIT_COSTS.IMAGE_GENERATION_GEMINI;
    if (cost > 0) await checkCredits(cost, 'image');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🎨 Image generation attempt ${attempt}/${maxRetries} for model: ${finalModel}`);
            
            const auth = getEffectiveGeminiAuth();
            if (auth.mode === 'webCookie' && auth.cookies?.['__Secure-1PSID']) {
                // Try Gemini web cookie image generation first
                try {
                    const response = await fetch('/api/llm/gemini/image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: finalPrompt,
                            model: finalModel,
                            aspectRatio,
                            referenceImage,
                            cookies: auth.cookies
                        })
                    });
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("text/html")) {
                        throw new Error("Received HTML response from proxy instead of JSON.");
                    }
                    const errText = await response.text().catch(() => '');
                    let data: any = {};
                    try { data = JSON.parse(errText); } catch(e) {}
                    if (!response.ok) throw new Error(data.error || `Gemini Web Image generation failed: ${response.statusText} - ${errText.substring(0, 50)}`);

                    sessionStorage.setItem('geminiCookieExpired', 'false');
                    localStorage.setItem('geminiCookieExpired', 'false');
                    if (data.updatedCookies) {
                        import('../handlers-settings').then(h => h.applyUpdatedGeminiCookies(data.updatedCookies));
                    }

                    // If server was able to download the image directly:
                    if (data.base64) {
                        deductCredits(cost, 'image').catch(console.error);
                        return { base64: data.base64, mimeType: data.mimeType || 'image/jpeg', engine: data.engine || 'gemini-web' };
                    }

                    // Client-Side Browser Image Fetch:
                    if (data.clientFetchRequired || data.url || (data.candidateUrls && data.candidateUrls.length > 0)) {
                        console.log('🌐 Server delegated image download to browser. Executing client-side fetch from residential context...');
                        const clientFetched = await fetchImageInBrowser(data.url, data.candidateUrls);
                        if (clientFetched && clientFetched.base64) {
                            deductCredits(cost, 'image').catch(console.error);
                            return { base64: clientFetched.base64, mimeType: clientFetched.mimeType, engine: data.engine || 'gemini-web' };
                        }
                        throw new Error('Image URL received from Gemini, but browser was unable to retrieve image data');
                    }

                    throw new Error('No image data or valid URL returned by Gemini Web');
                } catch (webErr: any) {
                    console.warn('Gemini web cookie proxy failed:', webErr.message);
                    if (/NOT_LOGGED_IN|Cookie session is invalid|Session expired/i.test(webErr.message || '')) {
                        sessionStorage.setItem('geminiCookieExpired', 'true');
                        localStorage.setItem('geminiCookieExpired', 'true');
                        import('../ui').then(ui => ui.updateApiStatusBadge());
                    }
                    return { engine: 'gemini-web', error: webErr.message || 'Cookie proxy failed' };
                }
            } else if (auth.mode === 'openaiGateway' || finalModel === 'openai-gateway-image' || finalModel.startsWith('gateway:') || finalModel === 'dall-e-3' || finalModel === 'dall-e-2' || finalModel === 'gpt-image') {
                try {
                    const targetImageModel = finalModel.startsWith('gateway:')
                        ? finalModel.slice(8)
                        : (finalModel !== 'openai-gateway-image' && (finalModel === 'dall-e-3' || finalModel === 'dall-e-2' || finalModel === 'gpt-image')
                            ? finalModel
                            : (state.openaiGatewayImageModel || 'dall-e-3'));

                    const response = await fetch('/api/openai/generate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            baseUrl: auth.openaiGatewayBaseUrl || state.openaiGatewayBaseUrl || 'https://api.openai.com/v1',
                            apiKey: auth.openaiGatewayApiKey || state.openaiGatewayApiKey,
                            prompt: finalPrompt,
                            model: targetImageModel,
                            size: aspectRatio === '9:16' ? '1024x1792' : (aspectRatio === '16:9' ? '1792x1024' : '1024x1024')
                        })
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || `OpenAI Gateway image failed: ${response.statusText}`);
                    const b64 = data.base64 || data?.data?.[0]?.b64_json;
                    if (b64) {
                        deductCredits(cost, 'image').catch(console.error);
                        return { base64: b64, mimeType: data.mimeType || 'image/png', engine: 'openai-gateway' };
                    }
                    throw new Error('No image returned from gateway');
                } catch (gwErr: any) {
                    console.warn('OpenAI Gateway image generation error:', gwErr.message);
                    throw gwErr;
                }
            } else if (auth.provider === 'vertex') {
                // Vertex AI server-side image generation (supports both ADC and Google Cloud API Key)
                try {
                    const response = await fetch('/api/vertex/generate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: finalPrompt,
                            model: finalModel,
                            aspectRatio,
                            referenceImage,
                            project: auth.vertexProjectId,
                            location: auth.vertexLocation || 'us-central1',
                            apiKey: auth.apiKey || undefined,
                            authMode: auth.vertexAuthMode || 'adc'
                        })
                    });
                    const contentType = response.headers.get("content-type");
                    if (contentType && contentType.includes("text/html")) {
                        throw new Error("Received HTML response from Vertex image proxy instead of JSON.");
                    }
                    const errText = await response.text().catch(() => '');
                    let data: any = {};
                    try { data = JSON.parse(errText); } catch(e) {}
                    if (!response.ok) throw new Error(data.error || `Vertex Image generation failed: ${response.statusText} - ${errText.substring(0, 50)}`);
                    if (data.base64) {
                        deductCredits(cost, 'image').catch(console.error);
                        return { base64: data.base64, mimeType: data.mimeType || 'image/jpeg', engine: data.engine || 'vertex-imagen' };
                    }
                } catch (vertexImgErr: any) {
                    console.warn('Vertex image generation error:', vertexImgErr.message);
                    throw vertexImgErr;
                }
            } else if (isImagen) {
                const ai = createGoogleGenAIClient(apiKey);
                const response = await ai.models.generateImages({
                    model: finalModel,
                    prompt: finalPrompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/jpeg',
                        aspectRatio: aspectRatio,
                    }
                });
                
                if (!response.generatedImages || response.generatedImages.length === 0) {
                    throw new Error('No images generated by Imagen');
                }
                
                const base64EncodeString = response.generatedImages[0].image!.imageBytes;
                
                console.log(`✅ Image generated successfully via Imagen SDK`);
                deductCredits(CREDIT_COSTS.IMAGE_GENERATION_IMAGEN, 'image').catch(console.error);
                return { base64: base64EncodeString, mimeType: 'image/jpeg', engine: 'imagen' };

            } else {
                const ai = createGoogleGenAIClient(apiKey);
                const parts: any[] = [{ text: finalPrompt }];
                if (referenceImage) parts.unshift({ inlineData: referenceImage });
                
                const config: any = { imageConfig: { aspectRatio } };
                if (finalModel === 'gemini-3.1-flash-image' || finalModel === 'gemini-3-pro-image') config.imageConfig.imageSize = "1K";
                
                const response = await ai.models.generateContent({ 
                    model: finalModel, 
                    contents: { parts }, 
                    config 
                });

                if (!response) throw new Error('Empty response from API');
                if (!response.candidates || response.candidates.length === 0) {
                    throw new Error('No candidates in API response');
                }
                
                const candidate = response.candidates[0];
                
                if (candidate.finishReason === "SAFETY") {
                    const safetyError = new Error("Image blocked by safety filters. Try rephrasing the prompt.");
                    safetyError.name = "SafetyError";
                    throw safetyError;
                }

                if (candidate.finishReason && candidate.finishReason !== "STOP") {
                    console.warn("Unexpected finish reason:", candidate.finishReason, candidate);
                    throw new Error(`Image generation blocked: ${candidate.finishReason}. Try simplifying your prompt.`);
                }
                
                const part = candidate.content?.parts?.find((p: any) => p.inlineData);
                
                if (!part?.inlineData?.data) {
                    throw new Error('No image data in API response parts');
                }
                
                const imageData = part.inlineData.data;
                const mimeType = part.inlineData.mimeType || 'image/png';
                
                console.log(`✅ Image generated successfully via Gemini Content (${imageData.length} bytes)`);
                
                deductCredits(CREDIT_COSTS.IMAGE_GENERATION_GEMINI, 'image').catch(console.error);
                
                return { base64: imageData, mimeType, engine: 'google' };
            }
            
        } catch (error: any) {
            const isLastAttempt = attempt === maxRetries;
            const errorMsg = String(error?.message || error || '');
            
            const isPrepaymentDepleted = /prepayment.*depleted|credits are depleted|billing#prepay|prepay/i.test(errorMsg);
            if (isPrepaymentDepleted) {
                const prepayMsg = 'Your Google AI Studio prepayment credits are depleted. Please visit https://ai.studio/projects to add credits, or enter a new Gemini API key in Settings.';
                console.error(`💳 [Gemini Image Billing Error]: ${prepayMsg}`);
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
                return { engine: 'google', error: prepayMsg };
            }

            const isRateLimit = /429|rate limit|quota|resource.*exhausted/i.test(errorMsg);
            
            if (isRateLimit) {
                const backoffTime = Math.min(30000, 3000 * Math.pow(2, attempt - 1));
                console.warn(`⚠️ Rate limit detected. Backing off ${backoffTime/1000}s...`);
                if (!isLastAttempt) {
                    await new Promise(resolve => setTimeout(resolve, backoffTime));
                    continue;
                }
            }
            
            if (error.message?.includes('api key not valid') ||
                error.message?.includes('unauthorized') ||
                error.message?.includes('forbidden') ||
                error.message?.includes('PERMISSION_DENIED') ||
                error.message?.includes('permission')) {
                return { engine: 'google', error: error.message };
            }

            if (error.name === 'SafetyError') {
                if (!isLastAttempt) {
                    console.warn('Shield: Safety block — retrying with stripped cinematic fallback prompt...');
                    const stripped = finalPrompt
                        .replace(/ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*\([^)]+\)/g, '')
                        .replace(/ (?:student|young person|child|girl|boy|man|woman|person) /gi, 'figure')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    const cinematic = stripped || 'Cinematic environmental shot, soft directional light, warm tones, documentary style';
                    try {
                        const retryResult = await runImageGeneration(cinematic, aspectRatio, model, undefined, 1);
                        if (retryResult.base64) return retryResult;
                    } catch (retryErr) {
                        console.warn('Cinematic fallback image generation attempt failed:', retryErr);
                    }
                }
                return { engine: 'google', error: error.message };
            }
            
            if (isLastAttempt) {
                return { engine: 'google', error: error.message };
            }
            
            const delay = 2000 * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying image generation in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { engine: 'google', error: 'Failed after all retries' };
}

export async function generateWithStability(
    prompt: string,
    aspectRatio: AspectRatio,
    apiKeyOverride?: string
): Promise<{ base64?: string, mimeType?: string, engine: string, error?: any }> {
    const apiKey = apiKeyOverride || getStabilityApiKey();
    if (!apiKey) {
        return { engine: 'stability', error: 'No Stability AI API key configured.' };
    }

    try {
        const cleanPrompt = sanitizeImagePrompt(prompt);
        let stabilityRatio = '16:9';
        if (aspectRatio === '1:1') stabilityRatio = '1:1';
        else if (aspectRatio === '9:16') stabilityRatio = '9:16';
        else if (aspectRatio === '4:3') stabilityRatio = '5:4';
        else if (aspectRatio === '3:4') stabilityRatio = '4:5';

        try {
            const formData = new FormData();
            formData.append('prompt', cleanPrompt);
            formData.append('aspect_ratio', stabilityRatio);
            formData.append('output_format', 'jpeg');
            formData.append('mode', 'text-to-image');

            const coreRes = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Accept': 'application/json'
                },
                body: formData
            });

            if (coreRes.ok) {
                const data = await coreRes.json();
                if (data.image) {
                    console.log('✅ Image generated successfully via Stability AI (Core)');
                    return {
                        base64: data.image,
                        mimeType: 'image/jpeg',
                        engine: 'Stability AI (Core)'
                    };
                }
            } else {
                console.warn(`Stability Core returned status ${coreRes.status}, attempting SDXL v1 fallback...`);
            }
        } catch (coreErr) {
            console.warn('Stability Core attempt failed:', coreErr);
        }

        let width = 1024;
        let height = 576;
        if (aspectRatio === '1:1') { width = 1024; height = 1024; }
        else if (aspectRatio === '9:16') { width = 576; height = 1024; }
        else if (aspectRatio === '4:3') { width = 1024; height = 768; }
        else if (aspectRatio === '3:4') { width = 768; height = 1024; }

        const v1Res = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                text_prompts: [{ text: cleanPrompt, weight: 1 }],
                cfg_scale: 7,
                height,
                width,
                samples: 1,
                steps: 30
            })
        });

        if (!v1Res.ok) {
            const errData = await v1Res.json().catch(() => ({}));
            throw new Error(errData.message || `Stability API returned HTTP ${v1Res.status}`);
        }

        const data = await v1Res.json();
        const artifact = data.artifacts?.[0];
        if (!artifact?.base64) {
            throw new Error('No image artifact returned from Stability AI');
        }

        console.log('✅ Image generated successfully via Stability AI (SDXL)');
        return {
            base64: artifact.base64,
            mimeType: 'image/jpeg',
            engine: 'Stability AI (SDXL)'
        };
    } catch (err: any) {
        console.warn('Stability AI generation failed:', err);
        return { engine: 'stability', error: err.message || 'Stability generation failed' };
    }
}

export async function generateWithPollinations(
    prompt: string,
    aspectRatio: AspectRatio
): Promise<{ base64?: string, mimeType?: string, engine: string, error?: any }> {
    try {
        let width = 1280;
        let height = 720;
        if (aspectRatio === '1:1') { width = 1024; height = 1024; }
        else if (aspectRatio === '9:16') { width = 720; height = 1280; }
        else if (aspectRatio === '4:3') { width = 1024; height = 768; }
        else if (aspectRatio === '3:4') { width = 768; height = 1024; }

        const cleanPrompt = sanitizeImagePrompt(prompt).replace(/[^\w\s,.-]/g, '');
        const encodedPrompt = encodeURIComponent(cleanPrompt.substring(0, 400) || 'cinematic masterpiece photo');
        const seed = Math.floor(Math.random() * 1000000);
        const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
        const blob = await res.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        return {
            base64,
            mimeType: blob.type || 'image/jpeg',
            engine: 'Pollinations AI (Quota-Free)'
        };
    } catch (err: any) {
        console.warn('Pollinations generation failed:', err);
        return { engine: 'pollinations', error: err.message };
    }
}

export async function generateImageWithFallback(
    prompt: string,
    aspectRatio: AspectRatio,
    model: string,
    referenceImage?: { data: string, mimeType: string },
    maxRetries: number = 3
): Promise<{ base64?: string, mimeType?: string, engine: string, error?: any }> {
    const finalModel = model || 'gemini-3.1-flash-lite-image';
    const result = await runImageGeneration(prompt, aspectRatio, finalModel, referenceImage, maxRetries);

    if (result.error && !result.base64) {
        if (result.engine === 'system-disabled') {
            return result;
        }

        const errorMsg = String(result.error).toLowerCase();
        const isSafetyError = errorMsg.includes('safety') || errorMsg.includes('blocked');

        const stabilityKey = getStabilityApiKey();

        if (result.engine === 'gemini-web' && !isSafetyError) {
            if (stabilityKey) {
                console.warn('⚡ Gemini Web cookie proxy failed. Attempting user-configured Stability AI fallback...');
                const stabRes = await generateWithStability(prompt, aspectRatio, stabilityKey);
                if (stabRes.base64) {
                    try {
                        const uiModule = await import('../ui');
                        if (uiModule && typeof uiModule.showStatus === 'function') {
                            uiModule.showStatus('⚡ Switched to Stability AI image generation!', false, 5000);
                        }
                    } catch {}
                    return stabRes;
                }
            }

            console.warn('⚡ Triggering Pollinations AI (Flux) fallback...');
            const pollRes = await generateWithPollinations(prompt, aspectRatio);
            if (pollRes.base64) {
                try {
                    const uiModule = await import('../ui');
                    if (uiModule && typeof uiModule.showStatus === 'function') {
                        uiModule.showStatus('⚡ Gemini Cookie proxy unavailable. Switched to Pollinations AI (Flux)!', false, 6000);
                    }
                } catch (uiErr) {
                    console.warn('Could not display fallback status notification:', uiErr);
                }
                return pollRes;
            }
        }

        if (!isSafetyError) {
            const nextModel = IMAGE_MODEL_FALLBACKS[finalModel];
            if (nextModel) {
                console.warn(`🚨 Model ${finalModel} failed: "${result.error}". Falling back to ${nextModel}...`);
                
                const dropdown = document.getElementById('image-model') as HTMLSelectElement | null;
                if (dropdown) {
                    dropdown.value = nextModel;
                    dropdown.dispatchEvent(new Event('change'));
                }

                try {
                    const uiModule = await import('../ui');
                    if (uiModule && typeof uiModule.showStatus === 'function') {
                        uiModule.showStatus(`Model ${finalModel} limit reached. Switching to ${nextModel}...`, true, 5000);
                    }
                } catch (e) {
                    console.error('Failed to show fallback status notification:', e);
                }

                return generateImageWithFallback(prompt, aspectRatio, nextModel, referenceImage, maxRetries);
            } else {
                if (stabilityKey) {
                    console.warn('⚡ Gemini image quota exhausted. Falling back to Stability AI (key configured)...');
                    const stabRes = await generateWithStability(prompt, aspectRatio, stabilityKey);
                    if (stabRes.base64) {
                        try {
                            const uiModule = await import('../ui');
                            if (uiModule && typeof uiModule.showStatus === 'function') {
                                uiModule.showStatus('⚡ Gemini quota reached. Switched to Stability AI!', false, 5000);
                            }
                        } catch {}
                        return stabRes;
                    }
                }

                console.warn('⚡ Gemini image models exhausted or quota hit. Using Pollinations AI fallback...');
                const pollRes = await generateWithPollinations(prompt, aspectRatio);
                if (pollRes.base64) {
                    try {
                        const uiModule = await import('../ui');
                        if (uiModule && typeof uiModule.showStatus === 'function') {
                            uiModule.showStatus('⚡ Switched to Pollinations AI (Flux) fallback!', false, 6000);
                        }
                    } catch (uiErr) {
                        console.warn('Could not display quota fallback notification:', uiErr);
                    }
                    return pollRes;
                }
            }
        }
    }

    if (result.base64) {
        const cleaned = cleanBase64Image(result.base64);
        if (cleaned.result.removedItems.length > 0) {
            console.log(`🛡️ [C2PA Stripper] Cleaned ${cleaned.result.removedItems.length} provenance item(s) from generated image (${cleaned.result.removedBytes} bytes stripped)`);
        }
        return {
            ...result,
            base64: cleaned.base64
        };
    }

    return result;
}

export async function editImageWithGemini(
    sourceImage: { data: string, mimeType: string },
    editInstruction: string,
    aspectRatio: AspectRatio = '16:9',
    model: string = 'gemini-3.1-flash-lite-image'
): Promise<{ base64?: string, mimeType?: string, engine: string, error?: any }> {
    const hasPersonalKey = isUsingPersonalKey(true);
    if (!isImageGenAllowedForCurrentUser()) {
        return {
            engine: 'access-denied',
            error: 'Image editing access is disabled for your account. Please ask an administrator to grant you Image Generation Access in the Admin Panel or configure your personal Gemini API key in Settings.'
        };
    }
    if (state.systemConfig?.disableSystemImageGeneration && !hasPersonalKey) {
        return {
            engine: 'system-disabled',
            error: 'Image editing on the shared system API has been disabled by the administrator. Please configure your personal Gemini API key or Cookie in Advanced Settings.'
        };
    }

    const cost = CREDIT_COSTS.IMAGE_GENERATION_GEMINI;
    await checkCredits(cost, 'image');

    const apiKey = getApiKey();
    let finalModel = model || 'gemini-3.1-flash-lite-image';
    const auth = getEffectiveGeminiAuth();
    if ((auth.provider === 'vertex' || auth.mode === 'adc') && !finalModel.startsWith('imagen-') && (finalModel.includes('flash-lite') || finalModel === 'gemini-3.1-flash-lite-image')) {
        finalModel = 'gemini-3.1-flash-image';
    }

    const sanitizedInstruction = sanitizeImagePrompt(editInstruction);

    const prompt = `Based on the provided image, edit and re-imagine it according to these instructions: ${sanitizedInstruction}. Retain overall composition unless specified otherwise.`;

    try {
        const ai = createGoogleGenAIClient(apiKey);
        const parts: any[] = [
            { inlineData: sourceImage },
            { text: prompt }
        ];

        const config: any = { imageConfig: { aspectRatio } };
        if (finalModel === 'gemini-3.1-flash-image' || finalModel === 'gemini-3-pro-image') {
            config.imageConfig.imageSize = "1K";
        }

        const response = await ai.models.generateContent({
            model: finalModel,
            contents: { parts },
            config
        });

        if (!response || !response.candidates || response.candidates.length === 0) {
            throw new Error('No candidates returned from Gemini API');
        }

        const candidate = response.candidates[0];
        if (candidate.finishReason === "SAFETY") {
            throw new Error("Image edit blocked by safety filters. Try rephrasing your instructions.");
        }

        const part = candidate.content?.parts?.find((p: any) => p.inlineData);
        if (!part?.inlineData?.data) {
            return generateImageWithFallback(`${sanitizedInstruction} (cinematic art, high quality)`, aspectRatio, finalModel, sourceImage);
        }

        deductCredits(cost, 'image').catch(console.error);

        const cleaned = cleanBase64Image(part.inlineData.data);
        return {
            base64: cleaned.base64,
            mimeType: part.inlineData.mimeType || 'image/png',
            engine: 'google-edit'
        };
    } catch (error: any) {
        console.warn('Direct image edit fallback triggered:', error?.message);
        return generateImageWithFallback(`${sanitizedInstruction} (detailed art style)`, aspectRatio, finalModel, sourceImage);
    }
}