/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as dom from './src/dom';
import './src/perfMonitor';
import * as audioFirstDirector from './src/audio-first-director';
import * as audioUploadDirector from './src/audio-upload-director';
import * as audioPipeline from './src/audioPipeline';
import * as exporter from './src/exporter';
import * as assetHandlers from './src/handlers-assets';
import * as exportHandlers from './src/handlers-export';
import * as graphicsHandlers from './src/handlers-graphics';
import * as imageHandlers from './src/handlers-images';
import * as inspectorHandlers from './src/handlers-inspector';
import * as miscHandlers from './src/handlers-misc';
import * as projectHandlers from './src/handlers-project';
import * as settingsHandlers from './src/handlers-settings';
import * as storyHandlers from './src/handlers-story';
import * as transcribeHandlers from './src/handlers-transcribe';
import * as transcriptHandlers from './src/handlers-transcript-editor';
import * as shortcuts from './src/shortcuts';
import * as timelineBuilder from './src/timelineBuilder';
import * as ui from './src/ui';
import * as videoController from './src/videoController';
import * as videoDirector from './src/videoDirector';
import { debounce } from './src/utils-core';
import * as utils from './src/utils';
import { ensureSubtitleFontsReady } from './src/utils';
import { state } from './src/state';
import { timelineState } from './src/state-timeline';
import { MODAL_TEMPLATES, IMAGE_STYLE_OPTIONS } from './src/templates';
import { assetStorage } from './src/assetStorage';
import * as auth from './src/auth';
import { initAuth } from './src/auth';
import { initAds } from './src/handlers-ads';
import { initImageStudio } from './src/image-studio';
import { initVoiceStudio } from './src/voice-studio';
import { initMapStudio, openMapStudioModal } from './src/map-studio';
import { initMediaAssembler, openMediaAssemblerModal } from './src/media-assembler';
import { initFilmStudio } from './src/film-studio';
import { initAcademyStudio } from './src/academy-studio';
import { initMasterAudioHandlers, restoreMasterAudioUI } from './src/masterAudioDirector';
import { initVisualEffectsHandlers } from './src/handlers-effects';
import { initCameraKeyframesUI } from './src/camera-keyframes-ui';
import { initSystemConfigListener, setupAdminSystemTabHandlers } from './src/handlers-admin-system';
import { drawVideoFrame, videoRenderContext } from './src/videoRenderer';
import { initKeyboardShortcuts } from './src/shortcuts';
import { initLegalHandlers } from './src/handlers-legal';
import { initPatternInterruptUI } from './src/pattern-interrupt/ui';
import { setParallaxDepthReadyHandler } from './src/parallax/adapter';
import { initParallaxAdvancedControls } from './src/parallax/ui';
import { exportProjectArchive, importProjectArchive } from './src/projectArchive';
import './src/styles/vs-director.css';
import {
  initVsWorkspaceToggle,
  mountInspectorPositionGlyphs,
  mountInspectorSpeedChips,
  mountPlayerStageOverlays,
} from './src/director-workspace';

// Auto-recover from stale dynamic chunk hash mismatches on new deployments
if (typeof window !== 'undefined') {
    window.addEventListener('vite:preloadError', (event) => {
        console.warn('[Vite] Dynamic chunk preload error (stale build hash). Reloading page...', event);
        window.location.reload();
    });
}

// INJECT HTML & INIT DOM BEFORE ANYTHING ELSE
function injectAndInit() {
    // 1. Inject Modals
    document.body.insertAdjacentHTML('beforeend', MODAL_TEMPLATES);
    
    // 2. Populate Image Styles (if element exists in static HTML)
    const styleSelect = document.getElementById('image-style');
    if (styleSelect) {
        styleSelect.innerHTML = IMAGE_STYLE_OPTIONS;
    }

    // 3. Initialize DOM References
    dom.initDOM();

    // 4. Initialize Academy Studio
    try {
        initAcademyStudio();
    } catch (err) {
        console.error('Failed early init of Academy Studio:', err);
    }
}

/**
 * Enables security restrictions to discourage code inspection/editing.
 */
function enableClientSideSecurity() {
    // Disable Right Click (Context Menu)
    document.addEventListener('contextmenu', (e) => {
        if (!state.rightClickEnabled) {
            e.preventDefault();
            return false;
        }
    });

    // Disable Developer Tools shortcuts
    document.addEventListener('keydown', (e) => {
        if (state.rightClickEnabled) return;

        // F12
        if (e.key === 'F12') {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+I (Inspect), Ctrl+Shift+J (Console), Ctrl+Shift+C (Element Inspector)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) {
            e.preventDefault();
            return false;
        }

        // Ctrl+U (View Source)
        if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
            e.preventDefault();
            return false;
        }
    });
}

/**
 * Registers all event listeners for the application.
 */
