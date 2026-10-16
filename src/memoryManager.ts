/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from './state';
import { timelineState } from './state-timeline';
import { dropDepth } from './parallax/depth';
import { acquireUrl, releaseUrl } from './mediaUrlRegistry';

export function optimizeMemoryForVideoDirector() {
    console.log('[Memory Manager] Freeing Storyboard VRAM for Video Director...');

    // 1. Force the DOM to drop heavy GPU textures from the Storyboard view
    const storyboardContainer = document.getElementById('storyboard-container') || document.getElementById('panel-storyboard');
    if (storyboardContainer) {
        const mediaElements = storyboardContainer.querySelectorAll('img, video');
        mediaElements.forEach((el) => {
            if (el instanceof HTMLImageElement) {
                if (el.src && !el.dataset.restoresrc) {
                    el.dataset.restoresrc = el.src;
                }
                el.src = ''; // Drops the decoded bitmap from VRAM
            } else if (el instanceof HTMLVideoElement) {
                if (el.src && !el.dataset.restoresrc) {
                    el.dataset.restoresrc = el.src;
                }
                el.pause();
                el.removeAttribute('src');
                el.load(); // Forces the browser video decoder to release memory
            }
        });
    }

    // 2. Map exactly what the Video Director is currently using
    const activeUrls = new Set<string>();
    if (timelineState.clips) {
        for (const clip of timelineState.clips) {
            if (clip._imageObjectURL) activeUrls.add(clip._imageObjectURL);
            if (clip._secondaryImageObjectURL) activeUrls.add(clip._secondaryImageObjectURL);
            if (clip._videoObjectURL) activeUrls.add(clip._videoObjectURL);
            if (clip._secondaryVideoObjectURL) activeUrls.add(clip._secondaryVideoObjectURL);
            if (clip.image && typeof (clip.image as any).src === 'string') {
                activeUrls.add((clip.image as any).src);
            }
        }
    }

    // 3. Purge orphaned Blob URLs and heavy Depth Maps from the Storyboard state
    // CRITICAL SAFETY: Only revoke Blob URLs if the shot has a persistent asset ID in assetStorage.
    // Otherwise, revoking the URL permanently destroys user media, causing net::ERR_FILE_NOT_FOUND.
    if (state.currentScenes) {
        state.currentScenes.forEach((scene: any) => {
            const shots = scene.lines || [scene];
            shots.forEach((shot: any) => {
                
                // Clear Primary Image & Depth Map
                if (shot._imageObjectURL && !activeUrls.has(shot._imageObjectURL)) {
                    dropDepth(shot._imageObjectURL); // Drops the ~1MB+ procedural depth array
                    if (shot.image) dropDepth(shot.image);
                    if (shot.image_id) {
                        releaseUrl(shot._imageObjectURL, shot.id || shot.image_id);
                        shot._imageObjectURL = undefined; 
                        shot.image = undefined; 
                    }
                }

                // Clear Primary Video
                if (shot._videoObjectURL && !activeUrls.has(shot._videoObjectURL)) {
                    if (shot.video_id) {
                        releaseUrl(shot._videoObjectURL, shot.id || shot.video_id);
                        shot._videoObjectURL = undefined;
                    }
                }

                // Clear Secondary Image
                if (shot._secondaryImageObjectURL && !activeUrls.has(shot._secondaryImageObjectURL)) {
                    dropDepth(shot._secondaryImageObjectURL);
                    if (shot.secondary_image_id) {
                        releaseUrl(shot._secondaryImageObjectURL, shot.id || shot.secondary_image_id);
                        shot._secondaryImageObjectURL = undefined;
                    }
                }

                // Clear Secondary Video
                if (shot._secondaryVideoObjectURL && !activeUrls.has(shot._secondaryVideoObjectURL)) {
                    if (shot.secondary_video_id) {
                        releaseUrl(shot._secondaryVideoObjectURL, shot.id || shot.secondary_video_id);
                        shot._secondaryVideoObjectURL = undefined;
                    }
                }
            });
        });
    }
    
    console.log('[Memory Manager] Storyboard VRAM successfully purged.');
}

/**
 * Restores Storyboard media elements and state when exiting Video Director.
 */
