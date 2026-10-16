/**
 * Cloud-render motion graphics drawing with 1:1 parity to the browser GraphicsEngine.
 *
 * Calls the shared Canvas renderer functions exported from src/graphics-engine.ts,
 * ensuring all lower thirds, title cards, evidence boards, stat counters, charts,
 * and badges render identically between the local editor preview and AWS Lambda.
 */
import {
  drawGraphics,
  getThemeFont,
  evidenceImageCache,
  overlayImageCache,
  ensureCachedImage,
} from '../../src/graphics-engine';
import { HyperFramesEngine } from '../../src/hyperframes-engine';

export interface GraphicsCanvasOptions {
  graphicsAccentColor?: string;
}

/**
 * Extracts the set of theme fonts needed by active graphic events.
 */
export function fontsForGraphics(events?: any[]): string[] {
  if (!events || !Array.isArray(events)) return ['Montserrat'];
  const fonts = new Set<string>(['Montserrat']);

  for (const ev of events) {
    if (!ev) continue;
    const theme = ev.theme;
    if (theme === 'news' || theme === 'bold-badge') {
      fonts.add('Impact');
    } else if (theme === 'gradient-glass') {
      fonts.add('Plus Jakarta Sans');
      fonts.add('Inter');
    } else if (theme === 'cyberpunk' || theme === 'retro-vhs') {
      fonts.add('Courier New');
    } else if (theme === 'neon') {
      fonts.add('Trebuchet MS');
    } else if (theme === 'minimal') {
      fonts.add('Helvetica Neue');
    } else if (theme === 'corporate') {
      fonts.add('Georgia');
    }
  }

  return Array.from(fonts);
}

/**
 * Preloads all external image assets referenced in graphic events
 * (evidence boards, custom icons, versus cards, social badges, hyperFrames)
 * so that they are fully decoded into memory before Remotion captures frames.
 */
export async function preloadGraphicImages(events?: any[], width?: number, height?: number): Promise<void> {
  if (!events || !Array.isArray(events) || typeof window === 'undefined') return;

  const imageUrls: string[] = [];
  const hyperPrewarms: Promise<void>[] = [];

  for (const ev of events) {
    if (!ev) continue;
    if (ev.type === 'hyperFrame') {
      const timeout = new Promise<void>((r) => setTimeout(r, 4000));
      hyperPrewarms.push(
        Promise.race([
          HyperFramesEngine.prewarmRaster(ev, width || 1920, height || 1080),
          timeout,
        ])
      );
    } else if (ev.type === 'evidenceBoard' && Array.isArray(ev.items)) {
      for (const it of ev.items) {
        if (it?.imageUrl && typeof it.imageUrl === 'string') {
          imageUrls.push(it.imageUrl);
        }
      }
    } else if (ev.type === 'iconOverlay' && ev.customImageUrl) {
      imageUrls.push(ev.customImageUrl);
    } else if (ev.type === 'versusCard') {
      if (ev.leftImageUrl) imageUrls.push(ev.leftImageUrl);
      if (ev.rightImageUrl) imageUrls.push(ev.rightImageUrl);
    } else if (ev.type === 'socialBadge' && ev.avatarUrl) {
      imageUrls.push(ev.avatarUrl);
    } else if (ev.type === 'bulletPanel' && Array.isArray(ev.items)) {
      for (const it of ev.items) {
        if (it?.imageUrl && typeof it.imageUrl === 'string') {
          imageUrls.push(it.imageUrl);
        }
      }
    }
  }

  const imgLoads = imageUrls.map((url) => {
    return new Promise<void>((resolve) => {
      // Prime the graphics engine's LRU cache directly
      const cached = evidenceImageCache.get(url) || overlayImageCache.get(url);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        return resolve();
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        evidenceImageCache.set(url, img);
        overlayImageCache.set(url, img);
        resolve();
      };
      img.onerror = () => {
        console.warn(`[Graphics Preload] Failed to load image: ${url}`);
        resolve(); // Continue render gracefully without crashing
      };
      img.src = url;
    });
  });

  await Promise.all([...imgLoads, ...hyperPrewarms]);
}

/**
 * Draws all active motion graphics directly onto an HTML5 Canvas for the current frame time.
 */
export function drawGraphicsOnCanvas(
  ctx: CanvasRenderingContext2D,
  timeSec: number,
  width: number,
  height: number,
  events?: any[],
  options?: GraphicsCanvasOptions
): void {
  if (!events || !Array.isArray(events) || events.length === 0) return;

  ctx.save();
  try {
    drawGraphics(ctx, timeSec, width, height, events as any, {
      isExporting: true,
      graphicsAccentColor: options?.graphicsAccentColor,
    });
  } finally {
    ctx.restore();
  }
}
