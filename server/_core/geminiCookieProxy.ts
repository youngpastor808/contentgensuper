/**
 * Gemini Web Cookie Proxy — shared utility
 * Proxies text generation through gemini.google.com using session cookies
 * instead of an API key.
 */

export interface GeminiWebCredentials {
  atValue: string;
  blValue: string;
  fSid: string;
  authUser: string;
}

interface CookieAuthInput {
  psid: string;
  psidts?: string;
}

export interface FunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface ToolBridgeCall {
  name: string;
  args: Record<string, any>;
}

interface InputAttachment {
  name?: string;
  mimeType: string;
  data: string; // base64 string or data URL
}

/**
 * Normalizes file extensions from MIME types.
 */
export function extensionForMimeType(mimeType: string): string {
  const clean = (mimeType || "").toLowerCase().trim();
  switch (clean) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "audio/mp3":
    case "audio/mpeg":
      return ".mp3";
    case "audio/wav":
      return ".wav";
    case "application/pdf":
      return ".pdf";
    default:
      return ".bin";
  }
}

/**
 * Decodes base64 data strings or data URLs safely into a Buffer.
 */
export function decodeBase64Data(raw: string): { buffer: Buffer; mimeType: string } {
  if (!raw) return { buffer: Buffer.alloc(0), mimeType: "application/octet-stream" };
  
  let mimeType = "image/jpeg";
  let base64String = raw;

  if (raw.startsWith("data:")) {
    const commaIdx = raw.indexOf(",");
    if (commaIdx !== -1) {
      const header = raw.slice(5, commaIdx);
      const parts = header.split(";");
      mimeType = parts[0] || mimeType;
      base64String = raw.slice(commaIdx + 1);
    }
  }

  const buffer = Buffer.from(base64String, "base64");
  return { buffer, mimeType };
}

/**
 * Builds a structured tool bridge prompt instructing Gemini Web to format tool calls into JSON.
 */
export function buildToolBridgePrompt(tools: { functionDeclarations?: FunctionDeclaration[] }[], basePrompt: string): string {
  let b = "You are an AI assistant capable of function calling.\n";
  b += "You MUST respond with valid JSON only. Do not output markdown fences unless required.\n";
  b += "Output format:\n";
  b += '{"status":"call","tool_calls":[{"name":"<tool_name>","arguments":{}}]} OR {"status":"text","content":"<assistant_text>"}\n\n';
  b += "Rules:\n";
  b += "- Use only tool names declared below.\n";
  b += "- arguments must be a valid JSON object matching the parameters schema.\n\n";
  b += "Available tools:\n";

  for (const tool of tools) {
    if (!tool.functionDeclarations) continue;
    for (const fn of tool.functionDeclarations) {
      b += `- name: ${fn.name}`;
      if (fn.description) b += ` | description: ${fn.description}`;
      if (fn.parameters) b += ` | parameters: ${JSON.stringify(fn.parameters)}`;
      b += "\n";
    }
  }

  b += `\nRequest:\n${basePrompt}`;
  return b;
}

/**
 * Parses tool calls or text content from a tool-bridged output string.
 */
export function parseToolBridgeOutput(text: string): { toolCalls: ToolBridgeCall[] | null; content: string } {
  const cleaned = stripCodeFence(text);
  if (!cleaned) return { toolCalls: null, content: text };

  try {
    const payload = JSON.parse(cleaned);
    if (payload.status === "call" && Array.isArray(payload.tool_calls) && payload.tool_calls.length > 0) {
      const calls: ToolBridgeCall[] = payload.tool_calls.map((tc: any) => ({
        name: tc.name || "",
        args: tc.arguments || tc.args || {}
      }));
      return { toolCalls: calls, content: "" };
    }
    if (payload.status === "text" && typeof payload.content === "string") {
      return { toolCalls: null, content: payload.content };
    }
  } catch {
    // If not strict JSON, return original text
  }

  return { toolCalls: null, content: text };
}

