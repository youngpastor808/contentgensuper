/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from '../dom';
import * as ui from '../ui';
import * as utils from '../utils';
import { Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource } from 'mediabunny';
import { cleanVideoMetadataWithServer } from './backend-ffmpeg';
import { calculateBitrate, selectSupportedVideoCodec } from './codecs';
import { syncTaskbarProgress } from './electron-bridge';
import { ChunkedMemoryTarget, tryInitOpfsExport } from './file-targets';
import { encodeToMuxer, AudioSegmentProvider } from './muxer';
import { videoRenderContext } from '../videoRenderer';

export async function exportWithMemory(
  format: 'mp4' | 'webm',
  filename: string,
  width: number,
  height: number,
  audioBuffer: AudioBuffer | null,
  hasAudio: boolean,
  preferHardware: boolean,
  audioSegmentProvider?: AudioSegmentProvider
) {
  const fps = dom.videoExportFpsSelect ? parseInt(dom.videoExportFpsSelect.value) || 30 : 30;
  const totalDuration = videoRenderContext?.totalDuration || 60;
  const projectedBytes = (calculateBitrate(width, height, fps, format) / 8) * totalDuration;
  const opfs = await tryInitOpfsExport(filename, projectedBytes);
  
  // 2. Fallback to RAM only if OPFS fails
  const chunkManager = opfs ? null : new ChunkedMemoryTarget();

  const handleData = async (data: Uint8Array, position: number) => {
    if (opfs) {
      await opfs.stream.seek(position);
      await opfs.stream.write(data);
    } else {
      chunkManager!.seek(position);
      chunkManager!.write(data);
    }
  };

  const target = new StreamTarget(
    new WritableStream({
      async write(chunk: any) {
        await handleData(chunk.data, chunk.position);
      }
    })
  );

  const videoBitrate = calculateBitrate(width, height, fps, format);
  const selectedVideoCodec = await selectSupportedVideoCodec(format, width, height, videoBitrate, fps, preferHardware);

  const output = new Output({
    format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat({}),
    target
  });

  const videoSource = new EncodedVideoPacketSource(selectedVideoCodec.muxerCodec as any);
  output.addVideoTrack(videoSource, { frameRate: fps });

  let audioSource: EncodedAudioPacketSource | null = null;
  if (hasAudio && (audioBuffer || audioSegmentProvider)) {
    audioSource = new EncodedAudioPacketSource(format === 'mp4' ? 'aac' : 'opus');
    output.addAudioTrack(audioSource);
  }

  await output.start();

  await encodeToMuxer(
    videoSource,
    audioSource,
    format,
    width,
    height,
    fps,
    audioBuffer,
    hasAudio,
    selectedVideoCodec.encoderCodec,
    videoBitrate,
    selectedVideoCodec.hardwareAcceleration,
    (progress, message) => {
      ui.updateProcessingProgress(progress, message);
      syncTaskbarProgress(progress);
    },
    undefined,
    audioSegmentProvider
  );

  ui.updateProcessingProgress(95, 'Finalizing video file...');
  await output.finalize();

  // 3. Extract the finalized file from either OPFS or RAM
  let finalBlob: Blob | File;
  
  if (opfs) {
    await opfs.stream.close();
    finalBlob = await opfs.handle.getFile();
  } else {
    finalBlob = chunkManager!.getBlob(`video/${format}`) as Blob;
  }

  if (!finalBlob || finalBlob.size < 4096) {
    throw new Error(`Export produced an invalid video file (${finalBlob?.size || 0} bytes). Check that timeline shots are loaded.`);
  }

  const shouldClean = dom.videoExportCleanMetadataCheckbox ? dom.videoExportCleanMetadataCheckbox.checked : true;
  if (shouldClean && format === 'mp4') {
    ui.updateProcessingProgress(98, 'Applying authentic device profile & stripping C2PA metadata...');
    finalBlob = await cleanVideoMetadataWithServer(finalBlob, (msg) => ui.updateProcessingProgress(98, msg));
  }

  await utils.downloadBlob(finalBlob, filename);

  // 4. Cleanup OPFS temporary file entry if used
  if (opfs) {
    setTimeout(async () => {
      try {
        const root: any = await (navigator as any).storage.getDirectory();
        await root.removeEntry(opfs.handle.name);
      } catch (e) {
        console.warn('Failed to clean up OPFS entry:', e);
      }
    }, 60000);
  }

  // Trigger native desktop notification if in Electron
  // @ts-ignore
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    try {
      // @ts-ignore
      const electron = (window as any).electronAPI;
      const invoke = electron.invoke || electron.ipcRenderer?.invoke;
      if (invoke) {
        invoke.call(electron, 'show-notification', {
          title: 'Export Complete',
          body: `Your video ${filename} has finished rendering.`
        });
      }
    } catch(e) {
      console.warn("Electron notification error:", e);
    }
  }
}
