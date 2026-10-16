import assert from 'node:assert';

// Mock minimal browser globals for Node test environment
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    innerWidth: 1920,
    innerHeight: 1080
  };
  (globalThis as any).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      addEventListener: () => {},
      appendChild: () => {}
    })
  };
}

import lexiconData from '../src/pattern-interrupt/lexicon.json';
import {
  stemWord,
  SCORE_WEIGHTS,
  DISRUPTION_WEIGHT,
  pickLeastDisruptive,
  applyPatternInterrupts
} from '../src/pattern-interrupt/engine';
import { timelineState } from '../src/state-timeline';
import type { CandidateIntervention, MonotonyCandidate } from '../src/pattern-interrupt/types';

console.log('--- Running Pattern Interrupt Engine Test Suite ---');

// =========================================================================
// TEST 3: Lexicon, Suffix-stripping Stemmer & Narrative Intent
// =========================================================================
console.log('Testing Spec #3: Lexicon & Suffix-stripping Stemmer...');

assert.strictEqual(stemWord('shocking'), 'shock');
assert.strictEqual(stemWord('discovered'), 'discover');
assert.strictEqual(stemWord('surprising'), 'surpris');
assert.strictEqual(stemWord('mysterious'), 'mysterious');
assert.strictEqual(stemWord('warning'), 'warn');

// Verify externalized lexicon contents
assert.ok(Array.isArray(lexiconData.highEmphasisKeywords), 'highEmphasisKeywords should be an array');
assert.ok(Array.isArray(lexiconData.comparisonKeywords), 'comparisonKeywords should be an array');
assert.ok(Array.isArray(lexiconData.revelationPhrases), 'revelationPhrases should be an array');
assert.ok(lexiconData.highEmphasisKeywords.includes('surprising'), 'lexicon should include surprising');
assert.ok(lexiconData.revelationPhrases.includes('the outcome was'), 'lexicon should include "the outcome was"');

console.log('✓ Spec #3 passed: Lexicon and stemming verified.');

// =========================================================================
// TEST 4 & 5: Configurable Monotony Score Weights & SceneChangePct TODO
// =========================================================================
console.log('Testing Spec #4 & #5: Score weights and sceneChangePct...');

assert.strictEqual(SCORE_WEIGHTS.duration, 35);
assert.strictEqual(SCORE_WEIGHTS.static, 25);
assert.strictEqual(SCORE_WEIGHTS.overlayLack, 25);
assert.strictEqual(SCORE_WEIGHTS.narrative, 15);

// Verify disruption weights ordering
assert.ok(DISRUPTION_WEIGHT.camera_movement < DISRUPTION_WEIGHT.spotlight);
assert.ok(DISRUPTION_WEIGHT.spotlight < DISRUPTION_WEIGHT.punch_in);
assert.ok(DISRUPTION_WEIGHT.punch_in < DISRUPTION_WEIGHT.text_emphasis);
assert.ok(DISRUPTION_WEIGHT.text_emphasis <= DISRUPTION_WEIGHT.stat_callout);
assert.ok(DISRUPTION_WEIGHT.stat_callout < DISRUPTION_WEIGHT.image_pip);

console.log('✓ Spec #4 & #5 passed: Score weights and disruption weights verified.');

// =========================================================================
// TEST 6: Least Disruptive Ranking for Style Presets
// =========================================================================
console.log('Testing Spec #6: Least disruptive ranking...');

const mockOptions: CandidateIntervention[] = [
  {
    type: 'punch_in',
    level: 1,
    label: 'Punch-In',
    description: 'Punch-in',
    details: 'Punch-in details',
    payload: { scale: 1.12 }
  },
  {
    type: 'spotlight',
    level: 1,
    label: 'Spotlight',
    description: 'Spotlight',
    details: 'Spotlight details',
    payload: { intensity: 0.75 }
  },
  {
    type: 'camera_movement',
    level: 1,
    label: 'Camera Push-In',
    description: 'Push-in',
    details: 'Push-in details',
    payload: { movement: 'zoom_in' }
  }
];

