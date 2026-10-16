import React, { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { SubtitleStyleConfig, SubtitleCue } from './types';
import { useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';
import { buildChunks, Cue, Chunk } from './subtitleChunks';
import { loadFontByName } from './fonts';
import {
  resolveLocalSubtitleStyle,
  drawSubtitleChunk,
  fontsForStyle,
  STYLE_TYPOGRAPHY,
  LocalSubtitleStyle,
} from './subtitleCanvas';

/**
 * Draws one of the 13 editor subtitle styles with the SAME renderer functions the
 * browser uses (src/subtitle-styles.ts), so cloud output matches the local export.
 */
const CanvasSubtitle: React.FC<{
  styleName: LocalSubtitleStyle;
  chunk: Chunk | null;
  currentTimeSec: number;
  styleConfig: SubtitleStyleConfig;
}> = ({ styleName, chunk, currentTimeSec, styleConfig }) => {
  const { width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pending = useRef<number | null>(null);
  const [loadedKey, setLoadedKey] = useState('');

  const sampleText = chunk ? chunk.words.map((w) => w.text).join(' ') : '';
  const fontNames = fontsForStyle(styleName, styleConfig.fontFamily, sampleText);
  const fontKey = fontNames.join('|');
  const weight = STYLE_TYPOGRAPHY[styleName].fontWeight ?? 800;

  // Fonts must be registered before the canvas measures/draws text.
  useLayoutEffect(() => {
    if (loadedKey === fontKey) return;
    const handle = delayRender(`Loading subtitle fonts: ${fontKey}`);
    pending.current = handle;
    let alive = true;
    const loads: Promise<unknown>[] = fontNames.map((n) => loadFontByName(n));
    if (typeof document !== 'undefined' && (document as any).fonts?.load) {
      fontNames.forEach((n) => loads.push((document as any).fonts.load(`${weight} 40px "${n}"`)));
    }
    Promise.all(loads.map((p) => Promise.resolve(p).catch(() => undefined))).then(() => {
      if (alive) setLoadedKey(fontKey);
    });
    return () => {
      alive = false;
      if (pending.current === handle) {
        continueRender(handle);
        pending.current = null;
      }
    };
  }, [fontKey]);

  // Release the render hold only after the canvas has been drawn with the loaded fonts.
  useEffect(() => {
    if (loadedKey === fontKey && pending.current !== null) {
      continueRender(pending.current);
      pending.current = null;
    }
  }, [loadedKey, fontKey]);

  // Draw synchronously on every frame.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!chunk || loadedKey !== fontKey) return;

    // Browser parity: highlight the last word whose start time has passed.
    let activeWordIndex = -1;
    chunk.words.forEach((w, i) => {
      if (w.start <= currentTimeSec) activeWordIndex = i;
    });
    const dur = Math.max(0.001, chunk.end - chunk.start);
    const progress = Math.min(1, Math.max(0, (currentTimeSec - chunk.start) / dur));
    const pos = String(styleConfig.position || 'bottom').toLowerCase();

    ctx.save();
    drawSubtitleChunk(ctx, {
      style: styleName,
      words: chunk.words.map((w) => w.text),
      activeWordIndex,
      progress,
      width,
      height,
      position: pos.includes('top') ? 'top' : pos.includes('center') ? 'center' : 'bottom',
      clipTime: currentTimeSec,
      userColors: styleConfig.colors || null,
      requestedFont: styleConfig.fontFamily,
    });
    ctx.restore();
  });

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', zIndex: 60, pointerEvents: 'none' }}
    />
  );
};

export interface SubtitlesOverlayProps {
  text?: string;
  subtitles?: SubtitleCue[];
  durationSec?: number;
  styleConfig?: SubtitleStyleConfig;
  timeOffsetSec?: number;
}

