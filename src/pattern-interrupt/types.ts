/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type InterruptIntensity = 'low' | 'medium' | 'high';

export type InterruptStyle = 'cinematic' | 'documentary' | 'high_retention' | 'subtle' | 'automatic';

export type InterventionType = 
  | 'punch_in'           // Level 1 or 3: 108%-118% scale jump / punch-in
  | 'camera_movement'    // Level 1: smooth push-in or lateral drift
  | 'text_emphasis'      // Level 2: kinetic keyword or phrase card
  | 'stat_callout'       // Level 2: stat counter or metric callout
  | 'image_pip'          // Level 2 or 3: Pop-Up Picture-in-Picture card
  | 'spotlight';         // Level 1: spotlight vignette on key subject

export interface CandidateScoreBreakdown {
  durationFactor: number;
  staticFactor: number;
  overlayLackFactor: number;
  narrativeWeight: number;
}

export interface CandidateMetrics {
  duration: number;              // Length of monotonous stretch (seconds)
  visualChangePct: number;       // 0 - 100% (lower means more sameness)
  motionPct: number;             // 0 - 100% (lower means static)
  sceneChangePct?: number;       // 0 - 100% (TODO: not yet computed, reserved for future frame-diff pass)
  subtitleDensity: number;       // words per second
  narrativeImportance: number;   // 0 - 100%
  monotonyScore: number;         // 0 - 100% (heuristic composite score, higher means more monotonous)
  scoreBreakdown?: CandidateScoreBreakdown;
}

export interface CandidateContext {
  verbatimPhrase: string;
  emphasisWord?: string;
  triggerCategory: 'emphasis' | 'revelation' | 'comparison' | 'danger' | 'statistic' | 'question' | 'general';
  reason: string;
  detectionMethod?: 'keyword' | 'model';
}

export interface CandidateIntervention {
  type: InterventionType;
  level: 1 | 2 | 3;             // Level 1 (Micro), Level 2 (Visual), Level 3 (Strong)
  label: string;
  description: string;
  details: string;
  payload: Record<string, any>;
}

export interface MonotonyCandidate {
  id: string;
  clipId: string;
  clipIndex: number;
  timestamp: number;             // Absolute timeline second where intervention triggers
  stretchStart: number;
  stretchEnd: number;
  metrics: CandidateMetrics;
  context: CandidateContext;
  intervention: CandidateIntervention;
  alternativeInterventions: CandidateIntervention[];
  enabled: boolean;
  applied?: boolean;
}

export interface ApplyResult {
  appliedCount: number;
  skipped: { id: string; reason: string }[];
}

export interface PatternInterruptConfig {
  intensity: InterruptIntensity;
  style: InterruptStyle;
  maxPerMinute: number;          // Default 2
  minDistanceSec: number;        // Default 6.0s
  avoidConsecutiveSameType: boolean;
}

export interface AnalysisSummary {
  totalMonotonousSeconds: number;
  monotonyPercentage: number;
  candidatesFound: number;
  filteredCandidates: MonotonyCandidate[];
}
