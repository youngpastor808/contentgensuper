/**
 * Feature-flagged Video Studio Workspace for ContentGen Video Director (Phases 3–5).
 * Re-houses existing DOM elements via reparenting so all src/dom.ts references,
 * event listeners, and clipboard checks remain 100% intact.
 */
import * as dom from './dom';
import { drawVideoFrame } from './videoRenderer';
import { state } from './state';
import { getActiveAspectRatio } from './handlers-effects';

const WORKSPACE_FLAG_KEY = 'cg_flag_vs_workspace';

export function isVsWorkspaceEnabled(): boolean {
  if (typeof window !== 'undefined' && typeof (window as any).__CG_VS_WORKSPACE === 'boolean') {
    return (window as any).__CG_VS_WORKSPACE;
  }
  try {
    return localStorage.getItem(WORKSPACE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setVsWorkspaceEnabled(enabled: boolean): void {
  if (enabled) {
    const mounted = activateVsWorkspace();
    try { localStorage.setItem(WORKSPACE_FLAG_KEY, mounted ? '1' : '0'); } catch {}
    return;
  }
  deactivateVsWorkspace();
  try { localStorage.setItem(WORKSPACE_FLAG_KEY, '0'); } catch {}
}

interface ReparentRecord {
  el: HTMLElement;
  originalParent: HTMLElement;
  nextSibling: ChildNode | null;
  originalClassName: string;
}

const movedNodes: ReparentRecord[] = [];
let shellEl: HTMLDivElement | null = null;
let graphicsLayoutScaffold: { gallery: HTMLElement; layout: HTMLElement; categoryRow: HTMLElement } | null = null;
let workspaceToggleInitialized = false;
let workspaceModalLifecycleInitialized = false;

/**
 * Move existing controls rather than cloning them. Their IDs and attached event
 * listeners remain intact; the original parent/order/classes are restored on exit.
 */
function moveNode(el: HTMLElement | null | undefined, targetSlot: HTMLElement | null): void {
  if (!el || !targetSlot || el.parentElement === targetSlot) return;
  const parent = el.parentElement;
  if (!parent) return;
  movedNodes.push({
    el,
    originalParent: parent,
    nextSibling: el.nextSibling,
    originalClassName: el.className,
  });
  targetSlot.appendChild(el);
}

function restoreAllMovedNodes(): void {
  while (movedNodes.length > 0) {
    const rec = movedNodes.pop()!;
    try {
      if (rec.nextSibling && rec.nextSibling.parentNode === rec.originalParent) {
        rec.originalParent.insertBefore(rec.el, rec.nextSibling);
      } else {
        rec.originalParent.appendChild(rec.el);
      }
      rec.el.className = rec.originalClassName;
    } catch (err) {
      console.warn('[VS Workspace] Failed to restore node:', err);
    }
  }
}

/**
 * Organizes the existing Graphics tab as a reference-style sidebar + searchable
 * preset gallery. All original nodes are moved through moveNode(), so leaving
 * Studio UI restores their exact original parents and order.
 */
function organizeGraphicsBrowser(): void {
  const gallery = document.getElementById('motion-graphics-panel');
  const categories = document.getElementById('mg-category-tabs');
  const search = document.getElementById('mg-preset-search') as HTMLInputElement | null;
  if (!gallery || !categories || !search || graphicsLayoutScaffold) return;

  // In the real ContentGen markup, the heading, category row, prompt and card grid
  // live inside a single inner wrapper. Build the new layout inside that wrapper
  // instead of trying to insert a child relative to a nested element of the gallery.
  const container = gallery.firstElementChild as HTMLElement | null;
  const headingToolbar = container?.firstElementChild as HTMLElement | null;
  const categoryRow = categories.parentElement as HTMLElement | null;
  const searchWrap = search.parentElement as HTMLElement | null;
  if (!container || !headingToolbar || !categoryRow || !searchWrap || categoryRow.parentElement !== container) return;

  const layout = document.createElement('div');
  layout.className = 'vs-mg-body';
  layout.id = 'vs-mg-workspace-layout';

  const sidebar = document.createElement('aside');
  sidebar.className = 'vs-mg-sidebar';
  sidebar.setAttribute('aria-label', 'Graphics categories');

  const main = document.createElement('div');
  main.className = 'vs-mg-main';
  const toolbar = document.createElement('div');
  toolbar.className = 'vs-mg-toolbar';
  const scroll = document.createElement('div');
  scroll.className = 'vs-mg-scroll';
  scroll.id = 'vs-mg-scroll';

  // Track these moves so Classic UI restores the original hierarchy and order.
  moveNode(categories, sidebar);
  moveNode(searchWrap, toolbar);
  main.append(toolbar, scroll);
  layout.append(sidebar, main);

  // Keep the empty row as an anchor so category/search controls restore exactly.
  categoryRow.classList.add('vs-mg-category-row-stub');
  container.insertBefore(layout, categoryRow);
  graphicsLayoutScaffold = { gallery, layout, categoryRow };

  // Move the AI prompt, preset grid, placed-graphics list and other content into
  // the scroll region. Keep the title/actions row fixed above the gallery.
  const originalChildren = Array.from(container.children) as HTMLElement[];
  for (const child of originalChildren) {
    if (child === headingToolbar || child === layout || child === categoryRow) continue;
    if (child.contains(layout)) continue;
    moveNode(child, scroll);
  }
}

function restoreGraphicsBrowserScaffold(): void {
  if (!graphicsLayoutScaffold) return;
  graphicsLayoutScaffold.categoryRow.classList.remove('vs-mg-category-row-stub');
  graphicsLayoutScaffold.layout.remove();
  graphicsLayoutScaffold = null;
}

function makeEffectsLauncher(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'vs-launch-card';
  card.innerHTML = `
    <div class="vs-launch-icon">✦</div>
    <h3>Visual Effects & Color</h3>
    <p>Open the existing effects workspace for grading, VFX and visual treatments.</p>
    <button type="button" class="vs-btn primary" id="vs-open-effects-btn">Open FX Studio</button>
  `;
  card.querySelector('#vs-open-effects-btn')?.addEventListener('click', () => {
    document.getElementById('vfx-studio-video-director-btn')?.click();
  });
  return card;
}

export function initVsWorkspaceToggle(): void {
  if (!workspaceToggleInitialized) {
    const originalExport = document.getElementById('video-export-btn');
    if (originalExport?.parentElement) {
      let toggle = document.getElementById('cg-open-studio-ui-btn') as HTMLButtonElement | null;
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = 'cg-open-studio-ui-btn';
        toggle.className = 'vs-inline-toggle';
        toggle.textContent = '✦ Studio UI';
        toggle.title = 'Open the professional Video Director workspace';
        originalExport.parentElement.insertBefore(toggle, originalExport);
      }
      toggle.addEventListener('click', () => setVsWorkspaceEnabled(true));
    }
    workspaceToggleInitialized = true;
  }

  // Do not reparent global app panels during application startup while the
  // Video Director modal is hidden. If Studio UI was the previous preference,
  // mount it only after a real open event.
  if (!workspaceModalLifecycleInitialized) {
    window.addEventListener('contentgen:video-director-opened', () => {
      if (!isVsWorkspaceEnabled() || shellEl) return;
      requestAnimationFrame(() => {
        if (isVsWorkspaceEnabled() && !shellEl) activateVsWorkspace();
      });
    });
    window.addEventListener('contentgen:video-director-closing', () => {
      if (shellEl) deactivateVsWorkspace();
    });
    workspaceModalLifecycleInitialized = true;
  }

  (window as any).toggleStudioWorkspace = () => setVsWorkspaceEnabled(!shellEl);
}

export function activateVsWorkspace(): boolean {
  if (shellEl) return true;

  const directorRoot = document.getElementById('video-director-modal');
  const mainView = document.getElementById('video-director-main-view');
  if (!directorRoot || !mainView) {
    console.warn('[VS Workspace] Video Director has not been initialized; keeping the classic layout.');
    return false;
  }

  try {
    const legacyHeader = Array.from(mainView.children).find((node) =>
      (node as HTMLElement).querySelector?.('#video-export-btn')
    ) as HTMLElement | undefined;
    const legacyWorkspace = Array.from(mainView.children).find((node) =>
      (node as HTMLElement).querySelector?.('#video-preview-container-area')
    ) as HTMLElement | undefined;
    const productionSidebar = legacyWorkspace
      ? (Array.from(legacyWorkspace.children).find((node) =>
          (node as HTMLElement).textContent?.includes('Production Settings') &&
          (node as HTMLElement).querySelector('details')
        ) as HTMLElement | undefined)
      : undefined;

    shellEl = document.createElement('div');
    shellEl.id = 'vs-director-shell';
    shellEl.className = 'vs-director';
    shellEl.innerHTML = `
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" id="vs-back-to-storyboard-btn" class="vs-btn subtle" title="Close the Video Director and return to the storyboard">← Storyboard</button>
          <button type="button" id="vs-mobile-library-btn" class="vs-btn subtle vs-mobile-library-toggle" aria-controls="vs-left-assets-panel" aria-expanded="false" title="Open the Library panel">☷ Library</button>
          <div class="vs-brand-lockup"><span class="vs-brand-mark">CG</span><div><strong>ContentGen Studio</strong><small>Video Editor</small></div></div>
        </div>
        <div class="topbar-center" id="vs-topbar-center-slot" aria-label="Preview and composition controls"></div>
        <div class="topbar-right" id="vs-topbar-right-slot">
          <button type="button" id="vs-export-video-btn" class="vs-btn primary" title="Export the current video">↓ Export</button>
          <button type="button" id="vs-close-director-btn" class="vs-icon-btn" title="Close Video Director" aria-label="Close Video Director">×</button>
          <button type="button" id="vs-exit-classic-btn" class="vs-btn subtle" title="Switch back to the original ContentGen layout">Classic UI</button>
        </div>
      </header>
      <div class="workspace" id="vs-workspace-grid">
        <div class="upper" id="vs-upper-grid">
          <section class="panel assets-panel" id="vs-left-assets-panel" aria-label="Asset browser">
            <div class="panel-head assets-panel-head"><span class="panel-heading">Library</span><span class="panel-kicker">Browse & add</span></div>
            <div class="tablist asset-tabs" role="tablist" aria-label="Asset categories">
              <button type="button" class="tab" role="tab" aria-selected="true" data-vs-left-tab="graphics">▧ Graphics</button>
              <button type="button" class="tab" role="tab" aria-selected="false" data-vs-left-tab="audio">♫ Audio</button>
              <button type="button" class="tab" role="tab" aria-selected="false" data-vs-left-tab="captions">T Captions</button>
              <button type="button" class="tab" role="tab" aria-selected="false" data-vs-left-tab="effects">✦ Effects</button>
            </div>
            <div class="assets-body" id="vs-left-tab-graphics"></div>
            <div class="assets-body hidden" id="vs-left-tab-audio"><div class="vs-section-intro"><strong>Audio & voice</strong><span>Existing narration and music controls</span></div></div>
            <div class="assets-body hidden" id="vs-left-tab-captions"><div class="vs-section-intro"><strong>Captions & subtitles</strong><span>Existing subtitle controls</span></div></div>
            <div class="assets-body hidden" id="vs-left-tab-effects"><div class="vs-section-intro"><strong>Visual effects</strong><span>Open the existing effects studio</span></div></div>
          </section>
          <div class="resizer v" id="vs-resizer-left" role="separator" aria-orientation="vertical" aria-label="Resize library panel"></div>
          <section class="panel player-panel" id="vs-center-player-panel" aria-label="Video preview">
            <div class="player-panel-head"><span class="panel-heading">Preview</span><span class="panel-kicker">Program monitor</span></div>
          </section>
          <div class="resizer v" id="vs-resizer-right" role="separator" aria-orientation="vertical" aria-label="Resize inspector panel"></div>
          <aside class="panel inspector" id="vs-right-inspector-panel" aria-label="Inspector">
            <div class="panel-head inspector-panel-head"><span class="panel-heading">Inspector</span><span class="panel-kicker" id="vs-inspector-context">Shot properties</span></div>
            <div class="insp-tabs top-tabs" role="tablist" aria-label="Inspector sections">
              <button type="button" class="insp-tab" role="tab" aria-selected="true" data-vs-insp-tab="shot">Shot</button>
              <button type="button" class="insp-tab" role="tab" aria-selected="false" data-vs-insp-tab="cinema">Cinematography</button>
              <button type="button" class="insp-tab" role="tab" aria-selected="false" data-vs-insp-tab="production">Production</button>
            </div>
            <div class="inspector-body" id="vs-insp-tab-shot"></div>
            <div class="inspector-body hidden" id="vs-insp-tab-cinema">
              <div class="vs-section-intro"><strong>Camera & movement</strong><span>Shot-level cinematography and keyframes</span></div>
              <button type="button" class="vs-btn primary full" id="vs-open-camera-keyframes-btn">Open Camera Keyframes</button>
              <div id="vs-cinema-controls-slot"></div>
              <div id="vs-cinema-keyframes-slot"></div>
            </div>
            <div class="inspector-body hidden" id="vs-insp-tab-production">
              <div class="vs-section-intro"><strong>Production controls</strong><span>All original workflow controls stay available</span></div>
              <details class="vs-workflow-details"><summary>Workflow, project & export controls</summary><div id="vs-legacy-controls-body"></div></details>
              <div id="vs-production-sidebar-slot"></div>
            </div>
          </aside>
        </div>
        <div class="resizer h" id="vs-resizer-timeline" role="separator" aria-orientation="horizontal" aria-label="Resize timeline"></div>
        <section class="panel timeline-panel" id="vs-bottom-timeline-slot" aria-label="Multitrack timeline">
          <div class="panel-head timeline-panel-head"><span class="panel-heading">Timeline</span><span class="panel-kicker">Edit, trim and arrange</span></div>
        </section>
      </div>
    `;
    directorRoot.prepend(shellEl);

    const graphicsSlot = shellEl.querySelector<HTMLElement>('#vs-left-tab-graphics');
    const audioSlot = shellEl.querySelector<HTMLElement>('#vs-left-tab-audio');
    const captionsSlot = shellEl.querySelector<HTMLElement>('#vs-left-tab-captions');
    const effectsSlot = shellEl.querySelector<HTMLElement>('#vs-left-tab-effects');
    const previewSlot = shellEl.querySelector<HTMLElement>('#vs-center-player-panel');
    const timelineSlot = shellEl.querySelector<HTMLElement>('#vs-bottom-timeline-slot');
    const shotSlot = shellEl.querySelector<HTMLElement>('#vs-insp-tab-shot');
    const cinemaSlot = shellEl.querySelector<HTMLElement>('#vs-insp-tab-cinema');
    const cinemaControlsSlot = shellEl.querySelector<HTMLElement>('#vs-cinema-controls-slot');
    const cinemaKeyframesSlot = shellEl.querySelector<HTMLElement>('#vs-cinema-keyframes-slot');
    const productionSlot = shellEl.querySelector<HTMLElement>('#vs-production-sidebar-slot');
    const legacyHeaderSlot = shellEl.querySelector<HTMLElement>('#vs-legacy-controls-body');
    const topbarCenter = shellEl.querySelector<HTMLElement>('#vs-topbar-center-slot');

    // Rehome the original application elements. No video/timeline/graphics logic is cloned.
    const graphicsPanel = document.getElementById('panel-graphics');
    if (graphicsPanel && graphicsSlot) {
      moveNode(graphicsPanel, graphicsSlot);
      graphicsPanel.classList.add('vs-workspace-panel');
    }

    const previewArea = document.getElementById('video-preview-container-area');
    if (previewArea && previewSlot) {
      moveNode(previewArea, previewSlot);
      previewArea.classList.add('vs-workspace-preview');
    }

    const timeline = document.getElementById('timeline-editor-container');
    if (timeline && timelineSlot) {
      moveNode(timeline, timelineSlot);
      timeline.classList.remove('hidden');
      timeline.classList.add('flex', 'vs-workspace-timeline');
    }

    if (dom.shotInspectorDrawer && shotSlot) {
      moveNode(dom.shotInspectorDrawer, shotSlot);
      dom.shotInspectorDrawer.classList.remove('hidden', 'translate-x-full');
      dom.shotInspectorDrawer.classList.add('vs-workspace-docked');
      mountInspectorPositionGlyphs();
      mountInspectorSpeedChips();
    }

    const ckfPanel = document.getElementById('ckf-panel');
    if (ckfPanel && cinemaKeyframesSlot) {
      moveNode(ckfPanel, cinemaKeyframesSlot);
      ckfPanel.classList.add('vs-workspace-ckf');
      // Retain the hidden state. The existing button opens it and initializes the selected clip.
    }

    // Move the complete old header into a collapsible section, keeping every original
    // button and listener reachable. The new top-bar export button proxies the old one.
    if (legacyHeader && legacyHeaderSlot) moveNode(legacyHeader, legacyHeaderSlot);
    if (productionSidebar && productionSlot) {
      moveNode(productionSidebar, productionSlot);
      productionSidebar.classList.add('vs-workspace-production');
    }

    const narrationAccordion = document.getElementById('director-accordion-narration');
    const musicAccordion = document.getElementById('director-accordion-music');
    const subtitlesAccordion = document.getElementById('director-accordion-subtitles');
    const cinemaAccordion = document.getElementById('director-accordion-cinema');
    if (narrationAccordion && audioSlot) {
      moveNode(narrationAccordion, audioSlot);
      narrationAccordion.classList.add('vs-workspace-accordion');
    }
    if (musicAccordion && audioSlot) {
      moveNode(musicAccordion, audioSlot);
      musicAccordion.classList.add('vs-workspace-accordion');
    }
    if (subtitlesAccordion && captionsSlot) {
      moveNode(subtitlesAccordion, captionsSlot);
      subtitlesAccordion.classList.add('vs-workspace-accordion');
    }
    if (cinemaAccordion && cinemaControlsSlot) {
      moveNode(cinemaAccordion, cinemaControlsSlot);
      cinemaAccordion.classList.add('vs-workspace-accordion');
    }

    // Keep the actual aspect/resolution controls wired to their original handlers.
    const aspectSelect = document.getElementById('video-director-aspect-select');
    const previewResolutionSelect = document.getElementById('video-preview-resolution-select');
    const responsivePreviewToggle = document.getElementById('video-responsive-preview-toggle');
    if (aspectSelect?.parentElement && topbarCenter) moveNode(aspectSelect.parentElement, topbarCenter);
    if (previewResolutionSelect?.parentElement && topbarCenter) moveNode(previewResolutionSelect.parentElement, topbarCenter);
    if (responsivePreviewToggle?.parentElement && topbarCenter) moveNode(responsivePreviewToggle.parentElement, topbarCenter);

    organizeGraphicsBrowser();
    if (effectsSlot) effectsSlot.appendChild(makeEffectsLauncher());

    // Tabs share one small controller. Every panel remains the original DOM node.
    shellEl.querySelectorAll<HTMLButtonElement>('[data-vs-left-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.vsLeftTab || 'graphics';
        shellEl?.querySelectorAll<HTMLButtonElement>('[data-vs-left-tab]').forEach((b) => {
          b.setAttribute('aria-selected', String(b === btn));
        });
        ['graphics', 'audio', 'captions', 'effects'].forEach((key) => {
          shellEl?.querySelector(`#vs-left-tab-${key}`)?.classList.toggle('hidden', key !== target);
        });
      });
    });

    shellEl.querySelectorAll<HTMLButtonElement>('[data-vs-insp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.vsInspTab || 'shot';
        shellEl?.querySelectorAll<HTMLButtonElement>('[data-vs-insp-tab]').forEach((b) => {
          b.setAttribute('aria-selected', String(b === btn));
        });
        ['shot', 'cinema', 'production'].forEach((key) => {
          shellEl?.querySelector(`#vs-insp-tab-${key}`)?.classList.toggle('hidden', key !== target);
        });
        const context = shellEl?.querySelector<HTMLElement>('#vs-inspector-context');
        if (context) context.textContent = target === 'cinema' ? 'Camera & movement' : target === 'production' ? 'Workflow settings' : 'Shot properties';
      });
    });

    shellEl.querySelector('#vs-open-camera-keyframes-btn')?.addEventListener('click', () => {
      // The existing delegated handler resolves the selected clip and initializes controls.
      const panel = document.getElementById('ckf-panel');
      if (panel?.classList.contains('hidden')) {
        (document.getElementById('cinematography-cam-btn') || document.getElementById('ckf-fab'))?.click();
      }
      shellEl?.querySelector<HTMLButtonElement>('[data-vs-insp-tab="cinema"]')?.click();
    });
    shellEl.querySelector('#vs-export-video-btn')?.addEventListener('click', () => {
      document.getElementById('video-export-btn')?.click();
    });
    const mobileLibraryButton = shellEl.querySelector<HTMLButtonElement>('#vs-mobile-library-btn');
    const libraryPanel = shellEl.querySelector<HTMLElement>('#vs-left-assets-panel');
    mobileLibraryButton?.addEventListener('click', () => {
      if (!libraryPanel || !mobileLibraryButton) return;
      const isOpen = libraryPanel.classList.toggle('vs-mobile-library-open');
      mobileLibraryButton.setAttribute('aria-expanded', String(isOpen));
      mobileLibraryButton.title = isOpen ? 'Close the Library panel' : 'Open the Library panel';
    });
    shellEl.querySelector('#vs-close-director-btn')?.addEventListener('click', () => {
      // Restore global panels before hiding the modal so the classic app never
      // loses the Graphics panel or leaves controls trapped in a hidden workspace.
      deactivateVsWorkspace();
      document.getElementById('close-video-director-modal-btn')?.click();
    });
    shellEl.querySelector('#vs-back-to-storyboard-btn')?.addEventListener('click', () => {
      deactivateVsWorkspace();
      document.getElementById('close-video-director-modal-btn')?.click();
    });
    shellEl.querySelector('#vs-exit-classic-btn')?.addEventListener('click', () => setVsWorkspaceEnabled(false));

    bindResizers(shellEl);
    mountPlayerStageOverlays();
    initStudioCommandPalette();

    // Refresh canvas sizing after its container moves to the Studio layout.
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
    });
    return true;
  } catch (err) {
    console.error('[VS Workspace] Failed to initialize, restoring classic layout:', err);
    deactivateVsWorkspace();
    return false;
  }
}

