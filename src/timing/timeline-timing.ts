/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContentGen AI — Timeline Timing & Synchronization Engine
 * Single authoritative source of truth for clip intervals, duration derivation,
 * timeline normalization, audio-locked synchronization, and export audit validation.
 */

export type TimingAuthority = 'none' | 'audio' | 'free';

export interface CanonicalWordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  punctuated_word?: string;
}

export interface ShotTiming {
  startTime: number;
  endTime: number;
  duration: number;
  startWordIndex: number | null;
  endWordIndex: number | null;
  alignmentConfidence: number;
  textMatchConfidence?: number;
  timingReliability?: number;
  timingProvenance?: 'acoustic_word' | 'acoustic_island_bounded' | 'silence_snapped' | 'synthetic_fallback' | 'manual';
  timingSource: 'tts' | 'deepgram' | 'forced_alignment' | 'subtitle' | 'manual' | 'fallback' | 'synthetic';
}

export interface TimelineTimingAudit {
  valid: boolean;
  canExport: boolean;
  errors: string[];
  warnings: string[];
  reviewableTextMatches?: string[];
  audioDuration: number | null;
  visualDuration: number;
  clipCount: number;
  maxGap: number;
  maxOverlap: number;
  gapCount: number;
  overlapCount: number;
  minConfidence: number;
  avgConfidence: number;
  minTimingReliability?: number;
  avgTimingReliability?: number;
  minTextMatchConfidence?: number;
  lowConfidenceCount: number;
  unreliableTimingCount?: number;
  invalidWordCount: number;
  driftSeconds: number;
  syncHealthPercent: number;
}

export const ALIGNMENT_THRESHOLDS = {
  ACCEPT: 0.78,
  WARN: 0.62,
  BLOCK: 0.50,
};

/**
 * Derives clip duration strictly from boundary intervals: endTime - startTime.
 */
export function deriveDuration(startTime: number, endTime: number): number {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return 0;
  }
  return Math.max(0, endTime - startTime);
}

/**
 * Sets canonical clip timing enforcing: duration = endTime - startTime.
 */
export function setClipTiming(
  clip: any,
  startTime: number,
  endTime: number,
  options?: { timingSource?: ShotTiming['timingSource'] }
): void {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error(`Invalid clip timing for ${clip?.id || 'unknown'}: ${startTime} → ${endTime}`);
  }

  if (endTime < startTime) {
    throw new Error(
      `Invalid inverted clip interval for ${clip?.id || 'unknown'}: ${startTime} → ${endTime}`
    );
  }

  clip.startTime = Number(startTime.toFixed(6));
  clip.endTime = Number(endTime.toFixed(6));
  clip.duration = Number(Math.max(0, clip.endTime - clip.startTime).toFixed(6));

  if (options?.timingSource) {
    clip.timingSource = options.timingSource;
  }
}

/**
 * Retrieves the canonical start time of a clip.
 */
export function getClipStart(clip: any): number {
  return Number.isFinite(clip?.startTime) ? clip.startTime : 0;
}

/**
 * Retrieves the canonical end time of an audio-locked clip strictly from endTime.
 * For audio-locked timelines, duration is NEVER trusted to invent endTime.
 */
export function getAudioLockedClipEnd(clip: any): number {
  if (
    !Number.isFinite(clip?.startTime) ||
    !Number.isFinite(clip?.endTime) ||
    clip.endTime <= clip.startTime
  ) {
    throw new Error(
      `Audio-locked clip ${clip?.id ?? '?'} has invalid canonical timing (startTime=${clip?.startTime}, endTime=${clip?.endTime})`
    );
  }

  return clip.endTime;
}

/**
 * Retrieves the canonical end time of a clip.
 * When mode === 'audio_locked', strictly delegates to getAudioLockedClipEnd.
 */
export function getClipEnd(clip: any, mode?: 'audio_locked' | 'free'): number {
  if (mode === 'audio_locked') {
    return getAudioLockedClipEnd(clip);
  }

  const start = getClipStart(clip);

  if (Number.isFinite(clip?.endTime) && clip.endTime >= start) {
    return clip.endTime;
  }

  if (Number.isFinite(clip?.duration) && clip.duration >= 0) {
    return start + clip.duration;
  }

  throw new Error(`Clip ${clip?.id ?? '(unknown)'} has no valid start/end timing`);
}

