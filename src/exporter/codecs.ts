/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as dom from '../dom';


export function calculateBitrate(width: number, height: number, fps: number, format?: 'mp4' | 'webm'): number {
    const pixelCount = width * height;
    
    let bpp = 0.075;
    
    const quality = dom.videoExportQualitySelect ? dom.videoExportQualitySelect.value : 'medium';
    if (quality === 'low') bpp = 0.045;
    else if (quality === 'high') bpp = 0.12;
    
    let bitrate = pixelCount * fps * bpp;
    
    if (format === 'webm') {
        bitrate *= 0.7;
    }
    
    const MIN_BITRATE = 1_000_000;
    const MAX_BITRATE = 40_000_000;
    
    return Math.max(MIN_BITRATE, Math.min(MAX_BITRATE, Math.floor(bitrate)));
}


export function getAvcLevelForResolution(width: number, height: number, fps: number): string {
    const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
    const mbsPerSecond = macroblocks * fps;
    if (mbsPerSecond <= 40500) return '1E';
    if (mbsPerSecond <= 108000) return '1F';
    if (mbsPerSecond <= 245760) return '28';
    if (mbsPerSecond <= 589824) return '32';
    return '33';
}


const _verifiedCodecCache = new Map<string, { encoderCodec: string, muxerCodec: string, hardwareAcceleration: 'prefer-hardware' | 'prefer-software' }>();

export async function selectSupportedVideoCodec(
    format: string, width: number, height: number, bitrate: number, fps: number,
    preferHardware: boolean = true
): Promise<{ encoderCodec: string, muxerCodec: string, hardwareAcceleration: 'prefer-hardware' | 'prefer-software' }> {
    const cacheKey = `${format}-${width}x${height}@${fps}-${bitrate}-${preferHardware ? 'hw' : 'sw'}`;
    const cached = _verifiedCodecCache.get(cacheKey);
    if (cached) return cached;

    let candidates: { encoderCodec: string, muxerCodec: string }[] = [];
    if (format === 'mp4') {
        const levelHex = getAvcLevelForResolution(width, height, fps);
        candidates = [
            // Standard H.264 / AVC profiles with maximum compatibility
            { encoderCodec: `avc1.4d00${levelHex}`, muxerCodec: 'avc' },
            { encoderCodec: `avc1.42E0${levelHex}`, muxerCodec: 'avc' },
            { encoderCodec: 'avc1.42E01F', muxerCodec: 'avc' }
        ];
    } else {
        candidates = [
            { encoderCodec: 'vp09.00.10.08', muxerCodec: 'vp9' },
            { encoderCodec: 'vp8', muxerCodec: 'vp8' }
        ];
    }

    // Try hardware first for speed; fall back to software per-candidate if the
    // browser reports it unsupported. A capability check alone can't catch every
    // driver-crash case (see the retry wrapper in handleExportVideo for that).
    const modes: ('prefer-hardware' | 'prefer-software')[] = preferHardware
        ? ['prefer-hardware', 'prefer-software']
        : ['prefer-software'];

    for (const mode of modes) {
        for (const candidate of candidates) {
            try {
                const support = await VideoEncoder.isConfigSupported({ 
                    codec: candidate.encoderCodec, 
                    width, 
                    height, 
                    bitrate, 
                    framerate: fps,
                    hardwareAcceleration: mode
                });

                console.log('[EXPORT] Codec test:', candidate.encoderCodec, mode, support);

                if (support.supported) {
                    console.log('[EXPORT] Using codec:', candidate.encoderCodec, mode);
                    const result = { ...candidate, hardwareAcceleration: mode };
                    _verifiedCodecCache.set(cacheKey, result);
                    return result;
                }
            } catch (error) {
                console.error('[EXPORT] Codec test failed:', candidate.encoderCodec, mode, error);
            }
        }
    }
    throw new Error(`No supported video codec found for ${format} at ${width}x${height}@${fps}fps`);
}


export async function selectSupportedAudioCodec(format: string, sampleRate: number, channels: number, bitrate: number): Promise<string> {
    const candidates = format === 'mp4'
        ? ['mp4a.40.2', 'mp4a.40.5']
        : ['opus'];

    for (const codec of candidates) {
        try {
            const support = await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: channels, bitrate });
            if (support.supported) return codec;
        } catch (e) {
            console.warn(`Audio codec '${codec}' support check error:`, e);
        }
    }
    throw new Error(`No supported audio codec found for ${format}.`);
}
