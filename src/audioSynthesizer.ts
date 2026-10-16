/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Standalone Web Audio API Procedural Synthesizer for ContentGen AI.
 * Provides instant real-time sound effects and deterministic offline audio generation
 * with zero external dependencies or network latency.
 */

import * as utils from './utils';

export type ProceduralSfxType =
  | 'none'
  | 'whoosh'
  | 'pop'
  | 'hit'
  | 'ping'
  | 'laser'
  | 'riser'
  | 'glitch'
  | 'bass_drop'
  | 'cyber_chime'
  | 'impact'
  | 'chord';

export interface SfxOption {
  id: ProceduralSfxType;
  label: string;
  category: 'motion' | 'impact' | 'ui' | 'tech' | 'cinematic' | 'none';
  description: string;
}

export const PROCEDURAL_SFX_OPTIONS: SfxOption[] = [
  { id: 'none', label: 'None (Silent)', category: 'none', description: 'No audio cue triggered on entrance' },
  { id: 'whoosh', label: '💨 Kinetic Whoosh', category: 'motion', description: 'Smooth filtered noise sweep for slide-ins & card reveals' },
  { id: 'pop', label: '🫧 UI Pop / Bubble', category: 'ui', description: 'Bouncy frequency dive for badges, tags & pills' },
  { id: 'hit', label: '🔨 Punchy Impact Hit', category: 'impact', description: 'Downward triangle punch for bold headlines & titles' },
  { id: 'ping', label: '🔔 Metric Crystal Ping', category: 'ui', description: 'High bell resonance for statistics, counters & numbers' },
  { id: 'laser', label: '⚡ Cyber Laser Zap', category: 'tech', description: 'Downward sawtooth sweep for tech, deals & flash sales' },
  { id: 'riser', label: '📈 Tension Riser Sweep', category: 'cinematic', description: 'Crescendo pitch buildup for pattern interrupts & hooks' },
  { id: 'glitch', label: '👾 Digital Glitch', category: 'tech', description: 'Square wave frequency modulated cyber glitch' },
  { id: 'bass_drop', label: '🔊 Sub Bass Drop', category: 'impact', description: 'Low sine sub bass dive for heavy music drops' },
  { id: 'cyber_chime', label: '✨ Cyber Triad Chime', category: 'ui', description: 'Arpeggiated high chime for 5-star ratings & reviews' },
  { id: 'impact', label: '💥 Heavy Impact', category: 'impact', description: 'Broadband impact transient for scene transitions & cuts' },
  { id: 'chord', label: '🎹 Harmonic Synth Chord', category: 'cinematic', description: 'Major triad synth pad decay for cinematic act chapters' },
];

export class AudioSynthesizer {
  private static instance: AudioSynthesizer | null = null;

  public static getInstance(): AudioSynthesizer {
    if (!this.instance) {
      this.instance = new AudioSynthesizer();
    }
    return this.instance;
  }

