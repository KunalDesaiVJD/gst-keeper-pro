// What a GSTIN says about itself, before anyone asks the portal: its format,
// state, embedded PAN, the registration number under that PAN and the
// GSTN mod-36 check character, and the kind of registration its shape
// implies. Pure: no I/O, no dependencies, so scripts/verify-vendor-risk.mjs
// tests it under Node. Positions: docs/VENDOR_GSTIN_RISK.md §3.
//
// The check character and the structural patterns are the ones the app
// already uses (src/lib/gstr1/validate.ts, the GSTR-1 offline tool's four
// recipient formats, and supabase/functions/notice-ai/gstin.ts); this file
// only adds a name for each kind. Which patterns are GSTN's published
// structure and which are heuristics is said against each one below.

const CODE_POINTS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GST state codes (registration state, the first two characters). 28 is pre-2014 Andhra Pradesh. */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

/** PAN 4th character: the holder's status (Income-tax PAN structure). */
export const PAN_HOLDER: Record<string, string> = {
  P: 'Individual', C: 'Company', H: 'HUF', F: 'Firm / LLP', A: 'AOP', B: 'BOI', T: 'Trust',
  L: 'Local authority', J: 'Artificial juridical person', G: 'Government',
};

/** The 15th character GSTN derives from the first 14 (factors 1,2,1,2… from the left, base-36 digits summed). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = CODE_POINTS.indexOf(first14[i]) * (i % 2 === 1 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CODE_POINTS[(36 - (sum % 36)) % 36];
}

/**
 * The kind a GSTIN's shape implies.
 *  - normal: PAN-based, 14th character 'Z' (GSTN structure; every regular,
 *    composition, casual, SEZ and ISD registration looks like this, so the
 *    shape alone never says "composition").
 *  - tcs: PAN-based, 14th character 'C': an e-commerce operator's s.52
 *    registration. Seen on the portal's TCS GSTINs; GSTN has not published it
 *    as a rule, so it is a heuristic, said as "appears to be".
 *  - tds: a TAN-shaped id (4 letters, 5 digits, 1 letter) in place of the PAN
 *    and 'D' at the 14th: a s.51 deductor's registration (the offline tool's
 *    TDS format).
 *  - uin: '…UN…' / '…ON…' at the 13th–14th after a 4-digit, 3-letter, 5-digit
 *    body: a UN body, embassy or other notified person (s.55), the offline
 *    tool's UIN format.
 *  - nrtp: the same body with 'NR': a non-resident taxable person (offline tool).
 *  - oidar: state 99 and 'OS' at the 13th–14th: an OIDAR supplier's
 *    simplified registration. Heuristic (from GSTN's sample ids).
 *  - other_pan: PAN-based but the 14th is not 'Z' or 'C' (the offline tool
 *    accepts 1–9 / A–J there): a valid shape whose meaning is not settled.
 */
export type GstinKind = 'normal' | 'tcs' | 'tds' | 'uin' | 'nrtp' | 'oidar' | 'other_pan' | 'invalid';

export const GSTIN_KIND_LABEL: Record<GstinKind, string> = {
  normal: 'Normal registration (PAN-based)',
  tcs: 'Appears to be a TCS registration (e-commerce operator, s.52)',
  tds: 'TDS deductor registration (s.51)',
  uin: 'UIN: UN body / embassy / notified person (s.55)',
  nrtp: 'Non-resident taxable person',
  oidar: 'Appears to be an OIDAR supplier registration',
  other_pan: 'PAN-based, unusual 14th character',
  invalid: 'Not a valid GSTIN',
};

const PAN_BASED = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z][0-9A-Z]$/;
const TDS = /^[0-9]{2}[A-Z]{4}[0-9A-Z][0-9]{4}[A-Z][1-9A-Z]D[0-9A-Z]$/;
const UIN = /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[0-9A-Z]$/;
const NRTP = /^[0-9]{4}[A-Z]{3}[0-9]{5}NR[0-9A-Z]$/;
const OIDAR = /^99[0-9]{2}[A-Z]{3}[0-9]{5}OS[0-9A-Z]$/;

export interface GstinCheck {
  gstin: string;
  /** 15 characters of the right alphabet in one of the known shapes. */
  formatOk: boolean;
  /** The 15th character matches the first 14 (only meaningful when formatOk). */
  checkDigitOk: boolean;
  /** formatOk, checkDigitOk and a known state code. */
  valid: boolean;
  stateCode: string;
  state: string | null;
  /** The PAN embedded at characters 3–12 (PAN-based kinds only). */
  pan: string | null;
  panHolder: string | null;
  /** The 13th character: the registration's number under that PAN in the state (1, 2, … then A, B …). */
  entityNumber: string | null;
  kind: GstinKind;
  /** Why it is invalid, in words; null when valid. */
  problem: string | null;
}

export const normGstin = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\s-]+/g, '').toUpperCase() : '');

export function checkGstin(raw: unknown): GstinCheck {
  const g = normGstin(raw);
  const stateCode = g.slice(0, 2);
  const state = STATE_CODES[stateCode] ?? null;
  const base = { gstin: g, stateCode, state, pan: null, panHolder: null, entityNumber: null };
  if (g.length !== 15 || !/^[0-9A-Z]{15}$/.test(g)) {
    return { ...base, formatOk: false, checkDigitOk: false, valid: false, kind: 'invalid', problem: g ? `has ${g.length} characters, not 15` : 'is blank' };
  }
  let kind: GstinKind;
  if (TDS.test(g)) kind = 'tds';
  else if (OIDAR.test(g)) kind = 'oidar';
  else if (NRTP.test(g)) kind = 'nrtp';
  else if (UIN.test(g)) kind = 'uin';
  else if (PAN_BASED.test(g)) kind = g[13] === 'Z' ? 'normal' : g[13] === 'C' ? 'tcs' : 'other_pan';
  else kind = 'invalid';
  const formatOk = kind !== 'invalid';
  const checkDigitOk = formatOk && gstinCheckChar(g.slice(0, 14)) === g[14];
  const panBased = kind === 'normal' || kind === 'tcs' || kind === 'other_pan';
  const pan = panBased ? g.slice(2, 12) : null;
  const problem = !formatOk ? 'is not in any GSTIN / UIN format'
    : !checkDigitOk ? `fails the GSTIN check character (expected ${gstinCheckChar(g.slice(0, 14))}, found ${g[14]}): a character is mistyped`
    : !state ? `has state code ${stateCode}, which is not a GST state code`
    : null;
  return {
    ...base,
    pan,
    panHolder: pan ? PAN_HOLDER[pan[3]] ?? null : null,
    entityNumber: panBased ? g[12] : null,
    formatOk,
    checkDigitOk,
    valid: problem === null,
    kind: problem === null ? kind : formatOk ? kind : 'invalid',
    problem,
  };
}

/** A valid GSTIN from 14 characters (tests, fixtures). */
export const withCheckChar = (first14: string): string => `${first14}${gstinCheckChar(first14.toUpperCase())}`;
