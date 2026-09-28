// PDF exports of the Annual Return working: the GSTR-9 form (Tables 4–18 in
// the official layout) and the firm's Notice format. Every figure is read
// from computeWorkings() — nothing is recomputed here. Tables 14–18 are
// typed cells the engine does not carry, so they are read from the docs.
//
// The table structures (gstr9FormTables / noticeTables) are shared with the
// Excel export (exportWorkbook.ts) so the two never disagree.

import type { CellHookData, RowInput } from 'jspdf-autotable';
import { drawFooters, nowStamp, reportTable, startDoc } from '@/utils/reportTheme';
import { rowTax, type Workings } from './engine';
import type { AnnualReturnDocs, HsnRow, Tax, ValTax } from './types';

export interface ExportMeta {
  clientName: string;
  gstin: string;
  financialYear: string;
}

// ---------------------------------------------------------------------------
// Shared form-table structure
// ---------------------------------------------------------------------------

export type FormCell = number | string | null;

export interface FormRow {
  /** Row letter as on the form ("A", "A1", "H1"), or the HSN code in Tables 17/18. */
  code: string;
  label: string;
  cells: FormCell[];
  bold?: boolean;
  indent?: boolean;
}

export interface FormTable {
  /** Part heading printed before this table when it changes ("Pt. II …"). */
  part?: string;
  no: string;
  title: string;
  /** Column headers after "No." and the description column. */
  head: string[];
  /** Header of the description column. */
  labelHead?: string;
  rows: FormRow[];
  note?: string;
}

export const VAL_HEAD = ['Taxable Value', 'Central Tax', 'State Tax / UT Tax', 'Integrated Tax', 'Cess'];
export const TAX_HEAD = ['Central Tax', 'State Tax / UT Tax', 'Integrated Tax', 'Cess'];

/** Value + tax in the form's column order: taxable, central, state, integrated, cess. */
const vc = (v: ValTax): FormCell[] => [v.t, v.c, v.s, v.i, v.x];
const tc = (t: Tax): FormCell[] => [t.c, t.s, t.i, t.x];
const onlyValue = (v: ValTax | number): FormCell[] => [typeof v === 'number' ? v : v.t, null, null, null, null];

const fyStart = (fy: string): number => Number(String(fy).slice(0, 4)) || 0;

