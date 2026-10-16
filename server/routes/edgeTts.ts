/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edge-TTS Neural Speech API
 * Provides access to 300+ free Microsoft Edge neural voices across 40+ languages
 * with concurrency semaphore, sentence chunking, LRU byte caching, and Kokoro presets.
 */

import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { KOKORO_VOICE_MAP, KOKORO_VOICES_CATALOG, POPULAR_EDGE_VOICES, fetchLiveEdgeVoices } from '../edgeTTS';

const router = express.Router();

const MAX_TEXT_CHARS = 120000; // Allows up to ~2 hours of continuous speech (18,000+ words)
const PIECE_CHARS = 2000;
const SYNTH_TIMEOUT_MS = 45000;
const MAX_CONCURRENT = 4;
const VOICE_RE = /^[A-Za-z0-9_-]+$/;

// ---------- Concurrency Semaphore (Protects against Microsoft Rate Limiting) ----------
let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((r) => waiters.push(r));
  active++;
}

function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

// ---------- In-Memory Audio Byte Cache (64MB Cap) ----------
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;

function cacheGet(k: string): Buffer | undefined {
  const v = cache.get(k);
  if (v) {
    cache.delete(k);
    cache.set(k, v);
  }
  return v;
}

function cacheSet(k: string, v: Buffer): void {
  if (v.length > CACHE_MAX_BYTES / 4) return;
  cache.set(k, v);
  cacheBytes += v.length;
  while (cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)!.length;
    cache.delete(oldest);
  }
}

// ---------- Formatting & Chunking Helpers ----------
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function splitText(text: string, maxLen: number): string[] {
  const sentences = text.split(/(?<=[.!?。！？…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const pieces: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) pieces.push(cur.trim());
    cur = '';
  };
  for (const s of sentences) {
    if (s.length > maxLen) {
      push();
      let rest = s;
      while (rest.length > maxLen) {
        let cut = rest.lastIndexOf(' ', maxLen);
        if (cut <= 0) cut = maxLen;
        pieces.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      cur = rest;
      continue;
    }
    if ((cur + ' ' + s).length > maxLen) push();
    cur = cur ? `${cur} ${s}` : s;
  }
  push();
  return pieces.length > 0 ? pieces : [text.trim()];
}

function toRate(rate: unknown): string {
  if (typeof rate === 'string' && rate.endsWith('%')) return rate;
  const n = Number(rate);
  if (!isFinite(n) || n <= 0) return '+0%';
  const pct = Math.max(-50, Math.min(100, Math.round((n - 1) * 100)));
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function toPitch(pitch: unknown): string {
  if (typeof pitch === 'string' && (pitch.endsWith('Hz') || pitch.endsWith('st'))) return pitch;
  const n = Number(pitch);
  if (!isFinite(n) || n === 0) return '+0Hz';
  const hz = Math.max(-50, Math.min(50, Math.round(n)));
  return `${hz >= 0 ? '+' : ''}${hz}Hz`;
}

function toVolume(volume: unknown): string {
  if (typeof volume === 'string' && volume.endsWith('%')) return volume;
  const n = Number(volume);
  if (!isFinite(n)) return '+0%';
  const pct = Math.max(-50, Math.min(50, Math.round(n)));
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

async function synthPiece(text: string, voice: string, rate: string, pitch: string, volume: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text), { rate, pitch, volume });
    const chunks: Buffer[] = [];
    const work = (async () => {
      for await (const c of audioStream) chunks.push(Buffer.from(c));
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('Edge TTS stream timed out')), SYNTH_TIMEOUT_MS);
    });

    try {
      await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const out = Buffer.concat(chunks);
    if (out.length === 0) throw new Error('Edge TTS returned no audio data');
    return out;
  } finally {
    try { tts.close(); } catch {}
  }
}

async function synthWithRetry(text: string, voice: string, rate: string, pitch: string, volume: string): Promise<Buffer> {
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await synthPiece(text, voice, rate, pitch, volume);
    } catch (e: any) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// ---------- Dynamic 300+ Voices Cache ----------
export interface EdgeVoiceOut {
  shortName: string;
  displayName: string;
  locale: string;
  gender: string;
  isPopular?: boolean;
}

