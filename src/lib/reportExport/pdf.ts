// Every Reports Hub download as a PDF in the firm's Big4 working-paper style.
//
// A4, landscape when a printed table has more than seven columns. Page 1
// carries the letterhead (logo, report title, the identification strip) and
// the stat band; then the summary with its notes, the document list, and each
// extra analysis table from a new page. Tables have navy heads repeated on
// every page, hairline rules, figures right-aligned as 1,23,456.00 with
// negatives in brackets and nil as a dash, period bands across the full
// width, bold totals with a rule above and a double rule under the figures,
// and status carried by its word (the tint behind it only helps: these papers
// get photocopied in mono). Later pages carry a slim running header; every
// page the firm's footer and "Page x of y".
//
// What a column or row IS (amount, date, link; total, period band, section)
// and how a figure reads come from layout.ts, shared with the Excel, so the
// two downloads never disagree. This file only decides how it is drawn.
import jsPDF from 'jspdf';
import autoTable, {
  __createTable, __drawTable, type CellDef, type CellHookData, type RowInput, type Styles, type UserOptions,
} from 'jspdf-autotable';
import type { ReportKpi, ReportMetaField, ReportTable, RowKind, RowTone } from '@/utils/allClientsReports';
import { drawFirmLogo, drawFooters, drawSectionTitle, drawStatBand, type StatTile } from '@/utils/reportTheme';
import { pdfText } from '@/lib/gstr9/export/chrome';
import {
  cellText, fileBase, FIRM, kpiText, layoutOf, metaOf, PALETTE, preparedStamp, project, rgb, TONE,
  type ColumnSpec, type TableLayout,
} from './layout';
import { docHrefAbsolute } from '@/lib/docLinks';

type RGB = [number, number, number];

const NAVY = rgb(PALETTE.navy);
const NAVY_LIGHT = rgb(PALETTE.navyLight);
const BAND = rgb(PALETTE.band);
const BAND_SOFT = rgb(PALETTE.bandSoft);
const ZEBRA = rgb(PALETTE.zebra);
const GRID = rgb(PALETTE.grid);
const INK = rgb(PALETTE.ink);
const INK_SOFT = rgb(PALETTE.inkSoft);
const MUTED = rgb(PALETTE.muted);
const WHITE = rgb(PALETTE.white);
const LINK = rgb(PALETTE.link);
/** The rules between head cells: a light blue that reads as a gap on the navy, so grouped columns read as groups (as in the GSTR-9 papers). */
const HEAD_RULE: RGB = [142, 169, 219];

/** Side margin: the shared helpers (stat band, section titles, notes, footers) all draw at 14 mm. */
const M = 14;
/** Where content resumes on a page after the first, below the running header. */
const TOP = 17;
/** Kept clear above drawFooters' rule, 12 mm from the bottom edge. */
const BOTTOM = 17;
/** No printed column is narrower than this; a table that cannot keep it is split instead. */
export const MIN_COL_MM = 12;
const PAD_X = 1.4;
const PAD_Y = 0.85;
/** autotable splits a line at its width plus 1 pt; this keeps a figure clear of that edge. */
const SLACK = 0.8;
const HEAD_FS = 7.5;
/** Body sizes tried in turn before a table is split across pages sideways. */
const BODY_FS = [7.5, 7];
/**
 * The widest a column gets per Excel width unit. A table whose columns would
 * need more than this to fill the page (five short columns on a landscape
 * page) stays its natural width, rather than parking each figure a hand's
 * width from its label.
 */
const MM_PER_UNIT_MAX = 2.4;
/** One enormous token (a pasted URL in a remark) may not force a column wider than this; it breaks instead. */
const WORD_CAP_MM = 60;
/** The identity columns repeated on each part of a split table take at most this share of the width. */
const IDENTITY_SHARE = 0.45;
/** A repeated identity column (a supplier's name) gets up to this much so it reads on one line. */
const COMFORT_MAX_MM = 48;
/** Room a figure column gets beyond its widest figure before the spare width goes to text. */
const FIGURE_AIR_MM = 3;
/** Stat tiles per row: about 30 mm each, room for 1,23,45,678.00 at 11 pt. */
const KPI_PER_ROW = { l: 9, p: 6 };

