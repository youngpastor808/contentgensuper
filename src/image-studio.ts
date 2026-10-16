/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as DOM from './dom';
import { generateImageWithFallback, editImageWithGemini } from './api/images';
import { generateContentWithFallback } from './api/core';
import { state } from './state';
import { showStatus, renderVideoClips, renderResults } from './ui';
import { saveVersion } from './handlers-project';
import { assetStorage } from './assetStorage';
import { readImageBlobFromSystemClipboard, processAndRoutePastedImage } from './handlers-images';
import { detectC2PA, stripC2PA, cleanMediaBlob } from './c2pa-cleaner';
import { safelyReplaceShotMedia } from './memoryManager';

let currentStudioResultBase64: string | null = null;
let currentStudioResultMime: string = 'image/png';
let currentStudioSourceImage: { data: string, mimeType: string } | null = null;

export function getAllShotsFlat(): { shot: any, label: string, sceneIndex: number, lineIndex: number }[] {
    const shots: { shot: any, label: string, sceneIndex: number, lineIndex: number }[] = [];
    if (!state.currentScenes || state.currentScenes.length === 0) return shots;

    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';

    if (isPaced) {
        state.currentScenes.forEach((shot, i) => {
            const shotNum = shot.shot_number || (i + 1);
            const textRef = (shot.text_reference || shot.line_text || `Shot ${shotNum}`).substring(0, 35);
            shots.push({
                shot,
                label: `Shot #${shotNum}: ${textRef}`,
                sceneIndex: 0,
                lineIndex: i
            });
        });
    } else {
        state.currentScenes.forEach((scene: any, i: number) => {
            const lines = scene.lines || [scene];
            lines.forEach((shot: any, j: number) => {
                const shotNumText = `${i + 1}.${j + 1}`;
                const textRef = (shot.text_reference || shot.line_text || `Shot ${shotNumText}`).substring(0, 30);
                shots.push({
                    shot,
                    label: `Shot ${shotNumText}: ${textRef}`,
                    sceneIndex: i,
                    lineIndex: j
                });
            });
        });
    }
    return shots;
}

export function openImageStudioModal(): void {
    if (!DOM.imageStudioModal) return;
    populateShotSelector();
    DOM.imageStudioModal.classList.remove('hidden');
}

let imageStudioInitialized = false;

