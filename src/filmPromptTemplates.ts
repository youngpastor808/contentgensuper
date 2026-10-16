/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Film Studio Prompt Templates & Builders
 * Phase 1: Pure data structures and string builders for:
 * 1. Character reference sheets (Mode A: image reference, Mode B: description)
 * 2. 3x3 Storyboard Grid (16:9 sheet with 16:9 or 9:16 panels)
 * 3. Seedance 2.0 prompts (Variants A, B, and C with deterministic @image numbering)
 */

export type FilmGenre = 'photoreal' | 'pixar' | 'anime' | 'noir' | 'vlog';
export type PanelAspect = '16:9' | '9:16';
export type ThirdLine = 'MOOD' | 'VOICE' | 'STYLE';

export interface FilmCharacter {
  name: string;
  aliases?: string[];
  anchor: string;          // from CharacterProfile.appearance_anchor
  hasReferenceImage: boolean;
  sheet_image_id?: string;
  sheet_prompt?: string;
}

export interface PanelBeat {
  beat: string;            // 3-12 words, screenwriter slug
  cam: string;
  move: string;
  third: string;           // content of the MOOD / VOICE / STYLE line
}

export interface FilmContext {
  genre: FilmGenre;
  characters: FilmCharacter[];
  sceneType: string;       // "confrontation", "fight", "unboxing vlog"
  location: string;
  exclusions: string;
  panelAspect: PanelAspect;
  thirdLine: ThirdLine;
  beats: PanelBeat[];      // exactly 9 for the grid template
  storyline: string;
  hasBoard: boolean;
  durationSeconds: number; // default 15
  audio: string;           // default 'NO MUSIC'
  isMicroDrama?: boolean;
}

export const GENRE_STYLE_BLOCKS: Record<FilmGenre, string> = {
  photoreal: 'photorealistic, life-like live action shot on a DSLR camera with 35mm film and muted color tones, do not make it look like a 3D render',
  pixar:     'stylized 3D render in the visual language of modern Pixar features, soft global illumination, expressive proportions, no photoreal rendering',
  anime:     '2D anime cel-shading, clean line work, painterly backgrounds, no 3D render',
  noir:      'high-contrast black and white film, harsh chiaroscuro lighting, 35mm grain',
  vlog:      'natural daylight, iPhone selfie-camera aesthetic, soft skin tones, no cinematic grade',
};

/**
 * Validates character anchor against the guide's top failure modes.
 * 1. Exceeding ~100 words (target 30-60).
 * 2. Transient / scene-lighting contaminant words.
 */
export function validateCharacterAnchor(anchor: string): string[] {
  const warnings: string[] = [];
  if (!anchor || !anchor.trim()) {
    warnings.push('Character appearance anchor is empty. Provide physical features (age, build, hair, wardrobe).');
    return warnings;
  }

  const words = anchor.trim().split(/\s+/).filter(Boolean);
  if (words.length > 100) {
    warnings.push(`Appearance anchor is ${words.length} words (target is 30–60 words). Excessively long anchors degrade reference sheet consistency.`);
  }

  const contaminantRegex = /\b(blood|dirt|smudge|damp|sparks|rim-light|rim light|moonlit|firelit|neon)\b/gi;
  const rawMatches = anchor.match(contaminantRegex);
  if (rawMatches && rawMatches.length > 0) {
    const uniqueContaminants = Array.from(new Set(rawMatches.map(w => w.toLowerCase())));
    warnings.push(`Appearance anchor contains scene-lighting or transient words ("${uniqueContaminants.join(', ')}"). These will contaminate the neutral lighting on the reference sheet.`);
  }

  return warnings;
}

/**
 * Extracts a concise identity-bearing clause for storyboard grids and seedance prompts.
 * Cuts off before "Never:" or trailing negative constraints.
 */
export function extractIdentityClause(anchor: string): string {
  if (!anchor) return 'character in scene';
  const clean = anchor.replace(/\s*Never:[\s\S]*/i, '').trim();
  const firstSentence = clean.split(/[.;\n]/)[0].trim();
  return firstSentence || clean.substring(0, 80).trim();
}