// Model registry (as of 2026-03 with environment variable overrides)
export const GEMINI_WEB_MODELS: Record<string, string> = {
  "gemini-3-flash":         process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH || "9ec249fc9ad08861",
  "gemini-3-flash-thinking":process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH_THINKING || "4af6c7f5da75d65d",
  "gemini-3-pro":           process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_PRO || "9d8ca3786ebdfbea",
};

export function getGeminiWebModelId(model: string = "gemini-3-flash"): string {
  if (model === "gemini-3-flash" && process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH) {
    return process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH;
  }
  if (model === "gemini-3-flash-thinking" && process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH_THINKING) {
    return process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_FLASH_THINKING;
  }
  if (model === "gemini-3-pro" && process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_PRO) {
    return process.env.GEMINI_WEB_MODEL_ID_GEMINI_3_PRO;
  }
  return GEMINI_WEB_MODELS[model] || GEMINI_WEB_MODELS["gemini-3-flash"];
}

/**
 * Strips markdown code fences from a string.
 * Note: Keep synchronized with client copy in src/api/core.ts
 */
export function stripCodeFence(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const open = lines.findIndex(l => /^\s*```[a-zA-Z]*\s*$/.test(l));
  if (open === -1) return text.trim();

  let close = -1;
  for (let i = lines.length - 1; i > open; i--) {
    if (/^\s*```\s*$/.test(lines[i])) { close = i; break; }
  }
  return lines.slice(open + 1, close === -1 ? undefined : close).join("\n").trim();
}

/**
 * Extracts Gemini thinking process (<ctrl94>thought ... <ctrl95>) and final output text.
 */
export function extractThinkingAndText(raw: string): { thinking: string; text: string } {
  if (!raw) return { thinking: "", text: "" };

  const startMarkers = ["<ctrl94>thought", "<ctrl94>"];
  let startIdx = -1;
  let startLen = 0;

  for (const marker of startMarkers) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) {
      startIdx = idx;
      startLen = marker.length;
      break;
    }
  }

  if (startIdx === -1) {
    return { thinking: "", text: raw };
  }

  const endMarker = "<ctrl95>";
  const rest = raw.slice(startIdx + startLen);
  const endOffset = rest.indexOf(endMarker);

  if (endOffset === -1) {
    const thinking = rest.trim();
    const textBefore = raw.slice(0, startIdx).trim();
    return { thinking, text: textBefore };
  }

  const endIdx = startIdx + startLen + endOffset;
  const thinking = raw.slice(startIdx + startLen, endIdx).trim();
  const textBefore = raw.slice(0, startIdx);
  const textAfter = raw.slice(endIdx + endMarker.length);
  const cleanText = (textBefore + textAfter).trim();

  return { thinking, text: cleanText };
}

export function buildCookieHeader(
  psid: string,
  psidts?: string,
  psidcc?: string,
  compass?: string,
  sid?: string,
  hsid?: string,
  ssid?: string
): string {
  let cookie = `__Secure-1PSID=${psid}`;
  if (psidts) cookie += `; __Secure-1PSIDTS=${psidts}`;
  if (psidcc) cookie += `; __Secure-1PSIDCC=${psidcc}`;
  if (compass) cookie += `; COMPASS=${compass}`;
  if (sid) cookie += `; SID=${sid}`;
  if (hsid) cookie += `; HSID=${hsid}`;
  if (ssid) cookie += `; SSID=${ssid}`;
  return cookie;
}

