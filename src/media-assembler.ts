/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import * as utils from './utils';
import { assetStorage } from './assetStorage';
import { updateVideoContext, normalizeTimeline } from './videoController';
import { drawVideoFrame } from './videoRenderer';
import { saveVersion } from './handlers-project';
import { updateMasterAudioUI } from './masterAudioDirector';
import { loadAndShowWaveform } from './audioWaveformVisualizer';
import { transcribeAudioLocal } from './api/audio';
import { generateContentWithFallback, stripCodeFence } from './api/core';
import { PRIMARY_MODEL } from './constants';
import { Type } from "@google/genai";
import type { CinematicShot } from './types';

export type AssemblyMode = 'ambient_loop' | 'distribute_even' | 'speech_sync' | 'native_duration';

export interface VisualClipItem {
    id: string;
    file: File;
    type: 'video' | 'image';
    name: string;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: string;
    objectUrl: string;
    videoElement?: HTMLVideoElement;
    customTags?: string;
}

// Module State
let activeAudioFile: File | null = null;
let activeAudioBuffer: AudioBuffer | null = null;
let activeAudioDuration: number = 0;
let activeAudioName: string = '';
let activeAudioObjectURL: string | null = null;
let isUsingExistingProjectAudio = false;

let visualClips: VisualClipItem[] = [];
let currentAssemblyMode: AssemblyMode = 'ambient_loop';

let previewAudioSource: AudioBufferSourceNode | null = null;
let previewAudioStartCtxTime = 0;
let previewAudioOffset = 0;
let isAudioPlaying = false;

function toggleAudioPreviewPlayback() {
    const playBtn = document.getElementById('assembler-audio-play-btn');
    if (!activeAudioBuffer || activeAudioDuration <= 0) {
        ui.showStatus('Please upload or select an audio file to preview.', false, 2500);
        return;
    }

    const audioCtx = utils.getAudioContext();

    if (isAudioPlaying) {
        // Pause audio
        if (previewAudioSource) {
            const elapsed = audioCtx.currentTime - previewAudioStartCtxTime;
            previewAudioOffset += Math.max(0, elapsed);
            try {
                previewAudioSource.stop();
                previewAudioSource.disconnect();
            } catch {}
            previewAudioSource = null;
        }
        isAudioPlaying = false;
        if (playBtn) playBtn.innerHTML = '<span>▶️</span> <span>Play</span>';
    } else {
        // Resume / Start Audio
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }

        if (previewAudioOffset >= activeAudioBuffer.duration - 0.1) {
            previewAudioOffset = 0;
        }

        try {
            const source = audioCtx.createBufferSource();
            source.buffer = activeAudioBuffer;
            source.connect(audioCtx.destination);

            source.onended = () => {
                if (previewAudioSource === source) {
                    isAudioPlaying = false;
                    previewAudioOffset = 0;
                    previewAudioSource = null;
                    if (playBtn) playBtn.innerHTML = '<span>▶️</span> <span>Play</span>';
                }
            };

            previewAudioStartCtxTime = audioCtx.currentTime;
            source.start(0, previewAudioOffset);
            previewAudioSource = source;
            isAudioPlaying = true;
            if (playBtn) playBtn.innerHTML = '<span>⏸️</span> <span>Pause</span>';
        } catch (playErr: any) {
            console.error('Failed to play audio preview:', playErr);
            ui.showStatus(`Playback error: ${playErr.message}`, true, 3000);
        }
    }
}

function stopAudioPreview() {
    if (previewAudioSource) {
        try {
            previewAudioSource.stop();
            previewAudioSource.disconnect();
        } catch {}
        previewAudioSource = null;
    }
    isAudioPlaying = false;
    previewAudioOffset = 0;
    const playBtn = document.getElementById('assembler-audio-play-btn');
    if (playBtn) playBtn.innerHTML = '<span>▶️</span> <span>Play</span>';
}

let mediaAssemblerInitialized = false;

export function initMediaAssembler() {
    if (mediaAssemblerInitialized) return;
    mediaAssemblerInitialized = true;
    // Setup modal event listeners
    const modal = document.getElementById('media-assembler-modal');
    const openBtn1 = document.getElementById('step1-open-media-assembler-btn');
    const openBtn2 = document.getElementById('manual-open-media-assembler-btn');
    const openBtn3 = document.getElementById('master-open-media-assembler-btn');
    const openBtnToolbar = document.getElementById('toolbar-media-assembler-btn');
    const closeBtn = document.getElementById('close-media-assembler-modal-btn');
    const cancelBtn = document.getElementById('media-assembler-cancel-btn');
    const assembleBtn = document.getElementById('media-assembler-submit-btn');

    openBtn1?.addEventListener('click', () => openMediaAssemblerModal());
    openBtn2?.addEventListener('click', () => openMediaAssemblerModal());
    openBtn3?.addEventListener('click', () => openMediaAssemblerModal());
    openBtnToolbar?.addEventListener('click', () => openMediaAssemblerModal());
    closeBtn?.addEventListener('click', closeMediaAssemblerModal);
    cancelBtn?.addEventListener('click', closeMediaAssemblerModal);
    assembleBtn?.addEventListener('click', handleExecuteAssembly);

    // Audio file picker & dropzone
    const audioInput = document.getElementById('assembler-audio-input') as HTMLInputElement;
    const audioDropzone = document.getElementById('assembler-audio-dropzone');
    const audioChooseBtn = document.getElementById('assembler-choose-audio-btn');
    const audioRemoveBtn = document.getElementById('assembler-remove-audio-btn');
    const audioPlayBtn = document.getElementById('assembler-audio-play-btn');

    audioChooseBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        audioInput?.click();
    });

    audioDropzone?.addEventListener('click', () => {
        audioInput?.click();
    });

    audioInput?.addEventListener('change', async (e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            await handleAudioFileSelected(input.files[0]);
            input.value = '';
        }
    });

    audioRemoveBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSelectedAudio();
    });

    audioPlayBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAudioPreviewPlayback();
    });

    // Audio dropzone drag-and-drop
    if (audioDropzone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            audioDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioDropzone.classList.add('border-indigo-400', 'bg-indigo-950/60');
            });
        });
        ['dragleave', 'drop'].forEach(eventName => {
            audioDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                audioDropzone.classList.remove('border-indigo-400', 'bg-indigo-950/60');
            });
        });
        audioDropzone.addEventListener('drop', async (e: DragEvent) => {
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type.startsWith('audio/') || file.type.startsWith('video/')) {
                    await handleAudioFileSelected(file);
                } else {
                    ui.showStatus('Please drop an audio or video file for the soundtrack.', true, 3000);
                }
            }
        });
    }

    // Visual clips file picker & dropzone
    const visualsInput = document.getElementById('assembler-visuals-input') as HTMLInputElement;
    const visualsDropzone = document.getElementById('assembler-visuals-dropzone');
    const visualsChooseBtn = document.getElementById('assembler-choose-visuals-btn');
    const visualsClearAllBtn = document.getElementById('assembler-clear-visuals-btn');
    const visualsShuffleBtn = document.getElementById('assembler-shuffle-visuals-btn');

    visualsChooseBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        visualsInput?.click();
    });

    visualsDropzone?.addEventListener('click', (e) => {
        // Prevent click if clicking inner buttons
        if ((e.target as HTMLElement).closest('button')) return;
        visualsInput?.click();
    });

    visualsInput?.addEventListener('change', async (e: Event) => {
        const input = e.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
            await handleVisualFilesSelected(Array.from(input.files));
            input.value = '';
        }
    });

    visualsClearAllBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllVisualClips();
    });

    visualsShuffleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        shuffleVisualClips();
    });

    if (visualsDropzone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            visualsDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                visualsDropzone.classList.add('border-indigo-400', 'bg-indigo-950/40');
            });
        });
        ['dragleave', 'drop'].forEach(eventName => {
            visualsDropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                visualsDropzone.classList.remove('border-indigo-400', 'bg-indigo-950/40');
            });
        });
        visualsDropzone.addEventListener('drop', async (e: DragEvent) => {
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                await handleVisualFilesSelected(Array.from(e.dataTransfer.files));
            }
        });
    }

    // Assembly Mode Cards
    const modeCards = document.querySelectorAll('.assembler-mode-card');
    modeCards.forEach(card => {
        card.addEventListener('click', () => {
            const mode = card.getAttribute('data-mode') as AssemblyMode;
            if (mode) {
                setAssemblyMode(mode);
            }
        });
    });

    // Custom Mode Controls Listeners
    const loopPaceSelect = document.getElementById('assembler-loop-pace-select') as HTMLSelectElement;
    loopPaceSelect?.addEventListener('change', updateAssemblyEstimates);

    const montagePaceSelect = document.getElementById('assembler-montage-pace-select') as HTMLSelectElement;
    montagePaceSelect?.addEventListener('change', updateAssemblyEstimates);
}

