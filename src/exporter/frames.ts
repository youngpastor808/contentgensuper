/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import { timelineState } from '../state-timeline';
import { videoRenderContext, drawVideoFrame, drawExportOverlayLayer } from '../videoRenderer';
import { startExportStage, endExportStage } from './export-profiler';
import {
  isSequentialVideoExportEnabled,
  getOrCreateExportFrameSource,
  recordHtmlSeek,
  seekMidFrameSeconds,
  type VideoSlotRole,
} from './video-frame-source';


/*
 * Static-clip cache: an image-only clip with no camera move and no subtitles
 * shows the same pixels for its whole duration, so compositing it 30x/sec is
 * wasted CPU. Render it once per clip; reuse the bitmap for every later frame.
 *
 * CAVEATS (why the guards exist):
 *  - Subtitles are word-timed and change during a clip → skip when enabled.
 *  - cameraMovement/props change per frame → skip.
 *  - Talking-head/uploaded video overlays change per frame → their clips are
 *    never static anyway (they have videoElements, not image).
 * Memory: one bitmap per static clip, kept only for the current export
 * (cleared in the finally block via clearStaticFrameCache()).
 */
export const MAX_STATIC_FRAME_CACHE = 8;

export const _staticFrameCache = new Map<string, { w: number; h: number; bitmap: HTMLCanvasElement | OffscreenCanvas }>();
export const _staticCompositeCache = new Map<string, { w: number; h: number; bitmap: HTMLCanvasElement | OffscreenCanvas }>();

let _activeClipCursor = 0;

export function resetExportClipCursor() {
    _activeClipCursor = 0;
}

export function clearStaticFrameCache() {
    for (const entry of _staticFrameCache.values()) {
        if (entry.bitmap instanceof HTMLCanvasElement) {
            entry.bitmap.width = 0;
            entry.bitmap.height = 0;
        }
    }
    _staticFrameCache.clear();

    for (const entry of _staticCompositeCache.values()) {
        if (entry.bitmap instanceof HTMLCanvasElement) {
            entry.bitmap.width = 0;
            entry.bitmap.height = 0;
        }
    }
    _staticCompositeCache.clear();
    resetExportClipCursor();
    try { getOrCreateExportFrameSource().dispose().catch(() => {}); } catch {}
}

/**
 * Fast O(1) amortized clip lookup cursor for sequential export rendering
 */
export function findClipAtExportTime(time: number, isAbs: boolean): { cur: any; nxt: any; tIn: number; clipIndex: number } | null {
    const clips = videoRenderContext?.clips || [];
    if (clips.length === 0) return null;

    if (_activeClipCursor < 0 || _activeClipCursor >= clips.length) {
        _activeClipCursor = 0;
    }

    if (isAbs) {
        // Step forward if time is past current clip
        while (_activeClipCursor < clips.length - 1) {
            const end = isNum(clips[_activeClipCursor].endTime)
                ? clips[_activeClipCursor].endTime
                : ((clips[_activeClipCursor].startTime ?? 0) + clips[_activeClipCursor].duration);
            if (time >= end) {
                _activeClipCursor++;
            } else {
                break;
            }
        }
        // Step backward if time jumped back (e.g. segment seek)
        while (_activeClipCursor > 0) {
            const start = clips[_activeClipCursor].startTime ?? 0;
            if (time < start) {
                _activeClipCursor--;
            } else {
                break;
            }
        }

        const curClip = clips[_activeClipCursor];
        const s = curClip.startTime ?? 0;
        const en = isNum(curClip.endTime) ? curClip.endTime : (s + curClip.duration);
        if (time >= s && time < en) {
            return { cur: curClip, nxt: clips[_activeClipCursor + 1] || null, tIn: time - s, clipIndex: _activeClipCursor };
        }

        // Check for gap or past end
        if (time >= en) {
            return { cur: curClip, nxt: clips[_activeClipCursor + 1] || null, tIn: Math.max(0, (en - s) - 1e-3), clipIndex: _activeClipCursor };
        }

        // Full search fallback
        for (let i = 0; i < clips.length; i++) {
            const cs = clips[i].startTime ?? 0;
            const cen = isNum(clips[i].endTime) ? clips[i].endTime : (cs + clips[i].duration);
            if (time >= cs && time < cen) {
                _activeClipCursor = i;
                return { cur: clips[i], nxt: clips[i + 1] || null, tIn: time - cs, clipIndex: i };
            }
        }
    } else {
        let cum = 0;
        for (let i = 0; i < _activeClipCursor; i++) cum += clips[i].duration;

        while (_activeClipCursor < clips.length - 1 && time >= cum + clips[_activeClipCursor].duration) {
            cum += clips[_activeClipCursor].duration;
            _activeClipCursor++;
        }
        while (_activeClipCursor > 0 && time < cum) {
            _activeClipCursor--;
            cum -= clips[_activeClipCursor].duration;
        }

        const curClip = clips[_activeClipCursor];
        if (time >= cum && time < cum + curClip.duration) {
            return { cur: curClip, nxt: clips[_activeClipCursor + 1] || null, tIn: time - cum, clipIndex: _activeClipCursor };
        }

        cum = 0;
        for (let i = 0; i < clips.length; i++) {
            if (time >= cum && time < cum + clips[i].duration) {
                _activeClipCursor = i;
                return { cur: clips[i], nxt: clips[i + 1] || null, tIn: time - cum, clipIndex: i };
            }
            cum += clips[i].duration;
        }
    }

    if (clips.length > 0) {
        const last = clips[clips.length - 1];
        const s = isAbs ? (last.startTime ?? 0) : 0;
        const en = isAbs ? (isNum(last.endTime) ? last.endTime : s + last.duration) : last.duration;
        return { cur: last, nxt: null, tIn: Math.max(0.001, en - s), clipIndex: clips.length - 1 };
    }

    return null;
}