export function initImageStudio() {
    if (imageStudioInitialized) return;
    if (!DOM.openImageStudioBtn || !DOM.imageStudioModal) return;

    imageStudioInitialized = true;

    // Open Modal
    const openModal = () => {
        openImageStudioModal();
    };

    DOM.openImageStudioBtn.addEventListener('click', openModal);
    if (DOM.openImageStudioBtnMobile) {
        DOM.openImageStudioBtnMobile.addEventListener('click', openModal);
    }

    // Close Modal
    if (DOM.closeImageStudioModalBtn) {
        DOM.closeImageStudioModalBtn.addEventListener('click', () => {
            DOM.imageStudioModal.classList.add('hidden');
        });
    }

    // Tabs
    DOM.studioTabGenBtn?.addEventListener('click', () => switchTab('gen'));
    DOM.studioTabEditBtn?.addEventListener('click', () => switchTab('edit'));
    DOM.studioTabMemeBtn?.addEventListener('click', () => switchTab('meme'));
    DOM.studioTabC2paBtn?.addEventListener('click', () => switchTab('c2pa'));

    // C2PA Cleaner tab event handlers
    let currentC2paSelectedFile: File | null = null;

    DOM.c2paFileInput?.addEventListener('change', async () => {
        const file = DOM.c2paFileInput.files?.[0];
        if (!file) return;
        currentC2paSelectedFile = file;

        if (DOM.c2paInspectionResults) DOM.c2paInspectionResults.classList.remove('hidden');
        if (DOM.c2paDetectedStatus) {
            DOM.c2paDetectedStatus.innerText = 'Analyzing byte chunks...';
            DOM.c2paDetectedStatus.className = 'px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-yellow-900/60 text-yellow-300 border border-yellow-500/40';
        }
        if (DOM.c2paDetailsList) {
            DOM.c2paDetailsList.innerHTML = `<div class="text-gray-400">Inspecting <b>${file.name}</b> (${(file.size / 1024).toFixed(1)} KB)...</div>`;
        }

        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            const report = detectC2PA(bytes);

            if (DOM.c2paDetectedStatus) {
                if (report.present) {
                    DOM.c2paDetectedStatus.innerText = `AI Provenance Detected (${report.locations.length} item${report.locations.length > 1 ? 's' : ''})`;
                    DOM.c2paDetectedStatus.className = 'px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-red-900/60 text-red-300 border border-red-500/40';
                } else {
                    DOM.c2paDetectedStatus.innerText = 'Clean / No C2PA Detected';
                    DOM.c2paDetectedStatus.className = 'px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-500/40';
                }
            }

            if (DOM.c2paDetailsList) {
                let html = `<div class="text-gray-300">Format: <span class="font-mono text-emerald-400 font-bold uppercase">${report.format}</span> | File Size: <span class="font-mono">${(file.size / 1024).toFixed(1)} KB</span></div>`;
                if (report.claimGenerators && report.claimGenerators.length > 0) {
                    html += `<div class="text-amber-300">Generators / Claims: <span class="font-mono font-semibold">${report.claimGenerators.join(', ')}</span></div>`;
                }
                if (report.locations.length > 0) {
                    html += `<div class="mt-1 font-semibold text-gray-300">Found Provenance Chunks:</div><ul class="list-disc list-inside space-y-0.5 text-gray-400">`;
                    for (const loc of report.locations) {
                        html += `<li><b class="text-gray-200">${loc.format}</b>: ${loc.location} (${loc.size} bytes)${loc.claimGenerator ? ` · <i>${loc.claimGenerator}</i>` : ''}</li>`;
                    }
                    html += `</ul>`;
                } else {
                    html += `<div class="text-emerald-400 text-xs">✅ No C2PA JUMBF manifests, caBX chunks, or generative AI metadata signatures found in this file.</div>`;
                }
                DOM.c2paDetailsList.innerHTML = html;
            }
        } catch (inspectErr: any) {
            if (DOM.c2paDetailsList) {
                DOM.c2paDetailsList.innerHTML = `<div class="text-red-400">Failed to analyze file: ${inspectErr.message}</div>`;
            }
        }
    });

    DOM.c2paStripBtn?.addEventListener('click', async () => {
        if (!currentC2paSelectedFile) {
            showStatus('Please choose a file to clean.', true);
            return;
        }

        try {
            showStatus('Stripping C2PA metadata...', false);
            const { cleanedBlob, result } = await cleanMediaBlob(currentC2paSelectedFile, { mode: 'c2pa_only' });
            if (!result.success) {
                showStatus(result.error || 'Could not clean file.', true);
                return;
            }

            // Trigger file download
            const url = URL.createObjectURL(cleanedBlob);
            const a = document.createElement('a');
            a.href = url;
            const originalName = currentC2paSelectedFile.name;
            const dotIdx = originalName.lastIndexOf('.');
            const baseName = dotIdx > 0 ? originalName.substring(0, dotIdx) : originalName;
            const ext = dotIdx > 0 ? originalName.substring(dotIdx) : '';
            a.download = `${baseName}_clean${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);

            showStatus(`Successfully stripped AI metadata! (${result.removedBytes} bytes removed, verified clean)`, false, 5000);
            if (DOM.c2paDetectedStatus) {
                DOM.c2paDetectedStatus.innerText = 'Stripped & Verified Clean ✅';
                DOM.c2paDetectedStatus.className = 'px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-900/60 text-emerald-300 border border-emerald-500/40';
            }
        } catch (stripErr: any) {
            showStatus('Failed to clean metadata: ' + stripErr.message, true);
        }
    });

    // Style Chips
    const chips = document.querySelectorAll('.studio-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', (e) => {
            const style = (e.currentTarget as HTMLElement).getAttribute('data-style');
            if (style && DOM.studioPromptInput) {
                const current = DOM.studioPromptInput.value.trim();
                DOM.studioPromptInput.value = current ? `${current}, ${style}` : style;
                DOM.studioPromptInput.focus();
            }
        });
    });

    // Magic Enhance Prompt
    DOM.studioEnhancePromptBtn?.addEventListener('click', async () => {
        const raw = DOM.studioPromptInput.value.trim();
        if (!raw) {
            showStatus('Please enter an initial prompt to enhance.', true);
            return;
        }

        DOM.studioEnhancePromptBtn.disabled = true;
        DOM.studioEnhancePromptBtn.innerText = '✨ Enhancing...';
        try {
            const prompt = `Expand this image prompt into a highly detailed, cinematic visual prompt for AI image generation (1-2 sentences with vivid details and lighting instructions): "${raw}"`;
            const result = await generateContentWithFallback({ contents: prompt });
            if (result.text) {
                DOM.studioPromptInput.value = result.text.trim();
                showStatus('Prompt enhanced with AI!', false);
            }
        } catch (err: any) {
            showStatus('Failed to enhance prompt: ' + err.message, true);
        } finally {
            DOM.studioEnhancePromptBtn.disabled = false;
            DOM.studioEnhancePromptBtn.innerText = '✨ Magic Enhance Prompt';
        }
    });

    // ⚡ Generate Image (Text-to-Image)
    DOM.studioGenerateBtn?.addEventListener('click', async () => {
        const prompt = DOM.studioPromptInput.value.trim();
        if (!prompt) {
            showStatus('Please enter an image prompt.', true);
            return;
        }

        setStudioLoading(true, 'Generating image with AI...');
        try {
            const aspect = (DOM.studioAspectSelect.value || '16:9') as any;
            const model = DOM.studioModelSelect.value || 'gemini-3.1-flash-lite-image';

            const res = await generateImageWithFallback(prompt, aspect, model);
            if (res.base64) {
                setStudioResult(res.base64, res.mimeType || 'image/png');
                showStatus(`Image generated successfully using ${res.engine || 'AI'}!`, false);
            } else if (res.error) {
                throw new Error(typeof res.error === 'string' ? res.error : 'Generation failed');
            }
        } catch (err: any) {
            showStatus('Image generation error: ' + err.message, true);
            if (DOM.studioStatusTag) DOM.studioStatusTag.innerText = 'Error';
        } finally {
            setStudioLoading(false);
        }
    });

    // 📋 Paste Image from Clipboard Button
    DOM.studioPasteBtn?.addEventListener('click', async () => {
        try {
            const blob = await readImageBlobFromSystemClipboard();
            if (!blob) {
                showStatus('No image found on your clipboard. Copy an image first!', true);
                return;
            }
            await processAndRoutePastedImage(blob, 'studio');
        } catch (err: any) {
            console.warn('[Studio Paste] Clipboard API error, prompting user:', err);
            showStatus('Please press Ctrl+V / Cmd+V directly to paste from clipboard.', true);
        }
    });

    // Upload Source Image for Edit
    DOM.studioUploadSource?.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const matches = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
                if (matches) {
                    currentStudioSourceImage = { mimeType: matches[1], data: matches[2] };
                    renderStudioSourcePreview(dataUrl);
                    showStatus('Source image loaded into Image Studio editor!', false);
                }
            };
            reader.readAsDataURL(file);
        }
    });

    // Use Storyboard Current Shot Image as Source
    DOM.studioUseStoryboardSource?.addEventListener('click', () => {
        const allShots = getAllShotsFlat();
        if (allShots.length === 0) {
            showStatus('No storyboard shots available in current project.', true);
            return;
        }

        const selectedIdx = DOM.studioApplyShotSelect.value ? parseInt(DOM.studioApplyShotSelect.value, 10) : -1;
        let targetObj = (selectedIdx >= 0 && allShots[selectedIdx]) ? allShots[selectedIdx] : null;
        if (!targetObj || !targetObj.shot._imageObjectURL) {
            targetObj = allShots.find(s => s.shot._imageObjectURL) || allShots[0];
        }

        const imageUrl = targetObj?.shot._imageObjectURL;
        if (imageUrl) {
            const matches = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
            if (matches) {
                currentStudioSourceImage = { mimeType: matches[1], data: matches[2] };
                renderStudioSourcePreview(imageUrl);
                showStatus(`Loaded Shot image into Edit & Remix tab!`, false);
                switchTab('edit');
                return;
            } else if (imageUrl.startsWith('http') || imageUrl.startsWith('blob:')) {
                fetch(imageUrl)
                    .then(r => r.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const dataUrl = reader.result as string;
                            const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
                            if (m) {
                                currentStudioSourceImage = { mimeType: m[1], data: m[2] };
                                renderStudioSourcePreview(dataUrl);
                                showStatus(`Loaded Shot image into Edit & Remix tab!`, false);
                                switchTab('edit');
                            }
                        };
                        reader.readAsDataURL(blob);
                    })
                    .catch(e => showStatus('Could not load image data from shot.', true));
                return;
            }
        }
        showStatus('Selected shot does not have an image generated yet.', true);
    });

    // 🎨 Edit & Transform Image (Image-to-Image)
    DOM.studioEditBtn?.addEventListener('click', async () => {
        if (!currentStudioSourceImage) {
            showStatus('Please upload or select a source image to edit first.', true);
            return;
        }
        const instruction = DOM.studioEditInstruction.value.trim();
        if (!instruction) {
            showStatus('Please enter edit/transformation instructions.', true);
            return;
        }

        setStudioLoading(true, 'Editing image with AI...');
        try {
            const aspect = (DOM.studioAspectSelect.value || '16:9') as any;
            const model = DOM.studioModelSelect.value || 'gemini-3.1-flash-lite-image';

            const res = await editImageWithGemini(currentStudioSourceImage, instruction, aspect, model);
            if (res.base64) {
                setStudioResult(res.base64, res.mimeType || 'image/png');
                showStatus('Image edited successfully!', false);
            } else if (res.error) {
                throw new Error(typeof res.error === 'string' ? res.error : 'Edit failed');
            }
        } catch (err: any) {
            showStatus('Image edit error: ' + err.message, true);
            if (DOM.studioStatusTag) DOM.studioStatusTag.innerText = 'Error';
        } finally {
            setStudioLoading(false);
        }
    });

    // 🤡 AI Meme Captions
    DOM.studioMemeAutoCaption?.addEventListener('click', async () => {
        DOM.studioMemeAutoCaption.disabled = true;
        DOM.studioMemeAutoCaption.innerText = '🤡 Generating Captions...';
        try {
            const prompt = `Generate 1 funny meme top and bottom text overlay pair for video creation / AI content creator memes. Output in JSON format with keys "top" and "bottom". Example: {"top": "WHEN AI STUDIO GENERATES", "bottom": "UNLIMITED IMAGES FOR FREE"}`;
            const result = await generateContentWithFallback({ contents: prompt });
            let cleaned = (result.text || '').trim();
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) cleaned = jsonMatch[0];
            const parsed = JSON.parse(cleaned);
            if (parsed.top && parsed.bottom) {
                DOM.studioMemeTop.value = parsed.top;
                DOM.studioMemeBottom.value = parsed.bottom;
                showStatus('Generated funny meme captions!', false);
            }
        } catch (err: any) {
            showStatus('Failed to generate meme caption: ' + err.message, true);
        } finally {
            DOM.studioMemeAutoCaption.disabled = false;
            DOM.studioMemeAutoCaption.innerText = '🤡 AI Generate Funny Meme Captions';
        }
    });

    // Render Meme Image
    DOM.studioRenderMemeBtn?.addEventListener('click', async () => {
        const topText = DOM.studioMemeTop.value.trim();
        const bottomText = DOM.studioMemeBottom.value.trim();

        if (!currentStudioResultBase64 && !currentStudioSourceImage) {
            showStatus('Generating base meme background image first...', false);
            setStudioLoading(true, 'Generating base meme background...');
            try {
                const res = await generateImageWithFallback('A funny surprised cat looking at a laptop screen, vibrant meme format', '1:1', 'gemini-3.1-flash-lite-image');
                if (res.base64) {
                    currentStudioResultBase64 = res.base64;
                    currentStudioResultMime = res.mimeType || 'image/png';
                }
            } catch (err) {
                console.warn('Base image failed', err);
            } finally {
                setStudioLoading(false);
            }
        }

        const base64ToUse = currentStudioResultBase64 || currentStudioSourceImage?.data;
        if (!base64ToUse) {
            showStatus('Please generate or upload an image to create a meme on.', true);
            return;
        }

        renderMemeCanvas(`data:${currentStudioResultMime};base64,${base64ToUse}`, topText, bottomText);
    });

    // Action Bar Handlers
    DOM.studioActionDownload?.addEventListener('click', () => {
        if (!currentStudioResultBase64) {
            showStatus('No image generated yet to download.', true);
            return;
        }
        const link = document.createElement('a');
        link.download = `unlimited-gemini-image-${Date.now()}.png`;
        link.href = `data:${currentStudioResultMime};base64,${currentStudioResultBase64}`;
        link.click();
        showStatus('Download started!', false);
    });

    DOM.studioActionCopy?.addEventListener('click', async () => {
        if (!currentStudioResultBase64) {
            showStatus('No image generated yet to copy.', true);
            return;
        }
        try {
            const dataUrl = `data:${currentStudioResultMime};base64,${currentStudioResultBase64}`;
            await navigator.clipboard.writeText(dataUrl);
            showStatus('Image Data URL copied to clipboard!', false);
        } catch (err) {
            showStatus('Clipboard copy failed.', true);
        }
    });

    DOM.studioActionSendEdit?.addEventListener('click', () => {
        if (!currentStudioResultBase64) {
            showStatus('No image generated yet to send to editor.', true);
            return;
        }
        currentStudioSourceImage = { mimeType: currentStudioResultMime, data: currentStudioResultBase64 };
        renderStudioSourcePreview(`data:${currentStudioResultMime};base64,${currentStudioResultBase64}`);
        switchTab('edit');
        showStatus('Piped image into Edit & Remix tab!', false);
    });

    DOM.studioActionApplyShot?.addEventListener('click', async () => {
        if (!currentStudioResultBase64) {
            showStatus('Please generate or edit an image in Image Studio first.', true);
            return;
        }
        const shotIdxStr = DOM.studioApplyShotSelect.value;
        if (shotIdxStr === '') {
            showStatus('Please select a storyboard shot from the dropdown list.', true);
            return;
        }

        const allShots = getAllShotsFlat();
        const shotIdx = parseInt(shotIdxStr, 10);
        const targetObj = allShots[shotIdx];

        if (!targetObj || !targetObj.shot) {
            showStatus('Selected shot not found in active scenes.', true);
            return;
        }

        const dataUrl = `data:${currentStudioResultMime};base64,${currentStudioResultBase64}`;
        const shot = targetObj.shot;
        shot.image_engine = 'Gemini Unlimited';

        // Store in asset DB
        try {
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            safelyReplaceShotMedia(shot, blob, 'image');
            const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
            shot.image_id = assetId;
        } catch (err) {
            safelyReplaceShotMedia(shot, dataUrl, 'image');
            console.warn('Asset store warning:', err);
        }

        renderResults(state.currentScenes);
        renderVideoClips();
        saveVersion(false);
        showStatus(`Updated ${targetObj.label} with Unlimited Image Studio result!`, false);
    });
}

function switchTab(tab: 'gen' | 'edit' | 'meme' | 'c2pa') {
    if (DOM.studioPanelGen) DOM.studioPanelGen.classList.toggle('hidden', tab !== 'gen');
    if (DOM.studioPanelEdit) DOM.studioPanelEdit.classList.toggle('hidden', tab !== 'edit');
    if (DOM.studioPanelMeme) DOM.studioPanelMeme.classList.toggle('hidden', tab !== 'meme');
    if (DOM.studioPanelC2pa) DOM.studioPanelC2pa.classList.toggle('hidden', tab !== 'c2pa');

    const updateTabStyle = (btn: HTMLElement | null, active: boolean) => {
        if (!btn) return;
        if (active) {
            btn.className = 'px-4 py-2 text-emerald-400 border-b-2 border-emerald-500 transition-all flex items-center gap-1.5 cursor-pointer font-bold';
        } else {
            btn.className = 'px-4 py-2 text-gray-400 hover:text-gray-200 transition-all flex items-center gap-1.5 cursor-pointer font-semibold';
        }
    };

    updateTabStyle(DOM.studioTabGenBtn, tab === 'gen');
    updateTabStyle(DOM.studioTabEditBtn, tab === 'edit');
    updateTabStyle(DOM.studioTabMemeBtn, tab === 'meme');
    updateTabStyle(DOM.studioTabC2paBtn, tab === 'c2pa');
}

function setStudioLoading(loading: boolean, text: string = '') {
    if (DOM.studioLoader) DOM.studioLoader.classList.toggle('hidden', !loading);
    if (DOM.studioGenerateBtn) DOM.studioGenerateBtn.disabled = loading;
    if (DOM.studioEditBtn) DOM.studioEditBtn.disabled = loading;
    if (loading && DOM.studioStatusTag) {
        DOM.studioStatusTag.innerText = text || 'Generating...';
        DOM.studioStatusTag.className = 'text-[10px] text-yellow-400 font-mono animate-pulse';
    }
}

export function setStudioResult(base64: string, mimeType: string) {
    currentStudioResultBase64 = base64;
    currentStudioResultMime = mimeType;

    const dataUrl = `data:${mimeType};base64,${base64}`;
    if (DOM.studioResultImg) {
        DOM.studioResultImg.src = dataUrl;
        DOM.studioResultImg.classList.remove('hidden');
    }
    if (DOM.studioResultPlaceholder) DOM.studioResultPlaceholder.classList.add('hidden');
    if (DOM.studioActionBar) DOM.studioActionBar.classList.remove('hidden');
    if (DOM.studioStatusTag) {
        DOM.studioStatusTag.innerText = 'Complete';
        DOM.studioStatusTag.className = 'text-[10px] text-emerald-400 font-mono font-bold';
    }

    // Refresh shot selector when a new image is generated
    populateShotSelector();
}

function renderStudioSourcePreview(dataUrl: string) {
    if (DOM.studioSourcePreview) {
        DOM.studioSourcePreview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover rounded-lg" />`;
    }
}

export function populateShotSelector() {
    if (!DOM.studioApplyShotSelect) return;
    DOM.studioApplyShotSelect.innerHTML = '<option value="">Select Shot...</option>';

    const allShots = getAllShotsFlat();
    if (allShots.length > 0) {
        allShots.forEach((item, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = item.label;
            DOM.studioApplyShotSelect.appendChild(opt);
        });
    } else {
        const shotCards = document.querySelectorAll('.shot-card, [data-shot-index]');
        shotCards.forEach((card, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            opt.textContent = `Shot #${idx + 1}`;
            DOM.studioApplyShotSelect.appendChild(opt);
        });
    }
}

function renderMemeCanvas(imgSrc: string, topText: string, bottomText: string) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 1024;
        canvas.height = img.height || 1024;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const fontSize = Math.floor(canvas.height / 10);
        ctx.font = `900 ${fontSize}px Impact, sans-serif`;
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = Math.max(3, Math.floor(fontSize / 8));
        ctx.textAlign = 'center';

        if (topText) {
            ctx.textBaseline = 'top';
            const topY = Math.floor(canvas.height * 0.04);
            ctx.strokeText(topText.toUpperCase(), canvas.width / 2, topY);
            ctx.fillText(topText.toUpperCase(), canvas.width / 2, topY);
        }

        if (bottomText) {
            ctx.textBaseline = 'bottom';
            const bottomY = Math.floor(canvas.height * 0.96);
            ctx.strokeText(bottomText.toUpperCase(), canvas.width / 2, bottomY);
            ctx.fillText(bottomText.toUpperCase(), canvas.width / 2, bottomY);
        }

        const dataUrl = canvas.toDataURL('image/png');
        const matches = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (matches) {
            setStudioResult(matches[2], matches[1]);
            showStatus('Meme rendered successfully!', false);
        }
    };
    img.src = imgSrc;
}

