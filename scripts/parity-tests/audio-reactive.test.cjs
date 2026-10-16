// Proves: cloud path (payload -> decode -> provider, NO audio buffers) draws the same pixels as the
// browser export path (real AudioBuffer, state.isExporting = true).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
dom.window.eval(fs.readFileSync(process.argv[2], 'utf8'));
const T = dom.window.__t;
const W = 640, H = 360, FPS = 30, SR = 44100, DUR = 4;

function fakeBuffer(seed) {
  const data = new Float32Array(SR * DUR);
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let i = 0; i < data.length; i++) {
    const t = i / SR, env = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 1.7);
    data[i] = (0.35 * Math.sin(2 * Math.PI * 90 * t) + 0.2 * Math.sin(2 * Math.PI * 800 * t) + 0.15 * rnd()) * env;
  }
  return { sampleRate: SR, duration: DUR, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

const graphics = [
  { id: 's1', type: 'spectrum', start: 0.5, end: 3.5, barCount: 32, style: 'bars', position: 'bottom', width: 0.7, maxHeight: 0.22, glow: true, accentColor: '#a78bfa' },
  { id: 's2', type: 'spectrum', start: 1.0, end: 3.0, barCount: 48, style: 'mirrored', position: 'center', width: 0.8, maxHeight: 0.3, glow: false, accentColor: '#22d3ee', color: '#f5c542' },
  { id: 'h1', type: 'hyperFrame', start: 0.2, end: 3.8, title: 'Reactive', html: '<div>x</div>', audioReactive: true, beatPulseScale: 0.2, musicReactiveGlow: true, position: 'center', accentColor: '#38bdf8' },
];
const frames = [6, 15, 24, 30, 45, 60, 75, 90, 105];
const mk = () => { const c = dom.window.document.createElement('canvas'); c.width = W; c.height = H; return c; };

// ---------- A) browser export path: real buffers ----------
T.timelineState.setMasterAudioBuffer(fakeBuffer(1));
T.state._bgAudioBuffer = fakeBuffer(7);
T.state.isExporting = true;
const browser = frames.map(f => { const c = mk(), ctx = c.getContext('2d'); T.drawGraphics(ctx, f / FPS, W, H, graphics); return ctx.getImageData(0, 0, W, H).data; });

// ---------- build payload exactly as cloud-render.ts does, over JSON ----------
const payload = T.buildAudioReactivePayload(graphics, FPS, DUR * FPS);
if (!payload) { console.log('FAIL: payload was null'); process.exit(1); }
const wire = JSON.parse(JSON.stringify(payload));
const bytes = JSON.stringify(wire).length;

// ---------- B) cloud path: NO buffers, provider only ----------
T.timelineState.setMasterAudioBuffer(null);
T.state._bgAudioBuffer = undefined;
T.state.isExporting = false;
T.installAudioReactive(wire);
const cloud = frames.map(f => { const c = mk(), ctx = c.getContext('2d'); T.drawGraphicsOnCanvas(ctx, f / FPS, W, H, graphics, {}); return ctx.getImageData(0, 0, W, H).data; });

// ---------- C) control: cloud path WITHOUT the payload must differ (proves the test can fail) ----------
T.installAudioReactive(null);
const control = frames.map(f => { const c = mk(), ctx = c.getContext('2d'); T.drawGraphicsOnCanvas(ctx, f / FPS, W, H, graphics, {}); return ctx.getImageData(0, 0, W, H).data; });

const cmp = (a, b) => { let bad = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 0) { bad++; if (d > max) max = d; } } return { bad, max }; };
let worst = 0, totalBad = 0, ctrlBad = 0;
frames.forEach((f, i) => { const r = cmp(browser[i], cloud[i]); totalBad += r.bad; worst = Math.max(worst, r.max); ctrlBad += cmp(browser[i], control[i]).bad > 0 ? 1 : 0; });
console.log(`payload: ${payload.ranges.length} range(s), ${(bytes / 1024).toFixed(0)} KB JSON for ${graphics.length} overlays`);
console.log(`browser vs cloud(with payload): differing channel values = ${totalBad}, max channel delta = ${worst} (0-255)`);
console.log(`control (cloud WITHOUT payload) differs from browser on ${ctrlBad}/${frames.length} frames`);

if (process.env.DEBUG_EACH) {
  for (const g of graphics) {
    T.timelineState.setMasterAudioBuffer(fakeBuffer(1)); T.state._bgAudioBuffer = fakeBuffer(7); T.state.isExporting = true;
    const b = frames.map(f => { const c = mk(), ctx = c.getContext('2d'); T.drawGraphics(ctx, f / FPS, W, H, [g]); return ctx.getImageData(0, 0, W, H).data; });
    T.timelineState.setMasterAudioBuffer(null); T.state._bgAudioBuffer = undefined; T.state.isExporting = false; T.installAudioReactive(wire);
    const cl = frames.map(f => { const c = mk(), ctx = c.getContext('2d'); T.drawGraphicsOnCanvas(ctx, f / FPS, W, H, [g], {}); return ctx.getImageData(0, 0, W, H).data; });
    let bad = 0, mx = 0; frames.forEach((f, i) => { const r = cmp(b[i], cl[i]); bad += r.bad; mx = Math.max(mx, r.max); });
    console.log('  overlay', g.id, g.type, 'bad=', bad, 'max=', mx, 'per-frame:', frames.map((f, i) => f + ':' + cmp(b[i], cl[i]).bad).join(' '));
  }
}
const ok = worst <= 2 && ctrlBad >= frames.length - 2;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
