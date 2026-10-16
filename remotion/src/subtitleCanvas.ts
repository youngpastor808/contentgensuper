/**
 * Cloud-render subtitle drawing with 1:1 parity to the browser SubtitleEngine.
 *
 * The browser draws every subtitle style with the renderer objects exported from
 * src/subtitle-styles.ts (KaraokeRenderer, AnimeRenderer, ...). This module imports
 * those SAME renderers and calls them on a <canvas> inside the Remotion composition,
 * so the 13 styles cannot drift from the editor / local export.
 *
 * What is mirrored here (and must be kept in sync with src/subtitle-engine.ts):
 *   - STYLE_TYPOGRAPHY      -> the registerStyle(..., typography) block at the bottom of the engine
 *   - precomputeLayout()    -> same-named function in the engine (wrapping, font size, anchors)
 *   - detectWordEmphasis()  -> same-named export in the engine (Hormozi / MrBeast)
 *   - resolveSubtitleFont() -> same-named export in the engine
 * The engine itself is NOT imported because it pulls in browser-app state (state-timeline).
 */
import { pickKeywords } from '../../src/media/smart-director-tools';
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
  SubtitleColorPresets,
} from '../../src/subtitle-styles';
import type { SubtitleLayout, LayoutWord, StyleTypography, SubtitleStyle } from '../../src/subtitle-engine';

export type LocalSubtitleStyle =
  | 'karaoke' | 'cinematic' | 'yellow_box' | 'tiktok' | 'anime' | 'neon' | 'typewriter'
  | 'hormozi' | 'mrbeast' | 'minimal_editorial' | 'terminal' | 'bilingual' | 'kinetic_gold';

const RENDERERS: Record<LocalSubtitleStyle, SubtitleStyle> = {
  karaoke: KaraokeRenderer,
  cinematic: CinematicRenderer,
  yellow_box: YellowBoxRenderer,
  tiktok: TikTokRenderer,
  anime: AnimeRenderer,
  neon: NeonRenderer,
  typewriter: TypewriterRenderer,
  hormozi: HormoziRenderer,
  mrbeast: MrBeastRenderer,
  minimal_editorial: MinimalEditorialRenderer,
  terminal: TerminalRenderer,
  bilingual: BilingualRenderer,
  kinetic_gold: KineticGoldRenderer,
};

const DEFAULT_COLORS: Record<LocalSubtitleStyle, Record<string, string>> = {
  karaoke: SubtitleColorPresets.karaoke,
  cinematic: SubtitleColorPresets.cinematic,
  yellow_box: SubtitleColorPresets.yellowBox,
  tiktok: SubtitleColorPresets.tiktok,
  anime: SubtitleColorPresets.anime,
  neon: SubtitleColorPresets.neon,
  typewriter: SubtitleColorPresets.typewriter,
  hormozi: SubtitleColorPresets.hormozi,
  mrbeast: SubtitleColorPresets.mrbeast,
  minimal_editorial: SubtitleColorPresets.minimal_editorial,
  terminal: SubtitleColorPresets.terminal,
  bilingual: SubtitleColorPresets.bilingual,
  kinetic_gold: SubtitleColorPresets.kinetic_gold,
};

const MONO = '"JetBrains Mono", "Fira Code", "Courier New", ui-monospace, monospace';

