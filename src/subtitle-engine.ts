/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import {
    KaraokeRenderer,
    CinematicRenderer,
    YellowBoxRenderer,
    TikTokRenderer,
    AnimeRenderer,
    NeonRenderer,
    TypewriterRenderer,
    HormoziRenderer,
    MrBeastRenderer,
    MinimalEditorialRenderer,
    TerminalRenderer,
    BilingualRenderer,
    KineticGoldRenderer,
    SubtitleColorPresets
} from './subtitle-styles';
import { LRUCache } from './lru-cache';
import { chunkSubtitleText, chunkSubtitleTextTimed, SubtitleChunk } from './subtitle-chunker';
import { timelineState } from './state-timeline';

export { SubtitleColorPresets };

// ---------------------------------------------------------------------------
// TYPE DEFINITIONS
// ---------------------------------------------------------------------------

const POWER_WORDS = new Set([
  'SECRET', 'MONEY', 'CASH', 'MILLION', 'BILLION', 'KILLER', 'NEVER', 'ALWAYS',
  'INSANE', 'CRAZY', 'HUGE', 'WARNING', 'STOP', 'FREE', 'BEST', 'WORST',
  'URGENT', 'SHOCKING', 'MASSIVE', 'PROVEN', 'HACK', 'TRICK', 'WIN', 'RICH', 'PROFIT'
]);

export function detectWordEmphasis(rawWord: string): boolean {
  if (!rawWord) return false;
  const clean = rawWord.replace(/[^a-zA-Z0-9$%!]/g, '').trim();
  if (!clean) return false;
  if (/^\$?[0-9]+([.,][0-9]+)?%?$/.test(clean)) return true; // Numbers / percentages / currencies like $100, 50%, 10M
  if (clean.length >= 3 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) return true; // ALL CAPS in original script
  return POWER_WORDS.has(clean.toUpperCase());
}

export interface LayoutWord {
    text: string;
    x: number;
    y: number;
    width: number;
    charWidths: number[];
    graphemes?: string[];
    isEmphasized?: boolean;
}

export interface SubtitleLayout {
    lines: {
        words: LayoutWord[];
        y: number;
    }[];
    totalWords: number;
    totalChars: number;
    plainText: string;
    fontSize: number;
    lineHeight: number;
    spaceWidth: number;
}

export interface StyleTypography {
    fontFamily?: string;   // overrides user font
    fontWeight?: number | string;
    sizeScale?: number;
    letterSpacing?: string;   // em or px — wide tracking, film-credit feel
    transform?: 'uppercase' | 'none';
}

export interface SubtitleRenderContext {
    fontSize: number;
    lineHeight: number;
    activeWordIndex: number;
    width: number;
    height: number;
    colors: Record<string, string>;
    hasTimestamps: boolean;
    clipTime: number;
    isPlaying?: boolean;
}

export interface SubtitleStyle {
    draw: (ctx: CanvasRenderingContext2D, layout: SubtitleLayout, progress: number, options: SubtitleRenderContext) => void;
}

export interface SubtitleDrawOptions {
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any;
    text: string;
    progress: number;
    width: number;
    height: number;
    style?: string;
    /** @deprecated Use `style` instead */
    styleName?: string;
    colors?: any;
    /** @deprecated Use `colors` instead */
    customColors?: any;
    forcedWordIndex?: number;
    /** @deprecated Use `forcedWordIndex` instead */
    activeWordIndex?: number;
    hasTimestamps?: boolean;
    position?: 'bottom' | 'center' | 'top';
    clipTime?: number;
    wordTimestamps?: { word: string; start: number; end: number }[] | null;
    isPlaying?: boolean;
}

// ---------------------------------------------------------------------------
// INTERNAL STATE & CACHING
// ---------------------------------------------------------------------------

const layoutCache = new LRUCache<string, SubtitleLayout>(200);
const chunkCache = new LRUCache<string, SubtitleChunk[]>(200);
const heightOffsetCache = new LRUCache<string, number>(50);

// Static styles with no per-word active animation that can be cached to offscreen bitmaps
const STATIC_STYLES = new Set(['cinematic', 'anime', 'yellow_box']);

