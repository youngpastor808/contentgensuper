/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from '../state';
import { blobToBase64, decode, getAudioContext, safeDecode, fileToBase64, timeToSeconds, resampleAndEncodeAudio } from '../utils';
import { audioBufferToWavBlob } from '../utils-core';
import type { WordTimestamp } from '../types';

const elevenlabsRequestCache = new Map<string, Promise<any>>();

function getElevenLabsRequestKey(
    text: string,
    voiceId: string,
    provider: string,
    params?: { rate?: number; stability?: number; similarity?: number; style?: number; withTimestamps?: boolean }
): string {
    const rate = params?.rate ?? 1;
    const stability = params?.stability ?? 0.5;
    const similarity = params?.similarity ?? 0.75;
    const style = params?.style ?? 0;
    const timestamps = params?.withTimestamps ? 1 : 0;
    return `${provider}:${voiceId}:${rate}:${stability}:${similarity}:${style}:${timestamps}:${text}`;
}

export function getStabilityApiKey(): string | null {
    if (state.stabilityApiKey) return state.stabilityApiKey;
    if (state.privateSystemConfig?.systemStabilityApiKey) return state.privateSystemConfig.systemStabilityApiKey;
    return process.env.STABILITY_API_KEY || null;
}

export function getElevenlabsApiKey(): string | null {
    if (state.elevenlabsApiKey) return state.elevenlabsApiKey;
    if (state.privateSystemConfig?.systemElevenlabsApiKey) return state.privateSystemConfig.systemElevenlabsApiKey;
    return null;
}

export function getAi33ApiKey(): string | null {
    if (state.ai33ApiKey) return state.ai33ApiKey;
    if (state.privateSystemConfig?.systemAi33ApiKey) return state.privateSystemConfig.systemAi33ApiKey;
    return null;
}

export function getGradioTtsApiUrl(): string | null {
    if (state.gradioTtsApiUrl) return state.gradioTtsApiUrl;
    if (state.privateSystemConfig?.systemGradioTtsUrl) return state.privateSystemConfig.systemGradioTtsUrl;
    return null;
}

let instantTimestampCache: { available: boolean; checkedAt: number } | null = null;

export async function canUseInstantTimestamps(): Promise<boolean> {
    const now = Date.now();
    
    if (instantTimestampCache && now - instantTimestampCache.checkedAt < 300000) {
        return instantTimestampCache.available;
    }
    
    const available = !!getElevenlabsApiKey() && state.useInstantTimestamps;
    instantTimestampCache = { available, checkedAt: now };
    
    return available;
}