// Mirror of the registerStyle(...) typography objects in src/subtitle-engine.ts
export const STYLE_TYPOGRAPHY: Record<LocalSubtitleStyle, StyleTypography> = {
  karaoke: { fontWeight: 800, sizeScale: 1.0 },
  cinematic: { fontWeight: 500, letterSpacing: '0.06em', sizeScale: 0.88, transform: 'none' },
  yellow_box: { fontWeight: 800, sizeScale: 0.95 },
  tiktok: { fontWeight: 800, sizeScale: 1.0 },
  anime: { fontWeight: 900, sizeScale: 1.0 },
  neon: { fontWeight: 800, sizeScale: 1.0 },
  typewriter: { fontFamily: MONO, fontWeight: 600, sizeScale: 0.9 },
  hormozi: { fontWeight: 900, sizeScale: 1.05, transform: 'uppercase' },
  mrbeast: { fontWeight: 900, sizeScale: 1.05, transform: 'uppercase' },
  minimal_editorial: { fontWeight: 500, letterSpacing: '0.04em', sizeScale: 0.92 },
  terminal: { fontFamily: MONO, fontWeight: 600, sizeScale: 0.88, letterSpacing: '0.02em' },
  bilingual: { fontWeight: 700, sizeScale: 0.95 },
  kinetic_gold: { fontFamily: '"Montserrat", "Inter", system-ui, sans-serif', fontWeight: 800, sizeScale: 1.02, transform: 'none' },
};

/** Maps any preset spelling used in project files / UI to the engine's style name. */
const ALIASES: Record<string, LocalSubtitleStyle> = {
  karaoke: 'karaoke',
  cinematic: 'cinematic', cinema: 'cinematic',
  yellowbox: 'yellow_box', yellow: 'yellow_box',
  tiktok: 'tiktok',
  anime: 'anime',
  neon: 'neon',
  typewriter: 'typewriter',
  hormozi: 'hormozi',
  mrbeast: 'mrbeast',
  minimaleditorial: 'minimal_editorial', minimal: 'minimal_editorial', editorial: 'minimal_editorial',
  terminal: 'terminal',
  bilingual: 'bilingual',
  kineticgold: 'kinetic_gold', kinetic: 'kinetic_gold',
};

export function resolveLocalSubtitleStyle(preset?: string): LocalSubtitleStyle | null {
  const key = String(preset || '').toLowerCase().replace(/[\s_-]+/g, '');
  return ALIASES[key] ?? null;
}

/** Fonts the style needs, so the caller can load them before drawing. */
export function fontsForStyle(style: LocalSubtitleStyle, requestedFont?: string, text = ''): string[] {
  const out = new Set<string>();
  const t = STYLE_TYPOGRAPHY[style];
  if (t.fontFamily?.includes('JetBrains')) out.add('JetBrains Mono');
  else if (t.fontFamily?.includes('Montserrat')) out.add('Montserrat');
  else {
    out.add(requestedFont || 'Montserrat');
    if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(text)) out.add('Noto Sans JP');
    else if (/[\u0600-\u06FF]/.test(text)) out.add('Noto Sans Arabic');
    else if (/[^\x00-\x7F]/.test(text)) out.add('Noto Sans');
  }
  return Array.from(out);
}

export function detectWordEmphasis(rawWord: string): boolean {
  const POWER_WORDS = new Set([
    'SECRET', 'MONEY', 'CASH', 'MILLION', 'BILLION', 'KILLER', 'NEVER', 'ALWAYS',
    'INSANE', 'CRAZY', 'HUGE', 'WARNING', 'STOP', 'FREE', 'BEST', 'WORST',
    'URGENT', 'SHOCKING', 'MASSIVE', 'PROVEN', 'HACK', 'TRICK', 'WIN', 'RICH', 'PROFIT',
  ]);
  if (!rawWord) return false;
  const clean = rawWord.replace(/[^a-zA-Z0-9$%!]/g, '').trim();
  if (!clean) return false;
  if (/^\$?[0-9]+([.,][0-9]+)?%?$/.test(clean)) return true;
  if (clean.length >= 3 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) return true;
  return POWER_WORDS.has(clean.toUpperCase());
}

/**
 * Combines ContentGen's static POWER_WORDS / uppercase detection with
 * video-studio's heuristic keyword scorer (pickKeywords) so every multi-word
 * Hormozi/MrBeast subtitle chunk highlights at least one high-value word.
 */
