/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { Type } from "@google/genai";
import { state } from './state';
import * as dom from './dom';
import * as ui from './ui';
import { generateContentWithFallback } from './api/core';
import { detectNarrativePerspective, extractCharacters, analyzeCharacterAppearance, analyzeSceneForCharacter } from './api/characters';
import { analyzeImageStyle } from './api/images';
import * as utils from './utils';
import * as constants from './constants';
import { DB } from './db';
import { saveVersion } from './handlers-project';
import type { CharacterProfile } from './types';
import { assetStorage } from './assetStorage';

// --- Cleanup Utility for Memory Management ---
class ImagePreviewManager {
    private activeUrls = new Set<string>();
    
    create(file: File | Blob): string {
        const url = URL.createObjectURL(file);
        this.activeUrls.add(url);
        return url;
    }
    
    revoke(url: string | null): void {
        if (url && this.activeUrls.has(url)) {
            URL.revokeObjectURL(url);
            this.activeUrls.delete(url);
        }
    }
    
    cleanup(): void {
        this.activeUrls.forEach(url => URL.revokeObjectURL(url));
        this.activeUrls.clear();
    }
}

export const imagePreviewManager = new ImagePreviewManager();

export function cleanupSceneImage(shot: any) {
  if (shot?._imageObjectURL) {
    imagePreviewManager.revoke(shot._imageObjectURL);
    delete shot._imageObjectURL;
  }
}

export function cleanupAllSceneImages() {
  state.currentScenes.forEach(scene => {
    const shots = scene.lines || [scene];
    shots.forEach((shot: any) => cleanupSceneImage(shot));
  });
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        cleanupAllSceneImages();
        imagePreviewManager.cleanup();
    });
}

// --- Generic Entity Filters ---

const GENERIC_PATTERNS = {
    characters: {
        exact: new Set([
            'you', 'i', 'we', 'they', 'he', 'she', 'it', 'them', 'us',
            'someone', 'anyone', 'everyone', 'no one', 'nobody', 'somebody',
            'the narrator', 'narrator', 'the audience', 'the reader', 'the viewer',
            'people', 'the people', 'crowd', 'the crowd', 'villagers', 'the villagers',
            'team', 'the team', 'group', 'the group'
        ]),
        patterns: [
            /^(a|an|the)\s+(person|man|woman|worker|builder|leader|boss|manager|employee|staff)$/i,
            /^(the\s+)?coworker|partner|worker|builder|leader|adversary|enemy|saboteur|broker$/i
        ]
    },
    locations: {
        exact: new Set([
            'somewhere', 'anywhere', 'everywhere', 'nowhere',
            'here', 'there', 'outside', 'inside'
        ]),
        patterns: [
            /^(a|an|the)\s+(room|office|building|house|street|place|area|region|town|city|village|location)$/i
        ]
    },
    elements: {
        exact: new Set([
            'something', 'anything', 'everything', 'nothing',
            'money', 'the money', 'cash', 'the cash', 'tools', 'weapons', 'documents'
        ]),
        patterns: [
            /^(a|an|the)\s+(thing|object|item|tool|weapon|device|watch|phone|document|machine)$/i
        ]
    }
};

function createGenericFilter(type: keyof typeof GENERIC_PATTERNS) {
    return (items: Array<{name: string, description?: string, appearance_anchor?: string}>): Array<any> => {
        const config = GENERIC_PATTERNS[type];
        
        return items.filter(item => {
            const nameLower = item.name.toLowerCase().trim();
            
            // Filter out exact generic matches
            if (config.exact.has(nameLower)) {
                return false;
            }
            
            // Filter out pattern-based generic matches
            const matchesGenericPattern = config.patterns.some(pattern => pattern.test(nameLower));
            if (matchesGenericPattern) {
                return false;
            }
            
            return true;
        });
    };
}

const filterGenericCharacters = createGenericFilter('characters');
const filterGenericLocations = createGenericFilter('locations');
const filterGenericElements = createGenericFilter('elements');


// --- Unified Asset Identification ---

type AssetType = 'character' | 'location' | 'element';
type StateKey = 'characterProfiles' | 'locationProfiles' | 'keyElementProfiles';

interface IdentifyConfig {
    type: AssetType;
    prompt: (story: string) => string;
    schemaKey: string;
    stateKey: StateKey;
    filterFn: (items: any[]) => any[];
    renderFn: (items: any[]) => void;
    domList: HTMLElement;
    tabBtn: HTMLButtonElement | null;
    progressMessage: string;
    emptyMessage: string;
    emptyHtml: string;
}

