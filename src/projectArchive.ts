import { safeJsonStringify } from './utils-core';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { state } from './state';
import { timelineState } from './state-timeline';
import { assetStorage } from './assetStorage';
import * as dom from './dom';
import * as ui from './ui';
import { syncStateFromDOM, saveVersion } from './handlers-project';
import { updateVideoContext, refreshCustomFontSelect } from './videoController';
import { drawVideoFrame, setVideoRenderContext } from './videoRenderer';
import { restoreVideoTimeline } from './timelineBuilder';
import { analyzeCharacterFrequency } from './handlers-assets';
import * as utils from './utils';
import { restoreMasterAudioUI, populateRhythmTemplateSelectors } from './masterAudioDirector';
import { updateAspectRatioState } from './ui-renderers';
import { setProjectHydrating, isProjectHydrating } from './projectHydration';


function getFirstThreeWords(): string {
    const derived = utils.getScriptDerivedTitle(3);
    if (derived) return derived;
    return "my_project";
}

export async function exportProjectArchive(onProgress?: (percent: number, message: string) => void) {
    try {
        syncStateFromDOM();
        onProgress?.(5, 'Gathering project state...');
        ui.showStatus('Bundling project into .cgproj...', false);
        const zip = new JSZip();
        
        const storyText = (state as any).originalStory || dom.storyInput?.value || '';

        // Remove ephemeral object URLs from state before saving
        const safeState = {
            currentScenes: state.currentScenes,
            characterProfiles: state.characterProfiles,
            locationProfiles: state.locationProfiles,
            keyElementProfiles: state.keyElementProfiles,
            originalStory: storyText,
            story: storyText,
            audioState: (state as any).audioState,
            bgAudioPrompt: state.bgAudioPrompt,
            bgAudioId: state.bgAudioId,
            bgAudioVolume: state.bgAudioVolume,
            audioDuckingEnabled: state.audioDuckingEnabled,
            autoNormalizeAudio: state.autoNormalizeAudio,
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
            safeRephraseEnabled: state.safeRephraseEnabled,
            currentTextModel: state.currentTextModel,
            imageModel: dom.imageModelSelect?.value,
            videoModel: dom.videoModelSelect?.value,
            imageStyle: dom.imageStyleSelect?.value,
            characterModifier: dom.characterModifierSelect?.value,
            characterModifierCustom: dom.characterModifierCustom?.value,
            customPrompt: dom.customPromptInput?.value,
            customStyleAnalyzedPrompt: dom.customStyleAnalyzedPrompt?.value,
            customStyleKeywordsInput: dom.customStyleKeywordsInput?.value,
            imageResolution: dom.imageResolutionSelect?.value,
            detailLevel: dom.detailLevelSelect?.value,
            pacingFactor: dom.pacingFactorSelect?.value,
            customShotCount: dom.customShotCountInput?.value,
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
            forceAlignSubtitleCues: state.forceAlignSubtitleCues,
            bRollTranscript: state.bRollTranscript,
            masterAudioTranscript: state.masterAudioTranscript,
            showSubtitles: timelineState.showSubtitles,
            videoSubtitleStyle: timelineState.videoSubtitleStyle,
            videoSubtitlePosition: timelineState.videoSubtitlePosition,
            videoSubtitleFont: timelineState.videoSubtitleFont,
            videoSubtitleColors: state.videoSubtitleColors,
            customFonts: state.customFonts,
            timelineMode: timelineState.mode,
            graphics: timelineState.graphics,
            audioSplits: timelineState.audioSplits,
            audioMetadata: timelineState.masterAudioBuffer ? {
                duration: timelineState.masterAudioBuffer.duration,
                sampleRate: timelineState.masterAudioBuffer.sampleRate,
                numberOfChannels: timelineState.masterAudioBuffer.numberOfChannels,
                hadGlobalTimestamps: timelineState.globalWordTimestamps?.length || 0
            } : null,
            videoTimelineMetadata: timelineState.clips.map(c => ({
                id: c.id,
                startTime: c.startTime,
                endTime: c.endTime,
                duration: c.duration,
                text: c.text,
                cameraMovement: c.cameraMovement,
                transitionToNext: c.transitionToNext,
                wordTimestamps: c.wordTimestamps,
                wordRange: c.wordRange,
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
                pipScale: c.pipScale
            }))
        };
        const cleanState = JSON.parse(safeJsonStringify(safeState));
        if (cleanState.currentScenes) {
            cleanState.currentScenes.forEach((scene: any) => {
                delete scene._imageObjectURL;
                delete scene._videoObjectURL;
                delete scene._audioObjectURL;
                delete scene._sfxObjectURL;
                if (scene.lines && Array.isArray(scene.lines)) {
                    scene.lines.forEach((line: any) => {
                        delete line._imageObjectURL;
                        delete line._videoObjectURL;
                        delete line._audioObjectURL;
                        delete line._sfxObjectURL;
                    });
                }
            });
        }
        if (cleanState.audioState) {
            delete cleanState.audioState.masterAudioUrl;
        }

        const stateJson = safeJsonStringify(cleanState);
        zip.file('project.json', stateJson);

        const mediaFolder = zip.folder('media');
        if (!mediaFolder) {
            throw new Error('Failed to create media folder in archive');
        }

        const assetIds = new Set<string>();

        function isValidAssetId(id: any): id is string {
            if (!id || typeof id !== 'string') return false;
            const trimmed = id.trim();
            return trimmed !== '' && trimmed !== 'none' && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== 'default';
        }

        function tryAddId(id: string | null | undefined) {
            if (isValidAssetId(id)) assetIds.add(id.trim());
        }

        if (state.currentScenes) {
            const allShots = state.currentScenes.flatMap((s: any) => s.lines || [s]);
            for (const shot of allShots) {
                tryAddId((shot as any).image_id);
                tryAddId((shot as any).video_id);
                tryAddId((shot as any).audio_id);
                tryAddId((shot as any).sfx_id);
                tryAddId((shot as any).overlayImageId);
            }
        }

        // Validate global slot IDs against storage; clean up empty/stale slots from cleanState
        const globalSlotKeys = [
            { key: 'bgAudioId', val: state.bgAudioId },
            { key: 'uploadedAudioAssetId', val: state.uploadedAudioAssetId },
            { key: 'uploadedVideoAssetId', val: state.uploadedVideoAssetId },
            { key: 'masterAudioId', val: (state as any).audioState?.masterAudioId }
        ];

        for (const slot of globalSlotKeys) {
            if (isValidAssetId(slot.val)) {
                const blob = await assetStorage.getAsset(slot.val);
                if (blob) {
                    assetIds.add(slot.val);
                } else {
                    if (slot.key === 'masterAudioId') {
                        if (cleanState.audioState) delete cleanState.audioState.masterAudioId;
                    } else {
                        (cleanState as any)[slot.key] = null;
                    }
                }
            }
        }

        let mediaCount = 0;
        let missingCount = 0;
        const totalAssets = assetIds.size;
        let processedIdx = 0;

        for (const assetId of assetIds) {
            processedIdx++;
            const pct = Math.round(10 + (processedIdx / Math.max(1, totalAssets)) * 40);
            onProgress?.(pct, `Packaging media (${processedIdx}/${totalAssets})...`);
            if (totalAssets > 10 && processedIdx % 5 === 0) {
                ui.showStatus(`Packaging media assets (${processedIdx}/${totalAssets})...`, false);
                await new Promise(r => setTimeout(r, 0));
            }

            const blob = await assetStorage.getAsset(assetId);
            if (blob) {
                let ext = 'bin';
                if (blob.type.includes('image/png')) ext = 'png';
                else if (blob.type.includes('image/jpeg')) ext = 'jpg';
                else if (blob.type.includes('video/webm')) ext = 'webm';
                else if (blob.type.includes('video/mp4')) ext = 'mp4';
                else if (blob.type.includes('audio/wav') || blob.type.includes('audio/x-wav')) ext = 'wav';
                else if (blob.type.includes('audio/mpeg') || blob.type.includes('audio/mp3')) ext = 'mp3';
                else if (blob.type.includes('audio/webm')) ext = 'webm';
                else if (blob.type.includes('audio/')) ext = 'wav'; // default our internal audio to wav
                else if (assetId.startsWith('image_')) ext = 'png';
                else if (assetId.startsWith('video_')) ext = 'mp4'; // fallback
                else if (assetId.startsWith('audio_') || assetId.startsWith('sfx_')) ext = 'wav'; // our synthesized audio is always wav
                
                mediaFolder.file(`${assetId}.${ext}`, blob);
                mediaCount++;
            } else {
                console.warn(`[Export] Asset missing or expired from local DB: ${assetId}`);
                missingCount++;
            }
        }

        const filename = `${getFirstThreeWords()}.cgproj`;
        let savedDirectly = false;

        // Check if browser supports File System Access API streaming and not inside Electron
        const canStreamToDisk = typeof window !== 'undefined' && 
                                'showSaveFilePicker' in window && 
                                !(window as any).electronAPI;

        if (canStreamToDisk) {
            try {
                onProgress?.(55, 'Selecting destination...');
                ui.showStatus('Choose destination to save project archive...', false, 4000);
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'ContentGen Project File (*.cgproj)',
                        accept: { 'application/octet-stream': ['.cgproj'] }
                    }]
                });

                if (handle) {
                    onProgress?.(60, 'Streaming project archive...');
                    ui.showStatus('Streaming project archive directly to disk...', false);
                    const writable = await handle.createWritable();
                    const writer = writable.getWriter();
                    
                    await new Promise<void>((resolve, reject) => {
                        const stream = zip.generateInternalStream({
                            type: 'uint8array',
                            streamFiles: true,
                            compression: 'STORE' // Images/audio/video are already compressed; STORE is fast and uses minimal RAM
                        });

                        let hasError = false;
                        stream.on('data', async (chunk: Uint8Array, metadata: any) => {
                            if (hasError) return;
                            stream.pause();
                            try {
                                await writer.write(chunk);
                                if (metadata?.percent) {
                                    const streamPct = Math.round(60 + (metadata.percent / 100) * 38);
                                    onProgress?.(streamPct, `Saving project: ${Math.round(metadata.percent)}%`);
                                    ui.showStatus(`Saving project: ${Math.round(metadata.percent)}%`, false);
                                }
                                stream.resume();
                            } catch (writeErr) {
                                hasError = true;
                                reject(writeErr);
                            }
                        });

                        stream.on('error', (err: any) => {
                            hasError = true;
                            reject(err);
                        });

                        stream.on('end', async () => {
                            if (hasError) return;
                            try {
                                await writer.close();
                                resolve();
                            } catch (closeErr) {
                                reject(closeErr);
                            }
                        });

                        stream.resume();
                    });
                    savedDirectly = true;
                }
            } catch (pickerErr: any) {
                if (pickerErr?.name === 'AbortError') {
                    ui.showStatus('Export cancelled.', false, 2000);
                    return;
                }
                console.warn('[Export] Direct disk stream not available or failed, falling back to blob download:', pickerErr);
            }
        }

        if (!savedDirectly) {
            onProgress?.(60, 'Packaging archive...');
            ui.showStatus('Packaging project archive...', false);
            const content = await zip.generateAsync(
                { 
                    type: 'blob', 
                    compression: 'STORE', // STORE prevents allocating massive DEFLATE buffers for 100+ images/videos
                    streamFiles: true 
                },
                (metadata) => {
                    if (metadata.percent) {
                        const packPct = Math.round(60 + (metadata.percent / 100) * 38);
                        onProgress?.(packPct, `Packaging: ${Math.round(metadata.percent)}%`);
                        ui.showStatus(`Packaging project: ${Math.round(metadata.percent)}%`, false);
                    }
                }
            );
            await utils.downloadBlob(content, filename);
        }
        
        onProgress?.(100, 'Project exported!');
        let statusMsg = `Project exported! (${mediaCount} media files included)`;
        if (missingCount > 0) {
            statusMsg = `Exported with warnings: ${mediaCount} media files included, ${missingCount} missing.`;
        }
        ui.showStatus(statusMsg, missingCount > 0, missingCount > 0 ? 5000 : 3000);
    } catch (e: any) {
        console.error("Export error", e);
        const errDesc = e.message?.includes('memory') || String(e).includes('memory') 
            ? 'Error exporting: Project too large for memory limits.' 
            : 'Error exporting project archive.';
        ui.showStatus(errDesc, true);
        throw e;
    }
}

