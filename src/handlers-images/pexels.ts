import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import * as constants from '../constants';
import * as utils from '../utils';
import { assetStorage } from '../assetStorage';
import { saveVersion, syncStateFromDOM } from '../handlers-project';
import { generateContentWithFallback } from '../api/core';
import { syncShotMediaToTimeline } from './timeline-sync';
import { videoRenderContext, drawVideoFrame } from '../videoRenderer';
import { safelyReplaceShotMedia } from '../memoryManager';

export const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren', 'as', 'at', 
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cant', 'cannot', 
    'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 
    'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 
    'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 
    'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 
    'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 
    'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 
    'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 
    'yourself', 'yourselves', 'said', 'says', 'like', 'one', 'two', 'also', 'will', 'scene', 'shot', 'view', 'camera',
    'close', 'wide', 'angle', 'pan', 'zoom',
    // Meta-words that cause Pexels to return financial stock trading / bar charts instead of b-roll:
    'stock', 'stocks', 'footage', 'video', 'videos', 'photo', 'photos', 'image', 'images', 'picture', 'pictures',
    'clip', 'clips', 'broll', 'b-roll', 'pexels', 'media', 'free', 'fetch', 'get', 'download', 'hd', '4k'
]);

export function sanitizePexelsQuery(query: string): string {
    if (!query) return '';
    return query
        .toLowerCase()
        .replace(/\b(stock|stocks|footage|broll|b-roll|video|videos|photo|photos|image|images|clip|clips|pexels|media|free)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function extractFilteredKeywords(text: string): string {
    if (!text) return '';
    const clean = text.replace(/<[^>]+>/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase();
    const words = clean.split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    const unique = Array.from(new Set(words));
    const result = unique.slice(0, 4).join(' ');
    return sanitizePexelsQuery(result);
}

export async function getAIVisualKeywords(shot: any, scene?: any): Promise<string> {
    const narration = (shot.line_text || shot.text_reference || '').replace(/<[^>]+>/g, ' ').trim();
    const imagePrompt = (shot.image_prompt || '').replace(/<[^>]+>/g, ' ').trim();
    if (!narration && !imagePrompt) return '';

    try {
        let storySummary = '';
        if (dom.sparkTopicInput && dom.sparkTopicInput.value.trim()) {
            storySummary += `Story Topic/Theme: ${dom.sparkTopicInput.value.trim()}\n`;
        }
        if (scene && (scene.header || scene.location || scene.title)) {
            storySummary += `Current Scene Setting: ${scene.header || scene.location || scene.title}\n`;
        }
        
        if (state.currentScenes && state.currentScenes.length > 0) {
            const allTexts = state.currentScenes
                .flatMap((s: any) => (s.lines || [s]))
                .map((s: any) => (s.line_text || s.text_reference || '').trim())
                .filter(Boolean);
            if (allTexts.length > 0) {
                const combined = allTexts.join(' ');
                storySummary += `Full Story Context: "${combined.length > 400 ? combined.substring(0, 400) + '...' : combined}"\n`;
            }
        }

        const prompt = `You are a professional stock media director. Your task is to extract 2 to 4 optimal search keywords for Pexels stock media (photos or video clips) for a specific shot in a story.

OVERALL STORY CONTEXT:
${storySummary}

CURRENT SHOT DETAILS:
- Narration/Dialogue: "${narration}"
${imagePrompt ? `- Visual Idea: "${imagePrompt}"` : ''}

INSTRUCTIONS FOR PEXELS KEYWORDS:
1. Translate character proper names (e.g. "Lira", "John") into visual general terms (e.g. "young girl", "man").
2. Translate abstract dialogue or thoughts into visible subjects, people, objects, actions, or environments (e.g. "clay pot", "crowd talking street", "sparkling diamond").
3. Use simple, high-frequency visual keywords that describe the concrete scene.
4. CRITICAL: NEVER output meta-words like "stock", "footage", "video", "photo", "b-roll", "clip", or "pexels" (searching the word "stock" causes Pexels to return stock market/trading charts). Output concrete visible nouns and actions ONLY (e.g. "coffee shop barista", "man driving car", "sunset mountains").
5. Output 2 to 4 space-separated English search terms ONLY, with no punctuation or commentary.

Visual Search Terms:`;

        const response = await generateContentWithFallback({
            contents: prompt,
            model: constants.SECONDARY_MODEL,
            maxOutputTokens: 25
        });

        const text = (response.text || '').trim().replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
        return sanitizePexelsQuery(words.slice(0, 4).join(' '));
    } catch (err) {
        console.warn('AI visual keyword extraction failed, using fallback strategy:', err);
        return '';
    }
}

export function getSceneOrProjectTopic(shot: any, scene: any): string {
    let candidates: string[] = [];

    if (scene) {
        if (scene.header) candidates.push(scene.header);
        if (scene.location) candidates.push(scene.location);
        if (scene.title) candidates.push(scene.title);
        if (scene.topic) candidates.push(scene.topic);
    }

    if (dom.sparkTopicInput && dom.sparkTopicInput.value.trim()) {
        candidates.push(dom.sparkTopicInput.value.trim());
    }

    if (state.currentScenes && state.currentScenes.length > 0) {
        const firstShot = state.currentScenes[0];
        const text = firstShot.line_text || firstShot.text_reference || '';
        if (text) candidates.push(text);
    }

    for (const raw of candidates) {
        const keywords = extractFilteredKeywords(raw);
        if (keywords) return keywords;
    }

    return 'cinematic background';
}

export function getPexelsOrientation(aspectRatio?: string): 'landscape' | 'portrait' | 'square' {
    const ar = aspectRatio || dom.imageResolutionSelect?.value || '16:9';
    if (ar === '9:16' || ar === '3:4') return 'portrait';
    if (ar === '1:1') return 'square';
    if (ar === '16:9' || ar === '4:3') return 'landscape';

    if (ar.includes(':')) {
        const [w, h] = ar.split(':').map(Number);
        if (w && h) {
            if (h > w) return 'portrait';
            if (w > h) return 'landscape';
            return 'square';
        }
    }
    return 'landscape';
}

export function selectBestVideoFile(videoFiles: any[], orientation: 'landscape' | 'portrait' | 'square'): any {
    if (!videoFiles || videoFiles.length === 0) return null;

    let filtered = videoFiles;
    if (orientation === 'portrait') {
        const matches = videoFiles.filter((f: any) => f.height > f.width);
        if (matches.length > 0) filtered = matches;
    } else if (orientation === 'landscape') {
        const matches = videoFiles.filter((f: any) => f.width > f.height);
        if (matches.length > 0) filtered = matches;
    } else if (orientation === 'square') {
        const matches = videoFiles.filter((f: any) => Math.abs(f.width - f.height) < 150);
        if (matches.length > 0) filtered = matches;
    }

    const hdMatch = filtered.find((f: any) => f.quality === 'hd' && (f.width >= 1280 || f.height >= 1280));
    if (hdMatch) return hdMatch;

    const anyHd = filtered.find((f: any) => f.quality === 'hd');
    if (anyHd) return anyHd;

    return filtered[0] || videoFiles[0];
}

export async function fetchPexelsStockMedia(
    mediaType: 'photos' | 'videos',
    shot: any,
    scene: any,
    apiKey: string,
    onStatusUpdate?: (status: string) => void
): Promise<{ items: any[]; tierUsed: number; queryUsed: string; orientationUsed: 'landscape' | 'portrait' | 'square' }> {
    const orientation = getPexelsOrientation(shot.aspectRatio || dom.imageResolutionSelect?.value);

    const endpoint = mediaType === 'photos'
        ? 'https://api.pexels.com/v1/search'
        : 'https://api.pexels.com/v1/videos/search';

    const searchApi = async (query: string, withOrientation: boolean = true) => {
        if (!query.trim()) return [];
        let url = `${endpoint}?query=${encodeURIComponent(query)}&per_page=15`;
        if (withOrientation && orientation) {
            url += `&orientation=${orientation}`;
        }
        const response = await fetch(url, {
            headers: { 'Authorization': apiKey }
        });
        if (!response.ok) {
            throw new Error(`Pexels API error: ${response.statusText}`);
        }
        const data = await response.json();
        return (mediaType === 'photos' ? data.photos : data.videos) || [];
    };

    const tryQueryWithFallback = async (rawQuery: string) => {
        let query = sanitizePexelsQuery(rawQuery);
        if (!query) {
            query = sanitizePexelsQuery(getSceneOrProjectTopic(shot, scene)) || 'scenic atmosphere';
        }
        console.log(`[Pexels Cascade] Query "${query}" (from "${rawQuery}") with orientation=${orientation}`);
        let results = await searchApi(query, true);
        if (results && results.length > 0) return results;

        console.log(`[Pexels Cascade] 0 results for orientation=${orientation}. Fallback unconstrained query "${query}"...`);
        results = await searchApi(query, false);
        return results || [];
    };

    // Tier 1: Try AI visual keywords (if Gemini is available)
    onStatusUpdate?.(`Searching Pexels [${orientation}] (Tier 1: AI visual keywords)...`);
    try {
        const tier1Query = await getAIVisualKeywords(shot, scene);
        if (tier1Query) {
            const results = await tryQueryWithFallback(tier1Query);
            if (results && results.length > 0) {
                return { items: results, tierUsed: 1, queryUsed: tier1Query, orientationUsed: orientation };
            }
        }
    } catch (e) {
        console.warn('[Pexels Cascade] Tier 1 error:', e);
    }

    // Tier 2: Fall back to filtered nouns/adjectives
    onStatusUpdate?.(`Searching Pexels [${orientation}] (Tier 2: Filtered sentence keywords)...`);
    try {
        const sentenceText = shot.line_text || shot.text_reference || shot.image_prompt || '';
        const tier2Query = extractFilteredKeywords(sentenceText);
        if (tier2Query) {
            const results = await tryQueryWithFallback(tier2Query);
            if (results && results.length > 0) {
                return { items: results, tierUsed: 2, queryUsed: tier2Query, orientationUsed: orientation };
            }
        }
    } catch (e) {
        console.warn('[Pexels Cascade] Tier 2 error:', e);
    }

    // Tier 3: Fall back to main topic tag of the scene/project
    onStatusUpdate?.(`Searching Pexels [${orientation}] (Tier 3: Main topic tag)...`);
    try {
        const tier3Query = getSceneOrProjectTopic(shot, scene);
        const results = await tryQueryWithFallback(tier3Query);
        if (results && results.length > 0) {
            return { items: results, tierUsed: 3, queryUsed: tier3Query, orientationUsed: orientation };
        }
    } catch (e) {
        console.warn('[Pexels Cascade] Tier 3 error:', e);
    }

    return { items: [], tierUsed: 0, queryUsed: '', orientationUsed: orientation };
}

export async function handlePexelsImageBtnClick(event: Event) {
    const target = event.target as HTMLElement;
    const pexelsBtn = target.closest('.pexels-image-btn') as HTMLButtonElement;
    if (!pexelsBtn) return;
    
    if (!state.pexelsApiKey) {
        ui.showStatus('Pexels API key is required to fetch stock media. Redirecting to Settings...', true, 4000);
        const settingsTab = document.querySelector('[data-tab="panel-settings"]') as HTMLElement;
        if (settingsTab) settingsTab.click();
        if (dom.pexelsApiKeyInput) dom.pexelsApiKeyInput.focus();
        return;
    }
    
    const shotEl = pexelsBtn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    
    const sceneIndex = parseInt(shotEl.dataset.sceneIndex || '0', 10);
    const lineIndex = parseInt(shotEl.dataset.lineIndex || '0', 10);
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const scene = state.currentScenes[sceneIndex];
    const lines = scene?.lines || [scene];
    const shot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];
    if (!shot) return;
    
    const originalText = pexelsBtn.innerHTML;
    pexelsBtn.innerHTML = '⏳...';
    pexelsBtn.disabled = true;
    
    try {
        const { items, tierUsed, queryUsed, orientationUsed } = await fetchPexelsStockMedia(
            'photos',
            shot,
            scene,
            state.pexelsApiKey,
            (statusMsg) => ui.showStatus(statusMsg, false, 1500)
        );

        if (items && items.length > 0) {
            const randomIndex = Math.floor(Math.random() * items.length);
            const photo = items[randomIndex];
            const imageUrl = photo.src.large2x || photo.src.original || photo.src.large;
            
            if (imageUrl) {
                ui.showStatus(`Fetching image [${orientationUsed}] (Tier ${tierUsed}: "${queryUsed}")...`, false, 2000);
                
                const imgRes = await fetch(imageUrl);
                const imgBlob = await imgRes.blob();
                
                const assetId = await assetStorage.storeAsset(imgBlob, 'image', 'current_project');
                safelyReplaceShotMedia(shot, imgBlob, 'image');
                shot.image_id = assetId;
                shot.imageMimeType = imgBlob.type;
                
                const imgContainer = shotEl.querySelector('.img-container');
                if (imgContainer) {
                    imgContainer.innerHTML = `<img src="${shot._imageObjectURL}" class="w-full h-full object-cover rounded-lg generated-img" data-id="${shot.id}">`;
                }
                
                saveVersion(false);
                await syncShotMediaToTimeline(shot);
                if (dom.videoDirectorBtn && dom.videoDirectorBtn.disabled) {
                    dom.videoDirectorBtn.disabled = false;
                    dom.videoDirectorBtn.classList.remove('opacity-50');
                    ui.updateWorkflowStepStatus(3, 'completed');
                    ui.updateWorkflowStepStatus(4, 'active');
                }
                ui.showStatus(`Pexels image applied [${orientationUsed}] (Tier ${tierUsed}: "${queryUsed}")`, false, 3000);
            } else {
                ui.showStatus('No suitable image file found on Pexels.', true);
            }
        } else {
            ui.showStatus('No stock images found on Pexels after 3-tier cascade search.', true);
        }
    } catch (error: any) {
        console.error('Pexels error:', error);
        ui.showStatus(error.message || 'Failed to fetch from Pexels', true);
    } finally {
        pexelsBtn.innerHTML = originalText;
        pexelsBtn.disabled = false;
    }
}

export async function handlePexelsVideoBtnClick(event: Event) {
    const target = event.target as HTMLElement;
    const pexelsBtn = target.closest('.pexels-video-btn') as HTMLButtonElement;
    if (!pexelsBtn) return;
    
    if (!state.pexelsApiKey) {
        ui.showStatus('Pexels API key is required to fetch stock media. Redirecting to Settings...', true, 4000);
        const settingsTab = document.querySelector('[data-tab="panel-settings"]') as HTMLElement;
        if (settingsTab) settingsTab.click();
        if (dom.pexelsApiKeyInput) dom.pexelsApiKeyInput.focus();
        return;
    }
    
    const shotEl = pexelsBtn.closest('.prompt-item') as HTMLElement;
    if (!shotEl) return;
    
    const sceneIndex = parseInt(shotEl.dataset.sceneIndex || '0', 10);
    const lineIndex = parseInt(shotEl.dataset.lineIndex || '0', 10);
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const scene = state.currentScenes[sceneIndex];
    const lines = scene?.lines || [scene];
    const shot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];
    if (!shot) return;
    
    const originalText = pexelsBtn.innerHTML;
    pexelsBtn.innerHTML = '⏳...';
    pexelsBtn.disabled = true;
    
    try {
        const { items, tierUsed, queryUsed, orientationUsed } = await fetchPexelsStockMedia(
            'videos',
            shot,
            scene,
            state.pexelsApiKey,
            (statusMsg) => ui.showStatus(statusMsg, false, 1500)
        );

        if (items && items.length > 0) {
            const randomIndex = Math.floor(Math.random() * items.length);
            const video = items[randomIndex];
            const videoFile = selectBestVideoFile(video.video_files, orientationUsed);
            
            if (videoFile && videoFile.link) {
                ui.showStatus(`Fetching video [${orientationUsed}] (Tier ${tierUsed}: "${queryUsed}")...`, false, 2000);
                
                const vidRes = await fetch(videoFile.link);
                const vidBlob = await vidRes.blob();
                
                const assetId = await assetStorage.storeAsset(vidBlob, 'video', 'current_project');
                safelyReplaceShotMedia(shot, vidBlob, 'video');
                shot.video_id = assetId;
                
                const imgContainer = shotEl.querySelector('.img-container');
                if (imgContainer) {
                    imgContainer.innerHTML = `<video src="${shot._videoObjectURL}" class="w-full h-full object-cover rounded-lg generated-video" autoplay loop muted playsinline data-id="${shot.id}"></video>`;
                }
                
                saveVersion(false);
                await syncShotMediaToTimeline(shot);
                if (dom.videoDirectorBtn && dom.videoDirectorBtn.disabled) {
                    dom.videoDirectorBtn.disabled = false;
                    dom.videoDirectorBtn.classList.remove('opacity-50');
                    ui.updateWorkflowStepStatus(3, 'completed');
                    ui.updateWorkflowStepStatus(4, 'active');
                }
                ui.showStatus(`Pexels video applied [${orientationUsed}] (Tier ${tierUsed}: "${queryUsed}")`, false, 3000);
            } else {
                ui.showStatus('No suitable video file found from Pexels.', true);
            }
        } else {
            ui.showStatus('No stock videos found on Pexels after 3-tier cascade search.', true);
        }
    } catch (error: any) {
        console.error('Pexels API Error:', error);
        ui.showStatus(error.message || 'Failed to fetch from Pexels', true);
    } finally {
        pexelsBtn.innerHTML = originalText;
        pexelsBtn.disabled = false;
    }
}

export async function handleBulkStockFetch() {
    if (!state.pexelsApiKey) {
        ui.showStatus('Pexels API key is required to fetch stock media. Redirecting to Settings...', true, 4000);
        const settingsTab = document.querySelector('[data-tab="panel-settings"]') as HTMLElement;
        if (settingsTab) settingsTab.click();
        if (dom.pexelsApiKeyInput) dom.pexelsApiKeyInput.focus();
        return;
    }

    syncStateFromDOM();

    if (!state.currentScenes || state.currentScenes.length === 0) {
        ui.showStatus('No storyboard shots found.', true);
        return;
    }

    const mode = (dom.bulkStockSelect ? dom.bulkStockSelect.value : 'videos') as 'videos' | 'photos' | 'mixed' | 'videos-missing' | 'photos-missing' | 'mixed-missing';
    const isVideo = mode.startsWith('videos');
    const isMixed = mode.startsWith('mixed');
    const isMissingOnly = mode.endsWith('-missing');
    const displayMediaType = isMixed ? 'mixed media' : (isVideo ? 'videos' : 'photos');

    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const shotList: Array<{ shot: any; scene: any; sceneIndex: number; lineIndex: number; shotEl: HTMLElement | null }> = [];

    if (isPaced) {
        state.currentScenes.forEach((shot, i) => {
            const shotEl = dom.resultsContainer?.querySelector(`.prompt-item[data-line-index="${i}"]`) as HTMLElement;
            shotList.push({ shot, scene: state.currentScenes[0], sceneIndex: 0, lineIndex: i, shotEl });
        });
    } else {
        state.currentScenes.forEach((scene, sIdx) => {
            const lines = scene.lines || [scene];
            lines.forEach((shot: any, lIdx: number) => {
                const shotEl = dom.resultsContainer?.querySelector(`.prompt-item[data-scene-index="${sIdx}"][data-line-index="${lIdx}"]`) as HTMLElement;
                shotList.push({ shot, scene, sceneIndex: sIdx, lineIndex: lIdx, shotEl });
            });
        });
    }

    const eligibleShots = shotList.filter(({ shot }) => {
        if (!isMissingOnly) return true;
        if (isVideo) {
            return !shot._videoObjectURL && !shot.video_id;
        } else if (isMixed) {
            return !shot._imageObjectURL && !shot._videoObjectURL && !shot.image_id && !shot.video_id;
        } else {
            return !shot._imageObjectURL && !shot._videoObjectURL && !shot.image_id && !shot.video_id;
        }
    });

    if (eligibleShots.length === 0) {
        ui.showStatus('No matching shots found to populate stock media.', false, 4000);
        return;
    }

    state.isBulkGenerating = true;
    if (dom.bulkStockBtn) dom.bulkStockBtn.disabled = true;
    if (dom.bulkGenerateBtn) dom.bulkGenerateBtn.classList.add('hidden');
    if (dom.stopBulkGenerateBtn) dom.stopBulkGenerateBtn.classList.remove('hidden');
    if (dom.progressBarContainer) dom.progressBarContainer.classList.remove('hidden');

    const total = eligibleShots.length;
    let successCount = 0;
    let failCount = 0;

    ui.showStatus(`Starting bulk stock ${displayMediaType} fetch for ${total} shots...`);

    for (let i = 0; i < total; i++) {
        if (!state.isBulkGenerating) {
            console.log('[Bulk Stock] Stopped by user.');
            break;
        }

        const { shot, scene, shotEl } = eligibleShots[i];
        const shotNumber = shot.shot_number || (i + 1);
        
        // Determine media type for this specific shot
        let currentMediaType: 'photos' | 'videos';
        if (isMixed) {
            currentMediaType = (i % 2 === 0) ? 'videos' : 'photos';
        } else {
            currentMediaType = isVideo ? 'videos' : 'photos';
        }

        utils.updateProgressBar(i, total);
        ui.showStatus(`Fetching stock ${currentMediaType} for Shot ${shotNumber} (${i + 1}/${total})...`, false);

        try {
            const { items, tierUsed, queryUsed, orientationUsed } = await fetchPexelsStockMedia(
                currentMediaType,
                shot,
                scene,
                state.pexelsApiKey,
                (statusMsg) => ui.showStatus(`Shot ${shotNumber}: ${statusMsg}`, false, 1500)
            );

            if (items && items.length > 0) {
                const randomIndex = Math.floor(Math.random() * items.length);
                const mediaItem = items[randomIndex];

                if (currentMediaType === 'videos') {
                    const videoFile = selectBestVideoFile(mediaItem.video_files, orientationUsed);
                    if (videoFile && videoFile.link) {
                        const res = await fetch(videoFile.link);
                        const blob = await res.blob();
                        const assetId = await assetStorage.storeAsset(blob, 'video', 'current_project');
                        shot.video_id = assetId;
                        shot._videoObjectURL = URL.createObjectURL(blob);

                        if (shotEl) {
                            const imgContainer = shotEl.querySelector('.img-container');
                            if (imgContainer) {
                                imgContainer.innerHTML = `<video src="${shot._videoObjectURL}" class="w-full h-full object-cover rounded-lg generated-video" autoplay loop muted playsinline data-id="${shot.id}"></video>`;
                            }
                        }
                        successCount++;
                    } else {
                        failCount++;
                    }
                } else {
                    const imageUrl = mediaItem.src?.large2x || mediaItem.src?.original || mediaItem.src?.large;
                    if (imageUrl) {
                        const res = await fetch(imageUrl);
                        const blob = await res.blob();
                        const assetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
                        shot.image_id = assetId;
                        shot.imageMimeType = blob.type;
                        shot._imageObjectURL = URL.createObjectURL(blob);

                        if (shotEl) {
                            const imgContainer = shotEl.querySelector('.img-container');
                            if (imgContainer) {
                                imgContainer.innerHTML = `<img src="${shot._imageObjectURL}" class="w-full h-full object-cover rounded-lg generated-img" data-id="${shot.id}">`;
                            }
                        }
                        successCount++;
                    } else {
                        failCount++;
                    }
                }

                await syncShotMediaToTimeline(shot);
            } else {
                failCount++;
            }
        } catch (err) {
            console.error(`[Bulk Stock] Error on shot ${shotNumber}:`, err);
            failCount++;
        }
    }

    saveVersion(false);
    state.isBulkGenerating = false;
    if (dom.bulkStockBtn) dom.bulkStockBtn.disabled = !dom.enableBulkGenerationCheckbox?.checked;
    if (dom.bulkGenerateBtn) dom.bulkGenerateBtn.classList.remove('hidden');
    if (dom.stopBulkGenerateBtn) dom.stopBulkGenerateBtn.classList.add('hidden');
    if (dom.progressBarContainer) dom.progressBarContainer.classList.add('hidden');

    if (!state.isVideoPlaying && videoRenderContext) drawVideoFrame(state.videoPauseTime || 0);

    ui.showStatus(`Stock media complete: ${successCount} updated${failCount > 0 ? `, ${failCount} failed/skipped` : ''}.`, false, 5000);
    if (successCount > 0 && dom.videoDirectorBtn && dom.videoDirectorBtn.disabled) {
        dom.videoDirectorBtn.disabled = false;
        dom.videoDirectorBtn.classList.remove('opacity-50');
        ui.updateWorkflowStepStatus(3, 'completed');
        ui.updateWorkflowStepStatus(4, 'active');
    }

    try {
        ui.renderResults(state.currentScenes);
        ui.renderTimelineEditor();
    } catch (e) {
        console.error('Failed to re-render results or timeline editor after batch image generation:', e);
    }
}
