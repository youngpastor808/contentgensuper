/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Depth estimation orchestrator with multi-tier fallback (Server AI -> Browser AI -> Procedural),
 * IndexedDB/Memory caching, and live preview upgrade notifications.
 */

import { buildDepthField, buildProceduralDepthField, guidedUpsample, normalizeDepth, type DepthField } from './depthProcessing';

const depthMemoryCache = new Map<any, DepthField>();
const inFlightRequests = new Map<string, Promise<DepthField>>();
const upgradeListeners = new Set<(key: any) => void>();

const objectIds = new WeakMap<object, string>();
let objectIdCounter = 0;
function objectId(img: any): string {
  if (!img) return 'unknown_image';
  if (typeof img !== 'object') return String(img);
  let id = objectIds.get(img);
  if (!id) { id = `obj_${++objectIdCounter}`; objectIds.set(img, id); }
  return id;
}

function isIDBSafeKey(key: string): boolean {
  if (!key || key === 'unknown_image' || key === 'transient_blob') return false;
  if (key.startsWith('blob:') || key.startsWith('obj_')) return false;
  return true;
}

const IDB_NAME = 'contentgen_parallax_depth_db';
const IDB_VERSION = 1;
const IDB_STORE = 'depth_cache';

let idbPromise: Promise<IDBDatabase> | null = null;

function getDepthIDB(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return idbPromise;
}

async function getDepthFromIDB(key: string): Promise<DepthField | null> {
  try {
    const db = await getDepthIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const item = req.result;
        if (!item || !item.data) {
          resolve(null);
          return;
        }
        const depth: DepthField = {
          data: new Uint8Array(item.data),
          width: item.width,
          height: item.height,
          source: item.source || 'model',
          focusDepth: item.focusDepth ?? 0.5,
          hazeColor: item.hazeColor
        };
        resolve(depth);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function saveDepthToIDB(key: string, depth: DepthField): Promise<void> {
  if (!isIDBSafeKey(key) || depth.source === 'procedural') return;
  try {
    const db = await getDepthIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.put({
      key,
      data: depth.data.buffer.slice(depth.data.byteOffset, depth.data.byteOffset + depth.data.byteLength),
      width: depth.width,
      height: depth.height,
      source: depth.source,
      focusDepth: depth.focusDepth,
      hazeColor: depth.hazeColor,
      updatedAt: Date.now()
    });
  } catch (e) {
    console.warn('[ParallaxDepth] IDB cache save failed:', e);
  }
}

/**
 * Aliases cached depth field from one image object reference to another
 * (e.g. from original raw image to downscaled export bitmap).
 */
export function aliasDepth(from: any, to: any): void {
  if (!from || !to || from === to) return;
  const d = depthMemoryCache.get(from);
  if (d) {
    depthMemoryCache.set(to, d);
  }
}

/**
 * Drops depth field from memory cache to prevent memory leaks after bitmap cleanup.
 */
export function dropDepth(img: any): void {
  if (!img) return;
  depthMemoryCache.delete(img);
}

export function getImageKey(img: any): string {
  if (typeof img === 'string') {
    return img;
  }
  if (img?.dataset?.assetId) return `asset_${img.dataset.assetId}`;
  if (img?._assetId) return `asset_${img._assetId}`;
  if (img?.id && !img.id.startsWith('__')) return `id_${img.id}`;
  if (img?.src && typeof img.src === 'string') {
    if (img.src.startsWith('blob:')) {
      return img.src;
    }
    if (!img.src.startsWith('data:') || img.src.length < 512) {
      return img.src;
    }
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    return `data_${w}x${h}_${img.src.slice(0, 128)}_${img.src.slice(-128)}`;
  }
  if (img?.currentSrc && typeof img.currentSrc === 'string') {
    return img.currentSrc;
  }
  return objectId(img);
}

function extractImagePixels(img: any, maxSide = 1024): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const w0 = img.naturalWidth || img.width || 0;
  const h0 = img.naturalHeight || img.height || 0;
  if (!w0 || !h0) return null;

  const s = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s));
  const h = Math.max(1, Math.round(h0 * s));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  return { data: imgData.data, width: w, height: h };
}

/**
 * Register listener for when a high-precision model depth replaces the fast heuristic.
 */
export function onDepthUpgraded(cb: (key: any) => void): () => void {
  upgradeListeners.add(cb);
  return () => { upgradeListeners.delete(cb); };
}

/**
 * Check if a real AI model depth map is already cached and available.
 */
export function hasModelDepth(img: any): boolean {
  const cached = depthMemoryCache.get(img);
  return cached ? (cached.source === 'model' || cached.source === 'browser') : false;
}

/**
 * Returns depth synchronously. If model depth is missing, returns fast procedural depth
 * immediately so UI/preview scrubbing never stutters.
 */
export function getDepthSync(img: any, focal?: { x: number; y: number }): DepthField {
  const cached = depthMemoryCache.get(img);
  if (cached) return cached;

  const pixels = extractImagePixels(img);
  const fallback = pixels
    ? buildProceduralDepthField(pixels, focal)
    : { data: new Uint8Array(64 * 64).fill(128), width: 64, height: 64, source: 'procedural' as const, focusDepth: 0.5 };

  depthMemoryCache.set(img, fallback);
  return fallback;
}

/**
 * Fetches depth from backend `/api/depth` endpoint.
 */