function registerEventListeners() {
    // Legal & Privacy Handlers
    initLegalHandlers();

    // Auto Pattern Interrupt Intelligence Engine
    initPatternInterruptUI();

    // Visual Effects & Color Grade Studio
    initVisualEffectsHandlers();
    initCameraKeyframesUI();
    
    // Keyboard shortcuts
    initKeyboardShortcuts();

    // Master Audio Workflow
    initMasterAudioHandlers();

    // Cloud Renders & Persistent Downloads
    document.getElementById('view-cloud-renders-btn')?.addEventListener('click', () => {
        exporter.openCloudRenderHistoryModal();
    });
    document.getElementById('cloud-render-open-history-btn')?.addEventListener('click', () => {
        exporter.openCloudRenderHistoryModal();
    });
    document.getElementById('close-cloud-renders-modal-btn')?.addEventListener('click', () => {
        exporter.closeCloudRenderHistoryModal();
    });
    document.getElementById('close-cloud-renders-footer-btn')?.addEventListener('click', () => {
        exporter.closeCloudRenderHistoryModal();
    });
    document.getElementById('refresh-cloud-renders-btn')?.addEventListener('click', () => {
        exporter.refreshCloudRendersList();
        exporter.loadCloudDiagnostics();
    });
    document.getElementById('clear-all-cloud-renders-btn')?.addEventListener('click', () => {
        const renders = exporter.getStoredCloudRenders();
        if (renders.length === 0) {
            ui.showStatus('No cloud renders to clear.', false, 3000);
            return;
        }
        ui.showConfirmation(
            'Clear All Cloud Renders',
            `Are you sure you want to clear all ${renders.length} cloud render items? This will remove them from your history.`,
            () => {
                exporter.clearAllCloudRenders();
            }
        );
    });
    document.getElementById('toggle-cloud-diagnostics-btn')?.addEventListener('click', () => {
        const drawer = document.getElementById('cloud-diagnostics-drawer');
        if (drawer) {
            drawer.classList.toggle('hidden');
        }
    });
    const cloudModal = document.getElementById('cloud-renders-modal');
    cloudModal?.addEventListener('click', (e) => {
        if (e.target === cloudModal) exporter.closeCloudRenderHistoryModal();
    });

    // Authentication
    dom.userCreditsDisplay?.addEventListener('click', miscHandlers.openBuyCreditsModal);
    dom.userCloudRenderDisplay?.addEventListener('click', () => {
        exporter.openCloudRenderHistoryModal();
    });
    dom.closeBuyCreditsBtn?.addEventListener('click', miscHandlers.closeBuyCreditsModal);
    dom.creditPackages?.forEach(pkg => {
        pkg.addEventListener('click', miscHandlers.handleSelectCreditPackage);
    });
    dom.checkoutBtn?.addEventListener('click', miscHandlers.handleCheckout);
    dom.startAppBtn?.addEventListener('click', miscHandlers.startAppFromLanding);
    dom.startAppBtnHero?.addEventListener('click', () => { projectHandlers.startNewProject(false); miscHandlers.startAppFromLanding(); });
    dom.resumeAppBtn?.addEventListener('click', miscHandlers.startAppFromLanding);
    dom.exitAppBtn?.addEventListener('click', miscHandlers.exitAppToLanding);
    dom.exitAppBtnMobile?.addEventListener('click', miscHandlers.exitAppToLanding);


    // Landing Page Sample Story Launchers
    document.querySelectorAll('.landing-sample-card').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const prompt = (e.currentTarget as HTMLButtonElement).dataset.prompt;
            if (prompt && dom.storyInput) {
                projectHandlers.startNewProject(false);
                dom.storyInput.value = prompt;
                ui.updateUiForStoryChange();
                projectHandlers.saveVersion(true);
            }
            await miscHandlers.startAppFromLanding();
            ui.showStatus('✨ Story template loaded into Director Studio!', false, 3000);
        });
    });

    // Mobile Menu
    dom.mobileMenuBtn?.addEventListener('click', miscHandlers.toggleMobileMenu);

    // Header Studio & File Menu Dropdown Click Support
    const fileMenuBtn = document.getElementById('file-menu-btn');
    const fileMenuPanel = document.getElementById('file-menu-dropdown-panel');
    const studioMenuBtn = document.getElementById('studio-menu-btn');
    const studioMenuPanel = document.getElementById('studio-menu-dropdown-panel');

    const toggleDropdown = (panel: HTMLElement | null, open?: boolean) => {
        if (!panel) return;
        const willOpen = open !== undefined ? open : panel.classList.contains('opacity-0');
        if (willOpen) {
            panel.classList.remove('opacity-0', 'invisible');
            panel.classList.add('opacity-100', 'visible');
        } else {
            panel.classList.remove('opacity-100', 'visible');
            panel.classList.add('opacity-0', 'invisible');
        }
    };

    fileMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(studioMenuPanel, false);
        toggleDropdown(fileMenuPanel);
    });

    studioMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown(fileMenuPanel, false);
        toggleDropdown(studioMenuPanel);
    });

    fileMenuPanel?.addEventListener('click', () => {
        toggleDropdown(fileMenuPanel, false);
    });

    studioMenuPanel?.addEventListener('click', () => {
        toggleDropdown(studioMenuPanel, false);
    });

    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('#file-menu-dropdown-container')) {
            toggleDropdown(fileMenuPanel, false);
        }
        if (!target?.closest('#studio-menu-dropdown-container')) {
            toggleDropdown(studioMenuPanel, false);
        }
    });

    // Academy Triggers
    document.querySelectorAll<HTMLButtonElement>('#header-academy-btn, #landing-academy-btn, #open-academy-dropdown-btn, #open-academy-btn-mobile, [data-action="open-academy"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            import('./src/academy-studio').then(m => m.openAcademyModal()).catch(console.error);
        });
    });

    // Main Story Input
    const debouncedStoryInputSync = debounce(() => {
        ui.updateUiForStoryChange();
    }, 500);
    dom.storyInput?.addEventListener('input', debouncedStoryInputSync);
    
    dom.storyInput?.addEventListener('paste', (e) => {
        // Allow standard paste to occur, then normalize next tick
        setTimeout(() => {
            if (dom.storyInput) {
                const cleaned = dom.storyInput.value
                    .replace(/\u2018|\u2019/g, "'")
                    .replace(/\u201C|\u201D/g, '"')
                    .replace(/\u2026/g, '...')
                    .replace(/[ \t]{2,}/g, ' ')
                    .replace(/\n{3,}/g, '\n\n');
                if (cleaned !== dom.storyInput.value) {
                    dom.storyInput.value = cleaned;
                    ui.updateUiForStoryChange();
                }
            }
        }, 10);
    });

    document.querySelectorAll('.marker-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = (btn as HTMLElement).dataset.marker!;
            if (dom.storyInput) {
                dom.storyInput.setRangeText(m, dom.storyInput.selectionStart, dom.storyInput.selectionEnd, 'end');
                dom.storyInput.dispatchEvent(new Event('input'));
                dom.storyInput.focus();
            }
        });
    });
    
    // Quick Sample Prompts
    document.querySelectorAll('.quick-prompt-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const prompt = (e.target as HTMLButtonElement).dataset.prompt;
            const label = (e.target as HTMLButtonElement).textContent;
            if (prompt && dom.storyInput) {
                projectHandlers.startNewProject(false);
                dom.storyInput.value = prompt;
                ui.updateUiForStoryChange();
                projectHandlers.saveVersion(true);
                ui.showStatus(`Loaded prompt: ${label}`, false, 2000);
            }
        });
    });

    dom.extractVoBtn?.addEventListener('click', storyHandlers.extractVoiceover);
    
    dom.saveTemplateBtn?.addEventListener('click', () => {
        const text = dom.storyInput?.value.trim();
        if (!text) return;
        
        const name = prompt('Name this template (e.g., "My Promo"):');
        if (!name) return;
        
        const genre = dom.sparkGenreSelect?.value || 'any';
        const pacing = dom.pacingFactorSelect?.value || 'normal';
        const style = dom.imageStyleSelect?.value || 'cinematic';
        
        // Save to localStorage
        const customTemplates = JSON.parse(localStorage.getItem('customTemplates') || '[]');
        customTemplates.push({ name, text, genre, pacing, style });
        localStorage.setItem('customTemplates', JSON.stringify(customTemplates));
        
        const btn = document.createElement('button');
        btn.className = "quick-prompt-btn bg-gray-800 hover:bg-fuchsia-900 text-xs text-gray-300 font-medium py-1.5 px-3 rounded-full transition-colors border border-fuchsia-700/50 hover:border-fuchsia-500";
        btn.dataset.prompt = text;
        btn.textContent = name;
        
        btn.addEventListener('click', (e) => {
            if (dom.storyInput) {
                projectHandlers.startNewProject(false);
                dom.storyInput.value = btn.dataset.prompt!;
                if (dom.sparkGenreSelect) dom.sparkGenreSelect.value = genre;
                if (dom.pacingFactorSelect) dom.pacingFactorSelect.value = pacing;
                if (dom.imageStyleSelect) dom.imageStyleSelect.value = style;
                ui.updateUiForStoryChange();
                projectHandlers.saveVersion(true);
                ui.showStatus(`Loaded template: ${name}`, false, 2000);
            }
        });
        
        const container = document.getElementById('quick-prompts-container');
        if (container) {
            container.appendChild(btn);
            ui.showStatus(`Template "${name}" saved!`, false, 3000);
        }
    });

    // Header Logo Click Interaction
    dom.headerAppLogo?.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Load custom templates on startup
    const savedTemplates = JSON.parse(localStorage.getItem('customTemplates') || '[]');
    const container = document.getElementById('quick-prompts-container');
    if (container && savedTemplates.length > 0) {
        savedTemplates.forEach((t: {name: string, text: string, genre?: string, pacing?: string, style?: string}) => {
            const btn = document.createElement('button');
            btn.className = "quick-prompt-btn bg-gray-800 hover:bg-fuchsia-900 text-xs text-gray-300 font-medium py-1.5 px-3 rounded-full transition-colors border border-fuchsia-700/50 hover:border-fuchsia-500";
            btn.dataset.prompt = t.text;
            btn.textContent = t.name;
            btn.addEventListener('click', () => {
                if (dom.storyInput) {
                    projectHandlers.startNewProject(false);
                    dom.storyInput.value = btn.dataset.prompt!;
                    if (t.genre && dom.sparkGenreSelect) dom.sparkGenreSelect.value = t.genre;
                    if (t.pacing && dom.pacingFactorSelect) dom.pacingFactorSelect.value = t.pacing;
                    if (t.style && dom.imageStyleSelect) dom.imageStyleSelect.value = t.style;
                    ui.updateUiForStoryChange();
                    projectHandlers.saveVersion(true);
                    ui.showStatus(`Loaded template: ${t.name}`, false, 2000);
                }
            });
            container.appendChild(btn);
        });
    }

    // Global Keyboard Navigation
    document.addEventListener('keydown', (e) => {
        // Close Modals and Drawers with Escape
        if (e.key === 'Escape') {
            // Check for Shot Inspector Drawer first if open
            if (dom.shotInspectorDrawer && !dom.shotInspectorDrawer.classList.contains('hidden')) {
                inspectorHandlers.closeInspector();
                return;
            }

            // Check for any visible full-screen modal
            const openModals = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0:not(.hidden)'))
                .filter(el => window.getComputedStyle(el).display !== 'none');
            
            if (openModals.length > 0) {
                const topmostModal = openModals[openModals.length - 1];
                const closeBtn = topmostModal.querySelector<HTMLElement>('[id*="close"], [class*="close"], button.close, #confirm-cancel-btn, #cancel-export-settings-modal-btn');
                if (closeBtn) {
                    closeBtn.click();
                } else {
                    topmostModal.classList.add('hidden');
                    document.body.classList.remove('overflow-hidden');
                }
            }
        }
    });

    // Settings Changes
    dom.imageStyleSelect?.addEventListener('change', () => {
        ui.handleImageStyleChange();
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });

    // Video Clips Gallery Download Handler
    dom.videoClipsContainer?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.download-clip-btn') as HTMLElement;
        if (btn) {
            const videoSrc = btn.dataset.videoSrc;
            const downloadName = btn.dataset.downloadName || 'video_clip.mp4';
            if (videoSrc) {
                const a = document.createElement('a');
                a.href = videoSrc;
                a.download = downloadName;
                a.click();
            }
        }
    });

    dom.characterModifierSelect?.addEventListener('change', () => {
        ui.handleCharacterModifierChange();
        projectHandlers.saveVersion(false);
    });

    const debouncedModifierAutoSave = debounce(() => {
        projectHandlers.saveVersion(false);
    }, 1000);
    dom.characterModifierCustom?.addEventListener('input', debouncedModifierAutoSave);

    dom.imageStyleSearch?.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value.toLowerCase();
        const options = Array.from(dom.imageStyleSelect.options);
        const optgroups = Array.from(dom.imageStyleSelect.querySelectorAll('optgroup'));
        let firstVisibleOption: HTMLOptionElement | null = null;

        options.forEach(option => {
            const text = option.text.toLowerCase();
            const value = option.value.toLowerCase();
            
            // Always show the custom options
            if (value === 'custom_prompt' || value === 'custom') {
                option.style.display = '';
                return;
            }

            if (text.includes(searchTerm) || value.includes(searchTerm)) {
                option.style.display = '';
                if (!firstVisibleOption) firstVisibleOption = option;
            } else {
                option.style.display = 'none';
            }
        });

        // Hide optgroups with no visible options
        optgroups.forEach(optgroup => {
            const visibleOptions = Array.from(optgroup.querySelectorAll('option')).filter(opt => opt.style.display !== 'none');
            if (visibleOptions.length === 0) {
                optgroup.style.display = 'none';
            } else {
                optgroup.style.display = '';
            }
        });
        
        // Optional: auto-select the first visible option if the current selection is hidden
        if (dom.imageStyleSelect.selectedOptions[0]?.style.display === 'none' && firstVisibleOption) {
            dom.imageStyleSelect.value = (firstVisibleOption as HTMLOptionElement).value;
            ui.handleImageStyleChange();
        }
    });
    dom.detailLevelSelect?.addEventListener('change', (e) => {
        ui.handlePacingChange((e.target as HTMLSelectElement).value);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.pacingFactorSelect?.addEventListener('change', () => {
        ui.updateEstimations();
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.customShotCountInput?.addEventListener('change', () => projectHandlers.saveVersion(false));
    dom.customPromptInput?.addEventListener('change', () => projectHandlers.saveVersion(false));
    dom.imageModelSelect?.addEventListener('change', () => {
        ui.handleImageModelChange();
        if (typeof imageHandlers.resetImageCircuitBreaker === 'function') {
            imageHandlers.resetImageCircuitBreaker();
        }
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.videoModelSelect?.addEventListener('change', () => {
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.imageResolutionSelect?.addEventListener('change', () => {
        const aspect = dom.imageResolutionSelect.value;
        ui.updateAspectRatioState(aspect);
        if (typeof ui.updateExportSummaryCard === 'function') {
            ui.updateExportSummaryCard();
        }
        projectHandlers.saveVersion(false);
    });
    dom.videoDirectorAspectSelect?.addEventListener('change', () => {
        const aspect = dom.videoDirectorAspectSelect.value;
        ui.updateAspectRatioState(aspect);
        if (typeof ui.updateExportSummaryCard === 'function') {
            ui.updateExportSummaryCard();
        }
        projectHandlers.saveVersion(false);
    });
    const handlePreviewResolutionChange = (res: string) => {
        if (!res) return;
        state.previewResolution = res as any;
        try {
            localStorage.setItem('cg_preview_resolution', res);
        } catch {}
        if (dom.videoPreviewResolutionSelect && dom.videoPreviewResolutionSelect.value !== res) {
            dom.videoPreviewResolutionSelect.value = res;
        }
        if (dom.videoCanvasPreviewResolutionSelect && dom.videoCanvasPreviewResolutionSelect.value !== res) {
            dom.videoCanvasPreviewResolutionSelect.value = res;
        }
        ui.resizeVideoPreviewWrapper();
        try {
            if (!state.isVideoPlaying) {
                drawVideoFrame(state.lastRenderedTime || 0);
            }
        } catch (err) {
            console.warn('Failed to redraw video frame on resolution change:', err);
        }
    };
    dom.videoPreviewResolutionSelect?.addEventListener('change', () => {
        handlePreviewResolutionChange(dom.videoPreviewResolutionSelect.value);
    });
    dom.videoCanvasPreviewResolutionSelect?.addEventListener('change', () => {
        handlePreviewResolutionChange(dom.videoCanvasPreviewResolutionSelect.value);
    });
    if (state.previewResolution) {
        if (dom.videoPreviewResolutionSelect) dom.videoPreviewResolutionSelect.value = state.previewResolution;
        if (dom.videoCanvasPreviewResolutionSelect) dom.videoCanvasPreviewResolutionSelect.value = state.previewResolution;
    }
    if (dom.videoResponsivePreviewToggle) {
        dom.videoResponsivePreviewToggle.checked = Boolean(state.responsivePreview);
        dom.videoResponsivePreviewToggle.addEventListener('change', () => {
            state.responsivePreview = dom.videoResponsivePreviewToggle.checked;
            try {
                localStorage.setItem('cg_responsive_preview', state.responsivePreview ? '1' : '0');
            } catch {}
        });
    }
    dom.enableSafeRephraseCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleSafeRephraseToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.enableRightClickCheckbox?.addEventListener('change', settingsHandlers.handleRightClickToggle);
    dom.enableAudioDuckingCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleAudioDuckingToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.enableAudioNormalizeCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleAudioNormalizeToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.videoExportNormalizeAudioCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleAudioNormalizeToggle(e);
    });
    dom.videoExportAudioDuckingCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleAudioDuckingToggle(e);
    });
    dom.enableTextOverlayCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleTextOverlayToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.enableMotionGraphicsCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleMotionGraphicsToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.toolbarEnableMotionGraphicsCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleMotionGraphicsToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.enableBRollCheckbox?.addEventListener('change', () => {
        state.visualPunctuationEnabled = dom.enableBRollCheckbox.checked;
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });

    dom.enableParallaxCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleParallaxToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.parallaxModeSelect?.addEventListener('change', (e) => {
        settingsHandlers.handleParallaxModeChange(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableParallaxDustCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleParallaxDustToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableParallaxDofCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleParallaxDofToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableBgBlurCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleBgBlurToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });
    dom.cinematographyStylePresetSelect?.addEventListener('change', (e) => {
        settingsHandlers.handleCinematographyPresetChange(e);
        projectHandlers.saveVersion(false);
    });
    dom.cameraMotionIntensitySelect?.addEventListener('change', (e) => {
        settingsHandlers.handleCameraMotionIntensityChange(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableCameraHandheldCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleCameraHandheldToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableLetterboxCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleLetterboxToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableCinematicVignetteCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleCinematicVignetteToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.enableCompositionGridCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleCompositionGridToggle(e);
        projectHandlers.saveVersion(false);
    });
    dom.useInstantTimestampsCheckbox?.addEventListener('change', settingsHandlers.handleInstantTimestampToggle);


    // API Key Management
    dom.geminiAuthModeSelect?.addEventListener('change', settingsHandlers.handleGeminiAuthModeChange);
    dom.geminiTextModelSelect?.addEventListener('change', settingsHandlers.handleGeminiTextModelChange);
    dom.testGeminiCookieBtn?.addEventListener('click', () => settingsHandlers.testGeminiCookieHealth(true));
    dom.saveGeminiCookieBtn?.addEventListener('click', settingsHandlers.saveGeminiCookie);
    dom.clearGeminiCookieBtn?.addEventListener('click', settingsHandlers.clearGeminiCookie);
    dom.userAuthAIStudioTab?.addEventListener("click", () => settingsHandlers.updateUserVertexUITabs("aistudio"));
    dom.userAuthVertexTab?.addEventListener("click", () => settingsHandlers.updateUserVertexUITabs("vertex"));
    dom.userVertexAuthApiKeyBtn?.addEventListener("click", () => settingsHandlers.updateUserVertexAuthModeUI("apiKey"));
    dom.userVertexAuthAdcBtn?.addEventListener("click", () => settingsHandlers.updateUserVertexAuthModeUI("adc"));
    dom.testVertexConnectionBtn?.addEventListener("click", settingsHandlers.testVertexConnection);
    dom.testGeminiApiKeyBtn?.addEventListener("click", settingsHandlers.testGeminiApiKeyConnection);

    // Auto-dismiss test notices on user input
    dom.geminiApiKeyInput?.addEventListener('input', () => {
        utils.dismissSafeStatus(dom.geminiApiKeyStatus);
        utils.dismissSafeStatus(dom.vertexConnectionStatus);
    });
    dom.userVertexProjectInput?.addEventListener('input', () => {
        utils.dismissSafeStatus(dom.vertexConnectionStatus);
        utils.dismissSafeStatus(dom.geminiApiKeyStatus);
    });
    dom.userVertexLocationInput?.addEventListener('input', () => {
        utils.dismissSafeStatus(dom.vertexConnectionStatus);
        utils.dismissSafeStatus(dom.geminiApiKeyStatus);
    });
    dom.openaiGatewayBaseUrlInput?.addEventListener('input', () => {
        utils.dismissSafeStatus(dom.openaiConnectionStatus);
        utils.dismissSafeStatus(dom.openaiImageConnectionStatus);
    });
    dom.openaiGatewayApiKeyInput?.addEventListener('input', () => {
        utils.dismissSafeStatus(dom.openaiConnectionStatus);
        utils.dismissSafeStatus(dom.openaiImageConnectionStatus);
    });

    // OpenAI Gateway Listeners
    dom.testOpenaiConnectionBtn?.addEventListener('click', settingsHandlers.testOpenaiGatewayConnection);
    dom.testOpenaiImageConnectionBtn?.addEventListener('click', settingsHandlers.testOpenaiGatewayImageConnection);
    dom.fetchOpenaiModelsBtn?.addEventListener('click', settingsHandlers.fetchOpenaiGatewayModels);
    dom.fetchOpenaiImageModelsBtn?.addEventListener('click', settingsHandlers.fetchOpenaiGatewayImageModels);
    dom.saveOpenaiGatewayBtn?.addEventListener('click', settingsHandlers.saveOpenaiGatewayConfig);
    dom.clearOpenaiGatewayBtn?.addEventListener('click', settingsHandlers.clearOpenaiGatewayConfig);

    document.querySelectorAll<HTMLButtonElement>('[data-gateway-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-gateway-preset') as any;
            if (preset) settingsHandlers.applyOpenaiGatewayPreset(preset);
        });
    });

    dom.saveGeminiApiKeyBtn?.addEventListener('click', settingsHandlers.saveUserGeminiApiKey);
    dom.clearGeminiApiKeyBtn?.addEventListener('click', settingsHandlers.clearUserGeminiApiKey);
    dom.saveAi33ApiKeyBtn?.addEventListener('click', settingsHandlers.saveAi33ApiKey);
    dom.clearAi33ApiKeyBtn?.addEventListener('click', settingsHandlers.clearAi33ApiKey);
    dom.saveStabilityApiKeyBtn?.addEventListener('click', settingsHandlers.saveStabilityApiKey);
    dom.clearStabilityApiKeyBtn?.addEventListener('click', settingsHandlers.clearStabilityApiKey);
    dom.saveElevenlabsApiKeyBtn?.addEventListener('click', settingsHandlers.saveElevenlabsApiKey);
    dom.clearElevenlabsApiKeyBtn?.addEventListener('click', settingsHandlers.clearElevenlabsApiKey);
    dom.saveDeepgramApiKeyBtn?.addEventListener('click', settingsHandlers.saveDeepgramApiKey);
    dom.clearDeepgramApiKeyBtn?.addEventListener('click', settingsHandlers.clearDeepgramApiKey);
    dom.saveFreesoundApiKeyBtn?.addEventListener('click', settingsHandlers.saveFreesoundApiKey);
    dom.clearFreesoundApiKeyBtn?.addEventListener('click', settingsHandlers.clearFreesoundApiKey);
    dom.savePexelsApiKeyBtn?.addEventListener('click', settingsHandlers.savePexelsApiKey);
    dom.clearPexelsApiKeyBtn?.addEventListener('click', settingsHandlers.clearPexelsApiKey);
    
    // Auto-parse on paste in cookie input
    dom.geminiPsidInput?.addEventListener('paste', (e) => {
        setTimeout(() => {
            const pasted = dom.geminiPsidInput?.value || '';
            settingsHandlers.parseAndFillCookiesFromText(pasted);
            ui.updateGeminiApiKeyUiState();
        }, 10);
    });

    // Enter key save triggers
    [dom.geminiPsidInput, dom.geminiPsidtsInput, dom.geminiPsidccInput].forEach(inp => {
        inp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                settingsHandlers.saveGeminiCookie();
            }
        });
    });
    dom.geminiApiKeyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            settingsHandlers.saveUserGeminiApiKey();
        }
    });

    // Input listeners for UI state updates (shows/hides save buttons without prematurely activating keys)
    const apiKeyInputs = [
        dom.geminiPsidInput,
        dom.geminiPsidtsInput,
        dom.geminiPsidccInput,
        dom.geminiApiKeyInput,
        dom.ai33ApiKeyInput,
        dom.stabilityApiKeyInput,
        dom.elevenlabsApiKeyInput,
        dom.deepgramApiKeyInput,
        dom.freesoundApiKeyInput,
        dom.pexelsApiKeyInput,
        dom.gradioTtsApiUrlInput
    ];

    apiKeyInputs.forEach(inputEl => {
        if (!inputEl) return;
        inputEl.addEventListener('input', () => {
            ui.updateGeminiApiKeyUiState();
            ui.updateAi33ApiKeyUiState();
            ui.updateStabilityApiKeyUiState();
            ui.updateElevenlabsApiKeyUiState();
            ui.updateDeepgramApiKeyUiState();
            ui.updateFreesoundApiKeyUiState();
            ui.updatePexelsApiKeyUiState();
        });
        inputEl.addEventListener('paste', () => {
            setTimeout(() => {
                if (inputEl.value) {
                    const cleaned = settingsHandlers.sanitizeApiKey(inputEl.value);
                    if (cleaned && cleaned !== inputEl.value) {
                        inputEl.value = cleaned;
                    }
                }
            }, 10);
        });
        inputEl.addEventListener('blur', () => {
            if (inputEl.value) {
                const cleaned = settingsHandlers.sanitizeApiKey(inputEl.value);
                if (cleaned && cleaned !== inputEl.value) {
                    inputEl.value = cleaned;
                }
            }
        });
    });
    
    dom.preferredTranscribeEngineSelect?.addEventListener('change', settingsHandlers.handlePreferredTranscribeEngineChange);

    dom.whisperModelSelect?.addEventListener('change', () => {
        localStorage.setItem('whisperModel', dom.whisperModelSelect.value);
    });
    dom.downloadWhisperModelBtn?.addEventListener('click', settingsHandlers.handleDownloadWhisperModel);
    
    dom.elevenlabsModelSelect?.addEventListener('change', settingsHandlers.handleElevenlabsModelChange);
    dom.selectApiKeyBtn?.addEventListener('click', settingsHandlers.handleSelectApiKey);
    dom.saveGradioTtsApiUrlBtn?.addEventListener('click', settingsHandlers.saveGradioTtsApiUrl);
    dom.clearGradioTtsApiUrlBtn?.addEventListener('click', settingsHandlers.clearGradioTtsApiUrl);

    // Action Buttons & Workflow
    dom.sparkBtn?.addEventListener('click', () => dom.storySparkModal.classList.remove('hidden'));
    dom.analyzeBtn?.addEventListener('click', storyHandlers.analyzeStory);
    dom.createBlankStoryboardBtn?.addEventListener('click', storyHandlers.createBlankStoryboard);
    dom.manualOpenMapStudioBtn?.addEventListener('click', () => openMapStudioModal());
    dom.addShotToolbarBtn?.addEventListener('click', storyHandlers.addSingleBlankShot);
    dom.manualStoryboardType?.addEventListener('change', () => {
        const val = dom.manualStoryboardType.value;
        const descEl = document.getElementById('manual-storyboard-description');
        const btnLabel = document.getElementById('create-manual-btn-label');

        if (val === 'assembler') {
            if (dom.blankStoryboardCountContainer) dom.blankStoryboardCountContainer.style.display = 'none';
            if (descEl) descEl.textContent = 'Upload your audio track and visual video/image clips to auto-sync, distribute as montage, or create a sleep loop.';
            if (btnLabel) btnLabel.textContent = 'Launch Media Assembler';
        } else if (val === 'aroll' || val === 'script') {
            if (dom.blankStoryboardCountContainer) dom.blankStoryboardCountContainer.style.display = 'none';
            if (descEl) descEl.textContent = val === 'aroll' ? 'Creates shots from your master audio / A-Roll video transcript.' : 'Splits your script text into shots by sentence.';
            if (btnLabel) btnLabel.textContent = 'Create Storyboard';
        } else {
            if (dom.blankStoryboardCountContainer) dom.blankStoryboardCountContainer.style.display = 'flex';
            if (descEl) descEl.textContent = 'Creates blank storyboard shots with customizable durations and prompts.';
            if (btnLabel) btnLabel.textContent = 'Create Blank Storyboard';
        }
    });

    dom.manualStoryboardToggleBtn?.addEventListener('click', () => {
        if (dom.manualStoryboardDrawer?.classList.contains('hidden')) {
            dom.manualStoryboardDrawer.classList.remove('hidden');
            if (dom.manualStoryboardChevron) dom.manualStoryboardChevron.textContent = '▴';
        } else {
            if (dom.manualStoryboardDrawer) dom.manualStoryboardDrawer.classList.add('hidden');
            if (dom.manualStoryboardChevron) dom.manualStoryboardChevron.textContent = '▾';
        }
    });

    dom.enhanceBtn?.addEventListener('click', storyHandlers.enhanceStory);
    dom.identifyCharactersBtn?.addEventListener('click', assetHandlers.identifyCharacters);
    dom.identifyLocationsBtn?.addEventListener('click', assetHandlers.identifyLocations);
    dom.identifyElementsBtn?.addEventListener('click', assetHandlers.identifyKeyElements);
    dom.suggestStyleBtn?.addEventListener('click', storyHandlers.suggestStyle);
    dom.startTourBtn?.addEventListener('click', miscHandlers.startOnboardingTour);
    dom.startTourBtnMobile?.addEventListener('click', miscHandlers.startOnboardingTour);
    dom.videoDirectorBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        videoController.handleOpenVideoDirector();
    });
    dom.progressCancelBtn?.addEventListener('click', () => {
        exporter.handleCancelExport();
        ui.cancelCurrentProcessing();
    });

    // Manual Voice ID
    dom.toggleManualVoiceIdBtn?.addEventListener('click', audioPipeline.handleToggleManualVoiceId);
    dom.addManualVoiceIdBtn?.addEventListener('click', audioPipeline.handleAddManualVoiceId);
    dom.manualVoiceIdInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            audioPipeline.handleAddManualVoiceId();
        }
    });

    // Project Management & Exports
    dom.newProjectBtn?.addEventListener('click', projectHandlers.startNewProject);
    dom.newProjectBtnMobile?.addEventListener('click', projectHandlers.startNewProject);
    dom.importProjectBtn?.addEventListener('click', projectHandlers.triggerProjectImport);
    dom.importProjectBtnMobile?.addEventListener('click', projectHandlers.triggerProjectImport);
    dom.importFileInput?.addEventListener('change', projectHandlers.handleFileImport);
    dom.exportProjectBtn?.addEventListener('click', exportHandlers.exportProject);
    dom.exportProjectBtnMobile?.addEventListener('click', exportHandlers.exportProject);
    dom.exportMenuBtn?.addEventListener('click', miscHandlers.toggleExportMenu);
    dom.exportZipBtn?.addEventListener('click', exportHandlers.downloadAllImages);
    dom.exportTxtBtn?.addEventListener('click', exportHandlers.exportAsText);
    dom.exportPromptsTxtBtn?.addEventListener('click', exportHandlers.exportImagePromptsAsText);
    dom.exportVideoPromptsBtn?.addEventListener('click', exportHandlers.exportVideoPrompts);
    dom.exportCsvBtn?.addEventListener('click', exportHandlers.exportAsCSV);
    dom.exportPdfBtn?.addEventListener('click', exportHandlers.exportAsPDF);
    dom.exportXmlBtn?.addEventListener('click', exportHandlers.exportNLETimeline);
    dom.exportAudioDataBtn?.addEventListener('click', miscHandlers.handleExportAudioData);
    dom.uploadSyncSrtBtn?.addEventListener('click', miscHandlers.handleUploadSrtSync);
    dom.srtUploadInput?.addEventListener('change', miscHandlers.handleSrtFileChange);

    // History
    dom.historyBtn?.addEventListener('click', ui.openHistoryModal);
    dom.historyBtnMobile?.addEventListener('click', ui.openHistoryModal);
    dom.closeHistoryModalBtn?.addEventListener('click', () => dom.historyModal?.classList.add('hidden'));
    dom.clearHistoryBtn?.addEventListener('click', exportHandlers.clearHistory);
    dom.historyListContainer?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const loadBtn = target.closest('.load-history-btn');
        const deleteBtn = target.closest('.delete-history-btn');
        
        if (loadBtn) {
            exportHandlers.loadFromHistory((loadBtn as HTMLElement).dataset.id!);
        } else if (deleteBtn) {
            exportHandlers.deleteFromHistory((deleteBtn as HTMLElement).dataset.id!);
        }
    });

    // Tabs
    dom.tabStoryboardBtn?.addEventListener('click', () => ui.switchTab('storyboard'));
    dom.tabCharactersBtn?.addEventListener('click', () => ui.switchTab('characters'));
    dom.tabLocationsBtn?.addEventListener('click', () => ui.switchTab('locations'));
    dom.tabElementsBtn?.addEventListener('click', () => ui.switchTab('elements'));
    dom.tabScriptBtn?.addEventListener('click', () => {
        ui.switchTab('script');
        storyHandlers.syncScriptEditorFromStoryboard();
    });
    dom.tabVideoClipsBtn?.addEventListener('click', () => ui.switchTab('video-clips'));
    dom.tabGraphicsBtn?.addEventListener('click', () => ui.switchTab('graphics'));

    // Graphics Panel
    dom.addGraphicBtn?.addEventListener('click', () => graphicsHandlers.openGraphicEditor());
    dom.geType?.addEventListener('change', graphicsHandlers.updateGraphicEditorOptions);
    dom.geCancelBtn?.addEventListener('click', graphicsHandlers.closeGraphicEditor);
    dom.geSaveBtn?.addEventListener('click', graphicsHandlers.saveGraphicEvent);
    dom.geUploadImageBtn?.addEventListener('click', () => dom.geCustomImageFile?.click());
    dom.geCustomImageFile?.addEventListener('change', graphicsHandlers.handleGraphicCustomImageUpload);
    dom.geClearImageBtn?.addEventListener('click', graphicsHandlers.clearCustomImage);
    dom.geIconPosition?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.gePosX?.addEventListener('input', graphicsHandlers.handlePositionSliderChange);
    dom.gePosY?.addEventListener('input', graphicsHandlers.handlePositionSliderChange);
    dom.geNudgeLeft?.addEventListener('click', () => graphicsHandlers.handleNudgePosition(-2, 0));
    dom.geNudgeRight?.addEventListener('click', () => graphicsHandlers.handleNudgePosition(2, 0));
    dom.geNudgeUp?.addEventListener('click', () => graphicsHandlers.handleNudgePosition(0, -2));
    dom.geNudgeDown?.addEventListener('click', () => graphicsHandlers.handleNudgePosition(0, 2));
    dom.geNudgeCenter?.addEventListener('click', () => graphicsHandlers.handleNudgePosition('center', 'center'));
    dom.geScale?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geRotation?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geIcon?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geTextColor?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geColor?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geTitle?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geSubtitle?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geTheme?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.gePosition?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geBackdrop?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geAnimation?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geBpBullets?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geBpStyle?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geBpPosition?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geBpStagger?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geEbItems?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geEbConnection?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geEbStagger?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geRrNodes?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geRrOrientation?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geRrStyle?.addEventListener('change', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geRrStagger?.addEventListener('input', graphicsHandlers.updateGraphicFromEditorLive);
    dom.geEnableMotionGraphicsCheckbox?.addEventListener('change', (e) => {
        settingsHandlers.handleMotionGraphicsToggle(e);
        ui.updateAspectRatioState();
        projectHandlers.saveVersion(false);
    });

    // Script Editor
    dom.applyScriptToStoryboardBtn?.addEventListener('click', storyHandlers.handleApplyScriptToStoryboard);

    // Asset Consistency Panels (Delegated)
    dom.addCustomCharacterBtn?.addEventListener('click', assetHandlers.handleAddCustomCharacter);
    dom.characterList?.addEventListener('click', assetHandlers.handleCharacterListClick);
    dom.characterList?.addEventListener('change', assetHandlers.handleCharacterImageUpload);
    dom.characterList?.addEventListener('input', assetHandlers.handleCharacterInput);
    dom.locationList?.addEventListener('click', assetHandlers.handleLocationListClick);
    dom.keyElementList?.addEventListener('click', assetHandlers.handleKeyElementListClick);

    dom.clearBgAudioBtn?.addEventListener('click', imageHandlers.clearBgAudio);
    dom.uploadBgAudioBtn?.addEventListener('click', () => dom.bgAudioFileInput?.click());
    dom.bgAudioFileInput?.addEventListener('change', (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) imageHandlers.uploadBgAudio(f);
    });
    dom.bgAudioVolumeSlider?.addEventListener('input', (e) =>
        imageHandlers.setBgAudioVolume(parseFloat((e.target as HTMLInputElement).value)));
    dom.bgAudioVolumeSlider?.addEventListener('change', () => projectHandlers.saveVersion(false));

    // Results Container (Delegated)
    dom.resultsContainer?.addEventListener("change", imageHandlers.handleResultsContainerChange as EventListener);
    dom.resultsContainer?.addEventListener('click', imageHandlers.handleResultsContainerClick);
    dom.resultsContainer?.addEventListener('dragstart', imageHandlers.handleShotDragStart as EventListener);
    dom.resultsContainer?.addEventListener('dragover', imageHandlers.handleShotDragOver as EventListener);
    dom.resultsContainer?.addEventListener('dragleave', imageHandlers.handleShotDragLeave as EventListener);
    dom.resultsContainer?.addEventListener('drop', imageHandlers.handleShotDrop as EventListener);
    const debouncedResultsInputSync = debounce((e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('prompt-textarea') || target.classList.contains('sfx-prompt-input')) {
            ui.updateAspectRatioState();
        }
    }, 500);
    dom.resultsContainer?.addEventListener('input', debouncedResultsInputSync);

    // Swap Media Modal
    dom.closeSwapModalBtn?.addEventListener('click', imageHandlers.closeSwapModal);
    dom.cancelSwapModalBtn?.addEventListener('click', imageHandlers.closeSwapModal);
    dom.swapShotsGrid?.addEventListener('click', imageHandlers.handleSwapGridClick);

    // Bulk Actions & Storyboard
    dom.presentBtn?.addEventListener('click', ui.startPresentation);
    dom.batchToolsMenuBtn?.addEventListener('click', miscHandlers.toggleBatchToolsMenu);
    dom.closeBatchToolsBtn?.addEventListener('click', () => dom.batchToolsDropdown?.classList.add('hidden'));
    dom.importMenuBtn?.addEventListener('click', miscHandlers.toggleImportMenu);
    dom.enableBulkGenerationCheckbox?.addEventListener('change', imageHandlers.handleBulkEnableToggle);
    dom.bulkGenerateBtn?.addEventListener('click', imageHandlers.handleBulkGenerate);
    dom.clearAllAssetsBtn?.addEventListener('click', imageHandlers.handleClearAllAssets);
    dom.bulkAnimateBtn?.addEventListener('click', imageHandlers.handleBulkAnimate);
    dom.bulkStockBtn?.addEventListener('click', imageHandlers.handleBulkStockFetch);
    dom.stopBulkGenerateBtn?.addEventListener('click', imageHandlers.stopBulkGeneration);
    dom.bulkCameraAngleSelect?.addEventListener('change', imageHandlers.handleBulkCameraAngleChange);
    dom.importImagesBtn?.addEventListener('click', imageHandlers.handleImportImages);
    dom.importImagesInput?.addEventListener('change', imageHandlers.importImages);

    // Global Click: Close Storyboard Toolbar Dropdowns on Outside Click
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (dom.batchToolsDropdown && !dom.batchToolsDropdown.classList.contains('hidden')) {
            if (!target.closest('#batch-tools-menu-container')) {
                dom.batchToolsDropdown.classList.add('hidden');
            }
        }
        if (dom.importMenuDropdown && !dom.importMenuDropdown.classList.contains('hidden')) {
            if (!target.closest('#import-menu-container')) {
                dom.importMenuDropdown.classList.add('hidden');
            }
        }
        if (dom.exportMenuDropdown && !dom.exportMenuDropdown.classList.contains('hidden')) {
            if (!target.closest('#export-menu-container')) {
                dom.exportMenuDropdown.classList.add('hidden');
            }
        }
    });

    // Window resize: readjust active dropdown position to keep strictly on storyboard side
    window.addEventListener('resize', () => {
        if (dom.batchToolsDropdown && !dom.batchToolsDropdown.classList.contains('hidden')) {
            miscHandlers.adjustDropdownPosition(dom.batchToolsDropdown, dom.batchToolsMenuBtn);
        }
        if (dom.importMenuDropdown && !dom.importMenuDropdown.classList.contains('hidden')) {
            miscHandlers.adjustDropdownPosition(dom.importMenuDropdown, dom.importMenuBtn);
        }
        if (dom.exportMenuDropdown && !dom.exportMenuDropdown.classList.contains('hidden')) {
            miscHandlers.adjustDropdownPosition(dom.exportMenuDropdown, dom.exportMenuBtn);
        }
    });

    // Image Modal
    dom.closeModalBtn?.addEventListener('click', () => dom.imageModal?.classList.add('hidden'));
    dom.imageEditBtn?.addEventListener('click', imageHandlers.handleImageEdit);
    dom.modalDownloadBtn?.addEventListener('click', imageHandlers.downloadModalImage);

    // Help Modal
    dom.helpBtn?.addEventListener('click', () => dom.helpModal?.classList.remove('hidden'));
    dom.helpBtnMobile?.addEventListener('click', () => dom.helpModal?.classList.remove('hidden'));
    dom.closeHelpModalBtn?.addEventListener('click', () => dom.helpModal?.classList.add('hidden'));

    // Confirmation Modal
    dom.confirmOkBtn?.addEventListener('click', miscHandlers.handleConfirm);
    dom.confirmCancelBtn?.addEventListener('click', ui.hideConfirmation);

    // Custom Style & Reference
    dom.customStyleImageInput?.addEventListener('change', assetHandlers.handleCustomImageUpload);
    dom.customStyleImagePreview?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('#remove-custom-style-image-btn')) {
            ui.removeCustomImage();
        } else if (target.closest('#custom-style-upload-btn')) {
            dom.customStyleImageInput?.click();
        }
    });
    dom.analyzeStyleBtn?.addEventListener('click', assetHandlers.handleAnalyzeStyleFromImage);
    dom.openReferenceLibraryBtn?.addEventListener('click', ui.openReferenceLibrary);

    // Reference Library Modal
    dom.closeReferenceLibraryBtn?.addEventListener('click', () => dom.referenceLibraryModal?.classList.add('hidden'));
    dom.addReferenceImageBtn?.addEventListener('click', () => dom.addReferenceImageInput?.click());
    dom.referencePasteBtn?.addEventListener('click', async () => {
        try {
            const blob = await imageHandlers.readImageBlobFromSystemClipboard();
            if (!blob) {
                ui.showStatus('No image found on your clipboard. Copy an image first!', true);
                return;
            }
            await imageHandlers.processAndRoutePastedImage(blob, 'library');
        } catch (err: any) {
            console.warn('[Ref Paste] Clipboard API error:', err);
            ui.showStatus('Please press Ctrl+V / Cmd+V directly to paste from clipboard.', true);
        }
    });
    dom.addReferenceImageInput?.addEventListener('change', assetHandlers.handleAddNewReferenceImages);
    dom.clearLibraryBtn?.addEventListener('click', assetHandlers.clearReferenceImageLibrary);
    dom.referenceLibraryGrid?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const card = target.closest('.ref-image-card');
        if (!card) return;
        const id = (card as HTMLElement).dataset.id!;
        if (target.closest('.select-ref-btn')) assetHandlers.handleSelectReferenceImage(id);
        else if (target.closest('.delete-ref-btn')) assetHandlers.handleDeleteReferenceImage(id);
    });

    // Style Modals
    dom.showStyleInfoBtn?.addEventListener('click', ui.showStyleInfo);
    dom.closeStyleInfoModalBtn?.addEventListener('click', () => dom.styleInfoModal.classList.add('hidden'));
    dom.styleSuggestionList?.addEventListener('click', storyHandlers.handleStyleSuggestionClick);
    dom.closeStyleSuggestionModalBtn?.addEventListener('click', storyHandlers.closeStyleSuggestionModal);

    // Story Spark Modal
    dom.closeStorySparkModalBtn?.addEventListener('click', () => dom.storySparkModal.classList.add('hidden'));
    dom.generateSparksBtn?.addEventListener('click', storyHandlers.generateSparks);
    dom.sparkResultsContainer?.addEventListener('click', storyHandlers.handleSparkSelection);
    dom.sparkStyleSelect?.addEventListener('change', storyHandlers.handleSparkStyleChange);
    dom.sparkLengthSelect?.addEventListener('change', storyHandlers.handleSparkLengthChange);

    // Video Director Modal & Editors
    dom.closeVideoDirectorModalBtn?.addEventListener('click', videoController.handleCloseVideoDirectorModal);
    dom.directVideoAudioFirstBtn?.addEventListener('click', audioFirstDirector.handleDirectVideoAudioFirst);
    dom.uploadAudioBtn?.addEventListener('click', audioUploadDirector.handleUploadAudioClick);
    dom.sidebarUploadAudioBtn?.addEventListener('click', audioUploadDirector.handleUploadAudioClick);
    dom.timelineUploadAudioBtn?.addEventListener('click', audioUploadDirector.handleUploadAudioClick);
    dom.audioUploadInput?.addEventListener('change', audioUploadDirector.handleDirectVideoUpload);
    dom.directVideoVisualFirstBtn?.addEventListener('click', timelineBuilder.handleAnalyzePacing);
    dom.visualFirstAudioToggle?.addEventListener('change', (e) => {
        const isChecked = (e.target as HTMLInputElement).checked;
        if (dom.visualFirstDurationOverrideInput) {
            dom.visualFirstDurationOverrideInput.disabled = isChecked;
            dom.visualFirstDurationOverrideInput.classList.toggle('opacity-50', isChecked);
        }
    });
    const SAVE_DIRECTOR_BTN_HTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6a1 1 0 10-2 0v5.586L7.707 10.293zM3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"></path></svg><span>Save</span>`;
    const SAVED_DIRECTOR_BTN_HTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg><span>Saved!</span>`;
    let saveDirectorResetTimer: any = null;

    dom.saveProjectVideoBtn?.addEventListener('click', async () => {
        const btn = dom.saveProjectVideoBtn;
        if (btn?.disabled) return;
        if (saveDirectorResetTimer) {
            clearTimeout(saveDirectorResetTimer);
            saveDirectorResetTimer = null;
        }

        const startTime = Date.now();
        try {
            if (btn) {
                btn.disabled = true;
                btn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-700/80 text-white font-medium text-xs shadow-xs transition-all flex items-center gap-1.5 border border-emerald-500/50 opacity-90';
                btn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Saving...</span>`;
            }

            await projectHandlers.saveVersion(false, true);

            // Ensure at least 250ms has elapsed so the transition is perceptible and doesn't flicker
            const elapsed = Date.now() - startTime;
            if (elapsed < 250) {
                await new Promise(res => setTimeout(res, 250 - elapsed));
            }

            ui.showStatus('💾 Video Director project and history saved!', false, 2500);

            if (btn) {
                btn.disabled = false;
                btn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs shadow-sm transition-all flex items-center gap-1.5 border border-emerald-400 ring-2 ring-emerald-500/30';
                btn.innerHTML = SAVED_DIRECTOR_BTN_HTML;

                saveDirectorResetTimer = setTimeout(() => {
                    if (btn) {
                        btn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-xs transition-colors flex items-center gap-1.5 border border-emerald-500/40 cursor-pointer';
                        btn.innerHTML = SAVE_DIRECTOR_BTN_HTML;
                    }
                    saveDirectorResetTimer = null;
                }, 1800);
            }
        } catch (err: any) {
            console.error('[Video Director] Save error:', err);
            ui.showStatus(`Save failed: ${err.message}`, true, 3000);
            if (btn) {
                btn.disabled = false;
                btn.className = 'px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium text-xs shadow-xs transition-colors flex items-center gap-1.5 border border-red-500/40 cursor-pointer';
                btn.innerHTML = `<span>⚠️ Error</span>`;
                saveDirectorResetTimer = setTimeout(() => {
                    if (btn) {
                        btn.className = 'px-2.5 py-1.5 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white font-medium text-xs shadow-xs transition-colors flex items-center gap-1.5 border border-emerald-500/40 cursor-pointer';
                        btn.innerHTML = SAVE_DIRECTOR_BTN_HTML;
                    }
                    saveDirectorResetTimer = null;
                }, 2500);
            }
        }
    });
    dom.importProjectVideoBtn?.addEventListener('click', () => {
        dom.importProjectInput?.click();
    });
    const EXPORT_PROJECT_ARCHIVE_BTN_HTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0L8 4m8 4v12"></path></svg><span class="hidden xl:inline">Archive</span>`;
    dom.exportProjectArchiveVideoBtn?.addEventListener('click', async () => {
        const btn = dom.exportProjectArchiveVideoBtn;
        if (btn?.disabled) return;
        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 text-teal-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Compiling...</span>`;
            }
            await exportProjectArchive((percent, msg) => {
                if (btn) {
                    const label = percent ? `Compiling ${Math.round(percent)}%` : 'Compiling...';
                    btn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 text-teal-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>${label}</span>`;
                }
            });
        } catch (err: any) {
            console.error('Export project error:', err);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = EXPORT_PROJECT_ARCHIVE_BTN_HTML;
            }
        }
    });
    dom.importProjectInput?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            await importProjectArchive(file);
        }
    });
    dom.videoExportBtn?.addEventListener('click', () => ui.openExportSettingsModal());
    dom.closeExportSettingsModalBtn?.addEventListener('click', () => ui.closeExportSettingsModal());
    dom.changeExportDirBtn?.addEventListener('click', async () => {
        const exporter = await import('./src/exporter');
        exporter.handleChangeExportDirectory();
    });

    dom.cancelExportSettingsModalBtn?.addEventListener('click', () => ui.closeExportSettingsModal());
    dom.exportGuestSigninBtn?.addEventListener('click', () => {
        ui.closeExportSettingsModal();
        auth.openLoginModal();
    });
    dom.videoExportResolutionSelect?.addEventListener('change', () => {
        const userIsGuest = auth.isGuest();
        const guestPolicy = state.systemConfig?.guestExportPolicy || 'watermark_320p';
        if (userIsGuest && guestPolicy !== 'unrestricted') {
            const chosen = dom.videoExportResolutionSelect?.value || '';
            if (!chosen.includes('320p')) {
                const currentRatio = (state.aspectRatio || dom.videoDirectorAspectSelect?.value || dom.imageResolutionSelect?.value || '16:9') as any;
                const guestKey = utils.getGuest320pResolutionKey(currentRatio);
                if (dom.videoExportResolutionSelect) {
                    dom.videoExportResolutionSelect.value = guestKey;
                }
                ui.showStatus('HD & 4K exports require an account. Switched to 320p Watermarked Preview.', true, 4000);
            }
        }
    });
    dom.startExportProcessBtn?.addEventListener('click', async () => {
        ui.closeExportSettingsModal();
        await exporter.handleExportVideo();
    });
    dom.exportSettingsModal?.addEventListener('click', (e) => {
        if (e.target === dom.exportSettingsModal) {
            ui.closeExportSettingsModal();
        }
    });
    [dom.videoExportFormatSelect, dom.videoExportResolutionSelect, dom.videoExportFpsSelect, dom.videoExportQualitySelect].forEach(selectEl => {
        selectEl?.addEventListener('change', () => ui.updateExportSummaryCard());
    });

    // Cloud Rendering vs Local Rendering toggle listeners
    const syncEngineUI = (mode: 'local' | 'cloud') => {
        state.cloudRenderMode = mode;
        if (mode === 'cloud') {
            if (dom.exportEngineCloudRadio) dom.exportEngineCloudRadio.checked = true;
            if (dom.exportEngineLocalRadio) dom.exportEngineLocalRadio.checked = false;
            dom.exportEngineCardCloud?.classList.remove('border-zinc-800', 'bg-zinc-900/50');
            dom.exportEngineCardCloud?.classList.add('border-indigo-500', 'bg-indigo-950/20');
            dom.exportEngineCardLocal?.classList.remove('border-indigo-500', 'bg-indigo-950/20');
            dom.exportEngineCardLocal?.classList.add('border-zinc-800', 'bg-zinc-900/50');
            dom.cloudRenderInfoBox?.classList.remove('hidden');
        } else {
            if (dom.exportEngineLocalRadio) dom.exportEngineLocalRadio.checked = true;
            if (dom.exportEngineCloudRadio) dom.exportEngineCloudRadio.checked = false;
            dom.exportEngineCardLocal?.classList.remove('border-zinc-800', 'bg-zinc-900/50');
            dom.exportEngineCardLocal?.classList.add('border-indigo-500', 'bg-indigo-950/20');
            dom.exportEngineCardCloud?.classList.remove('border-indigo-500', 'bg-indigo-950/20');
            dom.exportEngineCardCloud?.classList.add('border-zinc-800', 'bg-zinc-900/50');
            dom.cloudRenderInfoBox?.classList.add('hidden');
        }
        ui.updateExportSummaryCard();
    };

    dom.exportEngineLocalRadio?.addEventListener('change', () => syncEngineUI('local'));
    dom.exportEngineCloudRadio?.addEventListener('change', () => syncEngineUI('cloud'));
    dom.exportEngineCardLocal?.addEventListener('click', () => syncEngineUI('local'));
    dom.exportEngineCardCloud?.addEventListener('click', () => syncEngineUI('cloud'));
    dom.cloudRenderProviderSelect?.addEventListener('change', () => {
        const val = dom.cloudRenderProviderSelect.value as 'gcp' | 'aws' | 'headless';
        state.cloudRenderProvider = val;
        try {
            localStorage.setItem('cg_cloud_render_provider', val);
        } catch {}
        ui.syncCloudRenderProviderUI();
    });
    dom.analyzeNarrationBtn?.addEventListener('click', videoDirector.handleGetNarrationDirection);
    dom.analyzeNarrationOverlayBtn?.addEventListener('click', async () => {
        await videoDirector.handleGetNarrationDirection();
    });
    dom.magicCameraBtn?.addEventListener('click', videoDirector.handleMagicCamera);
    dom.autoPipCuesBtn?.addEventListener('click', videoDirector.autoDetectPipOverlayCues);
    dom.quickAutoPipBtn?.addEventListener('click', videoDirector.autoDetectPipOverlayCues);
    dom.clearAllPipBtn?.addEventListener('click', () => videoDirector.clearAllPipOverlays());
    dom.inspectorClearAllPipBtn?.addEventListener('click', () => videoDirector.clearAllPipOverlays());
    dom.sidebarClearPipBtn?.addEventListener('click', () => videoDirector.clearAllPipOverlays());
    dom.manualVisualSyncBtn?.addEventListener('click', timelineBuilder.handleManualVisualSync);
    dom.analyzeTransitionsBtn?.addEventListener('click', () => videoDirector.handleAnalyzeTransitions());
    dom.directorReviewBtn?.addEventListener('click', () => videoDirector.handleDirectorReviewLoop(false));
    dom.timelineMagicPolishBtn?.addEventListener('click', () => videoDirector.handleDirectorReviewLoop(false));
    dom.closeDirectorReviewModalBtn?.addEventListener('click', videoDirector.closeDirectorReviewModal);
    dom.closeDirectorReviewBtn?.addEventListener('click', videoDirector.closeDirectorReviewModal);
    dom.reanalyzeDirectorReviewBtn?.addEventListener('click', () => videoDirector.handleDirectorReviewLoop(false));
    dom.applyAllDirectorSuggestionsBtn?.addEventListener('click', videoDirector.applyAllDirectorSuggestions);
    dom.directorReviewModal?.addEventListener('click', (e) => {
        if (e.target === dom.directorReviewModal) {
            videoDirector.closeDirectorReviewModal();
        }
    });
    dom.clearVideoStatusLogBtn?.addEventListener('click', () => {
        if (dom.videoStatusLog) {
            dom.videoStatusLog.innerHTML = '<p class="text-gray-500 italic">System Ready.</p>';
        }
    });
    dom.videoPlayPauseBtn?.addEventListener('click', videoController.handleVideoPlayPause);
    dom.videoFullscreenBtn?.addEventListener('click', videoController.togglePreviewFullscreen);
    dom.bigPlayBtn?.addEventListener('click', videoController.handleVideoPlayPause);
    dom.videoPostGenerationOverlay?.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('#video-controls-container')) return;
        graphicsHandlers.handleCanvasClick(e);
    });
    dom.videoCanvas?.addEventListener('click', graphicsHandlers.handleCanvasClick);
    dom.videoCanvas?.addEventListener('dblclick', videoController.togglePreviewFullscreen);
    dom.videoAddGraphicBtn?.addEventListener('click', () => {
        if (state.isVideoPlaying) {
            videoController.forcePausePlayback();
        }
        ui.switchTab('graphics');
        graphicsHandlers.openGraphicEditor(undefined, state.lastRenderedTime || 0);
    });
    dom.videoProgressBarContainer?.addEventListener('mousedown', videoController.handleProgressBarMouseDown);
    dom.narrationVoiceSelect?.addEventListener('change', () => {
        videoController.handleVoiceSelectionChange();
        audioPipeline.handleCustomVoiceUIVisibility();
    });
    dom.removeCustomVoiceBtn?.addEventListener('click', audioPipeline.handleRemoveCustomVoice);
    dom.videoSubtitlesCheckbox?.addEventListener('change', videoController.toggleVideoSubtitles);
    dom.videoSubtitleStyleSelect?.addEventListener('change', videoController.handleSubtitleStyleChange);
    dom.videoSubtitleFontSelect?.addEventListener('change', videoController.handleSubtitleFontChange);
    dom.uploadSubtitleFontBtn?.addEventListener('click', () => {
        dom.customFontFileInput?.click();
    });
    dom.customFontFileInput?.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
            videoController.handleCustomFontUpload(file);
            (e.target as HTMLInputElement).value = '';
        }
    });
    dom.lyricsVideoPresetBtn?.addEventListener('click', videoController.handleLyricsVideoPreset);
    dom.videoSubtitlePositionSelect?.addEventListener('change', videoController.handleSubtitlePositionChange);
    dom.syncSubtitlesTimestampsBtn?.addEventListener('click', videoController.handleSyncSubtitleTimestamps);
    dom.videoTransitionStyleSelect?.addEventListener('change', videoController.handleVideoTransitionChange);
    dom.videoTransitionSpeedSelect?.addEventListener('change', videoController.handleVideoTransitionSpeedChange);

    // Background Audio & Transcript Editor
    dom.generateBgAudioBtn?.addEventListener('click', imageHandlers.generateBgAudio);
    dom.openTranscriptEditorBtn?.addEventListener('click', () => transcriptHandlers.handleOpenTranscriptEditor());

    // Gradio TTS Listeners
    dom.gradioVoiceArchetypeSelect?.addEventListener('change', videoController.handleGradioArchetypeChange);
    dom.gradioFastMode?.addEventListener('change', videoController.handleGradioFastModeToggle);
    dom.gradioReferenceAudio?.addEventListener('change', videoController.handleGradioReferenceAudioChange);

    // Transcript Editor
    dom.closeTranscriptEditorBtn?.addEventListener('click', transcriptHandlers.handleCloseTranscriptEditor);
    dom.autoAssignTranscriptBtn?.addEventListener('click', transcriptHandlers.handleAutoAssignTranscript);
    dom.undoTranscriptAssignmentBtn?.addEventListener('click', transcriptHandlers.handleUndoTranscriptAssignment);
    dom.clearTranscriptAssignmentsBtn?.addEventListener('click', transcriptHandlers.handleClearTranscriptAssignments);
    dom.rebuildTimelineFromTranscriptBtn?.addEventListener('click', transcriptHandlers.handleRebuildTimelineFromTranscript);
    dom.transcriptEditorTranscriptContainer?.addEventListener('mousedown', transcriptHandlers.handleTranscriptEditorInteraction);
    dom.transcriptEditorTranscriptContainer?.addEventListener('mouseover', transcriptHandlers.handleTranscriptEditorInteraction);
    dom.transcriptEditorTranscriptContainer?.addEventListener('mouseup', transcriptHandlers.handleTranscriptEditorInteraction);
    dom.transcriptEditorImageBin?.addEventListener('click', transcriptHandlers.handleTranscriptEditorImageClick);

    // Inspector Side-Panel Handlers
    if (typeof inspectorHandlers.initInspectorHandlers === 'function') {
        inspectorHandlers.initInspectorHandlers();
    }

    // Voice Cloning & AI33 Voice Studio Listeners
    dom.openCloningModalBtn?.addEventListener('click', audioPipeline.handleOpenCloningModal);
    dom.closeCloningModalBtn?.addEventListener('click', audioPipeline.handleCloseCloningModal);
    dom.voiceStudioTabCustom?.addEventListener('click', () => audioPipeline.switchVoiceStudioTab('custom'));
    dom.voiceStudioTabClone?.addEventListener('click', () => audioPipeline.switchVoiceStudioTab('clone'));
    dom.studioSaveVoiceBtn?.addEventListener('click', audioPipeline.handleStudioSaveVoice);
    dom.cloningDropZone?.addEventListener('click', audioPipeline.handleCloningDropZoneClick);
    dom.cloningFileInput?.addEventListener('change', audioPipeline.handleCloningFileChange);
    dom.startCloningBtn?.addEventListener('click', audioPipeline.handleStartVoiceCloning);
    audioPipeline.initVoiceProviderPillsAndListeners();

    // Sliders
    const sliders = [
        { slider: dom.narrationSpeedSlider, value: dom.narrationSpeedValue, fixed: 2, suffix: 'x' },
        { slider: dom.narrationPitchSlider, value: dom.narrationPitchValue, fixed: 1 },
        { slider: dom.narrationStabilitySlider, value: dom.narrationStabilityValue, fixed: 2 },
        { slider: dom.narrationSimilaritySlider, value: dom.narrationSimilarityValue, fixed: 2 },
        { slider: dom.narrationStyleSlider, value: dom.narrationStyleValue, fixed: 2 },
    ];
    sliders.forEach(({ slider, value, fixed, suffix = '' }) => {
        slider?.addEventListener('input', () => {
            if (value) value.textContent = parseFloat(slider.value).toFixed(fixed) + suffix;
        });
    });

    // B-Roll Editor
    dom.bRollCloseBtn?.addEventListener('click', audioUploadDirector.handleCloseBrollEditor);
    dom.bRollAutoSelectBtn?.addEventListener('click', audioUploadDirector.handleAutoSelectBroll);
    dom.bRollUndoBtn?.addEventListener('click', audioUploadDirector.handleUndoBrollSelection);
    dom.bRollFinalizeBtn?.addEventListener('click', audioUploadDirector.handleFinalizeBrollVideo);
    dom.bRollOpenBtn?.addEventListener('click', audioUploadDirector.handleOpenBrollEditor);
    dom.bRollExportSelectionsBtn?.addEventListener('click', audioUploadDirector.handleExportBrollSelections);
    dom.bRollImportSelectionsBtn?.addEventListener('click', () => dom.bRollImportSelectionsInput?.click());
    dom.bRollImportSelectionsInput?.addEventListener('change', audioUploadDirector.handleImportBrollSelections);
    dom.bRollImportAssetBtn?.addEventListener('click', () => dom.bRollImportAssetInput?.click());
    dom.bRollImportAssetInput?.addEventListener('change', audioUploadDirector.handleImportBrollAsset);
    dom.bRollBinContainer?.addEventListener('click', audioUploadDirector.handleBrollBinClick);
    dom.bRollTranscriptContainer?.addEventListener('click', audioUploadDirector.handleTranscriptWordClick);


    // Presentation Modal
    dom.presentationCloseBtn?.addEventListener('click', ui.closePresentation);
    dom.presentationPrevBtn?.addEventListener('click', ui.prevSlide);
    dom.presentationNextBtn?.addEventListener('click', ui.nextSlide);

    // Force Align Modal
    dom.closeForceAlignModalBtn?.addEventListener('click', audioUploadDirector.handleCloseForceAlignModal);
    dom.startForceAlignBtn?.addEventListener('click', audioUploadDirector.handleStartForceAlign);
    dom.forceAlignSubtitleInput?.addEventListener('change', audioUploadDirector.handleForceAlignSubtitleUpload);
    dom.importAlignedFromModalBtn?.addEventListener('click', () => {
        dom.forceAlignModal.classList.add('hidden');
    });

    // Video Prompt Modal
    dom.closeVideoPromptBtn?.addEventListener('click', () => dom.videoPromptModal.classList.add('hidden'));
    dom.copyVideoPromptBtn?.addEventListener('click', () => {
        if (dom.videoPromptResult) {
            navigator.clipboard.writeText(dom.videoPromptResult.value);
            const originalText = dom.copyVideoPromptBtn.innerHTML;
            dom.copyVideoPromptBtn.innerHTML = 'Copied!';
            ui.showStatus('Prompt copied to clipboard!', false, 2000);
            setTimeout(() => {
                if (dom.copyVideoPromptBtn) {
                    dom.copyVideoPromptBtn.innerHTML = originalText;
                }
            }, 2000);
        }
    });

    // Dedicated Timeline Drawer Toggle & Controls
    const updateCompactBtnUI = (isCompact: boolean) => {
        if (!dom.toggleCompactGridBtn) return;
        const iconSpan = dom.toggleCompactGridBtn.querySelector('#compact-grid-btn-icon');
        const textSpan = dom.toggleCompactGridBtn.querySelector('#compact-grid-btn-text');
        if (isCompact) {
            dom.toggleCompactGridBtn.classList.remove('bg-indigo-600/90', 'hover:bg-indigo-500');
            dom.toggleCompactGridBtn.classList.add('bg-amber-600', 'hover:bg-amber-500');
            if (iconSpan) iconSpan.textContent = '📄';
            if (textSpan) textSpan.textContent = 'Detailed View';
        } else {
            dom.toggleCompactGridBtn.classList.remove('bg-amber-600', 'hover:bg-amber-500');
            dom.toggleCompactGridBtn.classList.add('bg-indigo-600/90', 'hover:bg-indigo-500');
            if (iconSpan) iconSpan.textContent = '🖼️';
            if (textSpan) textSpan.textContent = 'Compact View';
        }
    };

    dom.toggleCompactGridBtn?.addEventListener('click', () => {
        if (!dom.resultsContainer) return;
        const isCompact = dom.resultsContainer.classList.toggle('compact-grid');
        localStorage.setItem('storyboard_compact_grid', isCompact ? 'true' : 'false');
        updateCompactBtnUI(isCompact);
        ui.showStatus(isCompact ? 'Switched to Compact Storyboard Grid View' : 'Switched to Detailed Storyboard View', false, 2000);
    });

    if (localStorage.getItem('storyboard_compact_grid') === 'true' && dom.resultsContainer) {
        dom.resultsContainer.classList.add('compact-grid');
        updateCompactBtnUI(true);
    }

    const updateSequenceTrackBtnUI = (isOpen: boolean) => {
        if (!dom.toggleTimelineBtnModal) return;
        if (isOpen) {
            dom.toggleTimelineBtnModal.classList.remove('bg-zinc-800', 'text-gray-400', 'hover:bg-zinc-700');
            dom.toggleTimelineBtnModal.classList.add('bg-indigo-600', 'hover:bg-indigo-500', 'text-white', 'shadow-indigo-900/40');
        } else {
            dom.toggleTimelineBtnModal.classList.remove('bg-indigo-600', 'hover:bg-indigo-500', 'text-white', 'shadow-indigo-900/40');
            dom.toggleTimelineBtnModal.classList.add('bg-zinc-800', 'text-gray-400', 'hover:bg-zinc-700');
        }
    };

    const updateSnapToggleUI = () => {
        if (!dom.timelineSnapToggleBtn) return;
        const isEnabled = timelineState.snappingEnabled;
        if (isEnabled) {
            dom.timelineSnapToggleBtn.classList.remove('bg-zinc-800', 'text-gray-400', 'hover:bg-zinc-700');
            dom.timelineSnapToggleBtn.classList.add('bg-amber-600', 'hover:bg-amber-500', 'text-white');
            dom.timelineSnapToggleBtn.innerHTML = `<span>🧲</span><span id="timeline-snap-text" class="hidden lg:inline">Snap: ON</span>`;
        } else {
            dom.timelineSnapToggleBtn.classList.remove('bg-amber-600', 'hover:bg-amber-500', 'text-white');
            dom.timelineSnapToggleBtn.classList.add('bg-zinc-800', 'hover:bg-zinc-700', 'text-gray-400', 'hover:text-white');
            dom.timelineSnapToggleBtn.innerHTML = `<span>🧲</span><span id="timeline-snap-text" class="hidden lg:inline">Snap: OFF</span>`;
        }
    };

    const handleToggleTimeline = () => {
        if (!dom.timelineEditorContainer) return;
        const nextState = !timelineState.drawerUserOpen;
        timelineState.setDrawerUserOpen(nextState);
        updateSequenceTrackBtnUI(nextState);
        if (nextState) {
            dom.timelineEditorContainer.classList.remove('hidden');
            videoController.updateVideoContext();
        } else {
            dom.timelineEditorContainer.classList.add('hidden');
        }
        requestAnimationFrame(() => {
            ui.resizeVideoPreviewWrapper();
            if (!state.isVideoPlaying && videoRenderContext) {
                drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
            }
        });
    };

    dom.toggleTimelineBtnModal?.addEventListener('click', handleToggleTimeline);

    dom.closeTimelineDrawerBtn?.addEventListener('click', () => {
        timelineState.setDrawerUserOpen(false);
        updateSequenceTrackBtnUI(false);
        if (dom.timelineEditorContainer) {
            dom.timelineEditorContainer.classList.add('hidden');
        }
        requestAnimationFrame(() => {
            ui.resizeVideoPreviewWrapper();
            if (!state.isVideoPlaying && videoRenderContext) {
                drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
            }
        });
    });

    const updateTimelineCollapseUI = (isCollapsed: boolean) => {
        if (!dom.timelineEditorContainer) return;
        const icon = document.getElementById('collapse-timeline-icon');
        if (isCollapsed) {
            dom.timelineEditorContainer.classList.add('is-collapsed');
            dom.timelineEditorContainer.style.height = '42px';
            if (dom.timelineClipsContainer) dom.timelineClipsContainer.classList.add('hidden');
            if (icon) icon.textContent = '▲';
        } else {
            dom.timelineEditorContainer.classList.remove('is-collapsed');
            dom.timelineEditorContainer.style.height = '';
            if (dom.timelineClipsContainer) dom.timelineClipsContainer.classList.remove('hidden');
            if (icon) icon.textContent = '▼';
            ui.renderTimelineEditor();
        }
        requestAnimationFrame(() => {
            ui.resizeVideoPreviewWrapper();
            if (!state.isVideoPlaying && videoRenderContext) {
                drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
            }
        });
    };

    dom.collapseTimelineBtn?.addEventListener('click', () => {
        if (!dom.timelineEditorContainer) return;
        const isCollapsed = dom.timelineEditorContainer.classList.contains('is-collapsed') || 
                            dom.timelineEditorContainer.style.height === '42px';
        updateTimelineCollapseUI(!isCollapsed);
    });

    // Magnet Snapping Toggle
    updateSnapToggleUI();
    dom.timelineSnapToggleBtn?.addEventListener('click', () => {
        const nextState = !timelineState.snappingEnabled;
        timelineState.setSnappingEnabled(nextState);
        updateSnapToggleUI();
        ui.showStatus(nextState ? '🧲 Magnet Snapping ON' : '🧲 Magnet Snapping OFF', false, 1500);
    });

    window.addEventListener('resize', debounce(() => {
        ui.resizeVideoPreviewWrapper();
        if (!state.isVideoPlaying && videoRenderContext && dom.videoCanvas && !dom.videoCanvas.classList.contains('hidden')) {
            drawVideoFrame(state.lastRenderedTime || state.videoPauseTime || 0);
        }
    }, 60));

    // Timeline Editor
    dom.timelineBuildBtn?.addEventListener('click', () => audioUploadDirector.buildTimelineFromShotsWithMediaDurations());
    dom.timelineTranscribeBtn?.addEventListener('click', () => transcribeHandlers.handleTranscribeTimelineMixdown());
    dom.timelineClipsContainer?.addEventListener('click', videoController.handleTimelineClick);
    dom.timelineClipsContainer?.addEventListener('mousedown', videoController.handleTimelineMouseDown);
    dom.timelineModeRippleBtn?.addEventListener('click', () => videoController.handleSetEditMode('ripple'));
    dom.timelineModeSlipBtn?.addEventListener('click', () => videoController.handleSetEditMode('slip'));
    dom.timelineActionSplitBtn?.addEventListener('click', videoController.handleSplitClip);
    dom.timelineActionTrimStartBtn?.addEventListener('click', () => videoController.handleTrimClip('start'));
    dom.timelineActionTrimEndBtn?.addEventListener('click', () => videoController.handleTrimClip('end'));
    dom.timelineActionRippleDeleteBtn?.addEventListener('click', () => shortcuts.rippleDeleteClipUnderPlayhead());
    dom.timelineActionUndoBtn?.addEventListener('click', videoController.handleUndoTimeline);
    dom.timelineActionRedoBtn?.addEventListener('click', videoController.handleRedoTimeline);
    dom.timelineZoomInBtn?.addEventListener('click', videoController.handleTimelineZoomIn);
    dom.timelineZoomOutBtn?.addEventListener('click', videoController.handleTimelineZoomOut);
    dom.timelineZoomFitBtn?.addEventListener('click', videoController.handleTimelineZoomFit);
    dom.timelineShortcutGuideBtn?.addEventListener('click', () => dom.shortcutGuideModal?.classList.toggle('hidden'));
    dom.shortcutGuideCloseBtn?.addEventListener('click', () => dom.shortcutGuideModal?.classList.add('hidden'));
    dom.timelineClipsContainer?.addEventListener('wheel', (e) => videoController.handleTimelineWheelZoom(e as WheelEvent), { passive: false });
    dom.timelineSyncToggle?.addEventListener('change', () => {
        if (!dom.timelineSyncToggle.checked) {
            ui.clearStoryboardHighlight();
        }
    });
    
    // Canvas interactions
    graphicsHandlers.setupCanvasInteraction();

    // Visual Position Glyphs & Speed Preset Chips
    mountInspectorPositionGlyphs();
    mountInspectorSpeedChips();

    // Player Stage Composition Overlays (Rule of Thirds, Crosshair, Safe Zones)
    mountPlayerStageOverlays();

    // Flush pending changes before unload to prevent data loss
    const flushPendingAutosaves = () => {
        debouncedModifierAutoSave.flush();
    };
    window.addEventListener('beforeunload', flushPendingAutosaves);
    window.addEventListener('pagehide', flushPendingAutosaves);
}


