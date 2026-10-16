/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dom from '../dom';
import * as ui from '../ui';
import * as utils from '../utils';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import { drawVideoFrame } from '../videoRenderer';
import { drawGraphics, type GraphicEvent } from '../graphics-engine';
import {
  analyzeTimelineForPatternInterrupts,
  applyPatternInterrupts,
  DEFAULT_PATTERN_CONFIG,
  undoPatternInterrupts
} from './engine';
import type {
  AnalysisSummary,
  ApplyResult,
  InterruptIntensity,
  InterruptStyle,
  InterventionType,
  MonotonyCandidate,
  PatternInterruptConfig
} from './types';

let currentConfig: PatternInterruptConfig = { ...DEFAULT_PATTERN_CONFIG };
let currentSummary: AnalysisSummary | null = null;
let currentCandidates: MonotonyCandidate[] = [];

// --- Live Preview Player State ---
interface PreviewState {
  candidate: MonotonyCandidate | null;
  isPlaying: boolean;
  timeOffset: number; // -1.0s (before trigger) to +2.0s (after trigger)
  windowLeadIn: number; // 1.0s
  windowDuration: number; // 3.0s total
  showEffect: boolean; // true = simulated reset effect, false = raw baseline
  animFrameId: number | null;
  lastRafTimestamp: number;
}

const previewState: PreviewState = {
  candidate: null,
  isPlaying: true,
  timeOffset: -0.8,
  windowLeadIn: 1.0,
  windowDuration: 3.0,
  showEffect: true,
  animFrameId: null,
  lastRafTimestamp: 0
};

let offscreenCanvas: HTMLCanvasElement | null = null;
function getOffscreen(w: number, h: number): HTMLCanvasElement {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
  }
  if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  }
  return offscreenCanvas;
}

/**
 * Initializes the Auto Pattern Interrupt feature, setting up DOM triggers and listeners.
 */
export function initPatternInterruptUI(): void {
  // Listen for the timeline button
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const btn = target.closest('#timeline-pattern-interrupt-btn, [data-action="open-pattern-interrupt"]');
    if (btn) {
      e.preventDefault();
      document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
      document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
      openPatternInterruptModal();
      return;
    }

    const closeBtn = target.closest('#close-pattern-interrupt-modal-btn, #cancel-pattern-interrupt-btn');
    if (closeBtn) {
      e.preventDefault();
      closePatternInterruptModal();
      return;
    }

    const reanalyzeBtn = target.closest('#reanalyze-pattern-interrupt-btn');
    if (reanalyzeBtn) {
      e.preventDefault();
      runAnalysis();
      return;
    }

    const applyAllBtn = target.closest('#apply-all-pattern-interrupt-btn');
    if (applyAllBtn) {
      e.preventDefault();
      handleApplyAll();
      return;
    }

    const applySelectedBtn = target.closest('#apply-selected-pattern-interrupt-btn');
    if (applySelectedBtn) {
      e.preventDefault();
      handleApplySelected();
      return;
    }

    const undoBtn = target.closest('#undo-pattern-interrupt-btn');
    if (undoBtn) {
      e.preventDefault();
      handleUndo();
      return;
    }
  });

  // Modal backdrop click to close
  const modal = document.getElementById('pattern-interrupt-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closePatternInterruptModal();
      }
    });
  }

  // Setup preview player controls
  setupPreviewPlayerListeners();
}

/**
 * Opens the Auto Pattern Interrupt Modal and runs analysis on the current timeline.
 */
export function openPatternInterruptModal(): void {
  const modal = document.getElementById('pattern-interrupt-modal');
  if (!modal) return;

  if (!timelineState.clips?.length) {
    ui.showStatus('⚠️ Build or import storyboard shots onto the timeline first.', true, 3500);
    return;
  }

  modal.classList.remove('hidden');
  syncControlsToUI();
  runAnalysis();
}

/**
 * Closes the Auto Pattern Interrupt Modal and stops simulation playback.
 */
