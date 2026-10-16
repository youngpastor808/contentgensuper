import { setAudioReactiveProvider, type AudioReactiveProvider } from '../../src/audio-reactive-provider';

interface Range {
  from: number;
  to: number;
  energy: string;
  spectrum: Record<string, string>;
}
export interface AudioReactiveWire {
  v: 1;
  fps: number;
  ranges: Range[];
}

function fromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4));
}

export function createAudioReactiveProvider(wire: AudioReactiveWire | null | undefined): AudioReactiveProvider | null {
  if (!wire || wire.v !== 1 || !Array.isArray(wire.ranges) || wire.ranges.length === 0) return null;
  const fps = wire.fps || 30;
  const decoded = wire.ranges
    .map((r) => ({
      from: r.from,
      to: r.to,
      energy: fromBase64(r.energy),
      spectrum: Object.fromEntries(
        Object.entries(r.spectrum || {}).map(([k, v]) => [k, fromBase64(v)])
      ) as Record<string, Float32Array>,
    }))
    .sort((a, b) => a.from - b.from);

  const find = (time: number) => {
    const frame = Math.round(time * fps);
    let lo = 0;
    let hi = decoded.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = decoded[mid];
      if (frame < r.from) {
        hi = mid - 1;
      } else if (frame > r.to) {
        lo = mid + 1;
      } else {
        return { r, i: frame - r.from };
      }
    }
    return null;
  };

  return {
    getSpectrum(bands, time) {
      const hit = find(time);
      const arr = hit?.r.spectrum[String(bands)];
      if (!hit || !arr) return null;
      const base = hit.i * bands;
      if (base + bands > arr.length) return null;
      return arr.subarray(base, base + bands);
    },
    getEnergy(time) {
      const hit = find(time);
      if (!hit) return null;
      const b = hit.i * 4;
      const e = hit.r.energy;
      return { rms: e[b], bass: e[b + 1], mid: e[b + 2], beatPulse: e[b + 3] };
    },
  };
}

let lastWire: unknown = undefined;

/** Idempotent: safe to call on every render. */
export function installAudioReactive(wire: AudioReactiveWire | null | undefined): void {
  if (wire === lastWire) return;
  lastWire = wire;
  setAudioReactiveProvider(createAudioReactiveProvider(wire));
}