const ASSET_CONFIGS: Record<AssetType, IdentifyConfig> = {
    character: {
        type: 'character',
        prompt: (story: string) => `Identify ONLY distinct individual characters from this story (including non-human characters like animals, insects, or robots if they act as characters). For each named character, output:
- name (Full canonical name, e.g. "Joseph Bates")
- aliases: array of all alternate names, first names, last names, titles, or nicknames used to refer to this character in the story (e.g. ["Joseph", "Bates", "Captain Bates", "Joe"])
- appearance_anchor
- role_keywords: 3-6 SPECIFIC phrases or terms from the story that refer to this character/entity (e.g., ["these bugs", "the insects", "stubborn creatures"]).

appearance_anchor must be a compact, production-ready description of stable visual traits for image consistency.
It MUST be formatted exactly with two sections: a compact paragraph of identity anchors, followed by a new line starting with "Never:" listing 4-8 hard locks.

Example format (Human):
Male, late 50s. Bald, thick gray beard. Sun-weathered olive skin, long angular face, dark eyes. Lean, rugged, upright. Rough wool prophetic mantle over simple earth-toned tunic.
Never: hair on scalp, clean-shaven, young, modern or royal clothing.

Example format (Non-Human):
Small jumping spider, fuzzy black and white exoskeleton. Large reflective main eyes, bright green iridescent pedipalps. Quick, twitchy posture.
Never: human features, other spider species, smooth exoskeleton, missing eyes.

Include only:
species/type (if non-human), apparent age, gender presentation (if clearly implied), coloring/skin/fur tone, face shape, hair/texture, eyes, build, height, posture, defining marks, and default clothing (if applicable).

Rules:
- Do NOT infer ethnicity, religion, nationality, disability, or other sensitive traits unless explicitly stated.
- If details are missing, make a conservative visual production choice rather than writing "unspecified" for every field.
- The goal is visual consistency across repeated image generations.
- Add 4–8 constraints after "Never:" for traits that would break character identity.
- Do NOT include mood, actions, camera, lighting, location, props, or backstory.
- **INCLUDE the main character/protagonist** as the first entry if they are a specific individual.
- **Name vs. Title Rule**: If a character has a name and a title (e.g., "King Ahab", "Doctor Smith"), use their proper name as the 'name' (e.g., "Ahab", "Smith"). The title should be part of the description. If a character is only ever referred to by a title (e.g., "the King", "the Doctor"), then use that title as their 'name'.
- **EXCLUDE generic background characters** like "someone", "everyone", "the narrator", "workers", "people", "villagers", "the crowd". Only identify specific, named, or distinct individuals.

Story:
${story}`,
        schemaKey: 'characters',
        stateKey: 'characterProfiles',
        filterFn: filterGenericCharacters,
        renderFn: ui.renderCharacterList,
        domList: dom.characterList,
        tabBtn: document.getElementById('tab-characters-btn') as HTMLButtonElement | null,
        progressMessage: 'Extracting character profiles...',
        emptyMessage: 'No specific named characters found.',
        emptyHtml: `<div class="text-center text-gray-400 p-8 bg-gray-800/50 rounded-lg">No Key Characters Found</div>`
    },
    location: {
        type: 'location',
        prompt: (story: string) => `Your task is to act as a location scout. Strictly identify ONLY the distinct physical locations or settings from the following story. You must NOT identify characters, objects, or concepts. For each location, provide a name and a detailed visual description of its atmosphere, lighting, and key features. Do NOT include generic locations like "somewhere", "outside", "a room", "the office", or "the street". Only identify specific, named, or distinct settings. Story:\n\n${story}`,
        schemaKey: 'locations',
        stateKey: 'locationProfiles',
        filterFn: filterGenericLocations,
        renderFn: ui.renderLocationList,
        domList: dom.locationList,
        tabBtn: document.getElementById('tab-locations-btn') as HTMLButtonElement | null,
        progressMessage: 'Extracting location details...',
        emptyMessage: 'No specific unique locations found.',
        emptyHtml: `<div class="text-center text-gray-400 p-8 bg-gray-800/50 rounded-lg">No Specific Locations Found</div>`
    },
    element: {
        type: 'element',
        prompt: (story: string) => `Analyze the following story and identify key physical objects or elements that are vital to the plot and appear more than once. Strictly do NOT identify characters or locations. For each element, provide a name and a detailed visual description for maintaining consistency in a text-to-image AI. Do NOT include generic items unless they are unique and specific. Story:\n\n${story}`,
        schemaKey: 'elements',
        stateKey: 'keyElementProfiles',
        filterFn: filterGenericElements,
        renderFn: ui.renderKeyElementList,
        domList: dom.keyElementList,
        tabBtn: document.getElementById('tab-elements-btn') as HTMLButtonElement | null,
        progressMessage: 'Extracting object details...',
        emptyMessage: 'No specific key elements found.',
        emptyHtml: `<div class="text-center text-gray-400 p-8 bg-gray-800/50 rounded-lg">No Key Elements Found</div>`
    }
};

