import { getPixelsPerSecond } from './utils-core';
import { registerUpdateVideoContext } from './videoContextBridge';
import { t0, t1, tv } from './perfMonitor';
import { ActiveClipIndex } from './activeClipIndex';
import { markInteraction, scheduleFullQualityRedraw } from './interaction';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from './state';
import { SubtitleEngine } from './subtitle-engine';
import { timelineState, calculateSpeechIntervals } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import * as utils from './utils';
import { videoRenderContext, setVideoRenderContext, drawVideoFrame } from './videoRenderer';
import { fetchAndPopulateVoices } from './audioPipeline';
import { sliceAudioBuffer, spliceAudioBuffer } from './audioBufferUtils';
import { invalidateSpectrumCache } from './graphics-engine';
import { saveVersion } from './projectVersioning';
import { sliceTranscriptForShots } from './timelineBuilder';
import { openGraphicEditor } from './handlers-graphics';
import { forceAlignAudio } from './api/audio';
import { assetStorage } from './assetStorage';
import { DB } from './db';
import { APP_STATE_STORE } from './constants';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type TimelineClip = {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  wordTimestamps?: any[];
  videoElement?: HTMLVideoElement;
  [k: string]: any;
};

let isDraggingClip = false;
let draggedClipId: string | null = null;

const narrationIndex = new ActiveClipIndex();
let lastLoopTimestamp = 0;

let tlMoveRaf = 0;
let tlMoveEvt: MouseEvent | null = null;
let dragOverlayEl: HTMLElement | null = null;

function onTimelineMouseMove(e: MouseEvent) {
  tlMoveEvt = e;
  if (tlMoveRaf) return;
  tlMoveRaf = requestAnimationFrame(() => {
    tlMoveRaf = 0;
    const ev = tlMoveEvt;
    tlMoveEvt = null;
    if (ev) handleTimelineMouseMove(ev);
  });
}

function flushTimelineMove() {
  if (tlMoveRaf) {
    cancelAnimationFrame(tlMoveRaf);
    tlMoveRaf = 0;
  }
  if (tlMoveEvt) {
    const ev = tlMoveEvt;
    tlMoveEvt = null;
    handleTimelineMouseMove(ev);
  }
}

let isResizingClip = false;
let resizedClipId: string | null = null;
let resizeEdge: 'left' | 'right' | null = null;
let resizeStartX = 0;
let originalStartTimes: number[] = [];
let originalEndTimes: number[] = [];
let originalVideoStartOffsets: number[] = [];
let timelineContainerRect: DOMRect | null = null;
let hasTimelineDragged = false;
let timelineClickStartX = 0;

let isDraggingOverlay = false;
let isResizingOverlay = false;
let activeOverlayId: string | null = null;
let overlayDragStartX = 0;
let overlayOriginalStart = 0;
let overlayOriginalEnd = 0;
let overlayOriginalStartOffset = 0;
let overlayResizeEdge: 'left' | 'right' | null = null;

let lastDrawTime = 0;
const DRAW_THROTTLE = 16; // ~60fps
const SNAP_THRESHOLD_SECONDS = 0.01;
let cachedClipElements = new Map<string, HTMLElement>();

function ensureClipIds() {
  for (let i = 0; i < (timelineState.clips?.length || 0); i++) {
    const c = timelineState.clips[i] as TimelineClip;
    if (!c.id) c.id = `clip_${i}_${Math.random().toString(16).slice(2)}`;
  }
}

function getSortedTimeline(): TimelineClip[] {
  ensureClipIds();
  return [...(timelineState.clips as TimelineClip[])].sort((a, b) => {
    const sa = isNum(a.startTime) ? a.startTime : 0;
    const sb = isNum(b.startTime) ? b.startTime : 0;
    if (sa !== sb) return sa - sb;
    return (a.id || '').localeCompare(b.id || '');
  });
}

function findClipById(id: string): TimelineClip | null {
  const arr = timelineState.clips as TimelineClip[];
  return arr.find(c => c.id === id) || null;
}

function getClipIdFromEventTarget(target: HTMLElement): string | null {
  const clipEl = target.closest('.timeline-clip') as HTMLElement | null;
  if (!clipEl) return null;
  return clipEl.dataset.clipId || null;
}

export function getTimelineSnapPoints(): number[] {
  const points = new Set<number>();
  points.add(0);
  if (videoRenderContext?.totalDuration) {
    points.add(videoRenderContext.totalDuration);
  }
  if (typeof state.videoPauseTime === 'number' && state.videoPauseTime >= 0) {
    points.add(state.videoPauseTime);
  }
  if (Array.isArray(timelineState.clips)) {
    for (const c of (timelineState.clips as TimelineClip[])) {
      if (typeof c.startTime === 'number') points.add(c.startTime);
      if (typeof c.endTime === 'number') points.add(c.endTime);
    }
  }
  if (Array.isArray(timelineState.graphics)) {
    for (const g of timelineState.graphics) {
      if (typeof g.start === 'number') points.add(g.start);
      if (typeof g.end === 'number') points.add(g.end);
    }
  }
  if (Array.isArray(timelineState.timelineSnapPoints)) {
    for (const p of timelineState.timelineSnapPoints) {
      if (typeof p === 'number') points.add(p);
    }
  }
  if (Array.isArray(timelineState.globalWordTimestamps)) {
    for (const w of timelineState.globalWordTimestamps) {
      if (typeof w.start === 'number') points.add(w.start);
      if (typeof w.end === 'number') points.add(w.end);
    }
  }
  return Array.from(points).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
}

export function getSnappedTime(t: number, points?: number[] | null): number {
  if (!timelineState.snappingEnabled) return t;
  const snapList = points || getTimelineSnapPoints();
  if (!snapList || snapList.length === 0) return t;

  const pps = getPixelsPerSecond();
  const snapThreshold = Math.max(0.12, 10 / (pps || 50));
  let best = t;
  let minDiff = snapThreshold;

  for (const p of snapList) {
    const d = Math.abs(p - t);
    if (d < minDiff) {
      minDiff = d;
      best = p;
    }
  }
  return best;
}

export interface ResyncTimelineResult {
  driftBefore: number;
  driftAfter: number;
  fixedGaps: number;
  adjustedClips: number;
  audioDuration: number;
  visualDuration: number;
}

let isResyncing = false;

/**
 * Automatically reconciles the master audio buffer and video clips after any edit
 * to guarantee that zero synchronization drift occurs during playback, scrubbing, or exports.
 */
export function resyncTimeline(options: { notify?: boolean; reason?: string } = {}): ResyncTimelineResult {
  if (isResyncing) {
    return { driftBefore: 0, driftAfter: 0, fixedGaps: 0, adjustedClips: 0, audioDuration: 0, visualDuration: 0 };
  }
  isResyncing = true;
  try {
    const minDuration = 0.05;
    const audioDur = timelineState.masterAudioBuffer?.duration;
    const hasAudio = typeof audioDur === 'number' && Number.isFinite(audioDur) && audioDur > 0;
    const targetAudioDur = hasAudio ? audioDur : undefined;

    if (!timelineState.clips || timelineState.clips.length === 0) {
      return {
        driftBefore: 0,
        driftAfter: 0,
        fixedGaps: 0,
        adjustedClips: 0,
        audioDuration: targetAudioDur ?? 0,
        visualDuration: 0
      };
    }

    ensureClipIds();

    // Sort existing clips by startTime
    let sorted = [...timelineState.clips].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    const currentVisualEnd = sorted[sorted.length - 1]?.endTime ?? 0;
    const driftBefore = targetAudioDur !== undefined ? currentVisualEnd - targetAudioDur : 0;

    let fixedGaps = 0;
    let adjustedClips = 0;

    // Filter out any corrupt or near-zero duration clips (< 0.03s)
    const validClips: TimelineClip[] = [];
    for (const c of sorted) {
      if (!c) continue;
      const dur = typeof c.duration === 'number' ? c.duration : (c.endTime ?? 0) - (c.startTime ?? 0);
      if (dur < 0.03) {
        if (c._videoObjectURL) { try { URL.revokeObjectURL(c._videoObjectURL); } catch {} }
        adjustedClips++;
        continue;
      }
      validClips.push(c);
    }
    sorted = validClips;

    if (sorted.length === 0) {
      timelineState.setClips([]);
      updateVideoContext();
      return {
        driftBefore,
        driftAfter: 0,
        fixedGaps,
        adjustedClips,
        audioDuration: targetAudioDur ?? 0,
        visualDuration: 0
      };
    }

    // 1. Ensure clip 0 starts at 0
    if (Math.abs((sorted[0].startTime ?? 0) - 0) > 0.0001) {
      sorted[0].startTime = 0;
      fixedGaps++;
      adjustedClips++;
    }
    sorted[0].duration = Math.max(minDuration, sorted[0].duration || minDuration);
    sorted[0].endTime = sorted[0].startTime + sorted[0].duration;

    // 2. Reconcile sequential continuity across all adjacent clips (eliminate all micro-gaps and overlaps)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const expectedStart = prev.endTime;

      if (Math.abs((cur.startTime ?? 0) - expectedStart) > 0.0001) {
        cur.startTime = expectedStart;
        fixedGaps++;
        adjustedClips++;
      }

      cur.duration = Math.max(minDuration, Number.isFinite(cur.duration) ? cur.duration : minDuration);
      cur.endTime = cur.startTime + cur.duration;
    }

    // 3. Reconcile with Master Audio Buffer (if present)
    if (targetAudioDur !== undefined) {
      // If clips extend past audio duration, prune any clips starting beyond targetAudioDur - 0.03s
      const inBoundsClips: TimelineClip[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i];
        if (i > 0 && c.startTime >= targetAudioDur - 0.03) {
          if (c._videoObjectURL) { try { URL.revokeObjectURL(c._videoObjectURL); } catch {} }
          adjustedClips++;
          continue;
        }
        inBoundsClips.push(c);
      }
      sorted = inBoundsClips;

      // Adjust the final clip to end precisely at targetAudioDur
      const lastClip = sorted[sorted.length - 1];
      if (lastClip) {
        const prevEnd = sorted.length > 1 ? sorted[sorted.length - 2].endTime : 0;
        if (targetAudioDur > prevEnd + minDuration) {
          if (Math.abs(lastClip.endTime - targetAudioDur) > 0.0001) {
            lastClip.endTime = targetAudioDur;
            lastClip.duration = Math.max(minDuration, lastClip.endTime - lastClip.startTime);
            adjustedClips++;
          }
        } else {
          lastClip.endTime = Math.max(lastClip.startTime + minDuration, targetAudioDur);
          lastClip.duration = lastClip.endTime - lastClip.startTime;
        }
      }
      timelineState.bumpClipsVersion();
    }

    // 4. Validate and sanitize videoStartOffset for talking-head / A-roll synchronization
    for (const c of sorted) {
      if (c.videoStartOffset === undefined || !Number.isFinite(c.videoStartOffset) || c.videoStartOffset < 0) {
        c.videoStartOffset = 0;
      }
      if (c.videoElement && Number.isFinite(c.videoElement.duration) && c.videoElement.duration > 0) {
        if (c.videoStartOffset >= c.videoElement.duration) {
          c.videoStartOffset = c.videoStartOffset % c.videoElement.duration;
        }
      }
    }

    // 5. Reconcile Audio Splits
    if (timelineState.audioSplits && timelineState.audioSplits.length > 0 && targetAudioDur !== undefined) {
      const cleanSplits = Array.from(new Set(
        timelineState.audioSplits
          .filter(s => Number.isFinite(s) && s > 0.05 && s < targetAudioDur - 0.05)
          .map(s => Math.round(s * 1000) / 1000)
      )).sort((a, b) => a - b);
      if (cleanSplits.length !== timelineState.audioSplits.length) {
        timelineState.setAudioSplits(cleanSplits);
      }
    }

    // 6. Save reconciled clips into timelineState
    timelineState.setClips(sorted, false);

    // 7. Refresh word timestamps
    if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
      if (targetAudioDur !== undefined) {
        const cleanedWords = timelineState.globalWordTimestamps
          .filter((w: any) => w && Number.isFinite(w.start) && w.start < targetAudioDur)
          .map((w: any) => ({
            ...w,
            start: Math.max(0, Math.min(targetAudioDur, w.start)),
            end: Math.max(0.01, Math.min(targetAudioDur, w.end))
          }));
        timelineState.setGlobalWordTimestamps(cleanedWords);
      }
      refreshPerClipWordTimestamps();
    }

    // 8. Invalidate render/subtitle caches
    try { SubtitleEngine.clearBitmapCache(); } catch {}
    try { invalidateSpectrumCache(); } catch {}

    // 9. Full render context update
    updateVideoContext(true);

    const finalVisualEnd = sorted[sorted.length - 1]?.endTime ?? 0;
    const driftAfter = targetAudioDur !== undefined ? finalVisualEnd - targetAudioDur : 0;

    // 10. Clamp playhead if it was beyond the new total duration
    if (videoRenderContext && state.videoPauseTime > videoRenderContext.totalDuration) {
      state.videoPauseTime = Math.max(0, videoRenderContext.totalDuration);
    }

    // 11. UI notification if requested
    if (options.notify) {
      ui.renderTimelineEditor();
      if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
        ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
      }
      const msDriftBefore = Math.round(Math.abs(driftBefore) * 1000);
      const msDriftAfter = Math.round(Math.abs(driftAfter) * 1000);
      ui.showStatus(
        `Timeline resynced: drift reduced from ${msDriftBefore}ms to ${msDriftAfter}ms (${sorted.length} shots reconciled).`,
        false,
        2500
      );
    }

    return {
      driftBefore,
      driftAfter,
      fixedGaps,
      adjustedClips,
      audioDuration: targetAudioDur ?? 0,
      visualDuration: finalVisualEnd
    };
  } finally {
    isResyncing = false;
  }
}

export function handleResyncTimeline() {
  resyncTimeline({ notify: true, reason: 'user-action' });
}

