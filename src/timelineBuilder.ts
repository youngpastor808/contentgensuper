/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from "./state";
import { timelineState } from "./state-timeline";
import * as dom from "./dom";
import * as ui from "./ui";
import * as utils from "./utils";
import { generateMasterNarration } from "./audioPipeline";
import { forceAlignAudio } from "./api/audio";
import { audioBufferToWavBlob } from "./utils-core";
import { drawVideoFrame } from "./videoRenderer";
import { updateVideoContext, normalizeTimeline } from "./videoController";
import type { WordTimestamp } from './types';
import { isProjectHydrating } from './projectHydration';
import { ALIGNMENT_THRESHOLDS } from './timing/timeline-timing';

type Silence = { start: number; end: number };
type TranscriptWord = { word: string; start: number; end: number };

type Shot = {
  id?: string;
  _imageObjectURL?: string;
  _videoObjectURL?: string;
  camera_movement?: string;
  focalPoint?: { x: number; y: number };
  narration?: string;
  text_reference?: string;
  line_text?: string;
  script?: string;
  dialogue?: string;
  prompt_source_text?: string;
  image_prompt?: string;
  __sceneIndex?: number;
  __lineIndex?: number;
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "at",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "it",
  "this",
  "that",
  "these",
  "those",
  "as",
  "but",
  "if",
  "then",
  "so",
]);

let productionRunId = 0;

export function bumpRunId() {
  productionRunId++;
  return productionRunId;
}

export function assertStillRunning(runId: number) {
  if (!state.isVideoProductionRunning || runId !== productionRunId) {
    throw new Error("Stopped.");
  }
}

/**
 * Greedy subsequence matcher for robust transcript alignment.
 */
function isMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

function scoreMatchWithEnd(
  shotTokens: string[],
  transNorm: string[],
  start: number,
  maxLen: number,
) {
  let matches = 0;
  let t = start;
  const end = Math.min(start + maxLen, transNorm.length);
  let firstMatchIdx = -1;

  for (let s = 0; s < shotTokens.length; s++) {
    const tok = shotTokens[s];

    // Look ahead a bounded window to find the token to prevent catastrophic skipping
    const lookaheadLimit = Math.min(8, end - t); // Max 8 tokens skip
    for (let lookahead = 0; lookahead < lookaheadLimit; lookahead++) {
      if (isMatch(transNorm[t + lookahead], tok)) {
        if (firstMatchIdx === -1) firstMatchIdx = t + lookahead;
        matches++;
        t = t + lookahead + 1;
        break;
      }
    }
    // If not found in the lookahead window, this shot token is considered missing,
    // and we DON'T advance `t`. This allows the next shot token to match against
    // the current transcript position.
  }

  const firstMatch = firstMatchIdx === -1 ? start : firstMatchIdx;
  const matchedSpan = Math.max(1, t - firstMatch);

  // Penalize the score if the matched tokens are spread out over a much larger area
  // For example, matching 5 tokens shouldn't take 50 transcript tokens!
  let densityPenalty = 0;
  if (matches > 0) {
    const expectedSpan = shotTokens.length;
    const extraTokens = Math.max(0, matchedSpan - expectedSpan);
    densityPenalty = Math.min(0.5, (extraTokens / expectedSpan) * 0.1);
  }

  const rawScore = matches / Math.max(1, shotTokens.length);

  return {
    score: Math.max(0, rawScore - densityPenalty),
    endIdx: t,
    firstMatchIdx: firstMatch,
  };
}

function normTokens(s: string): string[] {
  const rawWords = (s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

  // If the sentence is short (<= 4 words), do NOT filter stop words.
  // This prevents short spoken phrases from losing all tokens and triggering false 10% fallbacks.
  if (rawWords.length <= 4) {
    return rawWords;
  }

  const filtered = rawWords.filter((w) => !STOP_WORDS.has(w));
  return filtered.length > 0 ? filtered : rawWords;
}

export function enforceMonotonicStarts(
  starts: number[],
  minGap: number,
  maxTime: number,
): number[] {
  if (starts.length === 0) return starts;
  const out = [...starts];
  out[0] = 0;

  // Forward pass: normal monotonic enforcement
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = Math.max(prev + minGap, out[i]);
    out[i] = Math.max(0, cur);
  }

  // Backward pass: if we overran maxTime, pull everything back so
  // gaps are preserved instead of collapsing onto maxTime.
  if (out[out.length - 1] > maxTime) {
    out[out.length - 1] = maxTime;
    for (let i = out.length - 2; i >= 0; i--) {
      out[i] = Math.min(out[i], out[i + 1] - minGap);
    }
    // Safety: if pulling back pushed anything below 0, clamp forward again
    if (out[0] < 0) {
      out[0] = 0;
      for (let i = 1; i < out.length; i++) {
        out[i] = Math.max(out[i - 1] + minGap, out[i]);
      }
    }
  } else {
    out[out.length - 1] = Math.min(out[out.length - 1], maxTime);
  }

  return out;
}

export interface CanonicalShotRange {
  shotIndex: number;
  shotId?: string;
  startWordIndex: number;
  endWordIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  alignmentConfidence: number; // 0.0 to 1.0 (blended/backward compatible)
  textMatchConfidence?: number;
  timingReliability?: number;
  timingProvenance?: 'acoustic_word' | 'acoustic_island_bounded' | 'silence_snapped' | 'synthetic_fallback' | 'manual';
  matchedWordCount: number;
  totalShotTokens: number;
  status: 'high_confidence' | 'acceptable' | 'low_confidence' | 'fallback' | 'island_bounded';
  timingSource: 'deepgram' | 'forced_alignment' | 'synthetic' | 'manual';
}

export interface TimelineConsistencyReport {
  audioDuration: number;
  firstClipStart: number;
  lastClipEnd: number;
  totalClipCoverage: number;
  gaps: { index: number; start: number; end: number; gapSeconds: number }[];
  overlaps: { index: number; clipAEnd: number; clipBStart: number; overlapSeconds: number }[];
  totalWords: number;
  matchedWords: number;
  unmatchedWords: number;
  shotAudits: Array<{
    shotNumber: number;
    shotId: string;
    startTime: number;
    endTime: number;
    duration: number;
    startWordIndex: number;
    endWordIndex: number;
    matchedWordsCount: number;
    confidencePercent: number;
    timingReliabilityPercent?: number;
    timingProvenance?: string;
    isWarning: boolean;
    isOutlier?: boolean;
    warningMsg?: string;
  }>;
  driftSeconds: number;
  syncHealthPercent: number;
  isAudioLocked: boolean;
  formattedText: string;
}

/**
 * Storyboard-locked canonical alignment with continuous timeline ranges,
 * absolute word index tracking, and per-shot confidence auditing.
 */
