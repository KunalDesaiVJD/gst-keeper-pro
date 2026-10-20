/**
 * Which GSTR-3B Table 3.1 row a GSTR-1 document belongs to.
 *
 * Form GSTR-3B and s.16 IGST Act (docs/GSTR3B_OUTWARD_POSITIONS.md):
 *   3.1(a) outward taxable supplies other than zero rated, nil rated and
 *          exempted: regular B2B (R), deemed exports (DE), intra-state supplies
 *          attracting IGST (CBW), B2CL, B2CS, advances, and their notes;
 *   3.1(b) zero rated supplies: exports (exp, WPAY and WOPAY) and supplies to
 *          an SEZ unit or developer (SEWP, SEWOP), and their notes.
 * Supplies to an SEZ are inter-state under s.7(5)(b) IGST Act wherever the
 * SEZ is, so they never sit in 3.1(a) or in Table 3.2.
 *
 * GSTR-1 JSON codes: b2b[].inv[].inv_typ and cdnr[].nt[].inv_typ are R, SEWP,
 * SEWOP, DE or CBW (blank is R); cdnur[].typ is B2CL, EXPWP or EXPWOP;
 * exp[].exp_typ is WPAY or WOPAY.
 *
 * Shared by buildGstr3bJson (3.1, 3.2) and advanceSetoffCheck, so the two
 * cannot sort a document differently.
 */

export type Outward31Row = '3.1(a)' | '3.1(b)';

type Doc = { inv_typ?: unknown; typ?: unknown; ntty?: unknown } | null | undefined;

const code = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim().toUpperCase();

/** A B2B invoice's or a registered note's type; blank is R (regular). */
export const invType = (doc: Doc): string => code(doc?.inv_typ) || 'R';

/** Supply to an SEZ unit or developer, with (SEWP) or without (SEWOP) payment of IGST. */
export const isSezInvType = (t: string): boolean => t === 'SEWP' || t === 'SEWOP';

/** An unregistered note against an export (cdnur typ EXPWP / EXPWOP). */
export const isExportNoteType = (t: string): boolean => t === 'EXPWP' || t === 'EXPWOP';

/** b2b invoice, or cdnr note (they carry the same inv_typ): SEZ to 3.1(b), the rest to 3.1(a). */
export const b2bRow = (doc: Doc): Outward31Row => (isSezInvType(invType(doc)) ? '3.1(b)' : '3.1(a)');

/** cdnur note: against an export to 3.1(b); B2CL to 3.1(a). */
export const cdnurRow = (doc: Doc): Outward31Row => (isExportNoteType(code(doc?.typ)) ? '3.1(b)' : '3.1(a)');

/**
 * +1 for a debit note, -1 for a credit note (or an old refund voucher).
 * The note type is `ntty`. Some older cdnr exports had it in `typ`, so cdnr
 * falls back to `typ`; on cdnur `typ` is B2CL / EXPWP / EXPWOP, never the
 * note type, so it is not read there. Neither present: a credit note.
 */
export const noteSign = (nt: Doc, section: 'cdnr' | 'cdnur'): 1 | -1 => {
  const t = code(nt?.ntty) || (section === 'cdnr' ? code(nt?.typ) : '') || 'C';
  return t.startsWith('D') ? 1 : -1;
};

/** GSTN's UIN format (UN bodies, embassies and other notified persons). */
export const UIN_PATTERN = /^\d{4}[A-Z]{3}\d{5}[UO]N[A-Z0-9]$/;
export const isUin = (ctin: unknown): boolean => UIN_PATTERN.test(code(ctin));
