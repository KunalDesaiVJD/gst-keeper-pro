// The words of the Vendor GSTIN Risk Report: one entry per finding the
// engine can make, with its risk band, whether it is a confirmed fact, a
// potential risk or a point to verify, the provision it rests on and what to
// do. Pure data. Every band and every threshold here is the firm's elected
// position (docs/VENDOR_GSTIN_RISK.md §4), not settled law: change it there
// first. Nothing here calls a vendor non-compliant because data is missing.

export type RiskBand = 'Critical' | 'High' | 'Medium' | 'Low' | 'No Data';
/** Confirmed: a portal record or the GSTIN itself shows it. Potential: the evidence points to it. Verify: not enough data to say. */
export type RiskNature = 'Confirmed' | 'Potential risk' | 'Verification required';

export const BAND_ORDER: RiskBand[] = ['Critical', 'High', 'Medium', 'Low', 'No Data'];
export const BAND_RANK: Record<RiskBand, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, 'No Data': 0 };
export const BAND_LABEL: Record<RiskBand, string> = {
  Critical: 'Critical', High: 'High', Medium: 'Medium', Low: 'Low', 'No Data': 'No Data / Verification Required',
};

export type FindingCode =
  | 'INVALID_GSTIN' | 'NOT_FOUND_ON_PORTAL' | 'CANCELLED_RETRO' | 'CANCELLED' | 'CANCELLED_2A' | 'SUSPENDED'
  | 'SUSPENDED_INVOICES' | 'STATUS_OTHER' | 'COMPOSITION_TAX_CHARGED' | 'COMPOSITION' | 'TDS_TCS_REGISTRATION'
  | 'SPECIAL_REGISTRATION' | 'EINVOICE_MISSING_IRN' | 'EINVOICE_VERIFY' | 'NON_FILING_PERSISTENT' | 'NON_FILING'
  | 'NOT_FILED_GSTR1' | 'SUPPLIER_3B_PENDING' | 'RULE_37A_REVERSAL' | 'DELAYED_FILING' | 'MISMATCH_MATERIAL'
  | 'MISMATCH_MINOR' | 'BOOKS_NOT_IN_2B' | 'VALUE_DIFFERENCE' | 'ITC_NOT_AVAILABLE_2B' | 'NOT_IN_BOOKS'
  | 'DUPLICATE_BOOKING' | 'NAME_MISMATCH' | 'RCM_DOCS' | 'STALE_LOOKUP' | 'NO_LOOKUP' | 'FILING_DATA_MISSING';

export interface FindingRule {
  band: RiskBand;
  nature: RiskNature;
  /** Short words for the reason column. */
  label: string;
  provision: string;
  action: string;
  /** Lists of the management summary it belongs to. */
  lists: ('immediate' | 'clarify' | 'hold')[];
}

const S16 = 's.16(2)(aa) CGST Act, rule 36(4)';
const S16C = 's.16(2)(c) CGST Act';

