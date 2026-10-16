/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getSafeTempDir, getGlobalFfmpegPath } from '../_core/ffmpeg';
import { consumeFileToken, issueFileToken, resolveFileToken } from '../_core/export-registry';
import { backendAuthGuard } from '../_core/security';

const router = express.Router();
const tmpDir = getSafeTempDir();
const upload = multer({ dest: tmpDir, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

function isPathInside(filePath: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(filePath));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function getTimeoutMs(name: string, fallback: number): number {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function terminate(proc: ReturnType<typeof spawn>): void {
    try {
        if (process.platform === 'win32') proc.kill();
        else proc.kill('SIGKILL');
    } catch {}
}

function runFFmpeg(args: string[], timeoutMs: number): Promise<{ ok: boolean; stderr: string; code: number | null }> {
    return new Promise((resolve) => {
        const proc = spawn(getGlobalFfmpegPath() || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            terminate(proc);
            resolve({ ok: false, stderr: `${stderr}\nFFmpeg operation timed out.`, code: null });
        }, timeoutMs);

        proc.stderr.on('data', (d) => {
            stderr = (stderr + d.toString()).slice(-8000);
        });
        proc.once('error', (error: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ok: false, stderr: `${stderr}\n${error?.message || 'spawn failed'}`, code: null });
        });
        proc.once('exit', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ ok: code === 0, stderr, code });
        });
    });
}

// Endpoint to stream local Remotion template project as a tar.gz bundle
router.get('/remotion-template.tar.gz', async (req, res) => {
    try {
        const rootDir = process.cwd();
        const tarArgs = [
            '-czf', '-', '--exclude=node_modules', '--exclude=.git', '--exclude=dist',
            '--exclude=.tmp', '--exclude=temp', 'package.json', 'tsconfig.json',
            'vite.config.ts', 'remotion.config.ts', 'src'
        ];

        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', 'attachment; filename="remotion-template.tar.gz"');
        const tarProc = spawn('tar', tarArgs, { cwd: rootDir });
        tarProc.stdout.pipe(res);
        tarProc.stderr.on('data', d => console.warn('[Remotion Bundle Tar Warning]:', d.toString().trim()));
        tarProc.on('error', (err) => {
            console.error('[Remotion Bundle Tar Error]:', err);
            if (!res.headersSent) res.status(500).json({ error: 'Failed to create Remotion bundle archive.' });
        });
    } catch (e: any) {
        if (!res.headersSent) res.status(500).json({ error: e.message || 'Archive creation failed' });
    }
});

router.post('/upload-audio', backendAuthGuard, upload.single('file'), (req, res) => {
    if (!req.file?.path) return res.status(400).json({ error: 'Audio file missing.' });
    res.json({ path: req.file.path });
});

// One-time capability registration for an Electron file that the app just exported.
router.post('/register-metadata-target', backendAuthGuard, (req, res) => {
    const rawPath = req.body?.filePath;
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return res.status(400).json({ error: 'filePath required' });
    }

    const resolved = path.resolve(rawPath);
    if (path.extname(resolved).toLowerCase() !== '.mp4') {
        return res.status(400).json({ error: 'Only MP4 files can be cleaned by this endpoint.' });
    }

    try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return res.status(400).json({ error: 'Target is not a file.' });
        if (stat.size < 1024) return res.status(400).json({ error: 'Target file is too small to be a valid export.' });
        if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) {
            return res.status(403).json({ error: 'Target file is too old to register for metadata cleaning.' });
        }

        const token = issueFileToken(resolved, 'metadata-clean');
        return res.json({ token });
    } catch (e: any) {
        return res.status(404).json({ error: `Target file is not accessible: ${e?.message || e}` });
    }
});

