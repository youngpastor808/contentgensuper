import { audioBufferToWavBlob } from '../utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { state } from '../state';
import * as utils from '../utils';
import type { WordTimestamp } from '../types';
import { generateContentWithFallback, getApiKey, createGoogleGenAIClient, fixJsonWithGemini, deductCredits, checkCredits, isUsingPersonalKey } from "./core";
import { isAudioGenAllowedForCurrentUser } from "../auth";
import { canUseInstantTimestamps, generateSpeechGradio, generateSpeechElevenLabs, generateSpeechMinimax, generateSpeechAi33V3, ai33SpeechToText, parseSrtToWords, getAi33ApiKey } from "./providers";
import { showStatus, logProductionStatus } from "../ui";
import { PRIMARY_MODEL, SECONDARY_MODEL, TRANSCRIBE_MODEL, CREDIT_COSTS, TRANSCRIPT_CACHE_STORE } from "../constants";
import { DB } from '../db';
import { pollAi33Task } from "./providers";

export async function splitShotLines(fullScript: string, targetLine: string): Promise<{ part1: string; part2: string }> {
    const prompt = `You are an expert film and script editor. 
You must split the following shot's sentence into two logical halves based on pacing and narrative structure. 
Do not change, add, or remove any words from the original sentence. Just find the best place to insert a cut.

Full Script for Context:
"${fullScript}"

Target Sentence to Split:
"${targetLine}"`;

    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL,
        contents: prompt,
        schema: {
            type: Type.OBJECT,
            properties: {
                part1: { type: Type.STRING, description: "The exact first half of the target sentence." },
                part2: { type: Type.STRING, description: "The exact second half of the target sentence." }
            },
            required: ["part1", "part2"]
        }
    });

    return utils.sanitizeAndParseJson(response.text!);
}

export async function generateNarrationDirection(storyText: string, customInstructions?: string): Promise<{
    reading_style: string;
    recommended_voice: string;
    pacing: string;
    additional_notes?: string;
}> {
    const systemInstruction = `You are an expert voice-over director. Analyze the provided story's tone, mood, and content to recommend a narration style.
- reading_style: Describe the vocal delivery (e.g., 'Warm and conversational', 'Gravelly and mysterious', 'Energetic and upbeat').
- recommended_voice: Suggest a suitable pre-built Gemini voice (e.g., 'Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir').
- pacing: Recommend the speed ('slow', 'medium', 'fast').
- additional_notes: (Optional) Add brief notes about why this style fits the story.
${customInstructions ? `\nFollow these specific user instructions: ${customInstructions}` : ''}
Return ONLY a valid JSON object.`;

    const response = await generateContentWithFallback({
        model: PRIMARY_MODEL,
        contents: storyText,
        systemInstruction,
        schema: {
            type: Type.OBJECT,
            properties: {
                reading_style: { type: Type.STRING },
                recommended_voice: { type: Type.STRING },
                pacing: { type: Type.STRING, enum: ['slow', 'medium', 'fast'] },
                additional_notes: { type: Type.STRING }
            },
            required: ["reading_style", "recommended_voice", "pacing"]
        }
    });
    return utils.sanitizeAndParseJson(response.text!);
}

function estimateWordTimestamps(text: string, duration: number): WordTimestamp[] {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const totalChars = words.reduce((acc, word) => acc + word.length, 0);
    if (totalChars === 0) return [];
    const timePerChar = duration / totalChars;
    let currentStart = 0;
    return words.map((word) => {
        const wordDuration = word.length * timePerChar;
        const w = {
            word,
            start: currentStart,
            end: currentStart + wordDuration
        };
        currentStart += wordDuration;
        return w;
    });
}