export function normalizeTimeline(totalDuration?: number) {
  const audioDur = totalDuration ?? timelineState.masterAudioBuffer?.duration;
  const isLocked = timelineState.mode === 'audio_locked';
  
  let audioBufferSilences = null;
  if (isLocked && timelineState.masterAudioBuffer) {
      audioBufferSilences = timelineState.globalSilences ?? utils.detectSilences(timelineState.masterAudioBuffer);
      if (typeof timelineState.setGlobalSilences === 'function') {
          timelineState.setGlobalSilences(audioBufferSilences);
      } else {
          (timelineState as any).globalSilences = audioBufferSilences;
      }
  }

  const minDuration = 0.05;

  if (isLocked) {
    const limit = isNum(audioDur) ? audioDur : undefined;
    if (timelineState.clips.length > 0) {
      const sorted = getSortedTimeline();
      const first = findClipById(sorted[0].id);
      if (first) {
        first.startTime = 0;
      }
    }
    for (const c of timelineState.clips as TimelineClip[]) {
      if (!isNum(c.startTime)) c.startTime = 0;
      let end = isNum(c.endTime) ? c.endTime : c.startTime + (isNum(c.duration) ? c.duration : 2);

      if (isNum(limit)) {
        c.startTime = Math.max(0, Math.min(c.startTime, limit));
        end = Math.max(c.startTime + minDuration, Math.min(end, limit));
      } else {
        end = Math.max(c.startTime + minDuration, end);
      }
      c.endTime = end;
      c.duration = c.endTime - c.startTime;
    }

    if (isNum(audioDur) && timelineState.clips.length > 0) {
        const sorted = getSortedTimeline();
        const first = findClipById(sorted[0].id);
        if (first) {
            first.startTime = 0;
            first.endTime = Math.max(minDuration, Math.min(first.endTime, audioDur));
            first.duration = first.endTime - first.startTime;
        }
        for (let i = 0; i < sorted.length - 1; i++) {
            const a = findClipById(sorted[i].id);
            const b = findClipById(sorted[i + 1].id);
            if (!a || !b) continue;
            a.endTime = Math.min(a.endTime, audioDur);
            a.endTime = Math.max(a.startTime + minDuration, a.endTime);
            a.duration = a.endTime - a.startTime;
            if (b.startTime < a.endTime) {
                if (audioBufferSilences && audioBufferSilences.length > 0) {
                    const candidate = audioBufferSilences.find(
                        (s: any) => s && s.end >= a.endTime - 0.15 && s.start <= b.endTime + 1.5 && s.start >= a.startTime
                    );
                    if (candidate && candidate.start > a.startTime + minDuration * 2) {
                        b.startTime = Math.min(
                            candidate.start,
                            Math.max(b.startTime + minDuration, Math.min(b.endTime, audioDur))
                        );
                    } else {
                        b.startTime = a.endTime;
                    }
                } else {
                    b.startTime = a.endTime;
                }
                b.startTime = Math.max(0, Math.min(b.startTime, audioDur));
                b.endTime = Math.max(b.startTime + minDuration, Math.min(b.endTime, audioDur));
                b.duration = b.endTime - b.startTime;
            }
        }
        const last = findClipById(sorted[sorted.length - 1].id);
        if (last) {
            last.endTime = Math.max(last.startTime + minDuration, Math.min(last.endTime, audioDur));
            last.duration = last.endTime - last.startTime;
        }
    }
    timelineState.bumpClipsVersion();
  }

  // Run full reconciliation to guarantee zero gaps, zero overlaps, and zero sync drift
  resyncTimeline({ notify: false, reason: 'normalizeTimeline' });
}

export function refreshPerClipWordTimestamps() {
  if (!timelineState.globalWordTimestamps?.length) return;

  const sorted = getSortedTimeline();
  if (!sorted.length) return;
  const shotStarts = sorted.map(c => c.startTime);
  const totalDur = timelineState.masterAudioBuffer?.duration ?? (sorted[sorted.length - 1]?.endTime || 0);
  const perShot = sliceTranscriptForShots(shotStarts, timelineState.globalWordTimestamps, totalDur);

  for (let i = 0; i < sorted.length; i++) {
    const clip = findClipById(sorted[i].id);
    if (clip) clip.wordTimestamps = perShot[i] || [];
  }
}

let cachedDragSnapPoints: number[] | null = null;

export function handleTimelineMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const isLocked = timelineState.mode === 'audio_locked';

  // If clicking directly on an overlay/track action button, do not hijack with drag or selection re-render
  if (target.closest('.overlay-edit-btn, .overlay-delete-btn, .clip-edit-btn, .clip-delete-btn, .sfx-play-btn, .sfx-trim-btn, .sfx-split-btn, .delete-btn, .edit-btn, .snap-btn, .dup-btn, .up-btn, .down-btn, button')) {
    return;
  }

  hasTimelineDragged = false;
  timelineClickStartX = e.clientX;
  if (timelineState.snappingEnabled) {
    cachedDragSnapPoints = getTimelineSnapPoints();
  } else {
    cachedDragSnapPoints = null;
  }

  // Track 2 Overlays & B-Roll track interactions
  const overlayClip = target.closest('.timeline-overlay-clip') as HTMLElement;
  if (overlayClip) {
    const graphicId = overlayClip.dataset.graphicId;
    if (graphicId) {
      const ev = (timelineState.graphics || []).find(g => g.id === graphicId);
      if (ev) {
        activeOverlayId = graphicId;
        timelineState.setSelectedGraphicId(graphicId);
        overlayDragStartX = e.clientX;
        overlayOriginalStart = ev.start;
        overlayOriginalEnd = ev.end;
        overlayOriginalStartOffset = (ev as any).startOffset || 0;

        if (target.classList.contains('resize-handle')) {
          isResizingOverlay = true;
          overlayResizeEdge = target.classList.contains('left-handle') ? 'left' : 'right';
          document.body.style.cursor = 'col-resize';
        } else {
          isDraggingOverlay = true;
          document.body.style.cursor = 'grabbing';
        }
        dragOverlayEl = dom.timelineClipsContainer.querySelector(`[data-graphic-id="${activeOverlayId}"]`) as HTMLElement;
        document.addEventListener('mousemove', onTimelineMouseMove);
        document.addEventListener('mouseup', handleTimelineMouseUp);
        return;
      }
    }
  }

  const transBtn = target.closest('.timeline-transition-btn') as HTMLElement;
  if (transBtn) {
    const clipId = transBtn.dataset.clipId;
    const clipIndexStr = transBtn.dataset.clipIndex;
    const clipIndex = clipIndexStr ? parseInt(clipIndexStr, 10) : 0;
    if (clipId) {
      showTransitionPickerModal(clipId, clipIndex);
    }
    return;
  }

  const transZone = target.closest('.timeline-transition-zone') as HTMLElement;
  if (transZone) {
    const parentTrack = transZone.parentElement;
    const nextBtn = transZone.nextElementSibling as HTMLElement;
    const relatedBtn = (nextBtn && nextBtn.classList.contains('timeline-transition-btn'))
      ? nextBtn
      : (parentTrack?.querySelector(`button.timeline-transition-btn`) as HTMLElement);
    if (relatedBtn) {
      const clipId = relatedBtn.dataset.clipId;
      const clipIndexStr = relatedBtn.dataset.clipIndex;
      const clipIndex = clipIndexStr ? parseInt(clipIndexStr, 10) : 0;
      if (clipId) {
        showTransitionPickerModal(clipId, clipIndex);
      }
      return;
    }
  }

  if (target.classList.contains('resize-handle')) {
    const clipId = getClipIdFromEventTarget(target);
    if (!clipId || !videoRenderContext) return;

    resizedClipId = clipId;
    isResizingClip = true;
    resizeStartX = e.clientX;

    const track = dom.timelineClipsContainer.querySelector('.timeline-track');
    timelineContainerRect = track ? track.getBoundingClientRect() : dom.timelineClipsContainer.getBoundingClientRect();

    const sorted = getSortedTimeline();
    originalStartTimes = sorted.map(c => c.startTime);
    originalEndTimes = sorted.map(c => c.endTime);
    originalVideoStartOffsets = sorted.map(c => c.videoStartOffset || 0);
    resizeEdge = target.classList.contains('left-handle') ? 'left' : 'right';

    cachedClipElements.clear();
    sorted.forEach(clip => {
        const el = dom.timelineClipsContainer.querySelector(`[data-clip-id="${clip.id}"]`) as HTMLElement;
        if (el) cachedClipElements.set(clip.id, el);
    });

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onTimelineMouseMove);
    document.addEventListener('mouseup', handleTimelineMouseUp);
    return;
  }

  const clipId = getClipIdFromEventTarget(target);
  if (clipId && videoRenderContext && !isLocked) {
    draggedClipId = clipId;
    isDraggingClip = true;
    (target.closest('.timeline-clip') as HTMLElement)?.classList.add('dragging');
    document.body.style.cursor = 'grabbing';
    document.addEventListener('mousemove', onTimelineMouseMove);
    document.addEventListener('mouseup', handleTimelineMouseUp);
  }
}

/**
 * Optimized: Manually update DOM styles instead of full re-render.
 */
function updateClipDOM(id: string, start: number, end: number) {
  const el = cachedClipElements.get(id);
  if (!el) return;
  const pps = getPixelsPerSecond();
  el.style.left = `${start * pps}px`;
  el.style.width = `${(end - start) * pps}px`;
}

function handleTimelineMouseMove(e: MouseEvent) {
  markInteraction();
  if (Math.abs(e.clientX - timelineClickStartX) > 3) {
      hasTimelineDragged = true;
  }

  if (isResizingOverlay && activeOverlayId) {
    const ev = (timelineState.graphics || []).find(g => g.id === activeOverlayId);
    if (ev) {
      const deltaX = e.clientX - overlayDragStartX;
      const pps = getPixelsPerSecond();
      const deltaSec = deltaX / pps;
      const minDur = 0.3;

      if (overlayResizeEdge === 'right') {
        let rawEnd = overlayOriginalEnd + deltaSec;
        if (timelineState.snappingEnabled) rawEnd = getSnappedTime(rawEnd, cachedDragSnapPoints);
        ev.end = Math.max(ev.start + minDur, rawEnd);
      } else if (overlayResizeEdge === 'left') {
        let rawStart = overlayOriginalStart + deltaSec;
        if (timelineState.snappingEnabled) rawStart = getSnappedTime(rawStart, cachedDragSnapPoints);
        const newStart = Math.max(0, Math.min(ev.end - minDur, rawStart));
        const shift = newStart - overlayOriginalStart;
        ev.start = newStart;
        if ((ev as any)._sfxBuffer || (ev as any).sfxTrigger) {
          (ev as any).startOffset = Math.max(0, overlayOriginalStartOffset + shift);
        }
      }

      const el = (dragOverlayEl && dragOverlayEl.isConnected) ? dragOverlayEl : (dom.timelineClipsContainer.querySelector(`[data-graphic-id="${activeOverlayId}"]`) as HTMLElement);
      if (el) {
        el.style.left = `${ev.start * pps}px`;
        el.style.width = `${(ev.end - ev.start) * pps}px`;
        const timeBadge = el.querySelector('.font-mono');
        if (timeBadge) timeBadge.textContent = `${(ev.start ?? 0).toFixed(1)}s - ${(ev.end ?? 0).toFixed(1)}s`;
      }
      if (videoRenderContext) drawVideoFrame(state.videoPauseTime);
    }
    return;
  }

  if (isDraggingOverlay && activeOverlayId) {
    const ev = (timelineState.graphics || []).find(g => g.id === activeOverlayId);
    if (ev) {
      const deltaX = e.clientX - overlayDragStartX;
      const pps = getPixelsPerSecond();
      const deltaSec = deltaX / pps;
      const duration = overlayOriginalEnd - overlayOriginalStart;
      
      let newStart = Math.max(0, overlayOriginalStart + deltaSec);
      if (timelineState.snappingEnabled) {
        newStart = getSnappedTime(newStart, cachedDragSnapPoints);
      }
      ev.start = newStart;
      ev.end = newStart + duration;

      const el = (dragOverlayEl && dragOverlayEl.isConnected) ? dragOverlayEl : (dom.timelineClipsContainer.querySelector(`[data-graphic-id="${activeOverlayId}"]`) as HTMLElement);
      if (el) {
        el.style.left = `${ev.start * pps}px`;
        const timeBadge = el.querySelector('.font-mono');
        if (timeBadge) timeBadge.textContent = `${(ev.start ?? 0).toFixed(1)}s - ${(ev.end ?? 0).toFixed(1)}s`;
      }
      if (videoRenderContext) drawVideoFrame(state.videoPauseTime);
    }
    return;
  }

  if (!isResizingClip || !resizedClipId || !timelineContainerRect) return;
  timelineState.bumpClipsVersion();

  const deltaX = e.clientX - resizeStartX;
  const pps = getPixelsPerSecond();
  const deltaDuration = deltaX / pps;
  const isLocked = timelineState.mode === 'audio_locked';

  const sorted = getSortedTimeline();
  const idx = sorted.findIndex(c => c.id === resizedClipId);
  if (idx === -1) return;

  const minDuration = 0.05;

  if (resizeEdge === 'right') {
    const cur = findClipById(sorted[idx].id);
    if (!cur) return;

    if (isLocked) {
      const next = sorted[idx + 1] ? findClipById(sorted[idx + 1].id) : null;
      if (!next) return;

      const maxNewEndTime = originalEndTimes[idx + 1] - minDuration;
      const minNewEndTime = originalStartTimes[idx] + minDuration;
      let rawNewEndTime = originalEndTimes[idx] + deltaDuration;
      if (timelineState.snappingEnabled) {
        rawNewEndTime = getSnappedTime(rawNewEndTime, cachedDragSnapPoints);
      }
      let newEndTime = Math.max(minNewEndTime, Math.min(rawNewEndTime, maxNewEndTime));
      const shift = newEndTime - originalEndTimes[idx];

      cur.startTime = originalStartTimes[idx];
      cur.endTime = newEndTime;
      cur.duration = cur.endTime - cur.startTime;
      next.startTime = newEndTime;
      next.endTime = originalEndTimes[idx + 1];
      next.duration = next.endTime - next.startTime;
      next.videoStartOffset = originalVideoStartOffsets[idx + 1] + shift;
      timelineState.bumpClipsVersion();

      updateClipDOM(cur.id, cur.startTime, cur.endTime);
      updateClipDOM(next.id, next.startTime, next.endTime);
    } else {
      const originalDur = originalEndTimes[idx] - originalStartTimes[idx];
      let targetEndTime = originalEndTimes[idx] + deltaDuration;
      if (timelineState.snappingEnabled) {
        targetEndTime = getSnappedTime(targetEndTime, cachedDragSnapPoints);
      }
      cur.duration = Math.max(minDuration, targetEndTime - originalStartTimes[idx]);
      cur.endTime = cur.startTime + cur.duration;
      updateClipDOM(cur.id, cur.startTime, cur.endTime);

      let accumulated = cur.endTime;
      for (let i = idx + 1; i < sorted.length; i++) {
        const c = findClipById(sorted[i].id);
        if (!c) continue;
        c.startTime = accumulated;
        c.endTime = accumulated + c.duration;
        accumulated = c.endTime;
        updateClipDOM(c.id, c.startTime, c.endTime);
      }
    }
  } else if (resizeEdge === 'left') {
    const cur = findClipById(sorted[idx].id);
    if (!cur) return;

    if (isLocked) {
      const prev = sorted[idx - 1] ? findClipById(sorted[idx - 1].id) : null;
      if (!prev) return;

      const minNewStartTime = originalStartTimes[idx - 1] + minDuration;
      const maxNewStartTime = originalEndTimes[idx] - minDuration;
      let rawNewStartTime = originalStartTimes[idx] + deltaDuration;
      if (timelineState.snappingEnabled) {
        rawNewStartTime = getSnappedTime(rawNewStartTime, cachedDragSnapPoints);
      }
      let newStartTime = Math.max(minNewStartTime, Math.min(rawNewStartTime, maxNewStartTime));
      const shift = newStartTime - originalStartTimes[idx];

      prev.startTime = originalStartTimes[idx - 1];
      prev.endTime = newStartTime;
      prev.duration = prev.endTime - prev.startTime;
      cur.startTime = newStartTime;
      cur.endTime = originalEndTimes[idx];
      cur.duration = cur.endTime - cur.startTime;
      cur.videoStartOffset = originalVideoStartOffsets[idx] + shift;

      updateClipDOM(prev.id, prev.startTime, prev.endTime);
      updateClipDOM(cur.id, cur.startTime, cur.endTime);
    } else {
      const originalDur = originalEndTimes[idx] - originalStartTimes[idx];
      let targetStartTime = originalStartTimes[idx] + deltaDuration;
      if (timelineState.snappingEnabled) {
        targetStartTime = getSnappedTime(targetStartTime, cachedDragSnapPoints);
      }
      const newDur = Math.max(minDuration, originalEndTimes[idx] - targetStartTime);
      const shift = originalDur - newDur;

      cur.startTime = originalStartTimes[idx] + shift;
      cur.duration = newDur;
      cur.endTime = cur.startTime + cur.duration;
      cur.videoStartOffset = originalVideoStartOffsets[idx] + shift;
      updateClipDOM(cur.id, cur.startTime, cur.endTime);

      let accumulated = cur.endTime;
      for (let i = idx + 1; i < sorted.length; i++) {
        const c = findClipById(sorted[i].id);
        if (!c) continue;
        c.startTime = accumulated;
        c.endTime = accumulated + c.duration;
        accumulated = c.endTime;
        updateClipDOM(c.id, c.startTime, c.endTime);
      }
    }
  }

  // ✅ Optimized: Throttled render context update
  const now = performance.now();
  if (now - lastDrawTime >= DRAW_THROTTLE) {
    setVideoRenderContext({ 
      totalDuration: videoRenderContext!.totalDuration,
      clips: timelineState.clips as any[] 
    });
    drawVideoFrame(state.videoPauseTime);
    lastDrawTime = now;
  }
}