export const SubtitlesOverlay: React.FC<SubtitlesOverlayProps> = ({
  text,
  subtitles,
  durationSec = 5,
  styleConfig = {},
  timeOffsetSec = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSec = frame / fps + timeOffsetSec;

  const rawPreset = (styleConfig.preset || 'classic').toLowerCase().replace(/[-_]/g, '');
  const position = (styleConfig.position || 'bottom').toLowerCase();
  const textColor = styleConfig.textColor || '#ffffff';
  const highlightColor = styleConfig.highlightColor || '#facc15';
  const bgColor = styleConfig.bgColor || 'rgba(0, 0, 0, 0.75)';

  const positionStyles: React.CSSProperties = {
    position: 'absolute',
    left: '5%',
    right: '5%',
    textAlign: 'center',
    zIndex: 60,
    pointerEvents: 'none',
    fontFamily: styleConfig.fontFamily || 'Montserrat, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 1, // Always solid, never faded by parent clip transitions
    transition: 'opacity 0.15s ease, transform 0.15s ease',
    ...(position.includes('top')
      ? { top: '8%' }
      : position.includes('center')
      ? { top: '50%', transform: 'translateY(-50%)' }
      : position.includes('lower')
      ? { bottom: '13%' }
      : { bottom: '7.5%' }),
  };

  // Build chunks with browser SubtitleEngine parity
  const chunks = useMemo(() => {
    if (subtitles && subtitles.length > 0) {
      return buildChunks(subtitles);
    }
    if (text && text.trim()) {
      // No word timings: the browser uses plain 3-word slices, so disable duration merging.
      const words = text.trim().split(/\s+/).filter(Boolean);
      const per = Math.max(0.5, durationSec) / words.length;
      return buildChunks(
        words.map((w, i) => ({ text: w, start: i * per, end: (i + 1) * per })),
        { minDuration: 0 }
      );
    }
    return [];
  }, [subtitles, text, durationSec]);

  if (chunks.length === 0) return null;

  // The 13 editor styles are drawn with the browser's own renderers (exact parity).
  const localStyle = resolveLocalSubtitleStyle(styleConfig.preset);
  if (localStyle) {
    const active = chunks.find((ch) => currentTimeSec >= ch.start && currentTimeSec <= ch.displayEnd) || null;
    return (
      <CanvasSubtitle
        styleName={localStyle}
        chunk={active}
        currentTimeSec={currentTimeSec}
        styleConfig={styleConfig}
      />
    );
  }

  // Find currently active chunk (legacy DOM styles: classic / minimal_bar / unknown presets)
  const activeChunk = chunks.find(ch => currentTimeSec >= ch.start && currentTimeSec <= ch.displayEnd);
  if (!activeChunk) return null;

  const fontSize = styleConfig.fontSize ? `${styleConfig.fontSize}px` : '2.2rem';

  // Container styling for chunk presets
  const isYellowBox = rawPreset.includes('yellowbox') || rawPreset.includes('yellow');
  const isTikTok = rawPreset.includes('tiktok') || rawPreset.includes('karaoke');
  const isClassic = rawPreset.includes('classic') || (!rawPreset.includes('hormozi') && !rawPreset.includes('mrbeast') && !rawPreset.includes('cinema') && !isYellowBox && !isTikTok && !rawPreset.includes('neon'));

  let containerBg: string | undefined = undefined;
  let containerPadding: string | undefined = undefined;
  let containerRadius: string | undefined = undefined;
  let containerBoxShadow: string | undefined = undefined;
  let containerBorder: string | undefined = undefined;

  if (isYellowBox) {
    containerBg = '#facc15';
    containerPadding = '8px 22px';
    containerRadius = '12px';
    containerBoxShadow = '0 8px 30px rgba(0,0,0,0.65)';
  } else if (isTikTok) {
    containerBg = 'rgba(0, 0, 0, 0.75)';
    containerPadding = '8px 20px';
    containerRadius = '16px';
    containerBoxShadow = '0 8px 30px rgba(0,0,0,0.6)';
    containerBorder = '1px solid rgba(255,255,255,0.12)';
  } else if (isClassic) {
    containerBg = bgColor || 'rgba(0, 0, 0, 0.75)';
    containerPadding = '8px 20px';
    containerRadius = '14px';
    containerBoxShadow = '0 8px 30px rgba(0,0,0,0.65)';
    containerBorder = '1px solid rgba(255,255,255,0.12)';
  }

  return (
    <div style={positionStyles}>
      <div
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.35em',
          backgroundColor: containerBg,
          padding: containerPadding,
          borderRadius: containerRadius,
          boxShadow: containerBoxShadow,
          border: containerBorder,
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {activeChunk.words.map((cue, idx) => {
          const isActive = currentTimeSec >= cue.start && currentTimeSec <= cue.end;

          let color = textColor;
          let scale = 1.0;
          let background = 'transparent';
          let stroke = 'none';
          let textShadow = '0 2px 8px rgba(0,0,0,0.9)';
          let rotate = '0deg';

          if (rawPreset.includes('hormozi')) {
            color = isActive ? (highlightColor === '#facc15' ? '#22c55e' : highlightColor) : '#ffffff';
            scale = isActive ? 1.14 : 1.0;
            rotate = isActive ? (idx % 2 === 0 ? '1.5deg' : '-1.5deg') : '0deg';
            stroke = '2.5px #000000';
            textShadow = isActive ? '0 6px 18px rgba(0,0,0,0.95), 0 2px 4px #000000' : '2px 2px 4px #000000';
          } else if (rawPreset.includes('mrbeast')) {
            color = isActive ? '#facc15' : '#ffffff';
            scale = isActive ? 1.14 : 1.0;
            stroke = '2.5px #000000';
            textShadow = isActive ? '0 0 16px #00e5ff, 0 4px 12px rgba(0,0,0,0.95), 0 2px 4px #000000' : '2px 2px 4px #000000';
          } else if (isTikTok) {
            color = isActive ? (highlightColor || '#facc15') : '#ffffff';
            scale = isActive ? 1.12 : 1.0;
            background = isActive ? 'rgba(255, 255, 255, 0.18)' : 'transparent';
            stroke = '1.5px #000000';
          } else if (rawPreset.includes('cinema') || rawPreset.includes('cinematic')) {
            color = isActive ? '#fef08a' : '#ffffff';
            scale = isActive ? 1.08 : 1.0;
            textShadow = '0 2px 14px rgba(0,0,0,0.95), 0 1px 3px rgba(0,0,0,0.9)';
          } else if (isYellowBox) {
            color = '#18181b';
            background = isActive ? 'rgba(0, 0, 0, 0.12)' : 'transparent';
            scale = isActive ? 1.1 : 1.0;
            textShadow = 'none';
          } else if (rawPreset.includes('neon')) {
            color = isActive ? '#00ffff' : '#ffffff';
            scale = isActive ? 1.12 : 1.0;
            textShadow = isActive ? '0 0 14px #00ffff, 0 0 28px #00ffff, 0 2px 4px #000000' : '0 0 6px rgba(0,255,255,0.4), 2px 2px 4px #000000';
          } else {
            // Classic default
            color = isActive ? (highlightColor || '#facc15') : textColor;
            scale = isActive ? 1.1 : 1.0;
            background = isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent';
          }

          return (
            <span
              key={`cue_${idx}_${cue.start}`}
              style={{
                color,
                backgroundColor: background,
                transform: `scale(${scale}) rotate(${rotate})`,
                transformOrigin: 'center center',
                WebkitTextStroke: stroke !== 'none' ? stroke : undefined,
                padding: '3px 8px',
                borderRadius: '8px',
                fontSize,
                fontWeight: (rawPreset.includes('hormozi') || isYellowBox) ? 900 : 800,
                textShadow,
                opacity: 1, // Crisp solid opacity, never faded
                display: 'inline-block',
                letterSpacing: '0.02em',
                lineHeight: 1.25,
                // CSS Transitions on active word highlight, scale & color
                transition: 'transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), color 0.12s ease, background-color 0.12s ease, text-shadow 0.15s ease',
              }}
            >
              {rawPreset.includes('hormozi') ? cue.text.toUpperCase() : cue.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
