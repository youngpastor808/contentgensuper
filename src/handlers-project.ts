import { registerSaveVersion, registerFlushPendingSave } from './projectVersioning';
import { safeCloneClean } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import * as constants from './constants';
import * as utils from './utils';
import { DB } from './db';
import { updateVideoContext, normalizeTimeline, refreshCustomFontSelect } from './videoController';
import { drawVideoFrame, setVideoRenderContext } from './videoRenderer';
import { restoreVideoTimeline } from './timelineBuilder';
import type { CharacterProfile } from './types';
import { clearBgAudio } from './handlers-images';
import { analyzeCharacterFrequency } from './handlers-assets';
import { assetStorage } from './assetStorage';
import { clearMasterAudio, restoreMasterAudioUI, populateRhythmTemplateSelectors } from './masterAudioDirector';
import { cleanupWebGL } from './parallax/adapter';
import { clearAIDirectorCache } from './videoDirector';
import { clearGraphicsImageCaches } from './graphics-engine';
import { updateAspectRatioState } from './ui-renderers';
import { setProjectHydrating, isProjectHydrating } from './projectHydration';
import { importProjectArchive } from './projectArchive';

declare const JSZip: any;
declare const jspdf: any;

/**
 * Forces a synchronization of current text inputs to the state.
 */
export function syncStateFromDOM() {
    const promptTextareas = document.querySelectorAll('.prompt-textarea');
    promptTextareas.forEach((el) => {
        const target = el as HTMLTextAreaElement;
        const shotElement = target.closest('.prompt-item') as HTMLElement;
        if (!shotElement) return;

        const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
        const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
        const scenes = state.currentScenes;

        if (scenes[0] && typeof scenes[0].shot_number !== 'undefined') {
            if (scenes[lineIndex]) scenes[lineIndex].image_prompt = target.value;
        } else {
            if (scenes[sceneIndex] && scenes[sceneIndex].lines && scenes[sceneIndex].lines[lineIndex]) {
                scenes[sceneIndex].lines[lineIndex].image_prompt = target.value;
            }
        }
    });

    if (dom.bgAudioPromptInput) {
        state.bgAudioPrompt = dom.bgAudioPromptInput.value;
    }
}

const OBJECT_URL_FIELDS = ['_imageObjectURL', '_videoObjectURL', '_audioObjectURL', '_sfxObjectURL', 'overlayImageUrl'];

function revokeObjectURLsOn(obj: any) {
    if (!obj) return;
    for (const field of OBJECT_URL_FIELDS) {
        const url = obj[field];
        if (typeof url === 'string' && url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch {}
            delete obj[field];
        }
    }
}

function revokeProjectObjectURLs() {
    for (const scene of state.currentScenes || []) {
        revokeObjectURLsOn(scene);
        if (Array.isArray((scene as any).lines)) (scene as any).lines.forEach(revokeObjectURLsOn);
    }
    for (const clip of timelineState.clips || []) revokeObjectURLsOn(clip);

    const single: [any, string][] = [
        [state, '_bgAudioObjectURL'],
        [state, 'uploadedVideoObjectURL'],
        [(state as any).audioState, 'masterAudioUrl'],
        [state, 'customStyleImagePreviewUrl'],
    ];
    for (const [owner, field] of single) {
        const url = owner?.[field];
        if (typeof url === 'string' && url.startsWith('blob:')) {
            try { URL.revokeObjectURL(url); } catch {}
            owner[field] = null;
        }
    }
    state.uploadedVideoElement = null;
    state.uploadedVideoFileName = null;
}

function resetVideoState() {
    revokeProjectObjectURLs();
    timelineState.clearHistory();
    timelineState.setClips([]);
    timelineState.setGraphics([]);
    timelineState.setMasterAudioBuffer(null);
    timelineState.setVideoGenerated(false);
    clearGraphicsImageCaches();
    cleanupWebGL();
    setVideoRenderContext(null);
    clearAIDirectorCache();
    
    state.bRollTranscript = null;
    state.uploadIntent = null;
    state.forceAlignSubtitleCues = null;
    state.bRollSourceRegistry.clear();
    state.customStyleImageFile = null;

    state.isVideoPlaying = false;
    state.videoStartTime = 0;
    state.videoPauseTime = 0;
    state.isVideoProductionRunning = false;
    timelineState.setMode('free');
    
    if (dom.videoCanvas) {
        dom.videoCanvas.style.display = 'none';
        const ctx = dom.videoCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, dom.videoCanvas.width, dom.videoCanvas.height);
    }
    
    if (dom.videoPreGenerationOverlay) dom.videoPreGenerationOverlay.classList.remove('hidden');
    if (dom.videoControlsContainer) dom.videoControlsContainer.classList.add('hidden');
    if (dom.videoPostGenerationOverlay) dom.videoPostGenerationOverlay.classList.add('hidden');
    if (dom.timelineEditorContainer) dom.timelineEditorContainer.classList.add('hidden');
    if (dom.timelineClipsContainer) dom.timelineClipsContainer.innerHTML = '';
    if (dom.videoStatusLog) dom.videoStatusLog.innerHTML = '<p class="text-gray-600 italic">System Ready.</p>';
    if (dom.videoExportBtn) dom.videoExportBtn.disabled = true;
}

/**
 * Migrates old character profiles to the new split format.
 */
function migrateCharacterProfiles(profiles: any[]): CharacterProfile[] {
    if (!Array.isArray(profiles)) return [];
    
    return profiles.map(p => {
        // Already in new format
        if (p.appearance_anchor !== undefined) {
            return {
                name: p.name,
                aliases: Array.isArray(p.aliases) ? p.aliases : undefined,
                appearance_anchor: p.appearance_anchor || '',
                role_keywords: p.role_keywords,
                location_context: p.location_context,
                image: p.image || null,
                frequency: p.frequency, // Keep if exists
                enforce_consistency: p.enforce_consistency !== false, // Keep if exists, default to true
                is_universal: p.is_universal
            };
        }
        
        // Old format - migrate description to appearance_anchor
        return {
            name: p.name,
            aliases: Array.isArray(p.aliases) ? p.aliases : undefined,
            appearance_anchor: p.description || '',
            image: p.image || null,
            enforce_consistency: true
        };
    });
}

