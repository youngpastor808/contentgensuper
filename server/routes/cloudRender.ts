/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderMediaOnLambda, getRenderProgress, type AwsRegion } from '@remotion/lambda';
// Dynamically import cloudrun client to prevent bundling errors if not used
const importCloudRun = () => import('@remotion/cloudrun/client');

import { renderCloudVideoWithCanvas, findChromeExecutable } from '../cloudCanvasWorker';
import { buildCanonicalExportPayload } from '../../src/exporter/canonical-payload';
import type { CloudJob } from '../types/cloudRender';
import {
  getAwsConcurrencyBudget,
  getMaxConcurrentAwsJobs,
  calculateOptimalFramesPerLambda,
  enqueueAwsRender,
  startAwsRender,
  dispatchNextAwsJobs,
  releaseAwsConcurrency,
  dequeueAwsJob,
  getAwsQueuePosition,
  refreshAwsJob,
} from '../awsRenderManager';
import { prepareHyperFramesForCloud } from '../hyperframeRasterizer';

const REMOTION_ENTRY = path.resolve(process.cwd(), 'remotion/src/index.ts');
const USE_REMOTION_CANVAS = process.env.RENDER_ENGINE === 'remotion-canvas';
import { setupGoogleApplicationCredentials } from '../_core/env';
import {
  uploadToS3,
  uploadFileToS3,
  getS3Config,
  isS3Configured,
  getS3Url,
  getS3PresignedUrl,
  getS3PresignedUrlForBucket,
  getS3ObjectStream,
  checkS3ObjectExists
} from '../s3Storage';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import type http from 'node:http';
import { isPrivateAddress } from './gradio';
import { chargeJobRenderUsage, checkUserQuota } from '../usageAccounting';
import {
  uploadFileToGcs,
  checkGcsObjectExists,
  isGcsConfigured,
  getGcsConfig
} from '../gcsStorage';
import { getFirebaseAuth, getFirestoreDb } from '../firebaseAdmin';
import { getJob, setJob, deleteJob, listJobsForUser, listAllJobsForAdmin, listActiveJobs } from '../jobStore';

const router = express.Router();

/**
 * Standardized owner/admin email list matching src/auth/session.ts
 */
const SUPER_ADMIN_EMAILS = [
  'bwaimatwaima@gmail.com'
];

function isOwnerOrAdminEmail(email?: string | null, emailVerified?: boolean): boolean {
  if (!email) return false;
  // An unverified email claim MUST NEVER obtain administrator privileges
  if (emailVerified !== undefined && !emailVerified) return false;
  const lower = email.toLowerCase().trim();
  return SUPER_ADMIN_EMAILS.some(e => e.toLowerCase().trim() === lower);
}

export interface VerifiedPrincipal {
  uid: string;
  email?: string;
  isAdmin: boolean;
  isElectronDesktop: boolean;
}

/**
 * Resolves requesting principal strictly from verified server-side credentials:
 * 1. Verified Firebase ID token in Authorization: Bearer <token>
 * 2. Authenticated Electron desktop environment running locally
 * Never trusts caller-supplied query parameters or unverified bodies.
 */
export async function resolveVerifiedPrincipal(req: express.Request): Promise<VerifiedPrincipal | null> {
  // Check attached req.user principal
  if ((req as any).user && (req as any).user.uid) {
    const user = (req as any).user;
    return {
      uid: user.uid,
      email: user.email,
      isAdmin: Boolean(user.isAdmin || user.role === 'admin' || user.role === 'owner'),
      isElectronDesktop: Boolean(user.isElectronDesktop)
    };
  }

  // Check Authorization Bearer header with Firebase Admin SDK
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice(7).trim();
    if (idToken) {
      try {
        const authAdmin = getFirebaseAuth();
        if (authAdmin) {
          const decoded = await authAdmin.verifyIdToken(idToken);
          if (decoded && decoded.uid) {
            let isAdmin = Boolean(decoded.email_verified && isOwnerOrAdminEmail(decoded.email, decoded.email_verified));
            if (!isAdmin) {
              try {
                const db = getFirestoreDb();
                if (db) {
                  const userDoc = await db.collection('users').doc(decoded.uid).get();
                  if (userDoc.exists) {
                    const data = userDoc.data();
                    if (data?.role === 'admin' || data?.role === 'owner') {
                      isAdmin = true;
                    }
                  }
                }
              } catch {}
            }
            return {
              uid: decoded.uid,
              email: decoded.email,
              isAdmin,
              isElectronDesktop: false
            };
          }
        }
      } catch (err) {
        // Invalid or expired token
      }
    }
  }

  // Check Electron Desktop environment running locally on the desktop app
  const isDesktopServer = process.env.IS_DESKTOP === 'true';
  const origin = req.headers.origin as string | undefined;
  const isLocalOrigin = origin === 'http://localhost:3000' || origin === 'http://127.0.0.1:3000' || (origin && origin.startsWith('app://'));
  const isLocalHost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';

  if (isDesktopServer && isLocalHost && (isLocalOrigin || !origin)) {
    return {
      uid: 'desktop_local_user',
      email: 'desktop@local',
      isAdmin: true,
      isElectronDesktop: true
    };
  }

  return null;
}

/**
 * Enforces cloud-render job ownership or administrator privileges.
 */
export async function authorizeJobAccess(req: express.Request, job: CloudJob): Promise<boolean> {
  const principal = await resolveVerifiedPrincipal(req);
  if (!principal) return false;
  if (principal.isAdmin || principal.isElectronDesktop) return true;
  return Boolean(job.userId && job.userId === principal.uid);
}

/**
 * Constant-time comparison helper for webhook secrets.
 */
