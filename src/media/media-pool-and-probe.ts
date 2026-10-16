/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integer microsecond time helpers, Mediabunny demuxer-first media probing,
 * and pooled HTMLMediaElement management with seek coalescing.
 * Ported from video-studio/src/lib/time.js, src/media/probe.js, and src/engine/media-pool.js.
 */

import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';

export const US = 1_000_000;

export const toSec = (usVal: number): number => usVal / US;
export const toUs = (seconds: number): number => Math.round(seconds * US);

export function frameUs(fps: number): number {
  return US / (fps || 30);
}

/** Snap a microsecond timestamp to the nearest frame boundary at `fps`. */
export function snapToFrameUs(tUs: number, fps = 30): number {
  const f = US / fps;
  return Math.round(Math.round(tUs / f) * f);
}

/** Snap a second timestamp to the nearest exact frame boundary via integer microseconds. */
export function snapSecondsToFrame(seconds: number, fps = 30): number {
  return toSec(snapToFrameUs(toUs(seconds), fps));
}

export function frameIndexAtUs(tUs: number, fps = 30): number {
  return Math.floor((tUs + 1) / (US / fps));
}

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** "HH:MM:SS:FF" broadcast timecode from microseconds. */
export function formatTimecodeUs(tUs: number, fps = 30): string {
  const roundedFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.max(0, Math.round((tUs / US) * roundedFps));
  const f = totalFrames % roundedFps;
  const s = Math.floor(totalFrames / roundedFps);
  return `${pad2(s / 3600)}:${pad2((s / 60) % 60)}:${pad2(s % 60)}:${pad2(f)}`;
}