let voicesCache: { at: number; voices: EdgeVoiceOut[] } | null = null;
const VOICES_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function loadLiveEdgeVoices(): Promise<EdgeVoiceOut[]> {
  if (voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS && voicesCache.voices.length > 0) {
    return voicesCache.voices;
  }

  let rawVoices: any[] = [];
  const tts = new MsEdgeTTS();
  try {
    rawVoices = await tts.getVoices();
  } catch (err: any) {
    console.warn('[EdgeTTS] msedge-tts getVoices failed, trying direct Bing Speech API fallback...');
  } finally {
    try { tts.close(); } catch {}
  }

  if (!rawVoices || rawVoices.length === 0) {
    try {
      rawVoices = await fetchLiveEdgeVoices();
    } catch (e: any) {
      console.warn('[EdgeTTS] fetchLiveEdgeVoices fallback warning:', e?.message || e);
    }
  }

  if (Array.isArray(rawVoices) && rawVoices.length > 0) {
    const voices = rawVoices
      .filter((v: any) => v?.ShortName)
      .map((v: any) => {
        const short = String(v.ShortName);
        const friendly = String(v.FriendlyName || short)
          .replace(/^Microsoft\s+/i, '')
          .replace(/\s+Online\s+\(Natural\)\s*-\s*.*$/i, '');
        return {
          shortName: short,
          displayName: friendly,
          locale: String(v.Locale || short.split('-').slice(0, 2).join('-')),
          gender: String(v.Gender || 'Female'),
          isPopular: short.includes('Ava') || short.includes('Brian') || short.includes('Aria') || short.includes('Guy') || short.includes('Jenny') || short.includes('Andrew') || short.includes('Emma') || short.includes('Ryan') || short.includes('Sonia')
        };
      });

    if (voices.length > 0) {
      voicesCache = { at: Date.now(), voices };
      console.log(`[EdgeTTS] Cached ${voices.length} live neural voices from Microsoft Edge.`);
      return voices;
    }
  }

  if (voicesCache?.voices && voicesCache.voices.length > 0) {
    return voicesCache.voices;
  }

  // Fallback to static popular catalog
  const fallbackVoices: EdgeVoiceOut[] = POPULAR_EDGE_VOICES.map((v) => ({
    shortName: v.shortName,
    displayName: v.displayName,
    locale: v.locale,
    gender: v.gender,
    isPopular: v.isPopular
  }));

  voicesCache = { at: Date.now(), voices: fallbackVoices };
  return fallbackVoices;
}

// ---------- Routes ----------

/**
 * GET /api/edge-tts/voices and /api/tts/voices
 * Returns all 300+ Microsoft Edge neural voices + Kokoro personas.
 */
router.get(['/voices', '/'], async (_req: Request, res: Response) => {
  try {
    const voices = await loadLiveEdgeVoices();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({
      status: 'success',
      totalCount: voices.length + KOKORO_VOICES_CATALOG.length,
      edgeCount: voices.length,
      kokoroCount: KOKORO_VOICES_CATALOG.length,
      voices,
      kokoroVoices: KOKORO_VOICES_CATALOG
    });
  } catch (e: any) {
    console.warn('[EdgeTTS] Voice listing warning:', e?.message || e);
    return res.json({
      status: 'fallback',
      voices: voicesCache?.voices || [],
      kokoroVoices: KOKORO_VOICES_CATALOG
    });
  }
});

/**
 * POST /api/edge-tts/generate and /api/tts/generate
 */
router.post(['/generate', '/generate-long'], async (req: Request, res: Response) => {
  const body = req.body || {};
  const text = body.text;
  const voice = body.voice;
  const rate = body.rate ?? body.options?.rate;
  const pitch = body.pitch ?? body.options?.pitch;
  const volume = body.volume ?? body.options?.volume;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ error: `text exceeds ${MAX_TEXT_CHARS} characters` });
  }

  const rawVoice = typeof voice === 'string' ? voice.replace(/^(msedge_|edge_|localkokoro_|kokoro_)/, '') : 'en-US-AriaNeural';
  const targetVoice = KOKORO_VOICE_MAP[rawVoice] || rawVoice;

  const r = toRate(rate);
  const p = toPitch(pitch);
  const v = toVolume(volume);
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').trim();
  const key = crypto.createHash('sha1').update(`${targetVoice}|${r}|${p}|${v}|${clean}`).digest('hex');

  const hit = cacheGet(key);
  if (hit) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="speech.mp3"');
    res.setHeader('X-Cache-Hit', 'true');
    return res.send(hit);
  }

  await acquire();
  try {
    const pieces = splitText(clean, PIECE_CHARS);
    const parts: Buffer[] = [];
    for (const piece of pieces) {
      parts.push(await synthWithRetry(piece, targetVoice, r, p, v));
    }
    const audio = Buffer.concat(parts);
    cacheSet(key, audio);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="speech.mp3"');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(audio);
  } catch (e: any) {
    console.error('[EdgeTTS] Synthesis failed:', e?.message || e);
    return res.status(502).json({
      error: 'Edge TTS synthesis failed',
      details: e?.message || 'unknown error'
    });
  } finally {
    release();
  }
});

/**
 * POST /api/edge-tts/preview and /api/tts/preview
 */
router.post('/preview', async (req: Request, res: Response) => {
  const { voice = 'en-US-AvaNeural', text, rate, pitch, volume } = req.body || {};
  const rawVoice = typeof voice === 'string' ? voice.replace(/^(msedge_|edge_|localkokoro_|kokoro_)/, '') : 'en-US-AvaNeural';
  const targetVoice = KOKORO_VOICE_MAP[rawVoice] || rawVoice;
  const sample = text || 'This is a live preview of this neural voice from Edge TTS.';

  const r = toRate(rate);
  const p = toPitch(pitch);
  const v = toVolume(volume);

  await acquire();
  try {
    const audio = await synthWithRetry(sample, targetVoice, r, p, v);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'inline; filename="preview.mp3"');
    return res.send(audio);
  } catch (e: any) {
    console.error('[EdgeTTS] Preview failed:', e?.message || e);
    return res.status(502).json({ error: 'Preview failed', details: e?.message || 'unknown' });
  } finally {
    release();
  }
});

export default router;
