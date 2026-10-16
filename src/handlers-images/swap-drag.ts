import { state } from '../state';
import * as dom from '../dom';
import * as ui from '../ui';
import { saveVersion } from '../handlers-project';
import { syncShotMediaToTimeline } from './timeline-sync';

let activeSwapSourceShot: any = null;
let activeSwapSourceNum: string = '';

export function getAllShotsList() {
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const shotsList: Array<{
        shot: any;
        sceneIndex: number;
        lineIndex: number;
        shotNumberText: string;
        narrativeText: string;
        displaySrc: string;
        videoSrc: string;
    }> = [];

    if (isPaced) {
        state.currentScenes.forEach((shot, i) => {
            const displaySrc = shot._imageObjectURL || (shot.image_id ? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23111827"/%3E%3Ctext x="50" y="50" dominant-baseline="middle" text-anchor="middle" fill="%23374151" font-size="10"%3ELoading...%3C/text%3E%3C/svg%3E' : '');
            const videoSrc = shot._videoObjectURL || '';
            shotsList.push({
                shot,
                sceneIndex: 0,
                lineIndex: i,
                shotNumberText: shot.shot_number || `${i + 1}`,
                narrativeText: shot.text_reference || shot.line_text || '',
                displaySrc,
                videoSrc
            });
        });
    } else {
        state.currentScenes.forEach((scene, sIdx) => {
            const lines = scene.lines || [scene];
            lines.forEach((line: any, lIdx: number) => {
                const displaySrc = line._imageObjectURL || (line.image_id ? 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23111827"/%3E%3Ctext x="50" y="50" dominant-baseline="middle" text-anchor="middle" fill="%23374151" font-size="10"%3ELoading...%3C/text%3E%3C/svg%3E' : '');
                const videoSrc = line._videoObjectURL || '';
                shotsList.push({
                    shot: line,
                    sceneIndex: sIdx,
                    lineIndex: lIdx,
                    shotNumberText: `${sIdx + 1}.${lIdx + 1}`,
                    narrativeText: line.text_reference || line.line_text || '',
                    displaySrc,
                    videoSrc
                });
            });
        });
    }

    return { isPaced, shotsList };
}

export async function swapShotMedia(sourceShot: any, targetShot: any, sourceNumber?: string, targetNumber?: string) {
    if (!sourceShot || !targetShot || sourceShot.id === targetShot.id) return;

    // Swap Image fields
    const tempImageId = sourceShot.image_id;
    const tempImageURL = sourceShot._imageObjectURL;
    const tempMimeType = sourceShot.imageMimeType;
    const tempImage = sourceShot.image;

    sourceShot.image_id = targetShot.image_id;
    sourceShot._imageObjectURL = targetShot._imageObjectURL;
    sourceShot.imageMimeType = targetShot.imageMimeType;
    sourceShot.image = targetShot.image;

    targetShot.image_id = tempImageId;
    targetShot._imageObjectURL = tempImageURL;
    targetShot.imageMimeType = tempMimeType;
    targetShot.image = tempImage;

    // Swap Video fields
    const tempVideoId = sourceShot.video_id;
    const tempVideoURL = sourceShot._videoObjectURL;
    const tempVideoPrompt = sourceShot.video_prompt;

    sourceShot.video_id = targetShot.video_id;
    sourceShot._videoObjectURL = targetShot._videoObjectURL;
    sourceShot.video_prompt = targetShot.video_prompt;

    targetShot.video_id = tempVideoId;
    targetShot._videoObjectURL = tempVideoURL;
    targetShot.video_prompt = tempVideoPrompt;

    // Refresh UI & update timeline context
    ui.renderResults(state.currentScenes);
    saveVersion(false);
    await Promise.all([
        syncShotMediaToTimeline(sourceShot),
        syncShotMediaToTimeline(targetShot)
    ]);
    const sNum = sourceNumber || 'Source';
    const tNum = targetNumber || 'Target';
    ui.showStatus(`🔄 Swapped media between Shot ${sNum} and Shot ${tNum}`, false, 3500);
}

export function openSwapModal(sourceShot: any, sourceSceneIndex: number, sourceLineIndex: number, isPaced: boolean) {
    if (!sourceShot || !dom.swapMediaModal) return;
    activeSwapSourceShot = sourceShot;
    const { shotsList } = getAllShotsList();

    const sourceItem = shotsList.find(item => item.shot === sourceShot || item.shot.id === sourceShot.id);
    activeSwapSourceNum = sourceItem ? sourceItem.shotNumberText : (isPaced ? sourceShot.shot_number || `${sourceLineIndex + 1}` : `${sourceSceneIndex + 1}.${sourceLineIndex + 1}`);

    if (dom.swapSourceShotTitle) {
        dom.swapSourceShotTitle.textContent = `Select a target shot to swap media with Shot ${activeSwapSourceNum}:`;
    }

    if (dom.swapShotsGrid) {
        dom.swapShotsGrid.innerHTML = shotsList.map((item) => {
            const isCurrent = item.shot === sourceShot || item.shot.id === sourceShot.id;
            const previewMedia = item.videoSrc ? 
                `<video src="${item.videoSrc}" class="w-full h-24 object-cover rounded-md" autoplay loop muted playsinline></video>` :
                (item.displaySrc ? `<img src="${item.displaySrc}" class="w-full h-24 object-cover rounded-md">` : `<div class="w-full h-24 bg-gray-950/80 rounded-md flex items-center justify-center text-xs text-gray-500 italic border border-dashed border-gray-800">No media</div>`);

            return `
            <div class="swap-shot-card bg-gray-800/80 border ${isCurrent ? 'border-amber-500/50 bg-amber-950/10 opacity-60 pointer-events-none' : 'border-gray-700 hover:border-amber-400 cursor-pointer'} rounded-xl p-3 flex flex-col gap-2 transition" data-scene-index="${item.sceneIndex}" data-line-index="${item.lineIndex}" data-shot-number="${item.shotNumberText}">
                <div class="flex justify-between items-center text-xs font-bold text-gray-300">
                    <span>Shot ${item.shotNumberText} ${isCurrent ? '(Active)' : ''}</span>
                </div>
                ${previewMedia}
                <p class="text-xs text-gray-400 line-clamp-2 italic">"${ui.escapeHtml(item.narrativeText)}"</p>
                ${!isCurrent ? `<button class="swap-select-btn mt-auto w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-xs transition">Swap with Shot ${item.shotNumberText}</button>` : '<div class="text-xs text-center text-amber-400 py-1 font-semibold">Current Shot</div>'}
            </div>
            `;
        }).join('');
    }

    dom.swapMediaModal.classList.remove('hidden');
}

export function closeSwapModal() {
    if (dom.swapMediaModal) {
        dom.swapMediaModal.classList.add('hidden');
    }
    activeSwapSourceShot = null;
    activeSwapSourceNum = '';
}

export function handleSwapGridClick(event: Event) {
    const target = event.target as HTMLElement;
    const card = target.closest('.swap-shot-card') as HTMLElement;
    if (!card || card.classList.contains('pointer-events-none') || !activeSwapSourceShot) return;

    const sceneIndex = parseInt(card.dataset.sceneIndex!, 10);
    const lineIndex = parseInt(card.dataset.lineIndex!, 10);
    const targetShotNumber = card.dataset.shotNumber || '';
    const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
    const scene = state.currentScenes[sceneIndex];
    const lines = scene?.lines || [scene];
    const targetShot = isPaced ? state.currentScenes[lineIndex] : lines?.[lineIndex];

    if (targetShot && activeSwapSourceShot) {
        const sourceNum = activeSwapSourceNum;
        const sourceShot = activeSwapSourceShot;
        closeSwapModal();
        swapShotMedia(sourceShot, targetShot, sourceNum, targetShotNumber);
    }
}

export function handleShotDragStart(event: DragEvent) {
    const target = event.target as HTMLElement;
    const imgContainer = target.closest('.img-container') as HTMLElement;
    if (!imgContainer) return;

    const sceneIndex = parseInt(imgContainer.dataset.sceneIndex!, 10);
    const lineIndex = parseInt(imgContainer.dataset.lineIndex!, 10);

    if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', JSON.stringify({ sceneIndex, lineIndex }));
        event.dataTransfer.effectAllowed = 'move';
    }
    imgContainer.classList.add('opacity-50', 'ring-2', 'ring-amber-400');
}

export function handleShotDragOver(event: DragEvent) {
    const target = event.target as HTMLElement;
    const promptItem = target.closest('.prompt-item') || target.closest('.img-container');
    if (promptItem) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        promptItem.classList.add('ring-2', 'ring-amber-400', 'bg-amber-950/20');
    }
}