function handleTimelineMouseUp() {
  flushTimelineMove();
  dragOverlayEl = null;
  cachedDragSnapPoints = null;
  if (isDraggingOverlay || isResizingOverlay) {
    isDraggingOverlay = false;
    isResizingOverlay = false;
    activeOverlayId = null;
    overlayResizeEdge = null;
    document.body.style.cursor = 'default';
    timelineState.setGraphics([...timelineState.graphics]);
    ui.renderTimelineEditor();
    if (videoRenderContext) drawVideoFrame(state.videoPauseTime);
  }

  if (isDraggingClip) dom.timelineClipsContainer.querySelector('.dragging')?.classList.remove('dragging');

  isDraggingClip = false;
  draggedClipId = null;
  isResizingClip = false;
  resizedClipId = null;
  resizeEdge = null;
  cachedClipElements.clear();

  document.body.style.cursor = 'default';
  document.removeEventListener('mousemove', onTimelineMouseMove);
  document.removeEventListener('mouseup', handleTimelineMouseUp);
  scheduleFullQualityRedraw();

  if (originalStartTimes.length > 0) {
    resyncTimeline({ notify: false, reason: 'mouse-up' });
    updateVideoContext(); // Full reconciliation now that drag is finished
    ui.renderTimelineEditor(); // Rebuild DOM to ensure everything is in perfect sync
    // saveVersion(false);
    originalStartTimes = [];
    originalEndTimes = [];
    originalVideoStartOffsets = [];
    if (videoRenderContext) drawVideoFrame(state.videoPauseTime);
  }
}

export function updateVideoContext(skipUIRender = false) {
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
      setVideoRenderContext(null);
      ui.updateVideoTime(0, 0);
      if (dom.videoExportBtn && !state.uploadedVideoElement && !timelineState.masterAudioBuffer && !state.uploadedAudioBuffer) {
        dom.videoExportBtn.disabled = true;
      }
      return;
    }
  }

  ensureClipIds();
  const sorted = getSortedTimeline();
  const audioDur = timelineState.masterAudioBuffer?.duration;
  const totalDuration = isNum(audioDur) ? (audioDur as number) : sorted.reduce((m, c) => 
    Math.max(m, isNum(c.endTime) ? c.endTime : (isNum(c.startTime) ? c.startTime : 0) + (c.duration || 0)), 0
  );
  
  state.videoPauseTime = Math.max(0, Math.min(state.videoPauseTime, totalDuration));
  normalizeTimeline(totalDuration);

  const isLocked = timelineState.mode === 'audio_locked';
  let cum = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const clip = sorted[i];
    const nextClip = sorted[i + 1];

    const clipLen = Math.max(0.001, isLocked && isNum(clip.endTime) && isNum(clip.startTime) ? clip.endTime - clip.startTime : clip.duration);
    const clipEndGlobal = isLocked ? clip.endTime : cum + clipLen;
    cum += clipLen;

    // ✅ Only calculate transition boundaries for actual transitions
    let resolvedTransition = clip.transitionToNext || 'cut';
    const globalStyle = timelineState.videoTransitionStyle || 'narrative_guided';
    if (globalStyle !== 'narrative_guided' && globalStyle !== 'ai_directed') {
      resolvedTransition = globalStyle;
    }
    const hasTransition = resolvedTransition !== 'cut';

    if (hasTransition) {
      const nextLen = Math.max(0.001, isLocked && isNum(nextClip.endTime) && isNum(nextClip.startTime) ? nextClip.endTime - nextClip.startTime : nextClip.duration);

      const transitionDur = utils.clamp(0.08 * Math.min(clipLen, nextLen), 0.08, 0.35);
      let transitionStart = clipEndGlobal - transitionDur;

      if (isLocked && timelineState.globalSilences?.length && clip.wordTimestamps?.length) {
        const lastWord = clip.wordTimestamps[clip.wordTimestamps.length - 1];
        const lastWordEndGlobal = clip.startTime + lastWord.end;
        const safePointGlobal = utils.getNextSafeTransitionPoint(lastWordEndGlobal, timelineState.globalSilences, Math.min(1.0, clip.endTime - lastWordEndGlobal));
        if (safePointGlobal !== null) transitionStart = Math.max(transitionStart, safePointGlobal);
      }

      clip._transitionStart = transitionStart;
      clip._transitionEnd = clipEndGlobal;
      clip._transitionDuration = clipEndGlobal - transitionStart;
    } else {
      // ✅ Clear transition boundaries for cuts
      clip._transitionStart = undefined;
      clip._transitionEnd = undefined;
      clip._transitionDuration = undefined;
    }
  }

  setVideoRenderContext({ totalDuration, clips: sorted as any[] });
  ui.updateVideoTime(state.videoPauseTime, totalDuration);
  updateSubtitleTimestampsStatus();

  if (dom.videoExportBtn && (sorted.length > 0 || state.uploadedVideoElement || timelineState.masterAudioBuffer || state.uploadedAudioBuffer)) {
    dom.videoExportBtn.disabled = false;
  }
  
  if (!state.isVideoPlaying && videoRenderContext) {
    drawVideoFrame(state.videoPauseTime || 0);
  }
  
  if (!skipUIRender) {
    ui.renderTimelineEditor();
  }
}


let isAudioContextListenerAttached = false;

export function updateReplayUI(isEnded: boolean) {
    if (!dom.bigPlayBtn) return;
    if (isEnded) {
        dom.bigPlayBtn.title = 'Replay Video (Space)';
        dom.bigPlayBtn.innerHTML = '<svg class="w-5 h-5 text-white fill-none stroke-current" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
        if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.title = 'Replay Video (Space)';
    } else {
        dom.bigPlayBtn.title = 'Play Video (Space)';
        dom.bigPlayBtn.innerHTML = '<svg class="w-5 h-5 text-white fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>';
        if (dom.videoPlayPauseBtn) dom.videoPlayPauseBtn.title = 'Play / Pause Video (Space)';
    }
}

export function forcePausePlayback(timeOverride?: number, silent: boolean = false) {
    state.isVideoPlaying = false;
    if (dom.videoPlayIcon) dom.videoPlayIcon.classList.remove('hidden');
    if (dom.videoPauseIcon) dom.videoPauseIcon.classList.add('hidden');
    if (dom.bigPlayBtn) dom.bigPlayBtn.classList.remove('hidden');
    if (state.videoAudioSource) {
        try { state.videoAudioSource.stop(); } catch (e) { console.warn('Audio source stop failed:', e); }
        try { state.videoAudioSource.disconnect(); } catch (e) { console.warn('Audio source disconnect failed:', e); }
        state.videoAudioSource = null;
    }
    if (state.videoMasterGainNode) {
        try { state.videoMasterGainNode.disconnect(); } catch (e) { console.warn('Master gain disconnect failed:', e); }
        state.videoMasterGainNode = null;
    }
    if (state.sfxAudioSources) {
        state.sfxAudioSources.forEach(s => {
            try { s.stop(); } catch (e) { console.warn('SFX audio source stop notice:', e); }
            try { s.disconnect(); } catch (e) { console.warn('SFX audio source disconnect notice:', e); }
        });
        state.sfxAudioSources = [];
    }
    if (state.bgAudioSource) {
        try { state.bgAudioSource.stop(); } catch (e) { console.warn('BG audio source stop notice:', e); }
        try { state.bgAudioSource.disconnect(); } catch (e) { console.warn('BG audio source disconnect notice:', e); }
        state.bgAudioSource = null;
        state.bgAudioGain = null;
    }
    if (timelineState.clips) {
        timelineState.clips.forEach((clip: any) => {
            if (clip.videoElement) {
                clip.videoElement.muted = true;
                if (!clip.videoElement.paused) {
                    try { clip.videoElement.pause(); } catch (e) { console.warn('Clip video element pause notice:', e); }
                }
            }
            if (clip.talkingHeadVideoElement) {
                clip.talkingHeadVideoElement.muted = true;
                if (!clip.talkingHeadVideoElement.paused) {
                    try { clip.talkingHeadVideoElement.pause(); } catch (e) { console.warn('Talking head video element pause notice:', e); }
                }
            }
        });
    }
    if (state.uploadedVideoElement) {
        state.uploadedVideoElement.muted = true;
        if (!state.uploadedVideoElement.paused) {
            try { state.uploadedVideoElement.pause(); } catch (e) { console.warn('Uploaded video element pause notice:', e); }
        }
    }
    if (state.videoRenderRequestId) {
        cancelAnimationFrame(state.videoRenderRequestId);
        state.videoRenderRequestId = null;
    }
    state.videoPauseTime = timeOverride !== undefined
        ? timeOverride
        : state.lastRenderedTime;

    if (videoRenderContext && !state.isExporting) {
        ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
    }

    const isAtEnd = videoRenderContext && state.videoPauseTime >= (videoRenderContext.totalDuration - 0.08);
    updateReplayUI(Boolean(isAtEnd));
    
    // Playback status notification
    if (!silent) {
        ui.showStatus(isAtEnd ? 'Ended' : 'Paused playback', false, 1000);
    }
}

export async function resyncTimelineVisualsFromStoryboard(): Promise<boolean> {
  if (!timelineState.clips || timelineState.clips.length === 0) return false;
  const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
  if (!allShots.length) return false;

  let changed = false;
  const updatedClips = [...timelineState.clips];

  for (let i = 0; i < updatedClips.length; i++) {
    const clip = updatedClips[i];
    // Do not overwrite standalone uploaded video clips or imported items not mapped to storyboard shots
    if (clip.id === 'aroll-full' || clip.id.startsWith('imported-') || (clip.talkingHeadVideoElement && !allShots.some(s => s.id === clip.id))) {
      continue;
    }

    const shot = allShots.find((s: any) => s.id && s.id === clip.id) ||
                 allShots.find((s: any) => (s.text_reference || s.line_text) && (s.text_reference || s.line_text) === clip.text);

    if (!shot) continue;

    const shotVideoURL = shot._videoObjectURL;
    const shotImageURL = shot._imageObjectURL;
    const clipVideoURL = clip._videoObjectURL;
    const clipImageURL = clip._imageObjectURL;

    const needsVideoReload = (shotVideoURL && shotVideoURL !== clipVideoURL) || (shotVideoURL && !clip.videoElement);
    const needsImageReload = (!shotVideoURL && shotImageURL && shotImageURL !== clipImageURL) || (!shotVideoURL && shotImageURL && !clip.image);

    const shotTHMode = shot.talkingHeadMode || (state.uploadedVideoElement ? 'pip-br' : 'none');
    const shotTHShape = shot.talkingHeadShape || 'circle';
    const shotTHSize = shot.talkingHeadSize || 'medium';
    const shotUseOrigAudio = !!(shot as any).useOriginalAudio;
    const isMasterVideo = (!shotVideoURL && !!state.uploadedVideoElement) ||
                          (shotVideoURL && state.uploadedVideoElement && shotVideoURL === state.uploadedVideoElement.src) ||
                          (shotTHMode && shotTHMode !== 'none' && !!state.uploadedVideoElement);
    const defaultOffset = isMasterVideo ? (clip.startTime || 0) : 0;
    const shotOffset = typeof (shot as any).videoStartOffset === 'number' && (shot as any).videoStartOffset !== 0
      ? (shot as any).videoStartOffset
      : (typeof clip.videoStartOffset === 'number' && clip.videoStartOffset !== 0 ? clip.videoStartOffset : defaultOffset);

    const shotDisplayMode = (shot as any).displayMode || 'fullscreen';
    const shotPipPos = (shot as any).pipPosition || 'top_right';
    const shotPipX = (shot as any).pipX;
    const shotPipY = (shot as any).pipY;
    const shotPipAnchorX = (shot as any).pipAnchorX;
    const shotPipAnchorY = (shot as any).pipAnchorY;
    const shotPipAnim = (shot as any).pipAnimation || 'pop_spring';
    const shotPipScale = typeof (shot as any).pipScale === 'number' ? (shot as any).pipScale : 0.36;

    const thPropsChanged = clip.talkingHeadMode !== shotTHMode ||
                           clip.talkingHeadShape !== shotTHShape ||
                           clip.talkingHeadSize !== shotTHSize ||
                           clip.useOriginalAudio !== shotUseOrigAudio ||
                           clip.videoStartOffset !== shotOffset ||
                           clip.displayMode !== shotDisplayMode ||
                           clip.pipPosition !== shotPipPos ||
                           clip.pipX !== shotPipX ||
                           clip.pipY !== shotPipY ||
                           clip.pipAnchorX !== shotPipAnchorX ||
                           clip.pipAnchorY !== shotPipAnchorY ||
                           clip.pipAnimation !== shotPipAnim ||
                           clip.pipScale !== shotPipScale ||
                           (!clip.talkingHeadVideoElement && !!state.uploadedVideoElement);

    if (needsVideoReload || needsImageReload || thPropsChanged) {
      changed = true;
      let videoEl = clip.videoElement;
      let img = clip.image;
      let secVideoEl = clip.secondaryVideoElement;
      let secImg = clip.secondaryImage;

      const hasDualMedia = !!(shot.preserveContent || shot._secondaryVideoObjectURL || shot._secondaryImageObjectURL || (shotVideoURL && shotImageURL));

      if (shotVideoURL) {
        if (needsVideoReload) {
          try {
            videoEl = await utils.loadVideoElement(shotVideoURL);
          } catch (e) {
            console.warn(`Failed to reload video for clip ${clip.id}`, e);
          }
        }
        if (!hasDualMedia && !shotImageURL) {
          img = undefined;
        }
      }
      if (shotImageURL) {
        if (needsImageReload || !img) {
          try {
            img = await utils.loadImageOrThrow(shotImageURL);
          } catch (e) {
            console.warn(`Failed to reload image for clip ${clip.id}`, e);
          }
        }
        if (!hasDualMedia && !shotVideoURL) {
          videoEl = undefined;
        }
      }

      if (shot._secondaryVideoObjectURL && (!secVideoEl || shot._secondaryVideoObjectURL !== clip._secondaryVideoObjectURL)) {
        try {
          secVideoEl = await utils.loadVideoElement(shot._secondaryVideoObjectURL);
        } catch (e) {
          console.warn(`Failed to load secondary video for clip ${clip.id}`, e);
        }
      }
      if (shot._secondaryImageObjectURL && (!secImg || shot._secondaryImageObjectURL !== clip._secondaryImageObjectURL)) {
        try {
          secImg = await utils.loadImageOrThrow(shot._secondaryImageObjectURL);
        } catch (e) {
          console.warn(`Failed to load secondary image for clip ${clip.id}`, e);
        }
      }

      updatedClips[i] = {
        ...clip,
        videoElement: videoEl,
        image: img,
        secondaryVideoElement: secVideoEl,
        secondaryImage: secImg,
        _videoObjectURL: shotVideoURL,
        _imageObjectURL: shotImageURL,
        _secondaryVideoObjectURL: shot._secondaryVideoObjectURL,
        _secondaryImageObjectURL: shot._secondaryImageObjectURL,
        image_id: shot.image_id,
        video_id: shot.video_id,
        secondary_image_id: shot.secondary_image_id,
        secondary_video_id: shot.secondary_video_id,
        preserveContent: shot.preserveContent,
        talkingHeadRole: shot.talkingHeadRole,
        talkingHeadMode: shotTHMode,
        talkingHeadShape: shotTHShape,
        talkingHeadSize: shotTHSize,
        talkingHeadVideoElement: secVideoEl || clip.talkingHeadVideoElement || (videoEl && img && shotTHMode !== 'none' ? videoEl : undefined) || state.uploadedVideoElement || undefined,
        useOriginalAudio: shotUseOrigAudio,
        videoStartOffset: shotOffset,
        displayMode: shotDisplayMode,
        pipPosition: shotPipPos,
        pipX: shotPipX,
        pipY: shotPipY,
        pipAnchorX: shotPipAnchorX,
        pipAnchorY: shotPipAnchorY,
        pipAnimation: shotPipAnim,
        pipScale: shotPipScale,
      };
    }
  }

  if (changed) {
    timelineState.setClips(updatedClips, false);
    updateVideoContext();
    if (!state.isVideoPlaying) {
      drawVideoFrame(state.videoPauseTime || 0);
    }
    return true;
  }
  return false;
}

