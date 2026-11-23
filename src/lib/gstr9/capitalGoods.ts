// Capital goods sold — s.18(6) CGST Act, Rule 40(2) and Rule 44(6).
//
// On the supply of capital goods (or plant and machinery) on which ITC was
// taken, the registered person pays the HIGHER of
//   (a) the tax on the transaction value (s.15), and
//   (b) the ITC taken, reduced by 5 percentage points for every quarter or
//       part thereof from the date of the purchase invoice (quarters.ts).
// Where (b) is higher, the difference (the "shortfall") is paid as well; the
// working reports it as an ITC reversal (GSTR-9 Table 7H) unless the client
// paid it as extra output tax on the invoice (then it is in Table 4).
//
// Not under s.18(6), tax on the transaction value only:
//   * ITC not taken (blocked u/s 17(5), or never availed);
//   * the proviso: refractory bricks, moulds and dies, jigs and fixtures
//     supplied as scrap.
// Assets written off, lost or destroyed (s.17(5)(h)) are recorded but not
// computed here.
//
// Positions (docs/GSTR9_9C_WORKINGS.md §6, items 34–38), the firm, 23 Nov 2026:
//   * "Higher of" is compared on the total; the shortfall is split over the
//     heads of the reduced ITC in proportion (Rule 44(6) works the ITC per
//     head, but the sale is often in other heads: IGST bought, CGST + SGST sold).
//   * ITC taken is the credit actually availed, before any Rule 42/43
//     reversal already made; the figure after Rule 43 reversals to date is
//     shown alongside.
//   * Credit carried in through TRAN-1 counts as ITC taken, dated from the
//     original invoice.
//
// The register itself (capital_goods_register) is client-level and shared
// with Rule 43; this file is pure and has no runtime imports.

import { quartersOrPart, remainingShare, POINTS_PER_QUARTER } from './quarters.ts';
import type { Tax } from './types';

export type ItcRoute = 'normal' | 'tran1' | 'not_taken';
export type DisposalType = 'sale' | 'transfer' | 'scrap' | 'written_off';
/** How the year dealt with the shortfall, which decides where it is reported. */
export type ShortfallRoute = 'reversed_4b2' | 'drc03' | 'output_tax' | 'not_done';
/** Rule 43 use class (read by the Rule 42/43 working). */
export type UseClass = 'taxable' | 'exempt_or_non_business' | 'common';
export type BuyerType = 'b2b' | 'b2c';

/** One asset of the client's capital goods register (camelCase of capital_goods_register). */
export interface CapitalGoodsAsset {
  id: string;
  description: string;
  hsn: string;
  invoiceNo: string;
  /** "YYYY-MM-DD" */
  invoiceDate: string | null;
  supplierGstin: string;
  putToUseDate: string | null;
  useClass: UseClass;
  /** ITC taken on the asset, per head. */
  itc: Tax;
  itcRoute: ItcRoute;
  /** Rule 43 reversals made on the asset to date, per head (shown; the s.18(6) basis is the ITC taken). */
  rule43Reversed: Tax;
  disposalType: DisposalType | null;
  disposalDate: string | null;
  disposalInvoiceNo: string;
  buyerType: BuyerType;
  supplyType: 'intra' | 'inter';
  /** Rate in percent (18 = 18%). */
  rate: number | null;
  disposalValue: number;
  /** Output tax charged per head; null = computed from the rate. */
  outTax: Tax | null;
  scrapProviso: boolean;
  /** Related or distinct person: value at open market value (Rule 28). */
  relatedParty: boolean;
  /** The sale is already in a Sales (PL-OUTPUT Part A) ledger. */
  inSalesLedger: boolean;
  shortfallRoute: ShortfallRoute;
  /** The shortfall is posted to the books' ITC ledger (else the ITC reco shows it as a reconciling item). */
  postedInBooks: boolean;
  note: string;
  /**
   * Changes of use (capital_goods_use_history), each class from its date on.
   * Before the first entry the asset is in the first entry's class; empty =
   * `useClass` throughout. Read by the Rule 43 working.
   */
  useHistory?: UseChange[];
}

export interface UseChange {
  /** "YYYY-MM-DD" */
  fromDate: string;
  useClass: UseClass;
}

export type CgBasis = 'sec18_6' | 'tv_no_itc' | 'tv_scrap' | 'written_off' | 'not_disposed';

