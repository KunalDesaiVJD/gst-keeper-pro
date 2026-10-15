// What every Reports Hub export needs to know about a ReportTable before it is
// drawn, decided once here so the Excel (excel.ts) and the PDF (pdf.ts) agree:
// the identification strip, the kind of each column (amount, count, rate, date,
// link, text), the kind of each row (data, TOTAL, period band, section,
// blank), the display text of a figure, and the house palette. Pure: no
// ExcelJS, no jsPDF, no DOM, so scripts can test it under Node.
//
// House style (the firm's Big4-style working papers, as in
// src/lib/gstr9/export/excel.ts and src/utils/reportTheme.ts): Arial / Helvetica
// 9, navy table heads, hairline grey rules, figures right-aligned as
// 1,23,456.00 with negatives in brackets and nil as a dash, totals bold with a
// rule above and a double rule below, status carried by a word (a tint only
// helps), identification strip under the title, page x of y in the footer.
import type {
  ColumnGroup, ReportKpi, ReportMetaField, ReportSheet, ReportSummary, ReportTable, RowKind, RowTone,
} from '@/utils/allClientsReports';

export const FIRM = {
  name: 'V. J. Desai & Co. LLP',
  designation: 'Chartered Accountants',
  email: 'gst@vjdesai.com',
  footer: "For the client's internal use",
};

/** ARGB for ExcelJS; rgb() gives the jsPDF triple. */
export const PALETTE = {
  navy: 'FF1F3864',
  navyLight: 'FF2F5496',
  band: 'FFD9E1F2',
  bandSoft: 'FFEEF2F9',
  zebra: 'FFF7F9FC',
  grid: 'FFBFBFBF',
  rule: 'FF000000',
  ink: 'FF000000',
  inkSoft: 'FF404040',
  muted: 'FF808080',
  white: 'FFFFFFFF',
  link: 'FF1F4E9E',
} as const;

/** Status tints: fill behind the status cell, and the ink for the word in it. */
export const TONE: Record<RowTone, { fill: string; ink: string }> = {
  good: { fill: 'FFE2EFDA', ink: 'FF375623' },
  warn: { fill: 'FFFFF2CC', ink: 'FF7F6000' },
  bad: { fill: 'FFF8D7DA', ink: 'FF9C0006' },
  info: { fill: 'FFDDEBF7', ink: 'FF1F3864' },
  muted: { fill: 'FFEDEDED', ink: 'FF595959' },
};

export const rgb = (argb: string): [number, number, number] => {
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
};

/** Excel number formats. */
export const FMT = {
  amount: '#,##0.00_);(#,##0.00);"–"_)',
  int: '#,##0_);(#,##0);"–"_)',
  rate: '0.00"%";-0.00"%";"–"',
  date: 'dd-mmm-yyyy',
} as const;

export type ColumnKind = 'amount' | 'int' | 'rate' | 'date' | 'url' | 'text';

export interface ColumnSpec {
  index: number;
  header: string;
  /** What is printed in the header cell (headerLabels, else the header). */
  label: string;
  kind: ColumnKind;
  /** Excel width in characters. */
  width: number;
  align: 'left' | 'right' | 'center';
  /** Wrap long text (reasons, remarks); figures and codes never wrap. */
  wrap: boolean;
}

export interface TableLayout {
  title: string;
  headers: string[];
  columns: ColumnSpec[];
  groups: ColumnGroup[] | null;
  rows: (string | number)[][];
  kinds: RowKind[];
  tones: (RowTone | null)[];
  toneColumn: number;
  notes: string[];
}

// ── Rows ───────────────────────────────────────────────────────────────────

const TOTAL_RE = /^(grand\s+)?total(\s*\(.+\))?$|^total\s+(for|of)\b/i;
const SUBTOTAL_RE = /^sub[\s-]?total\b/i;
const PERIOD_RE = /^— .+ —$/;

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** The row kind by its cells (used when the table gives none). */
export function guessRowKind(row: (string | number)[]): RowKind {
  if (!row.length || row.every((c) => text(c) === '')) return 'blank';
  const first = text(row[0]);
  const rest = row.slice(1);
  if (PERIOD_RE.test(first) && rest.every((c) => text(c) === '')) return 'period';
  // A TOTAL label sits in one of the first three cells (Sr / Name / GSTIN layouts).
  const head = row.slice(0, 3).map(text);
  if (head.some((c) => SUBTOTAL_RE.test(c))) return 'subtotal';
  if (head.some((c) => TOTAL_RE.test(c))) return 'total';
  // A lone label with nothing else: a section heading (e.g. "Table 4(A)").
  if (first && typeof row[0] === 'string' && rest.length >= 2 && rest.every((c) => text(c) === '')) return 'section';
  return 'data';
}

export const rowKindsOf = (rows: (string | number)[][], given?: (RowKind | null)[]): RowKind[] =>
  rows.map((r, i) => given?.[i] ?? guessRowKind(r));

// ── Columns ────────────────────────────────────────────────────────────────

