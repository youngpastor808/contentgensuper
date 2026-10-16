import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import axios from 'axios';
import { getSessionCookieOptions } from '../cookies';
import { log } from '../utils';
import { fetchGeminiWebCredentials, callGeminiWeb, buildCookieHeaderFromObject, extractThinkingAndText, stripCodeFence, buildToolBridgePrompt, parseToolBridgeOutput, decodeBase64Data, extensionForMimeType, invalidateGeminiWebCredentialsCache, getFreshCookieHeader, getFreshCookieObject, clearCookieJar, getGeminiWebModelId } from '../_core/geminiCookieProxy';

const router = express.Router();

import geminiReverse from 'gemini-reverse';
const GeminiClient: any = (geminiReverse as any)?.GeminiClient || (geminiReverse as any)?.Gemini;

// ─── Health Check ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
    res.json({
        ok: true,
        services: ['gemini', 'claude', 'metaai'],
        note: 'Gemini supports both consumer (gemini.google.com) and Workspace (business.gemini.google) accounts'
    });
});

// ─── Security Helpers ──────────────────────────────────────────────────────────
export function isAllowedGoogleImageHost(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl.startsWith('//') ? 'https:' + rawUrl : rawUrl);
        if (u.protocol !== 'https:') return false;
        const host = u.hostname.toLowerCase();
        return (
            host === 'googleusercontent.com' ||
            host.endsWith('.googleusercontent.com') ||
            host === 'ggpht.com' ||
            host.endsWith('.ggpht.com') ||
            host === 'gemini.google.com' ||
            host === 'business.gemini.google'
        );
    } catch {
        return false;
    }
}

// ─── Gemini Web Proxy ─────────────────────────────────────────────────────────
function getEffectiveCookies(req: express.Request): Record<string, string> {
    const bodyCookies = req.body.cookies;
    if (bodyCookies && Object.keys(bodyCookies).length > 0) return bodyCookies;

    const proxyAuth = req.cookies.proxy_auth;
    if (proxyAuth) {
        try {
            return JSON.parse(proxyAuth);
        } catch { /* skip */ }
    }

    return {};
}

function getCacheKey(cookies: Record<string, string>): string {
    const psid = cookies['__Secure-1PSID'] || '';
    const psidts = cookies['__Secure-1PSIDTS'] || '';
    const compass = cookies['COMPASS'] || '';
    const sid = cookies['SID'] || '';
    return `${psid}:${psidts}:${compass}:${sid}`;
}

const geminiClientCache = new Map();

async function getGeminiClient(cookies: Record<string, string>) {
    const cacheKey = getCacheKey(cookies);

    if (geminiClientCache.has(cacheKey)) {
        const cached = geminiClientCache.get(cacheKey);
        if (Date.now() - cached.initTime < 24 * 60 * 60 * 1000) {
            return cached.client;
        }
        try { await cached.client.close(); } catch {}
        geminiClientCache.delete(cacheKey);
    }

    const client = new GeminiClient({
        cookies: cookies
    });

    await client.init({
        timeout: 60000,    // 60s — image generation takes longer than text
        autoClose: false,
        autoRefresh: true, // Auto-refresh session to avoid mid-session 403s
        verbose: false,
    });

    geminiClientCache.set(cacheKey, { client, initTime: Date.now() });
    return client;
}

