/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { audioBufferToWavBlob } from '../utils-core';
import { invalidateSpectrumCache } from '../graphics-engine';
import { generateCinematicDroneBuffer } from '../cinematicDrone';
import { audioSynthesizer } from '../audioSynthesizer';
import { state } from '../state';
import { timelineState, calculateSpeechIntervals } from '../state-timeline';
import { assetStorage } from '../assetStorage';
import * as dom from '../dom';
import * as ui from '../ui';
import * as utils from '../utils';
import { isGuest, openLoginModal } from '../auth';
import { videoRenderContext, drawVideoFrame } from '../videoRenderer';
import { cleanupWebGL, prepareParallaxDepth } from '../parallax/adapter';
import { aliasDepth } from '../parallax/depth';
import { getTimelineAudioDrift } from './audio';
import { exportWithFFmpeg } from './backend-ffmpeg';
import { exportWithMemory } from './backend-memory';
import { exportWithStreaming } from './backend-streaming';
import { exportWithSegmentedPipeline, exportWithElectronWorker, mixSegmentAudio, clearSegmentAudioCaches } from './segmented-exporter';
import { isChunkedAudioExportEnabled } from './audio-chunk-provider';
import { handleCloudRenderExport } from './cloud-render';
import { calculateBitrate } from './codecs';
import { getExportDeviceProfile } from './device-profile';
import { electronService, syncTaskbarProgress } from './electron-bridge';
import { deliverOpfsExport, hasOpfsWritableSupport, isStreamingSupported, tryInitOpfsExport, tryInitStreamingExport } from './file-targets';
import { clearStaticFrameCache, yieldToMain } from './frames';
import { prepareExportOptimizedImages, clearExportOptimizedImages } from './image-prescaler';
import { validateBeforeExport } from '../timing/timeline-timing';


export function handleCancelExport() {
    if (!state.isCloudRenderActive) {
        state.isVideoProductionRunning = false;
    }
}


/**
 * Deduplicate HTMLVideoElement instances across clips by URL.
 * Multiple clips pointing to the same video asset share a single element
 * to prevent browser hardware decoder exhaustion and reduce RAM usage.
 */
export function deduplicateClipVideoElements(clips: any[]) {
    if (!clips || !clips.length) return;
    const urlMap = new Map<string, HTMLVideoElement>();
    if (state.uploadedVideoElement && state.uploadedVideoElement.src) {
        urlMap.set(state.uploadedVideoElement.src, state.uploadedVideoElement);
    }
    if (state.uploadedVideoObjectURL && state.uploadedVideoElement) {
        urlMap.set(state.uploadedVideoObjectURL, state.uploadedVideoElement);
    }

    for (const clip of clips) {
        const vidUrl = clip._videoObjectURL || clip.videoElement?.src;
        if (vidUrl) {
            const existing = urlMap.get(vidUrl);
            if (existing) {
                clip.videoElement = existing;
            } else if (clip.videoElement) {
                urlMap.set(vidUrl, clip.videoElement);
            }
        }
        const thUrl = clip.talkingHeadVideoElement?.src;
        if (thUrl) {
            const existing = urlMap.get(thUrl);
            if (existing) {
                clip.talkingHeadVideoElement = existing;
            } else if (clip.talkingHeadVideoElement) {
                urlMap.set(thUrl, clip.talkingHeadVideoElement);
            }
        }
    }
}


export async function handleExportVideo() {
    invalidateSpectrumCache(); // Free up RAM for the export pipeline

    // Guest Account Export Gating
    const userIsGuest = isGuest();
    const guestPolicy = state.systemConfig?.guestExportPolicy || 'watermark_320p';
    if (userIsGuest && guestPolicy !== 'unrestricted') {
        if (guestPolicy === 'block_all') {
            ui.showStatus('Video exports are disabled for guest accounts. Please sign in or register to export.', true, 6000);
            openLoginModal();
            return;
        }
        // Freemium 320p watermark preview
        state.isGuestExport = true;
        const currentRatio = (state.aspectRatio || dom.videoDirectorAspectSelect?.value || dom.imageResolutionSelect?.value || '16:9') as any;
        const guestResKey = utils.getGuest320pResolutionKey(currentRatio);
        if (dom.videoExportResolutionSelect) {
            dom.videoExportResolutionSelect.value = guestResKey;
        }
    } else {
        state.isGuestExport = false;
    }

    if (!timelineState.clips?.length) {
        if (state.uploadedVideoElement) {
            const totalDur = timelineState.masterAudioBuffer?.duration || state.uploadedVideoDuration || 10;
            timelineState.setClips([{
                id: 'aroll-full',
                startTime: 0, endTime: totalDur, duration: totalDur,
                videoElement: state.uploadedVideoElement,
                talkingHeadVideoElement: state.uploadedVideoElement,
                talkingHeadMode: 'full',
                text: '',
                wordTimestamps: [],
                locked: true
            }]);
            timelineState.setVideoGenerated(true);
        } else {
            ui.showStatus('Nothing on the timeline to export.', true, 3000);
            return;
        }
    }

    if (!timelineState.videoGenerated || !videoRenderContext) {
        if (timelineState.clips?.length > 0) {
            timelineState.setVideoGenerated(true);
            const { updateVideoContext } = await import('../videoController');
            updateVideoContext();
        } else {
            ui.showStatus("No video to export. Please run production first.", true, 3000);
            return;
        }
    }

    try {
        const { forcePausePlayback, resyncTimeline } = await import('../videoController');
        forcePausePlayback(undefined, true);
        resyncTimeline({ notify: false, reason: 'pre-export' });
    } catch (e) {}

    // ── Canonical Fail-Closed Pre-Export Timing Validation ──
    const syncMode = (timelineState.mode === 'audio_locked' || (timelineState.masterAudioBuffer && timelineState.isAudioLocked?.())) ? 'audio_locked' : 'free';
    try {
        const audit = validateBeforeExport(
            timelineState.clips,
            timelineState.masterAudioBuffer?.duration ?? null,
            { mode: syncMode }
        );
        if (audit.reviewableTextMatches && audit.reviewableTextMatches.length > 0) {
            console.log('ℹ️ [Export Validation] Reviewable script/audio text matches with verified timing:', audit.reviewableTextMatches);
            ui.showStatus(`Export proceeding: ${audit.reviewableTextMatches.length} shot(s) have script differences but verified acoustic timing.`, false, 4000);
        }
    } catch (valErr: any) {
        ui.showStatus(valErr.message || 'Export blocked: timeline timing validation failed.', true, 8000);
        return;
    }

    // ── NEW: cumulative-drift guard ──
    const drift = getTimelineAudioDrift();
    if (drift && Math.abs(drift.seconds) > 0.3) {
        const pct = Math.max(0, Math.min(100, 100 - (Math.abs(drift.seconds) / Math.max(0.1, drift.audioDuration)) * 100));
        const ok = window.confirm(
            `Visual/Audio Sync Warning\n\nYour timeline is ${drift.seconds > 0 ? 'LONGER' : 'SHORTER'} than the audio by ${Math.abs(drift.seconds).toFixed(1)}s (sync integrity ≈ ${pct.toFixed(1)}%).\n\nExport anyway? (Visuals may cut off early or leave a silent gap at the end.)`
        );
        if (!ok) return;
    }


    // Route to Remotion AWS Lambda Cloud Render if selected
    if (state.cloudRenderMode === 'cloud') {
        return handleCloudRenderExport();
    }

    // WebCodecs (VideoEncoder/AudioEncoder) requires cross-origin isolation,
    // which is unavailable inside sandboxed iframes such as AI Studio.
    // Detect this early and show a clear message rather than a cryptic failure.
    if (typeof VideoEncoder === 'undefined') {
        ui.showStatus(
            '⚠️ Video export is not supported in this environment. Open the app directly in a browser tab to export.',
            true, 7000
        );
        return;
    }

    const format = dom.videoExportFormatSelect.value as 'mp4' | 'webm' | 'xml' | 'mp4-ffmpeg';

    if (format === 'xml') {
        const { exportNLETimeline } = await import('../handlers-export');
        return exportNLETimeline();
    }


    try {
        await runExport(format, true);
    } catch (err: any) {
        if (err?.message === 'Cancelled.') {
            return;
        }

        const looksLikeHardwareFailure =
            err?.code === 'GPU_ENCODER_FAILED' ||
            err?.name === 'EncodingError' ||
            err?.name === 'NotSupportedError' ||
            /gpu/i.test(err?.message || '') ||
            /hardware/i.test(err?.message || '') ||
            /video.*encoder.*failed/i.test(err?.message || '') ||
            /failed to execute 'encode'/i.test(err?.message || '');

        if (looksLikeHardwareFailure) {
            console.warn('[EXPORT] Hardware-accelerated export failed, retrying with software encoding:', err);
            ui.showStatus('Hardware encoding failed — retrying with software encoding (slower, more stable)...', false, 4000);
            try {
                await runExport(format, false);
            } catch (err2: any) {
                console.error('[EXPORT] Software retry also failed:', err2);
                ui.showStatus(`Export failed: ${err2?.message || String(err2)}`, true, 10000);
            }
        } else {
            console.error('[EXPORT] Export failed:', err);
            const lastFrame = sessionStorage.getItem('export.lastFrame');
            if (lastFrame && lastFrame !== '0') {
                ui.showStatus(`Export failed (stopped around frame ${lastFrame}): ${err?.message || String(err)}. Run export again — mastered audio will be reused.`, true, 12000);
            } else {
                ui.showStatus(`Export failed: ${err?.message || String(err)}`, true, 10000);
            }
        }
    }
}


