import { safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Type } from '@google/genai';
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import { generateNarrationDirection } from './api/audio';
import { generateContentWithFallback, isUsingPersonalKey } from './api/core';
import * as utils from './utils';
import * as constants from './constants';
import { drawVideoFrame, videoRenderContext } from './videoRenderer';
import { updateVideoContext } from './videoContextBridge';
import type { GraphicEvent } from './graphics-engine';
import type { ProceduralSfxType } from './audioSynthesizer';
import { HYPERFRAME_PRESETS } from './hyperframes-engine';
import type { DirectorReviewResult, DirectorSuggestion } from './types';

interface NarrationDirection {
  reading_style: string;
  recommended_voice: string;
  pacing: string;
  additional_notes?: string;
}

interface TransitionsResponse {
  transitions: { id: string; transition: string }[];
  reasoning?: string[];
}

interface ShotContext {
  id: string;
  index: number;
  text: string;
  duration: number;
  cameraMovement: string;
  prevText: string | null;
  nextText: string | null;
}

// --- Cache Management ---
const MAX_CACHE_SIZE = 50;
const CACHE_EXPIRY_MS = 30 * 60 * 1000;

interface CacheEntry {
  data: any;
  timestamp: number;
}

const aiDirectorCache = new Map<string, CacheEntry>();

function setCache(key: string, data: any) {
  const now = Date.now();

  for (const [k, entry] of aiDirectorCache.entries()) {
    if (now - entry.timestamp > CACHE_EXPIRY_MS) aiDirectorCache.delete(k);
  }

  if (aiDirectorCache.size >= MAX_CACHE_SIZE) {
    const firstKey = aiDirectorCache.keys().next().value as string | undefined;
    if (firstKey) aiDirectorCache.delete(firstKey);
  }

  aiDirectorCache.set(key, { data, timestamp: now });
}

function getCache(key: string): any | null {
  const entry = aiDirectorCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
    aiDirectorCache.delete(key);
    return null;
  }
  return entry.data;
}

function getCacheKey(operation: string, data: any): string {
  try {
    const str = typeof data === 'string' ? data : safeJsonStringify(data);
    return `${operation}_${utils.cyrb53Hash(str)}`;
  } catch {
    return `${operation}_${utils.cyrb53Hash(String(data))}`;
  }
}

export function getCacheStats() {
  const now = Date.now();
  let expired = 0;
  let valid = 0;
  for (const entry of aiDirectorCache.values()) {
    if (now - entry.timestamp > CACHE_EXPIRY_MS) expired++;
    else valid++;
  }
  return { size: aiDirectorCache.size, valid, expired, maxSize: MAX_CACHE_SIZE };
}

export function clearAIDirectorCache() {
  const size = aiDirectorCache.size;
  aiDirectorCache.clear();
  console.log(`🗑️ Cleared ${size} cached AI director entries`);
  ui.showStatus('AI director cache cleared', false, 2000);
}

const CAMERA_MOVEMENT_OPTIONS = [
  'static', 'pan_slow', 'pan_left', 'pan_right', 'pan_up', 'pan_down',
  'zoom_in', 'zoom_out', 'dolly_in', 'dolly_out', 'crane_up', 'crane_down',
  'tracking_left', 'tracking_right', 'orbit_clockwise', 'orbit_counterclockwise',
  'dutch_tilt', 'whip_pan', 'rack_focus', 'handheld',
  'zoom_in_pan_right', 'zoom_in_pan_left', 'zoom_out_pan_right', 'zoom_out_pan_left',
  'zoom_in_hold', 'hold_zoom_in', 'zoom_in_whip_left', 'zoom_in_whip_right'
];

const VALID_CAMERA_MOVEMENTS = new Set(CAMERA_MOVEMENT_OPTIONS);

const VALID_TRANSITIONS = new Set([
  'cut', 'cross_dissolve', 'blur_dissolve', 'zoom_dissolve',
  'swipe_left', 'swipe_right', 'swipe_up', 'swipe_down',
  'fade_to_black', 'fade_to_white', 'wipe', 'push',
  'flash', 'glitch', 'spin', 'iris', 'dissolve',
]);

function displayNarrationDirection(res: NarrationDirection) {
  dom.narrationDirectionContainer.innerHTML = `
    <div class="p-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-xs space-y-1">
      <p><span class="text-purple-300 font-bold">Style:</span> ${ui.escapeHtml(res.reading_style || '')}</p>
      <p><span class="text-purple-300 font-bold">Voice:</span> ${ui.escapeHtml(res.recommended_voice || '')}</p>
      <p><span class="text-purple-300 font-bold">Pacing:</span> ${ui.escapeHtml(res.pacing || '')}</p>
      ${res.additional_notes ? `<p class="text-gray-400 italic text-[10px] mt-1">${ui.escapeHtml(res.additional_notes)}</p>` : ''}
    </div>
  `;
  dom.narrationDirectionContainer.classList.remove('h-4', 'truncate');
}

function applyCameraMovements(movements: { id: string; movement: string; focal_x?: number; focal_y?: number }[]) {
  let invalidCount = 0;
  const newClips = timelineState.clips.map((c, i) => {
    const movementUpdate = movements.find(m => m.id === c.id || String(m.id) === String(c.id)) || movements[i];
    if (!movementUpdate) return c;

    const normalized = (movementUpdate.movement || 'pan_slow')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, ' ')
      .trim()
      .replace(/\s+/g, '_');

    let finalMovement = normalized;
    if (!VALID_CAMERA_MOVEMENTS.has(normalized)) {
      invalidCount++;
      finalMovement = 'pan_slow';
    } 

    let focalPoint = undefined;
    if (movementUpdate.focal_x !== undefined && movementUpdate.focal_y !== undefined) {
      const fx = Number(movementUpdate.focal_x);
      const fy = Number(movementUpdate.focal_y);
      focalPoint = { 
        x: Math.max(0, Math.min(1, isNaN(fx) ? 0.5 : fx)), 
        y: Math.max(0, Math.min(1, isNaN(fy) ? 0.5 : fy)) 
      };
    }

    return { 
      ...c, 
      cameraMovement: finalMovement, 
      focalPoint: focalPoint || c.focalPoint,
      video_prompt: undefined 
    };
  });

  timelineState.setClips(newClips);

  // Sync back to state.currentScenes so Video Prompt generation and storyboard inspector use the new movement
  if (state.currentScenes) {
    const allSceneShots: any[] = [];
    for (const scene of state.currentScenes) {
      if (scene.shot_number !== undefined) {
        allSceneShots.push(scene);
      } else if (scene.lines) {
        for (const line of scene.lines) {
          allSceneShots.push(line);
        }
      }
    }

    for (let i = 0; i < movements.length; i++) {
      const m = movements[i];
      const normalized = (m.movement || 'pan_slow')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, ' ')
        .trim()
        .replace(/\s+/g, '_');
      const validMov = VALID_CAMERA_MOVEMENTS.has(normalized) ? normalized : 'pan_slow';

      const clip = timelineState.clips.find((c: any) => c.id === m.id || String(c.id) === String(m.id)) || timelineState.clips[i];

      let matched = false;
      for (const sceneShot of allSceneShots) {
        const idMatches = sceneShot.id === m.id || 
                          String(sceneShot.id) === String(m.id) || 
                          `s${sceneShot.__sceneIndex}_l${sceneShot.__lineIndex}` === m.id;
        const urlMatches = clip && (
          (clip.imageUrl && sceneShot.imageUrl === clip.imageUrl) ||
          (clip.image_url && (sceneShot.image_url === clip.image_url || sceneShot.imageUrl === clip.image_url)) ||
          (clip._imageObjectURL && (sceneShot._imageObjectURL === clip._imageObjectURL || sceneShot.imageUrl === clip._imageObjectURL))
        );

        if (idMatches || urlMatches) {
          sceneShot.camera_movement = validMov;
          if (m.focal_x !== undefined && m.focal_y !== undefined) {
            sceneShot.focalPoint = { 
              x: Math.max(0, Math.min(1, Number(m.focal_x) || 0.5)), 
              y: Math.max(0, Math.min(1, Number(m.focal_y) || 0.5)) 
            };
          }
          sceneShot.video_prompt = undefined;
          matched = true;
          break;
        }
      }

      // Fallback matching by flat shot index when IDs or URLs don't match
      if (!matched && allSceneShots[i]) {
        allSceneShots[i].camera_movement = validMov;
        if (m.focal_x !== undefined && m.focal_y !== undefined) {
          allSceneShots[i].focalPoint = { 
            x: Math.max(0, Math.min(1, Number(m.focal_x) || 0.5)), 
            y: Math.max(0, Math.min(1, Number(m.focal_y) || 0.5)) 
          };
        }
        allSceneShots[i].video_prompt = undefined;
      }
    }
  }

  if (invalidCount > 0) ui.showStatus(`Applied movements (${invalidCount} defaulted to smooth pan)`, false, 3000);
  if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

function normalizeTransitionName(rawInput?: string): string {
  const raw = (rawInput || 'cut')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');

  if (raw === 'fade' || raw === 'dip_to_black' || raw === 'fade_black') return 'fade_to_black';
  if (raw === 'crossfade' || raw === 'dissolve' || raw === 'cross_fade') return 'cross_dissolve';
  if (raw === 'blur' || raw === 'blur_fade') return 'blur_dissolve';
  if (raw === 'zoom' || raw === 'zoom_in' || raw === 'zoom_out') return 'zoom_dissolve';
  if (raw === 'slide' || raw === 'slide_left') return 'swipe_left';
  if (raw === 'slide_right') return 'swipe_right';
  if (raw === 'slide_up') return 'swipe_up';
  if (raw === 'slide_down') return 'swipe_down';
  if (raw === 'dip_to_white' || raw === 'fade_white') return 'fade_to_white';
  if (raw === 'flash_cut') return 'flash';
  if (raw === 'glitch_cut') return 'glitch';
  return VALID_TRANSITIONS.has(raw) ? raw : 'cut';
}

function applyTransitions(transitions: { id: string; transition: string }[]) {
  let invalidCount = 0;

  const newClips = timelineState.clips.map((c, idx) => {
    // The final clip in the timeline never transitions into a non-existent next clip
    if (idx === timelineState.clips.length - 1) {
      return { ...c, transitionToNext: 'cut' };
    }
    const transitionUpdate = transitions.find((t) => t.id === c.id || String(t.id) === String(c.id)) || transitions[idx];
    if (!transitionUpdate) return c;

    const normalized = normalizeTransitionName(transitionUpdate.transition);
    if (normalized === 'cut' && transitionUpdate.transition && transitionUpdate.transition.toLowerCase() !== 'cut') {
      invalidCount++;
    }
    return { ...c, transitionToNext: normalized };
  });

  timelineState.setClips(newClips);

  // Sync to currentScenes using a flat counter so multi-scene projects don't reuse index 0
  if (state.currentScenes && Array.isArray(state.currentScenes)) {
    let flatIdx = 0;
    state.currentScenes.forEach((s: any) => {
      const lines = s.lines || [s];
      lines.forEach((l: any) => {
        const matchingClip =
          newClips.find((c) => c.id === l.id || String(c.id) === String(l.id)) || newClips[flatIdx];
        flatIdx++;
        if (matchingClip?.transitionToNext) {
          l.transitionToNext = matchingClip.transitionToNext;
          l.transition = matchingClip.transitionToNext;
        }
      });
    });
  }

  try {
    updateVideoContext();
  } catch {}

  if (invalidCount > 0) ui.showStatus(`Applied transitions (${invalidCount} invalid, set to cut)`, false, 3000);
  if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime);
}

export async function handleGetNarrationDirection(): Promise<boolean> {
  const txt = dom.storyInput.value.trim();
  if (!txt) {
    ui.showStatus('Story empty.', true, 3000);
    return false;
  }

  const cacheKey = getCacheKey('narration', txt.slice(0, 200));
  const cached = getCache(cacheKey);
  if (cached) {
    displayNarrationDirection(cached);
    ui.showStatus('Loaded from cache!', false, 2000);
    return true;
  }

  const btn = dom.analyzeNarrationBtn;
  btn.disabled = true;
  btn.innerHTML = '<div class="loader small-loader"></div> Analyzing...';

  try {
    const customInstructions = dom.narrationCustomInstructionsInput?.value.trim();
    // Use Pro for better stylistic recommendations
    const res = await generateNarrationDirection(txt, customInstructions);

    if (!res?.reading_style || !res?.recommended_voice || !res?.pacing) {
      throw new Error('Incomplete narration direction from AI');
    }

    setCache(cacheKey, res);
    displayNarrationDirection(res);
    ui.showStatus('Analyzed!', false, 3000);
    return true;
  } catch (e: any) {
    console.error('Narration direction failed:', e);
    ui.showStatus(`Failed: ${e.message}`, true, 4000);
    return false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🎙️ AI Recommend';
  }
}

