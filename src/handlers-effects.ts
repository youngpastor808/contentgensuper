/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from './dom';
import { timelineState } from './state-timeline';
import { drawVideoFrame, getPreviewDimensions } from './videoRenderer';
import { state } from './state';
import { showStatus } from './ui';
import { saveVersion } from './handlers-project';

export function getActiveAspectRatio(): string {
  return (
    state.aspectRatio ||
    timelineState.clips?.[0]?.aspectRatio ||
    dom.videoDirectorAspectSelect?.value ||
    dom.imageResolutionSelect?.value ||
    '16:9'
  );
}

export function openVisualEffectsModal() {
  if (!dom.visualEffectsModal) return;
  syncEffectsToUI();
  dom.visualEffectsModal.classList.remove('hidden');
  renderVfxPreviewCanvas();
}

export function closeVisualEffectsModal() {
  if (dom.visualEffectsModal) {
    dom.visualEffectsModal.classList.add('hidden');
  }
}

export function renderVfxPreviewCanvas() {
  if (!dom.vfxPreviewCanvas) return;
  const ctx = dom.vfxPreviewCanvas.getContext('2d');
  if (!ctx) return;

  const ratio = getActiveAspectRatio();
  const { width: targetW, height: targetH } = getPreviewDimensions(ratio);

  dom.vfxPreviewCanvas.width = targetW;
  dom.vfxPreviewCanvas.height = targetH;

  // Adapt container aspect ratio and styles to match project resolution (e.g. 9:16 portrait)
  const container = dom.vfxPreviewContainer || document.getElementById('vfx-preview-container');
  if (container) {
    if (ratio === '9:16') {
      container.style.aspectRatio = '9 / 16';
      container.style.height = '380px';
      container.style.width = `${Math.round(380 * 9 / 16)}px`;
    } else if (ratio === '1:1') {
      container.style.aspectRatio = '1 / 1';
      container.style.height = '340px';
      container.style.width = '340px';
    } else if (ratio === '4:3') {
      container.style.aspectRatio = '4 / 3';
      container.style.height = '340px';
      container.style.width = `${Math.round(340 * 4 / 3)}px`;
    } else if (ratio === '3:4') {
      container.style.aspectRatio = '3 / 4';
      container.style.height = '380px';
      container.style.width = `${Math.round(380 * 3 / 4)}px`;
    } else {
      // 16:9 or default
      container.style.aspectRatio = '16 / 9';
      container.style.height = 'auto';
      container.style.width = '100%';
    }
  }

  // Update active frame tag to show current aspect ratio
  const activeShotTag = document.getElementById('vfx-active-shot-tag');
  if (activeShotTag) {
    const isPortrait = ratio === '9:16';
    activeShotTag.textContent = `${isPortrait ? '📱 ' : '🎬 '}${ratio} Active Frame`;
  }

  // Use current timeline time or frame
  drawVideoFrame(state.lastRenderedTime || 0, dom.vfxPreviewCanvas, ctx);
}