  /**
   * Plays a procedural sound effect live through the global Web Audio context.
   */
  public playSfx(type: ProceduralSfxType, volume = 0.5, freq = 440): void {
    if (typeof window === 'undefined' || !type || type === 'none') return;
    try {
      const audioCtx = utils.getAudioContext();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      const t = audioCtx.currentTime;

      if (type === 'whoosh') {
        const bufferSize = Math.floor(audioCtx.sampleRate * 0.35);
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3.5;
        filter.frequency.setValueAtTime(200, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
        filter.frequency.exponentialRampToValueAtTime(300, t + 0.35);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(volume * 0.7, t + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(t);
      } else if (type === 'pop') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.5, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.12);
        gain.gain.setValueAtTime(volume * 0.8, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      } else if (type === 'hit') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.3);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.35);
      } else if (type === 'ping') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq || 880, t);
        gain.gain.setValueAtTime(volume * 0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      } else if (type === 'laser') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1800, t);
        osc.frequency.exponentialRampToValueAtTime(120, t + 0.15);
        gain.gain.setValueAtTime(volume * 0.6, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.16);
      } else if (type === 'riser') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.8);
        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(volume * 0.6, t + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.85);
      } else if (type === 'glitch') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq * 2, t);
        osc.frequency.setValueAtTime(freq * 0.5, t + 0.05);
        osc.frequency.setValueAtTime(freq * 3, t + 0.1);
        gain.gain.setValueAtTime(volume * 0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.18);
      } else if (type === 'bass_drop') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(36, t + 0.55);

        gain.gain.setValueAtTime(volume * 0.85, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      } else if (type === 'cyber_chime') {
        const freqs = [880, 1320, 1760];
        freqs.forEach((f, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t + idx * 0.035);
          gain.gain.setValueAtTime(volume * 0.28, t + idx * 0.035);
          gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.035 + 0.35);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t + idx * 0.035);
          osc.stop(t + idx * 0.035 + 0.4);
        });
      } else if (type === 'impact') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.35);
        gain.gain.setValueAtTime(volume * 0.75, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.38);
      } else if (type === 'chord') {
        const baseFreq = freq || 261.63; // C4
        const triad = [baseFreq, baseFreq * 1.25, baseFreq * 1.5];
        triad.forEach((f) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.01, t);
          gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t);
          osc.stop(t + 0.8);
        });
      }
    } catch (e) {
      // Non-fatal if audio context not available
    }
  }

  /**
   * Synthesize an AudioBuffer offline for export mixing.
   */
  public async synthesizeSfxBuffer(type: ProceduralSfxType, volume = 0.6, freq = 440): Promise<AudioBuffer | null> {
    if (typeof window === 'undefined' || !type || type === 'none') return null;
    try {
      const sampleRate = 44100;
      const duration = 1.0;
      const OfflineCtxClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      if (!OfflineCtxClass) return null;
      const offlineCtx = new OfflineCtxClass(1, Math.floor(sampleRate * duration), sampleRate);
      const t = 0;

      if (type === 'whoosh') {
        const bufferSize = Math.floor(sampleRate * 0.35);
        const noiseBuf = offlineCtx.createBuffer(1, bufferSize, sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = offlineCtx.createBufferSource();
        noise.buffer = noiseBuf;

        const filter = offlineCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3.5;
        filter.frequency.setValueAtTime(200, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
        filter.frequency.exponentialRampToValueAtTime(300, t + 0.35);

        const gain = offlineCtx.createGain();
        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(volume * 0.7, t + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(offlineCtx.destination);
        noise.start(t);
      } else if (type === 'pop') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 1.5, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.12);
        gain.gain.setValueAtTime(volume * 0.8, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      } else if (type === 'hit') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.3);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.35);
      } else if (type === 'ping') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 2, t);
        gain.gain.setValueAtTime(volume * 0.9, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.4);
      } else if (type === 'laser') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * 2.2, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.22);
        gain.gain.setValueAtTime(volume * 0.7, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.22);
      } else if (type === 'riser') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(volume * 0.65, t + 0.45);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.52);
      } else if (type === 'glitch') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(320, t);
        osc.frequency.setValueAtTime(880, t + 0.05);
        osc.frequency.setValueAtTime(140, t + 0.1);
        gain.gain.setValueAtTime(volume * 0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      } else if (type === 'bass_drop') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(32, t + 0.6);
        gain.gain.setValueAtTime(volume * 0.9, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      } else if (type === 'cyber_chime') {
        const freqs = [880, 1320, 1760];
        freqs.forEach((f, idx) => {
          const osc = offlineCtx.createOscillator();
          const gain = offlineCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t + idx * 0.035);
          gain.gain.setValueAtTime(volume * 0.28, t + idx * 0.035);
          gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.035 + 0.35);
          osc.connect(gain);
          gain.connect(offlineCtx.destination);
          osc.start(t + idx * 0.035);
          osc.stop(t + idx * 0.035 + 0.4);
        });
      } else if (type === 'impact') {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.35);
        gain.gain.setValueAtTime(volume * 0.75, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(t);
        osc.stop(t + 0.38);
      } else if (type === 'chord') {
        const baseFreq = freq || 261.63;
        const triad = [baseFreq, baseFreq * 1.25, baseFreq * 1.5];
        triad.forEach((f) => {
          const osc = offlineCtx.createOscillator();
          const gain = offlineCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, t);
          gain.gain.setValueAtTime(0.01, t);
          gain.gain.linearRampToValueAtTime(volume * 0.35, t + 0.08);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
          osc.connect(gain);
          gain.connect(offlineCtx.destination);
          osc.start(t);
          osc.stop(t + 0.8);
        });
      }

      return await offlineCtx.startRendering();
    } catch {
      return null;
    }
  }
}

export const audioSynthesizer = AudioSynthesizer.getInstance();
