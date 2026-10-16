/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from 'mediabunny';

export interface ExportVideoSource {
  src: string;
  input: Input;
  track: any;
  sink: VideoSampleSink;
}

const sources = new Map<string, Promise<ExportVideoSource | null>>();

export async function getVideoSampleSource(src: string): Promise<ExportVideoSource | null> {
  if (!src) return null;
  const existing = sources.get(src);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) {
        sources.delete(src);
        return null;
      }
      const sink = new VideoSampleSink(track);
      return { src, input, track, sink };
    } catch (error) {
      sources.delete(src);
      console.warn('[VideoSampleCache] Failed to initialize video sample source for:', src, error);
      return null;
    }
  })();

  sources.set(src, promise);
  return promise;
}

export async function preloadExportVideoSources(clips: any[]): Promise<void> {
  const videoSources = new Set<string>();
  for (const clip of clips || []) {
    const video = clip?.videoElement || clip?.talkingHeadVideoElement || clip?.secondaryVideoElement;
    if (!video) continue;
    const src = video.currentSrc || video.src;
    if (src && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:'))) {
      videoSources.add(src);
    }
  }
  const tasks = Array.from(videoSources).map((src) => getVideoSampleSource(src));
  await Promise.all(tasks);
}

export async function clearVideoSampleCache(): Promise<void> {
  const pending = Array.from(sources.values());
  sources.clear();
  for (const p of pending) {
    try {
      const entry = await p;
      entry?.input?.dispose?.();
    } catch {}
  }
}
