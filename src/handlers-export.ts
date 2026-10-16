import { audioBufferToWavBlob, safeJsonStringify } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import { generateVeoStyleVideoPrompt } from './api/video';
import * as constants from './constants';
import * as utils from './utils';
import { DB } from './db';
import { assetStorage } from './assetStorage';
import { syncStateFromDOM, handleFileImport, loadProject, saveVersion, startNewProject } from './handlers-project';
import { checkGuestRestriction } from './auth';

declare const JSZip: any;
declare const jspdf: any;

export function getSafeTitle(): string {
    if (dom.videoExportFilenameInput && dom.videoExportFilenameInput.value.trim()) {
        const customName = dom.videoExportFilenameInput.value.trim();
        const normalized = customName.toLowerCase().replace(/[\s_-]+/g, '');
        if (normalized && normalized !== 'aistudiovideoexport' && normalized !== 'mygeneratedvideo') {
            return utils.sanitizeFilename(customName);
        }
    }
    const scriptTitle = utils.getScriptDerivedTitle(5);
    if (scriptTitle) return scriptTitle;
    return `storyboard_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
}

/**
 * Enhanced portable export that embeds actual asset data.
 */
export async function exportProject() {
    if (checkGuestRestriction("Exporting Project Files")) return;
    syncStateFromDOM(); // Ensure latest prompt edits are captured
    
    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Packaging Assets for Export');
    ui.updateProcessingProgress(10, 'Preparing high-fidelity export...');

    const allShots = state.currentScenes.flatMap(s => s.lines || [s]);
    const totalAssets = allShots.length + (state.uploadedAudioAssetId ? 1 : 0);
    let processed = 0;

    // We create a deep clone for the export object so we don't pollute the active session state
    // with massive base64 strings.
    const exportScenes = state.currentScenes.map(scene => {
        const newScene = { ...scene };
        // Strip ephemeral URLs from scene (if paced)
        delete newScene._imageObjectURL;
        delete newScene._videoObjectURL;
        delete newScene._audioObjectURL;
        delete newScene._bgAudioObjectURL;
        
        if (newScene.lines) {
            newScene.lines = newScene.lines.map((shot: any) => {
                const newShot = { ...shot };
                delete newShot._imageObjectURL;
                delete newShot._videoObjectURL;
                delete newShot._audioObjectURL;
                return newShot;
            });
        }
        return newScene;
    });
    const allExportShots = exportScenes.flatMap((s: any) => s.lines || [s]);

    for (let i = 0; i < allExportShots.length; i++) {
        const shot = allExportShots[i];
        const originalShot = allShots[i];
        
        if (originalShot.image_id) {
            ui.updateProcessingProgress(10 + (processed / totalAssets) * 80, `Packing image ${i + 1}...`);
            try {
                const blob = await assetStorage.getAsset(originalShot.image_id);
                if (blob) {
                    shot.exportedImageData = await utils.blobToBase64(blob);
                }
            } catch (err) {
                console.warn(`Failed to export image ${i}:`, err);
            }
        }
        processed++;
    }

    let exportedAudioData = undefined;
    if (state.uploadedAudioAssetId) {
        ui.updateProcessingProgress(90, 'Packing audio asset...');
        try {
            const audioBlob = await assetStorage.getAsset(state.uploadedAudioAssetId);
            if (audioBlob) {
                exportedAudioData = await utils.blobToBase64(audioBlob);
            }
        } catch (err) {
            console.warn("Failed to export audio asset:", err);
        }
    }

    const projectData = {
        version: constants.PROJECT_VERSION,
        story: dom.storyInput?.value || (state as any).originalStory || '',
        scenes: exportScenes,
        exportedAudioData, // Embedded audio
        characters: state.characterProfiles,
        locations: state.locationProfiles,
        elements: state.keyElementProfiles,
        imageModel: dom.imageModelSelect?.value || constants.DEFAULT_IMAGE_MODEL,
        videoModel: dom.videoModelSelect?.value || 'veo-3.1-lite-generate-001',
        imageStyle: dom.imageStyleSelect?.value,
        customPrompt: dom.customPromptInput?.value,
        customStyleAnalyzedPrompt: dom.customStyleAnalyzedPrompt?.value,
        customStyleKeywordsInput: dom.customStyleKeywordsInput?.value,
        imageResolution: dom.imageResolutionSelect?.value,
        detailLevel: dom.detailLevelSelect?.value,
        pacingFactor: dom.pacingFactorSelect?.value,
        customShotCount: dom.customShotCountInput?.value,
        safeRephrase: dom.enableSafeRephraseCheckbox?.checked ?? false,
        visualPunctuationEnabled: state.visualPunctuationEnabled,
        bgAudioPrompt: state.bgAudioPrompt,
        bgAudioId: state.bgAudioId,
        uploadedAudioAssetId: state.uploadedAudioAssetId,
        customVoiceIds: state.customVoiceIds,
        showSubtitles: timelineState.showSubtitles,
        videoSubtitleStyle: timelineState.videoSubtitleStyle,
        videoSubtitlePosition: timelineState.videoSubtitlePosition,
        videoSubtitleFont: timelineState.videoSubtitleFont,
        videoSubtitleColors: state.videoSubtitleColors,
        customFonts: state.customFonts,
        timelineMode: timelineState.mode,
        graphics: timelineState.graphics || [],
        audioSplits: timelineState.audioSplits || [],
        audioMetadata: timelineState.masterAudioBuffer ? {
            duration: timelineState.masterAudioBuffer.duration,
            sampleRate: timelineState.masterAudioBuffer.sampleRate,
            numberOfChannels: timelineState.masterAudioBuffer.numberOfChannels,
            hadGlobalTimestamps: timelineState.globalWordTimestamps?.length || 0
        } : null,
        videoTimelineMetadata: timelineState.clips.map(c => ({
            id: c.id, startTime: c.startTime, endTime: c.endTime, duration: c.duration, text: c.text,
            cameraMovement: c.cameraMovement, transitionToNext: c.transitionToNext, wordTimestamps: c.wordTimestamps,
            wordRange: c.wordRange, startWordIndex: c.startWordIndex, endWordIndex: c.endWordIndex,
            alignmentConfidence: c.alignmentConfidence, textMatchConfidence: c.textMatchConfidence,
            timingReliability: c.timingReliability, timingProvenance: c.timingProvenance, timingSource: c.timingSource
        }))
    };

    ui.updateProcessingProgress(95, 'Generating file...');
    
    // Chunked stringification to avoid "Invalid string length" on massive projects
    const blobParts: BlobPart[] = [];
    blobParts.push('{');
    const keys = Object.keys(projectData);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        blobParts.push(JSON.stringify(key) + ':');
        
        if (key === 'scenes' && Array.isArray((projectData as any)[key])) {
            blobParts.push('[');
            const scenes = (projectData as any)[key];
            for (let j = 0; j < scenes.length; j++) {
                const scene = scenes[j];
                blobParts.push('{');
                const sceneKeys = Object.keys(scene);
                for (let k = 0; k < sceneKeys.length; k++) {
                    const sKey = sceneKeys[k];
                    blobParts.push(JSON.stringify(sKey) + ':');
                    
                    if (sKey === 'lines' && Array.isArray(scene[sKey])) {
                        blobParts.push('[');
                        const lines = scene[sKey];
                        for (let l = 0; l < lines.length; l++) {
                            blobParts.push(safeJsonStringify(lines[l]));
                            if (l < lines.length - 1) blobParts.push(',');
                        }
                        blobParts.push(']');
                    } else {
                        const strVal = safeJsonStringify(scene[sKey]);
                        blobParts.push(strVal === undefined ? 'null' : strVal);
                    }
                    
                    if (k < sceneKeys.length - 1) blobParts.push(',');
                }
                blobParts.push('}');
                if (j < scenes.length - 1) blobParts.push(',');
            }
            blobParts.push(']');
        } else {
            const strVal = safeJsonStringify((projectData as any)[key]);
            blobParts.push(strVal === undefined ? 'null' : strVal);
        }
        
        if (i < keys.length - 1) blobParts.push(',');
    }
    blobParts.push('}');
    
    const blob = new Blob(blobParts, { type: 'application/json' });
    utils.downloadBlob(blob, `${getSafeTitle()}.contentgenai`);
    
    ui.updateProcessingProgress(100, 'Export complete!');
    setTimeout(() => ui.closeProcessingModal(), 500);
}

export async function loadFromHistory(id: string) {
    ui.showConfirmation(
        'Load Version',
        'This will replace your current project. Your current work will be saved to history first so you can undo this. Continue?',
        async () => {
            try {
                await saveVersion(false, true); // snapshot current state first
                const item = await DB.get(constants.HISTORY_STORE, parseInt(id, 10));
                if (item?.projectData) {
                    await DB.put(constants.APP_STATE_STORE, item.projectData, 'currentProject');
                    await loadProject();
                    if (dom.historyModal) dom.historyModal.classList.add('hidden');
                }
            } catch (error) {
                console.error("Failed to load version", error);
                ui.showStatus('Failed to load version.', true, 4000);
            }
        }
    );
}

export async function deleteFromHistory(id: string) {
    ui.showConfirmation('Delete History', 'Sure?', async () => {
        try { 
            await DB.delete(constants.HISTORY_STORE, parseInt(id, 10)); 
            await ui.openHistoryModal(); 
        } catch (error) {
            console.error("Failed to delete history entry:", error);
            ui.showStatus("Failed to delete history item.", true);
        }
    });
}

export function clearHistory() {
    ui.showConfirmation('Clear All Data', 'This wipes history, the active project, local app data, and caches. Your login, credits, and configured API keys will be kept. Continue?', async () => {
        try {
            // 1. All IndexedDB stores (history, current project app_state, reference images, caches)
            const stores = [
                constants.HISTORY_STORE,
                constants.APP_STATE_STORE,
                constants.REFERENCE_IMAGE_STORE,
                constants.NARRATION_CACHE_STORE,
                constants.TRANSCRIPT_CACHE_STORE,
            ];
            for (const store of stores) {
                try {
                    await DB.clear(store);
                } catch (storeErr) {
                    console.warn(`Could not clear IndexedDB store "${store}":`, storeErr);
                }
            }

            // 2. App localStorage — preserve auth, credits, API keys and provider credentials
            const keep = new Set([
                'local_auth_session',
                'userCredits',
                'geminiKeys',
                'apiKeys',
                'system_api_keys',
                'cached_api_key',
                'system_dynamic_costs',
                'userGeminiApiKey',
                'geminiProvider',
                'vertexProjectId',
                'vertexLocation',
                'ai33ApiKey',
                'gradioTtsApiUrl',
                'stabilityApiKey',
                'deepgramApiKey',
                'elevenlabsApiKey',
                'elevenlabsSelectedModel',
                'pexelsApiKey',
                'freesoundApiKey',
                'geminiAuthMode',
                'geminiPsid',
                'geminiPsidts',
                'geminiPsidcc',
                'geminiCompass',
                'geminiSid',
                'geminiHsid',
                'geminiSsid',
                'geminiCookieExpired',
                'geminiCookieVerifiedAt',
                'geminiTextModel',
                'whisperModel'
            ]);
            Object.keys(localStorage).forEach((key) => {
                if (!keep.has(key)) localStorage.removeItem(key);
            });

            // 3. Reset in-memory state and UI components
            startNewProject(false);
            if (dom.storyInput) dom.storyInput.value = '';

            // 4. Refresh history modal view
            if (dom.historyModal && !dom.historyModal.classList.contains('hidden')) {
                await ui.openHistoryModal();
            }

            ui.showStatus('All project data cleared. Login, credits, and API keys preserved.', false, 3500);
        } catch (error) {
            console.error("Failed to clear all data:", error);
            ui.showStatus("Failed to clear all data.", true);
        }
    });
}

export async function exportAsText(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    
    const title = getSafeTitle();
    const content = `Title: ${title}\n\nStory:\n${dom.storyInput.value}\n\n---\nGenerated by ContentGen AI`;
    utils.downloadBlob(new Blob([content], { type: 'text/plain' }), `${title}.txt`);
}

export async function exportImagePromptsAsText(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    
    syncStateFromDOM();
    const title = getSafeTitle();
    let content = '';

    const stylePrompt = ui.getCurrentStylePrompt();
    if (!stylePrompt) {
        ui.showStatus('No image style selected or defined.', true, 3000);
        return;
    }

    const characterModifier = ui.getCurrentCharacterModifier();
    let finalStylePrompt = stylePrompt
        .replace(/\[scene\]/gi, '')
        .replace(/^[.,]\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (characterModifier) {
        finalStylePrompt += `\n[CHARACTER MODIFIER]\nCharacter design note: ${characterModifier}`;
    }

    if (!Array.isArray(state.currentScenes) || state.currentScenes.length === 0) {
        ui.showStatus('Error: No storyboard data available. Please analyze the story first.', true, 5000);
        return;
    }

    const styleIntent = constants.styleIntentMap[stylePrompt] || constants.StyleIntent.CINEMATIC;
    const negativePrompt = constants.INTENT_NEGATIVE_PROMPTS[styleIntent] || '';
    let shotCounter = 1;

    const formatShotPrompt = (shotNum: number, sceneDesc: string, style: string, negPrompt: string) => {
        return `[SHOT ${shotNum}]\n[SCENE]\n${sceneDesc}\n\n[VISUAL STYLE — APPLY TO FINAL OUTPUT]\n${style}\n\n[NEGATIVE PROMPT]\n${negPrompt}\n\n[RENDERING INSTRUCTION]\nRender the entire scene exclusively in the visual style described. Do not deviate.\n\n---\n\n`;
    };

    // Detect format and handle properly
    const isPacedFormat = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';

    if (isPacedFormat) {
        state.currentScenes.forEach((shot: any) => {
            if (shot && shot.image_prompt) {
                const promptWithConsistency = utils.injectCharacterConsistencyIntoPrompt(shot.image_prompt, shot.text_reference);
                content += formatShotPrompt(shotCounter++, promptWithConsistency, finalStylePrompt, negativePrompt);
            }
        });
    } else {
        state.currentScenes.forEach((scene: any) => {
            if (!scene || !scene.lines || !Array.isArray(scene.lines)) return;
            scene.lines.forEach((shot: any) => {
                if (shot && shot.image_prompt) {
                    const promptWithConsistency = utils.injectCharacterConsistencyIntoPrompt(shot.image_prompt, shot.text_reference);
                    content += formatShotPrompt(shotCounter++, promptWithConsistency, finalStylePrompt, negativePrompt);
                }
            });
        });
    }
    
    utils.downloadBlob(new Blob([content], { type: 'text/plain' }), `${title}_prompts.txt`);
    ui.showStatus(`Exported ${shotCounter - 1} image prompts.`, false, 3000);
}

export async function exportAsCSV(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    
    syncStateFromDOM();
    const title = getSafeTitle();
    const csvHeader = "Scene,Shot,Narrative,Prompt,Camera Movement\n";
    let csvRows: string[] = [];
    let shotCounter = 1;
    state.currentScenes.forEach(scene => {
        const lines = scene.lines || [scene];
        lines.forEach((shot: any) => {
             csvRows.push([scene.scene_number || 1, shotCounter++, `"${(shot.text_reference || shot.line_text || '').replace(/"/g, '""')}"`, `"${(shot.image_prompt || '').replace(/"/g, '""')}"`, shot.camera_movement || 'Static'].join(","));
        });
    });
    utils.downloadBlob(new Blob([csvHeader + csvRows.join("\n")], { type: 'text/csv;charset=utf-8;' }), `${title}.csv`);
}

export async function exportAsPDF(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    
    syncStateFromDOM();
    ui.showStatus('Generating PDF...', false, 3000);
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const title = getSafeTitle();
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = 20;

    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(title, pageW / 2, yPos, { align: 'center' });
    yPos += 15;

    doc.setFontSize(14);
    doc.text("Story", margin, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const maxW = pageW - margin * 2;
    const storyLines = doc.splitTextToSize(dom.storyInput.value, maxW);
    doc.text(storyLines, margin, yPos);
    yPos += (storyLines.length * 4) + 15;

    const checkPageBreak = (neededHeight: number) => {
        if (yPos + neededHeight > pageH - margin) {
            doc.addPage();
            yPos = 20;
        }
    };

    doc.setFontSize(14);
    doc.text("Storyboard", margin, yPos);
    yPos += 10;

    const allShots = state.currentScenes.flatMap((scene: any, sIdx: number) => {
        const shotsInScene = scene.lines || [scene];
        return shotsInScene.map((line: any, lIdx: number) => ({
            sceneNum: scene.scene_number || sIdx + 1,
            shotId: line.shot_number ? `${line.shot_number}` : `${sIdx + 1}.${lIdx + 1}`,
            text: line.text_reference || line.line_text || '',
            prompt: line.image_prompt || '',
            camera: line.camera_movement || 'Static',
            hasImage: !!line.image_id
        }));
    });
    
    allShots.forEach((shot) => {
        const textLines = doc.splitTextToSize(shot.text, maxW);
        const promptLines = doc.splitTextToSize(`Prompt: ${shot.prompt}`, maxW);
        const shotHeight = 10 + (textLines.length * 4) + (promptLines.length * 4) + 10;
        checkPageBreak(shotHeight);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`Shot ${shot.shotId} ${shot.hasImage ? '✓' : ''} | Camera: ${shot.camera}`, margin, yPos);
        yPos += 6;
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.text(textLines, margin, yPos);
        yPos += textLines.length * 4 + 2;
        if (shot.prompt) {
            doc.setTextColor(128);
            doc.setFont(undefined, 'italic');
            doc.text(promptLines, margin, yPos);
            yPos += promptLines.length * 4 + 8;
            doc.setTextColor(0);
            doc.setFont(undefined, 'normal');
        } else yPos += 8;
        doc.setDrawColor(220);
        doc.line(margin, yPos-4, pageW - margin, yPos-4);
    });
    doc.save(`${title}.pdf`);
    ui.showStatus('PDF exported with full storyboard.', false, 2000);
}

export async function downloadAllImages() {
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    if (checkGuestRestriction("Exporting Image Package")) return;
    const images = Array.from(dom.resultsContainer.querySelectorAll('.generated-img')) as HTMLImageElement[];
    if (images.length === 0) return;
    const zip = new JSZip();
    
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    
    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        const id = img.dataset.id;
        let shotNumberStr = String(i + 1).padStart(3, '0');
        
        if (id) {
            if (isPaced) {
                const shot = state.currentScenes.find((s: any) => s.id === id);
                if (shot) {
                    const shotNum = shot.shot_number || (state.currentScenes.indexOf(shot) + 1);
                    shotNumberStr = String(shotNum).padStart(3, '0');
                }
            } else {
                for (let sIdx = 0; sIdx < state.currentScenes.length; sIdx++) {
                    const scene = state.currentScenes[sIdx];
                    const lines = scene.lines || [scene];
                    const lIdx = lines.findIndex((l: any) => l.id === id);
                    if (lIdx !== -1) {
                        const sceneNum = String(sIdx + 1).padStart(3, '0');
                        const shotNum = String(lIdx + 1).padStart(3, '0');
                        shotNumberStr = `${sceneNum}_${shotNum}`;
                        break;
                    }
                }
            }
        }
        
        const response = await fetch(img.src);
        zip.file(`shot_${shotNumberStr}.jpg`, await response.blob());
    }
    const content = await zip.generateAsync({ type: "blob" });
    utils.downloadBlob(content, `${getSafeTitle()}_images.zip`);
}

export async function exportVideoPrompts(event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');

    syncStateFromDOM();

    if (!state.currentScenes.length) {
        ui.showStatus('No storyboard to export prompts from.', true, 3000);
        return;
    }
    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Exporting Video Prompts', true, 'Cancel Export');
    state.isVideoProductionRunning = true;
    let fullContent = '';
    const allShots = state.currentScenes.flatMap((s, i) => (s.lines || [s]).map((l: any) => ({ ...l, sceneIndex: i })));
    
    const styleName = dom.imageStyleSelect ? dom.imageStyleSelect.options[dom.imageStyleSelect.selectedIndex]?.text : "The specified style";

    for (let i = 0; i < allShots.length; i++) {
        if (!state.isVideoProductionRunning) break;
        ui.updateProcessingProgress((i / allShots.length) * 100, `Compiling prompt for shot ${i + 1}...`);
        
        const prompt = await generateVeoStyleVideoPrompt(allShots[i], styleName || "The specified style");

        fullContent += `// ---- SHOT ${i + 1} ----\n`;
        fullContent += prompt + '\n\n---\n\n';
    }
    utils.downloadBlob(new Blob([fullContent], { type: 'text/plain' }), `${getSafeTitle()}_video_prompts.txt`);
    state.isVideoProductionRunning = false; 
    ui.closeProcessingModal();
}

