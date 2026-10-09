/**
 * GSTR-1 rules beyond Table 12, checked before a JSON leaves the app.
 *
 * The portal reports most of these as a whole-file "File could not be
 * uploaded!" or as a 'Processed with Error' upload whose reasons the app
 * rarely captures, so a fault found here is a fault the firm would otherwise
 * learn about one portal round-trip later with no hint which document it was.
 *
 * Only rules GSTN is known to enforce block the push (problems). They are the
 * GSTN Returns Offline Tool 3.2.4 checks, which the portal mirrors: document
 * number and date shapes, the POS and rate lists, the recipient GSTIN with its
 * checksum, the code lists (inv_typ, ntty, cdnur typ, exp_typ, nil sply_ty),
 * the shipping bill fields, B2CS typ and sply_ty, the B2CL threshold and POS,
 * Table 13 series, and the IGST vs CGST+SGST split. Anything the portal is
 * merely likely to dislike is a warning.
 *
 * Every rule was swept over every stored gstr1_data.raw_json and every
 * accepted upload payload: a return the portal accepted produces no problem.
 *
 * A deletion entry (flag 'D', as in the offline tool's or the accounting
 * software's '<GSTIN>_GSTR1(Delete)_…' file) only names the document the
 * portal is to remove, so only what identifies it is checked: the recipient
 * GSTIN where the section has one, the number and the date.
 *
 * Table 12 units and repeats are normaliseGstr1Hsn's (./uqc.ts); nothing here
 * touches them.
 */

export interface Gstr1Issue {
  /** The JSON section ('b2b', 'cdnr', 'doc_issue', 'hsn', ...), or 'file' for the header. */
  section: string;
  /** The document: invoice or note number, or what identifies a summary row. */
  ref: string;
  /** Stable code of the broken rule, e.g. 'pos', 'ctin', 'tax-split'. */
  rule: string;
  /** What is wrong and what to do, in plain words. */
  message: string;
}
export interface Gstr1Check { problems: Gstr1Issue[]; warnings: Gstr1Issue[] }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const shown = (s: string) => (s ? `"${s}"` : 'blank');

// ── Reference lists ─────────────────────────────────────────────────────────

const RATES = new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40]);
const INV_TYPES = new Set(['R', 'SEWP', 'SEWOP', 'DE', 'CBW']);
/** Inter-state by definition (SEZ supplies, and CBW = intra-state supplies attracting IGST). */
const IGST_ONLY_TYPES = new Set(['SEWP', 'SEWOP', 'CBW']);
const CDNUR_TYPES = new Set(['B2CL', 'EXPWP', 'EXPWOP']);
const NIL_TYPES = new Set(['INTRB2B', 'INTRAB2B', 'INTRB2C', 'INTRAB2C']);
/** Rs 1 lakh since Aug-2024 (Notification 12/2024); B2CL is invoice value above it. */
const B2CL_MIN_VALUE = 100000;

/**
 * GSTR-1 places of supply: the offline tool's state list (01-38 without 28,
 * which is pre-2014 Andhra Pradesh) plus 97 Other Territory. 96 Foreign
 * Country exists only on b2b and cdnr (and their amendments). 99 is Centre
 * Jurisdiction, a registration code, never a POS.
 */
const posAllowed = (pos: string, foreign: boolean): boolean => {
  if (!/^\d{2}$/.test(pos)) return false;
  const n = Number(pos);
  return (n >= 1 && n <= 38 && n !== 28) || n === 97 || (foreign && n === 96);
};

// ── Recipient GSTIN ─────────────────────────────────────────────────────────

/**
 * The four recipient formats the offline tool takes on GSTR-1: a regular
 * GSTIN (14th character Z, or 1-9 / A-J), a UN body's UIN, a TDS deductor's
 * id and a non-resident taxable person's id. All four carry the same mod-36
 * check character.
 */
const RECIPIENT_FORMATS = [
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][Z1-9A-J][0-9A-Z]$/,
  /^[0-9]{4}[A-Z]{3}[0-9]{5}[UO]N[0-9A-Z]$/,
  /^[0-9]{2}[A-Z]{4}[0-9A-Z][0-9]{4}[A-Z][1-9A-Z]D[0-9A-Z]$/,
  /^[0-9]{4}[A-Z]{3}[0-9]{5}NR[0-9A-Z]$/,
];
const CODE_POINTS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character GSTN derives from the first 14 (factors 1,2,1,2… from the left, digits of base 36 summed). */
const gstinCheckChar = (first14: string): string => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = CODE_POINTS.indexOf(first14[i]) * (i % 2 === 1 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CODE_POINTS[(36 - (sum % 36)) % 36];
};

