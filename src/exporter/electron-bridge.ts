/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from '../state';


/** Fire-and-forget IPC to the Electron main process. */
export function electronService(name: string, ...args: any[]) {
    // @ts-ignore
    if (typeof window === 'undefined' || !(window as any).electronAPI) return;
    try {
        // @ts-ignore
        const invoke = (window as any).electronAPI.invoke || (window as any).electronAPI.ipcRenderer?.invoke;
        if (invoke) invoke.call((window as any).electronAPI, name, ...args).catch(() => {});
    } catch (e) {}
}


/** Maps the in-app progress (0-100) onto the OS taskbar. */
export function syncTaskbarProgress(p: number) {
    electronService('set-progress-bar', Math.max(0, Math.min(1, p / 100)));
}

declare class VideoEncoder {
    constructor(init: any);
    configure(config: any): void;
    encode(frame: VideoFrame, options?: any): void;
    flush(): Promise<void>;
    close(): void;
    state: string;
    encodeQueueSize: number;
    static isConfigSupported(config: any): Promise<{ supported: boolean; config?: any }>;
}
declare class AudioEncoder {
    constructor(init: any);
    configure(config: any): void;
    encode(data: any): void;
    flush(): Promise<void>;
    close(): void;
    state: string;
    encodeQueueSize: number;
    static isConfigSupported(config: any): Promise<{ supported: boolean; config?: any }>;
}
declare class VideoFrame {
    constructor(image: CanvasImageSource, init?: any);
    close(): void;
}
declare class AudioData {
    constructor(init: any);
    close(): void;
    duration: number;
}


export function logExportMemory(label: string) {
    try {
        const memory = (performance as any).memory;
        if (!memory) return;
        console.log(
            `[EXPORT MEMORY] ${label}`,
            {
                usedMB: Math.round(memory.usedJSHeapSize / 1024 / 1024),
                totalMB: Math.round(memory.totalJSHeapSize / 1024 / 1024),
                limitMB: Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
            }
        );
    } catch (memErr) {
        console.warn("[EXPORT MEMORY] Failed to read performance.memory:", memErr);
    }
}