export function alignShotsCanonical(
  shots: Shot[],
  transcriptWords: TranscriptWord[],
  log: (msg: string, isError?: boolean) => void,
  totalAudioDuration: number,
  options: {
    resyncWindow?: number;
    matchThreshold?: number;
    silences?: Silence[];
    timingSource?: 'deepgram' | 'forced_alignment' | 'synthetic' | 'manual';
  } = {},
): CanonicalShotRange[] {
  if (!shots?.length) return [];

  // Fail-closed handling when no transcript words exist
  if (!transcriptWords?.length) {
    log("🛑 No transcript words available: cannot produce authoritative audio-locked alignment. Alignment marked as fallback; audio-locked export is blocked until valid transcription is provided.", true);
    const step = totalAudioDuration / shots.length;
    return shots.map((s, i) => {
      const startTime = i * step;
      const endTime = i === shots.length - 1 ? totalAudioDuration : (i + 1) * step;
      return {
        shotIndex: i,
        shotId: s.id,
        startWordIndex: -1,
        endWordIndex: -1,
        startTime,
        endTime,
        duration: Math.max(0.05, endTime - startTime),
        alignmentConfidence: 0.0,
        matchedWordCount: 0,
        totalShotTokens: 0,
        status: 'fallback' as const,
        timingSource: 'synthetic' as const,
      };
    });
  }

  // Build filtered token stream + map back to original transcript word indices
  const transTokens: string[] = [];
  const transIdxMap: number[] = [];

  transcriptWords.forEach((w, idx) => {
    const tokens = normTokens(w.word);
    for (const token of tokens) {
      transTokens.push(token);
      transIdxMap.push(idx);
    }
  });

  if (transTokens.length === 0) {
    log("🛑 Transcript contains no usable tokens after normalization: cannot produce authoritative alignment (export blocked).", true);
    const step = totalAudioDuration / shots.length;
    return shots.map((s, i) => {
      const startTime = i * step;
      const endTime = i === shots.length - 1 ? totalAudioDuration : (i + 1) * step;
      return {
        shotIndex: i,
        shotId: s.id,
        startWordIndex: -1,
        endWordIndex: -1,
        startTime,
        endTime,
        duration: Math.max(0.05, endTime - startTime),
        alignmentConfidence: 0.0,
        matchedWordCount: 0,
        totalShotTokens: 0,
        status: 'fallback' as const,
        timingSource: 'synthetic' as const,
      };
    });
  }

  // Tokenize each shot and calculate cumulative tokens
  const shotTokensList: string[][] = shots.map((shot) =>
    normTokens(
      shot.narration ||
      shot.text_reference ||
      shot.line_text ||
      shot.script ||
      shot.dialogue ||
      shot.prompt_source_text ||
      (shot as any).text ||
      shot.image_prompt ||
      ""
    )
  );

  const cumulativeTokens: number[] = [0];
  let totalShotTokens = 0;
  for (const st of shotTokensList) {
    totalShotTokens += st.length;
    cumulativeTokens.push(totalShotTokens);
  }

  // PASS 1: Identify High-Confidence Anchors (score >= ALIGNMENT_THRESHOLDS.ACCEPT = 0.78)
  // High-confidence anchors act as rigid, immutable waypoints.
  interface Anchor {
    shotIndex: number;
    startTokenIdx: number;
    endTokenIdx: number;
    confidence: number;
  }

  const rawAnchors: Anchor[] = [];
  const searchSpan = Math.max(150, Math.floor((transTokens.length / Math.max(1, shots.length)) * 3.0));

  for (let i = 0; i < shots.length; i++) {
    const tokens = shotTokensList[i];
    if (tokens.length < 2) continue; // Single words or empty shots cannot form unique anchors

    const expectedRatio = totalShotTokens > 0 ? cumulativeTokens[i] / totalShotTokens : i / shots.length;
    const center = Math.floor(expectedRatio * transTokens.length);
    const windowStart = Math.max(0, center - searchSpan);
    const windowEnd = Math.min(transTokens.length, center + searchSpan);

    let bestScore = -1;
    let bestStart = -1;
    let bestEnd = -1;

    for (let t = windowStart; t < windowEnd; t++) {
      const res = scoreMatchWithEnd(tokens, transTokens, t, tokens.length * 2 + 10);
      if (res.score > bestScore) {
        bestScore = res.score;
        bestStart = res.firstMatchIdx;
        bestEnd = res.endIdx;
      }
      if (res.score >= 0.95) break;
    }

    if (bestScore >= ALIGNMENT_THRESHOLDS.ACCEPT) {
      rawAnchors.push({
        shotIndex: i,
        startTokenIdx: bestStart,
        endTokenIdx: bestEnd,
        confidence: bestScore,
      });
    }
  }

  // Filter anchors greedily to guarantee strict monotonicity (increasing shotIndex AND token position)
  const monotonicAnchors: Anchor[] = [];
  let lastAnchorEnd = -1;
  let lastAnchorShot = -1;
  for (const anc of rawAnchors) {
    if (anc.shotIndex > lastAnchorShot && anc.startTokenIdx >= lastAnchorEnd) {
      monotonicAnchors.push(anc);
      lastAnchorShot = anc.shotIndex;
      lastAnchorEnd = anc.endTokenIdx;
    }
  }

  const anchorMap = new Map<number, Anchor>();
  monotonicAnchors.forEach((a) => anchorMap.set(a.shotIndex, a));

  log(`⚓ Detected ${monotonicAnchors.length}/${shots.length} authoritative monotonic anchors (confidence >= 78%).`);

  // PASS 2: Bounded Island Alignment
  // The timeline is split into bounded segments between anchors.
  // Intermediate shots CANNOT search outside their bounded island, completely preventing cursor poisoning.
  interface ShotRangeResult {
    startWordIdx: number;
    endWordIdx: number;
    startTime: number;
    confidence: number;
    textMatchConfidence: number;
    timingReliability: number;
    timingProvenance: 'acoustic_word' | 'acoustic_island_bounded' | 'silence_snapped' | 'synthetic_fallback' | 'manual';
    matchedTokens: number;
    totalTokens: number;
    status: 'high_confidence' | 'acceptable' | 'low_confidence' | 'fallback' | 'island_bounded';
  }

  const shotResults: ShotRangeResult[] = new Array(shots.length);

  // Helper to resolve an island of shots between anchorA and anchorB
  const anchorIndices = [-1, ...monotonicAnchors.map((a) => a.shotIndex), shots.length];

  for (let aIdx = 0; aIdx < anchorIndices.length - 1; aIdx++) {
    const leftShotIdx = anchorIndices[aIdx];
    const rightShotIdx = anchorIndices[aIdx + 1];

    const leftAnchor = leftShotIdx >= 0 ? anchorMap.get(leftShotIdx) : null;
    const rightAnchor = rightShotIdx < shots.length ? anchorMap.get(rightShotIdx) : null;

    // Record left anchor if it exists
    if (leftAnchor && !shotResults[leftShotIdx]) {
      const realStart = transIdxMap[leftAnchor.startTokenIdx] ?? 0;
      const realEnd = transIdxMap[Math.min(leftAnchor.endTokenIdx, transIdxMap.length - 1)] ?? realStart;
      const startTime = transcriptWords[realStart]?.start ?? 0;
      shotResults[leftShotIdx] = {
        startWordIdx: realStart,
        endWordIdx: Math.max(realStart, realEnd),
        startTime,
        confidence: leftAnchor.confidence,
        textMatchConfidence: leftAnchor.confidence,
        timingReliability: 0.98,
        timingProvenance: 'acoustic_word',
        matchedTokens: Math.round(leftAnchor.confidence * shotTokensList[leftShotIdx].length),
        totalTokens: shotTokensList[leftShotIdx].length,
        status: 'high_confidence',
      };
    }

    // Interval of intermediate shots strictly between leftShotIdx and rightShotIdx
    const intermediateStart = leftShotIdx + 1;
    const intermediateEnd = rightShotIdx - 1;
    if (intermediateStart > intermediateEnd) continue;

    // Strict token bounds for this island
    const islandTokenStart = leftAnchor ? leftAnchor.endTokenIdx : 0;
    const islandTokenEnd = rightAnchor ? rightAnchor.startTokenIdx : transTokens.length;

    // Measured acoustic bounds of this island
    const leftAnchorTime = leftAnchor && transIdxMap[leftAnchor.endTokenIdx] !== undefined
      ? (transcriptWords[transIdxMap[leftAnchor.endTokenIdx]]?.end ?? 0)
      : (transcriptWords[0]?.start ?? 0);
    const rightAnchorTime = rightAnchor && transIdxMap[rightAnchor.startTokenIdx] !== undefined
      ? (transcriptWords[transIdxMap[rightAnchor.startTokenIdx]]?.start ?? totalAudioDuration)
      : totalAudioDuration;
    const islandAcousticDuration = Math.max(0, rightAnchorTime - leftAnchorTime);
    const intermediateCount = intermediateEnd - intermediateStart + 1;
    const expectedSlotDuration = intermediateCount > 0 ? islandAcousticDuration / intermediateCount : 0;
    const wordsInIsland = Math.max(0, islandTokenEnd - islandTokenStart);

    // Calculate per-shot and total expected spoken duration for all intermediate shots in this island
    const slotExpectedDurations: number[] = [];
    let totalIslandExpectedDuration = 0;
    for (let is = intermediateStart; is <= intermediateEnd; is++) {
      const tokCount = shotTokensList[is]?.length || 4;
      const expDur = Math.max(1.0, tokCount * 0.38);
      slotExpectedDurations.push(expDur);
      totalIslandExpectedDuration += expDur;
    }
    const islandPacingRatio =
      totalIslandExpectedDuration > 0 ? islandAcousticDuration / totalIslandExpectedDuration : 1.0;
    const isPacingNatural = islandPacingRatio >= 0.55 && islandPacingRatio <= 1.85;

    let islandCursor = islandTokenStart;
    let cumulativeExpectedBeforeSlot = 0;

    for (let s = intermediateStart; s <= intermediateEnd; s++) {
      const tokens = shotTokensList[s];
      const slotOffset = s - intermediateStart;
      // Weight fallback start time by spoken token length rather than uniform division
      const weightedFraction =
        totalIslandExpectedDuration > 0
          ? cumulativeExpectedBeforeSlot / totalIslandExpectedDuration
          : slotOffset / Math.max(1, intermediateCount);
      const proportionStart = leftAnchorTime + weightedFraction * islandAcousticDuration;
      cumulativeExpectedBeforeSlot += slotExpectedDurations[slotOffset] || 1.5;

      const hasLeftAnchor = Boolean(leftAnchor && leftAnchor.confidence >= ALIGNMENT_THRESHOLDS.ACCEPT);
      const hasRightAnchor = Boolean(rightAnchor && rightAnchor.confidence >= ALIGNMENT_THRESHOLDS.ACCEPT);
      const isBothAnchored = hasLeftAnchor && hasRightAnchor;
      const isSingleAnchored = hasLeftAnchor || hasRightAnchor;

      let measuredReliability = 0.2;
      if (isBothAnchored) {
        const avgAnchorConf = ((leftAnchor?.confidence ?? 0.8) + (rightAnchor?.confidence ?? 0.8)) / 2;
        const topologyWeight = intermediateCount === 1 ? 0.78 : intermediateCount === 2 ? 0.68 : 0.58;
        measuredReliability = topologyWeight * Math.min(1.0, avgAnchorConf);

        if (isPacingNatural && expectedSlotDuration >= 0.8 && expectedSlotDuration <= 18.0) {
          measuredReliability += 0.08;
        } else if (expectedSlotDuration < 0.4 || islandPacingRatio < 0.35) {
          measuredReliability -= 0.18;
        }

        if (wordsInIsland >= intermediateCount) {
          measuredReliability += 0.06;
        }
      } else if (isSingleAnchored) {
        const anchorConf = leftAnchor?.confidence ?? rightAnchor?.confidence ?? 0.7;
        measuredReliability = 0.48 * Math.min(1.0, anchorConf);
        if (expectedSlotDuration >= 0.8 && expectedSlotDuration <= 15.0) {
          measuredReliability += 0.05;
        }
      }

      measuredReliability = Math.max(0.15, Math.min(0.88, Number(measuredReliability.toFixed(2))));

      if (tokens.length === 0 || islandCursor >= islandTokenEnd) {
        shotResults[s] = {
          startWordIdx: -1,
          endWordIdx: -1,
          startTime: proportionStart,
          confidence: 0.1,
          textMatchConfidence: 0.1,
          timingReliability: measuredReliability,
          timingProvenance: isSingleAnchored ? 'acoustic_island_bounded' : 'synthetic_fallback',
          matchedTokens: 0,
          totalTokens: tokens.length,
          status: measuredReliability >= ALIGNMENT_THRESHOLDS.BLOCK ? 'island_bounded' : 'fallback',
        };
        continue;
      }

      let bestScore = -1;
      let bestStart = islandCursor;
      let bestEnd = islandCursor + tokens.length;

      for (let t = islandCursor; t < islandTokenEnd; t++) {
        const res = scoreMatchWithEnd(tokens, transTokens, t, tokens.length * 2 + 10);
        const dist = res.firstMatchIdx - islandCursor;
        const distPenalty = (dist / Math.max(1, islandTokenEnd - islandCursor)) * 0.3;
        const netScore = res.score - distPenalty;
        if (netScore > bestScore) {
          bestScore = netScore;
          bestStart = res.firstMatchIdx;
          bestEnd = res.endIdx;
        }
        if (res.score >= 0.88) break;
      }

      if (bestScore >= ALIGNMENT_THRESHOLDS.ACCEPT) {
        const realStart = transIdxMap[bestStart] ?? 0;
        const realEnd = transIdxMap[Math.min(bestEnd, transIdxMap.length - 1)] ?? realStart;
        shotResults[s] = {
          startWordIdx: realStart,
          endWordIdx: Math.max(realStart, realEnd),
          startTime: transcriptWords[realStart]?.start ?? proportionStart,
          confidence: bestScore,
          textMatchConfidence: bestScore,
          timingReliability: 0.95,
          timingProvenance: 'acoustic_word',
          matchedTokens: Math.round(bestScore * tokens.length),
          totalTokens: tokens.length,
          status: 'high_confidence',
        };
        islandCursor = Math.min(islandTokenEnd, bestEnd);
      } else if (bestScore >= ALIGNMENT_THRESHOLDS.WARN) {
        const realStart = transIdxMap[bestStart] ?? 0;
        const realEnd = transIdxMap[Math.min(bestEnd, transIdxMap.length - 1)] ?? realStart;
        shotResults[s] = {
          startWordIdx: realStart,
          endWordIdx: Math.max(realStart, realEnd),
          startTime: transcriptWords[realStart]?.start ?? proportionStart,
          confidence: bestScore,
          textMatchConfidence: bestScore,
          timingReliability: 0.9,
          timingProvenance: 'acoustic_word',
          matchedTokens: Math.round(bestScore * tokens.length),
          totalTokens: tokens.length,
          status: 'acceptable',
        };
        islandCursor = Math.min(islandTokenEnd, bestEnd);
      } else {
        const rawConf = Math.max(0.1, Math.min(bestScore > 0 ? bestScore : 0.2, ALIGNMENT_THRESHOLDS.WARN - 0.01));
        const status = measuredReliability >= ALIGNMENT_THRESHOLDS.BLOCK ? 'island_bounded' : 'fallback';

        shotResults[s] = {
          startWordIdx: -1,
          endWordIdx: -1,
          startTime: proportionStart,
          confidence: rawConf,
          textMatchConfidence: rawConf,
          timingReliability: measuredReliability,
          timingProvenance: isSingleAnchored ? 'acoustic_island_bounded' : 'synthetic_fallback',
          matchedTokens: 0,
          totalTokens: tokens.length,
          status,
        };
      }
    }
  }

  // Handle rightmost anchor for the last shot if needed
  const lastAnchor = anchorMap.get(shots.length - 1);
  if (lastAnchor && !shotResults[shots.length - 1]) {
    const realStart = transIdxMap[lastAnchor.startTokenIdx] ?? 0;
    const realEnd = transIdxMap[Math.min(lastAnchor.endTokenIdx, transIdxMap.length - 1)] ?? realStart;
    shotResults[shots.length - 1] = {
      startWordIdx: realStart,
      endWordIdx: Math.max(realStart, realEnd),
      startTime: transcriptWords[realStart]?.start ?? 0,
      confidence: lastAnchor.confidence,
      textMatchConfidence: lastAnchor.confidence,
      timingReliability: 0.98,
      timingProvenance: 'acoustic_word',
      matchedTokens: Math.round(lastAnchor.confidence * shotTokensList[shots.length - 1].length),
      totalTokens: shotTokensList[shots.length - 1].length,
      status: 'high_confidence',
    };
  }

  // Editorial Breath Lead-In (Micro J-Cut) & Silence Boundary Snapping:
  // Human editors cut ~80-110ms BEFORE the first phoneme of a new sentence (inside the breath pause)
  // so the viewer's eye registers the new visual right as the voice begins.
  const MIN_GAP = 0.05;
  const silences = options.silences || [];
  for (let i = 1; i < shots.length; i++) {
    const cur = shotResults[i];
    if (!cur || cur.status === 'fallback') continue;
    const prevStart = shotResults[i - 1]?.startTime ?? 0;

    if (cur.startWordIdx > 0) {
      const firstWordStart = transcriptWords[cur.startWordIdx]?.start ?? cur.startTime;
      const prevWordEnd = transcriptWords[cur.startWordIdx - 1]?.end ?? firstWordStart;
      const pauseGap = firstWordStart - prevWordEnd;
      if (pauseGap >= 0.06) {
        // Place the cut in the breath pause (~90ms before word onset, never clipping the previous word)
        const leadIn = Math.min(0.10, pauseGap * 0.45);
        const breathCut = Math.max(prevWordEnd + 0.02, firstWordStart - leadIn);
        if (breathCut > prevStart + MIN_GAP) {
          cur.startTime = breathCut;
        }
      }
    }

    if (silences.length > 0) {
      const snap = utils.getNearestSilenceBoundary(cur.startTime, silences, 0.16);
      if (snap !== null) {
        const candidate = Math.max(snap, prevStart + MIN_GAP);
        if (Math.abs(candidate - cur.startTime) <= 0.16) {
          cur.startTime = candidate;
          if (cur.timingProvenance === 'acoustic_island_bounded') {
            cur.timingProvenance = 'silence_snapped';
            cur.timingReliability = Math.max(cur.timingReliability, 0.92);
          }
        }
      }
    }
  }

  // Enforce contiguous monotonic timeline starts
  const rawStarts = shotResults.map((r) => r?.startTime ?? 0);
  const monotonicStarts = enforceMonotonicStarts(
    rawStarts,
    MIN_GAP,
    Math.max(0, totalAudioDuration - MIN_GAP)
  );

  // Construct CanonicalShotRange array where duration = endTime - startTime
  const canonicalRanges: CanonicalShotRange[] = [];
  for (let i = 0; i < shots.length; i++) {
    const start = monotonicStarts[i];
    const nextStart = i + 1 < shots.length ? monotonicStarts[i + 1] : totalAudioDuration;
    const end = Math.min(totalAudioDuration, Math.max(start + MIN_GAP, nextStart));
    const range = shotResults[i];

    const isUnresolved = (range?.startWordIdx === -1 || range?.startWordIdx === undefined);
    const startWord = isUnresolved ? -1 : range.startWordIdx;
    const endWord = isUnresolved ? -1 : Math.max(startWord, range.endWordIdx ?? startWord);
    const matchedWordCount = isUnresolved ? 0 : Math.max(1, endWord - startWord + 1);

    const textConf = range?.textMatchConfidence ?? range?.confidence ?? 0.0;
    const timingRel = range?.timingReliability ?? (range?.status === 'fallback' ? 0.2 : 0.85);
    const provenance = range?.timingProvenance ?? (range?.status === 'fallback' ? 'synthetic_fallback' : 'acoustic_word');

    const activeTimingSource: 'deepgram' | 'forced_alignment' | 'synthetic' | 'manual' =
      (range?.status === 'fallback' && timingRel < ALIGNMENT_THRESHOLDS.BLOCK)
        ? 'synthetic'
        : (options.timingSource || 'deepgram');

    canonicalRanges.push({
      shotIndex: i,
      shotId: shots[i].id,
      startWordIndex: startWord,
      endWordIndex: endWord,
      startTime: start,
      endTime: end,
      duration: end - start,
      alignmentConfidence: textConf,
      textMatchConfidence: textConf,
      timingReliability: timingRel,
      timingProvenance: provenance,
      matchedWordCount,
      totalShotTokens: range?.totalTokens ?? 0,
      status: range?.status ?? 'fallback',
      timingSource: activeTimingSource,
    });
  }

  // Output Real Alignment Audit in production log
  log(`📊 Alignment Audit (${canonicalRanges.length} Shots against Audio Track):`);
  canonicalRanges.forEach((cr, idx) => {
    const shotNum = String(idx + 1).padStart(2, '0');
    const startSec = cr.startTime.toFixed(3);
    const endSec = cr.endTime.toFixed(3);
    const durSec = cr.duration.toFixed(2);
    const textPct = Math.round((cr.textMatchConfidence ?? cr.alignmentConfidence) * 100);
    const timeRelPct = Math.round((cr.timingReliability ?? 1.0) * 100);
    const isOutlier = textPct < 50 && timeRelPct >= 75;
    const note = isOutlier
      ? ` ℹ️ (Script mismatch ${textPct}%, verified acoustic timing ${timeRelPct}% [${cr.timingProvenance}])`
      : (textPct < 50 ? ' ⚠️ (Low Confidence)' : '');
    const wordsDesc = cr.startWordIndex >= 0 ? `words ${cr.startWordIndex}–${cr.endWordIndex}` : 'words: unresolved (text mismatch)';
    log(
      `SHOT ${shotNum}: ${startSec}s → ${endSec}s (${durSec}s) | ${wordsDesc} | source: ${cr.timingSource} | text: ${textPct}% | timing: ${timeRelPct}%${note}`,
      textPct < 50 && timeRelPct < 50
    );
  });

  return canonicalRanges;
}

