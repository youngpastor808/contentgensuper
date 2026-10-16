/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Depth map processing, joint-bilateral/guided upsampling, morphological operators,
 * and deterministic procedural depth generation.
 */

export interface DepthField {
  data: Uint8Array;
  width: number;
  height: number;
  source: 'model' | 'browser' | 'procedural';
  focusDepth: number; // 0..1 normalized focus plane
  hazeColor?: [number, number, number];
}

/**
 * Normalizes raw floating or integer depth arrays into standard 8-bit [0..255] grayscale.
 * 255 = NEAR (foreground), 0 = FAR (background).
 */
export function normalizeDepth(raw: ArrayLike<number>): Uint8Array {
  const len = raw.length;
  const out = new Uint8Array(len);
  if (len === 0) return out;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min;
  if (range <= 1e-6) {
    out.fill(128);
    return out;
  }

  const scale = 255 / range;
  for (let i = 0; i < len; i++) {
    out[i] = Math.min(255, Math.max(0, Math.round((raw[i] - min) * scale)));
  }
  return out;
}

/**
 * Guided / Joint-Bilateral filter upsampling: snaps a lower-resolution depth map
 * to the crisp high-frequency color/luminance edges of the source RGB guide image.
 */
export function guidedUpsample(
  lowDepth: Uint8Array,
  lowW: number,
  lowH: number,
  guideImg: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  outW: number,
  outH: number
): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const guideData = guideImg.data;
  const gw = guideImg.width;
  const gh = guideImg.height;

  // Pre-calculate luminance of guide if sizes match, or compute on the fly
  const scaleX = lowW / outW;
  const scaleY = lowH / outH;
  const guideScaleX = gw / outW;
  const guideScaleY = gh / outH;

  const radius = 2;
  const spatialSigmaSq = 2.0 * (1.5 * 1.5);
  const rangeSigmaSq = 2.0 * (32.0 * 32.0);

  for (let y = 0; y < outH; y++) {
    const srcY = y * scaleY;
    const lowYBase = Math.floor(srcY);
    const guideY = Math.min(gh - 1, Math.floor(y * guideScaleY));

    for (let x = 0; x < outW; x++) {
      const srcX = x * scaleX;
      const lowXBase = Math.floor(srcX);
      const guideX = Math.min(gw - 1, Math.floor(x * guideScaleX));

      const guideIdx = (guideY * gw + guideX) * 4;
      const rG = guideData[guideIdx];
      const gG = guideData[guideIdx + 1];
      const bG = guideData[guideIdx + 2];
      const lumG = 0.299 * rG + 0.587 * gG + 0.114 * bG;

      let sumWeight = 0;
      let sumVal = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        const ny = Math.min(lowH - 1, Math.max(0, lowYBase + dy));
        const sampleGuideY = Math.min(gh - 1, Math.max(0, Math.floor((ny / scaleY) * guideScaleY)));

        for (let dx = -radius; dx <= radius; dx++) {
          const nx = Math.min(lowW - 1, Math.max(0, lowXBase + dx));
          const sampleGuideX = Math.min(gw - 1, Math.max(0, Math.floor((nx / scaleX) * guideScaleX)));

          const sGuideIdx = (sampleGuideY * gw + sampleGuideX) * 4;
          const sR = guideData[sGuideIdx];
          const sG = guideData[sGuideIdx + 1];
          const sB = guideData[sGuideIdx + 2];
          const sLum = 0.299 * sR + 0.587 * sG + 0.114 * sB;

          const distSq = (nx - srcX) * (nx - srcX) + (ny - srcY) * (ny - srcY);
          const lumDiff = lumG - sLum;
          const lumDiffSq = lumDiff * lumDiff;

          const weight = Math.exp(-distSq / spatialSigmaSq - lumDiffSq / rangeSigmaSq);
          const depthVal = lowDepth[ny * lowW + nx];

          sumVal += depthVal * weight;
          sumWeight += weight;
        }
      }

      out[y * outW + x] = sumWeight > 0 ? Math.min(255, Math.max(0, Math.round(sumVal / sumWeight))) : lowDepth[Math.min(lowH - 1, Math.max(0, lowYBase)) * lowW + Math.min(lowW - 1, Math.max(0, lowXBase))];
    }
  }

  return out;
}