let lastHistoryCheckpoint = 0;
const HISTORY_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let projectEpoch = 0; // Autosave race guard counter

let autoSaveTimer: any = null;
let isProjectDirty = false;
let pendingForceCheckpoint = false;
let pendingIsAutoSave = true;

/**
 * Performs actual serialization and persistence of current project state.
 */
async function performSaveVersion(isAutoSave = true, forceCheckpoint = false): Promise<void> {
    if (isProjectHydrating()) {
        console.warn('[Save] Skipped saveVersion during project hydration.');
        return;
    }
    syncStateFromDOM(); // Ensure latest prompt edits are captured

    const isFromVideoDirector = !isAutoSave && dom.videoDirectorModal && !dom.videoDirectorModal.classList.contains('hidden');
    const saveEpoch = projectEpoch;

    // Strip ephemeral URLs from scenes to save space and prevent JSON.stringify crashes
    const cleanScenes = state.currentScenes.map(scene => {
        const newScene = { ...scene };
        delete newScene._imageObjectURL;
        delete newScene._videoObjectURL;
        delete newScene._audioObjectURL;
        delete newScene._sfxObjectURL;
        delete newScene._sfxBuffer;
        delete newScene._isAnimating;
        delete newScene._isUploadingVideo;
        
        if (newScene.lines) {
            newScene.lines = newScene.lines.map((shot: any) => {
                const newShot = { ...shot };
                delete newShot._imageObjectURL;
                delete newShot._videoObjectURL;
                delete newShot._audioObjectURL;
                delete newShot._sfxObjectURL;
                delete newShot._sfxBuffer;
                delete newShot._isAnimating;
                delete newShot._isUploadingVideo;
                return newShot;
            });
        }
        return newScene;
    });

    const projectData = {
        version: constants.PROJECT_VERSION,
        story: dom.storyInput.value,
        scenes: cleanScenes,
        characters: state.characterProfiles,
        locations: state.locationProfiles,
        elements: state.keyElementProfiles,
        imageModel: dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL,
        videoModel: dom.videoModelSelect?.value || 'veo-3.1-lite-generate-001',
        imageStyle: dom.imageStyleSelect.value,
        characterModifier: dom.characterModifierSelect?.value,
        characterModifierCustom: dom.characterModifierCustom?.value,
        customPrompt: dom.customPromptInput.value,
        customStyleAnalyzedPrompt: dom.customStyleAnalyzedPrompt.value,
        customStyleKeywordsInput: dom.customStyleKeywordsInput.value,
        imageResolution: dom.imageResolutionSelect.value,
        detailLevel: dom.detailLevelSelect.value,
        pacingFactor: dom.pacingFactorSelect.value,
        customShotCount: dom.customShotCountInput.value,
        safeRephrase: dom.enableSafeRephraseCheckbox.checked,
        audioDuckingEnabled: state.audioDuckingEnabled,
        autoNormalizeAudio: state.autoNormalizeAudio,
        textOverlayEnabled: state.textOverlayEnabled,
        motionGraphicsEnabled: state.motionGraphicsEnabled,
        visualPunctuationEnabled: state.visualPunctuationEnabled,
        enableParallaxEffect: state.enableParallaxEffect,
        parallaxMode: state.parallaxMode,
        parallaxDustParticles: state.parallaxDustParticles,
        parallaxDepthBlur: state.parallaxDepthBlur,
        enableBackgroundBlur: state.enableBackgroundBlur,
        cinematographyPreset: state.cinematographyPreset,
        cameraMotionIntensity: state.cameraMotionIntensity,
        cameraShakeHandheld: state.cameraShakeHandheld,
        cinematicLetterbox: state.cinematicLetterbox,
        cinematicVignette: state.cinematicVignette,
        videoEffects: timelineState.videoEffects,
        ruleOfThirdsGuide: state.ruleOfThirdsGuide,
        bgAudioPrompt: state.bgAudioPrompt,
        bgAudioId: state.bgAudioId,
        bgAudioVolume: state.bgAudioVolume,
        uploadedAudioAssetId: state.uploadedAudioAssetId,
        uploadedVideoAssetId: state.uploadedVideoAssetId,
        uploadedVideoFileName: state.uploadedVideoFileName,
        selectedRhythmTemplateId: state.selectedRhythmTemplateId,
        talkingHeadDefaultMode: state.talkingHeadDefaultMode,
        talkingHeadShape: state.talkingHeadShape,
        talkingHeadSize: state.talkingHeadSize,
        talkingHeadBorderColor: state.talkingHeadBorderColor,
        talkingHeadBorderWidth: state.talkingHeadBorderWidth,
        talkingHeadShadow: state.talkingHeadShadow,
        customVoiceIds: state.customVoiceIds,
        showSubtitles: timelineState.showSubtitles,
        videoSubtitleStyle: timelineState.videoSubtitleStyle,
        videoSubtitlePosition: timelineState.videoSubtitlePosition,
        videoSubtitleFont: timelineState.videoSubtitleFont,
        videoSubtitleColors: state.videoSubtitleColors,
        customFonts: state.customFonts,
        timelineMode: timelineState.mode,
        graphics: timelineState.graphics,
        audioSplits: timelineState.audioSplits,
        // Save audio metadata
        audioMetadata: timelineState.masterAudioBuffer ? {
            duration: timelineState.masterAudioBuffer.duration,
            sampleRate: timelineState.masterAudioBuffer.sampleRate,
            numberOfChannels: timelineState.masterAudioBuffer.numberOfChannels,
            hadGlobalTimestamps: timelineState.globalWordTimestamps?.length || 0
        } : null,
        // Persistence for active production timeline
        videoTimelineMetadata: timelineState.clips.map(c => ({
            id: c.id,
            startTime: c.startTime,
            endTime: c.endTime,
            duration: c.duration,
            text: c.text,
            cameraMovement: c.cameraMovement,
            transitionToNext: c.transitionToNext,
            wordTimestamps: c.wordTimestamps,
            wordRange: c.wordRange, // Persistent transcript indices
            rotate: c.rotate,
            deviceTag: c.deviceTag,
            volume: c.volume,
            fadeIn: c.fadeIn,
            fadeOut: c.fadeOut,
            playbackRate: c.playbackRate,
            useOriginalAudio: c.useOriginalAudio,
            audioDuckingOverride: c.audioDuckingOverride,
            videoStartOffset: c.videoStartOffset,
            talkingHeadMode: c.talkingHeadMode,
            talkingHeadShape: c.talkingHeadShape,
            talkingHeadSize: c.talkingHeadSize,
            displayMode: c.displayMode,
            pipPosition: c.pipPosition,
            pipX: c.pipX,
            pipY: c.pipY,
            pipAnchorX: c.pipAnchorX,
            pipAnchorY: c.pipAnchorY,
            pipAnimation: c.pipAnimation,
            pipScale: c.pipScale,
            colorFilter: c.colorFilter,
            colorFilterIntensity: c.colorFilterIntensity
        })),
        meta: { savedAt: new Date().toISOString() }
    };

    // Autosave race guard: abort if project Epoch changed mid-save
    if (saveEpoch !== projectEpoch) {
        console.warn('[Save] Aborted stale autosave — project changed mid-save.');
        return;
    }

    // Sanitize projectData to strip any non-cloneable objects (DOM elements, AudioBuffers, circular references)
    const cleanProjectData = safeCloneClean(projectData);

    try {
        await DB.put(constants.APP_STATE_STORE, cleanProjectData, 'currentProject');
    } catch (e: any) {
        console.error("Save failed:", e);
        const errorMsg = e?.message || e?.name || (typeof e === 'string' ? e : (e && typeof e === 'object' && Object.keys(e).length) ? JSON.stringify(e) : 'IndexedDB storage error');
        if (e?.name === 'QuotaExceededError' || errorMsg.includes('QuotaExceededError')) {
            ui.showStatus('⚠️ Storage quota exceeded! Project cannot be saved locally. Please export your project or free up disk space.', true, 8000);
        } else {
            ui.showStatus(`⚠️ Save failed: ${errorMsg}`, true, 5000);
        }
        return; 
    }

    if (!isAutoSave) {
        const now = Date.now();
        if (forceCheckpoint || isFromVideoDirector || now - lastHistoryCheckpoint > HISTORY_CHECKPOINT_INTERVAL_MS) {
            if (saveEpoch !== projectEpoch) {
                console.warn('[Save] Aborted stale history checkpoint — project changed mid-save.');
                return;
            }
            lastHistoryCheckpoint = now;
            const historyItem = { id: Date.now(), timestamp: new Date().toISOString(), projectData: cleanProjectData };
            DB.put(constants.HISTORY_STORE, historyItem)
                .then(async () => {
                    try {
                        const allHistory = await DB.getAllByIndex(constants.HISTORY_STORE, 'timestamp', undefined, undefined, 'prev');
                        if (allHistory.length > 50) {
                            const toDelete = allHistory.slice(50);
                            await Promise.all(toDelete.map((item: any) => DB.delete(constants.HISTORY_STORE, item.id)));
                        }
                    } catch (err) {
                        console.error("History prune failed:", err);
                    }
                    if (!isFromVideoDirector && !forceCheckpoint) {
                        ui.showStatus('Version saved to history.', false, 2000);
                    }
                })
                .catch(err => console.error("History save failed:", err));
        }
    }
}

