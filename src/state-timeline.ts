import { safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import type { GraphicEvent } from './graphics-engine';
import { invalidateSpectrumCache } from './graphics-engine';
import * as utils from './utils';
import { state } from './state';

// Using a simplified type for now, as it's complex in videoController.
type TimelineClip = any;

export interface TimelineSnapshot {
    clips: any[];
    graphics: any[];
    mode: 'free' | 'audio_locked';
    masterAudioBuffer: AudioBuffer | null;
    globalWordTimestamps: any[] | null;
    globalSilences: { start: number; end: number }[] | null;
    audioSplits?: number[];
}

class TimelineState {
    private _clips: TimelineClip[] = [];
    private _clipsVersion = 0;
    get clipsVersion() { return this._clipsVersion; }
    bumpClipsVersion() { this._clipsVersion++; }
    private _mode: 'free' | 'audio_locked' = 'free';
    private _editMode: 'ripple' | 'slip' = 'ripple';
    private _zoomLevel: number = 1;
    private _masterAudioBuffer: AudioBuffer | null = null;
    private _masterAudioAssetId: string | null = null;
    private _globalWordTimestamps: any[] | null = null;
    private _globalSilences: { start: number; end: number }[] | null = null;
    private _audioSplits: number[] = [];
    private _selectedAudioSplitIndex: number | null = null;
    private _selectedGraphicId: string | null = null;
    private _videoGenerated: boolean = false;
    private _savedVideoTimelineMetadata: any[] | null = null;
    private _showSubtitles: boolean = false;
    private _videoSubtitleStyle: any = 'anime';
    private _videoSubtitlePosition: 'bottom' | 'center' | 'top' = 'bottom';
    private _videoSubtitleFont: string = 'Montserrat';
    private _videoTransitionStyle: any = 'narrative_guided';
    private _transitionSpeed: 'fast' | 'medium' | 'slow' | 'ultrafast' = 'medium';
    private _timelineSnapPoints: number[] = [];
    private _batchDepth = 0;
    private _pendingClipNotify = false;
    private _pendingSettingNotify = false;
    private _isNotifyingClips = false;
    private _isNotifyingSettings = false;
    private _videoEffects: {
        grain: number;
        vignette: number;
        lightLeaks: number;
        chromaticAberration: number;
        dustAndScratches: number;
        hdrMaster?: number;
        hdrBalance?: number;
        clarity?: number;
        vibrance?: number;
        sharpening?: number;
        colorFilter: string;
        autoColorMatch: boolean;
        sparkles: number;
        sparklesSize?: number;
        sparklesCount?: number;
        rain: number;
        rainSize?: number;
        rainCount?: number;
        dustParticles: number;
        dustParticlesSize?: number;
        dustParticlesCount?: number;
        snow: number;
        snowSize?: number;
        snowCount?: number;
        crtEffect: number;
        blendMode: string;
        enableBackgroundBlur: boolean;
    } = {
        grain: 0.05,
        vignette: 0.15,
        lightLeaks: 0,
        chromaticAberration: 0,
        dustAndScratches: 0,
        hdrMaster: 0,
        hdrBalance: 0,
        clarity: 0,
        vibrance: 0,
        sharpening: 0,
        colorFilter: 'none',
        autoColorMatch: false,
        sparkles: 0,
        sparklesSize: 0.5,
        sparklesCount: 0.5,
        rain: 0,
        rainSize: 0.5,
        rainCount: 0.5,
        dustParticles: 0,
        dustParticlesSize: 0.5,
        dustParticlesCount: 0.5,
        snow: 0,
        snowSize: 0.5,
        snowCount: 0.5,
        crtEffect: 0,
        blendMode: 'normal',
        enableBackgroundBlur: false
    };
    private _graphics: GraphicEvent[] = [];
    private _drawerUserOpen: boolean = false;
    private _snappingEnabled: boolean = true;
    private _selectedClipId: string | null = null;
    private _hiddenTracks: Record<string, boolean> = {};
    private _lockedTracks: Record<string, boolean> = {};

    // --- History Stack for Undo/Redo ---
    private _undoStack: TimelineSnapshot[] = [];
    private _redoStack: TimelineSnapshot[] = [];

    // --- Getters (return copies where appropriate) ---
    get clips(): TimelineClip[] { return this._clips; } // Return direct reference for performance-critical path (e.g., dragging)
    get mode(): 'free' | 'audio_locked' { return this._mode; }
    get editMode(): 'ripple' | 'slip' { return this._editMode; }
    get zoomLevel(): number { return this._zoomLevel; }
    get masterAudioBuffer(): AudioBuffer | null { return this._masterAudioBuffer; }
    get masterAudioAssetId(): string | null { return this._masterAudioAssetId; }
    get globalWordTimestamps(): any[] | null { return this._globalWordTimestamps; }
    get globalSilences(): { start: number; end: number }[] | null { return this._globalSilences; }
    get videoGenerated(): boolean { return this._videoGenerated; }
    get savedVideoTimelineMetadata(): any[] | null { return this._savedVideoTimelineMetadata; }
    get showSubtitles(): boolean { return this._showSubtitles; }
    get videoSubtitleStyle(): any { return this._videoSubtitleStyle; }
    get videoSubtitlePosition(): 'bottom' | 'center' | 'top' { return this._videoSubtitlePosition; }
    get videoSubtitleFont(): string { return this._videoSubtitleFont; }
    get videoTransitionStyle(): any { return this._videoTransitionStyle; }
    get transitionSpeed(): 'fast' | 'medium' | 'slow' | 'ultrafast' { return this._transitionSpeed; }
    get timelineSnapPoints(): number[] { return this._timelineSnapPoints; }
    get videoEffects() { return this._videoEffects; }
    get graphics(): GraphicEvent[] { return this._graphics; }
    get drawerUserOpen(): boolean { return this._drawerUserOpen; }
    get snappingEnabled(): boolean { return this._snappingEnabled; }
    get selectedClipId(): string | null { return this._selectedClipId; }
    get hiddenTracks(): Record<string, boolean> { return this._hiddenTracks; }
    get lockedTracks(): Record<string, boolean> { return this._lockedTracks; }

    isAudioLocked(): boolean {
        return this._mode === 'audio_locked';
    }

    toggleTrackVisibility(trackKey: string): boolean {
        this._hiddenTracks[trackKey] = !this._hiddenTracks[trackKey];
        this.emitSettingChange();
        return this._hiddenTracks[trackKey];
    }

    toggleTrackLock(trackKey: string): boolean {
        this._lockedTracks[trackKey] = !this._lockedTracks[trackKey];
        this.emitSettingChange();
        return this._lockedTracks[trackKey];
    }

    isTrackHidden(trackKey: string): boolean {
        return !!this._hiddenTracks[trackKey];
    }

    isTrackLocked(trackKey: string): boolean {
        return !!this._lockedTracks[trackKey];
    }

    get audioSplits(): number[] { return this._audioSplits; }
    get selectedAudioSplitIndex(): number | null { return this._selectedAudioSplitIndex; }
    get selectedGraphicId(): string | null { return this._selectedGraphicId; }

    setAudioSplits(splits: number[]) {
        this._audioSplits = splits;
        this.emitSettingChange();
    }

    setSelectedAudioSplitIndex(index: number | null) {
        this._selectedAudioSplitIndex = index;
        if (index !== null) {
            this._selectedClipId = null; // mutually exclusive
            this._selectedGraphicId = null;
        }
        this.emitSettingChange();
    }

    setSelectedGraphicId(id: string | null) {
        this._selectedGraphicId = id;
        if (id !== null) {
            this._selectedClipId = null;
            this._selectedAudioSplitIndex = null;
        }
        this.emitSettingChange();
    }

    setDrawerUserOpen(open: boolean) {
        this._drawerUserOpen = open;
    }

    setSnappingEnabled(enabled: boolean) {
        this._snappingEnabled = enabled;
        this.emitSettingChange();
    }

    setSelectedClipId(clipId: string | null) {
        this._selectedClipId = clipId;
        if (clipId !== null) {
            this._selectedAudioSplitIndex = null; // mutually exclusive
            this._selectedGraphicId = null;
        }
        this.emitSettingChange();
    }

    // --- History Operations ---
    private cloneClipsForHistory(clips: TimelineClip[]): TimelineClip[] {
        return clips.map(clip => {
            return {
                ...clip,
                image: clip.image ? { ...clip.image } : undefined,
                cameraKeyframes: clip.cameraKeyframes ? clip.cameraKeyframes.map((k: any) => ({ ...k })) : undefined,
                wordTimestamps: clip.wordTimestamps ? [...clip.wordTimestamps] : undefined,
                elements: clip.elements ? clip.elements.map((e: any) => ({ ...e })) : undefined
            };
        });
    }

    private cloneGraphicsForHistory(graphics: GraphicEvent[]): GraphicEvent[] {
        return graphics.map(g => ({ ...g }));
    }

    saveSnapshot() {
        if (!this._clips || this._clips.length === 0) return;
        const snapshot: TimelineSnapshot = {
            clips: this.cloneClipsForHistory(this._clips),
            graphics: this.cloneGraphicsForHistory(this._graphics),
            mode: this._mode,
            masterAudioBuffer: this._masterAudioBuffer,
            globalWordTimestamps: this._globalWordTimestamps, // Immutable reference
            globalSilences: this._globalSilences,             // Immutable reference
            audioSplits: [...this._audioSplits],
        };
        if (this._undoStack.length > 0) {
            const last = this._undoStack[this._undoStack.length - 1];
            if (last.clips.length === snapshot.clips.length &&
                last.graphics.length === snapshot.graphics.length &&
                last.mode === snapshot.mode &&
                last.masterAudioBuffer === snapshot.masterAudioBuffer) {
                // Quick shallow change check
                let changed = false;
                for (let i = 0; i < last.clips.length; i++) {
                    if (last.clips[i].id !== snapshot.clips[i].id ||
                        last.clips[i].startTime !== snapshot.clips[i].startTime ||
                        last.clips[i].endTime !== snapshot.clips[i].endTime) {
                        changed = true;
                        break;
                    }
                }
                if (!changed) {
                    for (let i = 0; i < last.graphics.length; i++) {
                        if (last.graphics[i].id !== snapshot.graphics[i].id ||
                            last.graphics[i].start !== snapshot.graphics[i].start ||
                            last.graphics[i].end !== snapshot.graphics[i].end) {
                            changed = true;
                            break;
                        }
                    }
                }
                if (!changed) return;
            }
        }
        this._undoStack.push(snapshot);
        if (this._undoStack.length > 20) this._undoStack.shift();
        this._redoStack = [];
        this.updateUndoRedoUI();
    }

    clearHistory() {
        this._undoStack = [];
        this._redoStack = [];
        this.updateUndoRedoUI();
    }

    undo(): boolean {
        if (this._undoStack.length === 0) return false;
        const currentSnapshot: TimelineSnapshot = {
            clips: this.cloneClipsForHistory(this._clips),
            graphics: this.cloneGraphicsForHistory(this._graphics),
            mode: this._mode,
            masterAudioBuffer: this._masterAudioBuffer,
            globalWordTimestamps: this._globalWordTimestamps,
            globalSilences: this._globalSilences,
            audioSplits: [...this._audioSplits],
        };
        this._redoStack.push(currentSnapshot);
        const prev = this._undoStack.pop()!;
        this._clips = this.cloneClipsForHistory(prev.clips);
        this._graphics = this.cloneGraphicsForHistory(prev.graphics);
        this._mode = prev.mode;
        this._masterAudioBuffer = prev.masterAudioBuffer;
        this._globalWordTimestamps = prev.globalWordTimestamps;
        this._globalSilences = prev.globalSilences;
        this._audioSplits = prev.audioSplits || [];
        this._selectedAudioSplitIndex = null;
        state.uploadedAudioBuffer = this._masterAudioBuffer;
        state.masterAudioTranscript = this._globalWordTimestamps;
        try { invalidateSpectrumCache(); } catch {}
        this.emitClipChange();
        this.emitSettingChange();
        this.updateUndoRedoUI();
        return true;
    }

    redo(): boolean {
        if (this._redoStack.length === 0) return false;
        const currentSnapshot: TimelineSnapshot = {
            clips: this.cloneClipsForHistory(this._clips),
            graphics: this.cloneGraphicsForHistory(this._graphics),
            mode: this._mode,
            masterAudioBuffer: this._masterAudioBuffer,
            globalWordTimestamps: this._globalWordTimestamps,
            globalSilences: this._globalSilences,
            audioSplits: [...this._audioSplits],
        };
        this._undoStack.push(currentSnapshot);
        const next = this._redoStack.pop()!;
        this._clips = this.cloneClipsForHistory(next.clips);
        this._graphics = this.cloneGraphicsForHistory(next.graphics);
        this._mode = next.mode;
        this._masterAudioBuffer = next.masterAudioBuffer;
        this._globalWordTimestamps = next.globalWordTimestamps;
        this._globalSilences = next.globalSilences;
        this._audioSplits = next.audioSplits || [];
        this._selectedAudioSplitIndex = null;
        state.uploadedAudioBuffer = this._masterAudioBuffer;
        state.masterAudioTranscript = this._globalWordTimestamps;
        try { invalidateSpectrumCache(); } catch {}
        this.emitClipChange();
        this.emitSettingChange();
        this.updateUndoRedoUI();
        return true;
    }

    canUndo(): boolean { return this._undoStack.length > 0; }
    canRedo(): boolean { return this._redoStack.length > 0; }

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('timeline-action-undo') as HTMLButtonElement | null;
        const redoBtn = document.getElementById('timeline-action-redo') as HTMLButtonElement | null;
        if (undoBtn) undoBtn.disabled = !this.canUndo();
        if (redoBtn) redoBtn.disabled = !this.canRedo();
    }

    beginBatch() {
        this._batchDepth += 1;
    }

    endBatch() {
        if (this._batchDepth > 0) this._batchDepth -= 1;
        if (this._batchDepth !== 0) return;

        const clipPending = this._pendingClipNotify;
        const settingPending = this._pendingSettingNotify;

        this._pendingClipNotify = false;
        this._pendingSettingNotify = false;

        if (clipPending) this.notifyClipListeners();
        if (settingPending) this.notifySettingListeners();
    }

    private emitClipChange() {
        this._clipsVersion++;
        if (this._batchDepth > 0) {
            this._pendingClipNotify = true;
            return;
        }
        this.notifyClipListeners();
    }

    private emitSettingChange() {
        if (this._batchDepth > 0) {
            this._pendingSettingNotify = true;
            return;
        }
        this.notifySettingListeners();
    }

    // --- Setters / Mutators ---
    setClips(clips: TimelineClip[], notify: boolean = true) {
        this._clipsVersion++;
        this._clips = clips;
        
        let changed = false;
        const newGraphics = [...this._graphics];
        for (let i = 0; i < newGraphics.length; i++) {
            const g = newGraphics[i];
            if (g.clipId && g.offsetInClip !== undefined) {
                const c = clips.find(x => x.id === g.clipId);
                if (c) {
                    const dur = g.end - g.start;
                    const newStart = c.startTime + g.offsetInClip;
                    if (Math.abs(g.start - newStart) > 0.001) {
                        newGraphics[i] = { ...g, start: newStart, end: newStart + dur };
                        changed = true;
                    }
                }
            }
        }
        if (changed) this._graphics = newGraphics;
        
        if (notify) this.emitClipChange();
    }

    setMode(mode: 'free' | 'audio_locked') {
        this._mode = mode;
        this.emitClipChange(); // Mode change affects timeline logic
    }

    setEditMode(mode: 'ripple' | 'slip') {
        this._editMode = mode;
        this.emitSettingChange();
    }

    setZoomLevel(level: number) {
        this._zoomLevel = level;
        this.emitSettingChange();
    }
    
    setMasterAudioBuffer(buffer: AudioBuffer | null) {
        this._masterAudioBuffer = buffer;
        try { invalidateSpectrumCache(); } catch {}
        this.emitClipChange(); // Affects duration and mode
    }

    setMasterAudioAssetId(id: string | null) {
        this._masterAudioAssetId = id;
    }
    
    setGlobalWordTimestamps(timestamps: any[] | null) {
        this._globalWordTimestamps = timestamps;
        this.emitClipChange(); // Affects subtitles and alignment
    }
    
    setGlobalSilences(silences: { start: number; end: number }[] | null) {
        this._globalSilences = silences;
        // This is derived data, might not need to notify, but let's be safe
        this.emitClipChange();
    }

    setGraphics(events: GraphicEvent[]) {
        this._graphics = events || [];
        this.emitSettingChange(); // purely visual → re-render preview
    }

    setGraphicsSilent(events: GraphicEvent[]) {
        this._graphics = events || [];
        // No emitSettingChange() to avoid triggering full UI/timeline rebuilds during continuous drags
    }
    
    setVideoGenerated(generated: boolean) {
        this._videoGenerated = generated;
        this.emitClipChange(); // Major state change
    }
    
    setSavedVideoTimelineMetadata(metadata: any[] | null) {
        this._savedVideoTimelineMetadata = metadata;
        // No notification needed, this is for persistence
    }
    
    setShowSubtitles(show: boolean) {
        this._showSubtitles = show;
        this.emitSettingChange(); // Purely visual setting change
    }

    setVideoSubtitleStyle(style: any) {
        this._videoSubtitleStyle = style;
        this.emitSettingChange();
    }

    setVideoSubtitlePosition(position: 'bottom' | 'center' | 'top') {
        this._videoSubtitlePosition = position;
        this.emitSettingChange();
    }

    setVideoSubtitleFont(font: string) {
        this._videoSubtitleFont = font || 'Montserrat';
        this.emitSettingChange();
    }

    setVideoTransitionStyle(style: any) {
        this._videoTransitionStyle = style;
        this.emitClipChange(); // Transitions affect rendering logic
    }

    setTransitionSpeed(speed: 'fast' | 'medium' | 'slow' | 'ultrafast') {
        this._transitionSpeed = speed;
        this.emitClipChange();
    }

    setTimelineSnapPoints(points: number[]) {
        this._timelineSnapPoints = points;
        this.emitSettingChange();
    }

    setVideoEffects(effects: Partial<TimelineState['_videoEffects']>) {
        this._videoEffects = { ...this._videoEffects, ...effects };
        this.emitSettingChange();
    }

    // --- Pub/Sub ---
    private clipListeners: Array<() => void> = [];
    private settingListeners: Array<() => void> = [];

    subscribeToClips(callback: () => void): () => void {
        this.clipListeners.push(callback);
        return () => { this.clipListeners = this.clipListeners.filter(l => l !== callback); };
    }

    subscribeToSettings(callback: () => void): () => void {
        this.settingListeners.push(callback);
        return () => { this.settingListeners = this.settingListeners.filter(l => l !== callback); };
    }

    private notifyClipListeners() {
        if (this._isNotifyingClips) return;
        this._isNotifyingClips = true;
        try {
            for (const listener of this.clipListeners) {
                listener();
            }
        } finally {
            this._isNotifyingClips = false;
        }
    }

    private notifySettingListeners() {
        if (this._isNotifyingSettings) return;
        this._isNotifyingSettings = true;
        try {
            for (const listener of this.settingListeners) {
                listener();
            }
        } finally {
            this._isNotifyingSettings = false;
        }
    }
}