/**
 * Storyboard-locked alignment with drift prevention and silence snapping.
 * Returns array of shot start times, backed by canonical alignment.
 */
export function alignShotsToTranscript(
  shots: Shot[],
  transcriptWords: TranscriptWord[],
  log: (msg: string, isError?: boolean) => void,
  totalAudioDuration: number,
  options: {
    resyncWindow?: number;
    matchThreshold?: number;
    silences?: Silence[];
  } = {},
): number[] {
  const ranges = alignShotsCanonical(shots, transcriptWords, log, totalAudioDuration, options);
  return ranges.map((r) => r.startTime);
}

/**
 * Comprehensive Timeline Consistency & Synchronization Audit.
 * Verifies timeline coverage, gaps, overlaps, word alignment confidence, and drift before export.
 */
export function auditTimelineConsistency(
  clips: any[] = timelineState.clips,
  audioBuffer: AudioBuffer | null = timelineState.masterAudioBuffer,
  globalWords: TranscriptWord[] | null = timelineState.globalWordTimestamps as any,
): TimelineConsistencyReport {
  const isAudioLocked = timelineState.mode === 'audio_locked';
  const audioDuration = audioBuffer ? audioBuffer.duration : (clips?.length ? clips[clips.length - 1].endTime : 0);

  if (!clips || clips.length === 0) {
    return {
      audioDuration,
      firstClipStart: 0,
      lastClipEnd: 0,
      totalClipCoverage: 0,
      gaps: [],
      overlaps: [],
      totalWords: globalWords?.length || 0,
      matchedWords: 0,
      unmatchedWords: globalWords?.length || 0,
      shotAudits: [],
      driftSeconds: 0,
      syncHealthPercent: 100,
      isAudioLocked,
      formattedText: 'Timeline is empty.',
    };
  }

  const sorted = [...clips].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  const firstClipStart = sorted[0]?.startTime ?? 0;
  const lastClipEnd = sorted[sorted.length - 1]?.endTime ?? 0;
  const totalClipCoverage = sorted.reduce((sum, c) => sum + (c.duration || (c.endTime - c.startTime)), 0);

  const gaps: { index: number; start: number; end: number; gapSeconds: number }[] = [];
  const overlaps: { index: number; clipAEnd: number; clipBStart: number; overlapSeconds: number }[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const curEnd = cur.endTime;
    const nextStart = next.startTime;
    const diff = nextStart - curEnd;

    if (diff > 0.01) {
      gaps.push({ index: i, start: curEnd, end: nextStart, gapSeconds: diff });
    } else if (diff < -0.01) {
      overlaps.push({ index: i, clipAEnd: curEnd, clipBStart: nextStart, overlapSeconds: Math.abs(diff) });
    }
  }

  const totalWords = globalWords?.length || 0;
  let matchedWords = 0;
  const shotAudits: TimelineConsistencyReport['shotAudits'] = [];

  sorted.forEach((clip, idx) => {
    const shotNumber = idx + 1;
    const start = clip.startTime ?? 0;
    const end = clip.endTime ?? start + (clip.duration ?? 0);
    const dur = end - start;

    let shotWordsCount = 0;
    let startIdx = -1;
    let endIdx = -1;

    if (globalWords && globalWords.length > 0) {
      globalWords.forEach((w, wIdx) => {
        if (w.start >= start - 0.05 && w.end <= end + 0.05) {
          if (startIdx === -1) startIdx = wIdx;
          endIdx = wIdx;
          shotWordsCount++;
        }
      });
    }

    matchedWords += shotWordsCount;
    const textConf = typeof clip.textMatchConfidence === 'number'
      ? clip.textMatchConfidence
      : (typeof clip.alignmentConfidence === 'number' ? clip.alignmentConfidence : (shotWordsCount > 0 ? 0.95 : 0.65));
    const timingRel = typeof clip.timingReliability === 'number'
      ? clip.timingReliability
      : (clip.timingSource === 'synthetic' || clip.timingSource === 'fallback' ? 0.2 : 0.95);
    const confidencePercent = Math.round(textConf * 100);
    const timingReliabilityPercent = Math.round(timingRel * 100);
    const isOutlier = confidencePercent < 50 && timingReliabilityPercent >= 75;
    const isCritical = confidencePercent < 50 && timingReliabilityPercent < 50;

    let warningMsg: string | undefined;
    if (isCritical) {
      warningMsg = 'Low script match and unverified cut timing — check script narration match';
    } else if (isOutlier) {
      warningMsg = `Script text differs from speech (${confidencePercent}%), but cut timing is verified by acoustic anchors (${timingReliabilityPercent}%)`;
    }

    shotAudits.push({
      shotNumber,
      shotId: clip.id || `shot_${shotNumber}`,
      startTime: start,
      endTime: end,
      duration: dur,
      startWordIndex: startIdx,
      endWordIndex: endIdx,
      matchedWordsCount: shotWordsCount,
      confidencePercent,
      timingReliabilityPercent,
      timingProvenance: clip.timingProvenance || (timingRel >= 0.75 ? 'acoustic_verified' : 'unverified'),
      isWarning: isCritical || isOutlier,
      isOutlier,
      warningMsg,
    });
  });

  const unmatchedWords = Math.max(0, totalWords - matchedWords);
  const driftSeconds = audioBuffer ? Math.abs(lastClipEnd - audioDuration) : 0;
  const syncHealth = Math.max(0, Math.min(100, (1 - (driftSeconds / Math.max(1, audioDuration))) * 100));

  let formattedReport = `====================================================\n`;
  formattedReport += `🎬 TIMELINE CONSISTENCY & SYNCHRONIZATION REPORT\n`;
  formattedReport += `====================================================\n`;
  formattedReport += `Audio Duration:        ${audioDuration.toFixed(3)}s\n`;
  formattedReport += `First Clip Start:      ${firstClipStart.toFixed(3)}s\n`;
  formattedReport += `Last Clip End:         ${lastClipEnd.toFixed(3)}s\n`;
  formattedReport += `Total Visual Coverage: ${totalClipCoverage.toFixed(3)}s\n`;
  formattedReport += `Timeline Mode:         ${isAudioLocked ? 'Audio-Locked' : 'Free Edit'}\n`;
  formattedReport += `Gaps Detected:         ${gaps.length}${gaps.length > 0 ? ` (total gap time: ${gaps.reduce((a, b) => a + b.gapSeconds, 0).toFixed(2)}s)` : ' (None - Continuous)'}\n`;
  formattedReport += `Overlaps Detected:     ${overlaps.length}${overlaps.length > 0 ? ` (total overlap: ${overlaps.reduce((a, b) => a + b.overlapSeconds, 0).toFixed(2)}s)` : ' (None)'}\n`;
  formattedReport += `Total Transcript Words:${totalWords}\n`;
  formattedReport += `Matched Words:         ${matchedWords}\n`;
  formattedReport += `Unmatched Words:       ${unmatchedWords}\n`;
  formattedReport += `Drift Assessment:      ${driftSeconds < 0.05 ? '0ms Drift (Perfect Sync)' : `${(driftSeconds * 1000).toFixed(0)}ms Drift`}\n`;
  formattedReport += `Sync Health Score:     ${syncHealth.toFixed(1)}%\n\n`;
  formattedReport += `--- Per-Shot Alignment Confidence & Timing Reliability ---\n`;
  shotAudits.forEach(sa => {
    let tag = '';
    if (sa.isWarning && !sa.isOutlier) tag = ' ⚠️';
    else if (sa.isOutlier) tag = ' ℹ️ (Verified timing anchor)';
    formattedReport += `Shot ${String(sa.shotNumber).padStart(2, '0')}: ${sa.startTime.toFixed(3)}s → ${sa.endTime.toFixed(3)}s (${sa.duration.toFixed(2)}s) | Words ${sa.startWordIndex >= 0 ? `${sa.startWordIndex}–${sa.endWordIndex}` : 'None'} (${sa.matchedWordsCount} words) | Script Match: ${sa.confidencePercent}% | Timing Rel: ${sa.timingReliabilityPercent ?? 100}%${tag}\n`;
  });
  formattedReport += `====================================================`;

  return {
    audioDuration,
    firstClipStart,
    lastClipEnd,
    totalClipCoverage,
    gaps,
    overlaps,
    totalWords,
    matchedWords,
    unmatchedWords,
    shotAudits,
    driftSeconds,
    syncHealthPercent: syncHealth,
    isAudioLocked,
    formattedText: formattedReport,
  };
}

