import puppeteer, { Browser } from 'puppeteer-core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RENDER_ASSETS_DIR } from './routes/cloudRender';
import { buildCanonicalExportPayload } from '../src/exporter/canonical-payload';
import { prepareTimelineAudioMix } from './_core/audioMixer';

export interface CloudRenderOptions {
    inputProps: any;
    fps: number;
    resolution: string;
    durationInFrames: number;
    outputFilePath: string;
    appBaseUrl: string; // e.g. http://127.0.0.1:3000
    onProgress?: (progress: number) => void;
}

export function findChromeExecutable(): string {
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const candidates = [
        // Linux / Docker
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        // Windows
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        'C:\\Program Files\\Chromium\\Application\\chrome.exe',
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return '';
}

const CHROME_PATH = findChromeExecutable();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);
}

async function resolveAudioToLocalFile(audioUrl?: string, tmpPrefix = 'worker_audio'): Promise<string | null> {
    if (!audioUrl || typeof audioUrl !== 'string') return null;

    if (fs.existsSync(audioUrl) && fs.statSync(audioUrl).size > 50) {
        return audioUrl;
    }

    if (audioUrl.includes('/api/cloud-render/assets/')) {
        try {
            const urlObj = new URL(audioUrl, 'http://localhost');
            const assetName = path.basename(urlObj.pathname);
            const localAssetPath = path.join(RENDER_ASSETS_DIR, assetName);
            if (fs.existsSync(localAssetPath) && fs.statSync(localAssetPath).size > 50) {
                return localAssetPath;
            }
        } catch {}
    }

    if (audioUrl.startsWith('data:audio/')) {
        try {
            const base64Data = audioUrl.replace(/^data:[^;]+;base64,/, '');
            const buf = Buffer.from(base64Data, 'base64');
            const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}.wav`);
            await fs.promises.writeFile(outPath, buf);
            return outPath;
        } catch {}
    }

    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        try {
            const res = await fetch(audioUrl);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                const ext = audioUrl.endsWith('.mp3') ? '.mp3' : '.wav';
                const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}${ext}`);
                await fs.promises.writeFile(outPath, buf);
                return outPath;
            }
        } catch (fetchErr) {
            console.warn(`[Cloud Canvas Worker] Could not fetch audio URL ${audioUrl}:`, fetchErr);
        }
    }

    return null;
}

function toLoopback(url: string | undefined, appBaseUrl: string): string | undefined {
    if (!url) return url;
    try {
        const u = new URL(url);
        const base = new URL(appBaseUrl);
        // Only rewrite our own asset URLs, not third-party CDN links.
        if (u.pathname.startsWith('/api/cloud-render/assets/')) {
            u.protocol = base.protocol;
            u.host = base.host;
            return u.toString();
        }
    } catch { /* not an absolute URL — leave as-is */ }
    return url;
}

/**
 * Builds the ExportProjectPayload that src/exportBridge.ts expects.
 * Normalizes asset URLs so headless Chromium requests them locally.
 */
function buildBridgePayload(inputProps: any, width: number, height: number, fps: number, appBaseUrl: string) {
    return buildCanonicalExportPayload({
        inputProps,
        width,
        height,
        fps,
        appBaseUrl,
    });
}

const MAX_CHUNKS = Math.max(1, Number(process.env.RENDER_CHUNK_COUNT) || 6);

/**
 * Picks up to `maxChunks` frame-range boundaries, snapped to clip start
 * times, so no chunk boundary falls inside a transition window.
 */
function computeChunkFrameRanges(
    clips: { startTime: number }[],
    totalFrames: number,
    fps: number,
    maxChunks: number
): Array<{ startFrame: number; endFrame: number }> {
    const totalDuration = totalFrames / fps;
    const clipStarts = Array.from(new Set(clips.map(c => c.startTime))).sort((a, b) => a - b);

    const targetChunkCount = Math.max(1, Math.min(maxChunks, clipStarts.length || 1));
    const idealBoundaryTimes: number[] = [];
    for (let i = 1; i < targetChunkCount; i++) {
        idealBoundaryTimes.push((totalDuration / targetChunkCount) * i);
    }

    // Snap each ideal boundary to the nearest actual clip start time.
    const snapped = new Set<number>();
    for (const t of idealBoundaryTimes) {
        let closest = clipStarts[0] ?? 0;
        let bestDist = Infinity;
        for (const cs of clipStarts) {
            const d = Math.abs(cs - t);
            if (d < bestDist) { bestDist = d; closest = cs; }
        }
        if (closest > 0 && closest < totalDuration) snapped.add(closest);
    }

    const boundaryTimes = [0, ...Array.from(snapped).sort((a, b) => a - b), totalDuration];
    const ranges: Array<{ startFrame: number; endFrame: number }> = [];
    for (let i = 0; i < boundaryTimes.length - 1; i++) {
        const startFrame = Math.round(boundaryTimes[i] * fps);
        const endFrame = Math.round(boundaryTimes[i + 1] * fps);
        if (endFrame > startFrame) ranges.push({ startFrame, endFrame });
    }
    return ranges.length > 0 ? ranges : [{ startFrame: 0, endFrame: totalFrames }];
}

