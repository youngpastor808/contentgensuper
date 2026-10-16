import { state } from '../state';
import { timelineState } from '../state-timeline';
import { assetStorage } from '../assetStorage';
import * as utils from '../utils';
import * as ui from '../ui';
import { updateVideoContext } from '../videoController';
import { drawVideoFrame } from '../videoRenderer';
import { dropDepth } from '../parallax/depth';

export async function syncShotMediaToTimeline(shot: any) {
    if (!shot) return;
    
    // Auto build timeline if it's not generated yet (e.g., they started with a blank storyboard)
    const { timelineState } = await import('../state-timeline');
    if (timelineState.clips?.length <= 1 && (timelineState.clips?.[0]?.id === 'aroll-full' || timelineState.clips?.length === 0)) {
        const { buildTimelineFromShotsWithMediaDurations } = await import('../audio-upload-director');
        await buildTimelineFromShotsWithMediaDurations();
        return; // buildTimelineFromShotsWithMediaDurations already syncs all media
    }

    if (!timelineState.clips || timelineState.clips.length === 0) return;

    let clipIndex = timelineState.clips.findIndex(c => c.id === shot.id);
    if (clipIndex === -1) {
        const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
        const sIndex = allShots.findIndex((s: any) => s.id === shot.id || s === shot);
        if (sIndex !== -1 && sIndex < timelineState.clips.length) {
            clipIndex = sIndex;
        }
    }
    if (clipIndex !== -1) {
        const newClips = [...timelineState.clips];
        let imageObjUrl = shot._imageObjectURL;

        if (!imageObjUrl && shot.image_id) {
            try {
                const blob = await assetStorage.getAsset(shot.image_id);
                if (blob) {
                    imageObjUrl = URL.createObjectURL(blob);
                    shot._imageObjectURL = imageObjUrl;
                }
            } catch (err) {
                console.warn("Could not re-hydrate image blob for timeline sync:", err);
            }
        }

        // Re-hydrate secondary image/video URLs if needed
        let secondaryImageUrl = shot._secondaryImageObjectURL;
        if (!secondaryImageUrl && shot.secondary_image_id) {
            try {
                const sBlob = await assetStorage.getAsset(shot.secondary_image_id);
                if (sBlob) {
                    secondaryImageUrl = URL.createObjectURL(sBlob);
                    shot._secondaryImageObjectURL = secondaryImageUrl;
                }
            } catch (err) {
                console.warn("Could not re-hydrate secondary image blob:", err);
            }
        }

        let secondaryVideoUrl = shot._secondaryVideoObjectURL;
        if (!secondaryVideoUrl && shot.secondary_video_id) {
            try {
                const svBlob = await assetStorage.getAsset(shot.secondary_video_id);
                if (svBlob) {
                    secondaryVideoUrl = URL.createObjectURL(svBlob);
                    shot._secondaryVideoObjectURL = secondaryVideoUrl;
                }
            } catch (err) {
                console.warn("Could not re-hydrate secondary video blob:", err);
            }
        }

        const oldClip = newClips[clipIndex];

        // Revoke old URLs if they are being replaced by new ones
        if (oldClip._imageObjectURL && oldClip._imageObjectURL !== imageObjUrl) {
            dropDepth(oldClip._imageObjectURL); // Free GPU depth map
            if (oldClip._imageObjectURL.startsWith('blob:')) {
                URL.revokeObjectURL(oldClip._imageObjectURL); // Free GPU image texture
            }
        }
        if (oldClip._videoObjectURL && oldClip._videoObjectURL !== shot._videoObjectURL) {
            if (oldClip._videoObjectURL.startsWith('blob:')) {
                URL.revokeObjectURL(oldClip._videoObjectURL);
            }
        }
        if (oldClip._secondaryImageObjectURL && oldClip._secondaryImageObjectURL !== secondaryImageUrl) {
            dropDepth(oldClip._secondaryImageObjectURL);
            if (oldClip._secondaryImageObjectURL.startsWith('blob:')) {
                URL.revokeObjectURL(oldClip._secondaryImageObjectURL);
            }
        }
        if (oldClip._secondaryVideoObjectURL && oldClip._secondaryVideoObjectURL !== secondaryVideoUrl) {
            if (oldClip._secondaryVideoObjectURL.startsWith('blob:')) {
                URL.revokeObjectURL(oldClip._secondaryVideoObjectURL);
            }
        }

        const updatedClip = {
            ...oldClip,
            image_id: shot.image_id,
            video_id: shot.video_id,
            _imageObjectURL: imageObjUrl,
            _videoObjectURL: shot._videoObjectURL,
            secondary_image_id: shot.secondary_image_id,
            secondary_video_id: shot.secondary_video_id,
            _secondaryImageObjectURL: secondaryImageUrl,
            _secondaryVideoObjectURL: secondaryVideoUrl,
            preserveContent: shot.preserveContent,
            talkingHeadRole: shot.talkingHeadRole,
            talkingHeadMode: shot.talkingHeadMode ?? newClips[clipIndex].talkingHeadMode,
            talkingHeadShape: shot.talkingHeadShape ?? newClips[clipIndex].talkingHeadShape,
            talkingHeadSize: shot.talkingHeadSize ?? newClips[clipIndex].talkingHeadSize,
            useOriginalAudio: shot.useOriginalAudio || false
        };
        
        try {
            // 1. Primary Video
            if (shot._videoObjectURL) {
                try {
                    updatedClip.videoElement = await utils.loadVideoElement(shot._videoObjectURL);
                } catch (vErr) {
                    console.warn("Failed to load video element for timeline sync:", vErr);
                    updatedClip.videoElement = undefined;
                }
            } else if (!shot.video_id) {
                updatedClip.videoElement = undefined;
            }

            // 2. Primary Image (allow coexistence if image exists or in preserve mode)
            if (imageObjUrl) {
                try { 
                    updatedClip.image = await utils.loadImageOrThrow(imageObjUrl); 
                } catch (imgErr) {
                    console.warn("Failed to load primary image URL during timeline sync:", imgErr);
                    if (shot.image_id) {
                        try {
                            const freshBlob = await assetStorage.getAsset(shot.image_id);
                            if (freshBlob) {
                                const freshUrl = URL.createObjectURL(freshBlob);
                                shot._imageObjectURL = freshUrl;
                                updatedClip._imageObjectURL = freshUrl;
                                updatedClip.image = await utils.loadImageOrThrow(freshUrl);
                            }
                        } catch (reHydrateErr) {
                            console.warn("Re-hydration from assetStorage failed:", reHydrateErr);
                        }
                    }
                }
            } else if (!shot.image_id) {
                updatedClip.image = undefined;
            }

            // 3. Secondary Video (e.g. A-Roll layer or preserved video)
            if (secondaryVideoUrl) {
                try {
                    updatedClip.secondaryVideoElement = await utils.loadVideoElement(secondaryVideoUrl);
                } catch (svErr) {
                    console.warn("Failed to load secondary video element:", svErr);
                    updatedClip.secondaryVideoElement = undefined;
                }
            } else {
                updatedClip.secondaryVideoElement = undefined;
            }

            // 4. Secondary Image
            if (secondaryImageUrl) {
                try {
                    updatedClip.secondaryImage = await utils.loadImageOrThrow(secondaryImageUrl);
                } catch (siErr) {
                    console.warn("Failed to load secondary image:", siErr);
                    updatedClip.secondaryImage = undefined;
                }
            } else {
                updatedClip.secondaryImage = undefined;
            }

            // 5. Talking Head Presenter Video Element mapping
            if (updatedClip.secondaryVideoElement) {
                updatedClip.talkingHeadVideoElement = updatedClip.secondaryVideoElement;
            } else if (updatedClip.videoElement && updatedClip.image && updatedClip.talkingHeadMode && updatedClip.talkingHeadMode !== 'none') {
                updatedClip.talkingHeadVideoElement = updatedClip.videoElement;
            } else if (state.uploadedVideoElement) {
                updatedClip.talkingHeadVideoElement = state.uploadedVideoElement;
            }
        } catch (e: any) {
            console.warn("Media load for timeline sync completed with warning:", e);
        }

        newClips[clipIndex] = updatedClip;
        timelineState.setClips(newClips, false);
        updateVideoContext();
        
        try {
            ui.renderTimelineEditor();
        } catch (renderErr) {
            console.warn("Failed to update timeline editor after sync:", renderErr);
        }

        if (!state.isVideoPlaying) {
            drawVideoFrame(state.videoPauseTime || 0);
        }
    }
}