export function openMediaAssemblerModal(initialMode: AssemblyMode = 'ambient_loop') {
    const modal = document.getElementById('media-assembler-modal');
    if (!modal) return;

    // Check if project already has master audio linked
    const existingBuffer = timelineState.masterAudioBuffer || state.uploadedAudioBuffer;
    if (existingBuffer && existingBuffer.duration > 0) {
        activeAudioBuffer = existingBuffer;
        activeAudioDuration = existingBuffer.duration;
        activeAudioName = state.uploadedAudioFileName || 'Current Project Audio';
        isUsingExistingProjectAudio = true;
        renderAudioSection();
    } else {
        isUsingExistingProjectAudio = false;
        renderAudioSection();
    }

    setAssemblyMode(initialMode);
    renderVisualsList();
    updateAssemblyEstimates();

    modal.classList.remove('hidden');
}

export function closeMediaAssemblerModal() {
    const modal = document.getElementById('media-assembler-modal');
    if (modal) modal.classList.add('hidden');
    stopAudioPreview();
}

function setAssemblyMode(mode: AssemblyMode) {
    currentAssemblyMode = mode;
    const modeCards = document.querySelectorAll('.assembler-mode-card');
    modeCards.forEach(card => {
        const cardMode = card.getAttribute('data-mode');
        const isSelected = cardMode === mode;
        if (isSelected) {
            card.classList.add('border-indigo-500', 'bg-indigo-950/60', 'ring-1', 'ring-indigo-500/50');
            card.classList.remove('border-gray-800', 'bg-gray-900/50');
            const radio = card.querySelector('input[type="radio"]') as HTMLInputElement;
            if (radio) radio.checked = true;
        } else {
            card.classList.remove('border-indigo-500', 'bg-indigo-950/60', 'ring-1', 'ring-indigo-500/50');
            card.classList.add('border-gray-800', 'bg-gray-900/50');
            const radio = card.querySelector('input[type="radio"]') as HTMLInputElement;
            if (radio) radio.checked = false;
        }
    });

    // Toggle mode specific settings panels
    const loopSettings = document.getElementById('assembler-settings-ambient-loop');
    const montageSettings = document.getElementById('assembler-settings-distribute-even');
    const speechSettings = document.getElementById('assembler-settings-speech-sync');
    const nativeSettings = document.getElementById('assembler-settings-native-duration');

    loopSettings?.classList.toggle('hidden', mode !== 'ambient_loop');
    montageSettings?.classList.toggle('hidden', mode !== 'distribute_even');
    speechSettings?.classList.toggle('hidden', mode !== 'speech_sync');
    nativeSettings?.classList.toggle('hidden', mode !== 'native_duration');

    updateAssemblyEstimates();
}

async function handleAudioFileSelected(file: File) {
    ui.showStatus(`Loading & decoding audio: ${file.name}...`, false, 2500);
    try {
        const audioCtx = utils.getAudioContext();
        const arrayBuf = await file.arrayBuffer();
        const decoded = await utils.safeDecode(audioCtx, arrayBuf);

        activeAudioFile = file;
        activeAudioBuffer = decoded;
        activeAudioDuration = decoded.duration;
        activeAudioName = file.name;
        isUsingExistingProjectAudio = false;

        if (activeAudioObjectURL) {
            URL.revokeObjectURL(activeAudioObjectURL);
        }
        activeAudioObjectURL = URL.createObjectURL(file);

        stopAudioPreview();
        renderAudioSection();
        updateAssemblyEstimates();
        ui.showStatus(`🎵 Audio loaded: ${activeAudioName} (${formatDuration(activeAudioDuration)})`, false, 3000);
    } catch (err: any) {
        console.error("Failed to decode audio file:", err);
        ui.showStatus(`Could not decode audio: ${err.message}`, true, 4000);
    }
}

function clearSelectedAudio() {
    stopAudioPreview();
    activeAudioFile = null;
    activeAudioBuffer = null;
    activeAudioDuration = 0;
    activeAudioName = '';
    isUsingExistingProjectAudio = false;
    if (activeAudioObjectURL) {
        URL.revokeObjectURL(activeAudioObjectURL);
        activeAudioObjectURL = null;
    }
    renderAudioSection();
    updateAssemblyEstimates();
}

