import { pacingMap, getShotRange, safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Type, GenerateContentResponse } from "@google/genai";
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import { generateContentWithFallback } from './api/core';
import * as utils from './utils';
import * as constants from './constants';
import { saveVersion } from './handlers-project';
import { openMediaAssemblerModal } from './media-assembler';
import type { CinematicShot, Scene } from './types';
import { checkGuestRestriction } from './auth';



function syncAssetsFromDOM() {
    // Collect updates into an intermediate structure
    const updates: Array<{ profile: any, field: string, value: string | boolean }> = [
        // Characters - handle split fields
        ...Array.from(document.querySelectorAll('.character-name-input')).map((el, index) => {
            const input = el as HTMLInputElement;
            const profile = state.characterProfiles[index];
            return { profile, field: 'name', value: input.value };
        }),
        ...Array.from(document.querySelectorAll('.character-anchor-input')).map((el, index) => {
            const input = el as HTMLTextAreaElement;
            const profile = state.characterProfiles[index];
            return { profile, field: 'appearance_anchor', value: input.value };
        }),
        ...Array.from(document.querySelectorAll('.consistency-checkbox')).map((el, index) => {
            const input = el as HTMLInputElement;
            const profile = state.characterProfiles[index];
            return { profile, field: 'enforce_consistency', value: input.checked };
        }),
        ...Array.from(document.querySelectorAll('.universal-character-radio')).map((el, index) => {
            const input = el as HTMLInputElement;
            const profile = state.characterProfiles[index];
            return { profile, field: 'is_universal', value: input.checked };
        }),
        // Locations
        ...Array.from(document.querySelectorAll('.location-description-input')).map(el => {
            const input = el as HTMLTextAreaElement;
            const profile = state.locationProfiles.find(l => l.name === input.dataset.name);
            return { profile, field: 'description', value: input.value };
        }),
        // Elements
        ...Array.from(document.querySelectorAll('.element-description-input')).map(el => {
            const input = el as HTMLTextAreaElement;
            const profile = state.keyElementProfiles.find(k => k.name === input.dataset.name);
            return { profile, field: 'description', value: input.value };
        })
    ];
    
    // Apply all updates
    updates.forEach(({ profile, field, value }) => {
        if (profile) {
            (profile as any)[field] = value;
            if (field === 'name') {
                if (state.characterProfiles.includes(profile as any)) {
                    profile._nameRegex = utils.buildCharacterRegex(profile as any, state.characterProfiles);
                } else {
                    profile._nameRegex = new RegExp(`\\b${utils.escapeRegExp(value as string)}\\b`, 'i');
                }
            }
        }
    });
}

/**
 * Enhances the story with more visual detail.
 */
export async function enhanceStory() {
    const storyText = (dom.storyInput?.value || '').trim();
    if (!storyText) {
        ui.showStatus("Please enter your story or script in Step 1 first.", true, 3000);
        return;
    }

    ui.setButtonsDisabled(true);
    let isCancelled = false;
    let stopProgress: (() => void) | null = null;

    const onCancel = () => {
        isCancelled = true;
        if (stopProgress) stopProgress();
        ui.closeProcessingModal();
        ui.setButtonsDisabled(false);
    };

    const signal = await ui.openProcessingModal('Enhancing Story', true, 'Stop Processing', onCancel);
    ui.updateProcessingProgress(0, 'Analyzing narrative structure...');
    
    // Start simulated progress
    stopProgress = utils.startSimulatedProgress('Adding cinematic details...', ui.updateProcessingProgress);

    try {
        const response = await generateContentWithFallback({
            contents: `You are a professional screenwriter. Your task is to take the user's story and expand it by adding rich, cinematic visual details. Describe the environment, character appearances, actions, and the overall mood with more depth. Do not change the core plot. The goal is to make the story more "visible" for an AI image generator. Here is the story:\n\n---\n\n${storyText}`,
            maxOutputTokens: 8192
        }, signal);
        
        if (isCancelled || signal?.aborted) return;

        if (stopProgress) stopProgress();
        ui.updateProcessingProgress(100, 'Enhancement complete!');
        
        dom.storyInput.value = response.text || '';
        saveVersion(false);
        ui.showStatus('Story enhanced successfully.', false, 3000);
    } catch (error: any) {
        if (stopProgress) stopProgress();
        if (isCancelled || signal?.aborted || error?.name === 'AbortError' || error?.message?.includes('Aborted')) {
            ui.showStatus('Story enhancement stopped.', false, 3000);
            return;
        }
        ui.showStatus(`Error enhancing story: ${error}`, true, 5000);
    } finally {
        if (!isCancelled && !signal?.aborted) {
            setTimeout(() => {
                ui.closeProcessingModal();
                ui.setButtonsDisabled(false);
            }, 800);
        }
    }
}

/**
 * Closes the style suggestion modal and cancels any in-flight style analysis.
 */
export function closeStyleSuggestionModal() {
    if (dom.styleSuggestionModal) {
        dom.styleSuggestionModal.classList.add('hidden');
    }
    if (state.currentProcessingAbortController) {
        ui.cancelCurrentProcessing();
    }
}

/**
 * Suggests artistic styles based on the story's content, 
 * now utilizing both existing library presets and new tailored creations.
 */
export async function suggestStyle() {
    const storyText = (dom.storyInput?.value || '').trim();
    if (!storyText) {
        ui.showStatus("Please enter your story or script in Step 1 first.", true, 3000);
        return;
    }

    ui.setButtonsDisabled(true);
    let isCancelled = false;
    let stopProgress: (() => void) | null = null;

    const onCancel = () => {
        isCancelled = true;
        if (stopProgress) stopProgress();
        if (dom.styleSuggestionModal) dom.styleSuggestionModal.classList.add('hidden');
        ui.closeProcessingModal();
        ui.setButtonsDisabled(false);
    };

    const signal = await ui.openProcessingModal('Analyzing Style', true, 'Stop Processing', onCancel);
    ui.updateProcessingProgress(0, 'Reading story mood...');
    dom.styleSuggestionList.innerHTML = ui.renderStyleSkeleton(4);
    if (dom.styleSuggestionModal) dom.styleSuggestionModal.classList.remove('hidden');

    stopProgress = utils.startSimulatedProgress('Generating artistic suggestions...', ui.updateProcessingProgress);

    const libraryStyles = Array.from(dom.imageStyleSelect.options)
        .filter(opt => !['custom', 'custom_prompt'].includes(opt.value))
        .map(opt => ({ name: opt.textContent, prompt: opt.value }));

    try {
        const systemInstruction = `You are an expert AI Art Director analyzing creative stories to suggest visual styles for digital video production.
You have access to a "Studio Library" of established styles. 
TASK: Suggest 3 distinct artistic directions for the user's story.

Studio Library Styles: ${safeJsonStringify(libraryStyles)}

Rules:
1. Evaluate if a Studio Library style is a "Perfect Match" for this story.
2. You can suggest a Library style or invent a "New Tailored Vision" if none fit perfectly.
3. For each suggestion, provide:
   - "name": The style name.
   - "prompt": The visual keywords.
   - "isLibraryStyle": true if it matches an existing Studio Library prompt EXACTLY, false if it's a new tailored invention.
4. Output strictly valid JSON. Do not include any conversational intro, refusal, or commentary.`;

        const response = await generateContentWithFallback({
            contents: `Story:\n\n${storyText}`,
            systemInstruction: systemInstruction,
            mimeType: "application/json",
            schema: {
                type: Type.OBJECT,
                properties: {
                    styles: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                prompt: { type: Type.STRING },
                                isLibraryStyle: { type: Type.BOOLEAN }
                            },
                            required: ["name", "prompt", "isLibraryStyle"]
                        }
                    }
                }
            }
        }, signal);

        if (isCancelled || signal?.aborted) return;

        if (stopProgress) stopProgress();
        ui.updateProcessingProgress(100, 'Suggestions ready!');

        let stylesRaw: any[] = [];
        try {
            const result = utils.sanitizeAndParseJson(response.text);
            if (Array.isArray(result)) {
                stylesRaw = result;
            } else if (result && typeof result === 'object') {
                stylesRaw = result.styles || result.suggestions || result.style_suggestions || result.artistic_directions || result.directions || result.items || result.data || Object.values(result).find(Array.isArray) || [];
            }
        } catch {
            stylesRaw = [];
        }

        let validStyles = stylesRaw
            .filter((s: any) => s && (typeof s === 'object' || typeof s === 'string'))
            .map((s: any, idx: number) => {
                if (typeof s === 'string') {
                    return { name: `Style ${idx + 1}`, prompt: s, isLibraryStyle: false };
                }
                return {
                    name: s.name || s.style_name || s.title || `Style ${idx + 1}`,
                    prompt: s.prompt || s.visual_keywords || s.description || s.style || '',
                    isLibraryStyle: Boolean(s.isLibraryStyle)
                };
            })
            .filter(s => s.prompt.trim().length > 0);

        // Fallback to top Library styles if AI generation returned no parsed styles
        if (validStyles.length === 0 && libraryStyles.length > 0) {
            console.log("Applying Studio Library fallback for suggestStyle...");
            validStyles = libraryStyles.slice(0, 3).map(s => ({
                name: s.name || 'Library Preset',
                prompt: s.prompt || '',
                isLibraryStyle: true
            }));
        }

        if (validStyles.length > 0) {
            dom.styleSuggestionList.innerHTML = validStyles.map((style: { name: string, prompt: string, isLibraryStyle: boolean }) => `
                <div class="style-suggestion-item p-4 bg-gray-800 hover:bg-gray-700 rounded-xl cursor-pointer border border-gray-700 transition relative group" 
                     data-prompt="${encodeURIComponent(style.prompt)}" 
                     data-is-library="${style.isLibraryStyle}">
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-lg text-indigo-300">${ui.escapeHtml(style.name)}</h4>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${style.isLibraryStyle ? 'bg-green-900/50 text-green-300 border border-green-700/30' : 'bg-blue-900/50 text-blue-300 border border-blue-700/30'} uppercase tracking-wider">
                            ${style.isLibraryStyle ? 'Library Preset' : 'AI Tailored'}
                        </span>
                    </div>
                    <p class="text-sm text-gray-400 mt-1 line-clamp-2 group-hover:line-clamp-none transition-all">${ui.escapeHtml(style.prompt)}</p>
                    <div class="absolute inset-0 border-2 border-transparent group-hover:border-indigo-500/30 rounded-xl pointer-events-none"></div>
                </div>
            `).join('');
            dom.styleSuggestionModal.classList.remove('hidden');
        } else {
            dom.styleSuggestionList.innerHTML = '<p class="text-center text-gray-400">No styles suggested. Please try again.</p>';
        }
    } catch (error: any) {
        if (stopProgress) stopProgress();
        if (isCancelled || signal?.aborted || error?.name === 'AbortError' || error?.message?.includes('Aborted')) {
            if (dom.styleSuggestionModal) dom.styleSuggestionModal.classList.add('hidden');
            ui.showStatus('Style analysis stopped.', false, 3000);
            return;
        }

        // Fallback gracefully to Library presets instead of crashing modal
        if (libraryStyles.length > 0) {
            console.warn("Error in AI suggestStyle, falling back to Library Presets:", error);
            const fallbackStyles = libraryStyles.slice(0, 3).map(s => ({
                name: s.name || 'Library Preset',
                prompt: s.prompt || '',
                isLibraryStyle: true
            }));
            dom.styleSuggestionList.innerHTML = fallbackStyles.map((style: { name: string, prompt: string, isLibraryStyle: boolean }) => `
                <div class="style-suggestion-item p-4 bg-gray-800 hover:bg-gray-700 rounded-xl cursor-pointer border border-gray-700 transition relative group" 
                     data-prompt="${encodeURIComponent(style.prompt)}" 
                     data-is-library="${style.isLibraryStyle}">
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-lg text-indigo-300">${ui.escapeHtml(style.name)}</h4>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/30 uppercase tracking-wider">
                            Library Preset
                        </span>
                    </div>
                    <p class="text-sm text-gray-400 mt-1 line-clamp-2 group-hover:line-clamp-none transition-all">${ui.escapeHtml(style.prompt)}</p>
                    <div class="absolute inset-0 border-2 border-transparent group-hover:border-indigo-500/30 rounded-xl pointer-events-none"></div>
                </div>
            `).join('');
            dom.styleSuggestionModal.classList.remove('hidden');
            ui.showStatus('Showing Studio Library style recommendations.', false, 3000);
            return;
        }

        ui.showStatus(`Error suggesting styles: ${error?.message || error}`, true, 5000);
    } finally {
        if (!isCancelled && !signal?.aborted) {
            setTimeout(() => {
                ui.closeProcessingModal();
                ui.setButtonsDisabled(false);
            }, 800);
        }
    }
}

