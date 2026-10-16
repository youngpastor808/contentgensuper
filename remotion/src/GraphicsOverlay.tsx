import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';
import {
  fontsForGraphics,
  preloadGraphicImages,
  drawGraphicsOnCanvas,
} from './graphicsCanvas';
import { loadFontByName } from './fonts';
import { installAudioReactive } from './audioReactive';

interface GraphicsOverlayProps {
  graphics?: any[];
  patternInterrupts?: any[];
  graphicsAccentColor?: string;
  audioReactive?: any;
}

export const GraphicsOverlay: React.FC<GraphicsOverlayProps> = ({
  graphics = [],
  patternInterrupts = [],
  graphicsAccentColor,
  audioReactive,
}) => {
  installAudioReactive(audioReactive);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const currentTimeSec = frame / fps;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingHandle = useRef<number | null>(null);
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  const fontNames = fontsForGraphics(graphics);
  const fontKey = fontNames.join('|');

  // Preload required Google fonts and external images before drawing to canvas
  useLayoutEffect(() => {
    if (graphics.length === 0) {
      setAssetsLoaded(true);
      return;
    }

    const handle = delayRender(`Loading graphics assets and fonts: ${fontKey}`);
    pendingHandle.current = handle;
    let alive = true;

    const fontLoads: Promise<unknown>[] = fontNames.map((n) => loadFontByName(n));
    const imgLoad = preloadGraphicImages(graphics, width, height);

    Promise.all([...fontLoads, imgLoad])
      .catch((err) => console.warn('[GraphicsOverlay] Asset preload warning:', err))
      .then(async () => {
        if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
          try { await document.fonts.ready; } catch {}
        }
        if (alive) {
          setAssetsLoaded(true);
        }
      });

    return () => {
      alive = false;
      if (pendingHandle.current === handle) {
        continueRender(handle);
        pendingHandle.current = null;
      }
    };
  }, [fontKey, graphics]);

  // Release the Remotion render lock once assets are primed
  useEffect(() => {
    if (assetsLoaded && pendingHandle.current !== null) {
      continueRender(pendingHandle.current);
      pendingHandle.current = null;
    }
  }, [assetsLoaded]);

  // Draw motion graphics synchronously to Canvas on every frame
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    if (!assetsLoaded || graphics.length === 0) return;

    drawGraphicsOnCanvas(ctx, currentTimeSec, width, height, graphics, {
      graphicsAccentColor,
    });
  });

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 70 }}>
      {/* 1. Shared Pixel-Parity Canvas Layer for all Motion Graphics */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {/* 2. Procedural Pattern Interrupts Layer (Fallback only for un-rasterized / standalone events) */}
      {patternInterrupts.map((pi, idx) => {
        if (!pi || pi.enabled === false) return null;

        // If this pattern interrupt was already baked into the graphics array, don't double-render
        if (pi.applied) return null;

        const timestamp = typeof pi.timestamp === 'number' ? pi.timestamp : 0;
        const intervention = pi.intervention || {};
        const type = intervention.type || pi.type;
        const payload = intervention.payload || {};

        const dur = payload.duration || 2.2;
        if (currentTimeSec < timestamp || currentTimeSec > timestamp + dur) return null;

        // Check if there is already an active motion graphic at this exact time to avoid visual collisions
        const hasActiveGraphicAtTime = graphics.some(
          (g) =>
            g &&
            currentTimeSec >= (g.start ?? 0) &&
            currentTimeSec <= (g.end ?? 0) &&
            (g.type === 'hyperFrame' || g.type === 'titleCard' || g.type === 'statCounter' || g.id?.includes(pi.id))
        );
        if (hasActiveGraphicAtTime) return null;

        const elapsed = currentTimeSec - timestamp;
        const inProgress = Math.min(1, elapsed / 0.25);
        const outProgress = Math.min(1, (timestamp + dur - currentTimeSec) / 0.25);
        const alpha = Math.min(inProgress, outProgress);
        const scale = 0.85 + inProgress * 0.15;

        const key = `pi_${pi.id || idx}`;

        const hasActiveSpotlight =
          patternInterrupts.some(
            (p) =>
              (p?.intervention?.type || p?.type) === 'spotlight' &&
              currentTimeSec >= (p.timestamp || 0) &&
              currentTimeSec <= (p.timestamp || 0) + (p.intervention?.payload?.duration || 2.2)
          ) ||
          graphics.some(
            (g) =>
              g?.type === 'spotlightFocus' &&
              currentTimeSec >= (g.start || 0) &&
              currentTimeSec <= (g.end || 0)
          );

        if (type === 'text_emphasis' || type === 'rapidFire') {
          const text = payload.text || pi.context?.emphasisWord || 'KEY INSIGHT';
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                // Keep above lower-third and subtitle zones (which reside at 75%-90%)
                top: hasActiveSpotlight ? '22%' : '38%',
                left: '50%',
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: alpha,
                backgroundColor: 'rgba(245, 158, 11, 0.95)',
                color: '#000000',
                padding: '16px 36px',
                borderRadius: 16,
                fontWeight: 900,
                fontSize: 42,
                letterSpacing: '-0.02em',
                boxShadow: '0 20px 40px rgba(0,0,0,0.8), 0 0 40px rgba(245,158,11,0.5)',
                textAlign: 'center',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                maxWidth: '85vw',
                zIndex: 65,
              }}
            >
              {text}
            </div>
          );
        }

        if (type === 'stat_callout') {
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                top: hasActiveSpotlight ? '24%' : '32%',
                left: '50%',
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: alpha,
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                border: '3px solid #10b981',
                padding: '24px 44px',
                borderRadius: 24,
                boxShadow: '0 0 50px rgba(16, 185, 129, 0.4), 0 25px 50px rgba(0,0,0,0.7)',
                textAlign: 'center',
                maxWidth: '85vw',
                zIndex: 65,
              }}
            >
              <div
                style={{
                  color: '#10b981',
                  fontSize: 64,
                  fontWeight: 900,
                  lineHeight: 1.0,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                {payload.value || '10x'}
              </div>
              <div
                style={{
                  color: '#ffffff',
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                }}
              >
                {payload.label || 'METRIC'}
              </div>
            </div>
          );
        }

        if (type === 'spotlight') {
          // If graphics already has a spotlightFocus event, do not double-darken
          const hasCanvasSpotlight = graphics.some(
            (g) => g?.type === 'spotlightFocus' && currentTimeSec >= (g.start || 0) && currentTimeSec <= (g.end || 0)
          );
          if (hasCanvasSpotlight) return null;

          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                inset: 0,
                opacity: alpha * 0.7,
                background: 'radial-gradient(circle at 50% 45%, transparent 30%, rgba(0, 0, 0, 0.88) 75%)',
              }}
            />
          );
        }

        return null;
      })}
    </AbsoluteFill>
  );
};
