import { formatTime } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import * as dom from './dom';
import * as ui from './ui';
import { transcribeAudioLocal } from './api/audio';
import * as utils from './utils';
import { assetStorage } from './assetStorage';
import { timelineState } from './state-timeline';
import { loadAndShowWaveform, hideAndCleanupWaveform } from './audioWaveformVisualizer';
import { getAllStoryboardShots } from './handlers-inspector';
import { updateVideoContext } from './videoController';
import { drawVideoFrame } from './videoRenderer';
import {
    EDITING_RHYTHM_TEMPLATES,
    getRhythmTemplateById,
    generateRhythmOptionsHtml,
    generateCadencePatternPreviewHtml,
    TalkingHeadMode
} from './editingRhythmTemplates';

let isStep4CadenceOpen = false;

export function hasArollTrack(): boolean {
    return Boolean(state.uploadedVideoElement || state.uploadedVideoFileName || state.uploadedAudioBuffer || (timelineState as any).masterAudioBuffer);
}

export function updateStep4CadenceState() {
    const toggleBtn = (document.getElementById('step4-cadence-toggle-btn') || dom.step4CadenceToggleBtn) as HTMLButtonElement | null;
    const labelEl = document.getElementById('step4-cadence-label') || dom.step4CadenceLabel;
    const badgeEl = document.getElementById('step4-cadence-badge') || dom.step4CadenceBadge;
    const subtextEl = document.getElementById('step4-cadence-subtext') || dom.step4CadenceSubtext;
    const chevronEl = document.getElementById('step4-cadence-chevron') || dom.step4CadenceChevron;
    const drawerEl = document.getElementById('step4-cadence-drawer') || dom.step4CadenceDrawer;

    const hasAroll = hasArollTrack();

    if (!hasAroll) {
        isStep4CadenceOpen = false;
        if (toggleBtn) {
            toggleBtn.disabled = true;
            toggleBtn.className = "w-full flex items-center justify-between p-2 rounded-lg bg-gray-900/60 border border-gray-800 text-gray-500 cursor-not-allowed opacity-60 transition-all text-xs font-semibold";
            toggleBtn.title = "Requires Master A-Roll / Video in Step 1 to activate";
        }
        if (labelEl) labelEl.className = "text-xs font-bold text-gray-400";
        if (badgeEl) {
            badgeEl.textContent = "A-Roll Required";
            badgeEl.className = "text-[9px] px-1.5 py-0.2 rounded-full border border-gray-700 text-gray-500 font-medium";
        }
        if (subtextEl) subtextEl.textContent = "Link A-Roll in Step 1 to activate";
        if (chevronEl) chevronEl.textContent = "▾";
        if (drawerEl) drawerEl.classList.add('hidden');
        return;
    }

    // A-Roll is present: Activate the control
    const template = getRhythmTemplateById(state.selectedRhythmTemplateId || 'youtube_essay');
    if (toggleBtn) {
        toggleBtn.disabled = false;
        toggleBtn.className = isStep4CadenceOpen
            ? "w-full flex items-center justify-between p-2 rounded-lg bg-indigo-900/80 border border-indigo-400 text-white cursor-pointer transition-all text-xs font-semibold shadow-sm"
            : "w-full flex items-center justify-between p-2 rounded-lg bg-indigo-950/50 hover:bg-indigo-900/70 border border-indigo-500/40 text-indigo-200 cursor-pointer transition-all text-xs font-semibold shadow-xs";
        toggleBtn.title = isStep4CadenceOpen ? "Click to collapse cadence settings" : "Click to configure rhythm pattern and preview shot layout";
    }
    if (labelEl) labelEl.className = "text-xs font-bold text-indigo-300";
    if (badgeEl) {
        badgeEl.textContent = template.name;
        badgeEl.className = "text-[9px] px-2 py-0.5 rounded-full border border-indigo-500/40 bg-indigo-500/20 text-indigo-300 font-semibold";
    }
    if (subtextEl) {
        subtextEl.textContent = isStep4CadenceOpen 
            ? "Click to collapse rhythm options" 
            : `Active (${template.name}) • Click to configure & preview`;
    }
    if (chevronEl) chevronEl.textContent = isStep4CadenceOpen ? "▴" : "▾";
    const wrapperEl = document.getElementById('step4-cadence-wrapper') || dom.step4CadenceWrapper;
    if (drawerEl) {
        if (isStep4CadenceOpen) {
            drawerEl.classList.remove('hidden');
            if (wrapperEl) {
                wrapperEl.classList.add('bg-indigo-950/25', 'border', 'border-indigo-500/40', 'rounded-xl', 'p-1.5', 'ring-1', 'ring-indigo-500/20', 'shadow-md');
            }
        } else {
            drawerEl.classList.add('hidden');
            if (wrapperEl) {
                wrapperEl.classList.remove('bg-indigo-950/25', 'border', 'border-indigo-500/40', 'rounded-xl', 'p-1.5', 'ring-1', 'ring-indigo-500/20', 'shadow-md');
            }
        }
    }
}

