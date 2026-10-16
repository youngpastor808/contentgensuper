import React, { useRef, useEffect } from 'react';
import { useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';
import { renderMapFrame, preloadSatelliteTilesForRoute } from '../../src/map-animator-engine';

export interface MapShotProps {
  config: any;
}

const routePreloadCache = new Map<string, Promise<void>>();

export const MapShot: React.FC<MapShotProps> = ({ config }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const handle = delayRender(`map-shot-frame-${frame}`);
    let isCancelled = false;

    (async () => {
      try {
        if (config?.theme === 'real-satellite' && config?.waypoints) {
          const cacheKey = JSON.stringify(config.waypoints);
          let preloadPromise = routePreloadCache.get(cacheKey);
          if (!preloadPromise) {
            preloadPromise = preloadSatelliteTilesForRoute(config.waypoints).catch((err) => {
              routePreloadCache.delete(cacheKey);
              throw err;
            });
            routePreloadCache.set(cacheKey, preloadPromise);
          }
          await preloadPromise;
        }

        const canvas = canvasRef.current;
        if (canvas && config) {
          const ctx = canvas.getContext('2d');
          if (ctx && !isCancelled) {
            const timeSec = frame / fps;
            const progress = durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
            renderMapFrame(ctx, width, height, progress, config, timeSec);
          }
        }
      } catch (err) {
        console.warn('MapShot frame render error:', err);
      } finally {
        continueRender(handle);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [frame, fps, width, height, durationInFrames, config]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width: '100%', height: '100%' }} />;
};