/**
 * Central debounced save scheduler.
 * Coalesces rapid sequential UI mutations (typing, slider dragging, toggling options)
 * into a single debounced save operation (600ms), eliminating CPU/IndexedDB serialization thrashing.
 */
export async function saveVersion(isAutoSave = true, forceCheckpoint = false): Promise<void> {
    isProjectDirty = true;
    if (forceCheckpoint) {
        pendingForceCheckpoint = true;
    }
    if (!isAutoSave) {
        pendingIsAutoSave = false;
    }

    // Immediate flush for forced checkpoints (e.g. user clicked Save / Snapshot)
    if (forceCheckpoint) {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
        const auto = pendingIsAutoSave;
        const check = pendingForceCheckpoint;
        isProjectDirty = false;
        pendingIsAutoSave = true;
        pendingForceCheckpoint = false;
        return performSaveVersion(auto, check);
    }

    // Schedule debounced save in 600ms
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
    }

    autoSaveTimer = setTimeout(() => {
        autoSaveTimer = null;
        if (!isProjectDirty) return;
        isProjectDirty = false;
        const auto = pendingIsAutoSave;
        const check = pendingForceCheckpoint;
        pendingIsAutoSave = true;
        pendingForceCheckpoint = false;
        performSaveVersion(auto, check).catch(err => {
            console.error('[Autosave] Scheduled save failed:', err);
        });
    }, 600);
}

/**
 * Flushes any pending debounced autosave immediately.
 */
export async function flushPendingSave(): Promise<void> {
    if (autoSaveTimer) {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = null;
    }
    if (isProjectDirty) {
        isProjectDirty = false;
        const auto = pendingIsAutoSave;
        const check = pendingForceCheckpoint;
        pendingIsAutoSave = true;
        pendingForceCheckpoint = false;
        return performSaveVersion(auto, check);
    }
}

// Ensure pending autosave is flushed before window unload
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        void flushPendingSave();
    });
}

