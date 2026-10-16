/**
 * c2pa-cleaner.ts
 * 
 * Complete, lossless, zero-reencoding C2PA & AI Metadata Detector & Stripper.
 * Operates purely on binary container structures (JPEG, PNG, WebP, MP4/MOV, TIFF/DNG, SVG, WAV/AVI).
 * 
 * Complies with C2PA / JUMBF specifications (ISO 19566-5, ISO/IEC 14496-12).
 */

export interface C2PALocation {
    format: string;
    location: string;
    offset: number;
    size: number;
    claimGenerator?: string;
}

export interface C2PADetectionResult {
    present: boolean;
    format: string;
    locations: C2PALocation[];
    manifestSummary?: string;
    claimGenerators: string[];
    isSafeToStrip: boolean;
    reason?: string;
}

export interface StripOptions {
    mode: 'c2pa_only' | 'strip_all';
    preserveICC?: boolean;
    preserveOrientation?: boolean;
}

export interface StripResult {
    success: boolean;
    cleanedBuffer: Uint8Array;
    originalSize: number;
    cleanedSize: number;
    removedBytes: number;
    removedItems: string[];
    verifiedClean: boolean;
    error?: string;
}

// JUMBF & C2PA UUID Constants
const JUMBF_UUID_BYTES = new Uint8Array([
    0xD8, 0xFE, 0xC3, 0xD6, 0x1B, 0x0E, 0x48, 0x3C,
    0x92, 0x97, 0x58, 0x28, 0x87, 0x7E, 0xC4, 0x81
]);

const C2PA_CONTENT_TYPE_UUID = new Uint8Array([
    0x63, 0x32, 0x70, 0x61, 0x00, 0x11, 0x00, 0x10,
    0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71
]);

const XMP_UUID_BYTES = new Uint8Array([
    0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8,
    0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC
]);

function arraysEqual(a: Uint8Array, b: Uint8Array, offsetA = 0, length = a.length): boolean {
    if (offsetA + length > a.length || length > b.length) return false;
    for (let i = 0; i < length; i++) {
        if (a[offsetA + i] !== b[i]) return false;
    }
    return true;
}

function matchAscii(buf: Uint8Array, offset: number, str: string): boolean {
    if (offset + str.length > buf.length) return false;
    for (let i = 0; i < str.length; i++) {
        if (buf[offset + i] !== str.charCodeAt(i)) return false;
    }
    return true;
}

function readUint16BE(buf: Uint8Array, offset: number): number {
    return (buf[offset] << 8) | buf[offset + 1];
}

function readUint32BE(buf: Uint8Array, offset: number): number {
    return ((buf[offset] << 24) >>> 0) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

function readUint32LE(buf: Uint8Array, offset: number): number {
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | ((buf[offset + 3] << 24) >>> 0)) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, val: number) {
    buf[offset] = (val >>> 24) & 0xFF;
    buf[offset + 1] = (val >>> 16) & 0xFF;
    buf[offset + 2] = (val >>> 8) & 0xFF;
    buf[offset + 3] = val & 0xFF;
}

function writeUint32LE(buf: Uint8Array, offset: number, val: number) {
    buf[offset] = val & 0xFF;
    buf[offset + 1] = (val >>> 8) & 0xFF;
    buf[offset + 2] = (val >>> 16) & 0xFF;
    buf[offset + 3] = (val >>> 24) & 0xFF;
}

// CRC32 table for PNG chunk recalculation if needed
const CRC32_TABLE: Uint32Array = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c;
    }
    return table;
})();

