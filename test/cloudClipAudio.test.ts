import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildCanonicalExportPayload } from '../src/exporter/canonical-payload';
import { hasAudioStream, prepareTimelineAudioMix } from '../server/_core/audioMixer';

// 1. Test canonical export payload builder preserving useOriginalAudio & soloAudio
const testInputProps = {
    aspectRatio: '16:9',
    totalDurationSec: 10,
    clips: [
        {
            id: 'shot_1',
            startTime: 0,
            duration: 4,
            videoUrl: 'https://example.com/video1.mp4',
            useOriginalAudio: true,
            soloAudio: false,
            volume: 0.8
        },
        {
            id: 'shot_2',
            startTime: 4,
            duration: 6,
            videoUrl: 'https://example.com/video2.mp4',
            useOriginalAudio: false,
            soloAudio: true
        }
    ]
};

const payload = buildCanonicalExportPayload({ inputProps: testInputProps });
assert.strictEqual(payload.clips.length, 2);
assert.strictEqual(payload.clips[0].useOriginalAudio, true, 'Clip 1 useOriginalAudio should be true');
assert.strictEqual(payload.clips[0].soloAudio, false, 'Clip 1 soloAudio should be false');
assert.strictEqual(payload.clips[1].useOriginalAudio, true, 'Clip 2 useOriginalAudio should be true when soloAudio is true');
assert.strictEqual(payload.clips[1].soloAudio, true, 'Clip 2 soloAudio should be true');

// 2. Test hasAudioStream on a synthetic WAV and a dummy empty file
const tempWav = path.join(os.tmpdir(), `test_tone_${Date.now()}.wav`);
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-c:a', 'pcm_s16le', tempWav], { stdio: 'pipe' });

// 3. Test prepareTimelineAudioMix with synthetic master audio and clip audio
const tempMasterAudio = path.join(os.tmpdir(), `test_master_${Date.now()}.wav`);
execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'pcm_s16le', tempMasterAudio], { stdio: 'pipe' });

const tempClipVideo = path.join(os.tmpdir(), `test_clip_video_${Date.now()}.mp4`);
execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    tempClipVideo
], { stdio: 'pipe' });

async function runMixerTest() {
    assert.strictEqual(await hasAudioStream(tempWav), true, 'Synthetic tone should have audio stream');
    assert.strictEqual(await hasAudioStream('/non/existent/file.wav'), false, 'Non-existent file should return false');

    const inputPropsWithAudio = {
        totalDurationSec: 6,
        masterAudioUrl: tempMasterAudio,
        clips: [
            {
                id: 'clip_with_sound',
                startTime: 2,
                duration: 3,
                videoUrl: tempClipVideo,
                useOriginalAudio: true,
                volume: 0.9,
                videoStartOffset: 0
            }
        ]
    };

    const { finalAudioPath, cleanupPaths } = await prepareTimelineAudioMix(inputPropsWithAudio, 'http://127.0.0.1:3000');
    assert.ok(finalAudioPath, 'Final audio path should be generated');
    assert.ok(fs.existsSync(finalAudioPath), 'Final mixed audio file should exist on disk');
    assert.ok(fs.statSync(finalAudioPath).size > 100, 'Final mixed audio file should not be empty');
    assert.strictEqual(await hasAudioStream(finalAudioPath), true, 'Final audio file should have valid audio stream');

    // Clean up test files
    for (const p of cleanupPaths) {
        try { fs.unlinkSync(p); } catch {}
    }
    try { fs.unlinkSync(tempWav); } catch {}
    try { fs.unlinkSync(tempMasterAudio); } catch {}
    try { fs.unlinkSync(tempClipVideo); } catch {}

    console.log('All cloudClipAudio test cases passed successfully!');
}

runMixerTest().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