function generateAlgorithmicCameraBatch(
  batch: { id: string; text: string; duration_seconds: number }[],
  preset: string,
  history: string[]
): { id: string; movement: string; focal_x: number; focal_y: number }[] {
  const assigned: { id: string; movement: string; focal_x: number; focal_y: number }[] = [];
  const recent = [...history];

  const pickCandidate = (candidates: string[]): string => {
    const last1 = recent[recent.length - 1];
    const last2 = recent[recent.length - 2];
    const filtered = candidates.filter(c => c !== last1 && (c !== last2 || last1 !== last2));
    const pool = filtered.length > 0 ? filtered : candidates;
    const choice = pool[assigned.length % pool.length];
    recent.push(choice);
    return choice;
  };

  for (let idx = 0; idx < batch.length; idx++) {
    const shot = batch[idx];
    const txt = (shot.text || '').toLowerCase();
    const dur = shot.duration_seconds || 4.0;
    let chosenMovement = 'pan_slow';

    const isAction = /(run|running|flee|chase|escape|rush|sudden|explod|blast|danger|panic|shout|battle|war|fight|attack|clash|fast|speed|storm|strike|jump|fall)/i.test(txt);
    const isIntimate = /(thought|realized|looked|gazed|whisper|eyes|face|cried|tears|softly|remembered|heart|secret|murmur|smile|stare|silence|grief|hope|alone)/i.test(txt);
    const isGrand = /(mountain|sea|ocean|ship|sky|forest|horizon|journey|traveled|city|kingdom|world|earth|stars|sun|space|valley|dawn|dusk|landscape|castle|wide|view)/i.test(txt);

    if (dur < 2.5) {
      if (preset === 'trailer' || isAction) {
        chosenMovement = pickCandidate(['whip_pan', 'handheld', 'dutch_tilt', 'zoom_in_whip_right']);
      } else {
        chosenMovement = pickCandidate(['static', 'pan_slow', 'whip_pan', 'handheld']);
      }
    } else if (dur > 6.0) {
      if (isGrand || preset === 'documentary') {
        chosenMovement = pickCandidate(['crane_up', 'crane_down', 'orbit_clockwise', 'zoom_out_pan_right', 'zoom_out_pan_left']);
      } else {
        chosenMovement = pickCandidate(['orbit_clockwise', 'crane_up', 'zoom_in_pan_right', 'rack_focus', 'zoom_out_pan_left']);
      }
    } else {
      // Medium shots (2.5s - 6s)
      if (isAction || preset === 'trailer') {
        chosenMovement = pickCandidate(['whip_pan', 'dutch_tilt', 'zoom_in_whip_right', 'zoom_in_whip_left', 'dolly_in', 'handheld', 'tracking_right']);
      } else if (isIntimate) {
        chosenMovement = pickCandidate(['zoom_in_hold', 'zoom_in_pan_right', 'zoom_in_pan_left', 'dolly_in', 'rack_focus', 'static']);
      } else if (isGrand) {
        chosenMovement = pickCandidate(['zoom_out_pan_right', 'zoom_out_pan_left', 'crane_up', 'pan_right', 'pan_left', 'orbit_clockwise']);
      } else if (preset === 'documentary') {
        chosenMovement = pickCandidate(['pan_slow', 'zoom_in_pan_right', 'tracking_left', 'tracking_right', 'dolly_in']);
      } else if (preset === 'viral') {
        chosenMovement = pickCandidate(['zoom_in', 'zoom_out_pan_left', 'zoom_in_pan_right', 'whip_pan', 'dolly_in']);
      } else if (preset === 'noir') {
        chosenMovement = pickCandidate(['dutch_tilt', 'pan_slow', 'zoom_in_pan_left', 'crane_down', 'static']);
      } else {
        // Balanced narrative
        chosenMovement = pickCandidate(['zoom_in_pan_right', 'zoom_in_pan_left', 'pan_right', 'pan_left', 'dolly_in', 'zoom_out_pan_right', 'static']);
      }
    }

    // Focal coordinates estimation based on spatial keywords or rule-of-thirds
    let fx = 0.5;
    let fy = 0.5;
    if (/(left|west|port)/i.test(txt)) fx = 0.35;
    else if (/(right|east|starboard)/i.test(txt)) fx = 0.65;
    else fx = idx % 2 === 0 ? 0.45 : 0.55;

    if (/(sky|cloud|tall|high|overhead|stars|head|upward)/i.test(txt)) fy = 0.35;
    else if (/(ground|path|feet|floor|down|valley|water|low)/i.test(txt)) fy = 0.65;
    else fy = idx % 3 === 0 ? 0.45 : 0.5;

    assigned.push({
      id: shot.id,
      movement: chosenMovement,
      focal_x: fx,
      focal_y: fy
    });
  }

  return assigned;
}

export async function handleMagicCamera() {
  if (!timelineState.clips?.length) {
    ui.showStatus("Please run a 'Production' workflow first to create a video timeline.", true, 4000);
    return;
  }

  const sortedClips = timelineState.clips
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.startTime - b.c.startTime) || (a.idx - b.idx))
    .map((x) => x.c);
  timelineState.setClips(sortedClips, false); // Silently re-sort state

  const preset = (dom.cinematographyStylePresetSelect?.value || state.cinematographyPreset || 'balanced');
  
  // Safe multi-layer fingerprint to prevent cache collisions across different shot counts or presets
  const clipFingerprint = {
    clipCount: timelineState.clips.length,
    preset,
    clips: timelineState.clips.map((c, idx) => ({
      id: String(c.id ?? idx),
      text: (c.text || c.text_reference || c.line_text || c.prompt || c.image_prompt || '').slice(0, 100),
      dur: Number((c.duration || 4.0).toFixed(1))
    }))
  };
  const cacheKey = getCacheKey('camera_v3', clipFingerprint);
  const cached = getCache(cacheKey);
  if (cached && Array.isArray(cached.movements) && cached.movements.length === timelineState.clips.length) {
    applyCameraMovements(cached.movements);
    ui.showStatus('✨ Loaded camera movements from cache!', false, 3000);
    dom.magicCameraBtn.className = "bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-emerald-400/40 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate";
    dom.magicCameraBtn.innerHTML = '<span>✅ Camera Applied</span>';
    return;
  }

  dom.magicCameraBtn.disabled = true;
  dom.magicCameraBtn.innerHTML =
    `<div class="loader small-loader" style="width: 12px; height: 12px; border-width: 2px;"></div> Analyzing...`;
  ui.setButtonsDisabled(true);
  await ui.openProcessingModal('Analyzing Camera Movements');

  try {
    ui.logProductionStatus(`🎥 Directing camera movements for ${timelineState.clips.length} shots...`);
    
    // Flatten storyboard scene shots so clips with empty narration text can borrow storyboard/visual context
    const allSceneShots: any[] = [];
    if (state.currentScenes) {
      for (const scene of state.currentScenes) {
        if (scene.shot_number !== undefined) {
          allSceneShots.push(scene);
        } else if (scene.lines) {
          for (const line of scene.lines) {
            allSceneShots.push(line);
          }
        }
      }
    }

    const shots = timelineState.clips.map((c, idx) => {
      let narrativeText = c.text || c.text_reference || c.line_text || '';
      let visualText = c.prompt || c.image_prompt || '';

      if (!narrativeText && !visualText && allSceneShots.length > 0) {
        const match = allSceneShots.find((s: any) => 
          s.id === c.id || 
          String(s.id) === String(c.id) ||
          `s${s.__sceneIndex}_l${s.__lineIndex}` === c.id ||
          (s.imageUrl && (s.imageUrl === c.imageUrl || s.imageUrl === c._imageObjectURL))
        ) || allSceneShots[idx];
        if (match) {
          narrativeText = match.text_reference || match.line_text || '';
          visualText = match.image_prompt || match.prompt || match.visual_description || '';
        }
      }

      const combinedText = (narrativeText ? `[Narration]: ${narrativeText}` : '') + 
        (visualText ? ` [Visual]: ${visualText}` : '');
      const cleanText = combinedText.trim() || `Shot ${idx + 1}`;
      const truncatedText = cleanText.length > 250 ? cleanText.slice(0, 250) + '...' : cleanText;

      return {
        id: String(c.id ?? `shot_${idx}`),
        text: truncatedText,
        duration_seconds: Number((c.duration || 4.0).toFixed(1))
      };
    });

    // 25 shots per batch ensures small token footprints, avoids output truncation, and prevents timeouts
    const BATCH_SIZE = 25;
    const allMovements: { id: string; movement: string; focal_x: number; focal_y: number }[] = [];

    for (let i = 0; i < shots.length; i += BATCH_SIZE) {
      const batch = shots.slice(i, Math.min(i + BATCH_SIZE, shots.length));
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(shots.length / BATCH_SIZE);
      const progressPercent = (i / shots.length) * 100;
      
      ui.updateProcessingProgress(
        progressPercent, 
        `Directing camera for shots ${i + 1}–${Math.min(i + BATCH_SIZE, shots.length)} of ${shots.length}...`
      );

      let presetGuidance = '';
      if (preset === 'documentary') {
        presetGuidance = `
        DIRECTING PRESET: DOCUMENTARY / PRESTIGE
        - Prioritize calm, steady, contemplative movements: 'pan_slow', 'zoom_in_pan_right', 'tracking_left', 'tracking_right', 'dolly_in'.
        - Avoid erratic moves, whip pans, or harsh zooms. Maintain cinematic gravitas and photographic balance.`;
      } else if (preset === 'trailer') {
        presetGuidance = `
        DIRECTING PRESET: HIGH-OCTANE / ACTION TRAILER
        - Prioritize explosive, dynamic, punchy moves: 'whip_pan', 'dutch_tilt', 'zoom_in_whip_right', 'zoom_in_whip_left', 'dolly_in', 'handheld'.
        - Keep momentum driving forward with bold perspective shifts and high kinetic energy.`;
      } else if (preset === 'viral') {
        presetGuidance = `
        DIRECTING PRESET: SOCIAL / FAST-PACED VIRAL
        - Prioritize punchy push-ins, rapid alternating pans, and dynamic re-framing ('zoom_in', 'zoom_out_pan_left', 'whip_pan') to maintain high viewer attention.`;
      } else if (preset === 'noir') {
        presetGuidance = `
        DIRECTING PRESET: NOIR / MOODY CINEMATIC
        - Prioritize moody, deliberate, brooding moves: slow 'dutch_tilt', slow 'zoom_in', 'pan_slow', 'crane_down'. Build atmospheric tension.`;
      } else {
        presetGuidance = `
        DIRECTING PRESET: BALANCED NARRATIVE
        - Mix classic Ken Burns push-ins, subtle pans, and static dialogue beats for an organic storytelling rhythm.`;
      }

      let rawBatchMovements: any[] = [];
      try {
        const response = await generateContentWithFallback({
          model: constants.PRIMARY_MODEL,
          maxOutputTokens: 8192,
          contents: `Analyze these ${batch.length} video storyboard shots and assign cinematic camera movements with estimated subject focal coordinates (0.0-1.0) to each shot.\n\nStoryboard Shots Input Data:\n${safeJsonStringify({
              context: i > 0 ? `Previous shots had these movements: ${allMovements.slice(-3).map(m => m.movement).join(', ')}` : 'Start of video.',
              batch: batch
          })}`,
          systemInstruction: `You are a professional Cinematographer and Film Director. Assign a cinematic camera movement to each shot based on its narration, emotion, and duration_seconds.
          You MUST generate EXACTLY ${batch.length} movements, matching the input IDs.
          ${presetGuidance}

          Shot Variety & Continuity Rules:
          - NEVER use the exact same movement on 3 consecutive shots.
          - Alternate between wide establishing/tracking pans and intimate push-ins or zooms to establish natural visual rhythm.
          - Ensure visual continuity — transition naturally from one shot's energy to the next.

          Pacing & Duration Guidelines:
          - Short shots (< 2.5s): Use 'static', 'whip_pan', 'handheld', or 'pan_slow'. Avoid heavy zoom_in on very short shots.
          - Medium shots (2.5s - 6s): Use 'zoom_in_pan_right', 'zoom_in_pan_left', 'pan_left', 'pan_right', 'dolly_in'.
          - Long shots (> 6s): Use 'orbit_clockwise', 'crane_up', 'crane_down', 'zoom_out_pan_right', or 'rack_focus'.

          Available movements:
          - static: No movement. Use for dialogue, intense close-ups, or impact moments.
          - zoom_in / dolly_in: Slow push in. Use for building tension or intimacy.
          - zoom_out / dolly_out: Slow pull back to reveal. Use for isolation or scope.
          - zoom_in_pan_right / zoom_in_pan_left: Classic Ken Burns — zoom in while panning. Most cinematic. Use often.
          - zoom_out_pan_right / zoom_out_pan_left: Pull back while panning. Use for transitions or reveals.
          - pan_left / pan_right / tracking_left / tracking_right: Horizontal pan. Use for following action or scanning a scene.
          - pan_up / tilt_up / crane_up: Pan upward with subtle camera rise. Use for rising emotion or scale.
          - pan_down / tilt_down / crane_down: Pan downward with subtle camera lowering. Use for descent or weight.
          - pan_slow: Very subtle ambient drift. Use for peaceful or static scenes.
          - handheld: Organic camera shake. Use for urgency, chaos, or raw emotion.
          - rack_focus: Gentle zoom pulse. Use for introspective or dreamlike moments.
          - orbit_clockwise / orbit_counterclockwise: Slow circular drift. Use for establishing or contemplative shots.
          - dutch_tilt: Slight rotational roll with zoom. Use for unease, suspense, or psychological tension.
          - whip_pan: Fast snap pan. Use for high-energy cuts or comedic timing.
          - zoom_in_hold: Multi-phase. Pushes in on the subject, then holds still. Use for dramatic realizations.
          - hold_zoom_in: Multi-phase. Holds on subject, then suddenly pushes in. Use for sudden reactions.
          - zoom_in_whip_left / zoom_in_whip_right: Multi-phase. Pushes in, then abruptly whip-pans out. Great for transitioning to a new scene.

          For EACH shot, provide:
          - id: The shot ID.
          - movement: The chosen movement string.
          - focal_x & focal_y: The estimated coordinates (0.0 to 1.0) of the main subject/action in the shot (e.g., 0.5 is center, 0.2 is left/top, 0.8 is right/bottom). This drives the AI framing and depth mask!
          
          Prefer zoom_in_pan_right or zoom_in_pan_left for most narrative shots for maximum cinematic impact.
          Output strictly valid JSON with no conversational text.`,
          schema: {
            type: Type.OBJECT,
            properties: {
              movements: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    movement: { type: Type.STRING },
                    focal_x: { 
                      type: Type.NUMBER, 
                      description: "X coordinate of the primary focal subject (0.0=left edge, 1.0=right edge, 0.5=center). Estimate based on scene action." 
                    },
                    focal_y: { 
                      type: Type.NUMBER, 
                      description: "Y coordinate of the primary focal subject (0.0=top edge, 1.0=bottom edge, 0.5=center). Estimate based on scene action." 
                    },
                  },
                  required: ['id', 'movement', 'focal_x', 'focal_y'],
                },
              },
            },
            required: ['movements'],
          },
        });

        const res = utils.sanitizeAndParseJson(response.text!);
        rawBatchMovements = Array.isArray(res) ? res : (res.movements || []);
      } catch (batchErr: any) {
        console.warn(`[MagicCamera] Batch ${batchNum}/${totalBatches} AI call failed or timed out (${batchErr.message}). Using algorithmic director fallback for this batch:`, batchErr);
        ui.logProductionStatus(`⚠️ Notice: Batch ${batchNum}/${totalBatches} applied director heuristics for maximum stability.`);
        rawBatchMovements = generateAlgorithmicCameraBatch(batch, preset, allMovements.map(m => m.movement));
      }
      
      // Fallback: Ensure all shots in this batch receive a verified movement even if AI hallucinated IDs or dropped items
      const normalizedBatch = batch.map((shot, idx) => {
        const mapped = rawBatchMovements.find((m: any) => m.id === shot.id || String(m.id) === String(shot.id)) || rawBatchMovements[idx] || {};
        const movStr = (mapped.movement || 'pan_slow').toLowerCase().replace(/[^a-z0-9_]+/g, ' ').trim().replace(/\s+/g, '_');
        const validMovement = VALID_CAMERA_MOVEMENTS.has(movStr) ? movStr : 'pan_slow';
        const rawFx = Number(mapped.focal_x);
        const rawFy = Number(mapped.focal_y);
        return { 
          id: shot.id, 
          movement: validMovement,
          focal_x: !isNaN(rawFx) ? Math.max(0, Math.min(1, rawFx)) : 0.5,
          focal_y: !isNaN(rawFy) ? Math.max(0, Math.min(1, rawFy)) : 0.5
        };
      });

      allMovements.push(...normalizedBatch);

      if (isUsingPersonalKey() && i + BATCH_SIZE < shots.length) {
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    setCache(cacheKey, { movements: allMovements });
    applyCameraMovements(allMovements);
    ui.updateProcessingProgress(100, 'Directing complete!');
    ui.logProductionStatus(`✅ Applied cinematic camera moves across ${allMovements.length} shots.`);
    ui.showStatus(`✨ Magic Camera successfully directed ${allMovements.length} shots! Click 💾 Save to persist your changes.`, false, 5000);
    dom.magicCameraBtn.className = "bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-emerald-400/40 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate";
    dom.magicCameraBtn.innerHTML = '<span>✅ Camera Applied</span>';
  } catch (e: any) {
    ui.logProductionStatus(`❌ Magic Camera failed: ${e.message}`, true);
    ui.showStatus(`Magic Camera failed: ${e.message}`, true, 4000);
  } finally {
    dom.magicCameraBtn.disabled = false;
    // Don't reset text content if successful, only on error/finally
    if (!dom.magicCameraBtn.innerHTML.includes('✅')) {
      dom.magicCameraBtn.className = "bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate";
      dom.magicCameraBtn.innerHTML = '<span>🤖 Magic Camera</span>';
    }
    ui.closeProcessingModal();
  }
}