export function buildCookieHeaderFromObject(cookies: Record<string, string>): string {
  if (!cookies || typeof cookies !== 'object') return '';
  return Object.entries(cookies)
    .filter(([_, v]) => v && typeof v === 'string')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── Rolling Cookie Jar (Captures PSIDTS and session rotation) ────────────────
const cookieJar = new Map<string, Map<string, string>>();

function getJarFilePath(): string {
  const dir = process.env.APPDATA || process.env.TEMP || os.tmpdir();
  return path.join(dir, 'gemini_session_jar.json');
}

function loadCookieJarFromDisk() {
  try {
    const file = getJarFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const [primaryKey, entries] of Object.entries(data)) {
        if (entries && typeof entries === 'object') {
          const map = new Map<string, string>();
          for (const [k, v] of Object.entries(entries as any)) {
            if (typeof v === 'string') map.set(k, v);
          }
          cookieJar.set(primaryKey, map);
        }
      }
    }
  } catch (e) {
    console.warn('[GeminiCookieProxy] Failed to load cookie jar from disk:', e);
  }
}

function saveCookieJarToDisk() {
  try {
    const file = getJarFilePath();
    const data: Record<string, Record<string, string>> = {};
    for (const [k, map] of cookieJar.entries()) {
      data[k] = Object.fromEntries(map.entries());
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[GeminiCookieProxy] Failed to save cookie jar to disk:', e);
  }
}

// Preload any saved session jar on server startup
loadCookieJarFromDisk();

export function parseCookiesFromHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (k) result[k] = v;
    }
  }
  return result;
}

export function getPrimaryCookieKey(cookieHeaderOrObj: string | Record<string, string>): string {
  if (typeof cookieHeaderOrObj === 'object') {
    return cookieHeaderOrObj['__Secure-1PSID'] || cookieHeaderOrObj['SID'] || JSON.stringify(cookieHeaderOrObj);
  }
  const cookies = parseCookiesFromHeader(cookieHeaderOrObj);
  return cookies['__Secure-1PSID'] || cookies['SID'] || cookieHeaderOrObj;
}

export function captureSetCookie(response: Response | { headers?: any }, baseHeader?: string) {
  if (!response) return;
  const primaryKey = baseHeader ? getPrimaryCookieKey(baseHeader) : '';
  if (!primaryKey) return;

  let setCookieHeaders: string[] = [];
  if (typeof (response as any).headers?.getSetCookie === 'function') {
    setCookieHeaders = (response as any).headers.getSetCookie() || [];
  } else if (typeof (response as any).headers?.raw === 'function') {
    const raw = (response as any).headers.raw();
    if (Array.isArray(raw?.['set-cookie'])) setCookieHeaders = raw['set-cookie'];
  } else if (response.headers && typeof (response as any).headers.get === 'function') {
    const sc = (response as any).headers.get('set-cookie');
    if (sc) setCookieHeaders = sc.split(/,(?=\s*[^=;\s]+=)/);
  }

  if (setCookieHeaders.length === 0) return;

  let jar = cookieJar.get(primaryKey);
  if (!jar) {
    jar = new Map();
    if (baseHeader) {
      const parsed = typeof baseHeader === 'string' ? parseCookiesFromHeader(baseHeader) : baseHeader;
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'string') jar.set(k, v);
      }
    }
    cookieJar.set(primaryKey, jar);
  }

  let modified = false;
  for (const headerLine of setCookieHeaders) {
    const cookiePart = headerLine.split(';')[0];
    const eq = cookiePart.indexOf('=');
    if (eq !== -1) {
      const name = cookiePart.slice(0, eq).trim();
      const val = cookiePart.slice(eq + 1).trim();
      if (name) {
        const attrs = headerLine.slice(cookiePart.length).toLowerCase();
        const expired = val === '' || val === 'deleted'
            || /expires=thu, 01 jan 1970/.test(attrs) || /max-age=0\b/.test(attrs);
        if (expired) {
          jar.delete(name);
          modified = true;
        } else {
          jar.set(name, val);
          modified = true;
        }
      }
    }
  }

  if (modified) {
    saveCookieJarToDisk();
  }
}

