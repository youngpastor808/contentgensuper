/**
 * Audio-reactive data provider (shared by the browser engines and the Remotion cloud render).
 *
 * In the browser, graphics read audio energy straight from AudioBuffers
 * (timelineState.masterAudioBuffer / state._bgAudioBuffer). Remotion Lambda has no
 * AudioBuffers, so the browser PRE-COMPUTES the same numbers per frame with the same
 * functions and ships them in the render payload. Inside Remotion a provider is
 * installed here and the engines prefer it over the (absent) buffers.
 *
 * This module has NO imports on purpose: both graphics-engine.ts and
 * hyperframes-engine.ts import it, and it must stay free of import cycles.
 */
export interface AudioEnergySampleLike {
  rms: number;
  bass: number;
  mid: number;
  beatPulse: number;
}

export interface AudioReactiveProvider {
  /** Return the pre-computed spectrum band energies (0..1) for `bands` at `time`, or null if not covered. */
  getSpectrum(bands: number, time: number): Float32Array | null;
  /** Return the pre-computed HyperFrames energy sample at `time`, or null if not covered. */
  getEnergy(time: number): AudioEnergySampleLike | null;
}

let provider: AudioReactiveProvider | null = null;

export function setAudioReactiveProvider(p: AudioReactiveProvider | null): void {
  provider = p;
}

export function getAudioReactiveProvider(): AudioReactiveProvider | null {
  return provider;
}
