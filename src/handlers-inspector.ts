import { audioBufferToWavBlob } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from './dom';
import { state } from './state';
import { showStatus, renderResults } from './ui';
import { renderTimelineEditor } from './ui-renderers';
import { saveVersion } from './handlers-project';
import { timelineState } from './state-timeline';
import { updateVideoContext } from './videoController';
import { drawVideoFrame, getShotFilterCss } from './videoRenderer';
import { presetToKeyframes } from './utils';
import type { CameraKeyframesConfig } from './types';
import { openMapStudioModal } from './map-studio';
import { removeSecondaryMedia } from './memoryManager';
import { mountInspectorPositionGlyphs, mountInspectorSpeedChips } from './director-workspace';

export let activeShotId: string | null = null;

export function getFilterLabel(filter: string): string {
    switch (filter) {
        case 'noir': return '🌑 Noir B&W';
        case 'noir_grain': return '📽️ Noir + Grain';
        case 'vintage': return '📼 70s Retro';
        case 'sepia': return '📜 Sepia';
        case 'warm': return '🌅 Golden';
        case 'cool': return '❄️ Cool Teal';
        case 'cyberpunk': return '🏙️ Cyber';
        case 'technicolor': return '🌈 Technicolor';
        case 'bleach_bypass': return '🎬 Bleach';
        case 'moody_dark': return '🌒 Moody';
        case 'emerald': return '🟢 Matrix';
        case 'crt': return '📺 CRT';
        default: return 'Original';
    }
}

export function updateInspectorFilterUIState(filter: string) {
    if (dom.inspectorFilterStatusBadge) {
        dom.inspectorFilterStatusBadge.textContent = getFilterLabel(filter);
        if (filter && filter !== 'none') {
            dom.inspectorFilterStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold';
        } else {
            dom.inspectorFilterStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700 font-mono';
        }
    }
    if (dom.inspectorFilterIntensityContainer) {
        dom.inspectorFilterIntensityContainer.classList.toggle('hidden', !filter || filter === 'none');
    }
}

export function applyInspectorMediaFilter(filter: string, intensity: number = 100) {
    if (!dom.inspectorMediaContainer) return;
    const mediaEl = dom.inspectorMediaContainer.querySelector('img, video') as HTMLElement;
    if (!mediaEl) return;
    const filterCss = getShotFilterCss(filter, intensity);
    mediaEl.style.filter = filterCss !== 'none' ? filterCss : '';
    mediaEl.style.transition = 'filter 0.2s ease';
}

export function applyFilterToActiveShot(filter: string) {
    if (!activeShotId) return;
    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (!targetItem) return;

    const intensity = dom.inspectorFilterIntensitySlider ? (parseInt(dom.inspectorFilterIntensitySlider.value, 10) || 100) : 100;
    targetItem.shot.colorFilter = filter;
    targetItem.shot.colorFilterIntensity = intensity;

    const clip = timelineState.clips?.find((c: any) => c.id === targetItem.shot.id);
    if (clip) {
        clip.colorFilter = filter;
        clip.colorFilterIntensity = intensity;
    }

    updateInspectorFilterUIState(filter);
    applyInspectorMediaFilter(filter, intensity);

    if (timelineState.videoGenerated && !state.isVideoPlaying) {
        drawVideoFrame(state.videoPauseTime || 0);
    }

    if (dom.resultsContainer) {
        const cardEl = dom.resultsContainer.querySelector(`.prompt-item[data-id="${targetItem.shot.id}"]`);
        if (cardEl) {
            const cardMedia = cardEl.querySelector('.img-container video, .img-container img') as HTMLElement;
            if (cardMedia) {
                const fCss = getShotFilterCss(filter, intensity);
                cardMedia.style.filter = fCss !== 'none' ? fCss : '';
            }
        }
    }
}

export interface FlatShotItem {
    shot: any;
    label: string;
    sceneIndex: number;
    lineIndex: number;
}

/**
 * Helper to get a flat list of all shots in current storyboard
 */
export function getAllStoryboardShots(): FlatShotItem[] {
    const items: FlatShotItem[] = [];
    if (!state.currentScenes || !Array.isArray(state.currentScenes)) return items;

    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';

    if (isPaced) {
        state.currentScenes.forEach((shot: any, index: number) => {
            items.push({
                shot,
                label: `Shot ${shot.shot_number || index + 1}`,
                sceneIndex: 0,
                lineIndex: index
            });
        });
    } else {
        state.currentScenes.forEach((scene: any, sIdx: number) => {
            if (scene.lines && Array.isArray(scene.lines)) {
                scene.lines.forEach((shot: any, lIdx: number) => {
                    items.push({
                        shot,
                        label: `Shot ${sIdx + 1}.${lIdx + 1}`,
                        sceneIndex: sIdx,
                        lineIndex: lIdx
                    });
                });
            }
        });
    }

    return items;
}

/**
 * Open Inspector Drawer for a specific shot ID (or first shot if omitted)
 */
