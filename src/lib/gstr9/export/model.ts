// The Annual Return working papers as a renderer-agnostic model: a list of
// papers (one Excel sheet / one PDF section each), each a header block plus a
// sequence of blocks — headings, notes and tables whose rows carry a kind
// (data, band, subtotal, total). papers.ts builds it from the engine's
// figures; excel.ts and pdf.ts only lay it out. Nothing here computes tax.

import type { ChangeLogEntry } from '../audit';
import type { Workings } from '../engine';
import type { Drc03Filing, SetOff } from '../payables';
import type { AnnualReturnPeriod } from '../store';
import type { AnnualReturnDocs } from '../types';

export const FIRM_NAME = 'V. J. Desai & Co. LLP';

export interface ExportMeta {
  clientName: string;
  gstin: string;
  financialYear: string;
  /** "Locked by … on …", "In progress" or "Not started" — printed in headers and footers when given. */
  status?: string;
}

/** Everything the working papers are built from — all of it as saved (ExportMenu flushes first). */
export interface WorkingPapersInput {
  docs: AnnualReturnDocs;
  workings: Workings;
  meta: ExportMeta;
  period: AnnualReturnPeriod | null;
  /** The set-off register, removed entries included. */
  setOffs: SetOff[];
  /** The client's DRC-03s synced from the portal (all years; the papers keep this FY's). */
  drc03s: Drc03Filing[];
  /** The full revision log, oldest first. */
  changeLog: ChangeLogEntry[];
  /** Print time (defaults to now) — fixed in tests. */
  printedAt?: Date;
}

// ---------------------------------------------------------------------------
// Cells, rows, blocks
// ---------------------------------------------------------------------------

/** Where a figure comes from — typed by staff (blue), fetched from the portal (green), computed (black). */
export type Src = 'typed' | 'portal' | 'computed';
/** money = 2 decimals, negatives in brackets, zero as a dash; rate = "18.00%"; int = as is. */
export type NumFmt = 'money' | 'rate' | 'int';

export interface WpCell {
  v: string | number | null | undefined;
  fmt?: NumFmt;
  src?: Src;
  /** Cell comment (Excel) — the "=a+b" staff typed. */
  note?: string;
  /** Internal link to another paper (its sheet name) or an external URL. */
  link?: { sheet: string } | { url: string };
  bold?: boolean;
  italic?: boolean;
  muted?: boolean;
  strike?: boolean;
  /** Status fill: reason needed / justified / matched. */
  fill?: 'bad' | 'info' | 'good';
  align?: 'left' | 'center' | 'right';
  /** Columns this cell covers. */
  span?: number;
  /** Header rows this cell covers (table heads only). */
  rowSpan?: number;
  /** A tick / cross (✓ / ✗): drawn with a symbol font in the PDF. */
  tick?: boolean;
}

export type Cell = WpCell | string | number | null | undefined;

export type RowKind = 'data' | 'subtotal' | 'total' | 'band';

export interface WpRow {
  kind: RowKind;
  cells: Cell[];
  /** Greyed and struck through (a removed set-off). */
  struck?: boolean;
}

export interface WpTable {
  type: 'table';
  /** Header rows (navy). Empty for a plain key/value table. */
  head: Cell[][];
  rows: WpRow[];
  /** Key/value layout: no head, no rules, labels bold. */
  plain?: boolean;
  /** Excel: freeze panes below this table's head (the first such table wins). */
  freeze?: boolean;
  autoFilter?: boolean;
  /** Columns repeated on every part when the PDF has to split a wide table (default: the label columns). */
  keyCols?: number;
  /** Columns that stay together when the PDF splits a wide table (e.g. the IGST…Cess of one group). */
  groups?: number[][];
  /** Excel only: placed to the right of the next table, level with its head (the PDF keeps it above). */
  beside?: boolean;
  /** PDF: smallest font size before the table is split into parts (default 6). */
  minFont?: number;
  /** Rows tall enough to sign on (signature lines). */
  tall?: boolean;
  /** index = the list of papers (the PDF adds page numbers); log = the revision log (the PDF may shorten it). */
  role?: 'index' | 'log';
}

export type WpBlock =
  | WpTable
  /** 1 = paper heading, 2 = part heading, 3 = table title (with the form's table number in `code`). */
  | { type: 'heading'; level: 1 | 2 | 3; text: string; code?: string }
  | { type: 'note'; text: string }
  | { type: 'spacer' };

