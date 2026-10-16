/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import { timelineState } from '../state-timeline';
import * as ui from '../ui';
import { videoRenderContext } from '../videoRenderer';
import { EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } from 'mediabunny';
import { selectSupportedAudioCodec } from './codecs';
import { drawExportFrameCached, syncVideosForExportTime, yieldToMain } from './frames';
import { startExportStage, endExportStage, resetExportProfiler, logExportProfiler } from './export-profiler';
import { disposeExportFrameSource, resetVideoSyncTelemetry, getVideoSyncTelemetry } from './video-frame-source';


export type AudioSegmentProvider = (startTimeSec: number, durationSec: number) => Promise<AudioBuffer | null>;

export async function encodeToMuxer(
    videoSource: EncodedVideoPacketSource,
    audioSource: EncodedAudioPacketSource | null,
    format: 'mp4' | 'webm',
    width: number,
    height: number,
    fps: number,
    audioBuffer: AudioBuffer | null,
    hasAudio: boolean,
    encoderCodec: string,
    videoBitrate: number,
    hardwareAcceleration: 'prefer-hardware' | 'prefer-software',
    onProgress: (progress: number, message: string) => void,
    checkBackpressure?: () => Promise<void>,
    audioSegmentProvider?: AudioSegmentProvider
) {
    if (!videoRenderContext) throw new Error("Render context not available.");
    resetExportProfiler();
    resetVideoSyncTelemetry();

    let videoEncoder: VideoEncoder | null = null;
    let audioEncoder: AudioEncoder | null = null;
    let pendingVideoAdd: Promise<void> | null = null;
    let pendingAudioAdd: Promise<void> | null = null;
    let videoBacklog = 0;
    let audioBacklog = 0;

    try {
        const contextDuration = videoRenderContext?.totalDuration || 0;
        const audioDuration = (hasAudio && audioBuffer && audioBuffer.duration > 0.05)
            ? audioBuffer.duration
            : (hasAudio && audioSegmentProvider ? contextDuration : 0);
        const isAudioLocked = timelineState.mode === 'audio_locked';
        const totalDuration = (isAudioLocked && audioDuration > 0) ? audioDuration : Math.max(contextDuration, audioDuration);
        const totalFrames = Math.round(totalDuration * fps);

        if (totalFrames <= 0) {
            throw new Error(`Total export frames is 0. Duration: ${totalDuration.toFixed(2)}s (video: ${contextDuration.toFixed(2)}s, audio: ${audioDuration.toFixed(2)}s). Ensure timeline contains shots.`);
        }

        onProgress(11, 'Configuring video encoder...');
        let audioBitrate = 128_000;

        let videoEncoderError: Error | null = null;
        let audioEncoderError: Error | null = null;

        videoEncoder = new VideoEncoder({
            output: (chunk: any, meta: any) => {
                videoBacklog++;
                pendingVideoAdd = (pendingVideoAdd || Promise.resolve())
                    .then(() => videoSource.add(EncodedPacket.fromEncodedChunk(chunk), meta))
                    .finally(() => { videoBacklog--; });
            },
            error: (e: any) => {
                console.error("Video Encoder Error:", e);
                const err = e instanceof Error ? e : new Error(`Video Encoder Error: ${e}`);
                if (hardwareAcceleration === 'prefer-hardware') {
                    (err as any).code = 'GPU_ENCODER_FAILED';
                }
                videoEncoderError = err;
            },
        });

        // Prioritize visual quality first (B-frames and lookahead). Fall back to 'realtime' if driver unsupported.
        let videoLatencyMode: 'quality' | 'realtime' = 'quality';
        try {
            const qSupport = await VideoEncoder.isConfigSupported({
                codec: encoderCodec,
                width,
                height,
                bitrate: videoBitrate,
                framerate: fps,
                latencyMode: 'quality',
                hardwareAcceleration
            });
            if (!qSupport.supported) videoLatencyMode = 'realtime';
        } catch (qErr) {
            console.warn('[EXPORT] latencyMode quality probe fallback:', qErr);
            videoLatencyMode = 'realtime';
        }
        console.log('[EXPORT] Video encoder latency mode:', videoLatencyMode);

        videoEncoder.configure({
            codec: encoderCodec,
            width,
            height,
            framerate: fps,
            bitrate: videoBitrate,
            bitrateMode: 'variable',
            latencyMode: videoLatencyMode,
            hardwareAcceleration,
            // Fix washed-out contrast and color shifts across Safari / QuickTime / QuickLook
            colorSpace: {
                primaries: 'bt709',
                transfer: 'bt709',
                matrix: 'bt709',
                fullRange: false,
            },
        } as any);

        const effectiveHasAudio = Boolean(hasAudio && (audioBuffer || audioSegmentProvider));
        const sampleRate = audioBuffer ? audioBuffer.sampleRate : 48000;
        const numChannels = audioBuffer ? audioBuffer.numberOfChannels : 2;

        if (effectiveHasAudio && audioSource) {
            onProgress(13, 'Configuring audio encoder...');
            const selectedAudioCodec = await selectSupportedAudioCodec(format, sampleRate, numChannels, audioBitrate);
            audioEncoder = new AudioEncoder({
                output: (chunk: any, meta: any) => {
                    audioBacklog++;
                    pendingAudioAdd = (pendingAudioAdd || Promise.resolve())
                        .then(() => audioSource!.add(EncodedPacket.fromEncodedChunk(chunk), meta))
                        .finally(() => { audioBacklog--; });
                },
                error: (e: any) => {
                    console.error("Audio Encoder Error:", e);
                    const err = e instanceof Error ? e : new Error(`Audio Encoder Error: ${e}`);
                    (err as any).code = 'AUDIO_ENCODER_FAILED';
                    audioEncoderError = err;
                }
            });
            audioEncoder.configure({ codec: selectedAudioCodec, sampleRate, numberOfChannels: numChannels, bitrate: audioBitrate });
        }

        onProgress(15, 'Creating render canvas...');
        const exportCanvas = typeof OffscreenCanvas !== 'undefined' 
            ? new OffscreenCanvas(width, height)
            : document.createElement('canvas');
        if (exportCanvas instanceof HTMLCanvasElement) {
            exportCanvas.width = width;
            exportCanvas.height = height;
        }
        const exportCtx = exportCanvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: false });
        if (!exportCtx) throw new Error("Canvas context failed.");

        const VIDEO_ENCODE_START = 15;
        const VIDEO_ENCODE_WEIGHT = hasAudio ? 0.70 : 0.80;

        let videoFrameIndex = 0;
        let audioSampleIndex = 0;
        const totalSamples = effectiveHasAudio
            ? (audioBuffer ? audioBuffer.length : Math.round(totalDuration * sampleRate))
            : 0;
        // Slice ~1 second of audio samples per iteration rather than 1024 to minimize allocations and micro-awaits
        const audioFramesPerChunk = Math.max(1024, sampleRate);
        const maxVideoQueue = hardwareAcceleration === 'prefer-hardware' ? 8 : 2;

        let activeSegmentBuffer: AudioBuffer | null = null;
        let activeSegmentStartSec = -1;
        let activeSegmentEndSec = -1;

        let lastYieldTime = performance.now();

        while (videoFrameIndex < totalFrames || audioSampleIndex < totalSamples) {
            if (videoEncoderError) throw videoEncoderError;
            if (audioEncoderError) throw audioEncoderError;
            if (!state.isVideoProductionRunning) throw new Error("Cancelled.");

            const videoTime = videoFrameIndex < totalFrames ? (videoFrameIndex / fps) : Infinity;
            const audioTime = audioSampleIndex < totalSamples ? (audioSampleIndex / sampleRate) : Infinity;

            if (videoTime <= audioTime) {
                // Keep GPU encoder fed with up to 8 frames in flight when hardware acceleration is active
                while (videoEncoder.encodeQueueSize > maxVideoQueue) {
                    await yieldToMain();
                    if (!state.isVideoProductionRunning) throw new Error("Cancelled.");
                }
                if (checkBackpressure) await checkBackpressure();
                // Only pause drawing if a significant muxer packet backlog builds up
                if (videoBacklog > 8 && pendingVideoAdd) {
                    await pendingVideoAdd;
                }

                const time = videoFrameIndex / fps;
                const timestampUs = Math.round(videoFrameIndex * (1_000_000 / fps));

                startExportStage('video-sync');
                await syncVideosForExportTime(time, fps, height);
                endExportStage('video-sync');

                startExportStage('frame-render');
                await drawExportFrameCached(time, exportCanvas as any, exportCtx as any);
                endExportStage('frame-render');
                
                let frame: VideoFrame | null = null;
                try {
                    frame = new VideoFrame(exportCanvas, { timestamp: timestampUs, duration: Math.round(1_000_000 / fps) });
                    videoEncoder.encode(frame, { keyFrame: videoFrameIndex === 0 || videoFrameIndex % (fps * 4) === 0 });
                } finally {
                    if (frame) {
                        try { frame.close(); } catch(e) { console.warn("VideoFrame close notice:", e); }
                    }
                }

                const now = performance.now();
                if (now - lastYieldTime >= 16) {
                    await yieldToMain();
                    lastYieldTime = performance.now();
                }

                if (videoFrameIndex % 15 === 0 || videoFrameIndex === totalFrames - 1) {
                    sessionStorage.setItem('export.lastFrame', String(videoFrameIndex));
                    const progress = VIDEO_ENCODE_START + (videoFrameIndex / totalFrames) * (100 * VIDEO_ENCODE_WEIGHT);
                    onProgress(progress, `Encoding Visuals: Frame ${videoFrameIndex + 1} of ${totalFrames}...`);
                }
                
                videoFrameIndex++;
            } else {
                // Throttle audio encoder queue
                while (audioEncoder && audioEncoder.encodeQueueSize > 4) {
                    await yieldToMain();
                    if (!state.isVideoProductionRunning) throw new Error("Cancelled.");
                }
                if (checkBackpressure) await checkBackpressure();
                if (audioBacklog > 8 && pendingAudioAdd) {
                    await pendingAudioAdd;
                }

                const len = Math.min(audioFramesPerChunk, totalSamples - audioSampleIndex);
                let currentAudioBuf: AudioBuffer | null = audioBuffer;

                if (!currentAudioBuf && audioSegmentProvider) {
                    const currentSec = audioSampleIndex / sampleRate;
                    if (!activeSegmentBuffer || currentSec < activeSegmentStartSec || currentSec >= activeSegmentEndSec) {
                        const segDur = 15;
                        activeSegmentStartSec = currentSec;
                        activeSegmentEndSec = currentSec + segDur;
                        activeSegmentBuffer = await audioSegmentProvider(activeSegmentStartSec, segDur);
                    }
                    currentAudioBuf = activeSegmentBuffer;
                }

                const interleaved = new Float32Array(len * numChannels);
                if (currentAudioBuf) {
                    const bufChannels = currentAudioBuf.numberOfChannels;
                    const ch0 = currentAudioBuf.getChannelData(0);
                    const ch1 = bufChannels > 1 ? currentAudioBuf.getChannelData(1) : ch0;
                    const offsetInBuf = audioBuffer
                        ? audioSampleIndex
                        : Math.max(0, Math.round((audioSampleIndex / sampleRate - activeSegmentStartSec) * sampleRate));

                    for (let s = 0; s < len; s++) {
                        const srcIdx = offsetInBuf + s;
                        if (srcIdx >= 0 && srcIdx < currentAudioBuf.length) {
                            interleaved[s * numChannels] = ch0[srcIdx];
                            if (numChannels > 1) {
                                interleaved[s * numChannels + 1] = ch1[srcIdx];
                            }
                        }
                    }
                }
                
                const timestampUs = Math.round((audioSampleIndex / sampleRate) * 1_000_000);
                let audioData: AudioData | null = null;
                try {
                    audioData = new AudioData({ 
                        format: 'f32', 
                        sampleRate: sampleRate, 
                        numberOfFrames: len, 
                        numberOfChannels: numChannels, 
                        timestamp: timestampUs, 
                        data: interleaved.buffer 
                    });
                    if (audioEncoder) audioEncoder.encode(audioData);
                } finally {
                    if (audioData) {
                        try { audioData.close(); } catch(e) { console.warn("AudioData close notice:", e); }
                    }
                }

                const now = performance.now();
                if (now - lastYieldTime >= 16) {
                    await yieldToMain();
                    lastYieldTime = performance.now();
                }
                audioSampleIndex += len;
            }
        }

        onProgress(90, `Flushing encoders...`);
        await videoEncoder.flush();
        if (audioEncoder) await audioEncoder.flush();
        if (pendingVideoAdd) await pendingVideoAdd;
        if (pendingAudioAdd) await pendingAudioAdd;

        console.log(`[EXPORT] Encode path: ${encoderCodec} / ${hardwareAcceleration === 'prefer-hardware' ? 'HARDWARE' : 'software'} / latency=${videoLatencyMode}`);
        logExportProfiler();
        ui.showStatus(`Exported via ${encoderCodec} (${hardwareAcceleration === 'prefer-hardware' ? 'GPU' : 'CPU'})`, false, 4000);
    } finally {
        if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close();
        if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
        await disposeExportFrameSource(timelineState.clips);
        console.info('[EXPORT VIDEO SYNC TELEMETRY]', getVideoSyncTelemetry());
    }
}