export function gstr9FormTables(w: Workings, docs?: AnnualReturnDocs | null): FormTable[] {
  const g = w.g9;
  const t4 = g.t4;
  const t5 = g.t5;
  const t6 = g.t6;
  const t7 = g.t7;
  const t8 = g.t8;
  const tables: FormTable[] = [];

  tables.push({
    part: 'Pt. II   Details of outward and inward supplies made during the financial year',
    no: '4',
    title: 'Details of advances, inward and outward supplies made during the financial year on which tax is payable',
    labelHead: 'Nature of Supplies',
    head: VAL_HEAD,
    note: g.t4Source === 'none' ? 'GSTR-9 system-computed figures have not been fetched — Table 4 (other than 4G, from the RCM working) is blank.' : undefined,
    rows: [
      { code: 'A', label: 'Supplies made to un-registered persons (B2C)', cells: vc(t4.A) },
      { code: 'B', label: 'Supplies made to registered persons (B2B)', cells: vc(t4.B) },
      { code: 'C', label: 'Zero rated supply (Export) on payment of tax (except supplies to SEZs)', cells: vc(t4.C) },
      { code: 'D', label: 'Supply to SEZs on payment of tax', cells: vc(t4.D) },
      { code: 'E', label: 'Deemed Exports', cells: vc(t4.E) },
      { code: 'F', label: 'Advances on which tax has been paid but invoice has not been issued (not covered under (A) to (E) above)', cells: vc(t4.F) },
      { code: 'G', label: 'Inward supplies on which tax is to be paid on reverse charge basis', cells: vc(t4.G) },
      { code: 'G1', label: 'Supplies on which e-commerce operator is required to pay tax as per section 9(5) (including amendments, if any) [E-commerce operator to report]', cells: vc(t4.G1) },
      { code: 'H', label: 'Sub-total (A to G1 above)', cells: vc(t4.H), bold: true },
      { code: 'I', label: 'Credit Notes issued in respect of transactions specified in (B) to (E) above (-)', cells: vc(t4.I) },
      { code: 'J', label: 'Debit Notes issued in respect of transactions specified in (B) to (E) above (+)', cells: vc(t4.J) },
      { code: 'K', label: 'Supplies / tax declared through Amendments (+)', cells: vc(t4.K) },
      { code: 'L', label: 'Supplies / tax reduced through Amendments (-)', cells: vc(t4.L) },
      { code: 'M', label: 'Sub-total (I to L above)', cells: vc(t4.M), bold: true },
      { code: 'N', label: 'Supplies and advances on which tax is to be paid (H + M) above', cells: vc(t4.N), bold: true },
    ],
  });

  tables.push({
    no: '5',
    title: 'Details of outward supplies made during the financial year on which tax is not payable',
    labelHead: 'Nature of Supplies',
    head: VAL_HEAD,
    rows: [
      { code: 'A', label: 'Zero rated supply (Export) without payment of tax', cells: onlyValue(t5.A) },
      { code: 'B', label: 'Supply to SEZs without payment of tax', cells: onlyValue(t5.B) },
      { code: 'C', label: 'Supplies on which tax is to be paid by the recipient on reverse charge basis', cells: onlyValue(t5.C) },
      { code: 'C1', label: 'Supplies on which tax is to be paid by e-commerce operators as per section 9(5) [Supplier to report]', cells: onlyValue(t5.C1) },
      { code: 'D', label: 'Exempted', cells: onlyValue(t5.D) },
      { code: 'E', label: 'Nil Rated', cells: onlyValue(t5.E) },
      { code: 'F', label: "Non-GST supply (includes 'no supply')", cells: onlyValue(t5.F) },
      { code: 'G', label: 'Sub-total (A to F above)', cells: onlyValue(t5.G), bold: true },
      { code: 'H', label: 'Credit Notes issued in respect of transactions specified in A to F above (-)', cells: onlyValue(t5.H) },
      { code: 'I', label: 'Debit Notes issued in respect of transactions specified in A to F above (+)', cells: onlyValue(t5.I) },
      { code: 'J', label: 'Supplies declared through Amendments (+)', cells: onlyValue(t5.J) },
      { code: 'K', label: 'Supplies reduced through Amendments (-)', cells: onlyValue(t5.K) },
      { code: 'L', label: 'Sub-Total (H to K above)', cells: onlyValue(t5.L), bold: true },
      { code: 'M', label: 'Turnover on which tax is not to be paid (G + L) above', cells: onlyValue(t5.M), bold: true },
      { code: 'N', label: 'Total Turnover (including advances) (4N + 5M - 4G - 4G1) above', cells: vc(t5.N), bold: true },
    ],
  });

  const typed = (type: string, t: Tax): FormCell[] => [type, ...tc(t)];
  tables.push({
    part: 'Pt. III   Details of ITC for the financial year',
    no: '6',
    title: 'Details of ITC availed during the financial year',
    labelHead: 'Description',
    head: ['Type', ...TAX_HEAD],
    rows: [
      { code: 'A', label: 'Total amount of input tax credit availed through FORM GSTR-3B (sum total of Table 4A of FORM GSTR-3B)', cells: typed('', t6.A) },
      { code: 'A1', label: 'ITC of any preceding financial year availed in the financial year (included in 6A above) other than reclaim', cells: typed('', t6.A1) },
      { code: 'A2', label: 'Net ITC of the financial year (A - A1)', cells: typed('', t6.A2), bold: true },
      { code: 'B', label: 'Inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs)', cells: typed('Inputs', t6.B_ip) },
      { code: '', label: '', cells: typed('Capital Goods', t6.B_cg) },
      { code: '', label: '', cells: typed('Input Services', t6.B_is) },
      { code: 'C', label: 'Inward supplies received from unregistered persons liable to reverse charge (other than B above) on which tax is paid & ITC availed', cells: typed('Inputs', t6.C_ip) },
      { code: '', label: '', cells: typed('Capital Goods', t6.C_cg) },
      { code: '', label: '', cells: typed('Input Services', t6.C_is) },
      { code: 'D', label: 'Inward supplies received from registered persons liable to reverse charge (other than B above) on which tax is paid and ITC availed', cells: typed('Inputs', t6.D_ip) },
      { code: '', label: '', cells: typed('Capital Goods', t6.D_cg) },
      { code: '', label: '', cells: typed('Input Services', t6.D_is) },
      { code: 'E', label: 'Import of goods (including supplies from SEZs)', cells: typed('Inputs', t6.E_ip) },
      { code: '', label: '', cells: typed('Capital Goods', t6.E_cg) },
      { code: 'F', label: 'Import of services (excluding inward supplies from SEZs)', cells: typed('', t6.F) },
      { code: 'G', label: 'Input Tax credit received from ISD', cells: typed('', t6.G) },
      { code: 'H', label: 'Amount of ITC reclaimed (other than B above) under the provisions of the Act', cells: typed('', t6.H) },
      { code: 'I', label: 'Sub-total (B to H above)', cells: typed('', t6.I), bold: true },
      { code: 'J', label: 'Difference (I - A2 above)', cells: typed('', t6.J), bold: true },
      { code: 'K', label: 'Transition Credit through TRAN-1 (including revisions if any)', cells: typed('', t6.K) },
      { code: 'L', label: 'Transition Credit through TRAN-2', cells: typed('', t6.L) },
      { code: 'M', label: 'ITC availed through ITC-01, ITC-02 and ITC-02A (other than GSTR-3B and TRAN forms)', cells: typed('', t6.M) },
      { code: 'N', label: 'Sub-total (K to M above)', cells: typed('', t6.N), bold: true },
      { code: 'O', label: 'Total ITC availed (I + N) above', cells: typed('', t6.O), bold: true },
    ],
  });

  tables.push({
    no: '7',
    title: 'Details of ITC reversed and ineligible ITC for the financial year',
    labelHead: 'Description',
    head: TAX_HEAD,
    rows: [
      { code: 'A', label: 'As per Rule 37', cells: tc(t7.A) },
      { code: 'A1', label: 'As per Rule 37A', cells: tc(t7.A1) },
      { code: 'A2', label: 'As per Rule 38', cells: tc(t7.A2) },
      { code: 'B', label: 'As per Rule 39', cells: tc(t7.B) },
      { code: 'C', label: 'As per Rule 42', cells: tc(t7.C) },
      { code: 'D', label: 'As per Rule 43', cells: tc(t7.D) },
      { code: 'E', label: 'As per section 17(5)', cells: tc(t7.E) },
      { code: 'F', label: 'Reversal of TRAN-I credit', cells: tc(t7.F) },
      { code: 'G', label: 'Reversal of TRAN-II credit', cells: tc(t7.G) },
      ...g.t7H.map((h, i) => ({ code: `H${i + 1}`, label: `Other reversal — ${h.description || 'other'}`, cells: tc(h.tax) })),
      { code: 'I', label: 'Total ITC Reversed (Sum of A to H above)', cells: tc(g.t7I), bold: true },
      { code: 'J', label: 'Net ITC Available for Utilization (6O - 7I)', cells: tc(g.t7J), bold: true },
    ],
  });

  const twoA = fyStart(w.ctx.financialYear) > 0 && fyStart(w.ctx.financialYear) < 2023;
  tables.push({
    no: '8',
    title: 'Other ITC related information',
    labelHead: 'Description',
    head: TAX_HEAD,
    rows: [
      { code: 'A', label: twoA ? 'ITC as per GSTR-2A (Table 3 & 5 thereof)' : 'ITC as per GSTR-2B [Table 3(I) thereof]', cells: tc(t8.A) },
      { code: 'B', label: 'ITC as per sum total of 6(B) and 6(H) above', cells: tc(t8.B) },
      { code: 'C', label: 'ITC on inward supplies (other than imports and inward supplies liable to reverse charge but includes services received from SEZs) received during the financial year but availed in the next financial year upto specified period', cells: tc(t8.C) },
      { code: 'D', label: 'Difference [A - (B + C)]', cells: tc(t8.D), bold: true },
      { code: 'E', label: 'ITC available but not availed', cells: tc(t8.E) },
      { code: 'F', label: 'ITC available but ineligible', cells: tc(t8.F) },
      { code: 'G', label: 'IGST paid on import of goods (including supplies from SEZ)', cells: tc(t8.G) },
      { code: 'H', label: 'IGST credit availed on import of goods (as per 6(E) above)', cells: tc(t8.H) },
      { code: 'H1', label: 'IGST credit availed on import of goods in the next financial year', cells: tc(t8.H1) },
      { code: 'I', label: 'Difference (G - H - H1)', cells: tc(t8.I), bold: true },
      { code: 'J', label: 'ITC available but not availed on import of goods (equal to I)', cells: tc(t8.J) },
      { code: 'K', label: 'Total ITC to be lapsed in current financial year (E + F + J)', cells: tc(t8.K), bold: true },
    ],
  });

  const t9Row = (code: string, label: string, r: Workings['g9']['t9']['igst']): FormRow => ({
    code, label, cells: [r.payable, r.cash, r.itcC, r.itcS, r.itcI, r.itcX, r.paid, r.diff],
  });
  const t9Other = (code: string, label: string, r: Workings['g9']['t9Other']['interest']): FormRow => ({
    code, label, cells: [r.payable, r.cash, null, null, null, null, r.cash, r.diff],
  });
  tables.push({
    part: 'Pt. IV   Details of tax paid as declared in returns filed during the financial year',
    no: '9',
    title: 'Details of tax paid as declared in returns filed during the financial year',
    labelHead: 'Description',
    head: ['Tax Payable', 'Paid through cash', 'ITC: Central Tax', 'ITC: State Tax / UT Tax', 'ITC: Integrated Tax', 'ITC: Cess', 'Total tax paid', 'Difference'],
    rows: [
      t9Row('A', 'Integrated Tax', g.t9.igst),
      t9Row('B', 'Central Tax', g.t9.cgst),
      t9Row('C', 'State/UT Tax', g.t9.sgst),
      t9Row('D', 'Cess', g.t9.cess),
      t9Other('E', 'Interest', g.t9Other.interest),
      t9Other('F', 'Late fee', g.t9Other.lateFee),
      t9Other('G', 'Penalty', g.t9Other.penalty),
      t9Other('H', 'Other', g.t9Other.other),
    ],
  });

  tables.push({
    part: 'Pt. V   Particulars of the transactions for the previous FY declared in returns of April to September of current FY or upto date of filing of annual return of previous FY, whichever is earlier',
    no: '10–13',
    title: 'Transactions of the financial year declared in the next financial year',
    labelHead: 'Description',
    head: VAL_HEAD,
    rows: [
      { code: '10', label: 'Supplies / tax declared through Amendments (+) (net of debit notes)', cells: vc(g.t10) },
      { code: '11', label: 'Supplies / tax reduced through Amendments (-) (net of credit notes)', cells: vc(g.t11) },
      { code: '12', label: 'Reversal of ITC availed during previous financial year', cells: [null, ...tc(g.t12)] },
      { code: '13', label: 'ITC availed for the previous financial year', cells: [null, ...tc(g.t13)] },
      { code: '', label: 'Total turnover (5N + 10 - 11)', cells: vc(g.totalTurnover), bold: true },
    ],
  });

  if (docs) {
    const G = docs.gstr9;
    tables.push({
      no: '14',
      title: 'Differential tax paid on account of declaration in 10 & 11 above',
      labelHead: 'Description',
      head: ['Payable', 'Paid'],
      rows: [
        { code: '', label: 'Integrated Tax', cells: [G.t14.igst.payable, G.t14.igst.paid] },
        { code: '', label: 'Central Tax', cells: [G.t14.cgst.payable, G.t14.cgst.paid] },
        { code: '', label: 'State/UT Tax', cells: [G.t14.sgst.payable, G.t14.sgst.paid] },
        { code: '', label: 'Cess', cells: [G.t14.cess.payable, G.t14.cess.paid] },
        { code: '', label: 'Interest', cells: [G.t14.interest.payable, G.t14.interest.paid] },
      ],
    });

    const T15 = G.t15;
    const refund = (t: Tax): FormCell[] => [...tc(t), null, null, null];
    const demand = (d: typeof T15.demandTotal): FormCell[] => [...tc(d), d.interest, d.penalty, (d.lateFee || 0) + (d.others || 0)];
    tables.push({
      part: 'Pt. VI   Other information',
      no: '15',
      title: 'Particulars of Demands and Refunds',
      labelHead: 'Details',
      head: [...TAX_HEAD, 'Interest', 'Penalty', 'Late Fee / Others'],
      rows: [
        { code: 'A', label: 'Total Refund claimed', cells: refund(T15.refundClaimed) },
        { code: 'B', label: 'Total Refund sanctioned', cells: refund(T15.refundSanctioned) },
        { code: 'C', label: 'Total Refund Rejected', cells: refund(T15.refundRejected) },
        { code: 'D', label: 'Total Refund Pending', cells: refund(T15.refundPending) },
        { code: 'E', label: 'Total demand of taxes', cells: demand(T15.demandTotal) },
        { code: 'F', label: 'Total taxes paid in respect of E above', cells: demand(T15.demandPaid) },
        { code: 'G', label: 'Total demands pending out of E above', cells: demand(T15.demandPending) },
      ],
    });

    tables.push({
      no: '16',
      title: 'Information on supplies received from composition taxpayers, deemed supply under section 143 and goods sent on approval basis',
      labelHead: 'Details',
      head: VAL_HEAD,
      rows: [
        { code: 'A', label: 'Supplies received from Composition taxpayers', cells: onlyValue(G.t16.compositionSupplies) },
        { code: 'B', label: 'Deemed supply under Section 143', cells: vc(G.t16.deemedSupply) },
        { code: 'C', label: 'Goods sent on approval basis but not returned', cells: vc(G.t16.approvalNotReturned) },
      ],
    });

    const hsnTable = (no: string, title: string, rows: HsnRow[]): FormTable => {
      const body: FormRow[] = rows.map((r) => {
        const t = rowTax(r);
        return {
          code: r.hsn || '',
          label: r.description || '',
          cells: [r.uqc || '', r.qty, r.taxable, r.concessional ? 'Yes' : 'No', r.rate === null || r.rate === undefined ? '' : `${r.rate}%`, t.c, t.s, t.i, t.x],
        };
      });
      if (body.length) {
        const sum = rows.reduce(
          (a, r) => {
            const t = rowTax(r);
            return { q: a.q + (Number(r.qty) || 0), v: a.v + (Number(r.taxable) || 0), c: a.c + t.c, s: a.s + t.s, i: a.i + t.i, x: a.x + t.x };
          },
          { q: 0, v: 0, c: 0, s: 0, i: 0, x: 0 },
        );
        body.push({ code: '', label: 'Total', cells: ['', sum.q, sum.v, '', '', sum.c, sum.s, sum.i, sum.x], bold: true });
      }
      return {
        no,
        title,
        labelHead: 'Description',
        head: ['UQC', 'Total Quantity', 'Taxable Value', 'Concessional rate?', 'Rate of Tax', 'Central Tax', 'State Tax / UT Tax', 'Integrated Tax', 'Cess'],
        rows: body.length ? body : [{ code: '', label: 'Nil', cells: ['', null, null, '', '', null, null, null, null] }],
      };
    };
    tables.push(hsnTable('17', 'HSN Wise Summary of outward supplies', G.t17));
    tables.push(hsnTable('18', 'HSN Wise Summary of Inward supplies', G.t18));
  }

  return tables;
}

