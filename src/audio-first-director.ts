import { audioBufferToWavBlob } from './utils-core';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import * as ui from './ui';
import { forceAlignAudio } from './api/audio';
import * as utils from './utils';
import { updateVideoContext, normalizeTimeline } from './videoController';
import { drawVideoFrame } from './videoRenderer';
import { alignShotsCanonical, alignShotsToTranscript, sliceTranscriptForShots, enforceMonotonicStarts } from './timelineBuilder';
import { generateMasterNarration } from './audioPipeline';
import { spawnTextOverlayGraphics } from './handlers-graphics';

// --- Telemetry ---
interface ProductionMetrics {
    shotCount: number;
    wordCount: number;
    audioDuration: number;
    productionTime: number;
    usedFastPath: boolean;
    syncIntegrity: number; // 0 to 1 scale
}

let productionRunId = 0;

function assertStillRunning(runId: number) {
    if (!state.isVideoProductionRunning || runId !== productionRunId) {
        throw new Error('Stopped.');
    }
}

function getLastProductionMetrics(): any | null {
    return state.lastProductionMetrics;
}

export function finalizeProduction() {
    timelineState.setMode(timelineState.masterAudioBuffer ? 'audio_locked' : 'free');
    normalizeTimeline(timelineState.masterAudioBuffer?.duration);
    timelineState.setVideoGenerated(true);
    updateVideoContext();
    dom.videoCanvas.classList.remove('hidden');
    dom.videoCanvas.style.display = 'block';
    dom.videoPreGenerationOverlay.classList.add('hidden');
    dom.videoControlsContainer.classList.remove('hidden');
    dom.videoPostGenerationOverlay.classList.remove('hidden');
    dom.videoExportBtn.disabled = false;
    dom.magicCameraBtn.disabled = false;
    dom.analyzeTransitionsBtn.disabled = false;
    dom.videoDirectorBtn.disabled = false;
    dom.videoDirectorBtn.classList.remove('opacity-50');
    const totalDuration = timelineState.masterAudioBuffer?.duration ?? 0;
    drawVideoFrame(0);
    ui.renderTimelineEditor();

    const count = spawnTextOverlayGraphics(true); // dryRun
    if (count > 0) {
        ui.showConfirmation('Auto-Spawn Overlays', `The auto-director found ${count} motion text graphics based on your script. Do you want to add them to the timeline now?`, () => {
            spawnTextOverlayGraphics(false);
            ui.renderTimelineEditor();
            ui.hideConfirmation();
        }, () => {
            ui.hideConfirmation();
        });
    }
    setTimeout(() => {
      if (timelineState.clips?.length) {
        const maxWarmup = Math.min(2.0, totalDuration);
        for (let t = 0; t <= maxWarmup; t += 0.15) drawVideoFrame(t);
        drawVideoFrame(0);
      }
    }, 100);
}

