/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import { timelineState, calculateSpeechIntervals } from '../state-timeline';
import { assetStorage } from '../assetStorage';
import * as utils from '../utils';
import { videoRenderContext } from '../videoRenderer';
import { audioSynthesizer } from '../audioSynthesizer';
import { stretchAudioBufferPreservePitch, softClipAudioBuffer } from './wsola-stretcher';
import { getExportFlags } from './export-flags';



export function getTimelineAudioDrift(): { seconds: number; audioDuration: number } | null {
    const audioDur = timelineState.masterAudioBuffer?.duration;
    if (!audioDur || !timelineState.clips?.length) return null;
    const sorted = [...timelineState.clips].sort((a, b) => a.startTime - b.startTime);
    const lastEnd = sorted[sorted.length - 1].endTime ?? 0;
    return { seconds: lastEnd - audioDur, audioDuration: audioDur };
}


export async function extractTimelineAudioMixdown(skipBGM: boolean = true): Promise<AudioBuffer | null> {
    const { videoRenderContext } = await import('../videoRenderer');
    const exportDuration = videoRenderContext?.totalDuration || timelineState.clips.reduce((acc: number, c: any) => acc + c.duration, 0);
    
    if (exportDuration <= 0) return null;
    const TARGET_SAMPLE_RATE = 44100;
    const totalSamples = Math.ceil(exportDuration * TARGET_SAMPLE_RATE);
    
    const offlineCtx = new OfflineAudioContext(2, totalSamples, TARGET_SAMPLE_RATE);

    // 1. Master Output Bus
    const masterBus = offlineCtx.createGain();

    // 2. Sub-Mix Busses
    const voiceBus = offlineCtx.createGain();
    const clipsBus = offlineCtx.createGain();
    const sfxBus = offlineCtx.createGain();
    const bgmBus = offlineCtx.createGain();

    voiceBus.connect(masterBus);
    clipsBus.connect(masterBus);
    sfxBus.connect(masterBus);
    bgmBus.connect(masterBus);

    // 3. Normalization & Brickwall Limiter
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

    const mixInNative = async (
        targetBus: GainNode,
        buffer: AudioBuffer,
        startTime: number,
        loop: boolean = false,
        volumeParamSetup?: (gainNode: GainNode) => void,
        bufferOffset: number = 0,
        bufferDuration?: number,
        playbackRate: number = 1.0
    ) => {
        let resampled = buffer;
        if ((buffer as any)._resampled44100) {
            resampled = (buffer as any)._resampled44100;
        } else if (buffer.sampleRate !== TARGET_SAMPLE_RATE) {
            resampled = await utils.resampleAudioBuffer(buffer, TARGET_SAMPLE_RATE);
            try {
                (buffer as any)._resampled44100 = resampled;
            } catch {}
        }
        const source = offlineCtx.createBufferSource();
        source.buffer = resampled;
        source.loop = loop;
        source.playbackRate.value = playbackRate;
        
        const gainNode = offlineCtx.createGain();
        if (volumeParamSetup) volumeParamSetup(gainNode);
        else gainNode.gain.value = 1.0;
        
        source.connect(gainNode);
        gainNode.connect(targetBus);
        if (bufferDuration !== undefined) {
            source.start(startTime, bufferOffset, bufferDuration);
        } else {
            source.start(startTime, bufferOffset);
        }
    };

    if (timelineState.masterAudioBuffer) {
        const hasSoloClips = timelineState.clips?.some((c: any) => c.soloAudio || c.muteNarration);
        if (hasSoloClips) {
            await mixInNative(voiceBus, timelineState.masterAudioBuffer, 0, false, (g) => {
                const FADE_SEC = 0.025; // 25ms anti-click micro-fade
                g.gain.setValueAtTime(1.0, 0);
                for (const clip of timelineState.clips) {
                    if (clip.soloAudio || clip.muteNarration) {
                        const muteStart = Math.max(0, clip.startTime);
                        const muteEnd = Math.max(muteStart, clip.endTime);
                        g.gain.setValueAtTime(1.0, Math.max(0, muteStart - FADE_SEC));
                        g.gain.linearRampToValueAtTime(0.0, muteStart);
                        g.gain.setValueAtTime(0.0, Math.max(muteStart, muteEnd - FADE_SEC));
                        g.gain.linearRampToValueAtTime(1.0, muteEnd);
                    }
                }
            });
        } else {
            await mixInNative(voiceBus, timelineState.masterAudioBuffer, 0, false);
        }
    }

    const rawSpeechBlocks = calculateSpeechIntervals(exportDuration);
    // Coalesce speech blocks separated by < 1.25s so BGM doesnt pump during natural breath pauses
    const MIN_SWELL_GAP = 1.25;
    const speechBlocks: Array<{ start: number; end: number }> = [];
    for (const b of rawSpeechBlocks) {
        const last = speechBlocks[speechBlocks.length - 1];
        if (last && b.start - last.end < MIN_SWELL_GAP) {
            last.end = Math.max(last.end, b.end);
        } else {
            speechBlocks.push({ start: b.start, end: b.end });
        }
    }

    const applyDucking = (gainNode: GainNode, baseVolume: number, duckRatio: number = 0.22) => {
        const DUCK_VOL = baseVolume * duckRatio;
        const ATTACK_RAMP = 0.25; // Duck slightly before voice enters
        const RELEASE_RAMP = 0.55; // Smooth, musical swell after voice finishes
        gainNode.gain.setValueAtTime(baseVolume, 0);
        for (const b of speechBlocks) {
            const start = Math.max(0, b.start);
            const end = Math.min(exportDuration, b.end);
            if (end <= 0 || start >= exportDuration) continue;
            const rampDownStart = Math.max(0, start - ATTACK_RAMP);
            gainNode.gain.setValueAtTime(baseVolume, rampDownStart);
            gainNode.gain.linearRampToValueAtTime(DUCK_VOL, start);
            gainNode.gain.setValueAtTime(DUCK_VOL, end);
            const rampUpEnd = Math.min(exportDuration, end + RELEASE_RAMP);
            gainNode.gain.linearRampToValueAtTime(baseVolume, rampUpEnd);
        }
    };

    for (const clip of timelineState.clips) {
        if (clip._sfxBuffer && !timelineState.isTrackHidden('sfx')) {
            await mixInNative(sfxBus, clip._sfxBuffer, clip.startTime, false);
        }
        
        if ((clip.useOriginalAudio || clip.soloAudio) && (clip.video_id || clip.secondary_video_id)) {
            try {
                const targetVidId = clip.video_id || clip.secondary_video_id;
                const assetBlob = await assetStorage.getAsset(targetVidId);
                if (assetBlob) {
                    const native = await utils.safeDecode(utils.getAudioContext(), await assetBlob.arrayBuffer());
                    const offset = timelineState.mode === 'audio_locked' ? clip.startTime : ((clip as any)._legacyCursor || clip.startTime);
                    const clipVol = (clip as any).volume ?? 1.0;
                    const fadeIn = clip.fadeIn ?? 0;
                    const fadeOut = clip.fadeOut ?? 0;
                    const rate = clip.playbackRate && !clip.wordTimestamps?.length ? clip.playbackRate : 1;
                    const effectiveFadeIn = fadeIn > 0 ? Math.min(fadeIn, Math.max(0.01, clip.duration / 2)) : 0.05;
                    const effectiveFadeOut = fadeOut > 0 ? Math.min(fadeOut, Math.max(0.01, clip.duration / 2)) : 0;
                    const shouldDuck = state.audioDuckingEnabled !== false && (clip as any).audioDuckingOverride !== false && speechBlocks.length > 0 && !!timelineState.masterAudioBuffer;
                    const shouldLoop = (clip as any).loop !== false && (native.duration < (clip.duration * rate));

                    let audioBuf = native;
                    let effectivePlaybackRate = rate;
                    if (rate !== 1 && getExportFlags().useWsolaPitchStretch) {
                        audioBuf = stretchAudioBufferPreservePitch(native, rate);
                        effectivePlaybackRate = 1.0;
                    }

                    await mixInNative(clipsBus, audioBuf, offset, shouldLoop, (g) => {
                        if (shouldDuck) {
                            applyDucking(g, clipVol, 0.25);
                        } else {
                            const startInCtx = offset;
                            const endInCtx = offset + clip.duration;
                            g.gain.setValueAtTime(0, Math.max(0, startInCtx));
                            g.gain.linearRampToValueAtTime(clipVol, Math.max(0, startInCtx + effectiveFadeIn));
                            if (effectiveFadeOut > 0) {
                                g.gain.setValueAtTime(clipVol, Math.max(0, endInCtx - effectiveFadeOut));
                                g.gain.linearRampToValueAtTime(0, Math.max(0, endInCtx));
                            } else {
                                g.gain.setValueAtTime(clipVol, Math.max(0, endInCtx));
                            }
                        }
                    }, clip.videoStartOffset || 0, clip.duration * rate, effectivePlaybackRate);
                }
            } catch (e) {
                console.warn(`[Export] Could not mix native audio for clip ${clip.id}:`, e);
            }
        }
    }

    // Mix in timeline SFX cues from timelineState.graphics if SFX track is active
    if (!timelineState.isTrackHidden('sfx')) {
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
                        await mixInNative(sfxBus, customBuf, cue.start || 0, false);
                    }
                } catch (e) {
                    console.warn(`[Export] Failed to mix custom SFX cue at ${cue.start}:`, e);
                }
            } else if (sfxType && sfxType !== 'none') {
                try {
                    const sfxBuf = await audioSynthesizer.synthesizeSfxBuffer(sfxType, 0.6);
                    if (sfxBuf) {
                        await mixInNative(sfxBus, sfxBuf, cue.start || 0, false);
                    }
                } catch (e) {
                    console.warn(`[Export] Failed to synthesize SFX ${sfxType} at ${cue.start}:`, e);
                }
            }
        }
    }

    if (!skipBGM && state._bgAudioBuffer) {
        const baseVolume = state.bgAudioVolume ?? 0.3;
        const shouldDuck = state.audioDuckingEnabled !== false && speechBlocks.length > 0;
        await mixInNative(bgmBus, state._bgAudioBuffer, 0, true, (gainNode) => {
            if (shouldDuck) {
                applyDucking(gainNode, baseVolume, 0.2);
            } else {
                gainNode.gain.setValueAtTime(baseVolume, 0);
            }
        });
    }

    const rendered = await offlineCtx.startRendering();
    return softClipAudioBuffer(rendered);
}
