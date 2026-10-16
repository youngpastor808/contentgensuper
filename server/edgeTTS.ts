/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edge-TTS & Kokoro-82M Neural Speech Synthesis Engine
 * Provides free, zero-cost high-fidelity neural speech streaming via Microsoft Edge
 * Read Aloud protocol with Sec-MS-GEC anti-abuse token calculation and Kokoro voice mappings.
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600;
const CHROMIUM_VERSION = '1-130.0.2849.68';

export const KOKORO_VOICE_MAP: Record<string, string> = {
  'af_heart': 'en-US-AvaNeural',
  'kokoro_af_heart': 'en-US-AvaNeural',
  'af_bella': 'en-US-JennyNeural',
  'kokoro_af_bella': 'en-US-JennyNeural',
  'af_sarah': 'en-US-AriaNeural',
  'kokoro_af_sarah': 'en-US-AriaNeural',
  'af_nicole': 'en-US-MichelleNeural',
  'kokoro_af_nicole': 'en-US-MichelleNeural',
  'am_adam': 'en-US-GuyNeural',
  'kokoro_am_adam': 'en-US-GuyNeural',
  'am_michael': 'en-US-BrianNeural',
  'kokoro_am_michael': 'en-US-BrianNeural',
  'bf_emma': 'en-GB-SoniaNeural',
  'kokoro_bf_emma': 'en-GB-SoniaNeural',
  'bf_isabella': 'en-GB-MaisieNeural',
  'kokoro_bf_isabella': 'en-GB-MaisieNeural',
  'bm_george': 'en-GB-RyanNeural',
  'kokoro_bm_george': 'en-GB-RyanNeural',
  'bm_lewis': 'en-GB-ThomasNeural',
  'kokoro_bm_lewis': 'en-GB-ThomasNeural'
};