async function hydrateAndMigrateSceneImages(): Promise<boolean> {
    if (!state.currentScenes || state.currentScenes.length === 0) return false;

    let wasMigrated = false;
    const allShots = state.currentScenes.flatMap(s => s.lines || [s]);

    for (const shot of allShots) {
        // Handle embedded data from portable exports
        if (shot.exportedImageData) {
            try {
                const blob = utils.base64ToBlob(shot.exportedImageData, shot.imageMimeType || 'image/png');
                const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
                shot.image_id = assetId;
                shot._imageObjectURL = URL.createObjectURL(blob);
                delete shot.exportedImageData; // Clear to save memory/storage space
                wasMigrated = true;
                continue;
            } catch (e) {
                console.error("Failed to ingest exported image data:", e);
            }
        }

        if (shot.image_id && !shot._imageObjectURL) {
            try {
                const blob = await assetStorage.getAsset(shot.image_id);
                if (blob) {
                    shot._imageObjectURL = URL.createObjectURL(blob);
                } else {
                    delete shot.image_id;
                }
            } catch (e) {
                console.error(`Failed to hydrate asset ${shot.image_id}:`, e);
            }
        }
        
        if (shot.video_id && !shot._videoObjectURL) {
            try {
                const blob = await assetStorage.getAsset(shot.video_id);
                if (blob) {
                    shot._videoObjectURL = URL.createObjectURL(blob);
                } else {
                    delete shot.video_id;
                }
            } catch (e) {
                console.error(`Failed to hydrate asset ${shot.video_id}:`, e);
            }
        }
        
        if (shot.sfx_id && !shot._sfxObjectURL) {
            try {
                const blob = await assetStorage.getAsset(shot.sfx_id);
                if (blob) {
                    shot._sfxObjectURL = URL.createObjectURL(blob);
                } else {
                    delete shot.sfx_id;
                }
            } catch (e) {
                console.error(`Failed to hydrate asset ${shot.sfx_id}:`, e);
            }
        }
        
        if (shot.imageData) { 
            wasMigrated = true;
            if (!shot.image_id) {
                 try {
                    const { data, mimeType } = utils.dataUrlToParts(shot.imageData);
                    const blob = utils.base64ToBlob(data, mimeType);
                    const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
                    
                    shot.image_id = assetId;
                    if (!shot._imageObjectURL) {
                        shot._imageObjectURL = URL.createObjectURL(blob);
                    }
                } catch (e) {
                    console.error("Failed to migrate shot image data:", e);
                }
            }
            delete shot.imageData;
        }
        
        if (shot._videoObjectURL && shot._videoObjectURL.startsWith('data:')) {
            try {
                const { data, mimeType } = utils.dataUrlToParts(shot._videoObjectURL);
                const blob = utils.base64ToBlob(data, mimeType);
                const assetId = await assetStorage.storeAsset(blob, 'video', 'current_project');
                shot.video_id = assetId;
                shot._videoObjectURL = URL.createObjectURL(blob);
                wasMigrated = true;
            } catch (e) {
                console.error("Failed to migrate shot video data:", e);
            }
        }
    }

    return wasMigrated;
}


/**
 * Loads a project state and attempts to restore the video timeline if visuals are present.
 */
