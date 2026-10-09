// PDF renderer for the working papers (jsPDF + autotable), A4 landscape:
// cover, contents with page numbers, sign-off, then every paper from a new
// page, in the Excel's order and with its WP refs. Clean Big4 tables — navy
// heads repeated on every page, hairline rules, no zebra, figures
// right-aligned with negatives in brackets and nil as a dash, bold totals with
// a rule above. A table too wide for the page is split into parts that repeat
// its label columns.

import jsPDF from 'jspdf';
import autoTable, { type CellDef, type CellHookData, type RowInput, type Styles } from 'jspdf-autotable';
import { drawFirmLogo } from '@/utils/reportTheme';
import { drawChrome, GREY, INK, MUTED, NAVY, PAGE, pdfText, RULE, type RGB } from './chrome';
import { cellOf, clean, tableWidth, type Cell, type PaperSet, type RowKind, type WorkingPaper, type WpCell, type WpTable } from './model';

const BAND: RGB = [217, 225, 242];
const LINK: RGB = [5, 99, 193];
const SRC_RGB: Record<'typed' | 'portal', RGB> = { typed: [0, 0, 255], portal: [0, 97, 46] };
const FILL_RGB: Record<'bad' | 'info' | 'good', RGB> = { bad: [248, 215, 218], info: [220, 230, 241], good: [226, 239, 218] };

const PAD_X = 1.2;
const PAD_Y = 0.75;
/** Height (mm) of a row to sign on (A3's signatures). */
const TALL_ROW = 8;
/** mm per Excel width unit at 7 pt. */
const MM_PER_UNIT = 1.45;
/** The PDF keeps at most this many revision-log entries (the latest); the Excel has all. */
export const PDF_LOG_LIMIT = 3000;

const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2 decimals in Indian grouping, negatives in brackets, nil as a dash; positives keep a space where the bracket would be. */
export const fmtMoney = (n: number): string => {
  const v = clean(n);
  if (v === 0) return '– ';
  const s = INR2.format(Math.abs(v));
  return v < 0 ? `(${s})` : `${s} `;
};

const cellText = (c: WpCell): string => {
  const v = c.v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    if (c.fmt === 'int') return String(v);
    if (c.fmt === 'rate') return `${clean(v).toFixed(2)}%`;
    return fmtMoney(v);
  }
  if (v === null || v === undefined) return '';
  if (c.tick) return String(v).replace(/✓/g, '4').replace(/✗/g, '8').replace(/\//g, ' ');
  return pdfText(String(v));
};

// ---------------------------------------------------------------------------
// Document state
// ---------------------------------------------------------------------------

interface St {
  doc: jsPDF;
  set: PaperSet;
  y: number;
  W: number;
  H: number;
  avail: number;
  /** First page of each paper, by ref (pages as rendered; see renderWorkingPapersPdf for the contents shift). */
  startPage: Map<string, number>;
  /** Paper on each page. */
  pagePaper: Map<number, WorkingPaper>;
  current: WorkingPaper | null;
}

const bottom = (st: St) => st.H - PAGE.bottom;

const newPage = (st: St): void => {
  st.doc.addPage();
  st.y = PAGE.top;
  if (st.current) st.pagePaper.set(st.doc.getNumberOfPages(), st.current);
};

const ensure = (st: St, need: number): void => {
  if (st.y + need > bottom(st)) newPage(st);
};

const setFont = (doc: jsPDF, size: number, style: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal', colour: RGB = INK) => {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(...colour);
};

