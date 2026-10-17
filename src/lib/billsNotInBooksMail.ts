// Import 2B → e-mail the client its bills not in books (15 Oct 2026).
//
// The list is every document the client's suppliers reported in GSTR-2B that
// the client has not yet recorded in its books, as the ledger will hold it
// after the next Post to Reconciliation:
//  - the month's open Not in Books ledger rows (bills_not_in_books with no
//    book_entry_month), which carry earlier months' items forward; a row this
//    month's Import 2B posted follows its document as it is now (left out if
//    it is no longer Not in Books, at its current figures if they changed);
//  - this month's 2B documents marked Not in Books that were never posted
//    (so a send never has to wait for Post to Reconciliation).
// Amounts are what the ledger holds, with their sign (twobDocs.signedEffect):
// a credit note parked Not in Books (17 Oct 2026) is negative, and an
// amendment counts at its difference, so it may be negative too.
//
// The list goes out as a working paper in the firm's house style (Arial 9,
// navy heads, figures in #,##0.00 with brackets, a supplier summary sheet,
// print-ready) attached to the 'bills_not_in_books' template, through
// email_outbox and send-gst-email (Microsoft Graph, from gst@vjdesai.com).

import type { Borders, Fill, Font, Workbook, Worksheet } from 'exceljs';
import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, prettyPeriod, renderTemplate } from '@/lib/gstReminders';
import { periodMonthLabel } from '@/lib/postImport2B';
import { docLabel, signedEffect } from '@/lib/twobDocs';
import { formatINR } from '@/utils/builderRates';
import { normalizeInvoiceNo } from '@/utils/matchTwob';