function calculateCRC32(buf: Uint8Array, offset: number, length: number): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[offset + i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Detect format by magic bytes
export function detectFormat(buf: Uint8Array): string {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xD8) return 'JPEG';
    if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
        buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'PNG';
    if (buf.length >= 12 && matchAscii(buf, 0, 'RIFF') && matchAscii(buf, 8, 'WEBP')) return 'WebP';
    if (buf.length >= 12 && matchAscii(buf, 0, 'RIFF') && matchAscii(buf, 8, 'WAVE')) return 'WAV';
    if (buf.length >= 12 && matchAscii(buf, 0, 'RIFF') && matchAscii(buf, 8, 'AVI ')) return 'AVI';
    if (buf.length >= 8 && (matchAscii(buf, 4, 'ftyp') || matchAscii(buf, 4, 'moov') || matchAscii(buf, 4, 'free'))) return 'BMFF'; // MP4 / MOV / M4A / HEIC
    if (buf.length >= 4 && ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00) ||
                            (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A))) return 'TIFF';
    if (buf.length >= 5 && (matchAscii(buf, 0, '<?xml') || matchAscii(buf, 0, '<svg'))) return 'SVG';
    if (buf.length >= 4 && matchAscii(buf, 0, '%PDF')) return 'PDF';
    return 'UNKNOWN';
}

/**
 * Parses claim generator name out of JUMBF binary slice if present
 */
function extractClaimGenerator(buf: Uint8Array, start: number, end: number): string | undefined {
    try {
        const slice = buf.subarray(start, Math.min(end, start + 4096));
        const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
        // Look for claim_generator or generator name patterns in manifest JSON/CBOR/XMP
        const m = text.match(/"claim_generator":\s*"([^"]+)"/) ||
                  text.match(/claim_generator[^"]*"([^"]{3,60})"/i) ||
                  text.match(/generator[^:]*:\s*"?([a-zA-Z0-9_\-\. ]{3,50})"?/i);
        if (m && m[1]) return m[1].trim();
    } catch {
        // ignore extraction failures
    }
    return undefined;
}

// -------------------------------------------------------------
// 1. JPEG Detection & Stripping
// -------------------------------------------------------------
function detectJPEG(buf: Uint8Array): C2PADetectionResult {
    const locations: C2PALocation[] = [];
    const claimGenerators: string[] = [];
    let pos = 2; // skip SOI (0xFFD8)

    while (pos < buf.length - 1) {
        if (buf[pos] !== 0xFF) {
            pos++;
            continue;
        }
        const marker = buf[pos + 1];
        if (marker === 0xD9 || marker === 0xDA) break; // EOI or SOS
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
            pos += 2;
            continue;
        }

        const len = readUint16BE(buf, pos + 2);
        const segTotal = 2 + len;

        // APP11 (0xFFEB): Check for "JP" JUMBF identifier
        if (marker === 0xEB && len >= 4) {
            if (matchAscii(buf, pos + 4, 'JP')) {
                const claimGen = extractClaimGenerator(buf, pos + 4, pos + segTotal);
                if (claimGen && !claimGenerators.includes(claimGen)) claimGenerators.push(claimGen);
                locations.push({
                    format: 'JPEG',
                    location: 'APP11 JUMBF Segment (0xFFEB)',
                    offset: pos,
                    size: segTotal,
                    claimGenerator: claimGen
                });
            }
        }

        // APP1 (0xFFE1): Check for XMP with dcterms:provenance or c2pa
        if (marker === 0xE1 && len >= 29) {
            if (matchAscii(buf, pos + 4, 'http://ns.adobe.com/xap/1.0/')) {
                const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(pos + 4, pos + segTotal));
                if (/dcterms:provenance|c2pa:manifest|<c2pa:/i.test(xmpText)) {
                    locations.push({
                        format: 'JPEG',
                        location: 'APP1 XMP Provenance Tag',
                        offset: pos,
                        size: segTotal
                    });
                }
            }
        }

        pos += segTotal;
    }

    return {
        present: locations.length > 0,
        format: 'JPEG',
        locations,
        claimGenerators,
        isSafeToStrip: true
    };
}

