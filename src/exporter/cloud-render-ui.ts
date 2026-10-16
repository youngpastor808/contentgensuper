/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import * as ui from '../ui';
import { escapeHtml } from '../utils';
import { currentUser, refundRenderMinutesSecure } from '../auth';
import { clearAllStoredCloudRenders, deleteStoredCloudRender, getStoredCloudRenders, saveStoredCloudRenders } from './cloud-render-store';
import { cloudRenderUrl, getCloudRenderAuthHeaders } from './cloud-render-api-base';
import { triggerDirectVideoDownload } from './cloud-render-download';

export function normalizeProgress(p: number | undefined): number {
    const num = Number(p) || 0;
    return num > 1 ? Math.min(1, num / 100) : Math.max(0, num);
}

export function formatDurationSeconds(sec: number): string {
    const mins = Math.floor(sec / 60);
    const remainingSecs = Math.floor(sec % 60);
    return `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
}

export function formatRelativeTime(timestamp: number): string {
    const sec = Math.floor((Date.now() - timestamp) / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function formatCloudExpiryTime(createdAt: number): string {
    const retentionHours = 48; // 2 days lifecycle rule on bucket
    const expiresAt = createdAt + retentionHours * 60 * 60 * 1000;
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) return 'Expired (Purged by 48h lifecycle)';
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    if (remainingHours < 24) return `Expires in ${remainingHours}h`;
    return `Expires in ~${Math.ceil(remainingHours / 24)}d (${remainingHours}h)`;
}

export function formatErrorSummary(rawError?: string): { summary: string; fullDetails: string } {
    if (!rawError) return { summary: 'Cloud render worker error', fullDetails: '' };
    const err = String(rawError).trim();
    if (err.includes('AccessDenied') || err.includes('Access Denied') || (err.includes('getStaticCompositions') && err.includes('s3.'))) {
        return {
            summary: 'AWS S3 Access Denied: Check REMOTION_SERVE_URL & S3 Bucket Policy',
            fullDetails: err
        };
    }
    if (err.includes('client_email') || err.includes('credentials') || err.includes('InvalidCredentials')) {
        return {
            summary: 'Cloud Credentials Error: Check API keys / Service Account permissions',
            fullDetails: err
        };
    }
    if (err.includes('timeout') || err.includes('Timed out')) {
        return {
            summary: 'Render timed out: Increase function timeout or retry',
            fullDetails: err
        };
    }
    // Clean raw XML or HTML tags
    const clean = err.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return {
        summary: clean.length > 75 ? `${clean.slice(0, 72)}...` : clean || 'Worker error',
        fullDetails: err
    };
}


export async function loadCloudDiagnostics() {
    const badge = document.getElementById('cloud-renders-config-badge');
    const summary = document.getElementById('cloud-diagnostics-summary');
    const varsContainer = document.getElementById('cloud-diagnostics-vars');
    if (!badge) return;

    try {
        const res = await fetch(cloudRenderUrl('/api/cloud-render/config'));
        if (!res.ok) return;
        const config = await res.json().catch(() => null);
        if (!config) return;

        const lambda = config.awsLambda || {};
        const isConfigured = Boolean(lambda.configured);

        if (isConfigured) {
            badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 flex items-center gap-1';
            badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> AWS Lambda: Connected';
            if (summary) {
                summary.className = 'text-[11px] font-mono text-emerald-400';
                summary.textContent = `Connected (${lambda.region || 'us-east-1'})`;
            }
        } else {
            badge.className = 'px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-700/50 flex items-center gap-1';
            badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> In-Memory Fallback (Setup Pending)';
            if (summary) {
                summary.className = 'text-[11px] font-mono text-amber-400';
                summary.textContent = 'Fallback Mode (Missing Variables)';
            }
        }

        if (varsContainer) {
            const vars = [
                { name: 'REMOTION_AWS_ACCESS_KEY_ID', set: Boolean(lambda.hasCredentials), val: lambda.hasCredentials ? 'Configured' : 'Missing' },
                { name: 'REMOTION_AWS_SECRET_ACCESS_KEY', set: Boolean(lambda.hasCredentials), val: lambda.hasCredentials ? 'Configured' : 'Missing' },
                { name: 'REMOTION_AWS_REGION', set: Boolean(lambda.region), val: lambda.region || 'us-east-1' },
                { name: 'REMOTION_FUNCTION_NAME', set: Boolean(lambda.functionName), val: lambda.functionName || 'Missing' },
                { name: 'REMOTION_SERVE_URL', set: Boolean(lambda.hasServeUrl), val: lambda.hasServeUrl ? 'Configured' : 'Missing' }
            ];

            varsContainer.innerHTML = vars.map(v => `
                <div class="flex items-center justify-between p-1.5 rounded bg-zinc-900 border ${v.set ? 'border-emerald-800/40' : 'border-amber-800/40'}">
                    <span class="text-zinc-300 flex items-center gap-1">
                        <span class="${v.set ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}">${v.set ? '✓' : '✗'}</span>
                        ${v.name}
                    </span>
                    <span class="${v.set ? 'text-emerald-300 font-mono text-[10px]' : 'text-amber-300 font-mono text-[10px]'}">${v.val}</span>
                </div>
            `).join('');
        }
    } catch (e) {
        console.warn('Failed to load cloud render config diagnostics:', e);
    }
}


export async function openCloudRenderHistoryModal() {
    const modal = document.getElementById('cloud-renders-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const quotaLabel = document.getElementById('cloud-renders-quota-label');
    if (quotaLabel) {
        const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
        const used = state.renderMinutesUsed || 0;
        quotaLabel.textContent = `${Math.max(0, Math.round(quota - used))} mins remaining`;
    }

    loadCloudDiagnostics();
    await refreshCloudRendersList();
}


export function closeCloudRenderHistoryModal() {
    const modal = document.getElementById('cloud-renders-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}


export async function refreshCloudRendersList() {
    const listEl = document.getElementById('cloud-renders-list');
    const emptyEl = document.getElementById('cloud-renders-empty-state');
    const refreshBtn = document.getElementById('refresh-cloud-renders-btn');
    const refreshIcon = document.getElementById('refresh-cloud-renders-icon');
    if (!listEl || !emptyEl) return;

    if (refreshIcon) {
        refreshIcon.classList.add('animate-spin');
    }
    if (refreshBtn) {
        refreshBtn.setAttribute('disabled', 'true');
        refreshBtn.classList.add('opacity-75', 'cursor-not-allowed');
    }

    const uid = currentUser?.uid || 'anonymous';
    let localRenders = getStoredCloudRenders(uid);

    // Fetch from backend to sync any background progress from Google Cloud Run
    try {
        const authHeaders = await getCloudRenderAuthHeaders({});
        const res = await fetch(cloudRenderUrl(`/api/cloud-render/jobs?userId=${encodeURIComponent(uid)}`), {
            headers: authHeaders
        });
        if (res.ok) {
            const data = await res.json().catch(() => null);
            if (!data) return;
            const serverJobs: any[] = data.jobs || [];

            for (const sJob of serverJobs) {
                const idx = localRenders.findIndex(r => r.id === sJob.id);
                if (idx >= 0) {
                    localRenders[idx] = {
                        ...localRenders[idx],
                        status: sJob.status,
                        progress: normalizeProgress(sJob.progress),
                        outputUrl: sJob.outputUrl || localRenders[idx].outputUrl,
                        error: sJob.error,
                        updatedAt: sJob.updatedAt || Date.now()
                    };
                } else {
                    localRenders.push({
                        id: sJob.id,
                        userId: sJob.userId,
                        title: sJob.title || 'Cloud Video Export',
                        resolution: sJob.resolution || '1080p',
                        durationSeconds: sJob.durationSeconds || 0,
                        minutesConsumed: sJob.minutesConsumed || 1,
                        status: sJob.status,
                        progress: normalizeProgress(sJob.progress),
                        provider: sJob.provider || 'google_cloud_run',
                        outputUrl: sJob.outputUrl,
                        error: sJob.error,
                        createdAt: sJob.createdAt || Date.now(),
                        updatedAt: sJob.updatedAt || Date.now()
                    });
                }
            }
            saveStoredCloudRenders(localRenders, uid);
        }
    } catch (e) {
        console.warn('[Cloud Render] Failed to sync jobs with server:', e);
    }

    // For any actively queued/rendering jobs, poll individual status endpoint
    for (const job of localRenders) {
        if (job.status === 'rendering' || job.status === 'queued') {
            try {
                const authHeaders = await getCloudRenderAuthHeaders({});
                const statusRes = await fetch(cloudRenderUrl(`/api/cloud-render/status/${job.id}`), {
                    headers: authHeaders
                });
                if (statusRes.ok) {
                    const statusContentType = statusRes.headers.get('content-type') || '';
                    if (!statusContentType.includes('application/json')) continue;
                    const statusData = await statusRes.json().catch(() => null);
                    if (!statusData) continue;
                    job.progress = normalizeProgress(statusData.progress ?? job.progress);
                    job.status = statusData.status || job.status;
                    job.queuePosition = statusData.queuePosition;
                    if (statusData.outputUrl) job.outputUrl = statusData.outputUrl;
                    if (statusData.error) job.error = statusData.error;
                    job.updatedAt = Date.now();
                } else if (statusRes.status === 404) {
                    // Job is not found in server memory (expired or server container restarted)
                    job.status = 'failed';
                    job.error = 'Render job expired or server restarted';
                    job.updatedAt = Date.now();
                }
            } catch (err) {
                console.warn(`[Cloud Render] Failed to poll status for ${job.id}:`, err);
            }
        }
    }
    saveStoredCloudRenders(localRenders, uid);

    // Stop refresh animation
    if (refreshIcon) {
        setTimeout(() => {
            refreshIcon.classList.remove('animate-spin');
        }, 300);
    }
    if (refreshBtn) {
        setTimeout(() => {
            refreshBtn.removeAttribute('disabled');
            refreshBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }, 300);
    }

    // Sort by latest first
    localRenders.sort((a, b) => b.createdAt - a.createdAt);

    if (localRenders.length === 0) {
        emptyEl.classList.remove('hidden');
        listEl.innerHTML = '';
        return;
    }

    emptyEl.classList.add('hidden');
    listEl.innerHTML = localRenders.map(render => {
        const durationFormatted = formatDurationSeconds(render.durationSeconds);
        const timeAgo = formatRelativeTime(render.createdAt);
        const expiryText = formatCloudExpiryTime(render.createdAt);
        const safeTitle = escapeHtml(render.title || 'Cloud Video Export');

        let statusHtml = '';
        let errorDetailsHtml = '';

        if (render.status === 'done') {
            const directUrl = render.outputUrl || '';
            statusHtml = `
                <div class="flex items-center gap-2">
                    <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 flex items-center gap-1">
                        <span>✓</span> Ready
                    </span>
                    ${directUrl && directUrl !== '#' ? `
                    <a href="${escapeHtml(directUrl)}" target="_blank" rel="noopener noreferrer" class="h-8 px-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer select-none" title="Open and watch video in a new browser tab">
                        <svg class="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                        <span>Open Tab</span>
                    </a>` : ''}
                    <button type="button" class="download-cloud-render-btn h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer select-none" data-output-url="${escapeHtml(directUrl)}" data-video-title="${safeTitle}" data-render-id="${escapeHtml(render.id)}" title="Directly save video file to your device">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        <span>Download</span>
                    </button>
                </div>
            `;
        } else if (render.status === 'queued') {
            const queueLabel = render.queuePosition ? `Queued (#${render.queuePosition} in line)` : 'Queued in line';
            statusHtml = `
                <div class="space-y-1 sm:text-right">
                    <div class="flex items-center gap-1.5 sm:justify-end">
                        <span class="inline-block w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
                        <span class="text-xs font-bold text-sky-300">${queueLabel}</span>
                    </div>
                    <div class="w-36 sm:w-44 bg-zinc-800 rounded-full h-1.5 overflow-hidden border border-zinc-700">
                        <div class="bg-sky-500 h-full rounded-full animate-pulse" style="width: 25%"></div>
                    </div>
                    <p class="text-[10px] text-zinc-400">Sequential render queue</p>
                </div>
            `;
        } else if (render.status === 'rendering') {
            const pct = Math.round(normalizeProgress(render.progress || 0.05) * 100);
            statusHtml = `
                <div class="space-y-1 sm:text-right">
                    <div class="flex items-center gap-1.5 sm:justify-end">
                        <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                        <span class="text-xs font-bold text-amber-300">Rendering (${pct}%)</span>
                    </div>
                    <div class="w-36 sm:w-44 bg-zinc-800 rounded-full h-1.5 overflow-hidden border border-zinc-700">
                        <div class="bg-indigo-500 h-full rounded-full transition-all duration-300" style="width: ${pct}%"></div>
                    </div>
                    <p class="text-[10px] text-zinc-400">Safe to close window</p>
                </div>
            `;
        } else {
            const { summary, fullDetails } = formatErrorSummary(render.error);
            statusHtml = `
                <div class="flex flex-col sm:items-end">
                    <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-950/80 text-red-300 border border-red-700/50">
                        Render Failed
                    </span>
                    ${render.refunded ? `<span class="text-[10px] text-emerald-400 font-mono font-medium mt-0.5">✓ ${render.minutesConsumed}m Refunded</span>` : ''}
                </div>
            `;
            errorDetailsHtml = `
                <div class="mt-2.5 pt-2.5 border-t border-red-900/30 w-full text-left">
                    <div class="flex items-start gap-1.5 text-xs text-red-300">
                        <span class="text-sm shrink-0">⚠️</span>
                        <div class="flex-1 min-w-0">
                            <span class="font-medium text-xs text-red-200 break-words">${escapeHtml(summary)}</span>
                            ${fullDetails ? `
                                <details class="mt-1">
                                    <summary class="text-[10px] text-red-400 hover:text-red-300 cursor-pointer font-mono select-none hover:underline inline-flex items-center gap-1">
                                        <span>Show diagnostics & raw error</span>
                                    </summary>
                                    <pre class="mt-1.5 p-2 rounded-lg bg-black/60 border border-red-800/40 text-[10px] font-mono text-red-300/90 max-h-32 overflow-y-auto whitespace-pre-wrap break-all select-all custom-scrollbar">${escapeHtml(fullDetails)}</pre>
                                </details>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="bg-zinc-800/80 border ${render.status === 'failed' ? 'border-red-900/50 hover:border-red-800/70' : 'border-zinc-700/80 hover:border-zinc-600'} rounded-xl p-3.5 sm:p-4 flex flex-col gap-1 transition-colors group w-full overflow-hidden">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 min-w-0 w-full">
                    <div class="space-y-1.5 flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h4 class="text-sm font-bold text-white truncate max-w-[240px] sm:max-w-xs" title="${safeTitle}">${safeTitle}</h4>
                            <span class="text-[10px] font-mono font-bold bg-indigo-950/80 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-700/40 uppercase">${escapeHtml(render.resolution || '1080p')}</span>
                            ${render.provider === 'headless' || render.provider === 'in-memory' || render.provider === 'local_fallback' 
                                ? '<span class="text-[9px] font-mono font-semibold bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded border border-amber-700/40">⚡ Headless (2x)</span>' 
                                : render.provider === 'aws' || render.provider === 'aws-lambda' 
                                ? '<span class="text-[9px] font-mono font-semibold bg-sky-950/80 text-sky-300 px-1.5 py-0.5 rounded border border-sky-700/40">☁️ AWS Lambda</span>' 
                                : '<span class="text-[9px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-700/40">☁️ GCP Cloud Run</span>'}
                        </div>
                        <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                            <span>⏱️ ${durationFormatted}</span>
                            <span>•</span>
                            <span>${render.status === 'failed' && render.refunded ? `<span class="text-emerald-400 font-medium">Refunded (${render.minutesConsumed}m)</span>` : `Deducted: ${render.minutesConsumed}m`}</span>
                            <span>•</span>
                            <span>${timeAgo}</span>
                        </div>
                        <div class="text-[11px] text-amber-300/80 flex items-center gap-1 font-mono pt-0.5">
                            <svg class="w-3 h-3 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span>${expiryText}</span>
                        </div>
                    </div>
                    <div class="shrink-0 flex items-center gap-2 self-end sm:self-center">
                        ${statusHtml}
                        <button type="button" class="delete-cloud-render-btn h-8 w-8 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/50 border border-transparent hover:border-red-800/40 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0" data-render-id="${render.id}" title="Delete this cloud render">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </div>
                ${errorDetailsHtml}
            </div>
        `;
    }).join('');

    // Attach click listeners to download buttons
    listEl.querySelectorAll<HTMLButtonElement>('.download-cloud-render-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const outputUrl = btn.getAttribute('data-output-url');
            const videoTitle = btn.getAttribute('data-video-title') || 'AI Studio Video';
            const renderId = btn.getAttribute('data-render-id') || undefined;
            if (outputUrl || renderId) {
                triggerDirectVideoDownload(outputUrl || '', `${videoTitle}.mp4`, renderId);
            }
        });
    });

    // Attach click listeners to individual delete buttons
    listEl.querySelectorAll<HTMLButtonElement>('.delete-cloud-render-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const renderId = btn.getAttribute('data-render-id');
            if (!renderId) return;

            const targetRender = localRenders.find(r => r.id === renderId);
            const renderTitle = targetRender?.title || 'this cloud render';

            ui.showConfirmation(
                'Delete Cloud Render',
                `Are you sure you want to delete "${renderTitle}"? This will remove it from your history and free its cloud storage.`,
                () => {
                    deleteCloudRenderItem(renderId);
                }
            );
        });
    });
}


// Module-level guard and set of job IDs currently polled by the foreground loop
let backgroundTrackerRunning = false;
let backgroundTrackerTimer: any = null;
export const activeForegroundJobIds = new Set<string>();

// Automatically check for incomplete background renders when opening the studio or dispatching jobs
export function initCloudRenderBackgroundTracker() {
    if (backgroundTrackerRunning) return; // already tracking — don't start a duplicate loop

    const uid = currentUser?.uid || 'anonymous';
    const renders = getStoredCloudRenders(uid);
    const activeJobs = renders.filter(r => (r.status === 'rendering' || r.status === 'queued') && !activeForegroundJobIds.has(r.id));

    if (activeJobs.length === 0) return;

    backgroundTrackerRunning = true;
    let pollCount = 0;

    if (backgroundTrackerTimer) clearInterval(backgroundTrackerTimer);
    backgroundTrackerTimer = setInterval(async () => {
        pollCount++;
        let hasActive = false;
        const currentRenders = getStoredCloudRenders(uid);

        for (const job of currentRenders) {
            if (job.status !== 'rendering' && job.status !== 'queued') continue;

            // Skip jobs that are actively being polled by the foreground while loop
            if (activeForegroundJobIds.has(job.id)) {
                hasActive = true;
                continue;
            }

            try {
                const authHeaders = await getCloudRenderAuthHeaders({});
                const res = await fetch(cloudRenderUrl(`/api/cloud-render/status/${job.id}`), {
                    headers: authHeaders
                });
                if (!res.ok) continue;
                const data = await res.json().catch(() => null);
                if (!data) continue;

                job.progress = normalizeProgress(data.progress ?? job.progress);
                job.status = data.status || job.status;
                job.updatedAt = Date.now();

                if (data.status === 'done') {
                    job.outputUrl = data.outputUrl;
                    ui.showStatus(`🎉 Your cloud render for "${job.title}" is ready! Open Cloud Renders to download.`, false, 9000);
                } else if (data.status === 'failed') {
                    job.error = data.error || 'Worker error';
                    if (!job.refunded && job.minutesConsumed > 0) {
                        try {
                            const refundRes = await refundRenderMinutesSecure(job.minutesConsumed, `Background cloud render failed: ${job.error}`);
                            job.refunded = true;
                            ui.showStatus(`⚠️ Cloud render for "${job.title}" failed. ${job.minutesConsumed}m quota has been refunded (${refundRes.remaining}m remaining).`, true, 8000);
                        } catch (refundErr) {
                            console.error('[Cloud Render Tracker] Failed to refund render minutes:', refundErr);
                        }
                    }
                } else {
                    hasActive = true;
                }
            } catch {}
        }

        saveStoredCloudRenders(currentRenders, uid);

        // Update modal list if it's currently open
        const modal = document.getElementById('cloud-renders-modal');
        if (modal && !modal.classList.contains('hidden')) {
            refreshCloudRendersList();
        }

        if (!hasActive || pollCount > 120) {
            if (backgroundTrackerTimer) clearInterval(backgroundTrackerTimer);
            backgroundTrackerTimer = null;
            backgroundTrackerRunning = false; // release guard so future dispatches can spin up tracker
        }
    }, 4000);
}


export async function deleteCloudRenderItem(renderId: string) {
    const uid = currentUser?.uid || 'anonymous';
    deleteStoredCloudRender(renderId, uid);
    
    // Also instruct server to prune active job and free any temporary export media
    try {
        const authHeaders = await getCloudRenderAuthHeaders({});
        await fetch(cloudRenderUrl(`/api/cloud-render/jobs/${encodeURIComponent(renderId)}?userId=${encodeURIComponent(uid)}`), {
            method: 'DELETE',
            headers: authHeaders
        });
    } catch (e) {
        console.warn('[Cloud Render] Server job deletion note:', e);
    }

    await refreshCloudRendersList();
    ui.showStatus('Cloud render deleted', false, 3000);
}


export async function clearAllCloudRenders() {
    const uid = currentUser?.uid || 'anonymous';
    clearAllStoredCloudRenders(uid);

    try {
        const authHeaders = await getCloudRenderAuthHeaders({});
        await fetch(cloudRenderUrl(`/api/cloud-render/jobs?userId=${encodeURIComponent(uid)}`), {
            method: 'DELETE',
            headers: authHeaders
        });
    } catch (e) {
        console.warn('[Cloud Render] Clear all jobs note:', e);
    }

    await refreshCloudRendersList();
    ui.showStatus('All cloud renders cleared', false, 3000);
}
