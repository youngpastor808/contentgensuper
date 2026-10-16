import { audioBufferToWavBlob, safeJsonStringify } from '../utils-core';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import * as dom from '../dom';
import * as ui from '../ui';
import { generateSfx } from '../api/audio';
import { generateImageWithFallback } from '../api/images';
import { generateVeoStyleVideoPrompt, generateVideo } from '../api/video';
import { isUsingPersonalKey, getApiKey, generateContentWithFallback, getEffectiveGeminiAuth } from '../api/core';
import { batchAnalyzeScenesForCharacter } from '../api/characters';
import * as utils from '../utils';
import * as constants from '../constants';
import { saveVersion, syncStateFromDOM } from '../handlers-project';
import { isImageGenAllowedForCurrentUser, checkGuestRestriction, currentUser, setUserRecord } from '../auth';
import { db, auth as firebaseAuth } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { AspectRatio } from '../types';
import { renderBatch, renderSceneBatch } from '../ui';
import { updateVideoContext } from '../videoController';
import { drawVideoFrame } from '../videoRenderer';
import { assetStorage } from '../assetStorage';
import { buildScenePromptWithCharacterContext } from '../handlers-assets';
import { syncShotMediaToTimeline } from './timeline-sync';
import { safelyReplaceShotMedia, removeSecondaryMedia } from '../memoryManager';
import { dropDepth } from '../parallax/depth';

let imageGenerationQueue: Promise<any> = Promise.resolve();

// Image generation deduplication cache
const imageRequestCache = new Map<string, Promise<any>>();

export function getImageRequestKey(prompt: string, aspectRatio: string, model: string): string {
    return `${model}:${aspectRatio}:${utils.simpleHash(prompt)}`;
}

export async function deduplicatedImageRequest<T>(
    key: string,
    requestFn: () => Promise<T>
): Promise<T> {
    if (imageRequestCache.has(key)) {
        console.log(`🔄 Reusing image request: ${key.substring(0, 50)}...`);
        return imageRequestCache.get(key)!;
    }

    const requestPromise = requestFn()
        .finally(() => {
            setTimeout(() => imageRequestCache.delete(key), 3000);
        });

    imageRequestCache.set(key, requestPromise);
    return requestPromise;
}

// Circuit breaker for image generation
export const imageCircuitBreaker = {
    failures: 0,
    lastFailureTime: 0,
    resetTimeout: 120000, // 2 minutes
    threshold: 5,
    
    isOpen(): boolean {
        const timeSinceLastFailure = Date.now() - this.lastFailureTime;
        
        // Reset if enough time has passed
        if (timeSinceLastFailure > this.resetTimeout) {
            this.failures = 0;
            return false;
        }
        
        return this.failures >= this.threshold;
    },
    
    recordFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();
    },
    
    recordSuccess(): void {
        this.failures = Math.max(0, this.failures - 1);
    }
};

/**
 * Resets the image circuit breaker failures to 0.
 */
export function resetImageCircuitBreaker() {
    imageCircuitBreaker.failures = 0;
    imageCircuitBreaker.lastFailureTime = 0;
}

/**
 * Helper to get a safe title for filenames, falling back if API fails.
 */
export function getSafeFilenameTitle(): string {
    if (!dom.storyInput.value || dom.storyInput.value.trim().length === 0) {
        return `storyboard_${new Date().toISOString().slice(0, 10)}`;
    }
    
    const words = dom.storyInput.value
        .trim()
        .split(/\s+/)
        .filter(w => w.length > 2) 
        .slice(0, 5)
        .join('_')
        .replace(/[^a-z0-9_]/gi, '')
        .slice(0, 40);
    
    return words || `storyboard_${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Generates an SFX for a specific shot.
 */
export async function generateSfxForShot(btn: HTMLButtonElement): Promise<{ success: boolean }> {
    const shotElement = btn.closest('.prompt-item') as HTMLElement;
    if (!shotElement) return { success: false };

    const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
    const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const scene = state.currentScenes[sceneIndex];
    const lines = scene?.lines || [scene];
    const shot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];

    if (!shot) return { success: false };

    const promptInput = shotElement.querySelector('.sfx-prompt-input') as HTMLInputElement;
    const prompt = promptInput.value.trim();
    if (!prompt) {
        ui.showStatus('Please enter an SFX prompt.', true, 3000);
        return { success: false };
    }

    const originalBtnHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;

    try {
        ui.showStatus('Generating SFX...', false, 0);
        
        let provider: 'freesound' | 'gemini' | 'elevenlabs' = 'gemini';
        if (state.freesoundApiKey) provider = 'freesound';
        else if (state.elevenlabsApiKey) provider = 'elevenlabs';

        const buffer = await generateSfx(prompt, provider);
        
        // Store in shot
        shot.sfx_prompt = prompt;
        shot._sfxBuffer = buffer;
        
        // Convert buffer to object URL for storage/playback if needed
        const wavBlob = await audioBufferToWavBlob(buffer);
        shot._sfxObjectURL = URL.createObjectURL(wavBlob);
        
        // Save to asset storage
        const assetId = await assetStorage.storeAsset(wavBlob, 'audio', 'current_project');
        shot.sfx_id = assetId;

        // Update timeline clip if it exists
        const timelineClip = timelineState.clips.find(c => c.id === shot.id);
        if (timelineClip) {
            timelineClip._sfxBuffer = buffer;
        }

        ui.showStatus('SFX generated successfully!', false, 3000);
        
        // Re-render the shot to update UI
        if (isPaced) {
            renderBatch(state.currentScenes, Math.floor(lineIndex / 25));
        } else {
            renderSceneBatch(sceneIndex, state.currentScenes[sceneIndex].lines, Math.floor(lineIndex / 25));
        }
        
        saveVersion(false);
        return { success: true };
    } catch (error) {
        console.error('SFX generation failed:', error);
        ui.showStatus(`SFX failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true, 5000);
        btn.innerHTML = originalBtnHtml;
        return { success: false };
    } finally {
        btn.disabled = false;
    }
}

/**
 * Generates an image for a specific shot, using a queue to prevent race conditions.
 */