/**
 * Builder 1 — Character Sheet Prompt
 * Mode A: Reference image exists -> Image is the description.
 * Mode B: Description only -> Character anchor is inserted.
 */
export function buildCharacterSheetPrompt(
  character: FilmCharacter,
  genre: FilmGenre
): string {
  const styleBlock = GENRE_STYLE_BLOCKS[genre] || GENRE_STYLE_BLOCKS.photoreal;

  const subjectClause = character.hasReferenceImage
    ? `attached character with {use attached image(s) as strong reference, 1:1 similarity, ${styleBlock}}`
    : `${character.name ? `${character.name}: ` : ''}${character.anchor.trim()}`;

  return `Create a professional character reference sheet for ${subjectClause}. Divide the sheet into four different vertical columns, each representing a different angle, for a total of eight shots. The entire top row must show full-body views from head to toe facing four different directions: the front, the side, a three-quarter view, and the back. All subjects in the top row must be fully visible including feet, with no cropping at the ankles, knees, or head. The bottom row must contain four close-up shots of the face (including front and profile views) corresponding to each of the full-body shots above. The style must be ${styleBlock}. Lighting must be clean, even and neutral studio lighting. Background should be simple and not distracting from character design. Aspect ratio = 16:9.`;
}

/**
 * Builder 2 — 3x3 Storyboard Grid Prompt
 * Emits the 9-panel storyboard grid prompt on a 16:9 sheet.
 * Sheet remains 16:9; individual panels render at ctx.panelAspect ('16:9' or '9:16').
 */
export function buildStoryboardGridPrompt(ctx: FilmContext): string {
  const styleBlock = GENRE_STYLE_BLOCKS[ctx.genre] || GENRE_STYLE_BLOCKS.photoreal;
  const panelAspect = ctx.panelAspect || '16:9';
  const effectiveThird = ctx.isMicroDrama ? 'VOICE' : (ctx.thirdLine || 'MOOD');

  // Character lock: one tight sentence per character
  const charLockLines = (ctx.characters || []).map(c => {
    const idClause = extractIdentityClause(c.anchor);
    return `${c.name}: ${idClause}.`;
  });

  // Ensure exactly 9 beats
  const beats: PanelBeat[] = [];
  for (let i = 0; i < 9; i++) {
    const existing = ctx.beats && ctx.beats[i];
    if (existing && existing.beat) {
      beats.push({
        beat: existing.beat.trim(),
        cam: existing.cam ? existing.cam.trim().toUpperCase() : 'MEDIUM SHOT',
        move: existing.move ? existing.move.trim().toUpperCase() : 'STATIC',
        third: existing.third ? existing.third.trim().toUpperCase() : (ctx.isMicroDrama ? '(BEAT. NO WORDS.)' : 'FOCUSED')
      });
    } else {
      beats.push({
        beat: `Beat ${i + 1} narrative progression`,
        cam: 'MEDIUM SHOT',
        move: 'STATIC',
        third: ctx.isMicroDrama ? '(BEAT. NO WORDS.)' : 'FOCUSED'
      });
    }
  }

  const panelBlocks = beats.map((b, i) => {
    const panelNum = i + 1;
    let thirdContent = b.third;
    if (ctx.isMicroDrama && (!thirdContent || thirdContent === 'SILENT' || thirdContent === 'NONE')) {
      thirdContent = '(BEAT. NO WORDS.)';
    }
    const annotation = `CAM: ${b.cam}. MOVE: ${b.move}. ${effectiveThird}: ${thirdContent}.`;

    return `PANEL ${panelNum}:
BEAT: ${b.beat}
STRIP: ${annotation}`;
  });

  let prompt = `Create a 3x3 cinematic storyboard grid composed of 9 sequential panels arranged on a single 16:9 sheet. Each individual panel within the grid must render with a ${panelAspect} aspect ratio.

STYLE & CONTINUITY:
${styleBlock}. Unified color grading and consistent lighting across all 9 panels.`;

  if (ctx.location && ctx.location.trim()) {
    prompt += `\nLOCATION: ${ctx.location.trim()}`;
  }
  if (ctx.sceneType && ctx.sceneType.trim()) {
    prompt += `\nSCENE TYPE: ${ctx.sceneType.trim()}`;
  }
  if (ctx.exclusions && ctx.exclusions.trim()) {
    prompt += `\nEXCLUSIONS: ${ctx.exclusions.trim()}`;
  }

  if (charLockLines.length > 0) {
    prompt += `\n\nCHARACTER LOCK:\n${charLockLines.join('\n')}`;
  }

  prompt += `\n\nPANEL BEATS (1 through 9, ordered left-to-right, top-to-bottom):\n${panelBlocks.join('\n\n')}`;

  prompt += `\n\nANNOTATION SPECIFICATION:\nUnderneath each panel, render an annotation strip displaying CAM, MOVE, and ${effectiveThird} in a clean, high-contrast sans-serif font legible at the rendered grid size.`;

  return prompt;
}