function renderAudioSection() {
    const emptyState = document.getElementById('assembler-audio-empty-state');
    const loadedState = document.getElementById('assembler-audio-loaded-state');
    const nameEl = document.getElementById('assembler-audio-loaded-name');
    const durEl = document.getElementById('assembler-audio-loaded-dur');
    const tagEl = document.getElementById('assembler-audio-loaded-tag');

    if (!activeAudioBuffer || activeAudioDuration <= 0) {
        emptyState?.classList.remove('hidden');
        loadedState?.classList.add('hidden');
    } else {
        emptyState?.classList.add('hidden');
        loadedState?.classList.remove('hidden');

        if (nameEl) nameEl.textContent = activeAudioName || 'Audio Track';
        if (durEl) durEl.textContent = formatDuration(activeAudioDuration);
        if (tagEl) {
            tagEl.textContent = isUsingExistingProjectAudio ? 'Project Master Track' : 'New File';
            tagEl.className = isUsingExistingProjectAudio 
                ? 'text-[10px] bg-emerald-950 border border-emerald-500/40 text-emerald-300 font-mono px-2 py-0.5 rounded-full font-semibold'
                : 'text-[10px] bg-indigo-950 border border-indigo-500/40 text-indigo-300 font-mono px-2 py-0.5 rounded-full font-semibold';
        }
    }
}

function extractDefaultTagsFromFilename(filename: string): string {
    const clean = filename
        .replace(/\.[a-zA-Z0-9]+$/, '') // remove extension
        .replace(/^(IMG|VID|Pexels|Shutterstock|istock|clip|video|asset|footage|render)[_-]*/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase split
        .replace(/\b(1080p|4k|720p|hd|uhd|fps|h264|hevc|mov|mp4|webm|jpg|jpeg|png)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return clean;
}

const STOP_WORDS = new Set([
    'the', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us',
    'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'i', 'me', 'my', 'so', 'as',
    'if', 'then', 'else', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same',
    'than', 'too', 'very', 'just', 'but'
]);

const SYNONYM_GROUPS: Record<string, string[]> = {
    nature: ['nature', 'forest', 'tree', 'trees', 'woods', 'plant', 'plants', 'outdoor', 'mountain', 'mountains', 'river', 'lake', 'water', 'sky', 'clouds', 'sun', 'grass', 'landscape', 'scenic', 'wild', 'earth', 'environment', 'sunset', 'sunrise', 'dawn', 'dusk'],
    ocean: ['ocean', 'sea', 'beach', 'water', 'waves', 'shore', 'coast', 'coastline', 'sand', 'tropical', 'island', 'tide', 'marine', 'underwater', 'surf', 'boat', 'ship'],
    city: ['city', 'urban', 'downtown', 'street', 'streets', 'building', 'buildings', 'skyscraper', 'skyscrapers', 'traffic', 'cars', 'road', 'roads', 'highway', 'metropolis', 'subway', 'sidewalk', 'night', 'neon', 'architecture'],
    tech: ['tech', 'technology', 'code', 'coding', 'computer', 'laptop', 'developer', 'software', 'screen', 'cyber', 'digital', 'ai', 'data', 'robot', 'network', 'system', 'internet', 'device', 'keyboard', 'phone'],
    business: ['business', 'office', 'work', 'working', 'meeting', 'finance', 'money', 'chart', 'graph', 'growth', 'corporate', 'presentation', 'team', 'company', 'startup', 'strategy', 'success', 'market', 'trade', 'crypto', 'stock', 'invest'],
    person: ['person', 'people', 'man', 'woman', 'human', 'face', 'portrait', 'talking', 'speaker', 'interview', 'character', 'crowd', 'smile', 'look', 'looking', 'walk', 'walking', 'run', 'running'],
    calm: ['calm', 'peace', 'peaceful', 'relax', 'relaxing', 'sleep', 'sleeping', 'meditation', 'zen', 'quiet', 'slow', 'breathe', 'gentle', 'ambient', 'serene', 'lofi', 'dream'],
    action: ['action', 'fast', 'energy', 'fire', 'burn', 'explosion', 'fight', 'motion', 'speed', 'rush', 'jump', 'impact', 'power', 'dynamic', 'intense']
};

interface SentenceSegment {
    start: number;
    end: number;
    text: string;
}

interface PreparedAsset {
    item: VisualClipItem;
    assetId: string;
    objectUrl: string;
    duration: number;
}

function heuristicMatchVisuals(
    sentences: SentenceSegment[],
    assets: PreparedAsset[],
    descriptors: Array<{ index: number; id: string; name: string; type: string; keywords: string }>
): PreparedAsset[] {
    const result: PreparedAsset[] = [];
    let lastChosenIndex = -1;

    // Tokenize descriptors
    const assetTokenSets = descriptors.map(d => {
        const tokens = d.keywords
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2 && !STOP_WORDS.has(t));
        
        // Expand tokens with synonym groups
        const expandedTokens = new Set<string>(tokens);
        for (const [groupName, words] of Object.entries(SYNONYM_GROUPS)) {
            if (tokens.some(t => words.includes(t) || t === groupName)) {
                words.forEach(w => expandedTokens.add(w));
            }
        }
        return { index: d.index, tokens: Array.from(expandedTokens), rawTokens: tokens };
    });

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
        const sentence = sentences[sIdx];
        const sentenceWords = sentence.text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP_WORDS.has(w));

        let bestIndex = 0;
        let bestScore = -999;

        for (let aIdx = 0; aIdx < assetTokenSets.length; aIdx++) {
            const assetInfo = assetTokenSets[aIdx];
            let score = 0;

            // Direct word matches (high weight)
            for (const sw of sentenceWords) {
                if (assetInfo.rawTokens.includes(sw)) {
                    score += 5.0;
                } else if (assetInfo.tokens.includes(sw)) {
                    score += 2.0; // Synonym/category match
                }
            }

            // Variety penalty: reduce score if this was the immediately previous clip
            if (aIdx === lastChosenIndex && assetTokenSets.length > 1) {
                score -= 3.5;
            }

            // Small tie-breaker preference for video clips
            if (descriptors[aIdx].type === 'video') {
                score += 0.2;
            }

            if (score > bestScore) {
                bestScore = score;
                bestIndex = aIdx;
            }
        }

        // If no match at all, advance in round-robin sequence for visual diversity
        if (bestScore <= 0 && assetTokenSets.length > 1) {
            bestIndex = (lastChosenIndex + 1) % assetTokenSets.length;
        }

        result.push(assets[bestIndex]);
        lastChosenIndex = bestIndex;
    }

    return result;
}

async function extractImageThumbnail(file: File): Promise<string | null> {
    try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.src = url;
        await new Promise((res) => {
            img.onload = res;
            img.onerror = res;
            setTimeout(res, 2000);
        });
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 144;
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); return null; }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        return canvas.toDataURL('image/jpeg', 0.65);
    } catch {
        return null;
    }
}

/**
 * Intelligently matches visual clips to voiceover sentences / script lines.
 * Uses Gemini AI semantic classification (with multimodal visual recognition) and a fuzzy keyword cosine fallback.
 */