export function deactivateVsWorkspace(): void {
  restoreAllMovedNodes();
  restoreGraphicsBrowserScaffold();
  if (shellEl) {
    shellEl.remove();
    shellEl = null;
  }
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
  });
}

function bindResizers(root: HTMLElement): void {
  const upper = root.querySelector<HTMLElement>('#vs-upper-grid');
  const workspace = root.querySelector<HTMLElement>('#vs-workspace-grid');
  const leftResizer = root.querySelector<HTMLElement>('#vs-resizer-left');
  const rightResizer = root.querySelector<HTMLElement>('#vs-resizer-right');
  const tlResizer = root.querySelector<HTMLElement>('#vs-resizer-timeline');

  const attachDrag = (el: HTMLElement | null, onMove: (e: PointerEvent) => void) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = (ev: PointerEvent) => onMove(ev);
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        // Redraw current frame without changing internal canvas resolution
        drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  };

  attachDrag(leftResizer, (e) => {
    if (!upper) return;
    const rect = upper.getBoundingClientRect();
    const w = Math.max(260, Math.min(520, e.clientX - rect.left));
    upper.style.setProperty('--left-w', `${Math.round(w)}px`);
  });

  attachDrag(rightResizer, (e) => {
    if (!upper) return;
    const rect = upper.getBoundingClientRect();
    const w = Math.max(280, Math.min(520, rect.right - e.clientX));
    upper.style.setProperty('--right-w', `${Math.round(w)}px`);
  });

  attachDrag(tlResizer, (e) => {
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const ratio = Math.max(0.35, Math.min(0.75, (e.clientY - rect.top) / rect.height));
    // Use grid fr tracks rather than CSS calc(number * percent), which is not
    // consistently supported by browsers. The ratio still updates smoothly.
    workspace.style.gridTemplateRows = `minmax(185px, ${Math.round(ratio * 100)}fr) 5px minmax(170px, ${Math.round((1 - ratio) * 100)}fr)`;
  });
}