export async function pollAi33Task(
    taskId: string, 
    apiKey: string, 
    options?: {
        textLength?: number;
        onProgress?: (progress: number) => void;
    },
    signal?: AbortSignal
): Promise<any> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!taskId) throw new Error('Task ID is required for polling');
    
    if (taskId.startsWith('srt-')) {
        const srtText = sessionStorage.getItem(taskId);
        sessionStorage.removeItem(taskId);
        if (!srtText) throw new Error('SRT data not found for mock task');
        return { status: 'done', metadata: { srt_url: `data:text/plain;base64,${btoa(srtText)}` } };
    }

    const maxAttempts = 120;
    const textLength = options?.textLength || 1000;
    
    const estimatedDuration = Math.max(textLength / 15, 30);
    const maxWaitTime = Math.max(Math.min(estimatedDuration * 2, 300) * 1000, 60000);
    
    const startTime = Date.now();
    const delays = [500, 1000, 1500, 2000, 3000];
    let consecutiveErrors = 0;
    
    for (let i = 0; i < maxAttempts; i++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        options?.onProgress?.(i / maxAttempts);

        if (Date.now() - startTime > maxWaitTime) {
            throw new Error(`Task ${taskId} exceeded ${maxWaitTime/1000}s timeout`);
        }
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
            
            let response = await fetch(`https://api.ai33.pro/v1/task/${taskId}`, {
                headers: { 'xi-api-key': apiKey },
                signal: controller.signal
            });
            if (!response.ok && response.status === 404) {
                // Support v3 task endpoint if v1 404s
                const v3Res = await fetch(`https://api.ai33.pro/v3/task/${taskId}`, {
                    headers: { 'xi-api-key': apiKey },
                    signal: controller.signal
                }).catch(() => null);
                if (v3Res && v3Res.ok) response = v3Res;
            }
            
            clearTimeout(timeoutId);
            consecutiveErrors = 0;
            
            if (!response.ok) {
                if (response.status === 404 && i < 5) {
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
                throw new Error(`AI33 Server Error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.status === 'done' || data.status === 'success' || data.status === 'completed' || data.state === 'done' || data.state === 'success') {
                return data;
            }
            
            if (data.status === 'failed' || data.status === 'error' || data.state === 'failed' || data.state === 'error') {
                throw new Error(`AI33 Task failed: ${data.error?.message || data.error || data.message || 'Unknown error'}`);
            }
            
        } catch (e: any) {
            if (e.name === 'AbortError' && signal?.aborted) throw e;
            consecutiveErrors++;
            
            if (e.name === 'AbortError') {
                console.warn(`Task ${taskId}: fetch timeout at attempt ${i + 1}`);
            }
            
            if (consecutiveErrors >= 5) {
                throw new Error(`Task polling failed after ${consecutiveErrors} consecutive errors`);
            }
            
            if (i === maxAttempts - 1) throw e;
        }
        
        const baseDelay = delays[Math.min(i, delays.length - 1)];
        const jitter = Math.random() * 500;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(resolve, baseDelay + jitter);
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new DOMException('Aborted', 'AbortError'));
                }, { once: true });
            }
        });
    }
    
    throw new Error(`Task ${taskId} timed out after ${maxAttempts} attempts`);
}

export async function ai33SpeechToText(file: File, apiKey: string): Promise<{taskid: string}> {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch(`https://api.ai33.pro/v1/task/speech-to-text`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData
    });
    
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`STT task failed (${res.status}): ${errorText.substring(0, 200)}`);
    }
    
    const contentType = res.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
        const text = await res.text();
        
        try {
            const data = JSON.parse(text);
            const taskid = data.taskid || data.task_id;
            if (!taskid) throw new Error("API response missing task ID");
            return { taskid };
        } catch (e: any) {
            console.error('Failed to parse JSON:', text.substring(0, 500));
            throw new Error(`Invalid JSON from AI33 STT: ${e.message}`);
        }
    } else {
        const srtText = await res.text();
        const mockTaskId = `srt-${Date.now()}`;
        sessionStorage.setItem(mockTaskId, srtText);
        return { taskid: mockTaskId };
    }
}

export async function parseSrtToWords(srtText: string, buffer: AudioBuffer): Promise<WordTimestamp[]> {
  const cues = srtText.trim().split('\n\n').map(block => {
    const lines = block.split('\n');
    if (lines.length < 2) return null;
    const time = lines[1].split(' --> ');
    if (time.length < 2) return null;
    const start = timeToSeconds(time[0]);
    const end = timeToSeconds(time[1]);
    const text = lines.slice(2).join(' ');
    return { start, end, text };
  }).filter((cue): cue is {start: number, end: number, text: string} => !!(cue && cue.text.trim()));

  return cues.flatMap(cue => {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const duration = cue.end - cue.start;
    const timePerWord = duration / words.length;
    return words.map((word, i) => ({
      word,
      start: cue.start + i * timePerWord,
      end: Math.min(cue.start + (i+1) * timePerWord, cue.end)
    }));
  });
}

export async function getElevenLabsModels(): Promise<any[]> {
    const elKey = getElevenlabsApiKey();
    const ai33Key = getAi33ApiKey();
    const apiKey = elKey || ai33Key;
    if (!apiKey) throw new Error("API key not set.");
    const url = elKey ? 'https://api.elevenlabs.io/v1/models' : 'https://api.ai33.pro/v1/models';
    const response = await fetch(url, { headers: { 'xi-api-key': apiKey } });
    if (!response.ok) throw new Error('Failed to fetch models.');
    return response.json();
}

