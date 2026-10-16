/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * POST /api/depth
 *   body: raw image bytes (image/jpeg | image/png | image/webp), <= 12 MB
 *   resp: 8-bit grayscale PNG, 255 = NEAR, 0 = FAR (relative depth, same size as the
 *         model output; the client refines/upsamples it against the RGB image)
 *
 * Model: Depth-Anything (small) through @xenova/transformers, already a dependency for
 * Whisper. Override with DEPTH_MODEL, e.g. an ONNX Depth-Anything-V2 export once you
 * upgrade to @huggingface/transformers v3.
 */
import express from 'express';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { pipeline, RawImage } from '@xenova/transformers';
import { log } from '../utils';

const router = express.Router();

const MODEL = process.env.DEPTH_MODEL || 'Xenova/depth-anything-small-hf';
const MAX_SIDE = 640;               // inference resolution (long side)
const CACHE_LIMIT = 64;

let estimator: Promise<any> | null = null;
const cache = new Map<string, Buffer>();   // sha1(body) -> png

function getEstimator() {
  if (!estimator) {
    log('Depth', `Loading depth model ${MODEL} (first call downloads it)...`);
    estimator = pipeline('depth-estimation', MODEL).then((p: any) => {
      log('Depth', 'Depth model ready.');
      return p;
    }).catch((err: any) => {
      estimator = null; // allow retry on the next request
      throw err;
    });
  }
  return estimator;
}

// Serialize inference: the ONNX runtime is CPU-heavy and Cloud Run instances are small.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

router.post(
  '/',
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '12mb' }),
  async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 64) {
      return res.status(400).json({ error: 'Send raw image bytes (image/jpeg, image/png or image/webp).' });
    }

    const key = crypto.createHash('sha1').update(body).digest('hex');
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); cache.set(key, hit); // refresh LRU
      res.setHeader('x-depth-cache', 'hit');
      return res.type('image/png').send(hit);
    }

    try {
      const { data, info } = await sharp(body, { failOn: 'none' })
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const input = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);

      const png = await serialize(async () => {
        const est = await getEstimator();
        const out = await est(input);
        const d = out.depth; // RawImage (1 channel, 0..255, larger = nearer)
        return sharp(Buffer.from(d.data), { raw: { width: d.width, height: d.height, channels: d.channels || 1 } })
          .png({ compressionLevel: 6 })
          .toBuffer();
      });

      cache.set(key, png);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      res.setHeader('x-depth-model', MODEL);
      return res.type('image/png').send(png);
    } catch (err: any) {
      log('Depth', `Depth estimation failed: ${err?.message || err}`, true);
      return res.status(503).json({ error: 'Depth model unavailable', detail: String(err?.message || err) });
    }
  }
);

export default router;