/**
 * Docks #graphic-editor-modal inside the Right Inspector when the video-studio
 * workspace is active, or leaves it as a modal dialog in classic mode.
 */
export function syncGraphicEditorToInspector(): void {
  const modal = document.getElementById('graphic-editor-modal');
  const rightInspector = document.getElementById('vs-right-inspector-panel');
  if (!modal) return;

  modal.classList.add('vs-inspector-scope');

  if (!isVsWorkspaceEnabled() || !rightInspector) {
    modal.classList.remove('is-docked');
    return;
  }

  // Create the Graphic Inspector tab slot once if not present
  let graphicSlot = document.getElementById('vs-insp-tab-graphic');
  const tabBar = rightInspector.querySelector('.insp-tabs.top-tabs');

  if (!graphicSlot && tabBar) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = 'insp-tab';
    tabBtn.setAttribute('role', 'tab');
    tabBtn.setAttribute('aria-selected', 'false');
    tabBtn.dataset.vsInspTab = 'graphic';
    tabBtn.textContent = 'Graphic';
    tabBar.appendChild(tabBtn);

    graphicSlot = document.createElement('div');
    graphicSlot.id = 'vs-insp-tab-graphic';
    graphicSlot.className = 'inspector-body hidden';
    graphicSlot.style.cssText = 'flex:1;overflow-y:auto;';
    rightInspector.appendChild(graphicSlot);

    tabBtn.addEventListener('click', () => {
      rightInspector.querySelectorAll<HTMLButtonElement>('[data-vs-insp-tab]').forEach((b) => {
        b.setAttribute('aria-selected', String(b === tabBtn));
      });
      ['shot', 'cinema', 'graphic'].forEach((k) => {
        rightInspector.querySelector(`#vs-insp-tab-${k}`)?.classList.toggle('hidden', k !== 'graphic');
      });
    });
  }

  if (graphicSlot && modal.parentElement !== graphicSlot) {
    modal.classList.add('is-docked');
    graphicSlot.appendChild(modal);
  }
}