// Note on resolution / DPR: Bitmap cache is keyed on width, height, position, font, and color signature.
// Preview and export resolutions receive separate cached entries.
// If window.devicePixelRatio scaling is ever applied to preview canvases in the future,
// include window.devicePixelRatio in the bitmap cache key.
interface BitmapCacheEntry {
    canvas: HTMLCanvasElement;
    y: number;
    lastUsed: number;
}
const bitmapCache = new LRUCache<string, BitmapCacheEntry>(60, (_key, entry) => {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
});

let lastCustomColors: any = null;
let lastColorSig = '';

function getColorsSignature(colors: any): string {
    if (colors !== lastCustomColors) {
        lastCustomColors = colors;
        try {
            lastColorSig = JSON.stringify(colors ?? {});
        } catch {
            lastColorSig = '';
        }
    }
    return lastColorSig;
}

// Performance monitoring
interface RenderStats {
    avgFrameTime: number;
    maxFrameTime: number;
    frameCount: number;
    cacheHitRate: number;
}

let renderStats: RenderStats = {
    avgFrameTime: 0,
    maxFrameTime: 0,
    frameCount: 0,
    cacheHitRate: 0
};
let frameTimes: number[] = [];
let cacheHits = 0;
let cacheMisses = 0;
let lastSlowWarnTime = 0;

function recordFrameTime(startTime: number, styleName: string, wordCount: number) {
    const frameTime = performance.now() - startTime;
    frameTimes.push(frameTime);
    if (frameTimes.length > 60) frameTimes.shift();
    
    renderStats.frameCount++;
    renderStats.avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    renderStats.maxFrameTime = Math.max(...frameTimes);
    if (cacheHits + cacheMisses > 0) {
        renderStats.cacheHitRate = cacheHits / (cacheHits + cacheMisses);
    }
    
    const now = performance.now();
    if (renderStats.avgFrameTime > 20 && renderStats.frameCount > 30 && (!lastSlowWarnTime || now - lastSlowWarnTime > 5000)) {
        lastSlowWarnTime = now;
        console.warn(
            `⚠️ Slow subtitle render average: ${renderStats.avgFrameTime.toFixed(2)}ms (target: <16.67ms), ` +
            `Style: ${styleName}, Words: ${wordCount}, Cache hit rate: ${(renderStats.cacheHitRate * 100).toFixed(1)}%`
        );
    }
}

// ---------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------

export function resolveSubtitleFont(text: string, requestedFont?: string): string {
    if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(text)) return '"Noto Sans JP", sans-serif';
    if (/[\u0600-\u06FF]/.test(text)) return '"Noto Sans Arabic", sans-serif';
    if (/[\u0400-\u04FF\u0100-\u024F\u1E00-\u1EFF]/.test(text) === false && /[^\x00-\x7F]/.test(text)) return '"Noto Sans", sans-serif';
    
    const fontName = requestedFont || timelineState.videoSubtitleFont || 'Montserrat';
    if (fontName.startsWith('"') || fontName.startsWith("'")) {
        return `${fontName}, sans-serif`;
    }
    return `"${fontName}", sans-serif`;
}