/**
 * Runs character frequency analysis after story input changes or characters are identified.
 */
export function analyzeCharacterFrequency() {
    const storyText = dom.storyInput.value.trim();
    if (!storyText || state.characterProfiles.length === 0) {
        ui.renderCharacterList(state.characterProfiles); // Still render to show empty state
        return;
    }
    
    let changesMade = false;
    state.characterProfiles.forEach(char => {
        // Use full alias and first-name regex to accurately detect character mentions
        const regex = utils.buildCharacterRegex(char, state.characterProfiles);
        const matches = storyText.match(new RegExp(regex.source, 'gi'));
        const newFrequency = matches ? matches.length : 0;
        
        if (char.frequency !== newFrequency) {
            char.frequency = newFrequency;
            changesMade = true;
        }

        // Auto-enable consistency for characters by default if not explicitly set
        if (char.enforce_consistency === undefined) {
            char.enforce_consistency = true;
            changesMade = true;
        }
    });
    
    // Re-render to show frequency badges and save if changes were made
    ui.renderCharacterList(state.characterProfiles);
    if (changesMade) {
        saveVersion(false);
    }
}

type SafeCharacterSeed = {
    name: string;
    role?: string;
    age_band?: 'child' | 'teen' | 'adult' | 'elderly' | 'unknown';
    gender_presentation?: 'feminine' | 'masculine' | 'ambiguous' | 'unknown';
};

function isProhibitedContentError(error: any): boolean {
    const msg = String(error?.message || error || '').toUpperCase();
    return (
        msg.includes('PROHIBITED_CONTENT') ||
        msg.includes('SAFETY') ||
        msg.includes('BLOCKED')
    );
}

function buildSafeCharacterFallbackPrompt(story: string): string {
    return `Identify ONLY distinct named or clearly specific individual characters from this story.

For each character output:
- name
- role
- age_band: one of "child", "teen", "adult", "elderly", "unknown"
- gender_presentation: one of "feminine", "masculine", "ambiguous", "unknown"

Rules:
- Do NOT generate detailed physical appearance.
- Do NOT infer ethnicity, religion, nationality, disability, or attractiveness.
- If age is not clearly stated, use "unknown".
- If gender presentation is not clearly implied, use "unknown".
- INCLUDE the main protagonist first if they are a specific individual.
- EXCLUDE generic background groups like "everyone", "people", "villagers", "crowd", "workers".

Return ONLY valid JSON.

Story:
${story}`;
}

