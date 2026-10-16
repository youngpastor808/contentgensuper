/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from './dom';
import * as constants from './constants';
import { state } from './state';
import { DB } from './db';
import { formatTime, audioBufferToWavBlob, pacingMap, debounce, getPixelsPerSecond, getMatchingResolutionKey, getGuest320pResolutionKey, EXPORT_RESOLUTION_MAP, getShotRange } from './utils-core';
import { isUsingPersonalKey } from './api/core';
import { isGuest, isCookieAuthAllowedForCurrentUser } from './auth';
import { videoRenderContext } from './videoRenderer';
import { timelineState } from './state-timeline';
import type { CharacterProfile, VoiceArchetype } from './types';
import { DESIGN_ARCHETYPES } from './templates';
import { assetStorage } from './assetStorage';
import { updateAspectRatioState } from './ui-renderers';
import { getScriptDerivedTitle, escapeHtml } from './utils';

export { escapeHtml };

function qs<T extends Element>(root: ParentNode, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

export function populateVoiceArchetypes() {
    if (!dom.gradioVoiceArchetypeSelect) return;

    const select = dom.gradioVoiceArchetypeSelect;
    select.innerHTML = '<option value="">Select an archetype...</option>'; 

    const categories: { [key: string]: VoiceArchetype[] } = {};
    DESIGN_ARCHETYPES.forEach(archetype => {
        if (!categories[archetype.category]) {
            categories[archetype.category] = [];
        }
        categories[archetype.category].push(archetype);
    });

    for (const category in categories) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        categories[category].forEach(archetype => {
            const option = document.createElement('option');
            option.value = archetype.value;
            option.textContent = archetype.label;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    }
}

export function updateApiStatusBadge() {
  const badge = document.getElementById('api-status-badge');
  if (!badge) return;
  const isPersonal = isUsingPersonalKey();
  if (!isPersonal) {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  if (state.geminiAuthMode === 'webCookie') {
    const isExpired = sessionStorage.getItem('geminiCookieExpired') === 'true' || localStorage.getItem('geminiCookieExpired') === 'true';
    if (isExpired) {
      badge.textContent = 'C-Api Expired';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-red-500/50 bg-red-900/30 text-red-400 uppercase tracking-widest mt-1';
    } else {
      badge.textContent = 'C-Api Active';
      badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/50 bg-green-900/20 text-green-400 uppercase tracking-widest mt-1';
    }
    return;
  }

  if (state.geminiAuthMode === 'openaiGateway') {
    badge.textContent = 'GW-Api Active';
    badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-500/50 bg-indigo-900/30 text-indigo-300 uppercase tracking-widest mt-1';
    return;
  }

  if (state.geminiProvider === 'vertex') {
    // Only show the badge if they have actually configured a project ID or an API key
    if (state.vertexAuthMode === 'apiKey' && !state.userGeminiApiKey) {
      badge.classList.add('hidden');
      return;
    }
    if (state.vertexAuthMode === 'adc' && !state.vertexProjectId) {
      badge.classList.add('hidden');
      return;
    }

    badge.textContent = 'VLive';
    badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-purple-500/50 bg-purple-900/30 text-purple-300 uppercase tracking-widest mt-1';
    return;
  }
  
  badge.textContent = 'Personal Key Active';
  badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/50 bg-green-900/20 text-green-400 uppercase tracking-widest mt-1';
}

export function updateCreditsDisplay() {
  const display = document.getElementById('user-credits-display');
  const amount = document.getElementById('user-credits-amount');
  const warning = document.getElementById('low-credits-warning');
  
  // Credits are shown inside the user profile dropdown and profile modal; keep hidden on main UI header
  if (display) display.classList.add('hidden');
  if (warning) warning.classList.add('hidden');

  const creditsVal = (state.userCredits !== undefined && state.userCredits !== null)
      ? Math.floor(state.userCredits).toLocaleString()
      : '0';

  if (amount) {
      amount.textContent = creditsVal;
  }

  const dropdownCredits = document.getElementById('dropdown-user-credits');
  if (dropdownCredits) {
      dropdownCredits.textContent = creditsVal;
  }

  const profileCredits = document.getElementById('profile-credits-display');
  if (profileCredits) {
      profileCredits.textContent = creditsVal;
  }

  updateCloudRenderQuotaDisplay();
}

export function updateCloudRenderQuotaDisplay() {
  const display = document.getElementById('user-cloud-render-display');
  const amount = document.getElementById('user-cloud-render-amount');
  const dropdownMins = document.getElementById('dropdown-user-render-mins');
  const profileMins = document.getElementById('profile-render-mins-display');
  const modalQuotaText = document.getElementById('cloud-render-quota-text');

  const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
  const used = state.renderMinutesUsed || 0;
  const remaining = Math.max(0, quota - used);

  if (amount) {
      amount.textContent = String(Math.round(remaining));
  }
  // Minutes / render quota are displayed in the profile area (dropdown & modal); keep hidden on main UI header
  if (display) {
      display.classList.add('hidden');
  }
  if (dropdownMins) {
      dropdownMins.textContent = `${Math.round(remaining)} mins`;
  }
  if (profileMins) {
      profileMins.textContent = `${Math.round(remaining)} mins`;
  }
  if (modalQuotaText) {
      modalQuotaText.textContent = `${Math.round(remaining)} mins remaining`;
  }
}

let currentStatusTimeout: number | null = null;

export interface StatusAction {
  label: string;
  onClick: () => void;
  id?: string;
}

(window as any).showStatusFn = showStatus;
export function showStatus(message: string, isError = false, duration = 4000, action?: StatusAction) {
  if (currentStatusTimeout !== null) {
    window.clearTimeout(currentStatusTimeout);
    currentStatusTimeout = null;
  }
  if (!message) {
    dom.statusContainer.innerHTML = '';
    return;
  }
  if (isError && /quota|rate limit|resource_exhausted/i.test(message)) {
      isError = false;
      if (/generic::resource_exhausted|You exceeded your current quota|ai\.google\.dev\/gemini-api\/docs\/rate-limits/i.test(message)) {
          message = "⚠️ Gemini API rate limit or quota reached. Please wait 15–30 seconds before retrying, or check your API key in Settings.";
      } else if (!message.startsWith('Notice') && !message.startsWith('⚠️')) {
          message = "⚠️ " + message.replace(/^Notice:\s*/i, '');
      }
      if (!action) {
          action = {
              id: 'status-open-settings-quota-btn',
              label: '⚙️ API Key',
              onClick: () => {
                  dom.geminiApiKeyInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  dom.geminiApiKeyInput?.focus();
              }
          };
      }
  }
  const safe = escapeHtml(message);
  const actionBtnId = action ? (action.id || `status-action-btn-${Date.now()}`) : null;
  const actionHtml = action && actionBtnId 
    ? `<button id="${actionBtnId}" type="button" class="pointer-events-auto ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer border border-teal-400/40 shrink-0">${escapeHtml(action.label)}</button>` 
    : '';

  dom.statusContainer.innerHTML =
    `<div class="p-2.5 px-3.5 rounded-xl text-xs sm:text-sm font-medium shadow-lg backdrop-blur-md flex items-center justify-between gap-3 pointer-events-auto max-w-lg w-full mx-auto ${isError ? 'bg-red-950/90 text-red-200 border border-red-500/40' : 'bg-gray-900/95 text-teal-200 border border-teal-500/40'}">
      <div class="flex-1 min-w-0 text-left break-words break-all max-h-36 overflow-y-auto custom-scrollbar">${safe}</div>
      ${actionHtml}
    </div>`;

  if (action && actionBtnId) {
    const btn = document.getElementById(actionBtnId);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        action.onClick();
      });
    }
  }

  if (duration > 0) {
    currentStatusTimeout = window.setTimeout(() => {
      dom.statusContainer.innerHTML = '';
      currentStatusTimeout = null;
    }, duration);
  }
}

function getTimestampModeHint(): string {
    const hasKey = !!(state.ai33ApiKey || state.elevenlabsApiKey);
    if (!hasKey) return '⚠️ Requires AI33 or ElevenLabs API key. Instant Timestamps will not be used.';
    if (state.useInstantTimestamps) return '✅ Enabled: Faster narration using AI33/ElevenLabs credits. Falls back to Gemini if it fails.';
    return 'ℹ️ Disabled: Using Gemini for narration and alignment. Slower but may use fewer specialized credits.';
}