export const FINDINGS: Record<FindingCode, FindingRule> = {
  INVALID_GSTIN: {
    band: 'Critical', nature: 'Confirmed', label: 'GSTIN is not valid',
    provision: 's.16(2)(a), s.16(2)(aa) CGST Act; rule 36(1), 46(b) CGST Rules',
    action: 'Obtain the correct GSTIN from the vendor (registration certificate) and correct the books and the vendor master; an invoice bearing an invalid GSTIN cannot appear in GSTR-2B.',
    lists: ['immediate', 'hold'],
  },
  NOT_FOUND_ON_PORTAL: {
    band: 'Critical', nature: 'Potential risk', label: 'GST portal search found no such GSTIN',
    provision: 's.16(2)(aa) CGST Act; rule 36(4) CGST Rules',
    action: "Confirm the GSTIN with the vendor's registration certificate; search it again on the portal before any ITC claim.",
    lists: ['immediate', 'hold'],
  },
  CANCELLED_RETRO: {
    band: 'Critical', nature: 'Confirmed', label: 'Invoices dated on or after the cancellation effective date (retrospective cancellation)',
    provision: 's.29(2), s.16(2)(aa), s.16(2)(c) CGST Act; s.31 (no tax invoice by an unregistered person)',
    action: "ITC on the invoices dated on or after the effective date is potentially ineligible: do not claim it, or reverse it if claimed, pending the vendor's revocation (s.30) or proof of tax paid; obtain the cancellation order. Courts have allowed ITC where the supplier filed and paid for the period, so keep the evidence.",
    lists: ['immediate', 'hold'],
  },
  CANCELLED: {
    band: 'Critical', nature: 'Potential risk', label: 'Registration cancelled',
    provision: 's.29 CGST Act; s.16(2)(c) CGST Act',
    action: "Invoices dated before the cancellation are conditionally eligible: verify the vendor filed its returns (GSTR-1 and GSTR-3B) for those periods. Stop further purchases with tax from this GSTIN until the vendor shows a revocation.",
    lists: ['immediate'],
  },
  CANCELLED_2A: {
    band: 'Critical', nature: 'Potential risk', label: 'GSTR-2A shows a cancellation date for the supplier',
    provision: 's.29 CGST Act; s.16(2)(c) CGST Act',
    action: 'Run Pull (Search Taxpayer) to confirm the status and effective date; then check invoices dated on or after that date.',
    lists: ['immediate'],
  },
  SUSPENDED: {
    band: 'Critical', nature: 'Potential risk', label: 'Registration suspended',
    provision: 'rule 21A CGST Rules; s.29(1) proviso CGST Act',
    action: 'A suspended person shall not make taxable supplies during the suspension (rule 21A(3)); ask the vendor for the reply to the suspension notice and the revocation; verify before releasing the tax portion.',
    lists: ['immediate', 'hold'],
  },
  SUSPENDED_INVOICES: {
    band: 'Critical', nature: 'Potential risk', label: 'Invoices dated after the suspension date',
    provision: 'rule 21A(3) CGST Rules; s.16(2)(c) CGST Act',
    action: 'Hold the ITC on these invoices pending verification that the suspension was revoked and the vendor filed for the period.',
    lists: ['immediate', 'hold'],
  },
  STATUS_OTHER: {
    band: 'Medium', nature: 'Verification required', label: 'Registration status is not Active',
    provision: 's.29 CGST Act',
    action: "Check the vendor's registration status on the portal and ask the vendor.",
    lists: ['clarify'],
  },
  COMPOSITION_TAX_CHARGED: {
    band: 'High', nature: 'Potential risk', label: 'Composition taxpayer with tax shown in 2A / 2B or the books',
    provision: 's.10(4) CGST Act (a composition taxpayer cannot collect tax or pass on ITC); s.9(4) for supplies before opting in',
    action: "Check each invoice: a composition taxpayer issues a bill of supply. Tax charged on or after the date of opting in is not ITC: reverse it if claimed and recover it from the vendor. Invoices dated before opting in remain eligible.",
    lists: ['clarify', 'hold'],
  },
  COMPOSITION: {
    band: 'Low', nature: 'Confirmed', label: 'Composition taxpayer (bill of supply, no ITC arises)',
    provision: 's.10(4) CGST Act',
    action: 'No ITC to claim on bills of supply; verify none was claimed in the books.',
    lists: [],
  },
  TDS_TCS_REGISTRATION: {
    band: 'Medium', nature: 'Verification required', label: 'GSTIN is a TDS / TCS registration, not a supplier registration',
    provision: 's.51 / s.52 CGST Act (registration under s.24(vi) / (x))',
    action: "Obtain the vendor's normal GSTIN: a TDS or TCS registration is not used to make supplies, so ITC on an invoice bearing it will not reach GSTR-2B.",
    lists: ['clarify'],
  },
  SPECIAL_REGISTRATION: {
    band: 'Low', nature: 'Verification required', label: 'Special registration (UIN / non-resident / OIDAR)',
    provision: 's.24, s.55 CGST Act; s.14 IGST Act; s.5(3) IGST Act for OIDAR imports',
    action: 'Confirm the kind of registration and whether reverse charge applies; ITC follows the usual conditions.',
    lists: [],
  },
  EINVOICE_MISSING_IRN: {
    band: 'High', nature: 'Potential risk', label: 'E-invoice applicable but B2B invoices in 2B carry no IRN',
    provision: 'rule 48(4), 48(5) CGST Rules; Notification 13/2020-CT as amended by 10/2023-CT',
    action: 'An invoice not issued through the IRP when e-invoicing applies is not an invoice (rule 48(5)): ask the vendor for the e-invoice (IRN and QR code) of each invoice listed, or a reason it is exempt, before claiming the ITC.',
    lists: ['clarify', 'hold'],
  },
  EINVOICE_VERIFY: {
    band: 'Medium', nature: 'Verification required', label: 'Some invoices carry an IRN and others do not',
    provision: 'rule 48(4), 48(5) CGST Rules; Notification 13/2020-CT as amended by 10/2023-CT',
    action: "The vendor issues e-invoices, so verify the invoices without an IRN (an exempt supply, a date before applicability, or a missing e-invoice). E-invoice enablement can be checked on the IRP's search (CAPTCHA protected, not automated).",
    lists: ['clarify'],
  },
  NON_FILING_PERSISTENT: {
    band: 'High', nature: 'Confirmed', label: 'Returns not filed for two or more periods (portal filing table)',
    provision: 's.16(2)(c) CGST Act; rule 37A CGST Rules; s.29(2)(b) / (c) CGST Act (cancellation for non-filing)',
    action: 'ITC is at risk where the vendor has not paid the tax: obtain the filing status for each period of your invoices; ITC is reversed under rule 37A if the GSTR-3B is not filed by 30 September after the year. Consider withholding the tax portion pending verification.',
    lists: ['immediate', 'hold'],
  },
  NON_FILING: {
    band: 'Medium', nature: 'Confirmed', label: 'A return not filed for one period (portal filing table)',
    provision: 's.16(2)(c) CGST Act; rule 37A CGST Rules',
    action: 'Ask the vendor to file the pending return; check again before 30 September after the year.',
    lists: ['clarify'],
  },
  NOT_FILED_GSTR1: {
    band: 'Medium', nature: 'Potential risk', label: 'Invoices saved by the vendor but GSTR-1 / IFF not filed (2A)',
    provision: 's.16(2)(aa) CGST Act; rule 36(4) CGST Rules',
    action: 'Ask the vendor to file GSTR-1 / IFF; claim the ITC only once the invoices reach a GSTR-2B.',
    lists: ['clarify'],
  },
  SUPPLIER_3B_PENDING: {
    band: 'Medium', nature: 'Potential risk', label: "Vendor's GSTR-3B not filed for a period, as of the 2A pull",
    provision: 's.16(2)(c) CGST Act; rule 37A CGST Rules',
    action: 'Ask the vendor to file GSTR-3B; under rule 37A the ITC is reversed if it is not filed by 30 September after the year.',
    lists: ['clarify'],
  },
  RULE_37A_REVERSAL: {
    band: 'High', nature: 'Confirmed', label: 'GSTR-2B carries a rule 37A ITC reversal for this vendor',
    provision: 'rule 37A CGST Rules; s.16(2)(c) CGST Act',
    action: 'Reverse the ITC in Table 4(B)(2) of GSTR-3B as the 2B shows; reclaim it once the vendor files its GSTR-3B.',
    lists: ['immediate'],
  },
  DELAYED_FILING: {
    band: 'Medium', nature: 'Confirmed', label: 'Returns filed late',
    provision: 's.16(2)(aa), s.16(4) CGST Act; s.37, s.39 CGST Act',
    action: 'Late GSTR-1 moves the ITC to a later 2B: claim it in the month it appears, within the s.16(4) time limit; remind the vendor of the due dates.',
    lists: ['clarify'],
  },
  MISMATCH_MATERIAL: {
    band: 'High', nature: 'Confirmed', label: 'Material ITC in the books not in GSTR-2B',
    provision: 's.16(2)(aa) CGST Act; rule 36(4) CGST Rules',
    action: 'Do not claim the ITC until the invoices reach a GSTR-2B: send the vendor the list of invoices not in 2B and ask it to report them in GSTR-1 / IFF (or GSTR-1A).',
    lists: ['clarify', 'hold'],
  },
  MISMATCH_MINOR: {
    band: 'Medium', nature: 'Confirmed', label: 'ITC in the books not in GSTR-2B',
    provision: 's.16(2)(aa) CGST Act; rule 36(4) CGST Rules',
    action: 'Follow up the invoices not in 2B with the vendor; claim them when they appear.',
    lists: ['clarify'],
  },
  BOOKS_NOT_IN_2B: {
    band: 'High', nature: 'Potential risk', label: 'Booked with tax, but the vendor is in no GSTR-2A / 2B of the year',
    provision: 's.16(2)(aa) CGST Act; rule 36(4) CGST Rules',
    action: "Verify the GSTIN and ask the vendor to report the invoices in GSTR-1; no ITC until they appear in a GSTR-2B (pull the year's 2B first if some months are not pulled).",
    lists: ['clarify', 'hold'],
  },
  VALUE_DIFFERENCE: {
    band: 'Medium', nature: 'Confirmed', label: 'Value or tax differs between 2A and 2B',
    provision: 's.16(2)(aa) CGST Act',
    action: "Compare with the vendor's GSTR-1 and your books; ask the vendor to amend a wrong figure; claim as the 2B shows it.",
    lists: ['clarify'],
  },
  ITC_NOT_AVAILABLE_2B: {
    band: 'Medium', nature: 'Confirmed', label: 'GSTR-2B marks ITC not available (place of supply / time limit)',
    provision: 's.16(4) CGST Act; s.12, s.13 IGST Act (place of supply)',
    action: 'No ITC as the 2B stands; ask the vendor to correct a wrong place of supply by amendment.',
    lists: ['clarify'],
  },
  NOT_IN_BOOKS: {
    band: 'Low', nature: 'Confirmed', label: 'Open documents in GSTR-2B not in the books',
    provision: 's.16(4) CGST Act (time limit); s.17(5) where blocked',
    action: 'Book and claim within the s.16(4) time limit, or record why not (blocked u/s 17(5), not received, not ours).',
    lists: ['clarify'],
  },
  DUPLICATE_BOOKING: {
    band: 'Medium', nature: 'Potential risk', label: 'Same invoice number booked more than once',
    provision: 's.16(1), s.16(2) CGST Act',
    action: 'Check the books register for a duplicate entry and remove it before the ITC is claimed twice.',
    lists: ['clarify'],
  },
  NAME_MISMATCH: {
    band: 'Medium', nature: 'Potential risk', label: 'Vendor name differs from the GST record',
    provision: 'rule 46(a), (b) CGST Rules (invoice particulars)',
    action: "Compare the invoice with the portal's legal / trade name; update the vendor master, or obtain the registration certificate if the GSTIN belongs to someone else.",
    lists: ['clarify'],
  },
  RCM_DOCS: {
    band: 'Low', nature: 'Confirmed', label: 'Reverse charge documents',
    provision: 's.9(3), s.9(4) CGST Act; s.5(3), 5(4) IGST Act',
    action: 'Pay the tax under reverse charge in Table 3.1(d) of GSTR-3B, then claim the ITC in Table 4(A)(3).',
    lists: [],
  },
  STALE_LOOKUP: {
    band: 'Medium', nature: 'Verification required', label: 'Portal lookup older than 90 days',
    provision: '(practice)',
    action: 'Run Pull (Search Taxpayer) again before relying on the registration status.',
    lists: ['clarify'],
  },
  NO_LOOKUP: {
    band: 'No Data', nature: 'Verification required', label: 'Registration not checked on the GST portal',
    provision: '(practice)',
    action: 'Run Pull (Search Taxpayer) for this GSTIN; until then the registration fields are not verified.',
    lists: [],
  },
  FILING_DATA_MISSING: {
    band: 'No Data', nature: 'Verification required', label: "The portal lookup holds no filing table for the year",
    provision: '(practice)',
    action: 'Run Pull (Search Taxpayer) with the filing table for the year.',
    lists: [],
  },
};

