// Excel renderer for the working papers (ExcelJS). Lays out the model built
// by papers.ts in the house style — Arial 9, no gridlines, navy table heads,
// light section bands, hairline borders, bold totals with a rule above and a
// double rule below, figures right-aligned in #,##0.00 with negatives in
// brackets and nil as a dash — with the same header block, print setup and
// header/footer on every sheet. ExcelJS itself is loaded on demand so it never
// weighs on the main bundle.
//
// Links: a cell's SheetLink goes to the cell of the anchored row it names
// (`#'B6 PORTAL DATA'!E27`), resolved once every sheet is laid out, so a link
// may point forward. ExcelJS writes a hyperlink only on a text cell, so a figure
// keeps its number and its link is added to the sheet's <hyperlinks> after the
// file is written (values, never HYPERLINK formulas).

import type { Alignment, Borders, Cell as XCell, Fill, Font, Workbook, Worksheet } from 'exceljs';
import {
  anchorChain,
  anchorsOf,
  cellOf,
  clean,
  liveLink,
  PHASE_COLOUR,
  tableWidth,
  type Cell,
  type PaperSet,
  type SheetLink,
  type WorkingPaper,
  type WpCell,
  type WpRow,
  type WpTable,
} from './model';

type ExcelJSModule = typeof import('exceljs');

/** The UMD build exposes the library as the module's default export; the Node build as the module. */
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule;
}

// ---------------------------------------------------------------------------
// House style
// ---------------------------------------------------------------------------

const ARIAL = 'Arial';
const NAVY = 'FF1F3864';
const BAND = 'FFD9E1F2';
const GRID = 'FFBFBFBF';
const INK = 'FF000000';
const GREY = 'FF595959';
const MUTED = 'FF808080';
const SRC_COLOUR = { typed: 'FF0000FF', portal: 'FF00612E' } as const;
const STATUS_FILL = { bad: 'FFF8D7DA', info: 'FFDCE6F1', good: 'FFE2EFDA', variance: 'FFFCD5B4' } as const;

export const NUM_FMT = '#,##0.00_);(#,##0.00);"–"_)';
export const RATE_FMT = '0.00"%"';
const INT_FMT = 'General';

const FIRST_COL = 2; // column B — column A is a narrow margin, as on the firm's sheets
const HEADER_ROWS = 8;
const LINE_PT = 11.5;

const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (f: Partial<Font> = {}): Partial<Font> => ({ name: ARIAL, size: 9, ...f });
const thin = (argb = GRID) => ({ style: 'thin' as const, color: { argb } });
const GRID_BORDER: Partial<Borders> = { top: thin(), left: thin(), bottom: thin(), right: thin() };

/** Header/footer text: "&" starts a code, so a literal one is doubled; the whole section is kept short. */
const hf = (s: string, max = 90): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s).replace(/&/g, '&&');

/** Rough characters per Excel width unit at Arial 9. */
const CHARS_PER_UNIT = 1.1;

/** Lines a text needs in a cell of the given width (explicit line breaks count). */
const linesFor = (text: string, width: number): number => {
  const per = Math.max(4, Math.floor(width * CHARS_PER_UNIT));
  return text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / per)), 0);
};

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** An anchored row as laid out: its sheet, row and first column, and the columns of its figures. */
interface AnchorAt {
  sheet: string;
  row: number;
  col: number;
  cols: Record<string, number>;
}

/** A cell whose internal link is resolved once every sheet is laid out. */
interface PendingLink {
  ws: Worksheet;
  row: number;
  col: number;
  link: SheetLink;
  /** The cell's text (a text cell gets an ExcelJS hyperlink), or null for a figure. */
  text: string | null;
}

/** What every sheet shares while the workbook is built. */
interface BookState {
  sheets: Set<string>;
  anchors: Map<string, AnchorAt>;
  pending: PendingLink[];
}

const colLetter = (n: number): string => {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};

const quoteSheet = (name: string): string => `'${name.replace(/'/g, "''")}'`;

/** "'B6 PORTAL DATA'!E27": the anchored cell (or its row's first cell), else the sheet's A1. */
const linkLocation = (book: BookState, link: SheetLink): { location: string; tooltip: string } => {
  const hit = link.anchor ? anchorChain(link.anchor).map((a) => book.anchors.get(a)).find((a) => a && a.sheet === link.sheet) : undefined;
  if (!hit) return { location: `${quoteSheet(link.sheet)}!A1`, tooltip: `Go to ${link.sheet}` };
  const k = link.col !== undefined ? hit.cols[link.col] : undefined;
  const cell = `${colLetter(hit.col + (k ?? 0))}${hit.row}`;
  return { location: `${quoteSheet(link.sheet)}!${cell}`, tooltip: `Source: ${link.sheet}, cell ${cell}` };
};

const xmlAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Add internal hyperlinks to figure cells (which ExcelJS cannot link) in the
 * written file: each sheet's <hyperlinks>, created where the schema puts it
 * (after the data validations, before the print options and margins).
 */
async function addFigureLinks(buffer: ArrayBuffer, bySheet: Map<number, Array<{ ref: string; location: string; tooltip: string }>>): Promise<ArrayBuffer> {
  if (!bySheet.size) return buffer;
  const mod = await import('jszip');
  const JSZip = ((mod as unknown as { default?: typeof import('jszip') }).default ?? mod) as typeof import('jszip');
  const zip = await JSZip.loadAsync(buffer);
  for (const [id, links] of bySheet) {
    const name = `xl/worksheets/sheet${id}.xml`;
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async('string');
    const tags = links.map((l) => `<hyperlink ref="${l.ref}" location="${xmlAttr(l.location)}" tooltip="${xmlAttr(l.tooltip)}"/>`).join('');
    if (xml.includes('</hyperlinks>')) xml = xml.replace('</hyperlinks>', `${tags}</hyperlinks>`);
    else {
      const at = ['<printOptions', '<pageMargins', '<pageSetup', '<headerFooter', '<drawing', '<legacyDrawing', '<tableParts', '<extLst', '</worksheet>']
        .map((t) => xml.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      xml = `${xml.slice(0, at)}<hyperlinks>${tags}</hyperlinks>${xml.slice(at)}`;
    }
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

interface SheetState {
  ws: Worksheet;
  paper: WorkingPaper;
  book: BookState;
  row: number;
  freezeRow: number | null;
  /** Rows (1-based) whose height has been set, so a beside table never shrinks them. */
  heights: Map<number, number>;
  printCols: number | null;
}

const widthOf = (p: WorkingPaper, col: number, span = 1): number => {
  let w = 0;
  for (let i = 0; i < span; i++) w += p.widths[col - FIRST_COL + i] ?? 12;
  return w;
};

const setHeight = (s: SheetState, row: number, pt: number): void => {
  const h = Math.max(s.heights.get(row) ?? 0, pt);
  s.heights.set(row, h);
  s.ws.getRow(row).height = h;
};

function headerBlock(s: SheetState, set: PaperSet): void {
  const { ws, paper } = s;
  const put = (row: number, text: string, f: Partial<Font>, height = 12) => {
    const c = ws.getCell(row, FIRST_COL);
    c.value = text;
    c.font = font(f);
    c.alignment = { vertical: 'middle' };
    setHeight(s, row, height);
  };
  put(1, set.firm, { bold: true, size: 12, color: { argb: NAVY } }, 16);
  put(2, set.meta.clientName || '—', { bold: true, size: 10 }, 13.5);
  put(3, `GSTIN: ${set.meta.gstin || '—'}`, {});
  put(4, `Financial year: ${set.meta.financialYear}${set.meta.period ? ` · Period: ${set.meta.period}` : ''}`, {});
  put(5, `WP ref ${paper.ref} — ${paper.title}`, { bold: true, size: 12, color: { argb: NAVY } }, 17);
  put(6, `${set.preparedLine}     ${set.verifiedLine}`, {});
  put(7, set.reviewedLine, {});
  put(8, paper.source, { italic: true, color: { argb: GREY } });
  setHeight(s, 9, 8);
  s.row = 10;
}

function writeValue(c: XCell, cell: WpCell, book: BookState): boolean {
  const v = cell.v;
  const link = liveLink(cell.link, book.sheets) ? cell.link : undefined;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return false;
    // Full precision, rounded by the number format — so a column of cells adds up to its TOTAL.
    c.value = cell.fmt === 'int' ? v : clean(v);
    c.numFmt = cell.fmt === 'rate' ? RATE_FMT : cell.fmt === 'int' ? INT_FMT : NUM_FMT;
    if (link && 'sheet' in link) book.pending.push({ ws: c.worksheet, row: Number(c.row), col: Number(c.col), link, text: null });
    return true;
  }
  if (v === null || v === undefined || v === '') return false;
  const text = String(v);
  if (link && 'sheet' in link && link.anchor) {
    c.value = text;
    book.pending.push({ ws: c.worksheet, row: Number(c.row), col: Number(c.col), link, text });
  } else if (link) {
    const hyperlink = 'sheet' in link ? `#${quoteSheet(link.sheet)}!A1` : link.url;
    c.value = { text, hyperlink, tooltip: 'sheet' in link ? `Go to ${link.sheet}` : link.url };
  } else {
    c.value = text;
  }
  return true;
}

type Kind = WpRow['kind'] | 'head';

/** Style one cell of a table. */
function styleCell(c: XCell, cell: WpCell, kind: Kind, opts: { numeric: boolean; plain: boolean; struck: boolean; first: boolean; wrap: boolean; linked?: boolean }): void {
  const isNum = typeof cell.v === 'number';
  const f: Partial<Font> = font();
  if (kind === 'head') {
    Object.assign(f, { bold: true, color: { argb: 'FFFFFFFF' } });
  } else {
    if (kind === 'total' || kind === 'subtotal' || kind === 'band' || cell.bold || (opts.plain && opts.first)) f.bold = true;
    if (cell.italic) f.italic = true;
    if (isNum && cell.src && cell.src !== 'computed') f.color = { argb: SRC_COLOUR[cell.src] };
    if (cell.muted) f.color = { argb: MUTED };
    if (opts.linked) Object.assign(f, { color: { argb: 'FF0563C1' }, underline: true });
    if (cell.strike || opts.struck) Object.assign(f, { strike: true, color: { argb: MUTED } });
  }
  c.font = f;
  const align: Partial<Alignment> = {
    vertical: kind === 'head' ? 'middle' : 'top',
    horizontal: cell.align ?? (kind === 'head' ? (opts.numeric ? 'right' : 'left') : cell.tick ? 'center' : isNum && !opts.plain ? 'right' : 'left'),
  };
  if (opts.wrap || kind === 'head') align.wrapText = true;
  c.alignment = align;
  if (kind === 'head') c.fill = solid(NAVY);
  else if (kind === 'band') c.fill = solid(BAND);
  if (cell.fill) c.fill = solid(STATUS_FILL[cell.fill]);
  if (opts.plain) return;
  if (kind === 'total') c.border = { left: thin(), right: thin(), top: thin(INK), bottom: { style: 'double', color: { argb: INK } } };
  else if (kind === 'subtotal') c.border = { left: thin(), right: thin(), bottom: thin(), top: thin(INK) };
  else if (kind === 'head') c.border = { top: thin(NAVY), bottom: thin(NAVY), left: thin('FF8EA9DB'), right: thin('FF8EA9DB') };
  else c.border = GRID_BORDER;
}

/** Columns of a table that hold figures (any number in the body outside spans). */
const numericColumns = (t: WpTable): Set<number> => {
  const out = new Set<number>();
  t.rows.forEach((r) => {
    if (r.kind === 'band') return;
    let col = 0;
    r.cells.forEach((raw) => {
      const c = cellOf(raw);
      const span = Math.max(1, c.span ?? 1);
      if (typeof c.v === 'number' && span === 1) out.add(col);
      col += span;
    });
  });
  return out;
};

/** Render a table at (row, col). Returns the row after it and the last head row. */
function renderTable(s: SheetState, t: WpTable, startRow: number, startCol: number): { next: number; headEnd: number } {
  const { ws, paper } = s;
  const width = tableWidth(t);
  const numeric = numericColumns(t);
  let r = startRow;

  // Head rows: positional, spans consume columns; a position covered by a row-span above is a null placeholder.
  const covered = new Set<string>();
  t.head.forEach((row) => {
    const master = new Map<number, WpCell>();
    let col = 0;
    let lines = 1;
    row.forEach((raw) => {
      if (covered.has(`${r}:${col}`)) {
        col += 1;
        return;
      }
      const cell = cellOf(raw);
      const span = Math.max(1, cell.span ?? 1);
      const rowSpan = Math.max(1, cell.rowSpan ?? 1);
      writeValue(ws.getCell(r, startCol + col), cell, s.book);
      if (span > 1 || rowSpan > 1) {
        ws.mergeCells(r, startCol + col, r + rowSpan - 1, startCol + col + span - 1);
        for (let dr = 0; dr < rowSpan; dr++) for (let dc = 0; dc < span; dc++) if (dr || dc) covered.add(`${r + dr}:${col + dc}`);
      }
      for (let dc = 0; dc < span; dc++) master.set(col + dc, cell);
      if (typeof cell.v === 'string' && rowSpan === 1) lines = Math.max(lines, linesFor(cell.v, widthOf(paper, startCol + col, span)));
      col += span;
    });
    for (let c = 0; c < width; c++) {
      const cell = master.get(c) ?? { v: null };
      styleCell(ws.getCell(r, startCol + c), cell, 'head', { numeric: numeric.has(c), plain: false, struck: false, first: c === 0, wrap: true });
    }
    setHeight(s, r, Math.max(13, lines * LINE_PT + 2));
    r += 1;
  });
  const headEnd = r - 1;

  t.rows.forEach((row) => {
    let lines = 1;
    if (row.kind === 'band') {
      const cell = cellOf(row.cells[0]);
      for (let c = 0; c < width; c++) {
        const x = ws.getCell(r, startCol + c);
        if (c === 0) writeValue(x, cell, s.book);
        styleCell(x, c === 0 ? cell : { v: null }, 'band', { numeric: false, plain: !!t.plain, struck: false, first: c === 0, wrap: false, linked: c === 0 && liveLink(cell.link, s.book.sheets) });
      }
      setHeight(s, r, 13);
      r += 1;
      return;
    }
    anchorsOf(row).forEach((a) => {
      if (!s.book.anchors.has(a)) s.book.anchors.set(a, { sheet: paper.sheet, row: r, col: startCol, cols: { ...t.cols, ...row.cols } });
    });
    let col = 0;
    const used = new Set<number>();
    row.cells.forEach((raw) => {
      const cell = cellOf(raw);
      const span = Math.max(1, cell.span ?? 1);
      const x = ws.getCell(r, startCol + col);
      const written = writeValue(x, cell, s.book);
      const linked = written && liveLink(cell.link, s.book.sheets);
      if (cell.note && written) x.note = cell.note;
      const text = typeof cell.v === 'string' ? cell.v : '';
      const w = widthOf(paper, startCol + col, span);
      const wrap = !!text && text.length > w * CHARS_PER_UNIT;
      if (wrap) lines = Math.max(lines, linesFor(text, w));
      if (span > 1) ws.mergeCells(r, startCol + col, r, startCol + col + span - 1);
      for (let dc = 0; dc < span; dc++) {
        used.add(col + dc);
        styleCell(ws.getCell(r, startCol + col + dc), cell, row.kind, { numeric: numeric.has(col), plain: !!t.plain, struck: !!row.struck, first: col === 0, wrap, linked });
      }
      col += span;
    });
    // Style the rest of the table width so rules and totals run across.
    for (let c = 0; c < width; c++) {
      if (used.has(c)) continue;
      styleCell(ws.getCell(r, startCol + c), { v: null }, row.kind, { numeric: numeric.has(c), plain: !!t.plain, struck: !!row.struck, first: c === 0, wrap: false });
    }
    setHeight(s, r, t.tall ? 26 : Math.max(12, lines * LINE_PT + 1.5));
    if (t.tall) for (let c = 0; c < width; c++) ws.getCell(r, startCol + c).alignment = { vertical: 'bottom', horizontal: 'left' };
    r += 1;
  });

  if (t.autoFilter && t.head.length) {
    ws.autoFilter = { from: { row: headEnd, column: startCol }, to: { row: Math.max(headEnd, r - 1), column: startCol + width - 1 } };
  }
  return { next: r, headEnd };
}

function renderSheet(wb: Workbook, paper: WorkingPaper, set: PaperSet, book: BookState): void {
  const ws = wb.addWorksheet(paper.sheet, {
    properties: { tabColor: { argb: `FF${PHASE_COLOUR[paper.phase]}` }, defaultRowHeight: 12 },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.6, bottom: 0.55, header: 0.25, footer: 0.25 },
    },
    headerFooter: {
      oddHeader: `&L&"${ARIAL},Regular"&8${hf(`${set.firm} · ${set.meta.clientName} · FY ${set.meta.financialYear}`)}&R&"${ARIAL},Regular"&8${hf(`WP ${paper.ref}`)} · Page &P of &N`,
      oddFooter: `&L&"${ARIAL},Italic"&7${hf(`Printed ${set.printed} · Status: ${set.status}`, 120)}`,
    },
  });
  ws.getColumn(1).width = 2;
  paper.widths.forEach((w, i) => { ws.getColumn(FIRST_COL + i).width = w; });

  const s: SheetState = { ws, paper, book, row: 1, freezeRow: null, heights: new Map(), printCols: null };
  headerBlock(s, set);

  let pendingBeside: WpTable | null = null;
  paper.blocks.forEach((b, bi) => {
    if (b.type === 'spacer') {
      setHeight(s, s.row, 8);
      s.row += 1;
      return;
    }
    if (b.type === 'note') {
      const c = ws.getCell(s.row, FIRST_COL);
      c.value = b.text;
      c.font = font({ italic: true, size: 8.5, color: { argb: GREY } });
      setHeight(s, s.row, 12);
      s.row += 1;
      return;
    }
    if (b.type === 'heading') {
      // Air above part headings, none above the first block.
      if (b.level < 3 && bi > 0) {
        setHeight(s, s.row, 8);
        s.row += 1;
      }
      const size = b.level === 1 ? 11 : b.level === 2 ? 10 : 9;
      const f = font({ bold: true, size, color: b.level === 1 ? { argb: NAVY } : undefined });
      if (b.code) {
        const k = ws.getCell(s.row, FIRST_COL);
        k.value = b.code;
        k.font = f;
        k.alignment = { horizontal: 'left', vertical: 'middle' };
      }
      const c = ws.getCell(s.row, b.code ? FIRST_COL + 1 : FIRST_COL);
      c.value = b.text;
      c.font = f;
      c.alignment = { vertical: 'middle' };
      setHeight(s, s.row, b.level === 1 ? 16 : b.level === 2 ? 14 : 13);
      s.row += 1;
      return;
    }
    // A table.
    if (b.beside) {
      pendingBeside = b;
      return;
    }
    let start = s.row;
    if (pendingBeside) {
      // The side table sits top-right, from row 1, to the right of this one; this table starts below it.
      const at = FIRST_COL + tableWidth(b) + 1;
      const side = renderTable(s, pendingBeside, 1, at);
      start = Math.max(start, side.next + 1);
      s.printCols = FIRST_COL + tableWidth(b) - 1;
      pendingBeside = null;
    }
    const { next, headEnd } = renderTable(s, b, start, FIRST_COL);
    if (b.freeze && s.freezeRow === null && b.head.length) s.freezeRow = headEnd;
    s.row = next;
    // Air after every table.
    setHeight(s, s.row, 8);
    s.row += 1;
  });

  const ySplit = s.freezeRow ?? HEADER_ROWS;
  const xSplit = s.freezeRow && paper.freezeCols ? FIRST_COL - 1 + paper.freezeCols : 0;
  ws.views = [{ state: 'frozen', xSplit, ySplit, topLeftCell: ws.getCell(ySplit + 1, xSplit + 1).address, showGridLines: false, activeCell: 'A1' }];
  ws.pageSetup.printTitlesRow = `1:${ySplit}`;
  // ExcelJS prefixes each side with "$" (column-absolute); the "$" before the row numbers makes the reference fully absolute.
  if (s.printCols) ws.pageSetup.printArea = `A$1:${ws.getColumn(s.printCols).letter}$${Math.max(s.row, ySplit + 1)}`;
}