/**
 * Initializes the application state and UI on page load.
 */
async function initializeApp() {
    try {
        await assetStorage.init();
        console.log('Asset storage initialized');

        // Cleanup orphaned assets on startup
        const cleaned = await assetStorage.cleanupOrphanedAssets();
        if (cleaned > 0) {
            console.log(`Cleaned up ${cleaned} orphaned assets`);
        }
    } catch (err: any) {
        console.error('Failed to initialize asset storage:', err);
        ui.showStatus('Warning: Asset storage unavailable. Large projects may fail.', true, 5000);
    }

    enableClientSideSecurity(); // Activate security features
    ensureSubtitleFontsReady(); // Pre-warm custom fonts in background without blocking startup

    // Initialize desktop workspace folder in the background
    import(/* @vite-ignore */ './src/workspaceManager').then(m => m.getOrCreateWorkspaceRoot()).catch(err => {
        console.warn('Workspace initialization deferred:', err);
    });

    ui.resetWorkflowSteps();
    await miscHandlers.initializeAppState();
    await settingsHandlers.restoreApiKeysFromCloudOrDB();
    settingsHandlers.loadGeminiAuthMode();
    settingsHandlers.loadGeminiTextModel();
    settingsHandlers.loadUserGeminiApiKey();
    settingsHandlers.loadAi33ApiKey(); // Load AI33 config
    await settingsHandlers.loadGradioTtsApiUrl(); // Load Gradio config
    settingsHandlers.loadStabilityApiKey();
    settingsHandlers.loadElevenlabsApiKey();
    settingsHandlers.loadDeepgramApiKey();
    settingsHandlers.loadFreesoundApiKey();
    settingsHandlers.loadPexelsApiKey();
    settingsHandlers.loadWhisperModel();
    settingsHandlers.loadCustomVoices();
    settingsHandlers.autoSaveApiKeysFromInputs();

    settingsHandlers.loadSafeRephraseSetting();
    settingsHandlers.loadRightClickSetting();
    settingsHandlers.loadAudioDuckingSetting();
    settingsHandlers.loadAudioNormalizeSetting();
    settingsHandlers.loadTextOverlaySetting();
    settingsHandlers.loadMotionGraphicsSetting();
    settingsHandlers.loadOverlayIntensitySetting();
    settingsHandlers.loadAutoOverlaySfxSetting();
    settingsHandlers.loadGraphicsThemeSettings();
    settingsHandlers.loadParallaxSetting();
    initParallaxAdvancedControls(() => {
        if (!state.isVideoPlaying) drawVideoFrame(state.lastRenderedTime);
    });
    setParallaxDepthReadyHandler(() => {
        if (!state.isVideoPlaying) drawVideoFrame(state.lastRenderedTime);
    });
    settingsHandlers.loadBgBlurSetting();
    settingsHandlers.loadCinematographySettings();
    settingsHandlers.loadInstantTimestampSetting();
    settingsHandlers.loadPreferredTranscribeEngineSetting();
    videoController.loadSavedCustomFonts();
    ensureSubtitleFontsReady();
    initAds(false);
    initVoiceStudio();
    initImageStudio();
    initMapStudio();
    initMediaAssembler();
    try {
        initFilmStudio();
    } catch (err: any) {
        console.error('Failed to initialize film studio:', err);
    }
    try {
        initAcademyStudio();
    } catch (err: any) {
        console.error('Failed to initialize academy studio:', err);
    }
    ui.updateStyleDescription();
    restoreMasterAudioUI();
    ui.updateAspectRatioState();

    // Subscribe UI updates to the new state manager
    timelineState.subscribeToClips(() => videoController.updateVideoContext());
    timelineState.subscribeToSettings(() => {
        ui.renderTimelineEditor();
        if (dom.panelGraphics?.classList.contains('active')) {
            graphicsHandlers.renderGraphicsList();
        }
    });

    const selectedPacing = dom.detailLevelSelect?.value;
    if (dom.pacingControlsContainer) dom.pacingControlsContainer.style.display = selectedPacing === 'auto' ? 'block' : 'none';
    if (dom.customShotControlsContainer) dom.customShotControlsContainer.style.display = selectedPacing === 'custom' ? 'block' : 'none';
    
    // Initial check for API key requirement
    ui.triggerApiKeySelectionFlow();
    ui.populateVoiceArchetypes();
    graphicsHandlers.renderGraphicsList();

    // --- Creative Spark Animation ---
    if (dom.creativeSparkText) {
        const sparks = [
            "Dreaming up new worlds...",
            "Crafting the perfect scene...",
            "Lighting the set...",
            "Directing the action...",
            "Painting the frame...",
            "Composing the shot...",
            "Finding the angle..."
        ];
        let sparkIndex = 0;
        
        if ((window as any)._creativeSparkInterval) {
            clearInterval((window as any)._creativeSparkInterval);
        }
        
        (window as any)._creativeSparkInterval = setInterval(() => {
            if (dom.creativeSparkText) {
                dom.creativeSparkText.textContent = sparks[sparkIndex];
                dom.creativeSparkText.style.animation = 'none';
                void dom.creativeSparkText.offsetWidth; // Trigger reflow
                dom.creativeSparkText.style.animation = 'fadeInOut 5s ease-in-out infinite';
                sparkIndex = (sparkIndex + 1) % sparks.length;
            }
        }, 5000);
        dom.creativeSparkText.textContent = sparks[0];
    }
}

