import type { Scene, AspectRatio } from './types';
import { timelineState } from './state-timeline';
import { BASE_PIXELS_PER_SECOND } from './utils';

export function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}


export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bitDepth = 16;
    const dataLength = buffer.length * numChannels * 2;
    const bufferLength = 44 + dataLength;

    const headerBuffer = new ArrayBuffer(44);
    const view = new DataView(headerBuffer);
    const writeString = (v: DataView, offset: number, string: string) => { for (let i = 0; i < string.length; i++) v.setUint8(offset + i, string.charCodeAt(i)); };
    
    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4; 
    view.setUint32(offset, 36 + dataLength, true); offset += 4; 
    writeString(view, offset, 'WAVE'); offset += 4; 
    writeString(view, offset, 'fmt '); offset += 4; 
    view.setUint32(offset, 16, true); offset += 4; 
    view.setUint16(offset, 1, true); offset += 2; 
    view.setUint16(offset, numChannels, true); offset += 2; 
    view.setUint32(offset, sampleRate, true); offset += 4; 
    view.setUint32(offset, sampleRate * numChannels * 2, true); offset += 4; 
    view.setUint16(offset, numChannels * 2, true); offset += 2; 
    view.setUint16(offset, bitDepth, true); offset += 2; 
    writeString(view, offset, 'data'); offset += 4; 
    view.setUint32(offset, dataLength, true); offset += 4;

    const parts: BlobPart[] = [headerBuffer];
    const chunkSize = sampleRate * 5; // 5 seconds chunk
    
    for (let start = 0; start < buffer.length; start += chunkSize) {
        const len = Math.min(chunkSize, buffer.length - start);
        const pcm16 = new Int16Array(len * numChannels);
        
        if (numChannels === 2) {
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            for (let i = 0; i < len; i++) {
                const sl = Math.max(-1, Math.min(1, left[start + i]));
                const sr = Math.max(-1, Math.min(1, right[start + i]));
                pcm16[i * 2] = sl < 0 ? sl * 0x8000 : sl * 0x7FFF;
                pcm16[i * 2 + 1] = sr < 0 ? sr * 0x8000 : sr * 0x7FFF;
            }
        } else {
            const ch = buffer.getChannelData(0);
            for (let i = 0; i < len; i++) {
                const s = Math.max(-1, Math.min(1, ch[start + i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
        }
        parts.push(pcm16.buffer);
    }
    
    return new Blob(parts, { type: 'audio/wav' });
}


export const pacingMap = {
    "documentary": { min: 1, max: 2 },   // 30–60s per cut (1–2 cuts/min)
    "glacial": { min: 2, max: 3 },       // 20–30s per cut (2–3 cuts/min)
    "snail": { min: 3, max: 4 },         // 15–20s per cut (3–4 cuts/min)
    "very_slow": { min: 4, max: 5 },     // 12–15s per cut (4–5 cuts/min)
    "slow": { min: 5, max: 8 },          // 7.5–12s per cut (5–8 cuts/min)
    "normal": { min: 8, max: 12 },       // 5–7.5s per cut (8–12 cuts/min)
    "fast": { min: 12, max: 20 }         // 3–5s per cut (12–20 cuts/min)
};


export interface DebouncedFunction<T extends (...args: any[]) => void> {
    (...args: Parameters<T>): void;
    flush: () => void;
    cancel: () => void;
}

export function debounce<T extends (...args: any[]) => void>(func: T, timeout = 2000): DebouncedFunction<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastArgs: Parameters<T> | undefined;

    const debounced = (...args: Parameters<T>) => {
        lastArgs = args;
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            func(...args);
        }, timeout);
    };

    debounced.flush = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
            if (lastArgs !== undefined) {
                func(...lastArgs);
            }
        }
    };

    debounced.cancel = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };

    return debounced;
}


export function getPixelsPerSecond(): number {
    return BASE_PIXELS_PER_SECOND * timelineState.zoomLevel;
}


export function getGuest320pResolutionKey(aspectRatio: AspectRatio = '16:9'): string {
    switch (aspectRatio) {
        case '9:16': return '9x16-320p';
        case '1:1': return '1x1-320p';
        case '4:3': return '4x3-320p';
        case '3:4': return '3x4-320p';
        case '16:9':
        default:
            return '320p';
    }
}