// Path remux for the Electron streaming path. The raw path is never accepted
// here; callers must present a short-lived registration token.
router.post('/clean-metadata-path', backendAuthGuard, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string') return res.status(400).json({ error: 'token required' });

    const filePath = consumeFileToken(token, 'metadata-clean');
    if (!filePath) return res.status(403).json({ error: 'Invalid or expired metadata-clean token.' });

    const make = String(req.body?.make || 'Apple').trim().replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'Apple';
    const model = String(req.body?.model || 'iPhone 14').trim().replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'iPhone 14';
    const software = String(req.body?.software || '17.5.1').trim().replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || '17.5.1';
    const encoderTag = String(req.body?.encoder || software).trim().replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || software;
    const comment = req.body?.comment ? String(req.body.comment).trim().replace(/[^a-zA-Z0-9 .:_-]/g, '').slice(0, 500) : '';

    let originalStat: fs.Stats;
    try {
        originalStat = fs.statSync(filePath);
        if (!originalStat.isFile()) return res.status(400).json({ error: 'Target is not a regular file.' });
    } catch {
        return res.status(404).json({ error: 'Export file no longer exists.' });
    }

    // Write output directly next to the target file on the same drive for instant atomic replacement (no multi-GB file copies)
    const tmpOut = `${filePath}.cleaning_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;

    try {
        const args = [
            '-y', '-i', filePath,
            '-map_metadata', '-1', '-map_chapters', '-1',
            '-codec', 'copy',
            '-movflags', '+faststart', '-brand', 'qt  ',
            '-metadata', `make=${make}`,
            '-metadata', `model=${model}`,
            '-metadata', `encoder=${encoderTag}`,
            ...(comment ? ['-metadata', `comment=${comment}`] : []),
            '-metadata:s:v', 'handler_name=Core Media Video',
            '-metadata:s:a', 'handler_name=Core Media Audio',
            tmpOut,
        ];

        let result = await runFFmpeg(args, getTimeoutMs('FFMPEG_METADATA_TIMEOUT_MS', 30 * 60 * 1000));
        if (!result.ok) {
            console.warn('[Clean Metadata] Fast remux failed, retrying with compatibility transcode:', result.stderr.slice(-2000));
            result = await runFFmpeg([
                '-y', '-i', filePath,
                '-map_metadata', '-1', '-map_chapters', '-1',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-brand', 'qt  ',
                '-metadata', `make=${make}`,
                '-metadata', `model=${model}`,
                '-metadata', `encoder=${encoderTag}`,
                ...(comment ? ['-metadata', `comment=${comment}`] : []),
                '-metadata:s:v', 'handler_name=Core Media Video',
                '-metadata:s:a', 'handler_name=Core Media Audio',
                tmpOut,
            ], getTimeoutMs('FFMPEG_METADATA_TIMEOUT_MS', 30 * 60 * 1000));
        }

        if (!result.ok || !fs.existsSync(tmpOut)) {
            try { await fs.promises.unlink(tmpOut); } catch {}
            return res.status(500).json({ error: `FFmpeg metadata remux failed.${result.stderr ? ` ${result.stderr.slice(-1500)}` : ''}` });
        }

        const cleanStat = fs.statSync(tmpOut);
        if (cleanStat.size < 1024 || cleanStat.size < Math.floor(originalStat.size * 0.05)) {
            try { await fs.promises.unlink(tmpOut); } catch {}
            return res.status(500).json({ error: 'FFmpeg produced an implausibly small cleaned file.' });
        }

        // Atomic swap on same drive (instant, 0ms copying). Fallback to copy+unlink if cross-device.
        try {
            await fs.promises.rename(tmpOut, filePath);
        } catch (renameErr) {
            await fs.promises.copyFile(tmpOut, filePath);
            try { await fs.promises.unlink(tmpOut); } catch {}
        }

        return res.json({ ok: true });
    } catch (e: any) {
        try { await fs.promises.unlink(tmpOut); } catch {}
        console.error('[Clean Metadata] Path remux failed:', e);
        return res.status(500).json({ error: e?.message || 'Metadata remux failed.' });
    }
});

// Endpoint for high-speed FFmpeg concat demuxing (-c copy) of segmented video exports
router.post('/ffmpeg-concat-segments', backendAuthGuard, async (req, res) => {
    const segmentPaths = req.body?.segmentPaths;
    const requestedOutputPath = req.body?.outputPath;

    if (!segmentPaths || !Array.isArray(segmentPaths) || segmentPaths.length === 0) {
        return res.status(400).json({ error: 'segmentPaths array required.' });
    }

    const finalOutputPath = requestedOutputPath || path.join(tmpDir, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`);
    const manifestPath = path.join(tmpDir, `manifest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);

    try {
        const lines = segmentPaths.map((p: string) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n');
        await fs.promises.writeFile(manifestPath, lines, 'utf8');

        await fs.promises.mkdir(path.dirname(finalOutputPath), { recursive: true });

        const args = [
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', manifestPath,
            '-c', 'copy',
            '-movflags', '+faststart',
            finalOutputPath
        ];

        const result = await runFFmpeg(args, getTimeoutMs('FFMPEG_CONCAT_TIMEOUT_MS', 15 * 60 * 1000));
        try { await fs.promises.unlink(manifestPath); } catch {}

        if (!result.ok || !fs.existsSync(finalOutputPath)) {
            return res.status(500).json({ error: `FFmpeg concat demux failed: ${result.stderr}` });
        }

        const stat = fs.statSync(finalOutputPath);
        return res.json({ ok: true, outputPath: finalOutputPath, size: stat.size });
    } catch (err: any) {
        try { await fs.promises.unlink(manifestPath); } catch {}
        console.error('[FFmpeg Concat API Error]:', err);
        return res.status(500).json({ error: err?.message || 'FFmpeg concat operation failed.' });
    }
});

// Endpoint to strip AI / C2PA container metadata and inject device-profile tags.
router.post('/clean-metadata', backendAuthGuard, upload.single('video'), async (req, res) => {
    if (!req.file?.path) return res.status(400).json({ error: 'No video file provided' });

    const inputPath = req.file.path;
    const make = String(req.body?.make || 'Apple').trim().replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'Apple';
    const model = String(req.body?.model || 'iPhone 14').trim().replace(/[^a-zA-Z0-9 -]/g, '').slice(0, 64) || 'iPhone 14';
    const software = String(req.body?.software || '17.5.1').trim().replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || '17.5.1';
    const encoder = String(req.body?.encoder || 'HEVC').trim().replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64) || 'HEVC';
    const comment = req.body?.comment ? String(req.body.comment).trim().replace(/[^a-zA-Z0-9 .:_-]/g, '').slice(0, 500) : '';
    const outputPath = path.join(tmpDir, `clean-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`);

    try {
        let result = await runFFmpeg([
            '-y', '-i', inputPath,
            '-map_metadata', '-1', '-map_chapters', '-1', '-codec', 'copy',
            '-movflags', '+faststart', '-brand', 'qt  ',
            '-metadata', `make=${make}`, '-metadata', `model=${model}`, '-metadata', `encoder=${encoder}`,
            ...(comment ? ['-metadata', `comment=${comment}`] : []),
            '-metadata:s:v', 'handler_name=Core Media Video',
            '-metadata:s:a', 'handler_name=Core Media Audio',
            outputPath,
        ], getTimeoutMs('FFMPEG_METADATA_TIMEOUT_MS', 30 * 60 * 1000));

        if (!result.ok) {
            console.warn('[Clean Metadata] Fast remux failed, attempting compatibility transcode...');
            result = await runFFmpeg([
                '-y', '-i', inputPath,
                '-map_metadata', '-1', '-map_chapters', '-1',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', '-brand', 'qt  ',
                '-metadata', `make=${make}`, '-metadata', `model=${model}`, '-metadata', `encoder=${encoder}`,
                ...(comment ? ['-metadata', `comment=${comment}`] : []),
                '-metadata:s:v', 'handler_name=Core Media Video',
                '-metadata:s:a', 'handler_name=Core Media Audio',
                outputPath,
            ], getTimeoutMs('FFMPEG_METADATA_TIMEOUT_MS', 30 * 60 * 1000));
        }

        if (!result.ok || !fs.existsSync(outputPath)) {
            return res.status(500).json({ error: 'FFmpeg metadata stripping and remuxing failed' });
        }

        const outputStat = fs.statSync(outputPath);
        if (outputStat.size < 1024) return res.status(500).json({ error: 'Cleaned video is invalid or empty.' });

        res.download(outputPath, 'cleaned_video.mp4', (downloadError) => {
            try { fs.unlinkSync(inputPath); } catch {}
            try { fs.unlinkSync(outputPath); } catch {}
            if (downloadError) console.warn('[Clean Metadata] Download finished with error:', downloadError.message);
        });
    } catch (e: any) {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outputPath); } catch {}
        return res.status(500).json({ error: e?.message || 'Metadata cleaning failed' });
    }
});

// Browser/cloud downloads are capability-token based. Raw filesystem paths are never accepted.
router.get('/download-export', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const targetPath = resolveFileToken(token, 'download');
    if (!targetPath) return res.status(404).json({ error: 'Export file not found, expired, or already removed.' });

    if (!isPathInside(targetPath, tmpDir)) {
        return res.status(403).json({ error: 'Invalid export token.' });
    }

    const safeBaseName = path.basename(targetPath);
    return res.download(targetPath, safeBaseName, (err) => {
        if (err && !res.headersSent) res.status(500).json({ error: 'Export download failed.' });
    });
});

// ─── Media & Voice Provider API Verifications ─────────────────────────────────

router.post('/test/elevenlabs', async (req, res) => {
    const startTime = Date.now();
    try {
        const apiKey = (req.body?.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ valid: false, error: 'ElevenLabs API key is required' });

        const subRes = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
            headers: { 'xi-api-key': apiKey }
        });

        const latencyMs = Date.now() - startTime;

        if (subRes.ok) {
            const data = await subRes.json() as any;
            const remaining = Math.max(0, (data.character_limit || 0) - (data.character_count || 0));
            return res.json({
                valid: true,
                tier: data.tier || 'free',
                status: data.status || 'active',
                characterCount: data.character_count || 0,
                characterLimit: data.character_limit || 0,
                remainingCharacters: remaining,
                message: `Connected! Tier: ${data.tier || 'standard'} (${remaining.toLocaleString()} characters remaining)`,
                latencyMs
            });
        }

        const errData = await subRes.json().catch(() => ({}));
        const errMsg = (errData as any)?.detail?.message || `ElevenLabs returned HTTP ${subRes.status}`;
        return res.json({
            valid: false,
            error: subRes.status === 401 ? 'Invalid ElevenLabs API key' : errMsg,
            latencyMs
        });
    } catch (err: any) {
        return res.json({
            valid: false,
            error: err?.message || 'Failed to connect to ElevenLabs API',
            latencyMs: Date.now() - startTime
        });
    }
});

router.post('/test/stability', async (req, res) => {
    const startTime = Date.now();
    try {
        const apiKey = (req.body?.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ valid: false, error: 'Stability AI API key is required' });

        const balanceRes = await fetch('https://api.stability.ai/v1/user/balance', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        const latencyMs = Date.now() - startTime;

        if (balanceRes.ok) {
            const data = await balanceRes.json() as any;
            const credits = typeof data.credits === 'number' ? data.credits : 0;
            return res.json({
                valid: true,
                credits,
                message: `Connected! Balance: ${credits.toFixed(2)} credits`,
                latencyMs
            });
        }

        const errData = await balanceRes.json().catch(() => ({}));
        const errMsg = (errData as any)?.message || `Stability returned HTTP ${balanceRes.status}`;
        return res.json({
            valid: false,
            error: balanceRes.status === 401 ? 'Invalid Stability AI API key' : errMsg,
            latencyMs
        });
    } catch (err: any) {
        return res.json({
            valid: false,
            error: err?.message || 'Failed to connect to Stability AI',
            latencyMs: Date.now() - startTime
        });
    }
});

router.post('/test/deepgram', async (req, res) => {
    const startTime = Date.now();
    try {
        const apiKey = (req.body?.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ valid: false, error: 'Deepgram API key is required' });

        const dgRes = await fetch('https://api.deepgram.com/v1/projects', {
            headers: {
                'Authorization': `Token ${apiKey}`
            }
        });

        const latencyMs = Date.now() - startTime;

        if (dgRes.ok) {
            const data = await dgRes.json() as any;
            const projectCount = Array.isArray(data?.projects) ? data.projects.length : 0;
            return res.json({
                valid: true,
                projectCount,
                message: `Connected successfully to Deepgram! (${projectCount} project(s) accessible)`,
                latencyMs
            });
        }

        return res.json({
            valid: false,
            error: dgRes.status === 401 ? 'Invalid Deepgram API key (Token unauthorized)' : `Deepgram error: HTTP ${dgRes.status}`,
            latencyMs
        });
    } catch (err: any) {
        return res.json({
            valid: false,
            error: err?.message || 'Failed to reach Deepgram API',
            latencyMs: Date.now() - startTime
        });
    }
});

router.post('/test/pexels', async (req, res) => {
    const startTime = Date.now();
    try {
        const apiKey = (req.body?.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ valid: false, error: 'Pexels API key is required' });

        const pxRes = await fetch('https://api.pexels.com/v1/curated?per_page=1', {
            headers: { 'Authorization': apiKey }
        });

        const latencyMs = Date.now() - startTime;

        if (pxRes.ok) {
            const rateLimitRemaining = pxRes.headers.get('x-ratelimit-remaining');
            return res.json({
                valid: true,
                rateLimitRemaining: rateLimitRemaining || null,
                message: 'Connected to Pexels Stock Media API!',
                latencyMs
            });
        }

        return res.json({
            valid: false,
            error: pxRes.status === 401 ? 'Invalid Pexels API key' : `Pexels returned HTTP ${pxRes.status}`,
            latencyMs
        });
    } catch (err: any) {
        return res.json({
            valid: false,
            error: err?.message || 'Failed to reach Pexels API',
            latencyMs: Date.now() - startTime
        });
    }
});

router.post('/test/freesound', async (req, res) => {
    const startTime = Date.now();
    try {
        const apiKey = (req.body?.apiKey || '').trim();
        if (!apiKey) return res.status(400).json({ valid: false, error: 'Freesound API key is required' });

        const fsRes = await fetch(`https://freesound.org/apiv2/search/text/?query=cinema&page_size=1&token=${encodeURIComponent(apiKey)}`);
        const latencyMs = Date.now() - startTime;

        if (fsRes.ok) {
            return res.json({
                valid: true,
                message: 'Connected to Freesound SFX API!',
                latencyMs
            });
        }

        return res.json({
            valid: false,
            error: fsRes.status === 401 ? 'Invalid Freesound API key' : `Freesound returned HTTP ${fsRes.status}`,
            latencyMs
        });
    } catch (err: any) {
        return res.json({
            valid: false,
            error: err?.message || 'Failed to reach Freesound API',
            latencyMs: Date.now() - startTime
        });
    }
});