/**
 * Main application entry point.
 */
function ensureWritableFetch() {
    try {
        const globalObj = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : self);
        if (!globalObj) return;

        if (typeof Window !== 'undefined' && Window.prototype) {
            try {
                const protoDesc = Object.getOwnPropertyDescriptor(Window.prototype, 'fetch');
                if (protoDesc && protoDesc.get && !protoDesc.set && protoDesc.configurable !== false) {
                    const currentProtoFetch = protoDesc.get;
                    Object.defineProperty(Window.prototype, 'fetch', {
                        get: function() { return currentProtoFetch.call(this); },
                        set: function(v) {
                            Object.defineProperty(this, 'fetch', {
                                value: v,
                                writable: true,
                                configurable: true,
                                enumerable: true
                            });
                        },
                        configurable: true,
                        enumerable: protoDesc.enumerable !== false
                    });
                }
            } catch (e) {}
        }

        const winDesc = Object.getOwnPropertyDescriptor(globalObj, 'fetch');
        if (!winDesc || (winDesc.get && !winDesc.set)) {
            let activeFetch = (globalObj as any).fetch;
            Object.defineProperty(globalObj, 'fetch', {
                get: function() {
                    return activeFetch;
                },
                set: function(newFetch) {
                    activeFetch = newFetch;
                },
                configurable: true,
                enumerable: true
            });
        }
    } catch (e) {
        console.warn('[ContentGen] Fetch polyfill notice:', e);
    }
}