export function getFreshCookieHeader(cookieHeaderOrObj: string | Record<string, string>): string {
  const originalHeader = typeof cookieHeaderOrObj === 'string' ? cookieHeaderOrObj : buildCookieHeaderFromObject(cookieHeaderOrObj);
  const primaryKey = getPrimaryCookieKey(cookieHeaderOrObj);
  const jar = cookieJar.get(primaryKey);
  if (!jar || jar.size === 0) return originalHeader;

  const parsed = parseCookiesFromHeader(originalHeader);
  for (const [k, v] of jar.entries()) {
    parsed[k] = v;
  }
  return Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function getFreshCookieObject(cookieHeaderOrObj: string | Record<string, string>): Record<string, string> {
  const originalHeader = typeof cookieHeaderOrObj === 'string' ? cookieHeaderOrObj : buildCookieHeaderFromObject(cookieHeaderOrObj);
  const parsed = parseCookiesFromHeader(originalHeader);
  const primaryKey = getPrimaryCookieKey(cookieHeaderOrObj);
  const jar = cookieJar.get(primaryKey);
  if (jar && jar.size > 0) {
    for (const [k, v] of jar.entries()) {
      if (v) parsed[k] = v;
    }
  }
  return parsed;
}

function extractWizValue(key: string, html: string): string | null {
  const regex = new RegExp(`"${key}":"([^"]+)"`);
  return regex.exec(html)?.[1] || null;
}

function randomHex16(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const credentialsCache = new Map<string, { creds: GeminiWebCredentials; expiresAt: number }>();
// Keep cached credentials active for 2 hours (or until session changes)
const CREDENTIALS_TTL_MS = 2 * 60 * 60 * 1000;

export function invalidateGeminiWebCredentialsCache(cookieHeader?: string) {
  if (cookieHeader) {
    credentialsCache.delete(cookieHeader);
    const fresh = getFreshCookieHeader(cookieHeader);
    credentialsCache.delete(fresh);
    // Note: Do NOT delete cookieJar here! The rolling cookie jar captures
    // valid rotated session tokens from Google. Wiping it invalidates the user's active session!
  } else {
    credentialsCache.clear();
  }
}

export function clearCookieJar(cookieHeader?: string) {
  if (cookieHeader) {
    const primaryKey = getPrimaryCookieKey(cookieHeader);
    cookieJar.delete(primaryKey);
  } else {
    cookieJar.clear();
  }
  saveCookieJarToDisk();
}

export async function fetchGeminiWebCredentials(
  cookieHeader: string,
  bypassCache: boolean = false
): Promise<GeminiWebCredentials> {
  const freshCookie = getFreshCookieHeader(cookieHeader);
  if (!bypassCache) {
    const cached = credentialsCache.get(freshCookie) || credentialsCache.get(cookieHeader);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.creds;
    }
  } else {
    credentialsCache.delete(freshCookie);
    credentialsCache.delete(cookieHeader);
  }

  const resp = await fetch("https://gemini.google.com/app", {
    method: "GET",
    headers: {
      Cookie: freshCookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow"
  });

  captureSetCookie(resp, cookieHeader);

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      credentialsCache.delete(cookieHeader);
      credentialsCache.delete(freshCookie);
      throw new Error("NOT_LOGGED_IN");
    }
    throw new Error(`Failed to reach gemini.google.com: HTTP ${resp.status}`);
  }

  const finalUrl = resp.url || "";
  if (finalUrl.includes("accounts.google.com") || finalUrl.includes("ServiceLogin")) {
    credentialsCache.delete(cookieHeader);
    credentialsCache.delete(freshCookie);
    throw new Error("NOT_LOGGED_IN");
  }

  let html = await resp.text();
  if (!html.includes("WIZ_global_data") &&
    (html.includes("accounts.google.com") || html.includes('"SignIn"') || html.includes("ServiceLogin"))) {
    credentialsCache.delete(cookieHeader);
    credentialsCache.delete(freshCookie);
    throw new Error("NOT_LOGGED_IN");
  }

  let atValue = extractWizValue("SNlM0e", html);

  // If SNlM0e extraction failed, the __Secure-1PSIDTS may have expired on Google's end.
  // Perform an automatic fallback probe without the stale timestamp token so Google can
  // accept the root __Secure-1PSID and issue a fresh __Secure-1PSIDTS in Set-Cookie.
  if (!atValue) {
    const parsed = parseCookiesFromHeader(freshCookie);
    if (parsed['__Secure-1PSIDTS']) {
      delete parsed['__Secure-1PSIDTS'];
      const fallbackHeader = Object.entries(parsed).map(([k, v]) => `${k}=${v}`).join('; ');
      try {
        const fallbackResp = await fetch("https://gemini.google.com/app", {
          method: "GET",
          headers: {
            Cookie: fallbackHeader,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow"
        });
        captureSetCookie(fallbackResp, cookieHeader);
        const fallbackHtml = await fallbackResp.text();
        const fallbackAt = extractWizValue("SNlM0e", fallbackHtml);
        if (fallbackAt) {
          html = fallbackHtml;
          atValue = fallbackAt;
        }
      } catch {}
    }
  }

  if (!atValue) {
    credentialsCache.delete(cookieHeader);
    credentialsCache.delete(freshCookie);
    throw new Error("NOT_LOGGED_IN");
  }

  const creds: GeminiWebCredentials = {
    atValue,
    blValue: extractWizValue("cfb2h", html) || "",
    fSid:    extractWizValue("FdrFJe", html) || "",
    authUser: "0",
  };

  const updatedFreshCookie = getFreshCookieHeader(cookieHeader);
  credentialsCache.set(updatedFreshCookie, {
    creds,
    expiresAt: Date.now() + CREDENTIALS_TTL_MS,
  });
  if (updatedFreshCookie !== cookieHeader) {
    credentialsCache.set(cookieHeader, {
      creds,
      expiresAt: Date.now() + CREDENTIALS_TTL_MS,
    });
  }

  return creds;
}

export interface GeminiImageCandidate {
  url?: string;
  base64?: string;
  mimeType?: string;
}

function extractGoogleImages(obj: any, results: GeminiImageCandidate[] = [], seen = new Set<string>()): GeminiImageCandidate[] {
  if (typeof obj === 'string') {
    // 1. Check for data URL image strings
    if (obj.startsWith('data:image/')) {
      const parts = obj.split(',');
      if (parts.length === 2) {
        const mimeMatch = parts[0].match(/data:(image\/[^;]+);base64/);
        const b64 = parts[1].trim();
        const key = b64.slice(0, 100);
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            base64: b64,
            mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg'
          });
        }
      }
    }
    // 2. Check for markdown image embeds ![...](https://...googleusercontent.com...)
    const mdMatches = obj.matchAll(/!\[.*?\]\((https?:\/\/[^\s\)\"\'<>]+googleusercontent\.com[^\s\)\"\'<>]*)\)/gi);
    for (const match of mdMatches) {
      const u = match[1]?.trim();
      if (u && !seen.has(u) && !u.includes('card_content')) {
        seen.add(u);
        results.push({ url: u });
      }
    }

    // 3. Check for HTML img src tags
    const htmlMatches = obj.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+googleusercontent\.com[^"']*)["']/gi);
    for (const match of htmlMatches) {
      const u = match[1]?.trim();
      if (u && !seen.has(u) && !u.includes('card_content')) {
        seen.add(u);
        results.push({ url: u });
      }
    }

    // 4. Check for standalone Google CDN image URLs
    if (obj.includes('googleusercontent.com') && !obj.includes('card_content') && !obj.includes('/a/')) {
      const rawUrl = obj.trim().replace(/^[\(\[\{<"']|[\)\]\}>"']$/g, '');
      if ((rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('//')) && !seen.has(rawUrl)) {
        seen.add(rawUrl);
        results.push({ url: rawUrl });
      }
    }
    // 5. Check for standalone base64 JPEG / PNG / WEBP payload strings (> 5KB)
    else if (obj.length > 5000 && /^[A-Za-z0-9+/=\-_ \n\r]+$/.test(obj)) {
      const cleanObj = obj.replace(/[\n\r ]/g, '');
      const key = cleanObj.slice(0, 100);
      if (!seen.has(key)) {
        if (cleanObj.startsWith('/9j/') || cleanObj.startsWith('_9j_')) {
          seen.add(key);
          results.push({ base64: cleanObj.replace(/-/g, '+').replace(/_/g, '/'), mimeType: 'image/jpeg' });
        } else if (cleanObj.startsWith('iVBORw0KGgo')) {
          seen.add(key);
          results.push({ base64: cleanObj.replace(/-/g, '+').replace(/_/g, '/'), mimeType: 'image/png' });
        } else if (cleanObj.startsWith('UklGR')) {
          seen.add(key);
          results.push({ base64: cleanObj.replace(/-/g, '+').replace(/_/g, '/'), mimeType: 'image/webp' });
        }
      }
    }
  } else if (Array.isArray(obj)) {
    // 6. Check for binary byte array representations of image (JPEG, PNG, WEBP)
    if (obj.length > 500 && typeof obj[0] === 'number') {
      let isImage = false;
      let mimeType = 'image/jpeg';
      
      if (obj[0] === 255 && obj[1] === 216 && obj[2] === 255) {
        isImage = true;
        mimeType = 'image/jpeg';
      } else if (obj[0] === 137 && obj[1] === 80 && obj[2] === 78) {
        isImage = true;
        mimeType = 'image/png';
      } else if (obj[0] === 82 && obj[1] === 73 && obj[2] === 70 && obj[3] === 70) {
        isImage = true;
        mimeType = 'image/webp';
      }

      if (isImage) {
        try {
          const u8 = new Uint8Array(obj);
          const b64 = Buffer.from(u8).toString('base64');
          const key = b64.slice(0, 100);
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ base64: b64, mimeType });
          }
        } catch {}
      } else {
        for (const item of obj) extractGoogleImages(item, results, seen);
      }
    } else {
      for (const item of obj) extractGoogleImages(item, results, seen);
    }
  } else if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) extractGoogleImages(obj[key], results, seen);
  }
  return results;
}

function parseStreamBody(body: string): { text: string; thinking?: string; images: GeminiImageCandidate[] } {
  let clean = body.startsWith(")]}'") ? body.slice(4).trimStart() : body.trimStart();
  const frames: any[] = [];
  
  // Method A: Frame-by-frame length-prefixed JSPB parsing
  let pos = 0;
  while (pos < clean.length) {
    while (pos < clean.length && /\s/.test(clean[pos])) pos++;
    if (pos >= clean.length) break;
    const m = /^(\d+)\n/.exec(clean.slice(pos));
    if (!m) break;
    const len = parseInt(m[1]);
    const start = pos + m[1].length;
    let chars = 0, units = 0, idx = start;
    while (units < len && idx < clean.length) {
      const cp = clean.codePointAt(idx)!;
      const u = cp > 0xFFFF ? 2 : 1;
      if (units + u > len) break;
      units += u; chars += cp > 0xFFFF ? 2 : 1; idx += cp > 0xFFFF ? 2 : 1;
    }
    if (units < len) break;
    const end = start + chars;
    const chunk = clean.slice(start, end).trim();
    pos = end;
    if (!chunk) continue;
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) frames.push(...parsed);
      else frames.push(parsed);
    } catch {}
  }

  // Method B: Fallback if no frames were length-prefixed
  if (frames.length === 0) {
    try {
      const p = JSON.parse(clean);
      if (Array.isArray(p)) frames.push(...p);
      else frames.push(p);
    } catch {
      for (const line of clean.split('\n')) {
        try {
          const p = JSON.parse(line.trim());
          if (Array.isArray(p)) frames.push(...p);
          else if (p && typeof p === 'object') frames.push(p);
        } catch {}
      }
    }
  }

  let finalRawText = "";
  let finalThinking = "";
  const allImages: GeminiImageCandidate[] = [];

  for (const item of frames) {
    if (!Array.isArray(item) || item.length < 3 || typeof item[2] !== "string") continue;
    try {
      const payload = JSON.parse(item[2]);
      if (!Array.isArray(payload) || payload.length < 5) continue;
      
      const candidateList = payload[4];
      if (Array.isArray(candidateList)) {
        for (const candidate of candidateList) {
          if (!Array.isArray(candidate)) continue;
          
          const textNode = candidate[1];
          const rawText = Array.isArray(textNode) && typeof textNode[0] === "string" ? textNode[0] : "";
          if (rawText) finalRawText = rawText;
          
          const thoughtsNode = candidate[37];
          if (Array.isArray(thoughtsNode) && typeof thoughtsNode[0]?.[0] === 'string') {
            finalThinking = thoughtsNode[0][0];
          }

          const imgs = extractGoogleImages(candidate);
          if (imgs.length > 0) {
            allImages.push(...imgs);
          }
        }
      }
    } catch {}
  }

  if (allImages.length === 0) {
    extractGoogleImages(frames, allImages);
  }

  const { thinking: extractedThinking, text: cleanText } = extractThinkingAndText(finalRawText);

  return {
    text: cleanText || finalRawText,
    thinking: finalThinking || extractedThinking,
    images: allImages
  };
}

