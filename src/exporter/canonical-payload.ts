/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical Export Payload Builder.
 * 
 * Shared between Client (Browser export & Cloud dispatch), Remotion Lambda,
 * Google Cloud Run, and Headless Server Workers to guarantee 100% identical
 * input schema and visual rendering parity.
 */

import { mediaAspectOf } from '../pip-layout';

export interface CanonicalClipPayload {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  overlayImageUrl?: string;
  mapConfig?: any;
  talkingHeadVideoUrl?: string;
  secondaryImageUrl?: string;
  secondaryVideoUrl?: string;
  secondary_image_id?: string | null;
  secondary_video_id?: string | null;
  talkingHeadRole?: 'primary' | 'secondary';
  talkingHeadMode?: string;
  talkingHeadShape?: 'circle' | 'rounded' | 'square';
  talkingHeadSize?: 'small' | 'medium' | 'large';
  displayMode?: 'fullscreen' | 'pip_overlay';
  pipPosition?: string;
  pipX?: number;
  pipY?: number;
  pipAnchorX?: number;
  pipAnchorY?: number;
  pipScale?: number;
  pipAnimation?: string;
  pipBorderColor?: string;
  pipMediaAspect?: number;
  hasCornerMapCallout?: boolean;
  cornerCalloutLabel?: string;
  cornerCalloutCoords?: string;
  overlayPosition?: string;
  cameraMovement?: string;
  camera_movement?: string;
  cameraKeyframes?: any;
  transitionToNext?: string;
  transitionDuration?: number;
  transitionType?: string;
  wordTimestamps?: { word?: string; punctuated_word?: string; start: number; end: number }[];
  wordRange?: { start: number; end: number };
  focalPoint?: { x: number; y: number };
  rotate?: 0 | 90 | 180 | 270;
  playbackRate?: number;
  videoStartOffset?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  useOriginalAudio?: boolean;
  soloAudio?: boolean;
  elements?: any[];
  backgroundPlateUrl?: string;
  deviceTag?: any;
  hasVideo?: boolean;
  hasImage?: boolean;
  subtitles?: { text: string; start: number; end: number }[];
  wordTimestampMode?: 'absolute' | 'relative';
}

export interface CanonicalExportPayload {
  title?: string;
  aspectRatio: string;
  resolutionWidth: number;
  resolutionHeight: number;
  fps: number;
  mode: 'free' | 'audio_locked';
  totalDurationSec: number;
  clips: CanonicalClipPayload[];
  graphics: any[];
  patternInterrupts: any[];
  motionGraphicsEnabled: boolean;
  overlayIntensity: string;
  graphicsTheme: string;
  graphicsAccentColor: string;
  showSubtitles: boolean;
  subtitlesEnabled: boolean;
  subtitles?: any[];
  wordTimestamps?: any[];
  videoSubtitleTextColor?: string;
  videoSubtitleHighlightColor?: string;
  videoSubtitleBgColor?: string;
  videoSubtitleFontSize?: number;
  videoSubtitleStyle: string;
  videoSubtitlePosition: 'bottom' | 'center' | 'top';
  videoSubtitleFont?: string;
  /** state.videoSubtitleColors - per-style colour overrides from the editor. */
  videoSubtitleColors?: Record<string, any>;
  videoTransitionStyle: string;
  videoEffects: Record<string, any>;
  activeFilterName: string;
  cinematicVignette: boolean;
  uiTextOverlays: any[];
  globalSilences?: { start: number; end: number }[] | null;
  masterAudioUrl?: string;
  audioUrl?: string;
  backgroundMusicUrl?: string;
}

export interface BuildCanonicalPayloadOptions {
  inputProps: any;
  width?: number;
  height?: number;
  fps?: number;
  resolution?: string;
  appBaseUrl?: string;
}

