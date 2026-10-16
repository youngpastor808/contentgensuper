/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

let s3ClientInstance: S3Client | null = null;
let cachedConfig: S3Credentials | null = null;

export function extractBucketFromServeUrl(urlStr?: string): { bucket: string; region?: string } {
  if (!urlStr || typeof urlStr !== 'string') return { bucket: '' };
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname; // e.g. remotionlambda-useast1-mfleks0w04.s3.us-east-1.amazonaws.com or remotionlambda-...s3.amazonaws.com

    // Pattern 1: <bucket>.s3.<region>.amazonaws.com or <bucket>.s3.amazonaws.com
    const s3Match = host.match(/^([a-z0-9.-]+)\.s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/i);
    if (s3Match) {
      return {
        bucket: s3Match[1],
        region: s3Match[2] || undefined,
      };
    }

    // Pattern 2: s3.<region>.amazonaws.com/<bucket>/... or s3.amazonaws.com/<bucket>/...
    if (host.startsWith('s3.') || host === 's3.amazonaws.com') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const regionMatch = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i);
        return {
          bucket: parts[0],
          region: regionMatch ? regionMatch[1] : undefined,
        };
      }
    }
  } catch {}
  return { bucket: '' };
}

export function getS3Config(): S3Credentials | null {
  const accessKeyId =
    process.env.AWS_ACCESS_KEY_ID?.trim() ||
    process.env.REMOTION_AWS_ACCESS_KEY_ID?.trim();

  const secretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY?.trim() ||
    process.env.REMOTION_AWS_SECRET_ACCESS_KEY?.trim();

  let region =
    process.env.AWS_REGION?.trim() ||
    process.env.REMOTION_AWS_REGION?.trim();

  let bucket =
    process.env.AWS_S3_MEDIA_BUCKET?.trim() ||
    process.env.AWS_MEDIA_BUCKET?.trim() ||
    process.env.AWS_S3_BUCKET?.trim() ||
    process.env.S3_MEDIA_BUCKET?.trim() ||
    process.env.S3_BUCKET?.trim() ||
    process.env.AWS_STORAGE_BUCKET?.trim() ||
    process.env.MEDIA_BUCKET?.trim() ||
    process.env.REMOTION_AWS_BUCKET?.trim() ||
    process.env.REMOTION_BUCKET?.trim() ||
    '';

  const serveUrl = process.env.REMOTION_SERVE_URL?.trim() || process.env.REMOTION_AWS_SERVE_URL?.trim();
  if (!bucket && serveUrl) {
    const extracted = extractBucketFromServeUrl(serveUrl);
    if (extracted.bucket) {
      bucket = extracted.bucket;
      if (!region && extracted.region) {
        region = extracted.region;
      }
    }
  }

  if (!region) {
    region = 'us-east-1';
  }

  if (!accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    region,
    bucket,
  };
}

export function isS3Configured(): boolean {
  return getS3Config() !== null;
}