export async function transcribeAudioDeepgramDirect(file: File): Promise<{ text: string; chunks: any[]; words?: any[]; confidence?: number }> {
    const deepgramKey = state.deepgramApiKey || (typeof localStorage !== 'undefined' ? (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key')) : null);
    if (!deepgramKey) {
        throw new Error("Deepgram API key not configured.");
    }
    if (!state.deepgramApiKey) {
        state.deepgramApiKey = deepgramKey;
    }

    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
        try {
            const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=false&punctuate=true&words=true', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${deepgramKey}`,
                    'Content-Type': file.type || 'audio/wav'
                },
                body: file
            });
            
            if (!response.ok) {
                const errBody = await response.text();
                throw new Error(`Deepgram API failed (${response.status}): ${errBody}`);
            }
            
            const result = await response.json();
            const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
            const words = result?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
            const chunks: any[] = [];
            
            let currentChunkWords: string[] = [];
            let chunkStart = 0;
            let currentEnd = 0;
            
            words.forEach((w: any, i: number) => {
                if (currentChunkWords.length === 0) chunkStart = w.start;
                currentChunkWords.push(w.punctuated_word || w.word);
                currentEnd = w.end;
                
                if (i === words.length - 1 || words[i+1].start - w.end > 0.5 || currentEnd - chunkStart > 5) {
                     chunks.push({
                         text: currentChunkWords.join(' '),
                         timestamp: [chunkStart, currentEnd]
                     });
                     currentChunkWords = [];
                }
            });
            return { text, chunks, words, confidence: 98 };
        } catch (err: any) {
            // If direct browser fetch failed (e.g. CORS, network restrictions), fall back to server proxy route
            try {
                const formData = new FormData();
                formData.append('file', file);
                const proxyResp = await fetch('/api/transcribe', {
                    method: 'POST',
                    headers: {
                        'x-deepgram-api-key': deepgramKey,
                        'x-engine': 'deepgram'
                    },
                    body: formData
                });
                if (proxyResp.ok) {
                    const proxyResult = await proxyResp.json();
                    if (proxyResult && (proxyResult.text || (proxyResult.words && proxyResult.words.length > 0))) {
                        return proxyResult;
                    }
                }
            } catch (proxyErr) {
                console.warn('Deepgram server proxy fallback also encountered issue:', proxyErr);
            }

            const msg = String(err?.message || err);
            const isRetryable = /429|50\d|fetch|network/i.test(msg);
            if (isRetryable && retries < maxRetries) {
                retries++;
                await new Promise(r => setTimeout(r, 1200 * Math.pow(1.5, retries)));
                continue;
            }
            throw err;
        }
    }
    throw new Error("Deepgram retries exhausted.");
}

