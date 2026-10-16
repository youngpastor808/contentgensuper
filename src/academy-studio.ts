/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  DEFAULT_ACADEMY_MODULES, 
  getAcademyModules,
  getAllLessons, 
  findLessonById, 
  findModuleById,
  saveAcademyLesson,
  deleteAcademyLesson,
  saveAcademyModule,
  deleteAcademyModule,
  resetAcademyModulesToDefault,
  extractYouTubeVideoId,
  parseChaptersText,
  formatChaptersToText,
  subscribeToAcademyModules,
  initAcademyCoursesRemoteListener,
  type AcademyLesson, 
  type AcademyModule 
} from './academy-courses';
import { state } from './state';
import { timelineState } from './state-timeline';
import * as dom from './dom';
import { showStatus, escapeHtml } from './ui';
import { isApprovedMember, isUserAdmin, isUserOwner, openLoginModal, currentUser, userRecord } from './auth';

class AcademyStudioManager {
  private activeLessonId: string = 'lesson-101';
  private completedLessonIds: Set<string> = new Set();
  private searchQuery: string = '';
  private selectedLevelFilter: string = 'all';
  private isFollowAlongPipOpen: boolean = false;
  private currentModules: AcademyModule[] = getAcademyModules();
  private isSubscribed: boolean = false;
  private isInitialized: boolean = false;

  constructor() {
    this.loadCompletedLessonsFromStorage();
  }

  private loadCompletedLessonsFromStorage() {
    try {
      const stored = localStorage.getItem('cg_academy_completed_lessons');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.completedLessonIds = new Set(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to load completed academy lessons:', e);
    }
  }

  private saveCompletedLessonsToStorage() {
    try {
      localStorage.setItem('cg_academy_completed_lessons', JSON.stringify(Array.from(this.completedLessonIds)));
    } catch (e) {
      console.warn('Failed to save completed academy lessons:', e);
    }
  }

  public getProgressPercentage(): number {
    const all = getAllLessons();
    if (all.length === 0) return 0;
    return Math.round((this.completedLessonIds.size / all.length) * 100);
  }

  public openModal(lessonId?: string) {
    if (lessonId && findLessonById(lessonId)) {
      this.activeLessonId = lessonId;
    } else if (!findLessonById(this.activeLessonId)) {
      const all = getAllLessons();
      if (all.length > 0) this.activeLessonId = all[0].id;
    }

    const modal = document.getElementById('academy-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      try {
        this.render();
      } catch (err) {
        console.error('[Academy] Render error:', err);
      }
      this.closeFollowAlongPip(); // Close PiP when full masterclass modal opens
    } else {
      console.error('[Academy] #academy-modal not found in DOM!');
    }
  }

  public closeModal() {
    const modal = document.getElementById('academy-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      // Pause YouTube player on close by resetting iframe source
      const iframe = document.getElementById('academy-youtube-iframe') as HTMLIFrameElement | null;
      if (iframe) {
        iframe.src = 'about:blank';
      }
    }
  }

  public toggleFollowAlongPip() {
    const pip = document.getElementById('academy-floating-pip');
    if (!pip) return;

    if (this.isFollowAlongPipOpen) {
      this.closeFollowAlongPip();
    } else {
      this.openFollowAlongPip();
    }
  }

  public openFollowAlongPip() {
    if (!isApprovedMember()) {
      showStatus('🔒 Follow-Along mini player is restricted to approved members', true, 3000);
      this.openModal();
      return;
    }

    const pip = document.getElementById('academy-floating-pip');
    const lesson = findLessonById(this.activeLessonId) || getAllLessons()[0];
    if (!pip || !lesson) return;

    this.closeModal(); // Minimize masterclass view

    const pipIframe = document.getElementById('academy-pip-iframe') as HTMLIFrameElement | null;
    const pipTitle = document.getElementById('academy-pip-title');
    
    if (pipTitle) pipTitle.textContent = lesson.title;
    if (pipIframe) {
      pipIframe.src = `https://www.youtube-nocookie.com/embed/${lesson.youtubeId}?autoplay=1&enablejsapi=1&rel=0&modestbranding=1`;
    }

    pip.classList.remove('hidden');
    pip.style.display = 'flex';
    this.isFollowAlongPipOpen = true;
    showStatus(`📺 Follow-Along mini player active for "${lesson.title}"`, false, 2500);
  }

  public closeFollowAlongPip() {
    const pip = document.getElementById('academy-floating-pip');
    if (pip) {
      pip.classList.add('hidden');
      pip.style.display = 'none';
      const pipIframe = document.getElementById('academy-pip-iframe') as HTMLIFrameElement | null;
      if (pipIframe) pipIframe.src = 'about:blank';
    }
    this.isFollowAlongPipOpen = false;
  }

  public selectLesson(lessonId: string) {
    if (!isApprovedMember()) {
      showStatus('🔒 Academy masterclasses are restricted to approved members', true, 3000);
      this.render();
      return;
    }
    if (findLessonById(lessonId)) {
      this.activeLessonId = lessonId;
      this.renderLessonPlayer();
      this.renderCurriculumSidebar();
    }
  }

  public toggleLessonCompleted(lessonId: string) {
    if (!isApprovedMember()) {
      showStatus('🔒 Saving progress is restricted to approved members', true, 2500);
      return;
    }
    if (this.completedLessonIds.has(lessonId)) {
      this.completedLessonIds.delete(lessonId);
      showStatus('Lesson marked as incomplete', false, 1500);
    } else {
      this.completedLessonIds.add(lessonId);
      const lesson = findLessonById(lessonId);
      showStatus(`🎉 Completed: "${lesson?.title || 'Lesson'}"!`, false, 2500);
    }
    this.saveCompletedLessonsToStorage();
    this.render();
  }

