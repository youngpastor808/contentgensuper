import { state } from './state';
import * as dom from './dom';

const WORKSPACE_STORAGE_KEY = 'contentgen_workspace_root';
let cachedWorkspaceRoot: string | null = null;

export type WorkspaceCategory = 'Projects' | 'Videos' | 'Audio' | 'Assets';

/**
 * Checks if running inside the Google AI Studio / Cloud Run environment.
 */
export function isAIStudioEnvironment(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        Boolean((process.env as any)?.IS_AI_STUDIO) ||
        window.location.hostname.includes('ais-') ||
        window.location.hostname.includes('run.app') ||
        window.location.hostname.includes('ai.studio') ||
        window.location.hostname.includes('aistudio.google')
    );
}

/**
 * Checks if running inside an Electron desktop environment.
 * Strictly returns false if operating in AI Studio / Cloud environment.
 */
export function isElectronEnvironment(): boolean {
    if (isAIStudioEnvironment()) return false;
    return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

/**
 * Helper to invoke Electron IPC commands safely.
 */
function getElectronInvoke(): ((channel: string, ...args: any[]) => Promise<any>) | null {
    if (!isElectronEnvironment()) return null;
    const electron = (window as any).electronAPI;
    return electron.invoke || electron.ipcRenderer?.invoke || null;
}

/**
 * Categorizes a file by extension into one of the 4 workspace subfolders:
 * - Videos: .mp4, .webm, .mov, .mkv, .avi
 * - Audio: .mp3, .wav, .m4a, .ogg, .aac, .flac, .opus, .wma
 * - Projects: .cgproj, .contentgenai, .cgp
 * - Assets: images, captions, json, csv, zip, etc.
 */
export function getCategoryForFilename(filename: string): WorkspaceCategory {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.avi')) {
        return 'Videos';
    }
    if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a') || lower.endsWith('.ogg') || lower.endsWith('.aac') || lower.endsWith('.flac') || lower.endsWith('.opus') || lower.endsWith('.wma')) {
        return 'Audio';
    }
    if (lower.endsWith('.cgproj') || lower.endsWith('.contentgenai') || lower.endsWith('.cgp')) {
        return 'Projects';
    }
    return 'Assets';
}

/**
 * Returns the currently active workspace root, or null if not yet initialized.
 */
export function getWorkspaceRoot(): string | null {
    return cachedWorkspaceRoot || localStorage.getItem(WORKSPACE_STORAGE_KEY) || null;
}

/**
 * Retrieves the workspace root or initializes the default 'ContentGen' folder in user's Documents/Home directory.
 * Creates Projects/, Videos/, Audio/, Assets/ subdirectories and registers the root with Electron.
 */
export async function getOrCreateWorkspaceRoot(): Promise<string | null> {
    const invoke = getElectronInvoke();
    if (!invoke) return null;

    try {
        if (cachedWorkspaceRoot) {
            return cachedWorkspaceRoot;
        }

        let targetRoot = localStorage.getItem(WORKSPACE_STORAGE_KEY);

        if (!targetRoot) {
            let baseFolder = await invoke('get-known-folder', 'documents');
            if (!baseFolder) {
                baseFolder = await invoke('get-known-folder', 'home');
            }
            if (!baseFolder) {
                baseFolder = await invoke('get-known-folder', 'desktop');
            }

            if (baseFolder) {
                const candidate1 = await invoke('path-join', baseFolder, 'ContentGen');
                const candidate2 = await invoke('path-join', baseFolder, 'ContentGen AI');
                const exists1 = await invoke('path-exists', candidate1);
                const exists2 = await invoke('path-exists', candidate2);

                if (exists1) {
                    targetRoot = candidate1;
                } else if (exists2) {
                    targetRoot = candidate2;
                } else {
                    targetRoot = candidate1;
                }
            } else {
                targetRoot = 'ContentGen';
            }
        }

        if (targetRoot) {
            const result = await invoke('register-workspace-root', targetRoot);
            if (result && result.success) {
                cachedWorkspaceRoot = result.rootPath || targetRoot;
                localStorage.setItem(WORKSPACE_STORAGE_KEY, cachedWorkspaceRoot!);
                
                // Keep state.exportDirectoryPath in sync
                state.exportDirectoryPath = cachedWorkspaceRoot;
                if (dom.exportSavePathDisplay) {
                    dom.exportSavePathDisplay.textContent = cachedWorkspaceRoot!;
                }
                
                console.log('[WorkspaceManager] Active workspace root:', cachedWorkspaceRoot);
                return cachedWorkspaceRoot;
            }
        }
    } catch (err) {
        console.error('[WorkspaceManager] Failed to get or create workspace root:', err);
    }

    return null;
}