let lastAnalyzedHash = '';

/**
 * Analyzes the story and generates the storyboard scenes.
 * Handles both short and very long scripts via batch processing with a unified prompt.
 */
export async function analyzeStory() {
    if (checkGuestRestriction("Creating Storyboard")) return;
    syncAssetsFromDOM();
    
    // Script hygiene pass before analysis
    let storyText = dom.storyInput ? dom.storyInput.value : '';
    if (!storyText || !storyText.trim()) {
        ui.showStatus("Please enter your story or script in Step 1 first, or use Manual Storyboard below.", true, 3500);
        return;
    }
    
    const cleaned = storyText
        .replace(/\u2018|\u2019/g, "'")
        .replace(/\u201C|\u201D/g, '"')
        .replace(/\u2026/g, '...')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
        
    if (cleaned !== storyText) {
        dom.storyInput.value = cleaned;
        storyText = cleaned;
    }

    const detailLevel = dom.detailLevelSelect?.value || 'auto';
    const pacingFactor = dom.pacingFactorSelect?.value || 'normal';
    const wordCount = storyText.split(/\s+/).filter(Boolean).length;
    
    let estimatedShots = 0;
    if (detailLevel === 'custom') {
        estimatedShots = parseInt(dom.customShotCountInput.value, 10) || 10;
    } else {
        const { max } = getShotRange(wordCount, pacingFactor);
        estimatedShots = max;
    }
    
    ui.showStatus(`Script cleaned: ${wordCount} words → ~${estimatedShots} shots`, false, 2500);
    
    const hash = utils.simpleHash ? utils.simpleHash(storyText) : storyText.length + storyText.slice(0, 40);
    if (lastAnalyzedHash && lastAnalyzedHash !== hash && state.currentScenes.length > 0) {
        ui.showStatus('⚠️ Script changed since the last storyboard — this will replace it.', true, 4000);
    }

    if (estimatedShots > 100) {
        ui.showConfirmation(
            'High Shot Count Warning',
            `This storyboard will generate approximately ${estimatedShots} shots. Are you sure you want to proceed?`,
            () => {
                lastAnalyzedHash = hash;
                _executeAnalyzeStory(storyText, detailLevel, pacingFactor);
            }
        );
    } else {
        lastAnalyzedHash = hash;
        _executeAnalyzeStory(storyText, detailLevel, pacingFactor);
    }
}

export async function createBlankStoryboard() {
    if (checkGuestRestriction("Creating Storyboard")) return;
    
    const mode = dom.manualStoryboardType ? dom.manualStoryboardType.value : 'blank';
    if (mode === 'assembler') {
        openMediaAssemblerModal();
        return;
    }
    const isARoll = mode === 'aroll';
    const isScript = mode === 'script';
    
    if (isARoll && !state.uploadedVideoElement && !timelineState.masterAudioBuffer) {
        ui.showStatus("Please upload a Master Audio or A-Roll video in Step 1 first.", true, 4000);
        return;
    }

    if (isScript) {
        const scriptText = (dom.storyInput?.value || '').trim();
        if (!scriptText) {
            ui.showStatus("Please enter or paste your script in Step 1 first.", true, 3500);
            return;
        }
    }

    const newShots: CinematicShot[] = [];
    const videoSourceUrl = state.uploadedVideoObjectURL || (state.uploadedVideoElement ? state.uploadedVideoElement.src : undefined);
    
    if (isARoll) {
        // Option 3: Transcript-Driven A-Roll Shots
        const words = timelineState.globalWordTimestamps || state.masterAudioTranscript || [];
        
        if (words.length > 0) {
            let currentSentence: typeof words = [];
            let shotIndex = 0;
            
            for (let i = 0; i < words.length; i++) {
                currentSentence.push(words[i]);
                const wordStr = words[i].word.trim();
                const isEndOfSentence = /[.?!]$/.test(wordStr) || i === words.length - 1;
                const isLongEnough = currentSentence.length > 3 || i === words.length - 1;
                
                if (isEndOfSentence && isLongEnough) {
                    const startWord = currentSentence[0];
                    const endWord = currentSentence[currentSentence.length - 1];
                    const duration = endWord.end - startWord.start;
                    const text = currentSentence.map(w => w.word).join(' ');
                    
                    newShots.push({
                        id: 'shot_' + Date.now() + '_' + shotIndex,
                        shot_number: shotIndex + 1,
                        duration_seconds: Math.max(0.5, duration),
                        image_prompt: "",
                        text_reference: text,
                        camera_movement: "static",
                        image_id: null,
                        _imageObjectURL: undefined,
                        _videoObjectURL: videoSourceUrl,
                        videoStartOffset: startWord.start || 0,
                        talkingHeadMode: 'full'
                    });
                    
                    currentSentence = [];
                    shotIndex++;
                }
            }
        } else {
            // Fallback if no transcript yet
            const duration = timelineState.masterAudioBuffer?.duration || state.uploadedVideoDuration || 10;
            newShots.push({
                id: 'shot_' + Date.now() + '_0',
                shot_number: 1,
                duration_seconds: duration,
                image_prompt: "",
                text_reference: "", // Clear text reference so internal track name doesn't display as subtitles
                camera_movement: "static",
                image_id: null,
                _imageObjectURL: undefined,
                _videoObjectURL: videoSourceUrl,
                videoStartOffset: 0,
                talkingHeadMode: 'full'
            });
        }
    } else if (isScript) {
        const rawText = (dom.storyInput?.value || '').trim();
        let segments = rawText.split(/\n\s*\n|\n+/).map(s => s.trim()).filter(Boolean);
        if (segments.length === 1 && segments[0].length > 120) {
            const sentences = segments[0].match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
            if (sentences && sentences.length > 1) {
                segments = sentences.map(s => s.trim()).filter(Boolean);
            }
        }
        const count = Math.min(segments.length, 200);
        for (let i = 0; i < count; i++) {
            const seg = segments[i];
            const wordCount = seg.split(/\s+/).filter(Boolean).length;
            const duration = Math.min(12, Math.max(2.5, Math.round(wordCount / 2.6)));
            newShots.push({
                id: 'shot_' + Date.now() + '_' + i,
                shot_number: i + 1,
                duration_seconds: duration,
                image_prompt: seg,
                text_reference: seg,
                camera_movement: "static",
                image_id: null,
                _imageObjectURL: undefined,
                _videoObjectURL: undefined,
                videoStartOffset: 0,
                talkingHeadMode: 'none'
            });
        }
    } else {
        // Standard Blank Storyboard
        const countInput = dom.blankStoryboardCount || document.getElementById('blank-storyboard-count') as HTMLInputElement;
        const count = countInput ? parseInt(countInput.value, 10) : 4;
        const validCount = (isNaN(count) || count < 1 || count > 200) ? 4 : count;
        for (let i = 0; i < validCount; i++) {
            newShots.push({
                id: 'shot_' + Date.now() + '_' + i,
                shot_number: i + 1,
                duration_seconds: 4,
                image_prompt: "",
                text_reference: "",
                camera_movement: "static",
                image_id: null,
                _imageObjectURL: undefined,
                _videoObjectURL: undefined,
                videoStartOffset: 0,
                talkingHeadMode: 'none'
            });
        }
    }

    state.currentScenes = newShots;
    ui.renderResults(state.currentScenes);
    saveVersion(false);
    
    const isSeedOnly = timelineState.clips?.length <= 1 
        && (timelineState.clips?.[0]?.id === 'aroll-full' || timelineState.clips?.length === 0);

    if ((isSeedOnly || isARoll) && state.currentScenes.length > 0 && timelineState.masterAudioBuffer) {
        const { buildTimelineFromShotsWithAudio } = await import('./audio-upload-director');
        await buildTimelineFromShotsWithAudio();
        ui.showStatus(isARoll ? 'A-Roll timeline built from transcript sentences!' : 'Timeline built from storyboard, aligned to your A-roll audio.', false, 3000);
    } else if ((isSeedOnly || isARoll) && state.currentScenes.length > 0 && state.uploadedVideoElement) {
        const { buildTimelineFromShotsWithMediaDurations } = await import('./audio-upload-director');
        await buildTimelineFromShotsWithMediaDurations();
        ui.showStatus(isARoll ? 'A-Roll timeline built from video!' : 'Timeline built from storyboard.', false, 3000);
    } else if (isScript) {
        ui.showStatus(`Created storyboard from script with ${newShots.length} shots.`, false, 3500);
    } else {
        setTimeout(() => {
            const firstUploadBtn = document.querySelector('.upload-video-btn');
            if (firstUploadBtn) {
                firstUploadBtn.classList.add('ring-2', 'ring-indigo-500', 'animate-pulse');
                setTimeout(() => {
                    firstUploadBtn.classList.remove('ring-2', 'ring-indigo-500', 'animate-pulse');
                }, 6000);
                ui.showStatus(`Created blank storyboard. Click 'Upload' on shot 1 to begin!`, false, 4000);
            } else {
                ui.showStatus(`Created blank storyboard with ${newShots.length} shots.`, false, 3000);
            }
        }, 150);
    }
    
    ui.switchTab('storyboard');
    ui.updateWorkflowStepStatus(3, 'completed');

    // Activate Step 4 & AI Video Director button if A-Roll or any media is present
    const allShotsStats = state.currentScenes.flatMap((s: any) => (s.lines || [s]));
    const hasMediaReady = isARoll 
        || Boolean(state.uploadedVideoElement) 
        || Boolean(timelineState.masterAudioBuffer)
        || allShotsStats.some((shot: any) => !!shot.image_id || !!shot._imageObjectURL || !!shot.video_id || !!shot._videoObjectURL || shot.talkingHeadMode === 'full' || shot.talkingHeadMode === 'split');

    if (hasMediaReady) {
        if (dom.videoDirectorBtn) {
            dom.videoDirectorBtn.disabled = false;
            dom.videoDirectorBtn.classList.remove('opacity-50');
        }
        if (dom.videoExportBtn) {
            dom.videoExportBtn.disabled = false;
        }
        ui.updateWorkflowStepStatus(4, 'active');
        const { updateStep4CadenceState } = await import('./masterAudioDirector');
        updateStep4CadenceState();
    }
}

