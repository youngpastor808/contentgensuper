import { safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as dom from './dom';
import * as ui from './ui';
import { forceAlignAudio } from './api/audio';
import * as utils from './utils';
import { state } from './state';
import { timelineState } from './state-timeline';
import { drawVideoFrame } from './videoRenderer';
import { updateVideoContext, normalizeTimeline } from './videoController';
import { alignShotsToTranscript, alignShotsCanonical, auditTimelineConsistency, sliceTranscriptForShots, enforceMonotonicStarts } from './timelineBuilder';
import { finalizeProduction } from './audio-first-director';
import type { WordTimestamp } from './types';
import { assetStorage } from './assetStorage';

// B-Roll Editor State
let bRollClips: Array<{ startTime: number, imageId: string, imageElement: HTMLElement, wordElement: HTMLElement }> = [];

export type UploadIntent = 'speech' | 'music' | 'silent';

/** Silent master track so timeline/B-roll/export machinery works unchanged. */
function makeSilentBuffer(durationSec: number): AudioBuffer {
    const ctx = utils.getAudioContext();
    const len = Math.max(1, Math.ceil(Math.max(0.5, durationSec) * ctx.sampleRate));
    return ctx.createBuffer(2, len, ctx.sampleRate);
}

/** Manual override — a wrong auto-classification is one click to fix. */
export function setUploadIntent(intent: UploadIntent) {
    state.uploadIntent = intent;
    if (intent === 'music' && timelineState.masterAudioBuffer) {
        timelineState.setTimelineSnapPoints(utils.detectBeats(timelineState.masterAudioBuffer));
    }
    ui.showStatus(`Upload intent set to: ${intent}`, false, 2000);
}

export async function handleImportBrollAsset(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    for (const file of Array.from(input.files)) {
        const url = URL.createObjectURL(file);
        const id = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const isVideo = file.type.startsWith('video/');
        state.bRollSourceRegistry.set(id, isVideo ? { videoObjectURL: url, label: file.name } : { imageObjectURL: url, label: file.name });
        if (dom.bRollBinContainer) {
            dom.bRollBinContainer.insertAdjacentHTML('beforeend', `
                <div class="b-roll-item relative group" data-used="false" title="${file.name}">
                    <div class="b-roll-thumb"><img src="${isVideo ? '' : url}" class="generated-img" data-id="${id}"></div>
                    <div class="b-roll-text-overlay">${file.name}</div>
                </div>`);
            if (isVideo) {
                // Extract poster for video
                const imgEl = dom.bRollBinContainer.querySelector(`img[data-id="${id}"]`) as HTMLImageElement;
                if (imgEl) {
                    try {
                        const v = document.createElement('video');
                        v.src = url;
                        v.crossOrigin = 'anonymous';
                        await new Promise((resolve) => {
                            v.onloadeddata = () => { v.currentTime = 0; };
                            v.onseeked = () => {
                                const canvas = document.createElement('canvas');
                                canvas.width = v.videoWidth || 640;
                                canvas.height = v.videoHeight || 360;
                                canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height);
                                imgEl.src = canvas.toDataURL('image/jpeg', 0.8);
                                resolve(null);
                            };
                            v.onerror = resolve;
                        });
                    } catch(e) {}
                }
            }
        }
    }
    input.value = '';
}

let bRollSelectionHistory: Array<{ wordElement: HTMLElement, imageElement: HTMLElement }> = [];
let selectedBrollImageElement: HTMLElement | null = null;


export function handleUploadAudioClick() {
    dom.audioUploadInput.click();
}

