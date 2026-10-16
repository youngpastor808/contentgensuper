import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import * as constants from '../constants';
import { DB } from '../db';
import { assetStorage } from '../assetStorage';
import { saveVersion } from '../handlers-project';
import { openInspectorForShot, activeShotId } from '../handlers-inspector';
import { syncShotMediaToTimeline } from './timeline-sync';

/**
 * Convert a File or Blob to a pure base64 string (without data URL prefix).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = (reader.result as string) || '';
            const commaIdx = res.indexOf(',');
            resolve(commaIdx !== -1 ? res.slice(commaIdx + 1) : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Extracts an image Blob from a ClipboardEvent, or null if none found.
 */
export async function getImageBlobFromClipboardEvent(e: ClipboardEvent): Promise<Blob | null> {
    if (!e.clipboardData) return null;
    const items = e.clipboardData.items;
    
    if (items) {
        // 1. Try direct image data first
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const blob = items[i].getAsFile();
                if (blob) return blob;
            }
        }
        
        // 2. Try parsing text for URLs or HTML for image tags
        for (let i = 0; i < items.length; i++) {
            if (items[i].type === 'text/plain') {
                const text = await new Promise<string>((resolve) => items[i].getAsString(resolve));
                const trimmed = text.trim();
                if (trimmed.startsWith('data:image/')) {
                    try {
                        return await (await fetch(trimmed)).blob();
                    } catch(err) { console.warn('Failed to parse data URL:', err); }
                } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    try {
                        const res = await fetch(trimmed, { mode: 'cors' });
                        const blob = await res.blob();
                        if (blob.type.startsWith('image/')) return blob;
                    } catch(err) { console.warn('Failed to fetch image URL from clipboard:', err); }
                }
            } else if (items[i].type === 'text/html') {
                const html = await new Promise<string>((resolve) => items[i].getAsString(resolve));
                const match = html.match(/<img[^>]+src="?([^"\s>]+)"?\s*/i);
                if (match && match[1]) {
                    const url = match[1];
                    try {
                        const res = await fetch(url, { mode: 'cors' });
                        const blob = await res.blob();
                        if (blob.type.startsWith('image/')) return blob;
                    } catch(err) { console.warn('Failed to fetch image from HTML img tag in clipboard:', err); }
                }
            }
        }
    }

    const files = e.clipboardData.files;
    if (files) {
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) {
                return files[i];
            }
        }
    }
    return null;
}

/**
 * Reads an image Blob directly using navigator.clipboard.read() or readText().
 */
export async function readImageBlobFromSystemClipboard(): Promise<Blob | null> {
    if (!navigator.clipboard) {
        throw new Error('Clipboard API is not supported in this browser or environment.');
    }

    // 1. Try native clipboard read (for direct image data)
    if (navigator.clipboard.read) {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        return await item.getType(type);
                    }
                }
            }
        } catch (err) {
            console.warn("navigator.clipboard.read() failed or blocked, trying readText() fallback.", err);
        }
    }

    // 2. Try text read for image URLs
    if (navigator.clipboard.readText) {
        try {
            const text = await navigator.clipboard.readText();
            const trimmed = text.trim();
            if (trimmed.startsWith('data:image/')) {
                return await (await fetch(trimmed)).blob();
            } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                const res = await fetch(trimmed, { mode: 'cors' });
                const blob = await res.blob();
                if (blob.type.startsWith('image/')) return blob;
            }
        } catch (err) {
            console.warn("navigator.clipboard.readText() failed.", err);
        }
    }

    return null;
}

/**
 * Processes an image Blob and contextually routes it:
 * 1. Specific target context ('studio', 'library', 'inspector', or 'auto')
 * 2. If 'auto':
 *    - If Reference Library modal is open -> adds to Reference Library
 *    - If Image Studio drawer is open -> loads into Image Studio Canvas
 *    - If Shot Inspector drawer is open -> assigns to currently active shot
 *    - If a storyboard card is selected/hovered -> assigns to that shot
 *    - Else -> assigns to next empty shot (or first shot) and saves to asset storage
 */