/** Wrapped text at the current y; returns nothing, advances y. */
const para = (st: St, text: string, size: number, style: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal', colour: RGB = INK, x = PAGE.margin, width?: number): void => {
  const { doc } = st;
  setFont(doc, size, style, colour);
  const lines = doc.splitTextToSize(pdfText(text), width ?? st.W - PAGE.margin - x) as string[];
  const lh = size * 0.3528 * 1.25;
  lines.forEach((ln) => {
    ensure(st, lh);
    doc.text(ln, x, st.y + size * 0.3528);
    st.y += lh;
  });
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

interface Placed {
  cell: WpCell;
  col: number;
  span: number;
  rowSpan: number;
  text: string;
}

interface NRow {
  kind: RowKind | 'head';
  struck: boolean;
  /** The cell starting at each column, or 'covered' by a row-span from above. */
  at: Array<Placed | 'covered' | null>;
  cells: Placed[];
}

function normalize(t: WpTable, ncol: number): { head: NRow[]; body: NRow[] } {
  const place = (cells: Cell[], kind: NRow['kind'], struck: boolean, covered: Set<number>): NRow => {
    const at: NRow['at'] = Array(ncol).fill(null);
    const placed: Placed[] = [];
    covered.forEach((c) => { if (c < ncol) at[c] = 'covered'; });
    let col = 0;
    cells.forEach((raw) => {
      if (col >= ncol) return;
      if (at[col] === 'covered') {
        col += 1;
        return;
      }
      const cell = cellOf(raw);
      const span = Math.min(Math.max(1, cell.span ?? 1), ncol - col);
      const p: Placed = { cell, col, span, rowSpan: Math.max(1, cell.rowSpan ?? 1), text: cellText(cell) };
      placed.push(p);
      for (let k = 0; k < span; k++) at[col + k] = k === 0 ? p : 'covered';
      col += span;
    });
    // Positions nothing reached still get an empty cell, so rules run across.
    for (let c = 0; c < ncol; c++) {
      if (at[c] === null) {
        const p: Placed = { cell: { v: null }, col: c, span: 1, rowSpan: 1, text: '' };
        at[c] = p;
        placed.push(p);
      }
    }
    placed.sort((a, b) => a.col - b.col);
    return { kind, struck, at, cells: placed };
  };
  const head: NRow[] = [];
  let pending: Array<{ col: number; span: number; rows: number }> = [];
  t.head.forEach((cells) => {
    const covered = new Set<number>();
    pending.forEach((p) => { for (let k = 0; k < p.span; k++) covered.add(p.col + k); });
    const row = place(cells, 'head', false, covered);
    head.push(row);
    pending = pending.map((p) => ({ ...p, rows: p.rows - 1 })).filter((p) => p.rows > 0);
    row.cells.forEach((p) => { if (p.rowSpan > 1) pending.push({ col: p.col, span: p.span, rows: p.rowSpan - 1 }); });
  });
  const body = t.rows.map((r) =>
    r.kind === 'band'
      ? place([{ ...cellOf(r.cells[0]), span: ncol }], 'band', false, new Set())
      : place(r.cells, r.kind, !!r.struck, new Set()),
  );
  return { head, body };
}

/** Columns of figures: numbers and no text (a label/value column that holds a count stays a text column). */
const numericCols = (body: NRow[], ncol: number): boolean[] => {
  const nums = Array(ncol).fill(false);
  const text = Array(ncol).fill(false);
  body.forEach((r) => {
    if (r.kind === 'band') return;
    r.cells.forEach((p) => {
      if (p.span !== 1) return;
      if (typeof p.cell.v === 'number') nums[p.col] = true;
      else if (p.text.trim() && p.text.trim() !== '—') text[p.col] = true;
    });
  });
  return nums.map((n, c) => n && !text[c]);
};

interface Metrics {
  desired: number[];
  min: number[];
  numeric: boolean[];
}

function measure(doc: jsPDF, head: NRow[], body: NRow[], ncol: number, excel: number[], fs: number, plain: boolean): Metrics {
  const numeric = numericCols(body, ncol);
  const numW = Array(ncol).fill(0);
  const textMax = Array(ncol).fill(0);
  const word = Array(ncol).fill(0);
  const width = (s: string, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fs);
    return doc.getTextWidth(s);
  };
  const longestWord = (s: string, bold: boolean) => s.split(/\s+/).reduce((m, w) => Math.max(m, w ? width(w, bold) : 0), 0);
  const spans: Array<{ p: Placed; bold: boolean }> = [];
  const visit = (r: NRow) => {
    const bold = r.kind !== 'data' && r.kind !== 'band';
    r.cells.forEach((p) => {
      if (!p.text) return;
      const b = bold || !!p.cell.bold || (plain && p.col === 0);
      if (p.span > 1 || r.kind === 'band') {
        if (r.kind !== 'band') spans.push({ p, bold: b });
        return;
      }
      if (typeof p.cell.v === 'number' && r.kind !== 'head') {
        numW[p.col] = Math.max(numW[p.col], width(p.text, b));
        textMax[p.col] = Math.max(textMax[p.col], width(p.text, b));
        word[p.col] = Math.max(word[p.col], width(p.text, b));
      }
      else if (r.kind === 'head') word[p.col] = Math.max(word[p.col], longestWord(p.text, true));
      else {
        textMax[p.col] = Math.max(textMax[p.col], ...p.text.split('\n').map((l) => width(l, b)));
        word[p.col] = Math.max(word[p.col], longestWord(p.text, b));
      }
    });
  };
  head.forEach(visit);
  body.forEach(visit);
  const ex = (c: number) => (excel[c] ?? 12) * MM_PER_UNIT * (fs / 7);
  const desired: number[] = [];
  const min: number[] = [];
  for (let c = 0; c < ncol; c++) {
    if (numeric[c]) {
      const w = Math.max(numW[c], word[c]) + 2 * PAD_X;
      desired.push(w);
      min.push(w);
    } else if (plain) {
      // Key/value text reads on one line when it can; the page width is the only limit.
      desired.push(Math.max(word[c], textMax[c]) + 2 * PAD_X);
      min.push(Math.max(word[c], Math.min(textMax[c], 60)) + 2 * PAD_X);
    } else {
      const want = Math.max(word[c], Math.min(textMax[c], ex(c)));
      desired.push(want + 2 * PAD_X);
      min.push(Math.max(word[c], Math.min(textMax[c], ex(c)) * 0.55) + 2 * PAD_X);
    }
  }
  // A text cell running across several columns needs their widths together.
  spans.forEach(({ p, bold }) => {
    const cols = Array.from({ length: p.span }, (_, k) => p.col + k);
    const exSum = cols.reduce((s, c) => s + ex(c), 0);
    const tw = Math.max(...p.text.split('\n').map((l) => width(l, bold)));
    const lw = longestWord(p.text, bold);
    const need = Math.max(lw, Math.min(tw, exSum)) + 2 * PAD_X;
    const needMin = Math.max(lw + 2 * PAD_X, need * 0.55);
    const have = cols.reduce((s, c) => s + desired[c], 0);
    if (have < need) cols.forEach((c) => { desired[c] += (need - have) / cols.length; });
    const haveMin = cols.reduce((s, c) => s + min[c], 0);
    if (haveMin < needMin) cols.forEach((c) => { min[c] += (needMin - haveMin) / cols.length; });
  });
  return { desired, min, numeric };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Column widths for `cols` that fill `avail`: widen text columns, or squeeze them towards their minimum. */
function fit(m: Metrics, cols: number[], avail: number, fill: boolean): number[] | null {
  const d = cols.map((c) => m.desired[c]);
  const mn = cols.map((c) => m.min[c]);
  const D = sum(d);
  if (D <= avail) {
    if (!fill) return d;
    // Give the spare width to the text columns (labels wrap less); with none, to every column.
    const grow = cols.map((c) => !m.numeric[c]);
    const anyText = grow.some(Boolean);
    const base = anyText ? sum(d.filter((_, i) => grow[i])) : D;
    return d.map((w, i) => (!anyText || grow[i] ? w + ((avail - D) * w) / base : w));
  }
  const N = sum(mn);
  if (N > avail) return null;
  // Squeeze each column the same share of the way from desired to min.
  const k = (D - avail) / (D - N);
  return d.map((w, i) => w - (w - mn[i]) * k);
}

const FONT_STEPS = [7, 6.6, 6.2];
/** Key/value tables (cover, status) read at a larger size. */
const PLAIN_STEPS = [8, 7.5, 7];

interface Layout {
  fs: number;
  parts: Array<{ cols: number[]; widths: number[] }>;
}

function layout(st: St, t: WpTable, head: NRow[], body: NRow[], ncol: number, excel: number[]): Layout {
  const all = Array.from({ length: ncol }, (_, i) => i);
  // Key/value tables and side summaries keep their natural width; the rest run the full width of the page.
  const fill = !t.plain && !t.beside;
  const steps = t.plain ? PLAIN_STEPS : FONT_STEPS.filter((f) => f >= (t.minFont ?? 6.2));
  for (const fs of steps) {
    const m = measure(st.doc, head, body, ncol, excel, fs, !!t.plain);
    const w = fit(m, all, st.avail, fill);
    if (w) return { fs, parts: [{ cols: all, widths: w }] };
  }
  // Too wide: split into parts that repeat the label columns.
  const fs = steps[steps.length - 1] ?? 6.2;
  const m = measure(st.doc, head, body, ncol, excel, fs, !!t.plain);
  const keyCount = Math.min(ncol - 1, Math.max(1, t.keyCols ?? 1));
  const keys = all.slice(0, keyCount);
  const inGroup = new Set((t.groups ?? []).flat());
  const groups: number[][] = [...(t.groups ?? []).map((g) => g.filter((c) => c >= keyCount && c < ncol)).filter((g) => g.length)];
  all.slice(keyCount).forEach((c) => { if (!inGroup.has(c)) groups.push([c]); });
  groups.sort((a, b) => a[0] - b[0]);
  const parts: number[][] = [];
  let cur = [...keys];
  let curW = sum(keys.map((c) => m.min[c]));
  groups.forEach((g) => {
    const gw = sum(g.map((c) => m.min[c]));
    if (curW + gw > st.avail && cur.length > keys.length) {
      parts.push(cur);
      cur = [...keys];
      curW = sum(keys.map((c) => m.min[c]));
    }
    cur.push(...g);
    curW += gw;
  });
  parts.push(cur);
  return {
    fs,
    parts: parts.map((cols) => {
      const w = fit(m, cols, st.avail, fill);
      // A single group wider than the page: scale it down to fit (text wraps, figures may crowd).
      const widths = w ?? cols.map((c) => (m.min[c] * st.avail) / sum(cols.map((k) => m.min[k])));
      return { cols, widths };
    }),
  };
}

interface Tag {
  kind: NRow['kind'];
  struck: boolean;
  cell: WpCell;
  plain: boolean;
  /** Target page of an internal link (contents). */
  page?: number;
}

type TaggedCell = CellDef & { tag: Tag };

function styleFor(p: Placed, row: NRow, numeric: boolean, plain: boolean, fs: number): Partial<Styles> {
  const c = p.cell;
  const isNum = typeof c.v === 'number';
  if (row.kind === 'head') {
    return {
      fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', valign: 'middle',
      halign: c.align ?? (p.span === 1 && numeric ? 'right' : 'left'),
    };
  }
  const bold = row.kind === 'total' || row.kind === 'subtotal' || row.kind === 'band' || !!c.bold || (plain && p.col === 0);
  const style: Partial<Styles> = {
    fontStyle: bold && c.italic ? 'bolditalic' : bold ? 'bold' : c.italic ? 'italic' : 'normal',
    halign: c.align ?? (c.tick ? 'center' : isNum && !plain ? 'right' : 'left'),
    textColor: INK,
  };
  if (c.tick) (style as { font?: string }).font = 'zapfdingbats';
  if (isNum && c.src && c.src !== 'computed') style.textColor = SRC_RGB[c.src];
  if (c.muted) style.textColor = MUTED;
  if (c.link) style.textColor = LINK;
  if (c.strike || row.struck) style.textColor = MUTED;
  if (row.kind === 'band') style.fillColor = BAND;
  if (c.fill) style.fillColor = FILL_RGB[c.fill];
  return style;
}

/** autotable rows for one part (a subset of the columns, in order). */
function partRows(rows: NRow[], cols: number[], numeric: boolean[], plain: boolean, fs: number, pageOf?: (c: WpCell) => number | undefined): TaggedCell[][] {
  const pos = new Map(cols.map((c, i) => [c, i]));
  return rows.map((row) => {
    const out: TaggedCell[] = [];
    cols.forEach((c) => {
      const a = row.at[c];
      if (!a || a === 'covered') {
        // Covered by a cell that starts in a column this part leaves out (a label running across): show an empty cell.
        if (a === 'covered' && !row.cells.some((p) => p.col < c && p.col + p.span > c && pos.has(p.col))) {
          const coveredByHeadAbove = row.kind === 'head' && !row.cells.some((p) => p.col <= c && p.col + p.span > c);
          if (!coveredByHeadAbove) {
            const empty: Placed = { cell: { v: null }, col: c, span: 1, rowSpan: 1, text: '' };
            out.push({ content: '', styles: styleFor(empty, row, numeric[c], plain, fs), tag: { kind: row.kind, struck: row.struck, cell: empty.cell, plain } });
          }
        }
        return;
      }
      const inPart = Array.from({ length: a.span }, (_, k) => a.col + k).filter((k) => pos.has(k)).length;
      const def: TaggedCell = {
        content: a.text,
        colSpan: inPart,
        rowSpan: a.rowSpan,
        styles: styleFor(a, row, numeric[c], plain, fs),
        tag: { kind: row.kind, struck: row.struck, cell: a.cell, plain, page: pageOf?.(a.cell) },
      };
      out.push(def);
    });
    return out;
  });
}

function renderTable(st: St, t: WpTable, excel: number[], opts: { pageOf?: (c: WpCell) => number | undefined } = {}): void {
  const { doc } = st;
  let table = t;
  if (t.role === 'log' && t.rows.length > PDF_LOG_LIMIT) {
    const older = t.rows.length - PDF_LOG_LIMIT;
    para(st, `Showing the latest ${PDF_LOG_LIMIT.toLocaleString('en-IN')} of ${t.rows.length.toLocaleString('en-IN')} changes. The ${older.toLocaleString('en-IN')} older change${older === 1 ? ' is' : 's are'} only in the Excel working papers (sheet F1).`, 7.5, 'bold', INK);
    st.y += 1;
    table = { ...t, rows: t.rows.slice(-PDF_LOG_LIMIT) };
  }
  const ncol = tableWidth(table);
  const { head, body } = normalize(table, ncol);
  const lay = layout(st, table, head, body, ncol, excel);
  const numeric = numericCols(body, ncol);
  const plain = !!table.plain;
  lay.parts.forEach((part, pi) => {
    if (lay.parts.length > 1 && pi > 0) {
      const names = [...new Set(part.cols.slice(Math.max(1, table.keyCols ?? 1))
        .map((c) => head[0]?.at[c])
        .filter((a): a is Placed => !!a && a !== 'covered' && !!a.text)
        .map((a) => a.text.trim()))];
      st.y += 1.5;
      ensure(st, 20);
      para(st, `Continued (part ${pi + 1} of ${lay.parts.length})${names.length ? ` — ${names.join(' · ')}` : ''}`, 7, 'italic', GREY);
    } else if (lay.parts.length > 1) {
      ensure(st, 20);
      para(st, `This table is wider than the page: it is printed in ${lay.parts.length} parts, each repeating the label column${(table.keyCols ?? 1) > 1 ? 's' : ''}.`, 7, 'italic', GREY);
    }
    ensure(st, table.head.length ? 14 : 6);
    const columnStyles: Record<number, Partial<Styles>> = {};
    part.widths.forEach((w, i) => { columnStyles[i] = { cellWidth: w }; });
    autoTable(doc, {
      startY: st.y,
      head: partRows(head, part.cols, numeric, plain, lay.fs) as unknown as RowInput[],
      body: partRows(body, part.cols, numeric, plain, lay.fs, opts.pageOf) as unknown as RowInput[],
      theme: 'plain',
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom },
      tableWidth: sum(part.widths),
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: {
        font: 'helvetica', fontSize: lay.fs, cellPadding: { top: PAD_Y, bottom: PAD_Y, left: PAD_X, right: PAD_X },
        textColor: INK, overflow: 'linebreak', valign: 'top', lineWidth: 0, minCellHeight: 0,
      },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', valign: 'middle' },
      columnStyles,
      bodyStyles: table.tall ? { minCellHeight: TALL_ROW, valign: 'bottom' } : {},
      willDrawPage: () => {
        // A page autotable adds belongs to the paper being printed.
        const n = doc.getNumberOfPages();
        if (st.current && !st.pagePaper.has(n)) st.pagePaper.set(n, st.current);
      },
      didDrawCell: (d: CellHookData) => {
        const tag = (d.cell.raw as TaggedCell | undefined)?.tag;
        if (!tag) return;
        const { x, y, width, height } = d.cell;
        if (d.section === 'head') {
          // Hairline between head cells so grouped columns read as groups.
          doc.setDrawColor(142, 169, 219);
          doc.setLineWidth(0.1);
          doc.line(x + width, y + 0.6, x + width, y + height - 0.6);
          return;
        }
        if (tag.plain) return;
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.1);
        doc.line(x, y + height, x + width, y + height);
        if (tag.kind === 'subtotal' || tag.kind === 'total') {
          doc.setDrawColor(...INK);
          doc.setLineWidth(0.25);
          doc.line(x, y, x + width, y);
        }
        if (tag.kind === 'total' && typeof tag.cell.v === 'number') {
          doc.setDrawColor(...INK);
          doc.setLineWidth(0.2);
          doc.line(x + 0.6, y + height - 0.2, x + width - 0.6, y + height - 0.2);
          doc.line(x + 0.6, y + height - 0.75, x + width - 0.6, y + height - 0.75);
        }
        const text = (d.cell.text || []).join(' ').trim();
        if ((tag.struck || tag.cell.strike) && text) {
          doc.setDrawColor(...MUTED);
          doc.setLineWidth(0.15);
          const mid = y + PAD_Y + (d.cell.styles.fontSize * 0.3528) * 0.62;
          const tw = Math.min(width - 2 * PAD_X, doc.getTextWidth(d.cell.text[0] || ''));
          const x0 = d.cell.styles.halign === 'right' ? x + width - PAD_X - tw : x + PAD_X;
          doc.line(x0, mid, x0 + tw, mid);
        }
        const link = tag.cell.link;
        if (tag.page) doc.link(x, y, width, height, { pageNumber: tag.page });
        else if (link && 'url' in link) doc.link(x, y, width, height, { url: link.url });
      },
    });
    st.y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? st.y) + 2;
  });
  st.y += 2;
}

