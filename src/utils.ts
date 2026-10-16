import { audioBufferToWavBlob, pacingMap, getMatchingResolutionKey, getGuest320pResolutionKey, EXPORT_RESOLUTION_MAP, calculatePlaceholderDuration, splitScriptIntoStoryChunks } from './utils-core';
export { getGuest320pResolutionKey, calculatePlaceholderDuration, splitScriptIntoStoryChunks };
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as dom from './dom';
import { state } from './state';

import { timelineState } from './state-timeline';
import { StyleIntent, styleIntentMap, INTENT_NEGATIVE_PROMPTS, NEGATIVE_PROMPT } from './constants';
import type { WordTimestamp, AspectRatio, CameraKeyframe, CameraKeyframesConfig, CharacterProfile } from './types';
import { assetStorage } from './assetStorage';

export function formatSrtTime(seconds: number): string {
    const pad = (n: number, z = 2) => ('00' + n).slice(-z);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

export function formatVttTime(seconds: number): string {
    const pad = (n: number, z = 2) => ('00' + n).slice(-z);
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
}

export interface SubtitleCue {
    start: number;
    end: number;
    text: string;
}

/**
 * Splits a list of word timestamps into natural, sentence/phrase-aware subtitle cues.
 * Breaks on punctuation (. ? ! , ; : —), spoken pauses (>= 0.45s), or reasonable character/word lengths.
 */
export function chunkWordsIntoSubtitleCues(words: WordTimestamp[], maxWords = 8, maxChars = 38): SubtitleCue[] {
    if (!words || words.length === 0) return [];
    const cues: SubtitleCue[] = [];
    let currentCueWords: WordTimestamp[] = [];

    const flush = () => {
        if (currentCueWords.length === 0) return;
        const start = currentCueWords[0].start;
        const end = currentCueWords[currentCueWords.length - 1].end;
        const text = currentCueWords.map(w => w.word).join(' ').trim();
        if (text) {
            cues.push({ start, end, text });
        }
        currentCueWords = [];
    };

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const prev = currentCueWords[currentCueWords.length - 1];

        // If there is a natural spoken pause between previous word end and this word start (>= 0.45s)
        if (prev && (w.start - prev.end >= 0.45)) {
            flush();
        }

        currentCueWords.push(w);

        const currentText = currentCueWords.map(x => x.word).join(' ');
        const wordText = w.word.trim();
        const hasTerminalPunctuation = /[.!?…]$/.test(wordText);
        const hasClausePunctuation = /[,;:\-—]$/.test(wordText);

        // Break immediately on sentence end (. ? !)
        if (hasTerminalPunctuation) {
            flush();
        } else if (hasClausePunctuation && (currentCueWords.length >= 4 || currentText.length >= 24)) {
            // Break on clause punctuation if we have enough words/characters
            flush();
        } else if (currentCueWords.length >= maxWords || currentText.length >= maxChars) {
            flush();
        }
    }

    flush();
    return cues;
}

export function parseSRTBlocks(srt: string): { start: number, end: number, text: string, words: WordTimestamp[] }[] {
    const lines = srt.trim().split(/\r?\n\r?\n/);
    const result: { start: number, end: number, text: string, words: WordTimestamp[] }[] = [];

    for (const block of lines) {
        const parts = block.split(/\r?\n/).map(p => p.trim());
        const timeLine = parts.find(p => p.includes('-->'));
        if (timeLine) {
            const timeMatches = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,\.](\d{1,3})/);
            if (timeMatches) {
                const parseTime = (h: string, m: string, s: string, ms: string) => {
                    const msNum = parseInt(ms.padEnd(3, '0'));
                    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + msNum / 1000;
                };
                const start = parseTime(timeMatches[1], timeMatches[2], timeMatches[3], timeMatches[4]);
                const end = Math.max(start + 0.05, parseTime(timeMatches[5], timeMatches[6], timeMatches[7], timeMatches[8]));

                const textStartIndex = parts.indexOf(timeLine) + 1;
                const text = parts.slice(textStartIndex).join(' ').trim();
                const wordsArr = text.split(/\s+/).filter(w => w.length > 0);

                const words: WordTimestamp[] = [];
                if (wordsArr.length > 0) {
                    const totalDur = end - start;
                    const weights = wordsArr.map(w => {
                        let weight = Math.max(1.5, w.replace(/[^a-zA-Z0-9]/g, '').length);
                        if (/[.!?…;—]$/.test(w)) weight += 3.2;
                        else if (/[,:]$/.test(w)) weight += 1.6;
                        return weight;
                    });
                    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
                    let cursor = start;
                    wordsArr.forEach((w, i) => {
                        const wDur = (weights[i] / totalWeight) * totalDur;
                        words.push({
                            word: w,
                            start: Number(cursor.toFixed(3)),
                            end: Number((cursor + wDur).toFixed(3))
                        });
                        cursor += wDur;
                    });
                }

                result.push({ start, end, text, words });
            }
        }
    }
    return result;
}

export function parseSRT(srt: string): WordTimestamp[] {
    return parseSRTBlocks(srt).flatMap(block => block.words);
}

function buildSubtitleCuesFromWordsOrClips(words: WordTimestamp[], clips?: any[]): SubtitleCue[] {
    if (clips && clips.length > 0) {
        const cues: SubtitleCue[] = [];
        for (const clip of clips) {
            const clipStart = typeof clip.startTime === 'number' ? clip.startTime : 0;
            const clipEnd = typeof clip.endTime === 'number' ? clip.endTime : clipStart + (clip.duration || 2);

            if (clip.wordTimestamps && clip.wordTimestamps.length > 0) {
                const isRelative = clip.wordTimestampMode === 'relative' || clip.wordTimestamps[0].start < clipStart - 0.05;
                const absWords: WordTimestamp[] = clip.wordTimestamps.map((w: WordTimestamp) => {
                    const absStart = isRelative ? clipStart + w.start : w.start;
                    const absEnd = isRelative ? clipStart + w.end : w.end;
                    return {
                        word: w.word,
                        start: absStart,
                        end: Math.max(absStart + 0.05, absEnd)
                    };
                });
                cues.push(...chunkWordsIntoSubtitleCues(absWords));
            } else if (clip.text && clip.text.trim()) {
                cues.push({
                    start: clipStart,
                    end: clipEnd,
                    text: clip.text.trim()
                });
            }
        }
        return cues;
    }
    return chunkWordsIntoSubtitleCues(words);
}

export function generateSRT(words: WordTimestamp[], clips?: any[]): string {
    const cues = buildSubtitleCuesFromWordsOrClips(words, clips);
    let srt = '';
    for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        srt += `${i + 1}\n`;
        srt += `${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n`;
        srt += `${cue.text}\n\n`;
    }
    return srt;
}

export function generateVTT(words: WordTimestamp[], clips?: any[]): string {
    const cues = buildSubtitleCuesFromWordsOrClips(words, clips);
    let vtt = 'WEBVTT\n\n';
    for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        vtt += `${i + 1}\n`;
        vtt += `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n`;
        vtt += `${cue.text}\n\n`;
    }
    return vtt;
}

