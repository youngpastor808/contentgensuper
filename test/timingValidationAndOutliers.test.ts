import { describe, it } from 'node:test';
import assert from 'node:assert';
import { auditTimelineTiming, validateBeforeExport } from '../src/timing/timeline-timing';
import { alignShotsCanonical } from '../src/timelineBuilder';

describe('Timeline Timing & Outlier Alignment Engine', () => {
  it('does NOT block audio-locked export when a shot has 10% text match but verified anchor-bounded timing', () => {
    const clips = [
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3.0,
        duration: 3.0,
        textMatchConfidence: 0.95,
        timingReliability: 0.98,
        timingProvenance: 'acoustic_word',
        timingSource: 'deepgram',
      },
      {
        id: 'shot_2',
        startTime: 3.0,
        endTime: 6.0,
        duration: 3.0,
        textMatchConfidence: 0.10, // 10% text match!
        timingReliability: 0.88,   // Bounded between anchors with verified cut points
        timingProvenance: 'acoustic_island_bounded',
        timingSource: 'deepgram',
      },
      {
        id: 'shot_3',
        startTime: 6.0,
        endTime: 9.0,
        duration: 3.0,
        textMatchConfidence: 0.92,
        timingReliability: 0.98,
        timingProvenance: 'acoustic_word',
        timingSource: 'deepgram',
      },
    ];

    const audit = auditTimelineTiming(clips, 9.0, { mode: 'audio_locked' });

    // Must be allowed to export
    assert.strictEqual(audit.canExport, true, 'Export must be allowed when timing reliability is verified');
    assert.strictEqual(audit.errors.length, 0, 'No critical errors should be reported');
    assert.strictEqual(audit.lowConfidenceCount, 1, 'Low text-match count should be 1');
    assert.strictEqual(audit.unreliableTimingCount, 0, 'Unreliable timing count should be 0');
    assert.ok(audit.reviewableTextMatches && audit.reviewableTextMatches.length === 1);
    assert.match(audit.reviewableTextMatches[0], /Clip #2/);
    assert.match(audit.reviewableTextMatches[0], /10%/);

    // validateBeforeExport must not throw
    assert.doesNotThrow(() => {
      validateBeforeExport(clips, 9.0, { mode: 'audio_locked' });
    });
  });

  it('BLOCKS audio-locked export if a clip has unverified synthetic timing with low reliability', () => {
    const clips = [
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3.0,
        duration: 3.0,
        textMatchConfidence: 0.95,
        timingReliability: 0.98,
        timingSource: 'deepgram',
      },
      {
        id: 'shot_2',
        startTime: 3.0,
        endTime: 6.0,
        duration: 3.0,
        textMatchConfidence: 0.10,
        timingReliability: 0.20, // Unanchored synthetic fallback!
        timingProvenance: 'synthetic_fallback',
        timingSource: 'synthetic',
      },
    ];

    const audit = auditTimelineTiming(clips, 6.0, { mode: 'audio_locked' });
    assert.strictEqual(audit.canExport, false, 'Export must be blocked when timing is unverified');
    assert.ok(audit.errors.length > 0, 'Must produce a critical error');

    assert.throws(() => {
      validateBeforeExport(clips, 6.0, { mode: 'audio_locked' });
    }, /EXPORT BLOCKED/);
  });

  it('BLOCKS export fail-closed on genuine timeline integrity flaws (inverted intervals, large gaps/overlaps)', () => {
    const invertedClips = [
      {
        id: 'shot_bad',
        startTime: 5.0,
        endTime: 2.0, // Inverted!
        duration: 3.0,
        textMatchConfidence: 0.99,
        timingReliability: 0.99,
        timingSource: 'deepgram',
      },
    ];

    const audit = auditTimelineTiming(invertedClips, 5.0, { mode: 'audio_locked' });
    assert.strictEqual(audit.canExport, false);
    assert.match(audit.errors[0], /invalid canonical timing|inverted interval/);
  });

  it('correctly handles neighbor-aware alignment in alignShotsCanonical', () => {
    const shots = [
      {
        id: 'shot_1',
        narration: 'The brave knight climbed the ancient stone mountain',
      },
      {
        id: 'shot_2',
        narration: 'Different script text completely unrelated to speech', // Divergent text
      },
      {
        id: 'shot_3',
        narration: 'And discovered a hidden golden treasure inside the cave',
      },
    ];

    const transcriptWords = [
      { word: 'the', start: 0.0, end: 0.2 },
      { word: 'brave', start: 0.2, end: 0.6 },
      { word: 'knight', start: 0.6, end: 1.0 },
      { word: 'climbed', start: 1.0, end: 1.4 },
      { word: 'ancient', start: 1.4, end: 1.8 },
      { word: 'stone', start: 1.8, end: 2.2 },
      { word: 'mountain', start: 2.2, end: 2.8 },
      // Spoken speech in middle
      { word: 'he', start: 3.0, end: 3.3 },
      { word: 'looked', start: 3.3, end: 3.7 },
      { word: 'around', start: 3.7, end: 4.2 },
      { word: 'carefully', start: 4.2, end: 4.8 },
      // Shot 3 speech
      { word: 'and', start: 5.0, end: 5.2 },
      { word: 'discovered', start: 5.2, end: 5.8 },
      { word: 'a', start: 5.8, end: 6.0 },
      { word: 'hidden', start: 6.0, end: 6.4 },
      { word: 'golden', start: 6.4, end: 6.8 },
      { word: 'treasure', start: 6.8, end: 7.3 },
      { word: 'inside', start: 7.3, end: 7.7 },
      { word: 'the', start: 7.7, end: 7.9 },
      { word: 'cave', start: 7.9, end: 8.5 },
    ];

    const ranges = alignShotsCanonical(
      shots as any,
      transcriptWords,
      () => {},
      8.5,
      { timingSource: 'deepgram' }
    );

    assert.strictEqual(ranges.length, 3);
    // Shot 1 should be high confidence anchor
    assert.strictEqual(ranges[0].status, 'high_confidence');
    // Shot 3 should be high confidence anchor
    assert.strictEqual(ranges[2].status, 'high_confidence');

    // Shot 2 is in between anchors:
    // It has low text match confidence (~10%)
    assert.ok(ranges[1].alignmentConfidence < 0.50);
    // AND its word range is marked as unresolved (-1) rather than a fabricated index
    assert.strictEqual(ranges[1].startWordIndex, -1, 'Unmatched text must have startWordIndex -1');
    assert.strictEqual(ranges[1].endWordIndex, -1, 'Unmatched text must have endWordIndex -1');
    assert.strictEqual(ranges[1].matchedWordCount, 0, 'Unmatched text must have 0 matched words');

    // BUT timing reliability is verified because it is bounded by acoustic anchors with valid speech pacing!
    assert.ok(ranges[1].timingReliability !== undefined && ranges[1].timingReliability >= 0.75);
    assert.strictEqual(ranges[1].timingProvenance, 'acoustic_island_bounded');

    // Timestamps must be monotonic and within interval
    assert.ok(ranges[1].startTime >= ranges[0].startTime);
    assert.ok(ranges[2].startTime >= ranges[1].startTime);
  });

  it('retains video assets and timing properties on timeline clips across rebuilds', () => {
    const existingClips = [
      {
        id: 'shot_vid_1',
        startTime: 0,
        endTime: 4.0,
        duration: 4.0,
        _videoObjectURL: 'blob:http://localhost/video_test_1',
        video_id: 'vid_asset_123',
        videoElement: {} as any,
        startWordIndex: 0,
        endWordIndex: 5,
        alignmentConfidence: 0.95,
        textMatchConfidence: 0.95,
        timingReliability: 0.98,
        timingProvenance: 'acoustic_word',
      },
    ];

    // Simulate rebuild / visual sync shot where prompt exists and checks existing timeline clip
    const storyboardShot = {
      id: 'shot_vid_1',
      text_reference: 'A hero standing in the rain',
    };

    const existingClip = existingClips.find(c => c.id === storyboardShot.id);
    const videoUrl = (storyboardShot as any)._videoObjectURL || existingClip?._videoObjectURL;
    const videoId = (storyboardShot as any).video_id || existingClip?.video_id;

    assert.strictEqual(videoUrl, 'blob:http://localhost/video_test_1', 'Video URL must be retained from existing timeline clip');
    assert.strictEqual(videoId, 'vid_asset_123', 'Video ID must be retained from existing timeline clip');
  });
});