export interface ImageReferenceMap {
  characterReferences: { character: FilmCharacter; refTag: string; index: number }[];
  boardReferenceTag: string | null;
  totalReferences: number;
}

/**
 * Computes deterministic @image tags.
 * Character sheets take @image1, @image2, ... in order.
 * The grid takes the next free number.
 * Two references never share a number.
 */
export function computeImageReferences(
  characters: FilmCharacter[],
  hasBoard: boolean
): ImageReferenceMap {
  const characterReferences: { character: FilmCharacter; refTag: string; index: number }[] = [];
  let nextIdx = 1;

  for (const c of characters) {
    if (c.hasReferenceImage || Boolean(c.sheet_image_id)) {
      characterReferences.push({
        character: c,
        refTag: `@image${nextIdx}`,
        index: nextIdx
      });
      nextIdx++;
    }
  }

  let boardReferenceTag: string | null = null;
  if (hasBoard) {
    boardReferenceTag = `@image${nextIdx}`;
    nextIdx++;
  }

  return {
    characterReferences,
    boardReferenceTag,
    totalReferences: nextIdx - 1
  };
}

/**
 * Unit assertion test ensuring @image numbering rules for 0, 1, 2, and 3 character sheets.
 */
export function assertImageReferenceRules(): void {
  // Case 0: 0 sheets, grid = true -> grid is @image1
  const map0 = computeImageReferences([], true);
  if (map0.boardReferenceTag !== '@image1' || map0.characterReferences.length !== 0) {
    throw new Error(`0-sheet test failed: expected @image1, got ${map0.boardReferenceTag}`);
  }

  // Case 1: 1 sheet, grid = true -> sheet is @image1, grid is @image2
  const dummy1: FilmCharacter = { name: 'Alice', anchor: 'female lead', hasReferenceImage: true };
  const map1 = computeImageReferences([dummy1], true);
  if (map1.characterReferences[0]?.refTag !== '@image1' || map1.boardReferenceTag !== '@image2') {
    throw new Error(`1-sheet test failed: char=${map1.characterReferences[0]?.refTag}, board=${map1.boardReferenceTag}`);
  }

  // Case 2: 2 sheets, grid = true -> char1 is @image1, char2 is @image2, grid is @image3
  const dummy2: FilmCharacter = { name: 'Bob', anchor: 'male lead', hasReferenceImage: true };
  const map2 = computeImageReferences([dummy1, dummy2], true);
  if (
    map2.characterReferences[0]?.refTag !== '@image1' ||
    map2.characterReferences[1]?.refTag !== '@image2' ||
    map2.boardReferenceTag !== '@image3'
  ) {
    throw new Error('2-sheet test failed');
  }

  // Case 3: 3 sheets, grid = true -> grid is @image4
  const dummy3: FilmCharacter = { name: 'Charlie', anchor: 'detective', hasReferenceImage: true };
  const map3 = computeImageReferences([dummy1, dummy2, dummy3], true);
  if (
    map3.characterReferences[2]?.refTag !== '@image3' ||
    map3.boardReferenceTag !== '@image4'
  ) {
    throw new Error('3-sheet test failed');
  }
}

