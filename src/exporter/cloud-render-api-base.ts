/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Desktop (Electron) builds fork the app server locally and cannot run
 * headless Chromium reliably across platforms, so cloud-render calls are
 * routed to the real remote server instead of the local one. The web build
 * is untouched — it always uses relative, same-origin URLs.
 */

function isElectronRuntime(): boolean {
    return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

function getRemoteCloudRenderBase(): string {
    const remoteBase = (import.meta as any).env?.VITE_REMOTE_CLOUD_RENDER_BASE_URL as string | undefined;
    if (remoteBase && remoteBase.trim()) {
        return remoteBase.trim().replace(/\/$/, '');
    }
    console.warn(
        '[Cloud Render] Running in the desktop app but VITE_REMOTE_CLOUD_RENDER_BASE_URL is not set. ' +
        'Cloud render calls will fall back to the local desktop server, which cannot run headless ' +
        'Chromium reliably on every platform. Set VITE_REMOTE_CLOUD_RENDER_BASE_URL and rebuild.'
    );
    return '';
}

/**
 * Builds the full URL for a `/api/cloud-render/...` (or `/api/gcs/...`)
 * path. Pass the path starting with `/api/...`.
 */
export function cloudRenderUrl(path: string): string {
    if (isElectronRuntime()) {
        const base = getRemoteCloudRenderBase();
        if (base) return `${base}${path}`;
    }
    return path; // web build: relative, same-origin
}

/**
 * Returns authorization headers for cloud-render API requests.
 * Uses Firebase ID token if authenticated, plus Electron desktop capability headers if applicable.
 */
export async function getCloudRenderAuthHeaders(existingHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...existingHeaders };
    try {
        const { getFirebaseIdToken } = await import('../auth');
        const token = await getFirebaseIdToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
    } catch {
        // Fallback for environments without Firebase token
    }
    return headers;
}

