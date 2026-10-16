/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';
import * as utils from '../utils';


export function isStreamingSupported(): boolean {
    const isAvailable = 'showSaveFilePicker' in window;
    if (!isAvailable) return false;
    try {
        return window.self === window.top;
    } catch (e) {
        return false;
    }
}


export function hasOpfsWritableSupport(): boolean {
    try {
        const FSFH = (globalThis as any).FileSystemFileHandle;
        return typeof navigator !== 'undefined'
            && !!(navigator as any).storage?.getDirectory
            && typeof FSFH !== 'undefined'
            && typeof FSFH.prototype?.createWritable === 'function';
    } catch (e) {
        return false;
    }
}


export async function purgeStaleOpfsExports(root: any): Promise<void> {
    try {
        const now = Date.now();
        const tenMinutes = 10 * 60 * 1000;
        for await (const entry of root.values()) {
            if (entry.name.startsWith('contentgen-export-')) {
                const parts = entry.name.split('-');
                if (parts.length >= 3) {
                    const timestamp = parseInt(parts[2]);
                    if (!isNaN(timestamp) && (now - timestamp) > tenMinutes) {
                        try {
                            await root.removeEntry(entry.name);
                        } catch (err) {
                            console.warn(`[OPFS] Failed to remove stale entry: ${entry.name}`, err);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[OPFS] Error purging stale files:', e);
    }
}


export async function tryInitOpfsExport(
    filename: string,
    projectedBytes: number
): Promise<{ stream: FileSystemWritableFileStream; handle: any } | null> {
    try {
        const storage: any = (navigator as any).storage;
        if (!storage?.getDirectory) return null;

        if (typeof storage.estimate === 'function') {
            const est = await storage.estimate();
            const free = (est?.quota || 0) - (est?.usage || 0);
            // close() swaps a temp file into place, so both copies can exist at once.
            if (free < projectedBytes * 2.2) {
                console.warn(`[EXPORT] Origin storage too small for a disk-backed export (${free} free).`);
                return null;
            }
        }

        const root = await storage.getDirectory();
        await purgeStaleOpfsExports(root);

        const safeName = filename.replace(/[^\w.-]/g, '_');
        const handle = await root.getFileHandle(`contentgen-export-${Date.now()}-${safeName}`, { create: true });
        const stream: FileSystemWritableFileStream = await handle.createWritable();
        return { stream, handle };
    } catch (e) {
        console.warn('[EXPORT] OPFS export unavailable, falling back to memory:', e);
        return null;
    }
}


export async function deliverOpfsExport(handle: any, filename: string): Promise<void> {
    const file: File = await handle.getFile();
    if (!file || file.size < 4096) {
        throw new Error(`Export produced an invalid video file (${file?.size || 0} bytes). Check that timeline shots are loaded.`);
    }

    await utils.downloadBlob(file, filename, { category: 'Videos' });

    // Removing the entry can invalidate the object URL downloadBlob just handed
    // the browser, so leave it until the transfer has had time to finish; the
    // next export purges anything still here.
    setTimeout(async () => {
        try {
            const root: any = await (navigator as any).storage.getDirectory();
            await root.removeEntry(handle.name);
        } catch (e) { /* purged on next export */ }
    }, 60000);
}


export class StreamingTarget {
    private stream: FileSystemWritableFileStream;

    constructor(stream: FileSystemWritableFileStream) {
        this.stream = stream;
    }

    async write(data: Uint8Array): Promise<void> {
        await this.stream.write(data as any);
    }

    async seek(offset: number): Promise<void> {
        await this.stream.seek(offset);
    }

    async close(): Promise<void> {
        await this.stream.close();
    }
}



export async function tryInitStreamingExport(
    filename: string,
    format: 'mp4' | 'webm'
): Promise<FileSystemWritableFileStream | null> {
    if (!isStreamingSupported()) {
        console.log('📦 File System Access API not available, using memory export');
        return null;
    }

    try {
        let handle: any = null;
        if (state.exportDirectoryHandle) {
            try {
                handle = await state.exportDirectoryHandle.getFileHandle(filename, { create: true });
            } catch (err: any) {
                console.warn('Failed to create file in selected directory', err);
            }
        }
        
        if (!handle) {
            handle = await (window as any).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Video Files',
                    accept: format === 'mp4'
                        ? { 'video/mp4': ['.mp4'] }
                        : { 'video/webm': ['.webm'] }
                }]
            });
        }
        return await handle.createWritable();
    } catch (err: any) {

        if (err.name === 'AbortError') {
            console.log('User cancelled file picker');
            return null;
        }
        if (err.name === 'SecurityError' || err.message.includes('Cross origin sub frames')) {
            console.log('📦 Streaming export blocked by iframe restrictions. Falling back to memory export.');
            return null;
        }
        console.warn('Failed to initialize streaming:', err);
        return null;
    }
}


export class ChunkedMemoryTarget {
    private chunks: { data: Uint8Array; start: number; end: number }[] = [];
    private pos = 0;

    write(data: Uint8Array): void {
        let chunkPos = this.pos;
        let p = 0;

        for (let i = 0; i < this.chunks.length; i++) {
            const chunk = this.chunks[i];
            if (chunkPos >= chunk.start && chunkPos < chunk.end) {
                const overlap = Math.min(chunk.end - chunkPos, data.length - p);
                chunk.data.set(data.subarray(p, p + overlap), chunkPos - chunk.start);
                p += overlap;
                chunkPos += overlap;
            }
            if (p >= data.length) break;
        }

        if (p < data.length) {
            const slice = data.slice(p);
            this.chunks.push({ data: slice, start: chunkPos, end: chunkPos + slice.length });
            chunkPos += slice.length;
            p = data.length;
        }
        this.pos = chunkPos;
    }

    seek(offset: number): void {
        this.pos = offset;
    }

    getBlob(type: string): Blob {
        this.chunks.sort((a, b) => a.start - b.start);
        const blob = new Blob(this.chunks.map(c => c.data as any), { type });
        this.chunks = [];
        this.pos = 0;
        return blob;
    }
}
