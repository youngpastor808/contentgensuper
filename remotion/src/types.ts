export interface CameraKeyframe {
  x: number;          // Normalized center (0.0 = left, 0.5 = center, 1.0 = right)
  y: number;          // Normalized center (0.0 = top, 0.5 = center, 1.0 = bottom)
  scale: number;      // Zoom factor (e.g. 1.0 to 1.3)
  rotation?: number;  // Rotation in degrees
}

export interface CameraKeyframesConfig {
  start: CameraKeyframe;
  end: CameraKeyframe;
  easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'whip';
}

export interface SubtitleCue {
  text: string;
  start: number; // in seconds
  end: number;   // in seconds
}

export interface TimelineClipProp {
  id: string;
  startTime: number;  // in seconds
  endTime: number;    // in seconds
  duration: number;   // in seconds
  text?: string;
  hasVideo?: boolean;
  hasImage?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  sfxUrl?: string;
  talkingHeadMode?: 'full' | 'pip-br' | 'pip-bl' | 'pip-tr' | 'pip-tl' | 'split' | 'none';
  talkingHeadShape?: 'circle' | 'rounded' | 'square';
  displayMode?: 'fullscreen' | 'pip_overlay';
  pipPosition?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center_left' | 'center_right' | 'custom' | string;
  pipX?: number;
  pipY?: number;
  pipAnchorX?: number;
  pipAnchorY?: number;
  pipScale?: number;
  pipAnimation?: 'pop_spring' | 'fade' | 'slide' | string;
  pipBorderColor?: string;
  pipMediaAspect?: number;
  camera_movement?: string;
  cameraKeyframes?: CameraKeyframesConfig;
  volume?: number;
  playbackRate?: number;
  rotate?: number;
  fadeIn?: number;
  fadeOut?: number;
  transitionToNext?: 'cut' | 'fade' | 'crossfade' | 'zoomdissolve' | 'swipeleft' | 'swiperight' | 'swipeup' | 'swipedown' | 'wipe' | 'blur' | 'glitch' | string;
  transitionDuration?: number;
  subtitles?: SubtitleCue[];
  wordTimestampMode?: 'absolute' | 'relative';
  videoStartOffset?: number;
  overlayImageUrl?: string;
  mapConfig?: any;
  hasCornerMapCallout?: boolean;
  cornerCalloutLabel?: string;
  cornerCalloutCoords?: string;
  isPreMixedAudio?: boolean;
  useOriginalAudio?: boolean;
  soloAudio?: boolean;
  depthUrl?: string;
  parallax?: {
    enabled: boolean;
    strength?: number;
    orbit?: number;
    blur?: number;
    haze?: number;
    dust?: number;
    dustSize?: number;
    dustDensity?: number;
    multiLayer?: boolean;
    rackFocus?: boolean;
    focusDepth?: number;
    hazeColor?: [number, number, number];
  };
}

export interface VideoEffectsConfig {
  grain?: number;
  dustAndScratches?: number;
  vignette?: number;
  colorFilter?: string;
  cinematicVignette?: boolean;
  chromaticAberration?: number;
  lightLeaks?: number;
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

export interface SubtitleStyleConfig {
  preset?: 'classic' | 'tiktok' | 'karaoke' | 'minimal_bar' | 'cinema' | 'cinematic' | 'hormozi' | 'mrbeast' | 'neon' | 'yellowbox' | 'yellow_box' | 'anime' | 'terminal' | 'minimal' | 'minimal_editorial' | 'typewriter' | string;
  textColor?: string;
  highlightColor?: string;
  bgColor?: string;
  fontSize?: number;
  fontFamily?: string;
  position?: 'bottom' | 'center' | 'top' | 'lower_third' | string;
  /** state.videoSubtitleColors: { [styleName]: {...} } or a flat colour object. */
  colors?: Record<string, any>;
}

export interface TextOverlayProp {
  id?: string;
  text: string;
  type?: 'title' | 'lower_third' | 'subtitle' | 'caption' | 'callout' | string;
  startTime: number;
  endTime: number;
  position?: 'top' | 'center' | 'bottom' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

export interface StoryboardVideoProps {
  title: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  fps?: number;
  clips: TimelineClipProp[];
  totalDurationSec: number;
  subtitlesEnabled: boolean;
  subtitles?: SubtitleCue[];
  subtitleStyle?: SubtitleStyleConfig;
  textOverlays?: TextOverlayProp[];
  uiTextOverlays?: TextOverlayProp[];
  masterAudioUrl?: string;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  videoEffects?: VideoEffectsConfig;
  graphics?: any[];
  graphicsAccentColor?: string;
  patternInterrupts?: any[];
  timelineHasAudioMixdown?: boolean;
  cinematicLetterbox?: boolean;
  audioReactive?: any;
}
