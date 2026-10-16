#!/usr/bin/env node
/**
 * improve-desktop-export.cjs
 * ------------------------------------------------------------------
 * Applies the export-pipeline improvements described in
 * EXPORT_IMPROVEMENTS.md to a ContentGen AI export checkout.
 *
 * Usage (from the repo root):
 *   node improve-desktop-export.cjs [src/exporter.ts] [server.ts]
 *
 * The two paths default to "src/exporter.ts" and "server.ts" relative
 * to the current directory. The script is idempotent: already-applied
 * patches are detected and skipped, so it is safe to run twice.
 *
 * What it changes
 * ------------------------------------------------------------------
 * src/exporter.ts
 *   P1  VideoEncoder latencyMode 'quality' (probed + realtime fallback)
 *   P2  Encode-loop waits use yieldToMain() instead of 0/2/4 ms timers
 *   P3  FFmpeg WS connect + 'started' handshake timeouts w/ clear errors
 *   P4  Byte-bounded WS send window during raw-frame streaming
 *   P5  Final 'done/error' wait can no longer hang on a closed socket
 * server.ts
 *   S1  ffmpeg stderr echoed at 1/50 chunks (tail diagnostics kept)
 *   S2  Frame heartbeat logs every 240 frames instead of every 10
 *   S3  -hide_banner on the rawvideo encode command line
 *
 * SPDX-License-Identifier: Apache-2.0
 */
const fs = require('fs');

const legacyExporterPath = process.argv[2];
const muxerPath = legacyExporterPath || (fs.existsSync('src/exporter.ts') ? 'src/exporter.ts' : 'src/exporter/muxer.ts');
const ffmpegClientPath = legacyExporterPath || (fs.existsSync('src/exporter.ts') ? 'src/exporter.ts' : 'src/exporter/backend-ffmpeg.ts');
const ffmpegServerPath = process.argv[3] || (fs.existsSync('server/_core/ffmpeg.ts') ? 'server/_core/ffmpeg.ts' : 'server.ts');

// ── helpers ────────────────────────────────────────────────────────────
let applied = 0;
let skipped = 0;

function applyPatch(label, filePath, oldText, newText) {
    if (!fs.existsSync(filePath)) {
        console.log(`[skip] ${label} — target file ${filePath} not found`);
        skipped++;
        return;
    }
    const src = fs.readFileSync(filePath, 'utf8');
    if (!src.includes(oldText)) {
        const marker = newText.split('\n').find((l) => l.includes('EXPORT_IMPROVE'));
        const alreadyApplied =
            (marker && src.includes(marker.trim().split(' ')[0])) ||
            src.includes(newText.trim()) ||
            (label.includes('yieldToMain') && src.includes('yieldToMain')) ||
            (label.includes('byte-bounded') && src.includes('bufferedAmount')) ||
            (label.includes('stderr sampling') && src.includes('stderrChunks')) ||
            (label.includes('heartbeat') && src.includes('framesWritten')) ||
            (label.includes('hide_banner') && src.includes('hide_banner'));
        if (alreadyApplied) {
            console.log(`[ok]   ${label} — already applied`);
            applied++;
        } else {
            console.log(`[skip] ${label} — pattern not found${marker ? ` (already applied? ${marker.trim()})` : ''}`);
            skipped++;
        }
        return;
    }
    if (src.indexOf(oldText) !== src.lastIndexOf(oldText)) {
        console.log(`[warn] ${label} — pattern is NOT unique (${src.split(oldText).length - 1} hits), skipping to be safe`);
        skipped++;
        return;
    }
    fs.writeFileSync(filePath, src.replace(oldText, newText), 'utf8');
    console.log(`[ok]   ${label}`);
    applied++;
}

// ── src/exporter.ts ────────────────────────────────────────────────────

