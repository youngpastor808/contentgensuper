/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { DB_NAME, DB_VERSION, HISTORY_STORE, REFERENCE_IMAGE_STORE, APP_STATE_STORE, NARRATION_CACHE_STORE, TRANSCRIPT_CACHE_STORE } from "./constants";

// --- IndexedDB Wrapper ---
export const DB = {
    db: null as IDBDatabase | null,
    
    init(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            if (this.db) {
                return resolve(this.db);
            }
            
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (event) => {
                const error = (event.target as IDBOpenDBRequest).error;
                console.error("❌ IndexedDB Error:", error);
                reject(`Error opening DB: ${error?.message || 'Unknown error'}`);
            };
            
            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                
                // Add global error handler
                this.db.onerror = (event) => {
                    console.error("❌ Database error:", (event.target as any)?.error);
                };
                
                // Handle unexpected close
                this.db.onclose = () => {
                    console.warn("⚠️ Database connection closed unexpectedly");
                    this.db = null; // Reset so it can reconnect
                };
                
                // Handle version change from another tab
                this.db.onversionchange = () => {
                    console.warn("⚠️ Database version changed by another tab");
                    this.db?.close();
                    this.db = null;
                    alert("Database updated by another tab. Please refresh the page.");
                };
                
                resolve(this.db);
            };
            
            request.onblocked = (event) => {
                console.warn("⚠️ Database upgrade blocked. Close other tabs.");
                reject("Database upgrade blocked. Please close other tabs using this app.");
            };
            
            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                const transaction = (event.target as IDBOpenDBRequest).transaction!;
                
                // Handle upgrade errors
                transaction.onerror = (err) => {
                    console.error("❌ Upgrade transaction error:", err);
                };
                
                transaction.onabort = (err) => {
                    console.error("❌ Upgrade transaction aborted:", err);
                };
                
                try {
                    if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                        const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
                        // Add indexes for faster queries
                        historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains(REFERENCE_IMAGE_STORE)) {
                        const refStore = db.createObjectStore(REFERENCE_IMAGE_STORE, { keyPath: 'id' });
                        refStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains(APP_STATE_STORE)) {
                        db.createObjectStore(APP_STATE_STORE); // Simple key-value store
                    }

                    if (!db.objectStoreNames.contains(NARRATION_CACHE_STORE)) {
                        db.createObjectStore(NARRATION_CACHE_STORE, { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains(TRANSCRIPT_CACHE_STORE)) {
                        db.createObjectStore(TRANSCRIPT_CACHE_STORE, { keyPath: 'id' });
                    }
                } catch (error) {
                    console.error("❌ Error creating object stores:", error);
                    throw error;
                }
            };
        });
    },
    
    async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
        if (!this.db) {
            await this.init();
        }
        
        try {
            const transaction = this.db!.transaction(storeName, mode);
            
            transaction.onerror = (event) => {
                console.error(`❌ Transaction error on ${storeName}:`, (event.target as any)?.error);
            };
            
            transaction.onabort = (event) => {
                console.error(`❌ Transaction aborted on ${storeName}:`, (event.target as any)?.error);
            };
            
            return transaction.objectStore(storeName);
        } catch (error) {
            const errorName = (error as Error)?.name;
            
            if (errorName === 'InvalidStateError' || errorName === 'TransactionInactiveError') {
                console.warn(`⚠️ Database connection issue detected, reconnecting...`);
                this.db = null;
                await this.init();
                
                // Retry once
                const transaction = this.db!.transaction(storeName, mode);
                return transaction.objectStore(storeName);
            }
            
            throw error;
        }
    },
    
    async put(storeName: string, value: any, key?: IDBValidKey): Promise<IDBValidKey> {
        const store = await this.getStore(storeName, 'readwrite');
        const transaction = store.transaction;
        return new Promise((resolve, reject) => {
            let resultKey: IDBValidKey;
            const request = key !== undefined ? store.put(value, key) : store.put(value);
            
            request.onsuccess = () => {
                resultKey = request.result;
            };
            
            request.onerror = (event) => {
                const error = (event.target as IDBRequest)?.error || new Error(`IndexedDB put failed in ${storeName}`);
                console.error(`❌ Put error in ${storeName}:`, error);
                reject(error);
            };

            transaction.oncomplete = () => {
                resolve(resultKey);
            };

            transaction.onerror = (event) => {
                const error = (event.target as IDBTransaction)?.error || transaction.error || new Error(`IndexedDB transaction error in ${storeName}`);
                console.error(`❌ Transaction error in ${storeName}:`, error);
                reject(error);
            };

            transaction.onabort = (event) => {
                const error = (event.target as IDBTransaction)?.error || transaction.error || new DOMException(`IndexedDB transaction aborted in ${storeName}`, 'AbortError');
                console.error(`❌ Transaction aborted in ${storeName}:`, error);
                reject(error);
            };
        });
    },
    
    async get(storeName: string, key: IDBValidKey): Promise<any> {
        const store = await this.getStore(storeName);
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result !== undefined ? request.result : null);
            request.onerror = () => {
                console.error(`❌ Local get error in ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    },
    
    async getAll(storeName: string): Promise<any[]> {
        const store = await this.getStore(storeName);
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => {
                console.error(`❌ Local getAll error in ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    },
    
    async delete(storeName: string, key: IDBValidKey): Promise<void> {
        const store = await this.getStore(storeName, 'readwrite');
        const transaction = store.transaction;
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onerror = () => {
                console.error(`❌ Delete error in ${storeName}:`, request.error);
                reject(request.error);
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new DOMException('Transaction aborted', 'AbortError'));
        });
    },
    
    async clear(storeName: string): Promise<void> {
        const store = await this.getStore(storeName, 'readwrite');
        const transaction = store.transaction;
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onerror = () => {
                console.error(`❌ Clear error in ${storeName}:`, request.error);
                reject(request.error);
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new DOMException('Transaction aborted', 'AbortError'));
        });
    },
    
    async bulkPut(storeName: string, items: any[]): Promise<IDBValidKey[]> {
        const store = await this.getStore(storeName, 'readwrite');
        const transaction = store.transaction;
        const results: IDBValidKey[] = [];
        
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve(results);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new DOMException('Transaction aborted', 'AbortError'));

            items.forEach(item => {
                const request = store.put(item);
                request.onsuccess = () => results.push(request.result);
            });
        });
    },

    async bulkGet(storeName: string, keys: IDBValidKey[]): Promise<any[]> {
        if (keys.length === 0) return [];
        const store = await this.getStore(storeName);
        const transaction = store.transaction;
        const resultsMap = new Map<IDBValidKey, any>();
        
        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => {
                // Return results in the same order as keys
                const orderedResults = keys.map(key => resultsMap.get(key));
                resolve(orderedResults);
            };
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new DOMException('Transaction aborted', 'AbortError'));

            keys.forEach(key => {
                const request = store.get(key);
                request.onsuccess = () => {
                    if (request.result !== undefined) {
                        resultsMap.set(key, request.result);
                    }
                };
            });
        });
    },

    async bulkDelete(storeName: string, keys: IDBValidKey[]): Promise<void> {
        if (keys.length === 0) return;
        const store = await this.getStore(storeName, 'readwrite');
        const transaction = store.transaction;

        return new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(new DOMException('Transaction aborted', 'AbortError'));

            keys.forEach(key => store.delete(key));
        });
    },
    
    async getAllByIndex(
        storeName: string, 
        indexName: string, 
        query?: IDBValidKey | IDBKeyRange,
        limit?: number,
        direction: IDBCursorDirection = 'next'
    ): Promise<any[]> {
        const store = await this.getStore(storeName);
        const index = store.index(indexName);
        
        return new Promise((resolve, reject) => {
            const results: any[] = [];
            const request = index.openCursor(query, direction);
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                
                if (cursor) {
                    results.push(cursor.value);
                    
                    if (limit && results.length >= limit) {
                        resolve(results);
                    } else {
                        cursor.continue();
                    }
                } else {
                    resolve(results);
                }
            };
            
            request.onerror = () => {
                console.error(`❌ Index query error in ${storeName}.${indexName}:`, request.error);
                reject(request.error);
            };
        });
    },

    async count(storeName: string, query?: IDBValidKey | IDBKeyRange): Promise<number> {
        const store = await this.getStore(storeName);
        
        return new Promise((resolve, reject) => {
            const request = query ? store.count(query) : store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                console.error(`❌ Count error in ${storeName}:`, request.error);
                reject(request.error);
            };
        });
    },
    
    async healthCheck(): Promise<boolean> {
        return !!this.db;
    },

    async getStorageEstimate(): Promise<{ usage: number; quota: number; percentUsed: number }> {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            const estimate = await navigator.storage.estimate();
            const usage = estimate.usage || 0;
            const quota = estimate.quota || 0;
            
            return {
                usage,
                quota,
                percentUsed: quota > 0 ? (usage / quota) * 100 : 0
            };
        }
        
        return { usage: 0, quota: 0, percentUsed: 0 };
    },

    async checkStorageAvailable(requiredBytes: number = 0): Promise<boolean> {
        try {
            const { usage, quota } = await this.getStorageEstimate();
            if (quota === 0) return true; // Can't estimate, assume available
            const available = quota - usage;
            
            if (available < requiredBytes) {
                console.warn(`⚠️ Low storage: ${(available / 1024 / 1024).toFixed(2)}MB available`);
                return false;
            }
            return true;
        } catch(e) {
            return true; // If estimation fails, proceed optimistically
        }
    }
};
