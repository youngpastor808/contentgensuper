/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AssetStorage with fast O(1) SHA-256 content fingerprinting & deduplication
 * ported from video-studio/src/lib/ids.js.
 */

export interface StoredAsset {
  id: string;
  type: 'image' | 'audio' | 'video';
  blob: Blob;
  hash?: string;
  metadata: {
    timestamp: number;
    size: number;
    mimeType: string;
    projectId?: string;
    hash?: string;
  };
}

/**
 * SHA-256 hex digest of a Blob or ArrayBuffer (ported from video-studio/src/lib/ids.js).
 */
export async function sha256Blob(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Fast content fingerprint for large files (ported from video-studio/src/lib/ids.js):
 * Hashes the byte size plus the first, middle, and last megabyte instead of the whole file.
 */
export async function fingerprintMediaBlob(blob: Blob): Promise<string> {
  const MB = 1 << 20;
  if (blob.size <= 3 * MB) return sha256Blob(blob);
  const mid = Math.floor(blob.size / 2);
  const parts = [
    blob.slice(0, MB),
    blob.slice(mid, mid + MB),
    blob.slice(blob.size - MB),
  ];
  const head = new TextEncoder().encode(`${blob.size}:`);
  const joined = new Blob([head, ...parts]);
  return sha256Blob(joined);
}

class AssetStorage {
  private dbName = 'contentgen_assets';
  private version = 2; // Bumped to v2 to add content hash index for deduplication
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        let store: IDBObjectStore;
        if (!db.objectStoreNames.contains('assets')) {
          store = db.createObjectStore('assets', { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('timestamp', 'metadata.timestamp', { unique: false });
          store.createIndex('projectId', 'metadata.projectId', { unique: false });
        } else {
          store = request.transaction!.objectStore('assets');
        }
        if (!store.indexNames.contains('hash')) {
          store.createIndex('hash', 'hash', { unique: false });
        }
      };
    });
  }

  private async findExistingByHash(
    hash: string,
    type: 'image' | 'audio' | 'video',
    projectId?: string
  ): Promise<StoredAsset | null> {
    if (!this.db || !hash) return null;
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(['assets'], 'readonly');
        const store = transaction.objectStore('assets');
        if (!store.indexNames.contains('hash')) {
          resolve(null);
          return;
        }
        const index = store.index('hash');
        const request = index.getAll(IDBKeyRange.only(hash));
        request.onsuccess = () => {
          const matches = (request.result as StoredAsset[]) || [];
          const hit = matches.find(
            (m) =>
              m.type === type &&
              m.blob?.size > 0 &&
              (!projectId || !m.metadata?.projectId || m.metadata.projectId === projectId)
          );
          resolve(hit || null);
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async storeAsset(
    blob: Blob,
    type: 'image' | 'audio' | 'video',
    projectId?: string,
    forceId?: string
  ): Promise<string> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');

    let contentHash = '';
    try {
      contentHash = await fingerprintMediaBlob(blob);
    } catch {
      // Fallback if WebCrypto is unavailable in non-secure context
    }

    if (!forceId && contentHash) {
      const existing = await this.findExistingByHash(contentHash, type, projectId);
      if (existing) {
        return existing.id;
      }
    }

    const id =
      forceId ||
      (contentHash
        ? `${type}_${contentHash.slice(0, 16)}`
        : `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`);

    const asset: StoredAsset = {
      id,
      type,
      blob,
      hash: contentHash || undefined,
      metadata: {
        timestamp: Date.now(),
        size: blob.size,
        mimeType: blob.type,
        projectId,
        hash: contentHash || undefined,
      },
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.put(asset);
      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
  }

  async getAsset(id: string): Promise<Blob | null> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    try {
      const localBlob = await new Promise<Blob | null>((resolve, reject) => {
        const transaction = this.db!.transaction(['assets'], 'readonly');
        const store = transaction.objectStore('assets');
        const request = store.get(id);
        request.onsuccess = () => {
          const asset = request.result as StoredAsset | undefined;
          resolve(asset?.blob || null);
        };
        request.onerror = () => reject(request.error);
      });
      if (localBlob) return localBlob;
    } catch (e) {
      console.warn('Local asset get failed', e);
    }
    return null;
  }

  async deleteAsset(id: string): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearProjectAssets(projectId: string): Promise<void> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const index = store.index('projectId');
      const request = index.openCursor(IDBKeyRange.only(projectId));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async cleanupOrphanedAssets(): Promise<number> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const index = store.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          const asset = cursor.value as StoredAsset;
          if (!asset.metadata.projectId) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const assetStorage = new AssetStorage();
