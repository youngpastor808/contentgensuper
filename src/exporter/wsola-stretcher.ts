/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WSOLA Pitch-Preserving Time Stretcher & Soft-Clip Master Limiter.
 * Ported from video-studio/src/media/stretch.js and video-studio/src/media/dsp.js.
 */

import { getAudioContext } from '../utils';

/**
 * Linear-interpolated read of `count` samples from `src` at fractional `pos` by `step` (zero outside).
 */
export function readLinear(
  src: Float32Array,
  len: number,
  pos: number,
  step: number,
  count: number,
  out: Float32Array = new Float32Array(count)
): Float32Array {
  let p = pos;
  for (let i = 0; i < count; i++, p += step) {
    const k = Math.floor(p);
    if (k < 0 || k >= len) {
      out[i] = k === -1 && len > 0 ? src[0] * (p - k) : 0;
      continue;
    }
    const a = src[k];
    out[i] = k + 1 < len ? a + (src[k + 1] - a) * (p - k) : a;
  }
  return out;
}

/**
 * Gentle polynomial soft-clip limiter ported from video-studio/src/media/dsp.js (softClip).
 * Reaches 1.0 with zero slope at x = 3 so summed tracks never clip harshly at segment boundaries.
 */
export function softClipChannel(buf: Float32Array): Float32Array {
  const t = (x: number) => (x > 3 ? 1 : (x * (27 + x * x)) / (27 + 9 * x * x));
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    if (x > 0.9) buf[i] = 0.9 + 0.1 * t((x - 0.9) * 10);
    else if (x < -0.9) buf[i] = -0.9 - 0.1 * t((-x - 0.9) * 10);
  }
  return buf;
}

export function softClipAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    softClipChannel(buffer.getChannelData(c));
  }
  return buffer;
}

export interface WsolaOptions {
  grainMs?: number;
  searchMs?: number;
}

export class WsolaStretcher {
  public readonly N: number;
  public readonly hs: number;
  public readonly D: number;
  private win: Float64Array;
  private acc: [Float64Array, Float64Array];
  private accStart = 0;
  private nextG: number | null = null;
  private prevA: number | null = null;
  private expectG: number | null = null;
  private ref: Float32Array;
  private cand: Float32Array;
  private tmp: Float32Array;

