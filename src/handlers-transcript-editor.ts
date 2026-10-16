/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as dom from './dom';
import * as ui from './ui';
import { timelineState } from './state-timeline';
import { state } from './state';
import * as utils from './utils';
import { saveVersion } from './handlers-project';
import { finalizeProduction } from './audio-first-director';

// Local state for the editor session
let isMouseDown = false;
let selectionStartIndex: number | null = null;
let selectionEndIndex: number | null = null;
let currentAssignments: Array<{ startWordIndex: number; endWordIndex: number; imageId: string }> = [];
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * Persists the current editor assignments into the timeline clips metadata.
 */
export async function saveTranscriptAssignments() {
    if (!timelineState.clips) return;
    
    // Reset range metadata for all clips first
    timelineState.clips.forEach(clip => {
        delete clip.wordRange;
    });
    
    // Apply ranges based on current assignments
    currentAssignments.forEach(ass => {
        const clip = timelineState.clips.find(c => c.id === ass.imageId);
        if (clip) {
            clip.wordRange = {
                start: ass.startWordIndex,
                end: ass.endWordIndex
            };
        }
    });
    
    await saveVersion(false); // ✅ Awaited to prevent race conditions
}

/**
 * Loads assignments from existing clip metadata into the editor session.
 */
export function loadTranscriptAssignments() {
    if (!timelineState.clips) return;
    
    const assignments = timelineState.clips
        .filter(c => c.wordRange)
        .map(c => ({
            imageId: c.id,
            startWordIndex: c.wordRange!.start,
            endWordIndex: c.wordRange!.end
        }));
    
    currentAssignments = assignments;
    ui.renderTranscriptAssignments(assignments);
}

/**
 * Clears the current word selection in the transcript editor.
 */
function clearCurrentSelection() {
    if (selectionStartIndex !== null || selectionEndIndex !== null) {
        selectionStartIndex = null;
        selectionEndIndex = null;
        ui.updateTranscriptSelection(null, null);
    }
}

/**
 * Handles keyboard events for the transcript editor, like pressing Escape.
 */
function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        clearCurrentSelection();
    }
}

export function handleOpenTranscriptEditor() {
    if (!timelineState.globalWordTimestamps || timelineState.globalWordTimestamps.length === 0) {
        ui.showStatus('No transcript available for editing. Please run "Audio-First Production" or other audio workflows first.', true, 5000);
        return;
    }
    
    // Reset local session state
    selectionStartIndex = null;
    selectionEndIndex = null;
    isMouseDown = false;

    ui.openTranscriptEditor();
    loadTranscriptAssignments();
    
    // Ensure parent modal is open so workspace isn't black / hidden
    if (dom.videoDirectorModal) {
        dom.videoDirectorModal.classList.remove('hidden');
    }
    dom.videoDirectorMainView.classList.add('hidden');
    dom.transcriptEditorWorkspace.classList.remove('hidden');

    // Bind scroll buttons
    const scrollUpBtn = document.getElementById('transcript-scroll-up-btn');
    const scrollDownBtn = document.getElementById('transcript-scroll-down-btn');
    const scrollContainer = document.getElementById('transcript-editor-scroll-container');

    if (scrollUpBtn && scrollContainer) {
        scrollUpBtn.onclick = () => scrollContainer.scrollBy({ top: -250, behavior: 'smooth' });
    }
    if (scrollDownBtn && scrollContainer) {
        scrollDownBtn.onclick = () => scrollContainer.scrollBy({ top: 250, behavior: 'smooth' });
    }

    // Attach hover-linking events
    if (dom.transcriptEditorTranscriptContainer) {
        dom.transcriptEditorTranscriptContainer.onmouseover = (e) => {
            const target = e.target as HTMLElement;
            const chip = target.closest('.assigned-trigger-chip, .trigger-word') as HTMLElement;
            if (chip) {
                const imageId = chip.dataset.imageId;
                if (imageId && dom.transcriptEditorImageBin) {
                    const binItem = dom.transcriptEditorImageBin.querySelector(`.b-roll-item[data-image-id="${imageId}"]`);
                    binItem?.classList.add('hover-linked');
                }
            }
        };
        dom.transcriptEditorTranscriptContainer.onmouseout = (e) => {
            const target = e.target as HTMLElement;
            const chip = target.closest('.assigned-trigger-chip, .trigger-word') as HTMLElement;
            if (chip) {
                const imageId = chip.dataset.imageId;
                if (imageId && dom.transcriptEditorImageBin) {
                    const binItem = dom.transcriptEditorImageBin.querySelector(`.b-roll-item[data-image-id="${imageId}"]`);
                    binItem?.classList.remove('hover-linked');
                }
            }
        };
    }

    if (dom.transcriptEditorImageBin) {
        dom.transcriptEditorImageBin.onmouseover = (e) => {
            const item = (e.target as HTMLElement).closest('.b-roll-item') as HTMLElement;
            if (item) {
                const imageId = item.dataset.imageId;
                if (imageId && dom.transcriptEditorTranscriptContainer) {
                    const chips = dom.transcriptEditorTranscriptContainer.querySelectorAll(`.assigned-trigger-chip[data-image-id="${imageId}"], .trigger-word[data-image-id="${imageId}"]`);
                    chips.forEach(c => c.classList.add('hover-active'));
                }
            }
        };
        dom.transcriptEditorImageBin.onmouseout = (e) => {
            const item = (e.target as HTMLElement).closest('.b-roll-item') as HTMLElement;
            if (item) {
                const imageId = item.dataset.imageId;
                if (imageId && dom.transcriptEditorTranscriptContainer) {
                    const chips = dom.transcriptEditorTranscriptContainer.querySelectorAll(`.assigned-trigger-chip[data-image-id="${imageId}"], .trigger-word[data-image-id="${imageId}"]`);
                    chips.forEach(c => c.classList.remove('hover-active'));
                }
            }
        };
    }

    if (!keydownHandler) {
        keydownHandler = handleKeyDown;
        document.addEventListener('keydown', keydownHandler);
    }
}