export interface ProbedMediaInfo {
  kind: 'video' | 'audio' | 'image';
  width: number;
  height: number;
  durationSec: number;
  durationUs: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  decodable: boolean;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;

export function guessMediaKind(file: File | Blob, name = ''): 'video' | 'audio' | 'image' | null {
  const type = file.type || '';
  const fileName = name || (file as File).name || '';
  if (type.startsWith('image/') || IMAGE_EXT.test(fileName)) return 'image';
  if (type.startsWith('audio/') || AUDIO_EXT.test(fileName)) return 'audio';
  if (type.startsWith('video/') || VIDEO_EXT.test(fileName)) return 'video';
  return null;
}

async function probeWithDomElement(
  blob: Blob,
  kind: 'video' | 'audio'
): Promise<Omit<ProbedMediaInfo, 'kind' | 'decodable'>> {
  const url = URL.createObjectURL(blob);
  try {
    const el = document.createElement(kind);
    el.preload = 'metadata';
    el.muted = true;
    el.src = url;
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error('Unsupported media format.'));
    });
    let duration = el.duration;
    if (!Number.isFinite(duration)) {
      el.currentTime = 1e7;
      await new Promise<void>((r) => {
        el.ontimeupdate = () => r();
      });
      duration = el.duration;
    }
    const safeSec = Number.isFinite(duration) ? duration : 0;
    const vidEl = el as HTMLVideoElement;
    return {
      durationSec: safeSec,
      durationUs: Math.round(safeSec * US),
      width: vidEl.videoWidth || 0,
      height: vidEl.videoHeight || 0,
      fps: 30,
      hasAudio:
        kind === 'audio'
          ? true
          : Boolean((vidEl as any).mozHasAudio ?? (vidEl as any).webkitAudioDecodedByteCount !== 0),
      hasVideo: kind === 'video' ? Boolean(vidEl.videoWidth) : false,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function probeMediaBlob(blob: Blob, fileName = ''): Promise<ProbedMediaInfo> {
  const kind = guessMediaKind(blob, fileName) || 'video';
  if (kind === 'image') {
    if (typeof createImageBitmap === 'function' && !/svg/.test(blob.type)) {
      const bmp = await createImageBitmap(blob);
      const out = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      return {
        kind: 'image',
        width: out.width,
        height: out.height,
        durationSec: 0,
        durationUs: 0,
        fps: 0,
        hasAudio: false,
        hasVideo: false,
        decodable: true,
      };
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return {
        kind: 'image',
        width: img.naturalWidth || 1080,
        height: img.naturalHeight || 1080,
        durationSec: 0,
        durationUs: 0,
        fps: 0,
        hasAudio: false,
        hasVideo: false,
        decodable: true,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const [video, audio] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!video && !audio) throw new Error('No media tracks found');
    const durationSec = (await input.computeDuration()) || 0;
    let fps = 30;
    let width = 0;
    let height = 0;
    if (video) {
      [width, height] = await Promise.all([video.getDisplayWidth(), video.getDisplayHeight()]);
      try {
        const stats = await video.computePacketStats(60);
        if (stats?.averagePacketRate) {
          fps = Math.round(stats.averagePacketRate * 100) / 100;
        }
      } catch {}
    }
    const canVideo = video ? await video.canDecode().catch(() => false) : false;
    const canAudio = audio ? await audio.canDecode().catch(() => false) : false;

    if (video && !canVideo) {
      input.dispose();
      const domFacts = await probeWithDomElement(blob, 'video');
      return { kind: 'video', ...domFacts, decodable: false };
    }

    const realKind = video ? 'video' : 'audio';
    return {
      kind: realKind,
      width,
      height,
      durationSec,
      durationUs: Math.round(durationSec * US),
      fps,
      hasAudio: Boolean(audio) && canAudio,
      hasVideo: Boolean(video),
      decodable: true,
    };
  } catch {
    const fallbackKind = kind === 'audio' ? 'audio' : 'video';
    const domFacts = await probeWithDomElement(blob, fallbackKind);
    return { kind: fallbackKind, ...domFacts, decodable: false };
  } finally {
    if (!(input as any).disposed) input.dispose();
  }
}

export interface PooledMediaEntry {
  id: number;
  el: HTMLVideoElement | HTMLAudioElement;
  assetId: string;
  srcUrl: string;
  kind: 'video' | 'audio';
  clipId: string | null;
  claimed: boolean;
  lastUsed: number;
  pendingSeek: number | null;
  srcNode?: MediaElementAudioSourceNode;
  gain?: GainNode;
}

let nextPoolId = 1;

export class PreviewMediaPool {
  public elements: PooledMediaEntry[] = [];
  public audioCtx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  public analyser: AnalyserNode | null = null;
  private frame = 0;
  private onReady?: () => void;

  constructor({ onReady }: { onReady?: () => void } = {}) {
    this.onReady = onReady;
  }

  ensureAudio(): AudioContext | null {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return this.audioCtx;
    }
    const Ctx = globalThis.AudioContext || (globalThis as any).webkitAudioContext;
    if (!Ctx) return null;
    this.audioCtx = new Ctx({ latencyHint: 'interactive' });
    this.masterGain = this.audioCtx.createGain();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    for (const e of this.elements) this.routeAudio(e);
    return this.audioCtx;
  }

  private routeAudio(entry: PooledMediaEntry): void {
    if (!this.audioCtx || !this.masterGain || entry.gain) return;
    try {
      const srcNode = this.audioCtx.createMediaElementSource(entry.el);
      const gain = this.audioCtx.createGain();
      gain.gain.value = 0;
      srcNode.connect(gain).connect(this.masterGain);
      entry.srcNode = srcNode;
      entry.gain = gain;
      entry.el.muted = false;
    } catch {
      entry.el.muted = true;
    }
  }

  private createEntry(
    assetId: string,
    srcUrl: string,
    kind: 'video' | 'audio'
  ): PooledMediaEntry {
    const el = document.createElement(kind);
    el.preload = 'auto';
    (el as any).playsInline = true;
    if (srcUrl.startsWith('http://') || srcUrl.startsWith('https://')) {
      el.crossOrigin = 'anonymous';
    }
    el.muted = !this.audioCtx;
    if ('disablePictureInPicture' in el) {
      (el as HTMLVideoElement).disablePictureInPicture = true;
    }
    if ('preservesPitch' in el) {
      (el as any).preservesPitch = true;
    }

    const entry: PooledMediaEntry = {
      id: nextPoolId++,
      el,
      assetId,
      srcUrl,
      kind,
      clipId: null,
      claimed: false,
      lastUsed: this.frame,
      pendingSeek: null,
    };

    const kick = () => this.onReady?.();
    el.addEventListener('loadeddata', kick);
    el.addEventListener('seeked', () => {
      if (entry.pendingSeek !== null) {
        const target = entry.pendingSeek;
        entry.pendingSeek = null;
        if (Math.abs(el.currentTime - target) > 0.001) {
          el.currentTime = target;
          return;
        }
      }
      kick();
    });

    el.src = srcUrl;
    this.routeAudio(entry);
    this.elements.push(entry);
    return entry;
  }

  beginFrame(): void {
    this.frame++;
    for (const e of this.elements) e.claimed = false;
  }

  claim(
    clipId: string,
    assetId: string,
    srcUrl: string,
    kind: 'video' | 'audio',
    sourceSec: number
  ): PooledMediaEntry {
    let best = this.elements.find(
      (e) =>
        e.clipId === clipId &&
        !e.claimed &&
        e.kind === kind &&
        e.assetId === assetId &&
        e.srcUrl === srcUrl
    );
    if (!best) {
      let bestDist = Infinity;
      for (const e of this.elements) {
        if (e.claimed || e.assetId !== assetId || e.srcUrl !== srcUrl || e.kind !== kind) continue;
        if (e.clipId && e.lastUsed === this.frame) continue;
        const d = Math.abs(e.el.currentTime - sourceSec);
        if (d < bestDist) {
          best = e;
          bestDist = d;
        }
      }
    }
    if (!best) {
      best = this.createEntry(assetId, srcUrl, kind);
    }
    best.claimed = true;
    best.clipId = clipId;
    best.lastUsed = this.frame;
    return best;
  }

  seek(entry: PooledMediaEntry, sec: number): void {
    const el = entry.el;
    const clamped = Math.max(0, sec);
    if (el.seeking) {
      entry.pendingSeek = clamped;
      return;
    }
    if (Math.abs(el.currentTime - clamped) > 0.015) {
      el.currentTime = clamped;
    }
  }

  endFrame(): void {
    for (const e of this.elements) {
      if (e.claimed) continue;
      if (!e.el.paused) e.el.pause();
      if (e.gain) e.gain.gain.value = 0;
    }
    if (this.frame % 300 === 0 && this.elements.length > 12) {
      const idle = this.elements.filter((e) => !e.claimed && this.frame - e.lastUsed > 600);
      for (const e of idle) this.destroyEntry(e);
    }
  }

  private destroyEntry(entry: PooledMediaEntry): void {
    entry.el.pause();
    entry.el.removeAttribute('src');
    entry.el.load();
    try {
      entry.gain?.disconnect();
    } catch {}
    this.elements = this.elements.filter((x) => x !== entry);
  }

  pauseAll(): void {
    for (const e of this.elements) {
      if (!e.el.paused) e.el.pause();
      if (e.gain) e.gain.gain.value = 0;
    }
  }

  dispose(): void {
    for (const e of [...this.elements]) this.destroyEntry(e);
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}