/**
 * Slices a global word transcript into shot-relative chunks using a performant linear scan.
 */
export function sliceTranscriptForShots(
  shotStartTimes: number[],
  transcriptWords: TranscriptWord[],
  totalDur: number,
) {
  const perShot: TranscriptWord[][] = new Array(shotStartTimes.length)
    .fill(null)
    .map(() => []);
  if (!transcriptWords?.length) return perShot;

  let w = 0;

  for (let i = 0; i < shotStartTimes.length; i++) {
    const start = shotStartTimes[i];
    const end =
      i + 1 < shotStartTimes.length ? shotStartTimes[i + 1] : totalDur;
    const clipDuration = Math.max(0.001, end - start);

    while (w < transcriptWords.length && transcriptWords[w].end < start - 0.02 && transcriptWords[w].start < start) w++;

    let k = w;
    while (k < transcriptWords.length && transcriptWords[k].start < end) {
      const word = transcriptWords[k];
      perShot[i].push({
        word: word.word,
        start: Math.max(0, word.start - start),
        // Do NOT clamp to clipDuration: the word continues into the next shot.
        // Clamping is what produced the "subtitle cuts off while audio continues" effect.
        end: Math.max(0.05, word.end - start),
      });
      k++;
    }
  }

  return perShot;
}

function buildSnapPoints(): number[] {
  const pts: number[] = [];

  for (const w of (timelineState.globalWordTimestamps as
    TranscriptWord[] | null) || [])
    pts.push(w.start, w.end);
  for (const s of (timelineState.globalSilences as Silence[] | null) || [])
    pts.push(s.start + 0.05, s.end - 0.05);
  for (const c of timelineState.clips || []) pts.push(c.startTime, c.endTime);

  return Array.from(new Set(pts))
    .filter((n) => Number.isFinite(n))
    .filter((n) => n >= 0)
    .sort((a, b) => a - b);
}