// P1: latencyMode quality with probe + realtime fallback
applyPatch('P1 encoder latencyMode quality', muxerPath, [
  '        videoEncoder.configure({',
  '            codec: encoderCodec,',
  '            width,',
  '            height,',
  '            framerate: fps,',
  '            bitrate: videoBitrate,',
  "            bitrateMode: 'variable',",
  "            latencyMode: 'realtime',",
  '            hardwareAcceleration',
  '        });'
].join('\n'), [
  '        // EXPORT_IMPROVE P1: \'quality\' latency mode trades a little buffering',
  '        // for better compression efficiency at the same bitrate (Chromium',
  '        // supports it for H.264/VP8/VP9/AV1 on HW and SW encoders). Probe it',
  '        // explicitly and fall back to \'realtime\' if the driver rejects it.',
  '        let videoLatencyMode: \'quality\' | \'realtime\' = \'realtime\';',
  '        try {',
  '            const qSupport = await VideoEncoder.isConfigSupported({',
  '                codec: encoderCodec,',
  '                width,',
  '                height,',
  '                bitrate: videoBitrate,',
  '                framerate: fps,',
  "                latencyMode: 'quality',",
  '                hardwareAcceleration',
  '            });',
  "            if (qSupport.supported) videoLatencyMode = 'quality';",
  '        } catch (qErr) {',
  "            console.warn('[EXPORT] latencyMode quality probe failed:', qErr);",
  '        }',
  "        console.log('[EXPORT] Video encoder latency mode:', videoLatencyMode);",
  '',
  '        videoEncoder.configure({',
  '            codec: encoderCodec,',
  '            width,',
  '            height,',
  '            framerate: fps,',
  '            bitrate: videoBitrate,',
  "            bitrateMode: 'variable',",
  '            latencyMode: videoLatencyMode,',
  '            hardwareAcceleration',
  '        });'
].join('\n'));

// P2a: video queue poll → yieldToMain
applyPatch('P2a video encode queue poll uses yieldToMain', muxerPath, [
  '                while (videoEncoder.encodeQueueSize > 4) {',
  '                    await new Promise(resolve => setTimeout(resolve, 4));',
  '                }'
].join('\n'), [
  '                while (videoEncoder.encodeQueueSize > 4) {',
  '                    await yieldToMain();',
  '                }'
].join('\n'));

// P2b: video periodic yield → yieldToMain
applyPatch('P2b video periodic yield uses yieldToMain', muxerPath, [
  "                if (videoFrameIndex % 8 === 0) {",
  "                    await new Promise(r => setTimeout(r, 0));",
  "                }"
].join('\n'), [
  "                if (videoFrameIndex % 8 === 0) {",
  "                    await yieldToMain();",
  "                }"
].join('\n'));

// P2c: audio queue poll → yieldToMain
applyPatch('P2c audio encode queue poll uses yieldToMain', muxerPath, [
  '                while (audioEncoder && audioEncoder.encodeQueueSize > 4) {',
  '                    await new Promise(resolve => setTimeout(resolve, 2));',
  '                }'
].join('\n'), [
  '                while (audioEncoder && audioEncoder.encodeQueueSize > 4) {',
  '                    await yieldToMain();',
  '                }'
].join('\n'));

// P2d: audio periodic yield → yieldToMain
applyPatch('P2d audio periodic yield uses yieldToMain', muxerPath, [
  "                if (audioSampleIndex % (audioFramesPerChunk * 20) === 0) {",
  "                    await new Promise(r => setTimeout(r, 0));",
  "                }"
].join('\n'), [
  "                if (audioSampleIndex % (audioFramesPerChunk * 20) === 0) {",
  "                    await yieldToMain();",
  "                }"
].join('\n'));

