import * as dom from './dom';
import { timelineState } from './state-timeline';
import { sliceAudioBuffer } from './audioBufferUtils';
import { getAudioContext } from './utils';
import * as ui from './ui';
import type { GraphicEvent } from './graphics-engine';
import type { CustomSfxItem } from './handlers-graphics';

export interface SfxTrimmerState {
    graphicId?: string;
    customDropItem?: CustomSfxItem;
    audioBuffer: AudioBuffer | null;
    origDuration: number;
    startOffset: number; // Cut In-point in seconds
    endOffset: number;   // Cut Out-point in seconds
    playheadSec: number; // Current playback preview position in seconds
    isPlaying: boolean;
    sourceNode?: AudioBufferSourceNode;
    startTimeCtx?: number;
    animFrameId?: number;
    peaks: number[];
}

let trimmerState: SfxTrimmerState = {
    audioBuffer: null,
    origDuration: 0,
    startOffset: 0,
    endOffset: 0,
    playheadSec: 0,
    isPlaying: false,
    peaks: []
};

let activeHandle: 'start' | 'end' | null = null;
let dragStartX = 0;
let dragStartOffsetSec = 0;

function calculatePeaks(buffer: AudioBuffer, barCount: number = 160): number[] {
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    if (totalSamples === 0 || barCount <= 0) return new Array(barCount).fill(0.2);

    const samplesPerBar = Math.floor(totalSamples / barCount);
    const rawPeaks: number[] = [];

    for (let i = 0; i < barCount; i++) {
        const start = i * samplesPerBar;
        const end = Math.min(totalSamples, start + samplesPerBar);
        let sumSq = 0;
        let count = 0;
        const step = Math.max(1, Math.floor((end - start) / 32));

        for (let j = start; j < end; j += step) {
            const val = channelData[j];
            sumSq += val * val;
            count++;
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        rawPeaks.push(rms);
    }

    let maxVal = Math.max(...rawPeaks, 0.001);
    return rawPeaks.map(v => Math.max(0.12, Math.min(1.0, (v / maxVal) * 0.95)));
}

export function openSfxTrimmerForGraphic(graphicId: string) {
    const ev = (timelineState.graphics || []).find(g => g.id === graphicId);
    if (!ev) {
        ui.showStatus('⚠️ SFX clip not found on timeline', true);
        return;
    }

    const buffer = (ev as any)._sfxBuffer as AudioBuffer | undefined;
    if (!buffer) {
        ui.showStatus('⚠️ No audio waveform data available for this SFX', true);
        return;
    }

    const dur = buffer.duration || ((ev.end ?? 0) - (ev.start ?? 0)) || 2.0;
    const startOff = (ev as any).startOffset || 0;
    const endOff = (ev as any).endOffset || Math.min(dur, startOff + ((ev.end ?? 0) - (ev.start ?? 0))) || dur;

    trimmerState = {
        graphicId: ev.id,
        audioBuffer: buffer,
        origDuration: dur,
        startOffset: Math.max(0, Math.min(startOff, dur - 0.05)),
        endOffset: Math.max(0.1, Math.min(endOff, dur)),
        playheadSec: Math.max(0, startOff),
        isPlaying: false,
        peaks: calculatePeaks(buffer, 180)
    };

    setupTrimmerUI(`SFX: ${ev.title || 'Sound Effect'}`, 'TIMELINE CLIP');
}

export function openSfxTrimmerForCustomDrop(item: CustomSfxItem, onSaved?: (newItem: CustomSfxItem) => void) {
    if (!item.buffer) {
        ui.showStatus('⚠️ Custom SFX audio buffer is missing', true);
        return;
    }

    const buffer = item.buffer;
    const dur = buffer.duration || item.duration || 2.0;

    trimmerState = {
        customDropItem: item,
        audioBuffer: buffer,
        origDuration: dur,
        startOffset: 0,
        endOffset: dur,
        playheadSec: 0,
        isPlaying: false,
        peaks: calculatePeaks(buffer, 180)
    };

    setupTrimmerUI(`Custom SFX: ${item.name}`, 'MY CUSTOM DROP');
}

function setupTrimmerUI(titleText: string, badgeText: string) {
    if (!dom.sfxTrimmerModal) return;

    stopPreviewAudio();

    if (dom.sfxTrimmerTitle) {
        dom.sfxTrimmerTitle.childNodes[0].nodeValue = `${titleText} `;
    }
    if (dom.sfxTrimmerBadge) {
        dom.sfxTrimmerBadge.textContent = badgeText;
    }

    updateTrimmerReadouts();
    dom.sfxTrimmerModal.classList.remove('hidden');

    requestAnimationFrame(() => {
        renderTrimmerCanvas();
        updateHandlesAndMasks();
    });
}

export function closeSfxTrimmerModal() {
    stopPreviewAudio();
    if (dom.sfxTrimmerModal) {
        dom.sfxTrimmerModal.classList.add('hidden');
    }
}

function updateTrimmerReadouts() {
    const dur = trimmerState.origDuration;
    const selDur = Math.max(0, trimmerState.endOffset - trimmerState.startOffset);

    if (dom.sfxTrimmerOrigDur) dom.sfxTrimmerOrigDur.textContent = `${dur.toFixed(2)}s`;
    if (dom.sfxTrimmerSelectedDur) dom.sfxTrimmerSelectedDur.textContent = `${selDur.toFixed(2)}s`;

    if (dom.sfxTrimmerStartInput) {
        dom.sfxTrimmerStartInput.value = trimmerState.startOffset.toFixed(2);
        dom.sfxTrimmerStartInput.max = (trimmerState.endOffset - 0.05).toFixed(2);
    }
    if (dom.sfxTrimmerEndInput) {
        dom.sfxTrimmerEndInput.value = trimmerState.endOffset.toFixed(2);
        dom.sfxTrimmerEndInput.min = (trimmerState.startOffset + 0.05).toFixed(2);
        dom.sfxTrimmerEndInput.max = dur.toFixed(2);
    }
}

function updateHandlesAndMasks() {
    if (!dom.sfxTrimmerCanvasWrapper) return;
    const wrapperW = dom.sfxTrimmerCanvasWrapper.clientWidth || 700;
    const dur = trimmerState.origDuration || 1;

    const startPct = Math.max(0, Math.min(100, (trimmerState.startOffset / dur) * 100));
    const endPct = Math.max(0, Math.min(100, (trimmerState.endOffset / dur) * 100));

    if (dom.sfxTrimmerMaskLeft) {
        dom.sfxTrimmerMaskLeft.style.width = `${startPct}%`;
    }
    if (dom.sfxTrimmerMaskRight) {
        dom.sfxTrimmerMaskRight.style.left = `${endPct}%`;
        dom.sfxTrimmerMaskRight.style.width = `${100 - endPct}%`;
    }

    if (dom.sfxTrimmerHandleStart) {
        dom.sfxTrimmerHandleStart.style.left = `${startPct}%`;
    }
    if (dom.sfxTrimmerHandleEnd) {
        dom.sfxTrimmerHandleEnd.style.left = `${endPct}%`;
    }

    if (dom.sfxTrimmerPlayhead) {
        if (trimmerState.isPlaying) {
            const playheadPct = Math.max(0, Math.min(100, (trimmerState.playheadSec / dur) * 100));
            dom.sfxTrimmerPlayhead.style.left = `${playheadPct}%`;
            dom.sfxTrimmerPlayhead.classList.remove('hidden');
        } else {
            dom.sfxTrimmerPlayhead.classList.add('hidden');
        }
    }
}

function renderTrimmerCanvas() {
    const canvas = dom.sfxTrimmerCanvas;
    if (!canvas || !dom.sfxTrimmerCanvasWrapper) return;

    const wrapper = dom.sfxTrimmerCanvasWrapper;
    const dpr = window.devicePixelRatio || 1;
    const w = wrapper.clientWidth || 700;
    const h = wrapper.clientHeight || 120;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Draw background grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }

    const peaks = trimmerState.peaks;
    if (!peaks || peaks.length === 0) {
        ctx.restore();
        return;
    }

    const numBars = peaks.length;
    const barGap = 1.5;
    const barWidth = Math.max(1.5, (w - (numBars * barGap)) / numBars);
    const centerY = h / 2;

    const dur = trimmerState.origDuration || 1;
    const startSec = trimmerState.startOffset;
    const endSec = trimmerState.endOffset;

    for (let i = 0; i < numBars; i++) {
        const x = i * (barWidth + barGap);
        const peak = peaks[i];
        const barH = Math.max(3, peak * (h - 20));
        const barTimeSec = (i / numBars) * dur;

        const isInsideSelection = barTimeSec >= startSec && barTimeSec <= endSec;

        if (isInsideSelection) {
            // Gradient fill for active cut selection
            const grad = ctx.createLinearGradient(0, centerY - barH / 2, 0, centerY + barH / 2);
            grad.addColorStop(0, '#F59E0B');
            grad.addColorStop(0.5, '#10B981');
            grad.addColorStop(1, '#D97706');
            ctx.fillStyle = grad;
        } else {
            // Muted dark gray for trimmed out audio
            ctx.fillStyle = 'rgba(100, 116, 139, 0.35)';
        }

        ctx.beginPath();
        ctx.roundRect(x, centerY - barH / 2, barWidth, barH, 1);
        ctx.fill();
    }

    ctx.restore();
}

