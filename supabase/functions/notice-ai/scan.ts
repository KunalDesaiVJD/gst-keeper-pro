// A scan or a photo of a page read through GST Keeper's own Claude CLI gateway
// (api/claude-cli.ts, 29 October 2026): the gateway opens the file itself from
// this project's storage, so the reader sends where the file is, never its
// bytes. A scan of up to SCAN_MAX_PAGES pages goes whole, from where it is
// stored; a longer one is read in part, as a long typed document is (its first
// nine pages and its last three, pages.ts): those pages are copied into one PDF in
// the private bucket ai-cli-temp, read, and removed. Nothing goes to any other
// project. docs/NOTICES_LITIGATION_POSITIONS.md §38.

import { PDFDocument } from 'pdf-lib';
import type { FileRef } from './claude.ts';
import { pageRanges, pagesToRead } from './pages.ts';
import { DocumentError, storageLocation, type Downloaded } from './pdf.ts';

/** The pages the CLI is given of one scan. */
export const SCAN_MAX_PAGES = 12;
/** The bucket a long scan's pages are put in while they are read. */
export const STAGING_BUCKET = 'ai-cli-temp';

export interface ScanDeps {
  supabaseUrl: string;
  storageKey?: string;
  fetchImpl?: typeof fetch;
}

export interface PreparedScan {
  file: FileRef;
  /** Removes a staged part (nothing for a file read where it is stored). */
  cleanup: () => Promise<void>;
}

/** The scan or photo as the gateway reads it; a long scan's pages staged first. */
export async function prepareScan(deps: ScanDeps, url: string, doc: Downloaded, pageCount: number | null): Promise<PreparedScan> {
  const at = storageLocation(url, deps.supabaseUrl);
  if (!at) throw new DocumentError('the document is not in the app\'s storage', 'document_url', false);
  if (doc.mediaType !== 'application/pdf') {
    const ext = doc.mediaType === 'image/png' ? 'png' : 'jpg';
    return {
      file: { ...at, filename: `page.${ext}`, mediaType: doc.mediaType, note: 'The document is a photograph or scan of a page, attached as an image: read it as you see it.' },
      cleanup: async () => {},
    };
  }
  let pdf: PDFDocument | null = null;
  let total = pageCount ?? 0;
  if (!total) {
    pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false });
    total = pdf.getPageCount();
  }
  if (total <= SCAN_MAX_PAGES) {
    return {
      file: { ...at, filename: 'document.pdf', mediaType: 'application/pdf', note: `The document is the attached PDF, a scan of ${total} page${total === 1 ? '' : 's'}: read its pages as you see them. Number the pages as the file does, the first page as 1.` },
      cleanup: async () => {},
    };
  }
  // A long scan: its first nine pages and its last three, in one PDF of their own.
  pdf ??= await PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = pagesToRead(total, SCAN_MAX_PAGES);
  // The attached file's page where the original's pages jump (its last pages begin).
  const jump = pages.findIndex((n, i) => i > 0 && n !== pages[i - 1] + 1);
  const part = await PDFDocument.create();
  for (const p of await part.copyPages(pdf, pages.map((n) => n - 1))) part.addPage(p);
  const bytes = await part.save();
  const path = `${crypto.randomUUID()}.pdf`;
  const f = deps.fetchImpl ?? fetch;
  const key = deps.storageKey ?? '';
  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  const up = await f(`${deps.supabaseUrl}/storage/v1/object/${STAGING_BUCKET}/${path}`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes as Uint8Array<ArrayBuffer>,
  });
  if (!up.ok) {
    await up.body?.cancel().catch(() => {});
    throw new DocumentError(`the long scan's pages could not be staged (HTTP ${up.status})`, 'staging', true);
  }
  await up.body?.cancel().catch(() => {});
  return {
    file: {
      bucket: STAGING_BUCKET, path, filename: 'document.pdf', mediaType: 'application/pdf',
      note: `The document is a scan of ${total} pages, too long to read whole: the attached PDF holds only its pages ${pageRanges(pages)}, in that order. `
        + `Give each page by the original's numbering (the attached file's page ${jump + 1} is the original's page ${pages[jump]}), and say nothing of the pages left out.`,
    },
    cleanup: async () => {
      await f(`${deps.supabaseUrl}/storage/v1/object/${STAGING_BUCKET}`, {
        method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }),
      }).then((r) => r.body?.cancel()).catch(() => {});
    },
  };
}

/** Removes staged parts a run that died left behind (older than an hour). */
export async function sweepStaging(deps: ScanDeps, now = Date.now()): Promise<number> {
  const f = deps.fetchImpl ?? fetch;
  const key = deps.storageKey ?? '';
  const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };
  try {
    const r = await f(`${deps.supabaseUrl}/storage/v1/object/list/${STAGING_BUCKET}`, {
      method: 'POST', headers, body: JSON.stringify({ prefix: '', limit: 100, sortBy: { column: 'created_at', order: 'asc' } }),
    });
    if (!r.ok) { await r.body?.cancel(); return 0; }
    const items = await r.json() as { name?: string; created_at?: string }[];
    const old = items.filter((o) => o.name && o.created_at && now - Date.parse(o.created_at) > 3_600_000).map((o) => o.name!);
    if (!old.length) return 0;
    const d = await f(`${deps.supabaseUrl}/storage/v1/object/${STAGING_BUCKET}`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: old }) });
    await d.body?.cancel();
    return d.ok ? old.length : 0;
  } catch {
    return 0;
  }
}