// ---------------------------------------------------------------------------
// Papers
// ---------------------------------------------------------------------------

/** Column widths the Excel gives a table (a side table uses the columns right of the next one). */
function excelWidths(p: WorkingPaper, blockIndex: number): number[] {
  const t = p.blocks[blockIndex] as WpTable;
  if (!t.beside) return p.widths;
  const next = p.blocks.slice(blockIndex + 1).find((b): b is WpTable => b.type === 'table');
  return next ? p.widths.slice(tableWidth(next) + 1) : p.widths;
}

function paperTitle(st: St, p: WorkingPaper): void {
  const { doc, set } = st;
  setFont(doc, 13, 'bold', NAVY);
  doc.text(p.ref, PAGE.margin, st.y + 4.6);
  doc.text(pdfText(p.title), PAGE.margin + 13, st.y + 4.6);
  st.y += 7.5;
  para(st, p.source, 7.5, 'italic', GREY, PAGE.margin + 13);
  // Prepared · Verified · Reviewed (and the open differences) on one line when they fit;
  // otherwise broken between the parts, never inside one (para still wraps a part too long alone).
  const x = PAGE.margin + 13;
  const room = st.W - PAGE.margin - x;
  const parts = [set.preparedLine, set.verifiedLine, set.reviewedLine, ...(p.openDiffs === null ? [] : [`Open differences on this paper: ${p.openDiffs}`])];
  setFont(doc, 7.5, 'normal', GREY);
  const lines: string[] = [];
  parts.forEach((part) => {
    const last = lines.length - 1;
    if (last >= 0 && doc.getTextWidth(pdfText(`${lines[last]}     ${part}`)) <= room) lines[last] = `${lines[last]}     ${part}`;
    else lines.push(part);
  });
  lines.forEach((ln) => para(st, ln, 7.5, 'normal', GREY, x));
  st.y += 1;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(PAGE.margin, st.y, st.W - PAGE.margin, st.y);
  st.y += 4;
}