/** Tab colour / index grouping. */
export type Phase = 'summary' | 'collect' | 'reconcile' | 'returns' | 'finish';

export const PHASE_LABEL: Record<Phase, string> = {
  summary: 'Summary',
  collect: 'Collect — books and portal',
  reconcile: 'Reconcile',
  returns: 'Returns',
  finish: 'Finish — payables and audit trail',
};

/** Tab colours (ARGB without alpha). */
export const PHASE_COLOUR: Record<Phase, string> = {
  summary: '1F3864',
  collect: '2E75B6',
  reconcile: 'C55A11',
  returns: '548235',
  finish: '7F7F7F',
};

export interface WorkingPaper {
  /** "B1" */
  ref: string;
  /** "PL-OUTPUT — Sales bifurcation" */
  title: string;
  /** Excel sheet name, ≤ 31 characters, none of []:*?/\ */
  sheet: string;
  phase: Phase;
  /** The MASTER_PMS sheet it reproduces ("—" for papers the workbook does not have). */
  master: string;
  /** One line under the header block: "Source: books P&L — PL-OUTPUT of MASTER_PMS". */
  source: string;
  /** Excel column widths (characters) from column B; column A is a narrow margin. */
  widths: number[];
  blocks: WpBlock[];
  /** Open differences shown on this paper (null = none are shown here). */
  openDiffs: number | null;
  /** Excel: label columns frozen with the panes (counted from column B). */
  freezeCols?: number;
}

/** The paper plus what every page repeats. */
export interface PaperSet {
  papers: WorkingPaper[];
  firm: string;
  meta: ExportMeta;
  status: string;
  printed: string;
  preparedLine: string;
  reviewedLine: string;
  /** How many revision-log entries exist (the PDF may print only the latest). */
  changeCount: number;
}

// ---------------------------------------------------------------------------
// Helpers shared by the builders and the renderers
// ---------------------------------------------------------------------------

export const cellOf = (c: Cell): WpCell => (c !== null && typeof c === 'object' ? c : { v: c as WpCell['v'] });

/** Columns a row occupies (spans counted). */
export const rowWidth = (cells: Cell[]): number => cells.reduce<number>((n, c) => n + Math.max(1, cellOf(c).span ?? 1), 0);

/** Table width: widest head or body row. */
export const tableWidth = (t: WpTable): number =>
  Math.max(1, ...t.head.map(rowWidth), ...t.rows.map((r) => (r.kind === 'band' ? 1 : rowWidth(r.cells))));

/** Rounding noise and negative zero print as 0 (the old export's rule, kept). */
export const clean = (n: number): number => (Math.abs(n) < 0.005 ? 0 : n);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A Date from an ISO timestamp, a date-only "YYYY-MM-DD" (local, not UTC) or "DD/MM/YYYY". */
export const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "28 Sep 2026"; unparseable input is returned as it is. */
export const fmtDate = (v: string | Date | null | undefined): string => {
  if (!v) return '';
  const d = toDate(v);
  return d ? `${pad2(d.getDate())} ${MON[d.getMonth()]} ${d.getFullYear()}` : String(v);
};

/** "28 Sep 2026 17:45". */
export const fmtDateTime = (v: string | Date | null | undefined): string => {
  if (!v) return '';
  const d = toDate(v);
  if (!d) return String(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return fmtDate(d);
  return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** "Locked by X on 28 Sep 2026 17:45" | "In progress" | "Not started". */
export const statusText = (period: Pick<AnnualReturnPeriod, 'status' | 'locked_by' | 'locked_at'> | null | undefined): string => {
  if (!period || period.status === 'not_started') return 'Not started';
  if (period.status === 'locked') {
    return `Locked${period.locked_by ? ` by ${period.locked_by}` : ''}${period.locked_at ? ` on ${fmtDateTime(period.locked_at)}` : ''}`;
  }
  return 'In progress';
};

/** "GSTR9_Working_24AAMCA2528C1Z3_2024-25.xlsx" — safe on every platform, FY hyphen kept. */
export const exportFileName = (kind: string, meta: ExportMeta, ext: 'pdf' | 'xlsx'): string =>
  `${[kind, meta.gstin || 'NO-GSTIN', meta.financialYear].map((p) => String(p).replace(/[^A-Za-z0-9-]+/g, '_')).join('_')}.${ext}`;
