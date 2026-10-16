/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * App-facing adapter for the 2.5D renderer. Drop-in replacement for src/webglParallax.ts:
 * same exports (drawWebGLParallax, cleanupWebGL) with extra optional arguments.
 * All GPU work lives in ./core.ts (state-free, shared with Remotion).
 */

import { state } from '../state';
import { ParallaxRenderer, type ParallaxParams } from './core';
import { ensureDepth, getDepthSync, hasModelDepth, onDepthUpgraded, prepareDepthForClips } from './depth';
import {
  PARALLAX_BOOST,
  disocclusionFill,
  hashSeed,
  orbitOffset,
  rackFocus,
  safeStrengthScale,
  toNormRect,
} from './math';

/** Depth-of-field gain: circle-of-confusion (fraction of frame height) per unit depth gap. */
const DOF_GAIN = 0.04;

let renderer: ParallaxRenderer | null = null;
const requested = new WeakSet<object>();
let depthReadyHandler: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;

export interface ParallaxExtras {
  /** Clip length in seconds - makes dust time deterministic (progress * duration). */
  clipDuration?: number;
  /** Clip id - de-correlates dust between consecutive clips. */
  clipId?: string;
  /** Explicit clip time in seconds (overrides progress * clipDuration). */
  timeSec?: number;
}

function mediaSize(m: any): { w: number; h: number } {
  return { w: m?.naturalWidth || m?.width || 0, h: m?.naturalHeight || m?.height || 0 };
}

/** Register a callback fired (once per image) when a model depth map replaces the fallback. */
export function setParallaxDepthReadyHandler(cb: (() => void) | null) {
  depthReadyHandler = cb;
  if (!unsubscribe) {
    unsubscribe = onDepthUpgraded(() => { depthReadyHandler?.(); });
  }
}

/** Precompute depth for every still in the timeline (call before export). */
export function prepareParallaxDepth(
  clips: any[] | undefined,
  onProgress?: (pct: number, msg: string) => void
) {
  if (!state.enableParallaxEffect) return Promise.resolve({ total: 0, model: 0, procedural: 0 });
  return prepareDepthForClips(clips, { source: state.parallaxDepthSource, onProgress });
}

export function drawWebGLParallax(
  image: HTMLImageElement,
  w: number, h: number,
  bg: { sx: number; sy: number; sWidth: number; sHeight: number },
  fg: { sx: number; sy: number; sWidth: number; sHeight: number },
  movement: string = 'pan_right',
  progress: number = 0.5,
  focalPoint?: { x: number; y: number },
  _speedFactor: number = 1.0,   // kept for call-site compatibility; DoF no longer depends on it
  cameraRoll: number = 0.0,
  extras: ParallaxExtras = {}
): HTMLCanvasElement | null {
  if (!renderer) renderer = new ParallaxRenderer();

  const { w: imgW, h: imgH } = mediaSize(image);
  if (!imgW || !imgH) return null;

  // --- depth ------------------------------------------------------------------------
  const depth = getDepthSync(image, focalPoint);
  if (!state.isExporting && depth.source !== 'model' && !requested.has(image) && state.parallaxDepthSource !== 'procedural') {
    requested.add(image);
    void ensureDepth(image, { focal: focalPoint, source: state.parallaxDepthSource });
  }

  // --- camera rects (normalized) ----------------------------------------------------
  const fgN = toNormRect(fg, imgW, imgH);
  const bgN = toNormRect(bg, imgW, imgH);

  const t = Math.min(1, Math.max(0, progress));
  const sourceFocus = depth.focusDepth;
  let focus = sourceFocus;
  const seed = hashSeed(extras.clipId);
  if (state.parallaxRackFocus) {
    const target = Math.min(0.9, Math.max(0.15, sourceFocus + (seed > 0.5 ? -0.3 : 0.2)));
    focus = rackFocus(sourceFocus, target, t);
  }

  const strengthSetting = Math.max(0, state.parallaxStrength ?? 1) * PARALLAX_BOOST;
  const orbit = orbitOffset(movement, t, Math.max(0, state.parallaxOrbit ?? 0.35) * (strengthSetting > 0 ? 1 : 0));
  // The pinned (parallax) plane always stays on the subject; rack focus only moves the blur plane.
  const safe = safeStrengthScale(fgN, bgN, orbit, strengthSetting, sourceFocus);
  const strength = strengthSetting * safe;

  // Depth blur / DoF is controlled by state.parallaxDepthBlur (off by default for crisp 3D parallax)
  const dofOn = Boolean(state.parallaxDepthBlur) && (state.parallaxBlurStrength ?? 0) > 0;

  const params: ParallaxParams = {
    fg: fgN,
    bg: bgN,
    orbit: { x: orbit.x * safe, y: orbit.y * safe },
    strength,
    focusDepth: sourceFocus,
    dofFocus: focus,
    multi: state.parallaxMode !== 'single_plate',
    roll: cameraRoll,
    blur: dofOn ? DOF_GAIN * Math.max(0, state.parallaxBlurStrength ?? 1) : 0,
    fill: disocclusionFill(fgN, bgN, strength),
    haze: state.parallaxHaze !== false ? Math.max(0, state.parallaxHazeAmount ?? 0.6) : 0,
    hazeColor: depth.hazeColor ?? [0.75, 0.8, 0.88],
    dust: state.parallaxDustParticles !== false ? Math.max(0, state.parallaxDustIntensity ?? 0.6) : 0,
    dustSize: state.parallaxDustSize ?? 0.5,
    dustDensity: state.parallaxDustDensity ?? 0.5,
    // Deterministic clip time: identical in preview scrubbing, browser export and cloud render.
    time: extras.timeSec ?? t * (extras.clipDuration ?? 5),
    seed,
    imgAspect: imgW / imgH,
    quality: state.isExporting ? 'export' : 'preview',
  };

  const out = renderer.render(
    { image, key: image, width: imgW, height: imgH },
    depth,
    Math.max(2, Math.round(w)),
    Math.max(2, Math.round(h)),
    params
  );
  return out instanceof HTMLCanvasElement ? out : null;
}

export function cleanupWebGL() {
  renderer?.dispose();
  renderer = null;
}

export { hasModelDepth };