function generateAlgorithmicTransitions(clips: any[]): { id: string; transition: string }[] {
  const transitions: { id: string; transition: string }[] = [];
  const accentPalette = ['cross_dissolve', 'zoom_dissolve', 'blur_dissolve', 'push'];
  let accentCounter = 0;

  for (let idx = 0; idx < clips.length - 1; idx++) {
    const cur = clips[idx];
    const nxt = clips[idx + 1];
    const curText = (cur.text || cur.text_reference || cur.line_text || '').toLowerCase();
    const dur = cur.duration || 4.0;
    const isSceneBoundary =
      cur.__sceneIndex !== undefined &&
      nxt?.__sceneIndex !== undefined &&
      cur.__sceneIndex !== nxt.__sceneIndex;

    let chosen = 'cut';
    if (/(later|years|meanwhile|next day|night|morning|far away|elsewhere|years pass|eventually)/i.test(curText)) {
      chosen = idx % 2 === 0 ? 'fade_to_black' : 'blur_dissolve';
    } else if (isSceneBoundary) {
      chosen = accentPalette[accentCounter++ % accentPalette.length];
    } else if (/(sudden|fast|fled|ran|chase|boom|shot|struck|explod|attack)/i.test(curText)) {
      chosen = dur >= 2.2 ? 'push' : 'cut';
    } else if (/(calm|peace|gaze|remember|soft|dream|whisper|silent|stars)/i.test(curText) && dur >= 3.2) {
      chosen = 'cross_dissolve';
    } else if (dur < 2.0) {
      // Short shots should always hard-cut so transitions don't swallow the shot
      chosen = 'cut';
    } else if (idx % 3 === 1) {
      // Motivated editorial cadence: ~2/3 clean hard cuts, ~1/3 accented transitions
      chosen = accentPalette[accentCounter++ % accentPalette.length];
    } else {
      chosen = 'cut';
    }

    transitions.push({ id: cur.id, transition: chosen });
  }

  return transitions;
}

export async function handleAnalyzeTransitions(isSilent = false) {
  if (!timelineState.clips?.length) {
    if (!isSilent) ui.showStatus("Please run a 'Production' workflow first.", true, 4000);
    return;
  }

  if (timelineState.clips.length < 2) {
    if (!isSilent) ui.showStatus('At least 2 shots are required for transition analysis.', false, 3000);
    return;
  }

  const sortedClips = timelineState.clips
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.startTime - b.c.startTime) || (a.idx - b.idx))
    .map((x) => x.c);
  timelineState.setClips(sortedClips, false);

  const timelineContext = timelineState.clips.map((c) => ({ id: c.id, text: (c.text || c.text_reference || '').slice(0, 100), duration: c.duration }));
  const cacheKey = getCacheKey('transitions_v3', { count: timelineState.clips.length, ctx: timelineContext });
  const cached = getCache(cacheKey);
  const btn = dom.analyzeTransitionsBtn;

  const hasCachedCinematic = cached && Array.isArray(cached.transitions) && cached.transitions.some((t: any) => t.transition && t.transition !== 'cut' && t.transition !== 'none');
  if (cached && Array.isArray(cached.transitions) && cached.transitions.length >= timelineState.clips.length - 1 && hasCachedCinematic) {
    if (!isSilent && btn) {
      btn.disabled = true;
      btn.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'bg-zinc-800/90', 'hover:bg-zinc-700');
      btn.classList.add('bg-green-600', 'hover:bg-green-700', 'text-white');
      btn.innerHTML = '✅ Analyzed';
      ui.showStatus('Analysis complete! Applying transitions...', false, 2500);
      // Wait to visibly show analyzed on button before applying transitions
      await new Promise((r) => setTimeout(r, 700));
    }
    applyTransitions(cached.transitions);
    if (!isSilent) {
      ui.showStatus('Loaded transitions from cache!', false, 3000);
      if (btn) btn.disabled = false;
    }
    return;
  }

  if (!isSilent && btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="loader small-loader" style="width: 12px; height: 12px; border-width: 2px;"></div> Analyzing...';
  }

  try {
    const shotsWithContext: ShotContext[] = timelineState.clips.slice(0, -1).map((shot, idx) => ({
      id: shot.id,
      index: idx,
      text: (shot.text || shot.text_reference || shot.line_text || '').slice(0, 120),
      duration: Number((shot.duration || 2).toFixed(1)),
      cameraMovement: shot.cameraMovement || 'static',
      prevText: idx > 0 ? (timelineState.clips[idx - 1].text || '').slice(0, 50) ?? null : null,
      nextText: idx < timelineState.clips.length - 1 ? (timelineState.clips[idx + 1].text || '').slice(0, 50) ?? null : null,
    }));

    // For very large projects (> 60 shots), batching transitions prevents prompt token overflow
    const BATCH_SIZE = 50;
    const allTransitions: { id: string; transition: string }[] = [];

    for (let i = 0; i < shotsWithContext.length; i += BATCH_SIZE) {
      const batchShots = shotsWithContext.slice(i, Math.min(i + BATCH_SIZE, shotsWithContext.length));
      
      try {
        const contentsText = `Visual Sync Phase Context:\nShot Sequences (Batch ${Math.floor(i / BATCH_SIZE) + 1}):\n${safeJsonStringify(batchShots)}`;

        const response = await generateContentWithFallback({
          model: constants.PRIMARY_MODEL,
          maxOutputTokens: 4096,
          contents: contentsText,
          systemInstruction: `You are a professional film editor in the Visual Sync Phase. Analyze shot sequences for cinematic transitions, enforcing precise timing for cuts and transitions.
          Available Transitions: 'cut', 'cross_dissolve', 'blur_dissolve', 'zoom_dissolve', 'swipe_left', 'swipe_right', 'swipe_up', 'swipe_down', 'fade_to_black', 'fade_to_white', 'wipe', 'push'.
          Rules:
          - Ensure seamless cinematic transitions across ALL parts of the video including opening and early shots.
          - Do not leave early or opening shots without transitions unless a hard cut is strictly appropriate for rapid action.
          - Use 'cross_dissolve', 'blur_dissolve', 'zoom_dissolve', or 'wipe' for establishing flow and narrative continuity.
          - Use 'fade_to_black'/'fade_to_white' if the narrative shifts time, scene, or place significantly.
          - Use directional swipes for energetic scene changes.
          - For EACH shot provided, assign ONE transition to lead into the NEXT shot.
          Return JSON with { "transitions": [{ "id": "shot_id", "transition": "blur_dissolve" }, ...] }`,
          schema: {
            type: Type.OBJECT,
            properties: {
              transitions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: { id: { type: Type.STRING }, transition: { type: Type.STRING } },
                  required: ['id', 'transition'],
                },
              },
            },
            required: ['transitions'],
          },
        });

        const result: TransitionsResponse = utils.sanitizeAndParseJson(response.text!);
        const batchRes = result.transitions || [];
        
        // Ensure every shot in batch receives an entry with robust ID and index matching
        for (let bIdx = 0; bIdx < batchShots.length; bIdx++) {
          const s = batchShots[bIdx];
          const found = batchRes.find(t =>
            t.id === s.id ||
            String(t.id) === String(s.id) ||
            String(t.id).toLowerCase() === String(s.id).toLowerCase() ||
            t.id === `shot_${s.index}` ||
            t.id === `shot-${s.index}` ||
            t.id === `shot_${s.index + 1}` ||
            t.id === `shot-${s.index + 1}` ||
            String(t.id) === String(s.index) ||
            String(t.id) === String(s.index + 1)
          ) || batchRes[bIdx];

          const rawTrans = found?.transition ? String(found.transition).toLowerCase().trim().replace(/[\s-]+/g, '_') : '';
          allTransitions.push({
            id: s.id,
            transition: (rawTrans && VALID_TRANSITIONS.has(rawTrans)) ? rawTrans : 'cut'
          });
        }
      } catch (batchErr) {
        console.warn(`[Transitions] Batch ${Math.floor(i / BATCH_SIZE) + 1} fallback to algorithmic transitions:`, batchErr);
        const algo = generateAlgorithmicTransitions(batchShots.map(s => ({ ...s, duration: s.duration })));
        for (let bIdx = 0; bIdx < batchShots.length; bIdx++) {
          const s = batchShots[bIdx];
          const found = algo.find(t => t.id === s.id) || algo[bIdx];
          allTransitions.push({ id: s.id, transition: found?.transition || 'cross_dissolve' });
        }
      }
    }

    // Guarantee that transitions are truly cinematic and not all reverted to hard cuts
    const hasCinematicTransitions = allTransitions.some(t => t.transition && t.transition !== 'cut');
    if (!hasCinematicTransitions && timelineState.clips.length > 1) {
      console.warn('[Transitions] AI returned only cuts or unmatched IDs; applying algorithmic cinematic transitions');
      const algoTransitions = generateAlgorithmicTransitions(timelineState.clips);
      for (let i = 0; i < allTransitions.length; i++) {
        const t = allTransitions[i];
        const algo = algoTransitions.find(a => a.id === t.id) || algoTransitions[i];
        if (algo && algo.transition && algo.transition !== 'cut') {
          t.transition = algo.transition;
        }
      }
      if (!allTransitions.some(t => t.transition && t.transition !== 'cut')) {
        const dynamicPalette = ['cross_dissolve', 'blur_dissolve', 'zoom_dissolve', 'wipe'];
        for (let i = 0; i < allTransitions.length; i++) {
          allTransitions[i].transition = dynamicPalette[i % dynamicPalette.length];
        }
      }
    }

    setCache(cacheKey, { transitions: allTransitions });

    if (!isSilent && btn) {
      btn.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'bg-zinc-800/90', 'hover:bg-zinc-700');
      btn.classList.add('bg-green-600', 'hover:bg-green-700', 'text-white');
      btn.innerHTML = '✅ Analyzed';
      ui.showStatus('Analysis complete! Applying transitions...', false, 2500);
      ui.logProductionStatus(`✅ Transition analysis complete (${allTransitions.length} transitions ready).`);
      // Wait to visibly show analyzed on the button before applying transitions
      await new Promise((r) => setTimeout(r, 700));
    }

    applyTransitions(allTransitions);
    ui.logProductionStatus(`✨ Applied ${allTransitions.length} narrative-guided transitions.`);

    if (!isSilent) {
      ui.showStatus('Cinematic transitions applied!', false, 3000);
    }
  } catch (e: any) {
    console.warn('Transition analysis failed, applying algorithmic director transitions:', e);
    const fallbackTransitions = generateAlgorithmicTransitions(timelineState.clips);

    if (!isSilent && btn) {
      btn.classList.remove('bg-gray-700', 'hover:bg-gray-600', 'bg-zinc-800/90', 'hover:bg-zinc-700');
      btn.classList.add('bg-green-600', 'hover:bg-green-700', 'text-white');
      btn.innerHTML = '✅ Analyzed';
      ui.showStatus('Analysis complete! Applying transitions...', false, 2500);
      await new Promise((r) => setTimeout(r, 700));
    }

    applyTransitions(fallbackTransitions);
    ui.logProductionStatus(`✨ Applied ${fallbackTransitions.length} cinematic transitions.`);
    if (!isSilent) {
      ui.showStatus('Cinematic transitions applied!', false, 3000);
    }
  } finally {
    if (!isSilent && btn) {
      btn.disabled = false;
      if (!btn.textContent?.includes('✅')) {
        btn.innerHTML = '<span>✨</span> Analyze Transitions';
      }
    }
  }
}