export async function matchVisualsToSentences(
    sentences: SentenceSegment[],
    assets: PreparedAsset[],
    useAi: boolean = true
): Promise<PreparedAsset[]> {
    if (!assets || assets.length === 0) return [];
    if (assets.length === 1) {
        return sentences.map(() => assets[0]);
    }

    // Prepare descriptors for each asset
    const assetDescriptors = assets.map((a, idx) => {
        const nameTokens = extractDefaultTagsFromFilename(a.item.name);
        const tags = a.item.customTags ? `${a.item.customTags}, ${nameTokens}` : nameTokens;
        return {
            index: idx,
            id: a.item.id,
            name: a.item.name,
            type: a.item.type,
            keywords: tags.toLowerCase()
        };
    });

    if (useAi) {
        try {
            const prompt = `You are an expert video director matching visual clips from a media library to narration sentences for a video.

Available Media Clips:
${assetDescriptors.map(d => `- Clip #${d.index} [ID: "${d.id}"]: "${d.name}" (${d.type}) -> Keywords/Topics: "${d.keywords}"`).join('\n')}

Narration Sentences in chronological order:
${sentences.map((s, i) => `[${i}] "${s.text.trim()}" (${(s.end - s.start).toFixed(1)}s)`).join('\n')}

INSTRUCTIONS:
1. For each narration sentence index 0..${sentences.length - 1}, assign the best-matching Clip # based on semantic meaning, visual content, setting, topic, or mood.
2. Even if filenames are generic or random (e.g. IMG_001, DSC_99), use the provided image thumbnails and keywords to match topics.
3. Aim for logical visual variety. Avoid repeating the exact same clip more than 2 times in a row unless there are very few clips.
4. Return ONLY a valid JSON object matching this schema:
{
  "matches": [
    { "sentenceIndex": 0, "clipIndex": 0, "reason": "matches topic" }
  ]
}`;

            const parts: any[] = [{ text: prompt }];

            // Include image thumbnails for multimodal recognition if filenames are generic or random
            const isGenericName = (name: string) => /^(img|dsc|dcim|screenshot|photo|video|clip|unnamed|file|\d+)[_-]/i.test(name) || /^\d+\./.test(name) || name.length < 8;
            for (const d of assetDescriptors.slice(0, 12)) {
                const asset = assets[d.index];
                if (asset?.item?.thumbnail && asset.item.thumbnail.startsWith('data:image/') && isGenericName(d.name)) {
                    const match = asset.item.thumbnail.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
                    if (match) {
                        parts.push({ text: `Visual preview thumbnail for Clip #${d.index} ("${d.name}"):` });
                        parts.push({
                            inlineData: {
                                mimeType: match[1],
                                data: match[2]
                            }
                        });
                    }
                }
            }

            const response = await generateContentWithFallback({
                contents: parts,
                model: PRIMARY_MODEL,
                systemInstruction: "You are a professional video editor specializing in semantic media assembly.",
                schema: {
                    type: Type.OBJECT,
                    properties: {
                        matches: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    sentenceIndex: { type: Type.INTEGER },
                                    clipIndex: { type: Type.INTEGER },
                                    reason: { type: Type.STRING }
                                },
                                required: ["sentenceIndex", "clipIndex"]
                            }
                        }
                    },
                    required: ["matches"]
                }
            });

            const parsedText = response?.text ? stripCodeFence(response.text) : "";
            if (parsedText) {
                const data = JSON.parse(parsedText);
                if (data && Array.isArray(data.matches) && data.matches.length > 0) {
                    const matchMap = new Map<number, number>();
                    data.matches.forEach((m: any) => {
                        if (typeof m.sentenceIndex === 'number' && typeof m.clipIndex === 'number') {
                            const validIndex = Math.max(0, Math.min(assets.length - 1, m.clipIndex));
                            matchMap.set(m.sentenceIndex, validIndex);
                        }
                    });

                    const matchedAssets: PreparedAsset[] = [];
                    for (let i = 0; i < sentences.length; i++) {
                        const chosenIdx = matchMap.has(i) ? matchMap.get(i)! : (i % assets.length);
                        matchedAssets.push(assets[chosenIdx]);
                    }
                    console.log("✨ [Media Assembler] Successfully AI-matched", matchedAssets.length, "visuals to narration text.");
                    return matchedAssets;
                }
            }
        } catch (aiErr) {
            console.warn("AI Semantic matching fallback to local heuristic:", aiErr);
        }
    }

    // Heuristic semantic & keyword matching fallback
    return heuristicMatchVisuals(sentences, assets, assetDescriptors);
}

async function handleVisualFilesSelected(files: File[]) {
    const validFiles = files.filter(f => f.type.startsWith('video/') || f.type.startsWith('image/'));
    if (validFiles.length === 0) {
        ui.showStatus('Please select valid MP4, MOV, WEBM, JPG, or PNG files.', true, 3000);
        return;
    }

    ui.showStatus(`Importing ${validFiles.length} visual asset(s)...`, false, 2000);

    for (const file of validFiles) {
        const isVideo = file.type.startsWith('video/');
        const objectUrl = URL.createObjectURL(file);
        const defaultTags = extractDefaultTagsFromFilename(file.name);
        const item: VisualClipItem = {
            id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            file,
            type: isVideo ? 'video' : 'image',
            name: file.name,
            customTags: defaultTags,
            objectUrl
        };

        if (isVideo) {
            try {
                const videoEl = document.createElement('video');
                videoEl.src = objectUrl;
                videoEl.crossOrigin = 'anonymous';
                videoEl.muted = true;
                videoEl.playsInline = true;
                videoEl.preload = 'metadata';

                await new Promise<void>((resolve) => {
                    videoEl.onloadedmetadata = () => {
                        item.duration = videoEl.duration || 4;
                        item.width = videoEl.videoWidth || 1920;
                        item.height = videoEl.videoHeight || 1080;
                        item.videoElement = videoEl;
                        resolve();
                    };
                    videoEl.onerror = () => {
                        item.duration = 4;
                        resolve();
                    };
                    setTimeout(resolve, 3000);
                });

                // Extract a poster frame for thumbnail preview
                const thumbnail = await extractVideoThumbnail(videoEl);
                if (thumbnail) item.thumbnail = thumbnail;
            } catch (vErr) {
                item.duration = 4;
            }
        } else {
            const thumb = await extractImageThumbnail(file);
            item.thumbnail = thumb || objectUrl;
            item.duration = 4;
        }

        visualClips.push(item);
    }

    renderVisualsList();
    updateAssemblyEstimates();
    ui.showStatus(`Added ${validFiles.length} visual clip(s) — total ${visualClips.length} in queue.`, false, 3000);
}

async function extractVideoThumbnail(videoEl: HTMLVideoElement): Promise<string | null> {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Seek slightly into video to avoid black intro frame
        videoEl.currentTime = Math.min(0.5, (videoEl.duration || 1) / 4);
        await new Promise((res) => {
            videoEl.onseeked = res;
            setTimeout(res, 400);
        });

        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.75);
    } catch {
        return null;
    }
}

function clearAllVisualClips() {
    visualClips.forEach(c => {
        if (c.objectUrl) URL.revokeObjectURL(c.objectUrl);
    });
    visualClips = [];
    renderVisualsList();
    updateAssemblyEstimates();
}