function startPaper(st: St, p: WorkingPaper, first: boolean): void {
  st.current = p;
  if (!first) st.doc.addPage();
  st.y = PAGE.top;
  const n = st.doc.getNumberOfPages();
  st.startPage.set(p.ref, n);
  st.pagePaper.set(n, p);
}

function renderBlocks(st: St, p: WorkingPaper, opts: { skipHeadings?: boolean; pageOf?: (c: WpCell) => number | undefined; only?: (t: WpTable) => boolean } = {}): void {
  p.blocks.forEach((b, bi) => {
    if (b.type === 'spacer') {
      st.y += 3;
      return;
    }
    if (b.type === 'note') {
      if (opts.skipHeadings) return;
      para(st, b.text, 7, 'italic', GREY);
      st.y += 1;
      return;
    }
    if (b.type === 'heading') {
      if (opts.skipHeadings) return;
      if (b.level === 1) {
        ensure(st, 22);
        para(st, b.text, 10.5, 'bold', NAVY);
        st.y += 1.5;
      } else if (b.level === 2) {
        st.y += 1.5;
        // A table to sign on (A3's signatures) starts on a new page rather than split under its heading.
        const next = p.blocks[bi + 1];
        ensure(st, next?.type === 'table' && next.tall ? 6 + next.rows.length * TALL_ROW : 24);
        para(st, b.text, 9, 'bold', INK);
        st.y += 1;
      } else {
        st.y += 0.5;
        ensure(st, 22);
        para(st, b.code ? `${b.code}.  ${b.text}` : b.text, 8, 'bold', INK);
        st.y += 0.8;
      }
      return;
    }
    if (opts.only && !opts.only(b)) return;
    renderTable(st, b, excelWidths(p, bi), { pageOf: opts.pageOf });
  });
}

