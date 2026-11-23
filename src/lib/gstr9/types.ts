// Annual Return (GSTR-9 / GSTR-9C) workings — the stored shape of every
// sheet, one JSON document per (client, financial year, doc key) in
// annual_return_docs. Each doc mirrors one sheet of the firm's
// MASTER_PMS.xlsx working (see docs/GSTR9_9C_WORKINGS.md) and holds ONLY
// what staff type or what was fetched from the GST portal. Everything the
// Excel computes with a formula is computed by engine.ts, never stored.
//
// Hard rule (firm, 28 Sep 2026): nothing here is ever filled from the app's
// own GSTR-1 / GSTR-3B modules (gstr1_data, the GSTR-3B prep page). Portal
// figures come only from the portal itself — the GSTR-9 system-computed
// JSON and the as-filed GSTR-3B pulled by the browser extension — or are
// typed by staff.

/** Tax heads, in the order the Excel uses them: IGST, CGST, SGST, Cess. */
import type { BuilderAdvanceDoc } from './builderAdvances';

export interface Tax {
  i: number;
  c: number;
  s: number;
  x: number;
}

/** Taxable value + tax. */
export interface ValTax extends Tax {
  t: number;
}

/**
 * Tax as typed in a grid. SGST is `null` while it mirrors CGST (the Excel's
 * `=F` / `=+F` cells) — typing a value into SGST breaks the mirror, clearing
 * it restores the mirror.
 */
export interface TaxIn {
  i: number;
  c: number;
  s: number | null;
  x: number;
  /** Expressions typed into this cell group, keyed by head ("i", "c", "s", "x"). */
  f?: Formulas;
}

export const FY_MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'] as const;
export type MonthKey = (typeof FY_MONTHS)[number];

/** Original "=a+b" expressions staff typed, keyed by field name — shown back on edit, like Excel. */
export type Formulas = Record<string, string>;

import type { CapitalGoodsAsset } from './capitalGoods';

// ---------------------------------------------------------------------------
// Step: Sales (PL-OUTPUT)
// ---------------------------------------------------------------------------

/**
 * GSTR-9 Table 4 bucket a taxable ledger belongs to (books side of GSTR 9-OUTPUT).
 * `at` is 4F (advances on which tax is paid, invoice not issued): a negative
 * `at` row is an advance adjusted and nets 4F, it is not a credit note.
 * `ecom` is 4G1 (an e-commerce operator's own u/s 9(5) supplies), `dr_nt` 4J.
 */
export type OutwardCategory = 'b2b' | 'b2c' | 'exp_wp' | 'sez_wp' | 'deemed' | 'at' | 'ecom' | 'dr_nt';

export type SupplyType = 'intra' | 'inter';

/** PL-OUTPUT Part A — taxable income. Credit notes are separate rows with negative values (sheet note B35), except in 4F (advances adjusted). */
export interface SalesRow {
  id: string;
  ledger: string;
  category: OutwardCategory;
  supplyType: SupplyType;
  /** Rate in percent (18 = 18%). null = not chosen; the implied rate is still shown. */
  rate: number | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number | null;
  cess: number;
  f?: Formulas;
}

/**
 * PL-OUTPUT Part B — non-taxable income, with the Excel's BIFURCATION column
 * widened to every Table 5 bucket. `not_in_gstr9` is income that is part of
 * the audit-report total but is not a supply reportable in Table 5.
 */
export type NonTaxNature =
  | 'export_wo' // 5A zero rated (export) without payment of tax
  | 'sez_wo' // 5B supply to SEZ without payment of tax
  | 'rcm_outward' // 5C tax payable by recipient on reverse charge
  | 'ecom_95' // 5C1 tax payable by e-commerce operator u/s 9(5)
  | 'exempt' // 5D
  | 'nil' // 5E
  | 'non_gst' // 5F non-GST / no supply
  | 'not_in_gstr9';

export interface NonTaxRow {
  id: string;
  ledger: string;
  nature: NonTaxNature;
  amount: number;
  /** Rule 42/43 class of the ledger (E and F); null/undefined = the default for its nature (R42_CLASS_DEFAULT). */
  r42?: R42Class | null;
  /** Value counted for Rule 42 when it differs from the ledger (land at stamp duty value, securities at 1%); null = the amount. */
  r42Value?: number | null;
  f?: Formulas;
}

