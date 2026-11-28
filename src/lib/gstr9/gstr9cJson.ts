// GSTR-9C portal JSON — the file the government's GSTR-9C offline utility
// (v2.9, 28 Sep 2026, FY 2025-26) writes with "Generate JSON File to upload",
// built straight from the working, with the utility's own validations.
//
// Read docs/GSTR9C_PORTAL_JSON.md before changing anything here. Everything in
// this file was taken from the utility's macros (Export_JSON_Module,
// Validate_Functions, Variable_Initialize, Common_Module) and its Master sheet:
//   - the JSON shape and key names (Write_Table5 … Write_AddLiab);
//   - the rate / expense / liability codes (`desc`, Master!D:Y);
//   - the checks run before a JSON is written (ValidateFunc_*), with the
//     utility's own messages (EM1 … EM18).
// For FY 2020-21 onwards (PARTB_RESTRICTED_FY) the JSON has no `isauditor`, no
// auditor's certificate and no signature: the statement is self-certified.
//
// No tax logic lives here. Every figure is the engine's (`workings.gstr9c`) or
// a typed 9C cell; the totals the utility computes with sheet formulas (5P, 5R,
// 7A, 7E, 7G, 9P, 9R, 12D, 12F, 14R, 14T) are worked out again here from the
// rounded rows, exactly as the utility's formulas do, and must tie to the
// working's own figures (check TIE).

import type { Workings } from './engine';
import type { Gstr9cDoc, RateWiseRow, Tax, ValTax } from './types';

export const GSTR9C_UTILITY_VERSION = '2.9';

/** The utility's Financial Year list (Master!A23:A31). */
export const GSTR9C_UTILITY_FYS = ['2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'] as const;

/** First FY whose layout this builder writes (D1, K-2, G2, the 40% rows: isFY2024OrLater). */
const LAYOUT_FROM = 2024;
/** FYs without Part B (no auditor's certificate, no signature): Variable_Initialize.PARTB_RESTRICTED_FY. */
const SELF_CERTIFIED_FROM = 2020;

// ---------------------------------------------------------------------------
// Utility constants (Variable_Initialize)
// ---------------------------------------------------------------------------

/** GSTIN_REGEX_HOME. */
export const GSTIN_REGEX_UTILITY = /^[0-9]{2}[A-Z]{4}[0-9A-Z]{1}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z1-9A-J]{1}[0-9A-Z]{1}$/;
/**
 * HASH_REGEX, as the utility writes it. `+-_` is a range (0x2B–0x5F), so besides
 * letters, digits and space it lets through ( ) , ' & / and + , - . / 0-9 : ; < = > ? @ A-Z [ \ ] ^ _.
 * Checked on every reason (Tables 6, 8, 10, 13, 15) before a JSON is written.
 */