export async function generateImageForShot(btn: HTMLButtonElement, isBulkCall: boolean = false): Promise<{ success: boolean, aborted?: boolean }> {
    if (checkGuestRestriction("Generating image")) return { success: false, aborted: true };
    const shotElement = btn.closest('.prompt-item') as HTMLElement;
    if (!shotElement) return { success: false };

    // Check circuit breaker before anything else
    if (imageCircuitBreaker.isOpen()) {
        const error = new Error('Image generation is temporarily unavailable. Too many recent failures. Please wait 2 minutes and try again.');
        const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
        imgContainer.innerHTML = `<div class="text-red-400 text-xs p-2 text-center">${ui.escapeHtml(error.message)}</div>`;
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return { success: false };
    }

    // Check if the selected model is professional / premium and the user is using the shared key
    const modelForPrompt = dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL;
    const isPremiumModel = ['gemini-3-pro-image', 'gemini-3.1-flash-image'].includes(modelForPrompt);
    const auth = getEffectiveGeminiAuth();
    const isAdcOrVertex = auth.provider === 'vertex' || auth.mode === 'adc';
    const isPersonalKey = isUsingPersonalKey(true);
    const hasPersonalKeyOrAdc = isPersonalKey || isAdcOrVertex;

    // Real-time live pre-flight permissions check against Firestore for system API users
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
            console.debug('Pre-flight live permission sync note:', err);
        }
    }

    if (!isImageGenAllowedForCurrentUser()) {
        const errorMsg = 'Image generation access is disabled for your account. Please ask an administrator to grant you Image Generation Access in the Admin Panel or configure your personal Gemini API key in Settings.';
        ui.showStatus(errorMsg, true, 6000);
        const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
        if (imgContainer) {
            imgContainer.innerHTML = `<div class="text-amber-400 text-xs p-2 text-center">${ui.escapeHtml(errorMsg)}</div>`;
        }
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return { success: false };
    }

    // Global admin setting: disable image generation when users are using the system API
    if (state.systemConfig?.disableSystemImageGeneration && !isPersonalKey) {
        const errorMsg = 'Image generation on the system API is disabled by the administrator. Please add your personal Gemini API key or Cookie in Advanced Settings to generate images.';
        ui.showStatus(errorMsg, true, 6000);
        const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
        if (imgContainer) {
            imgContainer.innerHTML = `<div class="text-amber-400 text-xs p-2 text-center">${ui.escapeHtml(errorMsg)}</div>`;
        }
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return { success: false };
    }

    if (isPremiumModel && !hasPersonalKeyOrAdc) {
        const errorMsg = 'To use this model, please set up your paid API key under Advanced Settings in the sidebar.';
        ui.showStatus(errorMsg, true, 6000);
        const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
        imgContainer.innerHTML = `<div class="text-amber-400 text-xs p-2 text-center">${ui.escapeHtml(errorMsg)}</div>`;
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return { success: false };
    }

    // This setup code is safe to run in parallel.
    const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
    const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);

    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    let shot: any;
    if (isPaced) {
        shot = state.currentScenes[lineIndex];
    } else {
        const scene = state.currentScenes[sceneIndex];
        const lines = scene?.lines || [scene];
        shot = lines?.[lineIndex];
    }

    if (!shot) return { success: false };

    const promptTextarea = shotElement.querySelector('.prompt-textarea') as HTMLTextAreaElement;
    const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
    
    const shotPrompt = promptTextarea.value;
    const stylePrompt = ui.getCurrentStylePrompt();

    if (shot && shot._styleUsed && shot._styleUsed !== stylePrompt) {
        ui.showStatus('⚠️ This scene was made with a different style — regenerating will mix styles.', true, 4000);
    }

    // New "Style Intent" logic to prevent style contamination
    const styleIntent = constants.styleIntentMap[stylePrompt] || constants.StyleIntent.CINEMATIC;
    const intentNegativePrompt = constants.INTENT_NEGATIVE_PROMPTS[styleIntent] || '';
    
    let sceneDescription = shotPrompt;
    
    const sceneWantsText = /\b(sign|note|poster|reads|says|written|text|neon|billboard|letter)\b/i.test(sceneDescription);
    const baseNegative = (state.textOverlayEnabled && sceneWantsText)
        ? constants.NEGATIVE_PROMPT.replace(/text,\s*/i, '')
        : constants.NEGATIVE_PROMPT;

    const combinedNegativePrompt = [baseNegative, intentNegativePrompt].filter(Boolean).join(', ');
    
    if (state.characterTimeline) {
        if (shot._analyzedPrompt === shotPrompt && shot.sceneDescriptionWithCharacter) {
            sceneDescription = shot.sceneDescriptionWithCharacter;
        } else {
            const result = await buildScenePromptWithCharacterContext(
                shotPrompt,
                state.characterTimeline
            );
            sceneDescription = result.description;
            shot.characterMetadata = result.metadata; 
            shot._analyzedPrompt = shotPrompt;
            shot.sceneDescriptionWithCharacter = sceneDescription;
        }
    } else {
        // Character consistency injection: check both shot prompt and narration text
        const charactersToInject = state.characterProfiles.filter(p => {
            if (p.is_universal) return true;
            if (p.enforce_consistency === false) return false;
            if (!p._nameRegex) {
                p._nameRegex = utils.buildCharacterRegex(p, state.characterProfiles);
            }
            const inPrompt = p._nameRegex.test(shotPrompt);
            const inNarration = Boolean(shot?.text_reference && p._nameRegex.test(shot.text_reference));
            return inPrompt || inNarration;
        });
        if (charactersToInject.length > 0) {
            // Avoid duplicate injection if character appearance is already present
            const missingFromPrompt = charactersToInject.filter(p => {
                const anchor = (p.appearance_anchor || '').trim();
                return !anchor || !sceneDescription.includes(anchor);
            });
            if (missingFromPrompt.length > 0) {
                const consistencyText = missingFromPrompt.map(p => `${p.name} (${p.appearance_anchor})`).join(', ');
                sceneDescription = `Featuring: ${consistencyText}. ${sceneDescription}`;
            }
        }
    }

    // Location consistency (smart detection with fallback)
    const locationsToInject = state.locationProfiles.filter(l => 
      l.enforce_consistency !== false && 
      l._nameRegex && 
      l._nameRegex.test(shotPrompt)
    );

    if (locationsToInject.length > 0) {
      const locationText = locationsToInject
        .map(l => `${l.name}: ${l.description}`)
        .join(', ');
      sceneDescription = `Setting: ${locationText}. ${sceneDescription}`;
    } else if (state.locationProfiles.length > 0) {
      // Fallback to primary if none detected
      const primary = state.locationProfiles[0];
      sceneDescription = `Setting: ${primary.description}. ${sceneDescription}`;
    }
    
    // Element consistency (inject when detected)
    const elementsToInject = state.keyElementProfiles.filter(e => 
      e.enforce_consistency !== false && 
      e._nameRegex && 
      e._nameRegex.test(shotPrompt)
    );

    if (elementsToInject.length > 0) {
      const elementText = elementsToInject
        .map(e => `${e.name}: ${e.description}`)
        .join(', ');
      sceneDescription = `Key elements: ${elementText}. ${sceneDescription}`;
    }

    // Camera angle
    const cameraAngleSelect = shotElement.querySelector('.camera-angle-select') as HTMLSelectElement | null;
    const cameraAngle = (shot && shot.camera_angle) || (cameraAngleSelect ? cameraAngleSelect.value : 'default');
    const bulkCameraAngle = dom.bulkCameraAngleSelect ? dom.bulkCameraAngleSelect.value : 'per-shot';
    const selectedAngle = (cameraAngle && cameraAngle !== 'default') ? cameraAngle : (bulkCameraAngle !== 'per-shot' ? bulkCameraAngle : null);
    if (selectedAngle && selectedAngle !== 'default') {
        sceneDescription = `${selectedAngle} of ${sceneDescription}`;
    }
    
    // Build the final structured prompt
    const modelForPromptLocal = dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL;
    let finalPrompt = utils.buildPromptForModel(
        stylePrompt,
        sceneDescription,
        modelForPromptLocal,
        combinedNegativePrompt,
        styleIntent,
        ui.getCurrentCharacterModifier()
    );
    
    // Safety rephrasing
    if (state.safeRephraseEnabled) {
        const rephrased = utils.safeRephrase(finalPrompt);
        if (rephrased.rewritten) {
            finalPrompt = rephrased.newPrompt;
        }
    }
    
    // Truncation
    finalPrompt = utils.truncatePrompt(finalPrompt);

    btn.disabled = true;
    btn.innerHTML = `<span class="inline-block w-3 h-3 rounded-full border-2 border-slate-950 border-t-amber-400 animate-spin"></span>`;
    imgContainer.innerHTML = `
        <div class="relative w-full h-full bg-slate-950 overflow-hidden flex flex-col justify-between p-2.5 rounded-lg border border-amber-500/30 shadow-inner z-10 select-none">
            <div class="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 animate-pulse"></div>
            <div class="relative z-10 flex justify-between items-center text-[10px] font-mono text-amber-300 font-semibold bg-slate-900/90 px-2 py-0.5 rounded border border-amber-500/20 shadow">
                <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>Generating Image</span>
                <span>~5s est.</span>
            </div>
            <div class="relative z-10 w-full space-y-1">
                <div class="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-amber-500/20">
                    <div class="h-full bg-gradient-to-r from-amber-500 via-indigo-500 to-fuchsia-500 w-3/4 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.4)]"></div>
                </div>
                <div class="flex justify-between items-center text-[9px] font-mono text-slate-400">
                    <span>Synthesizing</span>
                    <span class="text-amber-400 font-bold">Rendering...</span>
                </div>
            </div>
        </div>
    `;

    // Chain the critical section (API call + state update) to the queue.
    const operationPromise = imageGenerationQueue.then(async () => {
        if (isBulkCall && !state.isBulkGenerating) {
            return { success: false, aborted: true };
        }

        const model = dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL;
        const aspectRatio = dom.imageResolutionSelect.value as AspectRatio;

        const requestKey = getImageRequestKey(finalPrompt, aspectRatio, model);
        let result: { base64?: string, mimeType?: string, engine: string, error?: any };

        try {
            result = await deduplicatedImageRequest(
                requestKey,
                () => generateImageWithFallback(finalPrompt, aspectRatio, model, state.selectedReferenceImage)
            );
        } catch (error) {
            imageCircuitBreaker.recordFailure();
            throw error; // Re-throw for outer catch
        }
        
        if (result.base64) {
            imageCircuitBreaker.recordSuccess();
            
            // CONVERT TO BLOB AND STORE IN INDEXEDDB
            const blob = utils.base64ToBlob(result.base64, result.mimeType || 'image/png');
            const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
            
            safelyReplaceShotMedia(shot, blob, 'image');
            shot.image_id = assetId;
            shot.imageMimeType = result.mimeType;
            shot._styleUsed = stylePrompt;
            shot.imageEngine = result.engine;
            shot.prompt_source_text = shot.text_reference || shot.line_text;
            
            imgContainer.innerHTML = `<div class="absolute inset-0 group">
                <img src="${shot._imageObjectURL}" class="w-full h-full object-cover rounded-lg cursor-pointer generated-img" data-id="${shot.id}" alt="Generated storyboard image">
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-opacity flex items-center justify-center rounded-lg">
                    <span class="text-white text-xs font-bold opacity-0 group-hover:opacity-100">${result.engine === 'stability' ? 'Fallback' : 'Google'}</span>
                </div>
            </div>`;
            
            const timelineClip = timelineState.clips?.find(c => c.id === shot.id);
            if (timelineClip) {
                const img = new Image();
                img.onload = () => {
                    timelineClip.image = img;
                    ui.renderTimelineEditor();
                };
                img.src = shot._imageObjectURL;
            }

            // --- B-ROLL PUNCTUATION SECONDARY GENERATION ---
            if (shot.b_roll_prompt && typeof shot.b_roll_prompt === 'string' && shot.b_roll_prompt.trim().length > 0) {
                try {
                    const bRollPromptText = shot.b_roll_prompt.trim();
                    let finalBRollPrompt = utils.buildPromptForModel(
                        stylePrompt,
                        bRollPromptText,
                        modelForPromptLocal,
                        combinedNegativePrompt,
                        styleIntent,
                        ui.getCurrentCharacterModifier()
                    );
                    if (state.safeRephraseEnabled) {
                        const rephrased = utils.safeRephrase(finalBRollPrompt);
                        if (rephrased.rewritten) finalBRollPrompt = rephrased.newPrompt;
                    }
                    finalBRollPrompt = utils.truncatePrompt(finalBRollPrompt);

                    const bRollResult = await generateImageWithFallback(finalBRollPrompt, aspectRatio, modelForPromptLocal, state.selectedReferenceImage);
                    
                    if (bRollResult.base64) {
                        const bRollBlob = utils.base64ToBlob(bRollResult.base64, bRollResult.mimeType || 'image/png');
                        const bRollAssetId = await assetStorage.storeAsset(bRollBlob, 'image', 'current_project');
                        const bRollObjectURL = URL.createObjectURL(bRollBlob);
                        
                        state.bRollSourceRegistry.set(shot.id + '_broll', {
                            imageObjectURL: bRollObjectURL,
                            label: `B-Roll: ${bRollPromptText.substring(0, 15)}...`
                        });
                        
                        const uiAny = ui as any;
                        if (typeof uiAny.renderBrollSources === 'function') {
                            uiAny.renderBrollSources();
                        }
                    }
                } catch (bRollError) {
                    console.warn("Failed to generate secondary B-roll image:", bRollError);
                }
            }
            // -----------------------------------------------

            saveVersion();
            await syncShotMediaToTimeline(shot);
            ui.updateStoryboardStats();
            if (dom.videoDirectorBtn.disabled) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
                ui.updateWorkflowStepStatus(3, 'completed');
                ui.updateWorkflowStepStatus(4, 'active');
            }
            return { success: true };
        } else {
            imageCircuitBreaker.recordFailure();
            const errorMessage = String(result.error).toLowerCase();
            let userMessage = `Error: ${result.error || "Unknown error occurred."}`;

            if (errorMessage.includes('unknown') || errorMessage.includes('xhr error')) {
                userMessage = `The AI server returned a temporary error. This is usually a transient issue. Please try again in a moment. If the problem persists, try a different image model.`;
            } else if (errorMessage.includes('api key not valid')) {
                userMessage = `Your API Key is not valid. Please check it in the Advanced Settings or select a new one for Gemini Pro models.`;
            } else if (errorMessage.includes('quota')) {
                userMessage = `You've exceeded your API quota. Please check your billing or wait before trying again.`;
            } else if (errorMessage.includes('blocked by api policy') || errorMessage.includes('safety')) {
                userMessage = `Your prompt was blocked for safety reasons. Please rephrase it.`;
            } else if (errorMessage.includes('requested entity was not found')) {
                userMessage = `The selected API Key was not found or is invalid. Please select a valid key from a paid GCP project.`;
            }
            throw new Error(userMessage);
        }
    });
    
    // The queue is now this new operation. We catch any errors so the queue never enters a permanently rejected state.
    imageGenerationQueue = operationPromise.catch(() => {});

    // The function waits for its turn in the queue to complete.
    try {
        const result = await operationPromise;
        if (result && result.aborted) {
            imgContainer.innerHTML = '';
            btn.disabled = false;
            btn.innerHTML = `Image`;
            return { success: false, aborted: true };
        }
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return result as { success: boolean };
    } catch (error: any) {
        // Handle errors for this specific shot's UI.
        const isQuota = error?.message?.toLowerCase().includes('quota');
        if (isQuota) {
            imgContainer.innerHTML = `<div class="text-blue-400 text-xs p-2 text-center">Notice: ${ui.escapeHtml(error.message)}</div>`;
        } else {
            imgContainer.innerHTML = `<div class="text-red-400 text-xs p-2 text-center">${ui.escapeHtml(error.message)}</div>`;
        }
        btn.disabled = false;
        btn.innerHTML = `Image`;
        return { success: false };
    }
}