export function computeChunkEmphasisMap(words: string[]): boolean[] {
  const base = words.map((w) => detectWordEmphasis(w));
  if (!base.some(Boolean) && words.length >= 2) {
    const picks = pickKeywords(words.join(' '), 1);
    for (const idx of picks) {
      if (idx >= 0 && idx < base.length) {
        base[idx] = true;
      }
    }
  }
  return base;
}

export function resolveSubtitleFont(text: string, requestedFont?: string): string {
  if (/[\u4E00-\u9FFF\u3040-\u30FF]/.test(text)) return '"Noto Sans JP", sans-serif';
  if (/[\u0600-\u06FF]/.test(text)) return '"Noto Sans Arabic", sans-serif';
  if (/[\u0400-\u04FF\u0100-\u024F\u1E00-\u1EFF]/.test(text) === false && /[^\x00-\x7F]/.test(text)) return '"Noto Sans", sans-serif';
  const fontName = requestedFont || 'Montserrat';
  if (fontName.startsWith('"') || fontName.startsWith("'")) return `${fontName}, sans-serif`;
  return `"${fontName}", sans-serif`;
}

/** Mirror of precomputeLayout() in src/subtitle-engine.ts. */
export function precomputeLayout(
  ctx: any,
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
    return { lines: [], totalWords: 0, totalChars: 0, plainText: text, fontSize: fallbackFontSize, lineHeight: Math.floor(fallbackFontSize * 1.2), spaceWidth: fallbackFontSize * 0.25 };
  }

  const isVertical = height > width;
  const plainText = text;
  let fontSize = Math.floor((isVertical ? Math.floor(width * 0.062) : Math.floor(height * 0.05)) * sizeScale);
  const minFontSize = Math.floor((isVertical ? Math.floor(width * 0.038) : Math.floor(height * 0.03)) * sizeScale);
  let layout: SubtitleLayout | null = null;
  let lineHeight = fontSize * 1.2;

  if (typography?.letterSpacing && 'letterSpacing' in ctx) {
    ctx.letterSpacing = typography.letterSpacing;
  } else if ('letterSpacing' in ctx && ctx.letterSpacing !== '0px' && ctx.letterSpacing !== 'normal') {
    ctx.letterSpacing = 'normal';
  }

  while (fontSize >= minFontSize) {
    lineHeight = fontSize * 1.2;
    const maxWidth = width * 0.8;
    ctx.font = `${weight} ${fontSize}px ${family}`;
    const spaceWidth = ctx.measureText(' ').width;

    layout = { lines: [], totalWords: words.length, totalChars: plainText.length, plainText, fontSize, lineHeight, spaceWidth };

    let currLine: LayoutWord[] = [];
    let currWidth = 0;
    let lineCount = 0;
    let fits = true;
    let globalWordIndex = 0;

    for (const word of words) {
      const w = ctx.measureText(word).width;
      const graphemes = [...word];
      const charWidths = needsCharWidths ? graphemes.map((c) => ctx.measureText(c).width) : [];
      const isEmphasized = emphasisMap && globalWordIndex < emphasisMap.length ? emphasisMap[globalWordIndex] : false;

      if (currWidth + w + spaceWidth > maxWidth && currLine.length > 0) {
        layout.lines.push({ words: currLine, y: 0 });
        lineCount++;
        if (lineCount >= maxLines) { fits = false; break; }
        currLine = [];
        currWidth = 0;
      }
      if (lineCount < maxLines) {
        currLine.push({ text: word, x: 0, y: 0, width: w, charWidths, graphemes, isEmphasized });
        currWidth += w + spaceWidth;
      }
      globalWordIndex++;
    }

    if (currLine.length > 0 && lineCount < maxLines) layout.lines.push({ words: currLine, y: 0 });

    if (fits || fontSize === minFontSize) {
      if (!fits) {
        const displayedWordsArray = layout.lines.flatMap((l) => l.words);
        if (displayedWordsArray.length < layout.totalWords) {
          layout.totalWords = displayedWordsArray.length;
          const displayedText = displayedWordsArray.map((w) => w.text).join(' ');
          layout.plainText = displayedText;
          layout.totalChars = displayedText.length;
        }
      }
      const totalHeight = layout.lines.length * lineHeight;
      let y: number;
      if (position === 'top') y = height * 0.12 + fontSize / 2;
      else if (position === 'center') y = height * 0.5 - totalHeight / 2 + fontSize / 2;
      else y = height * 0.8 - totalHeight / 2;

      for (const line of layout.lines) {
        line.y = y;
        const lineWidth = line.words.reduce((s, w) => s + w.width, 0) + spaceWidth * (line.words.length - 1);
        let x = Math.max(width * 0.05, width / 2 - lineWidth / 2);
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

export interface DrawSubtitleArgs {
  style: LocalSubtitleStyle;
  /** The chunk's words, in their original casing. */
  words: string[];
  /** Index of the highlighted word inside `words`, or -1. */
  activeWordIndex: number;
  /** 0..1 progress through the chunk (used by typewriter cursor). */
  progress: number;
  width: number;
  height: number;
  position?: 'bottom' | 'center' | 'top';
  clipTime: number;
  /** state.videoSubtitleColors: either { [styleName]: {...} } or a flat colour object. */
  userColors?: Record<string, any> | null;
  requestedFont?: string;
}

/** Mirror of the per-frame part of SubtitleEngine.draw(). */
export function drawSubtitleChunk(ctx: CanvasRenderingContext2D, a: DrawSubtitleArgs): void {
  const { style, width, height } = a;
  const position = a.position === 'top' || a.position === 'center' ? a.position : 'bottom';
  const rawText = a.words.join(' ').replace(/\s+/g, ' ').trim();
  if (!rawText) return;

  let displayText = rawText;
  let emphasisMap: boolean[] | undefined;
  if (style === 'hormozi' || style === 'mrbeast') {
    emphasisMap = computeChunkEmphasisMap(displayText.split(/\s+/).filter(Boolean));
    displayText = displayText.toUpperCase();
  }

  const typography = STYLE_TYPOGRAPHY[style];
  let styleCustom: any = a.userColors || {};
  if (a.userColors && typeof a.userColors === 'object' && style in a.userColors && typeof (a.userColors as any)[style] === 'object' && (a.userColors as any)[style] !== null) {
    styleCustom = (a.userColors as any)[style];
  }
  const colors: Record<string, string> = { ...DEFAULT_COLORS[style], ...styleCustom };

  const weight = typography.fontWeight ?? 800;
  const family = typography.fontFamily ?? resolveSubtitleFont(displayText, a.requestedFont);

  const wordsInChunk = displayText.split(/\s+/).filter(Boolean).length;
  const isVertical = height > width;
  const maxLinesNeeded = isVertical
    ? Math.min(3, Math.max(2, Math.ceil(wordsInChunk / 2.2)))
    : Math.min(2, Math.max(1, Math.ceil(wordsInChunk / 3.5)));

  const layout = precomputeLayout(ctx, displayText, width, height, maxLinesNeeded, position, style === 'typewriter', a.requestedFont, emphasisMap, typography);

  ctx.font = `${weight} ${layout.fontSize}px ${family}`;
  if (typography.letterSpacing && 'letterSpacing' in ctx) (ctx as any).letterSpacing = typography.letterSpacing;
  else if ('letterSpacing' in ctx) (ctx as any).letterSpacing = 'normal';

  const activeWordIndex = a.activeWordIndex >= layout.totalWords ? -1 : Math.max(-1, a.activeWordIndex);

  RENDERERS[style].draw(ctx, layout, a.progress, {
    fontSize: layout.fontSize,
    lineHeight: layout.lineHeight,
    activeWordIndex,
    width,
    height,
    colors,
    hasTimestamps: true,
    clipTime: a.clipTime,
    isPlaying: true,
  });
}