ensureWritableFetch();

async function startApp() {
    const exportParams = new URLSearchParams(location.search);
    if (exportParams.get('exportWorker') === '1') {
        // Dedicated Electron hidden export worker — runs fully isolated & unthrottled
        await import('./src/exporter/electron-worker-runner');
        return;
    }
    if (exportParams.get('exportMode') === '1') {
        // Headless render mode — the Node render worker drives everything
        // from here on via window.__exportBridge. Skip auth/UI/ads entirely.
        await import('./src/exportBridge');
        return;
    }

    try {
        ensureWritableFetch();
        window.addEventListener('unhandledrejection', (event) => {
            const reasonStr = String(event.reason?.message || event.reason || '');
            if (reasonStr.includes('Cannot set property fetch') || reasonStr.includes('only a getter')) {
                console.warn('[ContentGen] Handled fetch getter constraint in unhandledrejection:', event.reason);
                return;
            }
            const lower = reasonStr.toLowerCase();
            if (lower.includes('websocket closed without opened') ||
                lower.includes('failed to connect to websocket') ||
                lower.includes('[vite] failed to connect')) {
                console.warn('[Vite WebSocket Warning in App]:', event.reason);
                return;
            }
            if (lower.includes('could not reach cloud firestore backend') ||
                lower.includes("backend didn't respond within") ||
                lower.includes('offline mode until it is able to successfully connect') ||
                lower.includes('@firebase/firestore')) {
                console.warn('[Firestore Offline Warning in App]:', event.reason);
                return;
            }
            console.error('[ContentGen] Unhandled promise rejection:', (event.reason && (event.reason as any).stack) ? (event.reason as any).stack : event.reason);
        });
        window.addEventListener('error', (event) => {
            const errorStr = String(event.error?.message || event.message || '');
            if (errorStr.includes('Cannot set property fetch') || errorStr.includes('only a getter')) {
                console.warn('[ContentGen] Handled fetch getter constraint in error event:', event.error?.stack || event.error || event.message);
                return;
            }
            const lower = errorStr.toLowerCase();
            if (lower.includes('websocket closed without opened') ||
                lower.includes('failed to connect to websocket') ||
                lower.includes('[vite] failed to connect')) {
                console.warn('[Vite WebSocket Warning in App]:', event.error?.stack || event.error || event.message);
                return;
            }
            if (lower.includes('could not reach cloud firestore backend') ||
                lower.includes("backend didn't respond within") ||
                lower.includes('offline mode until it is able to successfully connect') ||
                lower.includes('@firebase/firestore')) {
                console.warn('[Firestore Offline Warning in App]:', event.error?.stack || event.error || event.message);
                return;
            }
            console.error('[ContentGen] Uncaught error:', event.error?.stack || event.error || event.message);
        });
        injectAndInit();
        initAuth();
        initSystemConfigListener();
        setupAdminSystemTabHandlers();
        registerEventListeners();
        initVsWorkspaceToggle();
        exporter.initCloudRenderBackgroundTracker();
        await initializeApp();
    } catch (err) {
        console.error('[ContentGen] Critical initialization error:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}