/**
 * Morphological dilation on depth values (grows nearer/brighter regions).
 * Prevents foreground color bleeding when disoccluding backgrounds.
 */
export function dilateNear(
  depth: Uint8Array,
  width: number,
  height: number,
  radius: number = 1
): Uint8Array {
  const out = new Uint8Array(width * height);
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = depth[y * width + x];
      for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const val = depth[ny * width + nx];
          if (val > maxVal) maxVal = val;
        }
      }
      out[y * width + x] = maxVal;
    }
  }
  return out;
}

/**
 * Extracts average ambient background/sky color for realistic atmospheric haze tinting.
 */
export function extractAtmosphericHazeColor(
  img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
): [number, number, number] {
  const { data, width, height } = img;
  if (!width || !height || !data || data.length < 4) return [0.75, 0.8, 0.88];

  // Sample upper 25% (sky / horizon region)
  const topRows = Math.max(1, Math.floor(height * 0.25));
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const step = 4; // Sample every 4th pixel for speed

  for (let y = 0; y < topRows; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;
    }
  }

  if (count === 0) return [0.75, 0.8, 0.88];
  return [
    Math.min(1.0, Math.max(0.2, (rSum / count) / 255.0)),
    Math.min(1.0, Math.max(0.2, (gSum / count) / 255.0)),
    Math.min(1.0, Math.max(0.2, (bSum / count) / 255.0)),
  ];
}

/**
 * Fast procedural depth heuristic: combines vertical perspective gradient,
 * center/focal radial saliency, and luminance falloff.
 */
export function buildProceduralDepthField(
  img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  focalPoint?: { x: number; y: number }
): DepthField {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  const fx = focalPoint?.x ?? 0.5;
  const fy = focalPoint?.y ?? 0.55;

  for (let y = 0; y < height; y++) {
    const ny = y / Math.max(1, height - 1); // 0 (top/sky) -> 1 (bottom/ground)
    for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1);
      const dx = (nx - fx);
      const dy = (ny - fy);
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Radial subject focus (nearer near focal point)
      const radial = Math.max(0, 1.0 - dist * 1.5);

      // Ground plane gradient: bottom is near (255), top is far (0)
      const ground = Math.pow(ny, 1.3);

      // Edge falloff & brightness cue
      const idx = (y * width + x) * 4;
      const lum = data && data.length >= idx + 3 ? (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255 : 0.5;

      const combined = (ground * 0.45 + radial * 0.45 + lum * 0.1);
      out[y * width + x] = Math.min(255, Math.max(0, Math.round(combined * 255)));
    }
  }

  const hazeColor = extractAtmosphericHazeColor(img);

  return {
    data: out,
    width,
    height,
    source: 'procedural',
    focusDepth: 0.65,
    hazeColor,
  };
}

/**
 * Constructs a standardized DepthField object with estimated focus plane depth.
 */
export function buildDepthField(
  data: Uint8Array,
  width: number,
  height: number,
  source: 'model' | 'browser' | 'procedural',
  focalPoint?: { x: number; y: number },
  rgbImg?: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
): DepthField {
  const fx = focalPoint?.x ?? 0.5;
  const fy = focalPoint?.y ?? 0.5;

  const sampleX = Math.min(width - 1, Math.max(0, Math.floor(fx * width)));
  const sampleY = Math.min(height - 1, Math.max(0, Math.floor(fy * height)));
  
  // Sample small 5x5 region around focal point to determine focus depth
  let sum = 0, count = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const sy = Math.min(height - 1, Math.max(0, sampleY + dy));
    for (let dx = -2; dx <= 2; dx++) {
      const sx = Math.min(width - 1, Math.max(0, sampleX + dx));
      sum += data[sy * width + sx];
      count++;
    }
  }

  const focusDepth = count > 0 ? (sum / count) / 255.0 : data[sampleY * width + sampleX] / 255.0;
  const hazeColor: [number, number, number] = rgbImg ? extractAtmosphericHazeColor(rgbImg) : [0.75, 0.8, 0.88];

  return {
    data,
    width,
    height,
    source,
    focusDepth: Math.min(0.95, Math.max(0.15, focusDepth)),
    hazeColor,
  };
}
