/**
 * Builder → Returns, unit by unit (the firm, 18 Nov 2026): every table on the
 * page (3B 3.1(a), GSTR-1 Table 7 / 10, 11A, 11B / 11B(2), the land third of
 * Table 8) shows, under each rate line, the units whose postings make it up,
 * grouped by block with block subtotals, and can be filtered to a block. The
 * export carries the same detail. Figures are the postings as stored
 * (builder_period_postings); nothing is recalculated here.
 */
import { unitBlock } from '@/lib/builderUnitBlocks';
import type { ReportSheet, ReportTable, RowKind } from '@/utils/allClientsReports';

export interface UnitPosting {
  source_type: string;
  gstr1_table: string;
  unit_id: string;
  unit_no: string;
  rate_code: string;
  rate_pct: number;
  consideration: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  land_deduction: number;
}

export type ReturnTableKey = 'outward' | 'table7' | 'table11A' | 'table11B';

/** Which postings each table on the page is made of (as summarisePeriod rolls them). */
export const TABLE_SOURCES: Record<ReturnTableKey, string[] | null> = {
  outward: null, // every leg, netted
  table7: ['INVOICE_B2CS'],
  table11A: ['ADVANCE_11A'],
  table11B: ['ADVANCE_11B', 'OPENING_11B'],
};

export const TABLE_TITLES: Record<ReturnTableKey, string> = {
  outward: 'GSTR-3B Table 3.1(a) — outward taxable supplies (all legs netted)',
  table7: 'GSTR-1 Table 7 — B2CS (Table 10 for an amendment)',
  table11A: 'GSTR-1 Table 11A — advances received',
  table11B: 'GSTR-1 Table 11B — advances adjusted (11B(2) for an amendment)',
};

export const NO_BLOCK = '—';
export const blockOf = (unitNo: string): string => unitBlock({ unit_no: unitNo }, new Map()) ?? NO_BLOCK;

export const rateKey = (r: { rate_code: string; rate_pct: number }) => `${r.rate_code}|${Number(r.rate_pct) || 0}`;

export interface UnitLine {
  block: string;
  unitId: string;
  unitNo: string;
  /** The GSTR-1 tables the unit's postings went to ("Table 7", "Table 10"…). */
  tables: string[];
  docs: number;
  consideration: number;
  land: number;
  taxable: number;
  cgst: number;
  sgst: number;
}

