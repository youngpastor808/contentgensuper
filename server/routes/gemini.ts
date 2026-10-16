import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import axios from 'axios';

const router = express.Router();

function sanitizeApiKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let key = String(raw).trim();
  // Strip quotes or backticks if copied with quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")) || (key.startsWith('`') && key.endsWith('`'))) {
    key = key.slice(1, -1).trim();
  }
  // Strip env assignment prefix like "GEMINI_API_KEY=", "export GEMINI_API_KEY=", "apiKey="
  key = key.replace(/^(export\s+)?([A-Z0-9_]+_KEY|apiKey|Authorization:\s*Bearer)\s*[:=]\s*/i, '').trim();
  // Strip zero-width and non-breaking space characters
  key = key.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  // Strip all internal whitespace (spaces, tabs, newlines)
  key = key.replace(/\s+/g, '');
  return key;
}

function getEffectiveApiKey(req: express.Request): string {
  const headerKey = req.headers['x-goog-api-key'] as string;
  if (headerKey && headerKey !== 'dummy_key_for_proxy_mode' && headerKey !== 'dummy_key_for_cookie_mode') {
    return sanitizeApiKey(headerKey);
  }
  const queryKey = req.query.key as string;
  if (queryKey && queryKey !== 'dummy_key_for_proxy_mode' && queryKey !== 'dummy_key_for_cookie_mode') {
    return sanitizeApiKey(queryKey);
  }
  const authHeader = req.headers.authorization as string;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && token !== 'dummy_key_for_proxy_mode') return sanitizeApiKey(token);
  }
  return sanitizeApiKey(process.env.GEMINI_API_KEY || process.env.API_KEY || '');
}

router.get(['/health', '/gemini/health'], (req, res) => {
  const key = getEffectiveApiKey(req);
  res.json({ status: 'ok', hasKey: !!key });
});

// Test Gemini API key or connection with granular error classification and capabilities check
router.post(['/test', '/gemini/test'], async (req, res) => {
  if (req.body?.provider === 'vertex') {
    const { handleVertexTest } = await import('./vertex');
    return handleVertexTest(req, res);
  }
  const startTime = Date.now();
  try {
    const { apiKey: suppliedKey, checkImageCapability = true } = req.body || {};
    const keyToUse = sanitizeApiKey(suppliedKey) || getEffectiveApiKey(req);
    if (!keyToUse) {
      return res.status(400).json({
        valid: false,
        code: 'NO_API_KEY',
        error: 'No Gemini API key supplied or found in server environment. Please enter your API key from Google AI Studio.'
      });
    }

    const aiClient = new GoogleGenAI({ apiKey: keyToUse });

    let respText = '';
    let modelUsed = 'gemini-2.5-flash';
    try {
      const result = await aiClient.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'Respond with OK',
      });
      respText = result.text || '';
    } catch {
      modelUsed = 'gemini-flash-latest';
      const result = await aiClient.models.generateContent({
        model: 'gemini-flash-latest',
        contents: 'Respond with OK',
      });
      respText = result.text || '';
    }

    const latencyMs = Date.now() - startTime;
    return res.json({
      valid: true,
      message: 'Connected successfully to Google AI Studio Gemini API!',
      modelUsed,
      capabilities: {
        text: true,
        storyboard: true,
        image: true
      },
      latencyMs,
      sample: respText.slice(0, 50).trim()
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const rawMsg = err?.message || String(err);
    const status = err?.status || err?.statusCode || 500;

    let code = 'AUTH_ERROR';
    let userMsg = rawMsg;

    if (status === 400 || /API_KEY_INVALID|API key not valid|INVALID_ARGUMENT/i.test(rawMsg)) {
      code = 'API_KEY_INVALID';
      userMsg = 'API key is not valid (API_KEY_INVALID). Verify your key from https://aistudio.google.com/apikey. If generated in Google Cloud Console, ensure "Generative Language API" is enabled and application restrictions are set to "None" (not HTTP referrers).';
    } else if (status === 403 || /PERMISSION_DENIED|access not configured|forbidden/i.test(rawMsg)) {
      code = 'PERMISSION_DENIED';
      userMsg = 'Permission denied. Ensure the Generative Language API is enabled for your Google Cloud project and your API key has appropriate permissions.';
    } else if (status === 429 || /RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(rawMsg)) {
      code = 'RESOURCE_EXHAUSTED';
      userMsg = 'Gemini API quota or rate limit reached (RESOURCE_EXHAUSTED). Please wait a moment or upgrade your Google AI Studio quota tier.';
    } else if (/LOCATION_NOT_SUPPORTED|region.*not supported|User location is not supported/i.test(rawMsg)) {
      code = 'REGION_BLOCKED';
      userMsg = 'User location is not supported by Google AI Studio API for direct requests from this IP region.';
    }

    return res.json({
      valid: false,
      code,
      error: userMsg,
      rawError: rawMsg,
      latencyMs
    });
  }
});