export function addSingleBlankShot() {
    if (checkGuestRestriction("Adding Shot")) return;
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const totalShots = isPaced 
        ? state.currentScenes.length 
        : state.currentScenes.reduce((acc: number, s: any) => acc + (s.lines?.length || 1), 0);
    const newIndex = totalShots;
    const newShot: CinematicShot = {
        id: 'shot_' + Date.now() + '_' + newIndex,
        shot_number: newIndex + 1,
        duration_seconds: 4,
        image_prompt: "",
        text_reference: "",
        camera_movement: "static",
        image_id: null,
        _imageObjectURL: undefined,
        _videoObjectURL: undefined,
        videoStartOffset: 0,
        talkingHeadMode: 'none'
    };
    if (isPaced || state.currentScenes.length === 0) {
        state.currentScenes.push(newShot);
    } else {
        const lastScene = state.currentScenes[state.currentScenes.length - 1];
        if (lastScene.lines) {
            lastScene.lines.push(newShot);
        } else {
            state.currentScenes.push(newShot);
        }
    }
    ui.renderResults(state.currentScenes);
    saveVersion(false);
    ui.showStatus(`Shot ${newIndex + 1} added to storyboard.`, false, 2500);
}


function getPacingDensityGuideline(pacingFactor: string): string {
    switch (pacingFactor) {
        case 'documentary':
            return `PACING DIRECTIVE: "DOCUMENTARY / PRESTIGE" (30–60 SECONDS PER SHOT)
- Beat Density: Aim for approximately 75 to 150 words per visual beat (~30 to 60 seconds of narration).
- Editing Rule: Sustained, deliberate takes with minimal cuts. Hold scenes across multiple sentences or full paragraphs. Create a new shot only when the core subject or physical setting shifts. Do NOT fragment single sentences.`;
        case 'glacial':
            return `PACING DIRECTIVE: "GLACIAL / CONTEMPLATIVE" (20–30 SECONDS PER SHOT)
- Beat Density: Aim for approximately 50 to 75 words per visual beat (~20 to 30 seconds of narration).
- Editing Rule: Long, atmospheric camera holds over expansive narrative phrases. Keep whole sentences together.`;
        case 'snail':
            return `PACING DIRECTIVE: "SNAIL / MEASURED" (15–20 SECONDS PER SHOT)
- Beat Density: Aim for approximately 38 to 50 words per visual beat (~15 to 20 seconds of narration).
- Editing Rule: Deliberate cinematic pace. Let visuals breathe across 2 to 3 related sentences.`;
        case 'very_slow':
            return `PACING DIRECTIVE: "VERY SLOW / DELIBERATE" (12–15 SECONDS PER SHOT)
- Beat Density: Aim for approximately 30 to 38 words per visual beat (~12 to 15 seconds of narration).
- Editing Rule: Steady, contemplative rhythm. Group related narrative clauses into cohesive visual scenes.`;
        case 'slow':
            return `PACING DIRECTIVE: "SLOW / CINEMATIC" (8–12 SECONDS PER SHOT)
- Beat Density: Aim for approximately 20 to 30 words per visual beat (~8 to 12 seconds of narration).
- Editing Rule: Measured cinematic tempo. Hold complete thoughts and sentences before cutting to new camera angles.`;
        case 'fast':
            return `PACING DIRECTIVE: "FAST / HIGH RETENTION" (STRICTLY 3 TO 5 SECONDS PER SHOT)
- Beat Density: Aim strictly for approximately 7 to 13 words per visual beat (averaging a cut every 3 to 5 seconds of narration).
- Editing Rule: High visual energy and rapid cuts. Cut frequently on action beats, key nouns/verbs, dialogue turns, punchlines, and micro-reactions. Split longer sentences into 2 or 3 dynamic camera angles or perspectives to maintain rapid visual motion every 3–5 seconds.`;
        case 'normal':
        default:
            return `PACING DIRECTIVE: "BALANCED / DYNAMIC" (5–8 SECONDS PER SHOT)
- Beat Density: Aim for approximately 13 to 20 words per visual beat (~5 to 8 seconds of narration).
- Editing Rule: Natural dynamic rhythm. Cut on complete thoughts, premise shifts, or distinct narrative beats every 5 to 8 seconds.`;
    }
}


function getVisualConsistencyContext(): string {
    const sections: string[] = [];
    if (state.characterProfiles && state.characterProfiles.length > 0) {
        const charLines = state.characterProfiles.map(c => {
            const allAliases = utils.getCharacterAliases(c, state.characterProfiles);
            const aliasList = allAliases.length > 1 ? ` (Also referred to in script as: ${allAliases.join(', ')})` : '';
            return `- ${c.name}${aliasList}: ${c.appearance_anchor || c.sheet_prompt || ''}`;
        }).join('\n');
        const exampleName = state.characterProfiles[0]?.name || 'Character Name';
        const parts = exampleName.split(/\s+/).filter(Boolean);
        const exampleFirst = parts[0] || 'Character';
        sections.push(`CONSISTENT CHARACTERS (Maintain these appearance, wardrobe, and facial details):\n${charLines}\n\n* CRITICAL CHARACTER NAMING & CONSISTENCY RULE: Whenever a character appears in an "image_prompt", ALWAYS write their full canonical name (e.g. write "${exampleName}", NEVER truncate to just a first name like "${exampleFirst}" or pronouns like "he" or "she"). Downstream image generation relies on the full canonical name to attach their locked visual appearance.\nIf the narrative script refers to a character by their first name, nickname, or title (e.g. "${exampleFirst}"), you MUST resolve it to their full canonical name ("${exampleName}") in the "image_prompt".`);
    }
    if (state.locationProfiles && state.locationProfiles.length > 0) {
        const locLines = state.locationProfiles.map(l => `- ${l.name}: ${l.description || ''}`).join('\n');
        sections.push(`CONSISTENT LOCATIONS (Maintain these environmental & architectural details):\n${locLines}`);
    }
    if (state.keyElementProfiles && state.keyElementProfiles.length > 0) {
        const propLines = state.keyElementProfiles.map(p => `- ${p.name}: ${p.description || ''}`).join('\n');
        sections.push(`CONSISTENT KEY PROPS & OBJECTS:\n${propLines}`);
    }
    if (sections.length === 0) {
        return `CINEMATIC VISUAL PACING & DYNAMIC CUTTING DIRECTIVE:
- Prioritize meaningful visual beats matching the requested pacing density.
- Group closely related sentence clauses into unified, coherent visual scenes rather than splitting every single sentence into an isolated cut.
- Cut purposefully on: visual action verbs, environmental shifts, focal subject changes, and camera perspectives (Wide establishing -> Medium action -> Macro detail -> Dynamic angle).\n\n`;
    }
    return `IMMUTABLE VISUAL CONSISTENCY ANCHORS:\n${sections.join('\n\n')}\n\n`;
}


function getRollingAnchorContext(previousShots: any[]): string {
    if (!previousShots || previousShots.length === 0) return '';
    const lastShots = previousShots.slice(-2);
    const formatted = lastShots.map((s, idx) => {
        const num = previousShots.length - lastShots.length + idx + 1;
        return `Shot ${num} (${s.camera_movement || 'static'}):
- Ending Narration: "${(s.text_reference || '').slice(-120)}"
- Visual Appearance: "${s.image_prompt || ''}"`;
    }).join('\n\n');

    return `ROLLING CONTINUITY ANCHOR (Previous ${lastShots.length} shots immediately preceding this chunk):
${formatted}
* CONTINUITY INSTRUCTION: The first shot of this current chunk must seamlessly match the character appearance, lighting, and wardrobe established in the anchor above.\n\n`;
}


/**
 * Complete Pipeline Audit Logger for Visual Director:
 * Logs all 12 stages of visual prompt derivation for debugging.
 */
