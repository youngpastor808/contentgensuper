/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RENDER_ASSETS_DIR } from '../routes/cloudRender';

const execFileAsync = promisify(execFile);

export async function hasAudioStream(filePath: string): Promise<boolean> {
    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 100) return false;
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_type',
            '-of', 'csv=p=0',
            filePath
        ], { timeout: 10000 });
        return stdout.trim().includes('audio');
    } catch {
        return false;
    }
}

export async function resolveAudioToLocalFile(audioUrl?: string, tmpPrefix = 'worker_audio'): Promise<string | null> {
    if (!audioUrl || typeof audioUrl !== 'string') return null;

    if (fs.existsSync(audioUrl) && fs.statSync(audioUrl).size > 50) {
        return audioUrl;
    }

    if (audioUrl.includes('/api/cloud-render/assets/')) {
        try {
            const urlObj = new URL(audioUrl, 'http://localhost');
            const assetName = path.basename(urlObj.pathname);
            const localAssetPath = path.join(RENDER_ASSETS_DIR, assetName);
            if (fs.existsSync(localAssetPath) && fs.statSync(localAssetPath).size > 50) {
                return localAssetPath;
            }
        } catch {}
    }

    if (audioUrl.startsWith('data:audio/') || audioUrl.startsWith('data:video/')) {
        try {
            const base64Data = audioUrl.replace(/^data:[^;]+;base64,/, '');
            const buf = Buffer.from(base64Data, 'base64');
            const ext = audioUrl.startsWith('data:video/') ? '.mp4' : '.wav';
            const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}${ext}`);
            await fs.promises.writeFile(outPath, buf);
            return outPath;
        } catch {}
    }

    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        try {
            const res = await fetch(audioUrl);
            if (res.ok) {
                const buf = Buffer.from(await res.arrayBuffer());
                let ext = '.wav';
                if (audioUrl.endsWith('.mp3')) ext = '.mp3';
                else if (audioUrl.endsWith('.mp4') || audioUrl.includes('video')) ext = '.mp4';
                else if (audioUrl.endsWith('.aac')) ext = '.aac';
                const outPath = path.join(os.tmpdir(), `${tmpPrefix}_${Date.now()}${ext}`);
                await fs.promises.writeFile(outPath, buf);
                return outPath;
            }
        } catch (fetchErr) {
            console.warn(`[AudioMixer] Could not fetch audio URL ${audioUrl}:`, fetchErr);
        }
    }

    return null;
}

export function toLoopback(url: string | undefined, appBaseUrl: string): string | undefined {
    if (!url) return url;
    try {
        const u = new URL(url);
        const base = new URL(appBaseUrl);
        if (u.pathname.startsWith('/api/cloud-render/assets/')) {
            u.protocol = base.protocol;
            u.host = base.host;
            return u.toString();
        }
    } catch {}
    return url;
}

/**
 * Robust Timeline Audio Mixer:
 * Resolves master narration, background music, AND all video/audio clips where useOriginalAudio or soloAudio is enabled.
 * Accurately cuts, shifts, applies volume/fade, and mixes everything with FFmpeg into a single high-fidelity track.
 */
export async function prepareTimelineAudioMix(
    inputProps: any,
    appBaseUrl: string
): Promise<{ finalAudioPath: string | null; cleanupPaths: string[] }> {
    const cleanupPaths: string[] = [];
    const localMasterAudio = await resolveAudioToLocalFile(
        toLoopback(inputProps.masterAudioUrl || inputProps.audioUrl, appBaseUrl), 'master_audio'
    );
    const localBgAudio = await resolveAudioToLocalFile(
        toLoopback(inputProps.backgroundMusicUrl, appBaseUrl), 'bg_audio'
    );

    const clips = Array.isArray(inputProps.clips) ? inputProps.clips : [];
    const soloClips = clips.filter((c: any) => Boolean(c.soloAudio));
    const hasSolo = soloClips.length > 0;

    let processedMasterAudio: string | null = localMasterAudio;
    // If there are solo clips, mute or duck master narration during those clips
    if (localMasterAudio && hasSolo) {
        const duckedMasterPath = path.join(os.tmpdir(), `master_ducked_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
        cleanupPaths.push(duckedMasterPath);
        try {
            const duckFilters = soloClips.map((sc: any) => {
                const s = Math.max(0, Number(sc.startTime) || 0);
                const e = s + (Number(sc.duration) || 5);
                return `volume=enable='between(t,${s.toFixed(3)},${e.toFixed(3)})':volume=0:eval=frame`;
            }).join(',');

            await execFileAsync('ffmpeg', [
                '-y',
                '-i', localMasterAudio,
                '-filter_complex', duckFilters || 'anull',
                '-c:a', 'pcm_s16le',
                duckedMasterPath
            ], { timeout: 60000 });

            if (fs.existsSync(duckedMasterPath) && fs.statSync(duckedMasterPath).size > 100) {
                processedMasterAudio = duckedMasterPath;
            }
        } catch (e) {
            console.warn('[AudioMixer] Could not apply solo muting on master audio:', e);
        }
    }

    const audioTrackPaths: string[] = [];
    if (processedMasterAudio && fs.existsSync(processedMasterAudio) && fs.statSync(processedMasterAudio).size > 100) {
        audioTrackPaths.push(processedMasterAudio);
    }

    if (localBgAudio && fs.existsSync(localBgAudio) && fs.statSync(localBgAudio).size > 100 && localBgAudio !== processedMasterAudio && !inputProps.timelineHasAudioMixdown) {
        const bgVolume = typeof inputProps.backgroundMusicVolume === 'number' ? inputProps.backgroundMusicVolume : 0.25;
        const totalDuration = Number(inputProps.totalDurationSec) || 30;
        const processedBgPath = path.join(os.tmpdir(), `bg_music_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
        cleanupPaths.push(processedBgPath);
        try {
            await execFileAsync('ffmpeg', [
                '-y',
                '-stream_loop', '-1',
                '-i', localBgAudio,
                '-t', String(totalDuration),
                '-filter_complex', `volume=${bgVolume}`,
                '-c:a', 'pcm_s16le',
                processedBgPath
            ], { timeout: 60000 });
            if (fs.existsSync(processedBgPath) && fs.statSync(processedBgPath).size > 100) {
                audioTrackPaths.push(processedBgPath);
            }
        } catch (e) {
            console.warn('[AudioMixer] Could not process bg audio:', e);
            audioTrackPaths.push(localBgAudio);
        }
    }

    // Extract and position audio for each clip where useOriginalAudio or soloAudio is enabled
    for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const wantsAudio = Boolean(clip.useOriginalAudio || clip.soloAudio);
        const videoSource = clip.videoUrl || clip.secondaryVideoUrl || clip.talkingHeadVideoUrl;

        if (wantsAudio && videoSource) {
            try {
                const localVideoPath = await resolveAudioToLocalFile(
                    toLoopback(videoSource, appBaseUrl), `clip_video_${i}`
                );
                if (localVideoPath && fs.existsSync(localVideoPath) && (await hasAudioStream(localVideoPath))) {
                    const startSec = Math.max(0, Number(clip.startTime) || 0);
                    const durSec = Math.max(0.1, Number(clip.duration) || 5);
                    const offsetSec = Math.max(0, Number(clip.videoStartOffset) || 0);
                    const vol = typeof clip.volume === 'number' ? clip.volume : 1.0;
                    const rate = typeof clip.playbackRate === 'number' && clip.playbackRate > 0 ? clip.playbackRate : 1.0;
                    const fadeIn = Number(clip.fadeIn) || 0;
                    const fadeOut = Number(clip.fadeOut) || 0;

                    const clipWav = path.join(os.tmpdir(), `clip_audio_${i}_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
                    cleanupPaths.push(clipWav);

                    const filterParts: string[] = ['asetpts=PTS-STARTPTS'];
                    if (rate !== 1.0 && rate >= 0.5 && rate <= 2.0) {
                        filterParts.push(`atempo=${rate}`);
                    }
                    if (vol !== 1.0) {
                        filterParts.push(`volume=${vol}`);
                    }
                    if (fadeIn > 0) {
                        const effIn = Math.min(fadeIn, Math.max(0.01, durSec / 2));
                        filterParts.push(`afade=t=in:st=0:d=${effIn.toFixed(3)}`);
                    }
                    if (fadeOut > 0) {
                        const effOut = Math.min(fadeOut, Math.max(0.01, durSec / 2));
                        filterParts.push(`afade=t=out:st=${Math.max(0, durSec - effOut).toFixed(3)}:d=${effOut.toFixed(3)}`);
                    }
                    const delayMs = Math.round(startSec * 1000);
                    if (delayMs > 0) {
                        filterParts.push(`adelay=${delayMs}|${delayMs}`);
                    }
                    filterParts.push(`atrim=0:${(startSec + durSec).toFixed(3)}`);

                    await execFileAsync('ffmpeg', [
                        '-y',
                        '-ss', String(offsetSec),
                        '-t', String((durSec * rate).toFixed(3)),
                        '-i', localVideoPath,
                        '-filter_complex', filterParts.join(','),
                        '-c:a', 'pcm_s16le',
                        clipWav
                    ], { timeout: 60000 });

                    if (fs.existsSync(clipWav) && fs.statSync(clipWav).size > 100) {
                        audioTrackPaths.push(clipWav);
                        console.log(`[AudioMixer] Added clip ${clip.id || i} audio (start: ${startSec}s, dur: ${durSec}s, vol: ${vol})`);
                    }
                }
            } catch (clipAudioErr) {
                console.warn(`[AudioMixer] Failed to extract audio for clip ${clip.id || i}:`, clipAudioErr);
            }
        }

        // Also check if clip has dedicated audioUrl (separate audio attachment)
        if (clip.audioUrl && (!inputProps.timelineHasAudioMixdown || clip.useOriginalAudio)) {
            try {
                const localClipAudioPath = await resolveAudioToLocalFile(
                    toLoopback(clip.audioUrl, appBaseUrl), `clip_audio_${i}`
                );
                if (localClipAudioPath && fs.existsSync(localClipAudioPath) && (await hasAudioStream(localClipAudioPath))) {
                    const startSec = Math.max(0, Number(clip.startTime) || 0);
                    const durSec = Math.max(0.1, Number(clip.duration) || 5);
                    const vol = typeof clip.volume === 'number' ? clip.volume : 1.0;
                    const clipWav = path.join(os.tmpdir(), `clip_audio_direct_${i}_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
                    cleanupPaths.push(clipWav);

                    const filterParts = ['asetpts=PTS-STARTPTS'];
                    if (vol !== 1.0) filterParts.push(`volume=${vol}`);
                    const delayMs = Math.round(startSec * 1000);
                    if (delayMs > 0) filterParts.push(`adelay=${delayMs}|${delayMs}`);
                    filterParts.push(`atrim=0:${(startSec + durSec).toFixed(3)}`);

                    await execFileAsync('ffmpeg', [
                        '-y',
                        '-t', String(durSec),
                        '-i', localClipAudioPath,
                        '-filter_complex', filterParts.join(','),
                        '-c:a', 'pcm_s16le',
                        clipWav
                    ], { timeout: 60000 });

                    if (fs.existsSync(clipWav) && fs.statSync(clipWav).size > 100) {
                        audioTrackPaths.push(clipWav);
                    }
                }
            } catch (clipAudioErr) {
                console.warn(`[AudioMixer] Failed to extract clip.audioUrl for clip ${clip.id || i}:`, clipAudioErr);
            }
        }
    }

    if (audioTrackPaths.length === 0) {
        return { finalAudioPath: null, cleanupPaths };
    }

    if (audioTrackPaths.length === 1) {
        return { finalAudioPath: audioTrackPaths[0], cleanupPaths };
    }

    // Mix all audio tracks together using FFmpeg amix
    const finalMixedWav = path.join(os.tmpdir(), `final_mixed_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    cleanupPaths.push(finalMixedWav);

    try {
        const ffmpegArgs = ['-y'];
        for (const track of audioTrackPaths) {
            ffmpegArgs.push('-i', track);
        }
        ffmpegArgs.push(
            '-filter_complex',
            `amix=inputs=${audioTrackPaths.length}:duration=longest:dropout_transition=0`,
            '-c:a', 'pcm_s16le',
            finalMixedWav
        );

        await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 60000 });

        if (fs.existsSync(finalMixedWav) && fs.statSync(finalMixedWav).size > 100) {
            return { finalAudioPath: finalMixedWav, cleanupPaths };
        }
    } catch (mixErr) {
        console.error('[AudioMixer] Failed to amix audio tracks:', mixErr);
        return { finalAudioPath: audioTrackPaths[0], cleanupPaths };
    }

    return { finalAudioPath: audioTrackPaths[0] || null, cleanupPaths };
}