function buildFallbackAppearanceAnchor(seed: SafeCharacterSeed): string {
    const age = seed.age_band ?? 'unknown';
    const gender = seed.gender_presentation ?? 'unknown';

    let desc = '';
    let constraints = '';

    if (age === 'child' && gender === 'feminine') {
        desc = 'Young girl, about 10-12, feminine presentation. Round youthful face, dark shoulder-length hair, brown eyes. Slim build, short height, gentle upright posture. No visible scars. Wears a simple earth-toned village dress and sandals.';
        constraints = 'adult appearance, elderly appearance, modern clothing, armor, heavy makeup, non-human traits.';
    } else if (age === 'child' && gender === 'masculine') {
        desc = 'Young boy, about 10-12, masculine presentation. Round youthful face, short dark hair, brown eyes. Slim build, short height, gentle upright posture. No visible scars. Wears a simple earth-toned village tunic and sandals.';
        constraints = 'adult appearance, elderly appearance, modern clothing, armor, beard, non-human traits.';
    } else if (age === 'child') {
        desc = 'Child, about 10-12, youthful presentation. Round youthful face, dark medium-length hair, brown eyes. Slim build, short height, gentle upright posture. No visible scars. Wears simple earth-toned village clothing and sandals.';
        constraints = 'adult appearance, elderly appearance, modern clothing, armor, exaggerated makeup, non-human traits.';
    } else if (age === 'teen') {
        const title = gender === 'feminine' ? 'Teen girl' : gender === 'masculine' ? 'Teen boy' : 'Teenager';
        const pres = gender !== 'unknown' ? `${gender} presentation` : 'natural presentation';
        desc = `${title}, ${pres}. Youthful face, dark hair, brown eyes. Slim build, average height, upright posture. No visible scars. Wears simple period-appropriate clothing.`;
        constraints = `elderly appearance, modern clothing, armor, non-human traits, ${gender === 'masculine' ? 'beard' : 'heavy makeup'}.`;
    } else if (age === 'elderly') {
        const title = gender === 'feminine' ? 'Elderly woman' : gender === 'masculine' ? 'Elderly man' : 'Elderly person';
        const pres = gender !== 'unknown' ? `${gender} presentation` : 'natural presentation';
        desc = `${title}, ${pres}. Aged face with fine facial lines, dark-to-gray hair, brown eyes. Average build, average height, measured posture. Wears simple period-appropriate clothing.`;
        constraints = 'child appearance, teen appearance, modern clothing, armor, non-human traits.';
    } else {
        const title = gender === 'feminine' ? 'Adult woman' : gender === 'masculine' ? 'Adult man' : 'Adult person';
        const pres = gender !== 'unknown' ? `${gender} presentation` : 'natural presentation';
        desc = `${title}, ${pres}. Oval face, dark hair, brown eyes. Average build, average height, upright posture. No visible scars. Wears simple period-appropriate clothing.`;
        constraints = 'child appearance, elderly appearance, modern clothing, armor, non-human traits.';
    }

    return `${desc}\nNever: ${constraints}`;
}

function normalizeFallbackCharacters(items: SafeCharacterSeed[]): CharacterProfile[] {
    return items.map(item => ({
        name: item.name,
        appearance_anchor: buildFallbackAppearanceAnchor(item),
        enforce_consistency: true
    }));
}

