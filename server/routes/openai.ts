/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import express from 'express';
import { isAllowedExternalUrl } from './gradio';

const router = express.Router();

async function assertPublicUrl(res: express.Response, url: string): Promise<boolean> {
    if (!(await isAllowedExternalUrl(url))) {
        res.status(400).json({ error: 'Refusing to contact a private, internal, or otherwise disallowed URL.' });
        return false;
    }
    return true;
}

export function normalizeOpenAiBaseUrl(url: string): string {
    let clean = (url || '').trim().replace(/\/+$/, '');
    if (!clean) return 'https://api.openai.com/v1';

    // Normalize Experiential Labs URLs:
    if (/platform\.experientiallabs\.ai/i.test(clean)) {
        clean = 'https://api.experientiallabs.ai/v1';
    } else if (/^https?:\/\/api\.experientiallabs\.ai(\/?)$/i.test(clean)) {
        clean = 'https://api.experientiallabs.ai/v1';
    }

    if (clean.endsWith('/chat/completions')) {
        clean = clean.replace(/\/chat\/completions$/, '');
    }
    return clean;
}

export function normalizeModelForGateway(model: string, baseUrl: string): string {
    let m = (model || 'gpt-4o').trim();
    if (/experientiallabs\.ai/i.test(baseUrl)) {
        const lower = m.toLowerCase().trim();
        if (lower === 'gemini-3.7' || lower === 'gemini 3.7' || lower === 'google/gemini-3.7-flash' || lower === 'gemini-3.7-flash' || lower === 'gemini 3.7 flash' ||
            lower === 'gemini-3.5' || lower === 'gemini 3.5' || lower === 'google/gemini-3.5-flash' || lower === 'gemini-3.5-flash' || lower === 'gemini 3.5 flash') {
            return 'gemini-3.8-flash';
        }
        if (lower === 'gemini-3.6' || lower === 'gemini 3.6' || lower === 'google/gemini-3.6-flash' || lower === 'gemini-3.6-flash' || lower === 'gemini 3.6 flash') {
            return 'gemini-3.6-flash';
        }
        if (lower === 'gemini-3.8' || lower === 'gemini 3.8' || lower === 'google/gemini-3.8-flash' || lower === 'gemini-3.8-flash' || lower === 'gemini 3.8 flash' ||
            lower === 'gemini-2.5-flash' || lower === 'google/gemini-2.5-flash' || lower === 'gemini 2.5 flash' ||
            lower === 'gemini-3.1-flash' || lower === 'google/gemini-3.1-flash' || lower === 'gemini 3.1 flash') {
            return 'gemini-3.8-flash';
        }
        if (lower === 'gemini-2.5-pro' || lower === 'google/gemini-2.5-pro' || lower === 'gemini 2.5 pro' ||
            lower === 'gemini-3.1-pro' || lower === 'gemini-3.1-pro-preview' || lower === 'google/gemini-3.1-pro-preview') {
            return 'gemini-3.1-pro-preview';
        }
        if (lower === 'gemini-3.1-flash-lite' || lower === 'google/gemini-3.1-flash-lite' ||
            lower === 'gemini-2.5-flash-lite' || lower === 'google/gemini-2.5-flash-lite' ||
            lower === 'gemini-3.5-flash-lite' || lower === 'google/gemini-3.5-flash-lite') {
            return 'gemini-3.1-flash-lite';
        }
        if (lower.startsWith('google/')) {
            return m.slice(7);
        }
    }
    return m;
}