/**
 * Handle Visual-First Production Pipeline.
 */
export async function handleAnalyzePacing() {
  // Reset AI Director button states
  dom.magicCameraBtn.className = "bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate";
  dom.magicCameraBtn.innerHTML = "<span>🤖 Magic Camera</span>";

  dom.analyzeTransitionsBtn.classList.remove(
    "bg-green-600",
    "hover:bg-green-700",
  );
  dom.analyzeTransitionsBtn.classList.add("bg-gray-700", "hover:bg-gray-600");
  dom.analyzeTransitionsBtn.innerHTML = "<span>✨</span> Analyze Transitions";

  const runId = bumpRunId();

  const shotsWithMetadata = state.currentScenes.flatMap((scene, sIdx) =>
    (scene.lines || [scene]).map((line: any, lIdx: number) => {
      const existingClip = timelineState.clips?.find((c) => c.id === line.id);
      return {
        ...line,
        __sceneIndex: sIdx,
        __lineIndex: lIdx,
        _videoObjectURL: line._videoObjectURL || existingClip?._videoObjectURL,
        video_id: line.video_id || existingClip?.video_id,
        _imageObjectURL: line._imageObjectURL || existingClip?._imageObjectURL,
        image_id: line.image_id || existingClip?.image_id,
      };
    }),
  );

  const shots: Shot[] = shotsWithMetadata.filter(
    (s: any) =>
      !!(s._imageObjectURL || s._videoObjectURL || s.image_id || s.video_id || s.talkingHeadMode === 'full' || s.talkingHeadMode === 'split' || s.talkingHeadMode === 'pip-br' || s.talkingHeadMode === 'pip-bl' || s.talkingHeadMode === 'pip-tr' || s.talkingHeadMode === 'pip-tl'),
  );
  if (shots.length === 0) {
    ui.showStatus("No generated storyboard media found.", true, 4000);
    return;
  }

  const script = shots
    .map((s) =>
      (s.text_reference || s.line_text || "").replace(/<[^>]+>/g, " ").trim(),
    )
    .join(" ")
    .trim();

  const logEl = dom.videoStatusLog;
  state.isVideoProductionRunning = true;
  const startTime = performance.now();
  ui.setButtonsDisabled(true);
  await ui.openProcessingModal("Production Pipeline", true, "Stop Processing");
  ui.updateProcessingProgress(1, "Initializing production pipeline..."); // Show immediate progress

  const addLog = (msg: string, isErr = false) => {
    ui.logProductionStatus(msg, isErr);
  };

  try {
    assertStillRunning(runId);

    let shotStartTimes: number[] = [];
    let canonicalRanges: CanonicalShotRange[] = [];
    let totalDur = 0;
    let perShotWords: TranscriptWord[][] = [];

    if (dom.visualFirstAudioToggle.checked) {
      addLog("🎙️ Generating Narration...");
      const onNarrationProgress = (progress: number, message: string) => {
        // This step is ~60% of the total time.
        ui.updateProcessingProgress(Math.max(1, progress * 0.6), message);
      };
      const { masterBuffer, fullTranscript, assetId } =
        await generateMasterNarration(script, addLog, onNarrationProgress);
      assertStillRunning(runId);
      if (!masterBuffer) throw new Error("Audio generation failed.");

      timelineState.setMasterAudioBuffer(masterBuffer);
      timelineState.setMasterAudioAssetId(assetId || null);
      if (assetId) state.uploadedAudioAssetId = assetId;
      const actualAudioDuration = masterBuffer.duration;
      totalDur = actualAudioDuration;

      addLog("🔍 Analyzing audio cadence...");
      const silences = utils.detectSilences(masterBuffer) as Silence[];
      timelineState.setGlobalSilences(silences);

      const { counts, total: totalWords } = utils.computeWordCounts(shots);

      let timingSourceProvenance: 'deepgram' | 'forced_alignment' | 'synthetic' = 'deepgram';

      if (!fullTranscript || fullTranscript.length === 0) {
        addLog(
          "⚠️ Word timestamps missing from narration. Attempting acoustic forced alignment...",
          true,
        );
        try {
          const wavBlob = audioBufferToWavBlob(masterBuffer);
          const audioFile = new File([wavBlob], "master_narration.wav", { type: "audio/wav" });
          const fullScriptText = Array.isArray(script)
            ? (script as Array<{ text: string }>).map((s: any) => s.text || '').join(' ').trim()
            : String(script || '').trim();
          const fallbackTranscript = await forceAlignAudio(audioFile, fullScriptText, (p, m) => onNarrationProgress(60 + (p * 0.3), m));
          assertStillRunning(runId);
          if (!fallbackTranscript || fallbackTranscript.length === 0) throw new Error("Acoustic forced alignment returned empty.");
          timelineState.setGlobalWordTimestamps(fallbackTranscript);
          timingSourceProvenance = 'forced_alignment';
          addLog(`✅ Acoustic forced alignment succeeded (${fallbackTranscript.length} words).`);
        } catch (alignErr: any) {
          addLog(`🛑 Audio word alignment failed: ${alignErr.message}`, true);
          timelineState.setGlobalWordTimestamps([]);
          timingSourceProvenance = 'synthetic';
          if (timelineState.mode === 'audio_locked' || dom.visualFirstAudioToggle.checked) {
            throw new Error('Audio-locked timeline cannot be created because reliable word timestamps are unavailable.');
          }
        }
      } else {
        timelineState.setGlobalWordTimestamps(
          fullTranscript as TranscriptWord[],
        );
        timingSourceProvenance = 'deepgram';
      }

      addLog("📝 Validating visual sync...");

      // Clamp all word timestamps to actual audio duration
      if (timelineState.globalWordTimestamps) {
        timelineState.setGlobalWordTimestamps(
          timelineState.globalWordTimestamps
            .map((w) => ({
              ...w,
              start: Math.min(w.start, actualAudioDuration),
              end: Math.min(w.end, actualAudioDuration),
            }))
            .filter((w) => w.start < actualAudioDuration),
        );
      }

      canonicalRanges = alignShotsCanonical(
        shots,
        timelineState.globalWordTimestamps!,
        addLog,
        actualAudioDuration,
        { silences, timingSource: timingSourceProvenance },
      );
      shotStartTimes = canonicalRanges.map((r) => r.startTime);

      perShotWords = sliceTranscriptForShots(
        shotStartTimes,
        timelineState.globalWordTimestamps!,
        actualAudioDuration,
      );

      // --- Sync Health Calculation & Consistency Audit ---
      const audit = auditTimelineConsistency(
        canonicalRanges.map((r, i) => ({
          id: shots[i]?.id,
          startTime: r.startTime,
          endTime: r.endTime,
          duration: r.duration,
          alignmentConfidence: r.alignmentConfidence,
        })),
        timelineState.masterAudioBuffer,
        timelineState.globalWordTimestamps,
      );
      const syncHealthPercent = audit.syncHealthPercent;
      let healthColor =
        syncHealthPercent >= 95
          ? "text-green-400"
          : syncHealthPercent >= 90
            ? "text-amber-400"
            : "text-red-400";
      addLog(
        `<span class="font-bold">Visual Sync Health:</span> <span class="${healthColor}">${(syncHealthPercent ?? 0).toFixed(1)}%</span> (${audit.driftSeconds < 0.05 ? '0ms drift, perfect sync' : `${(audit.driftSeconds * 1000).toFixed(0)}ms drift`})`,
      );

      state.lastProductionMetrics = {
        shotCount: shots.length,
        wordCount: script.split(/\s+/).filter((w) => w.length > 0).length,
        audioDuration: totalDur,
        productionTime: (performance.now() - startTime) / 1000,
        usedFastPath: true,
        syncIntegrity: audit.syncHealthPercent / 100,
      };
    } else {
      timelineState.setMasterAudioBuffer(null);
      timelineState.setMasterAudioAssetId(null);
      timelineState.setGlobalWordTimestamps(null);
      timelineState.setGlobalSilences(null);

      const { counts, total: totalWords } = utils.computeWordCounts(shots);
      let inputVal = parseFloat(
        dom.visualFirstDurationOverrideInput?.value || "0",
      );
      if (inputVal > 0) {
        const minutes = Math.floor(inputVal);
        const seconds = Math.round((inputVal - minutes) * 100);
        totalDur = minutes * 60 + seconds;
      } else {
        totalDur = (totalWords / 150) * 60;
      }
      if (totalDur <= 0) throw new Error("Total duration required.");

      let current = 0;
      shotStartTimes = shots.map((_, i) => {
        const s = current;
        current +=
          totalWords > 0
            ? (counts[i] / totalWords) * totalDur
            : totalDur / shots.length;
        return s;
      });

      shotStartTimes = enforceMonotonicStarts(
        shotStartTimes,
        0.05,
        Math.max(0, totalDur - 0.05),
      );
      perShotWords = shots.map(() => []);
    }

    const assemblingStartProgress = dom.visualFirstAudioToggle.checked
      ? 80
      : 10;
    ui.updateProcessingProgress(assemblingStartProgress, "Assembling clips...");
    assertStillRunning(runId);

    const newClips = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      // Check existing timeline clip or shot to ensure videos and assets are retained across rebuilds
      const existingClip = timelineState.clips?.find((c) => c.id === shot.id) || timelineState.clips?.[i];
      const videoUrl = shot._videoObjectURL || existingClip?._videoObjectURL;
      const videoId = (shot as any).video_id || existingClip?.video_id;
      const imageUrl = shot._imageObjectURL || existingClip?._imageObjectURL;
      const imageId = (shot as any).image_id || existingClip?.image_id;
      const videoStartOffset = (shot as any).videoStartOffset ?? existingClip?.videoStartOffset ?? ((!videoUrl && state.uploadedVideoElement) || (videoUrl && state.uploadedVideoElement && videoUrl === state.uploadedVideoElement.src) ? shotStartTimes[i] : 0);

      if (videoUrl && !shot._videoObjectURL) {
        shot._videoObjectURL = videoUrl;
        (shot as any).video_id = videoId;
      }
      if (imageUrl && !shot._imageObjectURL) {
        shot._imageObjectURL = imageUrl;
        (shot as any).image_id = imageId;
      }

      let videoEl: HTMLVideoElement | undefined = undefined;
      let img = null;
      try {
        if (videoUrl) {
          videoEl = existingClip?.videoElement || await utils.loadVideoElement(videoUrl);
          if (imageUrl) {
            try {
              img = existingClip?.image || await utils.loadImageOrThrow(imageUrl);
            } catch (imgErr) {
              console.warn("Failed to preload fallback image for shot:", imgErr);
            }
          }
        } else if (imageUrl) {
          img = existingClip?.image || await utils.loadImageOrThrow(imageUrl);
        }
      } catch (e) {
        console.error("Failed to load visual for clip", e);
        if (imageUrl) {
          try {
            img = existingClip?.image || await utils.loadImageOrThrow(imageUrl);
          } catch (imgErr) {
            console.warn("Failed to load fallback image for shot:", imgErr);
          }
        }
      }

      // Preload Documentary Corner Callout Overlay if present
      let overlayImg: HTMLImageElement | undefined = undefined;
      if ((shot as any).overlayImageUrl) {
        try {
          overlayImg = await utils.loadImageOrThrow((shot as any).overlayImageUrl);
        } catch (ovErr) {
          console.warn("Failed to load corner callout overlay for shot:", ovErr);
        }
      }

      assertStillRunning(runId);

      const startTime = shotStartTimes[i];
      const nextStartTime =
        i + 1 < shots.length ? shotStartTimes[i + 1] : totalDur;

      const endTime =
        i === shots.length - 1 && dom.visualFirstAudioToggle.checked
          ? totalDur
          : nextStartTime;

      const canonicalRange = canonicalRanges?.[i];

      newClips.push({
        id: shot.id || `s${shot.__sceneIndex}_l${shot.__lineIndex}`,
        image: img || undefined,
        videoElement: videoEl,
        _videoObjectURL: videoUrl,
        _imageObjectURL: imageUrl,
        image_id: imageId,
        video_id: videoId,
        videoStartOffset,
        talkingHeadMode: (shot as any).talkingHeadMode || existingClip?.talkingHeadMode,
        talkingHeadSize: (shot as any).talkingHeadSize || existingClip?.talkingHeadSize,
        useOriginalAudio: (shot as any).useOriginalAudio ?? existingClip?.useOriginalAudio,
        displayMode: (shot as any).displayMode || existingClip?.displayMode || 'fullscreen',
        pipPosition: (shot as any).pipPosition || existingClip?.pipPosition || 'top_right',
        pipX: (shot as any).pipX ?? existingClip?.pipX,
        pipY: (shot as any).pipY ?? existingClip?.pipY,
        pipAnchorX: (shot as any).pipAnchorX ?? existingClip?.pipAnchorX,
        pipAnchorY: (shot as any).pipAnchorY ?? existingClip?.pipAnchorY,
        pipAnimation: (shot as any).pipAnimation || existingClip?.pipAnimation || 'pop_spring',
        pipScale: (shot as any).pipScale ?? existingClip?.pipScale,
        overlayImage: overlayImg || existingClip?.overlayImage,
        overlayImageId: (shot as any).overlayImageId || existingClip?.overlayImageId,
        overlayImageUrl: (shot as any).overlayImageUrl || existingClip?.overlayImageUrl,
        overlayPosition: (shot as any).overlayPosition || existingClip?.overlayPosition || 'top-right',
        colorFilter: (shot as any).colorFilter || existingClip?.colorFilter || 'none',
        colorFilterIntensity: typeof (shot as any).colorFilterIntensity === 'number' ? (shot as any).colorFilterIntensity : (existingClip?.colorFilterIntensity ?? 1.0),
        duration: endTime - startTime,
        startTime,
        endTime,
        startWordIndex: canonicalRange?.startWordIndex ?? -1,
        endWordIndex: canonicalRange?.endWordIndex ?? -1,
        alignmentConfidence: canonicalRange?.alignmentConfidence,
        textMatchConfidence: canonicalRange?.textMatchConfidence ?? canonicalRange?.alignmentConfidence,
        timingReliability: canonicalRange?.timingReliability,
        timingProvenance: canonicalRange?.timingProvenance,
        timingSource: canonicalRange?.timingSource ?? (dom.visualFirstAudioToggle.checked ? 'deepgram' : 'synthetic'),
        cameraMovement: shot.camera_movement || existingClip?.cameraMovement || "static",
        focalPoint: shot.focalPoint || existingClip?.focalPoint,
        transitionToNext: existingClip?.transitionToNext || "cut",
        text: shot.text_reference || shot.line_text || existingClip?.text || "",
        wordTimestamps: perShotWords[i] || [],
        wordTimestampMode: 'relative',
        locked: false,
      });

      const progress =
        assemblingStartProgress +
        ((i + 1) / shots.length) * (95 - assemblingStartProgress);
      ui.updateProcessingProgress(
        progress,
        `Assembling clip ${i + 1}/${shots.length}...`,
      );
    }

    timelineState.setClips(newClips);

    if (dom.visualFirstAudioToggle.checked) {
      const lastShot = timelineState.clips[timelineState.clips.length - 1];
      if (lastShot && totalDur - lastShot.endTime > 2) {
        const gap = (totalDur ?? 0) - (lastShot?.endTime ?? 0);
        addLog(
          `⚠️ Warning: Last ${(gap ?? 0).toFixed(1)}s of audio has no visuals`,
          true,
        );
      }
    }

    timelineState.setMode(
      timelineState.masterAudioBuffer ? "audio_locked" : "free",
    );

    normalizeTimeline(totalDur);

    timelineState.setTimelineSnapPoints(buildSnapPoints());

    timelineState.setVideoGenerated(true);
    updateVideoContext();

    dom.videoCanvas.classList.remove("hidden");
    dom.videoCanvas.style.display = "block";
    dom.videoPreGenerationOverlay.classList.add("hidden");
    dom.videoControlsContainer.classList.remove("hidden");
    dom.videoPostGenerationOverlay.classList.remove("hidden");
    dom.videoExportBtn.disabled = false;
    dom.magicCameraBtn.disabled = false;
    dom.analyzeTransitionsBtn.disabled = false;
    dom.videoDirectorBtn.disabled = false;
    dom.videoDirectorBtn.classList.remove("opacity-50");

    drawVideoFrame(0);
    ui.renderTimelineEditor();

    setTimeout(() => {
      if (timelineState.clips?.length) {
        const maxWarmup = Math.min(2.0, totalDur);
        for (let t = 0; t <= maxWarmup; t += 0.15) {
          drawVideoFrame(t);
        }
        drawVideoFrame(0);
      }
    }, 100);

    const hasMultipleClips = timelineState.clips.length > 3;
    if (hasMultipleClips) {
      ui.showStatus(
        '✨ Tip: Click "Analyze Transitions" for cinematic effects',
        false,
        5000,
      );
    } else {
      ui.showStatus("Done!", false, 3000);
    }
    addLog(
      `✔️ Production complete in ${((performance.now() - startTime) / 1000).toFixed(1)}s.`,
    );
  } catch (e: any) {
    if (String(e?.message) === "Stopped.")
      ui.showStatus("🛑 Production cancelled.", false, 2500);
    else ui.showStatus(`Failed: ${e.message}`, true, 5000);
  } finally {
    state.isVideoProductionRunning = false;
    ui.closeProcessingModal();
  }
}

