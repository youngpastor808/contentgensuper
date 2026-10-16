/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lazy Studio Module Loader:
 * Defers loading and initialization of heavy studio bundles (Image, Voice, Map, Media Assembler, Film, Academy)
 * until the user first clicks any of their respective entry points.
 */

type LazyStudioConfig<TModule extends Record<string, any>> = {
  key: string;
  selector: string;
  load: () => Promise<TModule>;
  init: (module: TModule) => void;
  open: (module: TModule) => void;
};

const configs: LazyStudioConfig<any>[] = [];
const loaded = new Set<string>();
const loading = new Map<string, Promise<any>>();
let listenerInstalled = false;

function installDocumentListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    for (const config of configs) {
      const launcher = target.closest(config.selector) as HTMLElement | null;
      if (!launcher) continue;

      // Once the module is initialized its own direct event handlers take over.
      if (loaded.has(config.key)) return;

      event.preventDefault();

      try {
        const module = await ensureStudioLoaded(config);

        // The module's init() attaches its normal event handlers.
        // We explicitly open the studio for this first click because
        // the click event happened before init() attached its handler.
        config.open(module);
      } catch (error) {
        console.error(`[LazyStudio] Failed to load ${config.key}:`, error);
      }

      return;
    }
  });
}

async function ensureStudioLoaded<TModule extends Record<string, any>>(
  config: LazyStudioConfig<TModule>
): Promise<TModule> {
  if (loaded.has(config.key)) {
    return config.load();
  }

  const existing = loading.get(config.key);
  if (existing) {
    return existing as Promise<TModule>;
  }

  const promise = config.load()
    .then((module) => {
      config.init(module);
      loaded.add(config.key);
      return module;
    })
    .finally(() => {
      loading.delete(config.key);
    });

  loading.set(config.key, promise);
  return promise;
}

export function registerLazyStudio<TModule extends Record<string, any>>(
  config: LazyStudioConfig<TModule>
): void {
  configs.push(config);
  installDocumentListener();
}