export async function handleDirectVideoUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    
    const allShots = state.currentScenes.flatMap((scene, sIdx) => 
        (scene.lines || [scene]).map((line: any, lIdx: number) => ({
            ...line,
            __sceneIndex: sIdx,
            __lineIndex: lIdx,
        }))
    );
    const shots = allShots.filter(s => !!(s._imageObjectURL || s._videoObjectURL || s.image_id || s.video_id));
    
    if (shots.length === 0) {
        // A-roll-first: no storyboard yet — still transcribe and open the
        // B-roll editor so users can assign/generate visuals per word.
        ui.showStatus("No storyboard shots yet — transcribing and opening B-Roll editor. Generate or import visuals, then click words to assign.", false, 5000);
    }

    ui.setButtonsDisabled(true);
    if (dom.videoStatusLog) dom.videoStatusLog.innerHTML = '';
    if (dom.videoStatusIndicator) dom.videoStatusIndicator.classList.remove('hidden');
    
    state.isVideoProductionRunning = true;
    await ui.openProcessingModal('Processing Uploaded Audio', true, 'Stop Processing');
    ui.updateProcessingProgress(5, 'Decoding audio file...');
    
    try {
        ui.logProductionStatus(`📂 Audio uploaded: Decoding "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);
        
        // ── Intent step 1: does the file even have an audio track? ──
        let audioBuffer: AudioBuffer;
        let intent: UploadIntent = 'speech';
        let videoEl: HTMLVideoElement | null = null;

        if (file.type.startsWith('video/')) {
            try {
                videoEl = await utils.loadVideoElement(URL.createObjectURL(file));
            } catch (e) { console.warn('Could not load uploaded video element:', e); }
        }

        try {
            audioBuffer = await utils.safeDecode(utils.getAudioContext(), await file.arrayBuffer());
        } catch (decodeErr) {
            if (!videoEl) throw decodeErr; // not a video AND no audio — genuinely unusable
            audioBuffer = makeSilentBuffer(videoEl.duration || 30);
            intent = 'silent';
            ui.logProductionStatus('🔇 No audio track detected — silent-video project.');
        }
        
        if (!state.isVideoProductionRunning) return;

        state.uploadedAudioBuffer = audioBuffer;
        
        // Resample heavily to a 16kHz Mono file to keep the local storage payload minimal
        const lightweightAudioFile = await utils.resampleAndEncodeAudio(audioBuffer);
        const wavBlob = new Blob([lightweightAudioFile], { type: 'audio/wav' });
        const assetId = await assetStorage.storeAsset(wavBlob, 'audio');
        state.uploadedAudioAssetId = assetId;

        const totalDur = audioBuffer.duration;
        ui.logProductionStatus(`🎵 Audio decoded: ${(totalDur ?? 0).toFixed(2)}s duration.`);
        let shotStartTimes: number[] = [];
        let perShotWords: any[][] = [];
        let globalWords: WordTimestamp[] | null = null;
        let globalSilences: any[] | null = null;

        if (!state.isVideoProductionRunning) return;

        if (intent !== 'silent') {
            ui.updateProcessingProgress(30, 'Transcribing audio with Deepgram...');
            const script = shots.map(s => s.text_reference || s.line_text || '').join(' ');
            try {
                let transcript: WordTimestamp[] = [];
                ui.logProductionStatus(`🎙️ Transcribing and aligning uploaded audio for ${shots.length} shots...`);
                // Use the lightweight WAV blob instead of the massive source video file for Deepgram
                const lightweightFilePayload = new File([wavBlob], file.name.replace(/\.[^/.]+$/, "") + ".wav", { type: 'audio/wav' });
                transcript = await forceAlignAudio(lightweightFilePayload, script, (p, m) => ui.updateProcessingProgress(30 + (p * 0.4), m), undefined) || [];
                
                if (!state.isVideoProductionRunning) return;

                if (transcript && transcript.length > 0) {
                    globalWords = transcript;
                    globalSilences = utils.detectSilences(audioBuffer);
                    ui.logProductionStatus(`✅ Transcribed ${globalWords.length} words with timestamps.`);
                    
                    ui.updateProcessingProgress(75, 'Aligning visuals to exact transcript timings...');
                }
            } catch (err: any) {
                console.warn("Deepgram + Gemini precision sync failed, falling back to proportional alignment:", err);
                ui.logProductionStatus(`⚠️ Alignment failed (${err.message}). Using proportional fallback...`, true);
            }

            // ── Intent step 2: speech vs music — the real transcript decides ──
            // (checked BEFORE the proportional fallback fabricates word timings)
            if (globalWords && globalWords.length > 0) {
                intent = 'speech';
            } else if (script && script.trim().length > 0) {
                globalWords = [];
                ui.logProductionStatus(
                    `⚠️ Word timestamps unavailable — shots will keep neighbor timing, gap marked (subtitles may drift in this span).`,
                    true
                );
                intent = 'speech';
            } else {
                intent = 'music';
            }
        }
        state.uploadIntent = intent;

        if (!state.isVideoProductionRunning) return;

        let beats: number[] = [];
        const noSpeech = !globalWords || globalWords.length === 0;
        if (noSpeech && audioBuffer && intent === 'music') {
            state.musicMode = true;
            beats = utils.detectBeats(audioBuffer);
            timelineState.setTimelineSnapPoints(beats);
            ui.logProductionStatus(`🎵 No speech detected — Music Mode: ${beats.length} beats detected, snapping on beats.`);
            
            if (beats.length > 1) {
                const intervals = [];
                for (let i = 1; i < beats.length; i++) {
                    intervals.push(beats[i] - beats[i - 1]);
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const bpm = Math.round(60 / avgInterval);
                if (bpm >= 40 && bpm <= 240) {
                    state.detectedBpm = bpm;
                    ui.logProductionStatus(`🥁 Detected tempo: ≈${bpm} BPM.`);
                }
            }
            // Subtitles off by default in music mode
            timelineState.setShowSubtitles(false);
            if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = false;
        } else {
            state.musicMode = false;
            state.detectedBpm = null;
        }

        // Pre-seed state so builder can pick it up
        if (videoEl) {
            if (intent === 'speech' || intent === 'music') {
                state.uploadedVideoElement = videoEl;
            }
            if (intent === 'music') {
                state.bRollSourceRegistry.set('uploaded-video', {
                    videoObjectURL: videoEl.src, label: file.name,
                });
            }

            // Trigger background Cloud Storage direct sync for large video files (> 20MB)
            if (file && (file.type?.includes('video') || file.name?.match(/\.(mp4|mov|webm|mkv|m4v)$/i))) {
                (async () => {
                    try {
                        const ext = file.name.split('.').pop() || 'mp4';
                        const filename = `master_aroll_${Date.now()}.${ext}`;
                        const res = await fetch('/api/gcs/get-upload-url', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ filename, contentType: file.type || 'video/mp4', size: file.size })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.success && data.signedUrl && data.publicUrl) {
                                ui.logProductionStatus(`☁️ Cloud Sync: Uploading master A-Roll (${(file.size / (1024 * 1024)).toFixed(1)} MB) directly to Cloud Storage in background...`);
                                const putRes = await fetch(data.signedUrl, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': file.type || 'video/mp4' },
                                    body: file
                                });
                                if (putRes.ok) {
                                    (state as any).uploadedVideoDirectUrl = data.publicUrl;
                                    ui.logProductionStatus(`☁️ Cloud Sync Complete: Master A-Roll synced to Cloud Storage.`);
                                }
                            }
                        }
                    } catch (syncErr) {
                        console.info('[Cloud Sync Background Note]:', syncErr);
                    }
                })();
            }
        }

        timelineState.setMasterAudioBuffer(audioBuffer);
        timelineState.setGlobalWordTimestamps(globalWords || []);
        timelineState.setGlobalSilences(globalSilences || []);
        timelineState.setMode('audio_locked');
        timelineState.setDrawerUserOpen(true);

        await buildTimelineFromShotsWithAudio();

        normalizeTimeline(totalDur);

        const pts: number[] = [...beats];
        for (const c of timelineState.clips || []) pts.push(c.startTime, c.endTime);
        const snapPoints = Array.from(new Set(pts)).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
        timelineState.setTimelineSnapPoints(snapPoints);

        timelineState.setVideoGenerated(true);
        updateVideoContext();

        dom.videoCanvas.classList.remove('hidden');
        dom.videoCanvas.style.display = 'block';
        dom.videoPreGenerationOverlay.classList.add('hidden');
        dom.videoControlsContainer.classList.remove('hidden');
        dom.videoPostGenerationOverlay.classList.remove('hidden');
        dom.videoExportBtn.disabled = false;
        dom.magicCameraBtn.disabled = false;
        dom.analyzeTransitionsBtn.disabled = false;
        dom.videoDirectorBtn.disabled = false;
        dom.videoDirectorBtn.classList.remove('opacity-50');

        drawVideoFrame(0);
        ui.renderTimelineEditor();

        const { populateRhythmTemplateSelectors } = await import('./masterAudioDirector');
        populateRhythmTemplateSelectors();

        ui.updateProcessingProgress(100, 'Done!');
        ui.closeProcessingModal();
        ui.showStatus("Audio uploaded and visuals aligned!", false, 3000);
        ui.logProductionStatus(`✔️ Upload sync complete: ${timelineState.clips.length} clips assembled on timeline.`);

    } catch (e: any) {
        ui.logProductionStatus(`❌ Audio processing failed: ${e.message}`, true);
        ui.showStatus(`Audio processing failed: ${e.message}`, true, 5000);
        ui.closeProcessingModal();
    } finally {
        state.isVideoProductionRunning = false;
        if (dom.videoStatusIndicator) dom.videoStatusIndicator.classList.add('hidden');
        input.value = '';
        ui.setButtonsDisabled(false);
    }
}

export function handleOpenBrollEditor() {
    const hasWords = Boolean(timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0);
    const hasBeats = Boolean(timelineState.timelineSnapPoints && timelineState.timelineSnapPoints.length > 0);
    if ((hasWords || hasBeats) && timelineState.masterAudioBuffer) {
        ui.renderBrollEditor({ words: timelineState.globalWordTimestamps || [] }, timelineState.masterAudioBuffer);
    } else {
        ui.showStatus("Upload and align an audio file first.", true, 3000);
    }
}

export function handleCloseBrollEditor() {
    dom.videoDirectorMainView.classList.remove('hidden');
    dom.bRollEditorWorkspace.classList.add('hidden');
    // Clear state
    bRollClips = [];
    bRollSelectionHistory = [];
    selectedBrollImageElement = null;
}

export function handleBrollBinClick(event: Event) {
    const target = event.target as HTMLElement;
    const item = target.closest('.b-roll-item') as HTMLElement;
    if (!item) return;

    if (selectedBrollImageElement) {
        selectedBrollImageElement.classList.remove('selected');
    }

    if (item === selectedBrollImageElement) {
        selectedBrollImageElement = null; // Deselect
    } else {
        selectedBrollImageElement = item;
        selectedBrollImageElement.classList.add('selected');
    }
}

export function handleTranscriptWordClick(event: Event) {
    const wordElement = event.target as HTMLElement;
    if (!wordElement.classList.contains('b-roll-word')) return;
    if (!selectedBrollImageElement) {
        ui.showStatus("Select an image from the bin first.", true, 2000);
        return;
    }

    const startTime = parseFloat(wordElement.dataset.start!);
    const imageId = (selectedBrollImageElement.querySelector('.generated-img') as HTMLElement).dataset.id!;

    // Remove any existing clip at this exact word
    const existingIndex = bRollClips.findIndex(c => c.wordElement === wordElement);
    if (existingIndex !== -1) {
        bRollClips[existingIndex].imageElement.dataset.used = 'false';
        bRollClips.splice(existingIndex, 1);
    }
    
    bRollClips.push({ startTime, imageId, imageElement: selectedBrollImageElement, wordElement });
    bRollSelectionHistory.push({ wordElement, imageElement: selectedBrollImageElement });
    
    const thumbEl = selectedBrollImageElement.querySelector('img, video') as HTMLImageElement | HTMLVideoElement | null;
    const thumbSrc = (thumbEl as any)?.currentSrc || (thumbEl as any)?.src || '';
    if (thumbSrc) wordElement.style.setProperty('--b-roll-image', `url(${thumbSrc})`);
    
    wordElement.classList.add('assigned');
    selectedBrollImageElement.dataset.used = 'true';
    
    selectedBrollImageElement.classList.remove('selected');
    selectedBrollImageElement = null;
}

export function handleUndoBrollSelection() {
    if (bRollSelectionHistory.length === 0) return;
    const last = bRollSelectionHistory.pop();
    if (!last) return;

    last.wordElement.classList.remove('assigned');
    last.wordElement.style.removeProperty('--b-roll-image');
    
    const clipIndex = bRollClips.findIndex(c => c.wordElement === last.wordElement);
    if (clipIndex !== -1) bRollClips.splice(clipIndex, 1);
    
    // Check if the image is still used by another clip
    const isStillUsed = bRollClips.some(c => c.imageElement === last.imageElement);
    if (!isStillUsed) {
        last.imageElement.dataset.used = 'false';
    }
    dom.bRollUndoBtn.disabled = bRollSelectionHistory.length === 0;
}

export async function handleFinalizeBrollVideo() {
    if (bRollClips.length === 0) {
        ui.showStatus("No B-Roll clips have been assigned.", true, 3000);
        return;
    }

    bRollClips.sort((a, b) => a.startTime - b.startTime);
    
    const audioDuration = state.uploadedAudioBuffer!.duration;
    const newClips: any[] = [];
    const allShots = state.currentScenes.flatMap(s => s.lines || [s]);

    for (let i = 0; i < bRollClips.length; i++) {
        const current = bRollClips[i];
        const next = bRollClips[i + 1];
        
        const startTime = current.startTime;
        const endTime = next ? next.startTime : audioDuration;

        const sourceShot = allShots.find(shot => shot.id === current.imageId);
        const reg = state.bRollSourceRegistry?.get(current.imageId);
        const videoObjectURL = sourceShot?._videoObjectURL || reg?.videoObjectURL;
        const imageObjectURL = sourceShot?._imageObjectURL || reg?.imageObjectURL;
        if (!videoObjectURL && !imageObjectURL) continue;
        
        let videoEl: HTMLVideoElement | undefined = undefined;
        let img = null;
        try {
            if (videoObjectURL) {
                videoEl = await utils.loadVideoElement(videoObjectURL);
                if (imageObjectURL) {
                    try { img = await utils.loadImageOrThrow(imageObjectURL); } catch (imgErr) { console.warn("Failed to preload fallback image:", imgErr); }
                }
            } else if (imageObjectURL) {
                img = await utils.loadImageOrThrow(imageObjectURL);
            }
        } catch (e) {
            console.error("Failed to load visual for clip", e);
            if (imageObjectURL) {
                try { img = await utils.loadImageOrThrow(imageObjectURL); } catch (imgErr) { console.warn("Failed to load fallback image:", imgErr); }
            }
        }

        newClips.push({
            id: (sourceShot?.id || current.imageId) + `_${i}`,
            image: img || undefined,
            videoElement: videoEl,
            _videoObjectURL: videoObjectURL,
            _imageObjectURL: imageObjectURL,
            image_id: sourceShot?.image_id || current.imageId,
            video_id: sourceShot?.video_id,
            startTime,
            endTime,
            duration: endTime - startTime,
            cameraMovement: sourceShot?.camera_movement || 'static',
            focalPoint: sourceShot?.focalPoint,
            transitionToNext: 'cut',
            text: sourceShot?.text_reference || sourceShot?.line_text || "",
            wordTimestamps: [] // Can be filled later if needed
        });
    }

    // Fill unassigned spans with the uploaded base footage so the timeline
    // stays continuous instead of collapsing to just the selections.
    const baseURL = state.uploadedVideoElement?.src
        || state.bRollSourceRegistry?.get('uploaded-video')?.videoObjectURL;
    if (baseURL && newClips.length > 0) {
        const filled: any[] = [];
        let cursor = 0;
        const makeBaseClip = async (from: number, to: number) => ({
            id: `base-${from.toFixed(2)}`,
            videoElement: await utils.loadVideoElement(baseURL), // fresh element per segment (sharing one element across clips breaks preview sync)
            _videoObjectURL: baseURL,
            videoStartOffset: from,
            startTime: from, endTime: to, duration: to - from,
            cameraMovement: 'static', transitionToNext: 'cut',
            text: '', wordTimestamps: [], locked: false,
        });
        for (const c of newClips) {
            if (c.startTime > cursor + 0.05) filled.push(await makeBaseClip(cursor, c.startTime));
            filled.push(c);
            cursor = c.endTime;
        }
        if (cursor < audioDuration - 0.05) filled.push(await makeBaseClip(cursor, audioDuration));
        newClips.length = 0;
        newClips.push(...filled);
    }

    timelineState.setClips(newClips);
    timelineState.setMasterAudioBuffer(state.uploadedAudioBuffer);
    timelineState.setGlobalWordTimestamps(state.bRollTranscript?.words || []);
    
    finalizeProduction();
    handleCloseBrollEditor();
    ui.showStatus("B-Roll timeline created!", false, 3000);
}

export async function handleAutoSelectBroll() {
    // Placeholder for a more advanced AI matching feature
    ui.showStatus("Magic Select is not yet implemented.", false, 3000);
}

export function handleExportBrollSelections() {
    if (bRollClips.length === 0) return;
    const data = bRollClips.map(c => ({
        time: c.startTime,
        imageId: c.imageId
    }));
    const blob = new Blob([safeJsonStringify(data)], { type: 'application/json' });
    utils.downloadBlob(blob, 'b-roll-selections.broll');
}

export function handleImportBrollSelections(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target?.result as string);
            // Basic validation
            if (!Array.isArray(data) || !data.every(item => 'time' in item && 'imageId' in item)) {
                throw new Error("Invalid format");
            }
            
            // Clear existing
            bRollClips.forEach(c => {
                c.wordElement.classList.remove('assigned');
                c.imageElement.dataset.used = 'false';
            });
            bRollClips = [];
            bRollSelectionHistory = [];

            const allWords = Array.from(dom.bRollTranscriptContainer.querySelectorAll('.b-roll-word')) as HTMLElement[];
            
            for (const item of data) {
                const wordElement = allWords.find(w => Math.abs(parseFloat(w.dataset.start!) - item.time) < 0.01);
                const imageElement = dom.bRollBinContainer.querySelector(`.b-roll-item [data-id="${item.imageId}"]`)?.closest('.b-roll-item') as HTMLElement | null;

                if (wordElement && imageElement) {
                     bRollClips.push({ startTime: item.time, imageId: item.imageId, imageElement, wordElement });
                     bRollSelectionHistory.push({ wordElement, imageElement });
                     wordElement.classList.add('assigned');
                     imageElement.dataset.used = 'true';
                }
            }
            ui.showStatus(`Imported ${bRollClips.length} selections.`, false, 3000);

        } catch (error) {
            ui.showStatus("Import failed: Invalid file.", true, 4000);
        }
    };
    reader.readAsText(input.files[0]);
}

export function handleOpenForceAlignModal() {
    if (!dom.forceAlignModal) return;

    // Pre-populate script from storyboard
    const allShots = state.currentScenes.flatMap(scene => scene.lines || [scene]);
    const scriptText = allShots
        .map(shot => shot.text_reference || shot.line_text || '')
        .join('\n\n');

    dom.forceAlignScriptTextarea.value = scriptText;
    
    // Reset state
    dom.forceAlignAudioInput.value = '';
    dom.forceAlignSubtitleInput.value = '';
    if (dom.forceAlignSubtitleStatus) dom.forceAlignSubtitleStatus.textContent = '';
    state.forceAlignSubtitleCues = null;
    dom.forceAlignProgressContainer.classList.add('hidden');

    dom.forceAlignModal.classList.remove('hidden');
}

export function handleCloseForceAlignModal() {
    if (dom.forceAlignModal) dom.forceAlignModal.classList.add('hidden');
}

export async function handleForceAlignSubtitleUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    try {
        const text = await file.text();
        const cues = utils.parseSubtitleFile(text);
        if (cues.length === 0) throw new Error("No cues found.");

        state.forceAlignSubtitleCues = cues;
        if (dom.forceAlignSubtitleStatus) {
            dom.forceAlignSubtitleStatus.textContent = `Loaded ${cues.length} subtitle cues.`;
            dom.forceAlignSubtitleStatus.className = 'text-green-400 text-[10px]';
        }

    } catch (e: any) {
        if (dom.forceAlignSubtitleStatus) {
            dom.forceAlignSubtitleStatus.textContent = `Error: ${e.message}`;
            dom.forceAlignSubtitleStatus.className = 'text-red-400 text-[10px]';
        }
    } finally {
        input.value = '';
    }
}

export async function handleStartForceAlign() {
    const audioFile = dom.forceAlignAudioInput.files?.[0];
    const script = dom.forceAlignScriptTextarea.value.trim();
    const engine = dom.forceAlignEngineSelect.value;
    
    if (!audioFile) {
        ui.showStatus("Please select an audio file.", true, 3000);
        return;
    }
    if (!script && !state.forceAlignSubtitleCues) {
        ui.showStatus("Please provide a script or a subtitle file to align to.", true, 3000);
        return;
    }

    dom.startForceAlignBtn.disabled = true;
    dom.forceAlignProgressContainer.classList.remove('hidden');

    const updateProgress = (p: number, m: string) => {
        dom.forceAlignProgressBar.style.width = `${p}%`;
        dom.forceAlignProgressText.textContent = m;
    };

    try {
        let transcript: WordTimestamp[];
        
        if (state.forceAlignSubtitleCues && state.forceAlignSubtitleCues.length > 0) {
            updateProgress(50, 'Using pre-parsed subtitle cues...');
            const allWords: WordTimestamp[] = [];
            state.forceAlignSubtitleCues.forEach(cue => {
                const words = cue.text.split(/\s+/).filter(Boolean);
                if (words.length > 0) {
                    const timePerWord = (cue.end - cue.start) / words.length;
                    words.forEach((word, i) => {
                        allWords.push({
                            word,
                            start: cue.start + (i * timePerWord),
                            end: cue.start + ((i + 1) * timePerWord)
                        });
                    });
                }
            });
            transcript = allWords;
            updateProgress(100, 'Subtitle cues applied.');
        } else {
            transcript = await forceAlignAudio(audioFile, script, updateProgress, engine);
        }

        if (!transcript || transcript.length === 0) {
            throw new Error("Alignment failed to produce any timestamps.");
        }
        
        ui.showStatus('Alignment successful! Timeline ready to be rebuilt.', false, 4000);
        timelineState.setGlobalWordTimestamps(transcript);

        const audioBuffer = await utils.safeDecode(utils.getAudioContext(), await audioFile.arrayBuffer());
        timelineState.setMasterAudioBuffer(audioBuffer);
        
        if (dom.openTranscriptEditorBtn) dom.openTranscriptEditorBtn.disabled = false;
        
        handleCloseForceAlignModal();
        // Open the Video Director modal first so the transcript editor workspace is visible
        dom.videoDirectorModal.classList.remove('hidden');
        dom.videoDirectorMainView.classList.add('hidden');
        dom.transcriptEditorWorkspace.classList.remove('hidden');
        ui.openTranscriptEditor();

    } catch (e: any) {
        ui.showStatus(`Alignment failed: ${e.message}`, true, 6000);
        updateProgress(100, `Error: ${e.message}`);
    } finally {
        dom.startForceAlignBtn.disabled = false;
    }
}

export async function buildTimelineFromShotsWithMediaDurations(): Promise<void> {
    const shots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
    if (shots.length === 0) {
        ui.showStatus('No shots to build from. Create a blank storyboard first.', true, 3000);
        return;
    }

    const clips: any[] = [];
    let cursor = 0;
    let withMedia = 0;

    for (const shot of shots) {
        let duration = typeof shot.duration_seconds === 'number' ? shot.duration_seconds : 4; // images/empty default
        let videoEl: HTMLVideoElement | null = null;

        if (shot._videoObjectURL) {
            try { videoEl = await utils.loadVideoElement(shot._videoObjectURL); } catch {}
            if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0.1) {
                duration = videoEl.duration;               // ← the real fix: clip's own length
                withMedia++;
            }
        }

        let image: HTMLImageElement | undefined;
        if (shot._imageObjectURL) {
            try { image = await utils.loadImageOrThrow(shot._imageObjectURL); } catch {}
        }

        clips.push({
            id: shot.id || `s${Date.now()}_${cursor}`,
            image,
            videoElement: videoEl || undefined,
            _videoObjectURL: shot._videoObjectURL,
            _imageObjectURL: shot._imageObjectURL,
            image_id: shot.image_id,
            video_id: shot.video_id,
            videoStartOffset: (shot as any).videoStartOffset ?? ((!shot._videoObjectURL && state.uploadedVideoElement) || (shot._videoObjectURL && state.uploadedVideoElement && shot._videoObjectURL === state.uploadedVideoElement.src) ? cursor : 0),
            duration,
            startTime: cursor,
            endTime: cursor + duration,
            cameraMovement: shot.camera_movement || 'static',
            talkingHeadMode: shot.talkingHeadMode || (state.uploadedVideoElement ? 'pip-br' : 'none'),
            talkingHeadVideoElement: state.uploadedVideoElement || undefined,
            talkingHeadShape: shot.talkingHeadShape || 'circle',
            talkingHeadSize: shot.talkingHeadSize || 'medium',
            transitionToNext: 'cut',
            text: shot.text_reference || shot.line_text || '',
            wordTimestamps: [],
            locked: false,
            useOriginalAudio: (shot as any).useOriginalAudio || false,
        } as any);
        cursor += duration;
    }

    timelineState.saveSnapshot();                 // undoable
    timelineState.setClips(clips);
    if (!timelineState.masterAudioBuffer && !state.uploadedVideoElement) {
        timelineState.setMasterAudioBuffer(null);     // own-sound mode — no narration track
    }
    timelineState.setGlobalWordTimestamps([]);
    timelineState.setMode('free');
    timelineState.setVideoGenerated(true);
    timelineState.setDrawerUserOpen(true);
    normalizeTimeline(cursor);
    updateVideoContext();
    if (dom.videoCanvas) dom.videoCanvas.classList.remove('hidden');
    drawVideoFrame(0);
    if (dom.videoDirectorBtn) {
        dom.videoDirectorBtn.disabled = false;
        dom.videoDirectorBtn.classList.remove('opacity-50');
    }
    if (dom.videoExportBtn) {
        dom.videoExportBtn.disabled = false;
    }
    ui.updateWorkflowStepStatus(3, 'completed');
    ui.updateWorkflowStepStatus(4, 'active');
    ui.showStatus(`Timeline built: ${clips.length} shot(s) (${withMedia} with video), ${cursor.toFixed(1)}s total.`, false, 3500);
}

export async function buildTimelineFromShotsWithAudio() {
    const audioBuffer = timelineState.masterAudioBuffer;
    if (!audioBuffer) return;
    const totalDur = audioBuffer.duration || 0;
    const intent = state.uploadIntent || 'speech';
    const uploadedVideoEl = state.uploadedVideoElement;

    const allShots = state.currentScenes.flatMap((scene, sIdx) => 
        (scene.lines || [scene]).map((line: any, lIdx: number) => ({
            ...line,
            __sceneIndex: sIdx,
            __lineIndex: lIdx,
        }))
    );
    const shots = allShots;

    let shotStartTimes: number[] = [];
    let canonicalRanges: any[] = [];
    let perShotWords: any[][] = [];
    const globalWords = (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0)
        ? timelineState.globalWordTimestamps
        : (state.masterAudioTranscript || []);
    const globalSilences = (timelineState.globalSilences && timelineState.globalSilences.length > 0)
        ? timelineState.globalSilences
        : (timelineState.masterAudioBuffer ? utils.detectSilences(timelineState.masterAudioBuffer) : []);

    if (shots.length > 0) {
        if (globalWords.length > 0) {
            canonicalRanges = alignShotsCanonical(
                shots,
                globalWords as any,
                (msg, isErr) => ui.logProductionStatus(msg, isErr),
                totalDur,
                { silences: globalSilences, timingSource: 'deepgram' }
            );
            shotStartTimes = canonicalRanges.map(r => r.startTime);
            perShotWords = sliceTranscriptForShots(shotStartTimes, globalWords as any, totalDur);
        } else {
            if (intent === 'speech' && timelineState.mode === 'audio_locked') {
                ui.logProductionStatus("⚠️ Speech audio track has no word timestamps. Visuals are placed proportionally with synthetic timing; audio-locked export will require transcript alignment or manual sync.", true);
            }
            const { counts, total: totalWords } = utils.computeWordCounts(shots);
            let current = 0;
            shotStartTimes = shots.map((shot, i) => {
                const s = current;
                const duration = (totalWords > 0) ? (counts[i] / totalWords) * totalDur : (totalDur / shots.length);
                current += duration;
                return s;
            });
            shotStartTimes = enforceMonotonicStarts(shotStartTimes, 0.05, totalDur);
            perShotWords = shots.map(() => []);
        }
    }

    const newClips = [];
    for(let i=0; i < shots.length; i++) {
        const shot = shots[i];
        const range = canonicalRanges[i];
        let videoEl: HTMLVideoElement | undefined = undefined;
        let img = null;
        try {
            if (shot._videoObjectURL) {
                videoEl = await utils.loadVideoElement(shot._videoObjectURL);
                if (shot._imageObjectURL) {
                    try { img = await utils.loadImageOrThrow(shot._imageObjectURL); } catch (imgErr) { console.warn("Failed to preload fallback image:", imgErr); }
                }
            } else if (shot._imageObjectURL) {
                img = await utils.loadImageOrThrow(shot._imageObjectURL);
            }
        } catch (e) {
            console.error("Failed to load visual for clip", e);
            if (shot._imageObjectURL) {
                try { img = await utils.loadImageOrThrow(shot._imageObjectURL); } catch (imgErr) { console.warn("Failed to load fallback image:", imgErr); }
            }
        }
        
        const startTime = shotStartTimes[i];
        const nextStartTime = (i + 1 < shots.length) ? shotStartTimes[i+1] : totalDur;
        
        // For audio-locked production: duration is strictly derived from audio timing (nextStartTime - startTime)
        // Video sources are fitted/looped/clipped to this duration, never overriding the audio timeline authority.
        const dur = Math.max(0.05, nextStartTime - startTime);
        const endTime = nextStartTime;

        newClips.push({
            id: shot.id || `s${shot.__sceneIndex}_l${shot.__lineIndex}`,
            image: img || undefined,
            videoElement: videoEl,
            _videoObjectURL: shot._videoObjectURL,
            _imageObjectURL: shot._imageObjectURL,
            image_id: shot.image_id,
            video_id: shot.video_id,
            videoStartOffset: (shot as any).videoStartOffset ?? ((!shot._videoObjectURL && state.uploadedVideoElement) || (shot._videoObjectURL && state.uploadedVideoElement && shot._videoObjectURL === state.uploadedVideoElement.src) ? startTime : 0),
            duration: dur,
            startTime,
            endTime,
            startWordIndex: range?.startWordIndex ?? -1,
            endWordIndex: range?.endWordIndex ?? -1,
            alignmentConfidence: range?.alignmentConfidence ?? 0.0,
            textMatchConfidence: range?.textMatchConfidence ?? range?.alignmentConfidence ?? 0.0,
            timingReliability: range?.timingReliability ?? 0.85,
            timingProvenance: range?.timingProvenance ?? 'acoustic_word',
            timingSource: range?.timingSource ?? (range ? 'deepgram' : 'synthetic'),
            cameraMovement: shot.camera_movement || 'static',
            focalPoint: shot.focalPoint,
            transitionToNext: 'cut',
            text: shot.text_reference || shot.line_text || '',
            wordTimestamps: perShotWords[i] || [],
            wordTimestampMode: 'relative',
            locked: false,
            talkingHeadMode: shot.talkingHeadMode || (intent === 'speech' && uploadedVideoEl ? 'pip-br' : 'none'),
            talkingHeadVideoElement: uploadedVideoEl || undefined,
            talkingHeadShape: shot.talkingHeadShape || 'circle',
            talkingHeadSize: shot.talkingHeadSize || 'medium',
            useOriginalAudio: (shot as any).useOriginalAudio || false,
        });
    }

    if (newClips.length === 0 && uploadedVideoEl) {
        newClips.push({
            id: 'aroll-full',
            startTime: 0, endTime: totalDur, duration: totalDur,
            videoElement: uploadedVideoEl,
            _videoObjectURL: uploadedVideoEl.src,
            videoStartOffset: 0,
            talkingHeadMode: 'none',
            cameraMovement: 'static', transitionToNext: 'cut',
            text: '', wordTimestamps: [], locked: false,
        });
    }

    timelineState.setClips(newClips);
    timelineState.setVideoGenerated(true);
    updateVideoContext();
    if (dom.videoCanvas) dom.videoCanvas.classList.remove('hidden');
    drawVideoFrame(0);

    if (dom.videoDirectorBtn) {
        dom.videoDirectorBtn.disabled = false;
        dom.videoDirectorBtn.classList.remove('opacity-50');
    }
    if (dom.videoExportBtn) {
        dom.videoExportBtn.disabled = false;
    }
    ui.updateWorkflowStepStatus(3, 'completed');
    ui.updateWorkflowStepStatus(4, 'active');
}