const DEFAULT_EDITORIAL_MOVES = [
  'zoom_in_pan_right',
  'pan_slow',
  'zoom_out_pan_left',
  'dolly_in',
  'zoom_in_pan_left',
  'pan_right',
];

export async function handleManualVisualSync() {
  if (!timelineState.clips || timelineState.clips.length === 0) {
    ui.showStatus('Please generate timeline clips first.', true, 4000);
    return;
  }

  if (!timelineState.globalWordTimestamps || timelineState.globalWordTimestamps.length === 0) {
    ui.showStatus('No timestamps found. Please click "Get Timestamps" or upload an SRT first.', true, 4000);
    return;
  }

  const runId = bumpRunId();
  state.isVideoProductionRunning = true;
  ui.setButtonsDisabled(true);
  await ui.openProcessingModal('Visual Sync', true, 'Stop');
  ui.updateProcessingProgress(10, 'Re-aligning clips to word timestamps...');

  try {
    const shotsWithMetadata = state.currentScenes.flatMap((scene, sIdx) =>
      (scene.lines || [scene]).map((line: any, lIdx: number) => {
        const existingClip = timelineState.clips?.find((c) => c.id === line.id);
        return {
          ...line,
          __sceneIndex: sIdx,
          __lineIndex: lIdx,
          _videoObjectURL: line._videoObjectURL || existingClip?._videoObjectURL,
          video_id: line.video_id || existingClip?.video_id,
          _imageObjectURL: line._imageObjectURL || existingClip?._imageObjectURL,
          image_id: line.image_id || existingClip?.image_id,
        };
      })
    );
    const shots: Shot[] = shotsWithMetadata.filter(
      (s: any) =>
        !!(
          s._imageObjectURL ||
          s._videoObjectURL ||
          s.image_id ||
          s.video_id ||
          s.talkingHeadMode === 'full' ||
          s.talkingHeadMode === 'split' ||
          (s.talkingHeadMode && s.talkingHeadMode.startsWith('pip'))
        )
    );

    if (shots.length === 0) {
      ui.showStatus('No generated storyboard media found.', true, 4000);
      return;
    }

    let actualAudioDuration = timelineState.masterAudioBuffer ? timelineState.masterAudioBuffer.duration : 0;
    if (actualAudioDuration === 0) {
      actualAudioDuration = Math.max(...timelineState.globalWordTimestamps.map((w) => w.end)) + 1;
    }

    const silences =
      timelineState.globalSilences ||
      (timelineState.masterAudioBuffer ? (utils.detectSilences(timelineState.masterAudioBuffer) as Silence[]) : []);
    timelineState.setGlobalSilences(silences);

    const canonicalRanges = alignShotsCanonical(
      shots,
      timelineState.globalWordTimestamps,
      (msg) => ui.logProductionStatus(msg),
      actualAudioDuration,
      { silences }
    );
    const shotStartTimes = canonicalRanges.map((r) => r.startTime);

    // Preload media in parallel batches instead of blocking sequentially one-by-one
    const newClips = await Promise.all(
      shots.map(async (shot, i) => {
        assertStillRunning(runId);
        const range = canonicalRanges[i];
        const existingClip = timelineState.clips?.find((c) => c.id === shot.id) || timelineState.clips?.[i];
        const videoUrl = shot._videoObjectURL || existingClip?._videoObjectURL;
        const videoId = (shot as any).video_id || existingClip?.video_id;
        const imageUrl = shot._imageObjectURL || existingClip?._imageObjectURL;
        const imageId = (shot as any).image_id || existingClip?.image_id;
        const videoStartOffset =
          (shot as any).videoStartOffset ??
          existingClip?.videoStartOffset ??
          ((!videoUrl && state.uploadedVideoElement) ||
          (videoUrl && state.uploadedVideoElement && videoUrl === state.uploadedVideoElement.src)
            ? shotStartTimes[i]
            : 0);

        if (videoUrl && !shot._videoObjectURL) {
          shot._videoObjectURL = videoUrl;
          (shot as any).video_id = videoId;
        }
        if (imageUrl && !shot._imageObjectURL) {
          shot._imageObjectURL = imageUrl;
          (shot as any).image_id = imageId;
        }

        let videoEl = existingClip?.videoElement;
        let img = existingClip?.image || null;
        try {
          if (videoUrl && !videoEl) {
            videoEl = await utils.loadVideoElement(videoUrl);
          }
          if (imageUrl && !img) {
            img = await utils.loadImageOrThrow(imageUrl);
          }
        } catch (e) {
          console.warn('Failed to load visual for clip:', e);
        }

        const startTime = shotStartTimes[i];
        const endTime = i + 1 < shots.length ? shotStartTimes[i + 1] : actualAudioDuration;
        const fallbackMove = DEFAULT_EDITORIAL_MOVES[i % DEFAULT_EDITORIAL_MOVES.length];

        return {
          id: shot.id || `s${shot.__sceneIndex}_l${shot.__lineIndex}`,
          startTime,
          endTime,
          duration: endTime - startTime,
          startWordIndex: range?.startWordIndex ?? -1,
          endWordIndex: range?.endWordIndex ?? -1,
          alignmentConfidence: range?.alignmentConfidence ?? 0.5,
          textMatchConfidence: range?.textMatchConfidence ?? range?.alignmentConfidence ?? 0.5,
          timingReliability: range?.timingReliability ?? 0.85,
          timingProvenance: range?.timingProvenance ?? 'acoustic_word',
          timingSource: range?.timingSource ?? (range ? 'deepgram' : 'synthetic'),
          _imageObjectURL: imageUrl,
          _videoObjectURL: videoUrl,
          image_id: imageId,
          video_id: videoId,
          videoStartOffset,
          talkingHeadMode: (shot as any).talkingHeadMode || existingClip?.talkingHeadMode,
          talkingHeadSize: (shot as any).talkingHeadSize || existingClip?.talkingHeadSize,
          useOriginalAudio: (shot as any).useOriginalAudio ?? existingClip?.useOriginalAudio,
          displayMode: (shot as any).displayMode || existingClip?.displayMode || 'fullscreen',
          pipPosition: (shot as any).pipPosition || existingClip?.pipPosition || 'top_right',
          pipX: (shot as any).pipX ?? existingClip?.pipX,
          pipY: (shot as any).pipY ?? existingClip?.pipY,
          pipAnchorX: (shot as any).pipAnchorX ?? existingClip?.pipAnchorX,
          pipAnchorY: (shot as any).pipAnchorY ?? existingClip?.pipAnchorY,
          pipAnimation: (shot as any).pipAnimation || existingClip?.pipAnimation || 'pop_spring',
          pipScale: (shot as any).pipScale ?? existingClip?.pipScale,
          overlayImage: existingClip?.overlayImage,
          overlayImageId: (shot as any).overlayImageId || existingClip?.overlayImageId,
          overlayImageUrl: (shot as any).overlayImageUrl || existingClip?.overlayImageUrl,
          overlayPosition: (shot as any).overlayPosition || existingClip?.overlayPosition || 'top-right',
          colorFilter: (shot as any).colorFilter || existingClip?.colorFilter || 'none',
          colorFilterIntensity:
            typeof (shot as any).colorFilterIntensity === 'number'
              ? (shot as any).colorFilterIntensity
              : (existingClip?.colorFilterIntensity ?? 1.0),
          image: img || undefined,
          videoElement: videoEl,
          text: (shot.text_reference || shot.line_text || existingClip?.text || '').replace(/<[^>]+>/g, ' ').trim(),
          cameraMovement: shot.camera_movement || existingClip?.cameraMovement || fallbackMove,
          focalPoint: shot.focalPoint || existingClip?.focalPoint,
          __sceneIndex: shot.__sceneIndex,
          __lineIndex: shot.__lineIndex,
          transitionToNext: existingClip?.transitionToNext || 'cut',
          wordTimestamps: [] as WordTimestamp[],
          wordTimestampMode: 'relative',
          locked: false,
        };
      })
    );

    const perShotWords = sliceTranscriptForShots(
      shotStartTimes,
      timelineState.globalWordTimestamps,
      actualAudioDuration
    );
    newClips.forEach((clip: any, i) => {
      clip.wordTimestamps = perShotWords[i] || [];
    });

    timelineState.setMode('audio_locked');
    timelineState.setClips(newClips as any);
    normalizeTimeline(actualAudioDuration);
    timelineState.setTimelineSnapPoints(buildSnapPoints());
    updateVideoContext();
    drawVideoFrame(0);
    ui.renderTimelineEditor();

    ui.showStatus('Visual Sync Complete!', false, 3000);
  } catch (e: any) {
    if (String(e?.message) === 'Stopped.') ui.showStatus('🛑 Cancelled.', false, 2500);
    else ui.showStatus(`Failed: ${e.message}`, true, 5000);
  } finally {
    state.isVideoProductionRunning = false;
    ui.closeProcessingModal();
  }
}

