/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import type { WordTimestamp } from './types';
import * as dom from './dom';
import * as ui from './ui';
import { loadProject } from './handlers-project';
import { TRANSCRIPT_CACHE_STORE } from './constants';
import { DB } from './db';
import { timelineState } from './state-timeline';
import * as utils from './utils';
import { alignShotsCanonical, alignShotsToTranscript, sliceTranscriptForShots } from './timelineBuilder';
import { updateVideoContext, normalizeTimeline } from './videoController';

export async function handleUploadSrtSync() {
    dom.srtUploadInput.click();
}

export async function handleSrtFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const srtContent = e.target?.result as string;
            ui.logProductionStatus('📄 SRT Sync: Upload received, parsing...');
            const wordTimestamps = utils.parseSRT(srtContent);
            const blocks = utils.parseSRTBlocks(srtContent);
            
            if (wordTimestamps.length === 0) {
                ui.logProductionStatus('❌ Could not find valid timestamps in SRT', true);
                ui.showStatus('Could not find valid timestamps in SRT', true, 4000);
                return;
            }

            ui.logProductionStatus(`✔️ Parsed ${wordTimestamps.length} words and ${blocks.length} blocks from SRT.`);
            timelineState.setGlobalWordTimestamps(wordTimestamps);
            
            // Re-align shots based on new SRT using canonical alignment
            if (timelineState.clips && timelineState.clips.length > 0) {
                ui.logProductionStatus('📄 SRT Sync: Aligning shots to subtitle transcript...');
                const totalDur = wordTimestamps[wordTimestamps.length - 1].end;
                const shots = timelineState.clips.map(c => ({ ...c, text_reference: c.text }));

                const canonicalRanges = alignShotsCanonical(
                    shots,
                    wordTimestamps,
                    (msg, isErr) => ui.logProductionStatus(msg, isErr),
                    totalDur
                );
                const shotStartTimes = canonicalRanges.map(r => r.startTime);
                const perShotWords = sliceTranscriptForShots(shotStartTimes, wordTimestamps, totalDur);

                const updatedClips = timelineState.clips.map((c, i) => {
                    const range = canonicalRanges[i];
                    const sTime = shotStartTimes[i];
                    const eTime = i + 1 < shotStartTimes.length ? shotStartTimes[i + 1] : totalDur;
                    return {
                        ...c,
                        startTime: sTime,
                        endTime: eTime,
                        duration: Math.max(0.05, eTime - sTime),
                        startWordIndex: range?.startWordIndex ?? -1,
                        endWordIndex: range?.endWordIndex ?? -1,
                        alignmentConfidence: range?.alignmentConfidence ?? 0.5,
                        timingSource: 'subtitle' as const,
                        wordTimestamps: perShotWords[i] || [],
                    };
                });

                timelineState.setMode('audio_locked');
                timelineState.setClips(updatedClips);
                normalizeTimeline(totalDur);
                updateVideoContext();
                ui.renderTimelineEditor();
                ui.showStatus('Timeline synced from SRT successfully', false, 3000);
                ui.logProductionStatus('✔️ SRT Sync complete.');
            } else {
                ui.showStatus('SRT loaded, but no shots to sync', false, 3000);
            }
        } catch (err) {
            console.error('Failed to parse SRT:', err);
            ui.logProductionStatus(`❌ Failed to parse SRT: ${err}`, true);
            ui.showStatus('Failed to parse SRT file', true, 4000);
        }
        
        // Reset input
        input.value = '';
    };

    reader.readAsText(file);
}

declare const Shepherd: any; // Shepherd is loaded from a CDN

export async function initializeAppState(forceStart = false) {
    const hasStarted = localStorage.getItem('hasStartedApp') === 'true';
    const isShared = window.location.hostname.includes('-pre-') || window.location.search.includes('shared=true');

    if ((!hasStarted || isShared) && !forceStart) {
        if (dom.landingPage) dom.landingPage.classList.remove('hidden');
        if (dom.appContainer) dom.appContainer.classList.add('hidden');
        
        // If shared, we still want to load the project in the background 
        // so it's ready when they click "Begin"
        await loadProject();
        return;
    }

    if (dom.landingPage) dom.landingPage.classList.add('hidden');
    if (dom.appContainer) dom.appContainer.classList.remove('hidden');
    
    // Initialize credits from saved state or default if not set
    if (state.userCredits === null || state.userCredits === undefined) {
        const savedCredits = localStorage.getItem('userCredits');
        if (savedCredits !== null && !isNaN(Number(savedCredits))) {
            state.userCredits = Number(savedCredits);
        } else {
            state.userCredits = 10000;
        }
    }
    ui.updateCreditsDisplay();
    
    await loadProject();
}