const recipientGstinIssue = (ctin: unknown, ownGstin?: string): { rule: 'ctin' | 'ctin-own'; message: string } | null => {
  const raw = str(ctin);
  const g = raw.toUpperCase();
  if (!g.trim()) return { rule: 'ctin', message: 'has no recipient GSTIN; enter it, or move the invoice to B2CS/B2CL if the buyer is unregistered' };
  if (!RECIPIENT_FORMATS.some((re) => re.test(g))) {
    return { rule: 'ctin', message: `recipient GSTIN ${shown(raw)} is not a 15 character GSTIN or UIN; check it for a missing or extra character` };
  }
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) {
    return { rule: 'ctin', message: `recipient GSTIN ${raw} fails the GSTIN check digit, so a character is mistyped; copy it again from the buyer's invoice or the GST portal` };
  }
  if (ownGstin && g === ownGstin.trim().toUpperCase()) {
    return { rule: 'ctin-own', message: `recipient GSTIN ${raw} is the client's own GSTIN; a supply to yourself is not reported in GSTR-1, so correct the recipient` };
  }
  return null;
};

/**
 * Why a recipient GSTIN/UIN would be rejected, or null when it is fine. Its
 * own export so the manual entry grid can point at the row rather than the
 * assembled document.
 */
export function checkRecipientGstin(ctin: unknown, ownGstin?: string): string | null {
  return recipientGstinIssue(ctin, ownGstin)?.message ?? null;
}

// ── Periods and dates ───────────────────────────────────────────────────────

interface Period { mm: number; yyyy: number }
const periodOfFp = (fp: string): Period | null => {
  const m = /^(0[1-9]|1[0-2])(\d{4})$/.exec(fp);
  return m ? { mm: Number(m[1]), yyyy: Number(m[2]) } : null;
};
const periodOfMmYyyy = (p: string | undefined): Period | null => {
  const m = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(str(p).trim());
  return m ? { mm: Number(m[1]), yyyy: Number(m[2]) } : null;
};
const daysIn = (yyyy: number, mm: number) => new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
const pad2 = (n: number) => String(n).padStart(2, '0');
/** dd-mm-yyyy as a sortable yyyymmdd number, or null when it is not a real date in that shape. */
const dateKey = (d: string): number | null => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  if (!m) return null;
  const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mm < 1 || mm > 12 || dd < 1 || dd > daysIn(yyyy, mm)) return null;
  return yyyy * 10000 + mm * 100 + dd;
};

// ── Words ───────────────────────────────────────────────────────────────────

const SECTION_WORD: Record<string, string> = {
  file: 'The file',
  b2b: 'B2B invoice',
  b2ba: 'Amended B2B invoice',
  b2cl: 'B2CL invoice',
  b2cs: 'B2CS',
  b2csa: 'Amended B2CS',
  cdnr: 'Credit/debit note',
  cdnra: 'Amended credit/debit note',
  cdnur: 'Unregistered credit/debit note',
  exp: 'Export invoice',
  at: 'Advance received (11A)',
  txpd: 'Advance adjusted (11B)',
  ata: 'Amended advance received',
  txpda: 'Amended advance adjusted',
  nil: 'Nil/exempt (Table 8)',
  doc_issue: 'Documents issued (Table 13)',
  hsn: 'HSN summary (Table 12)',
};
const WARNING_RULES = new Set(['value', 'hsn-digits', 'empty']);
const listOf = (items: string[], max = 4) =>
  items.slice(0, max).join('; ') + (items.length > max ? `; and ${items.length - max} more` : '');

/**
 * Plain words for a toast: each entry names its section, document and fix.
 * Problems are introduced as rejections; a list of warnings only as checks.
 */