// ── Elected thresholds (docs/VENDOR_GSTIN_RISK.md §4) ───────────────────────

/** Open Not in 2B tax at or above this is a material mismatch… */
export const MATERIAL_TAX = 25_000;
/** …or at or above this share of the vendor's ITC in the books for the year (and at least ₹1,000). */
export const MATERIAL_SHARE = 0.1;
export const MATERIAL_FLOOR = 1_000;
/** Due periods without a filing that make non-filing persistent. */
export const PERSISTENT_MISSING = 2;
/** A portal lookup older than this many days is to be run again. */
export const STALE_LOOKUP_DAYS = 90;
/** Name similarity (token overlap) below which a name is a mismatch. */
export const NAME_MATCH_MIN = 0.5;

export const LIMITATIONS: string[] = [
  "E-invoice enablement is searched on the IRP's public search, which is CAPTCHA protected, so it is not automated: the report reads enablement only from the portal lookup's flag where it shows one, and otherwise from the IRNs on the vendor's invoices in GSTR-2A / 2B.",
  'E-invoice applicability follows the aggregate turnover slab the portal search shows (the latest year it shows); e-invoicing applies when ANY preceding year from 2017-18 crossed ₹5 crore, and exempt classes (GTA, banking, passenger transport, cinema, SEZ unit, government) are not always visible, so "Not applicable by slab" is never a clearance.',
  'The cancellation reason is shown only where the portal search gives it.',
  'A GSTIN not yet looked up on the portal is "Verification required": the report never calls a vendor non-compliant because a lookup has not been run or a return has not been pulled.',
  "Filing status comes from the portal's filing table as last pulled; quarterly (QRMP) filers are recognised by their quarter-end filings, which is an inference.",
  'TCS and OIDAR are recognised by the shape of the GSTIN, a heuristic; composition is known only from the portal lookup.',
  "The 2B matching figures read the app's own ledgers (Import 2B, bills not in 2B / not in books) as they stand, and the GSTR-2A vs 2B reconciliation of each month whose 2A and 2B are pulled.",
];

export const PRACTICAL: string[] = [
  "Run Pull (Search Taxpayer) before each GSTR-3B for new vendors and for every vendor in the Critical and High lists; once a quarter for the rest.",
  'Keep the vendor master current (upload it here) so that the books name is compared with the GST record.',
  'Release the tax portion of a payment to a Critical or High vendor only after the point listed against it is cleared; the 180-day payment condition (s.16(2), second proviso) still runs.',
  'For e-invoice vendors, insist on the IRN and QR code on every B2B invoice before booking it.',
  'Ask vendors who file late to file GSTR-1 / IFF by the 11th / 13th so that the ITC reaches the same month\'s 2B.',
];