export function syncEffectsToUI() {
  const fx = timelineState.videoEffects;

  if (dom.vfxColorFilterSelect) dom.vfxColorFilterSelect.value = fx.colorFilter || 'none';
  if (dom.vfxBlendModeSelect) dom.vfxBlendModeSelect.value = fx.blendMode || 'normal';

  const masterPercent = Math.round((fx.hdrMaster ?? 0) * 100);
  const balancePercent = Math.round((fx.hdrBalance ?? 0) * 100);
  const clarityPercent = Math.round((fx.clarity ?? 0) * 100);
  const vibrancePercent = Math.round((fx.vibrance ?? 0) * 100);
  const sharpeningPercent = Math.round((fx.sharpening ?? 0) * 100);

  // Sync VFX Studio Panel
  if (dom.vfxHdrMasterSlider) {
    dom.vfxHdrMasterSlider.value = String(masterPercent);
    if (dom.vfxHdrMasterVal) dom.vfxHdrMasterVal.textContent = `${masterPercent}%`;
  }
  if (dom.vfxHdrBalanceSlider) {
    dom.vfxHdrBalanceSlider.value = String(balancePercent);
    if (dom.vfxHdrBalanceVal) dom.vfxHdrBalanceVal.textContent = `${balancePercent}%`;
  }
  if (dom.vfxClaritySlider) {
    dom.vfxClaritySlider.value = String(clarityPercent);
    if (dom.vfxClarityVal) dom.vfxClarityVal.textContent = `${clarityPercent}%`;
  }
  if (dom.vfxVibranceSlider) {
    dom.vfxVibranceSlider.value = String(vibrancePercent);
    if (dom.vfxVibranceVal) dom.vfxVibranceVal.textContent = `${vibrancePercent}%`;
  }
  if (dom.vfxSharpeningSlider) {
    dom.vfxSharpeningSlider.value = String(sharpeningPercent);
    if (dom.vfxSharpeningVal) dom.vfxSharpeningVal.textContent = `${sharpeningPercent}%`;
  }

  // Sync Cinematography Panel
  if (dom.cinemaHdrMasterSlider) {
    dom.cinemaHdrMasterSlider.value = String(masterPercent);
    if (dom.cinemaHdrMasterVal) dom.cinemaHdrMasterVal.textContent = `${masterPercent}%`;
  }
  if (dom.cinemaHdrBalanceSlider) {
    dom.cinemaHdrBalanceSlider.value = String(balancePercent);
    if (dom.cinemaHdrBalanceVal) dom.cinemaHdrBalanceVal.textContent = `${balancePercent}%`;
  }
  if (dom.cinemaHdrClaritySlider) {
    dom.cinemaHdrClaritySlider.value = String(clarityPercent);
    if (dom.cinemaHdrClarityVal) dom.cinemaHdrClarityVal.textContent = `${clarityPercent}%`;
  }
  if (dom.cinemaHdrVibranceSlider) {
    dom.cinemaHdrVibranceSlider.value = String(vibrancePercent);
    if (dom.cinemaHdrVibranceVal) dom.cinemaHdrVibranceVal.textContent = `${vibrancePercent}%`;
  }
  if (dom.cinemaHdrSharpeningSlider) {
    dom.cinemaHdrSharpeningSlider.value = String(sharpeningPercent);
    if (dom.cinemaHdrSharpeningVal) dom.cinemaHdrSharpeningVal.textContent = `${sharpeningPercent}%`;
  }

  if (dom.vfxGrainSlider) {
    const val = Math.round((fx.grain || 0) * 100);
    dom.vfxGrainSlider.value = String(val);
    if (dom.vfxGrainVal) dom.vfxGrainVal.textContent = `${val}%`;
  }

  if (dom.vfxVignetteSlider) {
    const val = Math.round((fx.vignette || 0) * 100);
    dom.vfxVignetteSlider.value = String(val);
    if (dom.vfxVignetteVal) dom.vfxVignetteVal.textContent = `${val}%`;
  }

  if (dom.vfxAberrationSlider) {
    const val = Math.round((fx.chromaticAberration || 0) * 100);
    dom.vfxAberrationSlider.value = String(val);
    if (dom.vfxAberrationVal) dom.vfxAberrationVal.textContent = `${val}%`;
  }

  if (dom.vfxDustScratchesSlider) {
    const val = Math.round((fx.dustAndScratches || 0) * 100);
    dom.vfxDustScratchesSlider.value = String(val);
    if (dom.vfxDustScratchesVal) dom.vfxDustScratchesVal.textContent = `${val}%`;
  }

  if (dom.vfxLightLeaksSlider) {
    const val = Math.round((fx.lightLeaks || 0) * 100);
    dom.vfxLightLeaksSlider.value = String(val);
    if (dom.vfxLightLeaksVal) dom.vfxLightLeaksVal.textContent = `${val}%`;
  }

  syncWeatherUI();
}

export function syncWeatherUI() {
  const fx = timelineState.videoEffects;
  let activeWeather: 'none' | 'sparkles' | 'rain' | 'snow' | 'dust' = 'none';

  if ((fx.sparkles || 0) > 0) activeWeather = 'sparkles';
  else if ((fx.rain || 0) > 0) activeWeather = 'rain';
  else if ((fx.snow || 0) > 0) activeWeather = 'snow';
  else if ((fx.dustParticles || 0) > 0) activeWeather = 'dust';

  if (dom.vfxWeatherSelect) {
    dom.vfxWeatherSelect.value = activeWeather;
  }

  if (activeWeather === 'none') {
    dom.vfxWeatherControls?.classList.add('hidden');
    if (dom.vfxWeatherStatusTag) {
      dom.vfxWeatherStatusTag.textContent = 'None';
      dom.vfxWeatherStatusTag.className = 'text-xs font-mono text-gray-400 bg-gray-800/80 px-2.5 py-0.5 rounded-full border border-gray-700/50';
    }
  } else {
    dom.vfxWeatherControls?.classList.remove('hidden');
    updateWeatherMetaAndSliders(activeWeather, fx);
  }
}

