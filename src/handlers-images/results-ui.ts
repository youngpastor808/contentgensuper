import { safeJsonStringify } from '../utils-core';
import { state } from '../state';
import { timelineState } from '../state-timeline';
import * as dom from '../dom';
import * as ui from '../ui';
import * as utils from '../utils';
import { splitShotLines } from '../api/audio';
import { saveVersion } from '../handlers-project';
import { openInspectorForShot } from '../handlers-inspector';
import { openMapStudioModal } from '../map-studio';
import { generateAndShowVideoPrompt } from '../handlers-export';
import { renderBatch, renderSceneBatch } from '../ui';
import { updateVideoContext, normalizeTimeline } from '../videoController';
import { syncShotMediaToTimeline } from './timeline-sync';
import { openSwapModal } from './swap-drag';
import {
    generateImageForShot,
    handleAnimateBtnClick,
    handleUploadVideoBtnClick,
    handleUploadSfxBtnClick,
    handleMagicPrompt
} from './generation';
import {
    handlePexelsVideoBtnClick,
    handlePexelsImageBtnClick
} from './pexels';

export async function handleResultsContainerClick(event: Event) {
    const target = event.target as HTMLElement;

    // "Show More" Button
    const showMoreBtn = target.closest('.show-more-shots-btn');
    if (showMoreBtn) {
        const btn = showMoreBtn as HTMLButtonElement;
        const sceneIndex = parseInt(btn.dataset.sceneIndex!, 10);
        const nextBatch = parseInt(btn.dataset.nextBatch!, 10);
        const isPaced = btn.dataset.isPaced === 'true';

        if (isPaced) {
            renderBatch(state.currentScenes, nextBatch);
        } else {
            const lines = state.currentScenes[sceneIndex]?.lines || [];
            renderSceneBatch(sceneIndex, lines, nextBatch);
        }
        return;
    }

    // Shot-specific actions
    const shotElement = target.closest('.prompt-item') as HTMLElement;
    if (shotElement) {
        // Toggle Storyboard Intelligence Director Notes
        const toggleNotesBtn = target.closest('.toggle-director-notes-btn');
        if (toggleNotesBtn) {
            const panel = shotElement.querySelector('.director-notes-panel');
            if (panel) {
                panel.classList.toggle('hidden');
                const arrow = toggleNotesBtn.querySelector('span:last-child');
                if (arrow) arrow.textContent = panel.classList.contains('hidden') ? '▾' : '▴';
            }
            return;
        }

        // Map Studio button for shot
        const mapBtn = target.closest('.map-shot-btn');
        if (mapBtn) {
            const shotId = shotElement.dataset.id;
            const targetShot = state.currentScenes?.find(s => s.id === shotId);
            const scriptSnippet = targetShot ? (targetShot.line_text || targetShot.text_reference || targetShot.description || targetShot.image_prompt || "") : "";
            openMapStudioModal(shotId, scriptSnippet);
            return;
        }

        // Manual Save Shot button
        const saveShotBtn = target.closest('.save-shot-btn');
        if (saveShotBtn) {
            await saveVersion(false, true);
            ui.showStatus('💾 Shot saved to project & history.', false, 2000);
            return;
        }

        // Inspect shot button
        const inspectBtn = target.closest('.inspect-shot-btn');
        if (inspectBtn) {
            const shotId = shotElement.dataset.id;
            if (shotId) openInspectorForShot(shotId);
            return;
        }

        // Generate button
        const generateBtn = target.closest('.generate-btn');
        if (generateBtn) {
            await generateImageForShot(generateBtn as HTMLButtonElement);
            return;
        }

        const animateBtn = target.closest('.animate-btn');
        if (animateBtn) {
            await handleAnimateBtnClick(event);
            return;
        }

        const uploadVideoBtn = target.closest('.upload-video-btn');
        if (uploadVideoBtn) {
            await handleUploadVideoBtnClick(event, false);
            return;
        }

        const uploadPreserveBtn = target.closest('.upload-preserve-btn');
        if (uploadPreserveBtn) {
            await handleUploadVideoBtnClick(event, true);
            return;
        }

        const pexelsVideoBtn = target.closest('.pexels-video-btn');
        if (pexelsVideoBtn) {
            await handlePexelsVideoBtnClick(event);
            return;
        }

        const pexelsImageBtn = target.closest('.pexels-image-btn');
        if (pexelsImageBtn) {
            await handlePexelsImageBtnClick(event);
            return;
        }

        // Upload SFX button
        const uploadSfxBtn = target.closest('.upload-sfx-btn');
        if (uploadSfxBtn) {
            await handleUploadSfxBtnClick(event);
            return;
        }

        // Clear SFX button
        const clearSfxBtn = target.closest('.clear-sfx-btn');
        if (clearSfxBtn) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];

            if (shot) {
                shot.sfx_prompt = '';
                shot.sfx_id = null;
                shot._sfxBuffer = undefined;
                if (shot._sfxObjectURL) {
                    URL.revokeObjectURL(shot._sfxObjectURL);
                    shot._sfxObjectURL = undefined;
                }
                const timelineClip = timelineState.clips.find(c => c.id === shot.id);
                if (timelineClip) {
                    timelineClip._sfxBuffer = undefined;
                }
                
                // Re-render the shot to update UI
                if (isPaced) {
                    renderBatch(state.currentScenes, Math.floor(lineIndex / 25));
                } else {
                    renderSceneBatch(sceneIndex, state.currentScenes[sceneIndex].lines, Math.floor(lineIndex / 25));
                }
                saveVersion(false);
            }
            return;
        }

        // Swap shot button
        const swapBtn = target.closest('.swap-shot-btn');
        if (swapBtn) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const scene = state.currentScenes[sceneIndex];
            const lines = scene?.lines || [scene];
            const shot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];

            if (shot) {
                openSwapModal(shot, sceneIndex, lineIndex, isPaced);
            }
            return;
        }

        // Clear media button
        const clearMediaBtn = target.closest('.clear-media-btn');
        if (clearMediaBtn) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];

            if (shot) {
                if (shot._imageObjectURL) URL.revokeObjectURL(shot._imageObjectURL);
                if (shot._videoObjectURL) URL.revokeObjectURL(shot._videoObjectURL);
                if (shot._secondaryImageObjectURL) URL.revokeObjectURL(shot._secondaryImageObjectURL);
                if (shot._secondaryVideoObjectURL) URL.revokeObjectURL(shot._secondaryVideoObjectURL);
                if (shot._sfxObjectURL) URL.revokeObjectURL(shot._sfxObjectURL);
                
                shot.image_id = null;
                shot.video_id = null;
                shot.secondary_image_id = null;
                shot.secondary_video_id = null;
                delete shot.secondary_media_type;
                shot._imageObjectURL = undefined;
                shot._secondaryImageObjectURL = undefined;
                shot.imageMimeType = undefined;
                shot._videoObjectURL = undefined;
                shot._secondaryVideoObjectURL = undefined;
                shot.sfx_id = null;
                shot._sfxObjectURL = undefined;
                shot._sfxBuffer = undefined;
                shot.b_roll_prompt = undefined;
                shot.sfx_prompt = undefined;

                // Sync timeline if active
                await syncShotMediaToTimeline(shot);

                ui.renderResults(state.currentScenes);
                saveVersion(false);
            }
            return;
        }

        // Delete shot button
        const deleteBtn = target.closest('.delete-shot-btn');
        if (deleteBtn) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];

            const performDelete = () => {
                const hasActiveTimeline = timelineState.clips?.length > 0;
                const clipIndex = hasActiveTimeline && shot ? timelineState.clips.findIndex(c => c.id === shot.id) : -1;

                // Cleanup Blob URL
                if (shot._imageObjectURL) URL.revokeObjectURL(shot._imageObjectURL);

                // 1. Modify storyboard state
                if (isPaced) {
                    state.currentScenes.splice(lineIndex, 1);
                } else {
                    state.currentScenes[sceneIndex].lines.splice(lineIndex, 1);
                    if (state.currentScenes[sceneIndex].lines.length === 0) {
                        state.currentScenes.splice(sceneIndex, 1);
                    }
                }
                
                let statusMessage = 'Shot deleted.';
                
                // 2. If it was in the timeline, remove it and adjust
                if (clipIndex !== -1) {
                    const newClips = [...timelineState.clips];
                    newClips.splice(clipIndex, 1);
                    timelineState.setClips(newClips, false); // Don't notify yet
                    // This function handles both 'free' (closes gap) and 'audio_locked' (preserves gap) modes.
                    normalizeTimeline(timelineState.masterAudioBuffer?.duration);
                    statusMessage = 'Shot removed from storyboard and timeline.';
                }
                
                // 3. Update UI and save
                ui.renderResults(state.currentScenes);
                updateVideoContext();
                saveVersion(false);
                ui.showStatus(statusMessage, false, 4000);
            };

            // Only show confirmation if the shot is actually in an active timeline
            if (timelineState.clips?.length > 0 && shot && timelineState.clips.some(c => c.id === shot.id)) {
                ui.showConfirmation(
                    'Delete from Timeline?',
                    'This will remove the shot from both the storyboard and the active video timeline. Continue?',
                    performDelete
                );
            } else {
                // If no timeline or shot not in timeline, no special confirmation needed. Just delete.
                performDelete();
            }
            return;
        }

        // Split shot button
        const splitBtn = target.closest('.split-shot-btn');
        if (splitBtn) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];

            if (shot) {
                const hasActiveTimeline = timelineState.clips?.length > 0;
                
                const performSplit = async () => {
                    const btn = splitBtn as HTMLButtonElement;
                    const prevHTML = btn.innerHTML;
                    btn.innerHTML = '⏳';
                    btn.disabled = true;

                    try {
                        const fullScript = dom.storyInput ? dom.storyInput.value : '';
                        const targetText = shot.line_text || shot.text_reference || '';
                        
                        if (!targetText || targetText.length < 5) {
                            ui.showStatus('Shot text is too short to split.', true, 3000);
                            return;
                        }

                        // Use LLM to split
                        const { part1, part2 } = await splitShotLines(fullScript, targetText);
                        
                        if (!part1 || !part2) {
                             throw new Error('LLM failed to split text.');
                        }

                        // Create two new shots based on the current one
                        const newShot1 = JSON.parse(safeJsonStringify(shot));
                        newShot1.id = `${shot.id || 'shot'}_split1_${Date.now()}`;
                        newShot1.line_text = part1;
                        if (newShot1.text_reference) newShot1.text_reference = part1;
                        if (newShot1.image_prompt) {
                            newShot1.image_prompt = `Cinematic shot representing: ${part1}. ${shot.image_prompt ? `Style context: ${shot.image_prompt}` : ''}`.trim();
                        }
                        
                        const newShot2 = JSON.parse(safeJsonStringify(shot));
                        newShot2.id = `${shot.id || 'shot'}_split2_${Date.now()}`;
                        newShot2.line_text = part2;
                        if (newShot2.text_reference) newShot2.text_reference = part2;
                        if (newShot2.image_prompt) {
                            newShot2.image_prompt = `Cinematic shot representing: ${part2}. ${shot.image_prompt ? `Style context: ${shot.image_prompt}` : ''}`.trim();
                        }
                        newShot2.image_id = null;
                        delete newShot2._imageObjectURL;
                        
                        if (isPaced) {
                            state.currentScenes.splice(lineIndex, 1, newShot1, newShot2); // Replace 1 with 2
                            // Re-number all shots to keep numbering sequential
                            state.currentScenes.forEach((s: any, idx: number) => {
                                s.shot_number = idx + 1;
                            });
                        } else {
                            state.currentScenes[sceneIndex].lines.splice(lineIndex, 1, newShot1, newShot2);
                        }
                        
                        if (hasActiveTimeline) {
                            // Clear timeline - this is the safest action as splitting alters narrative sequence and timing.
                            timelineState.setClips([]);
                            timelineState.setVideoGenerated(false);
                            timelineState.setMasterAudioBuffer(null);
                            timelineState.setMode('free');
                            ui.showStatus('Shot split. Video timeline cleared - regenerate to include new shot timing.', true, 6000);
                        } else {
                            ui.showStatus('Shot split into two.', false, 3000);
                        }
                        
                        ui.renderResults(state.currentScenes);
                        updateVideoContext();
                        saveVersion(false);
                    } catch (e: any) {
                        console.error('Failed to split shot:', e);
                        ui.showStatus(`Failed to split shot: ${e.message}`, true, 4000);
                    } finally {
                        btn.innerHTML = prevHTML;
                        btn.disabled = false;
                    }
                };
                
                if (hasActiveTimeline) {
                    ui.showConfirmation(
                        'Split Shot?',
                        'Splitting a shot requires clearing the active video timeline because it changes the story timing. You\'ll need to run production again to align the new shots. Continue?',
                        performSplit
                    );
                } else {
                    performSplit();
                }
            }
            return;
        }

        // Generate video prompt button
        const videoPromptBtn = target.closest('.generate-video-prompt-btn');
        if (videoPromptBtn) {
            await generateAndShowVideoPrompt(videoPromptBtn as HTMLButtonElement);
            return;
        }
        
        // Universal prompt button
        const universalPromptBtn = target.closest(".universal-prompt-btn");
        if (universalPromptBtn) {
            const shotEl = universalPromptBtn.closest(".prompt-item") as HTMLElement;
            if (shotEl) {
                const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10);
                const lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
                const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== "undefined";
                const shot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
                if (shot) {
                    shot.video_prompt = "Animate this image as a ten second handcrafted paper stop-motion sequence while preserving the exact original composition. Do not redesign, move, resize, or replace any object from its original position, size, or layering.\n\nCamera stays completely locked for the full ten seconds. No zoom, no pan, no tilt, no rotation, no orbit, no dolly movement, no handheld shake, no cuts, no transitions, and no scene changes. This is a single continuous static shot from start to finish.\n\nFrom zero to seven seconds, the illustration assembles itself naturally from back to front like a real paper sculpture being built by hand, background elements settling into place first, followed by mid ground and foreground objects, then the hero subject last. Each piece slides gently into position, settles with a small natural paper bounce, and casts a soft realistic shadow as it lands. Nothing shifts position again once it has assembled. The full scene is complete by roughly the seven second mark.\n\nFrom seven to ten seconds, the fully assembled scene becomes a living paper still. Nothing changes position, scale, or rotation. Only very small natural motion is allowed, such as a gentle breeze moving a loose edge, soft drifting light across the paper layers, subtle environmental motion appropriate to the scene, or the faintest natural motion from any figure present. All movement stays minimal and believable, never smooth or digital feeling, always carrying a slight handcrafted stop-motion imperfection.\n\nAudio should be limited to close, tactile paper and environmental sound only, such as soft paper sliding, gentle cardboard friction, light paper taps as pieces settle, and quiet ambient sound appropriate to the scene. No music and no narration in this clip.\n\nThe finished result should feel like a real paper diorama on a tabletop that builds itself in front of the viewer and then gently breathes, while the composition itself never changes from the original image.";
                    ui.openVideoPromptModal(shot.video_prompt);
                }
            }
            return;
        }

        // Image container (for modal)
        const imgContainer = target.closest('.img-container');
        if (imgContainer && imgContainer.querySelector('.generated-img')) {
            const img = imgContainer.querySelector('.generated-img') as HTMLImageElement;
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lineIndex] : state.currentScenes[sceneIndex]?.lines[lineIndex];
            
            if (shot) {
                const blob = await fetch(img.src).then(r => r.blob());
                const base64 = await utils.blobToBase64(blob);
                state.modalImageSrc = base64;
                state.modalImageMimeType = shot.imageMimeType;
                state.modalImageEngine = shot.imageEngine;
                state.modalImageShotIndex = lineIndex;
                state.modalImageSceneIndex = sceneIndex;
                dom.generatedImage.src = img.src;
                dom.imageEditContainer.classList.remove('hidden');
                dom.imageEditInput.value = '';
                dom.imageModal.classList.remove('hidden');
            }
            return;
        }

        // Magic prompt button
        const magicBtn = target.closest('.magic-prompt-btn');
        if (magicBtn) {
            await handleMagicPrompt(magicBtn as HTMLButtonElement);
            return;
        }
    }
}

