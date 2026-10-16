import { chunkSubtitleTextTimed } from '../../src/subtitle-chunker';

export interface Cue {
  text: string;
  start: number;
  end: number;
  [key: string]: any;
}
export interface Chunk {
  words: Cue[];
  start: number;
  end: number;
  displayEnd: number;
}
export interface ChunkOptions {
  maxWords?: number;
  minDuration?: number;
  maxDuration?: number;
  maxWordsWhenMerging?: number;
  segmentGap?: number;
}

const clean = (t: unknown) =>
  String(t ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ENDS_SENTENCE_RE = /[.!?…;—]+["')\]}]*$/;
const ENDS_CLAUSE_RE = /[,:]+["')\]}]*$/;

export function explodeToWords(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const text = clean(c.text);
    if (!text) continue;
    const start = Number(c.start) || 0;
    const end = Math.max(start + 0.05, Number(c.end) || start + 0.3);
    const parts = text.split(' ');
    if (parts.length === 1) {
      out.push({ text, start, end });
      continue;
    }
    const total = parts.reduce((n, p) => n + p.length + 1, 0);
    let t = start;
    for (const p of parts) {
      const d = ((p.length + 1) / total) * (end - start);
      out.push({ text: p, start: t, end: t + d });
      t += d;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function buildChunks(
  input: Array<Partial<Cue> & Record<string, unknown>>,
  opts: ChunkOptions = {}
): Chunk[] {
  const {
    maxWords = 3,
    minDuration = 0.6,
    maxDuration = 2.4,
    maxWordsWhenMerging = 6,
    segmentGap = 0.45, // Tighter natural speech pause threshold (was 0.8s)
  } = opts;

  const cues: Cue[] = (input || []).map((c) => ({
    text: clean(c.text ?? c.word ?? c.punctuated_word),
    start: Number(c.start ?? c.startTime ?? 0),
    end: Number(c.end ?? c.endTime ?? Number(c.start ?? 0) + 0.3),
  }));

  const words = explodeToWords(cues);
  if (!words.length) return [];

  // Break segments on silence gaps, terminal sentence punctuation, or comma + micro-pause
  const segments: Cue[][] = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    const gap = curr.start - prev.end;
    const isSentenceEnd = ENDS_SENTENCE_RE.test(prev.text);
    const isClauseBreak = ENDS_CLAUSE_RE.test(prev.text) && gap >= 0.18;

    if (gap > segmentGap || isSentenceEnd || isClauseBreak) {
      segments.push([]);
    }
    segments[segments.length - 1].push(curr);
  }

  const chunks: Chunk[] = [];
  for (const seg of segments) {
    const text = seg.map((w) => w.text).join(' ');
    const raw = chunkSubtitleTextTimed(
      text,
      seg.map((w) => ({ start: w.start, end: w.end })),
      maxWords,
      minDuration,
      maxDuration,
      maxWordsWhenMerging
    );
    for (const r of raw) {
      const ws = seg.slice(r.startWordIndex, r.endWordIndex);
      if (!ws.length) continue;
      const start = ws[0].start;
      const end = ws[ws.length - 1].end;
      chunks.push({ words: ws, start, end, displayEnd: end });
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    if (next) {
      const gap = Math.max(0, next.start - chunks[i].end);
      chunks[i].displayEnd = gap <= 0.35 ? next.start : chunks[i].end + 0.18;
    } else {
      chunks[i].displayEnd = chunks[i].end + 0.25;
    }
  }
  return chunks;
}