export function getMatchingResolutionKey(aspectRatio: AspectRatio = '16:9', currentKey?: string): string {
    if (currentKey && EXPORT_RESOLUTION_MAP[currentKey]) {
        // If current key is a 320p guest key, map across aspect ratios properly
        if (currentKey.includes('320p')) {
            return getGuest320pResolutionKey(aspectRatio);
        }

        // If the key's aspect ratio matches, keep it (e.g. user chose 9x16-4k or 9x16-sd)
        if (EXPORT_RESOLUTION_MAP[currentKey].aspectRatio === aspectRatio) {
            return currentKey;
        }

        // Quality preserving mapping across aspect ratios
        const is4k = currentKey === '4k' || currentKey.includes('4k');
        if (is4k) {
            if (aspectRatio === '16:9') return '4k';
            if (aspectRatio === '9:16') return '9x16-4k';
            if (aspectRatio === '1:1') return '1x1-4k';
            if (aspectRatio === '4:3') return '4x3-4k';
            if (aspectRatio === '3:4') return '3x4-4k';
        }

        const isSd = currentKey === '720p' || currentKey.includes('sd');
        if (isSd) {
            if (aspectRatio === '16:9') return '720p';
            if (aspectRatio === '9:16') return '9x16-sd';
            if (aspectRatio === '1:1') return '1x1-sd';
            if (aspectRatio === '4:3') return '4x3-sd';
            if (aspectRatio === '3:4') return '3x4-sd';
        }

        // Default to standard HD / 1080p across aspect ratios
        if (aspectRatio === '16:9') return '1080p';
        if (aspectRatio === '9:16') return '9x16-hd';
        if (aspectRatio === '1:1') return '1x1-hd';
        if (aspectRatio === '4:3') return '4x3-hd';
        if (aspectRatio === '3:4') return '3x4-hd';
    }
    return getDefaultResolutionKeyForAspectRatio(aspectRatio);
}


export const EXPORT_RESOLUTION_MAP: { [key: string]: { width: number; height: number; aspectRatio: AspectRatio; label: string } } = {
    // 16:9 Landscape
    '1080p': { width: 1920, height: 1080, aspectRatio: '16:9', label: '1080p Full HD (1920×1080)' },
    '4k': { width: 3840, height: 2160, aspectRatio: '16:9', label: '4K Ultra HD (3840×2160)' },
    '720p': { width: 1280, height: 720, aspectRatio: '16:9', label: '720p HD (1280×720)' },
    '320p': { width: 568, height: 320, aspectRatio: '16:9', label: '320p Preview (568×320) - Watermarked' },
    
    // 9:16 Vertical (Shorts / Reels / TikTok)
    '9x16-hd': { width: 1080, height: 1920, aspectRatio: '9:16', label: '1080p Vertical (1080×1920)' },
    '9x16-4k': { width: 2160, height: 3840, aspectRatio: '9:16', label: '4K Vertical (2160×3840)' },
    '9x16-sd': { width: 720, height: 1280, aspectRatio: '9:16', label: '720p Vertical (720×1280)' },
    '9x16-320p': { width: 320, height: 568, aspectRatio: '9:16', label: '320p Vertical (320×568) - Watermarked' },
    
    // 1:1 Square
    '1x1-4k': { width: 2160, height: 2160, aspectRatio: '1:1', label: '4K Square (2160×2160)' },
    '1x1-hd': { width: 1080, height: 1080, aspectRatio: '1:1', label: '1080p Square (1080×1080)' },
    '1x1-sd': { width: 720, height: 720, aspectRatio: '1:1', label: '720p Square (720×720)' },
    '1x1-320p': { width: 320, height: 320, aspectRatio: '1:1', label: '320p Square (320×320) - Watermarked' },

    // 4:3 Standard
    '4x3-4k': { width: 2880, height: 2160, aspectRatio: '4:3', label: '4K Classic (2880×2160)' },
    '4x3-hd': { width: 1440, height: 1080, aspectRatio: '4:3', label: '1080p Classic (1440×1080)' },
    '4x3-sd': { width: 1024, height: 768, aspectRatio: '4:3', label: '1024×768 Standard (4:3)' },
    '4x3-320p': { width: 426, height: 320, aspectRatio: '4:3', label: '320p Classic (426×320) - Watermarked' },

    // 3:4 Portrait
    '3x4-4k': { width: 2160, height: 2880, aspectRatio: '3:4', label: '4K Portrait (2160×2880)' },
    '3x4-hd': { width: 1080, height: 1440, aspectRatio: '3:4', label: '1080p Portrait (1080×1440)' },
    '3x4-sd': { width: 768, height: 1024, aspectRatio: '3:4', label: '768×1024 Portrait (3:4)' },
    '3x4-320p': { width: 320, height: 426, aspectRatio: '3:4', label: '320p Portrait (320×426) - Watermarked' },
};


