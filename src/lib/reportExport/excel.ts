// Big4-style Excel for every Reports Hub download (about 70 reports, all of
// them a ReportTable). One table becomes a workbook in the firm's working-paper
// house style, as in src/lib/gstr9/export/excel.ts: column A a narrow margin, a
// compact header block (firm, title, identification strip, prepared stamp)
// over a navy rule, an optional stat band, navy table heads, an Arial 9 body
// with hairline grid and zebra, figures stored as numbers and shown as
// 1,23,456.00 with negatives in brackets and nil as a dash, real dates, links
// reading "Open", bold totals with a rule above and a double rule below, notes
// under the table, frozen heads, an autofilter and an A4 print set-up.
//
// What each column and row is (amount, date, TOTAL, period band…) is decided
// once in layout.ts and shared with the PDF, so the two agree. ExcelJS is
// loaded on demand so it never weighs on the main bundle.
import type { Alignment, Borders, Fill, Font, Style, Workbook, Worksheet } from 'exceljs';
import type { ReportKpi, ReportMetaField, ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';
import {
  FIRM, FMT, PALETTE, SENTINEL_RE, TONE, fileBase, kpiText, layoutOf, metaOf, parseDateCell, preparedStamp, sheetName,
  type ColumnSpec, type TableLayout,
} from './layout';

type ExcelJSModule = typeof import('exceljs');

/** The UMD build (browser) exposes the library as the module's default export; the Node build as the module. */
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule;
}

// ── House style ────────────────────────────────────────────────────────────

const ARIAL = 'Arial';
const FIRST_COL = 2; // column B: column A is a narrow margin, as on the firm's sheets
const LINE_PT = 12; // Excel's line pitch for Arial 9 (a wrapped cell's autofit height)
const ROW_PT = 12;
const MAX_LINES = 6;
/**
 * Characters per Excel width unit at Arial 9: the unit is the default font's
 * "0" (Calibri 11, 7 px) and Arial 9 text averages about 5 px a character;
 * bold runs wider. Kept a little short so a wrapped cell is never clipped.
 */
const PER_UNIT = 1.35;
const PER_UNIT_BOLD = 1.15;
const HEAD_RULE = 'FF8EA9DB';

const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (f: Partial<Font> = {}): Partial<Font> => ({ name: ARIAL, size: 9, color: { argb: PALETTE.ink }, ...f });
const edge = (argb: string = PALETTE.grid, style: 'thin' | 'double' | 'medium' = 'thin') => ({ style, color: { argb } });

const GRID: Partial<Borders> = { top: edge(), left: edge(), bottom: edge(), right: edge() };
const TOTAL_RULES: Partial<Borders> = { left: edge(), right: edge(), top: edge(PALETTE.rule), bottom: edge(PALETTE.rule, 'double') };
const SUBTOTAL_RULES: Partial<Borders> = { left: edge(), right: edge(), top: edge(PALETTE.rule), bottom: edge() };

const URL_RE = /^https?:\/\//i;
// Excel's own limits: past them the file opens with a repair prompt.
const MAX_CELL_TEXT = 32_000;
const MAX_LINKS = 60_000; // per sheet (Excel stops at 65,530)
const MAX_URL = 2_000;
const fitText = (s: string): string => (s.length > MAX_CELL_TEXT ? `${s.slice(0, MAX_CELL_TEXT)}…` : s);

/** Header/footer text: "&" starts a code, so a literal one is doubled; each section is kept short. */
const hf = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s).replace(/&/g, '&&');

/** Lines a text needs in a cell of the given width, wrapping at word breaks. */
function linesFor(text: string, width: number, perUnit = PER_UNIT): number {
  // Less the cell's padding and its one-character indent.
  const per = Math.max(4, Math.floor((width - 2) * perUnit));
  let lines = 0;
  for (const para of text.split('\n')) {
    let n = 1;
    let used = 0;
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      let w = word.length;
      if (used && used + 1 + w <= per) { used += 1 + w; continue; }
      if (used) n += 1;
      // A word longer than the line breaks across lines.
      while (w > per) { n += 1; w -= per; }
      used = w;
    }
    lines += n;
  }
  return Math.max(1, lines);
}

