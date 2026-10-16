import { Scene } from './types';
import { safeClone, safeJsonStringify, safeJsonParse, sanitizeScenes } from './utils/safeJson';

export interface ProjectSnapshot {
  id: string;
  version: number;
  timestamp: number;
  description: string;
  scenes: Scene[];
  aspectRatio: string;
  audioTrackUrl?: string;
}

export interface ProjectWithVersioning {
  version: number;
  scenes: Scene[];
  aspectRatio: string;
  audioTrackUrl?: string;
  history?: ProjectSnapshot[];
}

const MAX_HISTORY_SNAPSHOTS = 10;
const SNAPSHOT_STORAGE_KEY = 'contentgen_version_history';

export class ProjectVersioningManager {
  /**
   * Creates a snapshot checkpoint of the current project state
   */
  static createSnapshot(
    project: ProjectWithVersioning,
    description?: string
  ): ProjectSnapshot {
    const currentVersion = project.version || 1;
    const snapshot: ProjectSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      version: currentVersion + 1,
      timestamp: Date.now(),
      description: description || `Version ${currentVersion + 1}`,
      scenes: sanitizeScenes(safeClone(project.scenes)),
      aspectRatio: project.aspectRatio,
      audioTrackUrl: project.audioTrackUrl,
    };

    return snapshot;
  }

  /**
   * Saves history to localStorage
   */
  static saveHistory(history: ProjectSnapshot[]): void {
    try {
      const trimmed = history.slice(-MAX_HISTORY_SNAPSHOTS);
      const serialized = safeJsonStringify(trimmed);
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, serialized);
    } catch (e) {
      console.warn('[ProjectVersioning] Failed to save history to storage:', e);
    }
  }

  /**
   * Loads history from localStorage
   */
  static loadHistory(): ProjectSnapshot[] {
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return [];
      return safeJsonParse<ProjectSnapshot[]>(raw, []);
    } catch (e) {
      console.warn('[ProjectVersioning] Failed to load history:', e);
      return [];
    }
  }
}

type SaveVersionFn = (isAutoSave?: boolean, forceCheckpoint?: boolean) => Promise<void>;
let saveVersionCallback: SaveVersionFn | null = null;

type FlushSaveFn = () => Promise<void>;
let flushSaveCallback: FlushSaveFn | null = null;

export function registerSaveVersion(fn: SaveVersionFn): void {
  saveVersionCallback = fn;
}

export function registerFlushPendingSave(fn: FlushSaveFn): void {
  flushSaveCallback = fn;
}

export async function saveVersion(isAutoSave = true, forceCheckpoint = false): Promise<void> {
  if (saveVersionCallback) {
    return saveVersionCallback(isAutoSave, forceCheckpoint);
  }
}

export async function flushPendingSave(): Promise<void> {
  if (flushSaveCallback) {
    return flushSaveCallback();
  }
}