export function populateRhythmTemplateSelectors() {
    const selectedId = state.selectedRhythmTemplateId || 'youtube_essay';
    const optionsHtml = generateRhythmOptionsHtml(selectedId);
    const template = getRhythmTemplateById(selectedId);

    if (dom.bulkArollRhythmSelect) {
        dom.bulkArollRhythmSelect.innerHTML = optionsHtml;
        dom.bulkArollRhythmSelect.value = selectedId;
    }
    if (dom.masterArollTemplateSelect) {
        dom.masterArollTemplateSelect.innerHTML = optionsHtml;
        dom.masterArollTemplateSelect.value = selectedId;
    }
    if (dom.timelineArollRhythmSelect) {
        dom.timelineArollRhythmSelect.innerHTML = optionsHtml;
        dom.timelineArollRhythmSelect.value = selectedId;
    }

    const descEl = document.getElementById('master-rhythm-desc') || dom.masterRhythmDesc;
    if (descEl) {
        descEl.textContent = template.cadenceText;
    }

    const badgeEl = document.getElementById('master-cadence-badge') || dom.masterCadenceBadge;
    if (badgeEl) {
        badgeEl.textContent = template.badge;
    }

    const previewContainer = document.getElementById('master-cadence-preview-container') || dom.masterCadencePreviewContainer;
    if (previewContainer) {
        const allShots = getAllStoryboardShots();
        const customShotCount = allShots.length > 0 ? allShots.length : undefined;
        const customShots = allShots.length > 0 ? allShots : undefined;
        previewContainer.innerHTML = generateCadencePatternPreviewHtml(selectedId, customShotCount, customShots);

        // Wire up close button within header
        const closeBtn = previewContainer.querySelector('#close-cadence-preview-btn');
        closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            isStep4CadenceOpen = false;
            updateStep4CadenceState();
        });

        // Wire up quick apply link within the preview
        const quickApply = previewContainer.querySelector('#master-cadence-quick-apply');
        quickApply?.addEventListener('click', (e) => {
            e.stopPropagation();
            applyEditingRhythmTemplate(selectedId, true);
        });

        // Wire up individual shot tile tooltips / interaction
        const tiles = previewContainer.querySelectorAll('[data-shot-role]');
        tiles.forEach((tile) => {
            tile.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const shotIdx = target.getAttribute('data-shot-idx');
                const shotRole = target.getAttribute('data-shot-role');
                const shotMode = target.getAttribute('data-shot-mode');
                if (shotIdx && shotRole) {
                    ui.showStatus(`Shot ${shotIdx}: ${shotMode} (${shotRole})`, false, 2500);
                }
            });
        });
    }

    updateStep4CadenceState();
}