const INT_HEADER_RE = /^(#|sr\.?|s\.?\s?no\.?|sl\.?\s?no\.?|no\.|count|documents?|docs|records|rows|invoices|notices|clients|suppliers|months|days|number of|no\. of)\b/i;
const RATE_HEADER_RE = /(^|\b)(rate|%|percent|percentage)(\b|$)/i;
const AMOUNT_HEADER_RE = /value|amount|igst|cgst|sgst|cess|tax|total|itc|liability|payable|paid|balance|debit|credit|interest|fee|penalty|refund|turnover|difference|diff|closing|opening|cash|utili[sz]ed|claimed/i;
const DATE_RE = /^(\d{1,2}[-/.](\d{1,2}|[A-Za-z]{3})[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})(T[\d:.]+Z?)?$/;
const URL_RE = /^https?:\/\//i;
const LONG_TEXT_HEADER_RE = /reason|remark|note|what to do|action|evidence|description|narration|particulars|cause|comment|detail|address|subject/i;

/** Parse a date cell (DD-MM-YYYY, DD/MM/YYYY, DD-Mon-YYYY, YYYY-MM-DD) to a UTC Date, or null. */
export function parseDateCell(v: unknown): Date | null {
  const s = text(v);
  if (!s || !DATE_RE.test(s)) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return utc(+iso[1], +iso[2], +iso[3]);
  const m = /^(\d{1,2})[-/.](\d{1,2}|[A-Za-z]{3})[-/.](\d{2,4})/.exec(s);
  if (!m) return null;
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = /^\d+$/.test(m[2]) ? +m[2] : MON.indexOf(m[2].toLowerCase()) + 1;
  let year = +m[3];
  if (year < 100) year += 2000;
  return utc(year, month, +m[1]);
}
const utc = (y: number, m: number, d: number): Date | null => {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? dt : null;
};

/** The kind of every column, from the header and the data rows' values. */
export function classifyColumns(headers: string[], rows: (string | number)[][], kinds: RowKind[], widths?: number[], labels?: string[]): ColumnSpec[] {
  const data = rows.filter((_, i) => kinds[i] === 'data');
  return headers.map((header, index) => {
    const values = data.map((r) => r[index]).filter((v) => text(v) !== '' && text(v) !== '—' && text(v) !== '-');
    const numbers = values.filter((v) => typeof v === 'number');
    const strings = values.filter((v): v is string => typeof v === 'string');
    let kind: ColumnKind = 'text';
    if (values.length && strings.length && strings.every((s) => URL_RE.test(s))) kind = 'url';
    else if (numbers.length && numbers.length >= strings.length) {
      if (RATE_HEADER_RE.test(header) && !AMOUNT_HEADER_RE.test(header.replace(/rate/i, ''))) kind = 'rate';
      else if (INT_HEADER_RE.test(header.trim()) && numbers.every((n) => Number.isInteger(n))) kind = 'int';
      else if (numbers.every((n) => Number.isInteger(n)) && !AMOUNT_HEADER_RE.test(header) && numbers.every((n) => Math.abs(n) < 100000)) kind = 'int';
      else kind = 'amount';
    } else if (strings.length && strings.every((s) => parseDateCell(s) !== null)) kind = 'date';
    const label = labels?.[index] || header;
    const longest = Math.max(label.length * 0.9, ...values.slice(0, 400).map((v) => (typeof v === 'number' ? fmtNumber(v, kind).length : String(v).length)));
    const given = widths?.[index];
    const width = kind === 'amount' ? Math.max(given ?? 0, Math.min(16, Math.max(11, longest + 2)))
      : kind === 'int' || kind === 'rate' ? Math.max(given ?? 0, Math.min(10, Math.max(6, longest + 2)))
        : kind === 'date' ? Math.max(given ?? 0, 11.5)
          : kind === 'url' ? 11
            : Math.max(6, Math.min(given ?? Math.min(40, longest + 2), 60));
    const wrap = kind === 'text' && (LONG_TEXT_HEADER_RE.test(header) || longest > width + 4);
    return {
      index, header, label, kind, width,
      align: kind === 'amount' || kind === 'int' || kind === 'rate' ? 'right' : kind === 'url' ? 'center' : 'left',
      wrap,
    };
  });
}

// ── Figures as text (PDF, previews) ────────────────────────────────────────

const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** 1,23,456.00 · (1,234.50) for a negative · – for nil; counts without decimals; rates with %. */
export function fmtNumber(v: number, kind: ColumnKind = 'amount'): string {
  if (!Number.isFinite(v)) return '';
  const r = Math.round(v * 100) / 100;
  if (Math.abs(r) < 0.005) return '–';
  if (kind === 'int') return r < 0 ? `(${INR0.format(-r)})` : INR0.format(r);
  if (kind === 'rate') return `${r.toFixed(2)}%`;
  return r < 0 ? `(${INR2.format(-r)})` : INR2.format(r);
}

/** dd-Mon-yyyy for a date cell; the text itself otherwise. */
export function fmtDate(v: unknown): string {
  const d = parseDateCell(v);
  if (!d) return text(v);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

export function cellText(v: string | number | null | undefined, col: ColumnSpec | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNumber(v, col?.kind === 'int' || col?.kind === 'rate' ? col.kind : 'amount');
  if (col?.kind === 'date') return fmtDate(v);
  return String(v);
}

// ── Identification strip ───────────────────────────────────────────────────

const MONTH_LABEL_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s-]+\d{2,4}$/i;
const FY_RE = /^(fy|f\.y\.?)\s*\d{4}/i;

/**
 * The strip under the title: the table's own `meta`, else the subtitle's
 * "Label: value" segments (split on "|"); a bare month or FY becomes Period /
 * Financial year. The rest of the subtitle is returned as a line of text.
 */
export function metaOf(table: Pick<ReportTable, 'subtitle' | 'meta'>): { fields: ReportMetaField[]; rest: string } {
  const segments = (table.subtitle || '').split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (table.meta?.length) return { fields: table.meta, rest: '' };
  const fields: ReportMetaField[] = [];
  const rest: string[] = [];
  for (const seg of segments) {
    const m = /^([A-Za-z][A-Za-z0-9 .()/&-]{0,28}):\s+(.+)$/.exec(seg);
    if (m && !/https?$/i.test(m[1])) fields.push({ label: m[1].trim(), value: m[2].trim() });
    else if (MONTH_LABEL_RE.test(seg)) fields.push({ label: 'Period', value: seg });
    else if (FY_RE.test(seg)) fields.push({ label: 'Financial year', value: seg.replace(/^(fy|f\.y\.?)\s*/i, 'FY ') });
    else rest.push(seg);
  }
  return { fields, rest: rest.join('  ·  ') };
}

// ── Layouts ────────────────────────────────────────────────────────────────

const STATUS_HEADER_RE = /^status$/i;

/** Everything needed to draw one table (the main rows, the summary or an extra sheet). */
export function layoutOf(t: ReportSummary | ReportSheet | (ReportTable & { notes?: string[] }), title?: string): TableLayout {
  const kinds = rowKindsOf(t.rows, t.rowKinds);
  const columns = classifyColumns(t.headers, t.rows, kinds, t.columnWidths, t.headerLabels);
  const groups = t.columnGroups && t.columnGroups.reduce((s, g) => s + g.span, 0) === t.headers.length ? t.columnGroups : null;
  const toneColumn = t.toneColumn ?? t.headers.findIndex((h) => STATUS_HEADER_RE.test(h.trim()));
  return {
    title: title ?? ('title' in t ? t.title : ''),
    headers: t.headers,
    columns,
    groups,
    rows: t.rows,
    kinds,
    tones: t.rows.map((_, i) => t.rowTones?.[i] ?? null),
    toneColumn,
    notes: ('notes' in t && t.notes) || [],
  };
}

/** The main table, projected onto `cols` (the PDF's pdfColumns), keeping groups that still add up. */
export function project(l: TableLayout, cols: number[] | undefined): TableLayout {
  const keep = (cols || []).filter((i) => i >= 0 && i < l.headers.length);
  if (!keep.length) return l;
  // Groups survive the projection as the run of kept columns under each.
  let groups: ColumnGroup[] | null = null;
  if (l.groups) {
    const owner: number[] = [];
    l.groups.forEach((g, gi) => { for (let k = 0; k < g.span; k++) owner.push(gi); });
    groups = [];
    for (const i of keep) {
      const gi = owner[i];
      const last = groups[groups.length - 1];
      if (last && (last as ColumnGroup & { gi?: number }).gi === gi) last.span += 1;
      else groups.push({ ...l.groups[gi], span: 1, gi } as ColumnGroup & { gi: number });
    }
    groups = groups.map(({ label, span, tone }) => ({ label, span, ...(tone ? { tone } : {}) }));
  }
  return {
    ...l,
    headers: keep.map((i) => l.headers[i]),
    columns: keep.map((i, k) => ({ ...l.columns[i], index: k })),
    groups,
    rows: l.rows.map((r) => keep.map((i) => r[i] ?? '')),
    toneColumn: keep.indexOf(l.toneColumn),
  };
}

/** Sheet names: ≤ 31 characters, none of []:*?/\ and unique within the workbook. */
export function sheetName(name: string, used: Set<string>): string {
  const base = (name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  used.add(out.toLowerCase());
  return out;
}

/** "Prepared 15-Oct-2026 14:05" in India time, whatever the machine's zone. */
export function preparedStamp(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60_000);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ist.getDate())}-${MON[ist.getMonth()]}-${ist.getFullYear()} ${p(ist.getHours())}:${p(ist.getMinutes())} IST`;
}

/** KPIs as printed: a number in the house figure style, text as is. */
export const kpiText = (k: ReportKpi): string => (typeof k.value === 'number' ? fmtNumber(k.value, Number.isInteger(k.value) && Math.abs(k.value) < 1e6 && !/tax|value|itc|amount|difference|₹/i.test(k.label) ? 'int' : 'amount') : k.value);

/** A safe file name base. */
export const fileBase = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'Report';
