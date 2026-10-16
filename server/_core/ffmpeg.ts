/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { WebSocketServer } from 'ws';
import { issueFileToken } from './export-registry';

const _filename = typeof __filename !== 'undefined' ? __filename : (import.meta.url ? fileURLToPath(import.meta.url) : '');
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

let globalFfmpegPath = 'ffmpeg';

function isPathInside(filePath: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safePositiveInt(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getConfiguredTimeout(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveHardwareFfmpegPath(): string | null {
    const platformDir = process.platform === 'win32' ? 'ffmpeg-win'
        : process.platform === 'darwin' ? 'ffmpeg-mac'
        : 'ffmpeg-linux';
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const resPath = process.env.RESOURCES_PATH || (process as any).resourcesPath || '';

    const candidates = [
        resPath ? path.join(resPath, exeName) : '',
        path.join(_dirname, '..', 'resources', exeName),
        path.join(process.cwd(), 'resources', exeName),

        resPath ? path.join(resPath, platformDir, exeName) : '',
        path.join(_dirname, '..', 'resources', platformDir, exeName),
        path.join(process.cwd(), 'resources', platformDir, exeName),

        resPath ? path.join(resPath, 'bin', exeName) : '',
        path.join(_dirname, '..', 'resources', 'bin', exeName),
        path.join(process.cwd(), 'resources', 'bin', exeName),

        resPath ? path.join(resPath, 'ffmpeg', 'bin', exeName) : '',
        path.join(_dirname, '..', 'resources', 'ffmpeg', 'bin', exeName),
        path.join(process.cwd(), 'resources', 'ffmpeg', 'bin', exeName),
    ];

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

export async function initFFmpeg(): Promise<string> {
    const hardwareFfmpegPath = resolveHardwareFfmpegPath();
    let ffmpegStatic: string | null = null;

    try {
        const requireFromServer = createRequire(import.meta.url);
        const resolved = requireFromServer('ffmpeg-static');
        ffmpegStatic = typeof resolved === 'string' ? resolved : null;
    } catch {
        // Cloud/container builds may intentionally omit ffmpeg-static and use system FFmpeg.
    }

    // In packaged Electron builds ffmpeg-static is an Electron subproject dependency.
    if (!ffmpegStatic && process.env.IS_DESKTOP === 'true') {
        const resourcesPath = (process as any).resourcesPath;
        const electronEntryCandidates = [
            resourcesPath ? path.join(resourcesPath, 'app.asar', 'electron', 'main.cjs') : '',
            resourcesPath ? path.join(resourcesPath, 'app.asar.unpacked', 'electron', 'main.cjs') : '',
            path.join(_dirname, '..', 'electron', 'main.cjs'),
            path.join(process.cwd(), 'electron', 'main.cjs'),
        ].filter(Boolean);

        for (const entry of electronEntryCandidates) {
            try {
                const req = createRequire(entry);
                const resolved = req('ffmpeg-static');
                if (typeof resolved === 'string') {
                    ffmpegStatic = resolved;
                    break;
                }
            } catch {}
        }
    }

    if (hardwareFfmpegPath) {
        ffmpeg.setFfmpegPath(hardwareFfmpegPath);
        globalFfmpegPath = hardwareFfmpegPath;
        console.log(`[FFmpeg] Bundled FFmpeg configured at: ${hardwareFfmpegPath}`);
    } else if (ffmpegStatic) {
        let ffmpegPath = ffmpegStatic;
        if (ffmpegPath.includes('app.asar')) {
            ffmpegPath = ffmpegPath.replace(/app\.asar[\\/]/, 'app.asar.unpacked/');
        }

        if (fs.existsSync(ffmpegPath)) {
            ffmpeg.setFfmpegPath(ffmpegPath);
            globalFfmpegPath = ffmpegPath;
            console.log(`[FFmpeg] ffmpeg-static binary configured at: ${ffmpegPath}`);
        } else {
            console.error(`[FFmpeg] ffmpeg-static resolved to a missing binary: ${ffmpegPath}`);
            ffmpeg.setFfmpegPath('ffmpeg');
            globalFfmpegPath = 'ffmpeg';
        }
    } else {
        const systemPaths = process.platform === 'win32'
            ? []
            : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
        const foundSystem = systemPaths.find(p => fs.existsSync(p)) || 'ffmpeg';
        ffmpeg.setFfmpegPath(foundSystem);
        globalFfmpegPath = foundSystem;
        console.log(`[FFmpeg] Using system FFmpeg binary at: ${foundSystem}`);
    }

    return globalFfmpegPath;
}

export function getGlobalFfmpegPath(): string {
    return globalFfmpegPath;
}

function cleanupOldTempFiles(dir: string): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    const managedPrefixes = ['export-', 'clean-', 'cloudrun_export_'];

    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile()) continue;
            if (!managedPrefixes.some(prefix => entry.name.startsWith(prefix))) continue;
            const fullPath = path.join(dir, entry.name);
            try {
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > maxAge) fs.unlinkSync(fullPath);
            } catch {}
        }
    } catch {}
}

