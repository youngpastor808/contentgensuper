/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HyperFrames Engine — Video-as-Code Motion Graphics Core.
 * Inspired by HeyGen HyperFrames (https://github.com/heygen-com/hyperframes)
 * 
 * Features:
 * 1. Paused-and-Seekable Frame Adapter pattern (deterministic timecode progression).
 * 2. Declarative HTML/Tailwind CSS overlay compositions with data timing (data-start, data-duration).
 * 3. High-performance live DOM overlay player with sub-pixel CSS transforms.
 * 4. Deterministic Canvas rasterization fallback for MP4/WebM export.
 * 5. Launch templates library inspired by `hyperframes-launches`.
 */

import { LRUCache } from './lru-cache';
import type { GraphicTheme } from './graphics-engine';
import { state } from './state';
import { timelineState } from './state-timeline';
import * as utils from './utils';
import { audioSynthesizer, type ProceduralSfxType } from './audioSynthesizer';
import { getAudioReactiveProvider } from './audio-reactive-provider';

export type HyperFrameAnimIn = 
  | 'fade-up' 
  | 'slide-left' 
  | 'scale-pop' 
  | 'spring-bounce' 
  | 'blur-in' 
  | 'flip-x' 
  | 'typewriter';

export type HyperFrameAnimOut = 
  | 'fade-down' 
  | 'slide-right' 
  | 'scale-down' 
  | 'blur-out';

export type HyperFramePosition = 
  | 'center' 
  | 'bottom' 
  | 'top' 
  | 'bottom-left' 
  | 'bottom-right' 
  | 'top-left' 
  | 'top-right' 
  | 'custom';

export type HyperFrameSfxType = ProceduralSfxType;

export interface AudioEnergySample {
  rms: number;       // 0..1 overall loudness
  bass: number;      // 0..1 low frequency (20-150Hz kick/sub)
  mid: number;       // 0..1 mid frequencies (vocals/synth)
  beatPulse: number; // 0..1 transient beat onset (spikes on drum kicks)
}

export interface HyperFrameEvent {
  id: string;
  type: 'hyperFrame';
  start: number;
  end: number;
  title: string;
  subtitle?: string;
  presetId?: string;
  templateId?: string;
  html: string;
  css?: string;
  animationType?: string;
  animationIn?: HyperFrameAnimIn;
  animationOut?: HyperFrameAnimOut;
  position?: HyperFramePosition;
  customX?: number; // 0..1
  customY?: number; // 0..1
  scale?: number;   // 0.2..3.0
  accentColor?: string;
  textColor?: string;
  theme?: GraphicTheme;
  clipId?: string;
  offsetInClip?: number;
  audioReactive?: boolean;
  beatPulseScale?: number;
  musicReactiveGlow?: boolean;
  sfxTrigger?: HyperFrameSfxType;
  rasterUrl?: string;
  rasterWidth?: number;
  rasterHeight?: number;
}

export interface HyperFramePreset {
  id: string;
  name: string;
  category: 'launch' | 'minimal' | 'social' | 'cinematic' | 'stats' | 'music';
  description: string;
  defaultDuration: number;
  animationIn: HyperFrameAnimIn;
  animationOut: HyperFrameAnimOut;
  position: HyperFramePosition;
  accentColor: string;
  textColor: string;
  html: string;
  css?: string;
  audioReactive?: boolean;
  beatPulseScale?: number;
  musicReactiveGlow?: boolean;
  sfxTrigger?: HyperFrameSfxType;
}

export const HYPERFRAME_PRESETS: HyperFramePreset[] = [
  {
    id: 'launch-hero',
    name: '🚀 Product Launch Card',
    category: 'launch',
    description: 'Glassmorphism card with live pulse indicator, gradient title, and feature badges.',
    defaultDuration: 5.0,
    animationIn: 'spring-bounce',
    animationOut: 'scale-down',
    position: 'bottom',
    accentColor: '#38bdf8',
    textColor: '#ffffff',
    html: `
<div class="px-5 py-4 rounded-2xl bg-slate-950/85 backdrop-blur-xl border border-sky-500/30 shadow-[0_0_35px_rgba(56,189,248,0.25)] flex flex-col gap-2 max-w-md text-left">
  <div class="flex items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <span class="relative flex h-2.5 w-2.5">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
      </span>
      <span class="text-[11px] font-bold tracking-widest uppercase text-sky-400 font-mono">PRODUCT LAUNCH</span>
    </div>
    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">V2.0 LIVE</span>
  </div>
  <h2 class="text-xl sm:text-2xl font-black tracking-tight text-white leading-tight">
    Next-Gen <span class="bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">Deterministic Video</span>
  </h2>
  <p class="text-xs text-slate-300 leading-relaxed font-sans">
    Pixel-perfect timing driven by code and AI storyboards.
  </p>
  <div class="flex items-center gap-2 pt-1 border-t border-white/10 text-[11px] text-slate-400 font-medium">
    <span class="flex items-center gap-1"><span class="text-sky-400">✦</span> 4K Master</span>
    <span class="text-white/20">•</span>
    <span class="flex items-center gap-1"><span class="text-emerald-400">✓</span> Frame Accurate</span>
    <span class="text-white/20">•</span>
    <span class="flex items-center gap-1"><span class="text-purple-400">⚡</span> Zero Render Drops</span>
  </div>
</div>`
  },
  {
    id: 'apple-feature',
    name: '✨ Minimal Feature Tag',
    category: 'minimal',
    description: 'High-contrast monochrome card with precision typography and metallic accent.',
    defaultDuration: 4.5,
    animationIn: 'fade-up',
    animationOut: 'fade-down',
    position: 'bottom-left',
    accentColor: '#f8fafc',
    textColor: '#ffffff',
    sfxTrigger: 'pop',
    html: `
<div class="px-5 py-3.5 rounded-xl bg-black/90 backdrop-blur-md border border-white/20 shadow-2xl flex items-center gap-3.5 max-w-sm text-left">
  <div class="w-10 h-10 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-white text-lg shrink-0">
    ⚡
  </div>
  <div class="flex flex-col">
    <span class="text-[10px] font-semibold tracking-wider uppercase text-zinc-400">Engine Architecture</span>
    <h3 class="text-base font-bold text-white tracking-tight">HyperFrames Runtime</h3>
    <span class="text-[11px] text-zinc-400">Seekable deterministic audio-locked sync</span>
  </div>
</div>`
  },
  {
    id: 'reels-hook',
    name: '⚡ Viral Kinetic Hook',
    category: 'social',
    description: 'High-energy TikTok / Reels hook pill with punchy accent box and elastic spring.',
    defaultDuration: 3.5,
    animationIn: 'scale-pop',
    animationOut: 'scale-down',
    position: 'center',
    accentColor: '#facc15',
    textColor: '#000000',
    sfxTrigger: 'hit',
    html: `
<div class="flex flex-col items-center gap-1.5 text-center drop-shadow-[0_10px_25px_rgba(0,0,0,0.8)]">
  <span class="px-3.5 py-1 rounded-full bg-black/90 border border-yellow-400/40 text-yellow-300 text-xs font-mono font-bold tracking-widest uppercase">
    DON'T SCROLL PAST THIS
  </span>
  <div class="px-6 py-2.5 rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 text-black font-black text-2xl sm:text-3xl tracking-tight shadow-xl uppercase transform -rotate-1">
    THIS CHANGES EVERYTHING 🤯
  </div>
</div>`
  },
  {
    id: 'stat-metric',
    name: '📈 Live Growth Metric',
    category: 'stats',
    description: 'Sleek analytics callout with animated trend pill and highlight counter.',
    defaultDuration: 5.0,
    animationIn: 'spring-bounce',
    animationOut: 'blur-out',
    position: 'top-right',
    accentColor: '#10b981',
    textColor: '#ffffff',
    sfxTrigger: 'ping',
    html: `
<div class="px-4 py-3 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.2)] flex items-center gap-3.5 min-w-[220px]">
  <div class="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-lg shrink-0">
    ▲
  </div>
  <div class="flex flex-col text-left">
    <div class="flex items-center gap-1.5">
      <span class="text-xl sm:text-2xl font-black text-white tracking-tight">+420%</span>
      <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">MoM</span>
    </div>
    <span class="text-[11px] text-zinc-400 font-medium">Audience Retention Rate</span>
  </div>
</div>`
  },
  {
    id: 'cinematic-act',
    name: '🎬 Cinematic Scene Title',
    category: 'cinematic',
    description: 'Letterbox title card with roman numeral chaptering and expanding gold accent line.',
    defaultDuration: 5.0,
    animationIn: 'fade-up',
    animationOut: 'fade-down',
    position: 'center',
    accentColor: '#eab308',
    textColor: '#ffffff',
    sfxTrigger: 'chord',
    html: `
<div class="flex flex-col items-center justify-center text-center max-w-lg px-6">
  <span class="text-[11px] font-mono tracking-[0.3em] uppercase text-yellow-500/90 mb-1">ACT II // THE TURNING POINT</span>
  <h1 class="text-2xl sm:text-4xl font-serif font-normal tracking-wider text-white uppercase mb-2">
    The Unseen Threshold
  </h1>
  <div class="w-32 h-[1px] bg-gradient-to-r from-transparent via-yellow-500 to-transparent mb-2"></div>
  <p class="text-xs font-serif italic text-zinc-300 tracking-wide max-w-md">
    "Every sequence begins with an instinct, but endures through discipline."
  </p>
</div>`
  },
  {
    id: 'versus-battle',
    name: '⚔️ Versus Comparison Card',
    category: 'launch',
    description: 'Split dual-card comparing the old tedious way vs the automated AI workflow.',
    defaultDuration: 5.5,
    animationIn: 'spring-bounce',
    animationOut: 'scale-down',
    position: 'bottom',
    accentColor: '#6366f1',
    textColor: '#ffffff',
    sfxTrigger: 'impact',
    html: `
<div class="flex items-center gap-2 sm:gap-4 p-3 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-white/10 shadow-2xl max-w-lg">
  <div class="flex-1 p-2.5 rounded-xl bg-red-950/30 border border-red-500/20 text-left">
    <span class="text-[9px] font-bold text-red-400 uppercase tracking-widest font-mono">OLD WAY</span>
    <p class="text-xs font-semibold text-white/90 mt-0.5">Hours of manual keyframing & canvas code</p>
  </div>
  <div class="px-2 py-1 rounded-full bg-indigo-600 text-white font-black text-xs shadow-lg uppercase tracking-wider shrink-0">
    VS
  </div>
  <div class="flex-1 p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-left">
    <span class="text-[9px] font-bold text-indigo-400 uppercase tracking-widest font-mono">HYPERFRAMES</span>
    <p class="text-xs font-semibold text-white mt-0.5">Semantic HTML + AI instant deterministic video</p>
  </div>
</div>`
  },
  {
    id: 'creator-chime',
    name: '🔔 Creator Follow Callout',
    category: 'social',
    description: 'Floating channel badge with avatar, handle, verified badge, and animated bell chime.',
    defaultDuration: 4.5,
    animationIn: 'slide-left',
    animationOut: 'slide-right',
    position: 'bottom-right',
    accentColor: '#ef4444',
    textColor: '#ffffff',
    sfxTrigger: 'pop',
    html: `
<div class="px-4 py-2.5 rounded-2xl bg-zinc-900/90 backdrop-blur-md border border-white/10 shadow-2xl flex items-center gap-3">
  <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-rose-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
    🎬
  </div>
  <div class="flex flex-col text-left">
    <div class="flex items-center gap-1">
      <span class="text-xs font-bold text-white">@StoryStudioPro</span>
      <span class="text-sky-400 text-[11px]" title="Verified">✓</span>
    </div>
    <span class="text-[10px] text-zinc-400">Subscribe for weekly breakdown</span>
  </div>
  <div class="px-2.5 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold tracking-wide shadow flex items-center gap-1 ml-1 cursor-pointer">
    <span>🔔</span> Subscribe
  </div>
</div>`
  },
  {
    id: 'music-eq-card',
    name: '🎵 Now Playing & Reactive EQ',
    category: 'music',
    description: 'Sleek audio player card with live EQ bars reacting directly to the music track and spinning vinyl disc.',
    defaultDuration: 5.5,
    animationIn: 'spring-bounce',
    animationOut: 'scale-down',
    position: 'bottom-left',
    accentColor: '#a855f7',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.08,
    musicReactiveGlow: true,
    sfxTrigger: 'cyber_chime',
    html: `
<div class="px-5 py-3.5 rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-violet-500/40 shadow-[0_0_35px_rgba(168,85,247,0.3)] flex items-center gap-4 max-w-md text-left">
  <div class="relative w-12 h-12 rounded-full bg-gradient-to-tr from-violet-600 to-fuchsia-500 flex items-center justify-center text-white text-xl shadow-lg shrink-0 hf-disc-spin">
    💿
    <div class="absolute w-3.5 h-3.5 rounded-full bg-zinc-950 border border-white/40"></div>
  </div>
  <div class="flex-1 min-w-0">
    <div class="flex items-center justify-between gap-2">
      <span class="text-[10px] font-mono tracking-widest uppercase text-violet-400 font-bold">LIVE MUSIC SYNC</span>
      <div class="flex items-end gap-1 h-4">
        <span class="w-1 bg-violet-400 rounded-full hf-eq-bar-1 transition-all" style="height: 10px;"></span>
        <span class="w-1 bg-fuchsia-400 rounded-full hf-eq-bar-2 transition-all" style="height: 14px;"></span>
        <span class="w-1 bg-pink-400 rounded-full hf-eq-bar-3 transition-all" style="height: 16px;"></span>
        <span class="w-1 bg-violet-300 rounded-full hf-eq-bar-4 transition-all" style="height: 12px;"></span>
        <span class="w-1 bg-indigo-400 rounded-full hf-eq-bar-5 transition-all" style="height: 8px;"></span>
      </div>
    </div>
    <h3 class="text-sm font-black text-white truncate tracking-tight mt-0.5">HyperFrames Soundscape</h3>
    <p class="text-[11px] text-zinc-400 truncate">Audio-reactive motion synthesis</p>
  </div>
</div>`
  },
  {
    id: 'bass-pulse-hero',
    name: '💥 Bass-Reactive Drop Card',
    category: 'music',
    description: 'High-energy badge with glowing neon aura that micro-punches and glows on every kick/bass drop.',
    defaultDuration: 5.0,
    animationIn: 'scale-pop',
    animationOut: 'blur-out',
    position: 'center',
    accentColor: '#f59e0b',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.14,
    musicReactiveGlow: true,
    sfxTrigger: 'bass_drop',
    html: `
<div class="px-6 py-4 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-amber-400/50 shadow-[0_0_40px_rgba(245,158,11,0.35)] flex flex-col gap-2 max-w-md text-center">
  <div class="flex items-center justify-center gap-2">
    <span class="text-amber-400 text-xs font-mono font-bold tracking-widest uppercase">⚡ AUDIO REACTIVE BASS LOCK</span>
  </div>
  <h2 class="text-2xl font-black uppercase tracking-tight text-white leading-tight">
    PULSE TO THE <span class="text-amber-400">RHYTHM</span>
  </h2>
  <p class="text-xs text-amber-200/80 font-sans">
    Micro-punches and dynamic aura on every kick drum transient.
  </p>
</div>`
  },
  {
    id: 'soundwave-ribbon',
    name: '🌊 Kinetic Waveform Ribbon',
    category: 'music',
    description: 'Futuristic audio waveform ribbon with reactive neon glow locked to master narration & music.',
    defaultDuration: 4.5,
    animationIn: 'fade-up',
    animationOut: 'fade-down',
    position: 'bottom',
    accentColor: '#06b6d4',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.06,
    musicReactiveGlow: true,
    sfxTrigger: 'whoosh',
    html: `
<div class="px-5 py-2.5 rounded-full bg-black/85 backdrop-blur-md border border-cyan-400/50 shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center gap-3">
  <span class="text-cyan-400 text-sm">🎙️</span>
  <div class="flex items-end gap-1 h-4">
    <span class="w-1 bg-cyan-400 rounded-full hf-eq-bar-1 transition-all" style="height: 8px;"></span>
    <span class="w-1 bg-cyan-300 rounded-full hf-eq-bar-2 transition-all" style="height: 14px;"></span>
    <span class="w-1 bg-sky-400 rounded-full hf-eq-bar-3 transition-all" style="height: 18px;"></span>
    <span class="w-1 bg-teal-400 rounded-full hf-eq-bar-4 transition-all" style="height: 12px;"></span>
    <span class="w-1 bg-cyan-200 rounded-full hf-eq-bar-5 transition-all" style="height: 8px;"></span>
  </div>
  <span class="text-xs font-mono text-cyan-200 font-bold uppercase tracking-wider">LIVE NARRATION & MUSIC SYNC</span>
</div>`
  },
  {
    id: 'flash-sale',
    name: '⚡ Flash Sale Countdown',
    category: 'launch',
    description: 'Urgency badge with live ticking countdown and promo coupon.',
    defaultDuration: 5.0,
    animationIn: 'spring-bounce',
    animationOut: 'scale-down',
    position: 'bottom',
    accentColor: '#f43f5e',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.08,
    musicReactiveGlow: true,
    sfxTrigger: 'impact',
    html: `
<div class="px-5 py-3 rounded-2xl bg-zinc-950/95 backdrop-blur-xl border border-rose-500/50 shadow-[0_0_35px_rgba(244,63,94,0.35)] flex items-center gap-3.5 max-w-md text-left">
  <div class="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 font-black text-xl shrink-0">
    ⚡
  </div>
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-mono font-black tracking-widest text-rose-400 uppercase">LIMITED TIME DEAL</span>
      <span class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">ENDS TODAY</span>
    </div>
    <div class="flex items-center gap-2 mt-0.5">
      <span class="text-base font-black text-white tracking-tight">SAVE 60% OFF</span>
      <span class="text-xs font-mono px-2 py-0.5 rounded bg-white/10 text-rose-200 border border-white/20 font-bold">CODE: VIP60</span>
    </div>
  </div>
</div>`
  },
  {
    id: 'trust-reviews',
    name: '⭐ 5-Star Social Proof',
    category: 'social',
    description: 'Verified buyer stars, review count, and trust guarantee pill.',
    defaultDuration: 4.5,
    animationIn: 'fade-up',
    animationOut: 'fade-down',
    position: 'bottom-left',
    accentColor: '#fbbf24',
    textColor: '#ffffff',
    audioReactive: false,
    sfxTrigger: 'cyber_chime',
    html: `
<div class="px-4 py-2.5 rounded-2xl bg-zinc-900/90 backdrop-blur-md border border-amber-400/40 shadow-2xl flex items-center gap-3">
  <div class="flex text-amber-400 text-sm tracking-tight">
    ★★★★★
  </div>
  <div class="flex flex-col text-left">
    <div class="flex items-center gap-1.5">
      <span class="text-xs font-black text-white">4.9 / 5.0</span>
      <span class="text-[10px] text-zinc-400 font-medium">(14,200+ Reviews)</span>
    </div>
    <span class="text-[9px] text-emerald-400 font-semibold flex items-center gap-1">
      <span>✓</span> Verified Buyers • 30-Day Guarantee
    </span>
  </div>
</div>`
  },
  {
    id: 'ecommerce-cta',
    name: '🛒 Shop Now & Free Shipping',
    category: 'launch',
    description: 'High-converting e-commerce call to action with pulsing button.',
    defaultDuration: 5.0,
    animationIn: 'spring-bounce',
    animationOut: 'scale-down',
    position: 'bottom',
    accentColor: '#10b981',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.1,
    musicReactiveGlow: true,
    sfxTrigger: 'whoosh',
    html: `
<div class="px-5 py-3 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-emerald-500/40 shadow-[0_0_35px_rgba(16,185,129,0.3)] flex items-center justify-between gap-4 max-w-md">
  <div class="flex flex-col text-left">
    <span class="text-[10px] font-mono uppercase font-bold text-emerald-400 tracking-wider">OFFICIAL STORE</span>
    <span class="text-sm font-black text-white">Free Express Shipping</span>
  </div>
  <div class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-black text-xs tracking-wider uppercase shadow-lg flex items-center gap-1.5 cursor-pointer">
    <span>Shop Now</span>
    <span>→</span>
  </div>
</div>`
  },
  {
    id: 'price-slash',
    name: '🔥 Discount Price Slash',
    category: 'stats',
    description: 'Striked-through regular price with bold discount savings badge.',
    defaultDuration: 4.5,
    animationIn: 'scale-pop',
    animationOut: 'scale-down',
    position: 'bottom-right',
    accentColor: '#f97316',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.12,
    musicReactiveGlow: true,
    sfxTrigger: 'impact',
    html: `
<div class="px-4 py-3 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-orange-500/40 shadow-[0_0_30px_rgba(249,115,22,0.3)] flex items-center gap-3">
  <div class="flex flex-col text-left">
    <span class="text-[10px] text-zinc-400 line-through font-mono">$149.00</span>
    <span class="text-2xl font-black text-white tracking-tight">$49</span>
  </div>
  <div class="px-2.5 py-1 rounded-lg bg-orange-500 text-black font-black text-xs uppercase tracking-wider">
    SAVE 67%
  </div>
</div>`
  },
  {
    id: 'pattern-wait',
    name: '😱 Pattern Interrupt: Wait For It',
    category: 'social',
    description: 'Elastic bouncing viral hook to halt scrolling immediately.',
    defaultDuration: 3.5,
    animationIn: 'spring-bounce',
    animationOut: 'blur-out',
    position: 'center',
    accentColor: '#a855f7',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.15,
    musicReactiveGlow: true,
    sfxTrigger: 'bass_drop',
    html: `
<div class="flex flex-col items-center gap-2 text-center drop-shadow-[0_15px_30px_rgba(0,0,0,0.9)]">
  <span class="px-3.5 py-1 rounded-full bg-violet-950/90 border border-violet-400/50 text-violet-300 text-xs font-mono font-bold tracking-widest uppercase">
    ⚠️ STOP SCROLLING
  </span>
  <div class="px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600 text-white font-black text-2xl sm:text-3xl tracking-tight shadow-2xl uppercase transform -rotate-1 border border-white/20">
    WAIT FOR THE END 😱
  </div>
</div>`
  },
  {
    id: 'pattern-mistake',
    name: '❌ Pattern Interrupt: Stop Doing This',
    category: 'social',
    description: 'High-contrast red warning callout for counter-intuitive tips.',
    defaultDuration: 3.5,
    animationIn: 'scale-pop',
    animationOut: 'scale-down',
    position: 'center',
    accentColor: '#ef4444',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.12,
    musicReactiveGlow: true,
    sfxTrigger: 'impact',
    html: `
<div class="flex flex-col items-center gap-2 text-center drop-shadow-[0_16px_36px_rgba(0,0,0,0.9)] select-none">
  <div class="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white font-black text-xl sm:text-2xl tracking-tight uppercase shadow-2xl flex items-center gap-2 transform -rotate-1 border border-white/25">
    <span class="text-lg">❌</span>
    <span>THE #1 BIGGEST MISTAKE</span>
  </div>
  <span class="px-4 py-1 rounded-full bg-black/90 backdrop-blur-md border border-red-500/40 text-red-200 text-xs font-semibold tracking-wide shadow-xl">
    99% of creators get this completely wrong
  </span>
</div>`
  },
  {
    id: 'podcast-speaker',
    name: '🎙️ Active Host / Speaker Pill',
    category: 'music',
    description: 'Avatar with audio-reactive glowing ring when voice is active.',
    defaultDuration: 5.0,
    animationIn: 'slide-left',
    animationOut: 'slide-right',
    position: 'top-left',
    accentColor: '#38bdf8',
    textColor: '#ffffff',
    audioReactive: true,
    beatPulseScale: 0.05,
    musicReactiveGlow: true,
    sfxTrigger: 'cyber_chime',
    html: `
<div class="px-3.5 py-2 rounded-full bg-slate-950/90 backdrop-blur-md border border-sky-400/40 shadow-xl flex items-center gap-2.5">
  <div class="relative w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/60 flex items-center justify-center text-white text-sm font-bold">
    🎙️
    <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-zinc-950 animate-pulse"></span>
  </div>
  <div class="flex flex-col text-left pr-2">
    <span class="text-xs font-bold text-white leading-tight">Host Discussion</span>
    <span class="text-[9px] font-mono text-sky-400 font-semibold uppercase">Speaking Now</span>
  </div>
</div>`
  }
];

// --- Deterministic Easing Calculations ---
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const springElastic = (t: number) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

// Canvas raster cache for export frames
interface CachedRasterItem {
  img: HTMLImageElement;
  loaded: boolean;
  timestamp: number;
}
const rasterCache = new LRUCache<string, CachedRasterItem>(35, () => {});

/**
 * HyperFrames Engine Core
 */
export class HyperFramesEngine {
  private static overlayContainer: HTMLDivElement | null = null;
  private static activeNodes = new Map<string, HTMLDivElement>();
  private static lastSeekTime = -1;
  private static playedSfxSet = new Set<string>();

  /**
   * Samples audio energy deterministically from both background music and master narration.
   * Works identically in live preview, scrubbing, and frame-by-frame export!
   */
  public static getAudioEnergyAtTime(time: number): AudioEnergySample {
    const provider = getAudioReactiveProvider();
    if (provider) {
      const sample = provider.getEnergy(time);
      if (sample) return sample;
    }

    let rms = 0;
    let bass = 0;
    let mid = 0;
    let beatPulse = 0;

    const bgBuf = (typeof window !== 'undefined' && state._bgAudioBuffer) || null;
    const masterBuf = (typeof window !== 'undefined' && timelineState.masterAudioBuffer) || null;

    const sampleBuffer = (buf: AudioBuffer, weight = 1.0) => {
      const sr = buf.sampleRate;
      const chData = buf.getChannelData(0);
      const center = Math.floor(time * sr);
      const win = 1024;
      const start = Math.max(0, center - Math.floor(win / 2));
      const end = Math.min(chData.length, center + Math.floor(win / 2));
      if (end <= start) return;

      let sumSq = 0;
      let lowEnergy = 0;
      let midEnergy = 0;
      let prevVal = chData[start] || 0;

      for (let i = start; i < end; i++) {
        const val = chData[i];
        sumSq += val * val;
        const diff = Math.abs(val - prevVal);
        lowEnergy += Math.abs(val) * Math.max(0, 1 - diff * 2.5);
        midEnergy += diff;
        prevVal = val;
      }

      const count = end - start;
      const curRms = Math.min(1, Math.sqrt(sumSq / count) * 3.2);
      const curBass = Math.min(1, (lowEnergy / count) * 4.5);
      const curMid = Math.min(1, (midEnergy / count) * 3.5);

      rms = Math.max(rms, curRms * weight);
      bass = Math.max(bass, curBass * weight);
      mid = Math.max(mid, curMid * weight);
    };

    if (bgBuf) sampleBuffer(bgBuf, 1.2);
    if (masterBuf) sampleBuffer(masterBuf, 0.9);

    if (bgBuf || masterBuf) {
      const priorTime = Math.max(0, time - 0.06);
      let priorBass = 0;
      const samplePrior = (buf: AudioBuffer) => {
        const sr = buf.sampleRate;
        const chData = buf.getChannelData(0);
        const center = Math.floor(priorTime * sr);
        const win = 512;
        const start = Math.max(0, center - Math.floor(win / 2));
        const end = Math.min(chData.length, center + Math.floor(win / 2));
        if (end <= start) return;
        let lowEnergy = 0;
        let prevVal = chData[start] || 0;
        for (let i = start; i < end; i++) {
          const val = chData[i];
          const diff = Math.abs(val - prevVal);
          lowEnergy += Math.abs(val) * Math.max(0, 1 - diff * 2.5);
          prevVal = val;
        }
        priorBass = Math.max(priorBass, Math.min(1, (lowEnergy / (end - start)) * 4.5));
      };
      if (bgBuf) samplePrior(bgBuf);
      if (masterBuf) samplePrior(masterBuf);

      const delta = Math.max(0, bass - priorBass);
      beatPulse = Math.min(1, delta * 3.5 + bass * 0.4);
    } else {
      // Synthetic rhythm fallback if no audio uploaded yet (120 BPM tempo)
      const bpm = 120;
      const beatDur = 60 / bpm;
      const phase = (time % beatDur) / beatDur;
      beatPulse = Math.max(0, 1 - phase * 3.5);
      rms = 0.25 + 0.15 * Math.sin(time * 3);
      bass = beatPulse * 0.7 + 0.2;
      mid = 0.3 + 0.2 * Math.cos(time * 4);
    }

    return { rms, bass, mid, beatPulse };
  }

  /**
   * Synthesizes punchy Web Audio procedural sound effects on the fly
   * with zero external audio assets or network latency!
   */
  public static playProceduralSfx(type: HyperFrameSfxType, volume = 0.5, freq = 440): void {
    audioSynthesizer.playSfx(type, volume, freq);
  }

  /**
   * Initializes or binds to the DOM overlay container `#hyperframes-overlay-layer`
   */
  public static initDOM(container?: HTMLDivElement | null): HTMLDivElement | null {
    if (typeof document === 'undefined') return null;
    if (container) {
      this.overlayContainer = container;
      return container;
    }
    let el = document.getElementById('hyperframes-overlay-layer') as HTMLDivElement | null;
    if (!el) {
      const previewWrapper = document.getElementById('video-preview-wrapper');
      if (previewWrapper) {
        el = document.createElement('div');
        el.id = 'hyperframes-overlay-layer';
        el.className = 'absolute inset-0 pointer-events-none z-15 overflow-hidden w-full h-full select-none';
        previewWrapper.appendChild(el);
      }
    }
    this.overlayContainer = el;
    return el;
  }

  /**
   * Evaluates the paused-and-seekable timeline state for all HyperFrame clips at `time`.
   * Drives the DOM overlay container synchronously for sub-pixel 60fps playback or scrubbing.
   */
  public static seek(time: number, events: any[]): void {
    if (typeof document === 'undefined') return;
    const container = this.overlayContainer || this.initDOM();
    if (!container) return;

    this.lastSeekTime = time;
    const energy = this.getAudioEnergyAtTime(time);

    // Filter hyperFrame events
    const hyperEvents: HyperFrameEvent[] = (events || []).filter(
      (ev): ev is HyperFrameEvent => ev && ev.type === 'hyperFrame'
    );

    const activeIds = new Set<string>();

    for (const ev of hyperEvents) {
      const dur = Math.max(0.05, ev.end - ev.start);
      const isVisible = time >= ev.start && time <= ev.end;

      if (!isVisible) {
        this.playedSfxSet.delete(ev.id);
        continue;
      }

      activeIds.add(ev.id);
      const localTime = Math.max(0, time - ev.start);
      const inDur = Math.min(0.5, dur * 0.35);
      const outDur = Math.min(0.4, dur * 0.35);

      const inProgress = clamp01(localTime / inDur);
      const outProgress = clamp01((ev.end - time) / outDur);

      // Trigger entrance procedural sound effects
      if (ev.sfxTrigger && ev.sfxTrigger !== 'none' && state.isVideoPlaying && !state.isExporting) {
        if (localTime >= 0 && localTime < 0.12 && !this.playedSfxSet.has(ev.id)) {
          this.playedSfxSet.add(ev.id);
          this.playProceduralSfx(ev.sfxTrigger);
        }
      }

      // Get or create node in overlay container
      let node = this.activeNodes.get(ev.id);
      if (!node || !container.contains(node)) {
        node = document.createElement('div');
        node.id = `hf-clip-${ev.id}`;
        node.className = 'absolute transition-none pointer-events-none will-change-transform max-w-[92%] box-border flex items-center justify-center';
        node.innerHTML = ev.html;
        container.appendChild(node);
        this.activeNodes.set(ev.id, node);
      }

      // Compute style transforms based on animationIn, animationOut, and audio reactivity
      // Responsive scale factor: on narrower viewports (like vertical 9:16 preview), dynamically scale down
      const containerW = container.clientWidth || 360;
      const responsiveScale = containerW < 520 ? Math.min(1.0, Math.max(0.42, (containerW * 0.88) / 380)) : 1.0;
      const baseScale = (ev.scale || 1.0) * responsiveScale;
      const beatMultiplier = ev.audioReactive ? (1 + energy.beatPulse * (ev.beatPulseScale || 0.08)) : 1.0;
      const scale = baseScale * beatMultiplier;

      const pos = ev.position || 'bottom';
      let anchorTranslate = '';
      if (pos === 'center' || pos === 'custom') {
        anchorTranslate = 'translate(-50%, -50%)';
      } else if (pos === 'top' || pos === 'bottom') {
        anchorTranslate = 'translateX(-50%)';
      }

      let animTransform = '';
      let opacity = 1.0;
      let filter = '';

      if (ev.musicReactiveGlow) {
        const glowRadius = Math.round(10 + energy.bass * 28);
        const glowColor = ev.accentColor || '#38bdf8';
        filter += `drop-shadow(0 0 ${glowRadius}px ${glowColor}) `;
      }

      if (inProgress < 1.0) {
        // Entering phase
        const anim = ev.animationIn || 'spring-bounce';
        opacity = inProgress;

        if (anim === 'spring-bounce') {
          const eased = springElastic(inProgress);
          animTransform = `scale(${eased * scale}) translateY(${(1 - inProgress) * 20}px)`;
        } else if (anim === 'fade-up') {
          const eased = easeOutCubic(inProgress);
          animTransform = `translateY(${(1 - eased) * 40}px) scale(${scale})`;
        } else if (anim === 'slide-left') {
          const eased = easeOutCubic(inProgress);
          animTransform = `translateX(${(1 - eased) * 80}px) scale(${scale})`;
        } else if (anim === 'scale-pop') {
          const eased = easeOutBack(inProgress);
          animTransform = `scale(${eased * scale})`;
        } else if (anim === 'blur-in') {
          const eased = easeOutCubic(inProgress);
          filter += `blur(${(1 - eased) * 12}px) `;
          animTransform = `scale(${scale})`;
        } else if (anim === 'flip-x') {
          const eased = easeOutCubic(inProgress);
          animTransform = `perspective(800px) rotateX(${(1 - eased) * 75}deg) scale(${scale})`;
        } else {
          animTransform = `scale(${scale})`;
        }
      } else if (outProgress < 1.0) {
        // Exiting phase
        const anim = ev.animationOut || 'scale-down';
        opacity = outProgress;

        if (anim === 'scale-down') {
          const eased = 1 - easeOutCubic(1 - outProgress);
          animTransform = `scale(${eased * scale})`;
        } else if (anim === 'fade-down') {
          const eased = 1 - easeOutCubic(1 - outProgress);
          animTransform = `translateY(${(1 - eased) * 35}px) scale(${scale})`;
        } else if (anim === 'slide-right') {
          const eased = 1 - easeOutCubic(1 - outProgress);
          animTransform = `translateX(${(1 - eased) * 70}px) scale(${scale})`;
        } else if (anim === 'blur-out') {
          const eased = 1 - easeOutCubic(1 - outProgress);
          filter += `blur(${(1 - eased) * 12}px) `;
          animTransform = `scale(${scale})`;
        } else {
          animTransform = `scale(${scale})`;
        }
      } else {
        // Steady state
        animTransform = `scale(${scale})`;
        opacity = 1.0;
      }

      // Update dynamic audio-reactive EQ elements inside the DOM card
      const eqBars = node.querySelectorAll<HTMLElement>('.hf-eq-bar-1, .hf-eq-bar-2, .hf-eq-bar-3, .hf-eq-bar-4, .hf-eq-bar-5');
      if (eqBars.length > 0) {
        const heights = [
          Math.max(3, energy.bass * 18),
          Math.max(4, energy.mid * 20),
          Math.max(3, energy.rms * 24),
          Math.max(4, energy.mid * 16),
          Math.max(3, energy.bass * 17)
        ];
        eqBars.forEach((bar, idx) => {
          bar.style.height = `${Math.round(heights[idx] || 8)}px`;
        });
      }

      const disc = node.querySelector<HTMLElement>('.hf-disc-spin');
      if (disc) {
        disc.style.transform = `rotate(${Math.round((time * 160) % 360)}deg)`;
      }

      // Apply positioning
      this.applyNodePositioning(node, ev);

      // Apply computed matrix and visual styles
      node.style.transform = `${anchorTranslate} ${animTransform}`.trim();
      node.style.opacity = String(opacity);
      node.style.filter = filter.trim();
      node.style.display = 'block';
    }

    // Clean up inactive nodes
    for (const [id, node] of this.activeNodes.entries()) {
      if (!activeIds.has(id)) {
        node.style.display = 'none';
      }
    }
  }

  /**
   * Helper to set CSS positioning based on preset position anchor or custom coords
   */
  private static applyNodePositioning(node: HTMLElement, ev: HyperFrameEvent) {
    const pos = ev.position || 'bottom';
    
    // Clear previously set position styles
    node.style.top = '';
    node.style.bottom = '';
    node.style.left = '';
    node.style.right = '';
    node.style.maxWidth = '92%';
    node.style.boxSizing = 'border-box';
    node.style.transformOrigin = 'center center';

    if (pos === 'custom' && ev.customX !== undefined && ev.customY !== undefined) {
      node.style.left = `${ev.customX * 100}%`;
      node.style.top = `${ev.customY * 100}%`;
      node.style.transformOrigin = 'center center';
      return;
    }

    switch (pos) {
      case 'center':
        node.style.top = '50%';
        node.style.left = '50%';
        node.style.transformOrigin = 'center center';
        break;
      case 'top':
        node.style.top = '8%';
        node.style.left = '50%';
        node.style.transformOrigin = 'top center';
        break;
      case 'bottom':
        node.style.bottom = '10%';
        node.style.left = '50%';
        node.style.transformOrigin = 'bottom center';
        break;
      case 'top-left':
        node.style.top = '8%';
        node.style.left = '4%';
        node.style.transformOrigin = 'top left';
        break;
      case 'top-right':
        node.style.top = '8%';
        node.style.right = '4%';
        node.style.transformOrigin = 'top right';
        break;
      case 'bottom-left':
        node.style.bottom = '10%';
        node.style.left = '4%';
        node.style.transformOrigin = 'bottom left';
        break;
      case 'bottom-right':
        node.style.bottom = '10%';
        node.style.right = '4%';
        node.style.transformOrigin = 'bottom right';
        break;
    }
  }

  /**
   * Draws the HyperFrame onto the export canvas context deterministically.
   * Uses SVG foreignObject image rendering with cached image bitmap when available,
   * falling back to a structured Canvas 2D card so frame rendering never breaks.
   */
  public static drawToCanvas(
    ctx: CanvasRenderingContext2D,
    ev: HyperFrameEvent,
    alpha: number,
    appear: number,
    cvW: number,
    cvH: number,
    time: number
  ): void {
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = alpha;

    const isVertical = cvW < cvH;
    const energy = this.getAudioEnergyAtTime(time);
    const baseScale = ev.scale || 1.0;
    const beatMultiplier = ev.audioReactive ? (1 + energy.beatPulse * (ev.beatPulseScale || 0.08)) : 1.0;
    const sc = baseScale * beatMultiplier * (isVertical ? (cvW / 720) * 0.65 : (cvW / 1280));
    const pos = ev.position || 'bottom';

    let cx = cvW / 2;
    let cy = cvH * (isVertical ? 0.84 : 0.82);

    if (pos === 'custom' && ev.customX !== undefined && ev.customY !== undefined) {
      cx = ev.customX * cvW;
      cy = ev.customY * cvH;
    } else if (pos === 'center') {
      cx = cvW / 2;
      cy = cvH / 2;
    } else if (pos === 'top') {
      cx = cvW / 2;
      cy = cvH * (isVertical ? 0.14 : 0.16);
    } else if (pos === 'bottom-left') {
      cx = isVertical ? cvW * 0.35 : cvW * 0.22;
      cy = cvH * (isVertical ? 0.84 : 0.82);
    } else if (pos === 'bottom-right') {
      cx = isVertical ? cvW * 0.65 : cvW * 0.78;
      cy = cvH * (isVertical ? 0.84 : 0.82);
    } else if (pos === 'top-left') {
      cx = isVertical ? cvW * 0.35 : cvW * 0.22;
      cy = cvH * (isVertical ? 0.14 : 0.16);
    } else if (pos === 'top-right') {
      cx = isVertical ? cvW * 0.65 : cvW * 0.78;
      cy = cvH * (isVertical ? 0.14 : 0.16);
    }

    // Try rendering via SVG foreignObject cache
    const cacheKey = `${ev.id}_${cvW}x${cvH}_${ev.html.length}`;
    const cached = rasterCache.get(cacheKey);

    if (cached && cached.loaded && cached.img) {
      const iw = cached.img.naturalWidth || 420;
      const ih = cached.img.naturalHeight || 160;
      const drawW = iw * sc;
      const drawH = ih * sc;

      ctx.translate(cx, cy);
      if (appear < 1.0) {
        ctx.scale(appear, appear);
      }
      ctx.drawImage(cached.img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      return;
    }

    // If raster isn't cached yet, initiate background SVG render
    if (!cached && typeof Image !== 'undefined') {
      this.rasterizeSvg(ev, cvW, cvH, cacheKey);
    }

    // Fallback: draw high-fidelity stylized Canvas 2D card with theme styling and audio reactivity
    this.drawCanvasFallbackCard(ctx, ev, cx, cy, sc, appear, energy);
    ctx.restore();
  }

  /**
   * Pre-warms the SVG foreignObject raster for a HyperFrame up-front.
   * Uses the identical cache key to drawToCanvas so the very first frame renders the full raster.
   */
  public static async prewarmRaster(ev: HyperFrameEvent, cvW: number, cvH: number): Promise<void> {
    if (!ev || !ev.html || typeof Image === 'undefined') return;
    const cacheKey = `${ev.id}_${cvW}x${cvH}_${ev.html.length}`;
    const cached = rasterCache.get(cacheKey);
    if (cached && cached.loaded) return;

    return new Promise<void>((resolve) => {
      try {
        const cardW = 540;
        const cardH = 220;
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
      ${ev.html}
    </div>
  </foreignObject>
</svg>`;
        const img = new Image();
        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const item: CachedRasterItem = { img, loaded: false, timestamp: Date.now() };
        rasterCache.set(cacheKey, item);

        const done = () => {
          item.loaded = true;
          try { URL.revokeObjectURL(url); } catch {}
          resolve();
        };
        img.onload = done;
        img.onerror = () => {
          try { URL.revokeObjectURL(url); } catch {}
          resolve();
        };
        img.src = url;
      } catch {
        resolve();
      }
    });
  }

  /**
   * Asynchronously converts HTML snippet into SVG foreignObject image for canvas exports
   */
  private static rasterizeSvg(ev: HyperFrameEvent, cvW: number, cvH: number, cacheKey: string) {
    try {
      const cardW = 540;
      const cardH = 220;
      const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
      ${ev.html}
    </div>
  </foreignObject>
</svg>`;
      const img = new Image();
      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const item: CachedRasterItem = { img, loaded: false, timestamp: Date.now() };
      rasterCache.set(cacheKey, item);

      img.onload = () => {
        item.loaded = true;
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch (e) {
      // SVG foreignObject rasterization not permitted in this context; fallback card handles it
    }
  }

  /**
   * High-fidelity Canvas 2D fallback renderer for HyperFrame cards
   */
  private static drawCanvasFallbackCard(
    ctx: CanvasRenderingContext2D,
    ev: HyperFrameEvent,
    cx: number,
    cy: number,
    sc: number,
    appear: number,
    energy?: AudioEnergySample
  ) {
    const cardW = 460 * sc;
    const cardH = 140 * sc;
    const x = cx - cardW / 2;
    const y = cy - cardH / 2;
    const radius = 16 * sc;
    const accent = ev.accentColor || '#38bdf8';

    ctx.save();
    if (appear < 1.0) {
      ctx.translate(cx, cy);
      ctx.scale(appear, appear);
      ctx.translate(-cx, -cy);
    }

    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 24 * sc;
    ctx.shadowOffsetY = 8 * sc;

    // Card Background
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, radius);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
    ctx.fill();

    // Border with reactive glow
    if (ev.musicReactiveGlow && energy) {
      ctx.shadowColor = accent;
      ctx.shadowBlur = (14 + energy.bass * 28) * sc;
      ctx.lineWidth = (1.5 + energy.bass * 1.5) * sc;
    } else {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12 * sc;
      ctx.lineWidth = 1.5 * sc;
    }
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Accent Pill
    const pillX = x + 20 * sc;
    const pillY = y + 16 * sc;
    const pillH = 18 * sc;
    const pillW = 100 * sc;

    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1 * sc;
    ctx.stroke();

    ctx.font = `bold ${9 * sc}px monospace`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ev.audioReactive ? '🎵 AUDIO SYNC' : 'HYPERFRAMES', pillX + pillW / 2, pillY + pillH / 2);

    // Dynamic Equalizer Bars in Fallback Card
    if (ev.audioReactive && energy) {
      const eqX = x + cardW - 65 * sc;
      const eqY = y + 26 * sc;
      const barCount = 5;
      const barW = 4 * sc;
      const heights = [
        Math.max(4, energy.bass * 20 * sc),
        Math.max(5, energy.mid * 24 * sc),
        Math.max(4, energy.rms * 26 * sc),
        Math.max(5, energy.mid * 18 * sc),
        Math.max(4, energy.bass * 19 * sc)
      ];
      ctx.fillStyle = accent;
      for (let i = 0; i < barCount; i++) {
        const bh = heights[i] || (8 * sc);
        ctx.beginPath();
        ctx.roundRect(eqX + i * 7 * sc, eqY - bh / 2, barW, bh, 2 * sc);
        ctx.fill();
      }
    }

    // Title
    ctx.font = `bold ${18 * sc}px "Montserrat", -apple-system, sans-serif`;
    ctx.fillStyle = ev.textColor || '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleText = ev.title || 'Interactive Composition';
    ctx.fillText(titleText, x + 20 * sc, y + 46 * sc, cardW - 40 * sc);

    // Subtitle / Prompt excerpt
    ctx.font = `normal ${11 * sc}px -apple-system, sans-serif`;
    ctx.fillStyle = '#94a3b8';
    const subText = 'Deterministic code-driven motion overlay layer';
    ctx.fillText(subText, x + 20 * sc, y + 76 * sc, cardW - 40 * sc);

    // Footer divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1 * sc;
    ctx.beginPath();
    ctx.moveTo(x + 20 * sc, y + 102 * sc);
    ctx.lineTo(x + cardW - 20 * sc, y + 102 * sc);
    ctx.stroke();

    // Footer tags
    ctx.font = `600 ${9 * sc}px monospace`;
    ctx.fillStyle = accent;
    ctx.fillText('⚡ 60FPS SEEKABLE', x + 20 * sc, y + 114 * sc);

    ctx.fillStyle = '#64748b';
    ctx.fillText('• DETERMINISTIC MP4', x + 150 * sc, y + 114 * sc);

    ctx.restore();
  }

  /**
   * Helper to clean up active DOM overlay elements
   */
  public static clear(): void {
    if (this.overlayContainer) {
      this.overlayContainer.innerHTML = '';
    }
    this.activeNodes.clear();
    rasterCache.clear();
  }
}