function updateWeatherMetaAndSliders(weatherType: 'sparkles' | 'rain' | 'snow' | 'dust', fx: any) {
  let title = '✨ Magic Sparkles Settings';
  let statusText = '✨ SPARKLES';
  let sizeLabel = '🔍 Sparkle Glint Size';
  let qtyLabel = '📊 Sparkle Quantity / Density';
  let sizeVal = 0.5;
  let qtyVal = 60;

  if (weatherType === 'sparkles') {
    title = '✨ Magic Sparkles Settings';
    statusText = '✨ SPARKLES';
    sizeLabel = '🔍 Sparkle Glint Size';
    qtyLabel = '📊 Sparkle Quantity / Density';
    sizeVal = fx.sparklesSize ?? state.sparklesSize ?? 0.5;
    qtyVal = Math.round((fx.sparkles || 0.6) * 100);
  } else if (weatherType === 'rain') {
    title = '🌧️ Downpour Rain Settings';
    statusText = '🌧️ RAIN';
    sizeLabel = '🔍 Rain Streak Length';
    qtyLabel = '📊 Rain Fall Density';
    sizeVal = fx.rainSize ?? state.rainSize ?? 0.5;
    qtyVal = Math.round((fx.rain || 0.6) * 100);
  } else if (weatherType === 'snow') {
    title = '❄️ Snowfall Frost Settings';
    statusText = '❄️ SNOW';
    sizeLabel = '🔍 Snow Flake Size';
    qtyLabel = '📊 Snow Flake Quantity';
    sizeVal = fx.snowSize ?? state.snowSize ?? 0.5;
    qtyVal = Math.round((fx.snow || 0.5) * 100);
  } else if (weatherType === 'dust') {
    title = '💨 Dust Motes & Bokeh Settings';
    statusText = '💨 DUST MOTES';
    sizeLabel = '🔍 Mote Size / Scale';
    qtyLabel = '📊 Dust Mote Density';
    sizeVal = fx.dustParticlesSize ?? state.dustMotesSize ?? 0.5;
    qtyVal = Math.round((fx.dustParticles || 0.6) * 100);
  }

  if (dom.vfxWeatherTitle) dom.vfxWeatherTitle.textContent = title;
  if (dom.vfxWeatherStatusTag) {
    dom.vfxWeatherStatusTag.textContent = statusText;
    dom.vfxWeatherStatusTag.className = 'text-xs font-mono text-purple-300 bg-purple-950/80 px-2.5 py-0.5 rounded-full border border-purple-800/50';
  }
  if (dom.vfxWeatherSizeLabel) dom.vfxWeatherSizeLabel.textContent = sizeLabel;
  if (dom.vfxWeatherQuantityLabel) dom.vfxWeatherQuantityLabel.textContent = qtyLabel;

  if (dom.vfxWeatherSizeSlider) {
    dom.vfxWeatherSizeSlider.value = String(sizeVal);
  }
  if (dom.vfxWeatherSizeVal) {
    dom.vfxWeatherSizeVal.textContent = Number(sizeVal).toFixed(2);
  }
  if (dom.vfxWeatherQuantitySlider) {
    dom.vfxWeatherQuantitySlider.value = String(qtyVal);
  }
  if (dom.vfxWeatherQuantityVal) {
    dom.vfxWeatherQuantityVal.textContent = `${qtyVal}%`;
  }
}