export async function handleBulkAnimate() {
    if (checkGuestRestriction("Bulk Video Animation")) return;
    const select = dom.bulkAnimateSelect;
    const value = select.value;
    
    // Find all shots that have an image but no video yet
    const allShots = Array.from(dom.resultsContainer.querySelectorAll('.prompt-item'))
        .filter(el => {
            const img = el.querySelector('.generated-img');
            const vid = el.querySelector('.generated-video');
            return img && !vid;
        });
        
    let shotsToAnimate = allShots;
    if (value === 'first-5') shotsToAnimate = allShots.slice(0, 5);
    if (value === 'first-10') shotsToAnimate = allShots.slice(0, 10);
    
    if (shotsToAnimate.length === 0) {
        ui.showStatus('No images available to animate.', true, 3000);
        return;
    }
    
    ui.showStatus(`Starting animation for ${shotsToAnimate.length} clips...`, false, 3000);
    
    for (const shotEl of shotsToAnimate) {
        const animateBtn = shotEl.querySelector('.animate-btn') as HTMLButtonElement;
        if (animateBtn && !animateBtn.disabled) {
            // Trigger the click handler for the individual animate button
            animateBtn.click();
            // Optional: Add a small delay between requests to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

export async function handleAnimateBtnClick(event: Event) {
    if (checkGuestRestriction("Animating Video Clips")) return;
    const target = event.target as HTMLElement;
    const animateBtn = target.closest('.animate-btn') as HTMLButtonElement;
    
    if (!animateBtn || animateBtn.disabled) return;
    
    const shotEl = animateBtn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    
    const sceneIndex = parseInt(shotEl.dataset.sceneIndex || '0', 10);
    const lineIndex = parseInt(shotEl.dataset.lineIndex || '0', 10);
    
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];
    if (!shot) return;
    
    // Set animating state
    shot._isAnimating = true;
    ui.renderResults(state.currentScenes);
    
    try {
        const videoModel = dom.videoModelSelect?.value || 'veo-3.1-lite-generate-001';
        
        // Auto-generate video prompt if it doesn't exist yet
        if (!shot.video_prompt) {
            ui.showStatus('Optimizing prompt for animation...', false, 0);
            const styleName = dom.imageStyleSelect ? dom.imageStyleSelect.options[dom.imageStyleSelect.selectedIndex]?.text : "The specified style";
            try {
                shot.video_prompt = await generateVeoStyleVideoPrompt(shot, styleName || "The specified style");
            } catch (e) {
                console.warn("Failed to auto-generate video prompt, falling back to basic prompt.", e);
            }
        }
        
        const prompt = shot.video_prompt || shot.image_prompt || shot.text_reference || shot.line_text || 'A cinematic shot';
        
        if (videoModel.startsWith('veo-')) {
            const hasPersonalKeyOrCookie = isUsingPersonalKey(true);
            if (!hasPersonalKeyOrCookie) {
                // @ts-ignore
                if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
                    // @ts-ignore
                    const hasKey = await window.aistudio.hasSelectedApiKey();
                    if (!hasKey) {
                        // @ts-ignore
                        if (typeof window.aistudio.openSelectKey === 'function') {
                            // @ts-ignore
                            await window.aistudio.openSelectKey();
                            // Assume success after triggering the dialog to avoid race conditions
                        } else {
                            throw new Error('Please select an API key to use Veo video generation.');
                        }
                    }
                }
            }
        }
        
        ui.showStatus('Generating video animation...', false, 0);
        
        let imagePart: { base64: string; mimeType: string } | undefined;
        if (shot.image_id) {
            try {
                const blob = await assetStorage.getAsset(shot.image_id);
                if (blob) {
                    const base64 = await utils.blobToBase64(blob);
                    // Remove the data URL prefix if present
                    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
                    imagePart = {
                        base64: base64Data,
                        mimeType: blob.type || 'image/jpeg'
                    };
                }
            } catch (e) {
                console.warn("Failed to load image for video generation", e);
            }
        }
        
        const result = await generateVideo(prompt, videoModel, imagePart);
        
        if (result.engine === 'veo' && result.uri) {
            const apiKey = getApiKey();
            const videoResponse = await fetch(result.uri, {
                method: 'GET',
                headers: {
                    'x-goog-api-key': apiKey,
                },
            });
            if (!videoResponse.ok) throw new Error('Failed to download Veo video');
            const videoBlob = await videoResponse.blob();
            const assetId = await assetStorage.storeAsset(videoBlob, 'video', 'current_project');
            safelyReplaceShotMedia(shot, videoBlob, 'video');
            shot.video_id = assetId;
        } else if (result.uri) {
            safelyReplaceShotMedia(shot, result.uri, 'video');
        } else if (result.base64) {
            const dataUrl = `data:${result.mimeType || 'video/mp4'};base64,${result.base64}`;
            const { data, mimeType } = utils.dataUrlToParts(dataUrl);
            const videoBlob = utils.base64ToBlob(data, mimeType);
            const assetId = await assetStorage.storeAsset(videoBlob, 'video', 'current_project');
            safelyReplaceShotMedia(shot, videoBlob, 'video');
            shot.video_id = assetId;
        } else {
            // Fallback for mock/unimplemented
            safelyReplaceShotMedia(shot, 'https://www.w3schools.com/html/mov_bbb.mp4', 'video');
        }
        
        saveVersion(false);
        await syncShotMediaToTimeline(shot);
        
        ui.showStatus(`Animated shot ${sceneIndex + 1}.${lineIndex + 1} successfully!`, false, 3000);
    } catch (error: any) {
        console.error('Animation error:', error);
        const errorMessage = String(error.message || error).toLowerCase();
        
        if (errorMessage.includes('permission_denied') || errorMessage.includes('requested entity was not found') || errorMessage.includes('403')) {
            const hasPersonalKeyOrCookie = isUsingPersonalKey(true);
            if (!hasPersonalKeyOrCookie) {
                ui.showStatus('API Key error. Please select a valid API key with billing enabled.', true, 5000);
                // @ts-ignore
                if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
                    // @ts-ignore
                    window.aistudio.openSelectKey();
                }
            } else {
                ui.showStatus('Authentication error. Please check your API key or cookies.', true, 5000);
            }
        } else {
            ui.showStatus(`Failed to animate shot: ${error.message}`, true, 5000);
        }
    } finally {
        shot._isAnimating = false;
        ui.renderResults(state.currentScenes);
    }
}