export function getShotRange(wordCount: number, pacingFactor: string) {
    const minutes = Math.max(0.1, wordCount / 150);
    // @ts-ignore
    const range = pacingMap[pacingFactor] || pacingMap["normal"];
    return { min: Math.max(1, Math.round(minutes * range.min)), max: Math.max(1, Math.round(minutes * range.max)) };
}


export function safeJsonStringify(obj: any, space?: number | string): string {
    try {
        const cleaned = safeCloneClean(obj);
        const res = JSON.stringify(cleaned, null, space);
        if (res !== undefined) return res;
        return Array.isArray(obj) ? '[]' : '{}';
    } catch (e) {
        console.warn('safeJsonStringify exception caught, returning fallback:', e);
        return Array.isArray(obj) ? '[]' : '{}';
    }
}


export function getDefaultResolutionKeyForAspectRatio(aspectRatio: AspectRatio = '16:9'): string {
    switch (aspectRatio) {
        case '9:16': return '9x16-hd';
        case '1:1': return '1x1-hd';
        case '4:3': return '4x3-hd';
        case '3:4': return '3x4-hd';
        case '16:9':
        default:
            return '1080p';
    }
}


export function safeCloneClean(obj: any, maxDepth: number = 25): any {
    const activeAncestors = new WeakSet();
    const memo = new WeakMap();

    function clone(val: any, depth: number): any {
        if (depth > maxDepth) return undefined;
        if (val === null || typeof val !== 'object') {
            if (typeof val === 'function' || typeof val === 'symbol') return undefined;
            if (typeof val === 'bigint') return val.toString();
            return val;
        }

        // Check for active ancestor circular reference loop
        if (activeAncestors.has(val)) {
            return undefined;
        }

        // Return memoized clone for DAG / shared non-circular references
        if (memo.has(val)) {
            return memo.get(val);
        }

        activeAncestors.add(val);
        try {
            const clonedObj = cloneObject(val, depth);
            if (clonedObj !== undefined) {
                memo.set(val, clonedObj);
            }
            return clonedObj;
        } finally {
            activeAncestors.delete(val);
        }
    }

    function cloneObject(val: any, depth: number): any {
        // Check for DOM elements / media / canvas / buffers / native host objects
        if (typeof Element !== 'undefined' && val instanceof Element) return undefined;
        if (typeof Node !== 'undefined' && val instanceof Node) return undefined;
        if (typeof Window !== 'undefined' && val instanceof Window) return undefined;
        if (typeof Document !== 'undefined' && val instanceof Document) return undefined;
        if ('nodeType' in val || 'tagName' in val || 'ownerDocument' in val) return undefined;
        if ('sampleRate' in val && 'numberOfChannels' in val && 'getChannelData' in val) return undefined;
        if (typeof HTMLImageElement !== 'undefined' && val instanceof HTMLImageElement) return undefined;
        if (typeof HTMLVideoElement !== 'undefined' && val instanceof HTMLVideoElement) return undefined;
        if (typeof HTMLCanvasElement !== 'undefined' && val instanceof HTMLCanvasElement) return undefined;
        if (typeof AudioBuffer !== 'undefined' && val instanceof AudioBuffer) return undefined;

        const cName = val.constructor?.name;
        if (cName && (
            cName.includes('Element') ||
            cName.includes('Node') ||
            cName.includes('Context') ||
            cName.includes('Canvas') ||
            cName.includes('Audio') ||
            cName.includes('Buffer') ||
            cName.includes('Stream') ||
            cName === 'Q' ||
            cName === 'Sa' ||
            cName === 'UserImpl' ||
            cName === 'AuthImpl' ||
            cName === 'UserInfoImpl' ||
            cName === 'FirebaseApp' ||
            cName === 'Firestore'
        )) {
            return undefined;
        }

        if (Array.isArray(val)) {
            const arrRes: any[] = [];
            for (let i = 0; i < val.length; i++) {
                const item = clone(val[i], depth + 1);
                arrRes.push(item === undefined ? null : item);
            }
            return arrRes;
        }

        if (val instanceof Date) return val.toISOString();
        if (val instanceof RegExp) return undefined;
        if (val instanceof Map) {
            const mapObj: any = {};
            for (const [k, v] of val.entries()) {
                if (typeof k === 'string') {
                    const child = clone(v, depth + 1);
                    if (child !== undefined) mapObj[k] = child;
                }
            }
            return mapObj;
        }
        if (val instanceof Set) {
            return Array.from(val).map(v => clone(v, depth + 1)).filter(v => v !== undefined);
        }

        const res: any = {};
        for (const k of Object.keys(val)) {
            if (k.startsWith('_nameRegex')) {
                continue;
            }
            try {
                const child = clone(val[k], depth + 1);
                if (child !== undefined) {
                    res[k] = child;
                }
            } catch {
                // skip unreadable or throwing property
            }
        }
        return res;
    }
    return clone(obj, 0);
}


