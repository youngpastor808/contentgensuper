import React from 'react';
import { Composition } from 'remotion';
import { StoryboardVideo } from './StoryboardVideo';
import { CanvasStoryboardVideo } from './CanvasStoryboardVideo';
import { StoryboardVideoProps } from './types';

const defaultStoryboardProps: StoryboardVideoProps = {
  title: 'ContentGen AI Video',
  aspectRatio: '16:9',
  totalDurationSec: 10,
  subtitlesEnabled: true,
  subtitleStyle: {
    preset: 'classic',
    textColor: '#ffffff',
    bgColor: 'rgba(0,0,0,0.75)',
    position: 'bottom',
  },
  clips: [
    {
      id: 'shot-1',
      startTime: 0,
      endTime: 5,
      duration: 5,
      text: 'AI-Generated Storyboard on Google Cloud Run',
      camera_movement: 'slow_zoom_in',
    },
    {
      id: 'shot-2',
      startTime: 5,
      endTime: 10,
      duration: 5,
      text: 'Rendered at Scale with Remotion & Cloud Run',
      camera_movement: 'pan_left',
    },
  ],
};

const defaultCanvasProps = {
  aspectRatio: '16:9',
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  fps: 30,
  mode: 'free',
  totalDurationSec: 10,
  clips: defaultStoryboardProps.clips,
  showSubtitles: true,
  videoSubtitleStyle: 'classic',
  videoSubtitlePosition: 'bottom',
  videoTransitionStyle: 'narrative_guided',
  videoEffects: {},
  activeFilterName: 'none',
  cinematicVignette: false,
  uiTextOverlays: [],
  graphics: [],
  patternInterrupts: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition<any, any>
        id="CanvasStoryboardVideo"
        component={CanvasStoryboardVideo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultCanvasProps}
        calculateMetadata={async ({ props }) => {
          const raw = props as any;
          const p = raw?.payload && typeof raw.payload === 'object' ? raw.payload : (raw || {});
          const fps = Number(p.fps) || 30;
          const clips = Array.isArray(p.clips) ? p.clips : [];

          const declaredDuration = Number(p.totalDurationSec);
          const clipEnd = clips.reduce((max: number, c: any) => {
            const start = Number(c?.startTime) || 0;
            const explicitEnd = Number(c?.endTime);
            const end =
              Number.isFinite(explicitEnd) && explicitEnd > 0
                ? explicitEnd
                : start + (Number(c?.duration) || 0);
            return Math.max(max, end);
          }, 0);

          const totalDuration = Math.max(
            Number.isFinite(declaredDuration) && declaredDuration > 0 ? declaredDuration : 0,
            clipEnd,
            0.1
          );

          const durationInFrames = Math.max(1, Math.ceil(totalDuration * fps));

          let width = Number(p.resolutionWidth) || 1920;
          let height = Number(p.resolutionHeight) || 1080;

          switch (p.aspectRatio) {
            case '9:16':
              width = 1080;
              height = 1920;
              break;
            case '1:1':
              width = 1080;
              height = 1080;
              break;
            case '4:3':
              width = 1440;
              height = 1080;
              break;
            case '3:4':
              width = 1080;
              height = 1440;
              break;
            case '16:9':
            default:
              width = 1920;
              height = 1080;
              break;
          }

          return {
            durationInFrames,
            width,
            height,
            fps,
          };
        }}
      />
      <Composition<any, any>
        id="StoryboardVideo"
        component={StoryboardVideo}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultStoryboardProps}
        calculateMetadata={async ({ props }) => {
          const p = (props || {}) as unknown as StoryboardVideoProps;
          const fps = Number(p.fps) || 30;
          const clips = Array.isArray(p.clips) ? p.clips : [];

          const declaredDuration = Number(p.totalDurationSec);
          const clipEnd = clips.reduce((max: number, c: any) => {
            const start = Number(c?.startTime) || 0;
            const explicitEnd = Number(c?.endTime);

            const end =
              Number.isFinite(explicitEnd) && explicitEnd > 0
                ? explicitEnd
                : start + (Number(c?.duration) || 0);

            return Math.max(max, end);
          }, 0);

          // Never allow the declared duration to truncate actual clips.
          const totalDuration = Math.max(
            Number.isFinite(declaredDuration) && declaredDuration > 0
              ? declaredDuration
              : 0,
            clipEnd,
            0.1
          );

          const durationInFrames = Math.max(
            1,
            Math.ceil(totalDuration * fps)
          );

          let width = 1920;
          let height = 1080;

          switch (p.aspectRatio) {
            case '9:16':
              width = 1080;
              height = 1920;
              break;
            case '1:1':
              width = 1080;
              height = 1080;
              break;
            case '4:3':
              width = 1440;
              height = 1080;
              break;
            case '3:4':
              width = 1080;
              height = 1440;
              break;
            case '16:9':
            default:
              width = 1920;
              height = 1080;
              break;
          }

          return {
            durationInFrames,
            width,
            height,
            fps,
          };
        }}
      />
    </>
  );
};