export function updateTimestampHint() {
    if (dom.timestampModeHint) dom.timestampModeHint.innerHTML = getTimestampModeHint();
}

export function setButtonsDisabled(disabled: boolean) {
  const buttons = [dom.sparkBtn, dom.enhanceBtn, dom.suggestStyleBtn, dom.identifyCharactersBtn, dom.identifyLocationsBtn, dom.identifyElementsBtn, dom.analyzeBtn];
  for (const btn of buttons) {
    if (btn) {
        btn.disabled = disabled;
        btn.classList.toggle('opacity-50', disabled);
        btn.classList.toggle('cursor-not-allowed', disabled);
    }
  }
}

export function showConfirmation(title: string, message: string, onConfirm: () => void, onCancel?: () => void) {
  if (!dom.confirmationModal) return;
  if (dom.confirmationTitle) dom.confirmationTitle.textContent = title;
  if (dom.confirmationMessage) dom.confirmationMessage.textContent = message;
  state.confirmCallback = onConfirm;
  state.cancelCallback = onCancel || null;
  dom.confirmationModal.classList.remove('hidden');
}

export function hideConfirmation() {
  if (state.cancelCallback) state.cancelCallback();
  if (dom.confirmationModal) dom.confirmationModal.classList.add('hidden');
  state.confirmCallback = null;
  state.cancelCallback = null;
}

let closeTimeout: number | null = null;

export async function openProcessingModal(
    title: string, 
    cancellable = true, 
    cancelBtnText = 'Stop Processing',
    onCancel?: () => void
): Promise<AbortSignal> {
  if (closeTimeout) {
      window.clearTimeout(closeTimeout);
      closeTimeout = null;
  }
  
  // Abort any previous pending processing controller
  if (state.currentProcessingAbortController) {
      try { 
          state.currentProcessingAbortController.abort(); 
      } catch (abortErr) {
          console.warn("Error aborting previous processing controller:", abortErr);
      }
  }
  
  const controller = new AbortController();
  state.currentProcessingAbortController = controller;
  state.cancelProcessingCallback = onCancel || null;

  if (dom.progressTitle) dom.progressTitle.textContent = title;
  if (dom.progressBarIndicator) dom.progressBarIndicator.style.width = '1%';
  if (dom.progressText) dom.progressText.textContent = 'Initializing...';
  if (dom.progressPercent) dom.progressPercent.textContent = '1%';
  if (dom.progressCancelBtn) dom.progressCancelBtn.textContent = cancelBtnText;
  if (dom.progressCancelContainer) dom.progressCancelContainer.classList.toggle('hidden', !cancellable);
  
  if (dom.progressIndicator) {
      dom.progressIndicator.classList.remove('hidden');
      
      // Wait two animation frames so the browser paints the element before
      // adding 'visible' — this ensures the slide-up transition is always
      // visible even when export completes very quickly.
      // We add a setTimeout fallback in case the tab is in the background.
      await new Promise<void>(resolve => {
          let fired = false;
          const done = () => {
              if (!fired) {
                  fired = true;
                  resolve();
              }
          };
          requestAnimationFrame(() => requestAnimationFrame(done));
          setTimeout(done, 50);
      });
      
      if (dom.progressIndicator) {
          dom.progressIndicator.classList.remove('translate-y-full');
          dom.progressIndicator.classList.add('translate-y-0');
      }
      
      // Brief additional wait to let the CSS transition start rendering
      await new Promise(resolve => setTimeout(resolve, 50));
  }
  return controller.signal;
}

export function cancelCurrentProcessing() {
    let customHandled = false;
    if (state.cancelProcessingCallback) {
        try {
            const res = state.cancelProcessingCallback();
            if (res === true || res === 'background') {
                customHandled = true;
            }
        } catch (err) {
            console.warn("Cancel callback error:", err);
        }
        state.cancelProcessingCallback = null;
    }

    if (customHandled) {
        closeProcessingModal();
        setButtonsDisabled(false);
        return;
    }

    if (state.currentProcessingAbortController) {
        try {
            state.currentProcessingAbortController.abort();
        } catch (err) {
            console.warn("Abort controller error:", err);
        }
        state.currentProcessingAbortController = null;
    }
    state.isVideoProductionRunning = false;
    closeProcessingModal();
    setButtonsDisabled(false);
    showStatus('Processing stopped.', false, 3000);
}

let lastLogMessage = '';

export function updateProcessingProgress(percent: number, message: string) {
  const safePercent = Math.max(1, Math.min(100, Math.round(percent)));
  if (dom.progressBarIndicator) dom.progressBarIndicator.style.width = `${safePercent}%`;
  if (dom.progressPercent) dom.progressPercent.textContent = `${safePercent}%`;
  if (message && dom.progressText) dom.progressText.textContent = message;
  
  if (message && message !== lastLogMessage) {
      logProductionStatus(message);
      lastLogMessage = message;
  }
}

export function logProductionStatus(msg: string, isError = false) {
    if (isError && /quota|rate limit/i.test(msg)) {
        isError = false;
        if (!msg.startsWith('Notice')) {
            msg = "Notice: " + msg;
        }
    }
    if (!dom.videoStatusLog) return;
    
    // Remove "System Ready." placeholder if present
    if (dom.videoStatusLog.querySelector('.italic')) {
        dom.videoStatusLog.innerHTML = '';
    }

    const p = document.createElement('div');
    p.className = `flex items-start gap-1.5 leading-tight py-0.5 ${isError ? 'text-red-400' : 'text-gray-300'}`;
    
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    p.innerHTML = `<span class="text-gray-500 font-mono text-[9px] select-none flex-shrink-0">[${timeStr}]</span> <span class="flex-grow select-text">${escapeHtml(msg)}</span>`;
    dom.videoStatusLog.appendChild(p);
    dom.videoStatusLog.scrollTop = dom.videoStatusLog.scrollHeight;
}

export function closeProcessingModal() {
  state.cancelProcessingCallback = null;
  state.currentProcessingAbortController = null;
  if (dom.progressIndicator) {
      dom.progressIndicator.classList.remove('translate-y-0');
      dom.progressIndicator.classList.add('translate-y-full');
      if (closeTimeout) window.clearTimeout(closeTimeout);
      closeTimeout = window.setTimeout(() => {
        if (dom.progressIndicator) dom.progressIndicator.classList.add('hidden');
        if (dom.progressCancelContainer) dom.progressCancelContainer.classList.add('hidden');
        closeTimeout = null;
      }, 300);
  }
}

export function updateSuggestStyleButtonState() {
  const hasStory = dom.storyInput.value.trim().length > 0;
  dom.suggestStyleBtn.disabled = !hasStory;
  dom.suggestStyleBtn.classList.toggle('opacity-50', !hasStory);
  dom.suggestStyleBtn.classList.toggle('cursor-not-allowed', !hasStory);
}

