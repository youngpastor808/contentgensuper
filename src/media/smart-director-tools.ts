/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client-Side Smart Editing & Director Tools:
 * 1. Auto-Reframe (attentionCenter, smoothPath -> CameraKeyframesConfig)
 * 2. Shot-Change & Silence Detection (detectScenesInVideoBlob, findSilentRangesInAudioBuffer)
 * 3. Deflicker Exposure Stabilization (steadyLevel, computeDeflickerMultipliers)
 * 4. Smart Subtitle Keyword Selection & Remapping (pickKeywords, remapMarks)
 *
 * Ported from video-studio/src/media/reframe.js, smart-edit.js, flicker.js, and model/text-marks.js.
 */

import { Input, BlobSource, ALL_FORMATS, CanvasSink } from 'mediabunny';
import type { CameraKeyframesConfig } from '../../remotion/src/types';

export const RF_W = 48;
export const RF_H = 27;

export interface AttentionPoint {
  t: number; // seconds
  x: number; // normalized 0..1
  y: number; // normalized 0..1
}

export function attentionCenter(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  prevLuma: Float32Array | null = null
): { x: number; y: number; luma: Float32Array } {
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  }

  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + w] - luma[i - w];
      const edge = Math.sqrt(gx * gx + gy * gy);
      const r = rgba[i * 4] / 255;
      const g = rgba[i * 4 + 1] / 255;
      const b = rgba[i * 4 + 2] / 255;
      const mx = Math.max(r, g, b);
      const sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
      const skin =
        r > 0.35 && r > g && g > b && sat > 0.15 && sat < 0.65 && r - b > 0.12 ? 1 : 0;
      const motion = prevLuma ? Math.abs(luma[i] - prevLuma[i]) : 0;
      const cx = x / (w - 1) - 0.5;
      const cy = y / (h - 1) - 0.5;
      const center = Math.exp(-(cx * cx + cy * cy) * 3);
      const wgt = (edge * 2 + sat * 0.25 + skin * 0.8 + motion * 4) * (0.35 + 0.65 * center);
      sx += x * wgt;
      sy += y * wgt;
      sw += wgt;
    }
  }
  if (sw < 1e-6) return { x: 0.5, y: 0.5, luma };
  return { x: sx / sw / (w - 1), y: sy / sw / (h - 1), luma };
}

export function smoothAttentionPath(
  points: AttentionPoint[],
  { follow = 0.35, deadZone = 0.04 } = {}
): AttentionPoint[] {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const pass = (list: AttentionPoint[]) => {
    const out: AttentionPoint[] = [];
    let cx = list[0].x;
    let cy = list[0].y;
    for (const p of list) {
      if (Math.abs(p.x - cx) > deadZone) cx += (p.x - cx) * follow;
      if (Math.abs(p.y - cy) > deadZone) cy += (p.y - cy) * follow;
      out.push({ t: p.t, x: cx, y: cy });
    }
    return out;
  };
  const fwd = pass(points);
  const back = pass([...points].reverse()).reverse();
  return fwd.map((p, i) => ({
    t: p.t,
    x: (p.x + back[i].x) / 2,
    y: (p.y + back[i].y) / 2,
  }));
}

export function coverScaleForAspect(srcAR: number, dstAR: number, zoom = 1): number {
  return Math.max(srcAR / dstAR, dstAR / srcAR) * zoom;
}