function startPreviewAudio() {
    stopPreviewAudio();

    if (!trimmerState.audioBuffer) return;

    try {
        const audioCtx = getAudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const src = audioCtx.createBufferSource();
        src.buffer = trimmerState.audioBuffer;
        src.connect(audioCtx.destination);

        const start = trimmerState.startOffset;
        const duration = Math.max(0.05, trimmerState.endOffset - trimmerState.startOffset);

        src.start(0, start, duration);
        trimmerState.sourceNode = src;
        trimmerState.startTimeCtx = audioCtx.currentTime;
        trimmerState.isPlaying = true;

        src.onended = () => {
            trimmerState.isPlaying = false;
            if (trimmerState.animFrameId) cancelAnimationFrame(trimmerState.animFrameId);
            updateHandlesAndMasks();
        };

        animatePreviewLoop();
    } catch (e) {
        console.error('Failed to play preview audio:', e);
    }
}

function animatePreviewLoop() {
    if (!trimmerState.isPlaying || !trimmerState.startTimeCtx) return;

    const audioCtx = getAudioContext();
    const elapsed = audioCtx.currentTime - trimmerState.startTimeCtx;
    trimmerState.playheadSec = trimmerState.startOffset + elapsed;

    if (trimmerState.playheadSec >= trimmerState.endOffset) {
        trimmerState.playheadSec = trimmerState.endOffset;
        trimmerState.isPlaying = false;
        updateHandlesAndMasks();
        return;
    }

    updateHandlesAndMasks();
    trimmerState.animFrameId = requestAnimationFrame(animatePreviewLoop);
}