export async function startAppFromLanding() {
    localStorage.setItem('hasStartedApp', 'true');
    await initializeAppState(true);
}

export function exitAppToLanding() {
    if (dom.appContainer) dom.appContainer.classList.add('hidden');
    if (dom.landingPage) dom.landingPage.classList.remove('hidden');
    if (dom.mobileMenu) dom.mobileMenu.classList.add('hidden');
}

export function toggleMobileMenu() {
    dom.mobileMenu?.classList.toggle('hidden');
}

export function adjustDropdownPosition(dropdown: HTMLElement | null, button: HTMLElement | null) {
    if (!dropdown || !button || dropdown.classList.contains('hidden')) return;

    dropdown.style.left = '';
    dropdown.style.right = '';

    const container = document.getElementById('bulk-actions-container') || document.getElementById('panel-storyboard');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = button.getBoundingClientRect();
    const dropdownWidth = dropdown.offsetWidth || 260;

    const spaceToLeft = btnRect.right - containerRect.left;
    const spaceToRight = containerRect.right - btnRect.left;

    // Favor opening to the right (deeper into storyboard side, away from left panel)
    if (spaceToRight >= dropdownWidth) {
        dropdown.style.left = '0';
        dropdown.style.right = 'auto';
    } else if (spaceToLeft >= dropdownWidth) {
        dropdown.style.left = 'auto';
        dropdown.style.right = '0';
    } else {
        dropdown.style.left = '0';
        dropdown.style.right = 'auto';
        dropdown.style.maxWidth = `${Math.max(200, containerRect.width - 16)}px`;
    }

    requestAnimationFrame(() => {
        if (dropdown.classList.contains('hidden')) return;
        const afterRect = dropdown.getBoundingClientRect();
        if (afterRect.left < containerRect.left + 4) {
            const shift = (containerRect.left + 4) - afterRect.left;
            dropdown.style.left = `${shift}px`;
            dropdown.style.right = 'auto';
        } else if (afterRect.right > containerRect.right - 4) {
            const shift = afterRect.right - (containerRect.right - 4);
            dropdown.style.right = `${shift}px`;
            dropdown.style.left = 'auto';
        }
    });
}

export function toggleExportMenu() {
    dom.exportMenuDropdown?.classList.toggle('hidden');
    if (dom.batchToolsDropdown) dom.batchToolsDropdown.classList.add('hidden');
    if (dom.importMenuDropdown) dom.importMenuDropdown.classList.add('hidden');
    if (dom.exportMenuDropdown && !dom.exportMenuDropdown.classList.contains('hidden')) {
        adjustDropdownPosition(dom.exportMenuDropdown, dom.exportMenuBtn);
    }
}

export function toggleBatchToolsMenu() {
    dom.batchToolsDropdown?.classList.toggle('hidden');
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    if (dom.importMenuDropdown) dom.importMenuDropdown.classList.add('hidden');
    if (dom.batchToolsDropdown && !dom.batchToolsDropdown.classList.contains('hidden')) {
        adjustDropdownPosition(dom.batchToolsDropdown, dom.batchToolsMenuBtn);
    }
}

export function toggleImportMenu() {
    dom.importMenuDropdown?.classList.toggle('hidden');
    if (dom.exportMenuDropdown) dom.exportMenuDropdown.classList.add('hidden');
    if (dom.batchToolsDropdown) dom.batchToolsDropdown.classList.add('hidden');
    if (dom.importMenuDropdown && !dom.importMenuDropdown.classList.contains('hidden')) {
        adjustDropdownPosition(dom.importMenuDropdown, dom.importMenuBtn);
    }
}

