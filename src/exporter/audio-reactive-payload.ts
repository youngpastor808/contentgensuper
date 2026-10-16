/**
 * Browser side of cloud-render audio-reactive parity.
 *
 * Remotion Lambda has no AudioBuffers, so spectrum bars and audio-reactive HyperFrames would fall back
 * to their "no audio" animation. This builds a compact per-frame table using the SAME functions the local
 * export uses (computeSpectrumBands / HyperFramesEngine.getAudioEnergyAtTime) and ships it in the payload.
 * Only frames where a reactive overlay is active are included.
 *
 * Wire format (JSON-safe):
 *   {
 *     v: 1, fps,
 *     ranges: [{ from, to, energy: <b64 Float32 x4/frame>, spectrum: { "32": <b64 Float32 xN/frame> } }]
 *   }
 * Float32 is lossless for the spectrum (the browser computes it in a Float32Array) and accurate to ~1e-7
 * for the energy sample, so cloud frames are bit-identical for spectrum bars. (Uint16 quantisation was tried
 * first and flips 1px bar edges at rounding boundaries.)
 */
import { computeSpectrumBands } from '../graphics-engine';
import { HyperFramesEngine } from '../hyperframes-engine';
import { timelineState } from '../state-timeline';
import { state } from '../state';

export interface AudioReactiveRange {
  from: number;
  to: number;
  energy: string;
  spectrum: Record<string, string>;
}
export interface AudioReactivePayload {
  v: 1;
  fps: number;
  ranges: AudioReactiveRange[];
}

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

function toBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

const q = (v: number) => (Number.isFinite(v) ? v : 0);

export function isReactiveGraphic(g: any): boolean {
  if (!g) return false;
  if (g.type === 'spectrum') return true;
  return g.type === 'hyperFrame' && Boolean(g.audioReactive || g.musicReactiveGlow);
}

export function mergeFrameRanges(raw: Array<[number, number]>): Array<[number, number]> {
  const sorted = raw.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * @returns null when no reactive overlay exists or no audio is loaded (the cloud then uses the same
 *          "no audio" fallback animation the browser would use).
 */
export function buildAudioReactivePayload(
  graphics: any[] | undefined,
  fps: number,
  totalFrames: number
): AudioReactivePayload | null {
  const reactive = (graphics || []).filter(isReactiveGraphic);
  if (reactive.length === 0) return null;

  // HyperFrames energy reads BOTH buffers; the spectrum reads only the master buffer.
  const hasMaster = Boolean(timelineState.masterAudioBuffer);
  const hasBg = Boolean((state as any)._bgAudioBuffer);
  // No audio at all: the cloud engines then run the same built-in fallbacks as the browser
  // (sine spectrum / 120 BPM synthetic pulse), so there is nothing to ship.
  if (!hasMaster && !hasBg) return null;

  const bandCounts = new Set<number>();
  for (const g of reactive) {
    if (g.type === 'spectrum') bandCounts.add(Math.max(8, Math.min(64, g.barCount || 32)));
  }

  const frameRanges = mergeFrameRanges(
    reactive.map((g) => {
      const from = Math.max(0, Math.floor((Number(g.start) || 0) * fps) - 1);
      const to = Math.min(totalFrames - 1, Math.ceil((Number(g.end) || 0) * fps) + 1);
      return [from, to] as [number, number];
    })
  );

  const ranges: AudioReactiveRange[] = [];
  let bytes = 0;
  for (const [from, to] of frameRanges) {
    const n = to - from + 1;
    const energy = new Float32Array(n * 4);
    const spectrum: Record<number, Float32Array> = {};
    bandCounts.forEach((b) => (spectrum[b] = new Float32Array(n * b)));

    for (let i = 0; i < n; i++) {
      const t = (from + i) / fps;
      const e = HyperFramesEngine.getAudioEnergyAtTime(t);
      energy[i * 4] = q(e.rms);
      energy[i * 4 + 1] = q(e.bass);
      energy[i * 4 + 2] = q(e.mid);
      energy[i * 4 + 3] = q(e.beatPulse);
      bandCounts.forEach((b) => {
        const arr = hasMaster ? computeSpectrumBands(timelineState.masterAudioBuffer, t, b) : null;
        if (arr) for (let k = 0; k < b; k++) spectrum[b][i * b + k] = q(arr[k]);
      });
    }

    const spectrumB64: Record<string, string> = {};
    if (hasMaster) {
      bandCounts.forEach((b) => (spectrumB64[String(b)] = toBase64(spectrum[b])));
    }
    const range: AudioReactiveRange = { from, to, energy: toBase64(energy), spectrum: spectrumB64 };
    bytes += range.energy.length + Object.values(spectrumB64).reduce((s, v) => s + v.length, 0);
    ranges.push(range);
  }

  if (bytes > MAX_PAYLOAD_BYTES) {
    console.warn(`[Cloud Render] Audio-reactive data is ${(bytes / 1048576).toFixed(1)} MB (> 8 MB); skipping. Spectrum/pulse overlays will use their no-audio animation.`);
    return null;
  }
  console.log(`[Cloud Render] Audio-reactive data: ${ranges.length} range(s), ${(bytes / 1024).toFixed(0)} KB`);
  return { v: 1, fps, ranges };
}