export interface BlockGroup {
  block: string;
  units: UnitLine[];
  total: Omit<UnitLine, 'block' | 'unitId' | 'unitNo' | 'tables'>;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const inTable = (key: ReturnTableKey) => (p: UnitPosting) => {
  const src = TABLE_SOURCES[key];
  return !src || src.includes(p.source_type);
};

/** The postings of one table and rate line, unit by unit, in their blocks. */
export function unitLines(postings: UnitPosting[]): BlockGroup[] {
  const byUnit = new Map<string, UnitLine>();
  for (const p of postings) {
    const u = byUnit.get(p.unit_id) || {
      block: blockOf(p.unit_no), unitId: p.unit_id, unitNo: p.unit_no, tables: [],
      docs: 0, consideration: 0, land: 0, taxable: 0, cgst: 0, sgst: 0,
    };
    if (p.gstr1_table && !u.tables.includes(p.gstr1_table)) u.tables.push(p.gstr1_table);
    u.docs += 1;
    u.consideration = r2(u.consideration + (Number(p.consideration) || 0));
    u.land = r2(u.land + (Number(p.land_deduction) || 0));
    u.taxable = r2(u.taxable + (Number(p.taxable_value) || 0));
    u.cgst = r2(u.cgst + (Number(p.cgst) || 0));
    u.sgst = r2(u.sgst + (Number(p.sgst) || 0));
    byUnit.set(p.unit_id, u);
  }
  const blocks = new Map<string, UnitLine[]>();
  for (const u of byUnit.values()) {
    if (!blocks.has(u.block)) blocks.set(u.block, []);
    blocks.get(u.block)!.push(u);
  }
  const cmpUnit = (a: UnitLine, b: UnitLine) => a.unitNo.localeCompare(b.unitNo, undefined, { numeric: true });
  return [...blocks.entries()]
    .sort(([a], [b]) => (a === NO_BLOCK ? 1 : b === NO_BLOCK ? -1 : a.localeCompare(b)))
    .map(([block, units]) => ({
      block,
      units: units.sort(cmpUnit),
      total: units.reduce((t, u) => ({
        docs: t.docs + u.docs,
        consideration: r2(t.consideration + u.consideration),
        land: r2(t.land + u.land),
        taxable: r2(t.taxable + u.taxable),
        cgst: r2(t.cgst + u.cgst),
        sgst: r2(t.sgst + u.sgst),
      }), { docs: 0, consideration: 0, land: 0, taxable: 0, cgst: 0, sgst: 0 }),
    }));
}

/** The blocks present in the period's postings, for the filter. */
export const blocksIn = (postings: UnitPosting[]): string[] =>
  [...new Set(postings.map((p) => blockOf(p.unit_no)))]
    .sort((a, b) => (a === NO_BLOCK ? 1 : b === NO_BLOCK ? -1 : a.localeCompare(b)));

const rateLabel = (p: { rate_pct: number }) => `${Number(p.rate_pct) || 0}%`;

/**
 * The export: one Unit-wise sheet with every table → rate → block → unit,
 * block subtotals and table totals, plus a Rate summary sheet.
 */
export function returnsUnitWiseReport(params: {
  clientName: string;
  gstin: string | null;
  periodLabel: string;
  projectLabel: string;
  blockLabel: string;
  /** "All" or the block the page is filtered to. */
  blockFilter: string;
  postings: UnitPosting[];
}): ReportTable {
  const headers = ['Table', 'Rate', 'Block', 'Unit', 'GSTR-1 table', 'Documents', 'Consideration',
    'Non-GST (land)', 'Taxable value', 'CGST', 'SGST', 'Total tax'];
  const rows: (string | number)[][] = [];
  const kinds: (RowKind | null)[] = [];
  const summaryRows: (string | number)[][] = [];
  const summaryKinds: (RowKind | null)[] = [];
  const line = (t: string, rate: string, block: string, unit: string, tables: string, x: BlockGroup['total']) =>
    [t, rate, block, unit, tables, x.docs, x.consideration, x.land, x.taxable, x.cgst, x.sgst, r2(x.cgst + x.sgst)];

  (Object.keys(TABLE_TITLES) as ReturnTableKey[]).forEach((key) => {
    const ps = params.postings.filter(inTable(key));
    if (!ps.length) return;
    const title = TABLE_TITLES[key];
    rows.push([title, '', '', '', '', '', '', '', '', '', '', '']); kinds.push('section');
    const rates = [...new Set(ps.map(rateKey))]
      .sort((a, b) => Number(a.split('|')[1]) - Number(b.split('|')[1]));
    const tableTot = { docs: 0, consideration: 0, land: 0, taxable: 0, cgst: 0, sgst: 0 };
    for (const rk of rates) {
      const rp = ps.filter((p) => rateKey(p) === rk);
      const rate = rateLabel(rp[0]);
      const groups = unitLines(rp);
      const rateTot = { docs: 0, consideration: 0, land: 0, taxable: 0, cgst: 0, sgst: 0 };
      for (const g of groups) {
        for (const u of g.units) {
          rows.push(line(title, rate, g.block, u.unitNo, u.tables.join(', '), u)); kinds.push('data');
        }
        rows.push(line(title, rate, g.block, `${params.blockLabel} ${g.block} subtotal`, '', g.total)); kinds.push('subtotal');
        (Object.keys(rateTot) as (keyof typeof rateTot)[]).forEach((k) => { rateTot[k] = r2(rateTot[k] + g.total[k]); });
      }
      rows.push(line(title, rate, '', `Rate ${rate} total`, '', rateTot)); kinds.push('subtotal');
      summaryRows.push(line(title, rate, '', '', '', rateTot).filter((_, i) => i !== 2 && i !== 3 && i !== 4)); summaryKinds.push('data');
      (Object.keys(tableTot) as (keyof typeof tableTot)[]).forEach((k) => { tableTot[k] = r2(tableTot[k] + rateTot[k]); });
    }
    rows.push(line(title, '', '', 'TOTAL', '', tableTot)); kinds.push('total');
    summaryRows.push(line(title, 'TOTAL', '', '', '', tableTot).filter((_, i) => i !== 2 && i !== 3 && i !== 4)); summaryKinds.push('total');
  });

  const summary: ReportSheet = {
    name: 'Rate summary',
    title: 'Rate summary — per table',
    headers: ['Table', 'Rate', 'Documents', 'Consideration', 'Non-GST (land)', 'Taxable value', 'CGST', 'SGST', 'Total tax'],
    rows: summaryRows,
    rowKinds: summaryKinds,
    columnWidths: [52, 10, 11, 16, 15, 16, 13, 13, 14],
    notes: ['Table 8 (Non-GST, the 1/3rd land value) is the Non-GST column of Table 7 / 3.1(a).'],
  };
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return {
    title: 'Builder returns — unit-wise',
    subtitle: [
      `Client: ${params.clientName}`, params.gstin ? `GSTIN: ${params.gstin}` : '',
      `Period: ${params.periodLabel}`, `Project: ${params.projectLabel}`, `${params.blockLabel}: ${params.blockFilter}`,
    ].filter(Boolean).join(' · '),
    headers,
    rows,
    rowKinds: kinds,
    columnWidths: [40, 8, 8, 22, 14, 10, 16, 15, 16, 13, 13, 14],
    freezeColumns: 4,
    sheetName: 'Unit-wise',
    fileNameBase: `Builder_Returns_Unitwise_${safe(params.clientName)}_${safe(params.periodLabel)}`,
    extraSheets: [summary],
  };
}
