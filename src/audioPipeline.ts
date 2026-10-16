import { audioBufferToWavBlob, safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import { getElevenLabsVoices, getMinimaxClones, getElevenLabsModels, cloneMinimaxVoice, getAi33Voices, getEdgeVoices } from './api/providers';
import { checkCredits, deductCredits } from './api/core';
import { forceAlignAudio, generateSpeechWithTimestamps } from './api/audio';
import * as utils from './utils';
import * as constants from './constants';
import { DB } from './db';
import { updateVideoContext } from './videoContextBridge';
import type { WordTimestamp } from './types';
import { assetStorage } from './assetStorage';
import { checkGuestRestriction } from './auth';

import {
    renderSavedVoicesInDropdown,
    renderStudioSavedVoicesList,
    switchVoiceStudioTab,
    handleRemoveCustomVoice, 
    handleCustomVoiceUIVisibility, 
    handleAddManualVoiceId, 
    handleToggleManualVoiceId,
    handleStudioSaveVoice,
    saveCustomVoice,
    removeCustomVoiceById,
    initVoiceProviderPillsAndListeners
} from './handlers-settings';

export { 
    handleRemoveCustomVoice, 
    handleCustomVoiceUIVisibility, 
    handleAddManualVoiceId, 
    handleToggleManualVoiceId,
    handleStudioSaveVoice,
    switchVoiceStudioTab,
    saveCustomVoice,
    removeCustomVoiceById,
    renderSavedVoicesInDropdown,
    renderStudioSavedVoicesList,
    initVoiceProviderPillsAndListeners
};


const activeRequests = new Map<string, Promise<any>>();

function getRequestKey(text: string, provider: string, voiceId: string): string {
    return `${provider}:${voiceId}:${utils.simpleHash(text)}`;
}

async function deduplicatedAudioRequest<T>(
    key: string,
    requestFn: () => Promise<T>
): Promise<T> {
    if (activeRequests.has(key)) {
        console.log(`🔄 Reusing in-flight request: ${key}`);
        return activeRequests.get(key)!;
    }

    const requestPromise = requestFn()
        .then(result => {
            // Keep successful result briefly so near-simultaneous callers can reuse it
            setTimeout(() => activeRequests.delete(key), 1000);
            return result;
        })
        .catch(err => {
            // Remove immediately on failure so the next caller gets a fresh attempt
            activeRequests.delete(key);
            throw err;
        });

    activeRequests.set(key, requestPromise);
    return requestPromise;
}

let isFetchingVoices = false;

export async function fetchAndPopulateVoices() {
    if (isFetchingVoices) return;
    isFetchingVoices = true;

    try {
        const ai33Key = state.ai33ApiKey;
        const elevenlabsKey = state.elevenlabsApiKey;
        const select = dom.narrationVoiceSelect;

        if (!select) return;

        // Remove any previously fetched dynamic groups so we start fresh.
        const prevValue = select.value;
        const hadDefaultOrEmpty = !prevValue || prevValue === 'Zephyr' || prevValue === '__ADD_CUSTOM_VOICE__';
        select.querySelectorAll('.dynamic-provider-group, #saved-custom-voices-group, #elevenlabs-voice-group, #edge-default-voices-group, #kokoro-default-voices-group').forEach(el => el.remove());

        // 1. Render user's saved custom voices (with unified provider prefixes and badges)
        renderSavedVoicesInDropdown();

        // 1a. Free Kokoro 82M Neural Personas (Instant & Zero Download)
        const kokoroGroup = document.createElement('optgroup');
        kokoroGroup.label = '🌸 Kokoro 82M · Expressive Personas (Free)';
        kokoroGroup.className = 'dynamic-provider-group kokoro-voice-group';
        kokoroGroup.innerHTML = `
            <option value="kokoro_af_heart" data-provider="kokoro">Heart (US Female - Ultra-Expressive)</option>
            <option value="kokoro_af_bella" data-provider="kokoro">Bella (US Female - Conversational)</option>
            <option value="kokoro_af_sarah" data-provider="kokoro">Sarah (US Female - Clear Professional)</option>
            <option value="kokoro_af_nicole" data-provider="kokoro">Nicole (US Female - Soothing)</option>
            <option value="kokoro_am_adam" data-provider="kokoro">Adam (US Male - Deep Resonant)</option>
            <option value="kokoro_am_michael" data-provider="kokoro">Michael (US Male - Casual)</option>
            <option value="kokoro_bf_emma" data-provider="kokoro">Emma (British Female - Refined)</option>
            <option value="kokoro_bf_isabella" data-provider="kokoro">Isabella (British Female - Warm)</option>
            <option value="kokoro_bm_george" data-provider="kokoro">George (British Male - Authoritative)</option>
            <option value="kokoro_bm_lewis" data-provider="kokoro">Lewis (British Male - Dynamic)</option>
        `;
        select.appendChild(kokoroGroup);

        // 1b. Free 300+ Edge Neural Voices (grouped by language)
        try {
            const edgeVoices = await getEdgeVoices();
            if (edgeVoices.length > 0) {
                const displayLang = typeof Intl !== 'undefined' && (Intl as any).DisplayNames
                    ? new (Intl as any).DisplayNames(['en'], { type: 'language' })
                    : null;
                const byLang = new Map<string, typeof edgeVoices>();
                for (const v of edgeVoices) {
                    const base = v.locale.split('-')[0];
                    let name = base;
                    try { name = displayLang?.of(base) || base; } catch {}
                    if (!byLang.has(name)) byLang.set(name, []);
                    byLang.get(name)!.push(v);
                }
                const langs = Array.from(byLang.keys()).sort((a, b) =>
                    a === 'English' ? -1 : b === 'English' ? 1 : a.localeCompare(b));
                for (const lang of langs) {
                    const group = document.createElement('optgroup');
                    group.label = `🆓 Edge TTS · ${lang} (No API Key)`;
                    group.className = 'dynamic-provider-group edge-voice-group';
                    for (const v of byLang.get(lang)!.sort((a, b) => {
                        const isNatA = a.shortName.includes('Ava') || a.shortName.includes('Brian') || a.shortName.includes('Andrew') || a.shortName.includes('Emma') || a.shortName.includes('Ryan') || a.shortName.includes('Sonia') || a.shortName.includes('Aria') || a.shortName.includes('Expressive') ? 0 : 1;
                        const isNatB = b.shortName.includes('Ava') || b.shortName.includes('Brian') || b.shortName.includes('Andrew') || b.shortName.includes('Emma') || b.shortName.includes('Ryan') || b.shortName.includes('Sonia') || b.shortName.includes('Aria') || b.shortName.includes('Expressive') ? 0 : 1;
                        if (isNatA !== isNatB) return isNatA - isNatB;
                        return a.locale.localeCompare(b.locale) || a.displayName.localeCompare(b.displayName);
                    })) {
                        const opt = document.createElement('option');
                        opt.value = `edge_${v.shortName}`;
                        opt.dataset.provider = 'edge';
                        let badge = '';
                        if ((v.shortName || '').toLowerCase().includes('multilingual')) {
                            badge = '🌐 ';
                        } else if (
                            v.shortName.includes('Ava') ||
                            v.shortName.includes('Brian') ||
                            v.shortName.includes('Andrew') ||
                            v.shortName.includes('Emma') ||
                            v.shortName.includes('Ryan') ||
                            v.shortName.includes('Sonia') ||
                            v.shortName.includes('Aria') ||
                            v.shortName.includes('Expressive')
                        ) {
                            badge = '⭐ ';
                        }
                        const parts = (v.locale || '').split('-');
                        const countryCode = parts.length > 1 ? parts[parts.length - 1] : '';
                        let flag = '';
                        if (countryCode && countryCode.length === 2) {
                            flag = String.fromCodePoint(...countryCode.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0))) + ' ';
                        }
                        let regName = v.locale;
                        try {
                            const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
                            const reg = regionNames.of(countryCode);
                            if (reg) regName = reg;
                        } catch {}
                        opt.textContent = `${badge}${flag}${v.displayName} (${regName} · ${v.gender})`;
                        group.appendChild(opt);
                    }
                    select.appendChild(group);
                }
            }
        } catch (e: any) {
            console.warn('Edge TTS voice sync failed:', e);
        }

        if (hadDefaultOrEmpty || !select.value) {
            select.value = 'edge_en-US-AvaNeural';
        }

        // 2. Fetch ElevenLabs voices if key is present
        if (elevenlabsKey) {
            try {
                const voices = await getElevenLabsVoices().catch(e => {
                    console.error('ElevenLabs voices fetch failed:', e);
                    return [];
                });

                if (voices.length > 0) {
                    const group = document.createElement('optgroup');
                    group.id = 'elevenlabs-voice-group';
                    group.label = "🎙️ Your ElevenLabs Account Voices";
                    group.className = "dynamic-provider-group";
                    group.innerHTML = voices.map((v: any) => `<option value="${v.voice_id}" data-provider="elevenlabs">${v.name}${v.category === 'cloned' ? ' (Clone)' : ''}</option>`).join('');
                    select.appendChild(group);
                }
            } catch (e: any) {
                console.error('ElevenLabs voice sync failed:', e);
            }
        }

        // 3. Fetch AI33 cloned voices if AI33 key is present and merge cleanly into savedCustomVoices
        if (ai33Key) {
            try {
                const ai33Clones = await getMinimaxClones().catch(e => {
                    console.error('AI33 clones fetch failed:', e);
                    return [];
                });

                if (ai33Clones.length > 0) {
                    let addedAny = false;
                    for (const clone of ai33Clones) {
                        const rawId = (clone.voice_id || '').replace(/^clone_/, '');
                        const fullId = clone.voice_id?.startsWith('clone_') ? clone.voice_id : `clone_${clone.voice_id}`;
                        
                        // Check if already in savedCustomVoices
                        const exists = state.savedCustomVoices.some(v => 
                            v.voiceId === fullId || 
                            v.voiceId === clone.voice_id || 
                            v.rawVoiceId === rawId || 
                            v.voiceId === rawId
                        );

                        if (!exists && rawId) {
                            state.savedCustomVoices.push({
                                id: `clone_${rawId}_${Date.now()}`,
                                name: clone.voice_name || clone.name || `Clone (${rawId.substring(0, 8)})`,
                                provider: 'clone',
                                voiceId: fullId,
                                rawVoiceId: rawId,
                                createdAt: Date.now()
                            });
                            addedAny = true;
                        }
                    }

                    if (addedAny) {
                        state.customVoiceIds = state.savedCustomVoices.map(v => v.voiceId);
                        localStorage.setItem('savedCustomVoices', JSON.stringify(state.savedCustomVoices));
                        localStorage.setItem('customVoiceIds', JSON.stringify(state.customVoiceIds));
                    }

                    // Re-render the unified custom voices group with newly discovered clones
                    renderSavedVoicesInDropdown();
                    import('./handlers-settings').then(m => m.renderStudioSavedVoicesList());
                }
            } catch (e: any) {
                console.error('AI33 clones fetch failed:', e);
            }
        }
    } finally {
        isFetchingVoices = false;
    }
}