export async function getVoiceInfo(voiceId: string): Promise<any> {
    const ai33Key = getAi33ApiKey();
    const elKey = getElevenlabsApiKey();
    let lastError: Error | null = null;

    if (elKey) {
        try {
            const url = `https://api.elevenlabs.io/v1/voices/${voiceId}`;
            const response = await fetch(url, { headers: { 'xi-api-key': elKey } });
            if (response.ok) {
                const data = await response.json();
                data.sourceProvider = 'elevenlabs';
                return data;
            }
            lastError = new Error(`ElevenLabs lookup failed (${response.status})`);
        } catch (e: any) {
            lastError = e;
        }
    }

    if (ai33Key) {
        try {
            const url = `https://api.ai33.pro/v1/voices/${voiceId}`;
            const response = await fetch(url, { headers: { 'xi-api-key': ai33Key } });
            if (response.ok) {
                const data = await response.json();
                data.sourceProvider = 'ai33';
                return data;
            }
            lastError = new Error(`AI33 lookup failed (${response.status})`);
        } catch (e: any) {
            lastError = e;
        }
    }

    if (!ai33Key && !elKey) {
        throw new Error("No AI33 or ElevenLabs API key is set.");
    }
    throw new Error(`Voice ID "${voiceId}" not found. ${lastError?.message || ''}`);
}

export async function getElevenLabsVoices(): Promise<any[]> {
    const apiKey = getElevenlabsApiKey();
    if (!apiKey) return [];
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.voices || [];
    } catch (e) { return []; }
}

export interface Ai33Voice {
    voice_id: string;
    name: string;
    language?: string;
    gender?: string;
    tags?: string[];
    preview_url?: string;
    provider?: string;
}

export async function getAi33Voices(
    provider: 'edge' | 'kokoro' | 'minimax' | 'clone' | 'elevenlabs' | 'vbee' | 'fishaudio' = 'edge',
    limit = 50,
    search?: string
): Promise<Ai33Voice[]> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) return [];
    try {
        let url = `https://api.ai33.pro/v3/voices?provider=${encodeURIComponent(provider)}&limit=${limit}&page=1`;
        if (search) url += `&q=${encodeURIComponent(search)}`;
        const response = await fetch(url, {
            headers: { 'xi-api-key': apiKey }
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
            return data.data.map((v: any) => ({
                voice_id: v.voice_id || v.id,
                name: v.name || v.voice_name || v.voice_id,
                language: v.language || '',
                gender: v.gender || '',
                tags: v.tags || [],
                preview_url: v.preview_url || '',
                provider
            }));
        }
        return [];
    } catch (e) {
        console.warn(`Failed to fetch AI33 voices for provider ${provider}:`, e);
        return [];
    }
}

export async function getAi33Clones(): Promise<any[]> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) return [];
    try {
        // v3 normalized voice library for cloned voices
        const v3Clones = await getAi33Voices('clone', 100);
        if (v3Clones.length > 0) {
            return v3Clones.map(v => ({
                voice_id: v.voice_id.startsWith('clone_') ? v.voice_id : `clone_${v.voice_id}`,
                voice_name: v.name || v.voice_id,
                preview_url: v.preview_url
            }));
        }
    } catch (e) {
        console.warn('AI33 v3 clone fetch fallback to v1m:', e);
    }

    // Fallback to v1m
    try {
        const response = await fetch('https://api.ai33.pro/v1m/voice/clone', { headers: { 'xi-api-key': apiKey } });
        if (!response.ok) return [];
        const data = await response.json();
        return data.success ? data.data : [];
    } catch (e) { return []; }
}

export async function getMinimaxClones(): Promise<any[]> {
    return getAi33Clones();
}

export async function cloneAi33Voice(params: {
    audio_file: File;
    voice_name: string;
}): Promise<{ voice_id: string }> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) throw new Error("AI33 API key missing.");

    // AI33 v3 unified endpoint: POST /v3/text-to-speech/voice-clone
    const formData = new FormData();
    formData.append('voice_name', params.voice_name);
    formData.append('audio_file', params.audio_file);

    const response = await fetch('https://api.ai33.pro/v3/text-to-speech/voice-clone', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData
    });

    const data = await response.json().catch(() => ({}));
    if (!data.success) {
        throw new Error(data.message || data.error || "AI33 v3 voice cloning failed.");
    }

    const rawId = data.data?.voice_id || data.voice_id || data.data?.id;
    if (!rawId) throw new Error("Voice cloning succeeded but no voice_id was returned.");
    const finalId = String(rawId).startsWith('clone_') ? String(rawId) : `clone_${rawId}`;
    return { voice_id: finalId };
}

