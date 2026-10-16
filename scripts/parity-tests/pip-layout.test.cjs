// Oracle test: the REAL drawPopUpBrollPipOverlay (browser) vs the pure computePipCard used by the cloud render.
// A recording ctx captures the first roundRect() (the card), globalAlpha, shadow settings and the badge rect.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
dom.window.eval(fs.readFileSync(process.argv[2], 'utf8'));
const T = dom.window.__t;

function recorder() {
  const rec = { rr: [], alpha: null, shadowBlur: null, shadowOffsetY: null, lineWidths: [] };
  const grad = { addColorStop() {} };
  const vals = {};
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'roundRect') return (x, y, w, h, r) => rec.rr.push({ x, y, w, h, r });
      if (k === 'createLinearGradient') return () => grad;
      if (k === 'canvas') return {};
      if (typeof k === 'string' && ['save','restore','beginPath','fill','stroke','clip','fillRect','drawImage','fillText','rect','translate','scale'].includes(k)) return () => {};
      return vals[k];
    },
    set(_, k, v) {
      vals[k] = v;
      if (k === 'globalAlpha' && rec.alpha === null) rec.alpha = v;
      if (k === 'shadowBlur' && rec.shadowBlur === null) rec.shadowBlur = v;
      if (k === 'shadowOffsetY' && rec.shadowOffsetY === null) rec.shadowOffsetY = v;
      if (k === 'lineWidth') rec.lineWidths.push(v);
      return true;
    },
  });
  return { ctx, rec };
}

const sizes = [[1280, 720], [1920, 1080], [1080, 1920], [3840, 2160]];
const media = [{ videoWidth: 1920, videoHeight: 1080 }, { videoWidth: 1080, videoHeight: 1920 }, { videoWidth: 1000, videoHeight: 1000 }, null];
const clipSets = [
  { pipPosition: 'top_right' }, { pipPosition: 'top_left' }, { pipPosition: 'bottom_right' }, { pipPosition: 'bottom_left' },
  { pipPosition: 'center_right' }, { pipPosition: 'center_left' },
  { pipPosition: 'custom', pipX: 0.5, pipY: 0.5 }, { pipPosition: 'custom', pipX: 0.97, pipY: 0.02, pipAnchorX: 1, pipAnchorY: 0 },
  { pipX: 0.1, pipY: 0.9, pipAnchorX: 0, pipAnchorY: 1 },
  { pipPosition: 'top_right', pipScale: 0.2 }, { pipPosition: 'top_left', pipScale: 0.5 },
];
const anims = ['pop_spring', 'slide_in', 'zoom_fade', 'fade', undefined];
const times = [0, 0.05, 0.12, 0.3, 0.39, 0.4, 1.0, 2.0, 2.7, 2.8, 2.9, 2.99];   // clip 0..3 s
let n = 0, bad = [], worst = 0;

for (const letterbox of [false, true]) for (const [cw, ch] of sizes) for (const m of media) for (const cs of clipSets) for (const anim of anims) for (const t of times) {
  T.state.cinematicLetterbox = letterbox;
  const clip = { startTime: 0, endTime: 3, duration: 3, videoElement: m ? { ...m, readyState: 4, currentTime: 0, duration: 3 } : undefined, image: m ? undefined : { width: 0, height: 0 }, pipAnimation: anim, ...cs };
  if (!m) clip.backgroundPlate = clip.image;   // media present but with unknown size -> 9/16 default
  const { ctx, rec } = recorder();
  T.drawPopUpBrollPipOverlay(ctx, clip, cw, ch, t);
  const mediaAspect = m ? m.videoHeight / m.videoWidth : undefined;
  const mine = T.computePipCard({ cw, ch, timeInClip: t, clipDur: 3, pipPosition: cs.pipPosition, pipX: cs.pipX, pipY: cs.pipY, pipAnchorX: cs.pipAnchorX, pipAnchorY: cs.pipAnchorY, pipScale: cs.pipScale, pipAnimation: anim, mediaAspect, letterbox });
  n++;
  const real = rec.rr[0];
  const label = `${cw}x${ch} lb=${letterbox} ${JSON.stringify(cs)} anim=${anim} t=${t} media=${m ? m.videoWidth + 'x' + m.videoHeight : 'none'}`;
  if (!real) { if (mine.visible) bad.push('real drew nothing but mine visible: ' + label); continue; }
  if (!mine.visible) { bad.push('mine invisible but real drew: ' + label); continue; }
  const d = Math.max(Math.abs(real.x - mine.x), Math.abs(real.y - mine.y), Math.abs(real.w - mine.w), Math.abs(real.h - mine.h), Math.abs(real.r - mine.cornerRadius), Math.abs(rec.alpha - mine.alpha), Math.abs(rec.shadowBlur - mine.shadowBlur), Math.abs(rec.shadowOffsetY - mine.shadowOffsetY), Math.abs(rec.lineWidths[0] - mine.borderWidth));
  worst = Math.max(worst, d);
  if (d > 1e-9) bad.push(`diff=${d.toFixed(4)} real=${JSON.stringify(real)} mine=${JSON.stringify({ x: mine.x, y: mine.y, w: mine.w, h: mine.h })} ${label}`);
}
console.log(`compared ${n} PiP states (sizes x media x positions x animations x times x letterbox); mismatches: ${bad.length}; worst delta: ${worst}`);
console.log(bad.slice(0, 6).join('\n'));
process.exit(bad.length ? 1 : 0);