async function identifyAssets(config: IdentifyConfig) {
    const storyText = (dom.storyInput?.value || '').trim();
    if (!storyText) {
        ui.showStatus("Please enter your story or script in Step 1 first.", true, 3000);
        return;
    }

    ui.setButtonsDisabled(true);
    const title = `Analyzing ${config.type.charAt(0).toUpperCase() + config.type.slice(1)}s`;
    await ui.openProcessingModal(title);
    ui.updateProcessingProgress(0, 'Reading story text...');
    if (config.domList) config.domList.innerHTML = ui.renderAssetSkeleton(3);

    const stopProgress = utils.startSimulatedProgress(config.progressMessage, ui.updateProcessingProgress);

    try {
        const charSchemaProperties = {
            name: { type: Type.STRING },
            aliases: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            },
            appearance_anchor: { type: Type.STRING },
            role_keywords: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        };

        const standardSchemaProperties = {
            name: { type: Type.STRING },
            description: { type: Type.STRING }
        };

        let items: any[] = [];

        try {
            const response = await generateContentWithFallback({
                contents: config.prompt(storyText),
                systemInstruction: 'You are a structured data extraction assistant. Return valid JSON only.',
                mimeType: 'application/json',
                schema: {
                    type: Type.OBJECT,
                    properties: {
                        [config.schemaKey]: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: config.type === 'character' ? charSchemaProperties : standardSchemaProperties,
                                required: config.type === 'character'
                                    ? ['name', 'appearance_anchor']
                                    : ['name', 'description']
                            }
                        }
                    },
                    required: [config.schemaKey]
                },
                maxOutputTokens: 8192
            });

            const result = utils.sanitizeAndParseJson(response.text ?? '{}');
            items = result[config.schemaKey] || [];
        } catch (error: any) {
            if (!(config.type === 'character' && isProhibitedContentError(error))) {
                throw error;
            }

            ui.updateProcessingProgress(45, 'Primary character extraction blocked. Retrying with safe mode...');

            const fallbackResponse = await generateContentWithFallback({
                contents: buildSafeCharacterFallbackPrompt(storyText),
                systemInstruction: 'You are a structured data extraction assistant. Return valid JSON only.',
                mimeType: 'application/json',
                schema: {
                    type: Type.OBJECT,
                    properties: {
                        characters: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    role: { type: Type.STRING },
                                    age_band: { type: Type.STRING },
                                    gender_presentation: { type: Type.STRING }
                                },
                                required: ['name']
                            }
                        }
                    },
                    required: ['characters']
                },
                maxOutputTokens: 4096
            });

            const fallbackResult = utils.sanitizeAndParseJson(fallbackResponse.text ?? '{}');
            const seeds = (fallbackResult.characters || []) as SafeCharacterSeed[];
            items = normalizeFallbackCharacters(seeds);
        }

        stopProgress();
        ui.updateProcessingProgress(100, 'Analysis complete!');

        items = config.filterFn(items);

        if (config.type === 'character' || config.type === 'location' || config.type === 'element') {
            items.forEach((item: any) => {
                if (config.type === 'character') {
                    // Populate derived aliases (first name, last name, titles) if missing
                    const derived = utils.getCharacterAliases(item, items as CharacterProfile[]);
                    const existing = Array.isArray(item.aliases) ? item.aliases : [];
                    const merged = Array.from(new Set([...existing, ...derived]));
                    item.aliases = merged.filter((a: string) => a.toLowerCase() !== (item.name || '').toLowerCase());
                    if (item.enforce_consistency === undefined) {
                        item.enforce_consistency = true;
                    }
                    item._nameRegex = utils.buildCharacterRegex(item, items as CharacterProfile[]);
                } else {
                    item._nameRegex = new RegExp(`\\b${utils.escapeRegExp(item.name)}\\b`, 'i');
                }
            });
        }

        state[config.stateKey] = items as any;

        if (config.type === 'character') {
            analyzeCharacterFrequency();
        } else {
            if (items.length === 0) {
                ui.showStatus(config.emptyMessage, false, 5000);
                config.domList.innerHTML = config.emptyHtml;
            } else {
                config.renderFn(items);
            }
        }

        if (items.length > 0) {
            const count = items.length;
            const noun = config.type.charAt(0).toUpperCase() + config.type.slice(1);
            const plural = count === 1 ? noun : `${noun}s`;

            ui.showStatus(
                `${count} ${plural} identified. Please review their descriptions.`,
                false,
                4000
            );
        }

        if (config.tabBtn) {
            config.tabBtn.disabled = false;
        }

        const tabName = `${config.type}s` as ui.TabName;
        setTimeout(() => {
            try {
                ui.switchTab(tabName);
            } catch (e) {
                console.warn(`ui.switchTab('${tabName}') failed, falling back to tabBtn.click():`, e);
                if (config.tabBtn) config.tabBtn.click();
            }
        }, 150);

        saveVersion(false);

        ui.updateWorkflowStepStatus(1, 'completed');
        ui.updateWorkflowStepStatus(2, 'completed');
        ui.updateWorkflowStepStatus(3, 'active');

    } catch (error: any) {
        stopProgress();
        let errorMsg = `Error identifying ${config.type}s`;
        const isQuota = error.message?.includes('Quota') || error.message?.toLowerCase().includes('quota');
        if (isQuota) {
            errorMsg = 'API quota exceeded. Please wait a moment and try again.';
            ui.showStatus(`Notice: ${errorMsg}`, false, 5000);
        } else {
            if (error.message?.includes('network')) {
                errorMsg = 'Network error. Please check your connection.';
            } else if (error.message) {
                errorMsg += `: ${error.message}`;
            }
            ui.showStatus(errorMsg, true, 5000);
        }
    } finally {
        setTimeout(() => {
            ui.closeProcessingModal();
            ui.setButtonsDisabled(false);
        }, 800);
    }
}

