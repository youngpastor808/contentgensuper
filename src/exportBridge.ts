/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless export bridge.
 *
 * Loaded ONLY when the app boots with ?exportMode=1 (see index.tsx).
 * A headless Chromium instance (server/cloudCanvasWorker.ts) drives this
 * module directly via page.evaluate() — it is the sole interface between
 * the Node render worker and the browser's real rendering code.
 *
 * The point of this file is to reconstruct the exact same `state` /
 * `timelineState` shape the live editor has when the user is watching the
 * preview, then call the same `drawVideoFrame()` the preview canvas calls.
 * If it renders correctly in the editor, it will render identically here.
 */
import { state } from './state';
import { timelineState } from './state-timeline';
import { drawVideoFrame, setVideoRenderContext, type TimelineClip } from './videoRenderer';
import { updateVideoContext } from './videoContextBridge';
import { syncVideosForExportTime, drawExportFrameCached } from './exporter/frames';
import { setVideoCanvasForExport } from './dom';
import { prepareExportOptimizedImages, clearExportOptimizedImages } from './exporter/image-prescaler';
import { disposeExportFrameSource } from './exporter/video-frame-source';
import { prepareParallaxDepth } from './parallax/adapter';
import { aliasDepth } from './parallax/depth';
import {
  type CanonicalExportPayload,
  type CanonicalClipPayload,
  buildCanonicalExportPayload,
} from './exporter/canonical-payload';

export type ExportClipPayload = CanonicalClipPayload;
export type ExportProjectPayload = CanonicalExportPayload;

let exportCanvas: HTMLCanvasElement | null = null;
let exportCtx: CanvasRenderingContext2D | null = null;
let exportFps = 30;

function normalizeAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  // If the asset is served from our own cloud render assets endpoint, use relative path to keep it strictly same-origin
  if (url.includes('/api/cloud-render/assets/')) {
    const idx = url.indexOf('/api/cloud-render/assets/');
    return url.slice(idx);
  }
  return url;
}

function loadImage(rawUrl?: string): Promise<HTMLImageElement | undefined> {
  const url = normalizeAssetUrl(rawUrl);
  if (!url) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result?: HTMLImageElement) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const img = new Image();
    // Use anonymous crossOrigin only for absolute external URLs; relative URLs are same-origin
    if (url.startsWith('http://') || url.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => finish(img);
    img.onerror = () => {
      // Fallback: try loading without crossOrigin if first attempt failed
      if (img.crossOrigin) {
        const fallbackImg = new Image();
        fallbackImg.onload = () => finish(fallbackImg);
        fallbackImg.onerror = () => {
          console.warn('[ExportBridge] Failed to load image', url);
          finish(undefined);
        };
        fallbackImg.src = url;
      } else {
        console.warn('[ExportBridge] Failed to load image', url);
        finish(undefined);
      }
    };
    img.src = url;

    // Safety timeout: never hang the export bridge if an image stalls
    setTimeout(() => {
      if (!settled) {
        console.warn('[ExportBridge] Image load timed out, continuing:', url);
        finish(undefined);
      }
    }, 8000);
  });
}

function loadVideo(rawUrl?: string): Promise<HTMLVideoElement | undefined> {
  const url = normalizeAssetUrl(rawUrl);
  if (!url) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result?: HTMLVideoElement) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const vid = document.createElement('video');
    if (url.startsWith('http://') || url.startsWith('https://')) {
      vid.crossOrigin = 'anonymous';
    }
    vid.muted = true;
    vid.preload = 'auto';
    (vid as any).playsInline = true;
    vid.onloadeddata = () => finish(vid);
    vid.onerror = () => {
      console.warn('[ExportBridge] Failed to load video', url);
      finish(undefined);
    };
    vid.src = url;
    vid.load();

    // Safety timeout: never hang the export bridge if a video stream stalls
    setTimeout(() => {
      if (!settled) {
        console.warn('[ExportBridge] Video load timed out, continuing:', url);
        finish(undefined);
      }
    }, 8000);
  });
}