export async function autoReframeVideoToKeyframes(
  blob: Blob,
  fromSec = 0,
  toSec = 5,
  targetAspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' = '9:16',
  options: { fps?: number; signal?: AbortSignal; onProgress?: (p: number) => void } = {}
): Promise<{ keyframes: CameraKeyframesConfig; path: AttentionPoint[] }> {
  const sampleFps = options.fps ?? 2;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      throw new Error('This video cannot be decoded for Auto-Reframe.');
    }
    const [srcW, srcH] = await Promise.all([track.getDisplayWidth(), track.getDisplayHeight()]);
    const srcAR = (srcW || 16) / (srcH || 9);
    const dstARMap: Record<string, number> = {
      '16:9': 16 / 9,
      '9:16': 9 / 16,
      '1:1': 1,
      '4:3': 4 / 3,
      '3:4': 3 / 4,
    };
    const dstAR = dstARMap[targetAspectRatio] || 9 / 16;

    const sink = new CanvasSink(track, { width: RF_W, height: RF_H, fit: 'fill', poolSize: 1 });
    const scratch =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(RF_W, RF_H)
        : Object.assign(document.createElement('canvas'), { width: RF_W, height: RF_H });
    const g = scratch.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;

    const times: number[] = [];
    for (let t = Math.max(0, fromSec); t < Math.max(fromSec + 0.1, toSec); t += 1 / sampleFps) {
      times.push(t);
    }
    if (!times.length) times.push(Math.max(0, fromSec));

    const rawPoints: AttentionPoint[] = [];
    let prevLuma: Float32Array | null = null;
    let i = 0;

    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (options.signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      if (wrapped) {
        g.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, RF_W, RF_H);
        const c = attentionCenter(
          g.getImageData(0, 0, RF_W, RF_H).data,
          RF_W,
          RF_H,
          prevLuma
        );
        prevLuma = c.luma;
        rawPoints.push({ t: times[i], x: c.x, y: c.y });
      }
      i++;
      options.onProgress?.(i / times.length);
    }

    const smoothed = smoothAttentionPath(rawPoints);
    const first = smoothed[0] || { t: fromSec, x: 0.5, y: 0.5 };
    const last = smoothed[smoothed.length - 1] || first;
    const recommendedScale = Math.min(1.65, Math.max(1.04, coverScaleForAspect(srcAR, dstAR, 1.02)));

    return {
      keyframes: {
        start: {
          x: Number(first.x.toFixed(3)),
          y: Number(first.y.toFixed(3)),
          scale: Number(recommendedScale.toFixed(2)),
          rotation: 0,
        },
        end: {
          x: Number(last.x.toFixed(3)),
          y: Number(last.y.toFixed(3)),
          scale: Number((recommendedScale * 1.04).toFixed(2)),
          rotation: 0,
        },
        easing: 'easeInOut',
      },
      path: smoothed,
    };
  } finally {
    input.dispose();
  }
}

export const SIG_W = 16;
export const SIG_H = 9;
const HUE_BINS = 12;

export function frameSignature(rgba: Uint8ClampedArray): Float32Array {
  const n = SIG_W * SIG_H;
  const sig = new Float32Array(n + HUE_BINS);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    sig[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    if (d > 0.08) {
      let hue =
        mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      if (hue < 0) hue += 6;
      sig[n + Math.min(HUE_BINS - 1, Math.floor((hue / 6) * HUE_BINS))] += d / n;
    }
  }
  return sig;
}

export function signatureDistance(a: Float32Array, b: Float32Array): number {
  const n = SIG_W * SIG_H;
  let luma = 0;
  for (let i = 0; i < n; i++) luma += Math.abs(a[i] - b[i]);
  let hue = 0;
  for (let i = n; i < a.length; i++) hue += Math.abs(a[i] - b[i]);
  return (luma / n) * 2.2 + hue * 1.2;
}

export function sceneCuts(
  distances: number[],
  { sensitivity = 0.5, minGap = 4, window = 12 } = {}
): number[] {
  const floor = 0.32 - 0.22 * sensitivity;
  const k = 4.5 - 3 * sensitivity;
  const cuts: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i];
    if (d < floor) continue;
    const near: number[] = [];
    for (
      let j = Math.max(0, i - window);
      j <= Math.min(distances.length - 1, i + window);
      j++
    ) {
      if (j !== i) near.push(distances[j]);
    }
    near.sort((x, y) => x - y);
    const median = near.length ? near[near.length >> 1] : 0;
    const dev = near.map((x) => Math.abs(x - median)).sort((x, y) => x - y);
    const mad = dev.length ? dev[dev.length >> 1] * 1.4826 : 0;
    if (d > median + k * Math.max(mad, 0.02) && i + 1 - last >= minGap) {
      cuts.push(i + 1);
      last = i + 1;
    }
  }
  return cuts;
}

