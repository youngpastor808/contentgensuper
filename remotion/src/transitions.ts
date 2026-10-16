import type React from 'react';
import { random } from 'remotion';

export const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// Steep editorial whip curve: slow wind-up, fast snap across the cut, smooth settle
export const whipCurve = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};

export function normalizeTransition(t?: string): string {
  const n = (t || 'cut').replace(/[_\-\s]/g, '').toLowerCase();
  const alias: Record<string, string> = {
    fadeblack: 'fadetoblack',
    fadewhite: 'fadetowhite',
    whitepop: 'flash',
    rgbsplit: 'glitch',
    rotate: 'spin',
    circlewipe: 'iris',
    fade: 'crossdissolve',
    crossfade: 'crossdissolve',
    dissolve: 'crossdissolve',
  };
  return alias[n] || n;
}

// Curated editorial mix: favors clean dissolves, optical zoom-throughs, and whip-pushes
const RANDOM_MIX = [
  'cross_dissolve',
  'cross_dissolve',
  'zoom_dissolve',
  'push',
  'blur_dissolve',
  'fade_to_black',
];

export function resolveClipTransition(
  clipTransition: string | undefined,
  style: string | undefined,
  clipId?: string
): string {
  let t = clipTransition || 'cut';
  const s = style || 'narrative_guided';
  if (s === 'random_mix') {
    const hash = (clipId || '').split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    t = RANDOM_MIX[hash % RANDOM_MIX.length];
  } else if (s !== 'narrative_guided' && s !== 'ai_directed') {
    t = s;
  }
  return t;
}

export interface TransitionFrame {
  out: React.CSSProperties;
  inn: React.CSSProperties;
  overlay?: { color: string; opacity: number };
}

export function getTransitionFrame(
  type: string,
  t: number,
  w: number,
  h: number,
  seedFrame = 0
): TransitionFrame {
  const e = smoothstep(t);
  const wEase = whipCurve(t);
  const velocityPeak = Math.sin(Math.min(1, Math.max(0, t)) * Math.PI); // 0 -> 1 -> 0 at midpoint
  const hide: React.CSSProperties = { opacity: 0 };
  const pct = (v: number) => `${v * 100}%`;

  switch (type) {
    case 'fadetoblack':
      return e < 0.5
        ? { out: { opacity: 1 - e / 0.5 }, inn: hide, overlay: { color: '#000000', opacity: e / 0.5 } }
        : { out: hide, inn: { opacity: (e - 0.5) / 0.5 }, overlay: { color: '#000000', opacity: 1 - (e - 0.5) / 0.5 } };
    case 'fadetowhite':
      return e < 0.5
        ? { out: { opacity: 1 - e / 0.5 }, inn: hide, overlay: { color: '#ffffff', opacity: e / 0.5 } }
        : { out: hide, inn: { opacity: (e - 0.5) / 0.5 }, overlay: { color: '#ffffff', opacity: 1 - (e - 0.5) / 0.5 } };
    case 'flash': {
      // Exponential film flash decay (fast attack, warm cinematic tail)
      const flashAlpha = t < 0.35 ? (t / 0.35) * 0.92 : Math.pow(1 - (t - 0.35) / 0.65, 2.2) * 0.92;
      return t < 0.35
        ? { out: { filter: `brightness(${1 + velocityPeak * 0.6})` }, inn: hide, overlay: { color: '#fffaf0', opacity: flashAlpha } }
        : { out: hide, inn: { filter: `brightness(${1 + velocityPeak * 0.4})` }, overlay: { color: '#fffaf0', opacity: flashAlpha } };
    }
    case 'zoomdissolve': {
      // Continuous forward optical flow: outgoing zooms in (1.0 -> 1.26), incoming emerges from (0.84 -> 1.0)
      const blurPx = (velocityPeak * 6).toFixed(2);
      return {
        out: {
          opacity: 1 - wEase,
          transform: `scale(${(1 + wEase * 0.26).toFixed(4)})`,
          filter: velocityPeak > 0.1 ? `blur(${blurPx}px)` : undefined,
        },
        inn: {
          opacity: wEase,
          transform: `scale(${(0.84 + wEase * 0.16).toFixed(4)})`,
          filter: velocityPeak > 0.1 ? `blur(${blurPx}px)` : undefined,
        },
      };
    }
    case 'blurdissolve': {
      const b = (velocityPeak * 14).toFixed(2);
      return {
        out: { opacity: 1 - e, filter: `blur(${b}px)`, transform: `scale(${1 + e * 0.04})` },
        inn: { opacity: e, filter: `blur(${b}px)`, transform: `scale(${1.04 - e * 0.04})` },
      };
    }
    case 'swipeleft':
      return {
        out: { clipPath: `inset(0 0 0 ${pct(wEase)})` },
        inn: { clipPath: `inset(0 ${pct(1 - wEase)} 0 0)` },
      };
    case 'swiperight':
      return {
        out: { clipPath: `inset(0 ${pct(wEase)} 0 0)` },
        inn: { clipPath: `inset(0 0 0 ${pct(1 - wEase)})` },
      };
    case 'swipeup':
      return {
        out: { clipPath: `inset(${pct(wEase)} 0 0 0)` },
        inn: { clipPath: `inset(0 0 ${pct(1 - wEase)} 0)` },
      };
    case 'swipedown':
      return {
        out: { clipPath: `inset(0 0 ${pct(wEase)} 0)` },
        inn: { clipPath: `inset(${pct(1 - wEase)} 0 0 0)` },
      };
    case 'wipe':
      return {
        out: {},
        inn: { clipPath: `inset(0 ${pct(1 - wEase)} 0 0)` },
      };
    case 'push': {
      // Whip-pan push with velocity-proportional blur and subtle horizontal stretch
      const whipBlur = (velocityPeak * 10).toFixed(2);
      const stretch = (1 + velocityPeak * 0.04).toFixed(3);
      return {
        out: {
          transform: `translateX(${-wEase * 100}%) scaleX(${stretch})`,
          filter: velocityPeak > 0.1 ? `blur(${whipBlur}px)` : undefined,
        },
        inn: {
          transform: `translateX(${(1 - wEase) * 100}%) scaleX(${stretch})`,
          filter: velocityPeak > 0.1 ? `blur(${whipBlur}px)` : undefined,
        },
      };
    }
    case 'iris': {
      const r = e * Math.hypot(w / 2, h / 2);
      return {
        out: {},
        inn: { clipPath: `circle(${r}px at 50% 50%)` },
      };
    }
    case 'spin':
      return {
        out: {
          opacity: Math.max(0, 1 - e * 1.5),
          transform: `rotate(${e * 90}deg) scale(${1 - e * 0.4})`,
        },
        inn: {
          opacity: Math.min(1, e * 1.5),
          transform: `rotate(${-(1 - e) * 90}deg) scale(${0.6 + e * 0.4})`,
        },
      };
    case 'glitch': {
      const jitterFactor = velocityPeak;
      const randOffset = (random(`glitch-${seedFrame}`) - 0.5) * 30 * jitterFactor;
      return {
        out: {
          opacity: 1 - e,
          transform: `translateX(${randOffset}px) skewX(${randOffset * 0.2}deg)`,
          filter: jitterFactor > 0.3 ? `hue-rotate(${randOffset * 10}deg)` : undefined,
        },
        inn: {
          opacity: e,
          transform: `translateX(${-randOffset}px)`,
        },
      };
    }
    case 'crossdissolve':
    default:
      return { out: { opacity: 1 - e }, inn: { opacity: e } };
  }
}
