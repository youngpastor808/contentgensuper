/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type express from 'express';

const CONFIGURED_ORIGIN_HOST = (process.env.ALLOWED_ORIGIN_HOST || '').toLowerCase().trim();

function isAllowedAwsWorkerHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  const configuredBucket = (
    process.env.REMOTION_AWS_BUCKET ||
    process.env.AWS_S3_MEDIA_BUCKET ||
    process.env.S3_BUCKET ||
    ''
  )
    .toLowerCase()
    .trim();

  if (configuredBucket) {
    return (
      lower === `${configuredBucket}.s3.amazonaws.com` ||
      (lower.startsWith(`${configuredBucket}.s3.`) && lower.endsWith('.amazonaws.com'))
    );
  }
  return lower.startsWith('remotionlambda-') && lower.endsWith('.amazonaws.com');
}

export function isAllowedOrigin(originStr?: string, hostHeader?: string): boolean {
  if (!originStr) return false;
  try {
    const url = new URL(originStr);
    const hostname = url.hostname.toLowerCase();
    if (hostHeader) {
      const hostClean = hostHeader.split(':')[0].toLowerCase();
      if (hostname === hostClean) return true;
    }
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      url.protocol === 'app:' ||
      isAllowedAwsWorkerHost(hostname) ||
      (hostname.endsWith('.run.app') &&
        (CONFIGURED_ORIGIN_HOST ? hostname === CONFIGURED_ORIGIN_HOST : true)) ||
      hostname === 'aistudio.google.com' ||
      hostname.endsWith('.aistudio.google.com') ||
      hostname === 'ai.studio' ||
      hostname.endsWith('.ai.studio')
    );
  } catch {
    return false;
  }
}

function isTrustedDesktopOrigin(originStr?: string): boolean {
  if (!originStr) return false;
  try {
    const url = new URL(originStr);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'app:';
  } catch {
    return false;
  }
}

function hasAllowedAwsWorkerHeader(headerUrl?: string): boolean {
  if (!headerUrl) return false;
  try {
    return isAllowedAwsWorkerHost(new URL(headerUrl).hostname);
  } catch {
    return false;
  }
}

export function backendAuthGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  const fullPath = (req.originalUrl || req.url || req.path || '').split('?')[0];
  const pathToCheck = req.path || fullPath;

  if (
    (req.method === 'GET' &&
      (fullPath.includes('/api/cloud-render/assets') ||
        fullPath.includes('/cloud-render/assets') ||
        fullPath.includes('/assets/') ||
        fullPath.includes('/api/cloud-render/download') ||
        fullPath.includes('/cloud-render/download') ||
        fullPath.includes('/download') ||
        fullPath.includes('stream-download') ||
        fullPath.includes('/api/media') ||
        fullPath.includes('/media') ||
        pathToCheck.includes('/api/cloud-render/assets') ||
        pathToCheck.includes('/cloud-render/assets') ||
        pathToCheck.includes('/assets/') ||
        pathToCheck.includes('/download') ||
        pathToCheck.includes('stream-download'))) ||
    fullPath.includes('/api/cloud-render/webhook') ||
    fullPath.includes('/cloud-render/webhook') ||
    pathToCheck.includes('/webhook')
  ) {
    return next();
  }

  const hostHeader = req.headers.host;
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const isAwsWorker = hasAllowedAwsWorkerHeader(origin) || hasAllowedAwsWorkerHeader(referer);

  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site' && !isTrustedDesktopOrigin(origin) && !isAwsWorker) {
    return res.status(403).json({ error: 'Cross-site requests are prohibited.' });
  }

  if (!origin && !referer) {
    if (
      fullPath.includes('/download') ||
      fullPath.includes('/assets/') ||
      fullPath.includes('/assets') ||
      pathToCheck.includes('/download') ||
      pathToCheck.includes('/assets')
    ) {
      return next();
    }
    console.warn(`[Backend Auth Guard] Blocked request with missing Origin and Referer: ${req.path}`);
    return res.status(403).json({ error: 'Forbidden: Valid Origin or Referer header is required.' });
  }

  if (origin && !isAllowedOrigin(origin, hostHeader)) {
    console.warn(`[Backend Auth Guard] Blocked request from untrusted origin: ${origin}`);
    return res.status(403).json({ error: 'Forbidden origin.' });
  }

  if (referer && !isAllowedOrigin(referer, hostHeader)) {
    console.warn(`[Backend Auth Guard] Blocked request from untrusted referer: ${referer}`);
    return res.status(403).json({ error: 'Forbidden referer.' });
  }

  next();
}

export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

export function createApiRateLimiter(bucketPrefix: string, maxTokens = 240, refillIntervalMs = 60000) {
  const routeBuckets = new Map<string, RateLimitBucket>();

  // Periodically evict expired rate-limit buckets
  setInterval(() => {
    const cutoff = Date.now() - 600000;
    for (const [key, bucket] of routeBuckets.entries()) {
      if (bucket.lastRefill < cutoff) {
        routeBuckets.delete(key);
      }
    }
  }, 600000).unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let bucket = routeBuckets.get(ip);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      routeBuckets.set(ip, bucket);
    } else {
      const elapsed = now - bucket.lastRefill;
      if (elapsed >= refillIntervalMs) {
        bucket.tokens = maxTokens;
        bucket.lastRefill = now;
      }
    }

    if (bucket.tokens <= 0) {
      return res.status(429).json({ error: `Too many requests to ${bucketPrefix}. Please slow down.` });
    }

    bucket.tokens -= 1;
    next();
  };
}

export const llmLimiter = createApiRateLimiter('llm', 240, 60000);
export const transcribeLimiter = createApiRateLimiter('transcribe', 120, 60000);
export const gradioLimiter = createApiRateLimiter('gradio', 120, 60000);
export const aiGatewayLimiter = createApiRateLimiter('ai-gateway', 120, 60000);
export const mediaLimiter = createApiRateLimiter('media', 120, 60000);
export const depthLimiter = createApiRateLimiter('depth', 240, 60000);
export const edgeTtsLimiter = createApiRateLimiter('edge-tts', 300, 60000);
export const cloudRenderLimiter = createApiRateLimiter('cloudRender', 3000, 60000);