export function handleWeatherSelectChange() {
  const selected = (dom.vfxWeatherSelect?.value || 'none') as 'none' | 'sparkles' | 'rain' | 'snow' | 'dust';

  if (selected === 'none') {
    dom.vfxWeatherControls?.classList.add('hidden');
    if (dom.vfxWeatherStatusTag) {
      dom.vfxWeatherStatusTag.textContent = 'None';
      dom.vfxWeatherStatusTag.className = 'text-xs font-mono text-gray-400 bg-gray-800/80 px-2.5 py-0.5 rounded-full border border-gray-700/50';
    }
    timelineState.setVideoEffects({ sparkles: 0, rain: 0, snow: 0, dustParticles: 0 });
  } else {
    dom.vfxWeatherControls?.classList.remove('hidden');
    const defaultQty = selected === 'snow' ? 50 : 60;
    const size = selected === 'sparkles' ? (state.sparklesSize ?? 0.5)
      : selected === 'rain' ? (state.rainSize ?? 0.5)
      : selected === 'snow' ? (state.snowSize ?? 0.5)
      : (state.dustMotesSize ?? 0.5);

    updateWeatherMetaAndSliders(selected, {
      sparkles: selected === 'sparkles' ? defaultQty / 100 : 0,
      sparklesSize: size,
      rain: selected === 'rain' ? defaultQty / 100 : 0,
      rainSize: size,
      snow: selected === 'snow' ? defaultQty / 100 : 0,
      snowSize: size,
      dustParticles: selected === 'dust' ? defaultQty / 100 : 0,
      dustParticlesSize: size
    });

    applyCurrentWeatherSliders();
  }

  drawVideoFrame(state.lastRenderedTime || 0);
  renderVfxPreviewCanvas();
}

export function applyCurrentWeatherSliders() {
  const selected = (dom.vfxWeatherSelect?.value || 'none') as 'none' | 'sparkles' | 'rain' | 'snow' | 'dust';
  if (selected === 'none') return;

  const size = dom.vfxWeatherSizeSlider ? parseFloat(dom.vfxWeatherSizeSlider.value) || 0.5 : 0.5;
  const qty = dom.vfxWeatherQuantitySlider ? parseInt(dom.vfxWeatherQuantitySlider.value, 10) || 50 : 50;

  if (dom.vfxWeatherSizeVal) dom.vfxWeatherSizeVal.textContent = size.toFixed(2);
  if (dom.vfxWeatherQuantityVal) dom.vfxWeatherQuantityVal.textContent = `${qty}%`;

  const intensity = qty / 100;
  const countMult = Math.max(0.1, qty / 50);

  if (selected === 'sparkles') {
    state.sparklesSize = size;
    state.sparklesCount = countMult;
    localStorage.setItem('sparklesSize', String(size));
    localStorage.setItem('sparklesCount', String(countMult));
    timelineState.setVideoEffects({
      sparkles: intensity,
      sparklesSize: size,
      sparklesCount: countMult,
      rain: 0,
      snow: 0,
      dustParticles: 0
    });
  } else if (selected === 'rain') {
    state.rainSize = size;
    state.rainCount = countMult;
    localStorage.setItem('rainSize', String(size));
    localStorage.setItem('rainCount', String(countMult));
    timelineState.setVideoEffects({
      rain: intensity,
      rainSize: size,
      rainCount: countMult,
      sparkles: 0,
      snow: 0,
      dustParticles: 0
    });
  } else if (selected === 'snow') {
    state.snowSize = size;
    state.snowCount = countMult;
    localStorage.setItem('snowSize', String(size));
    localStorage.setItem('snowCount', String(countMult));
    timelineState.setVideoEffects({
      snow: intensity,
      snowSize: size,
      snowCount: countMult,
      sparkles: 0,
      rain: 0,
      dustParticles: 0
    });
  } else if (selected === 'dust') {
    state.dustMotesSize = size;
    state.dustMotesCount = countMult;
    localStorage.setItem('dustMotesSize', String(size));
    localStorage.setItem('dustMotesCount', String(countMult));
    timelineState.setVideoEffects({
      dustParticles: intensity,
      dustParticlesSize: size,
      dustParticlesCount: countMult,
      sparkles: 0,
      rain: 0,
      snow: 0
    });
  }

  drawVideoFrame(state.lastRenderedTime || 0);
  renderVfxPreviewCanvas();
}

