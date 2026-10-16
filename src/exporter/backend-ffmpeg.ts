/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { audioBufferToWavBlob } from '../utils-core';
import { cleanMediaBlob } from '../c2pa-cleaner';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import * as dom from '../dom';
import { videoRenderContext } from '../videoRenderer';
import { calculateBitrate } from './codecs';
import { getExportDeviceProfile } from './device-profile';
import { drawExportFrameCached, syncVideosForExportTime } from './frames';


export async function cleanVideoMetadataWithServer(blob: Blob, onProgress?: (msg: string) => void): Promise<Blob> {
    try {
        if (onProgress) onProgress('Applying authentic device signature & stripping C2PA metadata...');

        const exportAspectRatio =
            dom.imageResolutionSelect?.value ||
            timelineState.clips?.[0]?.aspectRatio ||
            '16:9';

        const deviceProfile = getExportDeviceProfile(exportAspectRatio);

        const formData = new FormData();
        formData.append('video', blob, 'export.mp4');
        formData.append('make', deviceProfile.make);
        formData.append('model', deviceProfile.model);
        if (deviceProfile.software) {
            formData.append('software', deviceProfile.software);
        }
        // Let server default encoder to software version for authentic iPhone signature

        const sources = Array.from(new Set(timelineState.clips.map((c: any) => c.deviceTag).filter(Boolean)));
        if (sources.length) formData.append('comment', `Footage sources: ${sources.join(' · ')}`);

        const isHttpOrHttps = window.location.protocol === 'http:' || window.location.protocol === 'https:';
        const backendHttp = isHttpOrHttps ? window.location.origin : 'http://127.0.0.1:3000';

        const res = await fetch(`${backendHttp}/api/clean-metadata`, {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const cleanedBlob = await res.blob();
                if (cleanedBlob && cleanedBlob.size > Math.max(10240, blob.size * 0.5)) {
                    console.log(`[Clean Metadata] Successfully remuxed clean container (${cleanedBlob.size} bytes)`);
                    return cleanedBlob;
                }
            }
        }
    } catch (e) {
        console.warn('[Clean Metadata] Server remux unreachable, falling back to instant client-side binary C2PA cleaner:', e);
    }

    // Client-Side Container Box Stripping Fallback (Pure byte-level slice, 0 re-encoding)
    try {
        const { cleanedBlob, result } = await cleanMediaBlob(blob, { mode: 'c2pa_only', preserveICC: true, preserveOrientation: true });
        if (result.success && cleanedBlob.size > 0) {
            console.log(`[Clean Metadata] Cleaned C2PA metadata client-side (${result.removedBytes} bytes removed)`);
            return cleanedBlob;
        }
    } catch (clientErr) {
        console.warn('[Clean Metadata] Client-side C2PA stripping fallback error:', clientErr);
    }

    return blob;
}


