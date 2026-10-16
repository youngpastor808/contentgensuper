/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { env } from '@xenova/transformers';

const __dirnameEsm = path.dirname(fileURLToPath(import.meta.url));

export function isWebSocketClosedError(err: any): boolean {
    if (!err) return false;
    const str = (err instanceof Error ? `${err.name}: ${err.message}\n${err.stack || ''}` : (typeof err === 'object' ? JSON.stringify(err) : String(err))).toLowerCase();
    return str.includes('websocket closed without opened') ||
           str.includes('[vite] failed to connect to websocket') ||
           str.includes('failed to connect to websocket') ||
           str.includes('websocket is closed before the connection is established');
}

/**
 * Returns true if running within the Google AI Studio container or Cloud Run environment.
 */
export function isAIStudioEnvironment(): boolean {
    return Boolean(
        process.env.APPLET_ID ||
        process.env.APPLET_DIR ||
        process.env.CONTROL_PLANE_PORT ||
        process.env.K_SERVICE ||
        process.env.K_REVISION ||
        process.env.GAE_ENV
    );
}

export function initEnvironment(): void {
    // Process crash safety guards for desktop / child-process runtime
    process.on('uncaughtException', (err) => {
        if (isWebSocketClosedError(err)) {
            console.warn('[SERVER WARNING] WebSocket uncaught exception:', err);
            return;
        }
        console.error('[SERVER CRITICAL] Uncaught exception:', err);
    });

    process.on('unhandledRejection', (reason) => {
        if (isWebSocketClosedError(reason)) {
            console.warn('[SERVER WARNING] Unhandled Rejection (WebSocket closed without opened):', reason);
            return;
        }
        console.error('[SERVER CRITICAL] Unhandled rejection:', reason);
    });

    // Normalize Google Cloud / Remotion private keys (convert escaped \n to real newlines)
    ['REMOTION_GCP_PRIVATE_KEY', 'GCP_PRIVATE_KEY', 'GOOGLE_PRIVATE_KEY'].forEach((envKey) => {
        if (process.env[envKey]) {
            process.env[envKey] = process.env[envKey]!
                .replace(/\\n/g, '\n')
                .replace(/^["']|["']$/g, '')
                .trim();
        }
    });

    // Normalize and sanitize AWS and Remotion environment variables (strip accidental 'KEY=' prefixes, wrapping quotes, etc.)
    const remotionVars = [
        'REMOTION_FUNCTION_NAME',
        'REMOTION_AWS_FUNCTION_NAME',
        'REMOTION_SERVE_URL',
        'REMOTION_AWS_SERVE_URL',
        'REMOTION_AWS_REGION',
        'AWS_REGION',
        'REMOTION_AWS_ACCESS_KEY_ID',
        'AWS_ACCESS_KEY_ID',
        'REMOTION_AWS_SECRET_ACCESS_KEY',
        'AWS_SECRET_ACCESS_KEY',
        'REMOTION_AWS_BUCKET_NAME',
        'AWS_BUCKET_NAME',
        'REMOTION_GCP_SERVICE_NAME',
        'REMOTION_GCP_SERVE_URL'
    ];

    remotionVars.forEach((key) => {
        if (process.env[key]) {
            let val = process.env[key]!.trim();
            // Remove wrapping quotes
            val = val.replace(/^["']|["']$/g, '').trim();
            // Remove leading "KEY=" or "export KEY=" if accidentally pasted with the variable name
            const prefixRegex = new RegExp(`^(?:export\\s+)?${key}\\s*=\\s*`, 'i');
            val = val.replace(prefixRegex, '').trim();
            // Again strip any inner wrapping quotes
            val = val.replace(/^["']|["']$/g, '').trim();

            // For function name, extract clean Lambda function identifier pattern
            if (key === 'REMOTION_FUNCTION_NAME' || key === 'REMOTION_AWS_FUNCTION_NAME') {
                const fnMatch = val.match(/remotion-render-[a-zA-Z0-9_-]+/);
                if (fnMatch) {
                    val = fnMatch[0];
                }
            }

            process.env[key] = val;
        }
    });

    if (process.env.REMOTION_FUNCTION_NAME && !process.env.REMOTION_AWS_FUNCTION_NAME) {
        process.env.REMOTION_AWS_FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME;
    }

    // Setup GOOGLE_APPLICATION_CREDENTIALS file from environment variables
    setupGoogleApplicationCredentials();

    // Configure transformers.js
    env.allowLocalModels = false; // Download from HuggingFace
    if (process.env.USER_DATA_PATH) {
        try {
            const cachePath = path.join(process.env.USER_DATA_PATH, 'transformers_cache');
            if (!fs.existsSync(cachePath)) fs.mkdirSync(cachePath, { recursive: true });
            env.cacheDir = cachePath;
        } catch (e) {
            console.warn('[SERVER] Could not set custom transformers cache dir:', e);
        }
    }
}

/**
 * Helper to ensure both file-based and env-based credentials (used by @remotion/cloudrun) are synchronized.
 */
function applyGcpCredentials(clientEmail: string, privateKey: string, projectId?: string, filePath?: string): void {
    const normKey = privateKey.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '').trim();
    const cleanEmail = clientEmail.trim();

    process.env.REMOTION_GCP_CLIENT_EMAIL = cleanEmail;
    process.env.GCP_CLIENT_EMAIL = cleanEmail;
    process.env.REMOTION_GCP_PRIVATE_KEY = normKey;
    process.env.GCP_PRIVATE_KEY = normKey;

    const resolvedProj = projectId || process.env.REMOTION_GCP_PROJECT_ID || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'contentgenapp-507516';
    process.env.REMOTION_GCP_PROJECT_ID = resolvedProj;
    process.env.GCP_PROJECT_ID = resolvedProj;
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = resolvedProj;

    if (filePath && fs.existsSync(filePath)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = filePath;
    } else {
        try {
            const credsPath = path.join(os.tmpdir(), 'gcp-service-account.json');
            const synthCreds = {
                type: 'service_account',
                project_id: resolvedProj,
                private_key: normKey,
                client_email: cleanEmail
            };
            fs.writeFileSync(credsPath, JSON.stringify(synthCreds, null, 2), 'utf8');
            process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
        } catch (e: any) {
            console.warn('[GCP Auth] Could not write temporary credentials file:', e.message);
        }
    }
}

/**
 * Validates and configures Google Application Credentials for Cloud Run & GCP APIs.
 * Handles raw JSON strings, dedicated environment variables, client email/private key pairs, and local key files.
 */
export function setupGoogleApplicationCredentials(): { valid: boolean; error?: string; clientEmail?: string } {
    const rawGac = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    const gcpCredsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ||
                         process.env.GCP_SERVICE_ACCOUNT_KEY?.trim() ||
                         process.env.REMOTION_GCP_CREDENTIALS?.trim() ||
                         process.env.GOOGLE_CREDENTIALS_JSON?.trim();

    // 1. Check if GOOGLE_APPLICATION_CREDENTIALS itself is passed as a raw JSON string
    if (rawGac && (rawGac.startsWith('{') || rawGac.includes('"client_email"') || rawGac.includes('"private_key"'))) {
        try {
            const parsed = JSON.parse(rawGac.replace(/^['"]|['"]$/g, ''));
            if (parsed.client_email && parsed.private_key) {
                applyGcpCredentials(parsed.client_email, parsed.private_key, parsed.project_id);
                console.info(`[GCP Auth] Initialized GCP credentials from JSON in GOOGLE_APPLICATION_CREDENTIALS (Service Account: ${parsed.client_email})`);
                return { valid: true, clientEmail: parsed.client_email };
            } else if (parsed.web || parsed.installed) {
                console.warn('[GCP Auth Warning] GOOGLE_APPLICATION_CREDENTIALS contains an OAuth 2.0 Client ID JSON, not a Google Cloud Service Account.');
                return { valid: false, error: 'The provided JSON is an OAuth Client ID, not a GCP Service Account. It must contain client_email and private_key.' };
            }
        } catch (e: any) {
            console.warn('[GCP Auth Warning] Failed to parse GOOGLE_APPLICATION_CREDENTIALS as JSON:', e.message);
        }
    }

    // 2. Check if a dedicated JSON secret variable is provided
    if (gcpCredsJson && (gcpCredsJson.startsWith('{') || gcpCredsJson.includes('"client_email"'))) {
        try {
            const parsed = JSON.parse(gcpCredsJson.replace(/^['"]|['"]$/g, ''));
            if (parsed.client_email && parsed.private_key) {
                applyGcpCredentials(parsed.client_email, parsed.private_key, parsed.project_id);
                console.info(`[GCP Auth] Initialized GCP credentials from JSON secret variable (Service Account: ${parsed.client_email})`);
                return { valid: true, clientEmail: parsed.client_email };
            } else if (parsed.web || parsed.installed) {
                console.warn('[GCP Auth Warning] GCP_SERVICE_ACCOUNT_KEY contains an OAuth 2.0 Client ID JSON, not a Google Cloud Service Account.');
                return { valid: false, error: 'The provided JSON is an OAuth Client ID, not a GCP Service Account. It must contain client_email and private_key.' };
            }
        } catch (e: any) {
            console.warn('[GCP Auth] Could not parse credentials from JSON variable:', e.message);
        }
    }

    // 3. Check if REMOTION_GCP_CLIENT_EMAIL and REMOTION_GCP_PRIVATE_KEY are provided directly
    const directEmail = process.env.REMOTION_GCP_CLIENT_EMAIL?.trim() || process.env.GCP_CLIENT_EMAIL?.trim();
    const directKey = process.env.REMOTION_GCP_PRIVATE_KEY || process.env.GCP_PRIVATE_KEY;
    if (directEmail && directKey) {
        applyGcpCredentials(directEmail, directKey, process.env.REMOTION_GCP_PROJECT_ID || process.env.GCP_PROJECT_ID);
        console.info(`[GCP Auth] Initialized GCP credentials from client email (${directEmail})`);
        return { valid: true, clientEmail: directEmail };
    }

    // 4. Validate existing GOOGLE_APPLICATION_CREDENTIALS path if it's a file on disk
    if (rawGac && rawGac !== '.' && !rawGac.startsWith('{')) {
        try {
            if (fs.existsSync(rawGac)) {
                const stat = fs.statSync(rawGac);
                if (stat.isFile()) {
                    const content = fs.readFileSync(rawGac, 'utf8');
                    const parsed = JSON.parse(content);
                    if (parsed.client_email && parsed.private_key) {
                        applyGcpCredentials(parsed.client_email, parsed.private_key, parsed.project_id, rawGac);
                        return { valid: true, clientEmail: parsed.client_email };
                    }
                } else if (stat.isDirectory()) {
                    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
                }
            }
        } catch {
            // Ignore file read/parse errors
        }
    } else if (rawGac === '.') {
        delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    // 5. Auto-discover remotion-key.json or key.json in the project root
    const keyCandidates = [
        path.join(process.cwd(), 'remotion-key.json'),
        path.join(process.cwd(), 'key.json'),
        path.resolve(__dirnameEsm, '../../remotion-key.json'),
        path.resolve(__dirnameEsm, '../../key.json'),
        path.resolve(__dirnameEsm, '../remotion-key.json'),
        path.resolve(__dirnameEsm, '../key.json'),
    ];
    for (const cand of keyCandidates) {
        if (fs.existsSync(cand)) {
            try {
                const content = fs.readFileSync(cand, 'utf8');
                const parsed = JSON.parse(content);
                if (parsed.client_email && parsed.private_key) {
                    applyGcpCredentials(parsed.client_email, parsed.private_key, parsed.project_id, cand);
                    console.info(`[GCP Auth] Auto-discovered GCP credentials at ${cand} (Service Account: ${parsed.client_email})`);
                    return { valid: true, clientEmail: parsed.client_email };
                }
            } catch {}
        }
    }

    return { valid: false };
}

// Immediately run credential initialization when env module is imported
try {
    setupGoogleApplicationCredentials();
} catch (err) {
    console.warn('[GCP Auth Warning] Initial module-load credential setup exception:', err);
}
