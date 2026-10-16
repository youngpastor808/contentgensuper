import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

export interface TextOverlayData {
  id?: string;
  text: string;
  startTime?: number;
  endTime?: number;
  position?: 'top' | 'center' | 'bottom' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | string;
  style?: 'classic' | 'neon' | 'pill' | 'minimal' | 'cinematic' | 'typewriter' | 'cyberpunk' | 'editorial';
  animation?: 'fade' | 'pop' | 'slide-up' | 'slide-left' | 'typewriter' | 'bounce' | 'none';
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  fontFamily?: string;
}

interface TextOverlayRendererProps {
  overlay: TextOverlayData;
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x;
}

export const TextOverlayRenderer: React.FC<TextOverlayRendererProps> = ({ overlay }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const anim = overlay.animation || 'pop';
  const isTypewriter = anim === 'typewriter' || overlay.style === 'typewriter';
  const animDurationFrames = Math.max(6, Math.min(14, Math.floor(durationInFrames * 0.22)));

  // Linear 0 -> 1 progress for entrance and exit windows
  const rawEnter = animDurationFrames > 0 ? Math.min(1, Math.max(0, frame / animDurationFrames)) : 1;
  const rawExit =
    durationInFrames - frame < animDurationFrames
      ? Math.max(0, Math.min(1, (durationInFrames - frame) / animDurationFrames))
      : 1;

  const enterEased = easeOutCubic(rawEnter);
  const exitEased = easeInCubic(rawExit);
  const visibility = Math.min(enterEased, exitEased);

  const pos = overlay.position || 'bottom';
  const isTop = pos.includes('top');
  const isBottom = pos.includes('bottom') || (!isTop && !pos.includes('center'));
  const isLeft = pos.includes('left');
  const isRight = pos.includes('right');
  const isCenter = !isLeft && !isRight;

  let scale = 1;
  let translateY = 0;
  let translateX = 0;
  const opacity = anim === 'none' ? 1 : visibility;

  if (anim === 'pop' || anim === 'bounce') {
    const spr = spring({
      frame,
      fps,
      config: anim === 'bounce' ? { damping: 11, stiffness: 180, mass: 0.7 } : { damping: 16, stiffness: 200, mass: 0.6 },
    });
    // Settle to 0.95 on exit instead of collapsing to scale(0)
    const exitScale = 0.95 + 0.05 * exitEased;
    scale = (0.86 + 0.14 * spr) * exitScale;
    translateY = (1 - enterEased) * 10 + (1 - exitEased) * 8;
  } else if (anim === 'slide-up') {
    translateY = (1 - enterEased) * 32 + (1 - exitEased) * 16;
  } else if (anim === 'slide-left') {
    translateX = (1 - enterEased) * 40 - (1 - exitEased) * 24;
  }

  let displayText = overlay.text || '';
  let typingCompleteFrame = 0;
  if (isTypewriter) {
    const totalChars = displayText.length;
    // Adaptive typing speed (~18 chars/sec, capped between 0.55s and 65% of clip duration)
    const typeDurationSec = Math.min((durationInFrames / fps) * 0.65, Math.max(0.55, totalChars / 18));
    typingCompleteFrame = Math.round(typeDurationSec * fps);
    const charsToShow = Math.min(
      totalChars,
      Math.floor(easeOutCubic(frame / Math.max(1, typingCompleteFrame)) * totalChars)
    );
    displayText = displayText.slice(0, Math.max(1, charsToShow));
  }

  const showCursor =
    isTypewriter &&
    frame < typingCompleteFrame + Math.round(fps * 0.9) &&
    (frame <= typingCompleteFrame || Math.floor(frame / Math.max(1, Math.round(fps * 0.25))) % 2 === 0);

  const baseFontSize = overlay.fontSize || 36;
  const color = overlay.color || '#ffffff';
  const bgColor = overlay.backgroundColor || 'rgba(15, 23, 42, 0.88)';
  const style = overlay.style || 'classic';

  return (
    <div
      style={{
        position: 'absolute',
        top: isTop ? '8%' : !isBottom ? '50%' : undefined,
        bottom: isBottom ? '14%' : undefined,
        left: isLeft ? '6%' : isCenter ? '50%' : undefined,
        right: isRight ? '6%' : undefined,
        transform: `${isCenter ? 'translateX(-50%) ' : ''}${!isTop && !isBottom ? 'translateY(-50%) ' : ''}translate3d(${translateX.toFixed(2)}px, ${translateY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
        opacity,
        zIndex: 55,
        pointerEvents: 'none',
        maxWidth: '84%',
        fontFamily: overlay.fontFamily || 'Montserrat, Inter, system-ui, sans-serif',
        fontSize: `${baseFontSize}px`,
        fontWeight: style === 'editorial' || style === 'cinematic' ? 600 : 800,
        letterSpacing: style === 'cinematic' ? '0.08em' : '0.01em',
        color,
        backgroundColor: style === 'minimal' || style === 'neon' ? 'transparent' : bgColor,
        padding: style === 'minimal' ? '4px 8px' : '12px 24px',
        borderRadius: style === 'pill' ? '9999px' : '12px',
        textShadow:
          style === 'neon'
            ? `0 0 12px ${color}, 0 0 28px ${color}`
            : '0 2px 12px rgba(0,0,0,0.65)',
        boxShadow:
          style === 'minimal' || style === 'neon' ? 'none' : '0 10px 30px rgba(0,0,0,0.45)',
        textAlign: isLeft ? 'left' : isRight ? 'right' : 'center',
      }}
    >
      {displayText}
      {showCursor && <span style={{ opacity: 0.85, marginLeft: '2px' }}>|</span>}
    </div>
  );
};