/**
 * Automatically injects video-studio timeline and track CSS classes onto
 * ContentGen's rendered timeline elements without altering internal DOM IDs or state.
 */
export function enhanceTimelineDom(): void {
  const container = document.getElementById('timeline-editor-container');
  if (!container) return;

  // Mark container with video-studio styling scope
  container.classList.add('vs-timeline-shell');

  // Assign track row classes based on order or data attributes
  container.querySelectorAll<HTMLElement>('.tl-lane, tr, [data-track-lane]').forEach((lane, idx) => {
    if (idx === 0) lane.classList.add('main', 'is-main');
    else if (lane.textContent?.toLowerCase().includes('audio') || lane.textContent?.toLowerCase().includes('voice')) {
      lane.classList.add('audio', 'is-audio');
    } else {
      lane.classList.add('overlay', 'is-overlay');
    }
  });

  // Assign clip classes
  container.querySelectorAll<HTMLElement>('.tl-clip, [data-clip-id]').forEach((clip) => {
    if (!clip.classList.contains('tl-clip')) clip.classList.add('tl-clip');
    if (clip.dataset.type === 'image' || clip.dataset.type === 'video') {
      clip.classList.add('kind-video');
    } else if (clip.dataset.type === 'audio') {
      clip.classList.add('kind-audio');
    } else if (clip.dataset.type === 'text') {
      clip.classList.add('kind-text');
    }
  });
}

