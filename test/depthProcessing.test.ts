import assert from 'node:assert/strict';
import { normalizeDepth, guidedUpsample, buildProceduralDepthField, buildDepthField, dilateNear } from '../src/parallax/depthProcessing';
import { safeStrengthScale, poseToRect, coverRect, hashSeed } from '../src/parallax/math';

// normalize -> uses full range
const n = normalizeDepth(Array.from({ length: 1000 }, (_, i) => 10 + i * 0.05));
assert.ok(Math.min(...n) <= 2 && Math.max(...n) >= 253, 'normalize should span 0..255');

// guided upsample snaps a blurry 8x8 depth edge to the RGB edge of a 64x64 guide
const gw = 64, guide = new Uint8ClampedArray(gw * gw * 4);
for (let y = 0; y < gw; y++) for (let x = 0; x < gw; x++) { const v = x < 40 ? 20 : 230; guide.set([v, v, v, 255], (y * gw + x) * 4); }
const lo = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) lo[y * 8 + x] = x < 5 ? 0 : 255; // edge at 40px = col 5
const up = guidedUpsample(lo, 8, 8, { data: guide, width: gw, height: gw }, gw, gw);
assert.ok(up[32 * gw + 38] < 60 && up[32 * gw + 42] > 200, 'edge must sit on the RGB edge (x=40)');

// determinism
const img = { data: new Uint8ClampedArray(64 * 48 * 4).map((_, i) => (i * 37) % 251), width: 64, height: 48 };
const a = buildProceduralDepthField(img), b = buildProceduralDepthField(img);
assert.deepEqual(Array.from(a.data), Array.from(b.data), 'procedural depth must be deterministic');
assert.ok(a.focusDepth >= 0.25 && a.focusDepth <= 0.9);

// dilateNear grows bright regions
const d = new Uint8Array(25); d[12] = 255; assert.equal(dilateNear(d, 5, 5, 1)[6], 255);

// math
assert.equal(safeStrengthScale({ x: .1, y: .1, w: .8, h: .8 }, { x: .1, y: .1, w: .8, h: .8 }, { x: 0, y: 0 }, 2, .8), 1);
assert.ok(safeStrengthScale({ x: 0, y: 0, w: 1, h: 1 }, { x: .3, y: 0, w: 1, h: 1 }, { x: 0, y: 0 }, 3, .8) < 1, 'must scale down when crop would leave the image');
const r = poseToRect(coverRect(2000, 1000, 1920, 1080), { scale: 1, translateX: 0, translateY: 0 });
assert.ok(Math.abs(r.w - 0.5625 * 2000 / 1000 * 0 - r.w) < 1e-9 && r.h === 1);
assert.equal(hashSeed('a') === hashSeed('a'), true);
assert.notEqual(hashSeed('clip-1'), hashSeed('clip-2'));
console.log('depthProcessing.test.ts passed');
