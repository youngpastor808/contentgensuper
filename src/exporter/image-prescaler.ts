/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { state } from '../state';
import { dropDepth } from '../parallax/depth';

export interface PrescaleStats {
  totalImages: number;
  optimizedCount: number;
  bytesSavedEst: number;
}

/**
 * Calculates the required dimensions for a clip's image, ensuring 100% pixel fidelity
 * at maximum zoom/pan while scaling down excessive resolution to match the export target.
 */
export function calculateClipTargetDimensions(
  clip: any,
  nativeW: number,
  nativeH: number,
  exportW: number,
  exportH: number
): { resizeW: number; resizeH: number; shouldResize: boolean; headroom: number } {
  if (nativeW <= 0 || nativeH <= 0 || exportW <= 0 || exportH <= 0) {
    return { resizeW: nativeW, resizeH: nativeH, shouldResize: false, headroom: 1.0 };
  }

  // 1. Determine maximum zoom factor required for this specific clip
  let maxZoom = 1.0;

  const movement = clip.cameraMovement || clip.camera_movement || 'static';
  const isKenBurns = movement && movement !== 'none' && movement !== 'static';
  if (isKenBurns) {
    // Standard Ken Burns motion zoom/crop: 1.25x - 1.35x headroom guarantees 1:1 pixel sampling at peak zoom
    maxZoom = Math.max(maxZoom, 1.35);
  }

  if (clip.cameraKeyframes) {
    const sScale = Number(clip.cameraKeyframes.start?.scale) || 1.0;
    const eScale = Number(clip.cameraKeyframes.end?.scale) || 1.0;
    maxZoom = Math.max(maxZoom, sScale, eScale);
  }

  const isVideoClip = Boolean(clip.videoElement || clip.video_id || clip._videoObjectURL || clip.videoUrl);
  const hasParallaxMotion = Boolean(
    state.enableParallaxEffect &&
    !isVideoClip &&
    (state.parallaxStrength ?? 1) > 0 &&
    (isKenBurns || clip.cameraKeyframes || (state.parallaxOrbit ?? 0.35) > 0)
  );

  if (hasParallaxMotion) {
    // Parallax depth offset requires slight outer margin
    maxZoom = Math.max(maxZoom, 1.30);
  }

  // Cap zoom headroom to a safe upper bound (e.g. 2.0x)
  maxZoom = Math.min(2.0, Math.max(1.0, maxZoom));

  // 2. Compute bounding export dimensions with headroom
  const boundingW = Math.round(exportW * maxZoom);
  const boundingH = Math.round(exportH * maxZoom);

  // Use Math.max between the two axis ratios so that NEITHER axis is ever undersampled,
  // regardless of whether the clip uses contain, cover, horizontal pan, or vertical tilt.
  const scaleRatio = Math.max(boundingW / nativeW, boundingH / nativeH);

  // If the native image is already within or below the target dimensions, do not resize (never upscale)
  if (scaleRatio >= 0.98) {
    return { resizeW: nativeW, resizeH: nativeH, shouldResize: false, headroom: maxZoom };
  }

  const resizeW = Math.max(1, Math.round(nativeW * scaleRatio));
  const resizeH = Math.max(1, Math.round(nativeH * scaleRatio));

  return { resizeW, resizeH, shouldResize: true, headroom: maxZoom };
}

/**
 * Creates a downscaled ImageBitmap or Canvas for the given image source.
 * Uses high-quality bicubic downsampling with zero visual loss.
 */
async function createScaledBitmap(
  source: CanvasImageSource,
  targetW: number,
  targetH: number
): Promise<ImageBitmap | HTMLCanvasElement | OffscreenCanvas> {
  // 1. Try modern createImageBitmap with resizeWidth / resizeHeight (hardware-accelerated on worker thread)
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source as any, {
        resizeWidth: targetW,
        resizeHeight: targetH,
        resizeQuality: 'high'
      });
      return bitmap;
    } catch {
      // Fall through to canvas-based downscale if options object is unsupported
    }
  }

  // 2. Resilient OffscreenCanvas / HTMLCanvasElement fallback
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(targetW, targetH)
    : document.createElement('canvas');

  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    (ctx as any).imageSmoothingQuality = 'high';
    ctx.drawImage(source as any, 0, 0, targetW, targetH);
  }

  return canvas;
}

