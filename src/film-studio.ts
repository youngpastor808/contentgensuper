/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Film Studio Controller
 * Modal and workflow orchestrator for:
 * - Tab 1: Character reference sheets (Mode A & Mode B)
 * - Tab 2: 3x3 Storyboard grids (with auto-pull from current storyboard)
 * - Tab 3: Seedance 2.0 prompts (auto-selected Variants A, B, C)
 *
 * Phase 1: Pure prompt synthesis, zero credits, zero network calls.
 */

import { state } from './state';
import { showStatus } from './ui';
import {
  FilmGenre,
  PanelAspect,
  ThirdLine,
  FilmCharacter,
  PanelBeat,
  FilmContext,
  GENRE_STYLE_BLOCKS,
  validateCharacterAnchor,
  buildCharacterSheetPrompt,
  buildStoryboardGridPrompt,
  buildSeedancePrompt,
  buildMultiShotSeedancePrompts,
  computeImageReferences,
  hasBracketedPlaceholders,
  findBracketedPlaceholders
} from './filmPromptTemplates';

let filmStudioInitialized = false;

type ActiveTab = 'character' | 'board' | 'video';
let currentActiveTab: ActiveTab = 'character';

let selectedCharacterIndex = 0;

// Module-local context holding current form configuration
let ctx: FilmContext = {
  genre: 'photoreal',
  characters: [],
  sceneType: 'confrontation',
  location: '',
  exclusions: '',
  panelAspect: '16:9',
  thirdLine: 'MOOD',
  beats: [],
  storyline: '',
  hasBoard: true,
  durationSeconds: 15,
  audio: 'NO MUSIC',
  isMicroDrama: false
};

function getFlattenedShots(): any[] {
  const shots: any[] = [];
  if (!state.currentScenes || state.currentScenes.length === 0) return shots;

  const isPaced = state.currentScenes[0] && typeof state.currentScenes[0].shot_number !== 'undefined';
  if (isPaced) {
    return [...state.currentScenes];
  } else {
    for (const scene of state.currentScenes) {
      if (scene && scene.lines && Array.isArray(scene.lines)) {
        for (const line of scene.lines) {
          shots.push(line);
        }
      } else if (scene) {
        shots.push(scene);
      }
    }
    return shots;
  }
}