function setupAudioContextStateListener() {
  if (isAudioContextListenerAttached) return;
  const audioCtx = utils.getAudioContext();
  audioCtx.onstatechange = () => {
    if (audioCtx.state === 'suspended' && state.isVideoPlaying) {
      forcePausePlayback();
    }
  };
  isAudioContextListenerAttached = true;
}

export async function handleOpenVideoDirector() {
  ui.openVideoDirectorModal();
  if (dom.visualFirstDurationOverrideInput && dom.visualFirstAudioToggle) {
      dom.visualFirstDurationOverrideInput.disabled = dom.visualFirstAudioToggle.checked;
      dom.visualFirstDurationOverrideInput.classList.toggle('opacity-50', dom.visualFirstAudioToggle.checked);
  }
  await fetchAndPopulateVoices();
  setupAudioContextStateListener();
  await resyncTimelineVisualsFromStoryboard();

  const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
  const hasShots = allShots.length > 0;
  
  if (state.uploadedVideoElement && timelineState.clips?.length === 0) {
      // Create a default a-roll clip if they didn't even make a storyboard
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
      if (dom.videoPreGenerationOverlay) dom.videoPreGenerationOverlay.classList.add('hidden');
  }
  const isSeedOnly = (timelineState.clips?.length <= 1
      && (timelineState.clips?.[0]?.id === 'aroll-full' || timelineState.clips?.length === 0))
      || (hasShots && timelineState.clips?.length !== allShots.length);
  
  if (isSeedOnly && hasShots && timelineState.masterAudioBuffer && timelineState.globalWordTimestamps?.length) {
      const { buildTimelineFromShotsWithAudio } = await import('./audio-upload-director');
      await buildTimelineFromShotsWithAudio();
      ui.showStatus('Timeline built from storyboard, aligned to your A-roll audio.', false, 3000);
  } else if (isSeedOnly && hasShots) {
      const { buildTimelineFromShotsWithMediaDurations } = await import('./audio-upload-director');
      await buildTimelineFromShotsWithMediaDurations();
      ui.showStatus('Timeline built from storyboard.', false, 3000);
  }

  if (timelineState.clips?.length > 0 && timelineState.videoGenerated) {
      if (dom.videoPreGenerationOverlay) dom.videoPreGenerationOverlay.classList.add('hidden');
      if (dom.videoControlsContainer) dom.videoControlsContainer.classList.remove('hidden');
      if (dom.videoPostGenerationOverlay) dom.videoPostGenerationOverlay.classList.remove('hidden');
      if (dom.videoCanvas) {
          dom.videoCanvas.classList.remove('hidden');
          dom.videoCanvas.style.display = 'block';
      }
      drawVideoFrame(state.videoPauseTime || 0);
  }
  if (dom.videoExportBtn && (timelineState.clips?.length > 0 || state.uploadedVideoElement || timelineState.masterAudioBuffer || state.uploadedAudioBuffer)) {
      dom.videoExportBtn.disabled = false;
  }
  ui.renderTimelineEditor();
}

export function handleCloseVideoDirectorModal() {
  if (state.isVideoPlaying) forcePausePlayback();
  ui.closeVideoDirectorModal();
}

export async function togglePreviewFullscreen() {
    const wrapper = dom.videoPreviewWrapper || dom.videoCanvas?.parentElement;
    if (!wrapper || !videoRenderContext) return;

    if (document.fullscreenElement) {
        await document.exitFullscreen();
    } else {
        await wrapper.requestFullscreen();
    }
}

export function handleVideoPlayPause() {
    if (state.isExporting) {
        ui.showStatus('Preview playback is disabled during export.', true, 2000);
        return;
    }
    if (!timelineState.videoGenerated || !videoRenderContext) {
        ui.showStatus('Production required.', true, 2000);
        return;
    }
    if (state.isVideoPlaying) {
        forcePausePlayback();
        return;
    }

    // Auto-rewind to the beginning if at the end of the video
    const wasAtEnd = videoRenderContext && state.videoPauseTime >= (videoRenderContext.totalDuration - 0.08);
    if (wasAtEnd) {
        state.videoPauseTime = 0;
        state.lastRenderedTime = 0;
        drawVideoFrame(0);
        ui.updateVideoTime(0, videoRenderContext.totalDuration);
        updateReplayUI(false);
    }

    const audioCtx = utils.getAudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    state.isVideoPlaying = true;
    dom.videoPlayIcon.classList.add('hidden');
    dom.videoPauseIcon.classList.remove('hidden');
    dom.bigPlayBtn.classList.add('hidden');
    state.playbackStartTimestamp = 0;
    state.playbackStartOffset = state.videoPauseTime;
    
    // Playback status notification
    ui.showStatus(wasAtEnd ? 'Replaying from start' : 'Started playback', false, 1000);
    
    let audioStartContextTime = 0;
    if (timelineState.masterAudioBuffer) {
        state.videoAudioSource = audioCtx.createBufferSource();
        state.videoAudioSource.buffer = timelineState.masterAudioBuffer;
        const masterGain = audioCtx.createGain();
        state.videoMasterGainNode = masterGain;
        state.videoAudioSource.connect(masterGain);
        masterGain.connect(audioCtx.destination);
        try {
            audioStartContextTime = audioCtx.currentTime;
            state.videoAudioSource.start(0, state.videoPauseTime);
        } catch (e) {
            state.videoPauseTime = 0;
            state.playbackStartOffset = 0;
            audioStartContextTime = audioCtx.currentTime;
            state.videoAudioSource.start(0, 0);
        }
    } else {
        audioStartContextTime = audioCtx.currentTime;
    }

    state.sfxAudioSources = [];
    for (const clip of timelineState.clips) {
        if (clip._sfxBuffer) {
            const sfxStart = clip.startTime;
            if (sfxStart >= state.videoPauseTime) {
                const source = audioCtx.createBufferSource();
                source.buffer = clip._sfxBuffer;
                source.connect(audioCtx.destination);
                const delay = sfxStart - state.videoPauseTime;
                source.start(audioCtx.currentTime + delay);
                state.sfxAudioSources.push(source);
            } else if (sfxStart + clip._sfxBuffer.duration > state.videoPauseTime) {
                const source = audioCtx.createBufferSource();
                source.buffer = clip._sfxBuffer;
                source.connect(audioCtx.destination);
                const offset = state.videoPauseTime - sfxStart;
                source.start(audioCtx.currentTime, offset);
                state.sfxAudioSources.push(source);
            }
        }
    }

    if (state._bgAudioBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = state._bgAudioBuffer;
        const bgGain = audioCtx.createGain();
        
        const baseVolume = state.bgAudioVolume ?? 0.3;
        bgGain.gain.value = baseVolume;
        
        if (state.audioDuckingEnabled) {
            const blocks = calculateSpeechIntervals();
            if (blocks.length > 0) {
                const DUCK_VOL = baseVolume * 0.2; // Dip volume by 80%
                const RAMP = 0.3; // 300ms ramp time
                
                bgGain.gain.setValueAtTime(baseVolume, audioCtx.currentTime);
                
                for (const b of blocks) {
                    const startCtxTime = audioCtx.currentTime + (b.start - state.videoPauseTime);
                    const endCtxTime = audioCtx.currentTime + (b.end - state.videoPauseTime);
                    
                    if (startCtxTime > audioCtx.currentTime) {
                        bgGain.gain.setValueAtTime(baseVolume, Math.max(audioCtx.currentTime, startCtxTime - RAMP));
                        bgGain.gain.linearRampToValueAtTime(DUCK_VOL, startCtxTime);
                    } else if (endCtxTime > audioCtx.currentTime) {
                        bgGain.gain.setValueAtTime(DUCK_VOL, audioCtx.currentTime);
                    }
                    
                    if (endCtxTime > audioCtx.currentTime) {
                        bgGain.gain.setValueAtTime(DUCK_VOL, endCtxTime);
                        bgGain.gain.linearRampToValueAtTime(baseVolume, endCtxTime + RAMP);
                    }
                }
            }
        }

        
        const masterBgGain = audioCtx.createGain();
        masterBgGain.gain.value = 1.0;

        if (videoRenderContext) {
            const videoEndCtxTime = audioCtx.currentTime + (videoRenderContext.totalDuration - state.videoPauseTime);
            if (videoEndCtxTime > audioCtx.currentTime) {
                const FADE_OUT_DURATION = 1.5;
                masterBgGain.gain.setValueAtTime(1.0, Math.max(audioCtx.currentTime, videoEndCtxTime - FADE_OUT_DURATION));
                masterBgGain.gain.linearRampToValueAtTime(0.01, videoEndCtxTime); // Ramp to near 0, then we disconnect later
            }
        }

        source.connect(bgGain);
        bgGain.connect(masterBgGain);
        masterBgGain.connect(audioCtx.destination);
        source.loop = true;

        if (state.videoPauseTime > 0) {
            const offset = state.videoPauseTime % state._bgAudioBuffer.duration;
            source.start(audioCtx.currentTime, offset);
        } else {
            source.start(audioCtx.currentTime);
        }
        state.bgAudioSource = source;
        state.bgAudioGain = bgGain;
    }

    let lastSyncCheck = 0;
    const SYNC_CHECK_INTERVAL = 1000;
    const SYNC_THRESHOLD = 0.05;

    const renderLoop = (timestamp: number) => {
        try {
            if (lastLoopTimestamp > 0) {
                tv('loop.interval', timestamp - lastLoopTimestamp);
            }
            lastLoopTimestamp = timestamp;

            if (!state.isVideoPlaying || state.isExporting) return;
            if (state.playbackStartTimestamp === 0) state.playbackStartTimestamp = timestamp;
            const rafElapsed = (timestamp - state.playbackStartTimestamp) / 1000;
            let curT = state.playbackStartOffset + rafElapsed;
            
            if (timelineState.masterAudioBuffer && timestamp - lastSyncCheck > SYNC_CHECK_INTERVAL) {
                const audioElapsed = audioCtx.currentTime - audioStartContextTime;
                const audioTime = state.playbackStartOffset + audioElapsed;
                const drift = Math.abs(curT - audioTime);
                if (drift > SYNC_THRESHOLD) {
                    curT = audioTime;
                    state.playbackStartTimestamp = timestamp;
                    state.playbackStartOffset = audioTime;
                    audioStartContextTime = audioCtx.currentTime;
                }
                lastSyncCheck = timestamp;
            }
            
            state.lastRenderedTime = curT;
            if (state.videoMasterGainNode && timelineState.clips) {
                narrationIndex.ensure(timelineState.clips, timelineState.clipsVersion);
                const ni = narrationIndex.find(curT);
                const activeClip = ni >= 0 ? timelineState.clips[ni] : undefined;
                const isAudioTrackHidden = timelineState.isTrackHidden('audio');
                const shouldMuteVoiceover = isAudioTrackHidden || !!(activeClip?.soloAudio || activeClip?.muteNarration);
                const currentGain = state.videoMasterGainNode.gain.value;
                const targetGain = shouldMuteVoiceover ? 0 : 1.0;
                if (Math.abs(currentGain - targetGain) > 0.01) {
                    state.videoMasterGainNode.gain.setValueAtTime(targetGain, audioCtx.currentTime);
                }
            }
            if (state.bgAudioGain) {
                const isMusicHidden = timelineState.isTrackHidden('music');
                const curBgGain = state.bgAudioGain.gain.value;
                const targetBgGain = isMusicHidden ? 0 : (state.bgAudioVolume ?? 0.3);
                if (Math.abs(curBgGain - targetBgGain) > 0.01) {
                    state.bgAudioGain.gain.setValueAtTime(targetBgGain, audioCtx.currentTime);
                }
            }
            if (curT >= videoRenderContext!.totalDuration) {
                const endT = videoRenderContext!.totalDuration;
                forcePausePlayback(endT);
                drawVideoFrame(endT);
                ui.updateVideoTime(endT, endT);
                return;
            }
            drawVideoFrame(curT);
            ui.updateVideoTime(curT, videoRenderContext!.totalDuration);
            state.videoRenderRequestId = requestAnimationFrame(renderLoop);
        } catch (error) {
            console.error('Playback loop error:', error);
            forcePausePlayback();
        }
    };
    state.videoRenderRequestId = requestAnimationFrame(renderLoop);
}

let isDraggingProgressBar = false;

