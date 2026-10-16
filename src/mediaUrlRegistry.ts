const owners = new Map<string, Set<string>>();

export function acquireUrl(url: string | undefined, owner: string) {
  if (!url) return;
  let s = owners.get(url);
  if (!s) {
    s = new Set<string>();
    owners.set(url, s);
  }
  s.add(owner);
}

export function releaseUrl(url: string | undefined, owner: string) {
  if (!url) return;
  const s = owners.get(url);
  if (s) {
    s.delete(owner);
    if (s.size > 0) return;
    owners.delete(url);
  }
  try {
    URL.revokeObjectURL(url);
  } catch {}
}

export const urlInUse = (url: string) => (owners.get(url)?.size ?? 0) > 0;

export function dropOwner(url: string | undefined, owner: string) {
  if (!url) return;
  const s = owners.get(url);
  if (!s) return;
  s.delete(owner);
  if (s.size === 0) owners.delete(url);
}