export const REASON_CHARS_REGEX = /^[a-zA-Z0-9(),'.+-_&/ ]*$/;
const REASON_CHAR = /[a-zA-Z0-9(),'.+-_&/ ]/;
/** char_REGEX: one line, 1–1000 characters. */
const REASON_MAX = 1000;
/** Each reasons sheet has ten rows (Delete_reasons reads start_row … start_row + 9). */
const REASON_ROWS = 10;
/** ANAME_REGEX: the name of the Act, 1–30 characters. */
const ACT_NAME_MAX = 30;
/** Readme: the JSON may be at most 5 MB and 19,000 items. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 19000;

export const EM = {
  EM1: 'Length exceeds 1000 character limit or line break present.',
  EM2: 'Mandatory field cannot be left blank.',
  EM3: 'Invalid GSTIN.',
  EM9: 'Please enter First row before entering values in the subsequent rows.',
  EM12: 'Please select a valid value from the dropdown.',
  EM13: 'Taxable value cannot be left empty when tax columns are present.',
  EM14: 'Value cannot be left empty when Amount of Total ITC or Amount of eligible ITC availed are present.',
  EM18: 'Length exceeds 30 characters.',
  AMT13: 'Amount should not have more than 13 digits',
  AMT2: 'Amount should not have more than 2 decimal places',
  HASH: "Allowed Special Characters are - ( ( ) , ' . + - _ & / = @ ? [ ] ). Please remove any other special characters entered",
} as const;

// ---------------------------------------------------------------------------
// Codes (Master sheet)
// ---------------------------------------------------------------------------

/** Table 9 rate rows → `desc` (Master!D14:E28). 9K2 is written as `oth_ecom`, not a rate row. */
export const T9_DESC: Array<[key: string, desc: string]> = [
  ['A', '5'], ['B', '5RC'], ['B1', '6'], ['C', '12'], ['D', '12RC'], ['E', '18'], ['F', '18RC'], ['G', '28'], ['H', '28RC'],
  ['H1', '40'], ['H2', '40RC'], ['I', '3'], ['J', '0.25'], ['K', '0.10'], ['K1', 'Others'],
];
/** Table 11 rate rows → `desc` (Master!H14:I23); note "0.1" here, "0.10" in Table 9. */
export const T11_DESC: Array<[key: string, desc: string]> = [
  ['A', '5'], ['A1', '6'], ['B', '12'], ['C', '18'], ['D', '28'], ['D1', '40'], ['E', '3'], ['F', '0.25'], ['G', '0.1'], ['G1', 'Others'],
];
/** Part V rows → `desc` (Master!X14:Y32, FY 2025-26 onwards; the same codes as L14:M32 for FY 2024-25). */
export const PARTV_DESC: Array<[key: string, desc: string]> = [
  ['A', '5'], ['A1', '6'], ['B', '12'], ['C', '18'], ['D', '28'], ['D1', '40'], ['E', '3'], ['F', '0.25'], ['G', '0.1'], ['G1', 'Others'],
  ['G2', 'oth_ecom'], ['H', 'INP'], ['I', 'INT'], ['J', 'LAT'], ['K', 'PEN'], ['L', 'ANO'], ['M', 'ERP'], ['N', 'OUD'], ['O', 'OTH'],
];
/**
 * Table 14 rows → `desc` (Master!U14:V39). 14A is the working's A2 (purchases net of suspended
 * ITC); the working's P (RCM) and Q (any other expense 2, with the balancing figure) are the
 * utility's "Any other expense 1" and "Any other expense 2".
 */
export const T14_DESC: Array<[key: string, desc: string]> = [
  ['A2', 'PURCHS'], ['B', 'FRTCAR'], ['C', 'POFUEL'], ['D', 'IMPGDS'], ['E', 'RNTEXP'], ['F', 'GDSLST'], ['G', 'RYLTES'],
  ['H', 'EMPCST'], ['I', 'CONCHR'], ['J', 'BNKCHR'], ['K', 'ENTCHR'], ['L', 'STNEXP'], ['M', 'RPRMNT'], ['N', 'OTRMIS'],
  ['O', 'CAPGDS'], ['P', 'ANEXP1'], ['Q', 'ANEXP2'],
];
const T14_EXTRA = Array.from({ length: 10 }, (_, i) => `ANEXP${i + 1}`);

// ---------------------------------------------------------------------------
// JSON shape (Export_JSON_Module)
// ---------------------------------------------------------------------------

export interface Heads { cgst: number; sgst: number; igst: number; cess: number }
export interface RateItem extends Heads { tax_val: number; desc: string }
export interface Reasons { rsn: Array<{ number: string; desc: string }> }

export interface Gstr9cAuditedData {
  gstin: string;
  fp: string;
  act_name: string;
  table5: Record<
    | 'turnovr' | 'unbil_rev_beg' | 'unadj_adv_end' | 'dmd_sup' | 'crd_nts_issued' | 'trd_dis' | 'turnovr_apr_jun'
    | 'unbil_rev_end' | 'unadj_adv_beg' | 'crd_note_acc' | 'adj_dta' | 'turnovr_comp' | 'adj_turn_sec' | 'adj_turn_fef'
    | 'adj_turn_othrsn' | 'annul_turn_adj' | 'annul_turn_decl' | 'unrec_turnovr',
    number
  >;
  table6?: Reasons;
  table7: Record<'annul_turn_adj' | 'othr_turnovr' | 'zero_sup' | 'rev_sup' | 'rev_sup_ecom' | 'tax_turn_adj' | 'tax_turn_annul' | 'unrec_tax_turn', number>;
  table8?: Reasons;
  table9?: {
    rate?: RateItem[];
    oth_ecom?: Heads;
    inter?: Heads;
    late_fee?: Heads;
    pen?: Heads;
    oth?: Heads;
    tot_amt_payable: Heads;
    tot_amt_paid: Heads;
    unrec_amt: Heads;
  };
  table10?: Reasons;
  table11: { rate: RateItem[]; oth_ecom?: Heads; inter?: Heads; late_fee?: Heads; pen?: Heads; oth?: Heads };
  table12: Record<'itc_avail' | 'itc_book_earl' | 'itc_book_curr' | 'itc_avail_audited' | 'itc_claim' | 'unrec_itc', number>;
  table13?: Reasons;
  table14?: {
    items?: Array<{ val: number; itc_amt: number; itc_avail: number; desc: string }>;
    tot_elig_itc: { itc_avail: number };
    itc_claim: { itc_avail: number };
    unrec_itc: { itc_avail: number };
  };
  table15?: Reasons;
  table16: Record<'cgst' | 'sgst' | 'igst' | 'cess' | 'inter' | 'pen', number>;
  add_liab: { tax_pay?: Array<{ val: number; igst: number; cgst: number; sgst: number; cess: number; desc: string }> };
}

export interface Gstr9cPortalJson {
  gstr9cdata: { audited_data: Gstr9cAuditedData };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export type Gstr9cCheckSeverity = 'error' | 'warning';

export interface Gstr9cCheck {
  severity: Gstr9cCheckSeverity;
  /** The utility's sheet: "Home", "5", "7", "9" … "16", "V". */
  table: string;
  /** Row letter on the form ("5A", "9K1" …), when the check is about one row. */
  row?: string;
  /** EM1 … EM18 (the utility's own message), AMT13 / AMT2 (amount checks), HASH, or one of ours: FY, TIE, REASON, SIZE. */
  rule: string;
  message: string;
}

export interface Gstr9cJsonBuild {
  /** null when a check stops the JSON (an error), as the utility writes no file then. */
  payload: Gstr9cPortalJson | null;
  /** The JSON as it is downloaded (compact, UTF-8). */
  text: string | null;
  fileName: string;
  checks: Gstr9cCheck[];
  errors: number;
  warnings: number;
}

export interface Gstr9cJsonInput {
  gstin: string;
  financialYear: string;
  workings: Workings;
  doc: Gstr9cDoc;
  /** The working's tolerance (₹): a difference above it with no reason is a warning. */
  tolerance?: number;
  today?: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Round half away from zero to paise; −0 becomes 0. */
export const r2 = (v: number): number => {
  const r = (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7)) / 100;
  return r === 0 ? 0 : r;
};
const sum = (...xs: number[]): number => r2(xs.reduce((s, x) => s + x, 0));
const totalOf = (t: Partial<Tax> | null | undefined): number => n0(t?.i) + n0(t?.c) + n0(t?.s) + n0(t?.x);
const fyStart = (fy: string): number => Number(fy.slice(0, 4));

/** "032026" for "2025-26": the utility's `"0320" & Right(FY, 2)`. */
export const gstr9cFp = (financialYear: string): string => `0320${financialYear.slice(-2)}`;

/** The utility's file name: `<GSTIN>_<date>_R9C_Output_JSON.json`. */
export const gstr9cFileName = (gstin: string, today = new Date()): string => {
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  return `${gstin || 'GSTIN'}_${dd}${mm}${today.getFullYear()}_R9C_Output_JSON.json`;
};

/** Each non-blank line of a reasons box is one row of the utility's reasons sheet. */
export const reasonLines = (text: string | null | undefined): string[] =>
  (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Characters of a reason the utility refuses (HASH_REGEX), each once. */
export const badReasonChars = (line: string): string[] => [...new Set([...line].filter((ch) => !REASON_CHAR.test(ch)))];

const REPLACE: Array<[RegExp, string]> = [
  [/₹\s?/g, 'Rs. '],
  [/%/g, ' percent'],
  [/[–—−‐‑]/g, '-'],
  [/[‘’`´]/g, "'"],
  [/[“”"]/g, "'"],
  [/…/g, '...'],
  [/×/g, 'x'],
  [/#/g, 'No.'],
  [/[!|]/g, '.'],
  [/\t/g, ' '],
  [/[*$~{}]/g, ''],
];

/**
 * A reason rewritten in the characters the utility accepts: ₹ → "Rs.", % → "percent",
 * dashes and quotes to their plain forms; anything else outside HASH_REGEX is dropped.
 * Line breaks are kept (each line is a reason).
 */
export function cleanReasonText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      let l = line;
      REPLACE.forEach(([re, to]) => { l = l.replace(re, to); });
      return [...l].filter((ch) => REASON_CHAR.test(ch)).join('').replace(/ {2,}/g, ' ').trim();
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the GSTR-9C JSON for upload on the GST portal ("Prepare offline" →
 * upload), with every check the utility runs before it writes a file. Errors
 * stop the file (payload null), as they stop the utility's "Generate JSON".
 */
export function buildGstr9cPortalJson(input: Gstr9cJsonInput): Gstr9cJsonBuild {
  const { workings, doc } = input;
  const gstin = (input.gstin ?? '').trim().toUpperCase();
  const fy = (input.financialYear ?? '').trim();
  const tol = input.tolerance ?? 0;
  const W = workings.gstr9c;
  const checks: Gstr9cCheck[] = [];
  const err = (table: string, rule: string, message: string, row?: string) => checks.push({ severity: 'error', table, row, rule, message });
  const warn = (table: string, rule: string, message: string, row?: string) => checks.push({ severity: 'warning', table, row, rule, message });

  // ------------------------------------------------------------ Home (ValidateFunc_Home)
  if (!gstin) err('Home', 'EM2', `GSTIN: ${EM.EM2}`);
  else if (!GSTIN_REGEX_UTILITY.test(gstin)) err('Home', 'EM3', `${EM.EM3} "${gstin}" is not a GSTIN the utility accepts.`);
  if (!fy) err('Home', 'EM2', `Financial Year: ${EM.EM2}`);
  else if (!(GSTR9C_UTILITY_FYS as readonly string[]).includes(fy)) err('Home', 'EM12', `Financial Year ${fy}: ${EM.EM12} The utility (v${GSTR9C_UTILITY_VERSION}) offers ${GSTR9C_UTILITY_FYS[0]} to ${GSTR9C_UTILITY_FYS[GSTR9C_UTILITY_FYS.length - 1]}.`);
  else if (fyStart(fy) < LAYOUT_FROM) err('Home', 'FY', `FY ${fy} uses the utility's older layout (no 7D1, 9K-2, 11G2 or 40% rows). Generate its JSON in the offline utility itself; this app writes FY 2024-25 onwards.`);
  const actName = (doc.actName ?? '').trim();
  if (actName.length > ACT_NAME_MAX) err('Home', 'EM18', `Name of Act: ${EM.EM18} (${actName.length} now).`);
  const selfCertified = !fy || fyStart(fy) >= SELF_CERTIFIED_FROM;

  // ------------------------------------------------------------ Amounts (Negative_Amt)
  /** One figure as the utility takes it: at most 13 digits before the point and 2 after; negatives allowed. */
  const amt = (table: string, row: string, raw: number | null | undefined): number => {
    const v = n0(raw);
    if (typeof raw === 'number' && !Number.isFinite(raw)) err(table, 'AMT13', `${row}: Invalid Amount`, row);
    const r = r2(v);
    if (Math.trunc(Math.abs(r)).toString().length > 13) err(table, 'AMT13', `${row}: ${EM.AMT13}.`, row);
    return r;
  };
  const heads = (table: string, row: string, t: Partial<Tax> | null | undefined): Heads => ({
    cgst: amt(table, `${row} Central tax`, t?.c),
    sgst: amt(table, `${row} State/UT tax`, t?.s),
    igst: amt(table, `${row} Integrated tax`, t?.i),
    cess: amt(table, `${row} Cess`, t?.x),
  });
  const anyHead = (h: Heads) => h.cgst !== 0 || h.sgst !== 0 || h.igst !== 0 || h.cess !== 0;
  const addHeads = (...hs: Heads[]): Heads => ({
    cgst: sum(...hs.map((h) => h.cgst)), sgst: sum(...hs.map((h) => h.sgst)), igst: sum(...hs.map((h) => h.igst)), cess: sum(...hs.map((h) => h.cess)),
  });
  const subHeads = (a: Heads, b: Heads): Heads => ({ cgst: r2(a.cgst - b.cgst), sgst: r2(a.sgst - b.sgst), igst: r2(a.igst - b.igst), cess: r2(a.cess - b.cess) });
  /** The head with the largest difference, signed (a reason is asked for when it is above the tolerance). */
  const widest = (h: Heads): number => [h.cgst, h.sgst, h.igst, h.cess].reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0);
  /** A total the utility computes must tie with the working's own figure (both are shown to staff). */
  const tie = (table: string, row: string, mine: number, working: number) => {
    if (Math.abs(mine - r2(working)) > 0.05) warn(table, 'TIE', `${row}: the utility's formula gives ${mine.toFixed(2)} from the rounded rows, the working shows ${r2(working).toFixed(2)}.`, row);
  };
  const tieHeads = (table: string, row: string, mine: Heads, working: Tax) => {
    tie(table, `${row} Central tax`, mine.cgst, working.c);
    tie(table, `${row} State/UT tax`, mine.sgst, working.s);
    tie(table, `${row} Integrated tax`, mine.igst, working.i);
    tie(table, `${row} Cess`, mine.cess, working.x);
  };
  /** EM13: tax typed with no taxable value. The utility stops only on a blank cell; 0 is accepted, so here it is a warning. */
  const em13 = (table: string, row: string, v: number, h: Heads, code = 'EM13') => {
    if (v === 0 && anyHead(h)) warn(table, code, `${row}: ${code === 'EM14' ? EM.EM14 : EM.EM13} The value here is 0; enter the taxable value if there is one.`, row);
  };

  // ------------------------------------------------------------ Reasons (ValidateFunc_Reasons + HashChk*)
  const reasons = (table: string, text: string | null | undefined): Reasons | undefined => {
    const lines = reasonLines(text);
    if (!lines.length) return undefined;
    if (lines.length > REASON_ROWS) err(table, 'EM1', `Table ${table}: the utility takes at most ${REASON_ROWS} reasons (one per line); there are ${lines.length}. Join some lines.`);
    lines.forEach((l, i) => {
      if (l.length > REASON_MAX) err(table, 'EM1', `Table ${table}, reason ${i + 1}: ${EM.EM1} (${l.length} characters).`);
      const bad = badReasonChars(l);
      if (bad.length) err(table, 'HASH', `Table ${table}, reason ${i + 1}: ${EM.HASH} (${bad.map((c) => `"${c}"`).join(' ')}).`);
    });
    return { rsn: lines.slice(0, REASON_ROWS).map((l, i) => ({ number: `RSN${i + 1}`, desc: l.slice(0, REASON_MAX) })) };
  };
  const needsReason = (table: string, line: string, diff: number, text: string | null | undefined) => {
    if (Math.abs(diff) > tol + 1e-9 && !reasonLines(text).length) {
      warn(table, 'REASON', `${line} is ${diff.toFixed(2)} and Table ${table} gives no reason. The utility does not stop on this, but the form asks for the reasons.`);
    }
  };

  // ------------------------------------------------------------ Table 5 (ValidateFunc_Table5)
  const R5 = W.t5.rows;
  const t5v = (k: string) => amt('5', `5${k}`, R5[k]);
  const A5 = t5v('A');
  const v5 = Object.fromEntries(['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].map((k) => [k, t5v(k)])) as Record<string, number>;
  if (selfCertified && v5.G !== 0) err('5', 'EM12', '5G (turnover from April 2017 to June 2017) is closed in the utility for this year; it must be nil.', '5G');
  // P = A+B+C+D-E+F-G-H-I+J-K-L+M+N+O ('PT II (5)'!H21)
  const P5 = sum(A5, v5.B, v5.C, v5.D, -v5.E, v5.F, -v5.G, -v5.H, -v5.I, v5.J, -v5.K, -v5.L, v5.M, v5.N, v5.O);
  const Q5 = amt('5', '5Q', W.t5.Q);
  const R5r = r2(Q5 - P5);
  // The portal checks annul_turn_decl against the GSTR-9 (5N + 10 − 11) and refuses the file on a
  // difference, and unrec_turnovr with it.
  // The working's GSTR-9 is computed from the books; only the GSTR-9 as filed is what the portal holds.
  if (W.g9Tie.missing) {
    err('5', 'G9FILED', 'The GSTR-9 as filed is not entered (Table 5: 5N, 10, 11; Table 9: tax paid in Tables 9 and 14). The portal checks 5Q and 9Q against the filed GSTR-9 to the paisa, and the working\'s GSTR-9 can differ from it. Type them from the filed GSTR-9 summary.', '5Q');
  }
  const g9Turnover = r2(W.g9Tie.turnover);
  if (Math.abs(Q5 - g9Turnover) >= 0.005) {
    err('5', 'G9TIE', `5Q (annual turnover declared, ${Q5.toFixed(2)}) differs from the GSTR-9's 5N + 10 − 11 (${g9Turnover.toFixed(2)}${W.g9Tie.filed.turnover !== null ? ', as filed' : ''}). The portal refuses this: "annual turnover declared (annul_turn_decl) does not match GSTR-9", then "unreconciled turnover (unrec_turnovr) is incorrect". Enter the filed GSTR-9 figures and reset 5Q.`, '5Q');
  }
  tie('5', '5P', P5, W.t5.P);
  tie('5', '5R', R5r, W.t5.R);
  needsReason('6', '5R (un-reconciled turnover)', R5r, doc.t6Reasons);
  const table5: Gstr9cAuditedData['table5'] = {
    turnovr: A5, unbil_rev_beg: v5.B, unadj_adv_end: v5.C, dmd_sup: v5.D, crd_nts_issued: v5.E, trd_dis: v5.F, turnovr_apr_jun: v5.G,
    unbil_rev_end: v5.H, unadj_adv_beg: v5.I, crd_note_acc: v5.J, adj_dta: v5.K, turnovr_comp: v5.L, adj_turn_sec: v5.M,
    adj_turn_fef: v5.N, adj_turn_othrsn: v5.O, annul_turn_adj: P5, annul_turn_decl: Q5, unrec_turnovr: R5r,
  };

  // ------------------------------------------------------------ Table 7 (ValidateFunc_Table7)
  const B7 = amt('7', '7B', W.t7.B);
  const C7 = amt('7', '7C', W.t7.C);
  const D7 = amt('7', '7D', W.t7.D);
  const D17 = amt('7', '7D1', W.t7.D1);
  const E7 = sum(P5, -B7, -C7, -D7, -D17); // =G6 - G7 - G8 - G9 - G10
  const F7 = amt('7', '7F', W.t7.F);
  const G7 = r2(F7 - E7);
  tie('7', '7E', E7, W.t7.E);
  tie('7', '7G', G7, W.t7.G);
  needsReason('8', '7G (un-reconciled taxable turnover)', G7, doc.t8Reasons);
  const table7: Gstr9cAuditedData['table7'] = {
    annul_turn_adj: P5, othr_turnovr: B7, zero_sup: C7, rev_sup: D7, rev_sup_ecom: D17, tax_turn_adj: E7, tax_turn_annul: F7, unrec_tax_turn: G7,
  };

  // ------------------------------------------------------------ Table 9 (ValidateFunc_Table9)
  const rows9 = W.t9.rows;
  const rate9: RateItem[] = [];
  const all9: Heads[] = [];
  T9_DESC.forEach(([k, desc]) => {
    const r: Partial<RateWiseRow> = rows9[k] ?? {};
    const tv = amt('9', `9${k}`, r.t);
    const h = heads('9', `9${k}`, r);
    all9.push(h);
    if (tv !== 0 || anyHead(h)) {
      em13('9', `9${k}`, tv, h);
      rate9.push({ tax_val: tv, ...h, desc });
    }
  });
  const other9 = (k: string) => heads('9', `9${k}`, rows9[k]);
  const ecom9 = other9('K2');
  const inter9 = other9('L');
  const late9 = other9('M');
  const pen9 = other9('N');
  const oth9 = other9('O');
  const P9 = addHeads(...all9, ecom9, inter9, late9, pen9, oth9); // =SUM(E7:E26)
  const Q9 = heads('9', '9Q', W.t9.Q);
  const R9 = subHeads(Q9, P9);
  // The portal checks tot_amt_paid head by head against the tax paid in the GSTR-9 (Table 9 + Table 14).
  const g9Paid = headsFromTax(W.g9Tie.paid);
  const HEAD_NAME = { cgst: 'Central tax', sgst: 'State/UT tax', igst: 'Integrated tax', cess: 'Cess' } as const;
  (['cgst', 'sgst', 'igst', 'cess'] as const).forEach((h) => {
    if (Math.abs(Q9[h] - g9Paid[h]) >= 0.005) {
      err('9', 'G9TIE', `9Q ${HEAD_NAME[h]} (total amount paid, ${Q9[h].toFixed(2)}) differs from the tax paid in the GSTR-9, Table 9 + Table 14 (${g9Paid[h].toFixed(2)}). The portal refuses this: "total amount paid (tot_amt_paid) does not match the declaration in GSTR-9", then "unreconciled payment is incorrect". Enter the filed GSTR-9 tax paid and reset 9Q.`, '9Q');
    }
  });
  tieHeads('9', '9P', P9, W.t9.P);
  tieHeads('9', '9R', R9, W.t9.R);
  needsReason('10', '9R (un-reconciled payment)', widest(R9), doc.t10Reasons);
  const table9: NonNullable<Gstr9cAuditedData['table9']> = {
    ...(rate9.length ? { rate: rate9 } : {}),
    ...(anyHead(ecom9) ? { oth_ecom: ecom9 } : {}),
    ...(anyHead(inter9) ? { inter: inter9 } : {}),
    ...(anyHead(late9) ? { late_fee: late9 } : {}),
    ...(anyHead(pen9) ? { pen: pen9 } : {}),
    ...(anyHead(oth9) ? { oth: oth9 } : {}),
    tot_amt_payable: P9,
    tot_amt_paid: Q9,
    unrec_amt: R9,
  };

  // ------------------------------------------------------------ Table 11 (ValidateFunc_Table11) — every row, zero-filled
  const rate11: RateItem[] = T11_DESC.map(([k, desc]) => {
    const r: Partial<RateWiseRow> = doc.t11?.[k as keyof Gstr9cDoc['t11']] ?? {};
    const tv = amt('11', `11${k}`, r.t);
    const h = heads('11', `11${k}`, r);
    em13('11', `11${k}`, tv, h);
    return { tax_val: tv, ...h, desc };
  });
  const row11 = (k: string) => heads('11', `11${k}`, doc.t11?.[k as keyof Gstr9cDoc['t11']]);
  const table11: Gstr9cAuditedData['table11'] = {
    rate: rate11, oth_ecom: row11('G2'), inter: row11('H'), late_fee: row11('I'), pen: row11('J'), oth: row11('K'),
  };

  // ------------------------------------------------------------ Table 12 (ValidateFunc_Table12) — one amount per row
  const A12 = amt('12', '12A', totalOf(W.t12.A));
  const B12 = amt('12', '12B', totalOf(W.t12.B));
  const C12 = amt('12', '12C', totalOf(W.t12.C));
  const D12 = sum(A12, B12, -C12); // =H6+H7-H8
  const E12 = amt('12', '12E', totalOf(W.t12.E));
  const F12 = r2(E12 - D12); // =H10-H9
  tie('12', '12D', D12, totalOf(W.t12.D));
  tie('12', '12F', F12, totalOf(W.t12.F));
  needsReason('13', '12F (un-reconciled ITC)', F12, doc.t13Reasons);
  const table12: Gstr9cAuditedData['table12'] = {
    itc_avail: A12, itc_book_earl: B12, itc_book_curr: C12, itc_avail_audited: D12, itc_claim: E12, unrec_itc: F12,
  };

  // ------------------------------------------------------------ Table 14 (ValidateFunc_Table14)
  const items14: NonNullable<NonNullable<Gstr9cAuditedData['table14']>['items']> = [];
  const elig: number[] = [];
  T14_DESC.forEach(([k, desc]) => {
    const r: Partial<ValTax> = W.t14.rows[k] ?? {};
    const v = amt('14', `14${k === 'A2' ? 'A' : k}`, r.t);
    const itc = amt('14', `14${k === 'A2' ? 'A' : k}`, totalOf(r));
    elig.push(itc);
    if (v !== 0 || itc !== 0) {
      if (v === 0 && itc !== 0) warn('14', 'EM14', `14${k === 'A2' ? 'A' : k}: ${EM.EM14} The value here is 0.`, `14${k === 'A2' ? 'A' : k}`);
      // The working holds eligible ITC by head only, so "Amount of Total ITC" is the same figure.
      items14.push({ val: v, itc_amt: itc, itc_avail: itc, desc });
    }
  });
  const R14 = sum(...elig); // =SUM(H6:H22)
  const S14 = amt('14', '14S', totalOf(W.t14.S));
  const T14 = r2(S14 - R14); // =H24-H23
  tie('14', '14R', R14, totalOf(W.t14.R));
  tie('14', '14T', T14, totalOf(W.t14.T));
  needsReason('15', '14T (un-reconciled ITC by expense head)', T14, doc.t15Reasons);
  const table14: Gstr9cAuditedData['table14'] | undefined =
    items14.length || S14 !== 0
      ? { ...(items14.length ? { items: items14 } : {}), tot_elig_itc: { itc_avail: R14 }, itc_claim: { itc_avail: S14 }, unrec_itc: { itc_avail: T14 } }
      : undefined;

  // ------------------------------------------------------------ Table 16 (ValidateFunc_Table16)
  const t16 = doc.t16 ?? ({} as Gstr9cDoc['t16']);
  const table16: Gstr9cAuditedData['table16'] = {
    cgst: amt('16', '16A', t16.A), sgst: amt('16', '16B', t16.B), igst: amt('16', '16C', t16.C),
    cess: amt('16', '16D', t16.D), inter: amt('16', '16E', t16.E), pen: amt('16', '16F', t16.F),
  };

  // ------------------------------------------------------------ Part V (ValidateFunc_TableFive)
  const taxPay: NonNullable<Gstr9cAuditedData['add_liab']['tax_pay']> = [];
  PARTV_DESC.forEach(([k, desc]) => {
    const r: Partial<RateWiseRow> = doc.partV?.[k as keyof Gstr9cDoc['partV']] ?? {};
    // V G2 (supplies taxed through the e-commerce operator) has no value cell (D16:E16 closed).
    const v = k === 'G2' ? 0 : amt('V', `V ${k}`, r.t);
    const h = heads('V', `V ${k}`, r);
    if (v !== 0 || anyHead(h)) {
      if (k !== 'G2') em13('V', `V ${k}`, v, h);
      taxPay.push({ val: v, igst: h.igst, cgst: h.cgst, sgst: h.sgst, cess: h.cess, desc });
    }
  });

  // ------------------------------------------------------------ Assemble, in the utility's order
  const audited: Gstr9cAuditedData = {
    gstin,
    fp: gstr9cFp(fy),
    act_name: actName,
    table5,
    ...optional('table6', reasons('6', doc.t6Reasons)),
    table7,
    ...optional('table8', reasons('8', doc.t8Reasons)),
    table9,
    ...optional('table10', reasons('10', doc.t10Reasons)),
    table11,
    table12,
    ...optional('table13', reasons('13', doc.t13Reasons)),
    ...optional('table14', table14),
    ...optional('table15', reasons('15', doc.t15Reasons)),
    table16,
    add_liab: taxPay.length ? { tax_pay: taxPay } : {},
  } as Gstr9cAuditedData;
  const payload: Gstr9cPortalJson = { gstr9cdata: { audited_data: audited } };

  // The builder and the schema check are written separately, so each checks the other.
  validateGstr9cPortalJson(payload).forEach((m) => err('JSON', 'SCHEMA', m));

  const text = JSON.stringify(payload);
  const items = rate9.length + rate11.length + items14.length + taxPay.length;
  if (new TextEncoder().encode(text).length > MAX_BYTES) err('JSON', 'SIZE', 'The JSON is larger than 5 MB, the most the portal takes.');
  if (items > MAX_ITEMS) err('JSON', 'SIZE', `The JSON has ${items} items; the portal takes at most ${MAX_ITEMS}.`);

  const errors = checks.filter((c) => c.severity === 'error').length;
  return {
    payload: errors ? null : payload,
    text: errors ? null : text,
    fileName: gstr9cFileName(gstin, input.today),
    checks,
    errors,
    warnings: checks.length - errors,
  };
}

function optional<K extends string, V>(key: K, v: V | undefined): Partial<Record<K, V>> {
  return v === undefined ? {} : ({ [key]: v } as Record<K, V>);
}

// ---------------------------------------------------------------------------
// Schema check — what the utility writes, key by key
// ---------------------------------------------------------------------------

const KEYS = {
  audited: ['gstin', 'fp', 'act_name', 'table5', 'table6', 'table7', 'table8', 'table9', 'table10', 'table11', 'table12', 'table13', 'table14', 'table15', 'table16', 'add_liab'],
  required: ['gstin', 'fp', 'act_name', 'table5', 'table7', 'table11', 'table12', 'table16', 'add_liab'],
  table5: ['turnovr', 'unbil_rev_beg', 'unadj_adv_end', 'dmd_sup', 'crd_nts_issued', 'trd_dis', 'turnovr_apr_jun', 'unbil_rev_end', 'unadj_adv_beg', 'crd_note_acc', 'adj_dta', 'turnovr_comp', 'adj_turn_sec', 'adj_turn_fef', 'adj_turn_othrsn', 'annul_turn_adj', 'annul_turn_decl', 'unrec_turnovr'],
  table7: ['annul_turn_adj', 'othr_turnovr', 'zero_sup', 'rev_sup', 'rev_sup_ecom', 'tax_turn_adj', 'tax_turn_annul', 'unrec_tax_turn'],
  table12: ['itc_avail', 'itc_book_earl', 'itc_book_curr', 'itc_avail_audited', 'itc_claim', 'unrec_itc'],
  table16: ['cgst', 'sgst', 'igst', 'cess', 'inter', 'pen'],
  heads: ['cgst', 'sgst', 'igst', 'cess'],
  rate: ['tax_val', 'cgst', 'sgst', 'igst', 'cess', 'desc'],
  t9: ['rate', 'oth_ecom', 'inter', 'late_fee', 'pen', 'oth', 'tot_amt_payable', 'tot_amt_paid', 'unrec_amt'],
  t11: ['rate', 'oth_ecom', 'inter', 'late_fee', 'pen', 'oth'],
  t14: ['items', 'tot_elig_itc', 'itc_claim', 'unrec_itc'],
  t14item: ['val', 'itc_amt', 'itc_avail', 'desc'],
  taxPay: ['val', 'igst', 'cgst', 'sgst', 'cess', 'desc'],
} as const;

/**
 * Check a GSTR-9C JSON against the shape the utility writes for FY 2024-25
 * onwards: exactly its keys, numbers with at most 2 decimals and 13 digits,
 * the codes of the Master sheet, reasons RSN1…RSNn, and the formula rows
 * (5P, 5R, 7A, 7E, 7G, 9P, 9R, 12D, 12F, 14R, 14T) equal to their formulas.
 * Returns the problems found (empty = the JSON is as the utility writes it).
 */
export function validateGstr9cPortalJson(json: unknown): string[] {
  const out: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const exact = (path: string, o: unknown, allowed: readonly string[], required: readonly string[] = allowed): o is Record<string, unknown> => {
    if (!isObj(o)) { out.push(`${path}: not an object`); return false; }
    Object.keys(o).forEach((k) => { if (!allowed.includes(k)) out.push(`${path}.${k}: not a key the utility writes`); });
    required.forEach((k) => { if (!(k in o)) out.push(`${path}.${k}: missing`); });
    return true;
  };
  const num = (path: string, v: unknown): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) { out.push(`${path}: not a number`); return 0; }
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) out.push(`${path}: more than 2 decimals`);
    if (Math.trunc(Math.abs(v)).toString().length > 13) out.push(`${path}: more than 13 digits`);
    return v;
  };
  const eq = (path: string, got: number, want: number) => { if (Math.abs(got - want) > 0.005) out.push(`${path}: ${got} is not ${r2(want)} (the utility's formula)`); };
  const headsOf = (path: string, o: unknown): Heads => {
    if (!exact(path, o, KEYS.heads)) return { cgst: 0, sgst: 0, igst: 0, cess: 0 };
    return { cgst: num(`${path}.cgst`, o.cgst), sgst: num(`${path}.sgst`, o.sgst), igst: num(`${path}.igst`, o.igst), cess: num(`${path}.cess`, o.cess) };
  };
  const rates = (path: string, v: unknown, codes: string[]): Heads[] => {
    if (!Array.isArray(v)) { out.push(`${path}: not a list`); return []; }
    const seen = new Set<string>();
    return v.map((it, i) => {
      const p = `${path}[${i}]`;
      if (!exact(p, it, KEYS.rate)) return { cgst: 0, sgst: 0, igst: 0, cess: 0 };
      num(`${p}.tax_val`, it.tax_val);
      if (typeof it.desc !== 'string' || !codes.includes(it.desc)) out.push(`${p}.desc: "${String(it.desc)}" is not one of ${codes.join(', ')}`);
      else if (seen.has(it.desc)) out.push(`${p}.desc: "${it.desc}" twice`);
      else seen.add(it.desc);
      return headsOf(p, { cgst: it.cgst, sgst: it.sgst, igst: it.igst, cess: it.cess });
    });
  };
  const rsn = (path: string, v: unknown) => {
    if (!exact(path, v, ['rsn'])) return;
    const list = v.rsn;
    if (!Array.isArray(list) || !list.length) { out.push(`${path}.rsn: a reasons table is written only with at least one reason`); return; }
    if (list.length > REASON_ROWS) out.push(`${path}.rsn: more than ${REASON_ROWS} reasons`);
    list.forEach((r, i) => {
      const p = `${path}.rsn[${i}]`;
      if (!exact(p, r, ['number', 'desc'])) return;
      if (r.number !== `RSN${i + 1}`) out.push(`${p}.number: should be RSN${i + 1}`);
      if (typeof r.desc !== 'string' || !r.desc || r.desc.length > REASON_MAX || /[\r\n]/.test(r.desc)) out.push(`${p}.desc: ${EM.EM1}`);
      else if (!REASON_CHARS_REGEX.test(r.desc)) out.push(`${p}.desc: ${EM.HASH}`);
    });
  };

  if (!exact('$', json, ['gstr9cdata'])) return out;
  const root = json.gstr9cdata;
  if (!exact('gstr9cdata', root, ['audited_data'])) return out;
  const a = root.audited_data;
  if (!exact('audited_data', a, KEYS.audited, KEYS.required)) return out;

  if (typeof a.gstin !== 'string' || !GSTIN_REGEX_UTILITY.test(a.gstin)) out.push(`audited_data.gstin: ${EM.EM3}`);
  if (typeof a.fp !== 'string' || !/^0320\d{2}$/.test(a.fp)) out.push('audited_data.fp: should be "0320" and the last two digits of the FY');
  if (typeof a.act_name !== 'string' || a.act_name.length > ACT_NAME_MAX) out.push(`audited_data.act_name: ${EM.EM18}`);

  if (exact('table5', a.table5, KEYS.table5)) {
    const t = Object.fromEntries(KEYS.table5.map((k) => [k, num(`table5.${k}`, (a.table5 as Record<string, unknown>)[k])])) as Record<string, number>;
    const P = t.turnovr + t.unbil_rev_beg + t.unadj_adv_end + t.dmd_sup - t.crd_nts_issued + t.trd_dis - t.turnovr_apr_jun - t.unbil_rev_end
      - t.unadj_adv_beg + t.crd_note_acc - t.adj_dta - t.turnovr_comp + t.adj_turn_sec + t.adj_turn_fef + t.adj_turn_othrsn;
    eq('table5.annul_turn_adj (5P)', t.annul_turn_adj, P);
    eq('table5.unrec_turnovr (5R)', t.unrec_turnovr, t.annul_turn_decl - t.annul_turn_adj);
    if (exact('table7', a.table7, KEYS.table7)) {
      const s = Object.fromEntries(KEYS.table7.map((k) => [k, num(`table7.${k}`, (a.table7 as Record<string, unknown>)[k])])) as Record<string, number>;
      eq('table7.annul_turn_adj (7A = 5P)', s.annul_turn_adj, t.annul_turn_adj);
      eq('table7.tax_turn_adj (7E)', s.tax_turn_adj, s.annul_turn_adj - s.othr_turnovr - s.zero_sup - s.rev_sup - s.rev_sup_ecom);
      eq('table7.unrec_tax_turn (7G)', s.unrec_tax_turn, s.tax_turn_annul - s.tax_turn_adj);
    }
  }
  (['table6', 'table8', 'table10', 'table13', 'table15'] as const).forEach((k) => { if (k in a) rsn(k, a[k]); });

  if ('table9' in a && exact('table9', a.table9, KEYS.t9, ['tot_amt_payable', 'tot_amt_paid', 'unrec_amt'])) {
    const t = a.table9;
    const parts: Heads[] = 'rate' in t ? rates('table9.rate', t.rate, T9_DESC.map(([, d]) => d)) : [];
    (['oth_ecom', 'inter', 'late_fee', 'pen', 'oth'] as const).forEach((k) => { if (k in t) parts.push(headsOf(`table9.${k}`, t[k])); });
    const P = headsOf('table9.tot_amt_payable', t.tot_amt_payable);
    const Q = headsOf('table9.tot_amt_paid', t.tot_amt_paid);
    const R = headsOf('table9.unrec_amt', t.unrec_amt);
    KEYS.heads.forEach((h) => {
      eq(`table9.tot_amt_payable.${h} (9P)`, P[h], parts.reduce((s, x) => s + x[h], 0));
      eq(`table9.unrec_amt.${h} (9R)`, R[h], Q[h] - P[h]);
    });
  }

  if (exact('table11', a.table11, KEYS.t11, ['rate'])) {
    const t = a.table11;
    rates('table11.rate', t.rate, T11_DESC.map(([, d]) => d));
    (['oth_ecom', 'inter', 'late_fee', 'pen', 'oth'] as const).forEach((k) => { if (k in t) headsOf(`table11.${k}`, t[k]); });
  }

  if (exact('table12', a.table12, KEYS.table12)) {
    const t = Object.fromEntries(KEYS.table12.map((k) => [k, num(`table12.${k}`, (a.table12 as Record<string, unknown>)[k])])) as Record<string, number>;
    eq('table12.itc_avail_audited (12D)', t.itc_avail_audited, t.itc_avail + t.itc_book_earl - t.itc_book_curr);
    eq('table12.unrec_itc (12F)', t.unrec_itc, t.itc_claim - t.itc_avail_audited);
  }

  if ('table14' in a && exact('table14', a.table14, KEYS.t14, ['tot_elig_itc', 'itc_claim', 'unrec_itc'])) {
    const t = a.table14;
    let R = 0;
    if ('items' in t) {
      if (!Array.isArray(t.items)) out.push('table14.items: not a list');
      else {
        const codes = [...T14_DESC.map(([, d]) => d), ...T14_EXTRA];
        t.items.forEach((it, i) => {
          const p = `table14.items[${i}]`;
          if (!exact(p, it, KEYS.t14item)) return;
          num(`${p}.val`, it.val);
          num(`${p}.itc_amt`, it.itc_amt);
          R += num(`${p}.itc_avail`, it.itc_avail);
          if (typeof it.desc !== 'string' || !codes.includes(it.desc)) out.push(`${p}.desc: "${String(it.desc)}" is not a Table 14 code`);
        });
      }
    }
    const one = (k: string, v: unknown) => (exact(`table14.${k}`, v, ['itc_avail']) ? num(`table14.${k}.itc_avail`, v.itc_avail) : 0);
    const totR = one('tot_elig_itc', t.tot_elig_itc);
    const S = one('itc_claim', t.itc_claim);
    const T = one('unrec_itc', t.unrec_itc);
    eq('table14.tot_elig_itc (14R)', totR, R);
    eq('table14.unrec_itc (14T = S − R)', T, S - totR);
  }

  if (exact('table16', a.table16, KEYS.table16)) KEYS.table16.forEach((k) => num(`table16.${k}`, (a.table16 as Record<string, unknown>)[k]));

  if (exact('add_liab', a.add_liab, ['tax_pay'], [])) {
    const tp = a.add_liab.tax_pay;
    if (tp !== undefined) {
      if (!Array.isArray(tp)) out.push('add_liab.tax_pay: not a list');
      else {
        const codes = PARTV_DESC.map(([, d]) => d);
        tp.forEach((it, i) => {
          const p = `add_liab.tax_pay[${i}]`;
          if (!exact(p, it, KEYS.taxPay)) return;
          KEYS.taxPay.filter((k) => k !== 'desc').forEach((k) => num(`${p}.${k}`, it[k]));
          if (typeof it.desc !== 'string' || !codes.includes(it.desc)) out.push(`${p}.desc: "${String(it.desc)}" is not a Part V code`);
        });
      }
    }
  }
  return out;
}

/** The working's un-reconciled figures as the JSON carries them (for the screen's summary line). */
export const portalTotals = (p: Gstr9cPortalJson) => {
  const a = p.gstr9cdata.audited_data;
  const t9 = a.table9?.unrec_amt;
  return {
    r5: a.table5.unrec_turnovr,
    g7: a.table7.unrec_tax_turn,
    r9: t9 ? r2(t9.cgst + t9.sgst + t9.igst + t9.cess) : 0,
    f12: a.table12.unrec_itc,
    t14: a.table14?.unrec_itc.itc_avail ?? 0,
  };
};

/** Tax shape → the utility's head names, for screens that show what the JSON carries. */
export const headsFromTax = (t: Tax): Heads => ({ cgst: r2(t.c), sgst: r2(t.s), igst: r2(t.i), cess: r2(t.x) });