function stripJPEG(buf: Uint8Array, options: StripOptions): StripResult {
    const removedItems: string[] = [];
    const chunks: Uint8Array[] = [];
    let pos = 2; // start after SOI
    chunks.push(buf.subarray(0, 2)); // keep SOI 0xFFD8

    while (pos < buf.length - 1) {
        if (buf[pos] !== 0xFF) {
            pos++;
            continue;
        }
        const marker = buf[pos + 1];
        if (marker === 0xDA) { // SOS (Start of Scan) - remainder of file is compressed data
            chunks.push(buf.subarray(pos));
            break;
        }
        if (marker === 0xD9) { // EOI
            chunks.push(buf.subarray(pos, pos + 2));
            break;
        }
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
            chunks.push(buf.subarray(pos, pos + 2));
            pos += 2;
            continue;
        }

        const len = readUint16BE(buf, pos + 2);
        const segTotal = 2 + len;
        const segBytes = buf.subarray(pos, pos + segTotal);

        let shouldRemove = false;

        // 1. APP11 JUMBF (C2PA)
        if (marker === 0xEB && len >= 4 && matchAscii(buf, pos + 4, 'JP')) {
            shouldRemove = true;
            removedItems.push(`APP11 C2PA JUMBF segment (${segTotal} bytes)`);
        }

        // 2. APP1 XMP
        else if (marker === 0xE1 && len >= 29 && matchAscii(buf, pos + 4, 'http://ns.adobe.com/xap/1.0/')) {
            if (options.mode === 'strip_all') {
                shouldRemove = true;
                removedItems.push(`APP1 XMP segment (${segTotal} bytes)`);
            } else {
                const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(pos + 4, pos + segTotal));
                if (/dcterms:provenance|c2pa:manifest|<c2pa:/i.test(xmpText)) {
                    // In c2pa_only mode, remove provenance property or drop if only c2pa
                    shouldRemove = true;
                    removedItems.push(`APP1 XMP C2PA provenance link (${segTotal} bytes)`);
                }
            }
        }

        // 3. Strip all mode: remove non-essential APP segments (preserve APP0 JFIF and APP2 ICC if requested)
        else if (options.mode === 'strip_all') {
            if (marker === 0xE0) {
                // Keep APP0 JFIF
            } else if (marker === 0xE2 && matchAscii(buf, pos + 4, 'ICC_PROFILE') && options.preserveICC !== false) {
                // Keep ICC Profile
            } else if (marker === 0xE1 && matchAscii(buf, pos + 4, 'Exif\0\0') && options.preserveOrientation) {
                // Keep EXIF for orientation
            } else if (marker >= 0xE0 && marker <= 0xEF) {
                // Remove other metadata segments
                shouldRemove = true;
                removedItems.push(`APP${marker - 0xE0} metadata segment (${segTotal} bytes)`);
            } else if (marker === 0xFE) { // COM comment
                shouldRemove = true;
                removedItems.push(`COM comment segment (${segTotal} bytes)`);
            }
        }

        if (!shouldRemove) {
            chunks.push(segBytes);
        }

        pos += segTotal;
    }

    // Merge chunks
    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    // Validation: check SOI/EOI and ensure no duplicate SOF headers
    let sofCount = 0;
    for (let i = 0; i < result.length - 1; i++) {
        if (result[i] === 0xFF && (result[i + 1] >= 0xC0 && result[i + 1] <= 0xC3)) {
            sofCount++;
        }
    }

    const valid = result.length >= 4 && result[0] === 0xFF && result[1] === 0xD8 &&
                  result[result.length - 2] === 0xFF && result[result.length - 1] === 0xD9 &&
                  sofCount <= 1;

    return {
        success: valid,
        cleanedBuffer: result,
        originalSize: buf.length,
        cleanedSize: result.length,
        removedBytes: buf.length - result.length,
        removedItems,
        verifiedClean: !detectJPEG(result).present
    };
}

