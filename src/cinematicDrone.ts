/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Procedural Cinematic Drone Audio Synthesizer
 * Generates an atmospheric 55Hz sub-bass drone with a lowpass filter swell
 * and stereo binaural detuning using the Web Audio API.
 */

/**
 * Encodes an AudioBuffer into a standard 16-bit PCM WAV Blob
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const dataView = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      dataView.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  dataView.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');

  // "fmt " sub-chunk
  writeString(12, 'fmt ');
  dataView.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  dataView.setUint16(20, format, true); // AudioFormat (1 = PCM)
  dataView.setUint16(22, numChannels, true);
  dataView.setUint32(24, sampleRate, true);
  dataView.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  dataView.setUint16(32, blockAlign, true);
  dataView.setUint16(34, bitDepth, true);

  // "data" sub-chunk
  writeString(36, 'data');
  dataView.setUint32(40, dataSize, true);

  // Interleave and write 16-bit PCM samples
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      dataView.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Procedurally generates a cinematic sub-bass drone AudioBuffer directly
 */
export async function generateCinematicDroneBuffer(
  duration: number = 6.0,
  sampleRate: number = 44100,
  volume: number = 0.6
): Promise<AudioBuffer> {
  const safeDuration = Math.max(0.5, duration);
  const totalSamples = Math.ceil(safeDuration * sampleRate);
  const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const offlineCtx: OfflineAudioContext = new OfflineCtx(2, totalSamples, sampleRate);

  const fadeInEnd = Math.min(0.6, safeDuration * 0.25);
  const fadeOutStart = Math.max(fadeInEnd, safeDuration - Math.min(0.7, safeDuration * 0.25));

  const masterGain = offlineCtx.createGain();
  masterGain.gain.setValueAtTime(0, 0);
  masterGain.gain.linearRampToValueAtTime(volume * 0.45, fadeInEnd);
  masterGain.gain.setValueAtTime(volume * 0.45, fadeOutStart);
  masterGain.gain.linearRampToValueAtTime(0, safeDuration);
  masterGain.connect(offlineCtx.destination);

  // Evolving low-pass filter (swells from 260Hz -> 440Hz -> 280Hz for cinematic breathing)
  const lowPassFilter = offlineCtx.createBiquadFilter();
  lowPassFilter.type = 'lowpass';
  lowPassFilter.frequency.setValueAtTime(260, 0);
  lowPassFilter.frequency.exponentialRampToValueAtTime(440, safeDuration * 0.55);
  lowPassFilter.frequency.exponentialRampToValueAtTime(280, safeDuration);
  lowPassFilter.Q.setValueAtTime(1.6, 0);
  lowPassFilter.connect(masterGain);

  // Slow pitch drift LFO (adds organic analog tape feel)
  const lfo = offlineCtx.createOscillator();
  lfo.frequency.setValueAtTime(0.15, 0);
  const lfoGain = offlineCtx.createGain();
  lfoGain.gain.setValueAtTime(0.6, 0);
  lfo.connect(lfoGain);

  // Stereo binaural detuned pair (54.82Hz Left / 55.18Hz Right) for wide analog warmth
  const oscLeft = offlineCtx.createOscillator();
  const oscRight = offlineCtx.createOscillator();
  oscLeft.type = 'sawtooth';
  oscRight.type = 'triangle';
  oscLeft.frequency.setValueAtTime(54.82, 0);
  oscRight.frequency.setValueAtTime(55.18, 0);
  lfoGain.connect(oscLeft.frequency);
  lfoGain.connect(oscRight.frequency);

  const stereoGain = offlineCtx.createGain();
  stereoGain.gain.setValueAtTime(0.55, 0);

  if (typeof offlineCtx.createStereoPanner === 'function') {
    const panLeft = offlineCtx.createStereoPanner();
    const panRight = offlineCtx.createStereoPanner();
    panLeft.pan.setValueAtTime(-0.65, 0);
    panRight.pan.setValueAtTime(0.65, 0);
    oscLeft.connect(panLeft);
    oscRight.connect(panRight);
    panLeft.connect(stereoGain);
    panRight.connect(stereoGain);
  } else {
    oscLeft.connect(stereoGain);
    oscRight.connect(stereoGain);
  }
  stereoGain.connect(lowPassFilter);

  // Center 27.5Hz sub-harmonic foundation
  const oscSub = offlineCtx.createOscillator();
  oscSub.type = 'sine';
  oscSub.frequency.setValueAtTime(27.5, 0);
  const subGain = offlineCtx.createGain();
  subGain.gain.setValueAtTime(0.42, 0);
  oscSub.connect(subGain);
  subGain.connect(lowPassFilter);

  lfo.start(0);
  oscLeft.start(0);
  oscRight.start(0);
  oscSub.start(0);

  lfo.stop(safeDuration);
  oscLeft.stop(safeDuration);
  oscRight.stop(safeDuration);
  oscSub.stop(safeDuration);

  return await offlineCtx.startRendering();
}