/**
 * Resolves a destination file path inside the workspace folder with automatic collision handling.
 * If the file already exists, it auto-increments: "Video (2).mp4", "Video (3).mp4", etc.
 */
export async function resolveWorkspacePath(
    filename: string,
    options?: { category?: WorkspaceCategory; forceIncrement?: boolean }
): Promise<string | null> {
    const invoke = getElectronInvoke();
    if (!invoke) return null;

    try {
        const root = await getOrCreateWorkspaceRoot();
        if (!root) return null;

        const category = options?.category || getCategoryForFilename(filename);
        const targetDir = await invoke('path-join', root, category);

        // Parse name and extension
        const lastDot = filename.lastIndexOf('.');
        const baseName = lastDot !== -1 ? filename.substring(0, lastDot) : filename;
        const ext = lastDot !== -1 ? filename.substring(lastDot) : '';

        let candidateName = filename;
        let candidatePath = await invoke('path-join', targetDir, candidateName);
        let counter = 2;

        // Check if file exists to avoid silent overwrite
        while (await invoke('path-exists', candidatePath)) {
            candidateName = `${baseName} (${counter})${ext}`;
            candidatePath = await invoke('path-join', targetDir, candidateName);
            counter++;
            if (counter > 1000) break; // Circuit breaker
        }

        return candidatePath;
    } catch (err) {
        console.error('[WorkspaceManager] Failed to resolve workspace path:', err);
        return null;
    }
}

/**
 * Writes data directly into the workspace without prompting the user.
 */
export async function writeDirectToWorkspace(
    filePath: string,
    data: Uint8Array | ArrayBuffer | Blob
): Promise<{ success: boolean; filePath?: string; error?: string }> {
    const invoke = getElectronInvoke();
    if (!invoke) return { success: false, error: 'Not in Electron' };

    try {
        let uint8Array: Uint8Array;
        if (data instanceof Blob) {
            const buffer = await data.arrayBuffer();
            uint8Array = new Uint8Array(buffer);
        } else if (data instanceof ArrayBuffer) {
            uint8Array = new Uint8Array(data);
        } else {
            uint8Array = data;
        }

        const result = await invoke('write-file-direct', {
            filePath,
            data: uint8Array
        });

        return result;
    } catch (err: any) {
        console.error('[WorkspaceManager] writeDirectToWorkspace failed:', err);
        return { success: false, error: err?.message || String(err) };
    }
}

/**
 * Lets the user change the workspace root directory and re-registers it.
 */
export async function changeWorkspaceRoot(newPath?: string): Promise<string | null> {
    const invoke = getElectronInvoke();
    if (!invoke) return null;

    try {
        let selectedPath = newPath;
        if (!selectedPath) {
            selectedPath = await invoke('show-open-dialog', {
                properties: ['openDirectory'],
                title: 'Select Workspace Root Directory'
            });
        }

        if (selectedPath && typeof selectedPath === 'string') {
            const regResult = await invoke('register-workspace-root', selectedPath);
            if (regResult && regResult.success) {
                cachedWorkspaceRoot = regResult.rootPath || selectedPath;
                localStorage.setItem(WORKSPACE_STORAGE_KEY, cachedWorkspaceRoot!);
                state.exportDirectoryPath = cachedWorkspaceRoot;
                
                if (dom.exportSavePathDisplay) {
                    dom.exportSavePathDisplay.textContent = cachedWorkspaceRoot!;
                }

                return cachedWorkspaceRoot;
            }
        }
    } catch (err) {
        console.error('[WorkspaceManager] Change workspace root failed:', err);
    }
    return null;
}

/**
 * Opens the workspace folder (or specific subfolder) in native file explorer.
 */
export async function openWorkspaceFolder(subfolder?: WorkspaceCategory | ''): Promise<boolean> {
    const invoke = getElectronInvoke();
    if (!invoke) return false;

    try {
        const root = await getOrCreateWorkspaceRoot();
        if (!root) return false;

        const target = subfolder ? await invoke('path-join', root, subfolder) : root;
        await invoke('show-item-in-folder', target);
        return true;
    } catch (err) {
        console.error('[WorkspaceManager] openWorkspaceFolder failed:', err);
        return false;
    }
}