export function handleCloseTranscriptEditor() {
    dom.videoDirectorMainView.classList.remove('hidden');
    dom.transcriptEditorWorkspace.classList.add('hidden');
    ui.closeTranscriptEditor();
    
    if (keydownHandler) {
        document.removeEventListener('keydown', keydownHandler);
        keydownHandler = null;
    }
}

export function handleTranscriptEditorInteraction(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const wordEl = target.closest('.transcript-word') as HTMLElement;
    
    if (event.type === 'mousedown' && !wordEl) {
        clearCurrentSelection();
        isMouseDown = false; 
        return;
    }

    if (!wordEl) return; 
    
    const wordIndex = parseInt(wordEl.dataset.index!, 10);
    const isAlreadyAssigned = currentAssignments.some(ass => 
        wordIndex >= ass.startWordIndex && wordIndex <= ass.endWordIndex
    );

    if (isAlreadyAssigned && event.type === 'mousedown') {
        const idx = currentAssignments.findIndex(ass => 
            wordIndex >= ass.startWordIndex && wordIndex <= ass.endWordIndex
        );
        if (idx !== -1) {
            currentAssignments.splice(idx, 1);
            ui.renderTranscriptAssignments(currentAssignments);
            saveTranscriptAssignments(); // Fire and forget is OK here
        }
        return;
    }

    switch (event.type) {
        case 'mousedown':
            isMouseDown = true;
            selectionStartIndex = wordIndex;
            selectionEndIndex = wordIndex;
            ui.updateTranscriptSelection(selectionStartIndex, selectionEndIndex);
            break;
        case 'mouseover':
            if (isMouseDown && selectionStartIndex !== null) {
                selectionEndIndex = wordIndex;
                ui.updateTranscriptSelection(selectionStartIndex, selectionEndIndex);

                // Auto scroll transcript container when dragging near top/bottom boundaries
                const scrollContainer = document.getElementById('transcript-editor-scroll-container');
                if (scrollContainer) {
                    const rect = scrollContainer.getBoundingClientRect();
                    const edgeThreshold = 60;
                    if (event.clientY < rect.top + edgeThreshold) {
                        scrollContainer.scrollBy({ top: -40, behavior: 'auto' });
                    } else if (event.clientY > rect.bottom - edgeThreshold) {
                        scrollContainer.scrollBy({ top: 40, behavior: 'auto' });
                    }
                }
            }
            break;
        case 'mouseup':
            isMouseDown = false;
            break;
    }
}

export async function handleTranscriptEditorImageClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const imageEl = target.closest('.b-roll-item') as HTMLElement;
    if (!imageEl) return;

    const imageId = imageEl.dataset.imageId;

    if (selectionStartIndex === null || selectionEndIndex === null) {
        // If clicking an assigned image in bin without word selection, scroll transcript to that assignment
        if (imageId) {
            const assignedChip = dom.transcriptEditorTranscriptContainer?.querySelector(`.assigned-trigger-chip[data-image-id="${imageId}"], .trigger-word[data-image-id="${imageId}"]`);
            if (assignedChip) {
                assignedChip.scrollIntoView({ behavior: 'smooth', block: 'center' });
                assignedChip.classList.add('hover-active');
                setTimeout(() => assignedChip.classList.remove('hover-active'), 1800);
                ui.showStatus('Scrolled transcript to assigned cut point.', false, 2500);
                return;
            }
        }
        ui.showStatus('Select a word in the transcript first, then click an image to assign cut point.', true, 3000);
        return;
    }

    if (!imageId) {
        console.error("Image in bin is missing a stable ID.");
        ui.showStatus("An internal error occurred (missing image ID).", true, 5000);
        return;
    }

    const start = Math.min(selectionStartIndex, selectionEndIndex);
    const end = Math.max(selectionStartIndex, selectionEndIndex);

    // Overlap validation
    const isOverlapping = currentAssignments.some(ass => 
        (start >= ass.startWordIndex && start <= ass.endWordIndex) ||
        (end >= ass.startWordIndex && end <= ass.endWordIndex) ||
        (ass.startWordIndex >= start && ass.endWordIndex <= end)
    );

    if (isOverlapping) {
        ui.showStatus('Selection overlaps with an existing assignment.', true, 4000);
        return;
    }

    currentAssignments.push({
        startWordIndex: start,
        endWordIndex: end,
        imageId: imageId,
    });
    
    currentAssignments.sort((a, b) => a.startWordIndex - b.startWordIndex);

    clearCurrentSelection();
    ui.renderTranscriptAssignments(currentAssignments);
    await saveTranscriptAssignments(); // ✅ Await to ensure save completes
}

