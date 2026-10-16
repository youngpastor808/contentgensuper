/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from "./dom";
import { t0, t1 } from "./perfMonitor";
import { ActiveClipIndex } from "./activeClipIndex";
import * as constants from "./constants";
import { state } from "./state";
import { DB } from "./db";
import { getTransitionLabel, getTransitionIcon, clamp, getCharacterAliases } from './utils';
import { formatTime, audioBufferToWavBlob, pacingMap, debounce, getPixelsPerSecond, getMatchingResolutionKey } from './utils-core';
import { isUsingPersonalKey } from "./api/core";
import { videoRenderContext, drawVideoFrame, getPreviewDimensions, getShotFilterCss } from "./videoRenderer";
import { SubtitleEngine } from "./subtitle-engine";
import { timelineState } from "./state-timeline";
import type { AspectRatio, CharacterProfile, VoiceArchetype } from './types';
import { DESIGN_ARCHETYPES } from "./templates";
import { assetStorage } from "./assetStorage";
import { escapeHtml, showStatus, switchTab } from "./ui";
import { optimizeMemoryForVideoDirector } from "./memoryManager";
import { openGraphicEditor, deleteGraphicEvent } from "./handlers-graphics";
import { generateRhythmOptionsHtml } from "./editingRhythmTemplates";
import {
  handleTimelineClick,
  handleTimelineMouseDown,
} from "./videoController";
import { enhanceTimelineDom } from "./director-workspace";


let previewResizeObserver: ResizeObserver | null = null;
let latestTimelineStateCache = {
  totalDuration: 0,
  clips: [] as any[],
  graphicsEvents: [] as any[],
  pps: 50,
  trackWidth: 1000,
};
let timelineScrollRafId: number | null = null;

// High-Performance Audio Waveform Peak Cache: WeakMap automatically garbage-collected
const waveformPeakCache = new WeakMap<AudioBuffer, Float32Array>();

export function getAudioBufferPeaks(buffer: AudioBuffer, buckets = 3000): Float32Array {
  const cached = waveformPeakCache.get(buffer);
  if (cached) return cached;

  const data = buffer.getChannelData(0);
  const totalSamples = data.length;
  const peaks = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(totalSamples / buckets));
  const innerStep = Math.max(1, Math.floor(step / 32));

  for (let b = 0; b < buckets; b++) {
    const start = b * step;
    let sumSq = 0;
    let count = 0;
    for (let j = 0; j < step; j += innerStep) {
      const idx = start + j;
      if (idx < totalSamples) {
        const val = data[idx];
        sumSq += val * val;
        count++;
      }
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    peaks[b] = Math.min(1.0, Math.pow(rms * 2.5, 0.8));
  }

  waveformPeakCache.set(buffer, peaks);
  return peaks;
}

export function resizeVideoPreviewWrapper() {
  const previewWrapper = document.getElementById("video-preview-wrapper");
  const container =
    document.getElementById("video-preview-container-area") ||
    previewWrapper?.parentElement;
  if (!previewWrapper || !container) return;

  const val = (state.aspectRatio ||
    dom.videoDirectorAspectSelect?.value ||
    dom.imageResolutionSelect?.value ||
    "16:9") as AspectRatio;
  let ratioW = 16,
    ratioH = 9;
  if (val === "9:16") {
    ratioW = 9;
    ratioH = 16;
  } else if (val === "1:1") {
    ratioW = 1;
    ratioH = 1;
  } else if (val === "4:3") {
    ratioW = 4;
    ratioH = 3;
  } else if (val === "3:4") {
    ratioW = 3;
    ratioH = 4;
  }

  const targetRatio = ratioW / ratioH;
  const containerRect = container.getBoundingClientRect();
  const padX = 20;
  const padY = 20;
  const availW = Math.max(50, containerRect.width - padX);
  const availH = Math.max(50, containerRect.height - padY);

  let finalW: number, finalH: number;
  if (availW / availH > targetRatio) {
    // Container is wider than the target ratio -> fit to height
    finalH = availH;
    finalW = availH * targetRatio;
  } else {
    // Container is taller than the target ratio -> fit to width
    finalW = availW;
    finalH = availW / targetRatio;
  }

  const pxW = Math.floor(finalW);
  const pxH = Math.floor(finalH);

  previewWrapper.style.width = `${pxW}px`;
  previewWrapper.style.height = `${pxH}px`;
  previewWrapper.style.maxWidth = `${Math.floor(availW)}px`;
  previewWrapper.style.maxHeight = `${Math.floor(availH)}px`;
  previewWrapper.style.aspectRatio = `${ratioW}/${ratioH}`;

  // Preview resolution: size internal canvas bitmap to user-selected preview resolution
  // (240p, 320p, 520p, 720p). CSS stretches the canvas smoothly to fill previewWrapper.
  const previewCanvas = document.getElementById('video-canvas') as HTMLCanvasElement | null;
  if (previewCanvas) {
      const { width: targetW, height: targetH } = getPreviewDimensions(val);
      if (previewCanvas.width !== targetW || previewCanvas.height !== targetH) {
          previewCanvas.width = targetW;
          previewCanvas.height = targetH;
      }
  }
}

export function initPreviewResizeObserver() {
  if (previewResizeObserver) return;
  const container = document.getElementById("video-preview-container-area");
  if (!container || typeof ResizeObserver === "undefined") return;

  previewResizeObserver = new ResizeObserver(() => {
    resizeVideoPreviewWrapper();
    try {
      if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime || 0);
      }
    } catch (err) {
      console.warn("Failed to redraw video frame during resize:", err);
    }
  });
  previewResizeObserver.observe(container);
}

export function updateAspectRatioState(newRatio?: string) {
  const val = (newRatio ||
    state.aspectRatio ||
    dom.videoDirectorAspectSelect?.value ||
    dom.imageResolutionSelect?.value ||
    "16:9") as AspectRatio;
  state.aspectRatio = val;

  const aspectClass =
    val === "9:16"
      ? "aspect-[9/16]"
      : val === "1:1"
        ? "aspect-square"
        : val === "4:3"
          ? "aspect-[4/3]"
          : val === "3:4"
            ? "aspect-[3/4]"
            : "aspect-[16/9]";

  if (dom.imageResolutionSelect && dom.imageResolutionSelect.value !== val) {
    dom.imageResolutionSelect.value = val;
  }
  if (
    dom.videoDirectorAspectSelect &&
    dom.videoDirectorAspectSelect.value !== val
  ) {
    dom.videoDirectorAspectSelect.value = val;
  }

  SubtitleEngine.clearCache();

  // Ensure export resolution setting matches the active aspect ratio
  if (dom.videoExportResolutionSelect) {
    const curResKey = dom.videoExportResolutionSelect.value;
    const matchingKey = getMatchingResolutionKey(val, curResKey);
    if (dom.videoExportResolutionSelect.value !== matchingKey) {
      dom.videoExportResolutionSelect.value = matchingKey;
    }
  }

  const wrappers = document.querySelectorAll(".compact-img-wrapper");
  wrappers.forEach((el) => {
    el.className = el.className
      .replace(/aspect-\[\d+\/\d+\]/g, "")
      .replace(/aspect-square/g, "");
    el.classList.add(aspectClass);
  });

  const inspectorMedia = document.getElementById("inspector-media-container");
  if (inspectorMedia) {
    inspectorMedia.className = inspectorMedia.className
      .replace(/aspect-\[\d+\/\d+\]/g, "")
      .replace(/aspect-square/g, "");
    inspectorMedia.classList.add(aspectClass);
  }

  // Adjust video preview wrapper sizing dynamically and listen to container changes
  resizeVideoPreviewWrapper();
  initPreviewResizeObserver();

  // Redraw current video preview frame to adapt immediately to the new dimensions
  try {
    if (!state.isVideoPlaying) {
      drawVideoFrame(state.lastRenderedTime || 0);
    }
  } catch (err) {
    console.warn("Failed to redraw video frame on aspect ratio change:", err);
  }

  const currentModel =
    dom.imageModelSelect?.value || constants.DEFAULT_IMAGE_MODEL;
  const isReferenceSelected =
    !!state.selectedReferenceImage && currentModel.startsWith("gemini-");
  if (dom.imageResolutionSelect)
    dom.imageResolutionSelect.disabled = isReferenceSelected;

  // Hide text labels for "Timeline Sync" and "Graphic" buttons when space is tight (non 16:9)
  const syncLabel = document.getElementById("timeline-sync-label");
  const graphicLabel = document.getElementById("add-graphic-label");
  if (syncLabel && graphicLabel) {
    if (val === "16:9") {
      syncLabel.classList.remove("hidden");
      graphicLabel.classList.remove("hidden");
    } else {
      syncLabel.classList.add("hidden");
      graphicLabel.classList.add("hidden");
    }
  }
}

export function renderCharacterList(characters: CharacterProfile[]) {
  if (typeof document === 'undefined' || !dom || !dom.characterList) return;
  if (!characters || characters.length === 0) {
    if (dom.characterList) {
      dom.characterList.innerHTML =
        '<p class="text-gray-400 text-center py-4">No characters identified.</p>';
    }
    if (dom.tabCharactersBtn) dom.tabCharactersBtn.disabled = true;
    return;
  }
  if (dom.tabCharactersBtn) dom.tabCharactersBtn.disabled = false;
  dom.characterList.innerHTML = characters
    .map((char, index) => {
      const freq = char.frequency ?? 0;
      const frequencyBadge =
        freq >= 3
          ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 border border-green-700/30">Main Character (${freq}x)</span>`
          : freq > 0
            ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/30">Minor Role (${freq}x)</span>`
            : `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-700 text-gray-400 border border-gray-600">Not Detected</span>`;

      const recommendation =
        freq >= 3
          ? `<p class="text-xs text-green-400 mt-2">✅ Recommended: Keep consistency enabled for this main character.</p>`
          : freq === 1
            ? `<p class="text-xs text-gray-400 mt-2">💡 Tip: This character appears once. Consistency is optional.</p>`
            : "";

      return `
        <div class="p-4 bg-gray-900/50 rounded-xl border ${freq >= 3 ? "border-green-500/30" : "border-gray-700"} space-y-4" data-index="${index}">
            <div class="flex justify-between items-start gap-4">
                <div class="flex-grow">
                    <input type="text" class="character-name-input font-bold text-lg text-yellow-300 bg-transparent border-b border-transparent hover:border-gray-600 focus:border-yellow-500 focus:outline-none w-full" data-index="${index}" value="${escapeHtml(char.name)}" placeholder="Character Name">
                    <div class="mt-1">${frequencyBadge}</div>
                </div>
                <div class="flex items-center gap-4 flex-shrink-0">
                    <label class="flex items-center gap-2 cursor-pointer group">
                        <input type="checkbox" class="consistency-checkbox w-4 h-4 rounded bg-gray-700 border-gray-600 text-indigo-500 focus:ring-2 focus:ring-indigo-500" data-name="${escapeHtml(char.name)}" ${char.enforce_consistency !== false ? "checked" : ""}>
                        <span class="text-xs font-semibold text-gray-300 group-hover:text-indigo-300 transition">Enforce Consistency</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer group border-l border-gray-700 pl-4">
                        <input type="radio" name="universal_character" class="universal-character-radio w-4 h-4 bg-gray-700 border-gray-600 text-yellow-500 focus:ring-2 focus:ring-yellow-500" data-index="${index}" ${char.is_universal ? "checked" : ""}>
                        <span class="text-xs font-semibold ${char.is_universal ? "text-yellow-400" : "text-gray-400"} group-hover:text-yellow-300 transition" title="Inject this character into scenes without named characters.">Universal Protagonist</span>
                    </label>
                    <button class="delete-char-btn text-gray-500 hover:text-red-500 transition border-l border-gray-700 pl-4" data-name="${escapeHtml(char.name)}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </div>
            ${recommendation}
            <div class="flex flex-col sm:flex-row gap-4 pt-4 border-t border-gray-700/50">
                <div class="w-full sm:w-32 h-32 flex-shrink-0 bg-gray-800 border-2 border-dashed border-gray-600 rounded-lg flex items-center justify-center relative group overflow-hidden">
                    ${
                      char.image
                        ? `
                        <img src="data:${char.image.mimeType};base64,${char.image.data}" class="w-full h-full object-cover">
                        <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                            <button class="analyze-char-img-btn text-[10px] uppercase font-bold tracking-wider bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded transition-colors" data-index="${index}">Analyze Image</button>
                            <button class="remove-char-img-btn text-[10px] uppercase font-bold tracking-wider bg-red-600/80 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors" data-index="${index}">Remove</button>
                        </div>
                    `
                        : `<button class="upload-char-img-btn text-gray-500 text-center flex flex-col items-center gap-1" data-index="${index}"><span class="text-xs font-bold">Add Image</span></button>`
                    }
                    <input type="file" id="char-img-input-${index}" class="hidden" accept="image/*" data-index="${index}">
                </div>
                <div class="flex-grow min-w-0">
                    <div>
                        <label for="char-anchor-${index}" class="block text-[10px] uppercase font-bold text-amber-500 tracking-wider mb-1">Core Appearance (Locked)</label>
                        <textarea id="char-anchor-${index}" class="character-anchor-input w-full bg-gray-900 border border-amber-500/20 rounded-lg p-2 text-sm text-white focus:ring-1 focus:ring-amber-500" data-name="${escapeHtml(char.name)}" rows="3">${escapeHtml(char.appearance_anchor || "")}</textarea>
                    </div>
                    <div class="mt-2">
                        <label for="char-aliases-${index}" class="block text-[10px] uppercase font-bold text-gray-400 tracking-wider mb-1">Aliases / First Names (Comma-separated)</label>
                        <input type="text" id="char-aliases-${index}" class="character-aliases-input w-full bg-gray-900 border border-gray-700/60 rounded-lg px-2.5 py-1 text-xs text-gray-200 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500" data-index="${index}" value="${escapeHtml((Array.isArray(char.aliases) && char.aliases.length > 0 ? char.aliases : getCharacterAliases(char, characters).filter((a: string) => a.toLowerCase() !== (char.name || '').toLowerCase())).join(', '))}" placeholder="e.g. Joseph, Bates, Joe, Captain Bates">
                    </div>
                </div>
            </div>
        </div>`;
    })
    .join("");
}

export function renderLocationList(locations: any[]) {
  if (!dom.locationList) return;
  if (locations.length === 0) {
    dom.locationList.innerHTML =
      '<p class="text-gray-400 text-center py-4">No locations identified.</p>';
    if (dom.tabLocationsBtn) dom.tabLocationsBtn.disabled = true;
    return;
  }
  if (dom.tabLocationsBtn) dom.tabLocationsBtn.disabled = false;
  dom.locationList.innerHTML = locations
    .map(
      (loc, index) =>
        `<div class="p-4 bg-gray-900/50 rounded-xl border border-gray-700 space-y-3" data-index="${index}"><h4 class="font-bold text-lg text-green-300">${escapeHtml(loc.name)}</h4><textarea id="loc-desc-${index}" class="location-description-input w-full h-24 bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm" data-name="${escapeHtml(loc.name)}">${escapeHtml(loc.description || "")}</textarea></div>`,
    )
    .join("");
}

export function renderKeyElementList(elements: any[]) {
  if (!dom.keyElementList) return;
  if (elements.length === 0) {
    dom.keyElementList.innerHTML =
      '<p class="text-gray-400 text-center py-4">No elements identified.</p>';
    if (dom.tabElementsBtn) dom.tabElementsBtn.disabled = true;
    return;
  }
  if (dom.tabElementsBtn) dom.tabElementsBtn.disabled = false;
  dom.keyElementList.innerHTML = elements
    .map(
      (elem, index) => `
    <div class="p-4 bg-gray-900/50 rounded-xl border border-gray-700 space-y-4" data-index="${index}">
        <div class="flex justify-between items-start gap-4">
            <h4 class="font-bold text-lg text-cyan-300">${escapeHtml(elem.name)}</h4>
            <div class="flex items-center gap-4">
                <label class="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" class="consistency-checkbox w-4 h-4 rounded bg-gray-700 border-gray-600 text-cyan-500 focus:ring-2 focus:ring-cyan-500" data-name="${escapeHtml(elem.name)}" ${elem.enforce_consistency ? "checked" : ""}>
                    <span class="text-xs font-semibold text-gray-300 group-hover:text-cyan-300 transition">Enforce Consistency</span>
                </label>
                <button class="delete-elem-btn text-gray-500 hover:text-red-500 transition" data-name="${escapeHtml(elem.name)}">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
            </div>
        </div>
        <textarea id="elem-desc-${index}" class="element-description-input w-full h-24 bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm text-white focus:ring-1 focus:ring-cyan-500" data-name="${escapeHtml(elem.name)}">${escapeHtml(elem.description || "")}</textarea>
    </div>`,
    )
    .join("");
}