export async function handleDirectVideoAudioFirst() {
    const runId = ++productionRunId;

    dom.magicCameraBtn.className = "bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate";
    dom.magicCameraBtn.innerHTML = "<span>🤖 Magic Camera</span>";
    dom.analyzeTransitionsBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
    dom.analyzeTransitionsBtn.classList.add('bg-gray-700', 'hover:bg-gray-600');
    dom.analyzeTransitionsBtn.innerHTML = '<span>✨</span> Analyze Transitions';
    const audioFirstBtn = dom.directVideoAudioFirstBtn;
    const visualFirstBtn = dom.directVideoVisualFirstBtn;
    const log = dom.videoStatusLog;
    if (state.isVideoProductionRunning) {
        state.isVideoProductionRunning = false;
        audioFirstBtn.innerHTML = `<div class="loader small-loader" style="width: 16px; height: 16px;"></div> Stopping...`;
        audioFirstBtn.disabled = true;
        visualFirstBtn.disabled = true;
        return;
    }
    const shotsWithMetadata = state.currentScenes.flatMap((scene, sIdx) => 
        (scene.lines || [scene]).map((line: any, lIdx: number) => ({ ...line, __sceneIndex: sIdx, __lineIndex: lIdx }))
    );
    const shots = shotsWithMetadata.filter(s => !!(s._imageObjectURL || s._videoObjectURL || s.image_id || s.video_id || s.talkingHeadMode === 'full' || s.talkingHeadMode === 'split' || s.talkingHeadMode === 'pip-br' || s.talkingHeadMode === 'pip-bl' || s.talkingHeadMode === 'pip-tr' || s.talkingHeadMode === 'pip-tl'));
    if (shots.length === 0) { ui.showStatus('No shots ready. Generate storyboard media first.', true, 3000); return; }
    const script = shots.map(s => ({
        text: (s.text_reference || s.line_text || "").replace(/<[^>]+>/g, " ").trim(),
        speaker_name: s.speaker_name || "Narrator"
    })).filter(s => s.text.length > 0);
    
    if (script.length === 0) { ui.showStatus('The shots with media have no text to narrate.', true, 4000); return; }
    
    const wordCount = script.reduce((acc, curr) => acc + curr.text.split(/\s+/).filter((w: string) => w.length > 0).length, 0);
    state.isVideoProductionRunning = true;
    ui.setButtonsDisabled(true);
    await ui.openProcessingModal('Audio-First Production', true, 'Stop Processing');
    ui.updateProcessingProgress(1, 'Initializing audio engine...'); // Show immediate progress
    audioFirstBtn.innerHTML = '🛑 Stop Production';
    audioFirstBtn.classList.add('bg-red-600', 'text-white');
    visualFirstBtn.disabled = true;
    if (log) log.innerHTML = '';
    dom.videoStatusIndicator.classList.remove('hidden');
    const addLog = (msg: string, isError = false) => {
        ui.logProductionStatus(msg, isError);
    };
    const startTime = performance.now();
    try {
        addLog(`🚀 Starting Audio-First Production for ${shots.length} shots (${wordCount} words)...`);
        const onNarrationProgress = (progress: number, message: string) => {
            // Narration takes up the first 60% of the progress.
            ui.updateProcessingProgress(Math.max(1, progress * 0.6), message);
        };
        const { masterBuffer, fullTranscript, assetId } = await generateMasterNarration(script as any, addLog, onNarrationProgress, true);
        assertStillRunning(runId);
        if (!masterBuffer) throw new Error("Audio generation failed or was cancelled.");
        
        timelineState.setMasterAudioBuffer(masterBuffer);
        timelineState.setMasterAudioAssetId(assetId || null);
        timelineState.setGraphics([]);
        if (assetId) state.uploadedAudioAssetId = assetId;
        const totalDur = masterBuffer.duration;
        addLog(`🎵 Master audio ready: ${(totalDur ?? 0).toFixed(2)}s total duration.`);
        const silences = utils.detectSilences(masterBuffer);
        timelineState.setGlobalSilences(silences);
        addLog(`📝 Syncing visuals to speech transcript (${shots.length} shots)...`);
        
        const { counts, total: totalWords } = utils.computeWordCounts(shots);

        let audioTimingProvenance: 'deepgram' | 'forced_alignment' | 'synthetic' = 'deepgram';

        if (!fullTranscript || fullTranscript.length === 0) {
            addLog('⚠️ Word timestamps missing from narration. Attempting acoustic forced alignment...', true);
            const wavBlob = audioBufferToWavBlob(timelineState.masterAudioBuffer!);
            const audioFile = new File([wavBlob], "master.wav", { type: "audio/wav" });
            try {
                const scriptText = script.map(s => s.text).join(' ');
                const fallbackTranscript = await forceAlignAudio(audioFile, scriptText, (p, m) => ui.updateProcessingProgress(60 + (p * 0.3), m), undefined);
                assertStillRunning(runId);
                if (!fallbackTranscript || fallbackTranscript.length === 0) throw new Error("Acoustic forced alignment returned empty.");
                timelineState.setGlobalWordTimestamps(fallbackTranscript);
                audioTimingProvenance = 'forced_alignment';
                addLog(`✅ Acoustic forced alignment succeeded (${fallbackTranscript.length} words).`);
            } catch (e: any) {
                addLog(`🛑 Audio-locked alignment failed: ${e.message}`, true);
                timelineState.setGlobalWordTimestamps([]);
                throw new Error('Audio-locked timeline cannot be created because reliable word timestamps are unavailable.');
            }
        } else {
            timelineState.setGlobalWordTimestamps(fullTranscript);
            audioTimingProvenance = 'deepgram';
        }

        const transcriptWords = timelineState.globalWordTimestamps || [];
        let shotStartTimes: number[];
        let perShotWords: any[][];
        let syncIntegrity = 0;

        let canonicalRanges: any[] = [];
        if (transcriptWords.length > 0) {
            const transcriptDuration = Math.max(...transcriptWords.map(w => w.end));
            const timingDrift = Math.abs(transcriptDuration - totalDur);
            syncIntegrity = Math.max(0, 1 - (timingDrift / totalDur));
            const syncHealthPercent = Number.isFinite(syncIntegrity * 100) ? syncIntegrity * 100 : 0;
            let healthColor = syncHealthPercent >= 95 ? 'text-green-400' : (syncHealthPercent >= 90 ? 'text-amber-400' : 'text-red-400');
            addLog(`<span class="font-bold">Sync Health:</span> <span class="${healthColor}">${(syncHealthPercent ?? 0).toFixed(1)}%</span>`);
            
            canonicalRanges = alignShotsCanonical(shots, transcriptWords, addLog, totalDur, { silences, timingSource: audioTimingProvenance });
            shotStartTimes = canonicalRanges.map(r => r.startTime);
            perShotWords = sliceTranscriptForShots(shotStartTimes, transcriptWords, totalDur);
        } else {
            // Fallback: Distribute images proportionally based on the word count of each shot
            addLog(`⚠️ <span class="text-amber-400">Audio narration has no word transcript. Export will require transcript alignment or manual sync.</span>`, true);
            const { counts, total: totalWords } = utils.computeWordCounts(shots);
            let current = 0;
            shotStartTimes = shots.map((_, i) => {
                const s = current;
                current += (totalWords > 0) ? (counts[i] / totalWords) * totalDur : (totalDur / shots.length);
                return s;
            });
            shotStartTimes = enforceMonotonicStarts(shotStartTimes, 0.05, Math.max(0, totalDur - 0.05));
            perShotWords = shots.map(() => []);
        }
        
      if (dom.openTranscriptEditorBtn) {
        dom.openTranscriptEditorBtn.disabled = false;
        dom.openTranscriptEditorBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
        
        const assemblingStartProgress = 90;
        ui.updateProcessingProgress(assemblingStartProgress, 'Assembling timeline clips...');
        assertStillRunning(runId);

        const newClips = [];
        for (let i = 0; i < shots.length; i++) {
            const shot = shots[i];
            const range = canonicalRanges[i];
            assertStillRunning(runId);

            let videoEl: HTMLVideoElement | undefined = undefined;
            let img = null;
            try {
                if (shot._videoObjectURL) {
                    videoEl = await utils.loadVideoElement(shot._videoObjectURL);
                    if (shot._imageObjectURL) {
                        try { img = await utils.loadImageOrThrow(shot._imageObjectURL); } catch (imgErr) { console.warn("Failed to preload fallback image:", imgErr); }
                    }
                } else if (shot._imageObjectURL) {
                    img = await utils.loadImageOrThrow(shot._imageObjectURL);
                }
            } catch (e) {
                console.error("Failed to load visual for clip", e);
                if (shot._imageObjectURL) {
                    try { img = await utils.loadImageOrThrow(shot._imageObjectURL); } catch (imgErr) { console.warn("Failed to load fallback image:", imgErr); }
                }
            }

            const startTime = shotStartTimes[i];
            const nextStartTime = (i + 1 < shots.length) ? shotStartTimes[i+1] : totalDur;
            const endTime = nextStartTime;
            
            newClips.push({
                id: shot.id || `s${shot.__sceneIndex}_l${shot.__lineIndex}`,
                image: img || undefined,
                videoElement: videoEl,
                _videoObjectURL: shot._videoObjectURL,
                _imageObjectURL: shot._imageObjectURL,
                image_id: shot.image_id,
                video_id: shot.video_id,
                videoStartOffset: (shot as any).videoStartOffset || 0,
                talkingHeadMode: (shot as any).talkingHeadMode,
                talkingHeadSize: (shot as any).talkingHeadSize,
                useOriginalAudio: (shot as any).useOriginalAudio,
                duration: Math.max(0.05, endTime - startTime),
                startTime,
                endTime,
                startWordIndex: range?.startWordIndex ?? (transcriptWords.length > 0 ? null : -1),
                endWordIndex: range?.endWordIndex ?? (transcriptWords.length > 0 ? null : -1),
                alignmentConfidence: range?.alignmentConfidence ?? (transcriptWords.length > 0 ? 0.5 : 0.0),
                textMatchConfidence: range?.textMatchConfidence ?? range?.alignmentConfidence ?? (transcriptWords.length > 0 ? 0.5 : 0.0),
                timingReliability: range?.timingReliability ?? (transcriptWords.length > 0 ? 0.85 : 0.2),
                timingProvenance: range?.timingProvenance ?? (transcriptWords.length > 0 ? 'acoustic_word' : 'synthetic_fallback'),
                timingSource: range?.timingSource ?? (range ? audioTimingProvenance : 'synthetic'),
                cameraMovement: shot.camera_movement || 'static',
                focalPoint: shot.focalPoint,
                transitionToNext: 'cut',
                text: shot.text_reference || shot.line_text || "",
                wordTimestamps: perShotWords[i] || []
            });

            const progress = assemblingStartProgress + ((i + 1) / shots.length) * 9; // 90% to 99%
            ui.updateProcessingProgress(progress, `Assembling clip ${i + 1}/${shots.length}...`);
        }

        timelineState.setClips(newClips);
        
        finalizeProduction();
        state.lastProductionMetrics = { shotCount: shots.length, wordCount, audioDuration: totalDur, productionTime: (performance.now() - startTime) / 1000, usedFastPath: true, syncIntegrity };
        addLog(`✔️ Production complete in ${((performance.now() - startTime) / 1000).toFixed(1)}s.`);
    } catch (err: any) { addLog(err.message === "Stopped." ? "🛑 Production cancelled." : `❌ Error: ${err.message}`, true); }
    finally { state.isVideoProductionRunning = false; audioFirstBtn.disabled = false; visualFirstBtn.disabled = false; audioFirstBtn.innerHTML = '<span>🎙️</span><span>Generate Narration Audio</span>'; audioFirstBtn.classList.remove('bg-red-600', 'text-white'); dom.videoStatusIndicator.classList.add('hidden'); ui.closeProcessingModal(); }
}