export function handleVideoSeek(e: MouseEvent) {
  if (state.isExporting) return;
  if (!timelineState.videoGenerated || !videoRenderContext) return;
  const rect = dom.videoProgressBarContainer.getBoundingClientRect();
  const seekTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * videoRenderContext.totalDuration;
  
  if (state.isVideoPlaying && !isDraggingProgressBar) {
    forcePausePlayback();
    state.videoPauseTime = seekTime;
    handleVideoPlayPause();
  } else {
    state.videoPauseTime = seekTime;
    drawVideoFrame(seekTime);
    ui.updateVideoTime(seekTime, videoRenderContext.totalDuration);
    updateReplayUI(seekTime >= (videoRenderContext.totalDuration - 0.08));
  }
}

export function handleProgressBarMouseDown(e: MouseEvent) {
    if (state.isExporting) return;
    isDraggingProgressBar = true;
    if (state.isVideoPlaying) {
        forcePausePlayback(); // pause during drag
    }
    handleVideoSeek(e);
    
    let seekRafId: number | null = null;
    let pendingSeekEvent: MouseEvent | null = null;

    const handleMove = (ev: MouseEvent) => {
        if (!isDraggingProgressBar) return;
        markInteraction();
        pendingSeekEvent = ev;
        if (seekRafId !== null) return;
        seekRafId = requestAnimationFrame(() => {
            seekRafId = null;
            if (pendingSeekEvent && isDraggingProgressBar) {
                handleVideoSeek(pendingSeekEvent);
                pendingSeekEvent = null;
            }
        });
    };
    
    const handleUp = (ev: MouseEvent) => {
        if (seekRafId !== null) {
            cancelAnimationFrame(seekRafId);
            seekRafId = null;
        }
        isDraggingProgressBar = false;
        handleVideoSeek(ev);
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        scheduleFullQualityRedraw();
        // We could resume play here if we tracked it, but user can just hit space/play
    };
    
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
}

export function handleTimelineClick(e: MouseEvent) {
  if (hasTimelineDragged) return; // Ignore drag end
  if (!timelineState.videoGenerated || !videoRenderContext) return;
  
  const target = e.target as HTMLElement;
  // Ignore clicks on buttons/handles/overlays
  if (target.closest('.timeline-transition-btn') || target.closest('.timeline-transition-zone') || target.classList.contains('resize-handle') || target.closest('.clip-action-btn') || target.closest('.timeline-overlay-clip')) {
      return;
  }

  const track = dom.timelineClipsContainer.querySelector('.timeline-track');
  if (!track) return;

  const rect = track.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const seekTime = clickX / getPixelsPerSecond();
  let clampedTime = Math.max(0, Math.min(seekTime, videoRenderContext.totalDuration));
  if (timelineState.snappingEnabled) {
    clampedTime = getSnappedTime(clampedTime);
  }

  if (state.isVideoPlaying) {
    forcePausePlayback();
    state.videoPauseTime = clampedTime;
    handleVideoPlayPause();
  } else {
    state.videoPauseTime = clampedTime;
    drawVideoFrame(clampedTime);
    ui.updateVideoTime(clampedTime, videoRenderContext.totalDuration);
    updateReplayUI(clampedTime >= (videoRenderContext.totalDuration - 0.08));
  }
}

export function handleVoiceSelectionChange() {
    if (dom.narrationVoiceSelect.value === '__ADD_CUSTOM_VOICE__') {
        import('./handlers-settings').then(m => {
            if (dom.manualVoiceIdPanel?.classList.contains('hidden')) {
                m.handleToggleManualVoiceId();
            }
            if (dom.manualVoiceIdInput) dom.manualVoiceIdInput.focus();
        });
        // Reset to first real option
        const validOption = Array.from(dom.narrationVoiceSelect.options).find(o => o.value && o.value !== '__ADD_CUSTOM_VOICE__');
        if (validOption) {
            dom.narrationVoiceSelect.value = validOption.value;
        }
        return;
    }

    const option = dom.narrationVoiceSelect.selectedOptions?.[0];
    const provider = option?.dataset?.provider;

    // Hide all conditional control panels first
    dom.narrationControlsContainer.classList.add('hidden');
    dom.gradioTtsControlsContainer.classList.add('hidden');
    dom.gradioPresetControls.classList.add('hidden');
    dom.gradioDesignControls.classList.add('hidden');
    dom.gradioCloneControls.classList.add('hidden');

    if (provider?.startsWith('gradio_')) {
        dom.gradioTtsControlsContainer.classList.remove('hidden');
        
        switch (provider) {
            case 'gradio_custom':
                dom.gradioPresetControls.classList.remove('hidden');
                break;
            case 'gradio_design':
                dom.gradioDesignControls.classList.remove('hidden');
                break;
            case 'gradio_clone':
                dom.gradioCloneControls.classList.remove('hidden');
                break;
        }
    } else {
        dom.narrationControlsContainer.classList.remove('hidden');
        
        const sliderVisibility: { [key: string]: boolean } = {
            speed: true,
            pitch: provider !== 'elevenlabs' && provider !== 'ai33',
            stability: provider === 'elevenlabs' || provider === 'ai33',
            similarity: provider === 'elevenlabs' || provider === 'ai33',
            style: provider === 'elevenlabs' || provider === 'ai33'
        };

        if (provider === 'minimax') {
            sliderVisibility.pitch = true;
        } else if (provider !== 'elevenlabs' && provider !== 'ai33') { // default to Gemini
            sliderVisibility.pitch = true;
        }

        Object.entries(sliderVisibility).forEach(([sliderName, isVisible]) => {
            const container = dom.narrationControlsContainer.querySelector(`[data-slider-container="${sliderName}"]`) as HTMLElement;
            if (container) {
                container.style.display = isVisible ? 'block' : 'none';
            }
        });
    }
}

export function handleGradioArchetypeChange() {
    const selectedValue = dom.gradioVoiceArchetypeSelect.value;
    if (selectedValue) {
        dom.gradioVoiceDescription.value = selectedValue;
    }
}

export function handleGradioFastModeToggle() {
    const isFast = dom.gradioFastMode.checked;
    const transcriptInput = dom.gradioReferenceTranscript;
    if (transcriptInput) {
        transcriptInput.disabled = isFast;
        transcriptInput.classList.toggle('opacity-50', isFast);
        if (isFast) {
            transcriptInput.value = '';
        }
    }
}

export function handleGradioReferenceAudioChange() {
    // This function can be expanded later to show file info if needed.
    const fileInput = dom.gradioReferenceAudio;
    if (fileInput?.files?.[0]) {
        // e.g., display file name
    }
}
  
function renderSubtitleColorPickers() {
    const container = dom.videoSubtitleColorsContainer;
    if (!container) return;
    container.innerHTML = '';
    if (!timelineState.showSubtitles) return;

    const styleName = timelineState.videoSubtitleStyle;
    const entry = SubtitleEngine._registry.get(styleName);
    if (!entry) return;

    const defaults = entry.defaultConfig as Record<string, string>;
    const keys = Object.keys(defaults);
    if (keys.length === 0) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-wrap gap-3 mt-2 pt-2 border-t border-gray-700';

    // Support namespaced per-style colors: state.videoSubtitleColors[styleName]
    const styleColors = ((state.videoSubtitleColors as any)[styleName] || {}) as Record<string, string>;

    keys.forEach(key => {
        const currentValue = styleColors[key] || (state.videoSubtitleColors as any)[key] || defaults[key];
        // Only show if it looks like a hex/plain color (skip rgba/complex values)
        const isEditable = /^#[0-9a-fA-F]{3,8}$/.test(currentValue);
        if (!isEditable) return;

        const label = document.createElement('label');
        label.className = 'flex flex-col items-center gap-1 cursor-pointer';

        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = currentValue;
        swatch.className = 'w-7 h-7 rounded cursor-pointer border border-gray-600 bg-transparent p-0.5';
        swatch.title = key;

        const text = document.createElement('span');
        text.textContent = key;
        text.className = 'text-[9px] text-gray-400 uppercase tracking-wide';

        swatch.addEventListener('input', () => {
            if (!(state.videoSubtitleColors as any)[styleName] || typeof (state.videoSubtitleColors as any)[styleName] !== 'object') {
                (state.videoSubtitleColors as any)[styleName] = {};
            }
            (state.videoSubtitleColors as any)[styleName][key] = swatch.value;
            SubtitleEngine.clearBitmapCache();
            if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
        });

        label.appendChild(swatch);
        label.appendChild(text);
        wrapper.appendChild(label);
    });

    if (wrapper.children.length > 0) container.appendChild(wrapper);
}