function truncateToSlug(text: string, maxWords = 10): string {
  if (!text) return '';
  const clean = text.replace(/^(cinematic shot of|photo of|close up of|wide shot of|hyperrealistic)\s+/i, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return clean;
  return words.slice(0, maxWords).join(' ');
}

/**
 * Synchronizes Film Studio characters from state.characterProfiles without mutating state.
 */
function syncCharactersFromState(): void {
  const profiles = state.characterProfiles || [];
  if (profiles.length > 0) {
    ctx.characters = profiles.map(p => ({
      name: p.name || 'Character',
      aliases: p.aliases,
      anchor: p.appearance_anchor || '',
      hasReferenceImage: !!p.image,
      sheet_prompt: p.sheet_prompt
    }));
  } else if (ctx.characters.length === 0) {
    ctx.characters = [
      {
        name: 'Protagonist',
        anchor: 'Mid-30s woman, sharp facial features, observant amber eyes, dark auburn hair tied back in a utility knot, weathered dark leather flight jacket over charcoal knit sweater.',
        hasReferenceImage: false
      }
    ];
  }

  if (selectedCharacterIndex >= ctx.characters.length) {
    selectedCharacterIndex = 0;
  }
}

/**
 * Initializes default 9 beats if empty.
 */
function ensureNineBeats(): void {
  if (!ctx.beats || ctx.beats.length === 0) {
    const defaults: PanelBeat[] = [
      { beat: 'Protagonist arrives at the rain-soaked industrial threshold', cam: 'WIDE SHOT', move: 'STATIC', third: 'MYSTERIOUS AND FOREBODING' },
      { beat: 'Close-up on boots stepping into reflective oily puddles', cam: 'LOW ANGLE CLOSE-UP', move: 'TRACKING FORWARD', third: 'DELIBERATE PACING' },
      { beat: 'Protagonist pushes open rusted heavy warehouse door', cam: 'MEDIUM SHOT', move: 'PUSH IN', third: 'TENSION BUILDING' },
      { beat: 'Interior reveal: vast abandoned hangar with single light source', cam: 'EXTREME WIDE SHOT', move: 'SLOW PAN RIGHT', third: 'COLD INDUSTRIAL ATMOSPHERE' },
      { beat: 'Protagonist spots shadowy figure on the metal catwalk above', cam: 'OVER THE SHOULDER', move: 'TILT UP', third: 'SUDDEN SHOCK' },
      { beat: 'Antagonist glances down with cold, calculating smirk', cam: 'DUTCH ANGLE CLOSE-UP', move: 'STATIC', third: 'THREATENING AND UNSETTLING' },
      { beat: 'Protagonist draws weapon and demands accountability', cam: 'MEDIUM CLOSE-UP', move: 'SLOW PUSH IN', third: 'UNWAVERING RESOLVE' },
      { beat: 'Catwalk lights flicker as a gunshot echoes through metal girders', cam: 'HIGH ANGLE SHOT', move: 'WHIP PAN', third: 'CHAOTIC EXPLOSION OF ACTION' },
      { beat: 'Smoke clears showing empty catwalk as rain pours through ceiling', cam: 'WIDE SHOT', move: 'PULL OUT', third: 'SUSPENSEFUL CLIFFHANGER' }
    ];
    ctx.beats = defaults;
  }
}

/**
 * Renders the 9 panel beats editor in Tab 2.
 */
function renderBeatsEditor(): void {
  const container = document.getElementById('film-grid-beats-container');
  if (!container) return;

  ensureNineBeats();
  container.innerHTML = '';

  const effectiveThird = ctx.isMicroDrama ? 'VOICE' : ctx.thirdLine;

  ctx.beats.slice(0, 9).forEach((b, idx) => {
    const card = document.createElement('div');
    card.className = 'bg-zinc-900/90 border border-white/10 rounded-xl p-3 flex flex-col gap-2 relative';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between text-[11px] font-mono text-gray-400 border-b border-white/5 pb-1';
    header.innerHTML = `<span class="font-bold text-purple-300">PANEL ${idx + 1}</span><span class="text-[10px] text-gray-500">Row ${Math.floor(idx / 3) + 1}, Col ${(idx % 3) + 1}</span>`;
    card.appendChild(header);

    // Beat input
    const beatRow = document.createElement('div');
    beatRow.className = 'flex flex-col gap-1';
    beatRow.innerHTML = `
      <label for="film-beat-input-${idx}" class="text-[10px] uppercase font-bold text-gray-400">Beat (3–12 words slug)</label>
      <input type="text" id="film-beat-input-${idx}" data-beat-idx="${idx}" class="film-beat-input bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none" value="${escapeHtml(b.beat)}" placeholder="Describe action beat..." />
    `;
    card.appendChild(beatRow);

    // CAM & MOVE row
    const camMoveRow = document.createElement('div');
    camMoveRow.className = 'grid grid-cols-2 gap-2';
    camMoveRow.innerHTML = `
      <div class="flex flex-col gap-1">
        <label for="film-cam-input-${idx}" class="text-[9px] uppercase font-bold text-gray-400">CAM</label>
        <input type="text" id="film-cam-input-${idx}" data-cam-idx="${idx}" class="film-cam-input bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none uppercase" value="${escapeHtml(b.cam)}" placeholder="WIDE SHOT" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="film-move-input-${idx}" class="text-[9px] uppercase font-bold text-gray-400">MOVE</label>
        <input type="text" id="film-move-input-${idx}" data-move-idx="${idx}" class="film-move-input bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none uppercase" value="${escapeHtml(b.move)}" placeholder="STATIC" />
      </div>
    `;
    card.appendChild(camMoveRow);

    // Third line row
    const thirdRow = document.createElement('div');
    thirdRow.className = 'flex flex-col gap-1';
    const thirdPlaceholder = effectiveThird === 'VOICE' ? '"Dialogue" or (BEAT. NO WORDS.)' : effectiveThird === 'STYLE' ? 'KUNG-FU CHOREOGRAPHY' : 'TENSE SUSPENSE';
    thirdRow.innerHTML = `
      <label for="film-third-input-${idx}" class="text-[9px] uppercase font-bold text-gray-400">${effectiveThird}</label>
      <input type="text" id="film-third-input-${idx}" data-third-idx="${idx}" class="film-third-input bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:border-purple-500 focus:outline-none uppercase" value="${escapeHtml(b.third)}" placeholder="${escapeHtml(thirdPlaceholder)}" />
    `;
    card.appendChild(thirdRow);

    container.appendChild(card);
  });

  // Attach input listeners
  container.querySelectorAll<HTMLInputElement>('.film-beat-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).dataset.beatIdx!, 10);
      if (ctx.beats[idx]) {
        ctx.beats[idx].beat = (e.target as HTMLInputElement).value;
        updateActiveOutput();
      }
    });
  });

  container.querySelectorAll<HTMLInputElement>('.film-cam-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).dataset.camIdx!, 10);
      if (ctx.beats[idx]) {
        ctx.beats[idx].cam = (e.target as HTMLInputElement).value.toUpperCase();
        updateActiveOutput();
      }
    });
  });

  container.querySelectorAll<HTMLInputElement>('.film-move-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).dataset.moveIdx!, 10);
      if (ctx.beats[idx]) {
        ctx.beats[idx].move = (e.target as HTMLInputElement).value.toUpperCase();
        updateActiveOutput();
      }
    });
  });

  container.querySelectorAll<HTMLInputElement>('.film-third-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).dataset.thirdIdx!, 10);
      if (ctx.beats[idx]) {
        ctx.beats[idx].third = (e.target as HTMLInputElement).value.toUpperCase();
        updateActiveOutput();
      }
    });
  });
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pulls beats from currentScenes and populates the 9 grid beats.
 */