export const timelineState = new TimelineState();

/**
 * Utility to calculate speech intervals for audio ducking across live preview and video export.
 * Prioritizes global word timestamps, then clip-level word timestamps/narration,
 * and falls back to master audio duration if no word timestamps are available.
 */
export function calculateSpeechIntervals(exportDuration?: number): { start: number; end: number }[] {
    const MAX_GAP = 0.8;
    const intervals: { start: number; end: number }[] = [];

    // 1. Primary: Global Word Timestamps
    if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
        for (const w of timelineState.globalWordTimestamps) {
            if (typeof w.start === 'number' && typeof w.end === 'number' && w.end > w.start) {
                intervals.push({
                    start: Math.max(0, w.start),
                    end: exportDuration !== undefined ? Math.min(exportDuration, w.end) : w.end
                });
            }
        }
    }

    // 2. Secondary: Clip-level word timestamps or clip narration/audio bounds
    if (timelineState.clips && timelineState.clips.length > 0) {
        for (const clip of timelineState.clips) {
            const hasSpeech = !clip.muteNarration;
            if (!hasSpeech) continue;

            const clipStart = typeof clip.startTime === 'number' ? clip.startTime : 0;
            const clipEnd = typeof clip.endTime === 'number' && clip.endTime > clipStart
                ? clip.endTime
                : clipStart + (clip.duration || 3);

            if (clip.wordTimestamps && clip.wordTimestamps.length > 0) {
                for (const w of clip.wordTimestamps) {
                    const start = clipStart + w.start;
                    const end = clipStart + w.end;
                    intervals.push({
                        start: Math.max(0, start),
                        end: exportDuration !== undefined ? Math.min(exportDuration, end) : end
                    });
                }
            } else if (intervals.length === 0 && (clip._narrationBuffer || clip.narrationAudioUrl || clip.text || clip.useOriginalAudio)) {
                intervals.push({
                    start: Math.max(0, clipStart),
                    end: exportDuration !== undefined ? Math.min(exportDuration, clipEnd) : clipEnd
                });
            }
        }
    }

    // 3. Fallback: Master audio buffer
    if (intervals.length === 0) {
        const masterBuffer = timelineState.masterAudioBuffer;
        if (masterBuffer && masterBuffer.duration > 0) {
            const dur = exportDuration !== undefined ? Math.min(exportDuration, masterBuffer.duration) : masterBuffer.duration;
            intervals.push({ start: 0, end: dur });
        }
    }

    if (intervals.length === 0) return [];

    // Sort intervals by start time
    intervals.sort((a, b) => a.start - b.start);

    // Merge overlapping or nearby intervals (within MAX_GAP seconds)
    const merged: { start: number; end: number }[] = [];
    let current = { start: intervals[0].start, end: intervals[0].end };

    for (let i = 1; i < intervals.length; i++) {
        const next = intervals[i];
        if (next.start - current.end <= MAX_GAP) {
            current.end = Math.max(current.end, next.end);
        } else {
            merged.push(current);
            current = { start: next.start, end: next.end };
        }
    }
    merged.push(current);

    return merged;
}
