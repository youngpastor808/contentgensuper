export interface SubtitleChunk {
    text: string;
    startWordIndex: number;
    endWordIndex: number;
    startIndex?: number;
    endIndex?: number;
}

export interface WordTiming { start: number; end: number; }

/**
 * Same word-count chunking as chunkSubtitleText, but merges chunks whose
 * spoken duration would fall below minDuration into a growing group, so no
 * caption flashes on screen too briefly to read.
 *
 * Tracks the accumulated duration of the group currently being built and
 * stops absorbing more chunks once that group reaches minDuration (with a
 * hard maxDuration ceiling as a safety net) — otherwise a run of many short
 * chunks (e.g. fast-paced narration where a 4-word slice is regularly under
 * minDuration) has nothing to ever stop merging, and the entire remaining
 * line of a shot collapses into one giant on-screen block.
 */
export function chunkSubtitleTextTimed(
    text: string,
    wordTimings: WordTiming[],
    maxWordsPerChunk = 3,
    minDuration = 0.6,
    maxDuration = 2.4,
    maxWordsWhenMerging = 6
): SubtitleChunk[] {
    const base = chunkSubtitleText(text, maxWordsPerChunk);
    if (base.length <= 1 || wordTimings.length === 0) return base;

    function chunkDuration(c: SubtitleChunk): number {
        const startT = wordTimings[c.startWordIndex]?.start;
        const endT = wordTimings[Math.min(c.endWordIndex, wordTimings.length) - 1]?.end;
        return (typeof startT === 'number' && typeof endT === 'number') ? endT - startT : minDuration;
    }

    const merged: SubtitleChunk[] = [];
    let groupDuration = 0;
    let prevWordCount = 0;

    for (const chunk of base) {
        const dur = chunkDuration(chunk);
        const prev = merged[merged.length - 1];
        const curWordCount = chunk.endWordIndex - chunk.startWordIndex;

        if (prev && groupDuration < minDuration && groupDuration + dur <= maxDuration && (prevWordCount + curWordCount <= maxWordsWhenMerging)) {
            // Previous group is still under readable-duration floor — fold this chunk into it
            prev.text = `${prev.text} ${chunk.text}`;
            prev.endWordIndex = chunk.endWordIndex;
            prev.endIndex = chunk.endWordIndex;
            prevWordCount += curWordCount;
            groupDuration += dur;
        } else {
            merged.push({ ...chunk });
            prevWordCount = curWordCount;
            groupDuration = dur;
        }
    }
    return merged;
}

/**
 * Utility to split subtitle text into small readable chunks for display.
 */
export function chunkSubtitleText(text: string, maxWordsPerChunk = 3): SubtitleChunk[] {
    if (!text || !text.trim()) return [];
    
    const words = text.trim().split(/\s+/);
    const chunks: SubtitleChunk[] = [];
    let currentWordIndex = 0;

    for (let i = 0; i < words.length; i += maxWordsPerChunk) {
        const chunkWords = words.slice(i, i + maxWordsPerChunk);
        const chunkText = chunkWords.join(' ');
        const startWordIndex = currentWordIndex;
        const endWordIndex = startWordIndex + chunkWords.length;

        chunks.push({
            text: chunkText,
            startWordIndex,
            endWordIndex,
            startIndex: startWordIndex,
            endIndex: endWordIndex
        });

        currentWordIndex = endWordIndex;
    }

    return chunks;
}