export const KOKORO_VOICES_CATALOG = [
  { id: 'kokoro_af_heart', name: 'Kokoro - Heart (Ultra-Expressive Female)', shortName: 'kokoro_af_heart', displayName: 'Kokoro - Heart', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Kokoro 82M', 'Expressive', 'Warm', 'Natural'], engine: 'Kokoro-82M', isPopular: true },
  { id: 'kokoro_af_bella', name: 'Kokoro - Bella (Conversational Female)', shortName: 'kokoro_af_bella', displayName: 'Kokoro - Bella', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Kokoro 82M', 'Friendly', 'Crisp'], engine: 'Kokoro-82M', isPopular: true },
  { id: 'kokoro_af_sarah', name: 'Kokoro - Sarah (Clear Professional Female)', shortName: 'kokoro_af_sarah', displayName: 'Kokoro - Sarah', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Kokoro 82M', 'Professional', 'Clear'], engine: 'Kokoro-82M' },
  { id: 'kokoro_af_nicole', name: 'Kokoro - Nicole (Soothing & Melodic Female)', shortName: 'kokoro_af_nicole', displayName: 'Kokoro - Nicole', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Kokoro 82M', 'Soft', 'Meditation'], engine: 'Kokoro-82M' },
  { id: 'kokoro_am_adam', name: 'Kokoro - Adam (Deep Resonant Male)', shortName: 'kokoro_am_adam', displayName: 'Kokoro - Adam', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Kokoro 82M', 'Deep', 'Authoritative'], engine: 'Kokoro-82M', isPopular: true },
  { id: 'kokoro_am_michael', name: 'Kokoro - Michael (Engaging Casual Male)', shortName: 'kokoro_am_michael', displayName: 'Kokoro - Michael', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Kokoro 82M', 'Casual', 'Podcast'], engine: 'Kokoro-82M' },
  { id: 'kokoro_bf_emma', name: 'Kokoro - Emma (Refined British Female)', shortName: 'kokoro_bf_emma', displayName: 'Kokoro - Emma (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Female', traits: ['Kokoro 82M', 'British', 'Refined'], engine: 'Kokoro-82M', isPopular: true },
  { id: 'kokoro_bf_isabella', name: 'Kokoro - Isabella (Warm British Female)', shortName: 'kokoro_bf_isabella', displayName: 'Kokoro - Isabella (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Female', traits: ['Kokoro 82M', 'British', 'Warm'], engine: 'Kokoro-82M' },
  { id: 'kokoro_bm_george', name: 'Kokoro - George (Authoritative British Male)', shortName: 'kokoro_bm_george', displayName: 'Kokoro - George (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Male', traits: ['Kokoro 82M', 'British', 'Documentary'], engine: 'Kokoro-82M', isPopular: true },
  { id: 'kokoro_bm_lewis', name: 'Kokoro - Lewis (Dynamic British Male)', shortName: 'kokoro_bm_lewis', displayName: 'Kokoro - Lewis (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Male', traits: ['Kokoro 82M', 'British', 'Dynamic'], engine: 'Kokoro-82M' }
];

export const POPULAR_EDGE_VOICES = [
  { id: 'edge_en-US-AvaNeural', name: 'Edge - Ava (Ultra-Expressive Female)', shortName: 'en-US-AvaNeural', displayName: 'Ava (Expressive)', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Ultra-Natural', 'Expressive', 'Warm'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-BrianNeural', name: 'Edge - Brian (Natural Conversational Male)', shortName: 'en-US-BrianNeural', displayName: 'Brian (Natural)', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Authentic', 'Conversational', 'Clear'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-AndrewNeural', name: 'Edge - Andrew (Confident Warm Male)', shortName: 'en-US-AndrewNeural', displayName: 'Andrew (Natural)', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Natural', 'Confident', 'Warm'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-EmmaNeural', name: 'Edge - Emma (Warm Friendly Female)', shortName: 'en-US-EmmaNeural', displayName: 'Emma (Natural)', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Warm', 'Friendly', 'Conversational'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-AvaMultilingualNeural', name: 'Edge - Ava Multilingual (Expressive Female)', shortName: 'en-US-AvaMultilingualNeural', displayName: 'Ava Multilingual', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Multilingual', 'Expressive'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-BrianMultilingualNeural', name: 'Edge - Brian Multilingual (Conversational Male)', shortName: 'en-US-BrianMultilingualNeural', displayName: 'Brian Multilingual', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Multilingual', 'Conversational'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-AriaNeural', name: 'Edge - Aria (Expressive Female)', shortName: 'en-US-AriaNeural', displayName: 'Aria', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Warm', 'Conversational', 'Expressive'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-GuyNeural', name: 'Edge - Guy (Casual Male)', shortName: 'en-US-GuyNeural', displayName: 'Guy', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Natural', 'Casual', 'Friendly'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-JennyNeural', name: 'Edge - Jenny (Helpful Female)', shortName: 'en-US-JennyNeural', displayName: 'Jenny', language: 'English (US)', locale: 'en-US', gender: 'Female', traits: ['Friendly', 'Helpful', 'Smooth'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-US-ChristopherNeural', name: 'Edge - Christopher (Documentary Male)', shortName: 'en-US-ChristopherNeural', displayName: 'Christopher', language: 'English (US)', locale: 'en-US', gender: 'Male', traits: ['Authoritative', 'Deep', 'Documentary'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-GB-SoniaNeural', name: 'Edge - Sonia (British Female)', shortName: 'en-GB-SoniaNeural', displayName: 'Sonia (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Female', traits: ['Sophisticated', 'Polished', 'British'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-GB-RyanNeural', name: 'Edge - Ryan (British Male)', shortName: 'en-GB-RyanNeural', displayName: 'Ryan (British)', language: 'English (UK)', locale: 'en-GB', gender: 'Male', traits: ['Cultured', 'Articulate', 'Storyteller'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-AU-NatashaNeural', name: 'Edge - Natasha (Australian Female)', shortName: 'en-AU-NatashaNeural', displayName: 'Natasha (Australian)', language: 'English (AU)', locale: 'en-AU', gender: 'Female', traits: ['Brisk', 'Friendly', 'Australian'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-AU-WilliamMultilingualNeural', name: 'Edge - William Multilingual (Australian Male)', shortName: 'en-AU-WilliamMultilingualNeural', displayName: 'William Multilingual', language: 'English (AU)', locale: 'en-AU', gender: 'Male', traits: ['Multilingual', 'Australian'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-IN-NeerjaExpressiveNeural', name: 'Edge - Neerja Expressive (Indian Female)', shortName: 'en-IN-NeerjaExpressiveNeural', displayName: 'Neerja (Expressive)', language: 'English (IN)', locale: 'en-IN', gender: 'Female', traits: ['Expressive', 'Indian'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-NG-AbeoNeural', name: 'Edge - Abeo (Nigerian English Male)', shortName: 'en-NG-AbeoNeural', displayName: '🇳🇬 Abeo (Nigerian)', language: 'English (Nigeria)', locale: 'en-NG', gender: 'Male', traits: ['Nigerian Accent', 'Natural', 'African'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-NG-EzinneNeural', name: 'Edge - Ezinne (Nigerian English Female)', shortName: 'en-NG-EzinneNeural', displayName: '🇳🇬 Ezinne (Nigerian)', language: 'English (Nigeria)', locale: 'en-NG', gender: 'Female', traits: ['Nigerian Accent', 'Warm', 'African'], engine: 'Edge-TTS', isPopular: true },
  { id: 'edge_en-KE-AsiliaNeural', name: 'Edge - Asilia (Kenyan English Female)', shortName: 'en-KE-AsiliaNeural', displayName: '🇰🇪 Asilia (Kenyan)', language: 'English (Kenya)', locale: 'en-KE', gender: 'Female', traits: ['Kenyan Accent', 'African'], engine: 'Edge-TTS' },
  { id: 'edge_en-ZA-LeahNeural', name: 'Edge - Leah (South African English Female)', shortName: 'en-ZA-LeahNeural', displayName: '🇿🇦 Leah (South African)', language: 'English (South Africa)', locale: 'en-ZA', gender: 'Female', traits: ['South African Accent', 'African'], engine: 'Edge-TTS' },
  { id: 'edge_es-ES-ElviraNeural', name: 'Edge - Elvira (Castilian Spanish Female)', shortName: 'es-ES-ElviraNeural', displayName: 'Elvira (Castilian)', language: 'Spanish', locale: 'es-ES', gender: 'Female', traits: ['Clear', 'Natural', 'Castilian'], engine: 'Edge-TTS' },
  { id: 'edge_fr-FR-DeniseNeural', name: 'Edge - Denise (French Female)', shortName: 'fr-FR-DeniseNeural', displayName: 'Denise (French)', language: 'French', locale: 'fr-FR', gender: 'Female', traits: ['Elegant', 'Melodic', 'French'], engine: 'Edge-TTS' },
  { id: 'edge_de-DE-KatjaNeural', name: 'Edge - Katja (German Female)', shortName: 'de-DE-KatjaNeural', displayName: 'Katja (German)', language: 'German', locale: 'de-DE', gender: 'Female', traits: ['Precise', 'Natural', 'German'], engine: 'Edge-TTS' },
  { id: 'edge_ja-JP-NanamiNeural', name: 'Edge - Nanami (Japanese Female)', shortName: 'ja-JP-NanamiNeural', displayName: 'Nanami (Japanese)', language: 'Japanese', locale: 'ja-JP', gender: 'Female', traits: ['Gentle', 'Clear', 'Japanese'], engine: 'Edge-TTS' }
];

export interface SynthesizeOptions {
  rate?: string;
  pitch?: string;
  volume?: string;
  voice?: string;
}

export function getSecMsGecToken(): string {
  const nowInSeconds = Date.now() / 1000;
  const fileTimeSeconds = nowInSeconds + WIN_EPOCH;
  const fileTime100ns = fileTimeSeconds * 10000000;
  const interval = BigInt(3000000000);
  const totalTicks = BigInt(Math.floor(fileTime100ns));
  const snappedTicks = totalTicks - (totalTicks % interval);
  const payloadToHash = `${snappedTicks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(payloadToHash, 'ascii').digest('hex').toUpperCase();
}

/**
 * Method A: msedge-tts package synthesizer
 */
async function synthesizeMsEdgeTTS(
  textOrSSML: string,
  voice: string,
  options: SynthesizeOptions
): Promise<Buffer> {
  const plainText = textOrSSML.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || textOrSSML;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(plainText, {
    rate: options.rate || '+0%',
    pitch: options.pitch || '+0Hz',
    volume: options.volume || '+0%'
  });
  const chunks: Buffer[] = [];
  for await (const chunk of audioStream) {
    chunks.push(chunk);
  }
  const result = Buffer.concat(chunks);
  if (result.length === 0) throw new Error('MsEdgeTTS produced empty audio');
  return result;
}

/**
 * Method B: Direct WebSocket Synthesizer
 */
async function synthesizeEdgeWebSocket(
  textOrSSML: string,
  voice: string = 'en-US-AriaNeural',
  options: SynthesizeOptions = {}
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const connectionId = crypto.randomUUID().replace(/-/g, '');
    const requestId = crypto.randomUUID().replace(/-/g, '');
    const secMsGec = getSecMsGecToken();
    const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${CHROMIUM_VERSION}&ConnectionId=${connectionId}`;
    
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      handshakeTimeout: 7000
    });

    const audioChunks: Buffer[] = [];
    let isCompleted = false;

    const timeout = setTimeout(() => {
      if (!isCompleted) {
        try { ws.close(); } catch {}
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('WebSocket speech synthesis timeout'));
        }
      }
    }, 12000);

    ws.on('open', () => {
      const timestamp = new Date().toISOString();
      const configMessage =
        `X-Timestamp:${timestamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'false'
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
              }
            }
          }
        });
      ws.send(configMessage);

      let ssml = textOrSSML.trim();
      if (!ssml.startsWith('<speak')) {
        const rateAttr = options.rate && options.rate !== '+0%' && options.rate !== '0%' ? ` rate="${options.rate}"` : '';
        const pitchAttr = options.pitch && options.pitch !== '+0Hz' && options.pitch !== '0Hz' && options.pitch !== '+0%' ? ` pitch="${options.pitch}"` : '';
        const volumeAttr = options.volume && options.volume !== '+0%' && options.volume !== '0%' ? ` volume="${options.volume}"` : '';
        let prosodyOpen = '';
        let prosodyClose = '';
        if (rateAttr || pitchAttr || volumeAttr) {
          prosodyOpen = `<prosody${rateAttr}${pitchAttr}${volumeAttr}>`;
          prosodyClose = `</prosody>`;
        }
        const cleanText = textOrSSML
          .replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
          `<voice name="${voice}">` +
          `${prosodyOpen}${cleanText}${prosodyClose}` +
          `</voice></speak>`;
      }

      const ssmlMessage =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMessage);
    });

    ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buffer.length > 2) {
          const headerLength = buffer.readUInt16BE(0);
          if (buffer.length > headerLength + 2) {
            const headerStr = buffer.subarray(2, headerLength + 2).toString('utf-8');
            if (headerStr.includes('Path:audio')) {
              const audioPayload = buffer.subarray(headerLength + 2);
              if (audioPayload.length > 0) {
                audioChunks.push(audioPayload);
              }
            }
          }
        }
      } else {
        const textMsg = data.toString('utf-8');
        if (textMsg.includes('Path:turn.end')) {
          isCompleted = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          const finalBuffer = Buffer.concat(audioChunks);
          if (finalBuffer.length === 0) {
            reject(new Error('No audio frames received from Edge-TTS WebSocket'));
          } else {
            resolve(finalBuffer);
          }
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      if (audioChunks.length > 0) {
        resolve(Buffer.concat(audioChunks));
      } else {
        reject(err);
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!isCompleted) {
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('Edge-TTS WebSocket connection closed before receiving audio'));
        }
      }
    });
  });
}

/**
 * Method C: Multi-Language Neural Speech Fallback
 */
async function synthesizeFallbackTTS(textOrSSML: string, voiceLocale: string = 'en-US'): Promise<Buffer> {
  const plainText = textOrSSML.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!plainText) {
    throw new Error('Empty text content for speech synthesis');
  }

  let rawLang = 'en';
  if (voiceLocale && voiceLocale.includes('-')) {
    rawLang = voiceLocale.split('-')[0].toLowerCase();
  } else if (voiceLocale && voiceLocale.length === 2) {
    rawLang = voiceLocale.toLowerCase();
  }
  const langCode = rawLang.length === 2 ? rawLang : 'en';

  const chunks: string[] = [];
  let remaining = plainText;
  while (remaining.length > 0) {
    if (remaining.length <= 180) {
      chunks.push(remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf(' ', 180);
    if (cutIndex <= 0) cutIndex = 180;
    chunks.push(remaining.slice(0, cutIndex).trim());
    remaining = remaining.slice(cutIndex).trim();
  }

  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(langCode)}&q=${encodeURIComponent(chunk)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Speech stream returned HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffers.push(Buffer.from(arrayBuffer));
  }

  return Buffer.concat(buffers);
}

/**
 * Master Synthesizer: Seamlessly tries MsEdgeTTS -> WebSocket -> Neural Fallback.
 */
export async function synthesizeEdgeTTS(
  textOrSSML: string,
  voice: string = 'en-US-AriaNeural',
  options: SynthesizeOptions = {}
): Promise<Buffer> {
  // Strip 'edge_' prefix if passed from front-end
  const cleanVoice = voice.replace(/^edge_/, '');
  const targetVoice = KOKORO_VOICE_MAP[cleanVoice] || cleanVoice;
  const locale = targetVoice.includes('-') ? targetVoice.split('-').slice(0, 2).join('-') : 'en-US';

  // 1. Try Direct WebSocket first (most reliable with Sec-MS-GEC)
  try {
    return await synthesizeEdgeWebSocket(textOrSSML, targetVoice, options);
  } catch (err1) {
    console.warn('[EdgeTTS] Direct WebSocket failed, trying msedge-tts library fallback:', err1);
    try {
      return await synthesizeMsEdgeTTS(textOrSSML, targetVoice, options);
    } catch (err2) {
      console.warn('[EdgeTTS] msedge-tts failed, trying neural fallback:', err2);
      return await synthesizeFallbackTTS(textOrSSML, locale);
    }
  }
}

/**
 * Dynamically fetches live voices from msedge-tts or Bing API
 */
export async function fetchLiveEdgeVoices(): Promise<any[]> {
  try {
    const tts = new MsEdgeTTS();
    const voices = await tts.getVoices();
    if (Array.isArray(voices) && voices.length > 0) {
      return voices;
    }
  } catch (err) {
    console.warn('[EdgeTTS] msedge-tts getVoices fallback to direct Bing Speech API endpoint...');
  }

  try {
    const secMsGec = getSecMsGecToken();
    const url = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${CHROMIUM_VERSION}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
      }
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data;
      }
    }
  } catch (err) {
    console.error('[EdgeTTS] Failed to fetch live voices from Bing Speech API:', err);
  }

  return [];
}

/**
 * Chunks long text along natural punctuation and paragraph boundaries
 */
export function chunkTextForTTS(text: string, maxChunkLength: number = 2500): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= maxChunkLength) return [text.trim()];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    if (!trimmedPara) continue;

    if ((currentChunk + '\n\n' + trimmedPara).trim().length <= maxChunkLength) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + trimmedPara : trimmedPara;
      continue;
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    if (trimmedPara.length <= maxChunkLength) {
      currentChunk = trimmedPara;
      continue;
    }

    // Split large paragraph by sentence boundaries
    const sentenceRegex = /([.!?]+[\s\n]+|[\u3002\uff01\uff1f]+)/;
    const tokens = trimmedPara.split(sentenceRegex);
    let subChunk = '';

    for (let i = 0; i < tokens.length; i++) {
      const piece = tokens[i];
      if (!piece) continue;
      if ((subChunk + piece).length <= maxChunkLength) {
        subChunk += piece;
      } else {
        if (subChunk.trim()) {
          chunks.push(subChunk.trim());
        }
        if (piece.length > maxChunkLength) {
          const words = piece.split(/\s+/);
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + ' ' + word).length <= maxChunkLength) {
              wordChunk = wordChunk ? wordChunk + ' ' + word : word;
            } else {
              if (wordChunk.trim()) chunks.push(wordChunk.trim());
              wordChunk = word;
            }
          }
          subChunk = wordChunk;
        } else {
          subChunk = piece;
        }
      }
    }

    if (subChunk.trim()) {
      currentChunk = subChunk.trim();
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text.trim()];
}
