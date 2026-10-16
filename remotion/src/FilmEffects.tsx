import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

export interface FilmEffectsProps {
  grain?: number;
  dust?: number;
  dustSize?: number;
  dustCount?: number;
  vignette?: number;
  sparkles?: number;
  sparklesSize?: number;
  sparklesCount?: number;
  rain?: number;
  rainSize?: number;
  rainCount?: number;
  snow?: number;
  snowSize?: number;
  snowCount?: number;
  dustParticles?: number;
  dustParticlesSize?: number;
  dustParticlesCount?: number;
}

export const FilmEffects: React.FC<FilmEffectsProps> = ({
  grain = 0.5,
  dust = 0.3,
  dustSize = 0.5,
  dustCount = 0.5,
  vignette = 0.3,
  sparkles = 0,
  sparklesSize = 0.5,
  sparklesCount = 0.5,
  rain = 0,
  rainSize = 0.5,
  rainCount = 0.5,
  snow = 0,
  snowSize = 0.5,
  snowCount = 0.5,
  dustParticles = 0,
  dustParticlesSize = 0.5,
  dustParticlesCount = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width = 1920, height = 1080 } = useVideoConfig();
  const time = frame / fps;

  // Procedural static/animated film dust specks
  const filmDustList = useMemo(() => {
    const count = Math.max(2, Math.round(18 * (dustCount * 2)));
    const sizeMult = Math.max(0.2, dustSize * 2);
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      top: `${((i * 17 + 23) % 97) + 1.5}%`,
      left: `${((i * 29 + 11) % 97) + 1.5}%`,
      size: ((i % 3) * 1.5 + 1.5) * sizeMult,
      opacity: 0.15 + (i % 5) * 0.08,
      triggerFrame: Math.floor((i / count) * durationInFrames),
    }));
  }, [durationInFrames, dustCount, dustSize]);

  // Magic sparkles particles
  const sparklesList = useMemo(() => {
    if (!sparkles || sparkles <= 0) return [];
    const count = Math.max(4, Math.round(36 * sparkles * (sparklesCount * 2)));
    const sizeMult = Math.max(0.2, sparklesSize * 2);
    return Array.from({ length: count }).map((_, i) => {
      const seedX = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
      const seedY = Math.cos(i * 4.1414 + 12.9898) * 23421.1231;
      const x = ((seedX - Math.floor(seedX)) * 100).toFixed(2);
      const y = ((seedY - Math.floor(seedY)) * 100).toFixed(2);
      const speed = 1.2 + (i % 5) * 0.4;
      const phase = (i * 1.618) % (Math.PI * 2);
      const baseSize = (8 + (i % 8) * 2) * sizeMult;
      return { id: i, x: `${x}%`, y: `${y}%`, speed, phase, baseSize };
    });
  }, [sparkles, sparklesCount, sparklesSize]);

  // Snowfall flakes
  const snowList = useMemo(() => {
    if (!snow || snow <= 0) return [];
    const count = Math.max(6, Math.round(60 * snow * (snowCount * 2)));
    const sizeMult = Math.max(0.2, snowSize * 2);
    return Array.from({ length: count }).map((_, i) => {
      const seedX = Math.sin(i * 31.415 + 1.414) * 43758.54;
      const seedY = Math.cos(i * 13.37 + 2.718) * 23421.12;
      const x0 = (seedX - Math.floor(seedX)) * 100;
      const y0 = (seedY - Math.floor(seedY));
      const fallSpeed = 0.08 + (i % 6) * 0.04;
      const swayFreq = 1.2 + (i % 4) * 0.5;
      const swayAmp = 2 + (i % 5) * 1.5;
      const size = (3 + (i % 7) * 2) * sizeMult;
      return { id: i, x0, y0, fallSpeed, swayFreq, swayAmp, size };
    });
  }, [snow, snowCount, snowSize]);

  // Non-repeating prime-stepped seed so 35mm grain never loops visibly
  const grainSeed = (Math.floor(frame) * 17 + 31) % 997;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 40, overflow: 'hidden' }}>
      {/* SVG Film Grain Filter */}
      {grain > 0 && (
        <>
          <svg style={{ width: 0, height: 0, position: 'absolute' }}>
            <filter id="film-grain-filter">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.85"
                numOctaves={3}
                stitchTiles="stitch"
                seed={grainSeed}
              />
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.09 0"
              />
            </filter>
          </svg>
          <AbsoluteFill
            style={{
              filter: 'url(#film-grain-filter)',
              opacity: Math.min(1, Math.max(0.1, grain * 0.9)),
              mixBlendMode: 'overlay',
            }}
          />
        </>
      )}

      {/* Cinematic Vignette */}
      {vignette > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${Math.min(0.85, vignette * 0.75)}) 100%)`,
          }}
        />
      )}

      {/* Film Dust & Scratches Layer */}
      {dust > 0 &&
        filmDustList.map((particle) => {
          // Aperiodic 1-to-2 frame celluloid dust flash using a deterministic hash per frame
          const hash = Math.sin((Math.floor(frame) + particle.id * 37) * 12.9898) * 43758.5453;
          const rand = hash - Math.floor(hash);
          const isVisible = rand < 0.065; // ~6.5% chance per frame = authentic brief film speck
          if (!isVisible) return null;

          return (
            <div
              key={particle.id}
              style={{
                position: 'absolute',
                top: particle.top,
                left: particle.left,
                width: particle.size,
                height: particle.size,
                backgroundColor: '#ffffff',
                borderRadius: '50%',
                opacity: particle.opacity * dust,
                boxShadow: '0 0 2px rgba(255, 255, 255, 0.4)',
              }}
            />
          );
        })}

      {/* Magic Sparkles Layer */}
      {sparkles > 0 &&
        sparklesList.map((sp) => {
          const twinkle = Math.pow(Math.max(0, Math.sin(time * sp.speed + sp.phase)), 4);
          if (twinkle < 0.06) return null;
          const sz = sp.baseSize * (0.6 + twinkle * 0.7);
          const alpha = twinkle * sparkles * 0.85;

          return (
            <div
              key={`sp_${sp.id}`}
              style={{
                position: 'absolute',
                top: sp.y,
                left: sp.x,
                width: sz,
                height: sz,
                transform: `translate(-50%, -50%) rotate(${time * 30 + sp.id * 45}deg)`,
                opacity: alpha,
                background: 'radial-gradient(circle, #ffffff 10%, rgba(253, 224, 71, 0.8) 40%, transparent 70%)',
                boxShadow: '0 0 8px rgba(250, 204, 21, 0.8)',
                borderRadius: '50%',
              }}
            />
          );
        })}

      {/* Snowfall Layer */}
      {snow > 0 &&
        snowList.map((sn) => {
          const progress = (sn.y0 + time * sn.fallSpeed) % 1.1 - 0.05;
          const topPct = progress * 100;
          const leftPct = sn.x0 + Math.sin(time * sn.swayFreq + sn.id) * sn.swayAmp;
          const alpha = (0.3 + (sn.id % 5) * 0.15) * snow;

          return (
            <div
              key={`sn_${sn.id}`}
              style={{
                position: 'absolute',
                top: `${topPct}%`,
                left: `${leftPct}%`,
                width: sn.size,
                height: sn.size,
                backgroundColor: '#ffffff',
                borderRadius: '50%',
                opacity: alpha,
                boxShadow: '0 0 4px rgba(255, 255, 255, 0.6)',
              }}
            />
          );
        })}
    </AbsoluteFill>
  );
};