/**
 * Restores the Video Director preview timeline from loaded project/archive metadata
 * or builds a fallback timeline directly from available shot assets.
 */
export async function restoreVideoTimeline(
  videoTimelineMetadata?: any[],
  options: { silent?: boolean } = {},
): Promise<boolean> {
  const silent = !!options.silent;
  const allShots = (state.currentScenes || []).flatMap(
    (s: any) => s.lines || [s],
  );

  let loadedClips: any[] = [];

  // Strategy 1: Restore from saved videoTimelineMetadata
  if (
    videoTimelineMetadata &&
    Array.isArray(videoTimelineMetadata) &&
    videoTimelineMetadata.length > 0
  ) {
    const timelinePromises = videoTimelineMetadata.map(
      async (meta: any, idx: number) => {
        // 1. Matches clips by id
        // 2. Then by matching text (with either image or video present)
        // 3. Then falls back to positional order with assets
        // No further fallback: matching "any shot with assets" as a last resort
        // can silently attach the same wrong image/video to several different
        // clips, which is worse than just dropping the unmatched clip.
        const matchedShot =
          allShots.find((s: any) => s.id && s.id === meta.id) ||
          allShots.find(
            (s: any) =>
              (s.text_reference || s.line_text) &&
              (s.text_reference || s.line_text) === meta.text &&
              (s._imageObjectURL || s._videoObjectURL),
          ) ||
          (allShots[idx] &&
          (allShots[idx]._imageObjectURL || allShots[idx]._videoObjectURL)
            ? allShots[idx]
            : null);

        let videoEl: HTMLVideoElement | undefined = undefined;
        let img: HTMLImageElement | null = null;

        // Load both _imageObjectURL and _videoObjectURL per shot
        if (matchedShot?._videoObjectURL) {
          try {
            videoEl = await utils.loadVideoElement(matchedShot._videoObjectURL);
          } catch (err) {
            console.warn(
              `Failed to load video element for clip ${meta.id}:`,
              err,
            );
          }
        }

        if (matchedShot?._imageObjectURL) {
          try {
            img = await utils.loadImageOrThrow(matchedShot._imageObjectURL);
          } catch (err) {
            console.warn(`Failed to load image for clip ${meta.id}:`, err);
          }
        }

        // If neither video nor image could be loaded, drop this clip only if there is no A-roll presenter video
        const hasArollVideo = !!state.uploadedVideoElement;
        const matchedTHMode = meta.talkingHeadMode || matchedShot?.talkingHeadMode;
        const isArollShot = hasArollVideo && matchedTHMode && matchedTHMode !== 'none';

        if (!img && !videoEl && !isArollShot && !hasArollVideo) {
          return null;
        }

        const startTime =
          typeof meta.startTime === "number" ? meta.startTime : 0;
        const duration =
          typeof meta.duration === "number"
            ? meta.duration
            : typeof meta.endTime === "number"
              ? meta.endTime - startTime
              : 3.5;
        const endTime =
          typeof meta.endTime === "number"
            ? meta.endTime
            : startTime + duration;

        const clipTHMode = meta.talkingHeadMode || matchedShot?.talkingHeadMode || (state.uploadedVideoElement ? (state.talkingHeadDefaultMode && state.talkingHeadDefaultMode !== 'none' ? state.talkingHeadDefaultMode : (matchedShot?.talkingHeadMode || 'none')) : 'none');
        const clipTHShape = meta.talkingHeadShape || matchedShot?.talkingHeadShape || state.talkingHeadShape || 'circle';
        const clipTHSize = meta.talkingHeadSize || matchedShot?.talkingHeadSize || state.talkingHeadSize || 'medium';
        const clipDisplayMode = meta.displayMode || matchedShot?.displayMode || 'fullscreen';
        const isMasterVideo = (!matchedShot?._videoObjectURL && !!state.uploadedVideoElement) ||
                              (matchedShot?._videoObjectURL && state.uploadedVideoElement && matchedShot._videoObjectURL === state.uploadedVideoElement.src) ||
                              (clipTHMode && clipTHMode !== 'none' && !!state.uploadedVideoElement);
        const clipVideoOffset = meta.videoStartOffset ?? matchedShot?.videoStartOffset ?? (isMasterVideo ? startTime : 0);

        return {
          ...meta,
          id: meta.id || matchedShot?.id || `clip_${idx}`,
          image: img || undefined,
          videoElement: videoEl || undefined,
          _videoObjectURL: matchedShot?._videoObjectURL,
          videoStartOffset: clipVideoOffset,
          startTime,
          endTime,
          duration,
          cameraMovement:
            meta.cameraMovement || matchedShot?.camera_movement || "static",
          transitionToNext: meta.transitionToNext || "cut",
          text:
            meta.text ||
            matchedShot?.text_reference ||
            matchedShot?.line_text ||
            "",
          wordTimestamps: meta.wordTimestamps || [],
          wordRange: meta.wordRange,
          focalPoint: meta.focalPoint || matchedShot?.focalPoint,
          talkingHeadMode: clipTHMode,
          talkingHeadShape: clipTHShape,
          talkingHeadSize: clipTHSize,
          talkingHeadVideoElement: state.uploadedVideoElement || undefined,
          displayMode: clipDisplayMode,
          pipPosition: meta.pipPosition || matchedShot?.pipPosition,
          pipX: meta.pipX ?? (matchedShot as any)?.pipX,
          pipY: meta.pipY ?? (matchedShot as any)?.pipY,
          pipAnchorX: meta.pipAnchorX ?? (matchedShot as any)?.pipAnchorX,
          pipAnchorY: meta.pipAnchorY ?? (matchedShot as any)?.pipAnchorY,
          pipAnimation: meta.pipAnimation || matchedShot?.pipAnimation,
          pipScale: meta.pipScale || matchedShot?.pipScale,
          colorFilter: meta.colorFilter || matchedShot?.colorFilter || 'none',
          colorFilterIntensity: meta.colorFilterIntensity ?? matchedShot?.colorFilterIntensity ?? 1.0,
        };
      },
    );

    loadedClips = (await Promise.all(timelinePromises)).filter(Boolean);
  }

  // Strategy 2: If no timeline was ever saved (or 0 clips restored) but shots have assets, build best-effort fallback timeline
  if (loadedClips.length === 0) {
    const shotsWithAssets = allShots.filter(
      (s: any) => s._imageObjectURL || s._videoObjectURL || (state.uploadedVideoElement && (s.talkingHeadMode === 'full' || s.talkingHeadMode === 'split' || (s.talkingHeadMode && s.talkingHeadMode.startsWith('pip')) || allShots.length > 0)),
    );
    if (shotsWithAssets.length > 0) {
      const fallbackDur = 3.5;
      const fallbackPromises = shotsWithAssets.map(
        async (shot: any, idx: number) => {
          let videoEl: HTMLVideoElement | undefined = undefined;
          let img: HTMLImageElement | null = null;

          if (shot._videoObjectURL) {
            try {
              videoEl = await utils.loadVideoElement(shot._videoObjectURL);
            } catch (err) {
              console.warn(
                `Fallback video load failed for shot ${shot.id}:`,
                err,
              );
            }
          }
          if (shot._imageObjectURL) {
            try {
              img = await utils.loadImageOrThrow(shot._imageObjectURL);
            } catch (err) {
              console.warn(
                `Fallback image load failed for shot ${shot.id}:`,
                err,
              );
            }
          }

          const hasArollVideo = !!state.uploadedVideoElement;
          const shotTHMode = shot.talkingHeadMode || (hasArollVideo ? (state.talkingHeadDefaultMode && state.talkingHeadDefaultMode !== 'none' ? state.talkingHeadDefaultMode : 'none') : 'none');
          const isArollShot = hasArollVideo && shotTHMode && shotTHMode !== 'none';

          if (!img && !videoEl && !isArollShot && !hasArollVideo) return null;

          const startTime = idx * fallbackDur;
          const endTime = startTime + fallbackDur;

          const isMasterVideo = (!shot._videoObjectURL && !!state.uploadedVideoElement) ||
                                (shot._videoObjectURL && state.uploadedVideoElement && shot._videoObjectURL === state.uploadedVideoElement.src) ||
                                (shotTHMode && shotTHMode !== 'none' && !!state.uploadedVideoElement);
          const shotOffset = shot.videoStartOffset ?? (isMasterVideo ? startTime : 0);

          return {
            id: shot.id || `shot_${idx}`,
            image: img || undefined,
            videoElement: videoEl || undefined,
            _videoObjectURL: shot._videoObjectURL,
            videoStartOffset: shotOffset,
            duration: fallbackDur,
            startTime,
            endTime,
            cameraMovement: shot.camera_movement || "static",
            focalPoint: shot.focalPoint,
            transitionToNext: "cut",
            text: shot.text_reference || shot.line_text || "",
            wordTimestamps: [],
            locked: false,
            rotate: shot.rotate || 0,
            deviceTag: shot.deviceTag,
            volume: shot.volume,
            fadeIn: shot.fadeIn,
            fadeOut: shot.fadeOut,
            playbackRate: shot.playbackRate,
            useOriginalAudio: shot.useOriginalAudio,
            audioDuckingOverride: shot.audioDuckingOverride,
            talkingHeadMode: shotTHMode,
            talkingHeadShape: shot.talkingHeadShape || state.talkingHeadShape || 'circle',
            talkingHeadSize: shot.talkingHeadSize || state.talkingHeadSize || 'medium',
            talkingHeadVideoElement: state.uploadedVideoElement || undefined,
            displayMode: shot.displayMode || 'fullscreen',
            pipPosition: shot.pipPosition,
            pipX: shot.pipX,
            pipY: shot.pipY,
            pipAnchorX: shot.pipAnchorX,
            pipAnchorY: shot.pipAnchorY,
            pipAnimation: shot.pipAnimation,
            pipScale: shot.pipScale,
            colorFilter: shot.colorFilter || 'none',
            colorFilterIntensity: typeof shot.colorFilterIntensity === 'number' ? shot.colorFilterIntensity : 1.0,
          };
        },
      );

      loadedClips = (await Promise.all(fallbackPromises)).filter(Boolean);
    }
  }

  if (loadedClips.length > 0) {
    if (state.uploadedVideoElement) {
      loadedClips.forEach((clip: any) => {
        clip.talkingHeadVideoElement = state.uploadedVideoElement;
      });
    }
    timelineState.setClips(loadedClips);

    if (timelineState.mode === "audio_locked") {
      const globalTimestamps = timelineState.clips.flatMap((clip) => {
        return (clip.wordTimestamps || []).map((w: any) => ({
          word: w.word,
          start: clip.startTime + w.start,
          end: clip.startTime + w.end,
        }));
      });
      timelineState.setGlobalWordTimestamps(globalTimestamps);

      if (
        timelineState.globalWordTimestamps &&
        timelineState.globalWordTimestamps.length > 0
      ) {
      }
    }
  }

  const totalDur =
    timelineState.clips[timelineState.clips.length - 1]?.endTime ||
    timelineState.clips.reduce((acc, c) => acc + (c.duration || 0), 0);
  normalizeTimeline(totalDur);

  timelineState.setVideoGenerated(true);
  if (!silent && !isProjectHydrating()) {
    updateVideoContext();
    if (dom.videoCanvas) {
      dom.videoCanvas.classList.remove("hidden");
      dom.videoCanvas.style.display = "block";
    }
    if (dom.videoPreGenerationOverlay) {
      dom.videoPreGenerationOverlay.classList.add("hidden");
    }
    if (dom.videoControlsContainer) {
      dom.videoControlsContainer.classList.remove("hidden");
    }
    if (dom.videoPostGenerationOverlay) {
      dom.videoPostGenerationOverlay.classList.remove("hidden");
    }
    if (dom.videoExportBtn) dom.videoExportBtn.disabled = false;
    if (dom.magicCameraBtn) dom.magicCameraBtn.disabled = false;
    if (dom.analyzeTransitionsBtn) dom.analyzeTransitionsBtn.disabled = false;
    if (dom.openTranscriptEditorBtn) {
      dom.openTranscriptEditorBtn.disabled = false;
      dom.openTranscriptEditorBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
    if (dom.videoDirectorBtn) {
      dom.videoDirectorBtn.disabled = false;
      dom.videoDirectorBtn.classList.remove("opacity-50");
    }
    drawVideoFrame(0);
    ui.renderTimelineEditor();
    setTimeout(() => {
      if (timelineState.clips?.length) {
        const maxWarmup = Math.min(2.0, totalDur);
        for (let t = 0; t <= maxWarmup; t += 0.2) {
          drawVideoFrame(t);
        }
        drawVideoFrame(0);
      }
    }, 50);
    ui.updateWorkflowStepStatus(3, "completed");
    ui.updateWorkflowStepStatus(4, "active");
  }

  return true;
}