function stopPreviewAudio() {
    if (trimmerState.sourceNode) {
        try { trimmerState.sourceNode.stop(); } catch {}
        trimmerState.sourceNode = undefined;
    }
    if (trimmerState.animFrameId) {
        cancelAnimationFrame(trimmerState.animFrameId);
        trimmerState.animFrameId = undefined;
    }
    trimmerState.isPlaying = false;
    updateHandlesAndMasks();
}

function cropToSelection() {
    if (!trimmerState.audioBuffer) return;

    const sliced = sliceAudioBuffer(
        trimmerState.audioBuffer,
        trimmerState.startOffset,
        trimmerState.endOffset
    );

    trimmerState.audioBuffer = sliced;
    trimmerState.origDuration = sliced.duration;
    trimmerState.startOffset = 0;
    trimmerState.endOffset = sliced.duration;
    trimmerState.peaks = calculatePeaks(sliced, 180);

    stopPreviewAudio();
    updateTrimmerReadouts();
    renderTrimmerCanvas();
    updateHandlesAndMasks();

    ui.showStatus(`✂️ Cropped audio buffer to ${(sliced.duration).toFixed(2)}s cut`, false, 2000);
}

function splitAtPlayhead() {
    if (!trimmerState.graphicId || !trimmerState.audioBuffer) {
        ui.showStatus('⚠️ Split is only available for timeline SFX clips', true);
        return;
    }

    const ev = (timelineState.graphics || []).find(g => g.id === trimmerState.graphicId);
    if (!ev) return;

    const cutPointSec = (trimmerState.startOffset + trimmerState.endOffset) / 2;
    const clipDur1 = cutPointSec - trimmerState.startOffset;
    const clipDur2 = trimmerState.endOffset - cutPointSec;

    if (clipDur1 < 0.1 || clipDur2 < 0.1) {
        ui.showStatus('⚠️ Cut selection is too short to split into two clips', true);
        return;
    }

    const buf1 = sliceAudioBuffer(trimmerState.audioBuffer, trimmerState.startOffset, cutPointSec);
    const buf2 = sliceAudioBuffer(trimmerState.audioBuffer, cutPointSec, trimmerState.endOffset);

    // Update existing clip 1
    ev.end = ev.start + clipDur1;
    (ev as any)._sfxBuffer = buf1;
    (ev as any).startOffset = 0;

    // Create new clip 2 contiguous on timeline
    const newEv: GraphicEvent = {
        ...ev,
        id: 'sfx_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        start: ev.end,
        end: ev.end + clipDur2,
        title: `${ev.title || 'SFX'} (Part 2)`,
        _sfxBuffer: buf2,
        startOffset: 0
    } as any;

    timelineState.saveSnapshot();
    const graphics = [...(timelineState.graphics || [])];
    graphics.push(newEv);
    timelineState.setGraphics(graphics);

    closeSfxTrimmerModal();
    ui.renderTimelineEditor();
    ui.showStatus(`🔪 Split SFX clip into 2 contiguous timeline drops!`, false, 3000);
}