export function isStaticBackgroundClip(clip: any): boolean {
    if (!clip || (!clip.image && !clip.backgroundPlate && !clip._exportOptimizedImage)) return false;
    if (clip.videoElement || clip.talkingHeadVideoElement) return false;
    // A floating pop-up PiP card is itself an overlay entity, not a background plate
    if (clip.displayMode === 'pip_overlay') return false;
    const thV = state.uploadedVideoElement;
    const thMode = clip.talkingHeadMode || (thV ? (state.talkingHeadDefaultMode || 'none') : 'none');
    if (thV && (thMode === 'full' || thMode === 'split')) return false;
    if (clip.cameraMovement && clip.cameraMovement !== 'none' && clip.cameraMovement !== 'static') return false;
    if (clip._animation || clip.kenBurns) return false;
    if (timelineState.videoEffects && Object.values(timelineState.videoEffects).some((v: any) => (typeof v === 'number' ? v > 0.01 : v !== 'none' && v !== 'normal' && v !== false))) {
        return false; // time-varying global FX (rain, sparkles…)
    }
    return true;
}

export async function drawExportFrameCached(time: number, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const isAbs = timelineState.mode === 'audio_locked';
    const match = findClipAtExportTime(time, isAbs);

    if (!match || !match.cur || !isStaticBackgroundClip(match.cur)) {
        drawVideoFrame(time, canvas, ctx);
        return;
    }

    const { cur, tIn } = match;
    const curLen = Math.max(0.001, (isAbs && isNum(cur.endTime)) ? (cur.endTime - cur.startTime) : cur.duration);
    const prog = Math.min(1, tIn / curLen);

    // 1. Subtitle animation guard: untimed subtitles with active text must be drawn fresh per frame
    const hasSubtitles = (timelineState.showSubtitles ?? true) && Boolean(cur.text && cur.text.trim().length > 0);
    const hasWordTimestamps = Array.isArray(cur.wordTimestamps) && cur.wordTimestamps.length > 0;
    const hasUntimedSubtitle = hasSubtitles && !hasWordTimestamps;

    // 2. PiP Animation / Video guard
    const activePipClip = timelineState.clips?.find((c: any) => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
    let hasDynamicPiP = Boolean(
        (cur.talkingHeadMode && cur.talkingHeadMode.startsWith('pip') && (cur.talkingHeadVideoElement || state.uploadedVideoElement))
    );

    if (activePipClip) {
        const hasPipVideo = Boolean(activePipClip.videoElement || activePipClip.talkingHeadVideoElement);
        if (hasPipVideo) {
            hasDynamicPiP = true;
        } else {
            // Image PiP: only dynamic during entrance (0.4s) and exit (0.35s)
            const pipStart = activePipClip.startTime || 0;
            const pipEnd = isNum(activePipClip.endTime) ? activePipClip.endTime : (pipStart + (activePipClip.duration || 3.0));
            const pipDur = Math.max(0.001, pipEnd - pipStart);
            const timeInPip = time - pipStart;
            const timeLeftInPip = pipEnd - time;
            const enterDur = Math.min(0.4, pipDur * 0.25);
            const exitDur = Math.min(0.35, pipDur * 0.25);
            const isAnimating = (timeInPip < enterDur || timeLeftInPip < exitDur) && activePipClip.pipAnimation && activePipClip.pipAnimation !== 'none';
            if (isAnimating) {
                hasDynamicPiP = true;
            }
        }
    }

    // 3. Motion graphics animation guard
    const hasActiveGraphics = (timelineState.graphics || []).some((g: any) => time >= g.start && time < g.end);

    // 4. Global time-varying video FX
    const hasTimeVaryingFx = Boolean(
        timelineState.videoEffects && Object.values(timelineState.videoEffects).some((v: any) =>
            (typeof v === 'number' ? v > 0.01 : v !== 'none' && v !== 'normal' && v !== false)
        )
    );

    // 5. Active shot transition window
    const isTransitioning = Boolean(cur._transitionStart && time >= cur._transitionStart && time < cur._transitionEnd);

    // Subtitle active word index (or -1 if outside timestamps)
    let wordIdx = -1;
    if (hasWordTimestamps) {
        wordIdx = cur.wordTimestamps.findIndex((w: any) => time >= w.start && time < w.end);
    }

    const canUseCompositeCache = !isTransitioning && !hasDynamicPiP && !hasActiveGraphics && !hasUntimedSubtitle && !hasTimeVaryingFx;
    const compositeKey = `${cur.id || 'c'}-w${wordIdx}`;

    if (canUseCompositeCache) {
        const cachedFull = _staticCompositeCache.get(compositeKey);
        if (cachedFull && cachedFull.w === canvas.width && cachedFull.h === canvas.height) {
            _staticCompositeCache.delete(compositeKey);
            _staticCompositeCache.set(compositeKey, cachedFull);
            ctx.drawImage(cachedFull.bitmap as any, 0, 0, canvas.width, canvas.height);
            return;
        }
    }

    // Tier 1: Background Plate Cache
    const bgKey = cur.id || `${cur.image?.src || 'img'}-${cur.startTime}-${cur.duration}`;
    let cachedBg = _staticFrameCache.get(bgKey);
    if (cachedBg && (cachedBg.w !== canvas.width || cachedBg.h !== canvas.height)) {
        if (cachedBg.bitmap instanceof HTMLCanvasElement) {
            cachedBg.bitmap.width = 0;
            cachedBg.bitmap.height = 0;
        }
        _staticFrameCache.delete(bgKey);
        cachedBg = undefined;
    }

    if (cachedBg) {
        _staticFrameCache.delete(bgKey);
        _staticFrameCache.set(bgKey, cachedBg);
    } else {
        const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvas.width, canvas.height) : document.createElement('canvas');
        if (off instanceof HTMLCanvasElement) { off.width = canvas.width; off.height = canvas.height; }
        const octx = off.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: false });
        if (!octx) { drawVideoFrame(time, canvas, ctx); return; }
        
        drawVideoFrame(time, off, octx, { backgroundOnly: true });

        while (_staticFrameCache.size >= MAX_STATIC_FRAME_CACHE) {
            const oldestKey = _staticFrameCache.keys().next().value;
            if (oldestKey === undefined) break;
            const oldEntry = _staticFrameCache.get(oldestKey);
            if (oldEntry?.bitmap instanceof HTMLCanvasElement) {
                oldEntry.bitmap.width = 0;
                oldEntry.bitmap.height = 0;
            }
            _staticFrameCache.delete(oldestKey);
        }

        _staticFrameCache.set(bgKey, { w: canvas.width, h: canvas.height, bitmap: off });
        cachedBg = _staticFrameCache.get(bgKey)!;
    }

    ctx.drawImage(cachedBg.bitmap as any, 0, 0, canvas.width, canvas.height);

    // Draw dynamic overlay layer on top of cached background
    drawExportOverlayLayer(time, cur, canvas.width, canvas.height, prog, ctx, canvas);

    // Cache the fully composited frame for subsequent ticks with identical word/overlays
    if (canUseCompositeCache) {
        const fullOff = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(canvas.width, canvas.height) : document.createElement('canvas');
        if (fullOff instanceof HTMLCanvasElement) { fullOff.width = canvas.width; fullOff.height = canvas.height; }
        const fullCtx = fullOff.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: false });
        if (fullCtx) {
            fullCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
            while (_staticCompositeCache.size >= MAX_STATIC_FRAME_CACHE) {
                const oldestKey = _staticCompositeCache.keys().next().value;
                if (oldestKey === undefined) break;
                const oldEntry = _staticCompositeCache.get(oldestKey);
                if (oldEntry?.bitmap instanceof HTMLCanvasElement) {
                    oldEntry.bitmap.width = 0;
                    oldEntry.bitmap.height = 0;
                }
                _staticCompositeCache.delete(oldestKey);
            }
            _staticCompositeCache.set(compositeKey, { w: canvas.width, h: canvas.height, bitmap: fullOff });
        }
    }
}