// ===== AUTO MOTION GRAPHICS =====

export type OverlayIntensity = 'minimal' | 'medium' | 'aggressive';
type Importance = 'low' | 'medium' | 'high';

interface GraphicsDetection {
  lowerThirds?: { name: string; role?: string; anchor: string; importance?: Importance }[];
  titleCards?: { title: string; subtitle?: string; anchor: string; importance?: Importance }[];
  statCounters?: { targetValue: number; prefix?: string; suffix?: string; title: string; trend?: 'up' | 'down' | 'none'; trendLabel?: string; anchor: string; importance?: Importance }[];
  donutCharts?: { title: string; subtitle?: string; percentage?: number; centerLabel?: string; centerSublabel?: string; segments?: { label: string; value: number }[]; anchor: string; importance?: Importance }[];
  versusCards?: { leftTitle: string; leftPoints: string[]; rightTitle: string; rightPoints: string[]; vsBadgeText?: string; anchor: string; importance?: Importance }[];
  socialBadges?: { platform: 'youtube' | 'instagram' | 'tiktok' | 'x' | 'discord' | 'custom'; handle: string; anchor: string; importance?: Importance }[];
  spotlightFocus?: { title?: string; subtitle?: string; anchor: string; importance?: Importance }[];
  hyperFrames?: { title: string; templateId?: string; anchor: string; importance?: Importance }[];
}

interface IntensityConfig {
  /** Lowest importance rating that survives the filter. */
  minImportance: Importance;
  /** Overlays per minute of narration, used to derive density-based caps. */
  ratePerMinute: number;
  /** Absolute floor/ceiling so very short/long videos don't get 0 or 40 overlays. */
  minCap: number;
  maxCap: number;
  /** Minimum seconds between ANY two overlays (not just lower-thirds). */
  minSpacingSeconds: number;
  /** Extra instruction appended to the system prompt. */
  promptGuidance: string;
}

const IMPORTANCE_RANK: Record<Importance, number> = { low: 0, medium: 1, high: 2 };

const INTENSITY_CONFIG: Record<OverlayIntensity, IntensityConfig> = {
  minimal: {
    minImportance: 'high',
    ratePerMinute: 1.2,
    minCap: 1,
    maxCap: 4,
    minSpacingSeconds: 25,
    promptGuidance: 'Be VERY conservative. Only flag items that are essential to understanding the video — err heavily on the side of leaving things out.',
  },
  medium: {
    minImportance: 'medium',
    ratePerMinute: 2.5,
    minCap: 2,
    maxCap: 10,
    minSpacingSeconds: 12,
    promptGuidance: 'Use balanced judgment — flag items that meaningfully add context, but skip minor or passing details.',
  },
  aggressive: {
    minImportance: 'low',
    ratePerMinute: 5,
    minCap: 4,
    maxCap: 20,
    minSpacingSeconds: 4,
    promptGuidance: 'Be thorough — flag anything plausible, including minor names, secondary stats, and passing comparisons. It is fine to include lower-confidence items.',
  },
};

function overlayCapFor(totalDurationSeconds: number, cfg: IntensityConfig): number {
  const minutes = Math.max(totalDurationSeconds / 60, 0.25);
  return Math.round(Math.min(cfg.maxCap, Math.max(cfg.minCap, minutes * cfg.ratePerMinute)));
}

const LT_DURATION = 4.5;  // lower third on-screen time (s)
const TC_DURATION = 3.0;  // title card on-screen time (s)
const SC_DURATION = 4.0;  // stat counter on-screen time (s)
const DC_DURATION = 4.5;  // donut chart on-screen time (s)
const VC_DURATION = 5.0;  // versus card on-screen time (s)
const SB_DURATION = 3.5;  // social badge on-screen time (s)
const SF_DURATION = 4.0;  // spotlight focus on-screen time (s)
const MIN_GAP = 0.75;     // min spacing between consecutive lower thirds

function normWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Locate the timestamp of a verbatim or fuzzy anchor phrase in the global word list. */
function findAnchorTime(
  words: { word: string; start: number; end: number }[],
  anchor: string
): { start: number; end: number } | null {
  const target = anchor.split(/\s+/).map(normWord).filter(Boolean);
  if (target.length === 0) return null;
  const norm = words.map(w => normWord(w.word));

  // 1. Exact consecutive sequence match
  for (let i = 0; i + target.length <= norm.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (norm[i + j] !== target[j]) { ok = false; break; }
    }
    if (ok) return { start: words[i].start, end: words[i + target.length - 1].end };
  }

  // 2. Fuzzy token / sliding window matching (handles minor punctuation/dropped tokens)
  let bestScore = 0;
  let bestRange: { start: number; end: number } | null = null;
  const minRequired = Math.min(2, target.length);

  for (let i = 0; i < norm.length; i++) {
    let matched = 0;
    let endIdx = i;
    for (let j = 0; j < target.length && (i + j) < norm.length; j++) {
      if (norm[i + j] === target[j]) {
        matched++;
        endIdx = i + j;
      }
    }
    if (matched >= minRequired && matched > bestScore) {
      bestScore = matched;
      bestRange = { start: words[i].start, end: words[endIdx].end };
    }
  }

  if (bestRange && bestScore >= minRequired) {
    return bestRange;
  }

  // 3. Fallback: first recognizable token match
  const idx = norm.indexOf(target[0]);
  if (idx >= 0) return { start: words[idx].start, end: words[idx].end };
  return null;
}

function snapToSilence(
  t: number,
  silences: { start: number; end: number }[] | null,
  window = 1.5
): number {
  if (!silences) return t;
  let best = t, bestDist = window;
  for (const s of silences) {
    const d = Math.abs(s.start - t);
    if (d < bestDist) { bestDist = d; best = s.start; }
  }
  return best;
}

export function getEffectiveWordTimestamps(): { word: string; start: number; end: number }[] {
  // 1. If global word timestamps exist, return them
  if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
    return timelineState.globalWordTimestamps;
  }
  if ((state as any).masterAudioTranscript && (state as any).masterAudioTranscript.length > 0) {
    return (state as any).masterAudioTranscript;
  }

  // 2. Check clips in timelineState.clips
  const clips = timelineState.clips || [];
  if (clips.length > 0) {
    const wordsFromClips: { word: string; start: number; end: number }[] = [];
    let hasClipWords = false;

    for (const clip of clips) {
      if (clip.wordTimestamps && clip.wordTimestamps.length > 0) {
        hasClipWords = true;
        wordsFromClips.push(...clip.wordTimestamps);
      }
    }
    if (hasClipWords && wordsFromClips.length > 0) {
      return wordsFromClips;
    }

    // Synthesize words from clip text and clip duration
    for (const clip of clips) {
      const text = (clip.text || '').trim();
      if (!text) continue;
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const clipStart = clip.startTime || 0;
      const clipDur = Math.max(0.5, clip.duration || (clip.endTime - clip.startTime) || 3.0);
      const wordDur = clipDur / tokens.length;
      tokens.forEach((w: string, idx: number) => {
        const wStart = clipStart + idx * wordDur;
        wordsFromClips.push({
          word: w,
          start: wStart,
          end: wStart + wordDur,
        });
      });
    }
    if (wordsFromClips.length > 0) {
      return wordsFromClips;
    }
  }

  // 3. Check scenes/shots in state.currentScenes
  const scenes = state.currentScenes || [];
  const wordsFromScenes: { word: string; start: number; end: number }[] = [];
  let curTime = 0;
  for (const scene of scenes) {
    for (const shot of (scene.shots || [])) {
      const text = (shot.line_text || shot.text_reference || shot.image_prompt || '').replace(/<[^>]+>/g, ' ').trim();
      const dur = Math.max(1, shot.duration_seconds || 3);
      if (text) {
        const tokens = text.split(/\s+/).filter(Boolean);
        if (tokens.length > 0) {
          const wordDur = dur / tokens.length;
          tokens.forEach((w: string, idx: number) => {
            const wStart = curTime + idx * wordDur;
            wordsFromScenes.push({
              word: w,
              start: wStart,
              end: wStart + wordDur,
            });
          });
        }
      }
      curTime += dur;
    }
  }
  if (wordsFromScenes.length > 0) {
    return wordsFromScenes;
  }

  // 4. Fallback: Synthesize words from story text across A-roll video/audio duration
  const storyText = ((dom.storyInput ? dom.storyInput.value : '') || (state as any).storyText || '').trim();
  const mediaDur = state.uploadedVideoElement?.duration || timelineState.masterAudioBuffer?.duration || (timelineState.clips && timelineState.clips.length > 0 ? timelineState.clips[timelineState.clips.length - 1].endTime : 0);
  if (storyText && mediaDur && Number.isFinite(mediaDur) && mediaDur > 0) {
    const tokens = storyText.split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const wordDur = mediaDur / tokens.length;
      return tokens.map((w: string, idx: number) => ({
        word: w,
        start: idx * wordDur,
        end: (idx + 1) * wordDur
      }));
    }
  }

  return [];
}