function resetToFull() {
    if (trimmerState.customDropItem?.buffer) {
        const fullBuf = trimmerState.customDropItem.buffer;
        trimmerState.audioBuffer = fullBuf;
        trimmerState.origDuration = fullBuf.duration;
        trimmerState.startOffset = 0;
        trimmerState.endOffset = fullBuf.duration;
        trimmerState.peaks = calculatePeaks(fullBuf, 180);
    } else {
        trimmerState.startOffset = 0;
        trimmerState.endOffset = trimmerState.origDuration;
    }

    stopPreviewAudio();
    updateTrimmerReadouts();
    renderTrimmerCanvas();
    updateHandlesAndMasks();
    ui.showStatus('🔄 Reset to full sound effect waveform', false, 1500);
}

function applyTrimToTimeline() {
    if (!trimmerState.audioBuffer) return;

    const cutDuration = Math.max(0.1, trimmerState.endOffset - trimmerState.startOffset);
    const croppedBuffer = sliceAudioBuffer(
        trimmerState.audioBuffer,
        trimmerState.startOffset,
        trimmerState.endOffset
    );

    if (trimmerState.graphicId) {
        const ev = (timelineState.graphics || []).find(g => g.id === trimmerState.graphicId);
        if (ev) {
            timelineState.saveSnapshot();
            ev.end = (ev.start ?? 0) + cutDuration;
            (ev as any)._sfxBuffer = croppedBuffer;
            (ev as any).startOffset = 0;
            timelineState.setGraphics([...(timelineState.graphics || [])]);
            ui.renderTimelineEditor();
            ui.showStatus(`💾 Applied cut (${cutDuration.toFixed(2)}s) to SFX clip on timeline!`, false, 2500);
        }
    } else if (trimmerState.customDropItem) {
        const item = trimmerState.customDropItem;
        item.buffer = croppedBuffer;
        item.duration = cutDuration;
        ui.showStatus(`💾 Custom drop "${item.name}" updated with cut (${cutDuration.toFixed(2)}s)`, false, 2500);
    }

    closeSfxTrimmerModal();
}