/**
 * Retrieves derived duration from canonical boundaries.
 */
export function getClipDuration(clip: any): number {
  return Math.max(0, getClipEnd(clip) - getClipStart(clip));
}

/**
 * Resolves which clip is active at a given timeline time T using half-open intervals [startTime, endTime).
 */
export function resolveClipAtTimelineTime(
  clips: any[],
  time: number
): {
  clip: any | null;
  index: number;
  localTime: number;
} {
  if (!clips || clips.length === 0 || !Number.isFinite(time)) {
    return { clip: null, index: -1, localTime: 0 };
  }

  // Exact clamp at boundaries
  const totalClips = clips.length;
  for (let i = 0; i < totalClips; i++) {
    const clip = clips[i];
    const start = getClipStart(clip);
    const end = getClipEnd(clip);

    // Last clip is closed at both ends [start, end] so end of video can paint last frame
    const isLast = (i === totalClips - 1);
    if ((time >= start && time < end) || (isLast && time >= start && time <= end + 0.0001)) {
      return {
        clip,
        index: i,
        localTime: Math.max(0, time - start),
      };
    }
  }

  // Fallback clamping: if beyond end, return last clip; if before start, return first clip
  if (time < getClipStart(clips[0])) {
    return { clip: clips[0], index: 0, localTime: 0 };
  }
  const lastClip = clips[totalClips - 1];
  return {
    clip: lastClip,
    index: totalClips - 1,
    localTime: Math.max(0, getClipDuration(lastClip)),
  };
}

/**
 * Validates word timestamps inside a clip to ensure they are relative and stay within bounds.
 */
export function validateClipWords(clip: any): string[] {
  const errors: string[] = [];
  const duration = getClipDuration(clip);

  if (!clip.wordTimestamps || !Array.isArray(clip.wordTimestamps) || clip.wordTimestamps.length === 0) {
    return errors;
  }

  for (let i = 0; i < clip.wordTimestamps.length; i++) {
    const w = clip.wordTimestamps[i];
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end)) {
      errors.push(`Clip ${clip.id ?? '?'}: Word #${i} ('${w.word}') has invalid non-finite time`);
      continue;
    }
    if (w.end < w.start) {
      errors.push(`Clip ${clip.id ?? '?'}: Word #${i} ('${w.word}') has end < start (${w.start} -> ${w.end})`);
    }
    if (w.start < -0.05) {
      errors.push(`Clip ${clip.id ?? '?'}: Word #${i} ('${w.word}') begins significantly before clip start (${w.start}s)`);
    }
    if (w.end > duration + 0.15) {
      errors.push(`Clip ${clip.id ?? '?'}: Word #${i} ('${w.word}') ends significantly after clip duration (${w.end}s > ${duration}s)`);
    }
  }

  return errors;
}

/**
 * Audits complete timeline consistency, checking for gaps, overlaps, duration mismatches,
 * audio drift, and alignment confidence.
 */