function pullBeatsFromStoryboard(): void {
  const flatShots = getFlattenedShots();
  if (flatShots.length === 0) {
    showStatus('No storyboard shots found in project to pull from.', true);
    return;
  }

  const beats: PanelBeat[] = [];
  const effectiveThird = ctx.isMicroDrama ? 'VOICE' : ctx.thirdLine;

  for (let i = 0; i < 9; i++) {
    if (i < flatShots.length) {
      const shot = flatShots[i];
      const rawPrompt = shot.image_prompt || shot.text_reference || shot.line_text || `Shot ${i + 1} narrative progression`;
      const beatSlug = truncateToSlug(rawPrompt, 10);
      const cam = (shot.camera_movement || shot.camera_angle || 'MEDIUM SHOT').toUpperCase().replace(/_/g, ' ');
      const move = 'STATIC';
      const third = ctx.isMicroDrama ? (shot.line_text ? `"${shot.line_text.substring(0, 30)}"` : '(BEAT. NO WORDS.)') : '';

      beats.push({
        beat: beatSlug,
        cam,
        move,
        third
      });
    } else {
      beats.push({
        beat: `Beat ${i + 1} progression`,
        cam: 'MEDIUM SHOT',
        move: 'STATIC',
        third: ctx.isMicroDrama ? '(BEAT. NO WORDS.)' : ''
      });
    }
  }

  ctx.beats = beats;
  renderBeatsEditor();
  updateActiveOutput();
  showStatus(`Pulled ${Math.min(flatShots.length, 9)} beats from storyboard shots`);
}

/**
 * Renders the character selection UI and anchor warning box for Tab 1.
 */
function renderCharacterTabUI(): void {
  const select = document.getElementById('film-char-select') as HTMLSelectElement;
  const modeBadge = document.getElementById('film-char-mode-badge') as HTMLElement;
  const anchorInput = document.getElementById('film-char-anchor-input') as HTMLTextAreaElement;
  const warningContainer = document.getElementById('film-char-warning') as HTMLElement;

  if (!select) return;

  select.innerHTML = '';
  ctx.characters.forEach((c, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `${c.name} ${c.hasReferenceImage ? '🖼️ (Mode A - Reference Image)' : '📝 (Mode B - Description)'}`;
    select.appendChild(opt);
  });

  select.value = String(selectedCharacterIndex);

  const curChar = ctx.characters[selectedCharacterIndex] || {
    name: 'Character',
    anchor: '',
    hasReferenceImage: false
  };

  if (modeBadge) {
    if (curChar.hasReferenceImage) {
      modeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 text-emerald-300 font-bold flex items-center gap-1';
      modeBadge.innerHTML = `<span>🖼️</span><span>Mode A: Reference Image Attached</span>`;
    } else {
      modeBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-950/60 text-amber-300 font-bold flex items-center gap-1';
      modeBadge.innerHTML = `<span>📝</span><span>Mode B: Description Only (No Image)</span>`;
    }
  }

  if (anchorInput) {
    anchorInput.value = curChar.anchor || '';
  }

  // Anchor validations
  if (warningContainer) {
    const warnings = validateCharacterAnchor(curChar.anchor);
    if (warnings.length > 0) {
      warningContainer.classList.remove('hidden');
      warningContainer.innerHTML = warnings.map(w => `<div class="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-lg p-2.5"><span>⚠️</span><div>${escapeHtml(w)}</div></div>`).join('');
    } else {
      warningContainer.classList.add('hidden');
      warningContainer.innerHTML = '';
    }
  }
}

