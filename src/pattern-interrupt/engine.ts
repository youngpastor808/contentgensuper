/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { timelineState } from '../state-timeline';
import { getEffectiveWordTimestamps } from '../videoDirector';
import { normalizeTimeline } from '../videoController';
import { drawVideoFrame } from '../videoRenderer';
import * as ui from '../ui';
import type { GraphicEvent } from '../graphics-engine';
import { HYPERFRAME_PRESETS } from '../hyperframes-engine';
import lexiconData from './lexicon.json';
import type {
  AnalysisSummary,
  ApplyResult,
  CandidateContext,
  CandidateIntervention,
  CandidateMetrics,
  InterruptIntensity,
  InterruptStyle,
  InterventionType,
  MonotonyCandidate,
  PatternInterruptConfig
} from './types';

export const DEFAULT_PATTERN_CONFIG: PatternInterruptConfig = {
  intensity: 'medium',
  style: 'automatic',
  maxPerMinute: 2,
  minDistanceSec: 6.0,
  avoidConsecutiveSameType: true
};

/**
 * Configurable weights for composite Monotony Score heuristic (total ~100).
 * Note: monotonyScore is a heuristic composite metric, not an empirically validated ground-truth measure.
 */
export const SCORE_WEIGHTS = {
  duration: 35,
  static: 25,
  overlayLack: 25,
  narrative: 15
};

/**
 * Disruption weights per intervention type (lower = gentler / less disruptive).
 */
export const DISRUPTION_WEIGHT: Record<InterventionType, number> = {
  camera_movement: 1,
  spotlight: 2,
  punch_in: 3,
  text_emphasis: 4,
  stat_callout: 4,
  image_pip: 5,
};

/**
 * Selects the least disruptive option from the candidates pool that satisfies allowed constraints.
 */
export function pickLeastDisruptive(
  options: CandidateIntervention[],
  allowedTypes?: InterventionType[]
): CandidateIntervention {
  const pool = allowedTypes ? options.filter((o) => allowedTypes.includes(o.type)) : options;
  return [...pool].sort((a, b) => DISRUPTION_WEIGHT[a.type] - DISRUPTION_WEIGHT[b.type])[0] ?? options[0];
}

/**
 * Lightweight suffix-stripping stemmer for inflection normalization.
 */
export function stemWord(word: string): string {
  let w = word.toLowerCase().trim();
  if (w.length <= 3) return w;
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('ous') && !w.endsWith('ius') && !w.endsWith('is') && !w.endsWith('us') && w.length > 3) w = w.slice(0, -1);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('tion') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
  return w;
}

// Build fast lookup Sets from the externalized lexicon and their stems
const HIGH_EMPHASIS_KEYWORDS = new Set<string>();
for (const word of (lexiconData.highEmphasisKeywords || [])) {
  const clean = word.toLowerCase().trim();
  HIGH_EMPHASIS_KEYWORDS.add(clean);
  HIGH_EMPHASIS_KEYWORDS.add(stemWord(clean));
}

const COMPARISON_KEYWORDS = new Set<string>();
for (const word of (lexiconData.comparisonKeywords || [])) {
  const clean = word.toLowerCase().trim();
  COMPARISON_KEYWORDS.add(clean);
  COMPARISON_KEYWORDS.add(stemWord(clean));
}

const REVELATION_PHRASES: string[] = lexiconData.revelationPhrases || [];

const STATISTIC_REGEX = /\b(\$?\d+(?:\.\d+)?%?|\d+(?:x|k|m|b)\b|\b(?:million|billion|thousand|hundred|percent|ratio|double|triple)\b)/i;

/**
 * Stage 1: Detect stretches where the video becomes visually or rhythmically monotonous.
 */
