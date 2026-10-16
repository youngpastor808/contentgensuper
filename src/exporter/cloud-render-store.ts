/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { currentUser } from '../auth';


// ─── Cloud Renders History & Persistent Downloads ─────────────────────────────

export interface SavedCloudRender {
    id: string;
    userId: string;
    title: string;
    resolution: string;
    durationSeconds: number;
    minutesConsumed: number;
    status: 'queued' | 'rendering' | 'done' | 'failed';
    progress: number;
    queuePosition?: number;
    provider?: string;
    outputUrl?: string;
    error?: string;
    refunded?: boolean;
    createdAt: number;
    updatedAt: number;
}


export const CLOUD_RENDERS_STORAGE_KEY = 'contentgen_cloud_renders_';


export function getStoredCloudRenders(userId?: string): SavedCloudRender[] {
    try {
        const uid = userId || currentUser?.uid || 'anonymous';
        const raw = localStorage.getItem(CLOUD_RENDERS_STORAGE_KEY + uid);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}


export function saveStoredCloudRenders(renders: SavedCloudRender[], userId?: string) {
    try {
        const uid = userId || currentUser?.uid || 'anonymous';
        localStorage.setItem(CLOUD_RENDERS_STORAGE_KEY + uid, JSON.stringify(renders.slice(0, 40)));
    } catch {}
}


export function upsertStoredCloudRender(render: SavedCloudRender) {
    const renders = getStoredCloudRenders(render.userId);
    const existingIdx = renders.findIndex(r => r.id === render.id);
    if (existingIdx >= 0) {
        renders[existingIdx] = { ...renders[existingIdx], ...render, updatedAt: Date.now() };
    } else {
        renders.unshift(render);
    }
    saveStoredCloudRenders(renders, render.userId);
}


export function deleteStoredCloudRender(renderId: string, userId?: string) {
    const uid = userId || currentUser?.uid || 'anonymous';
    const renders = getStoredCloudRenders(uid);
    const updated = renders.filter(r => r.id !== renderId);
    saveStoredCloudRenders(updated, uid);
}


export function clearAllStoredCloudRenders(userId?: string) {
    const uid = userId || currentUser?.uid || 'anonymous';
    saveStoredCloudRenders([], uid);
}