// Pre-compiled regex for safeRephrase
const REPHRASE_SHOOT = /(?<!(wide|medium|close-up|camera|establishing) )\b(shoot|shot|gunshot)\b(?! of (whiskey|tequila))/gi;
const REPHRASE_GUN = /\bgun\b/gi;
const REPHRASE_FIREARM = /\b(pistol|rifle|shotgun)\b/gi;
const REPHRASE_BLADE = /\b(knife|sword)\b/gi;
const REPHRASE_BULLET = /\bbullet\b/gi;
const REPHRASE_VIOLENCE = /\b(attack|strike)\b/gi;
const REPHRASE_BLOOD = /\bblood\b/gi;
const REPHRASE_BLOODY = /\bbloody\b/gi;
const REPHRASE_EXPLODE = /\bexplode\b/gi;
const REPHRASE_DEATH = /\b(dead|died|killed|kill|murder|death)\b/gi;
const REPHRASE_CORPSE = /\bcorpse\b/gi;
const REPHRASE_WOUND = /\bwound\b/gi;
const REPHRASE_GORE = /\b(gore|gory)\b/gi;
const REPHRASE_CHILD_DANGER = /\b(child|girl|boy|kid)\b(?=.*(blood|kill|dead|knife|gun|weapon|danger|wound))/gi;
const REPHRASE_CHILD_EMOTION = /\b(crying child|scared child)\b/gi;
const REPHRASE_SEXY = /\bsexy\b/gi;
const REPHRASE_SEDUCTIVE = /\bseductive\b/gi;
const REPHRASE_NUDE = /\b(naked|nude)\b/gi;
const REPHRASE_INTIMATE = /\b(kissing|intimate)\b/gi;
const REPHRASE_PASSION = /\b(bed scene|passion)\b/gi;
const REPHRASE_THREAT_KILL = /\b(I'll kill you|I will kill you)\b/gi;
const REPHRASE_THREAT_SHOOT = /\b(I'll shoot)\b/gi;
const REPHRASE_SELF_HARM = /\b(suicide|self-harm)\b/gi;
const REPHRASE_INSANE = /\b(insane|crazy|madman)\b/gi;
const REPHRASE_AFTERLIFE = /\b(hell|heaven)\b/gi;
const REPHRASE_DEMON = /\b(demon|devil)\b/gi;
const REPHRASE_HOSTAGE = /\bhostage\b/gi;
const REPHRASE_TERRORIST = /\bterrorist\b/gi;
const REPHRASE_GANGSTER = /\bgangster\b/gi;
const REPHRASE_FINAL_KILL = /\b(kill|murder|slaughter)\b/gi;
const REPHRASE_FINAL_STAB = /\bstab\b/gi;
const REPHRASE_FINAL_BLEED = /\bbleed\b/gi;

/**
 * Wraps story or prompt content with a literary/documentary context preamble to prevent
 * false-positive PROHIBITED_CONTENT blocks from the Gemini API classifier on dramatic or sensitive themes.
 */
export function wrapContentForApi(storyText: string): string {
    if (!storyText) return "";
    if (storyText.startsWith('[CONTENT CONTEXT:')) return storyText;
    
    const sensitivePatterns = [
        /\b(child|children|kid|daughter|son|baby|toddler)\b/i,
        /\b(shelter|homeless|poverty|abuse|neglect|struggle|grief|pain|death|die|died|killed|kill|war|battle|blood|wound|weapon|gun|knife|attack|fight|arrest|police|jail|prison)\b/i,
        /\b\d+[\s-]year[\s-]old\b/i,
        /\b(dark|shadow|trauma|tragedy|scared|afraid|alone|desperate|crisis|loss|revenge|betrayal)\b/i
    ];

    const needsFraming = sensitivePatterns.some(p => p.test(storyText));
    if (!needsFraming) return storyText;

    return `[CONTENT CONTEXT: The following is a creative literary narrative and dramatic script intended for cinematic video pre-production and educational storytelling. All characters and situations are fictional expressions. Depictions of struggle, adversity, and dramatic emotion are presented purely in a humanizing, artistic context.]\n\n${storyText}`;
}

export function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    // Return a string to avoid potential number-to-string conversion issues with keys
    return `hash_${hash.toString(36)}`;
}

export const BASE_PIXELS_PER_SECOND = 100;
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 10;


/**
 * Escapes special characters in a string for use in a regular expression.
 */
export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Automatically extracts nicknames, first names, last names, and explicit aliases for a character,
 * avoiding collisions with other characters in the project.
 */
export function getCharacterAliases(char: CharacterProfile, allProfiles?: CharacterProfile[]): string[] {
    const aliases = new Set<string>();
    const trimmedName = (char.name || '').trim();
    if (trimmedName) {
        aliases.add(trimmedName);
    }

    // Strip quotation marks or trailing punctuation
    const cleanName = trimmedName.replace(/^["'“]+|[”"',]+$/g, '').trim();
    if (cleanName && cleanName !== trimmedName) {
        aliases.add(cleanName);
    }

    // Add user/AI-provided explicit aliases
    if (Array.isArray(char.aliases)) {
        for (const a of char.aliases) {
            const clean = (a || '').trim().replace(/^["'“]+|[”"',]+$/g, '');
            if (clean) aliases.add(clean);
        }
    }

    // Include role keywords if they look like unique aliases or titles (e.g. "Captain Bates", "the Captain")
    if (Array.isArray(char.role_keywords)) {
        for (const kw of char.role_keywords) {
            const clean = (kw || '').trim().replace(/^["'“]+|[”"',]+$/g, '');
            if (clean && clean.length >= 3 && clean.length <= 32 && !clean.includes('\n')) {
                // Avoid ultra-generic solitary pronouns or articles
                if (!/^(the|a|an|he|she|they|it|him|her|them)$/i.test(clean)) {
                    aliases.add(clean);
                }
            }
        }
    }

    // Deconstruct multi-word name: e.g. "Joseph Bates", "Dr. John Watson", "Captain Jack Sparrow", "Elder Joseph Bates"
    const nameToSplit = cleanName || trimmedName;
    if (nameToSplit.includes(' ')) {
        const parts = nameToSplit.split(/\s+/).map(p => p.replace(/[,\.]/g, '').trim()).filter(Boolean);
        
        // Common titles/honorifics
        const titles = new Set([
            'dr', 'dr.', 'doctor', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'miss',
            'prof', 'prof.', 'professor', 'captain', 'capt', 'capt.', 'sgt', 'sgt.',
            'sergeant', 'officer', 'agent', 'detective', 'father', 'pastor', 'reverend',
            'rev.', 'sir', 'lord', 'lady', 'king', 'queen', 'prince', 'princess',
            'uncle', 'aunt', 'judge', 'elder', 'brother', 'sister', 'bishop', 'deacon',
            'commander', 'admiral', 'general', 'lieutenant', 'colonel', 'major',
            'sheriff', 'marshal', 'constable', 'mother', 'grandpa', 'grandma'
        ]);
        
        let startIdx = 0;
        let titleFound = '';
        if (parts.length > 1 && titles.has(parts[0].toLowerCase())) {
            titleFound = parts[0];
            startIdx = 1;
        }

        const namePartsWithoutTitle = parts.slice(startIdx);
        if (namePartsWithoutTitle.length > 0) {
            const firstName = namePartsWithoutTitle[0];
            
            // Handle suffixes like "Jr", "III"
            const nonLastNames = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'the', 'van', 'de', 'von']);
            let lastIdx = namePartsWithoutTitle.length - 1;
            if (namePartsWithoutTitle.length > 2 && nonLastNames.has(namePartsWithoutTitle[lastIdx].toLowerCase())) {
                lastIdx--;
            }
            const lastName = namePartsWithoutTitle[lastIdx];

            // Other profiles to check for ambiguity (excluding this character by reference and normalized name)
            const otherProfiles = (allProfiles || []).filter(p => 
                p !== char && 
                p.name && 
                p.name.trim().toLowerCase() !== trimmedName.toLowerCase()
            );

            // First name (e.g. "Joseph"): safe if length >= 3 and no other character shares the same first name
            if (firstName.length >= 3) {
                const collidesWithOther = otherProfiles.some(other => {
                    const otherParts = (other.name || '').trim().split(/\s+/).map(p => p.replace(/[,\.]/g, '').trim()).filter(Boolean);
                    const otherFirst = titles.has(otherParts[0]?.toLowerCase()) ? otherParts[1] : otherParts[0];
                    return (otherFirst || '').toLowerCase() === firstName.toLowerCase();
                });
                if (!collidesWithOther) {
                    aliases.add(firstName);
                    if (titleFound) {
                        aliases.add(`${titleFound} ${firstName}`);
                    }
                }
            }

            // Last name (e.g. "Bates"): safe if length >= 3 and not common suffixes
            if (namePartsWithoutTitle.length > 1 && lastName.length >= 3 && !nonLastNames.has(lastName.toLowerCase())) {
                const collidesWithOther = otherProfiles.some(other => {
                    const otherParts = (other.name || '').trim().split(/\s+/).map(p => p.replace(/[,\.]/g, '').trim()).filter(Boolean);
                    const otherLast = otherParts[otherParts.length - 1];
                    return (otherLast || '').toLowerCase() === lastName.toLowerCase();
                });
                if (!collidesWithOther) {
                    aliases.add(lastName);
                    if (titleFound) {
                        aliases.add(`${titleFound} ${lastName}`);
                    }
                }
            }

            // Full name without title if a title was present
            if (titleFound && namePartsWithoutTitle.length > 1) {
                aliases.add(namePartsWithoutTitle.join(' '));
            }

            // Middle name omission: e.g. "Joseph C Bates" -> "Joseph Bates"
            if (namePartsWithoutTitle.length > 2) {
                aliases.add(`${firstName} ${lastName}`);
            }
        }
    }

    // Sort by length descending so longer phrases match first (e.g. "Joseph Bates" before "Joseph")
    return Array.from(aliases).sort((a, b) => b.length - a.length);
}

/**
 * Builds a regex that matches the character's full name or any unambiguous aliases.
 */
export function buildCharacterRegex(char: CharacterProfile, allProfiles?: CharacterProfile[]): RegExp {
    const aliases = getCharacterAliases(char, allProfiles);
    if (aliases.length === 0) {
        return new RegExp(`\\b${escapeRegExp(char.name || 'Character')}\\b`, 'i');
    }
    const escaped = aliases.map(escapeRegExp).join('|');
    return new RegExp(`\\b(?:${escaped})\\b`, 'i');
}

/**
 * Injects character appearance anchors into a prompt wherever the character's name or alias appears.
 * Also checks contextText (e.g. shot narration) if the prompt itself omitted the character's name.
 * Idempotent: will not duplicate if the character anchor is already present.
 */
export function injectCharacterConsistencyIntoPrompt(promptText: string, contextText?: string): string {
    if (!promptText || typeof promptText !== 'string') return promptText || '';
    if (!state.characterProfiles || state.characterProfiles.length === 0) {
        return promptText;
    }

    let enriched = promptText;
    const combinedContext = contextText && typeof contextText === 'string' ? contextText.trim() : '';

    for (const char of state.characterProfiles) {
        if (!char.name || char.enforce_consistency === false) continue;
        const anchor = (char.appearance_anchor || char.sheet_prompt || (char as any).description || '').trim();
        if (!anchor) continue;

        // Skip if anchor already present in this prompt to avoid duplication
        if (enriched.includes(anchor)) continue;

        const aliases = getCharacterAliases(char, state.characterProfiles);
        if (aliases.length === 0) continue;

        // Match whole-word character name or alias not already immediately followed by (
        const escapedAliases = aliases.map(escapeRegExp).join('|');
        const namePattern = new RegExp(`\\b(${escapedAliases})\\b(?!\\s*\\()`, 'i');
        
        if (namePattern.test(enriched)) {
            // Replace the first mention in the prompt with: Canonical Name (anchor)
            // e.g. "Joseph stands on deck" -> "Joseph Bates (elderly sea captain...) stands on deck"
            enriched = enriched.replace(namePattern, `${char.name} (${anchor})`);
        } else if (combinedContext && namePattern.test(combinedContext)) {
            // The prompt itself didn't mention the character by name, but the narration segment does!
            // e.g. Narration: "Joseph navigated the storm", Prompt: "A ship battling enormous waves"
            // -> "Featuring Joseph Bates (anchor): A ship battling enormous waves"
            enriched = `Featuring ${char.name} (${anchor}): ${enriched}`;
        } else if (char.is_universal && !enriched.includes('Featuring ')) {
            // Universal protagonist fallback for scenes without any named characters
            enriched = `Featuring ${char.name} (${anchor}): ${enriched}`;
        }
    }
    return enriched;
}

/**
 * Clamps a number between a minimum and maximum value.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/**
 * Detects silences in an AudioBuffer using RMS energy analysis.
 * Features an adaptive noise-floor detector for cross-voice robustness.
 */
export function detectSilences(
    buffer: AudioBuffer, 
    threshold?: number, 
    minDuration: number = 0.25
): { start: number, end: number }[] {
    const data = buffer.getChannelData(0); // Analyze mono or left channel
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.floor(sampleRate * 0.02); // 20ms windows
    
    // 1. Estimate Noise Floor from a time-ordered series
    const rmsSeries: number[] = [];
    for (let i = 0; i < data.length; i += windowSize) {
        let sumSq = 0;
        const endIdx = Math.min(i + windowSize, data.length);
        for (let j = i; j < endIdx; j++) {
            sumSq += data[j] * data[j];
        }
        rmsSeries.push(Math.sqrt(sumSq / (endIdx - i)));
    }
    
    // Use a sorted copy to find the 15th percentile (noise floor)
    const sortedRms = [...rmsSeries].sort((a, b) => a - b);
    const p15 = sortedRms[Math.floor(sortedRms.length * 0.15)] || 0.01;
    // Auto-threshold: 1.4x the noise floor, but at least 0.008
    const thr = threshold ?? Math.max(0.008, p15 * 1.4);
    
    // 2. Detect Segments using the original time-ordered series
    const silences: { start: number, end: number }[] = [];
    let currentSilenceStart: number | null = null;
    
    for (let i = 0; i < rmsSeries.length; i++) {
        const time = (i * windowSize) / sampleRate;
        const rms = rmsSeries[i]; // Use the unsorted value for correct time mapping
        
        if (rms < thr) {
            if (currentSilenceStart === null) currentSilenceStart = time;
        } else {
            if (currentSilenceStart !== null) {
                const duration = time - currentSilenceStart;
                if (duration >= minDuration) {
                    silences.push({ start: currentSilenceStart, end: time });
                }
                currentSilenceStart = null;
            }
        }
    }
    
    if (currentSilenceStart !== null) {
        silences.push({ start: currentSilenceStart, end: buffer.duration });
    }
    
    return silences;
}

/**
 * Finds the earliest point in the next silence gap following a given timestamp.
 */
export function isAIStudio(): boolean {
    return window.location.hostname.includes('run.app') || window.location.hostname.includes('aistudio');
}

export function getNextSafeTransitionPoint(
    currentTime: number, 
    silences: { start: number, end: number }[], 
    maxLookahead: number = 1.0
): number | null {
    for (const s of silences) {
        // Find silence that starts after the current word ends
        if (s.start >= currentTime - 0.05) {
            // If it's within a reasonable distance, return it
            if (s.start <= currentTime + maxLookahead) {
                // Transition ideally happens 50ms into silence to avoid transients
                return s.start + 0.05;
            }
            break; 
        }
    }
    return null;
}

/**
 * Finds the nearest silence boundary (start or end) to a given time.
 */
export function getNearestSilenceBoundary(
  t: number,
  silences: { start: number; end: number }[],
  tolerance: number = 0.12 // 120ms
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;

  for (const s of silences) {
    // avoid transients by adding a small buffer from the edge of silence
    const candidates = [s.start + 0.05, s.end - 0.05]; 
    for (const c of candidates) {
      const d = Math.abs(c - t);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  return bestDist <= tolerance ? best : null;
}

export function sanitizeSceneForStyle(sceneText: string): string {
    const styleKeywords = /\b(style|aesthetic|vibe|look|cinematic|gothic|anime|realistic|cartoon|3d|painting|sketch|noir|horror|photorealistic|illustrated|animated|documentary)\b/gi;
    return sceneText.replace(styleKeywords, (match) => {
        const replacements: { [key: string]: string } = {
            'cinematic': 'dramatic',
            'gothic': 'architectural',
            'anime': 'youthful',
            'realistic': 'detailed',
            'cartoon': 'stylized',
            '3d': 'rendered',
            'painting': 'painted',
            'sketch': 'drawn',
            'noir': 'shadowy',
            'horror': 'eerie',
            'photorealistic': 'lifelike',
            'illustrated': 'drawn',
            'animated': 'moving',
            'documentary': 'factual',
            'style': 'appearance',
            'aesthetic': 'look',
            'vibe': 'mood',
            'look': 'appearance'
        };
        return replacements[match.toLowerCase()] || match;
    });
}

export function truncatePrompt(prompt: string, maxLength: number = 4096): string {
    if (prompt.length <= maxLength) return prompt;

    // CHARACTER_MODIFIER_FIX F1: the character design note is appended LAST by
    // buildPromptForModel, so naive tail-truncation deleted the audience's
    // character design on long prompts. Protect that segment, truncate the
    // base prompt, then re-append it.
    const MODIFIER_MARKERS = [' Character design note:', '[CHARACTER MODIFIER]'];
    let protectedSuffix = '';
    let base = prompt;
    for (const marker of MODIFIER_MARKERS) {
        const idx = base.indexOf(marker);
        if (idx !== -1) {
            protectedSuffix = base.slice(idx);
            base = base.slice(0, idx);
            break;
        }
    }

    const budget = Math.max(100, maxLength - protectedSuffix.length);
    const parts = base.split('.');
    let truncated = '';
    for (const part of parts) {
        if ((truncated + part).length > budget) break;
        truncated += part + '.';
    }
    const head = (truncated.trim() || base.substring(0, budget).trim());
    return protectedSuffix ? (head + protectedSuffix).trim() : head.trim();
}

export function buildPromptForModel(
    styleTemplate: string,
    sceneDescription: string,
    model: string,
    negativePrompt: string,
    styleIntent?: StyleIntent,
    characterModifier?: string
): string {
    const sanitizedScene = sanitizeSceneForStyle(sceneDescription);
    const isImagen = model.startsWith('imagen');
    const intentNegative = styleIntent ? INTENT_NEGATIVE_PROMPTS[styleIntent] : negativePrompt;

    let positiveStyle = styleTemplate;
    if (positiveStyle.includes('[scene]')) {
        positiveStyle = positiveStyle.replace(/\[scene\]/g, sanitizedScene);
    } else {
        positiveStyle = `${sanitizedScene}. ${positiveStyle}`;
    }

    if (characterModifier) {
        positiveStyle += buildCharacterModifierSuffix(characterModifier);
        // CHARACTER_MODIFIER_FIX F2: the style template gets its [scene]
        // replaced above, but the modifier is appended after that pass — any
        // [scene] inside it would leak literally into the final prompt.
        positiveStyle = positiveStyle.replace(/\[scene\]/g, sanitizedScene);
    }

    if (isImagen) {
        // Imagen 4.0 responds strongly to camera/lens language.
        // It prefers natural descriptive sentences.
        let finalPrompt = positiveStyle;
        finalPrompt += `\nShot on 35mm lens, high optical quality, cinematic photography.`;
        if (intentNegative) {
            finalPrompt += `\nAvoid these elements entirely: ${intentNegative}`;
        }
        return finalPrompt;
    } else {
        // Gemini 2.5 responds to narrative framing.
        // It also prefers natural descriptive sentences.
        let finalPrompt = positiveStyle;
        finalPrompt += `\nThis image plays a key narrative role in the story. Ensure strong emotional framing and storytelling execution.`;
        if (intentNegative) {
            finalPrompt += `\nDo not include any of the following: ${intentNegative}`;
        }
        return finalPrompt + `\nRender the entire scene exclusively in the visual style described. Do not deviate.`;
    }
}

/**
 * CHARACTER_MODIFIER_FIX F3: weighted wording for the character design note.
 * Use at ANY image-generation call site so the chosen character style is
 * applied consistently across the whole app (scenes, graphics, edits, etc.):
 *   prompt += utils.buildCharacterModifierSuffix(ui.getCurrentCharacterModifier(), 'strong');
 */
export function buildCharacterModifierSuffix(modifier: string, weight: 'subtle' | 'normal' | 'strong' = 'normal'): string {
    if (!modifier || !modifier.trim()) return '';
    let wording = modifier;
    if (weight === 'subtle') wording = `${modifier} (apply subtly; do not let it override realism or naturalism)`;
    if (weight === 'strong') wording = `STRICT: ${modifier} — every character in this image must obey this design without exception`;
    return ` Character design note: ${wording}`;
}

export function safeRephrase(prompt: string): { rewritten: boolean, newPrompt: string } {
    const originalPrompt = prompt;
    let rewrittenPrompt = prompt;
    const allowlist = [
        "Colt Peacemaker", "plasma rifle", "light saber", "revolver", "flintlock",
        "camera shot", "wide shot", "medium shot", "close-up shot", "establishing shot",
        "shot of whiskey", "shot of tequila"
    ];
    const placeholderMap: { [placeholder: string]: string } = {};
    allowlist.forEach((phrase, index) => {
        const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
        if (regex.test(rewrittenPrompt)) {
            const placeholder = `__PLACEHOLDER_${index}__`;
            placeholderMap[placeholder] = phrase;
            rewrittenPrompt = rewrittenPrompt.replace(regex, placeholder);
        }
    });
    const rules: [RegExp, string][] = [
        [REPHRASE_SHOOT, 'unleashed a deafening echo'],
        [REPHRASE_GUN, 'weapon (cinematic)'],
        [REPHRASE_FIREARM, 'firearm (cinematic)'],
        [REPHRASE_BLADE, 'blade (cinematic)'],
        [REPHRASE_BULLET, 'projectile in motion'],
        [REPHRASE_VIOLENCE, 'moved with force'],
        [REPHRASE_BLOOD, 'crimson marking'],
        [REPHRASE_BLOODY, 'blood-stained'],
        [REPHRASE_EXPLODE, 'erupt with force'],
        [REPHRASE_DEATH, 'fallen figure'],
        [REPHRASE_CORPSE, 'lifeless form'],
        [REPHRASE_WOUND, 'mark of pain'],
        [REPHRASE_GORE, 'intense cinematic effect'],
        [REPHRASE_CHILD_DANGER, 'heroic young figure'],
        [REPHRASE_CHILD_EMOTION, 'thoughtful young soul'],
        [REPHRASE_SEXY, 'elegant'],
        [REPHRASE_SEDUCTIVE, 'captivating'],
        [REPHRASE_NUDE, 'artistic pure form'],
        [REPHRASE_INTIMATE, 'a moment of emotional closeness'],
        [REPHRASE_PASSION, 'a quiet, unspoken bond'],
        [REPHRASE_THREAT_KILL, 'You will regret this'],
        [REPHRASE_THREAT_SHOOT, 'Don\'t test me'],
        [REPHRASE_SELF_HARM, 'a moment of fading light'],
        [REPHRASE_INSANE, 'an unhinged and obsessed figure'],
        [REPHRASE_AFTERLIFE, 'the great beyond'],
        [REPHRASE_DEMON, 'a shadowy presence'],
        [REPHRASE_HOSTAGE, 'trapped figure'],
        [REPHRASE_TERRORIST, 'rebel operative'],
        [REPHRASE_GANGSTER, 'urban outlaw'],
    ];
    for (const [pattern, replacement] of rules) {
        rewrittenPrompt = rewrittenPrompt.replace(pattern, replacement);
    }
    const finalPassRules: [RegExp, string][] = [
        [REPHRASE_FINAL_KILL, 'silence'],
        [REPHRASE_FINAL_STAB, 'lunge with a blade'],
        [REPHRASE_FINAL_BLEED, 'show a sign of injury'],
    ];
    for (const [pattern, replacement] of finalPassRules) {
        rewrittenPrompt = rewrittenPrompt.replace(pattern, replacement);
    }
    for (const placeholder in placeholderMap) {
        const originalPhrase = placeholderMap[placeholder];
        const regex = new RegExp(escapeRegExp(placeholder), 'g');
        rewrittenPrompt = rewrittenPrompt.replace(regex, originalPhrase);
    }
    const rewritten = originalPrompt.toLowerCase() !== rewrittenPrompt.toLowerCase();
    return { rewritten, newPrompt: rewrittenPrompt };
}

export function sanitizeFilename(name: string): string {
    if (!name) return 'storyboard';
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w-]/g, '').substring(0, 50);
}

/**
 * Derives a clean, readable filename from the first few words of the script, story, or project narration.
 */
export function getScriptDerivedTitle(maxWords = 5): string {
    let rawText = '';

    // 1. Try active story input in DOM
    if (dom.storyInput && dom.storyInput.value && dom.storyInput.value.trim()) {
        rawText = dom.storyInput.value.trim();
    }

    // 2. Try state.originalStory or state.story
    if (!rawText && (state as any).originalStory && typeof (state as any).originalStory === 'string') {
        rawText = (state as any).originalStory.trim();
    }
    if (!rawText && (state as any).story && typeof (state as any).story === 'string') {
        rawText = (state as any).story.trim();
    }

    // 3. Try master audio transcript
    if (!rawText && Array.isArray(state.masterAudioTranscript) && state.masterAudioTranscript.length > 0) {
        rawText = state.masterAudioTranscript.map(w => w.word).join(' ').trim();
    }

    // 4. Try timeline clips (spoken narration in clips)
    if (!rawText && timelineState.clips && Array.isArray(timelineState.clips) && timelineState.clips.length > 0) {
        const firstClip = timelineState.clips.find(c => c.text && typeof c.text === 'string' && c.text.trim() && !/^(?:master\s+a-?roll|a-?roll)$/i.test(c.text.trim()));
        if (firstClip && firstClip.text) {
            rawText = firstClip.text.trim();
        }
    }

    // 5. Try currentScenes
    if (!rawText && state.currentScenes && Array.isArray(state.currentScenes) && state.currentScenes.length > 0) {
        for (const sc of state.currentScenes) {
            if ((sc as any).line_text && typeof (sc as any).line_text === 'string' && (sc as any).line_text.trim()) {
                rawText = (sc as any).line_text.trim();
                break;
            }
            if ((sc as any).lines && Array.isArray((sc as any).lines) && (sc as any).lines.length > 0) {
                const line = (sc as any).lines.find((l: any) => l.line_text && l.line_text.trim());
                if (line) {
                    rawText = line.line_text.trim();
                    break;
                }
            }
            if ((sc as any).scene_description && typeof (sc as any).scene_description === 'string' && (sc as any).scene_description.trim()) {
                rawText = (sc as any).scene_description.trim();
                break;
            }
        }
    }

    if (rawText) {
        // Strip stage directions, markdown, quotes, and punctuation
        const cleaned = rawText
            .replace(/\[.*?\]|\(.*?\)/g, ' ')
            .replace(/^[#\s\-*=>]+/gm, '')
            .replace(/[#*_~`>]/g, '')
            .replace(/["'“”‘’]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const words = cleaned.split(/\s+/).filter(w => w.length > 0).slice(0, maxWords);
        if (words.length > 0) {
            const joined = words.join(' ');
            const sanitized = sanitizeFilename(joined);
            if (sanitized && sanitized.length >= 2) {
                return sanitized;
            }
        }
    }

    return '';
}


export function fileToBase64(file: File): Promise<{ data: string, mimeType: string }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = reader.result as string;
            const base64Data = result.split(',')[1];
            resolve({ data: base64Data, mimeType: file.type });
        };
        reader.onerror = (error) => reject(error);
    });
}

export function base64ToBlob(base64: any, mimeType: string): Blob {
    let rawStr = '';
    if (typeof base64 === 'string') {
        rawStr = base64;
    } else if (base64 && typeof base64 === 'object') {
        rawStr = base64.data || base64.base64 || base64.url || '';
        if (base64.mimeType && !mimeType) {
            mimeType = base64.mimeType;
        }
    }
    const cleanBase64 = rawStr.includes(',') ? rawStr.split(',')[1] : rawStr;
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Standard utility for triggering a file download. 
 * Robustified to prevent browser navigation and handle restricted environments.
 */
export async function downloadBlob(
    blob: Blob, 
    filename: string, 
    options?: { forceDialog?: boolean; category?: 'Projects' | 'Videos' | 'Audio' | 'Assets' }
): Promise<void> {
    try {
        // Attempt native Electron export (auto-managed workspace routing or dialog)
        if ((window as any).electronAPI) {
            try {
                const electron = (window as any).electronAPI;
                const invoke = electron.invoke || electron.ipcRenderer?.invoke;
                if (invoke) {
                    const arrayBuffer = await blob.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // If not explicitly forcing a dialog, auto-save into workspace
                    if (!options?.forceDialog) {
                        try {
                            const { resolveWorkspacePath, writeDirectToWorkspace, openWorkspaceFolder } = await import(/* @vite-ignore */ './workspaceManager');
                            const targetPath = await resolveWorkspacePath(filename, { category: options?.category });
                            if (targetPath) {
                                const writeResult = await writeDirectToWorkspace(targetPath, uint8Array);
                                if (writeResult.success) {
                                    const shortName = targetPath.split(/[/\\]/).pop() || filename;
                                    console.log(`[Export] Auto-saved to workspace: ${targetPath}`);
                                    try {
                                        const { showStatus } = await import(/* @vite-ignore */ './ui');
                                        showStatus(`Saved "${shortName}" to your workspace`, false, 6000, {
                                            label: '📂 Open Folder',
                                            onClick: () => {
                                                try {
                                                    invoke.call(electron, 'show-item-in-folder', targetPath);
                                                } catch (e) {
                                                    openWorkspaceFolder(options?.category);
                                                }
                                            }
                                        });
                                    } catch (statusErr) {
                                        console.warn("Could not display status notification:", statusErr);
                                    }
                                    return;
                                }
                            }
                        } catch (wsErr) {
                            console.warn("Auto-save to workspace failed, falling back to dialog:", wsErr);
                        }
                    }

                    // Fallback to native Save As dialog
                    const filters = [];
                    if (filename.endsWith('.mp4')) filters.push({ name: 'Video', extensions: ['mp4'] });
                    else if (filename.endsWith('.contentgenai')) filters.push({ name: 'Project File', extensions: ['contentgenai'] });
                    else if (filename.endsWith('.cgproj')) filters.push({ name: 'Project File', extensions: ['cgproj'] });
                    else if (filename.endsWith('.zip')) filters.push({ name: 'Archive', extensions: ['zip'] });
                    else if (filename.endsWith('.csv')) filters.push({ name: 'CSV', extensions: ['csv'] });
                    else if (filename.endsWith('.txt')) filters.push({ name: 'Text', extensions: ['txt'] });
                    else if (filename.endsWith('.json')) filters.push({ name: 'JSON', extensions: ['json'] });
                    
                    const result = await invoke.call(electron, 'save-file', {
                        data: uint8Array,
                        defaultPath: filename,
                        filters: filters.length ? filters : undefined,
                        category: options?.category
                    });
                    
                    if (result.success) {
                        try {
                            const savedPath = result.filePath || filename;
                            const shortName = savedPath.split(/[/\\]/).pop() || filename;
                            const { showStatus } = await import(/* @vite-ignore */ './ui');
                            showStatus(`Saved "${shortName}" successfully`, false, 6000, {
                                label: '📂 Show File',
                                onClick: () => {
                                    if (result.filePath) {
                                        invoke.call(electron, 'show-item-in-folder', result.filePath);
                                    }
                                }
                            });
                        } catch (statusErr) {
                            console.warn("Could not display status notification:", statusErr);
                        }
                        return; // Successfully saved via native dialog
                    } else if (result.canceled) {
                        return; // User canceled the native dialog, don't fallback to browser
                    }
                    // If error occurred but not canceled, fallback to browser method
                    console.warn("Electron native save failed, falling back to browser.", result.error);
                }
            } catch (e) {
                console.warn("Could not use Electron IPC, falling back to browser download:", e);
            }
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        
        document.body.appendChild(link);
        link.click();
        
        // Show web export notification informing user where to find their file
        try {
            const { showStatus } = await import(/* @vite-ignore */ './ui');
            showStatus(`Exported "${filename}" to your browser's Downloads folder.`, false, 5000);
        } catch (statusErr) {
            console.warn("Could not display status notification:", statusErr);
        }

        // Use a longer cleanup delay to ensure the browser has actually started the download process,
        // which can be flaky in virtualization/iframe layers like AI Studio.
        setTimeout(() => {
            if (link.parentNode) {
                document.body.removeChild(link);
            }
            URL.revokeObjectURL(url);
        }, 1000); 
    } catch (error) {
        console.error('Download failed:', error);
        try {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) {
            console.warn("Window open fallback failed:", e);
            // Assume (window as any).showStatusFn might not be imported or available locally, but we'll try
            try {
                 // @ts-ignore
                 (window as any).showStatusFn('Download failed. Try right-clicking and saving manually.', true, 5000);
            } catch(uiErr) {
                console.warn("Could not display download error status:", uiErr);
            }
        }
    }
}

export function updateProgressBar(current: number, total: number) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    dom.progressBar.style.width = `${percentage}%`;
}



export function estimateShots(narrationMinutes: number, pacingFactor: "documentary" | "glacial" | "snail" | "very_slow" | "slow" | "normal" | "fast"): string {
    if (narrationMinutes <= 0) return '';
    // @ts-ignore
    const range = pacingMap[pacingFactor] || pacingMap["normal"];
    const minShots = Math.max(1, Math.round(narrationMinutes * range.min));
    const maxShots = Math.max(1, Math.round(narrationMinutes * range.max));
    return `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
}

export function dataUrlToParts(dataUrl: string): { data: string, mimeType: string } {
    const parts = dataUrl.split(',');
    if (parts.length < 2) throw new Error('Invalid data URL');
    const metaPart = parts[0];
    const data = parts[1];
    const mimeType = metaPart.split(';')[0].split(':')[1];
    return { data, mimeType: mimeType || 'image/png' };
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function concatAudioBuffers(buffers: AudioBuffer[], ctx: AudioContext): AudioBuffer {
    if (buffers.length === 0) return ctx.createBuffer(1, 1, ctx.sampleRate);
    const numberOfChannels = Math.min(...buffers.map(b => b.numberOfChannels));
    const sampleRate = buffers[0].sampleRate;
    const totalLength = buffers.reduce((acc, buffer) => acc + (buffer?.length || 0), 0);
    const result = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);

    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
        const buffer = buffers[i];
        if (buffer) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                result.getChannelData(channel).set(buffer.getChannelData(channel), offset);
            }
            offset += buffer.length;
        }
    }

    return result;
}

export function mixAudioBuffers(buffers: { buffer: AudioBuffer, gain: number }[], ctx: AudioContext): AudioBuffer {
    if (buffers.length === 0) return ctx.createBuffer(1, 1, ctx.sampleRate);
    if (buffers.length === 1 && buffers[0].gain === 1.0) return buffers[0].buffer;
    const numberOfChannels = Math.max(...buffers.map(b => b.buffer.numberOfChannels));
    const sampleRate = buffers[0].buffer.sampleRate;
    const maxLength = Math.max(...buffers.map(b => b.buffer.length));
    const mixedBuffer = ctx.createBuffer(numberOfChannels, maxLength, sampleRate);

    for (let channel = 0; channel < numberOfChannels; channel++) {
        const outputData = mixedBuffer.getChannelData(channel);
        for (const item of buffers) {
            const bufferChannel = Math.min(channel, item.buffer.numberOfChannels - 1);
            const inputData = item.buffer.getChannelData(bufferChannel);
            const g = item.gain;
            for (let i = 0; i < item.buffer.length; i++) {
                outputData[i] += inputData[i] * g;
            }
        }
        // Broadcast soft-knee limiter above 0.90 to prevent harsh digital clipping when voice + BGM + SFX peak together
        for (let i = 0; i < maxLength; i++) {
            const x = outputData[i];
            const abs = Math.abs(x);
            if (abs > 0.90) {
                const sign = x < 0 ? -1 : 1;
                outputData[i] = sign * (0.90 + 0.10 * Math.tanh((abs - 0.90) / 0.10));
            }
        }
    }
    return mixedBuffer;
}

// Smooth cubic easing — better than quint for short clips (motion is more visible at start/end)
function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Continuous editorial momentum curve: 70% linear carry-through + 30% soft landing
// Prevents the "start-stop-start-stop" slideshow freeze at cut boundaries
function cinematicCutEasing(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return 0.7 * x + 0.3 * (1 - Math.pow(1 - x, 2.2));
}

// Subtle sine wave for organic handheld jitter
function handheldJitter(progress: number, amplitude: number): number {
    return (
        Math.sin(progress * Math.PI * 7.3) * amplitude +
        Math.sin(progress * Math.PI * 3.1) * amplitude * 0.5
    );
}

export function presetToKeyframes(
    presetName: string,
    focalPoint?: { x: number; y: number }
): CameraKeyframesConfig {
    const p = (presetName || 'static').toLowerCase().trim();
    const fx = focalPoint?.x !== undefined ? clamp(focalPoint.x, 0.2, 0.8) : 0.5;
    const fy = focalPoint?.y !== undefined ? clamp(focalPoint.y, 0.2, 0.8) : 0.5;

    switch (p) {
        case 'zoom_in':
        case 'dolly_in':
        case 'slow_zoom_in':
        case 'push_in':
            return {
                start: { x: 0.5 + (fx - 0.5) * 0.35, y: 0.5 + (fy - 0.5) * 0.35, scale: 1.0, rotation: 0 },
                end: { x: fx, y: fy, scale: 1.24, rotation: 0 },
                easing: 'easeOut'
            };
        case 'zoom_out':
        case 'dolly_out':
        case 'slow_zoom_out':
        case 'pull_back':
            return {
                start: { x: fx, y: fy, scale: 1.24, rotation: 0 },
                end: { x: 0.5 + (fx - 0.5) * 0.35, y: 0.5 + (fy - 0.5) * 0.35, scale: 1.0, rotation: 0 },
                easing: 'easeOut'
            };
        case 'pan_left':
        case 'tracking_left':
            return {
                start: { x: 0.58, y: fy, scale: 1.15, rotation: 0 },
                end: { x: 0.42, y: fy, scale: 1.15, rotation: 0 },
                easing: 'linear'
            };
        case 'pan_right':
        case 'tracking_right':
            return {
                start: { x: 0.42, y: fy, scale: 1.15, rotation: 0 },
                end: { x: 0.58, y: fy, scale: 1.15, rotation: 0 },
                easing: 'linear'
            };
        case 'pan_up':
        case 'tilt_up':
            return {
                start: { x: fx, y: 0.58, scale: 1.15, rotation: 0 },
                end: { x: fx, y: 0.42, scale: 1.15, rotation: 0 },
                easing: 'linear'
            };
        case 'pan_down':
        case 'tilt_down':
            return {
                start: { x: fx, y: 0.42, scale: 1.15, rotation: 0 },
                end: { x: fx, y: 0.58, scale: 1.15, rotation: 0 },
                easing: 'linear'
            };
        case 'crane_up':
            return {
                start: { x: fx, y: 0.58, scale: 1.08, rotation: 0 },
                end: { x: fx, y: 0.42, scale: 1.18, rotation: 0 },
                easing: 'easeOut'
            };
        case 'crane_down':
            return {
                start: { x: fx, y: 0.42, scale: 1.18, rotation: 0 },
                end: { x: fx, y: 0.58, scale: 1.08, rotation: 0 },
                easing: 'easeOut'
            };
        case 'zoom_in_pan_right':
            return {
                start: { x: Math.max(0.35, fx - 0.08), y: fy, scale: 1.0, rotation: 0 },
                end: { x: Math.min(0.65, fx + 0.06), y: fy, scale: 1.22, rotation: 0 },
                easing: 'easeOut'
            };
        case 'zoom_in_pan_left':
            return {
                start: { x: Math.min(0.65, fx + 0.08), y: fy, scale: 1.0, rotation: 0 },
                end: { x: Math.max(0.35, fx - 0.06), y: fy, scale: 1.22, rotation: 0 },
                easing: 'easeOut'
            };
        case 'zoom_out_pan_right':
            return {
                start: { x: Math.max(0.35, fx - 0.06), y: fy, scale: 1.22, rotation: 0 },
                end: { x: Math.min(0.65, fx + 0.08), y: fy, scale: 1.0, rotation: 0 },
                easing: 'easeOut'
            };
        case 'zoom_out_pan_left':
            return {
                start: { x: Math.min(0.65, fx + 0.06), y: fy, scale: 1.22, rotation: 0 },
                end: { x: Math.max(0.35, fx - 0.08), y: fy, scale: 1.0, rotation: 0 },
                easing: 'easeOut'
            };
        case 'whip_pan':
            return {
                start: { x: 0.35, y: fy, scale: 1.15, rotation: 0 },
                end: { x: 0.65, y: fy, scale: 1.15, rotation: 0 },
                easing: 'whip'
            };
        case 'dutch_tilt':
        case 'dutch_angle_roll':
            return {
                start: { x: fx, y: Math.max(0.35, fy - 0.04), scale: 1.12, rotation: -3.5 },
                end: { x: fx, y: Math.min(0.65, fy + 0.04), scale: 1.2, rotation: 3.5 },
                easing: 'easeOut'
            };
        case 'orbit_clockwise':
        case 'orbit':
            return {
                start: { x: 0.44, y: 0.44, scale: 1.15, rotation: -1.8 },
                end: { x: 0.56, y: 0.56, scale: 1.15, rotation: 1.8 },
                easing: 'easeInOut'
            };
        case 'orbit_counterclockwise':
            return {
                start: { x: 0.56, y: 0.44, scale: 1.15, rotation: 1.8 },
                end: { x: 0.44, y: 0.56, scale: 1.15, rotation: -1.8 },
                easing: 'easeInOut'
            };
        case 'rack_focus':
            return {
                start: { x: fx, y: fy, scale: 1.05, rotation: 0 },
                end: { x: fx, y: fy, scale: 1.2, rotation: 0 },
                easing: 'easeInOut'
            };
        case 'handheld':
            return {
                start: { x: fx - 0.01, y: fy - 0.01, scale: 1.12, rotation: -0.8 },
                end: { x: fx + 0.01, y: fy + 0.01, scale: 1.14, rotation: 0.8 },
                easing: 'linear'
            };
        case 'pan_slow':
            return {
                start: { x: 0.46, y: fy, scale: 1.1, rotation: 0 },
                end: { x: 0.54, y: fy, scale: 1.1, rotation: 0 },
                easing: 'linear'
            };
        case 'zoom_in_hold':
            return {
                start: { x: 0.5, y: 0.5, scale: 1.0, rotation: 0 },
                end: { x: fx, y: fy, scale: 1.2, rotation: 0 },
                easing: 'easeOut'
            };
        case 'hold_zoom_in':
            return {
                start: { x: 0.5, y: 0.5, scale: 1.0, rotation: 0 },
                end: { x: fx, y: fy, scale: 1.2, rotation: 0 },
                easing: 'easeIn'
            };
        case 'zoom_in_whip_left':
            return {
                start: { x: fx, y: fy, scale: 1.0, rotation: 0 },
                end: { x: 0.35, y: fy, scale: 1.25, rotation: 0 },
                easing: 'whip'
            };
        case 'zoom_in_whip_right':
            return {
                start: { x: fx, y: fy, scale: 1.0, rotation: 0 },
                end: { x: 0.65, y: fy, scale: 1.25, rotation: 0 },
                easing: 'whip'
            };
        case 'static':
        default:
            return {
                start: { x: fx, y: fy, scale: 1.0, rotation: 0 },
                end: { x: fx, y: fy, scale: 1.0, rotation: 0 },
                easing: 'linear'
            };
    }
}

export function getKeyframeCameraTransforms(
    keyframes: CameraKeyframesConfig,
    progress: number,
    imgW: number,
    imgH: number,
    canvasWidth: number,
    canvasHeight: number,
    duration: number = 4.0
): { sx: number, sy: number, sWidth: number, sHeight: number, rotation?: number, speedFactor: number } {
    progress = Math.max(0, Math.min(1, progress));
    
    let t = progress;
    const easing = keyframes.easing || 'easeInOut';
    if (easing === 'easeInOut') {
        t = easeInOutCubic(progress);
    } else if (easing === 'easeIn') {
        t = progress * progress * progress;
    } else if (easing === 'easeOut') {
        t = 1 - Math.pow(1 - progress, 3);
    } else if (easing === 'whip') {
        const shaped = Math.pow(progress, 2) * (3 - 2 * progress);
        t = easeInOutCubic(shaped);
    }

    const motionMultiplier = typeof state.cameraMotionIntensity === 'number' ? state.cameraMotionIntensity : 1.0;
    const start = keyframes.start || { x: 0.5, y: 0.5, scale: 1.0, rotation: 0 };
    const end = keyframes.end || { x: 0.5, y: 0.5, scale: 1.0, rotation: 0 };

    const curX = start.x + (end.x - start.x) * t * motionMultiplier;
    const curY = start.y + (end.y - start.y) * t * motionMultiplier;
    const deltaScale = (end.scale - start.scale) * motionMultiplier;
    const curScale = Math.max(1.0, start.scale + deltaScale * t);
    const curRotDeg = start.rotation + (end.rotation - start.rotation) * t * motionMultiplier;
    const rotation = (curRotDeg * Math.PI) / 180;

    // Calculate source rect
    const sWidth = Math.max(10, Math.min(imgW, imgW / curScale));
    const sHeight = Math.max(10, Math.min(imgH, imgH / curScale));

    const centerX = curX * imgW;
    const centerY = curY * imgH;

    const sx = Math.max(0, Math.min(imgW - sWidth, centerX - sWidth / 2));
    const sy = Math.max(0, Math.min(imgH - sHeight, centerY - sHeight / 2));

    return {
        sx,
        sy,
        sWidth,
        sHeight,
        rotation,
        speedFactor: 1.0
    };
}

export function getKenBurnsTransforms(
    movement: string,
    progress: number,
    imgW: number,
    imgH: number,
    canvasWidth: number,
    canvasHeight: number,
    duration: number = 4.0,
    focalPoint?: { x: number; y: number }
): { sx: number, sy: number, sWidth: number, sHeight: number, rotation?: number, speedFactor: number } {

    progress = Math.max(0, Math.min(1, progress));
    // Continuous momentum across cuts instead of freezing at progress=0 and progress=1
    const eased = cinematicCutEasing(progress);

    // Subject focal anchor (clamped to safe 0.15..0.85 rule-of-thirds zone)
    const focusX = focalPoint && typeof focalPoint.x === 'number' && !isNaN(focalPoint.x)
        ? clamp(focalPoint.x, 0.15, 0.85)
        : 0.5;
    const focusY = focalPoint && typeof focalPoint.y === 'number' && !isNaN(focalPoint.y)
        ? clamp(focalPoint.y, 0.15, 0.85)
        : 0.5;

    // Duration-scaled movement magnitude: keeps speed per second consistent across short & long clips
    const motionMultiplier = typeof state.cameraMotionIntensity === 'number' ? state.cameraMotionIntensity : 1.0;
    const speedFactor = Math.max(0.65, Math.min(1.8, Math.sqrt(Math.max(1.0, duration) / 4.0))) * motionMultiplier;
    const zoomLevel = Math.min(0.28, 0.12 * speedFactor);
    const panCrop = Math.min(0.22, 0.10 * speedFactor);

    let scale = 1.0;
    let sx = 0, sy = 0;
    let sWidth = imgW, sHeight = imgH;
    let rotationAngle = 0;

    const getAspectCrop = (scl: number) => ({
        w: imgW * scl,
        h: imgH * scl
    });

    // Steers the crop window smoothly from image center (0.5, 0.5) toward the subject's focalPoint (focusX, focusY)
    // `weight` (0..1) controls how strongly the camera locks onto the focal point at the current progress
    const anchorToFocal = (w: number, h: number, weightX = 1.0, weightY = 1.0) => {
        const effX = 0.5 + (focusX - 0.5) * weightX;
        const effY = 0.5 + (focusY - 0.5) * weightY;
        return {
            x: (imgW - w) * effX,
            y: (imgH - h) * effY
        };
    };

    switch (movement) {
        // --- ZOOM IN (steers toward subject focalPoint as it pushes in) ---
        case 'zoom_in':
        case 'dolly_in':
        case 'slow_zoom_in':
        case 'push_in': {
            scale = 1 - zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const pos = anchorToFocal(sWidth, sHeight, 0.35 + 0.65 * eased, 0.35 + 0.65 * eased);
            sx = pos.x;
            sy = pos.y;
            break;
        }

        // --- ZOOM OUT (starts framed on subject focalPoint, pulls back to wider composition) ---
        case 'zoom_out':
        case 'dolly_out':
        case 'slow_zoom_out':
        case 'pull_back': {
            scale = (1 - zoomLevel) + zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const pos = anchorToFocal(sWidth, sHeight, 1.0 - 0.65 * eased, 1.0 - 0.65 * eased);
            sx = pos.x;
            sy = pos.y;
            break;
        }

        // --- DIAGONAL ZOOM + PAN (classic cinematic Ken Burns, vertically anchored to subject) ---
        case 'zoom_in_pan_right': {
            scale = 1 - zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const startRatio = Math.max(0, Math.min(0.5, focusX - 0.25));
            const endRatio = Math.min(1, Math.max(0.5, focusX + 0.25));
            sx = rangeX * (startRatio + (endRatio - startRatio) * eased);
            sy = (imgH - sHeight) * focusY;
            break;
        }

        case 'zoom_in_pan_left': {
            scale = 1 - zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const startRatio = Math.min(1, Math.max(0.5, focusX + 0.25));
            const endRatio = Math.max(0, Math.min(0.5, focusX - 0.25));
            sx = rangeX * (startRatio + (endRatio - startRatio) * eased);
            sy = (imgH - sHeight) * focusY;
            break;
        }

        case 'zoom_out_pan_right': {
            scale = (1 - zoomLevel) + zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            sx = rangeX * eased;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        case 'zoom_out_pan_left': {
            scale = (1 - zoomLevel) + zoomLevel * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            sx = rangeX * (1 - eased);
            sy = (imgH - sHeight) * focusY;
            break;
        }

        // --- MULTI-PHASE ---
        case 'zoom_in_hold': {
            const phaseProgress = Math.min(1.0, progress / 0.65);
            const phaseEased = easeInOutCubic(phaseProgress);
            scale = 1 - zoomLevel * phaseEased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const pos = anchorToFocal(sWidth, sHeight, phaseEased, phaseEased);
            sx = pos.x;
            sy = pos.y;
            break;
        }

        case 'hold_zoom_in': {
            const phaseProgress = Math.max(0.0, (progress - 0.35) / 0.65);
            const phaseEased = cinematicCutEasing(phaseProgress);
            scale = 1 - zoomLevel * phaseEased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const pos = anchorToFocal(sWidth, sHeight, phaseEased, phaseEased);
            sx = pos.x;
            sy = pos.y;
            break;
        }

        case 'zoom_in_whip_left': {
            if (progress <= 0.7) {
                const phaseProgress = progress / 0.7;
                const phaseEased = easeInOutCubic(phaseProgress);
                scale = 1 - zoomLevel * phaseEased;
                const crop = getAspectCrop(scale);
                sWidth = crop.w;
                sHeight = crop.h;
                const pos = anchorToFocal(sWidth, sHeight, phaseEased, phaseEased);
                sx = pos.x;
                sy = pos.y;
            } else {
                scale = 1 - zoomLevel;
                const phaseProgress = (progress - 0.7) / 0.3;
                const snap = phaseProgress < 0.5 ? 4 * Math.pow(phaseProgress, 3) : 1 - Math.pow(-2 * phaseProgress + 2, 3) / 2;
                const crop = getAspectCrop(scale);
                sWidth = crop.w;
                sHeight = crop.h;
                const startSx = (imgW - sWidth) * focusX;
                sx = startSx * (1 - snap);
                sy = (imgH - sHeight) * focusY;
            }
            break;
        }

        case 'zoom_in_whip_right': {
            if (progress <= 0.7) {
                const phaseProgress = progress / 0.7;
                const phaseEased = easeInOutCubic(phaseProgress);
                scale = 1 - zoomLevel * phaseEased;
                const crop = getAspectCrop(scale);
                sWidth = crop.w;
                sHeight = crop.h;
                const pos = anchorToFocal(sWidth, sHeight, phaseEased, phaseEased);
                sx = pos.x;
                sy = pos.y;
            } else {
                scale = 1 - zoomLevel;
                const phaseProgress = (progress - 0.7) / 0.3;
                const snap = phaseProgress < 0.5 ? 4 * Math.pow(phaseProgress, 3) : 1 - Math.pow(-2 * phaseProgress + 2, 3) / 2;
                const crop = getAspectCrop(scale);
                sWidth = crop.w;
                sHeight = crop.h;
                const startSx = (imgW - sWidth) * focusX;
                const endSx = imgW - sWidth;
                sx = startSx + (endSx - startSx) * snap;
                sy = (imgH - sHeight) * focusY;
            }
            break;
        }

        // --- PURE PAN ---
        case 'pan_right':
        case 'tracking_right': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            sx = rangeX * eased;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        case 'pan_left':
        case 'tracking_left': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            sx = rangeX * (1 - eased);
            sy = (imgH - sHeight) * focusY;
            break;
        }

        case 'pan_up':
        case 'tilt_up': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeY = imgH - sHeight;
            sx = (imgW - sWidth) * focusX;
            sy = rangeY * (1 - eased);
            break;
        }

        case 'crane_up': {
            scale = (1 - zoomLevel * 0.5) + (zoomLevel * 0.5 * eased);
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeY = imgH - sHeight;
            sx = (imgW - sWidth) * focusX;
            sy = rangeY * (1 - eased);
            break;
        }

        case 'pan_down':
        case 'tilt_down': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeY = imgH - sHeight;
            sx = (imgW - sWidth) * focusX;
            sy = rangeY * eased;
            break;
        }

        case 'crane_down': {
            scale = 1 - (zoomLevel * 0.5 * eased);
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeY = imgH - sHeight;
            sx = (imgW - sWidth) * focusX;
            sy = rangeY * eased;
            break;
        }

        // --- SLOW DRIFT (ambient movement anchored around subject focalPoint) ---
        case 'pan_slow': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const center = rangeX * focusX;
            sx = center + rangeX * (eased - 0.5) * 0.32;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        // --- HANDHELD (organic camera shake around subject focalPoint) ---
        case 'handheld': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const jitterAmp = imgW * 0.004;
            const jx = handheldJitter(progress, jitterAmp);
            const jy = handheldJitter(progress + 0.3, jitterAmp * 0.6);
            sx = (imgW - sWidth) * focusX + jx;
            sy = (imgH - sHeight) * focusY + jy;
            break;
        }

        // --- RACK FOCUS (subtle zoom pulse onto subject) ---
        case 'rack_focus': {
            const pulse = Math.sin(progress * Math.PI) * zoomLevel * 0.55;
            scale = 1 - pulse;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            sx = (imgW - sWidth) * focusX;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        // --- ORBIT (slow circular drift around subject focalPoint) ---
        case 'orbit_clockwise': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const rangeY = imgH - sHeight;
            sx = (rangeX * focusX) + Math.cos(eased * Math.PI * 2) * (rangeX * 0.22);
            sy = (rangeY * focusY) + Math.sin(eased * Math.PI * 2) * (rangeY * 0.22);
            break;
        }

        case 'orbit_counterclockwise': {
            const crop = getAspectCrop(1 - panCrop);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const rangeY = imgH - sHeight;
            sx = (rangeX * focusX) + Math.cos(-eased * Math.PI * 2) * (rangeX * 0.22);
            sy = (rangeY * focusY) + Math.sin(-eased * Math.PI * 2) * (rangeY * 0.22);
            break;
        }

        // --- DUTCH TILT ---
        case 'dutch_tilt': {
            scale = 1 - zoomLevel * 0.8 * eased;
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeY = imgH - sHeight;
            sx = (imgW - sWidth) * focusX;
            sy = rangeY * (focusY * 0.6 + eased * 0.4);
            rotationAngle = 0.042 * eased;
            break;
        }

        // --- VERTIGO DOLLY ZOOM ---
        case 'dolly_zoom':
        case 'vertigo_dolly_zoom': {
            scale = 1 - (zoomLevel * 1.5 * eased);
            const crop = getAspectCrop(scale);
            sWidth = crop.w;
            sHeight = crop.h;
            sx = (imgW - sWidth) * focusX;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        // --- WHIP PAN ---
        case 'whip_pan': {
            const crop = getAspectCrop(1 - panCrop * 1.3);
            sWidth = crop.w;
            sHeight = crop.h;
            const rangeX = imgW - sWidth;
            const snap = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            sx = rangeX * snap;
            sy = (imgH - sHeight) * focusY;
            break;
        }

        // --- STATIC ---
        case 'static':
        default: {
            const crop = getAspectCrop(1.0);
            sWidth = crop.w;
            sHeight = crop.h;
            sx = (imgW - sWidth) / 2;
            sy = (imgH - sHeight) / 2;
            break;
        }
    }

    sWidth = Math.max(1, sWidth);
    sHeight = Math.max(1, sHeight);
    sx = Math.max(0, Math.min(sx, imgW - sWidth));
    sy = Math.max(0, Math.min(sy, imgH - sHeight));

    return { sx, sy, sWidth, sHeight, rotation: rotationAngle, speedFactor };
}


export function getAudioContext(): AudioContext {
    if (!state.globalAudioContext || state.globalAudioContext.state === 'closed') {
        // @ts-ignore
        state.globalAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    }
    if (state.globalAudioContext.state === 'suspended') state.globalAudioContext.resume();
    return state.globalAudioContext;
}

export async function safeDecode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  try {
    // Using .slice(0) to create a copy, which can help prevent some browser-specific "detaching" issues.
    return await ctx.decodeAudioData(data.slice(0));
  } catch (e) {
    console.warn('Audio decode failed, creating silent fallback buffer. Error:', e);
    // Return a silent buffer to prevent a single failed audio chunk from stopping everything.
    return ctx.createBuffer(1, ctx.sampleRate * 10, ctx.sampleRate);
  }
}

export async function getAudioBufferFromStorage(): Promise<AudioBuffer | null> {
  if (state.uploadedAudioBuffer) return state.uploadedAudioBuffer;
  if (state.uploadedAudioAssetId) {
    const blob = await assetStorage.getAsset(state.uploadedAudioAssetId);
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await safeDecode(getAudioContext(), arrayBuffer);
      state.uploadedAudioBuffer = audioBuffer;
      return audioBuffer;
    }
  }
  return null;
}

export function detectSupportedVideoMimeType(): string {
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (const type of types) if (MediaRecorder.isTypeSupported(type)) return type;
    return '';
}

export function startSimulatedProgress(
    message: string,
    updateFn: (progress: number, message: string) => void,
    startFrom = 0,
    maxProgress = 90
) {
    let progress = startFrom;

    const interval = window.setInterval(() => {
        if (progress < maxProgress) {
            const step = progress < 60 ? 3 : progress < 80 ? 2 : 1;
            progress = Math.min(progress + step, maxProgress);
            updateFn(progress, message);
        }
    }, 500);

    return () => window.clearInterval(interval);
}

export function escapeControlCharactersInJsonStrings(str: string): string {
    let inString = false;
    let isEscaped = false;
    let out = '';

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inString) {
            if (char === '\\' && !isEscaped) {
                isEscaped = true;
                out += char;
            } else if (char === '"' && !isEscaped) {
                inString = false;
                out += char;
            } else {
                if (char === '\n') {
                    out += '\\n';
                } else if (char === '\r') {
                    out += '\\r';
                } else if (char === '\t') {
                    out += '\\t';
                } else if (char.charCodeAt(0) < 32) {
                    out += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
                } else {
                    out += char;
                }
                isEscaped = false;
            }
        } else {
            if (char === '"') {
                inString = true;
            }
            out += char;
        }
    }
    return out;
}

export function sanitizeAndParseJson(jsonString: string | undefined): any {
    if (!jsonString || jsonString.trim() === "") {
        throw new Error("The AI returned an empty response. Please try again. If this persists, the content may have triggered a safety filter.");
    }
    
    let sanitizedString = jsonString.trim();

    // 1. First attempt to extract markdown code blocks if present
    const jsonBlockMatch = sanitizedString.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
        sanitizedString = jsonBlockMatch[1].trim();
    } else {
        const openMatch = sanitizedString.match(/```(?:json)?\s*([\s\S]*)/);
        if (openMatch) {
            sanitizedString = openMatch[1].trim();
        }
    }

    // 2. Try raw parsing immediately
    try {
        return JSON.parse(sanitizedString);
    } catch {
        // Fall through
    }

    // 3. Try with escaped control characters inside quotes (fixes "Bad control character in string literal in JSON")
    const escapedString = escapeControlCharactersInJsonStrings(sanitizedString);
    try {
        return JSON.parse(escapedString);
    } catch {
        // Fall through
    }

    // 4. Extract balanced JSON block ({ ... } or [ ... ]) if response is surrounded by conversational preamble/postscript
    const balancedParsed = extractBalancedJsonStructure(escapedString);
    if (balancedParsed !== null) {
        return balancedParsed;
    }

    // 5. Extract clean JSON blocks if response contained concatenated restarts or noise
    const arrayMatches = escapedString.match(/\[\s*\{[\s\S]*\}\s*\]/g) || escapedString.match(/\[[\s\S]*?\]|\{[\s\S]*?\}/g);
    if (arrayMatches && arrayMatches.length > 0) {
        // Evaluate from last to first (restarts put full array at the end)
        for (let i = arrayMatches.length - 1; i >= 0; i--) {
            try {
                const parsedMatch = JSON.parse(arrayMatches[i]);
                if (parsedMatch && (Array.isArray(parsedMatch) ? parsedMatch.length > 0 : Object.keys(parsedMatch).length > 0)) {
                    return parsedMatch;
                }
            } catch {
                // Try stack truncation fix on candidate block
                try {
                    return repairAndParseTruncatedJson(arrayMatches[i]);
                } catch {
                    // Continue to next match
                }
            }
        }
    }

    // 6. Early detection for conversational refusals or non-JSON responses
    const lower = sanitizedString.toLowerCase();
    const isRefusal = lower.startsWith('sorry') || 
                      lower.startsWith('i am unable') || 
                      lower.startsWith('i cannot') ||
                      lower.startsWith('i encountered') ||
                      lower.startsWith("i'm having a hard time") ||
                      lower.startsWith("i am having a hard time") ||
                      lower.startsWith("i'm sorry") ||
                      lower.startsWith("i can't") ||
                      lower.includes("can i help you with something else") ||
                      lower.includes("fulfilling your request") ||
                      lower.includes("conversational response");
    if (isRefusal) {
        throw new Error(`The AI provided a conversational response instead of storyboard data ("${sanitizedString.substring(0, 60)}..."). Please try clicking Generate again.`);
    }
    
    // 7. Final attempt: stack-based truncated JSON repair on control-char escaped string
    try { 
        return repairAndParseTruncatedJson(escapedString);
    } catch (e: any) {
        console.error("Failed to parse JSON after sanitization:", e);
        console.log("Original string:", jsonString);
        throw new Error(`Failed to parse AI response as JSON. Details: ${e.message}`);
    }
}

export function extractBalancedJsonStructure(text: string): any | null {
    if (!text) return null;

    for (let s = 0; s < text.length; s++) {
        if (text[s] !== '{' && text[s] !== '[') continue;
        
        const stack: string[] = [];
        let inString = false;
        let isEscaped = false;

        for (let i = s; i < text.length; i++) {
            const char = text[i];
            if (inString) {
                if (char === '\\' && !isEscaped) {
                    isEscaped = true;
                } else {
                    if (char === '"' && !isEscaped) {
                        inString = false;
                    }
                    isEscaped = false;
                }
            } else {
                if (char === '"') {
                    inString = true;
                } else if (char === '{' || char === '[') {
                    stack.push(char);
                } else if (char === '}' || char === ']') {
                    const expected = char === '}' ? '{' : '[';
                    if (stack.length > 0 && stack[stack.length - 1] === expected) {
                        stack.pop();
                        if (stack.length === 0) {
                            const candidate = text.substring(s, i + 1);
                            try {
                                const parsed = JSON.parse(candidate);
                                if (parsed && typeof parsed === 'object') {
                                    return parsed;
                                }
                            } catch {
                                try {
                                    const parsed = JSON.parse(escapeControlCharactersInJsonStrings(candidate));
                                    if (parsed && typeof parsed === 'object') {
                                        return parsed;
                                    }
                                } catch {}
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

function repairAndParseTruncatedJson(str: string): any {
    let sanitizedString = str.trim();
    const stack: string[] = [];
    let inString = false;
    let isEscaped = false;
    
    for (let i = 0; i < sanitizedString.length; i++) {
        const char = sanitizedString[i];
        if (inString) {
            if (char === '\\' && !isEscaped) {
                isEscaped = true;
            } else {
                if (char === '"' && !isEscaped) {
                    inString = false;
                }
                isEscaped = false;
            }
        } else {
            if (char === '"') {
                inString = true;
            } else if (char === '{' || char === '[') {
                stack.push(char);
            } else if (char === '}') {
                if (stack[stack.length - 1] === '{') stack.pop();
            } else if (char === ']') {
                if (stack[stack.length - 1] === '[') stack.pop();
            }
        }
    }
    
    if (inString) {
        if (isEscaped) {
            sanitizedString = sanitizedString.slice(0, -1);
        }
        sanitizedString += '"';
    }
    
    sanitizedString = sanitizedString.trim();
    if (sanitizedString.endsWith(',')) {
        sanitizedString = sanitizedString.slice(0, -1);
    } else if (sanitizedString.endsWith(':')) {
        sanitizedString += 'null';
    }
    
    while (stack.length > 0) {
        const char = stack.pop();
        if (char === '{') sanitizedString += '}';
        else if (char === '[') sanitizedString += ']';
    }
    
    return JSON.parse(sanitizedString);
}


export function splitScriptIntoChunks(text: string, maxChars = 1200): string[] {
  const chunks: string[] = [];
  const paragraphs = text.replace(/\r/g, '').split('\n\n');
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) continue;
    
    // If adding this paragraph exceeds limit, push current chunk first
    if (currentChunk && (currentChunk.length + paragraph.length + 2 > maxChars)) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

export function getAudioDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio'); audio.preload = 'metadata';
        audio.onloadedmetadata = () => { window.URL.revokeObjectURL(audio.src); resolve(audio.duration); };
        audio.onerror = (e) => { window.URL.revokeObjectURL(audio.src); reject(e); };
        audio.src = window.URL.createObjectURL(file);
    });
}

export function chunkText(text: string, maxWordsPerChunk: number = 450): string[] {
    const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paragraphs.length === 0) return [];

    const chunks: string[] = [];
    let currentChunk = "";
    let currentWordCount = 0;

    const pushCurrentChunk = () => {
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }
        currentChunk = "";
        currentWordCount = 0;
    };

    for (const p of paragraphs) {
        const pWords = p.split(/\s+/).filter(Boolean);
        const pWordCount = pWords.length;

        if (pWordCount > maxWordsPerChunk) {
            // The paragraph itself is too long. Push any pending chunk.
            pushCurrentChunk();
            
            // Sub-divide the large paragraph into smaller chunks.
            for (let i = 0; i < pWordCount; i += maxWordsPerChunk) {
                const subChunkWords = pWords.slice(i, i + maxWordsPerChunk);
                chunks.push(subChunkWords.join(' '));
            }
            continue; // This large paragraph is fully processed.
        }

        // If adding this paragraph would exceed the limit, push the current chunk.
        if (currentWordCount > 0 && currentWordCount + pWordCount > maxWordsPerChunk) {
            pushCurrentChunk();
        }

        // Add the new paragraph to the current (possibly new) chunk.
        currentChunk += p + "\n\n";
        currentWordCount += pWordCount;
    }

    // Push any remaining chunk.
    pushCurrentChunk();

    return chunks;
}

export function splitIntoSentences(text: string): string[] {
    if (!text) return [];
    const sentences = text.match(/[^.?!\n]+[.?!]+|[^.?!\n]+(?=\n|$)/g);
    return sentences ? sentences.map(s => s.trim()).filter(s => s.length > 0) : [];
}

export async function ensureSubtitleFontsReady(specificFont?: string) {
  if (specificFont && document.fonts?.load) {
    try {
      await document.fonts.load(`700 48px "${specificFont}"`);
      return;
    } catch (e) {
      console.warn(`Font load wait for ${specificFont}:`, e);
    }
  }

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (e) {
      console.warn("document.fonts.ready wait fail:", e);
    }
  }

  if (document.fonts?.load) {
    const fontsToLoad = [
      '800 48px "Montserrat"',
      '900 48px "Impact"',
      '700 48px "Anton"',
      '700 48px "Bebas Neue"',
      '700 48px "Inter"',
      '700 48px "Oswald"',
      '800 48px "Plus Jakarta Sans"',
      '800 48px "Syne"',
      '700 48px "Bangers"',
      '700 48px "Cinzel"',
      '700 48px "JetBrains Mono"',
      '700 48px "Playfair Display"',
      '800 48px "Noto Sans"',
      '800 48px "Noto Sans JP"',
      '800 48px "Noto Sans Arabic"'
    ];
    
    // Background idle load to avoid blocking the main rendering loop
    const runFontLoading = () => {
      Promise.allSettled(fontsToLoad.map(f => document.fonts.load(f))).catch(() => {});
    };

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(runFontLoading);
    } else {
      setTimeout(runFontLoading, 300);
    }
  }
}

export function resizeCanvasToDisplaySize(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { cssWidth: number, cssHeight: number, dpr: number } {
  const dpr = window.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { cssWidth: 0, cssHeight: 0, dpr };
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cssWidth: rect.width, cssHeight: rect.height, dpr };
}

export function computeWordCounts(shots: any[]) {
    const counts: number[] = []; let total = 0;
    for (const s of shots) {
        const txt = (s.text_reference || s.line_text || '').replace(/<[^>]+>/g, ' ').trim();
        const words = txt === '' ? [] : txt.split(/\s+/).filter(Boolean);
        counts.push(words.length); total += words.length;
    }
    if (total === 0 && shots.length > 0) return { counts: shots.map(() => 1), total: shots.length };
    return { counts, total };
}

export async function resampleAudioBuffer(sourceBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
    if (sourceBuffer.sampleRate === targetSampleRate) return sourceBuffer;
    
    // Manual JS-based resampling to avoid OfflineAudioContext 3-minute bug in Safari
    const ratio = sourceBuffer.sampleRate / targetSampleRate;
    const numChannels = sourceBuffer.numberOfChannels;
    const length = Math.ceil(sourceBuffer.length / ratio);
    
    const ctx = getAudioContext();
    const resultBuffer = ctx.createBuffer(numChannels, length, targetSampleRate);
    
    for (let c = 0; c < numChannels; c++) {
        const inputData = sourceBuffer.getChannelData(c);
        const outputData = resultBuffer.getChannelData(c);
        for (let i = 0; i < length; i++) {
            const index = i * ratio;
            const index1 = Math.floor(index);
            const index2 = Math.min(index1 + 1, inputData.length - 1);
            const fraction = index - index1;
            
            outputData[i] = inputData[index1] * (1 - fraction) + inputData[index2] * fraction;
        }
    }
    
    return resultBuffer;
}

/**
 * Resamples an AudioBuffer to 16kHz mono and encodes it as a WAV File.
 * This is optimized for speech-to-text APIs.
 */
export async function resampleAndEncodeAudio(sourceBuffer: AudioBuffer): Promise<File> {
    const targetSampleRate = 16000;
    const audioContext = getAudioContext();

    let monoBuffer: AudioBuffer;

    if (sourceBuffer.numberOfChannels > 1) {
        monoBuffer = audioContext.createBuffer(1, sourceBuffer.length, sourceBuffer.sampleRate);
        const outputData = monoBuffer.getChannelData(0);
        for (let i = 0; i < sourceBuffer.length; i++) {
            let sum = 0;
            for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
                sum += sourceBuffer.getChannelData(channel)[i];
            }
            outputData[i] = sum / sourceBuffer.numberOfChannels;
        }
    } else {
        monoBuffer = sourceBuffer;
    }

    const resampledBuffer = await resampleAudioBuffer(monoBuffer, targetSampleRate);
    const wavBlob = audioBufferToWavBlob(resampledBuffer);
    return new File([wavBlob], "lightweight.wav", { type: 'audio/wav' });
}

export function releaseAudioBuffer(buffer: AudioBuffer | null): void {
    if (!buffer) return;
    // Help GC by clearing internal references
    for (let i = 0; i < buffer.numberOfChannels; i++) {
        try {
            const channel = buffer.getChannelData(i);
            channel.fill(0); // Clear data
        } catch (e) {
            console.warn("Could not zero channel data during releaseAudioBuffer:", e);
        }
    }
}

export function timeToSeconds(timeStr: string): number {
    const parts = timeStr.split(':');
    const secondsAndMillis = parts.pop()!.split(/[.,]/);
    const hours = parts.length > 1 ? parseInt(parts.shift()!, 10) : 0;
    const minutes = parseInt(parts.shift() || '0', 10);
    const seconds = parseInt(secondsAndMillis[0], 10);
    const milliseconds = parseInt(secondsAndMillis[1], 10) || 0;
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}

export function parseSubtitleFile(text: string): Array<{ start: number, end: number, text: string }> {
    const cues = [];
    // Normalize line endings and split into blocks
    const blocks = text.trim().replace(/\r/g, '').split(/\n\n+/);

    for (const block of blocks) {
        // A valid block must have a timestamp line
        if (block.includes('-->')) {
            const lines = block.split('\n');
            // Find the line with the timestamp, it might not be the second line
            let timeLineIndex = lines.findIndex(line => line.includes('-->'));
            if (timeLineIndex === -1) continue;

            const timeMatch = lines[timeLineIndex].match(/(\S+)\s*-->\s*(\S+)/);
            if (!timeMatch) continue;

            const start = timeToSeconds(timeMatch[1]);
            const end = timeToSeconds(timeMatch[2]);
            const textContent = lines.slice(timeLineIndex + 1).join(' ').trim();
            
            // Only add cues that have actual text content
            if (textContent) {
                cues.push({ start, end, text: textContent });
            }
        }
    }
    return cues;
}

export async function extractAudioChunkFromBuffer(buffer: AudioBuffer, startTime: number, endTime: number): Promise<File> {
    const audioContext = getAudioContext();
    const startSample = Math.floor(startTime * buffer.sampleRate);
    const endSample = Math.floor(endTime * buffer.sampleRate);
    const chunkLength = endSample - startSample;

    if (chunkLength <= 0) {
        throw new Error("Invalid audio chunk duration.");
    }

    const chunkBuffer = audioContext.createBuffer(
        buffer.numberOfChannels,
        chunkLength,
        buffer.sampleRate
    );

    for (let i = 0; i < buffer.numberOfChannels; i++) {
        const channelData = buffer.getChannelData(i);
        const chunkChannelData = chunkBuffer.getChannelData(i);
        chunkChannelData.set(channelData.subarray(startSample, endSample));
    }

    const wavBlob = audioBufferToWavBlob(chunkBuffer);
    return new File([wavBlob], `chunk_${startTime.toFixed(0)}-${endTime.toFixed(0)}.wav`, { type: 'audio/wav' });
}

export async function extractAudioChunk(file: File, startTime: number, endTime: number): Promise<File> {
    const audioContext = getAudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = await safeDecode(audioContext, arrayBuffer);
    return extractAudioChunkFromBuffer(originalBuffer, startTime, endTime);
}

/**
 * Extract a sub-range [startSec, endSec] from an AudioBuffer
 */

/**
 * Splice out a range [removeStartSec, removeEndSec] from an AudioBuffer and join the remaining portions
 */

export function extractScriptChunk(script: string, chunkIndex: number, totalChunks: number): string {
    const words = script.split(/\s+/).filter(Boolean);
    const totalWords = words.length;
    
    if (totalWords === 0) return "";
    
    const wordsPerChunk = Math.ceil(totalWords / totalChunks);

    const startWord = chunkIndex * wordsPerChunk;
    const endWord = Math.min((chunkIndex + 1) * wordsPerChunk, totalWords);

    if (startWord >= endWord) {
        return "";
    }

    return words.slice(startWord, endWord).join(' ');
}

export async function loadImageOrThrow(src: string): Promise<HTMLImageElement> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = src;
    });
    return img;
}

const _videoElementCache = new Map<string, Promise<HTMLVideoElement>>();

export function clearVideoElementCache(): void {
    _videoElementCache.clear();
}

export async function loadVideoElement(src: string): Promise<HTMLVideoElement> {
    if (!src) throw new Error('Video source URL is required');

    // Deduplicate by URL: reuse uploaded master video element if src matches
    if (state.uploadedVideoElement && (state.uploadedVideoElement.src === src || state.uploadedVideoObjectURL === src)) {
        return state.uploadedVideoElement;
    }

    const cached = _videoElementCache.get(src);
    if (cached) {
        try {
            const video = await cached;
            if (video && (video.src === src || video.currentSrc === src) && video.error === null) {
                return video;
            }
        } catch {
            _videoElementCache.delete(src);
        }
    }

    const loadPromise = (async () => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            video.removeEventListener('loadeddata', onReady);
            video.removeEventListener('canplay', onReady);
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('error', onError);
          };
          const onReady = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          };
          const onMeta = () => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setTimeout(onReady, 20);
            }
          };
          const onError = () => {
            if (settled) return;
            settled = true;
            cleanup();
            _videoElementCache.delete(src);
            reject(new Error(`Failed to load video: ${src}`));
          };

          video.addEventListener('loadeddata', onReady);
          video.addEventListener('canplay', onReady);
          video.addEventListener('loadedmetadata', onMeta);
          video.addEventListener('error', onError);

          setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              resolve();
            }
          }, 5000);

          video.src = src;
          video.load();
        });
        return video;
    })();

    _videoElementCache.set(src, loadPromise);

    return loadPromise.catch((err) => {
        _videoElementCache.delete(src);
        throw err;
    });
}