export function detectMonotonyStretches(
  config: PatternInterruptConfig = DEFAULT_PATTERN_CONFIG
): MonotonyCandidate[] {
  const clips = timelineState.clips || [];
  if (!clips.length) return [];

  const existingGraphics = timelineState.graphics || [];
  const words = getEffectiveWordTimestamps() || [];

  // Minimum duration threshold for a monotonous stretch based on intensity
  const minMonotonyDuration =
    config.intensity === 'high' ? 5.0 :
    config.intensity === 'low' ? 8.0 : 6.2;

  const rawCandidates: MonotonyCandidate[] = [];

  clips.forEach((clip, clipIndex) => {
    const clipStart = Number(clip.startTime) || 0;
    const clipEnd = Number(clip.endTime) || (clipStart + (clip.duration || 5));
    const clipDur = Math.max(0.1, clipEnd - clipStart);

    // If clip is shorter than the minimum monotonous duration, it alone isn't monotonous
    if (clipDur < minMonotonyDuration) return;

    // Check motion characteristics
    const movement = clip.cameraMovement || clip.camera_movement || 'static';
    const isStatic = movement === 'none' || movement === 'static';
    const hasKeyframes = Boolean(clip.cameraKeyframes);
    const motionPct = isStatic && !hasKeyframes ? 5 : isStatic ? 20 : 40;

    // Check if there are active overlays / graphics during this clip
    const clipGraphics = existingGraphics.filter(
      (g) => g.start < clipEnd && g.end > clipStart
    );
    const hasPip = clip.displayMode === 'pip_overlay';
    const hasElements = Boolean(clip.elements && clip.elements.length > 0);

    const overlayCount = clipGraphics.length + (hasPip ? 1 : 0) + (hasElements ? 1 : 0);
    const visualChangePct = Math.min(100, overlayCount * 30 + (isStatic ? 10 : 35));

    // If the clip already has high visual change, skip
    if (visualChangePct > 65) return;

    // Determine candidate trigger point:
    // Ideally 40% to 65% into the clip, where viewer attention begins dropping
    const targetOffset = Math.min(clipDur - 1.5, Math.max(2.5, clipDur * 0.52));
    const triggerTime = clipStart + targetOffset;

    // Check subtitle/speech density around this stretch
    const nearbyWords = words.filter(
      (w) => w.start >= clipStart && w.end <= clipEnd
    );
    const wordsPerSec = nearbyWords.length / clipDur;

    // Stage 2: Understand narration and speech context around this moment
    const context = analyzeSpeechContext(triggerTime, words, clip);

    // Compute composite Monotony Score (0 - 100) using configurable weights.
    // Note: monotonyScore is a heuristic composite metric, not an empirically measured ground-truth value.
    const durationFactor = Math.min(1.0, clipDur / 12.0); // clips >= 12s get max duration penalty
    const staticFactor = isStatic ? 1.0 : 0.4;
    const overlayLackFactor = Math.max(0, 1.0 - overlayCount * 0.4);
    const narrativeWeight = context.triggerCategory === 'emphasis' || context.triggerCategory === 'revelation' ? 0.9 : 0.5;

    const monotonyScore = Math.min(
      98,
      Math.round(
        durationFactor * SCORE_WEIGHTS.duration +
        staticFactor * SCORE_WEIGHTS.static +
        overlayLackFactor * SCORE_WEIGHTS.overlayLack +
        narrativeWeight * SCORE_WEIGHTS.narrative
      )
    );

    // Discard candidates that don't meet intensity threshold
    const minScoreThreshold =
      config.intensity === 'high' ? 45 :
      config.intensity === 'low' ? 70 : 55;

    if (monotonyScore < minScoreThreshold) return;

    const metrics: CandidateMetrics = {
      duration: Math.round(clipDur * 10) / 10,
      visualChangePct: Math.round(visualChangePct),
      motionPct,
      sceneChangePct: 0, // TODO: not yet computed, reserved for future frame-diff pass
      subtitleDensity: Math.round(wordsPerSec * 10) / 10,
      narrativeImportance: Math.round(narrativeWeight * 100),
      monotonyScore,
      scoreBreakdown: {
        durationFactor: Math.round(durationFactor * 100) / 100,
        staticFactor: Math.round(staticFactor * 100) / 100,
        overlayLackFactor: Math.round(overlayLackFactor * 100) / 100,
        narrativeWeight: Math.round(narrativeWeight * 100) / 100
      }
    };

    // Stage 3: Generate interventions with least-disruptive ranking
    const { primary, alternatives } = selectInterventions(
      metrics,
      context,
      config.style,
      clip,
      triggerTime
    );

    rawCandidates.push({
      id: `pi_${clip.id || clipIndex}_${Math.round(triggerTime * 10)}`,
      clipId: clip.id || `${clipIndex}`,
      clipIndex,
      timestamp: Math.round(triggerTime * 100) / 100,
      stretchStart: clipStart,
      stretchEnd: clipEnd,
      metrics,
      context,
      intervention: primary,
      alternativeInterventions: alternatives,
      enabled: true
    });
  });

  return rawCandidates;
}