async function seekVideoTo(vid: HTMLVideoElement | undefined, t: number): Promise<void> {
  if (!vid) return;
  const target = Math.max(0, t);
  if (Math.abs(vid.currentTime - target) < 0.033) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      vid.removeEventListener('seeked', done);
      resolve();
    };
    vid.addEventListener('seeked', done);
    vid.currentTime = target;
    // Safety timeout in case a 'seeked' event never fires for this asset.
    setTimeout(done, 800);
  });
}

async function init(rawPayload: any): Promise<{ width: number; height: number }> {
  // Normalize through the single canonical export payload builder
  const payload = buildCanonicalExportPayload({ inputProps: rawPayload });
  exportFps = payload.fps || 30;
  exportCanvas = document.createElement('canvas');
  exportCanvas.id = 'export-render-canvas';
  exportCanvas.width = payload.resolutionWidth;
  exportCanvas.height = payload.resolutionHeight;
  document.body.appendChild(exportCanvas);
  setVideoCanvasForExport(exportCanvas);
  exportCtx = exportCanvas.getContext('2d', {
    alpha: false,
    desynchronized: true,
  }) as CanvasRenderingContext2D;

  // 1. Global project settings — mirror exactly what the editor has set,
  //    via the SAME setters the editor UI calls, so downstream code paths
  //    (subtitle style registry, transition scheduling, effects, graphics)
  //    behave identically to the live preview.
  state.aspectRatio = payload.aspectRatio as any;
  state.activeFilterName = payload.activeFilterName || 'none';
  state.cinematicVignette = Boolean(payload.cinematicVignette);
  state.uiTextOverlays = Array.isArray(payload.uiTextOverlays) ? payload.uiTextOverlays : [];
  state.motionGraphicsEnabled = Boolean(payload.motionGraphicsEnabled);
  state.overlayIntensity = (payload.overlayIntensity as any) || 'medium';
  state.graphicsTheme = payload.graphicsTheme || 'minimal';
  state.graphicsAccentColor = payload.graphicsAccentColor || '#F5C542';

  timelineState.setMode(payload.mode || 'free');
  timelineState.setShowSubtitles(Boolean(payload.showSubtitles));
  timelineState.setVideoSubtitleStyle(payload.videoSubtitleStyle || 'anime');
  timelineState.setVideoSubtitlePosition(payload.videoSubtitlePosition || 'bottom');
  if (payload.videoSubtitleFont) timelineState.setVideoSubtitleFont(payload.videoSubtitleFont);
  state.videoSubtitleColors = (payload.videoSubtitleColors && typeof payload.videoSubtitleColors === 'object') ? payload.videoSubtitleColors : {};
  timelineState.setVideoTransitionStyle(payload.videoTransitionStyle || 'narrative_guided');
  timelineState.setVideoEffects(payload.videoEffects || {});
  timelineState.setGlobalSilences(payload.globalSilences || null);

  if (Array.isArray(payload.graphics) && payload.graphics.length > 0) {
    (timelineState as any)._graphics = payload.graphics;
  }

  const workerHasAudioPayload = Boolean(
    payload.masterAudioUrl || payload.audioUrl
  );

  if (workerHasAudioPayload) {
    throw new Error(
      'Electron export worker received audio payload, but real worker-side audio hydration is not implemented.'
    );
  }

  timelineState.setMasterAudioBuffer(null);

  // 2. Preload every clip's real media elements (primary, overlay, talking head, secondary, background plates).
  const resolvedClips: TimelineClip[] = await Promise.all(
    payload.clips.map(async (c) => {
      const [
        image,
        videoElement,
        overlayImage,
        talkingHeadVideoElement,
        secondaryImage,
        secondaryVideoElement,
        backgroundPlate,
      ] = await Promise.all([
        loadImage(c.imageUrl),
        loadVideo(c.videoUrl),
        loadImage(c.overlayImageUrl),
        loadVideo(c.talkingHeadVideoUrl),
        loadImage(c.secondaryImageUrl),
        loadVideo(c.secondaryVideoUrl),
        loadImage(c.backgroundPlateUrl),
      ]);

      return {
        id: c.id,
        image,
        videoElement,
        overlayImage,
        talkingHeadVideoElement,
        secondaryImage,
        secondaryVideoElement,
        backgroundPlate,
        secondary_image_id: c.secondary_image_id,
        secondary_video_id: c.secondary_video_id,
        talkingHeadRole: c.talkingHeadRole,
        duration: c.duration,
        startTime: c.startTime,
        endTime: c.endTime,
        cameraMovement: c.cameraMovement || c.camera_movement || 'slow_zoom_in',
        cameraKeyframes: c.cameraKeyframes,
        transitionToNext: c.transitionToNext || 'cut',
        _transitionDuration: c.transitionDuration,
        text: c.text || '',
        wordTimestamps: c.wordTimestamps as any,
        wordRange: c.wordRange,
        talkingHeadMode: c.talkingHeadMode || 'none',
        talkingHeadShape: c.talkingHeadShape || 'rounded',
        talkingHeadSize: c.talkingHeadSize,
        displayMode: c.displayMode,
        pipPosition: c.pipPosition as any,
        pipX: c.pipX,
        pipY: c.pipY,
        pipAnchorX: c.pipAnchorX,
        pipAnchorY: c.pipAnchorY,
        pipScale: c.pipScale,
        pipAnimation: c.pipAnimation as any,
        pipBorderColor: c.pipBorderColor,
        hasCornerMapCallout: Boolean(c.hasCornerMapCallout),
        cornerCalloutLabel: c.cornerCalloutLabel || '',
        cornerCalloutCoords: c.cornerCalloutCoords || '',
        overlayPosition: (c.overlayPosition as any) || 'top-right',
        volume: c.volume ?? 1,
        fadeIn: c.fadeIn,
        fadeOut: c.fadeOut,
        useOriginalAudio: c.useOriginalAudio,
        rotate: c.rotate,
        focalPoint: c.focalPoint,
        playbackRate: c.playbackRate ?? 1,
        videoStartOffset: c.videoStartOffset ?? 0,
        elements: c.elements,
        deviceTag: c.deviceTag,
      } as TimelineClip;
    })
  );

  timelineState.setClips(resolvedClips, false);
  // Reconcile timeline, calculate transition boundaries, and populate videoRenderContext
  updateVideoContext(true);

  // Pre-scale any high-res image assets to target resolution + motion headroom
  try {
    await prepareExportOptimizedImages(resolvedClips, exportCanvas.width, exportCanvas.height);
    await prepareParallaxDepth(resolvedClips);
    for (const c of (resolvedClips || [])) {
      if (c && c._exportOptimizedImage) {
        aliasDepth(c.backgroundPlate || c.image, c._exportOptimizedImage);
      }
    }
  } catch (optErr) {
    console.warn('[ExportBridge] Could not optimize images, continuing with originals:', optErr);
  }

  return { width: exportCanvas.width, height: exportCanvas.height };
}

async function renderFrame(time: number): Promise<void> {
  if (!exportCanvas || !exportCtx) {
    throw new Error('[ExportBridge] init() was not called before renderFrame()');
  }

  try {
    // Exact same execution pipeline as local browser export:
    // 1. syncVideosForExportTime() seeks all video clips, talking head, B-roll, and overlays to exact target time
    // 2. drawExportFrameCached() uses static bitmap caching and calls drawVideoFrame()
    await syncVideosForExportTime(time, exportFps);
    await drawExportFrameCached(time, exportCanvas, exportCtx);
  } catch (err: any) {
    console.error(`[ExportBridge] Error rendering frame at t=${time}:`, err?.stack || err);
    throw err;
  }
}

function cleanup(): void {
  try {
    clearExportOptimizedImages(timelineState.clips);
  } catch (e) {}
  try {
    void disposeExportFrameSource(timelineState.clips);
  } catch (e) {}
}

function getCanvasId(): string {
  return 'export-render-canvas';
}

(window as any).__exportBridge = { init, renderFrame, cleanup, getCanvasId };
(window as any).__exportBridgeReady = true;
