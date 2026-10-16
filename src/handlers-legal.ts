/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function openLegalModal(initialTab: 'privacy' | 'terms' = 'privacy') {
    const modal = document.getElementById('legal-modal') as HTMLDivElement | null;
    if (!modal) return;

    modal.classList.remove('hidden');
    switchLegalTab(initialTab);
    
    // Smoothly scroll content container to top
    const scrollContainer = document.getElementById('legal-scroll-container');
    if (scrollContainer) {
        scrollContainer.scrollTop = 0;
    }
}

export function closeLegalModal() {
    const modal = document.getElementById('legal-modal') as HTMLDivElement | null;
    if (!modal) return;
    modal.classList.add('hidden');
}

export function switchLegalTab(tab: 'privacy' | 'terms') {
    const privacyTabBtn = document.getElementById('legal-tab-privacy-btn') as HTMLButtonElement | null;
    const termsTabBtn = document.getElementById('legal-tab-terms-btn') as HTMLButtonElement | null;
    const privacyContent = document.getElementById('legal-content-privacy') as HTMLDivElement | null;
    const termsContent = document.getElementById('legal-content-terms') as HTMLDivElement | null;

    if (!privacyTabBtn || !termsTabBtn || !privacyContent || !termsContent) return;

    if (tab === 'privacy') {
        privacyTabBtn.className = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/40';
        termsTabBtn.className = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm tracking-wide transition-all bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700/50';
        privacyContent.classList.remove('hidden');
        termsContent.classList.add('hidden');
    } else {
        termsTabBtn.className = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm tracking-wide transition-all bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/40';
        privacyTabBtn.className = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs sm:text-sm tracking-wide transition-all bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-800 border border-gray-700/50';
        termsContent.classList.remove('hidden');
        privacyContent.classList.add('hidden');
    }

    const scrollContainer = document.getElementById('legal-scroll-container');
    if (scrollContainer) {
        scrollContainer.scrollTop = 0;
    }
}

export function initLegalHandlers() {
    // 1. Modal Close Buttons & Backdrop
    const closeBtn = document.getElementById('close-legal-modal-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeLegalModal());
    }
    const footerCloseBtn = document.getElementById('close-legal-modal-footer-btn');
    if (footerCloseBtn) {
        footerCloseBtn.addEventListener('click', () => closeLegalModal());
    }

    const modal = document.getElementById('legal-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeLegalModal();
            }
        });
    }

    // 2. Tab switcher buttons inside the modal
    const privacyTabBtn = document.getElementById('legal-tab-privacy-btn');
    if (privacyTabBtn) {
        privacyTabBtn.addEventListener('click', () => switchLegalTab('privacy'));
    }

    const termsTabBtn = document.getElementById('legal-tab-terms-btn');
    if (termsTabBtn) {
        termsTabBtn.addEventListener('click', () => switchLegalTab('terms'));
    }

    // 3. Landing page footer triggers
    const landingPrivacyBtn = document.getElementById('landing-privacy-btn');
    if (landingPrivacyBtn) {
        landingPrivacyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalModal('privacy');
        });
    }

    const landingTermsBtn = document.getElementById('landing-terms-btn');
    if (landingTermsBtn) {
        landingTermsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalModal('terms');
        });
    }

    // 4. Main app footer triggers
    const appPrivacyBtn = document.getElementById('app-privacy-btn');
    if (appPrivacyBtn) {
        appPrivacyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalModal('privacy');
        });
    }

    const appTermsBtn = document.getElementById('app-terms-btn');
    if (appTermsBtn) {
        appTermsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLegalModal('terms');
        });
    }

    // 5. Settings trigger
    const settingsLegalBtn = document.getElementById('settings-open-legal-btn');
    if (settingsLegalBtn) {
        settingsLegalBtn.addEventListener('click', () => openLegalModal('privacy'));
    }

    // 6. Keyboard ESC support
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const legalModal = document.getElementById('legal-modal');
            if (legalModal && !legalModal.classList.contains('hidden')) {
                closeLegalModal();
            }
        }
    });

    // 7. URL Hash Navigation support (e.g. #privacy, #terms, #privacy-policy, #terms-of-service)
    const checkHash = () => {
        const hash = window.location.hash.toLowerCase();
        if (hash === '#privacy' || hash === '#privacy-policy') {
            openLegalModal('privacy');
        } else if (hash === '#terms' || hash === '#terms-of-service' || hash === '#tos') {
            openLegalModal('terms');
        }
    };

    window.addEventListener('hashchange', checkHash);
    checkHash();
}