export function applyHdrValues(masterVal: number, balance?: number, clarity?: number, vibrance?: number, sharpening?: number) {
  const m = Math.max(0, Math.min(100, masterVal)) / 100;
  const b = balance !== undefined ? balance : Math.round(m * 85);
  const c = clarity !== undefined ? clarity : Math.round(m * 95);
  const v = vibrance !== undefined ? vibrance : Math.round(m * 65);
  const s = sharpening !== undefined ? sharpening : Math.round(m * 75);

  const masterPercent = Math.round(m * 100);

  // Sync VFX Studio DOM
  if (dom.vfxHdrMasterSlider) dom.vfxHdrMasterSlider.value = String(masterPercent);
  if (dom.vfxHdrMasterVal) dom.vfxHdrMasterVal.textContent = `${masterPercent}%`;
  if (dom.vfxHdrBalanceSlider) dom.vfxHdrBalanceSlider.value = String(b);
  if (dom.vfxHdrBalanceVal) dom.vfxHdrBalanceVal.textContent = `${b}%`;
  if (dom.vfxClaritySlider) dom.vfxClaritySlider.value = String(c);
  if (dom.vfxClarityVal) dom.vfxClarityVal.textContent = `${c}%`;
  if (dom.vfxVibranceSlider) dom.vfxVibranceSlider.value = String(v);
  if (dom.vfxVibranceVal) dom.vfxVibranceVal.textContent = `${v}%`;
  if (dom.vfxSharpeningSlider) dom.vfxSharpeningSlider.value = String(s);
  if (dom.vfxSharpeningVal) dom.vfxSharpeningVal.textContent = `${s}%`;

  // Sync Cinematography Panel DOM
  if (dom.cinemaHdrMasterSlider) dom.cinemaHdrMasterSlider.value = String(masterPercent);
  if (dom.cinemaHdrMasterVal) dom.cinemaHdrMasterVal.textContent = `${masterPercent}%`;
  if (dom.cinemaHdrBalanceSlider) dom.cinemaHdrBalanceSlider.value = String(b);
  if (dom.cinemaHdrBalanceVal) dom.cinemaHdrBalanceVal.textContent = `${b}%`;
  if (dom.cinemaHdrClaritySlider) dom.cinemaHdrClaritySlider.value = String(c);
  if (dom.cinemaHdrClarityVal) dom.cinemaHdrClarityVal.textContent = `${c}%`;
  if (dom.cinemaHdrVibranceSlider) dom.cinemaHdrVibranceSlider.value = String(v);
  if (dom.cinemaHdrVibranceVal) dom.cinemaHdrVibranceVal.textContent = `${v}%`;
  if (dom.cinemaHdrSharpeningSlider) dom.cinemaHdrSharpeningSlider.value = String(s);
  if (dom.cinemaHdrSharpeningVal) dom.cinemaHdrSharpeningVal.textContent = `${s}%`;

  timelineState.setVideoEffects({
    hdrMaster: m,
    hdrBalance: b / 100,
    clarity: c / 100,
    vibrance: v / 100,
    sharpening: s / 100
  });

  drawVideoFrame(state.lastRenderedTime || 0);
  renderVfxPreviewCanvas();
}

export function handleHdrMasterSliderChange() {
  if (!dom.vfxHdrMasterSlider) return;
  const masterVal = parseInt(dom.vfxHdrMasterSlider.value, 10);
  applyHdrValues(masterVal);
}

export function handleHdrFineTuneSliderChange() {
  const b = dom.vfxHdrBalanceSlider ? parseInt(dom.vfxHdrBalanceSlider.value, 10) : 0;
  const c = dom.vfxClaritySlider ? parseInt(dom.vfxClaritySlider.value, 10) : 0;
  const v = dom.vfxVibranceSlider ? parseInt(dom.vfxVibranceSlider.value, 10) : 0;
  const s = dom.vfxSharpeningSlider ? parseInt(dom.vfxSharpeningSlider.value, 10) : 0;

  const computedMaster = Math.round(((b / 0.85) + (c / 0.95) + (v / 0.65) + (s / 0.75)) / 4);
  applyHdrValues(computedMaster, b, c, v, s);
}

export function handleCinemaHdrMasterSliderChange() {
  if (!dom.cinemaHdrMasterSlider) return;
  const masterVal = parseInt(dom.cinemaHdrMasterSlider.value, 10);
  applyHdrValues(masterVal);
}

export function handleCinemaHdrFineTuneSliderChange() {
  const b = dom.cinemaHdrBalanceSlider ? parseInt(dom.cinemaHdrBalanceSlider.value, 10) : 0;
  const c = dom.cinemaHdrClaritySlider ? parseInt(dom.cinemaHdrClaritySlider.value, 10) : 0;
  const v = dom.cinemaHdrVibranceSlider ? parseInt(dom.cinemaHdrVibranceSlider.value, 10) : 0;
  const s = dom.cinemaHdrSharpeningSlider ? parseInt(dom.cinemaHdrSharpeningSlider.value, 10) : 0;

  const computedMaster = Math.round(((b / 0.85) + (c / 0.95) + (v / 0.65) + (s / 0.75)) / 4);
  applyHdrValues(computedMaster, b, c, v, s);
}

