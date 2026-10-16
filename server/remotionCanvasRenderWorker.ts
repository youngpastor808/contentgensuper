/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Drop-in replacement for renderCloudVideoWithCanvas() (cloudCanvasWorker.ts),
 * using Remotion's programmatic renderer to drive the CanvasStoryboardVideo
 * composition (remotion/src/CanvasStoryboardVideo.tsx), which itself calls
 * your existing exportBridge.ts / videoRenderer.ts draw code frame-by-frame.
 *
 * Uses @remotion/bundler's bundle() and @remotion/renderer's
 * selectComposition()/renderMedia() — the documented, stable programmatic
 * API (not the CLI, not an internal/undocumented surface).
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildCanonicalExportPayload } from '../src/exporter/canonical-payload';
import { prepareTimelineAudioMix } from './_core/audioMixer';

export interface CloudRenderOptions {
  inputProps: any;
  fps: number;
  resolution: string;
  durationInFrames: number;
  outputFilePath: string;
  appBaseUrl: string;
  onProgress?: (progress: number) => void;
}

function toLoopback(url: string | undefined, appBaseUrl: string): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    const base = new URL(appBaseUrl);
    if (u.pathname.startsWith('/api/cloud-render/assets/')) {
      u.protocol = base.protocol;
      u.host = base.host;
      return u.toString();
    }
  } catch {
    /* relative path, leave as-is */
  }
  return url;
}

/** Builds the single CanonicalExportPayload that exportBridge.ts and CanvasStoryboardVideo expect. */
function buildExportPayload(inputProps: any, width: number, height: number, fps: number, appBaseUrl: string) {
  return buildCanonicalExportPayload({
    inputProps,
    width,
    height,
    fps,
    appBaseUrl,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Same audio-resolution semantics as cloudCanvasWorker.ts's resolveAudioToLocalFile(). */
async function resolveAudioToLocalFile(audioUrl?: string, tmpPrefix = 'worker_audio'): Promise<string | null> {
  if (!audioUrl || typeof audioUrl !== 'string') return null;
  if (fs.existsSync(audioUrl) && fs.statSync(audioUrl).size > 50) return audioUrl;

  if (audioUrl.startsWith('data:audio/')) {
    const base64Data = audioUrl.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64Data, 'base64');
    const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}.wav`);
    await fs.promises.writeFile(outPath, buf);
    return outPath;
  }

  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    const res = await fetch(audioUrl);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = audioUrl.endsWith('.mp3') ? '.mp3' : '.wav';
      const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}${ext}`);
      await fs.promises.writeFile(outPath, buf);
      return outPath;
    }
  }
  return null;
}

async function muxAudio(
  silentVideoPath: string,
  inputProps: any,
  appBaseUrl: string,
  outputFilePath: string
): Promise<void> {
  let finalAudioPath: string | null = null;
  let audioCleanupList: string[] = [];
  let proc: ReturnType<typeof spawn> | null = null;
  try {
    const mixResult = await prepareTimelineAudioMix(inputProps, appBaseUrl);
    finalAudioPath = mixResult.finalAudioPath;
    audioCleanupList = mixResult.cleanupPaths;

    const muxArgs = ['-y', '-i', silentVideoPath];
    if (finalAudioPath) muxArgs.push('-i', finalAudioPath);
    muxArgs.push('-c:v', 'copy');
    if (finalAudioPath) muxArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    muxArgs.push(outputFilePath);

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        proc = spawn('ffmpeg', muxArgs);
        let err = '';
        proc.stderr?.on('data', (d) => {
          err += d.toString();
        });
        proc.on('error', reject);
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`Final audio mux failed: ${err.slice(-500)}`))
        );
      }),
      60000,
      'Final audio mux'
    );
  } catch (err) {
    if (proc && !(proc as any).killed) {
      try {
        (proc as any).kill('SIGKILL');
      } catch {}
    }
    throw err;
  } finally {
    for (const p of audioCleanupList) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
}

// Bundle once per process, not per render — bundling is the slow step and
// your composition entry point doesn't change between renders.
let cachedBundleUrl: string | null = null;
async function getBundleUrl(remotionEntryPoint: string): Promise<string> {
  if (cachedBundleUrl) return cachedBundleUrl;
  cachedBundleUrl = await bundle({
    entryPoint: remotionEntryPoint,
  });
  return cachedBundleUrl;
}

export async function renderCloudVideoWithRemotionCanvas(
  opts: CloudRenderOptions,
  remotionEntryPointAbsPath: string
): Promise<string> {
  const { inputProps, fps, resolution, outputFilePath, appBaseUrl, onProgress } = opts;

  const resMap: Record<string, { width: number; height: number }> = {
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '4k': { width: 3840, height: 2160 },
  };
  let { width, height } = resMap[resolution] || { width: 1920, height: 1080 };
  if (inputProps.aspectRatio === '9:16') {
    const t = width;
    width = height;
    height = t;
  } else if (inputProps.aspectRatio === '1:1') {
    width = Math.min(width, height);
    height = width;
  }

  const payload = buildExportPayload(inputProps, width, height, fps, appBaseUrl);
  const bundleUrl = await getBundleUrl(remotionEntryPointAbsPath);

  const composition = await selectComposition({
    serveUrl: bundleUrl,
    id: 'CanvasStoryboardVideo',
    inputProps: { payload },
  });

  const silentVideoPath = path.join(os.tmpdir(), `remotion_canvas_${Date.now()}.mp4`);
  try {
    await withTimeout(
      renderMedia({
        composition,
        serveUrl: bundleUrl,
        codec: 'h264',
        outputLocation: silentVideoPath,
        inputProps: { payload },
        onProgress: ({ progress }) => onProgress?.(Math.round(progress * 90)),
      }),
      30 * 60 * 1000,
      'Remotion canvas render'
    );
    await muxAudio(silentVideoPath, inputProps, appBaseUrl, outputFilePath);
    onProgress?.(100);
    console.log(`[Remotion Canvas Worker] Render complete: ${outputFilePath}`);
    return outputFilePath;
  } finally {
    try {
      if (fs.existsSync(silentVideoPath)) fs.unlinkSync(silentVideoPath);
    } catch {}
  }
}