/**
 * Stage 2: Understand the narrative moment and extract contextual intent.
 */
function analyzeSpeechContext(
  time: number,
  words: { word: string; start: number; end: number }[],
  clip: any
): CandidateContext {
  // Extract words spoken around this trigger point (within -1s to +2.5s window)
  const windowWords = words.filter(
    (w) => w.start >= time - 1.2 && w.end <= time + 2.8
  );

  const phraseText = windowWords.map((w) => w.word).join(' ').trim();
  const lowerPhrase = phraseText.toLowerCase();

  // 1. Check for high-emphasis or revelation words (with stemming / inflection support)
  let emphasisWord: string | undefined;
  for (const w of windowWords) {
    const cleanWord = w.word.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stemmed = stemWord(cleanWord);
    if (HIGH_EMPHASIS_KEYWORDS.has(cleanWord) || HIGH_EMPHASIS_KEYWORDS.has(stemmed)) {
      emphasisWord = cleanWord.toUpperCase();
      break;
    }
  }

  // 2. Check for statistics or numbers
  const statMatch = phraseText.match(STATISTIC_REGEX);

  // 3. Classify trigger intent
  if (REVELATION_PHRASES.some((phrase) => lowerPhrase.includes(phrase))) {
    return {
      verbatimPhrase: phraseText || 'Critical narrative turning point',
      emphasisWord: emphasisWord || 'KEY REVELATION',
      triggerCategory: 'revelation',
      reason: 'Narrative revelation moment: viewer needs visual emphasis',
      detectionMethod: 'keyword'
    };
  }

  if (emphasisWord) {
    return {
      verbatimPhrase: phraseText || `Emphasis on key concept`,
      emphasisWord,
      triggerCategory: 'emphasis',
      reason: `Key statement emphasis: '${emphasisWord}' requires a pacing accent`,
      detectionMethod: 'keyword'
    };
  }

  if (statMatch) {
    return {
      verbatimPhrase: phraseText,
      emphasisWord: statMatch[1].toUpperCase(),
      triggerCategory: 'statistic',
      reason: `Quantifiable data point '${statMatch[1]}': perfect for a concise stat badge`,
      detectionMethod: 'keyword'
    };
  }

  for (const w of windowWords) {
    const clean = w.word.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stemmed = stemWord(clean);
    if (COMPARISON_KEYWORDS.has(clean) || COMPARISON_KEYWORDS.has(stemmed)) {
      return {
        verbatimPhrase: phraseText,
        emphasisWord: clean.toUpperCase(),
        triggerCategory: 'comparison',
        reason: 'Comparative or conceptual reference: benefits from supporting visual context',
        detectionMethod: 'keyword'
      };
    }
  }

  if (
    lowerPhrase.includes('danger') ||
    lowerPhrase.includes('risk') ||
    lowerPhrase.includes('threat') ||
    lowerPhrase.includes('fatal') ||
    lowerPhrase.includes('crisis') ||
    lowerPhrase.includes('catastrophe')
  ) {
    return {
      verbatimPhrase: phraseText,
      triggerCategory: 'danger',
      reason: 'Tense or high-stakes statement: demands dramatic focus',
      detectionMethod: 'keyword'
    };
  }

  if (phraseText.includes('?') || lowerPhrase.startsWith('why') || lowerPhrase.startsWith('how')) {
    return {
      verbatimPhrase: phraseText,
      triggerCategory: 'question',
      reason: 'Rhetorical question / thought hook: reset viewer attention',
      detectionMethod: 'keyword'
    };
  }

  // Fallback: visual monotony during steady narration
  return {
    verbatimPhrase: phraseText || (clip.title ? `Scene: ${clip.title}` : 'Prolonged static visual'),
    triggerCategory: 'general',
    reason: 'Prolonged visual sameness: needs a subtle attention refresh',
    detectionMethod: 'keyword'
  };
}