export function toggleVideoSubtitles() {
    timelineState.setShowSubtitles(dom.videoSubtitlesCheckbox.checked);
    if (dom.videoSubtitleStyleSelect) {
        dom.videoSubtitleStyleSelect.disabled = !timelineState.showSubtitles;
        dom.videoSubtitleStyleSelect.classList.toggle('opacity-50', !timelineState.showSubtitles);
    }
    if (dom.videoSubtitlePositionSelect) {
        dom.videoSubtitlePositionSelect.disabled = !timelineState.showSubtitles;
        dom.videoSubtitlePositionSelect.classList.toggle('opacity-50', !timelineState.showSubtitles);
    }
    if (dom.videoSubtitleFontSelect) {
        dom.videoSubtitleFontSelect.disabled = !timelineState.showSubtitles;
        dom.videoSubtitleFontSelect.classList.toggle('opacity-50', !timelineState.showSubtitles);
    }
    if (dom.uploadSubtitleFontBtn) {
        dom.uploadSubtitleFontBtn.disabled = !timelineState.showSubtitles;
    }
    renderSubtitleColorPickers();
    updateSubtitleTimestampsStatus();
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export function updateSubtitleTimestampsStatus() {
    if (!dom.subtitleTimestampsBadge || !dom.subtitleTimestampsLabel) return;
    const globalCount = timelineState.globalWordTimestamps?.length || 0;
    const clipsWithTimestamps = (timelineState.clips || []).filter(c => c.wordTimestamps && c.wordTimestamps.length > 0);
    const totalClipWords = clipsWithTimestamps.reduce((sum, c) => sum + (c.wordTimestamps?.length || 0), 0);
    const hasSync = globalCount > 0 || totalClipWords > 0;
    const count = globalCount || totalClipWords;

    if (hasSync) {
        dom.subtitleTimestampsBadge.textContent = `✅ Synced (${count}w)`;
        dom.subtitleTimestampsBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 font-mono shrink-0';
        if (dom.subtitleTimestampsIcon) dom.subtitleTimestampsIcon.textContent = '🎯';
        dom.subtitleTimestampsLabel.textContent = `Word Timestamps: Frame-Synced (${count} words)`;
        if (dom.syncSubtitlesTimestampsBtn) {
            dom.syncSubtitlesTimestampsBtn.innerHTML = '<span>🔄 Re-sync</span>';
            dom.syncSubtitlesTimestampsBtn.title = 'Re-generate word timestamps via Deepgram or Whisper';
        }
    } else {
        dom.subtitleTimestampsBadge.textContent = '⚠️ Linear';
        dom.subtitleTimestampsBadge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-700/50 font-mono shrink-0';
        if (dom.subtitleTimestampsIcon) dom.subtitleTimestampsIcon.textContent = '⏱️';
        dom.subtitleTimestampsLabel.textContent = 'Timestamps: Linear Fallback';
        if (dom.syncSubtitlesTimestampsBtn) {
            dom.syncSubtitlesTimestampsBtn.innerHTML = '<span>⚡ Get Timestamps</span>';
            dom.syncSubtitlesTimestampsBtn.title = 'Generate accurate word timestamps from audio via Deepgram or Whisper';
        }
    }
}

export async function handleSyncSubtitleTimestamps() {
    if (!timelineState.clips || timelineState.clips.length === 0) {
        ui.showStatus('Please create or load story shots first.', true, 3000);
        return;
    }

    let audioBuffer = timelineState.masterAudioBuffer;
    if (!audioBuffer && state.uploadedAudioAssetId) {
        try {
            const blob = await assetStorage.getAsset(state.uploadedAudioAssetId);
            if (blob) {
                const arrayBuffer = await blob.arrayBuffer();
                audioBuffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
                timelineState.setMasterAudioBuffer(audioBuffer);
            }
        } catch (err) {
            console.warn('Failed to load uploaded audio asset:', err);
        }
    }

    if (!audioBuffer) {
        ui.showStatus('⚠️ No master audio on timeline. Please generate narration or upload audio first.', true, 4000);
        ui.logProductionStatus('⚠️ Cannot extract timestamps: No timeline audio buffer found. Generate Narration Audio or Upload Master Audio first.');
        return;
    }

    const script = timelineState.clips
        .map(c => (c.text_reference || c.line_text || c.text || '').replace(/<[^>]+>/g, ' ').trim())
        .filter(Boolean)
        .join(' ');

    const engine = (dom.subtitleAlignEngineSelect?.value || 'auto').toLowerCase().trim();
    const engineLabel = engine === 'whisper' ? 'Whisper Server' : (engine === 'gemini' ? 'Gemini AI' : 'Deepgram Nova-3 / Whisper');

    if (dom.syncSubtitlesTimestampsBtn) {
        dom.syncSubtitlesTimestampsBtn.disabled = true;
    }
    if (dom.subtitleSyncProgressBox) {
        dom.subtitleSyncProgressBox.classList.remove('hidden');
    }
    if (dom.subtitleSyncProgressBar) {
        dom.subtitleSyncProgressBar.style.width = '10%';
    }
    if (dom.subtitleSyncProgressText) {
        dom.subtitleSyncProgressText.textContent = '10%';
    }

    ui.logProductionStatus(`🎙️ Extracting word timestamps from audio using ${engineLabel}...`);

    try {
        const lightweightAudioFile = await utils.resampleAndEncodeAudio(audioBuffer);
        const wavBlob = new Blob([lightweightAudioFile], { type: 'audio/wav' });
        const audioFile = new File([wavBlob], "master.wav", { type: "audio/wav" });

        const words = await forceAlignAudio(
            audioFile,
            script,
            (progress: number, msg: string) => {
                if (dom.subtitleSyncProgressBar) {
                    dom.subtitleSyncProgressBar.style.width = `${Math.min(95, Math.max(10, Math.round(progress)))}%`;
                }
                if (dom.subtitleSyncProgressText) {
                    dom.subtitleSyncProgressText.textContent = `${Math.round(progress)}%`;
                }
                if (msg) ui.logProductionStatus(`[Align] ${msg}`);
            },
            engine === 'auto' ? undefined : engine
        );

        if (!words || words.length === 0) {
            throw new Error('Alignment returned no word timestamps.');
        }

        timelineState.setGlobalWordTimestamps(words);
        state.masterAudioTranscript = words;

        const shotStartTimes = timelineState.clips.map(c => c.startTime);
        const totalDur = audioBuffer.duration || (timelineState.clips[timelineState.clips.length - 1]?.endTime || 0);
        const perShot = sliceTranscriptForShots(shotStartTimes, words, totalDur);

        const updatedClips = timelineState.clips.map((clip, i) => ({
            ...clip,
            wordTimestamps: perShot[i] || []
        }));
        timelineState.setClips(updatedClips);

        SubtitleEngine.clearBitmapCache();
        updateSubtitleTimestampsStatus();

        if (!state.isVideoPlaying && videoRenderContext) {
            drawVideoFrame(state.videoPauseTime);
        }

        ui.showStatus(`✅ Synchronized ${words.length} word timestamps!`, false, 3000);
        ui.logProductionStatus(`✅ Word Timestamps Synchronized: ${words.length} words mapped across ${timelineState.clips.length} shots. Subtitles are now frame-accurately aligned.`);
    } catch (err: any) {
        console.error('Subtitle timestamp sync failed:', err);
        ui.showStatus(`Timestamp sync failed: ${err.message || err}`, true, 4000);
        ui.logProductionStatus(`❌ Subtitle timestamp alignment error: ${err.message || err}`);
    } finally {
        if (dom.syncSubtitlesTimestampsBtn) {
            dom.syncSubtitlesTimestampsBtn.disabled = false;
        }
        if (dom.subtitleSyncProgressBox) {
            dom.subtitleSyncProgressBox.classList.add('hidden');
        }
        if (dom.subtitleSyncProgressBar) {
            dom.subtitleSyncProgressBar.style.width = '0%';
        }
    }
}

export function handleVideoTransitionChange() {
    timelineState.setVideoTransitionStyle(dom.videoTransitionStyleSelect.value as any);
    updateVideoContext();
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export function handleVideoTransitionSpeedChange() {
    timelineState.setTransitionSpeed(dom.videoTransitionSpeedSelect.value as any);
    updateVideoContext();
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export function handleLyricsVideoPreset() {
    dom.videoSubtitlesCheckbox.checked = true;
    timelineState.setShowSubtitles(true);
    
    dom.videoSubtitleStyleSelect.value = 'karaoke';
    timelineState.setVideoSubtitleStyle('karaoke');
    
    dom.videoSubtitlePositionSelect.value = 'center';
    timelineState.setVideoSubtitlePosition('center');
    
    // Ensure A-Roll is full screen
    const modeSelect = document.getElementById('talking-head-mode-select') as HTMLSelectElement;
    if (modeSelect) {
        modeSelect.value = 'full';
        modeSelect.dispatchEvent(new Event('change'));
    }
    
    // Re-enable style/position selects
    dom.videoSubtitleStyleSelect.disabled = false;
    dom.videoSubtitlePositionSelect.disabled = false;
    
    // Reset custom colors when preset changes so we start from the new style defaults
    state.videoSubtitleColors = {};
    SubtitleEngine.clearBitmapCache();
    renderSubtitleColorPickers();
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
    
    ui.showStatus('🎵 Lyrics Preset Applied: Karaoke style, Center position, Full-screen A-roll', false, 3000);
}

export function handleSubtitleStyleChange() {
    timelineState.setVideoSubtitleStyle(dom.videoSubtitleStyleSelect.value as any);
    SubtitleEngine.clearBitmapCache();
    renderSubtitleColorPickers();
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export function handleSubtitlePositionChange() {
    timelineState.setVideoSubtitlePosition(dom.videoSubtitlePositionSelect.value as any);
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export function handleSubtitleFontChange() {
    const selectedFont = dom.videoSubtitleFontSelect ? dom.videoSubtitleFontSelect.value : 'Montserrat';
    timelineState.setVideoSubtitleFont(selectedFont);
    try {
        SubtitleEngine.clearBitmapCache();
    } catch {}
    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
    ui.showStatus(`Typography Font set to "${selectedFont}"`, false, 2000);
}

export function refreshCustomFontSelect() {
    if (!dom.subtitleFontGroupCustom || !dom.videoSubtitleFontSelect) return;
    
    const customFonts = state.customFonts || [];
    dom.subtitleFontGroupCustom.innerHTML = '';
    
    if (customFonts.length > 0) {
        dom.subtitleFontGroupCustom.classList.remove('hidden');
        if (dom.customFontCountBadge) {
            dom.customFontCountBadge.textContent = `${customFonts.length} Custom`;
            dom.customFontCountBadge.classList.remove('hidden');
        }
        
        customFonts.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.name;
            opt.textContent = `⭐ ${f.name} (Custom)`;
            dom.subtitleFontGroupCustom.appendChild(opt);
        });
    } else {
        dom.subtitleFontGroupCustom.classList.add('hidden');
        if (dom.customFontCountBadge) {
            dom.customFontCountBadge.classList.add('hidden');
        }
    }
    
    // Ensure selected value matches state
    if (timelineState.videoSubtitleFont) {
        dom.videoSubtitleFontSelect.value = timelineState.videoSubtitleFont;
    }
}

export async function handleCustomFontUpload(file: File) {
    if (!file) return;
    
    const validExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
    const fileName = file.name;
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    
    if (!validExtensions.includes(ext)) {
        ui.showStatus('Unsupported font format. Please select a .ttf, .otf, .woff, or .woff2 file.', true, 4000);
        return;
    }

    try {
        ui.showStatus(`Loading custom font "${file.name}"...`, false, 2000);
        
        // Clean font name from filename (e.g. "Comic_Relief-Bold.ttf" -> "Comic Relief Bold")
        let cleanName = fileName.replace(/\.[^/.]+$/, "")
            .replace(/[_-]+/g, " ")
            .trim();
        
        if (!cleanName) cleanName = 'CustomFont_' + Date.now().toString().slice(-4);
        
        const arrayBuffer = await file.arrayBuffer();
        
        // Create dynamic FontFace
        const fontFace = new FontFace(cleanName, arrayBuffer);
        await fontFace.load();
        document.fonts.add(fontFace);
        
        // Convert to base64 for persistent IndexedDB storage
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const len = bytes.byteLength;
        // Process in chunks to prevent call stack overflow on large font files
        const chunkSize = 8192;
        for (let i = 0; i < len; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const mimeType = ext === '.woff2' ? 'font/woff2' : ext === '.woff' ? 'font/woff' : ext === '.otf' ? 'font/otf' : 'font/ttf';
        const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
        
        // Update state
        if (!state.customFonts) state.customFonts = [];
        const existingIdx = state.customFonts.findIndex(f => f.name.toLowerCase() === cleanName.toLowerCase());
        if (existingIdx >= 0) {
            state.customFonts[existingIdx] = { name: cleanName, format: ext.replace('.', ''), dataUrl };
        } else {
            state.customFonts.push({ name: cleanName, format: ext.replace('.', ''), dataUrl });
        }
        
        // Save to IndexedDB
        try {
            await DB.put(APP_STATE_STORE, state.customFonts, 'custom_subtitle_fonts');
        } catch (dbErr) {
            console.warn('Could not save custom font to IndexedDB:', dbErr);
        }
        
        // Update UI
        refreshCustomFontSelect();
        if (dom.videoSubtitleFontSelect) {
            dom.videoSubtitleFontSelect.value = cleanName;
        }
        timelineState.setVideoSubtitleFont(cleanName);
        
        try {
            SubtitleEngine.clearBitmapCache();
        } catch {}
        
        if (!state.isVideoPlaying && videoRenderContext) {
            drawVideoFrame(state.videoPauseTime);
        }
        
        ui.showStatus(`🎉 Custom font "${cleanName}" registered and active!`, false, 3500);
        ui.logProductionStatus(`Custom Subtitle Font uploaded and activated: "${cleanName}" (${ext.toUpperCase()})`);
    } catch (err: any) {
        console.error('Failed to process custom font upload:', err);
        ui.showStatus(`Failed to load font: ${err.message || err}`, true, 4000);
    }
}

export async function loadSavedCustomFonts() {
    try {
        const savedFonts = await DB.get(APP_STATE_STORE, 'custom_subtitle_fonts');
        if (Array.isArray(savedFonts) && savedFonts.length > 0) {
            state.customFonts = savedFonts;
            
            for (const fontItem of savedFonts) {
                if (fontItem.dataUrl) {
                    try {
                        const res = await fetch(fontItem.dataUrl);
                        const buffer = await res.arrayBuffer();
                        const fontFace = new FontFace(fontItem.name, buffer);
                        await fontFace.load();
                        document.fonts.add(fontFace);
                    } catch (fontErr) {
                        console.warn(`Failed restoring custom font "${fontItem.name}":`, fontErr);
                    }
                }
            }
            refreshCustomFontSelect();
        }
    } catch (e) {
        console.warn('Error reading saved custom fonts from DB:', e);
    }
}

export function handleVideoEffectsChange() {
    if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
    }
}
  
export function handleUndoTimeline() {
    forcePausePlayback();
    if (timelineState.undo()) {
        try { SubtitleEngine.clearBitmapCache(); } catch {}
        try { invalidateSpectrumCache(); } catch {}
        resyncTimeline({ notify: false, reason: 'undo' });
        updateVideoContext();
        ui.renderTimelineEditor();
        if (videoRenderContext) {
            drawVideoFrame(state.videoPauseTime);
            ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
        }
        ui.showStatus('Undo timeline edit', false, 1500);
    }
}

export function handleRedoTimeline() {
    forcePausePlayback();
    if (timelineState.redo()) {
        try { SubtitleEngine.clearBitmapCache(); } catch {}
        try { invalidateSpectrumCache(); } catch {}
        resyncTimeline({ notify: false, reason: 'redo' });
        updateVideoContext();
        ui.renderTimelineEditor();
        if (videoRenderContext) {
            drawVideoFrame(state.videoPauseTime);
            ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
        }
        ui.showStatus('Redo timeline edit', false, 1500);
    }
}

export function handleSetEditMode(mode: 'ripple' | 'slip') {
    timelineState.setEditMode(mode);
    ui.showStatus(`Timeline mode: ${mode}`, false, 1500);
    if (dom.timelineModeRippleBtn && dom.timelineModeSlipBtn) {
      dom.timelineModeRippleBtn.classList.toggle('bg-indigo-600', mode === 'ripple');
      dom.timelineModeRippleBtn.classList.toggle('text-white', mode === 'ripple');
      dom.timelineModeRippleBtn.classList.toggle('bg-zinc-800', mode !== 'ripple');
      dom.timelineModeRippleBtn.classList.toggle('text-gray-400', mode !== 'ripple');

      dom.timelineModeSlipBtn.classList.toggle('bg-indigo-600', mode === 'slip');
      dom.timelineModeSlipBtn.classList.toggle('text-white', mode === 'slip');
      dom.timelineModeSlipBtn.classList.toggle('bg-zinc-800', mode !== 'slip');
      dom.timelineModeSlipBtn.classList.toggle('text-gray-400', mode !== 'slip');
    }
}
  
export function handleSplitClip() {
    if (!timelineState.videoGenerated || !videoRenderContext) return;
    const time = state.videoPauseTime;

    // Check if an SFX/Graphic clip is selected or at playhead position
    const graphics = timelineState.graphics || [];
    let targetSfx: any = null;
    if (timelineState.selectedGraphicId) {
      targetSfx = graphics.find(g => g.id === timelineState.selectedGraphicId);
    }
    if (!targetSfx) {
      targetSfx = graphics.find(g => {
        const isSfx = (g as any).isSfxOnly || (g as any).type === 'sfxCue' || Boolean((g as any).sfxTrigger && (g as any).sfxTrigger !== 'none');
        return isSfx && time > g.start && time < g.end;
      });
    }

    if (targetSfx) {
      const splitPointSec = time - targetSfx.start;
      if (splitPointSec < 0.05 || (targetSfx.end - targetSfx.start) - splitPointSec < 0.05) {
        ui.showStatus('Split point too close to SFX clip edge.', true, 2500);
        return;
      }

      timelineState.saveSnapshot();

      const origEnd = targetSfx.end;
      const origStartOffset = targetSfx.startOffset || 0;
      const clipDur1 = splitPointSec;

      targetSfx.end = time;

      const part2 = {
        ...targetSfx,
        id: 'sfx_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        start: time,
        end: origEnd,
        title: `${targetSfx.title || 'SFX'} (Part 2)`,
        startOffset: origStartOffset + clipDur1,
        _sfxBuffer: targetSfx._sfxBuffer
      };

      const newGraphics = [...graphics, part2];
      timelineState.setGraphics(newGraphics);
      timelineState.setSelectedGraphicId(part2.id);

      ui.renderTimelineEditor();
      ui.showStatus('🔪 SFX clip split at playhead!', false, 2000);
      return;
    }

    if (timelineState.selectedAudioSplitIndex !== null && timelineState.masterAudioBuffer) {
        const splits = timelineState.audioSplits || [];
        const allPoints = [0, ...splits, timelineState.masterAudioBuffer.duration];
        const isTooClose = allPoints.some(p => Math.abs(p - time) < 0.1);
        if (isTooClose) {
            ui.showStatus('Split point too close to edge.', true, 3000);
            return;
        }
        timelineState.saveSnapshot();
        const newSplits = [...splits, time].sort((a, b) => a - b);
        timelineState.setAudioSplits(newSplits);
        
        // Select the new segment created after the split
        const newIndex = newSplits.findIndex(s => s === time);
        timelineState.setSelectedAudioSplitIndex(newIndex);
        ui.renderTimelineEditor();
        ui.showStatus('Audio split at playhead.', false, 1500);
        return;
    }

    const clipIndex = timelineState.clips.findIndex((c) => time > c.startTime && time < c.endTime);
    if (clipIndex === -1) {
      ui.showStatus('Playhead not inside a clip.', true, 2000);
      return;
    }
    const clip = timelineState.clips[clipIndex];
    const splitPoint = time - clip.startTime;
    if (splitPoint < 0.1 || clip.duration - splitPoint < 0.1) {
      ui.showStatus('Split point too close to edge.', true, 3000);
      return;
    }

    timelineState.saveSnapshot();
    timelineState.setSelectedClipId(null);
    const newClip2 = { 
      ...clip, 
      startTime: time, 
      endTime: clip.endTime,
      duration: clip.duration - splitPoint, 
      id: (clip.id || `${clipIndex}`) + '_b',
      videoStartOffset: (clip.videoStartOffset || 0) + splitPoint
    };
    clip.endTime = time;
    clip.duration = splitPoint;
    clip.id = (clip.id || `${clipIndex}`) + '_a';
    const newClips = [...timelineState.clips];
    newClips.splice(clipIndex + 1, 0, newClip2);
    timelineState.setClips(newClips);
    normalizeTimeline();
    ui.renderTimelineEditor();
    ui.showStatus('Clip split at playhead.', false, 1500);
}

export function handleDeleteAudioClip(index: number, ripple: boolean = false) {
    if (!timelineState.masterAudioBuffer) return;
    
    const splits = timelineState.audioSplits || [];
    const start = index === 0 ? 0 : splits[index - 1];
    const end = index === splits.length ? timelineState.masterAudioBuffer.duration : splits[index];
    
    const durationRemoved = end - start;
    if (durationRemoved < 0.05) return;
    
    forcePausePlayback();
    timelineState.saveSnapshot();
    
    if (ripple) {
        // Ripple delete audio and shift video clips left
        rippleCutMasterAudio(start, end);
        
        // Remove the split points inside the range and shift subsequent points left
        const newSplits = splits
            .filter(s => s <= start || s >= end)
            .map(s => s > start ? s - durationRemoved : s);
        timelineState.setAudioSplits(Array.from(new Set(newSplits)));
        
        // Adjust video clips
        const newClips = [...timelineState.clips];
        for (const c of newClips) {
            const cStart = c.startTime ?? 0;
            const cEnd = c.endTime ?? (cStart + c.duration);
            if (cStart >= end) {
                c.startTime = Math.max(0, cStart - durationRemoved);
                c.endTime = Math.max(0.05, cEnd - durationRemoved);
            } else if (cStart < start && cEnd > end) {
                c.duration -= durationRemoved;
                c.endTime -= durationRemoved;
            } else if (cStart >= start && cEnd <= end) {
                c.duration = 0; // mark for filtering
            } else if (cStart < start && cEnd > start) {
                const overlap = cEnd - start;
                c.duration -= overlap;
                c.endTime = start;
            } else if (cStart < end && cEnd > end) {
                const overlap = end - cStart;
                c.startTime = start;
                c.duration -= overlap;
                c.endTime -= overlap;
                c.videoStartOffset = (c.videoStartOffset || 0) + overlap;
            }
        }
        timelineState.setClips(newClips.filter(c => c.duration >= 0.05));
    } else {
        // Lift (Silence) audio
        const oldAudio = timelineState.masterAudioBuffer;
        const newAudio = utils.getAudioContext().createBuffer(oldAudio.numberOfChannels, oldAudio.length, oldAudio.sampleRate);
        const startSample = Math.floor(start * oldAudio.sampleRate);
        const endSample = Math.floor(end * oldAudio.sampleRate);
        for (let c = 0; c < oldAudio.numberOfChannels; c++) {
            const src = oldAudio.getChannelData(c);
            const dst = newAudio.getChannelData(c);
            dst.set(src);
            for (let i = startSample; i < endSample; i++) {
                if (i < dst.length) dst[i] = 0;
            }
        }
        timelineState.setMasterAudioBuffer(newAudio);
        state.uploadedAudioBuffer = newAudio;
        
        // Remove word timestamps in this range
        if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
            const updatedWords = timelineState.globalWordTimestamps
                .filter((w: any) => w.end <= start || w.start >= end);
            timelineState.setGlobalWordTimestamps(updatedWords);
        }
    }
    
    timelineState.setSelectedAudioSplitIndex(null);
    
    if (state.videoPauseTime >= start && state.videoPauseTime < end) {
        state.videoPauseTime = start;
    }
    
    try { SubtitleEngine.clearBitmapCache(); } catch {}
    try { invalidateSpectrumCache(); } catch {}
    resyncTimeline({ notify: false, reason: 'delete-audio' });
    updateVideoContext();
    ui.renderTimelineEditor();
    if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
        ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
    }
    
    ui.showStatus(`Audio ${ripple ? 'ripple-deleted' : 'silenced'} (${durationRemoved.toFixed(1)}s).`, false, 2000);
}

export function handleDeleteClip(options: { deleteAudio?: boolean; clipId?: string } = {}) {
    // 1. Delete selected or targeted SFX / Graphic clip
    if (timelineState.selectedGraphicId) {
      const gId = timelineState.selectedGraphicId;
      const ev = (timelineState.graphics || []).find(g => g.id === gId);
      if (ev) {
        timelineState.saveSnapshot();
        timelineState.setGraphics((timelineState.graphics || []).filter(g => g.id !== gId));
        timelineState.setSelectedGraphicId(null);
        ui.renderTimelineEditor();
        ui.showStatus('🗑️ Deleted SFX clip from timeline.', false, 2000);
        return;
      }
    }

    // Check if playhead is over an SFX clip when no video clip is explicitly selected
    if (!options.clipId && !timelineState.selectedClipId && timelineState.selectedAudioSplitIndex === null) {
      const time = state.videoPauseTime || 0;
      const sfxAtTime = (timelineState.graphics || []).find(g => {
        const isSfx = (g as any).isSfxOnly || (g as any).type === 'sfxCue' || Boolean((g as any).sfxTrigger && (g as any).sfxTrigger !== 'none');
        return isSfx && time >= g.start && time <= g.end;
      });
      if (sfxAtTime) {
        timelineState.saveSnapshot();
        timelineState.setGraphics((timelineState.graphics || []).filter(g => g.id !== sfxAtTime.id));
        ui.renderTimelineEditor();
        ui.showStatus('🗑️ Deleted SFX clip under playhead.', false, 2000);
        return;
      }
    }

    if (timelineState.selectedAudioSplitIndex !== null && timelineState.masterAudioBuffer) {
        // Always ripple-delete master audio splits so the UI segment visually disappears and closes the gap
        handleDeleteAudioClip(timelineState.selectedAudioSplitIndex, true);
        return;
    }

    if (!timelineState.clips || timelineState.clips.length === 0) return;
    
    let targetIndex = -1;
    let targetClip: any = null;
    
    if (options.clipId) {
        targetIndex = timelineState.clips.findIndex(c => c.id === options.clipId);
    } else if (timelineState.selectedClipId) {
        targetIndex = timelineState.clips.findIndex(c => c.id === timelineState.selectedClipId);
    }
    
    if (targetIndex === -1) {
        const time = state.videoPauseTime || 0;
        targetIndex = timelineState.clips.findIndex(c => time >= c.startTime && time < c.endTime);
        if (targetIndex === -1 && timelineState.clips.length > 0) {
            const last = timelineState.clips[timelineState.clips.length - 1];
            if (time >= last.endTime - 0.05) targetIndex = timelineState.clips.length - 1;
        }
    }
    
    if (targetIndex === -1 || !timelineState.clips[targetIndex]) {
        ui.showStatus('Select a shot to delete or place playhead over a shot.', true, 2000);
        return;
    }
    
    if (timelineState.clips.length <= 1) {
        ui.showStatus('Cannot delete the only remaining shot in the timeline.', true, 2500);
        return;
    }
    
    targetClip = timelineState.clips[targetIndex];
    const removeStart = targetClip.startTime;
    const removeEnd = targetClip.endTime;
    const durationRemoved = Math.max(0.01, removeEnd - removeStart);
    
    forcePausePlayback();
    timelineState.saveSnapshot();
    
    // Splice master audio if deleteAudio is true and master audio exists
    if (options.deleteAudio && timelineState.masterAudioBuffer && durationRemoved > 0.01) {
        const oldAudio = timelineState.masterAudioBuffer;
        const newAudio = spliceAudioBuffer(oldAudio, removeStart, removeEnd);
        timelineState.setMasterAudioBuffer(newAudio);
        state.uploadedAudioBuffer = newAudio;
        
        if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
            const updatedWords = timelineState.globalWordTimestamps
                .filter((w: any) => w.end <= removeStart || w.start >= removeEnd)
                .map((w: any) => {
                    if (w.start >= removeEnd) {
                        return {
                            ...w,
                            start: Math.max(0, w.start - durationRemoved),
                            end: Math.max(0, w.end - durationRemoved)
                        };
                    }
                    return w;
                });
            timelineState.setGlobalWordTimestamps(updatedWords);
        }
        timelineState.setGlobalSilences(null);
    }
    
    // Remove clip
    const newClips = [...timelineState.clips];
    newClips.splice(targetIndex, 1);
    if (targetClip._videoObjectURL) {
        try { URL.revokeObjectURL(targetClip._videoObjectURL); } catch {}
    }
    
    // Shift subsequent clips
    for (let i = targetIndex; i < newClips.length; i++) {
        newClips[i].startTime = Math.max(0, newClips[i].startTime - durationRemoved);
        newClips[i].endTime = Math.max(0.05, newClips[i].endTime - durationRemoved);
        newClips[i].duration = Math.max(0.05, newClips[i].endTime - newClips[i].startTime);
    }
    
    timelineState.setSelectedClipId(null);
    timelineState.setClips(newClips);
    
    if (state.videoPauseTime >= removeStart) {
        state.videoPauseTime = Math.max(0, Math.min(removeStart, state.videoPauseTime - durationRemoved));
    }
    
    try { SubtitleEngine.clearBitmapCache(); } catch {}
    try { invalidateSpectrumCache(); } catch {}
    resyncTimeline({ notify: false, reason: 'delete-clip' });
    updateVideoContext();
    ui.renderTimelineEditor();
    if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
        ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
    }
    
    if (options.deleteAudio) {
        ui.showStatus(`Ripple deleted ${durationRemoved.toFixed(1)}s (Shot + Master Audio).`, false, 2500);
    } else {
        ui.showStatus(`Deleted shot (${newClips.length} remaining).`, false, 1800);
    }
}

