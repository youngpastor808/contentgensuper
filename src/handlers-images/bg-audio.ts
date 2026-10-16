import { audioBufferToWavBlob } from '../utils-core';
import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import { generateSfx } from '../api/audio';
import * as utils from '../utils';
import { assetStorage } from '../assetStorage';
import { saveVersion } from '../handlers-project';
import { checkGuestRestriction } from '../auth';

export async function generateBgAudio() {
  if (checkGuestRestriction('Generating Background Audio')) return;
  const prompt = dom.bgAudioPromptInput?.value.trim();
  if (!prompt) {
    if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = 'Please enter a prompt.';
    return;
  }

  if (dom.generateBgAudioBtn) {
    dom.generateBgAudioBtn.disabled = true;
    dom.generateBgAudioBtn.innerHTML = ` Generating...`;
  }
  if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = 'Generating background audio...';

  try {
    let provider: 'freesound' | 'gemini' | 'elevenlabs' = 'gemini';
    if (state.freesoundApiKey) provider = 'freesound';
    else if (state.elevenlabsApiKey) provider = 'elevenlabs';

    const buffer = await generateSfx(prompt, provider);
    state.bgAudioPrompt = prompt;
    state._bgAudioBuffer = buffer;

    const wavBlob = await audioBufferToWavBlob(buffer);
    if (state._bgAudioObjectURL) {
      URL.revokeObjectURL(state._bgAudioObjectURL);
    }
    state._bgAudioObjectURL = URL.createObjectURL(wavBlob);

    const assetId = await assetStorage.storeAsset(wavBlob, 'audio', 'current_project');
    state.bgAudioId = assetId;

    if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = 'Background audio generated successfully.';
    if (dom.clearBgAudioBtn) dom.clearBgAudioBtn.classList.remove('hidden');
    if (dom.generateBgAudioBtn) dom.generateBgAudioBtn.innerHTML = '✓ Regenerate';

    ui.renderTimelineEditor();
    saveVersion(false);
  } catch (error) {
    console.error('Background audio generation failed:', error);
    if (dom.bgAudioStatus) {
      dom.bgAudioStatus.innerHTML = `Failed: ${ui.escapeHtml(
        error instanceof Error ? error.message : 'Unknown error'
      )}`;
    }
    if (dom.generateBgAudioBtn) dom.generateBgAudioBtn.innerHTML = 'Generate Background Audio';
  } finally {
    if (dom.generateBgAudioBtn) dom.generateBgAudioBtn.disabled = false;
  }
}

export function clearBgAudio() {
  state.bgAudioPrompt = '';
  state.bgAudioId = null;
  state._bgAudioBuffer = undefined;
  if (state._bgAudioObjectURL) {
    URL.revokeObjectURL(state._bgAudioObjectURL);
    state._bgAudioObjectURL = undefined;
  }
  if (dom.bgAudioPromptInput) dom.bgAudioPromptInput.value = '';
  if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = '';
  if (dom.clearBgAudioBtn) dom.clearBgAudioBtn.classList.add('hidden');
  if (dom.generateBgAudioBtn) dom.generateBgAudioBtn.innerHTML = 'Generate Background Audio';
  ui.renderTimelineEditor();
  saveVersion(false);
}

export async function uploadBgAudio(file: File) {
  if (!file) return;
  if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = 'Loading background music…';
  try {
    const arrayBuffer = await file.arrayBuffer();
    const forStore = arrayBuffer.slice(0);
    const buffer = await utils.safeDecode(utils.getAudioContext(), arrayBuffer);
    state.bgAudioPrompt = file.name;
    state._bgAudioBuffer = buffer;
    const blob = new Blob([forStore], { type: file.type || 'audio/mpeg' });
    if (state._bgAudioObjectURL) URL.revokeObjectURL(state._bgAudioObjectURL);
    state._bgAudioObjectURL = URL.createObjectURL(blob);
    state.bgAudioId = await assetStorage.storeAsset(blob, 'audio', 'current_project');
    if (dom.bgAudioStatus) dom.bgAudioStatus.innerHTML = `Loaded "${file.name}" — loops for the full video.`;
    if (dom.clearBgAudioBtn) dom.clearBgAudioBtn.classList.remove('hidden');
    ui.renderTimelineEditor();
    saveVersion(false);
  } catch (error) {
    console.error('Background music upload failed:', error);
    if (dom.bgAudioStatus) {
      dom.bgAudioStatus.innerHTML = `Failed to load: ${ui.escapeHtml(
        error instanceof Error ? error.message : 'Unknown error'
      )}`;
    }
  }
}

export function setBgAudioVolume(v: number) {
  const vol = Math.max(0, Math.min(1, isNaN(v) ? 0.3 : v));
  state.bgAudioVolume = vol;
  if (state.bgAudioGain) state.bgAudioGain.gain.value = vol;
  if (dom.bgAudioVolumeLabel) dom.bgAudioVolumeLabel.textContent = `${Math.round(vol * 100)}%`;
}