export function getSafeTempDir(): string {
    const candidateDirs = [
        process.env.TEMP_DIR,
        process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'temp') : '',
        path.join(os.tmpdir(), 'contentgen-ai-tmp'),
        path.join(process.cwd(), '.tmp')
    ].filter(Boolean) as string[];

    for (const dir of candidateDirs) {
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cleanupOldTempFiles(dir);
            const testFile = path.join(dir, `.perm-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
            fs.writeFileSync(testFile, '1');
            fs.unlinkSync(testFile);
            return dir;
        } catch {
            // Continue to a writable candidate.
        }
    }
    return os.tmpdir();
}

export function getEncoderArgs(encoder: string, bitrate: number): string[] {
    if (encoder.includes('nvenc')) {
        // NVIDIA NVENC: High-quality VBR with Constant Quality target (CQ 19 ~= CRF 18)
        return ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq:v', '19', '-b:v', String(bitrate), '-maxrate', String(Math.max(bitrate * 2, 25_000_000)), '-bufsize', String(Math.max(bitrate * 4, 50_000_000))];
    }
    if (encoder.includes('videotoolbox')) {
        // Apple VideoToolbox: Offline high-quality mode (-realtime 0) with high visual target (-q:v 65)
        return ['-realtime', '0', '-q:v', '65', '-b:v', String(bitrate), '-maxrate', String(Math.max(bitrate * 2, 25_000_000))];
    }
    if (encoder.includes('qsv')) {
        // Intel QuickSync: Intelligent Constant Quality (ICQ 20 ~= CRF 18)
        return ['-preset', 'slow', '-global_quality', '20', '-b:v', String(bitrate)];
    }
    if (encoder.includes('amf')) {
        // AMD AMF: High quality with CQP rate control
        return ['-quality', 'quality', '-rc', 'cqp', '-qp_i', '18', '-qp_p', '20'];
    }
    if (encoder.includes('vaapi')) {
        return ['-qp', '19', '-b:v', String(bitrate)];
    }
    // Default software encoder: libx264 with pristine CRF 18
    return ['-preset', 'medium', '-crf', '18'];
}

export function pickEncoderCandidates(platform: string): string[] {
    if (platform === 'darwin') return ['h264_videotoolbox', 'libx264'];
    if (platform === 'win32') return ['h264_nvenc', 'h264_qsv', 'h264_amf', 'libx264'];
    return ['h264_nvenc', 'h264_vaapi', 'libx264'];
}

function probeEncoder(ffmpegPath: string, encoder: string): Promise<boolean> {
    const timeoutMs = getConfiguredTimeout('FFMPEG_PROBE_TIMEOUT_MS', 20_000);
    return new Promise((resolve) => {
        let settled = false;
        const p = spawn(ffmpegPath, [
            '-y', '-f', 'lavfi', '-i', 'color=c=black:s=256x256',
            '-frames:v', '1', '-c:v', encoder, '-f', 'null', '-'
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { p.kill('SIGKILL'); } catch {}
            resolve(false);
        }, timeoutMs);

        p.once('exit', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(code === 0);
        });
        p.once('error', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(false);
        });
    });
}

export function setupFFmpegWS(wss: WebSocketServer, ffmpegPathStr: string) {
    const tmpDir = getSafeTempDir();
    const resolvedTmp = path.resolve(tmpDir);

    wss.on('connection', (ws) => {
        ws.on('error', (err: any) => console.warn('[WS Client Connection Warning]:', err?.message || err));

        let ffmpegProc: ChildProcessWithoutNullStreams | null = null;
        let started = false;
        let connectionOutputPath = '';
        let connectionAudioPath = '';
        let waitingForDrain = false;
        let finishRequested = false;
        let finishedSuccessfully = false;
        let finishResponseSent = false;
        let framesWritten = 0;
        let unackedFrames = 0;
        const MAX_UNACKED = 30;

        const safeSend = (payload: unknown) => {
            if (ws.readyState === 1) {
                try { ws.send(JSON.stringify(payload)); } catch {}
            }
        };

        const cleanupAudio = () => {
            if (!connectionAudioPath) return;
            try {
                if (isPathInside(connectionAudioPath, resolvedTmp)) fs.unlinkSync(connectionAudioPath);
            } catch {}
            connectionAudioPath = '';
        };

        const cleanupFailedOutput = () => {
            if (!connectionOutputPath || finishedSuccessfully) return;
            try {
                if (isPathInside(connectionOutputPath, resolvedTmp)) fs.unlinkSync(connectionOutputPath);
            } catch {}
        };

        ws.on('message', async (data, isBinary) => {
            try {
                if (!isBinary) {
                    let msg: any;
                    try {
                        msg = JSON.parse(data.toString());
                    } catch {
                        safeSend({ type: 'error', message: 'Invalid JSON control message.' });
                        return;
                    }

                    if (!msg || typeof msg.type !== 'string') return;

                    if (msg.type === 'start') {
                        if (started || ffmpegProc) {
                            safeSend({ type: 'error', message: 'FFmpeg export is already started.' });
                            return;
                        }

                        let width = safePositiveInt(msg.width, 1280);
                        let height = safePositiveInt(msg.height, 720);
                        let fps = Number(msg.fps);
                        let bitrate = Number(msg.bitrate);
                        const outputPath = msg.outputPath;
                        let audioPath = msg.audioPath;
                        const hasAudio = msg.hasAudio === true;
                        const preferHardware = msg.preferHardware !== false;
                        const cleanMetadata = msg.cleanMetadata !== false;
                        const deviceProfile = msg.deviceProfile || {};

                        width = Math.floor(width / 2) * 2;
                        height = Math.floor(height / 2) * 2;
                        fps = Number.isFinite(fps) ? Math.max(1, Math.min(120, fps)) : 30;
                        bitrate = Number.isFinite(bitrate) && bitrate > 0 ? Math.min(Math.floor(bitrate), 100_000_000) : 8_000_000;

                        const homeDir = path.resolve(os.homedir());
                        let actualOutputPath: string;

                        if (outputPath) {
                            if (typeof outputPath !== 'string' || outputPath.includes('://') || outputPath.startsWith('//')) {
                                safeSend({ type: 'error', message: 'Invalid outputPath.' });
                                ws.close();
                                return;
                            }
                            const resolvedOut = path.resolve(outputPath);
                            if (!isPathInside(resolvedOut, homeDir)) {
                                safeSend({ type: 'error', message: 'outputPath outside the user home directory.' });
                                ws.close();
                                return;
                            }
                            actualOutputPath = resolvedOut;
                        } else {
                            actualOutputPath = path.join(tmpDir, `export-${Date.now()}-${cryptoSafeSuffix()}.mp4`);
                        }

                        await fs.promises.mkdir(path.dirname(actualOutputPath), { recursive: true });
                        connectionOutputPath = actualOutputPath;

                        if (hasAudio && audioPath) {
                            if (typeof audioPath !== 'string' || audioPath.includes('://') || audioPath.startsWith('//')) {
                                safeSend({ type: 'error', message: 'Invalid audioPath.' });
                                ws.close();
                                return;
                            }
                            const resolvedAudio = path.resolve(audioPath);
                            if (!isPathInside(resolvedAudio, homeDir) && !isPathInside(resolvedAudio, resolvedTmp)) {
                                safeSend({ type: 'error', message: 'audioPath outside allowed directories.' });
                                ws.close();
                                return;
                            }
                            audioPath = resolvedAudio;
                            connectionAudioPath = resolvedAudio;
                        }

                        let candidates = pickEncoderCandidates(process.platform);
                        if (!preferHardware) candidates = ['libx264'];

                        let selectedEncoder: string | null = null;
                        for (const encoder of candidates) {
                            console.log(`[FFmpeg Export] Probing encoder: ${encoder}`);
                            const works = await probeEncoder(ffmpegPathStr, encoder);
                            if (works) {
                                selectedEncoder = encoder;
                                console.log(`[FFmpeg Export] Encoder ${encoder} selected.`);
                                break;
                            }
                            console.warn(`[FFmpeg Export] Encoder ${encoder} failed probe.`);
                        }

                        if (!selectedEncoder) {
                            safeSend({ type: 'error', message: 'No working H.264 encoder found.' });
                            cleanupAudio();
                            cleanupFailedOutput();
                            ws.close();
                            return;
                        }

                        const make = String(deviceProfile.make || 'Apple').replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'Apple';
                        const model = String(deviceProfile.model || 'iPhone 14').replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'iPhone 14';
                        const software = String(deviceProfile.software || '17.5.1').replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || '17.5.1';
                        const encoderTag = String(deviceProfile.encoder || software).replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || software;

                        const args = [
                            '-y', '-hide_banner',
                            '-f', 'rawvideo', '-pixel_format', 'rgba',
                            '-video_size', `${width}x${height}`,
                            '-framerate', String(fps), '-i', 'pipe:0',
                            ...(hasAudio && audioPath ? ['-i', audioPath] : []),
                            '-map', '0:v',
                            ...(hasAudio && audioPath ? ['-map', '1:a'] : []),
                            ...(cleanMetadata ? [
                                '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart',
                                '-brand', 'qt  ',
                                '-metadata', `make=${make}`,
                                '-metadata', `model=${model}`,
                                '-metadata', `encoder=${encoderTag}`,
                                '-metadata:s:v', 'handler_name=Core Media Video',
                                ...(hasAudio && audioPath ? ['-metadata:s:a', 'handler_name=Core Media Audio'] : []),
                            ] : []),
                            '-c:v', selectedEncoder,
                            ...getEncoderArgs(selectedEncoder, bitrate),
                            ...(hasAudio && audioPath ? ['-c:a', 'aac', '-b:a', '128k'] : []),
                            '-vf', 'format=yuv420p',
                            actualOutputPath,
                        ];

                        ffmpegProc = spawn(ffmpegPathStr, args, { stdio: ['pipe', 'pipe', 'pipe'] });
                        let stderrTail = '';
                        let stderrChunks = 0;

                        ffmpegProc.stderr.on('data', (d) => {
                            const str = d.toString();
                            stderrTail = (stderrTail + str).slice(-8000);
                            stderrChunks++;
                            if (stderrChunks === 1 || stderrChunks % 50 === 0) {
                                console.log('[FFmpeg stderr]', str.trim().slice(0, 500));
                            }
                        });

                        const reportFailure = (reason: string) => {
                            started = false;
                            const detail = stderrTail.trim().split('\n').slice(-15).join('\n');
                            console.error(`[FFmpeg Export] ${reason}`, detail || '(no stderr captured)');
                            safeSend({ type: 'error', message: `${reason}${detail ? `: ${detail}` : ''}` });
                            try { ws.close(); } catch {}
                        };

                        ffmpegProc.on('error', (err) => reportFailure(`FFmpeg process error: ${err.message}`));
                        ffmpegProc.stdin.on('error', () => reportFailure('Encoder died while writing frames'));

                        const exportTimeoutMs = getConfiguredTimeout('FFMPEG_EXPORT_TIMEOUT_MS', 2 * 60 * 60 * 1000);
                        const exportTimer = setTimeout(() => {
                            if (ffmpegProc && !ffmpegProc.killed) {
                                console.error('[FFmpeg Export] Hard export timeout reached. Killing FFmpeg.');
                                try { ffmpegProc.kill('SIGKILL'); } catch {}
                            }
                        }, exportTimeoutMs);

                        ffmpegProc.once('exit', (code) => {
                            clearTimeout(exportTimer);
                            started = false;
                            if (finishRequested && !finishResponseSent) {
                                finishResponseSent = true;
                                if (code === 0 && fs.existsSync(actualOutputPath)) {
                                    finishedSuccessfully = true;
                                    let downloadToken: string | undefined;
                                    if (isPathInside(actualOutputPath, resolvedTmp)) {
                                        try { downloadToken = issueFileToken(actualOutputPath, 'download'); } catch (e) {
                                            console.error('[FFmpeg Export] Could not issue download token:', e);
                                        }
                                    }
                                    cleanupAudio();
                                    safeSend({ type: 'done', code, outputPath: actualOutputPath, downloadToken });
                                    try { ws.close(); } catch {}
                                } else {
                                    cleanupAudio();
                                    cleanupFailedOutput();
                                    safeSend({ type: 'error', code, message: `FFmpeg exited with code ${code ?? 'unknown'}` });
                                    try { ws.close(); } catch {}
                                }
                            } else if (code !== 0) {
                                cleanupAudio();
                                cleanupFailedOutput();
                                reportFailure(`FFmpeg exited unexpectedly (code ${code}) with encoder ${selectedEncoder}`);
                            }
                        });

                        started = true;
                        safeSend({ type: 'started' });
                    } else if (msg.type === 'finish') {
                        if (ffmpegProc && started && !finishRequested) {
                            finishRequested = true;
                            try { ffmpegProc.stdin.end(); } catch (e: any) { reportSafeError(ws, `Could not finish FFmpeg input: ${e?.message || e}`); }
                        }
                    }
                } else if (started && ffmpegProc) {
                    const canWrite = ffmpegProc.stdin.write(data as Buffer);
                    unackedFrames++;
                    framesWritten++;

                    if (!canWrite && !waitingForDrain) {
                        waitingForDrain = true;
                        ffmpegProc.stdin.once('drain', () => {
                            waitingForDrain = false;
                            if (unackedFrames > 0) {
                                safeSend({ type: 'ack', acked: unackedFrames });
                                unackedFrames = 0;
                            }
                        });
                    } else if (canWrite && unackedFrames >= MAX_UNACKED) {
                        safeSend({ type: 'ack', acked: unackedFrames });
                        unackedFrames = 0;
                    }
                }
            } catch (err: any) {
                console.error('[FFmpeg WS] Message handler failure:', err);
                cleanupAudio();
                cleanupFailedOutput();
                safeSend({ type: 'error', message: err?.message || 'FFmpeg WebSocket handler failed.' });
            }
        });

        ws.on('close', () => {
            if (ffmpegProc && !finishRequested) {
                try { ffmpegProc.kill('SIGKILL'); } catch {}
            }
            cleanupAudio();
            cleanupFailedOutput();
        });
    });
}

function cryptoSafeSuffix(): string {
    return Math.random().toString(36).slice(2, 10);
}

function reportSafeError(ws: any, message: string): void {
    try {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message }));
    } catch {}
}