export function logVisualDirectorPipelineShot(
    shotIndex: number,
    rawGeminiSnippet: any,
    parsedShot: any,
    enrichedPrompt: string,
    finalExportedScene: string
) {
    console.group(`🎬 [Visual Director Pipeline Audit — Shot ${shotIndex + 1}]`);
    console.log(`1. Raw Gemini response:`, rawGeminiSnippet || '(Fallback / generated)');
    console.log(`2. Parsed storyboard object:`, parsedShot);
    console.log(`3. visual_type:`, parsedShot?.visual_type || '(none)');
    console.log(`4. narrative_function:`, parsedShot?.narrative_function || '(none)');
    console.log(`5. visual_concept:`, parsedShot?.visual_concept || '(none)');
    console.log(`6. subjects:`, parsedShot?.subjects || '(none)');
    console.log(`7. action:`, parsedShot?.action || '(none)');
    console.log(`8. environment:`, parsedShot?.environment || '(none)');
    console.log(`9. composition:`, parsedShot?.composition || '(none)');
    console.log(`10. image_prompt (raw from AI):`, parsedShot?.image_prompt || '(none)');
    console.log(`11. image_prompt after validation/enrichment:`, enrichedPrompt);
    console.log(`12. final exported [SCENE]:\n${finalExportedScene}`);
    console.groupEnd();
}

export function isGenericFallback(promptText: string): boolean {
    if (!promptText || typeof promptText !== 'string' || !promptText.trim()) return true;
    const p = promptText.toLowerCase();
    return p.includes('the central scene elements are positioned with natural physical depth') ||
           p.includes('grounded physical setting with natural ambient lighting') ||
           p.includes('cinematic visual scene capturing the narrative beat') ||
           p.includes('central narrative subjects') ||
           p.includes('framed against heavy storm clouds') ||
           p.includes('showing subtle micro-expressions');
}

/**
 * Second AI Repair Pass: when a shot has missing or weak/paraphrased Visual Director fields,
 * this function invokes Gemini with the narrative context in robust batches to produce high-fidelity visual reasoning
 * and a concrete image prompt without falling back to keyword heuristics.
 */
export async function repairShotsWithAIRepairPass(
    flawedShots: Array<{ shot: any; index: number; narrativeText: string }>,
    storyContext: string,
    signal?: AbortSignal
): Promise<Map<number, any>> {
    const repairedMap = new Map<number, any>();
    if (!flawedShots || flawedShots.length === 0) return repairedMap;

    try {
        const { Type } = await import('@google/genai');
        const repairSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    shot_index: { type: Type.INTEGER, description: "0-based index of the shot being repaired" },
                    visual_type: { type: Type.STRING },
                    narrative_function: { type: Type.STRING },
                    visual_concept: { type: Type.STRING },
                    subjects: { type: Type.STRING },
                    action: { type: Type.STRING },
                    environment: { type: Type.STRING },
                    composition: { type: Type.STRING },
                    camera: { type: Type.STRING },
                    mood: { type: Type.STRING },
                    continuity_notes: { type: Type.STRING },
                    image_prompt: { type: Type.STRING },
                    camera_movement: { type: Type.STRING, enum: ['static', 'pan', 'zoom', 'tilt'] }
                },
                required: [
                    'shot_index', 'visual_type', 'narrative_function', 'visual_concept', 'subjects',
                    'action', 'environment', 'composition', 'camera', 'mood', 'continuity_notes',
                    'image_prompt', 'camera_movement'
                ]
            }
        };

        const repairSystemInstruction = `You are an elite film director, cinematographer, and visual storyboard artist. You convert narrative meaning into physical cinematic imagery. Never output generic keyword placeholders or copy narration into image descriptions. Describe what is physically visible in frame with natural lighting and grounded environment.`;

        const batchSize = 10;
        for (let b = 0; b < flawedShots.length; b += batchSize) {
            if (signal?.aborted) break;
            const currentBatch = flawedShots.slice(b, b + batchSize);
            const shotsData = currentBatch.map(item => ({
                shot_index: item.index,
                narrative_segment: item.narrativeText,
                current_draft: item.shot?.image_prompt || ''
            }));

            const repairPrompt = `You are a World-Class Visual Director performing a Second AI Repair Pass on storyboard shots.
The initial generation produced missing, weak, or generic prompts for these specific shots.

FULL STORY CONTEXT (Narrative Reference):
"""
${storyContext.slice(0, 12000)}
"""

SHOTS TO REPAIR (${b + 1} to ${Math.min(b + batchSize, flawedShots.length)} of ${flawedShots.length}):
${JSON.stringify(shotsData, null, 2)}

TASK:
For each shot, reason through the underlying physical reality and output a complete, production-ready storyboard shot with all required visual director fields.
The "image_prompt" MUST describe what is physically visible in the frame (subjects, setting, lighting, action, composition) and NEVER paraphrase or repeat the voiceover text.`;

            try {
                const resp = await generateContentWithFallback({
                    contents: [{ role: 'user', parts: [{ text: repairPrompt }] }],
                    systemInstruction: repairSystemInstruction,
                    mimeType: "application/json",
                    schema: repairSchema,
                    maxOutputTokens: 16384
                }, signal);

                const raw = resp.text || "[]";
                let parsed: any = null;
                try {
                    parsed = utils.sanitizeAndParseJson(raw);
                } catch {
                    const match = raw.match(/\[[\s\S]*\]/);
                    parsed = match ? JSON.parse(match[0]) : null;
                }

                if (Array.isArray(parsed)) {
                    for (const r of parsed) {
                        if (typeof r.shot_index === 'number') {
                            repairedMap.set(r.shot_index, r);
                        }
                    }
                }
            } catch (batchErr) {
                console.warn(`[Storyboard] Repair batch ${b / batchSize + 1} encountered an error:`, batchErr);
            }
        }
    } catch (err) {
        console.warn("[Storyboard] Second AI repair pass encountered an error:", err);
    }

    return repairedMap;
}

/**
 * Detects whether an image prompt is merely a weak paraphrase or default template of the narration.
 */
export function isLazyParaphrase(promptText: string, narrationText: string): boolean {
    if (!promptText || !promptText.trim()) return true;
    const cleanPrompt = promptText.trim().toLowerCase();
    const cleanNarration = (narrationText || '').trim().toLowerCase();

    // Check for empty or generic filler strings
    if (/^(image|photo|scene|shot|visual|illustration|render|prompt)$/i.test(cleanPrompt)) {
        return true;
    }

    // If prompt is virtually identical to narration (copy-paste)
    if (cleanNarration && cleanPrompt === cleanNarration) {
        return true;
    }

    // Check for weak boilerplate starters: "Cinematic visual depicting...", "An image of...", etc.
    const boilerplatePrefix = /^(?:cinematic visual depicting|the scene depicts|an image of|a visual depicting|a shot showing|image of|photo of|scene depicting)\s+/i;
    if (boilerplatePrefix.test(cleanPrompt)) {
        const stripped = cleanPrompt.replace(boilerplatePrefix, '').trim();
        if (!stripped || stripped === cleanNarration) return true;
        const strippedWords = stripped.split(/\s+/).filter(w => w.length > 2);
        const narrWords = new Set(cleanNarration.split(/\s+/).filter(w => w.length > 2));
        if (strippedWords.length > 0) {
            const matches = strippedWords.filter(w => narrWords.has(w)).length;
            if (matches / strippedWords.length > 0.4) return true;
        }
    }

    if (!cleanNarration) return false;

    // Word overlap check: if prompt is >85% identical word-for-word to narration with NO visual descriptors
    const promptWords = cleanPrompt.split(/\s+/).filter(w => w.length > 3);
    const narrationWords = new Set(cleanNarration.split(/\s+/).filter(w => w.length > 3));

    if (promptWords.length === 0) return true;

    let overlapCount = 0;
    for (const w of promptWords) {
        if (narrationWords.has(w)) overlapCount++;
    }

    const overlapRatio = overlapCount / promptWords.length;
    const hasVisualDescriptors = /(lighting|atmosphere|shot|close-up|wide angle|horizon|shadow|perspective|camera|focus|composition|view|landscape|portrait|dramatic|cinematic|photographic|texture|color|monochrome|chiaroscuro|depth of field|volumetric|lens|framing|scale|foreground|background)\b/i.test(cleanPrompt);

    return overlapRatio > 0.85 && !hasVisualDescriptors;
}

/**
 * Conservative Emergency Fallback:
 * Produces a grounded, concrete cinematic scene description without extracting words as fake subjects or using keyword heuristics.
 */
export function createIntelligentVisualFallback(textSegment: string, index: number, totalShots: number = 1): any {
    const text = (textSegment || '').trim();
    const isOpening = index === 0;
    const isEnding = index === totalShots - 1 && totalShots > 1;

    let visualType = 'WORLD_BUILDING';
    let narrativeFunction = 'SCENE_BEAT';
    let composition = 'Medium cinematic framing with balanced focal depth and natural composition';

    if (isOpening) {
        visualType = 'ENVIRONMENTAL_ESTABLISHING';
        narrativeFunction = 'SETTING_ESTABLISHMENT';
        composition = 'Wide establishing cinematic shot with clear horizon and environmental depth';
    } else if (isEnding) {
        visualType = 'NARRATIVE_TRANSITION';
        narrativeFunction = 'RESOLUTION';
        composition = 'Wide panoramic cinematic framing with rich ambient lighting';
    }

    const cameraMovement = isOpening ? 'pan' : (index % 2 === 0 ? 'zoom' : 'static');
    const environment = 'Grounded physical setting with natural ambient lighting and atmospheric depth';
    const visualConcept = 'Cinematic visual scene capturing the narrative beat in a clear physical setting with balanced composition';
    const actionDesc = 'Positioned with natural physical depth, clear focal balance, and dramatic cinematic lighting';
    const subjects = ['Central narrative subjects'];

    const imagePrompt = `${composition}. In a ${environment.toLowerCase()}, the central scene elements are ${actionDesc}. Strong volumetric lighting, natural textures, and crisp cinematic focus.`;

    return {
        _isFallback: true,
        visual_type: visualType,
        narrative_function: narrativeFunction,
        visual_concept: visualConcept,
        subjects: subjects,
        action: actionDesc,
        environment: environment,
        composition: composition,
        camera: `Cinematic 35mm lens, ${cameraMovement} camera setup`,
        mood: 'Cinematic, immersive, and visually grounded',
        continuity_notes: `Maintain visual lighting and physical environment continuity across adjacent shots`,
        image_prompt: imagePrompt,
        text_reference: text,
        camera_movement: cameraMovement,
        talkingHeadMode: 'none'
    };
}

/**
 * Enriches a weak/paraphrased prompt purely using the shot's Visual Director reasoning metadata:
 * composition + environment + subjects + action + visual_concept + camera + mood
 */