export interface CgSaleCalc {
  id: string;
  basis: CgBasis;
  quarters: number | null;
  /** Percentage points taken off (5 × quarters, at most 100). */
  reductionPct: number | null;
  /** ITC taken (the s.18(6) basis). */
  itcTaken: Tax;
  /** ITC taken less Rule 43 reversals to date (for information). */
  itcAfterR43: Tax;
  /** (b) ITC as reduced, per head. */
  reduced: Tax;
  /** (a) tax on the transaction value, per head. */
  outTax: Tax;
  outTaxComputed: boolean;
  /** Which is higher: 'itc' (b), 'tv' (a), or equal. */
  higher: 'itc' | 'tv' | 'equal' | null;
  /** The amount payable u/s 18(6): the higher of (a) and (b), total. */
  payable: number;
  /** (b) − (a) when (b) is higher, split by the heads of (b); else nil. */
  shortfall: Tax;
  /** Rows that cannot be computed as typed (they need completing). */
  issues: string[];
  /** Plain-words notes (why tax on value only, out of scope …). */
  notes: string[];
}

const ZERO: Tax = Object.freeze({ i: 0, c: 0, s: 0, x: 0 }) as Tax;
const HEADS: Array<keyof Tax> = ['i', 'c', 's', 'x'];
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
const tax = (i = 0, c = 0, s = 0, x = 0): Tax => ({ i, c, s, x });
const sumT = (t: Tax): number => t.i + t.c + t.s + t.x;
const addT = (...xs: Tax[]): Tax => xs.reduce((a, b) => tax(a.i + b.i, a.c + b.c, a.s + b.s, a.x + b.x), tax());
const cleanT = (t: Partial<Tax> | null | undefined): Tax => tax(n(t?.i), n(t?.c), n(t?.s ?? t?.c), n(t?.x));

/** "2025-09-10" → "2025-26"; null when the date cannot be read. */
export const fyOfDate = (d: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(d ?? ''));
  if (!m) return null;
  const y = Number(m[1]) - (Number(m[2]) < 4 ? 1 : 0);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

/** Disposed of in the working's financial year ("2025-26"). */
export const disposedInFy = (a: Pick<CapitalGoodsAsset, 'disposalType' | 'disposalDate'>, fy: string): boolean =>
  !!a.disposalType && fyOfDate(a.disposalDate) === fy;

/** Tax on the transaction value from the rate: IGST inter-State, CGST + SGST (half each) intra-State. */
export const taxFromRate = (value: number, rate: number | null, supply: 'intra' | 'inter'): Tax | null => {
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return null;
  const t = (n(value) * n(rate)) / 100;
  return supply === 'inter' ? tax(round2(t)) : tax(0, round2(t / 2), round2(t / 2));
};

/** Split `total` over the heads of `weights` in proportion, to the paisa; the rounding remainder goes to the largest head. */
export const splitByHeads = (total: number, weights: Tax): Tax => {
  const w = sumT(weights);
  if (total <= 0 || w <= 0) return tax();
  const out = tax();
  HEADS.forEach((h) => { out[h] = round2((total * Math.max(0, weights[h])) / w); });
  const diff = round2(total - sumT(out));
  if (Math.abs(diff) >= 0.005) {
    const big = HEADS.reduce((a, b) => (weights[b] > weights[a] ? b : a), 'i' as keyof Tax);
    out[big] = round2(out[big] + diff);
  }
  return out;
};