/**
 * Stage 3: Choose the least disruptive intervention motivated by the context and user style.
 */
function selectInterventions(
  metrics: CandidateMetrics,
  context: CandidateContext,
  style: InterruptStyle,
  clip: any,
  time: number
): { primary: CandidateIntervention; alternatives: CandidateIntervention[] } {
  const options: CandidateIntervention[] = [];

  // Option A: Micro Punch-In (Level 1)
  const punchScale = style === 'high_retention' ? 1.16 : style === 'cinematic' ? 1.09 : 1.12;
  const punchIn: CandidateIntervention = {
    type: 'punch_in',
    level: style === 'high_retention' ? 2 : 1,
    label: `🔍 ${Math.round(punchScale * 100)}% Punch-In`,
    description: 'Subtle framing crop jump on the emphasis beat to reset visual attention',
    details: `Applies a clean ${Math.round((punchScale - 1) * 100)}% scale jump at ${time.toFixed(1)}s`,
    payload: { scale: punchScale, duration: Math.min(3.5, metrics.duration * 0.45) }
  };
  options.push(punchIn);

  // Option B: Kinetic Text Emphasis (Level 2)
  const headline = context.emphasisWord
    ? context.emphasisWord
    : context.verbatimPhrase.split(' ').slice(0, 4).join(' ').toUpperCase();

  const textEmphasis: CandidateIntervention = {
    type: 'text_emphasis',
    level: 2,
    label: `📝 Text Accent: "${headline.slice(0, 18)}"`,
    description: 'Dynamic typographic card emphasizing the key phrase spoken',
    details: `Displays animated emphasis title card for 2.0s`,
    payload: { text: headline, duration: 2.0 }
  };
  options.push(textEmphasis);

  // Option C: Smooth Camera Push-In / Drift (Level 1)
  const cameraMovement: CandidateIntervention = {
    type: 'camera_movement',
    level: 1,
    label: '↔️ Camera Push-In',
    description: 'Smooth cinematic push-in transition to add motion without visual clutter',
    details: 'Gradually pushes camera scale from 1.0x to 1.15x',
    payload: { movement: 'zoom_in' }
  };
  options.push(cameraMovement);

  // Option D: Stat or Metric Callout (Level 2)
  if (context.triggerCategory === 'statistic' || context.emphasisWord) {
    const statVal = context.emphasisWord || '10x';
    const statCallout: CandidateIntervention = {
      type: 'stat_callout',
      level: 2,
      label: `📊 Metric Callout: ${statVal}`,
      description: 'Clean floating stat badge highlighting the numeric data point',
      details: 'Animates a stat badge card onto screen for 2.5s',
      payload: { value: statVal, label: context.verbatimPhrase.slice(0, 24) }
    };
    options.push(statCallout);
  }

  // Option E: Pop-Up Picture-in-Picture Card (Level 2 or 3)
  if (context.triggerCategory === 'comparison' || context.triggerCategory === 'revelation') {
    const imagePip: CandidateIntervention = {
      type: 'image_pip',
      level: 2,
      label: '🖼️ Supporting Pop-Up Card',
      description: 'Cinematic picture-in-picture card providing visual context for the statement',
      details: 'Overlays a picture-in-picture callout card in the corner',
      payload: { position: 'bottom_right', scale: 0.38 }
    };
    options.push(imagePip);
  }

  // Option F: Spotlight Accent (Level 1)
  if (context.triggerCategory === 'danger' || context.triggerCategory === 'emphasis') {
    const spotlight: CandidateIntervention = {
      type: 'spotlight',
      level: 1,
      label: '🔦 Dramatic Spotlight',
      description: 'Soft vignette focus drawing viewer gaze into the core subject',
      details: 'Brief 2.2s focal illumination pass',
      payload: { intensity: 0.75, duration: 2.2 }
    };
    options.push(spotlight);
  }

  // Rank and select primary based on Style preset & "Least Disruptive" principle
  let primary: CandidateIntervention;

  switch (style) {
    case 'subtle':
      // Strictly Level 1 micro-interrupts, ranked by least disruptive
      primary = pickLeastDisruptive(options, ['camera_movement', 'spotlight', 'punch_in']);
      break;

    case 'cinematic':
      // Prefers camera movements, spotlights, or subtle punch-ins
      if (context.triggerCategory === 'danger') {
        primary = pickLeastDisruptive(options, ['spotlight', 'camera_movement', 'punch_in']);
      } else {
        primary = pickLeastDisruptive(options, ['camera_movement', 'spotlight', 'punch_in']);
      }
      break;

    case 'documentary':
      // Prefers stat callouts, contextual text cards, or gentle camera push
      if (context.triggerCategory === 'statistic') {
        primary = pickLeastDisruptive(options, ['stat_callout', 'text_emphasis', 'camera_movement']);
      } else if (context.triggerCategory === 'comparison') {
        primary = pickLeastDisruptive(options, ['image_pip', 'text_emphasis', 'camera_movement']);
      } else {
        primary = pickLeastDisruptive(options, ['text_emphasis', 'camera_movement', 'spotlight']);
      }
      break;

    case 'high_retention':
      // Snappy punch-ins and bold text accents
      if (context.triggerCategory === 'emphasis' || context.triggerCategory === 'revelation') {
        primary = pickLeastDisruptive(options, ['text_emphasis', 'punch_in', 'stat_callout']);
      } else {
        primary = pickLeastDisruptive(options, ['punch_in', 'text_emphasis', 'camera_movement']);
      }
      break;

    case 'automatic':
    default:
      // Adaptive least disruptive selection based on context intent
      if (context.triggerCategory === 'statistic') {
        primary = pickLeastDisruptive(options, ['stat_callout', 'text_emphasis']);
      } else if (context.triggerCategory === 'revelation') {
        primary = pickLeastDisruptive(options, ['text_emphasis', 'spotlight', 'image_pip']);
      } else if (context.triggerCategory === 'danger') {
        primary = pickLeastDisruptive(options, ['spotlight', 'camera_movement', 'punch_in']);
      } else if (context.triggerCategory === 'comparison') {
        primary = pickLeastDisruptive(options, ['image_pip', 'camera_movement', 'text_emphasis']);
      } else {
        // Default to gentlest micro-intervention
        primary = pickLeastDisruptive(options, ['camera_movement', 'spotlight', 'punch_in']);
      }
      break;
  }

  const alternatives = options.filter((o) => o.type !== primary.type);
  return { primary, alternatives };
}