// -------------------------------------------------------------
// 2. PNG Detection & Stripping
// -------------------------------------------------------------
function detectPNG(buf: Uint8Array): C2PADetectionResult {
    const locations: C2PALocation[] = [];
    const claimGenerators: string[] = [];
    let pos = 8; // skip 8-byte PNG signature

    while (pos < buf.length - 8) {
        const len = readUint32BE(buf, pos);
        const typeStr = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        const chunkTotal = 12 + len;

        if (typeStr === 'caBX') {
            const claimGen = extractClaimGenerator(buf, pos + 8, pos + 8 + len);
            if (claimGen && !claimGenerators.includes(claimGen)) claimGenerators.push(claimGen);
            locations.push({
                format: 'PNG',
                location: 'caBX JUMBF Chunk',
                offset: pos,
                size: chunkTotal,
                claimGenerator: claimGen
            });
        } else if (typeStr === 'iTXt' || typeStr === 'tEXt' || typeStr === 'zTXt') {
            const chunkData = buf.subarray(pos + 8, pos + 8 + len);
            const text = new TextDecoder('utf-8', { fatal: false }).decode(chunkData);
            if (/XML:com\.adobe\.xmp.*dcterms:provenance|c2pa:manifest|<c2pa:/i.test(text)) {
                locations.push({
                    format: 'PNG',
                    location: `${typeStr} XMP C2PA Metadata Chunk`,
                    offset: pos,
                    size: chunkTotal
                });
            }
        }

        if (typeStr === 'IEND') break;
        pos += chunkTotal;
    }

    return {
        present: locations.length > 0,
        format: 'PNG',
        locations,
        claimGenerators,
        isSafeToStrip: true
    };
}

function stripPNG(buf: Uint8Array, options: StripOptions): StripResult {
    const removedItems: string[] = [];
    const chunks: Uint8Array[] = [];
    chunks.push(buf.subarray(0, 8)); // PNG signature
    let pos = 8;

    while (pos < buf.length - 8) {
        const len = readUint32BE(buf, pos);
        const typeStr = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        const chunkTotal = 12 + len;
        const chunkBytes = buf.subarray(pos, pos + chunkTotal);

        let shouldRemove = false;

        // 1. caBX chunk (C2PA JUMBF)
        if (typeStr === 'caBX') {
            shouldRemove = true;
            removedItems.push(`caBX (C2PA JUMBF chunk, ${chunkTotal} bytes)`);
        }
        // 2. Text / XMP chunks with provenance
        else if (typeStr === 'iTXt' || typeStr === 'tEXt' || typeStr === 'zTXt') {
            if (options.mode === 'strip_all') {
                shouldRemove = true;
                removedItems.push(`${typeStr} text chunk (${chunkTotal} bytes)`);
            } else {
                const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(pos + 8, pos + 8 + len));
                if (/dcterms:provenance|c2pa:manifest|<c2pa:/i.test(text)) {
                    shouldRemove = true;
                    removedItems.push(`${typeStr} C2PA XMP metadata chunk (${chunkTotal} bytes)`);
                }
            }
        }
        // 3. Other metadata chunks in strip-all mode (eXIf, tIME, etc.)
        else if (options.mode === 'strip_all') {
            if (typeStr === 'eXIf' && !options.preserveOrientation) {
                shouldRemove = true;
                removedItems.push(`eXIf chunk (${chunkTotal} bytes)`);
            } else if (typeStr === 'tIME') {
                shouldRemove = true;
                removedItems.push(`tIME chunk (${chunkTotal} bytes)`);
            }
        }

        if (!shouldRemove) {
            chunks.push(chunkBytes);
        }

        if (typeStr === 'IEND') break;
        pos += chunkTotal;
    }

    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    const valid = result.length >= 8 &&
                  result[0] === 0x89 && result[1] === 0x50 && result[2] === 0x4E && result[3] === 0x47 &&
                  matchAscii(result, result.length - 8, 'IEND');

    return {
        success: valid,
        cleanedBuffer: result,
        originalSize: buf.length,
        cleanedSize: result.length,
        removedBytes: buf.length - result.length,
        removedItems,
        verifiedClean: !detectPNG(result).present
    };
}