export async function loadProject() {
    projectEpoch += 1;
    const myEpoch = projectEpoch;
    
    let projectData: any = null;
    let readFailed = false;
    let readError: any = null;
    try {
        projectData = await DB.get(constants.APP_STATE_STORE, 'currentProject');
    } catch (e: any) {
        readFailed = true;
        readError = e;
        console.error('Failed to load project from DB:', e);
    }

    if (myEpoch !== projectEpoch) {
        console.warn('[Load] Aborted stale loadProject — newer load initiated.');
        return;
    }

    if (readFailed) {
        ui.showStatus(`⚠️ Database read error (${readError?.message || 'Storage unavailable'}). Existing workspace was preserved to prevent data loss.`, true, 10000);
        return;
    }

    if (projectData) {
        try {
            resetVideoState();
            setProjectHydrating(true);
            timelineState.beginBatch();
            // Load story text
            if (dom.storyInput) dom.storyInput.value = projectData.story || '';
            
            // ✅ ROBUST VALIDATION
            if (!projectData.scenes || !Array.isArray(projectData.scenes)) {
                console.warn('⚠️ Invalid scenes data, resetting to empty array');
                state.currentScenes = [];
            } else {
                state.currentScenes = projectData.scenes;
                
                // Ensure all shots have an ID and clear stale blob URLs and flags
                state.currentScenes.forEach((scene: any, index: number) => {
                    if (scene.lines && Array.isArray(scene.lines)) {
                        scene.lines.forEach((line: any, j: number) => {
                            if (!line.id) line.id = `shot_${index}_${j}_${Math.random().toString(36).substr(2, 9)}`;
                            if (line._imageObjectURL?.startsWith('blob:')) delete line._imageObjectURL;
                            if (line._videoObjectURL?.startsWith('blob:')) delete line._videoObjectURL;
                            if (line._sfxObjectURL?.startsWith('blob:')) delete line._sfxObjectURL;
                            delete line._isAnimating;
                            delete line._isUploadingVideo;
                        });
                    } else if (typeof scene.shot_number !== 'undefined') {
                        if (!scene.id) scene.id = `shot_${index}_${Math.random().toString(36).substr(2, 9)}`;
                        if (scene._imageObjectURL?.startsWith('blob:')) delete scene._imageObjectURL;
                        if (scene._videoObjectURL?.startsWith('blob:')) delete scene._videoObjectURL;
                        if (scene._sfxObjectURL?.startsWith('blob:')) delete scene._sfxObjectURL;
                        delete scene._isAnimating;
                        delete scene._isUploadingVideo;
                    }
                });
            }
            
            // Handle portable audio import
            if (projectData.exportedAudioData) {
                try {
                    const audioBlob = utils.base64ToBlob(projectData.exportedAudioData, 'audio/wav');
                    const assetId = await assetStorage.storeAsset(audioBlob, 'audio', 'current_project');
                    state.uploadedAudioAssetId = assetId;
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    state.uploadedAudioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
                    delete projectData.exportedAudioData;
                } catch (e) {
                    console.error("Failed to ingest exported audio data:", e);
                }
            }

            const wasMigrated = await hydrateAndMigrateSceneImages();

            // Apply migration logic to character profiles
            state.characterProfiles = migrateCharacterProfiles(projectData.characters || []);
            state.characterProfiles.forEach(p => {
                p._nameRegex = utils.buildCharacterRegex(p, state.characterProfiles);
            });
            
            state.locationProfiles = projectData.locationProfiles || projectData.locations || [];
            state.locationProfiles.forEach(p => {
                p._nameRegex = new RegExp(`\\b${utils.escapeRegExp(p.name)}\\b`, 'i');
            });

            state.keyElementProfiles = projectData.keyElementProfiles || projectData.elements || [];
            state.keyElementProfiles.forEach(p => {
                p._nameRegex = new RegExp(`\\b${utils.escapeRegExp(p.name)}\\b`, 'i');
            });

            state.customVoiceIds = projectData.customVoiceIds || [];

            // Restore settings with existence checks
            if (dom.imageModelSelect) dom.imageModelSelect.value = projectData.imageModel || constants.DEFAULT_IMAGE_MODEL;
            if (dom.videoModelSelect) {
                let vModel = projectData.videoModel || 'veo-3.1-lite-generate-001';
                if (vModel.startsWith('gemini-') || vModel.includes('preview')) vModel = 'veo-3.1-lite-generate-001';
                dom.videoModelSelect.value = vModel;
            }
            if (dom.imageStyleSelect) dom.imageStyleSelect.value = projectData.imageStyle || constants.DEFAULT_IMAGE_STYLE;
            if (dom.characterModifierSelect && projectData.characterModifier !== undefined) dom.characterModifierSelect.value = projectData.characterModifier;
            if (dom.characterModifierCustom && projectData.characterModifierCustom !== undefined) dom.characterModifierCustom.value = projectData.characterModifierCustom;
            if (dom.customPromptInput) dom.customPromptInput.value = projectData.customPrompt || '';
            if (dom.customStyleAnalyzedPrompt) dom.customStyleAnalyzedPrompt.value = projectData.customStyleAnalyzedPrompt || '';
            if (dom.customStyleKeywordsInput) dom.customStyleKeywordsInput.value = projectData.customStyleKeywordsInput || '';
            const ratio = projectData.imageResolution || '16:9';
            if (dom.imageResolutionSelect) dom.imageResolutionSelect.value = ratio;
            updateAspectRatioState(ratio);
            if (dom.detailLevelSelect) dom.detailLevelSelect.value = projectData.detailLevel || 'auto';
            if (dom.pacingFactorSelect) dom.pacingFactorSelect.value = projectData.pacingFactor || 'normal';
            if (dom.customShotCountInput) dom.customShotCountInput.value = projectData.customShotCount || '10';

            // Restore checkboxes and update state
            if (dom.enableSafeRephraseCheckbox) {
                dom.enableSafeRephraseCheckbox.checked = projectData.safeRephrase !== false;
                state.safeRephraseEnabled = dom.enableSafeRephraseCheckbox.checked;
            }

            if (dom.enableTextOverlayCheckbox) {
                state.textOverlayEnabled = projectData.textOverlayEnabled || false;
                dom.enableTextOverlayCheckbox.checked = state.textOverlayEnabled;
            }

            if (dom.enableAudioDuckingCheckbox) {
                state.audioDuckingEnabled = projectData.audioDuckingEnabled !== false; // Default true
                dom.enableAudioDuckingCheckbox.checked = state.audioDuckingEnabled;
            }

            if (dom.enableAudioNormalizeCheckbox) {
                state.autoNormalizeAudio = projectData.autoNormalizeAudio !== false; // Default true
                dom.enableAudioNormalizeCheckbox.checked = state.autoNormalizeAudio;
            }

            if (dom.enableMotionGraphicsCheckbox) {
                state.motionGraphicsEnabled = projectData.motionGraphicsEnabled || false;
                dom.enableMotionGraphicsCheckbox.checked = state.motionGraphicsEnabled;
            }

            if (dom.enableBRollCheckbox) {
                state.visualPunctuationEnabled = projectData.visualPunctuationEnabled || false;
                dom.enableBRollCheckbox.checked = state.visualPunctuationEnabled;
            }

            if (dom.enableParallaxCheckbox) {
                state.enableParallaxEffect = projectData.enableParallaxEffect !== undefined ? projectData.enableParallaxEffect : true;
                dom.enableParallaxCheckbox.checked = state.enableParallaxEffect;
                const subPanel = document.getElementById('parallax-suboptions-panel');
                if (subPanel) {
                    subPanel.style.display = state.enableParallaxEffect ? 'block' : 'none';
                }
            }

            if (dom.parallaxModeSelect) {
                state.parallaxMode = projectData.parallaxMode || 'multi_layer';
                dom.parallaxModeSelect.value = state.parallaxMode;
            }

            if (dom.enableParallaxDustCheckbox) {
                state.parallaxDustParticles = projectData.parallaxDustParticles !== undefined ? projectData.parallaxDustParticles : true;
                dom.enableParallaxDustCheckbox.checked = state.parallaxDustParticles;
            }

            if (dom.enableParallaxDofCheckbox) {
                state.parallaxDepthBlur = projectData.parallaxDepthBlur !== undefined ? projectData.parallaxDepthBlur : true;
                dom.enableParallaxDofCheckbox.checked = state.parallaxDepthBlur;
            }

            if (dom.enableBgBlurCheckbox) {
                state.enableBackgroundBlur = projectData.enableBackgroundBlur !== undefined ? projectData.enableBackgroundBlur : false;
                dom.enableBgBlurCheckbox.checked = state.enableBackgroundBlur;
                timelineState.setVideoEffects({ enableBackgroundBlur: state.enableBackgroundBlur });
            }

            if (dom.cinematographyStylePresetSelect) {
                state.cinematographyPreset = projectData.cinematographyPreset || 'balanced';
                dom.cinematographyStylePresetSelect.value = state.cinematographyPreset;
            }
            if (dom.cameraMotionIntensitySelect) {
                state.cameraMotionIntensity = projectData.cameraMotionIntensity !== undefined ? projectData.cameraMotionIntensity : 1.0;
                dom.cameraMotionIntensitySelect.value = String(state.cameraMotionIntensity);
            }
            if (dom.enableCameraHandheldCheckbox) {
                state.cameraShakeHandheld = projectData.cameraShakeHandheld !== undefined ? projectData.cameraShakeHandheld : false;
                dom.enableCameraHandheldCheckbox.checked = state.cameraShakeHandheld;
            }
            if (dom.enableLetterboxCheckbox) {
                state.cinematicLetterbox = projectData.cinematicLetterbox !== undefined ? projectData.cinematicLetterbox : false;
                dom.enableLetterboxCheckbox.checked = state.cinematicLetterbox;
            }
            if (dom.enableCinematicVignetteCheckbox) {
                state.cinematicVignette = projectData.cinematicVignette !== undefined ? projectData.cinematicVignette : false;
                dom.enableCinematicVignetteCheckbox.checked = state.cinematicVignette;
            }
            if (dom.enableCompositionGridCheckbox) {
                state.ruleOfThirdsGuide = projectData.ruleOfThirdsGuide !== undefined ? projectData.ruleOfThirdsGuide : false;
                dom.enableCompositionGridCheckbox.checked = state.ruleOfThirdsGuide;
            }
            if (projectData.videoEffects) {
                timelineState.setVideoEffects(projectData.videoEffects);
            }
            
            // Restore background audio
            state.bgAudioPrompt = projectData.bgAudioPrompt || '';
            state.bgAudioId = projectData.bgAudioId || null;
            state.bgAudioVolume = projectData.bgAudioVolume ?? 0.3;
            if (dom.bgAudioVolumeSlider) dom.bgAudioVolumeSlider.value = String(state.bgAudioVolume);
            if (dom.bgAudioVolumeLabel) dom.bgAudioVolumeLabel.textContent = `${Math.round(state.bgAudioVolume * 100)}%`;
            state.uploadedAudioAssetId = projectData.uploadedAudioAssetId || null;
            state.uploadedVideoAssetId = projectData.uploadedVideoAssetId || null;
            state.uploadedVideoFileName = projectData.uploadedVideoFileName || null;
            state.selectedRhythmTemplateId = projectData.selectedRhythmTemplateId || 'youtube_essay';
            state.talkingHeadDefaultMode = projectData.talkingHeadDefaultMode || 'none';
            state.talkingHeadShape = projectData.talkingHeadShape || 'circle';
            state.talkingHeadSize = projectData.talkingHeadSize || 'medium';
            state.talkingHeadBorderColor = projectData.talkingHeadBorderColor || '#6366f1';
            state.talkingHeadBorderWidth = projectData.talkingHeadBorderWidth ?? 3;
            state.talkingHeadShadow = projectData.talkingHeadShadow ?? true;

            if (state.uploadedVideoAssetId) {
                try {
                    const videoBlob = await assetStorage.getAsset(state.uploadedVideoAssetId);
                    if (videoBlob) {
                        const objectURL = URL.createObjectURL(videoBlob);
                        state.uploadedVideoObjectURL = objectURL;
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
                                try { videoEl.currentTime = 0; } catch {}
                                resolve();
                            };
                            videoEl.onerror = () => resolve();
                            setTimeout(resolve, 3000);
                        });
                        state.uploadedVideoElement = videoEl;
                    }
                } catch (e) {
                    console.error('Failed to load uploaded video from asset storage:', e);
                }
            }
            
            if (state.uploadedAudioAssetId) {
                try {
                    const audioBlob = await assetStorage.getAsset(state.uploadedAudioAssetId);
                    if (audioBlob) {
                        const arrayBuffer = await audioBlob.arrayBuffer();
                        state.uploadedAudioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
                        timelineState.setMasterAudioBuffer(state.uploadedAudioBuffer);
                        timelineState.setMasterAudioAssetId(state.uploadedAudioAssetId);
                    }
                } catch (e) {
                    console.error('Failed to load uploaded audio from asset storage:', e);
                }
            }
            
            if (dom.bgAudioPromptInput) dom.bgAudioPromptInput.value = state.bgAudioPrompt;
            if (state.bgAudioId) {
                try {
                    const bgAudioBlob = await assetStorage.getAsset(state.bgAudioId);
                    if (bgAudioBlob) {
                        const arrayBuffer = await bgAudioBlob.arrayBuffer();
                        state._bgAudioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
                        state._bgAudioObjectURL = URL.createObjectURL(bgAudioBlob);
                        if (dom.clearBgAudioBtn) dom.clearBgAudioBtn.classList.remove('hidden');
                        if (dom.generateBgAudioBtn) dom.generateBgAudioBtn.innerHTML = '✓ Regenerate';
                    }
                } catch (e) {
                    console.error('Failed to load background audio from asset storage:', e);
                }
            }
            
            // Restore video state
            timelineState.setShowSubtitles(projectData.showSubtitles || false);
            if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = timelineState.showSubtitles;
            timelineState.setVideoSubtitleStyle(projectData.videoSubtitleStyle || 'anime');
            if (dom.videoSubtitleStyleSelect) dom.videoSubtitleStyleSelect.value = timelineState.videoSubtitleStyle;
            timelineState.setVideoSubtitlePosition(projectData.videoSubtitlePosition || 'bottom');
            if (dom.videoSubtitlePositionSelect) dom.videoSubtitlePositionSelect.value = timelineState.videoSubtitlePosition;
            timelineState.setVideoSubtitleFont(projectData.videoSubtitleFont || 'Montserrat');
            if (dom.videoSubtitleFontSelect) dom.videoSubtitleFontSelect.value = timelineState.videoSubtitleFont;
            if (dom.videoSubtitleStyleSelect) dom.videoSubtitleStyleSelect.disabled = !timelineState.showSubtitles;
            if (dom.videoSubtitlePositionSelect) dom.videoSubtitlePositionSelect.disabled = !timelineState.showSubtitles;
            if (dom.videoSubtitleFontSelect) dom.videoSubtitleFontSelect.disabled = !timelineState.showSubtitles;
            if (dom.uploadSubtitleFontBtn) dom.uploadSubtitleFontBtn.disabled = !timelineState.showSubtitles;
            
            if (Array.isArray(projectData.customFonts) && projectData.customFonts.length > 0) {
                state.customFonts = projectData.customFonts;
                for (const fontItem of projectData.customFonts) {
                    if (fontItem.dataUrl) {
                        try {
                            fetch(fontItem.dataUrl).then(res => res.arrayBuffer()).then(buffer => {
                                const fontFace = new FontFace(fontItem.name, buffer);
                                return fontFace.load();
                            }).then(loadedFace => {
                                document.fonts.add(loadedFace);
                            }).catch(err => console.warn('Could not register project font:', fontItem.name, err));
                        } catch {}
                    }
                }
                refreshCustomFontSelect();
            }
            state.videoSubtitleColors = projectData.videoSubtitleColors || {};
            timelineState.setMode(projectData.timelineMode || 'free');
            timelineState.setGraphics(projectData.graphics || []);
            timelineState.setAudioSplits(projectData.audioSplits || []);
            
            // Update UI from restored settings
            if (dom.detailLevelSelect) ui.handlePacingChange(dom.detailLevelSelect.value);
            ui.handleImageStyleChange();
            ui.handleImageModelChange();

            // Run character frequency analysis after loading story and characters
            analyzeCharacterFrequency();

            // Render content 
            ui.renderResults(state.currentScenes);
            ui.renderCharacterList(state.characterProfiles);
            ui.renderLocationList(state.locationProfiles);
            ui.renderKeyElementList(state.keyElementProfiles);

            // Final UI sync
            ui.updateUiForStoryChange();
            restoreMasterAudioUI();
            
            // Post-load feedback logic
            const hasScenes = Array.isArray(state.currentScenes) && state.currentScenes.length > 0;
            const hasStory = dom.storyInput && dom.storyInput.value.trim().length > 0;
            
            if (hasStory && !hasScenes) {
                ui.showStatus('Project loaded. Story text restored. Click "Create Storyboard" to generate scenes.', false, 6000);
            } else if (!hasStory && !hasScenes) {
                ui.showStatus('Empty project imported. Start by writing your story.', false, 5000);
            } else {
                const totalShots = state.currentScenes.flatMap(s => s.lines || [s]).length;
                const imageCount = state.currentScenes
                    .flatMap(s => s.lines || [s])
                    .filter(shot => shot.image_id)
                    .length;
                
                ui.showStatus(
                    `Project loaded: ${totalShots} shot${totalShots !== 1 ? 's' : ''} restored${imageCount > 0 ? ` (${imageCount} with images)` : ''}.`, 
                    false, 
                    3000
                );
            }

            // Timeline restoration
            await restoreVideoTimeline(projectData.videoTimelineMetadata, { silent: true });

            // Ensure all timeline clips are properly synchronized with state.uploadedVideoElement and shot talkingHead settings
            if (state.uploadedVideoElement && timelineState.clips) {
                const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
                timelineState.clips.forEach((clip: any, idx: number) => {
                    clip.talkingHeadVideoElement = state.uploadedVideoElement;
                    const matchedShot = allShots.find((s: any) => s.id && s.id === clip.id) || allShots[idx];
                    if (matchedShot) {
                        if (matchedShot.talkingHeadMode && (!clip.talkingHeadMode || clip.talkingHeadMode === 'none')) {
                            clip.talkingHeadMode = matchedShot.talkingHeadMode;
                        }
                        if (matchedShot.talkingHeadShape && !clip.talkingHeadShape) {
                            clip.talkingHeadShape = matchedShot.talkingHeadShape;
                        }
                        if (matchedShot.talkingHeadSize && !clip.talkingHeadSize) {
                            clip.talkingHeadSize = matchedShot.talkingHeadSize;
                        }
                        if (matchedShot.displayMode && !clip.displayMode) {
                            clip.displayMode = matchedShot.displayMode;
                        }
                        if (typeof matchedShot.videoStartOffset === 'number' && (!clip.videoStartOffset || clip.videoStartOffset === 0)) {
                            clip.videoStartOffset = matchedShot.videoStartOffset;
                        }
                    }
                });
            }
            populateRhythmTemplateSelectors();

            updateVideoContext();
            if (dom.videoCanvas) {
                dom.videoCanvas.classList.remove('hidden');
                dom.videoCanvas.style.display = 'block';
            }
            if (dom.videoPreGenerationOverlay) {
                dom.videoPreGenerationOverlay.classList.add('hidden');
            }
            if (dom.videoControlsContainer) {
                dom.videoControlsContainer.classList.remove('hidden');
            }
            if (dom.videoPostGenerationOverlay) {
                dom.videoPostGenerationOverlay.classList.remove('hidden');
            }
            if (dom.videoExportBtn) dom.videoExportBtn.disabled = false;
            if (dom.magicCameraBtn) dom.magicCameraBtn.disabled = false;
            if (dom.analyzeTransitionsBtn) dom.analyzeTransitionsBtn.disabled = false;
            if (dom.openTranscriptEditorBtn) {
                dom.openTranscriptEditorBtn.disabled = false;
                dom.openTranscriptEditorBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
            if (dom.videoDirectorBtn) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
            }
            ui.renderTimelineEditor();
            requestAnimationFrame(() => {
                ui.renderTimelineEditor();
            });
            drawVideoFrame(0);

            const allShotsStats = state.currentScenes.flatMap(s => (s.lines || [s]));
            const hasGeneratedImages = state.uploadedVideoElement || allShotsStats.some(shot => !!shot.image_id || !!shot._imageObjectURL || !!shot.video_id || !!shot._videoObjectURL || shot.talkingHeadMode === 'full' || shot.talkingHeadMode === 'split');

            if (hasGeneratedImages && dom.videoDirectorBtn) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
                ui.updateWorkflowStepStatus(3, 'completed');
                ui.updateWorkflowStepStatus(4, 'active');
            }

            if (wasMigrated) {
                saveVersion(true);
            }

        } catch (error: any) {
            console.error("Load failed:", error);
            ui.showStatus(`Failed to restore project: ${error.message}. Workspace was preserved.`, true, 8000);
        } finally {
            timelineState.endBatch();
            setProjectHydrating(false);
        }
    } else {
        startNewProject(false);
    }
}

