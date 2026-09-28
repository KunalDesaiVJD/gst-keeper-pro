// Helpers for the Annual Return "Portal data" step: human labels for portal
// field paths (the import preview and the entry grids), turning what the
// portal returned into the preview's incoming set, file reading for uploads,
// and hand edits (which mark a figure as typed so a later import never
// overwrites it silently).
//
// Everything here reads only what the GST portal returned — the GSTR-9
// system-computed JSON and the as-filed GSTR-3B the extension saved in
// gst_filed_returns — never the app's own GSTR-1 / GSTR-3B
// (docs/GSTR9_9C_WORKINGS.md §5). No tax arithmetic lives here: the engine
// computes every figure; this only moves portal numbers into PortalDoc.

import { MONTH_LABEL, T4_ROWS } from './engine';
import { gstr9Fp, monthKeyForPeriod, parseGstr3bSummary, periodsForFY, portalPathLabel, setPath, unwrap } from './portalParser';
import type { ParsedGstr9 } from './portalParser';
import type { AsFiledReturn } from './store';
import { FY_MONTHS } from './types';
import type { Formulas, MonthKey, PortalDoc, PortalGstr9, PortalMeta, PortalMonth, T5Key, Table9Head } from './types';

// ---------------------------------------------------------------------------
// Row / field labels (wording follows the GSTR-9 form and the firm's sheet)
// ---------------------------------------------------------------------------

export const HEAD_NAME: Record<string, string> = { t: 'Value', i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };

/** Table 5 rows in form order (value only). */
export const T5_ROWS: Array<{ key: T5Key; table: string; label: string }> = [
  { key: 'zero_rtd', table: '5A', label: 'Zero rated supply (export) without payment of tax' },
  { key: 'sez', table: '5B', label: 'Supply to SEZs without payment of tax' },
  { key: 'rchrg', table: '5C', label: 'Tax to be paid by the recipient on reverse charge' },
  { key: 'ecom_14', table: '5C1', label: 'Tax to be paid by e-commerce operator u/s 9(5)' },
  { key: 'exmt', table: '5D', label: 'Exempted' },
  { key: 'nil', table: '5E', label: 'Nil rated' },
  { key: 'non_gst', table: '5F', label: "Non-GST supply (includes 'no supply')" },
  { key: 'cr_nt', table: '5H', label: 'Credit notes (−)' },
  { key: 'dr_nt', table: '5I', label: 'Debit notes (+)' },
  { key: 'amd_pos', table: '5J', label: 'Supplies declared through amendments (+)' },
  { key: 'amd_neg', table: '5K', label: 'Supplies reduced through amendments (−)' },
];

/** The ITC figures the portal fills (Tables 6 and 8). */
export const ITC_ROWS = (financialYear: string): Array<{ key: 't6A' | 't6G' | 't8A'; table: string; label: string }> => [
  { key: 't6A', table: '6A', label: 'ITC availed through GSTR-3B (sum of Table 4A)' },
  { key: 't6G', table: '6G', label: 'ITC received from ISD' },
  {
    key: 't8A',
    table: '8A',
    label: Number(financialYear.slice(0, 4)) < 2023 ? 'ITC as per GSTR-2A (Table 3 & 5)' : 'ITC as per GSTR-2B [Table 3(I)]',
  },
];

export type Table9RowKey = Table9Head | 'interest' | 'lateFee' | 'penalty' | 'other';

/** Table 9 rows in form order (9A–9H). */
export const T9_ROWS: Array<{ key: Table9RowKey; code: string; label: string; tax: boolean }> = [
  { key: 'igst', code: 'A', label: 'Integrated Tax', tax: true },
  { key: 'cgst', code: 'B', label: 'Central Tax', tax: true },
  { key: 'sgst', code: 'C', label: 'State/UT Tax', tax: true },
  { key: 'cess', code: 'D', label: 'Cess', tax: true },
  { key: 'interest', code: 'E', label: 'Interest', tax: false },
  { key: 'lateFee', code: 'F', label: 'Late fee', tax: false },
  { key: 'penalty', code: 'G', label: 'Penalty', tax: false },
  { key: 'other', code: 'H', label: 'Other', tax: false },
];

const T9_FIELD: Record<string, string> = {
  payable: 'Tax payable',
  cash: 'Paid through cash',
  itcI: 'Paid through ITC — IGST',
  itcC: 'Paid through ITC — CGST',
  itcS: 'Paid through ITC — SGST',
  itcX: 'Paid through ITC — Cess',
};