const heightFor = (lines: number): number => Math.min(lines, MAX_LINES) * LINE_PT + 1;

// ── Context ────────────────────────────────────────────────────────────────

interface Ctx {
  title: string;
  fields: ReportMetaField[];
  rest: string;
  stamp: string;
  client: string;
  /** Style objects reused across cells (a 3,500-row sheet has a few dozen distinct ones). */
  styles: Map<string, Partial<Style>>;
}

/**
 * The shared style for a key. A cell must only ever get a whole style object
 * (cell.style = …): ExcelJS's font/fill setters write into the cell's style
 * object, which here is shared.
 */
const styleOf = (ctx: Ctx, key: string, make: () => Partial<Style>): Partial<Style> => {
  let s = ctx.styles.get(key);
  if (!s) {
    s = make();
    ctx.styles.set(key, s);
  }
  return s;
};

const widthOf = (widths: number[], from: number, span: number): number => {
  let w = 0;
  for (let i = from; i < from + span && i < widths.length; i++) w += widths[i];
  return w;
};

// ── Header block ───────────────────────────────────────────────────────────

/** Strip pairs laid across the table's columns, row by row; a pair takes as many columns as its text needs. */
function placeStrip(fields: ReportMetaField[], widths: number[], maxRows: number): { col: number; f: ReportMetaField }[][] {
  const rows: { col: number; f: ReportMetaField }[][] = [];
  let cur: { col: number; f: ReportMetaField }[] = [];
  let col = 0;
  const spanFrom = (start: number, need: number) => {
    let span = 0;
    let w = 0;
    while (start + span < widths.length && w < need) w += widths[start + span++];
    return { span, fits: w >= need };
  };
  for (const f of fields) {
    // Label in regular, value in bold, then a gap before the next pair.
    const need = (f.label.length + 2) / PER_UNIT + f.value.length / PER_UNIT_BOLD + 3;
    const here = spanFrom(col, need);
    let span = here.span;
    if (!here.fits && cur.length && rows.length + 1 < maxRows) {
      rows.push(cur);
      cur = [];
      col = 0;
      span = spanFrom(col, need).span;
    }
    cur.push({ col, f });
    // Past the last column the text simply runs on into the empty cells.
    col += Math.max(1, span);
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Firm, title, identification strip, the rest of the subtitle, the prepared stamp, a navy rule. At most 7 rows. */
function headerBlock(ws: Worksheet, ctx: Ctx, widths: number[]): number {
  const n = widths.length;
  const plain = styleOf(ctx, 'hb:plain', () => ({ alignment: { vertical: 'middle' } }));
  let r = 1;

  const firm = ws.getCell(r, FIRST_COL);
  firm.value = {
    richText: [
      { text: FIRM.name, font: font({ bold: true, size: 12, color: { argb: PALETTE.navy } }) },
      { text: `   ${FIRM.designation}`, font: font({ size: 9, color: { argb: PALETTE.muted } }) },
    ],
  };
  firm.style = plain;
  ws.getRow(r++).height = 17;

  const title = ws.getCell(r, FIRST_COL);
  title.value = ctx.title;
  title.style = styleOf(ctx, 'hb:title', () => ({ font: font({ bold: true, size: 13, color: { argb: PALETTE.navy } }), alignment: { vertical: 'middle' } }));
  ws.getRow(r++).height = 19;

  const labelFont = font({ color: { argb: PALETTE.muted } });
  const valueFont = font({ bold: true });
  const strip = placeStrip(ctx.fields, widths, 7 - 3 - (ctx.rest ? 1 : 0));
  for (const line of strip) {
    for (const { col, f } of line) {
      const c = ws.getCell(r, FIRST_COL + col);
      c.value = { richText: [{ text: `${f.label}: `, font: labelFont }, { text: f.value, font: valueFont }] };
      c.style = plain;
    }
    ws.getRow(r++).height = 13.5;
  }

  if (ctx.rest) {
    // Wrapped across the table's width, as the PDF's letterhead wraps it: a
    // long note (a merge's per-year notes) run on past the table would make
    // the printed sheet shrink to fit it.
    if (n > 1) ws.mergeCells(r, FIRST_COL, r, FIRST_COL + n - 1);
    const c = ws.getCell(r, FIRST_COL);
    c.value = fitText(ctx.rest);
    c.style = styleOf(ctx, 'hb:rest', () => ({ font: font({ italic: true, color: { argb: PALETTE.muted } }), alignment: { vertical: 'top', wrapText: true } }));
    const lines = Math.min(linesFor(ctx.rest, widthOf(widths, 0, n)), 6);
    ws.getRow(r++).height = lines > 1 ? lines * LINE_PT + 2 : 13;
  }

  // The prepared line carries the rule under the block, across the table's width.
  const rule: Partial<Borders> = { bottom: edge(PALETTE.navy) };
  for (let k = 0; k < n; k++) {
    const c = ws.getCell(r, FIRST_COL + k);
    if (k === 0) {
      c.value = `Prepared ${ctx.stamp}  ·  GST Keeper`;
      c.style = styleOf(ctx, 'hb:prepared', () => ({ font: font({ size: 8.5, color: { argb: PALETTE.muted } }), alignment: { vertical: 'middle' }, border: rule }));
    } else {
      c.style = styleOf(ctx, 'hb:rule', () => ({ border: rule }));
    }
  }
  ws.getRow(r++).height = 14;
  ws.getRow(r++).height = 7;
  return r;
}

// ── Stat band ──────────────────────────────────────────────────────────────

const KPI_MIN = 14; // a box narrower than this cannot show "(1,23,45,678.00)"
const KPI_MAX = 34; // wider than this a box reads as a banner, not a figure

/**
 * The best split of the leading columns into `p` boxes of about `target`
 * width (least squares over every prefix of the columns), each box a run of
 * whole columns at least KPI_MIN wide and none more than about twice another;
 * null when the columns cannot make `p` such boxes.
 */
function kpiRuns(widths: number[], p: number, target: number): [number, number][] | null {
  const n = widths.length;
  const pre = [0];
  for (const w of widths) pre.push(pre[pre.length - 1] + w);
  const cost = Array.from({ length: p + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: p + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let k = 1; k <= p; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        const w = pre[j] - pre[i];
        if (cost[k - 1][i] === Infinity || w < KPI_MIN) continue;
        const c = cost[k - 1][i] + (w - target) ** 2;
        if (c < cost[k][j]) { cost[k][j] = c; from[k][j] = i; }
      }
    }
  }
  let best: { runs: [number, number][]; cost: number } | null = null;
  for (let m = p; m <= n; m++) {
    if (cost[p][m] === Infinity || (best && cost[p][m] >= best.cost)) continue;
    const runs: [number, number][] = [];
    for (let k = p, j = m; k >= 1; k--) {
      const i = from[k][j];
      runs.unshift([i, j - i]);
      j = i;
    }
    const sizes = runs.map(([s, len]) => pre[s + len] - pre[s]);
    if (Math.max(...sizes) > 2.2 * Math.min(...sizes)) continue;
    best = { runs, cost: cost[p][m] };
  }
  return best?.runs ?? null;
}

/**
 * Where the KPI boxes go: as few bands as the table's columns allow, each box
 * a run of whole columns (two or more where the columns are narrow) of
 * roughly equal width, so the boxes line up from band to band even when the
 * table's own columns are uneven. The boxes fill the table's width up to a
 * sensible box width, and stop there on a very wide table.
 */
function kpiLayout(widths: number[], count: number): { per: number; runs: [number, number][] } {
  const total = widthOf(widths, 0, widths.length);
  for (let bands = 1; bands <= count; bands++) {
    const per = Math.ceil(count / bands);
    if (bands > 1 && Math.ceil(count / (bands - 1)) === per) continue;
    if (per > widths.length) continue;
    const runs = kpiRuns(widths, per, Math.min(KPI_MAX, total / per));
    if (runs) return { per, runs };
  }
  // Columns too narrow for any box: one KPI a band, across the table.
  return { per: 1, runs: [[0, widths.length]] };
}

/** Label cells over value cells (and a note row when a KPI has one), wrapping onto further bands. */
function kpiBand(ws: Worksheet, ctx: Ctx, widths: number[], kpis: ReportKpi[], start: number): number {
  const { per, runs } = kpiLayout(widths, kpis.length);
  const bands = Math.ceil(kpis.length / per);
  const gutter = edge(PALETTE.white, 'medium');
  const labelStyle = styleOf(ctx, 'kpi:label', () => ({
    font: font({ bold: true, size: 8.5, color: { argb: PALETTE.white } }),
    fill: solid(PALETTE.navy),
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: { left: gutter, right: gutter },
  }));
  const valueStyle = (tone: RowTone | undefined, last: boolean) => styleOf(ctx, `kpi:value:${tone ?? ''}:${last ? 1 : 0}`, () => ({
    font: font({ bold: true, size: 10.5, color: { argb: tone ? TONE[tone].ink : PALETTE.navy } }),
    fill: solid(tone ? TONE[tone].fill : PALETTE.band),
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: { left: gutter, right: gutter, ...(last ? { bottom: edge(PALETTE.navy) } : {}) },
  }));
  const noteStyle = (tone: RowTone | undefined) => styleOf(ctx, `kpi:note:${tone ?? ''}`, () => ({
    font: font({ italic: true, size: 8, color: { argb: tone ? TONE[tone].ink : PALETTE.inkSoft } }),
    fill: solid(tone ? TONE[tone].fill : PALETTE.band),
    alignment: { horizontal: 'center', vertical: 'top' },
    border: { left: gutter, right: gutter, bottom: edge(PALETTE.navy) },
  }));

  let r = start;
  for (let b = 0; b < bands; b++) {
    const items = kpis.slice(b * per, (b + 1) * per);
    const hasNote = items.some((k) => k.note);
    let lines = 1;
    items.forEach((k, i) => {
      const [c0, span] = runs[i];
      const from = FIRST_COL + c0;
      const to = from + span - 1;
      if (span > 1) {
        ws.mergeCells(r, from, r, to);
        ws.mergeCells(r + 1, from, r + 1, to);
        if (hasNote) ws.mergeCells(r + 2, from, r + 2, to);
      }
      for (let c = from; c <= to; c++) {
        ws.getCell(r, c).style = labelStyle;
        ws.getCell(r + 1, c).style = valueStyle(k.tone, !hasNote);
        if (hasNote) ws.getCell(r + 2, c).style = noteStyle(k.tone);
      }
      ws.getCell(r, from).value = k.label;
      ws.getCell(r + 1, from).value = kpiText(k);
      if (hasNote && k.note) ws.getCell(r + 2, from).value = k.note;
      lines = Math.max(lines, linesFor(k.label, widthOf(widths, c0, span), PER_UNIT_BOLD));
    });
    ws.getRow(r).height = Math.max(15, Math.min(lines, 3) * 10.5 + 4);
    ws.getRow(r + 1).height = 20;
    if (hasNote) ws.getRow(r + 2).height = 12;
    r += hasNote ? 3 : 2;
    // A thin gap between bands.
    if (b < bands - 1) ws.getRow(r++).height = 4;
  }
  ws.getRow(r++).height = 9;
  return r;
}

// ── Table ──────────────────────────────────────────────────────────────────

type Flavour = 'num' | 'gen' | 'date' | 'text' | 'link' | 'sentinel' | 'empty';

interface Placed {
  groupRow: number | null;
  headRow: number;
  /** The last row inside the autofilter (a trailing TOTAL stays outside). */
  filterTo: number;
  next: number;
}

/** The style of one body cell; built once per distinct combination. */
function bodyStyle(ctx: Ctx, col: ColumnSpec, flavour: Flavour, kind: RowKind, zebra: boolean, tone: RowTone | null, side: number, label: boolean): Partial<Style> {
  // Keyed by what the style depends on, not the column's position: the cache spans every sheet.
  const key = `b:${col.kind}:${col.align}:${col.wrap ? 1 : 0}:${flavour}:${kind}:${zebra ? 1 : 0}:${tone ?? ''}:${side}:${label ? 1 : 0}`;
  return styleOf(ctx, key, () => {
    const strong = kind === 'total' || kind === 'subtotal' || kind === 'section' || !!tone;
    const ink = tone ? { color: { argb: TONE[tone].ink } }
      : flavour === 'link' ? { color: { argb: PALETTE.link }, underline: true as const }
        : flavour === 'sentinel' ? { italic: true, color: { argb: PALETTE.muted } }
          : {};
    const fill = tone ? solid(TONE[tone].fill)
      : kind === 'total' ? solid(PALETTE.band)
        : kind === 'subtotal' || kind === 'section' ? solid(PALETTE.bandSoft)
          : zebra ? solid(PALETTE.zebra) : undefined;
    // A section heading reads as one band: no rules inside it, so its label runs across.
    const border = kind === 'total' ? TOTAL_RULES
      : kind === 'subtotal' ? SUBTOTAL_RULES
        : kind === 'section' ? { top: edge(), bottom: edge(), ...(side & 1 ? { left: edge() } : {}), ...(side & 2 ? { right: edge() } : {}) }
          : GRID;
    const alignment: Partial<Alignment> = {
      horizontal: label ? 'left' : flavour === 'link' ? 'center' : col.align,
      vertical: 'top',
      // Words get a character of air off the rule; figures carry their own in the number format.
      ...(flavour === 'num' || flavour === 'link' || (!label && col.align !== 'left') ? {} : { indent: 1 }),
      ...(flavour === 'text' && col.wrap && kind === 'data' ? { wrapText: true } : {}),
    };
    const numFmt = flavour === 'num' ? (col.kind === 'int' ? FMT.int : col.kind === 'rate' ? FMT.rate : FMT.amount)
      : flavour === 'date' ? FMT.date : undefined;
    return {
      font: font({ ...(strong ? { bold: true } : {}), ...ink }),
      alignment,
      border,
      ...(fill ? { fill } : {}),
      ...(numFmt ? { numFmt } : {}),
    };
  });
}

/** Column groups, the header row, the body and an empty-table line. */
function renderTable(ws: Worksheet, ctx: Ctx, l: TableLayout, start: number): Placed {
  const n = l.columns.length;
  const last = FIRST_COL + n - 1;
  const widths = l.columns.map((c) => c.width);
  let r = start;

  // Column-group band.
  let groupRow: number | null = null;
  if (l.groups) {
    groupRow = r;
    let c = 0;
    let lines = 1;
    for (const g of l.groups) {
      const from = FIRST_COL + c;
      if (g.span > 1) ws.mergeCells(r, from, r, from + g.span - 1);
      const st = styleOf(ctx, `group:${g.tone ?? ''}`, () => ({
        font: font({ bold: true, color: { argb: PALETTE.white } }),
        fill: solid(g.tone ? TONE[g.tone].ink : PALETTE.navyLight),
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
        border: { left: edge(PALETTE.white), right: edge(PALETTE.white), top: edge(PALETTE.navy) },
      }));
      for (let k = 0; k < g.span; k++) ws.getCell(r, from + k).style = st;
      ws.getCell(r, from).value = g.label;
      lines = Math.max(lines, linesFor(g.label, widthOf(widths, c, g.span), PER_UNIT_BOLD));
      c += g.span;
    }
    ws.getRow(r++).height = Math.max(15, Math.min(lines, 3) * LINE_PT + 3);
  }

  // Header row: the printed label (headerLabels), the unique header behind it.
  const headRow = r;
  let headLines = 1;
  l.columns.forEach((col, k) => {
    const cell = ws.getCell(r, FIRST_COL + k);
    cell.value = col.label;
    cell.style = styleOf(ctx, `head:${col.align}`, () => ({
      font: font({ bold: true, color: { argb: PALETTE.white } }),
      fill: solid(PALETTE.navy),
      alignment: { horizontal: col.align, vertical: 'middle', wrapText: true, ...(col.align === 'center' ? {} : { indent: 1 }) },
      border: { top: edge(PALETTE.navy), bottom: edge(PALETTE.navy), left: edge(HEAD_RULE), right: edge(HEAD_RULE) },
    }));
    headLines = Math.max(headLines, linesFor(col.label, col.width, PER_UNIT_BOLD));
  });
  ws.getRow(r++).height = Math.max(15, Math.min(headLines, 4) * LINE_PT + 4);

  // Body.
  const bodyStart = r;
  let zebra = 0;
  let links = 0;
  for (let i = 0; i < l.rows.length; i++, r++) {
    const kind = l.kinds[i];
    const src = l.rows[i];
    const xrow = ws.getRow(r);
    if (kind === 'blank') {
      xrow.height = 8;
      zebra = 0;
      continue;
    }
    if (kind === 'period') {
      // Not merged: the band sits inside the autofilter range, and Excel will
      // not sort a range holding merged cells. The label overflows into the
      // empty cells beside it, and no inner rules keep the band one piece.
      const st = styleOf(ctx, 'period', () => ({
        font: font({ bold: true, color: { argb: PALETTE.navy } }),
        fill: solid(PALETTE.band),
        alignment: { horizontal: 'left', vertical: 'middle', indent: 1 },
        border: { top: edge(PALETTE.navy), bottom: GRID.bottom },
      }));
      for (let c = FIRST_COL; c <= last; c++) xrow.getCell(c).style = st;
      xrow.getCell(FIRST_COL).value = String(src[0] ?? '');
      xrow.height = 15;
      zebra = 0;
      continue;
    }
    const isData = kind === 'data';
    const striped = isData && zebra++ % 2 === 1;
    if (!isData) zebra = 0;
    const labelRow = kind === 'total' || kind === 'subtotal' || kind === 'section';
    let lines = 1;
    for (let c = 0; c < n; c++) {
      const col = l.columns[c];
      const v = src[c];
      const cell = xrow.getCell(FIRST_COL + c);
      let flavour: Flavour = 'empty';
      if (typeof v === 'number') {
        if (Number.isFinite(v)) {
          flavour = col.kind === 'amount' || col.kind === 'int' || col.kind === 'rate' ? 'num' : 'gen';
          cell.value = v;
        }
      } else if (v !== null && v !== undefined && v !== '') {
        const s = String(v);
        const t = s.trim();
        const date = col.kind === 'date' ? parseDateCell(t) : null;
        if (URL_RE.test(t) && t.length <= MAX_URL && links < MAX_LINKS) {
          flavour = 'link';
          links += 1;
          cell.value = { text: 'Open', hyperlink: t, tooltip: t.slice(0, 250) };
        } else if (SENTINEL_RE.test(t)) {
          flavour = 'sentinel';
          cell.value = s;
        } else if (date) {
          flavour = 'date';
          cell.value = date;
        } else {
          flavour = 'text';
          cell.value = fitText(s);
          if (col.wrap && isData) lines = Math.max(lines, linesFor(s.slice(0, 2000), col.width));
        }
      }
      const tone = c === l.toneColumn ? l.tones[i] : null;
      // Labels of TOTAL and section rows sit at the left, whatever the column's own alignment.
      const label = labelRow && c < 3 && (flavour === 'text' || flavour === 'sentinel');
      const side = kind === 'section' ? (c === 0 ? 1 : 0) | (c === n - 1 ? 2 : 0) : 0;
      cell.style = bodyStyle(ctx, col, flavour, kind, striped, tone, side, label);
    }
    if (lines > 1) xrow.height = heightFor(lines);
    else if (kind !== 'data') xrow.height = 13.5;
  }

  if (!l.rows.length) {
    if (n > 1) ws.mergeCells(r, FIRST_COL, r, last);
    const c = ws.getCell(r, FIRST_COL);
    c.value = 'No records for this report.';
    const st = styleOf(ctx, 'empty-table', () => ({ font: font({ italic: true, color: { argb: PALETTE.muted } }), alignment: { horizontal: 'left', vertical: 'middle', indent: 1 }, border: GRID }));
    for (let k = FIRST_COL; k <= last; k++) ws.getCell(r, k).style = st;
    ws.getRow(r++).height = 15;
  }

  // The filter runs to the last data row: a trailing TOTAL (and any blank before it) stays outside.
  let end = l.rows.length - 1;
  while (end >= 0 && (l.kinds[end] === 'total' || l.kinds[end] === 'blank')) end--;
  const filterTo = end >= 0 ? bodyStart + end : headRow;
  return { groupRow, headRow, filterTo, next: r };
}

// ── Notes and headings ─────────────────────────────────────────────────────

function heading(ws: Worksheet, ctx: Ctx, text: string, r: number): number {
  const c = ws.getCell(r, FIRST_COL);
  c.value = text;
  c.style = styleOf(ctx, 'heading', () => ({ font: font({ bold: true, size: 11, color: { argb: PALETTE.navy } }), alignment: { vertical: 'bottom' } }));
  ws.getRow(r).height = 17;
  return r + 1;
}

/** "Notes" in bold, then one merged, wrapped row per note across the table. */
function notesBlock(ws: Worksheet, ctx: Ctx, notes: string[], widths: number[], start: number): number {
  if (!notes.length) return start;
  const n = widths.length;
  const total = widthOf(widths, 0, n);
  let r = start;
  ws.getRow(r++).height = 9;
  const head = ws.getCell(r, FIRST_COL);
  head.value = 'Notes';
  head.style = styleOf(ctx, 'notes:head', () => ({ font: font({ bold: true, color: { argb: PALETTE.navy } }), alignment: { vertical: 'bottom' } }));
  ws.getRow(r++).height = 14;
  const st = styleOf(ctx, 'notes:body', () => ({ font: font({ color: { argb: PALETTE.inkSoft } }), alignment: { vertical: 'top', wrapText: true } }));
  for (const note of notes) {
    if (n > 1) ws.mergeCells(r, FIRST_COL, r, FIRST_COL + n - 1);
    const c = ws.getCell(r, FIRST_COL);
    c.value = fitText(`•  ${note}`);
    c.style = st;
    ws.getRow(r++).height = Math.min(linesFor(`•  ${note}`, total), 10) * LINE_PT + 2;
  }
  return r;
}

// ── Sheets ─────────────────────────────────────────────────────────────────

interface SheetOpts {
  kpis?: ReportKpi[];
  heading?: string;
  freezeColumns?: number;
  tab: string;
}

function addSheet(wb: Workbook, ctx: Ctx, used: Set<string>, name: string, l: TableLayout, o: SheetOpts): Worksheet {
  const n = l.columns.length;
  const ws = wb.addWorksheet(sheetName(name, used), {
    properties: { tabColor: { argb: o.tab }, defaultRowHeight: ROW_PT },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: n > 8 ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      // A space after each size code, so text starting with a digit is not read as part of it.
      oddHeader: `&L&"${ARIAL},Regular"&8 ${hf(FIRM.name, 40)}&C&"${ARIAL},Bold"&9 ${hf(ctx.title, 70)}&R&"${ARIAL},Regular"&8 ${hf(ctx.client, 45)}`,
      oddFooter: `&L&"${ARIAL},Italic"&7 ${hf(`${FIRM.footer}  ·  Prepared ${ctx.stamp}`, 90)}&R&"${ARIAL},Regular"&7 Page &P of &N`,
    },
  });
  ws.getColumn(1).width = 2;
  l.columns.forEach((c, i) => { ws.getColumn(FIRST_COL + i).width = c.width; });
  const widths = l.columns.map((c) => c.width);

  let r = headerBlock(ws, ctx, widths);
  if (o.kpis?.length) r = kpiBand(ws, ctx, widths, o.kpis, r);
  if (o.heading) r = heading(ws, ctx, o.heading, r);
  const placed = renderTable(ws, ctx, l, r);
  notesBlock(ws, ctx, l.notes, widths, placed.next);

  // Frozen below the head and after the margin (plus the report's key columns); filter over the data.
  const xSplit = 1 + Math.max(0, Math.min(o.freezeColumns ?? 0, n - 1));
  const ySplit = placed.headRow;
  const topLeftCell = ws.getCell(ySplit + 1, xSplit + 1).address;
  ws.views = [{ state: 'frozen', xSplit, ySplit, topLeftCell, activeCell: topLeftCell, showGridLines: false, zoomScale: 100 }];
  ws.autoFilter = { from: { row: placed.headRow, column: FIRST_COL }, to: { row: placed.filterTo, column: FIRST_COL + n - 1 } };
  ws.pageSetup.printTitlesRow = `${placed.groupRow ?? placed.headRow}:${placed.headRow}`;
  return ws;
}

