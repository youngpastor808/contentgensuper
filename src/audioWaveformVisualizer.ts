import { formatTime, audioBufferToWavBlob, debounce } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from './dom';
import * as utils from './utils';
import { state } from './state';

let audioElement: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;
let currentAudioBuffer: AudioBuffer | null = null;
let cachedPeaks: number[] = [];
let animFrameId: number | null = null;
let isInitialized = false;

export function initAudioWaveformVisualizer() {
    if (isInitialized) return;
    isInitialized = true;

    if (!dom.storyWaveformPlayBtn || !dom.storyWaveformCanvasWrapper) return;

    // Play / Pause Button Click
    dom.storyWaveformPlayBtn.addEventListener('click', () => {
        togglePlayPause();
    });

    // Playback Speed Selector
    dom.storyWaveformSpeed?.addEventListener('change', () => {
        if (audioElement && dom.storyWaveformSpeed) {
            audioElement.playbackRate = parseFloat(dom.storyWaveformSpeed.value) || 1.0;
        }
    });

    // Download Button
    dom.storyWaveformDownloadBtn?.addEventListener('click', async () => {
        if (!currentObjectUrl) return;
        const rawName = state.uploadedAudioFileName || 'master-audio.wav';
        const audioName = rawName.replace(/\.[^/.]+$/, "") + ".wav";
        try {
            const resp = await fetch(currentObjectUrl);
            const blob = await resp.blob();
            await utils.downloadBlob(blob, audioName, { category: 'Audio' });
        } catch (err) {
            console.warn('[AudioWaveform] Fallback direct download due to error:', err);
            const a = document.createElement('a');
            a.href = currentObjectUrl;
            a.download = audioName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    });

    // Canvas Wrapper Hover Line & Click Seek
    dom.storyWaveformCanvasWrapper.addEventListener('mousemove', (e: MouseEvent) => {
        if (!dom.storyWaveformCanvasWrapper || !dom.storyWaveformHoverLine || !audioElement || !audioElement.duration) return;
        const rect = dom.storyWaveformCanvasWrapper.getBoundingClientRect();
        const offsetX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        
        dom.storyWaveformHoverLine.style.left = `${offsetX}px`;
        dom.storyWaveformHoverLine.classList.remove('hidden');
    });

    dom.storyWaveformCanvasWrapper.addEventListener('mouseleave', () => {
        if (dom.storyWaveformHoverLine) {
            dom.storyWaveformHoverLine.classList.add('hidden');
        }
    });

    dom.storyWaveformCanvasWrapper.addEventListener('click', (e: MouseEvent) => {
        if (!dom.storyWaveformCanvasWrapper || !audioElement || !audioElement.duration) return;
        const rect = dom.storyWaveformCanvasWrapper.getBoundingClientRect();
        const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const ratio = clickX / rect.width;
        
        audioElement.currentTime = ratio * audioElement.duration;
        updateWaveformUI();
    });

    // Window Resize Handler
    window.addEventListener('resize', debounce(() => {
        if (currentAudioBuffer && dom.storyWaveformContainer && !dom.storyWaveformContainer.classList.contains('hidden')) {
            drawWaveformCanvas();
        }
    }, 150));
}

export function loadAndShowWaveform(audioBuffer: AudioBuffer, blob: Blob | null, filename: string) {
    initAudioWaveformVisualizer();

    hideAndCleanupWaveform(false);

    currentAudioBuffer = audioBuffer;

    // Calculate peaks (e.g. 100 vertical bars)
    cachedPeaks = calculatePeaks(audioBuffer, 100);

    // Prepare audio element
    const audioBlob = blob || audioBufferToWavBlob(audioBuffer);
    currentObjectUrl = URL.createObjectURL(audioBlob);

    audioElement = new Audio(currentObjectUrl);
    if (dom.storyWaveformSpeed) {
        audioElement.playbackRate = parseFloat(dom.storyWaveformSpeed.value) || 1.0;
    }

    // Audio Event Listeners
    audioElement.addEventListener('timeupdate', () => {
        updateWaveformUI();
    });

    audioElement.addEventListener('play', () => {
        setPlayStateUI(true);
        startRenderLoop();
    });

    audioElement.addEventListener('pause', () => {
        setPlayStateUI(false);
        stopRenderLoop();
        updateWaveformUI();
    });

    audioElement.addEventListener('ended', () => {
        setPlayStateUI(false);
        stopRenderLoop();
        if (audioElement) audioElement.currentTime = 0;
        updateWaveformUI();
    });

    // Update UI elements
    if (dom.storyWaveformFilename) {
        dom.storyWaveformFilename.textContent = filename;
    }

    if (dom.storyWaveformContainer) {
        dom.storyWaveformContainer.classList.remove('hidden');
    }

    updateWaveformUI();
    drawWaveformCanvas();
}

export function hideAndCleanupWaveform(hideContainer: boolean = true) {
    stopRenderLoop();

    if (audioElement) {
        audioElement.pause();
        audioElement.removeAttribute('src');
        audioElement.load();
        audioElement = null;
    }

    if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
    }

    currentAudioBuffer = null;
    cachedPeaks = [];

    setPlayStateUI(false);

    if (hideContainer && dom.storyWaveformContainer) {
        dom.storyWaveformContainer.classList.add('hidden');
    }
}