/**
 * Applies pacing rules: minimum cooldown, maximum frequency per minute, and anti-repetition.
 */
export function enforcePacingConstraints(
  candidates: MonotonyCandidate[],
  config: PatternInterruptConfig = DEFAULT_PATTERN_CONFIG
): MonotonyCandidate[] {
  if (!candidates.length) return [];

  // Sort chronologically
  const sorted = [...candidates].sort((a, b) => a.timestamp - b.timestamp);
  const accepted: MonotonyCandidate[] = [];

  let lastTime = -999;
  let lastType: InterventionType | null = null;

  for (const c of sorted) {
    // 1. Check minimum distance constraint
    if (c.timestamp - lastTime < config.minDistanceSec) {
      continue;
    }

    // 2. Avoid consecutive same-type interruption if requested
    if (config.avoidConsecutiveSameType && lastType && c.intervention.type === lastType) {
      // Try to swap to a different alternative intervention
      const alt = c.alternativeInterventions.find((a) => a.type !== lastType);
      if (alt) {
        c.intervention = alt;
      } else {
        continue;
      }
    }

    // 3. Max interruptions per minute check
    const oneMinWindowStart = c.timestamp - 60;
    const countInLastMinute = accepted.filter((a) => a.timestamp >= oneMinWindowStart).length;
    if (countInLastMinute >= config.maxPerMinute) {
      continue;
    }

    accepted.push(c);
    lastTime = c.timestamp;
    lastType = c.intervention.type;
  }

  return accepted;
}

/**
 * Full Pipeline: Analyzes the timeline and returns the complete candidate set.
 */