  constructor(sampleRate: number, { grainMs = 40, searchMs = 12 }: WsolaOptions = {}) {
    this.N = Math.max(64, Math.round((grainMs * sampleRate) / 1000 / 2) * 2);
    this.hs = this.N / 2;
    this.D = Math.max(8, Math.round((searchMs * sampleRate) / 1000));
    this.win = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    }
    this.acc = [new Float64Array(this.N * 4), new Float64Array(this.N * 4)];
    this.ref = new Float32Array(this.hs);
    this.cand = new Float32Array(this.hs + 2 * this.D);
    this.tmp = new Float32Array(Math.max(this.N, this.hs + 2 * this.D));
  }

  get lookBehind(): number {
    return this.N + 2 * this.D + 4;
  }

  get lookAhead(): number {
    return 2 * this.N + 2 * this.D + 4;
  }

  generate(
    g: number,
    n: number,
    posAt: (outSampleIndex: number) => number,
    step: number,
    read: (ch: number, pos: number, step: number, count: number, out: Float32Array) => void,
    nch: number
  ): [Float32Array, Float32Array] {
    if (this.expectG !== g) this._restart(g);
    const end = g + n;
    while (this.nextG! < end) {
      this._grain(this.nextG!, posAt, step, read, nch);
      this.nextG! += this.hs;
    }
    const off = g - this.accStart;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = this.acc[0][off + i];
      R[i] = this.acc[1][off + i];
    }
    const keep = end - this.accStart;
    for (const a of this.acc) {
      a.copyWithin(0, keep);
      a.fill(0, a.length - keep);
    }
    this.accStart = end;
    this.expectG = end;
    return [L, R];
  }

  private _restart(g: number): void {
    this.nextG = g - this.hs;
    this.accStart = this.nextG;
    this.prevA = null;
    for (const a of this.acc) a.fill(0);
  }

  private _ensure(len: number): void {
    if (this.acc[0].length >= len) return;
    let size = this.acc[0].length;
    while (size < len) size *= 2;
    this.acc = this.acc.map((a) => {
      const b = new Float64Array(size);
      b.set(a);
      return b;
    }) as [Float64Array, Float64Array];
  }

  private _mono(
    read: (ch: number, pos: number, step: number, count: number, out: Float32Array) => void,
    nch: number,
    pos: number,
    step: number,
    count: number,
    out: Float32Array
  ): Float32Array {
    read(0, pos, step, count, out);
    if (nch > 1) {
      const t = this.tmp;
      read(1, pos, step, count, t);
      for (let i = 0; i < count; i++) out[i] += t[i];
    }
    return out;
  }

  private _grain(
    G: number,
    posAt: (outSampleIndex: number) => number,
    step: number,
    read: (ch: number, pos: number, step: number, count: number, out: Float32Array) => void,
    nch: number
  ): void {
    const { N, hs, D } = this;
    const ideal = posAt(G);
    let a = ideal;

    if (this.prevA !== null) {
      const natural = this.prevA + hs * step;
      if (Math.abs(natural - ideal) > 0.5 * step) {
        const ref = this._mono(read, nch, natural, step, hs, this.ref);
        const lo = ideal - D * step;
        const cand = this._mono(read, nch, lo, step, hs + 2 * D, this.cand);

        const score = (l: number, stride: number) => {
          let c = 0;
          let e = 0;
          for (let j = 0; j < hs; j += stride) {
            const v = cand[l + j];
            c += ref[j] * v;
            e += v * v;
          }
          return e > 1e-12 ? c / Math.sqrt(e) : 0;
        };

        let best = D;
        let bestS = score(D, 4);
        for (let l = 0; l <= 2 * D; l += 4) {
          const s = score(l, 4);
          if (s > bestS + 1e-9) {
            bestS = s;
            best = l;
          }
        }
        const c0 = best;
        bestS = score(c0, 1);
        for (let l = Math.max(0, c0 - 3); l <= Math.min(2 * D, c0 + 3); l++) {
          if (l === c0) continue;
          const s = score(l, 1);
          if (s > bestS + 1e-9) {
            bestS = s;
            best = l;
          }
        }
        a = lo + best * step;
      } else {
        a = natural;
      }
    }

    this.prevA = a;
    const off = G - this.accStart;
    this._ensure(off + N);
    const buf = this.tmp;
    for (let c = 0; c < 2; c++) {
      read(Math.min(c, nch - 1), a, step, N, buf);
      const acc = this.acc[c];
      for (let i = 0; i < N; i++) acc[off + i] += buf[i] * this.win[i];
    }
  }
}

export function stretchBufferChannels(
  channels: Float32Array[],
  sampleRate: number,
  speed: number
): Float32Array[] {
  const safeSpeed = Math.max(0.25, Math.min(4.0, Number(speed) || 1));
  if (Math.abs(safeSpeed - 1) < 1e-3 || channels.length === 0) return channels;
  const len = channels[0]?.length || 0;
  const outLen = Math.max(1, Math.round(len / safeSpeed));
  const st = new WsolaStretcher(sampleRate);
  const read = (ch: number, pos: number, step: number, count: number, out: Float32Array) =>
    readLinear(channels[ch], len, pos, step, count, out);
  const [L, R] = st.generate(0, outLen, (g) => g * safeSpeed, 1, read, channels.length);
  return channels.length > 1 ? [L, R] : [L];
}

export function stretchAudioBufferPreservePitch(
  buffer: AudioBuffer,
  playbackRate: number
): AudioBuffer {
  const safeRate = Math.max(0.25, Math.min(4.0, Number(playbackRate) || 1));
  if (Math.abs(safeRate - 1.0) < 1e-3) return buffer;

  const numChannels = Math.min(2, buffer.numberOfChannels);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  const stretched = stretchBufferChannels(channels, buffer.sampleRate, safeRate);
  const outFrames = stretched[0]?.length || 1;
  const audioCtx = getAudioContext();
  const outBuffer = audioCtx.createBuffer(numChannels, outFrames, buffer.sampleRate);
  for (let c = 0; c < numChannels; c++) {
    outBuffer.getChannelData(c).set(stretched[c]);
  }
  return outBuffer;
}
