import { db, handleFirestoreError, OperationType } from './firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import * as dom from './dom';
import * as ui from './ui';
import { safeJsonStringify } from './utils-core';
import { state } from './state';

export interface AdConfig {
    enabled: boolean;
    type: 'image'; // Hardcoded for security, HTML and URL types removed
    code: string;
    linkUrl?: string;
    width: number;
    height: number;
    label?: string;
    updatedAt?: any;
    updatedBy?: string;
}

const DEFAULT_AD_CONFIG: AdConfig = {
    enabled: false,
    type: 'image',
    code: '',
    linkUrl: '',
    width: 280,
    height: 38,
    label: 'Ad'
};

let currentAdConfig: AdConfig = { ...DEFAULT_AD_CONFIG };
let isUserAdmin = false;
let unsubscribeAdConfig: (() => void) | null = null;

export function initAds(isAdmin: boolean) {
    isUserAdmin = isAdmin;
    
    // Load local storage cache first for instant render
    const cached = localStorage.getItem('contentgen_ad_config');
    if (cached) {
        try {
            currentAdConfig = JSON.parse(cached);
            renderHeaderAd();
        } catch (e) {
            console.warn("Could not parse cached ad config", e);
        }
    }

    // Subscribe to Firestore settings doc
    if (unsubscribeAdConfig) {
        unsubscribeAdConfig();
    }

    try {
        const adDocRef = doc(db, 'settings', 'ad_config');
        unsubscribeAdConfig = onSnapshot(adDocRef, (snapshot) => {
            if (snapshot.exists()) {
                currentAdConfig = { ...DEFAULT_AD_CONFIG, ...snapshot.data() } as AdConfig;
                localStorage.setItem('contentgen_ad_config', safeJsonStringify(currentAdConfig));
                renderHeaderAd();
            } else {
                renderHeaderAd();
            }
        }, (err) => {
            console.warn("[AdConfig] Public ad_config sync notice:", err);
            renderHeaderAd();
        });
    } catch (err) {
        console.warn("Firestore ad listener error:", err);
        renderHeaderAd();
    }

    // Bind event listeners for admin modal
    bindAdEvents();
}

export function setAdUserRole(isAdmin: boolean) {
    isUserAdmin = isAdmin;
    renderHeaderAd();
}

function sanitizeHttpsUrl(input: string): string {
    if (!input) return '';
    try {
        const url = new URL(input.trim());
        if (url.protocol !== 'https:') return '';
        return url.toString();
    } catch {
        return '';
    }
}

function renderSecureImageAd(target: HTMLElement, imageUrl: string, linkUrl?: string) {
    target.innerHTML = '';

    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = 'Ad Banner';
    image.className = 'w-full h-full object-cover rounded-lg';

    const badge = document.createElement('span');
    badge.className = 'absolute bottom-0.5 right-1 bg-black/70 text-[8px] text-gray-300 font-mono px-1 rounded';
    badge.textContent = 'Ad';

    const wrapper = document.createElement(linkUrl ? 'a' : 'div');
    wrapper.className = 'block w-full h-full relative group';

    if (wrapper instanceof HTMLAnchorElement) {
        wrapper.href = linkUrl || '#';
        wrapper.target = '_blank';
        wrapper.rel = 'noopener noreferrer';
    }

    wrapper.appendChild(image);
    wrapper.appendChild(badge);
    target.appendChild(wrapper);
}

export function renderHeaderAd() {
    const wrapper = document.getElementById('header-ad-wrapper');
    const container = document.getElementById('header-ad-container');
    const adminBtn = document.getElementById('admin-manage-ads-btn');

    if (!wrapper || !container) return;

    // Admin button visibility
    if (adminBtn) {
        if (isUserAdmin && state.systemConfig.showAdsAdminButton) {
            adminBtn.classList.remove('hidden');
        } else {
            adminBtn.classList.add('hidden');
        }
    }

    if (!currentAdConfig.enabled) {
        if (isUserAdmin && state.systemConfig.showAdsAdminButton) {
            wrapper.classList.remove('hidden');
            wrapper.classList.add('flex');
            container.style.width = '160px';
            container.style.height = '32px';
            container.innerHTML = `
                <div class="text-[10px] text-purple-300 flex items-center gap-1 cursor-pointer px-2 py-1" id="ad-placeholder-click">
                    <span>⚡ Ads Off</span>
                    <span class="text-[9px] bg-purple-900/60 border border-purple-500/40 px-1 rounded text-purple-200 font-mono">Enable (Admin)</span>
                </div>
            `;
            document.getElementById('ad-placeholder-click')?.addEventListener('click', openAdModal);
        } else {
            wrapper.classList.add('hidden');
            wrapper.classList.remove('flex');
        }
        return;
    }

    wrapper.classList.remove('hidden');
    wrapper.classList.add('flex');
    const width = Math.min(Math.max(currentAdConfig.width || 280, 100), 500);
    const height = Math.min(Math.max(currentAdConfig.height || 38, 20), 120);
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;

    const imageUrl = sanitizeHttpsUrl(currentAdConfig.code);
    const linkUrl = sanitizeHttpsUrl(currentAdConfig.linkUrl || '');

    if (!imageUrl) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    renderSecureImageAd(container, imageUrl, linkUrl || undefined);
}