export function describeGstr1Issues(issues: Gstr1Issue[], where?: string): string {
  const n = issues.length;
  if (!n) return '';
  // A file-level message continues "The file …"; every other one follows its document after a colon.
  const items = issues.map((i) => `${SECTION_WORD[i.section] ?? i.section}${i.ref ? ` ${i.ref}` : ''}${i.section === 'file' ? ' ' : ': '}${i.message}`);
  const at = where ? ` ${where}` : '';
  if (issues.every((i) => WARNING_RULES.has(i.rule))) {
    return `${n} point${n === 1 ? '' : 's'} in this GSTR-1 to check${at}: ${listOf(items)}.`;
  }
  return `This GSTR-1 has ${n} entr${n === 1 ? 'y' : 'ies'} the portal will reject. `
    + `Fix ${n === 1 ? 'it' : 'them'}${at} first: ${listOf(items)}.`;
}

// ── The check ───────────────────────────────────────────────────────────────

/** The sections that make a return non-empty for the portal ("No section data"). */
const DATA_SECTIONS = [
  'b2b', 'b2ba', 'b2cl', 'b2cla', 'b2cs', 'b2csa', 'cdnr', 'cdnra', 'cdnur', 'cdnura', 'exp', 'expa',
  'at', 'ata', 'txpd', 'txpda', 'nil', 'hsn', 'doc_issue', 'supeco', 'supecoa',
];
const hasData = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : isObj(v) && Object.values(v).some(hasData));
/** False for a file the portal rejects as "No section data" (the empty-return rule below). */
export const gstr1HasSectionData = (json: unknown): boolean => isObj(json) && DATA_SECTIONS.some((k) => hasData(json[k]));

/**
 * Checks a GSTR-1 JSON against the portal's rules. `period` is MM/YYYY; the
 * file's own fp stands in when it is not given. `nil`, when the caller knows
 * whether the period is NIL, means it handles an empty file itself, so the
 * empty-return warning is left out. Pure: never changes the JSON.
 */