export interface BillNotInBooks {
  /** Month the document appeared in 2B, as the ledger writes it ("Sep 26"). */
  monthIn2B: string;
  date: string | null;
  supplierGstin: string;
  supplierName: string;
  docNo: string;
  docType: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** Not yet posted to Reconciliation (taken from this month's Import 2B). */
  unposted: boolean;
  /** Tied to a document of this month's Import 2B (a posted or unposted Import 2B row). */
  linked: boolean;
}

export interface BillsSummary {
  count: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  tax: number;
  months: string[];
  unposted: number;
  bySupplier: { gstin: string; name: string; count: number; taxable: number; tax: number }[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Sep 26" / "September 2026" / "09/2026" → a number that orders months (0, first, when unreadable or "Earlier"). */
export function monthOrder(label: string | null | undefined): number {
  const s = String(label || '').toLowerCase().trim();
  const mm = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (mm) return Number(mm[2]) * 12 + Number(mm[1]);
  const m = MON.findIndex((x) => s.startsWith(x));
  const y = s.match(/(\d{4}|\d{2})\s*$/);
  if (m < 0 || !y) return 0;
  const yy = y[1].length === 2 ? 2000 + Number(y[1]) : Number(y[1]);
  return yy * 12 + m + 1;
}

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

export interface BillsList { rows: BillNotInBooks[]; duplicates: BillNotInBooks[] }

const dayNo = (iso: string | null) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
};

/**
 * A ledger can hold the same document twice, one day apart (a few older
 * months were entered that way). The client is sent each document once: a row
 * with the same supplier, number and figures as one already kept, dated within
 * a day of it, is left out and returned as a duplicate so staff can clean the
 * ledger.
 */
function dropDuplicates(rows: BillNotInBooks[]): BillsList {
  const kept: BillNotInBooks[] = [];
  const duplicates: BillNotInBooks[] = [];
  const seen = new Map<string, BillNotInBooks[]>();
  for (const r of rows) {
    const key = [r.supplierGstin, r.docType, normalizeInvoiceNo(r.docNo), r.taxable, r.igst, r.cgst, r.sgst].join('|');
    const same = seen.get(key) || [];
    // Only an untied ledger row (carried forward or entered by hand) can be a
    // repeat: a row tied to this month's Import 2B is a document of its own.
    if (!r.linked && normalizeInvoiceNo(r.docNo) && same.some((k) => Math.abs(dayNo(k.date) - dayNo(r.date)) <= 1)) {
      duplicates.push(r);
      continue;
    }
    seen.set(key, [...same, r]);
    kept.push(r);
  }
  return { rows: kept, duplicates };
}

/** The client's bills not in books for the month (open ledger rows plus unposted Not in Books documents). */
export async function loadBillsNotInBooks(clientId: string, periodMonth: string): Promise<BillsList> {
  type LedgerRow = {
    id: string; date: string | null; supplier_name: string | null; supplier_invoice_number: string | null; supplier_gstin: string | null;
    taxable_value: number | null; input_igst: number | null; input_cgst: number | null; input_sgst: number | null;
    bill_in_2b_month: string | null; source_doc_id: string | null;
  };
  type DocRow = {
    id: string; date: string | null; supplier_name: string | null; supplier_invoice_number: string | null; supplier_gstin: string | null;
    taxable_value: number | null; input_igst: number | null; input_cgst: number | null; input_sgst: number | null; cess: number | null;
    doc_type: string | null; is_amendment: boolean | null; original_doc_type: string | null; itc_action: string;
    base_taxable_value: number | null; base_input_igst: number | null; base_input_cgst: number | null; base_input_sgst: number | null; base_cess: number | null;
    ims_reduce_required: string | null; declared_igst: number | null; declared_cgst: number | null; declared_sgst: number | null; declared_cess: number | null;
  };
  const [ledger, linkedAll, docs] = await Promise.all([
    pageAll<LedgerRow>((a, b) => supabase.from('bills_not_in_books')
      .select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, bill_in_2b_month, source_doc_id')
      .eq('client_id', clientId).eq('period_month', periodMonth).is('book_entry_month', null)
      .order('id').range(a, b) as never),
    // Every row this month's Import 2B posted, booked ones included: a booked
    // document is never offered again as "not yet posted".
    pageAll<{ source_doc_id: string }>((a, b) => supabase.from('bills_not_in_books')
      .select('source_doc_id')
      .eq('client_id', clientId).eq('period_month', periodMonth).not('source_doc_id', 'is', null)
      .order('id').range(a, b) as never),
    pageAll<DocRow>((a, b) => supabase.from('twob_import_docs')
      // Every column signedEffect reads (a flipped note amendment's original
      // type, a credit note's IMS declared tax), so a figure is the ledger's.
      .select('id, date, supplier_name, supplier_invoice_number, supplier_gstin, taxable_value, input_igst, input_cgst, input_sgst, cess, '
        + 'doc_type, is_amendment, original_doc_type, itc_action, base_taxable_value, base_input_igst, base_input_cgst, base_input_sgst, base_cess, '
        + 'ims_reduce_required, declared_igst, declared_cgst, declared_sgst, declared_cess')
      .eq('client_id', clientId).eq('period_month', periodMonth).eq('reverse_charge', false)
      .order('id').range(a, b) as never),
  ]);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const posted = new Set(linkedAll.map((l) => l.source_doc_id));
  const thisMonth = periodMonthLabel(periodMonth);
  const isOpenDoc = (d: DocRow) => d.itc_action === 'NOT_IN_BOOKS';

  const out: BillNotInBooks[] = [];
  for (const l of ledger) {
    const d = l.source_doc_id ? docById.get(l.source_doc_id) : undefined;
    if (d) {
      // Posted from this month's Import 2B: as the next Post will leave it.
      if (!isOpenDoc(d)) continue;
      const e = signedEffect(d);
      out.push({
        monthIn2B: l.bill_in_2b_month || thisMonth,
        date: d.date ?? l.date,
        supplierGstin: (d.supplier_gstin || l.supplier_gstin || '').toUpperCase(),
        supplierName: d.supplier_name || l.supplier_name || '',
        docNo: d.supplier_invoice_number || l.supplier_invoice_number || '',
        docType: docLabel(d),
        taxable: r2(e.taxable), igst: r2(e.igst), cgst: r2(e.cgst), sgst: r2(e.sgst),
        unposted: false,
        linked: true,
      });
      continue;
    }
    const taxable = r2(Number(l.taxable_value));
    out.push({
      // Older carried rows may have no month: they predate the field.
      monthIn2B: l.bill_in_2b_month || 'Earlier',
      date: l.date,
      supplierGstin: (l.supplier_gstin || '').toUpperCase(),
      supplierName: l.supplier_name || '',
      docNo: l.supplier_invoice_number || '',
      // No document behind it: a negative row takes ITC away (a credit note, or an amendment's cut).
      docType: taxable < 0 || Number(l.input_igst) + Number(l.input_cgst) + Number(l.input_sgst) < 0 ? 'Credit / adjustment' : 'Invoice',
      taxable,
      igst: r2(Number(l.input_igst)),
      cgst: r2(Number(l.input_cgst)),
      sgst: r2(Number(l.input_sgst)),
      unposted: false,
      linked: false,
    });
  }
  for (const d of docs) {
    if (!isOpenDoc(d) || posted.has(d.id)) continue;
    const e = signedEffect(d);
    if (!e.igst && !e.cgst && !e.sgst && !e.taxable) continue;
    out.push({
      monthIn2B: thisMonth,
      date: d.date,
      supplierGstin: (d.supplier_gstin || '').toUpperCase(),
      supplierName: d.supplier_name || '',
      docNo: d.supplier_invoice_number || '',
      docType: docLabel(d),
      taxable: r2(e.taxable), igst: r2(e.igst), cgst: r2(e.cgst), sgst: r2(e.sgst),
      unposted: true,
      linked: true,
    });
  }
  return dropDuplicates(out.sort((a, b) =>
    monthOrder(a.monthIn2B) - monthOrder(b.monthIn2B)
    || a.supplierName.localeCompare(b.supplierName)
    || String(a.date || '').localeCompare(String(b.date || ''))
    || a.docNo.localeCompare(b.docNo)));
}

export function summariseBills(rows: BillNotInBooks[]): BillsSummary {
  const sup = new Map<string, { gstin: string; name: string; count: number; taxable: number; tax: number }>();
  const months = new Map<string, number>();
  const t = { taxable: 0, igst: 0, cgst: 0, sgst: 0 };
  for (const r of rows) {
    t.taxable += r.taxable; t.igst += r.igst; t.cgst += r.cgst; t.sgst += r.sgst;
    months.set(r.monthIn2B, monthOrder(r.monthIn2B));
    const k = r.supplierGstin || r.supplierName;
    const s = sup.get(k) || { gstin: r.supplierGstin, name: r.supplierName, count: 0, taxable: 0, tax: 0 };
    s.count += 1; s.taxable += r.taxable; s.tax += r.igst + r.cgst + r.sgst;
    sup.set(k, s);
  }
  return {
    count: rows.length,
    taxable: r2(t.taxable), igst: r2(t.igst), cgst: r2(t.cgst), sgst: r2(t.sgst),
    tax: r2(t.igst + t.cgst + t.sgst),
    months: [...months.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m),
    unposted: rows.filter((r) => r.unposted).length,
    bySupplier: [...sup.values()]
      .map((s) => ({ ...s, taxable: r2(s.taxable), tax: r2(s.tax) }))
      .sort((a, b) => b.tax - a.tax || a.name.localeCompare(b.name)),
  };
}

// ---------------------------------------------------------------------------
// Working paper (ExcelJS, loaded on demand)
// ---------------------------------------------------------------------------

type ExcelJSModule = typeof import('exceljs');
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = await import('exceljs');
  return ((mod as unknown as { default?: ExcelJSModule }).default ?? mod) as ExcelJSModule;
}

const ARIAL = 'Arial';
const NAVY = 'FF1F3864';
const BAND = 'FFD9E1F2';
const ZEBRA = 'FFF7F9FC';
const GRID = 'FFBFBFBF';
const GREY = 'FF595959';
const AMBER = 'FFFFF2CC';
const NUM_FMT = '#,##0.00_);(#,##0.00);"–"_)';
const solid = (argb: string): Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (f: Partial<Font> = {}): Partial<Font> => ({ name: ARIAL, size: 9, ...f });
const thin = { style: 'thin' as const, color: { argb: GRID } };
const BOX: Partial<Borders> = { top: thin, left: thin, bottom: thin, right: thin };

const isoToDmy = (iso: string | null) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
/**
 * The client's name as the client should read it: the firm marks some client
 * names with its own ITC scheme ("SWENI CORPORATION-NO ITC", "… PARTIAL ITC",
 * "… -TAKE ITC", "… - NO ITC (GSTR 1 )"), which never goes out.
 */
export const clientFacingName = (name: string) =>
  name.replace(/[\s-]+(NO|PARTIAL|TAKE)[\s-]*ITC\b.*$/i, '').trim() || name;

const safeName = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Client';

export const billsWorkbookName = (clientName: string, periodMonth: string) =>
  `Bills_not_in_books_${safeName(clientFacingName(clientName))}_${periodMonthLabel(periodMonth).replace(' ', '-')}.xlsx`;

/** Header block shared by both sheets; returns the next free row. */
function headerBlock(ws: Worksheet, lastCol: number, title: string, meta: [string, string][]): number {
  ws.getCell(2, 2).value = GST_FIRM.name;
  ws.getCell(2, 2).font = font({ size: 12, bold: true, color: { argb: NAVY } });
  ws.getCell(3, 2).value = 'Chartered Accountants  ·  GST Compliance Desk';
  ws.getCell(3, 2).font = font({ color: { argb: GREY } });
  for (let c = 2; c <= lastCol; c++) ws.getCell(3, c).border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  ws.getCell(5, 2).value = title;
  ws.getCell(5, 2).font = font({ size: 13, bold: true });
  let row = 6;
  for (const [k, v] of meta) {
    ws.getCell(row, 2).value = k;
    ws.getCell(row, 2).font = font({ color: { argb: GREY } });
    ws.getCell(row, 4).value = v;
    ws.getCell(row, 4).font = font({ bold: true });
    row += 1;
  }
  return row + 1;
}

function printSetup(ws: Worksheet, clientName: string, repeatRow: number) {
  // The head repeats on every printed page; on screen the filter keeps it at hand.
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = {
    orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    printTitlesRow: `${repeatRow}:${repeatRow}`,
  };
  const hf = (s: string) => s.replace(/&/g, '&&').slice(0, 80);
  ws.headerFooter = {
    // A space after each size code, so a name starting with a digit is not read as part of it.
    oddHeader: `&L&"Arial,Bold"&9 ${hf(GST_FIRM.name)}&R&"Arial"&8 ${hf(clientName)}`,
    oddFooter: '&L&"Arial"&8 Confidential: prepared for the client named above&R&"Arial"&8 Page &P of &N',
  };
}

export async function buildBillsWorkbook(opts: {
  clientName: string; gstin: string; periodMonth: string; rows: BillNotInBooks[];
  preparedBy: string; replyBy: string;
}): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = GST_FIRM.name;
  wb.created = new Date();
  const sum = summariseBills(opts.rows);
  const period = prettyPeriod(opts.periodMonth);
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const clientName = clientFacingName(opts.clientName);
  const meta: [string, string][] = [
    ['Client', clientName],
    ['GSTIN', opts.gstin],
    ['GSTR-2B period', period],
    ['Prepared on', `${today}  ·  ${opts.preparedBy}`],
    ['Reply requested by', opts.replyBy],
  ];

