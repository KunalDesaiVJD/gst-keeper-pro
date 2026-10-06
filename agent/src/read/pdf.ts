// The notice PDF: downloaded from the app's own storage (never another
// address), at most 32 MB, checked to be a PDF, hashed, and its text layer
// read page by page with pdf.js, which never runs the PDF's scripts. A scan
// has (almost) no text layer, so nothing in it can be checked against a quote.

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

export const MAX_PDF_BYTES = 32 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
// Below this many characters a page on average, the PDF is taken as a scan.
export const SCAN_CHARS_PER_PAGE = 40;

export class DocumentError extends Error {
  constructor(message: string, readonly reason: string, readonly retryable: boolean) {
    super(message);
  }
}

// Only the database's own host (its storage, where the extension uploads the
// notices) — so a bad document_url can never make the office PC fetch, and
// send to the API, something from elsewhere on its network.
export function documentUrlAllowed(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url), base = new URL(supabaseUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.protocol === base.protocol && u.host === base.host
      && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

export interface Downloaded {
  bytes: Uint8Array;
  sha256: string;
}

export interface DownloadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  // Where the document (and any redirect) may come from.
  allow?: (url: string) => boolean;
}

export async function downloadPdf(url: string, opts: DownloadOptions = {}): Promise<Downloaded> {
  const maxBytes = opts.maxBytes ?? MAX_PDF_BYTES;
  const allow = opts.allow ?? (() => true);
  if (!allow(url)) throw new DocumentError('the document is not in the app\'s storage', 'document_url', false);
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
        if (opts.signal?.aborted) throw new DocumentError('stopped while downloading the PDF', 'agent_stopped', true);
        throw new DocumentError(ctl.signal.aborted ? 'the PDF did not download within 60 seconds' : `the PDF could not be downloaded (${(e as Error).message})`, 'download', true);
      }
      const location = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
      if (!location) break;
      r.body?.cancel().catch(() => {});
      const next = new URL(location, at).toString();
      if (hop >= 3 || !allow(next)) throw new DocumentError('the PDF\'s address redirects outside the app\'s storage', 'document_url', false);
      at = next;
    }
    if (!r.ok) {
      r.body?.cancel().catch(() => {});
      const gone = r.status === 404 || r.status === 410 || r.status === 400;
      throw new DocumentError(`the PDF could not be downloaded (HTTP ${r.status})`, gone ? 'no_document' : 'download', !gone);
    }
    const declared = Number(r.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      r.body?.cancel().catch(() => {});
      throw new DocumentError(`the PDF is larger than ${Math.round(maxBytes / 1048576)} MB`, 'too_large', false);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      const reader = r.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new DocumentError(`the PDF is larger than ${Math.round(maxBytes / 1048576)} MB`, 'too_large', false);
          }
          chunks.push(value);
        }
      }
    } catch (e) {
      if (e instanceof DocumentError) throw e;
      if (opts.signal?.aborted) throw new DocumentError('stopped while downloading the PDF', 'agent_stopped', true);
      throw new DocumentError(ctl.signal.aborted ? 'the PDF did not download within 60 seconds' : 'the PDF download was cut off', 'download', true);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    if (!isPdf(bytes)) throw new DocumentError('the document is not a PDF', 'not_pdf', false);
    return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

// "%PDF-" within the first 1024 bytes, as the PDF specification allows.
export function isPdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

// ── Text layer ─────────────────────────────────────────────────────────────
const require = createRequire(import.meta.url);
let pdfjsDir: string | null = null;
function assetsDir(): string {
  if (!pdfjsDir) pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return pdfjsDir;
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

// One page's text items as lines: a space where there is a visible gap
// between two pieces of text, a line break where the line changes.
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
  pageCount: number;
  pages: string[];
  textLayer: boolean;
}

// Page count first; the text only when the PDF is within maxPages.
export async function readPdfText(bytes: Uint8Array, maxPages: number): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dir = assetsDir();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
    // pdf.js wants a trailing "/" (also on Windows, where it reads the files with fs).
    cMapUrl: path.join(dir, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: path.join(dir, 'standard_fonts') + '/',
    wasmUrl: path.join(dir, 'wasm') + '/',
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => {});
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new DocumentError('the PDF is password-protected', 'encrypted', false);
    throw new DocumentError(`the PDF could not be read (${(e as Error).message})`, 'bad_pdf', false);
  }
  try {
    const pageCount = doc.numPages;
    if (pageCount > maxPages) return { pageCount, pages: [], textLayer: false };
    const pages: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(itemsToText(content.items as unknown[]));
      page.cleanup();
    }
    return { pageCount, pages, textLayer: hasTextLayer(pages) };
  } catch (e) {
    if (e instanceof DocumentError) throw e;
    throw new DocumentError(`the PDF could not be read (${(e as Error).message})`, 'bad_pdf', false);
  } finally {
    await doc.destroy().catch(() => {});
  }
}

export function hasTextLayer(pages: string[]): boolean {
  if (!pages.length) return false;
  const chars = pages.reduce((s, p) => s + p.replace(/\s+/g, '').length, 0);
  return chars / pages.length >= SCAN_CHARS_PER_PAGE;
}