  public seekYoutubeTo(seconds: number) {
    const iframe = document.getElementById('academy-youtube-iframe') as HTMLIFrameElement | null;
    if (!iframe) return;

    // Send postMessage to YouTube iframe API
    try {
      iframe.contentWindow?.postMessage(JSON.stringify({
        event: 'command',
        func: 'seekTo',
        args: [seconds, true]
      }), '*');
      iframe.contentWindow?.postMessage(JSON.stringify({
        event: 'command',
        func: 'playVideo',
        args: []
      }), '*');
    } catch (e) {
      console.warn('YouTube postMessage seek failed:', e);
    }

    const m = Math.floor(seconds / 60);
    const s = String(Math.floor(seconds % 60)).padStart(2, '0');
    showStatus(`⏩ Jumped to chapter: ${m}:${s}`, false, 1500);
  }

  public loadLessonIntoStudio(lessonId: string) {
    const lesson = findLessonById(lessonId);
    if (!lesson || !lesson.studioPreset) {
      showStatus('No interactive studio preset available for this lesson.', true, 2000);
      return;
    }

    const preset = lesson.studioPreset;

    // 1. Set story input text
    if (dom.storyInput && preset.scriptText) {
      dom.storyInput.value = preset.scriptText;
      dom.storyInput.dispatchEvent(new Event('input'));
    }

    // 2. Set aspect ratio if available
    if (preset.aspectRatio) {
      state.aspectRatio = preset.aspectRatio;
      const aspectSelect = document.getElementById('aspect-ratio-select') as HTMLSelectElement | null;
      if (aspectSelect) {
        aspectSelect.value = preset.aspectRatio;
        aspectSelect.dispatchEvent(new Event('change'));
      }
    }

    // 3. Set image style value if provided
    if (preset.imageStyleValue) {
      const styleSelect = document.getElementById('image-style') as HTMLSelectElement | null;
      if (styleSelect) {
        let matched = false;
        for (let i = 0; i < styleSelect.options.length; i++) {
          if (styleSelect.options[i].value === preset.imageStyleValue || styleSelect.options[i].text.includes(preset.imageStyleValue)) {
            styleSelect.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched && styleSelect.options.length > 0) {
          styleSelect.options[0].value = preset.imageStyleValue;
          styleSelect.selectedIndex = 0;
        }
        styleSelect.dispatchEvent(new Event('change'));
      }
    }

    // 4. Set characters if provided
    if (preset.characters && preset.characters.length > 0) {
      state.characterProfiles = preset.characters.map((c) => ({
        name: c.name,
        appearance_anchor: c.description || c.name,
        avatar_url: c.avatarUrl
      }));
    }

    // 5. Close modal, open Follow-Along PiP player, and show confirmation
    this.closeModal();
    this.openFollowAlongPip();

    // Ensure Studio UI is visible
    const landing = document.getElementById('landing-page');
    const appContainer = document.getElementById('app');
    if (landing && appContainer) {
      landing.classList.add('hidden');
      appContainer.classList.remove('hidden');
    }

    showStatus(`🚀 Loaded "${preset.title}" lesson template into Studio!`, false, 3500);
  }

  public copyPromptFormula(lessonId: string) {
    const lesson = findLessonById(lessonId);
    if (!lesson || !lesson.promptFormula) return;

    navigator.clipboard.writeText(lesson.promptFormula).then(() => {
      showStatus('📋 Prompt formula copied to clipboard!', false, 2000);
    }).catch(() => {
      showStatus('Failed to copy prompt formula', true, 2000);
    });
  }

  public setSearchQuery(query: string) {
    this.searchQuery = query.toLowerCase().trim();
    this.renderCurriculumSidebar();
  }

  public setLevelFilter(level: string) {
    this.selectedLevelFilter = level;
    this.renderCurriculumSidebar();
  }

  public render() {
    this.currentModules = getAcademyModules();
    const isApproved = isApprovedMember();
    const isAdmin = isUserAdmin() || isUserOwner();

    const lockedContainer = document.getElementById('academy-locked-container');
    const contentContainer = document.getElementById('academy-content-container');
    const followAlongBtn = document.getElementById('academy-follow-along-btn');
    const progressFill = document.getElementById('academy-progress-fill');
    const progressLabel = document.getElementById('academy-progress-label');
    const badgeContainer = document.getElementById('academy-mastery-badge');
    const adminManageBtn = document.getElementById('academy-admin-manage-btn');
    const adminEditLessonBtn = document.getElementById('academy-admin-edit-lesson-btn');

    // Toggle Admin Buttons in header & player
    if (adminManageBtn) {
      if (isAdmin) {
        adminManageBtn.classList.remove('hidden');
      } else {
        adminManageBtn.classList.add('hidden');
      }
    }

    if (adminEditLessonBtn) {
      if (isAdmin && isApproved) {
        adminEditLessonBtn.classList.remove('hidden');
      } else {
        adminEditLessonBtn.classList.add('hidden');
      }
    }

    if (!isApproved) {
      if (lockedContainer) {
        lockedContainer.classList.remove('hidden');
        lockedContainer.style.display = 'flex';
      }
      if (contentContainer) {
        contentContainer.classList.add('hidden');
        contentContainer.style.display = 'none';
      }
      if (followAlongBtn) followAlongBtn.classList.add('hidden');
      if (progressFill) progressFill.style.width = '0%';
      if (progressLabel) progressLabel.textContent = '🔒 Approved Members Only';
      if (badgeContainer) {
        badgeContainer.innerHTML = '<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">Members Only</span>';
      }
      this.closeFollowAlongPip();
      // Ensure iframe is blanked
      const iframe = document.getElementById('academy-youtube-iframe') as HTMLIFrameElement | null;
      if (iframe) iframe.src = 'about:blank';
      this.renderLockedGate();
      return;
    }

    if (lockedContainer) {
      lockedContainer.classList.add('hidden');
      lockedContainer.style.display = 'none';
    }
    if (contentContainer) {
      contentContainer.classList.remove('hidden');
      contentContainer.style.display = 'flex';
    }
    if (followAlongBtn) followAlongBtn.classList.remove('hidden');

    this.renderCurriculumSidebar();
    this.renderLessonPlayer();
    this.renderProgressBar();
  }

  private renderLockedGate() {
    const titleEl = document.getElementById('academy-locked-title');
    const descEl = document.getElementById('academy-locked-desc');
    const actionsContainer = document.getElementById('academy-locked-actions');
    if (!actionsContainer) return;

    const user = currentUser;
    const record = userRecord;

    if (!user || (user as any).isAnonymous || (typeof user.uid === 'string' && user.uid.startsWith('local_session_'))) {
      if (titleEl) titleEl.textContent = 'Approved Members Only Access';
      if (descEl) descEl.textContent = 'ContentGen Academy video masterclasses, prompt engineering cheatsheets, and interactive studio presets are reserved exclusively for approved members. Please log in or register your account to request membership approval.';

      actionsContainer.innerHTML = `
        <button id="academy-gate-login-btn" type="button" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-indigo-600/30 transition cursor-pointer flex items-center justify-center gap-2">
          <span>🔑 Log In</span>
        </button>
        <button id="academy-gate-signup-btn" type="button" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs border border-white/10 transition cursor-pointer flex items-center justify-center gap-2 shadow-sm">
          <span>✨ Create Account & Request Access</span>
        </button>
      `;

      const loginBtn = document.getElementById('academy-gate-login-btn');
      const signupBtn = document.getElementById('academy-gate-signup-btn');
      if (loginBtn) {
        loginBtn.onclick = () => {
          this.closeModal();
          openLoginModal();
        };
      }
      if (signupBtn) {
        signupBtn.onclick = () => {
          this.closeModal();
          openLoginModal();
        };
      }
      return;
    }

    const status = record?.status || 'pending';
    const email = user.email || 'your account';

    if (status === 'pending') {
      if (titleEl) titleEl.textContent = 'Account Approval Pending';
      if (descEl) descEl.innerHTML = `Your account (<span class="font-mono text-indigo-300 font-bold">${escapeHtml(email)}</span>) has been registered and is currently awaiting administrator review.<br class="hidden sm:inline"> Full access to Academy tutorials, YouTube video lessons, and studio presets will be unlocked as soon as your account is approved.`;

      actionsContainer.innerHTML = `
        <button id="academy-gate-refresh-btn" type="button" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-indigo-600/30 transition cursor-pointer flex items-center justify-center gap-2">
          <span>🔄 Check Approval Status</span>
        </button>
        <button id="academy-gate-close-btn" type="button" class="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white font-semibold text-xs border border-white/10 transition cursor-pointer flex items-center justify-center gap-2">
          <span>Close</span>
        </button>
      `;

      const refreshBtn = document.getElementById('academy-gate-refresh-btn');
      const closeBtn = document.getElementById('academy-gate-close-btn');
      if (refreshBtn) {
        refreshBtn.onclick = () => {
          showStatus('Checking membership status...', false, 1500);
          this.render();
        };
      }
      if (closeBtn) {
        closeBtn.onclick = () => this.closeModal();
      }
      return;
    }

    // Restricted / Banned / Rejected
    if (titleEl) titleEl.textContent = 'Academy Access Restricted';
    if (descEl) descEl.textContent = `Your account (${email}) status is currently "${status}". Academy video courses and studio presets are restricted to active approved members.`;

    actionsContainer.innerHTML = `
      <button id="academy-gate-close-btn" type="button" class="px-6 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold text-xs border border-white/10 transition cursor-pointer">
        Close
      </button>
    `;
    const closeBtn = document.getElementById('academy-gate-close-btn');
    if (closeBtn) closeBtn.onclick = () => this.closeModal();
  }

  private renderProgressBar() {
    const pct = this.getProgressPercentage();
    const all = getAllLessons();
    const completedCount = this.completedLessonIds.size;

    const progressFill = document.getElementById('academy-progress-fill');
    const progressLabel = document.getElementById('academy-progress-label');
    const badgeContainer = document.getElementById('academy-mastery-badge');

    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressLabel) progressLabel.textContent = `${completedCount} of ${all.length} Lessons Completed (${pct}%)`;
    
    if (badgeContainer) {
      if (pct === 100 && all.length > 0) {
        badgeContainer.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shadow-sm">👑 Certified AI Filmmaker</span>`;
      } else {
        badgeContainer.innerHTML = `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">In Progress</span>`;
      }
    }
  }