export function handleShotDragLeave(event: DragEvent) {
    const target = event.target as HTMLElement;
    const promptItem = target.closest('.prompt-item') || target.closest('.img-container');
    if (promptItem) {
        promptItem.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-950/20');
    }
}

export function handleShotDrop(event: DragEvent) {
    const target = event.target as HTMLElement;
    const promptItem = (target.closest('.prompt-item') || target.closest('.img-container')) as HTMLElement;
    if (!promptItem) return;

    event.preventDefault();
    promptItem.classList.remove('ring-2', 'ring-amber-400', 'bg-amber-950/20');

    document.querySelectorAll('.img-container.opacity-50').forEach(el => el.classList.remove('opacity-50', 'ring-2', 'ring-amber-400'));

    if (!event.dataTransfer) return;
    try {
        const sourceData = JSON.parse(event.dataTransfer.getData('text/plain'));
        if (!sourceData || typeof sourceData.sceneIndex !== 'number') return;

        const targetSceneIndex = parseInt(promptItem.dataset.sceneIndex!, 10);
        const targetLineIndex = parseInt(promptItem.dataset.lineIndex!, 10);

        if (sourceData.sceneIndex === targetSceneIndex && sourceData.lineIndex === targetLineIndex) return;

        const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
        
        const srcScene = state.currentScenes[sourceData.sceneIndex];
        const srcLines = srcScene?.lines || [srcScene];
        const sourceShot = isPaced ? state.currentScenes[sourceData.lineIndex] : srcLines?.[sourceData.lineIndex];

        const tgtScene = state.currentScenes[targetSceneIndex];
        const tgtLines = tgtScene?.lines || [tgtScene];
        const targetShot = isPaced ? state.currentScenes[targetLineIndex] : tgtLines?.[targetLineIndex];

        if (sourceShot && targetShot) {
            const srcNum = isPaced ? sourceShot.shot_number : `${sourceData.sceneIndex + 1}.${sourceData.lineIndex + 1}`;
            const tgtNum = isPaced ? targetShot.shot_number : `${targetSceneIndex + 1}.${targetLineIndex + 1}`;
            swapShotMedia(sourceShot, targetShot, srcNum, tgtNum);
        }
    } catch (e) {
        console.error('Failed to parse drag drop data:', e);
    }
}