/**
 * Fetches and populates the ElevenLabs models dropdown.
 */
export async function fetchAndPopulateElevenLabsModels() {
    const elKey = state.elevenlabsApiKey;
    const ai33Key = state.ai33ApiKey;
    const hasKey = elKey || ai33Key;

    if (!hasKey) { 
        dom.elevenlabsModelSelect.disabled = true;
        dom.elevenlabsModelSelect.innerHTML = '<option value="">Enter API Key First</option>';
        return;
    }

    dom.elevenlabsModelSelect.disabled = true;
    dom.elevenlabsModelSelect.innerHTML = '<option value="">Loading models...</option>';

    try {
        const models = await getElevenLabsModels();
        state.elevenlabsModels = models;
        state.elevenlabsModelsFetched = true;

        if (models.length > 0) {
            dom.elevenlabsModelSelect.innerHTML = models
                .filter(m => m.can_do_text_to_speech) 
                .map(model => `<option value="${model.model_id}">${model.name}</option>`)
                .join('');

            dom.elevenlabsModelSelect.value = state.elevenlabsSelectedModel;
            dom.elevenlabsModelSelect.disabled = false;
        } else {
            dom.elevenlabsModelSelect.innerHTML = '<option value="">No models found</option>';
        }
    } catch (error) {
        console.error('Failed to fetch models:', error);
        dom.elevenlabsModelSelect.innerHTML = '<option value="">Failed to load models</option>';
    }
}