export async function transcribeAudioWhisperServer(file: File, engine?: string): Promise<{ text: string; chunks: any[]; words?: any[]; confidence?: number }> {
    const formData = new FormData();
    formData.append('file', file);
    
    const headers: Record<string, string> = {};
    if (state.deepgramApiKey) {
        headers['x-deepgram-api-key'] = state.deepgramApiKey;
    }
    if (engine) {
        headers['x-engine'] = engine;
    }

    const requestedModel = localStorage.getItem('whisperModel') || 'Xenova/whisper-base.en';
    headers['x-whisper-model'] = requestedModel;

    const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers,
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Whisper server transcription failed (${response.status})`);
    }

    const text = await response.text();
    const result = JSON.parse(text);
    if (result && (result.text?.trim().length > 0 || (result.words && result.words.length > 0))) {
        return result;
    }
    throw new Error("Whisper server returned empty result.");
}

export async function transcribeAudioLocal(file: File, engine?: string): Promise<{text: string, chunks: any[], words?: any[], confidence?: number}> {
    const hasDeepgram = !!(state.deepgramApiKey || (typeof localStorage !== 'undefined' && (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key'))));
    const chosenEngine = (engine || state.preferredTranscribeEngine || 'deepgram').toLowerCase().trim();

    // Priority order: Deepgram -> Whisper -> Gemini
    let engineOrder: ('deepgram' | 'whisper' | 'gemini')[] = ['deepgram', 'whisper', 'gemini'];
    if (!hasDeepgram) {
        if (chosenEngine === 'gemini' || chosenEngine === 'gemini-3.5-transcribe') {
            engineOrder = ['gemini', 'whisper'];
        } else {
            engineOrder = ['whisper', 'gemini'];
        }
    } else {
        // Deepgram API is set: strictly Deepgram -> Whisper -> Gemini
        engineOrder = ['deepgram', 'whisper', 'gemini'];
    }

    for (const eng of engineOrder) {
        // 1. DEEPGRAM
        if (eng === 'deepgram') {
            const deepgramKey = state.deepgramApiKey || (typeof localStorage !== 'undefined' ? (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key')) : null);
            if (deepgramKey) {
                if (!state.deepgramApiKey) state.deepgramApiKey = deepgramKey;
                try {
                    console.log('Attempting audio transcription with Deepgram Nova-3 (1st priority)...');
                    logProductionStatus('⚡ Transcribing audio with Deepgram Nova-3...');
                    const dgResult = await transcribeAudioDeepgramDirect(file);
                    if (dgResult && (dgResult.text || (dgResult.words && dgResult.words.length > 0))) {
                        logProductionStatus(`✅ Deepgram transcription complete (${dgResult.words?.length || 0} words mapped).`);
                        return dgResult;
                    }
                } catch (err: any) {
                    console.warn('Deepgram transcription failed, falling back to next engine in order:', err);
                    logProductionStatus(`⚠️ Deepgram transcription failed: ${err.message || err}. Falling back...`, true);
                }
            }
        }
        
        // 2. WHISPER
        else if (eng === 'whisper') {
            try {
                console.log('Attempting audio transcription with Whisper (2nd priority)...');
                logProductionStatus('🎙️ Transcribing audio with Whisper server...');
                const whisperResult = await transcribeAudioWhisperServer(file, engine);
                if (whisperResult && (whisperResult.text || (whisperResult.words && whisperResult.words.length > 0))) {
                    logProductionStatus(`✅ Whisper transcription complete (${whisperResult.words?.length || 0} words mapped).`);
                    return whisperResult;
                }
            } catch (err: any) {
                console.warn('Whisper transcription failed, falling back to next engine in order:', err);
                logProductionStatus(`⚠️ Whisper server transcription failed: ${err.message || err}. Falling back...`, true);
            }
        }
        
        // 3. GEMINI 3.5 TRANSCRIBE
        else if (eng === 'gemini') {
            try {
                console.log('Attempting audio transcription with Gemini 3.5 Transcribe (3rd priority)...');
                logProductionStatus('🤖 Transcribing audio with Gemini 3.5 Transcribe...');
                const geminiResult = await transcribeAudioWithGemini(file);
                if (geminiResult && (geminiResult.text || (geminiResult.words && geminiResult.words.length > 0))) {
                    logProductionStatus(`✅ Gemini 3.5 Transcribe complete (${geminiResult.words?.length || 0} words mapped).`);
                    return geminiResult;
                }
            } catch (err: any) {
                console.warn('Gemini 3.5 Transcribe failed:', err);
                logProductionStatus(`⚠️ Gemini 3.5 Transcribe failed: ${err.message || err}`, true);
            }
        }
    }

    // 4. Proportional / Empty Fallback
    console.warn('All transcription engines (Deepgram, Whisper, Gemini) failed or unavailable.');
    logProductionStatus('⚠️ All transcription engines (Deepgram/Whisper/Gemini) failed. Switching to proportional word timing...', true);
    return { text: '', chunks: [], words: [], confidence: 50 };
}

export async function transcribeAudioWithGemini(file: File): Promise<{ text: string; chunks: any[]; words?: any[]; confidence?: number }> {
    const { data: audioBase64, mimeType } = await utils.fileToBase64(file);

    const response = await generateContentWithFallback({
        model: TRANSCRIBE_MODEL,
        contents: {
            parts: [
                { inlineData: { mimeType, data: audioBase64 } },
                { text: "You are an expert audio speech-to-text transcriber powered by Gemini 3.5 Transcribe. Transcribe this audio file verbatim with precision. Provide the full transcript text, exact word-level timestamps (start and end in seconds), speaker diarization if multiple speakers are detected, and estimated overall transcription accuracy confidence percentage (0 to 100). Return ONLY a valid JSON object with 'text' (the full transcript string), 'confidence' (number 0 to 100 representing accuracy/clarity percentage), and 'words' (an array of objects: { word: string, start: number, end: number, speaker?: string }). Ensure every spoken word has accurate start and end timestamps in seconds." }
            ]
        },
        schema: {
            type: Type.OBJECT,
            properties: {
                text: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                words: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            start: { type: Type.NUMBER },
                            end: { type: Type.NUMBER },
                            speaker: { type: Type.STRING }
                        },
                        required: ["word", "start", "end"]
                    }
                }
            },
            required: ["text"]
        }
    });

    const parsed = utils.sanitizeAndParseJson(response.text || '{}');
    const text = (parsed.text || '').trim();
    const words = parsed.words || [];
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 98;

    const chunks: any[] = [];
    if (words.length > 0) {
        let currentChunkWords: string[] = [];
        let chunkStart = 0;
        let currentEnd = 0;

        words.forEach((w: any, i: number) => {
            if (currentChunkWords.length === 0) chunkStart = w.start || 0;
            currentChunkWords.push(w.word);
            currentEnd = w.end || chunkStart;

            if (i === words.length - 1 || (words[i+1] && (words[i+1].start - w.end) > 0.5) || (currentEnd - chunkStart) > 5) {
                chunks.push({
                    text: currentChunkWords.join(' '),
                    timestamp: [chunkStart, currentEnd]
                });
                currentChunkWords = [];
            }
        });
    }

    return { text, chunks, words, confidence };
}

async function forceAlignGeminiSingle(file: File, script: string, onProgress?: (p: number, m: string) => void): Promise<WordTimestamp[]> {
    onProgress?.(10, 'Preparing audio for alignment...');
    const { data: audioBase64, mimeType } = await utils.fileToBase64(file);
    
    const audioContext = utils.getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await utils.safeDecode(audioContext, arrayBuffer);
    const audioDuration = audioBuffer.duration;

    onProgress?.(30, 'Aligning with Gemini 3.5 Transcribe...');
    const response = await generateContentWithFallback({
        model: TRANSCRIBE_MODEL,
        contents: { 
            parts: [
                { inlineData: { mimeType, data: audioBase64 } }, 
                { text: `You are a precision audio aligner powered by Gemini 3.5 Transcribe. Provide precise word-level timestamps for this audio. The expected transcript is: "${script}". Return ONLY a valid JSON object with a 'words' array containing word-level timestamps ({ word, start, end }).` }
            ] 
        },
        schema: {
            type: Type.OBJECT,
            properties: {
                words: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            start: { type: Type.NUMBER },
                            end: { type: Type.NUMBER }
                        },
                        required: ["word", "start", "end"]
                    }
                }
            },
            required: ["words"]
        }
    });

    onProgress?.(95, 'Parsing and validating alignment data...');
    const result = utils.sanitizeAndParseJson(response.text!);
    
    if (!result.words || result.words.length === 0) {
        onProgress?.(98, 'Gemini failed, returning empty timestamps for fallback...');
        return [];
    }

    const validatedWords = result.words.filter((w: any): w is WordTimestamp => 
        w && typeof w.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number' && 
        w.start >= 0 && w.end > w.start && w.end <= audioDuration + 0.1
    );

    if (validatedWords.length === 0) {
        onProgress?.(98, 'Invalid timestamps, returning empty timestamps for fallback...');
        return [];
    }

    return validatedWords;
}

async function syncTranscriptWithGemini(
    rawWords: WordTimestamp[],
    script: string,
    onProgress?: (p: number, m: string) => void
): Promise<WordTimestamp[]> {
    onProgress?.(92, 'Using Gemini to sync timestamps and script...');
    
    // We do text-only generation with Gemini which is extremely fast and cheap
    const response = await generateContentWithFallback({
        model: SECONDARY_MODEL,
        contents: { 
            parts: [
                { text: `You are a precision audio aligner. You are given a raw ASR transcript with timestamps, and an Expected Script.

RAW ASR TRANSCRIPT:
${JSON.stringify(rawWords.map(w => ({ word: w.word, start: w.start, end: w.end })))}

EXPECTED SCRIPT:
"${script}"

Task: Map the exact words from the Expected Script to the nearest timestamps from the Raw ASR Transcript. 
Return ONLY a JSON object with a 'words' array containing exactly the words from the Expected Script with their assigned 'start' and 'end' times.` }
            ] 
        },
        systemInstruction: "You are a precision audio aligner. Return ONLY a JSON object with a 'words' array containing word-level timestamps.",
        schema: {
            type: Type.OBJECT,
            properties: {
                words: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            word: { type: Type.STRING },
                            start: { type: Type.NUMBER },
                            end: { type: Type.NUMBER }
                        },
                        required: ["word", "start", "end"]
                    }
                }
            },
            required: ["words"]
        }
    });

    onProgress?.(98, 'Parsing Gemini sync data...');
    const result = utils.sanitizeAndParseJson(response.text!);
    
    if (!result.words || result.words.length === 0) {
        onProgress?.(99, 'Gemini text sync failed, returning raw ASR timestamps...');
        return rawWords;
    }

    const validatedWords = result.words.filter((w: any): w is WordTimestamp => 
        w && typeof w.word === 'string' && typeof w.start === 'number' && typeof w.end === 'number' && 
        w.start >= 0
    );

    if (validatedWords.length === 0) {
        return rawWords;
    }

    return validatedWords;
}

function simpleStringHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export async function forceAlignAudio(
    file: File,
    script: string,
    onProgress: (p: number, m: string) => void,
    engine?: string
): Promise<WordTimestamp[]> {
    const normalizedEngine = (engine || state.preferredTranscribeEngine || 'deepgram').toLowerCase().trim();
    
    // Check cache first
    const scriptHash = (normalizedEngine === 'gemini' || normalizedEngine === 'gemini-3.5-transcribe') ? simpleStringHash(script) : 'any';
    const cacheKey = `align_${file.name}_${file.size}_${file.lastModified}_${normalizedEngine}_${scriptHash}`;
    try {
        const store = await DB.getStore(TRANSCRIPT_CACHE_STORE, 'readonly');
        const cached = await new Promise<any>((resolve, reject) => {
            const req = store.get(cacheKey);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (cached && cached.words && cached.words.length > 0) {
            onProgress(100, `Loaded cached ${normalizedEngine} transcript.`);
            return cached.words;
        }
    } catch (err) {
        console.warn("Failed to check transcript cache:", err);
    }

    // Default to the original file to avoid OfflineAudioContext 3-minute limits on WebKit/iOS
    let lightweightFile = file;
    let audioBuffer: AudioBuffer;
    const audioContext = utils.getAudioContext();
    const arrayBuffer = await file.arrayBuffer();

    onProgress(5, `Processing audio format...`);
    audioBuffer = await utils.safeDecode(audioContext, arrayBuffer);

    // Perform computation if not cached
    const words = await _forceAlignCompute(lightweightFile, script, onProgress, normalizedEngine, audioBuffer);
    
    // Cache the result
    try {
        const store = await DB.getStore(TRANSCRIPT_CACHE_STORE, 'readwrite');
        await new Promise((resolve, reject) => {
            const req = store.put({ id: cacheKey, words, timestamp: Date.now() });
            req.onsuccess = resolve;
            req.onerror = reject;
        });
    } catch (e) {
        console.warn("Failed to cache transcript:", e);
    }
    
    return words;
}

export function createProportionalTimestamps(knownText: string, duration: number): WordTimestamp[] {
    const words = knownText.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const totalChars = words.reduce((acc, w) => acc + w.length, 0) || 1;
    let currentStart = 0;
    return words.map(w => {
        const wordDur = (w.length / totalChars) * duration;
        const start = currentStart;
        currentStart += wordDur;
        return {
            word: w,
            start,
            end: currentStart
        };
    });
}

async function _forceAlignCompute(
    lightweightFile: File,
    script: string,
    onProgress: (p: number, m: string) => void,
    normalizedEngine: string,
    audioBuffer: AudioBuffer
): Promise<WordTimestamp[]> {
    const audioDuration = audioBuffer.duration;

    const formatWordsFromResult = (result: { words?: any[]; chunks?: any[] }): WordTimestamp[] => {
        if (result.words && result.words.length > 0) {
            return result.words.map((w: any, idx: number) => {
                const s = typeof w.start === 'number' ? w.start : (typeof w.end === 'number' ? w.end : NaN);
                const e = typeof w.end === 'number' ? w.end : s + 0.2;
                if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
                return {
                    word: String(w.punctuated_word || w.word || ''),
                    start: s,
                    end: e,
                };
            }).filter((w): w is WordTimestamp => w !== null);
        }
        // NO proportional fabrication from chunks. If the engine gave no word-level
        // timestamps, we return [] and let the caller keep neighbors' real timings
        // and mark the gap (see 1b). Returning synthetic evenly-spaced words here is
        // what made long videos visibly drift (words land 0.5-2s off the audio).
        return [];
    };

    const hasDeepgram = !!(state.deepgramApiKey || (typeof localStorage !== 'undefined' && (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key'))));
    const isGeminiSelected = normalizedEngine === 'gemini' || normalizedEngine === 'gemini-3.5-transcribe' || normalizedEngine === 'gemini-transcribe';
    const isWhisperSelected = normalizedEngine === 'whisper' || normalizedEngine === 'local_whisper';

    // Priority order: Deepgram -> Whisper -> Gemini
    let alignOrder: ('deepgram' | 'whisper' | 'gemini')[] = ['deepgram', 'whisper', 'gemini'];
    if (!hasDeepgram) {
        if (isGeminiSelected) {
            alignOrder = ['gemini', 'whisper'];
        } else {
            alignOrder = ['whisper', 'gemini'];
        }
    } else {
        // Deepgram API key configured: strictly Deepgram -> Whisper -> Gemini
        alignOrder = ['deepgram', 'whisper', 'gemini'];
    }

    for (const eng of alignOrder) {
        // 1. DEEPGRAM
        if (eng === 'deepgram') {
            const deepgramKey = state.deepgramApiKey || (typeof localStorage !== 'undefined' ? (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key')) : null);
            if (deepgramKey) {
                if (!state.deepgramApiKey) state.deepgramApiKey = deepgramKey;
                try {
                    onProgress(25, `Transcribing audio with Deepgram Nova-3 (1st priority)...`);
                    const dgResult = await transcribeAudioDeepgramDirect(lightweightFile);
                    const words = formatWordsFromResult(dgResult);
                    if (words.length > 0) {
                        onProgress(100, `Alignment complete using Deepgram.`);
                        return words;
                    }
                } catch (err: any) {
                    console.warn(`Deepgram alignment failed (${err.message || err}). Proceeding to next engine...`);
                }
            }
        }

        // 2. WHISPER
        else if (eng === 'whisper') {
            try {
                onProgress(50, `Transcribing audio with Whisper (2nd priority)...`);
                const whisperResult = await transcribeAudioWhisperServer(lightweightFile, normalizedEngine);
                const words = formatWordsFromResult(whisperResult);
                if (words.length > 0) {
                    onProgress(80, `Whisper transcription complete. Syncing with script via Gemini...`);
                    try {
                        const synced = await syncTranscriptWithGemini(words, script, onProgress);
                        if (synced && synced.length > 0) return synced;
                    } catch (syncErr) {
                        console.warn("Gemini script sync failed, returning raw Whisper timestamps:", syncErr);
                    }
                    return words;
                }
            } catch (err: any) {
                console.warn(`Whisper alignment failed (${err.message || err}). Proceeding to next engine...`);
            }
        }

        // 3. GEMINI 3.5 TRANSCRIBE
        else if (eng === 'gemini') {
            try {
                onProgress(75, `Aligning audio with Gemini 3.5 Transcribe (3rd priority)...`);
                if (audioDuration > 300) {
                    const CHUNK_DURATION = 120;
                    const chunks = Math.ceil(audioDuration / CHUNK_DURATION);
                    const allWords: WordTimestamp[] = [];
                    for (let i = 0; i < chunks; i++) {
                        const start = i * CHUNK_DURATION;
                        const end = Math.min((i + 1) * CHUNK_DURATION, audioDuration);
                        onProgress(75 + (i / chunks) * 20, `Gemini 3.5 Transcribe alignment chunk ${i + 1}/${chunks}...`);
                        const chunkFile = await utils.extractAudioChunk(lightweightFile, start, end);
                        const chunkScript = utils.extractScriptChunk(script, i, chunks);
                        const chunkWords = await forceAlignGeminiSingle(chunkFile, chunkScript);
                        allWords.push(...chunkWords.map(w => ({ ...w, start: w.start + start, end: w.end + start })));
                    }
                    if (allWords.length > 0) {
                        onProgress(100, 'Gemini 3.5 Transcribe audio alignment complete.');
                        return allWords;
                    }
                } else {
                    const geminiWords = await forceAlignGeminiSingle(lightweightFile, script, onProgress);
                    if (geminiWords && geminiWords.length > 0) {
                        onProgress(100, 'Gemini 3.5 Transcribe audio alignment complete.');
                        return geminiWords;
                    }
                }
            } catch (err: any) {
                console.warn(`Gemini 3.5 Transcribe audio alignment failed (${err.message || err}).`);
            }
        }
    }

    // 4. NO FABRICATION — report the gap.
    // Long-video rule: real timestamps for SOME words beat guessed timestamps for ALL words.
    onProgress(98, `No engine returned word timestamps. Keeping existing word timings; gap will be marked.`);
    console.warn("No word-level timestamps available from Deepgram/Whisper/Gemini. Returning empty transcript — caller will mark the gap instead of spreading evenly.");
    return [];
}

async function alignAudioWithWhisper(buffer: AudioBuffer, knownText: string, signal?: AbortSignal, onProgress?: (p: number, m: string) => void): Promise<WordTimestamp[]> {
    const wavBlob = audioBufferToWavBlob(buffer);
    
    try {
        const audioFile = new File([wavBlob], "audio.wav", { type: "audio/wav" });
        return await _forceAlignCompute(audioFile, knownText, onProgress || (() => {}), 'deepgram', buffer);
    } catch (e) {
        console.warn(`Alignment failed. Returning empty transcript (gap will be marked):`, e);
        if (onProgress) onProgress(98, `Alignment engines failed. Gap will be marked.`);
        return [];
    }
}

export async function generateSpeech(
    textForAudio: string, 
    voiceName: string, 
    rate: number, 
    pitch: number,
    originalTextForAlignment?: string,
    signal?: AbortSignal,
    onProgress?: (p: number, m: string) => void
): Promise<{ buffer: AudioBuffer; words: WordTimestamp[] }> {
    const hasPersonalKey = isUsingPersonalKey(true);
    if (!isAudioGenAllowedForCurrentUser()) {
        throw new Error("Gemini audio generation is disabled for your account. Please ask an administrator to grant you Gemini Audio Generation access in the Admin Panel or configure your personal Gemini API key in Settings.");
    }
    if (state.systemConfig?.disableSystemAudioGeneration && !hasPersonalKey) {
        throw new Error("Gemini audio generation on the shared system API has been disabled by the administrator. Please configure your personal Gemini API key in Settings to generate audio.");
    }

    const apiKey = getApiKey();
    const ai = createGoogleGenAIClient(apiKey);
    
    await checkCredits(1, 'audio'); // Estimated cost for Gemini TTS
    
    const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: textForAudio }] }],
        config: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        }
    });

    if (response.usageMetadata && response.usageMetadata.totalTokenCount) {
        deductCredits(response.usageMetadata.totalTokenCount * CREDIT_COSTS.AUDIO_GENERATION_PER_TOKEN, 'audio').catch(console.error);
    }

    const audioPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) throw new Error("Empty audio response from TTS.");

    const buffer = await utils.decodeAudioData(utils.decode(audioPart!.inlineData!.data), utils.getAudioContext(), 24000, 1);
    const textToAlign = originalTextForAlignment || textForAudio;
    const words = await alignAudioWithWhisper(buffer, textToAlign, signal, onProgress);
    
    return { buffer, words };
}

export async function generateSpeechEdgeTTS(
    text: string,
    voice: string,
    speedMultiplier: number = 1.0,
    pitchHz: number = 0,
    signal?: AbortSignal,
    volumePercent: number = 0
): Promise<{ buffer: AudioBuffer }> {
    const ratePercent = Math.round((speedMultiplier - 1.0) * 100);
    const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
    const pitchStr = pitchHz >= 0 ? `+${pitchHz}Hz` : `${pitchHz}Hz`;
    const volumeStr = volumePercent >= 0 ? `+${volumePercent}%` : `${volumePercent}%`;

    const endpoint = text.length > 2500 ? '/api/tts/generate-long' : '/api/tts/generate';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            text,
            voice,
            options: {
                rate: rateStr,
                pitch: pitchStr,
                volume: volumeStr
            }
        }),
        signal
    });

    if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `Edge-TTS synthesis failed (HTTP ${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const audioContext = utils.getAudioContext();
    const buffer = await utils.safeDecode(audioContext, arrayBuffer);
    return { buffer };
}

export async function generateSpeechWithTimestamps(
    text: string,
    voiceProvider: 'gemini' | 'elevenlabs' | 'ai33' | 'minimax' | 'gradio_custom' | 'gradio_design' | 'gradio_clone' | 'edge' | 'kokoro',
    voiceId: string,
    { rate, pitch, stability, similarity, style, volume = 0 }: { rate: number, pitch: number, stability: number, similarity: number, style: number, volume?: number },
    signal?: AbortSignal,
    onProgress?: (p: number, m: string) => void
): Promise<{ buffer: AudioBuffer; words: WordTimestamp[]; source: string }> {

    let estimatedCost = CREDIT_COSTS.AUDIO_GENERATION_ALIGNED;
    if (voiceProvider === 'edge' || voiceProvider === 'kokoro') {
        estimatedCost = 0;
    } else if (voiceProvider === 'elevenlabs' && await canUseInstantTimestamps()) {
        estimatedCost = CREDIT_COSTS.AUDIO_GENERATION_ELEVENLABS_INSTANT;
    } else if (voiceProvider === 'gemini') {
        estimatedCost = 1; // Minimal check, actual deduction is token-based
    }
    if (estimatedCost > 0) {
        await checkCredits(estimatedCost, 'audio');
    }

    if (await canUseInstantTimestamps() && voiceProvider === 'elevenlabs') {
        try {
            const modelId = state.elevenlabsSelectedModel || 'eleven_multilingual_v2';
            const result = await generateSpeechElevenLabs(text, voiceId, modelId, rate, stability, similarity, style, 'elevenlabs', true, signal);
            if (result.words?.length) {
                deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ELEVENLABS_INSTANT, 'audio').catch(console.error);
                return { ...result, words: result.words, source: 'elevenlabs_instant' };
            }
            const alignedWords = await alignAudioWithWhisper(result.buffer, text, signal, onProgress);
            deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
            return { buffer: result.buffer, words: alignedWords, source: 'elevenlabs_aligned' };
        } catch (error) {
            showStatus('Instant timestamp failed, using fallback.', true, 4000);
        }
    }

    let audioResult: { buffer: AudioBuffer };
    let source: string;

    if (voiceProvider.startsWith('gradio_')) {
        const params: any = {};
        if (voiceProvider === 'gradio_custom') {
            params.voiceName = voiceId;
            // Pass the style instruction textarea value if present
            const styleInstructionEl = typeof document !== 'undefined'
                ? document.getElementById('gradio-style-instruction') as HTMLTextAreaElement | null
                : null;
            params.instruction = styleInstructionEl?.value?.trim() || '';
        } // Add other gradio param setups here
        audioResult = await generateSpeechGradio(text, voiceProvider as any, params, signal);
        source = 'gradio_aligned';
        deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
    } else {
        switch (voiceProvider) {
            case 'ai33':
                if (state.ai33ApiKey) {
                    try {
                        audioResult = await generateSpeechAi33V3(text, voiceId, { speed: rate, withTranscript: true }, signal);
                        source = 'ai33_v3_aligned';
                        deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
                        break;
                    } catch (e: any) {
                        console.warn('AI33 v3 speech generation fallback:', e.message);
                    }
                }
                // Fallback to elevenlabs proxy
                const ai33ModelId = state.elevenlabsSelectedModel || 'eleven_multilingual_v2';
                audioResult = await generateSpeechElevenLabs(text, voiceId, ai33ModelId, rate, stability, similarity, style, 'ai33', false, signal);
                source = 'ai33_aligned';
                deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
                break;
            case 'elevenlabs':
                const modelId = state.elevenlabsSelectedModel || 'eleven_multilingual_v2';
                audioResult = await generateSpeechElevenLabs(text, voiceId, modelId, rate, stability, similarity, style, voiceProvider, false, signal);
                source = `${voiceProvider}_aligned`;
                deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
                break;
            case 'minimax':
                audioResult = await generateSpeechMinimax(text, voiceId, rate, pitch, signal);
                source = 'minimax_aligned';
                deductCredits(CREDIT_COSTS.AUDIO_GENERATION_ALIGNED, 'audio').catch(console.error);
                break;
            case 'gemini':
                const geminiResult = await generateSpeech(`[Continue with the same voice and tone] ${text}`, voiceId, rate, pitch, text, signal, onProgress);
                return { ...geminiResult, source: 'gemini_aligned' };
            case 'edge':
            case 'kokoro':
            default:
                audioResult = await generateSpeechEdgeTTS(text, voiceId || 'en-US-AvaNeural', rate, pitch, signal, volume);
                source = `${voiceProvider || 'edge'}_aligned`;
                break;
        }
    }
    
    if ((audioResult as any).words && (audioResult as any).words.length > 0) {
        return { ...audioResult, words: (audioResult as any).words, source };
    }
    
    // For Edge, Kokoro, and voices without built-in timestamps:
    // Transcribe and align with Deepgram Nova-3 (1st), Whisper (2nd), Gemini (3rd)
    let alignedWords: WordTimestamp[] = [];
    try {
        alignedWords = await alignAudioWithWhisper(audioResult.buffer, text, signal, onProgress);
    } catch (alignErr: any) {
        console.warn('Transcription/alignment cascade failed, checking proportional fallback:', alignErr?.message || alignErr);
    }

    if (alignedWords && alignedWords.length > 0) {
        return { ...audioResult, words: alignedWords, source: `${source}_aligned` };
    }

    // Fallback: If all transcription engines (Deepgram/Whisper/Gemini) failed or are unconfigured,
    // construct proportional word timestamps as a smooth fallback.
    const propWords = createProportionalTimestamps(text, audioResult.buffer.duration);
    return { ...audioResult, words: propWords, source: `${source}_proportional` };
}

export async function generateSfx(
    prompt: string,
    provider: 'freesound' | 'gemini' | 'elevenlabs',
    signal?: AbortSignal
): Promise<AudioBuffer> {
    if (provider === 'freesound') {
        const apiKey = state.freesoundApiKey;
        if (!apiKey) throw new Error("Freesound API key is required. Please add it in Settings.");
        
        const searchUrl = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(prompt)}&token=${apiKey}&fields=id,name,previews`;
        const searchRes = await fetch(searchUrl, { signal });
        if (!searchRes.ok) throw new Error("Freesound search failed.");
        const searchData = await searchRes.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            throw new Error("No sound effects found for this prompt.");
        }
        
        const previewUrl = searchData.results[0].previews['preview-hq-mp3'];
        const audioRes = await fetch(previewUrl, { signal });
        if (!audioRes.ok) throw new Error("Failed to download SFX.");
        
        const arrayBuffer = await audioRes.arrayBuffer();
        return await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
    } else if (provider === 'elevenlabs') {
        const apiKey = state.elevenlabsApiKey;
        if (!apiKey) throw new Error("ElevenLabs API key is required.");
        
        const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: prompt,
                duration_seconds: 5,
                prompt_influence: 0.3
            }),
            signal
        });
        if (!res.ok) throw new Error("ElevenLabs SFX generation failed.");
        const arrayBuffer = await res.arrayBuffer();
        return await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
    } else {
        // Gemini fallback
        const hasPersonalKey = isUsingPersonalKey(true);
        if (!isAudioGenAllowedForCurrentUser()) {
            throw new Error("Gemini audio generation is disabled for your account. Please ask an administrator to grant you Gemini Audio Generation access in the Admin Panel or configure your personal Gemini API key in Settings.");
        }
        if (state.systemConfig?.disableSystemAudioGeneration && !hasPersonalKey) {
            throw new Error("Gemini audio generation on the shared system API has been disabled by the administrator. Please configure your personal Gemini API key in Settings to generate audio.");
        }

        await checkCredits(1, 'audio');
        const apiKey = getApiKey();
        const ai = createGoogleGenAIClient(apiKey);
        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: `[Sound effect: ${prompt}]` }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            }
        });
        
        if (response.usageMetadata && response.usageMetadata.totalTokenCount) {
            deductCredits(response.usageMetadata.totalTokenCount * CREDIT_COSTS.AUDIO_GENERATION_PER_TOKEN, 'audio').catch(console.error);
        }
        
        const audioPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (!audioPart?.inlineData?.data) throw new Error("Empty audio response from TTS.");
        return await utils.decodeAudioData(utils.decode(audioPart!.inlineData!.data), utils.getAudioContext(), 24000, 1);
    }
}