/**
 * Renders Tab 3 Video Prompts controls and variant indicator.
 */
function renderVideoTabUI(): void {
  const variantBadge = document.getElementById('film-variant-badge');
  const boardCheckbox = document.getElementById('film-has-board-checkbox') as HTMLInputElement;
  const charChecklist = document.getElementById('film-video-characters-list');
  const durationInput = document.getElementById('film-duration-input') as HTMLInputElement;
  const audioInput = document.getElementById('film-audio-input') as HTMLInputElement;
  const storylineInput = document.getElementById('film-storyline-input') as HTMLTextAreaElement;

  if (boardCheckbox) {
    boardCheckbox.checked = ctx.hasBoard;
  }
  if (durationInput) {
    durationInput.value = String(ctx.durationSeconds);
  }
  if (audioInput) {
    audioInput.value = ctx.audio;
  }
  if (storylineInput) {
    storylineInput.value = ctx.storyline;
  }

  // Build character reference checklist
  if (charChecklist) {
    charChecklist.innerHTML = '';
    if (ctx.characters.length === 0) {
      charChecklist.innerHTML = '<span class="text-xs text-gray-500 italic">No characters defined.</span>';
    } else {
      ctx.characters.forEach((c, idx) => {
        const item = document.createElement('label');
        item.className = 'flex items-center gap-2 text-xs text-gray-300 cursor-pointer bg-zinc-900/60 p-2 rounded-lg border border-white/5 hover:border-white/10';
        item.innerHTML = `
          <input type="checkbox" data-char-idx="${idx}" class="film-char-sheet-toggle rounded bg-black border-white/20 text-purple-600 focus:ring-0" ${c.hasReferenceImage ? 'checked' : ''} />
          <span class="font-bold text-white">${escapeHtml(c.name)}</span>
          <span class="text-[10px] text-gray-500">(${c.hasReferenceImage ? 'Image attached' : 'No image'})</span>
        `;
        charChecklist.appendChild(item);
      });

      charChecklist.querySelectorAll<HTMLInputElement>('.film-char-sheet-toggle').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLInputElement).dataset.charIdx!, 10);
          if (ctx.characters[idx]) {
            ctx.characters[idx].hasReferenceImage = (e.target as HTMLInputElement).checked;
            renderVideoTabUI();
            updateActiveOutput();
          }
        });
      });
    }
  }

  // Update variant badge
  if (variantBadge) {
    const { variant } = buildSeedancePrompt(ctx);
    const refMap = computeImageReferences(ctx.characters, ctx.hasBoard);

    if (variant === 'A') {
      variantBadge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full border border-sky-500/40 bg-sky-950/60 text-sky-300 font-bold';
      variantBadge.textContent = 'Variant A: Freeform Timeline (no grid reference)';
    } else if (variant === 'B') {
      variantBadge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full border border-indigo-500/40 bg-indigo-950/60 text-indigo-300 font-bold';
      variantBadge.textContent = `Variant B: Storyboard Grid only (${refMap.boardReferenceTag})`;
    } else {
      variantBadge.className = 'text-[11px] font-mono px-2.5 py-1 rounded-full border border-purple-500/40 bg-purple-950/60 text-purple-300 font-bold';
      variantBadge.textContent = `Variant C: Character Sheets (${refMap.characterReferences.map(r => r.refTag).join(', ')}) + Storyboard Grid (${refMap.boardReferenceTag})`;
    }
  }
}