export function closePatternInterruptModal(): void {
  stopPreviewSimulation();
  const modal = document.getElementById('pattern-interrupt-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Sets up event listeners for the Live Preview Player.
 */
function setupPreviewPlayerListeners(): void {
  // Play/Pause button on canvas
  const canvasPlayBtn = document.getElementById('pi-preview-play-btn');
  if (canvasPlayBtn) {
    canvasPlayBtn.onclick = () => togglePreviewPlayback();
  }

  // Play/Pause toggle bar button
  const togglePlayBtn = document.getElementById('pi-preview-play-toggle-btn');
  if (togglePlayBtn) {
    togglePlayBtn.onclick = () => togglePreviewPlayback();
  }

  // Mode (Before vs After) Toggle button
  const toggleModeBtn = document.getElementById('pi-preview-toggle-mode-btn');
  if (toggleModeBtn) {
    toggleModeBtn.onclick = () => togglePreviewEffectMode();
  }

  // Sync with main player
  const syncMainBtn = document.getElementById('pi-preview-sync-main-btn');
  if (syncMainBtn) {
    syncMainBtn.onclick = () => syncMainTimelineWithPreview();
  }

  // Scrubber click/drag
  const scrubberTrack = document.getElementById('pi-preview-scrubber-track');
  if (scrubberTrack) {
    const handleScrub = (e: MouseEvent) => {
      const rect = scrubberTrack.getBoundingClientRect();
      if (rect.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      // Map frac [0, 1] to timeOffset [-windowLeadIn, -windowLeadIn + windowDuration]
      previewState.timeOffset = -previewState.windowLeadIn + frac * previewState.windowDuration;
      renderCurrentPreviewFrame();
    };

    scrubberTrack.addEventListener('click', (e) => {
      handleScrub(e);
    });
  }
}

/**
 * Syncs the current config settings with the UI control inputs.
 */
function syncControlsToUI(): void {
  // Intensity buttons
  const intensityButtons = document.querySelectorAll<HTMLButtonElement>('[data-pi-intensity]');
  intensityButtons.forEach((btn) => {
    const val = btn.dataset.piIntensity as InterruptIntensity;
    const isActive = val === currentConfig.intensity;
    btn.className = `px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
      isActive
        ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 border border-amber-400/40'
        : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-white/5'
    }`;
  });

  // Style select
  const styleSelect = document.getElementById('pi-style-select') as HTMLSelectElement | null;
  if (styleSelect) {
    styleSelect.value = currentConfig.style;
    styleSelect.onchange = () => {
      currentConfig.style = styleSelect.value as InterruptStyle;
      runAnalysis();
    };
  }

  // Max Per Minute select
  const maxPerMinSelect = document.getElementById('pi-max-per-min') as HTMLSelectElement | null;
  if (maxPerMinSelect) {
    maxPerMinSelect.value = String(currentConfig.maxPerMinute);
    maxPerMinSelect.onchange = () => {
      currentConfig.maxPerMinute = Number(maxPerMinSelect.value) || 2;
      runAnalysis();
    };
  }

  // Min Cooldown select
  const minCooldownSelect = document.getElementById('pi-min-cooldown') as HTMLSelectElement | null;
  if (minCooldownSelect) {
    minCooldownSelect.value = String(currentConfig.minDistanceSec);
    minCooldownSelect.onchange = () => {
      currentConfig.minDistanceSec = Number(minCooldownSelect.value) || 6.0;
      runAnalysis();
    };
  }

  // Avoid Consecutive checkbox
  const avoidConsecutiveCb = document.getElementById('pi-avoid-consecutive') as HTMLInputElement | null;
  if (avoidConsecutiveCb) {
    avoidConsecutiveCb.checked = currentConfig.avoidConsecutiveSameType;
    avoidConsecutiveCb.onchange = () => {
      currentConfig.avoidConsecutiveSameType = avoidConsecutiveCb.checked;
      runAnalysis();
    };
  }

  // Bind intensity click events
  intensityButtons.forEach((btn) => {
    btn.onclick = () => {
      const val = btn.dataset.piIntensity as InterruptIntensity;
      currentConfig.intensity = val;
      syncControlsToUI();
      runAnalysis();
    };
  });
}

/**
 * Runs the 3-stage timeline analysis and renders the candidate review list.
 */
function runAnalysis(): void {
  const summary = analyzeTimelineForPatternInterrupts(currentConfig);
  currentSummary = summary;
  currentCandidates = summary.filteredCandidates;

  renderSummaryHeader(summary);
  renderCandidatesList(currentCandidates);

  if (currentCandidates.length > 0) {
    // Select the first candidate for preview if none selected or if previous candidate no longer exists
    const existing = currentCandidates.find((c) => c.id === previewState.candidate?.id);
    selectCandidateForPreview(existing || currentCandidates[0]);
  } else {
    hidePreviewPlayer();
  }
}

/**
 * Renders the top summary banner with metrics and detection checkmarks.
 */
function renderSummaryHeader(summary: AnalysisSummary): void {
  const badge = document.getElementById('pi-candidates-count-badge');
  if (badge) {
    badge.textContent = `${summary.filteredCandidates.length} Proposed`;
  }

  const desc = document.getElementById('pi-summary-text');
  if (desc) {
    if (summary.filteredCandidates.length === 0) {
      desc.textContent =
        '✨ Timeline visual cadence is balanced and dynamic! No prolonged attention-drop stretches detected at this sensitivity.';
    } else {
      desc.textContent = `Identified ${summary.candidatesFound} monotonous stretches (${summary.totalMonotonousSeconds}s total). Applied intelligent pacing filters to select ${summary.filteredCandidates.length} high-impact interruptions.`;
    }
  }

  const undoBtn = document.getElementById('undo-pattern-interrupt-btn') as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.disabled = !timelineState.canUndo();
    undoBtn.classList.toggle('opacity-50', !timelineState.canUndo());
  }
}

/**
 * Formats a duration in seconds into MM:SS format.
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
}

/**
 * Renders the interactive candidate cards.
 */
function renderCandidatesList(candidates: MonotonyCandidate[]): void {
  const container = document.getElementById('pi-candidates-list');
  if (!container) return;

  container.innerHTML = '';

  if (!candidates.length) {
    container.innerHTML = `
      <div class="p-8 text-center bg-zinc-950/40 rounded-2xl border border-zinc-800/80">
        <div class="text-3xl mb-2">🎬</div>
        <h4 class="text-sm font-bold text-white mb-1">No Attention Bottlenecks Found</h4>
        <p class="text-xs text-zinc-400 max-w-md mx-auto">
          Your timeline has adequate visual dynamism, motion, and overlay density. Try switching sensitivity to <strong class="text-amber-400">High</strong> or adjusting the style preset if you want more aggressive interruptions.
        </p>
      </div>
    `;
    updateApplyButtonCounts();
    return;
  }

  candidates.forEach((cand) => {
    const isSelected = previewState.candidate?.id === cand.id;
    const card = document.createElement('div');
    card.id = `pi-card-${cand.id}`;
    card.className = `p-4 rounded-xl border transition-all ${
      isSelected
        ? 'bg-zinc-950/90 border-amber-500 shadow-lg shadow-amber-950/30'
        : cand.enabled
        ? 'bg-zinc-950/80 border-zinc-700/80 hover:border-amber-500/50 shadow-lg shadow-black/40'
        : 'bg-zinc-950/30 border-zinc-800/40 opacity-60'
    } flex flex-col gap-3`;

    // Category tag style
    const categoryBadge =
      cand.context.triggerCategory === 'emphasis'
        ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">Speech Emphasis</span>'
        : cand.context.triggerCategory === 'revelation'
        ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Revelation</span>'
        : cand.context.triggerCategory === 'statistic'
        ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Data Point</span>'
        : cand.context.triggerCategory === 'comparison'
        ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">Comparison</span>'
        : cand.context.triggerCategory === 'danger'
        ? '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-red-500/20 text-red-300 border border-red-500/30">High Stakes</span>'
        : '<span class="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">Pacing Reset</span>';

    // Intensity level badge
    const levelBadge =
      cand.intervention.level === 1
        ? '<span class="text-[10px] text-zinc-400 font-mono">Level 1 (Micro)</span>'
        : cand.intervention.level === 2
        ? '<span class="text-[10px] text-amber-400 font-mono">Level 2 (Visual)</span>'
        : '<span class="text-[10px] text-rose-400 font-mono">Level 3 (Strong)</span>';

    // Build alternative options for the dropdown
    const allOptions = [cand.intervention, ...cand.alternativeInterventions];
    const optionsHtml = allOptions
      .map(
        (opt) =>
          `<option value="${opt.type}" ${opt.type === cand.intervention.type ? 'selected' : ''}>${opt.label}</option>`
      )
      .join('');

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <!-- Left: Checkbox + Timestamp + Monotony Meter -->
        <div class="flex items-center gap-3">
          <input type="checkbox" id="pi-check-${cand.id}" class="w-4 h-4 rounded text-amber-500 bg-zinc-900 border-zinc-700 focus:ring-amber-500 cursor-pointer" ${cand.enabled ? 'checked' : ''} />
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 text-xs font-mono font-bold bg-zinc-800 text-amber-300 border border-white/10 rounded">
                ⏱️ ${formatTime(cand.timestamp)}
              </span>
              ${categoryBadge}
              <span class="text-[10px] text-zinc-400 font-mono">Shot #${cand.clipIndex + 1}</span>
            </div>
            <div class="flex items-center gap-2 mt-1.5 text-[11px] text-zinc-400">
              <span title="${cand.metrics.scoreBreakdown ? `Score Breakdown: Duration=${cand.metrics.scoreBreakdown.durationFactor}, Static=${cand.metrics.scoreBreakdown.staticFactor}, OverlayLack=${cand.metrics.scoreBreakdown.overlayLackFactor}, Narrative=${cand.metrics.scoreBreakdown.narrativeWeight}` : 'Composite Monotony Heuristic'}">
                Monotony Score: <strong class="text-white underline decoration-dotted decoration-zinc-500 cursor-help">${cand.metrics.monotonyScore}%</strong>
              </span>
              <span class="text-zinc-600">•</span>
              <span>Stretch: <strong class="text-zinc-300">${cand.metrics.duration}s</strong></span>
              <span class="text-zinc-600">•</span>
              <span>Motion: <strong class="text-zinc-300">${cand.metrics.motionPct}%</strong></span>
              ${cand.context.detectionMethod ? `<span class="text-zinc-600">•</span><span class="text-[9px] uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">${cand.context.detectionMethod}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Right: Interactive Preview Trigger Button -->
        <button type="button" id="pi-preview-btn-${cand.id}" class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer ${
          isSelected
            ? 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-600/30'
            : 'text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border-amber-500/30'
        }" title="Simulate pattern interrupt live in player">
          <span>${isSelected ? '▶' : '👁️'}</span>
          <span>${isSelected ? 'Previewing' : 'Preview Effect'}</span>
        </button>
      </div>

      <!-- Narrative context & quote -->
      <div class="bg-zinc-900/60 rounded-lg p-2.5 border border-white/5 text-xs flex flex-col gap-1">
        <div class="text-[11px] text-zinc-400 flex items-center justify-between">
          <span class="font-medium text-amber-400/90">${cand.context.reason}</span>
          ${levelBadge}
        </div>
        <div class="italic text-zinc-200">
          "${utils.escapeHtml(cand.context.verbatimPhrase)}"
        </div>
      </div>

      <!-- Proposed Intervention selector -->
      <div class="flex items-center justify-between gap-3 pt-1 border-t border-zinc-800/60">
        <div class="flex items-center gap-2 flex-grow">
          <span class="text-xs text-zinc-400 font-medium">Intervention:</span>
          <select id="pi-select-${cand.id}" class="bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-2.5 py-1.5 outline-none focus:border-amber-500 cursor-pointer max-w-sm flex-grow">
            ${optionsHtml}
          </select>
        </div>
        <span class="text-[11px] text-zinc-400 hidden sm:inline truncate max-w-xs" id="pi-desc-${cand.id}">
          ${cand.intervention.description}
        </span>
      </div>
    `;

    // Bind checkbox
    const checkbox = card.querySelector(`#pi-check-${cand.id}`) as HTMLInputElement | null;
    if (checkbox) {
      checkbox.onchange = () => {
        cand.enabled = checkbox.checked;
        card.classList.toggle('opacity-60', !cand.enabled);
        updateApplyButtonCounts();
      };
    }

    // Bind intervention select dropdown
    const select = card.querySelector(`#pi-select-${cand.id}`) as HTMLSelectElement | null;
    const descSpan = card.querySelector(`#pi-desc-${cand.id}`) as HTMLSpanElement | null;
    if (select) {
      select.onchange = () => {
        const chosenType = select.value as InterventionType;
        const matched = allOptions.find((o) => o.type === chosenType);
        if (matched) {
          cand.intervention = matched;
          if (descSpan) descSpan.textContent = matched.description;
          if (previewState.candidate?.id === cand.id) {
            updatePreviewPlayerMetadata(cand);
            renderCurrentPreviewFrame();
          }
        }
      };
    }

    // Bind preview button
    const previewBtn = card.querySelector(`#pi-preview-btn-${cand.id}`) as HTMLButtonElement | null;
    if (previewBtn) {
      previewBtn.onclick = () => {
        selectCandidateForPreview(cand);
        // Scroll player into view if needed
        const playerContainer = document.getElementById('pi-preview-player-container');
        if (playerContainer) {
          playerContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      };
    }

    container.appendChild(card);
  });

  updateApplyButtonCounts();
}

/**
 * Selects a candidate and launches the live interactive simulation loop.
 */
function selectCandidateForPreview(candidate: MonotonyCandidate): void {
  previewState.candidate = candidate;
  previewState.timeOffset = -previewState.windowLeadIn;
  previewState.isPlaying = true;

  updatePreviewPlayerMetadata(candidate);
  highlightSelectedCandidateCard(candidate.id);

  const container = document.getElementById('pi-preview-player-container');
  if (container) {
    container.classList.remove('hidden');
  }

  startPreviewSimulationLoop();
}

/**
 * Updates candidate header labels and metadata on the Preview Player.
 */
function updatePreviewPlayerMetadata(cand: MonotonyCandidate): void {
  const titleEl = document.getElementById('pi-preview-title');
  if (titleEl) {
    titleEl.textContent = `Shot #${cand.clipIndex + 1} • ${formatTime(cand.timestamp)}`;
  }

  const badgeEl = document.getElementById('pi-preview-type-badge');
  if (badgeEl) {
    badgeEl.textContent = cand.intervention.label;
  }

  const quoteEl = document.getElementById('pi-preview-quote');
  if (quoteEl) {
    quoteEl.textContent = `"${cand.context.verbatimPhrase}"`;
  }
}

/**
 * Updates card highlight styles when preview candidate changes.
 */
function highlightSelectedCandidateCard(selectedId: string): void {
  currentCandidates.forEach((c) => {
    const card = document.getElementById(`pi-card-${c.id}`);
    const btn = document.getElementById(`pi-preview-btn-${c.id}`);
    const isSelected = c.id === selectedId;

    if (card) {
      if (isSelected) {
        card.classList.add('border-amber-500', 'bg-zinc-950/90', 'shadow-amber-950/30');
        card.classList.remove('border-zinc-700/80');
      } else {
        card.classList.remove('border-amber-500', 'shadow-amber-950/30');
        if (c.enabled) card.classList.add('border-zinc-700/80');
      }
    }

    if (btn) {
      if (isSelected) {
        btn.className =
          'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-600/30';
        btn.innerHTML = '<span>▶</span> <span>Previewing</span>';
      } else {
        btn.className =
          'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border flex items-center gap-1.5 cursor-pointer text-amber-300 bg-amber-950/40 hover:bg-amber-900/60 border-amber-500/30';
        btn.innerHTML = '<span>👁️</span> <span>Preview Effect</span>';
      }
    }
  });
}

/**
 * Starts the requestAnimationFrame simulation loop.
 */
function startPreviewSimulationLoop(): void {
  if (previewState.animFrameId) {
    cancelAnimationFrame(previewState.animFrameId);
  }

  previewState.lastRafTimestamp = performance.now();

  const loop = (timestamp: number) => {
    const delta = (timestamp - previewState.lastRafTimestamp) / 1000;
    previewState.lastRafTimestamp = timestamp;

    if (previewState.isPlaying && previewState.candidate) {
      previewState.timeOffset += delta;
      // Loop across [-windowLeadIn, -windowLeadIn + windowDuration]
      const maxOffset = -previewState.windowLeadIn + previewState.windowDuration;
      if (previewState.timeOffset > maxOffset) {
        previewState.timeOffset = -previewState.windowLeadIn;
      }
    }

    renderCurrentPreviewFrame();

    const modal = document.getElementById('pattern-interrupt-modal');
    if (modal && !modal.classList.contains('hidden') && previewState.candidate) {
      previewState.animFrameId = requestAnimationFrame(loop);
    } else {
      previewState.animFrameId = null;
    }
  };

  previewState.animFrameId = requestAnimationFrame(loop);
}

/**
 * Stops preview simulation and clears animation frame.
 */
function stopPreviewSimulation(): void {
  if (previewState.animFrameId) {
    cancelAnimationFrame(previewState.animFrameId);
    previewState.animFrameId = null;
  }
}

/**
 * Hides the Preview Player.
 */
function hidePreviewPlayer(): void {
  stopPreviewSimulation();
  previewState.candidate = null;
  const container = document.getElementById('pi-preview-player-container');
  if (container) {
    container.classList.add('hidden');
  }
}

/**
 * Toggles Play / Pause for the preview simulation.
 */
function togglePreviewPlayback(): void {
  previewState.isPlaying = !previewState.isPlaying;

  const btnText = document.getElementById('pi-preview-btn-text');
  const btnIcon = document.getElementById('pi-preview-btn-icon');
  const playOverlayIcon = document.getElementById('pi-preview-play-icon');

  if (btnText) btnText.textContent = previewState.isPlaying ? 'Pause' : 'Play Loop';
  if (btnIcon) btnIcon.textContent = previewState.isPlaying ? '⏸' : '▶';
  if (playOverlayIcon) playOverlayIcon.textContent = previewState.isPlaying ? '⏸' : '▶';

  if (previewState.isPlaying && !previewState.animFrameId) {
    startPreviewSimulationLoop();
  }
}

/**
 * Toggles Before vs After effect comparison.
 */
function togglePreviewEffectMode(): void {
  previewState.showEffect = !previewState.showEffect;

  const label = document.getElementById('pi-preview-mode-label');
  const btn = document.getElementById('pi-preview-toggle-mode-btn');

  if (label) {
    label.textContent = previewState.showEffect ? 'Effect: Simulated' : 'Baseline: Raw';
  }
  if (btn) {
    if (previewState.showEffect) {
      btn.className =
        'px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 transition flex items-center gap-1.5 cursor-pointer';
    } else {
      btn.className =
        'px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer';
    }
  }

  renderCurrentPreviewFrame();
}

/**
 * Synchronizes the main editor timeline with the currently previewed candidate moment.
 */
function syncMainTimelineWithPreview(): void {
  if (!previewState.candidate) return;
  const t = previewState.candidate.timestamp;
  state.lastRenderedTime = t;
  state.videoPauseTime = t;
  drawVideoFrame(t);
  ui.renderTimelineEditor();
  ui.showStatus(`📍 Playhead synced to Shot #${previewState.candidate.clipIndex + 1} (${formatTime(t)})`, false, 2000);
}

/**
 * Renders the simulated frame to pi-preview-canvas with the motivated intervention applied.
 */
function renderCurrentPreviewFrame(): void {
  const canvas = document.getElementById('pi-preview-canvas') as HTMLCanvasElement | null;
  if (!canvas || !previewState.candidate) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cand = previewState.candidate;
  const targetTime = Math.max(0, cand.timestamp + previewState.timeOffset);

  // 1. Render base scene onto offscreen buffer
  const offscreen = getOffscreen(canvas.width, canvas.height);
  const offCtx = offscreen.getContext('2d', { alpha: false });
  if (offCtx) {
    drawVideoFrame(targetTime, offscreen, offCtx);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isAfterTrigger = previewState.timeOffset >= 0;
  const itype = cand.intervention.type;

  // 2. Draw base frame with simulated Camera / Punch-in Transform if active
  if (previewState.showEffect && isAfterTrigger) {
    if (itype === 'punch_in') {
      const targetScale = cand.intervention.payload.scale || 1.18;
      // Snappy bounce/spring entry during the first 0.18s
      const punchDuration = 0.18;
      let currentScale = targetScale;
      if (previewState.timeOffset < punchDuration) {
        const p = previewState.timeOffset / punchDuration;
        // Overshoot slightly for high-impact punch
        const overshoot = 1.0 + Math.sin(p * Math.PI) * 0.06;
        currentScale = 1.0 + (targetScale - 1.0) * p * overshoot;
      }

      ctx.save();
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(currentScale, currentScale);
      ctx.translate(-cx, -cy);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else if (itype === 'camera_movement') {
      const p = Math.min(1.0, previewState.timeOffset / 2.0);
      const zoom = 1.0 + p * 0.12;
      const panX = Math.sin(p * Math.PI * 0.5) * (canvas.width * 0.03);

      ctx.save();
      const cx = canvas.width * 0.5 + panX;
      const cy = canvas.height * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width * 0.5, -canvas.height * 0.5);
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    }
  } else {
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }

  // 3. Draw simulated Graphic Overlays if active
  if (previewState.showEffect && isAfterTrigger) {
    const elapsedSinceTrigger = previewState.timeOffset;

    if (itype === 'text_emphasis') {
      const dur = cand.intervention.payload.duration || 2.2;
      if (elapsedSinceTrigger <= dur) {
        const textToDisplay = cand.intervention.payload.text || cand.context.emphasisWord || 'KEY TAKEAWAY';
        const simulatedGraphic: GraphicEvent = {
          id: 'pi_preview_graphic',
          type: 'titleCard',
          start: cand.timestamp,
          end: cand.timestamp + dur,
          title: textToDisplay,
          subtitle: cand.context.verbatimPhrase ? `"${cand.context.verbatimPhrase.slice(0, 32)}..."` : undefined,
          theme: 'gradient-glass',
          accentColor: '#f59e0b',
          animationType: 'pop',
          backdrop: 'scrim'
        };
        drawGraphics(ctx, targetTime, canvas.width, canvas.height, [simulatedGraphic]);
      }
    } else if (itype === 'stat_callout') {
      const dur = 2.5;
      if (elapsedSinceTrigger <= dur) {
        const statVal = cand.intervention.payload.value || '10x';
        const statLabel = cand.intervention.payload.label || 'CRITICAL METRIC';
        const simulatedGraphic: GraphicEvent = {
          id: 'pi_preview_stat',
          type: 'statCounter',
          start: cand.timestamp,
          end: cand.timestamp + dur,
          value: statVal,
          label: statLabel,
          accentColor: '#10b981',
          animationType: 'bounce',
          theme: 'bold-badge'
        } as any;
        drawGraphics(ctx, targetTime, canvas.width, canvas.height, [simulatedGraphic]);
      }
    } else if (itype === 'spotlight') {
      const dur = cand.intervention.payload.duration || 2.2;
      if (elapsedSinceTrigger <= dur) {
        const simulatedGraphic: GraphicEvent = {
          id: 'pi_preview_spot',
          type: 'spotlightFocus',
          start: cand.timestamp,
          end: cand.timestamp + dur,
          focusX: 0.5,
          focusY: 0.45,
          radius: 0.36,
          dimOpacity: 0.65,
          feather: 0.22
        } as any;
        drawGraphics(ctx, targetTime, canvas.width, canvas.height, [simulatedGraphic]);
      }
    } else if (itype === 'image_pip') {
      // Draw simulated PiP inset in bottom-right corner
      const pipW = canvas.width * 0.35;
      const pipH = canvas.height * 0.35;
      const pipX = canvas.width - pipW - 16;
      const pipY = canvas.height - pipH - 16;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#1e1b4b';
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(pipX, pipY, pipW, pipH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#c7d2fe';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔍 B-Roll Cutaway', pipX + pipW / 2, pipY + pipH / 2);
      ctx.restore();
    }
  }

  // 4. Update UI Scrubber & Status badge
  updatePreviewUiIndicators();
}

/**
 * Updates the scrubber progress bar, time labels, and trigger flash indicators.
 */
function updatePreviewUiIndicators(): void {
  const progressBar = document.getElementById('pi-preview-progress-bar');
  const timeLabel = document.getElementById('pi-preview-time-label');
  const statusText = document.getElementById('pi-preview-status-text');
  const statusDot = document.getElementById('pi-preview-status-dot');

  // Offset [-windowLeadIn, -windowLeadIn + windowDuration] -> progress [0, 1]
  const progressFrac = Math.max(
    0,
    Math.min(1, (previewState.timeOffset + previewState.windowLeadIn) / previewState.windowDuration)
  );

  if (progressBar) {
    progressBar.style.width = `${progressFrac * 100}%`;
  }

  if (timeLabel) {
    const curSec = (previewState.timeOffset + previewState.windowLeadIn).toFixed(1);
    timeLabel.textContent = `${curSec}s / ${previewState.windowDuration.toFixed(1)}s`;
  }

  const isTriggerMoment = Math.abs(previewState.timeOffset) < 0.2;
  const isAfterTrigger = previewState.timeOffset >= 0;

  if (statusText && statusDot) {
    if (!previewState.showEffect) {
      statusText.textContent = 'Monotonous Baseline (Raw)';
      statusDot.className = 'w-2 h-2 rounded-full bg-zinc-500';
    } else if (isTriggerMoment) {
      statusText.textContent = '⚡ Pacing Reset Trigger!';
      statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping';
    } else if (isAfterTrigger) {
      statusText.textContent = `Intervention Active (${previewState.candidate?.intervention.label})`;
      statusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    } else {
      statusText.textContent = 'Lead-in (Pre-Interrupt)';
      statusDot.className = 'w-2 h-2 rounded-full bg-amber-400/60';
    }
  }
}

/**
 * Updates the counters on the Apply buttons.
 */
function updateApplyButtonCounts(): void {
  const selectedCount = currentCandidates.filter((c) => c.enabled).length;

  const applySelectedBtn = document.getElementById('apply-selected-pattern-interrupt-btn');
  if (applySelectedBtn) {
    applySelectedBtn.innerHTML = `<span>⚡</span> <span>Apply Selected (${selectedCount})</span>`;
    (applySelectedBtn as HTMLButtonElement).disabled = selectedCount === 0;
    applySelectedBtn.classList.toggle('opacity-50', selectedCount === 0);
  }

  const applyAllBtn = document.getElementById('apply-all-pattern-interrupt-btn');
  if (applyAllBtn) {
    applyAllBtn.innerHTML = `<span>🚀</span> <span>Apply All (${currentCandidates.length})</span>`;
    (applyAllBtn as HTMLButtonElement).disabled = currentCandidates.length === 0;
    applyAllBtn.classList.toggle('opacity-50', currentCandidates.length === 0);
  }
}

/**
 * Renders prominent user feedback for applied vs skipped interventions.
 */
function renderApplyFeedback(result: ApplyResult, totalAttempted: number): void {
  if (result.skipped && result.skipped.length > 0) {
    showSkippedInterventionsNotice(result, totalAttempted);
  } else {
    ui.showStatus(
      `🎬 Auto Pattern Interrupt: successfully injected ${result.appliedCount} pacing resets!`,
      false,
      4000
    );
  }
}

/**
 * Displays visible notification toast with expandable details for skipped candidates.
 */
export function showSkippedInterventionsNotice(result: ApplyResult, totalAttempted: number): void {
  // Remove any existing notification
  document.getElementById('pi-skipped-notice-toast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'pi-skipped-notice-toast';
  toast.className =
    'fixed bottom-6 right-6 z-[120] max-w-md w-full bg-zinc-950/95 border border-amber-500/60 rounded-2xl shadow-2xl p-4 text-white text-xs backdrop-blur-xl animate-fade-in flex flex-col gap-2';

  const detailsHtml = result.skipped
    .map(
      (s) =>
        `<li class="leading-relaxed"><strong class="text-amber-400 font-mono text-[10px]">[${utils.escapeHtml(s.id)}]</strong>: ${utils.escapeHtml(s.reason)}</li>`
    )
    .join('');

  toast.innerHTML = `
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2 font-bold text-amber-300">
        <span>⚠️</span>
        <span>${result.appliedCount} of ${totalAttempted} interrupts applied — ${result.skipped.length} skipped</span>
      </div>
      <button type="button" id="pi-close-skipped-notice-btn" class="text-zinc-400 hover:text-white p-1 text-sm cursor-pointer">✕</button>
    </div>
    <p class="text-zinc-400 text-[11px]">
      Some candidates were skipped due to timeline constraints or higher-priority conflicts.
    </p>
    <details class="mt-1 bg-zinc-900/90 rounded-lg p-2 border border-white/5">
      <summary class="cursor-pointer text-amber-400 hover:text-amber-300 font-medium select-none text-[11px]">
        (see details) ▾
      </summary>
      <ul class="list-disc pl-4 mt-2 space-y-1.5 text-zinc-300 text-[11px] max-h-40 overflow-y-auto custom-scrollbar">
        ${detailsHtml}
      </ul>
    </details>
  `;

  document.body.appendChild(toast);
  toast.querySelector('#pi-close-skipped-notice-btn')?.addEventListener('click', () => {
    toast.remove();
  });

  ui.showStatus(
    `⚠️ ${result.appliedCount} of ${totalAttempted} interrupts applied — ${result.skipped.length} skipped (see details)`,
    false,
    6000
  );
}

/**
 * Handles applying all proposed candidates.
 */
function handleApplyAll(): void {
  if (!currentCandidates.length) return;

  const totalAttempted = currentCandidates.length;
  currentCandidates.forEach((c) => (c.enabled = true));
  const result = applyPatternInterrupts(currentCandidates);

  renderApplyFeedback(result, totalAttempted);
  closePatternInterruptModal();
}

/**
 * Handles applying only the enabled candidates.
 */
function handleApplySelected(): void {
  const toApply = currentCandidates.filter((c) => c.enabled);
  if (!toApply.length) return;

  const totalAttempted = toApply.length;
  const result = applyPatternInterrupts(toApply);

  renderApplyFeedback(result, totalAttempted);
  closePatternInterruptModal();
}

/**
 * Handles undoing previously applied pattern interrupts.
 */
function handleUndo(): void {
  const ok = undoPatternInterrupts();
  if (ok) {
    ui.showStatus('↩️ Reverted pattern interrupts to prior state.', false, 3000);
    closePatternInterruptModal();
  } else {
    ui.showStatus('⚠️ No undo history available for pattern interrupts.', true, 3000);
  }
}