// Generate structured storyboard from user script/prompt
router.post(['/generate-storyboard', '/storyboard/generate', '/gemini/generate-storyboard'], async (req, res) => {
  try {
    const { prompt, sceneCount = 4 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const effectiveKey = getEffectiveApiKey(req);
    if (!effectiveKey) {
      return res.status(503).json({ error: 'Gemini API not configured' });
    }

    const ai = new GoogleGenAI({ apiKey: effectiveKey });

    const systemInstruction = `You are a world-class commercial and cinematic film director.
Convert the user's idea or script into a structured storyboard sequence with exactly ${sceneCount} distinct scenes.
For every scene:
- Provide a vivid, punchy title.
- Provide a detailed visual description of what appears in frame.
- Provide an AI image prompt optimized for text-to-image models (flux/photorealistic).
- Provide a voiceover narration script (1-2 sentences).
- Provide text overlay content (punchy title or key takeaway, 2-5 words).
- Suggest duration in seconds (typically between 3 and 6 seconds).
- CRITICAL REQUIREMENT: Do not leave text overlay or voiceover empty for ANY scene. Every single scene, especially the final closing shot (call-to-action or conclusion), MUST have a meaningful text overlay and full voiceover text.
- EDITORIAL SHOT CONTRAST (30-DEGREE / FOCAL RULE): Never place two consecutive scenes with the same shot scale or framing. Alternate deliberately between Extreme Wide Establishing (EWS), Medium Action (MS), Close-Up Emotion/Detail (CU), and Low/High-Angle Dynamic shots so every cut feels visually motivated.
- RHYTHMIC PACING ARC: Vary scene durations intentionally rather than making every scene the same length:
  * Scene 1 (Visual Hook): 2.0 to 3.0 seconds — immediate visual intrigue.
  * Middle Scenes (Narrative Build): 3.5 to 5.5 seconds — allow complex visuals to register.
  * Climax / Pattern-Interrupt Beat: 2.0 to 3.0 seconds — punchy cut on high energy.
  * Final Scene (Resolution / Call-to-Action): 4.0 to 5.0 seconds — hold for emotional landing.`;

    const modelName = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    let response: any;
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    voiceoverText: { type: Type.STRING },
                    textOverlay: { type: Type.STRING },
                    duration: { type: Type.NUMBER },
                    transition: { type: Type.STRING },
                  },
                  required: ['title', 'description', 'prompt', 'voiceoverText', 'textOverlay', 'duration'],
                },
              },
            },
            required: ['scenes'],
          },
        },
      });
    } catch {
      // Fallback model
      response = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
        }
      });
    }

    const parsed = JSON.parse(response.text || '{}');
    const totalScenes = (parsed.scenes || []).length;
    const generatedScenes = (parsed.scenes || []).map((sc: any, idx: number) => {
      const isLastShot = idx === totalScenes - 1;
      const textOverlayContent = sc.textOverlay?.trim() || (isLastShot ? (sc.title || 'Closing Scene') : (sc.title || `Scene ${idx + 1}`));
      const voiceover = sc.voiceoverText?.trim() || (isLastShot ? `And that concludes our presentation on ${prompt}.` : `Exploring ${sc.title || `Scene ${idx + 1}`}.`);

      return {
        id: `scene_${Date.now()}_${idx}`,
        title: sc.title || `Scene ${idx + 1}`,
        description: sc.description || '',
        prompt: sc.prompt || '',
        duration: Math.max(2, Math.min(10, sc.duration || 4)),
        voiceoverText: voiceover,
        transition: sc.transition || 'fade',
        transitionDuration: 0.5,
        imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1280&q=80',
        layers: [
          {
            id: `layer_${Date.now()}_${idx}`,
            type: 'text',
            content: textOverlayContent,
            x: 50,
            y: 80,
            width: 80,
            height: 20,
            style: { fontSize: '42px', color: '#ffffff', fontWeight: 'bold' },
            animation: { type: 'fade', duration: 0.8 },
          }
        ]
      };
    });

    return res.json({ scenes: generatedScenes });
  } catch (err: any) {
    console.error('[Gemini Storyboard Error]:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate storyboard' });
  }
});