function resolveAutoOverlaySfx(
  type: string,
  importance: Importance = 'medium',
  title?: string,
  subtitle?: string
): ProceduralSfxType | 'none' {
  const mode = (state as any).autoOverlaySfxMode || 'none';
  if (mode === 'none') return 'none';

  const combinedText = `${title || ''} ${subtitle || ''}`.trim();
  const hasNumbersOrSymbols = /[\d%$#€£!?]|\b(key|secret|alert|warning|step|rule|tip|fact|hack|stat)\b/i.test(combinedText);
  const isHighImportance = importance === 'high';

  if (mode === 'high-energy') {
    switch (type) {
      case 'titleCard':
        return 'impact';
      case 'statCounter':
      case 'donutChart':
        return 'ping';
      case 'versusCard':
        return 'chord';
      case 'socialBadge':
        return 'cyber_chime';
      case 'spotlightFocus':
        return 'hit';
      case 'lowerThird':
      default:
        return 'whoosh';
    }
  }

  // mode === 'subtle' (Smart Context-Aware)
  switch (type) {
    case 'statCounter':
    case 'donutChart':
      return 'pop';
    case 'titleCard':
      return 'whoosh';
    case 'socialBadge':
      return 'cyber_chime';
    case 'spotlightFocus':
      return 'pop';
    case 'versusCard':
      return 'pop';
    case 'lowerThird':
    default:
      if (isHighImportance || hasNumbersOrSymbols) {
        return 'pop';
      }
      return 'none';
  }
}

function buildGraphics(
  det: GraphicsDetection,
  customWords?: { word: string; start: number; end: number }[],
  intensity: OverlayIntensity = 'medium',
): GraphicEvent[] {
  const words = customWords || (timelineState.globalWordTimestamps as
    { word: string; start: number; end: number }[] | null) || getEffectiveWordTimestamps();
  if (!words || words.length === 0) return [];
  const totalDur = words[words.length - 1].end || 10;
  const silences = timelineState.globalSilences;
  const cfg = INTENSITY_CONFIG[intensity];
  const minRank = IMPORTANCE_RANK[cfg.minImportance];
  let counter = 0;

  // Each candidate carries its resolved anchor time + importance rank so we can
  // sort/trim uniformly regardless of overlay type.
  type Candidate = { rank: number; build: () => GraphicEvent };
  const candidates: { time: number; c: Candidate }[] = [];
  const seenNames = new Set<string>();

  const passesFilter = (importance?: Importance) => IMPORTANCE_RANK[importance || 'medium'] >= minRank;

  for (const lt of det.lowerThirds || []) {
    if (!passesFilter(lt.importance)) continue;
    const key = normWord(lt.name || '');
    if (!key || seenNames.has(key)) continue;
    const hit = findAnchorTime(words, lt.anchor || lt.name);
    if (!hit) continue;
    seenNames.add(key);
    const start = Math.min(hit.start + 0.15, Math.max(0, totalDur - 1));
    const sfx = resolveAutoOverlaySfx('lowerThird', lt.importance, lt.name, lt.role);
    candidates.push({
      time: start,
      c: {
        rank: IMPORTANCE_RANK[lt.importance || 'medium'],
        build: () => ({
          id: `lt_${counter++}`, type: 'lowerThird',
          start, end: Math.min(start + LT_DURATION, totalDur),
          title: lt.name, subtitle: lt.role || undefined, position: 'left',
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const tc of det.titleCards || []) {
    if (!passesFilter(tc.importance)) continue;
    const hit = findAnchorTime(words, tc.anchor || tc.title);
    if (!hit) continue;
    const start = Math.max(0, snapToSilence(hit.start, silences));
    const sfx = resolveAutoOverlaySfx('titleCard', tc.importance, tc.title, tc.subtitle);
    candidates.push({
      time: start,
      c: {
        rank: IMPORTANCE_RANK[tc.importance || 'medium'],
        build: () => ({
          id: `tc_${counter++}`, type: 'titleCard',
          start, end: Math.min(start + TC_DURATION, totalDur),
          title: tc.title, subtitle: tc.subtitle || undefined, backdrop: 'scrim',
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const sc of det.statCounters || []) {
    if (!passesFilter(sc.importance)) continue;
    const hit = findAnchorTime(words, sc.anchor || sc.title);
    if (!hit) continue;
    const sfx = resolveAutoOverlaySfx('statCounter', sc.importance, sc.title, sc.suffix);
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[sc.importance || 'medium'],
        build: () => ({
          id: `sc_${counter++}`, type: 'statCounter',
          start: hit.start, end: Math.min(hit.start + SC_DURATION, totalDur),
          title: sc.title || 'Key Statistic',
          targetValue: sc.targetValue,
          prefix: sc.prefix,
          suffix: sc.suffix,
          trend: sc.trend || 'none',
          trendLabel: sc.trendLabel,
          countDuration: 1.5,
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const dc of det.donutCharts || []) {
    if (!passesFilter(dc.importance)) continue;
    const hit = findAnchorTime(words, dc.anchor || dc.title);
    if (!hit) continue;
    const sfx = resolveAutoOverlaySfx('donutChart', dc.importance, dc.title, dc.subtitle);
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[dc.importance || 'medium'],
        build: () => ({
          id: `dc_${counter++}`, type: 'donutChart',
          start: hit.start, end: Math.min(hit.start + DC_DURATION, totalDur),
          title: dc.title || 'Data Breakdown',
          subtitle: dc.subtitle || undefined,
          chartMode: (dc.segments && dc.segments.length > 0) ? 'breakdown' : 'percentage',
          percentage: dc.percentage !== undefined ? dc.percentage : 75,
          centerLabel: dc.centerLabel || (dc.percentage !== undefined ? `${dc.percentage}%` : undefined),
          centerSublabel: dc.centerSublabel || (dc.subtitle ? dc.subtitle.toUpperCase() : 'TOTAL'),
          segments: dc.segments || undefined,
          showLegend: true,
          animationDuration: 1.2,
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const vc of det.versusCards || []) {
    if (!passesFilter(vc.importance)) continue;
    const hit = findAnchorTime(words, vc.anchor || vc.leftTitle);
    if (!hit) continue;
    const sfx = resolveAutoOverlaySfx('versusCard', vc.importance, vc.leftTitle, vc.rightTitle);
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[vc.importance || 'medium'],
        build: () => ({
          id: `vc_${counter++}`, type: 'versusCard',
          start: hit.start, end: Math.min(hit.start + VC_DURATION, totalDur),
          title: 'Comparison',
          leftTitle: vc.leftTitle,
          leftPoints: vc.leftPoints || [],
          rightTitle: vc.rightTitle,
          rightPoints: vc.rightPoints || [],
          vsBadgeText: vc.vsBadgeText || 'VS',
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const sb of det.socialBadges || []) {
    if (!passesFilter(sb.importance)) continue;
    const hit = findAnchorTime(words, sb.anchor || sb.handle);
    if (!hit) continue;
    const sfx = resolveAutoOverlaySfx('socialBadge', sb.importance, sb.platform, sb.handle);
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[sb.importance || 'medium'],
        build: () => ({
          id: `sb_${counter++}`, type: 'socialBadge',
          start: hit.start, end: Math.min(hit.start + SB_DURATION, totalDur),
          title: 'Follow & Subscribe',
          platform: sb.platform || 'youtube',
          handle: sb.handle,
          showVerified: true,
          showBellChime: true,
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const sf of det.spotlightFocus || []) {
    if (!passesFilter(sf.importance)) continue;
    const hit = findAnchorTime(words, sf.anchor || sf.title || '');
    if (!hit) continue;
    const sfx = resolveAutoOverlaySfx('spotlightFocus', sf.importance, sf.title, sf.subtitle);
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[sf.importance || 'medium'],
        build: () => ({
          id: `sf_${counter++}`, type: 'spotlightFocus',
          start: hit.start, end: Math.min(hit.start + SF_DURATION, totalDur),
          title: sf.title || 'Attention',
          subtitle: sf.subtitle || undefined,
          shape: 'circle',
          dimOpacity: 0.75,
          calloutPosition: 'auto',
          focusRadiusX: 0.15,
          focusRadiusY: 0.15,
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
        }),
      },
    });
  }

  for (const hf of det.hyperFrames || []) {
    if (!passesFilter(hf.importance)) continue;
    const hit = findAnchorTime(words, hf.anchor || hf.title);
    if (!hit) continue;
    const template = HYPERFRAME_PRESETS.find(p => p.id === hf.templateId) || HYPERFRAME_PRESETS[0];
    const dur = template.defaultDuration || 4.5;
    const mode = (state as any).autoOverlaySfxMode || 'none';
    const sfx = mode === 'none' ? 'none' : (template.sfxTrigger || (mode === 'high-energy' ? 'whoosh' : 'pop'));
    candidates.push({
      time: hit.start,
      c: {
        rank: IMPORTANCE_RANK[hf.importance || 'medium'],
        build: () => ({
          id: `hf_${counter++}`,
          type: 'hyperFrame',
          start: hit.start,
          end: Math.min(hit.start + dur, totalDur),
          title: hf.title || template.name,
          templateId: template.id,
          html: template.html.trim(),
          animationIn: template.animationIn,
          animationOut: template.animationOut,
          position: template.position,
          accentColor: template.accentColor,
          textColor: template.textColor,
          audioReactive: template.audioReactive ?? true,
          musicReactiveGlow: template.musicReactiveGlow ?? true,
          sfxTrigger: sfx !== 'none' ? sfx : undefined,
          beatPulseScale: template.beatPulseScale || 0.08,
        } as any),
      },
    });
  }

  // --- Global density cap + duration-aware non-overlapping spacing ---
  const cap = overlayCapFor(totalDur, cfg);

  // Highest importance first; ties broken by earliest occurrence
  candidates.sort((a, b) => b.c.rank - a.c.rank || a.time - b.time);

  const builtEvents: GraphicEvent[] = [];
  for (const cand of candidates) {
    if (builtEvents.length >= cap) break;
    const ev = cand.c.build();

    // Snap full-screen title cards to the nearest shot cut boundary if within 0.65s
    if (ev.type === 'titleCard' && timelineState.clips?.length) {
      for (const clip of timelineState.clips) {
        if (Math.abs((clip.startTime || 0) - ev.start) <= 0.65) {
          const dur = ev.end - ev.start;
          ev.start = clip.startTime || 0;
          ev.end = Math.min(totalDur, ev.start + dur);
          break;
        }
      }
    }

    // Ensure no two overlays collide on screen AND enforce minSpacingSeconds between starts
    const collides = builtEvents.some((existing) => {
      const startTooClose = Math.abs(existing.start - ev.start) < cfg.minSpacingSeconds;
      const intervalsOverlap = ev.start < existing.end + MIN_GAP && ev.end + MIN_GAP > existing.start;
      return startTooClose || intervalsOverlap;
    });
    if (collides) continue;

    builtEvents.push(ev);
  }

  builtEvents.sort((a, b) => a.start - b.start);
  return builtEvents;
}

function setAutoDirectButtonsLoading(loading: boolean) {
  const btns = document.querySelectorAll('#timeline-autodirect-overlays-btn, #autodirect-graphics-btn, [data-action="autodirect-overlays"]');
  btns.forEach((el) => {
    const btn = el as HTMLButtonElement;
    if (loading) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span><span class="animate-pulse">Auto-Directing...</span>`;
      btn.classList.add('opacity-75', 'cursor-wait');
    } else {
      btn.disabled = false;
      btn.innerHTML = `<span>⚡</span><span class="hidden md:inline">Auto-Direct Overlays</span><span class="md:hidden">Auto-Overlays</span>`;
      btn.classList.remove('opacity-75', 'cursor-wait');
    }
  });
}

export async function autoGenerateGraphics(isSilent = false, forceFresh = false): Promise<void> {
  // If explicitly invoked by user click, ensure motion graphics are enabled
  if (!state.motionGraphicsEnabled) {
    if (!isSilent) {
      state.motionGraphicsEnabled = true;
      try { localStorage.setItem('motionGraphicsEnabled', 'true'); } catch {}
      if (dom.enableMotionGraphicsCheckbox) dom.enableMotionGraphicsCheckbox.checked = true;
    } else {
      return;
    }
  }

  const words = getEffectiveWordTimestamps();
  if (!words || words.length === 0) {
    if (!isSilent) {
      ui.showStatus('⚠️ Add storyboard script text, shots, or narration audio first to auto-direct overlays.', true, 4000);
    }
    return;
  }

  setAutoDirectButtonsLoading(true);

  const intensity: OverlayIntensity = state.overlayIntensity || 'medium';
  const cfg = INTENSITY_CONFIG[intensity];

  const script = words.map((w: any) => w.word).join(' ');
  const cacheKey = getCacheKey('graphics', { script, intensity });
  const cached = !forceFresh ? getCache(cacheKey) : null;
  if (cached) {
    const events = buildGraphics(cached, words, intensity);
    timelineState.saveSnapshot();
    timelineState.setGraphics(events);
    if (!isSilent) ui.showStatus(`✨ Loaded ${events.length} motion graphics from cache!`, false, 3000);
    setAutoDirectButtonsLoading(false);
    ui.renderTimelineEditor();
    if (dom.graphicsListContainer) {
      try {
        const handlers = await import('./handlers-graphics');
        handlers.renderGraphicsList();
      } catch {}
    }
    drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
    return;
  }

  try {
    const response = await generateContentWithFallback({
      model: constants.PRIMARY_MODEL,
      contents: `Narration script:\n"""${script}"""`,
      systemInstruction: `You are a documentary and viral video motion-graphics director. From the narration, extract:
1) lowerThirds: the 3-6 MOST IMPORTANT named people/organizations (protagonists, key figures). Only the FIRST introduction of each. Skip minor or passing mentions.
2) titleCards: major section/chapter boundaries (clear topic shifts) that deserve a full-screen title. Titles must be SHORT (2-5 words).
3) statCounters: impressive numbers, financial figures, growth metrics, or single statistics (e.g. "$500M", "10x", "50,000 users").
4) donutCharts: percentages, market shares, ratios, completion rates, or category segment breakdowns (e.g. "78% market share", "65% complete", breakdown of 3 categories).
5) versusCards: distinct comparisons or battles between two items/sides (e.g. "iPhone vs Android", "Old Way vs New Way").
6) socialBadges: calls to action, channel subscriptions, social handles, or website links.
7) spotlightFocus: critical pivotal moments or focal objects calling for dramatic spotlighting.
8) hyperFrames: 1-4 high-impact viral hooks, launch cards, e-commerce promo badges, audio-reactive cards, or retention callouts. Choose templateId from: "launch-hero", "flash-sale", "ecommerce-cta", "trust-reviews", "price-slash", "pattern-wait", "pattern-mistake", "apple-feature", "reels-hook", "stat-metric", "music-eq-card", "cinematic-act", "podcast-speaker". Titles must be punchy (2-5 words).

Overlay density for this pass: ${cfg.promptGuidance}

For EACH item also include an "importance" rating:
- "high": essential to understanding the story (protagonist's first appearance, the single most load-bearing statistic, the core comparison the video is built around).
- "medium": genuinely useful context, but the video would still work without it.
- "low": a nice-to-have flourish (a passing name, a minor stat, a secondary comparison).
Be honest and use the full range — don't rate everything "high".

For EACH item include an "anchor": a SHORT VERBATIM phrase (3-6 words) copied EXACTLY from the narration where the graphic should appear. The anchor MUST be an exact substring of the narration text.
If nothing qualifies for a category, return an empty array. Never invent facts.`,
      schema: {
        type: Type.OBJECT,
        properties: {
          lowerThirds: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                role: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['name', 'anchor'],
            },
          },
          titleCards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['title', 'anchor'],
            },
          },
          statCounters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                targetValue: { type: Type.NUMBER },
                prefix: { type: Type.STRING },
                suffix: { type: Type.STRING },
                trend: { type: Type.STRING, enum: ['up', 'down', 'none'] },
                trendLabel: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['title', 'targetValue', 'anchor'],
            },
          },
          donutCharts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                percentage: { type: Type.NUMBER },
                centerLabel: { type: Type.STRING },
                centerSublabel: { type: Type.STRING },
                segments: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      value: { type: Type.NUMBER },
                    },
                    required: ['label', 'value'],
                  },
                },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['title', 'anchor'],
            },
          },
          versusCards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                leftTitle: { type: Type.STRING },
                leftPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                rightTitle: { type: Type.STRING },
                rightPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                vsBadgeText: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['leftTitle', 'rightTitle', 'anchor'],
            },
          },
          socialBadges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                platform: { type: Type.STRING, enum: ['youtube', 'instagram', 'tiktok', 'x', 'discord', 'custom'] },
                handle: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['platform', 'handle', 'anchor'],
            },
          },
          spotlightFocus: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subtitle: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['anchor'],
            },
          },
          hyperFrames: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                templateId: { type: Type.STRING },
                anchor: { type: Type.STRING },
                importance: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
              },
              required: ['title', 'anchor'],
            },
          },
        },
        required: ['lowerThirds', 'titleCards'],
      },
    });

    const det: GraphicsDetection = utils.sanitizeAndParseJson(response.text!);
    setCache(cacheKey, det);
    const events = buildGraphics(det, words, intensity);
    timelineState.saveSnapshot();
    timelineState.setGraphics(events);
    if (!isSilent) {
      if (events.length > 0) {
        ui.showStatus(`✨ Added ${events.length} auto-directed motion graphics to timeline!`, false, 3500);
      } else {
        ui.showStatus('ℹ️ AI analyzed narration: no specific names, stats, or comparisons needed overlays.', false, 3500);
      }
    }
    ui.renderTimelineEditor();
    if (dom.graphicsListContainer) {
      try {
        const handlers = await import('./handlers-graphics');
        handlers.renderGraphicsList();
      } catch {}
    }
    drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
  } catch (e: any) {
    console.error('Auto graphics failed:', e);
    if (!isSilent) ui.showStatus('Auto graphics generation failed. Please try again.', true, 3000);
  } finally {
    setAutoDirectButtonsLoading(false);
  }
}

// ==========================================
// Director Review Loop ("Magic Polish")
// ==========================================

let currentDirectorReviewResult: DirectorReviewResult | null = null;

export function computeTimelinePacingMetrics() {
  const clips = timelineState.clips || [];
  const words = timelineState.globalWordTimestamps || [];
  const totalShots = clips.length;

  if (totalShots === 0) {
    return {
      averageShotDuration: 0,
      wordsPerMinute: 0,
      shotsPerMinute: 0,
      pacingVariance: 0,
      totalShots: 0,
      totalDuration: 0,
    };
  }

  const lastClip = clips[clips.length - 1];
  const totalDuration = timelineState.masterAudioBuffer?.duration ?? (lastClip?.endTime || 0);
  const durations = clips.map((c: any) => c.duration || (c.endTime - c.startTime) || 0);
  const avgDur = durations.reduce((a: number, b: number) => a + b, 0) / totalShots;

  const variance = durations.reduce((acc: number, d: number) => acc + Math.pow(d - avgDur, 2), 0) / totalShots;
  const stdDev = Math.sqrt(variance);

  const wordCount = words.length || (clips.map((c: any) => (c.text || '').split(/\s+/).filter(Boolean).length).reduce((a: number, b: number) => a + b, 0));
  const minutes = Math.max(0.01, totalDuration / 60);
  const wpm = Math.round(wordCount / minutes);
  const spm = parseFloat((totalShots / minutes).toFixed(1));

  return {
    averageShotDuration: parseFloat(avgDur.toFixed(1)),
    wordsPerMinute: wpm,
    shotsPerMinute: spm,
    pacingVariance: parseFloat(stdDev.toFixed(2)),
    totalShots,
    totalDuration: parseFloat(totalDuration.toFixed(1)),
  };
}

async function buildShotThumbnailParts(clips: any[], maxShots = 16): Promise<any[]> {
  const parts: any[] = [];
  if (!clips || clips.length === 0) return parts;
  const step = Math.max(1, Math.ceil(clips.length / maxShots));
  for (let i = 0; i < clips.length; i += step) {
    const clip = clips[i];
    let img: HTMLImageElement | HTMLVideoElement | undefined = clip.image;
    if (!img && clip.videoElement && (clip.videoElement.videoWidth || clip.videoElement.readyState >= 2)) {
      img = clip.videoElement;
    }
    if (!img && clip._imageObjectURL) {
      try {
        img = await utils.loadImageOrThrow(clip._imageObjectURL);
      } catch {
        // skip if load fails
      }
    }
    if (!img) continue;

    try {
      const width = (img instanceof HTMLVideoElement ? img.videoWidth : img.naturalWidth) || img.width;
      const height = (img instanceof HTMLVideoElement ? img.videoHeight : img.naturalHeight) || img.height;
      if (!width || !height) continue;

      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 512 / Math.max(width, height));
      canvas.width = Math.max(32, Math.round(width * scale));
      canvas.height = Math.max(32, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      const base64 = dataUrl.split(',')[1];
      if (base64) {
        parts.push(
          { text: `[Shot #${i + 1} Visual Frame (ID: ${clip.id})]:` },
          { inlineData: { mimeType: 'image/jpeg', data: base64 } }
        );
      }
    } catch (err) {
      console.warn(`Could not capture thumbnail for shot #${i + 1}:`, err);
    }
  }
  return parts;
}

function computeAudioEnvelope(buffer: AudioBuffer | null, buckets = 24): string {
  if (!buffer || buffer.length === 0) return 'No audio buffer loaded.';
  try {
    const d = buffer.getChannelData(0);
    const per = Math.floor(d.length / buckets);
    if (per <= 0) return 'Audio duration too brief for loudness discretization.';
    const out: string[] = [];
    for (let b = 0; b < buckets; b++) {
      let sum = 0;
      const startIdx = b * per;
      const endIdx = (b + 1) * per;
      let sampleCount = 0;
      for (let i = startIdx; i < endIdx; i += 64) {
        sum += d[i] * d[i];
        sampleCount++;
      }
      const rms = sampleCount > 0 ? Math.sqrt(sum / sampleCount) : 0;
      out.push(rms.toFixed(2));
    }
    return `Audio Loudness Envelope (RMS across 24 intervals, 0.00-1.00): [${out.join(', ')}]`;
  } catch {
    return 'Could not compute audio loudness envelope.';
  }
}

export async function handleDirectorReviewLoop(isSilent = false): Promise<DirectorReviewResult | null> {
  const clips = timelineState.clips || [];
  if (clips.length === 0) {
    if (!isSilent) ui.showStatus('Please produce a video or add shots before running AI Director Review.', true, 3000);
    return null;
  }

  const metrics = computeTimelinePacingMetrics();
  const cacheKey = getCacheKey('director_review_v2', {
    clips: clips.map((c: any) => ({ id: c.id, d: c.duration, t: c.text, cam: c.cameraMovement, trans: c.transitionToNext, imgId: c.image_id || c._imageObjectURL })),
    metrics,
    graphicsCount: (timelineState.graphics || []).length,
  });

  const cached = getCache(cacheKey);
  if (cached) {
    currentDirectorReviewResult = cached;
    renderDirectorReviewUI(cached);
    if (!isSilent) ui.showStatus('Loaded AI Director Review from cache.', false, 2000);
    return cached;
  }

  if (!isSilent) ui.showStatus('🪄 AI Director is analyzing visuals, audio dynamics, and rhythm...', false, 5000);

  try {
    const silenceNote = timelineState.globalSilences?.length
      ? `Detected silence gaps: ${timelineState.globalSilences.map((s: any) => `${s.start.toFixed(1)}–${s.end.toFixed(1)}s`).join(', ')}`
      : 'No significant silence gaps.';

    const loudnessNote = computeAudioEnvelope(timelineState.masterAudioBuffer, 24);
    const detectedBpm = (state as any).detectedBpm || (timelineState as any).detectedBpm;
    const bpmNote = detectedBpm ? `Detected Background Music BPM: ${detectedBpm}` : '';

    const prompt = `You are an elite, award-winning Hollywood and YouTube viral video director reviewing the assembled visual edit, pacing, cinematography, and audio dynamics of a video project.
Analyze the shot list, pacing metrics, audio narration transcript, camera movements, silence gaps, loudness envelope, and the provided shot frame thumbnails to produce a comprehensive critique and actionable improvement plan.

Current Pacing & Audio Metrics:
- Total Shots: ${metrics.totalShots}
- Total Duration: ${metrics.totalDuration}s
- Average Shot Duration: ${metrics.averageShotDuration}s
- Words Per Minute: ${metrics.wordsPerMinute} WPM
- Shots Per Minute: ${metrics.shotsPerMinute} SPM
- Shot Duration StdDev: ${metrics.pacingVariance}s
- Silence Analysis: ${silenceNote}
- Audio Dynamics: ${loudnessNote}
${bpmNote ? `- Music Tempo: ${bpmNote}\n` : ''}
Visual Multimodal Inspection:
- Shot frame thumbnails are provided inline above. Reference these shot images to visually inspect composition, framing, character consistency/drift, dark/muddy frames, visual hierarchy, and subtitle/overlay contrast.

Shot List & Edit Breakdown:
${clips.map((c: any, idx: number) => `Shot #${idx + 1} [ID: ${c.id}] (${c.startTime?.toFixed(1)}s - ${c.endTime?.toFixed(1)}s, Dur: ${c.duration?.toFixed(1)}s)
  - Narration text: "${c.text || '(Visual-only / B-roll)'}"
  - Camera: ${c.cameraMovement || 'ken_burns_zoom_in'}
  - Outgoing Transition: ${c.transitionToNext || 'cut'}
  - Keyframes: ${c.cameraKeyframes ? 'Configured' : 'None'}`).join('\n')}

Existing Motion Graphics / Overlays:
${(timelineState.graphics || []).map((g: any) => `- [${g.type}] "${g.title || ''}" from ${g.start?.toFixed(1)}s to ${g.end?.toFixed(1)}s`).join('\n') || 'None'}

Provide:
1. overallScore (integer 1-100 reflecting visual retention, composition quality, and edit rhythm)
2. pacingCadence (e.g. "Dynamic Viral Explainer", "Cinematic Documentary", "Dragging in Midsection", "Fast-Paced Hook", "Energy Dip at Climax")
3. executiveSummary (2-3 concise, insightful sentences on the holistic edit flow and visual consistency)
4. suggestions (list of 3 to 6 high-impact, ranked suggestions):
   - id: unique string identifier (e.g. "sug_1", "sug_2")
   - type: 'trim_shot' | 'extend_shot' | 'change_camera' | 'fix_transition' | 'add_broll_overlay' | 'adjust_pacing' | 'add_emphasis_graphic' | 'regenerate_shot'
   - severity: 'high' | 'medium' | 'polish'
   - title: e.g. "Shot 3 drags — Trim 20% to tighten narrative beat" or "Character drift on Shot 4" or "Clashing transition on Shot 5" or "Missing Lower Third for expert introduction"
   - description: 1-2 sentences explaining why this change improves viewer engagement or emotional resonance, referencing visual cues when applicable.
   - targetShotIndex: 0-indexed integer corresponding to the target shot
   - targetClipId: Clip ID string
   - actionPayload:
     - trimPercent (e.g. 20) or newDuration (e.g. 3.2)
     - cameraMovement (e.g. 'zoom_in_pan_left', 'zoom_out_pan_right', 'orbit_clockwise', 'static', 'pan_right')
     - transitionToNext (e.g. 'blur_dissolve', 'flash', 'cross_dissolve', 'glitch', 'zoom_dissolve', 'cut')
     - graphicType ('lowerThird' | 'titleCard' | 'icon')
     - graphicText (string)
     - graphicIcon (string)
     - graphicStart (number)
     - graphicEnd (number)
`;

    const thumbnailParts = await buildShotThumbnailParts(clips);
    const contents = thumbnailParts.length > 0
      ? [...thumbnailParts, { text: prompt }]
      : prompt;

    const response = await generateContentWithFallback({
      model: constants.PRIMARY_MODEL,
      contents,
      systemInstruction: 'You are an elite video editing director producing structured critique and actionable timeline modifications.',
      mimeType: 'application/json',
      schema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.INTEGER },
            pacingCadence: { type: Type.STRING },
            executiveSummary: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: {
                    type: Type.STRING,
                    enum: [
                      'trim_shot',
                      'extend_shot',
                      'change_camera',
                      'fix_transition',
                      'add_broll_overlay',
                      'adjust_pacing',
                      'add_emphasis_graphic',
                      'regenerate_shot',
                    ],
                  },
                  severity: { type: Type.STRING, enum: ['high', 'medium', 'polish'] },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  targetShotIndex: { type: Type.INTEGER },
                  targetClipId: { type: Type.STRING },
                  actionPayload: {
                    type: Type.OBJECT,
                    properties: {
                      newDuration: { type: Type.NUMBER },
                      trimPercent: { type: Type.NUMBER },
                      cameraMovement: { type: Type.STRING },
                      transitionToNext: { type: Type.STRING },
                      graphicType: { type: Type.STRING, enum: ['lowerThird', 'titleCard', 'icon'] },
                      graphicText: { type: Type.STRING },
                      graphicIcon: { type: Type.STRING },
                      graphicStart: { type: Type.NUMBER },
                      graphicEnd: { type: Type.NUMBER },
                    },
                  },
                },
                required: ['type', 'severity', 'title', 'description', 'targetShotIndex', 'targetClipId'],
              },
            },
          },
          required: ['overallScore', 'pacingCadence', 'executiveSummary', 'suggestions'],
        }
    });

    const parsed: DirectorReviewResult = utils.sanitizeAndParseJson(response.text!);
    parsed.pacingMetrics = metrics;
    
    // Ensure ids and default applied flags
    parsed.suggestions = (parsed.suggestions || []).map((s, i) => ({
      ...s,
      id: s.id || `sug_${i + 1}_${Date.now()}`,
      applied: false,
    }));

    setCache(cacheKey, parsed);
    currentDirectorReviewResult = parsed;
    renderDirectorReviewUI(parsed);

    if (!isSilent) {
      ui.showStatus(`🪄 Director Review complete! Score: ${parsed.overallScore}/100 with ${parsed.suggestions.length} suggestions.`, false, 4000);
    }
    return parsed;
  } catch (error: any) {
    console.error('Director review failed:', error);
    if (!isSilent) ui.showStatus(`AI Director Review error: ${error.message || error}`, true, 4000);
    return null;
  }
}

export function applyDirectorSuggestion(suggestionId: string, skipSnapshot = false): boolean {
  if (!currentDirectorReviewResult) return false;
  const suggestion = currentDirectorReviewResult.suggestions.find((s) => s.id === suggestionId);
  if (!suggestion || suggestion.applied) return false;

  if (!skipSnapshot) {
    timelineState.saveSnapshot();
  }
  const clips = [...timelineState.clips];
  let targetIndex = suggestion.targetShotIndex;
  let targetClip = clips.find((c: any) => c.id === suggestion.targetClipId) || clips[targetIndex];

  if (!targetClip && clips.length > 0) {
    targetClip = clips[Math.min(targetIndex, clips.length - 1)];
  }
  if (!targetClip) return false;

  targetIndex = clips.findIndex((c: any) => c.id === targetClip.id);
  const MIN_CLIP_DUR = 0.5;

  const applyDurationChange = (desiredNewDur: number) => {
    const clampedDesired = Math.max(MIN_CLIP_DUR, desiredNewDur);

    if (timelineState.mode === 'audio_locked') {
      // Rolling edit: adjust shared boundary with the next clip (or previous clip if on the last shot)
      const neighbor = clips[targetIndex + 1];
      if (neighbor) {
        const combinedEnd = neighbor.endTime;
        const maxTargetDur = Math.max(MIN_CLIP_DUR, combinedEnd - targetClip.startTime - MIN_CLIP_DUR);
        const finalDur = Math.min(clampedDesired, maxTargetDur);
        targetClip.duration = finalDur;
        targetClip.endTime = targetClip.startTime + finalDur;
        neighbor.startTime = targetClip.endTime;
        neighbor.duration = Math.max(MIN_CLIP_DUR, combinedEnd - neighbor.startTime);
      } else if (targetIndex > 0) {
        const prev = clips[targetIndex - 1];
        const fixedEnd = targetClip.endTime;
        const maxTargetDur = Math.max(MIN_CLIP_DUR, fixedEnd - prev.startTime - MIN_CLIP_DUR);
        const finalDur = Math.min(clampedDesired, maxTargetDur);
        targetClip.duration = finalDur;
        targetClip.startTime = fixedEnd - finalDur;
        prev.endTime = targetClip.startTime;
        prev.duration = Math.max(MIN_CLIP_DUR, prev.endTime - prev.startTime);
      }
    } else {
      targetClip.duration = clampedDesired;
      targetClip.endTime = targetClip.startTime + clampedDesired;
      let currentStart = targetClip.endTime;
      for (let i = targetIndex + 1; i < clips.length; i++) {
        clips[i].startTime = currentStart;
        clips[i].endTime = currentStart + clips[i].duration;
        currentStart = clips[i].endTime;
      }
    }
  };

  switch (suggestion.type) {
    case 'trim_shot': {
      const trimPct = suggestion.actionPayload?.trimPercent ?? 20;
      const currentDur = targetClip.duration || targetClip.endTime - targetClip.startTime || 2;
      const newDur = suggestion.actionPayload?.newDuration || currentDur * (1 - trimPct / 100);
      applyDurationChange(newDur);
      break;
    }
    case 'extend_shot': {
      const currentDur = targetClip.duration || targetClip.endTime - targetClip.startTime || 2;
      const newDur = suggestion.actionPayload?.newDuration || currentDur * 1.25;
      applyDurationChange(newDur);
      break;
    }
    case 'change_camera': {
      if (suggestion.actionPayload?.cameraMovement) {
        const rawMov = suggestion.actionPayload.cameraMovement
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, ' ')
          .trim()
          .replace(/\s+/g, '_');
        const aliasMap: Record<string, string> = {
          dynamic_orbit: 'orbit_clockwise',
          static_centered: 'static',
          slow_pan_right: 'pan_right',
          slow_pan_left: 'pan_left',
          ken_burns_zoom_in: 'zoom_in_pan_right',
        };
        const resolvedMov = aliasMap[rawMov] || (VALID_CAMERA_MOVEMENTS.has(rawMov) ? rawMov : 'zoom_in_pan_right');
        targetClip.cameraMovement = resolvedMov;
      }
      if (suggestion.actionPayload?.cameraKeyframes) {
        targetClip.cameraKeyframes = suggestion.actionPayload.cameraKeyframes;
      }
      break;
    }
    case 'fix_transition': {
      if (suggestion.actionPayload?.transitionToNext) {
        targetClip.transitionToNext = normalizeTransitionName(suggestion.actionPayload.transitionToNext);
      }
      break;
    }
    case 'add_broll_overlay':
    case 'add_emphasis_graphic': {
      let rawType =
        suggestion.actionPayload?.graphicType ||
        (suggestion.type === 'add_emphasis_graphic' ? 'titleCard' : 'lowerThird');
      if (rawType === 'icon') rawType = 'iconOverlay' as any;
      const gType = rawType as string;
      const gStart = suggestion.actionPayload?.graphicStart ?? targetClip.startTime;
      const gEnd = suggestion.actionPayload?.graphicEnd ?? Math.min(targetClip.endTime, gStart + 3.0);
      const newGraphic = {
        id: `graphic_${utils.generateShortId()}`,
        type: gType,
        theme: 'minimal',
        animationType: 'pop',
        start: gStart,
        end: gEnd,
        title: suggestion.actionPayload?.graphicText || suggestion.title,
        subtitle: targetClip.text ? targetClip.text.slice(0, 40) : '',
        position: 'bottom',
        color: '#6366F1',
        icon: suggestion.actionPayload?.graphicIcon || '⭐',
      } as any;
      timelineState.setGraphics([...(timelineState.graphics || []), newGraphic]);
      break;
    }
    case 'adjust_pacing': {
      if (suggestion.actionPayload?.targetDuration || suggestion.actionPayload?.newDuration) {
        applyDurationChange(suggestion.actionPayload.targetDuration || suggestion.actionPayload.newDuration!);
      }
      break;
    }
    case 'regenerate_shot': {
      if (suggestion.actionPayload?.imagePrompt) {
        (targetClip as any).image_prompt = suggestion.actionPayload.imagePrompt;
      }
      break;
    }
  }

  timelineState.setClips(clips, true);
  try {
    updateVideoContext();
  } catch {}
  suggestion.applied = true;

  renderDirectorReviewUI(currentDirectorReviewResult);
  drawVideoFrame(state.videoPauseTime);
  ui.showStatus(`Applied: ${suggestion.title}`, false, 2500);
  return true;
}

export function applyAllDirectorSuggestions() {
  if (!currentDirectorReviewResult) return;
  timelineState.saveSnapshot();
  let appliedCount = 0;
  for (const s of currentDirectorReviewResult.suggestions) {
    if (!s.applied) {
      applyDirectorSuggestion(s.id, true);
      appliedCount++;
    }
  }
  if (appliedCount > 0) {
    ui.showStatus(`⚡ Applied all ${appliedCount} AI Director suggestions!`, false, 3500);
  } else {
    ui.showStatus('All suggestions are already applied.', false, 2000);
  }
}

export function renderDirectorReviewUI(reviewResult: DirectorReviewResult) {
  currentDirectorReviewResult = reviewResult;
  if (!dom.directorReviewModal) return;

  dom.directorReviewModal.classList.remove('hidden');

  // Polish Score badge
  if (dom.directorReviewScoreBadge) {
    dom.directorReviewScoreBadge.textContent = `${reviewResult.overallScore}/100`;
    dom.directorReviewScoreBadge.className = `px-2 py-0.5 text-xs font-extrabold rounded-full border ${
      reviewResult.overallScore >= 85
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
        : reviewResult.overallScore >= 70
        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
    }`;
  }

  // Cadence badge & Summary
  if (dom.directorReviewCadenceBadge) {
    dom.directorReviewCadenceBadge.textContent = reviewResult.pacingCadence || 'Dynamic Edit Flow';
  }
  if (dom.directorReviewSummary) {
    dom.directorReviewSummary.textContent = reviewResult.executiveSummary || 'Edit analyzed successfully.';
  }

  // Metrics
  const metrics = reviewResult.pacingMetrics || computeTimelinePacingMetrics();
  if (dom.metricAvgShot) dom.metricAvgShot.textContent = `${metrics.averageShotDuration}s`;
  if (dom.metricWpm) dom.metricWpm.textContent = `${metrics.wordsPerMinute} WPM`;
  if (dom.metricSpm) dom.metricSpm.textContent = `${metrics.shotsPerMinute}`;
  if (dom.metricVariance) {
    const varianceDesc = metrics.pacingVariance < 1.0 ? 'Consistent' : metrics.pacingVariance < 2.5 ? 'Dynamic' : 'High Variety';
    dom.metricVariance.textContent = varianceDesc;
  }

  // Suggestions count
  if (dom.directorReviewSuggestionCount) {
    const pending = reviewResult.suggestions.filter((s) => !s.applied).length;
    dom.directorReviewSuggestionCount.textContent = `${pending} pending / ${reviewResult.suggestions.length} total`;
  }

  // Suggestions List
  if (dom.directorReviewSuggestionsList) {
    dom.directorReviewSuggestionsList.innerHTML = '';
    if (reviewResult.suggestions.length === 0) {
      dom.directorReviewSuggestionsList.innerHTML = `
        <div class="p-6 text-center text-xs text-zinc-400 bg-zinc-950/40 rounded-xl border border-zinc-800">
          🎉 Edit is pristine! No pacing bottlenecks or cinematography clashes detected.
        </div>
      `;
      return;
    }

    reviewResult.suggestions.forEach((s) => {
      const card = document.createElement('div');
      card.className = `p-3.5 rounded-xl border transition-all ${
        s.applied
          ? 'bg-zinc-950/40 border-emerald-500/30 opacity-75'
          : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700 shadow-sm'
      } flex flex-col sm:flex-row sm:items-center justify-between gap-3`;

      const severityBadge =
        s.severity === 'high'
          ? '<span class="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">High Impact</span>'
          : s.severity === 'medium'
          ? '<span class="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Pacing</span>'
          : '<span class="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">Polish</span>';

      const typeIcon =
        s.type === 'trim_shot' ? '✂️' :
        s.type === 'extend_shot' ? '⏱️' :
        s.type === 'change_camera' ? '🎥' :
        s.type === 'fix_transition' ? '⚡' :
        s.type === 'add_broll_overlay' ? '🖼️' :
        s.type === 'add_emphasis_graphic' ? '🏷️' :
        s.type === 'regenerate_shot' ? '🎨' : '🎬';

      card.innerHTML = `
        <div class="flex items-start gap-2.5 min-w-0">
          <span class="text-base flex-shrink-0 mt-0.5">${typeIcon}</span>
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              ${severityBadge}
              <span class="text-[10px] font-mono text-zinc-400 font-bold uppercase">Shot #${(s.targetShotIndex ?? 0) + 1}</span>
              <h5 class="text-xs font-bold text-white truncate">${utils.escapeHtml(s.title)}</h5>
            </div>
            <p class="text-[11px] text-zinc-300 leading-normal">${utils.escapeHtml(s.description)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
          ${
            s.applied
              ? '<span class="px-3 py-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/40 rounded-lg border border-emerald-500/30 flex items-center gap-1">✓ Applied</span>'
              : `<button data-suggestion-id="${s.id}" class="apply-single-suggestion-btn px-3.5 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg shadow transition-all flex items-center gap-1.5 cursor-pointer">
                  <span>⚡</span>
                  <span>Apply Fix</span>
                </button>`
          }
        </div>
      `;

      const applyBtn = card.querySelector('.apply-single-suggestion-btn');
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          applyDirectorSuggestion(s.id);
        });
      }

      dom.directorReviewSuggestionsList.appendChild(card);
    });
  }
}