export function handleTrimDeadAir() {
    if (!timelineState.masterAudioBuffer) {
        ui.showStatus('No master audio track loaded to trim.', true, 2000);
        return;
    }
    
    const buffer = timelineState.masterAudioBuffer;
    const totalDur = buffer.duration;
    let trimStartSec = 0;
    let trimEndSec = 0;
    const padding = 0.15; // 150ms natural breathing room
    
    if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
        const words = timelineState.globalWordTimestamps;
        const firstWord = words[0];
        const lastWord = words[words.length - 1];
        
        if (firstWord.start > 0.35) {
            trimStartSec = Math.max(0, firstWord.start - padding);
        }
        if (totalDur - lastWord.end > 0.35) {
            trimEndSec = Math.max(0, totalDur - (lastWord.end + padding));
        }
    } else {
        const silences = utils.detectSilences(buffer, 0.015, 0.3);
        if (silences.length > 0) {
            const firstSilence = silences[0];
            const lastSilence = silences[silences.length - 1];
            
            if (firstSilence.start === 0 && (firstSilence.end - firstSilence.start) > 0.3) {
                trimStartSec = Math.max(0, (firstSilence.end - firstSilence.start) - padding);
            }
            if (lastSilence.end >= totalDur - 0.1 && (lastSilence.end - lastSilence.start) > 0.3) {
                trimEndSec = Math.max(0, (lastSilence.end - lastSilence.start) - padding);
            }
        }
    }
    
    if (trimStartSec <= 0.05 && trimEndSec <= 0.05) {
        ui.showStatus('Audio is already tight (no excess dead air detected).', false, 2500);
        return;
    }
    
    forcePausePlayback();
    timelineState.saveSnapshot();
    
    let workingBuffer = buffer;
    let totalTrimmed = 0;
    
    if (trimEndSec > 0.05) {
        const cutPoint = workingBuffer.duration - trimEndSec;
        workingBuffer = sliceAudioBuffer(workingBuffer, 0, cutPoint);
        totalTrimmed += trimEndSec;
    }
    
    if (trimStartSec > 0.05) {
        workingBuffer = sliceAudioBuffer(workingBuffer, trimStartSec, workingBuffer.duration);
        totalTrimmed += trimStartSec;
        
        if (timelineState.globalWordTimestamps?.length) {
            const updatedWords = timelineState.globalWordTimestamps
                .filter((w: any) => w.end > trimStartSec)
                .map((w: any) => ({
                    ...w,
                    start: Math.max(0, w.start - trimStartSec),
                    end: Math.max(0, w.end - trimStartSec)
                }));
            timelineState.setGlobalWordTimestamps(updatedWords);
        }
    }
    
    timelineState.setMasterAudioBuffer(workingBuffer);
    state.uploadedAudioBuffer = workingBuffer;
    timelineState.setGlobalSilences(null);
    
    const sorted = [...timelineState.clips].sort((a, b) => a.startTime - b.startTime);
    if (sorted.length > 0) {
        if (trimStartSec > 0.05) {
            const firstClip = sorted[0];
            firstClip.videoStartOffset = (firstClip.videoStartOffset || 0) + trimStartSec;
            firstClip.duration = Math.max(0.1, firstClip.duration - trimStartSec);
            firstClip.endTime = Math.max(0.1, firstClip.endTime - trimStartSec);
            
            for (let i = 1; i < sorted.length; i++) {
                sorted[i].startTime = Math.max(0, sorted[i].startTime - trimStartSec);
                sorted[i].endTime = Math.max(0.1, sorted[i].endTime - trimStartSec);
            }
        }
        if (trimEndSec > 0.05) {
            const lastClip = sorted[sorted.length - 1];
            lastClip.duration = Math.max(0.1, lastClip.duration - trimEndSec);
            lastClip.endTime = Math.max(lastClip.startTime + 0.1, lastClip.endTime - trimEndSec);
        }
        timelineState.setClips(sorted);
    }
    
    state.videoPauseTime = 0;
    try { SubtitleEngine.clearBitmapCache(); } catch {}
    resyncTimeline({ notify: false, reason: 'trim-dead-air' });
    updateVideoContext();
    if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
    }
    
    const parts: string[] = [];
    if (trimStartSec > 0.05) parts.push(`${trimStartSec.toFixed(1)}s top`);
    if (trimEndSec > 0.05) parts.push(`${trimEndSec.toFixed(1)}s tail`);
    ui.showStatus(`Trimmed ${totalTrimmed.toFixed(1)}s dead air (${parts.join(', ')}).`, false, 3000);
}
  
/**
 * [FIX aroll-trim] Ripple-cut a span out of the master (A-roll) audio track and
 * remap the global word timestamps so everything after the cut closes up by the
 * same amount the visuals were trimmed. Returns the seconds actually removed,
 * or null when there is no master track / nothing to remove.
 *
 * WHY THIS EXISTS: the export mixer plays timelineState.masterAudioBuffer as
 * one full-length track from t=0 (exporter.ts expandMasteredAudio and
 * extractTimelineAudioMixdown -> mixInNative(voiceBus, masterAudioBuffer, 0)).
 * That is only in sync with a trimmed timeline if the buffer itself is spliced
 * by exactly the spans the user trims away. Trimming the clip fields alone cuts
 * video but leaves this buffer - and therefore the exported voice track - at
 * full length, which is the "audio isnt cut" symptom.
 */
export function rippleCutMasterAudio(removeStartSec: number, removeEndSec: number): number | null {
    removeStartSec = Math.max(0, removeStartSec);
    removeEndSec = Math.max(removeStartSec, removeEndSec);
    const removed = removeEndSec - removeStartSec;
    if (removed < 0.05) return null;

    const buffer = timelineState.masterAudioBuffer;
    if (!buffer) return null;

    forcePausePlayback();

    const newBuffer = spliceAudioBuffer(buffer, removeStartSec, removeEndSec);
    timelineState.setMasterAudioBuffer(newBuffer);
    state.uploadedAudioBuffer = newBuffer;      // keep preview/on-canvas state in sync (same pattern as handleTrimDeadAir)
    if (typeof timelineState.setGlobalSilences === 'function') {
        timelineState.setGlobalSilences(null);  // stale silences no longer map to the spliced track
    } else {
        (timelineState as any).globalSilences = null;
    }

    if (timelineState.globalWordTimestamps?.length) {
        const updated = timelineState.globalWordTimestamps
            .map((w: any) => {
                if (!w) return null;
                if (w.end <= removeStartSec) return w;                                        // fully before the cut: unchanged
                if (w.start >= removeEndSec) {
                    return { ...w, start: Math.max(0, w.start - removed), end: Math.max(0, w.end - removed) }; // after the cut: close the gap
                }
                return null;                                                                   // speech inside the cut span: dropped
            })
            .filter(Boolean);
        timelineState.setGlobalWordTimestamps(updated);
    }

    resyncTimeline({ notify: false, reason: 'rippleCutMasterAudio' });
    return removed;
}