export function updateEstimations() {
    const storyText = dom.storyInput.value.trim();
    const wordCount = storyText ? storyText.split(/\s+/).filter(Boolean).length : 0;
    const scoreDiv = document.getElementById('pacing-quality-score');

    if (wordCount === 0) {
        if(dom.narrationEstimationResult) dom.narrationEstimationResult.innerHTML = '';
        if(dom.shotEstimationResult) dom.shotEstimationResult.innerHTML = '';
        if (scoreDiv) scoreDiv.classList.add('hidden');
        return;
    }

    const narrationMinutes = wordCount / 150;
    if(dom.narrationEstimationResult) dom.narrationEstimationResult.innerHTML = `Est. Narration: <strong class="text-white">${narrationMinutes.toFixed(1)} min</strong>`;

    const detailLevel = dom.detailLevelSelect.value;
    const pacingFactor = dom.pacingFactorSelect.value as keyof typeof pacingMap;
    let minShots = 0, maxShots = 0, shotEstimationText = '';

    const selectedRange = pacingMap[pacingFactor] || pacingMap.normal;

    if (detailLevel === 'cinematic') {
        const fastRange = pacingMap.fast;
        minShots = Math.max(1, Math.round((narrationMinutes * 0.3 * fastRange.min) + (narrationMinutes * 0.7 * selectedRange.min)));
        maxShots = Math.max(minShots, Math.round((narrationMinutes * 0.3 * fastRange.max) + (narrationMinutes * 0.7 * selectedRange.max)));
        shotEstimationText = `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
    } else if (detailLevel === 'custom') {
        const customCount = parseInt(dom.customShotCountInput.value, 10) || 0;
        minShots = maxShots = customCount;
        shotEstimationText = `Budget: <strong class="text-white">${customCount} Shots</strong>`;
    } else if (detailLevel === 'low') {
        minShots = Math.max(1, Math.round(narrationMinutes * Math.max(1, selectedRange.min * 0.6)));
        maxShots = Math.max(minShots, Math.round(narrationMinutes * Math.max(2, selectedRange.min * 0.9)));
        shotEstimationText = `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
    } else if (detailLevel === 'high') {
        minShots = Math.max(1, Math.round(narrationMinutes * Math.max(selectedRange.max * 0.9, selectedRange.min * 1.2)));
        maxShots = Math.max(minShots, Math.round(narrationMinutes * Math.max(selectedRange.max * 1.3, selectedRange.min * 1.5)));
        shotEstimationText = `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
    } else if (detailLevel === 'medium') {
        minShots = Math.max(1, Math.round(narrationMinutes * selectedRange.min));
        maxShots = Math.max(minShots, Math.round(narrationMinutes * selectedRange.max));
        shotEstimationText = `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
    } else {
        // detailLevel === 'auto' or default
        minShots = Math.max(1, Math.round(narrationMinutes * selectedRange.min));
        maxShots = Math.max(minShots, Math.round(narrationMinutes * selectedRange.max));
        shotEstimationText = `Est. Shots: <strong class="text-white">${minShots}-${maxShots}</strong>`;
    }

    if(dom.shotEstimationResult) dom.shotEstimationResult.innerHTML = shotEstimationText;
    if (narrationMinutes > 15 && dom.narrationEstimationResult) {
        dom.narrationEstimationResult.innerHTML += ` <span class="text-amber-400 text-[10px] font-bold">⚠️ SAFE-BATCH MODE</span>`;
    }

    if (narrationMinutes > 0 && maxShots > 0 && scoreDiv) {
        const avgShots = (minShots + maxShots) / 2;
        const iSpm = avgShots / narrationMinutes; 
        scoreDiv.classList.remove('hidden', 'border-red-500/50', 'bg-red-900/20', 'border-amber-500/50', 'bg-amber-900/20', 'border-green-500/50', 'bg-green-900/20', 'border-blue-500/50', 'bg-blue-900/20');
        
        if (detailLevel === 'custom') {
            if (iSpm < 3) {
                scoreDiv.classList.add('border-red-500/50', 'bg-red-900/20');
                scoreDiv.innerHTML = `<strong class="text-red-400">Pacing: Very Low Density (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Consider increasing shot count or using 'Auto (Paced)'.</span>`;
            } else if (iSpm <= 8) {
                scoreDiv.classList.add('border-amber-500/50', 'bg-amber-900/20');
                scoreDiv.innerHTML = `<strong class="text-amber-400">Pacing: Deliberate (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Good for slow, contemplative content (8–15s cuts).</span>`;
            } else if (iSpm <= 12) {
                scoreDiv.classList.add('border-green-500/50', 'bg-green-900/20');
                scoreDiv.innerHTML = `<strong class="text-green-400">Pacing: Dynamic (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Ideal for engaging content (5–8s cuts).</span>`;
            } else {
                scoreDiv.classList.add('border-green-500/50', 'bg-green-900/20');
                scoreDiv.innerHTML = `<strong class="text-green-400">Pacing: High Energy (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Rapid visual transitions (3–5s cuts).</span>`;
            }
        } else {
            // Auto / Cinematic pacing presets
            if (pacingFactor === 'documentary') {
                scoreDiv.classList.add('border-blue-500/50', 'bg-blue-900/20');
                scoreDiv.innerHTML = `<strong class="text-blue-400">Pacing: Documentary (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Long, contemplative takes with minimal cuts (30–60s per cut).</span>`;
            } else if (pacingFactor === 'glacial') {
                scoreDiv.classList.add('border-blue-500/50', 'bg-blue-900/20');
                scoreDiv.innerHTML = `<strong class="text-blue-400">Pacing: Glacial (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Slow, deliberate camera holds (20–30s per cut).</span>`;
            } else if (['snail', 'very_slow'].includes(pacingFactor)) {
                scoreDiv.classList.add('border-amber-500/50', 'bg-amber-900/20');
                scoreDiv.innerHTML = `<strong class="text-amber-400">Pacing: Deliberate (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Steady rhythm for contemplative storytelling (12–20s per cut).</span>`;
            } else if (pacingFactor === 'slow') {
                scoreDiv.classList.add('border-amber-500/50', 'bg-amber-900/20');
                scoreDiv.innerHTML = `<strong class="text-amber-400">Pacing: Slow (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Cinematic narrative rhythm (8–12s per cut).</span>`;
            } else if (pacingFactor === 'fast') {
                scoreDiv.classList.add('border-green-500/50', 'bg-green-900/20');
                scoreDiv.innerHTML = `<strong class="text-green-400">Pacing: Fast (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">High shot density for rapid visual pacing (3–5s per cut).</span>`;
            } else {
                scoreDiv.classList.add('border-green-500/50', 'bg-green-900/20');
                scoreDiv.innerHTML = `<strong class="text-green-400">Pacing: Balanced (${iSpm.toFixed(1)} SPM).</strong> <span class="text-gray-400">Standard dynamic rhythm for engaging content (5–8s per cut).</span>`;
            }
        }
    } else if (scoreDiv) {
        scoreDiv.classList.add('hidden');
    }
}

const debouncedUpdateEstimations = debounce(updateEstimations, 300);

export function handlePacingChange(selectedValue: string) {
  if (dom.pacingControlsContainer) dom.pacingControlsContainer.style.display = ['auto', 'cinematic'].includes(selectedValue) ? 'block' : 'none';
  if (dom.customShotControlsContainer) dom.customShotControlsContainer.style.display = selectedValue === 'custom' ? 'block' : 'none';
  updateEstimations();
}

export async function triggerApiKeySelectionFlow() {
  if (dom.apiKeyModal) dom.apiKeyModal.classList.add('hidden');
}

export function handleImageStyleChange() {
  const selectedStyle = dom.imageStyleSelect.value;
  if (dom.customStylePanel) dom.customStylePanel.style.display = selectedStyle === 'custom' ? 'block' : 'none';
  if (dom.customPromptPanel) dom.customPromptPanel.style.display = selectedStyle === 'custom_prompt' ? 'block' : 'none';
  updateStyleDescription();
}

export function handleCharacterModifierChange() {
  const val = dom.characterModifierSelect.value;
  if (dom.characterModifierCustom) {
    dom.characterModifierCustom.classList.toggle('hidden', val !== 'custom');
  }
}

export function getCurrentCharacterModifier(): string {
  const val = dom.characterModifierSelect?.value;
  if (!val) return '';
  if (val === 'custom') return dom.characterModifierCustom?.value.trim() || '';
  return val;
}

export function getCurrentStylePrompt(): string {
    const selectedStyleValue = dom.imageStyleSelect.value;
    if (selectedStyleValue === 'custom_prompt') return dom.customPromptInput.value.trim();
    if (selectedStyleValue === 'custom') {
        const analyzed = dom.customStyleAnalyzedPrompt.value.trim();
        const keywords = dom.customStyleKeywordsInput.value.trim();
        return [analyzed, keywords].filter(Boolean).join(', ');
    }
    return selectedStyleValue;
}

export function updateStyleDescription() {
  const selectedStyle = dom.imageStyleSelect.value;
  if (dom.styleDescription) {
    if (selectedStyle === 'custom') dom.styleDescription.textContent = 'Upload an image to copy its artistic style.';
    else if (selectedStyle === 'custom_prompt') dom.styleDescription.textContent = 'Using the temporary custom style prompt below.';
    else dom.styleDescription.textContent = constants.styleDescriptionsMap[selectedStyle] || 'No description available.';
  }
  updateSuggestStyleButtonState();
}

export function updateWorkflowStepStatus(step: number, status: 'default' | 'active' | 'completed') {
  const stepElement = document.querySelector(`.stepper-item[data-step="${step}"]`);
  if (!stepElement) return;
  stepElement.classList.remove('active', 'completed');
  if (status !== 'default') stepElement.classList.add(status);
}