export function handleOpenCloningModal() {
    dom.voiceCloningModal.classList.remove('hidden');
    dom.cloningStatusLog.classList.add('hidden');
    dom.cloningStatusLog.innerHTML = '';
    renderStudioSavedVoicesList();
    switchVoiceStudioTab('custom');
}
export function handleCloseCloningModal() { dom.voiceCloningModal.classList.add('hidden'); }
export function handleCloningDropZoneClick() { dom.cloningFileInput.click(); }
export function handleCloningFileChange() {
    const file = dom.cloningFileInput.files?.[0];
    if (file) {
        dom.cloningFileStatus.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
        dom.cloningFileStatus.className = 'text-amber-400 font-bold';
    } else {
        dom.cloningFileStatus.textContent = 'Click or drag audio file here';
        dom.cloningFileStatus.className = 'text-gray-400';
    }
}

export async function handleStartVoiceCloning() {
    const name = dom.cloningVoiceName.value.trim();
    const file = dom.cloningFileInput.files?.[0];
    
    if (!name || !file) {
        ui.showStatus("Name and file required.", true, 3000);
        return;
    }
    
    try {
        await checkCredits(constants.CREDIT_COSTS.AUDIO_CLONING_MINIMAX, 'audio');
    } catch (error: any) {
        ui.showStatus(error.message, true, 4000);
        return;
    }
    
    const maxSize = 10 * 1024 * 1024; // 10MB AI33 v3 limit
    const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
    const allowedExtensions = ['.wav', '.mp3', '.webm', '.ogg'];
    
    if (file.size > maxSize) {
        ui.showStatus(`File too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Max 10MB.`, true, 4000);
        return;
    }
    
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    const isValidType = allowedTypes.includes(file.type) || allowedExtensions.includes(fileExtension);
    
    if (!isValidType) {
        ui.showStatus(`Invalid file format. Use: ${allowedExtensions.join(', ')}`, true, 4000);
        return;
    }
    
    if (file.size < 1024) { // Less than 1KB
        ui.showStatus('File too small. Need at least 5 seconds of clear audio.', true, 4000);
        return;
    }
    
    const log = dom.cloningStatusLog;
    const btn = dom.startCloningBtn;

    log.classList.remove('hidden');
    log.innerHTML = ''; // Clear previous logs
    const addLog = (msg: string, isError = false) => {
        log.innerHTML += `<p class="${isError ? 'text-red-400' : 'text-amber-400/80'}">${msg}</p>`;
        log.scrollTop = log.scrollHeight;
    };
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = utils.getAudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0)); // Copy to avoid detaching
        
        if (audioBuffer.duration < 5) {
            ui.showStatus(`Audio too short (${audioBuffer.duration.toFixed(1)}s). Need 5-15 seconds.`, true, 4000);
            return;
        }
        
        if (audioBuffer.duration > 30) {
            addLog(`⚠️ Audio is ${audioBuffer.duration.toFixed(1)}s. Will be trimmed to 15s.`);
        }
        
    } catch (decodeError) {
        ui.showStatus('Invalid audio file. Cannot decode.', true, 4000);
        return;
    }
    
    log.innerHTML = `<p class="text-gray-400 animate-pulse">Initializing upload...</p>`;
    btn.disabled = true;
    btn.textContent = "Cloning...";
    
    try {
        addLog(`Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)...`);
        
        let result: { voice_id: string };
        const provider = dom.cloningProvider?.value || 'minimax';
        
        if (provider === 'elevenlabs') {
            if (!state.elevenlabsApiKey) {
                throw new Error("ElevenLabs cloning requires a direct ElevenLabs API Key in Settings.");
            }
            const { cloneElevenLabsVoice } = await import('./api/providers');
            result = await cloneElevenLabsVoice({ file, voice_name: name });
        } else {
            result = await cloneMinimaxVoice({
                file,
                voice_name: name,
                language: dom.cloningLanguage.value,
                gender: dom.cloningGender.value,
                preview_text: dom.cloningPreviewText.value.trim() || `Hello, this is ${name}.`, // Fallback
                noise_reduction: dom.cloningNoiseReduction.checked
            });
            deductCredits(constants.CREDIT_COSTS.AUDIO_CLONING_MINIMAX, 'audio').catch(console.error);
        }
        
        addLog(`SUCCESS! Created voice: ${result.voice_id}`);
        
        // Refresh voice list
        await fetchAndPopulateVoices();
        
        ui.showStatus(`Voice "${name}" cloned successfully!`, false, 5000);
        
        setTimeout(() => handleCloseCloningModal(), 2000);
        
    } catch (e: any) {
        addLog(`ERROR: ${e.message}`, true);
        ui.showStatus(`Cloning failed: ${e.message}`, true, 5000);
    } finally {
        btn.disabled = false;
        btn.textContent = "🚀 Start Voice Cloning";
    }
}

