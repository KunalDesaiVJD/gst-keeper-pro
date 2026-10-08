// A document from the app's own storage: downloaded only from the project's own
// host (never another address), at most 32 MB, checked to be a PDF, hashed, and
// its text layer read page by page with pdf.js (unpdf's build for edge runtimes,
// which never runs the PDF's scripts) so every quote can be checked. A scan has
// (almost) no text layer. pdf.js runs on the function's CPU, which the plan
// limits: a large file, or one whose earlier run was stopped, is sent without
// its text (its readings then stay unchecked, as for a scan).

import { getDocumentProxy } from 'unpdf';

export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
// Below this many characters a page on average, the PDF is taken as a scan.
export const SCAN_CHARS_PER_PAGE = 40;
// Above this size the text layer is not read (CPU), nor on a second attempt.
export const TEXT_MAX_BYTES = 6 * 1024 * 1024;
export const TEXT_MAX_PAGES = 60;

export class DocumentError extends Error {
  constructor(message: string, readonly reason: string, readonly retryable: boolean) {
    super(message);
  }
}

// Only the project's own host (its storage, where the extension uploads the
// documents).
export function documentUrlAllowed(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url), base = new URL(supabaseUrl);
    return u.protocol === 'https:' && u.host === base.host && u.username === '' && u.password === ''
      && u.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

export interface Downloaded {
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// "%PDF-" within the first 1024 bytes, as the PDF specification allows.
export function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function downloadPdf(url: string, opts: {
  allow: (u: string) => boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<Downloaded> {
  const maxBytes = opts.maxBytes ?? MAX_PDF_BYTES;
  if (!opts.allow(url)) throw new DocumentError('the document is not in the app\'s storage', 'document_url', false);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    let r: Response;
    let at = url;
    for (let hop = 0; ; hop++) {
      try {
        r = await (opts.fetchImpl ?? fetch)(at, { signal: ctl.signal, redirect: 'manual' });
      } catch (e) {
        throw new DocumentError(ctl.signal.aborted ? 'the PDF did not download in time' : `the PDF could not be downloaded (${(e as Error).message})`, 'download', true);
      }
      const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!location) break;
      await r.body?.cancel().catch(() => {});
      const next = new URL(location, at).toString();
      if (hop >= 3 || !opts.allow(next)) throw new DocumentError('the PDF\'s address redirects outside the app\'s storage', 'document_url', false);
      at = next;
    }
    if (!r.ok) {
      await r.body?.cancel().catch(() => {});
      const gone = r.status === 404 || r.status === 410 || r.status === 400;
      throw new DocumentError(`the PDF could not be downloaded (HTTP ${r.status})`, gone ? 'no_document' : 'download', !gone);
    }
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      await r.body?.cancel().catch(() => {});
      throw new DocumentError(`the PDF is larger than ${Math.round(maxBytes / 1048576)} MB`, 'too_large', false);
    }
    const buf = new Uint8Array(await r.arrayBuffer().catch(() => {
      throw new DocumentError('the PDF download was cut off', 'download', true);
    }));
    if (buf.byteLength > maxBytes) throw new DocumentError(`the PDF is larger than ${Math.round(maxBytes / 1048576)} MB`, 'too_large', false);
    if (!isPdf(buf)) throw new DocumentError('the document is not a PDF', 'not_pdf', false);
    return { bytes: buf, sha256: await sha256Hex(buf) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

// One page's text items as lines: a space where there is a visible gap between
// two pieces of text, a line break where the line changes (as agent/src/read/pdf.ts).
export function itemsToText(items: unknown[]): string {
  let out = '';
  let prev: TextItemLike | null = null;
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || typeof (raw as TextItemLike).str !== 'string') continue;
    const it = raw as TextItemLike;
    if (prev && it.str) {
      const size = Math.max(Math.abs(prev.height) || 0, Math.abs(it.height) || 0, 1);
      const sameLine = Math.abs((it.transform?.[5] ?? 0) - (prev.transform?.[5] ?? 0)) < size * 0.5;
      if (!prev.hasEOL && !out.endsWith('\n')) {
        if (!sameLine) out += '\n';
        else {
          const gap = (it.transform?.[4] ?? 0) - ((prev.transform?.[4] ?? 0) + (prev.width || 0));
          if (gap > size * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
        }
      }
    }
    out += it.str;
    if (it.hasEOL) out += '\n';
    if (it.str || it.hasEOL) prev = it;
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

export interface PdfText {
  pageCount: number | null;
  pages: string[];
  textLayer: boolean;
  // Why the text layer was not read (size, retry, unreadable), if it was not.
  skipped?: string;
}

export function hasTextLayer(pages: string[]): boolean {
  if (!pages.length) return false;
  const chars = pages.reduce((s, p) => s + p.replace(/\s+/g, '').length, 0);
  return chars / pages.length >= SCAN_CHARS_PER_PAGE;
}

// Page count and text. withText false: the page count only (still a parse).
export async function readPdfText(bytes: Uint8Array, opts: { maxPages: number; withText: boolean }): Promise<PdfText> {
  if (bytes.byteLength > TEXT_MAX_BYTES) return { pageCount: null, pages: [], textLayer: false, skipped: 'size' };
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(new Uint8Array(bytes), { disableFontFace: true, verbosity: 0 });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new DocumentError('the PDF is password-protected', 'encrypted', false);
    // The API may still read what pdf.js cannot: sent without its text.
    return { pageCount: null, pages: [], textLayer: false, skipped: 'unreadable' };
  }
  try {
    const pageCount = doc.numPages;
    if (!opts.withText || pageCount > Math.min(opts.maxPages, TEXT_MAX_PAGES)) {
      return { pageCount, pages: [], textLayer: false, skipped: opts.withText ? 'pages' : 'retry' };
    }
    const pages: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items as unknown[]));
      page.cleanup();
    }
    return { pageCount, pages, textLayer: hasTextLayer(pages) };
  } catch {
    return { pageCount: doc.numPages ?? null, pages: [], textLayer: false, skipped: 'unreadable' };
  } finally {
    await doc.loadingTask.destroy().catch(() => {});
  }
}

// Base64 of the PDF for the document block.
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