export function closeDirectorReviewModal() {
  if (dom.directorReviewModal) {
    dom.directorReviewModal.classList.add('hidden');
  }
}

/**
 * Automatically detects keywords, metaphors, and punchy phrases in the transcript
 * and converts them into timed Pop-Up PiP Overlays (Approach A).
 */
export async function autoDetectPipOverlayCues() {
  if (!timelineState.clips || timelineState.clips.length === 0) {
    ui.showStatus('Timeline is empty. Add or generate storyboard clips first.', true, 3000);
    return;
  }

  const scriptText = (dom.storyInput?.value || (state as any).originalStory || '').trim();
  if (!scriptText && (!timelineState.globalWordTimestamps || timelineState.globalWordTimestamps.length === 0)) {
    ui.showStatus('Please enter a script or load master audio with speech to detect pop-up cues.', true, 3000);
    return;
  }

  ui.openProcessingModal('Analyzing transcript for Pop-Up B-Roll cues...', false);

  try {
    const clipContexts = timelineState.clips.map((c, idx) => ({
      index: idx,
      id: c.id,
      startTime: c.startTime,
      endTime: c.endTime,
      duration: c.duration,
      text: c.text || ''
    }));

    ui.updateProcessingProgress(35, 'Identifying visual metaphors & keywords...');

    const prompt = `You are a professional video editor directing Pop-Up Picture-in-Picture (PiP) B-Roll overlays over a continuous A-Roll master speaker.
Given the following timeline shots and their dialogue:
${JSON.stringify(clipContexts, null, 2)}

Script context:
${scriptText.substring(0, 3000)}

Select which shots should be transformed into Pop-Up PiP overlays (floating callout cards in corner/side) when a physical object, metaphor, or action is described (e.g. donkey, heavy loads, sunrise, carrot, salary review).
For shots that are purely dialogue reflections or speaker pauses, keep them as fullscreen A-Roll ("fullscreen").
For shots that emphasize a concrete visual keyword or metaphor, set displayMode to "pip_overlay" and assign:
- pipPosition: "top_right", "top_left", "bottom_right", or "bottom_left" (alternate positions for visual rhythm)
- pipAnimation: "pop_spring", "slide_in", or "zoom_fade"
- pipScale: 0.35 to 0.45

Return JSON strictly conforming to this structure:
{
  "cues": [
    {
      "id": "clip_id",
      "displayMode": "pip_overlay",
      "pipPosition": "top_right",
      "pipAnimation": "pop_spring",
      "pipScale": 0.38,
      "visual_keyword": "keyword detected"
    }
  ]
}`;

    const response = await generateContentWithFallback({
      model: constants.PRIMARY_MODEL,
      contents: prompt,
      mimeType: 'application/json',
      schema: {
        type: Type.OBJECT,
        properties: {
          cues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                displayMode: { type: Type.STRING, enum: ['pip_overlay', 'fullscreen'] },
                pipPosition: { type: Type.STRING, enum: ['top_right', 'top_left', 'bottom_right', 'bottom_left'] },
                pipAnimation: { type: Type.STRING, enum: ['pop_spring', 'slide_in', 'zoom_fade'] },
                pipScale: { type: Type.NUMBER },
                visual_keyword: { type: Type.STRING }
              },
              required: ['id', 'displayMode']
            }
          }
        },
        required: ['cues']
      },
      systemInstruction: 'You are an expert video director specializing in high-retention visual callouts and Picture-in-Picture editing. Output strictly valid JSON matching the schema with no conversational text.'
    });

    ui.updateProcessingProgress(80, 'Applying Pop-Up callout configurations...');

    const parsed = utils.sanitizeAndParseJson(response.text || '{}');
    const cues = parsed.cues || [];

    if (!Array.isArray(cues) || cues.length === 0) {
      ui.showStatus('No visual cue anchors identified. Trying heuristic assignment...', false, 2500);
      let count = 0;
      const updated = timelineState.clips.map((c, i) => {
        if (i % 2 === 1 && c.duration >= 1.5) {
          count++;
          return {
            ...c,
            displayMode: 'pip_overlay' as const,
            pipPosition: count % 2 === 0 ? ('top_left' as const) : ('top_right' as const),
            pipAnimation: 'pop_spring' as const,
            pipScale: 0.38
          };
        }
        return { ...c, displayMode: 'fullscreen' as const };
      });
      timelineState.setClips(updated);
      renderTimelineTracks();
      if (!state.isVideoPlaying) drawVideoFrame(state.lastRenderedTime);
      ui.showStatus(`Configured ${count} Pop-Up B-Roll overlays!`, false, 3000);
      return;
    }

    let pipCount = 0;
    const positions = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];
    const newClips = timelineState.clips.map((c, idx) => {
      const cue = cues.find((item: any) => item.id === c.id || item.index === idx);
      if (cue && cue.displayMode === 'pip_overlay') {
        pipCount++;
        const assignedPos = cue.pipPosition || positions[pipCount % positions.length];
        return {
          ...c,
          displayMode: 'pip_overlay' as const,
          pipPosition: assignedPos,
          pipAnimation: cue.pipAnimation || 'pop_spring',
          pipScale: typeof cue.pipScale === 'number' ? cue.pipScale : 0.38
        };
      }
      return {
        ...c,
        displayMode: 'fullscreen' as const
      };
    });

    if (newClips.length > 0 && newClips[0].displayMode === 'pip_overlay') {
      newClips[0].displayMode = 'fullscreen';
      pipCount = Math.max(0, pipCount - 1);
    }

    timelineState.setClips(newClips);

    // Sync back to state.currentScenes so Inspector immediately reflects the PiP state
    if (state.currentScenes) {
      const allSceneShots: any[] = [];
      for (const scene of state.currentScenes) {
        if (scene.shot_number !== undefined) allSceneShots.push(scene);
        else if (scene.lines) allSceneShots.push(...scene.lines);
        else if (scene.shots) allSceneShots.push(...scene.shots);
      }
      for (const c of newClips) {
        const match = allSceneShots.find((s: any) => s.id === c.id);
        if (match) {
          match.displayMode = c.displayMode;
          match.pipPosition = c.pipPosition;
          match.pipAnimation = c.pipAnimation;
          match.pipScale = c.pipScale;
        }
      }
    }

    renderTimelineTracks();
    if (!state.isVideoPlaying) {
      drawVideoFrame(state.lastRenderedTime);
    }

    ui.logProductionStatus(`✨ Auto-detected and configured ${pipCount} Pop-Up B-Roll overlays.`);
    ui.showStatus(`Configured ${pipCount} Pop-Up B-Roll overlays!`, false, 3500);
  } catch (err: any) {
    console.error('Failed to auto-detect pip cues:', err);
    ui.showStatus(`Pop-Up cue detection failed: ${err.message}`, true, 4000);
  } finally {
    ui.closeProcessingModal();
  }
}