/**
 * How a non-taxable ledger counts in Rule 42/43's E (exempt supplies) and F (total turnover in the State),
 * per s.17(3) and its Explanation and the Explanations to Rules 42 and 43 (src/lib/gstr9/rule42.ts).
 */
export type R42Class =
  | 'taxable' // F only (e.g. supplies taxed through an e-commerce operator u/s 9(5))
  | 'zero_rated' // F only: exports and SEZ supplies stay out of E
  | 'exempt' // E and F
  | 'nil' // E and F
  | 'non_taxable' // E and F (alcoholic liquor for human consumption, petroleum products, …)
  | 'rcm_outward' // E and F: tax paid by the recipient on reverse charge
  | 'sch3_para5' // E and F: sale of land, or of a building after completion (Schedule III para 5)
  | 'securities' // E and F, at 1% of the value
  | 'excluded_e' // F only: interest on deposits, loans and advances (not a bank or NBFC), Entry 84 / 92A
  | 'not_turnover'; // neither: other Schedule III activities, income that is not a supply

/** Rule 42 class a ledger starts with, from its Table 5 nature. */
export const R42_CLASS_DEFAULT: Record<NonTaxNature, R42Class> = {
  export_wo: 'zero_rated',
  sez_wo: 'zero_rated',
  rcm_outward: 'rcm_outward',
  ecom_95: 'taxable',
  exempt: 'exempt',
  nil: 'nil',
  non_gst: 'non_taxable',
  not_in_gstr9: 'not_turnover',
};

/** Where an input's credit stands for Rule 42 (T1 to T4 of rule 42(1)); common is the default. */
export type CreditUse = 'common' | 't1' | 't2' | 't3' | 't4';

