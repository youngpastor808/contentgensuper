/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import { Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource } from 'mediabunny';
import { calculateBitrate, selectSupportedVideoCodec } from './codecs';
import { logExportMemory, syncTaskbarProgress } from './electron-bridge';
import { encodeToMuxer, AudioSegmentProvider } from './muxer';
import { startExportStage, endExportStage } from './export-profiler';


export async function exportWithStreaming(
    stream: FileSystemWritableFileStream,
    format: 'mp4' | 'webm',
    width: number,
    height: number,
    audioBuffer: AudioBuffer | null,
    hasAudio: boolean,
    preferHardware: boolean,
    audioSegmentProvider?: AudioSegmentProvider
) {
    const writer: any = stream.getWriter();

    let writeQueue: Promise<any> = Promise.resolve();
    let pendingBytes = 0;
    let pendingWrites = 0;
    let writeError: Error | null = null;

    // Stream buffering configuration:
    // With chunked: true (4MB chunks), we prevent per-packet Electron IPC stalls.
    const MAX_PENDING_BYTES = 16 * 1024 * 1024;
    const MAX_PENDING_WRITES = 4; // Chunks are 4MB now, so 4 in flight is optimal for throughput without memory pressure.

    let backpressurePromise: Promise<void> | null = null;
    let backpressureResolve: (() => void) | null = null;
    let backpressureReject: ((error: Error) => void) | null = null;

    const rejectBackpressure = (error: Error) => {
        const reject = backpressureReject;
        backpressureReject = null;
        backpressureResolve = null;
        backpressurePromise = null;
        reject?.(error);
    };

    const handleData = (data: Uint8Array, position: number) => {
        if (!data || data.byteLength === 0) return;

        if (writeError) {
            throw writeError;
        }

        const len = data.byteLength;

        pendingBytes += len;
        pendingWrites++;

        /*
         * IMPORTANT:
         * Do NOT copy the data here.
         *
         * The old implementation caused unnecessary memory duplication
         * during MP4 finalization.
         */
        const writeData = data;

        writeQueue = writeQueue.then(async () => {
            if (writeError) return;

            try {
                await writer.write({
                    type: 'write',
                    data: writeData,
                    position
                });
            } catch (err: any) {
                writeError =
                    err instanceof Error
                        ? err
                        : new Error(String(err));

                console.error('[EXPORT] Electron disk write failed:', writeError);
                rejectBackpressure(writeError);
                // Keep the queue promise fulfilled so already-queued entries
                // can decrement their accounting instead of poisoning the chain.
                return;
            } finally {
                pendingBytes = Math.max(0, pendingBytes - len);
                pendingWrites = Math.max(0, pendingWrites - 1);

                if (
                    backpressureResolve &&
                    pendingBytes <= MAX_PENDING_BYTES / 2 &&
                    pendingWrites <= MAX_PENDING_WRITES / 2
                ) {
                    const resolve = backpressureResolve;

                    backpressureResolve = null;
                    backpressureReject = null;
                    backpressurePromise = null;

                    resolve();
                }
            }
        });

        return writeQueue;
    };

    const flushWrites = async () => {
        await writeQueue;

        if (writer.flush) {
            await writer.flush();
        }

        if (writeError) {
            throw writeError;
        }
    };

    const checkBackpressure = async () => {
        if (writeError) {
            throw writeError;
        }

        if (
            pendingBytes > MAX_PENDING_BYTES ||
            pendingWrites > MAX_PENDING_WRITES
        ) {
            if (!backpressurePromise) {
                backpressurePromise = new Promise<void>((resolve, reject) => {
                    backpressureResolve = resolve;
                    backpressureReject = reject;
                });
            }

            await backpressurePromise;
        }

        if (writeError) {
            throw writeError;
        }
    };

    const target = new StreamTarget(
        new WritableStream({
            async write(chunk: any) {
                startExportStage('disk-write');
                try {
                    await handleData(chunk.data, chunk.position);
                    await checkBackpressure();
                } finally {
                    endExportStage('disk-write');
                }
            }
        }),
        { chunked: true, chunkSize: 4 * 1024 * 1024 }
    );

    const fps = dom.videoExportFpsSelect
        ? parseInt(dom.videoExportFpsSelect.value) || 30
        : 30;

    const videoBitrate = calculateBitrate(
        width,
        height,
        fps,
        format
    );

    const selectedVideoCodec =
        await selectSupportedVideoCodec(
            format,
            width,
            height,
            videoBitrate,
            fps,
            preferHardware
        );

    console.log('[EXPORT] Codec:', selectedVideoCodec);
    console.log('[EXPORT] Resolution:', width, height);
    console.log('[EXPORT] FPS:', fps);
    console.log('[EXPORT] Bitrate:', videoBitrate);

    const output = new Output({
        format: format === 'mp4'
            ? new Mp4OutputFormat({ fastStart: false })
            : new WebMOutputFormat({}),
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

    let finalized = false;

    try {
        logExportMemory('before encoding');

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
            checkBackpressure,
            audioSegmentProvider
        );

        /*
         * VERY IMPORTANT:
         *
         * Wait until every encoded chunk has reached disk before
         * starting finalization.
         */
        await flushWrites();

        if (!state.isVideoProductionRunning) {
            throw new Error('Cancelled.');
        }

        ui.updateProcessingProgress(
            95,
            'Finalizing video file...'
        );

        console.log(
            '[EXPORT] ========================================'
        );
        console.log('[EXPORT] STARTING MP4 FINALIZATION');
        console.log('[EXPORT] ========================================');

        logExportMemory('before finalize');

        /*
         * MP4 muxer finalization is synchronous.
         *
         * Give Chromium one event-loop turn before doing it.
         * This reduces pressure caused by the encoder and IPC queues.
         */
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
        });

        if (!state.isVideoProductionRunning) {
            throw new Error('Cancelled.');
        }

        console.log('[EXPORT] Finalizing muxer...');

        /*
         * FINALIZE ONLY ONCE.
         */
        if (!finalized) {
            finalized = true;

            try {
                await output.finalize();
            } catch (err: any) {
                console.error(
                    '[EXPORT] output.finalize() FAILED:',
                    err
                );

                throw new Error(
                    `MP4 finalization failed: ${
                        err?.message || String(err)
                    }`
                );
            }
        }

        console.log(
            '[EXPORT] Muxer finalized. Waiting for final disk writes...'
        );

        logExportMemory('after finalize');

        /*
         * Finalization itself generates additional MP4 chunks,
         * especially the moov atom.
         *
         * These MUST finish writing before the file is closed.
         */
        await flushWrites();

        console.log(
            '[EXPORT] All final MP4 chunks written.'
        );

        ui.updateProcessingProgress(
            99,
            'Closing video file...'
        );

        /*
         * One final event-loop yield before closing the file.
         */
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
        });

        await writer.close();

        console.log(
            '[EXPORT] Electron file closed.'
        );

        logExportMemory('after file close');

    } catch (error: any) {
        const isCancelled = error?.message === 'Cancelled.' || error?.name === 'AbortError';
        if (isCancelled) {
            console.log('[EXPORT] Export cancelled by user.');
        } else {
            console.error(
                '[EXPORT] ========================================'
            );
            console.error(
                '[EXPORT] STREAMING EXPORT FAILED'
            );
            console.error(
                '[EXPORT] Error:',
                error
            );
            console.error(
                '[EXPORT] Message:',
                error?.message
            );
            console.error(
                '[EXPORT] Stack:',
                error?.stack
            );
            console.error(
                '[EXPORT] ========================================'
            );
        }

        try {
            await writer.abort?.(error).catch(() => {});
        } catch (abortError) {
            if (!isCancelled) {
                console.error(
                    '[EXPORT] Writer abort failed:',
                    abortError
                );
            }
        }

        throw error;

    } finally {
        try {
            writer.releaseLock?.();
        } catch (rErr) {
            console.warn("Writer releaseLock notice:", rErr);
        }
    }
}