/** Build the workbook and return its bytes. */
export async function renderWorkbook(set: PaperSet): Promise<ArrayBuffer> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = set.firm;
  wb.lastModifiedBy = set.firm;
  wb.created = new Date();
  wb.title = `Annual Return working papers — ${set.meta.clientName} — FY ${set.meta.financialYear}`;
  wb.company = set.firm;
  const book: BookState = { sheets: new Set(set.papers.map((p) => p.sheet)), anchors: new Map(), pending: [] };
  set.papers.forEach((p) => renderSheet(wb, p, set, book));
  wb.views = [{ x: 0, y: 0, width: 28000, height: 16000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  // Every anchor is known now: a text cell takes its link here, a figure's goes into the file after it is written.
  const figures = new Map<number, Array<{ ref: string; location: string; tooltip: string }>>();
  book.pending.forEach((p) => {
    const { location, tooltip } = linkLocation(book, p.link);
    const cell = p.ws.getCell(p.row, p.col);
    if (p.text !== null) {
      cell.value = { text: p.text, hyperlink: `#${location}`, tooltip };
      return;
    }
    const list = figures.get(p.ws.id) ?? [];
    list.push({ ref: `${colLetter(p.col)}${p.row}`, location, tooltip });
    figures.set(p.ws.id, list);
  });
  return addFigureLinks((await wb.xlsx.writeBuffer()) as ArrayBuffer, figures);
}