export function initSfxTrimmerListeners() {
    if (!dom.sfxTrimmerModal) return;

    // Handle dragging on In/Out handles
    const handleStartMouseDown = (e: MouseEvent, handle: 'start' | 'end') => {
        e.preventDefault();
        e.stopPropagation();
        activeHandle = handle;
        dragStartX = e.clientX;
        dragStartOffsetSec = handle === 'start' ? trimmerState.startOffset : trimmerState.endOffset;
        document.addEventListener('mousemove', handleTrimmerMouseMove);
        document.addEventListener('mouseup', handleTrimmerMouseUp);
    };

    if (dom.sfxTrimmerHandleStart) {
        dom.sfxTrimmerHandleStart.addEventListener('mousedown', (e) => handleStartMouseDown(e, 'start'));
    }
    if (dom.sfxTrimmerHandleEnd) {
        dom.sfxTrimmerHandleEnd.addEventListener('mousedown', (e) => handleStartMouseDown(e, 'end'));
    }

    // Canvas click to scrub playhead
    if (dom.sfxTrimmerCanvasWrapper) {
        dom.sfxTrimmerCanvasWrapper.addEventListener('click', (e) => {
            const rect = dom.sfxTrimmerCanvasWrapper.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const pct = Math.max(0, Math.min(1, clickX / rect.width));
            trimmerState.playheadSec = pct * trimmerState.origDuration;
            updateHandlesAndMasks();
        });
    }

    // Input listeners
    if (dom.sfxTrimmerStartInput) {
        dom.sfxTrimmerStartInput.addEventListener('change', () => {
            const val = parseFloat(dom.sfxTrimmerStartInput.value);
            if (!isNaN(val)) {
                trimmerState.startOffset = Math.max(0, Math.min(val, trimmerState.endOffset - 0.05));
                updateTrimmerReadouts();
                renderTrimmerCanvas();
                updateHandlesAndMasks();
            }
        });
    }

    if (dom.sfxTrimmerEndInput) {
        dom.sfxTrimmerEndInput.addEventListener('change', () => {
            const val = parseFloat(dom.sfxTrimmerEndInput.value);
            if (!isNaN(val)) {
                trimmerState.endOffset = Math.max(trimmerState.startOffset + 0.05, Math.min(val, trimmerState.origDuration));
                updateTrimmerReadouts();
                renderTrimmerCanvas();
                updateHandlesAndMasks();
            }
        });
    }

    // Button actions
    if (dom.sfxTrimmerPlayBtn) dom.sfxTrimmerPlayBtn.addEventListener('click', startPreviewAudio);
    if (dom.sfxTrimmerStopBtn) dom.sfxTrimmerStopBtn.addEventListener('click', stopPreviewAudio);
    if (dom.sfxTrimmerCropBtn) dom.sfxTrimmerCropBtn.addEventListener('click', cropToSelection);
    if (dom.sfxTrimmerSplitBtn) dom.sfxTrimmerSplitBtn.addEventListener('click', splitAtPlayhead);
    if (dom.sfxTrimmerResetBtn) dom.sfxTrimmerResetBtn.addEventListener('click', resetToFull);
    if (dom.applySfxTrimmerBtn) dom.applySfxTrimmerBtn.addEventListener('click', applyTrimToTimeline);
    if (dom.cancelSfxTrimmerBtn) dom.cancelSfxTrimmerBtn.addEventListener('click', closeSfxTrimmerModal);
    if (dom.closeSfxTrimmerModalBtn) dom.closeSfxTrimmerModalBtn.addEventListener('click', closeSfxTrimmerModal);
}

function handleTrimmerMouseMove(e: MouseEvent) {
    if (!activeHandle || !dom.sfxTrimmerCanvasWrapper) return;

    const wrapperW = dom.sfxTrimmerCanvasWrapper.clientWidth || 700;
    const deltaX = e.clientX - dragStartX;
    const dur = trimmerState.origDuration || 1;
    const deltaSec = (deltaX / wrapperW) * dur;

    if (activeHandle === 'start') {
        const raw = dragStartOffsetSec + deltaSec;
        trimmerState.startOffset = Math.max(0, Math.min(raw, trimmerState.endOffset - 0.05));
    } else {
        const raw = dragStartOffsetSec + deltaSec;
        trimmerState.endOffset = Math.max(trimmerState.startOffset + 0.05, Math.min(raw, dur));
    }

    updateTrimmerReadouts();
    renderTrimmerCanvas();
    updateHandlesAndMasks();
}

function handleTrimmerMouseUp() {
    activeHandle = null;
    document.removeEventListener('mousemove', handleTrimmerMouseMove);
    document.removeEventListener('mouseup', handleTrimmerMouseUp);
}