/** Precompute text layout: wrapping, positioning, grapheme metrics, and emphasis. */
function precomputeLayout(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
    text: string,
    width: number,
    height: number,
    maxLines: number = 2,
    position: 'bottom' | 'center' | 'top' = 'bottom',
    needsCharWidths: boolean = false,
    fontFamily?: string,
    emphasisMap?: boolean[],
    typography?: StyleTypography
): SubtitleLayout {
    const words = text.split(/\s+/).filter(Boolean);

    const sizeScale = typography?.sizeScale ?? 1.0;
    const weight = typography?.fontWeight ?? 800;
    const family = typography?.fontFamily ?? resolveSubtitleFont(text, fontFamily);

    if (words.length === 0) {
        const fallbackFontSize = Math.floor(height * 0.05 * sizeScale);
        return {
            lines: [],
            totalWords: 0,
            totalChars: 0,
            plainText: text,
            fontSize: fallbackFontSize,
            lineHeight: Math.floor(fallbackFontSize * 1.2),
            spaceWidth: fallbackFontSize * 0.25
        };
    }

    const isVertical = height > width;
    const plainText = text;
    let fontSize = Math.floor((isVertical ? Math.floor(width * 0.062) : Math.floor(height * 0.05)) * sizeScale);
    const minFontSize = Math.floor((isVertical ? Math.floor(width * 0.038) : Math.floor(height * 0.03)) * sizeScale);
    let layout: SubtitleLayout | null = null;
    let lineHeight = fontSize * 1.2;

    if (typography?.letterSpacing && 'letterSpacing' in ctx) {
        (ctx as any).letterSpacing = typography.letterSpacing;
    } else if ('letterSpacing' in ctx && (ctx as any).letterSpacing !== '0px' && (ctx as any).letterSpacing !== 'normal') {
        (ctx as any).letterSpacing = 'normal';
    }

    while (fontSize >= minFontSize) {
        lineHeight = fontSize * 1.2;
        const maxWidth = width * 0.8;

        ctx.font = `${weight} ${fontSize}px ${family}`;
        const spaceWidth = ctx.measureText(" ").width;

        layout = {
            lines: [],
            totalWords: words.length,
            totalChars: plainText.length,
            plainText,
            fontSize,
            lineHeight,
            spaceWidth
        };

        const measuredWords: LayoutWord[] = words.map((word, idx) => {
            const w = ctx.measureText(word).width;
            const graphemes = [...word];
            const charWidths = needsCharWidths ? graphemes.map(c => ctx.measureText(c).width) : [];
            const isEmphasized = (emphasisMap && idx < emphasisMap.length) ? emphasisMap[idx] : false;
            return { text: word, x: 0, y: 0, width: w, charWidths, graphemes, isEmphasized };
        });

        const totalSingleLineWidth =
            measuredWords.reduce((s, w) => s + w.width, 0) + spaceWidth * Math.max(0, measuredWords.length - 1);

        let fits = true;

        // Editorial balanced 2-line split: avoid 1-word orphans when wrapping 4+ words across 2 lines
        if (maxLines >= 2 && totalSingleLineWidth > maxWidth && measuredWords.length >= 4) {
            let bestSplit = -1;
            let bestDiff = Infinity;
            for (let split = 1; split < measuredWords.length; split++) {
                const line1Words = measuredWords.slice(0, split);
                const line2Words = measuredWords.slice(split);
                const w1 = line1Words.reduce((s, w) => s + w.width, 0) + spaceWidth * (line1Words.length - 1);
                const w2 = line2Words.reduce((s, w) => s + w.width, 0) + spaceWidth * (line2Words.length - 1);
                if (w1 <= maxWidth && w2 <= maxWidth) {
                    const diff = Math.abs(w1 - w2);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        bestSplit = split;
                    }
                }
            }
            if (bestSplit !== -1) {
                layout.lines.push({ words: measuredWords.slice(0, bestSplit), y: 0 });
                layout.lines.push({ words: measuredWords.slice(bestSplit), y: 0 });
            }
        }

        // Standard greedy wrap if single line or 3-line vertical layout
        if (layout.lines.length === 0) {
            let currLine: LayoutWord[] = [];
            let currWidth = 0;
            let lineCount = 0;

            for (const mw of measuredWords) {
                if (currWidth + mw.width + spaceWidth > maxWidth && currLine.length > 0) {
                    layout.lines.push({ words: currLine, y: 0 });
                    lineCount++;
                    if (lineCount >= maxLines) {
                        fits = false;
                        break;
                    }
                    currLine = [];
                    currWidth = 0;
                }
                if (lineCount < maxLines) {
                    currLine.push(mw);
                    currWidth += mw.width + spaceWidth;
                }
            }
            if (currLine.length > 0 && lineCount < maxLines) {
                layout.lines.push({ words: currLine, y: 0 });
            }
        }

        if (fits || fontSize === minFontSize) {
            if (!fits) {
                const displayedWordsArray = layout.lines.flatMap(l => l.words);
                const displayedWordsCount = displayedWordsArray.length;
                if (displayedWordsCount < layout.totalWords) {
                    layout.totalWords = displayedWordsCount;
                    const displayedWords = displayedWordsArray.map(w => w.text);
                    const displayedText = displayedWords.join(' ');
                    layout.plainText = displayedText;
                    layout.totalChars = displayedText.length;
                }
            }

            const totalHeight = layout.lines.length * lineHeight;
            let y: number;
            if (position === 'top') {
                y = (height * 0.12) + (fontSize / 2);
            } else if (position === 'center') {
                y = (height * 0.50) - (totalHeight / 2) + (fontSize / 2);
            } else {
                const BOTTOM_ANCHOR = 0.80;
                y = (height * BOTTOM_ANCHOR) - (totalHeight / 2);
            }

            for (const line of layout.lines) {
                line.y = y;
                const lineWidth =
                    line.words.reduce((sum, w) => sum + w.width, 0) +
                    spaceWidth * (line.words.length - 1);

                let x = Math.max(width * 0.05, (width / 2) - lineWidth / 2);
                for (const word of line.words) {
                    word.x = x + word.width / 2;
                    word.y = y;
                    x += word.width + spaceWidth;
                }
                y += lineHeight;
            }
            break;
        }

        fontSize -= 2;
    }

    return layout!;
}