export function analyzeTimelineForPatternInterrupts(
  config: PatternInterruptConfig = DEFAULT_PATTERN_CONFIG
): AnalysisSummary {
  const rawCandidates = detectMonotonyStretches(config);
  const filtered = enforcePacingConstraints(rawCandidates, config);

  const totalMonotonousSec = rawCandidates.reduce((acc, c) => acc + c.metrics.duration, 0);
  const totalTimelineDuration = timelineState.clips?.reduce((acc: number, c: any) => acc + (c.duration || 0), 0) || 1;
  const monotonyPercentage = Math.min(100, Math.round((totalMonotonousSec / totalTimelineDuration) * 100));

  return {
    totalMonotonousSeconds: Math.round(totalMonotonousSec * 10) / 10,
    monotonyPercentage,
    candidatesFound: rawCandidates.length,
    filteredCandidates: filtered
  };
}

/**
 * Applies the selected pattern interrupts to the live timeline.
 * Converts interventions into standard timeline elements (cuts/keyframes, graphics, PiP).
 * Operates on immutable snapshot to eliminate array index drift and provides full skip diagnostics.
 */
export function applyPatternInterrupts(candidatesToApply: MonotonyCandidate[]): ApplyResult {
  const activeCandidates = candidatesToApply.filter((c) => c.enabled);
  const skipped: ApplyResult['skipped'] = [];

  if (!activeCandidates.length) {
    return { appliedCount: 0, skipped: [] };
  }

  // 1. Immutable snapshot of the clips array before any splits or modifications this run
  const originalClips = (timelineState.clips || []).map((c: any) => ({ ...c }));
  if (!originalClips.length) {
    return {
      appliedCount: 0,
      skipped: activeCandidates.map((c) => ({
        id: c.id,
        reason: 'Timeline has no clips available for applying pattern interrupts.'
      }))
    };
  }

  function findOriginalClip(timestamp: number) {
    return originalClips.find(
      (clip) =>
        timestamp >= (clip.startTime ?? 0) &&
        timestamp <= (clip.endTime ?? ((clip.startTime ?? 0) + (clip.duration || 5)))
    );
  }

  // Identify clip-mutating interventions vs non-clip-mutating overlays
  const isClipMutating = (type: InterventionType) =>
    type === 'punch_in' || type === 'camera_movement' || type === 'image_pip';

  // Group clip-mutating interventions by targeted original clip to guard against same-clip corruption
  const candidatesByClipKey = new Map<string, MonotonyCandidate[]>();
  const validCandidates: MonotonyCandidate[] = [];

  for (const c of activeCandidates) {
    const origClip = findOriginalClip(c.timestamp);
    const itype = c.intervention.type;

    if (!origClip) {
      if (itype !== 'text_emphasis' && itype !== 'stat_callout') {
        skipped.push({
          id: c.id,
          reason: `No clip found at timestamp ${c.timestamp}s for intervention type "${itype}"`
        });
        continue;
      }
      // Graphic overlays not bound to a clip can still apply
      validCandidates.push(c);
      continue;
    }

    if (isClipMutating(itype)) {
      const clipKey = origClip.id || `${origClip.startTime}`;
      const existing = candidatesByClipKey.get(clipKey) || [];
      existing.push(c);
      candidatesByClipKey.set(clipKey, existing);
    } else {
      // Level 2 / Graphic overlays (text_emphasis, stat_callout, spotlight) don't conflict with clip cuts
      validCandidates.push(c);
    }
  }

  // Guard: if two candidates resolve to the same original clip and mutate clip timing/scale,
  // retain only the higher-scored candidate and log a dropped-candidate reason.
  for (const [clipKey, cands] of candidatesByClipKey.entries()) {
    if (cands.length === 1) {
      validCandidates.push(cands[0]);
    } else {
      cands.sort((a, b) => b.metrics.monotonyScore - a.metrics.monotonyScore);
      const winner = cands[0];
      validCandidates.push(winner);

      for (let i = 1; i < cands.length; i++) {
        const dropped = cands[i];
        const clipTitle = findOriginalClip(dropped.timestamp)?.title || clipKey;
        skipped.push({
          id: dropped.id,
          reason: `Same-clip conflict on "${clipTitle}" at ${dropped.timestamp}s: retained higher-scored candidate "${winner.intervention.label}" (${winner.metrics.monotonyScore}%) over "${dropped.intervention.label}" (${dropped.metrics.monotonyScore}%)`
        });
      }
    }
  }

  if (!validCandidates.length) {
    return { appliedCount: 0, skipped };
  }

  // 2. Save snapshot for instant Undo
  timelineState.saveSnapshot();

  let appliedCount = 0;
  const currentGraphics = [...(timelineState.graphics || [])];

  // Map each original clip to its replacement array of clips:
  // - Untouched clip: [origClip]
  // - Split punch-in clip: [part1, part2]
  // - Modified clip: [modifiedClip]
  const clipTransformMap = new Map<string, any[]>();
  for (const orig of originalClips) {
    const key = orig.id || `${orig.startTime}`;
    clipTransformMap.set(key, [{ ...orig }]);
  }

  for (const c of validCandidates) {
    const itype = c.intervention.type;
    const origClip = findOriginalClip(c.timestamp);

    switch (itype) {
      case 'punch_in': {
        if (!origClip) {
          skipped.push({ id: c.id, reason: `No clip found at timestamp ${c.timestamp}s for punch_in` });
          break;
        }
        const key = origClip.id || `${origClip.startTime}`;
        const scaleVal = c.intervention.payload.scale || 1.14;
        const splitPoint = c.timestamp - origClip.startTime;

        if (splitPoint >= 0.8 && origClip.duration - splitPoint >= 0.8) {
          const part1 = {
            ...origClip,
            id: origClip.id || `clip_${Date.now()}_a`,
            startTime: origClip.startTime,
            endTime: c.timestamp,
            duration: splitPoint
          };

          const part2 = {
            ...origClip,
            id: `${origClip.id || 'clip'}_punch`,
            startTime: c.timestamp,
            endTime: origClip.endTime,
            duration: origClip.duration - splitPoint,
            videoStartOffset: (origClip.videoStartOffset || 0) + splitPoint,
            cameraKeyframes: {
              start: { scale: scaleVal, x: 0, y: 0 },
              end: { scale: scaleVal + 0.03, x: 0, y: 0 },
              easing: 'easeInOutCubic'
            }
          };

          clipTransformMap.set(key, [part1, part2]);
        } else {
          // Micro-clip: adjust existing cameraKeyframes without splitting
          const micro = {
            ...origClip,
            cameraKeyframes: {
              start: { scale: scaleVal, x: 0, y: 0 },
              end: { scale: scaleVal + 0.04, x: 0, y: 0 },
              easing: 'easeOutQuad'
            }
          };
          clipTransformMap.set(key, [micro]);
        }
        appliedCount++;
        c.applied = true;
        break;
      }

      case 'camera_movement': {
        if (!origClip) {
          skipped.push({ id: c.id, reason: `No clip found at timestamp ${c.timestamp}s for camera_movement` });
          break;
        }
        const key = origClip.id || `${origClip.startTime}`;
        const modified = {
          ...origClip,
          cameraMovement: c.intervention.payload.movement || 'zoom_in',
          cameraKeyframes: {
            start: { scale: 1.0, x: 0, y: 0 },
            end: { scale: 1.15, x: 0, y: 0 },
            easing: 'easeInOutQuad'
          }
        };
        clipTransformMap.set(key, [modified]);
        appliedCount++;
        c.applied = true;
        break;
      }

      case 'image_pip': {
        if (!origClip) {
          skipped.push({ id: c.id, reason: `No clip found at timestamp ${c.timestamp}s for image_pip` });
          break;
        }
        const key = origClip.id || `${origClip.startTime}`;
        const modified = {
          ...origClip,
          displayMode: 'pip_overlay',
          pipPosition: c.intervention.payload.position || 'bottom_right',
          pipScale: c.intervention.payload.scale || 0.38
        };
        clipTransformMap.set(key, [modified]);
        appliedCount++;
        c.applied = true;
        break;
      }

      case 'text_emphasis': {
        const titleText = c.intervention.payload.text || c.context.emphasisWord || 'KEY TAKEAWAY';
        const dur = Math.max(2.4, c.intervention.payload.duration || 3.0);
        const cat = c.context?.triggerCategory || 'general';

        let templateId = 'reels-hook';
        let sfx: any = 'impact';
        let preset = HYPERFRAME_PRESETS.find(p => p.id === 'reels-hook');

        if (cat === 'danger') {
          templateId = 'pattern-mistake';
          sfx = 'impact';
          preset = HYPERFRAME_PRESETS.find(p => p.id === 'pattern-mistake');
        } else if (cat === 'revelation' || cat === 'question') {
          templateId = 'pattern-wait';
          sfx = 'bass_drop';
          preset = HYPERFRAME_PRESETS.find(p => p.id === 'pattern-wait');
        }

        const fallback = HYPERFRAME_PRESETS[0];
        const chosen = preset || fallback;
        const phrase = c.context.verbatimPhrase ? `"${c.context.verbatimPhrase.slice(0, 40)}"` : '';

        const customHtml = `
<div class="flex flex-col items-center gap-1.5 text-center drop-shadow-[0_12px_28px_rgba(0,0,0,0.85)] select-none">
  <span class="px-3 py-0.5 rounded-full bg-black/90 border border-amber-400/50 text-amber-300 text-[10px] font-mono font-bold tracking-widest uppercase">
    ⚡ ATTENTION
  </span>
  <div class="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 text-black font-black text-xl sm:text-2xl tracking-tight uppercase shadow-2xl transform -rotate-1 border border-white/20">
    ${titleText}
  </div>
  ${phrase ? `<p class="text-[10px] text-zinc-300 font-sans max-w-xs drop-shadow truncate mt-0.5">${phrase}</p>` : ''}
</div>`;

        const newGraphic: GraphicEvent = {
          id: `graphic_pi_hf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'hyperFrame',
          start: c.timestamp,
          end: c.timestamp + dur,
          title: titleText,
          templateId,
          html: (chosen.id === 'pattern-wait' || chosen.id === 'pattern-mistake') ? chosen.html.trim() : customHtml.trim(),
          animationIn: 'spring-bounce',
          animationOut: 'scale-down',
          position: 'center',
          accentColor: chosen.accentColor || '#f59e0b',
          textColor: '#ffffff',
          audioReactive: true,
          musicReactiveGlow: true,
          sfxTrigger: sfx,
          beatPulseScale: 0.12,
        } as any;

        currentGraphics.push(newGraphic);
        appliedCount++;
        c.applied = true;
        break;
      }

      case 'stat_callout': {
        const statVal = c.intervention.payload.value || '10x';
        const statLabel = c.intervention.payload.label || 'STATISTIC';

        const newGraphic: GraphicEvent = {
          id: `graphic_pi_stat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'statCounter',
          start: c.timestamp,
          end: c.timestamp + 2.5,
          value: statVal,
          label: statLabel,
          accentColor: '#10b981',
          animationType: 'bounce',
          theme: 'bold-badge'
        } as any;

        currentGraphics.push(newGraphic);
        appliedCount++;
        c.applied = true;
        break;
      }

      case 'spotlight': {
        const dur = c.intervention.payload.duration || 2.2;
        const newGraphic: GraphicEvent = {
          id: `graphic_pi_spot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'spotlightFocus',
          start: c.timestamp,
          end: c.timestamp + dur,
          focusX: 0.5,
          focusY: 0.45,
          radius: 0.35,
          dimOpacity: 0.65,
          feather: 0.2
        } as any;

        currentGraphics.push(newGraphic);
        appliedCount++;
        c.applied = true;
        break;
      }
    }
  }

  // 3. Assemble final clips array preserving original order and normalize timing in one single pass
  const finalClips: any[] = [];
  for (const orig of originalClips) {
    const key = orig.id || `${orig.startTime}`;
    const resultingSegments = clipTransformMap.get(key) || [orig];
    finalClips.push(...resultingSegments);
  }

  // Single-pass chronological continuity guarantee
  let runningTime = 0;
  for (const clip of finalClips) {
    clip.startTime = runningTime;
    clip.endTime = runningTime + clip.duration;
    runningTime = clip.endTime;
  }

  // 4. Commit updated state
  timelineState.setClips(finalClips);
  timelineState.setGraphics(currentGraphics);
  normalizeTimeline();

  // 5. Refresh views
  ui.renderTimelineEditor();
  if (candidatesToApply[0]) {
    drawVideoFrame(candidatesToApply[0].timestamp);
  }

  return { appliedCount, skipped };
}

/**
 * Reverts pattern interrupts by triggering timeline snapshot undo.
 */
export function undoPatternInterrupts(): boolean {
  if (!timelineState.canUndo()) {
    return false;
  }
  return timelineState.undo();
}
