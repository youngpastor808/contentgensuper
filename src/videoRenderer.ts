/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as utils from './utils';
import { SubtitleEngine } from './subtitle-engine';
import { drawGraphics, drawElementBuild } from './graphics-engine';
import type { WordTimestamp, ElementRevealEvent, DeviceTag } from './types';
import { drawWebGLParallax, cleanupWebGL } from './parallax/adapter';
import { t0, t1 } from './perfMonitor';
import { ActiveClipIndex, linearFind } from './activeClipIndex';
import { isInteracting } from './interaction';
import { acquireUrl, dropOwner } from './mediaUrlRegistry';

const activeClipIndex = new ActiveClipIndex();
let devCheck = 0;

export type TimelineClip = {
  id: string;
  image?: HTMLImageElement;
  videoElement?: HTMLVideoElement;
  _exportVideoFrame?: any;
  _exportTalkingHeadFrame?: any;
  _exportSecondaryFrame?: any;
  _exportVideoFrameCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
  _exportTalkingHeadCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
  _exportSecondaryCanvas?: HTMLCanvasElement | OffscreenCanvas | null;
  _videoObjectURL?: string;
  _imageObjectURL?: string;
  videoStartOffset?: number;
  duration: number;
  startTime: number;
  endTime: number;
  cameraMovement: string;
  cameraKeyframes?: any;
  transitionToNext: string;
  text: string;
  focalPoint?: { x: number; y: number };
  wordTimestamps?: WordTimestamp[];
  wordRange?: { start: number; end: number }; // Persistent mapping to global transcript indices
  _sfxBuffer?: AudioBuffer;

  elements?: ElementRevealEvent[];
  backgroundPlate?: HTMLImageElement; // the empty background from Piece A
  
  // Talking Head Overlay / A-Roll Layer
  talkingHeadMode?: string;
  talkingHeadShape?: 'circle' | 'rounded' | 'square';
  talkingHeadSize?: 'small' | 'medium' | 'large';
  talkingHeadVideoElement?: HTMLVideoElement;
  secondaryImage?: HTMLImageElement;
  secondaryVideoElement?: HTMLVideoElement;
  _secondaryImageObjectURL?: string;
  _secondaryVideoObjectURL?: string;
  secondary_image_id?: string | null;
  secondary_video_id?: string | null;
  preserveContent?: boolean;
  talkingHeadRole?: 'primary' | 'secondary';
  useOriginalAudio?: boolean;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  playbackRate?: number;
  audioDuckingOverride?: boolean;
  video_id?: string | null;
  rotate?: 0 | 90 | 180 | 270;
  deviceTag?: DeviceTag;

  // Picture-in-Picture / Corner Callout Overlay (e.g. Documentary Map Callout)
  overlayImage?: HTMLImageElement;
  overlayImageUrl?: string;
  overlayVideoElement?: HTMLVideoElement;
  overlayPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

  displayMode?: 'fullscreen' | 'pip_overlay';
  pipPosition?: 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left' | 'center_right' | 'center_left' | 'custom';
  pipX?: number; // 0..1 normalized horizontal center anchor
  pipY?: number; // 0..1 normalized vertical center anchor
  pipAnchorX?: number; // 0..1 horizontal anchor point (defaults to 0.5 center)
  pipAnchorY?: number; // 0..1 vertical anchor point (defaults to 0.5 center)
  pipScale?: number;
  pipAnimation?: 'pop_spring' | 'slide_in' | 'zoom_fade';
  pipBorderColor?: string;
  isARollBase?: boolean;
  colorFilter?: string;
  colorFilterIntensity?: number;

  // Pre-calculated transition boundaries (absolute times)
  _transitionStart?: number;  // When transition begins (global time)
  _transitionEnd?: number;    // When transition ends (global time)
  _transitionDuration?: number; // Duration of transition
  _exportOptimizedImage?: CanvasImageSource | ImageBitmap | HTMLCanvasElement;
};

export function getClipVideoDrawable(
  clip: any,
  role: 'primary' | 'talkingHead' | 'secondary' = 'primary'
): HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | undefined {
  if (!clip) return undefined;
  if (state.isExporting) {
    if (role === 'talkingHead' && (clip._exportTalkingHeadFrame || clip._exportTalkingHeadCanvas)) return clip._exportTalkingHeadFrame || clip._exportTalkingHeadCanvas;
    if (role === 'secondary' && (clip._exportSecondaryFrame || clip._exportSecondaryCanvas)) return clip._exportSecondaryFrame || clip._exportSecondaryCanvas;
    if (role === 'primary' && (clip._exportVideoFrame || clip._exportVideoFrameCanvas)) return clip._exportVideoFrame || clip._exportVideoFrameCanvas;
  }
  if (role === 'talkingHead') return clip.talkingHeadVideoElement;
  if (role === 'secondary') return clip.secondaryVideoElement;
  return clip.videoElement;
}

export function getShotFilterCss(filter?: string, intensity: number = 1.0): string {
  if (!filter || filter === 'none') return 'none';
  const norm = Math.max(0, Math.min(1, intensity > 1 ? intensity / 100 : intensity));
  if (norm <= 0) return 'none';

  switch (filter) {
    case 'noir':
      return `grayscale(${Math.round(100 * norm)}%) contrast(${Math.round(100 + 40 * norm)}%) brightness(${Math.round(100 - 5 * norm)}%)`;
    case 'noir_grain':
      return `grayscale(${Math.round(100 * norm)}%) contrast(${Math.round(100 + 35 * norm)}%) brightness(${Math.round(100 - 8 * norm)}%)`;
    case 'vintage':
      return `sepia(${Math.round(35 * norm)}%) contrast(${Math.round(100 + 10 * norm)}%) saturate(${Math.round(100 + 20 * norm)}%) brightness(${Math.round(100 - 2 * norm)}%)`;
    case 'sepia':
      return `sepia(${Math.round(85 * norm)}%) contrast(${Math.round(100 + 5 * norm)}%) brightness(${Math.round(100 - 8 * norm)}%)`;
    case 'warm':
      return `sepia(${Math.round(25 * norm)}%) saturate(${Math.round(100 + 45 * norm)}%) contrast(${Math.round(100 + 5 * norm)}%) brightness(${Math.round(100 + 2 * norm)}%)`;
    case 'cool':
      return `saturate(${Math.round(100 - 10 * norm)}%) hue-rotate(${Math.round(185 * norm)}deg) contrast(${Math.round(100 + 10 * norm)}%) brightness(${Math.round(100 - 4 * norm)}%)`;
    case 'cyberpunk':
      return `contrast(${Math.round(100 + 35 * norm)}%) saturate(${Math.round(100 + 75 * norm)}%) hue-rotate(${Math.round(295 * norm)}deg)`;
    case 'technicolor':
      return `saturate(${Math.round(100 + 90 * norm)}%) contrast(${Math.round(100 + 20 * norm)}%) brightness(${Math.round(100 + 2 * norm)}%)`;
    case 'bleach_bypass':
      return `contrast(${Math.round(100 + 45 * norm)}%) saturate(${Math.round(100 - 60 * norm)}%) brightness(${Math.round(100 + 5 * norm)}%)`;
    case 'moody_dark':
      return `brightness(${Math.round(100 - 24 * norm)}%) contrast(${Math.round(100 + 35 * norm)}%) saturate(${Math.round(100 - 15 * norm)}%)`;
    case 'emerald':
      return `saturate(${Math.round(100 + 15 * norm)}%) hue-rotate(${Math.round(85 * norm)}deg) contrast(${Math.round(100 + 15 * norm)}%) brightness(${Math.round(100 - 4 * norm)}%)`;
    case 'crt':
      return `contrast(${Math.round(100 + 20 * norm)}%) saturate(${Math.round(100 + 20 * norm)}%) brightness(${Math.round(100 + 5 * norm)}%)`;
    default:
      return 'none';
  }
}

let grainTileCanvas: HTMLCanvasElement | null = null;

function getFilmGrainTile(): HTMLCanvasElement | null {
  if (grainTileCanvas) return grainTileCanvas;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const gctx = c.getContext('2d');
  if (!gctx) return null;
  const imgData = gctx.createImageData(size, size);
  const data = imgData.data;
  let s = 1337;
  const rand = () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = Math.floor(rand() * 95);
  }
  gctx.putImageData(imgData, 0, 0);
  grainTileCanvas = c;
  return c;
}

function drawFilmGrainOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  time: number,
  opacity: number
) {
  if (opacity <= 0.002) return;
  const tile = getFilmGrainTile();
  if (!tile) return;
  const frameSeed = Math.floor(time * 24);
  const ox = ((frameSeed * 37) % 128);
  const oy = ((frameSeed * 73) % 128);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, opacity);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    ctx.translate(dx - ox, dy - oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(ox, oy, dw, dh);
  }
  ctx.restore();
}

export function applyShotOverlays(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  filter: string,
  intensity: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  time: number = 0
): void {
  if (!filter || filter === 'none') return;
  const norm = Math.max(0, Math.min(1, intensity > 1 ? intensity / 100 : intensity));
  if (norm <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  if (filter === 'noir' || filter === 'noir_grain' || filter === 'moody_dark') {
    const cx = dx + dw / 2;
    const cy = dy + dh / 2;
    const radius = Math.max(dw, dh) * 0.7;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.7, `rgba(0, 0, 0, ${0.2 * norm})`);
    grad.addColorStop(1, `rgba(0, 0, 0, ${0.65 * norm})`);
    ctx.fillStyle = grad;
    ctx.fillRect(dx, dy, dw, dh);

    if (filter === 'noir_grain') {
      drawFilmGrainOverlay(ctx, dx, dy, dw, dh, time, 0.22 * norm);
    }
  } else if (filter === 'crt') {
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${0.15 * norm})`;
    const scanStep = Math.max(3, Math.round(dh / 160));
    for (let sy = dy; sy < dy + dh; sy += scanStep) {
      ctx.fillRect(dx, sy, dw, 1);
    }
    const cx = dx + dw / 2;
    const cy = dy + dh / 2;
    const radius = Math.max(dw, dh) * 0.75;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0, 255, 120, 0)');
    grad.addColorStop(1, `rgba(0, 255, 120, ${0.08 * norm})`);
    ctx.fillStyle = grad;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  } else if (filter === 'warm') {
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const cx = dx + dw * 0.7;
    const cy = dy + dh * 0.3;
    const radius = Math.max(dw, dh) * 0.9;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, `rgba(255, 180, 50, ${0.25 * norm})`);
    grad.addColorStop(1, `rgba(255, 120, 0, ${0.05 * norm})`);
    ctx.fillStyle = grad;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  } else if (filter === 'vintage') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(255, 235, 205, ${0.15 * norm})`;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  } else if (filter === 'cyberpunk') {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    const grad = ctx.createLinearGradient(dx, dy, dx + dw, dy + dh);
    grad.addColorStop(0, `rgba(255, 0, 200, ${0.12 * norm})`);
    grad.addColorStop(1, `rgba(0, 220, 255, ${0.12 * norm})`);
    ctx.fillStyle = grad;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.restore();
  }
  ctx.restore();
}

