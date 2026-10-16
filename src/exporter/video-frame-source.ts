/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2 — Sequential & Pair-Blended Video-Frame Source for Local & Electron Export.
 * Adapted from video-studio/src/engine/frame-source.js, src/model/slow-motion.js,
 * and src/review/time.js.
 */

import { Input, BlobSource, ALL_FORMATS, CanvasSink } from 'mediabunny';
import { getExportFlags } from './export-flags';

export type VideoSlotRole = 'primary' | 'talkingHead' | 'secondary';

export type RenderableVideoFrame = (HTMLCanvasElement | OffscreenCanvas) & {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  currentTime: number;
  duration: number;
};

interface SharedAssetEntry {
  src: string;
  input: Input;
  track: any;
  width: number;
  height: number;
  duration: number;
  fps: number;
}

interface WrappedCanvasFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration?: number;
}

interface ClipSlotCursor {
  cursorKey: string;
  src: string;
  sink: CanvasSink;
  pairSink: CanvasSink;
  iterator: AsyncGenerator<WrappedCanvasFrame, void, unknown> | null;
  curr: WrappedCanvasFrame | null;
  next: WrappedCanvasFrame | null;
  blendCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  lastTargetSec: number;
  failed: boolean;
}

export interface VideoSyncTelemetry {
  sequentialHits: number;
  sequentialResets: number;
  blendedSlowMoFrames: number;
  htmlFallbackSeeks: number;
  htmlSeekTimeouts: number;
}

const telemetry: VideoSyncTelemetry = {
  sequentialHits: 0,
  sequentialResets: 0,
  blendedSlowMoFrames: 0,
  htmlFallbackSeeks: 0,
  htmlSeekTimeouts: 0,
};

export function resetVideoSyncTelemetry(): void {
  telemetry.sequentialHits = 0;
  telemetry.sequentialResets = 0;
  telemetry.blendedSlowMoFrames = 0;
  telemetry.htmlFallbackSeeks = 0;
  telemetry.htmlSeekTimeouts = 0;
}

export function getVideoSyncTelemetry(): VideoSyncTelemetry {
  return { ...telemetry };
}

export function recordHtmlSeek(timedOut = false): void {
  telemetry.htmlFallbackSeeks++;
  if (timedOut) telemetry.htmlSeekTimeouts++;
}

export function isSequentialVideoExportEnabled(): boolean {
  return getExportFlags().useSequentialVideoDecoder;
}

/**
 * Ported from video-studio/src/review/time.js (seekSeconds):
 * Targets the temporal center of the frame ((frameIndex + 0.5) / fps) so
 * rounding in the demuxer/decoder never lands on the neighboring frame.
 */
export function seekMidFrameSeconds(sec: number, fps = 30): number {
  if (!getExportFlags().useMidFrameSeeking) return Math.max(0, sec);
  const f = Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : 30;
  const frameIdx = Math.max(0, Math.floor((Math.max(0, sec) + 0.5 / 1_000_000) * f));
  return (frameIdx + 0.5) / f;
}

/**
 * Ported from video-studio/src/model/slow-motion.js:
 * Position of source time `sec` between consecutive frames `a` and `b` (0..1).
 */
export const FRAME_SNAP = 1e-3;

export function framePosition(sec: number, a: number, b: number): number {
  if (!(b > a)) return 0;
  return Math.min(1, Math.max(0, (sec - a) / (b - a)));
}

export function needsBetween(frac: number): boolean {
  return frac > FRAME_SNAP && frac < 1 - FRAME_SNAP;
}

const DISCONTINUITY_THRESHOLD_SEC = 1.5;

function createScratchCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function attachVideoMetadata(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
  currentTime: number,
  duration: number
): RenderableVideoFrame {
  const renderable = canvas as RenderableVideoFrame;
  renderable.videoWidth = (canvas as any).width || width;
  renderable.videoHeight = (canvas as any).height || height;
  renderable.readyState = 4;
  renderable.currentTime = currentTime;
  renderable.duration = duration;
  return renderable;
}

export class ExportVideoFrameSource {
  private assets = new Map<string, Promise<SharedAssetEntry | null>>();
  private cursors = new Map<string, ClipSlotCursor>();
  private maxDecodeHeight: number;

  constructor(maxDecodeHeight = 2160) {
    this.maxDecodeHeight = maxDecodeHeight;
  }

