/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dom from './dom';
import { state } from './state';
import { timelineState } from './state-timeline';
import * as ui from './ui';
import * as utils from './utils';
import { formatTime, audioBufferToWavBlob } from './utils-core';
import { assetStorage } from './assetStorage';
import { generateSpeechWithTimestamps, generateSpeech, createProportionalTimestamps } from './api/audio';
import { getEdgeVoices, type EdgeVoice } from './api/providers';
import { updateStep4CadenceState, applyEditingRhythmTemplate } from './masterAudioDirector';
import { loadAndShowWaveform } from './audioWaveformVisualizer';
import { updateVideoContext } from './videoController';
import { switchVoiceStudioTab } from './handlers-settings';
import type { WordTimestamp } from './types';

// Audio player state for the studio
let studioAudioBuffer: AudioBuffer | null = null;
let studioWordTimestamps: WordTimestamp[] = [];
let studioScriptText: string = '';
let studioAudioContext: AudioContext | null = null;
let studioAudioSource: AudioBufferSourceNode | null = null;
let studioAudioStartTime: number = 0;
let studioAudioPauseOffset: number = 0;
let studioIsPlaying: boolean = false;
let studioAnimFrameId: number | null = null;

const SAMPLE_SCRIPTS = [
    "In a world driven by continuous innovation, the ability to communicate compelling ideas with visual precision and dynamic pacing transforms everything we create.",
    "Deep beneath the ocean's surface lies an undiscovered realm of bioluminescent marvels, silent giants, and ancient mysteries waiting to be revealed.",
    "Welcome to the next generation of storytelling. By combining AI-driven narration with synchronized cinematic visuals, we bring your imagination to life effortlessly."
];

export function openVoiceStudioModal(activeTab: 'generate' | 'custom' | 'clone' = 'generate') {
    if (!dom.voiceCloningModal) return;
    populateStudioVoiceDropdown();
    updateStudioVoiceControls();
    switchVoiceStudioTab(activeTab);
    dom.voiceCloningModal.classList.remove('hidden');
}

export function closeVoiceStudioModal() {
    stopStudioAudio();
    if (dom.voiceCloningModal) {
        dom.voiceCloningModal.classList.add('hidden');
    }
}

export { switchVoiceStudioTab };

let studioEdgeVoices: EdgeVoice[] = [];
let studioEdgeVoicesRequested = false;

let currentStudioProviderFilter = 'edge';
let currentStudioSearchQuery = '';
let currentStudioLangFilter = 'all';
let currentStudioGenderFilter = 'all';
let currentStudioQualityFilter = 'all';

/**
 * Checks if a voice ID, shortName, or display name corresponds to an ultra-natural / expressive voice
 */
export function isNaturalVoice(voiceIdOrShortName: string, name: string = ''): boolean {
    const v = `${voiceIdOrShortName} ${name}`.toLowerCase();
    return v.includes('ava') ||
           v.includes('brian') ||
           v.includes('andrew') ||
           v.includes('emma') ||
           v.includes('ryan') ||
           v.includes('sonia') ||
           v.includes('aria') ||
           v.includes('expressive') ||
           v.includes('neerja') ||
           v.includes('natasha') ||
           v.includes('heart') ||
           v.includes('bella') ||
           v.includes('adam') ||
           v.includes('george') ||
           v.includes('zephyr') ||
           v.includes('puck');
}

/**
 * Converts a 2-letter country code into its corresponding Unicode flag emoji
 */
export function getFlagEmoji(countryCode: string): string {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

/**
 * Resolves the human-readable region/country name for a given locale (e.g. en-NG -> Nigeria)
 */
export function getVoiceRegionName(locale: string): string {
    const parts = (locale || '').split('-');
    if (parts.length > 1) {
        const regionCode = parts[parts.length - 1].toUpperCase();
        try {
            const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
            return regionNames.of(regionCode) || '';
        } catch {}
    }
    return '';
}

/**
 * Dynamically populates the Language Filter dropdown with all 75+ unique languages in Edge TTS,
 * including direct options for high-demand regional accents like Nigeria, Kenya, South Africa, UK, US, etc.
 */
function populateStudioLanguageFilter(voices: EdgeVoice[]) {
    if (!dom.studioVoiceLangFilter || voices.length === 0) return;
    const currentVal = dom.studioVoiceLangFilter.value || currentStudioLangFilter || 'all';

    // Count voices per language prefix
    const counts = new Map<string, number>();
    for (const v of voices) {
        const base = (v.locale || '').split('-')[0].toLowerCase();
        if (base) counts.set(base, (counts.get(base) || 0) + 1);
    }

    let displayLang: any = null;
    try { displayLang = new (Intl as any).DisplayNames(['en'], { type: 'language' }); } catch {}

    const langs: Array<{ code: string; name: string; count: number }> = [];
    for (const [code, count] of counts.entries()) {
        let name = code;
        try { name = displayLang?.of(code) || code; } catch {}
        langs.push({ code, name, count });
    }

    // Sort priority
    const priority = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'it', 'pt', 'hi', 'vi', 'ar', 'ko', 'ru', 'nl', 'pl', 'tr', 'id', 'sv', 'fil'];
    langs.sort((a, b) => {
        const idxA = priority.indexOf(a.code);
        const idxB = priority.indexOf(b.code);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.name.localeCompare(b.name);
    });

    dom.studioVoiceLangFilter.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `🌍 All Languages (${langs.length} langs · ${voices.length} voices)`;
    dom.studioVoiceLangFilter.appendChild(allOpt);

    // Direct filters for regional English accents (Nigeria, Kenya, South Africa, UK, US, etc.)
    const englishRegional = [
        { code: 'en', label: '🌐 All English (All Accents)' },
        { code: 'en-NG', label: '🇳🇬 English (Nigeria)' },
        { code: 'en-US', label: '🇺🇸 English (United States)' },
        { code: 'en-GB', label: '🇬🇧 English (United Kingdom)' },
        { code: 'en-AU', label: '🇦🇺 English (Australia)' },
        { code: 'en-KE', label: '🇰🇪 English (Kenya)' },
        { code: 'en-ZA', label: '🇿🇦 English (South Africa)' },
        { code: 'en-IN', label: '🇮🇳 English (India)' },
        { code: 'en-CA', label: '🇨🇦 English (Canada)' },
        { code: 'en-IE', label: '🇮🇪 English (Ireland)' },
        { code: 'en-NZ', label: '🇳🇿 English (New Zealand)' },
        { code: 'en-PH', label: '🇵🇭 English (Philippines)' },
        { code: 'en-SG', label: '🇸🇬 English (Singapore)' },
        { code: 'en-TZ', label: '🇹🇿 English (Tanzania)' }
    ];

    for (const reg of englishRegional) {
        const count = reg.code === 'en'
            ? voices.filter(v => v.locale.startsWith('en-')).length
            : voices.filter(v => v.locale.toLowerCase() === reg.code.toLowerCase()).length;
        if (count > 0) {
            const opt = document.createElement('option');
            opt.value = reg.code;
            opt.textContent = `${reg.label} (${count} voice${count === 1 ? '' : 's'})`;
            dom.studioVoiceLangFilter.appendChild(opt);
        }
    }

    // Other international languages
    for (const l of langs) {
        if (l.code === 'en') continue;
        const opt = document.createElement('option');
        opt.value = l.code;
        opt.textContent = `${l.name} (${l.count} voice${l.count === 1 ? '' : 's'})`;
        dom.studioVoiceLangFilter.appendChild(opt);
    }

    if (Array.from(dom.studioVoiceLangFilter.options).some(o => o.value === currentVal)) {
        dom.studioVoiceLangFilter.value = currentVal;
    } else {
        dom.studioVoiceLangFilter.value = 'all';
    }
}