export interface SalesDoc {
  partA: SalesRow[];
  partB: NonTaxRow[];
  /** PL-OUTPUT D54 "AS PER REPORT" — total income as per the audit report. */
  auditReportTotal: number | null;
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Step: Purchases & ITC (PL-INPUT)
// ---------------------------------------------------------------------------

export type InputSection = 'purchase' | 'expense' | 'capital_goods';

/** GSTR-9C Table 14 expense heads (the firm's "GSTR 9C" sheet, rows A..Q). P is RCM, computed. */
export type ExpenseHead =
  | 'purchases' // A
  | 'freight' // B
  | 'power_fuel' // C
  | 'imported_goods' // D (also GSTR-9 6E)
  | 'rent_insurance' // E
  | 'goods_lost' // F
  | 'royalty' // G
  | 'employees_cost' // H
  | 'conveyance' // I
  | 'bank_charges' // J
  | 'entertainment' // K
  | 'stationery' // L
  | 'repair_maintenance' // M
  | 'other_misc' // N
  | 'capital_goods' // O
  | 'other2'; // Q "Any other expense 2" (plus the balancing figure)

export interface PurchaseRow {
  id: string;
  section: InputSection;
  ledger: string;
  supplyType: SupplyType;
  rate: number | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number | null;
  cess: number;
  /** null = default for the section: purchase → purchases, capital_goods → capital_goods, expense → other2. */
  head: ExpenseHead | null;
  /** Rule 42 credit use (T1 non-business, T2 exempt only, T3 blocked, T4 taxable only); null/undefined = common. */
  use?: CreditUse | null;
  f?: Formulas;
}

export interface PurchasesDoc {
  rows: PurchaseRow[];
  /** PL-INPUT row 75 "SUSPENDED ITC AS PER DUTIES & TAXES (OTHER ADJ)". */
  suspendedOtherAdj: TaxIn;
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Step: Duties & Taxes (monthly ledgers)
// ---------------------------------------------------------------------------

/** "OTHER ADJUSTMENTS IN CR/DR SIDE" — a free list, as long as staff need. */
export interface AdjustmentRow {
  id: string;
  month: MonthKey | null;
  i: number;
  c: number;
  s: number | null;
  x: number;
  reason: string;
  f?: Formulas;
}

/**
 * One rate line of a month's optional rate-wise breakup (Duties & Taxes).
 * When a month's group (sales, credit note, purchase, debit note) holds lines,
 * the group's figure is their sum (rollUpRateLines), written into the group's
 * TaxIn on every change, so the engine and every export read the same figures
 * whether the month was entered rate-wise or as one books figure.
 */
export interface DtRateLine {
  id: string;
  /** GST rate in percent (18 = 18%); null while not chosen. */
  rate: number | null;
  supplyType: SupplyType;
  taxable: number;
  igst: number;
  cgst: number;
  /** Always mirrors CGST (null), as everywhere in the Annual Return workings. */
  sgst: number | null;
  cess: number;
  /** Expressions typed into this line ("taxable", "rate", "tax.c" …). */
  f?: Formulas;
}

/** The rate-wise breakup of a month's typed groups; a group without lines is entered directly. */
export type DtRateWise<K extends string> = Partial<Record<K, DtRateLine[]>>;

export interface DtoMonth {
  sales: TaxIn;
  creditNote: TaxIn;
  /** Optional rate-wise breakup of Sales / Credit note (the group figure is its sum). */
  rateWise?: DtRateWise<'sales' | 'creditNote'>;
  f?: Formulas;
}

/** DUTIES & TAXES-OUTPUT. The "AS PER 3B" columns live in PortalDoc.months[m].outTax. */
export interface DutiesOutputDoc {
  months: Record<MonthKey, DtoMonth>;
  adjustments: AdjustmentRow[];
}

export interface DtiMonth {
  purchase: TaxIn;
  debitNote: TaxIn;
  suspRev: TaxIn;
  suspRev180: TaxIn;
  suspReclaim: TaxIn;
  suspReclaim180: TaxIn;
  /** Optional rate-wise breakup of Purchase / Debit note (the group figure is its sum). */
  rateWise?: DtRateWise<'purchase' | 'debitNote'>;
  f?: Formulas;
}

/** DUTIES & TAXES-INPUT (excluding RCM). "AS PER 3B" lives in PortalDoc.months[m].itcExclRcm. */
export interface DutiesInputDoc {
  /** Row 9 "LAST YEAR EFFECT" — ITC of the previous FY booked/claimed in this FY (net). */
  lastYearEffect: TaxIn;
  months: Record<MonthKey, DtiMonth>;
  adjustments: AdjustmentRow[];
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Step: RCM (Part B — books; Part A lives in PortalDoc.months[m].rcm)
// ---------------------------------------------------------------------------

/**
 * Where a category's RCM ITC is reported in GSTR-9 Table 6. The Excel puts everything in 6C input services.
 * `none` = tax paid on reverse charge but no ITC (s.17(5), or used for exempt supplies): it stays in the
 * liability (4G, Annexure-1, 9C Table 9) and out of every ITC figure.
 */
export type RcmItcTable = '6C' | '6D' | '6F' | 'none';

/** What an RCM category's ITC is in 6C / 6D: inputs, capital goods or input services (the default). 6F is services. */
export type RcmItcType = 'ip' | 'cg' | 'is';

export interface RcmCell {
  taxable: number;
  /** null/undefined = computed from the category rate (the Excel's `=D52*2.5%`). */
  i?: number | null;
  c?: number | null;
  s?: number | null;
  x?: number | null;
  f?: Formulas;
}

export interface RcmCategory {
  id: string;
  name: string;
  /** Total rate in percent (5 = 2.5% CGST + 2.5% SGST when intra-state). */
  rate: number;
  supplyType: SupplyType;
  itcTable: RcmItcTable;
  /** 6C / 6D column; undefined = input services, as the sheet. */
  itcType?: RcmItcType;
  /** Rule 42 credit use of the category's ITC; null/undefined = common. */
  use?: CreditUse | null;
  months: Record<MonthKey, RcmCell>;
}

export interface RcmDoc {
  categories: RcmCategory[];
}

// ---------------------------------------------------------------------------
// Portal data — GSTR-9 system-computed + as-filed GSTR-3B (per month)
// ---------------------------------------------------------------------------

export type T4Key = 'b2c' | 'b2b' | 'exp' | 'sez' | 'deemed' | 'at' | 'rchrg' | 'ecom' | 'cr_nt' | 'dr_nt' | 'amd_pos' | 'amd_neg';
export const T4_KEYS: T4Key[] = ['b2c', 'b2b', 'exp', 'sez', 'deemed', 'at', 'rchrg', 'ecom', 'cr_nt', 'dr_nt', 'amd_pos', 'amd_neg'];

export type T5Key = 'zero_rtd' | 'sez' | 'rchrg' | 'ecom_14' | 'exmt' | 'nil' | 'non_gst' | 'cr_nt' | 'dr_nt' | 'amd_pos' | 'amd_neg';
export const T5_KEYS: T5Key[] = ['zero_rtd', 'sez', 'rchrg', 'ecom_14', 'exmt', 'nil', 'non_gst', 'cr_nt', 'dr_nt', 'amd_pos', 'amd_neg'];

export type Table9Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export const TABLE9_HEADS: Table9Head[] = ['igst', 'cgst', 'sgst', 'cess'];

export interface Table9TaxRow {
  payable: number;
  cash: number;
  itcI: number;
  itcC: number;
  itcS: number;
  itcX: number;
}

export interface Table9OtherRow {
  payable: number;
  cash: number;
}

export interface PortalTable9 {
  igst: Table9TaxRow;
  cgst: Table9TaxRow;
  sgst: Table9TaxRow;
  cess: Table9TaxRow;
  interest: Table9OtherRow;
  lateFee: Table9OtherRow;
  penalty: Table9OtherRow;
  other: Table9OtherRow;
}

export interface PortalGstr9 {
  /** Table 4 as auto-populated by the portal (GSTR 9-OUTPUT column B). */
  table4: Record<T4Key, ValTax>;
  /** Table 5 as auto-populated (taxable value only) — a cross-check against books Part B. */
  table5: Record<T5Key, number>;
  /** 6A — ITC availed through GSTR-3B. */
  t6A: Tax;
  /** 6G — ITC received from ISD (portal-populated). */
  t6G: Tax;
  /** 8A — ITC as per GSTR-2B (GSTR-2A before FY 2023-24). */
  t8A: Tax;
  table9: PortalTable9;
}

/** One month of the as-filed GSTR-3B, reduced to the quantities the working compares. */
export interface PortalMonth {
  /** 3.1(a) + 3.1(b) tax — "AS PER 3B" of DUTIES & TAXES-OUTPUT. */
  outTax: Tax;
  /** 4A(1) + 4A(4) + 4A(5) − 4B(1) − 4B(2) — "AS PER 3B" of DUTIES & TAXES-INPUT (excluding RCM). */
  itcExclRcm: Tax;
  /** 3.1(d) inward supplies liable to reverse charge — RCM Part A. */
  rcm: ValTax;
  /** 4A(5) all other ITC — Notice format "ITC used as per 4A(5)". */
  itc4a5: Tax;
  /** 4B(1) reversal as per Rules 38/42/43 and s.17(5) — default for GSTR-9 7E. */
  itc4b1: Tax;
  /** 4B(2) other reversal — Notice format "Reversed in 4(B)(2)". */
  itc4b2: Tax;
  /** 4D ineligible ITC — Notice format "Ineligible ITC as per 4(D)". */
  itc4d: Tax;
  /** Total 4A (all five rows) — fallback for 6A when the GSTR-9 JSON isn't available. */
  itc4aTotal: Tax;
  /**
   * Outward values of 3.1 — Rule 42's E and F for the month. Absent on months imported before
   * 23 Nov 2026 (re-import to fill it).
   */
  turnover?: PortalTurnover;
}

/** GSTR-3B 3.1 taxable values: (a) taxable, (b) zero rated, (c) nil and exempt, (e) non-GST. */
export interface PortalTurnover {
  taxable: number;
  zero: number;
  nilExempt: number;
  nonGst: number;
}

export type PortalSource = 'extension' | 'upload' | 'as_filed_3b' | 'manual';

export interface PortalMeta {
  source: PortalSource | null;
  fetchedAt?: string | null;
  arn?: string | null;
  filedDate?: string | null;
  status?: string | null;
}

export interface PortalDoc {
  gstr9: PortalGstr9;
  gstr9Meta: PortalMeta;
  months: Record<MonthKey, PortalMonth>;
  monthMeta: Record<MonthKey, PortalMeta>;
  /**
   * Field paths staff typed by hand (e.g. "gstr9.table4.b2b.c", "months.oct.outTax.i").
   * A re-import never silently overwrites these; the preview asks first.
   */
  manual: Record<string, true>;
  /** Expressions typed into portal cells, keyed by field path (e.g. "months.oct.outTax.i"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// GSTR-9 form — the cells the Excel types by hand
// ---------------------------------------------------------------------------

export interface HsnRow {
  id: string;
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  concessional: boolean;
  rate: number | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number | null;
  cess: number;
}

export interface OtherReversalRow {
  id: string;
  description: string;
  i: number;
  c: number;
  s: number | null;
  x: number;
  f?: Formulas;
}

/** One tax period of the Rule 42 working: what staff type over the defaults. Every null = the default. */
export interface Rule42Month {
  /** E, exempt supplies — null = as-filed GSTR-3B 3.1(c) + 3.1(e). */
  e: number | null;
  /** F, total turnover in the State — null = 3.1(a) + (b) + (c) + (e). */
  f: number | null;
  /** T1 to T4 — null = the year's tagged credit spread over the months by their share of T. */
  t1: TaxIn | null;
  t2: TaxIn | null;
  t3: TaxIn | null;
  t4: TaxIn | null;
  /** Capital goods credit inside the month's 4A, left out of T (Rule 43's) — null = spread. */
  cg: TaxIn | null;
  /** The Rule 42 part of the month's 4(B)(1) — what was actually reversed. null = nil. */
  reversed: TaxIn | null;
  /** Rule 88B(3): the credit ledger never fell below the short reversal, so no interest. */
  notUtilised: boolean;
  notUtilisedReason: string;
  /** The Rule 43 part of the month's 4(B)(1) — Te actually reversed. null/absent = nil. */
  reversed43?: TaxIn | null;
}

export interface Rule42Doc {
  /** The working is on: 7C comes from it. Off = 7C as typed in Table 7. */
  enabled: boolean;
  /** D2 (5% of C2 for non-business use) — off unless the client uses common credit partly for non-business. */
  d2: boolean;
  d2Reason: string;
  /** MM/YYYY of the GSTR-3B that carries the annual true-up — null = September after the FY. */
  postingPeriod: string | null;
  /** 7C override (superadmin) — null = the working's final figure. */
  final7C: TaxIn | null;
  /**
   * The turnover method (E ÷ F) of Rules 42 and 43 — absent/true = on. A builder whose credit is all
   * project credit (apportioned by carpet area in the approved Builder ITC Reversal working) turns it off.
   */
  turnover?: boolean;
  /** 7D override (superadmin) — null/absent = the Rule 43 working's Σ Te. */
  final7D?: TaxIn | null;
  months: Record<MonthKey, Rule42Month>;
  note: string;
}

export interface Gstr9ManualDoc {
  /** 6A1 — ITC of a preceding FY availed in this FY (other than reclaim). null = use Last Year Effect. */
  t6A1: TaxIn | null;
  /** 6G override — null = portal 6G. */
  t6G: TaxIn | null;
  t6K: TaxIn;
  t6L: TaxIn;
  t6M: TaxIn;
  t7: {
    r37: TaxIn;
    r37A: TaxIn;
    r38: TaxIn;
    r39: TaxIn;
    r42: TaxIn;
    r43: TaxIn;
    /** 7E s.17(5) — null = as-filed GSTR-3B 4B(1) total. */
    s17_5: TaxIn | null;
    tran1: TaxIn;
    tran2: TaxIn;
    /** Description of the computed 7H1 line (suspended-ITC reversals from Duties & Taxes). */
    otherDesc: string;
    /** Further 7H lines staff add by hand. */
    otherExtra: OtherReversalRow[];
  };
  /** 8C typed (the Table 13 ITC less imports and RCM, which 8C leaves out) — null = Table 13. */
  t8C?: TaxIn | null;
  t8E: TaxIn;
  t8F: TaxIn;
  /** 8G IGST (and cess) paid on imports as per the bills of entry — null = 8H + 8H1 (nothing lapses). */
  t8G: TaxIn | null;
  t8H1: TaxIn;
  /** Table 9 tax payable override per head — null = portal payable (or 4N tax when no portal figure). */
  t9Payable: Record<Table9Head, number | null>;
  t10: ValTax;
  t11: ValTax;
  /** Table 12 — null = computed MAX(7J − books ITC, 0) (GSTR 9-INPUT row 27). */
  t12: TaxIn | null;
  /** Table 13 — typed; the ITC reco suggests MAX(books ITC − 7J, 0) (GSTR 9-INPUT row 28). */
  t13: TaxIn;
  t14: Record<'igst' | 'cgst' | 'sgst' | 'cess' | 'interest', { payable: number; paid: number }>;
  /** Rule 42 working (ITC reco › Rule 42/43). Optional: docs saved before 23 Nov 2026 have none. */
  r42?: Rule42Doc;
  t15: {
    // The form's interest / penalty / late fee columns apply to refunds too; optional for docs saved before 24 Oct 2026.
    refundClaimed: Tax & Partial<Record<'interest' | 'penalty' | 'lateFee' | 'others', number>>;
    refundSanctioned: Tax & Partial<Record<'interest' | 'penalty' | 'lateFee' | 'others', number>>;
    refundRejected: Tax & Partial<Record<'interest' | 'penalty' | 'lateFee' | 'others', number>>;
    refundPending: Tax & Partial<Record<'interest' | 'penalty' | 'lateFee' | 'others', number>>;
    demandTotal: Tax & { interest: number; penalty: number; lateFee: number; others: number };
    demandPaid: Tax & { interest: number; penalty: number; lateFee: number; others: number };
    demandPending: Tax & { interest: number; penalty: number; lateFee: number; others: number };
  };
  t16: {
    compositionSupplies: number;
    deemedSupply: ValTax;
    approvalNotReturned: ValTax;
  };
  t17: HsnRow[];
  t18: HsnRow[];
  /** Table 19 — late fee payable and paid (Central / State). */
  t19: Record<'cgst' | 'sgst', { payable: number; paid: number }>;
  /** 5I/5J/5K books-side debit notes & amendments to Table 5 (rare; default 0). */
  t5Extra: { dr_nt: number; amd_pos: number; amd_neg: number };
  /** 4F advances / 4J–4L on the books side not in a Sales ledger (rare; default 0) — added to the Part A buckets in GSTR 9-OUTPUT. */
  t4BooksExtra: { at: ValTax; dr_nt: ValTax; amd_pos: ValTax; amd_neg: ValTax };
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Annexures 1–4
// ---------------------------------------------------------------------------

export interface AnnexureOtherPayment {
  id: string;
  description: string;
  /** Output tax or input tax credit — how the payable is disclosed (default output). */
  side?: 'output' | 'input';
  i: number;
  c: number;
  s: number | null;
  x: number;
  f?: Formulas;
}

export interface AnnexuresDoc {
  /** Annexure-1 D9 "NET NON-GST INCOME AS PER P/L" — only if it is reported inside Table 4. */
  a1NonGstIncome: number;
  /** Annexure-1 row B "SALE RETURN AS PER P/L" (only if not already netted in PL-OUTPUT). */
  a1SaleReturn: ValTax;
  /** Annexure-3 row 2 "RCM TO BE PAID" — null = suggested MAX(books − portal, 0). */
  a3RcmToPay: TaxIn | null;
  /** Annexure-3 row 3 "EXCESS ITC CLAIMED AS PER RECO" — null = suggested Table 12. */
  a3ExcessItc: TaxIn | null;
  /** Annexure-3 row 4 "ANY OTHER PAYMENT". */
  a3Other: AnnexureOtherPayment[];
  /**
   * Superseded: what is paid now comes only from the set-off register
   * (payables.ts — an imported DRC-03 or a GSTR-3B effect with its copy).
   * Kept so older saved docs still load; not read by the engine.
   */
  a3AlreadyPaid: TaxIn;
  /** Annexure-4 — previous FY's GSTR-9 clauses 8 (8C), 10, 11, 12, 13. */
  a4: Record<'c8' | 'c10' | 'c11' | 'c12' | 'c13', TaxIn>;
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// GSTR-9C (official tables) — manual cells only
// ---------------------------------------------------------------------------

/** Value + tax row of the 9C rate-wise tables (Tables 9, 11 and Part V). */
export type RateWiseRow = ValTax;

// Row keys follow GSTR_9C_Offline_Utility.xlsm v2.8 (verified 27 Aug 2026), unchanged in v2.9 (FY 2025-26, verified 23 Nov 2026).
export const GSTR9C_T5_KEYS = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
export type Gstr9cT5Key = (typeof GSTR9C_T5_KEYS)[number];
/** Table 5 rows that are subtracted to reach P (the rest are added): =A+B+C+D-E+F-G-H-I+J-K-L+M+N+O. */
export const GSTR9C_T5_SUB: Gstr9cT5Key[] = ['E', 'G', 'H', 'I', 'K', 'L'];

export const GSTR9C_T9_RATE_KEYS = ['A', 'B', 'B1', 'C', 'D', 'E', 'F', 'G', 'H', 'H1', 'H2', 'I', 'J', 'K', 'K1', 'K2'] as const;
export type Gstr9cT9RateKey = (typeof GSTR9C_T9_RATE_KEYS)[number];
export const GSTR9C_T9_OTHER_KEYS = ['L', 'M', 'N', 'O'] as const;
export type Gstr9cT9OtherKey = (typeof GSTR9C_T9_OTHER_KEYS)[number];

export const GSTR9C_T11_KEYS = ['A', 'A1', 'B', 'C', 'D', 'D1', 'E', 'F', 'G', 'G1', 'G2', 'H', 'I', 'J', 'K'] as const;
export type Gstr9cT11Key = (typeof GSTR9C_T11_KEYS)[number];

export const GSTR9C_PARTV_KEYS = ['A', 'A1', 'B', 'C', 'D', 'D1', 'E', 'F', 'G', 'G1', 'G2', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
export type Gstr9cPartVKey = (typeof GSTR9C_PARTV_KEYS)[number];

export const GSTR9C_T16_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const; // Central, State/UT, Integrated, Cess, Interest, Penalty
export type Gstr9cT16Key = (typeof GSTR9C_T16_KEYS)[number];


export interface Gstr9cDoc {
  /** 5A override — null = audit report total from the Sales step (PL-OUTPUT D54), else books Part A+B. */
  t5A: number | null;
  /** 5B..5O adjustments, typed as positive amounts; GSTR9C_T5_SUB rows are subtracted. M/N/O may be negative. */
  t5: Record<Gstr9cT5Key, number>;
  /** The capital goods part of 5O (sale value outside the P&L revenue) — null/absent = from the register (Annexure-5). */
  t5OCg?: number | null;
  /** 5Q override — null = GSTR-9 total turnover (5N + 10 − 11). */
  t5Q: number | null;
  /**
   * Builder clients: the customer-advance roll-forward (null = not used). While set it fills
   * 5B, 5C, 5H, 5I, 5J and 5O and the typed values of those rows are not used
   * (src/lib/gstr9/builderAdvances.ts).
   */
  builderAdv?: BuilderAdvanceDoc | null;
  t6Reasons: string;
  /** 7B/7C/7D/7D1 overrides — null = derived from GSTR-9 Table 5. */
  t7: Record<'B' | 'C' | 'D' | 'D1', number | null>;
  /** 7F override — null = GSTR-9 taxable turnover (4N − 4G − 4G1, + 10 − 11). */
  t7F: number | null;
  t8Reasons: string;
  /** Table 9 rate rows — null = derived from books (PL-OUTPUT Part A by rate; RC rows from RCM Part B). */
  t9: Record<Gstr9cT9RateKey, RateWiseRow | null>;
  /** Table 9 L–O (interest, late fee, penalty, others) — typed. */
  t9Other: Record<Gstr9cT9OtherKey, Tax>;
  /** 9Q override — null = GSTR-9 Table 9 tax payable per head. */
  t9Q: Tax | null;
  t10Reasons: string;
  t11: Record<Gstr9cT11Key, RateWiseRow>;
  /** 12A/12B/12C overrides — null = books NET ITC / Last Year Effect / Table 13. */
  t12A: Tax | null;
  t12B: Tax | null;
  t12C: Tax | null;
  t13Reasons: string;
  t15Reasons: string;
  t16: Record<Gstr9cT16Key, number>;
  partV: Record<Gstr9cPartVKey, RateWiseRow>;
  /** Home sheet of the 9C utility: "Name of Act, if you are liable to audit under any Act" (at most 30 characters; JSON `act_name`). */
  actName: string;
  certification: Record<
    | 'place'
    | 'signatory_name'
    | 'membership_no'
    | 'signature_date'
    | 'building_no'
    | 'floor_number'
    | 'premises_name'
    | 'road_street'
    | 'city_town_locality'
    | 'district'
    | 'state'
    | 'pin_code'
    | 'pan',
    string
  >;
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Notice format — the cells the Excel types
// ---------------------------------------------------------------------------

export interface NoticeDoc {
  /** 16B deemed supplies / 16C unreturned goods / 15G pending demands — null = from GSTR-9 Tables 15/16. */
  deemedSupplies: TaxIn | null;
  unreturnedGoods: TaxIn | null;
  pendingDemands: TaxIn | null;
  /** Differential tax paid on amendments related to the previous FY, paid in this FY (previous FY Table 14). */
  prevYearT14: TaxIn;
  /** Previous FY's 8C brought forward — null = Annexure-4 clause 8. */
  prevYear8C: TaxIn | null;
  /** 4(D) ineligible ITC override — null = as-filed GSTR-3B 4D. */
  ineligible4D: TaxIn | null;
  /** Ineligible u/s 16(4) (supplier filed after the cut-off). */
  ineligible164: TaxIn;
  /** 4A(5) / 4B(2) overrides — null = as-filed GSTR-3B. */
  itcUsed4A5: TaxIn | null;
  reversed4B2: TaxIn | null;
  /** Expressions staff typed into this doc's fixed-row grids, keyed by field path (e.g. "t9.E.c"). */
  f?: Formulas;
}

// ---------------------------------------------------------------------------
// Justifications + settings
// ---------------------------------------------------------------------------

export interface Justification {
  text: string;
  /** The difference (per head) the justification was written against — reopens when it moves. */
  diffAt: ValTax;
  by: string | null;
  at: string;
}

export interface JustificationsDoc {
  lines: Record<string, Justification>;
}

export interface SettingsDoc {
  /** Per-head tolerance in rupees below which a difference needs no reason. */
  tolerance: number;
}

// ---------------------------------------------------------------------------
// The full set of docs for one (client, FY)
// ---------------------------------------------------------------------------

export interface AnnualReturnDocs {
  sales: SalesDoc;
  purchases: PurchasesDoc;
  duties_output: DutiesOutputDoc;
  duties_input: DutiesInputDoc;
  rcm: RcmDoc;
  portal: PortalDoc;
  gstr9: Gstr9ManualDoc;
  annexures: AnnexuresDoc;
  gstr9c: Gstr9cDoc;
  notice: NoticeDoc;
  justifications: JustificationsDoc;
  settings: SettingsDoc;
}

export type DocKey = keyof AnnualReturnDocs;

export const DOC_KEYS: DocKey[] = [
  'sales',
  'purchases',
  'duties_output',
  'duties_input',
  'rcm',
  'portal',
  'gstr9',
  'annexures',
  'gstr9c',
  'notice',
  'justifications',
  'settings',
];

export interface WorkspaceContext {
  clientName: string;
  gstin: string;
  financialYear: string;
  /** Builder on the NO_ITC scheme — zero ITC is expected, not a gap. */
  noItcBuilder: boolean;
  /** QRMP client (registration type IFF): GSTR-3B is filed quarterly. */
  quarterly?: boolean;
  /** Live set-offs from the payable register (payables.ts); none when omitted. */
  setOffs?: Array<{ side: 'output' | 'input'; method: 'drc03' | 'gstr3b'; tax: Tax }>;  /**
   * The client's capital goods register (capital_goods_register, all years); the engine takes the
   * assets disposed of in this FY (s.18(6), capitalGoods.ts). None when omitted.
   */
  capitalGoods?: CapitalGoodsAsset[];
  /** Builder clients: the approved Builder ITC Reversal workings (all years); the engine takes those posted in this FY. */
  builderReversals?: import('./builderReversal').BuilderReversalWorking[];
}
