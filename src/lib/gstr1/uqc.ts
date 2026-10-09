/**
 * GSTR-1 Table 12 units (UQC), as GSTN accepts them.
 *
 * The portal's dropdown shows "OTH-OTHERS", "KGS-KILOGRAMS"; the JSON carries
 * only the code before the hyphen. A Tally or Excel export that writes the
 * label ("Others", "PCS-PIECES") or a unit of its own is rejected row by row
 * with RET191353 "The UQC entered is not valid", while typing the same row on
 * the portal works, because there the unit can only be picked from the list.
 *
 * Rules (GSTN Returns Offline Tool 3.2.4, which the portal mirrors):
 *  - A service (HSN/SAC starting "99") always carries uqc "NA" and qty 0.
 *    Any other unit is RET191353; a quantity other than 0 is RET191355.
 *  - Goods carry one of the 45 codes below, never "NA"; "OTH" is the
 *    catch-all when no unit fits.
 *  - HSN + UQC + rate is unique within each of hsn_b2b / hsn_b2c (and the
 *    older single hsn.data list).
 *
 * The list is GSTN's, not a blog's: GSTN uses GGK (not GGR) for great gross,
 * has LTR, and TGM is TEN GROSS. Descriptions are GSTN's own spellings.
 */

export interface GstnUqc { code: string; label: string }

export const GSTN_UQC: readonly GstnUqc[] = [
  { code: 'BAG', label: 'BAGS' },
  { code: 'BAL', label: 'BALE' },
  { code: 'BDL', label: 'BUNDLES' },
  { code: 'BKL', label: 'BUCKLES' },
  { code: 'BOU', label: 'BILLION OF UNITS' },
  { code: 'BOX', label: 'BOX' },
  { code: 'BTL', label: 'BOTTLES' },
  { code: 'BUN', label: 'BUNCHES' },
  { code: 'CAN', label: 'CANS' },
  { code: 'CBM', label: 'CUBIC METERS' },
  { code: 'CCM', label: 'CUBIC CENTIMETERS' },
  { code: 'CMS', label: 'CENTIMETERS' },
  { code: 'CTN', label: 'CARTONS' },
  { code: 'DOZ', label: 'DOZENS' },
  { code: 'DRM', label: 'DRUMS' },
  { code: 'GGK', label: 'GREAT GROSS' },
  { code: 'GMS', label: 'GRAMMES' },
  { code: 'GRS', label: 'GROSS' },
  { code: 'GYD', label: 'GROSS YARDS' },
  { code: 'KGS', label: 'KILOGRAMS' },
  { code: 'KLR', label: 'KILOLITRE' },
  { code: 'KME', label: 'KILOMETRE' },
  { code: 'LTR', label: 'LITRES' },
  { code: 'MLT', label: 'MILILITRE' },
  { code: 'MTR', label: 'METERS' },
  { code: 'MTS', label: 'METRIC TON' },
  { code: 'NOS', label: 'NUMBERS' },
  { code: 'PAC', label: 'PACKS' },
  { code: 'PCS', label: 'PIECES' },
  { code: 'PRS', label: 'PAIRS' },
  { code: 'QTL', label: 'QUINTAL' },
  { code: 'ROL', label: 'ROLLS' },
  { code: 'SET', label: 'SETS' },
  { code: 'SQF', label: 'SQUARE FEET' },
  { code: 'SQM', label: 'SQUARE METERS' },
  { code: 'SQY', label: 'SQUARE YARDS' },
  { code: 'TBS', label: 'TABLETS' },
  { code: 'TGM', label: 'TEN GROSS' },
  { code: 'THD', label: 'THOUSANDS' },
  { code: 'TON', label: 'TONNES' },
  { code: 'TUB', label: 'TUBES' },
  { code: 'UGS', label: 'US GALLONS' },
  { code: 'UNT', label: 'UNITS' },
  { code: 'YDS', label: 'YARDS' },
  { code: 'OTH', label: 'OTHERS' },
];