export function startNewProject(shouldConfirm: boolean | Event = true) {
    projectEpoch += 1;
    const resetLogic = async () => {
        resetVideoState();
        clearMasterAudio();
        clearBgAudio();

        if (dom.storyInput) dom.storyInput.value = '';
        state.currentScenes = [];
        state.characterProfiles = [];
        state.locationProfiles = [];
        state.keyElementProfiles = [];
        ui.renderResults([]);
        ui.renderCharacterList([]);
        ui.renderLocationList([]);
        ui.renderKeyElementList([]);
        ui.switchTab('storyboard');
        ui.showStatus(''); // Clear any lingering status messages
        try { 
            await DB.delete(constants.APP_STATE_STORE, 'currentProject'); 
        } catch (e) {
            console.warn("Could not delete currentProject from state store:", e);
        }
        state.visualPunctuationEnabled = false;
        if (dom.enableBRollCheckbox) dom.enableBRollCheckbox.checked = false;
        state.enableParallaxEffect = true;
        if (dom.enableParallaxCheckbox) dom.enableParallaxCheckbox.checked = true;
        state.enableBackgroundBlur = false;
        if (dom.enableBgBlurCheckbox) dom.enableBgBlurCheckbox.checked = false;
        timelineState.setVideoEffects({ enableBackgroundBlur: false });
        state.cinematographyPreset = 'balanced';
        if (dom.cinematographyStylePresetSelect) dom.cinematographyStylePresetSelect.value = 'balanced';
        state.cameraMotionIntensity = 1.0;
        if (dom.cameraMotionIntensitySelect) dom.cameraMotionIntensitySelect.value = '1.0';
        state.cameraShakeHandheld = false;
        if (dom.enableCameraHandheldCheckbox) dom.enableCameraHandheldCheckbox.checked = false;
        state.cinematicLetterbox = false;
        if (dom.enableLetterboxCheckbox) dom.enableLetterboxCheckbox.checked = false;
        state.cinematicVignette = false;
        if (dom.enableCinematicVignetteCheckbox) dom.enableCinematicVignetteCheckbox.checked = false;
        state.ruleOfThirdsGuide = false;
        if (dom.enableCompositionGridCheckbox) dom.enableCompositionGridCheckbox.checked = false;
        state.audioDuckingEnabled = true;
        if (dom.enableAudioDuckingCheckbox) dom.enableAudioDuckingCheckbox.checked = true;
        state.textOverlayEnabled = false;
        if (dom.enableTextOverlayCheckbox) dom.enableTextOverlayCheckbox.checked = false;
        state.motionGraphicsEnabled = false;
        if (dom.enableMotionGraphicsCheckbox) dom.enableMotionGraphicsCheckbox.checked = false;
        const currentRatio = dom.imageResolutionSelect?.value || '16:9';
        updateAspectRatioState(currentRatio);
        ui.updateUiForStoryChange();
        ui.resetWorkflowSteps();

        // Preserve active cookies and session status across project reset
        if (state.geminiAuthMode === 'webCookie' && state.geminiPsid) {
            sessionStorage.setItem('geminiCookieExpired', 'false');
            localStorage.setItem('geminiCookieExpired', 'false');
            ui.updateApiStatusBadge();
        }
    };

    if (typeof shouldConfirm === 'boolean' ? shouldConfirm : true) {
        ui.showConfirmation('Start New Project', 'Are you sure?', resetLogic);
    } else { resetLogic(); }
}