export async function callGeminiWeb(
  prompt: string,
  cookieHeader: string,
  model = "gemini-3-flash"
): Promise<{ text: string; thinking?: string; images?: GeminiImageCandidate[]; updatedCookies?: Record<string, string> }> {
  const initialFreshCookie = getFreshCookieHeader(cookieHeader);
  const creds = await fetchGeminiWebCredentials(initialFreshCookie);

  // fetchGeminiWebCredentials captured rotated cookies into cookieJar; re-fetch freshest cookie
  const activeFreshCookie = getFreshCookieHeader(cookieHeader);

  const traceId   = randomHex16();
  const requestId = crypto.randomUUID().toUpperCase();
  const modelId   = getGeminiWebModelId(model);

  const inner = new Array(68).fill(null);
  inner[0]  = [prompt, 0, null, null, null, null, 0];
  inner[1]  = ["en"];
  inner[4]  = traceId;
  inner[6]  = [0];
  inner[7]  = 1;
  inner[10] = 1;
  inner[30] = [4];
  inner[41] = [1];
  // Enable temporary chat (inner[45] = 1) so calls do not save to user's Gemini history
  inner[45] = 1;
  inner[59] = requestId;
  inner[67] = 1;

  const fReq = JSON.stringify([null, JSON.stringify(inner)]);

  const queryParams = new URLSearchParams({
    bl:     creds.blValue,
    hl:     "en-US",
    _reqid: String(Math.floor(Math.random() * 900000) + 100000),
    rt:     "c",
  });
  if (creds.fSid) queryParams.set("f.sid", creds.fSid);

  const endpoint = `https://gemini.google.com/u/${creds.authUser}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${queryParams}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "X-Same-Domain":            "1",
      "X-Goog-AuthUser":          creds.authUser,
      "x-goog-ext-525001261-jspb": `[1,null,null,null,"${modelId}",null,null,0,[4],null,null,2]`,
      "x-goog-ext-525005358-jspb": `["${requestId}",1]`,
      Origin:   "https://gemini.google.com",
      Referer:  "https://gemini.google.com/",
      Cookie:   activeFreshCookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    },
    body: new URLSearchParams({ at: creds.atValue, "f.req": fReq }),
  });

  captureSetCookie(response, cookieHeader);

  if (!response.ok) throw new Error(`Gemini Web API error: ${response.status}`);

  const body = await response.text();
  if (body.includes("<!DOCTYPE html>") || body.includes('"SignIn"')) {
    throw new Error("NOT_LOGGED_IN");
  }

  const result = parseStreamBody(body);
  if (!result.text && result.images.length === 0) {
    throw new Error("No valid response from Gemini Web");
  }

  return {
    ...result,
    updatedCookies: getFreshCookieObject(cookieHeader)
  };
}
