/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Geometric, camera, and trajectory math for 2.5D Parallax rendering.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Internal gain: slider value 1.0 -> this many times the raw fg/bg camera lag. */
export const PARALLAX_BOOST = 2.5;

/**
 * Normalizes a source rectangle to [0, 1] relative coordinates.
 */
export function toNormRect(
  rect: { sx: number; sy: number; sWidth: number; sHeight: number },
  imgW: number,
  imgH: number
): Rect {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  return {
    x: rect.sx / w,
    y: rect.sy / h,
    w: rect.sWidth / w,
    h: rect.sHeight / h,
  };
}

/**
 * Computes Ken Burns cover rectangle (centering crop for aspect ratio match).
 */
export function coverRect(srcW: number, srcH: number, targetW: number, targetH: number): Rect {
  const srcAspect = srcW / srcH;
  const targetAspect = targetW / targetH;
  if (srcAspect > targetAspect) {
    // Source is wider than target: crop sides
    const w = targetAspect / srcAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  } else {
    // Source is taller than target: crop top/bottom
    const h = srcAspect / targetAspect;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
}

/**
 * Applies a Ken Burns scale and translation pose to a frame rectangle.
 */
export function poseToRect(
  frame: Rect,
  pose: { scale: number; translateX: number; translateY: number }
): Rect {
  const s = Math.max(0.01, pose.scale);
  const w = frame.w / s;
  const h = frame.h / s;
  const cx = frame.x + frame.w / 2 + pose.translateX * frame.w;
  const cy = frame.y + frame.h / 2 + pose.translateY * frame.h;
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
  };
}

/**
 * Calculates a safe scale multiplier [0..1] to ensure the parallax camera displacement
 * does not shift UV coordinates outside the valid source image bounds [0, 1].
 */
export function safeStrengthScale(
  fgN: Rect,
  bgN: Rect,
  orbit: Point,
  strength: number,
  focusDepth: number = 0.5
): number {
  if (strength <= 0) return 1;

  // Maximum displacement vectors in normalized image space
  const maxShiftX = Math.abs(fgN.x - bgN.x) * strength + Math.abs(orbit.x);
  const maxShiftY = Math.abs(fgN.y - bgN.y) * strength + Math.abs(orbit.y);

  // Bounds margin for foreground and background rectangles
  const minX = Math.min(fgN.x, bgN.x) - maxShiftX * (1 - focusDepth);
  const maxX = Math.max(fgN.x + fgN.w, bgN.x + bgN.w) + maxShiftX * focusDepth;
  const minY = Math.min(fgN.y, bgN.y) - maxShiftY * (1 - focusDepth);
  const maxY = Math.max(fgN.y + fgN.h, bgN.y + bgN.h) + maxShiftY * focusDepth;

  let scale = 1.0;
  if (minX < 0) scale = Math.min(scale, (Math.min(fgN.x, bgN.x)) / (maxShiftX * (1 - focusDepth) || 1));
  if (maxX > 1) scale = Math.min(scale, (1 - Math.max(fgN.x + fgN.w, bgN.x + bgN.w)) / (maxShiftX * focusDepth || 1) + 1);
  if (minY < 0) scale = Math.min(scale, (Math.min(fgN.y, bgN.y)) / (maxShiftY * (1 - focusDepth) || 1));
  if (maxY > 1) scale = Math.min(scale, (1 - Math.max(fgN.y + fgN.h, bgN.y + bgN.h)) / (maxShiftY * focusDepth || 1) + 1);

  return Math.max(0.1, Math.min(1.0, scale));
}

/**
 * Generates a deterministic pseudo-random float in [0, 1) from a string ID or seed.
 */
export function hashSeed(id?: string): number {
  if (!id) return 0.42;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  }
  return (h % 100000) / 100000;
}

/**
 * Calculates synthetic virtual camera orbit sway so even static shots or pure zooms
 * exhibit organic 3D parallax depth cues.
 */
export function orbitOffset(movement: string, progress: number, maxOrbit: number): Point {
  if (maxOrbit <= 0) return { x: 0, y: 0 };
  const t = Math.min(1, Math.max(0, progress));
  const phase = t * Math.PI * 2;

  // Gentle elliptical orbital motion
  let ox = Math.sin(phase) * 0.015 * maxOrbit;
  let oy = (Math.cos(phase) - 1.0) * 0.008 * maxOrbit;

  if (movement.includes('zoom')) {
    // Zoom sway: slight side arc
    ox = Math.sin(t * Math.PI) * 0.02 * maxOrbit;
    oy = (Math.cos(t * Math.PI) - 0.5) * 0.01 * maxOrbit;
  } else if (movement.includes('pan')) {
    // Pan sway: slight vertical wave
    oy = Math.sin(t * Math.PI * 2) * 0.015 * maxOrbit;
  }

  return { x: ox, y: oy };
}

/**
 * Dynamic rack focus interpolation over clip duration.
 */
export function rackFocus(sourceFocus: number, targetFocus: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  // Smooth cubic ease-in-out for rack focus pull
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return sourceFocus + (targetFocus - sourceFocus) * ease;
}

/**
 * Disocclusion fill factor based on camera shift intensity.
 */
export function disocclusionFill(fgN: Rect, bgN: Rect, strength: number): number {
  const shift = Math.hypot(fgN.x - bgN.x, fgN.y - bgN.y) * strength;
  return Math.min(1.0, shift * 4.0);
}