export function validateGstr1Json(
  json: unknown,
  opts: { gstin?: string; period?: string /* MM/YYYY */; aatoAbove5Cr?: boolean; nil?: boolean },
): Gstr1Check {
  const problems: Gstr1Issue[] = [];
  const warnings: Gstr1Issue[] = [];
  const problem = (section: string, ref: string, rule: string, message: string) => problems.push({ section, ref, rule, message });
  const warn = (section: string, ref: string, rule: string, message: string) => warnings.push({ section, ref, rule, message });
  if (!isObj(json)) {
    problem('file', '', 'file', 'is not a GSTR-1 JSON; import the file again');
    return { problems, warnings };
  }
  const j = json;

  // ── Header ──
  const fp = str(j.fp).trim();
  const asked = periodOfMmYyyy(opts.period);
  const period = asked ?? periodOfFp(fp);
  if (asked) {
    const want = `${pad2(asked.mm)}${asked.yyyy}`;
    if (fp !== want) {
      problem('file', '', 'fp', `has return period (fp) ${shown(fp)}, not ${want}, which the portal rejects as "GSTIN or Return period mismatch"; `
        + 'export it again for this month (a quarterly export carries the quarter\'s last month)');
    }
  }
  const fileGstin = str(j.gstin).trim().toUpperCase();
  const own = str(opts.gstin).trim().toUpperCase();
  if (own && fileGstin !== own) {
    problem('file', '', 'gstin', `belongs to GSTIN ${shown(str(j.gstin))}, not the client's ${own}; import the file exported for this client`);
  }
  const home = (fileGstin || own).slice(0, 2);
  const periodEnd = period ? period.yyyy * 10000 + period.mm * 100 + daysIn(period.yyyy, period.mm) : null;
  const periodEndText = period ? `${pad2(daysIn(period.yyyy, period.mm))}-${pad2(period.mm)}-${period.yyyy}` : '';

  // ── Shared field checks ──
  const docNumber = (section: string, ref: string, value: unknown, what: string) => {
    const s = str(value);
    if (!/^[A-Za-z0-9/-]{1,16}$/.test(s)) {
      problem(section, ref, 'doc-number', s
        ? `${what} number ${shown(s)} must be 1 to 16 letters, digits, / or - (no spaces or other symbols); shorten or correct it to match the document`
        : `has no ${what} number; enter it`);
    } else if (Number(s) === 0) {
      problem(section, ref, 'doc-number', `${what} number ${shown(s)} is zero, which the portal does not accept; enter the real number`);
    }
  };
  const docDate = (section: string, ref: string, value: unknown, what: string) => {
    const s = str(value);
    const key = dateKey(s);
    if (key === null) {
      problem(section, ref, 'date', s ? `${what} date ${shown(s)} is not a real dd-mm-yyyy date; correct it` : `has no ${what} date; enter it`);
    } else if (periodEnd !== null && key > periodEnd) {
      problem(section, ref, 'date', `${what} date ${s} is after the return period (which ends ${periodEndText}); report it in the month it was issued`);
    }
  };
  const placeOfSupply = (section: string, ref: string, value: unknown, foreign: boolean): string | null => {
    const p = str(value).trim();
    if (posAllowed(p, foreign)) return p;
    const hint = p === '99' ? '99 is Centre Jurisdiction, not a place of supply'
      : p === '96' ? '96 (foreign country) is allowed only on B2B invoices and credit/debit notes to registered persons'
        : p === '28' ? '28 is the old Andhra Pradesh code, use 37'
          : 'it must be a two-digit state code';
    problem(section, ref, 'pos', p
      ? `place of supply ${shown(p)} is not valid (${hint}); choose the recipient's state, 01 to 38 or 97 for Other Territory`
      : 'has no place of supply; choose the recipient\'s state');
    return null;
  };
  const rate = (section: string, ref: string, value: unknown) => {
    const n = Number(value);
    if (str(value).trim() === '' || !Number.isFinite(n) || !RATES.has(n)) {
      problem(section, ref, 'rate', `rate ${shown(str(value))}% is not a GST rate; use one of 0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28 or 40`);
    }
  };
  const ZERO = 0.005; // tax amounts are 2 dp; anything smaller is float noise
  /** pos equal to home: no IGST; different: no CGST/SGST. SEZ and CBW: IGST only. */
  const taxSplit = (section: string, ref: string, invTyp: string, pos: string | null, lines: Obj[]) => {
    const igstOnly = IGST_ONLY_TYPES.has(invTyp);
    if (!igstOnly && !(invTyp === 'R' || invTyp === 'DE')) return;
    if (!igstOnly && (!pos || !home)) return;
    const intra = !igstOnly && pos === home;
    const wrong = lines.some((d) => (intra ? Math.abs(num(d.iamt)) > ZERO : Math.abs(num(d.camt)) > ZERO || Math.abs(num(d.samt)) > ZERO));
    if (!wrong) return;
    problem(section, ref, 'tax-split', igstOnly
      ? `a ${invTyp === 'CBW' ? 'CBW' : 'SEZ'} supply carries IGST only, but CGST/SGST is filled; move the tax to IGST`
      : intra
        ? `place of supply ${pos} is the client's own state, so the tax is CGST + SGST, but IGST is filled; move it to CGST and SGST in equal halves (or mark the invoice CBW if IGST is right)`
        : `place of supply ${pos} is another state, so the tax is IGST, but CGST/SGST is filled; move it to IGST`);
  };
  const valueCheck = (section: string, ref: string, val: unknown, lines: Obj[], rchrg: string) => {
    const txval = lines.reduce((s, d) => s + num(d.txval), 0);
    const full = lines.reduce((s, d) => s + num(d.txval) + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt), 0);
    const v = num(val);
    if (Math.abs(v - full) <= 1) return;
    // Under reverse charge the supplier's document value is the taxable value; the portal takes it.
    if (rchrg === 'Y' && Math.abs(v - txval) <= 1) return;
    warn(section, ref, 'value', `value ${v.toFixed(2)} differs from taxable value + tax ${full.toFixed(2)}; check the document value`);
  };
  const itemDetails = (itms: unknown): Obj[] => objs(itms).map((i) => (isObj(i.itm_det) ? i.itm_det : i));
  /** A document the file asks the portal to delete: it carries no POS, type, rate or value. */
  const isDeletion = (o: Obj) => str(o.flag).trim().toUpperCase() === 'D';

  // ── B2B and its amendments ──
  for (const section of ['b2b', 'b2ba'] as const) {
    for (const party of objs(j[section])) {
      const gstinWhy = recipientGstinIssue(party.ctin, own || fileGstin);
      for (const inv of objs(party.inv)) {
        const ref = str(inv.inum) || '(no number)';
        if (gstinWhy) problem(section, ref, gstinWhy.rule, gstinWhy.message);
        docNumber(section, ref, inv.inum, 'invoice');
        docDate(section, ref, inv.idt, 'invoice');
        if (isDeletion(inv)) continue;
        const pos = placeOfSupply(section, ref, inv.pos, true);
        const invTyp = str(inv.inv_typ);
        if (!INV_TYPES.has(invTyp)) {
          problem(section, ref, 'inv-typ', `invoice type ${shown(invTyp)} is not one of R (regular), SEWP / SEWOP (SEZ with / without payment), DE (deemed export) or CBW; choose one`);
        }
        const rchrg = str(inv.rchrg);
        if (rchrg !== 'Y' && rchrg !== 'N') problem(section, ref, 'rchrg', `reverse charge ${shown(rchrg)} must be Y or N; choose one`);
        const lines = itemDetails(inv.itms);
        lines.forEach((d) => rate(section, ref, d.rt));
        taxSplit(section, ref, invTyp, pos, lines);
        valueCheck(section, ref, inv.val, lines, rchrg);
      }
    }
  }

  // ── CDNR and its amendments ──
  for (const section of ['cdnr', 'cdnra'] as const) {
    for (const party of objs(j[section])) {
      const gstinWhy = recipientGstinIssue(party.ctin, own || fileGstin);
      for (const nt of objs(party.nt)) {
        const ref = str(nt.nt_num) || '(no number)';
        if (gstinWhy) problem(section, ref, gstinWhy.rule, gstinWhy.message);
        docNumber(section, ref, nt.nt_num, 'note');
        docDate(section, ref, nt.nt_dt, 'note');
        if (isDeletion(nt)) continue;
        const ntty = str(nt.ntty);
        if (ntty !== 'C' && ntty !== 'D') problem(section, ref, 'note-type', `note type ${shown(ntty)} must be C (credit) or D (debit); choose one`);
        const pos = placeOfSupply(section, ref, nt.pos, true);
        const rchrg = str(nt.rchrg);
        if (rchrg !== 'Y' && rchrg !== 'N') problem(section, ref, 'rchrg', `reverse charge ${shown(rchrg)} must be Y or N; set it (N unless the supply was under reverse charge)`);
        const invTyp = str(nt.inv_typ);
        if (!INV_TYPES.has(invTyp)) {
          problem(section, ref, 'inv-typ', `note supply type ${shown(invTyp)} is not one of R (regular), SEWP / SEWOP (SEZ), DE (deemed export) or CBW; set it (R for a regular supply)`);
        }
        const lines = itemDetails(nt.itms);
        lines.forEach((d) => rate(section, ref, d.rt));
        taxSplit(section, ref, invTyp, pos, lines);
        valueCheck(section, ref, nt.val, lines, rchrg);
      }
    }
  }

  // ── B2CL ──
  for (const group of objs(j.b2cl)) {
    for (const inv of objs(group.inv)) {
      const ref = str(inv.inum) || '(no number)';
      docNumber('b2cl', ref, inv.inum, 'invoice');
      docDate('b2cl', ref, inv.idt, 'invoice');
      if (isDeletion(inv)) continue;
      const pos = placeOfSupply('b2cl', ref, group.pos, false);
      if (pos && home && pos === home) {
        problem('b2cl', ref, 'b2cl-pos', `place of supply ${pos} is the client's own state; B2CL is only for inter-state sales, so report it in B2CS`);
      }
      if (num(inv.val) <= B2CL_MIN_VALUE) {
        problem('b2cl', ref, 'b2cl-value', `invoice value ${num(inv.val).toFixed(2)} is not above Rs 1,00,000; B2CL takes only larger inter-state invoices, so report it in B2CS`);
      }
      const lines = itemDetails(inv.itms);
      lines.forEach((d) => rate('b2cl', ref, d.rt));
      valueCheck('b2cl', ref, inv.val, lines, 'N');
    }
  }

  // ── CDNUR ──
  for (const nt of objs(j.cdnur)) {
    const ref = str(nt.nt_num) || '(no number)';
    docNumber('cdnur', ref, nt.nt_num, 'note');
    docDate('cdnur', ref, nt.nt_dt, 'note');
    if (isDeletion(nt)) continue;
    const ntty = str(nt.ntty);
    if (ntty !== 'C' && ntty !== 'D') problem('cdnur', ref, 'note-type', `note type ${shown(ntty)} must be C (credit) or D (debit); choose one`);
    const typ = str(nt.typ);
    if (!CDNUR_TYPES.has(typ)) {
      problem('cdnur', ref, 'cdnur-typ', `type ${shown(typ)} must be B2CL (a large inter-state sale), EXPWP or EXPWOP (an export with / without payment); choose one`);
    } else if (typ === 'B2CL') {
      // Export notes carry no POS; a B2CL note is inter-state like the invoice it follows.
      const pos = placeOfSupply('cdnur', ref, nt.pos, false);
      if (pos && home && pos === home) {
        problem('cdnur', ref, 'b2cl-pos', `place of supply ${pos} is the client's own state; a B2CL note is only for inter-state sales, so check the place of supply`);
      }
    }
    const lines = itemDetails(nt.itms);
    lines.forEach((d) => rate('cdnur', ref, d.rt));
    valueCheck('cdnur', ref, nt.val, lines, 'N');
  }

  // ── Exports ──
  for (const group of objs(j.exp)) {
    const expTyp = str(group.exp_typ);
    for (const inv of objs(group.inv)) {
      const ref = str(inv.inum) || '(no number)';
      const deletion = isDeletion(inv);
      if (!deletion && expTyp !== 'WPAY' && expTyp !== 'WOPAY') {
        problem('exp', ref, 'exp-typ', `export type ${shown(expTyp)} must be WPAY (with payment of tax) or WOPAY (without); choose one`);
      }
      docNumber('exp', ref, inv.inum, 'invoice');
      docDate('exp', ref, inv.idt, 'invoice');
      if (deletion) continue;
      const port = str(inv.sbpcode).trim();
      if (port && !/^[A-Za-z0-9]{6}$/.test(port)) {
        problem('exp', ref, 'port-code', `port code ${shown(port)} must be the 6 character code on the shipping bill (e.g. INAMD4); correct it or leave it blank`);
      }
      const sbnum = str(inv.sbnum).trim();
      const sbdt = str(inv.sbdt).trim();
      if (sbnum && !/^\d{3,7}$/.test(sbnum)) {
        problem('exp', ref, 'shipping-bill', `shipping bill number ${shown(sbnum)} must be 3 to 7 digits; correct it or leave it blank`);
      }
      if (sbdt && dateKey(sbdt) === null) {
        problem('exp', ref, 'shipping-bill', `shipping bill date ${shown(sbdt)} is not a real dd-mm-yyyy date; correct it or leave it blank`);
      }
      if (!!sbnum !== !!sbdt) {
        problem('exp', ref, 'shipping-bill', `has a shipping bill ${sbnum ? 'number but no date' : 'date but no number'}; give both, or neither until the bill is issued`);
      }
      const lines = itemDetails(inv.itms);
      lines.forEach((d) => rate('exp', ref, d.rt));
      valueCheck('exp', ref, inv.val, lines, 'N');
    }
  }

  // ── B2CS, and its amendments in either shape (flat rows, or itms[] as the portal writes them) ──
  const b2csRow = (section: 'b2cs' | 'b2csa', r: Obj, lines: Obj[]) => {
    const p = str(r.pos).trim();
    const ref = `${section === 'b2csa' && str(r.omon) ? `${str(r.omon)} ` : ''}POS ${p || '(blank)'}${lines.length === 1 ? ` at ${str(lines[0].rt)}%` : ''}`;
    const pos = placeOfSupply(section, ref, r.pos, false);
    const typ = str(r.typ);
    if (!(typ === 'OE' || (typ === 'E' && str(r.etin).trim()))) {
      problem(section, ref, 'b2cs-typ', typ === 'E'
        ? 'type E (through an e-commerce operator) needs the operator\'s GSTIN; report e-commerce supplies in Table 14, or use OE'
        : `type ${shown(typ)} must be OE (own supply); set it`);
    }
    if (pos && home) {
      const want = pos === home ? 'INTRA' : 'INTER';
      if (str(r.sply_ty) !== want) {
        problem(section, ref, 'sply-ty', `supply type ${shown(str(r.sply_ty))} must be ${want}, since the place of supply ${pos} is ${want === 'INTRA' ? 'the client\'s own state' : 'another state'}; correct it`);
      }
    }
    lines.forEach((d) => rate(section, ref, d.rt));
  };
  for (const r of objs(j.b2cs)) b2csRow('b2cs', r, [r]);
  for (const r of objs(j.b2csa)) b2csRow('b2csa', r, Array.isArray(r.itms) ? objs(r.itms) : [r]);

  // ── Advances (11A / 11B and their amendments): POS and rates ──
  for (const section of ['at', 'txpd', 'ata', 'txpda'] as const) {
    for (const g of objs(j[section])) {
      const ref = `${str(g.omon) ? `${str(g.omon)} ` : ''}POS ${str(g.pos).trim() || '(blank)'}`;
      placeOfSupply(section, ref, g.pos, false);
      (Array.isArray(g.itms) ? objs(g.itms) : [g]).forEach((d) => rate(section, ref, d.rt));
    }
  }

  // ── Table 8 ──
  objs(isObj(j.nil) ? j.nil.inv : undefined).forEach((r, i) => {
    const t = str(r.sply_ty);
    if (!NIL_TYPES.has(t)) {
      problem('nil', t || `row ${i + 1}`, 'nil-type', `supply type ${shown(t)} must be one of INTRB2B, INTRAB2B, INTRB2C or INTRAB2C (inter/intra-state, to registered/unregistered); choose one`);
    }
  });

  // ── Table 13 ──
  const seenDocNums = new Set<number>();
  for (const det of objs(isObj(j.doc_issue) ? j.doc_issue.doc_det : undefined)) {
    const n = Number(det.doc_num);
    const label = `type ${str(det.doc_num) || '(blank)'}`;
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      problem('doc_issue', label, 'doc-num', `document type number ${shown(str(det.doc_num))} must be 1 to 12; choose the document type again`);
    } else if (seenDocNums.has(n)) {
      problem('doc_issue', label, 'doc-num', 'this document type appears twice; put both series under one entry (the app does this when it tidies the file)');
    } else {
      seenDocNums.add(n);
    }
    for (const d of objs(det.docs)) {
      const from = str(d.from).trim();
      const to = str(d.to).trim();
      const ref = from || to ? `${from || '(blank)'} to ${to || '(blank)'}` : label;
      if (!from || !to) problem('doc_issue', ref, 'doc-range', 'needs both the first (From) and last (To) document number of the series; enter them');
      if (num(d.cancel) > num(d.totnum)) {
        problem('doc_issue', ref, 'doc-cancel', `${num(d.cancel)} cancelled is more than the ${num(d.totnum)} issued; correct the counts`);
      }
    }
  }

  // ── Table 12: rates, and HSN length by turnover ──
  if (isObj(j.hsn)) {
    for (const list of ['data', 'hsn_b2b', 'hsn_b2c']) {
      for (const h of objs(j.hsn[list])) {
        const code = str(h.hsn_sc).trim();
        const ref = `HSN ${code || '(blank)'}`;
        rate('hsn', ref, h.rt);
        if (opts.aatoAbove5Cr && /^\d{4,5}$/.test(code)) {
          warn('hsn', ref, 'hsn-digits', 'the client\'s turnover is above Rs 5 crore, so GSTN wants at least 6 digits (RET191350); use the 6 or 8 digit code');
        }
      }
    }
  }

  // ── An empty return ──
  if (opts.nil === undefined && !DATA_SECTIONS.some((k) => hasData(j[k]))) {
    warn('file', '', 'empty', 'has no section data, which the portal rejects ("No section data"); if the period is NIL, use Push NIL instead of uploading');
  }

  return { problems, warnings };
}