/** Notice format — columns in the firm's order (SGST, CGST, IGST, Cess, Total), each holding its own head. */
export function noticeTables(w: Workings): { outward: FormTable; inward: FormTable } {
  const row = (code: string, label: string, table: string, t: Tax, bold = false): FormRow => ({
    code, label, bold, cells: [table, t.s, t.c, t.i, t.x, t.i + t.c + t.s + t.x],
  });
  const o = w.notice.outward;
  const n = w.notice.inward;
  const head = ['Table No. in GSTR-09', 'SGST', 'CGST', 'IGST', 'CESS', 'TOTAL'];
  return {
    outward: {
      no: '',
      title: 'OUTWARD',
      labelHead: 'Issue',
      head,
      rows: [
        row('1', 'Tax on taxable supplies as declared in GSTR-09', '4N', o.r1),
        row('2', 'Add net increase due to amendments (increase in amendments (-) decrease in amendments)', '10 (-) 11', o.r2),
        row('3', 'Add tax on deemed supplies', '16B', o.r3),
        row('4', 'Add tax on unreturned goods', '16C', o.r4),
        row('5', 'Pending demands', '15G', o.r5),
        row('6', 'Total output tax liability as per the above in GSTR-09 (S.No 1+2+3+4+5)', '', o.r6, true),
        row('7', 'Less total tax paid in cash', '9', o.r7),
        row('8', 'Less tax paid by adjustment of ITC', '9', o.r8),
        row('9', 'Less differential tax paid on amendments', '14', o.r9),
        row('10', 'Add differential tax paid on amendments related to previous year in current year', '(14) of previous FY GSTR-09', o.r10),
        row('11', 'Net tax payable (S.No 6-7-8-9+10)', '', o.r11, true),
      ],
    },
    inward: {
      no: '',
      title: 'INWARD',
      labelHead: 'Description',
      head,
      rows: [
        row('1', 'ITC in the year as per Table 8A of GSTR-09', '8A', n.r1),
        row('2', 'ITC brought forward from previous FY to current FY, Table 8C of previous FY GSTR-09', '8C (previous FY)', n.r2),
        row('3', 'ITC carried forward from present FY to subsequent FY, Table 8C of GSTR-09', '8C', n.r3),
        row('4', 'Ineligible ITC as per 4(D) of GSTR-3B', '4(D) of GSTR-3B', n.r4),
        row('5', 'Ineligible ITC u/s 16(4): the supplier has filed returns after the cut-off date (excluding RCM & POS ITC)', '', n.r5),
        row('6', 'ITC available for use in the same year (S.No 1+2-3-4-5)', '', n.r6, true),
        row('7', 'ITC used in the same year as per 4A(5) of GSTR-3B', '4A(5) of GSTR-3B', n.r7),
        row('8', 'Reversed in 4(B)(2)', '4(B)(2) of GSTR-3B', n.r8),
        row('9', 'Net excess used (S.No 7-6-8)', '', n.r9, true),
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

const INR2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 2-decimal Indian grouping; negative zero and float noise print as 0.00. */
const fmt2 = (n: number): string => INR2.format(Math.abs(n) < 0.005 ? 0 : n);

/** The core PDF fonts are WinAnsi — swap the few characters they cannot draw. */
const pdfText = (s: string): string =>
  s.replace(/₹/g, 'Rs.').replace(/[−–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

const cellText = (c: FormCell): string => {
  if (c === null || c === undefined) return '';
  if (typeof c === 'number') return Number.isFinite(c) ? fmt2(c) : '';
  return pdfText(c);
};

type Doc = ReturnType<typeof startDoc>['doc'];

const lastY = (doc: Doc, fallback: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

/** Keep a heading and the start of its table on the same page. */
const ensureSpace = (doc: Doc, y: number, need: number): number => {
  const H = doc.internal.pageSize.getHeight();
  if (y + need > H - 18) {
    doc.addPage();
    return 16;
  }
  return y;
};

const drawText = (doc: Doc, text: string, y: number, opts: { size: number; bold?: boolean; muted?: boolean }): number => {
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(opts.size);
  doc.setTextColor(...((opts.muted ? [107, 114, 128] : [17, 24, 39]) as [number, number, number]));
  const lines = doc.splitTextToSize(pdfText(text), W - 28) as string[];
  doc.text(lines, 14, y);
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
      0: { cellWidth: 12 },
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
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold', fontSize, halign: 'left', valign: 'middle' },
      columnStyles,
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && bold.has(d.row.index)) d.cell.styles.fontStyle = 'bold';
        if (d.section === 'head' && d.column.index >= 2 && columnStyles[d.column.index]?.halign === 'right') d.cell.styles.halign = 'right';
      },
      margin: { left: 14, right: 14, top: 14, bottom: 16 },
    });
    y = lastY(doc, y) + 2;
  });
  return y;
}

/** "GSTR9_Working_24AAMCA2528C1Z3_2024-25.xlsx" — safe on every platform, FY hyphen kept. */
export const exportFileName = (kind: string, meta: ExportMeta, ext: 'pdf' | 'xlsx'): string =>
  `${[kind, meta.gstin || 'NO-GSTIN', meta.financialYear].map((p) => String(p).replace(/[^A-Za-z0-9-]+/g, '_')).join('_')}.${ext}`;

/** Form GSTR-9, Tables 4–18, landscape A4. Pass the docs to include the typed Tables 14–18. Returns the file name. */
export function exportGstr9Pdf(workings: Workings, meta: ExportMeta, docs?: AnnualReturnDocs | null): string {
  const stamp = nowStamp();
  const { doc, y } = startDoc('l', {
    title: 'Form GSTR-9 — Annual Return',
    subtitle: `Financial year ${meta.financialYear} · all amounts in Rs.`,
    fields: [
      { label: '1  Financial year', value: meta.financialYear },
      { label: '2  GSTIN', value: meta.gstin },
      { label: '3A  Legal name of the registered person', value: pdfText(meta.clientName) },
    ],
  });
  renderTables(doc, gstr9FormTables(workings, docs), y);
  drawFooters(doc, stamp);
  const name = exportFileName('GSTR9', meta, 'pdf');
  doc.save(name);
  return name;
}

/** The firm's Notice format (outward + inward), landscape A4. Returns the file name. */
export function exportNoticePdf(workings: Workings, meta: ExportMeta): string {
  const stamp = nowStamp();
  const { doc, y } = startDoc('l', {
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
  drawFooters(doc, stamp);
  const name = exportFileName('GSTR9_Notice', meta, 'pdf');
  doc.save(name);
  return name;
}