export function openAdModal() {
    if (!isUserAdmin) {
        alert("Only Administrators can modify embedded ad settings.");
        return;
    }

    const modal = document.getElementById('admin-ad-modal');
    if (!modal) return;

    const enableCheck = document.getElementById('ad-enable-check') as HTMLInputElement;
    const typeSelect = document.getElementById('ad-type-select') as HTMLSelectElement;
    const codeInput = document.getElementById('ad-code-input') as HTMLTextAreaElement;
    const linkInput = document.getElementById('ad-link-input') as HTMLInputElement;
    const widthInput = document.getElementById('ad-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('ad-height-input') as HTMLInputElement;
    const imageLinkGroup = document.getElementById('ad-image-link-group');

    if (enableCheck) enableCheck.checked = currentAdConfig.enabled;
    if (typeSelect) typeSelect.value = 'image'; // Force image
    if (codeInput) codeInput.value = currentAdConfig.code;
    if (linkInput) linkInput.value = currentAdConfig.linkUrl || '';
    if (widthInput) widthInput.value = String(currentAdConfig.width || 280);
    if (heightInput) heightInput.value = String(currentAdConfig.height || 38);

    if (imageLinkGroup) {
        imageLinkGroup.classList.remove('hidden');
    }

    updateAdPreview();
    modal.classList.remove('hidden');
}

export function closeAdModal() {
    const modal = document.getElementById('admin-ad-modal');
    if (modal) modal.classList.add('hidden');
}

function updateAdPreview() {
    const previewContainer = document.getElementById('ad-modal-preview-box');
    const typeSelect = document.getElementById('ad-type-select') as HTMLSelectElement;
    const codeInput = document.getElementById('ad-code-input') as HTMLTextAreaElement;
    const linkInput = document.getElementById('ad-link-input') as HTMLInputElement;
    const widthInput = document.getElementById('ad-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('ad-height-input') as HTMLInputElement;

    if (!previewContainer) return;

    const code = codeInput?.value || '';
    const link = linkInput?.value || '';
    const width = Math.min(Math.max(parseInt(widthInput?.value || '280', 10), 100), 500);
    const height = Math.min(Math.max(parseInt(heightInput?.value || '38', 10), 20), 120);

    previewContainer.style.width = `${width}px`;
    previewContainer.style.height = `${height}px`;

    const imageUrl = sanitizeHttpsUrl(code);
    const safeLink = sanitizeHttpsUrl(link);

    if (imageUrl) {
        renderSecureImageAd(previewContainer, imageUrl, safeLink || undefined);
    } else {
        previewContainer.innerHTML = '<div class="text-xs text-red-400 p-2 text-center h-full flex items-center justify-center">Image URL must be a valid HTTPS URL</div>';
    }
}

async function handleSaveAdConfig() {
    if (!isUserAdmin) {
        alert("Only Administrators can save ad settings.");
        return;
    }

    const enableCheck = document.getElementById('ad-enable-check') as HTMLInputElement;
    const typeSelect = document.getElementById('ad-type-select') as HTMLSelectElement;
    const codeInput = document.getElementById('ad-code-input') as HTMLTextAreaElement;
    const linkInput = document.getElementById('ad-link-input') as HTMLInputElement;
    const widthInput = document.getElementById('ad-width-input') as HTMLInputElement;
    const heightInput = document.getElementById('ad-height-input') as HTMLInputElement;
    const saveBtn = document.getElementById('save-ad-config-btn') as HTMLButtonElement;

    const newConfig: AdConfig = {
        enabled: enableCheck?.checked ?? true,
        type: 'image',
        code: codeInput?.value || '',
        linkUrl: linkInput?.value || '',
        width: parseInt(widthInput?.value || '280', 10),
        height: parseInt(heightInput?.value || '38', 10),
        updatedAt: new Date().toISOString()
    };

    const safeImageUrl = sanitizeHttpsUrl(newConfig.code);
    const safeLinkUrl = sanitizeHttpsUrl(newConfig.linkUrl || '');

    if (!safeImageUrl && newConfig.enabled) {
        ui.showStatus('Ad image URL must be a valid HTTPS URL.', true, 3500);
        return;
    }

    newConfig.code = safeImageUrl;
    newConfig.linkUrl = safeLinkUrl;

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving Ads...';
    }

    currentAdConfig = newConfig;
    localStorage.setItem('contentgen_ad_config', safeJsonStringify(currentAdConfig));
    renderHeaderAd();

    try {
        const adDocRef = doc(db, 'settings', 'ad_config');
        await setDoc(adDocRef, newConfig, { merge: true });
    } catch (err) {
        console.warn("Could not save ad config to Firestore (saved locally):", err);
    }

    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Deploy Ads';
    }

    ui.showStatus(newConfig.enabled ? '✅ Header ads enabled & saved.' : '⚡ Header ads disabled & saved.', false, 3000);

    closeAdModal();
}

function bindAdEvents() {
    document.getElementById('admin-manage-ads-btn')?.addEventListener('click', openAdModal);
    document.getElementById('close-ad-modal-btn')?.addEventListener('click', closeAdModal);
    document.getElementById('cancel-ad-modal-btn')?.addEventListener('click', closeAdModal);
    document.getElementById('save-ad-config-btn')?.addEventListener('click', handleSaveAdConfig);

    const typeSelect = document.getElementById('ad-type-select');
    const imageLinkGroup = document.getElementById('ad-image-link-group');
    typeSelect?.addEventListener('change', () => {
        const type = (typeSelect as HTMLSelectElement).value;
        if (imageLinkGroup) {
            if (type === 'image') imageLinkGroup.classList.remove('hidden');
            else imageLinkGroup.classList.add('hidden');
        }
        updateAdPreview();
    });

    document.getElementById('ad-code-input')?.addEventListener('input', updateAdPreview);
    document.getElementById('ad-link-input')?.addEventListener('input', updateAdPreview);
    document.getElementById('ad-width-input')?.addEventListener('input', updateAdPreview);
    document.getElementById('ad-height-input')?.addEventListener('input', updateAdPreview);
}