export function renderVideoClips() {
  if (!dom.videoClipsContainer) return;

  if (!state.currentScenes || state.currentScenes.length === 0) {
    dom.videoClipsContainer.innerHTML =
      '<div class="text-gray-500 text-center col-span-full py-8">No video clips generated yet. Animate shots in the Storyboard to see them here.</div>';
    if (dom.tabVideoClipsBtn) dom.tabVideoClipsBtn.disabled = true;
    return;
  }

  const isPaced =
    state.currentScenes[0] &&
    typeof state.currentScenes[0].shot_number !== "undefined";

  const animatedShots: {
    shot: any;
    shotNumberText: string;
    downloadName: string;
  }[] = [];

  if (isPaced) {
    state.currentScenes.forEach((shot, i) => {
      if (shot._videoObjectURL || shot.video_id) {
        const shotNum = shot.shot_number || i + 1;
        animatedShots.push({
          shot,
          shotNumberText: String(shotNum),
          downloadName: `shot_${String(shotNum).padStart(3, "0")}.mp4`,
        });
      }
    });
  } else {
    state.currentScenes.forEach((scene, i) => {
      const lines = scene.lines || [scene];
      lines.forEach((shot: any, j: number) => {
        if (shot._videoObjectURL || shot.video_id) {
          const sceneNum = String(i + 1).padStart(3, "0");
          const shotNum = String(j + 1).padStart(3, "0");
          animatedShots.push({
            shot,
            shotNumberText: `${i + 1}.${j + 1}`,
            downloadName: `shot_${sceneNum}_${shotNum}.mp4`,
          });
        }
      });
    });
  }

  if (animatedShots.length === 0) {
    dom.videoClipsContainer.innerHTML =
      '<div class="text-gray-500 text-center col-span-full py-8">No video clips generated yet. Animate shots in the Storyboard to see them here.</div>';
    if (dom.tabVideoClipsBtn) dom.tabVideoClipsBtn.disabled = true;
    return;
  }

  if (dom.tabVideoClipsBtn) dom.tabVideoClipsBtn.disabled = false;

  dom.videoClipsContainer.innerHTML = animatedShots
    .map(({ shot, shotNumberText, downloadName }) => {
      const videoSrc = shot._videoObjectURL || "";
      const displaySrc = shot._imageObjectURL || "";

      return `
        <div class="bg-gray-800/50 rounded-xl overflow-hidden border border-gray-700/80 flex flex-col">
            <div class="w-full aspect-[16/9] compact-img-wrapper relative bg-gray-900/50">
                ${
                  videoSrc
                    ? `<video src="${videoSrc}" class="w-full h-full object-cover" autoplay loop muted playsinline></video>`
                    : displaySrc
                      ? `<img src="${displaySrc}" class="w-full h-full object-cover">`
                      : '<div class="w-full h-full flex items-center justify-center text-gray-500">Loading...</div>'
                }
            </div>
            <div class="p-4 flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <span class="text-sm font-bold text-gray-300">Shot ${shotNumberText}</span>
                    <button class="download-clip-btn text-gray-400 hover:text-white transition" title="Download Video" data-video-src="${escapeHtml(videoSrc)}" data-download-name="${escapeHtml(downloadName)}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </button>
                </div>
                <p class="text-xs text-gray-400 line-clamp-2">${escapeHtml(shot.text_reference || shot.line_text || "")}</p>
            </div>
        </div>
        `;
    })
    .join("");
}

async function hydrateShotImage(shot: any, imgElement: HTMLImageElement) {
  if (!shot) return;
  if (shot._imageObjectURL) {
    if (imgElement.src !== shot._imageObjectURL) {
      imgElement.src = shot._imageObjectURL;
    }
    return;
  }
  if (!shot.image_id) return;
  try {
    const blob = await assetStorage.getAsset(shot.image_id);
    if (blob) {
      const objectURL = URL.createObjectURL(blob);
      shot._imageObjectURL = objectURL;
      imgElement.src = objectURL;
      imgElement.classList.add("fade-in");
    }
  } catch (err) {
    console.error("Failed to hydrate shot image:", err);
  }
}

let shotImageObserver: IntersectionObserver | null = null;

export function resetShotImageObserver() {
  if (shotImageObserver) {
    shotImageObserver.disconnect();
    shotImageObserver = null;
  }
}

function getShotImageObserver(): IntersectionObserver | null {
  if (shotImageObserver) return shotImageObserver;
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return null;
  }

  shotImageObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const imgEl = entry.target as HTMLImageElement;
          const id = imgEl.dataset.id;
          if (id) {
            const shot = findShotById(id);
            if (shot && (shot.image_id || shot._imageObjectURL)) {
              hydrateShotImage(shot, imgEl);
            }
          }
          observer.unobserve(imgEl);
        }
      });
    },
    {
      rootMargin: "400px 0px 400px 0px",
    },
  );
  return shotImageObserver;
}

function findShotById(id: string): any {
  if (!state.currentScenes || !state.currentScenes.length) return null;
  const isPaced =
    state.currentScenes[0] &&
    typeof state.currentScenes[0].shot_number !== "undefined";
  if (isPaced) {
    return state.currentScenes.find((s: any) => s.id === id) || null;
  }
  for (const scene of state.currentScenes) {
    const lines = scene.lines || [scene];
    const shot = lines.find((l: any) => l.id === id);
    if (shot) return shot;
  }
  return null;
}

/**
 * Hydrates visible shot images via IntersectionObserver to prevent OOM on 100+ shots.
 */
export function hydrateVisibleShots() {
  const images = document.querySelectorAll(".generated-img[data-id]");
  const observer = getShotImageObserver();

  images.forEach((img) => {
    const imgEl = img as HTMLImageElement;
    const id = imgEl.dataset.id;
    if (!id) return;

    if (observer) {
      observer.observe(imgEl);
    } else {
      const shot = findShotById(id);
      if (shot && (shot.image_id || shot._imageObjectURL)) {
        hydrateShotImage(shot, imgEl);
      }
    }
  });
}

