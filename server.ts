/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { initEnvironment, isWebSocketClosedError, isAIStudioEnvironment } from './server/_core/env';
import { initFFmpeg, setupFFmpegWS } from './server/_core/ffmpeg';
import { isAllowedOrigin, backendAuthGuard, aiGatewayLimiter, mediaLimiter, cloudRenderLimiter, llmLimiter, transcribeLimiter, gradioLimiter, depthLimiter, edgeTtsLimiter } from './server/_core/security';
import { startAwsRecoveryLoop } from './server/awsRenderManager';

import proxyRouter from './server/routes/proxy';
import transcribeRouter from './server/routes/transcribe';
import gradioRouter from './server/routes/gradio';
import vertexRouter from './server/routes/vertex';
import geminiRouter from './server/routes/gemini';
import openaiRouter from './server/routes/openai';
import authRouter from './server/routes/auth';
import mediaRouter from './server/routes/media';
import cloudRenderRouter from './server/routes/cloudRender';
import depthRouter from './server/routes/depth';
import edgeTtsRouter from './server/routes/edgeTts';



initEnvironment();

const _filename = typeof __filename !== 'undefined' ? __filename : (import.meta.url ? fileURLToPath(import.meta.url) : '');
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

const app = express();
app.set('trust proxy', 1);

app.use(cookieParser());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || isAllowedOrigin(origin)), credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON payload in request body' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Payload too large.' });
    }
    next(err);
});

