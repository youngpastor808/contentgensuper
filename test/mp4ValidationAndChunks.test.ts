import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { probeMp4, faststartMp4 } from '../server/routes/cloudRender';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-mp4-test-'));

try {
  // 1. Corrupt/truncated MP4 (empty or arbitrary bytes)
  const corruptFile = path.join(testDir, 'corrupt.mp4');
  fs.writeFileSync(corruptFile, Buffer.from('not an mp4 file'));
  assert.equal(probeMp4(corruptFile), false, 'Corrupt file should fail probeMp4');

  // 2. Truncated moov header
  const truncatedFile = path.join(testDir, 'truncated.mp4');
  fs.writeFileSync(truncatedFile, Buffer.alloc(5000, 0));
  assert.equal(probeMp4(truncatedFile), false, 'Zero-filled dummy should fail probeMp4');

  // 3. Generate a real minimal 1-second test MP4 using ffmpeg
  const validFile = path.join(testDir, 'valid.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=blue:s=320x240:d=1',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    validFile
  ], { stdio: 'pipe' });

  assert.equal(fs.existsSync(validFile), true, 'Valid file created');
  assert.equal(probeMp4(validFile), true, 'Valid MP4 should pass probeMp4');

  // 4. Test faststartMp4
  const faststartFile = path.join(testDir, 'faststart.mp4');
  faststartMp4(validFile, faststartFile);
  assert.equal(fs.existsSync(faststartFile), true, 'Faststart file created');
  assert.equal(probeMp4(faststartFile), true, 'Faststarted MP4 should pass probeMp4');

  // 5. Test simulating truncation on a valid MP4 (missing moov atom)
  const validBytes = fs.readFileSync(validFile);
  const truncatedRealFile = path.join(testDir, 'real_truncated.mp4');
  // Write only the first half of the MP4
  fs.writeFileSync(truncatedRealFile, validBytes.subarray(0, Math.floor(validBytes.length / 2)));
  assert.equal(probeMp4(truncatedRealFile), false, 'Truncated real MP4 must fail probeMp4 (moov atom missing)');

  console.log('mp4ValidationAndChunks.test.ts passed all tests!');
} finally {
  fs.rmSync(testDir, { recursive: true, force: true });
}