/** The s.18(6) computation for one asset. */
export function computeCgSale(a: CapitalGoodsAsset): CgSaleCalc {
  const itcTaken = cleanT(a.itc);
  const r43 = cleanT(a.rule43Reversed);
  const itcAfterR43 = tax(...HEADS.map((h) => Math.max(0, itcTaken[h] - r43[h])) as [number, number, number, number]);
  const issues: string[] = [];
  const notes: string[] = [];
  const typedOut = a.outTax ? cleanT(a.outTax) : null;
  const fromRate = taxFromRate(n(a.disposalValue), a.rate, a.supplyType);
  const outTax = typedOut ?? fromRate ?? tax();
  const base: CgSaleCalc = {
    id: a.id, basis: 'not_disposed', quarters: null, reductionPct: null, itcTaken, itcAfterR43,
    reduced: tax(), outTax, outTaxComputed: !typedOut, higher: null, payable: 0, shortfall: tax(), issues, notes,
  };
  if (!a.disposalType) return base;
  if (a.disposalType === 'written_off') {
    notes.push('Written off, lost or destroyed: ITC is reversed u/s 17(5)(h); not computed in this working.');
    return { ...base, basis: 'written_off', outTax: tax() };
  }
  if (!a.disposalDate) issues.push('Date of sale missing');
  if (n(a.disposalValue) < 0) issues.push('Sale value is negative');
  if (!typedOut && !fromRate && n(a.disposalValue) > 0) issues.push('Rate missing (or type the output tax)');
  if (a.relatedParty) notes.push('Related or distinct person: value at open market value (s.15, Rule 28).');

  const tvTotal = sumT(outTax);
  if (a.itcRoute === 'not_taken') {
    notes.push('No ITC taken on the asset: s.18(6) does not apply, tax on the transaction value only.');
    return { ...base, basis: 'tv_no_itc', higher: 'tv', payable: round2(tvTotal) };
  }
  if (a.scrapProviso) {
    notes.push('Proviso to s.18(6): refractory bricks, moulds and dies, jigs and fixtures supplied as scrap pay tax on the transaction value only.');
    return { ...base, basis: 'tv_scrap', higher: 'tv', payable: round2(tvTotal) };
  }
  if (!a.invoiceDate) issues.push('Purchase invoice date missing');
  if (sumT(itcTaken) <= 0) issues.push('ITC taken is nil: choose "ITC not taken" if none was availed');
  const quarters = quartersOrPart(a.invoiceDate, a.disposalDate);
  if (a.invoiceDate && a.disposalDate && quarters === null) issues.push('Sale is dated before the purchase invoice');
  if (a.itcRoute === 'tran1') notes.push('Credit carried in through TRAN-1: counted as ITC taken, from the original invoice date.');
  if (quarters === null) return { ...base, basis: 'sec18_6' };

  const share = remainingShare(quarters);
  const reduced = tax(...HEADS.map((h) => round2(itcTaken[h] * share)) as [number, number, number, number]);
  const itcTotal = sumT(reduced);
  const higher: CgSaleCalc['higher'] = Math.abs(itcTotal - tvTotal) < 0.005 ? 'equal' : itcTotal > tvTotal ? 'itc' : 'tv';
  const gap = round2(itcTotal - tvTotal);
  return {
    ...base,
    basis: 'sec18_6',
    quarters,
    reductionPct: Math.min(100, POINTS_PER_QUARTER * quarters),
    reduced,
    higher,
    payable: round2(Math.max(itcTotal, tvTotal)),
    shortfall: gap > 0 ? splitByHeads(gap, reduced) : tax(),
  };
}

/** One bucket of Table 4 (value + tax). */
export interface CgValTax extends Tax { t: number }

/** What the year's sales of capital goods add to the working (engine.ts). */
export interface CgYearSummary {
  /** Assets disposed of in the FY, as typed, and their computations. */
  assets: CapitalGoodsAsset[];
  calc: Record<string, CgSaleCalc>;
  /** Sales not in a Sales ledger: value and tax added to Table 4 (4B registered, 4A unregistered), by rate. */
  table4: Record<BuyerType, CgValTax>;
  byRate: Record<string, CgValTax>;
  /** Σ sale value not in a Sales ledger (Annexure-1, GSTR-9C 5O). */
  valueOutsidePl: number;
  /** Output tax on those sales, as booked (the Duties & Taxes output ledger carries it, the P&L does not). */
  outTaxOutsidePl: Tax;
  /** Shortfall reported as an ITC reversal (GSTR-9 Table 7H): every route but extra output tax. */
  reversal: Tax;
  /** Shortfall not yet dealt with in the year: an input-side payable. */
  notDone: Tax;
  /** Shortfall reversed in GSTR-3B 4(B)(2) during the year. */
  reversed3b: Tax;
  /** Shortfall paid by DRC-03 during the year. */
  drc03: Tax;
  /** Shortfall paid as extra output tax on the invoice (in Table 4, not 7H). */
  asOutputTax: Tax;
  /** Shortfall in 7H not posted to the books' ITC ledger: the ITC reco's reconciling item. */
  notInBooks: Tax;
  /** Total payable u/s 18(6) (the higher of, summed). */
  payable: number;
  /** Assets that need completing. */
  incomplete: number;
}