export function getTransitionLabel(transition?: string): string {
  const t = (transition || 'cut').toLowerCase().replace(/_/g, '');
  switch (t) {
    case 'crossdissolve': return 'Dissolve';
    case 'blurdissolve': return 'Blur';
    case 'zoomdissolve': return 'Zoom';
    case 'swipeleft': return 'Swipe L';
    case 'swiperight': return 'Swipe R';
    case 'swipeup': return 'Swipe U';
    case 'swipedown': return 'Swipe D';
    case 'fadetoblack': return 'Fade Black';
    case 'fadetowhite': return 'Fade White';
    case 'wipe': return 'Wipe';
    case 'push': return 'Push';
    default: return 'Cut';
  }
}

export function getTransitionIcon(transition?: string): string {
  const t = (transition || 'cut').toLowerCase().replace(/_/g, '');
  switch (t) {
    case 'crossdissolve': return '✨';
    case 'blurdissolve': return '🌫️';
    case 'zoomdissolve': return '🔍';
    case 'swipeleft': return '⬅️';
    case 'swiperight': return '➡️';
    case 'swipeup': return '⬆️';
    case 'swipedown': return '⬇️';
    case 'fadetoblack': return '⬛';
    case 'fadetowhite': return '⬜';
    case 'wipe': return '🧹';
    case 'push': return '⏩';
    default: return '⚡';
  }
}

