import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';

/**
 * Anamorphic 2.39:1 letterbox bars. Mirrors step 5 of the browser renderer
 * (videoRenderer.ts, `if (state.cinematicLetterbox)`): bars are drawn after post effects and
 * BEFORE subtitles and motion graphics, and only when the frame is narrower than 2.39:1.
 */
/** Lets deeply nested components (PiP card placement) read state.cinematicLetterbox without prop drilling. */
export const LetterboxContext = React.createContext<boolean>(false);

export const LetterboxBars: React.FC<{ enabled?: boolean }> = ({ enabled }) => {
  const { width, height } = useVideoConfig();
  if (!enabled) return null;
  const targetAR = 2.39;
  if (width / height >= targetAR) return null;
  const activeH = width / targetAR;
  const barH = Math.round((height - activeH) / 2);
  if (barH <= 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 55 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: barH, background: '#000' }} />
      <div style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: barH, background: '#000' }} />
    </AbsoluteFill>
  );
};