const ALL_GEMINI_VOICES = new Set([
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Iapetus', 'Enceladus',
    'Schedar', 'Achernar', 'Leda', 'Algieba', 'Vindemiatrix', 'Zubenelgenubi',
    'Orus', 'Algenib', 'Achird', 'Sulafat', 'Callirrhoe', 'Erinome', 'Gacrux',
    'Sadachbia', 'Autonoe', 'Rasalgethi', 'Umbriel', 'Laomedeia', 'Alnilam', 'Pulcherrima', 'Sadaltager'
]);

export function updateVoiceProviderBadge(voiceId?: string) {
    if (!dom.studioSelectedVoiceProviderBadge) return;
    const vid = voiceId || dom.studioGenVoiceSelect?.value || '';
    if (vid.startsWith('edge_')) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Edge Neural (Free)';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40';
    } else if (vid.startsWith('kokoro_')) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Kokoro 82M (Free)';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-pink-950 text-pink-300 border border-pink-500/40';
    } else if (vid.startsWith('elevenlabs_') || ['s3TPKV1kjDlVtZbl4Ksh', 'IRHApOXLvnW57QJPQH2P', 'hbB2qXyS2GMyyZIZyhAH', 'ZT9u07TYPVl83ejeLakq', 'iiidtqDt9FBdT1vfBluA'].includes(vid)) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'ElevenLabs';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40';
    } else if (vid.startsWith('minimax_')) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Minimax';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-500/40';
    } else if (ALL_GEMINI_VOICES.has(vid)) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Gemini Flash';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40';
    } else if (vid.startsWith('clone_')) {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Cloned Voice';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/40';
    } else {
        dom.studioSelectedVoiceProviderBadge.textContent = 'Custom Voice';
        dom.studioSelectedVoiceProviderBadge.className = 'text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-gray-300 border border-zinc-700';
    }
}

export function updateStudioVoiceControls(voiceId?: string) {
    const vid = voiceId || dom.studioGenVoiceSelect?.value || '';
    updateVoiceProviderBadge(vid);

    const isEdge = vid.startsWith('edge_');
    const isKokoro = vid.startsWith('kokoro_');
    const isElevenLabs = vid.startsWith('elevenlabs_') || vid.startsWith('clone_') || ['s3TPKV1kjDlVtZbl4Ksh', 'IRHApOXLvnW57QJPQH2P', 'hbB2qXyS2GMyyZIZyhAH', 'ZT9u07TYPVl83ejeLakq', 'iiidtqDt9FBdT1vfBluA'].includes(vid);
    const isMinimax = vid.startsWith('minimax_');
    const isGemini = ALL_GEMINI_VOICES.has(vid);

    // Map which controls are supported for this specific voice model
    const supported: Record<string, boolean> = {
        speed: true, // Supported across all TTS voices
        pitch: isEdge || isGemini || isMinimax,
        volume: isEdge,
        stability: isElevenLabs || (!isEdge && !isKokoro && !isGemini && !isMinimax),
        similarity: isElevenLabs || (!isEdge && !isKokoro && !isGemini && !isMinimax),
        style: isElevenLabs,
        instruction: isGemini
    };

    if (dom.studioVoiceControlsContainer) {
        Object.entries(supported).forEach(([controlName, isVisible]) => {
            const el = dom.studioVoiceControlsContainer.querySelector(`[data-studio-control="${controlName}"]`) as HTMLElement | null;
            if (el) {
                el.classList.toggle('hidden', !isVisible);
            }
        });
    }

    if (dom.studioSupportedControlsBadge) {
        if (isEdge) {
            dom.studioSupportedControlsBadge.textContent = 'Speed • Pitch • Volume (Edge Neural)';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/30';
        } else if (isKokoro) {
            dom.studioSupportedControlsBadge.textContent = 'Speed (Fixed Pitch Neural)';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-pink-950 text-pink-300 border border-pink-500/30';
        } else if (isElevenLabs) {
            dom.studioSupportedControlsBadge.textContent = 'Speed • Stability • Similarity • Style';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/30';
        } else if (isGemini) {
            dom.studioSupportedControlsBadge.textContent = 'Speed • Pitch • Tone Prompt (Gemini)';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-500/30';
        } else if (isMinimax) {
            dom.studioSupportedControlsBadge.textContent = 'Speed • Pitch Shift (Minimax)';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-500/30';
        } else {
            dom.studioSupportedControlsBadge.textContent = 'Speed • Custom Tuning';
            dom.studioSupportedControlsBadge.className = 'text-[9px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-gray-300 border border-zinc-700';
        }
    }
}

export function resetStudioVoiceControls() {
    if (dom.studioGenSpeedSlider) {
        dom.studioGenSpeedSlider.value = "1.0";
        if (dom.studioGenSpeedValue) dom.studioGenSpeedValue.textContent = "1.00x";
    }
    if (dom.studioGenPitchSlider) {
        dom.studioGenPitchSlider.value = "0";
        if (dom.studioGenPitchValue) dom.studioGenPitchValue.textContent = "+0Hz";
    }
    if (dom.studioGenVolumeSlider) {
        dom.studioGenVolumeSlider.value = "0";
        if (dom.studioGenVolumeValue) dom.studioGenVolumeValue.textContent = "+0%";
    }
    if (dom.studioGenStabilitySlider) {
        dom.studioGenStabilitySlider.value = "0.5";
        if (dom.studioGenStabilityValue) dom.studioGenStabilityValue.textContent = "0.50";
    }
    if (dom.studioGenSimilaritySlider) {
        dom.studioGenSimilaritySlider.value = "0.75";
        if (dom.studioGenSimilarityValue) dom.studioGenSimilarityValue.textContent = "0.75";
    }
    if (dom.studioGenStyleSlider) {
        dom.studioGenStyleSlider.value = "0.0";
        if (dom.studioGenStyleValue) dom.studioGenStyleValue.textContent = "0.00";
    }
    if (dom.studioGenStyleInstruction) {
        dom.studioGenStyleInstruction.value = "";
    }
    updateStudioScriptStats();
}