/**
 * Calculates a natural spoken cadence placeholder duration for a storyboard shot.
 * Uses ~2.4 words per second (144 WPM standard narration rate).
 * Clamps short fragments/pauses to 3.5s and bounds duration between 2.5s and 14.0s.
 */
export function calculatePlaceholderDuration(text: string): number {
    const trimmed = (text || '').trim();
    if (!trimmed) return 3.5;
    const words = trimmed.split(/\s+/).filter(Boolean).length;
    if (words < 3) return 3.5;
    const rawSeconds = words / 2.4;
    const endsOnBeat = /[.!?…—]\s*$/.test(trimmed);
    const multiplier = endsOnBeat ? 1.1 : 1.0;
    const clamped = Math.max(2.5, Math.min(14.0, rawSeconds * multiplier));
    return Number(clamped.toFixed(1));
}


/**
 * Paragraph-aware and sentence-safe chunker for long scripts (>1,800–2,000 words).
 * Splits on double newlines (\n\n) or sentence boundaries, never cutting dialogue or mid-sentence.
 */
export function splitScriptIntoStoryChunks(text: string, maxWordsPerChunk: number = 1800): string[] {
    const cleanText = text.replace(/\r\n/g, '\n').trim();
    if (!cleanText) return [];

    const rawParagraphs = cleanText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (rawParagraphs.length === 0) return [cleanText];

    const atomicUnits: string[] = [];
    for (const para of rawParagraphs) {
        const paraWords = para.split(/\s+/).filter(Boolean).length;
        if (paraWords > maxWordsPerChunk) {
            // Split long paragraph safely on sentence boundaries
            const sentences = para.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
            if (sentences.length > 0) {
                atomicUnits.push(...sentences);
            } else {
                atomicUnits.push(para);
            }
        } else {
            atomicUnits.push(para);
        }
    }

    const chunks: string[] = [];
    let currentChunkUnits: string[] = [];
    let currentWordCount = 0;

    for (const unit of atomicUnits) {
        const unitWords = unit.split(/\s+/).filter(Boolean).length;
        if (currentChunkUnits.length > 0 && currentWordCount + unitWords > maxWordsPerChunk) {
            chunks.push(currentChunkUnits.join('\n\n').trim());
            currentChunkUnits = [unit];
            currentWordCount = unitWords;
        } else {
            currentChunkUnits.push(unit);
            currentWordCount += unitWords;
        }
    }

    if (currentChunkUnits.length > 0) {
        chunks.push(currentChunkUnits.join('\n\n').trim());
    }

    return chunks;
}