export function safeCompareSecret(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  try {
    const bufA = Buffer.from(provided);
    const bufB = Buffer.from(expected);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Strict allowlist validation for callback-supplied output URLs to eliminate SSRF.
 * Validates scheme (https only), port (443 only), and exact storage provider destinations.
 * Fails closed if storage bucket configuration is missing.
 */
export function isValidTrustedStorageOutputUrl(urlString: string, provider: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.port && parsed.port !== '443') return false;

    const hostname = parsed.hostname.toLowerCase();

    if (provider === 'gcp-cloudrun') {
      const gcpCfg = getGcpConfig();
      const allowedBucket = (gcpCfg.mediaBucket || gcpCfg.bucketName || '').trim().toLowerCase();
      // Fail closed if storage bucket configuration is missing
      if (!allowedBucket) return false;

      if (hostname === 'storage.googleapis.com') {
        return parsed.pathname.toLowerCase().startsWith(`/${allowedBucket}/`);
      }
      if (hostname === `${allowedBucket}.storage.googleapis.com`) {
        return true;
      }
      return false;
    }

    if (provider === 'aws-lambda') {
      const awsCfg = getAwsConfig();
      const allowedBucket = (awsCfg.bucketName || '').trim().toLowerCase();
      // Fail closed if storage bucket configuration is missing
      if (!allowedBucket) return false;

      const isS3StandardHost = hostname === 's3.amazonaws.com' || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(hostname);
      const isVirtualHosted = hostname === `${allowedBucket}.s3.amazonaws.com` ||
        new RegExp(`^${allowedBucket.replace(/\./g, '\\.')}\\.s3[.-][a-z0-9-]+\\.amazonaws\\.com$`).test(hostname);

      if (isVirtualHosted) return true;
      if (isS3StandardHost && parsed.pathname.toLowerCase().startsWith(`/${allowedBucket}/`)) return true;

      return false;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Validates that a callback outputKey targets a job-specific path and contains no path traversal.
 */
export function isJobSpecificOutputKey(key: string, jobId: string, renderId?: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const cleanKey = key.trim();
  if (cleanKey.length === 0 || cleanKey.length > 500) return false;
  if (cleanKey.includes('..') || cleanKey.includes('\0') || cleanKey.startsWith('/') || cleanKey.startsWith('\\')) return false;

  const lowerKey = cleanKey.toLowerCase();
  const lowerJobId = jobId.toLowerCase();
  const lowerRenderId = renderId ? renderId.toLowerCase() : undefined;

  if (lowerKey.includes(lowerJobId)) return true;
  if (lowerRenderId && lowerKey.includes(lowerRenderId)) return true;

  return false;
}

/**
 * Validates that a callback bucket matches the exact server-configured bucket for the provider.
 */
export function isValidRenderBucket(bucketName: string, provider: string): boolean {
  if (!bucketName || typeof bucketName !== 'string') return false;
  const cleanBucket = bucketName.trim().toLowerCase();

  if (provider === 'aws-lambda') {
    const awsCfg = getAwsConfig();
    const expected = (awsCfg.bucketName || '').trim().toLowerCase();
    return Boolean(expected && cleanBucket === expected);
  }

  if (provider === 'gcp-cloudrun') {
    const gcpCfg = getGcpConfig();
    const expectedMedia = (gcpCfg.mediaBucket || '').trim().toLowerCase();
    const expectedBase = (gcpCfg.bucketName || '').trim().toLowerCase();
    return Boolean((expectedMedia && cleanBucket === expectedMedia) || (expectedBase && cleanBucket === expectedBase));
  }

  return false;
}

/**
 * Validates that a render ID matches expected provider alphanumeric/hyphen format.
 */
export function isValidRenderId(renderId: string): boolean {
  if (!renderId || typeof renderId !== 'string') return false;
  const clean = renderId.trim();
  return /^[a-zA-Z0-9_-]{4,128}$/.test(clean);
}

/**
 * Validates that a remote URL does not target loopback, link-local, private networks,
 * or cloud metadata endpoints, performing DNS resolution verification to block SSRF.
 */
export async function validateSafeRemoteUrl(urlStr: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Malformed URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS remote URLs are permitted');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Non-standard ports are prohibited');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Loopback and internal hostnames are prohibited');
  }

  // Explicit cloud metadata blocks across major cloud providers
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname === '100.100.100.200' ||
    hostname === 'fd00:ec2::254'
  ) {
    throw new Error('Cloud metadata endpoints are strictly prohibited');
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Forbidden destination IP address (${hostname})`);
    }
  }

  // Resolve hostname via DNS and check every returned IP
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error('Host resolution failed');
  }

  for (const addr of addresses) {
    if (isPrivateAddress(addr.address)) {
      throw new Error(`Forbidden destination IP address (${addr.address})`);
    }
  }

  return parsed;
}


/**
 * Validates MP4 file container and moov atom presence with ffprobe.
 */
export function probeMp4(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    const stat = fs.statSync(p);
    if (stat.size < 100) return false;
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'csv=p=0', p], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes MP4 by relocating the moov index atom to the start (+faststart).
 */
export function faststartMp4(inp: string, out: string): void {
  execFileSync('ffmpeg', ['-y', '-i', inp, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'pipe' });
}

// ─── Storage Directories ───────────────────────────────────────────────────────
export const RENDER_ASSETS_DIR = path.join(os.tmpdir(), 'contentgen-render-assets');
if (!fs.existsSync(RENDER_ASSETS_DIR)) {
  fs.mkdirSync(RENDER_ASSETS_DIR, { recursive: true });
}

export const RENDER_OUTPUT_DIR = path.join(os.tmpdir(), 'contentgen-render-outputs');
if (!fs.existsSync(RENDER_OUTPUT_DIR)) {
  fs.mkdirSync(RENDER_OUTPUT_DIR, { recursive: true });
}

/**
 * Sanitizes asset filenames to prevent path traversal, invalid characters, and collisions.
 * Preserves clean hash identifiers (e.g. asset_<hash>.<ext>) while sanitizing arbitrary user filenames.
 */
export function sanitizeAssetFilename(rawName?: string): string {
  if (!rawName || typeof rawName !== 'string') {
    return `asset_${Date.now()}_${randomBytes(6).toString('hex')}.jpg`;
  }

  // Strip directory components
  const baseOnly = path.basename(rawName).trim();
  const rawExt = path.extname(baseOnly).toLowerCase().replace(/[^a-z0-9]/g, '');
  const ext = rawExt ? `.${rawExt}` : '.jpg';
  const nameWithoutExt = path.basename(baseOnly, path.extname(baseOnly))
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);

  // If already matches safe asset_<hash> pattern
  if (/^asset_[a-zA-Z0-9_-]+$/.test(nameWithoutExt)) {
    return `${nameWithoutExt}${ext}`;
  }

  // Otherwise generate unique safe asset name
  const uniqueTag = `${Date.now()}_${randomBytes(4).toString('hex')}`;
  return `asset_${uniqueTag}_${nameWithoutExt || 'media'}${ext}`;
}

// Use diskStorage with filename sanitization to prevent path traversal and collisions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RENDER_ASSETS_DIR),
  filename: (req, file, cb) => {
    cb(null, sanitizeAssetFilename(file.originalname));
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

const chunkUploadDir = path.join(os.tmpdir(), 'contentgen-chunks');
if (!fs.existsSync(chunkUploadDir)) {
  fs.mkdirSync(chunkUploadDir, { recursive: true });
}

const MAX_CHUNK_BYTES = 64 * 1024 * 1024; // 64MB per chunk

const chunkUpload = multer({
  dest: chunkUploadDir,
  limits: {
    fileSize: MAX_CHUNK_BYTES,
    files: 1,
    fields: 20,
  },
});

// Periodic stale chunk cleanup (removes chunks older than 2 hours)
function cleanupOldChunkDirectories(): void {
  const now = Date.now();
  const MAX_AGE = 2 * 60 * 60 * 1000;

  if (!fs.existsSync(chunkUploadDir)) {
    return;
  }

  try {
    for (const name of fs.readdirSync(chunkUploadDir)) {
      const full = path.join(chunkUploadDir, name);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > MAX_AGE) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {}
    }
  } catch {}
}

const chunkCleanupTimer = setInterval(cleanupOldChunkDirectories, 30 * 60 * 1000);
chunkCleanupTimer.unref?.();

// ─── Job & FIFO Queue State ───────────────────────────────────────────────────
export const renderQueue: string[] = [];
let isProcessingQueue = false;

// Backwards-compatible governor helpers delegated to awsRenderManager
export function getMaxConcurrentLambdaRenders(): number {
  return getMaxConcurrentAwsJobs();
}
export const MAX_CONCURRENT_LAMBDA_RENDERS = 3;

export function getMaxAwsDurationMinutes(): number {
  const raw = Number(process.env.REMOTION_AWS_MAX_DURATION_MINUTES);
  return Number.isFinite(raw) && raw >= 5 ? raw : 75;
}

export async function releaseLambdaSlot(jobId: string) {
  releaseAwsConcurrency(jobId);
  void dispatchNextAwsJobs();
}


// ─── In-Memory Processor ──────────────────────────────────────────────────────
async function processRenderQueue(): Promise<void> {
  if (isProcessingQueue || renderQueue.length === 0) return;

  isProcessingQueue = true;
  const jobId = renderQueue.shift();
  const job = jobId ? await getJob(jobId) : undefined;

  if (!job) {
    isProcessingQueue = false;
    return processRenderQueue();
  }

  job.status = 'rendering';
  job.progress = 1;
  job.updatedAt = Date.now();
  await setJob(job.id, job);

  try {
    const outPath = path.join(RENDER_OUTPUT_DIR, `${job.id}.mp4`);
    const port = process.env.PORT || 3000;
    const appBaseUrl = `http://127.0.0.1:${port}`;

    console.log(`[In-Memory Queue] Starting render for Job ${job.id} (engine: ${USE_REMOTION_CANVAS ? 'remotion-canvas' : 'canvas-puppeteer'})...`);

    let renderFn: (opts: any) => Promise<any> = renderCloudVideoWithCanvas;
    if (USE_REMOTION_CANVAS) {
      const { renderCloudVideoWithRemotionCanvas } = await import('../remotionCanvasRenderWorker');
      renderFn = (o: any) => renderCloudVideoWithRemotionCanvas(o, REMOTION_ENTRY);
    }

    await renderFn({
      inputProps: job.inMemoryOptions?.inputProps || {},
      fps: job.inMemoryOptions?.fps || 30,
      resolution: job.inMemoryOptions?.resolution || '1080p',
      durationInFrames: job.inMemoryOptions?.durationInFrames || 300,
      outputFilePath: outPath,
      appBaseUrl,
      onProgress: (p: number) => {
        const pct = p <= 1 ? p * 100 : p;
        job.progress = Math.max(1, Math.min(99, Math.round(pct)));
        job.updatedAt = Date.now();
        setJob(job.id, job).catch(() => {});
      },
    });

    job.status = 'done';
    job.progress = 100;
    job.outputFilePath = outPath;
    job.outputUrl = `/api/cloud-render/download/${job.id}`;

    // Upload rendered video to S3 or GCS if configured
    if (isS3Configured() && fs.existsSync(outPath)) {
      try {
        const fileStream = fs.createReadStream(outPath);
        const s3Upload = await uploadToS3(`renders/${job.id}.mp4`, fileStream as any, 'video/mp4');
        if (s3Upload?.url) {
          job.outputUrl = s3Upload.url;
          console.log(`[In-Memory Queue] Uploaded Job ${job.id} render to S3: ${s3Upload.url}`);
        }
      } catch (s3Err) {
        console.warn(`[In-Memory Queue] S3 render upload error for Job ${job.id}:`, s3Err);
      }
    } else if (isGcsConfigured() && fs.existsSync(outPath)) {
      try {
        const gcsRes = await uploadFileToGcs(`renders/${job.id}.mp4`, outPath, 'video/mp4');
        if (gcsRes?.url) {
          job.outputUrl = gcsRes.url;
          console.log(`[In-Memory Queue] Uploaded Job ${job.id} render to GCS: ${gcsRes.url}`);
        }
      } catch (gcsErr) {
        console.warn(`[In-Memory Queue] GCS render upload error for Job ${job.id}:`, gcsErr);
      }
    }

    job.updatedAt = Date.now();
    await setJob(job.id, job);
    console.log(`[In-Memory Queue] Successfully finished Job ${job.id}`);
  } catch (err: any) {
    console.error(`[In-Memory Queue] Render failed for Job ${job.id}:`, err);
    job.status = 'failed';
    job.error = err?.message || 'In-memory render worker failed';
    job.updatedAt = Date.now();
    await setJob(job.id, job);
  } finally {
    isProcessingQueue = false;
    processRenderQueue();
  }
}

// ─── Configuration Helpers ────────────────────────────────────────────────────
function sanitizeFunctionName(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  let trimmed = raw.trim();
  // Strip any wrapping quotes
  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  // Strip leading variable name if user copied "REMOTION_FUNCTION_NAME=remotion-render-..." into the env value
  trimmed = trimmed.replace(/^(?:export\s+)?(?:REMOTION_FUNCTION_NAME|REMOTION_AWS_FUNCTION_NAME)\s*=\s*/i, '').trim();
  // Strip quotes again
  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  // Match the standard Remotion Lambda function naming pattern
  const match = trimmed.match(/remotion-render-[a-zA-Z0-9_-]+/);
  let resolvedName = match ? match[0] : (trimmed || undefined);
  if (resolvedName === 'remotion-render-4-0-527-mem3008mb-disk8192mb-900sec') {
    resolvedName = 'remotion-render-4-0-527-mem3008mb-disk10240mb-900sec';
  }
  return resolvedName;
}

function sanitizeServeUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  let trimmed = raw.trim();
  // Strip wrapping quotes
  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  // Strip leading variable name if user copied "REMOTION_SERVE_URL=https://..."
  trimmed = trimmed.replace(/^(?:export\s+)?(?:REMOTION_SERVE_URL|REMOTION_AWS_SERVE_URL)\s*=\s*/i, '').trim();
  // Strip quotes again
  trimmed = trimmed.replace(/^["']|["']$/g, '').trim();
  return trimmed || undefined;
}

function getAwsConfig() {
  const accessKeyId = (process.env.REMOTION_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID)?.trim();
  const secretAccessKey = (process.env.REMOTION_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY)?.trim();
  const region = ((process.env.REMOTION_AWS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION)?.trim() || 'us-east-1') as AwsRegion;
  const rawFunctionName = process.env.REMOTION_FUNCTION_NAME || process.env.REMOTION_AWS_FUNCTION_NAME || 'remotion-render-4-0-527-arm64-mem2048mb-disk10240mb-900sec';
  const functionName = sanitizeFunctionName(rawFunctionName) || 'remotion-render-4-0-527-arm64-mem2048mb-disk10240mb-900sec';
  const rawServeUrl = process.env.REMOTION_SERVE_URL || process.env.REMOTION_AWS_SERVE_URL;
  const serveUrl = sanitizeServeUrl(rawServeUrl);

  if (accessKeyId && !process.env.AWS_ACCESS_KEY_ID) process.env.AWS_ACCESS_KEY_ID = accessKeyId;
  if (secretAccessKey && !process.env.AWS_SECRET_ACCESS_KEY) process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  if (region && !process.env.AWS_REGION) process.env.AWS_REGION = region;

  const hasCredentials = Boolean(accessKeyId && secretAccessKey);
  const configured = Boolean(hasCredentials && functionName && serveUrl);

  const missingKeys: string[] = [];
  if (!accessKeyId) missingKeys.push('REMOTION_AWS_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID)');
  if (!secretAccessKey) missingKeys.push('REMOTION_AWS_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)');
  if (!functionName) missingKeys.push('REMOTION_FUNCTION_NAME');
  if (!serveUrl) missingKeys.push('REMOTION_SERVE_URL');

  const bucketName = (process.env.REMOTION_AWS_BUCKET || process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET)?.trim();

  return { configured, hasCredentials, region, functionName, serveUrl, missingKeys, bucketName };
}

function getGcpConfig() {
  const serviceName = (process.env.REMOTION_GCP_SERVICE_NAME || process.env.REMOTION_SERVICE_NAME)?.trim();
  const serveUrl = (process.env.REMOTION_GCP_SERVE_URL || process.env.REMOTION_SERVE_URL)?.trim();
  const region = process.env.GCP_REGION?.trim() || process.env.REMOTION_GCP_REGION?.trim() || 'us-central1';
  const bucketName = (process.env.REMOTION_GCP_BUCKET || process.env.GCP_STORAGE_BUCKET)?.trim() || 'contentgenapp-remotion-us-central1';
  const mediaBucket = (process.env.REMOTION_GCP_MEDIA_BUCKET || process.env.GCS_MEDIA_BUCKET || process.env.REMOTION_GCP_BUCKET || process.env.GCP_STORAGE_BUCKET)?.trim() || 'contentgenapp-media-us-central1';
  const authStatus = setupGoogleApplicationCredentials();
  const configured = Boolean(serviceName && serveUrl);

  const missingKeys: string[] = [];
  if (!serviceName) missingKeys.push('REMOTION_GCP_SERVICE_NAME');
  if (!serveUrl) missingKeys.push('REMOTION_GCP_SERVE_URL');

  return { configured, serviceName, serveUrl, region, bucketName, mediaBucket, authStatus, missingKeys };
}

// ─── Remote Bundle Composition ────────────────────────────────────────────────
async function resolveCloudComposition(_serveUrl?: string): Promise<'CanvasStoryboardVideo' | 'StoryboardVideo'> {
  return 'CanvasStoryboardVideo';
}

// ─── Cloud Asset Resolver ───────────────────────────────────────────────────
const S3_HOST_RE = /^https:\/\/[a-z0-9.-]+\.s3[.-][a-z0-9-]*\.amazonaws\.com\//i;

/**
 * Scans composition props for any local asset URLs (/api/cloud-render/assets/... or localhost)
 * and resolves them to persistent cloud storage (S3) or high-fidelity base64 data URLs
 * before passing them to remote rendering workers (AWS Lambda / GCP Cloud Run).
 */
async function resolveLocalAssetsForCloud(props: any, opts: { skipGcs?: boolean } = {}): Promise<any> {
  if (!props) return props;
  const cloned = JSON.parse(JSON.stringify(props));
  const s3Configured = isS3Configured();
  const useGcs = !opts.skipGcs && isGcsConfigured();
  const uploadFailures: string[] = [];

  async function processValue(val: any): Promise<any> {
    if (typeof val === 'string') {
      if (val.includes('/api/cloud-render/assets/')) {
        const parts = val.split('/api/cloud-render/assets/');
        const filename = parts[parts.length - 1].split('?')[0];
        const localPath = path.join(RENDER_ASSETS_DIR, filename);
        const ext = path.extname(filename).toLowerCase();

        // Step 3: Validate MP4 clips before returning or uploading
        if (ext === '.mp4') {
          if (fs.existsSync(localPath)) {
            if (!probeMp4(localPath)) {
              throw new Error(`Video clip ${filename} is corrupt, please re-upload`);
            }
          } else if (s3Configured) {
            const exists = await checkS3ObjectExists(`assets/${filename}`);
            if (!exists) {
              throw new Error(`File ${filename} no longer exists on the server, please re-upload.`);
            }
          } else {
            throw new Error(`File ${filename} no longer exists on the server, please re-upload.`);
          }
        }

        if (fs.existsSync(localPath)) {
          // 1. If GCS is configured, upload to Google Cloud Storage (priority for Cloud Run, auto-deletes in 2 days)
          if (useGcs) {
            try {
              const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
              const gcsRes = await uploadFileToGcs(`assets/${filename}`, localPath, contentType, {
                expiresInSeconds: 86400 * 2,
              });
              if (gcsRes?.signedUrl || gcsRes?.url) {
                return gcsRes.signedUrl || gcsRes.url;
              }
            } catch (gcsErr) {
              console.warn(`[Cloud Render] GCS asset upload note for ${filename}:`, gcsErr);
            }
          }

          // 2. If S3 is configured, upload to S3 using streaming multipart upload
          if (s3Configured) {
            try {
              const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
              const s3Res = await uploadFileToS3(`assets/${filename}`, localPath, contentType, {
                generatePresigned: true,
                expiresInSeconds: 86400,
              });
              if (s3Res?.signedUrl || s3Res?.url) {
                return s3Res.signedUrl || s3Res.url;
              }
            } catch (s3Err: any) {
              console.warn(`[Cloud Render] S3 asset upload note for ${filename}:`, s3Err);
              uploadFailures.push(`${filename}: ${s3Err?.name || s3Err?.message || s3Err}`);
            }
          }

          // 3. Step 4a Hardening: Fallback ONLY for static images (< 5MB)
          // Video and audio assets MUST NEVER be converted to Base64
          if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
            try {
              const stat = fs.statSync(localPath);
              if (stat.size <= 5 * 1024 * 1024) {
                const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
                const b64 = fs.readFileSync(localPath).toString('base64');
                return `data:${mime};base64,${b64}`;
              }
            } catch {}
          } else if (!s3Configured && !useGcs) {
            throw new Error(`Remote cloud rendering for ${ext} asset (${filename}) requires S3 or Google Cloud Storage to be configured.`);
          }
        } else if (s3Configured) {
          try {
            const exists = await checkS3ObjectExists(`assets/${filename}`);
            if (exists) {
              const fresh = await getS3PresignedUrl(`assets/${filename}`, 86400);
              if (fresh) return fresh;
            }
          } catch {}
          throw new Error(`File ${filename} no longer exists on the server, please re-upload.`);
        } else if (useGcs) {
          try {
            const exists = await checkGcsObjectExists(`assets/${filename}`);
            if (exists) {
              const gcsCfg = getGcsConfig();
              return `https://storage.googleapis.com/${gcsCfg.bucket}/assets/${filename}`;
            }
          } catch {}
          throw new Error(`File ${filename} no longer exists on the server, please re-upload.`);
        } else {
          throw new Error(`File ${filename} no longer exists on the server, please re-upload.`);
        }
      }

      if (S3_HOST_RE.test(val) || val.includes('.s3.') || val.includes('.amazonaws.com/')) {
        try {
          const u = new URL(val);
          let key = u.pathname.replace(/^\//, ''); // e.g. assets/asset_xxx.wav
          const s3Config = getS3Config();
          if (s3Config?.bucket && key.startsWith(`${s3Config.bucket}/`)) {
            key = key.slice(s3Config.bucket.length + 1);
          }
          const filename = path.basename(key);
          const localPath = path.join(RENDER_ASSETS_DIR, filename);
          const ext = path.extname(filename).toLowerCase();

          if (ext === '.mp4' && fs.existsSync(localPath)) {
            if (!probeMp4(localPath)) {
              throw new Error(`Video clip ${filename} is corrupt, please re-upload`);
            }
          }

          if (useGcs && fs.existsSync(localPath)) {
            const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
            const gcsRes = await uploadFileToGcs(`assets/${filename}`, localPath, contentType, { expiresInSeconds: 86400 * 2 });
            if (gcsRes?.signedUrl || gcsRes?.url) {
              return gcsRes.signedUrl || gcsRes.url;
            }
          }

          const existsOnS3 = await checkS3ObjectExists(key);
          if (!existsOnS3 && fs.existsSync(localPath)) {
            console.log(`[Cloud Asset Resolver] Asset ${key} missing from S3 bucket ${s3Config?.bucket}, streaming upload from local cache...`);
            const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
            try {
              const s3Res = await uploadFileToS3(key, localPath, contentType, {
                generatePresigned: true,
                expiresInSeconds: 86400,
              });
              if (s3Res?.signedUrl || s3Res?.url) {
                return s3Res.signedUrl || s3Res.url;
              }
            } catch (s3Err: any) {
              console.warn(`[Cloud Render] S3 asset upload note for ${filename}:`, s3Err);
              uploadFailures.push(`${filename}: ${s3Err?.name || s3Err?.message || s3Err}`);
            }
          } else if (existsOnS3) {
            const fresh = await getS3PresignedUrl(key, 86400);
            if (fresh) return fresh;
          }
        } catch (s3ResolveErr: any) {
          if (s3ResolveErr?.message?.includes('corrupt') || s3ResolveErr?.message?.includes('no longer exists') || s3ResolveErr?.message?.includes('Asset upload failed')) throw s3ResolveErr;
        }
      }

      return val;
    }

    if (Array.isArray(val)) {
      return Promise.all(val.map(item => processValue(item)));
    }

    if (val && typeof val === 'object') {
      const result: any = {};
      for (const key of Object.keys(val)) {
        result[key] = await processValue(val[key]);
      }
      return result;
    }

    return val;
  }

  const res = await processValue(cloned);
  if (uploadFailures.length) {
    throw new Error(`Asset upload failed -> ${uploadFailures.join('; ')}`);
  }
  return res;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

// 1. Diagnostics configuration endpoint
router.get(['/config', '/cloud-render/config'], (_req, res) => {
  const awsCfg = getAwsConfig();
  const gcpCfg = getGcpConfig();
  const s3Cfg = getS3Config();
  const chromePath = findChromeExecutable();
  res.json({
    headless: {
      available: Boolean(chromePath),
      chromePath: chromePath || null,
      customExecutableEnv: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    },
    awsLambda: {
      configured: awsCfg.configured,
      hasCredentials: awsCfg.hasCredentials,
      region: awsCfg.region,
      functionName: awsCfg.functionName || null,
      hasServeUrl: Boolean(awsCfg.serveUrl),
      missing: awsCfg.missingKeys,
    },
    awsS3: {
      configured: Boolean(s3Cfg),
      bucket: s3Cfg?.bucket || null,
      region: s3Cfg?.region || null,
    },
    gcpCloudRun: {
      configured: gcpCfg.configured,
      serviceName: gcpCfg.serviceName || null,
      hasServeUrl: Boolean(gcpCfg.serveUrl),
      authValid: gcpCfg.authStatus.valid,
      clientEmail: gcpCfg.authStatus.clientEmail,
      authError: gcpCfg.authStatus.error,
      missing: gcpCfg.missingKeys,
    }
  });
});

// 2. Upload asset file endpoint
router.post(['/upload-asset', '/cloud-render/upload-asset'], upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No asset file uploaded.' });
  const host = req.headers.host || '127.0.0.1:3000';
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const filename = req.file.filename;
  const ext = path.extname(filename).toLowerCase();
  let assetUrl = `${proto}://${host}/api/cloud-render/assets/${filename}`;
  let signedUrl: string | undefined;

  // Step 3: Validate and normalize MP4 video assets
  if (ext === '.mp4') {
    if (!probeMp4(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(422).json({ error: `Uploaded video file ${filename} is corrupt or truncated (moov atom missing).` });
    }
    try {
      const faststartPath = path.join(RENDER_ASSETS_DIR, `fs_${filename}`);
      faststartMp4(req.file.path, faststartPath);
      if (fs.existsSync(faststartPath) && probeMp4(faststartPath)) {
        fs.renameSync(faststartPath, req.file.path);
      }
    } catch (fsErr) {
      console.warn('[Faststart Asset Warning]:', fsErr);
    }
  }

  // 1. If GCS is configured, upload to Google Cloud Storage
  if (isGcsConfigured()) {
    try {
      const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
      const gcsRes = await uploadFileToGcs(`assets/${filename}`, req.file.path, contentType, {
        expiresInSeconds: 86400 * 2,
      });
      if (gcsRes) {
        signedUrl = gcsRes.signedUrl;
        if (gcsRes.url) assetUrl = gcsRes.url;
      }
    } catch (gcsErr) {
      console.warn('[GCS Asset Upload Warning]:', gcsErr);
    }
  }

  // 2. If S3 is configured, upload to S3 using streaming multipart upload
  if (isS3Configured() && (!isGcsConfigured() || !signedUrl)) {
    try {
      const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
      const s3Res = await uploadFileToS3(`assets/${filename}`, req.file.path, contentType, {
        generatePresigned: true,
        expiresInSeconds: 86400,
      });
      if (s3Res) {
        signedUrl = s3Res.signedUrl;
        if (s3Res.signedUrl || s3Res.url) assetUrl = s3Res.signedUrl || s3Res.url;
      }
    } catch (s3Err: any) {
      console.error('[S3 Asset Upload FAILED]', s3Err);
      return res.status(502).json({ error: `S3 upload failed for ${filename}: ${s3Err?.message || s3Err}` });
    }
  }

  return res.json({
    success: true,
    url: assetUrl,
    signedUrl,
    assetUrl,
    filename,
    size: req.file.size
  });
});

// 2b. Check existing cached assets
router.post(['/check-assets', '/cloud-render/check-assets'], async (req, res) => {
  const assets: string[] = req.body?.assets || [];
  const existing: Record<string, string> = {};
  const host = req.headers.host || '127.0.0.1:3000';
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const extList = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.wav', '.mp3'];

  try {
    const files = fs.existsSync(RENDER_ASSETS_DIR) ? fs.readdirSync(RENDER_ASSETS_DIR) : [];
    for (const hash of assets) {
      if (!hash) continue;
      const match = files.find(f => f.includes(hash));
      if (match) {
        const fullLocalPath = path.join(RENDER_ASSETS_DIR, match);
        // If it's an MP4, verify with probeMp4 before trusting the cache
        if (path.extname(match).toLowerCase() === '.mp4' && !probeMp4(fullLocalPath)) {
          try { fs.unlinkSync(fullLocalPath); } catch {}
          continue;
        }
        existing[hash] = `${proto}://${host}/api/cloud-render/assets/${match}`;
      } else if (isS3Configured()) {
        for (const ext of extList) {
          const s3Key = `assets/asset_${hash}${ext}`;
          if (await checkS3ObjectExists(s3Key)) {
            const presigned = await getS3PresignedUrl(s3Key, 86400);
            if (presigned) {
              existing[hash] = presigned;
              break;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Check Assets Error]', err);
  }

  return res.json({ success: true, existing });
});

// 2c. Chunked upload endpoint with strict verification and streaming reassembly
router.post(['/upload-chunk', '/cloud-render/upload-chunk'], chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, filename, totalSize: rawTotalSize } = req.body;
    if (!req.file || !uploadId || chunkIndex === undefined || !totalChunks) {
      return res.status(400).json({ error: 'Missing chunk metadata' });
    }

    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(uploadId))) {
      return res.status(400).json({ error: 'Invalid uploadId format.' });
    }

    const total = parseInt(totalChunks, 10);
    const index = parseInt(chunkIndex, 10);
    const totalSize = parseInt(rawTotalSize, 10);

    if (!Number.isInteger(total) || total < 1 || total > 190) {
      return res.status(400).json({ error: 'Invalid totalChunks. Maximum is 190.' });
    }

    if (!Number.isInteger(index) || index < 0 || index >= total) {
      return res.status(400).json({ error: 'Invalid chunkIndex.' });
    }

    if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > 2 * 1024 * 1024 * 1024) {
      return res.status(400).json({ error: 'Invalid or excessive total upload size.' });
    }

    if (req.file.size > MAX_CHUNK_BYTES) {
      return res.status(413).json({ error: 'Chunk exceeds the maximum allowed size.' });
    }

    const chunkDir = path.join(os.tmpdir(), 'contentgen-chunks', path.basename(uploadId));
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const chunkPath = path.join(chunkDir, `part_${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    if (index === total - 1) {
      if (!fs.existsSync(RENDER_ASSETS_DIR)) {
        fs.mkdirSync(RENDER_ASSETS_DIR, { recursive: true });
      }

      // Reassemble all chunk parts with sanitized filename
      const safeName = sanitizeAssetFilename(filename || `${uploadId}.bin`);
      const finalPath = path.join(RENDER_ASSETS_DIR, safeName);
      const ext = path.extname(safeName).toLowerCase();

      // 1. Every part must exist
      for (let i = 0; i < total; i++) {
        if (!fs.existsSync(path.join(chunkDir, `part_${i}`))) {
          return res.status(409).json({ error: `Missing chunk ${i}/${total}` });
        }
      }

      // 2. Stream parts in order (no readFileSync of whole file into memory)
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(finalPath);
        out.on('error', reject);
        out.on('finish', resolve);
        (async () => {
          for (let i = 0; i < total; i++) {
            const p = path.join(chunkDir, `part_${i}`);
            await new Promise<void>((res2, rej2) => {
              const rs = fs.createReadStream(p);
              rs.on('error', rej2);
              rs.on('end', res2);
              rs.pipe(out, { end: false });
            });
          }
          out.end();
        })().catch(reject);
      });

      // 3. Size check against client totalSize
      if (Number.isFinite(totalSize) && totalSize > 0) {
        const actualSize = fs.statSync(finalPath).size;
        if (actualSize !== totalSize) {
          fs.rmSync(finalPath, { force: true });
          return res.status(422).json({ error: `Reassembled file size mismatch: expected ${totalSize}, got ${actualSize}` });
        }
      }

      // Only delete chunk parts after the size check passes
      try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}

      // 4. Validate and faststart MP4 videos
      if (ext === '.mp4') {
        if (!probeMp4(finalPath)) {
          fs.rmSync(finalPath, { force: true });
          return res.status(422).json({ error: `Video file ${safeName} is corrupt or truncated (moov atom missing)` });
        }
        try {
          const faststartPath = path.join(RENDER_ASSETS_DIR, `fs_${safeName}`);
          faststartMp4(finalPath, faststartPath);
          if (fs.existsSync(faststartPath) && probeMp4(faststartPath)) {
            fs.renameSync(faststartPath, finalPath);
          }
        } catch (fsErr) {
          console.warn('[Faststart Reassembly Warning]:', fsErr);
        }
      }

      const host = req.headers.host || '127.0.0.1:3000';
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
      let finalUrl = `${proto}://${host}/api/cloud-render/assets/${safeName}`;
      let signedUrl: string | undefined;

      // 5. Upload reassembled file to GCS or S3
      if (isGcsConfigured() && fs.existsSync(finalPath)) {
        try {
          const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
          const gcsRes = await uploadFileToGcs(`assets/${safeName}`, finalPath, contentType, {
            expiresInSeconds: 86400 * 2,
          });
          if (gcsRes) {
            signedUrl = gcsRes.signedUrl;
            if (gcsRes.url) finalUrl = gcsRes.url;
          }
        } catch (gcsErr) {
          console.warn('[GCS Chunk Reassembly Upload Warning]:', gcsErr);
        }
      }

      if (isS3Configured() && fs.existsSync(finalPath) && (!isGcsConfigured() || !signedUrl)) {
        try {
          const contentType = ext === '.wav' ? 'audio/wav' : ext === '.mp4' ? 'video/mp4' : ext === '.png' ? 'image/png' : 'image/jpeg';
          const s3Res = await uploadFileToS3(`assets/${safeName}`, finalPath, contentType, {
            generatePresigned: true,
            expiresInSeconds: 86400,
          });
          if (s3Res) {
            signedUrl = s3Res.signedUrl;
            if (s3Res.url) finalUrl = s3Res.url;
          }
        } catch (s3Err) {
          console.warn('[S3 Chunk Reassembly Upload Warning]:', s3Err);
        }
      }

      return res.json({ success: true, completed: true, url: finalUrl, signedUrl, assetUrl: finalUrl, filename: safeName });
    }

    return res.json({ success: true, completed: false, chunkIndex: index });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Chunk upload failed' });
  }
});