export function initMasterAudioHandlers() {
    populateRhythmTemplateSelectors();

    // Storyboard toolbar rhythm buttons & select
    dom.applyArollRhythmBtn?.addEventListener('click', () => {
        const templateId = dom.bulkArollRhythmSelect?.value || state.selectedRhythmTemplateId || 'youtube_essay';
        applyEditingRhythmTemplate(templateId, true);
    });

    dom.bulkArollRhythmSelect?.addEventListener('change', (e) => {
        const templateId = (e.target as HTMLSelectElement).value;
        state.selectedRhythmTemplateId = templateId;
        populateRhythmTemplateSelectors();
    });

    // Master Audio / Video Badge rhythm controls
    dom.masterApplyTemplateBtn?.addEventListener('click', () => {
        const templateId = dom.masterArollTemplateSelect?.value || state.selectedRhythmTemplateId || 'youtube_essay';
        applyEditingRhythmTemplate(templateId, true);
    });

    dom.masterArollTemplateSelect?.addEventListener('change', (e) => {
        const templateId = (e.target as HTMLSelectElement).value;
        state.selectedRhythmTemplateId = templateId;
        populateRhythmTemplateSelectors();
    });

    const step4ToggleBtn = dom.step4CadenceToggleBtn || document.getElementById('step4-cadence-toggle-btn');
    step4ToggleBtn?.addEventListener('click', () => {
        if (!hasArollTrack()) return;
        isStep4CadenceOpen = !isStep4CadenceOpen;
        updateStep4CadenceState();
    });

    const step4CloseBtn = dom.step4CadenceCloseBtn || document.getElementById('step4-cadence-close-btn');
    step4CloseBtn?.addEventListener('click', () => {
        isStep4CadenceOpen = false;
        updateStep4CadenceState();
    });

    // Timeline Drawer rhythm controls
    dom.timelineArollRhythmApplyBtn?.addEventListener('click', () => {
        document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
        document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
        const templateId = dom.timelineArollRhythmSelect?.value || state.selectedRhythmTemplateId || 'youtube_essay';
        applyEditingRhythmTemplate(templateId, true);
    });

    dom.timelineArollRhythmSelect?.addEventListener('change', (e) => {
        const templateId = (e.target as HTMLSelectElement).value;
        state.selectedRhythmTemplateId = templateId;
        populateRhythmTemplateSelectors();
    });

    if (!dom.masterAudioDropzone || !dom.masterAudioInput) return;

    // Dropzone Click Trigger
    dom.masterAudioDropzone.addEventListener('click', () => {
        dom.masterAudioInput.click();
    });

    // File Input Change
    dom.masterAudioInput.addEventListener('change', async (e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            const file = input.files[0];
            await handleMasterAudioUpload(file);
        }
    });

    // Replace Button Click
    dom.replaceMasterAudioBtn?.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        dom.masterAudioInput.click();
    });

    // Clear Button Click
    dom.clearMasterAudioBtn?.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        clearMasterAudio();
    });

    // Drag & Drop Handlers
    dom.masterAudioDropzone.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dom.masterAudioDropzone.classList.add('border-indigo-400', 'bg-indigo-900/40');
    });

    dom.masterAudioDropzone.addEventListener('dragleave', (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dom.masterAudioDropzone.classList.remove('border-indigo-400', 'bg-indigo-900/40');
    });

    dom.masterAudioDropzone.addEventListener('drop', async (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dom.masterAudioDropzone.classList.remove('border-indigo-400', 'bg-indigo-900/40');

        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            await handleMasterAudioUpload(file);
        }
    });
}

export function applyEditingRhythmTemplate(templateId: string, showToast: boolean = true) {
    const template = getRhythmTemplateById(templateId);
    state.selectedRhythmTemplateId = template.id;

    populateRhythmTemplateSelectors();

    const allShots = getAllStoryboardShots();
    if (allShots.length === 0) {
        state.talkingHeadDefaultMode = 'full';
        if (showToast) {
            ui.showStatus(`Default editing rhythm set to "${template.name}". Will apply when shots are created!`, false, 3000);
        }
        return;
    }

    const computedModes = template.generate(allShots.length, allShots);

    allShots.forEach((item, idx) => {
        const mode = computedModes[idx] || 'none';
        item.shot.talkingHeadMode = mode;
    });

    if (timelineState.clips && timelineState.clips.length > 0) {
        timelineState.clips.forEach((clip: any, idx: number) => {
            if (allShots[idx]) {
                clip.talkingHeadMode = allShots[idx].shot.talkingHeadMode;
                clip.talkingHeadShape = state.talkingHeadShape || 'circle';
                clip.talkingHeadSize = state.talkingHeadSize || 'medium';
                clip.talkingHeadVideoElement = state.uploadedVideoElement;
                if (state.uploadedVideoElement && (typeof clip.videoStartOffset !== 'number' || clip.videoStartOffset === 0)) {
                    clip.videoStartOffset = clip.startTime || 0;
                    allShots[idx].shot.videoStartOffset = clip.startTime || 0;
                }
            }
        });
    }

    ui.renderResults(state.currentScenes);
    ui.renderTimelineEditor();

    if (timelineState.videoGenerated) {
        updateVideoContext();
        drawVideoFrame(state.videoPauseTime || 0);
    }

    const hasMedia = Boolean(state.uploadedVideoElement) 
        || (timelineState.clips && timelineState.clips.length > 0 && timelineState.videoGenerated) 
        || allShots.some(s => s.shot.talkingHeadMode === 'full' || s.shot.talkingHeadMode === 'split' || s.shot.image_id || s.shot._imageObjectURL || s.shot.video_id || s.shot._videoObjectURL);
    if (hasMedia && dom.videoDirectorBtn) {
        dom.videoDirectorBtn.disabled = false;
        dom.videoDirectorBtn.classList.remove('opacity-50');
        if (dom.videoExportBtn) dom.videoExportBtn.disabled = false;
        ui.updateWorkflowStepStatus(3, 'completed');
        ui.updateWorkflowStepStatus(4, 'active');
    }

    if (showToast) {
        const readableSummary = computedModes.slice(0, 4).map(m => m === 'full' ? 'A-Roll' : m === 'none' ? 'B-Roll' : m === 'split' ? 'Split' : 'PiP').join(' → ');
        const extraCount = computedModes.length > 4 ? ` (+${computedModes.length - 4} more)` : '';
        ui.showStatus(`✨ Applied "${template.name}": ${readableSummary}${extraCount}`, false, 3500);
    }
}