export const yieldToMain = () => new Promise(resolve => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = resolve;
    port2.postMessage(null);
});


export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);


async function syncClipVideoSlot(
  clip: any,
  role: VideoSlotRole,
  videoEl: HTMLVideoElement | undefined,
  targetSourceTime: number,
  shouldLoop: boolean,
  activeCursorKeys: Set<string>,
  fps: number = 30,
  exportHeight?: number
): Promise<void> {
  if (!videoEl) return;

  const propName =
    role === 'talkingHead'
      ? '_exportTalkingHeadFrame'
      : role === 'secondary'
        ? '_exportSecondaryFrame'
        : '_exportVideoFrame';

  const clipId = String(clip.id || clip.shot_number || 'clip');
  const cursorKey = `${clipId}::${role}`;
  activeCursorKeys.add(cursorKey);

  if (isSequentialVideoExportEnabled()) {
    const maxDecodeHeight = exportHeight ? Math.min(2160, Math.round(exportHeight * 1.25)) : 2160;
    const frameSource = getOrCreateExportFrameSource(maxDecodeHeight);
    const decodedFrame = await frameSource.getFrameForClipSlot(
      clipId,
      role,
      videoEl,
      targetSourceTime,
      shouldLoop
    );
    if (decodedFrame) {
      clip[propName] = decodedFrame;
      return;
    }
    // Fallback to HTMLVideoElement if sequential decode returned null
    delete clip[propName];
  } else {
    delete clip[propName];
  }

  await syncVideoToTime(videoEl, targetSourceTime, fps);
}