export function enrichLazyImagePrompt(shot: any, narrativeText: string): string {
    const comp = shot.composition || 'Cinematic framing with balanced focal depth';
    const env = shot.environment || 'Detailed physical environment with atmospheric natural lighting';
    const subjects = Array.isArray(shot.subjects) && shot.subjects.length > 0 
        ? shot.subjects.join(', ') 
        : (typeof shot.subjects === 'string' && shot.subjects.trim() ? shot.subjects : '');
    const action = shot.action || '';
    const concept = shot.visual_concept || '';
    const camera = shot.camera || '35mm lens perspective';
    const mood = shot.mood || 'Cinematic atmosphere';

    const parts: string[] = [];
    if (comp) parts.push(comp);
    if (env) parts.push(`Set in a ${env.toLowerCase()}`);
    if (subjects && !/central narrative subjects/i.test(subjects)) parts.push(`Featuring ${subjects}`);
    if (action) parts.push(action);
    if (concept) parts.push(concept);
    if (camera) parts.push(`Camera setup: ${camera}`);
    if (mood) parts.push(`Atmosphere: ${mood}`);

    if (parts.length >= 3) {
        return parts.join('. ') + '.';
    }

    // Conservative fallback if metadata is sparse
    const fallbackShot = createIntelligentVisualFallback(narrativeText, 0, 1);
    return fallbackShot.image_prompt;
}

/**
 * Merges two shots into ONE coherent physical scene that visually represents both beats.
 */
export function synthesizeMergedVisualConcept(firstShot: any, secondShot: any): any {
    const mergedText = `${firstShot.text_reference || ''} ${secondShot.text_reference || ''}`.trim();
    
    const combinedSubjects = Array.from(new Set([
        ...(Array.isArray(firstShot.subjects) ? firstShot.subjects : [firstShot.subjects]),
        ...(Array.isArray(secondShot.subjects) ? secondShot.subjects : [secondShot.subjects])
    ].filter(Boolean)));

    const subjectsStr = combinedSubjects.length > 0 ? combinedSubjects.join(' and ') : '';
    const env = firstShot.environment || secondShot.environment || 'Atmospheric cinematic landscape with natural lighting';
    const comp = 'Unified widescreen composition capturing the complete physical narrative beat';
    
    const unifiedConcept = `Cohesive single scene integrating the setup and progression into one unified visual frame.`;
    const action1 = (firstShot.action || '').replace(/^Physical representation of:\s*/i, '');
    const action2 = (secondShot.action || '').replace(/^Physical representation of:\s*/i, '');
    const combinedAction = action1 && action2 ? `${action1}, transitioning into ${action2}` : (action1 || action2 || 'demonstrating unified physical progression');

    const subjectClause = subjectsStr ? `, featuring ${subjectsStr}` : '';
    const unifiedPrompt = `${comp}. Set in a ${env.toLowerCase()}${subjectClause}, ${combinedAction}. Rich volumetric lighting and balanced field of focus bring cohesive scale to the entire frame.`;

    return {
        ...firstShot,
        text_reference: mergedText,
        visual_type: firstShot.visual_type || secondShot.visual_type || 'WORLD_BUILDING',
        narrative_function: firstShot.narrative_function || secondShot.narrative_function || 'WORLD_BUILDING',
        visual_concept: unifiedConcept,
        subjects: combinedSubjects,
        action: combinedAction,
        environment: env,
        composition: comp,
        camera: firstShot.camera || secondShot.camera || '35mm lens, static camera setup',
        mood: firstShot.mood || secondShot.mood || 'Cinematic and balanced',
        image_prompt: unifiedPrompt
    };
}

/**
 * Splits a shot into distinct visual concepts and independent camera perspectives for each resulting beat.
 */
export function generateSplitVisualConcept(parentShot: any, partText: string, subIndex: number): any {
    const text = (partText || '').trim();
    const isFirstPart = subIndex === 0;

    const baseEnv = parentShot.environment || 'Detailed physical environment with natural lighting';
    const baseSubjects = parentShot.subjects || [];

    // Distinct visual interpretations for Part 1 vs Part 2
    let chosenComp: string;
    let splitConcept: string;
    let splitAction: string;
    let chosenCam: string;

    if (isFirstPart) {
        chosenComp = 'Wide establishing framing introducing the primary visual setup';
        splitConcept = 'Opening physical beat establishing the scene foundation and environment';
        splitAction = 'Positioned in the frame establishing initial physical state and spatial context';
        chosenCam = 'pan';
    } else {
        chosenComp = 'Medium closer perspective capturing the physical continuation and focal impact';
        splitConcept = 'Follow-through physical beat detailing the action progression and consequence';
        splitAction = 'Progressing into active physical movement with dynamic visual momentum';
        chosenCam = 'zoom';
    }

    const splitPrompt = `${chosenComp}. In a ${baseEnv.toLowerCase()}, the scene elements are ${splitAction}. Cohesive volumetric lighting and atmospheric continuity with surrounding scene.`;

    return {
        ...parentShot,
        text_reference: text,
        visual_type: parentShot.visual_type || (isFirstPart ? 'SETTING_ESTABLISHMENT' : 'CHARACTER_ACTION'),
        narrative_function: isFirstPart ? 'SETTING_ESTABLISHMENT' : 'ESCALATION',
        visual_concept: splitConcept,
        subjects: baseSubjects,
        action: splitAction,
        environment: baseEnv,
        composition: chosenComp,
        camera: `Cinematic 35mm lens, ${chosenCam} movement setup`,
        mood: parentShot.mood || 'Cinematic, immersive, and focused',
        camera_movement: chosenCam,
        image_prompt: splitPrompt
    };
}

