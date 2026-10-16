import React, { useMemo, useContext } from 'react';
import { AbsoluteFill, Img, Audio, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { Video } from '@remotion/media';
import { TimelineClipProp, SubtitleStyleConfig, VideoEffectsConfig } from './types';
import { CameraPanZoom } from './CameraPanZoom';
import { ParallaxImage } from './ParallaxImage';
import { SubtitlesOverlay } from './SubtitlesOverlay';
import { CornerMapCallout } from './CornerMapCallout';
import { MapShot } from './MapShot';
import { customStudioPostEffects } from './effects/customStudioEffects';
import { computePipCard } from '../../src/pip-layout';
import { LetterboxContext } from './LetterboxBars';

interface ClipRendererProps {
  clip: TimelineClipProp;
  subtitlesEnabled: boolean;
  subtitleStyle?: SubtitleStyleConfig;
  durationInFrames: number;
  videoEffects?: VideoEffectsConfig;
  timelineFrameOffset?: number;
  mediaStartOffsetFrames?: number;
}

function getCssFilter(filterName?: string): string | undefined {
  if (!filterName || filterName === 'none') return undefined;
  switch (filterName) {
    case 'noir':
    case 'black_and_white':
      return 'grayscale(100%) contrast(120%)';
    case 'sepia':
      return 'sepia(85%) contrast(110%)';
    case 'warm_cinematic':
    case 'warm':
      return 'sepia(25%) saturate(125%) brightness(105%)';
    case 'cool':
      return 'hue-rotate(20deg) saturate(110%) brightness(98%)';
    case 'cyberpunk':
      return 'contrast(120%) saturate(150%) hue-rotate(290deg)';
    case 'high_contrast':
      return 'contrast(135%) saturate(115%)';
    case 'vintage':
      return 'sepia(45%) contrast(95%) brightness(105%)';
    case 'vibrant':
      return 'saturate(140%) contrast(110%)';
    default:
      return undefined;
  }
}

export const ClipRenderer: React.FC<ClipRendererProps> = ({
  clip,
  subtitlesEnabled,
  subtitleStyle,
  durationInFrames,
  videoEffects,
  timelineFrameOffset = 0,
  mediaStartOffsetFrames = 0,
}) => {
  const localFrame = useCurrentFrame();
  const timelineFrame = localFrame + timelineFrameOffset;
  const hasVideo = Boolean(clip.videoUrl || clip.hasVideo);
  const hasImage = Boolean(clip.imageUrl);

  // Compute active effect parameters
  const grain = videoEffects?.grain ?? 0;
  const chromaticAberration = videoEffects?.chromaticAberration ?? 0;
  const vignette = videoEffects?.vignette ?? (videoEffects?.cinematicVignette ? 0.6 : 0);
  const filterName = videoEffects?.colorFilter ?? 'none';
  const hdrBalance = videoEffects?.hdrBalance ?? 0;
  const clarity = videoEffects?.clarity ?? 0;
  const vibrance = videoEffects?.vibrance ?? 0;
  const sharpening = videoEffects?.sharpening ?? 0;
  const cssFilter = getCssFilter(filterName);

  const customEffects = useMemo(() => {
    return [
      customStudioPostEffects({
        grain,
        chromaticAberration,
        vignette,
        filterName,
        hdrBalance,
        clarity,
        vibrance,
        sharpening,
        seed: timelineFrame,
      }),
    ];
  }, [grain, chromaticAberration, vignette, filterName, hdrBalance, clarity, vibrance, sharpening, timelineFrame]);

  const { fps, width: vw, height: vh } = useVideoConfig();

  // Explicit Clip Fades
  const fadeInFrames = Math.max(0, Math.round((clip.fadeIn || 0) * fps));
  const fadeOutFrames = Math.max(0, Math.round((clip.fadeOut || 0) * fps));

  let clipOpacity = 1;

  if (fadeInFrames > 0 && timelineFrame < fadeInFrames) {
    const inFade = interpolate(timelineFrame, [0, fadeInFrames], [0, 1], { extrapolateRight: 'clamp' });
    clipOpacity = Math.min(clipOpacity, inFade);
  }

  if (fadeOutFrames > 0 && timelineFrame > durationInFrames - fadeOutFrames) {
    const fadeOutOpacity = interpolate(timelineFrame, [durationInFrames - fadeOutFrames, durationInFrames], [1, 0], { extrapolateLeft: 'clamp' });
    clipOpacity = Math.min(clipOpacity, fadeOutOpacity);
  }

  // Rotation calculations
  const rot = (((clip.rotate || 0) % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const rotStyle: React.CSSProperties = rot
    ? {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: swap ? vh : vw,
        height: swap ? vw : vh,
        transform: `translate(-50%, -50%) rotate(${rot}deg)`,
      }
    : { width: '100%', height: '100%' };

  const isCircle = clip.talkingHeadShape === 'circle';
  const pipRotStyle: React.CSSProperties = rot
    ? {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: swap ? (isCircle ? '100%' : '177.78%') : '100%',
        height: swap ? (isCircle ? '100%' : '56.25%') : '100%',
        transform: `translate(-50%, -50%) rotate(${rot}deg)`,
      }
    : { width: '100%', height: '100%' };

  // Picture-in-Picture layout and animation calculations
  const isPipOverlay = clip.displayMode === 'pip_overlay';
  const hasTalkingHead = Boolean(clip.talkingHeadMode && clip.talkingHeadMode !== 'none' && clip.imageUrl && hasVideo);
  const letterbox = useContext(LetterboxContext);

  const timeInClip = timelineFrame / fps;
  const clipDur = Math.max(0.001, durationInFrames / fps);
  const pipCard = isPipOverlay ? computePipCard({
    cw: width,
    ch: height,
    timeInClip,
    clipDur,
    pipPosition: clip.pipPosition,
    pipX: (clip as any).pipX,
    pipY: (clip as any).pipY,
    pipAnchorX: (clip as any).pipAnchorX,
    pipAnchorY: (clip as any).pipAnchorY,
    pipScale: clip.pipScale,
    pipAnimation: clip.pipAnimation,
    mediaAspect: (clip as any).pipMediaAspect,
    letterbox,
  }) : null;

  if (isPipOverlay && (!pipCard || !pipCard.visible || pipCard.alpha <= 0.001)) {
    return null;
  }

  const rawPipPos = clip.pipPosition || (
    clip.talkingHeadMode === 'pip-tl' ? 'top_left' :
    clip.talkingHeadMode === 'pip-tr' ? 'top_right' :
    clip.talkingHeadMode === 'pip-bl' ? 'bottom_left' :
    'bottom_right'
  );
  const hasCustomPipPos = (rawPipPos === 'custom' || typeof (clip as any).pipX === 'number') && typeof (clip as any).pipY === 'number';
  const isPipTop = !hasCustomPipPos && rawPipPos.includes('top');
  const isPipLeft = !hasCustomPipPos && rawPipPos.includes('left');
  const isPipCenter = !hasCustomPipPos && rawPipPos.includes('center');

  const pipScale = typeof clip.pipScale === 'number' && clip.pipScale > 0 ? clip.pipScale : 0.28;
  const pipBorderColor = clip.pipBorderColor || 'rgba(255, 255, 255, 0.9)';
  const pipAnim = clip.pipAnimation || 'pop_spring';

  // PiP entrance/exit spring & slide calculation
  const pipEnterFrames = Math.max(1, Math.min(15, Math.round(durationInFrames * 0.25)));
  const pipExitFrames = Math.max(1, Math.min(12, Math.round(durationInFrames * 0.25)));

  let pipScaleMult = 1.0;
  let pipAlpha = 1.0;
  let pipSlideOffset = 0;

  if (timelineFrame < pipEnterFrames) {
    const p = timelineFrame / pipEnterFrames;
    if (pipAnim === 'pop_spring') {
      const overshoot = 1 + 0.16 * Math.sin(p * Math.PI) * (1 - p);
      pipScaleMult = p * overshoot;
      pipAlpha = Math.min(1, p * 1.6);
    } else if (pipAnim === 'slide' || pipAnim === 'slide_in') {
      const ease = 1 - Math.pow(1 - p, 3);
      pipSlideOffset = (1 - ease) * (isPipLeft ? -60 : 60);
      pipAlpha = Math.min(1, p * 2);
    } else { // fade or zoom_fade
      const ease = 1 - Math.pow(1 - p, 2);
      pipScaleMult = 0.85 + 0.15 * ease;
      pipAlpha = Math.min(1, p * 1.5);
    }
  } else if (timelineFrame > durationInFrames - pipExitFrames) {
    const p = Math.max(0, (durationInFrames - timelineFrame) / pipExitFrames);
    if (pipAnim === 'pop_spring' || pipAnim === 'zoom_fade' || pipAnim === 'fade') {
      pipScaleMult = 0.85 + 0.15 * p;
      pipAlpha = Math.min(1, p * 1.8);
    } else if (pipAnim === 'slide' || pipAnim === 'slide_in') {
      const ease = Math.pow(p, 3);
      pipSlideOffset = (1 - ease) * (isPipLeft ? -60 : 60);
      pipAlpha = Math.min(1, p * 1.8);
    }
  }

  const playbackRate = clip.playbackRate ?? 1;
  const baseTrimFrames = Math.round((clip.videoStartOffset || 0) * fps);
  const extraMediaFrames = Math.round((mediaStartOffsetFrames || 0) * playbackRate);
  const effectiveTrimBefore = baseTrimFrames + extraMediaFrames;

  const pipContainerStyle: React.CSSProperties = {
    position: 'absolute',
    top: hasCustomPipPos ? `${((clip as any).pipY ?? 0.5) * 100}%` : (isPipTop ? '5%' : isPipCenter ? '50%' : 'auto'),
    bottom: hasCustomPipPos ? 'auto' : (!isPipTop && !isPipCenter ? '5%' : 'auto'),
    left: hasCustomPipPos ? `${((clip as any).pipX ?? 0.5) * 100}%` : (isPipLeft ? `calc(5% + ${pipSlideOffset}px)` : 'auto'),
    right: hasCustomPipPos ? 'auto' : (!isPipLeft ? `calc(5% - ${pipSlideOffset}px)` : 'auto'),
    width: `${Math.round(pipScale * 100)}%`,
    transform: hasCustomPipPos
      ? `translate(-50%, -50%) translate(${pipSlideOffset}px, 0px) scale(${pipScaleMult})`
      : `${isPipCenter ? 'translateY(-50%) ' : ''}scale(${pipScaleMult})`,
    transformOrigin: hasCustomPipPos
      ? 'center center'
      : isPipTop ? (isPipLeft ? 'top left' : 'top right') : (isPipLeft ? 'bottom left' : 'bottom right'),
    opacity: pipAlpha,
    aspectRatio: clip.talkingHeadShape === 'circle' ? '1/1' : '16/9',
    borderRadius: clip.talkingHeadShape === 'circle' ? '50%' : '14px',
    overflow: 'hidden',
    boxShadow: '0 12px 36px rgba(0,0,0,0.75)',
    border: `3px solid ${pipBorderColor}`,
    zIndex: 35,
  };

  const hasVideoBackground = Boolean(hasVideo && clip.displayMode !== 'pip_overlay' && clip.talkingHeadMode === 'full');
  const parallaxOn = !!clip.parallax?.enabled && hasImage && !hasVideoBackground;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'transparent',
        overflow: 'hidden',
        opacity: isPipOverlay ? 1 : clipOpacity,
      }}
    >
      {/* If this clip is a floating PiP card overlay, render its media inside the card */}
      {isPipOverlay && pipCard ? (
        <div
          style={{
            position: 'absolute',
            left: pipCard.x,
            top: pipCard.y,
            width: pipCard.w,
            height: pipCard.h,
            opacity: pipCard.alpha,
            borderRadius: pipCard.cornerRadius,
            boxShadow: `0 ${pipCard.shadowOffsetY}px ${pipCard.shadowBlur}px rgba(0,0,0,0.75)`,
            border: `${pipCard.borderWidth}px solid ${clip.pipBorderColor || 'rgba(129, 140, 248, 0.75)'}`,
            overflow: 'hidden',
            backgroundColor: '#090d16',
            zIndex: 35,
          }}
        >
          {hasVideo ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
              <div style={pipRotStyle}>
                <Video
                  src={clip.videoUrl!}
                  style={{
                    width: '100%',
                    height: '100%',
                    filter: cssFilter || undefined,
                  }}
                  objectFit="cover"
                  trimBefore={effectiveTrimBefore}
                  muted={!clip.useOriginalAudio}
                  playbackRate={clip.playbackRate ?? 1}
                  loop
                  volume={clip.volume !== undefined ? clip.volume : 1.0}
                  effects={customEffects}
                />
              </div>
            </div>
          ) : hasImage ? (
            <Img
              src={clip.imageUrl!}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: cssFilter || undefined,
              }}
              effects={customEffects}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                backgroundColor: '#18181b',
                color: '#a1a1aa',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              🎬
            </div>
          )}

          {/* Subtle Ambient Top Sheen */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.0) 35%, rgba(0, 0, 0, 0.35) 100%)',
              borderRadius: pipCard.cornerRadius,
            }}
          />

          {/* Corner Badge / B-ROLL Chip */}
          <div
            style={{
              position: 'absolute',
              left: pipCard.badge.pad,
              bottom: pipCard.badge.pad,
              height: pipCard.badge.h,
              padding: `0 ${Math.max(4, Math.round(pipCard.badge.pad * 0.8))}px`,
              backgroundColor: 'rgba(15, 23, 42, 0.88)',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: pipCard.badge.fontPx,
              fontWeight: 700,
              fontFamily: 'Montserrat, sans-serif',
              color: '#e2e8f0',
              letterSpacing: '0.04em',
              pointerEvents: 'none',
            }}
          >
            <span>🖼️</span>
            <span>B-ROLL</span>
          </div>
        </div>
      ) : hasTalkingHead ? (
        <div style={pipContainerStyle}>
          {hasVideo ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
              <div style={pipRotStyle}>
                <Video
                  src={clip.videoUrl!}
                  style={{
                    width: '100%',
                    height: '100%',
                    filter: cssFilter || undefined,
                  }}
                  objectFit="cover"
                  trimBefore={effectiveTrimBefore}
                  muted={!clip.useOriginalAudio}
                  playbackRate={clip.playbackRate ?? 1}
                  loop
                  volume={clip.volume !== undefined ? clip.volume : 1.0}
                  effects={customEffects}
                />
              </div>
            </div>
          ) : hasImage ? (
            <Img
              src={clip.imageUrl!}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: cssFilter || undefined,
              }}
              effects={customEffects}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                backgroundColor: '#18181b',
                color: '#a1a1aa',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              🎬
            </div>
          )}
        </div>
      ) : parallaxOn ? (
        <ParallaxImage
          src={clip.imageUrl!}
          depthUrl={clip.depthUrl}
          cameraMovement={clip.camera_movement}
          cameraKeyframes={clip.cameraKeyframes}
          durationInFrames={durationInFrames}
          frameOffsetFrames={timelineFrameOffset}
          clipId={clip.id}
          strength={clip.parallax?.strength}
          orbit={clip.parallax?.orbit}
          blur={clip.parallax?.blur}
          haze={clip.parallax?.haze}
          dust={clip.parallax?.dust}
          dustSize={clip.parallax?.dustSize}
          dustDensity={clip.parallax?.dustDensity}
          multiLayer={clip.parallax?.multiLayer}
          rackFocus={clip.parallax?.rackFocus}
          focusDepthOverride={clip.parallax?.focusDepth}
          hazeColorOverride={clip.parallax?.hazeColor}
          filter={cssFilter || undefined}
        />
      ) : hasVideo && !clip.cameraKeyframes ? (
        /* Fullscreen Visual Canvas Layer for Video without artificial pan/zoom */
        <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
          <div style={rotStyle}>
            <Video
              src={clip.videoUrl!}
              style={{
                width: '100%',
                height: '100%',
                filter: cssFilter || undefined,
              }}
              objectFit="cover"
              trimBefore={effectiveTrimBefore}
              muted={!clip.useOriginalAudio}
              playbackRate={clip.playbackRate ?? 1}
              loop
              volume={clip.volume !== undefined ? clip.volume : 1.0}
              effects={customEffects}
            />
          </div>
        </div>
      ) : (
        /* Fullscreen Visual Canvas Layer with Pan/Zoom */
        <CameraPanZoom
          cameraMovement={clip.camera_movement}
          cameraKeyframes={clip.cameraKeyframes}
          durationInFrames={durationInFrames}
          frameOffsetFrames={timelineFrameOffset}
        >
          {clip.mapConfig ? (
            <MapShot config={clip.mapConfig} />
          ) : hasVideo ? (
            <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
              <div style={rotStyle}>
                <Video
                  src={clip.videoUrl!}
                  style={{
                    width: '100%',
                    height: '100%',
                    filter: cssFilter || undefined,
                  }}
                  objectFit="cover"
                  trimBefore={effectiveTrimBefore}
                  muted={!clip.useOriginalAudio}
                  playbackRate={clip.playbackRate ?? 1}
                  loop
                  volume={clip.volume !== undefined ? clip.volume : 1.0}
                  effects={customEffects}
                />
              </div>
            </div>
          ) : hasImage ? (
            <Img
              src={clip.imageUrl!}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: cssFilter || undefined,
              }}
              effects={customEffects}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                backgroundColor: '#18181b',
                color: '#a1a1aa',
                padding: 40,
                textAlign: 'center',
                fontFamily: 'system-ui, -apple-system, sans-serif',
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#f4f4f5' }}>
                {clip.text || `Shot ${clip.id}`}
              </div>
            </div>
          )}
        </CameraPanZoom>
      )}

      {/* Local vignette overlay if specified on clip effects */}
      {vignette > 0 && !isPipOverlay && (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${Math.min(0.85, vignette * 0.75)}) 100%)`,
          }}
        />
      )}

      {/* Picture-in-Picture / Talking Head mode on fullscreen clips */}
      {!isPipOverlay && hasTalkingHead && (
        <div style={pipContainerStyle}>
          <Img
            src={clip.imageUrl!}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}

      {/* Clip-specific audio / SFX (bypassed if already pre-mixed in masterAudioUrl) */}
      {(!clip.isPreMixedAudio || clip.useOriginalAudio) && clip.audioUrl && (
        <Audio
          src={clip.audioUrl}
          volume={clip.volume !== undefined ? clip.volume : 1.0}
        />
      )}
      {!clip.isPreMixedAudio && clip.sfxUrl && <Audio src={clip.sfxUrl} volume={0.8} />}

      {/* Corner Map / Media Callout Overlay */}
      {clip.hasCornerMapCallout && (
        <CornerMapCallout
          label={clip.cornerCalloutLabel || ''}
          gridCoordinates={clip.cornerCalloutCoords || ''}
          overlayImageUrl={clip.overlayImageUrl}
          durationInFrames={durationInFrames}
        />
      )}

      {/* Subtitles Layer */}
      {subtitlesEnabled && (clip.text || (clip.subtitles && clip.subtitles.length > 0)) && (
        <SubtitlesOverlay
          text={clip.text}
          subtitles={clip.subtitles}
          durationSec={durationInFrames / fps}
          timeOffsetSec={(timelineFrameOffset || 0) / fps}
          styleConfig={subtitleStyle}
        />
      )}
    </AbsoluteFill>
  );
};