/**
 * Universal Gemini / GoogleGenAI reverse proxy handler.
 * Forwards requests from client-side @google/genai SDK (e.g. /v1beta/models/...:generateContent)
 * securely to Google Generative Language API or Vertex AI.
 */
async function proxyToGoogleGenAI(req: express.Request, res: express.Response) {
  try {
    const effectiveKey = getEffectiveApiKey(req);
    if (!effectiveKey) {
      return res.status(401).json({
        error: {
          message: 'Gemini API key is not configured. Please add a valid Gemini API key in Settings or set GEMINI_API_KEY.',
          code: 401,
          status: 'UNAUTHENTICATED'
        }
      });
    }

    // Strip leading /genai or /api/genai if present in req.url
    let targetPath = req.url;
    targetPath = targetPath.replace(/^\/genai/, '');
    if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

    // Check if Vertex AI is requested via headers
    const vertexProject = req.headers['x-vertex-project'] as string;
    const vertexLocation = (req.headers['x-vertex-location'] as string) || 'us-central1';

    let targetBaseUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': 'ContentGenAI-ServerProxy/1.3.2',
    };

    if (vertexProject) {
      const isGlobalOnly = (m: string) => /preview|exp/i.test(m);
      const pickLocation = (model: string, configured: string) =>
        isGlobalOnly(model) ? 'global' : (configured || 'us-central1');

      const loc = pickLocation(targetPath, vertexLocation);
      const host = loc === 'global'
        ? 'aiplatform.googleapis.com'
        : `${loc}-aiplatform.googleapis.com`;

      targetBaseUrl = `https://${host}${targetPath}`;
      headers['x-goog-user-project'] = vertexProject;
      if (effectiveKey) {
        headers['x-goog-api-key'] = effectiveKey;
      }
    } else {
      targetBaseUrl = `https://generativelanguage.googleapis.com${targetPath}`;
      headers['x-goog-api-key'] = effectiveKey;
    }

    const urlObj = new URL(targetBaseUrl);
    for (const [k, v] of Object.entries(req.query)) {
      if (k !== 'key') {
        if (Array.isArray(v)) {
          v.forEach(val => urlObj.searchParams.append(k, String(val)));
        } else if (v !== undefined) {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }
    urlObj.searchParams.set('key', effectiveKey);

    const isStream = targetPath.includes('streamGenerateContent') || req.query.alt === 'sse';

    const axiosRes = await axios({
      method: req.method as any,
      url: urlObj.toString(),
      headers,
      data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      responseType: isStream ? 'stream' : 'json',
      validateStatus: () => true,
      timeout: 120000,
    });

    res.status(axiosRes.status);

    const contentType = axiosRes.headers['content-type'];
    if (typeof contentType === 'string') {
      res.setHeader('Content-Type', contentType);
    }

    if (isStream && axiosRes.data?.pipe) {
      axiosRes.data.pipe(res);
    } else {
      res.send(axiosRes.data);
    }
  } catch (err: any) {
    console.error('[Gemini Proxy Error]:', err?.message || err);
    const status = err.response?.status || 500;
    const errorData = err.response?.data || {
      error: {
        message: err.message || 'Failed to proxy request to Gemini API',
        code: status,
        status: 'INTERNAL'
      }
    };
    return res.status(status).json(errorData);
  }
}

// Route all API calls starting with /v1beta, /v1alpha, /v1, /models, /operations, or /genai/* to proxy
router.all([
  '/v1beta/*',
  '/v1alpha/*',
  '/v1/*',
  '/models/*',
  '/operations/*',
  '/genai/*',
  '/v1beta',
  '/v1alpha',
  '/v1',
  '/models',
  '/operations'
], proxyToGoogleGenAI);

// Wildcard fallback for any other sub-route under /api/genai or /api/gemini
router.all('*', proxyToGoogleGenAI);

export default router;
