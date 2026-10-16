import { getAudioContext } from './utils';
export function sliceAudioBuffer(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number
): AudioBuffer {
    const audioCtx = getAudioContext();
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const startSample = Math.max(0, Math.min(buffer.length, Math.floor(startSec * sampleRate)));
    const endSample = Math.max(startSample, Math.min(buffer.length, Math.ceil(endSec * sampleRate)));
    const frameCount = Math.max(1, endSample - startSample);

    const newBuffer = audioCtx.createBuffer(channels, frameCount, sampleRate);
    for (let c = 0; c < channels; c++) {
        const sourceData = buffer.getChannelData(c);
        const targetData = newBuffer.getChannelData(c);
        targetData.set(sourceData.subarray(startSample, endSample));
    }
    return newBuffer;
}

export function spliceAudioBuffer(
    buffer: AudioBuffer,
    removeStartSec: number,
    removeEndSec: number
): AudioBuffer {
    const audioCtx = getAudioContext();
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const remStartSample = Math.max(0, Math.min(buffer.length, Math.floor(removeStartSec * sampleRate)));
    const remEndSample = Math.max(remStartSample, Math.min(buffer.length, Math.ceil(removeEndSec * sampleRate)));

    const part1Len = remStartSample;
    const part2Len = Math.max(0, buffer.length - remEndSample);
    const newLen = Math.max(1, part1Len + part2Len);

    const newBuffer = audioCtx.createBuffer(channels, newLen, sampleRate);
    for (let c = 0; c < channels; c++) {
        const sourceData = buffer.getChannelData(c);
        const targetData = newBuffer.getChannelData(c);
        if (part1Len > 0) targetData.set(sourceData.subarray(0, remStartSample), 0);
        if (part2Len > 0) targetData.set(sourceData.subarray(remEndSample), part1Len);
    }
    return newBuffer;
}