// 2d. Upload full render payload endpoint (for large project bundles that approach proxy limits)
router.post(['/upload-payload', '/cloud-render/upload-payload'], upload.single('payload'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No payload file provided' });
    }
    const payloadId = `payload_${Date.now()}_${randomBytes(6).toString('hex')}`;
    const target = path.join(RENDER_OUTPUT_DIR, `${payloadId}.json`);
    fs.renameSync(req.file.path, target);
    return res.json({ success: true, payloadId });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Payload upload failed' });
  }
});

// 3. Serve asset file endpoint with full CORS and CORP headers
router.options(['/assets/:filename', '/cloud-render/assets/:filename'], (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  return res.sendStatus(204);
});

router.get(['/assets/:filename', '/cloud-render/assets/:filename'], async (req, res) => {
  const filename = (Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename) as string;
  if (!filename) {
    return res.status(400).json({ error: 'Missing filename parameter' });
  }

  // Reject path traversal and suspicious patterns
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\0')) {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }

  const safeName = path.basename(filename);
  if (safeName !== filename) {
    return res.status(400).json({ error: 'Invalid asset identifier' });
  }

  // Canonicalize resolved path and ensure it remains strictly within permitted RENDER_ASSETS_DIR
  const resolvedAssetsDir = path.resolve(RENDER_ASSETS_DIR);
  const target = path.resolve(resolvedAssetsDir, safeName);
  if (!target.startsWith(resolvedAssetsDir + path.sep)) {
    return res.status(403).json({ error: 'Access denied: Path traversal attempt detected' });
  }

  // Enforce permitted file extensions
  const ext = path.extname(target).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.wav', '.mp3', '.m4a', '.aac', '.svg', '.json'];
  if (!allowedExtensions.includes(ext)) {
    return res.status(403).json({ error: 'Disallowed asset file type' });
  }

  // Deterministic asynchronous lookup (no substring or fuzzy matching)
  let fileExists = false;
  try {
    const stat = await fs.promises.stat(target);
    fileExists = stat.isFile();
  } catch {
    fileExists = false;
  }

  // S3 exact fallback if not found locally
  if (!fileExists) {
    if (isS3Configured()) {
      try {
        const s3Obj = await getS3ObjectStream(`assets/${safeName}`);
        if (s3Obj && s3Obj.stream) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', '*');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          if (s3Obj.contentType) res.setHeader('Content-Type', s3Obj.contentType);
          if (s3Obj.contentLength) res.setHeader('Content-Length', s3Obj.contentLength);
          return s3Obj.stream.pipe(res);
        }
      } catch (s3StreamErr) {
        console.warn('[S3 Stream Fallback Error]:', s3StreamErr);
      }
    }
    return res.status(404).json({ error: 'Asset not found.' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
  else if (ext === '.png') res.setHeader('Content-Type', 'image/png');
  else if (ext === '.webp') res.setHeader('Content-Type', 'image/webp');
  else if (ext === '.mp4') res.setHeader('Content-Type', 'video/mp4');
  else if (ext === '.wav') res.setHeader('Content-Type', 'audio/wav');
  else if (ext === '.mp3') res.setHeader('Content-Type', 'audio/mpeg');
  else if (ext === '.m4a') res.setHeader('Content-Type', 'audio/mp4');
  else if (ext === '.aac') res.setHeader('Content-Type', 'audio/aac');
  else if (ext === '.svg') res.setHeader('Content-Type', 'image/svg+xml');
  else if (ext === '.json') res.setHeader('Content-Type', 'application/json');

  return res.sendFile(target);
});

// 4. Authenticated Webhook endpoint for Cloud Run and cloud render progress
router.post(['/webhook/:jobId', '/cloud-render/webhook/:jobId'], async (req, res) => {
  const jobId = (Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId parameter' });
  }

  const job = await getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Validate expected provider
  if (job.provider !== 'gcp-cloudrun' && job.provider !== 'aws-lambda') {
    return res.status(400).json({ error: 'Unexpected provider for webhook callback' });
  }

  // Webhook credential extraction
  const headerSecret = req.headers['x-webhook-secret'] as string | undefined;
  const authHeader = req.headers['authorization'];
  const bearerSecret = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const querySecret = (req.query.secret || req.query.token) as string | undefined;
  const providedSecret = headerSecret || bearerSecret || querySecret;

  const envSecret = process.env.CLOUD_RENDER_WEBHOOK_SECRET;
  const isJobSecretValid = job.webhookSecret ? safeCompareSecret(providedSecret, job.webhookSecret) : false;
  const isEnvSecretValid = envSecret ? safeCompareSecret(providedSecret, envSecret) : false;

  if (!providedSecret || (!isJobSecretValid && !isEnvSecretValid)) {
    console.warn(`[Cloud Render Webhook] Rejected unauthorized callback for jobId=${jobId}`);
    return res.status(401).json({ error: 'Invalid or missing webhook credentials' });
  }

  // Enforce legal state transitions & idempotency:
  // A late callback must not change a cancelled, deleted, or completed job back into a running state.
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return res.status(200).json({ status: job.status, idempotent: true, message: 'Job already in terminal state' });
  }

  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Malformed callback payload: expected JSON object' });
  }

  const body = req.body;

  // Validate job ID match if present in body
  if (body.jobId && body.jobId !== jobId) {
    return res.status(400).json({ error: 'Payload jobId does not match callback target' });
  }

  if (body.type === 'crash' || body.error) {
    job.status = 'failed';
    job.error = typeof body.error === 'string' ? body.error.slice(0, 1000) : 'Cloud render worker reported an error.';
    if (job.provider === 'aws-lambda') {
      releaseAwsConcurrency(job.id);
    }
  } else if (body.type === 'success' || body.done) {
    job.status = 'done';
    job.progress = 100;

    // Validate and enforce server-controlled output object keys, buckets, and render IDs
    if (body.outputKey && typeof body.outputKey === 'string') {
      if (isJobSpecificOutputKey(body.outputKey, jobId, job.renderId)) {
        job.outputKey = body.outputKey.trim();
      } else {
        console.warn(`[Cloud Render Webhook] Rejected unvalidated outputKey for jobId=${job.id}: ${body.outputKey}`);
        job.outputKey = `renders/${job.id}.mp4`;
      }
    } else {
      job.outputKey = `renders/${job.id}.mp4`;
    }

    if ((body.outputBucket || body.bucketName) && typeof (body.outputBucket || body.bucketName) === 'string') {
      const rawBucket = String(body.outputBucket || body.bucketName).trim();
      if (isValidRenderBucket(rawBucket, job.provider)) {
        job.outputBucket = rawBucket;
      } else {
        console.warn(`[Cloud Render Webhook] Rejected unvalidated outputBucket for jobId=${job.id}: ${rawBucket}`);
        if (job.provider === 'aws-lambda') job.outputBucket = getAwsConfig().bucketName;
        if (job.provider === 'gcp-cloudrun') job.outputBucket = getGcpConfig().mediaBucket || getGcpConfig().bucketName;
      }
    } else {
      if (job.provider === 'aws-lambda') job.outputBucket = getAwsConfig().bucketName;
      if (job.provider === 'gcp-cloudrun') job.outputBucket = getGcpConfig().mediaBucket || getGcpConfig().bucketName;
    }

    if (body.renderId && typeof body.renderId === 'string') {
      if (isValidRenderId(body.renderId)) {
        job.renderId = body.renderId.trim();
      } else {
        console.warn(`[Cloud Render Webhook] Rejected malformed renderId for jobId=${job.id}: ${body.renderId}`);
      }
    }

    // Stop trusting arbitrary callback URLs: validate against explicit provider storage allowlist
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : (typeof body.outputFile === 'string' ? body.outputFile.trim() : undefined);
    if (rawUrl) {
      if (isValidTrustedStorageOutputUrl(rawUrl, job.provider)) {
        job.outputUrl = rawUrl;
      } else {
        console.warn(`[Cloud Render Webhook] Untrusted outputUrl rejected for jobId=${job.id}: ${rawUrl}`);
        // Fallback to trusted configured storage location
        if (job.provider === 'gcp-cloudrun') {
          const gcpCfg = getGcpConfig();
          const allowedBucket = (gcpCfg.mediaBucket || gcpCfg.bucketName || '').trim();
          if (allowedBucket) {
            job.outputUrl = `https://storage.googleapis.com/${allowedBucket}/renders/${job.id}/out.mp4`;
          }
        } else if (job.provider === 'aws-lambda') {
          const awsCfg = getAwsConfig();
          const allowedBucket = (awsCfg.bucketName || '').trim();
          if (allowedBucket) {
            job.outputUrl = `https://${allowedBucket}.s3.${awsCfg.region || 'us-east-1'}.amazonaws.com/renders/${job.id}/out.mp4`;
          }
        }
      }
    }

    if (job.provider === 'aws-lambda') {
      releaseAwsConcurrency(job.id);
    }

    // Server-authoritative render usage accounting
    await chargeJobRenderUsage(job);
  } else {
    const p = typeof body.overallProgress === 'number' ? body.overallProgress : (typeof body.progress === 'number' ? body.progress : 0);
    job.progress = Math.max(2, Math.min(99, Math.round(p <= 1 ? p * 100 : p)));
  }

  job.updatedAt = Date.now();
  await setJob(jobId, job);
  return res.status(200).json({ status: job.status, progress: job.progress });
});