async function _executeAnalyzeStory(storyText: string, detailLevel: string, pacingFactor: string) {
    ui.setButtonsDisabled(true);
    let stopProgress: any = null;
    let signal: AbortSignal | undefined = undefined;

    const onCancel = () => {
        if (stopProgress) stopProgress();
        ui.closeProcessingModal();
        ui.setButtonsDisabled(false);
    };

    try {
        signal = await ui.openProcessingModal('Analyzing Storyboard', true, 'Stop Analysis', onCancel);
        ui.updateProcessingProgress(0, 'Reading narrative structure...');
        stopProgress = utils.startSimulatedProgress('Translating script into cinematic shots...', ui.updateProcessingProgress);

        const wordCount = storyText.split(/\s+/).filter(Boolean).length;
        const narrationMinutes = Math.max(0.2, wordCount / 150);

        const selectedRange = (pacingMap as any)[pacingFactor] || pacingMap.normal;
        const elasticTargetMin = Math.max(1, Math.round(narrationMinutes * selectedRange.min));
        const elasticTargetMax = Math.max(elasticTargetMin, Math.round(narrationMinutes * selectedRange.max));

        const consistencyContext = getVisualConsistencyContext();
        const pacingGuideline = getPacingDensityGuideline(pacingFactor);

        let customBudgetDirective = '';
        if (detailLevel === 'custom') {
            const count = parseInt(dom.customShotCountInput?.value, 10);
            const valid = isNaN(count) || count < 1 ? 10 : Math.min(90, count);
            customBudgetDirective = `\n- USER EXACT BUDGET: The user has budgeted EXACTLY ${valid} shots for the whole project.`;
        }

        const { Type } = await import('@google/genai');
        const schema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    visual_type: { 
                        type: Type.STRING, 
                        description: "Primary visual category, e.g., ENVIRONMENTAL_ESTABLISHING, HISTORICAL_EVENT, CHARACTER_ACTION, ANIMAL_BEHAVIOR, ECOSYSTEM, CAUSE_AND_EFFECT, BEFORE_AFTER, COMPARISON, SCALE, MAP_OR_GEOGRAPHY, SCIENTIFIC_CONCEPT, ABSTRACT_CONCEPT, NARRATIVE_TRANSITION, CORRECTION_OR_MYTH_BUST, CONVERSATION, EMOTIONAL_MOMENT" 
                    },
                    narrative_function: { 
                        type: Type.STRING, 
                        description: "Narrative role, e.g., INTRODUCTION, WORLD_BUILDING, CHARACTER_INTRODUCTION, SETTING_ESTABLISHMENT, HISTORICAL_CONTEXT, CAUSE, EFFECT, TRANSITION, ESCALATION, CONFLICT, REVELATION, EXPLANATION, COMPARISON, CORRECTION, MYTH_BUST, EMOTIONAL_BEAT, ACTION, CONSEQUENCE, RESOLUTION, ENDING" 
                    },
                    visual_concept: { 
                        type: Type.STRING, 
                        description: "Core visual director concept that conveys the narration beat on screen rather than paraphrasing voiceover text" 
                    },
                    subjects: { 
                        type: Type.STRING, 
                        description: "Primary focal subjects present in frame with canonical names" 
                    },
                    action: { 
                        type: Type.STRING, 
                        description: "Specific visible action, state, or movement occurring in frame" 
                    },
                    environment: { 
                        type: Type.STRING, 
                        description: "Physical setting, architecture, lighting, time of day, and weather" 
                    },
                    composition: { 
                        type: Type.STRING, 
                        description: "Framing, camera angle, rule-of-thirds, perspective, and depth of field" 
                    },
                    camera: { 
                        type: Type.STRING, 
                        description: "Lens selection and camera perspective setup" 
                    },
                    mood: { 
                        type: Type.STRING, 
                        description: "Emotional tone, atmosphere, and color palette" 
                    },
                    continuity_notes: { 
                        type: Type.STRING, 
                        description: "Visual continuity anchors connecting to surrounding shots" 
                    },
                    image_prompt: { 
                        type: Type.STRING, 
                        description: "Vivid, production-ready visual description of what is actually VISIBLE on screen, derived FROM the reasoning above. Must NOT paraphrase the narration." 
                    },
                    text_reference: { 
                        type: Type.STRING, 
                        description: "Verbatim segment of narration for this shot" 
                    },
                    camera_movement: { type: Type.STRING, enum: ['static', 'pan', 'zoom', 'tilt'] },
                    talkingHeadMode: { type: Type.STRING, enum: ['none', 'full', 'split', 'pip'] }
                },
                required: [
                    'visual_type', 'narrative_function', 'visual_concept', 'subjects', 'action', 
                    'environment', 'composition', 'camera', 'mood', 'continuity_notes',
                    'image_prompt', 'text_reference', 'camera_movement'
                ]
            }
        };

        const storyboardSystemInstruction = `You are a World-Class Film Director, Production Designer, and Visual Screenwriter.
Your goal is to transform narrative scripts into highly visual, cinematic storyboards for digital video production.

CRITICAL VISUAL DIRECTING PRINCIPLES:
1. DO NOT PARAPHRASE NARRATION: The "image_prompt" must NEVER simply repeat or rephrase the narration text (e.g., if narration says "234 million years ago, Earth was a baking desert world hit by a strange climate shift...", DO NOT write "Cinematic visual depicting 234 million years ago..."). Instead, describe the concrete physical imagery that VISUALLY CONVEYS that concept on screen (e.g., "A vast Late Triassic Pangaean desert stretches beneath an oppressive sun-baked sky, with cracked earth, sparse prehistoric vegetation and exposed rock dominating the landscape. Dense storm systems gather on the distant horizon...").

2. STEP-BY-STEP VISUAL REASONING ENGINE:
   For every shot, you MUST complete the visual reasoning fields BEFORE generating the "image_prompt":
   - "visual_type": Primary visual category (ENVIRONMENTAL_ESTABLISHING, HISTORICAL_EVENT, CHARACTER_ACTION, ANIMAL_BEHAVIOR, ECOSYSTEM, CAUSE_AND_EFFECT, BEFORE_AFTER, COMPARISON, SCALE, MAP_OR_GEOGRAPHY, SCIENTIFIC_CONCEPT, ABSTRACT_CONCEPT, NARRATIVE_TRANSITION, CORRECTION_OR_MYTH_BUST, CONVERSATION, EMOTIONAL_MOMENT).
   - "narrative_function": Narrative role (INTRODUCTION, WORLD_BUILDING, CHARACTER_INTRODUCTION, SETTING_ESTABLISHMENT, HISTORICAL_CONTEXT, CAUSE, EFFECT, TRANSITION, ESCALATION, CONFLICT, REVELATION, EXPLANATION, COMPARISON, CORRECTION, MYTH_BUST, EMOTIONAL_BEAT, ACTION, CONSEQUENCE, RESOLUTION, ENDING).
   - "visual_concept": Core visual idea that demonstrates this narrative beat without relying on voiceover.
   - "subjects": Primary focal subjects present in frame with canonical names.
   - "action": Specific physical action, movement, or state occurring in the shot.
   - "environment": Physical setting, architecture, lighting, time of day, and weather.
   - "composition": Camera angle, framing (Wide establishing, Medium close-up, Macro detail, Low angle), and depth of field.
   - "camera": Lens choice and perspective.
   - "mood": Emotional tone, atmosphere, and lighting/color palette.
   - "continuity_notes": Connect visual anchors (wardrobe, geography, lighting angle) with surrounding shots.
   - "image_prompt": Synthesize all the above reasoning into a vivid, production-ready visual description detailing what is physically seen in frame.

3. UNIVERSAL VISUAL REASONING RULES ACROSS DOMAINS:
   - Abstract Narration & Ideas: Translate internal thoughts, philosophies, or passage of time into concrete visual metaphors (e.g., decaying manuscript pages, a flickering candle in a shadowed study, split mirror reflections, shifting storm fronts).
   - Cause & Effect / Processes: Show the physical mechanics in motion (e.g., spark igniting dry tinder; pressure fractures spreading across glass; mechanical gears locking).
   - Before / After & Comparisons: Use side-by-side scale framing, split composition, or transformed environmental lighting to highlight stark contrast.
   - Historical / Era Context: Ground scenes in period-accurate architecture, materials, wardrobe, lighting sources, and atmospheric color tones.
   - Scientific & Technical Concepts: Utilize macro close-ups, environmental field studies, physical scale comparisons, or laboratory apparatus rather than text graphics.
   - Emotional Beats: Focus on subtle facial micro-expressions, posture, hand gestures, dramatic light/shadow interplay, or environmental mood mirroring.
   - Myth-Busting / Corrections: Visually contrast popular misconceptions with grounded physical reality.
   - Transitions & Establishing Shots: Use wide environmental establishing shots with clear sense of horizon, weather, and time of day to anchor new scenes.

4. REMAIN DOMAIN-AGNOSTIC: Apply these visual principles universally regardless of whether the story is scientific, biblical/historical, fictional drama, horror, business/tech, psychology, or travel.

5. VERBATIM SCRIPT RETENTION: Keep "text_reference" EXACTLY verbatim from the provided script text. The concatenated text_reference of all shots MUST cover the script word for word.
6. CHARACTER & WORLD CONSISTENCY: Always use full canonical names for named characters and maintain established location/prop visual anchors.`;

        let shotsList: any[] = [];
        let rawSampleSnippet: any = null;

        // Scripts up to 550 words run in a unified single pass with full narrative scope.
        // For longer scripts (>550 words), process in sequential, focused ~450-word chunks.
        const chunkThreshold = 550;
        const maxWordsPerChunk = 450;
        if (wordCount > chunkThreshold) {
            console.log(`[Storyboard] Long story detected (${wordCount} words, pacing: ${pacingFactor}). Processing in contextual ${maxWordsPerChunk}-word chunks...`);
            const scriptChunks = utils.splitScriptIntoStoryChunks(storyText, maxWordsPerChunk);

            for (let chunkIdx = 0; chunkIdx < scriptChunks.length; chunkIdx++) {
                if (signal?.aborted) {
                    if (stopProgress) stopProgress();
                    return;
                }
                const chunkText = scriptChunks[chunkIdx];
                const chunkWords = chunkText.split(/\s+/).filter(Boolean).length;
                const chunkMins = Math.max(0.2, chunkWords / 150);
                const chunkTargetMin = Math.max(1, Math.round(chunkMins * selectedRange.min));
                const chunkTargetMax = Math.max(chunkTargetMin, Math.round(chunkMins * selectedRange.max));

                ui.updateProcessingProgress(
                    Math.round((chunkIdx / scriptChunks.length) * 100),
                    `Analyzing Part ${chunkIdx + 1} of ${scriptChunks.length} (${chunkWords} words)...`
                );

                const rollingAnchor = getRollingAnchorContext(shotsList);

                const chunkPrompt = `FULL STORY CONTEXT (Immutable Narrative Reference):
"""
${storyText.length > 30000 ? storyText.slice(0, 25000) + '\n...[Story continues]' : storyText}
"""

${consistencyContext}${rollingAnchor}TASK: Convert Part ${chunkIdx + 1} of ${scriptChunks.length} into cinematic storyboard shots.

${pacingGuideline}${customBudgetDirective}
- Part ${chunkIdx + 1} Word Count: ${chunkWords} words (~${chunkMins.toFixed(1)} min)
- SHOT PACING & VISUAL BEATS: Divide this section into meaningful visual beats matching the target range of ${chunkTargetMin} to ${chunkTargetMax} shots (target: ~${Math.round((chunkTargetMin + chunkTargetMax) / 2)} shots for ${pacingFactor} pacing). Group closely related sentence clauses into unified, coherent visual scenes rather than splitting every single sentence into an isolated cut.

STRICT INSTRUCTIONS FOR PART ${chunkIdx + 1}:
1. Produce a JSON array of storyboard shots for Part ${chunkIdx + 1} ONLY.
2. VERBATIM SCRIPT RETENTION: The concatenated "text_reference" of all shots in this chunk MUST contain every single word of Part ${chunkIdx + 1} from beginning to end without skipping, summarizing, or paraphrasing.
3. For each shot fulfill all visual director reasoning fields (visual_type, narrative_function, visual_concept, subjects, action, environment, composition, camera, mood, continuity_notes) before synthesizing the final image_prompt.

PART ${chunkIdx + 1} SCRIPT TO STORYBOARD:
"""
${chunkText}
"""`;

                try {
                    const chunkResp = await generateContentWithFallback({
                        contents: [{ role: 'user', parts: [{ text: chunkPrompt }] }],
                        systemInstruction: storyboardSystemInstruction,
                        mimeType: "application/json",
                        schema: schema,
                        maxOutputTokens: 65536
                    }, signal);

                    const rawChunkText = chunkResp.text || "[]";
                    if (!rawSampleSnippet && rawChunkText) rawSampleSnippet = rawChunkText.slice(0, 600);
                    let parsedChunk: any = null;
                    try {
                        parsedChunk = utils.sanitizeAndParseJson(rawChunkText);
                    } catch {
                        const match = rawChunkText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
                        try { parsedChunk = match ? JSON.parse(match[0]) : null; } catch { parsedChunk = null; }
                    }

                    let partShots: any[] = [];
                    if (Array.isArray(parsedChunk)) {
                        partShots = parsedChunk;
                    } else if (parsedChunk && typeof parsedChunk === 'object') {
                        partShots = parsedChunk.shots || parsedChunk.scenes || Object.values(parsedChunk).find(Array.isArray) || [];
                    }

                    if (partShots.length > 0) {
                        shotsList.push(...partShots);
                    } else {
                        const fallbackUnits = chunkText.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
                        const fallbackTarget = Math.max(1, Math.min(chunkTargetMax, Math.max(chunkTargetMin, fallbackUnits.length)));
                        const itemsPerShot = Math.max(1, Math.ceil(fallbackUnits.length / fallbackTarget));
                        for (let i = 0; i < fallbackTarget; i++) {
                            const seg = fallbackUnits.slice(i * itemsPerShot, (i + 1) * itemsPerShot).join(' ').trim();
                            if (!seg) continue;
                            shotsList.push(createIntelligentVisualFallback(seg, shotsList.length + i, fallbackTarget));
                        }
                    }
                } catch (chunkErr) {
                    console.warn(`[Storyboard] Error parsing chunk ${chunkIdx + 1}, using conservative fallback:`, chunkErr);
                    const fallbackUnits = chunkText.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
                    const fallbackTarget = Math.max(1, Math.min(chunkTargetMax, Math.max(chunkTargetMin, fallbackUnits.length)));
                    const itemsPerShot = Math.max(1, Math.ceil(fallbackUnits.length / fallbackTarget));
                    for (let i = 0; i < fallbackTarget; i++) {
                        const seg = fallbackUnits.slice(i * itemsPerShot, (i + 1) * itemsPerShot).join(' ').trim();
                        if (!seg) continue;
                        shotsList.push(createIntelligentVisualFallback(seg, shotsList.length + i, fallbackTarget));
                    }
                }
            }
        } else {
            // Standard single-pass analysis for scripts <= 2200 words with full narrative scope
            const prompt = `${consistencyContext}TASK: Analyze this story and split it into cinematic storyboard shots using the Visual Director reasoning engine.

${pacingGuideline}${customBudgetDirective}
- Script Word Count: ${wordCount} words (~${narrationMinutes.toFixed(1)} min of narration)
- SHOT PACING & VISUAL BEATS: Divide this script into meaningful visual beats matching the target range of ${elasticTargetMin} to ${elasticTargetMax} shots (target: ~${Math.round((elasticTargetMin + elasticTargetMax) / 2)} shots for ${pacingFactor} pacing). Group closely related sentence clauses into unified, coherent visual scenes rather than splitting every single sentence into an isolated cut. Each shot must represent a distinct physical camera setup or meaningful narrative beat.

STRICT INSTRUCTIONS:
1. Divide the script into cinematic storyboard shots according to the requested pacing density.
2. VERBATIM SCRIPT RETENTION: The concatenated "text_reference" of all shots MUST cover the entire story from start to finish verbatim without omitting or summarizing words.
3. For each shot fulfill all Visual Director reasoning fields BEFORE synthesizing the final "image_prompt". The "image_prompt" must describe what is physically visible in the frame and NOT paraphrase the narration.

STORY SCRIPT:
"""
${storyText}
"""`;

            const response = await generateContentWithFallback({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                systemInstruction: storyboardSystemInstruction,
                mimeType: "application/json",
                schema: schema,
                maxOutputTokens: 65536
            }, signal);

            if (signal?.aborted) {
                if (stopProgress) stopProgress();
                return;
            }

            const rawText = response.text || "[]";
            rawSampleSnippet = rawText.slice(0, 600);
            let parsed: any = null;
            try {
                parsed = utils.sanitizeAndParseJson(rawText);
            } catch (parseErr: any) {
                console.warn("Primary JSON parse failed in analyzeStory, attempting regex fallback:", parseErr);
                const match = rawText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
                try {
                    parsed = match ? JSON.parse(match[0]) : null;
                } catch {
                    parsed = null;
                }
            }

            if (Array.isArray(parsed)) {
                shotsList = parsed;
            } else if (parsed && typeof parsed === 'object') {
                shotsList = parsed.shots || parsed.scenes || parsed.storyboard || parsed.lines || parsed.data || Object.values(parsed).find(Array.isArray) || [];
            }
        }

        if (stopProgress) stopProgress();

        // Intelligent client-side fallback if AI output failed to parse into valid JSON shots
        if (!shotsList || shotsList.length === 0) {
            console.warn("AI returned unparseable or refusal response. Constructing conservative beat-based fallback storyboard from script.");
            const sentences = storyText.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
            const rawParagraphs = storyText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
            const units = sentences.length >= elasticTargetMin ? sentences : (rawParagraphs.length >= elasticTargetMin ? rawParagraphs : sentences);
            
            const totalShotsCount = Math.min(elasticTargetMax, Math.max(elasticTargetMin, units.length));
            const itemsPerShot = Math.max(1, Math.ceil(units.length / totalShotsCount));
            
            shotsList = [];
            for (let i = 0; i < totalShotsCount; i++) {
                const textSegment = units.slice(i * itemsPerShot, (i + 1) * itemsPerShot).join(' ').trim();
                if (!textSegment) continue;
                shotsList.push(createIntelligentVisualFallback(textSegment, i, totalShotsCount));
            }
            
            if (shotsList.length === 0) {
                shotsList.push(createIntelligentVisualFallback(storyText.trim(), 0, 1));
            }
            
            ui.showStatus('Storyboard generated from script structure.', false, 4000);
        }

        // === SECOND AI REPAIR PASS FOR MISSING, WEAK, OR FALLBACK VISUAL METADATA ===
        const flawedShotItems: Array<{ shot: any; index: number; narrativeText: string }> = [];
        for (let i = 0; i < shotsList.length; i++) {
            const shot = shotsList[i];
            const nar = (shot.text_reference || shot.narration || shot.text || '').trim();
            const prompt = (shot.image_prompt || shot.prompt || '').trim();
            const isMissingReasoning = !shot.visual_concept || !shot.action || !shot.environment || !shot.composition;
            const isFallback = Boolean(shot._isFallback) || isGenericFallback(prompt) || isGenericFallback(shot.visual_concept || '') || isGenericFallback(shot.action || '');
            if (isFallback || !prompt || isLazyParaphrase(prompt, nar) || isMissingReasoning) {
                flawedShotItems.push({ shot, index: i, narrativeText: nar });
            }
        }

        if (flawedShotItems.length > 0) {
            console.log(`[Visual Director] Running Second AI Repair Pass on ${flawedShotItems.length} shots with missing or weak metadata...`);
            ui.updateProcessingProgress(90, `Refining visual direction with Second AI pass...`);
            const repairedMap = await repairShotsWithAIRepairPass(flawedShotItems, storyText, signal);
            for (const item of flawedShotItems) {
                const repaired = repairedMap.get(item.index);
                if (repaired && repaired.image_prompt && !isLazyParaphrase(repaired.image_prompt, item.narrativeText) && !isGenericFallback(repaired.image_prompt)) {
                    shotsList[item.index] = {
                        ...shotsList[item.index],
                        ...repaired,
                        _isFallback: false,
                        text_reference: item.narrativeText
                    };
                }
            }
        }

        // Shot Volume & Pacing Enforcement:
        // 1. If user requested an EXACT custom shot count, adjust shot count to match
        if (detailLevel === 'custom') {
            const count = parseInt(dom.customShotCountInput?.value, 10);
            const customTarget = isNaN(count) || count < 1 ? 10 : Math.min(90, count);

            while (shotsList.length > customTarget && shotsList.length > 1) {
                // Merge shortest adjacent shots with visual synthesis
                let shortestIdx = 0;
                let minLen = Infinity;
                for (let i = 0; i < shotsList.length - 1; i++) {
                    const l1 = (shotsList[i].text_reference || '').length;
                    const l2 = (shotsList[i + 1].text_reference || '').length;
                    if (l1 + l2 < minLen) {
                        minLen = l1 + l2;
                        shortestIdx = i;
                    }
                }
                const first = shotsList[shortestIdx];
                const second = shotsList[shortestIdx + 1];
                const mergedShot = synthesizeMergedVisualConcept(first, second);
                
                shotsList.splice(shortestIdx, 2, mergedShot);
            }

            let splitAttempts = 100;
            while (shotsList.length < customTarget && splitAttempts > 0) {
                splitAttempts--;
                let longestIdx = 0;
                let maxLen = 0;
                for (let i = 0; i < shotsList.length; i++) {
                    const l = (shotsList[i].text_reference || '').length;
                    if (l > maxLen) {
                        maxLen = l;
                        longestIdx = i;
                    }
                }
                const targetShot = shotsList[longestIdx];
                const text = (targetShot.text_reference || '').trim();
                const sentences = text.split(/(?<=[.!?…])\s+/);
                if (sentences.length >= 2) {
                    const mid = Math.ceil(sentences.length / 2);
                    const part1 = sentences.slice(0, mid).join(' ');
                    const part2 = sentences.slice(mid).join(' ');
                    shotsList.splice(longestIdx, 1, 
                        generateSplitVisualConcept(targetShot, part1, 0),
                        generateSplitVisualConcept(targetShot, part2, 1)
                    );
                } else {
                    break;
                }
            }
        }
        
        // Add required shot fields with decoupled natural placeholder duration calculation & visual quality check
        const firstParsedShot = shotsList[0] ? { ...shotsList[0] } : null;

        const newScenes = shotsList.map((shot: any, index: number) => {
            const narrativeText = shot.text_reference || shot.narration || shot.text || "";
            const computedDuration = utils.calculatePlaceholderDuration(narrativeText);
            
            let basePrompt = shot.image_prompt || shot.prompt || shot.description || "";
            if (!basePrompt || isLazyParaphrase(basePrompt, narrativeText) || isGenericFallback(basePrompt)) {
                basePrompt = enrichLazyImagePrompt(shot, narrativeText);
            }

            const enrichedPrompt = utils.injectCharacterConsistencyIntoPrompt(basePrompt, narrativeText);

            let normalizedSubjects = shot.subjects;
            if (typeof normalizedSubjects === 'string') {
                normalizedSubjects = normalizedSubjects.split(',').map((s: string) => s.trim()).filter(Boolean);
            } else if (!Array.isArray(normalizedSubjects)) {
                normalizedSubjects = [];
            }

            return {
                ...shot,
                id: 'shot_' + Date.now() + '_' + index,
                shot_number: index + 1,
                duration_seconds: computedDuration,
                image_prompt: enrichedPrompt,
                text_reference: narrativeText,
                camera_movement: shot.camera_movement || "static",
                image_id: null,
                _imageObjectURL: undefined,
                _videoObjectURL: undefined,
                videoStartOffset: 0,
                talkingHeadMode: shot.talkingHeadMode || 'none',

                // Visual Director reasoning metadata
                visual_type: shot.visual_type || 'ENVIRONMENTAL_ESTABLISHING',
                narrative_function: shot.narrative_function || 'SETTING_ESTABLISHMENT',
                visual_concept: shot.visual_concept || 'Cinematic visual setup with balanced composition',
                subjects: normalizedSubjects,
                action: shot.action || 'Physical visual representation of narrative beat',
                environment: shot.environment || 'Atmospheric setting with natural cinematic lighting',
                composition: shot.composition || 'Cinematic wide framing with clear focal balance',
                camera: shot.camera || 'Eye-level 35mm lens perspective',
                mood: shot.mood || 'Dramatic and immersive',
                continuity_notes: shot.continuity_notes || 'Maintain visual consistency with surrounding scene'
            };
        });

        // Log Complete Pipeline Audit for Shot 1 (Verification of all 12 stages)
        if (newScenes.length > 0) {
            const sampleStylePrompt = ui.getCurrentStylePrompt() || 'Cinematic realism';
            const sampleStyleIntent = constants.styleIntentMap[sampleStylePrompt] || constants.StyleIntent.CINEMATIC;
            const sampleNegPrompt = constants.INTENT_NEGATIVE_PROMPTS[sampleStyleIntent] || '';
            const sampleExportedScene = `[SHOT 1]\n[SCENE]\n${newScenes[0].image_prompt}\n\n[VISUAL STYLE — APPLY TO FINAL OUTPUT]\n${sampleStylePrompt}\n\n[NEGATIVE PROMPT]\n${sampleNegPrompt}\n\n[RENDERING INSTRUCTION]\nRender the entire scene exclusively in the visual style described. Do not deviate.`;
            
            logVisualDirectorPipelineShot(
                0,
                rawSampleSnippet,
                firstParsedShot,
                newScenes[0].image_prompt,
                sampleExportedScene
            );
        }

        state.currentScenes = newScenes;
        timelineState.setGraphics([]);
        ui.renderResults(state.currentScenes);
        saveVersion(false);
        ui.switchTab('storyboard');
        ui.updateWorkflowStepStatus(3, 'completed');

        const allShotsStats = newScenes.flatMap((s: any) => (s.lines || [s]));
        const hasMediaReady = Boolean(state.uploadedVideoElement) 
            || Boolean(timelineState.masterAudioBuffer)
            || allShotsStats.some((shot: any) => !!shot.image_id || !!shot._imageObjectURL || !!shot.video_id || !!shot._videoObjectURL || shot.talkingHeadMode === 'full' || shot.talkingHeadMode === 'split');

        if (hasMediaReady) {
            if (dom.videoDirectorBtn) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
            }
            ui.updateWorkflowStepStatus(4, 'active');
            const { updateStep4CadenceState } = await import('./masterAudioDirector');
            updateStep4CadenceState();
        }
        
        ui.updateProcessingProgress(100, 'Storyboard ready!');
        setTimeout(() => ui.closeProcessingModal(), 500);
    } catch (e: any) {
        if (stopProgress) stopProgress();
        ui.closeProcessingModal();
        if (e.name !== 'AbortError') {
            const isRetryable = /conversational response|hard time|unable|refused|parse|json|empty response|again/i.test(e.message || '');
            if (isRetryable) {
                ui.showStatus(e.message, true, 8000, {
                    label: '🔄 Try Again',
                    onClick: () => analyzeStory()
                });
            } else {
                ui.showStatus('Error generating storyboard: ' + e.message, true);
            }
        }
    } finally {
        ui.setButtonsDisabled(false);
    }
}