export function setStudioVoiceAsNarrationVoice() {
    const selectedVoiceId = dom.studioGenVoiceSelect?.value;
    if (!selectedVoiceId) {
        ui.showStatus('Please select a voice first.', true, 2500);
        return;
    }

    const selectedOption = dom.studioGenVoiceSelect.selectedOptions?.[0];
    const voiceName = selectedOption?.textContent?.trim() || selectedVoiceId;

    let provider: 'edge' | 'kokoro' | 'elevenlabs' | 'minimax' | 'gemini' | 'clone' | 'vbee' | 'fishaudio' = 'edge';
    if (selectedVoiceId.startsWith('edge_')) provider = 'edge';
    else if (selectedVoiceId.startsWith('kokoro_')) provider = 'kokoro';
    else if (selectedVoiceId.startsWith('elevenlabs_')) provider = 'elevenlabs';
    else if (selectedVoiceId.startsWith('minimax_')) provider = 'minimax';
    else if (selectedVoiceId.startsWith('clone_')) provider = 'clone';
    else if (selectedVoiceId.startsWith('vbee_')) provider = 'vbee';
    else if (selectedVoiceId.startsWith('fishaudio_')) provider = 'fishaudio';
    else if (['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Iapetus'].includes(selectedVoiceId)) provider = 'gemini';

    if (dom.narrationVoiceSelect) {
        let existingOpt = dom.narrationVoiceSelect.querySelector(`option[value="${selectedVoiceId}"]`) as HTMLOptionElement | null;
        if (!existingOpt) {
            let activeGroup = dom.narrationVoiceSelect.querySelector('#studio-active-voice-group') as HTMLOptGroupElement | null;
            if (!activeGroup) {
                activeGroup = document.createElement('optgroup');
                activeGroup.id = 'studio-active-voice-group';
                activeGroup.label = '🎯 Active Voice from Voice Studio';
                if (dom.narrationVoiceSelect.children.length > 1) {
                    dom.narrationVoiceSelect.insertBefore(activeGroup, dom.narrationVoiceSelect.children[1]);
                } else {
                    dom.narrationVoiceSelect.appendChild(activeGroup);
                }
            }
            existingOpt = document.createElement('option');
            existingOpt.value = selectedVoiceId;
            existingOpt.dataset.provider = provider;
            existingOpt.textContent = `🎯 ${voiceName.replace(/^[🆓🌸🌐🎙️⭐⚡🔍📖🤍🔥]\s*/, '')}`;
            activeGroup.appendChild(existingOpt);
        }

        existingOpt.selected = true;
        dom.narrationVoiceSelect.value = selectedVoiceId;
        dom.narrationVoiceSelect.dispatchEvent(new Event('change'));

        // Sync slider values (speed, pitch, stability, similarity, style) over to Production Settings
        if (dom.narrationSpeedSlider && dom.studioGenSpeedSlider) {
            dom.narrationSpeedSlider.value = dom.studioGenSpeedSlider.value;
            if (dom.narrationSpeedValue) dom.narrationSpeedValue.textContent = `${parseFloat(dom.studioGenSpeedSlider.value).toFixed(2)}x`;
        }
        if (dom.narrationPitchSlider && dom.studioGenPitchSlider) {
            dom.narrationPitchSlider.value = dom.studioGenPitchSlider.value;
            if (dom.narrationPitchValue) dom.narrationPitchValue.textContent = dom.studioGenPitchSlider.value;
        }
        if (dom.narrationStabilitySlider && dom.studioGenStabilitySlider) {
            dom.narrationStabilitySlider.value = dom.studioGenStabilitySlider.value;
            if (dom.narrationStabilityValue) dom.narrationStabilityValue.textContent = parseFloat(dom.studioGenStabilitySlider.value).toFixed(2);
        }
        if (dom.narrationSimilaritySlider && dom.studioGenSimilaritySlider) {
            dom.narrationSimilaritySlider.value = dom.studioGenSimilaritySlider.value;
            if (dom.narrationSimilarityValue) dom.narrationSimilarityValue.textContent = parseFloat(dom.studioGenSimilaritySlider.value).toFixed(2);
        }
        if (dom.narrationStyleSlider && dom.studioGenStyleSlider) {
            dom.narrationStyleSlider.value = dom.studioGenStyleSlider.value;
            if (dom.narrationStyleValue) dom.narrationStyleValue.textContent = parseFloat(dom.studioGenStyleSlider.value).toFixed(2);
        }

        // Auto-expand the Narration accordion in Production Settings sidebar so the user sees it immediately
        const narrationAccordion = document.getElementById('director-accordion-narration') as HTMLDetailsElement | null;
        if (narrationAccordion) {
            narrationAccordion.open = true;
        }

        // Highlight the narration select in Production Settings with a brief visual cue
        dom.narrationVoiceSelect.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => {
            dom.narrationVoiceSelect?.classList.remove('ring-2', 'ring-emerald-400');
        }, 2200);

        ui.showStatus(`🎯 Active voice set in Production Settings (Narration): ${voiceName}`, false, 3500);
        closeVoiceStudioModal();
        ui.switchTab('storyboard');
        dom.narrationVoiceSelect.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function populateStudioVoiceDropdown(
    filterProvider: string = currentStudioProviderFilter,
    searchQuery: string = currentStudioSearchQuery,
    langFilter: string = currentStudioLangFilter,
    genderFilter: string = currentStudioGenderFilter,
    qualityFilter: string = currentStudioQualityFilter
) {
    currentStudioProviderFilter = filterProvider;
    currentStudioSearchQuery = searchQuery;
    currentStudioLangFilter = langFilter;
    currentStudioGenderFilter = genderFilter;
    currentStudioQualityFilter = qualityFilter;

    if (!dom.studioGenVoiceSelect) return;
    const currentVal = dom.studioGenVoiceSelect.value;
    dom.studioGenVoiceSelect.innerHTML = '';

    const q = searchQuery.trim().toLowerCase();

    // Free Microsoft Edge Neural Voices (Served with zero API key required)
    const popularEdgeVoices = [
        { id: 'edge_en-US-AvaNeural', name: '⭐ Edge - Ava (Ultra-Natural Expressive Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-BrianNeural', name: '⭐ Edge - Brian (Ultra-Natural Conversational Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-AndrewNeural', name: '⭐ Edge - Andrew (Natural Confident Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-EmmaNeural', name: '⭐ Edge - Emma (Natural Warm Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-AvaMultilingualNeural', name: '🌐 Edge - Ava Multilingual (Expressive Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-BrianMultilingualNeural', name: '🌐 Edge - Brian Multilingual (Conversational Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-AndrewMultilingualNeural', name: '🌐 Edge - Andrew Multilingual (Confident Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-EmmaMultilingualNeural', name: '🌐 Edge - Emma Multilingual (Warm Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-AriaNeural', name: '⭐ Edge - Aria (Warm Storyteller Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-ChristopherNeural', name: '🎙️ Edge - Christopher (Deep Documentary Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-GuyNeural', name: 'Edge - Guy (Casual Everyday Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-JennyNeural', name: 'Edge - Jenny (Helpful & Smooth Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-US-EricNeural', name: 'Edge - Eric (Clear Professional Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-US' },
        { id: 'edge_en-US-MichelleNeural', name: 'Edge - Michelle (Friendly Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-US' },
        { id: 'edge_en-GB-RyanNeural', name: '⭐ Edge - Ryan (British Storyteller Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-GB' },
        { id: 'edge_en-GB-SoniaNeural', name: '⭐ Edge - Sonia (British Polished Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-GB' },
        { id: 'edge_en-GB-ThomasNeural', name: 'Edge - Thomas (British Calm Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-GB' },
        { id: 'edge_en-AU-NatashaNeural', name: '⭐ Edge - Natasha (Australian Clear Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-AU' },
        { id: 'edge_en-AU-WilliamMultilingualNeural', name: '🌐 Edge - William Multilingual (Australian Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-AU' },
        { id: 'edge_en-IN-NeerjaExpressiveNeural', name: '⭐ Edge - Neerja Expressive (Indian Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-IN' },
        { id: 'edge_en-NG-AbeoNeural', name: '🇳🇬 Edge - Abeo (Nigerian Natural Male · Free)', provider: 'edge', gender: 'Male', locale: 'en-NG' },
        { id: 'edge_en-NG-EzinneNeural', name: '🇳🇬 Edge - Ezinne (Nigerian Warm Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-NG' },
        { id: 'edge_en-KE-AsiliaNeural', name: '🇰🇪 Edge - Asilia (Kenyan Clear Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-KE' },
        { id: 'edge_en-ZA-LeahNeural', name: '🇿🇦 Edge - Leah (South African Female · Free)', provider: 'edge', gender: 'Female', locale: 'en-ZA' }
    ];

    // Standard Gemini voices
    const geminiVoices = [
        { id: 'Zephyr', name: '⭐ Gemini Flash - Zephyr (Calm & Clear)', provider: 'gemini', gender: 'Female', locale: 'en-US' },
        { id: 'Puck', name: '⭐ Gemini Flash - Puck (Engaging & Energetic)', provider: 'gemini', gender: 'Male', locale: 'en-US' },
        { id: 'Charon', name: 'Gemini Flash - Charon (Deep & Resonant)', provider: 'gemini', gender: 'Male', locale: 'en-US' },
        { id: 'Kore', name: 'Gemini Flash - Kore (Warm & Friendly)', provider: 'gemini', gender: 'Female', locale: 'en-US' },
        { id: 'Fenrir', name: 'Gemini Flash - Fenrir (Strong & Authoritative)', provider: 'gemini', gender: 'Male', locale: 'en-US' }
    ];

    // Kokoro 82M open neural voices
    const kokoroVoices = [
        { id: 'kokoro_af_heart', name: '⭐ Kokoro - Heart (Ultra-Expressive Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-US' },
        { id: 'kokoro_af_bella', name: '⭐ Kokoro - Bella (Conversational Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-US' },
        { id: 'kokoro_af_sarah', name: 'Kokoro - Sarah (Clear Professional Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-US' },
        { id: 'kokoro_af_nicole', name: 'Kokoro - Nicole (Soothing & Melodic Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-US' },
        { id: 'kokoro_am_adam', name: '⭐ Kokoro - Adam (Deep Resonant Male · Free)', provider: 'kokoro', gender: 'Male', locale: 'en-US' },
        { id: 'kokoro_am_michael', name: 'Kokoro - Michael (Engaging Casual Male · Free)', provider: 'kokoro', gender: 'Male', locale: 'en-US' },
        { id: 'kokoro_bf_emma', name: '⭐ Kokoro - Emma (Refined British Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-GB' },
        { id: 'kokoro_bf_isabella', name: 'Kokoro - Isabella (Warm British Female · Free)', provider: 'kokoro', gender: 'Female', locale: 'en-GB' },
        { id: 'kokoro_bm_george', name: '⭐ Kokoro - George (Authoritative British Male · Free)', provider: 'kokoro', gender: 'Male', locale: 'en-GB' },
        { id: 'kokoro_bm_lewis', name: 'Kokoro - Lewis (Dynamic British Male · Free)', provider: 'kokoro', gender: 'Male', locale: 'en-GB' }
    ];

    // Popular ElevenLabs preset voices
    const elevenlabsPresetVoices = [
        { id: 'elevenlabs_s3TPKV1kjDlVtZbl4Ksh', name: '⭐ ElevenLabs - Adam (Deep Narrator)', provider: 'elevenlabs', gender: 'Male', locale: 'en-US' },
        { id: 'elevenlabs_ZT9u07TYPVl83ejeLakq', name: '⭐ ElevenLabs - Rachel (Professional Female)', provider: 'elevenlabs', gender: 'Female', locale: 'en-US' },
        { id: 'elevenlabs_hbB2qXyS2GMyyZIZyhAH', name: 'ElevenLabs - Bella (Soft Female)', provider: 'elevenlabs', gender: 'Female', locale: 'en-US' },
        { id: 'elevenlabs_iiidtqDt9FBdT1vfBluA', name: 'ElevenLabs - Bill (Documentary Male)', provider: 'elevenlabs', gender: 'Male', locale: 'en-US' },
        { id: 'elevenlabs_nPczCjzI2devNBz1VXQn', name: 'ElevenLabs - Brian (Deep Voice)', provider: 'elevenlabs', gender: 'Male', locale: 'en-US' },
        { id: 'elevenlabs_EXAVITQu4vr4xnSDxMaL', name: 'ElevenLabs - Sarah (Natural Female)', provider: 'elevenlabs', gender: 'Female', locale: 'en-US' },
        { id: 'elevenlabs_JBFqnCBsd6RMkjVDRZzb', name: 'ElevenLabs - George (Warm British Male)', provider: 'elevenlabs', gender: 'Male', locale: 'en-GB' }
    ];

    // Fetched ElevenLabs account voices if available
    const accountElevenlabsVoices = (state.elevenlabsVoices || []).map((v: any) => ({
        id: `elevenlabs_${v.voice_id || v.id}`,
        name: `ElevenLabs - ${v.name}${v.category === 'cloned' ? ' (Clone)' : ''}`,
        provider: 'elevenlabs',
        gender: v.labels?.gender || (v.name.toLowerCase().includes('female') ? 'Female' : 'Male'),
        locale: 'en-US'
    }));

    // Saved custom voices
    const savedVoices = (state.savedCustomVoices || []).map(v => {
        const id = v.id || '';
        let prov = 'custom';
        if (id.startsWith('elevenlabs_')) prov = 'elevenlabs';
        else if (id.startsWith('edge_')) prov = 'edge';
        else if (id.startsWith('kokoro_')) prov = 'kokoro';
        else if (id.startsWith('minimax_')) prov = 'minimax';
        else if (id.startsWith('vbee_')) prov = 'vbee';
        else if (id.startsWith('fishaudio_')) prov = 'fishaudio';
        else if (id.startsWith('clone_')) prov = 'clone';
        return {
            id,
            name: `${v.name || id} (${v.provider ? v.provider.toUpperCase() : prov.toUpperCase()})`,
            provider: prov,
            gender: 'Any',
            locale: 'any'
        };
    });

    // Request dynamic 300+ Edge voices if not loaded yet
    if (!studioEdgeVoicesRequested) {
        studioEdgeVoicesRequested = true;
        getEdgeVoices().then(v => {
            if (v && v.length > 0) {
                studioEdgeVoices = v;
                populateStudioLanguageFilter(v);
                populateStudioVoiceDropdown(filterProvider, searchQuery, langFilter, genderFilter, qualityFilter);
            }
        }).catch(() => {});
    }

    const allOptions = [
        ...popularEdgeVoices,
        ...kokoroVoices,
        ...geminiVoices,
        ...elevenlabsPresetVoices,
        ...accountElevenlabsVoices,
        ...savedVoices
    ];

    // Apply Filters to base options
    const filteredBase = allOptions.filter(item => {
        // Provider filter
        if (filterProvider !== 'all') {
            if (filterProvider === 'gemini' && item.provider !== 'gemini') return false;
            if (filterProvider !== 'gemini' && item.provider !== filterProvider) return false;
        }
        // Gender filter
        if (genderFilter !== 'all') {
            const g = (item.gender || '').toLowerCase();
            if (g && g !== 'any' && g !== genderFilter.toLowerCase()) return false;
        }
        // Language / Regional filter
        if (langFilter !== 'all') {
            const loc = (item.locale || 'en-US').toLowerCase();
            if (langFilter.includes('-')) {
                if (loc !== langFilter.toLowerCase()) return false;
            } else {
                const base = loc.split('-')[0];
                if (base !== langFilter.toLowerCase()) return false;
            }
        }
        // Quality tier filter
        if (qualityFilter !== 'all') {
            const isNat = isNaturalVoice(item.id, item.name);
            const isMulti = item.id.toLowerCase().includes('multilingual') || item.name.toLowerCase().includes('multilingual');
            if (qualityFilter === 'natural' && !isNat) return false;
            if (qualityFilter === 'multilingual' && !isMulti) return false;
            if (qualityFilter === 'standard' && (isNat || isMulti)) return false;
        }
        // Search query
        if (q) {
            const matchName = item.name.toLowerCase().includes(q);
            const matchId = item.id.toLowerCase().includes(q);
            const matchLocale = (item.locale || '').toLowerCase().includes(q);
            const regName = getVoiceRegionName(item.locale).toLowerCase();
            const matchRegion = regName.includes(q) ||
                                (q.includes('nigeria') && (item.locale.toLowerCase().includes('ng') || regName.includes('nigeria') || item.name.toLowerCase().includes('nigeria') || item.name.toLowerCase().includes('abeo') || item.name.toLowerCase().includes('ezinne'))) ||
                                (q.includes('naija') && item.locale.toLowerCase().includes('ng')) ||
                                (q.includes('africa') && ['en-ng', 'en-ke', 'en-za', 'en-tz', 'af-za', 'zu-za', 'sw-ke', 'sw-tz'].includes(item.locale.toLowerCase()));
            const isNat = isNaturalVoice(item.id, item.name);
            const isMulti = item.id.toLowerCase().includes('multilingual') || item.name.toLowerCase().includes('multilingual');
            const matchNaturalTag = (q.includes('natural') || q.includes('expressive') || q.includes('best')) && isNat;
            const matchMultiTag = (q.includes('multi') || q.includes('multilingual')) && isMulti;
            if (!matchName && !matchId && !matchLocale && !matchRegion && !matchNaturalTag && !matchMultiTag) return false;
        }
        return true;
    });

    // Apply Filters to 300+ Dynamic Edge voices
    const showEdge = (filterProvider === 'all' || filterProvider === 'edge') && studioEdgeVoices.length > 0;
    let filteredEdge: EdgeVoice[] = [];
    if (showEdge) {
        filteredEdge = studioEdgeVoices.filter(v => {
            if (genderFilter !== 'all') {
                if ((v.gender || '').toLowerCase() !== genderFilter.toLowerCase()) return false;
            }
            if (langFilter !== 'all') {
                const loc = (v.locale || '').toLowerCase();
                if (langFilter.includes('-')) {
                    if (loc !== langFilter.toLowerCase()) return false;
                } else {
                    const base = loc.split('-')[0];
                    if (base !== langFilter.toLowerCase()) return false;
                }
            }
            const isNat = isNaturalVoice(v.shortName, v.displayName);
            const isMulti = (v.shortName || '').toLowerCase().includes('multilingual') || (v.displayName || '').toLowerCase().includes('multilingual');
            if (qualityFilter !== 'all') {
                if (qualityFilter === 'natural' && !isNat) return false;
                if (qualityFilter === 'multilingual' && !isMulti) return false;
                if (qualityFilter === 'standard' && (isNat || isMulti)) return false;
            }
            if (q) {
                const matchDisplay = (v.displayName || '').toLowerCase().includes(q);
                const matchShort = (v.shortName || '').toLowerCase().includes(q);
                const matchLocale = (v.locale || '').toLowerCase().includes(q);
                const regName = getVoiceRegionName(v.locale).toLowerCase();
                const matchRegion = regName.includes(q) ||
                                    (q.includes('nigeria') && (v.locale.toLowerCase().includes('ng') || regName.includes('nigeria') || v.shortName.toLowerCase().includes('abeo') || v.shortName.toLowerCase().includes('ezinne'))) ||
                                    (q.includes('naija') && v.locale.toLowerCase().includes('ng')) ||
                                    (q.includes('africa') && ['en-ng', 'en-ke', 'en-za', 'en-tz', 'af-za', 'zu-za', 'sw-ke', 'sw-tz'].includes(v.locale.toLowerCase()));
                const matchNaturalTag = (q.includes('natural') || q.includes('expressive') || q.includes('best')) && isNat;
                const matchMultiTag = (q.includes('multi') || q.includes('multilingual')) && isMulti;
                if (!matchDisplay && !matchShort && !matchLocale && !matchRegion && !matchNaturalTag && !matchMultiTag) return false;
            }
            return true;
        });
    }

    const totalCount = filteredBase.length + filteredEdge.length;
    if (dom.studioVoiceCountBadge) {
        dom.studioVoiceCountBadge.textContent = `${totalCount} voice${totalCount === 1 ? '' : 's'} available`;
    }

    if (totalCount === 0) {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = `No voices found matching filters. Clear search or change filters.`;
        dom.studioGenVoiceSelect.appendChild(opt);
        updateVoiceProviderBadge('');
        return;
    }

    // Avoid duplicate popular edge voices when dynamic voices arrive
    const seenIds = new Set<string>();
    filteredBase.forEach(item => {
        if (seenIds.has(item.id)) return;
        seenIds.add(item.id);
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        dom.studioGenVoiceSelect.appendChild(opt);
    });

    // Append 300+ Edge voices grouped by language
    if (filteredEdge.length > 0) {
        let displayLang: any = null;
        try { displayLang = new (Intl as any).DisplayNames(['en'], { type: 'language' }); } catch {}
        const byLang = new Map<string, EdgeVoice[]>();
        for (const v of filteredEdge) {
            const base = (v.locale || '').split('-')[0];
            let name = base;
            try { name = displayLang?.of(base) || base; } catch {}
            if (!byLang.has(name)) byLang.set(name, []);
            byLang.get(name)!.push(v);
        }
        const langs = Array.from(byLang.keys()).sort((a, b) =>
            a === 'English' ? -1 : b === 'English' ? 1 : a.localeCompare(b));
        for (const lang of langs) {
            const group = document.createElement('optgroup');
            group.label = `🆓 Edge TTS · ${lang}`;
            for (const v of byLang.get(lang)!.sort((a, b) => {
                const natA = isNaturalVoice(a.shortName, a.displayName) ? 0 : 1;
                const natB = isNaturalVoice(b.shortName, b.displayName) ? 0 : 1;
                if (natA !== natB) return natA - natB;
                return a.locale.localeCompare(b.locale) || a.displayName.localeCompare(b.displayName);
            })) {
                const optId = `edge_${v.shortName}`;
                if (seenIds.has(optId)) continue;
                seenIds.add(optId);
                const opt = document.createElement('option');
                opt.value = optId;
                let badge = '';
                if ((v.shortName || '').toLowerCase().includes('multilingual')) {
                    badge = '🌐 Multilingual · ';
                } else if (isNaturalVoice(v.shortName, v.displayName)) {
                    badge = '⭐ Ultra-Natural · ';
                }
                const parts = (v.locale || '').split('-');
                const countryCode = parts.length > 1 ? parts[parts.length - 1] : '';
                const flag = getFlagEmoji(countryCode);
                const reg = getVoiceRegionName(v.locale);
                const regLabel = reg ? `${flag} ${reg}` : v.locale;
                opt.textContent = `${badge}${v.displayName} (${regLabel} · ${v.gender})`;
                group.appendChild(opt);
            }
            if (group.children.length > 0) {
                dom.studioGenVoiceSelect.appendChild(group);
            }
        }
    }

    // Restore previous selection if possible, otherwise default to first available
    const availableIds = new Set([...filteredBase.map(f => f.id), ...filteredEdge.map(e => `edge_${e.shortName}`)]);
    if (currentVal && availableIds.has(currentVal)) {
        dom.studioGenVoiceSelect.value = currentVal;
    } else if (availableIds.has('edge_en-US-AvaNeural')) {
        dom.studioGenVoiceSelect.value = 'edge_en-US-AvaNeural';
    } else if (dom.studioGenVoiceSelect.options.length > 0) {
        dom.studioGenVoiceSelect.selectedIndex = 0;
    }
    updateStudioVoiceControls();
}

function updateStudioScriptStats() {
    if (!dom.studioScriptInput) return;
    const text = dom.studioScriptInput.value.trim();
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const speed = parseFloat(dom.studioGenSpeedSlider?.value || '1.0');
    // Average speech rate is ~0.35s per word at 1.0x
    const estSeconds = words > 0 ? (words * 0.35) / Math.max(speed, 0.5) : 0;

    if (dom.studioScriptWordCount) {
        dom.studioScriptWordCount.textContent = words.toString();
    }
    if (dom.studioScriptDurationEst) {
        dom.studioScriptDurationEst.textContent = `${estSeconds.toFixed(1)}s`;
    }
}

function stopStudioAudio() {
    if (studioAudioSource) {
        try {
            studioAudioSource.stop();
            studioAudioSource.disconnect();
        } catch {
            // Ignore if already stopped
        }
        studioAudioSource = null;
    }
    if (studioAnimFrameId) {
        cancelAnimationFrame(studioAnimFrameId);
        studioAnimFrameId = null;
    }
    studioIsPlaying = false;
    updateStudioPlayBtnState();
}

function updateStudioPlayBtnState() {
    if (!dom.studioPlayBtn) return;
    if (studioIsPlaying) {
        dom.studioPlayBtn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
        dom.studioPlayBtn.title = "Pause";
    } else {
        dom.studioPlayBtn.innerHTML = `<svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
        dom.studioPlayBtn.title = "Play";
    }
}

function playStudioAudio(startOffset: number = 0) {
    if (!studioAudioBuffer) return;
    stopStudioAudio();

    studioAudioContext = utils.getAudioContext();
    if (studioAudioContext.state === 'suspended') {
        studioAudioContext.resume();
    }

    studioAudioSource = studioAudioContext.createBufferSource();
    studioAudioSource.buffer = studioAudioBuffer;
    studioAudioSource.connect(studioAudioContext.destination);

    const dur = studioAudioBuffer.duration;
    const clampedOffset = Math.max(0, Math.min(startOffset, dur));
    studioAudioPauseOffset = clampedOffset;
    studioAudioStartTime = studioAudioContext.currentTime - clampedOffset;

    studioAudioSource.onended = () => {
        if (studioIsPlaying) {
            studioIsPlaying = false;
            studioAudioPauseOffset = 0;
            if (dom.studioSeekBar) dom.studioSeekBar.value = "0";
            if (dom.studioTimeDisplay) dom.studioTimeDisplay.textContent = `00:00 / ${formatTime(dur)}`;
            updateStudioPlayBtnState();
        }
    };

    studioAudioSource.start(0, clampedOffset);
    studioIsPlaying = true;
    updateStudioPlayBtnState();

    function trackProgress() {
        if (!studioIsPlaying || !studioAudioBuffer || !studioAudioContext) return;
        const current = studioAudioContext.currentTime - studioAudioStartTime;
        if (current >= dur) {
            stopStudioAudio();
            studioAudioPauseOffset = 0;
            if (dom.studioSeekBar) dom.studioSeekBar.value = "0";
            if (dom.studioTimeDisplay) dom.studioTimeDisplay.textContent = `00:00 / ${formatTime(dur)}`;
            return;
        }

        const pct = (current / dur) * 100;
        if (dom.studioSeekBar) dom.studioSeekBar.value = pct.toFixed(1);
        if (dom.studioTimeDisplay) dom.studioTimeDisplay.textContent = `${formatTime(current)} / ${formatTime(dur)}`;

        studioAnimFrameId = requestAnimationFrame(trackProgress);
    }
    studioAnimFrameId = requestAnimationFrame(trackProgress);
}

function toggleStudioAudioPlayback() {
    if (!studioAudioBuffer) return;
    if (studioIsPlaying) {
        if (studioAudioContext) {
            studioAudioPauseOffset = studioAudioContext.currentTime - studioAudioStartTime;
        }
        stopStudioAudio();
    } else {
        playStudioAudio(studioAudioPauseOffset);
    }
}

export async function generateStudioAudio() {
    const text = dom.studioScriptInput?.value.trim();
    if (!text) {
        ui.showStatus('Please enter a script or text to generate audio.', true, 3000);
        return;
    }

    const selectedVoiceId = dom.studioGenVoiceSelect?.value || 'edge_en-US-AvaNeural';
    const speed = parseFloat(dom.studioGenSpeedSlider?.value || '1.0');
    const pitch = parseFloat(dom.studioGenPitchSlider?.value || '0');
    const volume = parseFloat(dom.studioGenVolumeSlider?.value || '0');
    const stability = parseFloat(dom.studioGenStabilitySlider?.value || '0.5');
    const similarity = parseFloat(dom.studioGenSimilaritySlider?.value || '0.75');
    const style = parseFloat(dom.studioGenStyleSlider?.value || '0.0');
    const styleInstruction = dom.studioGenStyleInstruction?.value?.trim() || '';

    if (dom.studioGenerateAudioBtn) {
        dom.studioGenerateAudioBtn.disabled = true;
        dom.studioGenerateAudioBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
    if (dom.studioAudioStatus) {
        dom.studioAudioStatus.textContent = 'Synthesizing voice audio with AI...';
        dom.studioAudioStatus.className = 'text-xs text-amber-300 font-medium animate-pulse';
    }

    try {
        let buffer: AudioBuffer;
        let words: WordTimestamp[] = [];

        const isGeminiVoice = ALL_GEMINI_VOICES.has(selectedVoiceId);
        const isEdgeVoice = selectedVoiceId.startsWith('edge_');
        const isKokoroVoice = selectedVoiceId.startsWith('kokoro_');

        if (isGeminiVoice) {
            const promptText = styleInstruction ? `[Tone: ${styleInstruction}] ${text}` : text;
            const res = await generateSpeech(promptText, selectedVoiceId, speed, pitch);
            buffer = res.buffer;
            words = res.words;
        } else if (isEdgeVoice || isKokoroVoice) {
            const provider = isKokoroVoice ? 'kokoro' : 'edge';
            const cleanVoiceId = selectedVoiceId.replace(/^(edge_|kokoro_)/, '');
            const res = await generateSpeechWithTimestamps(
                text,
                provider,
                cleanVoiceId,
                { rate: speed, pitch: isEdgeVoice ? pitch : 0, stability, similarity, style, volume: isEdgeVoice ? volume : 0 }
            );
            buffer = res.buffer;
            words = res.words || [];
        } else {
            // Determine provider and clean voice ID
            let provider: 'elevenlabs' | 'ai33' | 'minimax' = 'ai33';
            let actualVoiceId = selectedVoiceId;

            if (selectedVoiceId.startsWith('elevenlabs_')) {
                actualVoiceId = selectedVoiceId.replace(/^elevenlabs_/, '');
                provider = state.elevenlabsApiKey ? 'elevenlabs' : 'ai33';
            } else if (selectedVoiceId.startsWith('minimax_')) {
                actualVoiceId = selectedVoiceId.replace(/^minimax_/, '');
                provider = 'minimax';
            } else if (state.elevenlabsApiKey && !state.ai33ApiKey) {
                provider = 'elevenlabs';
            }

            const res = await generateSpeechWithTimestamps(
                text,
                provider,
                actualVoiceId,
                { rate: speed, pitch, stability, similarity, style }
            );
            buffer = res.buffer;
            words = res.words || [];
        }

        studioAudioBuffer = buffer;
        studioWordTimestamps = words;
        studioScriptText = text;

        // Show Player Card
        if (dom.studioPlayerContainer) {
            dom.studioPlayerContainer.classList.remove('hidden');
        }
        if (dom.studioAudioDurBadge) {
            dom.studioAudioDurBadge.textContent = formatTime(buffer.duration);
        }
        if (dom.studioTranscriptWordsBadge) {
            dom.studioTranscriptWordsBadge.textContent = `${words.length || text.split(/\s+/).filter(Boolean).length} words`;
        }
        if (dom.studioTimeDisplay) {
            dom.studioTimeDisplay.textContent = `00:00 / ${formatTime(buffer.duration)}`;
        }
        if (dom.studioSeekBar) {
            dom.studioSeekBar.value = "0";
        }

        if (dom.studioAudioStatus) {
            dom.studioAudioStatus.textContent = `Audio ready (${formatTime(buffer.duration)}). Preview or send to timeline below!`;
            dom.studioAudioStatus.className = 'text-xs text-emerald-400 font-semibold';
        }

        ui.showStatus(`Audio synthesized successfully! (${formatTime(buffer.duration)})`, false, 3500);

    } catch (err: any) {
        console.error('Voice Studio synthesis error:', err);
        if (dom.studioAudioStatus) {
            dom.studioAudioStatus.textContent = `Synthesis failed: ${err.message || err}`;
            dom.studioAudioStatus.className = 'text-xs text-rose-400 font-medium';
        }
        ui.showStatus(`Generation failed: ${err.message || err}`, true, 4000);
    } finally {
        if (dom.studioGenerateAudioBtn) {
            dom.studioGenerateAudioBtn.disabled = false;
            dom.studioGenerateAudioBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

export async function sendStudioAudioToMasterAroll() {
    if (!studioAudioBuffer) {
        ui.showStatus('No generated audio track found. Please generate audio first.', true, 3000);
        return;
    }

    try {
        ui.showStatus('Linking audio track to Master A-Roll & Timeline...', false, 2500);

        // Store asset in IndexedDB
        const wavBlob = audioBufferToWavBlob(studioAudioBuffer);
        const assetId = await assetStorage.storeAsset(wavBlob, 'audio');

        const audioFileName = 'Studio_A-Roll_Voice.wav';

        // Update state
        state.uploadedAudioBuffer = studioAudioBuffer;
        state.uploadedAudioAssetId = assetId;
        state.uploadedAudioFileName = audioFileName;
        state.masterAudioTranscript = studioWordTimestamps;

        // Update timeline state
        timelineState.setMasterAudioBuffer(studioAudioBuffer);
        timelineState.setGlobalWordTimestamps(studioWordTimestamps);
        timelineState.setShowSubtitles(true);

        if (dom.videoSubtitlesCheckbox) {
            dom.videoSubtitlesCheckbox.checked = true;
        }

        // Synchronize script into Prompt / Narration inputs if available
        if (studioScriptText) {
            if (dom.customPromptInput && !dom.customPromptInput.value.trim()) {
                dom.customPromptInput.value = studioScriptText;
            }
        }

        // Update Step 1 Master Audio Badge & Waveform UI
        if (dom.masterAudioBadge && dom.masterAudioDropzone) {
            dom.masterAudioBadge.classList.remove('hidden');
            dom.masterAudioDropzone.classList.add('hidden');
        }
        if (dom.masterAudioFilename) {
            dom.masterAudioFilename.textContent = audioFileName;
        }
        if (dom.masterAudioDuration) {
            dom.masterAudioDuration.textContent = formatTime(studioAudioBuffer.duration);
        }
        if (dom.masterAudioWords) {
            dom.masterAudioWords.textContent = `${studioWordTimestamps.length} words`;
        }

        loadAndShowWaveform(studioAudioBuffer, wavBlob, audioFileName);
        updateStep4CadenceState();
        applyEditingRhythmTemplate(state.selectedRhythmTemplateId || 'youtube_essay', false);
        updateVideoContext();

        // Enable video director & export buttons
        if (dom.videoDirectorBtn) {
            dom.videoDirectorBtn.disabled = false;
            dom.videoDirectorBtn.classList.remove('opacity-50');
        }
        if (dom.videoExportBtn) {
            dom.videoExportBtn.disabled = false;
        }

        // Close Voice Studio modal
        closeVoiceStudioModal();

        ui.showStatus(`🎙️ Master A-Roll audio linked successfully! Duration: ${formatTime(studioAudioBuffer.duration)}`, false, 4000);

    } catch (err: any) {
        console.error('Failed to link studio audio to Master A-roll:', err);
        ui.showStatus(`Failed to send to Master A-Roll: ${err.message || err}`, true, 4000);
    }
}

export function downloadStudioWav() {
    if (!studioAudioBuffer) {
        ui.showStatus('No generated audio available to download.', true, 3000);
        return;
    }
    const wavBlob = audioBufferToWavBlob(studioAudioBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice_studio_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.showStatus('📥 WAV audio download started.', false, 2500);
}

export function downloadStudioSrt() {
    if (!studioWordTimestamps || studioWordTimestamps.length === 0) {
        if (!studioScriptText) {
            ui.showStatus('No subtitles available. Generate audio first.', true, 3000);
            return;
        }
        // Fallback proportional word timestamps if words were empty
        if (studioAudioBuffer) {
            const syntheticWords = createProportionalTimestamps(studioScriptText, studioAudioBuffer.duration);
            const srtContent = utils.generateSRT(syntheticWords);
            const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `voice_studio_subtitles_${Date.now()}.srt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            ui.showStatus('📝 Subtitles (.SRT) download started.', false, 2500);
            return;
        }
    }

    const srtContent = utils.generateSRT(studioWordTimestamps);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice_studio_subtitles_${Date.now()}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ui.showStatus('📝 Subtitles (.SRT) download started.', false, 2500);
}