interface PosGlyphSpec {
  value: string;
  label: string;
  glyphClass: string;
  title: string;
}

const PIP_CORNER_GLYPHS: PosGlyphSpec[] = [
  { value: 'top_left', label: 'TL', glyphClass: 'pos-tl', title: 'Top Left' },
  { value: 'top_right', label: 'TR', glyphClass: 'pos-tr', title: 'Top Right' },
  { value: 'center_left', label: 'CL', glyphClass: 'pos-cl', title: 'Center Left' },
  { value: 'center_right', label: 'CR', glyphClass: 'pos-cr', title: 'Center Right' },
  { value: 'bottom_left', label: 'BL', glyphClass: 'pos-bl', title: 'Bottom Left' },
  { value: 'bottom_right', label: 'BR', glyphClass: 'pos-br', title: 'Bottom Right' },
  { value: 'custom', label: 'Drag', glyphClass: 'pos-custom', title: 'Custom (Drag on Canvas)' },
];

const TALKING_HEAD_GLYPHS: PosGlyphSpec[] = [
  { value: 'none', label: 'Off', glyphClass: 'pos-none', title: 'Hidden (B-Roll Only)' },
  { value: 'full', label: 'Full', glyphClass: 'pos-full', title: 'Full Screen A-Roll' },
  { value: 'split', label: 'Split', glyphClass: 'pos-split', title: 'Split Screen' },
  { value: 'pip-tl', label: 'TL', glyphClass: 'pos-tl', title: 'Corner PiP (Top Left)' },
  { value: 'pip-tr', label: 'TR', glyphClass: 'pos-tr', title: 'Corner PiP (Top Right)' },
  { value: 'pip-bl', label: 'BL', glyphClass: 'pos-bl', title: 'Corner PiP (Bottom Left)' },
  { value: 'pip-br', label: 'BR', glyphClass: 'pos-br', title: 'Corner PiP (Bottom Right)' },
];

export function syncActivePositionGlyphButton(stripEl: HTMLElement, activeValue: string): void {
  const btns = stripEl.querySelectorAll<HTMLButtonElement>('.vs-pos-btn');
  btns.forEach((btn) => {
    const val = btn.dataset.value || btn.dataset.posValue;
    const isMatch = val === activeValue || val?.replace(/_/g, '-') === activeValue?.replace(/_/g, '-');
    btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    btn.setAttribute('aria-checked', isMatch ? 'true' : 'false');
  });
}

export function syncActiveSpeedChip(stripEl: HTMLElement, activeSpeed: number): void {
  const chips = stripEl.querySelectorAll<HTMLButtonElement>('.vs-speed-chip, .chip');
  chips.forEach((chip) => {
    const spd = parseFloat(chip.dataset.speed || chip.dataset.speedVal || '1');
    chip.setAttribute('aria-pressed', Math.abs(spd - activeSpeed) < 0.05 ? 'true' : 'false');
  });
}

export function attachGlyphStripToSelect(
  selectEl: HTMLSelectElement | null,
  optionsOrStripId: Array<{ value: string; label: string; iconClass?: string }> | string,
  specsArg?: PosGlyphSpec[]
): HTMLDivElement | null {
  if (!selectEl) return null;

  if (typeof optionsOrStripId === 'string') {
    const stripId = optionsOrStripId;
    const specs = specsArg || [];
    const existing = document.getElementById(stripId);
    if (existing) {
      (existing as any).__sync?.();
      return existing as HTMLDivElement;
    }

    const strip = document.createElement('div');
    strip.id = stripId;
    strip.className = 'vs-pos-strip';
    strip.setAttribute('role', 'radiogroup');

    const validValues = new Set(Array.from(selectEl.options).map((o) => o.value));
    const activeSpecs = specs.filter((s) => validValues.size === 0 || validValues.has(s.value));

    for (const spec of activeSpecs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vs-pos-btn';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(selectEl.value === spec.value));
      btn.setAttribute('aria-pressed', String(selectEl.value === spec.value));
      btn.dataset.posValue = spec.value;
      btn.dataset.value = spec.value;
      btn.title = spec.title || spec.label;
      btn.innerHTML = `<span class="pos-glyph ${spec.glyphClass}" aria-hidden="true"></span><span>${spec.label}</span>`;

      btn.addEventListener('click', () => {
        if (selectEl.value !== spec.value) {
          selectEl.value = spec.value;
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncActivePositionGlyphButton(strip, selectEl.value);
      });

      strip.appendChild(btn);
    }

    function syncGlyphSelection() {
      syncActivePositionGlyphButton(strip, selectEl!.value);
    }

    (strip as any).__sync = syncGlyphSelection;

    selectEl.addEventListener('change', syncGlyphSelection);
    const observer = new MutationObserver(syncGlyphSelection);
    observer.observe(selectEl, { attributes: true, childList: true, subtree: true });

    const row = selectEl.closest('.insp-row') || selectEl;
    row.insertAdjacentElement('afterend', strip);
    return strip;
  } else {
    const options = optionsOrStripId;
    let strip = selectEl.nextElementSibling as HTMLDivElement | null;
    if (!strip || !strip.classList.contains('vs-pos-strip')) {
      strip = document.createElement('div');
      strip.className = 'vs-pos-strip';
      selectEl.insertAdjacentElement('afterend', strip);
    } else {
      strip.innerHTML = '';
    }

    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vs-pos-btn';
      btn.dataset.value = opt.value;
      btn.dataset.posValue = opt.value;
      btn.title = opt.label;
      btn.setAttribute('aria-pressed', selectEl.value === opt.value ? 'true' : 'false');
      btn.setAttribute('aria-checked', selectEl.value === opt.value ? 'true' : 'false');

      if (opt.iconClass) {
        const icon = document.createElement('i');
        icon.className = opt.iconClass;
        btn.appendChild(icon);
      }
      const labelSpan = document.createElement('span');
      labelSpan.textContent = opt.label;
      btn.appendChild(labelSpan);

      btn.addEventListener('click', () => {
        if (selectEl.value !== opt.value) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncActivePositionGlyphButton(strip!, selectEl.value);
      });

      strip!.appendChild(btn);
    });

    const syncFn = () => syncActivePositionGlyphButton(strip!, selectEl.value);
    (strip as any).__sync = syncFn;
    selectEl.addEventListener('change', syncFn);

    return strip;
  }
}