/**
 * Handles the "Magic Polish" button to enhance a specific shot prompt.
 */
export async function handleMagicPrompt(btn: HTMLButtonElement) {
    const shotElement = btn.closest('.prompt-item') as HTMLElement;
    if (!shotElement) return;

    const textarea = shotElement.querySelector('.prompt-textarea') as HTMLTextAreaElement;
    const currentPrompt = textarea.value.trim();
    if (!currentPrompt) return;

    const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
    const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
    
    const originalIcon = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<div class="loader small-loader" style="width: 12px; height: 12px; border-width: 2px;"></div>`;
    
    try {
        const styleName = dom.imageStyleSelect.options[dom.imageStyleSelect.selectedIndex]?.text || "Cinematic";
        const styleDescription = ui.getCurrentStylePrompt();
        
        const systemInstruction = `You are an expert Prompt Engineer for AI Image Generators. 
        Your task is to take a simple shot description and rewrite it into a highly detailed, vivid, and artistic prompt.
        
        Global Style to Apply: "${styleName}" (${styleDescription}).
        
        Rules:
        1. Keep the core subject and action of the shot. (CRITICAL: Ensure the subject itself is explicitly named in the output prompt. Never replace a specific subject like a character or animal with just a description of the background)
        2. Maintain Environmental Continuity: Do not change the underlying setting, time of day, or weather if it is already implied or stated.
        3. Temporal Isolation (No Spoilers): Only include visual elements that exist AT THIS EXACT MOMENT. Do not bleed future events into earlier shots (e.g., if a dry path blooms later, early shots must show a dry path).
        4. Subject-Appropriate Posture: If the subject is human, explicitly define micro-expressions and body language. If the subject is an animal or creature, rely ONLY on realistic, species-appropriate physical posture (e.g., 'antennae twitching') and STRICTLY AVOID human emotional facial expressions.
        5. Enhance lighting, texture, camera angle, and atmosphere using specific artistic terminology.
        6. AVOID generic AI buzzwords like "8K", "hyperrealistic", "trending on ArtStation", "masterpiece", or "ultra-detailed".
        7. Focus on physical properties: material textures, light scattering, color harmony, and lens characteristics (e.g., "anamorphic flare", "soft rim lighting", "tactile fabric weave").
        8. Ensure the output is a single, cohesive paragraph.
        9. Do NOT use markdown or conversational text. Just the raw prompt.
        `;

        const response = await generateContentWithFallback({
            model: constants.SECONDARY_MODEL, 
            contents: `Rewrite this shot description: "${currentPrompt}"`,
            systemInstruction
        });

        const newPrompt = response.text?.trim();
        if (newPrompt) {
            textarea.value = newPrompt;
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            if (isPaced) {
                if (state.currentScenes[lineIndex]) state.currentScenes[lineIndex].image_prompt = newPrompt;
            } else {
                if (state.currentScenes[sceneIndex]?.lines[lineIndex]) {
                    state.currentScenes[sceneIndex].lines[lineIndex].image_prompt = newPrompt;
                }
            }
            saveVersion(false);
            ui.showStatus("Prompt enhanced with magic!", false, 2000);
        }

    } catch (e: any) {
        ui.showStatus(`Magic Polish failed: ${e.message}`, true, 3000);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalIcon;
    }
}

/**
 * Handles the "Apply Edit" button click in the image modal.
 */
export async function handleImageEdit() {
    const editPrompt = dom.imageEditInput.value.trim();
    if (!editPrompt || !state.modalImageSrc) return;

    dom.imageEditBtn.disabled = true;
    dom.imageEditLoader.classList.remove('hidden');

    try {
        const referenceImage = { data: state.modalImageSrc, mimeType: state.modalImageMimeType! };
        const currentModel = dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL;
        const result = await generateImageWithFallback(editPrompt, '16:9', currentModel, referenceImage);

        if (result.base64) {
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            let shot: any;
            if (isPaced) {
                shot = state.currentScenes[state.modalImageShotIndex];
            } else {
                shot = state.currentScenes[state.modalImageSceneIndex]?.lines[state.modalImageShotIndex];
            }

            if (shot) {
                // Convert back to Blob for persistent storage
                const blob = utils.base64ToBlob(result.base64, result.mimeType || 'image/png');
                const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
                
                safelyReplaceShotMedia(shot, blob, 'image');
                shot.image_id = assetId;
                shot.imageMimeType = result.mimeType;
                shot.imageEngine = result.engine;
                
                dom.generatedImage.src = shot._imageObjectURL!;
                
                const shotElement = dom.resultsContainer.querySelector(`.prompt-item[data-scene-index="${state.modalImageSceneIndex}"][data-line-index="${state.modalImageShotIndex}"]`);
                if (shotElement) {
                    const imgContainer = shotElement.querySelector('.img-container') as HTMLDivElement;
                    const isPacedLocal = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
                    const shotLocal = isPacedLocal ? state.currentScenes[state.modalImageShotIndex!] : state.currentScenes[state.modalImageSceneIndex!]?.lines[state.modalImageShotIndex!];
                    imgContainer.innerHTML = `<div class="absolute inset-0 group"><img src="${shot._imageObjectURL}" class="w-full h-full object-cover rounded-lg cursor-pointer generated-img" data-id="${shotLocal?.id || ''}" alt="Generated storyboard image"><div class="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-opacity flex items-center justify-center rounded-lg"><span class="text-white text-xs font-bold opacity-0 group-hover:opacity-100">${result.engine === 'stability' ? 'Fallback' : 'Google'}</span></div></div>`;
                }
                saveVersion();
                state.modalImageSrc = result.base64;
                state.modalImageMimeType = result.mimeType || null;
            }

        } else {
            throw new Error(result.error || "Editing failed.");
        }

    } catch (error) {
        ui.showStatus(`Image edit failed: ${error}`, true, 5000);
    } finally {
        dom.imageEditBtn.disabled = false;
        dom.imageEditLoader.classList.add('hidden');
    }
}

/**
 * Downloads the image currently displayed in the modal.
 */
export async function downloadModalImage() {
    if (dom.generatedImage.src) {
        try {
            const response = await fetch(dom.generatedImage.src);
            const blob = await response.blob();
            const title = getSafeFilenameTitle();
            
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            let shotNumberStr = '';
            if (isPaced) {
                const shot = state.currentScenes[state.modalImageShotIndex];
                const shotNum = shot?.shot_number || (state.modalImageShotIndex + 1);
                shotNumberStr = String(shotNum).padStart(3, '0');
            } else {
                const sceneNum = String(state.modalImageSceneIndex + 1).padStart(3, '0');
                const shotNum = String(state.modalImageShotIndex + 1).padStart(3, '0');
                shotNumberStr = `${sceneNum}_${shotNum}`;
            }
            
            const filename = `${utils.sanitizeFilename(title)}_shot_${shotNumberStr}.jpg`;
            utils.downloadBlob(blob, filename);
            ui.showStatus('Image downloaded successfully.', false, 2000);
        } catch (error) {
            ui.showStatus(`Failed to download image: ${error}`, true, 4000);
        }
    }
}

/**
 * Stops the ongoing bulk generation process.
 */
export function stopBulkGeneration() {
    state.isBulkGenerating = false;
    ui.showStatus('Stopping bulk generation...', false, 2000);
}

/**
 * Handles clearing all generated media assets from the storyboard
 */
export async function handleClearAllAssets() {
    const performClear = () => {
        if (state.currentScenes && state.currentScenes.length > 0) {
            const isPaced = typeof state.currentScenes[0].shot_number !== 'undefined';
            
            const clearShot = (shot: any) => {
                if (!shot) return;
                if (shot._imageObjectURL) URL.revokeObjectURL(shot._imageObjectURL);
                if (shot._videoObjectURL) URL.revokeObjectURL(shot._videoObjectURL);
                if (shot._sfxObjectURL) URL.revokeObjectURL(shot._sfxObjectURL);
                shot.image_id = null;
                shot._imageObjectURL = undefined;
                shot.imageMimeType = undefined;
                shot._videoObjectURL = undefined;
                shot.sfx_id = null;
                shot._sfxObjectURL = undefined;
                shot._sfxBuffer = undefined;
                shot.b_roll_prompt = undefined;
                shot.sfx_prompt = undefined;
            };

            if (isPaced) {
                state.currentScenes.forEach(clearShot);
            } else {
                state.currentScenes.forEach((scene: any) => {
                    if (scene && scene.lines) {
                        scene.lines.forEach(clearShot);
                    }
                });
            }
            
            // Ensure timeline gets updated if active
            if (timelineState.clips && timelineState.clips.length > 0) {
                timelineState.clips.forEach(clip => {
                    const shot = isPaced ? 
                        state.currentScenes.find((s: any) => s.id === clip.id) : 
                        state.currentScenes.flatMap((s: any) => s.lines || []).find((s: any) => s.id === clip.id);
                    if (shot) {
                        clip.media = null;
                        clip.type = 'image';
                        clip.sfx = null;
                    }
                });
                drawVideoFrame(state.videoPauseTime || 0);
            }

            ui.renderResults(state.currentScenes);
            saveVersion(false);
            ui.showStatus('All media assets cleared from the storyboard.', false, 3000);
        }
    };

    ui.showConfirmation(
        'Clear All Assets?',
        'Are you sure you want to clear all generated media assets from the storyboard? The storyboard text will remain intact.',
        performClear
    );
}

/**
 * Handles the bulk generation of all images in the storyboard.
 */
export async function handleBulkGenerate() {
    if (checkGuestRestriction("Bulk Image Generation")) return;
    syncStateFromDOM(); 
    
    const shotsToGenerate = Array.from(dom.resultsContainer.querySelectorAll('.prompt-item'))
        .filter(shotEl => !shotEl.querySelector('.generated-img'));

    const generateButtons = shotsToGenerate
        .map(shotEl => shotEl.querySelector('.generate-btn') as HTMLButtonElement)
        .filter(btn => btn && !btn.disabled);

    if (generateButtons.length === 0) {
        ui.showStatus('All images have already been generated.', false, 4000);
        return;
    }
    
    state.isBulkGenerating = true;
    dom.bulkGenerateBtn.classList.add('hidden');
    dom.stopBulkGenerateBtn.classList.remove('hidden');
    dom.progressBarContainer.classList.remove('hidden');

    const total = generateButtons.length;
    let completed = 0;
    let failed = 0;

    // PRE-ANALYZE ALL SHOTS FOR CHARACTER TIMELINE IN ONE BATCH
    if (state.characterTimeline) {
        ui.showStatus('Analyzing scenes for character context...', false);
        const scenesToAnalyze: string[] = [];
        const shotsData: any[] = [];
        
        for (const btn of generateButtons) {
            const shotElement = btn.closest('.prompt-item') as HTMLElement;
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const scene = state.currentScenes[sceneIndex];
            const lines = scene?.lines || [scene];
            const shot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];
            
            const promptTextarea = shotElement.querySelector('.prompt-textarea') as HTMLTextAreaElement;
            const shotPrompt = promptTextarea.value;
            
            if (!shot._analyzedPrompt || shot._analyzedPrompt !== shotPrompt) {
                scenesToAnalyze.push(shotPrompt);
                shotsData.push({ shot, shotPrompt });
            }
        }
        
        if (scenesToAnalyze.length > 0) {
            try {
                // Batch analyze in chunks of 20 to avoid token limits
                const BATCH_SIZE_ANALYZE = 20;
                for (let i = 0; i < scenesToAnalyze.length; i += BATCH_SIZE_ANALYZE) {
                    const batchScenes = scenesToAnalyze.slice(i, i + BATCH_SIZE_ANALYZE);
                    const batchShotsData = shotsData.slice(i, i + BATCH_SIZE_ANALYZE);
                    
                    const results = await batchAnalyzeScenesForCharacter(batchScenes, state.characterTimeline);
                    
                    for (let j = 0; j < results.length; j++) {
                        const res = results[j];
                        const dataIndex = res.sceneIndex !== undefined ? res.sceneIndex : j;
                        const data = batchShotsData[dataIndex];
                        
                        if (!data) continue;
                        
                        let finalSceneDescription = '';
                        if (res.shouldShowCharacter && res.characterAge) {
                            let characterDesc = '';
                            if (res.characterAge === state.characterTimeline.narratorProfile.currentAge) {
                                characterDesc = state.characterTimeline.narratorProfile.currentDescription;
                            } else {
                                const lifeStage = state.characterTimeline.lifeStages.find((stage: any) => 
                                    res.characterAge.includes(stage.ageRange) ||
                                    res.reasoning.toLowerCase().includes(stage.period.toLowerCase())
                                );
                                characterDesc = lifeStage ? lifeStage.visualDescription : state.characterTimeline.narratorProfile.currentDescription;
                            }
                            finalSceneDescription = `${characterDesc}. ${data.shotPrompt}`;
                        } else {
                            finalSceneDescription = data.shotPrompt;
                        }
                        
                        data.shot.characterMetadata = {
                            hasCharacter: res.shouldShowCharacter,
                            characterAge: res.characterAge,
                            sceneType: res.sceneType,
                            reasoning: res.reasoning
                        };
                        data.shot._analyzedPrompt = data.shotPrompt;
                        data.shot.sceneDescriptionWithCharacter = finalSceneDescription;
                    }
                }
            } catch (e) {
                console.error("Batch analysis failed", e);
            }
        }
    }
    
    // Dynamic batch sizing and adaptive delays
    let BATCH_SIZE = 3;
    let DELAY_BETWEEN_BATCHES = 2000; // Start with 2 seconds
    let consecutiveErrors = 0;

    ui.showStatus(`Starting bulk generation for ${total} images...`);
    utils.updateProgressBar(0, total);

    for (let i = 0; i < total; i += BATCH_SIZE) {
        if (!state.isBulkGenerating) break;
        
        const batch = generateButtons.slice(i, i + BATCH_SIZE);
        
        try {
            // Process batch with error tracking
            const results = await Promise.allSettled(
                batch.map(btn => generateImageForShot(btn, true))
            );
            
            // Count successes and failures
            const batchFailures = results.filter(r => r.status === 'rejected' || (r.status ==='fulfilled' && r.value && !r.value.success && !r.value.aborted)).length;
            const batchSuccesses = results.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
            
            completed += batchSuccesses;
            failed += batchFailures;
            
            // Adaptive rate limiting based on errors
            if (batchFailures > 0) {
                consecutiveErrors++;
                if (consecutiveErrors >= 3) {
                    console.warn(`🛑 Aborting bulk generation due to 3 consecutive failures (likely quota limits).`);
                    ui.showStatus('Aborted bulk generation: too many errors (quota limit).', false, 6000);
                    state.isBulkGenerating = false;
                    break;
                }
                // Reduce batch size and increase delay on errors
                BATCH_SIZE = Math.max(1, BATCH_SIZE - 1);
                DELAY_BETWEEN_BATCHES = Math.min(10000, DELAY_BETWEEN_BATCHES * 1.5);
                console.warn(`⚠️ ${batchFailures} failures detected. Reducing to ${BATCH_SIZE} per batch, ${DELAY_BETWEEN_BATCHES}ms delay`);
            } else {
                consecutiveErrors = Math.max(0, consecutiveErrors - 1);
                // Gradually increase batch size on success
                if (consecutiveErrors === 0 && BATCH_SIZE < 3) {
                    BATCH_SIZE = Math.min(3, BATCH_SIZE + 1);
                    DELAY_BETWEEN_BATCHES = Math.max(1000, DELAY_BETWEEN_BATCHES * 0.8);
                }
            }
            
            utils.updateProgressBar(Math.min(completed, total), total);
            ui.showStatus(`Bulk generating... (${completed}/${total}, ${failed} failed)`);
            
            // Wait between batches to avoid rate limits
            if (i + BATCH_SIZE < total && state.isBulkGenerating) {
                await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
            }
            
        } catch (error: any) {
            console.error('Batch generation error:', error);
            // Continue to next batch even if one fails
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
                console.warn(`🛑 Aborting bulk generation due to 3 consecutive failures (likely quota limits).`);
                ui.showStatus('Aborted bulk generation: too many errors (quota limit).', false, 6000);
                state.isBulkGenerating = false;
                break;
            }
            BATCH_SIZE = 1; // Drop to single image per batch
            DELAY_BETWEEN_BATCHES = 5000; // 5 second delay
        }
    }

    state.isBulkGenerating = false;
    dom.stopBulkGenerateBtn.classList.add('hidden');
    dom.bulkGenerateBtn.classList.remove('hidden');
    dom.progressBarContainer.classList.add('hidden');
    
    // Better completion message
    if (completed === total) {
        ui.showStatus('✅ Bulk generation complete!', false, 4000);
    } else if (failed > 0) {
        ui.showStatus(`⚠️ Completed with ${failed} failures. ${completed}/${total} images generated.`, true, 6000);
    } else {
        ui.showStatus(`Bulk generation stopped. ${completed}/${total} images generated.`, false, 4000);
    }
}

/**
 * Handles enabling/disabling the bulk generation button.
 */
export function handleBulkEnableToggle(event: Event) {
    const isChecked = (event.target as HTMLInputElement).checked;
    
    if (dom.bulkGenerateBtn) {
        dom.bulkGenerateBtn.disabled = !isChecked;
        dom.bulkGenerateBtn.classList.toggle('opacity-50', !isChecked);
        dom.bulkGenerateBtn.classList.toggle('cursor-not-allowed', !isChecked);
    }
    
    if (dom.bulkAnimateBtn) {
        dom.bulkAnimateBtn.disabled = !isChecked;
        dom.bulkAnimateBtn.classList.toggle('opacity-50', !isChecked);
        dom.bulkAnimateBtn.classList.toggle('cursor-not-allowed', !isChecked);
    }

    if (dom.bulkStockBtn) {
        dom.bulkStockBtn.disabled = !isChecked;
        dom.bulkStockBtn.classList.toggle('opacity-50', !isChecked);
        dom.bulkStockBtn.classList.toggle('cursor-not-allowed', !isChecked);
    }
}

/**
 * Applies a selected camera angle to all shots in the storyboard.
 */
export function handleBulkCameraAngleChange(event: Event) {
    const selectedAngle = (event.target as HTMLSelectElement).value;
    if (selectedAngle === 'per-shot') return;

    const allShotCards = dom.resultsContainer.querySelectorAll('.prompt-item') as NodeListOf<HTMLElement>;
    allShotCards.forEach(shotElement => {
        const select = shotElement.querySelector('.camera-angle-select') as HTMLSelectElement | null;
        if (select) select.value = selectedAngle;

        const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
        const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
        
        const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
        let shot: any;
        if (isPaced) {
            shot = state.currentScenes[lineIndex];
        } else {
            shot = state.currentScenes[sceneIndex]?.lines[lineIndex];
        }

        if (shot) {
            shot.camera_angle = selectedAngle;
            const newMovement = selectedAngle === 'default' ? 'static' : selectedAngle.toLowerCase().replace(/\s+/g, '_');
            shot.camera_movement = newMovement;
        }
    });

    saveVersion(false);
    const selectedOptionText = dom.bulkCameraAngleSelect.options[dom.bulkCameraAngleSelect.selectedIndex].text;
    ui.showStatus(`Bulk camera angle set to "${selectedOptionText}".`, false, 2000);
}

/**
 * Triggers the hidden file input for folder selection.
 */
export async function handleImportImages() {
    dom.importMenuDropdown?.classList.add('hidden');
    dom.importImagesInput.click();
}

/**
 * Processes the selected files from the image import.
 * Matches filenames (e.g., shot_001.jpg, 005.png) to storyboard shots.
 */
export async function importImages(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const files = Array.from(input.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length === 0) {
        ui.showStatus('No image files found in the selected folder.', true, 5000);
        return;
    }

    ui.showStatus(`Importing ${imageFiles.length} images...`);
    
    let importedCount = 0;
    const shotMap: { [key: number]: File } = {};

    // Improved logic to find shot numbers in filenames
    const getShotNumber = (filename: string): number | null => {
        // Remove extension for cleaner matching
        const nameWithoutExt = filename.split('.').slice(0, -1).join('.');
        
        // Try specific patterns first (shot_001, shot001, s01, scene_1 etc.)
        const specificPatterns = [
            /shot[\s_.-]?(\d+)/i,
            /s[\s_.-]?(\d+)/i,
            /scene[\s_.-]?(\d+)/i,
            /img[\s_.-]?(\d+)/i,
            /image[\s_.-]?(\d+)/i
        ];

        for (const pattern of specificPatterns) {
            const match = nameWithoutExt.match(pattern);
            if (match) return parseInt(match[1], 10);
        }

        // Fallback: find any number in the filename
        const generalMatch = nameWithoutExt.match(/(\d+)/);
        if (generalMatch) return parseInt(generalMatch[1], 10);

        return null;
    };

    for (const file of imageFiles) {
        const shotNumber = getShotNumber(file.name);
        if (shotNumber !== null) {
            shotMap[shotNumber] = file;
        }
    }

    if (Object.keys(shotMap).length === 0) {
        ui.showStatus('No files with shot numbers in their names (e.g., shot_001.jpg, 005.png) were found.', true, 5000);
        return;
    }

    // Flatten all shots from all scenes into a single list for easier indexing
    const shotsList: any[] = [];
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    
    if (isPaced) {
        state.currentScenes.forEach(shot => shotsList.push(shot));
    } else {
        state.currentScenes.forEach(scene => {
            if (scene.lines) {
                scene.lines.forEach((shot: any) => shotsList.push(shot));
            }
        });
    }

    let hasConflicts = false;
    for (const [shotNumStr, file] of Object.entries(shotMap)) {
        const shotIndex = parseInt(shotNumStr, 10) - 1;
        if (shotIndex >= 0 && shotIndex < shotsList.length) {
            const shot = shotsList[shotIndex];
            if (shot.image_id || shot._imageObjectURL) {
                hasConflicts = true;
                break;
            }
        }
    }

    let action: 'replace' | 'skip' | 'cancel' = 'replace';

    if (hasConflicts) {
        action = await new Promise<'replace' | 'skip' | 'cancel'>((resolve) => {
            dom.importConflictModal.classList.remove('hidden');
            
            const handleSkip = () => { cleanup(); resolve('skip'); };
            const handleReplace = () => { cleanup(); resolve('replace'); };
            const handleCancel = () => { cleanup(); resolve('cancel'); };
            
            const cleanup = () => {
                dom.importConflictModal.classList.add('hidden');
                dom.importConflictSkipBtn.removeEventListener('click', handleSkip);
                dom.importConflictReplaceBtn.removeEventListener('click', handleReplace);
                dom.importConflictCancelBtn.removeEventListener('click', handleCancel);
            };
            
            dom.importConflictSkipBtn.addEventListener('click', handleSkip);
            dom.importConflictReplaceBtn.addEventListener('click', handleReplace);
            dom.importConflictCancelBtn.addEventListener('click', handleCancel);
        });

        if (action === 'cancel') {
            input.value = '';
            return;
        }
    }

    for (const [shotNumStr, file] of Object.entries(shotMap)) {
        const shotIndex = parseInt(shotNumStr, 10) - 1;
        if (shotIndex >= 0 && shotIndex < shotsList.length) {
            const shot = shotsList[shotIndex];
            
            if (action === 'skip' && (shot.image_id || shot._imageObjectURL)) {
                continue;
            }

            try {
                const { data, mimeType } = await utils.fileToBase64(file);
                const base64Url = `data:${mimeType};base64,${data}`;
                
                const assetId = await assetStorage.storeAsset(utils.base64ToBlob(data, mimeType), 'image', 'current_project');
                shot.image_id = assetId;
                shot._imageObjectURL = base64Url;
                shot.imageMimeType = mimeType;
                shot.imageEngine = 'imported';
                
                importedCount++;
            } catch (error) {
                console.error(`Failed to import image for shot ${shotNumStr}:`, error);
            }
        }
    }

    if (importedCount > 0) {
        ui.showStatus(`Successfully imported ${importedCount} images.`, false, 5000);
        
        if (dom.videoDirectorBtn && dom.videoDirectorBtn.disabled) {
            dom.videoDirectorBtn.disabled = false;
            dom.videoDirectorBtn.classList.remove('opacity-50');
            ui.updateWorkflowStepStatus(3, 'completed');
            ui.updateWorkflowStepStatus(4, 'active');
        }

        saveVersion(false);
        ui.updateStoryboardStats();
        ui.renderResults(state.currentScenes);
    } else {
        if (action === 'skip') {
            ui.showStatus('All imported images were skipped because existing shots already have images.', true, 5000);
        } else {
            ui.showStatus('No images could be matched to existing storyboard shots.', true, 5000);
        }
    }

    // Reset input so the same folder can be selected again if needed
    input.value = '';
}

export async function uploadMediaToShot(shot: any, file: File, forcePreserve?: boolean) {
    if (!shot || !file) return;
    const isImage = file.type.startsWith('image/');
    const preserve = forcePreserve !== undefined ? forcePreserve : !!shot.preserveContent;
    const hasExistingPrimary = !!(shot.image_id || shot._imageObjectURL || shot.video_id || shot._videoObjectURL);

    shot._isUploadingVideo = true;
    ui.renderResults(state.currentScenes);

    try {
        const buffer = await file.arrayBuffer();
        const blob = new Blob([buffer], { type: file.type || (isImage ? 'image/jpeg' : 'video/mp4') });

        if (preserve && hasExistingPrimary) {
            // Preserve existing media as Layer 1 and add this file as Layer 2 (A-Roll / secondary)
            if (isImage) {
                safelyReplaceShotMedia(shot, blob, 'image', 'secondary');
                shot.secondary_image_id = await assetStorage.storeAsset(blob, 'image', 'current_project');
                shot.secondary_media_type = 'image';
            } else {
                safelyReplaceShotMedia(shot, blob, 'video', 'secondary');
                shot.secondary_video_id = await assetStorage.storeAsset(blob, 'video', 'current_project');
                shot.secondary_media_type = 'video';
            }

            // Auto-activate split screen layout if none currently active
            if (!shot.talkingHeadMode || shot.talkingHeadMode === 'none') {
                shot.talkingHeadMode = 'split';
            }
            shot.preserveContent = true;
            ui.showStatus('🛡️ Media uploaded with content preserved! Split Screen layout activated.', false, 3500);
        } else {
            // Default replace workflow: Clean up secondary layer and replace primary media
            removeSecondaryMedia(shot);
            delete shot.secondary_media_type;

            if (isImage) {
                safelyReplaceShotMedia(shot, blob, 'image');
                shot.image_id = await assetStorage.storeAsset(blob, 'image', 'current_project');
                
                if (shot._videoObjectURL) {
                    if (shot._videoObjectURL.startsWith('blob:')) URL.revokeObjectURL(shot._videoObjectURL);
                    delete shot._videoObjectURL;
                }
                delete shot.video_id;
            } else {
                safelyReplaceShotMedia(shot, blob, 'video');
                shot.video_id = await assetStorage.storeAsset(blob, 'video', 'current_project');
                shot.useOriginalAudio = false;
                
                if (shot._imageObjectURL) {
                    dropDepth(shot._imageObjectURL);
                    if (shot.image) dropDepth(shot.image);
                    if (shot._imageObjectURL.startsWith('blob:')) URL.revokeObjectURL(shot._imageObjectURL);
                    delete shot._imageObjectURL;
                }
                delete shot.image_id;

                const meta = document.createElement('video');
                meta.preload = 'metadata';
                meta.src = shot._videoObjectURL;
                meta.onloadedmetadata = () => {
                    if (meta.duration && isFinite(meta.duration) && meta.duration > 0) {
                        shot._videoDuration = meta.duration;
                        shot.mediaDuration = meta.duration;
                    }
                    const portrait = meta.videoHeight > meta.videoWidth;
                    if (portrait) {
                        ui.showStatus('📱 Portrait video detected — check orientation in export; use inspector Rotate if needed.', false, 4000);
                    }
                };
                meta.onerror = () => {
                    ui.showStatus('⚠️ Video codec or format not fully supported by browser preview. Consider converting to MP4 (H.264/AAC).', true, 5000);
                };
            }
            ui.showStatus('Media uploaded (replaced shot media).', false, 2500);
        }

        if (shot._secondaryVideoObjectURL) {
            const secMeta = document.createElement('video');
            secMeta.preload = 'metadata';
            secMeta.src = shot._secondaryVideoObjectURL;
            secMeta.onloadedmetadata = () => {
                if (secMeta.duration && isFinite(secMeta.duration) && secMeta.duration > 0) {
                    shot._videoDuration = secMeta.duration;
                    shot.mediaDuration = secMeta.duration;
                }
            };
        }

        saveVersion(false);
        await syncShotMediaToTimeline(shot);
        if (dom.videoDirectorBtn && dom.videoDirectorBtn.disabled) {
            dom.videoDirectorBtn.disabled = false;
            dom.videoDirectorBtn.classList.remove('opacity-50');
            ui.updateWorkflowStepStatus(3, 'completed');
            ui.updateWorkflowStepStatus(4, 'active');
        }
    } catch (error: any) {
        console.error("Media upload failed:", error);
        ui.showStatus("Media upload failed.", true);
    } finally {
        shot._isUploadingVideo = false;
        ui.renderResults(state.currentScenes);
        ui.updateEstimations();
    }
}

export async function handleUploadVideoBtnClick(event: Event, forcePreserve?: boolean) {
    const target = event.target as HTMLElement;
    const uploadBtn = target.closest('.upload-video-btn, .upload-preserve-btn') as HTMLButtonElement;
    
    if (!uploadBtn) return;
    
    const shotEl = uploadBtn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    
    const sceneIndex = parseInt(shotEl.dataset.sceneIndex || '0', 10);
    const lineIndex = parseInt(shotEl.dataset.lineIndex || '0', 10);
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,image/*';
    input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
        const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];
        if (!shot) return;

        const isPreserveBtn = uploadBtn.classList.contains('upload-preserve-btn') || forcePreserve === true;
        await uploadMediaToShot(shot, file, isPreserveBtn);
    };
    input.click();
}

export async function handleUploadSfxBtnClick(event: Event) {
    const target = event.target as HTMLElement;
    const uploadBtn = target.closest('.upload-sfx-btn') as HTMLButtonElement;
    
    if (!uploadBtn) return;
    
    const shotEl = uploadBtn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    
    const sceneIndex = parseInt(shotEl.dataset.sceneIndex || '0', 10);
    const lineIndex = parseInt(shotEl.dataset.lineIndex || '0', 10);
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
        const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];
        if (!shot) return;
        
        const originalBtnHtml = uploadBtn.innerHTML;
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '⏳...';
        ui.showStatus('Processing SFX upload...', false, 0);
        
        try {
            // Read file into ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            
            // Decode to AudioBuffer using a temporary AudioContext
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            // Store in shot
            shot.sfx_prompt = file.name;
            shot._sfxBuffer = audioBuffer;
            
            // Convert to WAV Blob for storage
            const wavBlob = await audioBufferToWavBlob(audioBuffer);
            if (shot._sfxObjectURL) {
                URL.revokeObjectURL(shot._sfxObjectURL);
            }
            shot._sfxObjectURL = URL.createObjectURL(wavBlob);
            
            // Save to asset storage
            const assetId = await assetStorage.storeAsset(wavBlob, 'audio', 'current_project');
            shot.sfx_id = assetId;
            
            // Update timeline clip if it exists
            const timelineClip = timelineState.clips.find(c => c.id === shot.id);
            if (timelineClip) {
                timelineClip._sfxBuffer = audioBuffer;
            }
            
            ui.showStatus('SFX uploaded successfully!', false, 3000);
            
            // Re-render the shot to update UI
            if (isPaced) {
                renderBatch(state.currentScenes, Math.floor(lineIndex / 25));
            } else {
                renderSceneBatch(sceneIndex, state.currentScenes[sceneIndex].lines, Math.floor(lineIndex / 25));
            }
            
            saveVersion(false);
            
        } catch (error) {
            console.error('SFX upload failed:', error);
            ui.showStatus(`SFX upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true, 5000);
        } finally {
            uploadBtn.innerHTML = originalBtnHtml;
            uploadBtn.disabled = false;
        }
    };
    
    input.click();
}