// Health check endpoints
app.get(['/api/health', '/healthz', '/livez', '/health'], (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

// Mount modular API route groups
app.use('/api/genai', backendAuthGuard, aiGatewayLimiter, geminiRouter);
app.use('/api/gemini', backendAuthGuard, aiGatewayLimiter, geminiRouter);
app.use('/api/vertex', backendAuthGuard, aiGatewayLimiter, vertexRouter);
app.use('/api/openai', backendAuthGuard, aiGatewayLimiter, openaiRouter);
app.use('/api/llm', backendAuthGuard, llmLimiter, proxyRouter);
app.use('/api/transcribe', backendAuthGuard, transcribeLimiter, transcribeRouter);
app.use('/api/gradio', backendAuthGuard, gradioLimiter, gradioRouter);
app.use('/api/depth', backendAuthGuard, depthLimiter, depthRouter);
app.use('/api/cloud-render', backendAuthGuard, cloudRenderLimiter, cloudRenderRouter);
app.use('/api/edge-tts', backendAuthGuard, edgeTtsLimiter, edgeTtsRouter);
app.use('/api/tts', backendAuthGuard, edgeTtsLimiter, edgeTtsRouter);
app.use('/api', backendAuthGuard, authRouter);
app.use('/api', backendAuthGuard, mediaLimiter, mediaRouter);
app.use('/api', backendAuthGuard, cloudRenderLimiter, cloudRenderRouter);

// Serve Built Frontend & Vite Dev Middleware
async function startServer() {
    // 1. Electron supplies a dynamic PORT. Cloud Run supplies PORT=8080 at runtime.
    const targetPort = Number(process.env.PORT) || 3000;
    const bindHost = process.env.IS_DESKTOP === 'true' ? '127.0.0.1' : '0.0.0.0';

    // 2. Start HTTP server IMMEDIATELY so Cloud Run port checks & probes pass in <10ms
    const server = app.listen(targetPort, bindHost, () => {
        const envLabel = isAIStudioEnvironment() ? ' (Google AI Studio / Cloud Run Mode)' : ' (Local Desktop / Development Mode)';
        console.log(`\n🚀 ContentGen AI Server running at http://${bindHost}:${targetPort}${envLabel}\n`);
    });

    // Start background AWS Lambda render recovery & state reconciliation loop
    void startAwsRecoveryLoop();

    server.on('error', (err: any) => {
        console.error('[HTTP Server Error]:', err?.message || err);
    });

    // 3. Resolve frontend static assets and middleware
    const candidateDistPaths = [
        path.join(process.cwd(), 'dist'),
        path.join(_dirname, 'dist'),
        path.join(_dirname, '..', 'dist'),
        _dirname,
        process.env.RESOURCES_PATH ? path.join(process.env.RESOURCES_PATH, 'app.asar.unpacked', 'dist') : '',
        process.env.RESOURCES_PATH ? path.join(process.env.RESOURCES_PATH, 'dist') : '',
        path.join(_dirname, '..', '..', 'dist')
    ].filter(Boolean);
    const distPath = candidateDistPaths.find(p => fs.existsSync(path.join(p, 'index.html'))) || candidateDistPaths[0];
    const hasBuiltDist = fs.existsSync(path.join(distPath, 'index.html'));
    const isDev = process.env.NODE_ENV !== 'production';

    if (!isDev) {
        if (hasBuiltDist) {
            app.use(express.static(distPath));
            app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
        } else {
            app.get('*', (_req, res) => res.status(200).send('<!DOCTYPE html><html><head><title>ContentGen AI</title></head><body><h1>ContentGen AI is starting up...</h1><script>setTimeout(() => location.reload(), 2000);</script></body></html>'));
        }
    } else {
        try {
            const viteSpecifier = 'vite';
            const { createServer: createViteServer } = await import(/* @vite-ignore */ viteSpecifier);
            const vite = await createViteServer({
                server: { middlewareMode: true, strictPort: false, hmr: false },
                appType: 'spa',
            });
            app.use(vite.middlewares);

            // In Vite middleware mode, ensure all SPA non-API GET routes serve transformed index.html
            app.get('*', async (req, res, next) => {
                const url = req.originalUrl || req.url;
                if (url.startsWith('/api/') || url.startsWith('/ffmpeg-export')) {
                    return next();
                }
                try {
                    const rawIndexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
                    const transformedHtml = await vite.transformIndexHtml(url, rawIndexHtml);
                    res.status(200).set({ 'Content-Type': 'text/html' }).end(transformedHtml);
                } catch (htmlErr) {
                    next(htmlErr);
                }
            });
        } catch (viteErr: any) {
            console.error('[Vite Server Error]:', viteErr);
            if (hasBuiltDist) {
                app.use(express.static(distPath));
                app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
            } else {
                app.get('*', (_req, res) => res.status(200).send('<!DOCTYPE html><html><head><title>ContentGen AI</title></head><body><h1>ContentGen AI is starting up...</h1></body></html>'));
            }
        }
    }

    // 4. Initialize FFmpeg and WebSocket in the background without delaying port binding
    initFFmpeg().then((globalFfmpegPath) => {
        try {
            const wss = new WebSocketServer({ 
                server, 
                path: '/ffmpeg-export',
                verifyClient: (info, callback) => {
                    const origin = (info.origin || info.req.headers.origin) as string | undefined;
                    const referer = info.req.headers.referer as string | undefined;
                    const hostHeader = info.req.headers.host;
                    if (!origin && !referer) return callback(false, 403, 'Forbidden: Missing Origin and Referer');
                    if (origin && !isAllowedOrigin(origin, hostHeader)) return callback(false, 403, 'Forbidden origin');
                    if (referer && !isAllowedOrigin(referer, hostHeader)) return callback(false, 403, 'Forbidden referer');
                    callback(true);
                }
            });

            wss.on('error', (err: any) => {
                if (isWebSocketClosedError(err)) console.warn('[WS Server Warning]:', err?.message || err);
                else console.error('[WS Server Error]:', err);
            });
            setupFFmpegWS(wss, globalFfmpegPath);
        } catch (wsSetupErr: any) {
            console.warn('[WS Setup Warning]:', wsSetupErr?.message || wsSetupErr);
        }
    }).catch(fErr => console.warn('[FFmpeg Init Warning]:', fErr));
}

startServer().catch((err) => {
    console.error('[SERVER CRITICAL] Failed to start server:', err);
});