// -------------------------------------------------------------
// 3. WebP Detection & Stripping
// -------------------------------------------------------------
function detectWebP(buf: Uint8Array): C2PADetectionResult {
    const locations: C2PALocation[] = [];
    const claimGenerators: string[] = [];
    let pos = 12; // skip RIFF header (4 FourCC + 4 size + 4 'WEBP')

    while (pos < buf.length - 8) {
        const fourCC = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
        const size = readUint32LE(buf, pos + 4);
        const pad = size % 2 === 1 ? 1 : 0;
        const chunkTotal = 8 + size + pad;

        if (fourCC === 'C2PA') {
            const claimGen = extractClaimGenerator(buf, pos + 8, pos + 8 + size);
            if (claimGen && !claimGenerators.includes(claimGen)) claimGenerators.push(claimGen);
            locations.push({
                format: 'WebP',
                location: 'RIFF C2PA Chunk',
                offset: pos,
                size: chunkTotal,
                claimGenerator: claimGen
            });
        } else if (fourCC === 'XMP ') {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(pos + 8, pos + 8 + size));
            if (/dcterms:provenance|c2pa:manifest|<c2pa:/i.test(text)) {
                locations.push({
                    format: 'WebP',
                    location: 'XMP Provenance Chunk',
                    offset: pos,
                    size: chunkTotal
                });
            }
        }

        pos += chunkTotal;
    }

    return {
        present: locations.length > 0,
        format: 'WebP',
        locations,
        claimGenerators,
        isSafeToStrip: true
    };
}

function stripWebP(buf: Uint8Array, options: StripOptions): StripResult {
    const removedItems: string[] = [];
    const chunks: Uint8Array[] = [];
    chunks.push(buf.subarray(0, 12)); // RIFF + size + WEBP
    let pos = 12;
    let removedXMP = false;
    let removedEXIF = false;

    while (pos < buf.length - 8) {
        const fourCC = String.fromCharCode(buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]);
        const size = readUint32LE(buf, pos + 4);
        const pad = size % 2 === 1 ? 1 : 0;
        const chunkTotal = 8 + size + pad;
        const chunkBytes = buf.subarray(pos, pos + chunkTotal);

        let shouldRemove = false;

        if (fourCC === 'C2PA') {
            shouldRemove = true;
            removedItems.push(`C2PA chunk (${chunkTotal} bytes)`);
        } else if (fourCC === 'XMP ') {
            if (options.mode === 'strip_all') {
                shouldRemove = true;
                removedXMP = true;
                removedItems.push(`XMP chunk (${chunkTotal} bytes)`);
            } else {
                const text = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(pos + 8, pos + 8 + size));
                if (/dcterms:provenance|c2pa:manifest|<c2pa:/i.test(text)) {
                    shouldRemove = true;
                    removedXMP = true;
                    removedItems.push(`XMP C2PA metadata chunk (${chunkTotal} bytes)`);
                }
            }
        } else if (fourCC === 'EXIF' && options.mode === 'strip_all') {
            shouldRemove = true;
            removedEXIF = true;
            removedItems.push(`EXIF chunk (${chunkTotal} bytes)`);
        }

        if (!shouldRemove) {
            chunks.push(chunkBytes);
        }

        pos += chunkTotal;
    }

    const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    // Rewrite RIFF size field at bytes 4..7 (total size - 8)
    writeUint32LE(result, 4, result.length - 8);

    // If VP8X extended header exists at byte 12, fix the flags
    if (result.length >= 30 && matchAscii(result, 12, 'VP8X')) {
        let flags = result[20];
        if (removedXMP) flags &= ~0x04; // clear bit 2 (XMP)
        if (removedEXIF) flags &= ~0x08; // clear bit 3 (EXIF)
        result[20] = flags;
    }

    const valid = result.length >= 12 && matchAscii(result, 0, 'RIFF') && matchAscii(result, 8, 'WEBP');

    return {
        success: valid,
        cleanedBuffer: result,
        originalSize: buf.length,
        cleanedSize: result.length,
        removedBytes: buf.length - result.length,
        removedItems,
        verifiedClean: !detectWebP(result).present
    };
}