// Execute assertion safely on load without crashing bundle execution
try {
  assertImageReferenceRules();
} catch (err) {
  console.warn('Film Studio image reference validation warning:', err);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Builds continuous timeline intervals covering 0 to durationSeconds with no gaps.
 */
export function buildContinuousTimeline(
  beats: PanelBeat[],
  durationSeconds: number
): string[] {
  const validBeats = beats && beats.length > 0 ? beats : [{ beat: 'Opening scene develops', cam: 'WIDE SHOT', move: 'STATIC', third: '' }];
  const count = validBeats.length;
  const step = durationSeconds / count;

  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const startSec = i * step;
    const endSec = i === count - 1 ? durationSeconds : (i + 1) * step;
    const timeRange = `${formatTime(startSec)}-${formatTime(endSec)}`;
    const b = validBeats[i];
    const camStr = b.cam ? `${b.cam.replace(/_/g, ' ')}` : 'Cinematic shot';
    const moveStr = b.move && b.move !== 'STATIC' ? `, ${b.move.toLowerCase().replace(/_/g, ' ')}` : '';
    lines.push(`${timeRange}: ${camStr}${moveStr} - ${b.beat}.`);
  }
  return lines;
}

/**
 * Builder 3 — Seedance Prompts
 * Variant selection:
 * - Character sheets: any, Storyboard grid: no -> Variant A
 * - Character sheets: none, Storyboard grid: yes -> Variant B
 * - Character sheets: >=1, Storyboard grid: yes -> Variant C
 */
export function buildSeedancePrompt(ctx: FilmContext): { variant: 'A' | 'B' | 'C'; prompt: string } {
  const refMap = computeImageReferences(ctx.characters || [], ctx.hasBoard);
  const sheetCount = refMap.characterReferences.length;
  const duration = ctx.durationSeconds || 15;
  const audioDirection = ctx.audio && ctx.audio.trim() ? ctx.audio.trim() : 'NO MUSIC';
  const genreStyle = GENRE_STYLE_BLOCKS[ctx.genre] || GENRE_STYLE_BLOCKS.photoreal;
  const panelAspect = ctx.panelAspect || '16:9';

  let variant: 'A' | 'B' | 'C';
  if (!ctx.hasBoard) {
    variant = 'A';
  } else if (sheetCount === 0) {
    variant = 'B';
  } else {
    variant = 'C';
  }

  let prompt = '';

  if (variant === 'A') {
    const beats = ctx.beats && ctx.beats.length > 0 ? ctx.beats : [
      { beat: 'Characters interact in the opening beat', cam: 'WIDE SHOT', move: 'STATIC', third: '' },
      { beat: 'Tension escalates as characters exchange dialogue', cam: 'MEDIUM CLOSE-UP', move: 'PUSH IN', third: '' },
      { beat: 'Climactic confrontation resolves', cam: 'CLOSE-UP', move: 'STATIC', third: '' }
    ];

    const cutsCount = beats.length;
    const timelineLines = buildContinuousTimeline(beats, duration);

    const subjectLines: string[] = [];
    if (ctx.characters && ctx.characters.length > 0) {
      ctx.characters.forEach((c, idx) => {
        const matchingRef = refMap.characterReferences.find(r => r.character.name === c.name);
        const refClause = matchingRef ? ` Refer to ${matchingRef.refTag} for character likeness and styling.` : '';
        const idClause = extractIdentityClause(c.anchor);
        subjectLines.push(`SUBJECT ${idx + 1}: ${c.name} (${idClause}).${refClause}`);
      });
    } else {
      subjectLines.push('SUBJECT 1: Primary subject in scene.');
    }

    const envLine = ctx.location
      ? `ENVIRONMENT: ${ctx.location}. Neutral cinematic lighting matching visual tone.`
      : 'ENVIRONMENT: Cinematic setting, balanced atmospheric lighting.';

    prompt = `FORMAT: ${duration} seconds / ${cutsCount} CUTS / ${ctx.genre.toUpperCase()} (${genreStyle}) / ${audioDirection}
ASPECT RATIO: ${panelAspect}
${subjectLines.join('\n')}
${envLine}
AUDIO / MOOD: ${audioDirection}.
TIMELINE (covers full 0:00-${formatTime(duration)} with no gaps):
${timelineLines.join('\n')}`;

  } else if (variant === 'B') {
    const boardTag = refMap.boardReferenceTag || '@image1';
    const storyline = ctx.storyline && ctx.storyline.trim()
      ? ctx.storyline.trim()
      : 'A coherent cinematic sequence following the 9 panel narrative beats in order.';
    const trailingNotice = audioDirection.toUpperCase().includes('NO MUSIC')
      ? 'NO TEXT ON SCREEN, NO MUSIC.'
      : 'NO TEXT ON SCREEN.';

    prompt = `Animate the 3x3 storyboard grid in ${boardTag} into a continuous cinematic sequence adhering to the narrative beats and visual compositions in order. Match camera movements, lighting, and framing from each panel. Maintain strict visual continuity between shots.

Storyline: ${storyline}
Aspect Ratio: ${panelAspect}
Duration: ${duration} seconds
Audio: ${audioDirection}

${trailingNotice}`;

  } else {
    // Variant C: >= 1 character sheet + storyboard grid
    const boardTag = refMap.boardReferenceTag || `@image${sheetCount + 1}`;
    const charTagList = refMap.characterReferences.map(r => `${r.character.name} (${r.refTag})`).join(', ');
    const storyline = ctx.storyline && ctx.storyline.trim()
      ? ctx.storyline.trim()
      : 'A coherent cinematic sequence following the 9 panel narrative beats in order.';
    const trailingNotice = audioDirection.toUpperCase().includes('NO MUSIC')
      ? 'NO TEXT ON SCREEN, NO MUSIC.'
      : 'NO TEXT ON SCREEN.';

    prompt = `Animate the 3x3 storyboard grid in ${boardTag} into a continuous cinematic sequence adhering to the narrative beats and visual compositions in order. Maintain strict character likeness, wardrobe, and facial features matching the character reference sheet${sheetCount > 1 ? 's' : ''} in ${charTagList}. Match camera movements, lighting, and framing from each panel. Maintain strict visual continuity between shots.

Storyline: ${storyline}
Aspect Ratio: ${panelAspect}
Duration: ${duration} seconds
Audio: ${audioDirection}

${trailingNotice}`;
  }

  return { variant, prompt };
}