/** The unit every service row carries. */
export const SERVICE_UQC = 'NA';
/** GSTN's catch-all for goods whose unit is not in the list. */
export const FALLBACK_UQC = 'OTH';

const GOODS_CODES = new Set(GSTN_UQC.map((u) => u.code));
const LABEL_OF = new Map(GSTN_UQC.map((u) => [u.code, u.label]));

/** "KGS-KILOGRAMS", as the portal's dropdown shows it; "NA" stays "NA". */
export const uqcLabel = (code: string): string => {
  const label = LABEL_OF.get(code);
  return label ? `${code}-${label}` : code;
};

/** A service is any HSN/SAC starting "99" (not "9": chapters 90 to 98 are goods). */
export const isServiceHsn = (hsn: unknown): boolean => /^99/.test(String(hsn ?? '').trim());

/** GSTN takes 4 to 8 digits (4 up to ₹5 crore AATO, 6 above). */
export const isValidHsnCode = (hsn: unknown): boolean => /^\d{4,8}$/.test(String(hsn ?? '').trim());

const squash = (s: string) => s.toUpperCase().replace(/[.'’`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Spellings Tally, Busy, Excel templates and people use, mapped to GSTN's code.
 * Keys are squashed (upper case, no dots or apostrophes, single spaces). The
 * GSTN descriptions themselves are added below. "MT" is left out on purpose:
 * it means metric ton to some and metre to others.
 */
const ALIASES: Record<string, string> = {
  OTHER: 'OTH', OTHERS: 'OTH', OTHS: 'OTH', OTHR: 'OTH',
  PC: 'PCS', PCE: 'PCS', PIECE: 'PCS', PIECES: 'PCS', PCS: 'PCS',
  NO: 'NOS', NUMBER: 'NOS', NUMBERS: 'NOS', NUM: 'NOS', NUMS: 'NOS', NUMBR: 'NOS',
  KG: 'KGS', KGM: 'KGS', KILO: 'KGS', KILOS: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS', KILOGRAMME: 'KGS', KILOGRAMMES: 'KGS',
  GM: 'GMS', GRM: 'GMS', GRAM: 'GMS', GRAMS: 'GMS', GRAMME: 'GMS', GRAMMES: 'GMS',
  L: 'LTR', LT: 'LTR', LTRS: 'LTR', LITRE: 'LTR', LITRES: 'LTR', LITER: 'LTR', LITERS: 'LTR',
  ML: 'MLT', MLS: 'MLT', MILLILITRE: 'MLT', MILLILITRES: 'MLT', MILLILITER: 'MLT', MILLILITERS: 'MLT', MILILITRE: 'MLT',
  MTRS: 'MTR', METER: 'MTR', METERS: 'MTR', METRE: 'MTR', METRES: 'MTR', MTRE: 'MTR',
  'METRIC TON': 'MTS', 'METRIC TONS': 'MTS', 'METRIC TONNE': 'MTS', 'METRIC TONNES': 'MTS',
  TONNE: 'TON', TONNES: 'TON', TONS: 'TON',
  BAGS: 'BAG', BALES: 'BAL', BUNDLE: 'BDL', BUNDLES: 'BDL', BUCKLE: 'BKL', BUCKLES: 'BKL',
  BOXES: 'BOX', BOTTLE: 'BTL', BOTTLES: 'BTL', BOTL: 'BTL', BUNCH: 'BUN', BUNCHES: 'BUN', CANS: 'CAN',
  CARTON: 'CTN', CARTONS: 'CTN', DOZEN: 'DOZ', DOZENS: 'DOZ', DRUM: 'DRM', DRUMS: 'DRM',
  PACK: 'PAC', PACKS: 'PAC', PACKET: 'PAC', PACKETS: 'PAC', PKT: 'PAC', PKTS: 'PAC',
  PAIR: 'PRS', PAIRS: 'PRS', QUINTAL: 'QTL', QUINTALS: 'QTL', ROLL: 'ROL', ROLLS: 'ROL', SETS: 'SET',
  TABLET: 'TBS', TABLETS: 'TBS', TAB: 'TBS', TABS: 'TBS', TUBE: 'TUB', TUBES: 'TUB',
  UNIT: 'UNT', UNITS: 'UNT', YARD: 'YDS', YARDS: 'YDS', THOUSAND: 'THD', THOUSANDS: 'THD',
  SQFT: 'SQF', 'SQ FT': 'SQF', 'SQUARE FOOT': 'SQF', 'SQUARE FEET': 'SQF',
  SQMT: 'SQM', SQMTR: 'SQM', 'SQ M': 'SQM', 'SQ MT': 'SQM', 'SQ MTR': 'SQM', 'SQUARE METER': 'SQM', 'SQUARE METERS': 'SQM', 'SQUARE METRE': 'SQM', 'SQUARE METRES': 'SQM',
  SQYD: 'SQY', 'SQ YD': 'SQY', 'SQUARE YARD': 'SQY', 'SQUARE YARDS': 'SQY',
  CUM: 'CBM', 'CUBIC METER': 'CBM', 'CUBIC METERS': 'CBM', 'CUBIC METRE': 'CBM', 'CUBIC METRES': 'CBM',
  CC: 'CCM', 'CUBIC CENTIMETER': 'CCM', 'CUBIC CENTIMETERS': 'CCM', 'CUBIC CENTIMETRE': 'CCM', 'CUBIC CENTIMETRES': 'CCM',
  CM: 'CMS', CENTIMETER: 'CMS', CENTIMETERS: 'CMS', CENTIMETRE: 'CMS', CENTIMETRES: 'CMS',
  KM: 'KME', KMS: 'KME', KILOMETER: 'KME', KILOMETERS: 'KME', KILOMETRE: 'KME', KILOMETRES: 'KME',
  KL: 'KLR', KILOLITRE: 'KLR', KILOLITRES: 'KLR', KILOLITER: 'KLR', KILOLITERS: 'KLR',
  GGR: 'GGK', 'GREAT GROSS': 'GGK', 'TEN GROSS': 'TGM', 'GROSS YARD': 'GYD', 'GROSS YARDS': 'GYD',
  'BILLION OF UNITS': 'BOU', 'BILLIONS OF UNITS': 'BOU', 'US GALLON': 'UGS', 'US GALLONS': 'UGS',
};
for (const u of GSTN_UQC) if (!(u.label in ALIASES)) ALIASES[u.label] = u.code;

const NOT_APPLICABLE = new Set(['NA', 'N/A', 'N A', 'NIL', 'NONE', '-', '--']);

/** What a stored unit means for one Table 12 row. */
export type UqcVerdict =
  /** A GSTN goods code. `exact` when the stored value already is that code. */
  | { kind: 'ok'; code: string; exact: boolean }
  /** A service row: always NA (qty 0), whatever was stored. */
  | { kind: 'service'; code: typeof SERVICE_UQC; exact: boolean }
  /** A goods row with no unit, or NA: goes to the portal as OTH. */
  | { kind: 'defaulted'; code: typeof FALLBACK_UQC; raw: string }
  /** Not a unit GSTN knows; a person has to choose one. */
  | { kind: 'unknown'; raw: string };

export function classifyUqc(raw: unknown, hsn: unknown): UqcVerdict {
  const text = raw === null || raw === undefined ? '' : String(raw);
  if (isServiceHsn(hsn)) return { kind: 'service', code: SERVICE_UQC, exact: text === SERVICE_UQC };
  if (GOODS_CODES.has(text)) return { kind: 'ok', code: text, exact: true };
  const s = squash(text);
  if (!s || NOT_APPLICABLE.has(s)) return { kind: 'defaulted', code: FALLBACK_UQC, raw: text };
  if (GOODS_CODES.has(s)) return { kind: 'ok', code: s, exact: false };
  // "PCS-PIECES", "OTH - OTHERS": the portal's label; the code is the part before the hyphen.
  const head = s.split('-')[0].trim();
  if (GOODS_CODES.has(head)) return { kind: 'ok', code: head, exact: false };
  const alias = ALIASES[s] ?? ALIASES[s.replace(/ /g, '')] ?? ALIASES[head];
  if (alias) return { kind: 'ok', code: alias, exact: false };
  return { kind: 'unknown', raw: text };
}

/** The GSTN code for a stored unit on this row, or null when a person must choose. */
export function normaliseUqc(raw: unknown, hsn: unknown): string | null {
  const v = classifyUqc(raw, hsn);
  return v.kind === 'unknown' ? null : v.code;
}

/** For an editor: the GSTN code when one can be read, else the stored text untouched (so it shows as "choose"). */
export function editableUqc(raw: unknown, hsn: unknown): string {
  const v = classifyUqc(raw, hsn);
  if (v.kind === 'unknown') return v.raw;
  if (v.kind === 'defaulted') return '';
  return v.code;
}

// ── Whole Table 12 ──────────────────────────────────────────────────────────

const HSN_TABLES = ['data', 'hsn_b2b', 'hsn_b2c'] as const;
export type HsnTable = (typeof HSN_TABLES)[number];
const SUM_FIELDS = ['qty', 'val', 'txval', 'iamt', 'camt', 'samt', 'csamt'] as const;

export interface HsnFix {
  table: HsnTable;
  hsn: string;
  from: string;
  to: string;
  /** A service row's quantity was set to 0. */
  qtyZeroed: boolean;
}
export interface HsnProblem {
  table: HsnTable;
  hsn: string;
  uqc: string;
  reason: 'hsn' | 'uqc';
}
export interface HsnNormalised<T = unknown> {
  /** The same object when nothing changed. */
  json: T;
  changed: boolean;
  fixes: HsnFix[];
  /** Rows the portal will reject that need a person: a unit GSTN doesn't know, or an HSN that isn't 4 to 8 digits. */
  problems: HsnProblem[];
  /** Rows folded into another row with the same HSN, rate and unit. */
  merged: number;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Brings a GSTR-1 JSON's Table 12 to what GSTN accepts: GSTN unit codes, NA
 * and qty 0 on services, OTH on goods with no unit, and one row per HSN +
 * rate + unit within each list (duplicates are summed, as the portal asks:
 * "Please aggregate"). Never moves a row between hsn_b2b and hsn_b2c, never
 * touches any other section. Pure: returns a new object when anything changed.
 */
export function normaliseGstr1Hsn<T>(json: T): HsnNormalised<T> {
  const none: HsnNormalised<T> = { json, changed: false, fixes: [], problems: [], merged: 0 };
  if (!isObj(json) || !isObj(json.hsn)) return none;
  const hsnIn: Obj = json.hsn;

  const fixes: HsnFix[] = [];
  const problems: HsnProblem[] = [];
  let merged = 0;
  let changed = false;
  const nextHsn: Obj = { ...hsnIn };

  for (const table of HSN_TABLES) {
    const rows = hsnIn[table];
    if (!Array.isArray(rows)) continue;
    let tableChanged = false;

    const fixed = rows.map((row: unknown) => {
      if (!isObj(row)) return row;
      const r = { ...row };
      const hsn = String(r.hsn_sc ?? '').trim();
      if (r.hsn_sc !== hsn) { r.hsn_sc = hsn; tableChanged = true; }
      // A row with no usable HSN goes back to a person whole; its unit is settled once the code is.
      if (!isValidHsnCode(hsn)) {
        problems.push({ table, hsn, uqc: String(r.uqc ?? ''), reason: 'hsn' });
        return r;
      }
      const v = classifyUqc(r.uqc, hsn);
      if (v.kind === 'unknown') {
        problems.push({ table, hsn, uqc: v.raw, reason: 'uqc' });
        return r;
      }
      const qtyZeroed = v.kind === 'service' && num(r.qty) !== 0;
      if (qtyZeroed) r.qty = 0;
      if (r.uqc !== v.code || qtyZeroed) {
        fixes.push({ table, hsn, from: r.uqc === null || r.uqc === undefined ? '' : String(r.uqc), to: v.code, qtyZeroed });
        r.uqc = v.code;
        tableChanged = true;
      }
      return r;
    });

    // One row per HSN + rate + unit. Rows still needing a person stay as they are.
    const firstOf = new Map<string, Obj>();
    const out: unknown[] = [];
    let mergedHere = 0;
    for (const r of fixed) {
      // A deletion row (flag 'D') names a portal row to remove; folding it into a
      // live row would delete that row's figures too.
      const deletion = isObj(r) && String(r.flag ?? '').trim().toUpperCase() === 'D';
      if (!isObj(r) || deletion || !isValidHsnCode(r.hsn_sc) || normaliseUqc(r.uqc, r.hsn_sc) !== r.uqc) { out.push(r); continue; }
      const key = `${r.hsn_sc}|${num(r.rt)}|${r.uqc}`;
      const first = firstOf.get(key);
      if (!first) { firstOf.set(key, r); out.push(r); continue; }
      for (const f of SUM_FIELDS) if (f in first || f in r) first[f] = r2(num(first[f]) + num(r[f]));
      for (const f of ['desc', 'user_desc']) {
        if (!String(first[f] ?? '').trim() && String(r[f] ?? '').trim()) first[f] = r[f];
      }
      mergedHere += 1;
    }
    if (mergedHere) {
      let n = 0;
      for (const r of out) if (isObj(r)) r.num = ++n;
      merged += mergedHere;
      tableChanged = true;
    }

    if (tableChanged) { nextHsn[table] = out; changed = true; }
  }

  return changed ? { json: { ...json, hsn: nextHsn } as T, changed, fixes, problems, merged } : { ...none, problems };
}

// ── Words for toasts ────────────────────────────────────────────────────────

const TABLE_WORD: Record<HsnTable, string> = { data: '', hsn_b2b: ' (B2B)', hsn_b2c: ' (B2C)' };
const shown = (s: string) => (s ? `"${s}"` : 'blank');
const listOf = (items: string[], max = 4) =>
  items.slice(0, max).join('; ') + (items.length > max ? `; and ${items.length - max} more` : '');

/** What a person has to fix; `where` names the screen to fix it on. */
export function describeHsnProblems(problems: HsnProblem[], where = 'on the HSN tab (Edit HSN Summary)'): string {
  const items = problems.map((p) => (p.reason === 'hsn'
    ? `HSN ${shown(p.hsn)}${TABLE_WORD[p.table]} is not a 4 to 8 digit code`
    : `HSN ${p.hsn || '(blank)'}${TABLE_WORD[p.table]}: unit ${shown(p.uqc)} is not a GSTN unit, choose one`));
  return `Table 12 (HSN summary) has ${problems.length} row${problems.length === 1 ? '' : 's'} the portal will reject. `
    + `Fix ${problems.length === 1 ? 'it' : 'them'}${where ? ` ${where}` : ''} first: ${listOf(items)}.`;
}

/** "Table 12 corrected for the portal: …" — what was changed automatically. */
export function describeHsnFixes(r: Pick<HsnNormalised, 'fixes' | 'merged'>): string {
  const items = r.fixes.map((f) => {
    const what = f.to !== SERVICE_UQC ? `unit ${shown(f.from)} → ${f.to}`
      : f.from === SERVICE_UQC ? 'quantity → 0 (a service carries none)'
        : `unit ${shown(f.from)} → NA (service${f.qtyZeroed ? ', quantity → 0' : ''})`;
    return `HSN ${f.hsn}${TABLE_WORD[f.table]} ${what}`;
  });
  const parts: string[] = [];
  if (items.length) parts.push(listOf(items));
  if (r.merged) parts.push(`${r.merged} duplicate row${r.merged === 1 ? '' : 's'} with the same HSN, rate and unit summed into one`);
  return parts.length ? `Table 12 corrected for the portal: ${parts.join('. ')}.` : 'Table 12 tidied for the portal.';
}