// In-memory geocode cache
const geocodeCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

// Geocoding Proxy Endpoint
router.get('/geocode', async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!query || query.length < 2) {
            return res.json({ results: [] });
        }

        const cacheKey = `geo:${query.toLowerCase()}`;
        const cached = geocodeCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return res.json({ results: cached.data });
        }

        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=6`;
        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'ContentGen-AI-MapStudio/1.0 (https://contentgen.ai)',
                'Accept-Language': 'en'
            },
            signal: AbortSignal.timeout(4000)
        });

        if (!resp.ok) {
            return res.json({ results: [] });
        }

        const data: any[] = await resp.json();
        const results = (Array.isArray(data) ? data : []).map((item) => {
            const name = item.display_name?.split(',')[0]?.trim() || query;
            const country = item.address?.country || '';
            const state = item.address?.state || item.address?.region || '';
            const lat = Number(item.lat);
            const lng = Number(item.lon);
            return {
                name,
                country,
                state,
                lat,
                lng,
                displayName: item.display_name
            };
        }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));

        geocodeCache.set(cacheKey, { data: results, timestamp: Date.now() });
        return res.json({ results });
    } catch (err: any) {
        return res.json({ results: [] });
    }
});

// Reverse Geocoding Proxy Endpoint
router.get('/geocode/reverse', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res.status(400).json({ error: 'Valid lat and lng required' });
        }

        const cacheKey = `rev:${lat.toFixed(3)},${lng.toFixed(3)}`;
        const cached = geocodeCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return res.json(cached.data);
        }

        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'ContentGen-AI-MapStudio/1.0 (https://contentgen.ai)',
                'Accept-Language': 'en'
            },
            signal: AbortSignal.timeout(4000)
        });

        if (!resp.ok) {
            return res.json({ name: `Location (${lat.toFixed(2)}, ${lng.toFixed(2)})`, country: '' });
        }

        const data = await resp.json();
        const name = data.address?.city || data.address?.town || data.address?.village || data.address?.county || data.display_name?.split(',')[0] || `Location (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
        const country = data.address?.country || '';

        const result = { name, country, lat, lng, displayName: data.display_name || name };
        geocodeCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return res.json(result);
    } catch (err: any) {
        return res.json({ name: `Location (${req.query.lat}, ${req.query.lng})`, country: '' });
    }
});

export default router;