export async function restoreStoryboardFromVideoDirector() {
    console.log('[Memory Manager] Restoring Storyboard media from Video Director...');

    const storyboardContainer = document.getElementById('storyboard-container') || document.getElementById('panel-storyboard');
    if (!storyboardContainer) return;

    // 1. Gather all shots
    const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
    const shotMap = new Map<string, any>();
    allShots.forEach((shot: any) => {
        if (shot.id) shotMap.set(shot.id, shot);
    });

    // 2. Re-create Object URLs for any shot whose URL was purged during Director mode
    const { assetStorage } = await import('./assetStorage');
    for (const shot of allShots) {
        if (shot.image_id && !shot._imageObjectURL) {
            try {
                const blob = await assetStorage.getAsset(shot.image_id);
                if (blob) {
                    shot._imageObjectURL = URL.createObjectURL(blob);
                }
            } catch (err) {
                console.warn(`[Memory Manager] Failed to restore image asset ${shot.image_id}:`, err);
            }
        }
        if (shot.video_id && !shot._videoObjectURL) {
            try {
                const vBlob = await assetStorage.getAsset(shot.video_id);
                if (vBlob) {
                    shot._videoObjectURL = URL.createObjectURL(vBlob);
                }
            } catch (err) {
                console.warn(`[Memory Manager] Failed to restore video asset ${shot.video_id}:`, err);
            }
        }
        if (shot.secondary_image_id && !shot._secondaryImageObjectURL) {
            try {
                const sBlob = await assetStorage.getAsset(shot.secondary_image_id);
                if (sBlob) {
                    shot._secondaryImageObjectURL = URL.createObjectURL(sBlob);
                }
            } catch (err) {
                console.warn(`[Memory Manager] Failed to restore secondary image asset:`, err);
            }
        }
        if (shot.secondary_video_id && !shot._secondaryVideoObjectURL) {
            try {
                const svBlob = await assetStorage.getAsset(shot.secondary_video_id);
                if (svBlob) {
                    shot._secondaryVideoObjectURL = URL.createObjectURL(svBlob);
                }
            } catch (err) {
                console.warn(`[Memory Manager] Failed to restore secondary video asset:`, err);
            }
        }
    }

    // 3. Restore Image elements in the Storyboard DOM
    const images = storyboardContainer.querySelectorAll('img.generated-img, img[data-id]');
    images.forEach((img) => {
        const imgEl = img as HTMLImageElement;
        const id = imgEl.dataset.id || (imgEl.closest('[data-id]') as HTMLElement)?.dataset.id;
        const shot = id ? shotMap.get(id) : null;
        
        const targetSrc = shot?._imageObjectURL || imgEl.dataset.restoresrc;
        if (targetSrc) {
            if (imgEl.src !== targetSrc) {
                imgEl.src = targetSrc;
            }
            imgEl.removeAttribute('data-restoresrc');
        }
    });

    // 4. Restore Video elements in the Storyboard DOM
    const videos = storyboardContainer.querySelectorAll('video.generated-video, video[data-id]');
    videos.forEach((vid) => {
        const vidEl = vid as HTMLVideoElement;
        const id = vidEl.dataset.id || (vidEl.closest('[data-id]') as HTMLElement)?.dataset.id;
        const shot = id ? shotMap.get(id) : null;
        
        const targetSrc = shot?._videoObjectURL || vidEl.dataset.restoresrc;
        if (targetSrc) {
            if (vidEl.src !== targetSrc) {
                vidEl.src = targetSrc;
                vidEl.load();
            }
            vidEl.removeAttribute('data-restoresrc');
        }
    });

    // 5. Reset IntersectionObserver and re-hydrate visible shots
    const { resetShotImageObserver, hydrateVisibleShots } = await import('./ui-renderers');
    resetShotImageObserver();
    hydrateVisibleShots();

    console.log('[Memory Manager] Storyboard media successfully restored.');
}

/**
 * Revokes old object URLs and clears depth maps before applying new media to a shot slot (primary or secondary).
 */
export function safelyReplaceShotMedia(
    shot: any, 
    newMedia: Blob | string, 
    type: 'image' | 'video',
    slot: 'primary' | 'secondary' = 'primary'
) {
    if (!shot) return;
    const newUrl = typeof newMedia === 'string' ? newMedia : URL.createObjectURL(newMedia);
    if (typeof newMedia !== 'string' && shot.id) {
        acquireUrl(newUrl, shot.id);
    }
    
    if (slot === 'primary') {
        if (type === 'image') {
            if (shot._imageObjectURL && shot._imageObjectURL !== newUrl) {
                dropDepth(shot._imageObjectURL); // Clear old depth map
                if (shot.image) dropDepth(shot.image);
                releaseUrl(shot._imageObjectURL, shot.id);
            }
            shot._imageObjectURL = newUrl;
        } else if (type === 'video') {
            if (shot._videoObjectURL && shot._videoObjectURL !== newUrl) {
                releaseUrl(shot._videoObjectURL, shot.id);
            }
            shot._videoObjectURL = newUrl;
        }
    } else if (slot === 'secondary') {
        if (type === 'image') {
            if (shot._secondaryImageObjectURL && shot._secondaryImageObjectURL !== newUrl) {
                dropDepth(shot._secondaryImageObjectURL);
                releaseUrl(shot._secondaryImageObjectURL, shot.id);
            }
            shot._secondaryImageObjectURL = newUrl;
        } else if (type === 'video') {
            if (shot._secondaryVideoObjectURL && shot._secondaryVideoObjectURL !== newUrl) {
                releaseUrl(shot._secondaryVideoObjectURL, shot.id);
            }
            shot._secondaryVideoObjectURL = newUrl;
        }
    }
}

export const applyNewMediaToShot = safelyReplaceShotMedia;

/**
 * Revokes secondary media object URLs and drops depth maps before clearing fields.
 */
export function removeSecondaryMedia(shot: any) {
    if (!shot) return;
    if (shot._secondaryImageObjectURL) {
        dropDepth(shot._secondaryImageObjectURL);
        releaseUrl(shot._secondaryImageObjectURL, shot.id);
        shot._secondaryImageObjectURL = undefined;
        shot.secondary_image_id = undefined;
    }
    
    if (shot._secondaryVideoObjectURL) {
        releaseUrl(shot._secondaryVideoObjectURL, shot.id);
        shot._secondaryVideoObjectURL = undefined;
        shot.secondary_video_id = undefined;
    }
}