export async function triggerProjectImport() {
    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
        try {
            // @ts-ignore
            const electron = (window as any).electronAPI;
            const invoke = electron.invoke || electron.ipcRenderer?.invoke;
            if (invoke) {
                const result = await invoke.call(electron, 'open-file', {
                    filters: [{ name: 'Project File', extensions: ['contentgenai', 'cgproj'] }]
                });
                if (result.success && result.data && result.filePath) {
                    if (result.filePath.toLowerCase().endsWith('.cgproj')) {
                        const fileObj = new File([result.data], result.filePath);
                        await importProjectArchive(fileObj);
                        // @ts-ignore
                        ui.openVideoDirectorModal();
                        return;
                    }
                    
                    let fileContent = new TextDecoder().decode(result.data);
                    fileContent = fileContent.replace(/([:,\[]\s*)undefined\b/g, '$1null');
                    const projectData = JSON.parse(fileContent);
                    await DB.put(constants.APP_STATE_STORE, projectData, 'currentProject');
                    await loadProject();
                    ui.showStatus('Project imported.', false, 3000);
                    return;
                } else if (result.canceled) {
                    return;
                }
                console.warn("Electron native open failed, falling back to browser.", result.error);
            }
        } catch(e) {
             console.warn("Could not use Electron IPC for open-file.", e);
        }
    }
    const input = document.getElementById('import-file-input') as HTMLInputElement;
    if (input) input.click();
}

export async function handleFileImport(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    
    const file = input.files[0];
    if (file.name.toLowerCase().endsWith('.cgproj')) {
        try {
            await importProjectArchive(file);
            ui.openVideoDirectorModal(); // Automatically open director for .cgproj
        } catch (error: any) {
            ui.showStatus(`Import failed: ${error.message}`, true, 6000);
        } finally {
            input.value = '';
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let fileContent = e.target?.result as string;
            if (!fileContent) throw new Error("File is empty or could not be read.");
            // Fix corrupted JSON from previous buggy exports
            fileContent = fileContent.replace(/([:,\[]\s*)undefined\b/g, '$1null');
            
            const projectData = JSON.parse(fileContent);
            // Put into state store
            await DB.put(constants.APP_STATE_STORE, projectData, 'currentProject');
            // Trigger load logic which now handles embedded exportedImageData
            await loadProject();
            ui.showStatus('Project imported.', false, 3000);
        } catch (error: any) { ui.showStatus(`Import failed: ${error.message}`, true, 6000); }
        finally { input.value = ''; }
    };
    reader.readAsText(file);
}

registerSaveVersion(saveVersion);
registerFlushPendingSave(flushPendingSave);