export function startOnboardingTour() {
    const tour = new Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
            classes: 'shepherd-element', // Uses custom styles from index.css
            cancelIcon: {
                enabled: true
            },
            scrollTo: { behavior: 'smooth', block: 'center' }
        }
    });

    tour.addStep({
        id: 'welcome',
        title: 'Welcome to ContentGen AI!',
        text: 'This quick tour will guide you through the main features to create your first visual story, from script to screen.',
        buttons: [
            {
                action(this: any) {
                    return this.cancel();
                },
                classes: 'shepherd-button-secondary',
                text: 'Exit'
            },
            {
                action(this: any) {
                    return this.next();
                },
                text: 'Start Tour'
            }
        ]
    });

    tour.addStep({
        id: 'story-input',
        title: '1. The Story',
        text: 'Everything starts here. Write, paste, or generate your script in this area. This is the foundation for your entire project.',
        attachTo: {
            element: dom.storyInput,
            on: 'bottom'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.next(); },
                text: 'Next'
            }
        ]
    });

    tour.addStep({
        id: 'pre-production',
        title: '2. Creative Tools',
        text: 'Use these buttons to spark ideas ("Create"), add more detail to your text ("Enhance"), or get visual style suggestions ("Suggest").',
        attachTo: {
            element: '[data-step="1"]',
            on: 'bottom'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.next(); },
                text: 'Next'
            }
        ]
    });

    tour.addStep({
        id: 'consistency',
        title: '3. Visual Consistency',
        text: 'After writing your story, use these tools to identify key characters, locations, and objects. Refining their descriptions here ensures they look the same in every shot.',
        attachTo: {
            element: '[data-step="2"]',
            on: 'bottom'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.next(); },
                text: 'Next'
            }
        ]
    });

    tour.addStep({
        id: 'create-storyboard',
        title: '4. Create the Storyboard',
        text: 'This is the main event! Click this button to have the AI analyze your story and consistency profiles, generating a detailed shot list with image prompts.',
        attachTo: {
            element: dom.analyzeBtn,
            on: 'bottom'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.next(); },
                text: 'Next'
            }
        ]
    });

    tour.addStep({
        id: 'storyboard-panel',
        title: '5. The Storyboard',
        text: 'Your generated shots will appear here. You can edit the prompts, generate images for each shot individually, or use the "Generate All" button.',
        attachTo: {
            element: dom.panelStoryboard,
            on: 'left'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.next(); },
                text: 'Next'
            }
        ]
    });

    tour.addStep({
        id: 'video-director',
        title: '6. Produce the Video',
        text: 'Once your images are generated, click here to enter the AI Video Director. You can generate narration, set timing, add music, and export your final video.',
        attachTo: {
            element: dom.videoDirectorBtn,
            on: 'top'
        },
        buttons: [
            {
                action(this: any) { return this.back(); },
                classes: 'shepherd-button-secondary',
                text: 'Back'
            },
            {
                action(this: any) { return this.complete(); },
                text: 'Finish'
            }
        ]
    });

    tour.start();
}


export function handleConfirm() {
    if (state.confirmCallback) {
        state.confirmCallback();
    }
    ui.hideConfirmation();
}

export function openBuyCreditsModal() {
    if (dom.buyCreditsModal) {
        dom.buyCreditsModal.classList.remove('hidden');
    }
}

export function closeBuyCreditsModal() {
    if (dom.buyCreditsModal) {
        dom.buyCreditsModal.classList.add('hidden');
        resetCheckoutState();
    }
}

let selectedCredits = 0;
let selectedPrice = 0;

export function handleSelectCreditPackage(event: Event) {
    const target = event.currentTarget as HTMLDivElement;
    
    // Deselect all
    dom.creditPackages.forEach(pkg => {
        pkg.classList.remove('border-yellow-500', 'bg-gray-800');
        pkg.classList.add('border-gray-700', 'bg-gray-800/50');
    });
    
    // Select clicked
    target.classList.remove('border-gray-700', 'bg-gray-800/50');
    target.classList.add('border-yellow-500', 'bg-gray-800');
    
    selectedCredits = parseInt(target.dataset.credits || '0');
    selectedPrice = parseInt(target.dataset.price || '0');
    
    if (selectedCredits > 0) {
        dom.checkoutBtn.disabled = false;
        dom.checkoutBtn.classList.remove('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
        dom.checkoutBtn.classList.add('bg-yellow-500', 'text-black', 'hover:bg-yellow-400');
        dom.checkoutBtn.textContent = `Pay $${selectedPrice.toFixed(2)}`;
    }
}

export async function handleCheckout() {
    if (selectedCredits <= 0) return;
    
    dom.checkoutBtn.disabled = true;
    dom.checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
    dom.mockPaymentStatus.classList.remove('hidden');
    
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        state.userCredits = (state.userCredits || 0) + selectedCredits;
        
        ui.showStatus(`Successfully added ${selectedCredits.toLocaleString()} credits!`, false, 3000);
        closeBuyCreditsModal();
    } catch (error) {
        console.error("Error adding credits:", error);
        ui.showStatus("Failed to process payment.", true, 3000);
        
        dom.checkoutBtn.disabled = false;
        dom.checkoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        dom.mockPaymentStatus.classList.add('hidden');
    }
}