router.post('/test', async (req, res) => {
    const startTime = Date.now();
    try {
        const { baseUrl, apiKey, model } = req.body || {};
        const base = normalizeOpenAiBaseUrl(baseUrl);
        if (!(await assertPublicUrl(res, base))) return;
        const targetModel = normalizeModelForGateway(model, base);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://contentgen.studio',
            'X-Title': 'ContentGen AI Studio'
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }

        const testPayload: any = {
            model: targetModel,
            messages: [{ role: 'user', content: 'Respond with OK.' }]
        };
        if (!base.includes('experientiallabs.ai')) {
            testPayload.max_tokens = 5;
        }

        let probeRes = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(testPayload)
        });

        // Retry with pure minimal payload if gateway rejected sampling parameters
        if (!probeRes.ok && (testPayload.max_tokens || testPayload.temperature)) {
            const errClone = probeRes.clone();
            const errText = await errClone.text().catch(() => '');
            if (/temperature|top_p|sampling|invalid_parameter|all_routes_failed|max_tokens/i.test(errText)) {
                delete testPayload.max_tokens;
                delete testPayload.temperature;
                probeRes = await fetch(`${base}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(testPayload)
                });
            }
        }

        const latencyMs = Date.now() - startTime;

        if (probeRes.ok) {
            const data: any = await probeRes.json().catch(() => ({}));
            const reply = data?.choices?.[0]?.message?.content?.trim() || 'OK';
            return res.json({
                valid: true,
                message: `Gateway verified! Response from "${targetModel}": "${reply.slice(0, 30)}"`,
                latencyMs,
                baseUrl: base,
                model: targetModel
            });
        }

        const errData: any = await probeRes.json().catch(() => ({}));
        const rawMessage = errData?.error?.message || errData?.message || probeRes.statusText || 'Gateway request failed';
        const statusCode = probeRes.status;

        let diagnostic = rawMessage;
        let code = errData?.error?.code || `HTTP_${statusCode}`;

        if (statusCode === 401) {
            diagnostic = 'Authentication failed. Please verify your Gateway API Key or Bearer Token.';
            code = 'UNAUTHORIZED';
        } else if (statusCode === 404) {
            diagnostic = `Model "${targetModel}" or endpoint not found on ${base}. Check model spelling or click "Fetch Models from Gateway".`;
            code = 'MODEL_NOT_FOUND';
        } else if (statusCode === 429) {
            diagnostic = `Rate limit or quota exceeded on gateway: ${rawMessage}`;
            code = 'RATE_LIMITED';
        }

        return res.json({
            valid: false,
            error: diagnostic,
            rawError: rawMessage,
            code,
            statusCode,
            latencyMs,
            baseUrl: base,
            model: targetModel
        });
    } catch (error: any) {
        const latencyMs = Date.now() - startTime;
        return res.json({
            valid: false,
            error: `Failed to reach gateway at base URL: ${error?.message || error}`,
            code: 'NETWORK_ERROR',
            latencyMs
        });
    }
});

router.post('/models', async (req, res) => {
    try {
        const { baseUrl, apiKey } = req.body || {};
        const base = normalizeOpenAiBaseUrl(baseUrl);
        if (!(await assertPublicUrl(res, base))) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://contentgen.studio',
            'X-Title': 'ContentGen AI Studio'
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }

        let probeRes = await fetch(`${base}/models`, {
            method: 'GET',
            headers
        });

        // Experiential Labs fallback:
        if (!probeRes.ok && base.includes('experientiallabs.ai')) {
            try {
                const altRes = await fetch('https://api.experientiallabs.ai/api/models', {
                    method: 'GET',
                    headers
                });
                if (altRes.ok) {
                    probeRes = altRes;
                }
            } catch {}
        }

        if (!probeRes.ok) {
            const errData: any = await probeRes.json().catch(() => ({}));
            const msg = errData?.error?.message || errData?.message || probeRes.statusText;
            return res.status(probeRes.status).json({ error: `Failed to list models: ${msg}` });
        }

        const data: any = await probeRes.json();
        const rawList = data?.data || data?.models || (Array.isArray(data) ? data : []);
        const models: string[] = rawList
            .map((item: any) => {
                if (typeof item === 'string') return item;
                if (item?.model?.slug) return item.model.slug;
                if (item?.slug) return item.slug;
                if (item?.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) return item.id;
                if (item?.name) return item.name;
                if (item?.id) return item.id;
                return '';
            })
            .filter(Boolean);

        return res.json({ valid: true, models: Array.from(new Set(models)).sort() });
    } catch (error: any) {
        return res.status(500).json({ error: `Error fetching models from gateway: ${error?.message || error}` });
    }
});

router.post('/generate', async (req, res) => {
    try {
        const { baseUrl, apiKey, model, messages, temperature, max_tokens, response_format } = req.body || {};
        const base = normalizeOpenAiBaseUrl(baseUrl);
        if (!(await assertPublicUrl(res, base))) return;
        const targetModel = normalizeModelForGateway(model, base);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://contentgen.studio',
            'X-Title': 'ContentGen AI Studio'
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }

        // Sanitize messages to guarantee strictly compliant content blocks
        const sanitizedMessages = (messages || []).map((msg: any) => {
            if (!msg) return msg;
            if (typeof msg.content === 'string') return msg;
            if (Array.isArray(msg.content)) {
                const cleanContent = msg.content.map((part: any) => {
                    if (typeof part === 'string') {
                        return { type: 'text', text: part };
                    }
                    if (part?.type === 'text') {
                        return { type: 'text', text: String(part.text || '') };
                    }
                    if (part?.type === 'image_url') {
                        let url = part.image_url?.url || (typeof part.image_url === 'string' ? part.image_url : '');
                        if (url) {
                            if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:') && !url.startsWith('s3://') && !url.startsWith('gs://')) {
                                url = `data:image/jpeg;base64,${url}`;
                            }
                            return {
                                type: 'image_url',
                                image_url: { url }
                            };
                        }
                    }
                    return part;
                }).filter(Boolean);
                return { ...msg, content: cleanContent };
            }
            return msg;
        });

        const payload: any = {
            model: targetModel,
            messages: sanitizedMessages
        };
        if (temperature !== undefined) payload.temperature = temperature;
        if (max_tokens !== undefined) payload.max_tokens = max_tokens;
        if (response_format) payload.response_format = response_format;

        let response = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        // Graceful retry without response_format or pinned sampling params if rejected by gateway
        if (!response.ok) {
            const errClone = response.clone();
            const errText = await errClone.text().catch(() => '');
            let shouldRetry = false;

            if (payload.response_format && /response_format|json_object|not supported|unsupported parameter|schema/i.test(errText)) {
                console.warn('[OpenAI Gateway] Gateway rejected response_format, retrying with prompt instructions only.');
                delete payload.response_format;
                shouldRetry = true;
            }

            if ((payload.temperature !== undefined || payload.top_p !== undefined) && /temperature|top_p|sampling|invalid_parameter|all_routes_failed/i.test(errText)) {
                console.warn('[OpenAI Gateway] Gateway rejected sampling parameters, retrying with model-default sampling.');
                delete payload.temperature;
                delete payload.top_p;
                shouldRetry = true;
            }

            if (shouldRetry) {
                response = await fetch(`${base}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
            }
        }

        if (!response.ok) {
            const errData: any = await response.json().catch(() => ({}));
            const msg = errData?.error?.message || errData?.message || response.statusText;
            return res.status(response.status).json({ error: msg || 'OpenAI Gateway request failed' });
        }

        const data: any = await response.json();
        return res.json(data);
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'OpenAI Gateway request failed' });
    }
});

