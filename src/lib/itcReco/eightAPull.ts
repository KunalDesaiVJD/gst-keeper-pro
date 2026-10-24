// GSTR-9 Table 8A as the extension pulled it (0.18.0, mode gstr9_8a_pull):
// gst_filed_returns GSTR9_8A, summary format gstk-8a-pull-v1, holding what the
// portal handed back as it came: the file(s) of "Download Table 8A document
// details" (an Excel, or a ZIP of them) and any JSON with documents the page
// loaded. Read here with the Upload 8A reader (eightA.ts), into the stored 8A
// the reports read (sources.ts: Stored8A). Nothing is written back: the pull's
// row stays as the extension saved it, and is read again on every build.
// Positions: docs/GSTR8A_RECO_POSITIONS.md §2.
import JSZip from 'jszip';
import { parse8AFile, type Parsed8A } from './eightA';
import { EIGHT_A_FORMAT, isObj, type Stored8A, type Stored8ADoc } from './sources';

export const EIGHT_A_PULL_FORMAT = 'gstk-8a-pull-v1';

export interface Pulled8AFile { name: string | null; dataUrl: string; via: string; at: string }
export interface Pulled8A {
  _format: typeof EIGHT_A_PULL_FORMAT;
  fp: string;
  gstin: string | null;
  fy: string;
  pulledAt: string;
  files: Pulled8AFile[];
  json: { url: string; body: unknown }[];
  /** The portal said the year has no 8A documents. */
  empty?: boolean;
  /** What the extension did on the page, in words. */
  read: string;
}

export const isPulled8A = (v: unknown): v is Pulled8A =>
  isObj(v) && v._format === EIGHT_A_PULL_FORMAT && Array.isArray(v.files) && Array.isArray(v.json);

const bytesOf = (dataUrl: string): Uint8Array => {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;

/** One file of the pull → its parts read (an .xlsx is a ZIP too: one with [Content_Types].xml). */
async function readFile(f: Pulled8AFile, problems: string[]): Promise<Parsed8A[]> {
  const bytes = bytesOf(f.dataUrl);
  const name = f.name || 'Table 8A file';
  if (!isZip(bytes)) {
    try { return [parse8AFile(bytes, name)]; } catch (e) { problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return []; }
  }
  const zip = await JSZip.loadAsync(bytes);
  if (zip.file('[Content_Types].xml')) {
    try { return [parse8AFile(bytes, name)]; } catch (e) { problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); return []; }
  }
  const out: Parsed8A[] = [];
  const entries = Object.values(zip.files).filter((z) => !z.dir && /\.(xlsx|xls|json)$/i.test(z.name));
  if (!entries.length) problems.push(`${name}: the ZIP holds no Excel or JSON (${Object.keys(zip.files).join(', ') || 'empty'}).`);
  for (const z of entries) {
    try { out.push(parse8AFile(await z.async('uint8array'), z.name)); } catch (e) { problems.push(`${z.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}

const docKey = (d: Stored8ADoc) => [d.section, d.ctin, d.number.toUpperCase(), d.date ?? '', d.family].join('|');

export interface Read8APull {
  /** The stored 8A, or null when nothing could be read (then the reports rebuild the 8A). */
  stored: Stored8A | null;
  /** What could not be read, in words. */
  problems: string[];
}

/**
 * The pulled 8A → the stored 8A. Every file part and every JSON with documents
 * is read and the documents put together, a document listed twice counted
 * once. Refused (null, with the reason) when the file names another GSTIN.
 */
export async function read8APull(p: Pulled8A, want: { gstin: string | null; fy: string }): Promise<Read8APull> {
  const problems: string[] = [];
  const parts: Parsed8A[] = [];
  for (const f of p.files) {
    try { parts.push(...(await readFile(f, problems))); } catch (e) { problems.push(`${f.name || 'Table 8A file'}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const j of p.json) {
    const body = isObj(j.body) && isObj(j.body.data) ? j.body.data : j.body;
    try { parts.push(parse8AFile(new TextEncoder().encode(JSON.stringify(body)), j.url.split('?')[0])); } catch { /* a JSON of another kind */ }
  }
  if (!parts.length && !p.empty) return { stored: null, problems: problems.length ? problems : ['the pull saved nothing readable'] };
  const gstin = (want.gstin ?? '').toUpperCase();
  const other = parts.find((x) => x.stored.gstin && gstin && x.stored.gstin !== gstin);
  if (other) return { stored: null, problems: [`the pulled 8A file is for GSTIN ${other.stored.gstin}, not ${gstin}`] };
  const seen = new Set<string>();
  const docs: Stored8ADoc[] = [];
  for (const x of parts) for (const d of x.stored.docs) { const k = docKey(d); if (!seen.has(k)) { seen.add(k); docs.push(d); } }
  const first = parts[0]?.stored;
  return {
    stored: {
      _format: EIGHT_A_FORMAT,
      origin: first?.origin ?? 'portal-excel',
      via: 'pull',
      fy: want.fy,
      gstin: first?.gstin ?? p.gstin,
      generatedOn: parts.map((x) => x.stored.generatedOn).find(Boolean) ?? null,
      fileName: parts.map((x) => x.stored.fileName).filter(Boolean).join(', ') || null,
      uploadedAt: p.pulledAt,
      uploadedBy: null,
      sheetsRead: [...new Set(parts.flatMap((x) => x.stored.sheetsRead))],
      unread: [...new Set(parts.flatMap((x) => x.stored.unread))],
      warnings: [...parts.flatMap((x) => x.stored.warnings), ...problems],
      docs,
    },
    problems,
  };
}
