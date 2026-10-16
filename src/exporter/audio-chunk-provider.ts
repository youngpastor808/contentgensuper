/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3 — Bounded-Memory Segmented Audio Provider for Browser & Electron Exports.
 */

import { sliceAudioBuffer } from '../audioBufferUtils';
import { getExportFlags } from './export-flags';
import { softClipAudioBuffer } from './wsola-stretcher';

export interface AudioSegmentChunk {
  buffer: AudioBuffer;
  startSample: number;
  endSample: number;
  sampleRate: number;
  numberOfChannels: number;
}

export type AudioSegmentProvider = {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly totalDurationSec: number;
  readonly segmentDurationSec: number;
  /**
   * Renders and returns the next audio segment covering [startSample, endSample),
   * or null when all samples up to totalDurationSec have been produced.
   */
  nextSegment(): Promise<AudioSegmentChunk | null>;
  dispose(): void;
};

export interface AudioMixTelemetry {
  mode: 'chunked' | 'full-buffer';
  segmentsMixed: number;
  totalSamplesEncoded: number;
  maxSegmentSamples: number;
  peakSegmentDurationSec: number;
}

const audioTelemetry: AudioMixTelemetry = {
  mode: 'full-buffer',
  segmentsMixed: 0,
  totalSamplesEncoded: 0,
  maxSegmentSamples: 0,
  peakSegmentDurationSec: 0,
};

export function resetAudioMixTelemetry(mode: 'chunked' | 'full-buffer' = 'full-buffer'): void {
  audioTelemetry.mode = mode;
  audioTelemetry.segmentsMixed = 0;
  audioTelemetry.totalSamplesEncoded = 0;
  audioTelemetry.maxSegmentSamples = 0;
  audioTelemetry.peakSegmentDurationSec = 0;
}

export function recordAudioSegmentMixed(sampleCount: number, sampleRate: number): void {
  audioTelemetry.segmentsMixed++;
  if (sampleCount > audioTelemetry.maxSegmentSamples) {
    audioTelemetry.maxSegmentSamples = sampleCount;
    audioTelemetry.peakSegmentDurationSec = sampleRate > 0 ? sampleCount / sampleRate : 0;
  }
}

export function recordAudioSamplesEncoded(sampleCount: number): void {
  audioTelemetry.totalSamplesEncoded += sampleCount;
}

export function getAudioMixTelemetry(): AudioMixTelemetry {
  return { ...audioTelemetry };
}

/**
 * Connected to unified export flags (enabled by default; can be overridden via
 * localStorage.setItem('cg_chunked_audio_export', '0') or window.__CG_CHUNKED_AUDIO_EXPORT).
 */
export function isChunkedAudioExportEnabled(): boolean {
  return getExportFlags().useChunkedAudioMix;
}

export interface CreateSegmentedAudioProviderOptions {
  totalDurationSec: number;
  sampleRate?: number;
  numberOfChannels?: number;
  segmentDurationSec?: number;
  boundaryPadSec?: number;
  /**
   * Underlying segment mixer (e.g., `mixSegmentAudio(startSec, endSec)` from segmented-exporter.ts).
   * Must apply the exact project mastering, ducking, SFX, bg music, clip audio, and drone for [startSec, endSec].
   */
  mixSegmentFn: (startSec: number, endSec: number) => Promise<AudioBuffer | null>;
}

export function createSegmentedAudioProvider(
  opts: CreateSegmentedAudioProviderOptions
): AudioSegmentProvider {
  const sampleRate = opts.sampleRate || 44100;
  const numberOfChannels = opts.numberOfChannels || 2;
  const totalDurationSec = Math.max(0, opts.totalDurationSec);
  const segmentDurationSec = Math.max(
    2,
    opts.segmentDurationSec || getExportFlags().audioSegmentDurationSec || 15
  );
  const boundaryPadSec = Math.max(0, opts.boundaryPadSec ?? 0.12);

  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  const samplesPerSegment = Math.max(sampleRate, Math.round(segmentDurationSec * sampleRate));

  let cursorSample = 0;
  let disposed = false;

  return {
    sampleRate,
    numberOfChannels,
    totalDurationSec,
    segmentDurationSec,

    async nextSegment(): Promise<AudioSegmentChunk | null> {
      if (disposed || cursorSample >= totalSamples) {
        return null;
      }

      const startSample = cursorSample;
      const endSample = Math.min(totalSamples, startSample + samplesPerSegment);
      cursorSample = endSample;

      const wantedFrames = endSample - startSample;
      if (wantedFrames <= 0) return null;

      const exactStartSec = startSample / sampleRate;
      const exactEndSec = endSample / sampleRate;

      // Render with lookbehind/lookahead padding so ducking ramps and dynamics stay continuous across cuts
      const padBeforeSec = startSample > 0 ? Math.min(boundaryPadSec, exactStartSec) : 0;
      const padAfterSec =
        endSample < totalSamples ? Math.min(boundaryPadSec, totalDurationSec - exactEndSec) : 0;

      const renderStartSec = exactStartSec - padBeforeSec;
      const renderEndSec = exactEndSec + padAfterSec;

      const rawBuffer = await opts.mixSegmentFn(renderStartSec, renderEndSec);
      if (disposed) return null;

      const actualRate = rawBuffer?.sampleRate || sampleRate;
      const actualChannels = rawBuffer?.numberOfChannels || numberOfChannels;

      let trimmedBuffer: AudioBuffer;
      if (!rawBuffer) {
        const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        const silentCtx = new OfflineCtx(actualChannels, wantedFrames, actualRate);
        trimmedBuffer = silentCtx.createBuffer(actualChannels, wantedFrames, actualRate);
      } else if (padBeforeSec > 0 || padAfterSec > 0) {
        trimmedBuffer = sliceAudioBuffer(
          rawBuffer,
          padBeforeSec,
          padBeforeSec + (exactEndSec - exactStartSec)
        );
      } else {
        trimmedBuffer = rawBuffer;
      }

      // Apply video-studio polynomial soft-clip limiter so summed buses never clip harshly
      softClipAudioBuffer(trimmedBuffer);

      recordAudioSegmentMixed(trimmedBuffer.length, actualRate);

      return {
        buffer: trimmedBuffer,
        startSample,
        endSample: startSample + trimmedBuffer.length,
        sampleRate: actualRate,
        numberOfChannels: actualChannels,
      };
    },

    dispose(): void {
      disposed = true;
    },
  };
}