export async function handleAutoAssignTranscript() {
    if (!timelineState.globalWordTimestamps || timelineState.globalWordTimestamps.length === 0) {
        ui.showStatus("No transcript found.", true, 3000);
        return;
    }

    ui.showConfirmation(
        "Auto-Assign Media?",
        "This will clear any existing assignments and attempt to match all storyboard images and videos to the transcript automatically. Proceed?",
        async () => {
            currentAssignments = [];
            let allImageShots: { id: string; text?: string; image?: any }[] = [];

            // 1. Gather all shots from storyboard scenes to ensure every single image and video is represented
            const allScenesShots = (state.currentScenes || []).flatMap(s => s.lines || [s]);
            const storyboardMediaShots = allScenesShots.filter(s => !!(s._imageObjectURL || s.image_id || s._videoObjectURL || s.video_id));

            if (storyboardMediaShots.length > 0) {
                allImageShots = storyboardMediaShots.map(s => {
                    // Match with existing timeline clip if available to reuse clip image instance
                    const existingClip = timelineState.clips?.find(c => c.id === s.id);
                    return {
                        id: s.id,
                        text: s.narration || s.text_reference || s.line_text || s.script || (existingClip?.text) || '',
                        image: existingClip?.image || { src: s._imageObjectURL || '' }
                    };
                });
            } else if (timelineState.clips && timelineState.clips.length > 0) {
                allImageShots = timelineState.clips.filter(l => (l.image || l.image_id || l.videoElement || l._videoObjectURL || l.video_id) && l.id).map(l => ({
                    id: l.id,
                    text: l.text || '',
                    image: l.image || { src: '' }
                }));
            }

            if (allImageShots.length === 0) {
                ui.showStatus("No media in storyboard to assign.", true, 3000);
                return;
            }

            const totalWords = timelineState.globalWordTimestamps!.length;
            const norm = (s: string) => (s || "").toLowerCase()
                .replace(/<[^>]+>/g, " ")
                .replace(/[^a-z0-9\s']/g, "")
                .split(/\s+/)
                .filter(Boolean);

            const transcriptNorm: string[] = [];
            const normToWordIndexMap: number[] = [];
            timelineState.globalWordTimestamps!.forEach((wordObj, wordIndex) => {
                const normalizedWords = norm(wordObj.word);
                if (normalizedWords.length === 0) {
                    transcriptNorm.push("");
                    normToWordIndexMap.push(wordIndex);
                } else {
                    normalizedWords.forEach(normWord => {
                        transcriptNorm.push(normWord);
                        normToWordIndexMap.push(wordIndex);
                    });
                }
            });

            const buildNgrams = (tokens: string[], n: number) => {
                const map = new Map<string, number[]>();
                if (tokens.length < n) return map;
                for (let i = 0; i <= tokens.length - n; i++) {
                    const slice = tokens.slice(i, i + n);
                    if (slice.some(t => !t)) continue;
                    const ngram = slice.join('_');
                    if (!map.has(ngram)) map.set(ngram, []);
                    map.get(ngram)!.push(i);
                }
                return map;
            };

            const transcript4Grams = buildNgrams(transcriptNorm, 4);
            const transcript3Grams = buildNgrams(transcriptNorm, 3);
            const transcript2Grams = buildNgrams(transcriptNorm, 2);
            const usedGlobalWordIndices = new Set<number>();
            let lastAssignedWordIndex = -1;
            let matchCount = 0;
            const unassignedShots: { shot: typeof allImageShots[0]; shotIndex: number }[] = [];

            // PASS 1: High-confidence exact N-gram phrase matching
            allImageShots.forEach((shot, shotIdx) => {
                const scriptText = shot.text || "";
                const scriptNorm = norm(scriptText);
                if (scriptNorm.length < 2) {
                    unassignedShots.push({ shot, shotIndex: shotIdx });
                    return;
                }

                let allPotentialMatches: number[] = [];
                if (scriptNorm.length >= 4) {
                    const searchNgram4 = scriptNorm.slice(0, 4).join('_');
                    allPotentialMatches.push(...(transcript4Grams.get(searchNgram4) || []));
                }
                if (scriptNorm.length >= 3) {
                    const searchNgram3 = scriptNorm.slice(0, 3).join('_');
                    allPotentialMatches.push(...(transcript3Grams.get(searchNgram3) || []));
                }
                const searchNgram2 = scriptNorm.slice(0, 2).join('_');
                allPotentialMatches.push(...(transcript2Grams.get(searchNgram2) || []));

                const validMatches: { startWordIndex: number; endWordIndex: number }[] = [];
                const uniqueStarts = [...new Set(allPotentialMatches)];

                for (const startNormIndex of uniqueStarts) {
                    let matchLen = 0;
                    for (let k = 0; k < scriptNorm.length; k++) {
                        if ((startNormIndex + k) < transcriptNorm.length && 
                            transcriptNorm[startNormIndex + k] === scriptNorm[k]) {
                            matchLen++;
                        } else {
                            break;
                        }
                    }
                    if (matchLen < 2) continue;

                    const endNormIndex = Math.min(startNormIndex + matchLen - 1, transcriptNorm.length - 1);
                    const startWordIndex = normToWordIndexMap[startNormIndex];
                    const endWordIndex = normToWordIndexMap[endNormIndex];

                    if (startWordIndex === undefined || endWordIndex === undefined) continue;

                    let isUsed = false;
                    for (let i = startWordIndex; i <= endWordIndex; i++) {
                        if (usedGlobalWordIndices.has(i)) {
                            isUsed = true;
                            break;
                        }
                    }
                    if (!isUsed) {
                        validMatches.push({ startWordIndex, endWordIndex });
                    }
                }

                if (validMatches.length > 0) {
                    validMatches.sort((a, b) => {
                        const distA = a.startWordIndex - lastAssignedWordIndex;
                        const distB = b.startWordIndex - lastAssignedWordIndex;
                        if (distA > 0 && distB <= 0) return -1;
                        if (distB > 0 && distA <= 0) return 1;
                        return Math.abs(distA) - Math.abs(distB);
                    });

                    const bestMatch = validMatches[0];
                    currentAssignments.push({ ...bestMatch, imageId: shot.id });
                    for (let i = bestMatch.startWordIndex; i <= bestMatch.endWordIndex; i++) {
                        usedGlobalWordIndices.add(i);
                    }
                    lastAssignedWordIndex = bestMatch.endWordIndex;
                    matchCount++;
                } else {
                    unassignedShots.push({ shot, shotIndex: shotIdx });
                }
            });

            // PASS 2: Fuzzy token matching for any unassigned shots
            const stillUnassigned: typeof unassignedShots = [];
            for (const item of unassignedShots) {
                const { shot } = item;
                const scriptTokens = norm(shot.text || "");
                if (scriptTokens.length === 0) {
                    stillUnassigned.push(item);
                    continue;
                }

                // Look for contiguous unused word window with best token overlap
                let bestStart = -1;
                let bestEnd = -1;
                let bestScore = 0;
                const targetWindowSize = Math.max(2, Math.min(scriptTokens.length, 12));

                for (let w = 0; w <= totalWords - targetWindowSize; w++) {
                    let hasOverlap = false;
                    for (let k = 0; k < targetWindowSize; k++) {
                        if (usedGlobalWordIndices.has(w + k)) {
                            hasOverlap = true;
                            break;
                        }
                    }
                    if (hasOverlap) continue;

                    let score = 0;
                    for (let k = 0; k < targetWindowSize; k++) {
                        const wordText = norm(timelineState.globalWordTimestamps![w + k]?.word || '')[0];
                        if (wordText && scriptTokens.includes(wordText)) {
                            score++;
                        }
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestStart = w;
                        bestEnd = w + targetWindowSize - 1;
                    }
                }

                if (bestScore >= 1 && bestStart !== -1) {
                    currentAssignments.push({ startWordIndex: bestStart, endWordIndex: bestEnd, imageId: shot.id });
                    for (let i = bestStart; i <= bestEnd; i++) {
                        usedGlobalWordIndices.add(i);
                    }
                    matchCount++;
                } else {
                    stillUnassigned.push(item);
                }
            }

            // PASS 3: Fallback placement into unused transcript gaps or sequential partitioning
            // This guarantees ALL storyboard images get mapped to the transcript
            if (stillUnassigned.length > 0) {
                // Find all contiguous unused word segments
                const gaps: { start: number; end: number }[] = [];
                let gapStart: number | null = null;
                for (let w = 0; w < totalWords; w++) {
                    if (!usedGlobalWordIndices.has(w)) {
                        if (gapStart === null) gapStart = w;
                    } else {
                        if (gapStart !== null) {
                            gaps.push({ start: gapStart, end: w - 1 });
                            gapStart = null;
                        }
                    }
                }
                if (gapStart !== null) {
                    gaps.push({ start: gapStart, end: totalWords - 1 });
                }

                for (const item of stillUnassigned) {
                    const { shot } = item;
                    if (gaps.length > 0) {
                        // Place into first available gap with at least 1 word
                        const gap = gaps[0];
                        const gapLen = gap.end - gap.start + 1;
                        const assignLen = Math.max(1, Math.min(gapLen, 6));
                        const start = gap.start;
                        const end = gap.start + assignLen - 1;

                        currentAssignments.push({ startWordIndex: start, endWordIndex: end, imageId: shot.id });
                        for (let i = start; i <= end; i++) {
                            usedGlobalWordIndices.add(i);
                        }
                        matchCount++;

                        if (end < gap.end) {
                            gap.start = end + 1;
                        } else {
                            gaps.shift();
                        }
                    } else {
                        // If no gaps remain, estimate proportional position from total shots
                        const totalShotsCount = allImageShots.length;
                        const estIndex = Math.min(totalWords - 1, Math.floor((item.shotIndex / totalShotsCount) * totalWords));
                        currentAssignments.push({
                            startWordIndex: estIndex,
                            endWordIndex: Math.min(totalWords - 1, estIndex + 1),
                            imageId: shot.id
                        });
                        matchCount++;
                    }
                }
            }

            currentAssignments.sort((a, b) => a.startWordIndex - b.startWordIndex);
            ui.renderTranscriptAssignments(currentAssignments);
            await saveTranscriptAssignments();
            ui.showStatus(`Magic Assign matched ${matchCount} of ${allImageShots.length} media shots.`, false, 4000);
        }
    );
}

export async function handleUndoTranscriptAssignment() {
    if (currentAssignments.length > 0) {
        currentAssignments.pop();
        ui.renderTranscriptAssignments(currentAssignments);
        await saveTranscriptAssignments();
        ui.showStatus('Last assignment undone.', false, 2000);
    } else {
        ui.showStatus('No assignments to undo.', false, 2000);
    }
}

export async function handleClearTranscriptAssignments() {
    ui.showConfirmation('Clear All?', 'Are you sure you want to clear all transcript assignments?', async () => {
        currentAssignments = [];
        ui.renderTranscriptAssignments(currentAssignments);
        await saveTranscriptAssignments();
        ui.showStatus('Assignments cleared.', false, 2000);
    });
}

export async function handleRebuildTimelineFromTranscript() {
    if (currentAssignments.length === 0) {
        ui.showStatus('No assignments to build from. Please assign images to the transcript.', true, 4000);
        return;
    }

    if (!timelineState.globalWordTimestamps || timelineState.globalWordTimestamps.length === 0) {
        ui.showStatus('No transcript words found to rebuild timeline.', true, 4000);
        return;
    }

    const allWords = timelineState.globalWordTimestamps;
    const totalWords = allWords.length;
    const masterDuration = timelineState.masterAudioBuffer?.duration ?? allWords[totalWords - 1].end;
    const fallbackShots = state.currentScenes.flatMap(s => s.lines || [s]);
    const existingClips = timelineState.clips || [];

    // Sort assignments strictly by startWordIndex
    const sortedAssignments = [...currentAssignments].sort((a, b) => a.startWordIndex - b.startWordIndex);

    let newTimeline: any[] = [];

    for (let index = 0; index < sortedAssignments.length; index++) {
        const assignment = sortedAssignments[index];
        const nextAssignment = sortedAssignments[index + 1];

        // The start word index for this assignment
        const startWordIdx = Math.max(0, Math.min(assignment.startWordIndex, totalWords - 1));

        // The next assignment's start word index, or total words if this is the last assignment
        const nextStartWordIdx = nextAssignment 
            ? Math.max(startWordIdx + 1, Math.min(nextAssignment.startWordIndex, totalWords))
            : totalWords;
        const endWordIdx = Math.max(startWordIdx, nextStartWordIdx - 1);

        // Find visual assets (image or video)
        let existingClip = existingClips.find(c => c.id === assignment.imageId);
        let fallbackShot = fallbackShots.find(s => s.id === assignment.imageId);
        let imgElement = existingClip?.image;
        let videoElement = existingClip?.videoElement;
        let cameraMovement = existingClip?.cameraMovement || fallbackShot?.camera_movement || 'static';
        let videoObjectURL = existingClip?._videoObjectURL || fallbackShot?._videoObjectURL;
        let videoId = existingClip?.video_id || fallbackShot?.video_id;
        let imageObjectURL = existingClip?._imageObjectURL || fallbackShot?._imageObjectURL;
        let imageId = existingClip?.image_id || fallbackShot?.image_id;
        let videoStartOffset = existingClip?.videoStartOffset ?? fallbackShot?.videoStartOffset ?? 0;

        if (!imgElement && !videoElement) {
            if (fallbackShot) {
                if (videoObjectURL) {
                    try {
                        videoElement = await utils.loadVideoElement(videoObjectURL);
                        cameraMovement = fallbackShot.camera_movement || 'static';
                    } catch (e) {
                        console.error("Failed to load video for assignment", e);
                    }
                }
                if (imageObjectURL) {
                    try {
                        imgElement = await utils.loadImageOrThrow(imageObjectURL);
                        cameraMovement = fallbackShot.camera_movement || 'static';
                    } catch (e) {
                        console.error("Failed to load image for assignment", e);
                    }
                }
            }
        }

        if (!imgElement && !videoElement) continue;

        // Determine exact timeline startTime and endTime:
        // - First image starts at 0.0s to ensure complete audio start coverage
        // - Subsequent images start at the exact timestamp of their assigned word
        let startTime = (index === 0) ? 0 : allWords[startWordIdx].start;

        // - Image stays on screen until the exact start timestamp of the NEXT assigned image!
        // - The final image stays on screen until the end of the master audio track
        let endTime = masterDuration;
        if (nextAssignment) {
            const nextStartWord = allWords[Math.min(nextAssignment.startWordIndex, totalWords - 1)];
            endTime = Math.max(startTime + 0.1, nextStartWord.start);
        } else {
            endTime = Math.max(startTime + 0.1, Math.max(allWords[endWordIdx].end, masterDuration));
        }

        const clipDuration = Math.max(0.1, endTime - startTime);

        // Spanned words for this clip
        const wordSliceStart = (index === 0) ? 0 : startWordIdx;
        const relevantWords = allWords.slice(wordSliceStart, endWordIdx + 1);

        const clipText = relevantWords.map(w => w.word).join(' ');

        const wordTimestamps = relevantWords.map(w => {
            const relStart = Math.max(0, Math.min(w.start - startTime, clipDuration));
            const relEnd = Math.max(0, Math.min(w.end - startTime, clipDuration));
            return {
                ...w,
                start: relStart,
                end: relEnd
            };
        });

        newTimeline.push({
            ...(existingClip || {}),
            ...(fallbackShot ? {
                talkingHeadMode: fallbackShot.talkingHeadMode,
                talkingHeadRole: fallbackShot.talkingHeadRole,
                talkingHeadShape: fallbackShot.talkingHeadShape,
                talkingHeadSize: fallbackShot.talkingHeadSize,
                colorFilter: fallbackShot.colorFilter,
                colorFilterIntensity: fallbackShot.colorFilterIntensity,
                focalPoint: fallbackShot.focalPoint,
                cameraKeyframes: fallbackShot.cameraKeyframes,
            } : {}),
            id: assignment.imageId || `transcript_clip_${index}_${startWordIdx}`,
            startTime,
            endTime,
            duration: clipDuration,
            text: clipText,
            cameraMovement,
            transitionToNext: existingClip?.transitionToNext || 'cut',
            image: imgElement,
            image_id: imageId,
            _imageObjectURL: imageObjectURL,
            videoElement: videoElement,
            video_id: videoId,
            _videoObjectURL: videoObjectURL,
            videoStartOffset,
            useOriginalAudio: existingClip?.useOriginalAudio ?? fallbackShot?.useOriginalAudio,
            volume: existingClip?.volume ?? fallbackShot?.volume,
            fadeIn: existingClip?.fadeIn ?? fallbackShot?.fadeIn,
            fadeOut: existingClip?.fadeOut ?? fallbackShot?.fadeOut,
            playbackRate: existingClip?.playbackRate ?? fallbackShot?.playbackRate,
            wordRange: { start: wordSliceStart, end: endWordIdx },
            startWordIndex: wordSliceStart,
            endWordIndex: endWordIdx,
            alignmentConfidence: 1.0,
            textMatchConfidence: 1.0,
            timingReliability: 1.0,
            timingProvenance: 'manual',
            timingSource: 'manual',
            wordTimestamps,
        });
    }

    if (newTimeline.length === 0) {
        ui.showStatus('Failed to build clips from assignments. Check media availability.', true, 4000);
        return;
    }

    // Update timeline clips
    timelineState.setClips(newTimeline);

    finalizeProduction();
    handleCloseTranscriptEditor();

    ui.showStatus('✅ Timeline rebuilt cleanly matching all assignments!', false, 3000);
    await saveVersion(false);
}