export function updateEffectsFromUI() {
  const grain = dom.vfxGrainSlider ? parseInt(dom.vfxGrainSlider.value, 10) / 100 : 0.05;
  const vignette = dom.vfxVignetteSlider ? parseInt(dom.vfxVignetteSlider.value, 10) / 100 : 0.15;
  const chromaticAberration = dom.vfxAberrationSlider ? parseInt(dom.vfxAberrationSlider.value, 10) / 100 : 0;
  const dustAndScratches = dom.vfxDustScratchesSlider ? parseInt(dom.vfxDustScratchesSlider.value, 10) / 100 : 0;
  const lightLeaks = dom.vfxLightLeaksSlider ? parseInt(dom.vfxLightLeaksSlider.value, 10) / 100 : 0;

  const hdrMaster = dom.cinemaHdrMasterSlider ? parseInt(dom.cinemaHdrMasterSlider.value, 10) / 100 : (dom.vfxHdrMasterSlider ? parseInt(dom.vfxHdrMasterSlider.value, 10) / 100 : (timelineState.videoEffects?.hdrMaster ?? 0));
  const hdrBalance = dom.cinemaHdrBalanceSlider ? parseInt(dom.cinemaHdrBalanceSlider.value, 10) / 100 : (dom.vfxHdrBalanceSlider ? parseInt(dom.vfxHdrBalanceSlider.value, 10) / 100 : (timelineState.videoEffects?.hdrBalance ?? 0));
  const clarity = dom.cinemaHdrClaritySlider ? parseInt(dom.cinemaHdrClaritySlider.value, 10) / 100 : (dom.vfxClaritySlider ? parseInt(dom.vfxClaritySlider.value, 10) / 100 : (timelineState.videoEffects?.clarity ?? 0));
  const vibrance = dom.cinemaHdrVibranceSlider ? parseInt(dom.cinemaHdrVibranceSlider.value, 10) / 100 : (dom.vfxVibranceSlider ? parseInt(dom.vfxVibranceSlider.value, 10) / 100 : (timelineState.videoEffects?.vibrance ?? 0));
  const sharpening = dom.cinemaHdrSharpeningSlider ? parseInt(dom.cinemaHdrSharpeningSlider.value, 10) / 100 : (dom.vfxSharpeningSlider ? parseInt(dom.vfxSharpeningSlider.value, 10) / 100 : (timelineState.videoEffects?.sharpening ?? 0));

  const colorFilter = dom.vfxColorFilterSelect ? dom.vfxColorFilterSelect.value : 'none';
  const blendMode = dom.vfxBlendModeSelect ? dom.vfxBlendModeSelect.value : 'normal';

  if (dom.vfxGrainVal) dom.vfxGrainVal.textContent = `${Math.round(grain * 100)}%`;
  if (dom.vfxVignetteVal) dom.vfxVignetteVal.textContent = `${Math.round(vignette * 100)}%`;
  if (dom.vfxAberrationVal) dom.vfxAberrationVal.textContent = `${Math.round(chromaticAberration * 100)}%`;
  if (dom.vfxDustScratchesVal) dom.vfxDustScratchesVal.textContent = `${Math.round(dustAndScratches * 100)}%`;
  if (dom.vfxLightLeaksVal) dom.vfxLightLeaksVal.textContent = `${Math.round(lightLeaks * 100)}%`;

  timelineState.setVideoEffects({
    grain,
    vignette,
    chromaticAberration,
    dustAndScratches,
    lightLeaks,
    hdrMaster,
    hdrBalance,
    clarity,
    vibrance,
    sharpening,
    colorFilter,
    blendMode
  });

  // Draw main video frame & modal preview
  drawVideoFrame(state.lastRenderedTime || 0);
  renderVfxPreviewCanvas();
}

