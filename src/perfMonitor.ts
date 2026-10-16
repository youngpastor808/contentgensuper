type Stat = { n: number; total: number; max: number };
const stats = new Map<string, Stat>();
let enabled = false;
try { enabled = localStorage.getItem('cg_perf') === '1'; } catch {}
let longTasks = 0;
let longTaskMs = 0;
let hud: HTMLDivElement | null = null;
let hudTimer = 0;

export const perfOn = () => enabled;
export const t0 = () => (enabled ? performance.now() : 0);
export function t1(name: string, start: number) {
  if (!enabled) return;
  const d = performance.now() - start;
  const s = stats.get(name) || { n: 0, total: 0, max: 0 };
  s.n++; s.total += d; if (d > s.max) s.max = d;
  stats.set(name, s);
}

export function tv(name: string, ms: number) {
  if (!enabled) return;
  const s = stats.get(name) || { n: 0, total: 0, max: 0 };
  s.n++; s.total += ms; if (ms > s.max) s.max = ms;
  stats.set(name, s);
}

export function setPerf(on: boolean) {
  enabled = on;
  try { localStorage.setItem('cg_perf', on ? '1' : '0'); } catch {}
  if (on) startHud(); else stopHud();
}

function estCanvasMB() {
  let px = 0;
  document.querySelectorAll('canvas').forEach(c => { px += (c as HTMLCanvasElement).width * (c as HTMLCanvasElement).height; });
  return (px * 4) / 1048576;
}

function startHud() {
  if (hud) return;
  hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;background:rgba(0,0,0,.8);color:#9f9;font:11px monospace;padding:6px 8px;border-radius:6px;white-space:pre;pointer-events:none';
  document.body.appendChild(hud);
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
  hudTimer = window.setInterval(() => {
    if (!hud) return;
    const lines: string[] = [];
    stats.forEach((s, k) => lines.push(`${k.padEnd(22)} avg ${(s.total / s.n).toFixed(2)}ms  max ${s.max.toFixed(1)}ms  n=${s.n}`));
    lines.push(`longtasks ${longTasks} (${longTaskMs.toFixed(0)}ms)`);
    lines.push(`video elements ${document.querySelectorAll('video').length}  canvas ~${estCanvasMB().toFixed(0)}MB`);
    const mem = (performance as any).memory;
    if (mem) lines.push(`js heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB`);
    hud.textContent = lines.join('\n');
    stats.clear(); longTasks = 0; longTaskMs = 0;
  }, 1000);
}

function stopHud() {
  if (hudTimer) {
    clearInterval(hudTimer);
    hudTimer = 0;
  }
  hud?.remove();
  hud = null;
}

window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p') setPerf(!enabled);
});

if (enabled) {
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', startHud);
    } else {
      startHud();
    }
  }
}