export async function identifyCharacters() {
    const storyText = (dom.storyInput?.value || '').trim();
    if (!storyText) {
        ui.showStatus("Please enter your story or script in Step 1 first.", true, 3000);
        return;
    }

    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Analyzing Characters');
    ui.updateProcessingProgress(0, 'Detecting narrative perspective...');

    const stopProgress = utils.startSimulatedProgress(
        'Detecting narrative perspective...',
        ui.updateProcessingProgress
    );

    let stopProgress2: (() => void) | null = null;
    let handedOffToAssets = false;

    try {
        const isFirstPerson = await detectNarrativePerspective(storyText);

        stopProgress();
        ui.updateProcessingProgress(
            25,
            isFirstPerson
                ? 'First-person detected. Extracting narrator timeline...'
                : 'Third-person detected. Identifying characters...'
        );

        if (isFirstPerson) {
            stopProgress2 = utils.startSimulatedProgress(
                'Extracting narrator timeline...',
                ui.updateProcessingProgress,
                25
            );

            const result = await extractCharacters(storyText, true);

            stopProgress2();
            stopProgress2 = null;

            ui.updateProcessingProgress(90, 'Processing character profiles...');

            if (result.type === 'narrator') {
                const timeline = result.timeline;
                state.characterTimeline = timeline;
                
                // Convert to character profile format
                const narratorProfile: CharacterProfile = {
                    name: timeline.narratorProfile.name,
                    appearance_anchor: timeline.narratorProfile.currentDescription,
                    enforce_consistency: false, // Do not enforce consistency for the narrator by default
                };
                
                state.characterProfiles = [narratorProfile];
                
                // Add other characters if any
                if (result.otherCharacters) {
                    state.characterProfiles.push(...filterGenericCharacters(result.otherCharacters));
                }
                
            } else {
                // Standard multi-character extraction fallback
                state.characterProfiles = filterGenericCharacters(result.characters || []);
            }
            
            ui.updateProcessingProgress(100, 'Complete!');
            analyzeCharacterFrequency();
            if(dom.tabCharactersBtn) dom.tabCharactersBtn.disabled = false;
            ui.switchTab('characters');
            saveVersion(false);

            ui.updateWorkflowStepStatus(1, 'completed');
            ui.updateWorkflowStepStatus(2, 'completed');
            ui.updateWorkflowStepStatus(3, 'active');
        } else {
            handedOffToAssets = true;
            // Removed ui.closeProcessingModal() to prevent flicker during handoff
            return identifyAssets(ASSET_CONFIGS.character);
        }
    } catch (error: any) {
        ui.showStatus(`Character detection failed: ${error.message}`, true, 5000);
    } finally {
        stopProgress();
        if (stopProgress2) stopProgress2();
        if (!handedOffToAssets) {
            // Add a small delay before closing to ensure UI has time to render
            setTimeout(() => {
                ui.closeProcessingModal();
                ui.setButtonsDisabled(false);
            }, 800);
        }
    }
}

export function identifyLocations() { return identifyAssets(ASSET_CONFIGS.location); }
export function identifyKeyElements() { return identifyAssets(ASSET_CONFIGS.element); }

export function handleAddCustomCharacter() {
    const newChar: CharacterProfile = {
        name: "New Character",
        aliases: [],
        appearance_anchor: "A detailed description of the character's appearance.",
        enforce_consistency: true,
        frequency: 1,
        _nameRegex: utils.buildCharacterRegex({ name: "New Character", appearance_anchor: "" }, state.characterProfiles)
    };
    state.characterProfiles.unshift(newChar);
    ui.renderCharacterList(state.characterProfiles);
    saveVersion(false);
}

// --- Assets Handlers ---