/**
 * Clears all Pop-Up B-Roll (Picture-in-Picture) overlays on the timeline,
 * resetting all shots back to clean fullscreen main video without floating callout boxes.
 */
export function clearAllPipOverlays(options?: { silent?: boolean }): number {
  if (!timelineState.clips || timelineState.clips.length === 0) {
    if (!options?.silent) {
      ui.showStatus('Timeline is empty.', false, 2500);
    }
    return 0;
  }

  let pipCount = 0;
  const updatedClips = timelineState.clips.map((c) => {
    if (c.displayMode === 'pip_overlay') {
      pipCount++;
      return {
        ...c,
        displayMode: 'fullscreen' as const,
      };
    }
    return c;
  });

  if (pipCount === 0) {
    if (!options?.silent) {
      ui.showStatus('No Pop-Up PiP overlays found on the timeline. Video is already playing full-frame.', false, 3000);
    }
    return 0;
  }

  timelineState.setClips(updatedClips);

  // Sync back to state.currentScenes / storyboard shots so inspector and storyboard reflect fullscreen
  if (state.currentScenes) {
    const allSceneShots: any[] = [];
    for (const scene of state.currentScenes) {
      if (scene.shot_number !== undefined) allSceneShots.push(scene);
      else if (scene.lines) allSceneShots.push(...scene.lines);
      else if (scene.shots) allSceneShots.push(...scene.shots);
    }
    for (const s of allSceneShots) {
      if (s.displayMode === 'pip_overlay') {
        s.displayMode = 'fullscreen';
      }
    }
  }

  // Update Inspector UI if currently selected
  if (dom.inspectorPipControls) {
    dom.inspectorPipControls.classList.add('hidden');
  }
  if (dom.inspectorDisplayModeSelect) {
    dom.inspectorDisplayModeSelect.value = 'fullscreen';
  }

  renderTimelineTracks();
  if (!state.isVideoPlaying) {
    drawVideoFrame(state.lastRenderedTime);
  }

  ui.logProductionStatus(`Cleared ${pipCount} Pop-Up PiP overlays — timeline restored to clean main video.`);
  if (!options?.silent) {
    ui.showStatus(`Cleared ${pipCount} Pop-Up PiP overlays. Restored clean main video!`, false, 3500);
  }
  return pipCount;
}

function renderTimelineTracks() {
  try {
    ui.renderTimelineEditor();
  } catch (e) {
    console.warn('Failed to refresh timeline editor:', e);
  }
}