let voiceStudioInitialized = false;

export function initVoiceStudio() {
    if (voiceStudioInitialized) return;
    voiceStudioInitialized = true;
    // Header & Studio dropdown & Tool buttons to open modal
    dom.openVoiceStudioBtn?.addEventListener('click', () => {
        openVoiceStudioModal('generate');
    });

    dom.openVoiceStudioBtnMobile?.addEventListener('click', () => {
        openVoiceStudioModal('generate');
    });

    dom.openVoiceStudioHeaderBtn?.addEventListener('click', () => {
        openVoiceStudioModal('generate');
    });

    dom.openCloningModalBtn?.addEventListener('click', () => {
        openVoiceStudioModal('generate');
    });

    dom.closeCloningModalBtn?.addEventListener('click', () => {
        closeVoiceStudioModal();
    });

    // Close on backdrop click
    dom.voiceCloningModal?.addEventListener('click', (e) => {
        if (e.target === dom.voiceCloningModal) {
            closeVoiceStudioModal();
        }
    });

    // Tab buttons
    dom.voiceStudioTabGenerate?.addEventListener('click', () => {
        switchVoiceStudioTab('generate');
    });

    dom.voiceStudioTabCustom?.addEventListener('click', () => {
        switchVoiceStudioTab('custom');
    });

    dom.voiceStudioTabClone?.addEventListener('click', () => {
        switchVoiceStudioTab('clone');
    });

    // Provider filter pills in Generate Tab
    if (dom.studioGenProviderPills) {
        const pills = dom.studioGenProviderPills.querySelectorAll('.studio-gen-provider-pill');
        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => {
                    p.classList.remove('active', 'bg-amber-500', 'text-black', 'border-amber-400');
                    p.classList.add('bg-black/60', 'text-gray-300', 'border-white/10');
                });
                pill.classList.add('active', 'bg-amber-500', 'text-black', 'border-amber-400');
                pill.classList.remove('bg-black/60', 'text-gray-300', 'border-white/10');

                const prov = pill.getAttribute('data-provider') || 'all';
                populateStudioVoiceDropdown(prov, currentStudioSearchQuery, currentStudioLangFilter, currentStudioGenderFilter, currentStudioQualityFilter);
            });
        });
    }

    // Live Voice Search Input
    dom.studioVoiceSearchInput?.addEventListener('input', () => {
        const val = dom.studioVoiceSearchInput?.value || '';
        if (dom.studioVoiceSearchClearBtn) {
            dom.studioVoiceSearchClearBtn.classList.toggle('hidden', !val);
        }
        populateStudioVoiceDropdown(currentStudioProviderFilter, val, currentStudioLangFilter, currentStudioGenderFilter, currentStudioQualityFilter);
    });

    // Clear Voice Search Button
    dom.studioVoiceSearchClearBtn?.addEventListener('click', () => {
        if (dom.studioVoiceSearchInput) {
            dom.studioVoiceSearchInput.value = '';
            dom.studioVoiceSearchInput.focus();
        }
        dom.studioVoiceSearchClearBtn?.classList.add('hidden');
        populateStudioVoiceDropdown(currentStudioProviderFilter, '', currentStudioLangFilter, currentStudioGenderFilter, currentStudioQualityFilter);
    });

    // Quality Filter Dropdown
    dom.studioVoiceQualityFilter?.addEventListener('change', () => {
        const qual = dom.studioVoiceQualityFilter?.value || 'all';
        populateStudioVoiceDropdown(currentStudioProviderFilter, currentStudioSearchQuery, currentStudioLangFilter, currentStudioGenderFilter, qual);
    });

    // Language Filter Dropdown
    dom.studioVoiceLangFilter?.addEventListener('change', () => {
        const lang = dom.studioVoiceLangFilter?.value || 'all';
        populateStudioVoiceDropdown(currentStudioProviderFilter, currentStudioSearchQuery, lang, currentStudioGenderFilter, currentStudioQualityFilter);
    });

    // Gender Filter Dropdown
    dom.studioVoiceGenderFilter?.addEventListener('change', () => {
        const gen = dom.studioVoiceGenderFilter?.value || 'all';
        populateStudioVoiceDropdown(currentStudioProviderFilter, currentStudioSearchQuery, currentStudioLangFilter, gen, currentStudioQualityFilter);
    });

    // Voice dropdown selection change -> updates provider badge & supported controls
    dom.studioGenVoiceSelect?.addEventListener('change', () => {
        updateStudioVoiceControls();
    });

    // Set as Narration Voice Button
    dom.studioSetAsNarrationBtn?.addEventListener('click', () => {
        setStudioVoiceAsNarrationVoice();
    });

    // Reset controls button
    dom.studioResetControlsBtn?.addEventListener('click', () => {
        resetStudioVoiceControls();
    });

    // Speed slider
    dom.studioGenSpeedSlider?.addEventListener('input', () => {
        const val = parseFloat(dom.studioGenSpeedSlider?.value || '1.0');
        if (dom.studioGenSpeedValue) {
            dom.studioGenSpeedValue.textContent = `${val.toFixed(2)}x`;
        }
        updateStudioScriptStats();
    });

    // Pitch slider
    dom.studioGenPitchSlider?.addEventListener('input', () => {
        const val = parseInt(dom.studioGenPitchSlider?.value || '0', 10);
        if (dom.studioGenPitchValue) {
            dom.studioGenPitchValue.textContent = `${val >= 0 ? '+' : ''}${val}Hz`;
        }
    });

    // Volume slider
    dom.studioGenVolumeSlider?.addEventListener('input', () => {
        const val = parseInt(dom.studioGenVolumeSlider?.value || '0', 10);
        if (dom.studioGenVolumeValue) {
            dom.studioGenVolumeValue.textContent = `${val >= 0 ? '+' : ''}${val}%`;
        }
    });

    // Stability slider
    dom.studioGenStabilitySlider?.addEventListener('input', () => {
        const val = parseFloat(dom.studioGenStabilitySlider?.value || '0.5');
        if (dom.studioGenStabilityValue) {
            dom.studioGenStabilityValue.textContent = val.toFixed(2);
        }
    });

    // Similarity slider
    dom.studioGenSimilaritySlider?.addEventListener('input', () => {
        const val = parseFloat(dom.studioGenSimilaritySlider?.value || '0.75');
        if (dom.studioGenSimilarityValue) {
            dom.studioGenSimilarityValue.textContent = val.toFixed(2);
        }
    });

    // Style slider
    dom.studioGenStyleSlider?.addEventListener('input', () => {
        const val = parseFloat(dom.studioGenStyleSlider?.value || '0.0');
        if (dom.studioGenStyleValue) {
            dom.studioGenStyleValue.textContent = val.toFixed(2);
        }
    });

    // Script stats live update
    dom.studioScriptInput?.addEventListener('input', () => {
        updateStudioScriptStats();
    });

    // Sample script button
    dom.studioScriptSampleBtn?.addEventListener('click', () => {
        const sample = SAMPLE_SCRIPTS[Math.floor(Math.random() * SAMPLE_SCRIPTS.length)];
        if (dom.studioScriptInput) {
            dom.studioScriptInput.value = sample;
            updateStudioScriptStats();
        }
    });

    // Clear script button
    dom.studioScriptClearBtn?.addEventListener('click', () => {
        if (dom.studioScriptInput) {
            dom.studioScriptInput.value = '';
            updateStudioScriptStats();
        }
    });

    // Generate Audio button
    dom.studioGenerateAudioBtn?.addEventListener('click', () => {
        generateStudioAudio();
    });

    // Player Play/Pause button
    dom.studioPlayBtn?.addEventListener('click', () => {
        toggleStudioAudioPlayback();
    });

    // Player Seek Bar
    dom.studioSeekBar?.addEventListener('input', () => {
        if (!studioAudioBuffer) return;
        const pct = parseFloat(dom.studioSeekBar?.value || '0');
        const seekTime = (pct / 100) * studioAudioBuffer.duration;
        playStudioAudio(seekTime);
    });

    // Send to Master A-Roll button
    dom.studioSendToArollBtn?.addEventListener('click', () => {
        sendStudioAudioToMasterAroll();
    });

    // Download WAV button
    dom.studioDownloadWavBtn?.addEventListener('click', () => {
        downloadStudioWav();
    });

    // Download SRT button
    dom.studioDownloadSrtBtn?.addEventListener('click', () => {
        downloadStudioSrt();
    });

    // Audition Sample button
    let previewAudio: HTMLAudioElement | null = null;
    let geminiSource: AudioBufferSourceNode | null = null;
    const auditionBtn = document.getElementById('studio-audition-voice-btn');
    auditionBtn?.addEventListener('click', async () => {
        const selectedVoiceId = dom.studioGenVoiceSelect?.value || 'edge_en-US-AvaNeural';
        if (geminiSource) {
            try { geminiSource.stop(); } catch {}
            geminiSource = null;
            auditionBtn.innerHTML = '<span>▶ Audition Sample</span>';
            return;
        }
        if (previewAudio && !previewAudio.paused) {
            previewAudio.pause();
            previewAudio = null;
            auditionBtn.innerHTML = '<span>▶ Audition Sample</span>';
            return;
        }

        auditionBtn.innerHTML = '<span class="animate-pulse">⏳ Loading...</span>';
        try {
            const speed = parseFloat(dom.studioGenSpeedSlider?.value || '1.0');
            const pitch = parseFloat(dom.studioGenPitchSlider?.value || '0');
            const volume = parseFloat(dom.studioGenVolumeSlider?.value || '0');

            if (['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Iapetus', 'Enceladus'].includes(selectedVoiceId)) {
                const res = await generateSpeech('Hello! This is a preview of the Gemini neural voice.', selectedVoiceId, speed, pitch);
                const ctx = utils.getAudioContext();
                if (ctx.state === 'suspended') await ctx.resume();
                geminiSource = ctx.createBufferSource();
                geminiSource.buffer = res.buffer;
                geminiSource.connect(ctx.destination);
                auditionBtn.innerHTML = '<span>⏹ Stop Audition</span>';
                geminiSource.onended = () => {
                    auditionBtn.innerHTML = '<span>▶ Audition Sample</span>';
                    geminiSource = null;
                };
                geminiSource.start(0);
                return;
            }

            const cleanVoiceId = selectedVoiceId.replace(/^(edge_|kokoro_)/, '');
            const ratePercent = Math.round((speed - 1.0) * 100);
            const rateStr = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;
            const pitchStr = pitch >= 0 ? `+${pitch}Hz` : `${pitch}Hz`;
            const volumeStr = volume >= 0 ? `+${volume}%` : `${volume}%`;

            const res = await fetch('/api/tts/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    voice: cleanVoiceId,
                    text: 'Hello! This is a preview of this neural voice.',
                    rate: rateStr,
                    pitch: pitchStr,
                    volume: volumeStr
                })
            });
            if (!res.ok) throw new Error('Preview synthesis failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            previewAudio = new Audio(url);
            auditionBtn.innerHTML = '<span>⏹ Stop Audition</span>';
            previewAudio.onended = () => {
                auditionBtn.innerHTML = '<span>▶ Audition Sample</span>';
                URL.revokeObjectURL(url);
                previewAudio = null;
            };
            await previewAudio.play();
        } catch (e: any) {
            console.warn('Audition failed:', e);
            auditionBtn.innerHTML = '<span>▶ Audition Sample</span>';
            ui.showStatus(`Audition preview unavailable: ${e.message || e}`, true, 3000);
        }
    });
}