function renderCover(st: St, p: WorkingPaper): void {
  const { doc, set } = st;
  const M = PAGE.margin;
  drawFirmLogo(doc, { width: 70, y: 24, x: M });
  doc.setFillColor(...NAVY);
  doc.rect(M, 52, 3, 34, 'F');
  setFont(doc, 26, 'bold', NAVY);
  doc.text('Annual Return', M + 8, 63);
  setFont(doc, 15, 'normal', INK);
  doc.text('GSTR-9 & GSTR-9C working papers', M + 8, 72.5);
  setFont(doc, 9.5, 'normal', GREY);
  doc.text(pdfText(`Financial year ${set.meta.financialYear}`), M + 8, 80);
  st.y = 96;
  para(st, set.meta.clientName || '—', 15, 'bold', INK);
  para(st, `GSTIN ${set.meta.gstin || '—'}`, 10, 'normal', GREY);
  st.y += 5;
  renderBlocks(st, p, { skipHeadings: true });
  setFont(doc, 7.5, 'italic', GREY);
  doc.text(pdfText(p.blocks.find((b): b is { type: 'note'; text: string } => b.type === 'note')?.text ?? ''), M, st.H - PAGE.bottom - 2);
}

/** The contents (A2): the index table with the page each paper starts on, and the legends. */
function renderContents(st: St, p: WorkingPaper, pageOfRef: (ref: string) => number, pageOfSheet: (sheet: string) => number | undefined): void {
  const idx = p.blocks.findIndex((b) => b.type === 'table' && b.role === 'index');
  const blocks = p.blocks.map((b, i) => {
    if (i !== idx || b.type !== 'table') return b;
    const t: WpTable = {
      ...b,
      head: [b.head[0].map((h, k) => (k === b.head[0].length - 1 ? 'PAGE' : h))],
      rows: b.rows.map((r) => {
        if (r.kind === 'band') return r;
        const ref = String(cellOf(r.cells[0]).v);
        return { ...r, cells: [...r.cells.slice(0, -1), { v: pageOfRef(ref), fmt: 'int' as const, link: { sheet: String(cellOf(r.cells[r.cells.length - 1]).v) } }] };
      }),
    };
    return t;
  });
  renderBlocks(st, { ...p, blocks }, { pageOf: (c) => (c.link && 'sheet' in c.link ? pageOfSheet(c.link.sheet) : undefined) });
}

