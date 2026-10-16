/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { audioBufferToWavBlob } from '../utils-core';
import { presetToKeyframes } from '../utils';
import { extractTimelineAudioMixdown } from './audio';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import { assetStorage } from '../assetStorage';
import * as dom from '../dom';
import * as ui from '../ui';
import { isGuest, openLoginModal, currentUser, recordRenderMinutesUsageSecure, refundRenderMinutesSecure } from '../auth';
import { upsertStoredCloudRender } from './cloud-render-store';
import { initCloudRenderBackgroundTracker, activeForegroundJobIds } from './cloud-render-ui';
import { cloudRenderUrl, getCloudRenderAuthHeaders } from './cloud-render-api-base';
import { triggerDirectVideoDownload } from './cloud-render-download';
import { ensureDepth, depthToPngDataUrl } from '../parallax/depth';
import { mediaAspectOf } from '../pip-layout';
import { buildAudioReactivePayload } from './audio-reactive-payload';
import { validateBeforeExport } from '../timing/timeline-timing';


const ASSET_CACHE_STORAGE_KEY = 'contentgen_asset_upload_cache_v6';

// Clear legacy caches once on module evaluation
try {
    localStorage.removeItem('contentgen_asset_upload_cache_v5');
    localStorage.removeItem('contentgen_asset_upload_cache_v4');
    localStorage.removeItem('contentgen_asset_upload_cache_v3');
    localStorage.removeItem('contentgen_asset_upload_cache_v2');
    localStorage.removeItem('contentgen_asset_upload_cache_v1');
} catch {}

/**
 * Validates that an asset URL is accessible to rendering workers without embedding multi-megabyte payloads.
 * Server asset URLs (/api/cloud-render/assets/...) are always valid because the server handles/resolves them.
 * Real public HTTPS/S3/CDN URLs are valid.
 * Machine-local loopbacks without /api/cloud-render/assets/, blob: URLs, and base64 data: URLs return false
 * because data: URLs bloat JSON payloads beyond the 32MB reverse proxy limit (HTTP 413) and AWS Lambda 6MB limit.
 */
