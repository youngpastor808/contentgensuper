/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ExportFeatureFlags {
  useSequentialVideoDecoder: boolean;
  useChunkedAudioMix: boolean;
  useWsolaPitchStretch: boolean;
  useMidFrameSeeking: boolean;
  enableExportProfiler: boolean;
  audioSegmentDurationSec: number;
}

const DEFAULT_FLAGS: ExportFeatureFlags = {
  useSequentialVideoDecoder: true, // Graduated Phase 2: Mediabunny CanvasSink sequential decode
  useChunkedAudioMix: true,        // Graduated Phase 3: 15s bounded PCM chunks (~5.7 MB @ 48kHz)
  useWsolaPitchStretch: true,      // video-studio WSOLA pitch-preserving time stretch
  useMidFrameSeeking: true,        // video-studio (frame + 0.5) / fps mid-frame timestamp seek
  enableExportProfiler: Boolean((import.meta as any).env?.DEV),
  audioSegmentDurationSec: 15,
};

function parseBoolFlag(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (val === '1' || val === 'true') return true;
  if (val === '0' || val === 'false') return false;
  return fallback;
}

export function getExportFlags(): ExportFeatureFlags {
  const winFlags = (typeof window !== 'undefined' && (window as any).__exportFlags) || {};
  const winSeq = typeof window !== 'undefined' ? (window as any).__CG_SEQ_VIDEO_EXPORT : undefined;
  const winAud = typeof window !== 'undefined' ? (window as any).__CG_CHUNKED_AUDIO_EXPORT : undefined;

  const lsSeq =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('cg_seq_video_export') ?? localStorage.getItem('cg_flag_seq_video'))
      : null;
  const lsAud =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('cg_chunked_audio_export') ?? localStorage.getItem('cg_flag_chunk_audio'))
      : null;
  const lsWsola =
    typeof localStorage !== 'undefined' ? localStorage.getItem('cg_flag_wsola_stretch') : null;
  const lsMidFrame =
    typeof localStorage !== 'undefined' ? localStorage.getItem('cg_flag_mid_frame_seek') : null;
  const lsProf =
    typeof localStorage !== 'undefined' ? localStorage.getItem('cg_flag_export_profiler') : null;

  return {
    useSequentialVideoDecoder: parseBoolFlag(
      winSeq ?? winFlags.useSequentialVideoDecoder ?? lsSeq,
      DEFAULT_FLAGS.useSequentialVideoDecoder
    ),
    useChunkedAudioMix: parseBoolFlag(
      winAud ?? winFlags.useChunkedAudioMix ?? lsAud,
      DEFAULT_FLAGS.useChunkedAudioMix
    ),
    useWsolaPitchStretch: parseBoolFlag(
      winFlags.useWsolaPitchStretch ?? lsWsola,
      DEFAULT_FLAGS.useWsolaPitchStretch
    ),
    useMidFrameSeeking: parseBoolFlag(
      winFlags.useMidFrameSeeking ?? lsMidFrame,
      DEFAULT_FLAGS.useMidFrameSeeking
    ),
    enableExportProfiler: parseBoolFlag(
      winFlags.enableExportProfiler ?? lsProf,
      DEFAULT_FLAGS.enableExportProfiler
    ),
    audioSegmentDurationSec:
      winFlags.audioSegmentDurationSec ?? DEFAULT_FLAGS.audioSegmentDurationSec,
  };
}