/**
 * A tone printed without a note still needs a word: colour alone does not
 * survive a mono photocopy. "info" is neutral and gets no tint at all.
 */
const TONE_WORD: Record<RowTone, string | null> = {
  good: 'In order',
  warn: 'Review',
  bad: 'Action needed',
  info: null,
  muted: 'For information',
};

const URL_RE = /^https?:\/\/\S+$/i;
const isUrl = (v: unknown): v is string => typeof v === 'string' && URL_RE.test(v.trim());
const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** The words a link cell prints: a raw storage URL is 100+ characters and useless on paper. */
const linkLabel = (col: ColumnSpec, url: string): string =>
  (/\bpdf\b/i.test(col.header) || /\.pdf(\?|#|$)/i.test(url) ? 'View PDF' : 'Open link');

interface Shown { text: string; url?: string }

function shown(v: string | number | undefined, col: ColumnSpec, link: boolean): Shown {
  if (link && isUrl(v)) return { text: linkLabel(col, v), url: docHrefAbsolute(v.trim()) };
  return { text: pdfText(cellText(v ?? '', col)) };
}

// ── Document state ─────────────────────────────────────────────────────────

interface St {
  doc: jsPDF;
  W: number;
  H: number;
  y: number;
  landscape: boolean;
}

const avail = (st: St): number => st.W - 2 * M;

const newPage = (st: St): void => {
  st.doc.addPage();
  st.y = TOP;
};

/** Start a new page unless `need` mm still fit above the footer. */
const ensure = (st: St, need: number): void => {
  if (st.y + need > st.H - BOTTOM) newPage(st);
};

const font = (doc: jsPDF, size: number, style: 'normal' | 'bold' | 'italic' = 'normal', colour: RGB = INK): void => {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  doc.setTextColor(...colour);
};

/** Shorten one line to `width` mm at the current font, marking the cut. */
const fitLine = (doc: jsPDF, text: string, width: number): string => {
  if (doc.getTextWidth(text) <= width) return text;
  let s = text;
  while (s.length > 4 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
};

// ── Page 1: letterhead, identification strip, stat band ───────────────────

/** Logo left, title right (wrapping clear of the logo), the subtitle's remainder under it, a navy rule. */
function letterhead(st: St, title: string, rest: string): number {
  const { doc, W } = st;
  const logoW = 56;
  drawFirmLogo(doc, { width: logoW, y: 11, x: M });
  const room = W - 2 * M - logoW - 10;
  let y = 16;
  font(doc, 12, 'bold');
  (doc.splitTextToSize(pdfText(title), room) as string[]).forEach((line) => {
    doc.text(line, W - M, y, { align: 'right' });
    y += 5.2;
  });
  if (rest) {
    font(doc, 8.5, 'normal', MUTED);
    y += 0.3;
    (doc.splitTextToSize(pdfText(rest), room) as string[]).forEach((line) => {
      doc.text(line, W - M, y, { align: 'right' });
      y += 3.8;
    });
  }
  const ruleY = Math.max(25, y - 1);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.6);
  doc.line(M, ruleY, W - M, ruleY);
  return ruleY;
}

/**
 * The identification strip: a small grey label above the bold value, laid on
 * a grid of equal cells (four across portrait, six landscape) so the fields
 * line up; a long value takes two or more cells, and one longer than the
 * whole width wraps (an identification is never cut short). Returns the next y.
 */
function idStrip(st: St, fields: ReportMetaField[], top: number): number {
  const { doc } = st;
  if (!fields.length) return top + 4;
  const units = st.landscape ? 6 : 4;
  const unitW = avail(st) / units;
  const VALUE_LH = 4;
  let col = 0;
  let y = top + 5;
  /** Extra height of the current row, for a value that wrapped. */
  let extra = 0;
  fields.forEach((f) => {
    const label = pdfText(f.label);
    const value = pdfText(f.value || '—');
    font(doc, 7, 'normal');
    const lw = doc.getTextWidth(label);
    font(doc, 9, 'bold');
    const vw = doc.getTextWidth(value);
    const take = Math.min(units, Math.max(1, Math.ceil((Math.max(lw, vw) + 5) / unitW)));
    if (col + take > units) {
      col = 0;
      y += 9.5 + extra;
      extra = 0;
    }
    const x = M + col * unitW;
    const room = take * unitW - 4;
    font(doc, 7, 'normal', MUTED);
    doc.text(fitLine(doc, label, room), x, y);
    font(doc, 9, 'bold', INK);
    const lines = doc.splitTextToSize(value, room) as string[];
    lines.forEach((line, i) => doc.text(line, x, y + 4.5 + i * VALUE_LH));
    extra = Math.max(extra, (lines.length - 1) * VALUE_LH);
    col += take;
  });
  y += 8 + extra;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.2);
  doc.line(M, y, st.W - M, y);
  return y + 5;
}

function kpiBand(st: St, kpis: ReportKpi[]): void {
  const tiles: StatTile[] = kpis.map((k) => {
    const note = k.note || (k.tone ? TONE_WORD[k.tone] : null) || undefined;
    return {
      label: pdfText(k.label),
      value: pdfText(kpiText(k)),
      note: note ? pdfText(note) : undefined,
      // The tint only ever sits beside a word.
      accent: note && k.tone && TONE_WORD[k.tone] !== null ? rgb(TONE[k.tone].ink) : undefined,
    };
  });
  const max = st.landscape ? KPI_PER_ROW.l : KPI_PER_ROW.p;
  const rows = Math.ceil(tiles.length / max);
  st.y = drawStatBand(st.doc, tiles, st.y, { perRow: Math.ceil(tiles.length / rows) });
}

// ── Section furniture ─────────────────────────────────────────────────────

/** A section title kept with the head and first rows of its table. */
function sectionTitle(st: St, text: string): void {
  ensure(st, 30);
  st.y = drawSectionTitle(st.doc, pdfText(text), st.y + 3.6);
}

/** Notes as bulleted lines with a hanging indent, muted 7.5, breaking across pages. */
function notes(st: St, list: string[]): void {
  const items = list.map((n) => pdfText(n).trim()).filter(Boolean);
  if (!items.length) return;
  const { doc } = st;
  const lh = 3.3;
  st.y += 2;
  ensure(st, 10);
  font(doc, 8, 'bold', INK_SOFT);
  doc.text('Notes', M, st.y + 2.8);
  st.y += 5;
  font(doc, 7.5, 'normal', MUTED);
  items.forEach((note) => {
    const lines = doc.splitTextToSize(note, avail(st) - 4) as string[];
    lines.forEach((line, i) => {
      ensure(st, lh);
      font(doc, 7.5, 'normal', MUTED);
      if (i === 0) doc.text('•', M + 0.6, st.y + 2.6);
      doc.text(line, M + 4, st.y + 2.6);
      st.y += lh;
    });
    st.y += 0.9;
  });
}

/** A one-line italic remark above a table (how a split table is printed). */
function caption(st: St, text: string): void {
  ensure(st, 28);
  font(st.doc, 7, 'italic', MUTED);
  st.doc.text(fitLine(st.doc, pdfText(text), avail(st)), M, st.y + 2.6);
  st.y += 4.5;
}

// ── Column widths ──────────────────────────────────────────────────────────

/** Columns whose cells hold links: the layout's url kind, or any column a URL turns up in (a "PDF" column with a "NOT PULLED" sentinel). */
const linkColumns = (l: TableLayout): boolean[] =>
  l.columns.map((c) => c.kind === 'url' || l.rows.some((r, i) => l.kinds[i] === 'data' && isUrl(r[c.index])));

/** Every cell's printed text, worked out once per table (measuring and drawing both read it). */
const shownCache = new WeakMap<TableLayout, { links: boolean[]; cells: Shown[][] }>();
function shownOf(l: TableLayout): { links: boolean[]; cells: Shown[][] } {
  let hit = shownCache.get(l);
  if (!hit) {
    const links = linkColumns(l);
    hit = { links, cells: l.rows.map((r) => l.columns.map((c, ci) => shown(r[ci], c, links[ci]))) };
    shownCache.set(l, hit);
  }
  return hit;
}

/** Figures, counts, rates, dates and links never wrap; free text may. */
const noWrap = (c: ColumnSpec, link: boolean): boolean => link || c.kind !== 'text';

const longestWord = (doc: jsPDF, s: string): number =>
  s.split(/\s+/).reduce((m, w) => (w ? Math.max(m, doc.getTextWidth(w)) : m), 0);

interface Metrics {
  /** The narrowest each column may print without breaking a figure or a word (never under MIN_COL_MM). */
  min: number[];
  /**
   * The widest it is worth making: a figure's own width and a little air; a
   * text column's longest line. Beyond this, width only helps the columns
   * that still wrap.
   */
  max: number[];
  /** Wide enough that a text column's cells read on one line (up to COMFORT_MAX_MM); a figure's minimum. */
  comfort: number[];
  /** The Excel widths, which set the proportions. */
  base: number[];
}

function measure(doc: jsPDF, l: TableLayout, fs: number): Metrics {
  const n = l.columns.length;
  const { links, cells } = shownOf(l);
  const fixed = l.columns.map((c, i) => noWrap(c, links[i]));
  const need: number[] = Array(n).fill(0);
  const line: number[] = Array(n).fill(0);
  const pass = (bold: boolean, want: (k: RowKind) => boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(fs);
    cells.forEach((row, i) => {
      if (!want(l.kinds[i])) return;
      for (let c = 0; c < n; c++) {
        const { text } = row[c];
        if (!text) continue;
        const w = text.includes('\n') ? Math.max(...text.split('\n').map((s) => doc.getTextWidth(s))) : doc.getTextWidth(text);
        if (fixed[c]) need[c] = Math.max(need[c], w);
        else {
          need[c] = Math.max(need[c], Math.min(longestWord(doc, text), WORD_CAP_MM));
          line[c] = Math.max(line[c], w);
        }
      }
    });
  };
  pass(false, (k) => k === 'data');
  pass(true, (k) => k === 'total' || k === 'subtotal');
  // Head labels wrap between words, never inside one.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(HEAD_FS);
  const min = l.columns.map((c, i) => Math.max(MIN_COL_MM, need[i] + 2 * PAD_X + SLACK, longestWord(doc, pdfText(c.label)) + 2 * PAD_X + SLACK));
  // A group label wraps too, but its longest word must fit across the columns under it.
  let at = 0;
  (l.groups ?? []).forEach((g) => {
    const cols = Array.from({ length: g.span }, (_, k) => at + k);
    at += g.span;
    const want = longestWord(doc, pdfText(g.label)) + 2 * PAD_X + SLACK;
    const have = total(cols.map((c) => min[c]));
    if (have < want) cols.forEach((c) => { min[c] += (want - have) / cols.length; });
  });
  const max = min.map((w, c) => Math.max(w, fixed[c] ? w + FIGURE_AIR_MM : line[c] + 2 * PAD_X + SLACK));
  const comfort = min.map((w, c) => (fixed[c] ? w : Math.max(w, Math.min(COMFORT_MAX_MM, max[c]))));
  return { min, max, comfort, base: l.columns.map((c) => Math.max(4, c.width)) };
}

/**
 * Column widths in proportion to the Excel widths, each held between its
 * minimum and its maximum, so a column of figures does not take the room a
 * wrapped reason needs. When every column has its maximum and room is left,
 * the rest is shared in proportion, filling the page (up to MM_PER_UNIT_MAX).
 * Null when the minimums alone do not fit.
 */
export function fitWidths(base: number[], min: number[], max: number[], room: number): number[] | null {
  if (total(min) > room + 0.01) return null;
  const hi = max.map((m, i) => Math.max(m, min[i]));
  const target = Math.min(room, total(base.map((b, i) => Math.max(min[i], b * MM_PER_UNIT_MAX))));
  if (total(hi) <= target) {
    const spare = target - total(hi);
    const weight = total(base);
    return hi.map((w, i) => w + (spare * base[i]) / weight);
  }
  // The scale k at which the clamped widths fill the target (their sum only grows with k).
  const at = (k: number) => base.map((b, i) => Math.min(hi[i], Math.max(min[i], b * k)));
  let lo = 0;
  let up = target / Math.min(...base);
  for (let step = 0; step < 50; step++) {
    const k = (lo + up) / 2;
    if (total(at(k)) < target) lo = k;
    else up = k;
  }
  return at(up);
}

/**
 * A table too wide for the page at its minimums, as parts printed one after
 * another: each repeats the identity columns (the leading text columns: Sr.,
 * GSTIN, name, document) at a width that keeps them on one line, and takes its
 * share of the further columns, keeping a column group together where it can.
 * The parts are balanced, so the last is not a lone column.
 *
 * Done here rather than with autotable's horizontalPageBreak, which draws a
 * spanning cell (a period band, the column-group row) at its full width on
 * every part, running off the page.
 */
function splitColumns(l: TableLayout, m: Metrics, room: number): { ids: number[]; parts: number[][] } {
  const n = l.columns.length;
  const ids: number[] = [];
  for (const c of l.columns) {
    if (c.kind === 'amount' || c.kind === 'rate' || (c.kind === 'int' && c.index > 0)) break;
    ids.push(c.index);
  }
  if (!ids.length) ids.push(0);
  const widthOf = (c: number) => (ids.includes(c) ? m.comfort[c] : m.min[c]);
  const width = (cols: number[]) => total(cols.map(widthOf));
  while (ids.length > 1 && width(ids) > room * IDENTITY_SHARE) ids.pop();

  const owner: number[] = [];
  (l.groups ?? []).forEach((g, gi) => { for (let k = 0; k < g.span; k++) owner.push(gi); });
  const runs: number[][] = [];
  for (let c = 0; c < n; c++) {
    if (ids.includes(c)) continue;
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev === c - 1 && owner[c] !== undefined && owner[prev] === owner[c]) last.push(c);
    else runs.push([c]);
  }

  const pack = (cap: number): number[][] => {
    const parts: number[][] = [];
    let cur = [...ids];
    const flush = () => {
      if (cur.length > ids.length) parts.push(cur);
      cur = [...ids];
    };
    runs.forEach((run) => {
      if (width(cur) + width(run) <= cap) cur.push(...run);
      else if (width(ids) + width(run) <= cap) {
        flush();
        cur.push(...run);
      } else {
        run.forEach((c) => {
          if (width(cur) + widthOf(c) > cap && cur.length > ids.length) flush();
          cur.push(c);
        });
      }
    });
    flush();
    return parts;
  };
  let parts = pack(room);
  // The narrowest width that needs no more parts spreads the columns evenly across them.
  if (parts.length > 1) {
    let lo = width(ids);
    let hi = room;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (pack(mid).length <= parts.length) hi = mid;
      else lo = mid;
    }
    parts = pack(hi);
  }
  return { ids, parts: parts.length ? parts : [ids] };
}