function renderShotItem(
  shot: any,
  sceneIndex: number,
  lineIndex: number,
  isPaced: boolean,
): string {
  const shotNumberText = isPaced
    ? shot.shot_number
    : `${sceneIndex + 1}.${lineIndex + 1}`;
  const narrativeText = shot.text_reference || shot.line_text || "";
  const displaySrc =
    shot._imageObjectURL ||
    (shot.image_id
      ? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%230f172a"/%3E%3Ctext x="50" y="50" dominant-baseline="middle" text-anchor="middle" fill="%23475569" font-size="10"%3ELoading...%3C/text%3E%3C/svg%3E'
      : "");
  const videoSrc = shot._videoObjectURL || "";

  const metadata = shot.characterMetadata;
  const shotFilter = shot.colorFilter || 'none';
  const shotFilterIntensity = typeof shot.colorFilterIntensity === 'number' ? shot.colorFilterIntensity : 100;
  const shotFilterCss = shotFilter !== 'none' ? getShotFilterCss(shotFilter, shotFilterIntensity) : '';
  const shotFilterStyle = shotFilterCss && shotFilterCss !== 'none' ? `style="filter: ${shotFilterCss};"` : '';

  let metadataBadge = "";
  if (metadata) {
    if (metadata.hasCharacter) {
      metadataBadge = `<div class="mt-2 text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 bg-blue-950/80 text-blue-200 border border-blue-800/40" title="${escapeHtml(metadata.reasoning || "")}">
                👤 ${escapeHtml(metadata.characterAge || "")} <span class="text-blue-400 text-[10px]">(${escapeHtml(metadata.sceneType || "")})</span>
            </div>`;
    } else {
      metadataBadge = `<div class="mt-2 text-xs px-2 py-1 rounded-full inline-flex items-center gap-1 bg-purple-950/80 text-purple-200 border border-purple-800/40" title="${escapeHtml(metadata.reasoning || "")}">
                🎨 ${escapeHtml(metadata.sceneType || "")}
            </div>`;
    }
  }
  return `
    <div class="prompt-item bg-slate-900/80 rounded-xl overflow-hidden border border-slate-800 flex flex-col sm:flex-row gap-4 p-4 shadow-lg hover:border-slate-700/80 transition-all" data-scene-index="${sceneIndex}" data-line-index="${lineIndex}" data-id="${shot.id}" title="Shot ${shotNumberText}: ${escapeHtml(narrativeText)}">
        <div class="w-full sm:w-48 aspect-[16/9] compact-img-wrapper flex-shrink-0 relative compact-img-wrapper">
            <div class="img-container w-full h-full bg-slate-950 rounded-lg flex items-center justify-center border border-slate-800 overflow-hidden relative ${displaySrc || videoSrc ? "cursor-grab active:cursor-grabbing hover:border-amber-500/50 transition-colors" : ""}" draggable="${displaySrc || videoSrc ? "true" : "false"}" data-scene-index="${sceneIndex}" data-line-index="${lineIndex}" title="${displaySrc || videoSrc ? "Drag image to another shot to swap" : ""}">
                ${
                  videoSrc
                    ? `<video src="${videoSrc}" ${shotFilterStyle} class="w-full h-full object-cover rounded-lg generated-video" preload="metadata" loop muted playsinline data-id="${shot.id}" onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
                    : displaySrc
                      ? `<img src="${displaySrc}" ${shotFilterStyle} loading="lazy" decoding="async" class="w-full h-full object-cover rounded-lg cursor-pointer generated-img" data-id="${shot.id}">`
                      : ""
                }
                ${
                  shot._isAnimating
                    ? `<div class="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col justify-between p-2.5 rounded-lg border border-fuchsia-500/40 shadow-xl overflow-hidden z-20">
                        <div class="absolute inset-0 bg-gradient-to-tr from-fuchsia-950/40 via-indigo-950/20 to-slate-950/60 animate-pulse"></div>
                        <div class="relative z-10 flex justify-between items-center text-[10px] font-mono text-fuchsia-300 font-bold bg-slate-900/90 px-2 py-0.5 rounded border border-fuchsia-500/30 shadow">
                            <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-fuchsia-400 animate-ping"></span>Veo AI Video</span>
                            <span>~12s est.</span>
                        </div>
                        <div class="relative z-10 w-full space-y-1">
                            <div class="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-fuchsia-500/30">
                                <div class="h-full bg-gradient-to-r from-fuchsia-500 via-purple-500 to-indigo-500 w-2/3 animate-pulse shadow-[0_0_8px_rgba(217,70,239,0.5)]"></div>
                            </div>
                            <div class="flex justify-between items-center text-[9px] font-mono text-slate-300">
                                <span>Rendering Motion</span>
                                <span class="text-fuchsia-400 font-bold">Processing...</span>
                            </div>
                        </div>
                    </div>`
                    : ""
                }
                ${
                  shot._isUploadingVideo
                    ? `<div class="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col justify-between p-2.5 rounded-lg border border-emerald-500/40 shadow-xl overflow-hidden z-20">
                        <div class="relative z-10 flex justify-between items-center text-[10px] font-mono text-emerald-300 font-bold bg-slate-900/90 px-2 py-0.5 rounded border border-emerald-500/30 shadow">
                            <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>Uploading</span>
                            <span>Media</span>
                        </div>
                        <div class="relative z-10 w-full space-y-1">
                            <div class="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-emerald-500/30">
                                <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-400 w-4/5 animate-pulse"></div>
                            </div>
                        </div>
                    </div>`
                    : ""
                }
            </div>
            <div class="compact-shot-badge hidden absolute top-1.5 left-1.5 bg-slate-950/90 backdrop-blur-md text-amber-300 text-[10px] font-extrabold px-2 py-0.5 rounded border border-amber-500/40 shadow">
                Shot ${shotNumberText}
            </div>
        </div>
        <div class="flex-grow flex flex-col gap-3 min-w-0 prompt-details-container">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div class="min-w-0">
                    <span class="shot-number text-sm font-bold text-slate-300">Shot ${shotNumberText}</span>
                    <p class="text-xs italic text-slate-400 mt-0.5 line-clamp-2">"${escapeHtml(narrativeText)}"</p>
                    <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        ${shot.visual_type ? `
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/50" title="Visual Type">
                                🎯 ${escapeHtml(String(shot.visual_type).replace(/_/g, ' '))}
                            </span>` : ''}
                        ${shot.narrative_function ? `
                            <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-purple-950/80 text-purple-300 border border-purple-700/50" title="Narrative Function">
                                📐 ${escapeHtml(String(shot.narrative_function).replace(/_/g, ' '))}
                            </span>` : ''}
                        ${(shot.visual_concept || shot.subjects?.length || shot.action || shot.environment) ? `
                            <button type="button" class="toggle-director-notes-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-amber-300 bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 transition cursor-pointer" title="Toggle Director Reasoning Notes">
                                💡 <span class="truncate max-w-[180px] sm:max-w-xs text-left">${escapeHtml(shot.visual_concept || 'Director Reasoning')}</span>
                                <span class="text-[9px] text-amber-400 font-bold">▾</span>
                            </button>` : ''}
                    </div>
                    ${(shot.visual_concept || shot.subjects?.length || shot.action || shot.environment || shot.composition || shot.continuity_notes) ? `
                    <div class="director-notes-panel hidden mt-2 p-2.5 rounded-lg bg-slate-950/90 border border-indigo-500/30 text-[11px] text-slate-300 space-y-1 font-sans shadow-lg">
                        <div class="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold mb-1 flex items-center justify-between">
                            <span class="flex items-center gap-1">🎬 Visual Director Reasoning</span>
                            ${shot.camera ? `<span class="text-slate-400 font-normal">📷 ${escapeHtml(shot.camera)}</span>` : ''}
                        </div>
                        ${shot.visual_concept ? `<div><span class="text-slate-400 font-medium">Concept:</span> <span class="text-slate-200">${escapeHtml(shot.visual_concept)}</span></div>` : ''}
                        ${shot.action ? `<div><span class="text-slate-400 font-medium">Action:</span> <span class="text-slate-200">${escapeHtml(shot.action)}</span></div>` : ''}
                        ${shot.subjects && shot.subjects.length > 0 ? `<div><span class="text-slate-400 font-medium">Subjects:</span> <span class="text-slate-200">${escapeHtml(shot.subjects.join(', '))}</span></div>` : ''}
                        ${shot.environment ? `<div><span class="text-slate-400 font-medium">Environment:</span> <span class="text-slate-200">${escapeHtml(shot.environment)}</span></div>` : ''}
                        ${shot.composition ? `<div><span class="text-slate-400 font-medium">Composition:</span> <span class="text-slate-200">${escapeHtml(shot.composition)}</span></div>` : ''}
                        ${shot.continuity_notes ? `<div><span class="text-slate-400 font-medium">Continuity:</span> <span class="text-indigo-300 italic">${escapeHtml(shot.continuity_notes)}</span></div>` : ''}
                    </div>` : ''}
                </div>
                <div class="shot-actions flex items-center gap-1 flex-wrap justify-end shrink-0">
                    <button class="save-shot-btn px-2 py-1 bg-emerald-950/80 text-emerald-300 hover:text-white hover:bg-emerald-800/80 border border-emerald-600/50 rounded-md text-xs font-semibold transition-all flex items-center gap-1 shadow-xs shrink-0 cursor-pointer" title="Save shot to project and history">💾 <span class="hidden md:inline">Save</span></button>
                    <button class="map-shot-btn px-2 py-1 bg-sky-950/80 text-sky-300 hover:text-white hover:bg-sky-800/80 border border-sky-600/50 rounded-md text-xs font-semibold transition-all flex items-center gap-1 shadow-xs shrink-0 cursor-pointer" title="Open Map Studio for this shot (animate route/travel)">🗺️ <span class="hidden md:inline">Map</span></button>
                    <button class="inspect-shot-btn px-2 py-1 bg-slate-800/80 text-slate-300 hover:text-amber-300 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs font-semibold transition-all flex items-center gap-1 shrink-0 cursor-pointer" title="Open Metadata Inspector Drawer">🎛️ <span class="hidden md:inline">Inspector</span></button>
                    <button class="swap-shot-btn p-1.5 bg-slate-800/80 text-slate-300 hover:text-amber-300 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs transition-all shrink-0 cursor-pointer" title="Swap Image/Media with another shot">🔄</button>
                    <button class="generate-video-prompt-btn p-1.5 bg-slate-800/80 text-slate-300 hover:text-emerald-300 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs transition-all shrink-0 cursor-pointer" title="Generate Video Prompt">🎬</button>
                    <button class="split-shot-btn p-1.5 bg-slate-800/80 text-slate-300 hover:text-blue-300 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs transition-all shrink-0 cursor-pointer" title="Split Shot">✂️</button>
                    <button class="clear-media-btn p-1.5 bg-slate-800/80 text-slate-400 hover:text-orange-400 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs transition-all shrink-0 cursor-pointer" title="Clear Media Assets">🧹</button>
                    <button class="delete-shot-btn p-1.5 bg-slate-800/80 text-slate-400 hover:text-red-400 hover:bg-slate-700 border border-slate-700/60 rounded-md text-xs transition-all shrink-0 cursor-pointer" title="Delete Shot">🗑️</button>
                </div>
            </div>
            <textarea class="prompt-textarea w-full h-full min-h-[60px] bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg p-2.5 text-sm text-slate-200 transition-all focus:outline-none">${escapeHtml(shot.image_prompt || "")}</textarea>
            <div class="shot-controls flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <button class="generate-btn bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold py-1.5 px-3 rounded-md text-xs flex items-center gap-1 shadow-md shadow-amber-500/10 transition-all shrink-0 cursor-pointer">Image</button>
                <button class="animate-btn bg-gradient-to-r from-fuchsia-600 to-indigo-600 hover:from-fuchsia-500 hover:to-indigo-500 text-white font-bold py-1.5 px-3 rounded-md text-xs flex items-center gap-1 shadow-md ${!displaySrc ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}" ${!displaySrc ? "disabled" : ""} title="Generate Video from Image">🎬 Animate</button>
                <button class="pexels-image-btn bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/70 font-semibold py-1.5 px-2.5 sm:px-3 rounded-md text-xs flex items-center gap-1 transition-all shrink-0 cursor-pointer" title="Fetch Stock Image from Pexels">🖼️ Stock</button>
                <button class="pexels-video-btn bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/70 font-semibold py-1.5 px-2.5 rounded-md text-xs flex items-center gap-1 transition-all shrink-0 cursor-pointer" title="Fetch Stock Video from Pexels">📹 Stock</button>
                <button class="upload-video-btn bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/70 font-semibold py-1.5 px-2.5 rounded-md text-xs flex items-center gap-1 transition-all shrink-0 cursor-pointer" title="Upload Custom Media (replaces media by default)">⬆️ Upload</button>
                ${(displaySrc || videoSrc) ? `<button class="upload-preserve-btn bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/60 font-semibold py-1.5 px-2 rounded-md text-xs flex items-center gap-1 transition-all shrink-0 cursor-pointer" title="Upload 2nd media (A-Roll / Split / PiP) without replacing existing content">⬆️ +2nd</button>` : ''}
                <button class="upload-sfx-btn bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/70 font-semibold py-1.5 px-2.5 rounded-md text-xs flex items-center gap-1 transition-all shrink-0 cursor-pointer" title="Upload Sound Effect">🎵 SFX</button>
                <select class="preset-prompt-select bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/70 font-semibold py-1.5 px-2.5 rounded-md text-xs transition-all cursor-pointer outline-none focus:border-indigo-500 shrink-0" title="Select Animation Preset">
                    <option value="" disabled selected>🎬 Preset</option>
                    <option value="paper_collage">Editorial Paper Collage</option>
                    <option value="paper">Paper Stop-Motion</option>
                    <option value="cinematic">Cinematic Dolly</option>
                    <option value="vhs">Vintage VHS</option>
                </select>
                
                <select class="talking-head-mode-select bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-700/50 font-semibold py-1.5 px-2 rounded-md text-xs transition-all cursor-pointer outline-none focus:border-indigo-400 shrink-0" title="${state.uploadedVideoElement ? 'Talking Head / A-Roll Layer Mode' : 'Upload an A-Roll video to display A-Roll in Full, PiP, or Split layouts'}">
                    <option value="none" ${!shot.talkingHeadMode || shot.talkingHeadMode === "none" ? "selected" : ""}>🖼️ B-Roll Only</option>
                    <option value="full" ${shot.talkingHeadMode === "full" ? "selected" : ""}>👤 Full A-Roll</option>
                    <option value="pip-br" ${shot.talkingHeadMode === "pip-br" ? "selected" : ""}>🎭 PiP BR</option>
                    <option value="pip-bl" ${shot.talkingHeadMode === "pip-bl" ? "selected" : ""}>🎭 PiP BL</option>
                    <option value="pip-tr" ${shot.talkingHeadMode === "pip-tr" ? "selected" : ""}>🎭 PiP TR</option>
                    <option value="pip-tl" ${shot.talkingHeadMode === "pip-tl" ? "selected" : ""}>🎭 PiP TL</option>
                    <option value="split" ${shot.talkingHeadMode === "split" ? "selected" : ""}>🌓 Split</option>
                </select>
                ${shot.talkingHeadMode && shot.talkingHeadMode.startsWith('pip-') ? `
                <select class="talking-head-shape-select bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-700/50 font-semibold py-1.5 px-2 rounded-md text-xs transition-all cursor-pointer outline-none focus:border-indigo-400 shrink-0" title="PiP Shape">
                    <option value="circle" ${shot.talkingHeadShape === 'circle' ? 'selected' : ''}>⭕ Circle</option>
                    <option value="rounded" ${!shot.talkingHeadShape || shot.talkingHeadShape === 'rounded' ? 'selected' : ''}>🟩 Rounded</option>
                    <option value="square" ${shot.talkingHeadShape === 'square' ? 'selected' : ''}>⏹️ Square</option>
                </select>
                <select class="talking-head-size-select bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-indigo-700/50 font-semibold py-1.5 px-2 rounded-md text-xs transition-all cursor-pointer outline-none focus:border-indigo-400 shrink-0" title="PiP Size">
                    <option value="small" ${shot.talkingHeadSize === 'small' ? 'selected' : ''}>S</option>
                    <option value="medium" ${!shot.talkingHeadSize || shot.talkingHeadSize === 'medium' ? 'selected' : ''}>M</option>
                    <option value="large" ${shot.talkingHeadSize === 'large' ? 'selected' : ''}>L</option>
                </select>
                ` : ''}
            </div>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
                ${metadataBadge}
                ${shot.talkingHeadMode && shot.talkingHeadMode !== "none" ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-indigo-950/80 text-indigo-300 border border-indigo-700/50" title="Talking Head: ${escapeHtml(shot.talkingHeadMode)}">👤 ${escapeHtml(shot.talkingHeadMode === "full" ? "Full Video" : shot.talkingHeadMode === "split" ? "Split Screen" : "PiP Overlay")}</span>` : ""}
                ${(shot.secondary_image_id || shot._secondaryImageObjectURL || shot.secondary_video_id || shot._secondaryVideoObjectURL) ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-violet-950/80 text-violet-300 border border-violet-700/50" title="Dual Layer Media attached">✨ Dual Media</span>` : ""}
                ${shot.soloAudio ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-950/80 text-amber-300 border border-amber-700/50" title="Solo Audio Enabled (narration muted on this shot)">🎙️ Solo Audio</span>` : ""}
                ${shot._sfxBuffer ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 bg-indigo-950/80 text-indigo-200 border border-indigo-700/50" title="Sound Effect: ${escapeHtml(shot.sfx_prompt || "")}">🎵 ${escapeHtml(shot.sfx_prompt || "SFX Attached")} <button class="clear-sfx-btn text-indigo-400 hover:text-red-400 font-bold ml-0.5 transition-colors" title="Clear SFX">✕</button></span>` : ""}
                ${shot.duration_seconds ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-950/80 text-amber-200 border border-amber-800/50" title="Shot Duration">⏱️ ${shot.duration_seconds}s</span>` : ""}
                ${(shot._videoObjectURL || shot.video_id) && shot.videoStartOffset && shot.videoStartOffset > 0 ? `<button class="inspect-shot-btn text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-purple-950/90 text-purple-200 border border-purple-600/60 hover:border-purple-400 transition" title="Video Start Offset: ${shot.videoStartOffset.toFixed(1)}s (Click to edit in Inspector)">🎬 In: ${shot.videoStartOffset.toFixed(1)}s</button>` : ""}
                ${shot.colorFilter && shot.colorFilter !== "none" ? `<button class="inspect-shot-btn text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-amber-950/80 text-amber-300 border border-amber-600/60 hover:border-amber-400 transition cursor-pointer" title="Shot Color Grade: ${escapeHtml(shot.colorFilter)} (Click to edit in Inspector)">🎨 ${shot.colorFilter === 'noir' ? '🌑 Noir B&W' : shot.colorFilter === 'noir_grain' ? '📽️ Noir + Grain' : shot.colorFilter === 'vintage' ? '📼 70s Retro' : shot.colorFilter === 'sepia' ? '📜 Sepia' : shot.colorFilter === 'warm' ? '🌅 Golden' : shot.colorFilter === 'cool' ? '❄️ Cool Teal' : shot.colorFilter === 'cyberpunk' ? '🏙️ Cyber' : shot.colorFilter === 'technicolor' ? '🌈 Technicolor' : shot.colorFilter === 'bleach_bypass' ? '🎬 Bleach' : shot.colorFilter === 'moody_dark' ? '🌒 Moody' : shot.colorFilter === 'emerald' ? '🟢 Matrix' : shot.colorFilter === 'crt' ? '📺 CRT' : escapeHtml(shot.colorFilter)}</button>` : ""}
                ${shot.camera_angle && shot.camera_angle !== "default" ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-blue-950/80 text-blue-200 border border-blue-800/50" title="Camera Angle">📷 ${escapeHtml(shot.camera_angle)}</span>` : ""}
                ${shot.lighting_prompt ? `<span class="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-purple-950/80 text-purple-200 border border-purple-800/50 max-w-[200px] truncate" title="Lighting: ${escapeHtml(shot.lighting_prompt)}">💡 ${escapeHtml(shot.lighting_prompt)}</span>` : ""}
            </div>
        </div>
        <div class="compact-card-footer hidden flex justify-between items-center px-1 pt-1 text-xs">
            <span class="font-bold text-amber-400 text-xs">Shot ${shotNumberText}</span>
            <div class="flex items-center gap-1">
                <button class="save-shot-btn p-1 text-emerald-400 hover:text-emerald-300 transition-colors" title="Save shot">💾</button>
                <button class="map-shot-btn p-1 text-sky-400 hover:text-sky-300 transition-colors" title="Open Map Studio for this shot">🗺️</button>
                <button class="inspect-shot-btn p-1 text-slate-400 hover:text-amber-400 transition-colors" title="Open Inspector">🎛️</button>
                <button class="swap-shot-btn p-1 text-slate-400 hover:text-amber-400 transition-colors" title="Swap Shot">🔄</button>
                <button class="generate-btn p-1 text-amber-400 hover:text-amber-300 text-xs font-bold" title="Generate Image">🖼️</button>
                <button class="animate-btn p-1 text-fuchsia-400 hover:text-fuchsia-300 text-xs font-bold ${!displaySrc ? "opacity-40" : ""}" ${!displaySrc ? "disabled" : ""} title="Animate Shot">🎬</button>
            </div>
        </div>
    </div>`;
}

export function renderResultsSkeleton(count: number = 4) {
  if (!dom.resultsContainer) return;
  const skeletonCards = Array.from({ length: count })
    .map(
      (_, i) => `
        <div class="prompt-item bg-slate-900/60 rounded-xl overflow-hidden border border-slate-800 flex flex-col sm:flex-row gap-4 p-4 animate-pulse">
            <div class="w-full sm:w-48 aspect-[16/9] compact-img-wrapper rounded-lg bg-slate-800/70 flex-shrink-0 relative overflow-hidden flex flex-col justify-between p-2 border border-slate-700/40">
                <div class="flex justify-between items-center">
                    <div class="h-3 bg-slate-700/80 rounded w-12"></div>
                    <div class="h-3 bg-amber-500/30 rounded w-16"></div>
                </div>
                <div class="w-full space-y-1">
                    <div class="h-1 w-full bg-slate-700/50 rounded-full overflow-hidden">
                        <div class="h-full bg-amber-500/50 w-2/3"></div>
                    </div>
                </div>
            </div>
            <div class="flex-grow flex flex-col gap-3 min-w-0">
                <div class="flex justify-between items-center">
                    <div class="h-4 bg-slate-800 rounded w-32"></div>
                    <div class="h-5 bg-slate-800 rounded-full w-24"></div>
                </div>
                <div class="h-3.5 bg-slate-800/80 rounded w-4/5"></div>
                <div class="h-16 bg-slate-950/80 rounded-lg border border-slate-800/60 w-full"></div>
                <div class="flex items-center gap-2">
                    <div class="h-8 bg-slate-800 rounded-md w-28"></div>
                    <div class="h-8 bg-amber-500/20 rounded-md w-20 border border-amber-500/30"></div>
                    <div class="h-8 bg-slate-800 rounded-md w-20"></div>
                </div>
            </div>
        </div>
    `,
    )
    .join("");
  dom.resultsContainer.innerHTML = `<div class="space-y-4">${skeletonCards}</div>`;
}

export function renderSparkSkeleton(count: number = 2) {
  if (!dom.sparkResultsContainer) return;
  const cards = Array.from({ length: count })
    .map(
      () => `
        <div class="p-5 bg-slate-900/60 rounded-xl border border-slate-800 animate-pulse space-y-3">
            <div class="h-5 bg-indigo-500/30 rounded w-2/3"></div>
            <div class="space-y-2 pt-1">
                <div class="h-3.5 bg-slate-800 rounded w-full"></div>
                <div class="h-3.5 bg-slate-800 rounded w-11/12"></div>
                <div class="h-3.5 bg-slate-800 rounded w-4/5"></div>
            </div>
            <div class="h-3 bg-indigo-400/20 rounded w-28 pt-2"></div>
        </div>
    `,
    )
    .join("");
  dom.sparkResultsContainer.innerHTML = `<div class="space-y-3">${cards}</div>`;
}

export function renderStyleSkeleton(count: number = 4) {
  if (!dom.styleSuggestionList) return "";
  const items = Array.from({ length: count })
    .map(
      () => `
        <div class="p-4 bg-slate-900/60 rounded-xl border border-slate-800 animate-pulse space-y-2">
            <div class="h-4 bg-teal-500/30 rounded w-1/2"></div>
            <div class="h-3 bg-slate-800 rounded w-full"></div>
            <div class="h-3 bg-slate-800 rounded w-3/4"></div>
        </div>
    `,
    )
    .join("");
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">${items}</div>`;
}

export function renderAssetSkeleton(count: number = 3): string {
  return Array.from({ length: count })
    .map(
      () => `
        <div class="p-4 bg-gray-800/50 rounded-xl border border-gray-700/60 animate-pulse flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-gray-700/50 flex-shrink-0"></div>
            <div class="space-y-2 flex-grow">
                <div class="h-4 bg-gray-700/60 rounded w-1/3"></div>
                <div class="h-3 bg-gray-700/40 rounded w-2/3"></div>
            </div>
        </div>
    `,
    )
    .join("");
}

export function renderBatch(shots: any[], batchNum: number) {
  if (!dom.resultsContainer) return;
  const start = batchNum * 25,
    end = Math.min(start + 25, shots.length);
  const container = dom.resultsContainer.querySelector<HTMLElement>(
    `[data-scene-index="0"] .scene-lines-container`,
  );
  if (!container) return;
  dom.resultsContainer
    .querySelector<HTMLButtonElement>(`.show-more-shots-btn`)
    ?.remove();
  container.insertAdjacentHTML(
    "beforeend",
    shots
      .slice(start, end)
      .map((shot, i) => renderShotItem(shot, 0, start + i, true))
      .join(""),
  );
  if (end < shots.length)
    container.insertAdjacentHTML(
      "beforeend",
      `<button class="show-more-shots-btn w-full text-center py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg" data-is-paced="true" data-next-batch="${batchNum + 1}">Show More</button>`,
    );
  hydrateVisibleShots();
}

export function renderSceneBatch(
  sceneIndex: number,
  lines: any[],
  batchNum: number,
) {
  if (!dom.resultsContainer) return;
  const start = batchNum * 25,
    end = Math.min(start + 25, lines.length);
  const container = dom.resultsContainer.querySelector<HTMLElement>(
    `[data-scene-index="${sceneIndex}"] .scene-lines-container`,
  );
  if (!container) return;
  dom.resultsContainer
    .querySelector<HTMLButtonElement>(
      `.show-more-shots-btn[data-scene-index="${sceneIndex}"]`,
    )
    ?.remove();
  container.insertAdjacentHTML(
    "beforeend",
    lines
      .slice(start, end)
      .map((line, i) => renderShotItem(line, sceneIndex, start + i, false))
      .join(""),
  );
  if (end < lines.length)
    container.insertAdjacentHTML(
      "beforeend",
      `<button class="show-more-shots-btn w-full text-center py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg" data-scene-index="${sceneIndex}" data-next-batch="${batchNum + 1}">Show More</button>`,
    );
  hydrateVisibleShots();
}

export function renderResults(scenes: any[]) {
  if (!dom.resultsContainer) return;
  if (!scenes?.length) {
    dom.resultsContainer.innerHTML = "";
    if (dom.bulkActionsContainer)
      dom.bulkActionsContainer.classList.add("hidden");
    return;
  }
  const isPaced = scenes[0] && typeof scenes[0].shot_number !== "undefined";
  if (isPaced) {
    const existingContainer = dom.resultsContainer.querySelector<HTMLElement>(
      '[data-scene-index="0"] .scene-lines-container',
    );
    const existingCount = existingContainer
      ? existingContainer.querySelectorAll(".prompt-item").length
      : 0;
    const countToRender = Math.max(25, existingCount);
    const renderedShots = scenes.slice(0, countToRender);
    const nextBatch = Math.ceil(renderedShots.length / 25);
    const hasMore = scenes.length > renderedShots.length;

    dom.resultsContainer.innerHTML = `<div class="scene-container space-y-4" data-scene-index="0"><div class="scene-lines-container space-y-4">${renderedShots.map((shot, i) => renderShotItem(shot, 0, i, true)).join("")}</div>${hasMore ? `<button class="show-more-shots-btn w-full py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition text-sm font-medium" data-is-paced="true" data-next-batch="${nextBatch}">Show More</button>` : ""}</div>`;
  } else {
    dom.resultsContainer.innerHTML = scenes
      .map((scene, i) => {
        const lines = scene.lines || [scene];
        const existingContainer =
          dom.resultsContainer.querySelector<HTMLElement>(
            `[data-scene-index="${i}"] .scene-lines-container`,
          );
        const existingCount = existingContainer
          ? existingContainer.querySelectorAll(".prompt-item").length
          : 0;
        const countToRender = Math.max(25, existingCount);
        const renderedLines = lines.slice(0, countToRender);
        const nextBatch = Math.ceil(renderedLines.length / 25);
        const hasMore = lines.length > renderedLines.length;

        return `<div class="scene-container space-y-4" data-scene-index="${i}"><h3 class="scene-title text-xl font-bold p-2 bg-gray-900/50 rounded-lg">Scene ${scene.scene_number}</h3><div class="scene-lines-container space-y-4">${renderedLines.map((line: any, j: number) => renderShotItem(line, i, j, false)).join("")}</div>${hasMore ? `<button class="show-more-shots-btn w-full py-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition text-sm font-medium" data-scene-index="${i}" data-next-batch="${nextBatch}">Show More</button>` : ""}</div>`;
      })
      .join('<hr class="border-gray-700 my-8">');
  }
  updateStoryboardStats();
  renderVideoClips();
  import("./image-studio")
    .then((m) => m.populateShotSelector?.())
    .catch(() => {});
  import("./masterAudioDirector")
    .then((m) => m.populateRhythmTemplateSelectors?.())
    .catch(() => {});
  if (dom.bulkActionsContainer) {
    dom.bulkActionsContainer.classList.remove("hidden");
    if (dom.enableBulkGenerationCheckbox) {
      dom.enableBulkGenerationCheckbox.checked = true;
    }
    if (dom.bulkGenerateBtn) {
      dom.bulkGenerateBtn.disabled = false;
      dom.bulkGenerateBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
    if (dom.bulkAnimateBtn) {
      dom.bulkAnimateBtn.disabled = false;
      dom.bulkAnimateBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
    if (dom.bulkStockBtn) {
      dom.bulkStockBtn.disabled = false;
      dom.bulkStockBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  }
  hydrateVisibleShots();
}

export function updateStoryboardStats() {
  if (!dom.storyboardStats) return;

  const allShots = state.currentScenes.flatMap((s) => s.lines || [s]);
  const shotCount = allShots.length;

  if (shotCount === 0) {
    dom.storyboardStats.classList.add("hidden");
    return;
  }

  // Calculate media/visuals progress (images and videos)
  const imageCount = allShots.filter((s) => !!s.image_id || !!s._imageObjectURL).length;
  const videoCount = allShots.filter((s) => !!s.video_id || !!s._videoObjectURL).length;
  const visualCount = allShots.filter((s) => !!s.image_id || !!s.video_id || !!s._imageObjectURL || !!s._videoObjectURL).length;
  const visualProgress = shotCount > 0 ? (visualCount / shotCount) * 100 : 0;
  const progressColor =
    visualProgress < 50
      ? "bg-amber-500"
      : visualProgress < 100
        ? "bg-blue-500"
        : "bg-green-500";

  // Calculate words accounted for
  const storyText = dom.storyInput.value.trim();
  const totalStoryWords = storyText
    ? storyText.split(/\s+/).filter(Boolean).length
    : 0;
  const totalShotWords = allShots.reduce((acc, shot) => {
    const text = shot.text_reference || shot.line_text || "";
    return acc + text.split(/\s+/).filter(Boolean).length;
  }, 0);
  const wordsAccountedForPercent =
    totalStoryWords > 0
      ? Math.min(100, (totalShotWords / totalStoryWords) * 100)
      : 0;

  // Breakdown subtitle tooltip & badges
  const breakdownTooltip = `${visualCount} of ${shotCount} shots have visuals ready (${imageCount} image${imageCount === 1 ? '' : 's'}, ${videoCount} video${videoCount === 1 ? '' : 's'}).`;

  // Update DOM
  dom.storyboardStats.innerHTML = `
        <span class="text-sm">Shots: <strong class="text-white">${shotCount}</strong></span>
        <span class="text-sm" title="${totalShotWords} of ${totalStoryWords} words from your original story are in the storyboard.">Words Accounted For: <strong class="text-white">${(wordsAccountedForPercent ?? 0).toFixed(0)}%</strong></span>
        <div class="flex items-center gap-2 text-sm" title="${breakdownTooltip}">
            <span>Media</span>
            <div class="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div class="${progressColor} h-full transition-all" style="width: ${visualProgress}%"></div>
            </div>
            <span class="text-gray-300 font-mono text-xs font-semibold">(${visualCount}/${shotCount})</span>
            <span class="text-gray-400 text-xs flex items-center gap-1.5 ml-0.5">
                <span title="${imageCount} image(s)">🖼️ ${imageCount}</span>
                <span title="${videoCount} video(s)">🎥 ${videoCount}</span>
            </span>
        </div>`;
  dom.storyboardStats.classList.remove("hidden");
}

export function openVideoPromptModal(prompt: string) {
  if (dom.videoPromptResult) dom.videoPromptResult.value = prompt;
  if (dom.videoPromptModal) dom.videoPromptModal.classList.remove("hidden");
}
export function openVideoDirectorModal() {
  if (dom.videoDirectorModal) {
    dom.videoDirectorModal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    window.dispatchEvent(new Event('contentgen:video-director-opened'));

    if (dom.saveProjectVideoBtn) {
      dom.saveProjectVideoBtn.disabled = false;
      dom.saveProjectVideoBtn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-xs transition-colors flex items-center gap-1.5 border border-emerald-500/40';
      dom.saveProjectVideoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6a1 1 0 10-2 0v5.586L7.707 10.293zM3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"></path></svg><span>Save</span>`;
    }

    // Sync aspect ratio classes and dimensions after unhiding modal
    updateAspectRatioState();

    import('./handlers-settings').then((m) => m.syncAutoOverlaySfxUI()).catch(() => {});

    // Aggressively free up memory for the video player
    optimizeMemoryForVideoDirector();

    if (state.previewResolution) {
      if (dom.videoPreviewResolutionSelect) dom.videoPreviewResolutionSelect.value = state.previewResolution;
      if (dom.videoCanvasPreviewResolutionSelect) dom.videoCanvasPreviewResolutionSelect.value = state.previewResolution;
    }

    if (state.uploadedVideoElement && timelineState.clips && timelineState.clips.length > 0) {
      const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
      timelineState.clips.forEach((clip: any, idx: number) => {
        if (!clip.talkingHeadVideoElement) {
          clip.talkingHeadVideoElement = state.uploadedVideoElement;
        }
        const matchedShot = allShots.find((s: any) => s.id && s.id === clip.id) || allShots[idx];
        if (matchedShot && matchedShot.talkingHeadMode && (!clip.talkingHeadMode || clip.talkingHeadMode === 'none')) {
          clip.talkingHeadMode = matchedShot.talkingHeadMode;
        }
      });
    }

    requestAnimationFrame(() => {
      resizeVideoPreviewWrapper();
      try {
        if (!state.isVideoPlaying) {
          drawVideoFrame(state.lastRenderedTime || 0);
        }
      } catch (err) {
        console.warn("Failed to redraw video frame on opening director modal:", err);
      }
    });
    // Initialize video effects UI from state
  }
}

export function closeVideoDirectorModal() {
  if (dom.videoDirectorModal) {
    window.dispatchEvent(new Event('contentgen:video-director-closing'));
    dom.videoDirectorModal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");

    // Automatically restore Storyboard media textures and element sources
    import('./memoryManager').then(({ restoreStoryboardFromVideoDirector }) => {
      restoreStoryboardFromVideoDirector().catch(err => {
        console.warn('Failed to restore storyboard media on closing video director:', err);
      });
    });
  }
}
const SLOW_TICK_MS = 100;
const RING = ['ring-2', 'ring-indigo-500'];
let lastSlowTick = 0;
let lastTimeText = '';
let cachedPlayhead: HTMLElement | null = null;
let cachedScroll: HTMLElement | null = null;
let hlEl: Element | null = null;
let hlId: string | null = null;
const activeUiIndex = new ActiveClipIndex();

function liveEl(cached: HTMLElement | null, id: string): HTMLElement | null {
  return cached && cached.isConnected ? cached : (document.getElementById(id) as HTMLElement | null);
}

export function clearStoryboardHighlight() {
  document.querySelectorAll('.prompt-item.ring-2').forEach(el => el.classList.remove(...RING));
  hlEl = null;
  hlId = null;
}

function syncStoryboardHighlight(currentTime: number) {
  const clips = videoRenderContext?.clips;
  if (!dom.timelineSyncToggle?.checked || !clips) {
    if (hlEl || hlId) clearStoryboardHighlight();
    return;
  }
  let curId: string | null = null;
  if (timelineState.mode === 'audio_locked') {
    activeUiIndex.ensure(clips, timelineState.clipsVersion);
    const i = activeUiIndex.find(currentTime);
    curId = i >= 0 ? clips[i].id : null;
  } else {
    let cum = 0;
    for (const clip of clips) {
      if (currentTime >= cum && currentTime < cum + clip.duration) { curId = clip.id; break; }
      cum += clip.duration;
    }
  }
  // Nothing changed and the card is still in the DOM: do no DOM work at all.
  if (curId === hlId && hlEl && hlEl.isConnected) return;
  clearStoryboardHighlight();
  if (!curId) return;
  const escapedId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(String(curId)) : String(curId).replace(/['"\\]/g, '\\$&');
  const el = document.querySelector(`.prompt-item[data-id='${escapedId}']`);
  if (!el) return;
  el.classList.add(...RING);
  hlEl = el;
  hlId = curId;
  if (document.getElementById('results-container')?.closest('.overflow-y-auto')) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export function updateVideoTime(currentTime: number, totalDuration: number) {
  const s0 = t0();
  const pct = totalDuration > 0 ? Math.max(0, Math.min(100, (currentTime / totalDuration) * 100)) : 0;

  // FAST PART: every call. Writes only, no layout reads.
  if (dom.videoProgressBar) dom.videoProgressBar.style.width = `${pct}%`;
  const t = formatTime(currentTime);
  if (dom.videoCurrentTime && t !== lastTimeText) {
    dom.videoCurrentTime.textContent = t;
    lastTimeText = t;
  }
  if (dom.videoTotalTime && totalDuration > 0) {
    const tt = formatTime(totalDuration);
    if (dom.videoTotalTime.textContent !== tt) dom.videoTotalTime.textContent = tt;
  }
  cachedPlayhead = liveEl(cachedPlayhead, 'timeline-playhead');
  if (cachedPlayhead) {
    const x = Math.max(0, currentTime * getPixelsPerSecond());
    cachedPlayhead.style.transform = `translateX(${x}px)`;
    cachedPlayhead.style.display = totalDuration > 0 ? 'block' : 'none';
  }

  // SLOW PART: at most every 100 ms while playing; every call when paused or seeking.
  const now = performance.now();
  if (state.isVideoPlaying && now - lastSlowTick < SLOW_TICK_MS) {
    t1('ui.updateVideoTime', s0);
    return;
  }
  lastSlowTick = now;

  // Keep the playhead in view during playback (auto-scroll)
  cachedScroll = liveEl(cachedScroll, 'timeline-multi-track-scroll');
  const scrollContainer = cachedScroll;
  if (scrollContainer && state.isVideoPlaying) {
    const x = currentTime * getPixelsPerSecond();
    const scrollLeft = scrollContainer.scrollLeft;
    const clientWidth = scrollContainer.clientWidth;
    if (x > scrollLeft + clientWidth * 0.85 || x < scrollLeft) {
      scrollContainer.scrollLeft = Math.max(0, x - clientWidth * 0.2);
    }
  }

  // Navigation sliders and labels (unchanged logic from the old section 4)
  document.querySelectorAll<HTMLInputElement>('#timeline-scrub-slider').forEach(slider => {
    if (document.activeElement !== slider) slider.value = pct.toFixed(2);
  });
  document.querySelectorAll('#timeline-header-current-time, #timeline-nav-current-time').forEach(el => {
    el.textContent = `${currentTime.toFixed(1)}s`;
  });
  document.querySelectorAll('#timeline-header-total-time, #timeline-nav-total-time').forEach(el => {
    el.textContent = `${totalDuration.toFixed(1)}s`;
  });
  if (dom.timelineScrollSlider && scrollContainer && document.activeElement !== dom.timelineScrollSlider) {
    const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
    if (maxScroll > 0) {
      const scrollPct = (scrollContainer.scrollLeft / maxScroll) * 100;
      dom.timelineScrollSlider.value = scrollPct.toFixed(1);
    } else {
      dom.timelineScrollSlider.value = "0";
    }
  }
  if (dom.timelineZoomSlider && document.activeElement !== dom.timelineZoomSlider) {
    dom.timelineZoomSlider.value = (timelineState.zoomLevel || 1.0).toFixed(2);
  }

  // Storyboard highlight: replaces the old 'Storyboard Active Shot Auto-Scroll and Highlight Sync' section
  syncStoryboardHighlight(currentTime);
  t1('ui.updateVideoTime', s0);
}

export function renderBrollEditor(
    transcript: { words: any[] },
    audio: AudioBuffer | null,
  ) {
    if (!audio || !dom.bRollEditorWorkspace) return;
    const beats = timelineState.timelineSnapPoints || [];
    const hasWords = Boolean(transcript?.words && transcript.words.length > 0);
    if (!hasWords && beats.length === 0) return;

    if (dom.videoDirectorMainView)
      dom.videoDirectorMainView.classList.add("hidden");
    dom.bRollEditorWorkspace.classList.remove("hidden");
    if (dom.bRollAudioPlayer)
      dom.bRollAudioPlayer.src = URL.createObjectURL(
        audioBufferToWavBlob(audio),
      );

    const words = transcript?.words || [];
    const validBeats = (state.uploadIntent === 'music') ? beats : [];
    if (dom.bRollTranscriptContainer)
      dom.bRollTranscriptContainer.innerHTML = words.length
        ? words.map((word, index) =>
            `<span class="b-roll-word" data-start="${word.start}" data-end="${word.end}" data-index="${index}">${escapeHtml(word.word)}</span>`).join(" ")
        : validBeats.map((t, index) =>
            `<span class="b-roll-word" data-start="${t}" data-end="${t}" data-index="${index}" title="beat @ ${t.toFixed(2)}s">🎵</span>`).join(" ");

    const allShots = state.currentScenes.flatMap((s) => s.lines || [s]);
    const shotItemsHtml = allShots
        .filter((shot) => shot.image_id)
        .map((shot, index) => {
          const text = shot.text_reference || shot.line_text || "";
          return `
        <div class="b-roll-item relative group" data-used="false" data-index="${index}" title="${escapeHtml(text)}">
            <div class="b-roll-thumb"><img src="${shot._imageObjectURL || ""}" class="generated-img" data-id="${shot.id}"></div>
            <div class="b-roll-text-overlay">${escapeHtml(text)}</div>
        </div>`;
        })
        .join("");

    const registryItemsHtml: string[] = [];
    state.bRollSourceRegistry?.forEach((v, id) => {
        registryItemsHtml.push(`
        <div class="b-roll-item relative group" data-used="false" title="${escapeHtml(v.label || id)}">
            <div class="b-roll-thumb">${v.videoObjectURL
                ? `<video src="${v.videoObjectURL}" class="generated-img" data-id="${id}" muted preload="metadata"></video>`
                : `<img src="${v.imageObjectURL}" class="generated-img" data-id="${id}">`}</div>
            <div class="b-roll-text-overlay">${escapeHtml(v.label || 'Imported')}</div>
        </div>`);
    });

    if (dom.bRollBinContainer)
      dom.bRollBinContainer.innerHTML = shotItemsHtml + registryItemsHtml.join('');
    if (dom.bRollWordCount)
      dom.bRollWordCount.textContent = hasWords ? `${transcript.words.length} words` : `${beats.length} beats (Music Mode)`;
    // Hydrate images from IndexedDB for shots whose ObjectURL has expired
    hydrateVisibleShots();
  }

  export function renderTimelineEditor() {
    const hasClips = Boolean(videoRenderContext?.clips?.length);

    if (!hasClips) {
      if (dom.timelineEditorContainer && !timelineState.drawerUserOpen) {
        dom.timelineEditorContainer.classList.add("hidden");
      }
      if (dom.storyboardTimelineDurationBadge)
        dom.storyboardTimelineDurationBadge.classList.add("hidden");
      if (!timelineState.drawerUserOpen) return;
    } else {
      // Auto-open the drawer once when clips first exist, so the timeline is
      // visible right after production (user can still close it afterwards).
      if (!timelineState.drawerUserOpen && !(state as any)._timelineAutoOpened) {
        (state as any)._timelineAutoOpened = true;
        timelineState.setDrawerUserOpen(true);
      }
      if (dom.timelineEditorContainer && timelineState.drawerUserOpen) {
        dom.timelineEditorContainer.classList.remove("hidden");
      }
    }

    const totalDuration = videoRenderContext?.totalDuration ?? 0;
    const clips = videoRenderContext?.clips ?? [];
    const pps = getPixelsPerSecond();

    // Update Timeline Drawer metrics & badges
    const formattedDur = `${(totalDuration ?? 0).toFixed(1)}s`;
    if (dom.timelineArollRhythmSelect) {
      if (!dom.timelineArollRhythmSelect.children.length) {
        dom.timelineArollRhythmSelect.innerHTML = generateRhythmOptionsHtml(state.selectedRhythmTemplateId || 'youtube_essay');
      }
      dom.timelineArollRhythmSelect.value = state.selectedRhythmTemplateId || 'youtube_essay';
    }
    if (dom.timelineDurationBadge)
      dom.timelineDurationBadge.textContent = formattedDur;
    if (dom.timelineClipsBadge)
      dom.timelineClipsBadge.textContent = `${clips.length} Shot${clips.length === 1 ? "" : "s"}`;
    if (dom.storyboardTimelineDurationBadge) {
      dom.storyboardTimelineDurationBadge.textContent = formattedDur;
      dom.storyboardTimelineDurationBadge.classList.remove("hidden");
    }
    if (dom.timelinePacingBadge) {
      const isLocked = timelineState.mode === "audio_locked";
      if (state.musicMode && state.detectedBpm) {
        dom.timelinePacingBadge.textContent = `🥁 Beat Sync (≈${state.detectedBpm} BPM)`;
        dom.timelinePacingBadge.className = "px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full hidden sm:inline-block font-mono";
      } else if (state.musicMode) {
        dom.timelinePacingBadge.textContent = "🎵 Music Mode";
        dom.timelinePacingBadge.className = "px-2 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full hidden sm:inline-block";
      } else {
        dom.timelinePacingBadge.textContent = isLocked
          ? "🎵 Audio Sync"
          : "⏱️ Free Pacing";
        dom.timelinePacingBadge.className = isLocked
          ? "px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full hidden sm:inline-block"
          : "px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full hidden sm:inline-block";
      }
    }

    if (dom.timelineClipsContainer) {
      // Cap at 8,000,000px to prevent Safari/WebKit and Blink layout engine collapses
      const MAX_CSS_WIDTH = 8000000;
      const trackWidth = Math.min(MAX_CSS_WIDTH, Math.max(600, totalDuration * pps));
      const graphicsEvents = timelineState.graphics || [];
      const isSfxEvent = (ev: any) => Boolean(
        (ev.sfxTrigger && ev.sfxTrigger !== 'none' && (ev.id?.startsWith('sfx_') || ev.title?.includes('SFX') || ev.isSfxOnly)) ||
        ev.type === 'sfxCue'
      );
      const visualEvents = graphicsEvents.filter(ev => !isSfxEvent(ev));
      const sfxEvents = graphicsEvents.filter(ev => isSfxEvent(ev));

      // N-TRACK LAYERING LOGIC FOR OVERLAYS (V2, V3...)
      const overlayTracks: (typeof visualEvents)[] = [];
      visualEvents.forEach((ev) => {
        let placed = false;
        for (let i = 0; i < overlayTracks.length; i++) {
          const overlaps = overlayTracks[i].some((existing) => {
            return (
              Math.max(ev.start ?? 0, existing.start ?? 0) <
              Math.min(ev.end ?? 0, existing.end ?? 0)
            );
          });
          if (!overlaps) {
            overlayTracks[i].push(ev);
            (ev as any)._trackIndex = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          overlayTracks.push([ev]);
          (ev as any)._trackIndex = overlayTracks.length - 1;
        }
      });
      const overlayTracksCount = Math.max(1, overlayTracks.length);
      const overlayContainerHeight = Math.max(56, overlayTracksCount * 48);

      let scrollContainer = dom.timelineClipsContainer.querySelector(
        "#timeline-multi-track-scroll",
      ) as HTMLElement;

      // DOM VIRTUALIZATION INITIALIZATION
      if (!scrollContainer) {
        dom.timelineClipsContainer.innerHTML = `
        <div class="flex flex-col h-full w-full relative select-none overflow-hidden">
            <div class="flex flex-grow w-full relative overflow-hidden min-h-0">
                <!-- Track Header Labels Sidebar (CapCut / HyperFrames Studio Style) -->
                <div id="timeline-track-headers" class="track-headers flex flex-col w-32 sm:w-44 bg-[#0e0e16] border-r border-white/10 text-[10px] font-semibold text-gray-300 flex-shrink-0 z-30 shadow-xl h-full overflow-hidden">
                </div>
                
                <!-- Scrollable Multi-Track Container -->
                <div id="timeline-multi-track-scroll" class="flex-grow overflow-auto p-0 custom-scrollbar bg-[#07070c] relative h-full">
                    <div id="timeline-multi-track-container" class="timeline-track timeline-multi-track-container relative flex flex-col shrink-0 min-h-full" style="width: ${trackWidth}px">
                        <!-- Top Time Ruler (Sticky) -->
                        <div id="timeline-ruler" class="timeline-ruler sticky top-0 z-30 h-7 bg-[#11121d]/95 border-b border-white/10 cursor-pointer backdrop-blur-md relative overflow-hidden" title="Click or drag to scrub playhead"></div>
                        <div id="track-overlays-container" class="timeline-track-row relative border-b border-white/10 bg-black/20 overflow-visible shrink-0"></div>
                        <div id="track-video-container" class="timeline-track-row relative h-16 border-b border-white/10 bg-black/30 flex items-center shrink-0"></div>
                        <div id="track-captions-container" class="timeline-track-row relative h-10 border-b border-white/10 bg-black/20 flex items-center overflow-hidden shrink-0"></div>
                        <div id="track-audio-container" class="timeline-track-row relative h-10 border-b border-white/10 bg-black/40 flex items-center overflow-hidden shrink-0">
                            <canvas id="timeline-waveform" class="absolute top-0 left-0 h-full pointer-events-none opacity-50 z-0"></canvas>
                        </div>
                        <div id="track-music-container" class="timeline-track-row relative h-10 border-b border-white/10 bg-black/30 flex items-center overflow-hidden shrink-0">
                            <canvas id="timeline-music-waveform" class="absolute top-0 left-0 h-full pointer-events-none opacity-50 z-0"></canvas>
                        </div>
                        <div id="track-sfx-container" class="timeline-track-row relative h-10 bg-black/40 flex items-center overflow-hidden shrink-0"></div>
                        <!-- Full-Height Playhead with Glowing Diamond Needle -->
                        <div id="timeline-playhead" class="timeline-playhead absolute top-0 bottom-0 z-40 pointer-events-none w-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]">
                            <div class="w-3 h-3 bg-cyan-400 rotate-45 -ml-1.25 -mt-1 shadow-md"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
          `;
        scrollContainer = dom.timelineClipsContainer.querySelector(
          "#timeline-multi-track-scroll",
        ) as HTMLElement;
        const headersEl = dom.timelineClipsContainer?.querySelector(
          "#timeline-track-headers",
        ) as HTMLElement;

        scrollContainer.addEventListener("scroll", () => {
          if (headersEl) headersEl.scrollTop = scrollContainer.scrollTop;
          if (dom.timelineScrollSlider && document.activeElement !== dom.timelineScrollSlider) {
            const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
            if (maxScroll > 0) {
              const scrollPct = (scrollContainer.scrollLeft / maxScroll) * 100;
              dom.timelineScrollSlider.value = scrollPct.toFixed(1);
            }
          }
          if (
            document.querySelector(".timeline-clip.dragging") ||
            document.querySelector(".timeline-overlay-clip.dragging") ||
            document.querySelector(".resize-handle.dragging")
          )
            return;

          if (timelineScrollRafId !== null) return;
          timelineScrollRafId = requestAnimationFrame(() => {
            timelineScrollRafId = null;
            renderTimelineVisibleItems(
              latestTimelineStateCache.totalDuration,
              latestTimelineStateCache.clips,
              latestTimelineStateCache.graphicsEvents,
              latestTimelineStateCache.pps,
              latestTimelineStateCache.trackWidth,
            );
          });
        });

        // Forward wheel scrolling from headers sidebar to tracks container
        if (headersEl) {
          headersEl.addEventListener(
            "wheel",
            (e) => {
              if (scrollContainer) {
                scrollContainer.scrollTop += e.deltaY;
                e.preventDefault();
              }
            },
            { passive: false },
          );
        }

        const trackContainer = scrollContainer.querySelector(
          "#timeline-multi-track-container",
        ) as HTMLElement;
        if (trackContainer) {
          trackContainer.addEventListener("click", handleTimelineClick);
          trackContainer.addEventListener("mousedown", handleTimelineMouseDown);
        }
      } else {
        const trackContainer = scrollContainer.querySelector(
          "#timeline-multi-track-container",
        ) as HTMLElement;
        if (trackContainer) trackContainer.style.width = `${trackWidth}px`;
      }

      // Dynamic asset presence checks for tracks
      const hasOverlays = visualEvents.length > 0 || Boolean((timelineState as any).overlaysTrack && (timelineState as any).overlaysTrack.length > 0);
      const hasCaptions = Boolean(
        (state as any).videoSubtitlesEnabled ||
        ((state as any).effectiveSubtitles && (state as any).effectiveSubtitles.length > 0) ||
        ((state as any).videoSubtitlesText && (state as any).videoSubtitlesText.trim().length > 0) ||
        (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) ||
        ((state as any).wordTimestamps && (state as any).wordTimestamps.length > 0) ||
        ((state as any).currentSubtitles && (state as any).currentSubtitles.length > 0) ||
        (state.masterAudioTranscript && state.masterAudioTranscript.length > 0)
      );
      const hasAudio = Boolean(
        timelineState.masterAudioBuffer ||
        (state as any).masterAudioBuffer ||
        state.uploadedAudioBuffer ||
        (state as any).uploadedAudioElement ||
        (state as any).masterAudioUrl ||
        (state as any).audioState?.masterAudioUrl ||
        (timelineState as any).masterAudioAssetId ||
        (state.masterAudioTranscript && state.masterAudioTranscript.length > 0) ||
        (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) ||
        ((timelineState as any).audioTrack && (timelineState as any).audioTrack.length > 0) ||
        ((state as any).masterAudioTrack && (state as any).masterAudioTrack.length > 0) ||
        clips.some((c: any) => Boolean(c.audioBuffer || c.audioUrl || c.narrationAudioUrl || c.voiceAudioBuffer))
      );
      const hasMusic = Boolean(
        (state as any).musicAudioBuffer ||
        (state as any).musicMode ||
        (state as any).musicAudioUrl ||
        (state as any).audioState?.musicUrl ||
        ((state as any).musicAudioTrack && (state as any).musicAudioTrack.length > 0) ||
        ((timelineState as any).musicTrack && (timelineState as any).musicTrack.length > 0)
      );
      const hasSfx = Boolean(
        sfxEvents.length > 0 ||
        (state as any).sfxAudioBuffer ||
        (state as any).audioState?.sfxUrl ||
        ((state as any).sfxAudioTrack && (state as any).sfxAudioTrack.length > 0)
      );

      const activeTracksCount = 1 + (hasOverlays ? overlayTracksCount : 0) + (hasCaptions ? 1 : 0) + (hasAudio ? 1 : 0) + (hasMusic ? 1 : 0) + (hasSfx ? 1 : 0);

      // Adjust timeline container height to fit active tracks dynamically (no empty black space)
      if (dom.timelineEditorContainer && !dom.timelineEditorContainer.classList.contains('is-collapsed')) {
        const activeHeight = 36 + 28 + (hasOverlays ? overlayContainerHeight : 0) + 64 + (hasCaptions ? 40 : 0) + (hasAudio ? 40 : 0) + (hasMusic ? 40 : 0) + (hasSfx ? 40 : 0) + 16;
        dom.timelineEditorContainer.style.height = `${Math.min(380, Math.max(140, activeHeight))}px`;
      }

      // Update Header HTML (N-Track support with CapCut / HyperFrames Studio Controls)
      const trackHeaders = dom.timelineClipsContainer.querySelector(
        "#timeline-track-headers",
      ) as HTMLElement;
      if (trackHeaders) {
        const isOverlaysHidden = timelineState.isTrackHidden('overlays');
        const isOverlaysLocked = timelineState.isTrackLocked('overlays');
        const isVideoHidden = timelineState.isTrackHidden('video');
        const isVideoLocked = timelineState.isTrackLocked('video');
        const isCaptionsHidden = timelineState.isTrackHidden('captions');
        const isCaptionsLocked = timelineState.isTrackLocked('captions');
        const isAudioHidden = timelineState.isTrackHidden('audio');
        const isAudioLocked = timelineState.isTrackLocked('audio');
        const isMusicHidden = timelineState.isTrackHidden('music');
        const isMusicLocked = timelineState.isTrackLocked('music');
        const isSfxHidden = timelineState.isTrackHidden('sfx');
        const isSfxLocked = timelineState.isTrackLocked('sfx');

        let overlaysHeaderHtml = "";
        if (hasOverlays) {
          for (let i = 0; i < overlayTracksCount; i++) {
            const label = `V${overlayTracksCount - i + 1} Overlays`;
            overlaysHeaderHtml += `
                  <div class="flex items-center justify-between px-2.5 sm:px-3 border-b border-white/10 text-amber-300 bg-amber-950/20 shrink-0 hover:bg-amber-950/30 transition-colors" style="height: ${i === 0 ? Math.max(48, overlayContainerHeight - (overlayTracksCount - 1) * 48) : 48}px;">
                      <div class="flex items-center gap-1.5 truncate">
                          <span class="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
                          <span class="truncate font-semibold text-[11px] text-amber-200">${label}</span>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                          <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isOverlaysHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="overlays" title="${isOverlaysHidden ? 'Show Track Overlays' : 'Hide Track Overlays'}">
                              ${isOverlaysHidden ? '👁‍🗨' : '👁'}
                          </button>
                          <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isOverlaysLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="overlays" title="${isOverlaysLocked ? 'Unlock Track' : 'Lock Track'}">
                              ${isOverlaysLocked ? '🔒' : '🔓'}
                          </button>
                          ${i === 0 ? `<button class="track-add-btn text-[11px] bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white px-1.5 py-0.5 rounded border border-amber-500/40 transition-colors cursor-pointer font-bold" data-track-key="overlays" title="Add Motion Graphic Overlay at Playhead">+</button>` : ""}
                      </div>
                  </div>`;
          }
        }

        const captionsHeaderHtml = hasCaptions ? `
              <div class="h-10 shrink-0 flex items-center justify-between px-2.5 sm:px-3 border-b border-white/10 text-cyan-300 bg-cyan-950/20 hover:bg-cyan-950/30 transition-colors">
                  <div class="flex items-center gap-1.5 truncate">
                      <span class="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span>
                      <span class="truncate font-semibold text-[11px] text-cyan-200">Captions</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                      <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isCaptionsHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="captions" title="${isCaptionsHidden ? 'Show Subtitles' : 'Hide Subtitles'}">
                          ${isCaptionsHidden ? '👁‍🗨' : '👁'}
                      </button>
                      <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isCaptionsLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="captions" title="${isCaptionsLocked ? 'Unlock Track' : 'Lock Track'}">
                          ${isCaptionsLocked ? '🔒' : '🔓'}
                      </button>
                      <button class="track-add-btn text-[11px] bg-cyan-500/20 hover:bg-cyan-500 text-cyan-300 hover:text-white px-1.5 py-0.5 rounded border border-cyan-500/40 transition-colors cursor-pointer font-bold" data-track-key="captions" title="Edit or Add Captions">+</button>
                  </div>
              </div>` : '';

        const audioHeaderHtml = hasAudio ? `
              <div class="h-10 shrink-0 flex items-center justify-between px-2.5 sm:px-3 border-b border-white/10 text-emerald-300 bg-emerald-950/20 hover:bg-emerald-950/30 transition-colors">
                  <div class="flex items-center gap-1.5 truncate">
                      <span class="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                      <span class="truncate font-semibold text-[11px] text-emerald-200">A1 Voiceover</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                      <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isAudioHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="audio" title="${isAudioHidden ? 'Unmute Voiceover' : 'Mute Voiceover'}">
                          ${isAudioHidden ? '🔇' : '🔊'}
                      </button>
                      <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isAudioLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="audio" title="${isAudioLocked ? 'Unlock Track' : 'Lock Track'}">
                          ${isAudioLocked ? '🔒' : '🔓'}
                      </button>
                      <button class="track-add-btn text-[11px] bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-white px-1.5 py-0.5 rounded border border-emerald-500/40 transition-colors cursor-pointer font-bold" data-track-key="audio" title="Open Voiceover Studio">+</button>
                  </div>
              </div>` : '';

        const musicHeaderHtml = hasMusic ? `
              <div class="h-10 shrink-0 flex items-center justify-between px-2.5 sm:px-3 border-b border-white/10 text-purple-300 bg-purple-950/20 hover:bg-purple-950/30 transition-colors">
                  <div class="flex items-center gap-1.5 truncate">
                      <span class="w-2 h-2 rounded-full bg-purple-400 shrink-0"></span>
                      <span class="truncate font-semibold text-[11px] text-purple-200">A2 Music</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                      <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isMusicHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="music" title="${isMusicHidden ? 'Unmute Music' : 'Mute Music'}">
                          ${isMusicHidden ? '🔇' : '🔊'}
                      </button>
                      <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isMusicLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="music" title="${isMusicLocked ? 'Unlock Track' : 'Lock Track'}">
                          ${isMusicLocked ? '🔒' : '🔓'}
                      </button>
                      <button class="track-add-btn text-[11px] bg-purple-500/20 hover:bg-purple-500 text-purple-300 hover:text-white px-1.5 py-0.5 rounded border border-purple-500/40 transition-colors cursor-pointer font-bold" data-track-key="music" title="Add Background Music">+</button>
                  </div>
              </div>` : '';

        const sfxHeaderHtml = hasSfx ? `
              <div class="h-10 shrink-0 flex items-center justify-between px-2.5 sm:px-3 text-amber-300 bg-amber-950/20 hover:bg-amber-950/30 transition-colors">
                  <div class="flex items-center gap-1.5 truncate">
                      <span class="w-2 h-2 rounded-full bg-amber-400 shrink-0"></span>
                      <span class="truncate font-semibold text-[11px] text-amber-200">A3 Sound Effects</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                      <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isSfxHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="sfx" title="${isSfxHidden ? 'Unmute Sound Effects' : 'Mute Sound Effects'}">
                          ${isSfxHidden ? '🔇' : '🔊'}
                      </button>
                      <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isSfxLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="sfx" title="${isSfxLocked ? 'Unlock Track' : 'Lock Track'}">
                          ${isSfxLocked ? '🔒' : '🔓'}
                      </button>
                      <button class="track-add-btn text-[11px] bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white px-1.5 py-0.5 rounded border border-amber-500/40 transition-colors cursor-pointer font-bold" data-track-key="sfx" title="Add Sound Effect Cue at Playhead">+</button>
                  </div>
              </div>` : '';

        trackHeaders.innerHTML = `
              <!-- Track Details Corner Box -->
              <div class="h-7 shrink-0 flex items-center justify-between px-3 border-b border-white/10 text-[10px] font-mono text-gray-400 bg-[#090a10] uppercase tracking-wider">
                  <span>Track Details</span>
                  <span class="text-[9px] text-gray-500">${activeTracksCount} Active Track${activeTracksCount === 1 ? '' : 's'}</span>
              </div>
              ${overlaysHeaderHtml}
              <div class="h-16 shrink-0 flex items-center justify-between px-2.5 sm:px-3 border-b border-white/10 text-indigo-300 bg-indigo-950/20 hover:bg-indigo-950/30 transition-colors">
                  <div class="flex items-center gap-1.5 truncate">
                      <span class="w-2 h-2 rounded-full bg-indigo-400 shrink-0"></span>
                      <span class="truncate font-semibold text-[11px] text-indigo-200">V1 Video Shots</span>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                      <button class="track-vis-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isVideoHidden ? 'text-rose-400 bg-rose-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="video" title="${isVideoHidden ? 'Show Video Track' : 'Hide Video Track'}">
                          ${isVideoHidden ? '👁‍🗨' : '👁'}
                      </button>
                      <button class="track-lock-btn p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${isVideoLocked ? 'text-amber-400 bg-amber-950/60' : 'text-gray-400 hover:text-white'}" data-track-key="video" title="${isVideoLocked ? 'Unlock Track' : 'Lock Track'}">
                          ${isVideoLocked ? '🔒' : '🔓'}
                      </button>
                      <button class="track-add-btn text-[11px] bg-indigo-500/20 hover:bg-indigo-500 text-indigo-300 hover:text-white px-1.5 py-0.5 rounded border border-indigo-500/40 transition-colors cursor-pointer font-bold" data-track-key="video" title="Add New Shot to Video Track">+</button>
                  </div>
              </div>
              ${captionsHeaderHtml}
              ${audioHeaderHtml}
              ${musicHeaderHtml}
              ${sfxHeaderHtml}
          `;

        // Attach listeners for Track Header Buttons
        trackHeaders.querySelectorAll<HTMLButtonElement>('.track-vis-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackKey = btn.getAttribute('data-track-key');
            if (trackKey) {
              const isHidden = timelineState.toggleTrackVisibility(trackKey);
              if (trackKey === 'captions') {
                (timelineState as any)._showSubtitles = !isHidden;
              }
              renderTimelineEditor();
              import('./videoRenderer').then(m => m.drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0));
              showStatus(`${isHidden ? 'Hidden/Muted' : 'Showing'} track: ${trackKey}`, false, 1500);
            }
          });
        });

        trackHeaders.querySelectorAll<HTMLButtonElement>('.track-lock-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackKey = btn.getAttribute('data-track-key');
            if (trackKey) {
              const isLocked = timelineState.toggleTrackLock(trackKey);
              renderTimelineEditor();
              showStatus(`${isLocked ? 'Locked' : 'Unlocked'} track: ${trackKey}`, false, 1500);
            }
          });
        });

        trackHeaders.querySelectorAll<HTMLButtonElement>('.track-add-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const trackKey = btn.getAttribute('data-track-key');
            const curTime = state.lastRenderedTime || state.videoPauseTime || 0;
            if (trackKey === 'overlays') {
              switchTab('graphics');
              openGraphicEditor(undefined, curTime);
            } else if (trackKey === 'video') {
              import('./handlers-story').then(m => m.addSingleBlankShot());
            } else if (trackKey === 'captions') {
              (timelineState as any)._showSubtitles = true;
              renderTimelineEditor();
              showStatus('✨ Subtitles enabled at playhead', false, 2000);
            } else if (trackKey === 'audio') {
              const tabBtn = document.querySelector('[data-tab="panel-narration"]') as HTMLButtonElement | null;
              tabBtn?.click();
              showStatus('🎙️ Voice Studio opened for narration', false, 2000);
            } else if (trackKey === 'music') {
              import('./handlers-graphics').then(m => m.dropGraphicAtPlayhead('hyperFrame:soundwave-ribbon'));
              showStatus('🎼 Added soundwave audio ribbon at playhead', false, 2000);
            } else if (trackKey === 'sfx') {
              const sfxDropdown = document.getElementById('timeline-sfx-dropdown');
              if (sfxDropdown) {
                sfxDropdown.classList.toggle('hidden');
              } else {
                import('./handlers-graphics').then(m => m.dropSfxCueAtPlayhead('whoosh'));
              }
            }
          });
        });
      }

      const trackOverlays = dom.timelineClipsContainer.querySelector(
        "#track-overlays-container",
      ) as HTMLElement;
      if (trackOverlays) {
        trackOverlays.style.height = `${overlayContainerHeight}px`;
      }

      latestTimelineStateCache = {
        totalDuration,
        clips,
        graphicsEvents,
        pps,
        trackWidth,
      };

      renderTimelineVisibleItems(
        totalDuration,
        clips,
        graphicsEvents,
        pps,
        trackWidth,
      );

      if (dom.timelineEditorContainer) {
        if (timelineState.drawerUserOpen) {
          dom.timelineEditorContainer.classList.remove("hidden");
        } else {
          dom.timelineEditorContainer.classList.add("hidden");
        }
      }
      enhanceTimelineDom();
    }
  }

  function renderTimelineVisibleItems(
    totalDuration: number,
    clips: any[],
    graphicsEvents: any[],
    pps: number,
    trackWidth: number,
  ) {
    const scrollContainer = dom.timelineClipsContainer.querySelector(
      "#timeline-multi-track-scroll",
    ) as HTMLElement;
    if (!scrollContainer) return;

    const scrollLeft = scrollContainer.scrollLeft;
    const clientWidth = scrollContainer.clientWidth || 2000;

    // Virtualization bounds: viewport +/- 1500px buffer for smooth scrolling
    const visibleStartX = scrollLeft - 1500;
    const visibleEndX = scrollLeft + clientWidth + 1500;
    const visibleStartTime = Math.max(0, visibleStartX / pps);
    const visibleEndTime = visibleEndX / pps;

    const trackOverlays = dom.timelineClipsContainer.querySelector(
      "#track-overlays-container",
    ) as HTMLElement;
    const trackVideo = dom.timelineClipsContainer.querySelector(
      "#track-video-container",
    ) as HTMLElement;
    const trackCaptions = dom.timelineClipsContainer.querySelector(
      "#track-captions-container",
    ) as HTMLElement;
    const trackAudio = dom.timelineClipsContainer.querySelector(
      "#track-audio-container",
    ) as HTMLElement;
    const trackMusic = dom.timelineClipsContainer.querySelector(
      "#track-music-container",
    ) as HTMLElement;
    const trackSfx = dom.timelineClipsContainer.querySelector(
      "#track-sfx-container",
    ) as HTMLElement;

    if (!trackOverlays || !trackVideo || !trackCaptions || !trackAudio) return;

    const isSfxEvent = (ev: any) => Boolean(
      ev.isSfxOnly ||
      (ev.sfxTrigger && ev.sfxTrigger !== 'none' && (ev.id?.startsWith('sfx_') || ev.title?.includes('SFX') || ev.isSfxOnly)) ||
      ev.type === 'sfxCue'
    );
    const visualEvents = graphicsEvents.filter(ev => !isSfxEvent(ev));
    const sfxEvents = graphicsEvents.filter(ev => isSfxEvent(ev) || Boolean((ev as any).sfxTrigger && (ev as any).sfxTrigger !== 'none'));

    // Dynamic asset presence checks
    const hasOverlays = visualEvents.length > 0 || ((timelineState as any).overlaysTrack && (timelineState as any).overlaysTrack.length > 0);
    const hasCaptions = Boolean(
      (state as any).videoSubtitlesEnabled ||
      ((state as any).effectiveSubtitles && (state as any).effectiveSubtitles.length > 0) ||
      ((state as any).videoSubtitlesText && (state as any).videoSubtitlesText.trim().length > 0) ||
      (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) ||
      ((state as any).wordTimestamps && (state as any).wordTimestamps.length > 0) ||
      ((state as any).currentSubtitles && (state as any).currentSubtitles.length > 0) ||
      (state.masterAudioTranscript && state.masterAudioTranscript.length > 0)
    );
    const hasAudio = Boolean(
      timelineState.masterAudioBuffer ||
      (state as any).masterAudioBuffer ||
      (state as any).uploadedAudioBuffer ||
      (state as any).uploadedAudioElement ||
      (state as any).masterAudioUrl ||
      (state as any).audioState?.masterAudioUrl ||
      (timelineState as any).masterAudioAssetId ||
      (state.masterAudioTranscript && state.masterAudioTranscript.length > 0) ||
      (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) ||
      ((timelineState as any).audioTrack && (timelineState as any).audioTrack.length > 0) ||
      ((state as any).masterAudioTrack && (state as any).masterAudioTrack.length > 0) ||
      clips.some((c: any) => Boolean(c.audioBuffer || c.audioUrl || c.narrationAudioUrl || c.voiceAudioBuffer))
    );
    const hasMusic = Boolean(
      (state as any).musicAudioBuffer ||
      (state as any).musicMode ||
      (state as any).musicAudioUrl ||
      (state as any).audioState?.musicUrl ||
      ((state as any).musicAudioTrack && (state as any).musicAudioTrack.length > 0) ||
      ((timelineState as any).musicTrack && (timelineState as any).musicTrack.length > 0)
    );
    const hasSfx = Boolean(
      sfxEvents.length > 0 ||
      (state as any).sfxAudioBuffer ||
      (state as any).audioState?.sfxUrl ||
      ((state as any).sfxAudioTrack && (state as any).sfxAudioTrack.length > 0)
    );

    // Toggle track container row display style based on asset presence
    if (trackOverlays) trackOverlays.style.display = hasOverlays ? 'block' : 'none';
    if (trackCaptions) trackCaptions.style.display = hasCaptions ? 'flex' : 'none';
    if (trackAudio) trackAudio.style.display = hasAudio ? 'flex' : 'none';
    if (trackMusic) trackMusic.style.display = hasMusic ? 'flex' : 'none';
    if (trackSfx) trackSfx.style.display = hasSfx ? 'flex' : 'none';

    // Apply Track Visibility & Lock States to Lanes
    const isOverlaysHidden = timelineState.isTrackHidden('overlays');
    const isOverlaysLocked = timelineState.isTrackLocked('overlays');
    trackOverlays.classList.toggle('opacity-25', isOverlaysHidden);
    trackOverlays.classList.toggle('pointer-events-none', isOverlaysHidden || isOverlaysLocked);

    const isVideoHidden = timelineState.isTrackHidden('video');
    const isVideoLocked = timelineState.isTrackLocked('video');
    trackVideo.classList.toggle('opacity-25', isVideoHidden);
    trackVideo.classList.toggle('pointer-events-none', isVideoHidden || isVideoLocked);

    const isCaptionsHidden = timelineState.isTrackHidden('captions');
    const isCaptionsLocked = timelineState.isTrackLocked('captions');
    trackCaptions.classList.toggle('opacity-25', isCaptionsHidden);
    trackCaptions.classList.toggle('pointer-events-none', isCaptionsHidden || isCaptionsLocked);

    const isAudioHidden = timelineState.isTrackHidden('audio');
    const isAudioLocked = timelineState.isTrackLocked('audio');
    trackAudio.classList.toggle('opacity-25', isAudioHidden);
    trackAudio.classList.toggle('pointer-events-none', isAudioHidden || isAudioLocked);

    const isMusicHidden = timelineState.isTrackHidden('music');
    const isMusicLocked = timelineState.isTrackLocked('music');
    if (trackMusic) {
      trackMusic.classList.toggle('opacity-25', isMusicHidden);
      trackMusic.classList.toggle('pointer-events-none', isMusicHidden || isMusicLocked);
    }

    const isSfxHidden = timelineState.isTrackHidden('sfx');
    const isSfxLocked = timelineState.isTrackLocked('sfx');
    if (trackSfx) {
      trackSfx.classList.toggle('opacity-25', isSfxHidden);
      trackSfx.classList.toggle('pointer-events-none', isSfxHidden || isSfxLocked);
    }

    // Render Sticky Time Ruler Ticks (adaptive intervals prevent DOM explosion at low zoom)
    const timelineRuler = dom.timelineClipsContainer.querySelector(
      "#timeline-ruler",
    ) as HTMLElement;
    if (timelineRuler) {
      let tickInterval = 1.0;
      if (pps >= 160) tickInterval = 0.5;
      else if (pps >= 80) tickInterval = 1.0;
      else if (pps >= 40) tickInterval = 2.0;
      else if (pps >= 20) tickInterval = 5.0;
      else if (pps >= 10) tickInterval = 10.0;
      else if (pps >= 4) tickInterval = 30.0;
      else if (pps >= 2) tickInterval = 60.0;
      else tickInterval = 120.0;

      const firstTick = Math.max(0, Math.floor((visibleStartX - 50) / (pps * tickInterval)) * tickInterval);
      const lastTick = Math.min(totalDuration + 1, Math.ceil((visibleEndX + 50) / (pps * tickInterval)) * tickInterval);

      let ticksHtml = "";
      for (let t = firstTick; t <= lastTick; t += tickInterval) {
        const left = t * pps;
        const isWholeSec = Math.round(t) === t;
        const label = t < 60
          ? `${t}s`
          : `${Math.floor(t / 60)}m${t % 60 ? ` ${t % 60}s` : ''}`;
        ticksHtml += `
          <div class="absolute top-0 bottom-0 pointer-events-none flex flex-col justify-between" style="left: ${left}px">
            <span class="text-[9px] font-mono text-gray-400 select-none ml-1 mt-0.5">${label}</span>
            <div class="w-px ${isWholeSec ? "h-2 bg-white/20" : "h-1 bg-white/10"}"></div>
          </div>`;
      }
      timelineRuler.innerHTML = ticksHtml;
    }

    trackOverlays.innerHTML =
      visualEvents.length === 0
        ? `<div class="text-[9px] text-gray-500 italic pl-3 flex items-center h-full">No overlays yet. Click "+ Add Overlay" to place B-Roll images, icons, lower thirds, or title cards.</div>`
        : "";
    trackVideo.innerHTML = "";
    trackCaptions.innerHTML = "";

    // Render Track: Overlays & B-Roll (N-Tracks) — exclude pure SFX
    visualEvents.forEach((ev) => {
      if ((ev.end ?? 0) < visibleStartTime || (ev.start ?? 0) > visibleEndTime)
        return;

      const evWidth = Math.max(32, ((ev.end ?? 0) - (ev.start ?? 0)) * pps);
      const evLeft = (ev.start ?? 0) * pps;
      const trackIndex = (ev as any)._trackIndex || 0;
      const topOffset = trackIndex * 48 + 4;

      const isBroll =
        (ev as any).customImageUrl || (ev as any).icon === "custom";
      const isLowerThird = ev.type === "lowerThird";
      const isTitleCard = ev.type === "titleCard";

      let styleClasses = "bg-amber-900/80 border-amber-400 text-amber-100";
      let iconSymbol = "🖼️";
      let typeText = "B-Roll Image";

      if (isLowerThird) {
        styleClasses = "bg-indigo-900/80 border-indigo-400 text-indigo-100";
        iconSymbol = "🏷️";
        typeText = "Lower Third";
      } else if (isTitleCard) {
        styleClasses = "bg-rose-900/80 border-rose-400 text-rose-100";
        iconSymbol = "🅰️";
        typeText = "Title Card";
      } else if (!isBroll) {
        styleClasses = "bg-teal-900/80 border-teal-400 text-teal-100";
        iconSymbol = (ev as any).icon || "⭐";
        typeText = "Icon";
      }

      const overlayTitle = isBroll
        ? "Custom Image"
        : (ev.title || (ev as any).text || typeText);

      const el = document.createElement("div");
      el.className = `timeline-overlay-clip absolute h-10 rounded border-2 ${styleClasses} backdrop-blur-sm flex items-center justify-between px-1.5 overflow-hidden z-20 cursor-pointer shadow-md group transition-all hover:brightness-125`;
      el.dataset.graphicId = ev.id;
      el.style.left = `${evLeft}px`;
      el.style.width = `${evWidth}px`;
      el.style.top = `${topOffset}px`;

      el.innerHTML = `
              <div class="resize-handle left-handle left-0 top-0 bottom-0 w-2.5 absolute z-30 cursor-col-resize hover:bg-white/40"></div>
              <div class="flex items-center gap-1.5 truncate pointer-events-none w-full">
                  ${isBroll ? `<img src="${(ev as any).customImageUrl}" class="h-6 w-6 object-cover rounded shadow border border-white/20">` : `<span class="text-xs flex-shrink-0">${iconSymbol}</span>`}
                  <div class="flex flex-col truncate leading-tight">
                      <span class="text-[9px] font-bold truncate drop-shadow">${escapeHtml(overlayTitle)}</span>
                      <span class="text-[8px] opacity-80 font-mono">${(ev.start ?? 0).toFixed(1)}s - ${(ev.end ?? 0).toFixed(1)}s</span>
                  </div>
              </div>
              <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30 bg-black/80 px-1 py-0.5 rounded absolute right-2 pointer-events-auto shadow-md border border-white/10">
                  <button type="button" class="overlay-edit-btn p-0.5 hover:text-amber-300 text-[9px] cursor-pointer" title="Edit Overlay (✏️)">✏️</button>
                  <button type="button" class="overlay-delete-btn p-0.5 hover:text-red-400 text-[9px] cursor-pointer" title="Delete Overlay (🗑️)">🗑️</button>
              </div>
              <div class="resize-handle right-handle right-0 top-0 bottom-0 w-2.5 absolute z-30 cursor-col-resize hover:bg-white/40"></div>
          `;
      const editBtn = el.querySelector(".overlay-edit-btn");
      if (editBtn) {
        editBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        editBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          timelineState.setSelectedGraphicId(ev.id);
          openGraphicEditor(ev.id);
        });
      }
      const delBtn = el.querySelector(".overlay-delete-btn");
      if (delBtn) {
        delBtn.addEventListener("mousedown", (e) => e.stopPropagation());
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          deleteGraphicEvent(ev.id);
        });
      }
      el.addEventListener("dblclick", () => {
        openGraphicEditor(ev.id);
      });
      trackOverlays?.appendChild(el);
    });

    // Render Track: Main Video Shots
    clips.forEach((clip, index) => {
      if (clip.endTime < visibleStartTime || clip.startTime > visibleEndTime)
        return;

      const displayText = clip.text || (clip.talkingHeadVideoElement || clip.videoElement ? (state.musicMode ? 'Uploaded Video (Music Sync)' : 'Uploaded Video') : `Shot ${index + 1}`);
      const hasMedia = Boolean(clip.image || clip.videoElement || clip.talkingHeadVideoElement || clip._videoObjectURL || clip._imageObjectURL);
      const mediaThumb = clip.image
        ? `<img src="${clip.image.src}" class="absolute inset-0 w-full h-full object-cover opacity-40">`
        : (clip.videoElement || clip.talkingHeadVideoElement
          ? `<div class="absolute inset-0 bg-indigo-950/40 flex items-center justify-center opacity-40"><span class="text-xs">🎥</span></div>`
          : (!hasMedia
            ? `<div class="absolute inset-0 bg-red-950/40 border border-red-500/30 flex items-center justify-center gap-1 opacity-80 text-[9px] text-red-300"><span>⚠️</span><span>Missing Media</span></div>`
            : ""));

      const isVideoSource = Boolean(clip.videoElement || clip.talkingHeadVideoElement || clip._videoObjectURL);
      const deviceTagDisplay = clip.deviceTag ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-sky-900/80 text-sky-200 border border-sky-400/30 rounded font-mono uppercase tracking-wider">${clip.deviceTag === 'screen_recording' ? 'REC' : clip.deviceTag}</span>` : '';
      const arollTag = clip.displayMode === 'pip_overlay'
        ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-indigo-500 text-white rounded font-bold uppercase tracking-wider shrink-0 shadow-xs border border-indigo-400">🪟 Pop-Up PiP</span>`
        : clip.talkingHeadMode === 'full'
        ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-indigo-600/90 text-white rounded font-bold uppercase tracking-wider shrink-0 shadow-xs border border-indigo-400/40">👤 A-Roll</span>`
        : clip.talkingHeadMode === 'split'
        ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-purple-600/90 text-white rounded font-bold uppercase tracking-wider shrink-0 shadow-xs border border-purple-400/40">🌓 Split</span>`
        : (clip.talkingHeadMode && clip.talkingHeadMode.startsWith('pip'))
        ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-cyan-600/90 text-white rounded font-bold uppercase tracking-wider shrink-0 shadow-xs border border-cyan-400/40">🎭 PiP</span>`
        : (state.uploadedVideoElement && clip.talkingHeadMode === 'none'
        ? `<span class="ml-1 px-1 py-0.2 text-[8px] bg-amber-600/80 text-white rounded font-bold uppercase tracking-wider shrink-0 shadow-xs border border-amber-400/40">🖼️ B-Roll</span>`
        : '');

      const el = document.createElement("div");
      const isPiPOverlay = clip.displayMode === 'pip_overlay';
      el.className =
        `timeline-clip absolute h-14 backdrop-blur-sm rounded-md border-2 hover:border-indigo-400 flex items-center justify-center overflow-hidden z-10 shadow-sm transition-colors ${isPiPOverlay ? 'bg-indigo-950/60 border-indigo-400/80 ring-1 ring-indigo-400/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'bg-gray-800/80 border-indigo-500/50'}`;
      el.dataset.clipId = clip.id;
      el.style.left = `${clip.startTime * pps}px`;
      el.style.width = `${clip.duration * pps}px`;
      el.innerHTML = `<div class="clip-content w-full h-full relative flex items-center px-2">${mediaThumb}<span class="relative text-white text-[10px] font-medium truncate px-1 drop-shadow-md z-10 flex items-center gap-1">${isVideoSource ? '<span class="text-[10px]">🎥</span>' : '<span class="text-[10px]">🎬</span>'}<span class="truncate">${escapeHtml(displayText)}</span>${deviceTagDisplay}${arollTag}</span></div><div class="resize-handle left-handle"></div><div class="resize-handle right-handle"></div>`;
      trackVideo.appendChild(el);

      // Render transition visual indicator between this clip and next
      if (index < clips.length - 1) {
        const nextClip = clips[index + 1];
        const seamX = clip.endTime * pps;
        const currentTransition = clip.transitionToNext || "cut";
        const isTransitionActive = currentTransition !== "cut";

        if (isTransitionActive) {
          const transitionDur =
            clip._transitionDuration ||
            clamp(
              0.08 * Math.min(clip.duration, nextClip.duration),
              0.08,
              0.35,
            );
          const startX =
            (clip._transitionStart ?? clip.endTime - transitionDur) * pps;
          const endX = (clip._transitionEnd ?? clip.endTime) * pps;

          if (endX >= visibleStartX && startX <= visibleEndX) {
            const zoneWidth = Math.max(28, endX - startX);
            const transitionZone = document.createElement("div");
            transitionZone.className =
              "timeline-transition-zone absolute h-[70%] top-[15%] z-15 rounded border border-indigo-400/80 bg-gradient-to-r from-purple-600/60 via-indigo-500/70 to-cyan-500/60 shadow-md backdrop-blur-xs flex items-center justify-center pointer-events-none";
            transitionZone.style.left = `${startX}px`;
            transitionZone.style.width = `${zoneWidth}px`;
            transitionZone.innerHTML = `<span class="text-[8px] font-black text-white/95 uppercase tracking-widest px-0.5 whitespace-nowrap overflow-hidden drop-shadow">⚡ TRANSITION</span>`;
            trackVideo.appendChild(transitionZone);
          }
        } else {
          if (seamX >= visibleStartX && seamX <= visibleEndX) {
            const cutSeam = document.createElement("div");
            cutSeam.className =
              "timeline-cut-seam absolute h-full top-0 z-15 pointer-events-none border-r-2 border-dashed border-gray-500/50";
            cutSeam.style.left = `${seamX}px`;
            trackVideo.appendChild(cutSeam);
          }
        }

        if (seamX >= visibleStartX && seamX <= visibleEndX) {
          // At very low zoom levels (e.g. Fit or zoom < 0.2), don't stack oversized buttons that crowd each other
          const minNeighborWidth = Math.min(clip.duration, nextClip.duration) * pps;
          if (minNeighborWidth >= 20 || pps >= 15 || isTransitionActive) {
            const transBtn = document.createElement("button");
            transBtn.type = "button";
            transBtn.className = isTransitionActive
              ? "timeline-transition-btn absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-40 bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-300/60 shadow-lg text-[10px] font-bold py-1 px-2.5 rounded-full flex items-center gap-1 cursor-pointer transition-all hover:scale-110 active:scale-95 min-w-[28px] h-7 justify-center"
              : "timeline-transition-btn absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-40 bg-gray-800/95 hover:bg-indigo-600 text-gray-300 hover:text-white border border-gray-600 hover:border-indigo-400 shadow text-[10px] py-1 px-2 rounded-full flex items-center gap-1 cursor-pointer transition-all opacity-90 hover:opacity-100 hover:scale-110 active:scale-95 min-w-[28px] h-7 justify-center";
            transBtn.dataset.clipId = String(clip.id);
            transBtn.dataset.clipIndex = String(index);
            transBtn.title = `Transition to Shot ${index + 2}: ${getTransitionLabel(currentTransition)}. Click to change transition.`;
            transBtn.innerHTML = `<span>${getTransitionIcon(currentTransition)}</span><span class="${isTransitionActive ? "font-medium" : "hidden sm:inline text-[9px] font-semibold"}">${getTransitionLabel(currentTransition)}</span>`;
            trackVideo.appendChild(transBtn);
          }
        }
      }
    });

    // Render Track: Captions / Subtitles
    if (timelineState.globalWordTimestamps?.length) {
      const words = timelineState.globalWordTimestamps;
      let currentPhrase: any[] = [];
      for (let i = 0; i < words.length; i++) {
        currentPhrase.push(words[i]);
        if (
          currentPhrase.length >= 4 ||
          i === words.length - 1 ||
          (words[i + 1] && words[i + 1].start - words[i].end > 0.4)
        ) {
          const pStart = currentPhrase[0]?.start ?? 0;
          const pEnd = currentPhrase[currentPhrase.length - 1]?.end ?? 0;

          if (pEnd >= visibleStartTime && pStart <= visibleEndTime) {
            const pText = currentPhrase.map((w) => w.word).join(" ");
            const capW = Math.max(16, (pEnd - pStart) * pps);
            const capL = pStart * pps;

            const capEl = document.createElement("div");
            capEl.className =
              "absolute h-6 top-2 rounded bg-cyan-950/70 border border-cyan-500/40 text-cyan-200 text-[8px] font-mono flex items-center px-1 overflow-hidden truncate";
            capEl.style.left = `${capL}px`;
            capEl.style.width = `${capW}px`;
            capEl.title = `[${pStart.toFixed(1)}s - ${pEnd.toFixed(1)}s] ${pText}`;
            capEl.textContent = pText;
            trackCaptions.appendChild(capEl);
          }
          currentPhrase = [];
        }
      }
    } else {
      trackCaptions.innerHTML = `<div class="text-[9px] text-gray-500 italic pl-3">No timed caption data available.</div>`;
    }

    // Render Track: Audio Waveform (High-Performance Cached Peak Rendering)
    const waveformCanvas = trackAudio.querySelector(
      "#timeline-waveform",
    ) as HTMLCanvasElement;
    const existingAudioLabels = trackAudio.querySelectorAll(".audio-info-overlay");
    existingAudioLabels.forEach((el) => el.remove());

    const masterAudioBuf = timelineState.masterAudioBuffer;
    if (waveformCanvas && masterAudioBuf) {
      waveformCanvas.style.display = "block";
      const buffer = masterAudioBuf;
      const audioDur = buffer.duration;
      const audioWidthPx = Math.max(1, audioDur * pps);

      const SAFE_CANVAS_LIMIT = 8000;
      const canvasStartX = Math.max(0, Math.floor(visibleStartX));
      const canvasEndX = Math.min(audioWidthPx, Math.ceil(visibleEndX));
      const canvasWidth = Math.max(
        1,
        Math.min(canvasEndX - canvasStartX, SAFE_CANVAS_LIMIT),
      );

      waveformCanvas.style.left = `${canvasStartX}px`;
      waveformCanvas.width = canvasWidth;
      waveformCanvas.style.width = `${canvasWidth}px`;
      waveformCanvas.height = 40;

      const ctx = waveformCanvas.getContext("2d", { alpha: true });
      if (ctx && canvasWidth > 0) {
        ctx.fillStyle = "#10b981"; // emerald-500
        const peaks = getAudioBufferPeaks(buffer);
        const buckets = peaks.length;

        ctx.beginPath();
        const startCanvasX = canvasStartX;
        const endCanvasX = Math.min(canvasStartX + canvasWidth, canvasEndX);

        for (let i = startCanvasX; i < endCanvasX; i++) {
          const localX = i - canvasStartX;
          const progress = i / audioWidthPx;
          const bucketIdx = Math.min(buckets - 1, Math.max(0, Math.floor(progress * buckets)));
          const norm = peaks[bucketIdx] || 0.05;
          const h = Math.max(2, Math.min(38, Math.round(norm * 38)));
          const y = Math.floor((40 - h) / 2);
          ctx.rect(localX, y, 1, h);
        }
        ctx.fill();
      }
      
      // Render audio splits as selectable clip overlays
      const existingClipOverlays = trackAudio.querySelectorAll('.audio-clip-overlay');
      existingClipOverlays.forEach(el => el.remove());

      const audioSplits = [0, ...(timelineState.audioSplits || []), audioDur].sort((a, b) => a - b);
      for (let i = 0; i < audioSplits.length - 1; i++) {
        const start = audioSplits[i];
        const end = audioSplits[i + 1];
        if (end - start < 0.01) continue; // skip zero-length
        
        const clipDiv = document.createElement('div');
        clipDiv.className = `audio-clip-overlay absolute top-0 bottom-0 border-r border-zinc-900 pointer-events-auto cursor-pointer transition-colors group`;
        clipDiv.style.left = `${start * pps}px`;
        clipDiv.style.width = `${(end - start) * pps}px`;
        
        const isSelected = timelineState.selectedAudioSplitIndex === i;
        if (isSelected) {
            clipDiv.classList.add('bg-indigo-500/30', 'border', 'border-indigo-400', 'z-20');
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'absolute top-1 right-2 text-white bg-red-600/80 hover:bg-red-500 rounded p-1 pointer-events-auto shadow';
            deleteBtn.innerHTML = '<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
            deleteBtn.onmousedown = (e) => {
                e.stopPropagation();
                import('./videoController').then(m => m.handleDeleteClip({ deleteAudio: true }));
            };
            clipDiv.appendChild(deleteBtn);
        } else {
            clipDiv.classList.add('hover:bg-white/10');
        }

        clipDiv.onmousedown = (e) => {
            timelineState.setSelectedClipId(null);
            timelineState.setSelectedAudioSplitIndex(i);
            renderTimelineEditor();
        };

        const label = document.createElement('div');
        label.className = `absolute top-1 left-2 text-[9px] font-mono select-none px-1 rounded-sm ${isSelected ? 'bg-indigo-900 text-indigo-200' : 'bg-black/50 text-emerald-400 opacity-0 group-hover:opacity-100'}`;
        label.textContent = `A-Roll ${i + 1}`;
        clipDiv.appendChild(label);

        trackAudio.appendChild(clipDiv);
      }
    } else {
      if (waveformCanvas) {
        waveformCanvas.style.display = "none";
        waveformCanvas.width = 0;
      }
      const emptyLabel = document.createElement("div");
      emptyLabel.className = "audio-info-overlay text-[9px] text-gray-500 italic pl-3 flex items-center h-full z-10 select-none";
      emptyLabel.textContent = "No master audio on timeline (Visual-First / Free Mode).";
      trackAudio.appendChild(emptyLabel);
    }

    // Render Track: Music / Background Audio Waveform
    if (trackMusic) {
      const musicCanvas = trackMusic.querySelector(
        "#timeline-music-waveform",
      ) as HTMLCanvasElement;
      const existingLabels = trackMusic.querySelectorAll(".music-info-overlay");
      existingLabels.forEach((el) => el.remove());

      if (state._bgAudioBuffer && musicCanvas) {
        const buffer = state._bgAudioBuffer;
        const data = buffer.getChannelData(0);
        const musicDur = buffer.duration;
        const musicWidthPx = Math.max(1, musicDur * pps);

        const SAFE_CANVAS_LIMIT = 8000;
        const canvasStartX = Math.max(0, Math.floor(visibleStartX));
        const canvasEndX = Math.min(trackWidth, Math.ceil(visibleEndX));
        const canvasWidth = Math.max(
          1,
          Math.min(canvasEndX - canvasStartX, SAFE_CANVAS_LIMIT),
        );

        musicCanvas.style.left = `${canvasStartX}px`;
        musicCanvas.width = canvasWidth;
        musicCanvas.style.width = `${canvasWidth}px`;
        musicCanvas.height = 40;

        const ctx = musicCanvas.getContext("2d", { alpha: true });
        if (ctx && canvasWidth > 0) {
          ctx.fillStyle = "#a855f7"; // purple-500
          const peaks = getAudioBufferPeaks(buffer);
          const buckets = peaks.length;

          ctx.beginPath();
          const startCanvasX = canvasStartX;
          const endCanvasX2 = Math.min(canvasStartX + canvasWidth, canvasEndX);

          for (let i = startCanvasX; i < endCanvasX2; i++) {
            const localX = i - canvasStartX;
            const progress = (i % musicWidthPx) / musicWidthPx;
            const bucketIdx = Math.min(buckets - 1, Math.max(0, Math.floor(progress * buckets)));
            const norm = peaks[bucketIdx] || 0.05;
            const h = Math.max(2, Math.min(38, Math.round(norm * 38)));
            const y = Math.floor((40 - h) / 2);
            ctx.rect(localX, y, 1, h);

            // Draw subtle loop boundary separator
            if (musicWidthPx > 10 && i > 0 && Math.floor(i % musicWidthPx) === 0) {
              ctx.rect(localX, 0, 1, 40);
            }
          }
          ctx.fill();
        }

        // Loop / Music title chips in trackMusic
        const loopWidth = musicDur * pps;
        const totalLoops = Math.ceil(trackWidth / loopWidth);
        const trackFrag = document.createDocumentFragment();

        for (let l = 0; l < totalLoops; l++) {
          const loopLeft = l * loopWidth;
          if (loopLeft + loopWidth < visibleStartX || loopLeft > visibleEndX)
            continue;

          const chip = document.createElement("div");
          chip.className =
            "music-info-overlay absolute top-1 h-5 px-1.5 rounded bg-purple-900/60 border border-purple-500/30 text-[9px] text-purple-200 flex items-center gap-1 pointer-events-none truncate z-10";
          chip.style.left = `${loopLeft + 4}px`;
          chip.style.maxWidth = `${Math.max(40, loopWidth - 8)}px`;
          chip.innerHTML = `<span>🎼</span><span class="truncate">${escapeHtml(state.bgAudioPrompt || "Music Track")}${l > 0 ? ` (Loop ${l + 1})` : ""}</span>`;
          trackFrag.appendChild(chip);
        }
        trackMusic.appendChild(trackFrag);
      } else if (musicCanvas) {
        const ctx = musicCanvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, musicCanvas.width, musicCanvas.height);
      }

      function drawSfxClipWaveformCanvas(canvas: HTMLCanvasElement, buffer: AudioBuffer, startOffsetSec: number = 0, durationSec?: number) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth || Math.max(30, canvas.parentElement?.clientWidth || 60);
        const h = canvas.clientHeight || 28;
        if (w <= 0 || h <= 0) return;

        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const channelData = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate || 44100;
        const totalSamples = channelData.length;

        const durSec = durationSec || (buffer.duration - startOffsetSec) || 2.0;
        const startSample = Math.max(0, Math.min(totalSamples, Math.floor(startOffsetSec * sampleRate)));
        const endSample = Math.max(startSample, Math.min(totalSamples, Math.ceil((startOffsetSec + durSec) * sampleRate)));
        const sampleRange = Math.max(1, endSample - startSample);

        const barWidth = 2;
        const barGap = 1;
        const numBars = Math.max(8, Math.floor(w / (barWidth + barGap)));
        const centerY = h / 2;

        const samplesPerBar = Math.floor(sampleRange / numBars);

        for (let i = 0; i < numBars; i++) {
          const x = i * (barWidth + barGap);
          if (x >= w) break;

          const barStart = startSample + (i * samplesPerBar);
          const barEnd = Math.min(endSample, barStart + samplesPerBar);
          let maxPeak = 0;
          const step = Math.max(1, Math.floor((barEnd - barStart) / 16));

          for (let s = barStart; s < barEnd; s += step) {
            const abs = Math.abs(channelData[s]);
            if (abs > maxPeak) maxPeak = abs;
          }

          const barH = Math.max(3, Math.min(h - 4, maxPeak * (h - 4)));

          const grad = ctx.createLinearGradient(0, centerY - barH / 2, 0, centerY + barH / 2);
          grad.addColorStop(0, "#FBBF24");
          grad.addColorStop(0.5, "#34D399");
          grad.addColorStop(1, "#F59E0B");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, centerY - barH / 2, barWidth, barH, 0.5);
          ctx.fill();
        }

        ctx.restore();
      }

      // Render Track: Sound Effects (SFX) Track
      if (trackSfx) {
        trackSfx.innerHTML = "";
        const sfxIcons: Record<string, string> = {
          whoosh: "💨",
          hit: "🔨",
          ping: "🔔",
          pop: "🫧",
          laser: "⚡",
          riser: "📈",
          glitch: "👾",
          bass_drop: "🔊",
          cyber_chime: "✨",
          impact: "💥",
          chord: "🎹",
        };

        if (sfxEvents.length === 0) {
          trackSfx.innerHTML = `<div class="text-[9px] text-gray-500 italic pl-3 flex items-center h-full select-none">No sound effects yet. Click "+ SFX" or drop cues from the Background Music panel to place SFX at playhead.</div>`;
        } else {
          sfxEvents.forEach((ev) => {
            if ((ev.end ?? 0) < visibleStartTime || (ev.start ?? 0) > visibleEndTime)
              return;

            const evWidth = Math.max(
              38,
              ((ev.end ?? (ev.start + 1.5)) - (ev.start ?? 0)) * pps,
            );
            const evLeft = (ev.start ?? 0) * pps;
            const sfxType = (ev as any).sfxTrigger || "whoosh";
            const icon = sfxIcons[sfxType] || "🔊";
            const title = ev.title || sfxType;

            const isSelected = ev.id === timelineState.selectedGraphicId;
            const borderClasses = isSelected
              ? "border-amber-300 ring-2 ring-amber-400 shadow-amber-500/50 scale-[1.01]"
              : "border-amber-500/70 hover:border-amber-300";

            const el = document.createElement("div");
            el.className = `timeline-overlay-clip timeline-sfx-clip absolute h-7 top-1.5 rounded border bg-gradient-to-r from-amber-950/95 via-amber-900/85 to-yellow-950/90 text-amber-200 backdrop-blur-sm flex items-center justify-between px-1 overflow-hidden z-20 cursor-pointer shadow-md group transition-all hover:brightness-125 ${borderClasses}`;
            el.dataset.graphicId = ev.id;
            el.dataset.sfxType = sfxType;
            el.style.left = `${evLeft}px`;
            el.style.width = `${evWidth}px`;

            el.innerHTML = `
                <div class="resize-handle left-handle left-0 top-0 bottom-0 w-2 absolute z-30 cursor-col-resize hover:bg-amber-400/50"></div>
                <canvas class="sfx-clip-waveform-canvas absolute inset-0 w-full h-full pointer-events-none z-0 opacity-55"></canvas>
                <div class="flex items-center gap-1 truncate pointer-events-none w-full relative z-10 px-1">
                    <span class="text-xs flex-shrink-0">${icon}</span>
                    <div class="flex items-center gap-1 truncate leading-tight">
                        <span class="text-[9px] font-bold truncate drop-shadow text-amber-100">${escapeHtml(title)}</span>
                        <span class="text-[8px] opacity-90 font-mono text-amber-200/90">${(ev.start ?? 0).toFixed(1)}s-${(ev.end ?? 0).toFixed(1)}s</span>
                    </div>
                </div>
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-30 bg-black/85 px-1 py-0.5 rounded absolute right-1 shadow-lg border border-white/10">
                    <button type="button" class="sfx-trim-btn p-0.5 hover:text-emerald-300 text-[10px] text-amber-300 cursor-pointer" title="Cut & Trim SFX Waveform (✂️)">✂️</button>
                    <button type="button" class="sfx-split-btn p-0.5 hover:text-amber-300 text-[10px] text-amber-200 cursor-pointer" title="Split SFX Clip at Playhead (🔪)">🔪</button>
                    <button type="button" class="sfx-play-btn p-0.5 hover:text-white text-[10px] text-amber-300 cursor-pointer" title="Play Sound Preview">▶</button>
                    <button type="button" class="overlay-delete-btn p-0.5 hover:text-red-400 text-[10px] cursor-pointer" title="Delete SFX Cue">🗑️</button>
                </div>
                <div class="resize-handle right-handle right-0 top-0 bottom-0 w-2 absolute z-30 cursor-col-resize hover:bg-amber-400/50"></div>
            `;

            const canvasEl = el.querySelector(".sfx-clip-waveform-canvas") as HTMLCanvasElement | null;
            if (canvasEl) {
              if ((ev as any)._sfxBuffer) {
                requestAnimationFrame(() => {
                  drawSfxClipWaveformCanvas(canvasEl, (ev as any)._sfxBuffer, (ev as any).startOffset || 0, (ev.end ?? 0) - (ev.start ?? 0));
                });
              } else if (sfxType && sfxType !== 'custom' && sfxType !== 'none') {
                import("./audioSynthesizer").then((m) => {
                  m.AudioSynthesizer.getInstance().synthesizeSfxBuffer(sfxType as any).then((buf) => {
                    if (buf) {
                      (ev as any)._sfxBuffer = buf;
                      drawSfxClipWaveformCanvas(canvasEl, buf, 0, (ev.end ?? 0) - (ev.start ?? 0));
                    }
                  });
                });
              }
            }

            el.addEventListener("click", (e) => {
              const target = e.target as HTMLElement;
              if (target.closest("button") || target.classList.contains("resize-handle")) return;
              timelineState.setSelectedGraphicId(ev.id);
              import("./ui").then(m => m.renderTimelineEditor());
            });

            el.querySelector(".sfx-trim-btn")?.addEventListener("click", (e) => {
              e.stopPropagation();
              timelineState.setSelectedGraphicId(ev.id);
              import("./sfx-trimmer").then((m) => m.openSfxTrimmerForGraphic(ev.id));
            });

            el.querySelector(".sfx-split-btn")?.addEventListener("click", (e) => {
              e.stopPropagation();
              timelineState.setSelectedGraphicId(ev.id);
              import("./videoController").then((m) => m.handleSplitClip());
            });

            el.querySelector(".sfx-play-btn")?.addEventListener("click", (e) => {
              e.stopPropagation();
              if ((ev as any)._sfxBuffer) {
                try {
                  const ctx = (window as any)._audioCtx || new AudioContext();
                  if (ctx.state === 'suspended') ctx.resume();
                  const src = ctx.createBufferSource();
                  src.buffer = (ev as any)._sfxBuffer;
                  src.connect(ctx.destination);
                  src.start();
                } catch {}
              } else {
                import("./audioSynthesizer").then((m) =>
                  m.AudioSynthesizer.getInstance().playSfx(sfxType as any, 0.65),
                );
              }
              import("./ui").then((m) =>
                m.showStatus(`🔊 Playing ${title} preview`, false, 1500),
              );
            });

            const sfxDelBtn = el.querySelector(".overlay-delete-btn");
            if (sfxDelBtn) {
              sfxDelBtn.addEventListener("mousedown", (e) => e.stopPropagation());
              sfxDelBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                deleteGraphicEvent(ev.id);
              });
            }

            el.addEventListener("dblclick", (e) => {
              e.stopPropagation();
              import("./sfx-trimmer").then((m) => m.openSfxTrimmerForGraphic(ev.id));
            });

            trackSfx.appendChild(el);
          });
        }
      }

      // Sync playhead position to current pause time or last rendered timestamp
      const playhead = document.getElementById("timeline-playhead") as HTMLElement;
      if (playhead) {
        const curTime = state.videoPauseTime || state.lastRenderedTime || 0;
        const x = Math.max(0, curTime * pps);
        playhead.style.transform = `translateX(${x}px)`;
        playhead.style.display = totalDuration > 0 ? "block" : "none";
      }
    }
  }
  export function openTranscriptEditor() {
    if (
      !dom.transcriptEditorWorkspace ||
      !timelineState.globalWordTimestamps?.length
    )
      return;
    if (dom.transcriptEditorTranscriptContainer)
      dom.transcriptEditorTranscriptContainer.innerHTML = "";
    const allShots = state.currentScenes.flatMap((s) => s.lines || [s]);
    const shotsWithMedia = allShots.filter(
      (s) => !!(s._imageObjectURL || s.image_id || s._videoObjectURL || s.video_id),
    );
    if (dom.transcriptEditorImageBin) {
      dom.transcriptEditorImageBin.innerHTML = shotsWithMedia
        .map(
          (shot) => {
            const hasVideo = !!(shot._videoObjectURL || shot.video_id);
            const thumbHtml = (shot._videoObjectURL && !shot._imageObjectURL)
              ? `<video src="${shot._videoObjectURL}" class="generated-img w-full h-full object-cover" data-id="${shot.id}" muted preload="metadata"></video>`
              : `<img src="${shot._imageObjectURL || ""}" class="generated-img" data-id="${shot.id}">`;

            return `
        <div class="b-roll-item relative group" data-image-id="${shot.id}" title="${escapeHtml(shot.text_reference || shot.line_text || "")}">
            <div class="b-roll-assigned-badge absolute top-1.5 right-1.5 bg-black/70 text-gray-400 text-[9px] font-mono px-1.5 py-0.5 rounded-md border border-white/10 z-10 pointer-events-none">Unassigned</div>
            ${hasVideo ? `<div class="absolute top-1.5 left-1.5 bg-purple-950/80 text-purple-200 border border-purple-500/40 text-[9px] font-mono px-1.5 py-0.5 rounded-md z-10 pointer-events-none flex items-center gap-1 shadow-xs">🎬 Video</div>` : ''}
            <div class="b-roll-thumb">${thumbHtml}</div>
            <div class="b-roll-text-overlay">${escapeHtml(shot.text_reference || shot.line_text || "")}</div>
        </div>`;
          }
        )
        .join("");
      // Hydrate images from IndexedDB for any shots whose ObjectURL has expired
      hydrateVisibleShots();
    }
  }

  export function closeTranscriptEditor() {
    if (dom.transcriptEditorTranscriptContainer)
      dom.transcriptEditorTranscriptContainer.innerHTML = "";
    if (dom.transcriptEditorImageBin)
      dom.transcriptEditorImageBin.innerHTML = "";
  }

  export function updateTranscriptSelection(
    startIndex: number | null,
    endIndex: number | null,
  ) {
    if (!dom.transcriptEditorTranscriptContainer) return;
    const words =
      dom.transcriptEditorTranscriptContainer.querySelectorAll(
        ".transcript-word",
      );
    if (startIndex === null) {
      words.forEach((w) => w.classList.remove("selection-highlight"));
      return;
    }
    const [s, e] = [
      Math.min(startIndex, endIndex!),
      Math.max(startIndex, endIndex!),
    ];
    words.forEach((w, i) =>
      w.classList.toggle("selection-highlight", i >= s && i <= e),
    );
  }

  export function updateImageBinSelectionStates(
    assignments: Array<{ imageId: string; startWordIndex?: number; endWordIndex?: number }>,
  ) {
    const bin = dom.transcriptEditorImageBin;
    if (!bin) return;

    const assignedCountMap = new Map<string, number>();
    assignments.forEach((a) => {
      assignedCountMap.set(a.imageId, (assignedCountMap.get(a.imageId) || 0) + 1);
    });

    const binItems = bin.querySelectorAll<HTMLElement>(".b-roll-item");
    let assignedCount = 0;

    binItems.forEach((item) => {
      const imageId = item.dataset.imageId;
      if (!imageId) return;

      const count = assignedCountMap.get(imageId) || 0;
      const isAssigned = count > 0;

      item.classList.toggle("assigned", isAssigned);
      item.classList.toggle("used", isAssigned);
      item.setAttribute("data-assigned", isAssigned ? "true" : "false");

      let badge = item.querySelector<HTMLElement>(".b-roll-assigned-badge");
      if (!badge) {
        badge = document.createElement("div");
        item.appendChild(badge);
      }

      if (isAssigned) {
        assignedCount++;
        badge.className =
          "b-roll-assigned-badge absolute top-1.5 right-1.5 bg-emerald-500 text-black text-[10px] font-black px-2 py-0.5 rounded-md shadow-lg flex items-center gap-1 z-10 border border-emerald-300 pointer-events-none";
        badge.innerHTML = `<span>✓</span> <span>${count > 1 ? `${count}x` : "Assigned"}</span>`;
      } else {
        badge.className =
          "b-roll-assigned-badge absolute top-1.5 right-1.5 bg-black/70 text-gray-400 text-[9px] font-mono px-1.5 py-0.5 rounded-md border border-white/10 z-10 pointer-events-none";
        badge.innerHTML = `<span>Unassigned</span>`;
      }
    });

    const counterEl = document.getElementById("transcript-bin-assigned-count");
    if (counterEl) {
      counterEl.textContent = `${assignedCount} / ${binItems.length} assigned`;
    }
  }

  export function renderTranscriptAssignments(
    assignments: Array<{
      startWordIndex: number;
      endWordIndex: number;
      imageId: string;
    }>,
  ) {
    const container = dom.transcriptEditorTranscriptContainer;
    if (!container || !timelineState.globalWordTimestamps) return;
    const allWords = timelineState.globalWordTimestamps;

    // Map startWordIndex to assignment details
    const startAssignmentMap = new Map<
      number,
      { end: number; imageId: string; assignmentIndex: number }
    >();
    assignments.forEach((a, idx) =>
      startAssignmentMap.set(a.startWordIndex, {
        end: a.endWordIndex,
        imageId: a.imageId,
        assignmentIndex: idx,
      }),
    );

    let html = "";
    const allShots = state.currentScenes.flatMap((s) => s.lines || [s]);

    for (let i = 0; i < allWords.length; i++) {
      const wordObj = allWords[i];
      const isTriggerWord = startAssignmentMap.has(i);

      if (isTriggerWord) {
        const assignment = startAssignmentMap.get(i)!;
        const clip = timelineState.clips.find(
          (c) => c.id === assignment.imageId,
        );
        const shot = allShots.find((s) => s.id === assignment.imageId);
        const imgSrc = clip?.image?.src || shot?._imageObjectURL || "";
        const shotTitle =
          shot?.text_reference ||
          shot?.line_text ||
          `Shot ${assignment.assignmentIndex + 1}`;

        // Inline Cut Marker Chip right before the trigger word
        html += `<span class="assigned-trigger-chip" data-image-id="${assignment.imageId}" data-start-word="${i}" title="Cut point for: ${escapeHtml(shotTitle)} (Click word or image card to jump)">`;
        if (imgSrc) {
          html += `<img src="${imgSrc}" class="assigned-thumbnail">`;
        } else {
          html += `<span class="text-[10px]">🖼️</span>`;
        }
        html += `<span>Cut #${assignment.assignmentIndex + 1}</span>`;
        html += `</span>`;

        // Highlight the assigned cut trigger word
        html += `<span class="transcript-word trigger-word" data-index="${i}" data-start="${wordObj.start}" data-end="${wordObj.end}" data-image-id="${assignment.imageId}">${escapeHtml(wordObj.word)}</span> `;
      } else {
        html += `<span class="transcript-word" data-index="${i}" data-start="${wordObj.start}" data-end="${wordObj.end}">${escapeHtml(wordObj.word)}</span> `;
      }
    }

    container.innerHTML = html;

    // Update image bin visual states!
    updateImageBinSelectionStates(assignments);
  }
