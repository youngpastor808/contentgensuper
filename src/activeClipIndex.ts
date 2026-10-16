interface ClipLike { startTime?: number; endTime?: number; duration?: number }
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function linearFind(clips: ClipLike[], time: number): number {
  for (let i = 0; i < clips.length; i++) {
    const s = isNum(clips[i].startTime) ? clips[i].startTime! : 0;
    const e = isNum(clips[i].endTime) ? clips[i].endTime! : s + (clips[i].duration || 0);
    if (time >= s && time < e) return i;
  }
  return -1;
}

export class ActiveClipIndex {
  private clips: ClipLike[] | null = null;
  private len = -1;
  private version = -1;
  private starts: number[] = [];
  private ends: number[] = [];
  private sorted = false;
  private last = 0;

  ensure(clips: ClipLike[], version: number) {
    if (clips === this.clips && clips.length === this.len && version === this.version) return;
    this.clips = clips; this.len = clips.length; this.version = version;
    const n = clips.length;
    this.starts = new Array(n); this.ends = new Array(n);
    let sorted = true;
    for (let i = 0; i < n; i++) {
      const c = clips[i];
      const s = isNum(c.startTime) ? c.startTime! : 0;
      const e = isNum(c.endTime) ? c.endTime! : s + (c.duration || 0);
      this.starts[i] = s; this.ends[i] = e;
      if (e < s || (i > 0 && s < this.ends[i - 1] - 1e-9)) sorted = false;
    }
    this.sorted = sorted; this.last = 0;
  }

  startOf(i: number) { return this.starts[i]; }

  /** Same result as linearFind(). */
  find(time: number): number {
    const n = this.starts.length;
    if (n === 0) return -1;
    if (!this.sorted) {
      for (let i = 0; i < n; i++) if (time >= this.starts[i] && time < this.ends[i]) return i;
      return -1;
    }
    const l = Math.min(this.last, n - 1);
    if (time >= this.starts[l] && time < this.ends[l]) return l;               // same clip
    if (l + 1 < n && time >= this.starts[l + 1] && time < this.ends[l + 1]) { this.last = l + 1; return l + 1; } // next clip
    let lo = 0, hi = n - 1, ans = -1;                                            // binary search
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans >= 0 && time < this.ends[ans]) { this.last = ans; return ans; }
    return -1;
  }

  /** Last clip (from the end) whose end <= time; used for gap-hold. */
  lastEnded(time: number): number {
    const n = this.ends.length;
    if (!this.sorted) { for (let i = n - 1; i >= 0; i--) if (time >= this.ends[i]) return i; return -1; }
    let lo = 0, hi = n - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.ends[mid] <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }
}