function togglePlayPause() {
    if (!audioElement) return;

    if (audioElement.paused) {
        audioElement.play().catch(err => {
            console.warn('Audio playback error:', err);
        });
    } else {
        audioElement.pause();
    }
}

function setPlayStateUI(isPlaying: boolean) {
    if (!dom.storyWaveformPlayIcon || !dom.storyWaveformPauseIcon) return;
    if (isPlaying) {
        dom.storyWaveformPlayIcon.classList.add('hidden');
        dom.storyWaveformPauseIcon.classList.remove('hidden');
    } else {
        dom.storyWaveformPlayIcon.classList.remove('hidden');
        dom.storyWaveformPauseIcon.classList.add('hidden');
    }
}

function updateWaveformUI() {
    if (!audioElement) return;

    const current = audioElement.currentTime || 0;
    const total = audioElement.duration || (currentAudioBuffer ? currentAudioBuffer.duration : 0);

    if (dom.storyWaveformTime) {
        dom.storyWaveformTime.textContent = `${formatTime(current)} / ${formatTime(total)}`;
    }

    drawWaveformCanvas();
}

function startRenderLoop() {
    stopRenderLoop();
    const loop = () => {
        updateWaveformUI();
        if (audioElement && !audioElement.paused) {
            animFrameId = requestAnimationFrame(loop);
        }
    };
    animFrameId = requestAnimationFrame(loop);
}

function stopRenderLoop() {
    if (animFrameId !== null) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
}

function calculatePeaks(audioBuffer: AudioBuffer, barCount: number): number[] {
    const rawData = audioBuffer.getChannelData(0);
    const totalSamples = rawData.length;
    if (totalSamples === 0 || barCount <= 0) return [];

    const samplesPerBar = Math.floor(totalSamples / barCount);
    const rawPeaks: number[] = [];

    // For each bar bucket, sample multiple 50ms-100ms micro-slices to capture true speech/audio dynamics
    const sampleRate = audioBuffer.sampleRate || 44100;
    const microSliceSamples = Math.max(128, Math.min(Math.floor(sampleRate * 0.05), Math.floor(samplesPerBar / 4)));

    for (let i = 0; i < barCount; i++) {
        const bucketStart = i * samplesPerBar;
        const bucketEnd = Math.min(totalSamples, bucketStart + samplesPerBar);
        const bucketLen = bucketEnd - bucketStart;

        // Take up to 16 micro-slices across this bar bucket
        const numSlices = Math.min(16, Math.max(4, Math.floor(bucketLen / microSliceSamples)));
        const sliceStep = Math.max(1, Math.floor((bucketLen - microSliceSamples) / (numSlices || 1)));

        let maxSliceRMS = 0;
        let sumRMS = 0;
        let sliceCount = 0;

        for (let s = 0; s < numSlices; s++) {
            const sliceStart = bucketStart + (s * sliceStep);
            const sliceEnd = Math.min(bucketEnd, sliceStart + microSliceSamples);
            let sumSq = 0;
            let count = 0;

            // Step within slice for performance
            const innerStep = Math.max(1, Math.floor((sliceEnd - sliceStart) / 128));
            for (let j = sliceStart; j < sliceEnd; j += innerStep) {
                const sample = rawData[j];
                sumSq += sample * sample;
                count++;
            }

            const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
            sumRMS += rms;
            if (rms > maxSliceRMS) maxSliceRMS = rms;
            sliceCount++;
        }

        const avgRMS = sliceCount > 0 ? sumRMS / sliceCount : 0;
        // Blend peak dynamics with average to avoid both total flatness and single-spike anomalies
        const barMetric = (maxSliceRMS * 0.7) + (avgRMS * 0.3);
        rawPeaks.push(barMetric);
    }

    // Dynamic Range Contrast Stretching
    // Find min and max across all bars to prevent uniform flat bars on long audio
    let minVal = Infinity;
    let maxVal = -Infinity;

    for (const v of rawPeaks) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
    }

    if (!isFinite(minVal) || !isFinite(maxVal) || maxVal <= 1e-6) {
        return rawPeaks.map(() => 0.15);
    }

    // Stretch the values between minVal (noise floor) and maxVal (loudest part)
    const range = maxVal - minVal;
    return rawPeaks.map(v => {
        const normalized = range > 1e-5 ? (v - minVal) / range : 0.5;
        // Non-linear power curve for crisp visual distinction between quiet and loud parts
        const contoured = Math.pow(normalized, 1.25);
        // Scale to 0.12 (minimum visible bar) to 1.0 (full height)
        return Math.max(0.12, Math.min(1.0, 0.12 + (contoured * 0.88)));
    });
}