// ── Tidy: corrections with one right answer ─────────────────────────────────

/**
 * Corrects what has exactly one right answer, before a check or a push:
 *  - blank sbpcode / sbnum / sbdt on export invoices are left out (the portal
 *    validates them when present, and an offline-tool export omits them);
 *  - net_issue is totnum - cancel;
 *  - Table 13 series of the same document type are one doc_det, docs 1..n;
 *  - a Builder Table 12 in the old single hsn.data list goes to hsn_b2c for
 *    periods from 05-2025, when GSTN split the table (Builder supplies are
 *    all Table 7 B2CS). `builder` comes from the stored file_name
 *    (isBuilderGenerated), never from inside the JSON.
 * Never touches Table 12 units (normaliseGstr1Hsn does) or any figure. Pure:
 * returns the same object when nothing changed.
 */
export function tidyGstr1Json<T>(json: T, opts: { builder?: boolean } = {}): { json: T; changed: boolean; notes: string[] } {
  if (!isObj(json)) return { json, changed: false, notes: [] };
  const notes: string[] = [];
  const out: Obj = { ...json };
  let changed = false;

  // Exports: blank shipping bill fields.
  if (Array.isArray(json.exp)) {
    let touched = 0;
    const exp = json.exp.map((g) => {
      if (!isObj(g) || !Array.isArray(g.inv)) return g;
      let groupChanged = false;
      const inv = g.inv.map((i) => {
        if (!isObj(i)) return i;
        const blanks = ['sbpcode', 'sbnum', 'sbdt'].filter((k) => k in i && !str(i[k]).trim());
        if (!blanks.length) return i;
        const next = { ...i };
        blanks.forEach((k) => delete next[k]);
        touched += 1;
        groupChanged = true;
        return next;
      });
      return groupChanged ? { ...g, inv } : g;
    });
    if (touched) {
      out.exp = exp;
      changed = true;
      notes.push(`Exports: blank shipping bill fields left out on ${touched} invoice${touched === 1 ? '' : 's'}; the portal takes them only when filled.`);
    }
  }

  // Table 13: one entry per document type, docs numbered 1..n, net_issue = totnum - cancel.
  if (isObj(json.doc_issue) && Array.isArray(json.doc_issue.doc_det)) {
    const dets = json.doc_issue.doc_det;
    const grouped: unknown[] = [];
    const byNum = new Map<string, Obj>();
    let mergedTypes = 0;
    let renumbered = 0;
    let netFixed = 0;
    for (const det of dets) {
      const key = isObj(det) ? str(det.doc_num).trim() : '';
      if (!isObj(det) || !key) { grouped.push(det); continue; }
      const first = byNum.get(key);
      if (!first) {
        const copy = { ...det, docs: Array.isArray(det.docs) ? [...det.docs] : det.docs };
        byNum.set(key, copy);
        grouped.push(copy);
        continue;
      }
      first.docs = [...(Array.isArray(first.docs) ? first.docs : []), ...(Array.isArray(det.docs) ? det.docs : [])];
      if (!str(first.doc_typ).trim() && str(det.doc_typ).trim()) first.doc_typ = det.doc_typ;
      mergedTypes += 1;
    }
    const doc_det = grouped.map((det) => {
      if (!isObj(det) || !Array.isArray(det.docs)) return det;
      let detChanged = false;
      let n = 0;
      const docs = det.docs.map((d) => {
        if (!isObj(d)) return d;
        n += 1;
        const net = num(d.totnum) - num(d.cancel);
        const renumber = d.num !== n;
        const renet = ('totnum' in d || 'cancel' in d) && d.net_issue !== net;
        if (!renumber && !renet) return d;
        if (renumber) renumbered += 1;
        if (renet) netFixed += 1;
        detChanged = true;
        return { ...d, ...(renumber ? { num: n } : {}), ...(renet ? { net_issue: net } : {}) };
      });
      return detChanged ? { ...det, docs } : det;
    });
    if (mergedTypes || renumbered || netFixed) {
      out.doc_issue = { ...json.doc_issue, doc_det };
      changed = true;
      if (mergedTypes) notes.push(`Documents issued: ${mergedTypes} repeated document type${mergedTypes === 1 ? '' : 's'} grouped, one entry per type with its series numbered 1, 2, …`);
      else if (renumbered) notes.push('Documents issued: series renumbered 1, 2, … within each document type.');
      if (netFixed) notes.push(`Documents issued: net issued set to total less cancelled on ${netFixed} series.`);
    }
  }

  // Table 12: a Builder hsn.data list in the period GSTN wants hsn_b2c.
  const p = periodOfFp(str(json.fp).trim());
  const hsn = json.hsn;
  if (opts.builder && p && p.yyyy * 12 + p.mm >= 2025 * 12 + 5 && isObj(hsn) && Array.isArray(hsn.data) && hsn.data.length) {
    const { data, ...rest } = hsn;
    const b2c = [...(Array.isArray(rest.hsn_b2c) ? rest.hsn_b2c : []), ...data]
      .map((h, i) => (isObj(h) && h.num !== i + 1 ? { ...h, num: i + 1 } : h));
    out.hsn = { ...rest, hsn_b2c: b2c };
    changed = true;
    notes.push('Table 12 moved to the B2C list (hsn_b2c), the shape GSTN asks for from May 2025: every Builder supply is Table 7 B2CS.');
  }

  return changed ? { json: out as T, changed, notes } : { json, changed: false, notes };
}