export function resetWorkflowSteps() {
  for (let i = 1; i <= 4; i++) updateWorkflowStepStatus(i, 'default');
  if (dom.videoDirectorBtn) {
    dom.videoDirectorBtn.disabled = false;
    dom.videoDirectorBtn.classList.remove('opacity-50');
  }
}

export function updateUiForStoryChange() {
  const storyText = dom.storyInput.value.trim();
  const hasStory = storyText.length > 0;
  const wordCount = storyText.split(/\s+/).filter(Boolean).length;
  if (dom.wordCounter) {
      if (wordCount > 0 && dom.pacingFactorSelect) {
          const { max } = getShotRange(wordCount, dom.pacingFactorSelect.value);
          dom.wordCounter.textContent = `Words: ${wordCount} (≈${max} shots)`;
      } else {
          dom.wordCounter.textContent = `Words: ${wordCount}`;
      }
  }
  
  if (dom.extractVoBtn) {
    const hasScriptMarkers = /VISUAL:|VO:|TEXT OVERLAY:|HOOK \(/i.test(storyText);
    dom.extractVoBtn.classList.toggle('hidden', !hasScriptMarkers);
    
    if (dom.storyStructureDetails && dom.storyStructureList) {
        if (hasScriptMarkers) {
            dom.storyStructureDetails.classList.remove('hidden');
            const lines = dom.storyInput.value.split('\n');
            let html = '';
            let currentPos = 0;
            lines.forEach((line, i) => {
                const match = line.match(/(VISUAL:|VO:|TEXT OVERLAY:|HOOK \()/i);
                if (match) {
                    html += `<div class="cursor-pointer hover:text-white transition" onclick="document.getElementById('story-input').focus(); document.getElementById('story-input').setSelectionRange(${currentPos}, ${currentPos});">
                        <span class="text-fuchsia-400">${match[0]}</span> <span class="text-gray-500">at line ${i + 1}</span>
                    </div>`;
                }
                currentPos += line.length + 1; // +1 for newline
            });
            dom.storyStructureList.innerHTML = html;
        } else {
            dom.storyStructureDetails.classList.add('hidden');
        }
    }
  }
  
  [dom.sparkBtn, dom.enhanceBtn, dom.suggestStyleBtn, dom.identifyCharactersBtn, dom.identifyLocationsBtn, dom.identifyElementsBtn, dom.analyzeBtn].forEach((btn) => {
    if (btn) {
      btn.disabled = !hasStory;
      btn.classList.toggle('opacity-50', !hasStory);
      btn.classList.toggle('cursor-not-allowed', !hasStory);
    }
  });

  const hasScenes = state.currentScenes && state.currentScenes.length > 0;
  if (dom.tabCharactersBtn) dom.tabCharactersBtn.disabled = !hasScenes;
  if (dom.tabLocationsBtn) dom.tabLocationsBtn.disabled = !hasScenes;
  if (dom.tabElementsBtn) dom.tabElementsBtn.disabled = !hasScenes;
  if (dom.tabScriptBtn) dom.tabScriptBtn.disabled = !hasScenes;
  if (dom.tabVideoClipsBtn) dom.tabVideoClipsBtn.disabled = !hasScenes;
  const hasGraphicsReady = hasScenes || Boolean(state.uploadedVideoElement || (timelineState as any).masterAudioBuffer || (timelineState.clips && timelineState.clips.length > 0) || (timelineState.graphics && timelineState.graphics.length > 0));
  if (dom.tabGraphicsBtn) dom.tabGraphicsBtn.disabled = !hasGraphicsReady;

  debouncedUpdateEstimations();
  resetWorkflowSteps();
  const hasAroll = Boolean(state.uploadedVideoElement || state.uploadedVideoFileName || state.uploadedAudioBuffer || (timelineState as any).masterAudioBuffer);
  const hasAnyContent = hasStory || hasAroll || hasScenes;
  if (hasAnyContent) {
    updateWorkflowStepStatus(1, (hasStory || hasAroll) ? 'completed' : 'active');
    if (state.characterProfiles.length > 0 || state.locationProfiles.length > 0 || hasScenes) {
      updateWorkflowStepStatus(2, 'completed');
      updateWorkflowStepStatus(3, 'active');
    } else {
      updateWorkflowStepStatus(2, 'active');
    }
    
    if (hasScenes) {
        const allShotsStats = state.currentScenes.flatMap(s => (s.lines || [s]));
        const hasGeneratedImages = state.uploadedVideoElement 
            || (timelineState.clips && timelineState.clips.length > 0 && timelineState.videoGenerated)
            || allShotsStats.some(shot => !!shot.image_id || !!shot._imageObjectURL || !!shot.video_id || !!shot._videoObjectURL || shot.talkingHeadMode === 'full' || shot.talkingHeadMode === 'split');
        if (hasGeneratedImages) {
            if (dom.videoDirectorBtn) {
                dom.videoDirectorBtn.disabled = false;
                dom.videoDirectorBtn.classList.remove('opacity-50');
            }
            updateWorkflowStepStatus(3, 'completed');
            updateWorkflowStepStatus(4, 'active');
        }
    }
  }
}

export function handleImageModelChange() {
  const selectedModel = dom.imageModelSelect.value || constants.DEFAULT_IMAGE_MODEL;
  
  const supportsReferenceImage = selectedModel.startsWith('gemini-');
  if (dom.referenceImageContainer) dom.referenceImageContainer.style.display = supportsReferenceImage ? 'block' : 'none';
  if (!supportsReferenceImage) {
    state.selectedReferenceImage = null;
    updateReferenceImagePreview();
    updateAspectRatioState();
  }
  triggerApiKeySelectionFlow();
}

export function removeCustomImage() {
  if (state.customStyleImagePreviewUrl) URL.revokeObjectURL(state.customStyleImagePreviewUrl);
  state.customStyleImageFile = null;
  state.customStyleImagePreviewUrl = null;
  if (dom.customStyleImageInput) dom.customStyleImageInput.value = '';
  if (dom.customStyleAnalyzedPrompt) dom.customStyleAnalyzedPrompt.value = '';
  if (dom.customStyleImagePreview) dom.customStyleImagePreview.innerHTML = `<button id="custom-style-upload-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 text-xs rounded-md transition">Upload</button>`;
  if (dom.analyzeStyleBtn) dom.analyzeStyleBtn.classList.add('hidden');
}

export function showStyleInfo() {
  const selectedStyle = dom.imageStyleSelect.value;
  const styleName = dom.imageStyleSelect.options[dom.imageStyleSelect.selectedIndex]?.text || 'Selected Style';
  const description = constants.styleDescriptionsMap[selectedStyle] || 'No detailed description available.';
  if (dom.styleInfoTitle) dom.styleInfoTitle.textContent = styleName;
  if (dom.styleInfoContent) dom.styleInfoContent.innerHTML = `<p>${escapeHtml(description)}</p><p class="text-xs text-gray-500 mt-4">Prompt: <code>${escapeHtml(selectedStyle)}</code></p>`;
  if (dom.styleInfoModal) dom.styleInfoModal.classList.remove('hidden');
}

export async function openHistoryModal() {
  if (!dom.historyModal || !dom.historyListContainer) return;
  dom.historyListContainer.innerHTML = '<div class="flex justify-center items-center h-full"><div class="loader"></div></div>';
  dom.historyModal.classList.remove('hidden');
  try {
    const history = await DB.getAllByIndex(constants.HISTORY_STORE, 'timestamp', undefined, 50, 'prev');
    if (history.length === 0) {
      dom.historyListContainer.innerHTML = '<p class="text-center text-gray-400">No history saved yet.</p>';
      return;
    }
    dom.historyListContainer.innerHTML = history.map(item => `
            <div class="history-item flex justify-between items-center p-3 bg-gray-900/50 hover:bg-gray-700/50 rounded-lg transition border border-gray-700 mb-2">
                <div>
                    <p class="font-semibold text-gray-300">${escapeHtml(item.projectData?.story?.substring(0, 60) || 'Untitled')}...</p>
                    <p class="text-sm text-gray-400">${new Date(item.timestamp).toLocaleString()}</p>
                </div>
                <div class="flex items-center space-x-2">
                    <button class="load-history-btn p-2 bg-blue-600 hover:bg-blue-700 rounded-md transition" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L6.707 6.707a1 1 0 11-1.414 0z" clip-rule="evenodd" /></svg></button>
                    <button class="delete-history-btn p-2 bg-red-600 hover:bg-red-700 rounded-md transition" data-id="${item.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg></button>
                </div>
            </div>
        `).join('');
  } catch (e) {
    dom.historyListContainer.innerHTML = '<p class="text-center text-red-400">Could not load history.</p>';
  }
}

export async function renderReferenceLibrary() {
  if (!dom.referenceLibraryGrid) return;
  dom.referenceLibraryGrid.innerHTML = '<div class="col-span-full flex justify-center items-center h-full"><div class="loader"></div></div>';
  try {
    const images = await DB.getAllByIndex(constants.REFERENCE_IMAGE_STORE, 'timestamp', undefined, undefined, 'prev');
    if (images.length === 0) {
      dom.referenceLibraryGrid.innerHTML = '<p class="text-center text-gray-400 col-span-full">Library empty.</p>';
      return;
    }
    dom.referenceLibraryGrid.innerHTML = images.map(image => `
                <div class="ref-image-card relative group bg-gray-900 rounded-lg overflow-hidden cursor-pointer ${state.selectedReferenceImage?.id === image.id ? 'selected' : ''}" data-id="${image.id}">
                    <img src="data:${image.mimeType};base64,${image.data}" class="w-full h-32 object-cover">
                    <div class="absolute inset-0 bg-black/0 group-hover:bg-black/60 flex flex-col justify-center items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="select-ref-btn text-white bg-blue-600 px-3 py-1 rounded text-sm mb-2">Select</button>
                        <button class="delete-ref-btn text-white bg-red-600 px-3 py-1 rounded text-sm">Delete</button>
                    </div>
                </div>
            `).join('');
  } catch (e) {
    console.error("Failed to load reference image library:", e);
    dom.referenceLibraryGrid.innerHTML = '<p class="text-center text-red-400 col-span-full">Could not load reference library.</p>';
  }
}

export function openReferenceLibrary() {
  renderReferenceLibrary();
  if (dom.referenceLibraryModal) dom.referenceLibraryModal.classList.remove('hidden');
}

export function startPresentation() {
  const slides = Array.from(document.querySelectorAll('.prompt-item')).filter(item => item.querySelector('.generated-img'));
  if (slides.length === 0) return;
  state.presentationSlides = slides.map(slide => {
    const img = slide.querySelector('.generated-img') as HTMLImageElement;
    const textEl = slide.querySelector('.italic') as HTMLElement | null;
    return { imgSrc: img.src, text: textEl?.textContent?.trim().replace(/"/g, '') || '' };
  });
  state.currentSlideIndex = 0;
  updatePresentationView();
  if (dom.presentationModal) dom.presentationModal.classList.remove('hidden');
}

export function updatePresentationView() {
  const slide = state.presentationSlides[state.currentSlideIndex];
  if (!slide) return;
  if (dom.presentationImage) dom.presentationImage.src = slide.imgSrc;
  if (dom.presentationText) dom.presentationText.textContent = slide.text;
  if (dom.presentationCounter) dom.presentationCounter.textContent = `${state.currentSlideIndex + 1} / ${state.presentationSlides.length}`;
}

export function closePresentation() { if (dom.presentationModal) dom.presentationModal.classList.add('hidden'); }
export function nextSlide() { if (state.currentSlideIndex < state.presentationSlides.length - 1) { state.currentSlideIndex++; updatePresentationView(); } }
export function prevSlide() { if (state.currentSlideIndex > 0) { state.currentSlideIndex--; updatePresentationView(); } }

export function updateExportSummaryCard() {
  if (!dom.exportSummaryResolutionBadge) return;

  const currentAr = (state.aspectRatio || dom.imageResolutionSelect?.value || '16:9') as any;
  let resVal = dom.videoExportResolutionSelect ? dom.videoExportResolutionSelect.value : '1080p';
  const formatVal = dom.videoExportFormatSelect ? dom.videoExportFormatSelect.value : 'mp4';
  const fpsVal = dom.videoExportFpsSelect ? dom.videoExportFpsSelect.value : '30';
  const qualityVal = dom.videoExportQualitySelect ? dom.videoExportQualitySelect.value : 'medium';

  const formatLabels: { [key: string]: string } = {
    'mp4': 'MP4 (H.264)',
    'webm': 'WebM (VP9)',
    'xml': 'FCP XML'
  };

  const qualityLabels: { [key: string]: { label: string; class: string } } = {
    'low': { label: 'Low Quality (Compact)', class: 'text-amber-400' },
    'medium': { label: 'Medium Quality (Standard)', class: 'text-emerald-400' },
    'high': { label: 'High Quality (ProRes)', class: 'text-purple-400' }
  };

  if (dom.exportSummaryResolutionBadge) {
    const resInfo = EXPORT_RESOLUTION_MAP[resVal];
    const userIsGuest = isGuest();
    const guestPolicy = state.systemConfig?.guestExportPolicy || 'watermark_320p';
    const isGuestGated = userIsGuest && guestPolicy !== 'unrestricted';

    let badgeText = resInfo ? resInfo.label : resVal;
    if (isGuestGated) {
      dom.exportSummaryResolutionBadge.innerHTML = `<span class="text-amber-300 font-bold">${badgeText}</span> <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">Watermarked Preview</span>`;
    } else {
      dom.exportSummaryResolutionBadge.textContent = badgeText;
    }
  }

  if (dom.exportSummaryFormatBadge) {
    dom.exportSummaryFormatBadge.textContent = formatLabels[formatVal] || formatVal.toUpperCase();
  }

  if (dom.exportSummaryFpsBadge) {
    dom.exportSummaryFpsBadge.textContent = `${fpsVal} FPS`;
  }

  if (dom.exportSummaryQualityBadge) {
    const qInfo = qualityLabels[qualityVal] || { label: qualityVal, class: 'text-emerald-400' };
    dom.exportSummaryQualityBadge.textContent = qInfo.label;
    dom.exportSummaryQualityBadge.className = `font-medium ${qInfo.class}`;
  }

  if (dom.exportSummaryDuration) {
    const duration = videoRenderContext?.totalDuration || 0;
    dom.exportSummaryDuration.textContent = formatTime(duration);
  }

  // Update Cloud Render Quota and Estimate
  const quota = state.renderMinutesQuota !== undefined ? state.renderMinutesQuota : 10;
  const used = state.renderMinutesUsed || 0;
  const remainingMinutes = Math.max(0, quota - used);

  if (dom.cloudRenderQuotaText) {
    dom.cloudRenderQuotaText.textContent = `${Math.round(remainingMinutes)} mins remaining`;
  }

  const durationSec = videoRenderContext?.totalDuration || 0;
  const baseMinutes = Math.max(1, Math.ceil(durationSec / 60));
  const provider = (state.cloudRenderProvider || (dom.cloudRenderProviderSelect?.value as any) || 'gcp') as 'gcp' | 'aws' | 'headless';
  const multiplier = provider === 'headless' ? 2 : 1;
  const durationMinutes = baseMinutes * multiplier;

  if (dom.cloudRenderDurationEst) {
    dom.cloudRenderDurationEst.textContent = formatTime(durationSec);
  }
  if (dom.cloudRenderDeductEst) {
    if (multiplier === 2) {
      dom.cloudRenderDeductEst.textContent = `~${durationMinutes} mins (2x Headless Rate)`;
    } else {
      dom.cloudRenderDeductEst.textContent = `~${durationMinutes} min`;
    }
  }
}

let cachedCloudConfig: any = null;
let isDetectingCloudConfig = false;

export async function detectCloudRenderProviders() {
  if (isDetectingCloudConfig) return;
  isDetectingCloudConfig = true;
  try {
    const res = await fetch('/api/cloud-render/config');
    if (res.ok) {
      cachedCloudConfig = await res.json();
      updateCloudProviderSelectOptions();
    }
  } catch {
    // Keep defaults
  } finally {
    isDetectingCloudConfig = false;
  }
}

function updateCloudProviderSelectOptions() {
  if (!dom.cloudRenderProviderSelect || !cachedCloudConfig) return;

  const isAwsReady = Boolean(cachedCloudConfig.awsLambda?.configured);
  const isGcpReady = Boolean(cachedCloudConfig.gcpCloudRun?.configured);
  const isHeadlessReady = Boolean(cachedCloudConfig.headless?.available);

  const options = dom.cloudRenderProviderSelect.options;
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (opt.value === 'aws') {
      opt.textContent = isAwsReady
        ? 'AWS Lambda (Amazon Web Services) — Ready (1x Rate)'
        : 'AWS Lambda (Amazon Web Services) — Not Configured (Missing Variables)';
    } else if (opt.value === 'gcp') {
      opt.textContent = isGcpReady
        ? 'Google Cloud Run (GCP) — Ready (1x Rate)'
        : 'Google Cloud Run (GCP) — Not Configured (Missing Variables)';
    } else if (opt.value === 'headless') {
      opt.textContent = isHeadlessReady
        ? 'Headless Server (Chromium + FFmpeg) — Ready (2x Rate)'
        : 'Headless Server (Chromium + FFmpeg) — Chromium Not Installed';
    }
  }

  // Auto-switch away from unconfigured engine to a ready engine if user hasn't explicitly chosen a ready one
  const current = dom.cloudRenderProviderSelect.value;
  const currentIsReady = (current === 'aws' && isAwsReady) || (current === 'gcp' && isGcpReady) || (current === 'headless' && isHeadlessReady);

  if (!currentIsReady) {
    if (isAwsReady) {
      dom.cloudRenderProviderSelect.value = 'aws';
      state.cloudRenderProvider = 'aws';
    } else if (isGcpReady) {
      dom.cloudRenderProviderSelect.value = 'gcp';
      state.cloudRenderProvider = 'gcp';
    } else if (isHeadlessReady) {
      dom.cloudRenderProviderSelect.value = 'headless';
      state.cloudRenderProvider = 'headless';
    }
  }

  syncCloudRenderProviderUI();
}

export function syncCloudRenderProviderUI() {
  const provider = (state.cloudRenderProvider || (dom.cloudRenderProviderSelect?.value as any) || 'gcp') as 'gcp' | 'aws' | 'headless';
  if (dom.cloudRenderProviderSelect && dom.cloudRenderProviderSelect.value !== provider) {
    dom.cloudRenderProviderSelect.value = provider;
  }

  const isAwsReady = Boolean(cachedCloudConfig?.awsLambda?.configured);
  const isGcpReady = Boolean(cachedCloudConfig?.gcpCloudRun?.configured);
  const isHeadlessReady = Boolean(cachedCloudConfig?.headless?.available);

  if (dom.cloudRenderRateBadge) {
    if (provider === 'headless') {
      dom.cloudRenderRateBadge.className = 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-600/60 flex items-center gap-1';
      dom.cloudRenderRateBadge.innerHTML = `<span>⚡</span> 2x Quota (Double Hours)${cachedCloudConfig ? (isHeadlessReady ? ' • Ready' : ' • Unavailable') : ''}`;
    } else if (provider === 'aws') {
      dom.cloudRenderRateBadge.className = isAwsReady
        ? 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 flex items-center gap-1'
        : 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 flex items-center gap-1';
      dom.cloudRenderRateBadge.innerHTML = `<span>☁️</span> 1x Standard Rate${cachedCloudConfig ? (isAwsReady ? ' • Ready' : ' • Setup Needed') : ''}`;
    } else {
      dom.cloudRenderRateBadge.className = isGcpReady
        ? 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-700/50 flex items-center gap-1'
        : 'text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 flex items-center gap-1';
      dom.cloudRenderRateBadge.innerHTML = `<span>☁️</span> 1x Standard Rate${cachedCloudConfig ? (isGcpReady ? ' • Ready' : ' • Setup Needed') : ''}`;
    }
  }

  if (dom.cloudRenderProviderDesc) {
    if (provider === 'headless') {
      const note = isHeadlessReady
        ? '<span class="text-emerald-400 font-semibold">✓ Server Chromium Ready.</span>'
        : '<span class="text-amber-400 font-semibold">⚠️ Chromium is not installed on this server.</span>';
      dom.cloudRenderProviderDesc.innerHTML = `<span class="text-amber-300 font-semibold">⚡ Headless Chromium + FFmpeg:</span> Renders on a dedicated multi-page headless server worker with frame-accurate canvas capture. <strong class="text-amber-300">Consumes double the render hours/minutes (2x quota).</strong> ${note}`;
    } else if (provider === 'aws') {
      const note = isAwsReady
        ? '<span class="text-emerald-400 font-semibold">✓ AWS Lambda Connected.</span>'
        : '<span class="text-amber-400 font-semibold">⚠️ Missing AWS environment variables.</span>';
      dom.cloudRenderProviderDesc.innerHTML = `<span class="text-indigo-300 font-semibold">☁️ AWS Lambda:</span> Dispatches composition chunks to serverless AWS Lambda instances for distributed cloud rendering (1x standard quota rate). ${note}`;
    } else {
      const note = isGcpReady
        ? '<span class="text-emerald-400 font-semibold">✓ Google Cloud Run Connected.</span>'
        : '<span class="text-amber-400 font-semibold">⚠️ Missing Google Cloud Run environment variables.</span>';
      dom.cloudRenderProviderDesc.innerHTML = `<span class="text-indigo-300 font-semibold">☁️ Google Cloud Run:</span> Dispatches timeline rendering to Google Cloud Run serverless container clusters (1x standard quota rate). ${note}`;
    }
  }

  updateExportSummaryCard();
}

export function openExportSettingsModal() {
  if (!dom.exportSettingsModal) return;

  if (state.isVideoPlaying) {
    import('./videoController').then(vc => vc.forcePausePlayback(undefined, true)).catch(() => {});
  }

  const currentRatio = (state.aspectRatio || dom.videoDirectorAspectSelect?.value || dom.imageResolutionSelect?.value || '16:9') as any;
  const userIsGuest = isGuest();
  const guestPolicy = state.systemConfig?.guestExportPolicy || 'watermark_320p';

  if (userIsGuest && guestPolicy !== 'unrestricted') {
    if (guestPolicy === 'block_all') {
      if (dom.exportGuestWarning) {
        dom.exportGuestWarning.classList.remove('hidden');
        if (dom.exportGuestWarningTitle) dom.exportGuestWarningTitle.textContent = 'Guest Account — Export Locked';
        if (dom.exportGuestWarningBadge) {
          dom.exportGuestWarningBadge.textContent = 'Account Required';
          dom.exportGuestWarningBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30';
        }
        if (dom.exportGuestWarningDesc) {
          dom.exportGuestWarningDesc.innerHTML = 'Video exports are currently restricted to registered users. Please sign in or create a free account to export your video.';
        }
      }
      if (dom.startExportProcessBtn) {
        dom.startExportProcessBtn.disabled = true;
        dom.startExportProcessBtn.classList.add('opacity-50', 'cursor-not-allowed');
        const span = dom.startExportProcessBtn.querySelector('span');
        if (span) span.textContent = 'Sign In to Export';
      }
    } else {
      // 'watermark_320p'
      if (dom.exportGuestWarning) {
        dom.exportGuestWarning.classList.remove('hidden');
        if (dom.exportGuestWarningTitle) dom.exportGuestWarningTitle.textContent = 'Guest Account Preview';
        if (dom.exportGuestWarningBadge) {
          dom.exportGuestWarningBadge.textContent = '320p + Watermark';
          dom.exportGuestWarningBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30';
        }
        if (dom.exportGuestWarningDesc) {
          dom.exportGuestWarningDesc.innerHTML = 'Exports for guest sessions are restricted to <strong class="text-white font-semibold">320p Preview Quality with Watermark</strong>. To unlock 1080p, 4K, 60 FPS and watermark-free exports, sign in or create an account.';
        }
      }
      if (dom.startExportProcessBtn) {
        dom.startExportProcessBtn.disabled = false;
        dom.startExportProcessBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        const span = dom.startExportProcessBtn.querySelector('span');
        if (span) span.textContent = 'Render 320p Preview (Watermarked)';
      }
      // Set to 320p key for guest
      if (dom.videoExportResolutionSelect) {
        dom.videoExportResolutionSelect.value = getGuest320pResolutionKey(currentRatio);
      }
    }
  } else {
    // Registered / Unrestricted
    if (dom.exportGuestWarning) dom.exportGuestWarning.classList.add('hidden');
    if (dom.startExportProcessBtn) {
      dom.startExportProcessBtn.disabled = false;
      dom.startExportProcessBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      const span = dom.startExportProcessBtn.querySelector('span');
      if (span) span.textContent = 'Render & Export';
    }
    // Auto-sync export resolution with project's active aspect ratio
    if (dom.videoExportResolutionSelect) {
      const matchingKey = getMatchingResolutionKey(currentRatio, dom.videoExportResolutionSelect.value);
      dom.videoExportResolutionSelect.value = matchingKey;
    }
  }

  updateExportSummaryCard();

  if (dom.exportSavePathDisplay) {
    const savedPath = state.exportDirectoryPath || localStorage.getItem('contentgen_workspace_root');
    if (savedPath) {
      dom.exportSavePathDisplay.textContent = savedPath;
    }
  }

  if (dom.videoExportNormalizeAudioCheckbox) {
    dom.videoExportNormalizeAudioCheckbox.checked = state.autoNormalizeAudio !== false;
  }
  if (dom.videoExportAudioDuckingCheckbox) {
    dom.videoExportAudioDuckingCheckbox.checked = state.audioDuckingEnabled !== false;
  }

  if (dom.videoExportFilenameInput) {
    const curVal = dom.videoExportFilenameInput.value.trim();
    const normalized = curVal.toLowerCase().replace(/[\s_-]+/g, '');
    const isGenericDefault = !curVal || normalized === 'aistudiovideoexport' || normalized === 'mygeneratedvideo';
    if (isGenericDefault) {
      const derived = getScriptDerivedTitle(5);
      dom.videoExportFilenameInput.value = derived || '';
    }
  }

  // Ensure render engine selection matches state
  if (state.cloudRenderMode === 'cloud') {
    if (dom.exportEngineCloudRadio) dom.exportEngineCloudRadio.checked = true;
    if (dom.exportEngineLocalRadio) dom.exportEngineLocalRadio.checked = false;
    dom.exportEngineCardCloud?.classList.remove('border-zinc-800', 'bg-zinc-900/50');
    dom.exportEngineCardCloud?.classList.add('border-indigo-500', 'bg-indigo-950/20');
    dom.exportEngineCardLocal?.classList.remove('border-indigo-500', 'bg-indigo-950/20');
    dom.exportEngineCardLocal?.classList.add('border-zinc-800', 'bg-zinc-900/50');
    dom.cloudRenderInfoBox?.classList.remove('hidden');
  } else {
    if (dom.exportEngineLocalRadio) dom.exportEngineLocalRadio.checked = true;
    if (dom.exportEngineCloudRadio) dom.exportEngineCloudRadio.checked = false;
    dom.exportEngineCardLocal?.classList.remove('border-zinc-800', 'bg-zinc-900/50');
    dom.exportEngineCardLocal?.classList.add('border-indigo-500', 'bg-indigo-950/20');
    dom.exportEngineCardCloud?.classList.remove('border-indigo-500', 'bg-indigo-950/20');
    dom.exportEngineCardCloud?.classList.add('border-zinc-800', 'bg-zinc-900/50');
    dom.cloudRenderInfoBox?.classList.add('hidden');
  }

  updateCloudRenderQuotaDisplay();
  syncCloudRenderProviderUI();
  detectCloudRenderProviders().catch(() => {});

  dom.exportSettingsModal.classList.remove('hidden');
}

export function closeExportSettingsModal() {
  if (dom.exportSettingsModal) {
    dom.exportSettingsModal.classList.add('hidden');
  }
}

export type TabName = 'storyboard' | 'characters' | 'elements' | 'locations' | 'script' | 'styles' | 'images' | 'video' | 'video-clips' | 'graphics';

export function switchTab(tabName: TabName) {
  [dom.panelStoryboard, dom.panelCharacters, dom.panelElements, dom.panelLocations, dom.panelScript, dom.panelVideoClips, dom.panelGraphics].forEach(p => p?.classList.remove('active'));
  [dom.tabStoryboardBtn, dom.tabCharactersBtn, dom.tabElementsBtn, dom.tabLocationsBtn, dom.tabScriptBtn, dom.tabVideoClipsBtn, dom.tabGraphicsBtn].forEach(b => b?.classList.remove('active'));
  
  const m: Partial<Record<TabName, { p?: HTMLElement, b?: HTMLElement }>> = { 
    storyboard: { p: dom.panelStoryboard, b: dom.tabStoryboardBtn }, 
    characters: { p: dom.panelCharacters, b: dom.tabCharactersBtn }, 
    elements: { p: dom.panelElements, b: dom.tabElementsBtn }, 
    locations: { p: dom.panelLocations, b: dom.tabLocationsBtn },
    script: { p: dom.panelScript, b: dom.tabScriptBtn },
    'video-clips': { p: dom.panelVideoClips, b: dom.tabVideoClipsBtn },
    graphics: { p: dom.panelGraphics, b: dom.tabGraphicsBtn }
  };

  const config = m[tabName];
  if (config) {
    if (config.p) config.p.classList.add('active');
    if (config.b) config.b.classList.add('active');
  }

  if (tabName === 'storyboard') {
    import('./ui-renderers').then(({ hydrateVisibleShots }) => {
      hydrateVisibleShots();
    });
  }
}

export function updateGeminiCookieHealthUi(
  status: 'valid' | 'invalid' | 'checking' | 'none',
  message?: string,
  timestamp?: number
) {
  if (!dom.geminiCookieHealthCard) return;

  const dot = dom.geminiCookieHealthDot;
  const label = dom.geminiCookieHealthLabel;
  const statusEl = dom.geminiCookieStatus;
  const lastCheckedEl = dom.geminiCookieLastChecked;
  const testBtn = dom.testGeminiCookieBtn;

  if (status === 'none') {
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-gray-500';
    if (label) {
      label.textContent = 'No cookies configured';
      label.className = 'text-xs font-semibold text-gray-400';
    }
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.add('hidden');
    }
    if (lastCheckedEl) lastCheckedEl.classList.add('hidden');
    if (testBtn) testBtn.classList.add('hidden');
  } else if (status === 'checking') {
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-400 animate-ping';
    if (label) {
      label.textContent = 'Testing Google session...';
      label.className = 'text-xs font-semibold text-yellow-300';
    }
    if (statusEl) {
      statusEl.textContent = message || 'Connecting to gemini.google.com to verify cookies...';
      statusEl.className = 'text-xs text-yellow-400 block leading-relaxed';
      statusEl.classList.remove('hidden');
    }
    if (testBtn) {
      testBtn.classList.remove('hidden');
      testBtn.disabled = true;
    }
  } else if (status === 'valid') {
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
    if (label) {
      label.textContent = '✓ Session Active & Verified';
      label.className = 'text-xs font-semibold text-green-400';
    }
    if (statusEl) {
      statusEl.textContent = message || 'Connected to Gemini Web (gemini.google.com)';
      statusEl.className = 'text-xs text-green-300/90 block leading-relaxed';
      statusEl.classList.remove('hidden');
    }
    if (lastCheckedEl) {
      const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'just now';
      lastCheckedEl.textContent = `Last verified: ${timeStr}`;
      lastCheckedEl.className = 'text-[10px] text-gray-400 block';
      lastCheckedEl.classList.remove('hidden');
    }
    if (testBtn) {
      testBtn.classList.remove('hidden');
      testBtn.disabled = false;
    }
  } else if (status === 'invalid') {
    if (dot) dot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]';
    if (label) {
      label.textContent = '⚠️ Session Expired / Invalid';
      label.className = 'text-xs font-semibold text-rose-400';
    }
    if (statusEl) {
      statusEl.textContent = message || 'Google rejected these cookies. Please re-copy fresh cookies from gemini.google.com.';
      statusEl.className = 'text-xs text-rose-300 block leading-relaxed';
      statusEl.classList.remove('hidden');
    }
    if (lastCheckedEl) {
      const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'recently';
      lastCheckedEl.textContent = `Check failed at: ${timeStr}`;
      lastCheckedEl.className = 'text-[10px] text-rose-400/80 block';
      lastCheckedEl.classList.remove('hidden');
    }
    if (testBtn) {
      testBtn.classList.remove('hidden');
      testBtn.disabled = false;
    }
  }
}

export function updateGeminiApiKeyUiState() {
  const cookieAllowed = isCookieAuthAllowedForCurrentUser();
  const cookieOption = dom.geminiAuthModeSelect?.querySelector('option[value="webCookie"]') as HTMLOptionElement | null;
  if (cookieOption) {
    cookieOption.hidden = !cookieAllowed;
    cookieOption.disabled = !cookieAllowed;
    cookieOption.style.display = cookieAllowed ? '' : 'none';
  }

  let mode = state.geminiAuthMode || 'builtin';
  if (mode === 'webCookie' && !cookieAllowed) {
    mode = 'builtin';
    state.geminiAuthMode = 'builtin';
    localStorage.setItem('geminiAuthMode', 'builtin');
  }

  if (dom.geminiAuthModeSelect) dom.geminiAuthModeSelect.value = mode;
  
  if (dom.geminiApiKeySection) dom.geminiApiKeySection.classList.toggle('hidden', mode !== 'apiKey');
  if (dom.geminiCookieSection) dom.geminiCookieSection.classList.toggle('hidden', mode !== 'webCookie' || !cookieAllowed);
  if (dom.openaiGatewaySection) dom.openaiGatewaySection.classList.toggle('hidden', mode !== 'openaiGateway');

  const hasSavedGateway = !!state.openaiGatewayBaseUrl;
  if (dom.saveOpenaiGatewayBtn) {
    dom.saveOpenaiGatewayBtn.textContent = hasSavedGateway ? 'Update Gateway Config' : 'Save Gateway Config';
  }
  if (dom.clearOpenaiGatewayBtn) {
    dom.clearOpenaiGatewayBtn.classList.toggle('hidden', !hasSavedGateway);
  }

  const isVertex = state.geminiProvider === 'vertex';
  const hasSavedKey = isVertex ? (!!state.userGeminiApiKey || !!state.vertexProjectId || !!state.vertexLocation) : !!state.userGeminiApiKey;
  
  const apiKeyInputVal = dom.geminiApiKeyInput?.value.trim() || '';
  const vertexProjInputVal = dom.userVertexProjectInput?.value.trim() || '';
  const vertexLocInputVal = dom.userVertexLocationInput?.value.trim() || 'us-central1';
  
  if (dom.saveGeminiApiKeyBtn) {
    dom.saveGeminiApiKeyBtn.textContent = hasSavedKey ? 'Update Config' : 'Save Config';
    
    let isDirty = false;
    if (isVertex) {
        isDirty = apiKeyInputVal !== (state.userGeminiApiKey || '') || 
                  vertexProjInputVal !== (state.vertexProjectId || '') || 
                  vertexLocInputVal !== (state.vertexLocation || 'us-central1');
        // Always show save button if dirty, but only if they have provided at least something useful
        dom.saveGeminiApiKeyBtn.classList.toggle('hidden', !isDirty);
    } else {
        dom.saveGeminiApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
        dom.saveGeminiApiKeyBtn.classList.toggle('hidden', !apiKeyInputVal || apiKeyInputVal === state.userGeminiApiKey);
    }
  }
  if (dom.clearGeminiApiKeyBtn) {
    if (isVertex) dom.clearGeminiApiKeyBtn.textContent = 'Clear Config';
    else dom.clearGeminiApiKeyBtn.textContent = 'Clear Key';
    dom.clearGeminiApiKeyBtn.classList.toggle('hidden', !hasSavedKey);
  }
  
  const hasSavedCookie = !!state.geminiPsid;
  const psidInputVal = dom.geminiPsidInput?.value.trim() || '';
  if (dom.saveGeminiCookieBtn) {
    dom.saveGeminiCookieBtn.textContent = hasSavedCookie ? 'Update & Verify Cookies' : 'Save & Verify Cookies';
    // Show save button when inputs differ from saved state or when typing
    dom.saveGeminiCookieBtn.classList.toggle('hidden', !psidInputVal && !hasSavedCookie);
  }
  if (dom.clearGeminiCookieBtn) dom.clearGeminiCookieBtn.classList.toggle('hidden', !hasSavedCookie && !psidInputVal);
  
  // Update cookie health card
  if (!hasSavedCookie) {
    updateGeminiCookieHealthUi('none');
  } else {
    const isExpired = sessionStorage.getItem('geminiCookieExpired') === 'true';
    const verifiedAtStr = sessionStorage.getItem('geminiCookieVerifiedAt');
    const verifiedAt = verifiedAtStr ? parseInt(verifiedAtStr, 10) : undefined;
    if (isExpired) {
      updateGeminiCookieHealthUi('invalid', 'Session has expired or was revoked. Please paste fresh cookies.', verifiedAt);
    } else {
      updateGeminiCookieHealthUi('valid', undefined, verifiedAt);
    }
  }
}

export function updateAi33ApiKeyUiState() {
  const hasSavedKey = !!state.ai33ApiKey;
  const keyInputVal = dom.ai33ApiKeyInput?.value.trim() || '';
  if (dom.saveAi33ApiKeyBtn) {
    dom.saveAi33ApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.saveAi33ApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.ai33ApiKey);
  }
  if (dom.clearAi33ApiKeyBtn) dom.clearAi33ApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updateStabilityApiKeyUiState() {
  const hasSavedKey = !!state.stabilityApiKey;
  const keyInputVal = dom.stabilityApiKeyInput?.value.trim() || '';
  if (dom.saveStabilityApiKeyBtn) {
    dom.saveStabilityApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.saveStabilityApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.stabilityApiKey);
  }
  if (dom.clearStabilityApiKeyBtn) dom.clearStabilityApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updateDeepgramApiKeyUiState() {
  const hasSavedKey = !!state.deepgramApiKey;
  const keyInputVal = dom.deepgramApiKeyInput?.value.trim() || '';
  if (dom.saveDeepgramApiKeyBtn) {
    dom.saveDeepgramApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.saveDeepgramApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.deepgramApiKey);
  }
  if (dom.clearDeepgramApiKeyBtn) dom.clearDeepgramApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updateElevenlabsApiKeyUiState() {
  const hasSavedKey = !!state.elevenlabsApiKey;
  const keyInputVal = dom.elevenlabsApiKeyInput?.value.trim() || '';
  if (dom.saveElevenlabsApiKeyBtn) {
    dom.saveElevenlabsApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.saveElevenlabsApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.elevenlabsApiKey);
  }
  if (dom.clearElevenlabsApiKeyBtn) dom.clearElevenlabsApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updateFreesoundApiKeyUiState() {
  const hasSavedKey = !!state.freesoundApiKey;
  const keyInputVal = dom.freesoundApiKeyInput?.value.trim() || '';
  if (dom.saveFreesoundApiKeyBtn) {
    dom.saveFreesoundApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.saveFreesoundApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.freesoundApiKey);
  }
  if (dom.clearFreesoundApiKeyBtn) dom.clearFreesoundApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updatePexelsApiKeyUiState() {
  const hasSavedKey = !!state.pexelsApiKey;
  const keyInputVal = dom.pexelsApiKeyInput?.value.trim() || '';
  if (dom.savePexelsApiKeyBtn) {
    dom.savePexelsApiKeyBtn.textContent = hasSavedKey ? 'Update Key' : 'Save Key';
    dom.savePexelsApiKeyBtn.classList.toggle('hidden', !keyInputVal || keyInputVal === state.pexelsApiKey);
  }
  if (dom.clearPexelsApiKeyBtn) dom.clearPexelsApiKeyBtn.classList.toggle('hidden', !hasSavedKey && !keyInputVal);
}

export function updateReferenceImagePreview() {
  if (!dom.referencePreviewMain) return;
  if (state.selectedReferenceImage) {
    dom.referencePreviewMain.innerHTML = `<div class="flex items-center gap-2 p-1 bg-gray-900 rounded-md border border-gray-700"><img src="data:${state.selectedReferenceImage.mimeType};base64,${state.selectedReferenceImage.data}" class="w-8 h-8 object-cover rounded-md"><div class="flex-grow min-w-0"><p class="text-xs truncate">${escapeHtml(state.selectedReferenceImage.name)}</p><button id="remove-ref-image-main" class="text-xs text-red-400 hover:underline">Remove</button></div></div>`;
    document.getElementById('remove-ref-image-main')?.addEventListener('click', () => { state.selectedReferenceImage = null; updateReferenceImagePreview(); updateAspectRatioState(); });
  } else dom.referencePreviewMain.innerHTML = ``;
}

export * from './ui-renderers';