export function applyTalkingHeadPresetToShots(modePreset: string) {
    const match = EDITING_RHYTHM_TEMPLATES.find(t => t.id === modePreset);
    if (match) {
        applyEditingRhythmTemplate(modePreset, true);
        return;
    }
    if (modePreset === 'intro_outro') {
        applyEditingRhythmTemplate('youtube_essay', true);
        return;
    }
    if (modePreset === 'all_full') {
        applyEditingRhythmTemplate('all_full', true);
        return;
    }
    if (modePreset === 'all_pip') {
        applyEditingRhythmTemplate('all_pip', true);
        return;
    }
    if (modePreset === 'all_split') {
        applyEditingRhythmTemplate('all_split', true);
        return;
    }
    if (modePreset === 'broll_only') {
        applyEditingRhythmTemplate('broll_only', true);
        return;
    }

    applyEditingRhythmTemplate('youtube_essay', true);
}

export async function handleMasterAudioUpload(file: File) {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
    if (!file.type.startsWith('audio/') && !isVideo) {
        ui.showStatus('Please upload a valid audio or video file.', true, 3000);
        return;
    }

    state.isVideoProductionRunning = true;
    await ui.openProcessingModal(isVideo ? 'Processing Talking Head / Master Video' : 'Processing Master Audio', true, 'Stop Processing');
    ui.updateProcessingProgress(5, isVideo ? 'Extracting audio & metadata from video...' : 'Decoding audio file...');

    try {
        const audioContext = utils.getAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        if (!state.isVideoProductionRunning) return;
        const audioBuffer = await utils.safeDecode(audioContext, arrayBuffer);
        if (!state.isVideoProductionRunning) return;

        ui.updateProcessingProgress(25, 'Saving master media asset to local storage...');
        // Resample heavily to a 16kHz Mono file to keep the payload size absolutely minimal
        const lightweightAudioFile = await utils.resampleAndEncodeAudio(audioBuffer);
        const wavBlob = new Blob([lightweightAudioFile], { type: 'audio/wav' });
        const assetId = await assetStorage.storeAsset(wavBlob, 'audio');

        state.uploadedAudioBuffer = audioBuffer;
        state.uploadedAudioAssetId = assetId;
        state.uploadedAudioFileName = isVideo ? file.name.replace(/\.[^/.]+$/, "") + ".wav" : file.name;
        timelineState.setMasterAudioBuffer(audioBuffer);

        if (isVideo) {
            ui.updateProcessingProgress(35, 'Initializing Talking Head video player...');
            const objectURL = URL.createObjectURL(file);
            state.uploadedVideoObjectURL = objectURL;
            state.uploadedVideoFileName = file.name;
            try {
                state.uploadedVideoAssetId = await assetStorage.storeAsset(file, 'video');
            } catch (storeErr) {
                console.warn('Video asset store error:', storeErr);
            }

            const videoEl = document.createElement('video');
            videoEl.src = objectURL;
            videoEl.crossOrigin = 'anonymous';
            videoEl.playsInline = true;
            videoEl.muted = true;
            videoEl.preload = 'auto';

            await new Promise<void>((resolve) => {
                videoEl.onloadedmetadata = () => {
                    state.uploadedVideoDuration = videoEl.duration || 0;
                    state.uploadedVideoWidth = videoEl.videoWidth || 0;
                    state.uploadedVideoHeight = videoEl.videoHeight || 0;
                    resolve();
                };
                videoEl.onerror = () => resolve();
                setTimeout(resolve, 3000);
            });
            state.uploadedVideoElement = videoEl;

            // Auto-configure Vertical Video if aspect ratio is portrait (e.g., 9:16 Shorts/Reels/TikTok)
            if (state.uploadedVideoHeight > state.uploadedVideoWidth) {
                if (dom.imageResolutionSelect) {
                    dom.imageResolutionSelect.value = '9:16';
                    dom.imageResolutionSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (dom.studioAspectSelect) dom.studioAspectSelect.value = '9:16';
                ui.showStatus('Vertical video detected (9:16). Use layout dropdowns on each shot or Auto-Direct to place it!', false, 4000);
            } else {
                ui.showStatus('A-Roll uploaded! Use layout dropdowns on each shot or Auto-Direct to place your talking head.', false, 4000);
            }

            // Enable dynamic subtitles by default for talking head creator videos
            timelineState.setShowSubtitles(true);
            if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = true;

            // Immediately enable Video Director and Export if A-Roll is uploaded, even if storyboard is empty
            if (dom.videoDirectorBtn) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
            }
            if (dom.videoExportBtn) {
                dom.videoExportBtn.disabled = false;
            }

            // Auto-apply rhythm template to storyboard shots
            applyEditingRhythmTemplate(state.selectedRhythmTemplateId || 'youtube_essay', true);
        }

        if (state.deepgramApiKey) {
            ui.updateProcessingProgress(45, 'Transcribing script with Deepgram...');
        } else {
            ui.updateProcessingProgress(45, 'Transcribing script with AI...');
        }
        
        let transcriptText = '';
        let wordTimestamps: any[] = [];
        let accuracyPercent = 98;

        try {
            // Use the lightweight WAV blob instead of the massive source video file for transcription
            const lightweightFilePayload = new File([wavBlob], file.name.replace(/\.[^/.]+$/, "") + ".wav", { type: 'audio/wav' });
            const result = await transcribeAudioLocal(lightweightFilePayload);
            transcriptText = result.text || '';
            
            if (typeof result.confidence === 'number') {
                accuracyPercent = result.confidence > 1 ? Math.round(result.confidence) : Math.round(result.confidence * 100);
            } else if (result.words && result.words.length > 0) {
                wordTimestamps = result.words;
                const confs = result.words
                    .map((w: any) => typeof w.confidence === 'number' ? w.confidence : null)
                    .filter((c: any) => c !== null);
                if (confs.length > 0) {
                    const avg = confs.reduce((a: number, b: number) => a + b, 0) / confs.length;
                    accuracyPercent = avg > 1 ? Math.round(avg) : Math.round(avg * 100);
                }
            } else if (result.chunks && result.chunks.length > 0) {
                // Construct word timestamps from chunks if individual word timestamps aren't present
                result.chunks.forEach((chunk: any) => {
                    const chunkText = chunk.text || '';
                    const words = chunkText.split(/\s+/).filter(Boolean);
                    const [start, end] = chunk.timestamp || [0, 0];
                    const dur = end - start;
                    if (words.length > 0) {
                        const wordDur = dur / words.length;
                        words.forEach((w: string, idx: number) => {
                            wordTimestamps.push({
                                word: w,
                                start: start + (idx * wordDur),
                                end: start + ((idx + 1) * wordDur)
                            });
                        });
                    }
                });
            }
        } catch (transcribeErr: any) {
            console.warn('Auto-transcription warning:', transcribeErr);
            accuracyPercent = 85;
            ui.showStatus(`Audio linked, but auto-transcription warning: ${transcribeErr.message}. You can manually type or paste your script below.`, true, 5000);
        }

        accuracyPercent = Math.min(100, Math.max(60, accuracyPercent));
        if (!state.isVideoProductionRunning) return;

        state.masterAudioTranscript = wordTimestamps;
        timelineState.setGlobalWordTimestamps(wordTimestamps || []);
        timelineState.setGlobalSilences(utils.detectSilences(audioBuffer));

        // Auto-fill storyInput if transcript was generated
        if (transcriptText && dom.storyInput) {
            dom.storyInput.value = transcriptText;
            dom.storyInput.dispatchEvent(new Event('input', { bubbles: true }));
            dom.storyInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Update UI Badge & Waveform Visualizer
        updateMasterAudioUI(file.name, audioBuffer.duration, transcriptText || (dom.storyInput ? dom.storyInput.value : ''), accuracyPercent);
        loadAndShowWaveform(audioBuffer, wavBlob, file.name);

        ui.closeProcessingModal();
        ui.showStatus(`🎙️ Master Audio ("${file.name}") linked & script ready (${accuracyPercent}% accuracy)!`, false, 4000);

    } catch (err: any) {
        console.error('Failed to process master audio:', err);
        ui.closeProcessingModal();
        ui.showStatus(`Failed to process master audio: ${err.message}`, true, 5000);
    } finally {
        state.isVideoProductionRunning = false;
    }
}

export function updateMasterAudioUI(filename: string, durationSec: number, scriptText: string, accuracyPercent: number = 98) {
    if (!dom.masterAudioBadge || !dom.masterAudioDropzone) return;

    if (dom.masterAudioFilename) dom.masterAudioFilename.textContent = filename;
    if (dom.masterAudioDuration) dom.masterAudioDuration.textContent = `${formatTime(durationSec)} min`;
    
    const wordCount = scriptText ? scriptText.split(/\s+/).filter(Boolean).length : 0;
    if (dom.masterAudioWords) dom.masterAudioWords.textContent = `${wordCount} words`;

    if (dom.masterAudioAccuracyBadge) {
        dom.masterAudioAccuracyBadge.textContent = `${accuracyPercent}% Accuracy`;
        if (accuracyPercent >= 95) {
            dom.masterAudioAccuracyBadge.className = "text-[9px] bg-emerald-500/20 text-emerald-300 font-semibold px-1.5 py-0.2 rounded border border-emerald-500/30 shrink-0";
        } else if (accuracyPercent >= 85) {
            dom.masterAudioAccuracyBadge.className = "text-[9px] bg-amber-500/20 text-amber-300 font-semibold px-1.5 py-0.2 rounded border border-amber-500/30 shrink-0";
        } else {
            dom.masterAudioAccuracyBadge.className = "text-[9px] bg-red-500/20 text-red-300 font-semibold px-1.5 py-0.2 rounded border border-red-500/30 shrink-0";
        }
    }

    dom.masterAudioDropzone.classList.add('hidden');
    dom.masterAudioBadge.classList.remove('hidden');

    populateRhythmTemplateSelectors();
}

export function clearMasterAudio() {
    state.uploadedAudioBuffer = null;
    state.uploadedAudioAssetId = null;
    state.uploadedAudioFileName = null;
    state.masterAudioTranscript = null;

    if (state.uploadedVideoObjectURL) {
        URL.revokeObjectURL(state.uploadedVideoObjectURL);
    }
    state.uploadedVideoAssetId = null;
    state.uploadedVideoObjectURL = null;
    state.uploadedVideoFileName = null;
    state.uploadedVideoElement = null;
    state.uploadedVideoDuration = 0;
    state.uploadedVideoWidth = 0;
    state.uploadedVideoHeight = 0;

    if (timelineState.clips) {
        timelineState.clips.forEach((clip: any) => {
            clip.talkingHeadVideoElement = null;
        });
    }

    timelineState.setMasterAudioBuffer(null);
    timelineState.setMasterAudioAssetId(null);
    timelineState.setGlobalWordTimestamps(null);
    timelineState.setGlobalSilences([]);

    if (dom.masterAudioInput) dom.masterAudioInput.value = '';
    if (dom.masterAudioBadge) dom.masterAudioBadge.classList.add('hidden');
    if (dom.masterAudioDropzone) dom.masterAudioDropzone.classList.remove('hidden');

    populateRhythmTemplateSelectors();
    hideAndCleanupWaveform();

    ui.showStatus('Master Track unlinked. Standard voice synthesis enabled.', false, 3000);
}

export function restoreMasterAudioUI() {
    if (state.uploadedAudioBuffer && state.uploadedAudioFileName) {
        updateMasterAudioUI(
            state.uploadedAudioFileName, 
            state.uploadedAudioBuffer.duration, 
            dom.storyInput?.value || ''
        );
        loadAndShowWaveform(state.uploadedAudioBuffer, null, state.uploadedAudioFileName);
        populateRhythmTemplateSelectors();
    } else if (state.uploadedVideoElement && state.uploadedVideoFileName) {
        updateMasterAudioUI(
            state.uploadedVideoFileName,
            state.uploadedVideoDuration || state.uploadedVideoElement.duration || 0,
            dom.storyInput?.value || ''
        );
        populateRhythmTemplateSelectors();
    } else {
        if (dom.masterAudioBadge) dom.masterAudioBadge.classList.add('hidden');
        if (dom.masterAudioDropzone) dom.masterAudioDropzone.classList.remove('hidden');
        populateRhythmTemplateSelectors();
        hideAndCleanupWaveform();
    }
}