export function cyrb53Hash(str: string, seed = 0): string {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}




export function getExportResolutionDimensions(aspectRatio: AspectRatio = '16:9', resolutionKey?: string): { width: number; height: number; key: string } {
    const key = getMatchingResolutionKey(aspectRatio, resolutionKey);
    const item = EXPORT_RESOLUTION_MAP[key] || EXPORT_RESOLUTION_MAP['1080p'];
    return { width: item.width, height: item.height, key };
}


export function generateShortId(): string {
    return Math.random().toString(36).substring(2, 9);
}

export function escapeHtml(str: string | undefined): string {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// energy-flux onset detection on the decoded buffer
export function detectBeats(buffer: AudioBuffer, minInterval = 0.25): number[] {
    const data = buffer.getChannelData(0);
    const hop = 1024, win = 2048;
    const energies: number[] = [];
    for (let i = 0; i + win < data.length; i += hop) {
        let e = 0;
        for (let j = i; j < i + win; j += 4) e += data[j] * data[j];
        energies.push(e);
    }
    const beats: number[] = [];
    for (let i = 1; i < energies.length; i++) {
        const prev = energies[i - 1];
        if (energies[i] > prev * 1.5 && energies[i] > 0.001) {
            const t = (i * hop) / buffer.sampleRate;
            if (!beats.length || t - beats[beats.length - 1] >= minInterval) beats.push(t);
        }
    }
    return beats;
}

/**
 * Downloads an image directly on the client using browser fetch with mode: 'cors'.
 * Leverages the browser's active Google session and residential network context to bypass
 * datacenter 403 Forbidden / 404 Not Found CDN blocks on Gemini generated image URLs
 * (such as lh3.googleusercontent.com / gg-dl / rd-gg-dl).
 *
 * @param url The image URL to fetch (supports scale fallback variants if primary fails)
 * @param options Optional configuration for abort signal and timeout
 * @returns Promise<Blob>
 */
export async function fetchImageAsBlob(
    url: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<Blob> {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error(`Invalid image URL provided to fetchImageAsBlob: "${url}"`);
    }

    const timeoutMs = options?.timeoutMs || 12000;

    // Expand URL variants (e.g. =s2048, =s1024, unsuffixed) to maximize CDN hit probability
    const urlCandidates: string[] = [url];
    const cleanUrl = url.replace(/=[swh]\d+.*$/i, '').replace(/=s\d+.*$/i, '');
    if (!url.includes('=s')) {
        urlCandidates.push(`${cleanUrl}=s2048`, `${cleanUrl}=s1024`, cleanUrl);
    } else if (url.includes('=s2048')) {
        urlCandidates.push(`${cleanUrl}=s1024`, cleanUrl);
    }

    const uniqueCandidates = Array.from(new Set(urlCandidates));
    let lastError: any = null;

    for (const targetUrl of uniqueCandidates) {
        // Strategy 1: Direct client-side fetch with mode: 'cors'
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            if (options?.signal) {
                options.signal.addEventListener('abort', () => controller.abort(), { once: true });
            }

            const response = await fetch(targetUrl, {
                mode: 'cors',
                credentials: 'omit',
                cache: 'no-cache',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const blob = await response.blob();
                if (blob && blob.size > 200) {
                    return blob;
                }
            } else {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }
        } catch (fetchErr: any) {
            lastError = fetchErr;
        }

        // Strategy 2: Image element + Canvas fallback (decodes cross-origin images via browser graphics pipeline)
        try {
            const blobFromCanvas = await new Promise<Blob>((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';

                const timer = setTimeout(() => {
                    img.src = '';
                    reject(new Error(`Image element timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                img.onload = () => {
                    clearTimeout(timer);
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width || 1024;
                        canvas.height = img.naturalHeight || img.height || 1024;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) {
                            reject(new Error('Failed to acquire 2D canvas context'));
                            return;
                        }
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob((blob) => {
                            if (blob && blob.size > 200) {
                                resolve(blob);
                            } else {
                                reject(new Error('Canvas produced an empty or invalid blob'));
                            }
                        }, 'image/jpeg', 0.95);
                    } catch (canvasErr) {
                        reject(canvasErr);
                    }
                };

                img.onerror = (e) => {
                    clearTimeout(timer);
                    reject(new Error(`Image element failed to load from ${targetUrl}`));
                };

                img.src = targetUrl;
            });

            if (blobFromCanvas) {
                return blobFromCanvas;
            }
        } catch (canvasErr: any) {
            lastError = canvasErr;
        }
    }

    throw new Error(`fetchImageAsBlob failed for "${url}": ${lastError?.message || 'Unknown error'}`);
}

export interface SafeStatusOptions {
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    error?: string;
    rawError?: string;
    model?: string;
    latencyMs?: number;
    reply?: string;
    code?: string;
    autoDismissMs?: number | false;
}

export function dismissSafeStatus(container: HTMLElement | null | undefined) {
    if (!container) return;
    if ((container as any)._statusTimer) {
        clearTimeout((container as any)._statusTimer);
        delete (container as any)._statusTimer;
    }
    container.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    container.style.opacity = '0';
    container.style.transform = 'translateY(-2px)';
    setTimeout(() => {
        container.classList.add('hidden');
        container.textContent = '';
        container.style.opacity = '';
        container.style.transform = '';
        container.style.transition = '';
    }, 250);
}

export function renderSafeStatus(container: HTMLElement, options: SafeStatusOptions) {
    if (!container) return;
    if ((container as any)._statusTimer) {
        clearTimeout((container as any)._statusTimer);
        delete (container as any)._statusTimer;
    }
    container.classList.remove('hidden');
    container.style.opacity = '1';
    container.style.transform = 'none';
    container.style.transition = 'none';
    container.textContent = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'flex items-center justify-between gap-2';

    const header = document.createElement('div');
    header.className = 'font-bold flex items-center gap-1 min-w-0';
    header.textContent = (options.type === 'success' ? '✅ ' : options.type === 'warning' ? '⚠️ ' : '❌ ') + options.title;
    if (options.code) {
        const codeSpan = document.createElement('span');
        codeSpan.className = 'opacity-80 font-mono text-[9px] ml-1 font-normal';
        codeSpan.textContent = `[${options.code}]`;
        header.appendChild(codeSpan);
    }
    headerRow.appendChild(header);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'text-sm font-semibold opacity-60 hover:opacity-100 hover:scale-110 transition-all px-1 rounded cursor-pointer leading-none ml-auto shrink-0 select-none';
    closeBtn.title = 'Dismiss notice';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissSafeStatus(container);
    };
    headerRow.appendChild(closeBtn);
    container.appendChild(headerRow);

    const bodyText = options.type === 'success' ? (options.message || '') : (options.error || options.message || '');
    if (bodyText) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'mt-0.5 break-words';
        msgDiv.textContent = bodyText;
        container.appendChild(msgDiv);
    }

    if (options.model || options.latencyMs !== undefined) {
        const metaDiv = document.createElement('div');
        metaDiv.className = options.type === 'success' ? 'text-green-500/70 mt-1 text-[9px]' : 'opacity-70 mt-1 text-[9px]';
        let meta = '';
        if (options.model) meta += `Model: ${options.model} `;
        if (options.latencyMs !== undefined) meta += `• Latency: ${options.latencyMs}ms`;
        metaDiv.textContent = meta.trim().replace(/^•\s*/, '');
        container.appendChild(metaDiv);
    }

    if (options.reply) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'mt-1 text-[9px] text-green-400/80 italic font-mono truncate';
        replyDiv.textContent = `Echo: "${options.reply}"`;
        container.appendChild(replyDiv);
    }

    if (options.rawError) {
        const rawDiv = document.createElement('div');
        rawDiv.className = 'mt-1 pt-1 border-t border-red-500/20 font-mono text-[9px] text-red-400 opacity-80 break-all';
        rawDiv.textContent = `Details: ${options.rawError}`;
        container.appendChild(rawDiv);
    }

    const dismissDuration = options.autoDismissMs !== undefined
        ? options.autoDismissMs
        : (options.type === 'success' ? 7000 : 10000);

    if (dismissDuration !== false && dismissDuration > 0) {
        (container as any)._statusTimer = setTimeout(() => {
            dismissSafeStatus(container);
        }, dismissDuration);
    }
}

