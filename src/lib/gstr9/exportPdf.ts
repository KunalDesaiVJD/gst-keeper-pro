// PDF exports of the Annual Return working: the working papers (every paper
// of the Excel, A4 landscape — export/pdf.ts), the GSTR-9 form (Tables 4–19
// in the official layout) and the firm's Notice format. Every figure is read
// from computeWorkings() — nothing is recomputed here (Tables 14–19 are the
// engine's pass-throughs of the typed cells).
//
// The table structures (gstr9FormTables / noticeTables, export/formTables.ts)
// are shared with the Excel export so the two never disagree. Every PDF
// carries the same running header and footer (export/chrome.ts).

import jsPDF from 'jspdf';
import type { CellHookData, RowInput } from 'jspdf-autotable';
import { reportTable } from '@/utils/reportTheme';
import type { Workings } from './engine';
import { drawChrome, drawTitleBlock, NAVY, PAGE, pdfText } from './export/chrome';
import { gstr9FormTables, noticeTables, type FormCell, type FormTable } from './export/formTables';
import { exportFileName, FIRM_NAME, fmtDateTime, type ExportMeta, type WorkingPapersInput } from './export/model';
import { buildWorkingPapers } from './export/papers';
import { renderWorkingPapersPdf } from './export/pdf';

export type { ExportMeta, WorkingPapersInput } from './export/model';
export { exportFileName } from './export/model';
export { gstr9FormTables, noticeTables, TAX_HEAD, VAL_HEAD } from './export/formTables';
export type { FormCell, FormRow, FormTable } from './export/formTables';

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2-decimal Indian grouping; negative zero and float noise print as 0.00. */
const fmt2 = (n: number): string => INR2.format(Math.abs(n) < 0.005 ? 0 : n);

const cellText = (c: FormCell): string => {
  if (c === null || c === undefined) return '';
  if (typeof c === 'number') return Number.isFinite(c) ? fmt2(c) : '';
  return pdfText(c);
};

type Doc = jsPDF;

const lastY = (doc: Doc, fallback: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

/** Keep a heading and the start of its table on the same page. */
const ensureSpace = (doc: Doc, y: number, need: number): number => {
  const H = doc.internal.pageSize.getHeight();
  if (y + need > H - PAGE.bottom - 2) {
    doc.addPage();
    return PAGE.top;
  }
  return y;
};

const drawText = (doc: Doc, text: string, y: number, opts: { size: number; bold?: boolean; muted?: boolean }): number => {
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(opts.size);
  doc.setTextColor(...((opts.muted ? [107, 114, 128] : [17, 24, 39]) as [number, number, number]));
  const lines = doc.splitTextToSize(pdfText(text), W - 2 * PAGE.margin) as string[];
  doc.text(lines, PAGE.margin, y);
  return y + lines.length * (opts.size * 0.42) + 1.2;
};

/** Render a list of form tables, printing part headings and table titles above each. */
function renderTables(doc: Doc, tables: FormTable[], startY: number, opts: { showNo?: boolean } = {}): number {
  let y = startY;
  let part: string | undefined;
  tables.forEach((t) => {
    if (t.part && t.part !== part) {
      part = t.part;
      y = ensureSpace(doc, y + 2, 30);
      y = drawText(doc, t.part, y + 2, { size: 9.5, bold: true });
    }
    y = ensureSpace(doc, y + 2, 24);
    y = drawText(doc, t.no ? `${t.no}.  ${t.title}` : t.title, y + 2, { size: 8.5, bold: true });
    if (t.note) y = drawText(doc, t.note, y, { size: 7, muted: true });

    const bold = new Set<number>();
    const body: RowInput[] = t.rows.map((r, i) => {
      if (r.bold) bold.add(i);
      return [pdfText(r.code), pdfText(r.label), ...r.cells.map(cellText)];
    });
    const many = t.head.length > 6;
    const fontSize = many ? 6.8 : 7.3;
    const columnStyles: Record<number, { halign?: 'right' | 'left'; cellWidth?: number | 'auto' }> = {
      0: { cellWidth: t.codeWidth ?? 12 },
      1: { cellWidth: many ? 58 : 105 },
    };
    t.head.forEach((_, i) => {
      const numeric = t.rows.some((r) => typeof r.cells[i] === 'number');
      columnStyles[i + 2] = { halign: numeric ? 'right' : 'left' };
    });
    // reportTable replaces (not merges) styles passed in, so the house colours are restated here.
    reportTable(doc, {
      startY: y,
      head: [[opts.showNo === false ? 'S.No' : 'No.', pdfText(t.labelHead ?? 'Description'), ...t.head.map(pdfText)]],
      body,
      styles: { fontSize, cellPadding: 1.4, overflow: 'linebreak', valign: 'top', lineColor: [203, 213, 225], lineWidth: 0.1, textColor: [17, 24, 39] },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize, halign: 'left', valign: 'middle' },
      columnStyles,
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && bold.has(d.row.index)) d.cell.styles.fontStyle = 'bold';
        if (d.section === 'head' && d.column.index >= 2 && columnStyles[d.column.index]?.halign === 'right') d.cell.styles.halign = 'right';
      },
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom + 1 },
    });
    y = lastY(doc, y) + 2;
  });
  return y;
}