const RESOLUTION_MAP: Record<string, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '520p': { width: 960, height: 540 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export function resolveDimensionsForAspectRatio(aspectRatio: string, baseWidth = 1920, baseHeight = 1080): { width: number; height: number } {
  let w = baseWidth;
  let h = baseHeight;
  if (aspectRatio === '9:16') {
    return { width: Math.min(w, h), height: Math.max(w, h) };
  }
  if (aspectRatio === '1:1') {
    const dim = Math.min(w, h);
    return { width: dim, height: dim };
  }
  if (aspectRatio === '4:3') {
    return { width: 1440, height: 1080 };
  }
  if (aspectRatio === '3:4') {
    return { width: 1080, height: 1440 };
  }
  return { width: Math.max(w, h), height: Math.min(w, h) };
}

function normalizeUrl(url?: string, appBaseUrl?: string): string | undefined {
  if (!url) return undefined;
  if (appBaseUrl && url.startsWith('/')) {
    return `${appBaseUrl.replace(/\/$/, '')}${url}`;
  }
  if (appBaseUrl && url.includes('/api/cloud-render/assets/')) {
    try {
      const u = new URL(url);
      const base = new URL(appBaseUrl);
      u.protocol = base.protocol;
      u.host = base.host;
      return u.toString();
    } catch {}
  }
  return url;
}

/**
 * Builds the complete, pristine CanonicalExportPayload consumed by
 * local export, headless Chromium, AWS Remotion Lambda, and Google Cloud Run.
 */
export function buildCanonicalExportPayload(opts: BuildCanonicalPayloadOptions): CanonicalExportPayload {
  const { inputProps, fps = 30, resolution = '1080p', appBaseUrl } = opts;
  const p = inputProps || {};

  const baseDims = RESOLUTION_MAP[resolution] || RESOLUTION_MAP['1080p'];
  const aspectRatio = p.aspectRatio || '16:9';
  const { width, height } = opts.width && opts.height
    ? { width: opts.width, height: opts.height }
    : resolveDimensionsForAspectRatio(aspectRatio, baseDims.width, baseDims.height);

  const rawClips = Array.isArray(p.clips) ? p.clips : [];
  let accumulatedTime = 0;
  const mode = p.mode || 'free';
  const isAudioLocked = mode === 'audio_locked';

  const canonicalClips: CanonicalClipPayload[] = rawClips.map((c: any, idx: number) => {
    const startTime =
      typeof c.startTime === 'number' && Number.isFinite(c.startTime) && c.startTime >= 0
        ? c.startTime
        : accumulatedTime;

    const rawEnd =
      typeof c.endTime === 'number' && Number.isFinite(c.endTime) && c.endTime > startTime
        ? c.endTime
        : undefined;

    if (isAudioLocked && rawEnd == null) {
      throw new Error(
        `Audio-locked clip ${c.id || `shot_${idx + 1}`} has no canonical endTime`
      );
    }

    let canonicalEnd =
      rawEnd ??
      (
        typeof c.duration === 'number' && Number.isFinite(c.duration) && c.duration > 0
          ? startTime + c.duration
          : undefined
      );

    if (canonicalEnd == null || canonicalEnd <= startTime) {
      if (isAudioLocked) {
        throw new Error(
          `Invalid timing for clip ${c.id || `shot_${idx + 1}`}`
        );
      }
      canonicalEnd = startTime + 4;
    }

    const endTime = canonicalEnd;
    const duration = endTime - startTime;

    accumulatedTime = Math.max(accumulatedTime, endTime);

    const imageUrl = normalizeUrl(c.imageUrl, appBaseUrl);
    const videoUrl = normalizeUrl(c.videoUrl, appBaseUrl);
    const overlayImageUrl = normalizeUrl(c.overlayImageUrl || c.overlayImage, appBaseUrl);
    const talkingHeadVideoUrl = normalizeUrl(c.talkingHeadVideoUrl, appBaseUrl);
    const secondaryImageUrl = normalizeUrl(c.secondaryImageUrl || c.secondaryImage, appBaseUrl);
    const secondaryVideoUrl = normalizeUrl(c.secondaryVideoUrl || c.secondaryVideoElement, appBaseUrl);
    const backgroundPlateUrl = normalizeUrl(c.backgroundPlateUrl || c.backgroundPlate, appBaseUrl);

    const clipWordTimestampMode: 'absolute' | 'relative' = c.wordTimestampMode || 'relative';

    const subtitles = Array.isArray(c.wordTimestamps) && c.wordTimestamps.length > 0
      ? c.wordTimestamps.map((w: any) => {
          const rawStart = Number(w.start ?? w.startTime ?? 0);
          const rawEnd = Number(w.end ?? w.endTime ?? (rawStart + 0.3));
          const relStart = clipWordTimestampMode === 'relative' ? rawStart : Math.max(0, rawStart - startTime);
          const relEnd = clipWordTimestampMode === 'relative' ? rawEnd : Math.max(0.05, rawEnd - startTime);
          return {
            text: w.word || w.punctuated_word || w.text || '',
            start: Math.max(0, relStart),
            end: Math.max(0.05, relEnd),
          };
        })
      : (Array.isArray(c.subtitles) ? c.subtitles : undefined);

    return {
      id: c.id || `shot_${idx + 1}`,
      startTime,
      endTime,
      duration,
      text: c.text || '',
      imageUrl,
      videoUrl,
      overlayImageUrl,
      mapConfig: c.mapConfig ? structuredClone(c.mapConfig) : undefined,
      talkingHeadVideoUrl,
      secondaryImageUrl,
      secondaryVideoUrl,
      secondary_image_id: c.secondary_image_id ?? null,
      secondary_video_id: c.secondary_video_id ?? null,
      talkingHeadRole: c.talkingHeadRole || (c.talkingHeadMode === 'primary' ? 'primary' : 'secondary'),
      talkingHeadMode: c.talkingHeadMode || 'none',
      talkingHeadShape: c.talkingHeadShape || 'rounded',
      talkingHeadSize: c.talkingHeadSize || 'medium',
      displayMode: c.displayMode || 'fullscreen',
      pipPosition: c.pipPosition || 'top_right',
      pipX: typeof c.pipX === 'number' ? c.pipX : undefined,
      pipY: typeof c.pipY === 'number' ? c.pipY : undefined,
      pipAnchorX: typeof c.pipAnchorX === 'number' ? c.pipAnchorX : 0.5,
      pipAnchorY: typeof c.pipAnchorY === 'number' ? c.pipAnchorY : 0.5,
      pipScale: typeof c.pipScale === 'number' ? c.pipScale : undefined,
      pipAnimation: c.pipAnimation || 'pop_spring',
      pipBorderColor: c.pipBorderColor,
      pipMediaAspect: mediaAspectOf(c.videoElement || c.image || c.backgroundPlate),
      hasCornerMapCallout: Boolean(c.hasCornerMapCallout),
      cornerCalloutLabel: c.cornerCalloutLabel || '',
      cornerCalloutCoords: c.cornerCalloutCoords || '',
      overlayPosition: c.overlayPosition || 'top-right',
      cameraMovement: c.cameraMovement || c.camera_movement || 'slow_zoom_in',
      camera_movement: c.cameraMovement || c.camera_movement || 'slow_zoom_in',
      cameraKeyframes: c.cameraKeyframes,
      transitionToNext: c.transitionToNext || 'cut',
      transitionDuration: typeof c.transitionDuration === 'number' ? c.transitionDuration : (typeof c._transitionDuration === 'number' ? c._transitionDuration : 0.35),
      transitionType: c.transitionType || c.transitionToNext || 'cut',
      wordTimestamps: Array.isArray(c.wordTimestamps) ? c.wordTimestamps : undefined,
      wordTimestampMode: 'relative',
      wordRange: c.wordRange,
      focalPoint: c.focalPoint,
      rotate: c.rotate ?? 0,
      playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1.0,
      videoStartOffset: typeof c.videoStartOffset === 'number' ? c.videoStartOffset : 0,
      volume: typeof c.volume === 'number' ? c.volume : 1.0,
      fadeIn: c.fadeIn,
      fadeOut: c.fadeOut,
      useOriginalAudio: Boolean(c.useOriginalAudio || c.soloAudio),
      soloAudio: Boolean(c.soloAudio),
      elements: Array.isArray(c.elements) ? c.elements : [],
      backgroundPlateUrl,
      deviceTag: c.deviceTag,
      hasVideo: Boolean(videoUrl),
      hasImage: Boolean(imageUrl),
      subtitles,
    };
  });

  const maxClipEnd = canonicalClips.reduce((max, c) => Math.max(max, c.endTime), 0);
  const declaredDuration = Number(p.totalDurationSec);
  const totalDurationSec = Math.max(
    Number.isFinite(declaredDuration) && declaredDuration > 0 ? declaredDuration : 0,
    maxClipEnd,
    0.1
  );

  const subtitlesEnabled = Boolean(p.subtitlesEnabled ?? p.showSubtitles ?? true);

  return {
    title: p.title || 'AI Studio Video',
    aspectRatio,
    resolutionWidth: width,
    resolutionHeight: height,
    fps: p.fps || fps,
    mode: p.mode || 'free',
    totalDurationSec,
    clips: canonicalClips,
    graphics: Array.isArray(p.graphics) ? p.graphics : (Array.isArray(p.graphicEvents) ? p.graphicEvents : []),
    patternInterrupts: Array.isArray(p.patternInterrupts) ? p.patternInterrupts : [],
    motionGraphicsEnabled: Boolean(p.motionGraphicsEnabled ?? true),
    overlayIntensity: p.overlayIntensity || 'medium',
    graphicsTheme: p.graphicsTheme || 'minimal',
    graphicsAccentColor: p.graphicsAccentColor || '#F5C542',
    showSubtitles: subtitlesEnabled,
    subtitlesEnabled,
    subtitles: (Array.isArray(p.subtitles) ? p.subtitles : []).map((w: any) => ({
      text: String(w.text || w.word || w.punctuated_word || '').trim(),
      start: Number(w.start ?? w.startTime ?? 0),
      end: Number(w.end ?? w.endTime ?? (Number(w.start ?? 0) + 0.3)),
    })).filter((c: any) => Boolean(c.text)),
    wordTimestamps: Array.isArray(p.wordTimestamps) ? p.wordTimestamps : [],
    videoSubtitleTextColor: p.videoSubtitleTextColor,
    videoSubtitleHighlightColor: p.videoSubtitleHighlightColor,
    videoSubtitleBgColor: p.videoSubtitleBgColor,
    videoSubtitleFontSize: p.videoSubtitleFontSize,
    videoSubtitleStyle: p.videoSubtitleStyle || 'classic',
    videoSubtitlePosition: p.videoSubtitlePosition || 'bottom',
    videoSubtitleFont: p.videoSubtitleFont || 'Montserrat',
    videoSubtitleColors: (p.videoSubtitleColors && typeof p.videoSubtitleColors === 'object') ? p.videoSubtitleColors : {},
    videoTransitionStyle: p.videoTransitionStyle || 'narrative_guided',
    videoEffects: {
      grain: p.videoEffects?.grain || 0,
      dustAndScratches: p.videoEffects?.dustAndScratches || 0,
      vignette: p.videoEffects?.vignette || (p.cinematicVignette ? 0.6 : 0),
      colorFilter: p.videoEffects?.colorFilter || p.activeFilterName || 'none',
      cinematicVignette: Boolean(p.cinematicVignette || p.videoEffects?.cinematicVignette),
      chromaticAberration: p.videoEffects?.chromaticAberration || 0,
      lightLeaks: p.videoEffects?.lightLeaks || 0,
      sparkles: p.videoEffects?.sparkles || 0,
      hdrMaster: p.videoEffects?.hdrMaster || 0,
      hdrBalance: p.videoEffects?.hdrBalance || 0,
      clarity: p.videoEffects?.clarity || 0,
      vibrance: p.videoEffects?.vibrance || 0,
      sharpening: p.videoEffects?.sharpening || 0,
      ...p.videoEffects,
    },
    activeFilterName: p.activeFilterName || 'none',
    cinematicVignette: Boolean(p.cinematicVignette || p.videoEffects?.cinematicVignette),
    uiTextOverlays: Array.isArray(p.uiTextOverlays) ? p.uiTextOverlays : (Array.isArray(p.textOverlays) ? p.textOverlays : []),
    globalSilences: Array.isArray(p.globalSilences) ? p.globalSilences : null,
    masterAudioUrl: normalizeUrl(p.masterAudioUrl || p.audioUrl, appBaseUrl),
    audioUrl: normalizeUrl(p.audioUrl || p.masterAudioUrl, appBaseUrl),
    backgroundMusicUrl: normalizeUrl(p.backgroundMusicUrl, appBaseUrl),
  };
}