// ── Tables ─────────────────────────────────────────────────────────────────

interface Tag {
  kind: RowKind;
  url?: string;
  /** A figure cell (gets the double rule under a total). */
  figure?: boolean;
}
type Tagged = CellDef & { tag?: Tag };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "— 07/2026 —" (the merge's period band) as "Jul 2026"; any other label as written. */
const bandLabel = (row: (string | number)[]): string => {
  const first = row.map((c) => String(c ?? '').trim()).find(Boolean) ?? '';
  const bare = first.replace(/^—\s*/, '').replace(/\s*—$/, '');
  const mm = /^(\d{2})\/(\d{4})$/.exec(bare);
  return pdfText(mm && +mm[1] >= 1 && +mm[1] <= 12 ? `${MONTHS[+mm[1] - 1]} ${mm[2]}` : bare);
};

function drawTable(st: St, l: TableLayout, widths: number[], fs: number): void {
  const { doc } = st;
  const ncol = l.columns.length;
  const { links, cells } = shownOf(l);
  const fixed = l.columns.map((c, i) => noWrap(c, links[i]));

  const head: RowInput[] = [];
  if (l.groups) {
    head.push(l.groups.map((g): Tagged => ({
      content: pdfText(g.label),
      colSpan: g.span,
      styles: { fillColor: NAVY_LIGHT, halign: 'center', valign: 'middle' },
    })));
  }
  head.push(l.columns.map((c, i): Tagged => ({
    content: pdfText(c.label),
    styles: { halign: c.align, cellWidth: widths[i] },
  })));

  const body: RowInput[] = [];
  let zebra = 0;
  l.rows.forEach((r, i) => {
    const kind = l.kinds[i];
    // A band spans the table only when it is a label alone: one a report marked
    // as a section but that carries figures keeps its cells (styled below).
    const labelOnly = r.filter((c) => String(c ?? '').trim() !== '').length <= 1;
    if ((kind === 'period' || kind === 'section') && labelOnly) {
      zebra = 0;
      body.push([{
        content: bandLabel(r),
        colSpan: ncol,
        styles: kind === 'period'
          ? { fillColor: BAND, textColor: NAVY, fontStyle: 'bold', halign: 'left', overflow: 'linebreak' }
          : { fillColor: BAND_SOFT, textColor: INK, fontStyle: 'bold', halign: 'left', overflow: 'linebreak' },
        tag: { kind },
      } as Tagged]);
      return;
    }
    if (kind === 'blank') {
      zebra = 0;
      body.push([{
        content: '',
        colSpan: ncol,
        styles: { fillColor: WHITE, lineWidth: 0, cellPadding: 0, minCellHeight: 1.8, fontSize: 1 },
        tag: { kind },
      } as Tagged]);
      return;
    }
    const strong = kind !== 'data';
    const fill = kind === 'total' || kind === 'period' ? BAND : kind !== 'data' ? BAND_SOFT : zebra++ % 2 === 1 ? ZEBRA : WHITE;
    const tone = l.tones[i];
    body.push(l.columns.map((c, ci): Tagged => {
      const s = cells[i][ci];
      const styles: Partial<Styles> = { fillColor: fill };
      if (strong) styles.fontStyle = 'bold';
      // The tint goes behind the word, never on an empty cell.
      if (tone && ci === l.toneColumn && s.text) {
        styles.fillColor = rgb(TONE[tone].fill);
        styles.textColor = rgb(TONE[tone].ink);
      }
      if (s.url) styles.textColor = LINK;
      return { content: s.text, styles, tag: { kind, url: s.url, figure: c.align === 'right' && !!s.text } };
    }));
  });
  if (!body.length) {
    body.push([{
      content: 'No records for this selection.',
      colSpan: ncol,
      styles: { textColor: MUTED, fontStyle: 'italic', halign: 'left' },
      tag: { kind: 'data' },
    } as Tagged]);
  }

  const columnStyles: Record<number, Partial<Styles>> = {};
  l.columns.forEach((c, i) => {
    columnStyles[i] = { cellWidth: widths[i], halign: c.align, overflow: fixed[i] ? 'visible' : 'linebreak' };
  });
  const kinds = body.map((r) => ((r as Tagged[])[0]?.tag?.kind ?? 'data'));

  const options = (startY: number, rows: RowInput[]): UserOptions => ({
    startY,
    head,
    body: rows,
    theme: 'grid',
    tableWidth: total(widths),
    margin: { left: M, right: M, top: TOP, bottom: BOTTOM },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica', fontSize: fs, textColor: INK, lineColor: GRID, lineWidth: 0.1,
      cellPadding: { top: PAD_Y, bottom: PAD_Y, left: PAD_X, right: PAD_X }, overflow: 'linebreak', valign: 'top',
    },
    headStyles: {
      fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: HEAD_FS, valign: 'bottom',
      lineColor: HEAD_RULE, lineWidth: 0.1,
    },
    columnStyles,
    didDrawCell: (d: CellHookData) => {
      if (d.section !== 'body') return;
      const tag = (d.cell.raw as Tagged | undefined)?.tag;
      if (!tag) return;
      const { x, y, width, height } = d.cell;
      if (tag.kind === 'total' || tag.kind === 'subtotal') {
        doc.setDrawColor(...INK);
        doc.setLineWidth(tag.kind === 'total' ? 0.35 : 0.2);
        doc.line(x, y, x + width, y);
        if (tag.kind === 'total' && tag.figure) {
          doc.setLineWidth(0.15);
          doc.line(x + 0.8, y + height - 0.25, x + width - 0.8, y + height - 0.25);
          doc.line(x + 0.8, y + height - 0.8, x + width - 0.8, y + height - 0.8);
        }
      }
      if (tag.url) {
        doc.link(x, y, width, height, { url: tag.url });
        // An underline under the words, so the link reads as one in print too.
        const tw = doc.getTextWidth(d.cell.text[0] ?? '');
        const tx = d.cell.styles.halign === 'center' ? x + (width - tw) / 2 : d.cell.styles.halign === 'right' ? x + width - PAD_X - tw : x + PAD_X;
        const base = y + PAD_Y + (d.cell.styles.fontSize / doc.internal.scaleFactor) * 0.85 + 0.45;
        doc.setDrawColor(...LINK);
        doc.setLineWidth(0.12);
        doc.line(tx, base, tx + tw, base);
      }
    },
  });

  // Laid out once (exact row heights) to see where autotable would break the
  // pages; drawn as is unless that strands a total or a band.
  let table = __createTable(doc, options(st.y, body));
  const heights = table.body.map((r) => r.height);
  const headH = table.getHeadHeight(table.columns);
  if (st.y + headH + (heights[0] ?? 0) > st.H - BOTTOM && st.y > TOP + 1) {
    // Not even the first row fits under the head here: start on the next page.
    newPage(st);
    table = __createTable(doc, options(st.y, body));
  }
  const breaks = keepTogether(heights, kinds, headH, st.y, st.H);
  if (!breaks.length) __drawTable(doc, table);
  else {
    [0, ...breaks].forEach((from, k, all) => {
      if (k > 0) newPage(st);
      autoTable(doc, options(st.y, body.slice(from, all[k + 1] ?? body.length)));
      st.y = lastY(doc, st.y);
    });
  }
  st.y = lastY(doc, st.y);
}