/** The running header and footer of a standalone form PDF. */
const chrome = (doc: Doc, meta: ExportMeta, right: string): void =>
  drawChrome(doc, {
    firm: FIRM_NAME,
    clientName: meta.clientName,
    gstin: meta.gstin,
    financialYear: meta.financialYear,
    status: meta.status,
    printed: fmtDateTime(new Date()),
    right: () => right,
  });

/** Form GSTR-9, Tables 4–19, landscape A4. Returns the file name. */
export function exportGstr9Pdf(workings: Workings, meta: ExportMeta): string {
  const doc = new jsPDF('l', 'mm', 'a4');
  const y = drawTitleBlock(doc, {
    title: 'Form GSTR-9 — Annual Return',
    subtitle: `Financial year ${meta.financialYear} · all amounts in Rs.`,
    fields: [
      { label: '1  Financial year', value: meta.financialYear },
      { label: '2  GSTIN', value: meta.gstin },
      { label: '3A  Legal name of the registered person', value: pdfText(meta.clientName) },
    ],
  });
  renderTables(doc, gstr9FormTables(workings), y);
  chrome(doc, meta, 'WP D1 — GSTR-9 (form)');
  const name = exportFileName('GSTR9', meta, 'pdf');
  doc.save(name);
  return name;
}

/** The firm's Notice format (outward + inward), landscape A4. Returns the file name. */
export function exportNoticePdf(workings: Workings, meta: ExportMeta): string {
  const doc = new jsPDF('l', 'mm', 'a4');
  const y = drawTitleBlock(doc, {
    title: 'GSTR-9 — Notice format',
    subtitle: `Year ${meta.financialYear} · all amounts in Rs.`,
    fields: [
      { label: 'Party name', value: pdfText(meta.clientName) },
      { label: 'GSTIN', value: meta.gstin },
      { label: 'Year', value: meta.financialYear },
    ],
  });
  const { outward, inward } = noticeTables(workings);
  renderTables(doc, [outward, inward], y, { showNo: false });
  chrome(doc, meta, 'WP D3 — Notice format');
  const name = exportFileName('GSTR9_Notice', meta, 'pdf');
  doc.save(name);
  return name;
}

/** Build the working-papers PDF without saving it (tests, previews). */
export function buildWorkingPapersPdf(input: WorkingPapersInput): { doc: jsPDF; name: string; pages: Record<string, number> } {
  const { doc, pages } = renderWorkingPapersPdf(buildWorkingPapers(input));
  return { doc, name: exportFileName('GSTR9_WorkingPapers', input.meta, 'pdf'), pages };
}

/** The working papers — every paper of the Excel, in the same order and with the same WP refs — as one PDF. Returns the file name. */
export function exportWorkingPapersPdf(input: WorkingPapersInput): string {
  const { doc, name } = buildWorkingPapersPdf(input);
  doc.save(name);
  return name;
}
