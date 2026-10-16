import { audioBufferToWavBlob } from './utils-core';
import * as dom from './dom';
import * as ui from './ui';
import { transcribeAudioLocal } from './api/audio';
import * as utils from './utils';
import { state } from './state';
import { timelineState } from './state-timeline';
import { extractTimelineAudioMixdown } from './exporter';
import { alignShotsToTranscript, sliceTranscriptForShots, enforceMonotonicStarts } from './timelineBuilder';
import { buildTimelineFromShotsWithAudio } from './audio-upload-director';

export async function handleTranscribeTimelineMixdown() {
    if (!timelineState.clips || timelineState.clips.length === 0) {
        ui.showStatus("Timeline is empty. Add clips first.", true, 3000);
        return;
    }

    try {
        if (dom.timelineTranscribeBtn) {
            dom.timelineTranscribeBtn.disabled = true;
            dom.timelineTranscribeBtn.innerHTML = `<span>⏳</span><span>Mixing & Transcribing...</span>`;
        }
        ui.showStatus("Mixing timeline audio natively...", false, 3000);

        // 1. Extract audio mixdown
        const mixBuffer = await extractTimelineAudioMixdown(true); // skip BGM
        if (!mixBuffer) {
            ui.showStatus("No extractable audio found in timeline.", true, 3000);
            return;
        }

        ui.showStatus("Converting audio mix...", false, 2000);

        // 2. Convert to File
        const mixWavBlob = await audioBufferToWavBlob(mixBuffer);
        const mixFile = new File([mixWavBlob], "timeline-mix.wav", { type: "audio/wav" });

        ui.showStatus("Transcribing with AI...", false, 4000);

        // 3. Transcribe
        const result = await transcribeAudioLocal(mixFile);
        
        let wordTimestamps: any[] = [];
        let droppedChunks = 0;
        if (result.words && result.words.length > 0) {
            wordTimestamps = result.words;
        } else if (result.chunks && result.chunks.length > 0) {
            // Weight word timings by character length and punctuation pauses so captions
            // stay locked to natural speech cadence without dropping long sentences.
            result.chunks.forEach((chunk: any) => {
                const chunkText = (chunk.text || '').trim();
                const words = chunkText.split(/\s+/).filter(Boolean);
                const [rawStart, rawEnd] = chunk.timestamp || [0, 0];
                if (words.length === 0) return;

                const start = Number(rawStart) || 0;
                const end = Math.max(start + 0.15, Number(rawEnd) || start + Math.max(0.8, words.length * 0.32));
                const dur = end - start;

                // Calculate phonetic weight per word (character count + punctuation pause weight)
                const weights = words.map((w: string) => {
                    let weight = Math.max(1.5, w.replace(/[^a-zA-Z0-9]/g, '').length);
                    if (/[.!?…;—]$/.test(w)) weight += 3.5;
                    else if (/[,:]$/.test(w)) weight += 1.8;
                    return weight;
                });
                const totalWeight = weights.reduce((acc: number, v: number) => acc + v, 0) || 1;

                let cursor = start;
                words.forEach((w: string, idx: number) => {
                    const wordDur = (weights[idx] / totalWeight) * dur;
                    // Hold slightly tighter on punctuation words so the viewer sees the pause
                    const spokenDur = /[.!?…;—]$/.test(w) ? wordDur * 0.78 : wordDur;
                    wordTimestamps.push({
                        word: w,
                        start: Number(cursor.toFixed(3)),
                        end: Number((cursor + Math.max(0.05, spokenDur)).toFixed(3)),
                    });
                    cursor += wordDur;
                });
            });
        }
        
        if (droppedChunks > 0) {
            console.warn(`[TRANSCRIBE] ${droppedChunks} long chunk(s) had no word timestamps — skipped fabrication, gap marked (subtitles absent in those spans).`);
            ui.showStatus(`Transcribed with ${droppedChunks} gap(s) (no word timing) — subtitles may be incomplete.`, true, 4000);
        }
        
        if (wordTimestamps.length === 0) {
            ui.showStatus("Transcription returned no words. Ensure speech is clear.", true, 4000);
            return;
        }

        // 4. Set global timestamps (but NO master audio buffer, so clips keep their native sound)
        timelineState.setGlobalWordTimestamps(wordTimestamps);
        
        // 5. Build timeline from transcript to align clips with words properly, or just apply it?
        // Wait, if the user explicitly mixed down the timeline, their clips ALREADY have the correct durations.
        // We just need to slice the transcript for the shots without moving the clips.
        
        const shotStartTimes = timelineState.clips.map(c => c.startTime);
        const totalDur = mixBuffer.duration;
        const perShotWords = sliceTranscriptForShots(shotStartTimes, wordTimestamps, totalDur);
        
        const newClips = timelineState.clips.map((clip, i) => {
            return {
                ...clip,
                wordTimestamps: perShotWords[i] || [],
                text: perShotWords[i]?.map(w => w.word).join(' ') || ''
            };
        });
        
        timelineState.saveSnapshot();
        timelineState.setClips(newClips);
        
        if (dom.openTranscriptEditorBtn) {
            dom.openTranscriptEditorBtn.disabled = false;
            dom.openTranscriptEditorBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        ui.showStatus(`Successfully transcribed ${wordTimestamps.length} words!`, false, 3000);
        
        const { updateVideoContext } = await import('./videoController');
        updateVideoContext();
        ui.renderTimelineEditor();

    } catch (e: any) {
        console.error("Timeline transcribe error:", e);
        ui.showStatus(`Transcription failed: ${e.message}`, true, 5000);
    } finally {
        if (dom.timelineTranscribeBtn) {
            dom.timelineTranscribeBtn.disabled = false;
            dom.timelineTranscribeBtn.innerHTML = `<span>🎙️</span><span>Transcribe Audio</span>`;
        }
    }
}
