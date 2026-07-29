import jsPDF from 'jspdf';
import autoTable, { type UserOptions } from 'jspdf-autotable';

// Shared look for the builder working papers.
//
// These are printed CA working papers, so the design is typographic rather than
// decorative. Two rules follow from that and are applied throughout:
//
//   Status is carried by a WORD, never by colour alone. A working paper gets
//   photocopied, faxed and printed in mono; "Cap applied" survives that, an
//   amber cell does not.
//
//   Figures in COLUMNS are right-aligned so they align vertically; figures in
//   the summary band are standalone and set normally. Forcing column alignment
//   onto a large standalone number just makes it look loose.

export const REPORT_FIRM = {
  name: 'V. J. Desai & Co. LLP',
  designation: 'Chartered Accountants',
  email: 'gst@vjdesai.com',
};

// Ink, not accent. Text never wears a data colour.
const INK = [17, 24, 39] as const;        // near-black
const INK_MUTED = [107, 114, 128] as const;
const RULE = [203, 213, 225] as const;
const HEADER_FILL = [30, 41, 59] as const; // matches the app's existing tables
const ZEBRA = [245, 247, 250] as const;

export type Orientation = 'p' | 'l';

export interface DocMeta {
  /** Sentence-case report name, e.g. "Unit-wise BU working". */
  title: string;
  subtitle?: string;
  /** Label/value pairs for the identification strip. */
  fields: { label: string; value: string }[];
}

export interface StatTile {
  /** Sentence case, no trailing colon. */
  label: string;
  value: string;
  /** Optional qualifier — a word, so it survives mono printing. */
  note?: string;
}

const pageWidth = (doc: jsPDF) => doc.internal.pageSize.getWidth();

/** Letterhead, report title and the identification strip. Returns the next y. */
export const drawHeader = (doc: jsPDF, meta: DocMeta): number => {
  const W = pageWidth(doc);
  const M = 14;

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(REPORT_FIRM.name, M, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK_MUTED);
  doc.text(REPORT_FIRM.designation, M, 21.5);

  // Report name sits right-aligned against the firm block.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(meta.title, W - M, 16, { align: 'right' });
  if (meta.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_MUTED);
    doc.text(meta.subtitle, W - M, 21.5, { align: 'right' });
  }

  doc.setDrawColor(...HEADER_FILL);
  doc.setLineWidth(0.6);
  doc.line(M, 25, W - M, 25);

  // Identification strip — label above value, flowing across the width.
  let y = 31;
  const perRow = Math.max(1, Math.floor((W - 2 * M) / 62));
  meta.fields.forEach((f, i) => {
    const col = i % perRow;
    const x = M + col * ((W - 2 * M) / perRow);
    if (col === 0 && i > 0) y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK_MUTED);
    doc.text(f.label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(f.value || '—', x, y + 4.5);
  });

  return y + 10;
};

/**
 * The summary band.
 *
 * Stat tiles, not a chart: each is a label above a value, separated by hairlines
 * rather than by fill. Any qualifier ("Cap applied", "Filing blocked") is set as
 * a word underneath, so nothing depends on colour.
 */
export const drawStatBand = (doc: jsPDF, tiles: StatTile[], startY: number): number => {
  if (!tiles.length) return startY;
  const W = pageWidth(doc);
  const M = 14;
  const bandW = W - 2 * M;
  const cellW = bandW / tiles.length;
  const hasNote = tiles.some((t) => t.note);
  const bandH = hasNote ? 20 : 16;

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.rect(M, startY, bandW, bandH);

  tiles.forEach((t, i) => {
    const x = M + i * cellW;
    if (i > 0) doc.line(x, startY, x, startY + bandH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK_MUTED);
    doc.text(t.label, x + 3, startY + 5.5);

    // Standalone value: normal figures, not column-aligned.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(t.value, x + 3, startY + 12);

    if (t.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...INK_MUTED);
      doc.text(t.note, x + 3, startY + 17);
    }
  });

  return startY + bandH + 6;
};

/** A section heading with a short accent rule beneath it. */
export const drawSectionTitle = (doc: jsPDF, text: string, y: number): number => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(text, 14, y);
  doc.setDrawColor(...HEADER_FILL);
  doc.setLineWidth(0.4);
  doc.line(14, y + 1.6, 32, y + 1.6);
  return y + 6;
};

/** A short explanatory paragraph, wrapped to the page. Returns the next y. */
export const drawNote = (doc: jsPDF, text: string, y: number): number => {
  const W = pageWidth(doc);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  const lines = doc.splitTextToSize(text, W - 28) as string[];
  doc.text(lines, 14, y);
  return y + lines.length * 3.4 + 3;
};

/** The shared table style. `numericFrom` right-aligns that column onward. */
export const reportTable = (
  doc: jsPDF,
  opts: UserOptions & { numericFrom?: number },
): void => {
  const { numericFrom, ...rest } = opts;
  const columnStyles: Record<number, { halign: 'right' }> = {};
  if (numericFrom !== undefined) {
    const head = (rest.head as unknown[][] | undefined)?.[0];
    const count = head ? head.length : 0;
    for (let i = numericFrom; i < count; i += 1) columnStyles[i] = { halign: 'right' };
  }
  autoTable(doc, {
    theme: 'grid',
    styles: {
      fontSize: 7.5, cellPadding: 1.8, lineColor: [...RULE], lineWidth: 0.1,
      textColor: [...INK],
    },
    headStyles: {
      fillColor: [...HEADER_FILL], textColor: 255, fontStyle: 'bold',
      fontSize: 7.5, halign: 'left',
    },
    alternateRowStyles: { fillColor: [...ZEBRA] },
    columnStyles: { ...columnStyles, ...(rest.columnStyles || {}) },
    margin: { left: 14, right: 14 },
    ...rest,
  });
};

/** Page numbers, timestamp and the confidentiality line. Call last. */
export const drawFooters = (doc: jsPDF, generatedOn: string): void => {
  const W = pageWidth(doc);
  const H = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...INK_MUTED);
    doc.text(
      `${REPORT_FIRM.name} · Prepared ${generatedOn} · For the client's internal use`,
      14, H - 8,
    );
    doc.text(`Page ${p} of ${total}`, W - 14, H - 8, { align: 'right' });
  }
};

/** Everything a renderer needs to start a document. */
export const startDoc = (orientation: Orientation, meta: DocMeta): { doc: jsPDF; y: number } => {
  const doc = new jsPDF(orientation, 'mm', 'a4');
  return { doc, y: drawHeader(doc, meta) };
};

export const nowStamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Filenames: no spaces, stable ordering, safe on every platform. */
export const reportFileName = (parts: (string | undefined)[], ext: 'pdf' | 'xlsx'): string =>
  `${parts.filter(Boolean).map((s) => String(s).replace(/[^A-Za-z0-9]+/g, '_')).join('_')}.${ext}`;