/**
 * Generates and displays the prompt for the active tab, checking for bracketed placeholders.
 */
function updateActiveOutput(): void {
  const outputArea = document.getElementById('film-output') as HTMLTextAreaElement;
  const copyBtn = document.getElementById('film-copy-btn') as HTMLButtonElement;
  const warningBox = document.getElementById('film-output-warning') as HTMLElement;
  const downloadBtn = document.getElementById('film-download-txt-btn') as HTMLButtonElement;

  if (!outputArea) return;

  let generatedText = '';

  if (currentActiveTab === 'character') {
    const curChar = ctx.characters[selectedCharacterIndex] || {
      name: 'Character',
      anchor: '',
      hasReferenceImage: false
    };
    generatedText = buildCharacterSheetPrompt(curChar, ctx.genre);
    if (downloadBtn) downloadBtn.classList.add('hidden');
  } else if (currentActiveTab === 'board') {
    generatedText = buildStoryboardGridPrompt(ctx);
    if (downloadBtn) downloadBtn.classList.add('hidden');
  } else {
    // Video Tab
    const flatShots = getFlattenedShots();
    if (flatShots.length > 1) {
      generatedText = buildMultiShotSeedancePrompts(flatShots, ctx);
      if (downloadBtn) downloadBtn.classList.remove('hidden');
    } else {
      generatedText = buildSeedancePrompt(ctx).prompt;
      if (downloadBtn) downloadBtn.classList.add('hidden');
    }
  }

  outputArea.value = generatedText;

  // Bracketed placeholder guard
  const hasPlaceholders = hasBracketedPlaceholders(generatedText);
  if (hasPlaceholders) {
    const found = findBracketedPlaceholders(generatedText);
    if (warningBox) {
      warningBox.classList.remove('hidden');
      warningBox.innerHTML = `<span>⚠️</span><div>Unresolved placeholder detected (${escapeHtml(found.join(', '))}). Fill in all fields before copying.</div>`;
    }
    if (copyBtn) {
      copyBtn.disabled = true;
      copyBtn.classList.add('opacity-40', 'cursor-not-allowed');
      copyBtn.classList.remove('hover:bg-purple-600', 'cursor-pointer');
      copyBtn.title = 'Resolve bracketed placeholders before copying';
    }
  } else {
    if (warningBox) {
      warningBox.classList.add('hidden');
      warningBox.innerHTML = '';
    }
    if (copyBtn) {
      copyBtn.disabled = false;
      copyBtn.classList.remove('opacity-40', 'cursor-not-allowed');
      copyBtn.classList.add('hover:bg-purple-600', 'cursor-pointer');
      copyBtn.title = 'Copy prompt to clipboard';
    }
  }
}

/**
 * Switches the active tab in the Film Studio modal.
 */
function switchTab(tab: ActiveTab): void {
  currentActiveTab = tab;

  const btnChar = document.getElementById('film-tab-character-btn');
  const btnBoard = document.getElementById('film-tab-board-btn');
  const btnVideo = document.getElementById('film-tab-video-btn');

  const panelChar = document.getElementById('film-panel-character');
  const panelBoard = document.getElementById('film-panel-board');
  const panelVideo = document.getElementById('film-panel-video');

  const activeClass = 'px-4 py-2.5 text-purple-400 border-b-2 border-purple-500 font-semibold transition-all flex items-center gap-2 cursor-pointer';
  const inactiveClass = 'px-4 py-2.5 text-gray-400 hover:text-gray-200 transition-all flex items-center gap-2 cursor-pointer';

  if (btnChar) btnChar.className = tab === 'character' ? activeClass : inactiveClass;
  if (btnBoard) btnBoard.className = tab === 'board' ? activeClass : inactiveClass;
  if (btnVideo) btnVideo.className = tab === 'video' ? activeClass : inactiveClass;

  if (panelChar) panelChar.classList.toggle('hidden', tab !== 'character');
  if (panelBoard) panelBoard.classList.toggle('hidden', tab !== 'board');
  if (panelVideo) panelVideo.classList.toggle('hidden', tab !== 'video');

  if (tab === 'character') {
    renderCharacterTabUI();
  } else if (tab === 'board') {
    renderBeatsEditor();
  } else if (tab === 'video') {
    renderVideoTabUI();
  }

  updateActiveOutput();
}