export async function generateSparks() {
    if (checkGuestRestriction("Generating Sparks")) return;
    const style = dom.sparkStyleSelect?.value || 'cinematic';
    const length = dom.sparkLengthSelect?.value || 'medium';
    
    ui.setButtonsDisabled(true);
    let stopProgress: any = null;
    const onCancel = () => {
        if (stopProgress) stopProgress();
        ui.closeProcessingModal();
        ui.setButtonsDisabled(false);
    };

    try {
        const signal = await ui.openProcessingModal('Brainstorming Ideas', true, 'Stop', onCancel);
        ui.updateProcessingProgress(0, 'Consulting AI Director...');
        stopProgress = utils.startSimulatedProgress('Formulating creative angles...', ui.updateProcessingProgress);

        const prompt = `Give me 5 creative story angles or ideas for a short video. 
        Style: ${style}, Length target: ${length}.
        Return ONLY a JSON array of 5 strings.`;

        const { Type } = await import('@google/genai');
        const response = await generateContentWithFallback({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            mimeType: "application/json",
            schema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }, signal);

        let sparks: string[] = [];
        try {
            const parsed = utils.sanitizeAndParseJson(response.text || "[]");
            if (Array.isArray(parsed)) {
                sparks = parsed.map(s => typeof s === 'string' ? s : (s.idea || s.spark || s.text || JSON.stringify(s)));
            } else if (parsed && typeof parsed === 'object') {
                const arr = parsed.ideas || parsed.sparks || parsed.data || Object.values(parsed).find(Array.isArray) || [];
                sparks = arr.map((s: any) => typeof s === 'string' ? s : (s.idea || s.spark || s.text || JSON.stringify(s)));
            }
        } catch (err) {
            console.warn("Failed to parse sparks JSON:", err);
            sparks = [];
        }
        
        if (stopProgress) stopProgress();
        ui.updateProcessingProgress(100, 'Ideas ready!');
        
        if (dom.sparkResultsContainer) {
            dom.sparkResultsContainer.innerHTML = sparks.map((spark: string) => `
                <div class="spark-card bg-zinc-800/80 hover:bg-zinc-700/80 p-3 rounded-lg border border-white/5 cursor-pointer transition-colors" data-spark="${ui.escapeHtml(spark)}">
                    <p class="text-sm text-gray-300 pointer-events-none">${ui.escapeHtml(spark)}</p>
                </div>
            `).join('');
            
            dom.sparkResultsContainer.querySelectorAll('.spark-card').forEach((card: any) => {
                card.addEventListener('click', (e: Event) => {
                    const el = e.currentTarget as HTMLElement;
                    const text = el.getAttribute('data-spark');
                    if (text && dom.storyInput) {
                        dom.storyInput.value = text;
                        dom.storyInput.dispatchEvent(new Event('input'));
                        ui.switchTab('script');
                    }
                });
            });
        }
        setTimeout(() => ui.closeProcessingModal(), 500);
    } catch (e: any) {
        if (stopProgress) stopProgress();
        ui.closeProcessingModal();
        if (e.name !== 'AbortError') {
            ui.showStatus('Failed to generate ideas: ' + e.message, true);
        }
    } finally {
        ui.setButtonsDisabled(false);
    }
}


