
import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { CameraKeyframesConfig } from './types';

interface CameraPanZoomProps {
  cameraMovement?: string;
  cameraKeyframes?: CameraKeyframesConfig;
  durationInFrames: number;
  frameOffsetFrames?: number;
  children: React.ReactNode;
}

function applyEasing(t: number, mode: string = 'cinematic_cut'): number {
  const x = Math.min(1, Math.max(0, t));
  switch (mode) {
    case 'linear':
      return x;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'whip':
      return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
    case 'cinematic_cut':
    default:
      // 70% linear momentum + 30% soft landing so cuts happen while the frame is still alive
      return 0.7 * x + 0.3 * (1 - Math.pow(1 - x, 2.2));
  }
}

function handheldJitter(progress: number, amplitude: number): number {
  return (
    Math.sin(progress * Math.PI * 7.3) * amplitude +
    Math.sin(progress * Math.PI * 3.1) * amplitude * 0.5
  );
}

export const CameraPanZoom: React.FC<CameraPanZoomProps> = ({
  cameraMovement = 'static',
  cameraKeyframes,
  durationInFrames,
  frameOffsetFrames = 0,
  children,
}) => {
  const frame = useCurrentFrame() + frameOffsetFrames;
  const safeDuration = Math.max(1, durationInFrames);
  const rawProgress = Math.min(1, Math.max(0, frame / safeDuration));

  const mov = (cameraMovement || '').toLowerCase().trim();
  const isHandheld = mov === 'handheld' || mov.includes('handheld');

  // Honor keyframe easing when present; use continuous cinematic momentum for preset moves
  const easingMode = cameraKeyframes?.easing || 'cinematic_cut';
  const progress = applyEasing(rawProgress, easingMode);

  let scale = 1.0;
  let translateX = 0;
  let translateY = 0;
  let rotation = 0;

  if (cameraKeyframes) {
    const { start, end } = cameraKeyframes;
    scale = interpolate(progress, [0, 1], [start.scale, end.scale], {
      extrapolateRight: 'clamp',
    });
    const xPct = interpolate(progress, [0, 1], [start.x, end.x], {
      extrapolateRight: 'clamp',
    });
    const yPct = interpolate(progress, [0, 1], [start.y, end.y], {
      extrapolateRight: 'clamp',
    });
    translateX = (0.5 - xPct) * 100;
    translateY = (0.5 - yPct) * 100;
    if (start.rotation !== undefined || end.rotation !== undefined) {
      rotation = interpolate(progress, [0, 1], [start.rotation || 0, end.rotation || 0], {
        extrapolateRight: 'clamp',
      });
    }
  } else if (mov === 'static' || mov === 'none') {
    scale = 1.0;
  } else if (mov.includes('zoom_out') || mov.includes('zoomout') || mov.includes('slow_zoom_out')) {
    scale = interpolate(progress, [0, 1], [1.14, 1.02], { extrapolateRight: 'clamp' });
  } else if (
    mov.includes('zoom_in') ||
    mov.includes('zoomin') ||
    mov.includes('slow_zoom_in') ||
    mov.includes('ken_burns') ||
    mov.includes('zoom')
  ) {
    scale = interpolate(progress, [0, 1], [1.01, 1.14], { extrapolateRight: 'clamp' });
  } else if (mov.includes('pan_left') || mov.includes('panleft') || mov.includes('left')) {
    scale = 1.12; // Extra overscan prevents edge clipping during handheld jitter
    translateX = interpolate(progress, [0, 1], [3.8, -3.8], { extrapolateRight: 'clamp' });
  } else if (mov.includes('pan_right') || mov.includes('panright') || mov.includes('right')) {
    scale = 1.12;
    translateX = interpolate(progress, [0, 1], [-3.8, 3.8], { extrapolateRight: 'clamp' });
  } else if (mov.includes('pan_up') || mov.includes('tilt_up') || mov.includes('up')) {
    scale = 1.12;
    translateY = interpolate(progress, [0, 1], [3.2, -3.2], { extrapolateRight: 'clamp' });
  } else if (mov.includes('pan_down') || mov.includes('tilt_down') || mov.includes('down')) {
    scale = 1.12;
    translateY = interpolate(progress, [0, 1], [-3.2, 3.2], { extrapolateRight: 'clamp' });
  } else if (mov.includes('drone') || mov.includes('flyover') || mov.includes('dynamic') || mov.includes('orbit')) {
    scale = interpolate(progress, [0, 1], [1.03, 1.15], { extrapolateRight: 'clamp' });
    translateY = interpolate(progress, [0, 1], [2, -2], { extrapolateRight: 'clamp' });
    rotation = interpolate(progress, [0, 1], [-0.8, 0.8], { extrapolateRight: 'clamp' });
  } else {
    scale = interpolate(progress, [0, 1], [1.01, 1.09], { extrapolateRight: 'clamp' });
    translateY = interpolate(progress, [0, 1], [0.5, -0.5], { extrapolateRight: 'clamp' });
  }

  if (isHandheld) {
    const jitterAmp = 0.55;
    scale = Math.max(scale, 1.06); // Guarantee overscan for handheld shake
    translateX += handheldJitter(rawProgress, jitterAmp);
    translateY += handheldJitter(rawProgress + 0.3, jitterAmp * 0.6);
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          transform: `scale(${scale.toFixed(4)}) translate3d(${translateX.toFixed(3)}%, ${translateY.toFixed(3)}%, 0) rotate(${rotation.toFixed(3)}deg)`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </div>
  );
};