export async function importProjectArchive(file: File) {
    try {
        setProjectHydrating(true);
        timelineState.beginBatch();

        setVideoRenderContext(null);
        ui.showStatus('Extracting .cgproj...', false);
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        
        const projectJsonFile = loadedZip.file('project.json');
        if (!projectJsonFile) throw new Error('Invalid project file: missing project.json');
        
        const stateStr = await projectJsonFile.async('text');
        const importedState = JSON.parse(stateStr);

        let restoredCount = 0;
        const files = Object.keys(loadedZip.files);
        for (const path of files) {
            const zipObj = loadedZip.files[path];
            if (!zipObj.dir && path.startsWith('media/')) {
                const filename = path.split('/').pop();
                if (filename) {
                    const parts = filename.split('.');
                    const ext = parts.pop()?.toLowerCase(); // remove extension
                    const originalId = parts.join('.');
                    
                    let mimeType = 'application/octet-stream';
                    if (ext === 'png') mimeType = 'image/png';
                    else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                    else if (ext === 'mp4') mimeType = 'video/mp4';
                    else if (ext === 'webm') mimeType = 'video/webm';
                    else if (ext === 'mp3') mimeType = 'audio/mpeg';
                    else if (ext === 'wav') mimeType = 'audio/wav';
                    
                    const rawBlob = await zipObj.async('blob');
                    const blob = new Blob([rawBlob], { type: mimeType });
                    
                    let type: 'image' | 'audio' | 'video' = 'image';
                    if (originalId.startsWith('video_')) type = 'video';
                    else if (originalId.startsWith('audio_') || originalId.startsWith('sfx_') || originalId.startsWith('bgm_')) type = 'audio';
                    
                    await assetStorage.storeAsset(blob, type, undefined, originalId);
                    restoredCount++;
                }
            }
        }

        // Apply state
        // Allowlist merging to prevent prototype pollution and credential overwrites
        const allowedKeys = [
            'currentScenes', 'characterProfiles', 'locationProfiles', 'keyElementProfiles',
            'originalStory', 'story', 'audioState', 'bgAudioPrompt', 'bgAudioId', 'bgAudioVolume', 'audioDuckingEnabled', 'autoNormalizeAudio',
            'uploadedAudioAssetId', 'uploadedVideoAssetId', 'uploadedVideoFileName', 'selectedRhythmTemplateId', 'talkingHeadDefaultMode', 'talkingHeadShape', 'talkingHeadSize', 'talkingHeadBorderColor', 'talkingHeadBorderWidth', 'talkingHeadShadow', 'customVoiceIds', 'safeRephraseEnabled', 'currentTextModel', 'textOverlayEnabled',
            'motionGraphicsEnabled', 'visualPunctuationEnabled', 'enableParallaxEffect',
            'parallaxMode', 'parallaxDustParticles', 'parallaxDepthBlur',
            'enableBackgroundBlur', 'cinematographyPreset', 'cameraMotionIntensity', 'cameraShakeHandheld',
            'cinematicLetterbox', 'cinematicVignette', 'ruleOfThirdsGuide',
            'forceAlignSubtitleCues', 'bRollTranscript', 'masterAudioTranscript'
        ];
        
        for (const key of allowedKeys) {
            if (importedState[key] !== undefined) {
                (state as any)[key] = importedState[key];
            }
        }

        // Restore story text to state and input field
        const storyText = importedState.story || importedState.originalStory || importedState.script || (state as any).originalStory || '';
        (state as any).originalStory = storyText;
        if (dom.storyInput) {
            dom.storyInput.value = storyText;
        }

        // Ensure scenes have IDs if missing and clear stale flags
        if (state.currentScenes && Array.isArray(state.currentScenes)) {
            state.currentScenes.forEach((scene: any, index: number) => {
                if (scene.lines && Array.isArray(scene.lines)) {
                    scene.lines.forEach((line: any, j: number) => {
                        if (!line.id) line.id = `shot_${index}_${j}_${Math.random().toString(36).substr(2, 9)}`;
                        if (line._imageObjectURL?.startsWith('blob:')) delete line._imageObjectURL;
                        if (line._videoObjectURL?.startsWith('blob:')) delete line._videoObjectURL;
                        if (line._audioObjectURL?.startsWith('blob:')) delete line._audioObjectURL;
                        if (line._sfxObjectURL?.startsWith('blob:')) delete line._sfxObjectURL;
                        delete line._isAnimating;
                        delete line._isUploadingVideo;
                    });
                } else if (typeof scene.shot_number !== 'undefined') {
                    if (!scene.id) scene.id = `shot_${index}_${Math.random().toString(36).substr(2, 9)}`;
                    if (scene._imageObjectURL?.startsWith('blob:')) delete scene._imageObjectURL;
                    if (scene._videoObjectURL?.startsWith('blob:')) delete scene._videoObjectURL;
                    if (scene._audioObjectURL?.startsWith('blob:')) delete scene._audioObjectURL;
                    if (scene._sfxObjectURL?.startsWith('blob:')) delete scene._sfxObjectURL;
                    delete scene._isAnimating;
                    delete scene._isUploadingVideo;
                }
            });
        }
        
        // Re-create object URLs for all shots inside currentScenes
        if (state.currentScenes) {
            const allShots = state.currentScenes.flatMap((s: any) => s.lines || [s]);
            for (const shot of allShots) {
                if ((shot as any).image_id) {
                    const blob = await assetStorage.getAsset((shot as any).image_id);
                    if (blob) (shot as any)._imageObjectURL = URL.createObjectURL(blob);
                }
                if ((shot as any).video_id) {
                    const blob = await assetStorage.getAsset((shot as any).video_id);
                    if (blob) (shot as any)._videoObjectURL = URL.createObjectURL(blob);
                }
                if ((shot as any).audio_id) {
                    const blob = await assetStorage.getAsset((shot as any).audio_id);
                    if (blob) (shot as any)._audioObjectURL = URL.createObjectURL(blob);
                }
                if ((shot as any).sfx_id) {
                    const blob = await assetStorage.getAsset((shot as any).sfx_id);
                    if (blob) (shot as any)._sfxObjectURL = URL.createObjectURL(blob);
                }
                if ((shot as any).overlayImageId) {
                    const blob = await assetStorage.getAsset((shot as any).overlayImageId);
                    if (blob) (shot as any).overlayImageUrl = URL.createObjectURL(blob);
                }
            }
        }
        if ((state as any).audioState?.masterAudioId) {
             const blob = await assetStorage.getAsset((state as any).audioState.masterAudioId);
             if (blob) {
                 (state as any).audioState.masterAudioUrl = URL.createObjectURL(blob);
                 try {
                     const arrayBuffer = await blob.arrayBuffer();
                     const audioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
                     timelineState.setMasterAudioBuffer(audioBuffer);
                     timelineState.setMasterAudioAssetId((state as any).audioState.masterAudioId);
                 } catch (err) {
                     console.warn('Failed to decode master audio buffer from archive:', err);
                 }
             }
        }

        // Restore uploaded audio if present
        if (state.uploadedAudioAssetId) {
            try {
                const audioBlob = await assetStorage.getAsset(state.uploadedAudioAssetId);
                if (audioBlob) {
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    state.uploadedAudioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);

                    // Wire the restored buffer and asset ID into timeline state
                    timelineState.setMasterAudioBuffer(state.uploadedAudioBuffer);
                    timelineState.setMasterAudioAssetId(state.uploadedAudioAssetId);
                }
            } catch (e) {
                console.error('Failed to load uploaded audio from asset storage:', e);
            }
        }

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
                            resolve();
                        };
                        videoEl.onerror = () => resolve();
                        setTimeout(resolve, 3000);
                    });
                    state.uploadedVideoElement = videoEl;

                    // Ensure timeline state clips use this restored video element
                    if (timelineState.clips) {
                        timelineState.clips.forEach((clip: any) => {
                            if (clip.talkingHeadMode && clip.talkingHeadMode !== 'none') {
                                clip.talkingHeadVideoElement = videoEl;
                            }
                        });
                    }
                }
            } catch (e) {
                console.error('Failed to load uploaded video from asset storage:', e);
            }
        }

        // Restore background audio
        if (dom.bgAudioPromptInput) dom.bgAudioPromptInput.value = state.bgAudioPrompt || '';
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

        // Restore settings & UI toggles
        if (dom.imageModelSelect && importedState.imageModel) dom.imageModelSelect.value = importedState.imageModel;
        if (dom.videoModelSelect && importedState.videoModel) {
            let vModel = importedState.videoModel;
            if (vModel.startsWith('gemini-') || vModel.includes('preview')) vModel = 'veo-3.1-lite-generate-001';
            dom.videoModelSelect.value = vModel;
        }
        if (dom.imageStyleSelect && importedState.imageStyle) dom.imageStyleSelect.value = importedState.imageStyle;
        if (dom.characterModifierSelect && importedState.characterModifier !== undefined) dom.characterModifierSelect.value = importedState.characterModifier;
        if (dom.characterModifierCustom && importedState.characterModifierCustom !== undefined) dom.characterModifierCustom.value = importedState.characterModifierCustom;
        if (dom.customPromptInput && importedState.customPrompt) dom.customPromptInput.value = importedState.customPrompt;
        if (dom.customStyleAnalyzedPrompt && importedState.customStyleAnalyzedPrompt) dom.customStyleAnalyzedPrompt.value = importedState.customStyleAnalyzedPrompt;
        if (dom.customStyleKeywordsInput && importedState.customStyleKeywordsInput) dom.customStyleKeywordsInput.value = importedState.customStyleKeywordsInput;
        if (importedState.imageResolution) {
            if (dom.imageResolutionSelect) dom.imageResolutionSelect.value = importedState.imageResolution;
            updateAspectRatioState(importedState.imageResolution);
        }
        if (dom.detailLevelSelect && importedState.detailLevel) dom.detailLevelSelect.value = importedState.detailLevel;
        if (dom.pacingFactorSelect && importedState.pacingFactor) dom.pacingFactorSelect.value = importedState.pacingFactor;
        if (dom.customShotCountInput && importedState.customShotCount) dom.customShotCountInput.value = importedState.customShotCount;

        if (dom.enableAudioDuckingCheckbox && importedState.audioDuckingEnabled !== undefined) {
            state.audioDuckingEnabled = importedState.audioDuckingEnabled;
            dom.enableAudioDuckingCheckbox.checked = state.audioDuckingEnabled;
        }
        if (dom.enableAudioNormalizeCheckbox && importedState.autoNormalizeAudio !== undefined) {
            state.autoNormalizeAudio = importedState.autoNormalizeAudio;
            dom.enableAudioNormalizeCheckbox.checked = state.autoNormalizeAudio;
        }
        if (dom.enableMotionGraphicsCheckbox && importedState.motionGraphicsEnabled !== undefined) {
            state.motionGraphicsEnabled = importedState.motionGraphicsEnabled;
            dom.enableMotionGraphicsCheckbox.checked = state.motionGraphicsEnabled;
        }
        if (dom.enableBRollCheckbox && importedState.visualPunctuationEnabled !== undefined) {
            state.visualPunctuationEnabled = importedState.visualPunctuationEnabled;
            dom.enableBRollCheckbox.checked = state.visualPunctuationEnabled;
        }
        if (dom.enableParallaxCheckbox && importedState.enableParallaxEffect !== undefined) {
            state.enableParallaxEffect = importedState.enableParallaxEffect;
            dom.enableParallaxCheckbox.checked = state.enableParallaxEffect;
            const subPanel = document.getElementById('parallax-suboptions-panel');
            if (subPanel) {
                subPanel.style.display = state.enableParallaxEffect ? 'block' : 'none';
            }
        }
        if (dom.parallaxModeSelect && importedState.parallaxMode !== undefined) {
            state.parallaxMode = importedState.parallaxMode;
            dom.parallaxModeSelect.value = state.parallaxMode;
        }
        if (dom.enableParallaxDustCheckbox && importedState.parallaxDustParticles !== undefined) {
            state.parallaxDustParticles = importedState.parallaxDustParticles;
            dom.enableParallaxDustCheckbox.checked = state.parallaxDustParticles;
        }
        if (dom.enableParallaxDofCheckbox && importedState.parallaxDepthBlur !== undefined) {
            state.parallaxDepthBlur = importedState.parallaxDepthBlur;
            dom.enableParallaxDofCheckbox.checked = state.parallaxDepthBlur;
        }
        if (dom.enableBgBlurCheckbox && importedState.enableBackgroundBlur !== undefined) {
            state.enableBackgroundBlur = importedState.enableBackgroundBlur;
            dom.enableBgBlurCheckbox.checked = state.enableBackgroundBlur;
            timelineState.setVideoEffects({ enableBackgroundBlur: state.enableBackgroundBlur });
        }
        if (dom.cinematographyStylePresetSelect && importedState.cinematographyPreset !== undefined) {
            state.cinematographyPreset = importedState.cinematographyPreset;
            dom.cinematographyStylePresetSelect.value = state.cinematographyPreset;
        }
        if (dom.cameraMotionIntensitySelect && importedState.cameraMotionIntensity !== undefined) {
            state.cameraMotionIntensity = importedState.cameraMotionIntensity;
            dom.cameraMotionIntensitySelect.value = String(state.cameraMotionIntensity);
        }
        if (dom.enableCameraHandheldCheckbox && importedState.cameraShakeHandheld !== undefined) {
            state.cameraShakeHandheld = importedState.cameraShakeHandheld;
            dom.enableCameraHandheldCheckbox.checked = state.cameraShakeHandheld;
        }
        if (dom.enableLetterboxCheckbox && importedState.cinematicLetterbox !== undefined) {
            state.cinematicLetterbox = importedState.cinematicLetterbox;
            dom.enableLetterboxCheckbox.checked = state.cinematicLetterbox;
        }
        if (dom.enableCinematicVignetteCheckbox && importedState.cinematicVignette !== undefined) {
            state.cinematicVignette = importedState.cinematicVignette;
            dom.enableCinematicVignetteCheckbox.checked = state.cinematicVignette;
        }
        if (dom.enableCompositionGridCheckbox && importedState.ruleOfThirdsGuide !== undefined) {
            state.ruleOfThirdsGuide = importedState.ruleOfThirdsGuide;
            dom.enableCompositionGridCheckbox.checked = state.ruleOfThirdsGuide;
        }
        if (importedState.videoEffects) {
            timelineState.setVideoEffects(importedState.videoEffects);
        }

        // Restore video state & subtitles
        timelineState.setShowSubtitles(importedState.showSubtitles || false);
        if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = timelineState.showSubtitles;
        timelineState.setVideoSubtitleStyle(importedState.videoSubtitleStyle || 'anime');
        if (dom.videoSubtitleStyleSelect) dom.videoSubtitleStyleSelect.value = timelineState.videoSubtitleStyle;
        timelineState.setVideoSubtitlePosition(importedState.videoSubtitlePosition || 'bottom');
        if (dom.videoSubtitlePositionSelect) dom.videoSubtitlePositionSelect.value = timelineState.videoSubtitlePosition;
        timelineState.setVideoSubtitleFont(importedState.videoSubtitleFont || 'Montserrat');
        if (dom.videoSubtitleFontSelect) dom.videoSubtitleFontSelect.value = timelineState.videoSubtitleFont;
        if (dom.videoSubtitleStyleSelect) dom.videoSubtitleStyleSelect.disabled = !timelineState.showSubtitles;
        if (dom.videoSubtitlePositionSelect) dom.videoSubtitlePositionSelect.disabled = !timelineState.showSubtitles;
        if (dom.videoSubtitleFontSelect) dom.videoSubtitleFontSelect.disabled = !timelineState.showSubtitles;
        if (dom.uploadSubtitleFontBtn) dom.uploadSubtitleFontBtn.disabled = !timelineState.showSubtitles;

        if (Array.isArray(importedState.customFonts) && importedState.customFonts.length > 0) {
            state.customFonts = importedState.customFonts;
            for (const fontItem of importedState.customFonts) {
                if (fontItem.dataUrl) {
                    try {
                        fetch(fontItem.dataUrl).then(res => res.arrayBuffer()).then(buffer => {
                            const fontFace = new FontFace(fontItem.name, buffer);
                            return fontFace.load();
                        }).then(loadedFace => {
                            document.fonts.add(loadedFace);
                        }).catch(err => console.warn('Could not register zip imported font:', fontItem.name, err));
                    } catch {}
                }
            }
            refreshCustomFontSelect();
        }
        state.videoSubtitleColors = importedState.videoSubtitleColors || {};
        timelineState.setMode(importedState.timelineMode || 'free');
        timelineState.setGraphics(importedState.graphics || []);

        // Restore active production video timeline & preview
        const videoTimelineMetadata =
            importedState.videoTimelineMetadata || importedState.savedVideoTimelineMetadata;

        await restoreVideoTimeline(videoTimelineMetadata, { silent: true });

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

        // Setup regexes for consistency profiles
        if (state.characterProfiles) {
            state.characterProfiles.forEach((p: any) => {
                p._nameRegex = utils.buildCharacterRegex(p, state.characterProfiles);
            });
        }
        if (state.locationProfiles) {
            state.locationProfiles.forEach((p: any) => {
                p._nameRegex = new RegExp(`\\b${utils.escapeRegExp(p.name)}\\b`, 'i');
            });
        }
        if (state.keyElementProfiles) {
            state.keyElementProfiles.forEach((p: any) => {
                p._nameRegex = new RegExp(`\\b${utils.escapeRegExp(p.name)}\\b`, 'i');
            });
        }

        // Update UI
        if (dom.storyInput) dom.storyInput.value = storyText;
        if (dom.detailLevelSelect) ui.handlePacingChange(dom.detailLevelSelect.value);
        ui.handleImageStyleChange();
        ui.handleImageModelChange();
        analyzeCharacterFrequency();

        // now that replay is complete, allow a single final UI sync
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

        ui.renderResults(state.currentScenes);
        ui.renderCharacterList(state.characterProfiles);
        ui.renderLocationList(state.locationProfiles);
        ui.renderKeyElementList(state.keyElementProfiles);
        ui.updateUiForStoryChange();
        restoreMasterAudioUI();
        ui.renderTimelineEditor();
        requestAnimationFrame(() => {
            ui.renderTimelineEditor();
        });
        drawVideoFrame(0);
        ui.updateWorkflowStepStatus(3, 'completed');
        ui.updateWorkflowStepStatus(4, 'active');

        ui.showStatus(`Project imported successfully! (${restoredCount} media files restored)`, false, 4000);
        
    } catch (e) {
        console.error("Import error", e);
        ui.showStatus('Error importing project file', true);
    } finally {
        timelineState.endBatch();
        setProjectHydrating(false);
    }
}