router.post('/generate-image', async (req, res) => {
    try {
        const { baseUrl, apiKey, model, prompt, size, n } = req.body || {};
        const base = normalizeOpenAiBaseUrl(baseUrl);
        if (!(await assertPublicUrl(res, base))) return;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://contentgen.studio',
            'X-Title': 'ContentGen AI Studio'
        };
        if (apiKey && apiKey.trim()) {
            headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }

        const payload: any = {
            model: model || 'dall-e-3',
            prompt,
            size: size || '1024x1024',
            n: n || 1,
            response_format: 'b64_json'
        };

        let response = await fetch(`${base}/images/generations`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        // 1. Retry without response_format if rejected (some providers only return image URLs)
        if (!response.ok && payload.response_format) {
            const errClone = response.clone();
            const errText = await errClone.text().catch(() => '');
            if (/response_format|b64_json|invalid_parameter|unsupported/i.test(errText)) {
                delete payload.response_format;
                response = await fetch(`${base}/images/generations`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
            }
        }

        // 2. Retry with square 1024x1024 if custom rectangular dimensions are rejected
        if (!response.ok && payload.size && payload.size !== '1024x1024') {
            const errClone = response.clone();
            const errText = await errClone.text().catch(() => '');
            if (/size|dimension|resolution|aspect/i.test(errText)) {
                payload.size = '1024x1024';
                response = await fetch(`${base}/images/generations`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload)
                });
            }
        }

        if (!response.ok) {
            const errData: any = await response.json().catch(() => ({}));
            const msg = errData?.error?.message || errData?.message || response.statusText;
            return res.status(response.status).json({ error: msg || 'Image generation failed on gateway' });
        }

        const data: any = await response.json();

        // Standardize output: extract base64 or download from URL
        let base64 = data?.data?.[0]?.b64_json || data?.base64;
        let mimeType = 'image/png';

        if (!base64 && data?.data?.[0]?.url && (await isAllowedExternalUrl(data.data[0].url))) {
            try {
                const imgRes = await fetch(data.data[0].url);
                if (imgRes.ok) {
                    const arrayBuf = await imgRes.arrayBuffer();
                    base64 = Buffer.from(arrayBuf).toString('base64');
                    mimeType = imgRes.headers.get('content-type') || 'image/png';
                }
            } catch (fetchErr: any) {
                console.warn('[OpenAI Gateway] Failed to download image from URL:', fetchErr.message);
            }
        }

        if (!base64) {
            return res.status(500).json({ error: 'Gateway responded successfully but contained no valid image data or URL.' });
        }

        return res.json({
            base64,
            mimeType,
            engine: 'openai-gateway',
            model: payload.model
        });
    } catch (error: any) {
        return res.status(500).json({ error: error?.message || 'Gateway image generation failed' });
    }
});

export default router;