/**
 * Builds multi-shot seedance prompts with "// ---- SHOT n ----" delimiter blocks.
 */
export function buildMultiShotSeedancePrompts(shots: any[], ctx: FilmContext): string {
  if (!shots || shots.length === 0) {
    return buildSeedancePrompt(ctx).prompt;
  }

  const blocks = shots.map((shot, i) => {
    const camMovement = (shot.camera_movement || 'MEDIUM SHOT').toUpperCase();
    let moveType = 'STATIC';
    if (camMovement.includes('PAN')) moveType = 'PAN';
    else if (camMovement.includes('ZOOM')) moveType = camMovement.includes('OUT') ? 'SLOW ZOOM OUT' : 'SLOW ZOOM IN';
    else if (camMovement.includes('TILT')) moveType = 'TILT';
    else if (camMovement.includes('TRACK') || camMovement.includes('DOLLY')) moveType = 'DOLLY';

    const shotCtx: FilmContext = {
      ...ctx,
      hasBoard: false, // Skip board reference for individual shot prompts to preserve per-shot beats & camera data
      storyline: shot.image_prompt || shot.text_reference || shot.line_text || ctx.storyline,
      beats: [{
        beat: shot.image_prompt || `Shot ${i + 1} narrative progression`,
        cam: camMovement,
        move: moveType,
        third: shot.line_text ? `VOICE: "${shot.line_text}"` : (ctx.beats[0]?.third || '')
      }]
    };
    const { prompt } = buildSeedancePrompt(shotCtx);
    return `// ---- SHOT ${i + 1} ----\n${prompt}`;
  });

  return blocks.join('\n\n---\n\n');
}

/**
 * Detects any unresolved [BRACKETED] placeholder.
 * Used to guard the Copy button.
 */
export function hasBracketedPlaceholders(text: string): boolean {
  return /\[[A-Z][A-Z \/_-]+\]/.test(text);
}

/**
 * Lists unique unresolved bracketed placeholders found in text.
 */
export function findBracketedPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-Z][A-Z \/_-]+\]/g) || [];
  return Array.from(new Set(matches));
}