// For subtle style with danger context, should select camera_movement or spotlight over punch_in
const subtleDangerChoice = pickLeastDisruptive(mockOptions, ['camera_movement', 'spotlight', 'punch_in']);
assert.strictEqual(
  subtleDangerChoice.type,
  'camera_movement',
  'Subtle style should pick the gentlest intervention (camera_movement or spotlight) over punch_in'
);

const spotlightOnlyChoice = pickLeastDisruptive(
  mockOptions.filter(o => o.type !== 'camera_movement'),
  ['spotlight', 'punch_in']
);
assert.strictEqual(
  spotlightOnlyChoice.type,
  'spotlight',
  'Between spotlight and punch_in, spotlight (weight 2) must be preferred over punch_in (weight 3)'
);

console.log('✓ Spec #6 passed: Least disruptive ranking selects gentlest intervention.');

// =========================================================================
// TEST 1: Fragile Index Handling & Same-Clip Guard
// =========================================================================
console.log('Testing Spec #1: Immutable snapshot & same-clip guard...');

// Initialize 30s single clip in timelineState
const single30sClip = {
  id: 'shot_single_30s',
  startTime: 0,
  endTime: 30,
  duration: 30,
  title: 'Single 30s Narrator Shot',
  videoStartOffset: 0
};

timelineState.setClips([single30sClip]);
timelineState.setGraphics([]);

// Construct 3 candidates targeting the same 30s clip at 8s, 15s, and 22s
const candidate1: MonotonyCandidate = {
  id: 'pi_cand_8s',
  clipId: 'shot_single_30s',
  clipIndex: 0,
  timestamp: 8.0,
  stretchStart: 0,
  stretchEnd: 30,
  metrics: {
    duration: 30,
    visualChangePct: 10,
    motionPct: 10,
    sceneChangePct: 0,
    subtitleDensity: 1.5,
    narrativeImportance: 50,
    monotonyScore: 65
  },
  context: {
    verbatimPhrase: 'first point',
    triggerCategory: 'general',
    reason: 'First point'
  },
  intervention: {
    type: 'punch_in',
    level: 1,
    label: '8s Punch-In',
    description: 'Punch in',
    details: 'Punch in',
    payload: { scale: 1.12 }
  },
  alternativeInterventions: [],
  enabled: true
};

const candidate2: MonotonyCandidate = {
  id: 'pi_cand_15s',
  clipId: 'shot_single_30s',
  clipIndex: 0,
  timestamp: 15.0,
  stretchStart: 0,
  stretchEnd: 30,
  metrics: {
    duration: 30,
    visualChangePct: 5,
    motionPct: 5,
    sceneChangePct: 0,
    subtitleDensity: 2.0,
    narrativeImportance: 90,
    monotonyScore: 85 // Higher score! Should win same-clip conflict
  },
  context: {
    verbatimPhrase: 'key revelation here',
    triggerCategory: 'revelation',
    reason: 'Key turning point'
  },
  intervention: {
    type: 'punch_in',
    level: 2,
    label: '15s Punch-In',
    description: 'High impact punch in',
    details: 'High impact punch in',
    payload: { scale: 1.16 }
  },
  alternativeInterventions: [],
  enabled: true
};

const candidate3: MonotonyCandidate = {
  id: 'pi_cand_22s',
  clipId: 'shot_single_30s',
  clipIndex: 0,
  timestamp: 22.0,
  stretchStart: 0,
  stretchEnd: 30,
  metrics: {
    duration: 30,
    visualChangePct: 15,
    motionPct: 10,
    sceneChangePct: 0,
    subtitleDensity: 1.2,
    narrativeImportance: 40,
    monotonyScore: 58
  },
  context: {
    verbatimPhrase: 'final takeaway',
    triggerCategory: 'general',
    reason: 'Final takeaway'
  },
  intervention: {
    type: 'punch_in',
    level: 1,
    label: '22s Punch-In',
    description: 'Punch in',
    details: 'Punch in',
    payload: { scale: 1.12 }
  },
  alternativeInterventions: [],
  enabled: true
};