export function openInspectorForShot(shotId?: string) {
    const allShots = getAllStoryboardShots();
    if (allShots.length === 0) {
        showStatus('No storyboard shots available to inspect. Generate a script first.', true);
        return;
    }

    let target = allShots[0];
    if (shotId) {
        const found = allShots.find(item => item.shot.id === shotId);
        if (found) target = found;
    }

    activeShotId = target.shot.id;
    const shot = target.shot;

    // Update Drawer Header Badge
    if (dom.inspectorShotBadge) {
        dom.inspectorShotBadge.textContent = target.label;
    }

    // Narrative Text
    if (dom.inspectorNarrativeText) {
        dom.inspectorNarrativeText.textContent = `"${shot.text_reference || shot.line_text || 'No text reference'}"`;
    }

    // Video In-Point (Trim/Offset) Settings
    const hasVideo = !!(shot._videoObjectURL || shot.video_id);
    if (dom.inspectorVideoTrimContainer) {
        if (hasVideo) {
            dom.inspectorVideoTrimContainer.classList.remove('hidden');
            const offsetVal = typeof shot.videoStartOffset === 'number' ? shot.videoStartOffset : 0;
            if (dom.inspectorVideoOffsetSlider) dom.inspectorVideoOffsetSlider.value = String(offsetVal);
            if (dom.inspectorVideoOffsetInput) dom.inspectorVideoOffsetInput.value = String(offsetVal);
            if (dom.inspectorVideoOffsetValText) dom.inspectorVideoOffsetValText.textContent = `${offsetVal.toFixed(1)}s`;
            
            const shotDur = shot.duration_seconds || 3.0;
            updateInspectorVideoRangeInfo(offsetVal, shotDur);
        } else {
            dom.inspectorVideoTrimContainer.classList.add('hidden');
        }
    }

    // Media Preview Box
    if (dom.inspectorMediaContainer) {
        const videoSrc = shot._videoObjectURL || '';
        const displaySrc = shot._imageObjectURL || (shot.image_id ? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23111827"/%3E%3Ctext x="50" y="50" dominant-baseline="middle" text-anchor="middle" fill="%23374151" font-size="10"%3ELoading...%3C/text%3E%3C/svg%3E' : '');

        if (videoSrc) {
            dom.inspectorMediaContainer.innerHTML = `
                <div class="relative w-full h-full group bg-black rounded-lg overflow-hidden flex flex-col justify-end select-none">
                    <video src="${videoSrc}" class="w-full h-full object-contain bg-black cursor-pointer rounded-lg" loop muted playsinline preload="auto"></video>
                    
                    <!-- Center Play/Pause indicator overlay -->
                    <div id="inspector-video-center-overlay" class="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-150">
                        <div class="w-11 h-11 rounded-full bg-black/65 backdrop-blur-md border border-white/20 flex items-center justify-center text-white text-base shadow-xl">
                            <span id="inspector-video-center-icon">▶</span>
                        </div>
                    </div>

                    <!-- Bottom Persistent Controls Toolbar -->
                    <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent p-2 flex items-center justify-between gap-1 z-10">
                        <div class="flex items-center gap-1">
                            <button type="button" id="inspector-video-play-btn" class="px-2 py-1 bg-white/20 hover:bg-white/30 active:bg-white/40 text-white rounded text-[11px] font-bold transition flex items-center gap-1 cursor-pointer" title="Play / Pause (Click video or button)">
                                <span id="inspector-video-btn-icon">▶</span>
                                <span id="inspector-video-btn-text">Play</span>
                            </button>
                            <button type="button" id="inspector-video-step-back-btn" class="px-1.5 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white/90 rounded text-[10px] font-mono transition cursor-pointer" title="Step Back 0.1s (Previous Frame)">
                                ◀ -0.1s
                            </button>
                            <button type="button" id="inspector-video-step-fwd-btn" class="px-1.5 py-1 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white/90 rounded text-[10px] font-mono transition cursor-pointer" title="Step Forward 0.1s (Next Frame)">
                                +0.1s ▶
                            </button>
                        </div>
                        <div class="flex items-center gap-1 font-mono text-[10px] text-white/90 bg-black/60 px-2 py-0.5 rounded border border-white/10">
                            <span id="inspector-video-current-time">0.0s</span>
                            <span class="text-white/40">/</span>
                            <span id="inspector-video-total-duration">0.0s</span>
                        </div>
                    </div>
                </div>`;

            const vidEl = dom.inspectorMediaContainer.querySelector('video') as HTMLVideoElement;
            const playBtn = dom.inspectorMediaContainer.querySelector('#inspector-video-play-btn') as HTMLButtonElement;
            const btnIcon = dom.inspectorMediaContainer.querySelector('#inspector-video-btn-icon') as HTMLElement;
            const btnText = dom.inspectorMediaContainer.querySelector('#inspector-video-btn-text') as HTMLElement;
            const centerOverlay = dom.inspectorMediaContainer.querySelector('#inspector-video-center-overlay') as HTMLElement;
            const centerIcon = dom.inspectorMediaContainer.querySelector('#inspector-video-center-icon') as HTMLElement;
            const stepBackBtn = dom.inspectorMediaContainer.querySelector('#inspector-video-step-back-btn') as HTMLButtonElement;
            const stepFwdBtn = dom.inspectorMediaContainer.querySelector('#inspector-video-step-fwd-btn') as HTMLButtonElement;
            const currentTimeEl = dom.inspectorMediaContainer.querySelector('#inspector-video-current-time') as HTMLElement;
            const totalDurationEl = dom.inspectorMediaContainer.querySelector('#inspector-video-total-duration') as HTMLElement;

            const updatePlayStateUI = (isPlaying: boolean) => {
                if (btnIcon) btnIcon.textContent = isPlaying ? '⏸' : '▶';
                if (btnText) btnText.textContent = isPlaying ? 'Pause' : 'Play';
                if (centerIcon) centerIcon.textContent = isPlaying ? '⏸' : '▶';
                if (centerOverlay) {
                    if (isPlaying) {
                        centerOverlay.classList.add('opacity-0');
                    } else {
                        centerOverlay.classList.remove('opacity-0');
                    }
                }
            };

            const togglePlay = () => {
                if (!vidEl) return;
                if (vidEl.paused) {
                    vidEl.play().then(() => updatePlayStateUI(true)).catch(() => {});
                } else {
                    vidEl.pause();
                    updatePlayStateUI(false);
                }
            };

            if (vidEl) {
                vidEl.addEventListener('click', togglePlay);
                if (playBtn) playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });

                if (stepBackBtn) {
                    stepBackBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        vidEl.pause();
                        updatePlayStateUI(false);
                        vidEl.currentTime = Math.max(0, vidEl.currentTime - 0.1);
                    });
                }

                if (stepFwdBtn) {
                    stepFwdBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        vidEl.pause();
                        updatePlayStateUI(false);
                        const dur = vidEl.duration || 60;
                        vidEl.currentTime = Math.min(dur, vidEl.currentTime + 0.1);
                    });
                }

                vidEl.addEventListener('timeupdate', () => {
                    if (currentTimeEl) {
                        currentTimeEl.textContent = `${vidEl.currentTime.toFixed(1)}s`;
                    }
                });

                vidEl.addEventListener('play', () => updatePlayStateUI(true));
                vidEl.addEventListener('pause', () => updatePlayStateUI(false));

                const onMetadata = () => {
                    const vidDur = vidEl.duration || 0;
                    const maxVal = Math.max(0.1, Math.floor(vidDur * 10) / 10);
                    if (dom.inspectorVideoOffsetSlider) {
                        dom.inspectorVideoOffsetSlider.max = String(maxVal);
                    }
                    if (totalDurationEl) {
                        totalDurationEl.textContent = `${vidDur.toFixed(1)}s`;
                    }
                    if (dom.inspectorVideoDurationBadge) {
                        const shotDur = shot.duration_seconds || 3.0;
                        dom.inspectorVideoDurationBadge.textContent = `Clip: ${shotDur.toFixed(1)}s | Video: ${vidDur.toFixed(1)}s`;
                    }
                    const offsetVal = typeof shot.videoStartOffset === 'number' ? shot.videoStartOffset : 0;
                    if (offsetVal > 0) {
                        try { vidEl.currentTime = offsetVal; } catch (e) { }
                    }
                    if (currentTimeEl) {
                        currentTimeEl.textContent = `${(offsetVal || 0).toFixed(1)}s`;
                    }
                    updatePlayStateUI(false);
                };

                if (vidEl.readyState >= 1) {
                    onMetadata();
                } else {
                    vidEl.addEventListener('loadedmetadata', onMetadata, { once: true });
                }
            }
        } else if (displaySrc) {
            const focalX = shot.focalPoint ? shot.focalPoint.x * 100 : 50;
            const focalY = shot.focalPoint ? shot.focalPoint.y * 100 : 50;
            dom.inspectorMediaContainer.innerHTML = `
                <div class="relative w-full h-full group cursor-crosshair">
                    <img src="${displaySrc}" class="w-full h-full object-cover rounded-lg pointer-events-none">
                    <div id="inspector-focal-point" class="absolute w-4 h-4 border-2 border-green-400 rounded-full transform -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-[0_0_4px_rgba(0,0,0,0.5)] bg-green-400/30" style="left: ${focalX}%; top: ${focalY}%; transition: all 0.2s ease-out;"></div>
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                        <span class="text-white text-xs font-medium px-2 py-1 bg-black/60 rounded">Click to set focal point</span>
                    </div>
                </div>`;
            
            const interactiveArea = dom.inspectorMediaContainer.firstElementChild as HTMLElement;
            if (interactiveArea) {
                interactiveArea.addEventListener('click', (e) => {
                    const imgEl = interactiveArea.querySelector('img') as HTMLImageElement;
                    const rect = interactiveArea.getBoundingClientRect();
                    
                    let x: number, y: number;
                    if (imgEl && imgEl.naturalWidth && imgEl.naturalHeight) {
                        const containerAspect = rect.width / rect.height;
                        const naturalAspect = imgEl.naturalWidth / imgEl.naturalHeight;

                        if (naturalAspect > containerAspect) {
                            // image cropped left/right to fill
                            const displayedWidth = rect.height * naturalAspect;
                            const cropX = (displayedWidth - rect.width) / 2;
                            x = ((e.clientX - rect.left) + cropX) / displayedWidth;
                            y = (e.clientY - rect.top) / rect.height;
                        } else {
                            // image cropped top/bottom to fill
                            const displayedHeight = rect.width / naturalAspect;
                            const cropY = (displayedHeight - rect.height) / 2;
                            x = (e.clientX - rect.left) / rect.width;
                            y = ((e.clientY - rect.top) + cropY) / displayedHeight;
                        }
                    } else {
                        // fallback
                        x = (e.clientX - rect.left) / rect.width;
                        y = (e.clientY - rect.top) / rect.height;
                    }
                    
                    shot.focalPoint = {
                        x: Math.max(0, Math.min(1, x)),
                        y: Math.max(0, Math.min(1, y))
                    };
                    
                    const focalDot = document.getElementById('inspector-focal-point');
                    if (focalDot) {
                        focalDot.style.left = `${shot.focalPoint.x * 100}%`;
                        focalDot.style.top = `${shot.focalPoint.y * 100}%`;
                        focalDot.animate([
                            { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 1 },
                            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
                        ], { duration: 300, easing: 'ease-out' });
                    }
                    
                    // Mark as needing sync/render
                    if (dom.inspectorApplyBtn) {
                        dom.inspectorApplyBtn.click();
                    }
                });
            }
        } else {
            dom.inspectorMediaContainer.innerHTML = `<span class="text-xs text-gray-500 italic">No image or video generated yet</span>`;
        }
    }

    // Camera Angle
    const currentAngle = shot.camera_angle || shot.camera_movement || 'default';
    if (dom.inspectorCameraAngleSelect) {
        const knownOptions = Array.from(dom.inspectorCameraAngleSelect.options).map(o => o.value);
        if (knownOptions.includes(currentAngle)) {
            dom.inspectorCameraAngleSelect.value = currentAngle;
            if (dom.inspectorCustomAngleContainer) dom.inspectorCustomAngleContainer.classList.add('hidden');
        } else {
            dom.inspectorCameraAngleSelect.value = 'custom';
            if (dom.inspectorCustomAngleContainer) dom.inspectorCustomAngleContainer.classList.remove('hidden');
            if (dom.inspectorCustomAngleInput) dom.inspectorCustomAngleInput.value = currentAngle;
        }
    }

    // Camera Movement & Keyframes
    const currentMovement = shot.camera_movement || 'static';
    if (dom.inspectorCameraMovementSelect) {
        if (shot.cameraKeyframes && !['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'pan_slow', 'dolly_zoom', 'whip_pan'].includes(currentMovement)) {
            dom.inspectorCameraMovementSelect.value = 'custom_keyframes';
        } else {
            dom.inspectorCameraMovementSelect.value = currentMovement;
        }
    }
    populateInspectorKeyframeUI(shot);

    // Display Mode & PiP Settings
    const timelineClip = timelineState.clips?.find((c: any) => c.id === shot.id);
    const activeDisplayMode = shot.displayMode || timelineClip?.displayMode || 'fullscreen';
    const activePipPos = shot.pipPosition || timelineClip?.pipPosition || 'top_right';
    const activePipAnim = shot.pipAnimation || timelineClip?.pipAnimation || 'pop_spring';
    const activePipScale = typeof shot.pipScale === 'number' ? shot.pipScale : (typeof timelineClip?.pipScale === 'number' ? timelineClip.pipScale : 0.36);

    if (dom.inspectorDisplayModeSelect) {
        dom.inspectorDisplayModeSelect.value = activeDisplayMode;
    }
    if (dom.inspectorPipControls) {
        if (activeDisplayMode === 'pip_overlay') {
            dom.inspectorPipControls.classList.remove('hidden');
        } else {
            dom.inspectorPipControls.classList.add('hidden');
        }
    }
    if (dom.inspectorPipPositionSelect) {
        dom.inspectorPipPositionSelect.value = activePipPos;
    }
    if (dom.inspectorPipAnimationSelect) {
        dom.inspectorPipAnimationSelect.value = activePipAnim;
    }
    if (dom.inspectorPipScaleRange && dom.inspectorPipScaleVal) {
        const scalePct = Math.round(activePipScale * 100);
        dom.inspectorPipScaleRange.value = String(scalePct);
        dom.inspectorPipScaleVal.textContent = `${scalePct}%`;
    }

    // Talking Head Settings
    if (dom.inspectorTalkingHeadModeSelect) {
        const mode = shot.talkingHeadMode || 'none';
        dom.inspectorTalkingHeadModeSelect.value = mode;
        const hasArollOrSecondary = !!(
            state.uploadedVideoElement ||
            shot.secondary_video_id ||
            shot._secondaryVideoObjectURL ||
            shot.secondary_image_id ||
            shot._secondaryImageObjectURL ||
            shot.video_id ||
            shot._videoObjectURL ||
            shot.preserveContent
        );
        Array.from(dom.inspectorTalkingHeadModeSelect.options).forEach(opt => {
            if (opt.value === 'none' || opt.value === 'split') {
                opt.disabled = false;
            } else {
                opt.disabled = !hasArollOrSecondary;
            }
        });
        if (dom.inspectorTalkingHeadHint) {
            if (mode === 'full' && (shot.text_reference || timelineState.globalWordTimestamps?.length)) {
                dom.inspectorTalkingHeadHint.classList.remove('hidden');
            } else {
                dom.inspectorTalkingHeadHint.classList.add('hidden');
            }
        }
    }
    if (dom.inspectorPreserveContentToggle) {
        dom.inspectorPreserveContentToggle.checked = !!shot.preserveContent;
    }
    if (dom.inspectorDualMediaPanel) {
        const hasSecondary = !!(shot.secondary_image_id || shot._secondaryImageObjectURL || shot.secondary_video_id || shot._secondaryVideoObjectURL);
        const shouldShowDual = shot.talkingHeadMode === 'split' || !!shot.preserveContent || hasSecondary;
        dom.inspectorDualMediaPanel.classList.toggle('hidden', !shouldShowDual);
        
        // Update Layer 1 label & badge
        if (dom.inspectorLayer1Label && dom.inspectorLayer1Badge) {
            if (shot._videoObjectURL || shot.video_id) {
                dom.inspectorLayer1Label.textContent = 'Primary Video';
                dom.inspectorLayer1Badge.textContent = 'Video';
            } else if (shot._imageObjectURL || shot.image_id) {
                dom.inspectorLayer1Label.textContent = 'Primary Image';
                dom.inspectorLayer1Badge.textContent = 'Image';
            } else {
                dom.inspectorLayer1Label.textContent = 'Primary Layer';
                dom.inspectorLayer1Badge.textContent = 'Empty';
            }
        }
        // Update Layer 2 label & badge
        if (dom.inspectorLayer2Label && dom.inspectorLayer2Badge) {
            if (shot._secondaryVideoObjectURL || shot.secondary_video_id) {
                dom.inspectorLayer2Label.textContent = '2nd Video (A-Roll)';
                dom.inspectorLayer2Badge.textContent = 'Video';
            } else if (shot._secondaryImageObjectURL || shot.secondary_image_id) {
                dom.inspectorLayer2Label.textContent = '2nd Image';
                dom.inspectorLayer2Badge.textContent = 'Image';
            } else if (state.uploadedVideoElement) {
                dom.inspectorLayer2Label.textContent = 'Project A-Roll Video';
                dom.inspectorLayer2Badge.textContent = 'Global';
            } else {
                dom.inspectorLayer2Label.textContent = '2nd Layer (Split/PiP)';
                dom.inspectorLayer2Badge.textContent = 'Empty';
            }
        }
        if (dom.inspectorClearLayer2Btn) {
            dom.inspectorClearLayer2Btn.classList.toggle('hidden', !hasSecondary);
        }
    }
    if (dom.inspectorTalkingHeadShapeSelect) {
        dom.inspectorTalkingHeadShapeSelect.value = shot.talkingHeadShape || state.talkingHeadShape || 'circle';
    }
    if (dom.inspectorTalkingHeadSizeSelect) {
        dom.inspectorTalkingHeadSizeSelect.value = shot.talkingHeadSize || state.talkingHeadSize || 'medium';
    }
    if (dom.inspectorUseOriginalAudio) {
        dom.inspectorUseOriginalAudio.checked = !!shot.useOriginalAudio;
    }
    if (dom.inspectorClipDevice) {
        dom.inspectorClipDevice.value = shot.deviceTag || '';
    }
    if (dom.inspectorClipRotation) {
        dom.inspectorClipRotation.value = String(shot.rotate || 0);
    }
    if (dom.inspectorClipAudioControls) {
        if (shot.useOriginalAudio) {
            dom.inspectorClipAudioControls.classList.remove('hidden');
            if (dom.inspectorAudioStackWarning) {
                if (timelineState.globalWordTimestamps?.length) {
                    dom.inspectorAudioStackWarning.classList.remove('hidden');
                } else {
                    dom.inspectorAudioStackWarning.classList.add('hidden');
                }
            }
        } else {
            dom.inspectorClipAudioControls.classList.add('hidden');
        }
    }
    const clipVolume = (shot.volume !== undefined) ? shot.volume : 1.0;
    if (dom.inspectorClipVolumeSlider) {
        dom.inspectorClipVolumeSlider.value = String(clipVolume);
    }
    if (dom.inspectorClipVolumeLabel) {
        dom.inspectorClipVolumeLabel.textContent = `${Math.round(clipVolume * 100)}%`;
    }
    if (dom.inspectorClipDuckingCheckbox) {
        dom.inspectorClipDuckingCheckbox.checked = shot.audioDuckingOverride !== false;
    }
    if (dom.inspectorClipSoloAudioCheckbox) {
        dom.inspectorClipSoloAudioCheckbox.checked = !!(shot.soloAudio || shot.muteNarration);
    }
    if (dom.inspectorClipFadeIn) {
        dom.inspectorClipFadeIn.value = String(shot.fadeIn || 0);
    }
    if (dom.inspectorClipFadeOut) {
        dom.inspectorClipFadeOut.value = String(shot.fadeOut || 0);
    }
    const clipPlaybackRate = (shot.playbackRate !== undefined) ? shot.playbackRate : 1.0;
    if (dom.inspectorClipSpeedSlider) {
        dom.inspectorClipSpeedSlider.value = String(clipPlaybackRate);
    }
    if (dom.inspectorClipSpeedLabel) {
        dom.inspectorClipSpeedLabel.textContent = `${clipPlaybackRate}x`;
    }

    // Lighting Preset & Prompt
    if (dom.inspectorLightingPromptInput) {
        dom.inspectorLightingPromptInput.value = shot.lighting_prompt || '';
    }
    if (dom.inspectorLightingPresetSelect) {
        dom.inspectorLightingPresetSelect.value = 'custom';
    }

    // Duration
    const durationVal = shot.duration_seconds || 3.0;
    if (dom.inspectorDurationSlider) dom.inspectorDurationSlider.value = String(durationVal);
    if (dom.inspectorDurationInput) dom.inspectorDurationInput.value = String(durationVal);

    // Media Duration Helper
    const mediaDuration = shot._videoDuration || shot.mediaDuration || 0;
    if (dom.inspectorFitDurationContainer && dom.inspectorMediaDurationText) {
        if (mediaDuration > 0) {
            dom.inspectorFitDurationContainer.classList.remove('hidden');
            dom.inspectorMediaDurationText.textContent = `${mediaDuration.toFixed(1)}s`;
        } else {
            dom.inspectorFitDurationContainer.classList.add('hidden');
        }
    }

    // Visual Prompts
    if (dom.inspectorImagePromptInput) dom.inspectorImagePromptInput.value = shot.image_prompt || '';
    if (dom.inspectorBRollPromptInput) dom.inspectorBRollPromptInput.value = shot.b_roll_prompt || '';

    // Storyboard Intelligence metadata
    const typeBadge = document.getElementById('inspector-visual-type-badge');
    const funcBadge = document.getElementById('inspector-narrative-function-badge');
    const conceptText = document.getElementById('inspector-visual-concept-text');
    const conceptRow = document.getElementById('inspector-concept-row');
    const actionText = document.getElementById('inspector-action-text');
    const actionRow = document.getElementById('inspector-action-row');
    const subjectsText = document.getElementById('inspector-subjects-text');
    const subjectsRow = document.getElementById('inspector-subjects-row');
    const envText = document.getElementById('inspector-environment-text');
    const envRow = document.getElementById('inspector-environment-row');
    const compText = document.getElementById('inspector-composition-text');
    const compRow = document.getElementById('inspector-composition-row');
    const contText = document.getElementById('inspector-continuity-text');
    const contRow = document.getElementById('inspector-continuity-row');

    if (typeBadge) {
        if (shot.visual_type) {
            typeBadge.textContent = `🎯 ${String(shot.visual_type).replace(/_/g, ' ')}`;
            typeBadge.classList.remove('hidden');
        } else {
            typeBadge.classList.add('hidden');
        }
    }
    if (funcBadge) {
        if (shot.narrative_function) {
            funcBadge.textContent = `📐 Role: ${String(shot.narrative_function).replace(/_/g, ' ')}`;
            funcBadge.classList.remove('hidden');
        } else {
            funcBadge.classList.add('hidden');
        }
    }
    if (conceptText && conceptRow) {
        if (shot.visual_concept) {
            conceptText.textContent = shot.visual_concept;
            conceptRow.classList.remove('hidden');
        } else {
            conceptRow.classList.add('hidden');
        }
    }
    if (actionText && actionRow) {
        if (shot.action) {
            actionText.textContent = shot.action;
            actionRow.classList.remove('hidden');
        } else {
            actionRow.classList.add('hidden');
        }
    }
    if (subjectsText && subjectsRow) {
        const subs = Array.isArray(shot.subjects) && shot.subjects.length > 0 ? shot.subjects.join(', ') : '';
        if (subs) {
            subjectsText.textContent = subs;
            subjectsRow.classList.remove('hidden');
        } else {
            subjectsRow.classList.add('hidden');
        }
    }
    if (envText && envRow) {
        if (shot.environment) {
            envText.textContent = shot.environment;
            envRow.classList.remove('hidden');
        } else {
            envRow.classList.add('hidden');
        }
    }
    if (compText && compRow) {
        if (shot.composition) {
            compText.textContent = shot.composition;
            compRow.classList.remove('hidden');
        } else {
            compRow.classList.add('hidden');
        }
    }
    if (contText && contRow) {
        if (shot.continuity_notes) {
            contText.textContent = shot.continuity_notes;
            contRow.classList.remove('hidden');
        } else {
            contRow.classList.add('hidden');
        }
    }

    // Animate button state
    if (dom.inspectorAnimateBtn) {
        const hasImg = !!shot._imageObjectURL;
        dom.inspectorAnimateBtn.disabled = !hasImg;
        if (hasImg) {
            dom.inspectorAnimateBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        } else {
            dom.inspectorAnimateBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
    }

    // Color Filter & Quick Preset UI
    const activeFilter = shot.colorFilter || 'none';
    const filterIntensity = typeof shot.colorFilterIntensity === 'number' ? shot.colorFilterIntensity : 100;
    if (dom.inspectorColorFilterSelect) {
        dom.inspectorColorFilterSelect.value = activeFilter;
    }
    if (dom.inspectorFilterIntensitySlider) {
        dom.inspectorFilterIntensitySlider.value = String(filterIntensity);
    }
    if (dom.inspectorFilterIntensityVal) {
        dom.inspectorFilterIntensityVal.textContent = `${filterIntensity}%`;
    }
    updateInspectorFilterUIState(activeFilter);
    applyInspectorMediaFilter(activeFilter, filterIntensity);

    // Show Drawer with Smooth Animation
    if (dom.shotInspectorDrawer) {
        dom.shotInspectorDrawer.classList.remove('hidden');
        requestAnimationFrame(() => {
            dom.shotInspectorDrawer.classList.remove('translate-x-full');
        });
    }

    // Highlight target shot card in storyboard grid
    highlightShotCard(target.shot.id);

    // Refresh visual position glyphs and speed preset chips
    mountInspectorPositionGlyphs();
    mountInspectorSpeedChips();
}

/**
 * Close Inspector Drawer
 */
export function closeInspector() {
    if (!dom.shotInspectorDrawer) return;
    if (dom.inspectorMediaContainer) {
        const vidEl = dom.inspectorMediaContainer.querySelector('video') as HTMLVideoElement;
        if (vidEl) {
            try { vidEl.pause(); } catch (e) { }
        }
    }
    dom.shotInspectorDrawer.classList.add('translate-x-full');
    setTimeout(() => {
        dom.shotInspectorDrawer?.classList.add('hidden');
    }, 300);
    clearShotCardHighlight();
}

/**
 * Toggle Inspector Drawer open/close
 */
export function toggleInspector() {
    if (!dom.shotInspectorDrawer) return;
    if (dom.shotInspectorDrawer.classList.contains('hidden') || dom.shotInspectorDrawer.classList.contains('translate-x-full')) {
        openInspectorForShot(activeShotId || undefined);
    } else {
        closeInspector();
    }
}

/**
 * Navigate to previous (-1) or next (+1) shot in inspector
 */
export function navigateInspectorShot(direction: number) {
    const allShots = getAllStoryboardShots();
    if (allShots.length === 0) return;

    let currentIndex = allShots.findIndex(item => item.shot.id === activeShotId);
    if (currentIndex === -1) currentIndex = 0;

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = allShots.length - 1;
    if (newIndex >= allShots.length) newIndex = 0;

    openInspectorForShot(allShots[newIndex].shot.id);
}

/**
 * Helper to populate inspector keyframe sliders and values from shot config
 */
export function populateInspectorKeyframeUI(shot: any) {
    const kf: CameraKeyframesConfig = shot.cameraKeyframes || presetToKeyframes(shot.camera_movement || 'static');

    if (dom.inspectorKfStartScale) dom.inspectorKfStartScale.value = String(kf.start.scale);
    if (dom.inspectorKfStartScaleVal) dom.inspectorKfStartScaleVal.textContent = `${kf.start.scale.toFixed(2)}x`;
    if (dom.inspectorKfStartRot) dom.inspectorKfStartRot.value = String(kf.start.rotation || 0);
    if (dom.inspectorKfStartRotVal) dom.inspectorKfStartRotVal.textContent = `${Math.round(kf.start.rotation || 0)}°`;
    if (dom.inspectorKfStartX) dom.inspectorKfStartX.value = String(Math.round((kf.start.x || 0) * 100));
    if (dom.inspectorKfStartXVal) dom.inspectorKfStartXVal.textContent = `${Math.round((kf.start.x || 0) * 100)}%`;
    if (dom.inspectorKfStartY) dom.inspectorKfStartY.value = String(Math.round((kf.start.y || 0) * 100));
    if (dom.inspectorKfStartYVal) dom.inspectorKfStartYVal.textContent = `${Math.round((kf.start.y || 0) * 100)}%`;

    if (dom.inspectorKfEndScale) dom.inspectorKfEndScale.value = String(kf.end.scale);
    if (dom.inspectorKfEndScaleVal) dom.inspectorKfEndScaleVal.textContent = `${kf.end.scale.toFixed(2)}x`;
    if (dom.inspectorKfEndRot) dom.inspectorKfEndRot.value = String(kf.end.rotation || 0);
    if (dom.inspectorKfEndRotVal) dom.inspectorKfEndRotVal.textContent = `${Math.round(kf.end.rotation || 0)}°`;
    if (dom.inspectorKfEndX) dom.inspectorKfEndX.value = String(Math.round((kf.end.x || 0) * 100));
    if (dom.inspectorKfEndXVal) dom.inspectorKfEndXVal.textContent = `${Math.round((kf.end.x || 0) * 100)}%`;
    if (dom.inspectorKfEndY) dom.inspectorKfEndY.value = String(Math.round((kf.end.y || 0) * 100));
    if (dom.inspectorKfEndYVal) dom.inspectorKfEndYVal.textContent = `${Math.round((kf.end.y || 0) * 100)}%`;

    if (dom.inspectorKfEasingSelect) dom.inspectorKfEasingSelect.value = kf.easing || 'ease-in-out';

    updateKeyframeSummaries(kf);

    // If movement is custom or keyframes exist, display container
    const isCustom = dom.inspectorCameraMovementSelect?.value === 'custom_keyframes';
    if (dom.inspectorKeyframesContainer) {
        if (isCustom) {
            dom.inspectorKeyframesContainer.classList.remove('hidden');
        }
    }
}

function updateKeyframeSummaries(kf: CameraKeyframesConfig) {
    if (dom.inspectorKfStartSummary) {
        dom.inspectorKfStartSummary.textContent = `${kf.start.scale.toFixed(2)}x (${Math.round((kf.start.x || 0) * 100)}%, ${Math.round((kf.start.y || 0) * 100)}%)`;
    }
    if (dom.inspectorKfEndSummary) {
        dom.inspectorKfEndSummary.textContent = `${kf.end.scale.toFixed(2)}x (${Math.round((kf.end.x || 0) * 100)}%, ${Math.round((kf.end.y || 0) * 100)}%)`;
    }
}

/**
 * Sync active keyframe slider values to active shot & timeline clip for real-time live preview
 */
function syncActiveKeyframesFromSliders() {
    if (!activeShotId) return;
    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (!targetItem) return;

    const shot = targetItem.shot;
    const startScale = dom.inspectorKfStartScale ? parseFloat(dom.inspectorKfStartScale.value) || 1.0 : 1.0;
    const startRot = dom.inspectorKfStartRot ? parseFloat(dom.inspectorKfStartRot.value) || 0 : 0;
    const startX = dom.inspectorKfStartX ? (parseFloat(dom.inspectorKfStartX.value) || 0) / 100 : 0;
    const startY = dom.inspectorKfStartY ? (parseFloat(dom.inspectorKfStartY.value) || 0) / 100 : 0;

    const endScale = dom.inspectorKfEndScale ? parseFloat(dom.inspectorKfEndScale.value) || 1.0 : 1.0;
    const endRot = dom.inspectorKfEndRot ? parseFloat(dom.inspectorKfEndRot.value) || 0 : 0;
    const endX = dom.inspectorKfEndX ? (parseFloat(dom.inspectorKfEndX.value) || 0) / 100 : 0;
    const endY = dom.inspectorKfEndY ? (parseFloat(dom.inspectorKfEndY.value) || 0) / 100 : 0;

    const easing = (dom.inspectorKfEasingSelect?.value || 'ease-in-out') as any;

    const kf: CameraKeyframesConfig = {
        start: { scale: startScale, x: startX, y: startY, rotation: startRot },
        end: { scale: endScale, x: endX, y: endY, rotation: endRot },
        easing
    };

    shot.cameraKeyframes = kf;
    shot.camera_movement = dom.inspectorCameraMovementSelect?.value || 'custom_keyframes';

    updateKeyframeSummaries(kf);

    // Sync to timeline clip
    const clip = timelineState.clips?.find((c: any) => c.id === shot.id);
    if (clip) {
        clip.cameraKeyframes = kf;
        clip.cameraMovement = shot.camera_movement;
    }

    if (timelineState.videoGenerated && !state.isVideoPlaying) {
        drawVideoFrame(state.videoPauseTime || 0);
    }
}

/**
 * Helper to update video clip play range info text in inspector
 */
function updateInspectorVideoRangeInfo(offset: number, duration: number) {
    if (dom.inspectorVideoPlayRangeInfo) {
        const start = offset.toFixed(1);
        const end = (offset + duration).toFixed(1);
        dom.inspectorVideoPlayRangeInfo.textContent = `Plays from ${start}s to ${end}s (${duration.toFixed(1)}s segment)`;
    }
}

/**
 * Sync active shot video offset change across inspector preview, timeline clip, and player
 */
function syncActiveShotVideoOffset(newOffset: number) {
    if (!activeShotId) return;
    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (!targetItem) return;

    const shot = targetItem.shot;
    shot.videoStartOffset = Math.max(0, newOffset);

    // Update range info text
    const shotDur = shot.duration_seconds || 3.0;
    updateInspectorVideoRangeInfo(shot.videoStartOffset, shotDur);

    // Seek preview video in inspector and freeze frame on scrub
    if (dom.inspectorMediaContainer) {
        const vidEl = dom.inspectorMediaContainer.querySelector('video') as HTMLVideoElement;
        if (vidEl) {
            try { vidEl.pause(); } catch (e) { }
            try { vidEl.currentTime = shot.videoStartOffset; } catch (e) { }
        }
        const currentTimeEl = dom.inspectorMediaContainer.querySelector('#inspector-video-current-time') as HTMLElement;
        if (currentTimeEl) {
            currentTimeEl.textContent = `${shot.videoStartOffset.toFixed(1)}s`;
        }
    }

    // Sync to timeline clip
    const clip = timelineState.clips?.find((c: any) => c.id === shot.id);
    if (clip) {
        clip.videoStartOffset = shot.videoStartOffset;
    }

    if (timelineState.videoGenerated && !state.isVideoPlaying) {
        updateVideoContext();
        drawVideoFrame(state.videoPauseTime || 0);
    }
}

/**
 * Save Inspector edits back to shot and update UI
 */
export function saveInspectorMetadata() {
    if (!activeShotId) return;

    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (!targetItem) return;

    const shot = targetItem.shot;

    // Camera Angle
    let selectedAngle = dom.inspectorCameraAngleSelect ? dom.inspectorCameraAngleSelect.value : 'default';
    if (selectedAngle === 'custom' && dom.inspectorCustomAngleInput) {
        selectedAngle = dom.inspectorCustomAngleInput.value.trim() || 'default';
    }

    // Camera Movement
    const selectedMovement = dom.inspectorCameraMovementSelect ? dom.inspectorCameraMovementSelect.value : 'static';

    // Lighting Prompt
    const lightingText = dom.inspectorLightingPromptInput ? dom.inspectorLightingPromptInput.value.trim() : '';

    // Duration
    const durationVal = dom.inspectorDurationInput ? parseFloat(dom.inspectorDurationInput.value) || 3.0 : 3.0;

    // Talking Head settings
    const talkingHeadMode = dom.inspectorTalkingHeadModeSelect ? dom.inspectorTalkingHeadModeSelect.value : 'none';
    const talkingHeadShape = dom.inspectorTalkingHeadShapeSelect ? dom.inspectorTalkingHeadShapeSelect.value : 'circle';
    const talkingHeadSize = dom.inspectorTalkingHeadSizeSelect ? dom.inspectorTalkingHeadSizeSelect.value : 'medium';
    const useOriginalAudio = dom.inspectorUseOriginalAudio ? dom.inspectorUseOriginalAudio.checked : false;

    // Video Start Offset (In-Point)
    const isMasterVideo = (!shot._videoObjectURL && !!state.uploadedVideoElement) ||
                          (shot._videoObjectURL && state.uploadedVideoElement && shot._videoObjectURL === state.uploadedVideoElement.src) ||
                          (talkingHeadMode !== 'none' && !!state.uploadedVideoElement);
    const defaultOffset = isMasterVideo ? ((timelineState.clips?.find((c: any) => c.id === shot.id)?.startTime) || 0) : 0;
    const hasTrimInput = dom.inspectorVideoTrimContainer && !dom.inspectorVideoTrimContainer.classList.contains('hidden') && dom.inspectorVideoOffsetInput;
    const videoStartOffset = hasTrimInput
        ? Math.max(0, parseFloat(dom.inspectorVideoOffsetInput.value) || 0)
        : (typeof shot.videoStartOffset === 'number' && shot.videoStartOffset !== 0 ? shot.videoStartOffset : defaultOffset);

    // Visual Prompts
    const imgPrompt = dom.inspectorImagePromptInput ? dom.inspectorImagePromptInput.value.trim() : '';
    const brollPrompt = dom.inspectorBRollPromptInput ? dom.inspectorBRollPromptInput.value.trim() : '';

    const deviceTag = dom.inspectorClipDevice ? (dom.inspectorClipDevice.value as any) : undefined;
    const rotate = dom.inspectorClipRotation ? parseInt(dom.inspectorClipRotation.value) : 0;
    const clipVolume = dom.inspectorClipVolumeSlider ? parseFloat(dom.inspectorClipVolumeSlider.value) : 1.0;
    const clipFadeIn = dom.inspectorClipFadeIn ? parseFloat(dom.inspectorClipFadeIn.value) || 0 : 0;
    const clipFadeOut = dom.inspectorClipFadeOut ? parseFloat(dom.inspectorClipFadeOut.value) || 0 : 0;
    const clipPlaybackRate = dom.inspectorClipSpeedSlider ? parseFloat(dom.inspectorClipSpeedSlider.value) || 1.0 : 1.0;
    const audioDuckingOverride = dom.inspectorClipDuckingCheckbox ? dom.inspectorClipDuckingCheckbox.checked : true;

    if (dom.inspectorTalkingHeadHint) {
        if (talkingHeadMode === 'full' && (shot.text_reference || timelineState.globalWordTimestamps?.length)) {
            dom.inspectorTalkingHeadHint.classList.remove('hidden');
        } else {
            dom.inspectorTalkingHeadHint.classList.add('hidden');
        }
    }

    // Apply values to shot object
    shot.camera_angle = selectedAngle;
    shot.camera_movement = selectedMovement;
    shot.lighting_prompt = lightingText;
    shot.duration_seconds = durationVal;
    shot.videoStartOffset = videoStartOffset;
    shot.talkingHeadMode = talkingHeadMode as any;
    shot.talkingHeadShape = talkingHeadShape as any;
    shot.talkingHeadSize = talkingHeadSize as any;
    shot.useOriginalAudio = useOriginalAudio;
    shot.deviceTag = deviceTag || undefined;
    shot.rotate = (rotate === 0 || rotate === 90 || rotate === 180 || rotate === 270) ? rotate : 0;
    shot.volume = clipVolume;
    shot.fadeIn = clipFadeIn;
    shot.fadeOut = clipFadeOut;
    shot.playbackRate = clipPlaybackRate;
    shot.audioDuckingOverride = audioDuckingOverride;
    const preserveContent = dom.inspectorPreserveContentToggle ? dom.inspectorPreserveContentToggle.checked : false;
    const soloAudio = dom.inspectorClipSoloAudioCheckbox ? dom.inspectorClipSoloAudioCheckbox.checked : false;
    shot.preserveContent = preserveContent;
    shot.soloAudio = soloAudio;
    shot.muteNarration = soloAudio;
    if (imgPrompt) shot.image_prompt = imgPrompt;
    if (brollPrompt) shot.b_roll_prompt = brollPrompt;

    // PiP Display Mode & Controls
    const displayMode = dom.inspectorDisplayModeSelect ? (dom.inspectorDisplayModeSelect.value as 'fullscreen' | 'pip_overlay') : (shot.displayMode || 'fullscreen');
    const pipPosition = dom.inspectorPipPositionSelect ? (dom.inspectorPipPositionSelect.value as any) : (shot.pipPosition || 'top_right');
    const pipAnimation = dom.inspectorPipAnimationSelect ? (dom.inspectorPipAnimationSelect.value as any) : (shot.pipAnimation || 'pop_spring');
    const pipScale = dom.inspectorPipScaleRange ? (parseInt(dom.inspectorPipScaleRange.value, 10) || 36) / 100 : (typeof shot.pipScale === 'number' ? shot.pipScale : 0.36);

    shot.displayMode = displayMode;
    shot.pipPosition = pipPosition;
    shot.pipAnimation = pipAnimation;
    shot.pipScale = pipScale;

    // Shot Color Grade / Quick Filter
    const selectedFilter = dom.inspectorColorFilterSelect ? dom.inspectorColorFilterSelect.value : (shot.colorFilter || 'none');
    const selectedIntensity = dom.inspectorFilterIntensitySlider ? (parseInt(dom.inspectorFilterIntensitySlider.value, 10) || 100) : (shot.colorFilterIntensity ?? 100);
    shot.colorFilter = selectedFilter;
    shot.colorFilterIntensity = selectedIntensity;

    // Update corresponding clip in timeline
    const clip = timelineState.clips?.find((c: any) => c.id === shot.id);
    if (clip) {
        clip.displayMode = displayMode;
        clip.pipPosition = pipPosition;
        clip.pipAnimation = pipAnimation;
        clip.pipScale = pipScale;
        clip.colorFilter = selectedFilter;
        clip.colorFilterIntensity = selectedIntensity;
        clip.talkingHeadMode = talkingHeadMode;
        clip.talkingHeadShape = talkingHeadShape as any;
        clip.talkingHeadSize = talkingHeadSize as any;
        clip.useOriginalAudio = useOriginalAudio;
        clip.preserveContent = preserveContent;
        clip.soloAudio = soloAudio;
        clip.muteNarration = soloAudio;
        clip.deviceTag = shot.deviceTag;
        clip.rotate = shot.rotate;
        clip.volume = clipVolume;
        clip.fadeIn = clipFadeIn;
        clip.fadeOut = clipFadeOut;
        clip.playbackRate = clipPlaybackRate;
        clip.audioDuckingOverride = audioDuckingOverride;
        clip.talkingHeadVideoElement = state.uploadedVideoElement;
        clip.videoStartOffset = videoStartOffset;
        clip.cameraMovement = shot.camera_movement;
        if (shot.cameraKeyframes) {
            clip.cameraKeyframes = shot.cameraKeyframes;
        }
    }

    renderTimelineEditor();

    // Sync to DOM card if visible
    if (dom.resultsContainer) {
        renderResults(state.currentScenes);
    }

    if (timelineState.videoGenerated) {
        updateVideoContext();
        drawVideoFrame(state.videoPauseTime || 0);
    }

    saveVersion(false);
    showStatus(`Saved metadata for ${targetItem.label}`, false);
}

function highlightShotCard(shotId: string) {
    if (!dom.resultsContainer) return;
    clearShotCardHighlight();

    const shotEl = dom.resultsContainer.querySelector(`[data-id="${shotId}"]`)?.closest('.prompt-item');
    if (shotEl) {
        shotEl.classList.add('ring-2', 'ring-amber-400', 'shadow-lg');
        shotEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function clearShotCardHighlight() {
    if (!dom.resultsContainer) return;
    const cards = dom.resultsContainer.querySelectorAll('.prompt-item');
    cards.forEach(card => card.classList.remove('ring-2', 'ring-amber-400', 'shadow-lg'));
}

function getSelectedClip() {
    if (!activeShotId) return null;
    return timelineState.clips.find(c => c.id === activeShotId) || null;
}

export function handleInspectorDisplayModeChange(e: Event) {
    const clip = getSelectedClip();
    if (!clip) return;
    const mode = (e.target as HTMLSelectElement).value as 'fullscreen' | 'pip_overlay';
    clip.displayMode = mode;
    if (dom.inspectorPipControls) {
        if (mode === 'pip_overlay') {
            dom.inspectorPipControls.classList.remove('hidden');
        } else {
            dom.inspectorPipControls.classList.add('hidden');
        }
    }
    const updated = timelineState.clips.map(c => c.id === clip.id ? { ...c, displayMode: mode } : c);
    timelineState.setClips(updated);

    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (targetItem) {
        targetItem.shot.displayMode = mode;
    }

    renderTimelineEditor();

    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
    showStatus(mode === 'pip_overlay' ? 'Shot set to Pop-Up PiP Overlay' : 'Shot set to Fullscreen Cutaway', false);
}

export function handleInspectorPipPositionChange(e: Event) {
    const clip = getSelectedClip();
    if (!clip) return;
    const pos = (e.target as HTMLSelectElement).value as any;
    clip.pipPosition = pos;

    if (pos === 'custom') {
        if (typeof clip.pipX !== 'number' || typeof clip.pipY !== 'number') {
            clip.pipX = 0.5;
            clip.pipY = 0.5;
            clip.pipAnchorX = 0.5;
            clip.pipAnchorY = 0.5;
        }
    } else {
        clip.pipX = undefined;
        clip.pipY = undefined;
    }

    const updated = timelineState.clips.map(c => c.id === clip.id ? {
        ...c,
        pipPosition: pos,
        pipX: clip.pipX,
        pipY: clip.pipY,
        pipAnchorX: clip.pipAnchorX,
        pipAnchorY: clip.pipAnchorY,
    } : c);
    timelineState.setClips(updated);

    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (targetItem) {
        targetItem.shot.pipPosition = pos;
        targetItem.shot.pipX = clip.pipX;
        targetItem.shot.pipY = clip.pipY;
        targetItem.shot.pipAnchorX = clip.pipAnchorX;
        targetItem.shot.pipAnchorY = clip.pipAnchorY;
    }

    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function handleInspectorPipAnimationChange(e: Event) {
    const clip = getSelectedClip();
    if (!clip) return;
    const anim = (e.target as HTMLSelectElement).value as any;
    clip.pipAnimation = anim;
    const updated = timelineState.clips.map(c => c.id === clip.id ? { ...c, pipAnimation: anim } : c);
    timelineState.setClips(updated);

    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (targetItem) {
        targetItem.shot.pipAnimation = anim;
    }
}

export function handleInspectorPipScaleChange(e: Event) {
    const clip = getSelectedClip();
    if (!clip) return;
    const val = parseInt((e.target as HTMLInputElement).value, 10) || 36;
    if (dom.inspectorPipScaleVal) {
        dom.inspectorPipScaleVal.textContent = `${val}%`;
    }
    const scaleRatio = val / 100;
    clip.pipScale = scaleRatio;
    const updated = timelineState.clips.map(c => c.id === clip.id ? { ...c, pipScale: scaleRatio } : c);
    timelineState.setClips(updated);

    const allShots = getAllStoryboardShots();
    const targetItem = allShots.find(item => item.shot.id === activeShotId);
    if (targetItem) {
        targetItem.shot.pipScale = scaleRatio;
    }

    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

/**
 * Initialize all event listeners for the Shot Inspector Panel
 */
export function initInspectorHandlers() {
    // Toggle button in storyboard toolbar
    if (dom.toggleInspectorBtn) {
        dom.toggleInspectorBtn.addEventListener('click', toggleInspector);
    }

    // Close button
    if (dom.closeInspectorBtn) {
        dom.closeInspectorBtn.addEventListener('click', closeInspector);
    }

    // Nav buttons
    if (dom.inspectorPrevShotBtn) {
        dom.inspectorPrevShotBtn.addEventListener('click', () => navigateInspectorShot(-1));
    }
    if (dom.inspectorNextShotBtn) {
        dom.inspectorNextShotBtn.addEventListener('click', () => navigateInspectorShot(1));
    }
    
    // Paste Image Button
    if (dom.inspectorPasteBtn) {
        dom.inspectorPasteBtn.addEventListener('click', async () => {
            try {
                // Read image from clipboard via the new centralized read function
                // which attempts multiple parsing formats (data urls, file blobs, html tags)
                // Note: We need to import this function from handlers-images
                const { readImageBlobFromSystemClipboard, processAndRoutePastedImage } = await import('./handlers-images');
                const blob = await readImageBlobFromSystemClipboard();
                if (!blob) {
                    import('./ui').then(u => u.showStatus('No image found on your clipboard. Copy an image first!', true));
                    return;
                }
                await processAndRoutePastedImage(blob, 'inspector');
            } catch (err: any) {
                console.warn('[Inspector Paste] Clipboard API error:', err);
                import('./ui').then(u => u.showStatus('Please press Ctrl+V / Cmd+V directly to paste from clipboard.', true));
            }
        });
    }

    // Camera Movement Select Change
    if (dom.inspectorCameraMovementSelect) {
        dom.inspectorCameraMovementSelect.addEventListener('change', () => {
            const movement = dom.inspectorCameraMovementSelect.value;
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;

            if (movement === 'custom_keyframes') {
                dom.inspectorKeyframesContainer?.classList.remove('hidden');
                if (dom.inspectorKeyframesToggleIcon) dom.inspectorKeyframesToggleIcon.textContent = '▲';
                if (!targetItem.shot.cameraKeyframes) {
                    targetItem.shot.cameraKeyframes = presetToKeyframes('zoom_in');
                }
                populateInspectorKeyframeUI(targetItem.shot);
                syncActiveKeyframesFromSliders();
            } else {
                // Preset selected
                targetItem.shot.camera_movement = movement;
                const kf = presetToKeyframes(movement);
                targetItem.shot.cameraKeyframes = kf;
                populateInspectorKeyframeUI(targetItem.shot);
                
                const clip = timelineState.clips?.find((c: any) => c.id === targetItem.shot.id);
                if (clip) {
                    clip.cameraMovement = movement;
                    clip.cameraKeyframes = kf;
                }
                if (timelineState.videoGenerated && !state.isVideoPlaying) {
                    drawVideoFrame(state.videoPauseTime || 0);
                }
            }
        });
    }

    // Toggle Keyframes Container Button
    if (dom.inspectorToggleKeyframesBtn && dom.inspectorKeyframesContainer) {
        dom.inspectorToggleKeyframesBtn.addEventListener('click', () => {
            const isHidden = dom.inspectorKeyframesContainer.classList.toggle('hidden');
            if (dom.inspectorKeyframesToggleIcon) {
                dom.inspectorKeyframesToggleIcon.textContent = isHidden ? '▼' : '▲';
            }
        });
    }

    // Keyframe Slider Input Listeners
    const bindKfSlider = (slider: HTMLInputElement | null, label: HTMLSpanElement | null, format: (val: number) => string) => {
        if (!slider) return;
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value) || 0;
            if (label) label.textContent = format(val);
            syncActiveKeyframesFromSliders();
        });
    };

    bindKfSlider(dom.inspectorKfStartScale, dom.inspectorKfStartScaleVal, v => `${v.toFixed(2)}x`);
    bindKfSlider(dom.inspectorKfStartRot, dom.inspectorKfStartRotVal, v => `${Math.round(v)}°`);
    bindKfSlider(dom.inspectorKfStartX, dom.inspectorKfStartXVal, v => `${Math.round(v)}%`);
    bindKfSlider(dom.inspectorKfStartY, dom.inspectorKfStartYVal, v => `${Math.round(v)}%`);

    bindKfSlider(dom.inspectorKfEndScale, dom.inspectorKfEndScaleVal, v => `${v.toFixed(2)}x`);
    bindKfSlider(dom.inspectorKfEndRot, dom.inspectorKfEndRotVal, v => `${Math.round(v)}°`);
    bindKfSlider(dom.inspectorKfEndX, dom.inspectorKfEndXVal, v => `${Math.round(v)}%`);
    bindKfSlider(dom.inspectorKfEndY, dom.inspectorKfEndYVal, v => `${Math.round(v)}%`);

    if (dom.inspectorKfEasingSelect) {
        dom.inspectorKfEasingSelect.addEventListener('change', () => {
            syncActiveKeyframesFromSliders();
        });
    }

    // Preset to Keyframes Converter Button
    if (dom.inspectorPresetToKfBtn) {
        dom.inspectorPresetToKfBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;

            const preset = dom.inspectorCameraMovementSelect?.value || targetItem.shot.camera_movement || 'zoom_in';
            const kf = presetToKeyframes(preset === 'custom_keyframes' ? 'zoom_in' : preset);
            targetItem.shot.cameraKeyframes = kf;
            targetItem.shot.camera_movement = 'custom_keyframes';
            if (dom.inspectorCameraMovementSelect) dom.inspectorCameraMovementSelect.value = 'custom_keyframes';
            if (dom.inspectorKeyframesContainer) dom.inspectorKeyframesContainer.classList.remove('hidden');
            if (dom.inspectorKeyframesToggleIcon) dom.inspectorKeyframesToggleIcon.textContent = '▲';
            
            populateInspectorKeyframeUI(targetItem.shot);
            syncActiveKeyframesFromSliders();
            showStatus(`Converted preset "${preset}" into editable keyframes`, false, 2500);
        });
    }

    // Reverse Keyframes Button
    if (dom.inspectorReverseKfBtn) {
        dom.inspectorReverseKfBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;

            const startScale = dom.inspectorKfStartScale ? parseFloat(dom.inspectorKfStartScale.value) || 1.0 : 1.0;
            const startRot = dom.inspectorKfStartRot ? parseFloat(dom.inspectorKfStartRot.value) || 0 : 0;
            const startX = dom.inspectorKfStartX ? parseFloat(dom.inspectorKfStartX.value) || 0 : 0;
            const startY = dom.inspectorKfStartY ? parseFloat(dom.inspectorKfStartY.value) || 0 : 0;

            const endScale = dom.inspectorKfEndScale ? parseFloat(dom.inspectorKfEndScale.value) || 1.0 : 1.0;
            const endRot = dom.inspectorKfEndRot ? parseFloat(dom.inspectorKfEndRot.value) || 0 : 0;
            const endX = dom.inspectorKfEndX ? parseFloat(dom.inspectorKfEndX.value) || 0 : 0;
            const endY = dom.inspectorKfEndY ? parseFloat(dom.inspectorKfEndY.value) || 0 : 0;

            if (dom.inspectorKfStartScale) dom.inspectorKfStartScale.value = String(endScale);
            if (dom.inspectorKfStartRot) dom.inspectorKfStartRot.value = String(endRot);
            if (dom.inspectorKfStartX) dom.inspectorKfStartX.value = String(endX);
            if (dom.inspectorKfStartY) dom.inspectorKfStartY.value = String(endY);

            if (dom.inspectorKfEndScale) dom.inspectorKfEndScale.value = String(startScale);
            if (dom.inspectorKfEndRot) dom.inspectorKfEndRot.value = String(startRot);
            if (dom.inspectorKfEndX) dom.inspectorKfEndX.value = String(startX);
            if (dom.inspectorKfEndY) dom.inspectorKfEndY.value = String(startY);

            if (dom.inspectorKfStartScaleVal) dom.inspectorKfStartScaleVal.textContent = `${endScale.toFixed(2)}x`;
            if (dom.inspectorKfStartRotVal) dom.inspectorKfStartRotVal.textContent = `${Math.round(endRot)}°`;
            if (dom.inspectorKfStartXVal) dom.inspectorKfStartXVal.textContent = `${Math.round(endX)}%`;
            if (dom.inspectorKfStartYVal) dom.inspectorKfStartYVal.textContent = `${Math.round(endY)}%`;

            if (dom.inspectorKfEndScaleVal) dom.inspectorKfEndScaleVal.textContent = `${startScale.toFixed(2)}x`;
            if (dom.inspectorKfEndRotVal) dom.inspectorKfEndRotVal.textContent = `${Math.round(startRot)}°`;
            if (dom.inspectorKfEndXVal) dom.inspectorKfEndXVal.textContent = `${Math.round(startX)}%`;
            if (dom.inspectorKfEndYVal) dom.inspectorKfEndYVal.textContent = `${Math.round(startY)}%`;

            syncActiveKeyframesFromSliders();
            showStatus('Reversed keyframe motion direction', false, 2000);
        });
    }

    // Camera Angle Preset Select Change
    if (dom.inspectorCameraAngleSelect) {
        dom.inspectorCameraAngleSelect.addEventListener('change', () => {
            if (dom.inspectorCameraAngleSelect.value === 'custom') {
                dom.inspectorCustomAngleContainer?.classList.remove('hidden');
                dom.inspectorCustomAngleInput?.focus();
            } else {
                dom.inspectorCustomAngleContainer?.classList.add('hidden');
            }
        });
    }

    // Original Audio Toggle <-> Clip Audio Controls Visibility
    if (dom.inspectorUseOriginalAudio && dom.inspectorClipAudioControls) {
        dom.inspectorUseOriginalAudio.addEventListener('change', () => {
            if (dom.inspectorUseOriginalAudio.checked) {
                dom.inspectorClipAudioControls.classList.remove('hidden');
                if (dom.inspectorAudioStackWarning) {
                    if (timelineState.globalWordTimestamps?.length) {
                        dom.inspectorAudioStackWarning.classList.remove('hidden');
                        showStatus('This clip may contain speech — narration will stack with it.', true, 4000);
                    } else {
                        dom.inspectorAudioStackWarning.classList.add('hidden');
                    }
                }
            } else {
                dom.inspectorClipAudioControls.classList.add('hidden');
            }
        });
    }

    if (dom.inspectorClipDevice) {
        dom.inspectorClipDevice.addEventListener('change', () => {
            saveInspectorMetadata();
            saveVersion(false);
        });
    }

    if (dom.inspectorClipRotation) {
        dom.inspectorClipRotation.addEventListener('change', () => {
            saveInspectorMetadata();
            saveVersion(false);
        });
    }

    // Clip Volume Slider <-> Label Sync
    if (dom.inspectorClipVolumeSlider && dom.inspectorClipVolumeLabel) {
        dom.inspectorClipVolumeSlider.addEventListener('input', () => {
            const val = parseFloat(dom.inspectorClipVolumeSlider.value) || 0;
            dom.inspectorClipVolumeLabel.textContent = `${Math.round(val * 100)}%`;
        });
    }

    // Clip Speed Slider <-> Label Sync
    if (dom.inspectorClipSpeedSlider && dom.inspectorClipSpeedLabel) {
        dom.inspectorClipSpeedSlider.addEventListener('input', () => {
            const val = parseFloat(dom.inspectorClipSpeedSlider.value) || 1;
            dom.inspectorClipSpeedLabel.textContent = `${val.toFixed(2)}x`;
        });
    }

    // Extract Audio
    if (dom.inspectorExtractAudioBtn) {
        dom.inspectorExtractAudioBtn.addEventListener('click', async () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const shot = targetItem.shot;

            const src = shot?._videoObjectURL || shot?._audioObjectURL;
            if (!src) { showStatus('This shot has no video/audio to extract.', true, 2500); return; }
            try {
                const utils = await import('./utils');
                const { assetStorage } = await import('./assetStorage');
                await utils.loadVideoElement(src);
                const res = await fetch(src);
                const buf = await utils.safeDecode(utils.getAudioContext(), await (await res.blob()).arrayBuffer());
                if (!buf) {
                    showStatus('This clip has no audio track.', true, 2500);
                    return;
                }
                const wavBlob = audioBufferToWavBlob(buf);
                await assetStorage.storeAsset(wavBlob, 'audio', 'current_project');
                (shot as any)._audioObjectURL = URL.createObjectURL(wavBlob);
                if (dom.inspectorUseOriginalAudio) {
                    dom.inspectorUseOriginalAudio.checked = true;
                }
                saveInspectorMetadata();
                showStatus('Audio extracted and saved as a project asset.', false, 2500);
            } catch (e: any) {
                showStatus('Could not extract audio from this clip.', true, 3000);
            }
        });
    }

    // Lighting Preset Select Change
    if (dom.inspectorLightingPresetSelect) {
        dom.inspectorLightingPresetSelect.addEventListener('change', () => {
            const val = dom.inspectorLightingPresetSelect.value;
            if (val && val !== 'custom' && dom.inspectorLightingPromptInput) {
                dom.inspectorLightingPromptInput.value = val;
            }
        });
    }

    // Shot Color Grade / Filter Select Change
    if (dom.inspectorColorFilterSelect) {
        dom.inspectorColorFilterSelect.addEventListener('change', () => {
            const filter = dom.inspectorColorFilterSelect.value;
            applyFilterToActiveShot(filter);
        });
    }

    // Filter Intensity Slider Change
    if (dom.inspectorFilterIntensitySlider) {
        dom.inspectorFilterIntensitySlider.addEventListener('input', () => {
            const intensity = parseInt(dom.inspectorFilterIntensitySlider.value, 10) || 100;
            if (dom.inspectorFilterIntensityVal) {
                dom.inspectorFilterIntensityVal.textContent = `${intensity}%`;
            }
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;

            targetItem.shot.colorFilterIntensity = intensity;
            const clip = timelineState.clips?.find((c: any) => c.id === targetItem.shot.id);
            if (clip) {
                clip.colorFilterIntensity = intensity;
            }
            applyInspectorMediaFilter(targetItem.shot.colorFilter || 'none', intensity);
            if (timelineState.videoGenerated && !state.isVideoPlaying) {
                drawVideoFrame(state.videoPauseTime || 0);
            }
        });
    }

    // Duration Slider <-> Input Sync
    if (dom.inspectorDurationSlider && dom.inspectorDurationInput) {
        const onDurationChange = () => {
            const dur = parseFloat(dom.inspectorDurationInput.value) || 3.0;
            const offset = dom.inspectorVideoOffsetInput ? parseFloat(dom.inspectorVideoOffsetInput.value) || 0 : 0;
            updateInspectorVideoRangeInfo(offset, dur);
        };
        dom.inspectorDurationSlider.addEventListener('input', () => {
            dom.inspectorDurationInput.value = dom.inspectorDurationSlider.value;
            onDurationChange();
        });
        dom.inspectorDurationInput.addEventListener('input', () => {
            dom.inspectorDurationSlider.value = dom.inspectorDurationInput.value;
            onDurationChange();
        });
    }

    if (dom.inspectorFitDurationBtn) {
        dom.inspectorFitDurationBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const shot = targetItem.shot;
            const mediaDuration = shot._videoDuration || shot.mediaDuration || 0;
            if (mediaDuration > 0) {
                const roundedDur = Math.max(0.5, Math.min(60, Math.round(mediaDuration * 10) / 10));
                shot.duration_seconds = roundedDur;
                if (dom.inspectorDurationInput) dom.inspectorDurationInput.value = String(roundedDur);
                if (dom.inspectorDurationSlider) dom.inspectorDurationSlider.value = String(Math.min(20, roundedDur));
                const offset = dom.inspectorVideoOffsetInput ? parseFloat(dom.inspectorVideoOffsetInput.value) || 0 : 0;
                updateInspectorVideoRangeInfo(offset, roundedDur);
                if (dom.inspectorApplyBtn) dom.inspectorApplyBtn.click();
                showStatus(`⚡ Shot duration set to media length (${roundedDur.toFixed(1)}s)`, false, 2500);
            }
        });
    }

    // Video Start Offset (Trim) Slider <-> Input Sync & Live Preview
    if (dom.inspectorVideoOffsetSlider && dom.inspectorVideoOffsetInput) {
        dom.inspectorVideoOffsetSlider.addEventListener('input', () => {
            const val = parseFloat(dom.inspectorVideoOffsetSlider.value) || 0;
            dom.inspectorVideoOffsetInput.value = val.toFixed(1);
            if (dom.inspectorVideoOffsetValText) {
                dom.inspectorVideoOffsetValText.textContent = `${val.toFixed(1)}s`;
            }
            syncActiveShotVideoOffset(val);
        });

        dom.inspectorVideoOffsetInput.addEventListener('input', () => {
            const val = Math.max(0, parseFloat(dom.inspectorVideoOffsetInput.value) || 0);
            dom.inspectorVideoOffsetSlider.value = String(val);
            if (dom.inspectorVideoOffsetValText) {
                dom.inspectorVideoOffsetValText.textContent = `${val.toFixed(1)}s`;
            }
            syncActiveShotVideoOffset(val);
        });
    }

    // Set Offset From Current Preview Video Time Button
    if (dom.inspectorSetOffsetFromVideoBtn) {
        dom.inspectorSetOffsetFromVideoBtn.addEventListener('click', () => {
            if (!dom.inspectorMediaContainer) return;
            const vidEl = dom.inspectorMediaContainer.querySelector('video') as HTMLVideoElement;
            if (vidEl) {
                const currentPos = Math.round(vidEl.currentTime * 10) / 10;
                if (dom.inspectorVideoOffsetSlider) dom.inspectorVideoOffsetSlider.value = String(currentPos);
                if (dom.inspectorVideoOffsetInput) dom.inspectorVideoOffsetInput.value = currentPos.toFixed(1);
                if (dom.inspectorVideoOffsetValText) dom.inspectorVideoOffsetValText.textContent = `${currentPos.toFixed(1)}s`;
                syncActiveShotVideoOffset(currentPos);
                showStatus(`Set video in-point to ${currentPos.toFixed(1)}s`, false, 2500);
            }
        });
    }

    // Reset Offset Button
    if (dom.inspectorResetOffsetBtn) {
        dom.inspectorResetOffsetBtn.addEventListener('click', () => {
            if (dom.inspectorVideoOffsetSlider) dom.inspectorVideoOffsetSlider.value = '0.0';
            if (dom.inspectorVideoOffsetInput) dom.inspectorVideoOffsetInput.value = '0.0';
            if (dom.inspectorVideoOffsetValText) dom.inspectorVideoOffsetValText.textContent = '0.0s';
            syncActiveShotVideoOffset(0);
            showStatus(`Reset video in-point to 0.0s`, false, 2000);
        });
    }

    // Apply / Save Button
    if (dom.inspectorApplyBtn) {
        dom.inspectorApplyBtn.addEventListener('click', saveInspectorMetadata);
    }

    // Inspector Generate Image
    if (dom.inspectorGenerateImgBtn) {
        dom.inspectorGenerateImgBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            saveInspectorMetadata();
            if (dom.resultsContainer) {
                const cardEl = dom.resultsContainer.querySelector(`[data-id="${activeShotId}"]`)?.closest('.prompt-item');
                const btn = cardEl?.querySelector('.generate-btn') as HTMLButtonElement;
                if (btn) btn.click();
            }
        });
    }

    // Inspector Animate Shot
    if (dom.inspectorAnimateBtn) {
        dom.inspectorAnimateBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            saveInspectorMetadata();
            if (dom.resultsContainer) {
                const cardEl = dom.resultsContainer.querySelector(`[data-id="${activeShotId}"]`)?.closest('.prompt-item');
                const btn = cardEl?.querySelector('.animate-btn') as HTMLButtonElement;
                if (btn && !btn.disabled) {
                    btn.click();
                } else {
                    showStatus('An image must be generated before animating this shot.', true);
                }
            }
        });
    }

    // Inspector Map Shot - Opens Map Studio preloaded with this shot
    if (dom.inspectorMapBtn) {
        dom.inspectorMapBtn.addEventListener('click', () => {
            if (!activeShotId) return;
            saveInspectorMetadata();
            const allShots: FlatShotItem[] = getAllStoryboardShots();
            const targetItem = allShots.find((item: FlatShotItem) => item.shot.id === activeShotId);
            const scriptSnippet = targetItem?.shot.narration || targetItem?.shot.image_prompt || '';
            openMapStudioModal(activeShotId, scriptSnippet);
        });
    }

    // Press Escape key to close inspector
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && dom.shotInspectorDrawer && !dom.shotInspectorDrawer.classList.contains('hidden')) {
            closeInspector();
        }
    });

    // PiP overlay listeners
    if (dom.inspectorDisplayModeSelect) dom.inspectorDisplayModeSelect.addEventListener('change', handleInspectorDisplayModeChange);
    if (dom.inspectorPipPositionSelect) dom.inspectorPipPositionSelect.addEventListener('change', handleInspectorPipPositionChange);
    if (dom.inspectorPipAnimationSelect) dom.inspectorPipAnimationSelect.addEventListener('change', handleInspectorPipAnimationChange);
    if (dom.inspectorPipScaleRange) dom.inspectorPipScaleRange.addEventListener('input', handleInspectorPipScaleChange);

    // Talking Head / Dual-Media Listeners
    if (dom.inspectorTalkingHeadModeSelect) {
        dom.inspectorTalkingHeadModeSelect.addEventListener('change', async () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const mode = dom.inspectorTalkingHeadModeSelect.value as any;
            targetItem.shot.talkingHeadMode = mode;
            const clip = timelineState.clips?.find((c: any) => c.id === activeShotId);
            if (clip) clip.talkingHeadMode = mode;
            if (dom.inspectorDualMediaPanel) {
                const hasSecondary = !!(targetItem.shot.secondary_image_id || targetItem.shot._secondaryImageObjectURL || targetItem.shot.secondary_video_id || targetItem.shot._secondaryVideoObjectURL);
                dom.inspectorDualMediaPanel.classList.toggle('hidden', !(mode === 'split' || !!targetItem.shot.preserveContent || hasSecondary));
            }
            if (dom.resultsContainer) renderResults(state.currentScenes);
            const { syncShotMediaToTimeline } = await import('./handlers-images/timeline-sync');
            await syncShotMediaToTimeline(targetItem.shot);
            updateVideoContext();
            drawVideoFrame(state.videoPauseTime || 0);
            saveVersion(false);
            showStatus(`Layout set to ${dom.inspectorTalkingHeadModeSelect.options[dom.inspectorTalkingHeadModeSelect.selectedIndex]?.text || mode}`, false, 2000);
        });
    }

    if (dom.inspectorTalkingHeadShapeSelect) {
        dom.inspectorTalkingHeadShapeSelect.addEventListener('change', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            targetItem.shot.talkingHeadShape = dom.inspectorTalkingHeadShapeSelect.value as any;
            const clip = timelineState.clips?.find((c: any) => c.id === activeShotId);
            if (clip) clip.talkingHeadShape = targetItem.shot.talkingHeadShape;
            updateVideoContext();
            drawVideoFrame(state.videoPauseTime || 0);
            saveVersion(false);
        });
    }

    if (dom.inspectorTalkingHeadSizeSelect) {
        dom.inspectorTalkingHeadSizeSelect.addEventListener('change', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            targetItem.shot.talkingHeadSize = dom.inspectorTalkingHeadSizeSelect.value as any;
            const clip = timelineState.clips?.find((c: any) => c.id === activeShotId);
            if (clip) clip.talkingHeadSize = targetItem.shot.talkingHeadSize;
            updateVideoContext();
            drawVideoFrame(state.videoPauseTime || 0);
            saveVersion(false);
        });
    }

    if (dom.inspectorPreserveContentToggle) {
        dom.inspectorPreserveContentToggle.addEventListener('change', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            targetItem.shot.preserveContent = dom.inspectorPreserveContentToggle.checked;
            const clip = timelineState.clips?.find((c: any) => c.id === activeShotId);
            if (clip) clip.preserveContent = targetItem.shot.preserveContent;
            if (dom.inspectorDualMediaPanel) {
                const hasSecondary = !!(targetItem.shot.secondary_image_id || targetItem.shot._secondaryImageObjectURL || targetItem.shot.secondary_video_id || targetItem.shot._secondaryVideoObjectURL);
                dom.inspectorDualMediaPanel.classList.toggle('hidden', !(targetItem.shot.preserveContent || targetItem.shot.talkingHeadMode === 'split' || hasSecondary));
            }
            saveVersion(false);
            showStatus(targetItem.shot.preserveContent 
                ? 'Preserve enabled: Uploading media to this shot will now add to secondary layer without replacing existing content.' 
                : 'Preserve disabled: Uploading will replace existing shot media.', false, 3000);
        });
    }

    if (dom.inspectorSwapLayersBtn) {
        dom.inspectorSwapLayersBtn.addEventListener('click', async () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const shot = targetItem.shot;

            const tempImgId = shot.image_id;
            const tempImgUrl = shot._imageObjectURL;
            const tempVidId = shot.video_id;
            const tempVidUrl = shot._videoObjectURL;
            const tempType = (shot._videoObjectURL || shot.video_id) ? 'video' : ((shot._imageObjectURL || shot.image_id) ? 'image' : undefined);

            shot.image_id = shot.secondary_image_id || undefined;
            shot._imageObjectURL = shot._secondaryImageObjectURL || undefined;
            shot.video_id = shot.secondary_video_id || undefined;
            shot._videoObjectURL = shot._secondaryVideoObjectURL || undefined;

            shot.secondary_image_id = tempImgId || null;
            shot._secondaryImageObjectURL = tempImgUrl || undefined;
            shot.secondary_video_id = tempVidId || null;
            shot._secondaryVideoObjectURL = tempVidUrl || undefined;
            shot.secondary_media_type = tempType;

            const { syncShotMediaToTimeline } = await import('./handlers-images/timeline-sync');
            await syncShotMediaToTimeline(shot);
            openInspectorForShot(shot.id);
            if (dom.resultsContainer) renderResults(state.currentScenes);
            updateVideoContext();
            drawVideoFrame(state.videoPauseTime || 0);
            saveVersion(false);
            showStatus('Swapped Primary and Secondary media layers', false, 2000);
        });
    }

    if (dom.inspectorClearLayer2Btn) {
        dom.inspectorClearLayer2Btn.addEventListener('click', async () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const shot = targetItem.shot;

            removeSecondaryMedia(shot);
            delete shot.secondary_media_type;

            const { syncShotMediaToTimeline } = await import('./handlers-images/timeline-sync');
            await syncShotMediaToTimeline(shot);
            openInspectorForShot(shot.id);
            if (dom.resultsContainer) renderResults(state.currentScenes);
            updateVideoContext();
            drawVideoFrame(state.videoPauseTime || 0);
            saveVersion(false);
            showStatus('Cleared 2nd media layer', false, 2000);
        });
    }

    if (dom.inspectorUploadLayer2Btn) {
        dom.inspectorUploadLayer2Btn.addEventListener('click', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const shot = targetItem.shot;

            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*,image/*';
            input.onchange = async (e: Event) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const { uploadMediaToShot } = await import('./handlers-images/generation');
                await uploadMediaToShot(shot, file, true);
                openInspectorForShot(shot.id);
                if (dom.resultsContainer) renderResults(state.currentScenes);
            };
            input.click();
        });
    }

    if (dom.inspectorClipSoloAudioCheckbox) {
        dom.inspectorClipSoloAudioCheckbox.addEventListener('change', () => {
            if (!activeShotId) return;
            const allShots = getAllStoryboardShots();
            const targetItem = allShots.find(item => item.shot.id === activeShotId);
            if (!targetItem) return;
            const isSolo = dom.inspectorClipSoloAudioCheckbox.checked;
            targetItem.shot.soloAudio = isSolo;
            targetItem.shot.muteNarration = isSolo;
            const clip = timelineState.clips?.find((c: any) => c.id === activeShotId);
            if (clip) {
                clip.soloAudio = isSolo;
                clip.muteNarration = isSolo;
            }
            saveVersion(false);
            if (dom.resultsContainer) renderResults(state.currentScenes);
            showStatus(isSolo ? 'Solo audio enabled: Master voiceover will mute on this shot.' : 'Solo audio disabled.', false, 2500);
        });
    }
}
