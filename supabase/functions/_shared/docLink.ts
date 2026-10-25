// Short document links (migration 20261025210000_doc_links.sql).
//
// A stored file is never shown by its storage address
// (https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>),
// which names the backend and the path and opens for anyone who has it. The
// app shows https://gst.vjdesai.com/d/<id> instead: the page /d/:id asks the
// Edge Function doc-open, which checks who is signed in and streams the file.
//
// <id> is the first 9 bytes of sha256("<bucket>/<object name>") in base64url
// (12 characters), so the app makes it without asking the database, and the
// database makes the same one (public.doc_link_id) to find the file. Shared by
// the app (src/lib/docLinks.ts) and the e-mail shell (email.ts).

export const DOC_LINK_ORIGIN = 'https://gst.vjdesai.com';
export const DOC_LINK_RE = /^[A-Za-z0-9_-]{12}$/;

/** The buckets whose files are opened through /d/<id>. */
export const DOC_BUCKETS = ['return-pdfs', 'annual-return-evidence', 'chat-attachments'] as const;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256, synchronous (links are made while a page renders). */
export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The short id of a stored file: base64url of sha256("<bucket>/<name>")[0..9]. */
export function docLinkId(bucket: string, name: string): string {
  const d = sha256(new TextEncoder().encode(`${bucket}/${name}`));
  let s = '';
  for (let i = 0; i < 9; i += 3) {
    const n = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    s += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  return s;
}

export interface StoredFile {
  bucket: string;
  name: string;
  /** The ?download=<file name> the address carried, if any. */
  download: string | null;
}

/**
 * The file a storage address of this project names (public, authenticated or
 * signed; the bucket one of DOC_BUCKETS), else null. Only the project's own
 * host is read as storage.
 */
export function parseStorageUrl(url: string | null | undefined, supabaseUrl: string): StoredFile | null {
  if (!url || typeof url !== 'string' || !supabaseUrl) return null;
  let u: URL, base: URL;
  try {
    u = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (u.host !== base.host) return null;
  const m = /^\/storage\/v1\/object\/(?:public\/|authenticated\/|sign\/)?([^/]+)\/(.+)$/.exec(u.pathname);
  if (!m) return null;
  let bucket: string, name: string;
  try {
    bucket = decodeURIComponent(m[1]);
    name = m[2].split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  if (!(DOC_BUCKETS as readonly string[]).includes(bucket) || !name) return null;
  const dl = u.searchParams.get('download');
  return { bucket, name, download: dl === null ? null : dl };
}

/** "/d/<id>" (with ?download=) for a storage address, else null. */
export function docLinkPath(url: string | null | undefined, supabaseUrl: string): string | null {
  const f = parseStorageUrl(url, supabaseUrl);
  if (!f) return null;
  const q = f.download !== null ? `?download=${encodeURIComponent(f.download)}` : '';
  return `/d/${docLinkId(f.bucket, f.name)}${q}`;
}