// 5. Dispatch render job
router.post(['/dispatch', '/cloud-render/dispatch'], async (req, res) => {
  try {
    let requestData = req.body || {};
    if (requestData?.payloadId && typeof requestData.payloadId === 'string') {
      const safePayloadId = path.basename(requestData.payloadId);
      const target = path.join(RENDER_OUTPUT_DIR, `${safePayloadId}.json`);
      if (fs.existsSync(target)) {
        try {
          const raw = fs.readFileSync(target, 'utf8');
          requestData = JSON.parse(raw);
          // Clean up payload file after parsing
          try { fs.unlinkSync(target); } catch {}
        } catch (e: any) {
          console.warn('[Dispatch Payload Load Warning]:', e);
        }
      }
    }

    const principal = await resolveVerifiedPrincipal(req);
    const effectiveUserId = principal ? principal.uid : 'anonymous';

    const {
      title = 'Untitled Storyboard',
      inputProps,
      fps = 30,
      resolution = '1080p',
      durationInFrames = 300,
      aspectRatio = '16:9',
      totalDurationSec = 10,
      forceInMemory = false,
      provider = 'auto'
    } = requestData;

    const jobId = `cr_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const awsCfg = getAwsConfig();
    const gcpCfg = getGcpConfig();

    const standardInputProps = {
      ...inputProps,
      title,
      totalDurationSec,
      fps,
      aspectRatio: inputProps?.aspectRatio || aspectRatio,
    };

    // --- MODE 1: EXPLICIT HEADLESS / IN-MEMORY QUEUE ---
    if (provider === 'headless' || provider === 'in-memory' || forceInMemory) {
      const chromePath = findChromeExecutable();
      if (!chromePath) {
        return res.status(400).json({
          error: 'Headless Server rendering requires Google Chrome / Chromium installed on the server. Please select AWS Lambda or Google Cloud Run in export settings, or use the in-browser Canvas export.'
        });
      }

      console.log(`[Cloud Render] Enqueueing Job ${jobId} in Headless Server FIFO Queue (2x Quota)...`);
      const job: CloudJob = {
        id: jobId,
        userId: effectiveUserId,
        title,
        status: 'queued',
        progress: 0,
        provider: 'in-memory',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        inMemoryOptions: { inputProps: standardInputProps, fps, resolution, durationInFrames }
      };

      await setJob(jobId, job);
      renderQueue.push(jobId);
      processRenderQueue();

      return res.json({
        success: true,
        jobId,
        status: 'queued',
        provider: 'headless',
        queuePosition: renderQueue.indexOf(jobId) + 1
      });
    }

    // --- MODE 2: EXPLICIT GCP CLOUD RUN OR AUTO WHEN AWS IS NOT CONFIGURED ---
    if (provider === 'gcp' || provider === 'gcp-cloudrun' || (provider === 'auto' && !awsCfg.configured && gcpCfg.configured)) {
      if (!gcpCfg.configured && (provider === 'gcp' || provider === 'gcp-cloudrun')) {
        return res.status(400).json({
          error: 'Google Cloud Run is not configured. Please set REMOTION_GCP_SERVICE_NAME and REMOTION_GCP_SERVE_URL in your environment, or choose AWS Lambda or Headless Server rendering.'
        });
      }

      console.log(`[Cloud Render] Dispatching Job ${jobId} to GCP Cloud Run...`);
      const host = req.headers.host || '127.0.0.1:3000';
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const webhookSecret = randomBytes(24).toString('hex');
      const webhookUrl = `${proto}://${host}/api/cloud-render/webhook/${jobId}?secret=${webhookSecret}`;

      const job: CloudJob = {
        id: jobId,
        userId: effectiveUserId,
        title,
        status: 'rendering',
        progress: 2,
        provider: 'gcp-cloudrun',
        webhookSecret,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await setJob(jobId, job);

      // Fire and Forget GCP Render
      importCloudRun().then(async ({ renderMediaOnCloudrun }) => {
        let effectiveInputProps: any = standardInputProps;
        let totalFrames = Math.max(1, Math.round((Number(standardInputProps?.totalDurationSec) || 1) * (Number(standardInputProps?.fps) || 30)));

        try {
          const cloudProps = await resolveLocalAssetsForCloud(standardInputProps);
          const cloudClips = Array.isArray(cloudProps?.clips) ? cloudProps.clips : [];
          const maxClipEnd = cloudClips.reduce((max: number, clip: any) => {
            const start = Number(clip?.startTime) || 0;
            const end = Number(clip?.endTime);
            const clipEnd = Number.isFinite(end) && end > 0 ? end : start + (Number(clip?.duration) || 0);
            return Math.max(max, clipEnd);
          }, 0);

          const effectiveTotalDurationSec = Math.max(
            Number(cloudProps?.totalDurationSec) || 0,
            maxClipEnd,
            0.1
          );

          effectiveInputProps = {
            ...cloudProps,
            totalDurationSec: effectiveTotalDurationSec,
          };
          totalFrames = Math.max(1, Math.round(effectiveTotalDurationSec * (Number(effectiveInputProps.fps) || 30)));

          console.log('[GCP Dispatch] Timeline validation:', {
            clipCount: cloudClips.length,
            maxClipEnd,
            declaredDuration: cloudProps?.totalDurationSec,
            effectiveDuration: effectiveTotalDurationSec,
          });

          const targetComposition = await resolveCloudComposition(gcpCfg.serveUrl);
          console.log(`[GCP Dispatch] Target composition for render: ${targetComposition}`);

          setupGoogleApplicationCredentials();

          const result: any = await renderMediaOnCloudrun({
            serviceName: gcpCfg.serviceName!,
            region: gcpCfg.region as any,
            serveUrl: gcpCfg.serveUrl!,
            forceBucketName: gcpCfg.mediaBucket || gcpCfg.bucketName,
            composition: targetComposition,
            inputProps: effectiveInputProps,
            codec: 'h264',
            privacy: 'no-acl',
            updateRenderProgress: (progress: number, hasError: boolean) => {
              if (!hasError) {
                job.progress = Math.min(99, Math.max(job.progress, Math.round(progress * 100)));
                job.updatedAt = Date.now();
                setJob(jobId, job).catch(() => {});
              }
            }
          });

          if (result.type === 'success' || result.url || result.publicUrl || result.cloudStorageUri) {
            job.status = 'done';
            job.progress = 100;
            const outputUrl = result.url || result.publicUrl ||
              (result.cloudStorageUri ? result.cloudStorageUri.replace(/^gs:\/\//, 'https://storage.googleapis.com/') : null) ||
              (result.bucketName && result.renderId ? `https://storage.googleapis.com/${result.bucketName}/renders/${result.renderId}/out.mp4` : null);
            job.outputUrl = outputUrl;
          } else {
            job.status = 'failed';
            job.error = result.message || 'GCP Parallel render crashed.';
          }
          job.updatedAt = Date.now();
          await setJob(jobId, job);
        } catch (err: any) {
          const errMsg = err?.message || String(err);

          // GCP Uniform Bucket-Level Access constraint handling:
          // Remotion Cloud Run's prebuilt container attempts to set legacy ACLs (predefinedAcl) on upload.
          // In projects with UBLA enforced by GCP org policy, we transparently render with the server engine
          // and upload to GCS via our native UBLA-compliant uploadFileToGcs so the render finishes 100% successfully.
          if (errMsg.includes('uniform bucket-level access') || errMsg.includes('legacy ACL') || errMsg.includes('uniform-bucket-level-access')) {
            console.warn(`[GCP Render Notice] Cloud Run worker hit Uniform Bucket-Level Access constraint. Seamlessly finalizing render with in-memory worker...`);
            job.status = 'rendering';
            job.progress = 60;
            job.updatedAt = Date.now();
            await setJob(jobId, job);

            try {
              const outPath = path.join(RENDER_OUTPUT_DIR, `${jobId}.mp4`);
              const port = process.env.PORT || 3000;
              const appBaseUrl = `http://127.0.0.1:${port}`;

              const { renderCloudVideoWithRemotionCanvas } = await import('../remotionCanvasRenderWorker');
              await renderCloudVideoWithRemotionCanvas({
                inputProps: effectiveInputProps,
                fps: Number(effectiveInputProps.fps) || 30,
                resolution: (effectiveInputProps.resolution || '1080p') as any,
                durationInFrames: totalFrames,
                outputFilePath: outPath,
                appBaseUrl,
                onProgress: (p: number) => {
                  const pct = p <= 1 ? p * 100 : p;
                  job.progress = Math.max(60, Math.min(99, Math.round(60 + pct * 0.39)));
                  job.updatedAt = Date.now();
                  setJob(jobId, job).catch(() => {});
                },
              }, REMOTION_ENTRY);

              let finalVideoUrl = `/api/cloud-render/download/${jobId}`;
              if (isGcsConfigured() && fs.existsSync(outPath)) {
                try {
                  const gcsRes = await uploadFileToGcs(`renders/${jobId}.mp4`, outPath, 'video/mp4');
                  if (gcsRes?.url) {
                    finalVideoUrl = gcsRes.url;
                  }
                } catch (gcsUpErr) {
                  console.warn('[GCP Render Fallback] GCS upload notice:', gcsUpErr);
                }
              }

              job.status = 'done';
              job.progress = 100;
              job.outputFilePath = outPath;
              job.outputUrl = finalVideoUrl;
              job.updatedAt = Date.now();
              await setJob(jobId, job);
              return;
            } catch (fallbackErr: any) {
              console.error('[GCP Render Fallback ERROR]:', fallbackErr);
            }
          }

          job.status = 'failed';
          if (errMsg.includes('client_email')) {
            job.error = `GCP Credentials Error: The supplied Google Cloud credentials are missing the 'client_email' field. Google Cloud Run requires a Service Account Key JSON (IAM & Admin > Service Accounts > Keys), not an OAuth Client ID or Web config.`;
          } else {
            job.error = `GCP Error: ${errMsg}`;
          }
          job.updatedAt = Date.now();
          await setJob(jobId, job);
        }
      }).catch(async (err) => {
        job.status = 'failed';
        job.error = `Failed to load Remotion Cloud Run package: ${err?.message}`;
        job.updatedAt = Date.now();
        await setJob(jobId, job);
      });

      return res.json({ success: true, jobId, status: 'rendering', provider: 'gcp-cloudrun' });
    }

    // --- MODE 3: EXPLICIT OR AUTO AWS LAMBDA ---
    if (provider === 'aws' || provider === 'aws-lambda' || (provider === 'auto' && awsCfg.configured)) {
      if (!awsCfg.configured && (provider === 'aws' || provider === 'aws-lambda')) {
        return res.status(400).json({
          error: 'AWS Lambda is not configured. Please set REMOTION_AWS_ACCESS_KEY_ID, REMOTION_AWS_SECRET_ACCESS_KEY, and REMOTION_SERVE_URL in your environment, or choose Google Cloud Run or Headless Server rendering.'
        });
      }

      // 1. Resolve cloud assets & rasterize HyperFrames FIRST before queuing
      console.log(`[AWS Preflight] Preparing assets & validating duration for Job ${jobId}...`);
      const cloudProps = await resolveLocalAssetsForCloud(standardInputProps, { skipGcs: true });
      const localPort = process.env.PORT || '3000';
      const localAppBaseUrl = `http://127.0.0.1:${localPort}`;
      const effectiveInputProps = process.env.HYPERFRAME_SERVER_RASTER === '1'
        ? await prepareHyperFramesForCloud(cloudProps, localAppBaseUrl)
        : cloudProps;

      const cloudClips = Array.isArray(effectiveInputProps?.clips) ? effectiveInputProps.clips : [];
      const maxClipEnd = cloudClips.reduce((max: number, clip: any) => {
        const start = Number(clip?.startTime) || 0;
        const end = Number(clip?.endTime);
        const clipEnd = Number.isFinite(end) && end > 0 ? end : start + (Number(clip?.duration) || 0);
        return Math.max(max, clipEnd);
      }, 0);

      const effectiveTotalDurationSec = Math.max(
        Number(effectiveInputProps?.totalDurationSec) || 0,
        maxClipEnd,
        0.1
      );

      // 2. Validate AWS Lambda Duration Limit (e.g. max 75 minutes)
      const maxAwsMinutes = getMaxAwsDurationMinutes();
      const maxAwsSeconds = maxAwsMinutes * 60;
      if (effectiveTotalDurationSec > maxAwsSeconds) {
        return res.status(400).json({
          error: `This video is ${(effectiveTotalDurationSec / 60).toFixed(1)} minutes long. AWS Lambda export is limited to ${maxAwsMinutes} minutes. Please use Google Cloud Run for longer videos.`
        });
      }

      const targetComposition = await resolveCloudComposition(awsCfg.serveUrl);
      const targetFps = Number(effectiveInputProps.fps) || Number(fps) || 30;
      const totalFrames = Math.max(1, Math.ceil(effectiveTotalDurationSec * targetFps));
      effectiveInputProps.durationInFrames = totalFrames;
      effectiveInputProps.fps = targetFps;
      effectiveInputProps.totalDurationSec = effectiveTotalDurationSec;

      function findUnreachable(v: any, out: string[] = []): string[] {
        if (typeof v === 'string') {
          if (/\/api\/cloud-render\/assets\/|^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)|^blob:/i.test(v)) out.push(v.slice(0, 120));
        } else if (Array.isArray(v)) v.forEach(x => findUnreachable(x, out));
        else if (v && typeof v === 'object') Object.values(v).forEach(x => findUnreachable(x, out));
        return out;
      }
      const bad = findUnreachable(effectiveInputProps);
      if (bad.length) {
        return res.status(400).json({ error: `Assets not reachable by AWS Lambda (S3 upload failed or not configured): ${bad.slice(0, 3).join(', ')}` });
      }

      // 3. Enqueue via the Authoritative AWS Render Governor
      const enqueueResult = await enqueueAwsRender({
        jobId,
        userId: effectiveUserId,
        title,
        inputProps: effectiveInputProps,
        composition: targetComposition || 'CanvasStoryboardVideo',
        fps: targetFps,
        totalFrames,
        functionName: awsCfg.functionName!,
        region: awsCfg.region,
        serveUrl: awsCfg.serveUrl!,
      });

      return res.json({
        success: true,
        jobId,
        status: enqueueResult.status,
        provider: 'aws-lambda',
        queuePosition: enqueueResult.queuePosition,
      });
    }

    // --- FALLBACK: IN-MEMORY FIFO QUEUE ---
    const chromePath = findChromeExecutable();
    if (!chromePath) {
      return res.status(400).json({
        error: 'No cloud rendering backend is configured on this server, and local Headless Chromium is not installed. Please configure AWS Lambda (REMOTION_AWS_ACCESS_KEY_ID, REMOTION_AWS_SECRET_ACCESS_KEY, REMOTION_SERVE_URL, REMOTION_FUNCTION_NAME) or Google Cloud Run, or use the in-browser Canvas export.'
      });
    }

    console.log(`[Cloud Render] Enqueueing Job ${jobId} in Fallback Headless FIFO Queue...`);
    const job: CloudJob = {
      id: jobId,
      userId: effectiveUserId,
      title,
      status: 'queued',
      progress: 0,
      provider: 'in-memory',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      inMemoryOptions: { inputProps: standardInputProps, fps, resolution, durationInFrames }
    };

    await setJob(jobId, job);
    renderQueue.push(jobId);
    processRenderQueue();

    return res.json({
      success: true,
      jobId,
      status: 'queued',
      provider: 'headless',
      queuePosition: renderQueue.indexOf(jobId) + 1
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to dispatch render job.' });
  }
});

// 6. Poll job status
router.get(['/status/:jobId', '/cloud-render/status/:jobId'], async (req, res) => {
  const jobId = (Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId) as string;
  const job = jobId ? await getJob(jobId) : undefined;
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const authorized = await authorizeJobAccess(req, job);
  if (!authorized) {
    const principal = await resolveVerifiedPrincipal(req);
    if (!principal) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(404).json({ error: 'Job not found.' });
  }

  if (job.provider === 'aws-lambda' && job.status === 'rendering') {
    if (!job.renderId) {
      return res.json({
        id: job.id,
        userId: job.userId,
        title: job.title,
        status: 'rendering',
        progress: job.progress || 1,
        provider: 'aws-lambda',
        phase: 'initializing'
      });
    }
    await refreshAwsJob(job);
  }

  const latestJob = (await getJob(jobId)) || job;
  const queuePosition = latestJob.status === 'queued'
    ? (latestJob.provider === 'aws-lambda' ? getAwsQueuePosition(latestJob.id) : (renderQueue.indexOf(latestJob.id) + 1))
    : undefined;

  return res.json({
    id: latestJob.id,
    status: latestJob.status,
    progress: latestJob.progress,
    provider: latestJob.provider,
    outputUrl: latestJob.outputUrl,
    error: latestJob.error,
    queuePosition,
    updatedAt: latestJob.updatedAt,
  });
});

/**
 * Executes a streaming GET request by resolving DNS once, verifying destination IP safety,
 * enforcing provider storage allowlists, and pinning the HTTPS connection directly to the
 * validated IP address with TLS SNI. Eliminates TOCTOU DNS-rebinding gaps and blocks 3xx redirects.
 */
export async function fetchPinnedIpStream(
  urlStr: string,
  provider?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; stream: http.IncomingMessage }> {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS remote URLs are permitted');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Non-standard ports are prohibited');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    throw new Error('Loopback and internal hostnames are prohibited');
  }

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname === '100.100.100.200' ||
    hostname === 'fd00:ec2::254'
  ) {
    throw new Error('Cloud metadata endpoints are strictly prohibited');
  }

  // Enforce provider storage allowlist (fails closed if storage bucket configuration is missing)
  if (provider && !isValidTrustedStorageOutputUrl(urlStr, provider)) {
    throw new Error('Remote URL does not match trusted storage destination for provider');
  }

  // Resolve IP once and validate against private IP address ranges
  let resolvedIp = hostname;
  if (!net.isIP(hostname)) {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) {
      throw new Error('Host resolution failed');
    }
    for (const addr of addresses) {
      if (isPrivateAddress(addr.address)) {
        throw new Error(`Forbidden destination IP address (${addr.address})`);
      }
    }
    resolvedIp = addresses[0].address;
  } else {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Forbidden destination IP address (${hostname})`);
    }
  }

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: resolvedIp, // Connect directly to the validated IP address!
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Host': parsed.hostname, // Virtual host header
        'User-Agent': 'CloudRender-MediaStreamer/1.0',
        'Accept': 'video/mp4, video/*, */*'
      },
      servername: parsed.hostname, // TLS SNI for certificate verification
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      // Disallow 3xx redirects to prevent redirect bypass
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        req.destroy();
        return reject(new Error(`Redirects are disabled for cloud storage streams (HTTP ${res.statusCode})`));
      }
      resolve({ status: res.statusCode || 200, headers: res.headers, stream: res });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Connection timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

// Helper to securely stream remote cloud renders directly with SSRF and IP-pinning protections
export async function streamSafeRemoteVideo(
  remoteUrlStr: string,
  res: express.Response,
  filename: string,
  provider?: string
): Promise<void> {
  const { status, headers, stream } = await fetchPinnedIpStream(remoteUrlStr, provider);

  if (status < 200 || status >= 300) {
    throw new Error(`Remote render download failed: HTTP ${status}`);
  }

  const contentType = (headers['content-type'] as string) || 'video/mp4';
  const contentLength = headers['content-length'] as string | undefined;
  const MAX_ALLOWED_SIZE = 5 * 1024 * 1024 * 1024; // 5 GB

  if (contentLength) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > MAX_ALLOWED_SIZE) {
      throw new Error(`Remote video exceeds maximum permitted size (${len} bytes)`);
    }
  }

  res.status(200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  let totalBytes = 0;
  return new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_ALLOWED_SIZE) {
        stream.destroy(new Error('Stream size exceeded maximum allowed limit'));
      }
    });

    stream.pipe(res);
    stream.on('end', () => resolve());
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).send('Error streaming download file');
      }
      reject(err);
    });
  });
}

// 7. Download finished video (Forces direct file download via attachment headers)
router.get(['/download/:jobId', '/cloud-render/download/:jobId'], async (req, res) => {
  const jobId = (Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId) as string;
  const job = jobId ? await getJob(jobId) : undefined;
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const authorized = await authorizeJobAccess(req, job);
  if (!authorized) {
    const principal = await resolveVerifiedPrincipal(req);
    if (!principal) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(404).json({ error: 'Job not found.' });
  }

  const safeBaseName = String(job.title || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 150);
  const safeFilename = safeBaseName.endsWith('.mp4') ? safeBaseName : `${safeBaseName}.mp4`;

  // Prefer local file if present
  if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return fs.createReadStream(job.outputFilePath).pipe(res);
  }

  // Prefer direct S3 SDK streaming if configured
  if (job.outputKey && isS3Configured()) {
    try {
      const s3Obj = await getS3ObjectStream(job.outputKey);
      if (s3Obj && s3Obj.stream) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        if (s3Obj.contentLength) res.setHeader('Content-Length', s3Obj.contentLength);
        return s3Obj.stream.pipe(res);
      }
    } catch (s3Err) {
      console.warn('[S3 Direct SDK Download Error]:', s3Err);
    }
  }

  // For AWS Lambda completed renders: check authentic outputBucket and outputKey with presigned URL
  if (job.provider === 'aws-lambda' && job.status === 'done') {
    if (job.outputBucket && job.outputKey && job.region) {
      const signed = await getS3PresignedUrlForBucket(
        job.outputBucket,
        job.region,
        job.outputKey,
        900
      );

      if (signed) {
        try {
          return await streamSafeRemoteVideo(signed, res, safeFilename, 'aws-lambda');
        } catch (streamErr) {
          console.error('[Cloud Render Download] Remote S3 signed stream failed:', streamErr);
          return res.status(502).json({ error: 'Unable to stream the completed AWS render.' });
        }
      }
    }

    if (job.outputUrl && isValidTrustedStorageOutputUrl(job.outputUrl, 'aws-lambda')) {
      try {
        return await streamSafeRemoteVideo(job.outputUrl, res, safeFilename, 'aws-lambda');
      } catch (streamErr) {
        console.error('[Cloud Render Download] Remote stream failed:', streamErr);
        return res.status(502).json({ error: 'Unable to download the completed cloud render.' });
      }
    }
  }

  // If remote S3/GCP URL exists, proxy stream it with strict validation
  if (job.outputUrl && isValidTrustedStorageOutputUrl(job.outputUrl, job.provider)) {
    try {
      return await streamSafeRemoteVideo(job.outputUrl, res, safeFilename, job.provider);
    } catch (streamErr) {
      console.error('[Cloud Render Download] Remote stream failed:', streamErr);
      return res.status(502).json({ error: 'Unable to download the completed cloud render.' });
    }
  }

  if (isS3Configured()) {
    try {
      const s3Obj = await getS3ObjectStream(`renders/${jobId}.mp4`);
      if (s3Obj && s3Obj.stream) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        if (s3Obj.contentLength) res.setHeader('Content-Length', s3Obj.contentLength);
        return s3Obj.stream.pipe(res);
      }
    } catch (s3Err) {
      console.warn('[S3 Download Stream Error]:', s3Err);
    }
  }

  return res.status(404).json({ error: 'Video file missing.' });
});

// 7b. Secure stream download proxy (Derives download URL strictly from authentic CloudJob)
router.get(['/stream-download', '/cloud-render/stream-download'], async (req, res) => {
  const jobId = (Array.isArray(req.query.jobId) ? req.query.jobId[0] : req.query.jobId) as string;
  if (!jobId) {
    return res.status(400).send('Missing jobId');
  }

  const job = await getJob(jobId);
  if (!job) {
    return res.status(404).send('Job not found');
  }

  const authorized = await authorizeJobAccess(req, job);
  if (!authorized) {
    const principal = await resolveVerifiedPrincipal(req);
    if (!principal) {
      return res.status(401).send('Authentication required');
    }
    return res.status(404).send('Job not found');
  }

  if (job.status !== 'done') {
    return res.status(409).send('Render is not complete');
  }

  const safeBaseName = String(job.title || 'video')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .slice(0, 150);
  const safeFilename = safeBaseName.endsWith('.mp4') ? safeBaseName : `${safeBaseName}.mp4`;

  // Prefer local file if present
  if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    return fs.createReadStream(job.outputFilePath).pipe(res);
  }

  // Prefer direct S3 SDK streaming if configured
  if (job.outputKey && isS3Configured()) {
    try {
      const s3Obj = await getS3ObjectStream(job.outputKey);
      if (s3Obj && s3Obj.stream) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        if (s3Obj.contentLength) res.setHeader('Content-Length', s3Obj.contentLength);
        return s3Obj.stream.pipe(res);
      }
    } catch (s3Err) {
      console.warn('[S3 Direct SDK Stream Error]:', s3Err);
    }
  }

  let targetUrl = job.outputUrl;
  if (job.provider === 'aws-lambda' && job.outputBucket && job.outputKey && job.region) {
    const signed = await getS3PresignedUrlForBucket(job.outputBucket, job.region, job.outputKey, 900);
    if (signed) targetUrl = signed;
  }

  if (!targetUrl || !isValidTrustedStorageOutputUrl(targetUrl, job.provider)) {
    return res.status(404).send('Render output not available or invalid storage destination');
  }

  try {
    return await streamSafeRemoteVideo(targetUrl, res, safeFilename, job.provider);
  } catch (err: any) {
    console.error('[Stream Download Proxy Error]:', err);
    return res.status(500).send('Error streaming download file');
  }
});

// 8. List user jobs
router.get(['/jobs', '/cloud-render/jobs'], async (req, res) => {
  const principal = await resolveVerifiedPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const targetUserId = (principal.isAdmin && req.query.userId) ? String(req.query.userId) : principal.uid;
  const jobs = (await listJobsForUser(targetUserId)).slice(0, 30);
  return res.json({ jobs });
});

// 9. Delete / Cancel job
router.delete(['/jobs/:jobId', '/cloud-render/jobs/:jobId'], async (req, res) => {
  const jobId = (Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId) as string;
  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId parameter' });
  }

  const job = await getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const authorized = await authorizeJobAccess(req, job);
  if (!authorized) {
    const principal = await resolveVerifiedPrincipal(req);
    if (!principal) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(404).json({ error: 'Job not found' });
  }

  const qIdx = renderQueue.indexOf(jobId);
  if (qIdx !== -1) {
    renderQueue.splice(qIdx, 1);
  }
  dequeueAwsJob(jobId);

  // If job is actively running or dispatching on AWS Lambda, mark it cancelled so it is tracked
  // until termination rather than prematurely freeing concurrency while AWS is still executing.
  if (job.status === 'rendering' || job.status === 'dispatching') {
    job.status = 'cancelled';
    job.updatedAt = Date.now();
    await setJob(jobId, job);
  } else {
    if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
      try {
        fs.unlinkSync(job.outputFilePath);
      } catch (e) {}
    }
    await deleteJob(jobId);
  }

  return res.json({ success: true, deleted: jobId });
});

// 10. Clear all jobs for user
router.delete(['/jobs', '/cloud-render/jobs'], async (req, res) => {
  const principal = await resolveVerifiedPrincipal(req);
  if (!principal) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const targetUserId = principal.uid;
  let deletedCount = 0;
  const allJobs = await listJobsForUser(targetUserId, 10000);
  for (const job of allJobs) {
    const jobId = job.id;
    const qIdx = renderQueue.indexOf(jobId);
    if (qIdx !== -1) {
      renderQueue.splice(qIdx, 1);
    }
    dequeueAwsJob(jobId);

    if (job.status === 'rendering' || job.status === 'dispatching') {
      job.status = 'cancelled';
      job.updatedAt = Date.now();
      await setJob(jobId, job);
    } else {
      if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
        try {
          fs.unlinkSync(job.outputFilePath);
        } catch (e) {}
      }
      await deleteJob(jobId);
    }
    deletedCount++;
  }

  void dispatchNextAwsJobs();
  return res.json({ success: true, count: deletedCount });
});

export default router;