export function handleResultsContainerChange(event: Event) {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('camera-angle-select')) {
        const select = target as HTMLSelectElement;
        const shotElement = select.closest('.prompt-item') as HTMLElement;
        if (shotElement) {
            const sceneIndex = parseInt(shotElement.dataset.sceneIndex!, 10);
            const lineIndex = parseInt(shotElement.dataset.lineIndex!, 10);
            
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            let shot: any;
            if (isPaced) {
                shot = state.currentScenes[lineIndex];
            } else {
                shot = state.currentScenes[sceneIndex]?.lines[lineIndex];
            }

            if (shot) {
                shot.camera_angle = select.value;
                const newMovement = select.value === 'default' ? 'static' : select.value.toLowerCase().replace(/\s+/g, '_');
                shot.camera_movement = newMovement;
                saveVersion(false);
            }
        }
        return;
    }

    if (target.classList.contains('preset-prompt-select')) {
        const select = target as HTMLSelectElement;
        const value = select.value;
        if (!value) return;

        const shotEl = select.closest('.prompt-item') as HTMLElement;
        if (shotEl) {
            const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10);
            const lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
            if (shot) {
                if (value === 'paper_collage') {
                    shot.video_prompt = "Transform the provided image into a 10-second premium editorial documentary paper-collage animation. Preserve the final composition of the provided image exactly. Do not redesign, reposition, resize, or replace any element. The provided image is the FINISHED frame that the animation builds toward.\n\nStyle: hand-cut documentary paper collage in motion. Aged newsprint and archival surfaces, halftone photo cutouts, torn edges, tape, stamps, red string, typewriter strips. Every element moves as a rigid physical paper piece. Visible cutout thickness, print grain, soft layered shadows. Stop-motion cadence, stepped easing, 2-3 frame holds, the hand-made \"cutting on twos\" feel. Never smooth CGI motion.\n\nCAMERA, STRICT: the camera stays completely locked for the entire clip. No zoom, no pan, no tilt, no rotation, no orbit, no dolly, no tracking, no handheld shake, no focus pulls, no reframing, no cuts, no transitions, no morphing, no object replacement, no time skips. One continuous static shot.\n\n0 TO 7 SECONDS, BUILD-ON ASSEMBLY: the frame opens on the EMPTY background plate only: the bare aged-newsprint or archival surface with its stains, grain, and any fixed scaffolding (a map base, a timeline line, a corkboard), with every story element absent. Elements then enter one by one, back to front, in narrative order: background scraps settle first, then the hero cutout slides in with paper drag and a small settle, supporting cutouts drop or pin on with a 2-frame stamp settle, tape presses down, typewriter strips slide in, stamps slap on, red string draws itself from pin to pin, marker underlines and arrows draw themselves last. Each entrance lands with a tiny handcrafted bounce and casts a real layered shadow. No element moves again after it lands. By 7 seconds the frame exactly matches the provided image.";
                } else if (value === 'paper') {
                    shot.video_prompt = "Animate this image as a ten second handcrafted paper stop-motion sequence while preserving the exact original composition. Do not redesign, move, resize, or replace any object from its original position, size, or layering.\n\nCamera stays completely locked for the full ten seconds. No zoom, no pan, no tilt, no rotation, no orbit, no dolly movement, no handheld shake, no cuts, no transitions, and no scene changes. This is a single continuous static shot from start to finish.\n\nFrom zero to seven seconds, the illustration assembles itself naturally from back to front like a real paper sculpture being built by hand, background elements settling into place first, followed by mid ground and foreground objects, then the hero subject last. Each piece slides gently into position, settles with a small natural paper bounce, and casts a soft realistic shadow as it lands. Nothing shifts position again once it has assembled. The full scene is complete by roughly the seven second mark.\n\nFrom seven to ten seconds, the fully assembled scene becomes a living paper still. Nothing changes position, scale, or rotation. Only very small natural motion is allowed, such as a gentle breeze moving a loose edge, soft drifting light across the paper layers, subtle environmental motion appropriate to the scene, or the faintest natural motion from any figure present. All movement stays minimal and believable, never smooth or digital feeling, always carrying a slight handcrafted stop-motion imperfection.\n\nAudio should be limited to close, tactile paper and environmental sound only, such as soft paper sliding, gentle cardboard friction, light paper taps as pieces settle, and quiet ambient sound appropriate to the scene. No music and no narration in this clip.\n\nThe finished result should feel like a real paper diorama on a tabletop that builds itself in front of the viewer and then gently breathes, while the composition itself never changes from the original image.";
                } else if (value === 'cinematic') {
                    shot.video_prompt = "A smooth cinematic dolly-in shot with a 35mm lens, high quality, photorealistic. The camera slowly pushes in towards the main subject. The lighting is cinematic, volumetric, and moody. Depth of field separates the foreground from the background, creating a sense of depth and scale.";
                } else if (value === 'vhs') {
                    shot.video_prompt = "A retro 1980s VHS camcorder effect. The video has visible scanlines, color bleeding, tape tracking errors, and a slightly washed-out vintage aesthetic. The camera movement is slightly handheld and imperfect, resembling amateur home video footage. Low fidelity.";
                }
                ui.openVideoPromptModal(shot.video_prompt);
            }
        }
        // Reset select back to placeholder
        select.value = "";
    }

    if (target.classList.contains('talking-head-mode-select')) {
        const select = target as HTMLSelectElement;
        const shotEl = select.closest('.prompt-item') as HTMLElement;
        if (shotEl) {
            const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10);
            const lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
            if (shot) {
                shot.talkingHeadMode = select.value as any;
                saveVersion(false);
                syncShotMediaToTimeline(shot);
                ui.renderResults(state.currentScenes);
                const label = select.options[select.selectedIndex]?.text || select.value;
                ui.showStatus(`Shot layout updated: ${label}`, false, 2000);
            }
        }
        return;
    }

    if (target.classList.contains('talking-head-shape-select')) {
        const select = target as HTMLSelectElement;
        const shotEl = select.closest('.prompt-item') as HTMLElement;
        if (shotEl) {
            const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10);
            const lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
            if (shot) {
                shot.talkingHeadShape = select.value as any;
                saveVersion(false);
                syncShotMediaToTimeline(shot);
            }
        }
        return;
    }

    if (target.classList.contains('talking-head-size-select')) {
        const select = target as HTMLSelectElement;
        const shotEl = select.closest('.prompt-item') as HTMLElement;
        if (shotEl) {
            const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10);
            const lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
            const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
            const shot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
            if (shot) {
                shot.talkingHeadSize = select.value as any;
                saveVersion(false);
                syncShotMediaToTimeline(shot);
            }
        }
        return;
    }
}