function shuffleVisualClips() {
    for (let i = visualClips.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [visualClips[i], visualClips[j]] = [visualClips[j], visualClips[i]];
    }
    renderVisualsList();
    updateAssemblyEstimates();
    ui.showStatus('🔀 Shuffled clip sequence.', false, 1500);
}

function removeVisualClip(id: string) {
    const idx = visualClips.findIndex(c => c.id === id);
    if (idx !== -1) {
        const item = visualClips[idx];
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        visualClips.splice(idx, 1);
        renderVisualsList();
        updateAssemblyEstimates();
    }
}

function renderVisualsList() {
    const container = document.getElementById('assembler-visuals-grid');
    const emptyState = document.getElementById('assembler-visuals-empty-state');
    const counterBadge = document.getElementById('assembler-visuals-count-badge');
    const totalDurationBadge = document.getElementById('assembler-visuals-total-dur-badge');

    if (counterBadge) counterBadge.textContent = `${visualClips.length} Clip${visualClips.length === 1 ? '' : 's'}`;

    const rawTotalSec = visualClips.reduce((acc, c) => acc + (c.duration || 4), 0);
    if (totalDurationBadge) totalDurationBadge.textContent = `Raw: ${formatDuration(rawTotalSec)}`;

    if (visualClips.length === 0) {
        emptyState?.classList.remove('hidden');
        if (container) container.innerHTML = '';
        return;
    }

    emptyState?.classList.add('hidden');
    if (!container) return;

    container.innerHTML = visualClips.map((clip, index) => {
        const isVideo = clip.type === 'video';
        const durText = isVideo ? formatDuration(clip.duration || 0) : 'IMAGE';
        const thumbSrc = clip.thumbnail || clip.objectUrl;

        return `
            <div class="relative group bg-gray-950/80 border border-gray-800 hover:border-indigo-500/60 rounded-lg overflow-hidden flex flex-col transition-all shadow-xs" data-clip-id="${clip.id}">
                <div class="relative aspect-video w-full bg-black/60 overflow-hidden flex items-center justify-center">
                    ${thumbSrc ? `<img src="${thumbSrc}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" alt="${escapeHtml(clip.name)}">` : `<span class="text-xl">${isVideo ? '🎬' : '🖼️'}</span>`}
                    <div class="absolute top-1 left-1 bg-black/80 backdrop-blur-xs text-[9px] font-mono font-bold text-gray-200 px-1.5 py-0.5 rounded border border-white/10">
                        #${index + 1}
                    </div>
                    <div class="absolute bottom-1 right-1 bg-black/80 backdrop-blur-xs text-[9px] font-mono font-bold text-amber-300 px-1.5 py-0.5 rounded border border-white/10">
                        ${durText}
                    </div>
                    <button class="assembler-delete-clip-btn absolute top-1 right-1 p-1 bg-red-950/90 text-red-300 hover:text-white hover:bg-red-700 rounded-md transition-opacity opacity-0 group-hover:opacity-100 cursor-pointer shadow-sm text-xs" title="Remove clip" data-remove-id="${clip.id}">
                        ✕
                    </button>
                </div>
                <div class="p-1.5 flex flex-col gap-1 text-[10px]">
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-gray-300 font-medium truncate" title="${escapeHtml(clip.name)}">${escapeHtml(clip.name)}</span>
                        <span class="text-[9px] ${isVideo ? 'text-sky-400 bg-sky-950/60' : 'text-emerald-400 bg-emerald-950/60'} font-semibold px-1 rounded uppercase shrink-0">${clip.type}</span>
                    </div>
                    <input type="text" class="assembler-clip-tag-input bg-black/60 border border-white/10 hover:border-white/20 focus:border-indigo-500 focus:bg-gray-900 rounded px-1.5 py-0.5 text-[9px] text-indigo-200 placeholder-gray-600 outline-none w-full transition" placeholder="Topic tags (e.g. sunset, beach)..." value="${escapeHtml(clip.customTags || '')}" data-clip-id="${clip.id}" title="Keywords/topics matched to narration speech">
                </div>
            </div>
        `;
    }).join('');

    // Wire up tag inputs
    container.querySelectorAll('.assembler-clip-tag-input').forEach(inputEl => {
        inputEl.addEventListener('input', (e) => {
            const input = e.target as HTMLInputElement;
            const id = input.getAttribute('data-clip-id');
            const clip = visualClips.find(c => c.id === id);
            if (clip) {
                clip.customTags = input.value;
            }
        });
    });

    // Wire up delete buttons
    container.querySelectorAll('.assembler-delete-clip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = (btn as HTMLElement).getAttribute('data-remove-id');
            if (id) removeVisualClip(id);
        });
    });
}

function updateAssemblyEstimates() {
    const estimateBadge = document.getElementById('assembler-summary-estimate-badge');
    const submitBtn = document.getElementById('media-assembler-submit-btn') as HTMLButtonElement;

    const audioDur = activeAudioDuration > 0 ? activeAudioDuration : 30;
    const clipCount = visualClips.length;

    let shotCount = 0;
    let avgShotDur = 0;
    let description = '';

    if (currentAssemblyMode === 'ambient_loop') {
        const loopPaceSelect = document.getElementById('assembler-loop-pace-select') as HTMLSelectElement;
        const targetPace = loopPaceSelect ? parseFloat(loopPaceSelect.value) || 12 : 12;
        shotCount = Math.max(1, Math.round(audioDur / targetPace));
        avgShotDur = audioDur / shotCount;
        description = `Seamless Sleep Loop: ${shotCount} shots (${avgShotDur.toFixed(1)}s each) repeating ${clipCount} clip(s) to fill ${formatDuration(audioDur)}. Subtitles off & gentle crossfades.`;
    } else if (currentAssemblyMode === 'distribute_even') {
        if (clipCount > 0) {
            shotCount = clipCount;
            avgShotDur = audioDur / clipCount;
            description = `Even Montage: ${shotCount} shots (${avgShotDur.toFixed(1)}s per clip) matching full audio duration of ${formatDuration(audioDur)}.`;
        } else {
            description = `Even Montage: Upload visual clips to distribute evenly across ${formatDuration(audioDur)}.`;
        }
    } else if (currentAssemblyMode === 'speech_sync') {
        description = `Voice & Script Sync: Transcribes narration timestamps & maps ${clipCount} clip(s) to sentence boundaries.`;
    } else if (currentAssemblyMode === 'native_duration') {
        const totalRaw = visualClips.reduce((acc, c) => acc + (c.duration || 4), 0);
        shotCount = clipCount;
        description = `Raw Clip Sequence: ${shotCount} shots totaling ${formatDuration(totalRaw)} sequence duration with master audio overlay.`;
    }

    if (estimateBadge) {
        estimateBadge.textContent = description;
    }

    if (submitBtn) {
        const canSubmit = (activeAudioBuffer !== null || visualClips.length > 0);
        submitBtn.disabled = !canSubmit;
        submitBtn.classList.toggle('opacity-50', !canSubmit);
    }
}

