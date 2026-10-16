import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadBangers } from '@remotion/google-fonts/Bangers';
import { loadFont as loadBebasNeue } from '@remotion/google-fonts/BebasNeue';
import { loadFont as loadCinzel } from '@remotion/google-fonts/Cinzel';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadNotoSans } from '@remotion/google-fonts/NotoSans';
import { loadFont as loadNotoSansArabic } from '@remotion/google-fonts/NotoSansArabic';
import { loadFont as loadNotoSansJP } from '@remotion/google-fonts/NotoSansJP';
import { loadFont as loadOswald } from '@remotion/google-fonts/Oswald';
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPlusJakartaSans } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadSyne } from '@remotion/google-fonts/Syne';
import { loadFont as loadCousine } from '@remotion/google-fonts/Cousine';
import { loadFont as loadArimo } from '@remotion/google-fonts/Arimo';
import { loadFont as loadGelasio } from '@remotion/google-fonts/Gelasio';
import { loadFont as loadFiraSans } from '@remotion/google-fonts/FiraSans';

const FONT_LOADERS: Record<string, () => { waitUntilDone: () => Promise<any> }> = {
  'anton': () => loadAnton('normal', { weights: ['400'], subsets: ['latin'] }),
  'bangers': () => loadBangers('normal', { weights: ['400'], subsets: ['latin'] }),
  'bebas neue': () => loadBebasNeue('normal', { weights: ['400'], subsets: ['latin'] }),
  'bebasneue': () => loadBebasNeue('normal', { weights: ['400'], subsets: ['latin'] }),
  'cinzel': () => loadCinzel('normal', { weights: ['700', '900'], subsets: ['latin'] }),
  'cousine': () => loadCousine('normal', { weights: ['400', '700'], subsets: ['latin'] }),
  'arimo': () => loadArimo('normal', { weights: ['400', '700'], subsets: ['latin'] }),
  'gelasio': () => loadGelasio('normal', { weights: ['400', '700'], subsets: ['latin'] }),
  'fira sans': () => loadFiraSans('normal', { weights: ['400', '700', '800'], subsets: ['latin'] }),
  'firasans': () => loadFiraSans('normal', { weights: ['400', '700', '800'], subsets: ['latin'] }),
  'inter': () => loadInter('normal', { weights: ['400', '600', '700', '800'], subsets: ['latin'] }),
  'jetbrains mono': () => loadJetBrainsMono('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }),
  'jetbrainsmono': () => loadJetBrainsMono('normal', { weights: ['500', '600', '700'], subsets: ['latin'] }),
  'montserrat': () => loadMontserrat('normal', { weights: ['400', '500', '600', '700', '800', '900'], subsets: ['latin'] }),
  'noto sans': () => loadNotoSans('normal', { weights: ['700', '800'], subsets: ['latin'] }),
  'notosans': () => loadNotoSans('normal', { weights: ['700', '800'], subsets: ['latin'] }),
  'noto sans arabic': () => loadNotoSansArabic('normal', { weights: ['700', '800'] }),
  'notosansarabic': () => loadNotoSansArabic('normal', { weights: ['700', '800'] }),
  'noto sans jp': () => loadNotoSansJP('normal', { weights: ['700', '800'] }),
  'notosansjp': () => loadNotoSansJP('normal', { weights: ['700', '800'] }),
  'oswald': () => loadOswald('normal', { weights: ['700'], subsets: ['latin'] }),
  'playfair display': () => loadPlayfairDisplay('normal', { weights: ['400', '700', '900'], subsets: ['latin'] }),
  'playfairdisplay': () => loadPlayfairDisplay('normal', { weights: ['400', '700', '900'], subsets: ['latin'] }),
  'plus jakarta sans': () => loadPlusJakartaSans('normal', { weights: ['700', '800'], subsets: ['latin'] }),
  'plusjakartasans': () => loadPlusJakartaSans('normal', { weights: ['700', '800'], subsets: ['latin'] }),
  'syne': () => loadSyne('normal', { weights: ['700', '800'], subsets: ['latin'] }),
};

const SYSTEM_FONT_ALIASES: Record<string, { targetFont: string; url: string; weights: string[] }> = {
  'courier new': {
    targetFont: 'cousine',
    url: 'https://fonts.gstatic.com/s/cousine/v31/d6lIkaiiRdih4SpP_SQvzA.woff2',
    weights: ['400', '700', '800'],
  },
  'arial': {
    targetFont: 'arimo',
    url: 'https://fonts.gstatic.com/s/arimo/v36/P5sMzZCDf9_T_10ZxCE.woff2',
    weights: ['400', '600', '700', '800'],
  },
  'helvetica': {
    targetFont: 'arimo',
    url: 'https://fonts.gstatic.com/s/arimo/v36/P5sMzZCDf9_T_10ZxCE.woff2',
    weights: ['400', '600', '700', '800'],
  },
  'helvetica neue': {
    targetFont: 'arimo',
    url: 'https://fonts.gstatic.com/s/arimo/v36/P5sMzZCDf9_T_10ZxCE.woff2',
    weights: ['400', '600', '700', '800'],
  },
  'georgia': {
    targetFont: 'gelasio',
    url: 'https://fonts.gstatic.com/s/gelasio/v14/cIf9MaFfvUQxTTqS9C6hYQ.woff2',
    weights: ['400', '600', '700', '800'],
  },
  'impact': {
    targetFont: 'anton',
    url: 'https://fonts.gstatic.com/s/anton/v27/1Ptgg87LROyAm3Kz-C8.woff2',
    weights: ['400', '700', '800', '900'],
  },
  'trebuchet ms': {
    targetFont: 'fira sans',
    url: 'https://fonts.gstatic.com/s/firasans/v18/va9E4kDNxMZdWfMOD5Vvl4jL.woff2',
    weights: ['400', '600', '700', '800'],
  },
};

const loadedFontPromises = new Map<string, Promise<any>>();

async function registerFontAlias(aliasName: string, config: { targetFont: string; url: string; weights: string[] }): Promise<void> {
  const targetLoader = FONT_LOADERS[config.targetFont];
  if (targetLoader) {
    try {
      await targetLoader().waitUntilDone();
    } catch {}
  }
  if (typeof window !== 'undefined' && typeof FontFace !== 'undefined' && document.fonts) {
    const promises = config.weights.map(async (w) => {
      try {
        const ff = new FontFace(aliasName, `url(${config.url})`, { weight: w });
        await ff.load();
        document.fonts.add(ff);
      } catch {}
    });
    await Promise.all(promises);
  }
}

export function loadFontByName(fontName?: string): Promise<any> {
  if (!fontName) return Promise.resolve();
  const clean = fontName.toLowerCase().replace(/['",]/g, '').trim().split(/\s*,\s*/)[0];

  if (!loadedFontPromises.has(clean)) {
    const loader = FONT_LOADERS[clean];
    if (loader) {
      try {
        const font = loader();
        loadedFontPromises.set(clean, font.waitUntilDone());
      } catch {
        loadedFontPromises.set(clean, Promise.resolve());
      }
    } else if (SYSTEM_FONT_ALIASES[clean]) {
      loadedFontPromises.set(clean, registerFontAlias(fontName, SYSTEM_FONT_ALIASES[clean]));
    } else {
      loadedFontPromises.set(clean, Promise.resolve());
    }
  }

  return loadedFontPromises.get(clean)!;
}

import { fontsForGraphics } from './graphicsCanvas';

/**
 * Loads only the fonts required by the active composition payload.
 */
export async function loadRequiredFonts(payload?: any): Promise<void> {
  const fontsToLoad = new Set<string>();
  fontsToLoad.add('montserrat'); // Default fallback font

  if (payload?.subtitleStyle?.fontFamily) {
    fontsToLoad.add(payload.subtitleStyle.fontFamily);
  }
  if (Array.isArray(payload?.uiTextOverlays)) {
    for (const ov of payload.uiTextOverlays) {
      if (ov.fontFamily) fontsToLoad.add(ov.fontFamily);
    }
  }
  if (Array.isArray(payload?.scenes)) {
    for (const s of payload.scenes) {
      if (s.fontFamily) fontsToLoad.add(s.fontFamily);
    }
  }
  if (Array.isArray(payload?.graphics)) {
    for (const f of fontsForGraphics(payload.graphics)) {
      fontsToLoad.add(f);
    }
  }

  const promises = Array.from(fontsToLoad).map(f => loadFontByName(f));
  await Promise.all(promises);

  if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
    try {
      await document.fonts.ready;
    } catch {}
  }
}

/**
 * Backward-compatible font loading trigger.
 */
export const waitUntilAllFontsLoaded = async (payload?: any) => {
  if (payload) {
    return loadRequiredFonts(payload);
  }
  // Load core default fonts if called without payload
  return Promise.all([loadFontByName('montserrat'), loadFontByName('inter')]);
};