export function handleStyleSuggestionClick(event: Event) {
    const target = event.target as HTMLElement;
    const item = target.closest('.style-suggestion-item') as HTMLElement;
    if (!item) return;

    const prompt = decodeURIComponent(item.dataset.prompt || '');
    const isLibrary = item.dataset.isLibrary === 'true';

    if (isLibrary) {
        const options = Array.from(dom.imageStyleSelect.options);
        const matchingOption = options.find(opt => opt.value === prompt);
        if (matchingOption) dom.imageStyleSelect.value = prompt;
    } else {
        dom.imageStyleSelect.value = 'custom_prompt';
        dom.customPromptInput.value = prompt;
    }

    ui.handleImageStyleChange();
    dom.styleSuggestionModal.classList.add('hidden');
    saveVersion(false);
}

export function handleSparkSelection(event: Event) {
    const target = event.target as HTMLElement;
    const item = target.closest('.spark-item');
    if (item) {
        const index = parseInt((item as HTMLElement).dataset.index!, 10);
        const sparks = (window as any)._lastSparks;
        const text = sparks?.[index]?.content;
        if (!text || text === 'undefined' || !text.trim()) {
            ui.showStatus("The draft didn't come back correctly — try Write Story again.", true, 4000);
            return;
        }
        dom.storyInput.value = text;
        dom.storySparkModal.classList.add('hidden');
        ui.updateUiForStoryChange();
        saveVersion(false);
    }
}

export function handleSparkStyleChange(event: Event) {
    const selected = (event.target as HTMLSelectElement).value;
    dom.sparkCustomStyleContainer.style.display = selected === 'custom' ? 'block' : 'none';
}

export function handleSparkLengthChange(event: Event) {
    const selected = (event.target as HTMLSelectElement).value;
    dom.sparkCustomLengthContainer.style.display = selected === 'custom' ? 'block' : 'none';
}

/**
 * Populates the script editor textarea with the concatenated narration text from the current storyboard.
 */
export function syncScriptEditorFromStoryboard() {
    if (!dom.scriptEditorTextarea) return;

    const allShots = state.currentScenes.flatMap(scene => scene.lines || [scene]);
    if (allShots.length === 0) {
        dom.scriptEditorTextarea.value = '';
        return;
    }

    const scriptText = allShots
        .map(shot => shot.text_reference || shot.line_text || '')
        .join('\n\n');

    dom.scriptEditorTextarea.value = scriptText;
    ui.showStatus('Script synced from storyboard.', false, 2000);
}


/**
 * Parses the script editor textarea and applies the changes back to the storyboard state.
 */
export function handleApplyScriptToStoryboard() {
    const scriptText = dom.scriptEditorTextarea.value;
    const scriptChunks = scriptText.split(/\n\s*\n/).map(chunk => chunk.trim()).filter(Boolean);

    const allShots = state.currentScenes.flatMap(scene => scene.lines || [scene]);

    if (scriptChunks.length !== allShots.length) {
        ui.showStatus(`Error: Script has ${scriptChunks.length} paragraphs, but storyboard has ${allShots.length} shots. Sync from storyboard to resolve.`, true, 6000);
        return;
    }

    let shotIndex = 0;
    for (const scene of state.currentScenes) {
        const lines = scene.lines || [scene]; // Handle both paced and scene-based structures
        for (const line of lines) {
            const key = 'text_reference' in line ? 'text_reference' : 'line_text';
            const newText = scriptChunks[shotIndex];
            line[key] = newText;
            
            // Sync to active timeline if it exists
            const clip = timelineState.clips.find(c => c.id === line.id);
            if (clip) {
                clip.text = newText;
            }
            
            shotIndex++;
        }
    }

    ui.renderResults(state.currentScenes);
    saveVersion(false);
    ui.showStatus('Script changes applied to storyboard!', false, 3000);
}
export async function extractVoiceover() {
    if (!dom.storyInput.value.trim()) return;
    
    const originalText = dom.extractVoBtn.innerHTML;
    dom.extractVoBtn.innerHTML = 'Cleaning...';
    dom.extractVoBtn.disabled = true;

    try {
        const prompt = `Extract only the spoken voiceover (VO) from this script. Do not include VISUAL markers, TEXT OVERLAYS, camera directions, beat markers, or character names unless they are actually spoken. Provide only the raw spoken text, formatted as a continuous clean script without labels.
        
Script:
${dom.storyInput.value}
`;
        const response = await generateContentWithFallback({
            model: constants.PRIMARY_MODEL,
            contents: prompt
        });

        if (response.text) {
            dom.storyInput.value = response.text.trim();
            ui.updateUiForStoryChange();
            saveVersion(false);
            ui.showStatus('Script cleaned successfully!', false, 3000);
        }
    } catch (e: any) {
        console.error("Failed to clean script", e);
        ui.showStatus("Failed to clean script: " + e.message, true);
    } finally {
        dom.extractVoBtn.innerHTML = originalText;
        dom.extractVoBtn.disabled = false;
        dom.extractVoBtn.classList.add('hidden');
    }
}