// Pre-render static text styles to cropped offscreen canvas (saves memory and avoids full-screen allocations)
function prerenderStaticText(
    styleName: string,
    layout: SubtitleLayout,
    width: number,
    height: number,
    colors: any,
    fontSize: number,
    typography?: StyleTypography,
    activeWordIndex: number = -1
): { canvas: HTMLCanvasElement; y: number } {
    const offscreen = document.createElement('canvas');
    const firstY = layout.lines.length > 0 ? layout.lines[0].y : height * 0.8;
    const lastY = layout.lines.length > 0 ? layout.lines[layout.lines.length - 1].y : firstY;
    
    // Generous padding around the lines to capture thick strokes, drop shadows, and pill boxes
    const pad = Math.ceil(layout.lineHeight * 1.2);
    const startY = Math.max(0, Math.floor(firstY - pad));
    const endY = Math.min(height, Math.ceil(lastY + pad));
    const cropHeight = Math.max(1, endY - startY);

    offscreen.width = width;
    offscreen.height = cropHeight;
    
    const ctx = offscreen.getContext('2d', { 
        alpha: true,
        willReadFrequently: false
    })!;
    
    const weight = typography?.fontWeight ?? 800;
    const family = typography?.fontFamily ?? resolveSubtitleFont(layout.plainText);
    ctx.font = `${weight} ${fontSize}px ${family}`;
    if (typography?.letterSpacing && 'letterSpacing' in ctx) {
        (ctx as any).letterSpacing = typography.letterSpacing;
    }
    
    const entry = SubtitleEngine._registry.get(styleName);
    if (!entry) return { canvas: offscreen, y: startY };
    
    const options: SubtitleRenderContext = {
        fontSize,
        lineHeight: layout.lineHeight,
        activeWordIndex,
        width,
        height: cropHeight,
        colors,
        hasTimestamps: activeWordIndex !== -1,
        clipTime: 0,
        isPlaying: false
    };
    
    ctx.save();
    ctx.translate(0, -startY);
    entry.renderer.draw(ctx, layout, 1.0, options);
    ctx.restore();

    return { canvas: offscreen, y: startY };
}

// ---------------------------------------------------------------------------
// SUBTITLE ENGINE CORE
// ---------------------------------------------------------------------------