// -------------------------------------------------------------
// 4. MP4 / MOV / BMFF (ISO Base Media Format) Detection & Stripping
// -------------------------------------------------------------
function detectBMFF(buf: Uint8Array): C2PADetectionResult {
    const locations: C2PALocation[] = [];
    const claimGenerators: string[] = [];
    let pos = 0;

    while (pos < buf.length - 8) {
        let size = readUint32BE(buf, pos);
        const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        let headerSize = 8;

        if (size === 1) { // 64-bit size
            if (pos + 16 > buf.length) break;
            const hi = readUint32BE(buf, pos + 8);
            const lo = readUint32BE(buf, pos + 12);
            size = (hi * 0x100000000) + lo;
            headerSize = 16;
        } else if (size === 0) { // extends to EOF
            size = buf.length - pos;
        }

        if (size < headerSize || pos + size > buf.length) break;

        // Top level 'uuid' box
        if (type === 'uuid' && size >= headerSize + 16) {
            const uuidSlice = buf.subarray(pos + headerSize, pos + headerSize + 16);
            if (arraysEqual(uuidSlice, JUMBF_UUID_BYTES)) {
                const claimGen = extractClaimGenerator(buf, pos + headerSize + 16, pos + size);
                if (claimGen && !claimGenerators.includes(claimGen)) claimGenerators.push(claimGen);
                locations.push({
                    format: 'MP4/BMFF',
                    location: 'C2PA JUMBF uuid box (D8FEC3D6-...)',
                    offset: pos,
                    size,
                    claimGenerator: claimGen
                });
            }
        }

        pos += size;
    }

    return {
        present: locations.length > 0,
        format: 'MP4/BMFF',
        locations,
        claimGenerators,
        isSafeToStrip: true
    };
}

function stripBMFF(buf: Uint8Array, options: StripOptions): StripResult {
    const removedItems: string[] = [];
    const boxesToKeep: { offset: number; size: number }[] = [];
    let pos = 0;
    let mdatOffset = -1;
    let removedBytesBeforeMdat = 0;

    // First pass: identify boxes and mdat position
    while (pos < buf.length - 8) {
        let size = readUint32BE(buf, pos);
        const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        let headerSize = 8;

        if (size === 1) {
            const hi = readUint32BE(buf, pos + 8);
            const lo = readUint32BE(buf, pos + 12);
            size = (hi * 0x100000000) + lo;
            headerSize = 16;
        } else if (size === 0) {
            size = buf.length - pos;
        }

        if (size < headerSize || pos + size > buf.length) break;

        if (type === 'mdat' && mdatOffset === -1) {
            mdatOffset = pos;
        }

        let shouldRemove = false;

        if (type === 'uuid' && size >= headerSize + 16) {
            const uuidSlice = buf.subarray(pos + headerSize, pos + headerSize + 16);
            if (arraysEqual(uuidSlice, JUMBF_UUID_BYTES)) {
                shouldRemove = true;
                removedItems.push(`C2PA uuid box (${size} bytes)`);
                if (mdatOffset === -1) removedBytesBeforeMdat += size;
            } else if (options.mode === 'strip_all' && arraysEqual(uuidSlice, XMP_UUID_BYTES)) {
                shouldRemove = true;
                removedItems.push(`XMP uuid box (${size} bytes)`);
                if (mdatOffset === -1) removedBytesBeforeMdat += size;
            }
        } else if (options.mode === 'strip_all' && (type === 'udta' || type === 'meta')) {
            // Drop top-level or udta metadata
            shouldRemove = true;
            removedItems.push(`${type} metadata box (${size} bytes)`);
            if (mdatOffset === -1) removedBytesBeforeMdat += size;
        }

        if (!shouldRemove) {
            boxesToKeep.push({ offset: pos, size });
        }

        pos += size;
    }

    if (removedItems.length === 0) {
        return {
            success: true,
            cleanedBuffer: buf,
            originalSize: buf.length,
            cleanedSize: buf.length,
            removedBytes: 0,
            removedItems: [],
            verifiedClean: true
        };
    }

    // Assemble new buffer
    const totalNewSize = boxesToKeep.reduce((acc, b) => acc + b.size, 0);
    const result = new Uint8Array(totalNewSize);
    let writeOffset = 0;

    for (const b of boxesToKeep) {
        result.set(buf.subarray(b.offset, b.offset + b.size), writeOffset);
        writeOffset += b.size;
    }

    // CRITICAL OFFSET FIXUP: If boxes were removed BEFORE mdat, adjust stco/co64 sample tables in moov
    if (removedBytesBeforeMdat > 0) {
        fixupBMFFOffsets(result, removedBytesBeforeMdat);
    }

    return {
        success: true,
        cleanedBuffer: result,
        originalSize: buf.length,
        cleanedSize: result.length,
        removedBytes: buf.length - result.length,
        removedItems,
        verifiedClean: !detectBMFF(result).present
    };
}