export function getS3Client(): { client: S3Client; config: S3Credentials } | null {
  const config = getS3Config();
  if (!config) return null;

  // Re-create client if config changed
  if (
    !s3ClientInstance ||
    !cachedConfig ||
    cachedConfig.accessKeyId !== config.accessKeyId ||
    cachedConfig.secretAccessKey !== config.secretAccessKey ||
    cachedConfig.region !== config.region ||
    cachedConfig.bucket !== config.bucket
  ) {
    cachedConfig = config;
    s3ClientInstance = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return { client: s3ClientInstance, config };
}

/**
 * Returns public HTTPS URL for an S3 object key.
 */
export function getS3Url(key: string, customBucket?: string, customRegion?: string): string {
  const config = getS3Config();
  const bucket = customBucket || config?.bucket || '';
  const region = customRegion || config?.region || 'us-east-1';
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  if (region === 'us-east-1') {
    return `https://${bucket}.s3.amazonaws.com/${cleanKey}`;
  }
  return `https://${bucket}.s3.${region}.amazonaws.com/${cleanKey}`;
}

/**
 * Generate a temporary presigned GET URL for an S3 object (safe for private buckets).
 */
export async function getS3PresignedUrl(
  key: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const s3 = getS3Client();
  if (!s3) return null;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  try {
    const command = new GetObjectCommand({
      Bucket: s3.config.bucket,
      Key: cleanKey,
    });
    return await getSignedUrl(s3.client, command, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.warn('[S3 Presigned URL Error]:', err);
    return null;
  }
}

/**
 * Upload a Buffer or file stream to S3.
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | fs.ReadStream,
  contentType?: string,
  options?: { generatePresigned?: boolean; expiresInSeconds?: number }
): Promise<{ url: string; signedUrl?: string; key: string } | null> {
  const s3 = getS3Client();
  if (!s3) return null;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  let inferredContentType = contentType;
  if (!inferredContentType) {
    const ext = path.extname(cleanKey).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') inferredContentType = 'image/jpeg';
    else if (ext === '.png') inferredContentType = 'image/png';
    else if (ext === '.webp') inferredContentType = 'image/webp';
    else if (ext === '.mp4') inferredContentType = 'video/mp4';
    else if (ext === '.wav') inferredContentType = 'audio/wav';
    else if (ext === '.mp3') inferredContentType = 'audio/mpeg';
    else inferredContentType = 'application/octet-stream';
  }

  const command = new PutObjectCommand({
    Bucket: s3.config.bucket,
    Key: cleanKey,
    Body: body,
    ContentType: inferredContentType,
  });

  await s3.client.send(command);

  let signedUrl: string | undefined;
  if (options?.generatePresigned !== false) {
    try {
      const presigned = await getS3PresignedUrl(cleanKey, options?.expiresInSeconds || 3600);
      if (presigned) signedUrl = presigned;
    } catch {}
  }

  return {
    key: cleanKey,
    url: getS3Url(cleanKey, s3.config.bucket, s3.config.region),
    signedUrl,
  };
}

/**
 * Upload a local file to S3 via streaming multipart upload.
 */
export async function uploadFileToS3(
  key: string,
  filePath: string,
  contentType?: string,
  options?: { generatePresigned?: boolean; expiresInSeconds?: number }
): Promise<{ url: string; signedUrl?: string; key: string } | null> {
  const s3 = getS3Client();
  if (!s3) return null;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  let inferredContentType = contentType;
  if (!inferredContentType) {
    const ext = path.extname(cleanKey).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') inferredContentType = 'image/jpeg';
    else if (ext === '.png') inferredContentType = 'image/png';
    else if (ext === '.webp') inferredContentType = 'image/webp';
    else if (ext === '.mp4') inferredContentType = 'video/mp4';
    else if (ext === '.wav') inferredContentType = 'audio/wav';
    else if (ext === '.mp3') inferredContentType = 'audio/mpeg';
    else inferredContentType = 'application/octet-stream';
  }

  const fileStream = fs.createReadStream(filePath);
  const uploader = new Upload({
    client: s3.client,
    params: {
      Bucket: s3.config.bucket,
      Key: cleanKey,
      Body: fileStream,
      ContentType: inferredContentType,
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
  });

  await uploader.done();

  // Verification: HeadObject to verify ContentLength on S3 matches local file
  try {
    const head = await s3.client.send(
      new HeadObjectCommand({
        Bucket: s3.config.bucket,
        Key: cleanKey,
      })
    );
    const localSize = fs.statSync(filePath).size;
    if (head.ContentLength !== undefined && head.ContentLength !== localSize) {
      console.warn(`[S3 Upload Warning] Size mismatch for ${cleanKey}: expected ${localSize}, got ${head.ContentLength}`);
    }
  } catch (headErr: any) {
    console.warn(`[S3 Upload HeadObject Verification Warning]:`, headErr?.message || headErr);
  }

  let signedUrl: string | undefined;
  if (options?.generatePresigned !== false) {
    try {
      const presigned = await getS3PresignedUrl(cleanKey, options?.expiresInSeconds || 86400);
      if (presigned) signedUrl = presigned;
    } catch {}
  }

  return {
    key: cleanKey,
    url: getS3Url(cleanKey, s3.config.bucket, s3.config.region),
    signedUrl,
  };
}

/**
 * Check if an asset key exists in S3.
 */
export async function checkS3ObjectExists(key: string): Promise<boolean> {
  const s3 = getS3Client();
  if (!s3) return false;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  try {
    const command = new HeadObjectCommand({
      Bucket: s3.config.bucket,
      Key: cleanKey,
    });
    await s3.client.send(command);
    return true;
  } catch (err: any) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    return false;
  }
}

/**
 * Get a readable stream for an S3 object.
 */
export async function getS3ObjectStream(
  key: string
): Promise<{ stream: Readable; contentType?: string; contentLength?: number } | null> {
  const s3 = getS3Client();
  if (!s3) return null;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  try {
    const command = new GetObjectCommand({
      Bucket: s3.config.bucket,
      Key: cleanKey,
    });
    const response = await s3.client.send(command);
    if (!response.Body) return null;

    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  } catch (err: any) {
    return null;
  }
}

/**
 * Delete an object from S3.
 */
export async function deleteS3Object(key: string): Promise<boolean> {
  const s3 = getS3Client();
  if (!s3) return false;

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;

  try {
    const command = new DeleteObjectCommand({
      Bucket: s3.config.bucket,
      Key: cleanKey,
    });
    await s3.client.send(command);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Generate a temporary presigned GET URL for an object in any specified S3 bucket.
 */
export async function getS3PresignedUrlForBucket(
  bucket: string,
  region: string,
  key: string,
  expiresInSeconds = 900
): Promise<string | null> {
  const config = getS3Config();

  if (!config) {
    return null;
  }

  const client =
    config.bucket === bucket &&
    config.region === region
      ? getS3Client()?.client
      : new S3Client({
          region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        });

  if (!client) {
    return null;
  }

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key.replace(/^\/+/, ''),
    });

    return await getSignedUrl(
      client,
      command,
      { expiresIn: expiresInSeconds }
    );
  } catch (error) {
    console.warn(
      '[S3 presign] Failed:',
      error
    );

    return null;
  }
}