async function fetchServerDepth(blob: Blob, guideImg: { data: Uint8ClampedArray; width: number; height: number }): Promise<DepthField> {
  const res = await fetch('/api/depth', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  });

  if (!res.ok) {
    throw new Error(`Server depth estimation failed: ${res.status} ${res.statusText}`);
  }

  const pngBlob = await res.blob();
  const bitmap = await createImageBitmap(pngBlob);
  const w = bitmap.width;
  const h = bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2d context for depth bitmap');

  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);

  // Extract 1-channel grayscale
  const rawLow = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    rawLow[i] = imgData.data[i * 4];
  }

  // Refine and upsample against full-res RGB image
  const refined = guidedUpsample(rawLow, w, h, guideImg, guideImg.width, guideImg.height);
  return buildDepthField(refined, guideImg.width, guideImg.height, 'model', undefined, guideImg);
}

/**
 * Asynchronously ensures high-quality depth map is computed and cached.
 */
export async function ensureDepth(
  img: any,
  opts: { focal?: { x: number; y: number }; source?: string } = {}
): Promise<DepthField> {
  const cached = depthMemoryCache.get(img);
  if (cached && (cached.source === 'model' || opts.source === 'procedural')) {
    return cached;
  }

  const key = getImageKey(img);
  const flightKey = key;
  if (inFlightRequests.has(flightKey)) {
    return inFlightRequests.get(flightKey)!;
  }

  const promise = (async () => {
    try {
      // 1. Check IndexedDB persistent cache first
      if (opts.source !== 'procedural' && isIDBSafeKey(key)) {
        try {
          const persisted = await getDepthFromIDB(key);
          const iw = img.naturalWidth || img.width;
          const ih = img.naturalHeight || img.height;
          if (persisted && iw && ih && Math.abs(persisted.width / persisted.height - iw / ih) > 0.01) {
            // ignore stale persisted cache with mismatched aspect
          } else if (persisted) {
            depthMemoryCache.set(img, persisted);
            for (const cb of upgradeListeners) {
              try { cb(img); } catch (e) {}
            }
            return persisted;
          }
        } catch (idbErr) {
          console.warn('[ParallaxDepth] IDB read failed:', idbErr);
        }
      }

      const pixels = extractImagePixels(img);
      if (!pixels) {
        return getDepthSync(img, opts.focal);
      }

      if (opts.source === 'procedural') {
        const procedural = buildProceduralDepthField(pixels, opts.focal);
        depthMemoryCache.set(img, procedural);
        return procedural;
      }

      // Attempt Server Depth API
      try {
        // Convert image to blob
        let blob: Blob;
        if (typeof img?.src === 'string' && img.src.startsWith('blob:')) {
          blob = await (await fetch(img.src)).blob();
        } else {
          const offscreen = document.createElement('canvas');
          offscreen.width = pixels.width;
          offscreen.height = pixels.height;
          const ctx = offscreen.getContext('2d');
          if (ctx) {
            ctx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
            blob = await new Promise<Blob>((resolve) => offscreen.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.9));
          } else {
            throw new Error('Canvas context unavailable');
          }
        }

        const modelDepth = await fetchServerDepth(blob, pixels);
        depthMemoryCache.set(img, modelDepth);
        if (isIDBSafeKey(key)) {
          saveDepthToIDB(key, modelDepth).catch(() => {});
        }

        // Notify live preview to re-render with the final depth
        for (const cb of upgradeListeners) {
          try { cb(img); } catch (e) {}
        }

        return modelDepth;
      } catch (err) {
        // Fallback to fast procedural depth
        const fallback = buildProceduralDepthField(pixels, opts.focal);
        depthMemoryCache.set(img, fallback);
        return fallback;
      }
    } finally {
      inFlightRequests.delete(flightKey);
    }
  })();

  inFlightRequests.set(flightKey, promise);
  return promise;
}

/**
 * Precomputes depth for a batch of timeline clips prior to final export rendering.
 */
export async function prepareDepthForClips(
  clips: any[] | undefined,
  opts: { source?: string; onProgress?: (pct: number, msg: string) => void } = {}
): Promise<{ total: number; model: number; procedural: number }> {
  if (!clips || clips.length === 0) return { total: 0, model: 0, procedural: 0 };

  const stillClips = clips.filter((c) => (c.image || c.backgroundPlate || c.imageUrl) && !c.videoElement && !c.video_id && !c._videoObjectURL && !(c as any).videoUrl);
  const total = stillClips.length;
  let model = 0;
  let procedural = 0;
  let completed = 0;

  if (total === 0) return { total: 0, model: 0, procedural: 0 };

  // Process 2-3 images concurrently to significantly shorten pre-export depth analysis phase
  const concurrency = Math.min(3, total);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < total) {
      const idx = currentIndex++;
      const c = stillClips[idx];
      const img = c.backgroundPlate || c.image;
      if (img) {
        opts.onProgress?.(
          Math.round((completed / Math.max(1, total)) * 100),
          `Analyzing 2.5D depth map ${completed + 1}/${total}...`
        );
        const res = await ensureDepth(img, { focal: c.focalPoint, source: opts.source });
        if (res.source === 'model' || res.source === 'browser') {
          model++;
        } else {
          procedural++;
        }
      }
      completed++;
      opts.onProgress?.(
        Math.round((completed / Math.max(1, total)) * 100),
        `Analyzed 2.5D depth map ${completed}/${total}...`
      );
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  opts.onProgress?.(100, '2.5D depth maps analyzed.');
  return { total, model, procedural };
}

/**
 * Encodes DepthField to an 8-bit grayscale PNG data URL.
 */
export async function depthToPngDataUrl(depth: DepthField): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = depth.width;
  canvas.height = depth.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imgData = ctx.createImageData(depth.width, depth.height);
  const d = depth.data;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    const idx = i * 4;
    imgData.data[idx] = v;
    imgData.data[idx + 1] = v;
    imgData.data[idx + 2] = v;
    imgData.data[idx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}