export async function deleteAi33CloneVoice(voiceCloneId: string): Promise<boolean> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) throw new Error("AI33 API key missing.");
    const cleanId = voiceCloneId.replace(/^clone_/, '');
    const response = await fetch(`https://api.ai33.pro/v3/text-to-speech/voice-clone/${encodeURIComponent(cleanId)}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': apiKey }
    });
    const data = await response.json().catch(() => ({}));
    return !!data.success;
}

export async function cloneMinimaxVoice(params: {
    file: File;
    voice_name: string;
    language?: string;
    gender?: string;
    preview_text?: string;
    noise_reduction?: boolean;
}): Promise<{ voice_id: string }> {
    try {
        // Preferred AI33 v3 voice cloning
        return await cloneAi33Voice({ audio_file: params.file, voice_name: params.voice_name });
    } catch (v3Err: any) {
        console.warn('AI33 v3 voice cloning fallback to v1m:', v3Err.message);
        const apiKey = getAi33ApiKey();
        if (!apiKey) throw new Error("AI33 API key missing.");
        const formData = new FormData();
        formData.append('file', params.file);
        formData.append('voice_name', params.voice_name);
        if (params.language) formData.append('language', params.language);
        if (params.gender) formData.append('gender', params.gender);
        if (params.preview_text) formData.append('preview_text', params.preview_text);
        if (params.noise_reduction !== undefined) formData.append('noise_reduction', String(params.noise_reduction));
        const response = await fetch('https://api.ai33.pro/v1m/voice/clone', {
            method: 'POST',
            headers: { 'xi-api-key': apiKey },
            body: formData
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.message || "Cloning failed.");
        return data.data;
    }
}

export async function cloneElevenLabsVoice(params: {
    file: File;
    voice_name: string;
}): Promise<{ voice_id: string }> {
    if (!state.elevenlabsApiKey) throw new Error("Direct ElevenLabs API key is missing. Cloning via ElevenLabs is only available with a direct API key.");
    const formData = new FormData();
    formData.append('files', params.file);
    formData.append('name', params.voice_name);
    
    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: {
            'xi-api-key': state.elevenlabsApiKey
        },
        body: formData
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.detail?.message || data?.message || "ElevenLabs cloning failed.");
    }
    if (!data.voice_id) throw new Error("Voice cloning succeeded but no voice_id was returned.");
    return { voice_id: `elevenlabs_${data.voice_id}` };
}

export async function generateSpeechAi33V3(
    text: string,
    voiceId: string,
    options?: {
        speed?: number;
        withTranscript?: boolean;
        fileName?: string;
        pronunciationDictionaryId?: number;
    },
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; words?: WordTimestamp[]; rawAudioUrl?: string }> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) throw new Error("AI33 API key is missing.");

    // AI33 v3 voice_id must have a provider prefix:
    // elevenlabs_, minimax_, clone_, edge_, kokoro_, vbee_, or fishaudio_
    let finalVoiceId = voiceId.trim();
    const knownPrefixes = ['elevenlabs_', 'minimax_', 'clone_', 'edge_', 'kokoro_', 'vbee_', 'fishaudio_'];
    const hasPrefix = knownPrefixes.some(p => finalVoiceId.startsWith(p));
    if (!hasPrefix) {
        if (/^\d+$/.test(finalVoiceId)) {
            finalVoiceId = `clone_${finalVoiceId}`;
        } else {
            finalVoiceId = `minimax_${finalVoiceId}`;
        }
    }

    const formData = new FormData();
    formData.append('text', text);
    formData.append('voice_id', finalVoiceId);
    if (options?.speed !== undefined) {
        const clampedSpeed = Math.min(Math.max(options.speed, 0.5), 1.5);
        formData.append('speed', clampedSpeed.toString());
    } else {
        formData.append('speed', '1');
    }
    formData.append('with_transcript', options?.withTranscript ? 'true' : 'false');
    if (options?.fileName) {
        formData.append('file_name', options.fileName);
    }
    if (options?.pronunciationDictionaryId) {
        formData.append('pronunciation_dictionary_id', options.pronunciationDictionaryId.toString());
    }

    const response = await fetch('https://api.ai33.pro/v3/text-to-speech', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData,
        signal
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`AI33 v3 TTS Error (${response.status}): ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success && !data.task_id) {
        throw new Error(data.message || data.error || "AI33 v3 TTS request failed.");
    }

    const taskId = data.task_id || data.taskId || data.taskid;
    if (!taskId) throw new Error("AI33 v3 response missing task_id");

    const result = await pollAi33Task(taskId, apiKey, { textLength: text.length }, signal);
    const audioUrl = (
        result.metadata?.audiourl ||
        result.metadata?.audio_url ||
        result.metadata?.wavurl ||
        result.data?.url ||
        result.data?.audio_url ||
        result.data?.audiourl ||
        result.url ||
        result.audio_url
    ) as string;

    if (!audioUrl) {
        throw new Error("AI33 v3 task completed but no audio URL was returned.");
    }

    const audioData = await (await fetch(audioUrl, { signal })).arrayBuffer();
    const buffer = await safeDecode(getAudioContext(), audioData);

    let words: WordTimestamp[] | undefined = undefined;
    const srtUrl = (
        result.metadata?.srt_url ||
        result.data?.srt_url ||
        result.data?.transcript_url ||
        result.transcript_url ||
        result.srt_url
    ) as string | undefined;

    if (srtUrl && options?.withTranscript) {
        try {
            const srtRes = await fetch(srtUrl, { signal });
            if (srtRes.ok) {
                const srtText = await srtRes.text();
                words = await parseSrtToWords(srtText, buffer);
            }
        } catch (srtErr) {
            console.warn('Failed to fetch/parse AI33 transcript SRT:', srtErr);
        }
    }

    return { buffer, words, rawAudioUrl: audioUrl };
}

