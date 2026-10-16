/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { cloudRenderUrl, getCloudRenderAuthHeaders } from './cloud-render-api-base';
import * as ui from '../ui';

/**
 * Triggers a direct browser file download for a rendered cloud video.
 * Uses a 2-tier strategy:
 * 1. Blob fetch + ObjectURL with <a download="..."> (direct instant save without navigating/playing in browser).
 * 2. Backend attachment stream proxy (/api/cloud-render/stream-download) if CORS blocks direct blob creation.
 */
export async function triggerDirectVideoDownload(url: string, filename: string, jobId?: string) {
    const targetUrl = url && url !== '#' ? url : (jobId ? cloudRenderUrl(`/api/cloud-render/download/${encodeURIComponent(jobId)}`) : '');
    
    if (!targetUrl) {
        ui.showStatus('Download URL is unavailable or expired.', true, 4000);
        return;
    }

    const safeName = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
    ui.showStatus(`⬇️ Starting download: ${safeName}...`, false, 3000);

    // Tier 1: If direct URL is available, try fetching as Blob for instant, seamless local download
    if (url && url !== '#' && (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:'))) {
        try {
            const response = await fetch(url, { mode: 'cors' });
            if (response.ok) {
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = blobUrl;
                a.download = safeName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
                return;
            }
        } catch (err) {
            console.info('[Direct Download] Blob fetch note, trying stream proxy:', err);
        }
    }

    // Tier 2: Try backend attachment stream endpoints
    const candidateEndpoints: string[] = [];
    if (jobId) {
        candidateEndpoints.push(cloudRenderUrl(`/api/cloud-render/download/${encodeURIComponent(jobId)}`));
        candidateEndpoints.push(cloudRenderUrl(`/api/cloud-render/stream-download?jobId=${encodeURIComponent(jobId)}`));
    }

    for (const endpoint of candidateEndpoints) {
        try {
            const authHeaders = await getCloudRenderAuthHeaders({});
            const res = await fetch(endpoint, { headers: authHeaders });
            if (res.ok) {
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = blobUrl;
                a.download = safeName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
                return;
            }
        } catch (endpointErr) {
            console.warn(`[Direct Download] Endpoint ${endpoint} failed:`, endpointErr);
        }
    }

    // Tier 3: Fallback to direct window open in a new tab so user can watch & download directly
    if (url && url !== '#') {
        window.open(url, '_blank', 'noopener,noreferrer');
    } else if (jobId) {
        window.open(cloudRenderUrl(`/api/cloud-render/download/${encodeURIComponent(jobId)}`), '_blank');
    }
}