/**
 * Mounts visual position glyph buttons for both B-Roll PiP Corner
 * (#inspector-pip-position-select) and Presenter Talking Head framing
 * (#inspector-talking-head-mode-select).
 */
export function mountInspectorPositionGlyphs(): void {
  const pipSelect = document.getElementById('inspector-pip-position-select') as HTMLSelectElement | null;
  const thSelect = document.getElementById('inspector-talking-head-mode-select') as HTMLSelectElement | null;

  attachGlyphStripToSelect(pipSelect, 'vs-pip-pos-glyph-strip', PIP_CORNER_GLYPHS);
  attachGlyphStripToSelect(thSelect, 'vs-th-pos-glyph-strip', TALKING_HEAD_GLYPHS);
}

/**
 * Mounts video-studio's one-click speed preset chips (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
 * directly beneath #inspector-clip-speed-slider.
 */
export function mountInspectorSpeedChips(): void {
  const slider = document.getElementById('inspector-clip-speed-slider') as HTMLInputElement | null;
  const label = document.getElementById('inspector-clip-speed-label');
  if (!slider) return;
  const existingChips = document.getElementById('vs-inspector-speed-chips');
  if (existingChips) {
    (existingChips as any).__sync?.();
    return;
  }

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const chipRow = document.createElement('div');
  chipRow.id = 'vs-inspector-speed-chips';
  chipRow.className = 'vs-speed-chips-strip chip-row';
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'Speed Presets');

  const currentVal = parseFloat(slider.value) || 1.0;

  for (const s of speeds) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'vs-speed-chip chip';
    chip.dataset.speed = String(s);
    chip.dataset.speedVal = String(s);
    chip.textContent = `${s}x`;
    chip.setAttribute('aria-pressed', Math.abs(currentVal - s) < 0.05 ? 'true' : 'false');

    chip.addEventListener('click', () => {
      slider.value = String(s);
      if (label) label.textContent = `${s}x`;
      // Fire both 'input' (live preview) and 'change' (history/state commit)
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      syncActiveSpeedChip(chipRow, s);
    });

    chipRow.appendChild(chip);
  }

  function syncActive() {
    const val = parseFloat(slider!.value || '1');
    syncActiveSpeedChip(chipRow, val);
  }

  (chipRow as any).__sync = syncActive;

  slider.addEventListener('input', syncActive);
  slider.addEventListener('change', syncActive);
  syncActive();

  const container = slider.closest('.vs-field, .form-group, .insp-row, div') || slider.parentElement;
  container?.insertAdjacentElement('afterend', chipRow);
}

const STAGE_GUIDES_STORAGE_KEY = 'cg_vs_stage_guides_v1';

interface StageGuidesState {
  grid: boolean;
  center: boolean;
  safe: boolean;
}