async function handleExecuteAssembly() {
    if (visualClips.length === 0 && !activeAudioBuffer) {
        ui.showStatus('Please upload at least an audio file or some visual clips.', true, 3000);
        return;
    }

    const modal = document.getElementById('media-assembler-modal');
    stopAudioPreview();

    // Read form settings
    const loopPaceSelect = document.getElementById('assembler-loop-pace-select') as HTMLSelectElement;
    const transitionSelect = document.getElementById('assembler-transition-select') as HTMLSelectElement;
    const aspectSelect = document.getElementById('assembler-aspect-select') as HTMLSelectElement;
    const enableKenBurnsCheckbox = document.getElementById('assembler-kenburns-checkbox') as HTMLInputElement;

    const transitionStyle = transitionSelect?.value || (currentAssemblyMode === 'ambient_loop' ? 'crossfade' : 'cut');
    const selectedAspect = aspectSelect?.value || '16:9';
    const enableKenBurns = enableKenBurnsCheckbox ? enableKenBurnsCheckbox.checked : (currentAssemblyMode === 'ambient_loop');

    // Update Project Aspect Ratio if user picked something different
    if (dom.imageResolutionSelect && selectedAspect) {
        dom.imageResolutionSelect.value = selectedAspect;
        dom.imageResolutionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (dom.studioAspectSelect && selectedAspect) {
        dom.studioAspectSelect.value = selectedAspect;
    }

    state.isVideoProductionRunning = true;
    await ui.openProcessingModal('Assembling Audio & Visual Media', true, 'Stop Assembly');
    ui.updateProcessingProgress(10, 'Persisting media assets to storage...');

    try {
        // Step 1: Save and register audio if newly uploaded
        let finalAudioBuffer: AudioBuffer;
        if (activeAudioBuffer) {
            finalAudioBuffer = activeAudioBuffer;
            if (activeAudioFile && !isUsingExistingProjectAudio) {
                const lightweightAudioFile = await utils.resampleAndEncodeAudio(finalAudioBuffer);
                const wavBlob = new Blob([lightweightAudioFile], { type: 'audio/wav' });
                const assetId = await assetStorage.storeAsset(wavBlob, 'audio');
                state.uploadedAudioBuffer = finalAudioBuffer;
                state.uploadedAudioAssetId = assetId;
                state.uploadedAudioFileName = activeAudioFile.name;
                updateMasterAudioUI(activeAudioFile.name, finalAudioBuffer.duration, '', 100);
                loadAndShowWaveform(finalAudioBuffer, wavBlob, activeAudioFile.name);
            }
        } else {
            // If no audio provided, create a neutral silent buffer matching visual clips length
            const totalVisualSec = Math.max(10, visualClips.reduce((acc, c) => acc + (c.duration || 4), 0));
            const ctx = utils.getAudioContext();
            finalAudioBuffer = ctx.createBuffer(2, Math.ceil(totalVisualSec * ctx.sampleRate), ctx.sampleRate);
            state.uploadedAudioBuffer = finalAudioBuffer;
        }

        timelineState.setMasterAudioBuffer(finalAudioBuffer);
        const totalAudioDuration = finalAudioBuffer.duration;

        ui.updateProcessingProgress(30, 'Storing video & image assets into local database...');

        // Step 2: Store visual clips into assetStorage
        const preparedAssets: Array<{
            item: VisualClipItem;
            assetId: string;
            objectUrl: string;
            duration: number;
        }> = [];

        for (let i = 0; i < visualClips.length; i++) {
            const clip = visualClips[i];
            ui.updateProcessingProgress(30 + Math.round((i / Math.max(1, visualClips.length)) * 30), `Storing clip ${i + 1}/${visualClips.length}: ${clip.name}...`);
            
            let assetId = '';
            try {
                assetId = await assetStorage.storeAsset(clip.file, clip.type);
            } catch (storeErr) {
                console.warn('Could not store clip asset in DB:', storeErr);
            }

            preparedAssets.push({
                item: clip,
                assetId,
                objectUrl: clip.objectUrl,
                duration: clip.duration || 4
            });
        }

        ui.updateProcessingProgress(65, 'Building storyboard shots and sequence tracks...');

        const newShots: CinematicShot[] = [];
        const newTimelineClips: any[] = [];
        let cursor = 0;

        if (currentAssemblyMode === 'ambient_loop') {
            // Mode 1: Ambient / Sleep Video Loop
            const paceValue = loopPaceSelect ? parseFloat(loopPaceSelect.value) || 12 : 12;
            const targetShotCount = Math.max(1, Math.round(totalAudioDuration / paceValue));
            const shotDuration = totalAudioDuration / targetShotCount;

            const pool = preparedAssets.length > 0 ? preparedAssets : [{
                item: { type: 'video' as const, name: 'Ambient Loop' } as any,
                assetId: '',
                objectUrl: '',
                duration: shotDuration
            }];

            for (let i = 0; i < targetShotCount; i++) {
                const asset = pool[i % pool.length];
                const shotId = `shot_ambient_${Date.now()}_${i}`;
                const isVideo = asset.item.type === 'video';

                let videoEl: HTMLVideoElement | undefined = undefined;
                if (isVideo && asset.objectUrl) {
                    try {
                        videoEl = await utils.loadVideoElement(asset.objectUrl);
                    } catch {}
                }

                let imgEl: HTMLImageElement | undefined = undefined;
                if (!isVideo && asset.objectUrl) {
                    try {
                        imgEl = await utils.loadImageOrThrow(asset.objectUrl);
                    } catch {}
                }

                const shot: CinematicShot = {
                    id: shotId,
                    shot_number: i + 1,
                    duration_seconds: shotDuration,
                    image_prompt: asset.item.name || `Ambient Scene ${i + 1}`,
                    text_reference: '',
                    camera_movement: enableKenBurns ? (i % 2 === 0 ? 'slow_zoom_in' : 'slow_pan_right') : 'static',
                    image_id: !isVideo ? asset.assetId : null,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    video_id: isVideo ? asset.assetId : null,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    videoStartOffset: 0,
                    talkingHeadMode: 'none'
                };

                newShots.push(shot);

                newTimelineClips.push({
                    id: shotId,
                    image: imgEl,
                    videoElement: videoEl,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    image_id: shot.image_id,
                    video_id: shot.video_id,
                    videoStartOffset: 0,
                    duration: shotDuration,
                    startTime: cursor,
                    endTime: cursor + shotDuration,
                    cameraMovement: shot.camera_movement,
                    talkingHeadMode: 'none',
                    transitionToNext: transitionStyle as any,
                    text: '',
                    wordTimestamps: [],
                    locked: false,
                    useOriginalAudio: false
                });

                cursor += shotDuration;
            }

            // Sleep mode default: Subtitles OFF
            timelineState.setShowSubtitles(false);
            if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = false;

        } else if (currentAssemblyMode === 'distribute_even') {
            // Mode 2: Even Distribution Montage
            const montageSemanticCheckbox = document.getElementById('assembler-montage-semantic-match-checkbox') as HTMLInputElement;
            const enableMontageSemantic = montageSemanticCheckbox ? montageSemanticCheckbox.checked : true;

            const shotCount = preparedAssets.length > 0 ? preparedAssets.length : 4;
            const shotDuration = totalAudioDuration / shotCount;

            // Check if story text or words exist to do semantic ordering
            let scriptSentences: SentenceSegment[] = [];
            const scriptText = dom.storyInput?.value?.trim();
            if (scriptText) {
                const rawLines = scriptText.split(/[.\n]+/).map(s => s.trim()).filter(s => s.length > 3);
                scriptSentences = rawLines.slice(0, shotCount).map((text, idx) => ({
                    start: idx * shotDuration,
                    end: (idx + 1) * shotDuration,
                    text
                }));
            }

            let orderedAssets = preparedAssets;
            if (enableMontageSemantic && scriptSentences.length > 0 && preparedAssets.length > 1) {
                ui.updateProcessingProgress(70, 'Aligning montage visual order to narrative script topics...');
                orderedAssets = await matchVisualsToSentences(scriptSentences, preparedAssets, true);
            }

            for (let i = 0; i < shotCount; i++) {
                const asset = orderedAssets[i] || preparedAssets[i % preparedAssets.length];
                const shotId = `shot_montage_${Date.now()}_${i}`;
                const isVideo = asset ? asset.item.type === 'video' : false;

                let videoEl: HTMLVideoElement | undefined = undefined;
                if (isVideo && asset?.objectUrl) {
                    try { videoEl = await utils.loadVideoElement(asset.objectUrl); } catch {}
                }

                let imgEl: HTMLImageElement | undefined = undefined;
                if (asset && !isVideo && asset.objectUrl) {
                    try { imgEl = await utils.loadImageOrThrow(asset.objectUrl); } catch {}
                }

                const matchedText = scriptSentences[i]?.text || '';
                const shot: CinematicShot = {
                    id: shotId,
                    shot_number: i + 1,
                    duration_seconds: shotDuration,
                    image_prompt: asset?.item.name ? `${asset.item.name}${matchedText ? ` — ${matchedText}` : ''}` : `Montage Shot ${i + 1}`,
                    text_reference: matchedText,
                    camera_movement: enableKenBurns ? (i % 2 === 0 ? 'slow_zoom_in' : 'static') : 'static',
                    image_id: asset && !isVideo ? asset.assetId : null,
                    _imageObjectURL: asset && !isVideo ? asset.objectUrl : undefined,
                    video_id: asset && isVideo ? asset.assetId : null,
                    _videoObjectURL: asset && isVideo ? asset.objectUrl : undefined,
                    videoStartOffset: 0,
                    talkingHeadMode: 'none'
                };

                newShots.push(shot);

                newTimelineClips.push({
                    id: shotId,
                    image: imgEl,
                    videoElement: videoEl,
                    _videoObjectURL: asset && isVideo ? asset.objectUrl : undefined,
                    _imageObjectURL: asset && !isVideo ? asset.objectUrl : undefined,
                    image_id: shot.image_id,
                    video_id: shot.video_id,
                    videoStartOffset: 0,
                    duration: shotDuration,
                    startTime: cursor,
                    endTime: cursor + shotDuration,
                    cameraMovement: shot.camera_movement,
                    talkingHeadMode: 'none',
                    transitionToNext: transitionStyle as any,
                    text: matchedText,
                    wordTimestamps: [],
                    locked: false,
                    useOriginalAudio: false
                });

                cursor += shotDuration;
            }

        } else if (currentAssemblyMode === 'native_duration') {
            // Mode 3: Native Video Clip Durations
            for (let i = 0; i < preparedAssets.length; i++) {
                const asset = preparedAssets[i];
                const shotId = `shot_native_${Date.now()}_${i}`;
                const isVideo = asset.item.type === 'video';
                const clipDur = asset.duration || 4;

                let videoEl: HTMLVideoElement | undefined = undefined;
                if (isVideo && asset.objectUrl) {
                    try { videoEl = await utils.loadVideoElement(asset.objectUrl); } catch {}
                }

                let imgEl: HTMLImageElement | undefined = undefined;
                if (!isVideo && asset.objectUrl) {
                    try { imgEl = await utils.loadImageOrThrow(asset.objectUrl); } catch {}
                }

                const shot: CinematicShot = {
                    id: shotId,
                    shot_number: i + 1,
                    duration_seconds: clipDur,
                    image_prompt: asset.item.name || `Scene ${i + 1}`,
                    text_reference: '',
                    camera_movement: 'static',
                    image_id: !isVideo ? asset.assetId : null,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    video_id: isVideo ? asset.assetId : null,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    videoStartOffset: 0,
                    talkingHeadMode: 'none'
                };

                newShots.push(shot);

                newTimelineClips.push({
                    id: shotId,
                    image: imgEl,
                    videoElement: videoEl,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    image_id: shot.image_id,
                    video_id: shot.video_id,
                    videoStartOffset: 0,
                    duration: clipDur,
                    startTime: cursor,
                    endTime: cursor + clipDur,
                    cameraMovement: 'static',
                    talkingHeadMode: 'none',
                    transitionToNext: transitionStyle as any,
                    text: '',
                    wordTimestamps: [],
                    locked: false,
                    useOriginalAudio: false
                });

                cursor += clipDur;
            }

        } else if (currentAssemblyMode === 'speech_sync') {
            // Mode 4: Voice / Speech Sync
            const semanticMatchCheckbox = document.getElementById('assembler-semantic-match-checkbox') as HTMLInputElement;
            const enableSemanticMatch = semanticMatchCheckbox ? semanticMatchCheckbox.checked : true;
            const enableSubtitlesCheckbox = document.getElementById('assembler-enable-subtitles-checkbox') as HTMLInputElement;
            const enableSubtitles = enableSubtitlesCheckbox ? enableSubtitlesCheckbox.checked : true;

            ui.updateProcessingProgress(70, 'Transcribing speech and extracting sentences...');
            let words = timelineState.globalWordTimestamps || state.masterAudioTranscript || [];
            
            if (words.length === 0 && activeAudioFile) {
                try {
                    const lightweightAudio = await utils.resampleAndEncodeAudio(finalAudioBuffer);
                    const wavBlob = new Blob([lightweightAudio], { type: 'audio/wav' });
                    const filePayload = new File([wavBlob], "transcribe.wav", { type: 'audio/wav' });
                    const res = await transcribeAudioLocal(filePayload);
                    if (res.words && res.words.length > 0) {
                        words = res.words;
                        timelineState.setGlobalWordTimestamps(words);
                    }
                } catch (tErr) {
                    console.warn("Assembler speech transcribe fallback:", tErr);
                }
            }

            const sentenceSegments: Array<{ start: number, end: number, text: string, words: typeof words }> = [];
            if (words.length > 0) {
                let curWords: typeof words = [];
                for (let i = 0; i < words.length; i++) {
                    curWords.push(words[i]);
                    const w = words[i].word.trim();
                    const isEnd = /[.?!]$/.test(w) || i === words.length - 1;
                    if (isEnd && curWords.length >= 2) {
                        sentenceSegments.push({
                            start: curWords[0].start,
                            end: curWords[curWords.length - 1].end,
                            text: curWords.map(x => x.word).join(' '),
                            words: [...curWords]
                        });
                        curWords = [];
                    }
                }
            }

            // If no transcript words found but story input exists, split script into sentences
            if (sentenceSegments.length === 0) {
                const storyText = dom.storyInput?.value?.trim();
                if (storyText) {
                    const rawLines = storyText.split(/(?<=[.?!])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 3);
                    if (rawLines.length > 0) {
                        const durPerLine = totalAudioDuration / rawLines.length;
                        for (let i = 0; i < rawLines.length; i++) {
                            sentenceSegments.push({
                                start: i * durPerLine,
                                end: (i + 1) * durPerLine,
                                text: rawLines[i],
                                words: []
                            });
                        }
                    }
                }
            }

            // If still no transcript found, create proportional cuts
            if (sentenceSegments.length === 0) {
                const count = Math.max(preparedAssets.length, 4);
                const dur = totalAudioDuration / count;
                for (let i = 0; i < count; i++) {
                    sentenceSegments.push({
                        start: i * dur,
                        end: (i + 1) * dur,
                        text: `Narration Segment ${i + 1}`,
                        words: []
                    });
                }
            }

            const pool = preparedAssets.length > 0 ? preparedAssets : [{
                item: { type: 'video' as const, name: 'Scene' } as any,
                assetId: '',
                objectUrl: '',
                duration: 4
            }];

            ui.updateProcessingProgress(78, 'Syncing visuals to narration keywords and meaning...');
            const matchedAssets = await matchVisualsToSentences(sentenceSegments, pool, enableSemanticMatch);

            for (let i = 0; i < sentenceSegments.length; i++) {
                const seg = sentenceSegments[i];
                const segDur = Math.max(1, seg.end - seg.start);
                const asset = matchedAssets[i] || pool[i % pool.length];
                const shotId = `shot_speech_${Date.now()}_${i}`;
                const isVideo = asset.item.type === 'video';

                let videoEl: HTMLVideoElement | undefined = undefined;
                if (isVideo && asset.objectUrl) {
                    try { videoEl = await utils.loadVideoElement(asset.objectUrl); } catch {}
                }

                let imgEl: HTMLImageElement | undefined = undefined;
                if (!isVideo && asset.objectUrl) {
                    try { imgEl = await utils.loadImageOrThrow(asset.objectUrl); } catch {}
                }

                const shot: CinematicShot = {
                    id: shotId,
                    shot_number: i + 1,
                    duration_seconds: segDur,
                    image_prompt: asset.item.name ? `${asset.item.name} — ${seg.text}` : seg.text,
                    text_reference: seg.text,
                    camera_movement: 'static',
                    image_id: !isVideo ? asset.assetId : null,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    video_id: isVideo ? asset.assetId : null,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    videoStartOffset: 0,
                    talkingHeadMode: 'none'
                };

                newShots.push(shot);

                newTimelineClips.push({
                    id: shotId,
                    image: imgEl,
                    videoElement: videoEl,
                    _videoObjectURL: isVideo ? asset.objectUrl : undefined,
                    _imageObjectURL: !isVideo ? asset.objectUrl : undefined,
                    image_id: shot.image_id,
                    video_id: shot.video_id,
                    videoStartOffset: 0,
                    duration: segDur,
                    startTime: seg.start,
                    endTime: seg.end,
                    cameraMovement: 'static',
                    talkingHeadMode: 'none',
                    transitionToNext: 'cut',
                    text: seg.text,
                    wordTimestamps: seg.words || [],
                    locked: false,
                    useOriginalAudio: false
                });
            }

            timelineState.setShowSubtitles(enableSubtitles);
            if (dom.videoSubtitlesCheckbox) dom.videoSubtitlesCheckbox.checked = enableSubtitles;
        }

        ui.updateProcessingProgress(90, 'Rendering video player canvas & director...');

        // Update Global State & Storyboard
        state.currentScenes = newShots;
        timelineState.setClips(newTimelineClips);
        timelineState.setGraphics([]);
        timelineState.setMode('audio_locked');
        timelineState.setVideoGenerated(true);
        timelineState.setDrawerUserOpen(true);

        normalizeTimeline(totalAudioDuration);
        updateVideoContext();

        // Render UI
        ui.renderResults(state.currentScenes);
        ui.renderTimelineEditor();

        // Activate Video Director & Export Buttons
        if (dom.videoCanvas) {
            dom.videoCanvas.classList.remove('hidden');
            dom.videoCanvas.style.display = 'block';
        }
        if (dom.videoPreGenerationOverlay) dom.videoPreGenerationOverlay.classList.add('hidden');
        if (dom.videoControlsContainer) dom.videoControlsContainer.classList.remove('hidden');
        if (dom.videoPostGenerationOverlay) dom.videoPostGenerationOverlay.classList.remove('hidden');

        if (dom.videoDirectorBtn) {
            dom.videoDirectorBtn.disabled = false;
            dom.videoDirectorBtn.classList.remove('opacity-50');
        }
        if (dom.videoExportBtn) dom.videoExportBtn.disabled = false;

        drawVideoFrame(0);
        await saveVersion(false);

        ui.updateWorkflowStepStatus(1, 'completed');
        ui.updateWorkflowStepStatus(2, 'completed');
        ui.updateWorkflowStepStatus(3, 'completed');
        ui.updateWorkflowStepStatus(4, 'active');

        ui.updateProcessingProgress(100, 'Assembly Complete!');
        ui.closeProcessingModal();
        closeMediaAssemblerModal();

        const modeLabel = currentAssemblyMode === 'ambient_loop' ? 'Sleep / Ambient Loop' : currentAssemblyMode === 'distribute_even' ? 'Montage' : currentAssemblyMode === 'speech_sync' ? 'Speech-Sync' : 'Sequence';
        ui.showStatus(`✨ Assembled ${newShots.length} shots (${modeLabel}) matching your audio! Press Play to preview.`, false, 4500);

    } catch (err: any) {
        console.error('Media Assembly Error:', err);
        ui.showStatus(`Assembly failed: ${err.message}`, true, 5000);
        ui.closeProcessingModal();
    } finally {
        state.isVideoProductionRunning = false;
    }
}

function formatDuration(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const remM = m % 60;
        return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function escapeHtml(str: string): string {
    return (str || '')
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