export function auditTimelineTiming(
  clips: any[],
  audioDuration?: number | null,
  options?: { mode?: 'audio_locked' | 'free' }
): TimelineTimingAudit {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isAudioLocked = options?.mode !== 'free';
  const clipList = clips || [];

  if (clipList.length === 0) {
    return {
      valid: false,
      canExport: false,
      errors: ['Timeline has no clips.'],
      warnings: [],
      audioDuration: audioDuration ?? null,
      visualDuration: 0,
      clipCount: 0,
      maxGap: 0,
      maxOverlap: 0,
      gapCount: 0,
      overlapCount: 0,
      minConfidence: 0,
      avgConfidence: 0,
      lowConfidenceCount: 0,
      invalidWordCount: 0,
      driftSeconds: audioDuration ?? 0,
      syncHealthPercent: 0,
    };
  }

  const sorted = [...clipList].sort((a, b) => getClipStart(a) - getClipStart(b));

  let previousEnd = 0;
  let maxGap = 0;
  let maxOverlap = 0;
  let gapCount = 0;
  let overlapCount = 0;
  let confidences: number[] = [];
  let timingReliabilities: number[] = [];
  let textMatchConfidences: number[] = [];
  let lowConfidenceCount = 0;
  let unreliableTimingCount = 0;
  let totalInvalidWords = 0;
  const reviewableTextMatches: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const start = getClipStart(c);
    let end: number;
    try {
      end = getClipEnd(c, isAudioLocked ? 'audio_locked' : 'free');
    } catch (timingErr: any) {
      if (isAudioLocked) {
        errors.push(`Clip #${i + 1} (${c.id ?? i}) timing failure: ${timingErr?.message || timingErr}`);
        end = start + Math.max(0.05, Number(c.duration) || 0);
      } else {
        end = getClipEnd(c, 'free');
      }
    }

    if (end < start) {
      errors.push(`Clip #${i + 1} (${c.id ?? i}) has inverted interval: ${start.toFixed(3)}s → ${end.toFixed(3)}s.`);
    }

    const derivedDuration = end - start;
    if (Number.isFinite(c.duration) && Math.abs(c.duration - derivedDuration) > 0.001) {
      if (isAudioLocked) {
        errors.push(
          `Clip #${i + 1} (${c.id ?? i}) duration mismatch: stored ${c.duration.toFixed(3)}s vs derived ${derivedDuration.toFixed(3)}s.`
        );
      } else {
        warnings.push(`Clip #${i + 1} duration was corrected from ${c.duration.toFixed(3)}s to ${derivedDuration.toFixed(3)}s.`);
      }
    }

    if (i > 0) {
      const gap = start - previousEnd;
      if (gap > 0.001) {
        gapCount++;
        maxGap = Math.max(maxGap, gap);
        if (gap > 0.05) {
          errors.push(`Gap of ${(gap * 1000).toFixed(1)}ms detected before clip #${i + 1} (${c.id ?? i}).`);
        } else {
          warnings.push(`Micro-gap of ${(gap * 1000).toFixed(1)}ms before clip #${i + 1}.`);
        }
      } else if (gap < -0.001) {
        const overlap = Math.abs(gap);
        overlapCount++;
        maxOverlap = Math.max(maxOverlap, overlap);
        if (overlap > 0.05) {
          errors.push(`Overlap of ${(overlap * 1000).toFixed(1)}ms detected between clip #${i} and #${i + 1}.`);
        } else {
          warnings.push(`Micro-overlap of ${(overlap * 1000).toFixed(1)}ms before clip #${i + 1}.`);
        }
      }
    }

    // Separated evaluation: Text-Match Confidence vs Timing Reliability & Provenance
    const textConf = typeof c.textMatchConfidence === 'number'
      ? c.textMatchConfidence
      : (typeof c.alignmentConfidence === 'number' ? c.alignmentConfidence : undefined);

    const timingProvenance = c.timingProvenance ||
      (c.timingSource === 'synthetic' || c.timingSource === 'fallback' ? 'synthetic_fallback' : 'acoustic_word');

    const timingRel = typeof c.timingReliability === 'number'
      ? c.timingReliability
      : (timingProvenance === 'synthetic_fallback' ? 0.2 : 0.95);

    if (typeof textConf === 'number') {
      confidences.push(textConf);
      textMatchConfidences.push(textConf);
    }
    timingReliabilities.push(timingRel);

    if (typeof textConf === 'number' && textConf < ALIGNMENT_THRESHOLDS.WARN) {
      lowConfidenceCount++;
      // If timing reliability is verified (>= BLOCK threshold 0.50, e.g. anchor-bounded or silence-snapped),
      // do NOT block export! Report as reviewable diagnostic instead.
      if (timingRel >= ALIGNMENT_THRESHOLDS.BLOCK) {
        reviewableTextMatches.push(
          `Clip #${i + 1} (${c.id ?? i}) has low script text match: ${(textConf * 100).toFixed(0)}%, but verified acoustic timing (${(timingRel * 100).toFixed(0)}% [${timingProvenance}]).`
        );
        warnings.push(
          `Clip #${i + 1} (${c.id ?? i}): script wording differs from audio (${(textConf * 100).toFixed(0)}%), but cut boundaries are verified by acoustic anchors.`
        );
      } else {
        // Neither text-match nor timing reliability is verified
        unreliableTimingCount++;
        if (isAudioLocked) {
          errors.push(
            `Clip #${i + 1} (${c.id ?? i}) has critically low alignment: ${(textConf * 100).toFixed(0)}% text match and unverified timing reliability (${(timingRel * 100).toFixed(0)}%).`
          );
        } else {
          warnings.push(
            `Clip #${i + 1} (${c.id ?? i}) has low alignment confidence: ${(textConf * 100).toFixed(0)}%.`
          );
        }
      }
    }

    if (isAudioLocked) {
      const src = c.timingSource;
      // Audio-locked export strictly blocks unverified synthetic/fallback timing only when timing reliability is below BLOCK
      if ((src === 'synthetic' || src === 'fallback') && timingRel < ALIGNMENT_THRESHOLDS.BLOCK) {
        errors.push(
          `Clip #${i + 1} (${c.id ?? i}) uses unverified ${src} timing without acoustic anchor bounding. Audio-locked export requires verified acoustic timestamps or neighbor-anchored alignment.`
        );
      }
    }

    const wordErrors = validateClipWords(c);
    if (wordErrors.length > 0) {
      totalInvalidWords += wordErrors.length;
      warnings.push(...wordErrors);
    }

    previousEnd = end;
  }

  const visualDuration = previousEnd;
  let driftSeconds = 0;

  if (Number.isFinite(audioDuration) && audioDuration! > 0) {
    driftSeconds = Math.abs(visualDuration - audioDuration!);
    if (driftSeconds > 0.1) {
      if (isAudioLocked) {
        errors.push(
          `Master Audio / Visual timeline duration mismatch: visual is ${visualDuration.toFixed(3)}s, audio is ${audioDuration!.toFixed(3)}s (drift: ${(driftSeconds * 1000).toFixed(0)}ms).`
        );
      } else {
        warnings.push(`Visual timeline (${visualDuration.toFixed(2)}s) differs from audio duration (${audioDuration!.toFixed(2)}s).`);
      }
    }
  }

  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 1.0;
  const minConfidence = confidences.length > 0
    ? Math.min(...confidences)
    : 1.0;
  const avgTimingReliability = timingReliabilities.length > 0
    ? timingReliabilities.reduce((a, b) => a + b, 0) / timingReliabilities.length
    : 1.0;
  const minTimingReliability = timingReliabilities.length > 0
    ? Math.min(...timingReliabilities)
    : 1.0;
  const minTextMatchConfidence = textMatchConfidences.length > 0
    ? Math.min(...textMatchConfidences)
    : 1.0;

  const syncHealthPercent = Math.max(
    0,
    Math.min(
      100,
      100 - (driftSeconds * 50) - (gapCount * 5) - (overlapCount * 5) - (unreliableTimingCount * 10) - (lowConfidenceCount * 1)
    )
  );

  const isValid = errors.length === 0;
  const canExport = isAudioLocked ? isValid : (errors.filter(e => !e.includes('duration mismatch')).length === 0);

  return {
    valid: isValid,
    canExport,
    errors,
    warnings,
    reviewableTextMatches,
    audioDuration: Number.isFinite(audioDuration) ? audioDuration! : null,
    visualDuration,
    clipCount: sorted.length,
    maxGap,
    maxOverlap,
    gapCount,
    overlapCount,
    minConfidence,
    avgConfidence,
    minTimingReliability,
    avgTimingReliability,
    minTextMatchConfidence,
    lowConfidenceCount,
    unreliableTimingCount,
    invalidWordCount: totalInvalidWords,
    driftSeconds,
    syncHealthPercent,
  };
}