export function drawRotated(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  rotate: number = 0
) {
  if (!rotate) {
    ctx.drawImage(media, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  ctx.save();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (rotate === 90 || rotate === 270) {
    ctx.drawImage(media, sx, sy, sw, sh, -dh / 2, -dw / 2, dh, dw);
  } else {
    ctx.drawImage(media, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}

const colorStatsCache = new WeakMap<object, { luminance: number; r: number; g: number; b: number }>();

function getImageStats(img: CanvasImageSource, cacheOwner?: object) {
  const keyObj = cacheOwner || (img as object);
  if (keyObj && colorStatsCache.has(keyObj)) return colorStatsCache.get(keyObj)!;

  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { luminance: 128, r: 128, g: 128, b: 128 };
    ctx.drawImage(img, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const count = data.length / 4;
    r /= count;
    g /= count;
    b /= count;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const stats = { luminance, r, g, b };
    if (keyObj) colorStatsCache.set(keyObj, stats);
    return stats;
  } catch {
    return { luminance: 128, r: 128, g: 128, b: 128 };
  }
}

export let videoRenderContext: {
  totalDuration: number;
  clips: TimelineClip[];
} | null = null;

let blurCanvas: HTMLCanvasElement | null = null;
let blurCtx: CanvasRenderingContext2D | null = null;
let transitionOffscreenCanvas: HTMLCanvasElement | null = null;
const videoFrameBufferCache = new WeakMap<HTMLVideoElement, HTMLCanvasElement>();

function captureVideoFrameBuffer(video: HTMLVideoElement, fallbackW = 1280, fallbackH = 720): HTMLCanvasElement | HTMLVideoElement {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    let buf = videoFrameBufferCache.get(video);
    if (!buf) {
      buf = document.createElement('canvas');
      videoFrameBufferCache.set(video, buf);
    }
    const vw = video.videoWidth || fallbackW;
    const vh = video.videoHeight || fallbackH;
    if (buf.width !== vw || buf.height !== vh) {
      buf.width = vw;
      buf.height = vh;
    }
    const bctx = buf.getContext('2d');
    if (bctx) {
      bctx.drawImage(video, 0, 0, vw, vh);
      return buf;
    }
  }
  return videoFrameBufferCache.get(video) || video;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Derive element reveal enter times automatically from wordTimestamps */
export function deriveElementEnterTimes(clip: TimelineClip): void {
  if (!clip.elements || clip.elements.length === 0) return;
  const words = clip.wordTimestamps || [];

  for (const el of clip.elements) {
    if (el.enterTime !== undefined && el.enterTime > 0) continue;
    if (!el.label) continue;

    const labelNorm = el.label.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!labelNorm) continue;

    const matchedWord = words.find(w => {
      const wNorm = w.word.toLowerCase().replace(/[^a-z0-9]/g, '');
      return wNorm === labelNorm || (wNorm.length >= 3 && labelNorm.includes(wNorm)) || (labelNorm.length >= 3 && wNorm.includes(labelNorm));
    });

    if (matchedWord) {
      const relativeStart = matchedWord.start > clip.startTime
        ? matchedWord.start - clip.startTime
        : matchedWord.start;
      el.enterTime = Math.max(0, relativeStart);
    } else {
      el.enterTime = el.enterTime ?? 0;
    }
  }
}

/** Robust word search for synchronized highlighting */
function findWordIndex(words: WordTimestamp[], t: number): number {
  if (!words || words.length === 0) return -1;
  if (t < words[0].start - 0.15) return -1;
  const lastWord = words[words.length - 1];
  if (t > lastWord.end + 0.4) return -2;
  
  let lo = 0;
  let hi = words.length - 1;
  let best = -1;
  
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

import { LRUCache } from './lru-cache';

// --- Image Caching & Preloading ---
const imageCache = new LRUCache<string, HTMLCanvasElement>(20, (key, canvas) => {
  canvas.width = 0;
  canvas.height = 0;
});

function getCachedScaledImage(image: HTMLImageElement, targetWidth: number, targetHeight: number): HTMLCanvasElement {
  const src = image.src || 'nosrc';
  const cacheKey = `${src}_${targetWidth}_${targetHeight}`;

  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  }

  imageCache.set(cacheKey, canvas);
  return canvas;
}

export function preloadUpcomingClips(currentTime: number, lookahead = 5) {
  if (!videoRenderContext) return;
  const { clips } = videoRenderContext;
  const isAbs = timelineState.mode === 'audio_locked';

  let cumTime = 0;
  for (const clip of clips) {
    const clipStart = isAbs ? (isNum(clip.startTime) ? clip.startTime : 0) : cumTime;
    const clipEnd = isAbs
      ? (isNum(clip.endTime) ? clip.endTime : clipStart + (clip.duration || 1))
      : (clipStart + clip.duration);

    if (clipEnd > currentTime && clipStart < currentTime + lookahead) {
      const img = clip.image;
      if (img && typeof (img as any).decode === 'function') {
        (img as any).decode().catch(() => {});
      }
    }
    if (!isAbs) cumTime += clip.duration;
  }
}

function getBlurSurface(w: number, h: number) {
  if (!blurCanvas) {
    blurCanvas = document.createElement('canvas');
    blurCtx = blurCanvas.getContext('2d', { alpha: false });
  }
  if (!blurCtx || !blurCanvas) return null;
  if (w !== blurCanvas.width || h !== blurCanvas.height) {
    blurCanvas.width = w;
    blurCanvas.height = h;
  }
  return { canvas: blurCanvas, ctx: blurCtx };
}

export function setVideoRenderContext(context: { totalDuration: number; clips: TimelineClip[] } | null) {
  if (videoRenderContext?.clips) {
    for (const c of videoRenderContext.clips) {
      if (c._imageObjectURL) dropOwner(c._imageObjectURL, 'render:' + c.id);
      if (c._videoObjectURL) dropOwner(c._videoObjectURL, 'render:' + c.id);
    }
  }
  if (context?.clips) {
    videoRenderContext = {
      ...context,
      clips: [...context.clips].sort((a, b) => (isNum(a.startTime) ? a.startTime : 0) - (isNum(b.startTime) ? b.startTime : 0)),
    };
    for (const c of videoRenderContext.clips) {
      if (c._imageObjectURL) acquireUrl(c._imageObjectURL, 'render:' + c.id);
      if (c._videoObjectURL) acquireUrl(c._videoObjectURL, 'render:' + c.id);
    }
  } else {
    videoRenderContext = context;
  }
  imageCache.clear();
}

let lightLeakActive = false;
let lightLeakX = 0;
let lightLeakY = 0;
let lightLeakUntil = 0;

let lastFrameTime = 0;
let frameSkipCount = 0;
let totalFrames = 0;

export function getRendererStats() {
  return {
    totalFrames,
    frameSkipCount,
    frameSkipRate: totalFrames > 0 ? frameSkipCount / totalFrames : 0,
    imageCacheSize: imageCache.size,
  };
}
export function resetRendererStats() {
  lastFrameTime = 0;
  frameSkipCount = 0;
  totalFrames = 0;
}
export function clearRendererCache() {
  imageCache.clear();
  if (blurCanvas) {
    blurCanvas.width = 1;
    blurCanvas.height = 1;
  }
}
export function cleanupRenderer() {
  clearRendererCache();
  cleanupWebGL();
  videoRenderContext = null;
  resetRendererStats();
}

/**
 * Renders cinematic post-processing overlays (grain, vignette, light leaks, chromatic aberration, dust & scratches, color filters, sparkles, rain, dust particles, snow)
 */
function applyPostEffects(ctx: CanvasRenderingContext2D, w: number, h: number, time: number = 0) {
  const effects = timelineState.videoEffects;
  
  // 1. Color Filter (Applied first via ctx.filter if possible, or overlay)
  if (effects.colorFilter !== 'none') {
    ctx.save();
    switch (effects.colorFilter) {
      case 'vintage':
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(255, 225, 180, 0.2)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(50, 20, 0, 0.1)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'noir':
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'sepia':
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = 'rgba(112, 66, 20, 0.35)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'warm':
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(255, 100, 0, 0.15)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'cool':
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(0, 100, 255, 0.15)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'technicolor':
        ctx.globalCompositeOperation = 'color-burn';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = 'rgba(255, 0, 0, 0.05)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'cyberpunk':
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(255, 0, 255, 0.1)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(0, 255, 255, 0.1)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'crt':
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = 'rgba(0, 255, 120, 0.08)';
        ctx.fillRect(0, 0, w, h);
        break;
      case 'screen':
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = 'rgba(100, 200, 255, 0.1)';
        ctx.fillRect(0, 0, w, h);
        break;
    }
    ctx.restore();
  }

  // 1b. Canvas Blend Mode Overlay (Screen / Multiply / Overlay / Lighten / Color Dodge / Soft Light / Difference)
  if (effects.blendMode && effects.blendMode !== 'normal') {
    ctx.save();
    const mode = effects.blendMode as GlobalCompositeOperation;
    ctx.globalCompositeOperation = mode;
    if (mode === 'screen') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'multiply') {
      ctx.fillStyle = 'rgba(230, 230, 230, 0.95)';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'overlay') {
      ctx.fillStyle = 'rgba(128, 128, 128, 0.12)';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'color-dodge') {
      ctx.fillStyle = 'rgba(80, 80, 80, 0.15)';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'soft-light') {
      ctx.fillStyle = 'rgba(200, 200, 200, 0.1)';
      ctx.fillRect(0, 0, w, h);
    } else if (mode === 'difference') {
      ctx.fillStyle = 'rgba(15, 15, 15, 0.2)';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  // 1c. 🏔️ HDR Exposure Balance (Shadow recovery & highlight roll-off compression)
  const hdrBalance = effects.hdrBalance || 0;
  if (hdrBalance > 0) {
    // Lift underexposed shadow crevices without washing out blacks
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.55, hdrBalance * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Damps harsh specular blowout / over-exposed sky clipping
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(0.35, hdrBalance * 0.24);
    ctx.fillStyle = '#dedede';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  // 1d + 1e. Combined Mid-Tone Clarity & Vibrance (single GPU pass when possible)
  const clarity = effects.clarity || 0;
  const vibrance = effects.vibrance || 0;
  if (clarity > 0 || vibrance > 0) {
    ctx.save();
    ctx.globalCompositeOperation = clarity >= vibrance ? 'overlay' : 'soft-light';
    ctx.globalAlpha = Math.min(0.55, Math.max(clarity * 0.48, vibrance * 0.42));
    const cPct = 100 + Math.round(clarity * 42);
    const bPct = 100 - Math.round(clarity * 4);
    const sPct = 100 + Math.round(vibrance * 65);
    ctx.filter = `contrast(${cPct}%) brightness(${bPct}%) saturate(${sPct}%)`;
    ctx.drawImage(ctx.canvas, 0, 0, w, h);
    ctx.restore();
  }

  // 1f. Optical Micro-Edge Sharpening (2-tap diagonal high-pass instead of 4 full-canvas copies)
  const sharpening = effects.sharpening || 0;
  if (sharpening > 0) {
    const sharpAlpha = Math.min(0.55, sharpening * 0.5);
    const px = 1.0;
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = sharpAlpha * 0.45;
    ctx.drawImage(ctx.canvas, -px, -px, w, h, 0, 0, w, h);
    ctx.drawImage(ctx.canvas, px, px, w, h, 0, 0, w, h);
    ctx.restore();
  }

  // 2. Chromatic Aberration
  if (effects.chromaticAberration > 0) {
    const offset = effects.chromaticAberration * 4;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.28 * effects.chromaticAberration;
    ctx.drawImage(ctx.canvas, offset, 0, w, h, 0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(ctx.canvas, -offset, 0, w, h, 0, 0, w, h);
    ctx.restore();
  }

  // 3. Vignette
  const effectiveVignette = state.cinematicVignette ? Math.max(0.5, effects.vignette || 0) : (effects.vignette || 0);
  if (effectiveVignette > 0) {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, h / 4, w / 2, h / 2, w / 1.1);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${0.4 * effectiveVignette})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  // 4. Deterministic 35mm Film Grain (locked to video `time`, not wall-clock Date.now())
  if (effects.grain > 0) {
    drawFilmGrainOverlay(ctx, 0, 0, w, h, time, 0.22 * effects.grain);
  }

  // 5. Deterministic Celluloid Dust & Scratches (locked to 24fps frame index)
  if (effects.dustAndScratches > 0) {
    const frameIdx = Math.floor(time * 24);
    let s = (frameIdx * 1664525 + 1013904223) >>> 0;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    if (rand() > 0.78) {
      ctx.save();
      ctx.globalAlpha = 0.09 * effects.dustAndScratches;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 0.6;

      for (let i = 0; i < 2 * effects.dustAndScratches; i++) {
        const x = rand() * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rand() - 0.5) * 10, h);
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 4 * effects.dustAndScratches; i++) {
        ctx.beginPath();
        ctx.arc(rand() * w, rand() * h, 0.6 + rand() * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // 6. Smooth Time-Locked Anamorphic Light Leaks (breathes in/out instead of snapping via Date.now())
  if (effects.lightLeaks > 0) {
    const swell = Math.pow(Math.max(0, Math.sin(time * 0.95) * 0.65 + Math.cos(time * 0.42) * 0.35), 2.4);
    if (swell > 0.02) {
      const leakX = w * (0.5 + 0.45 * Math.sin(time * 0.37));
      const leakY = h * (0.5 + 0.4 * Math.cos(time * 0.29));
      const alpha = swell * 0.28 * effects.lightLeaks;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const leakGradient = ctx.createRadialGradient(leakX, leakY, 0, leakX, leakY, Math.max(w, h) * 0.85);
      leakGradient.addColorStop(0, `rgba(255, 175, 75, ${alpha})`);
      leakGradient.addColorStop(0.45, `rgba(255, 65, 15, ${alpha * 0.55})`);
      leakGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = leakGradient;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // 7. ✨ Sparkles (Magic Stars & Glint Flare)
  if (effects.sparkles > 0) {
    ctx.save();
    const sparklesCountMult = Math.max(0.1, effects.sparklesCount ?? state.sparklesCount ?? 0.5) * 2;
    const sparklesSizeMult = Math.max(0.1, effects.sparklesSize ?? state.sparklesSize ?? 0.5) * 2;
    const numSparkles = Math.floor(45 * effects.sparkles * sparklesCountMult);
    for (let i = 0; i < numSparkles; i++) {
      const seedX = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const seedY = Math.cos(i * 4.1414 + 12.9898) * 23421.1231;
      const x = (seedX - Math.floor(seedX)) * w;
      const y = (seedY - Math.floor(seedY)) * h;

      const speed = 1.2 + (i % 5) * 0.4;
      const phase = (i * 1.618) % (Math.PI * 2);
      const twinkle = Math.pow(Math.max(0, Math.sin(time * speed + phase)), 4);
      if (twinkle < 0.05) continue;

      const size = (6 + (i % 8) * 2) * (0.5 + twinkle * 0.8) * (Math.min(w, h) / 720) * sparklesSizeMult;
      const alpha = twinkle * effects.sparkles * 0.85;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((time * 0.5 + i) % (Math.PI * 2));
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha;

      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.5);
      const hue = (i * 37) % 360;
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.2, `hsla(${hue}, 80%, 75%, ${alpha})`);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.3, size * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 2.5, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();
    }
    ctx.restore();
  }

  // 8. 🌧️ Rain Effect
  if (effects.rain > 0) {
    ctx.save();
    const rainCountMult = Math.max(0.1, effects.rainCount ?? state.rainCount ?? 0.5) * 2;
    const rainSizeMult = Math.max(0.1, effects.rainSize ?? state.rainSize ?? 0.5) * 2;
    const numStreaks = Math.floor(150 * effects.rain * rainCountMult);
    ctx.globalCompositeOperation = 'screen';
    const dx = w * 0.08;

    for (let i = 0; i < numStreaks; i++) {
      const seedX = Math.sin(i * 17.11 + 3.14) * 43758.54;
      const seedY = Math.cos(i * 9.23 + 1.23) * 23421.12;
      const x0 = (seedX - Math.floor(seedX)) * (w + dx) - dx;
      const y0 = (seedY - Math.floor(seedY));
      
      const speed = 1.6 + (i % 7) * 0.35;
      const streakLen = (25 + (i % 10) * 6) * (Math.max(w, h) / 720) * rainSizeMult;

      const progress = (y0 + time * speed) % 1.2 - 0.1;
      const curY = progress * h;
      const curX = x0 + progress * dx;

      const alpha = Math.min(1, Math.max(0, (0.1 + progress * 0.8) * (1 - (progress - 0.9) * 10))) * effects.rain * 0.65;
      if (alpha <= 0) continue;

      ctx.strokeStyle = `rgba(220, 240, 255, ${alpha})`;
      ctx.lineWidth = 1.2 * (Math.min(w, h) / 720) * Math.max(0.4, rainSizeMult * 0.8);
      ctx.beginPath();
      ctx.moveTo(curX, curY);
      ctx.lineTo(curX - dx * (streakLen / h), curY - streakLen);
      ctx.stroke();

      if (progress > 0.85 && (i % 3 === 0)) {
        const splashAlpha = (progress - 0.85) * 6 * alpha;
        ctx.strokeStyle = `rgba(255, 255, 255, ${splashAlpha})`;
        ctx.beginPath();
        ctx.ellipse(curX, curY, 3 * (Math.min(w, h) / 720) * rainSizeMult, 1 * (Math.min(w, h) / 720) * rainSizeMult, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 9. 🌌 Dust Particles / Golden Bokeh
  if (effects.dustParticles > 0) {
    ctx.save();
    const dustCountMult = Math.max(0.1, effects.dustParticlesCount ?? state.dustMotesCount ?? 0.5) * 2;
    const dustSizeMult = Math.max(0.1, effects.dustParticlesSize ?? state.dustMotesSize ?? 0.5) * 2;
    const numParticles = Math.floor(60 * effects.dustParticles * dustCountMult);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < numParticles; i++) {
      const seedX = Math.sin(i * 23.45 + 9.87) * 43758.54;
      const seedY = Math.cos(i * 11.22 + 4.56) * 23421.12;
      const x0 = (seedX - Math.floor(seedX)) * w;
      const y0 = (seedY - Math.floor(seedY));

      const riseSpeed = 0.03 + (i % 5) * 0.02;
      const rawProgress = (y0 - time * riseSpeed) % 1.1;
      const progress = rawProgress < 0 ? rawProgress + 1.1 : rawProgress;
      const curY = progress * h;

      const driftX = Math.sin(time * 0.4 + i * 1.5) * 25 * (Math.min(w, h) / 720);
      const curX = (x0 + driftX + w) % w;

      const pulse = 0.5 + 0.5 * Math.sin(time * 1.5 + i * 2.3);
      const size = (3 + (i % 6) * 3) * (Math.min(w, h) / 720) * dustSizeMult;
      const alpha = (0.2 + pulse * 0.4) * effects.dustParticles;

      const grad = ctx.createRadialGradient(curX, curY, 0, curX, curY, size * 2);
      const isGold = i % 2 === 0;
      const col = isGold ? `255, 215, 130` : `230, 240, 255`;

      grad.addColorStop(0, `rgba(${col}, ${alpha})`);
      grad.addColorStop(0.5, `rgba(${col}, ${alpha * 0.4})`);
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(curX, curY, size * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 10. ❄️ Snow Effect
  if (effects.snow > 0) {
    ctx.save();
    const snowCountMult = Math.max(0.1, effects.snowCount ?? state.snowCount ?? 0.5) * 2;
    const snowSizeMult = Math.max(0.1, effects.snowSize ?? state.snowSize ?? 0.5) * 2;
    const numFlakes = Math.floor(100 * effects.snow * snowCountMult);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < numFlakes; i++) {
      const seedX = Math.sin(i * 31.415 + 1.414) * 43758.54;
      const seedY = Math.cos(i * 13.37 + 2.718) * 23421.12;
      const x0 = (seedX - Math.floor(seedX)) * w;
      const y0 = (seedY - Math.floor(seedY));

      const fallSpeed = 0.08 + (i % 6) * 0.04;
      const progress = (y0 + time * fallSpeed) % 1.1 - 0.05;
      const curY = progress * h;

      const swayFreq = 1.2 + (i % 4) * 0.5;
      const swayAmp = (15 + (i % 5) * 10) * (Math.min(w, h) / 720);
      const curX = x0 + Math.sin(time * swayFreq + i) * swayAmp;

      const size = (2 + (i % 7) * 1.5) * (Math.min(w, h) / 720) * snowSizeMult;
      const alpha = (0.3 + (i % 5) * 0.15) * effects.snow;

      if (i % 8 === 0) {
        const fgSize = size * 2.5;
        const grad = ctx.createRadialGradient(curX, curY, 0, curX, curY, fgSize);
        grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.8})`);
        grad.addColorStop(0.5, `rgba(240, 248, 255, ${alpha * 0.3})`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(curX, curY, fgSize, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(curX, curY, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 11. 📺 CRT / Retro TV Screen Effect (Scanlines, Aperture Grille RGB Triads, Glass Curvature, Signal Sync Flicker & Sheen Glare)
  const crtVal = Math.max(effects.crtEffect || 0, effects.colorFilter === 'crt' ? 0.65 : 0);
  if (crtVal > 0) {
    ctx.save();

    // 11a. Scanlines (Horizontal Cathode Lines)
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const scanlineOpacity = 0.28 * crtVal;
    ctx.fillStyle = `rgba(0, 0, 0, ${scanlineOpacity})`;
    const scanlineSpacing = 3;
    const scrollOffset = Math.floor((time * 40) % scanlineSpacing);
    for (let y = scrollOffset; y < h; y += scanlineSpacing) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();

    // 11b. Aperture Grille RGB Subpixel Triad Mask
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.14 * crtVal;
    const stripeW = Math.max(1, Math.floor(w / 400));
    for (let x = 0; x < w; x += stripeW * 3) {
      ctx.fillStyle = 'rgba(255, 0, 0, 1)';
      ctx.fillRect(x, 0, stripeW, h);
      ctx.fillStyle = 'rgba(0, 255, 0, 1)';
      ctx.fillRect(x + stripeW, 0, stripeW, h);
      ctx.fillStyle = 'rgba(0, 0, 255, 1)';
      ctx.fillRect(x + stripeW * 2, 0, stripeW, h);
    }
    ctx.restore();

    // 11c. CRT Barrel Distortion & Bezel Edge Darkening
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const crtGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
    crtGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    crtGrad.addColorStop(0.7, `rgba(210, 210, 210, ${1 - 0.15 * crtVal})`);
    crtGrad.addColorStop(0.92, `rgba(50, 50, 50, ${1 - 0.7 * crtVal})`);
    crtGrad.addColorStop(1, 'rgba(0, 0, 0, 0.98)');
    ctx.fillStyle = crtGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // 11d. Interlacing Signal Sync Flicker & Hum
    const flickerFactor = (Math.sin(time * 85) * 0.02 + Math.cos(time * 33) * 0.015) * crtVal;
    if (Math.abs(flickerFactor) > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = flickerFactor > 0 ? 'screen' : 'multiply';
      ctx.globalAlpha = Math.abs(flickerFactor);
      ctx.fillStyle = flickerFactor > 0 ? '#ffffff' : '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 11e. Curved CRT Glass Sheen & Glare Reflection
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const sheenGrad = ctx.createLinearGradient(0, 0, w, h);
    sheenGrad.addColorStop(0, `rgba(255, 255, 255, ${0.14 * crtVal})`);
    sheenGrad.addColorStop(0.25, `rgba(255, 255, 255, ${0.05 * crtVal})`);
    sheenGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sheenGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.restore();
  }
}

function syncTalkingHeadVideo(video: HTMLVideoElement, time: number, clip: any, targetCanvas?: HTMLCanvasElement | OffscreenCanvas, activeVideos?: Set<HTMLVideoElement>) {
  if (!video) return;
  if (activeVideos) activeVideos.add(video);
  const videoDur = video.duration || 0;
  
  if (clip && typeof clip.startTime === 'number' && typeof clip.endTime === 'number') {
    if (time < clip.startTime || time >= clip.endTime) {
      if (!video.paused) {
        try { video.pause(); } catch (e) { }
      }
      video.muted = true;
      return;
    }
  }

  let targetTime = time;
  if (clip) {
    const isMasterVideo = (video === state.uploadedVideoElement) ||
                          (clip.talkingHeadVideoElement === video) ||
                          (!clip._videoObjectURL && !!state.uploadedVideoElement) ||
                          (clip._videoObjectURL && state.uploadedVideoElement && clip._videoObjectURL === state.uploadedVideoElement.src);
    const offset = (isMasterVideo && (!clip.videoStartOffset || clip.videoStartOffset === 0))
      ? (clip.startTime || 0)
      : (clip.videoStartOffset || 0);
    targetTime = offset + (time - (clip.startTime || 0));
  }
  
  if (videoDur > 0 && targetTime > videoDur) {
      targetTime = ((targetTime % videoDur) + videoDur) % videoDur;
  }

  const useOriginalAudio = clip?.useOriginalAudio || clip?.soloAudio || false;
  let targetVol = (clip as any)?.volume !== undefined ? (clip as any).volume : 1.0;
  if (!clip?.soloAudio && timelineState.masterAudioBuffer && state.audioDuckingEnabled && (clip as any)?.audioDuckingOverride !== false) {
    targetVol *= 0.25;
  }

  if (targetCanvas || state.isExporting) {
    // When exporting or rendering to an offscreen buffer, exporter.ts handles async seek synchronization.
    // Do NOT synchronously mutate currentTime here to avoid putting the video into an un-decoded seeking state.
    if (!video.paused) {
      try { video.pause(); } catch (e) { }
    }
    video.muted = true;
    return;
  } else if (state.isVideoPlaying) {
    if (video.paused) {
      video.currentTime = targetTime;
      video.play().catch(e => console.warn(e));
    } else if (Math.abs(video.currentTime - targetTime) > 0.3) {
      video.currentTime = targetTime;
    }
    video.muted = !useOriginalAudio;
    video.volume = Math.max(0, Math.min(1, targetVol));
  } else {
    if (!video.paused) {
      try { video.pause(); } catch (e) { }
    }
    if (!state.isExporting && Math.abs(video.currentTime - targetTime) > 0.05) {
      video.currentTime = targetTime;
    }
  }
}

function drawTalkingHeadPiP(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  video: HTMLVideoElement | HTMLImageElement | any,
  clip: TimelineClip,
  cvW: number,
  cvH: number,
  time: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
  activeVideos?: Set<HTMLVideoElement>
) {
  if (!video) return;
  if (typeof video.play === 'function') {
    syncTalkingHeadVideo(video, time, clip, targetCanvas, activeVideos);
  }

  const mode = clip.talkingHeadMode || state.talkingHeadDefaultMode || 'pip-br';
  if (mode === 'none' || mode === 'full' || mode === 'split') return;

  const shape = clip.talkingHeadShape || state.talkingHeadShape || 'circle';
  const sizeSetting = clip.talkingHeadSize || state.talkingHeadSize || 'medium';

  const minDim = Math.min(cvW, cvH);
  const sizeScale = sizeSetting === 'small' ? 0.20 : sizeSetting === 'large' ? 0.35 : 0.27;
  const pipW = Math.round(minDim * sizeScale);
  const vw = Math.max(1, (video as any).videoWidth || (video as any).naturalWidth || (video as any).width || 1920);
  const vh = Math.max(1, (video as any).videoHeight || (video as any).naturalHeight || (video as any).height || 1080);
  const pipH = shape === 'circle' ? pipW : Math.round(pipW * (vh / vw));
  const clampedPipH = Math.min(pipH, Math.round(cvH * 0.42));

  const marginX = Math.round(cvW * 0.035);
  const marginY = Math.round(cvH * 0.035);
  const isMasterPlaceholder = (text?: string) => !text || /^(?:master\s+a-?roll|a-?roll)$/i.test(text.trim());
  const subtitleSafeOffset = (timelineState.showSubtitles && timelineState.videoSubtitlePosition === 'bottom' && clip.text && !isMasterPlaceholder(clip.text)) 
    ? SubtitleEngine.getSubtitleHeightOffset(ctx, clip.text, cvW, cvH, timelineState.videoSubtitlePosition, timelineState.videoSubtitleStyle) 
    : 0;

  let x = cvW - pipW - marginX;
  let y = cvH - clampedPipH - marginY - subtitleSafeOffset;

  if (mode === 'pip-bl') {
    x = marginX;
    y = cvH - clampedPipH - marginY - subtitleSafeOffset;
  } else if (mode === 'pip-tr') {
    x = cvW - pipW - marginX;
    y = marginY;
  } else if (mode === 'pip-tl') {
    x = marginX;
    y = marginY;
  }

  ctx.save();

  // Helper function to build the PiP clip path
  const constructPiPPath = () => {
    ctx.beginPath();
    if (shape === 'circle') {
      const radius = pipW / 2;
      ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
    } else if (shape === 'rounded') {
      const r = Math.min(16, pipW * 0.15);
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, pipW, clampedPipH, r);
      } else {
        ctx.rect(x, y, pipW, clampedPipH);
      }
    } else {
      ctx.rect(x, y, pipW, clampedPipH);
    }
  };

  // Shadow / Glow
  if (state.talkingHeadShadow !== false) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
  }

  constructPiPPath();
  ctx.fillStyle = '#0f172a';
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Draw media inside with center-crop fill
  const videoAR = vw / vh;
  const pipAR = pipW / clampedPipH;

  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (videoAR > pipAR) {
    sw = vh * pipAR;
    sx = (vw - sw) / 2;
  } else {
    sh = vw / pipAR;
    sy = (vh - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, x, y, pipW, clampedPipH);
  ctx.restore();

  // Border Ring
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.strokeStyle = state.talkingHeadBorderColor || '#6366f1';
  ctx.lineWidth = state.talkingHeadBorderWidth || 3;
  constructPiPPath();
  ctx.stroke();

  // Subtle outer ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  constructPiPPath();
  ctx.stroke();

  ctx.restore();
}

function drawTalkingHeadSplit(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  talkingHeadVideo: HTMLVideoElement | HTMLImageElement | any,
  clip: TimelineClip,
  cvW: number,
  cvH: number,
  time: number,
  tIn: number,
  curLen: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
  drawImageContainFn?: any,
  activeVideos?: Set<HTMLVideoElement>
) {
  // Determine mediaA (Slot 1: Top or Left) and mediaB (Slot 2: Bottom or Right)
  let mediaA: any = null;
  let mediaB: any = null;
  const clipVideo = getClipVideoDrawable(clip, 'primary');
  const secVideo = getClipVideoDrawable(clip, 'secondary');
  const thVideo = getClipVideoDrawable(clip, 'talkingHead') || talkingHeadVideo;
  const clipImg = (state.isExporting && clip._exportOptimizedImage) ? clip._exportOptimizedImage : clip.image;

  if (clip.talkingHeadRole === 'secondary') {
    mediaA = secVideo || clip.secondaryImage || thVideo;
    mediaB = clipVideo || clipImg;
  } else if (secVideo || clip.secondaryImage) {
    if (secVideo && clipImg && !clipVideo) {
      mediaA = secVideo;
      mediaB = clipImg;
    } else if (clipVideo && clip.secondaryImage) {
      mediaA = clipVideo;
      mediaB = clip.secondaryImage;
    } else if (clipVideo && secVideo) {
      mediaA = clipVideo;
      mediaB = secVideo;
    } else if (clipImg && clip.secondaryImage) {
      mediaA = clipImg;
      mediaB = clip.secondaryImage;
    } else {
      mediaA = secVideo || clip.secondaryImage || thVideo;
      mediaB = clipVideo || clipImg;
    }
  } else if (clipVideo && clipImg) {
    mediaA = clipVideo;
    mediaB = clipImg;
  } else if (thVideo && (clipVideo || clipImg) && thVideo !== (clipVideo || clipImg)) {
    mediaA = thVideo;
    mediaB = clipVideo || clipImg;
  } else {
    mediaA = thVideo || clipVideo || clipImg;
    mediaB = clipVideo || clipImg || thVideo;
  }

  if (mediaA && typeof mediaA.play === 'function') {
    syncTalkingHeadVideo(mediaA, time, clip, targetCanvas, activeVideos);
  }
  if (mediaB && typeof mediaB.play === 'function') {
    syncTalkingHeadVideo(mediaB, time, clip, targetCanvas, activeVideos);
  }

  const prog = Math.min(1, tIn / curLen);
  const isVertical = cvH >= cvW;
  ctx.save();

  if (isVertical) {
    // Vertical layout (9:16 Shorts/Reels/TikTok): Top half = Slot A, Bottom half = Slot B
    const halfH = Math.floor(cvH / 2);

    // Top Half: Slot A
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cvW, halfH);
    ctx.clip();
    if (mediaA) {
      const vw = Math.max(1, (mediaA as any).videoWidth || (mediaA as any).naturalWidth || (mediaA as any).width || 1080);
      const vh = Math.max(1, (mediaA as any).videoHeight || (mediaA as any).naturalHeight || (mediaA as any).height || 1920);
      const mediaAR = vw / vh;
      const topAR = cvW / halfH;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (mediaAR > topAR) {
        sw = vh * topAR;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / topAR;
        sy = (vh - sh) / 2;
      }
      ctx.drawImage(mediaA, sx, sy, sw, sh, 0, 0, cvW, halfH);
    }
    ctx.restore();

    // Bottom Half: Slot B
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, halfH, cvW, halfH);
    ctx.clip();
    ctx.translate(0, halfH);
    if (drawImageContainFn && mediaB) {
      drawImageContainFn(mediaB, clip.cameraMovement, prog, 1, clip.duration, clip.focalPoint, clip.videoStartOffset || 0, clip.cameraKeyframes);
    }
    ctx.restore();

    // Sleek separator line with subtle glow
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(cvW, halfH);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // Horizontal layout: Left half = Slot A, Right half = Slot B
    const halfW = Math.floor(cvW / 2);

    // Left Half: Slot A
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, halfW, cvH);
    ctx.clip();
    if (mediaA) {
      const vw = Math.max(1, (mediaA as any).videoWidth || (mediaA as any).naturalWidth || (mediaA as any).width || 1920);
      const vh = Math.max(1, (mediaA as any).videoHeight || (mediaA as any).naturalHeight || (mediaA as any).height || 1080);
      const mediaAR = vw / vh;
      const leftAR = halfW / cvH;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (mediaAR > leftAR) {
        sw = vh * leftAR;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / leftAR;
        sy = (vh - sh) / 2;
      }
      ctx.drawImage(mediaA, sx, sy, sw, sh, 0, 0, halfW, cvH);
    }
    ctx.restore();

    // Right Half: Slot B
    ctx.save();
    ctx.beginPath();
    ctx.rect(halfW, 0, halfW, cvH);
    ctx.clip();
    ctx.translate(halfW, 0);
    if (drawImageContainFn && mediaB) {
      drawImageContainFn(mediaB, clip.cameraMovement, prog, 1, clip.duration, clip.focalPoint, clip.videoStartOffset || 0, clip.cameraKeyframes);
    }
    ctx.restore();

    // Separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(halfW, 0);
    ctx.lineTo(halfW, cvH);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draws a documentary Picture-in-Picture corner map / media callout
 * Features smooth slide-in and fade-in (first 15%), neon cyan card frame, and smooth slide-out and fade-out (last 15%)
 */
export function drawCornerCalloutOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  clip: TimelineClip,
  cw: number,
  ch: number,
  progress: number
) {
  const overlayMedia = clip.overlayImage || clip.overlayVideoElement;
  if (!overlayMedia) return;

  const clipDur = Math.max(0.5, clip.duration || 4.0);
  const enterRatio = Math.min(0.18, 0.45 / clipDur);
  const exitRatio = Math.min(0.16, 0.4 / clipDur);

  let alpha = 1;
  let slideOffset = 0;
  let scale = 1;
  if (progress < enterRatio) {
    const p = Math.max(0, Math.min(1, progress / enterRatio));
    const easeOut = 1 - Math.pow(1 - p, 3);
    alpha = easeOut;
    slideOffset = (1 - easeOut) * -20;
    scale = 0.92 + 0.08 * easeOut;
  } else if (progress > 1 - exitRatio) {
    const p = Math.max(0, Math.min(1, (progress - (1 - exitRatio)) / exitRatio));
    const easeIn = p * p * p;
    alpha = 1 - easeIn;
    slideOffset = easeIn * -16;
    scale = 1 - 0.06 * easeIn;
  }
  if (alpha <= 0.01) return;

  const isPortrait = ch > cw;
  const targetW = isPortrait ? Math.round(cw * 0.4) : Math.round(cw * 0.26);
  const naturalW = (overlayMedia as any).naturalWidth || (overlayMedia as any).videoWidth || 16;
  const naturalH = (overlayMedia as any).naturalHeight || (overlayMedia as any).videoHeight || 9;
  const mediaRatio = naturalH / (naturalW || 1);
  const targetH = Math.round(targetW * mediaRatio);

  const margin = isPortrait ? Math.round(cw * 0.04) : Math.round(cw * 0.03);
  const pos = clip.overlayPosition || 'top-right';

  let posX = cw - targetW - margin;
  let posY = margin + slideOffset;

  if (pos === 'top-left') {
    posX = margin;
    posY = margin + slideOffset;
  } else if (pos === 'bottom-right') {
    posX = cw - targetW - margin;
    posY = ch - targetH - margin - slideOffset;
  } else if (pos === 'bottom-left') {
    posX = margin;
    posY = ch - targetH - margin - slideOffset;
  }

  const radius = 8;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(posX + targetW / 2, posY + targetH / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(posX + targetW / 2), -(posY + targetH / 2));

  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = '#030712';
  ctx.strokeStyle = 'rgba(0, 255, 204, 0.75)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX - 2, posY - 2, targetW + 4, targetH + 4, radius);
  } else {
    ctx.rect(posX - 2, posY - 2, targetW + 4, targetH + 4);
  }
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX, posY, targetW, targetH, radius - 2);
  } else {
    ctx.rect(posX, posY, targetW, targetH);
  }
  ctx.clip();
  ctx.drawImage(overlayMedia, posX, posY, targetW, targetH);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(0, 255, 204, 0.9)';
  ctx.font = 'bold 9px monospace, sans-serif';
  ctx.fillText('MAP RECON', posX + 6, posY + 12);
  ctx.restore();

  ctx.restore();
}

/**
 * Calculates current bounding box for a PiP overlay clip taking aspect ratio, scale, and positioning into account
 */
export function getPipOverlayBounds(
  clip: TimelineClip,
  cw: number,
  ch: number,
  time?: number
): { x: number; y: number; w: number; h: number } | null {
  const media = getClipVideoDrawable(clip, 'secondary') || getClipVideoDrawable(clip, 'primary') || clip.image || clip.backgroundPlate;
  if (!media && !clip._imageObjectURL && !clip._videoObjectURL) return null;

  const scaleRatio = typeof clip.pipScale === 'number' ? clip.pipScale : 0.36;
  const cardW = Math.round(cw * scaleRatio);

  let mediaAspect = 9 / 16;
  if (media) {
    const nw = (media as any).videoWidth || (media as any).naturalWidth || (media as any).width;
    const nh = (media as any).videoHeight || (media as any).naturalHeight || (media as any).height;
    if (nw && nh) {
      mediaAspect = nh / nw;
    }
  }
  mediaAspect = Math.max(0.45, Math.min(1.2, mediaAspect));
  const cardH = Math.round(cardW * mediaAspect);

  const marginX = Math.round(cw * 0.035);
  let topSafe = Math.round(ch * 0.04);
  let bottomSafe = Math.round(ch * 0.04);

  if (state.cinematicLetterbox) {
    const targetAR = 2.39;
    const currentAR = cw / ch;
    if (currentAR < targetAR) {
      const activeH = cw / targetAR;
      const barH = Math.round((ch - activeH) / 2);
      topSafe += barH;
      bottomSafe += barH;
    }
  }

  const position = clip.pipPosition || 'top_right';
  const hasCustomPos = (position === 'custom' || typeof clip.pipX === 'number') && typeof clip.pipY === 'number';

  let posX = cw - cardW - marginX;
  let posY = topSafe;

  if (hasCustomPos) {
    const anchorX = typeof clip.pipAnchorX === 'number' ? clip.pipAnchorX : 0.5;
    const anchorY = typeof clip.pipAnchorY === 'number' ? clip.pipAnchorY : 0.5;
    posX = (clip.pipX ?? 0.5) * cw - cardW * anchorX;
    posY = (clip.pipY ?? 0.5) * ch - cardH * anchorY;
    posX = Math.max(0, Math.min(cw - cardW, posX));
    posY = Math.max(topSafe, Math.min(ch - bottomSafe - cardH, posY));
  } else if (position === 'top_left') {
    posX = marginX;
    posY = topSafe;
  } else if (position === 'bottom_right') {
    posX = cw - cardW - marginX;
    posY = ch - cardH - bottomSafe;
  } else if (position === 'bottom_left') {
    posX = marginX;
    posY = ch - cardH - bottomSafe;
  } else if (position === 'center_right') {
    posX = cw - cardW - marginX;
    posY = Math.round((ch - cardH) / 2);
  } else if (position === 'center_left') {
    posX = marginX;
    posY = Math.round((ch - cardH) / 2);
  }

  return { x: posX, y: posY, w: cardW, h: cardH };
}

/**
 * Draws a Pop-Up B-Roll Picture-in-Picture (PiP) cinema callout card over the continuous A-roll or scene
 * Features spring pop, slide-in, or zoom-fade entrance/exit, rounded drop-shadow cinema card, and B-Roll badge
 */
export function drawPopUpBrollPipOverlay(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  clip: TimelineClip,
  cw: number,
  ch: number,
  time: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas
) {
  const media = getClipVideoDrawable(clip, 'secondary') || getClipVideoDrawable(clip, 'primary') || clip.image || clip.backgroundPlate;
  if (!media) return;

  const clipStart = clip.startTime || 0;
  const clipEnd = isNum(clip.endTime) ? clip.endTime : (clipStart + (clip.duration || 3.0));
  const clipDur = Math.max(0.001, clipEnd - clipStart);

  if (time < clipStart || time > clipEnd) return;

  const timeInClip = time - clipStart;
  const timeLeftInClip = clipEnd - time;
  const enterDur = Math.min(0.4, clipDur * 0.25);
  const exitDur = Math.min(0.35, clipDur * 0.25);

  let scaleMultiplier = 1.0;
  let alpha = 1.0;
  let slideX = 0;
  let slideY = 0;

  const animType = clip.pipAnimation || 'pop_spring';
  const position = clip.pipPosition || 'top_right';
  const hasCustomPos = (position === 'custom' || typeof clip.pipX === 'number') && typeof clip.pipY === 'number';
  const isLeft = !hasCustomPos && position.includes('left');
  const isBottom = !hasCustomPos && position.includes('bottom');

  if (timeInClip < enterDur) {
    const p = Math.max(0, Math.min(1, timeInClip / enterDur));
    if (animType === 'pop_spring') {
      // Elastic spring overshoot: 0 -> 1.08 -> 1.0
      const overshoot = 1 + 0.16 * Math.sin(p * Math.PI) * (1 - p);
      scaleMultiplier = p * overshoot;
      alpha = Math.min(1, p * 1.6);
    } else if (animType === 'slide_in') {
      const ease = 1 - Math.pow(1 - p, 3);
      const distance = Math.round(cw * 0.14);
      slideX = (1 - ease) * (isLeft ? -distance : distance);
      alpha = Math.min(1, p * 2);
    } else { // zoom_fade
      const ease = 1 - Math.pow(1 - p, 2);
      scaleMultiplier = 0.82 + 0.18 * ease;
      alpha = Math.min(1, p * 1.5);
    }
  } else if (timeLeftInClip < exitDur) {
    const p = Math.max(0, Math.min(1, timeLeftInClip / exitDur));
    if (animType === 'pop_spring' || animType === 'zoom_fade') {
      scaleMultiplier = 0.85 + 0.15 * p;
      alpha = Math.min(1, p * 1.8);
    } else if (animType === 'slide_in') {
      const ease = Math.pow(p, 3);
      const distance = Math.round(cw * 0.14);
      slideX = (1 - ease) * (isLeft ? -distance : distance);
      alpha = Math.min(1, p * 1.8);
    }
  }

  if (alpha <= 0.001 || scaleMultiplier <= 0.001) return;

  const scaleRatio = typeof clip.pipScale === 'number' ? clip.pipScale : 0.36;
  const cardW = Math.round(cw * scaleRatio);

  let mediaAspect = 9 / 16;
  const nw = (media as any).videoWidth || (media as any).naturalWidth || (media as any).width;
  const nh = (media as any).videoHeight || (media as any).naturalHeight || (media as any).height;
  if (nw && nh) {
    mediaAspect = nh / nw;
  }
  mediaAspect = Math.max(0.45, Math.min(1.2, mediaAspect));
  const cardH = Math.round(cardW * mediaAspect);

  const marginX = Math.round(cw * 0.035);
  let topSafe = Math.round(ch * 0.04);
  let bottomSafe = Math.round(ch * 0.04);

  if (state.cinematicLetterbox) {
    const targetAR = 2.39;
    const currentAR = cw / ch;
    if (currentAR < targetAR) {
      const activeH = cw / targetAR;
      const barH = Math.round((ch - activeH) / 2);
      topSafe += barH;
      bottomSafe += barH;
    }
  }

  let posX = cw - cardW - marginX + slideX;
  let posY = topSafe + slideY;

  if (hasCustomPos) {
    const anchorX = typeof clip.pipAnchorX === 'number' ? clip.pipAnchorX : 0.5;
    const anchorY = typeof clip.pipAnchorY === 'number' ? clip.pipAnchorY : 0.5;
    posX = (clip.pipX ?? 0.5) * cw - cardW * anchorX + slideX;
    posY = (clip.pipY ?? 0.5) * ch - cardH * anchorY + slideY;
    posX = Math.max(0, Math.min(cw - cardW, posX));
    posY = Math.max(topSafe, Math.min(ch - bottomSafe - cardH, posY));
  } else if (position === 'top_left') {
    posX = marginX + slideX;
    posY = topSafe + slideY;
  } else if (position === 'bottom_right') {
    posX = cw - cardW - marginX + slideX;
    posY = ch - cardH - bottomSafe + slideY;
  } else if (position === 'bottom_left') {
    posX = marginX + slideX;
    posY = ch - cardH - bottomSafe + slideY;
  } else if (position === 'center_right') {
    posX = cw - cardW - marginX + slideX;
    posY = Math.round((ch - cardH) / 2) + slideY;
  } else if (position === 'center_left') {
    posX = marginX + slideX;
    posY = Math.round((ch - cardH) / 2) + slideY;
  }

  const cornerRadius = Math.max(8, Math.round(12 * (cw / 1280)));
  const borderWidth = Math.max(2, Math.round(2.5 * (cw / 1280)));

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  // Scale around the center of the card so pop_spring and zoom_fade don't drift toward top-left
  ctx.translate(posX + cardW / 2, posY + cardH / 2);
  ctx.scale(scaleMultiplier, scaleMultiplier);
  ctx.translate(-(posX + cardW / 2), -(posY + cardH / 2));

  // 1. Deep Cinema Drop Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = Math.round(20 * (cw / 1280));
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(8 * (ch / 720));

  // 2. Base Container
  ctx.fillStyle = '#090d16';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX, posY, cardW, cardH, cornerRadius);
  } else {
    ctx.rect(posX, posY, cardW, cardH);
  }
  ctx.fill();

  // Reset shadow for inner clipping
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 3. Render Inner Media
  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX, posY, cardW, cardH, cornerRadius);
  } else {
    ctx.rect(posX, posY, cardW, cardH);
  }
  ctx.clip();

  const pipFilter = clip.colorFilter;
  const pipIntensity = typeof clip.colorFilterIntensity === 'number' ? clip.colorFilterIntensity : 1.0;
  if (pipFilter && pipFilter !== 'none') {
    const fCss = getShotFilterCss(pipFilter, pipIntensity);
    if (fCss !== 'none') ctx.filter = fCss;
  }

  const pipVideo = getClipVideoDrawable(clip, 'secondary') || getClipVideoDrawable(clip, 'primary');
  if (pipVideo) {
    const isReady = (pipVideo as any).readyState >= 2 || (pipVideo instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && pipVideo instanceof OffscreenCanvas));
    if (isReady) {
      if (pipVideo instanceof HTMLVideoElement) {
        const targetVidTime = Math.max(0, (time - clipStart + (clip.videoStartOffset || 0)));
        if (!targetCanvas && Math.abs(pipVideo.currentTime - targetVidTime) > 0.15 && !state.isVideoPlaying) {
          try { pipVideo.currentTime = targetVidTime % (pipVideo.duration || 1); } catch {}
        }
      }
      ctx.drawImage(pipVideo, posX, posY, cardW, cardH);
    } else {
      ctx.fillStyle = '#1e1b4b';
      ctx.fillRect(posX, posY, cardW, cardH);
    }
  } else if (clip.image || clip.backgroundPlate || (state.isExporting && clip._exportOptimizedImage)) {
    const img = (state.isExporting && clip._exportOptimizedImage) ? clip._exportOptimizedImage : (clip.backgroundPlate || clip.image);
    const prog = Math.max(0, Math.min(1, (time - clipStart) / clipDur));
    const zoom = 1.0 + 0.04 * prog;
    const zw = cardW * zoom;
    const zh = cardH * zoom;
    const zx = posX - (zw - cardW) / 2;
    const zy = posY - (zh - cardH) / 2;
    ctx.drawImage(img!, zx, zy, zw, zh);
  } else {
    ctx.fillStyle = '#18181b';
    ctx.fillRect(posX, posY, cardW, cardH);
  }

  if (pipFilter && pipFilter !== 'none') {
    ctx.filter = 'none';
    applyShotOverlays(ctx, pipFilter, pipIntensity, posX, posY, cardW, cardH, time);
  }

  ctx.restore();

  // 4. Subtle Ambient Top Sheen
  const sheenGrad = ctx.createLinearGradient(posX, posY, posX, posY + cardH);
  sheenGrad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  sheenGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.0)');
  sheenGrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
  ctx.fillStyle = sheenGrad;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX, posY, cardW, cardH, cornerRadius);
  } else {
    ctx.rect(posX, posY, cardW, cardH);
  }
  ctx.fill();

  // 5. Cinema Border Accent
  ctx.strokeStyle = clip.pipBorderColor || 'rgba(129, 140, 248, 0.75)';
  ctx.lineWidth = borderWidth;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(posX, posY, cardW, cardH, cornerRadius);
  } else {
    ctx.rect(posX, posY, cardW, cardH);
  }
  ctx.stroke();

  // 6. Corner Badge / Chip
  const badgeH = Math.round(18 * (ch / 720));
  const badgePad = Math.round(6 * (cw / 1280));
  const badgeY = posY + cardH - badgeH - badgePad;
  const badgeX = posX + badgePad;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, Math.round(72 * (cw / 1280)), badgeH, 4);
  } else {
    ctx.rect(badgeX, badgeY, Math.round(72 * (cw / 1280)), badgeH);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#c7d2fe';
  ctx.font = `bold ${Math.max(9, Math.round(10 * (cw / 1280)))}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText('🖼️ B-ROLL', badgeX + 4, badgeY + badgeH - 4);

  ctx.restore();
}

/**
 * Computes preview dimensions based on the user-selected preview resolution (240p, 320p, 520p, 720p)
 * for high-performance, glitch-free preview playback and scrubbing across all aspect ratios.
 */
export function getPreviewDimensions(aspectRatio: string = '16:9', resQuality?: string): { width: number; height: number } {
  const quality = (resQuality || state.previewResolution || '520p') as string;

  let targetW = 960, targetH = 540;

  if (quality === '240p') {
    if (aspectRatio === '9:16') { targetW = 240; targetH = 426; }
    else if (aspectRatio === '1:1') { targetW = 240; targetH = 240; }
    else if (aspectRatio === '4:3') { targetW = 320; targetH = 240; }
    else if (aspectRatio === '3:4') { targetW = 240; targetH = 320; }
    else { targetW = 426; targetH = 240; }
  } else if (quality === '320p' || quality === '360p') {
    if (aspectRatio === '9:16') { targetW = 320; targetH = 568; }
    else if (aspectRatio === '1:1') { targetW = 320; targetH = 320; }
    else if (aspectRatio === '4:3') { targetW = 426; targetH = 320; }
    else if (aspectRatio === '3:4') { targetW = 320; targetH = 426; }
    else { targetW = 568; targetH = 320; }
  } else if (quality === '520p' || quality === '540p') {
    if (aspectRatio === '9:16') { targetW = 520; targetH = 924; }
    else if (aspectRatio === '1:1') { targetW = 520; targetH = 520; }
    else if (aspectRatio === '4:3') { targetW = 694; targetH = 520; }
    else if (aspectRatio === '3:4') { targetW = 520; targetH = 694; }
    else { targetW = 924; targetH = 520; }
  } else {
    // 720p HD default
    if (aspectRatio === '9:16') { targetW = 720; targetH = 1280; }
    else if (aspectRatio === '1:1') { targetW = 720; targetH = 720; }
    else if (aspectRatio === '4:3') { targetW = 960; targetH = 720; }
    else if (aspectRatio === '3:4') { targetW = 720; targetH = 960; }
    else { targetW = 1280; targetH = 720; }
  }

  try {
    const exportDim = utils.getExportResolutionDimensions(
      aspectRatio as any,
      dom.videoExportResolutionSelect?.value || (state as any).exportResolution
    );
    if (exportDim && exportDim.width > 0 && exportDim.height > 0) {
      targetW = Math.min(targetW, exportDim.width);
      targetH = Math.min(targetH, exportDim.height);
    }
  } catch {
    // fallback to computed preview dimensions
  }

  // Ensure even pixel dimensions
  targetW = Math.round(targetW / 2) * 2;
  targetH = Math.round(targetH / 2) * 2;

  return { width: targetW, height: targetH };
}

export function drawVideoFrame(...args: Parameters<typeof drawVideoFrameImpl>) {
  const s = t0();
  try { return drawVideoFrameImpl(...args); }
  finally { t1(args[1] ? 'frame.export' : 'frame.preview', s); }
}

function drawVideoFrameImpl(
  time: number,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas,
  providedCtx?: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any | null,
  options?: { backgroundOnly?: boolean }
) {
  const now = performance.now();
  if (lastFrameTime > 0) {
    const frameTime = now - lastFrameTime;
    totalFrames++;
    if (frameTime > 33 && !targetCanvas) frameSkipCount++;
  }
  lastFrameTime = now;

  if (!videoRenderContext || videoRenderContext.clips.length === 0) return;

  const { clips, totalDuration } = videoRenderContext;
  const canvas = targetCanvas || dom.videoCanvas;
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = providedCtx || canvas.getContext('2d', { alpha: false, desynchronized: true, willReadFrequently: false });
  if (!ctx) return;

  let cvW: number;
  let cvH: number;

  let cur: TimelineClip | null = null;
  let nxt: TimelineClip | null = null;
  let tIn = 0;
  let inGapHold = false;

  const isAbs = timelineState.mode === 'audio_locked';

  if (isAbs) {
    activeClipIndex.ensure(clips, timelineState.clipsVersion);
    const ai = activeClipIndex.find(time);
    if ((import.meta as any).env?.DEV && ++devCheck % 120 === 0 && linearFind(clips, time) !== ai) {
      console.warn('[ActiveClipIndex] mismatch', { time, fast: ai, linear: linearFind(clips, time) });
    }
    if (ai !== -1) {
      cur = clips[ai];
      nxt = clips[ai + 1] || null;
      tIn = time - activeClipIndex.startOf(ai);
    } else {
      const li = activeClipIndex.lastEnded(time);
      if (li !== -1) {
        cur = clips[li];
        nxt = clips[li + 1] || null;
        const curLenForGap = Math.max(0.001, (isNum(cur.endTime) && isNum(cur.startTime)) ? cur.endTime - cur.startTime : cur.duration);
        tIn = Math.max(0, curLenForGap - 1e-3);
        inGapHold = true;
      }
    }
  } else {
    let cum = 0;
    for (let i = 0; i < clips.length; i++) {
      if (time >= cum && time < cum + clips[i].duration) {
        cur = clips[i];
        nxt = clips[i + 1] || null;
        tIn = time - cum;
        break;
      }
      cum += clips[i].duration;
    }
  }

  if (!cur) {
    if (time >= totalDuration - 0.1 && clips.length > 0) {
      cur = clips[clips.length - 1];
      tIn = Math.max(0.001, (isAbs && isNum(cur.endTime) && isNum(cur.startTime)) ? cur.endTime - cur.startTime : cur.duration);
    } else {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
  }

  if (!cur) return;

  // If cur is a pip_overlay shot, check if there is an overlapping base clip (e.g. multi-track timeline)
  // In single-track sequential workflows, cur remains the active shot at this timestamp and renders full A-roll
  // beneath its own floating pop-up card, without borrowing unrelated settings or media from Shot 2 or other shots.
  let activePipOverlayClip: TimelineClip | null = null;
  if (cur.displayMode === 'pip_overlay') {
    activePipOverlayClip = cur;
    const currentClipId = cur.id;
    // Check for an overlapping non-pip base clip that is genuinely active at the exact current time (multi-track layout)
    const baseClip = timelineState.clips.find(c => c.id !== currentClipId && c.displayMode !== 'pip_overlay' && (c.startTime || 0) <= time && (c.endTime || 0) > time);
    if (baseClip) {
      cur = baseClip;
      tIn = Math.max(0, time - (baseClip.startTime || 0));
    }
  }

  if (!cur) return;

  const lite = !targetCanvas && !state.isExporting && Boolean(state.responsivePreview) && isInteracting();
  if ((targetCanvas || state.isExporting) && lite) {
    console.error('lite mode active during export or targetCanvas render');
  }

  const curLen = Math.max(0.001, (isAbs && isNum(cur.endTime)) ? (cur.endTime - cur.startTime) : cur.duration);

  // Optimization: When an export canvas is provided, we can skip expensive DOM measurements.
  if (targetCanvas) {
    cvW = canvas.width;
    cvH = canvas.height;
  } else {
    // Render preview frames at min(720p, export) scale for smooth real-time scrubbing and playback
    const ratio = state.aspectRatio || '16:9';
    const { width: targetW, height: targetH } = getPreviewDimensions(ratio);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    
    cvW = targetW;
    cvH = targetH;
  }

  ctx.clearRect(0, 0, cvW, cvH);
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, cvW, cvH);

  const activeVideosThisFrame = new Set<HTMLVideoElement>();

  const drawImageContain = (media: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | any, movement: string, progress: number, alpha = 1, clipDuration = 5, focalPoint?: { x: number; y: number }, videoStartOffset = 0, cameraKeyframes?: any, associatedClip?: any) => {
    if (!media) return;
    if (timelineState.isTrackHidden('video')) return;

    const isVideo = media instanceof HTMLVideoElement;
    const mediaW = Math.max(1, isVideo ? (media as HTMLVideoElement).videoWidth : ((media as any).videoWidth || (media as any).width || 1920));
    const mediaH = Math.max(1, isVideo ? (media as HTMLVideoElement).videoHeight : ((media as any).videoHeight || (media as any).height || 1080));
    const mediaAR = mediaW / mediaH;
    const canvasAR = cvW / cvH;

    const activeClip = associatedClip || cur;
    const shotFilter = activeClip?.colorFilter || 'none';
    const shotFilterIntensity = typeof activeClip?.colorFilterIntensity === 'number' ? activeClip.colorFilterIntensity : 1.0;
    const shotFilterCss = getShotFilterCss(shotFilter, shotFilterIntensity);

    let dW: number, dH: number, dX: number, dY: number;

    if (mediaAR > canvasAR) {
      dW = cvW;
      dH = cvW / mediaAR;
      dX = 0;
      dY = (cvH - dH) / 2;
    } else {
      dH = cvH;
      dW = cvH * mediaAR;
      dX = (cvW - dW) / 2;
      dY = 0;
    }

    const showBgBlur = !lite && state.enableBackgroundBlur !== false && timelineState.videoEffects.enableBackgroundBlur !== false;
    if (showBgBlur && (dX > 0 || dY > 0)) {
      // Blur cost scales with pixel count, and a full-canvas `filter: blur()`
      // pass (previously done directly at up to 1.2x canvas resolution, every
      // frame) is one of the most expensive things Canvas2D can do — especially
      // with a <video> source, which many browsers snapshot to a temp bitmap
      // before they can filter it at all. Uploaded clips hit this constantly
      // because they rarely match the project's aspect ratio (unlike generated
      // images, which are produced pre-fitted and mostly skip this branch).
      //
      // Fix: downsample first, blur+darken the tiny copy (cheap — small radius
      // over a fraction of the pixels), then scale the already-soft result
      // back up with a plain, filter-free blit. The upscale's own bilinear
      // interpolation supplies the final softness, so no second filter pass at
      // full resolution is needed. Visually indistinguishable at this blur
      // radius; the expensive filter step now runs over ~100x fewer pixels.
      const bw = Math.max(1, Math.round(cvW * 0.12));
      const bh = Math.max(1, Math.round(cvH * 0.12));
      const surf = getBlurSurface(bw, bh);
      if (surf) {
        surf.ctx.setTransform(1, 0, 0, 1, 0, 0);
        surf.ctx.globalCompositeOperation = 'source-over';
        surf.ctx.globalAlpha = 1;
        // Scale the blur radius down with the surface so the relative amount
        // of blur matches what the full-resolution version looked like.
        surf.ctx.filter = shotFilterCss !== 'none' ? `blur(3px) brightness(0.65) ${shotFilterCss}` : 'blur(3px) brightness(0.65)';
        surf.ctx.drawImage(media, 0, 0, mediaW, mediaH, -bw * 0.1, -bh * 0.1, bw * 1.2, bh * 1.2);
        surf.ctx.filter = 'none';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'high';
        ctx.drawImage(surf.canvas, 0, 0, bw, bh, 0, 0, cvW, cvH);
        ctx.restore();
      } else {
        // Fallback if an offscreen context couldn't be created for some reason.
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.filter = shotFilterCss !== 'none' ? `blur(22px) brightness(0.65) ${shotFilterCss}` : 'blur(22px) brightness(0.65)';
        ctx.drawImage(media, 0, 0, mediaW, mediaH, -cvW * 0.1, -cvH * 0.1, cvW * 1.2, cvH * 1.2);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, cvW, cvH);
    }

    if (isVideo) {
        const video = media as HTMLVideoElement;
        activeVideosThisFrame.add(video);
        const activeClip = associatedClip || cur;
        const clipStart = activeClip?.startTime;
        const clipEnd = activeClip?.endTime;
        const isOutOfClip = typeof clipStart === 'number' && typeof clipEnd === 'number' && (time < clipStart || time >= clipEnd);
        const isMasterVideo = (video === state.uploadedVideoElement) ||
                              (activeClip && activeClip.talkingHeadVideoElement === video) ||
                              (activeClip && !activeClip._videoObjectURL && state.uploadedVideoElement === video) ||
                              (activeClip && activeClip._videoObjectURL && state.uploadedVideoElement && activeClip._videoObjectURL === state.uploadedVideoElement.src);
        const clip = activeClip || timelineState.clips.find(c => c.talkingHeadVideoElement === video || c.videoElement === video);
        const useOriginalAudio = clip?.useOriginalAudio || clip?.soloAudio || false;
        let targetVol = (clip as any)?.volume !== undefined ? (clip as any).volume : 1.0;
        if (!clip?.soloAudio && timelineState.masterAudioBuffer && state.audioDuckingEnabled && (clip as any)?.audioDuckingOverride !== false) {
            targetVol *= 0.25;
        }

        const fadeIn = (clip as any)?.fadeIn || 0;
        const fadeOut = (clip as any)?.fadeOut || 0;
        const tIn = progress * clipDuration;
        if (fadeIn > 0 && tIn < fadeIn) {
            targetVol *= (tIn / fadeIn);
        }
        if (fadeOut > 0 && tIn > clipDuration - fadeOut) {
            targetVol *= ((clipDuration - tIn) / fadeOut);
        }

        if (video.readyState < 2 && !(video as any)._hasFrameListener) {
            (video as any)._hasFrameListener = true;
            const onFrameReady = () => {
                (video as any)._hasFrameListener = false;
                video.removeEventListener('loadeddata', onFrameReady);
                video.removeEventListener('seeked', onFrameReady);
                video.removeEventListener('canplay', onFrameReady);
                if (!state.isVideoPlaying && !state.isExporting) {
                    drawVideoFrame(state.videoPauseTime || 0);
                }
            };
            video.addEventListener('loadeddata', onFrameReady, { once: true });
            video.addEventListener('seeked', onFrameReady, { once: true });
            video.addEventListener('canplay', onFrameReady, { once: true });
        }
        const rate = (clip as any)?.playbackRate && !(clip as any)?.wordTimestamps?.length ? (clip as any).playbackRate : 1;
        video.playbackRate = rate;
        (video as any).preservesPitch = true; // Chromium default; keep voice natural

        const effectiveOffset = (isMasterVideo && (!videoStartOffset || videoStartOffset === 0))
            ? (activeClip?.startTime || 0)
            : (videoStartOffset || 0);

        let targetTime = effectiveOffset + (progress * clipDuration * rate);
        if (video.duration && targetTime > video.duration) {
            targetTime = Math.min(video.duration - 0.03, targetTime % video.duration || video.duration - 0.03);
        }
        
        // Optimize setting currentTime
        if (targetCanvas || state.isExporting || isOutOfClip) {
            if (!video.paused) {
                try { video.pause(); } catch (e) { }
            }
            video.muted = true;
            if (!state.isExporting && !isOutOfClip && Math.abs(video.currentTime - targetTime) > 0.05) {
                video.currentTime = targetTime;
            }
        } else if (state.isVideoPlaying) {
             if (video.paused) {
                 if (!state.isExporting && Math.abs(video.currentTime - targetTime) > 0.05) {
                     video.currentTime = targetTime;
                 }
                 video.muted = !useOriginalAudio;
                 video.play().catch(e => console.warn(e));
             } else if (Math.abs(video.currentTime - targetTime) > 0.3) {
                 // Resync if drifting significantly
                 video.currentTime = targetTime;
                 video.muted = !useOriginalAudio;
             }
             video.muted = !useOriginalAudio;
             video.volume = Math.max(0, Math.min(1, targetVol * alpha));
        } else {
             if (!video.paused) {
                 try { video.pause(); } catch (e) { }
             }
             // In paused mode or scrubbing, sync time closely
             if (!state.isExporting && Math.abs(video.currentTime - targetTime) > 0.05) {
                 video.currentTime = targetTime;
             }
        }

        const rotate = (clip as any)?.rotate || 0;

        ctx.save();
        ctx.globalAlpha = alpha;
        if (shotFilterCss !== 'none') {
          ctx.filter = shotFilterCss;
        }
        if (state.cameraShakeHandheld) {
          const motionMult = typeof state.cameraMotionIntensity === 'number' ? state.cameraMotionIntensity : 1.0;
          const driftX = (Math.sin(time * 1.35) * 0.7 + Math.sin(time * 2.7) * 0.3) * (cvW * 0.0035) * motionMult;
          const driftY = (Math.cos(time * 1.15) * 0.7 + Math.cos(time * 2.1) * 0.3) * (cvH * 0.0035) * motionMult;
          const driftRot = Math.sin(time * 0.85) * 0.002 * motionMult;
          ctx.translate(dX + dW / 2, dY + dH / 2);
          ctx.rotate(driftRot);
          ctx.translate(-(dX + dW / 2) + driftX, -(dY + dH / 2) + driftY);
        }
        const safeSource = state.isExporting ? video : captureVideoFrameBuffer(video, mediaW, mediaH);
        drawRotated(ctx, safeSource, 0, 0, mediaW, mediaH, dX, dY, dW, dH, rotate);
        ctx.filter = 'none';
        if (shotFilter !== 'none') {
          applyShotOverlays(ctx, shotFilter, shotFilterIntensity, dX, dY, dW, dH, time);
        }
        ctx.restore();
        return;
    }

    const image = media as HTMLImageElement;
    const bgProgress = progress * 0.95;
    const fgProgress = progress;

    let bg: any;
    let fg: any;
    if (cameraKeyframes) {
      bg = utils.getKeyframeCameraTransforms(cameraKeyframes, bgProgress, mediaW, mediaH, cvW, cvH, clipDuration);
      fg = utils.getKeyframeCameraTransforms(cameraKeyframes, fgProgress, mediaW, mediaH, cvW, cvH, clipDuration);
    } else {
      bg = utils.getKenBurnsTransforms(movement, bgProgress, mediaW, mediaH, cvW, cvH, clipDuration, focalPoint);
      fg = utils.getKenBurnsTransforms(movement, fgProgress, mediaW, mediaH, cvW, cvH, clipDuration, focalPoint);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    if (shotFilterCss !== 'none') {
      ctx.filter = shotFilterCss;
    }

    if (state.cameraShakeHandheld) {
      const motionMult = typeof state.cameraMotionIntensity === 'number' ? state.cameraMotionIntensity : 1.0;
      const driftX = (Math.sin(time * 1.35) * 0.7 + Math.sin(time * 2.7) * 0.3) * (cvW * 0.0035) * motionMult;
      const driftY = (Math.cos(time * 1.15) * 0.7 + Math.cos(time * 2.1) * 0.3) * (cvH * 0.0035) * motionMult;
      const driftRot = Math.sin(time * 0.85) * 0.002 * motionMult;
      ctx.translate(dX + dW / 2, dY + dH / 2);
      ctx.rotate(driftRot);
      ctx.translate(-(dX + dW / 2) + driftX, -(dY + dH / 2) + driftY);
    }

    if (fg.rotation) {
      ctx.translate(dX + dW / 2, dY + dH / 2);
      ctx.rotate(fg.rotation);
      ctx.translate(-(dX + dW / 2), -(dY + dH / 2));
    }

    if (!cameraKeyframes && movement === 'static' && alpha === 1) {
      const cached = getCachedScaledImage(image, Math.round(dW), Math.round(dH));
      ctx.drawImage(cached, dX, dY);
    } else if (!cameraKeyframes && movement === 'static') {
      ctx.drawImage(image, fg.sx, fg.sy, fg.sWidth, fg.sHeight, dX, dY, dW, dH);
    } else {
      // Whip pan: smear a couple of trailing offset copies during the fast middle
      // section of the move (velocity peaks around progress ~0.3–0.7 with cubic easing).
      if ((movement === 'whip_pan' || cameraKeyframes?.easing === 'whip') && fgProgress > 0.15 && fgProgress < 0.85) {
        const velocity = Math.sin(fgProgress * Math.PI); // 0 at ends, 1 at midpoint
        const smearPx = velocity * dW * 0.02;
        ctx.save();
        ctx.globalAlpha = alpha * 0.25 * velocity;
        ctx.drawImage(image, fg.sx, fg.sy, fg.sWidth, fg.sHeight, dX + smearPx, dY, dW, dH);
        ctx.globalAlpha = alpha * 0.15 * velocity;
        ctx.drawImage(image, fg.sx, fg.sy, fg.sWidth, fg.sHeight, dX + smearPx * 2, dY, dW, dH);
        ctx.restore();
      }

      // 2.5D Depth Parallax using WebGL
      const webglCanvas = !lite && state.enableParallaxEffect
        ? drawWebGLParallax(
            image, Math.round(dW), Math.round(dH), bg, fg, movement, progress, focalPoint,
            fg.speedFactor,            // kept for signature compatibility; blur no longer depends on it
            0,                         // camera roll: still handled by your existing ctx.rotate above
            { clipDuration, clipId: (associatedClip as any)?.id || (cur as any)?.id }
          )
        : null;
      if (webglCanvas) {
        ctx.drawImage(webglCanvas, dX, dY, dW, dH);
      } else {
        ctx.drawImage(image, fg.sx, fg.sy, fg.sWidth, fg.sHeight, dX, dY, dW, dH);
      }
    }
    
    if (timelineState.videoEffects.autoColorMatch) {
      const stats = getImageStats(image);
      const targetLuma = 110;

      const lumaDiff = targetLuma - stats.luminance;
      if (Math.abs(lumaDiff) > 15) {
        ctx.save();
        ctx.globalCompositeOperation = lumaDiff > 0 ? 'screen' : 'multiply';
        const adjustStrength = Math.min(Math.abs(lumaDiff) / 255, 0.12);
        ctx.fillStyle = lumaDiff > 0 ? `rgba(255, 255, 255, ${adjustStrength})` : `rgba(0, 0, 0, ${adjustStrength})`;
        ctx.fillRect(dX, dY, dW, dH);
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(120, 115, 110, 0.05)';
      ctx.fillRect(dX, dY, dW, dH);
      ctx.restore();
    }

    ctx.filter = 'none';
    if (shotFilter !== 'none') {
      applyShotOverlays(ctx, shotFilter, shotFilterIntensity, dX, dY, dW, dH, time);
    }

    ctx.restore();
  };

  const sMedia = t0();
  const prog = Math.min(1, tIn / curLen);
  let resolvedTransition = cur.transitionToNext || 'cut';
  const globalStyle = timelineState.videoTransitionStyle || 'narrative_guided';
  
  if (globalStyle === 'random_mix') {
    const candidateTransitions = [
      'cross_dissolve',
      'cross_dissolve',
      'zoom_dissolve',
      'push',
      'blur_dissolve',
      'fade_to_black',
    ];
    const hash = (cur.id || '').split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    resolvedTransition = candidateTransitions[hash % candidateTransitions.length];
  } else if (globalStyle !== 'narrative_guided' && globalStyle !== 'ai_directed') {
    resolvedTransition = globalStyle;
  }
  const tType = resolvedTransition.replace(/_/g, '').toLowerCase();
  const wantsTransition = Boolean(nxt && tType !== 'cut');

  let isTrans = false;
  let tP = 0;
  let holdNext = false;

  if (wantsTransition && nxt && typeof cur._transitionStart === 'number' && typeof cur._transitionEnd === 'number') {
    if (time >= cur._transitionStart && time < cur._transitionEnd) {
      isTrans = true;
      tP = (time - cur._transitionStart) / cur._transitionDuration!;
    }
  }

  if (inGapHold && wantsTransition) {
    holdNext = true;
  }

  const getBg = (c: any) => {
    if (!c) return null;
    const thV = getClipVideoDrawable(c, 'talkingHead') || state.uploadedVideoElement;
    const thM = c.talkingHeadMode || (thV ? (state.talkingHeadDefaultMode || 'none') : 'none');
    if (thV && (thM === 'full' || c.displayMode === 'pip_overlay')) return thV;
    const optImg = state.isExporting && c._exportOptimizedImage ? c._exportOptimizedImage : null;
    const expVid = getClipVideoDrawable(c, 'primary');
    return expVid || optImg || c.backgroundPlate || c.image || (thV && thM !== 'none' ? thV : null) || thV;
  };
  const curBg = getBg(cur);
  const nxtBg = getBg(nxt);

  if (holdNext && nxt) {
    drawImageContain(nxtBg!, nxt.cameraMovement, 0, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
  } else if (isTrans) {
    if (!nxt) {
      drawImageContain(curBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
    } else {
      const easedT = tP * tP * (3 - 2 * tP);
      const whipT = tP < 0.5 ? 8 * tP * tP * tP * tP : 1 - Math.pow(-2 * tP + 2, 4) / 2;
      const velocityPeak = Math.sin(Math.min(1, Math.max(0, tP)) * Math.PI);

      // Advance incoming shot during transition handle so it is already in motion (never frozen at 0)
      const transDur = cur._transitionDuration || 0.5;
      const nxtLen = Math.max(0.001, isAbs && isNum(nxt.endTime) && isNum(nxt.startTime) ? nxt.endTime - nxt.startTime : (nxt.duration || 3));
      const nxtProg = Math.min(1, Math.max(0, (tP * transDur) / nxtLen));

      let curEffectiveBg: any = curBg;
      if (curBg && nxtBg && curBg === nxtBg && curBg instanceof HTMLVideoElement) {
        if (!transitionOffscreenCanvas) {
          transitionOffscreenCanvas = document.createElement('canvas');
        }
        const vw = curBg.videoWidth || cvW;
        const vh = curBg.videoHeight || cvH;
        if (transitionOffscreenCanvas.width !== vw || transitionOffscreenCanvas.height !== vh) {
          transitionOffscreenCanvas.width = vw;
          transitionOffscreenCanvas.height = vh;
        }
        const tCtx = transitionOffscreenCanvas.getContext('2d');
        if (tCtx && curBg.readyState >= 2) {
          tCtx.drawImage(curBg, 0, 0, vw, vh);
          curEffectiveBg = transitionOffscreenCanvas;
        }
      }

      // --- BLUR DISSOLVE ---
      if (tType === 'blurdissolve') {
        const sc = 0.6;
        const bw = Math.round(cvW * sc);
        const bh = Math.round(cvH * sc);
        const surf = getBlurSurface(bw, bh);
        const curImg = state.isExporting && cur._exportOptimizedImage ? cur._exportOptimizedImage : (cur.backgroundPlate || cur.image);
        const nxtImg = state.isExporting && nxt._exportOptimizedImage ? nxt._exportOptimizedImage : (nxt.backgroundPlate || nxt.image);
        if (surf && !cur.videoElement && !nxt.videoElement && curImg && nxtImg) {
          const curW = Number((curImg as any).width || (curImg as any).naturalWidth || cvW);
          const curH = Number((curImg as any).height || (curImg as any).naturalHeight || cvH);
          const nxtW = Number((nxtImg as any).width || (nxtImg as any).naturalWidth || cvW);
          const nxtH = Number((nxtImg as any).height || (nxtImg as any).naturalHeight || cvH);
          const { sx, sy, sWidth, sHeight } = utils.getKenBurnsTransforms(cur.cameraMovement, prog, curW, curH, cvW, cvH, cur.duration, cur.focalPoint);
          const { sx: nsx, sy: nsy, sWidth: nsw, sHeight: nsh } = utils.getKenBurnsTransforms(nxt.cameraMovement, nxtProg, nxtW, nxtH, cvW, cvH, nxt.duration, nxt.focalPoint);
          surf.ctx.setTransform(1, 0, 0, 1, 0, 0);
          surf.ctx.globalCompositeOperation = 'source-over';
          surf.ctx.clearRect(0, 0, bw, bh);
          surf.ctx.globalAlpha = 1 - easedT;
          surf.ctx.drawImage(curImg, sx, sy, sWidth, sHeight, 0, 0, bw, bh);
          surf.ctx.globalAlpha = easedT;
          surf.ctx.drawImage(nxtImg, nsx, nsy, nsw, nsh, 0, 0, bw, bh);
          surf.ctx.globalAlpha = 1;
          const blurAmount = velocityPeak * 12;
          ctx.save();
          ctx.filter = `blur(${blurAmount.toFixed(1)}px)`;
          ctx.drawImage(surf.canvas, 0, 0, bw, bh, 0, 0, cvW, cvH);
          ctx.restore();
        } else {
          drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1 - easedT, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
          drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, easedT, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        }

      // --- FADE TO BLACK ---
      } else if (tType === 'fadetoblack') {
        const midpoint = 0.5;
        if (easedT < midpoint) {
          drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1 - easedT / midpoint, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        } else {
          drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, (easedT - midpoint) / midpoint, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        }

      // --- FADE TO WHITE ---
      } else if (tType === 'fadetowhite') {
        const midpoint = 0.5;
        if (easedT < midpoint) {
          const fo = easedT / midpoint;
          drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1 - fo, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
          ctx.save();
          ctx.globalAlpha = fo;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, cvW, cvH);
          ctx.restore();
        } else {
          const fi = (easedT - midpoint) / midpoint;
          drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, fi, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
          ctx.save();
          ctx.globalAlpha = 1 - fi;
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, cvW, cvH);
          ctx.restore();
        }

      // --- ZOOM DISSOLVE (Continuous Forward Optical Flow: 1.0 -> 1.24 out, 0.84 -> 1.0 in) ---
      } else if (tType === 'zoomdissolve') {
        const scaleOut = 1 + whipT * 0.24;
        const scaleIn = 0.84 + whipT * 0.16;
        ctx.save();
        ctx.translate(cvW / 2, cvH / 2);
        ctx.scale(scaleOut, scaleOut);
        ctx.translate(-cvW / 2, -cvH / 2);
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1 - whipT, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        ctx.restore();

        ctx.save();
        ctx.translate(cvW / 2, cvH / 2);
        ctx.scale(scaleIn, scaleIn);
        ctx.translate(-cvW / 2, -cvH / 2);
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, whipT, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- SWIPE (with whip curve) ---
      } else if (tType.startsWith('swipe')) {
        ctx.save();
        ctx.beginPath();
        if (tType === 'swipeleft') {
          ctx.rect(whipT * cvW, 0, cvW * (1 - whipT), cvH);
        } else if (tType === 'swiperight') {
          ctx.rect(0, 0, cvW * (1 - whipT), cvH);
        } else if (tType === 'swipeup') {
          ctx.rect(0, whipT * cvH, cvW, cvH * (1 - whipT));
        } else {
          ctx.rect(0, 0, cvW * (1 - whipT));
        }
        ctx.clip();
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        if (tType === 'swipeleft') {
          ctx.rect(0, 0, whipT * cvW, cvH);
        } else if (tType === 'swiperight') {
          ctx.rect(cvW * (1 - whipT), 0, cvW * whipT, cvH);
        } else if (tType === 'swipeup') {
          ctx.rect(0, 0, cvW, whipT * cvH);
        } else {
          ctx.rect(0, cvH * (1 - whipT), cvW, cvH * whipT);
        }
        ctx.clip();
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- WIPE ---
      } else if (tType === 'wipe') {
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cvW * whipT, cvH);
        ctx.clip();
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- PUSH (Whip-Pan Slide with Horizontal Velocity Stretch) ---
      } else if (tType === 'push') {
        const stretch = 1 + velocityPeak * 0.035;
        ctx.save();
        ctx.translate(-whipT * cvW, 0);
        ctx.scale(stretch, 1);
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        ctx.restore();

        ctx.save();
        ctx.translate(cvW * (1 - whipT), 0);
        ctx.scale(stretch, 1);
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- FLASH CUT (Exponential Warm Film Flash) ---
      } else if (tType === 'flash' || tType === 'whitepop') {
        const flashAlpha = tP < 0.35 ? (tP / 0.35) * 0.92 : Math.pow(1 - (tP - 0.35) / 0.65, 2.2) * 0.92;
        if (tP < 0.35) {
          drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        } else {
          drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        }
        ctx.fillStyle = `rgba(255, 250, 240, ${flashAlpha})`;
        ctx.fillRect(0, 0, cvW, cvH);

      // --- GLITCH / RGB SPLIT (Deterministic) ---
      } else if (tType === 'glitch' || tType === 'rgbsplit') {
        const glitchIntensity = velocityPeak * 24;
        const activeTarget = easedT < 0.5 ? curEffectiveBg! : nxtBg!;
        const activeClipObj = easedT < 0.5 ? cur : nxt;
        const activeProg = easedT < 0.5 ? prog : nxtProg;

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.translate(-glitchIntensity * 0.6, 0);
        drawImageContain(activeTarget, activeClipObj.cameraMovement, activeProg, 1, activeClipObj.duration, activeClipObj.focalPoint, activeClipObj.videoStartOffset || 0, activeClipObj.cameraKeyframes, activeClipObj);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.18)';
        ctx.fillRect(0, 0, cvW, cvH);
        ctx.restore();

        ctx.save();
        ctx.translate(glitchIntensity * 0.6, 0);
        drawImageContain(activeTarget, activeClipObj.cameraMovement, activeProg, 1, activeClipObj.duration, activeClipObj.focalPoint, activeClipObj.videoStartOffset || 0, activeClipObj.cameraKeyframes, activeClipObj);
        ctx.fillStyle = 'rgba(0, 255, 255, 0.18)';
        ctx.fillRect(0, 0, cvW, cvH);
        ctx.restore();

        if (glitchIntensity > 4) {
          const barSeed = Math.abs(Math.sin(time * 97.13));
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.fillRect(0, barSeed * cvH * 0.8, cvW, cvH * 0.12);
        }

      // --- SPIN / ROTATE ---
      } else if (tType === 'spin' || tType === 'rotate') {
        ctx.save();
        ctx.translate(cvW / 2, cvH / 2);
        ctx.rotate(easedT * Math.PI * 0.5);
        ctx.scale(1 - easedT * 0.4, 1 - easedT * 0.4);
        ctx.translate(-cvW / 2, -cvH / 2);
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, Math.max(0, 1 - easedT * 1.5), cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        ctx.restore();

        ctx.save();
        ctx.translate(cvW / 2, cvH / 2);
        ctx.rotate((1 - easedT) * -Math.PI * 0.5);
        ctx.scale(0.6 + easedT * 0.4, 0.6 + easedT * 0.4);
        ctx.translate(-cvW / 2, -cvH / 2);
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, Math.min(1, easedT * 1.5), nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- IRIS WIPE ---
      } else if (tType === 'iris' || tType === 'circlewipe') {
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        const maxRadius = Math.hypot(cvW / 2, cvH / 2);
        const currentRadius = easedT * maxRadius;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cvW / 2, cvH / 2, currentRadius, 0, Math.PI * 2);
        ctx.clip();
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, 1, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
        ctx.restore();

      // --- CROSS DISSOLVE (default) ---
      } else {
        drawImageContain(curEffectiveBg!, cur.cameraMovement, prog, 1 - easedT, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
        drawImageContain(nxtBg!, nxt.cameraMovement, nxtProg, easedT, nxt.duration, nxt.focalPoint, nxt.videoStartOffset || 0, nxt.cameraKeyframes, nxt);
      }

      // Draw PiP overlay across transition if active on either outgoing or incoming shot
      // (skipped in backgroundOnly passes — see drawExportOverlayLayer, which redraws
      // this on top of the cached plate every export frame instead)
      if (!options?.backgroundOnly) {
        const transTHVideo = getClipVideoDrawable(cur, 'talkingHead') || (nxt ? getClipVideoDrawable(nxt, 'talkingHead') : null) || state.uploadedVideoElement;
        let curTHMode = cur.talkingHeadMode || (transTHVideo ? (state.talkingHeadDefaultMode || 'none') : 'none');
        let nxtTHMode = nxt.talkingHeadMode || (transTHVideo ? (state.talkingHeadDefaultMode || 'none') : 'none');
        if (cur.displayMode === 'pip_overlay' && transTHVideo) curTHMode = 'full';
        if (nxt?.displayMode === 'pip_overlay' && transTHVideo) nxtTHMode = 'full';
        if (transTHVideo && (curTHMode.startsWith('pip') || nxtTHMode.startsWith('pip'))) {
          const activeClip = curTHMode.startsWith('pip') ? cur : nxt;
          drawTalkingHeadPiP(ctx, transTHVideo, activeClip, cvW, cvH, time, targetCanvas);
        }

        if (cur.overlayImage || cur.overlayVideoElement || (nxt && (nxt.overlayImage || nxt.overlayVideoElement))) {
          const activeOverlayClip = (cur.overlayImage || cur.overlayVideoElement) ? cur : nxt;
          drawCornerCalloutOverlay(ctx, activeOverlayClip, cvW, cvH, prog);
        }

        // Draw Pop-Up B-Roll (Picture-in-Picture Callout) Overlays across transitions
        const activeTransPipClips = timelineState.clips.filter(c => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
        if (activePipOverlayClip && !activeTransPipClips.includes(activePipOverlayClip)) {
          activeTransPipClips.push(activePipOverlayClip);
        }
        for (const pipC of activeTransPipClips) {
          drawPopUpBrollPipOverlay(ctx, pipC, cvW, cvH, time, targetCanvas);
        }
      }
    }
  } else {
    const thVideo = getClipVideoDrawable(cur, 'talkingHead') || getClipVideoDrawable(cur, 'secondary') || cur.secondaryImage || (cur.videoElement && cur.image ? getClipVideoDrawable(cur, 'primary') : null) || state.uploadedVideoElement;
    let thMode = cur.talkingHeadMode || (thVideo ? (state.talkingHeadDefaultMode || 'none') : 'none');

    // When a shot is in Pop-Up Overlay mode (activePipOverlayClip):
    // If an A-Roll presenter video is present, the presenter should always fill the screen in Full mode
    // as the host background layer behind the floating B-Roll callout card!
    if (activePipOverlayClip && thVideo) {
      thMode = 'full';
    }

    // Not in a transition
    if (thVideo && thMode === 'full') {
      if (thVideo instanceof HTMLVideoElement) syncTalkingHeadVideo(thVideo, time, cur, targetCanvas, activeVideosThisFrame);
      drawImageContain(thVideo, 'static', prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, undefined, cur);
    } else if (thMode === 'split') {
      drawTalkingHeadSplit(ctx, thVideo || curBg!, cur, cvW, cvH, time, tIn, curLen, targetCanvas, drawImageContain, activeVideosThisFrame);
    } else if (cur.elements?.length) {
      deriveElementEnterTimes(cur);
      const curPlateOrImg = (state.isExporting && cur._exportOptimizedImage) ? cur._exportOptimizedImage : (cur.backgroundPlate ?? cur.image!);
      drawImageContain(curPlateOrImg, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
      drawElementBuild(ctx, time, cur, cvW, cvH);
    } else if (activePipOverlayClip && !thVideo) {
      // No A-roll presenter video available: render a cinematic dimmed/blurred backdrop of this shot so the pop-up card stands out
      const bw = Math.max(1, Math.round(cvW * 0.15));
      const bh = Math.max(1, Math.round(cvH * 0.15));
      const surf = getBlurSurface(bw, bh);
      if (surf && curBg) {
        surf.ctx.setTransform(1, 0, 0, 1, 0, 0);
        surf.ctx.globalCompositeOperation = 'source-over';
        surf.ctx.globalAlpha = 1;
        surf.ctx.filter = 'blur(3px) brightness(0.4)';
        const mediaW = (curBg as any).videoWidth || (curBg as any).naturalWidth || curBg.width || cvW;
        const mediaH = (curBg as any).videoHeight || (curBg as any).naturalHeight || curBg.height || cvH;
        surf.ctx.drawImage(curBg, 0, 0, mediaW, mediaH, 0, 0, bw, bh);
        surf.ctx.filter = 'none';
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.imageSmoothingEnabled = true;
        (ctx as any).imageSmoothingQuality = 'high';
        ctx.drawImage(surf.canvas, 0, 0, bw, bh, 0, 0, cvW, cvH);
        ctx.restore();
      } else {
        ctx.save();
        ctx.filter = 'blur(18px) brightness(0.4)';
        drawImageContain(curBg!, 'static', prog, 0.85, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, undefined, cur);
        ctx.restore();
      }
    } else {
      drawImageContain(curBg!, cur.cameraMovement, prog, 1, cur.duration, cur.focalPoint, cur.videoStartOffset || 0, cur.cameraKeyframes, cur);
    }
    t1('stage.media', sMedia);

    // Draw Talking Head Picture-in-Picture (PiP) Overlay if mode is PiP (only if NOT in pip_overlay mode)
    // (skipped in backgroundOnly passes — drawExportOverlayLayer redraws this on top of
    // the cached plate every export frame instead of baking one frame of it into the cache)
    if (!options?.backgroundOnly) {
      const sPip = t0();
      if (!activePipOverlayClip && thVideo && thMode && thMode.startsWith('pip')) {
        drawTalkingHeadPiP(ctx, thVideo, cur, cvW, cvH, time, targetCanvas, activeVideosThisFrame);
      }

      // Draw Documentary Picture-in-Picture / Corner Map Callout
      drawCornerCalloutOverlay(ctx, cur, cvW, cvH, prog);

      // Draw Pop-Up B-Roll (Picture-in-Picture Callout) Overlays
      const activePipClips = timelineState.clips.filter(c => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
      if (activePipOverlayClip && !activePipClips.includes(activePipOverlayClip)) {
        activePipClips.push(activePipOverlayClip);
      }
      for (const pipC of activePipClips) {
        drawPopUpBrollPipOverlay(ctx, pipC, cvW, cvH, time, targetCanvas);
      }
      t1('stage.pip', sPip);
    }
  }

  if (options?.backgroundOnly) return;

  const sEffects = t0();
  // Apply Post Effects (Vignette, Grain, Sparkles, Rain, Dust, Snow)
  if (!lite) {
    applyPostEffects(ctx, cvW, cvH, time);
  }

  // Draw Anamorphic 2.39:1 Cinemascope Letterbox Matte Bars
  if (state.cinematicLetterbox) {
    const targetAR = 2.39;
    const currentAR = cvW / cvH;
    if (currentAR < targetAR) {
      const activeH = cvW / targetAR;
      const barH = Math.round((cvH - activeH) / 2);
      if (barH > 0) {
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cvW, barH);
        ctx.fillRect(0, cvH - barH, cvW, barH);
        ctx.restore();
      }
    }
  }
  t1('stage.effects', sEffects);

  // Draw Subtitles (respecting track visibility)
  const sSubs = t0();
  const isPlaceholderText = cur.text && /^(?:master\s+a-?roll|a-?roll)$/i.test(cur.text.trim());
  if (timelineState.showSubtitles && !timelineState.isTrackHidden('captions') && cur.text && !isPlaceholderText) {
      // Use real word timestamps whenever available, regardless of timeline mode.
      // Visual-first production also populates wordTimestamps via sliceTranscriptForShots
      // when audio is generated — gating on audio_locked was preventing real timestamp
      // sync and falling back to character-position-based highlighting instead.
      const hasTimestamps = cur.wordTimestamps != null && cur.wordTimestamps.length > 0;
      let wordIndex = -1;

      let subtitleText = cur.text;
      if (hasTimestamps) {
          wordIndex = findWordIndex(cur.wordTimestamps!, tIn);
          if (!(cur as any)._subtitleTextCache || (cur as any)._cachedTimestampsRef !== cur.wordTimestamps) {
              (cur as any)._subtitleTextCache = cur.wordTimestamps!.map(w => w.word).join(' ');
              (cur as any)._cachedTimestampsRef = cur.wordTimestamps;
          }
          subtitleText = (cur as any)._subtitleTextCache;
      }
      
      SubtitleEngine.draw({
          ctx,
          text: subtitleText,
          progress: prog,
          width: cvW,
          height: cvH,
          style: timelineState.videoSubtitleStyle,
          colors: state.videoSubtitleColors,
          forcedWordIndex: wordIndex,
          hasTimestamps,
          position: timelineState.videoSubtitlePosition,
          clipTime: tIn,
          wordTimestamps: hasTimestamps ? cur.wordTimestamps! : null,
          isPlaying: state.isVideoPlaying
      });
      
      if (state.debugMode && hasTimestamps && wordIndex >= 0) {
          const word = cur.wordTimestamps![wordIndex];
          ctx.save();
          ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          const debugText = `Word ${wordIndex}/${cur.wordTimestamps!.length}: "${word.word}" @ ${tIn.toFixed(2)}s`;
          ctx.fillText(debugText, 10, cvH - 10);
          ctx.restore();
      }
  }
  t1('stage.subtitles', sSubs);

  // Draw Motion Graphics (respecting track visibility)
  const sGraphics = t0();
  if (state.motionGraphicsEnabled && !timelineState.isTrackHidden('overlays')) {
    drawGraphics(ctx, time, cvW, cvH, timelineState.graphics);
  }
  t1('stage.graphics', sGraphics);

  // Draw Rule-of-Thirds Composition Grid Guide (Viewport overlay only, never in export)
  if (state.ruleOfThirdsGuide && !state.isExporting) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    // Vertical grid lines
    ctx.moveTo(cvW / 3, 0); ctx.lineTo(cvW / 3, cvH);
    ctx.moveTo((cvW * 2) / 3, 0); ctx.lineTo((cvW * 2) / 3, cvH);
    // Horizontal grid lines
    ctx.moveTo(0, cvH / 3); ctx.lineTo(cvW, cvH / 3);
    ctx.moveTo(0, (cvH * 2) / 3); ctx.lineTo(cvW, (cvH * 2) / 3);
    ctx.stroke();

    // Subtle center crosshair
    const ch = 12;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cvW / 2 - ch, cvH / 2); ctx.lineTo(cvW / 2 + ch, cvH / 2);
    ctx.moveTo(cvW / 2, cvH / 2 - ch); ctx.lineTo(cvW / 2, cvH / 2 + ch);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Guest Account Preview Watermark during guest exports
  if (state.isGuestExport || (state.isExporting && (state as any).isGuestExport)) {
    drawGuestWatermark(ctx, cvW, cvH);
  }

  // Ensure any video element NOT active on this frame is immediately silenced and paused
  if (state.isVideoPlaying && !targetCanvas && !state.isExporting) {
    if (timelineState.clips) {
      for (const c of timelineState.clips) {
        if (c.videoElement && !activeVideosThisFrame.has(c.videoElement)) {
          c.videoElement.muted = true;
          if (!c.videoElement.paused) {
            try { c.videoElement.pause(); } catch (e) {}
          }
        }
        if (c.talkingHeadVideoElement && !activeVideosThisFrame.has(c.talkingHeadVideoElement)) {
          c.talkingHeadVideoElement.muted = true;
          if (!c.talkingHeadVideoElement.paused) {
            try { c.talkingHeadVideoElement.pause(); } catch (e) {}
          }
        }
        if (c.secondaryVideoElement && !activeVideosThisFrame.has(c.secondaryVideoElement)) {
          c.secondaryVideoElement.muted = true;
          if (!c.secondaryVideoElement.paused) {
            try { c.secondaryVideoElement.pause(); } catch (e) {}
          }
        }
      }
    }
    if (state.uploadedVideoElement && !activeVideosThisFrame.has(state.uploadedVideoElement)) {
      state.uploadedVideoElement.muted = true;
      if (!state.uploadedVideoElement.paused) {
        try { state.uploadedVideoElement.pause(); } catch (e) {}
      }
    }
  }
}

export function drawGuestWatermark(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number) {
  ctx.save();

  // 1. Subtle Center Watermark (Diagonal)
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 8); // -22.5 deg
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const centerFontSize = Math.max(14, Math.round(width * 0.042));
  ctx.font = `bold ${centerFontSize}px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.20)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText('CONTENTGEN PRO PREVIEW', 0, -centerFontSize * 0.65);
  ctx.font = `600 ${Math.max(10, Math.round(centerFontSize * 0.52))}px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillText('GUEST ACCOUNT • REGISTER TO REMOVE', 0, centerFontSize * 0.65);
  ctx.restore();

  // 2. High-Visibility Bottom Banner Pill
  const pillH = Math.max(24, Math.round(height * 0.08));
  const pillW = Math.min(width - 16, Math.max(200, Math.round(width * 0.72)));
  const pillX = (width - pillW) / 2;
  const pillY = height - pillH - Math.max(6, Math.round(height * 0.025));
  const pillRadius = Math.min(8, pillH / 2);

  // Background box with amber accent border
  ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
  ctx.lineWidth = Math.max(1, Math.round(width * 0.002));
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(pillX, pillY, pillW, pillH, pillRadius);
  } else {
    ctx.rect(pillX, pillY, pillW, pillH);
  }
  ctx.fill();
  ctx.stroke();

  // Watermark text inside bottom pill
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const primaryFontSize = Math.max(8, Math.round(pillH * 0.36));
  ctx.font = `bold ${primaryFontSize}px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = '#f59e0b'; // amber-500
  ctx.fillText('★ GUEST PREVIEW (320p QUALITY)', width / 2, pillY + pillH * 0.36);

  const secondaryFontSize = Math.max(7, Math.round(pillH * 0.25));
  ctx.font = `500 ${secondaryFontSize}px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillStyle = '#cbd5e1'; // slate-300
  ctx.fillText('Sign in / register to unlock 4K & remove watermark', width / 2, pillY + pillH * 0.72);

  ctx.restore();
}

export function drawExportOverlayLayer(
  time: number,
  cur: any,
  cvW: number,
  cvH: number,
  prog: number,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
  targetCanvas?: HTMLCanvasElement | OffscreenCanvas
) {
  const thVideo = getClipVideoDrawable(cur, 'talkingHead') || getClipVideoDrawable(cur, 'secondary') || cur.secondaryImage || (cur.videoElement && cur.image ? getClipVideoDrawable(cur, 'primary') : null) || state.uploadedVideoElement || null;
  const thMode = cur.talkingHeadMode || (thVideo ? (state.talkingHeadDefaultMode || 'none') : 'none');
  const activePipOverlayClip = timelineState.clips.find(c => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));

  // 1. Draw Talking Head Picture-in-Picture (PiP) Overlay if mode is PiP (only if NOT in pip_overlay mode)
  if (!activePipOverlayClip && thVideo && thMode && thMode.startsWith('pip')) {
    drawTalkingHeadPiP(ctx, thVideo, cur, cvW, cvH, time, targetCanvas);
  }

  // 2. Draw Documentary Picture-in-Picture / Corner Map Callout
  drawCornerCalloutOverlay(ctx, cur, cvW, cvH, prog);

  // 3. Draw Pop-Up B-Roll (Picture-in-Picture Callout) Overlays
  const activePipClips = timelineState.clips.filter(c => c.displayMode === 'pip_overlay' && time >= (c.startTime || 0) && time <= (c.endTime || 0));
  if (activePipOverlayClip && !activePipClips.includes(activePipOverlayClip)) {
    activePipClips.push(activePipOverlayClip);
  }
  for (const pipC of activePipClips) {
    drawPopUpBrollPipOverlay(ctx, pipC, cvW, cvH, time, targetCanvas);
  }

  // 4. Apply Post Effects (Vignette, Grain, Sparkles, Rain, Dust, Snow)
  applyPostEffects(ctx, cvW, cvH, time);

  // 5. Draw Anamorphic 2.39:1 Cinemascope Letterbox Matte Bars
  if (state.cinematicLetterbox) {
    const targetAR = 2.39;
    const currentAR = cvW / cvH;
    if (currentAR < targetAR) {
      const activeH = cvW / targetAR;
      const barH = Math.round((cvH - activeH) / 2);
      if (barH > 0) {
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cvW, barH);
        ctx.fillRect(0, cvH - barH, cvW, barH);
        ctx.restore();
      }
    }
  }

  // 6. Draw Subtitles
  const isAbs = timelineState.mode === 'audio_locked';
  const curStart = isNum(cur.startTime) ? cur.startTime : 0;
  const tIn = isAbs ? (time - curStart) : Math.max(0, prog * (cur.duration || 3));
  const isPlaceholderText = cur.text && /^(?:master\s+a-?roll|a-?roll)$/i.test(cur.text.trim());
  if (timelineState.showSubtitles && !timelineState.isTrackHidden('captions') && cur.text && !isPlaceholderText) {
      const hasTimestamps = cur.wordTimestamps != null && cur.wordTimestamps.length > 0;
      let wordIndex = -1;

      let subtitleText = cur.text;
      if (hasTimestamps) {
          wordIndex = findWordIndex(cur.wordTimestamps!, tIn);
          if (!(cur as any)._subtitleTextCache || (cur as any)._cachedTimestampsRef !== cur.wordTimestamps) {
              (cur as any)._subtitleTextCache = cur.wordTimestamps!.map((w: any) => w.word).join(' ');
              (cur as any)._cachedTimestampsRef = cur.wordTimestamps;
          }
          subtitleText = (cur as any)._subtitleTextCache;
      }
      
      SubtitleEngine.draw({
          ctx,
          text: subtitleText,
          progress: prog,
          width: cvW,
          height: cvH,
          style: timelineState.videoSubtitleStyle,
          colors: state.videoSubtitleColors,
          forcedWordIndex: wordIndex,
          hasTimestamps,
          position: timelineState.videoSubtitlePosition,
          clipTime: tIn,
          wordTimestamps: hasTimestamps ? cur.wordTimestamps! : null,
          isPlaying: state.isVideoPlaying
      });
  }

  // 7. Draw Motion Graphics (lower thirds, title cards)
  if (state.motionGraphicsEnabled && !timelineState.isTrackHidden('overlays')) {
      drawGraphics(ctx, time, cvW, cvH, timelineState.graphics);
  }

  // 8. Draw Guest Account Preview Watermark during guest exports
  if (state.isGuestExport || (state.isExporting && (state as any).isGuestExport)) {
    drawGuestWatermark(ctx, cvW, cvH);
  }
}
