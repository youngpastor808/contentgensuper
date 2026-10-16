/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Snapshot Undo/Redo History with mark() and fold() for continuous slider drags.
 * Ported from video-studio/src/model/history.js.
 */

export interface HistoryEntry<T = any> {
  snapshot: T;
  label: string;
}

export interface HistoryMark<T = any> {
  top: HistoryEntry<T> | null;
}

export class FoldableHistory<T = any> {
  public readonly limit: number;
  public undoStack: HistoryEntry<T>[] = [];
  public redoStack: HistoryEntry<T>[] = [];

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** Record the state before an edit. */
  push(snapshot: T, label = 'Edit'): void {
    this.undoStack.push({ snapshot, label });
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /** Create a bookmark of the current top step before a continuous gesture (e.g. slider pointerdown). */
  mark(): HistoryMark<T> {
    return { top: this.undoStack.at(-1) || null };
  }

  /**
   * Fold every step recorded since `mark` into one step labeled `label`,
   * restoring the state before the first of them on undo.
   */
  fold(mark: HistoryMark<T> | null | undefined, label?: string): HistoryEntry<T> | null {
    const at = mark?.top ? this.undoStack.lastIndexOf(mark.top) : -1;
    const steps = this.undoStack.splice(at + 1);
    if (!steps.length) return null;
    const entry: HistoryEntry<T> = {
      snapshot: steps[0].snapshot,
      label: label || steps[0].label,
    };
    this.undoStack.push(entry);
    return entry;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Returns `{ snapshot, label }` to restore, given the `current` state to keep for redo. */
  undo(current: T): HistoryEntry<T> | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ snapshot: current, label: entry.label });
    return entry;
  }

  redo(current: T): HistoryEntry<T> | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ snapshot: current, label: entry.label });
    return entry;
  }

  get undoLabel(): string {
    return this.undoStack.at(-1)?.label || '';
  }

  get redoLabel(): string {
    return this.redoStack.at(-1)?.label || '';
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

export const projectHistory = new FoldableHistory(100);