/**
 * Pre-export synchronization gate. Enforces strict fail-closed validation.
 */
export function validateBeforeExport(
  clips: any[],
  audioDuration?: number | null,
  options?: { mode?: 'audio_locked' | 'free' }
): TimelineTimingAudit {
  const audit = auditTimelineTiming(clips, audioDuration, options);

  if (!audit.canExport && options?.mode !== 'free') {
    const errorDetails = audit.errors.join('\n• ');
    throw new Error(
      `EXPORT BLOCKED: Timeline timing validation failed.\n• ${errorDetails}\n\nPlease run 'Visual Sync' or check audio alignment.`
    );
  }

  return audit;
}

/**
 * Formats a human-readable synchronization report for production logs or modal display.
 */
export function generateSyncAuditReport(audit: TimelineTimingAudit): string {
  const statusStr = audit.valid ? '✅ PASS' : (audit.canExport ? '⚠️ PASS WITH WARNINGS' : '🛑 BLOCKED');
  const lines = [
    `SYNC AUDIT REPORT [${statusStr}]`,
    `--------------------------------------------------`,
    `Total Clips:            ${audit.clipCount}`,
    `Visual Timeline:        ${audit.visualDuration.toFixed(3)}s`,
    `Master Audio:           ${audit.audioDuration !== null ? `${audit.audioDuration.toFixed(3)}s` : 'N/A'}`,
    `Timeline Drift:         ${(audit.driftSeconds * 1000).toFixed(1)}ms`,
    `Sync Health Score:      ${audit.syncHealthPercent.toFixed(1)}%`,
    `Gaps / Overlaps:        ${audit.gapCount} gap(s), ${audit.overlapCount} overlap(s)`,
    `Text-Match Confidence:  min ${(audit.minConfidence * 100).toFixed(0)}%, avg ${(audit.avgConfidence * 100).toFixed(0)}%`,
    `Timing Reliability:     min ${(audit.minTimingReliability !== undefined ? (audit.minTimingReliability * 100).toFixed(0) : 100)}%, avg ${(audit.avgTimingReliability !== undefined ? (audit.avgTimingReliability * 100).toFixed(0) : 100)}%`,
  ];

  if (audit.reviewableTextMatches && audit.reviewableTextMatches.length > 0) {
    lines.push(`\n[REVIEWABLE SCRIPT/AUDIO OUTLIERS (${audit.reviewableTextMatches.length})]`);
    audit.reviewableTextMatches.forEach(r => lines.push(` ℹ️ ${r}`));
  }

  if (audit.errors.length > 0) {
    lines.push(`\n[CRITICAL TIMING ERRORS]`);
    audit.errors.forEach(e => lines.push(` • ${e}`));
  }

  if (audit.warnings.length > 0) {
    lines.push(`\n[WARNINGS]`);
    audit.warnings.slice(0, 5).forEach(w => lines.push(` • ${w}`));
    if (audit.warnings.length > 5) {
      lines.push(` • ... and ${audit.warnings.length - 5} more`);
    }
  }

  return lines.join('\n');
}

/**
 * Debug utility to dump exact per-clip timing to console for synchronization diagnosis.
 */
export function dumpSyncTimeline(clips: any[]): void {
  console.group('🎬 [ContentGen Sync Diagnostic Timeline]');
  for (let i = 0; i < (clips || []).length; i++) {
    const c = clips[i];
    const start = getClipStart(c);
    const end = getClipEnd(c);
    const dur = getClipDuration(c);
    console.log(`[CLIP ${String(i + 1).padStart(2, '0')}] ${c.id || 'shot'}`, {
      start: `${start.toFixed(3)}s`,
      end: `${end.toFixed(3)}s`,
      duration: `${dur.toFixed(3)}s`,
      wordRange: c.wordRange || { start: c.startWordIndex, end: c.endWordIndex },
      confidence: c.alignmentConfidence !== undefined ? `${(c.alignmentConfidence * 100).toFixed(0)}%` : 'N/A',
      wordCount: c.wordTimestamps?.length || 0,
      firstWord: c.wordTimestamps?.[0],
      lastWord: c.wordTimestamps?.[c.wordTimestamps?.length - 1],
    });
  }
  console.groupEnd();
}