export function applyPreset(presetKey: string) {
  const presets: Record<string, any> = {
    'hdr-crisp-nature': {
      hdrMaster: 0.50,
      hdrBalance: 0.42,
      clarity: 0.48,
      vibrance: 0.32,
      sharpening: 0.38,
      vignette: 0.15,
      grain: 0.05,
      colorFilter: 'none',
      blendMode: 'normal'
    },
    'cinematic-35mm': { grain: 0.35, vignette: 0.30, dustAndScratches: 0.15, lightLeaks: 0.1, colorFilter: 'vintage', blendMode: 'normal', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'cyberpunk-neon': { chromaticAberration: 0.40, colorFilter: 'cyberpunk', sparkles: 0.2, sparklesSize: 0.6, sparklesCount: 0.8, blendMode: 'overlay', vignette: 0.25, hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'film-noir': { grain: 0.45, vignette: 0.50, colorFilter: 'noir', dustAndScratches: 0.25, blendMode: 'normal', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'golden-hour': { lightLeaks: 0.35, vignette: 0.20, colorFilter: 'warm', blendMode: 'soft-light', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'scifi-cool': { lightLeaks: 0.25, colorFilter: 'cool', vignette: 0.25, blendMode: 'screen', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'retro-vhs': { chromaticAberration: 0.50, dustAndScratches: 0.30, colorFilter: 'crt', blendMode: 'normal', grain: 0.2, hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'rainy-atmosphere': { rain: 0.60, rainSize: 0.6, rainCount: 0.8, vignette: 0.35, colorFilter: 'cool', blendMode: 'normal', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'snowy-winter': { snow: 0.50, snowSize: 0.5, snowCount: 0.7, vignette: 0.20, colorFilter: 'cool', blendMode: 'screen', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'sparkle-magic': { sparkles: 0.60, sparklesSize: 0.65, sparklesCount: 0.8, vignette: 0.15, colorFilter: 'warm', blendMode: 'screen', hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0 },
    'clean-default': { grain: 0, vignette: 0, lightLeaks: 0, chromaticAberration: 0, dustAndScratches: 0, hdrMaster: 0, hdrBalance: 0, clarity: 0, vibrance: 0, sharpening: 0, sparkles: 0, sparklesSize: 0.5, sparklesCount: 0.5, rain: 0, rainSize: 0.5, rainCount: 0.5, snow: 0, snowSize: 0.5, snowCount: 0.5, dustParticles: 0, dustParticlesSize: 0.5, dustParticlesCount: 0.5, colorFilter: 'none', blendMode: 'normal' }
  };

  const choice = presets[presetKey] || presets['clean-default'];
  timelineState.setVideoEffects(choice);
  syncEffectsToUI();
  drawVideoFrame(state.lastRenderedTime || 0);
  renderVfxPreviewCanvas();
  showStatus(`Applied FX look: ${presetKey.replace('-', ' ')}`, false, 2000);
}

export function initVisualEffectsHandlers() {
  const triggers = [
    dom.vfxStudioVideoDirectorBtn
  ];
  triggers.forEach(btn => {
    btn?.addEventListener('click', openVisualEffectsModal);
  });
  if (dom.closeVisualEffectsModalBtn) {
    dom.closeVisualEffectsModalBtn.addEventListener('click', closeVisualEffectsModal);
  }
  if (dom.saveVisualEffectsBtn) {
    dom.saveVisualEffectsBtn.addEventListener('click', () => {
      saveVersion(false);
      showStatus('✨ Saved Visual Effects configuration!', false, 2500);
      closeVisualEffectsModal();
    });
  }
  if (dom.vfxResetBtn) {
    dom.vfxResetBtn.addEventListener('click', () => {
      applyPreset('clean-default');
    });
  }

  // Preset Card Click Event Delegation
  if (dom.vfxPresetGrid) {
    dom.vfxPresetGrid.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.vfx-preset-card') as HTMLElement;
      if (!card) return;
      const preset = card.dataset.preset;
      if (preset) applyPreset(preset);
    });
  }

  // Master HDR Slider Listener
  if (dom.vfxHdrMasterSlider) {
    dom.vfxHdrMasterSlider.addEventListener('input', handleHdrMasterSliderChange);
    dom.vfxHdrMasterSlider.addEventListener('change', handleHdrMasterSliderChange);
  }

  // Drawer Fine-Tuning Breakdown Sliders Listeners
  const hdrFineTuneSliders = [
    dom.vfxHdrBalanceSlider,
    dom.vfxClaritySlider,
    dom.vfxVibranceSlider,
    dom.vfxSharpeningSlider
  ];
  hdrFineTuneSliders.forEach(slider => {
    slider?.addEventListener('input', handleHdrFineTuneSliderChange);
    slider?.addEventListener('change', handleHdrFineTuneSliderChange);
  });

  // Drawer Toggle Button
  if (dom.vfxHdrToggleDrawerBtn) {
    dom.vfxHdrToggleDrawerBtn.addEventListener('click', () => {
      if (dom.vfxHdrDrawerContainer) {
        const isHidden = dom.vfxHdrDrawerContainer.classList.contains('hidden');
        if (isHidden) {
          dom.vfxHdrDrawerContainer.classList.remove('hidden');
          if (dom.vfxHdrDrawerChevron) dom.vfxHdrDrawerChevron.textContent = '▴';
        } else {
          dom.vfxHdrDrawerContainer.classList.add('hidden');
          if (dom.vfxHdrDrawerChevron) dom.vfxHdrDrawerChevron.textContent = '▾';
        }
      }
    });
  }

  // Cinematography Panel Master HDR Slider Listener
  if (dom.cinemaHdrMasterSlider) {
    dom.cinemaHdrMasterSlider.addEventListener('input', handleCinemaHdrMasterSliderChange);
    dom.cinemaHdrMasterSlider.addEventListener('change', handleCinemaHdrMasterSliderChange);
  }

  // Cinematography Panel Drawer Fine-Tuning Breakdown Sliders Listeners
  const cinemaHdrFineTuneSliders = [
    dom.cinemaHdrBalanceSlider,
    dom.cinemaHdrClaritySlider,
    dom.cinemaHdrVibranceSlider,
    dom.cinemaHdrSharpeningSlider
  ];
  cinemaHdrFineTuneSliders.forEach(slider => {
    slider?.addEventListener('input', handleCinemaHdrFineTuneSliderChange);
    slider?.addEventListener('change', handleCinemaHdrFineTuneSliderChange);
  });

  // Cinematography Panel Drawer Toggle Button
  if (dom.cinemaHdrToggleDrawerBtn) {
    dom.cinemaHdrToggleDrawerBtn.addEventListener('click', () => {
      if (dom.cinemaHdrDrawerContainer) {
        const isHidden = dom.cinemaHdrDrawerContainer.classList.contains('hidden');
        if (isHidden) {
          dom.cinemaHdrDrawerContainer.classList.remove('hidden');
          if (dom.cinemaHdrDrawerChevron) dom.cinemaHdrDrawerChevron.textContent = '▴';
        } else {
          dom.cinemaHdrDrawerContainer.classList.add('hidden');
          if (dom.cinemaHdrDrawerChevron) dom.cinemaHdrDrawerChevron.textContent = '▾';
        }
      }
    });
  }

  // Cinematography Panel Directing Quick Presets
  dom.cinemaHdrPresetOffBtn?.addEventListener('click', () => applyHdrValues(0, 0, 0, 0, 0));
  dom.cinemaHdrPresetNaturalBtn?.addEventListener('click', () => applyHdrValues(35));
  dom.cinemaHdrPresetCrispBtn?.addEventListener('click', () => applyHdrValues(50));
  dom.cinemaHdrPresetHyperBtn?.addEventListener('click', () => applyHdrValues(75));

  // Sliders & Select Listeners
  const controls = [
    dom.vfxColorFilterSelect,
    dom.vfxBlendModeSelect,
    dom.vfxGrainSlider,
    dom.vfxVignetteSlider,
    dom.vfxAberrationSlider,
    dom.vfxDustScratchesSlider,
    dom.vfxLightLeaksSlider
  ];

  controls.forEach(ctrl => {
    ctrl?.addEventListener('input', updateEffectsFromUI);
    ctrl?.addEventListener('change', updateEffectsFromUI);
  });

  // Weather Dropdown & Dynamic Size/Quantity Sliders
  if (dom.vfxWeatherSelect) {
    dom.vfxWeatherSelect.addEventListener('change', handleWeatherSelectChange);
  }
  if (dom.vfxWeatherSizeSlider) {
    dom.vfxWeatherSizeSlider.addEventListener('input', applyCurrentWeatherSliders);
    dom.vfxWeatherSizeSlider.addEventListener('change', applyCurrentWeatherSliders);
  }
  if (dom.vfxWeatherQuantitySlider) {
    dom.vfxWeatherQuantitySlider.addEventListener('input', applyCurrentWeatherSliders);
    dom.vfxWeatherQuantitySlider.addEventListener('change', applyCurrentWeatherSliders);
  }

  timelineState.subscribeToSettings(() => {
    syncEffectsToUI();
    if (dom.visualEffectsModal && !dom.visualEffectsModal.classList.contains('hidden')) {
      renderVfxPreviewCanvas();
    }
  });

  // Synchronize UI elements on initial startup
  syncEffectsToUI();
}