export const SubtitleEngine = {
    _registry: new Map<string, { renderer: SubtitleStyle; defaultConfig: any; typography?: StyleTypography }>(),

    registerStyle(name: string, renderer: SubtitleStyle, defaultConfig: any, typography?: StyleTypography) {
        this._registry.set(name, { renderer, defaultConfig, typography });
    },

    getSubtitleHeightOffset(
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any,
        text: string,
        width: number,
        height: number,
        position: 'bottom' | 'center' | 'top',
        styleName?: string
    ): number {
        if (!text || position !== 'bottom') return 0;
        const entry = styleName ? this._registry.get(styleName) : null;
        const sizeScale = entry?.typography?.sizeScale ?? 1.0;
        const font = entry?.typography?.fontFamily || timelineState.videoSubtitleFont || 'Montserrat';
        const key = `${width}-${height}-${font}-${sizeScale}`;
        let offset = heightOffsetCache.get(key);
        if (offset === undefined) {
            // Cheap approximation matching rendered chunks (chunks are ≤4 words ≈ 1 line on landscape, 2 lines on vertical portrait).
            // Avoids full word-wrap + measureText per frame and prevents canvas font state mutation.
            const isVertical = height > width;
            const fontSize = Math.floor((isVertical ? Math.floor(width * 0.062) : Math.floor(height * 0.05)) * sizeScale);
            const lines = isVertical ? 2 : 1;
            offset = Math.round(lines * fontSize * 1.2 + height * 0.08);
            heightOffsetCache.set(key, offset);
        }
        return offset;
    },

    draw(
        ctxOrOptions: CanvasRenderingContext2D | SubtitleDrawOptions,
        text?: string,
        progress: number = 0,
        width: number = 1920,
        height: number = 1080,
        styleName: string = 'anime',
        customColors: any = {},
        forcedWordIndex: number = -1,
        hasTimestamps: boolean = false,
        position: 'bottom' | 'center' | 'top' = 'bottom',
        clipTime: number = 0,
        wordTimestamps: { word: string; start: number; end: number }[] | null = null,
        isPlaying: boolean = false
    ) {
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any;
        const isOptionsObject = ctxOrOptions && typeof ctxOrOptions === 'object' && 'ctx' in ctxOrOptions && 'text' in ctxOrOptions;
        if (isOptionsObject) {
            const opts = ctxOrOptions as SubtitleDrawOptions;
            ctx = opts.ctx;
            text = opts.text;
            progress = opts.progress;
            width = opts.width;
            height = opts.height;
            styleName = opts.style || opts.styleName || 'anime';
            customColors = opts.colors || opts.customColors || {};
            forcedWordIndex = (opts.forcedWordIndex !== undefined) ? opts.forcedWordIndex : (opts.activeWordIndex ?? -1);
            hasTimestamps = !!opts.hasTimestamps;
            position = opts.position || 'bottom';
            clipTime = opts.clipTime ?? 0;
            wordTimestamps = opts.wordTimestamps ?? null;
            isPlaying = opts.isPlaying ?? false;
        } else {
            ctx = ctxOrOptions as any;
        }

        const startTime = performance.now();
        if (!text) return;

        const cleanText = text
            .replace(/<break[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!cleanText) return;

        // Bug 3 fix: Include timing signature in chunk cache key to prevent collision when audio timings change
        const timingSig = (wordTimestamps && wordTimestamps.length > 0)
            ? `${wordTimestamps.length}:${wordTimestamps[0].start.toFixed(2)}:${wordTimestamps[wordTimestamps.length - 1].end.toFixed(2)}`
            : '';
        const chunkKey = timingSig ? `${cleanText}::${timingSig}` : cleanText;

        let chunks = chunkCache.get(chunkKey);
        if (!chunks) {
            chunks = wordTimestamps
                ? chunkSubtitleTextTimed(cleanText, wordTimestamps)
                : chunkSubtitleText(cleanText);
            chunkCache.set(chunkKey, chunks);
        }

        let displayText = cleanText;
        let globalActiveWordIndex = -1;

        if (hasTimestamps) {
            globalActiveWordIndex = forcedWordIndex;
        } else {
            // Determine global active word based on character progress
            const words = cleanText.split(/\s+/);
            const totalChars = cleanText.length;
            const charProgress = Math.floor(progress * totalChars);
            
            let charSum = 0;
            for (let i = 0; i < words.length; i++) {
                charSum += words[i].length + 1; 
                if (charSum > charProgress) {
                    globalActiveWordIndex = i;
                    break;
                }
            }
            if (progress >= 0.99) globalActiveWordIndex = words.length - 1;
        }

        let activeWordIndexInChunk = globalActiveWordIndex;
        let chunkEntranceProgress = 1.0;

        if (hasTimestamps && wordTimestamps && wordTimestamps.length > 0) {
            // Do not show subtitles more than 90ms before the first spoken word of the clip
            if (clipTime < wordTimestamps[0].start - 0.09) {
                return;
            }
            // If we are in a breath pause (> 0.35s after active word ended and before next word starts),
            // release the active word highlight so it doesn't stay frozen during silence
            if (globalActiveWordIndex >= 0 && globalActiveWordIndex < wordTimestamps.length) {
                const curW = wordTimestamps[globalActiveWordIndex];
                const nextW = wordTimestamps[globalActiveWordIndex + 1];
                if (clipTime > curW.end + 0.35 && (!nextW || clipTime < nextW.start - 0.06)) {
                    // If pause between chunks is long (> 0.65s), hide the finished chunk during silence
                    if (nextW && nextW.start - curW.end > 0.65 && clipTime > curW.end + 0.25) {
                        return;
                    }
                }
            }
        }

        if (chunks.length > 1) {
            let activeChunk = chunks[0];
            if (globalActiveWordIndex >= 0) {
                const chunkIndex = chunks.findIndex(c => globalActiveWordIndex >= c.startWordIndex && globalActiveWordIndex < c.endWordIndex);
                activeChunk = chunkIndex !== -1 ? chunks[chunkIndex] : chunks[chunks.length - 1];
                activeWordIndexInChunk = globalActiveWordIndex - activeChunk.startWordIndex;
            } else {
                activeWordIndexInChunk = -1;
            }
            displayText = activeChunk.text;

            // Compute 75ms micro-entrance pop when a new timed chunk begins
            if (hasTimestamps && wordTimestamps && activeChunk.startWordIndex < wordTimestamps.length) {
                const chunkStartTime = wordTimestamps[activeChunk.startWordIndex]?.start ?? 0;
                const elapsedInChunk = Math.max(0, clipTime - (chunkStartTime - 0.04));
                chunkEntranceProgress = Math.min(1, elapsedInChunk / 0.075);
            }

            const words = cleanText.split(/\s+/);
            const chunkStartChar = words.slice(0, activeChunk.startWordIndex).join(' ').length + (activeChunk.startWordIndex > 0 ? 1 : 0);
            const chunkTotalChars = activeChunk.text.length;
            const charProgressInChunk = Math.max(0, (progress * cleanText.length) - chunkStartChar);
            progress = Math.min(1, charProgressInChunk / chunkTotalChars);
        } else if (hasTimestamps && wordTimestamps && wordTimestamps.length > 0) {
            const chunkStartTime = wordTimestamps[0]?.start ?? 0;
            const elapsedInChunk = Math.max(0, clipTime - (chunkStartTime - 0.04));
            chunkEntranceProgress = Math.min(1, elapsedInChunk / 0.075);
        }

        const needsEmphasis = styleName === 'hormozi' || styleName === 'mrbeast';
        let emphasisMap: boolean[] | undefined;
        let emphasisSig = '';

        if (needsEmphasis) {
            const rawWords = displayText.split(/\s+/).filter(Boolean);
            emphasisMap = rawWords.map(detectWordEmphasis);
            emphasisSig = emphasisMap.map(e => (e ? '1' : '0')).join('');
            displayText = displayText.toUpperCase();
        }

        const entry = this._registry.get(styleName);
        if (!entry) return;

        const { renderer, defaultConfig, typography } = entry;

        let styleCustomColors: any = customColors;
        if (customColors && typeof customColors === 'object') {
            if (styleName in customColors && typeof customColors[styleName] === 'object' && customColors[styleName] !== null) {
                styleCustomColors = customColors[styleName];
            }
        }
        const colors = { ...defaultConfig, ...(styleCustomColors ?? {}) };

        const currentFont = timelineState.videoSubtitleFont || 'Montserrat';
        const weight = typography?.fontWeight ?? 800;
        const family = typography?.fontFamily ?? resolveSubtitleFont(displayText, currentFont);
        const typoKey = `${weight}-${typography?.sizeScale ?? 1}-${family}-${typography?.letterSpacing ?? ''}`;
        const cacheKey = `${displayText}-${width}-${height}-${position}-${styleName}-${typoKey}${emphasisSig ? `-${emphasisSig}` : ''}`;
        let layout = layoutCache.get(cacheKey);

        if (layout) {
            cacheHits++;
        } else {
            cacheMisses++;
            const wordsInChunk = displayText.split(/\s+/).filter(Boolean).length;
            const isVertical = height > width;
            const maxLinesNeeded = isVertical
                ? Math.min(3, Math.max(2, Math.ceil(wordsInChunk / 2.2)))
                : Math.min(2, Math.max(1, Math.ceil(wordsInChunk / 3.5)));

            layout = precomputeLayout(
                ctx,
                displayText,
                width,
                height,
                maxLinesNeeded,
                position,
                styleName === 'typewriter',
                currentFont,
                emphasisMap,
                typography
            );
            layoutCache.set(cacheKey, layout);
        }

        const fontSize = layout.fontSize;
        const lineHeight = layout.lineHeight;
        const targetFont = `${weight} ${fontSize}px ${family}`;
        if (ctx.font !== targetFont) {
            ctx.font = targetFont;
        }
        if (typography?.letterSpacing && 'letterSpacing' in ctx) {
            (ctx as any).letterSpacing = typography.letterSpacing;
        } else if ('letterSpacing' in ctx && (ctx as any).letterSpacing !== '0px' && (ctx as any).letterSpacing !== 'normal') {
            (ctx as any).letterSpacing = 'normal';
        }

        let activeWordIndex: number = activeWordIndexInChunk;

        if (hasTimestamps) {
            if (forcedWordIndex === -2) {
                return;
            }
            // Drop active highlight if the spoken word already finished > 0.35s ago
            if (
                wordTimestamps &&
                globalActiveWordIndex >= 0 &&
                globalActiveWordIndex < wordTimestamps.length &&
                clipTime > wordTimestamps[globalActiveWordIndex].end + 0.35
            ) {
                activeWordIndex = -1;
            } else if (activeWordIndexInChunk >= layout.totalWords) {
                activeWordIndex = -1;
            } else {
                activeWordIndex = Math.max(-1, activeWordIndexInChunk);
            }
        } else {
            const isPerWordStyle = styleName === 'karaoke' || styleName === 'tiktok' || styleName === 'neon' || styleName === 'hormozi' || styleName === 'mrbeast' || styleName === 'bilingual' || styleName === 'minimal_editorial' || styleName === 'terminal' || styleName === 'kinetic_gold';
            if (isPerWordStyle && progress < 0.01 && globalActiveWordIndex === 0) {
                activeWordIndex = -1;
            } else {
                activeWordIndex = Math.max(0, Math.min(activeWordIndex, layout.totalWords - 1));
            }
        }

        const canCacheWordBitmap =
            styleName !== 'typewriter' &&
            (STATIC_STYLES.has(styleName) || chunkEntranceProgress >= 1);

        if (canCacheWordBitmap) {
            const colorSig = getColorsSignature(colors);
            const wordKey = STATIC_STYLES.has(styleName) ? -1 : activeWordIndex;
            const bmpKey = `${cacheKey}::${colorSig}::w${wordKey}`;
            let bmpEntry = bitmapCache.get(bmpKey);
            if (!bmpEntry) {
                const { canvas: bmpCanvas, y: cropY } = prerenderStaticText(
                    styleName, layout, width, height, colors, fontSize, typography, wordKey
                );
                bmpEntry = { canvas: bmpCanvas, y: cropY, lastUsed: performance.now() };
                bitmapCache.set(bmpKey, bmpEntry);
            } else {
                bmpEntry.lastUsed = performance.now();
            }
            ctx.save();
            if (chunkEntranceProgress < 1) {
                const ease = 1 - Math.pow(1 - chunkEntranceProgress, 3);
                ctx.globalAlpha = ease;
                ctx.translate(0, (1 - ease) * 6);
            }
            ctx.drawImage(bmpEntry.canvas, 0, bmpEntry.y);
            ctx.restore();

            recordFrameTime(startTime, styleName, layout.totalWords);
            return;
        }

        const options: SubtitleRenderContext = {
            fontSize,
            lineHeight,
            activeWordIndex,
            width,
            height,
            colors,
            hasTimestamps,
            clipTime,
            isPlaying
        };

        ctx.save();
        if (chunkEntranceProgress < 1 && styleName !== 'typewriter') {
            const ease = 1 - Math.pow(1 - chunkEntranceProgress, 3);
            const anchorY = layout.lines[0]?.y ?? height * 0.8;
            const scale = 0.96 + 0.04 * ease;
            ctx.globalAlpha = Math.min(1, chunkEntranceProgress * 1.4);
            ctx.translate(width / 2, anchorY);
            ctx.scale(scale, scale);
            ctx.translate(-width / 2, -anchorY + (1 - ease) * 5);
        }
        ctx.beginPath();
        renderer.draw(ctx, layout, progress, options);
        ctx.restore();
        
        recordFrameTime(startTime, styleName, layout.totalWords);
    },

    clearCache() {
        layoutCache.clear();
        chunkCache.clear();
        bitmapCache.clear();
        heightOffsetCache.clear();
    },

    clearBitmapCache() {
        bitmapCache.clear();
    },

    getStats(): RenderStats {
        return { ...renderStats };
    },
    
    resetStats() {
        renderStats = {
            avgFrameTime: 0,
            maxFrameTime: 0,
            frameCount: 0,
            cacheHitRate: 0
        };
        frameTimes = [];
        cacheHits = 0;
        cacheMisses = 0;
        lastSlowWarnTime = 0;
    }
};

// ---------------------------------------------------------------------------
// STYLE REGISTRATION
// ---------------------------------------------------------------------------

SubtitleEngine.registerStyle("karaoke", KaraokeRenderer, SubtitleColorPresets.karaoke, {
    fontWeight: 800,
    sizeScale: 1.0,
});
SubtitleEngine.registerStyle("cinematic", CinematicRenderer, SubtitleColorPresets.cinematic, {
    fontWeight: 500,
    letterSpacing: "0.06em",
    sizeScale: 0.88,
    transform: "none",
});
SubtitleEngine.registerStyle("yellow_box", YellowBoxRenderer, SubtitleColorPresets.yellowBox, {
    fontWeight: 800,
    sizeScale: 0.95,
});
SubtitleEngine.registerStyle("tiktok", TikTokRenderer, SubtitleColorPresets.tiktok, {
    fontWeight: 800,
    sizeScale: 1.0,
});
SubtitleEngine.registerStyle("anime", AnimeRenderer, SubtitleColorPresets.anime, {
    fontWeight: 900,
    sizeScale: 1.0,
});
SubtitleEngine.registerStyle("neon", NeonRenderer, SubtitleColorPresets.neon, {
    fontWeight: 800,
    sizeScale: 1.0,
});
SubtitleEngine.registerStyle("typewriter", TypewriterRenderer, SubtitleColorPresets.typewriter, {
    fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", ui-monospace, monospace',
    fontWeight: 600,
    sizeScale: 0.9,
});
SubtitleEngine.registerStyle("hormozi", HormoziRenderer, SubtitleColorPresets.hormozi, {
    fontWeight: 900,
    sizeScale: 1.05,
    transform: "uppercase",
});
SubtitleEngine.registerStyle("mrbeast", MrBeastRenderer, SubtitleColorPresets.mrbeast, {
    fontWeight: 900,
    sizeScale: 1.05,
    transform: "uppercase",
});
SubtitleEngine.registerStyle("minimal_editorial", MinimalEditorialRenderer, SubtitleColorPresets.minimal_editorial, {
    fontWeight: 500,
    letterSpacing: "0.04em",
    sizeScale: 0.92,
});
SubtitleEngine.registerStyle("terminal", TerminalRenderer, SubtitleColorPresets.terminal, {
    fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", ui-monospace, monospace',
    fontWeight: 600,
    sizeScale: 0.88,
    letterSpacing: "0.02em",
});
SubtitleEngine.registerStyle("bilingual", BilingualRenderer, SubtitleColorPresets.bilingual, {
    fontWeight: 700,
    sizeScale: 0.95,
});
SubtitleEngine.registerStyle("kinetic_gold", KineticGoldRenderer, SubtitleColorPresets.kinetic_gold, {
    fontFamily: '"Montserrat", "Inter", system-ui, sans-serif',
    fontWeight: 800,
    sizeScale: 1.02,
    transform: "none",
});