const zeroVT = (): CgValTax => ({ t: 0, i: 0, c: 0, s: 0, x: 0 });
const addVT = (a: CgValTax, t: number, x: Tax): CgValTax => ({ t: a.t + t, i: a.i + x.i, c: a.c + x.c, s: a.s + x.s, x: a.x + x.x });

/** Rate key as the 9C Table 9 rows read it (engine.ts byRate: "18", "5" …). */
const rateKey = (r: number | null): string => (r === null || r === undefined ? 'unknown' : String(n(r)));

export function summariseCgYear(all: CapitalGoodsAsset[], fy: string): CgYearSummary {
  const assets = all.filter((a) => disposedInFy(a, fy));
  const calc: Record<string, CgSaleCalc> = {};
  const s: CgYearSummary = {
    assets, calc, table4: { b2b: zeroVT(), b2c: zeroVT() }, byRate: {}, valueOutsidePl: 0, outTaxOutsidePl: tax(),
    reversal: tax(), notDone: tax(), reversed3b: tax(), drc03: tax(), asOutputTax: tax(), notInBooks: tax(), payable: 0, incomplete: 0,
  };
  assets.forEach((a) => {
    const c = computeCgSale(a);
    calc[a.id] = c;
    if (c.issues.length) s.incomplete += 1;
    if (c.basis === 'written_off') return;
    s.payable += c.payable;
    const extraOut = a.shortfallRoute === 'output_tax' ? c.shortfall : ZERO;
    if (!a.inSalesLedger) {
      const t = addT(c.outTax, extraOut);
      const v = n(a.disposalValue);
      const bucket: BuyerType = a.buyerType === 'b2c' ? 'b2c' : 'b2b';
      s.table4[bucket] = addVT(s.table4[bucket], v, t);
      const k = rateKey(a.rate);
      s.byRate[k] = addVT(s.byRate[k] ?? zeroVT(), v, t);
      s.valueOutsidePl += v;
      s.outTaxOutsidePl = addT(s.outTaxOutsidePl, t);
    }
    switch (a.shortfallRoute) {
      case 'output_tax': s.asOutputTax = addT(s.asOutputTax, c.shortfall); return;
      case 'reversed_4b2': s.reversed3b = addT(s.reversed3b, c.shortfall); break;
      case 'drc03': s.drc03 = addT(s.drc03, c.shortfall); break;
      default: s.notDone = addT(s.notDone, c.shortfall);
    }
    s.reversal = addT(s.reversal, c.shortfall);
    if (!a.postedInBooks) s.notInBooks = addT(s.notInBooks, c.shortfall);
  });
  s.payable = round2(s.payable);
  return s;
}

export const DISPOSAL_LABEL: Record<DisposalType, string> = {
  sale: 'Sale', transfer: 'Transfer (distinct person)', scrap: 'Sold as scrap', written_off: 'Written off / lost',
};
export const ITC_ROUTE_LABEL: Record<ItcRoute, string> = { normal: 'ITC taken', tran1: 'TRAN-1 credit', not_taken: 'ITC not taken / blocked' };
export const SHORTFALL_ROUTE_LABEL: Record<ShortfallRoute, string> = {
  reversed_4b2: 'Reversed in GSTR-3B 4(B)(2)',
  drc03: 'Paid by DRC-03',
  output_tax: 'Paid as output tax on the invoice',
  not_done: 'Not yet done',
};
export const BASIS_LABEL: Record<CgBasis, string> = {
  sec18_6: 's.18(6): higher of reduced ITC and tax on value',
  tv_no_itc: 'Tax on value only (no ITC taken)',
  tv_scrap: 'Tax on value only (scrap proviso)',
  written_off: 'Written off (s.17(5)(h), not computed)',
  not_disposed: 'In use',
};

/** A blank asset for the grid. */
export const newCgAsset = (id: string): CapitalGoodsAsset => ({
  id, description: '', hsn: '', invoiceNo: '', invoiceDate: null, supplierGstin: '', putToUseDate: null, useClass: 'taxable',
  itc: tax(), itcRoute: 'normal', rule43Reversed: tax(),
  disposalType: 'sale', disposalDate: null, disposalInvoiceNo: '', buyerType: 'b2b', supplyType: 'intra', rate: 18, disposalValue: 0,
  outTax: null, scrapProviso: false, relatedParty: false, inSalesLedger: false, shortfallRoute: 'not_done', postedInBooks: false, note: '', useHistory: [],
});
