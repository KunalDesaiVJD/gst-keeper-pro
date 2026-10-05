// Page chrome shared by every Annual Return PDF — the working papers, the
// GSTR-9 form and the Notice format: a running header on every page (firm ·
// client · GSTIN · FY on the left, the paper on the right, a thin navy rule)
// and a footer (status, print time, "Page x of y"), drawn once the document
// is complete so the page count is known.

import type jsPDF from 'jspdf';
import { drawFirmLogo } from '@/utils/reportTheme';

export type RGB = [number, number, number];

export const NAVY: RGB = [31, 56, 100];
export const INK: RGB = [17, 17, 17];
export const GREY: RGB = [89, 89, 89];
export const MUTED: RGB = [128, 128, 128];
export const RULE: RGB = [191, 191, 191];

/** A4 landscape layout (mm): side margins, where content starts below the running header, and where it must end above the footer. */
export const PAGE = { margin: 12, top: 18, bottom: 15 };

/**
 * The core PDF fonts are WinAnsi: a character outside it (₹, −, ✓ …) makes
 * jsPDF re-encode the whole string and space every letter apart. Swap the
 * ones the papers use, and anything else outside WinAnsi, for plain text.
 */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export const pdfText = (s: string): string =>
  String(s)
    .replace(/₹/g, 'Rs.')
    .replace(/[−‐‑‒]/g, '-')
    .replace(/✓|✔/g, 'Yes')
    .replace(/✗|✘/g, 'No')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .replace(/[\u0100-\uffff]/g, (ch) => (WINANSI_EXTRA.has(ch) ? ch : '?'));

export interface ChromeInfo {
  firm: string;
  clientName: string;
  gstin: string;
  financialYear: string;
  status?: string;
  printed: string;
  /** Right side of the running header for a page, e.g. "WP B1 — PL-OUTPUT". */
  right: (page: number) => string;
  /** Pages that carry no chrome (none by default). */
  skip?: (page: number) => boolean;
}

/** Shorten a single line to fit `width` mm at the current font. */
const fitLine = (doc: jsPDF, text: string, width: number): string => {
  if (doc.getTextWidth(text) <= width) return text;
  let s = text;
  while (s.length > 4 && doc.getTextWidth(`${s}...`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}...`;
};

/** Running header and footer on every page. Call last. */
export function drawChrome(doc: jsPDF, info: ChromeInfo): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = PAGE.margin;
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    if (info.skip?.(p)) continue;
    doc.setPage(p);
    const right = pdfText(info.right(p));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const rightW = Math.min(doc.getTextWidth(right), (W - 2 * M) * 0.45);
    doc.setTextColor(...NAVY);
    doc.text(fitLine(doc, right, rightW + 0.01), W - M, 9.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GREY);
    const left = pdfText(`${info.firm} · ${info.clientName || '—'} · GSTIN ${info.gstin || '—'} · FY ${info.financialYear}`);
    doc.text(fitLine(doc, left, W - 2 * M - rightW - 8), M, 9.5);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.35);
    doc.line(M, 11.5, W - M, 11.5);

    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, H - 10, W - M, H - 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.setTextColor(...GREY);
    const foot = pdfText(`${info.status ? `Status: ${info.status} · ` : ''}Printed ${info.printed} · For the client's internal use`);
    doc.text(fitLine(doc, foot, W - 2 * M - 30), M, H - 6.2);
    doc.text(`Page ${p} of ${total}`, W - M, H - 6.2, { align: 'right' });
  }
}

export interface TitleBlock {
  title: string;
  subtitle?: string;
  fields: Array<{ label: string; value: string }>;
}

/** The first-page title of a standalone form PDF (logo, title, identification strip) below the running header. Returns the next y. */
export function drawTitleBlock(doc: jsPDF, meta: TitleBlock, y0 = PAGE.top): number {
  const W = doc.internal.pageSize.getWidth();
  const M = PAGE.margin;
  drawFirmLogo(doc, { width: 50, y: y0, x: M });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(pdfText(meta.title), W - M, y0 + 4, { align: 'right' });
  if (meta.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(pdfText(meta.subtitle), W - M, y0 + 9, { align: 'right' });
  }
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.5);
  doc.line(M, y0 + 12, W - M, y0 + 12);
  let y = y0 + 17.5;
  const perRow = Math.max(1, Math.floor((W - 2 * M) / 62));
  meta.fields.forEach((f, i) => {
    const col = i % perRow;
    const x = M + col * ((W - 2 * M) / perRow);
    if (col === 0 && i > 0) y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(pdfText(f.label), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(pdfText(f.value || '—'), x, y + 4.5);
  });
  return y + 10;
}