export async function processAndRoutePastedImage(
    blob: Blob,
    explicitTarget: 'auto' | 'studio' | 'library' | 'inspector' = 'auto'
): Promise<boolean> {
    try {
        const mimeType = blob.type || 'image/png';
        const base64 = await blobToBase64(blob);
        if (!base64) {
            ui.showStatus('Failed to read image data from clipboard.', true);
            return false;
        }

        const isRefModalOpen = dom.referenceLibraryModal && !dom.referenceLibraryModal.classList.contains('hidden');
        const isStudioOpen = dom.imageStudioModal && !dom.imageStudioModal.classList.contains('hidden');
        const isInspectorOpen = dom.shotInspectorDrawer && !dom.shotInspectorDrawer.classList.contains('hidden') && !dom.shotInspectorDrawer.classList.contains('translate-x-full');

        // Target: Reference Library
        if (explicitTarget === 'library' || (explicitTarget === 'auto' && isRefModalOpen)) {
            const name = `Pasted Reference ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
            const newRefImage = {
                id: Date.now(),
                name,
                data: base64,
                mimeType,
                dateAdded: Date.now()
            };
            await DB.put(constants.REFERENCE_IMAGE_STORE, newRefImage);
            ui.renderReferenceLibrary();
            ui.showStatus('Image pasted and added to Reference Library!', false, 2500);
            return true;
        }

        // Target: Image Studio
        if (explicitTarget === 'studio' || (explicitTarget === 'auto' && isStudioOpen)) {
            const { setStudioResult } = await import('../image-studio');
            setStudioResult(base64, mimeType);
            // Also store in asset storage so it persists and is ready for export
            try {
                await assetStorage.storeAsset(blob, 'image');
            } catch (err) {
                console.warn('[Paste] Failed to cache studio image in assetStorage:', err);
            }
            ui.showStatus('Image pasted into Image Studio canvas!', false, 2500);
            return true;
        }

        // Target: Shot Inspector or Active Shot
        let targetShot: any = null;
        const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);

        if (explicitTarget === 'inspector' || (explicitTarget === 'auto' && isInspectorOpen)) {
            if (activeShotId) {
                targetShot = allShots.find((s: any) => s.id === activeShotId);
            }
        }

        // Check if mouse or focus is currently over a specific storyboard card
        if (!targetShot && allShots.length > 0) {
            const hoveredCard = document.querySelector('.prompt-item:hover') as HTMLElement | null;
            if (hoveredCard) {
                const sIdx = parseInt(hoveredCard.dataset.sceneIndex || '-1', 10);
                const lIdx = parseInt(hoveredCard.dataset.lineIndex || '-1', 10);
                const cardId = hoveredCard.dataset.id;
                if (cardId) {
                    targetShot = allShots.find((s: any) => s.id === cardId);
                } else if (sIdx !== -1 && lIdx !== -1) {
                    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
                    targetShot = isPaced ? state.currentScenes[lIdx] : state.currentScenes[sIdx]?.lines[lIdx];
                }
            }
        }

        // Target: Storyboard context
        if (!targetShot && allShots.length > 0) {
            // Prefer currently active shot, otherwise shot without image, otherwise first shot
            if (activeShotId) {
                targetShot = allShots.find((s: any) => s.id === activeShotId);
            }
            if (!targetShot) {
                targetShot = allShots.find((s: any) => !s.image_id && !s.image_url) || allShots[0];
            }
        }

        if (targetShot) {
            const assetId = await assetStorage.storeAsset(blob, 'image');
            targetShot.image_id = assetId;
            targetShot.image_url = undefined; // clear stale remote URLs
            await syncShotMediaToTimeline(targetShot);

            saveVersion(false);
            ui.updateStoryboardStats();
            ui.renderResults(state.currentScenes);

            if (isInspectorOpen && activeShotId === targetShot.id) {
                openInspectorForShot(targetShot.id);
            }

            const shotLabel = targetShot.shot_number ? `#${targetShot.shot_number}` : (targetShot.id || 'current shot');
            ui.showStatus(`Image pasted and assigned to Shot ${shotLabel}!`, false, 3000);
            return true;
        }

        // Fallback: Store into asset library / reference images if no shots exist
        const fallbackName = `Pasted Asset ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        const fallbackItem = {
            id: Date.now(),
            name: fallbackName,
            data: base64,
            mimeType,
            dateAdded: Date.now()
        };
        await DB.put(constants.REFERENCE_IMAGE_STORE, fallbackItem);
        ui.renderReferenceLibrary();
        ui.showStatus('Image pasted and saved to Reference Library!', false, 3000);
        return true;
    } catch (err: any) {
        console.error('[Paste] Error processing pasted image:', err);
        ui.showStatus(`Failed to process pasted image: ${err.message || err}`, true);
        return false;
    }
}
