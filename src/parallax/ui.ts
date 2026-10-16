/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advanced UI controls for 2.5D Parallax: depth strength, camera sway/orbit,
 * depth blur, atmospheric haze, rack focus, and depth model source.
 */

import { state } from '../state';
import { timelineState } from '../state-timeline';

export function initParallaxAdvancedControls(onDirty?: () => void) {
  if (typeof document === 'undefined') return;

  const dustSizeSlider = document.getElementById('parallax-dust-size-range') as HTMLInputElement | null;
  const dustSizeVal = document.getElementById('parallax-dust-size-range-value');
  const dustDensitySlider = document.getElementById('parallax-dust-density-range') as HTMLInputElement | null;
  const dustDensityVal = document.getElementById('parallax-dust-density-range-value');
  const strengthSlider = document.getElementById('parallax-strength-range') as HTMLInputElement | null;
  const strengthVal = document.getElementById('parallax-strength-range-value');
  const orbitSlider = document.getElementById('parallax-orbit-range') as HTMLInputElement | null;
  const orbitVal = document.getElementById('parallax-orbit-range-value');
  const blurSlider = document.getElementById('parallax-blur-range') as HTMLInputElement | null;
  const blurVal = document.getElementById('parallax-blur-range-value');
  const hazeSlider = document.getElementById('parallax-haze-range') as HTMLInputElement | null;
  const hazeVal = document.getElementById('parallax-haze-range-value');
  const depthSourceSelect = document.getElementById('parallax-depth-source-select') as HTMLSelectElement | null;
  const rackFocusCheckbox = document.getElementById('parallax-rackfocus-checkbox') as HTMLInputElement | null;

  // Atmospheric Weather & Particle Dropdown & Dynamic Sliders
  const atmosphericSelect = document.getElementById('parallax-atmospheric-select') as HTMLSelectElement | null;
  const atmosphericTag = document.getElementById('parallax-atmospheric-tag');
  const atmosphericControls = document.getElementById('parallax-atmospheric-controls');
  const atmosphericSizeRange = document.getElementById('parallax-atmospheric-size-range') as HTMLInputElement | null;
  const atmosphericSizeVal = document.getElementById('parallax-atmospheric-size-val');
  const atmosphericSizeLabel = document.getElementById('parallax-atmospheric-size-label');
  const atmosphericQtyRange = document.getElementById('parallax-atmospheric-qty-range') as HTMLInputElement | null;
  const atmosphericQtyVal = document.getElementById('parallax-atmospheric-qty-val');
  const atmosphericQtyLabel = document.getElementById('parallax-atmospheric-qty-label');

  // 1. Load saved settings or defaults
  const savedDustSize = localStorage.getItem('parallaxDustSize');
  if (savedDustSize !== null) {
    const v = parseFloat(savedDustSize);
    state.parallaxDustSize = isNaN(v) ? 0.5 : v;
  }

  const savedDustDensity = localStorage.getItem('parallaxDustDensity');
  if (savedDustDensity !== null) {
    const v = parseFloat(savedDustDensity);
    state.parallaxDustDensity = isNaN(v) ? 0.5 : v;
  }

  const savedStrength = localStorage.getItem('parallaxStrength');
  if (savedStrength !== null) {
    const v = parseFloat(savedStrength);
    state.parallaxStrength = isNaN(v) ? 1.0 : v;
  }

  const savedOrbit = localStorage.getItem('parallaxOrbit');
  if (savedOrbit !== null) {
    const v = parseFloat(savedOrbit);
    state.parallaxOrbit = isNaN(v) ? 0.35 : v;
  }

  const savedBlur = localStorage.getItem('parallaxBlurStrength');
  if (savedBlur !== null) {
    const v = parseFloat(savedBlur);
    state.parallaxBlurStrength = isNaN(v) ? 0.0 : v;
  } else {
    state.parallaxBlurStrength = state.parallaxBlurStrength ?? 0.0;
  }

  const savedDepthBlur = localStorage.getItem('parallaxDepthBlur');
  if (savedDepthBlur !== null) state.parallaxDepthBlur = savedDepthBlur === 'true';

  const savedHaze = localStorage.getItem('parallaxHazeAmount');
  if (savedHaze !== null) {
    const v = parseFloat(savedHaze);
    state.parallaxHazeAmount = isNaN(v) ? 0.6 : v;
  }

  const savedSource = localStorage.getItem('parallaxDepthSource');
  if (savedSource === 'auto' || savedSource === 'server' || savedSource === 'procedural' || savedSource === 'browser') {
    state.parallaxDepthSource = savedSource as any;
  }

  const savedRackFocus = localStorage.getItem('parallaxRackFocus');
  if (savedRackFocus !== null) state.parallaxRackFocus = savedRackFocus === 'true';

  // Load atmospheric settings
  const savedSparklesSize = localStorage.getItem('sparklesSize');
  if (savedSparklesSize !== null) {
    const v = parseFloat(savedSparklesSize);
    state.sparklesSize = isNaN(v) ? 0.5 : v;
  }
  const savedSparklesCount = localStorage.getItem('sparklesCount');
  if (savedSparklesCount !== null) {
    const v = parseFloat(savedSparklesCount);
    state.sparklesCount = isNaN(v) ? 0.5 : v;
  }

  const savedRainSize = localStorage.getItem('rainSize');
  if (savedRainSize !== null) {
    const v = parseFloat(savedRainSize);
    state.rainSize = isNaN(v) ? 0.5 : v;
  }
  const savedRainCount = localStorage.getItem('rainCount');
  if (savedRainCount !== null) {
    const v = parseFloat(savedRainCount);
    state.rainCount = isNaN(v) ? 0.5 : v;
  }

  const savedSnowSize = localStorage.getItem('snowSize');
  if (savedSnowSize !== null) {
    const v = parseFloat(savedSnowSize);
    state.snowSize = isNaN(v) ? 0.5 : v;
  }
  const savedSnowCount = localStorage.getItem('snowCount');
  if (savedSnowCount !== null) {
    const v = parseFloat(savedSnowCount);
    state.snowCount = isNaN(v) ? 0.5 : v;
  }

  const savedDustMotesSize = localStorage.getItem('dustMotesSize');
  if (savedDustMotesSize !== null) {
    const v = parseFloat(savedDustMotesSize);
    state.dustMotesSize = isNaN(v) ? 0.5 : v;
  }
  const savedDustMotesCount = localStorage.getItem('dustMotesCount');
  if (savedDustMotesCount !== null) {
    const v = parseFloat(savedDustMotesCount);
    state.dustMotesCount = isNaN(v) ? 0.5 : v;
  }

  // 2. Synchronize UI element values
  if (dustSizeSlider) {
    dustSizeSlider.min = '0.1';
    dustSizeSlider.max = '2';
    dustSizeSlider.step = '0.05';
    dustSizeSlider.value = String(state.parallaxDustSize ?? 0.5);
    if (dustSizeVal) dustSizeVal.textContent = Number(dustSizeSlider.value).toFixed(2);
    dustSizeSlider.addEventListener('input', () => {
      const val = parseFloat(dustSizeSlider.value) || 0.5;
      state.parallaxDustSize = val;
      localStorage.setItem('parallaxDustSize', String(val));
      if (dustSizeVal) dustSizeVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (dustDensitySlider) {
    dustDensitySlider.min = '0.1';
    dustDensitySlider.max = '2';
    dustDensitySlider.step = '0.05';
    dustDensitySlider.value = String(state.parallaxDustDensity ?? 0.5);
    if (dustDensityVal) dustDensityVal.textContent = Number(dustDensitySlider.value).toFixed(2);
    dustDensitySlider.addEventListener('input', () => {
      const val = parseFloat(dustDensitySlider.value) || 0.5;
      state.parallaxDustDensity = val;
      localStorage.setItem('parallaxDustDensity', String(val));
      if (dustDensityVal) dustDensityVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (strengthSlider) {
    strengthSlider.min = '0';
    strengthSlider.max = '3';
    strengthSlider.step = '0.05';
    strengthSlider.value = String(state.parallaxStrength ?? 1.0);
    if (strengthVal) strengthVal.textContent = Number(strengthSlider.value).toFixed(2);
    strengthSlider.addEventListener('input', () => {
      const val = parseFloat(strengthSlider.value) || 0;
      state.parallaxStrength = val;
      localStorage.setItem('parallaxStrength', String(val));
      if (strengthVal) strengthVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (orbitSlider) {
    orbitSlider.min = '0';
    orbitSlider.max = '1';
    orbitSlider.step = '0.05';
    orbitSlider.value = String(state.parallaxOrbit ?? 0.35);
    if (orbitVal) orbitVal.textContent = Number(orbitSlider.value).toFixed(2);
    orbitSlider.addEventListener('input', () => {
      const val = parseFloat(orbitSlider.value) || 0;
      state.parallaxOrbit = val;
      localStorage.setItem('parallaxOrbit', String(val));
      if (orbitVal) orbitVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (blurSlider) {
    blurSlider.min = '0';
    blurSlider.max = '2';
    blurSlider.step = '0.05';
    blurSlider.value = String(state.parallaxBlurStrength ?? 0.0);
    if (blurVal) blurVal.textContent = Number(blurSlider.value).toFixed(2);
    blurSlider.addEventListener('input', () => {
      const val = parseFloat(blurSlider.value) || 0;
      state.parallaxBlurStrength = val;
      state.parallaxDepthBlur = val > 0;
      localStorage.setItem('parallaxBlurStrength', String(val));
      localStorage.setItem('parallaxDepthBlur', String(state.parallaxDepthBlur));
      if (blurVal) blurVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (hazeSlider) {
    hazeSlider.min = '0';
    hazeSlider.max = '1';
    hazeSlider.step = '0.05';
    hazeSlider.value = String(state.parallaxHazeAmount ?? 0.6);
    if (hazeVal) hazeVal.textContent = Number(hazeSlider.value).toFixed(2);
    hazeSlider.addEventListener('input', () => {
      const val = parseFloat(hazeSlider.value) || 0;
      state.parallaxHazeAmount = val;
      localStorage.setItem('parallaxHazeAmount', String(val));
      if (hazeVal) hazeVal.textContent = val.toFixed(2);
      onDirty?.();
    });
  }

  if (depthSourceSelect) {
    depthSourceSelect.value = state.parallaxDepthSource || 'auto';
    depthSourceSelect.addEventListener('change', () => {
      state.parallaxDepthSource = depthSourceSelect.value as any;
      localStorage.setItem('parallaxDepthSource', state.parallaxDepthSource);
      onDirty?.();
    });
  }

  if (rackFocusCheckbox) {
    rackFocusCheckbox.checked = Boolean(state.parallaxRackFocus);
    rackFocusCheckbox.addEventListener('change', () => {
      state.parallaxRackFocus = rackFocusCheckbox.checked;
      localStorage.setItem('parallaxRackFocus', String(state.parallaxRackFocus));
      onDirty?.();
    });
  }

  // --- Atmospheric Weather & Particle Dropdown & Sliders Sync ---
  const syncSidebarWeatherUI = () => {
    const fx = timelineState.videoEffects;
    let active: 'none' | 'sparkles' | 'rain' | 'snow' | 'dust' = 'none';
    if ((fx.sparkles || 0) > 0) active = 'sparkles';
    else if ((fx.rain || 0) > 0) active = 'rain';
    else if ((fx.snow || 0) > 0) active = 'snow';
    else if ((fx.dustParticles || 0) > 0) active = 'dust';

    if (atmosphericSelect) atmosphericSelect.value = active;
    if (atmosphericTag) {
      atmosphericTag.textContent = active === 'none' ? 'None' : active.toUpperCase();
    }

    if (active === 'none') {
      atmosphericControls?.classList.add('hidden');
    } else {
      atmosphericControls?.classList.remove('hidden');
      let sizeLabel = 'Particle Size';
      let qtyLabel = 'Quantity / Density';
      let sizeVal = 0.5;
      let qtyVal = 60;

      if (active === 'sparkles') {
        sizeLabel = '✨ Sparkle Size';
        qtyLabel = '✨ Sparkle Density';
        sizeVal = fx.sparklesSize ?? state.sparklesSize ?? 0.5;
        qtyVal = Math.round((fx.sparkles || 0.6) * 100);
      } else if (active === 'rain') {
        sizeLabel = '🌧️ Streak Length';
        qtyLabel = '🌧️ Rain Fall Density';
        sizeVal = fx.rainSize ?? state.rainSize ?? 0.5;
        qtyVal = Math.round((fx.rain || 0.6) * 100);
      } else if (active === 'snow') {
        sizeLabel = '❄️ Flake Size';
        qtyLabel = '❄️ Snow Flake Density';
        sizeVal = fx.snowSize ?? state.snowSize ?? 0.5;
        qtyVal = Math.round((fx.snow || 0.5) * 100);
      } else if (active === 'dust') {
        sizeLabel = '💨 Mote Scale';
        qtyLabel = '💨 Dust Mote Density';
        sizeVal = fx.dustParticlesSize ?? state.dustMotesSize ?? 0.5;
        qtyVal = Math.round((fx.dustParticles || 0.6) * 100);
      }

      if (atmosphericSizeLabel) atmosphericSizeLabel.textContent = sizeLabel;
      if (atmosphericQtyLabel) atmosphericQtyLabel.textContent = qtyLabel;
      if (atmosphericSizeRange) atmosphericSizeRange.value = String(sizeVal);
      if (atmosphericSizeVal) atmosphericSizeVal.textContent = Number(sizeVal).toFixed(2);
      if (atmosphericQtyRange) atmosphericQtyRange.value = String(qtyVal);
      if (atmosphericQtyVal) atmosphericQtyVal.textContent = `${qtyVal}%`;
    }
  };

  syncSidebarWeatherUI();
  timelineState.subscribeToSettings(() => {
    syncSidebarWeatherUI();
  });

  if (atmosphericSelect) {
    atmosphericSelect.addEventListener('change', () => {
      const selected = (atmosphericSelect.value || 'none') as 'none' | 'sparkles' | 'rain' | 'snow' | 'dust';
      if (selected === 'none') {
        atmosphericControls?.classList.add('hidden');
        if (atmosphericTag) atmosphericTag.textContent = 'None';
        timelineState.setVideoEffects({ sparkles: 0, rain: 0, snow: 0, dustParticles: 0 });
      } else {
        atmosphericControls?.classList.remove('hidden');
        const defaultQty = selected === 'snow' ? 50 : 60;
        const size = selected === 'sparkles' ? (state.sparklesSize ?? 0.5)
          : selected === 'rain' ? (state.rainSize ?? 0.5)
          : selected === 'snow' ? (state.snowSize ?? 0.5)
          : (state.dustMotesSize ?? 0.5);

        if (atmosphericTag) atmosphericTag.textContent = selected.toUpperCase();
        if (selected === 'sparkles') {
          timelineState.setVideoEffects({ sparkles: defaultQty / 100, sparklesSize: size, sparklesCount: 0.5, rain: 0, snow: 0, dustParticles: 0 });
        } else if (selected === 'rain') {
          timelineState.setVideoEffects({ rain: defaultQty / 100, rainSize: size, rainCount: 0.5, sparkles: 0, snow: 0, dustParticles: 0 });
        } else if (selected === 'snow') {
          timelineState.setVideoEffects({ snow: defaultQty / 100, snowSize: size, snowCount: 0.5, sparkles: 0, rain: 0, dustParticles: 0 });
        } else if (selected === 'dust') {
          timelineState.setVideoEffects({ dustParticles: defaultQty / 100, dustParticlesSize: size, dustParticlesCount: 0.5, sparkles: 0, rain: 0, snow: 0 });
        }
        syncSidebarWeatherUI();
      }
      onDirty?.();
    });
  }

  const applySidebarWeatherSliders = () => {
    const selected = (atmosphericSelect?.value || 'none') as 'none' | 'sparkles' | 'rain' | 'snow' | 'dust';
    if (selected === 'none') return;

    const size = atmosphericSizeRange ? parseFloat(atmosphericSizeRange.value) || 0.5 : 0.5;
    const qty = atmosphericQtyRange ? parseInt(atmosphericQtyRange.value, 10) || 50 : 50;

    if (atmosphericSizeVal) atmosphericSizeVal.textContent = size.toFixed(2);
    if (atmosphericQtyVal) atmosphericQtyVal.textContent = `${qty}%`;

    const intensity = qty / 100;
    const countMult = Math.max(0.1, qty / 50);

    if (selected === 'sparkles') {
      state.sparklesSize = size;
      state.sparklesCount = countMult;
      localStorage.setItem('sparklesSize', String(size));
      localStorage.setItem('sparklesCount', String(countMult));
      timelineState.setVideoEffects({ sparkles: intensity, sparklesSize: size, sparklesCount: countMult, rain: 0, snow: 0, dustParticles: 0 });
    } else if (selected === 'rain') {
      state.rainSize = size;
      state.rainCount = countMult;
      localStorage.setItem('rainSize', String(size));
      localStorage.setItem('rainCount', String(countMult));
      timelineState.setVideoEffects({ rain: intensity, rainSize: size, rainCount: countMult, sparkles: 0, snow: 0, dustParticles: 0 });
    } else if (selected === 'snow') {
      state.snowSize = size;
      state.snowCount = countMult;
      localStorage.setItem('snowSize', String(size));
      localStorage.setItem('snowCount', String(countMult));
      timelineState.setVideoEffects({ snow: intensity, snowSize: size, snowCount: countMult, sparkles: 0, rain: 0, dustParticles: 0 });
    } else if (selected === 'dust') {
      state.dustMotesSize = size;
      state.dustMotesCount = countMult;
      localStorage.setItem('dustMotesSize', String(size));
      localStorage.setItem('dustMotesCount', String(countMult));
      timelineState.setVideoEffects({ dustParticles: intensity, dustParticlesSize: size, dustParticlesCount: countMult, sparkles: 0, rain: 0, snow: 0 });
    }
    onDirty?.();
  };

  if (atmosphericSizeRange) {
    atmosphericSizeRange.addEventListener('input', applySidebarWeatherSliders);
    atmosphericSizeRange.addEventListener('change', applySidebarWeatherSliders);
  }
  if (atmosphericQtyRange) {
    atmosphericQtyRange.addEventListener('input', applySidebarWeatherSliders);
    atmosphericQtyRange.addEventListener('change', applySidebarWeatherSliders);
  }
}