export async function handleCharacterListClick(event: Event) {
    const target = event.target as HTMLElement;
    const deleteBtn = target.closest('.delete-char-btn');
    const uploadBtn = target.closest('.upload-char-img-btn');
    const removeImgBtn = target.closest('.remove-char-img-btn');
    const artDirectorBtn = target.closest('.art-director-btn');
    const analyzeBtn = target.closest('.analyze-char-img-btn');
    const consistencyToggle = target.closest('.consistency-checkbox');

    if (deleteBtn) {
        const name = (deleteBtn as HTMLElement).dataset.name!;
        ui.showConfirmation(`Delete ${name}?`, 'Are you sure you want to delete this character profile?', () => {
            state.characterProfiles = state.characterProfiles.filter(c => c.name !== name);
            ui.renderCharacterList(state.characterProfiles);
            saveVersion(false);
            ui.showStatus(`Deleted profile: ${name}`, false, 3000);
        });
    } else if (uploadBtn) {
        const index = (uploadBtn as HTMLElement).dataset.index!;
        document.getElementById(`char-img-input-${index}`)?.click();
    } else if (removeImgBtn) {
        const index = parseInt((removeImgBtn as HTMLElement).dataset.index!, 10);
        state.characterProfiles[index].image = null;
        ui.renderCharacterList(state.characterProfiles);
        saveVersion(false);
    } else if (artDirectorBtn) {
        const index = parseInt((artDirectorBtn as HTMLElement).dataset.index!, 10);
        const char = state.characterProfiles[index];
        if (char.image) {
            // Logic for AI Art Director on existing image
        }
    } else if (analyzeBtn) {
        const index = parseInt((analyzeBtn as HTMLElement).dataset.index!, 10);
        const char = state.characterProfiles[index];
        if (char.image) {
            const btn = analyzeBtn as HTMLButtonElement;
            const originalText = btn.innerHTML;
            btn.innerHTML = 'Analyzing...';
            btn.disabled = true;
            try {
                const description = await analyzeCharacterAppearance(char.image);
                char.appearance_anchor = description;
                ui.renderCharacterList(state.characterProfiles);
                saveVersion(false);
                ui.showStatus(`Analyzed appearance for ${char.name}`, false, 3000);
            } catch (e: any) {
                ui.showStatus(`Analysis failed: ${e.message}`, true, 4000);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    } else if (consistencyToggle) {
        const checkbox = consistencyToggle as HTMLInputElement;
        const name = checkbox.dataset.name!;
        const char = state.characterProfiles.find(c => c.name === name);
        if (char) {
            char.enforce_consistency = checkbox.checked;
            saveVersion(false);
        }
    }
}

export async function handleCharacterImageUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const index = parseInt(input.dataset.index!, 10);
    const file = input.files[0];
    const { data, mimeType } = await utils.fileToBase64(file);
    state.characterProfiles[index].image = { data, mimeType };
    ui.renderCharacterList(state.characterProfiles);
    saveVersion(false);
}

export function handleCharacterInput(event: Event) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('character-name-input')) {
        const input = target as HTMLInputElement;
        const index = parseInt(input.dataset.index!, 10);
        if (state.characterProfiles[index]) {
            state.characterProfiles[index].name = input.value;
            state.characterProfiles[index]._nameRegex = utils.buildCharacterRegex(state.characterProfiles[index], state.characterProfiles);
            
            // Update data-name attributes on sibling elements to keep them in sync
            const container = target.closest(`[data-index="${index}"]`);
            if (container) {
                const elementsWithDataName = container.querySelectorAll('[data-name]');
                elementsWithDataName.forEach(el => {
                    (el as HTMLElement).dataset.name = input.value;
                });
            }
            saveVersion(false);
        }
    } else if (target.classList.contains('character-aliases-input')) {
        const input = target as HTMLInputElement;
        const index = parseInt(input.dataset.index!, 10);
        if (state.characterProfiles[index]) {
            state.characterProfiles[index].aliases = input.value.split(',').map(s => s.trim()).filter(Boolean);
            state.characterProfiles[index]._nameRegex = utils.buildCharacterRegex(state.characterProfiles[index], state.characterProfiles);
            saveVersion(false);
        }
    } else if (target.classList.contains('character-anchor-input')) {
        const input = target as HTMLTextAreaElement;
        const index = parseInt(input.closest('[data-index]')?.getAttribute('data-index') || '-1', 10);
        if (index >= 0 && state.characterProfiles[index]) {
            state.characterProfiles[index].appearance_anchor = input.value;
            saveVersion(false);
        }
    } else if (target.classList.contains('universal-character-radio')) {
        const input = target as HTMLInputElement;
        const index = parseInt(input.dataset.index || '-1', 10);
        if (index >= 0) {
            state.characterProfiles.forEach((p, i) => {
                p.is_universal = (i === index && input.checked);
            });
            ui.renderCharacterList(state.characterProfiles);
            saveVersion(false);
        }
    } else if (target.classList.contains('consistency-checkbox')) {
        const input = target as HTMLInputElement;
        // Find index based on parent container
        const index = parseInt(target.closest('[data-index]')?.getAttribute('data-index') || '-1', 10);
        if (index >= 0 && state.characterProfiles[index]) {
            state.characterProfiles[index].enforce_consistency = input.checked;
            saveVersion(false);
        }
    }
}

export function handleLocationListClick(event: Event) {
    // Similar logic for location deletion, etc.
}

export function handleKeyElementListClick(event: Event) {
    // Similar logic for element deletion, etc.
}

export async function handleCustomImageUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (state.customStyleImagePreviewUrl) {
        URL.revokeObjectURL(state.customStyleImagePreviewUrl);
    }
    state.customStyleImageFile = file;
    state.customStyleImagePreviewUrl = imagePreviewManager.create(file);
    
    dom.customStyleImagePreview.innerHTML = `
        <img src="${state.customStyleImagePreviewUrl}" class="w-full h-full object-cover">
        <button id="remove-custom-style-image-btn" class="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full">&times;</button>
    `;
    dom.analyzeStyleBtn.classList.remove('hidden');
}