function resetCheckoutState() {
    selectedCredits = 0;
    selectedPrice = 0;
    
    dom.creditPackages.forEach(pkg => {
        pkg.classList.remove('border-yellow-500', 'bg-gray-800');
        pkg.classList.add('border-gray-700', 'bg-gray-800/50');
    });
    
    dom.checkoutBtn.disabled = true;
    dom.checkoutBtn.classList.remove('bg-yellow-500', 'text-black', 'hover:bg-yellow-400', 'opacity-50');
    dom.checkoutBtn.classList.add('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
    dom.checkoutBtn.textContent = 'Select a Package';
    
    dom.mockPaymentStatus.classList.add('hidden');
}

export async function handleExportAudioData() {
    try {
        const projectName = state.uploadedAudioFileName ? state.uploadedAudioFileName.replace(/\.[^/.]+$/, "") : 'subtitles';

        // 1. If active timeline has global word timestamps or clips, export from the active timeline!
        if (timelineState.globalWordTimestamps && timelineState.globalWordTimestamps.length > 0) {
            const dataStr = utils.generateSRT(timelineState.globalWordTimestamps, timelineState.clips);
            const blob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
            await utils.downloadBlob(blob, `${utils.sanitizeFilename(projectName)}.srt`);
            ui.showStatus('Exported project subtitles (.srt) successfully.', false, 3000);
            return;
        }

        // 2. If clips have word timestamps, export clip-anchored subtitles
        const allClipWords: WordTimestamp[] = [];
        for (const clip of timelineState.clips || []) {
            if (clip.wordTimestamps && clip.wordTimestamps.length > 0) {
                for (const w of clip.wordTimestamps) {
                    allClipWords.push({
                        word: w.word,
                        start: (clip.startTime || 0) + w.start,
                        end: (clip.startTime || 0) + w.end
                    });
                }
            }
        }
        if (allClipWords.length > 0) {
            const dataStr = utils.generateSRT(allClipWords, timelineState.clips);
            const blob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
            await utils.downloadBlob(blob, `${utils.sanitizeFilename(projectName)}.srt`);
            ui.showStatus('Exported timeline subtitles (.srt) successfully.', false, 3000);
            return;
        }

        // 3. Fallback to transcript cache store in DB, prioritizing current audioAssetId
        const store = await DB.getStore(TRANSCRIPT_CACHE_STORE, 'readonly');
        const countReq = store.count();
        const count = await new Promise<number>((resolve, reject) => {
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(countReq.error);
        });

        if (count === 0) {
            ui.showStatus('No transcript data found. Upload or generate audio first.', true, 3000);
            return;
        }
        
        const req = store.getAll();
        const records = await new Promise<any[]>((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        if (!records || records.length === 0) return;

        let matched = records.find(r => (state.uploadedAudioAssetId && r.audioId === state.uploadedAudioAssetId));
        if (!matched) {
            records.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            matched = records[0];
        }
        
        const dataStr = utils.generateSRT(matched.words || []);
        const blob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
        const exportFileDefaultName = `${utils.sanitizeFilename(matched.filename || projectName || 'deepgram-transcript')}.srt`;
        await utils.downloadBlob(blob, exportFileDefaultName);
        
        ui.showStatus('Exported transcript successfully.', false, 3000);
    } catch (e: any) {
        console.error("Export text failed", e);
        ui.showStatus(`Failed to export transcript: ${e?.message || e}`, true, 3000);
    }
}

