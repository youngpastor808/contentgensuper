import { strict as assert } from 'assert';
import { explodeToWords, buildChunks, Cue } from '../remotion/src/subtitleChunks';
import { chunkSubtitleTextTimed, chunkSubtitleText } from '../src/subtitle-chunker';

console.log('--- Running Subtitle Chunks Test Suite ---');

// Test 1: explodeToWords splits multi-word sentences into single words with character-proportional timing
{
  const sentenceCues: Cue[] = [
    { text: 'In the heart of the ancient forest, towering trees whispered secrets.', start: 0.0, end: 4.0 },
    { text: 'Sunlight pierced through the green canopy.', start: 4.5, end: 7.0 }
  ];

  const words = explodeToWords(sentenceCues);
  assert.equal(words.length, 11 + 6, 'Should explode into 17 distinct words');
  assert.equal(words[0].text, 'In');
  assert.equal(words[0].start, 0.0);
  assert.ok(words[0].end > 0.0, 'First word should have positive duration');
  assert.equal(words[10].text, 'secrets.');
  assert.ok(Math.abs(words[10].end - 4.0) < 0.05, 'End of first sentence should match cue end');
  console.log('✓ Test 1 passed: explodeToWords character-weighted timing verified.');
}

// Test 2: Word-level cues produce chunks matching chunkSubtitleTextTimed
{
  const sampleWords = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'];
  const wordTimings = sampleWords.map((w, i) => ({
    start: i * 0.4,
    end: (i + 1) * 0.4
  }));

  const inputCues: Cue[] = sampleWords.map((w, i) => ({
    text: w,
    start: wordTimings[i].start,
    end: wordTimings[i].end
  }));

  const rawChunker = chunkSubtitleTextTimed(
    sampleWords.join(' '),
    wordTimings,
    3,
    0.6,
    2.4,
    6
  );

  const remotionChunks = buildChunks(inputCues, {
    maxWords: 3,
    minDuration: 0.6,
    maxDuration: 2.4,
    maxWordsWhenMerging: 6
  });

  assert.equal(remotionChunks.length, rawChunker.length, 'Chunk counts must match exactly');
  for (let i = 0; i < remotionChunks.length; i++) {
    const rWords = remotionChunks[i].words.map(w => w.text).join(' ');
    assert.equal(rWords, rawChunker[i].text, `Chunk text at index ${i} must match`);
  }
  console.log('✓ Test 2 passed: Word-level parity with src/subtitle-chunker.ts verified.');
}

// Test 3: Sentence-level cues become bite-sized captions of at most 6 words
{
  const sentenceCues: Cue[] = [
    {
      text: 'Deep in the heart of the mountains, an explorer discovered a long forgotten ancient city made entirely of shimmering crystals and gold.',
      start: 1.0,
      end: 8.5
    }
  ];

  const chunks = buildChunks(sentenceCues);
  assert.ok(chunks.length > 1, 'Sentence must be split into multiple chunks');
  for (const chunk of chunks) {
    assert.ok(chunk.words.length <= 6, `Chunk word count (${chunk.words.length}) must not exceed 6 words`);
    assert.ok(chunk.words.length >= 1, 'Chunk must contain at least 1 word');
    assert.ok(chunk.start >= 1.0 && chunk.end <= 8.5 + 0.05, 'Chunk timestamps must stay within cue bounds');
  }
  console.log('✓ Test 3 passed: Sentence-level cues properly bounded to at most 6 words.');
}

// Test 4: Plain text / zero minDuration slicing
{
  const text = 'Alpha beta gamma delta epsilon zeta';
  const words = text.split(' ');
  const per = 3.0 / words.length;
  const chunks = buildChunks(
    words.map((w, i) => ({ text: w, start: i * per, end: (i + 1) * per })),
    { minDuration: 0 }
  );

  assert.equal(chunks.length, 2, '6 words sliced into 3-word chunks should produce 2 chunks');
  assert.equal(chunks[0].words.length, 3);
  assert.equal(chunks[1].words.length, 3);
  console.log('✓ Test 4 passed: Zero minDuration plain text slicing verified.');
}

console.log('========================================');
console.log('ALL SUBTITLE CHUNKS TESTS PASSED!');
console.log('========================================');