export async function handleAnalyzeStyleFromImage() {
    if (!state.customStyleImageFile) return;

    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Analyzing Image Style');
    ui.updateProcessingProgress(20, 'Uploading image...');
    try {
        const { data, mimeType } = await utils.fileToBase64(state.customStyleImageFile);
        ui.updateProcessingProgress(60, 'AI is analyzing style...');
        const stylePrompt = await analyzeImageStyle({ data, mimeType });
        dom.customStyleAnalyzedPrompt.value = stylePrompt;
        ui.updateProcessingProgress(100, 'Style analyzed!');
        ui.showStatus('Style analysis complete.', false, 2000);
        saveVersion(false);
    } catch (error) {
        ui.showStatus(`Failed to analyze style: ${error}`, true, 5000);
    } finally {
        setTimeout(() => {
            ui.closeProcessingModal();
        }, 800);
    }
}

export async function handleAddNewReferenceImages(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    
    for (const file of Array.from(input.files)) {
        try {
            const { data, mimeType } = await utils.fileToBase64(file);
            const item = {
                id: Date.now() + Math.random(),
                timestamp: Date.now(),
                name: file.name,
                data,
                mimeType,
            };
            await DB.put(constants.REFERENCE_IMAGE_STORE, item);
        } catch (e) {
            console.error("Failed to add reference image:", e);
        }
    }
    
    ui.renderReferenceLibrary();
    input.value = ''; // Reset file input
}

export function clearReferenceImageLibrary() {
    ui.showConfirmation('Clear Library?', 'Are you sure you want to delete all reference images?', async () => {
        try {
            await DB.clear(constants.REFERENCE_IMAGE_STORE);
            ui.renderReferenceLibrary();
        } catch (e) {
            console.error("Failed to clear reference image library:", e);
            ui.showStatus("Failed to clear reference library.", true);
        }
    });
}

export async function handleSelectReferenceImage(id: string) {
    const image = await DB.get(constants.REFERENCE_IMAGE_STORE, parseFloat(id));
    if (image) {
        state.selectedReferenceImage = image;
        dom.referenceLibraryModal.classList.add('hidden');
        ui.updateReferenceImagePreview();
        ui.updateAspectRatioState();
    }
}

export function handleDeleteReferenceImage(id: string) {
    ui.showConfirmation('Delete Image?', 'Are you sure?', async () => {
        try {
            await DB.delete(constants.REFERENCE_IMAGE_STORE, parseFloat(id));
            if (state.selectedReferenceImage?.id === parseFloat(id)) {
                state.selectedReferenceImage = null;
                ui.updateReferenceImagePreview();
                ui.updateAspectRatioState();
            }
            ui.renderReferenceLibrary();
        } catch (e) {
            console.error("Failed to delete reference image:", e);
            ui.showStatus("Failed to delete reference image.", true);
        }
    });
}

/**
 * Build image prompt with smart character context
 * Call this from your storyboard/image generation code
 */
export async function buildScenePromptWithCharacterContext(
    sceneText: string,
    characterTimeline: any
): Promise<{ description: string; metadata: any }> {
    
    if (!characterTimeline) {
        return {
            description: sceneText,
            metadata: { hasCharacter: false, sceneType: 'standard' }
        };
    }

    // Analyze this specific scene
    const sceneContext = await analyzeSceneForCharacter(sceneText, characterTimeline);
    
    let finalSceneDescription = '';
    
    if (sceneContext.shouldShowCharacter && sceneContext.characterAge) {
        // Find the matching character description from timeline
        let characterDesc = '';
        
        if (sceneContext.characterAge === characterTimeline.narratorProfile.currentAge) {
            // Use current age description
            characterDesc = characterTimeline.narratorProfile.currentDescription;
        } else {
            // Find matching life stage
            const lifeStage = characterTimeline.lifeStages.find((stage: any) => 
                sceneContext.characterAge.includes(stage.ageRange) ||
                sceneContext.reasoning.toLowerCase().includes(stage.period.toLowerCase())
            );
            
            if (lifeStage) {
                characterDesc = lifeStage.visualDescription;
            } else {
                characterDesc = characterTimeline.narratorProfile.currentDescription;
            }
        }
        
        // Combine character with scene
        finalSceneDescription = `${characterDesc}. ${sceneText}`;
        
    } else {
        // No character - just the scene (symbolic/environmental)
        finalSceneDescription = sceneText;
    }
    
    return {
        description: finalSceneDescription,
        metadata: {
            hasCharacter: sceneContext.shouldShowCharacter,
            characterAge: sceneContext.characterAge,
            sceneType: sceneContext.sceneType,
            reasoning: sceneContext.reasoning
        }
    };
}