export async function detectScenesInVideoBlob(
  blob: Blob,
  fromSec: number,
  toSec: number,
  {
    fps = 5,
    sensitivity = 0.5,
    signal,
    onProgress,
  }: { fps?: number; sensitivity?: number; signal?: AbortSignal; onProgress?: (p: number) => void } = {}
): Promise<number[]> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      throw new Error('This video cannot be decoded for scene detection.');
    }
    const sink = new CanvasSink(track, { width: SIG_W, height: SIG_H, fit: 'fill', poolSize: 1 });
    const scratch =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(SIG_W, SIG_H)
        : Object.assign(document.createElement('canvas'), { width: SIG_W, height: SIG_H });
    const g = scratch.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;

    const times: number[] = [];
    for (let t = fromSec; t < toSec; t += 1 / fps) times.push(t);
    const sigs: Array<{ t: number; sig: Float32Array }> = [];
    let i = 0;

    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
      if (wrapped) {
        g.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, SIG_W, SIG_H);
        sigs.push({
          t: times[i],
          sig: frameSignature(g.getImageData(0, 0, SIG_W, SIG_H).data),
        });
      }
      i++;
      if (i % 10 === 0) onProgress?.(i / times.length);
    }

    const dist: number[] = [];
    for (let j = 1; j < sigs.length; j++) {
      dist.push(signatureDistance(sigs[j - 1].sig, sigs[j].sig));
    }
    return sceneCuts(dist, {
      sensitivity,
      minGap: Math.max(2, Math.round(fps * 0.6)),
    }).map((j) => sigs[j].t);
  } finally {
    input.dispose();
  }
}

export function findSilentRangesInAudioBuffer(
  buffer: AudioBuffer,
  { hopSec = 0.02, thresholdDb = -38, minSilence = 0.6, pad = 0.12 } = {}
): Array<{ start: number; end: number }> {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const hop = Math.max(1, Math.round(sr * hopSec));
  const numHops = Math.floor(ch0.length / hop);
  const levels = new Float32Array(numHops);

  for (let h = 0; h < numHops; h++) {
    let sumSq = 0;
    const base = h * hop;
    for (let i = 0; i < hop; i++) {
      const s = ch1 ? 0.5 * (ch0[base + i] + ch1[base + i]) : ch0[base + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / hop);
    levels[h] = rms > 1e-6 ? 20 * Math.log10(rms) : -100;
  }

  const out: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= levels.length; i++) {
    const quiet = i < levels.length && levels[i] < thresholdDb;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      const a = start * hopSec;
      const b = i * hopSec;
      if (b - a >= minSilence && b - a - 2 * pad > 0.05) {
        out.push({ start: a + pad, end: b - pad });
      }
      start = -1;
    }
  }
  return out;
}

const medianNum = (arr: number[]): number => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function cutPointsInLogLuma(logs: number[], { k = 3, threshold = 0.3 } = {}): number[] {
  const cuts: number[] = [];
  let run: [number, number] | null = null;
  const close = () => {
    if (!run) return;
    let best = run[0];
    for (let i = run[0]; i <= run[1]; i++) {
      if (Math.abs(logs[i] - logs[i - 1]) > Math.abs(logs[best] - logs[best - 1])) best = i;
    }
    cuts.push(best);
    run = null;
  };
  for (let i = k; i <= logs.length - k; i++) {
    const d = Math.abs(medianNum(logs.slice(i, i + k)) - medianNum(logs.slice(i - k, i)));
    if (d > threshold) run = run ? [run[0], i] : [i, i];
    else close();
  }
  close();
  return cuts;
}