export async function generateDialogueAi33V3(
    text: string,
    speakers: Array<{ voice_id: string; speed?: number }>,
    options?: {
        delay?: number;
        withTranscript?: boolean;
    },
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; words?: WordTimestamp[] }> {
    const apiKey = getAi33ApiKey();
    if (!apiKey) throw new Error("AI33 API key missing.");

    const formData = new FormData();
    formData.append('text', text);
    formData.append('speakers', JSON.stringify(speakers));
    formData.append('delay', (options?.delay ?? 0.3).toString());
    formData.append('with_transcript', options?.withTranscript ? 'true' : 'false');

    const response = await fetch('https://api.ai33.pro/v3/text-to-speech/dialogue', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData,
        signal
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`AI33 v3 Dialogue Error (${response.status}): ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (!data.success && !data.task_id) {
        throw new Error(data.message || "AI33 v3 dialogue request failed.");
    }

    const taskId = data.task_id || data.taskId || data.taskid;
    const result = await pollAi33Task(taskId, apiKey, { textLength: text.length }, signal);
    const audioUrl = (
        result.metadata?.audiourl ||
        result.metadata?.audio_url ||
        result.data?.url ||
        result.data?.audio_url ||
        result.data?.audiourl ||
        result.url
    ) as string;

    const audioData = await (await fetch(audioUrl, { signal })).arrayBuffer();
    const buffer = await safeDecode(getAudioContext(), audioData);

    return { buffer };
}

export async function generateSpeechMinimax(
    text: string, 
    voiceId: string, 
    speed: number, 
    pitch: number, 
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; words?: WordTimestamp[] }> {
    try {
        // Prefer unified AI33 v3
        const prefixedVoiceId = (voiceId.startsWith('minimax_') || voiceId.startsWith('clone_') || voiceId.startsWith('edge_') || voiceId.startsWith('kokoro_') || voiceId.startsWith('elevenlabs_')) 
            ? voiceId 
            : `minimax_${voiceId}`;
        const v3Result = await generateSpeechAi33V3(text, prefixedVoiceId, { speed, withTranscript: true }, signal);
        return { buffer: v3Result.buffer, words: v3Result.words };
    } catch (v3Err: any) {
        console.warn('AI33 v3 TTS failed, falling back to v1m:', v3Err.message);
        const apiKey = getAi33ApiKey();
        if (!apiKey) throw new Error("AI33 key missing.");
        const response = await fetch('https://api.ai33.pro/v1m/task/text-to-speech', {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text, model: "speech-2.6-hd",
                voice_setting: { voice_id: voiceId.replace(/^minimax_/, ''), vol: 1, speed, pitch: Math.round(pitch * 1.66) }
            }),
            signal
        });
        if (!response.ok) throw new Error(`Status: ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error(`${data.message}: Task failed.`);
        const result = await pollAi33Task(data.taskid || data.task_id, apiKey, { textLength: text.length }, signal);
        const audioUrl = (result.metadata?.audiourl || result.data?.url || result.url) as string;
        const audioData = await (await fetch(audioUrl, { signal })).arrayBuffer();
        return { buffer: await safeDecode(getAudioContext(), audioData) };
    }
}