// P3a: WS connect timeout + real error messages
applyPatch('P3a FFmpeg WS connect timeout', ffmpegClientPath, [
  "    const ws = new WebSocket(`${backendWs}/ffmpeg-export`);",
  '    await new Promise((resolve, reject) => {',
  '        ws.onopen = resolve;',
  '        ws.onerror = reject;',
  '    });'
].join('\n'), [
  "    // EXPORT_IMPROVE P3a: a dead backend used to reject with an unusable",
  "    // '[object Event]' and hang forever if it accepted the socket and never",
  "    // responded. Time out + surface a message the user can act on.",
  "    const ws = new WebSocket(`${backendWs}/ffmpeg-export`);",
  '    await new Promise<void>((resolve, reject) => {',
  '        const timer = setTimeout(',
  "            () => reject(new Error('Timed out connecting to the local FFmpeg server.')),",
  '            15000',
  '        );',
  '        ws.onopen = () => { clearTimeout(timer); resolve(); };',
  "        ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach the local FFmpeg server. Make sure the app backend is running.')); };",
  "        ws.onclose = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server closed the connection before the export started.')); };",
  '    });'
].join('\n'));

// P3b: 'started' handshake timeout + close/error escalation
applyPatch('P3b FFmpeg started-handshake timeout', ffmpegClientPath, [
  '    await new Promise<void>((resolve, reject) => {',
  '        ws.onmessage = (e) => {',
  '            const msg = JSON.parse(e.data);',
  "            if (msg.type === 'started') resolve();",
  "            if (msg.type === 'error') reject(new Error(msg.message));",
  '        };',
  '    });'
].join('\n'), [
  '    // EXPORT_IMPROVE P3b: the encoder probe (ffmpeg spawn per candidate) can',
  '    // stall on machines with flaky GPU drivers; don\'t leave the modal stuck.',
  '    await new Promise<void>((resolve, reject) => {',
  '        const timer = setTimeout(',
  "            () => reject(new Error('FFmpeg encoder startup timed out (encoder probe hung).')),",
  '            60000',
  '        );',
  '        const settleStart = () => { clearTimeout(timer); };',
  '        ws.onmessage = (e) => {',
  '            const msg = JSON.parse(e.data);',
  "            if (msg.type === 'started') { settleStart(); resolve(); }",
  "            if (msg.type === 'error') { settleStart(); reject(new Error(msg.message)); }",
  '        };',
  "        ws.onclose = () => { settleStart(); reject(new Error('Local FFmpeg server closed the connection during startup.')); };",
  "        ws.onerror = () => { settleStart(); reject(new Error('Local FFmpeg server connection failed during startup.')); };",
  '    });'
].join('\n'));

// P4: byte-bounded send window
applyPatch('P4 byte-bounded WS send window', ffmpegClientPath, [
  '        const imageData = exportCtx.getImageData(0, 0, width, height);',
  '',
  '        ws.send(imageData.data.buffer);',
  '        pendingAcks++;'
].join('\n'), [
  '        const imageData = exportCtx.getImageData(0, 0, width, height);',
  '',
  '        // EXPORT_IMPROVE P4: the ack window caps *frames* in flight (30), but a',
  '        // single 4K RGBA frame is ~33 MB, so frame count alone can leave ~1 GB',
  "        // buffered inside the socket. Also gate on bytes so long / high-res",
  '        // exports stay flat-memory on the renderer.',
  '        while (ws.bufferedAmount > 64 * 1024 * 1024) {',
  '            await new Promise(resolve => setTimeout(resolve, 10));',
  "            if (!state.isVideoProductionRunning) throw new Error('Cancelled.');",
  '            if (streamError) throw streamError;',
  '        }',
  '',
  '        ws.send(imageData.data.buffer);',
  '        pendingAcks++;'
].join('\n'));