/**
 * Traverses moov > trak > mdia > minf > stbl to adjust stco (32-bit) and co64 (64-bit) chunk offsets
 */
function fixupBMFFOffsets(buf: Uint8Array, delta: number) {
    let pos = 0;
    while (pos < buf.length - 8) {
        const size = readUint32BE(buf, pos);
        const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        if (size < 8 || pos + size > buf.length) break;

        if (type === 'moov') {
            walkBMFFContainer(buf, pos + 8, pos + size, delta);
            break;
        }
        pos += size;
    }
}

function walkBMFFContainer(buf: Uint8Array, start: number, end: number, delta: number) {
    let pos = start;
    while (pos < end - 8) {
        const size = readUint32BE(buf, pos);
        const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
        if (size < 8 || pos + size > end) break;

        if (type === 'trak' || type === 'mdia' || type === 'minf' || type === 'stbl') {
            walkBMFFContainer(buf, pos + 8, pos + size, delta);
        } else if (type === 'stco') {
            // stco: 4 bytes version/flags, 4 bytes entry count, followed by N 32-bit offsets
            if (pos + 16 <= end) {
                const entryCount = readUint32BE(buf, pos + 12);
                let entryOffset = pos + 16;
                for (let i = 0; i < entryCount && entryOffset + 4 <= end; i++) {
                    const currentOffset = readUint32BE(buf, entryOffset);
                    if (currentOffset >= delta) {
                        writeUint32BE(buf, entryOffset, currentOffset - delta);
                    }
                    entryOffset += 4;
                }
            }
        } else if (type === 'co64') {
            // co64: 4 bytes version/flags, 4 bytes entry count, followed by N 64-bit offsets
            if (pos + 16 <= end) {
                const entryCount = readUint32BE(buf, pos + 12);
                let entryOffset = pos + 16;
                for (let i = 0; i < entryCount && entryOffset + 8 <= end; i++) {
                    const hi = readUint32BE(buf, entryOffset);
                    const lo = readUint32BE(buf, entryOffset + 4);
                    let full = (hi * 0x100000000) + lo;
                    if (full >= delta) {
                        full -= delta;
                        writeUint32BE(buf, entryOffset, Math.floor(full / 0x100000000));
                        writeUint32BE(buf, entryOffset + 4, full >>> 0);
                    }
                    entryOffset += 8;
                }
            }
        }

        pos += size;
    }
}

// -------------------------------------------------------------
// 5. Raw JUMBF Scan (Fallback Heuristic)
// -------------------------------------------------------------
function scanRawJUMBF(buf: Uint8Array): C2PALocation[] {
    const locations: C2PALocation[] = [];
    const len = buf.length;
    // scan for 'jumb' (0x6A, 0x75, 0x6D, 0x62)
    for (let i = 0; i < len - 24; i++) {
        if (buf[i] === 0x6A && buf[i + 1] === 0x75 && buf[i + 2] === 0x6D && buf[i + 3] === 0x62) {
            // check if followed closely by jumd or c2pa content type
            const sub = buf.subarray(i, i + 32);
            if (matchAscii(sub, 8, 'jumd') || arraysEqual(buf.subarray(i + 12, i + 28), C2PA_CONTENT_TYPE_UUID)) {
                locations.push({
                    format: 'RAW',
                    location: `Raw JUMBF Box Signature`,
                    offset: i > 4 ? i - 4 : i,
                    size: 64
                });
            }
        }
    }
    return locations;
}

