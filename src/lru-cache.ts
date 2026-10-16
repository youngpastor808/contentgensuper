/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

interface Node<K, V> {
    key: K;
    value: V;
    prev: Node<K, V> | null;
    next: Node<K, V> | null;
}

export class LRUCache<K, V> {
    private capacity: number;
    private cache = new Map<K, Node<K, V>>();
    private head: Node<K, V> | null = null;
    private tail: Node<K, V> | null = null;
    private onDispose?: (key: K, value: V) => void;

    constructor(capacity: number, onDispose?: (key: K, value: V) => void) {
        if (capacity <= 0) {
            throw new Error("LRUCache capacity must be positive.");
        }
        this.capacity = capacity;
        this.onDispose = onDispose;
    }

    get(key: K): V | undefined {
        const node = this.cache.get(key);
        if (node) {
            this.moveToFront(node);
            return node.value;
        }
        return undefined;
    }

    set(key: K, value: V): void {
        let node = this.cache.get(key);
        if (node) {
            if (this.onDispose && node.value !== value) {
                this.onDispose(key, node.value);
            }
            node.value = value;
            this.moveToFront(node);
        } else {
            if (this.cache.size >= this.capacity) {
                if (this.tail) {
                    if (this.onDispose) {
                        this.onDispose(this.tail.key, this.tail.value);
                    }
                    this.cache.delete(this.tail.key);
                    this.removeNode(this.tail);
                }
            }
            const newNode: Node<K, V> = { key, value, prev: null, next: this.head };
            if (this.head) {
                this.head.prev = newNode;
            }
            this.head = newNode;
            if (!this.tail) {
                this.tail = newNode;
            }
            this.cache.set(key, newNode);
        }
    }

    private removeNode(node: Node<K, V>): void {
        if (node.prev) {
            node.prev.next = node.next;
        } else {
            this.head = node.next;
        }

        if (node.next) {
            node.next.prev = node.prev;
        } else {
            this.tail = node.prev;
        }
    }

    private moveToFront(node: Node<K, V>): void {
        if (node === this.head) return;
        this.removeNode(node);
        
        node.next = this.head;
        node.prev = null;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;

        if (!this.tail) {
            this.tail = node;
        }
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    delete(key: K): boolean {
        const node = this.cache.get(key);
        if (!node) return false;
        if (this.onDispose) {
            this.onDispose(node.key, node.value);
        }
        this.removeNode(node);
        return this.cache.delete(key);
    }

    *values(): IterableIterator<V> {
        let curr = this.head;
        while (curr) {
            yield curr.value;
            curr = curr.next;
        }
    }

    *keys(): IterableIterator<K> {
        let curr = this.head;
        while (curr) {
            yield curr.key;
            curr = curr.next;
        }
    }

    *entries(): IterableIterator<[K, V]> {
        let curr = this.head;
        while (curr) {
            yield [curr.key, curr.value];
            curr = curr.next;
        }
    }

    clear(): void {
        if (this.onDispose) {
            for (const node of this.cache.values()) {
                this.onDispose(node.key, node.value);
            }
        }
        this.cache.clear();
        this.head = null;
        this.tail = null;
    }

    get size(): number {
        return this.cache.size;
    }
}