export function isPublicCloudSafeUrl(url?: string | null): boolean {
    if (!url || typeof url !== 'string') return false;
    // Data URLs and blob URLs must be uploaded rather than embedded in the payload
    if (url.startsWith('data:') || url.startsWith('blob:')) return false;

    // Server-managed assets are always safe because the backend knows how to resolve/host them
    if (url.includes('/api/cloud-render/assets/') || url.startsWith('/api/cloud-render/assets/')) return true;

    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (parsed.pathname.includes('/api/cloud-render/assets/')) {
            return true;
        }
        if (
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host === '0.0.0.0' ||
            host.endsWith('.local') ||
            host.endsWith('.internal')
        ) {
            return false;
        }
        // S3 and GCS bucket URLs require presigned authentication signatures unless public
        const isS3OrGcs = host.includes('.s3.') || host.includes('.amazonaws.com') || host.includes('storage.googleapis.com');
        if (isS3OrGcs) {
            const hasPresignedAuth = parsed.search.includes('X-Amz-Signature') ||
                                    parsed.search.includes('X-Amz-Algorithm') ||
                                    parsed.search.includes('GoogleAccessId') ||
                                    parsed.search.includes('X-Goog-Algorithm');
            if (!hasPresignedAuth) {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function getLocalAssetCache(): Record<string, string> {
    try {
        const raw = localStorage.getItem(ASSET_CACHE_STORAGE_KEY);
        if (!raw) return {};
        const parsed: Record<string, string> = JSON.parse(raw);
        let modified = false;
        for (const [hash, url] of Object.entries(parsed)) {
            if (!isPublicCloudSafeUrl(url)) {
                delete parsed[hash];
                modified = true;
            }
        }
        if (modified) {
            localStorage.setItem(ASSET_CACHE_STORAGE_KEY, JSON.stringify(parsed));
        }
        return parsed;
    } catch {
        return {};
    }
}

function setLocalAssetCache(hash: string, url: string) {
    if (!isPublicCloudSafeUrl(url)) return;
    try {
        const cache = getLocalAssetCache();
        cache[hash] = url;
        const keys = Object.keys(cache);
        if (keys.length > 200) {
            delete cache[keys[0]];
        }
        localStorage.setItem(ASSET_CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch {}
}

async function computeBlobHash(blob: Blob): Promise<string> {
    try {
        const buf = await blob.slice(0, 1024 * 1024).arrayBuffer();
        const hashBuf = await crypto.subtle.digest('SHA-256', buf);
        const hashArr = Array.from(new Uint8Array(hashBuf));
        const hex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 20)}_${blob.size}`;
    } catch {
        return `${blob.size}_${blob.type.replace(/[^a-zA-Z0-9]/g, '')}`;
    }
}

/**
 * Wraps fetch to handle Google Cloud Run / proxy warm-up responses (e.g. "Starting Server..." HTML
 * with 200 OK or 502/503/504 gateway transient responses) with automatic retry and exponential backoff.
 */
async function fetchWithWarmupRetry(
    url: string,
    init?: RequestInit,
    options: { maxAttempts?: number; label?: string; onProgress?: (msg: string) => void } = {}
): Promise<{ res: Response; rawText: string; json: any | null }> {
    const maxAttempts = options.maxAttempts ?? 10;
    let attempt = 0;
    let delay = 1500;

    while (attempt < maxAttempts) {
        attempt++;
        try {
            const res = await fetch(url, init);
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            const rawText = await res.text().catch(() => '');

            const isStartingServer =
                rawText.includes('Starting Server...') ||
                rawText.includes('ContentGen AI is starting up') ||
                (contentType.includes('text/html') && (rawText.includes('<html') || rawText.includes('<!DOCTYPE')) && url.includes('/api/cloud-render'));

            const isGatewayTransient = res.status === 502 || res.status === 503 || res.status === 504;

            if (isStartingServer || isGatewayTransient) {
                console.warn(`[Cloud Render] Server is warming up (attempt ${attempt}/${maxAttempts}). Retrying in ${delay}ms... (${options.label || url})`);
                if (options.onProgress) {
                    options.onProgress(`Cloud server container is warming up, connecting... (attempt ${attempt}/${maxAttempts})`);
                }
                if (attempt >= maxAttempts) {
                    return { res, rawText, json: null };
                }
                await new Promise((r) => setTimeout(r, delay));
                delay = Math.min(4000, Math.round(delay * 1.3));
                continue;
            }

            let json: any = null;
            try {
                json = JSON.parse(rawText);
            } catch {
                json = null;
            }

            return { res, rawText, json };
        } catch (netErr: any) {
            console.warn(`[Cloud Render] Network error during ${options.label || url} (attempt ${attempt}/${maxAttempts}):`, netErr);
            if (attempt >= maxAttempts) {
                throw netErr;
            }
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(4000, Math.round(delay * 1.3));
        }
    }

    throw new Error(`Server connection timed out after ${maxAttempts} attempts.`);
}

async function checkAssetOnServer(hash: string): Promise<string | null> {
    try {
        const { res, json: data } = await fetchWithWarmupRetry(cloudRenderUrl('/api/cloud-render/check-assets'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assets: [hash] })
        }, { maxAttempts: 4, label: 'Check asset cache' });

        if (res.ok && data) {
            const serverUrl = data?.existing?.[hash];
            if (serverUrl && isPublicCloudSafeUrl(serverUrl)) {
                return serverUrl;
            }
        }
    } catch (e) {
        console.warn('[Cloud Render Cache Check]', e);
    }
    return null;
}

/**
 * Resolves clip assets (images, videos, audio, sfx) to server-accessible, persistent URLs
 * for remote headless rendering on AWS Lambda or Google Cloud Run.
 * 
 * Order of priority:
 * 1. Already public HTTP/HTTPS URL or Data URL.
 * 2. Upload to S3/Cloud storage via server endpoint /api/cloud-render/upload-asset.
 * 3. Fallback to Data URL for images and small audio clips (< 5MB).
 */
export async function resolveAndUploadRenderAsset(options: {
    userId: string;
    clipId: string;
    type: 'image' | 'video' | 'audio' | 'sfx';
    assetId?: string | null;
    objectUrl?: string | null;
    directUrl?: string | null;
    buffer?: AudioBuffer | null;
    imageElement?: HTMLImageElement | null;
    videoElement?: HTMLVideoElement | null;
}): Promise<string | undefined> {
    const { clipId, type, assetId, objectUrl, directUrl, buffer, imageElement, videoElement } = options;

    const candidateUrl = directUrl || objectUrl;

    // Fast exit: if no media URL, asset ID, buffer, or element was provided at all, there is no asset to resolve
    const hasSource = Boolean(
        (candidateUrl && candidateUrl.trim() !== '') ||
        (assetId && assetId.trim() !== '') ||
        buffer ||
        imageElement ||
        (videoElement && (videoElement.currentSrc || videoElement.src || videoElement.videoWidth > 0))
    );
    if (!hasSource) {
        return undefined;
    }

    // 1. If candidate is already a verified cloud-safe URL (S3, CDN, or server-hosted asset)
    if (candidateUrl && isPublicCloudSafeUrl(candidateUrl)) {
        return candidateUrl;
    }

    // 2. Retrieve Blob from AudioBuffer, ImageElement, VideoElement, IndexedDB asset storage, local ObjectURL, or Data URL
    let blob: Blob | null = null;

    if (buffer) {
        try {
            blob = audioBufferToWavBlob(buffer);
        } catch (e) {
            console.warn(`[Cloud Render] Could not convert audio buffer for ${clipId}:`, e);
        }
    }

    // Extract blob from loaded Image Element (common on timeline)
    if (!blob && imageElement && imageElement instanceof HTMLImageElement) {
        try {
            if (imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
                const cvs = document.createElement('canvas');
                cvs.width = imageElement.naturalWidth;
                cvs.height = imageElement.naturalHeight;
                const ctx = cvs.getContext('2d');
                if (ctx) {
                    ctx.drawImage(imageElement, 0, 0);
                    blob = await new Promise<Blob | null>((resolve) => cvs.toBlob(resolve, 'image/jpeg', 0.95));
                }
            }
        } catch (e) {
            console.warn(`[Cloud Render] Could not convert image element to blob for ${clipId}:`, e);
        }
    }

    // Extract video blob from Video Element if needed
    if (!blob && videoElement && videoElement instanceof HTMLVideoElement) {
        if (type === 'video') {
            // For video clips, fetch the actual video blob from its src/currentSrc rather than capturing a static canvas frame
            const vSrc = videoElement.currentSrc || videoElement.src;
            if (vSrc && (vSrc.startsWith('blob:') || vSrc.startsWith('http') || vSrc.startsWith('data:'))) {
                try {
                    const res = await fetch(vSrc);
                    if (res.ok) {
                        blob = await res.blob();
                    }
                } catch (e) {
                    console.warn(`[Cloud Render] Could not fetch video blob from videoElement src for ${clipId}:`, e);
                }
            }
        } else {
            try {
                if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
                    const cvs = document.createElement('canvas');
                    cvs.width = videoElement.videoWidth;
                    cvs.height = videoElement.videoHeight;
                    const ctx = cvs.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(videoElement, 0, 0);
                        blob = await new Promise<Blob | null>((resolve) => cvs.toBlob(resolve, 'image/jpeg', 0.95));
                    }
                }
            } catch (e) {
                console.warn(`[Cloud Render] Could not snapshot video element for ${clipId}:`, e);
            }
        }
    }

    // Handle data: URLs (base64 images/audio/depth maps)
    if (!blob && candidateUrl && candidateUrl.startsWith('data:')) {
        try {
            const res = await fetch(candidateUrl);
            if (res.ok) {
                blob = await res.blob();
            }
        } catch {
            try {
                const commaIdx = candidateUrl.indexOf(',');
                if (commaIdx !== -1) {
                    const header = candidateUrl.slice(0, commaIdx);
                    const b64 = candidateUrl.slice(commaIdx + 1);
                    const mime = header.match(/:(.*?);/)?.[1] || (type === 'image' ? 'image/jpeg' : type === 'audio' ? 'audio/wav' : 'image/png');
                    const binary = atob(b64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    blob = new Blob([bytes], { type: mime });
                }
            } catch (e) {
                console.warn(`[Cloud Render] Could not convert data URL to blob for ${clipId}:`, e);
            }
        }
    }

    if (!blob && assetId) {
        try {
            blob = await assetStorage.getAsset(assetId);
        } catch (e) {
            console.warn(`[Cloud Render] Could not retrieve ${type} asset (${assetId}) from storage:`, e);
        }
    }

    if (!blob && candidateUrl && (candidateUrl.startsWith('blob:') || candidateUrl.startsWith('http:') || candidateUrl.startsWith('https:'))) {
        try {
            const res = await fetch(candidateUrl);
            if (res.ok) {
                blob = await res.blob();
            }
        } catch (e) {
            console.warn(`[Cloud Render] Could not fetch blob from URL (${candidateUrl}):`, e);
        }
    }

    if (!blob) {
        return undefined;
    }

    // Reject static images masquerading as video files
    if (type === 'video' && blob.type && blob.type.startsWith('image/')) {
        return undefined;
    }

    // Step 2.5: Compute content fingerprint hash and check local/server caches
    const assetHash = await computeBlobHash(blob);
    const localCache = getLocalAssetCache();
    const cachedUrl = localCache[assetHash];
    if (cachedUrl && isPublicCloudSafeUrl(cachedUrl)) {
        return cachedUrl;
    }

    const serverCachedUrl = await checkAssetOnServer(assetHash);
    if (serverCachedUrl && isPublicCloudSafeUrl(serverCachedUrl)) {
        setLocalAssetCache(assetHash, serverCachedUrl);
        return serverCachedUrl;
    }

    const ext = type === 'video' ? '.mp4' : (type === 'audio' || type === 'sfx') ? '.wav' : (blob.type?.includes('png') ? '.png' : '.jpg');
    const filename = `asset_${assetHash}${ext}`;

    async function postChunkWithRetry(formData: FormData, tries = 4) {
        return await fetchWithWarmupRetry(
            cloudRenderUrl('/api/cloud-render/upload-chunk'),
            { method: 'POST', body: formData },
            { maxAttempts: tries, label: 'Upload chunk' }
        );
    }

    // Helper for chunked slices
    async function uploadBlobInChunks(targetBlob: Blob, targetFilename: string, targetHash: string): Promise<string> {
        const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
        const totalChunks = Math.ceil(targetBlob.size / CHUNK_SIZE);
        const uploadId = `upload_${targetHash}_${Date.now()}`;

        let chunkedUploadedUrl: string | undefined;

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(targetBlob.size, start + CHUNK_SIZE);
            const chunkSlice = targetBlob.slice(start, end);

            const formData = new FormData();
            formData.append('uploadId', uploadId);
            formData.append('chunkIndex', String(i));
            formData.append('totalChunks', String(totalChunks));
            formData.append('filename', targetFilename);
            formData.append('hash', targetHash);
            formData.append('totalSize', String(targetBlob.size));
            formData.append('chunk', chunkSlice, `part_${i}`);

            const { res: chunkRes, json: chunkData } = await postChunkWithRetry(formData);
            if (!chunkRes.ok || chunkData?.error) {
                throw new Error(chunkData?.error || `Chunk ${i + 1}/${totalChunks} upload failed with HTTP ${chunkRes.status}`);
            }
            const remoteUrl = chunkData?.signedUrl || chunkData?.url || (chunkData?.filename ? cloudRenderUrl(`/api/cloud-render/assets/${chunkData.filename}`) : null);
            if (chunkData?.completed === true && remoteUrl && isPublicCloudSafeUrl(remoteUrl)) {
                chunkedUploadedUrl = remoteUrl;
            }
        }

        if (chunkedUploadedUrl) {
            setLocalAssetCache(targetHash, chunkedUploadedUrl);
            return chunkedUploadedUrl;
        }
        throw new Error(`Chunked upload completed all ${totalChunks} chunks but did not confirm completion for ${targetFilename}`);
    }

    // Tier B: If asset exceeds 10MB, upload via 5MB chunk slices to stay well below proxy limits
    if (blob.size > 10 * 1024 * 1024) {
        try {
            const chunkUrl = await uploadBlobInChunks(blob, filename, assetHash);
            if (chunkUrl) return chunkUrl;
        } catch (err: any) {
            console.error(`[Cloud Render] Chunked upload failed for ${filename}:`, err);
            throw new Error(`Failed to upload ${type} asset ${filename} (${(blob.size / (1024 * 1024)).toFixed(1)} MB): ${err?.message || err}`);
        }
    }

    // Tier C: Standard single-request server upload (< 10MB)
    try {
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('hash', assetHash);
        const { res: uploadRes, rawText: rawUpload, json: uploadData } = await fetchWithWarmupRetry(
            cloudRenderUrl('/api/cloud-render/upload-asset'),
            {
                method: 'POST',
                body: formData
            },
            { label: `Upload asset ${filename}`, maxAttempts: 5 }
        );
        if (uploadRes.ok) {
            const remoteUrl = uploadData?.signedUrl || uploadData?.url || (uploadData?.filename ? cloudRenderUrl(`/api/cloud-render/assets/${uploadData.filename}`) : null);
            if (remoteUrl && isPublicCloudSafeUrl(remoteUrl)) {
                setLocalAssetCache(assetHash, remoteUrl);
                return remoteUrl;
            }
        } else if (uploadRes.status === 413) {
            // Server/proxy returned 413: retry immediately with 5MB chunks
            console.warn(`[Cloud Render] Single upload 413 for ${filename}, retrying via chunk upload...`);
            const chunkUrl = await uploadBlobInChunks(blob, filename, assetHash);
            if (chunkUrl) return chunkUrl;
        } else {
            throw new Error(`Upload HTTP ${uploadRes.status}: ${rawUpload || 'Empty response'}`);
        }
    } catch (serverErr: any) {
        console.warn(`[Cloud Render] Server asset upload for ${type} (${clipId}) failed, trying chunk fallback:`, serverErr);
        try {
            const chunkUrl = await uploadBlobInChunks(blob, filename, assetHash);
            if (chunkUrl) return chunkUrl;
        } catch (chunkErr: any) {
            throw new Error(`Asset upload failed for ${filename}: ${chunkErr?.message || chunkErr}`);
        }
    }

    // 4. Disaster fallback ONLY for tiny icons/spacers (< 50KB)
    // Never create multi-megabyte data URLs that cause HTTP 413
    if (blob.size < 50 * 1024) {
        try {
            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob!);
            });
        } catch (e) {
            console.warn('[Cloud Render] Tiny data URL fallback failed:', e);
        }
    }

    return undefined;
}


/**
 * Dispatches the current timeline to the Remotion Cloud Rendering infrastructure (AWS Lambda / Google Cloud Run / Headless Server).
 * Handles quota tracking, background progress polling, and asset retrieval.
 */
export async function handleCloudRenderExport() {
    if (isGuest()) {
        ui.showStatus('Cloud Rendering requires an authenticated account. Please log in.', true, 5000);
        openLoginModal();
        return;
    }

    const userId = currentUser?.uid || 'guest_user';
    const userEmail = currentUser?.email || 'user@local';

    // 1. Auto-synchronize timeline clips from storyboard scenes if clips are missing or out of sync
    const allStoryboardShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
    const hasStoryboardShots = allStoryboardShots.length > 0;
    const isSeedOrOutOfSync = (
        !timelineState.clips ||
        timelineState.clips.length === 0 ||
        (hasStoryboardShots && timelineState.clips.length !== allStoryboardShots.length) ||
        (hasStoryboardShots && allStoryboardShots.length > 1 && timelineState.clips.length <= 1)
    );

    if (isSeedOrOutOfSync && hasStoryboardShots) {
        try {
            if (timelineState.masterAudioBuffer && timelineState.globalWordTimestamps?.length) {
                const { buildTimelineFromShotsWithAudio } = await import('../audio-upload-director');
                await buildTimelineFromShotsWithAudio();
            } else {
                const { buildTimelineFromShotsWithMediaDurations } = await import('../audio-upload-director');
                await buildTimelineFromShotsWithMediaDurations();
            }
        } catch (syncErr) {
            console.warn('[Cloud Render] Auto-sync timeline warning:', syncErr);
        }
    }

    // Strict Fail-Closed Pre-Export Timing Validation Gate
    const syncMode = (timelineState.mode === 'audio_locked' || (timelineState.masterAudioBuffer && timelineState.isAudioLocked?.())) ? 'audio_locked' : 'free';
    try {
        validateBeforeExport(
            timelineState.clips,
            timelineState.masterAudioBuffer?.duration ?? null,
            { mode: syncMode }
        );
    } catch (valErr: any) {
        ui.showStatus(valErr.message || 'Cloud export blocked: timeline timing validation failed.', true, 8000);
        return;
    }

    // Cloud Infrastructure Provider & Quota calculation
    const provider = (state.cloudRenderProvider || (dom.cloudRenderProviderSelect?.value as any) || 'gcp') as 'gcp' | 'aws' | 'headless';
    const isHeadless = provider === 'headless';
    const multiplier = isHeadless ? 2 : 1;

    // Calculate total duration in seconds and minutes
    const clipEndTimes = (timelineState.clips || [])
        .map((c: any) => Number(c.endTime) || ((Number(c.startTime) || 0) + (Number(c.duration) || 0)))
        .filter((t: number) => Number.isFinite(t) && t > 0);

    const calculatedDuration = clipEndTimes.length > 0
        ? Math.max(...clipEndTimes)
        : (timelineState.masterAudioBuffer?.duration || state.uploadedVideoDuration || 10);

    const totalDurationSec = Number.isFinite(calculatedDuration) && calculatedDuration > 0 ? calculatedDuration : 10;

    const baseMinutes = Math.max(1, Math.ceil(totalDurationSec / 60));
    const minutesToDeduct = baseMinutes * multiplier;
    const currentQuota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 300;
    const currentUsed = state.renderMinutesUsed || 0;
    const remaining = Math.max(0, currentQuota - currentUsed);

    if (remaining < minutesToDeduct) {
        const rateLabel = isHeadless ? ` (${baseMinutes} min × 2 for Headless mode)` : '';
        ui.showStatus(
            `⚠️ Insufficient Cloud Render quota! This export requires ${minutesToDeduct} min${rateLabel} for ${totalDurationSec.toFixed(0)}s video, but you have ${remaining} min remaining of your ${currentQuota} min quota. Please select a different engine or contact an admin for more render minutes.`,
            true,
            7000
        );
        return;
    }

    const providerLabel = provider === 'gcp'
        ? 'Google Cloud Run'
        : provider === 'aws'
        ? 'AWS Lambda'
        : 'Headless Server (2x Quota)';

    ui.setButtonsDisabled(true);
    state.isCloudRenderActive = true;
    await ui.openProcessingModal(`Cloud Rendering (${providerLabel} — Beta)`);
    ui.updateProcessingProgress(5, `Preparing ${totalDurationSec.toFixed(0)}s video payload for ${providerLabel}...`);

    let minutesDeducted = false;
    let dispatchedJobId: string | null = null;
    const videoTitle = dom.videoExportFilenameInput?.value.trim() || 'AI Studio Video';
    const resolution = dom.videoExportResolutionSelect?.value || '1080p';

    try {
        // 1. Deduct quota in Firestore securely
        const rateNote = isHeadless ? '2x Headless rate' : '1x Standard rate';
        ui.updateProcessingProgress(15, `Deducting ${minutesToDeduct} minute(s) (${rateNote}) from your cloud render quota...`);
        await recordRenderMinutesUsageSecure(minutesToDeduct, `Rendered video (${totalDurationSec.toFixed(1)}s via ${provider.toUpperCase()})`);
        minutesDeducted = true;

        // 2. Prepare payload for Remotion Cloud Run
        const fps = parseInt(dom.videoExportFpsSelect?.value || '30', 10);
        const durationInFrames = Math.round(totalDurationSec * fps);

        ui.updateProcessingProgress(18, `Uploading and preparing media assets for Cloud Run render...`);

        const totalClips = timelineState.clips.length;
        let processedClipsCount = 0;
        let reusedCacheCount = 0;

        let accumulatedTime = 0;
        const richClips: any[] = new Array(timelineState.clips.length);
        const BATCH_SIZE = 6;

        for (let batchStart = 0; batchStart < timelineState.clips.length; batchStart += BATCH_SIZE) {
            const batch = timelineState.clips.slice(batchStart, batchStart + BATCH_SIZE);
            await Promise.all(
                batch.map(async (c: any, relIdx: number) => {
                    const idx = batchStart + relIdx;
                    const initialCacheKeys = Object.keys(getLocalAssetCache()).length;
                    const primaryVideoEl = c.videoElement || c.talkingHeadVideoElement;
                    const hasPrimaryVideo = Boolean(
                        c.video_id ||
                        c._videoObjectURL ||
                        (c as any).videoUrl ||
                        (primaryVideoEl && (primaryVideoEl.currentSrc || primaryVideoEl.src || primaryVideoEl.videoWidth > 0))
                    );

                    const secondaryVideoEl = (c as any).secondaryVideoElement;
                    const hasSecondaryVideo = Boolean(
                        (c as any).secondary_video_id ||
                        (c as any)._secondaryVideoObjectURL ||
                        (c as any).secondaryVideoUrl ||
                        (secondaryVideoEl && (secondaryVideoEl.currentSrc || secondaryVideoEl.src || secondaryVideoEl.videoWidth > 0))
                    );

                    const hasImage = Boolean(
                        c.image_id ||
                        c._imageObjectURL ||
                        (c as any).imageUrl ||
                        c.image ||
                        c.backgroundPlate
                    );

                    const hasAudio = Boolean(
                        (c as any).audio_id ||
                        (c as any)._audioObjectURL ||
                        (c as any).audioUrl
                    );

                    const hasSfx = Boolean(
                        c.sfx_id ||
                        c._sfxObjectURL ||
                        c._sfxBuffer
                    );

                    const hasOverlay = Boolean(
                        (c as any).overlay_id ||
                        (c as any)._overlayObjectURL ||
                        (c as any).overlayImageUrl ||
                        (c as any).overlayImage
                    );

                    const hasSecondaryImg = Boolean(
                        (c as any).secondary_image_id ||
                        (c as any)._secondaryImageObjectURL ||
                        (c as any).secondaryImageUrl ||
                        (c as any).secondaryImage
                    );

                    const [imageUrl, videoUrl, audioUrl, sfxUrl, overlayImageUrl, talkingHeadVideoUrl, secondaryImageUrl, secondaryVideoUrl, backgroundPlateUrl] = await Promise.all([
                        hasImage ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_${c.id || idx}`,
                            type: 'image',
                            assetId: c.image_id,
                            objectUrl: c._imageObjectURL,
                            directUrl: (c as any).imageUrl,
                            imageElement: c.image || c.backgroundPlate
                        }) : Promise.resolve(undefined),
                        hasPrimaryVideo ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_${c.id || idx}`,
                            type: 'video',
                            assetId: c.video_id,
                            objectUrl: c._videoObjectURL || (c.videoElement === state.uploadedVideoElement ? state.uploadedVideoObjectURL : undefined),
                            directUrl: (c as any).videoUrl || (c.videoElement === state.uploadedVideoElement ? (state as any).uploadedVideoDirectUrl : undefined),
                            videoElement: primaryVideoEl
                        }) : Promise.resolve(undefined),
                        hasAudio ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_${c.id || idx}`,
                            type: 'audio',
                            assetId: (c as any).audio_id,
                            objectUrl: (c as any)._audioObjectURL,
                            directUrl: (c as any).audioUrl
                        }) : Promise.resolve(undefined),
                        hasSfx ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_${c.id || idx}`,
                            type: 'sfx',
                            assetId: c.sfx_id,
                            objectUrl: c._sfxObjectURL,
                            buffer: c._sfxBuffer
                        }) : Promise.resolve(undefined),
                        hasOverlay ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_overlay_${c.id || idx}`,
                            type: 'image',
                            assetId: (c as any).overlay_id,
                            objectUrl: (c as any)._overlayObjectURL,
                            imageElement: (c as any).overlayImage
                        }) : Promise.resolve(undefined),
                        c.talkingHeadVideoElement && c.talkingHeadVideoElement !== c.videoElement
                            ? resolveAndUploadRenderAsset({
                                userId,
                                clipId: `clip_talkinghead_${c.id || idx}`,
                                type: 'video',
                                videoElement: c.talkingHeadVideoElement
                              })
                            : Promise.resolve((c as any).talkingHeadVideoUrl),
                        hasSecondaryImg ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_secondary_img_${c.id || idx}`,
                            type: 'image',
                            assetId: (c as any).secondary_image_id,
                            objectUrl: (c as any)._secondaryImageObjectURL,
                            imageElement: (c as any).secondaryImage
                        }) : Promise.resolve(undefined),
                        hasSecondaryVideo ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_secondary_vid_${c.id || idx}`,
                            type: 'video',
                            assetId: (c as any).secondary_video_id,
                            objectUrl: (c as any)._secondaryVideoObjectURL,
                            directUrl: (c as any).secondaryVideoUrl,
                            videoElement: secondaryVideoEl
                        }) : Promise.resolve(undefined),
                        (c as any).backgroundPlate ? resolveAndUploadRenderAsset({
                            userId,
                            clipId: `clip_plate_${c.id || idx}`,
                            type: 'image',
                            imageElement: (c as any).backgroundPlate
                        }) : Promise.resolve(undefined)
                    ]);

                    const hasVideoBackground = Boolean(
                        hasPrimaryVideo ||
                        c.video_id ||
                        c._videoObjectURL ||
                        (c as any).videoUrl ||
                        primaryVideoEl
                    );
                    const isFullPresenterBg = c.talkingHeadMode === 'full';
                    const parallaxEligible = !hasVideoBackground && !isFullPresenterBg;

                    const stillImg = (c as any).backgroundPlate || (c as any).image;
                    let depthUrl: string | undefined;
                    let depthMeta: { focusDepth: number; hazeColor?: [number, number, number] } | undefined;
                    if (state.enableParallaxEffect && stillImg && parallaxEligible) {
                        try {
                            const d: any = await ensureDepth(stillImg, { focal: c.focalPoint, source: state.parallaxDepthSource });
                            if (d) {
                                depthMeta = { focusDepth: d.focusDepth, hazeColor: d.hazeColor };
                                const png = await depthToPngDataUrl(d);
                                depthUrl = png ? await resolveAndUploadRenderAsset({
                                    userId,
                                    clipId: `clip_depth_${c.id || idx}`,
                                    type: 'image',
                                    directUrl: png
                                }) : undefined;
                            }
                        } catch (depthErr) {
                            console.warn('[Cloud Render] Could not prepare parallax depth map for clip:', depthErr);
                        }
                    }

                    const isAudioLocked = timelineState.isAudioLocked ? timelineState.isAudioLocked() : timelineState.mode === 'audio_locked';

                    const startTime = typeof c.startTime === 'number' && Number.isFinite(c.startTime)
                        ? c.startTime
                        : accumulatedTime;

                    const rawEnd = typeof c.endTime === 'number' && Number.isFinite(c.endTime) && c.endTime > startTime
                        ? c.endTime
                        : undefined;

                    if (isAudioLocked && rawEnd == null) {
                        throw new Error(`Audio-locked clip ${c.id || idx} has no canonical endTime`);
                    }

                    const canonicalEnd = rawEnd ?? (
                        typeof c.duration === 'number' && Number.isFinite(c.duration) && c.duration > 0
                            ? startTime + c.duration
                            : startTime + 4
                    );

                    const endTime = canonicalEnd;
                    const duration = endTime - startTime;
                    accumulatedTime = Math.max(accumulatedTime, endTime);

                    richClips[idx] = {
                        id: c.id || `shot_${idx + 1}`,
                        startTime,
                        endTime,
                        duration,
                        text: c.text || '',
                        imageUrl,
                        videoUrl,
                        audioUrl,
                        sfxUrl,
                        overlayImageUrl,
                        talkingHeadVideoUrl,
                        secondaryImageUrl,
                        secondaryVideoUrl,
                        secondary_image_id: c.secondary_image_id ?? null,
                        secondary_video_id: c.secondary_video_id ?? null,
                        talkingHeadRole: c.talkingHeadRole || (c.talkingHeadMode === 'primary' ? 'primary' : 'secondary'),
                        talkingHeadMode: c.talkingHeadMode || 'none',
                        talkingHeadShape: c.talkingHeadShape || 'rounded',
                        talkingHeadSize: c.talkingHeadSize || 'medium',
                        displayMode: c.displayMode || 'fullscreen',
                        pipPosition: c.pipPosition || 'top_right',
                        pipX: typeof c.pipX === 'number' ? c.pipX : undefined,
                        pipY: typeof c.pipY === 'number' ? c.pipY : undefined,
                        pipAnchorX: typeof c.pipAnchorX === 'number' ? c.pipAnchorX : 0.5,
                        pipAnchorY: typeof c.pipAnchorY === 'number' ? c.pipAnchorY : 0.5,
                        pipScale: typeof c.pipScale === 'number' ? c.pipScale : undefined,
                        pipAnimation: c.pipAnimation || 'pop_spring',
                        pipBorderColor: c.pipBorderColor,
                        pipMediaAspect: mediaAspectOf(c.videoElement || c.image || c.backgroundPlate),
                        hasCornerMapCallout: Boolean(c.hasCornerMapCallout || (c as any).hasCornerCallout),
                        cornerCalloutLabel: (c as any).cornerCalloutLabel || '',
                        cornerCalloutCoords: (c as any).cornerCalloutCoords || '',
                        overlayPosition: c.overlayPosition || 'top-right',
                        cameraMovement: c.cameraMovement || c.camera_movement || 'slow_zoom_in',
                        camera_movement: c.cameraMovement || c.camera_movement || 'slow_zoom_in',
                        cameraKeyframes: c.cameraKeyframes || presetToKeyframes(c.cameraMovement || c.camera_movement || 'slow_zoom_in'),
                        depthUrl,
                        parallax: (state.enableParallaxEffect && parallaxEligible) ? {
                            enabled: true,
                            strength: state.parallaxStrength ?? 1,
                            orbit: state.parallaxOrbit ?? 0.35,
                            blur: (state.parallaxDepthBlur && (state.parallaxBlurStrength ?? 0) > 0) ? state.parallaxBlurStrength : 0,
                            haze: state.parallaxHaze !== false ? Math.max(0, state.parallaxHazeAmount ?? 0.6) : 0,
                            dust: state.parallaxDustParticles !== false ? Math.max(0, state.parallaxDustIntensity ?? 0.6) : 0,
                            dustSize: state.parallaxDustSize ?? 0.5,
                            dustDensity: state.parallaxDustDensity ?? 0.5,
                            multiLayer: state.parallaxMode !== 'single_plate',
                            rackFocus: Boolean(state.parallaxRackFocus),
                            focusDepth: depthMeta?.focusDepth,
                            hazeColor: depthMeta?.hazeColor,
                        } : undefined,
                        transitionToNext: c.transitionToNext || 'cut',
                        transitionDuration: typeof c.transitionDuration === 'number' ? c.transitionDuration : (typeof c._transitionDuration === 'number' ? c._transitionDuration : 0.35),
                        volume: c.volume ?? 1.0,
                        fadeIn: c.fadeIn,
                        fadeOut: c.fadeOut,
                        rotate: c.rotate ?? 0,
                        focalPoint: c.focalPoint,
                        playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1.0,
                        videoStartOffset: typeof c.videoStartOffset === 'number' ? c.videoStartOffset : 0,
                        useOriginalAudio: Boolean(c.useOriginalAudio || (c as any).soloAudio),
                        soloAudio: Boolean((c as any).soloAudio),
                        isPreMixedAudio: false,
                        elements: Array.isArray(c.elements) ? c.elements : [],
                        backgroundPlateUrl,
                        wordTimestamps: c.wordTimestamps,
                        wordTimestampMode: 'relative',
                        wordRange: c.wordRange,
                        deviceTag: c.deviceTag,
                        subtitles: (c.wordTimestamps && c.wordTimestamps.length > 0)
                            ? (() => {
                                const mode: 'absolute' | 'relative' = c.wordTimestampMode || 'relative';
                                return c.wordTimestamps.map((w: any) => {
                                    const rawStart = Number(w.start ?? w.startTime ?? 0);
                                    const rawEnd = Number(w.end ?? w.endTime ?? (rawStart + 0.3));
                                    const relStart = mode === 'relative' ? rawStart : Math.max(0, rawStart - startTime);
                                    const relEnd = mode === 'relative' ? rawEnd : Math.max(0.05, rawEnd - startTime);
                                    return {
                                        text: w.word || w.punctuated_word || w.text || '',
                                        start: Math.max(0, relStart),
                                        end: Math.max(0.05, relEnd)
                                    };
                                });
                            })()
                            : undefined,
                        hasVideo: Boolean(videoUrl || c.video_id || c._videoObjectURL),
                        hasImage: Boolean(imageUrl || c.image_id || c._imageObjectURL)
                    };

                    processedClipsCount++;
                    const assetProgress = 18 + Math.round((processedClipsCount / Math.max(1, totalClips)) * 12);
                    ui.updateProcessingProgress(assetProgress, `Processed clip ${processedClipsCount}/${totalClips} assets...`);
                })
            );
        }

        // Extract 1:1 OfflineAudioContext timeline audio mixdown matching local browser export
        ui.updateProcessingProgress(31, 'Synthesizing timeline audio mixdown & background music...');
        let masterAudioUrl: string | undefined = undefined;
        let isPreMixedAudio = false;

        try {
            const mixedBuffer = await extractTimelineAudioMixdown(false);
            if (mixedBuffer && mixedBuffer.duration > 0) {
                masterAudioUrl = await resolveAndUploadRenderAsset({
                    userId,
                    clipId: 'master_audio_mixdown',
                    type: 'audio',
                    buffer: mixedBuffer
                });
                if (masterAudioUrl) {
                    isPreMixedAudio = true;
                }
            }
        } catch (mixErr) {
            console.warn('[Cloud Render] extractTimelineAudioMixdown fallback note:', mixErr);
        }

        // Fallback: If mixdown could not be produced, upload raw buffers independently
        if (!masterAudioUrl && timelineState.masterAudioBuffer) {
            masterAudioUrl = await resolveAndUploadRenderAsset({
                userId,
                clipId: 'master_audio',
                type: 'audio',
                buffer: timelineState.masterAudioBuffer
            });
        }

        let backgroundMusicUrl: string | undefined = undefined;
        if (!isPreMixedAudio && state._bgAudioBuffer) {
            backgroundMusicUrl = await resolveAndUploadRenderAsset({
                userId,
                clipId: 'bg_music',
                type: 'audio',
                buffer: state._bgAudioBuffer
            });
        }

        const payload = {
            userId,
            userEmail,
            provider,
            compositionId: 'auto',
            durationInFrames,
            fps,
            resolution,
            aspectRatio: state.aspectRatio || '16:9',
            codec: 'h264',
            inputProps: {
                title: dom.videoExportFilenameInput?.value.trim() || 'AI Studio Video',
                aspectRatio: state.aspectRatio || '16:9',
                mode: timelineState.mode,
                clips: richClips,
                totalDurationSec,
                timelineHasAudioMixdown: isPreMixedAudio,
                isPreMixedAudio,
                graphics: Array.isArray((timelineState as any).graphics) ? (timelineState as any).graphics : (Array.isArray((timelineState as any)._graphics) ? (timelineState as any)._graphics : []),
                patternInterrupts: Array.isArray((timelineState as any).patternInterrupts) ? (timelineState as any).patternInterrupts : [],
                motionGraphicsEnabled: Boolean(state.motionGraphicsEnabled ?? true),
                overlayIntensity: state.overlayIntensity || 'medium',
                graphicsTheme: state.graphicsTheme || 'minimal',
                graphicsAccentColor: state.graphicsAccentColor || '#F5C542',

                // Subtitles — the bridge drives the real SubtitleEngine registry via
                // these settings + each clip's own wordTimestamps.
                subtitlesEnabled: Boolean(timelineState.showSubtitles),
                showSubtitles: Boolean(timelineState.showSubtitles),
                subtitles: (() => {
                    const rawSubs = Array.isArray((timelineState as any).subtitles) && (timelineState as any).subtitles.length > 0
                        ? (timelineState as any).subtitles
                        : (Array.isArray(timelineState.globalWordTimestamps) ? timelineState.globalWordTimestamps : []);
                    if (rawSubs.length > 0) {
                        return rawSubs.map((w: any) => ({
                            text: String(w.text || w.word || w.punctuated_word || '').trim(),
                            start: Number(w.start ?? w.startTime ?? 0),
                            end: Number(w.end ?? w.endTime ?? (Number(w.start ?? 0) + 0.3))
                        })).filter((c: any) => Boolean(c.text));
                    }
                    // Aggregate from timeline clips if global timestamps were not set
                    const aggregated: any[] = [];
                    (timelineState.clips || []).forEach((c: any) => {
                        const clipStart = typeof c.startTime === 'number' ? c.startTime : 0;
                        const wordMode: 'absolute' | 'relative' = (c as any).wordTimestampMode || 'relative';
                        if (Array.isArray(c.wordTimestamps) && c.wordTimestamps.length > 0) {
                            c.wordTimestamps.forEach((w: any) => {
                                const rawStart = Number(w.start ?? w.startTime ?? 0);
                                const rawEnd = Number(w.end ?? w.endTime ?? (rawStart + 0.3));
                                aggregated.push({
                                    text: String(w.word || w.punctuated_word || w.text || '').trim(),
                                    start: wordMode === 'relative' ? clipStart + rawStart : rawStart,
                                    end: wordMode === 'relative' ? clipStart + rawEnd : rawEnd,
                                });
                            });
                        }
                    });
                    return aggregated.filter((c: any) => Boolean(c.text));
                })(),
                wordTimestamps: Array.isArray(timelineState.globalWordTimestamps) ? timelineState.globalWordTimestamps : [],
                videoSubtitleTextColor: (timelineState as any).videoSubtitleTextColor,
                videoSubtitleHighlightColor: (timelineState as any).videoSubtitleHighlightColor,
                videoSubtitleBgColor: (timelineState as any).videoSubtitleBgColor,
                videoSubtitleFontSize: (timelineState as any).videoSubtitleFontSize,
                videoSubtitleStyle: timelineState.videoSubtitleStyle || 'classic',
                videoSubtitlePosition: timelineState.videoSubtitlePosition || 'bottom',
                videoSubtitleFont: (timelineState as any).videoSubtitleFont || 'Montserrat',
                // Per-style subtitle colour overrides from the editor (same object the browser engine reads)
                videoSubtitleColors: JSON.parse(JSON.stringify((state as any).videoSubtitleColors || {})),

                // Global transition style
                videoTransitionStyle: timelineState.videoTransitionStyle,

                // Needed so the bridge's normalizeTimeline() call can avoid placing
                // transitions mid-word, matching the editor's own scheduling exactly.
                globalSilences: (timelineState as any).globalSilences || null,

                textOverlays: Array.isArray(state.uiTextOverlays) ? state.uiTextOverlays : [],
                uiTextOverlays: Array.isArray(state.uiTextOverlays) ? state.uiTextOverlays : [],
                activeFilterName: state.activeFilterName || 'none',
                videoEffects: {
                    grain: timelineState.videoEffects?.grain || 0,
                    dustAndScratches: timelineState.videoEffects?.dustAndScratches || timelineState.videoEffects?.dustParticles || 0,
                    dustParticles: timelineState.videoEffects?.dustParticles || 0,
                    dustParticlesSize: state.dustMotesSize ?? 0.5,
                    dustParticlesCount: state.dustMotesCount ?? 0.5,
                    vignette: timelineState.videoEffects?.vignette || (state.cinematicVignette ? 0.6 : 0),
                    hdrMaster: timelineState.videoEffects?.hdrMaster || 0,
                    hdrBalance: timelineState.videoEffects?.hdrBalance || 0,
                    clarity: timelineState.videoEffects?.clarity || 0,
                    vibrance: timelineState.videoEffects?.vibrance || 0,
                    sharpening: timelineState.videoEffects?.sharpening || 0,
                    colorFilter: timelineState.videoEffects?.colorFilter || state.activeFilterName || 'none',
                    cinematicVignette: Boolean(state.cinematicVignette),
                    chromaticAberration: timelineState.videoEffects?.chromaticAberration || 0,
                    lightLeaks: timelineState.videoEffects?.lightLeaks || 0,
                    sparkles: timelineState.videoEffects?.sparkles || 0,
                    sparklesSize: state.sparklesSize ?? 0.5,
                    sparklesCount: state.sparklesCount ?? 0.5,
                    rain: timelineState.videoEffects?.rain || 0,
                    rainSize: state.rainSize ?? 0.5,
                    rainCount: state.rainCount ?? 0.5,
                    snow: timelineState.videoEffects?.snow || 0,
                    snowSize: state.snowSize ?? 0.5,
                    snowCount: state.snowCount ?? 0.5,
                },
                cinematicVignette: Boolean(state.cinematicVignette),
                cinematicLetterbox: Boolean(state.cinematicLetterbox),
                audioReactive: buildAudioReactivePayload(
                    Array.isArray((timelineState as any).graphics) ? (timelineState as any).graphics : (Array.isArray((timelineState as any)._graphics) ? (timelineState as any)._graphics : []),
                    fps,
                    durationInFrames
                ),
                masterAudioUrl,
                audioUrl: masterAudioUrl,
                backgroundMusicUrl
            }
        };

        ui.updateProcessingProgress(32, `Dispatching render task to ${providerLabel}...`);

        console.log((payload as any).subtitles?.slice(0, 5), (payload as any).clips?.[0]?.subtitles?.slice(0, 5));
        console.log(payload.inputProps?.subtitles?.slice(0, 5), (payload.inputProps?.clips?.[0] as any)?.subtitles?.slice(0, 5));

        const payloadString = JSON.stringify(payload);
        const payloadSize = payloadString.length;
        console.log(`[Cloud Render] Final dispatch payload size: ${(payloadSize / 1024).toFixed(1)} KB`);

        let dispatchBody: any = payload;
        // If payload exceeds 1MB, stream it to /api/cloud-render/upload-payload to stay well clear of any reverse proxy limits
        if (payloadSize > 1024 * 1024) {
            ui.updateProcessingProgress(33, `Streaming project payload (${(payloadSize / (1024 * 1024)).toFixed(2)} MB)...`);
            try {
                const payloadBlob = new Blob([payloadString], { type: 'application/json' });
                const form = new FormData();
                form.append('payload', payloadBlob, 'render_payload.json');
                const uploadRes = await fetchWithWarmupRetry(
                    cloudRenderUrl('/api/cloud-render/upload-payload'),
                    {
                        method: 'POST',
                        body: form
                    },
                    { label: 'Upload render payload', maxAttempts: 6 }
                );
                if (uploadRes.res.ok && uploadRes.json?.payloadId) {
                    dispatchBody = { payloadId: uploadRes.json.payloadId };
                }
            } catch (pErr) {
                console.warn('[Cloud Render] Payload upload note:', pErr);
            }
        }

        // Animated staged progress during dispatch to prevent any frozen look on long projects
        let dispatchTick = 0;
        const isGcp = provider === 'gcp';
        const storageLabel = isGcp ? 'Google Cloud Storage' : 'S3 cloud';
        const workerLabel = isGcp ? 'Google Cloud Run instances' : 'AWS Lambda chunk workers';

        const dispatchSteps = [
            { pct: 32, text: `Packaging timeline and media assets for ${providerLabel}...` },
            { pct: 33, text: `Verifying ${storageLabel} assets & URLs...` },
            { pct: 34, text: `Allocating parallel ${workerLabel}...` },
            { pct: 35, text: `Dispatching render task to ${providerLabel}...` },
        ];
        const dispatchInterval = setInterval(() => {
            dispatchTick = (dispatchTick + 1) % dispatchSteps.length;
            const currentStep = dispatchSteps[dispatchTick];
            ui.updateProcessingProgress(currentStep.pct, currentStep.text);
        }, 1200);

        let dispatchRes: Response;
        let rawDispatchText = '';
        let dispatchData: any = null;
        try {
            const authHeaders = await getCloudRenderAuthHeaders({ 'Content-Type': 'application/json' });
            const dispatchResult = await fetchWithWarmupRetry(
                cloudRenderUrl('/api/cloud-render/dispatch'),
                {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify(dispatchBody)
                },
                {
                    label: 'Dispatch render job',
                    maxAttempts: 12,
                    onProgress: (msg) => ui.updateProcessingProgress(34, msg)
                }
            );
            dispatchRes = dispatchResult.res;
            rawDispatchText = dispatchResult.rawText;
            dispatchData = dispatchResult.json;

            // Resilient fallback: If direct dispatch triggers 413, automatically stream upload payload and retry
            if (dispatchRes.status === 413 && !dispatchBody.payloadId) {
                console.warn('[Cloud Render] Direct dispatch received 413 Request Entity Too Large. Retrying via streamed payload...');
                ui.updateProcessingProgress(34, 'Payload exceeded proxy limit. Streaming project bundle...');
                const payloadBlob = new Blob([payloadString], { type: 'application/json' });
                const form = new FormData();
                form.append('payload', payloadBlob, 'render_payload.json');
                const uploadHeaders = await getCloudRenderAuthHeaders({});
                const uploadRes = await fetchWithWarmupRetry(
                    cloudRenderUrl('/api/cloud-render/upload-payload'),
                    {
                        method: 'POST',
                        headers: uploadHeaders,
                        body: form
                    },
                    { label: 'Upload project payload fallback', maxAttempts: 6 }
                );
                if (uploadRes.res.ok && uploadRes.json?.payloadId) {
                    const retryResult = await fetchWithWarmupRetry(
                        cloudRenderUrl('/api/cloud-render/dispatch'),
                        {
                            method: 'POST',
                            headers: authHeaders,
                            body: JSON.stringify({ payloadId: uploadRes.json.payloadId })
                        },
                        { label: 'Dispatch retry with payloadId', maxAttempts: 12 }
                    );
                    dispatchRes = retryResult.res;
                    rawDispatchText = retryResult.rawText;
                    dispatchData = retryResult.json;
                }
            }
        } finally {
            clearInterval(dispatchInterval);
        }

        if (!dispatchRes.ok) {
            let errorText = dispatchData?.error || dispatchData?.message || '';
            if (!errorText) {
                // Strip HTML tags if HTML error page was returned
                errorText = rawDispatchText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
            }
            throw new Error(errorText || `Server responded with ${dispatchRes.status}`);
        }

        if (!dispatchData || typeof dispatchData !== 'object' || !dispatchData.jobId) {
            const preview = rawDispatchText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
            throw new Error(`Unexpected server response (${dispatchRes.status}): ${preview || 'Empty response'}`);
        }
        const jobId = dispatchData.jobId;
        dispatchedJobId = jobId;
        const jobProvider = dispatchData.provider || dispatchData.mode || provider;

        // Persist job locally so user can retrieve it even after closing/reopening the app
        upsertStoredCloudRender({
            id: jobId,
            userId,
            title: videoTitle,
            resolution,
            durationSeconds: Math.round(totalDurationSec),
            minutesConsumed: minutesToDeduct,
            status: dispatchData.status || 'rendering',
            progress: dispatchData.status === 'queued' ? 0 : 0.1,
            queuePosition: dispatchData.queuePosition,
            provider: jobProvider,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        // Initialize background tracking loop
        initCloudRenderBackgroundTracker();

        // High-visibility status toast informing the user they can navigate away or close the tab
        ui.showStatus(`🚀 Cloud export (Beta) started for "${videoTitle}"! You can close this tab or keep working — track progress anytime in Profile → Cloud Renders.`, false, 9000);

        // Customize the cancel/dismiss button into "Run in Background"
        if (dom.progressCancelBtn) {
            dom.progressCancelBtn.textContent = 'Run in Background (Safe to Close)';
            dom.progressCancelBtn.className = 'bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-1.5 px-5 text-xs rounded-lg transition cursor-pointer shadow-lg inline-flex items-center gap-1.5';
        }
        state.cancelProcessingCallback = () => {
            ui.closeProcessingModal();
            ui.setButtonsDisabled(false);
            ui.showStatus(`⚡ Cloud render (Beta) for "${videoTitle}" is running in the background. Open Profile → Cloud Renders to track status or download.`, false, 7000);
            return true;
        };

        if (dispatchData.warning) {
            ui.updateProcessingProgress(35, `⚠️ ${dispatchData.warning}`);
        } else if (dispatchData.status === 'queued') {
            const queueMsg = dispatchData.queuePosition
                ? `⏳ Queued in render line (Position #${dispatchData.queuePosition})...`
                : '⏳ Queued in render line (Processing sequentially)...';
            ui.updateProcessingProgress(35, queueMsg);
        } else {
            ui.updateProcessingProgress(35, `🚀 Cloud render initialized! (Track in Profile → Cloud Renders)`);
        }

        // 3. Poll for progress until complete
        let isDone = false;
        let attempts = 0;
        let consecutive404s = 0;
        const maxAttempts = 600; // 15 minutes max polling for large videos

        activeForegroundJobIds.add(jobId);
        try {
            while (!isDone && attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 1500));
                attempts++;

                const statusAuthHeaders = await getCloudRenderAuthHeaders({});
                const statusRes = await fetch(cloudRenderUrl(`/api/cloud-render/status/${jobId}`), {
                    headers: statusAuthHeaders
                });
                if (!statusRes.ok) {
                    if (statusRes.status === 404) {
                        consecutive404s++;
                        if (consecutive404s >= 4) {
                            throw new Error('Cloud render job expired or server container restarted.');
                        }
                    }
                    continue;
                }
                consecutive404s = 0;

                const statusContentType = statusRes.headers.get('content-type') || '';
                if (!statusContentType.includes('application/json')) {
                    continue; // Skip transient HTML proxy errors (e.g. 502/504 Bad Gateway from CDN) without crashing polling
                }
                const statusData = await statusRes.json().catch(() => null);
                if (!statusData) continue;
                const isQueued = statusData.status === 'queued';
                const rawProg = Number(statusData.progress) || 0;
                // Normalize progress to a 0.0 - 1.0 float regardless of whether the backend sent 0-100 or 0.0-1.0
                const normProg = rawProg > 1 ? Math.min(1, rawProg / 100) : Math.max(0, rawProg);
                const displayPct = Math.round(normProg * 100);
                const modalBarPct = isQueued ? 35 : Math.round(35 + normProg * 60);

                let renderPhase = `Rendering via ${providerLabel}... ${displayPct}%`;
                if (displayPct <= 2) {
                    renderPhase = `⚡ Warming up ${providerLabel} workers & caching scene textures (0%)...`;
                } else if (displayPct < 90) {
                    renderPhase = `⚡ Rendering frame chunks across ${providerLabel}: ${displayPct}%`;
                } else {
                    renderPhase = `🎬 Multiplexing audio & assembling final MP4 (${displayPct}%)...`;
                }

                const statusMsg = isQueued
                    ? (statusData.queuePosition ? `⏳ In queue (Position #${statusData.queuePosition})...` : '⏳ Waiting in render queue...')
                    : `${renderPhase} (Track in Profile → Cloud Renders)`;
                ui.updateProcessingProgress(modalBarPct, statusMsg);

                upsertStoredCloudRender({
                    id: jobId,
                    userId,
                    title: videoTitle,
                    resolution,
                    durationSeconds: Math.round(totalDurationSec),
                    minutesConsumed: minutesToDeduct,
                    status: statusData.status || 'rendering',
                    progress: normProg,
                    queuePosition: statusData.queuePosition,
                    provider: jobProvider,
                    outputUrl: statusData.outputUrl,
                    error: statusData.error,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });

                if (statusData.status === 'done') {
                    isDone = true;
                    ui.updateProcessingProgress(100, 'Cloud render complete! Finalizing download...');
                    
                    ui.showStatus(`🎉 Cloud render complete for "${videoTitle}"! Used ${minutesToDeduct} min. Remaining: ${Math.max(0, currentQuota - (state.renderMinutesUsed || 0))} min.`, false, 6000);

                    if (statusData.outputUrl || jobId) {
                        triggerDirectVideoDownload(statusData.outputUrl || '', `${videoTitle}.mp4`, jobId);
                    }
                    break;
                } else if (statusData.status === 'failed') {
                    throw new Error(statusData.error || 'Cloud render failed on Google Cloud Run worker');
                }
            }

            if (!isDone) {
                throw new Error('Cloud render request timed out. Please check your admin logs.');
            }
        } finally {
            activeForegroundJobIds.delete(jobId);
        }

    } catch (err: any) {
        const errorDetail = (err?.message && String(err.message).trim())
            || (typeof err === 'string' && err.trim())
            || (err?.error && typeof err.error === 'string' && err.error.trim())
            || (err?.error?.message && String(err.error.message).trim())
            || (err && typeof err === 'object' && Object.keys(err).length > 0 ? JSON.stringify(err) : '')
            || 'Cloud render failed on worker. Check your Lambda/S3 configuration.';

        console.error('[Cloud Render] Error during cloud render flow:', errorDetail, err);
        let refundMsg = '';
        if (minutesDeducted) {
            try {
                const refundRes = await refundRenderMinutesSecure(minutesToDeduct, `Cloud render failed: ${errorDetail}`);
                refundMsg = `\n💰 ${minutesToDeduct} minute(s) automatically refunded to your quota (Remaining: ${refundRes.remaining}m).`;
                if (dispatchedJobId) {
                    upsertStoredCloudRender({
                        id: dispatchedJobId,
                        userId,
                        title: videoTitle,
                        resolution,
                        durationSeconds: Math.round(totalDurationSec),
                        minutesConsumed: minutesToDeduct,
                        status: 'failed',
                        progress: 0,
                        provider: 'aws_lambda',
                        error: errorDetail,
                        refunded: true,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                }
            } catch (refundErr) {
                console.error('[Cloud Render] Failed to refund render minutes:', refundErr);
            }
        }
        ui.showStatus(`Cloud Render failed: ${errorDetail}.${refundMsg}`, true, 9000);
    } finally {
        state.isCloudRenderActive = false;
        ui.setButtonsDisabled(false);
        ui.closeProcessingModal();
    }
}