export async function exportWithFFmpeg(
    width: number, height: number,
    audioBuffer: AudioBuffer | null, hasAudio: boolean, preferHardware: boolean,
    outputPath: string | null, stream: FileSystemWritableFileStream | null,
    filename: string,
    onProgress: (progress: number, message: string) => void
) {
    const fps = dom.videoExportFpsSelect ? parseInt(dom.videoExportFpsSelect.value) || 30 : 30;
    const bitrate = calculateBitrate(width, height, fps, 'mp4');

    const isHttpOrHttps = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    const backendHttp = isHttpOrHttps ? window.location.origin : 'http://127.0.0.1:3000';
    const backendWs = isHttpOrHttps 
        ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
        : 'ws://127.0.0.1:3000';

    let audioPath: string | null = null;
    if (hasAudio && audioBuffer) {
        const wavBlob = audioBufferToWavBlob(audioBuffer);
        
        // Upload wav to backend tmp dir to pass path to ffmpeg
        const formData = new FormData();
        formData.append('file', wavBlob, 'audio.wav');
        try {
            const uploadRes = await fetch(`${backendHttp}/api/upload-audio`, {
                method: 'POST',
                body: formData
            }).then(r => r.json());
            audioPath = uploadRes.path;
        } catch (e) {
            console.warn('Failed to upload audio to backend temp storage, falling back to no audio', e);
            hasAudio = false;
        }
    }

    // EXPORT_IMPROVE P3a: a dead backend used to reject with an unusable
    // '[object Event]' and hang forever if it accepted the socket and never
    // responded. Time out + surface a message the user can act on.
    const ws = new WebSocket(`${backendWs}/ffmpeg-export`);
    try {
        await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Timed out connecting to the local FFmpeg server.')),
            15000
        );
        ws.onopen = () => { clearTimeout(timer); resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach the local FFmpeg server. Make sure the app backend is running.')); };
        ws.onclose = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server closed the connection before the export started.')); };
    });

    const cleanMetadata = dom.videoExportCleanMetadataCheckbox ? dom.videoExportCleanMetadataCheckbox.checked : true;

    const exportAspectRatio =
        dom.imageResolutionSelect?.value ||
        timelineState.clips?.[0]?.aspectRatio ||
        '16:9';

    const deviceProfile = getExportDeviceProfile(exportAspectRatio);

    ws.send(JSON.stringify({
        type: 'start', width, height, fps, bitrate,
        outputPath, audioPath, hasAudio, preferHardware,
        cleanMetadata,
        deviceProfile: {
            make: deviceProfile.make,
            model: deviceProfile.model,
            software: deviceProfile.software,
            encoder: deviceProfile.software || '17.5.1'
        }
    }));

    // EXPORT_IMPROVE P3b: the encoder probe (ffmpeg spawn per candidate) can
    // stall on machines with flaky GPU drivers; don't leave the modal stuck.
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('FFmpeg encoder startup timed out (encoder probe hung).')),
            60000
        );
        const settleStart = () => { clearTimeout(timer); };
        ws.onmessage = (e) => {
            let msg: any;
            try { msg = JSON.parse(e.data); } catch { return reject(new Error('Received invalid FFmpeg startup message.')); }
            if (msg.type === 'started') { settleStart(); resolve(); }
            if (msg.type === 'error') { settleStart(); reject(new Error(msg.message)); }
        };
        ws.onclose = () => { settleStart(); reject(new Error('Local FFmpeg server closed the connection during startup.')); };
        ws.onerror = () => { settleStart(); reject(new Error('Local FFmpeg server connection failed during startup.')); };
    });

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d', { willReadFrequently: true })!;
    
    const totalDuration = hasAudio ? audioBuffer!.duration : (videoRenderContext?.totalDuration || 0);
    const totalFrames = Math.round(totalDuration * fps);

    let ackedFrames = 0;
    let pendingAcks = 0;
    
    // Dynamically calculate sliding window based on frame size to prevent RAM ballooning at 4K.
    // 4K (3840x2160x4 ~= 33MB) -> MAX_IN_FLIGHT 2 (~66MB max in flight)
    // 1080p (1920x1080x4 ~= 8MB) -> MAX_IN_FLIGHT 4 (~32MB max in flight)
    // 720p (1280x720x4 ~= 3.7MB) -> MAX_IN_FLIGHT 8 (~30MB max in flight)
    const frameBytes = width * height * 4;
    const MAX_IN_FLIGHT = Math.max(2, Math.min(8, Math.floor((32 * 1024 * 1024) / Math.max(frameBytes, 1))));
    const maxSocketBufferedBytes = Math.max(frameBytes * 2, 8 * 1024 * 1024);
    
    let backpressureResolver: (() => void) | null = null;
    let streamError: Error | null = null;

    ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(e.data); } catch {
            streamError = new Error('Received invalid FFmpeg control message.');
            if (backpressureResolver) { const resolve = backpressureResolver; backpressureResolver = null; resolve(); }
            return;
        }
        if (msg.type === 'ack') {
            ackedFrames += msg.acked;
            pendingAcks -= msg.acked;
            if (backpressureResolver && pendingAcks < MAX_IN_FLIGHT) {
                const resolve = backpressureResolver;
                backpressureResolver = null;
                resolve();
            }
        } else if (msg.type === 'error') {
            streamError = new Error(msg.message);
            if (backpressureResolver) {
                const resolve = backpressureResolver;
                backpressureResolver = null;
                resolve();
            }
        }
    };

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (!state.isVideoProductionRunning) throw new Error("Cancelled.");
        if (streamError) throw streamError;

        if (pendingAcks >= MAX_IN_FLIGHT) {
            await new Promise<void>((resolve) => {
                backpressureResolver = resolve;
            });
            if (streamError) throw streamError;
        }

        const time = frameIndex / fps;
        await syncVideosForExportTime(time, fps, height);
        await drawExportFrameCached(time, exportCanvas as any, exportCtx as any);

        const imageData = exportCtx.getImageData(0, 0, width, height);

        // Gate on bytes queued in the socket so long / high-res (4K) exports stay flat-memory.
        while (ws.bufferedAmount > maxSocketBufferedBytes) {
            await new Promise(resolve => setTimeout(resolve, 10));
            if (!state.isVideoProductionRunning) throw new Error('Cancelled.');
            if (streamError) throw streamError;
        }

        ws.send(imageData.data.buffer);
        pendingAcks++;

        if (frameIndex % 15 === 0) {
            onProgress((frameIndex / totalFrames) * 100, `Encoding frame ${frameIndex + 1} of ${totalFrames}...`);
        }
    }

    ws.send(JSON.stringify({ type: 'finish' }));
    
    // EXPORT_IMPROVE P5: if the backend dies between 'finish' and the result
    // (AV killed ffmpeg, process crash, laptop sleep), the socket close now
    // rejects instead of leaving the export modal spinning forever.
    const finalResult = await new Promise<{ type: string, code?: number, outputPath?: string, downloadToken?: string, message?: string }>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Timed out waiting for FFmpeg to finalize the file.')),
            300000
        );
        const settle = (msg: { type: string, code?: number, outputPath?: string, message?: string }) => {
            clearTimeout(timer);
            ws.onmessage = null; ws.onclose = null; ws.onerror = null;
            resolve(msg);
        };
        ws.onmessage = (e) => {
            let msg: any;
            try { msg = JSON.parse(e.data); } catch { return reject(new Error('Received invalid FFmpeg finalization message.')); }
            if (msg.type === 'done' || msg.type === 'error') settle(msg);
        };
        ws.onclose = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server closed the connection before the export finished.')); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server connection failed during finalization.')); };
    });

    if (finalResult.type === 'error') {
        const errorDetail = finalResult.message || `exited with code ${finalResult.code}`;
        throw new Error(`ffmpeg error: ${errorDetail}`);
    }

    // If it was a browser export (outputPath was null), fetch it from backend and pipe to stream
    if (!outputPath && stream && finalResult.outputPath) {
        onProgress(99, 'Downloading video from local server...');
        if (!finalResult.downloadToken) throw new Error('Server did not provide a secure download token.');
        const downloadRes = await fetch(`${backendHttp}/api/download-export?token=${encodeURIComponent(finalResult.downloadToken)}`);
        if (!downloadRes.ok || !downloadRes.body) throw new Error('Failed to download compiled video from server.');
        
        const reader = downloadRes.body.getReader();
        const writer: any = stream.getWriter();
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
            }
            await writer.close();
        } catch (downloadErr) {
            try { await writer.abort?.(downloadErr); } catch {}
            throw downloadErr;
        }
    } else if (!outputPath && !stream && finalResult.outputPath) {
        onProgress(99, 'Saving video...');
        const link = document.createElement('a');
        if (!finalResult.downloadToken) throw new Error('Server did not provide a secure download token.');
        link.href = `${backendHttp}/api/download-export?token=${encodeURIComponent(finalResult.downloadToken)}`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 1000);
    } else if (stream && outputPath) {
        // We already wrote directly to the outputPath, but stream might be a FileSystemWritableFileStream that needs closing
        try {
            await (stream as any).abort(); // Abort the empty stream since we bypassed it by giving the path to ffmpeg directly
        } catch (e) {
            console.warn("Stream abort notice during ffmpeg export:", e);
        }
    }
    } finally {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    }
}