/** The as-filed GSTR-3B quantities kept per month, with what each one is. */
export const MONTH_FIELDS: Array<{ key: keyof PortalMonth; label: string; short: string; explain: string }> = [
  { key: 'outTax', label: 'Output tax 3.1(a)+(b)', short: 'Output tax', explain: '3.1(a) + 3.1(b) tax → Duties & Taxes-Output "AS PER 3B"' },
  { key: 'itcExclRcm', label: 'ITC excl. RCM', short: 'ITC excl. RCM', explain: '4A(1) + 4A(4) + 4A(5) − 4B(1) − 4B(2) → Duties & Taxes-Input "AS PER 3B"' },
  { key: 'rcm', label: 'RCM 3.1(d)', short: 'RCM 3.1(d)', explain: 'Inward supplies liable to reverse charge → RCM Part A and GSTR-9 4G' },
  { key: 'itc4aTotal', label: '4A total', short: '4A total', explain: 'All five rows of 4A → GSTR-9 6A when no GSTR-9 JSON is applied' },
  { key: 'itc4a5', label: '4A(5) all other ITC', short: '4A(5)', explain: 'All other ITC → Notice format "ITC used as per 4A(5)"' },
  { key: 'itc4b1', label: '4B(1) reversal (Rules 38/42/43, s.17(5))', short: '4B(1)', explain: 'Reversed as per rules / s.17(5) → GSTR-9 7E unless typed there' },
  { key: 'itc4b2', label: '4B(2) other reversal', short: '4B(2)', explain: 'Other reversal → Notice format "Reversed in 4(B)(2)"' },
  { key: 'itc4d', label: '4D ineligible ITC', short: '4D', explain: 'Ineligible ITC → Notice format "Ineligible ITC as per 4(D)"' },
];

/** "Apr 2024" for a month of the FY. */
export const monthTitle = (m: MonthKey, financialYear: string): string => {
  const idx = FY_MONTHS.indexOf(m);
  const period = periodsForFY(financialYear)[idx] ?? '';
  return `${MONTH_LABEL[m]} ${period.slice(3)}`.trim();
};

export interface FieldInfo {
  /** Groups rows in the preview (one per table / month). */
  group: string;
  groupLabel: string;
  label: string;
}

/** Where a portal field path lives and what it is called, e.g. "gstr9.table4.b2b.c" → Table 4 · "4B B2B · CGST". */
export function describePath(path: string, financialYear: string): FieldInfo {
  const p = path.split('.');
  const head = (k: string | undefined) => (k ? HEAD_NAME[k] ?? k : '');
  if (p[0] === 'months') {
    const m = p[1] as MonthKey;
    const f = MONTH_FIELDS.find((x) => x.key === p[2]);
    return {
      group: `months.${m}`,
      groupLabel: MONTH_LABEL[m] ? monthTitle(m, financialYear) : m,
      label: `${f?.label ?? p[2]} · ${head(p[3])}`,
    };
  }
  if (p[0] === 'gstr9') {
    if (p[1] === 'table4') {
      const r = T4_ROWS.find((x) => x.key === p[2]);
      return { group: 'gstr9.table4', groupLabel: 'Table 4 — supplies on which tax is payable', label: `${r ? `${r.table} ${r.label}` : p[2]} · ${head(p[3])}` };
    }
    if (p[1] === 'table5') {
      const r = T5_ROWS.find((x) => x.key === p[2]);
      return { group: 'gstr9.table5', groupLabel: 'Table 5 — supplies on which tax is not payable', label: `${r ? `${r.table} ${r.label}` : p[2]} · Value` };
    }
    if (p[1] === 't6A' || p[1] === 't6G' || p[1] === 't8A') {
      const r = ITC_ROWS(financialYear).find((x) => x.key === p[1]);
      return { group: 'gstr9.itc', groupLabel: 'Tables 6 and 8 — ITC', label: `${r ? `${r.table} ${r.label}` : p[1]} · ${head(p[2])}` };
    }
    if (p[1] === 'table9') {
      const r = T9_ROWS.find((x) => x.key === p[2]);
      return { group: 'gstr9.table9', groupLabel: 'Table 9 — tax paid', label: `9${r?.code ?? ''} ${r?.label ?? p[2]} · ${T9_FIELD[p[3]] ?? p[3]}` };
    }
  }
  return { group: 'other', groupLabel: 'Other', label: portalPathLabel(path) };
}

// ---------------------------------------------------------------------------
// Hand edits
// ---------------------------------------------------------------------------