export async function generateMasterNarration(
    fullScriptInput: string | Array<{ text: string, speaker_name?: string }>,
    log: (msg: string, isError?: boolean) => void,
    onProgress?: (progress: number, message: string) => void,
    forceTTS: boolean = false
): Promise<{ masterBuffer: AudioBuffer | null; fullTranscript: WordTimestamp[]; assetId?: string | null }> {
    if (checkGuestRestriction("Voiceover & Audio Synthesis")) return { masterBuffer: null, fullTranscript: [] };

    const isStructured = Array.isArray(fullScriptInput);
    const fullScript = isStructured 
        ? (fullScriptInput as Array<{text: string}>).map(s => s.text).join(' ').trim()
        : (fullScriptInput as string).trim();

    if (!fullScript || fullScript.length === 0) {
        log('❌ Script is empty', true);
        return { masterBuffer: null, fullTranscript: [] };
    }

    if (forceTTS && state.uploadedAudioBuffer) {
        // Clear the uploaded buffer since user explicitly requested TTS generation
        state.uploadedAudioBuffer = null;
        state.masterAudioTranscript = [];
        state.uploadedAudioFileName = '';
        state.uploadedAudioAssetId = null;
        log('🧹 Cleared previously uploaded master audio because TTS was requested.');
    }

    // Check if user started with Master Audio Upload
    if (state.uploadedAudioBuffer && !forceTTS) {
        log(`🎙️ Using pre-uploaded Master Audio ("${state.uploadedAudioFileName || 'Master Audio'}") — auto-TTS & synthesis skipped!`);
        onProgress?.(100, 'Using pre-uploaded master audio track...');
        
        let transcript = state.masterAudioTranscript || [];
        if (transcript.length === 0) {
            log('⚡ Timestamps missing on master audio, aligning transcript...');
            try {
                const wavBlob = audioBufferToWavBlob(state.uploadedAudioBuffer);
                const audioFile = new File([wavBlob], "master_uploaded.wav", { type: "audio/wav" });
                transcript = await forceAlignAudio(audioFile, fullScript, (p, m) => onProgress?.(p, m));
                state.masterAudioTranscript = transcript;
            } catch (e: any) {
                log(`⚠️ Auto-alignment warning: ${e.message}`, true);
            }
        }
        return { masterBuffer: state.uploadedAudioBuffer, fullTranscript: transcript, assetId: state.uploadedAudioAssetId };
    }

    const abortController = new AbortController();
    const audioContext = utils.getAudioContext();
    const selectedVoiceOption = dom.narrationVoiceSelect.selectedOptions?.[0];
    const voiceProvider = (selectedVoiceOption?.dataset?.provider as 'ai33' | 'elevenlabs' | 'gemini' | 'minimax' | 'edge' | 'kokoro') || 'edge';
    const voiceValue = selectedVoiceOption?.value || 'edge_en-US-AvaNeural';
    const rate = parseFloat(dom.narrationSpeedSlider.value || '1');
    const pitch = parseFloat(dom.narrationPitchSlider.value || '0');
    const stability = parseFloat(dom.narrationStabilitySlider.value || '0.5');
    const similarity = parseFloat(dom.narrationSimilaritySlider.value || '0.75');
    const style = parseFloat(dom.narrationStyleSlider.value || '0.0');

    const wordCount = fullScript.split(/\s+/).filter(Boolean).length;
    const isLongScript = (wordCount / 150) > 5; // ~5 minutes
    let scriptChunks: Array<{ text: string, voiceValue: string, voiceProvider: 'ai33' | 'elevenlabs' | 'gemini' | 'minimax' | 'edge' | 'kokoro' | 'gradio_custom' | 'gradio_design' | 'gradio_clone', speaker_name: string }> = [];

    const defaultDialogueVoices: Array<{ id: string; provider: 'edge' | 'kokoro' }> = [
        { id: 'edge_en-US-BrianNeural', provider: 'edge' },
        { id: 'kokoro_af_bella', provider: 'kokoro' },
        { id: 'edge_en-GB-RyanNeural', provider: 'edge' },
        { id: 'kokoro_am_adam', provider: 'kokoro' },
        { id: 'edge_en-US-AriaNeural', provider: 'edge' },
        { id: 'edge_en-US-GuyNeural', provider: 'edge' },
        { id: 'kokoro_bf_emma', provider: 'kokoro' }
    ];
    const assignedVoices = new Map<string, { id: string; provider: 'edge' | 'kokoro' }>();
    let nextVoiceIdx = 0;

    log(`🎙️ Generating voice narration with ${voiceProvider.toUpperCase()} (${voiceValue})...`);

    if (isStructured) {
        const structured = fullScriptInput as Array<{ text: string, speaker_name?: string }>;
        for (const line of structured) {
            const speaker = line.speaker_name && line.speaker_name.toLowerCase() !== 'narrator' ? line.speaker_name : 'Narrator';
            let vValue = voiceValue;
            let vProvider = voiceProvider;

            if (speaker !== 'Narrator') {
                if (!assignedVoices.has(speaker)) {
                    assignedVoices.set(speaker, defaultDialogueVoices[nextVoiceIdx % defaultDialogueVoices.length]);
                    nextVoiceIdx++;
                }
                const assigned = assignedVoices.get(speaker)!;
                vValue = assigned.id;
                vProvider = assigned.provider;
            }

            // Append to last chunk if it's the same speaker and chunk isn't too large (keep it simple, max 350 words)
            const currentWordCount = line.text.split(/\s+/).filter(Boolean).length;
            const lastChunk = scriptChunks[scriptChunks.length - 1];

            if (lastChunk && lastChunk.speaker_name === speaker && lastChunk.text.split(/\s+/).filter(Boolean).length + currentWordCount < 350) {
                lastChunk.text += ' ' + line.text;
            } else {
                scriptChunks.push({ text: line.text, voiceValue: vValue, voiceProvider: vProvider, speaker_name: speaker });
            }
        }
    } else {
        if (!isLongScript) {
            scriptChunks = [{ text: fullScript, voiceValue, voiceProvider, speaker_name: 'Narrator' }];
            log(`⚡ Single-chunk generation (${wordCount} words, ~${(wordCount / 150).toFixed(1)} min)`);
        } else {
            const chunkSizeWords = 350; 
            const stringChunks = utils.chunkText(fullScript, chunkSizeWords);
            scriptChunks = stringChunks.map(c => ({ text: c, voiceValue, voiceProvider, speaker_name: 'Narrator' }));
            log(`📄 Split into ${scriptChunks.length} chunks (~${chunkSizeWords} words each) for long script (~${(wordCount / 150).toFixed(1)} min audio)`);
        }
    }

    const totalChunks = scriptChunks.length;
    if (totalChunks > 20 && (voiceProvider === 'minimax' || voiceProvider === 'ai33' || voiceProvider === 'elevenlabs')) {
        log(`⚠️ Large story: ${totalChunks} chunks. Generation may take ${Math.ceil(totalChunks * 2.5 / 2)} minutes.`);
    }
    if (totalChunks === 0) {
        log('❌ Script too short to process', true);
        return { masterBuffer: null, fullTranscript: [] };
    }

    // Cache check (keep existing)
    const voiceSettings = { voiceProvider, voiceValue, rate, pitch, stability, similarity, style };
    const cacheKey = utils.simpleHash(fullScript.trim() + safeJsonStringify(voiceSettings));
    try {
        let cached = await DB.get(constants.NARRATION_CACHE_STORE, cacheKey);
        if (cached && cached.fullTranscript && cached.fullTranscript.length > 0 && (Date.now() - (cached.timestamp || 0) < 7 * 24 * 60 * 60 * 1000)) {
            log('🎙️ Found cached narration. Reconstructing audio...');
            let buffer: AudioBuffer;
            if (cached.assetId) {
                // new format
                const blob = await assetStorage.getAsset(cached.assetId);
                if (!blob) throw new Error("Audio asset not found in storage");
                buffer = await utils.safeDecode(audioContext, await blob.arrayBuffer());
            } else if (cached.audioData) {
                // legacy format
                buffer = audioContext.createBuffer(cached.audioData.numberOfChannels, cached.audioData.length, cached.audioData.sampleRate);
                for (let i = 0; i < cached.audioData.numberOfChannels; i++) buffer.copyToChannel(cached.audioData.channels[i], i);
            } else {
                throw new Error("Invalid cache format");
            }
            log('✔️ Cache successfully loaded.');
            return { masterBuffer: buffer, fullTranscript: cached.fullTranscript, assetId: cached.assetId || null };
        }
    } catch (e: any) {
        log(`⚠️ Cache read error: ${e.message}`, true);
    }

    // --- Progressive Processing State ---
    let processingHead = 0;
    let isProcessingQueue = false;
    const progressiveBuffers: AudioBuffer[] = [];
    const progressiveTranscript: WordTimestamp[] = [];
    let cumulativeTime = 0;
    const PAUSE_SECONDS = 0.3; // ✅ FIXED: Back to 300ms (from OLD version)
    const PAUSE_SAMPLES = Math.floor(audioContext.sampleRate * PAUSE_SECONDS);
    const reusableSilence = audioContext.createBuffer(1, PAUSE_SAMPLES, audioContext.sampleRate);

    const providerConcurrency: Record<string, number> = { 
        'gemini': 3, 
        'elevenlabs': 2,
        'ai33': 4,        // ✅ Sweet spot: fast but stable
        'edge': 4,        // Protected by backend semaphore
        'kokoro': 4,
        'minimax': 2 
    };
    const MAX_CONCURRENT = providerConcurrency[voiceProvider] || 2;
    
    const STAGGER_DELAY = 300;  // ✅ Minimal delay for AI33
    
    const results: Array<{ buffer: AudioBuffer; words: WordTimestamp[] } | null> = new Array(totalChunks).fill(null);
    let completedCount = 0;
    let nextChunkIndex = 0;
    let failedChunks = 0;
    let consecutiveFailures = 0;
    let dynamicStaggerDelay = STAGGER_DELAY;

    let lastReportedProgress = 0;

    function processQueue() {
        if (isProcessingQueue || !state.isVideoProductionRunning) {
            if (!state.isVideoProductionRunning) abortController.abort();
            return;
        }
        isProcessingQueue = true;

        try {
            while (processingHead < totalChunks && results[processingHead] !== null && state.isVideoProductionRunning) {
                const res = results[processingHead]!;

                if (res.words?.length > 0) {
                    const actualDuration = res.buffer.duration;
                    // Find the max word end reported by the TTS engine for this chunk
                    const reportedDuration = Math.max(...res.words.map((w: any) => w.end));
                    // If TTS timestamps don't match actual audio duration, rescale them
                    // so words stay in sync even when the engine mis-reports timing.
                    const scale = (reportedDuration > 0.01 && Math.abs(reportedDuration - actualDuration) > 0.05)
                        ? actualDuration / reportedDuration
                        : 1;
                    res.words.forEach((word: any) => progressiveTranscript.push({ 
                        ...word, 
                        start: word.start * scale + cumulativeTime, 
                        end: Math.min(word.end * scale + cumulativeTime, cumulativeTime + actualDuration)
                    }));
                }
                progressiveBuffers.push(res.buffer);
                cumulativeTime += res.buffer.duration;

                if (processingHead < totalChunks - 1) {
                    progressiveBuffers.push(reusableSilence);
                    cumulativeTime += PAUSE_SECONDS;
                }

                results[processingHead] = null;
                processingHead++;
            }
        } finally {
            isProcessingQueue = false;
        }
    }

    async function processNextChunk(): Promise<void> {
        if (!state.isVideoProductionRunning) {
            abortController.abort();
            return;
        }
        if (nextChunkIndex >= totalChunks) return;
        
        const currentIndex = nextChunkIndex++;
        const chunkData = scriptChunks[currentIndex];
        const textChunk = chunkData ? chunkData.text : "";
        const chunkVoiceProvider = chunkData ? chunkData.voiceProvider : voiceProvider;
        const chunkVoiceValue = chunkData ? chunkData.voiceValue : voiceValue;

        if (currentIndex > 0) {
            const delay = dynamicStaggerDelay * (1 + (consecutiveFailures * 0.5));
            await new Promise(r => setTimeout(r, delay));
        }

        if (!textChunk || textChunk.trim().length === 0) {
            log(`⚠️ Segment ${currentIndex + 1} is empty, skipping...`);
            results[currentIndex] = { buffer: audioContext.createBuffer(1, 1, audioContext.sampleRate), words: [] };
            completedCount++;
            processQueue();
            if (state.isVideoProductionRunning) return processNextChunk();
            else return;
        }
        
        let audioResult: { buffer: AudioBuffer; words: WordTimestamp[] } | null = null;
        let retries = 0;
        const maxRetries = 3;

        while (retries <= maxRetries && state.isVideoProductionRunning) {
            try {
                const result = await generateSpeechWithTimestamps(
                    textChunk, 
                    chunkVoiceProvider, 
                    chunkVoiceValue, 
                    { rate, pitch, stability, similarity, style },
                    abortController.signal,
                    onProgress
                );
                
                if (!result.buffer || result.buffer.length === 0) {
                    throw new Error('Invalid audio buffer received');
                }
                
                log(`✅ Chunk ${currentIndex + 1}/${totalChunks} (${result.source}): ${result.buffer.duration.toFixed(2)}s`);
                audioResult = { buffer: result.buffer, words: result.words };
                consecutiveFailures = Math.max(0, consecutiveFailures - 1);
                dynamicStaggerDelay = Math.max(STAGGER_DELAY, dynamicStaggerDelay * 0.9);
                break;
                
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    log(`➡️ Seg ${currentIndex + 1}: Aborted.`);
                    break;
                }
                const msg = String(e?.message || e || '');
                if (/disabled for your account|disabled by the administrator/i.test(msg)) {
                    log(`❌ Seg ${currentIndex + 1}: ${msg}`, true);
                    failedChunks++;
                    break;
                }
                retries++;
                consecutiveFailures++;
                const isRateLimit = /429|busy|rate limit|quota/i.test(msg);
                
                if (isRateLimit) {
                    const backoffTime = Math.min(30000, 2000 * Math.pow(2, retries));
                    dynamicStaggerDelay = Math.min(5000, dynamicStaggerDelay * 1.5);
                    if (retries <= maxRetries) {
                        log(`⚠️ Seg ${currentIndex + 1}: Rate limited. Backing off ${backoffTime / 1000}s...`);
                        await new Promise(r => setTimeout(r, backoffTime));
                    }
                } else {
                    const waitTime = 1500 * retries;
                    if (retries <= maxRetries) {
                        log(`⚠️ Seg ${currentIndex + 1}: ${msg}. Retrying in ${waitTime / 1000}s...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    }
                }
                
                if (retries > maxRetries) {
                    log(`❌ Seg ${currentIndex + 1}: Failed after ${maxRetries} retries`, true);
                    failedChunks++;
                }
            }
        }
        
        if (!state.isVideoProductionRunning) {
            abortController.abort();
            // Write a silent placeholder so processQueue doesn't stall on this slot
            if (results[currentIndex] === null) {
                results[currentIndex] = {
                    buffer: audioContext.createBuffer(1, 1, audioContext.sampleRate),
                    words: []
                };
                completedCount++;
                processQueue();
            }
            return;
        }

        if (!audioResult) {
            const estimatedDuration = textChunk.split(/\s+/).length / 2.5;
            audioResult = {
                buffer: audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * estimatedDuration), audioContext.sampleRate),
                words: []
            };
            log(`⚠️ Seg ${currentIndex + 1}: Using silent fallback`, true);
        }
        
        results[currentIndex] = audioResult;
        completedCount++;
        lastReportedProgress = (completedCount / totalChunks) * 100;
        onProgress?.(lastReportedProgress, `Narrating ${completedCount}/${totalChunks}...`);
        processQueue();
        if (state.isVideoProductionRunning) return processNextChunk();
    }

    const progressInterval = setInterval(() => {
        if (!state.isVideoProductionRunning || completedCount >= totalChunks) {
            clearInterval(progressInterval);
            return;
        }
        
        // Asymptotically approach 90% of the current chunk's progress
        const targetProgress = ((completedCount + 0.9) / totalChunks) * 100;
        lastReportedProgress += (targetProgress - lastReportedProgress) * 0.05;
        
        onProgress?.(lastReportedProgress, `Narrating ${completedCount + 1}/${totalChunks}...`);
    }, 500);

    const pool = Array.from({ length: Math.min(MAX_CONCURRENT, totalChunks) }, () => processNextChunk());
    await Promise.all(pool);
    clearInterval(progressInterval);

    if (!state.isVideoProductionRunning) {
        abortController.abort();
        return { masterBuffer: null, fullTranscript: [] };
    }
    if (failedChunks > totalChunks * 0.5) {
        log(`❌ Too many failures (${failedChunks}/${totalChunks}). Aborting.`, true);
        return { masterBuffer: null, fullTranscript: [] };
    }

    processQueue();

    if (progressiveBuffers.length === 0) {
        log('❌ No audio buffers were generated.', true);
        return { masterBuffer: null, fullTranscript: [] };
    }

    try {
        log(`🎵 Final merge of ${progressiveBuffers.length} segments...`);
        const finalBuffer = utils.concatAudioBuffers(progressiveBuffers, audioContext);
        progressiveBuffers.forEach(b => { if (b !== reusableSilence) utils.releaseAudioBuffer(b); });
        progressiveBuffers.length = 0;
        
        if (!finalBuffer || finalBuffer.length === 0) throw new Error('Final concatenation produced invalid buffer');

        let fullTranscript = progressiveTranscript;
        for (let i = 1; i < fullTranscript.length; i++) {
            if (fullTranscript[i].start < fullTranscript[i - 1].end) {
                fullTranscript[i].start = fullTranscript[i - 1].end + 0.001;
            }
        }
        
        // ── NEW: if TTS had no alignment data, force-align the FINAL rendered audio ──
        if (finalBuffer && (!fullTranscript || fullTranscript.length === 0)) {
            log('⚡ No TTS word timestamps — force-aligning generated audio with script...');
            try {
                const wavBlob = audioBufferToWavBlob(finalBuffer);
                const audioFile = new File([wavBlob], 'tts_master.wav', { type: 'audio/wav' });
                const aligned = await forceAlignAudio(audioFile, fullScript, (p, m) => onProgress?.(p, m));
                if (aligned && aligned.length > 0) {
                    fullTranscript = aligned;
                    log(`✅ Force-aligned ${aligned.length} words against generated audio.`);
                }
            } catch (e: any) {
                log(`⚠️ Force-align failed (${e.message}). Falling back to silence-aware placement.`, true);
            }
        }
        
        if (fullTranscript.length > 0) {
            log(`✅ Timeline validation passed: ${(finalBuffer.duration - fullTranscript[fullTranscript.length - 1].end).toFixed(2)}s final gap`);
        }
        log(`✔️ Master audio ready: ${finalBuffer.duration.toFixed(2)}s`);

        // Cache as Blob
        let assetId: string | null = null;
        try {
            const wavBlob = audioBufferToWavBlob(finalBuffer);
            assetId = await assetStorage.storeAsset(wavBlob, 'audio');
            
            const cacheableData = { 
                id: cacheKey, 
                assetId,
                fullTranscript, 
                timestamp: Date.now() 
            };
            await DB.put(constants.NARRATION_CACHE_STORE, cacheableData);
            log('💾 Narration cached as Blob.');
        } catch (e: any) { 
            log(`⚠️ Cache write error: ${e.message}`, true); 
        }

        return { masterBuffer: finalBuffer, fullTranscript, assetId };
    } catch (e: any) {
        log(`❌ Failed to finalize audio: ${e.message}`, true);
        progressiveBuffers.forEach(b => utils.releaseAudioBuffer(b));
        return { masterBuffer: null, fullTranscript: [] };
    }
}
