import React from 'react';
import { AbsoluteFill, Sequence, Audio, Freeze, useCurrentFrame, useVideoConfig, delayRender, continueRender } from 'remotion';
import { StoryboardVideoProps } from './types';
import { ClipRenderer } from './ClipRenderer';
import { FilmEffects } from './FilmEffects';
import { SubtitlesOverlay } from './SubtitlesOverlay';
import { GraphicsOverlay } from './GraphicsOverlay';
import { TextOverlayRenderer } from './TextOverlayRenderer';
import { normalizeTransition, getTransitionFrame } from './transitions';
import { waitUntilAllFontsLoaded } from './fonts';
import { LetterboxBars, LetterboxContext } from './LetterboxBars';

const TransitionOut: React.FC<{ type: string; d: number; total: number; children: React.ReactNode }> = ({
  type,
  d,
  total,
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const start = total - d;
  if (type === 'cut' || d <= 0 || frame < start) return <>{children}</>;
  const tf = getTransitionFrame(type, (frame - start) / d, width, height, frame);
  return (
    <>
      <AbsoluteFill style={tf.out}>{children}</AbsoluteFill>
      {tf.overlay && (
        <AbsoluteFill
          style={{
            backgroundColor: tf.overlay.color,
            opacity: tf.overlay.opacity,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
};

const TransitionIn: React.FC<{ type: string; d: number; children: React.ReactNode }> = ({
  type,
  d,
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const tf = getTransitionFrame(type, frame / d, width, height, frame);
  return (
    <>
      <AbsoluteFill style={tf.inn}>{children}</AbsoluteFill>
      {tf.overlay && (
        <AbsoluteFill
          style={{
            backgroundColor: tf.overlay.color,
            opacity: tf.overlay.opacity,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
};

const OverlappedIncomingClip: React.FC<{
  item: {
    clip: any;
    baseDuration: number;
    d: number;
    type: string;
  };
  subtitleStyle?: any;
  videoEffects?: any;
}> = ({
  item,
  subtitleStyle,
  videoEffects,
}) => {
  const { clip, baseDuration, d, type } = item;

  if (d <= 0) {
    return (
      <Sequence durationInFrames={baseDuration}>
        <ClipRenderer
          clip={clip}
          subtitlesEnabled={false}
          subtitleStyle={subtitleStyle}
          durationInFrames={baseDuration}
          videoEffects={videoEffects}
        />
      </Sequence>
    );
  }

  return (
    <AbsoluteFill>
      {/* FIRST d frames: incoming media actually plays seamlessly inside transition */}
      <Sequence from={0} durationInFrames={d}>
        <TransitionIn type={type} d={d}>
          <ClipRenderer
            clip={{
              ...clip,
              fadeIn: 0,
              audioUrl: undefined,
              sfxUrl: undefined,
              useOriginalAudio: false,
            }}
            subtitlesEnabled={false}
            subtitleStyle={subtitleStyle}
            durationInFrames={baseDuration}
            videoEffects={videoEffects}
            timelineFrameOffset={0}
            mediaStartOffsetFrames={0}
          />
        </TransitionIn>
      </Sequence>

      {/* REMAINING CLIP: continues seamlessly from frame d rather than restarting */}
      <Sequence from={d} durationInFrames={Math.max(1, baseDuration - d)}>
        <ClipRenderer
          clip={clip}
          subtitlesEnabled={false}
          subtitleStyle={subtitleStyle}
          durationInFrames={baseDuration}
          videoEffects={videoEffects}
          timelineFrameOffset={d}
          mediaStartOffsetFrames={d}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

export const StoryboardVideo: React.FC<StoryboardVideoProps> = ({
  clips = [],
  subtitlesEnabled = true,
  subtitles = [],
  subtitleStyle,
  textOverlays: rawTextOverlays = [],
  uiTextOverlays: rawUiTextOverlays = [],
  graphics = [],
  graphicsAccentColor,
  patternInterrupts = [],
  masterAudioUrl,
  backgroundMusicUrl,
  backgroundMusicVolume = 0.25,
  videoEffects,
  timelineHasAudioMixdown = false,
  cinematicLetterbox = false,
  audioReactive,
}) => {
  const { fps } = useVideoConfig();

  const textOverlays = Array.isArray(rawUiTextOverlays) && rawUiTextOverlays.length > 0
    ? rawUiTextOverlays
    : (Array.isArray(rawTextOverlays) ? rawTextOverlays : []);
  const uiTextOverlays = textOverlays;

  const [fontHandle] = React.useState(() => delayRender('fonts-preload', { timeoutInMilliseconds: 30000 }));
  React.useEffect(() => {
    waitUntilAllFontsLoaded({ subtitleStyle, uiTextOverlays, scenes: clips, graphics })
      .then(() => continueRender(fontHandle))
      .catch((err) => {
        console.warn('[Remotion Fonts] Font preload timed out or failed:', err);
        continueRender(fontHandle);
      });
  }, [fontHandle, subtitleStyle, uiTextOverlays, clips, graphics]);

  const grain = videoEffects?.grain ?? 0;
  const dust = videoEffects?.dustAndScratches ?? (videoEffects?.dustParticles ?? 0);
  const dustSize = videoEffects?.dustParticlesSize ?? 0.5;
  const dustCount = videoEffects?.dustParticlesCount ?? 0.5;
  const vignette = videoEffects?.vignette ?? (videoEffects?.cinematicVignette ? 0.6 : 0);
  const sparkles = videoEffects?.sparkles ?? 0;
  const sparklesSize = videoEffects?.sparklesSize ?? 0.5;
  const sparklesCount = videoEffects?.sparklesCount ?? 0.5;
  const rain = videoEffects?.rain ?? 0;
  const rainSize = videoEffects?.rainSize ?? 0.5;
  const rainCount = videoEffects?.rainCount ?? 0.5;
  const snow = videoEffects?.snow ?? 0;
  const snowSize = videoEffects?.snowSize ?? 0.5;
  const snowCount = videoEffects?.snowCount ?? 0.5;
  const hasFilmEffects = grain > 0 || dust > 0 || vignette > 0 || sparkles > 0 || rain > 0 || snow > 0;
  const hasGlobalSubtitles = Boolean(subtitlesEnabled && subtitles && subtitles.length > 0);

  const computedClips = clips.map((clip, idx) => {
    const startSec = typeof clip.startTime === 'number' && Number.isFinite(clip.startTime) && clip.startTime >= 0 ? clip.startTime : 0;
    const endSec = Number.isFinite(clip.endTime) && clip.endTime > startSec
      ? clip.endTime
      : startSec + (typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 5);
    const durSec = endSec - startSec;
    const fromFrame = Math.max(0, Math.round(startSec * fps));
    const toFrame = Math.max(fromFrame + 1, Math.round(endSec * fps));
    const baseDuration = Math.max(1, toFrame - fromFrame);
    const type = idx === clips.length - 1 ? 'cut' : normalizeTransition(clip.transitionToNext);
    const d = type === 'cut' ? 0 : Math.min(Math.round((clip.transitionDuration || 0.35) * fps), baseDuration - 1);
    return { clip, idx, startSec, endSec, durSec, fromFrame, toFrame, baseDuration, type, d };
  });

  return (
    <LetterboxContext.Provider value={Boolean(cinematicLetterbox)}>
      <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {/* Overlapped incoming clips during transitions (with true moving media and continuous camera/subtitles) */}
      {computedClips.map((item, idx) => {
        if (idx === 0) return null;
        const prev = computedClips[idx - 1];
        if (prev.type === 'cut' || prev.d <= 0) return null;
        const preRollFrom = prev.fromFrame + prev.baseDuration - prev.d;
        return (
          <Sequence
            key={`overlap_${item.clip.id || idx}_${idx}`}
            from={preRollFrom}
            durationInFrames={item.baseDuration}
          >
            <OverlappedIncomingClip
              item={item}
              subtitleStyle={subtitleStyle}
              videoEffects={videoEffects}
            />
          </Sequence>
        );
      })}

      {/* Main clip sequences for clips without an active incoming transition overlap */}
      {computedClips.map((item, idx) => {
        const previous = idx > 0 ? computedClips[idx - 1] : null;
        const hasIncomingOverlap = idx > 0 && previous !== null && previous.type !== 'cut' && previous.d > 0;

        if (hasIncomingOverlap) {
          // Already rendered seamlessly through OverlappedIncomingClip
          return null;
        }

        return (
          <Sequence
            key={`seq_${item.clip.id || item.idx}_${item.idx}`}
            from={item.fromFrame}
            durationInFrames={item.baseDuration}
          >
            <TransitionOut type={item.type} d={item.d} total={item.baseDuration}>
              <ClipRenderer
                clip={item.clip}
                subtitlesEnabled={false}
                subtitleStyle={subtitleStyle}
                durationInFrames={item.baseDuration}
                videoEffects={videoEffects}
              />
            </TransitionOut>
          </Sequence>
        );
      })}

      {/* Cinematic Film Effects & Overlays Layer (Grain, Dust Particles, Vignette, Weather) — Under Letterbox & Subtitles */}
      {hasFilmEffects && (
        <FilmEffects
          grain={grain}
          dust={dust}
          dustSize={dustSize}
          dustCount={dustCount}
          vignette={vignette}
          sparkles={sparkles}
          sparklesSize={sparklesSize}
          sparklesCount={sparklesCount}
          rain={rain}
          rainSize={rainSize}
          rainCount={rainCount}
          snow={snow}
          snowSize={snowSize}
          snowCount={snowCount}
          dustParticles={dust}
          dustParticlesSize={dustSize}
          dustParticlesCount={dustCount}
        />
      )}

      {/* Anamorphic 2.39:1 Letterbox Bars (after film effects, before subtitles & graphics) */}
      <LetterboxBars enabled={Boolean(cinematicLetterbox)} />

      {/* Subtitles Overlay Layer (Top-level, crystal clear, un-faded by clip transitions & film effects) */}
      {subtitlesEnabled && (
        hasGlobalSubtitles ? (
          <SubtitlesOverlay
            subtitles={subtitles}
            styleConfig={subtitleStyle}
          />
        ) : (
          computedClips.map((item) => {
            const clip = item.clip;
            const hasText = Boolean(clip.text && clip.text.trim());
            const hasCues = Boolean(clip.subtitles && clip.subtitles.length > 0);
            if (!hasText && !hasCues) return null;

            return (
              <Sequence
                key={`clip_sub_${clip.id || item.idx}_${item.idx}`}
                from={item.fromFrame}
                durationInFrames={item.baseDuration}
              >
                <SubtitlesOverlay
                  text={clip.text}
                  subtitles={clip.subtitles}
                  durationSec={item.durSec}
                  styleConfig={subtitleStyle}
                />
              </Sequence>
            );
          })
        )
      )}

      {/* Global Timeline Text Overlays (Lower Thirds, Title Cards, Floating Headers) */}
      {textOverlays.map((overlay, idx) => {
        const startFrame = Math.max(0, Math.round((overlay.startTime || 0) * fps));
        const durFrame = Math.max(1, Math.round(((overlay.endTime || overlay.startTime + 3) - overlay.startTime) * fps));

        return (
          <Sequence key={`txt_ov_${overlay.id || idx}`} from={startFrame} durationInFrames={durFrame}>
            <TextOverlayRenderer overlay={overlay} />
          </Sequence>
        );
      })}

      {/* Motion Graphics & Pattern Interrupts Overlay Layer */}
      <GraphicsOverlay
        graphics={graphics}
        patternInterrupts={patternInterrupts}
        graphicsAccentColor={graphicsAccentColor}
        audioReactive={audioReactive}
      />

      {/* Master Audio / Narration Track */}
      {masterAudioUrl && (
        <Audio
          src={masterAudioUrl}
          volume={(frame) => {
            const currentSec = frame / fps;
            const isSolo = clips.some(
              (c) => Boolean(c.soloAudio) && currentSec >= c.startTime && currentSec < c.endTime
            );
            return isSolo ? 0 : 1.0;
          }}
        />
      )}

      {/* Background Music Track (bypassed if already pre-mixed in masterAudioUrl) */}
      {backgroundMusicUrl && !timelineHasAudioMixdown && (
        <Audio
          src={backgroundMusicUrl}
          volume={backgroundMusicVolume}
          loop
        />
      )}
    </AbsoluteFill>
  </LetterboxContext.Provider>
  );
};