// ── API ────────────────────────────────────────────────────────────────────

/**
 * The workbook of one report: a Summary sheet first when the report has one
 * (with the stat band), the main table (named table.sheetName, else
 * "Documents" beside a summary, else "Report"), then one sheet per extra table.
 */
export async function buildReportWorkbook(table: ReportTable, opts: { now?: Date } = {}): Promise<Workbook> {
  const ExcelJS = await loadExcelJS();
  const now = opts.now ?? new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = FIRM.name;
  wb.lastModifiedBy = FIRM.name;
  wb.company = FIRM.name;
  wb.title = table.title;
  wb.created = now;
  wb.modified = now;

  const { fields, rest } = metaOf(table);
  const client = fields.find((f) => /^client\b/i.test(f.label))?.value ?? fields[0]?.value ?? '';
  const ctx: Ctx = { title: table.title, fields, rest, stamp: preparedStamp(now), client, styles: new Map() };
  const used = new Set<string>();
  const kpis = table.kpis?.length ? table.kpis : undefined;

  if (table.summary) {
    addSheet(wb, ctx, used, 'Summary', layoutOf(table.summary, table.summary.title), { kpis, heading: table.summary.title, tab: PALETTE.navy });
  }
  addSheet(wb, ctx, used, table.sheetName ?? (table.summary ? 'Documents' : 'Report'), layoutOf(table), {
    kpis: table.summary ? undefined : kpis,
    freezeColumns: table.freezeColumns,
    tab: table.summary ? PALETTE.navyLight : PALETTE.navy,
  });
  for (const x of table.extraSheets ?? []) {
    addSheet(wb, ctx, used, x.name, layoutOf(x, x.title), { heading: x.title, freezeColumns: x.freezeColumns, tab: PALETTE.muted });
  }
  wb.views = [{ x: 0, y: 0, width: 28000, height: 16000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  return wb;
}

/** The report as .xlsx bytes. */
export async function reportToXlsx(table: ReportTable, opts: { now?: Date } = {}): Promise<Uint8Array> {
  const wb = await buildReportWorkbook(table, opts);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Build the report's workbook and hand it to the browser as <fileNameBase>.xlsx. */
export async function downloadReportXlsx(table: ReportTable): Promise<void> {
  const wb = await buildReportWorkbook(table);
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase(table.fileNameBase)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked a moment later: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