async function renderChunk(
    browser: Browser,
    appBaseUrl: string,
    bridgePayload: any,
    width: number,
    height: number,
    fps: number,
    range: { startFrame: number; endFrame: number },
    chunkIndex: number,
    chunkOutputPath: string,
    onFrameDone: () => void
): Promise<string> {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on('console', (msg) => console.log(`[App Console chunk ${chunkIndex}]`, msg.text()));
    page.on('pageerror', (err: any) => console.warn(`[App Page Error chunk ${chunkIndex}]`, err?.message || err));

    try {
        const exportUrl = `${appBaseUrl.replace(/\/$/, '')}/?exportMode=1`;
        await page.goto(exportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction('window.__exportBridgeReady === true', { timeout: 30000 });

        await page.evaluate((payload) => (window as any).__exportBridge.init(payload), bridgePayload);
        const canvasSelector = await page.evaluate(() => '#' + (window as any).__exportBridge.getCanvasId());
        let canvasHandle = await page.$(canvasSelector);
        if (!canvasHandle) throw new Error(`[Chunk ${chunkIndex}] Export canvas not found`);

        // Attach Chrome DevTools Protocol (CDP) session for HyperFrames-style high-speed deterministic capture
        let cdpSession: any = null;
        try {
            cdpSession = await page.target().createCDPSession();
            await cdpSession.send('Page.enable');
        } catch (cdpErr) {
            console.warn(`[Chunk ${chunkIndex}] CDP session initialization fallback:`, cdpErr);
        }

        // Video-only, no audio — audio is muxed once, globally, after concat.
        const ffmpegArgs = ['-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(fps), '-i', 'pipe:0',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '20', chunkOutputPath];
        const ffmpegProc = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'pipe'] });
        let ffmpegError = '';
        ffmpegProc.stderr.on('data', (d: Buffer) => { ffmpegError += d.toString(); });

        for (let frame = range.startFrame; frame < range.endFrame; frame++) {
            const time = frame / fps;
            await page.evaluate((t) => (window as any).__exportBridge.renderFrame(t), time);

            let buffer: Buffer;
            if (cdpSession) {
                try {
                    const { data } = await cdpSession.send('Page.captureScreenshot', {
                        format: 'jpeg',
                        quality: 90,
                        clip: { x: 0, y: 0, width, height, scale: 1 }
                    });
                    buffer = Buffer.from(data, 'base64');
                } catch {
                    if (!canvasHandle) {
                        canvasHandle = await page.$(canvasSelector);
                    }
                    buffer = (await canvasHandle!.screenshot({ type: 'jpeg', quality: 90 })) as Buffer;
                }
            } else {
                if (!canvasHandle) {
                    canvasHandle = await page.$(canvasSelector);
                    if (!canvasHandle) throw new Error(`[Chunk ${chunkIndex}] Export canvas handle lost`);
                }
                buffer = (await canvasHandle.screenshot({ type: 'jpeg', quality: 90 })) as Buffer;
            }

            const canWrite = ffmpegProc.stdin.write(buffer);
            if (!canWrite) {
                await withTimeout(
                    new Promise<void>((resolve) => ffmpegProc.stdin.once('drain', resolve)),
                    15000, `Chunk ${chunkIndex} FFmpeg stdin drain`
                );
            }
            onFrameDone();
        }

        if (cdpSession) {
            await cdpSession.detach().catch(() => {});
        }

        await withTimeout(
            new Promise<void>((resolve, reject) => {
                ffmpegProc.stdin.end();
                ffmpegProc.on('close', (code: number) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Chunk ${chunkIndex} FFmpeg exited with code ${code}: ${ffmpegError.slice(-500)}`));
                });
            }),
            120000, `Chunk ${chunkIndex} FFmpeg finalize/close`
        );

        console.log(`[Cloud Canvas Worker] Chunk ${chunkIndex} done (${range.endFrame - range.startFrame} frames) → ${chunkOutputPath}`);
        return chunkOutputPath;
    } finally {
        await page.close().catch(() => {});
    }
}

export async function renderCloudVideoWithCanvas(opts: CloudRenderOptions): Promise<string> {
    const { inputProps, fps, resolution, durationInFrames, outputFilePath, appBaseUrl, onProgress } = opts;

    if (!CHROME_PATH) {
        throw new Error('Google Chrome / Chromium is not installed on the system.');
    }

    const resMap: Record<string, { width: number; height: number }> = {
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 },
        '4k': { width: 3840, height: 2160 },
    };
    let { width, height } = resMap[resolution] || { width: 1920, height: 1080 };
    if (inputProps.aspectRatio === '9:16') { const t = width; width = height; height = t; }
    else if (inputProps.aspectRatio === '1:1') { width = Math.min(width, height); height = width; }

    let browser: Browser | null = null;
    let tempMixedAudio: string | null = null;
    const chunkFiles: string[] = [];
    const concatListPath = path.join(os.tmpdir(), `concat_${Date.now()}.txt`);
    const silentConcatPath = path.join(os.tmpdir(), `silent_${Date.now()}.mp4`);

    try {
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: true,
            protocolTimeout: 3600000, // 1-hour timeout prevents crashes on heavy renders
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--use-gl=swiftshader',
                '--font-render-hinting=none',
                '--enable-webgl',
                '--no-first-run',
                '--disable-extensions',
                '--autoplay-policy=no-user-gesture-required',
            ],
        });

        const bridgePayload = buildBridgePayload(inputProps, width, height, fps, appBaseUrl);
        const ranges = computeChunkFrameRanges(inputProps.clips || [], durationInFrames, fps, MAX_CHUNKS);
        console.log(`[Cloud Canvas Worker] Rendering ${durationInFrames} frames across ${ranges.length} parallel chunk(s)...`);

        let completedFrames = 0;
        const onFrameDone = () => {
            completedFrames++;
            if (completedFrames % 5 === 0 || completedFrames === durationInFrames) {
                // Frames represent 0% to 90% of total pipeline work
                const frameFraction = completedFrames / durationInFrames;
                const overallPct = frameFraction * 0.90;
                if (onProgress) onProgress(overallPct);
                console.log(`[Cloud Canvas Worker] Progress: ${Math.round(overallPct * 100)}% (${completedFrames}/${durationInFrames} frames)`);
            }
        };

        const chunkPaths = await Promise.all(ranges.map((range, i) => {
            const chunkOutputPath = path.join(os.tmpdir(), `chunk_${Date.now()}_${i}.mp4`);
            chunkFiles.push(chunkOutputPath);
            return renderChunk(browser!, appBaseUrl, bridgePayload, width, height, fps, range, i, chunkOutputPath, onFrameDone);
        }));

        if (onProgress) onProgress(0.92);
        console.log(`[Cloud Canvas Worker] Stitching ${chunkPaths.length} video chunks...`);

        // Stitch chunks together (stream copy — same codec/resolution/fps
        // across all chunks, so this is fast and lossless).
        fs.writeFileSync(concatListPath, chunkPaths.map(p => `file '${p}'`).join('\n'));
        await withTimeout(
            new Promise<void>((resolve, reject) => {
                const proc = spawn('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', silentConcatPath]);
                let err = '';
                proc.stderr.on('data', (d) => { err += d.toString(); });
                proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Chunk concat failed: ${err.slice(-500)}`)));
            }),
            60000, 'Chunk concat'
        );

        if (onProgress) onProgress(0.95);
        console.log(`[Cloud Canvas Worker] Resolving and mixing full timeline audio (voiceover, clips original audio, SFX, BGM)...`);

        let finalAudioPath: string | null = null;
        let audioCleanupList: string[] = [];

        try {
            const mixResult = await prepareTimelineAudioMix(inputProps, appBaseUrl);
            finalAudioPath = mixResult.finalAudioPath;
            audioCleanupList = mixResult.cleanupPaths;
        } catch (audioErr) {
            console.error('[Cloud Canvas Worker] Audio preparation error:', audioErr);
        }

        if (onProgress) onProgress(0.98);

        const muxArgs = ['-y', '-i', silentConcatPath];
        if (finalAudioPath) muxArgs.push('-i', finalAudioPath);
        muxArgs.push('-c:v', 'copy');
        if (finalAudioPath) muxArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
        muxArgs.push(outputFilePath);

        await withTimeout(
            new Promise<void>((resolve, reject) => {
                const proc = spawn('ffmpeg', muxArgs);
                let err = '';
                proc.stderr.on('data', (d) => { err += d.toString(); });
                proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Final audio mux failed: ${err.slice(-500)}`)));
            }),
            60000, 'Final audio mux'
        );

        // Clean up audio files
        for (const p of audioCleanupList) {
            try { fs.unlinkSync(p); } catch {}
        }

        if (onProgress) onProgress(1.0);

        console.log(`[Cloud Canvas Worker] Parallel render complete: ${outputFilePath}`);
        return outputFilePath;
    } finally {
        if (tempMixedAudio) { try { fs.unlinkSync(tempMixedAudio); } catch {} }
        for (const f of chunkFiles) { try { fs.unlinkSync(f); } catch {} }
        try { fs.unlinkSync(concatListPath); } catch {}
        try { fs.unlinkSync(silentConcatPath); } catch {}
        if (browser) await browser.close().catch(() => {});
    }
}
