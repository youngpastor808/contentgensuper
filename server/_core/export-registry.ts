/**
 * Short-lived, in-memory capability tokens for files the app has explicitly
 * generated or selected. Tokens avoid exposing arbitrary filesystem paths in
 * download/remux endpoints.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type ExportFileTokenKind = 'download' | 'metadata-clean';

interface Entry {
    filePath: string;
    kind: ExportFileTokenKind;
    expiresAt: number;
}

const entries = new Map<string, Entry>();
const DEFAULT_DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_METADATA_TTL_MS = 10 * 60 * 1000;

function cleanupExpired(now = Date.now()): void {
    for (const [token, entry] of entries) {
        if (entry.expiresAt <= now) entries.delete(token);
    }
}

// Background cleanup timer every 2 minutes without blocking request event loop
if (typeof setInterval !== 'undefined') {
    const timer = setInterval(() => {
        cleanupExpired();
    }, 2 * 60 * 1000);
    if (timer && typeof (timer as any).unref === 'function') {
        (timer as any).unref();
    }
}

function makeToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

export function issueFileToken(
    filePath: string,
    kind: ExportFileTokenKind,
    ttlMs = kind === 'download' ? DEFAULT_DOWNLOAD_TTL_MS : DEFAULT_METADATA_TTL_MS,
): string {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
        throw new Error('Token target is not a regular file');
    }

    let token = makeToken();
    while (entries.has(token)) token = makeToken();

    entries.set(token, {
        filePath: resolved,
        kind,
        expiresAt: Date.now() + ttlMs,
    });

    return token;
}

export function resolveFileToken(
    token: string,
    kind: ExportFileTokenKind,
): string | null {
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;

    const entry = entries.get(token);
    if (!entry) return null;

    // Fast lazy cleanup if expired
    if (entry.expiresAt <= Date.now()) {
        entries.delete(token);
        return null;
    }
    if (entry.kind !== kind) {
        return null;
    }

    try {
        const stat = fs.statSync(entry.filePath);
        if (!stat.isFile()) {
            entries.delete(token);
            return null;
        }
    } catch {
        entries.delete(token);
        return null;
    }

    return entry.filePath;
}

export function consumeFileToken(
    token: string,
    kind: ExportFileTokenKind,
): string | null {
    const resolved = resolveFileToken(token, kind);
    if (resolved) entries.delete(token);
    return resolved;
}

export function revokeFileToken(token?: string | null): void {
    if (token) entries.delete(token);
}