function loadGuidesState(): StageGuidesState {
  try {
    const raw = localStorage.getItem(STAGE_GUIDES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { grid: false, center: false, safe: false };
}

function saveGuidesState(st: StageGuidesState): void {
  try {
    localStorage.setItem(STAGE_GUIDES_STORAGE_KEY, JSON.stringify(st));
  } catch {}
}

/**
 * Mounts Rule-of-Thirds, Center Crosshair, and 9:16 TikTok/Reels + 16:9 Title/Action
 * Safe-Zone overlays directly over the Video Director preview canvas container,
 * plus a compact toggle bar in the player toolbar.
 */
export function mountPlayerStageOverlays(): void {
  // Locate the Video Director preview canvas (never touch #export-render-canvas)
  const previewCanvas =
    (document.getElementById('video-canvas') as HTMLCanvasElement | null) ||
    (document.getElementById('video-director-canvas') as HTMLCanvasElement | null) ||
    (document.getElementById('director-preview-canvas') as HTMLCanvasElement | null) ||
    (document.getElementById('video-preview-canvas') as HTMLCanvasElement | null) ||
    document.querySelector<HTMLCanvasElement>('canvas:not(#export-render-canvas):not(#vfx-preview-canvas):not(.tile-canvas)');

  if (!previewCanvas || !previewCanvas.parentElement) return;

  // registerEventListeners() creates the composition-guide overlay in the
  // classic editor before Studio UI is activated. Reuse it and move its toolbar
  // into the Studio topbar instead of returning with the toolbar stranded beside
  // the preview. moveNode() records the original location for safe restoration.
  const existingOverlay = document.getElementById('vs-player-guides-overlay');
  if (existingOverlay) {
    const existingToolbar = document.getElementById('vs-stage-guides-toolbar');
    const topbarSlot = document.getElementById('vs-topbar-center-slot');
    if (existingToolbar && topbarSlot && existingToolbar.parentElement !== topbarSlot) {
      moveNode(existingToolbar, topbarSlot);
    }
    return;
  }

  const host = previewCanvas.parentElement;
  host.classList.add('vs-stage-overlay-host');

  const st = loadGuidesState();

  // 1. Create the pointer-events:none overlay layer
  const guidesEl = document.createElement('div');
  guidesEl.id = 'vs-player-guides-overlay';
  guidesEl.className = 'vs-player-guides';
  guidesEl.setAttribute('aria-hidden', 'true');
  guidesEl.dataset.grid = st.grid ? 'on' : 'off';
  guidesEl.dataset.center = st.center ? 'on' : 'off';
  guidesEl.dataset.safe = st.safe ? 'on' : 'off';
  guidesEl.dataset.aspect = getActiveAspectRatio();

  guidesEl.innerHTML = `
    <div class="vs-guide-thirds"></div>
    <div class="vs-guide-center"></div>
    <div class="vs-guide-safe">
      <!-- 16:9 / 1:1 / 4:3 Broadcast Action (90%) & Title (80%) Safe Boxes -->
      <div class="vs-safe-action-box"></div>
      <div class="vs-safe-title-box"></div>

      <!-- 9:16 TikTok / Reels / Shorts UI Hazard Overlay -->
      <div class="vs-safe-social-ui">
        <div class="vs-social-top-mask">TOP UI / SEARCH BAR</div>
        <div class="vs-social-right-mask">ACTIONS</div>
        <div class="vs-social-bottom-mask">@handle · caption & audio marquee (avoid placing subtitles here)</div>
        <div class="vs-social-safe-frame"></div>
      </div>
    </div>
  `;

  host.appendChild(guidesEl);

  // 2. Keep overlay bounds locked to the rendered canvas box inside the stage
  const syncOverlayBoundsToCanvas = () => {
    const hostRect = host.getBoundingClientRect();
    const canvasRect = previewCanvas.getBoundingClientRect();
    if (hostRect.width === 0 || canvasRect.width === 0) return;

    guidesEl.style.left = `${Math.round(canvasRect.left - hostRect.left)}px`;
    guidesEl.style.top = `${Math.round(canvasRect.top - hostRect.top)}px`;
    guidesEl.style.width = `${Math.round(canvasRect.width)}px`;
    guidesEl.style.height = `${Math.round(canvasRect.height)}px`;
    guidesEl.dataset.aspect = getActiveAspectRatio();
  };

  const ro = new ResizeObserver(syncOverlayBoundsToCanvas);
  ro.observe(host);
  ro.observe(previewCanvas);
  window.addEventListener('resize', syncOverlayBoundsToCanvas);
  requestAnimationFrame(syncOverlayBoundsToCanvas);

  // Listen for aspect-ratio dropdown changes so 9:16 vs 16:9 safe zones switch automatically
  const aspectSelectors = [
    document.getElementById('video-director-aspect-select'),
    document.getElementById('studio-aspect-select'),
    document.getElementById('image-resolution'),
    document.getElementById('aspect-ratio-select'),
  ];
  aspectSelectors.forEach((sel) => {
    sel?.addEventListener('change', () => {
      setTimeout(syncOverlayBoundsToCanvas, 30);
    });
  });

  // 3. Create the toggle button pill (Rule of Thirds / Crosshair / Safe Zone)
  const toolbar = document.createElement('div');
  toolbar.id = 'vs-stage-guides-toolbar';
  toolbar.className = 'vs-stage-tools-bar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Canvas Composition Guides');

  toolbar.innerHTML = `
    <button type="button" class="vs-stage-tool-btn" data-guide-toggle="grid" aria-pressed="${st.grid}" title="Toggle Rule-of-Thirds Grid (G)">
      <span>⊞</span><span>Grid</span>
    </button>
    <button type="button" class="vs-stage-tool-btn" data-guide-toggle="center" aria-pressed="${st.center}" title="Toggle Center Crosshair">
      <span>⌖</span><span>Center</span>
    </button>
    <button type="button" class="vs-stage-tool-btn" data-guide-toggle="safe" aria-pressed="${st.safe}" title="Toggle 9:16 Social / 16:9 Broadcast Safe Zones">
      <span>⊡</span><span>Safe Zone</span>
    </button>
  `;

  toolbar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-guide-toggle]');
    if (!btn) return;
    const key = btn.dataset.guideToggle as keyof StageGuidesState;
    st[key] = !st[key];
    btn.setAttribute('aria-pressed', String(st[key]));
    guidesEl.dataset[key] = st[key] ? 'on' : 'off';
    syncOverlayBoundsToCanvas();
    saveGuidesState(st);
  });

  // Mount the toggle pill in the Video Studio topbar center slot or right beneath the player stage
  const topbarSlot = document.getElementById('vs-topbar-center-slot');
  if (topbarSlot) {
    topbarSlot.appendChild(toolbar);
  } else {
    host.insertAdjacentElement('afterend', toolbar);
  }
}

/**
 * Enhances the Export Modal with video-studio's 2-Column Export Studio Card layout,
 * live frame preview stage, and estimated file size calculator readout.
 */
export function mountExportStudioCard(): void {
  const container = document.getElementById('export-modal-body') || document.querySelector('.export-dialog-content') || document.getElementById('export-modal');
  if (!container || document.getElementById('vs-export-studio-card')) return;

  const card = document.createElement('div');
  card.id = 'vs-export-studio-card';
  card.className = 'vs-export-studio-card';

  card.innerHTML = `
    <div class="vs-export-preview-col">
      <div class="vs-export-stage">
        <canvas id="vs-export-preview-canvas" width="320" height="180"></canvas>
        <div class="vs-export-stage-badge">LIVE PREVIEW</div>
      </div>
      <div class="vs-export-specs">
        <div class="vs-export-spec-pill">
          <span class="vs-export-spec-label">EST. FILE SIZE</span>
          <span class="vs-export-spec-value" id="vs-export-est-size">~12.4 MB</span>
        </div>
        <div class="vs-export-spec-pill">
          <span class="vs-export-spec-label">EST. DURATION</span>
          <span class="vs-export-spec-value" id="vs-export-est-duration">0:15.0</span>
        </div>
      </div>
    </div>
    <div class="vs-export-settings-col">
      <div class="vs-export-field">
        <label class="vs-export-field-label">EXPORT PRESET</label>
        <div class="vs-export-radio-group" role="radiogroup">
          <button type="button" class="vs-export-radio-btn" aria-checked="true" data-preset="mp4">MP4 (H.264)</button>
          <button type="button" class="vs-export-radio-btn" aria-checked="false" data-preset="webm">WebM (VP9)</button>
          <button type="button" class="vs-export-radio-btn" aria-checked="false" data-preset="gif">Animated GIF</button>
        </div>
      </div>
    </div>
  `;

  container.prepend(card);
}

interface StudioCommand {
  id: string;
  title: string;
  category: 'Studios' | 'Editing' | 'AI & Media' | 'Export & View';
  shortcut?: string;
  action: () => void;
}

/**
 * Global Ctrl+K / Cmd+K Command Palette (video-studio find-replace.css & commands.js port)
 */