export interface FieldEdit {
  /** Path under PortalDoc, e.g. "gstr9.table4.b2b.c" or "months.apr.outTax.i". */
  path: string;
  value: number;
  /** The "=a+b" expression typed, remembered like Excel; null/undefined = a plain number. */
  formula?: string | null;
}

/** Expressions typed into the portal grids, keyed by field path (PortalDoc.f). */
export const portalFormulas = (doc: PortalDoc): Formulas => doc.f ?? {};

/** Drop remembered expressions for figures an import has just replaced. */
export function clearFormulas(doc: PortalDoc, paths: string[]): PortalDoc {
  const cur = portalFormulas(doc);
  if (!paths.some((p) => p in cur)) return doc;
  const f = { ...cur };
  paths.forEach((p) => { delete f[p]; });
  return { ...doc, f };
}

/**
 * Apply figures typed by hand: set each value, mark its path as typed
 * (PortalDoc.manual) and, where nothing was fetched yet, set the section's
 * source to "manual" so the chip reads "Typed".
 */
export function applyHandEdits(doc: PortalDoc, edits: FieldEdit[]): PortalDoc {
  if (!edits.length) return doc;
  let next = doc;
  const manual = { ...doc.manual };
  const f = { ...portalFormulas(doc) };
  const months = new Set<MonthKey>();
  let gstr9 = false;
  edits.forEach((e) => {
    next = setPath(next, e.path, e.value);
    manual[e.path] = true;
    if (e.formula) f[e.path] = e.formula;
    else delete f[e.path];
    const [root, sub] = e.path.split('.');
    if (root === 'months' && (FY_MONTHS as readonly string[]).includes(sub)) months.add(sub as MonthKey);
    if (root === 'gstr9') gstr9 = true;
  });
  let gstr9Meta = next.gstr9Meta;
  if (gstr9 && !gstr9Meta?.source) gstr9Meta = { ...gstr9Meta, source: 'manual' };
  let monthMeta = next.monthMeta;
  months.forEach((m) => {
    if (!monthMeta[m]?.source) monthMeta = { ...monthMeta, [m]: { ...monthMeta[m], source: 'manual' } };
  });
  return { ...next, manual, gstr9Meta, monthMeta, f };
}

/** Number of typed figures under a path prefix ("months.apr." / "gstr9."). */
export const typedCount = (doc: PortalDoc, prefix: string): number =>
  Object.keys(doc.manual || {}).filter((k) => k.startsWith(prefix)).length;

// ---------------------------------------------------------------------------
// GSTR-9 system-computed → incoming
// ---------------------------------------------------------------------------

export const GSTR9_COVERAGE: Array<{ key: keyof ParsedGstr9['found']; label: string }> = [
  { key: 'table4', label: 'Table 4' },
  { key: 'table5', label: 'Table 5' },
  { key: 't6A', label: '6A' },
  { key: 't6G', label: '6G' },
  { key: 't8A', label: '8A' },
  { key: 'table9', label: 'Table 9' },
];

/**
 * Only the parts the portal actually returned — a table missing from the file
 * is left alone in the working instead of being proposed as zero.
 */
export function gstr9Incoming(parsed: ParsedGstr9): Partial<PortalDoc> {
  const g: Partial<PortalGstr9> = {};
  if (parsed.found.table4) g.table4 = parsed.gstr9.table4;
  if (parsed.found.table5) g.table5 = parsed.gstr9.table5;
  if (parsed.found.t6A) g.t6A = parsed.gstr9.t6A;
  if (parsed.found.t6G) g.t6G = parsed.gstr9.t6G;
  if (parsed.found.t8A) g.t8A = parsed.gstr9.t8A;
  if (parsed.found.table9) g.table9 = parsed.gstr9.table9;
  return { gstr9: g as PortalGstr9 };
}

/** "03/2025" — the period the GSTR-9 raw copy is keyed by in gst_filed_returns. */
export const gstr9Period = (financialYear: string): string => {
  const fp = gstr9Fp(financialYear);
  return `${fp.slice(0, 2)}/${fp.slice(2)}`;
};

/** ARN and ARN date when the system-computed JSON carries them (filed returns). */
export function gstr9RawMeta(raw: unknown): { arn: string | null; filedDate: string | null } {
  const d = unwrap(raw, ['table4', 'table6', 'table9']);
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { arn: s(d?.arn), filedDate: s(d?.arn_dt) };
}

/**
 * Blocks an upload that belongs to another client or year. Returns the
 * message to show, or null when the file matches (or doesn't say).
 */
