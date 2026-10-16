import { createEffect } from 'remotion';

export interface CinematicCustomEffectsParams {
  grain?: number;
  chromaticAberration?: number;
  vignette?: number;
  filterName?: string;
  seed?: number;
  hdrBalance?: number;
  clarity?: number;
  vibrance?: number;
  sharpening?: number;
}

/**
 * Custom Remotion Canvas Effect executing with 100% pixel parity on 2D / Canvas pipelines.
 * Compatible with Remotion's `createEffect()` API for AWS Lambda, headless renderers, and preview.
 */
export const customStudioPostEffects = createEffect<CinematicCustomEffectsParams, null>({
  type: 'ai.studio.customPostEffects',
  label: 'Studio Cinematic Effects',
  documentationLink: null,
  backend: '2d',
  calculateKey: (params) => {
    return `fx-${params.filterName || 'none'}-${params.grain || 0}-${params.vignette || 0}-${params.chromaticAberration || 0}-${params.hdrBalance || 0}-${params.clarity || 0}-${params.vibrance || 0}-${params.sharpening || 0}-${params.seed || 0}`;
  },
  setup: () => null,
  apply: ({ source, target, width, height, params }) => {
    const ctx = target.getContext('2d');
    if (!ctx) return;

    // Draw base source
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    const {
      grain = 0,
      chromaticAberration = 0,
      vignette = 0,
      filterName = 'none',
      seed = 0,
      hdrBalance = 0,
      clarity = 0,
      vibrance = 0,
      sharpening = 0,
    } = params;

    // 0a. HDR Exposure Balance
    if (hdrBalance > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.min(0.55, hdrBalance * 0.42);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.min(0.35, hdrBalance * 0.24);
      ctx.fillStyle = '#dedede';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 0b. Mid-Tone Clarity & Texture
    if (clarity > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = Math.min(0.55, clarity * 0.48);
      ctx.filter = `contrast(${100 + Math.round(clarity * 45)}%) brightness(${100 - Math.round(clarity * 4)}%)`;
      ctx.drawImage(source, 0, 0, width, height);
      ctx.restore();
    }

    // 0c. Botanical Vibrance
    if (vibrance > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'color';
      ctx.globalAlpha = Math.min(0.65, vibrance * 0.55);
      ctx.filter = `saturate(${100 + Math.round(vibrance * 75)}%)`;
      ctx.drawImage(source, 0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = vibrance * 0.16;
      ctx.fillStyle = 'rgba(72, 160, 80, 0.45)';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 0d. Micro-Edge Sharpening
    if (sharpening > 0) {
      const sharpAlpha = Math.min(0.65, sharpening * 0.60);
      const px = 1.0;
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = sharpAlpha * 0.5;
      ctx.drawImage(source, -px, 0, width, height, 0, 0, width, height);
      ctx.drawImage(source, px, 0, width, height, 0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'hard-light';
      ctx.globalAlpha = sharpAlpha * 0.25;
      ctx.drawImage(source, 0, -px, width, height, 0, 0, width, height);
      ctx.drawImage(source, 0, px, width, height, 0, 0, width, height);
      ctx.restore();
    }



    // 2. Chromatic Aberration (Channel-split offset)
    if (chromaticAberration > 0) {
      const shift = Math.round(chromaticAberration * 4);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.25 * chromaticAberration;
      ctx.drawImage(source, shift, 0, width, height, 0, 0, width, height);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(source, -shift, 0, width, height, 0, 0, width, height);
      ctx.restore();
    }

    // 3. Cinematic Vignette (Radial Falloff)
    if (vignette > 0) {
      ctx.save();
      const grad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        height * 0.28,
        width / 2,
        height / 2,
        width * 0.78
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.85, vignette * 0.65)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // 4. Deterministic Film Noise & Grain
    if (grain > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.06 * grain;
      let s = (seed * 1664525 + 1013904223) & 0xffffffff;
      const rand = () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };

      const dotCount = Math.round(90 * grain);
      for (let i = 0; i < dotCount; i++) {
        const gx = rand() * width;
        const gy = rand() * height;
        ctx.fillStyle = rand() > 0.5 ? '#ffffff' : '#000000';
        ctx.fillRect(gx, gy, 2, 2);
      }
      ctx.restore();
    }
  },
  cleanup: () => undefined,
  schema: {} as any,
  validateParams: () => {},
});
