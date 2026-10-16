/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { state } from './state';
import { timelineState } from './state-timeline';
import { dropDepth } from './parallax/depth';
import { acquireUrl, releaseUrl } from './mediaUrlRegistry';

const BLANK_PIXEL_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function optimizeMemoryForVideoDirector() {
    console.log('[Memory Manager] Freeing Storyboard VRAM for Video Director...');

    // 1. Force the DOM to drop heavy GPU textures from the Storyboard view
    const storyboardContainer = document.getElementById('storyboard-container') || document.getElementById('panel-storyboard');
    if (storyboardContainer) {
        const mediaElements = storyboardContainer.querySelectorAll('img, video');
        mediaElements.forEach((el) => {
            if (el.closest('#video-director-modal') || el.closest('#vs-director-shell')) {
                return;
            }
            if (el instanceof HTMLImageElement) {
                if (el.src && !el.src.includes('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')) {
                    if (!el.dataset.restoresrc) {
                        el.dataset.restoresrc = el.src;
                    }
                    el.src = BLANK_PIXEL_DATA_URL; // Drops the decoded bitmap texture from VRAM
                }
            } else if (el instanceof HTMLVideoElement) {
                const vSrc = el.currentSrc || el.src;
                if (vSrc && !el.dataset.restoresrc) {
                    el.dataset.restoresrc = vSrc;
                }
                el.pause();
                el.removeAttribute('src');
                el.load(); // Forces the browser video decoder to release hardware VRAM
            }
        });
    }

    // 2. Disconnect Storyboard IntersectionObserver so it does not re-hydrate Storyboard in background
    try {
        import('./ui-renderers').then(({ resetShotImageObserver }) => {
            resetShotImageObserver();
        }).catch(() => {});
    } catch {}

    // 3. Drop heavy procedural 3D parallax depth arrays from shots to reclaim RAM
    // Note: Never revoke or clear shot._imageObjectURL or shot._videoObjectURL here,
    // as Video Director depends directly on these media references to render canvas and timeline.
    if (state.currentScenes) {
        state.currentScenes.forEach((scene: any) => {
            const shots = scene.lines || [scene];
            shots.forEach((shot: any) => {
                if (shot._imageObjectURL) dropDepth(shot._imageObjectURL);
                if (shot.image) dropDepth(shot.image);
                if (shot._secondaryImageObjectURL) dropDepth(shot._secondaryImageObjectURL);
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

    // 2. Re-create Object URLs for any shot whose URL was missing or revoked
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
    const images = storyboardContainer.querySelectorAll('img.generated-img, img[data-id], .img-container img');
    images.forEach((img) => {
        const imgEl = img as HTMLImageElement;
        const id = imgEl.dataset.id || (imgEl.closest('[data-id]') as HTMLElement)?.dataset.id;
        const shot = id ? shotMap.get(id) : null;
        
        let targetSrc = shot?._imageObjectURL || imgEl.dataset.restoresrc;
        if (shot?._imageObjectURL) {
            targetSrc = shot._imageObjectURL;
        }
        if (targetSrc && !targetSrc.includes('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')) {
            if (imgEl.src !== targetSrc) {
                imgEl.src = targetSrc;
            }
            imgEl.removeAttribute('data-restoresrc');
        }
    });

    // 4. Restore Video elements in the Storyboard DOM
    const videos = storyboardContainer.querySelectorAll('video.generated-video, video[data-id], .img-container video');
    videos.forEach((vid) => {
        const vidEl = vid as HTMLVideoElement;
        const id = vidEl.dataset.id || (vidEl.closest('[data-id]') as HTMLElement)?.dataset.id;
        const shot = id ? shotMap.get(id) : null;
        
        let targetSrc = shot?._videoObjectURL || vidEl.dataset.restoresrc;
        if (shot?._videoObjectURL) {
            targetSrc = shot._videoObjectURL;
        }
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
