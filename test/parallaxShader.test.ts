/**
 * Headless shader test. Uses `gl` (headless-gl, WebGL1) when installed:
 *   npm i -D gl   &&   xvfb-run -a npx tsx test/parallaxShader.test.ts
 * Skips silently when `gl` is not available so `npm test` stays green everywhere.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ParallaxRenderer, type ParallaxParams } from '../src/parallax/core';
import type { DepthField } from '../src/parallax/depthProcessing';

const require = createRequire(import.meta.url);
let createGL: any;
try { createGL = require('gl'); } catch { console.log('parallaxShader.test.ts skipped (headless gl not installed)'); process.exit(0); }

const W = 256, H = 128;
const gl = createGL(W, H, { preserveDrawingBuffer: true });
if (!gl) { console.log('parallaxShader.test.ts skipped (no GL context)'); process.exit(0); }

// ---- synthetic 512x256 scene: striped far wall + solid red near box + top-left marker
const IW = 512, IH = 256;
const rgba = new Uint8Array(IW * IH * 4);
const depth = new Uint8Array(IW * IH);
for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
  const i = (y * IW + x);
  const stripe = Math.floor(x / 16) % 2 === 0;
  let r = stripe ? 40 : 200, g = stripe ? 60 : 200, b = stripe ? 200 : 220;
  let d = 25;
  if (x > 200 && x < 312 && y > 60 && y < 200) { r = 255; g = 0; b = 0; d = 235; }     // near box
  if (x > 40 && x < 70 && y > 30 && y < 60) { r = 0; g = 255; b = 0; d = 25; }         // green marker (far)
  rgba.set([r, g, b, 255], i * 4);
  depth[i] = d;
}
const depthField: DepthField = { data: depth, width: IW, height: IH, source: 'model', focusDepth: 0.92 };
const src = { image: { data: rgba, width: IW, height: IH }, key: rgba, width: IW, height: IH };

const base = (over: Partial<ParallaxParams> = {}): ParallaxParams => ({
  fg: { x: 0.1, y: 0, w: 0.8, h: 1 }, bg: { x: 0.1, y: 0, w: 0.8, h: 1 },
  orbit: { x: 0, y: 0 }, strength: 1, focusDepth: 0.92, multi: true, roll: 0,
  blur: 0, fill: 0, haze: 0, hazeColor: [0.75, 0.8, 0.88], dust: 0, time: 0, seed: 0,
  imgAspect: IW / IH, quality: 'export', ...over,
});

const renderer = new ParallaxRenderer({ context: gl });
function frame(p: ParallaxParams): Uint8Array {
  const out = renderer.render(src, depthField, W, H, p);
  assert.ok(out, 'render returned null (shader failed to compile/link?)');
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
const at = (px: Uint8Array, x: number, y: number) => { const i = ((H - 1 - y) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
const isRed = (c: number[]) => c[0] > 200 && c[1] < 60 && c[2] < 60;
function redBounds(px: Uint8Array) {
  let minX = W, maxX = -1;
  for (let x = 0; x < W; x++) if (isRed(at(px, x, H / 2))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  return { minX, maxX };
}
function stripePhase(px: Uint8Array) { // first x (row near top) where blue->light transition happens
  for (let x = 1; x < W; x++) { const a = at(px, x - 1, 5), b = at(px, x, 5); if (a[2] > 190 && a[0] < 80 && b[0] > 150) return x; }
  return -1;
}

// 1. Compiles + renders; flat case is a plain crop (box occupies ~ (200-51)/... in screen space)
const flat = frame(base());
const rb0 = redBounds(flat);
assert.ok(rb0.maxX > rb0.minX, 'near box must be visible in flat render');

// 2. Parallax: far plane lags LEFT. The focus-plane box must stay put, the far stripes must move.
const par = frame(base({ bg: { x: 0.0, y: 0, w: 0.8, h: 1 } }));
const rb1 = redBounds(par);
assert.ok(Math.abs(rb1.minX - rb0.minX) <= 3, `near box must stay pinned (moved ${rb1.minX - rb0.minX}px)`);
assert.ok(Math.abs(rb1.maxX - rb0.maxX) <= 3, 'near box right edge must stay pinned');
const ph0 = stripePhase(flat), ph1 = stripePhase(par);
assert.notEqual(ph0, ph1, 'far stripes must shift relative to the flat render');

// 3. Occlusion: no green-ish/blue smear INSIDE the box interior
const mid = at(par, Math.round((rb1.minX + rb1.maxX) / 2), H / 2);
assert.ok(isRed(mid), 'box interior must stay red (no background bleeding through)');

// 4. Roll direction: clockwise content rotation moves the top-left green marker right & up
function greenCentroid(px: Uint8Array) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = at(px, x, y); if (c[1] > 200 && c[0] < 60 && c[2] < 60) { sx += x; sy += y; n++; } }
  return n ? { x: sx / n, y: sy / n, n } : null;
}
const g0 = greenCentroid(frame(base({ fg: { x: 0, y: 0, w: 1, h: 1 }, bg: { x: 0, y: 0, w: 1, h: 1 } })));
const g1 = greenCentroid(frame(base({ fg: { x: 0, y: 0, w: 1, h: 1 }, bg: { x: 0, y: 0, w: 1, h: 1 }, roll: 0.15 })));
assert.ok(g0 && g1, 'green marker must be visible');
assert.ok(g1!.x > g0!.x, `clockwise roll should move marker right (${g0!.x} -> ${g1!.x})`);
assert.ok(g1!.y < g0!.y, `clockwise roll should move marker up (${g0!.y} -> ${g1!.y})`);

// 5. Mirror fill: rotating must not leave transparent/black corners
const rolled = frame(base({ roll: 0.4, fg: { x: 0, y: 0, w: 1, h: 1 }, bg: { x: 0, y: 0, w: 1, h: 1 } }));
const corner = at(rolled, 0, 0);
assert.ok(corner[0] + corner[1] + corner[2] > 30, 'corner must be filled by mirrored content, not black');

// 6. DoF, haze, dust all produce finite, different output and are deterministic
const dofP = base({ blur: 1.2, fill: 0.006, haze: 0.8, dust: 1, time: 3.3 });
const a = frame(dofP), b = frame(dofP);
assert.deepEqual(Array.from(a.slice(0, 4096)), Array.from(b.slice(0, 4096)), 'same params must give identical frames');
let diff = 0; for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - flat[i]);
assert.ok(diff > 1000, 'DoF/haze/dust must visibly change the frame');
const dustA = frame(base({ dust: 1, time: 1 })), dustB = frame(base({ dust: 1, time: 2 }));
let dd = 0; for (let i = 0; i < dustA.length; i += 4) dd += Math.abs(dustA[i] - dustB[i]);
assert.ok(dd > 0, 'dust must animate with clip time');

renderer.dispose();
console.log('parallaxShader.test.ts passed');