export async function syncVideosForExportTime(rawTime: number, fps: number = 30, exportHeight?: number): Promise<void> {
    const time = seekMidFrameSeconds(rawTime, fps);
    startExportStage('video-sync');
    const activeCursorKeys = new Set<string>();
    try {
        if (!videoRenderContext || videoRenderContext.clips.length === 0) return;
        const { clips, totalDuration } = videoRenderContext;
        const isAbs = timelineState.mode === 'audio_locked';

        const match = findClipAtExportTime(time, isAbs);
        let cur: any = match?.cur || null;
        let nxt: any = match?.nxt || null;
        let tIn = match?.tIn || 0;

        if (!cur) {
            if (time >= totalDuration - 0.1 && clips.length > 0) {
                cur = clips[clips.length - 1];
                tIn = Math.max(0.001, (isAbs && isNum(cur.endTime) && isNum(cur.startTime)) ? cur.endTime - cur.startTime : cur.duration);
            } else {
                return;
            }
        }

        const curLen = Math.max(0.001, (isAbs && isNum(cur.endTime)) ? (cur.endTime - cur.startTime) : cur.duration);
        const prog = Math.min(1, tIn / curLen);
        
        let wantsTransition = false;
        let resolvedTransition = cur.transitionToNext || 'cut';
        const globalStyle = timelineState.videoTransitionStyle || 'narrative_guided';
        if (globalStyle !== 'narrative_guided' && globalStyle !== 'ai_directed') {
            resolvedTransition = globalStyle;
        }
        const tType = resolvedTransition.replace(/_/g, '').toLowerCase();
        wantsTransition = Boolean(nxt && tType !== 'cut');

        let isTrans = false;
        if (wantsTransition && nxt && typeof cur._transitionStart === 'number' && typeof cur._transitionEnd === 'number') {
            if (time >= cur._transitionStart && time < cur._transitionEnd) {
                isTrans = true;
            }
        }

        const promises: Promise<void>[] = [];
        const syncedVideos = new Set<HTMLVideoElement>();

        if (cur.videoElement) {
            const isMaster = (cur.videoElement === state.uploadedVideoElement) ||
                             (cur.talkingHeadVideoElement === cur.videoElement) ||
                             (!cur._videoObjectURL && !!state.uploadedVideoElement) ||
                             (cur._videoObjectURL && state.uploadedVideoElement && cur._videoObjectURL === state.uploadedVideoElement.src);
            const offset = (isMaster && (!cur.videoStartOffset || cur.videoStartOffset === 0))
                ? (cur.startTime || 0)
                : (cur.videoStartOffset || 0);
            const rate = cur.playbackRate && !cur.wordTimestamps?.length ? cur.playbackRate : 1;
            let targetTime = offset + (tIn * rate);
            
            const mediaDur = cur.videoElement.duration;
            const shouldLoop = Boolean(Number.isFinite(mediaDur) && mediaDur > 0 && targetTime > mediaDur);
            if (shouldLoop) {
                targetTime = Math.min(mediaDur - 0.03, targetTime % mediaDur || mediaDur - 0.03); // clamp/loop at end
            }

            if (!syncedVideos.has(cur.videoElement)) {
                promises.push(syncClipVideoSlot(cur, 'primary', cur.videoElement, targetTime, shouldLoop, activeCursorKeys, fps, exportHeight));
                syncedVideos.add(cur.videoElement);
            }
        }

        if (nxt && nxt.videoElement && isTrans) {
            // nxt video is rendered at progress 0 during transitions in drawVideoFrame
            const isMasterNxt = (nxt.videoElement === state.uploadedVideoElement) ||
                                (nxt.talkingHeadVideoElement === nxt.videoElement) ||
                                (!nxt._videoObjectURL && !!state.uploadedVideoElement) ||
                                (nxt._videoObjectURL && state.uploadedVideoElement && nxt._videoObjectURL === state.uploadedVideoElement.src);
            const nxtOffset = (isMasterNxt && (!nxt.videoStartOffset || nxt.videoStartOffset === 0))
                ? (nxt.startTime || 0)
                : (nxt.videoStartOffset || 0);
            if (!syncedVideos.has(nxt.videoElement)) {
                promises.push(syncClipVideoSlot(nxt, 'primary', nxt.videoElement, nxtOffset, false, activeCursorKeys, fps, exportHeight));
                syncedVideos.add(nxt.videoElement);
            }
        }

        const thMode = cur.talkingHeadMode || (state.uploadedVideoElement ? (state.talkingHeadDefaultMode || 'none') : 'none');
        const isTransTH = Boolean(nxt && isTrans && (nxt.talkingHeadMode || state.uploadedVideoElement));
        const activePipOverlayClip = timelineState.clips.find((c: any) => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
        const thVisible = (thMode && thMode !== 'none' && (!activePipOverlayClip || thMode === 'full' || thMode === 'split')) || isTransTH;

        const thVideo = cur.talkingHeadVideoElement || (nxt && isTrans ? nxt.talkingHeadVideoElement : null) || (thVisible ? state.uploadedVideoElement : null);
        if (thVideo && thVisible && !syncedVideos.has(thVideo)) {
            // the active clip defines the offset for the talking head video
            const activeClip = cur.talkingHeadVideoElement ? cur : (nxt && isTrans && nxt.talkingHeadVideoElement ? nxt : cur);
            const isMasterTH = (thVideo === state.uploadedVideoElement) ||
                               (activeClip.talkingHeadVideoElement === thVideo) ||
                               (!activeClip._videoObjectURL && !!state.uploadedVideoElement) ||
                               (activeClip._videoObjectURL && state.uploadedVideoElement && activeClip._videoObjectURL === state.uploadedVideoElement.src);
            const offset = (isMasterTH && (!activeClip.videoStartOffset || activeClip.videoStartOffset === 0))
                ? (activeClip.startTime || 0)
                : (activeClip.videoStartOffset || 0);
            let targetTime = offset + (time - (activeClip.startTime || 0));
            const d = thVideo.duration;
            const shouldLoop = Boolean(Number.isFinite(d) && d > 0 && targetTime > d);
            if (shouldLoop) {
                targetTime = ((targetTime % d) + d) % d;
            }

            promises.push(syncClipVideoSlot(activeClip, 'talkingHead', thVideo, targetTime, shouldLoop, activeCursorKeys, fps, exportHeight));
            syncedVideos.add(thVideo);
        }

        // Sync any active pop-up B-roll video overlay that is playing at this time
        const activePipClips = timelineState.clips.filter((c: any) => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
        for (const pipC of activePipClips) {
            const pipMedia = pipC.videoElement || pipC.talkingHeadVideoElement;
            if (pipMedia && !syncedVideos.has(pipMedia)) {
                const pipOffset = pipC.videoStartOffset || 0;
                const pipTimeIn = time - (pipC.startTime || 0);
                let targetPipTime = pipOffset + pipTimeIn;
                const d = pipMedia.duration;
                const shouldLoop = Boolean(Number.isFinite(d) && d > 0 && targetPipTime > d);
                if (shouldLoop) {
                    targetPipTime = ((targetPipTime % d) + d) % d;
                }

                promises.push(syncClipVideoSlot(pipC, 'secondary', pipMedia, targetPipTime, shouldLoop, activeCursorKeys, fps, exportHeight));
                syncedVideos.add(pipMedia);
            }
        }

        if (promises.length > 0) {
            await Promise.all(promises);
        }

        if (isSequentialVideoExportEnabled()) {
            const maxDecodeH = exportHeight ? Math.min(2160, Math.round(exportHeight * 1.25)) : 2160;
            await getOrCreateExportFrameSource(maxDecodeH).retainOnlyActiveCursors(activeCursorKeys);
        }
    } finally {
        endExportStage('video-sync');
    }
}


export async function syncVideoToTime(video: HTMLVideoElement, time: number, fps: number = 30): Promise<void> {
    if (video.muted !== true) video.muted = true;
    if (!video.paused) {
        try { video.pause(); } catch (e) { }
    }

    // A frame-aware seek path: only seek when the distance is larger than half a frame (0.5 / fps)
    // to eliminate redundant seeks on consecutive frames that fall into the same video frame.
    const frameTolerance = 0.5 / fps;
    const needsSeek = Math.abs(video.currentTime - time) > frameTolerance;
    const needsData = video.readyState < 2; // HAVE_CURRENT_DATA

    if (needsSeek || needsData) {
        return new Promise<void>((resolve) => {
            let resolved = false;
            let timedOut = false;
            let timer: any = null;
            const cleanup = () => {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                video.removeEventListener('seeked', onReady);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('canplay', onReady);
                video.removeEventListener('error', onError);
                recordHtmlSeek(timedOut);
                resolve();
            };
            const onReady = () => {
                if (video.seeking) return;
                // Allow decoder pipeline a microtask tick to finalize texture presentation
                queueMicrotask(cleanup);
            };
            const onError = () => {
                console.warn('Video export seek error', video.error);
                cleanup();
            };

            video.addEventListener('seeked', onReady);
            video.addEventListener('loadeddata', onReady);
            video.addEventListener('canplay', onReady);
            video.addEventListener('error', onError);

            try {
                video.currentTime = time;
            } catch (err) {
                cleanup();
            }

            // High timeout. Export frames *must* be accurate. If a seek takes
            // longer than 4000ms, aborting it early will cause a visual glitch.
            timer = setTimeout(() => {
                timedOut = true;
                cleanup();
            }, 4000);
        });
    }
}