export async function generateAndShowVideoPrompt(btn: HTMLButtonElement) {
    const shotEl = btn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    const sIdx = parseInt(shotEl.dataset.sceneIndex!, 10), lIdx = parseInt(shotEl.dataset.lineIndex!, 10);
    
    syncStateFromDOM();

    if (state.currentScenes.length === 0) return;
    
    const shot = state.currentScenes[0].shot_number !== undefined ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
    if (!shot) return;
    btn.disabled = true; btn.innerHTML = '<div class="loader small-loader" style="width:12px"></div>';
    
    const styleName = dom.imageStyleSelect ? dom.imageStyleSelect.options[dom.imageStyleSelect.selectedIndex]?.text : "The specified style";

    try {
        if (!shot.video_prompt) {
            shot.video_prompt = await generateVeoStyleVideoPrompt(shot, styleName || "The specified style");
        }
        ui.openVideoPromptModal(shot.video_prompt);
    } catch (e: any) {
        console.error("Failed to generate video prompt", e);
        ui.showStatus("Failed to generate video prompt. Please check your API key or try again.", true, 4000);
    } finally { 
        btn.disabled = false; 
        btn.innerHTML = '🎬'; 
    }
}

export async function exportNLETimeline(event?: Event) {
    if (checkGuestRestriction("Exporting Timeline XML")) return;
    event?.preventDefault();
    event?.stopPropagation();
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');

    if (!timelineState.videoGenerated || !timelineState.clips.length) {
        ui.showStatus('No timeline to export. Please generate video first.', true, 3000);
        return;
    }

    try {
        const { forcePausePlayback } = await import('./videoController');
        forcePausePlayback(undefined, true);
    } catch (e) {}

    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Exporting NLE Timeline (FCPXML)', true, 'Cancel Export');
    state.isVideoProductionRunning = true;
    state.isExporting = true;

    try {
        const zip = new JSZip();
        const fps = 24;
        const currentRatio = (state.aspectRatio || dom.videoDirectorAspectSelect?.value || dom.imageResolutionSelect?.value || '16:9') as any;
        const resolutionKey = dom.videoExportResolutionSelect ? dom.videoExportResolutionSelect.value : '';
        const { width, height } = utils.getExportResolutionDimensions(currentRatio, resolutionKey);
        const title = getSafeTitle();

        // 1. Export Audio if available
        let audioFileName = '';
        if (timelineState.masterAudioBuffer) {
            audioFileName = 'audio_track.wav';
            const audioBlob = audioBufferToWavBlob(timelineState.masterAudioBuffer);
            zip.file(audioFileName, audioBlob);
        }

        // 2. Export Images
        const clips = timelineState.clips;
        const imageFiles = new Map<string, string>(); // image.src -> filename
        let imageCounter = 1;

        for (const clip of clips) {
            if (!state.isVideoProductionRunning) break;
            if (clip.image && clip.image.src && !imageFiles.has(clip.image.src)) {
                const filename = `image_${String(imageCounter++).padStart(3, '0')}.jpg`;
                imageFiles.set(clip.image.src, filename);
                const response = await fetch(clip.image.src);
                zip.file(filename, await response.blob());
            }
        }

        if (!state.isVideoProductionRunning) {
            ui.closeProcessingModal();
            return;
        }

        // 3. Generate FCPXML
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<!DOCTYPE xmeml>\n`;
        xml += `<xmeml version="4">\n`;
        xml += `  <project>\n`;
        xml += `    <name>${ui.escapeHtml(title)}</name>\n`;
        xml += `    <children>\n`;
        xml += `      <sequence id="sequence-1">\n`;
        xml += `        <name>${ui.escapeHtml(title)} Sequence</name>\n`;
        xml += `        <duration>${Math.round(clips[clips.length - 1].endTime * fps)}</duration>\n`;
        xml += `        <rate>\n`;
        xml += `          <timebase>${fps}</timebase>\n`;
        xml += `          <ntsc>FALSE</ntsc>\n`;
        xml += `        </rate>\n`;
        xml += `        <media>\n`;
        xml += `          <video>\n`;
        xml += `            <format>\n`;
        xml += `              <samplecharacteristics>\n`;
        xml += `                <width>${width}</width>\n`;
        xml += `                <height>${height}</height>\n`;
        xml += `              </samplecharacteristics>\n`;
        xml += `            </format>\n`;
        xml += `            <track>\n`;

        clips.forEach((clip, index) => {
            const filename = clip.image ? imageFiles.get(clip.image.src) : '';
            const startFrame = Math.round(clip.startTime * fps);
            const endFrame = Math.round(clip.endTime * fps);
            const durationFrames = endFrame - startFrame;

            xml += `              <clipitem id="clip-${index}">\n`;
            xml += `                <name>${filename || `Clip ${index}`}</name>\n`;
            xml += `                <duration>${durationFrames}</duration>\n`;
            xml += `                <rate>\n`;
            xml += `                  <timebase>${fps}</timebase>\n`;
            xml += `                  <ntsc>FALSE</ntsc>\n`;
            xml += `                </rate>\n`;
            xml += `                <start>${startFrame}</start>\n`;
            xml += `                <end>${endFrame}</end>\n`;
            xml += `                <in>0</in>\n`;
            xml += `                <out>${durationFrames}</out>\n`;
            
            if (filename) {
                xml += `                <file id="file-${index}">\n`;
                xml += `                  <name>${filename}</name>\n`;
                xml += `                  <pathurl>file://localhost/${filename}</pathurl>\n`;
                xml += `                  <media>\n`;
                xml += `                    <video>\n`;
                xml += `                      <duration>${durationFrames}</duration>\n`;
                xml += `                    </video>\n`;
                xml += `                  </media>\n`;
                xml += `                </file>\n`;
            }
            xml += `              </clipitem>\n`;
        });

        xml += `            </track>\n`;
        xml += `          </video>\n`;

        if (audioFileName) {
            xml += `          <audio>\n`;
            xml += `            <track>\n`;
            xml += `              <clipitem id="audio-clip">\n`;
            xml += `                <name>${audioFileName}</name>\n`;
            const totalAudioFrames = Math.round(clips[clips.length - 1].endTime * fps);
            xml += `                <duration>${totalAudioFrames}</duration>\n`;
            xml += `                <rate>\n`;
            xml += `                  <timebase>${fps}</timebase>\n`;
            xml += `                  <ntsc>FALSE</ntsc>\n`;
            xml += `                </rate>\n`;
            xml += `                <start>0</start>\n`;
            xml += `                <end>${totalAudioFrames}</end>\n`;
            xml += `                <in>0</in>\n`;
            xml += `                <out>${totalAudioFrames}</out>\n`;
            xml += `                <file id="file-audio">\n`;
            xml += `                  <name>${audioFileName}</name>\n`;
            xml += `                  <pathurl>file://localhost/${audioFileName}</pathurl>\n`;
            xml += `                  <media>\n`;
            xml += `                    <audio>\n`;
            xml += `                      <samplecharacteristics>\n`;
            xml += `                        <samplerate>44100</samplerate>\n`;
            xml += `                      </samplecharacteristics>\n`;
            xml += `                    </audio>\n`;
            xml += `                  </media>\n`;
            xml += `                </file>\n`;
            xml += `              </clipitem>\n`;
            xml += `            </track>\n`;
            xml += `          </audio>\n`;
        }

        xml += `        </media>\n`;
        xml += `      </sequence>\n`;
        xml += `    </children>\n`;
        xml += `  </project>\n`;
        xml += `</xmeml>\n`;

        zip.file(`${title}_timeline.xml`, xml);

        ui.updateProcessingProgress(90, 'Zipping files...');
        const content = await zip.generateAsync({ type: "blob" });
        utils.downloadBlob(content, `${title}_NLE_Export.zip`);
        ui.showStatus('NLE Timeline exported successfully!', false, 3000);

    } catch (error: any) {
        console.error("NLE Export Error:", error);
        ui.showStatus(`Export failed: ${error.message}`, true, 5000);
    } finally {
        state.isExporting = false;
        state.isVideoProductionRunning = false;
        ui.setButtonsDisabled(false);
        ui.closeProcessingModal();
    }
}