export function gstr9FileMismatch(parsed: ParsedGstr9, clientGstin: string, financialYear: string): string | null {
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  if (parsed.gstin && clientGstin && norm(parsed.gstin) !== norm(clientGstin)) {
    return `This file is for GSTIN ${parsed.gstin}, but the open client is ${clientGstin}. Nothing was imported.`;
  }
  if (parsed.fp) {
    const want = gstr9Fp(financialYear);
    const digits = parsed.fp.replace(/\D/g, '');
    let ok = true;
    // "032025" is a return period (MMYYYY); "2024-25", "202425", "2024-2025" are an FY.
    if (/^(0[1-9]|1[0-2])\d{4}$/.test(digits)) ok = digits === want;
    else if (/^\d{4}-?\d{2}(\d{2})?$/.test(parsed.fp.trim())) ok = digits.slice(0, 4) === financialYear.slice(0, 4);
    if (!ok) {
      return `This file is for return period ${parsed.fp}, but FY ${financialYear} is period ${want.slice(0, 2)}/${want.slice(2)}. Nothing was imported.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// As-filed GSTR-3B → incoming
// ---------------------------------------------------------------------------

export const isPullFailed = (status: string | null | undefined): boolean => !!status && /^PULL FAILED/i.test(status.trim());
/** The portal's own code for an unfiled month is "NF" (what the extension stores as-is). */
export const isNotFiled = (status: string | null | undefined): boolean => !!status && /^(NF$|NOT (FILED|FOUND|GENERATED))/i.test(status.trim());

/** The row carries a GSTR-3B summary the parser can read. */
export const has3bSummary = (r: AsFiledReturn | null | undefined): boolean => !!r && !!unwrap(r.summary, ['sup_details', 'itc_elg']);

export interface Gstr3bImport {
  incoming: Partial<PortalDoc>;
  metas: Partial<Record<MonthKey, PortalMeta>>;
  months: MonthKey[];
}

/** Every pulled month with a usable summary, parsed, in FY order. */
export function gstr3bIncoming(rows: AsFiledReturn[], financialYear: string): Gstr3bImport {
  const byMonth = new Map<MonthKey, AsFiledReturn>();
  rows.forEach((r) => {
    const m = monthKeyForPeriod(r.period, financialYear);
    // An unfiled month's figures (a saved draft, if the portal returns one) are not as-filed.
    if (m && has3bSummary(r) && !isNotFiled(r.status)) byMonth.set(m, r);
  });
  const months: Partial<Record<MonthKey, PortalMonth>> = {};
  const metas: Partial<Record<MonthKey, PortalMeta>> = {};
  const list: MonthKey[] = [];
  FY_MONTHS.forEach((m) => {
    const r = byMonth.get(m);
    if (!r) return;
    months[m] = parseGstr3bSummary(r.summary);
    metas[m] = {
      source: 'as_filed_3b',
      arn: r.arn,
      filedDate: r.filedDate,
      fetchedAt: r.updatedAt,
      // A later failed re-pull only rewrites the status; the summary is still the filed one.
      status: isPullFailed(r.status) || isNotFiled(r.status) ? null : r.status,
    };
    list.push(m);
  });
  return { incoming: { months: months as Record<MonthKey, PortalMonth> }, metas, months: list };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export const timeOf = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** The pulled row is newer than what the working last applied. */
export const newerThanApplied = (rowUpdatedAt: string | null | undefined, meta: PortalMeta | null | undefined): boolean =>
  timeOf(rowUpdatedAt) > timeOf(meta?.fetchedAt ?? null) + 500;

export const fmtWhen = (iso: string | null | undefined): string => {
  const t = timeOf(iso);
  if (!t) return '';
  return new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
};

// ---------------------------------------------------------------------------
// Upload: .json, or the first .json inside a .zip
// ---------------------------------------------------------------------------

export async function readPortalJsonFile(file: File): Promise<{ raw: unknown; name: string }> {
  const lower = file.name.toLowerCase();
  let text: string;
  let name = file.name;
  if (lower.endsWith('.zip') || /zip/.test(file.type)) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file);
    const entry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith('.json'));
    if (!entry) throw new Error(`${file.name} has no .json file inside.`);
    text = await entry.async('string');
    name = entry.name;
  } else {
    text = await file.text();
  }
  try {
    return { raw: JSON.parse(text.replace(/^\uFEFF/, '')), name };
  } catch {
    throw new Error(`${name} is not a valid JSON file.`);
  }
}

/** Compare dotted versions ("0.3.3"): negative when a < b. */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
