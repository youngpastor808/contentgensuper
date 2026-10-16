/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Remotion ParallaxImage Component:
 * GPU-accelerated 2.5D depth parallax renderer using WebGL and the shared ParallaxRenderer.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { delayRender, continueRender, interpolate, useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { CameraKeyframesConfig } from './types';
import { ParallaxRenderer, type ParallaxParams } from '../../src/parallax/core';
import { buildProceduralDepthField, type DepthField } from '../../src/parallax/depthProcessing';
import {
  PARALLAX_BOOST,
  coverRect,
  disocclusionFill,
  hashSeed,
  orbitOffset,
  rackFocus as rackFocusFn,
  safeStrengthScale,
} from '../../src/parallax/math';

interface ParallaxImageProps {
  src: string;
  depthUrl?: string;
  cameraMovement?: string;
  cameraKeyframes?: CameraKeyframesConfig;
  durationInFrames: number;
  frameOffsetFrames?: number;
  clipId?: string;
  strength?: number;
  orbit?: number;
  blur?: number;
  haze?: number;
  dust?: number;
  dustSize?: number;
  dustDensity?: number;
  multiLayer?: boolean;
  rackFocus?: boolean;
  focusDepthOverride?: number;
  hazeColorOverride?: [number, number, number];
  filter?: string;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export const ParallaxImage: React.FC<ParallaxImageProps> = ({
  src,
  depthUrl,
  cameraMovement = 'slow_zoom_in',
  cameraKeyframes,
  durationInFrames,
  frameOffsetFrames = 0,
  clipId,
  strength = 1.0,
  orbit = 0.35,
  blur = 0.0,
  haze = 0.6,
  dust = 0.6,
  dustSize = 0.5,
  dustDensity = 0.5,
  multiLayer = true,
  rackFocus = false,
  focusDepthOverride,
  hazeColorOverride,
  filter,
}) => {
  const frame = useCurrentFrame() + (frameOffsetFrames || 0);
  const { width: targetW, height: targetH, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<ParallaxRenderer | null>(null);

  const [handle] = useState(() => delayRender('parallax-load', { timeoutInMilliseconds: 60000 }));
  const continuedRef = useRef(false);
  const safeContinue = () => {
    if (!continuedRef.current) {
      continuedRef.current = true;
      continueRender(handle);
    }
  };

  const [glFailed, setGlFailed] = useState(false);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [depthField, setDepthField] = useState<DepthField | null>(null);

  // Clean up WebGL renderer on unmount
  useEffect(() => () => {
    rendererRef.current?.dispose();
    rendererRef.current = null;
  }, []);

  // Load RGB image and Depth map
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      if (!active) return;
      setImgElement(img);

      if (depthUrl) {
        const dImg = new Image();
        dImg.crossOrigin = 'anonymous';
        dImg.src = depthUrl;
        dImg.onload = () => {
          if (!active) return;
          const cvs = document.createElement('canvas');
          cvs.width = dImg.naturalWidth || dImg.width;
          cvs.height = dImg.naturalHeight || dImg.height;
          const ctx = cvs.getContext('2d');
          if (ctx) {
            ctx.drawImage(dImg, 0, 0);
            const idata = ctx.getImageData(0, 0, cvs.width, cvs.height);
            const raw = new Uint8Array(cvs.width * cvs.height);
            for (let i = 0; i < raw.length; i++) raw[i] = idata.data[i * 4];

            // Auto-detect subject depth from center-third region when not overridden
            let detectedFocus = 0.65;
            if (focusDepthOverride === undefined && cvs.width > 8 && cvs.height > 8) {
              const x0 = Math.floor(cvs.width * 0.3);
              const x1 = Math.ceil(cvs.width * 0.7);
              const y0 = Math.floor(cvs.height * 0.25);
              const y1 = Math.ceil(cvs.height * 0.75);
              let sum = 0;
              let count = 0;
              for (let y = y0; y < y1; y += 2) {
                for (let x = x0; x < x1; x += 2) {
                  sum += raw[y * cvs.width + x] / 255;
                  count++;
                }
              }
              if (count > 0) detectedFocus = Math.min(0.9, Math.max(0.25, sum / count));
            }

            // Sample top-quarter of RGB image to match atmospheric haze to scene lighting
            let sceneHaze: [number, number, number] = [0.75, 0.8, 0.88];
            if (!hazeColorOverride) {
              try {
                const probe = document.createElement('canvas');
                probe.width = 32;
                probe.height = 32;
                const pCtx = probe.getContext('2d');
                if (pCtx) {
                  pCtx.drawImage(img, 0, 0, 32, 32);
                  const rgb = pCtx.getImageData(0, 0, 32, 10).data; // top sky/background band
                  let r = 0, g = 0, b = 0, n = 0;
                  for (let i = 0; i < rgb.length; i += 4) {
                    r += rgb[i];
                    g += rgb[i + 1];
                    b += rgb[i + 2];
                    n++;
                  }
                  if (n > 0) {
                    sceneHaze = [
                      Math.min(1, (r / n / 255) * 0.85 + 0.12),
                      Math.min(1, (g / n / 255) * 0.85 + 0.12),
                      Math.min(1, (b / n / 255) * 0.85 + 0.12),
                    ];
                  }
                }
              } catch {}
            }

            setDepthField({
              data: raw,
              width: cvs.width,
              height: cvs.height,
              source: 'model',
              focusDepth: focusDepthOverride ?? detectedFocus,
              hazeColor: hazeColorOverride ?? sceneHaze,
            });
          } else {
            fallbackProcedural(img);
          }
        };
        dImg.onerror = () => {
          if (!active) return;
          fallbackProcedural(img);
        };
      } else {
        fallbackProcedural(img);
      }
    };
    img.onerror = () => {
      setGlFailed(true);
      safeContinue();
    };

    function fallbackProcedural(loadedImg: HTMLImageElement) {
      try {
        const cvs = document.createElement('canvas');
        const w = loadedImg.naturalWidth || loadedImg.width;
        const h = loadedImg.naturalHeight || loadedImg.height;
        cvs.width = Math.min(640, w);
        cvs.height = Math.min(480, h);
        const ctx = cvs.getContext('2d');
        if (ctx) {
          ctx.drawImage(loadedImg, 0, 0, cvs.width, cvs.height);
          const idata = ctx.getImageData(0, 0, cvs.width, cvs.height);
          const field = buildProceduralDepthField({ data: idata.data, width: cvs.width, height: cvs.height });
          if (focusDepthOverride !== undefined) field.focusDepth = focusDepthOverride;
          if (hazeColorOverride !== undefined) field.hazeColor = hazeColorOverride;
          setDepthField(field);
        } else {
          setGlFailed(true);
          safeContinue();
        }
      } catch {
        setGlFailed(true);
        safeContinue();
      }
    }

    return () => {
      active = false;
      safeContinue();
    };
  }, [src, depthUrl, focusDepthOverride, hazeColorOverride]);

  // Render WebGL frame synchronously before paint
  useLayoutEffect(() => {
    if (glFailed) {
      safeContinue();
      return;
    }
    if (!canvasRef.current || !imgElement || !depthField) return;

    if (!rendererRef.current) {
      try {
        rendererRef.current = new ParallaxRenderer({ canvas: canvasRef.current });
      } catch (err) {
        console.error('[Remotion Parallax] WebGL init failed:', err);
        setGlFailed(true);
        safeContinue();
        return;
      }
    }

    const safeDuration = Math.max(1, durationInFrames);
    const rawProgress = Math.min(1, Math.max(0, frame / safeDuration));
    const easingMode = cameraKeyframes?.easing || 'cinematic_cut';
    const progress =
      easingMode === 'linear'
        ? rawProgress
        : easingMode === 'easeIn'
          ? rawProgress * rawProgress * rawProgress
          : easingMode === 'easeOut'
            ? 1 - Math.pow(1 - rawProgress, 3)
            : easingMode === 'easeInOut'
              ? easeInOutCubic(rawProgress)
              : 0.7 * rawProgress + 0.3 * (1 - Math.pow(1 - rawProgress, 2.2));

    const imgW = imgElement.naturalWidth || imgElement.width || targetW;
    const imgH = imgElement.naturalHeight || imgElement.height || targetH;

    // Compute base cover frame
    const baseCover = coverRect(imgW, imgH, targetW, targetH);

    // Calculate fg and bg transforms
    let fgScale = 1.0;
    let bgScale = 1.0;
    let fgTransX = 0;
    let bgTransX = 0;
    let fgTransY = 0;
    let bgTransY = 0;
    let rotation = 0;

    const bgProgress = progress * 0.95;

    if (cameraKeyframes) {
      const { start, end } = cameraKeyframes;
      fgScale = interpolate(progress, [0, 1], [start.scale, end.scale], { extrapolateRight: 'clamp' });
      bgScale = interpolate(bgProgress, [0, 1], [start.scale, end.scale], { extrapolateRight: 'clamp' });
      const xPctFg = interpolate(progress, [0, 1], [start.x, end.x], { extrapolateRight: 'clamp' });
      const xPctBg = interpolate(bgProgress, [0, 1], [start.x, end.x], { extrapolateRight: 'clamp' });
      const yPctFg = interpolate(progress, [0, 1], [start.y, end.y], { extrapolateRight: 'clamp' });
      const yPctBg = interpolate(bgProgress, [0, 1], [start.y, end.y], { extrapolateRight: 'clamp' });

      fgTransX = (0.5 - xPctFg);
      bgTransX = (0.5 - xPctBg);
      fgTransY = (0.5 - yPctFg);
      bgTransY = (0.5 - yPctBg);

      if (start.rotation !== undefined || end.rotation !== undefined) {
        rotation = interpolate(progress, [0, 1], [start.rotation || 0, end.rotation || 0], { extrapolateRight: 'clamp' });
      }
    } else {
      const mov = (cameraMovement || '').toLowerCase().trim();
      if (mov.includes('zoom_out') || mov.includes('zoomout')) {
        fgScale = interpolate(progress, [0, 1], [1.15, 1.0], { extrapolateRight: 'clamp' });
        bgScale = interpolate(bgProgress, [0, 1], [1.15, 1.0], { extrapolateRight: 'clamp' });
      } else if (mov.includes('zoom_in') || mov.includes('zoomin') || mov.includes('slow_zoom_in') || mov.includes('ken_burns') || mov.includes('zoom')) {
        fgScale = interpolate(progress, [0, 1], [1.0, 1.15], { extrapolateRight: 'clamp' });
        bgScale = interpolate(bgProgress, [0, 1], [1.0, 1.15], { extrapolateRight: 'clamp' });
      } else if (mov.includes('pan_left') || mov.includes('left')) {
        fgScale = 1.08; bgScale = 1.08;
        fgTransX = interpolate(progress, [0, 1], [0.04, -0.04], { extrapolateRight: 'clamp' });
        bgTransX = interpolate(bgProgress, [0, 1], [0.04, -0.04], { extrapolateRight: 'clamp' });
      } else if (mov.includes('pan_right') || mov.includes('right')) {
        fgScale = 1.08; bgScale = 1.08;
        fgTransX = interpolate(progress, [0, 1], [-0.04, 0.04], { extrapolateRight: 'clamp' });
        bgTransX = interpolate(bgProgress, [0, 1], [-0.04, 0.04], { extrapolateRight: 'clamp' });
      } else {
        fgScale = interpolate(progress, [0, 1], [1.0, 1.08], { extrapolateRight: 'clamp' });
        bgScale = interpolate(bgProgress, [0, 1], [1.0, 1.08], { extrapolateRight: 'clamp' });
      }
    }

    const fgN = {
      x: baseCover.x + (1 - 1 / fgScale) * (baseCover.w / 2) + fgTransX * baseCover.w,
      y: baseCover.y + (1 - 1 / fgScale) * (baseCover.h / 2) + fgTransY * baseCover.h,
      w: baseCover.w / fgScale,
      h: baseCover.h / fgScale,
    };

    const bgN = {
      x: baseCover.x + (1 - 1 / bgScale) * (baseCover.w / 2) + bgTransX * baseCover.w,
      y: baseCover.y + (1 - 1 / bgScale) * (baseCover.h / 2) + bgTransY * baseCover.h,
      w: baseCover.w / bgScale,
      h: baseCover.h / bgScale,
    };

    const focusDepth = focusDepthOverride ?? depthField.focusDepth;
    const hazeColor = hazeColorOverride ?? depthField.hazeColor ?? [0.75, 0.8, 0.88];

    const strengthSetting = strength * PARALLAX_BOOST;
    const orbitShift = orbitOffset(cameraMovement, progress, orbit);
    const safeScale = safeStrengthScale(fgN, bgN, orbitShift, strengthSetting, focusDepth);
    const effectiveStrength = strengthSetting * safeScale;

    const seed = hashSeed(clipId);
    let dofFocus = focusDepth;
    if (rackFocus) {
      const target = Math.min(0.9, Math.max(0.15, focusDepth + (seed > 0.5 ? -0.3 : 0.2)));
      dofFocus = rackFocusFn(focusDepth, target, progress);
    }

    const params: ParallaxParams = {
      fg: fgN,
      bg: bgN,
      orbit: { x: orbitShift.x * safeScale, y: orbitShift.y * safeScale },
      strength: effectiveStrength,
      focusDepth: focusDepth,
      dofFocus: dofFocus,
      multi: multiLayer,
      roll: (rotation * Math.PI) / 180,
      blur: blur > 0 ? blur * 0.04 : 0,
      fill: disocclusionFill(fgN, bgN, effectiveStrength),
      haze: haze,
      hazeColor: hazeColor,
      dust: dust,
      dustSize: dustSize,
      dustDensity: dustDensity,
      time: (frame / fps),
      seed,
      imgAspect: imgW / imgH,
      quality: 'cloud',
    };

    try {
      rendererRef.current.render(
        { image: imgElement, key: imgElement, width: imgW, height: imgH },
        depthField,
        targetW,
        targetH,
        params
      );
      safeContinue();
    } catch (renderErr) {
      console.error('[Remotion Parallax] WebGL render failed:', renderErr);
      setGlFailed(true);
      safeContinue();
    }
  }, [frame, durationInFrames, targetW, targetH, fps, imgElement, depthField, cameraMovement, cameraKeyframes, clipId, strength, orbit, blur, haze, dust, dustSize, dustDensity, multiLayer, rackFocus, focusDepthOverride, hazeColorOverride, glFailed]);

  if (glFailed) {
    return (
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: filter || undefined,
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={targetW}
      height={targetH}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        filter: filter || undefined,
      }}
    />
  );
};