const lastY = (doc: jsPDF, fallback: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

/**
 * Where to break a table's pages earlier than autotable would, so a TOTAL or
 * subtotal never opens a page on its own and a period band or section heading
 * never closes one: the page breaks a row earlier, taking the last figures with
 * their total, or the band with its rows. Pages are simulated the way
 * autotable fills them (whole rows, the head repeated on each page). Returns
 * the body row indices that must start a new page (none: draw as is).
 */
export function keepTogether(heights: number[], kinds: RowKind[], headH: number, startY: number, pageH: number): number[] {
  const limit = pageH - BOTTOM;
  // A row taller than a page is split by autotable itself; leave such a table alone.
  if (heights.some((h) => h > limit - TOP - headH)) return [];
  const opens = (k: RowKind | undefined) => k === 'total' || k === 'subtotal';
  const closes = (k: RowKind | undefined) => k === 'period' || k === 'section';
  const forced: number[] = [];
  let start = 0;
  let y = startY + headH;
  for (let i = 0; i < heights.length; i++) {
    if (i > start && y + heights[i] > limit) {
      // The page breaks before row i; earlier if that strands a total or a band,
      // never so early that the page above is left empty.
      let b = i;
      while (b > start + 1 && (opens(kinds[b]) || closes(kinds[b - 1]))) b--;
      if (b !== i) forced.push(b);
      start = b;
      y = TOP + headH;
      i = b;
    }
    y += heights[i];
  }
  return forced;
}

/** Room a table needs on the current page before it starts: its head and two rows. */
const headRoom = (l: TableLayout): number => (l.groups ? 26 : 20);

/** A table at the widths and size that fit the page; split sideways into parts when none does. */
function renderTable(st: St, l: TableLayout): void {
  const { doc } = st;
  const room = avail(st);
  for (const fs of BODY_FS) {
    const m = measure(doc, l, fs);
    const widths = fitWidths(m.base, m.min, m.max, room);
    if (widths) {
      ensure(st, headRoom(l));
      drawTable(st, l, widths, fs);
      return;
    }
  }
  const fs = BODY_FS[BODY_FS.length - 1];
  const { ids, parts } = splitColumns(l, measure(doc, l, fs), room);
  const label = (c: number) => l.columns[c].label;
  parts.forEach((cols, pi) => {
    const pl = project(l, cols);
    const pm = measure(doc, pl, fs);
    // The repeated identity columns read on one line; the others share the rest.
    const floor = cols.map((c, k) => (ids.includes(c) ? pm.comfort[k] : pm.min[k]));
    const widths = fitWidths(pm.base, floor, pm.max, room) ?? fitWidths(pm.base, pm.min, pm.max, room) ?? pm.min.map((w) => (w * room) / total(pm.min));
    if (pi > 0) newPage(st);
    const own = cols.filter((c) => !ids.includes(c));
    const span = !own.length ? ids.map(label).join(', ') : own.length === 1 ? label(own[0]) : `${label(own[0])} to ${label(own[own.length - 1])}`;
    caption(st, pi === 0
      ? `Wider than the page: printed in ${parts.length} parts, each repeating ${ids.map(label).join(', ')}. This part: ${span}.`
      : `Continued, part ${pi + 1} of ${parts.length}: ${span}.`);
    ensure(st, headRoom(pl));
    drawTable(st, pl, widths, fs);
  });
}

// ── Running header ─────────────────────────────────────────────────────────

/** Pages after the first: the report's title left, the client right, a hairline. */
function runningHeads(doc: jsPDF, title: string, client: string): void {
  const W = doc.internal.pageSize.getWidth();
  const n = doc.getNumberOfPages();
  for (let p = 2; p <= n; p++) {
    doc.setPage(p);
    font(doc, 7.5, 'normal', MUTED);
    const right = client ? fitLine(doc, pdfText(client), (W - 2 * M) * 0.45) : '';
    const rightW = right ? doc.getTextWidth(right) : 0;
    if (right) doc.text(right, W - M, 9.5, { align: 'right' });
    font(doc, 7.5, 'bold', NAVY);
    doc.text(fitLine(doc, pdfText(title), W - 2 * M - rightW - 8), M, 9.5);
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.2);
    doc.line(M, 11.5, W - M, 11.5);
  }
}

