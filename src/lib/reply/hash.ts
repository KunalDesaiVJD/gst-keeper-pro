// The inputs hash of an annexure: a stable JSON of what a recipe actually
// read (each source row's id, status and the time it was pulled, the notice's
// figures, the period) hashed to a short hex string. Same inputs → same hash →
// reply_annexure_save keeps the current version; anything new → next version.
// Not a security hash: two 53-bit FNV/murmur-style lanes are plenty here.

/** JSON with object keys sorted at every level; undefined dropped, numbers rounded to the paisa. */
export function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'null';
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v instanceof Set) return stableStringify([...v].sort());
  if (v instanceof Map) return stableStringify(Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), x])));
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return 'null';
}

function lane(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashOf(v: unknown): string {
  const s = stableStringify(v);
  return `${lane(s, 1).toString(16).padStart(14, '0')}${lane(s, 7).toString(16).padStart(14, '0')}`;
}