export function handleTrimClip(edge: 'start' | 'end') {
    if (!timelineState.videoGenerated || !videoRenderContext) {
        ui.showStatus("Production not run.", true, 3000);
        return;
    }
    if (timelineState.mode === 'audio_locked') {
        ui.showStatus('Trimming not available in Audio-Locked mode.', true, 2000);
        return;
    }

    const time = state.videoPauseTime;
    const clipIndex = timelineState.clips.findIndex((c) => time >= c.startTime && time <= c.endTime);
    if (clipIndex === -1) {
        ui.showStatus('Playhead not inside a clip.', true, 2000);
        return;
    }

    timelineState.saveSnapshot();
    const newClips = [...timelineState.clips];
    const clip = newClips[clipIndex];
    const oldStartTime = clip.startTime ?? 0;
    const oldEndTime = clip.endTime ?? (clip.startTime ?? 0) + clip.duration;

    let amountToTrim: number;
    if (edge === 'start') {
        // [AUDIT A3]: The stale patch_trim scripts logic for videoStartOffset is baked in here
        amountToTrim = time - oldStartTime;
        if (amountToTrim < 0.1) return; // Prevent creating tiny clips or invalid states

        clip.duration -= amountToTrim;
        clip.videoStartOffset = (clip.videoStartOffset || 0) + amountToTrim;
        // startTime will be adjusted by normalizeTimeline
    } else { // 'end'
        amountToTrim = oldEndTime - time;
        if (amountToTrim < 0.1) return;

        clip.duration -= amountToTrim;
    }
    clip.endTime = (clip.startTime ?? 0) + clip.duration; // keep local fields consistent pre-normalize

    let clipRemoved = false;
    if (clip.duration < 0.1) {
        newClips.splice(clipIndex, 1);
        clipRemoved = true;
        ui.showStatus("Clip removed (too short after trim).", false, 2000);
    } else {
        ui.showStatus("Clip trimmed.", false, 2000);
    }

    // [FIX aroll-trim] Cut the same span out of the master (A-roll) audio and
    // close up every clip after the cut, so the exported voice track matches
    // the trimmed visuals. No-op when there is no master audio track.
    const audioRemoveStart = clipRemoved ? oldStartTime : (edge === 'start' ? oldStartTime : time);
    const audioRemoveEnd = clipRemoved ? oldEndTime : (edge === 'start' ? time : oldEndTime);
    const removedAudio = rippleCutMasterAudio(audioRemoveStart, audioRemoveEnd);
    if (removedAudio && removedAudio > 0) {
        for (let i = clipIndex + 1; i < newClips.length; i++) {
            const c = newClips[i];
            c.startTime = Math.max(0, (c.startTime ?? 0) - removedAudio);
            c.endTime = Math.max((c.startTime ?? 0) + 0.05, (c.endTime ?? (c.startTime ?? 0)) - removedAudio);
        }
    }

    if (edge === 'start' && timelineState.mode === 'free') {
        const oldStartTime = newClips[clipIndex] ? newClips[clipIndex].startTime : 0;
        state.videoPauseTime = oldStartTime;
    }
    timelineState.setClips(newClips, false);
    resyncTimeline({ notify: false, reason: 'trim-clip' });
    ui.renderTimelineEditor();
    if (!state.isVideoPlaying && videoRenderContext) {
        drawVideoFrame(state.videoPauseTime);
        ui.updateVideoTime(state.videoPauseTime, videoRenderContext.totalDuration);
    }
}
  
let wheelZoomRaf: number | null = null;
let accumulatedZoomDelta = 1.0;

function zoomAroundPlayhead(factor: number) {
  const container = (document.getElementById("timeline-multi-track-scroll") || dom.timelineClipsContainer?.querySelector("#timeline-multi-track-scroll") || dom.timelineClipsContainer) as HTMLElement | null;
  const ppsBefore = getPixelsPerSecond();
  const playheadX = (state.videoPauseTime || 0) * ppsBefore;
  const scrollBefore = container?.scrollLeft || 0;
  const rel = playheadX - scrollBefore;

  const targetZoom = Math.min(utils.MAX_ZOOM, Math.max(utils.MIN_ZOOM, timelineState.zoomLevel * factor));
  if (Math.abs(targetZoom - timelineState.zoomLevel) < 0.001) return;

  timelineState.setZoomLevel(targetZoom);

  const ppsAfter = getPixelsPerSecond();
  const playheadXAfter = (state.videoPauseTime || 0) * ppsAfter;
  if (container) {
    container.scrollLeft = Math.max(0, playheadXAfter - rel);
  }
}

export function handleTimelineZoomIn() {
  zoomAroundPlayhead(1.25);
}

export function handleTimelineZoomOut() {
  zoomAroundPlayhead(0.8);
}

export function handleTimelineZoomFit() {
  if (!videoRenderContext) return;
  const container = (document.getElementById("timeline-multi-track-scroll") || dom.timelineClipsContainer?.querySelector("#timeline-multi-track-scroll") || dom.timelineClipsContainer) as HTMLElement | null;
  const containerWidth = container?.clientWidth || dom.timelineClipsContainer?.clientWidth || 0;
  if (containerWidth <= 0) return;
  
  const totalDuration = videoRenderContext.totalDuration;
  if (totalDuration <= 0) {
    timelineState.setZoomLevel(1);
    return;
  }

  const targetWidth = Math.max(200, containerWidth - 30);
  const requiredPps = targetWidth / totalDuration;
  const newZoom = requiredPps / utils.BASE_PIXELS_PER_SECOND;
  timelineState.setZoomLevel(utils.clamp(newZoom, utils.MIN_ZOOM, utils.MAX_ZOOM));
  
  if (container) {
    container.scrollLeft = 0;
  }
}

export function handleTimelineWheelZoom(event: WheelEvent) {
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 1.12 : 0.89;
  accumulatedZoomDelta *= zoomFactor;

  if (wheelZoomRaf === null) {
    wheelZoomRaf = requestAnimationFrame(() => {
      wheelZoomRaf = null;
      const factor = accumulatedZoomDelta;
      accumulatedZoomDelta = 1.0;
      zoomAroundPlayhead(factor);
    });
  }
}

export function applyTransitionToClip(clipId: string, transitionName: string, applyToAll = false) {
  if (!timelineState.clips?.length) return;

  timelineState.saveSnapshot();
  const clipIndex = timelineState.clips.findIndex(c => c.id === clipId || String(c.id) === String(clipId));

  const newClips = timelineState.clips.map((c, i) => {
    if (applyToAll) {
      if (i === timelineState.clips.length - 1) return c;
      return { ...c, transitionToNext: transitionName };
    } else if (c.id === clipId || String(c.id) === String(clipId) || (clipIndex >= 0 && i === clipIndex)) {
      return { ...c, transitionToNext: transitionName };
    }
    return c;
  });

  timelineState.setClips(newClips);

  // Synchronize to state.currentScenes for export & storage persistence
  if (state.currentScenes && Array.isArray(state.currentScenes)) {
    state.currentScenes.forEach((s: any, sIdx: number) => {
      const lines = s.lines || [s];
      lines.forEach((l: any, lIdx: number) => {
        if (applyToAll) {
          l.transitionToNext = transitionName;
          l.transition = transitionName;
        } else if (l.id === clipId || String(l.id) === String(clipId) || (clipIndex >= 0 && (sIdx * 100 + lIdx) === clipIndex)) {
          l.transitionToNext = transitionName;
          l.transition = transitionName;
        }
      });
    });
  }

  // Update button to indicate cinematic transitions are active
  if (dom.analyzeTransitionsBtn) {
    dom.analyzeTransitionsBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'bg-zinc-800/90', 'hover:bg-zinc-700');
    dom.analyzeTransitionsBtn.classList.add('bg-green-600', 'hover:bg-green-700', 'text-white');
    dom.analyzeTransitionsBtn.innerHTML = '✅ Analyzed';
  }

  updateVideoContext();
  if (!state.isVideoPlaying && videoRenderContext) {
    drawVideoFrame(state.videoPauseTime);
  }
  saveVersion(false);

  const label = utils.getTransitionLabel(transitionName);
  ui.showStatus(applyToAll ? `Applied ${label} transition to ALL shots` : `Shot ${clipIndex >= 0 ? clipIndex + 1 : ''} transition set to ${label}`, false, 2500);
}

export function randomizeAllTransitions() {
  if (!timelineState.clips?.length || timelineState.clips.length < 2) return;
  const options = ['cross_dissolve', 'blur_dissolve', 'zoom_dissolve', 'swipe_left', 'swipe_right', 'swipe_up', 'swipe_down', 'fade_to_black', 'fade_to_white', 'wipe', 'push'];
  const newClips = timelineState.clips.map((c, i) => {
    if (i === timelineState.clips.length - 1) return c;
    const randomTrans = options[Math.floor(Math.random() * options.length)];
    return { ...c, transitionToNext: randomTrans };
  });

  timelineState.setClips(newClips);

  if (state.currentScenes && Array.isArray(state.currentScenes)) {
    state.currentScenes.forEach((s: any) => {
      const lines = s.lines || [s];
      lines.forEach((l: any, lIdx: number) => {
        const matchingClip = newClips.find(c => c.id === l.id || String(c.id) === String(l.id)) || newClips[lIdx];
        if (matchingClip?.transitionToNext) {
          l.transitionToNext = matchingClip.transitionToNext;
          l.transition = matchingClip.transitionToNext;
        }
      });
    });
  }

  if (dom.analyzeTransitionsBtn) {
    dom.analyzeTransitionsBtn.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'bg-zinc-800/90', 'hover:bg-zinc-700');
    dom.analyzeTransitionsBtn.classList.add('bg-green-600', 'hover:bg-green-700', 'text-white');
    dom.analyzeTransitionsBtn.innerHTML = '✅ Analyzed';
  }

  updateVideoContext();
  if (!state.isVideoPlaying && videoRenderContext) {
    drawVideoFrame(state.videoPauseTime);
  }
  saveVersion(false);
  ui.showStatus('Randomized cinematic transitions across all shots', false, 2500);
}

export function showTransitionPickerModal(clipId: string, clipIndex: number) {
  let modal = document.getElementById('timeline-transition-picker-modal') as HTMLDivElement;
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'timeline-transition-picker-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 hidden';
    document.body.appendChild(modal);
  }

  const clips = timelineState.clips;
  const clip = clips.find(c => c.id === clipId || String(c.id) === String(clipId)) || clips[clipIndex];
  if (!clip) return;

  const currentTrans = clip.transitionToNext || 'cut';
  const nextClipNum = clipIndex + 2;
  const shotNum = clipIndex + 1;

  const transitionsList = [
    { id: 'cut', label: 'Hard Cut', icon: '⚡', desc: 'Direct, instant cut with no blending effect' },
    { id: 'cross_dissolve', label: 'Cross Dissolve', icon: '✨', desc: 'Smooth, classic alpha fade blend between shots' },
    { id: 'blur_dissolve', label: 'Blur Dissolve', icon: '🌫️', desc: 'Cinematic gaussian blur crossfade' },
    { id: 'zoom_dissolve', label: 'Zoom Dissolve', icon: '🔍', desc: 'Dynamic push-pull zoom blur blend' },
    { id: 'swipe_left', label: 'Swipe Left', icon: '⬅️', desc: 'Next shot slides in from right to left' },
    { id: 'swipe_right', label: 'Swipe Right', icon: '➡️', desc: 'Next shot slides in from left to right' },
    { id: 'swipe_up', label: 'Swipe Up', icon: '⬆️', desc: 'Next shot slides up from bottom' },
    { id: 'swipe_down', label: 'Swipe Down', icon: '⬇️', desc: 'Next shot slides down from top' },
    { id: 'fade_to_black', label: 'Fade to Black', icon: '⬛', desc: 'Fades down to black and rises into next shot' },
    { id: 'fade_to_white', label: 'Fade to White', icon: '⬜', desc: 'Fades up to white flash and resolves to next shot' },
    { id: 'wipe', label: 'Wipe', icon: '🧹', desc: 'Horizontal line wipe reveal' },
    { id: 'push', label: 'Push', icon: '⏩', desc: 'Incoming shot pushes outgoing shot offscreen' },
  ];

  modal.innerHTML = `
    <div class="bg-gray-900 border border-gray-700/80 rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative overflow-hidden">
      <div class="flex items-center justify-between pb-4 border-b border-gray-800">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-xl">
            🎬
          </div>
          <div>
            <h3 class="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              Visual Transition: Shot ${shotNum} ➔ Shot ${nextClipNum}
            </h3>
            <p class="text-xs text-gray-400">Select the visual transition effect connecting these timeline clips.</p>
          </div>
        </div>
        <button id="close-trans-picker-btn" class="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition">
          ✕
        </button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 my-5 max-h-[50vh] overflow-y-auto pr-1 custom-scrollbar">
        ${transitionsList.map(t => {
          const isSelected = (currentTrans === t.id) || (currentTrans.replace(/_/g, '') === t.id.replace(/_/g, ''));
          return `
            <div class="trans-option-card border rounded-xl p-3 cursor-pointer transition-all flex flex-col justify-between ${
              isSelected
                ? 'border-indigo-500 bg-indigo-950/40 ring-2 ring-indigo-500/50 shadow-lg scale-[1.02]'
                : 'border-gray-800 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/80'
            }" data-trans-id="${t.id}">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-lg">${t.icon}</span>
                <span class="font-bold text-sm text-white">${t.label}</span>
              </div>
              <p class="text-[11px] text-gray-400 leading-snug">${t.desc}</p>
              ${isSelected ? '<span class="text-[10px] text-indigo-400 font-semibold mt-2 flex items-center gap-1">✓ Active</span>' : ''}
            </div>
          `;
        }).join('')}
      </div>

      <div class="pt-4 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button id="apply-all-trans-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs py-2 px-3 rounded-lg transition flex items-center gap-1.5 shadow">
            🌐 Apply Selected to ALL Shots
          </button>
          <button id="randomize-trans-btn" class="bg-purple-600/80 hover:bg-purple-600 text-white font-semibold text-xs py-2 px-3 rounded-lg transition flex items-center gap-1.5">
            🎲 Randomize All
          </button>
        </div>
        <button id="done-trans-picker-btn" class="bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xs py-2 px-4 rounded-lg transition ml-auto">
          Done
        </button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');

  const closeBtn = modal.querySelector('#close-trans-picker-btn');
  const doneBtn = modal.querySelector('#done-trans-picker-btn');
  const applyAllBtn = modal.querySelector('#apply-all-trans-btn');
  const randomizeBtn = modal.querySelector('#randomize-trans-btn');

  const closeModal = () => modal.classList.add('hidden');

  closeBtn?.addEventListener('click', closeModal);
  doneBtn?.addEventListener('click', closeModal);

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };

  let selectedTransId = currentTrans;

  const optionCards = modal.querySelectorAll('.trans-option-card');
  optionCards.forEach(card => {
    card.addEventListener('click', () => {
      const transId = (card as HTMLElement).dataset.transId;
      if (transId) {
        selectedTransId = transId;
        applyTransitionToClip(clipId, transId, false);
        showTransitionPickerModal(clipId, clipIndex);
      }
    });
  });

  applyAllBtn?.addEventListener('click', () => {
    applyTransitionToClip(clipId, selectedTransId, true);
    closeModal();
  });

  randomizeBtn?.addEventListener('click', () => {
    randomizeAllTransitions();
    closeModal();
  });
}
registerUpdateVideoContext(updateVideoContext);