function drawWaveformCanvas() {
    const canvas = dom.storyWaveformCanvas;
    if (!canvas || !dom.storyWaveformCanvasWrapper) return;

    const wrapper = dom.storyWaveformCanvasWrapper;
    const dpr = window.devicePixelRatio || 1;
    
    const displayWidth = wrapper.clientWidth || 300;
    const displayHeight = wrapper.clientHeight || 56;

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const currentTime = audioElement ? audioElement.currentTime : 0;
    const duration = (audioElement && audioElement.duration) ? audioElement.duration : (currentAudioBuffer?.duration || 1);
    const progressRatio = Math.max(0, Math.min(1, currentTime / duration));

    // Desired bar styling: 3px wide bars with 2px gaps for clear separation
    const barWidth = 3;
    const barGap = 2;
    const slotWidth = barWidth + barGap;
    const idealBarCount = Math.max(30, Math.min(140, Math.floor((displayWidth - 8) / slotWidth)));

    // Recompute cached peaks if bar count changed or not yet computed
    if (currentAudioBuffer && (cachedPeaks.length !== idealBarCount)) {
        cachedPeaks = calculatePeaks(currentAudioBuffer, idealBarCount);
    }

    if (cachedPeaks.length === 0) {
        ctx.restore();
        return;
    }

    const barCount = cachedPeaks.length;
    const totalBarsWidth = (barCount * barWidth) + ((barCount - 1) * barGap);
    const startX = Math.max(4, Math.floor((displayWidth - totalBarsWidth) / 2));
    const activeProgressWidth = progressRatio * totalBarsWidth;

    for (let i = 0; i < barCount; i++) {
        const x = startX + (i * slotWidth);
        const peak = cachedPeaks[i];
        const barHeight = Math.max(6, Math.floor(peak * (displayHeight - 14)));
        const y = Math.floor((displayHeight - barHeight) / 2);
        
        const barMidX = (i * slotWidth) + (barWidth / 2);
        const isPlayed = barMidX <= activeProgressWidth;

        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(x, y, barWidth, barHeight, 1.5);
        } else {
            ctx.rect(x, y, barWidth, barHeight);
        }

        if (isPlayed) {
            // Bright Indigo to Violet Gradient for Played portion
            const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
            grad.addColorStop(0, '#818cf8');
            grad.addColorStop(1, '#6366f1');
            ctx.fillStyle = grad;
        } else {
            // Dark muted indigo for Unplayed portion with clear contrast
            ctx.fillStyle = 'rgba(99, 102, 241, 0.28)';
        }

        ctx.fill();
    }

    // Playhead Vertical Marker
    const playheadX = Math.floor(startX + activeProgressWidth);
    ctx.fillStyle = '#a5b4fc';
    ctx.fillRect(playheadX - 1, 2, 2, displayHeight - 4);

    ctx.restore();
}