export function initStudioCommandPalette(): void {
  if (document.getElementById('vs-command-palette-modal')) return;

  const commands: StudioCommand[] = [
    {
      id: 'studio-image',
      title: 'Open Image Studio',
      category: 'Studios',
      action: () => document.getElementById('open-image-studio-btn')?.click(),
    },
    {
      id: 'studio-voice',
      title: 'Open Voice Studio',
      category: 'Studios',
      action: () => document.getElementById('open-voice-studio-btn')?.click(),
    },
    {
      id: 'studio-map',
      title: 'Open Map Studio',
      category: 'Studios',
      action: () => document.getElementById('open-map-studio-btn')?.click(),
    },
    {
      id: 'studio-film',
      title: 'Open Film Studio (Phase 1)',
      category: 'Studios',
      action: () => document.getElementById('open-film-studio-btn')?.click(),
    },
    {
      id: 'studio-academy',
      title: 'Open Academy Hub',
      category: 'Studios',
      action: () => {
        const btn = document.getElementById('header-academy-btn') || 
                    document.getElementById('open-academy-dropdown-btn') || 
                    document.getElementById('landing-academy-btn') ||
                    document.getElementById('open-academy-btn');
        btn?.click();
      },
    },
    {
      id: 'edit-split',
      title: 'Split Clip at Playhead',
      category: 'Editing',
      shortcut: 'Ctrl+B',
      action: () => {
        const btn = document.getElementById('timeline-action-split') || 
                    document.getElementById('split-clip-btn');
        btn?.click();
      },
    },
    {
      id: 'edit-reframe',
      title: 'Auto-Reframe Subject (AI)',
      category: 'AI & Media',
      action: () => {
        const btn = document.getElementById('ckf-auto-reframe') || 
                    document.getElementById('auto-reframe-btn');
        btn?.click();
      },
    },
    {
      id: 'edit-subtitles',
      title: 'Configure Subtitle Styles',
      category: 'AI & Media',
      action: () => {
        const tab = document.querySelector<HTMLElement>('[data-vs-left-tab="graphics"]');
        tab?.click();
      },
    },
    {
      id: 'export-open',
      title: 'Open Export Studio & Cloud Render',
      category: 'Export & View',
      action: () => {
        const btn = document.getElementById('video-export-btn') || 
                    document.getElementById('vs-export-video-btn') || 
                    document.getElementById('open-export-modal-btn');
        btn?.click();
      },
    },
    {
      id: 'view-toggle-ws',
      title: 'Toggle video-studio / Classic Workspace',
      category: 'Export & View',
      shortcut: 'Ctrl+Shift+W',
      action: () => {
        const fn = (window as any).toggleStudioWorkspace;
        if (typeof fn === 'function') fn();
      },
    },
  ];

  // Create Modal Shell
  const modal = document.createElement('div');
  modal.id = 'vs-command-palette-modal';
  modal.className = 'vs-director hidden';
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(0, 0, 0, 0.68); backdrop-filter: blur(4px);
    display: none; align-items: flex-start; justify-content: center;
    padding-top: 12vh;
  `;

  modal.innerHTML = `
    <div style="width: min(560px, calc(100vw - 32px)); background: var(--bg-panel, #222224); border: 1px solid var(--border-strong, #44444a); border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,0.7); overflow: hidden; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border, #323236); gap: 10px;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-3); flex: none;">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input type="text" id="vs-cmd-input" placeholder="Type a command or search studios (e.g. voice, split, export)..." autocomplete="off" style="width: 100%; background: transparent; border: 0; color: var(--text, #ececee); font-size: 13.5px; outline: none;" />
        <span style="font-size: 10px; font-family: var(--font-mono); padding: 2px 5px; border-radius: 4px; background: var(--bg-input); border: 1px solid var(--border); color: var(--text-3);">ESC</span>
      </div>
      <div id="vs-cmd-results" style="max-height: 320px; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px;"></div>
    </div>
  `;

  document.body.appendChild(modal);

  const inputEl = modal.querySelector<HTMLInputElement>('#vs-cmd-input')!;
  const resultsEl = modal.querySelector<HTMLElement>('#vs-cmd-results')!;

  let selectedIndex = 0;

  function renderResults(filterText = '') {
    const q = filterText.toLowerCase().trim();
    const filtered = commands.filter(
      (c) => c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );

    resultsEl.innerHTML = '';
    if (filtered.length === 0) {
      resultsEl.innerHTML = `<div style="padding: 24px; text-align: center; font-size: 12px; color: var(--text-3);">No matching commands found.</div>`;
      return;
    }

    filtered.forEach((cmd, idx) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `vs-cmd-item ${idx === selectedIndex ? 'active' : ''}`;
      item.style.cssText = `
        display: flex; align-items: center; justify-content: space-between;
        width: 100%; padding: 8px 10px; border-radius: 6px; border: 0;
        background: ${idx === selectedIndex ? 'var(--bg-active, rgba(255,255,255,0.12))' : 'transparent'};
        color: var(--text, #ececee); font-size: 12.5px; text-align: left; cursor: pointer;
      `;
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--bg-input); border: 1px solid var(--border); color: var(--accent-text);">${cmd.category}</span>
          <span>${cmd.title}</span>
        </div>
        ${cmd.shortcut ? `<span style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-3);">${cmd.shortcut}</span>` : ''}
      `;

      item.addEventListener('mouseenter', () => {
        selectedIndex = idx;
        renderResults(inputEl.value);
      });

      item.addEventListener('click', () => {
        closePalette();
        try {
          cmd.action();
        } catch (err) {
          console.error('[Command Palette] Action failed:', err);
        }
      });

      resultsEl.appendChild(item);
    });
  }

  function openPalette() {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    inputEl.value = '';
    selectedIndex = 0;
    renderResults();
    setTimeout(() => inputEl.focus(), 20);
  }

  function closePalette() {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }

  // Global Ctrl+K / Cmd+K shortcut listener
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeEl?.isContentEditable) {
        // Allow if modal isn't open and it's not a text field they want to type in
      }
      e.preventDefault();
      if (modal.style.display === 'none' || modal.classList.contains('hidden')) openPalette();
      else closePalette();
    } else if (e.key === 'Escape' && modal.style.display !== 'none' && !modal.classList.contains('hidden')) {
      closePalette();
    }
  });

  inputEl.addEventListener('input', () => {
    selectedIndex = 0;
    renderResults(inputEl.value);
  });

  inputEl.addEventListener('keydown', (e) => {
    const items = resultsEl.querySelectorAll<HTMLButtonElement>('.vs-cmd-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(1, items.length);
      renderResults(inputEl.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % Math.max(1, items.length);
      renderResults(inputEl.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[selectedIndex]?.click();
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePalette();
  });
}