// Apply pattern interrupts
const applyResult = applyPatternInterrupts([candidate1, candidate2, candidate3]);

// Assertions for Spec 1:
// 1. appliedCount should be 1 (winner candidate2 applied)
assert.strictEqual(applyResult.appliedCount, 1, 'Only the highest-scoring candidate should be applied to the same clip');

// 2. Exactly 2 non-overlapping clip segments exist afterward (first half [0, 15] and second half [15, 30])
const resultingClips = timelineState.clips;
assert.strictEqual(resultingClips.length, 2, 'Clip should be split into exactly 2 segments');
assert.strictEqual(resultingClips[0].startTime, 0);
assert.strictEqual(resultingClips[0].endTime, 15);
assert.strictEqual(resultingClips[0].duration, 15);
assert.strictEqual(resultingClips[1].startTime, 15);
assert.strictEqual(resultingClips[1].endTime, 30);
assert.strictEqual(resultingClips[1].duration, 15);
assert.ok(resultingClips[1].cameraKeyframes, 'Second half should receive cameraKeyframes punch');

// 3. Two candidates should be in skipped array with clear reasons
assert.strictEqual(applyResult.skipped.length, 2, '2 lower-priority candidates should be recorded in skipped');
assert.ok(
  applyResult.skipped.some(s => s.id === 'pi_cand_8s'),
  'Candidate 1 should be recorded as skipped'
);
assert.ok(
  applyResult.skipped.some(s => s.id === 'pi_cand_22s'),
  'Candidate 3 should be recorded as skipped'
);

console.log('✓ Spec #1 passed: Same-clip conflict resolution, clean splitting, and no index drift.');

// =========================================================================
// TEST 2: Visibility Into Failures (Out-of-Bounds Candidate)
// =========================================================================
console.log('Testing Spec #2: Failure visibility for out-of-bounds timestamp...');

const outOfBoundsCandidate: MonotonyCandidate = {
  id: 'pi_cand_out_of_bounds',
  clipId: 'non_existent_clip',
  clipIndex: 99,
  timestamp: 99.5, // Far beyond timeline duration (30s)
  stretchStart: 90,
  stretchEnd: 100,
  metrics: {
    duration: 10,
    visualChangePct: 0,
    motionPct: 0,
    sceneChangePct: 0,
    subtitleDensity: 1.0,
    narrativeImportance: 50,
    monotonyScore: 70
  },
  context: {
    verbatimPhrase: 'phantom shot',
    triggerCategory: 'general',
    reason: 'Out of bounds test'
  },
  intervention: {
    type: 'punch_in',
    level: 1,
    label: 'Phantom Punch',
    description: 'Phantom punch',
    details: 'Phantom punch',
    payload: { scale: 1.12 }
  },
  alternativeInterventions: [],
  enabled: true
};

const oobResult = applyPatternInterrupts([outOfBoundsCandidate]);
assert.strictEqual(oobResult.appliedCount, 0, 'Out-of-bounds candidate should not be applied');
assert.strictEqual(oobResult.skipped.length, 1, 'Out-of-bounds candidate must be in skipped array');
assert.strictEqual(oobResult.skipped[0].id, 'pi_cand_out_of_bounds');
assert.ok(
  oobResult.skipped[0].reason.includes('No clip found at timestamp 99.5s'),
  `Reason should mention no clip found at timestamp, got: "${oobResult.skipped[0].reason}"`
);

console.log('✓ Spec #2 passed: Out-of-bounds candidate returned descriptive skipped reason.');

console.log('\n========================================');
console.log('ALL PATTERN INTERRUPT SPEC TESTS PASSED!');
console.log('========================================');