/** "Client · GSTIN" from the identification strip, for the running header. */
const clientOf = (fields: ReportMetaField[]): string => {
  const pick = (re: RegExp) => fields.find((f) => re.test(f.label))?.value?.trim() || '';
  return [pick(/^client|^taxpayer|^name/i), pick(/gstin/i)].filter(Boolean).join('  ·  ');
};

// ── The document ───────────────────────────────────────────────────────────

/**
 * The PDF of a Reports Hub table: letterhead and stat band, the summary and
 * its notes, the rows (table.pdfColumns), then each extra sheet the PDF
 * prints, with running headers and footers.
 */
export async function buildReportPdf(table: ReportTable, opts: { now?: Date } = {}): Promise<jsPDF> {
  const main = project(layoutOf(table), table.pdfColumns);
  const summary = table.summary ? layoutOf(table.summary) : null;
  const extras = (table.extraSheets ?? [])
    .filter((s) => s.pdf !== false)
    .map((s) => ({ sheet: s, layout: project(layoutOf(s, s.title || s.name), s.pdfColumns) }));

  // One orientation for the whole document (the footers assume it): landscape
  // when any printed table has more than seven columns.
  const widest = Math.max(main.headers.length, summary?.headers.length ?? 0, ...extras.map((e) => e.layout.headers.length));
  const landscape = widest > 7;
  const doc = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'mm', format: 'a4', compress: true });
  const st: St = { doc, W: doc.internal.pageSize.getWidth(), H: doc.internal.pageSize.getHeight(), y: 0, landscape };
  const { fields, rest } = metaOf(table);
  doc.setProperties({ title: pdfText(table.title), subject: pdfText(table.subtitle || ''), author: FIRM.name, creator: FIRM.name });

  st.y = idStrip(st, fields, letterhead(st, table.title, rest));
  if (table.kpis?.length) kpiBand(st, table.kpis);

  if (summary) {
    sectionTitle(st, summary.title || 'Summary');
    renderTable(st, summary);
    notes(st, summary.notes);
    // The document list follows on the same page unless the summary took most of it.
    if (st.y > TOP + (st.H - TOP - BOTTOM) * 0.66) newPage(st);
    else st.y += 4;
    sectionTitle(st, 'Document list');
  } else if (extras.length) {
    sectionTitle(st, table.sheetName || 'Details');
  }
  renderTable(st, main);

  extras.forEach(({ sheet, layout }) => {
    newPage(st);
    sectionTitle(st, sheet.title || sheet.name);
    renderTable(st, layout);
    notes(st, layout.notes);
  });

  runningHeads(doc, table.title, clientOf(fields));
  drawFooters(doc, preparedStamp(opts.now));
  return doc;
}

/** Build and save: the file is named after the report (fileNameBase). */
export async function downloadReportPdf(table: ReportTable): Promise<void> {
  const doc = await buildReportPdf(table);
  doc.save(`${fileBase(table.fileNameBase)}.pdf`);
}