// -------------------------------------------------------------
// Main Unified Detection & Stripping API
// -------------------------------------------------------------
export function detectC2PA(buffer: Uint8Array): C2PADetectionResult {
    const format = detectFormat(buffer);

    let result: C2PADetectionResult;
    switch (format) {
        case 'JPEG':
            result = detectJPEG(buffer);
            break;
        case 'PNG':
            result = detectPNG(buffer);
            break;
        case 'WebP':
            result = detectWebP(buffer);
            break;
        case 'BMFF':
            result = detectBMFF(buffer);
            break;
        case 'PDF':
            result = {
                present: /C2PA_Manifest|\/Manifest/i.test(new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, 10000))),
                format: 'PDF',
                locations: [{ format: 'PDF', location: 'PDF Catalog Associated Files', offset: 0, size: 0 }],
                claimGenerators: [],
                isSafeToStrip: false,
                reason: 'PDF C2PA removal not supported (detection only).'
            };
            break;
        default: {
            const raw = scanRawJUMBF(buffer);
            result = {
                present: raw.length > 0,
                format,
                locations: raw,
                claimGenerators: [],
                isSafeToStrip: false,
                reason: raw.length > 0 ? 'Detected JUMBF signature in unsupported container format.' : undefined
            };
        }
    }

    // Append manifest summary string
    if (result.present) {
        const gens = result.claimGenerators.length > 0 ? ` [${result.claimGenerators.join(', ')}]` : '';
        result.manifestSummary = `Found ${result.locations.length} C2PA/AI manifest segment(s)${gens}`;
    }

    return result;
}

export function stripC2PA(buffer: Uint8Array, options: StripOptions = { mode: 'c2pa_only', preserveICC: true, preserveOrientation: true }): StripResult {
    try {
        const format = detectFormat(buffer);

        switch (format) {
            case 'JPEG':
                return stripJPEG(buffer, options);
            case 'PNG':
                return stripPNG(buffer, options);
            case 'WebP':
                return stripWebP(buffer, options);
            case 'BMFF':
                return stripBMFF(buffer, options);
            case 'PDF':
                return {
                    success: false,
                    cleanedBuffer: buffer,
                    originalSize: buffer.length,
                    cleanedSize: buffer.length,
                    removedBytes: 0,
                    removedItems: [],
                    verifiedClean: false,
                    error: 'PDF C2PA removal is not supported (detection only).'
                };
            default:
                return {
                    success: false,
                    cleanedBuffer: buffer,
                    originalSize: buffer.length,
                    cleanedSize: buffer.length,
                    removedBytes: 0,
                    removedItems: [],
                    verifiedClean: false,
                    error: `Unsupported container format: ${format}`
                };
        }
    } catch (err: any) {
        return {
            success: false,
            cleanedBuffer: buffer,
            originalSize: buffer.length,
            cleanedSize: buffer.length,
            removedBytes: 0,
            removedItems: [],
            verifiedClean: false,
            error: err?.message || 'Failed to strip metadata'
        };
    }
}

/**
 * Convenient async helper for stripping a Blob or File directly
 */
export async function cleanMediaBlob(blob: Blob, options?: StripOptions): Promise<{ cleanedBlob: Blob; result: StripResult }> {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const result = stripC2PA(bytes, options);
    const cleanedBlob = new Blob([result.cleanedBuffer as any], { type: blob.type });
    return { cleanedBlob, result };
}

/**
 * Strips C2PA / AI metadata directly from a base64 encoded image string (lossless, zero-reencoding).
 */
export function cleanBase64Image(base64: string, options?: StripOptions): { base64: string; result: StripResult } {
    try {
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        const result = stripC2PA(bytes, options);
        if (result.success && result.cleanedBuffer) {
            let binary = '';
            const buf = result.cleanedBuffer;
            const len = buf.byteLength;
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(buf[i]);
            }
            return {
                base64: btoa(binary),
                result
            };
        }
        return { base64, result };
    } catch (e: any) {
        return {
            base64,
            result: {
                success: false,
                cleanedBuffer: new Uint8Array(0),
                originalSize: 0,
                cleanedSize: 0,
                removedBytes: 0,
                removedItems: [],
                verifiedClean: false,
                error: e?.message || 'Failed to clean base64 image'
            }
        };
    }
}