// P5: final wait cannot hang
applyPatch('P5 finalization wait cannot hang', ffmpegClientPath, [
  "    const finalResult = await new Promise<{ type: string, code?: number, outputPath?: string, message?: string }>((resolve, reject) => {",
  '        ws.onmessage = (e) => {',
  '            const msg = JSON.parse(e.data);',
  "            if (msg.type === 'done' || msg.type === 'error') {",
  '                resolve(msg);',
  '            }',
  '        };',
  '    });'
].join('\n'), [
  "    // EXPORT_IMPROVE P5: if the backend dies between 'finish' and the result",
  '    // (AV killed ffmpeg, process crash, laptop sleep), the socket close now',
  "    // rejects instead of leaving the export modal spinning forever.",
  "    const finalResult = await new Promise<{ type: string, code?: number, outputPath?: string, message?: string }>((resolve, reject) => {",
  '        const timer = setTimeout(',
  "            () => reject(new Error('Timed out waiting for FFmpeg to finalize the file.')),",
  '            300000',
  '        );',
  '        const settle = (msg: { type: string, code?: number, outputPath?: string, message?: string }) => {',
  '            clearTimeout(timer);',
  '            ws.onmessage = null; ws.onclose = null; ws.onerror = null;',
  '            resolve(msg);',
  '        };',
  '        ws.onmessage = (e) => {',
  '            const msg = JSON.parse(e.data);',
  "            if (msg.type === 'done' || msg.type === 'error') settle(msg);",
  '        };',
  "        ws.onclose = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server closed the connection before the export finished.')); };",
  "        ws.onerror = () => { clearTimeout(timer); reject(new Error('Local FFmpeg server connection failed during finalization.')); };",
  '    });'
].join('\n'));

// ── server.ts ──────────────────────────────────────────────────────────

// S1: stderr sampling
applyPatch('S1 ffmpeg stderr sampling', ffmpegServerPath, [
  "                    ffmpegProc.stderr.on('data', (d) => {",
  '                        const str = d.toString();',
  '                        stderrTail = (stderrTail + str).slice(-4000);',
  '                        // TEMP: log everything while diagnosing the stall — remove once fixed.',
  "                        console.log('[FFmpeg stderr]', str.trim());",
  '                    });'
].join('\n'), [
  "                    // EXPORT_IMPROVE S1: ffmpeg writes frame stats to stderr",
  "                    // continuously, which floods the desktop console during long",
  '                    // exports. Echo a sample instead; full failure diagnostics are',
  '                    // still preserved in stderrTail for reportFailure().',
  '                    let stderrChunks = 0;',
  "                    ffmpegProc.stderr.on('data', (d) => {",
  '                        const str = d.toString();',
  '                        stderrTail = (stderrTail + str).slice(-4000);',
  '                        stderrChunks++;',
  "                        if (stderrChunks === 1 || stderrChunks % 50 === 0) {",
  "                            console.log('[FFmpeg stderr]', str.trim().split('\\n')[0]);",
  '                        }',
  '                    });'
].join('\n'));

// S2: frame heartbeat
applyPatch('S2 frame heartbeat log throttled', ffmpegServerPath, [
  "                // TEMP diagnostic: prove whether frames are actually reaching ffmpeg's",
  "                // stdin buffer, vs. the pipeline stalling before any get sent.",
  "                if (framesWritten % 10 === 0) {",
  "                    console.log(`[FFmpeg Export] frame #${framesWritten} written, canWrite=${canWrite}, waitingForDrain=${waitingForDrain}`);",
  '                }'
].join('\n'), [
  '                // EXPORT_IMPROVE S2: heartbeat only (30x/sec before → 2.5x at 30fps).',
  "                if (framesWritten % 240 === 0) {",
  "                    console.log(`[FFmpeg Export] frame #${framesWritten} written, canWrite=${canWrite}, waitingForDrain=${waitingForDrain}`);",
  '                }'
].join('\n'));

// S3: hide_banner
applyPatch('S3 ffmpeg -hide_banner', ffmpegServerPath, [
  "                        '-y',",
  "                        '-f', 'rawvideo',"
].join('\n'), [
  "                        '-y',",
  "                        '-hide_banner',",
  "                        '-f', 'rawvideo',"
].join('\n'));

console.log(`\nDone. ${applied} patch(es) applied, ${skipped} skipped.`);
process.exit(0);