  // ---- Sheet 1: the list ----------------------------------------------------
  const ws = wb.addWorksheet('Bills not in books', { properties: { defaultRowHeight: 13.5 } });
  const COLS: { head: string; width: number; num?: boolean }[] = [
    { head: 'Sr.', width: 5 },
    { head: 'Month in GSTR-2B', width: 11 },
    { head: 'Supplier GSTIN', width: 17 },
    { head: 'Supplier name', width: 34 },
    { head: 'Document type', width: 15 },
    { head: 'Document no.', width: 18 },
    { head: 'Document date', width: 11 },
    { head: 'Taxable value', width: 14, num: true },
    { head: 'IGST', width: 12, num: true },
    { head: 'CGST', width: 12, num: true },
    { head: 'SGST', width: 12, num: true },
    { head: 'Total tax', width: 13, num: true },
    { head: 'Your remarks (booked on / voucher no. / reason)', width: 38 },
  ];
  ws.getColumn(1).width = 2;
  COLS.forEach((c, i) => { ws.getColumn(i + 2).width = c.width; });
  const lastCol = COLS.length + 1;
  let row = headerBlock(ws, lastCol, 'Purchases in your GSTR-2B not yet recorded in your books', meta);

  // Summary band
  const sumHeads = ['Documents', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Total ITC'];
  const sumVals = [sum.count, sum.taxable, sum.igst, sum.cgst, sum.sgst, sum.tax];
  ws.getCell(row, 2).value = 'Summary';
  ws.getCell(row, 2).font = font({ bold: true, color: { argb: NAVY } });
  row += 1;
  const sumStart = 2;
  sumHeads.forEach((h, i) => {
    const hc = ws.getCell(row, sumStart + i * 2);
    ws.mergeCells(row, sumStart + i * 2, row, sumStart + i * 2 + 1);
    hc.value = h;
    hc.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    hc.fill = solid(NAVY);
    hc.alignment = { horizontal: 'center', vertical: 'middle' };
    const vc = ws.getCell(row + 1, sumStart + i * 2);
    ws.mergeCells(row + 1, sumStart + i * 2, row + 1, sumStart + i * 2 + 1);
    vc.value = sumVals[i];
    vc.numFmt = i === 0 ? '0' : NUM_FMT;
    vc.font = font({ bold: true, size: 10 });
    vc.fill = solid(i === sumHeads.length - 1 ? AMBER : BAND);
    vc.alignment = { horizontal: 'center', vertical: 'middle' };
    for (const r of [row, row + 1]) for (const cc of [sumStart + i * 2, sumStart + i * 2 + 1]) ws.getCell(r, cc).border = BOX;
  });
  ws.getRow(row + 1).height = 18;
  row += 3;

  // Table head
  const headRow = row;
  COLS.forEach((c, i) => {
    const cell = ws.getCell(row, i + 2);
    cell.value = c.head;
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = solid(NAVY);
    cell.alignment = { horizontal: c.num ? 'right' : 'left', vertical: 'middle', wrapText: true };
    cell.border = BOX;
  });
  ws.getRow(row).height = 27;
  row += 1;

  // Rows
  const firstData = row;
  opts.rows.forEach((b, i) => {
    const vals: (string | number | Date | null)[] = [
      i + 1, b.monthIn2B, b.supplierGstin, b.supplierName, b.docType, b.docNo, isoToDmy(b.date),
      b.taxable, b.igst, b.cgst, b.sgst, r2(b.igst + b.cgst + b.sgst), '',
    ];
    vals.forEach((v, k) => {
      const cell = ws.getCell(row, k + 2);
      cell.value = v as never;
      cell.font = font();
      cell.border = BOX;
      if (COLS[k].num) cell.numFmt = NUM_FMT;
      if (k === 6) cell.numFmt = 'dd-mmm-yy';
      if (k === 0) cell.alignment = { horizontal: 'center' };
      if (k === 3) cell.alignment = { wrapText: true, vertical: 'top' };
      if (i % 2 === 1) cell.fill = solid(ZEBRA);
      if (k === COLS.length - 1) cell.fill = solid(AMBER);
    });
    row += 1;
  });
  const lastData = row - 1;

  // Totals: a rule above, a double rule below
  ws.getCell(row, 2).value = 'Total';
  ws.mergeCells(row, 2, row, 8);
  for (let c = 2; c <= lastCol; c++) {
    const cell = ws.getCell(row, c);
    cell.font = font({ bold: true });
    cell.fill = solid(BAND);
    cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'double', color: { argb: 'FF000000' } }, left: thin, right: thin };
  }
  // SUBTOTAL follows the filter; the result is stored for viewers that do not recalculate.
  const totals = [sum.taxable, sum.igst, sum.cgst, sum.sgst, sum.tax];
  ['I', 'J', 'K', 'L', 'M'].forEach((col, k) => {
    const cell = ws.getCell(`${col}${row}`);
    cell.value = opts.rows.length ? { formula: `SUBTOTAL(9,${col}${firstData}:${col}${lastData})`, result: totals[k] } as never : 0;
    cell.numFmt = NUM_FMT;
  });
  row += 2;
  if (opts.rows.length) ws.autoFilter = { from: { row: headRow, column: 2 }, to: { row: lastData, column: lastCol } };

  // What we need
  const notes = [
    'What we need from you',
    '1.  Record each document above in your books, or write in the last column why it should not be recorded (goods or services not received, wrong GSTIN, duplicate, and so on).',
    '2.  We claim input tax credit on these documents once they are recorded in your books, and reduce it by a credit note once that is recorded; recording them promptly lets us take each in the right month.',
    '3.  Amounts are as your suppliers reported them in GSTR-2B. A negative figure is a credit note or a downward amendment of a document. "Earlier" marks an older item whose GSTR-2B month was not recorded.',
    `4.  Please reply by ${opts.replyBy}. Questions: ${GST_FIRM.email}.`,
  ];
  notes.forEach((t, i) => {
    const cell = ws.getCell(row, 2);
    ws.mergeCells(row, 2, row, lastCol);
    cell.value = t;
    cell.font = font(i === 0 ? { bold: true, color: { argb: NAVY } } : { color: { argb: GREY } });
    cell.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(row).height = i === 0 ? 15 : 24;
    row += 1;
  });
  printSetup(ws, clientName, headRow);

  // ---- Sheet 2: by supplier ------------------------------------------------
  const ss = wb.addWorksheet('By supplier', { properties: { defaultRowHeight: 13.5 } });
  const SCOLS: { head: string; width: number; num?: boolean }[] = [
    { head: 'Sr.', width: 5 }, { head: 'Supplier GSTIN', width: 17 }, { head: 'Supplier name', width: 40 },
    { head: 'Documents', width: 11, num: true }, { head: 'Taxable value', width: 15, num: true }, { head: 'Total tax', width: 15, num: true },
  ];
  ss.getColumn(1).width = 2;
  SCOLS.forEach((c, i) => { ss.getColumn(i + 2).width = c.width; });
  let srow = headerBlock(ss, SCOLS.length + 1, 'Bills not in books by supplier', meta.slice(0, 3));
  const sHead = srow;
  SCOLS.forEach((c, i) => {
    const cell = ss.getCell(srow, i + 2);
    cell.value = c.head;
    cell.font = font({ bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = solid(NAVY);
    cell.alignment = { horizontal: c.num ? 'right' : 'left', vertical: 'middle' };
    cell.border = BOX;
  });
  srow += 1;
  sum.bySupplier.forEach((s, i) => {
    [i + 1, s.gstin, s.name, s.count, s.taxable, s.tax].forEach((v, k) => {
      const cell = ss.getCell(srow, k + 2);
      cell.value = v;
      cell.font = font();
      cell.border = BOX;
      if (k >= 4) cell.numFmt = NUM_FMT;
      if (k === 0 || k === 3) cell.alignment = { horizontal: k === 0 ? 'center' : 'right' };
      if (i % 2 === 1) cell.fill = solid(ZEBRA);
    });
    srow += 1;
  });
  ss.getCell(srow, 2).value = 'Total';
  ss.mergeCells(srow, 2, srow, 4);
  const sTot: [number, number, string][] = [[5, sum.count, '0'], [6, sum.taxable, NUM_FMT], [7, sum.tax, NUM_FMT]];
  for (let c = 2; c <= SCOLS.length + 1; c++) {
    const cell = ss.getCell(srow, c);
    cell.font = font({ bold: true });
    cell.fill = solid(BAND);
    cell.border = { top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'double', color: { argb: 'FF000000' } }, left: thin, right: thin };
  }
  sTot.forEach(([c, v, f]) => { const cell = ss.getCell(srow, c); cell.value = v; cell.numFmt = f; });
  printSetup(ss, clientName, sHead);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The supplier table under the message (top suppliers; the rest are in the attachment). */
function supplierTableHtml(sum: BillsSummary): string {
  const top = sum.bySupplier.slice(0, 8);
  const more = sum.bySupplier.length - top.length;
  const th = 'padding:7px 10px;background:#0f2b46;color:#ffffff;font-size:12px;font-weight:600;text-align:left;';
  const td = 'padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#1f2937;';
  const rows = top.map((s) =>
    `<tr><td style="${td}">${esc(s.name || s.gstin)}<div style="color:#64748b;font-size:11px;">${esc(s.gstin)}</div></td>`
    + `<td style="${td}text-align:right;">${s.count}</td><td style="${td}text-align:right;">&#8377;${formatINR(s.tax)}</td></tr>`).join('');
  return `<p style="margin:0 0 8px;font-weight:600;color:#0f2b46;">By supplier</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;border-collapse:separate;overflow:hidden;margin:0 0 8px;">
<tr><td style="${th}">Supplier</td><td style="${th}text-align:right;">Documents</td><td style="${th}text-align:right;">Tax</td></tr>
${rows}
<tr><td style="${td}font-weight:700;background:#f8fafc;">Total</td><td style="${td}font-weight:700;background:#f8fafc;text-align:right;">${sum.count}</td><td style="${td}font-weight:700;background:#f8fafc;text-align:right;">&#8377;${formatINR(sum.tax)}</td></tr>
</table>
<p style="margin:0 0 18px;color:#64748b;font-size:12px;">${more > 0 ? `and ${more} more supplier${more === 1 ? '' : 's'}; ` : ''}every document is in the attached Excel.</p>`;
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

export const isEmailList = (s: string) =>
  s.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).every((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))
  && s.split(/[,;]+/).some((x) => x.trim());

export interface SendResult { ok: boolean; status: string; error?: string; outboxId?: string }

export async function sendBillsNotInBooks(opts: {
  clientId: string; clientName: string; gstin: string; periodMonth: string;
  to: string; cc: string; replyBy: string; rows: BillNotInBooks[];
  staffName: string; userId: string | null;
}): Promise<SendResult> {
  const sum = summariseBills(opts.rows);
  const { data: tpl, error: tErr } = await supabase.from('email_templates')
    .select('subject, body, is_active').eq('key', 'bills_not_in_books').maybeSingle();
  if (tErr || !tpl) return { ok: false, status: 'error', error: tErr?.message || 'The e-mail template is missing.' };
  if (tpl.is_active === false) return { ok: false, status: 'error', error: 'The "Bills in GSTR-2B not in your books" template is switched off under Reminders.' };

  const bytes = await buildBillsWorkbook({
    clientName: opts.clientName, gstin: opts.gstin, periodMonth: opts.periodMonth, rows: opts.rows,
    preparedBy: opts.staffName, replyBy: opts.replyBy,
  });
  const name = clientFacingName(opts.clientName);
  const base64 = toBase64(bytes);
  // Microsoft Graph refuses a message over about 4 MB as JSON.
  if (base64.length > 3_000_000) return { ok: false, status: 'error', error: 'The Excel is too large to e-mail (over 3 MB). Download it and send it by hand.' };
  const vars: Record<string, string> = {
    contact_person: name,
    client_name: name,
    gstin: opts.gstin,
    period: prettyPeriod(opts.periodMonth),
    bill_count: `${sum.count} document${sum.count === 1 ? '' : 's'}`,
    itc_total: `₹${formatINR(sum.tax)}`,
    reply_by: opts.replyBy,
    staff_name: opts.staffName || GST_FIRM.team,
    firm_name: GST_FIRM.name,
    firm_email: GST_FIRM.email,
    firm_phone: GST_FIRM.phone,
  };
  const { data: row, error } = await supabase.from('email_outbox').insert({
    client_id: opts.clientId,
    to_email: opts.to.trim(),
    cc_email: opts.cc.trim() || null,
    kind: 'bills_not_in_books' as never,
    template_key: 'bills_not_in_books',
    return_type: null,
    period_month: opts.periodMonth,
    subject: renderTemplate(tpl.subject, vars),
    body: renderTemplate(tpl.body, vars),
    render_vars: { ...vars, table_html: supplierTableHtml(sum) },
    attachments: [{
      name: billsWorkbookName(opts.clientName, opts.periodMonth),
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content_base64: base64,
    }],
    status: 'pending',
    created_by: opts.userId,
  }).select('id').single();
  if (error || !row) return { ok: false, status: 'error', error: error?.message || 'Could not queue the e-mail.' };

  // Send it now (the function also drains on its daily run, so a failure here
  // leaves the row pending rather than lost).
  const { data: fn, error: fnErr } = await supabase.functions.invoke('send-gst-email', { body: { id: row.id } });
  if (!fnErr && (fn as { sent?: number } | null)?.sent === 1) return { ok: true, status: 'sent', outboxId: row.id };
  const { data: after } = await supabase.from('email_outbox').select('status, error').eq('id', row.id).maybeSingle();
  const status = after?.status || 'unknown';
  if (status === 'sent') return { ok: true, status, outboxId: row.id };
  return { ok: false, status, error: after?.error || fnErr?.message || undefined, outboxId: row.id };
}

export interface LastSent { at: string; to: string; status: string; by: string | null }

/** The latest bills not in books e-mail for the client and month. */
export async function lastBillsMail(clientId: string, periodMonth: string): Promise<LastSent | null> {
  const { data } = await supabase.from('email_outbox')
    .select('created_at, sent_at, to_email, status, created_by')
    .eq('client_id', clientId).eq('period_month', periodMonth).eq('kind', 'bills_not_in_books' as never)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  let by: string | null = null;
  if (data.created_by) {
    const { data: p } = await supabase.from('profiles').select('first_name').eq('user_id', data.created_by).maybeSingle();
    by = p?.first_name ?? null;
  }
  return { at: data.sent_at || data.created_at, to: data.to_email, status: data.status, by };
}