router.post('/gemini', async (req, res) => {
    const { prompt, systemInstruction, model, tools, attachments, contents } = req.body;
    const cookies = getEffectiveCookies(req);
    const psid = cookies?.['__Secure-1PSID'];
    const psidts = cookies?.['__Secure-1PSIDTS'];

    if (!psid) {
        return res.status(400).json({ error: 'Missing __Secure-1PSID cookie' });
    }

    // 1. Process inline attachments and multi-part contents
    const processedAttachments: { name: string; mimeType: string; buffer: Buffer }[] = [];
    if (Array.isArray(attachments)) {
        for (let i = 0; i < attachments.length; i++) {
            const att = attachments[i];
            const { buffer, mimeType } = decodeBase64Data(att.data || att.inlineData?.data || att.url || '');
            if (buffer.length > 0) {
                const ext = extensionForMimeType(att.mimeType || mimeType);
                processedAttachments.push({
                    name: att.name || `attachment_${i + 1}${ext}`,
                    mimeType: att.mimeType || mimeType,
                    buffer
                });
            }
        }
    }

    // 2. Build effective prompt with optional tool bridge formatting
    let effectivePrompt = prompt || '';
    if (!effectivePrompt && Array.isArray(contents)) {
        effectivePrompt = contents.map((c: any) => {
            if (typeof c === 'string') return c;
            if (c?.parts) return c.parts.map((p: any) => p.text || '').join('\n');
            return '';
        }).join('\n').trim();
    }

    if (processedAttachments.length > 0 && !effectivePrompt) {
        effectivePrompt = `[${processedAttachments.length} file(s) attached]`;
    }

    const hasTools = Array.isArray(tools) && tools.length > 0;
    if (hasTools) {
        effectivePrompt = buildToolBridgePrompt(tools, effectivePrompt);
    }

    log('Gemini', `Request: ${String(effectivePrompt).slice(0, 80)}... (attachments: ${processedAttachments.length}, tools: ${hasTools})`);

    const fullPrompt = systemInstruction
        ? `${systemInstruction}\n\n${effectivePrompt}`
        : effectivePrompt;

    const cookieHeader = buildCookieHeaderFromObject(cookies);

    // First attempt: lightweight direct fetch call to gemini.google.com
    try {
        const result = await callGeminiWeb(fullPrompt, cookieHeader, model || "gemini-3-flash");
        const cleanText = result.text;

        const latestCookies = (result as any).updatedCookies || getFreshCookieObject(cookies);
        const options = getSessionCookieOptions(req);
        res.cookie('proxy_auth', JSON.stringify(latestCookies), {
            ...options,
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        // Parse tool calls if tool bridge is active
        if (hasTools) {
            const { toolCalls, content } = parseToolBridgeOutput(cleanText);
            if (toolCalls && toolCalls.length > 0) {
                log('Gemini', `Success (direct web proxy tool call): ${toolCalls.length} calls`);
                return res.json({
                    text: content || '',
                    toolCalls,
                    finishReason: 'FUNCTION_CALL',
                    thinking: result.thinking || null,
                    provider: 'gemini-web'
                });
            }
        }

        log('Gemini', `Success (direct web proxy), ${cleanText.length} chars${result.thinking ? ' (with thinking)' : ''}`);
        return res.json({
            text: cleanText,
            toolCalls: null,
            finishReason: 'STOP',
            thinking: result.thinking || null,
            provider: 'gemini-web'
        });
    } catch (directErr: any) {
        log('Gemini', `Direct web proxy notice: ${directErr.message}. Trying client fallback...`, true);

        // Second attempt: gemini-reverse GeminiClient fallback
        try {
            const client = await getGeminiClient(cookies);

            let chatModel = model;
            if (chatModel) {
                chatModel = chatModel.replace('-preview', '');
                if (chatModel.includes('flash-image') || chatModel.includes('imagen')) chatModel = undefined;
            }

            // Dynamically resolve model if client supports resolution or fallback to standard aliases
            let resolvedModel = chatModel;
            if (typeof client.resolve_model === 'function' && chatModel) {
                try { resolvedModel = client.resolve_model(chatModel); } catch {}
            }

            const chat = client.startChat(resolvedModel ? { model: resolvedModel } : undefined);
            
            // Support passing image buffers to chat if client supports files
            // Enable temporary: true to avoid flooding user's personal Gemini chat history
            const sendPayload: any = { prompt: fullPrompt, temporary: true };
            if (processedAttachments.length > 0) {
                sendPayload.files = processedAttachments.map(a => ({
                    name: a.name,
                    mimeType: a.mimeType,
                    data: a.buffer
                }));
            }

            const response = await chat.sendMessage(sendPayload);

            const rawText = response.text;
            if (!rawText) {
                throw new Error('Gemini returned an empty response. Cookie may be expired or rate-limited.');
            }

            const thoughts = response.thoughts || response.thinking;
            const { thinking, text: cleanText } = extractThinkingAndText(rawText);
            const finalText = cleanText || rawText;

            const latestCookies = getFreshCookieObject(cookies);
            const options = getSessionCookieOptions(req);
            res.cookie('proxy_auth', JSON.stringify(latestCookies), {
                ...options,
                maxAge: 30 * 24 * 60 * 60 * 1000
            });

            if (hasTools) {
                const { toolCalls, content } = parseToolBridgeOutput(finalText);
                if (toolCalls && toolCalls.length > 0) {
                    log('Gemini', `Success (gemini-reverse tool call): ${toolCalls.length} calls`);
                    return res.json({
                        text: content || '',
                        toolCalls,
                        finishReason: 'FUNCTION_CALL',
                        thinking: thinking || thoughts || null,
                        provider: 'gemini-web'
                    });
                }
            }

            log('Gemini', `Success (gemini-reverse), ${finalText.length} chars`);
            return res.json({
                text: finalText,
                toolCalls: null,
                finishReason: 'STOP',
                thinking: thinking || thoughts || null,
                provider: 'gemini-web'
            });

        } catch (err: any) {
            const cacheKey = getCacheKey(cookies);
            invalidateGeminiWebCredentialsCache(cookieHeader);
            if (geminiClientCache.has(cacheKey)) {
                try { await geminiClientCache.get(cacheKey).client.close(); } catch {}
                geminiClientCache.delete(cacheKey);
            }

            const msg = err.message || String(err);
            log('Gemini', msg, true);

            if (msg.includes('NOT_LOGGED_IN') || msg.includes('Cookies invalid') || msg.includes('AuthError') || msg.includes('Failed to initialize') || msg.includes('Invalid session')) {
                return res.status(401).json({
                    error: 'Gemini cookie is invalid or expired. Please refresh your __Secure-1PSID and __Secure-1PSIDTS cookies from gemini.google.com and save them again.'
                });
            }
            if (msg.includes('UsageLimitExceeded') || msg.includes('1037')) {
                return res.status(429).json({
                    error: 'Gemini usage limit exceeded. Try again later or use a different account.'
                });
            }
            if (msg.includes('TemporarilyBlocked') || msg.includes('1060')) {
                return res.status(429).json({
                    error: 'Your IP is temporarily blocked by Gemini. Try again in a few minutes.'
                });
            }

            return res.status(500).json({ error: msg });
        }
    }
});

router.post('/gemini/image', async (req, res) => {
    const { prompt, model, aspectRatio, referenceImage, image } = req.body;
    const cookies = getEffectiveCookies(req);
    const psid = cookies?.['__Secure-1PSID'];
    const psidts = cookies?.['__Secure-1PSIDTS'];

    if (!psid) {
        return res.status(400).json({ error: 'Missing __Secure-1PSID cookie' });
    }

    // Build prompt with aspect ratio instructions
    let ratioHint = '';
    if (aspectRatio === '9:16' || aspectRatio === 'portrait') {
        ratioHint = ' in vertical 9:16 portrait format.';
    } else if (aspectRatio === '16:9' || aspectRatio === 'landscape') {
        ratioHint = ' in widescreen 16:9 landscape format.';
    } else if (aspectRatio === '1:1' || aspectRatio === 'square') {
        ratioHint = ' in 1:1 square format.';
    }

    const isImageEdit = !!(referenceImage || image);
    // Explicit trigger keywords ensure Gemini Web activates its internal Imagen generation tool
    const effectivePrompt = isImageEdit
        ? `Generate an edited high-resolution image modifying the attached visual with the following instructions: ${prompt}${ratioHint}. Output the visual directly.`
        : `Generate a detailed high-resolution image of: ${prompt}${ratioHint}. Render a high-quality visual illustration or photograph.`;

    log('Gemini Image', `Request: ${String(effectivePrompt).slice(0, 80)}... (isEdit: ${isImageEdit})`);

    // Process reference image if supplied
    const processedAttachments: { name: string; mimeType: string; buffer: Buffer }[] = [];
    const refData = referenceImage?.data || referenceImage?.inlineData?.data || referenceImage?.url || (typeof referenceImage === 'string' ? referenceImage : '') ||
                    image?.data || image?.inlineData?.data || image?.url || (typeof image === 'string' ? image : '');
    if (refData) {
        const { buffer, mimeType } = decodeBase64Data(refData);
        if (buffer.length > 0) {
            processedAttachments.push({
                name: 'reference_image.jpg',
                mimeType: mimeType || 'image/jpeg',
                buffer
            });
        }
    }

    const downloadGoogleImage = async (rawUrl: string, cookieObj: Record<string, string>): Promise<{ base64: string; mimeType: string } | null> => {
        let targetUrl = rawUrl.replace(/[\n\r]/g, '').trim();
        // Strict allowlist: Only allowed Google CDN hosts ever receive connections / cookies
        if (!isAllowedGoogleImageHost(targetUrl)) {
            log('Gemini Image', `Disallowed non-Google image URL blocked: ${targetUrl.slice(0, 60)}...`);
            return null;
        }

        // Ignore unroutable internal placeholder paths that never resolve on public CDN
        if (targetUrl.includes('image_generation_content') || targetUrl.includes('card_content')) {
            if (!targetUrl.includes('/gg-dl/') && !targetUrl.includes('/rd-gg-dl/')) {
                return null;
            }
        }
        if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
        else if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

        const cookieStr = getFreshCookieHeader(buildCookieHeaderFromObject(cookieObj));
        
        // Clean base URL and generate HD variants
        const cleanBaseUrl = targetUrl.replace(/=[swh]\d+.*$/i, '').replace(/=s\d+.*$/i, '');
        const urlVariants: string[] = [targetUrl, cleanBaseUrl];
        if (targetUrl.includes('/rd-gg-dl/')) {
            urlVariants.push(targetUrl.replace('/rd-gg-dl/', '/gg-dl/'));
            urlVariants.push(cleanBaseUrl.replace('/rd-gg-dl/', '/gg-dl/'));
        } else if (targetUrl.includes('/gg-dl/')) {
            urlVariants.push(targetUrl.replace('/gg-dl/', '/rd-gg-dl/'));
            urlVariants.push(cleanBaseUrl.replace('/gg-dl/', '/rd-gg-dl/'));
        }

        const candidateUrls: string[] = [];
        const seenUrls = new Set<string>();
        for (const u of urlVariants) {
            // Add HD scale parameters for high-fidelity images only if no query params exist
            const variants = u.includes('?') ? [u] : [
                `${u}=s2048`,
                `${u}=s1024`,
                `${u}=s0`,
                `${u}=w2048-h2048`,
                u
            ];
            for (const v of variants) {
                if (!seenUrls.has(v) && isAllowedGoogleImageHost(v)) {
                    seenUrls.add(v);
                    candidateUrls.push(v);
                }
            }
        }

        const browserHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Referer': 'https://gemini.google.com/',
            'Origin': 'https://gemini.google.com',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
        };

        const createDownloadTask = async (url: string, useCookies: boolean = false): Promise<{ base64: string; mimeType: string }> => {
            if (!isAllowedGoogleImageHost(url)) throw new Error('Host not permitted');
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: useCookies && cookieStr ? { ...browserHeaders, 'Cookie': cookieStr } : browserHeaders,
                maxRedirects: 0,
                timeout: 5000,
                validateStatus: (status) => status === 200
            });
            if (resp.data) {
                const buffer = Buffer.from(resp.data);
                if (buffer.byteLength > 500) {
                    const rawContentType = resp.headers['content-type'];
                    const contentType = typeof rawContentType === 'string' ? rawContentType : 'image/jpeg';
                    const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
                    log('Gemini Image', `Downloaded image via ${useCookies ? 'cookie auth' : 'public CDN'} (${buffer.byteLength} bytes) from ${url.slice(0, 60)}...`);
                    return { base64: buffer.toString('base64'), mimeType };
                }
            }
            throw new Error('Invalid image buffer');
        };

        const createFetchTask = async (url: string): Promise<{ base64: string; mimeType: string }> => {
            if (!isAllowedGoogleImageHost(url)) throw new Error('Host not permitted');
            const res = await fetch(url, {
                headers: browserHeaders,
                redirect: 'error',
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                const contentType = res.headers.get('content-type') || 'image/jpeg';
                const mimeType = contentType.split(';')[0].trim() || 'image/jpeg';
                const buffer = await res.arrayBuffer();
                if (buffer.byteLength > 500) {
                    return { base64: Buffer.from(buffer).toString('base64'), mimeType };
                }
            }
            throw new Error('Invalid fetch response');
        };

        const attemptDownload = async (attempt: number): Promise<{ base64: string; mimeType: string }> => {
            const tasks: Promise<{ base64: string; mimeType: string }>[] = [];
            
            // Push concurrent tasks for prioritized HD URLs
            for (const url of candidateUrls.slice(0, 6)) {
                tasks.push(createDownloadTask(url, false)); // Strategy A: Public
                if (cookieStr) tasks.push(createDownloadTask(url, true)); // Strategy B: Cookie
                tasks.push(createFetchTask(url)); // Strategy C: Fetch
            }

            try {
                return await Promise.any(tasks);
            } catch (aggError: any) {
                if (attempt < 2) {
                    const waitMs = 1200;
                    log('Gemini Image', `Server download failed (Attempt ${attempt}/2). Retrying in ${waitMs}ms...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    return attemptDownload(attempt + 1);
                }
                log('Gemini Image', `Server CDN download was blocked (403/timeout). Delegating ${candidateUrls[0].slice(0, 60)}... to Client-Side Browser Fetch.`);
                throw new Error('Server download strategies blocked or failed');
            }
        };

        try {
            return await attemptDownload(1);
        } catch (e) {
            return null;
        }
    };

    try {
        let primaryImage: { base64: string; mimeType: string } | null = null;
        const allExtractedImages: { base64: string; mimeType: string }[] = [];
        const rawFoundImageUrls: string[] = [];

        // Method 1: Direct Web StreamGenerate proxy
        try {
            const cookieHeader = buildCookieHeaderFromObject(cookies);
            const result = await callGeminiWeb(effectivePrompt, cookieHeader, model || "gemini-3-flash");
            
            let imageCandidates: any[] = [];
            if (result.images && result.images.length > 0) {
                imageCandidates = result.images;
                log('Gemini Image', `Method 1 found ${result.images.length} direct image candidates from stream`);
            } else if (result.text) {
                log('Gemini Image', `Method 1 returned text (${result.text.length} chars). Inspecting for URLs...`);
                const urlMatches = (result.text.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)/gi) ||
                                   result.text.match(/https?:\/\/lh\d*\.googleusercontent\.com\/[^\s"'<>]+/gi))
                                   ?.filter((u: string) => isAllowedGoogleImageHost(u));
                if (urlMatches && urlMatches.length > 0) {
                    imageCandidates = urlMatches.map((url: string) => ({ url }));
                }
            }

            for (const img of imageCandidates) {
                if (img.base64 || img.data) {
                    const candidate = {
                        base64: img.base64 || img.data,
                        mimeType: img.mimeType || 'image/jpeg'
                    };
                    if (!primaryImage) primaryImage = candidate;
                    allExtractedImages.push(candidate);
                    continue;
                }

                const targetUrl = img.url || img.raw_url || img.direct_url || img.src;
                if (targetUrl) {
                    let cleanTargetUrl = String(targetUrl).trim();
                    if (cleanTargetUrl.startsWith('//')) cleanTargetUrl = 'https:' + cleanTargetUrl;
                    else if (!cleanTargetUrl.startsWith('http')) cleanTargetUrl = 'https://' + cleanTargetUrl;
                    
                    if (!cleanTargetUrl.includes('image_generation_content')) {
                        rawFoundImageUrls.push(cleanTargetUrl);
                    }
                    const downloaded = await downloadGoogleImage(cleanTargetUrl, cookies);
                    if (downloaded) {
                        if (!primaryImage) primaryImage = downloaded;
                        allExtractedImages.push(downloaded);
                    }
                }
            }
        } catch (directErr: any) {
            log('Gemini Image', `Direct web proxy notice: ${directErr.message}. Trying gemini-reverse fallback...`, true);
        }

        // Method 2: gemini-reverse client fallback
        if (!primaryImage) {
            log('Gemini Image', `Attempting gemini-reverse fallback client...`);
            const client = await getGeminiClient(cookies);
            const chat = client.startChat();
            
            const sendPayload: any = { 
                prompt: effectivePrompt,
                temporary: true 
            };
            if (processedAttachments.length > 0) {
                sendPayload.files = processedAttachments.map(a => ({
                    name: a.name,
                    mimeType: a.mimeType,
                    data: a.buffer
                }));
            }

            const response = await chat.sendMessage(sendPayload);

            const candidate = response.candidates?.[0];
            const genImages = candidate?.generated_images || candidate?.images || candidate?.web_images || response.images || response.web_images || [];
            log('Gemini Image', `Method 2 candidate returned text length: ${response.text?.length || 0}, images: ${genImages.length}`);

            for (const gi of genImages) {
                if (gi.base64 || gi.data) {
                    primaryImage = { base64: gi.base64 || gi.data, mimeType: gi.mimeType || 'image/jpeg' };
                    break;
                }

                // Check if gi is an instance of GeneratedImage with save() method
                if (typeof gi.save === 'function') {
                    try {
                        const tempDir = process.env.TEMP_DIR || path.join(os.tmpdir(), 'contentgen-ai-temp');
                        if (!fs.existsSync(tempDir)) {
                            fs.mkdirSync(tempDir, { recursive: true });
                        }
                        const savedPath = await gi.save({ path: tempDir, cookies: client.cookies || cookies, fullSize: false });
                        if (savedPath && fs.existsSync(savedPath)) {
                            const buf = fs.readFileSync(savedPath);
                            if (buf.length > 500) {
                                primaryImage = { base64: buf.toString('base64'), mimeType: 'image/png' };
                                try { fs.unlinkSync(savedPath); } catch {}
                                break;
                            }
                        }
                    } catch (saveErr: any) {
                        log('Gemini Image', `gi.save notice: ${saveErr.message}`, true);
                    }
                }

                const targetUrl = gi.url || gi.raw_url || gi.direct_url || gi.src;
                if (targetUrl) {
                    let cleanTargetUrl = String(targetUrl).trim();
                    if (cleanTargetUrl.startsWith('//')) cleanTargetUrl = 'https:' + cleanTargetUrl;
                    else if (!cleanTargetUrl.startsWith('http')) cleanTargetUrl = 'https://' + cleanTargetUrl;

                    if (!cleanTargetUrl.includes('image_generation_content')) {
                        rawFoundImageUrls.push(cleanTargetUrl);
                    }
                    const downloaded = await downloadGoogleImage(cleanTargetUrl, client.cookies || cookies);
                    if (downloaded) {
                        primaryImage = downloaded;
                        break;
                    }
                }
            }

            // Also check response.text in fallback if images array was empty
            if (!primaryImage && response.text) {
                const urlMatches = response.text.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif)/gi) ||
                                   response.text.match(/https?:\/\/lh\d*\.googleusercontent\.com\/[^\s"'<>]+/gi);
                if (urlMatches) {
                    for (const u of urlMatches) {
                        let cleanU = u.trim();
                        if (cleanU.startsWith('//')) cleanU = 'https:' + cleanU;
                        if (!cleanU.includes('image_generation_content')) {
                            rawFoundImageUrls.push(cleanU);
                        }
                        const downloaded = await downloadGoogleImage(cleanU, client.cookies || cookies);
                        if (downloaded) {
                            primaryImage = downloaded;
                            break;
                        }
                    }
                }
            }
        }

        if (!primaryImage) {
            // Deduplicate and filter found image URLs
            const validCandidateUrls = Array.from(new Set(
                rawFoundImageUrls.filter(u => u && !u.includes('image_generation_content') && u.startsWith('http'))
            ));

            if (validCandidateUrls.length > 0) {
                const primaryUrl = validCandidateUrls[0];
                log('Gemini Image', `Server CDN download was blocked by Google CDN. Returning ${validCandidateUrls.length} candidate URLs to Client-Side Browser Fetch.`);
                const latestCookies = getFreshCookieObject(cookies);
                const options = getSessionCookieOptions(req);
                res.cookie('proxy_auth', JSON.stringify(latestCookies), {
                    ...options,
                    maxAge: 30 * 24 * 60 * 60 * 1000
                });
                return res.json({
                    clientFetchRequired: true,
                    url: primaryUrl,
                    candidateUrls: validCandidateUrls,
                    engine: 'gemini-web',
                    mimeType: 'image/jpeg',
                    images: validCandidateUrls.map(u => ({ url: u })),
                    rcid: null
                });
            }

            throw new Error(`Failed to retrieve generated image data from Gemini.`);
        }

        const latestCookies = getFreshCookieObject(cookies);
        const options = getSessionCookieOptions(req);
        res.cookie('proxy_auth', JSON.stringify(latestCookies), {
            ...options,
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        log('Gemini Image', `Success: retrieved ${allExtractedImages.length || 1} image(s) (primary: ${primaryImage.base64.length} base64 chars)`);

        return res.json({
            base64: primaryImage.base64,
            mimeType: primaryImage.mimeType,
            engine: 'gemini-web',
            images: allExtractedImages.length > 0 ? allExtractedImages : [primaryImage],
            rcid: null
        });

    } catch (err: any) {
        const cookieHeader = buildCookieHeaderFromObject(cookies);
        invalidateGeminiWebCredentialsCache(cookieHeader);
        
        const cacheKey = getCacheKey(cookies);
        if (geminiClientCache.has(cacheKey)) {
            try { await geminiClientCache.get(cacheKey).client.close(); } catch {}
            geminiClientCache.delete(cacheKey);
        }

        const msg = err.message || String(err);
        log('Gemini Image', msg, true);

        if (msg.includes('Cookies invalid') || msg.includes('AuthError') || msg.includes('Failed to initialize') || msg.includes('NOT_LOGGED_IN')) {
            return res.status(401).json({
                error: 'Gemini cookie is invalid or expired. Please refresh your __Secure-1PSID cookie from gemini.google.com and save it again.'
            });
        }
        if (msg.includes('UsageLimitExceeded') || msg.includes('1037')) {
            return res.status(429).json({
                error: 'Gemini usage limit exceeded. Try again later or use a different account.'
            });
        }
        if (msg.includes('500')) {
            return res.status(500).json({
                error: 'Gemini Web returned a 500 error. The prompt might be blocked, or the service is temporarily unavailable.'
            });
        }

        res.status(500).json({ error: msg });
    }
});

// Image pipeline diagnostics — walks each stage without echoing cookie values:
//   curl -X POST http://127.0.0.1:3000/api/llm/gemini/image/debug
router.post('/gemini/image/debug', async (req, res) => {
    const stages: Record<string, any> = {};
    const cookies = getEffectiveCookies(req);
    stages.cookies = {
        hasPsid: !!cookies['__Secure-1PSID'],
        hasPsidts: !!cookies['__Secure-1PSIDTS'],
        keysPresent: Object.keys(cookies || {}).filter(k => (cookies as any)[k]).length
    };
    if (!stages.cookies.hasPsid) {
        return res.status(400).json({ ok: false, stages, error: 'Missing __Secure-1PSID cookie' });
    }

    const cookieHeader = buildCookieHeaderFromObject(cookies);

    try {
        const creds = await fetchGeminiWebCredentials(cookieHeader, true);
        stages.credentials = { ok: true, hasAt: !!creds.atValue, hasBl: !!creds.blValue, hasFSid: !!creds.fSid };
    } catch (e: any) {
        stages.credentials = { ok: false, error: e.message };
        return res.json({ ok: false, stages, hint: 'Credentials stage failed — refresh your Gemini cookies.' });
    }

    try {
        const probe = await callGeminiWeb('Reply with exactly: OK', cookieHeader, 'gemini-3-flash');
        stages.streamGenerate = { ok: true, text: (probe.text || '').slice(0, 40), imagesFound: probe.images?.length || 0 };
    } catch (e: any) {
        stages.streamGenerate = { ok: false, error: e.message };
        return res.json({ ok: false, stages, hint: 'StreamGenerate failed — rate limit, anti-bot, or rotated model id (use the GEMINI_WEB_MODEL_ID_* env override).' });
    }

    try {
        const imgProbe = await callGeminiWeb('Generate a high-resolution image of a single red square on a white background.', cookieHeader, 'gemini-3-flash');
        stages.imageGeneration = {
            ok: (imgProbe.images?.length || 0) > 0,
            imagesFound: imgProbe.images?.length || 0,
            textPreview: (imgProbe.text || '').slice(0, 80)
        };
    } catch (e: any) {
        stages.imageGeneration = { ok: false, error: e.message };
    }

    res.json({ ok: true, stages });
});

// ─── Claude.ai Proxy ──────────────────────────────────────────────────────────
async function getClaudeOrgId(sessionKey: string) {
    const resp = await fetch('https://claude.ai/api/organizations', {
        headers: {
            'Cookie': `sessionKey=${sessionKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Referer': 'https://claude.ai/',
        },
    });

    if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
            throw new Error('Claude sessionKey is expired or invalid. Please refresh your cookie.');
        }
        throw new Error(`Failed to get Claude org: ${resp.status} ${resp.statusText}`);
    }

    const orgs = await resp.json() as any[];
    if (!Array.isArray(orgs) || orgs.length === 0) {
        throw new Error('No Claude organizations found. Cookie may be invalid.');
    }

    return orgs[0].uuid;
}

async function createClaudeConversation(sessionKey: string, orgId: string) {
    const resp = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
        method: 'POST',
        headers: {
            'Cookie': `sessionKey=${sessionKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Origin': 'https://claude.ai',
            'Referer': 'https://claude.ai/',
        },
        body: JSON.stringify({
            uuid: crypto.randomUUID(),
            name: '',
        }),
    });

    if (!resp.ok) {
        throw new Error(`Failed to create Claude conversation: ${resp.status} ${resp.statusText}`);
    }

    const conv = await resp.json() as any;
    return conv.uuid;
}

router.post('/claude', async (req, res) => {
    const { prompt, systemInstruction } = req.body;
    const cookies = getEffectiveCookies(req);
    const sessionKey = cookies?.sessionKey;

    if (!sessionKey) {
        return res.status(400).json({ error: 'Missing sessionKey cookie' });
    }

    log('Claude', `Request: ${String(prompt).slice(0, 80)}...`);

    let convId: string | null = null;
    let orgId: string | null = null;

    try {
        const resolvedOrgId = await getClaudeOrgId(sessionKey);
        orgId = resolvedOrgId;
        convId = await createClaudeConversation(sessionKey, resolvedOrgId);

        const completionResp = await fetch(
            `https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
            {
                method: 'POST',
                headers: {
                    'Cookie': `sessionKey=${sessionKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept': 'text/event-stream',
                    'Origin': 'https://claude.ai',
                    'Referer': `https://claude.ai/chat/${convId}`,
                },
                body: JSON.stringify({
                    prompt: systemInstruction ? `${systemInstruction}\n\n${prompt}` : prompt,
                    timezone: 'UTC',
                    model: 'claude-3-5-sonnet-20241022',
                    attachments: [],
                    files: [],
                }),
            }
        );

        if (!completionResp.ok) {
            throw new Error(`Claude completion failed: ${completionResp.status} ${completionResp.statusText}`);
        }

        const rawText = await completionResp.text();
        let extractedText = '';

        const lines = rawText.split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                    extractedText += parsed.delta.text;
                } else if (parsed.completion) {
                    extractedText += parsed.completion;
                }
            } catch { /* skip */ }
        }

        if (!extractedText) {
            throw new Error('Could not extract text from Claude response. Cookie may be expired.');
        }

        log('Claude', `Success, ${extractedText.length} chars`);
        res.json({ text: extractedText, provider: 'claude-web' });

    } catch (err: any) {
        log('Claude', err.message, true);
        res.status(500).json({ error: err.message });
    } finally {
        // Temporary chat: delete conversation so it does not clutter user's Claude sidebar
        if (orgId && convId) {
            try {
                await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convId}`, {
                    method: 'DELETE',
                    headers: {
                        'Cookie': `sessionKey=${sessionKey}`,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    }
                });
                log('Claude', `Cleaned up temporary conversation ${convId}`);
            } catch (delErr) {
                // Non-blocking cleanup failure
            }
        }
    }
});

// ─── Meta AI Proxy ────────────────────────────────────────────────────────────
async function getMetaAIToken(cookies: any) {
    const cookieStr = Object.entries(cookies)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    const resp = await fetch('https://www.meta.ai/', {
        headers: {
            'Cookie': cookieStr,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!resp.ok) {
        throw new Error(`Failed to load Meta AI page: ${resp.status}`);
    }

    const html = await resp.text();

    const lsdMatch = html.match(/"LSD",\[\],\{"token":"([^"]+)"/);
    if (!lsdMatch) {
        if (html.includes('login') || html.includes('Log in')) {
            throw new Error('Meta AI cookies are expired or invalid. Please refresh your cookies.');
        }
        throw new Error('Could not extract Meta AI session token. Cookies may be invalid.');
    }

    const dtsgMatch = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/);
    const dtsg = dtsgMatch ? dtsgMatch[1] : '';

    return { lsd: lsdMatch[1], dtsg, cookieStr };
}

router.post('/metaai', async (req, res) => {
    const { prompt } = req.body;
    const cookies = getEffectiveCookies(req);

    if (!cookies?.datr || !cookies?.abra_sess) {
        return res.status(400).json({ error: 'Missing required Meta AI cookies (datr, abra_sess)' });
    }

    log('MetaAI', `Request: ${String(prompt).slice(0, 80)}...`);

    try {
        const { lsd, dtsg, cookieStr } = await getMetaAIToken(cookies);

        const payload = {
            lsd,
            fb_dtsg: dtsg,
            variables: JSON.stringify({
                message: { sensitive_string_value: prompt },
                externalConversationId: crypto.randomUUID(),
                offlineThreadingId: String(Math.floor(Math.random() * 1e16)),
                suggestedPromptIndex: null,
                flashVideoRecapInput: { images: [] },
                flashPreviewInput: null,
                promptPrefix: null,
                entrypoint: 'ABRA__CHAT__TEXT',
                icebreaker_type: 'TEXT',
                __relay_internal__pv__WebPixelRatiorelayprovider: 1,
            }),
            doc_id: '7783822248314888',
        };

        const formBody = Object.entries(payload)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');

        const apiResp = await fetch('https://www.meta.ai/api/graphql/', {
            method: 'POST',
            headers: {
                'Cookie': cookieStr,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Origin': 'https://www.meta.ai',
                'Referer': 'https://www.meta.ai/',
                'X-FB-LSD': lsd,
            },
            body: formBody,
        });

        if (!apiResp.ok) {
            throw new Error(`Meta AI API failed: ${apiResp.status} ${apiResp.statusText}`);
        }

        const rawText = await apiResp.text();
        let extractedText = '';

        const lines = rawText.trim().split('\n');
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                const chunk = parsed?.data?.node?.streaming_text_chunk;
                if (chunk) extractedText += chunk;
                const finalText = parsed?.data?.node?.bot_response_message?.composed_text?.content?.[0]?.text;
                if (finalText && finalText.length > extractedText.length) extractedText = finalText;
            } catch { /* skip */ }
        }

        if (!extractedText) {
            throw new Error('Could not extract text from Meta AI response. Cookies may be expired.');
        }

        log('MetaAI', `Success, ${extractedText.length} chars`);
        res.json({ text: extractedText, provider: 'meta-ai' });

    } catch (err: any) {
        log('MetaAI', err.message, true);
        res.status(500).json({ error: err.message });
    }
});

// ─── Cookie Management ────────────────────────────────────────────────────────
const ALLOWED_COOKIE_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

router.post('/save-cookies', (req, res) => {
    const { cookies } = req.body;
    if (!cookies || typeof cookies !== 'object' || Array.isArray(cookies)) {
        return res.status(400).json({ error: 'Valid cookies object required' });
    }

    const sanitizedCookies: Record<string, string> = {};
    for (const [key, val] of Object.entries(cookies)) {
        if (typeof key === 'string' && ALLOWED_COOKIE_KEY_PATTERN.test(key) && typeof val === 'string' && val.length < 4096) {
            sanitizedCookies[key] = val;
        }
    }

    const fresh = getFreshCookieObject(sanitizedCookies);
    const finalCookies = { ...sanitizedCookies, ...fresh };
    const options = getSessionCookieOptions(req);
    res.cookie('proxy_auth', JSON.stringify(finalCookies), {
        ...options,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ success: true });
});

router.post('/clear-cookies', (req, res) => {
    const cookies = getEffectiveCookies(req);
    if (cookies && Object.keys(cookies).length > 0) {
        clearCookieJar(buildCookieHeaderFromObject(cookies));
    }
    const options = getSessionCookieOptions(req);
    res.clearCookie('proxy_auth', options);
    res.json({ success: true });
});

// ─── Test Endpoints ───────────────────────────────────────────────────────────
router.post('/test/gemini', async (req, res) => {
    const startTime = Date.now();
    const cookies = getEffectiveCookies(req);
    const psid = cookies?.['__Secure-1PSID'];
    const psidts = cookies?.['__Secure-1PSIDTS'];
    const psidcc = cookies?.['__Secure-1PSIDCC'];
    const compass = cookies?.['COMPASS'];
    const sid = cookies?.['SID'];

    const tokenPresence = {
        hasPsid: !!psid,
        hasPsidts: !!psidts,
        hasPsidcc: !!psidcc,
        hasCompass: !!compass,
        hasSid: !!sid,
        tokenCount: Object.values(cookies || {}).filter(Boolean).length
    };

    if (!psid) {
        return res.json({
            valid: false,
            code: 'MISSING_PSID',
            error: 'Missing __Secure-1PSID cookie. Please copy and provide your __Secure-1PSID from gemini.google.com.',
            tokenPresence,
            latencyMs: Date.now() - startTime
        });
    }

    const cookieHeader = getFreshCookieHeader(buildCookieHeaderFromObject(cookies));
    invalidateGeminiWebCredentialsCache(cookieHeader);

    try {
        // Direct lightweight test via fetchGeminiWebCredentials with live bypass
        const creds = await fetchGeminiWebCredentials(cookieHeader, true);
        const freshCookies = getFreshCookieObject(cookieHeader);
        const options = getSessionCookieOptions(req);
        res.cookie('proxy_auth', JSON.stringify(freshCookies), {
            ...options,
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        const latencyMs = Date.now() - startTime;
        return res.json({ 
            valid: true,
            code: 'SESSION_ACTIVE',
            message: 'Session valid and connected to Gemini Web.', 
            timestamp: Date.now(),
            latencyMs,
            tokenPresence: {
                ...tokenPresence,
                hasPsidts: !!(freshCookies['__Secure-1PSIDTS'] || psidts)
            },
            updatedCookies: freshCookies,
            credsExtracted: {
                hasAt: !!creds.atValue,
                hasBl: !!creds.blValue,
                hasFSid: !!creds.fSid
            }
        });
    } catch (e: any) {
        const latencyMs = Date.now() - startTime;
        const isNotLoggedIn = e.message === 'NOT_LOGGED_IN';
        log('Gemini', `Test fetchGeminiWebCredentials ${isNotLoggedIn ? 'notice' : 'failed'}: ${e.message}`, !isNotLoggedIn);
        
        if (isNotLoggedIn) {
            const hint = !psidts ? ' Notice: __Secure-1PSIDTS is missing. Google usually requires both __Secure-1PSID and __Secure-1PSIDTS.' : '';
            return res.json({ 
                valid: false,
                code: 'NOT_LOGGED_IN',
                error: `Session expired or invalid. Please re-copy fresh __Secure-1PSID and __Secure-1PSIDTS from gemini.google.com.${hint}`,
                tokenPresence,
                latencyMs
            });
        }
        if (e.cause?.code === 'UND_ERR_HEADERS_OVERFLOW' || e.message.includes('Overflow')) {
             return res.json({
                 valid: false,
                 code: 'HEADERS_OVERFLOW',
                 error: 'Headers overflow error. Please ensure no malformed cookie characters or extraneous whitespace.',
                 tokenPresence,
                 latencyMs
             });
        }
        
        // Fallback test via GeminiClient
        try {
            const cacheKey = getCacheKey(cookies);
            if (geminiClientCache.has(cacheKey)) {
                try { await geminiClientCache.get(cacheKey).client.close(); } catch {}
                geminiClientCache.delete(cacheKey);
            }
            await getGeminiClient(cookies);
            const freshCookies = getFreshCookieObject(cookies);
            return res.json({ 
                valid: true,
                code: 'CLIENT_BRIDGE_ACTIVE',
                message: 'Session valid via client bridge.', 
                timestamp: Date.now(),
                latencyMs: Date.now() - startTime,
                tokenPresence: {
                    ...tokenPresence,
                    hasPsidts: !!(freshCookies['__Secure-1PSIDTS'] || psidts)
                },
                updatedCookies: freshCookies
            });
        } catch (err: any) {
            return res.json({ 
                valid: false,
                code: 'AUTH_FAILED',
                error: `Session check failed: ${e.message || err.message}. Please refresh cookies from gemini.google.com.`,
                tokenPresence,
                latencyMs: Date.now() - startTime
            });
        }
    }
});

router.post('/test/claude', async (req, res) => {
    const startTime = Date.now();
    const cookies = getEffectiveCookies(req);
    const sessionKey = cookies?.sessionKey;
    if (!sessionKey) {
        return res.json({ valid: false, error: 'Missing sessionKey cookie', latencyMs: Date.now() - startTime });
    }
    try {
        const orgId = await getClaudeOrgId(sessionKey);
        res.json({
            valid: true,
            orgId: orgId ? orgId.slice(0, 8) + '...' : undefined,
            message: 'Connected to Claude.ai session!',
            latencyMs: Date.now() - startTime
        });
    } catch (err: any) {
        res.json({ valid: false, error: err.message, latencyMs: Date.now() - startTime });
    }
});

router.post('/test/metaai', async (req, res) => {
    const startTime = Date.now();
    const cookies = getEffectiveCookies(req);
    if (!cookies?.datr) {
        return res.json({ valid: false, error: 'Missing datr cookie', latencyMs: Date.now() - startTime });
    }
    try {
        const tokens = await getMetaAIToken(cookies);
        res.json({
            valid: true,
            hasLsd: !!tokens.lsd,
            hasDtsg: !!tokens.dtsg,
            message: 'Connected to Meta AI session!',
            latencyMs: Date.now() - startTime
        });
    } catch (err: any) {
        res.json({ valid: false, error: err.message, latencyMs: Date.now() - startTime });
    }
});

router.post('/test/grok', async (req, res) => {
    const startTime = Date.now();
    const cookies = getEffectiveCookies(req);
    if (!cookies?.sso || !cookies?.['sso-rw']) {
        return res.json({ valid: false, error: 'Missing sso or sso-rw cookies', latencyMs: Date.now() - startTime });
    }
    res.json({
        valid: true,
        message: 'Grok cookies configured (sso & sso-rw present)!',
        latencyMs: Date.now() - startTime
    });
});

router.get('/pollinations', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
    }

    const host = parsed.hostname.toLowerCase();
    const isAllowedHost = host === 'image.pollinations.ai' || host === 'pollinations.ai' || host.endsWith('.pollinations.ai');
    if (!isAllowedHost) {
        return res.status(403).json({ error: 'Access to the specified host is forbidden' });
    }
    
    log('Pollinations', `Proxying: ${url}`);
    try {
        const resp = await fetch(url, {
            redirect: 'error',
            signal: AbortSignal.timeout(15000)
        });
        if (!resp.ok) throw new Error(`Pollinations failed: ${resp.status} ${resp.statusText}`);
        
        const buffer = await resp.arrayBuffer();
        if (buffer.byteLength > 25 * 1024 * 1024) {
            throw new Error('Image response exceeded maximum allowable size');
        }
        const base64 = Buffer.from(buffer).toString('base64');
        res.json({ base64 });
    } catch (err: any) {
        log('Pollinations', err.message, true);
        res.status(500).json({ error: 'Failed to fetch image from Pollinations' });
    }
});

router.post('/imagen/predict', async (req, res) => {
    const { prompt, apiKey, model = 'gemini-3.1-flash-image', aspectRatio = '16:9' } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    if (!apiKey)  return res.status(400).json({ error: 'API key is required' });

    log('Imagen Predict', `Request: ${String(prompt).slice(0, 80)}...`);

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio,
                    outputMimeType: 'image/jpeg',
                }
            })
        });

        const data = await response.json() as any;

        if (!response.ok) {
            const errMsg = data?.error?.message || `Imagen predict failed: ${response.status}`;
            log('Imagen Predict', errMsg, true);
            return res.status(response.status).json({ error: errMsg });
        }

        const base64 = data?.predictions?.[0]?.bytesBase64Encoded;
        if (!base64) {
            log('Imagen Predict', `No image in response: ${JSON.stringify(data).slice(0, 200)}`, true);
            throw new Error('Imagen returned no image data');
        }

        log('Imagen Predict', `Success, ${base64.length} chars`);
        res.json({ base64, mimeType: 'image/jpeg', engine: 'imagen-predict' });

    } catch (err: any) {
        log('Imagen Predict', err.message, true);
        res.status(500).json({ error: err.message });
    }
});

router.post('/metaai/image', async (req, res) => {
    const { prompt } = req.body;
    const cookies = getEffectiveCookies(req);

    if (!cookies?.datr || !cookies?.abra_sess) {
        return res.status(400).json({ error: 'Missing required Meta AI cookies (datr, abra_sess)' });
    }

    log('MetaAI Image', `Request: ${String(prompt).slice(0, 80)}...`);

    try {
        const { lsd, dtsg, cookieStr } = await getMetaAIToken(cookies);

        const payload = {
            lsd,
            fb_dtsg: dtsg,
            variables: JSON.stringify({
                prompt,
                num_images: 1,
                width: 1024,
                height: 1024,
                cfg_scale: 7.5,
                seed: Math.floor(Math.random() * 2147483647),
                model_id: 'emu3',
            }),
            doc_id: '9956416514431020',
        };

        const formBody = Object.entries(payload)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');

        const apiResp = await fetch('https://www.meta.ai/api/graphql/', {
            method: 'POST',
            headers: {
                'Cookie': cookieStr,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Origin': 'https://www.meta.ai',
                'Referer': 'https://imagine.meta.ai/',
                'X-FB-LSD': lsd,
            },
            body: formBody,
        });

        if (!apiResp.ok) throw new Error(`Meta AI API failed: ${apiResp.status}`);

        const rawText = await apiResp.text();

        let imageUrl: string | null = null;
        for (const line of rawText.trim().split('\n')) {
            try {
                const parsed = JSON.parse(line);
                const url =
                    parsed?.data?.imagine_response?.images?.[0]?.url ||
                    parsed?.data?.imagine_response?.images?.[0]?.uri ||
                    parsed?.data?.node?.imagine_response?.images?.[0]?.url ||
                    parsed?.data?.node?.imagine_response?.media_url ||
                    parsed?.data?.node?.bot_response_message?.imagine_response?.imagine_images?.[0]?.uri ||
                    parsed?.data?.node?.media_url;
                if (url) { imageUrl = url; break; }
            } catch { /* skip */ }
        }

        if (!imageUrl) {
            log('MetaAI Image', `Raw response (first 500 chars): ${rawText.slice(0, 500)}`, true);
            throw new Error('Meta AI did not return an image. Note: Imagine is only available in the US. Cookies may also be expired.');
        }

        const imgResp = await fetch(imageUrl, {
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://imagine.meta.ai/',
            }
        });
        if (!imgResp.ok) throw new Error(`Failed to download Meta AI image: ${imgResp.status}`);

        const buffer = await imgResp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        log('MetaAI Image', `Success, ${base64.length} chars`);
        res.json({ base64, mimeType: 'image/jpeg', engine: 'meta-ai' });

    } catch (err: any) {
        log('MetaAI Image', err.message, true);
        res.status(500).json({ error: err.message });
    }
});

router.post('/metaai/video', async (req, res) => {
    res.status(501).json({ error: 'Meta AI Video generation is not yet implemented in the proxy.' });
});

router.post('/grok/image', async (req, res) => {
    const { prompt } = req.body;
    const cookies = getEffectiveCookies(req);

    if (!cookies?.sso || !cookies?.['sso-rw']) {
        return res.status(400).json({ error: 'Missing required Grok cookies (sso, sso-rw)' });
    }

    log('Grok Image', `Request: ${String(prompt).slice(0, 80)}...`);

    let conversationId: string | null = null;
    let cookieStr = '';

    try {
        cookieStr = `sso=${cookies.sso}; sso-rw=${cookies['sso-rw']}`;

        const convResp = await fetch('https://grok.com/api/conversations', {
            method: 'POST',
            headers: {
                'Cookie': cookieStr,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Origin': 'https://grok.com',
                'Referer': 'https://grok.com/',
            },
            body: JSON.stringify({ temporary: true }),
        });

        if (!convResp.ok) throw new Error(`Grok conversation create failed: ${convResp.status}`);
        const convData = await convResp.json() as { conversationId?: string };
        conversationId = convData.conversationId || null;
        if (!conversationId) throw new Error('Grok did not return a conversationId');

        const msgResp = await fetch(`https://grok.com/api/conversations/${conversationId}/responses`, {
            method: 'POST',
            headers: {
                'Cookie': cookieStr,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Origin': 'https://grok.com',
                'Referer': 'https://grok.com/',
            },
            body: JSON.stringify({
                message: prompt,
                modelName: 'grok-2-aurora',
                returnImageBytes: false,
                returnRawGrokInXaiRequest: false,
                fileAttachments: [],
                imageGenerationCount: 1,
                forceConcise: false,
                toolOverrides: {},
                enableImageGeneration: true,
                enableImageStreaming: false,
            }),
        });

        if (!msgResp.ok) throw new Error(`Grok image request failed: ${msgResp.status}`);

        const rawText = await msgResp.text();
        let imageUrl: string | null = null;
        let imageBase64: string | null = null;

        for (const line of rawText.trim().split('\n')) {
            try {
                const parsed = JSON.parse(line);
                const url =
                    parsed?.result?.response?.generatedImageUrls?.[0] ||
                    parsed?.result?.response?.imageUrls?.[0] ||
                    parsed?.imagedMediaUrl ||
                    parsed?.result?.response?.attachments?.[0]?.url ||
                    parsed?.result?.response?.mediaAttachments?.[0]?.url;
                if (url) { imageUrl = url; break; }

                const b64 =
                    parsed?.result?.response?.generatedImages?.[0]?.imageBytes ||
                    parsed?.result?.response?.images?.[0]?.data;
                if (b64) { imageBase64 = b64; break; }
            } catch { /* skip */ }
        }

        if (imageBase64) {
            log('Grok Image', `Success (inline base64)`);
            return res.json({ base64: imageBase64, mimeType: 'image/jpeg', engine: 'grok' });
        }

        if (!imageUrl) {
            log('Grok Image', `Raw response (first 500 chars): ${rawText.slice(0, 500)}`, true);
            throw new Error('Grok did not return an image URL. Note: Aurora image generation requires X Premium. Cookies may also be expired.');
        }

        const imgResp = await fetch(imageUrl, { headers: { 'Cookie': cookieStr } });
        if (!imgResp.ok) throw new Error(`Failed to download Grok image: ${imgResp.status}`);

        const buffer = await imgResp.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        log('Grok Image', `Success, ${base64.length} chars`);
        res.json({ base64, mimeType: 'image/jpeg', engine: 'grok' });

    } catch (err: any) {
        log('Grok Image', err.message, true);
        res.status(500).json({ error: err.message });
    } finally {
        // Temporary chat: delete conversation from Grok
        if (conversationId && cookieStr) {
            try {
                await fetch(`https://grok.com/api/conversations/${conversationId}`, {
                    method: 'DELETE',
                    headers: {
                        'Cookie': cookieStr,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    }
                });
                log('Grok Image', `Cleaned up temporary conversation ${conversationId}`);
            } catch (delErr) {
                // Non-blocking cleanup failure
            }
        }
    }
});

router.post('/grok/video', async (req, res) => {
    res.status(501).json({ error: 'Grok Video generation is not yet implemented in the proxy.' });
});

export default router;