export interface WorkingPapersPdf {
  doc: jsPDF;
  /** First page of each paper, by WP ref. */
  pages: Record<string, number>;
}

/** Render every paper. The contents (A2) is rendered last, once page numbers are known, and moved in after the cover. */
export function renderWorkingPapersPdf(set: PaperSet): WorkingPapersPdf {
  const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const st: St = { doc, set, y: PAGE.top, W, H, avail: W - 2 * PAGE.margin, startPage: new Map(), pagePaper: new Map(), current: null };
  const [cover, contents, ...rest] = set.papers;

  startPaper(st, cover, true);
  renderCover(st, cover);
  rest.forEach((p) => {
    startPaper(st, p, false);
    paperTitle(st, p);
    renderBlocks(st, p);
  });

  // The contents, at the end for now: its page numbers count the pages it will take once moved in after the cover.
  const bodyPages = doc.getNumberOfPages();
  const coverPages = (st.startPage.get(rest[0]?.ref ?? '') ?? 2) - 1;
  const at = coverPages + 1;
  let k = 1;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shift = (ref: string) => (ref === cover.ref ? 1 : ref === contents.ref ? at : (st.startPage.get(ref) ?? 1) + k);
    const bySheet = new Map(set.papers.map((p) => [p.sheet, shift(p.ref)]));
    startPaper(st, contents, false);
    paperTitle(st, contents);
    renderContents(st, contents, shift, (sheet) => bySheet.get(sheet));
    const used = doc.getNumberOfPages() - bodyPages;
    if (used === k) break;
    for (let n = doc.getNumberOfPages(); n > bodyPages; n--) doc.deletePage(n);
    k = used;
  }
  for (let i = 0; i < k; i++) doc.movePage(bodyPages + 1 + i, at + i);

  // Page → paper, after the move.
  const final = new Map<number, WorkingPaper>();
  const total = doc.getNumberOfPages();
  let cur: WorkingPaper = cover;
  for (let n = 1; n <= total; n++) {
    if (n >= at && n < at + k) cur = contents;
    else cur = st.pagePaper.get(n < at ? n : n - k) ?? cur;
    final.set(n, cur);
  }
  drawChrome(doc, {
    firm: set.firm,
    clientName: set.meta.clientName,
    gstin: set.meta.gstin,
    financialYear: set.meta.financialYear,
    status: set.status,
    printed: set.printed,
    right: (n) => {
      const p = final.get(n) ?? cover;
      return `WP ${p.ref} — ${p.title}`;
    },
  });
  const pages: Record<string, number> = {};
  set.papers.forEach((p) => { pages[p.ref] = p.ref === cover.ref ? 1 : p.ref === contents.ref ? at : (st.startPage.get(p.ref) ?? 0) + k; });
  return { doc, pages };
}
