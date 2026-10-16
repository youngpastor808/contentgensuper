/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ExportStage =
    | 'prepare'
    | 'audio-mix'
    | 'image-prep'
    | 'parallax-prep'
    | 'video-sync'
    | 'frame-render'
    | 'video-encode'
    | 'audio-encode'
    | 'disk-write'
    | 'mux-finalize'
    | 'metadata';

interface StageRecord {
    totalMs: number;
    calls: number;
    maxMs: number;
}

import { getExportFlags } from './export-flags';

const records = new Map<ExportStage, StageRecord>();
const active = new Map<ExportStage, number>();

export function startExportStage(stage: ExportStage): void {
    if (!getExportFlags().enableExportProfiler) return;
    active.set(stage, performance.now());
}

export function endExportStage(stage: ExportStage): void {
    if (!getExportFlags().enableExportProfiler) return;
    const start = active.get(stage);
    if (start === undefined) return;
    active.delete(stage);

    const elapsed = performance.now() - start;
    const existing = records.get(stage) || {
        totalMs: 0,
        calls: 0,
        maxMs: 0
    };

    existing.totalMs += elapsed;
    existing.calls++;
    existing.maxMs = Math.max(existing.maxMs, elapsed);

    records.set(stage, existing);
}

export function resetExportProfiler(): void {
    records.clear();
    active.clear();
}

export function getExportProfilerSummary() {
    return Object.fromEntries(
        Array.from(records.entries()).map(([stage, record]) => [
            stage,
            {
                totalMs: Math.round(record.totalMs),
                calls: record.calls,
                averageMs: record.calls > 0 ? Math.round(record.totalMs / record.calls) : 0,
                maxMs: Math.round(record.maxMs)
            }
        ])
    );
}

export function logExportProfiler(): void {
    if (!getExportFlags().enableExportProfiler) return;
    console.table(getExportProfilerSummary());
}