async function maybeExportSidecarSubtitles(filename: string) {
    if (!dom.videoExportSubtitlesCheckbox?.checked) return;
    try {
        const baseName = filename.replace(/\.[^/.]+$/, "");
        const srtFilename = `${baseName}.srt`;
        
        // Generate from current timeline clips (with absolute timestamps) or globalWordTimestamps
        const srtContent = utils.generateSRT(timelineState.globalWordTimestamps || [], timelineState.clips);
        if (!srtContent || !srtContent.trim()) {
            console.warn('[EXPORT] No subtitle content to export for sidecar file.');
            return;
        }
        
        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        await utils.downloadBlob(blob, srtFilename);
        console.log(`[EXPORT] Exported sidecar subtitle file: ${srtFilename}`);
    } catch (e) {
        console.warn('[EXPORT] Failed to export sidecar subtitles:', e);
    }
}


async function runExport(format: 'mp4' | 'webm' | 'mp4-ffmpeg', preferHardware: boolean) {
    sessionStorage.setItem('export.lastFrame', '0');
    
    // Release cached visual data before the memory-hungry render starts
    try {
        invalidateSpectrumCache();
    } catch (e) {}

    try {
        const { forcePausePlayback } = await import('../videoController');
        forcePausePlayback(undefined, true);
    } catch (e) {}

    const clips = (timelineState.clips && timelineState.clips.length > 0)
        ? timelineState.clips
        : (videoRenderContext?.clips || []);

    // Sync from DOM select if user picked a transition style in the UI dropdown
    const domStyle = dom.videoTransitionStyleSelect?.value;
    if (domStyle && domStyle !== timelineState.videoTransitionStyle) {
        timelineState.setVideoTransitionStyle(domStyle as any);
    }

    const hasClipTransition = (c: any) => {
        const trans = (c?.transitionToNext || c?.transition || c?.transitionType || c?.transitionStyle || c?.transition_to_next || c?.visualTransition || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/[\s-]+/g, '_');
        return trans !== '' && trans !== 'cut' && trans !== 'none';
    };

    let hasTransitions = clips.some(hasClipTransition);
    if (!hasTransitions && videoRenderContext?.clips) {
        hasTransitions = videoRenderContext.clips.some(hasClipTransition);
    }
    if (!hasTransitions && state.currentScenes && Array.isArray(state.currentScenes)) {
        hasTransitions = state.currentScenes.some((s: any) =>
            (s.lines || [s]).some((l: any) => hasClipTransition(l) || hasClipTransition(s))
        );
    }

    const globalStyle = (timelineState.videoTransitionStyle || dom.videoTransitionStyleSelect?.value || 'narrative_guided')
        .toLowerCase()
        .trim();

    // If global transition style is set to a visual effect or random mix, transitions will be applied
    if (globalStyle !== 'cut' && globalStyle !== 'none' && globalStyle !== 'narrative_guided' && globalStyle !== 'ai_directed') {
        hasTransitions = true;
    }

    // If the project was analyzed via the transition tool, treat as having transitions
    const isAnalyzed = dom.analyzeTransitionsBtn?.innerHTML?.includes('✅') || dom.analyzeTransitionsBtn?.classList?.contains('bg-green-600');
    if (isAnalyzed) {
        hasTransitions = true;
    }

    if (!hasTransitions && clips.length > 1) {
        const proceed = await new Promise<boolean>((resolve) => {
            ui.showConfirmation(
                'Enhance with Transitions?',
                'No cinematic transitions (dissolves, wipes, etc.) were detected. Would you like to proceed with "Hard Cuts" between every shot, or automatically enhance the timeline with cinematic transitions for a professional finish?',
                async () => {
                    try {
                        const { handleAnalyzeTransitions } = await import('../videoDirector');
                        await handleAnalyzeTransitions(true);
                    } catch (e) {}
                    resolve(true);
                },
                () => resolve(false)
            );
        });
        if (!proceed) {
            ui.showStatus('Export stopped. Use the "Transitions" tool in the sidebar to add cinematic effects.', false, 4000);
            return;
        }
    }

    const userVal = dom.videoExportFilenameInput?.value?.trim() || '';
    const userValNormalized = userVal.toLowerCase().replace(/[\s_-]+/g, '');
    const isGenericDefault = !userVal || userValNormalized === 'aistudiovideoexport' || userValNormalized === 'mygeneratedvideo';
    
    let customName = !isGenericDefault ? userVal : utils.getScriptDerivedTitle(5);
    if (!customName) {
        customName = utils.sanitizeFilename(dom.storyInput?.value?.substring(0, 30) || 'video');
    }
    const actualFormatExt = format === 'mp4-ffmpeg' ? 'mp4' : format;
    const filename = `${utils.sanitizeFilename(customName)}.${actualFormatExt}`;

    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Preparing Export', true, 'Cancel Export');
    state.isVideoProductionRunning = true;
    state.isExporting = true;

    // Prevent system sleep / GPU throttling on desktop Electron during export
    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
        try {
            // @ts-ignore
            const electron = (window as any).electronAPI;
            const invoke = electron.invoke || electron.ipcRenderer?.invoke;
            if (invoke) await invoke.call(electron, 'power-save-blocker-start');
        } catch(e) {
            console.warn("Could not start power save blocker:", e);
        }
    }

    ui.updateProcessingProgress(2, 'Analyzing media...');

    try {
        const { updateVideoContext, resyncTimeline } = await import('../videoController');
        resyncTimeline({ notify: false, reason: 'runExport' });
        updateVideoContext(true);
    } catch (e) {}

    // Enforce pre-export timing validation gate
    const syncMode = (timelineState.mode === 'audio_locked' || (timelineState.masterAudioBuffer && timelineState.isAudioLocked?.())) ? 'audio_locked' : 'free';
    validateBeforeExport(
        timelineState.clips,
        timelineState.masterAudioBuffer?.duration ?? null,
        { mode: syncMode }
    );

    // Deduplicate video elements by URL across all timeline clips to avoid OOM
    deduplicateClipVideoElements(timelineState.clips);
    if (videoRenderContext?.clips) {
        deduplicateClipVideoElements(videoRenderContext.clips);
    }

    let audioBuffer = timelineState.masterAudioBuffer;
    const TARGET_SAMPLE_RATE = 48000; // ✅ Universal (MP4 AAC + WebM Opus)

    const audioCtx = utils.getAudioContext();
    const exportDuration = videoRenderContext?.totalDuration || 0;
    
    if (exportDuration <= 0) {
        ui.showStatus("Export duration is 0. Cannot export.", true, 3000);
        handleCancelExport();
        ui.closeProcessingModal();
        return;
    }

    const isElectronRuntime = typeof window !== 'undefined' && !!(window as any).electronAPI;
    const useLongElectronSegmentedPipeline = isElectronRuntime && format === 'mp4' && exportDuration >= 600;

    const totalSamples = Math.ceil(exportDuration * TARGET_SAMPLE_RATE);

    if (dom.videoExportNormalizeAudioCheckbox) {
        state.autoNormalizeAudio = dom.videoExportNormalizeAudioCheckbox.checked;
    }
    if (dom.videoExportAudioDuckingCheckbox) {
        state.audioDuckingEnabled = dom.videoExportAudioDuckingCheckbox.checked;
    }

    let mixedBuffer: AudioBuffer | null = null;

    const hasOriginalAudio = timelineState.clips.some((c: any) => c.useOriginalAudio && (c.video_id || c.secondary_video_id || c._nativeAudioBuffer || c._nativeAudioArrayBuffer));
    const hasClipSfx = timelineState.clips.some((c: any) => c._sfxBuffer || c._sfxObjectURL);
    const hasGraphicsSfx = (timelineState.graphics || []).some((g: any) => g.isSfxOnly || g.type === 'sfxCue' || Boolean(g.sfxTrigger && g.sfxTrigger !== 'none') || g._sfxBuffer || g._sfxObjectURL || g.customSfxUrl || g.customSfxAssetId);
    const hasBgAudio = !!state._bgAudioBuffer;
    const hasMasterAudio = !!timelineState.masterAudioBuffer;
    const hasDroneAudio = !!state.cinematicDroneAudio;
    const hasAnyAudioSources = hasMasterAudio || hasOriginalAudio || hasClipSfx || hasGraphicsSfx || hasBgAudio || hasDroneAudio;

    const useChunkedAudio =
        isChunkedAudioExportEnabled() &&
        format !== 'mp4-ffmpeg' &&
        !useLongElectronSegmentedPipeline &&
        hasAnyAudioSources;

    const shouldBuildFullAudioMix = !useLongElectronSegmentedPipeline && !useChunkedAudio;

    const audioSegmentProvider = useChunkedAudio
        ? (startSec: number, durSec: number) =>
              mixSegmentAudio(startSec, Math.min(exportDuration, startSec + durSec), TARGET_SAMPLE_RATE)
        : undefined;

    if (shouldBuildFullAudioMix && (audioBuffer || hasClipSfx || hasGraphicsSfx || hasBgAudio || hasOriginalAudio || hasDroneAudio)) {
        ui.updateProcessingProgress(5, 'Mastering audio tracks & multi-bus mixing...');
        
        
        const mixCacheParts = [
            timelineState.masterAudioBuffer?.duration.toFixed(3) ?? 'none',
            // [FIX aroll-trim] duration + videoStartOffset must be part of the key:
            // trimming changes audio/video length and in-points, and a stale cached
            // mix here is exactly what makes "audio isnt cut" persist after a trim.
            (timelineState.clips || []).map((c: any) => `${c.id}:${(c.startTime ?? 0).toFixed(3)}:${(c as any).volume ?? 1}:${(c.duration ?? 0).toFixed(3)}:${(c.videoStartOffset ?? 0).toFixed(3)}`).join('|'),
            state._bgAudioBuffer ? 'bgm' : 'nobgm',
            String(state.autoNormalizeAudio),
            String(state.audioDuckingEnabled),
        ];
        const mixKey = `mix_${utils.simpleHash(mixCacheParts.join('::'))}`;
        let cachedMixBlob = null;
        try { cachedMixBlob = await assetStorage.getAsset(mixKey); } catch (e) {}
        if (cachedMixBlob && cachedMixBlob.size > 0) {
            try {
                const cachedBuf = await utils.safeDecode(utils.getAudioContext(), await cachedMixBlob.arrayBuffer());
                if (Math.abs(cachedBuf.duration - exportDuration) < 0.25) {
                    mixedBuffer = cachedBuf;
                    ui.updateProcessingProgress(8, 'Reusing cached mastered audio...');
                }
            } catch (e) {}
        }

        if (!mixedBuffer) {
        const CHUNK_LIMIT_SECONDS = 120;
        const totalOutSamples = Math.ceil(exportDuration * TARGET_SAMPLE_RATE);
        const outBuffer = audioCtx.createBuffer(2, totalOutSamples, TARGET_SAMPLE_RATE);
        const outLeft = outBuffer.getChannelData(0);
        const outRight = outBuffer.getChannelData(1);
        let outOffset = 0;
        
        const silences = timelineState.globalSilences || [];
        const splitPoints = [0];
        let currentPos = CHUNK_LIMIT_SECONDS;
        while (currentPos < exportDuration) {
            let bestSplit = currentPos;
            let minDiff = Infinity;
            for (const s of silences) {
                const mid = (s.start + s.end) / 2;
                const diff = Math.abs(mid - currentPos);
                if (diff < minDiff && diff < 15) {
                    minDiff = diff;
                    bestSplit = mid;
                }
            }
            splitPoints.push(bestSplit);
            currentPos = bestSplit + CHUNK_LIMIT_SECONDS;
        }
        if (splitPoints[splitPoints.length - 1] < exportDuration) {
            splitPoints.push(exportDuration);
        }

        for (let segIdx = 0; segIdx < splitPoints.length - 1; segIdx++) {
            const segStart = splitPoints[segIdx];
            const segEnd = splitPoints[segIdx + 1];
            const segDur = segEnd - segStart;
            const segSamples = Math.ceil(segDur * TARGET_SAMPLE_RATE);
            const offlineCtx = new OfflineAudioContext(2, segSamples, TARGET_SAMPLE_RATE);

            // 1. Master Output Bus
            const masterBus = offlineCtx.createGain();

            // 2. Sub-Mix Busses (Voice, Clips, SFX, BGM)
            const voiceBus = offlineCtx.createGain();
            const clipsBus = offlineCtx.createGain();
            const sfxBus = offlineCtx.createGain();
            const bgmBus = offlineCtx.createGain();

            voiceBus.connect(masterBus);
            clipsBus.connect(masterBus);
            sfxBus.connect(masterBus);
            bgmBus.connect(masterBus);

            // 3. Multi-Source Auto-Normalization & Brickwall Peak Limiter
            if (state.autoNormalizeAudio !== false) {
                masterBus.gain.value = 0.95;
                const limiter = offlineCtx.createDynamicsCompressor();
                limiter.threshold.value = -3.0;
                limiter.knee.value = 4.0;
                limiter.ratio.value = 16.0;
                limiter.attack.value = 0.003;
                limiter.release.value = 0.15;
                masterBus.connect(limiter);
                limiter.connect(offlineCtx.destination);
            } else {
                masterBus.gain.value = 1.0;
                masterBus.connect(offlineCtx.destination);
            }

            const speechBlocks = calculateSpeechIntervals(exportDuration);

            const applyDucking = (gainNode: GainNode, baseVolume: number, duckRatio: number) => {
                const DUCK_VOL = baseVolume * duckRatio;
                const RAMP = 0.3;
                gainNode.gain.setValueAtTime(baseVolume, 0);

                for (const b of speechBlocks) {
                    const start = Math.max(0, b.start) - segStart;
                    const end = Math.min(exportDuration, b.end) - segStart;
                    
                    if (end < 0 || start > segDur) continue;

                    const rampDownStart = Math.max(0, start - RAMP);
                    gainNode.gain.setValueAtTime(baseVolume, rampDownStart);
                    gainNode.gain.linearRampToValueAtTime(DUCK_VOL, Math.max(0, start));

                    gainNode.gain.setValueAtTime(DUCK_VOL, Math.max(0, end));

                    const rampUpEnd = Math.min(segDur, end + RAMP);
                    gainNode.gain.linearRampToValueAtTime(baseVolume, rampUpEnd);
                }
            };

            const mixInNative = async (targetBus: GainNode, buffer: AudioBuffer, startTime: number, loop: boolean = false, volumeParamSetup?: (gainNode: GainNode) => void, bufferOffset: number = 0, bufferDuration?: number, playbackRate: number = 1.0) => {
                let resampled = buffer;
                if (buffer.sampleRate !== TARGET_SAMPLE_RATE) {
                    resampled = await utils.resampleAudioBuffer(buffer, TARGET_SAMPLE_RATE);
                }
                const source = offlineCtx.createBufferSource();
                source.buffer = resampled;
                source.loop = loop;
                if (playbackRate !== 1.0) {
                    source.playbackRate.value = playbackRate;
                }
                
                const gainNode = offlineCtx.createGain();
                if (volumeParamSetup) {
                    volumeParamSetup(gainNode);
                } else {
                    gainNode.gain.value = 1.0;
                }
                
                source.connect(gainNode);
                gainNode.connect(targetBus);
                
                let actualStart = startTime - segStart;
                let actualOffset = bufferOffset;
                let actualDuration = bufferDuration;

                if (actualStart < 0) {
                    actualOffset += Math.abs(actualStart) * playbackRate;
                    if (actualDuration !== undefined) {
                        actualDuration -= Math.abs(actualStart) * playbackRate;
                    }
                    actualStart = 0;
                }

                if (actualDuration !== undefined && actualDuration <= 0) return;
                if (actualStart > segDur) return;

                if (actualDuration !== undefined) {
                    source.start(actualStart, actualOffset, actualDuration);
                } else {
                    source.start(actualStart, actualOffset);
                }
            };

            // 1. Voice Bus
            if (audioBuffer) {
                await mixInNative(voiceBus, audioBuffer!, 0, false);
            }

            // 2. SFX Bus
            if (!timelineState.isTrackHidden('sfx')) {
                for (const clip of timelineState.clips) {
                    if (clip._sfxBuffer) {
                        await mixInNative(sfxBus, clip._sfxBuffer!, clip.startTime, false, undefined, 0, undefined, 1.0);
                    }
                }
                const sfxCues = (timelineState.graphics || []).filter((g: any) =>
                    g.isSfxOnly || g.type === 'sfxCue' || Boolean(g.sfxTrigger && g.sfxTrigger !== 'none')
                );
                for (const cue of sfxCues) {
                    const sfxType = (cue as any).sfxTrigger;
                    if ((cue as any)._sfxBuffer || (cue as any)._sfxObjectURL || (cue as any).customSfxUrl || (cue as any).customSfxAssetId) {
                        try {
                            let customBuf = (cue as any)._sfxBuffer;
                            if (!customBuf && ((cue as any)._sfxObjectURL || (cue as any).customSfxUrl || (cue as any).customSfxAssetId)) {
                                let url = (cue as any)._sfxObjectURL || (cue as any).customSfxUrl;
                                if (!url && (cue as any).customSfxAssetId) {
                                    const blob = await assetStorage.getAsset((cue as any).customSfxAssetId);
                                    if (blob) url = URL.createObjectURL(blob);
                                }
                                if (url) {
                                    const resp = await fetch(url);
                                    const arrBuf = await resp.arrayBuffer();
                                    customBuf = await offlineCtx.decodeAudioData(arrBuf);
                                }
                            }
                            if (customBuf) {
                                const startOff = (cue as any).startOffset || 0;
                                const cueDur = Math.max(0.1, (cue.end ?? ((cue.start || 0) + 1.5)) - (cue.start || 0));
                                await mixInNative(sfxBus, customBuf, cue.start || 0, false, undefined, startOff, cueDur);
                            }
                        } catch (e) {
                            console.warn(`[Export] Failed to mix custom SFX cue at ${cue.start}:`, e);
                        }
                    } else if (sfxType && sfxType !== 'none') {
                        try {
                            const sfxBuf = await audioSynthesizer.synthesizeSfxBuffer(sfxType, 0.6);
                            if (sfxBuf) {
                                await mixInNative(sfxBus, sfxBuf, cue.start || 0, false, undefined, 0, undefined, 1.0);
                            }
                        } catch (e) {
                            console.warn(`[Export] Failed synthesizing SFX ${sfxType}:`, e);
                        }
                    }
                }
            }

            // 3. Clips Bus
            for (const clip of timelineState.clips) {
                if (clip.useOriginalAudio && clip.video_id) {
                    try {
                        const assetBlob = await assetStorage.getAsset(clip.video_id);
                        if (assetBlob) {
                            const native = await utils.safeDecode(utils.getAudioContext(), await assetBlob.arrayBuffer());
                            const offset = timelineState.mode === 'audio_locked' ? clip.startTime : (clip._legacyCursor || clip.startTime);
                            const clipVol = clip.volume ?? 1.0;
                            const fadeIn = clip.fadeIn ?? 0;
                            const fadeOut = clip.fadeOut ?? 0;
                            const rate = clip.playbackRate && !clip.wordTimestamps?.length ? clip.playbackRate : 1;
                            
                            const shouldDuck = state.audioDuckingEnabled !== false && clip.audioDuckingOverride !== false && speechBlocks.length > 0 && !!audioBuffer;
                            
                            const effectiveFadeIn = fadeIn > 0 ? Math.min(fadeIn, Math.max(0.01, clip.duration / 2)) : 0.05;
                            const effectiveFadeOut = fadeOut > 0 ? Math.min(fadeOut, Math.max(0.01, clip.duration / 2)) : 0;

                            await mixInNative(clipsBus, native, offset, false, (g: GainNode) => {
                                if (shouldDuck) {
                                    applyDucking(g, clipVol, 0.25);
                                } else {
                                    const startInCtx = offset - segStart;
                                    const endInCtx = offset + clip.duration - segStart;
                                    g.gain.setValueAtTime(0, Math.max(0, startInCtx));
                                    g.gain.linearRampToValueAtTime(clipVol, Math.max(0, startInCtx + effectiveFadeIn));
                                    if (effectiveFadeOut > 0) {
                                        g.gain.setValueAtTime(clipVol, Math.max(0, endInCtx - effectiveFadeOut));
                                        g.gain.linearRampToValueAtTime(0, Math.max(0, endInCtx));
                                    } else {
                                        g.gain.setValueAtTime(clipVol, Math.max(0, endInCtx));
                                    }
                                }
                            }, clip.videoStartOffset || 0, clip.duration * rate, rate);
                        }
                    } catch (e) {
                        console.warn(`[Export] Could not mix native audio for clip ${clip.id}:`, e);
                    }
                }
            }

            // 4. BGM Bus
            if (state._bgAudioBuffer) {
                const baseVolume = state.bgAudioVolume ?? 0.3;
                const shouldDuck = state.audioDuckingEnabled !== false && speechBlocks.length > 0;
                
                await mixInNative(bgmBus, state._bgAudioBuffer!, 0, true, (gainNode: GainNode) => {
                    if (shouldDuck) {
                        applyDucking(gainNode, baseVolume, 0.2);
                    } else {
                        gainNode.gain.setValueAtTime(baseVolume, 0);
                    }
                });
            }

            // 5. 55Hz Cinematic Drone Audio (procedurally synthesized)
            if (state.cinematicDroneAudio) {
                const segDur = segEnd - segStart;
                const droneBuffer = await generateCinematicDroneBuffer(segDur, TARGET_SAMPLE_RATE, 0.45);
                await mixInNative(bgmBus, droneBuffer, 0, false, (gainNode: GainNode) => {
                    gainNode.gain.setValueAtTime(0.22, 0);
                });
            }

            const rendered = await offlineCtx.startRendering();
            
            // Stream rendered PCM segment directly into outBuffer channels to eliminate OOM
            const renderedSamples = rendered.length;
            const writeCount = Math.min(renderedSamples, totalOutSamples - outOffset);
            if (writeCount > 0) {
                const left = rendered.getChannelData(0);
                outLeft.set(left.subarray(0, writeCount), outOffset);
                if (rendered.numberOfChannels > 1) {
                    const right = rendered.getChannelData(1);
                    outRight.set(right.subarray(0, writeCount), outOffset);
                } else {
                    outRight.set(left.subarray(0, writeCount), outOffset);
                }
            }
            outOffset += writeCount;

            // Yield to event loop so rendered segment and offlineCtx can be freed from memory
            await yieldToMain();
        }

        mixedBuffer = outBuffer;
            try {
                const wavBlob = audioBufferToWavBlob(mixedBuffer);
                await assetStorage.storeAsset(wavBlob, 'audio', undefined, mixKey);
            } catch (e) { console.warn('[EXPORT] Failed to cache mastered audio:', e); }
        }
        audioBuffer = mixedBuffer;
    }

    const finalAudioBuffer = shouldBuildFullAudioMix ? (mixedBuffer || audioBuffer) : null;
    const hasAudio = useChunkedAudio || (shouldBuildFullAudioMix && !!(finalAudioBuffer && finalAudioBuffer.length > 0 && finalAudioBuffer.duration > 0.1));
    const totalDuration = exportDuration;
    const currentRatio = (state.aspectRatio || dom.videoDirectorAspectSelect?.value || dom.imageResolutionSelect?.value || '16:9') as any;
    let resolutionKey = dom.videoExportResolutionSelect ? dom.videoExportResolutionSelect.value : '';
    const userIsGuest = isGuest();
    const guestPolicy = state.systemConfig?.guestExportPolicy || 'watermark_320p';
    if (state.isGuestExport || (userIsGuest && guestPolicy !== 'unrestricted')) {
        state.isGuestExport = true;
        resolutionKey = utils.getGuest320pResolutionKey(currentRatio);
        if (dom.videoExportResolutionSelect) {
            dom.videoExportResolutionSelect.value = resolutionKey;
        }
    }
    const { width, height, key: normKey } = utils.getExportResolutionDimensions(currentRatio, resolutionKey);
    if (dom.videoExportResolutionSelect && dom.videoExportResolutionSelect.value !== normKey) {
        dom.videoExportResolutionSelect.value = normKey;
    }

    const fps = dom.videoExportFpsSelect ? parseInt(dom.videoExportFpsSelect.value) || 30 : 30;
    const projectedBytes = (calculateBitrate(width, height, fps, format === 'mp4-ffmpeg' ? 'mp4' : format) / 8) * totalDuration;
    const MEMORY_EXPORT_WARN_BYTES = 500 * 1024 * 1024;

    if (format !== 'mp4-ffmpeg' && projectedBytes > MEMORY_EXPORT_WARN_BYTES && !isStreamingSupported() && !hasOpfsWritableSupport()) {
        const projectedMB = Math.round(projectedBytes / (1024 * 1024));
        const proceed = await new Promise<boolean>((resolve) => {
            ui.showConfirmation(
                'Large Export Warning',
                `This export is about ${projectedMB} MB and your browser can't write it directly to disk, so it has to be held in memory. Chrome or Edge will stream it to disk instead. Continue?`,
                () => resolve(true),
                () => resolve(false)
            );
        });
        if (!proceed) {
            state.isVideoProductionRunning = false;
            state.isExporting = false;
            ui.closeProcessingModal();
            return;
        }
    }
    
    let stream: FileSystemWritableFileStream | null = null;
    let isElectronExport = false;
    let exportedFilePath: string | null = null;

    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
        try {
            ui.updateProcessingProgress(8, 'Awaiting file destination...');
            // @ts-ignore
            const electron = (window as any).electronAPI;
            const invoke = electron.invoke || electron.ipcRenderer?.invoke;
            if (invoke) {
                const filters = [];
                if (format === 'mp4') filters.push({ name: 'Video', extensions: ['mp4'] });
                else if (format === 'webm') filters.push({ name: 'Video', extensions: ['webm'] });
                
                let filePath = null;
                try {
                    const { resolveWorkspacePath } = await import(/* @vite-ignore */ '../workspaceManager');
                    filePath = await resolveWorkspacePath(filename, { category: 'Videos' });
                } catch (wsErr) {
                    console.warn('[Export] Could not resolve workspace path, asking with dialog:', wsErr);
                }

                if (!filePath && state.exportDirectoryPath) {
                    try {
                        const isVideosSub = state.exportDirectoryPath.toLowerCase().endsWith('videos');
                        const targetFolder = isVideosSub ? state.exportDirectoryPath : await invoke.call(electron, 'path-join', state.exportDirectoryPath, 'Videos');
                        filePath = await invoke.call(electron, 'path-join', targetFolder, filename);
                    } catch (e) {}
                }

                if (!filePath) {
                    filePath = await invoke.call(electron, 'show-save-dialog', { defaultPath: filename, filters });
                }

                if (filePath) {
                    console.log(`[EXPORT] Resolved destination path: ${filePath}`);
                    exportedFilePath = filePath;
                    const fd = await invoke.call(electron, 'fs-open', filePath, 'w');
                    isElectronExport = true;
                    
                    let writeChain: Promise<any> = Promise.resolve();
                    let queuedBytes = 0;
                    const MAX_QUEUE_BYTES = 4 * 1024 * 1024; // 4MB bounded backpressure queue
                    let fatalError: Error | null = null;
                    let closed = false;
                    let currentPosition = 0;

                    const writeChunk = async (chunk: any) => {
                        if (fatalError) {
                            throw fatalError;
                        }
                    
                        if (closed) {
                            throw new Error(
                                'Attempted to write to closed file descriptor'
                            );
                        }
                    
                        let rawData: any = null;
                        let position: number | null = null;
                    
                        if (chunk && chunk.type === 'write') {
                            rawData = chunk.data;
                    
                            if (typeof chunk.position === 'number') {
                                position = chunk.position;
                            } else {
                                position = currentPosition;
                            }
                        } else if (
                            chunk instanceof Uint8Array ||
                            chunk instanceof ArrayBuffer
                        ) {
                            rawData = chunk;
                            position = currentPosition;
                        }
                    
                        if (!rawData) {
                            return;
                        }
                    
                        /*
                         * IMPORTANT:
                         *
                         * Do not clone Uint8Array here.
                         *
                         * The previous rawData.slice() created another copy of every
                         * encoded chunk. During MP4 finalization this could cause a
                         * large renderer memory spike.
                         */
                    
                        let data: Uint8Array;
                    
                        if (rawData instanceof Uint8Array) {
                            data = rawData;
                        } else if (rawData instanceof ArrayBuffer) {
                            data = new Uint8Array(rawData);
                        } else if (ArrayBuffer.isView(rawData)) {
                            data = new Uint8Array(
                                rawData.buffer,
                                rawData.byteOffset,
                                rawData.byteLength
                            );
                        } else {
                            throw new Error(
                                'Unsupported export data type'
                            );
                        }
                    
                        const bytes = data.byteLength;
                    
                        if (position === currentPosition) {
                            currentPosition += bytes;
                        }
                    
                        queuedBytes += bytes;
                    
                        writeChain = writeChain.then(async () => {
                            try {
                                if (fatalError) {
                                    throw fatalError;
                                }
                    
                                await invoke.call(
                                    electron,
                                    'fs-write',
                                    fd,
                                    data,
                                    position
                                );
                    
                            } catch (err: any) {
                                fatalError =
                                    err instanceof Error
                                        ? err
                                        : new Error(String(err));
                    
                                console.error(
                                    '[ELECTRON EXPORT] fs-write failed:',
                                    fatalError
                                );
                    
                                throw fatalError;
                    
                            } finally {
                                queuedBytes = Math.max(
                                    0,
                                    queuedBytes - bytes
                                );
                            }
                        });
                    
                        /*
                         * Keep the IPC queue small.
                         *
                         * 4 MB is safer than the old 8 MB queue.
                         */
                        const MAX_QUEUE_BYTES = 4 * 1024 * 1024;
                    
                        if (queuedBytes >= MAX_QUEUE_BYTES) {
                            await writeChain;
                        }
                    
                        if (fatalError) {
                            throw fatalError;
                        }
                    };

                    const flushWrites = async (): Promise<void> => {
                        await writeChain;
                        if (fatalError) throw fatalError;
                    };

                    const closeFd = async (): Promise<void> => {
                        if (closed) return;
                        closed = true;
                        try {
                            await flushWrites();
                        } finally {
                            await invoke.call(electron, 'fs-close', fd);
                        }
                    };

                    const abortFd = async (): Promise<void> => {
                        if (closed) return;
                        closed = true;
                        try {
                            await writeChain;
                        } catch (wErr) {
                            console.warn("Write chain error during abort:", wErr);
                        }
                        try {
                            await invoke.call(electron, 'fs-close', fd);
                        } catch (cErr) {
                            console.warn("fs-close error during abort:", cErr);
                        }
                    };

                    stream = {
                        write: writeChunk,
                        close: closeFd,
                        abort: abortFd,
                        flush: flushWrites,
                        getWriter: () => ({
                            write: writeChunk,
                            close: closeFd,
                            abort: abortFd,
                            flush: flushWrites,
                            releaseLock: () => {}
                        })
                    } as any;
                } else {
                    ui.showStatus('Export cancelled.', false, 2000);
                    state.isVideoProductionRunning = false;
                    state.isExporting = false;
                    ui.closeProcessingModal();
                    return;
                }
            }
        } catch (err) {
            console.warn('Electron init export failed', err);
        }
    }

    let opfsHandle: any = null;

    if (!stream && isStreamingSupported()) {
        ui.updateProcessingProgress(8, 'Awaiting file destination...');
        stream = await tryInitStreamingExport(filename, format === 'mp4-ffmpeg' ? 'mp4' : format);
    }

    if (!stream && format !== 'mp4-ffmpeg' && hasOpfsWritableSupport()) {
        ui.updateProcessingProgress(8, 'Preparing disk-backed export...');
        const opfs = await tryInitOpfsExport(filename, projectedBytes);
        if (opfs) {
            stream = opfs.stream;
            opfsHandle = opfs.handle;
        }
    }

    if (!stream && format !== 'mp4-ffmpeg' && projectedBytes > MEMORY_EXPORT_WARN_BYTES) {
        const useFallback = await new Promise<boolean>((resolve) => {
            ui.showConfirmation(
                'Use Memory Export?',
                'Direct-to-disk export unavailable. Use memory-based export instead? (May fail for very long videos)',
                () => resolve(true),
                () => resolve(false)
            );
        });
        if (!useFallback) {
            ui.showStatus('Export cancelled.', false, 2000);
            state.isVideoProductionRunning = false;
            state.isExporting = false;
            ui.closeProcessingModal();
            return;
        }
    }


    const useElectronWorker = useLongElectronSegmentedPipeline && !hasAnyAudioSources && !!exportedFilePath;

    const clipsToOptimize = videoRenderContext?.clips || timelineState.clips;
    if (useElectronWorker) {
        ui.updateProcessingProgress(10, 'Preparing dedicated export worker...');
    } else {
        ui.updateProcessingProgress(10, 'Optimizing image assets for export target...');
        await prepareExportOptimizedImages(clipsToOptimize, width, height, (p, msg) => {
            ui.updateProcessingProgress(10 + Math.round((p / 100) * 4), msg);
        });

        await prepareParallaxDepth(clipsToOptimize, (p, msg) => {
            ui.updateProcessingProgress(14, msg);
        });

        // Alias AI model depth maps from source image/plate to the downscaled export bitmap so getDepthSync never misses the cache
        for (const c of (clipsToOptimize || [])) {
            if (c && c._exportOptimizedImage) {
                aliasDepth(c.backgroundPlate || c.image, c._exportOptimizedImage);
            }
        }
    }

    ui.updateProcessingProgress(14, stream ? 'Starting direct export...' : 'Initializing encoder...');

    const shouldCleanDisk = dom.videoExportCleanMetadataCheckbox ? dom.videoExportCleanMetadataCheckbox.checked : true;

    try {
        const isLongVideo = totalDuration >= 600; // >= 10 minutes
        if (format === 'mp4-ffmpeg') {
            await exportWithFFmpeg(
                width, height, finalAudioBuffer, hasAudio, preferHardware,
                isElectronExport ? exportedFilePath : null, stream,
                filename,
                (progress, message) => { ui.updateProcessingProgress(progress, message); syncTaskbarProgress(progress); }
            );
        } else if (isElectronExport && format === 'mp4' && exportedFilePath && isLongVideo) {
            if (useElectronWorker) {
                console.log(`[EXPORT] Using dedicated Electron worker for audio-free ${totalDuration.toFixed(1)}s export.`);
                try {
                    await exportWithElectronWorker(
                        exportedFilePath,
                        width,
                        height,
                        fps,
                        preferHardware,
                        (progress, message) => {
                            ui.updateProcessingProgress(progress, message);
                            syncTaskbarProgress(progress);
                        }
                    );
                } catch (workerErr: any) {
                    console.warn('[EXPORT] Dedicated worker failed, falling back to in-process segmented pipeline:', workerErr);
                    ui.updateProcessingProgress(15, 'Worker restart fallback — continuing export...');
                    await exportWithSegmentedPipeline(
                        exportedFilePath,
                        width,
                        height,
                        fps,
                        preferHardware,
                        (progress, message) => {
                            ui.updateProcessingProgress(progress, message);
                            syncTaskbarProgress(progress);
                        },
                        !shouldCleanDisk
                    );
                }
            } else {
                console.log(`[EXPORT] Using in-process segmented pipeline for ${totalDuration.toFixed(1)}s audio export.`);
                await exportWithSegmentedPipeline(
                    exportedFilePath,
                    width,
                    height,
                    fps,
                    preferHardware,
                    (progress, message) => {
                        ui.updateProcessingProgress(progress, message);
                        syncTaskbarProgress(progress);
                    },
                    !shouldCleanDisk
                );
            }
        } else if (stream) {
            try {
                await exportWithStreaming(stream, format, width, height, finalAudioBuffer, hasAudio, preferHardware, audioSegmentProvider);
            } catch (streamErr: any) {
                if (preferHardware && (streamErr?.code === 'GPU_ENCODER_FAILED' || streamErr?.message?.includes('Hardware') || streamErr?.message?.includes('GPU'))) {
                    console.warn('[EXPORT] Hardware acceleration failed mid-render. Seamlessly retrying with software encoder...', streamErr);
                    ui.showStatus('GPU encoder busy, switching to software encoder...', false, 4000);
                    await exportWithStreaming(stream, format, width, height, finalAudioBuffer, hasAudio, false, audioSegmentProvider);
                } else {
                    throw streamErr;
                }
            }
            
            if (opfsHandle) {
                ui.updateProcessingProgress(99, 'Saving video...');
                await deliverOpfsExport(opfsHandle, filename);
                opfsHandle = null;
            }
            
            // @ts-ignore
            if (isElectronExport && typeof window !== 'undefined' && (window as any).electronAPI && exportedFilePath) {
                // @ts-ignore
                const electron = (window as any).electronAPI;
                const invoke = electron.invoke || electron.ipcRenderer?.invoke;
                if (invoke) {
                    const stat = await invoke.call(electron, 'fs-stat', exportedFilePath);
                    console.log('[EXPORT] Final file:', stat);
                    if (!stat.isFile || stat.size < 1024 || stat.mediaKind !== 'mp4') {
                        throw new Error(`Export produced an invalid MP4 file (${stat.size} bytes).`);
                    }
                }
            }

            // Apply clean metadata to the on-disk file (streaming path never
            // builds a blob, so cleanVideoMetadataWithServer can't be used).
            const shouldCleanDisk = dom.videoExportCleanMetadataCheckbox ? dom.videoExportCleanMetadataCheckbox.checked : true;
            let metadataCleaned = false;
            if (shouldCleanDisk && format === 'mp4' && exportedFilePath) {
                ui.updateProcessingProgress(98, 'Applying authentic device profile & stripping C2PA metadata...');
                try {
                    const exportAspectRatio =
                        dom.imageResolutionSelect?.value ||
                        timelineState.clips?.[0]?.aspectRatio ||
                        '16:9';

                    const deviceProfile = getExportDeviceProfile(exportAspectRatio);

                    const backendHttp = window.location.origin;
                    
                    const sources = Array.from(new Set(timelineState.clips.map((c: any) => c.deviceTag).filter(Boolean)));
                    const comment = sources.length ? `Footage sources: ${sources.join(' · ')}` : undefined;

                    const registerRes = await fetch(`${backendHttp}/api/register-metadata-target`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: exportedFilePath })
                    });
                    if (!registerRes.ok) {
                        throw new Error(`Could not register exported file for metadata cleaning (${registerRes.status}).`);
                    }
                    const registration = await registerRes.json();
                    if (!registration?.token) {
                        throw new Error('Metadata-clean registration did not return a token.');
                    }

                    const r = await fetch(`${backendHttp}/api/clean-metadata-path`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            token: registration.token,
                            make: deviceProfile.make,
                            model: deviceProfile.model,
                            software: deviceProfile.software,
                            comment: comment || undefined
                        })
                    });
                    if (r.ok) {
                        metadataCleaned = true;
                    } else {
                        console.warn('[Clean Metadata] path remux failed:', await r.text());
                    }
                } catch (e) {
                    console.warn('[Clean Metadata] path remux error:', e);
                }
            }

            // Post-cleaning verification to guarantee valid MP4 on disk
            // @ts-ignore
            if (isElectronExport && typeof window !== 'undefined' && (window as any).electronAPI && exportedFilePath) {
                // @ts-ignore
                const electron = (window as any).electronAPI;
                const invoke = electron.invoke || electron.ipcRenderer?.invoke;
                if (invoke) {
                    const stat = await invoke.call(electron, 'fs-stat', exportedFilePath);
                    console.log('[EXPORT] Final file stat (post-metadata):', stat);
                    if (!stat.isFile || stat.size < 1024 || stat.mediaKind !== 'mp4') {
                        throw new Error(`Export produced an invalid MP4 file (${stat.size} bytes).`);
                    }
                }
            }

            ui.updateProcessingProgress(100, 'Export complete!');
            if (shouldCleanDisk && format === 'mp4' && !metadataCleaned) {
                ui.showStatus('✅ Video saved to disk! (Device profile remux skipped)', false, 3500);
            } else {
                ui.showStatus('✅ Video saved to disk!', false, 3000);
            }
            
            // @ts-ignore
            if (isElectronExport && typeof window !== 'undefined' && (window as any).electronAPI && exportedFilePath) {
                electronService('show-item-in-folder', exportedFilePath);
            }
            
            // @ts-ignore
            if (isElectronExport && typeof window !== 'undefined' && (window as any).electronAPI) {
                try {
                    // @ts-ignore
                    const electron = (window as any).electronAPI;
                    const invoke = electron.invoke || electron.ipcRenderer?.invoke;
                    if (invoke) {
                        invoke.call(electron, 'show-notification', {
                            title: 'Export Complete',
                            body: `Your video ${filename} has finished rendering.`
                        });
                    }
                } catch(e) {
                    console.warn("Electron notification error:", e);
                }
            }

            await maybeExportSidecarSubtitles(filename);
            await new Promise(r => setTimeout(r, 1000)); // Give user time to see 100%
        } else if (format !== 'mp4-ffmpeg' as any) {
            try {
                await exportWithMemory(format, filename, width, height, finalAudioBuffer, hasAudio, preferHardware, audioSegmentProvider);
            } catch (memErr: any) {
                if (preferHardware && (memErr?.code === 'GPU_ENCODER_FAILED' || memErr?.message?.includes('Hardware') || memErr?.message?.includes('GPU'))) {
                    console.warn('[EXPORT] Hardware acceleration failed in memory export. Retrying with software encoder...', memErr);
                    ui.showStatus('GPU encoder busy, switching to software encoder...', false, 4000);
                    await exportWithMemory(format, filename, width, height, finalAudioBuffer, hasAudio, false, audioSegmentProvider);
                } else {
                    throw memErr;
                }
            }
            await maybeExportSidecarSubtitles(filename);
            ui.updateProcessingProgress(100, 'Download starting...');
            ui.showStatus('✅ Video exported!', false, 3000);
            await new Promise(r => setTimeout(r, 1000)); // Give user time to see 100%
        }
    } catch (err: any) {
        if (err.message === 'Cancelled.') {
            if (stream) { 
                try { 
                    await stream.abort(); 
                } catch (e) { 
                    console.warn("Stream abort notice on cancel:", e); 
                } 
            }
            ui.showStatus('Export cancelled by user.', false, 3000);
        } else {
            console.error('[EXPORT] ===== EXPORT FAILURE =====');
            console.error('[EXPORT] format:', format);
            console.error('[EXPORT] filename:', filename);
            console.error('[EXPORT] error:', err);
            console.error('[EXPORT] message:', err?.message);
            console.error('[EXPORT] stack:', err?.stack);
            console.error('[EXPORT] =========================');
            if (stream) { 
                try { 
                    await stream.abort(); 
                } catch (e) { 
                    console.warn("Stream abort notice on error:", e); 
                } 
            }
            throw err;
        }
    } finally {
        // Release WebGL texture cache from GPU memory
        try { 
            cleanupWebGL(); 
        } catch(e) {
            console.warn("WebGL cleanup notice:", e);
        }

        try { clearStaticFrameCache(); } catch (e) {}
        try { clearSegmentAudioCaches(); } catch (e) {}
        try { clearExportOptimizedImages(videoRenderContext?.clips, timelineState.clips); } catch (e) {}
        syncTaskbarProgress(-1); // remove taskbar progress when done/cancelled

        // Release system sleep blocker on Electron
        // @ts-ignore
        if (typeof window !== 'undefined' && (window as any).electronAPI) {
            try {
                // @ts-ignore
                const electron = (window as any).electronAPI;
                const invoke = electron.invoke || electron.ipcRenderer?.invoke;
                if (invoke) await invoke.call(electron, 'power-save-blocker-stop');
                
                if (!state.isVideoProductionRunning && isElectronExport && exportedFilePath) {
                    try { await invoke.call(electron, 'delete-file', { filePath: exportedFilePath }); } catch {}
                    ui.showStatus('Export cancelled — partial file removed.', false, 2500);
                }
            } catch(e) {
                console.warn("Could not stop power save blocker:", e);
            }
        }

        state.isExporting = false;
        state.isGuestExport = false;
        state.isVideoProductionRunning = false;
        ui.setButtonsDisabled(false);
        if (videoRenderContext) {
            drawVideoFrame(state.videoPauseTime || 0);
            ui.updateVideoTime(state.videoPauseTime || 0, videoRenderContext.totalDuration);
        }
        ui.closeProcessingModal();
    }
}



