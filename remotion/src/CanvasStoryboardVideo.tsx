/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CanvasStoryboardVideo — Remotion composition adapter.
 * Adapts canonical timeline payloads and renders via StoryboardVideo.
 */

import React from 'react';
import { StoryboardVideo } from './StoryboardVideo';
import { StoryboardVideoProps, TimelineClipProp, SubtitleCue, TextOverlayProp } from './types';
import { resolveClipTransition } from './transitions';

export interface CanvasStoryboardVideoProps {
  payload?: any;
  [key: string]: any;
}

const EDITORIAL_CAMERA_CYCLE = [
  'slow_zoom_in',
  'pan_right',
  'slow_zoom_out',
  'pan_left',
  'slow_zoom_in',
  'tilt_up',
];

export const CanvasStoryboardVideo: React.FC<CanvasStoryboardVideoProps> = (props) => {
  const raw = props.payload || props;
  const isPreMixedAudio = Boolean(raw?.timelineHasAudioMixdown || raw?.isPreMixedAudio);

  const rawClips = Array.isArray(raw?.clips) ? raw.clips : [];
  const mappedClips: TimelineClipProp[] = rawClips.map((c: any, index: number) => {
    const subtitles: SubtitleCue[] = Array.isArray(c.subtitles)
      ? c.subtitles
      : Array.isArray(c.wordTimestamps)
      ? c.wordTimestamps.map((w: any) => ({
          text: String(w.word || w.text || w.punctuated_word || '').trim(),
          start: Number(w.start ?? w.startTime ?? 0),
          end: Number(w.end ?? w.endTime ?? (Number(w.start ?? 0) + 0.3)),
        }))
      : [];

    return {
      id: c.id || `clip-${index}`,
      url: c.imageUrl || c.videoUrl || c.url || '',
      type: c.type || (c.videoUrl ? 'video' : 'image'),
      startTime: Number(c.startTime || 0),
      endTime: Number(c.endTime || (c.startTime || 0) + 5),
      cameraMovement:
        c.cameraMovement ||
        c.camera_movement ||
        EDITORIAL_CAMERA_CYCLE[index % EDITORIAL_CAMERA_CYCLE.length],
      cameraKeyframes: c.cameraKeyframes,
      depthUrl: c.depthUrl,
      parallax: c.parallax,
      volume: typeof c.volume === 'number' ? c.volume : 1,
      playbackRate: c.playbackRate && !c.wordTimestamps?.length ? c.playbackRate : 1,
      rotate: typeof c.rotate === 'number' ? c.rotate : 0,
      useOriginalAudio: Boolean(c.useOriginalAudio || c.soloAudio),
      soloAudio: Boolean(c.soloAudio),
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      transitionToNext: index === rawClips.length - 1 ? 'cut' : resolveClipTransition(c.transitionToNext, raw?.videoTransitionStyle, c.id),
      transitionDuration: c.transitionDuration || c._transitionDuration,
      subtitles,
      videoStartOffset: c.videoStartOffset,
      overlayImageUrl: c.overlayImageUrl,
      hasCornerMapCallout: Boolean(c.hasCornerMapCallout),
      cornerCalloutLabel: c.cornerCalloutLabel,
      cornerCalloutCoords: c.cornerCalloutCoords,
      isPreMixedAudio: Boolean(c.isPreMixedAudio ?? isPreMixedAudio),
    };
  });

  const rawSubList = Array.isArray(raw?.subtitles) && raw.subtitles.length > 0
    ? raw.subtitles
    : Array.isArray(raw?.wordTimestamps)
    ? raw.wordTimestamps
    : [];

  let mappedSubtitles: SubtitleCue[] = rawSubList.map((w: any) => ({
    text: String(w.text || w.word || w.punctuated_word || '').trim(),
    start: Number(w.start ?? w.startTime ?? 0),
    end: Number(w.end ?? w.endTime ?? (Number(w.start ?? 0) + 0.3)),
  })).filter((c: SubtitleCue) => Boolean(c.text));

  // If no top-level subtitles were provided, aggregate from clips
  if (mappedSubtitles.length === 0 && mappedClips.length > 0) {
    const collected: SubtitleCue[] = [];
    mappedClips.forEach(c => {
      const clipStart = typeof c.startTime === 'number' ? c.startTime : 0;
      const wordMode: 'absolute' | 'relative' = (c as any).wordTimestampMode || 'relative';
      if (Array.isArray(c.subtitles) && c.subtitles.length > 0) {
        c.subtitles.forEach(sub => {
          const absStart = wordMode === 'relative' ? (clipStart + sub.start) : sub.start;
          const absEnd = wordMode === 'relative' ? (clipStart + sub.end) : sub.end;
          collected.push({
            text: sub.text,
            start: absStart,
            end: absEnd,
          });
        });
      }
    });
    if (collected.length > 0) {
      mappedSubtitles = collected;
    }
  }

  const mappedTextOverlays: TextOverlayProp[] = Array.isArray(raw?.uiTextOverlays)
    ? raw.uiTextOverlays.map((o: any, idx: number) => ({
        id: o.id || `overlay-${idx}`,
        text: o.text || '',
        type: o.type || 'caption',
        startTime: Number(o.startTime || 0),
        endTime: Number(o.endTime || (o.startTime || 0) + 3),
        position: o.position || 'bottom',
        fontSize: o.fontSize,
        color: o.color,
        backgroundColor: o.backgroundColor,
      }))
    : Array.isArray(raw?.textOverlays)
    ? raw.textOverlays
    : [];

  const storyboardProps: StoryboardVideoProps = {
    title: raw?.title || 'ContentGen AI Video',
    aspectRatio: raw?.aspectRatio || '16:9',
    clips: mappedClips,
    totalDurationSec: Number(raw?.totalDurationSec) || 10,
    subtitlesEnabled: raw?.showSubtitles !== false && raw?.subtitlesEnabled !== false,
    subtitles: mappedSubtitles,
    subtitleStyle: {
      preset: raw?.videoSubtitleStyle || raw?.subtitleStyle?.preset || 'classic',
      textColor: raw?.videoSubtitleTextColor || raw?.subtitleStyle?.textColor || '#ffffff',
      highlightColor: raw?.videoSubtitleHighlightColor || raw?.subtitleStyle?.highlightColor || '#facc15',
      bgColor: raw?.videoSubtitleBgColor || raw?.subtitleStyle?.bgColor || 'rgba(0,0,0,0.75)',
      position: raw?.videoSubtitlePosition || raw?.subtitleStyle?.position || 'bottom',
      fontFamily: raw?.videoSubtitleFont || raw?.subtitleStyle?.fontFamily,
      fontSize: raw?.videoSubtitleFontSize || raw?.subtitleStyle?.fontSize,
      colors: raw?.videoSubtitleColors || raw?.subtitleStyle?.colors,
    },
    textOverlays: mappedTextOverlays,
    masterAudioUrl: raw?.masterAudioUrl || raw?.narrationAudioUrl,
    backgroundMusicUrl: raw?.backgroundMusicUrl,
    backgroundMusicVolume: typeof raw?.backgroundMusicVolume === 'number' ? raw?.backgroundMusicVolume : 0.25,
    videoEffects: raw?.videoEffects || {
      cinematicVignette: Boolean(raw?.cinematicVignette),
      grain: raw?.filmGrain ? 0.3 : 0,
      vignette: raw?.cinematicVignette ? 0.6 : 0,
    },
    graphics: Array.isArray(raw?.graphics) ? raw.graphics : (Array.isArray(raw?._graphics) ? raw._graphics : []),
    graphicsAccentColor: raw?.graphicsAccentColor || '#F5C542',
    patternInterrupts: Array.isArray(raw?.patternInterrupts) ? raw.patternInterrupts : [],
    timelineHasAudioMixdown: isPreMixedAudio,
    cinematicLetterbox: Boolean(raw?.cinematicLetterbox),
    audioReactive: raw?.audioReactive,
  };

  return <StoryboardVideo {...storyboardProps} />;
};