/**
 * Procedurally generates a cinematic sub-bass drone WAV audio Blob
 */
export async function generateCinematicDroneAudio(
  duration: number = 6.0,
  volume: number = 0.6
): Promise<Blob> {
  const renderedBuffer = await generateCinematicDroneBuffer(duration, 44100, volume);
  return audioBufferToWav(renderedBuffer);
}

/**
 * Controls live real-time drone audio for playback preview
 */
export class LiveCinematicDrone {
  private audioCtx: AudioContext | null = null;
  private oscs: OscillatorNode[] = [];
  private gainNode: GainNode | null = null;
  private isRunning: boolean = false;

  start(audioCtx?: AudioContext, volume: number = 0.3) {
    if (this.isRunning) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = audioCtx || new AudioCtx();
      const ctx = this.audioCtx!;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const now = ctx.currentTime;
      this.gainNode = ctx.createGain();
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(volume * 0.45, now + 0.4);
      this.gainNode.connect(ctx.destination);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(340, now);
      filter.Q.setValueAtTime(1.6, now);
      filter.connect(this.gainNode);

      const oscLeft = ctx.createOscillator();
      const oscRight = ctx.createOscillator();
      const oscSub = ctx.createOscillator();
      oscLeft.type = 'sawtooth';
      oscRight.type = 'triangle';
      oscSub.type = 'sine';
      oscLeft.frequency.setValueAtTime(54.82, now);
      oscRight.frequency.setValueAtTime(55.18, now);
      oscSub.frequency.setValueAtTime(27.5, now);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.4, now);
      oscSub.connect(subGain);
      subGain.connect(filter);

      oscLeft.connect(filter);
      oscRight.connect(filter);

      oscLeft.start(now);
      oscRight.start(now);
      oscSub.start(now);

      this.oscs = [oscLeft, oscRight, oscSub];
      this.isRunning = true;
    } catch (e) {
      console.warn('[LiveCinematicDrone] Failed to start live drone:', e);
    }
  }

  setVolume(volume: number) {
    if (!this.gainNode || !this.audioCtx) return;
    const clamped = Math.max(0, Math.min(1, volume));
    this.gainNode.gain.setTargetAtTime(clamped * 0.45, this.audioCtx.currentTime, 0.08);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    const ctx = this.audioCtx;
    const gain = this.gainNode;
    const activeOscs = [...this.oscs];
    this.oscs = [];
    this.gainNode = null;

    if (ctx && gain) {
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.15);
        setTimeout(() => {
          activeOscs.forEach((o) => {
            try {
              o.stop();
              o.disconnect();
            } catch {}
          });
          try {
            gain.disconnect();
          } catch {}
        }, 180);
        return;
      } catch {}
    }

    activeOscs.forEach((o) => {
      try {
        o.stop();
        o.disconnect();
      } catch {}
    });
  }
}

export const liveCinematicDrone = new LiveCinematicDrone();
