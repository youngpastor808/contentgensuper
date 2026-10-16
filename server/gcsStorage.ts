/**
 * Google Cloud Storage helper for uploading & serving media assets (clips, audio, rendered videos).
 */
import { Storage } from '@google-cloud/storage';
import fs from 'node:fs';
import path from 'node:path';

let cachedStorage: Storage | null = null;

export function getGcsConfig() {
  const bucket = (
    process.env.REMOTION_GCP_MEDIA_BUCKET ||
    process.env.GCS_MEDIA_BUCKET ||
    process.env.REMOTION_GCP_BUCKET ||
    process.env.GCP_STORAGE_BUCKET
  )?.trim();

  const projectId = (
    process.env.REMOTION_GCP_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'contentgenapp-507516'
  )?.trim();

  return {
    bucket: bucket || null,
    projectId,
    configured: Boolean(bucket),
  };
}

export function isGcsConfigured(): boolean {
  return getGcsConfig().configured;
}

export function getGcsClient(): Storage | null {
  if (cachedStorage) return cachedStorage;

  const { projectId } = getGcsConfig();

  // Try in-memory credentials if available
  let credentials: { client_email: string; private_key: string } | undefined = undefined;
  const rawJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
                  process.env.GCP_SERVICE_ACCOUNT_KEY ||
                  process.env.REMOTION_GCP_CREDENTIALS;

  if (rawJson) {
    try {
      const clean = rawJson.trim().replace(/^['"]|['"]$/g, '');
      credentials = JSON.parse(clean);
    } catch {}
  } else if (process.env.REMOTION_GCP_CLIENT_EMAIL && process.env.REMOTION_GCP_PRIVATE_KEY) {
    credentials = {
      client_email: process.env.REMOTION_GCP_CLIENT_EMAIL.trim(),
      private_key: process.env.REMOTION_GCP_PRIVATE_KEY.replace(/\\n/g, '\n').trim(),
    };
  }

  // Key file path check
  let keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFilename && (keyFilename.startsWith('{') || keyFilename.includes('"client_email"'))) {
    try {
      credentials = JSON.parse(keyFilename);
      keyFilename = undefined;
    } catch {}
  }

  try {
    cachedStorage = new Storage({
      projectId: projectId || undefined,
      credentials: credentials || undefined,
      keyFilename: (!credentials && keyFilename) ? keyFilename : undefined,
    });
    return cachedStorage;
  } catch (err) {
    console.warn('[GCS Storage] Failed to initialize Storage client:', err);
    return null;
  }
}

/**
 * Upload a local file to Google Cloud Storage.
 * Returns public URL or signed URL.
 */
export async function uploadFileToGcs(
  destinationPath: string,
  localFilePath: string,
  contentType?: string,
  options?: { makePublic?: boolean; expiresInSeconds?: number }
): Promise<{ url: string; signedUrl?: string; bucket: string; key: string } | null> {
  const storage = getGcsClient();
  const { bucket: bucketName } = getGcsConfig();
  if (!storage || !bucketName) return null;

  const bucket = storage.bucket(bucketName);
  const cleanKey = destinationPath.startsWith('/') ? destinationPath.slice(1) : destinationPath;
  const file = bucket.file(cleanKey);

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

  await bucket.upload(localFilePath, {
    destination: cleanKey,
    metadata: {
      contentType: inferredContentType,
      cacheControl: 'public, max-age=86400',
    },
  });

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${cleanKey}`;
  let signedUrl: string | undefined = undefined;

  try {
    const [signed] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + ((options?.expiresInSeconds || 86400) * 1000),
    });
    signedUrl = signed;
  } catch (signErr) {
    // If signing fails (e.g. requires service account token permission), fallback to public URL
  }

  return {
    url: publicUrl,
    signedUrl: signedUrl || publicUrl,
    bucket: bucketName,
    key: cleanKey,
  };
}

export async function checkGcsObjectExists(destinationPath: string): Promise<boolean> {
  const storage = getGcsClient();
  const { bucket: bucketName } = getGcsConfig();
  if (!storage || !bucketName) return false;

  try {
    const cleanKey = destinationPath.startsWith('/') ? destinationPath.slice(1) : destinationPath;
    const [exists] = await storage.bucket(bucketName).file(cleanKey).exists();
    return exists;
  } catch {
    return false;
  }
}