  private renderCurriculumSidebar() {
    const container = document.getElementById('academy-curriculum-list');
    if (!container) return;

    const isAdmin = isUserAdmin() || isUserOwner();
    let html = '';

    for (const mod of this.currentModules) {
      // Filter lessons in this module
      const filteredLessons = mod.lessons.filter(l => {
        const matchesSearch = !this.searchQuery || 
          l.title.toLowerCase().includes(this.searchQuery) ||
          l.summary.toLowerCase().includes(this.searchQuery) ||
          l.instructor.toLowerCase().includes(this.searchQuery);
        const matchesLevel = this.selectedLevelFilter === 'all' || l.level === this.selectedLevelFilter;
        return matchesSearch && matchesLevel;
      });

      html += `
        <div class="mb-4 bg-gray-950/60 rounded-xl border border-white/5 overflow-hidden shadow-xs">
          <div class="px-3.5 py-2.5 bg-gray-900/80 border-b border-white/5 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm">${mod.icon}</span>
              <span class="text-xs font-bold text-gray-200 truncate">${escapeHtml(mod.title)}</span>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <span class="text-[10px] font-mono text-gray-400 font-semibold">${mod.lessons.length}</span>
              ${isAdmin ? `
                <button type="button" data-add-lesson-module="${mod.id}" class="academy-admin-add-lesson-btn p-1 rounded hover:bg-purple-900/50 text-purple-400 hover:text-white transition cursor-pointer" title="Admin: Add Lesson to this module">
                  <span class="text-xs font-bold">➕</span>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="p-1.5 space-y-1">
      `;

      if (filteredLessons.length === 0) {
        html += `<div class="p-3 text-center text-gray-500 text-[11px] italic">No matching lessons in this module</div>`;
      }

      for (const lesson of filteredLessons) {
        const isActive = lesson.id === this.activeLessonId;
        const isCompleted = this.completedLessonIds.has(lesson.id);

        html += `
          <div class="group/card relative rounded-lg transition flex items-center justify-between ${
            isActive ? 'bg-indigo-950/90 border border-indigo-500/50 shadow-sm' : 'hover:bg-gray-900 border border-transparent'
          }">
            <button type="button" data-lesson-id="${lesson.id}" class="academy-lesson-card flex-1 text-left p-2.5 flex items-start gap-2.5 min-w-0 cursor-pointer">
              <span class="mt-0.5 text-xs ${isCompleted ? 'text-emerald-400 font-bold' : 'text-gray-500'}">
                ${isCompleted ? '✓' : '○'}
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-white truncate ${isActive ? 'text-indigo-200' : ''}">${escapeHtml(lesson.title)}</div>
                <div class="flex items-center gap-2 text-[10px] text-gray-400 font-mono mt-0.5">
                  <span>⏱️ ${lesson.duration}</span>
                  <span>•</span>
                  <span class="px-1 py-0.2 rounded bg-gray-800 text-gray-300">${lesson.level}</span>
                </div>
              </div>
            </button>
            <div class="flex items-center gap-1 pr-2">
              ${lesson.studioPreset ? '<span class="shrink-0 px-1.5 py-0.5 text-[9px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded" title="Includes Interactive Studio Template">🚀 Studio</span>' : ''}
              ${isAdmin ? `
                <button type="button" data-admin-edit-id="${lesson.id}" class="academy-admin-quick-edit-btn opacity-0 group-hover/card:opacity-100 p-1 rounded hover:bg-purple-900/60 text-purple-300 hover:text-white transition cursor-pointer text-xs" title="Admin: Edit Lesson">
                  ✏️
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    if (isAdmin) {
      html += `
        <div class="pt-2">
          <button id="academy-admin-sidebar-new-module-btn" type="button" class="w-full py-2.5 rounded-xl border border-dashed border-purple-500/40 bg-purple-950/20 hover:bg-purple-950/50 text-purple-300 hover:text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer">
            <span>➕ Create New Module</span>
          </button>
        </div>
      `;
    }

    container.innerHTML = html;

    // Attach card click handlers
    container.querySelectorAll<HTMLButtonElement>('.academy-lesson-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-lesson-id');
        if (id) this.selectLesson(id);
      });
    });

    // Attach admin quick-edit handlers
    if (isAdmin) {
      container.querySelectorAll<HTMLButtonElement>('.academy-admin-quick-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-admin-edit-id');
          if (id) this.openAdminEditorModal(id);
        });
      });

      container.querySelectorAll<HTMLButtonElement>('.academy-admin-add-lesson-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const modId = btn.getAttribute('data-add-lesson-module');
          if (modId) this.openAdminEditorModal(undefined, modId);
        });
      });

      const newModuleSidebarBtn = document.getElementById('academy-admin-sidebar-new-module-btn');
      if (newModuleSidebarBtn) {
        newModuleSidebarBtn.addEventListener('click', () => {
          this.openAdminEditorModal();
          this.switchAdminTab('module');
        });
      }
    }
  }

  private renderLessonPlayer() {
    const lesson = findLessonById(this.activeLessonId) || getAllLessons()[0];
    if (!lesson) return;

    const titleEl = document.getElementById('academy-player-title');
    const metaEl = document.getElementById('academy-player-meta');
    const summaryEl = document.getElementById('academy-player-summary');
    const iframe = document.getElementById('academy-youtube-iframe') as HTMLIFrameElement | null;
    const chaptersContainer = document.getElementById('academy-chapters-container');
    const takeawaysContainer = document.getElementById('academy-takeaways-container');
    const promptFormulaEl = document.getElementById('academy-prompt-formula');
    const studioPresetBtn = document.getElementById('academy-load-studio-btn') as HTMLButtonElement | null;
    const completeBtn = document.getElementById('academy-toggle-complete-btn') as HTMLButtonElement | null;

    if (titleEl) titleEl.textContent = lesson.title;
    if (metaEl) {
      metaEl.innerHTML = `
        <span class="font-bold text-indigo-300">${escapeHtml(lesson.moduleTitle)}</span>
        <span>•</span>
        <span>👤 ${escapeHtml(lesson.instructor)}</span>
        <span>•</span>
        <span class="px-2 py-0.5 rounded bg-gray-800 border border-white/10 font-mono text-[10px] text-gray-300">${lesson.level}</span>
        <span>•</span>
        <span>⏱️ ${lesson.duration}</span>
      `;
    }

    if (summaryEl) summaryEl.textContent = lesson.summary;

    if (iframe) {
      const cleanId = extractYouTubeVideoId(lesson.youtubeId);
      const targetSrc = `https://www.youtube-nocookie.com/embed/${cleanId}?enablejsapi=1&rel=0&modestbranding=1`;
      if (!iframe.src.includes(cleanId)) {
        iframe.src = targetSrc;
      }
    }

    // Chapters
    if (chaptersContainer) {
      if (lesson.chapters && lesson.chapters.length > 0) {
        chaptersContainer.innerHTML = lesson.chapters.map(ch => {
          const m = Math.floor(ch.time / 60);
          const s = String(Math.floor(ch.time % 60)).padStart(2, '0');
          return `
            <button type="button" data-chapter-time="${ch.time}" class="academy-chapter-btn text-left px-2.5 py-1.5 rounded-lg bg-gray-900/90 hover:bg-indigo-900/50 text-xs text-gray-300 hover:text-white border border-white/5 transition flex items-center justify-between gap-2 cursor-pointer">
              <span class="truncate">${escapeHtml(ch.label)}</span>
              <span class="text-[10px] font-mono font-bold text-indigo-400 shrink-0 bg-indigo-950 px-1.5 py-0.5 rounded border border-indigo-500/30">${m}:${s}</span>
            </button>
          `;
        }).join('');

        chaptersContainer.querySelectorAll<HTMLButtonElement>('.academy-chapter-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const timeStr = btn.getAttribute('data-chapter-time');
            if (timeStr) this.seekYoutubeTo(parseFloat(timeStr));
          });
        });
      } else {
        chaptersContainer.innerHTML = '<span class="text-xs text-gray-500 italic">No timestamp chapters for this lesson.</span>';
      }
    }

    // Key Takeaways
    if (takeawaysContainer) {
      takeawaysContainer.innerHTML = (lesson.keyTakeaways || []).map(t => `
        <li class="flex items-start gap-2 text-xs text-gray-300">
          <span class="text-indigo-400 mt-0.5">✦</span>
          <span>${escapeHtml(t)}</span>
        </li>
      `).join('');
    }

    // Prompt Formula
    if (promptFormulaEl) {
      promptFormulaEl.textContent = lesson.promptFormula || 'No formula required for this lesson.';
    }

    // Load into Studio Button
    if (studioPresetBtn) {
      if (lesson.studioPreset) {
        studioPresetBtn.classList.remove('hidden');
        studioPresetBtn.onclick = () => this.loadLessonIntoStudio(lesson.id);
      } else {
        studioPresetBtn.classList.add('hidden');
      }
    }

    // Complete Button
    if (completeBtn) {
      const isDone = this.completedLessonIds.has(lesson.id);
      completeBtn.innerHTML = isDone 
        ? '<span>✓</span> <span>Completed</span>'
        : '<span>○</span> <span>Mark as Completed</span>';
      completeBtn.className = isDone
        ? 'px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs'
        : 'px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs';
      completeBtn.onclick = () => this.toggleLessonCompleted(lesson.id);
    }
  }

  // --- ADMIN COURSE & MODULE STUDIO METHODS ---

  public openAdminEditorModal(lessonId?: string, defaultModuleId?: string) {
    const modal = document.getElementById('academy-admin-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    this.switchAdminTab('lesson');
    this.populateAdminModuleSelect(defaultModuleId);
    this.renderAdminModulesList();

    const lesson = lessonId ? findLessonById(lessonId) : undefined;
    const formTitle = document.getElementById('academy-admin-form-title');
    const deleteBtn = document.getElementById('academy-admin-delete-lesson-btn');

    const idInput = document.getElementById('academy-admin-lesson-id') as HTMLInputElement | null;
    const moduleSelect = document.getElementById('academy-admin-module-select') as HTMLSelectElement | null;
    const titleInput = document.getElementById('academy-admin-lesson-title') as HTMLInputElement | null;
    const instructorInput = document.getElementById('academy-admin-instructor-input') as HTMLInputElement | null;
    const youtubeInput = document.getElementById('academy-admin-youtube-input') as HTMLInputElement | null;
    const durationInput = document.getElementById('academy-admin-duration-input') as HTMLInputElement | null;
    const levelSelect = document.getElementById('academy-admin-level-select') as HTMLSelectElement | null;
    const summaryInput = document.getElementById('academy-admin-summary-input') as HTMLInputElement | null;
    const takeawaysInput = document.getElementById('academy-admin-takeaways-input') as HTMLTextAreaElement | null;
    const formulaInput = document.getElementById('academy-admin-formula-input') as HTMLTextAreaElement | null;
    const chaptersInput = document.getElementById('academy-admin-chapters-input') as HTMLTextAreaElement | null;
    const presetTitle = document.getElementById('academy-admin-preset-title') as HTMLInputElement | null;
    const presetAspect = document.getElementById('academy-admin-preset-aspect') as HTMLSelectElement | null;
    const presetStyle = document.getElementById('academy-admin-preset-style') as HTMLInputElement | null;
    const presetScript = document.getElementById('academy-admin-preset-script') as HTMLTextAreaElement | null;

    if (lesson) {
      if (formTitle) formTitle.innerHTML = `<span>✏️</span> <span>Edit Lesson: "${escapeHtml(lesson.title)}"</span>`;
      if (deleteBtn) deleteBtn.classList.remove('hidden');

      if (idInput) idInput.value = lesson.id;
      if (moduleSelect) moduleSelect.value = lesson.moduleId;
      if (titleInput) titleInput.value = lesson.title;
      if (instructorInput) instructorInput.value = lesson.instructor;
      if (youtubeInput) youtubeInput.value = lesson.youtubeId;
      if (durationInput) durationInput.value = lesson.duration;
      if (levelSelect) levelSelect.value = lesson.level;
      if (summaryInput) summaryInput.value = lesson.summary;
      if (takeawaysInput) takeawaysInput.value = (lesson.keyTakeaways || []).join('\n');
      if (formulaInput) formulaInput.value = lesson.promptFormula || '';
      if (chaptersInput) chaptersInput.value = formatChaptersToText(lesson.chapters);

      if (lesson.studioPreset) {
        if (presetTitle) presetTitle.value = lesson.studioPreset.title || '';
        if (presetAspect) presetAspect.value = lesson.studioPreset.aspectRatio || '16:9';
        if (presetStyle) presetStyle.value = lesson.studioPreset.imageStyleValue || '';
        if (presetScript) presetScript.value = lesson.studioPreset.scriptText || '';
      } else {
        if (presetTitle) presetTitle.value = '';
        if (presetAspect) presetAspect.value = '16:9';
        if (presetStyle) presetStyle.value = '';
        if (presetScript) presetScript.value = '';
      }
    } else {
      if (formTitle) formTitle.innerHTML = `<span>➕</span> <span>Create New Video Lesson</span>`;
      if (deleteBtn) deleteBtn.classList.add('hidden');

      if (idInput) idInput.value = '';
      if (defaultModuleId && moduleSelect) moduleSelect.value = defaultModuleId;
      if (titleInput) titleInput.value = '';
      if (instructorInput) instructorInput.value = 'ContentGen Lead';
      if (youtubeInput) youtubeInput.value = '';
      if (durationInput) durationInput.value = '10:00';
      if (levelSelect) levelSelect.value = 'Beginner';
      if (summaryInput) summaryInput.value = '';
      if (takeawaysInput) takeawaysInput.value = '';
      if (formulaInput) formulaInput.value = '';
      if (chaptersInput) chaptersInput.value = '00:00 - Introduction\n01:30 - Core Concept\n04:00 - Studio Practice';
      if (presetTitle) presetTitle.value = '';
      if (presetAspect) presetAspect.value = '16:9';
      if (presetStyle) presetStyle.value = '';
      if (presetScript) presetScript.value = '';
    }

    this.updateLiveVideoPreview();
  }

  public closeAdminEditorModal() {
    const modal = document.getElementById('academy-admin-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  public switchAdminTab(tab: 'lesson' | 'module') {
    const lessonBtn = document.getElementById('academy-admin-tab-lesson-btn');
    const moduleBtn = document.getElementById('academy-admin-tab-module-btn');
    const lessonView = document.getElementById('academy-admin-lesson-view');
    const moduleView = document.getElementById('academy-admin-modules-view');
    const saveBtn = document.getElementById('academy-admin-save-lesson-btn');
    const deleteBtn = document.getElementById('academy-admin-delete-lesson-btn');

    if (tab === 'lesson') {
      lessonBtn?.classList.add('bg-purple-600', 'text-white');
      lessonBtn?.classList.remove('text-gray-400');
      moduleBtn?.classList.remove('bg-purple-600', 'text-white');
      moduleBtn?.classList.add('text-gray-400');

      lessonView?.classList.remove('hidden');
      moduleView?.classList.add('hidden');
      if (saveBtn) saveBtn.classList.remove('hidden');
    } else {
      moduleBtn?.classList.add('bg-purple-600', 'text-white');
      moduleBtn?.classList.remove('text-gray-400');
      lessonBtn?.classList.remove('bg-purple-600', 'text-white');
      lessonBtn?.classList.add('text-gray-400');

      moduleView?.classList.remove('hidden');
      lessonView?.classList.add('hidden');
      if (saveBtn) saveBtn.classList.add('hidden');
      if (deleteBtn) deleteBtn.classList.add('hidden');
    }
  }

  private populateAdminModuleSelect(selectedModuleId?: string) {
    const select = document.getElementById('academy-admin-module-select') as HTMLSelectElement | null;
    if (!select) return;

    select.innerHTML = this.currentModules.map(m => `
      <option value="${m.id}" ${m.id === selectedModuleId ? 'selected' : ''}>
        ${m.icon} ${escapeHtml(m.title)}
      </option>
    `).join('');
  }

  private renderAdminModulesList() {
    const container = document.getElementById('academy-admin-modules-list');
    if (!container) return;

    container.innerHTML = this.currentModules.map(mod => `
      <div class="p-3 bg-gray-900/80 border border-white/10 rounded-xl flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="text-lg">${mod.icon}</span>
          <div class="min-w-0">
            <div class="text-xs font-bold text-white truncate">${escapeHtml(mod.title)}</div>
            <div class="text-[10px] text-gray-400 truncate">${escapeHtml(mod.description || 'No description')}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] font-mono text-gray-400 bg-gray-950 px-2 py-0.5 rounded border border-white/5">${mod.lessons.length} lessons</span>
          <button type="button" data-admin-del-module="${mod.id}" class="p-1.5 rounded-lg hover:bg-red-950/60 text-red-400 hover:text-red-300 transition cursor-pointer text-xs" title="Delete Module">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll<HTMLButtonElement>('[data-admin-del-module]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-admin-del-module');
        if (id) {
          if (confirm(`Are you sure you want to delete this module and all its lessons?`)) {
            await deleteAcademyModule(id);
            this.populateAdminModuleSelect();
            this.renderAdminModulesList();
            this.render();
            showStatus('Module deleted', false, 2000);
          }
        }
      });
    });
  }

  private updateLiveVideoPreview() {
    const youtubeInput = document.getElementById('academy-admin-youtube-input') as HTMLInputElement | null;
    const previewContainer = document.getElementById('academy-admin-video-preview');
    if (!youtubeInput || !previewContainer) return;

    const raw = youtubeInput.value.trim();
    const videoId = extractYouTubeVideoId(raw);

    if (videoId && videoId.length === 11) {
      previewContainer.innerHTML = `
        <div class="flex items-center gap-3 w-full">
          <img src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg" class="w-24 h-14 object-cover rounded-lg border border-white/10 shadow-sm shrink-0" alt="Video thumbnail" />
          <div>
            <div class="text-xs font-bold text-emerald-300 flex items-center gap-1">
              <span>✓</span> <span>Valid YouTube ID: ${videoId}</span>
            </div>
            <div class="text-[10px] text-gray-400 mt-0.5">Thumbnail verified. Video will embed seamlessly in 16:9 player.</div>
          </div>
        </div>
      `;
    } else if (raw) {
      previewContainer.innerHTML = `
        <span class="text-lg">⚠️</span>
        <span class="text-amber-300">Could not extract standard 11-character YouTube video ID. Check the link format.</span>
      `;
    } else {
      previewContainer.innerHTML = `
        <span class="text-lg">📺</span>
        <span class="text-gray-500">Paste any YouTube watch link (e.g. youtube.com/watch?v=...) or video ID</span>
      `;
    }
  }

  public async saveAdminLessonFromForm() {
    const idInput = document.getElementById('academy-admin-lesson-id') as HTMLInputElement | null;
    const moduleSelect = document.getElementById('academy-admin-module-select') as HTMLSelectElement | null;
    const titleInput = document.getElementById('academy-admin-lesson-title') as HTMLInputElement | null;
    const instructorInput = document.getElementById('academy-admin-instructor-input') as HTMLInputElement | null;
    const youtubeInput = document.getElementById('academy-admin-youtube-input') as HTMLInputElement | null;
    const durationInput = document.getElementById('academy-admin-duration-input') as HTMLInputElement | null;
    const levelSelect = document.getElementById('academy-admin-level-select') as HTMLSelectElement | null;
    const summaryInput = document.getElementById('academy-admin-summary-input') as HTMLInputElement | null;
    const takeawaysInput = document.getElementById('academy-admin-takeaways-input') as HTMLTextAreaElement | null;
    const formulaInput = document.getElementById('academy-admin-formula-input') as HTMLTextAreaElement | null;
    const chaptersInput = document.getElementById('academy-admin-chapters-input') as HTMLTextAreaElement | null;
    const presetTitle = document.getElementById('academy-admin-preset-title') as HTMLInputElement | null;
    const presetAspect = document.getElementById('academy-admin-preset-aspect') as HTMLSelectElement | null;
    const presetStyle = document.getElementById('academy-admin-preset-style') as HTMLInputElement | null;
    const presetScript = document.getElementById('academy-admin-preset-script') as HTMLTextAreaElement | null;

    const title = titleInput?.value.trim() || '';
    const youtubeRaw = youtubeInput?.value.trim() || '';
    const moduleId = moduleSelect?.value || '';

    if (!title) {
      alert('Please enter a lesson title.');
      titleInput?.focus();
      return;
    }

    if (!youtubeRaw) {
      alert('Please enter a YouTube video URL or ID.');
      youtubeInput?.focus();
      return;
    }

    if (!moduleId) {
      alert('Please select or create a module.');
      return;
    }

    const cleanYoutubeId = extractYouTubeVideoId(youtubeRaw);
    const keyTakeaways = (takeawaysInput?.value || '')
      .split('\n')
      .map(t => t.trim())
      .filter(Boolean);

    const chapters = parseChaptersText(chaptersInput?.value || '');

    let studioPreset: any = undefined;
    if (presetTitle?.value.trim() || presetScript?.value.trim()) {
      studioPreset = {
        title: presetTitle?.value.trim() || title,
        scriptText: presetScript?.value.trim() || '',
        aspectRatio: (presetAspect?.value || '16:9') as any,
        imageStyleValue: presetStyle?.value.trim() || undefined
      };
    }

    const saveBtn = document.getElementById('academy-admin-save-lesson-btn');
    if (saveBtn) saveBtn.innerHTML = `<span>⏳ Saving...</span>`;

    try {
      const lessonId = await saveAcademyLesson(moduleId, {
        id: idInput?.value || undefined,
        title,
        youtubeId: cleanYoutubeId,
        instructor: instructorInput?.value.trim() || 'ContentGen Lead',
        duration: durationInput?.value.trim() || '10:00',
        level: (levelSelect?.value || 'Beginner') as any,
        summary: summaryInput?.value.trim() || '',
        keyTakeaways,
        promptFormula: formulaInput?.value.trim() || '',
        chapters,
        studioPreset
      });

      this.activeLessonId = lessonId;
      this.closeAdminEditorModal();
      this.render();
      showStatus(`✨ Lesson "${title}" saved successfully!`, false, 3000);
    } catch (err: any) {
      console.error('[Academy] Failed to save lesson:', err);
      alert(`Failed to save lesson: ${err.message}`);
    } finally {
      if (saveBtn) saveBtn.innerHTML = `<span>💾 Save Lesson to Academy</span>`;
    }
  }

  public async deleteCurrentAdminLesson() {
    const idInput = document.getElementById('academy-admin-lesson-id') as HTMLInputElement | null;
    const lessonId = idInput?.value;
    if (!lessonId) return;

    const lesson = findLessonById(lessonId);
    if (!confirm(`Are you sure you want to delete the lesson "${lesson?.title || lessonId}"?`)) return;

    try {
      await deleteAcademyLesson(lessonId);
      const remaining = getAllLessons();
      if (remaining.length > 0) {
        this.activeLessonId = remaining[0].id;
      }
      this.closeAdminEditorModal();
      this.render();
      showStatus('🗑️ Lesson deleted from Academy.', false, 2500);
    } catch (err: any) {
      console.error('[Academy] Failed to delete lesson:', err);
      alert(`Failed to delete lesson: ${err.message}`);
    }
  }

  public async createNewModuleFromForm() {
    const iconInput = document.getElementById('academy-admin-new-module-icon') as HTMLInputElement | null;
    const titleInput = document.getElementById('academy-admin-new-module-title') as HTMLInputElement | null;
    const descInput = document.getElementById('academy-admin-new-module-desc') as HTMLInputElement | null;

    const title = titleInput?.value.trim();
    if (!title) {
      alert('Please enter a module title.');
      titleInput?.focus();
      return;
    }

    const icon = iconInput?.value.trim() || '🎓';
    const description = descInput?.value.trim() || '';

    const modId = await saveAcademyModule({
      title,
      icon,
      description
    });

    if (titleInput) titleInput.value = '';
    if (descInput) descInput.value = '';

    this.populateAdminModuleSelect(modId);
    this.renderAdminModulesList();
    this.render();
    showStatus(`✨ Module "${title}" created!`, false, 2500);
  }

  public init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    if (!this.isSubscribed) {
      this.isSubscribed = true;
      subscribeToAcademyModules((mods) => {
        this.currentModules = mods;
        this.render();
      });
      initAcademyCoursesRemoteListener().catch(console.warn);
    }

    const ACADEMY_LAUNCHER_SELECTOR =
      '#landing-academy-btn, ' +
      '#header-academy-btn, ' +
      '#video-director-academy-btn, ' +
      '#open-academy-dropdown-btn, ' +
      '#open-academy-btn-mobile, ' +
      '[data-action="open-academy"]';

    // 1. Header & Landing Page Launchers (Direct Bindings)
    document.querySelectorAll<HTMLButtonElement>(ACADEMY_LAUNCHER_SELECTOR).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.openModal();
      });
    });

    // Global Document-Level Delegation (Catches clicks anywhere, anytime)
    document.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        ACADEMY_LAUNCHER_SELECTOR
      );
      if (target) {
        e.preventDefault();
        this.openModal();
      }

      const closeTarget = (e.target as HTMLElement | null)?.closest(
        '#close-academy-modal-btn, #academy-modal-backdrop'
      );
      if (closeTarget) {
        e.preventDefault();
        this.closeModal();
      }

      const adminCloseTarget = (e.target as HTMLElement | null)?.closest('#close-academy-admin-modal-btn');
      if (adminCloseTarget) {
        e.preventDefault();
        this.closeAdminEditorModal();
      }
    });

    // Keyboard support: Escape closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const adminModal = document.getElementById('academy-admin-modal');
        if (adminModal && !adminModal.classList.contains('hidden') && adminModal.style.display !== 'none') {
          this.closeAdminEditorModal();
          return;
        }
        const modal = document.getElementById('academy-modal');
        if (modal && !modal.classList.contains('hidden') && modal.style.display !== 'none') {
          this.closeModal();
        }
      }
    });

    // 2. Admin Manage Academy Trigger
    const adminManageBtn = document.getElementById('academy-admin-manage-btn');
    if (adminManageBtn) {
      adminManageBtn.addEventListener('click', () => this.openAdminEditorModal());
    }

    const adminEditLessonBtn = document.getElementById('academy-admin-edit-lesson-btn');
    if (adminEditLessonBtn) {
      adminEditLessonBtn.addEventListener('click', () => this.openAdminEditorModal(this.activeLessonId));
    }

    // 3. Admin Modal Tabs & Buttons
    const tabLessonBtn = document.getElementById('academy-admin-tab-lesson-btn');
    const tabModuleBtn = document.getElementById('academy-admin-tab-module-btn');
    if (tabLessonBtn) tabLessonBtn.addEventListener('click', () => this.switchAdminTab('lesson'));
    if (tabModuleBtn) tabModuleBtn.addEventListener('click', () => this.switchAdminTab('module'));

    const newLessonBtn = document.getElementById('academy-admin-new-lesson-btn');
    if (newLessonBtn) newLessonBtn.addEventListener('click', () => this.openAdminEditorModal());

    const saveLessonBtn = document.getElementById('academy-admin-save-lesson-btn');
    if (saveLessonBtn) saveLessonBtn.addEventListener('click', () => this.saveAdminLessonFromForm());

    const deleteLessonBtn = document.getElementById('academy-admin-delete-lesson-btn');
    if (deleteLessonBtn) deleteLessonBtn.addEventListener('click', () => this.deleteCurrentAdminLesson());

    const createModuleBtn = document.getElementById('academy-admin-create-module-btn');
    if (createModuleBtn) createModuleBtn.addEventListener('click', () => this.createNewModuleFromForm());

    const resetDefaultBtn = document.getElementById('academy-admin-reset-default-btn');
    if (resetDefaultBtn) {
      resetDefaultBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all academy courses and lessons to factory defaults? Any custom lessons will be overwritten.')) {
          await resetAcademyModulesToDefault();
          this.populateAdminModuleSelect();
          this.renderAdminModulesList();
          this.render();
          showStatus('🔄 Academy courses reset to default!', false, 2500);
        }
      });
    }

    const youtubeInput = document.getElementById('academy-admin-youtube-input');
    if (youtubeInput) {
      youtubeInput.addEventListener('input', () => this.updateLiveVideoPreview());
    }

    // 4. Follow-Along Mini Player Trigger
    const followAlongBtn = document.getElementById('academy-follow-along-btn');
    if (followAlongBtn) {
      followAlongBtn.addEventListener('click', () => this.toggleFollowAlongPip());
    }

    const pipCloseBtn = document.getElementById('academy-pip-close-btn');
    if (pipCloseBtn) {
      pipCloseBtn.addEventListener('click', () => this.closeFollowAlongPip());
    }

    const pipExpandBtn = document.getElementById('academy-pip-expand-btn');
    if (pipExpandBtn) {
      pipExpandBtn.addEventListener('click', () => {
        this.closeFollowAlongPip();
        this.openModal(this.activeLessonId);
      });
    }

    // 5. Search & Filter Listeners
    const searchInput = document.getElementById('academy-search-input') as HTMLInputElement | null;
    if (searchInput) {
      searchInput.addEventListener('input', () => this.setSearchQuery(searchInput.value));
    }

    document.querySelectorAll<HTMLButtonElement>('.academy-level-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.academy-level-chip').forEach(c => {
          c.classList.remove('bg-indigo-600', 'text-white', 'border-indigo-400');
          c.classList.add('bg-gray-900', 'text-gray-400', 'border-white/5');
        });
        chip.classList.remove('bg-gray-900', 'text-gray-400', 'border-white/5');
        chip.classList.add('bg-indigo-600', 'text-white', 'border-indigo-400');
        const level = chip.getAttribute('data-level') || 'all';
        this.setLevelFilter(level);
      });
    });

    // 6. Copy Prompt Formula Button
    const copyFormulaBtn = document.getElementById('academy-copy-formula-btn');
    if (copyFormulaBtn) {
      copyFormulaBtn.addEventListener('click', () => this.copyPromptFormula(this.activeLessonId));
    }

    // Render initial state
    this.render();
  }
}

export const academyStudio = new AcademyStudioManager();
export function initAcademyStudio() {
  academyStudio.init();
}
export function openAcademyModal(lessonId?: string) {
  academyStudio.openModal(lessonId);
}