function lineAt(values: number[], lo: number, hi: number, i: number): number {
  const n = hi - lo;
  let sx = 0;
  let sy = 0;
  for (let j = lo; j < hi; j++) {
    sx += j;
    sy += values[j];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let j = lo; j < hi; j++) {
    sxy += (j - mx) * (values[j] - my);
    sxx += (j - mx) * (j - mx);
  }
  return sxx > 0 ? my + (sxy / sxx) * (i - mx) : my;
}

export function steadyLevel(values: number[], radius = 6): number[] {
  const logs = values.map((v) => Math.log2(Math.max(1e-4, v)));
  const r = Math.max(1, radius);
  const edges = [0, ...cutPointsInLogLuma(logs, { k: Math.max(2, Math.min(4, r)) }), logs.length];
  const out = new Array<number>(logs.length);
  for (let s = 0; s < edges.length - 1; s++) {
    const a = edges[s];
    const b = edges[s + 1];
    for (let i = a; i < b; i++) {
      out[i] = 2 ** lineAt(logs, Math.max(a, i - r), Math.min(b, i + r + 1), i);
    }
  }
  return out;
}

export function computeDeflickerMultipliers(
  lumas: number[],
  { radius = 6, minLuma = 0.03, maxGainDelta = 0.35 } = {}
): number[] {
  const level = steadyLevel(lumas, radius);
  return lumas.map((l, i) => {
    if (l < minLuma || level[i] < minLuma) return 1.0;
    const ratio = level[i] / l;
    return Math.min(1 + maxGainDelta, Math.max(1 - maxGainDelta, ratio));
  });
}

export function wordsOfText(text: string): string[] {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean);
}

const FILLER_WORDS = new Set(
  "a an the and or but so if then than that this these those there here to of in on at by for with from up down out over into onto about as is am are was were be been being do does did have has had i me my mine you your yours he him his she her hers it its we us our they them their what which who whom whose when where why how not no yes just really very like um uh oh okay ok well also too can could would should will shall may might must get got going gonna wanna let lets let's think know thing things something stuff kind sort actually basically literally right yeah mean im i'm you're it's that's don't can't won't".split(
    ' '
  )
);

export const bareWord = (w: string): string =>
  w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');

export function pickKeywords(text: string, max: number | null = null): number[] {
  const words = wordsOfText(text);
  const n = max ?? Math.max(1, Math.round(words.length / 5));
  const scored = words
    .map((w, i) => {
      const b = bareWord(w);
      if (!b || FILLER_WORDS.has(b)) return null;
      const num = /\d/.test(b) ? 4 : 0;
      const cap = /^\p{Lu}/u.test(w) && i > 0 ? 2 : 0;
      return { i, score: b.length + num + cap };
    })
    .filter((x): x is { i: number; score: number } => Boolean(x && x.score >= 4))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  return scored
    .slice(0, n)
    .map((x) => x.i)
    .sort((a, b) => a - b);
}

export function remapMarks(marks: number[] | undefined, before: string, after: string): number[] {
  if (!marks?.length) return [];
  const oldWords = wordsOfText(before);
  const newWords = wordsOfText(after);
  if (oldWords.length === newWords.length) {
    return marks.filter((i) => i < newWords.length);
  }
  const bare = newWords.map(bareWord);
  const used = new Set<number>();
  const out: number[] = [];
  for (const i of marks) {
    const w = bareWord(oldWords[i] || '');
    if (!w) continue;
    let best = -1;
    for (let j = 0; j < bare.length; j++) {
      if (bare[j] === w && !used.has(j) && (best < 0 || Math.abs(j - i) < Math.abs(best - i))) {
        best = j;
      }
    }
    if (best >= 0) {
      used.add(best);
      out.push(best);
    }
  }
  return out.sort((a, b) => a - b);
}
