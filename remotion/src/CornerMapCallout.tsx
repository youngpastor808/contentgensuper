import React from 'react';
import { spring, useCurrentFrame, useVideoConfig, Img } from 'remotion';

export interface CornerCalloutProps {
  label?: string;
  gridCoordinates?: string;
  altitude?: string;
  overlayImageUrl?: string;
  durationInFrames: number;
}

export const CornerMapCallout: React.FC<CornerCalloutProps> = ({
  label = '',
  gridCoordinates = '',
  altitude,
  overlayImageUrl,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!label && !gridCoordinates && !overlayImageUrl && !altitude) {
    return null;
  }

  // Smooth spring entrance
  const entrance = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 180, mass: 0.75 },
  });

  // Broadcast exit over final 0.35s: fade opacity out while settling scale to 0.94
  const exitFrames = Math.max(1, Math.round(fps * 0.35));
  const exitStartFrame = Math.max(0, durationInFrames - exitFrames);
  const rawExit = frame > exitStartFrame ? Math.min(1, (frame - exitStartFrame) / exitFrames) : 0;
  const exitOpacity = 1 - rawExit * rawExit;
  const exitScale = 1 - rawExit * 0.06;

  const combinedScale = (0.88 + 0.12 * entrance) * exitScale;
  const combinedOpacity = Math.min(1, entrance * 1.2) * exitOpacity;
  if (combinedOpacity <= 0.01) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '6%',
        left: '5%',
        opacity: combinedOpacity,
        transform: `scale(${combinedScale.toFixed(4)}) translateY(${((1 - entrance) * 10 + rawExit * 6).toFixed(1)}px)`,
        transformOrigin: 'bottom left',
        fontFamily: 'monospace, -apple-system, sans-serif',
        color: '#00ffcc',
        zIndex: 35,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          borderLeft: '3px solid #00ffcc',
          borderBottom: '3px solid #00ffcc',
          padding: '12px 14px',
          minWidth: '220px',
          maxWidth: '320px',
          background: 'rgba(9, 9, 11, 0.75)',
          backdropFilter: 'blur(8px)',
          borderRadius: '0 8px 0 0',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.8), 0 0 15px rgba(0, 255, 204, 0.2)',
        }}
      >
        {/* Optional overlay thumbnail (e.g. mini map plate) */}
        {overlayImageUrl && (
          <div
            style={{
              width: '100%',
              height: '80px',
              marginBottom: '8px',
              borderRadius: '4px',
              overflow: 'hidden',
              border: '1px solid rgba(0, 255, 204, 0.3)',
            }}
          >
            <Img
              src={overlayImageUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        {label && (
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '1.5px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#00ffcc',
                boxShadow: '0 0 8px #00ffcc',
              }}
            />
            {label}
          </div>
        )}

        {gridCoordinates && (
          <div
            style={{
              fontSize: '14px',
              margin: '4px 0',
              color: '#f4f4f5',
              fontWeight: 600,
              letterSpacing: '0.5px',
            }}
          >
            {gridCoordinates}
          </div>
        )}

        {altitude && (
          <div style={{ fontSize: '10px', color: '#a1a1aa', opacity: 0.85 }}>
            {altitude}
          </div>
        )}
      </div>
    </div>
  );
};