/**
 * Closes the Film Studio modal and restores body scrolling.
 */
export function closeFilmStudioModal(): void {
  const modal = document.getElementById('film-studio-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('overflow-hidden');
}

/**
 * Opens Film Studio modal and initializes form state.
 */
export function openFilmStudioModal(targetShotId?: string): void {
  const modal = document.getElementById('film-studio-modal');
  if (!modal) return;

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');

  // Sync project state
  syncCharactersFromState();

  if (state.aspectRatio === '9:16' || state.aspectRatio === '16:9') {
    ctx.panelAspect = state.aspectRatio as PanelAspect;
    const aspectSelect = document.getElementById('film-panel-aspect-select') as HTMLSelectElement;
    if (aspectSelect) aspectSelect.value = ctx.panelAspect;
  }

  ensureNineBeats();

  // If a specific shot was requested, open directly to Storyboard Grid or Video tab
  if (targetShotId) {
    switchTab('board');
  } else {
    switchTab(currentActiveTab);
  }
}

/**
 * Initializes the Film Studio modal, binds event listeners.
 */
export function initFilmStudio(): void {
  if (filmStudioInitialized) return;
  filmStudioInitialized = true;

  const modal = document.getElementById('film-studio-modal');
  if (!modal) return;

  // Launcher buttons
  const openBtn = document.getElementById('open-film-studio-btn');
  const openBtnMobile = document.getElementById('open-film-studio-btn-mobile');
  const toolbarBtn = document.getElementById('open-film-studio-toolbar-btn');
  const manualBtn = document.getElementById('manual-open-film-studio-btn');

  const handleOpen = () => openFilmStudioModal();
  openBtn?.addEventListener('click', handleOpen);
  openBtnMobile?.addEventListener('click', handleOpen);
  toolbarBtn?.addEventListener('click', () => openFilmStudioModal('grid'));
  manualBtn?.addEventListener('click', handleOpen);

  // Close button & backdrop
  const closeBtn = document.getElementById('close-film-studio-modal-btn');
  closeBtn?.addEventListener('click', () => closeFilmStudioModal());

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeFilmStudioModal();
    }
  });

  // Tab switching
  const tabCharBtn = document.getElementById('film-tab-character-btn');
  const tabBoardBtn = document.getElementById('film-tab-board-btn');
  const tabVideoBtn = document.getElementById('film-tab-video-btn');

  tabCharBtn?.addEventListener('click', () => switchTab('character'));
  tabBoardBtn?.addEventListener('click', () => switchTab('board'));
  tabVideoBtn?.addEventListener('click', () => switchTab('video'));

  // Genre selection
  const genreSelect = document.getElementById('film-genre-select') as HTMLSelectElement;
  genreSelect?.addEventListener('change', (e) => {
    ctx.genre = (e.target as HTMLSelectElement).value as FilmGenre;
    updateActiveOutput();
  });

  // Tab 1: Character selection & anchor editing
  const charSelect = document.getElementById('film-char-select') as HTMLSelectElement;
  charSelect?.addEventListener('change', (e) => {
    selectedCharacterIndex = parseInt((e.target as HTMLSelectElement).value, 10);
    renderCharacterTabUI();
    updateActiveOutput();
  });

  const charAnchorInput = document.getElementById('film-char-anchor-input') as HTMLTextAreaElement;
  charAnchorInput?.addEventListener('input', (e) => {
    const val = (e.target as HTMLTextAreaElement).value;
    if (ctx.characters[selectedCharacterIndex]) {
      ctx.characters[selectedCharacterIndex].anchor = val;
      renderCharacterTabUI();
      updateActiveOutput();
    }
  });

  // Tab 2: Pull beats from storyboard button
  const pullBeatsBtn = document.getElementById('film-pull-beats-btn');
  pullBeatsBtn?.addEventListener('click', () => pullBeatsFromStoryboard());

  // Tab 2: Scene type, location, exclusions
  const sceneTypeInput = document.getElementById('film-scene-type-input') as HTMLInputElement;
  sceneTypeInput?.addEventListener('input', (e) => {
    ctx.sceneType = (e.target as HTMLInputElement).value;
    updateActiveOutput();
  });

  const locationInput = document.getElementById('film-location-input') as HTMLInputElement;
  locationInput?.addEventListener('input', (e) => {
    ctx.location = (e.target as HTMLInputElement).value;
    updateActiveOutput();
  });

  const exclusionsInput = document.getElementById('film-exclusions-input') as HTMLInputElement;
  exclusionsInput?.addEventListener('input', (e) => {
    ctx.exclusions = (e.target as HTMLInputElement).value;
    updateActiveOutput();
  });

  // Tab 2: Panel Aspect ratio
  const panelAspectSelect = document.getElementById('film-panel-aspect-select') as HTMLSelectElement;
  panelAspectSelect?.addEventListener('change', (e) => {
    ctx.panelAspect = (e.target as HTMLSelectElement).value as PanelAspect;
    updateActiveOutput();
  });

  // Tab 2: Third line mode
  const thirdLineSelect = document.getElementById('film-third-line-select') as HTMLSelectElement;
  thirdLineSelect?.addEventListener('change', (e) => {
    ctx.thirdLine = (e.target as HTMLSelectElement).value as ThirdLine;
    renderBeatsEditor();
    updateActiveOutput();
  });

  // Tab 2: Micro-drama toggle
  const microDramaToggle = document.getElementById('film-micro-drama-toggle') as HTMLInputElement;
  microDramaToggle?.addEventListener('change', (e) => {
    ctx.isMicroDrama = (e.target as HTMLInputElement).checked;
    if (ctx.isMicroDrama) {
      ctx.thirdLine = 'VOICE';
      if (thirdLineSelect) {
        thirdLineSelect.value = 'VOICE';
        thirdLineSelect.disabled = true;
      }
    } else {
      if (thirdLineSelect) {
        thirdLineSelect.disabled = false;
      }
    }
    renderBeatsEditor();
    updateActiveOutput();
  });

  // Tab 3: Storyboard grid toggle
  const boardCheckbox = document.getElementById('film-has-board-checkbox') as HTMLInputElement;
  boardCheckbox?.addEventListener('change', (e) => {
    ctx.hasBoard = (e.target as HTMLInputElement).checked;
    renderVideoTabUI();
    updateActiveOutput();
  });

  // Tab 3: Duration input
  const durationInput = document.getElementById('film-duration-input') as HTMLInputElement;
  durationInput?.addEventListener('input', (e) => {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    ctx.durationSeconds = isNaN(val) || val <= 0 ? 15 : Math.min(val, 15);
    updateActiveOutput();
  });

  // Tab 3: Audio input
  const audioInput = document.getElementById('film-audio-input') as HTMLInputElement;
  audioInput?.addEventListener('input', (e) => {
    ctx.audio = (e.target as HTMLInputElement).value;
    updateActiveOutput();
  });

  // Tab 3: Storyline input
  const storylineInput = document.getElementById('film-storyline-input') as HTMLTextAreaElement;
  storylineInput?.addEventListener('input', (e) => {
    ctx.storyline = (e.target as HTMLTextAreaElement).value;
    updateActiveOutput();
  });

  // Copy button
  const copyBtn = document.getElementById('film-copy-btn');
  copyBtn?.addEventListener('click', () => {
    const outputArea = document.getElementById('film-output') as HTMLTextAreaElement;
    if (!outputArea || !outputArea.value) return;

    if (hasBracketedPlaceholders(outputArea.value)) {
      showStatus('Cannot copy: prompt contains unresolved [PLACEHOLDER] blocks.', true);
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(outputArea.value)
        .then(() => {
          showStatus('Copied to clipboard');
        })
        .catch(() => {
          outputArea.select();
          document.execCommand('copy');
          showStatus('Copied to clipboard');
        });
    } else {
      outputArea.select();
      document.execCommand('copy');
      showStatus('Copied to clipboard');
    }
  });

  // Download all as .txt button
  const downloadBtn = document.getElementById('film-download-txt-btn');
  downloadBtn?.addEventListener('click', () => {
    const outputArea = document.getElementById('film-output') as HTMLTextAreaElement;
    if (!outputArea || !outputArea.value) return;

    const blob = new Blob([outputArea.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seedance_film_prompts.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Downloaded seedance_film_prompts.txt');
  });

  // Initial render
  syncCharactersFromState();
}