export async function handleChangeExportDirectory() {
    // @ts-ignore
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
        try {
            const { changeWorkspaceRoot } = await import(/* @vite-ignore */ '../workspaceManager');
            const newRoot = await changeWorkspaceRoot();
            if (newRoot) {
                ui.showStatus(`Workspace folder set to: ${newRoot}`, false, 3000);
            }
        } catch (err) {
            console.error('Electron select dir failed', err);
        }
    } else {
        if ('showDirectoryPicker' in window) {
            try {
                const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
                state.exportDirectoryHandle = dirHandle;
                if (dom.exportSavePathDisplay) dom.exportSavePathDisplay.textContent = dirHandle.name;
                ui.showStatus(`Export folder set to: ${dirHandle.name}`, false, 3000);
            } catch (err: any) {
                if (err.name !== 'AbortError') {
                    console.error('Directory picker failed', err);
                }
            }
        } else {
            ui.showStatus('Directory selection is not supported in this environment. It will default to your downloads folder.', true, 3000);
        }
    }
}

// ---------------------------------------------------------------------------
// Public API of the exporter module. Kept identical to the pre-split
// src/exporter.ts so existing consumers (index.tsx, handlers-transcribe,
// shortcuts) need no changes.
// ---------------------------------------------------------------------------
export { extractTimelineAudioMixdown, getTimelineAudioDrift } from './audio';
export { cleanVideoMetadataWithServer } from './backend-ffmpeg';
export { handleCloudRenderExport } from './cloud-render';
export type { SavedCloudRender } from './cloud-render-store';
export { clearAllStoredCloudRenders, deleteStoredCloudRender, getStoredCloudRenders, saveStoredCloudRenders, upsertStoredCloudRender } from './cloud-render-store';
export { clearAllCloudRenders, closeCloudRenderHistoryModal, deleteCloudRenderItem, initCloudRenderBackgroundTracker, loadCloudDiagnostics, openCloudRenderHistoryModal, refreshCloudRendersList } from './cloud-render-ui';