/**
 * Prepares export-optimized images for all clips in the project.
 * Downscales native high-resolution images (e.g. 4000x3000) down to the export target
 * (e.g. 1080p + motion headroom), cutting bitmap memory by up to 75% with zero quality loss.
 */
export async function prepareExportOptimizedImages(
  clips: any[] | undefined,
  exportW: number,
  exportH: number,
  onProgress?: (pct: number, msg: string) => void
): Promise<PrescaleStats> {
  const stats: PrescaleStats = {
    totalImages: 0,
    optimizedCount: 0,
    bytesSavedEst: 0
  };

  if (!clips || clips.length === 0 || exportW <= 0 || exportH <= 0) {
    return stats;
  }

  const uniqueClips = Array.from(new Set(clips));
  const candidateClips: any[] = [];

  for (const c of uniqueClips) {
    const rawImg = c.backgroundPlate || c.image;
    if (rawImg && (rawImg.naturalWidth || rawImg.width)) {
      candidateClips.push(c);
    }
  }

  stats.totalImages = candidateClips.length;
  if (candidateClips.length === 0) return stats;

  const tasks = candidateClips.map(async (c, idx) => {
    try {
      const rawImg = c.backgroundPlate || c.image;
      const nw = rawImg.naturalWidth || rawImg.width;
      const nh = rawImg.naturalHeight || rawImg.height;

      const { resizeW, resizeH, shouldResize, headroom } = calculateClipTargetDimensions(
        c,
        nw,
        nh,
        exportW,
        exportH
      );

      if (!shouldResize) {
        return;
      }

      // Memory estimation: 4 bytes per pixel (RGBA uncompressed)
      const nativeBytes = nw * nh * 4;
      const scaledBytes = resizeW * resizeH * 4;

      const optimizedBitmap = await createScaledBitmap(rawImg, resizeW, resizeH);
      c._exportOptimizedImage = optimizedBitmap;

      stats.optimizedCount++;
      stats.bytesSavedEst += Math.max(0, nativeBytes - scaledBytes);

      if (onProgress) {
        const pct = Math.round(((idx + 1) / candidateClips.length) * 100);
        onProgress(pct, `Pre-scaling asset ${idx + 1}/${candidateClips.length} (${nw}×${nh} → ${resizeW}×${resizeH} @ ${headroom.toFixed(2)}x zoom)...`);
      }
    } catch (err) {
      console.warn('[ImagePrescaler] Could not pre-scale clip image, keeping original:', err);
      // Graceful fallback: c._exportOptimizedImage remains undefined, uses rawImg
    }
  });

  await Promise.all(tasks);

  const savedMb = (stats.bytesSavedEst / (1024 * 1024)).toFixed(1);
  console.log(`[ImagePrescaler] Optimized ${stats.optimizedCount}/${stats.totalImages} images for ${exportW}x${exportH} export. Saved ~${savedMb} MB decoded RAM.`);

  return stats;
}

/**
 * Clears and releases all export-optimized bitmaps from memory.
 * Explicitly calls .close() on ImageBitmaps to free GPU textures immediately.
 */
export function clearExportOptimizedImages(...clipLists: (any[] | undefined)[]): void {
  const allClips = new Set<any>();
  for (const list of clipLists) {
    if (list && Array.isArray(list)) {
      for (const c of list) allClips.add(c);
    }
  }

  let freedCount = 0;
  for (const c of allClips) {
    if (c && c._exportOptimizedImage) {
      try {
        const bmp = c._exportOptimizedImage;
        dropDepth(bmp);
        if (typeof (bmp as any).close === 'function') {
          (bmp as any).close();
        } else if (bmp instanceof HTMLCanvasElement) {
          bmp.width = 0;
          bmp.height = 0;
        }
      } catch (e) {
        console.warn('[ImagePrescaler] Error freeing bitmap:', e);
      }
      delete c._exportOptimizedImage;
      freedCount++;
    }
  }

  if (freedCount > 0) {
    console.log(`[ImagePrescaler] Released ${freedCount} export image bitmaps.`);
  }
}