  private async getOrOpenAsset(src: string): Promise<SharedAssetEntry | null> {
    if (!src) return null;
    let pending = this.assets.get(src);
    if (!pending) {
      pending = (async () => {
        try {
          const response = await fetch(src);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) {
            input.dispose();
            return null;
          }
          const duration = (await track.computeDuration().catch(() => 0)) || 0;
          const width =
            (await track.getDisplayWidth?.().catch(() => 0)) ||
            track.displayWidth ||
            track.codedWidth ||
            1920;
          const height =
            (await track.getDisplayHeight?.().catch(() => 0)) ||
            track.displayHeight ||
            track.codedHeight ||
            1080;
          let fps = 30;
          try {
            const stats = await track.computePacketStats?.(60);
            if (stats?.averagePacketRate) {
              fps = Math.round(stats.averagePacketRate * 100) / 100;
            }
          } catch {}
          return { src, input, track, width, height, duration, fps };
        } catch (err) {
          console.warn(
            '[ExportVideoFrameSource] Asset open failed, using HTMLVideoElement fallback:',
            src,
            err
          );
          return null;
        }
      })();
      this.assets.set(src, pending);
    }
    return pending;
  }

  /**
   * Resolves the decoded frame at `rawSourceSec` for a specific `(clipId, role)` cursor.
   * Returns null if decoding is unsupported or fails, signaling caller to use HTMLVideoElement fallback.
   */
  async getFrameForClipSlot(
    clipId: string,
    role: VideoSlotRole,
    videoEl: HTMLVideoElement,
    rawSourceSec: number,
    shouldLoop = false,
    blendSlowMotion = false
  ): Promise<RenderableVideoFrame | null> {
    const src = videoEl.currentSrc || videoEl.src;
    if (!src) return null;

    const asset = await this.getOrOpenAsset(src);
    if (!asset) return null;

    const effectiveDuration =
      asset.duration > 0
        ? asset.duration
        : Number.isFinite(videoEl.duration) && videoEl.duration > 0
        ? videoEl.duration
        : 0;

    let targetSec = Math.max(0, rawSourceSec);
    if (effectiveDuration > 0) {
      if (shouldLoop) {
        targetSec = ((targetSec % effectiveDuration) + effectiveDuration) % effectiveDuration;
      } else {
        targetSec = Math.min(targetSec, Math.max(0, effectiveDuration - 0.001));
      }
    }

    const cursorKey = `${clipId}::${role}`;
    let cursor = this.cursors.get(cursorKey);

    if (!cursor || cursor.src !== src) {
      if (cursor) await this.releaseCursor(cursorKey);
      const targetH = Math.min(this.maxDecodeHeight, asset.height || this.maxDecodeHeight);
      const sink = new CanvasSink(asset.track, {
        height: targetH,
        fit: 'contain',
        poolSize: 3, // Strictly bounded: curr + next + 1 scratch canvas
      });
      const pairSink = new CanvasSink(asset.track, {
        height: targetH,
        fit: 'contain',
        poolSize: 4, // Secondary pool for frame-pair access (video-studio parity)
      });
      cursor = {
        cursorKey,
        src,
        sink,
        pairSink,
        iterator: null,
        curr: null,
        next: null,
        blendCanvas: null,
        lastTargetSec: -1,
        failed: false,
      };
      this.cursors.set(cursorKey, cursor);
    }

    if (cursor.failed) return null;

    try {
      const soughtBackward = targetSec < cursor.lastTargetSec - 1e-4;
      const refTimestamp = cursor.next ? cursor.next.timestamp : cursor.curr?.timestamp ?? -Infinity;
      const jumpedDiscontinuously =
        !cursor.curr || targetSec - refTimestamp > DISCONTINUITY_THRESHOLD_SEC;

      if (!cursor.iterator || soughtBackward || jumpedDiscontinuously) {
        telemetry.sequentialResets++;
        await cursor.iterator?.return?.();
        cursor.iterator = cursor.sink.canvases(targetSec) as AsyncGenerator<
          WrappedCanvasFrame,
          void,
          unknown
        >;
        const first = await cursor.iterator.next();
        cursor.curr = first.done ? null : (first.value ?? null);
        if (cursor.curr) {
          const second = await cursor.iterator.next();
          cursor.next = second.done ? null : (second.value ?? null);
        } else {
          cursor.next = null;
        }
      } else {
        // Sequential advance: step through decoded frames until `next` is ahead of `targetSec`
        while (cursor.next && cursor.next.timestamp <= targetSec + 1e-4) {
          cursor.curr = cursor.next;
          const step = await cursor.iterator.next();
          cursor.next = step.done ? null : (step.value ?? null);
        }
      }

      cursor.lastTargetSec = targetSec;

      if (!cursor.curr) {
        return null;
      }

      telemetry.sequentialHits++;

      // Automatic frame-blending when clip plays slower than 1x
      const isSlowed =
        blendSlowMotion || (videoEl.playbackRate > 0 && videoEl.playbackRate < 1 - 1e-3);
      if (isSlowed && cursor.next) {
        const frac = framePosition(targetSec, cursor.curr.timestamp, cursor.next.timestamp);
        if (needsBetween(frac)) {
          const w = (cursor.curr.canvas as any).width || asset.width;
          const h = (cursor.curr.canvas as any).height || asset.height;
          if (
            !cursor.blendCanvas ||
            (cursor.blendCanvas as any).width !== w ||
            (cursor.blendCanvas as any).height !== h
          ) {
            cursor.blendCanvas = createScratchCanvas(w, h);
          }
          const ctx = cursor.blendCanvas.getContext('2d') as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
          if (ctx) {
            ctx.clearRect(0, 0, w, h);
            ctx.globalAlpha = 1;
            ctx.drawImage(cursor.curr.canvas as CanvasImageSource, 0, 0, w, h);
            ctx.globalAlpha = frac;
            ctx.drawImage(cursor.next.canvas as CanvasImageSource, 0, 0, w, h);
            ctx.globalAlpha = 1;
            telemetry.blendedSlowMoFrames++;
            return attachVideoMetadata(cursor.blendCanvas, w, h, targetSec, effectiveDuration);
          }
        }
      }

      return attachVideoMetadata(
        cursor.curr.canvas,
        asset.width,
        asset.height,
        targetSec,
        effectiveDuration
      );
    } catch (err) {
      console.warn('[ExportVideoFrameSource] Decode iteration error for cursor:', cursorKey, err);
      cursor.failed = true;
      await cursor.iterator?.return?.().catch(() => {});
      cursor.iterator = null;
      return null;
    }
  }

  /**
   * Ported from video-studio/src/engine/frame-source.js (pair):
   * Fetches two consecutive frames `{ a, b }` around `sec` using the isolated `pairSink`.
   */
  async getFramePairForClipSlot(
    clipId: string,
    role: VideoSlotRole,
    videoEl: HTMLVideoElement,
    sec: number
  ): Promise<{ a: WrappedCanvasFrame; b: WrappedCanvasFrame | null } | null> {
    const src = videoEl.currentSrc || videoEl.src;
    if (!src) return null;
    const asset = await this.getOrOpenAsset(src);
    if (!asset) return null;

    const cursorKey = `${clipId}::${role}`;
    let cursor = this.cursors.get(cursorKey);
    if (!cursor) {
      await this.getFrameForClipSlot(clipId, role, videoEl, sec);
      cursor = this.cursors.get(cursorKey);
    }
    if (!cursor || cursor.failed) return null;

    const it = cursor.pairSink.canvases(Math.max(0, sec)) as AsyncGenerator<
      WrappedCanvasFrame,
      void,
      unknown
    >;
    try {
      const first = await it.next();
      if (first.done || !first.value) return null;
      const second = await it.next();
      return {
        a: first.value,
        b: second.done ? null : (second.value ?? null),
      };
    } catch {
      return null;
    } finally {
      await it.return?.().catch(() => {});
    }
  }

  async releaseCursor(cursorKey: string): Promise<void> {
    const cursor = this.cursors.get(cursorKey);
    if (!cursor) return;
    this.cursors.delete(cursorKey);
    try {
      await cursor.iterator?.return?.();
    } catch {}
    cursor.iterator = null;
    cursor.curr = null;
    cursor.next = null;
    cursor.blendCanvas = null;
  }

  /**
   * Releases decoders for clips that are no longer within the active timeline window.
   */
  async retainOnlyActiveCursors(activeCursorKeys: Set<string>): Promise<void> {
    const allKeys = Array.from(this.cursors.keys());
    for (const key of allKeys) {
      if (!activeCursorKeys.has(key)) {
        await this.releaseCursor(key);
      }
    }
  }

  async dispose(): Promise<void> {
    const cursorKeys = Array.from(this.cursors.keys());
    for (const key of cursorKeys) {
      await this.releaseCursor(key);
    }
    const pendingAssets = Array.from(this.assets.values());
    this.assets.clear();
    for (const p of pendingAssets) {
      try {
        const asset = await p;
        asset?.input?.dispose?.();
      } catch {}
    }
  }
}

let sharedExportFrameSource: ExportVideoFrameSource | null = null;

export function getOrCreateExportFrameSource(maxDecodeHeight = 2160): ExportVideoFrameSource {
  if (!sharedExportFrameSource) {
    sharedExportFrameSource = new ExportVideoFrameSource(maxDecodeHeight);
  }
  return sharedExportFrameSource;
}

export const getExportFrameSource = getOrCreateExportFrameSource;

export async function disposeExportFrameSource(_clips?: any): Promise<void> {
  if (!sharedExportFrameSource) return;
  const instance = sharedExportFrameSource;
  sharedExportFrameSource = null;
  await instance.dispose();
}