export interface EdgeVoice {
    shortName: string;
    displayName: string;
    locale: string;
    gender: string;
    isPopular?: boolean;
}

let edgeVoicesCache: EdgeVoice[] | null = null;

/** Free Microsoft Edge neural voices (served by our backend, 300+ voices, no API key). */
export async function getEdgeVoices(): Promise<EdgeVoice[]> {
    if (edgeVoicesCache && edgeVoicesCache.length > 0) return edgeVoicesCache;
    try {
        const response = await fetch('/api/edge-tts/voices');
        if (!response.ok) return [];
        const data = await response.json();
        const voices: EdgeVoice[] = Array.isArray(data?.voices) ? data.voices : [];
        if (voices.length > 0) edgeVoicesCache = voices;
        return voices;
    } catch (e) {
        console.warn('Failed to load Edge TTS voices:', e);
        return [];
    }
}

export async function generateSpeechEdge(
    text: string,
    voiceId: string,
    speed: number,
    pitch: number,
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer }> {
    const voice = voiceId.replace(/^(msedge_|edge_)/, '');
    const response = await fetch('/api/edge-tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, rate: speed, pitch }),
        signal
    });
    if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.details || `Edge TTS failed (${response.status})`);
    }
    const audioData = await response.arrayBuffer();
    const buffer = await safeDecode(getAudioContext(), audioData);
    return { buffer };
}

