const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const vc = new VirtualConsole(); const errs = [];
vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.detail?.message || e.message)));
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/', virtualConsole: vc, pretendToBeVisual: true, resources: 'usable' });
dom.window.eval(fs.readFileSync(process.argv[2], 'utf8'));
const W = 960, H = 540;
const mk = () => { const c = dom.window.document.createElement('canvas'); c.width = W; c.height = H; return c; };
const base = { start: 0, end: 5, accentColor: '#F5C542' };
const EV = {
  lowerThird:     { type: 'lowerThird', title: 'Breaking News Title', subtitle: 'Subtitle here', position: 'left', theme: 'neon' },
  titleCard:      { type: 'titleCard', title: 'Big Title', subtitle: 'Sub', backdrop: 'none', theme: 'minimal' },
  iconOverlay:    { type: 'iconOverlay', icon: 'star', title: 'Star', position: 'center', theme: 'corporate' },
  bulletPanel:    { type: 'bulletPanel', title: 'Points', bullets: ['One', 'Two', 'Three'], position: 'left', theme: 'corporate' },
  evidenceBoard:  { type: 'evidenceBoard', title: 'Board', items: [{ label: 'A' }, { label: 'B' }], theme: 'minimal' },
  revealRoute:    { type: 'revealRoute', title: 'Route', nodes: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], theme: 'minimal' },
  statCounter:    { type: 'statCounter', title: 'Users', targetValue: 1200, suffix: '+', trend: 'up', theme: 'corporate' },
  spotlightFocus: { type: 'spotlightFocus', title: 'Look', focusX: 0.5, focusY: 0.5, theme: 'minimal' },
  socialBadge:    { type: 'socialBadge', platform: 'youtube', handle: '@channel', title: 'Subscribe', theme: 'corporate' },
  versusCard:     { type: 'versusCard', leftTitle: 'A', leftPoints: ['x'], rightTitle: 'B', rightPoints: ['y'], theme: 'corporate' },
  donutChart:     { type: 'donutChart', chartMode: 'percentage', percentage: 70, centerLabel: '70%', theme: 'corporate' },
  spectrum:       { type: 'spectrum', barCount: 32, style: 'bars', position: 'bottom', width: 0.7, maxHeight: 0.22, glow: true, accentColor: '#a78bfa' },
};
function render(ev) {
  const c = mk(); const ctx = c.getContext('2d'); ctx.clearRect(0, 0, W, H);
  try { dom.window.__draw(ctx, 2.5, W, H, [{ id: 't', ...base, ...ev }], {}); } catch (e) { return { err: e.message }; }
  const d = ctx.getImageData(0, 0, W, H).data; let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) { const p = i / 4; n++; sx += p % W; sy += Math.floor(p / W); }
  return { n, cx: n ? Math.round(sx / n) : -1, cy: n ? Math.round(sy / n) : -1, data: d };
}
const diff = (a, b) => { let k = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i+1] !== b.data[i+1] || a.data[i+2] !== b.data[i+2] || a.data[i+3] !== b.data[i+3]) k++; return k; };
console.log('type'.padEnd(15), 'drawn?'.padEnd(9), 'default centroid'.padEnd(18), 'after drag (0.25,0.30) centroid'.padEnd(34), 'moved?'.padEnd(7), 'scale1.5 changes?');
for (const [name, ev] of Object.entries(EV)) {
  const d0 = render(ev);
  if (d0.err) { console.log(name.padEnd(15), 'ERROR', d0.err); continue; }
  const d1 = render({ ...ev, position: 'custom', customX: 0.25, customY: 0.30, ...(name==='spotlightFocus'?{focusX:0.25,focusY:0.30}:{}) });
  const d2 = render({ ...ev, scale: 1.5 });
  console.log(name.padEnd(15), String(d0.n > 0).padEnd(9), `${d0.cx},${d0.cy}`.padEnd(18), `${d1.cx},${d1.cy}`.padEnd(34), String(Math.abs(d1.cx - d0.cx) + Math.abs(d1.cy - d0.cy) > 20).padEnd(7), diff(d0, d2) > 0);
}
console.log(errs.slice(0, 3).join('\n') || '(no jsdom errors)');