export async function generateSpeechGradio(
    text: string,
    provider: 'gradio_custom' | 'gradio_design' | 'gradio_clone',
    params: {
        voiceName?: string;
        instruction?: string;
        voiceDescription?: string;
        referenceAudio?: File;
        refTranscript?: string;
        useFastMode?: boolean;
    },
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer }> {
    const apiUrl = getGradioTtsApiUrl();
    if (!apiUrl) {
        throw new Error("Gradio TTS API URL is not set in Advanced Settings.");
    }
    
    const formData = new FormData();
    formData.append('apiUrl', apiUrl);
    formData.append('text', text);
    formData.append('provider', provider);
    
    if (params.voiceName) formData.append('voiceName', params.voiceName);
    if (params.instruction) formData.append('instruction', params.instruction);
    if (params.voiceDescription) formData.append('voiceDescription', params.voiceDescription);
    if (params.refTranscript) formData.append('refTranscript', params.refTranscript);
    if (params.useFastMode !== undefined) formData.append('useFastMode', String(params.useFastMode));
    if (params.referenceAudio) {
        formData.append('referenceAudio', params.referenceAudio);
    }
    
    const response = await fetch('/api/gradio', {
        method: 'POST',
        body: formData,
        signal
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server Error: ${errText}`);
    }
    
    const audioData = await response.arrayBuffer();
    const buffer = await safeDecode(getAudioContext(), audioData);
    
    return { buffer };
}

export async function generateSpeechElevenLabs(
    text: string,
    voiceId: string,
    modelId: string,
    rate: number,
    stability: number,
    similarity: number,
    style: number,
    provider: 'ai33' | 'elevenlabs' = 'elevenlabs',
    withTimestamps: boolean = false,
    signal?: AbortSignal
): Promise<{ buffer: AudioBuffer; words?: WordTimestamp[] }> {
    const cacheKey = getElevenLabsRequestKey(text, voiceId, provider, { rate, stability, similarity, style, withTimestamps });
    if (elevenlabsRequestCache.has(cacheKey)) {
        return elevenlabsRequestCache.get(cacheKey)!;
    }

    const requestPromise = (async () => {
        let finalApiKey: string | null = null;
        let finalProvider: 'ai33' | 'elevenlabs' = provider;

        if (provider === 'elevenlabs') {
            if (state.elevenlabsApiKey) {
                finalApiKey = state.elevenlabsApiKey;
                finalProvider = 'elevenlabs';
            } else if (state.ai33ApiKey) {
                finalApiKey = state.ai33ApiKey;
                finalProvider = 'ai33';
            }
        } else {
            finalApiKey = state.ai33ApiKey;
            finalProvider = 'ai33';
        }

        if (!finalApiKey) throw new Error("Key missing.");

        if (finalProvider === 'ai33') {
            try {
                const prefixedId = voiceId.startsWith('elevenlabs_') ? voiceId : `elevenlabs_${voiceId}`;
                const res = await generateSpeechAi33V3(text, prefixedId, { speed: 1, withTranscript: withTimestamps }, signal);
                return { buffer: res.buffer, words: res.words };
            } catch (v3Err) {
                console.warn('AI33 v3 TTS fallback to v1 in generateSpeechElevenLabs:', v3Err);
            }
        }

        const cleanVoiceId = voiceId.replace(/^elevenlabs_/, '');
        let url = finalProvider === 'ai33'
            ? `https://api.ai33.pro/v1/text-to-speech/${voiceId}`
            : `https://api.elevenlabs.io/v1/text-to-speech/${cleanVoiceId}`;

        const useTimestamps = withTimestamps && finalProvider === 'elevenlabs';
        if (useTimestamps) {
            url += '?output_format=json_v2';
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'xi-api-key': finalApiKey,
                'Content-Type': 'application/json',
                'Accept': useTimestamps ? 'application/json' : 'audio/mpeg'
            },
            body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability, similarity_boost: similarity, style, use_speaker_boost: true } }),
            signal
        });

        if (!response.ok) {
            let errorMsg = `ElevenLabs/AI33 API Error: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData?.detail?.message) errorMsg = errorData.detail.message;
                else if (errorData?.message) errorMsg = errorData.message;
            } catch (e) {
                // Ignore json parse error
            }
            if (response.status === 404) errorMsg = `Voice not found or access denied. ${errorMsg}`;
            throw new Error(errorMsg);
        }

        if (useTimestamps) {
            const data = await response.json();
            if (!data.audio_base64) throw new Error("Instant timestamp response missing audio.");

            const audioData = decode(data.audio_base64).buffer as ArrayBuffer;
            const buffer = await safeDecode(getAudioContext(), audioData);

            const words = data.alignment?.word_timestamps || [];
            return { buffer, words };
        }

        if (finalProvider === 'ai33') {
            const data = await response.json();
            if (!data.task_id && !data.taskid) {
                throw new Error(`AI33 Error: ${data.message || 'No task ID in response'}`);
            }

            const taskId = data.task_id || data.taskid;
            const result = await pollAi33Task(taskId, finalApiKey, { textLength: text.length }, signal);
            const audioUrl = (result.metadata.audio_url || result.metadata.audiourl || result.metadata.wavurl) as string;
            const audioData = await (await fetch(audioUrl, { signal })).arrayBuffer();
            
            const buffer = await safeDecode(getAudioContext(), audioData);
            return { buffer };
        }

        const audioData = await response.arrayBuffer();
        return { buffer: await safeDecode(getAudioContext(), audioData) };
    })();
    
    elevenlabsRequestCache.set(cacheKey, requestPromise);
    requestPromise.finally(() => {
        setTimeout(() => elevenlabsRequestCache.delete(cacheKey), 2000);
    });

    return requestPromise;
}
