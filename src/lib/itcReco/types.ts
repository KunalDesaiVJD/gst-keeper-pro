// ITC reconciliation between portal statements (GSTR-2A, GSTR-2B and, later,
// GSTR-9 Table 8A). Pure: no Supabase, no React, no clock. The engine works on
// RecoDoc, a document normalised from any source by an adapter (sources.ts), so
// a new source plugs in with an adapter and a rule set, without touching the
// matcher or the report plumbing. Positions: docs/GSTR2A_2B_RECO_POSITIONS.md.

/** A document source. 8A is GSTR-9 Table 8A, the year's ITC statement (fy8a.ts, eightA.ts). */
export type SourceKey = '2A' | '2B' | '8A';

/** Document family: part of a document's identity (an invoice never matches a credit note). */
export type DocFamily = 'INV' | 'DN' | 'CN' | 'ISD' | 'BOE' | 'OTHER';

/** Where a 2B document sits: ITC available, not available, rejected in IMS, or an ITC reversal (Rule 37A). */
export type Bucket = 'available' | 'not_available' | 'rejected' | 'reversal';

export interface RecoDoc {
  /** source|period|section|ctin|number|n: unique within one statement, for tests and React keys. */
  ref: string;
  source: SourceKey;
  /** 'MM/YYYY' of the statement it came from (8A: '03/YYYY' of the FY). */
  statementPeriod: string;
  /** 'B2B' | 'CDNR' | 'B2BA' | 'CDNRA' | 'ISD' | 'ISDA' | 'IMPG' | 'IMPGSEZ' | 'IMPGA' | 'ECO' | … */
  section: string;
  isAmendment: boolean;
  /** For an amendment: the document it amends (oinum/oidt, ontnum/ontdt). */
  original: { number: string | null; date: string | null } | null;
  /** Supplier GSTIN, upper case, no spaces; '' for imports. */
  ctin: string;
  supplierName: string | null;
  family: DocFamily;
  /** Trimmed, as the portal sent it. */
  number: string;
  /** ISO date. */
  date: string | null;
  docValue: number;
  /** Two-digit state code. */
  pos: string | null;
  /** 2A rchrg / 2B rev === 'Y'. */
  reverseCharge: boolean;
  /** Positive, as shown on the document; a credit note counts −1 in every total (docSign). */
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** 'MM/YYYY' the supplier reported it for: 2B supprd; 2A flprdr1, else the 2A's own period. */
  supplierPeriod: string | null;
  /** ISO: 2B supfildt (DD-MM-YYYY), 2A supfildt (DD-Mon-YY). */
  supplierFiledOn: string | null;
  /** 2A cfs (Y/N) when present; true when a filing date exists; else null. */
  supplierFiled: boolean | null;
  /** 2A cfs3b (Y/N) when present. */
  supplier3bFiled: boolean | null;
  /** 2A dtcancel when present (ISO). */
  supplierCancelledFrom: string | null;
  /** 2B itcavl; null for 2A. */
  itcAvailable: boolean | null;
  /** 2B rsn ('' becomes null): 'P' place of supply, 'C' time limit (inferred). */
  itcReason: string | null;
  /** 2B imsStatus as sent (only 'N' seen live; the meaning of the others is unverified). */
  imsStatus: string | null;
  /** 2B only; null for 2A. */
  bucket: Bucket | null;
  irn: string | null;
}

export type StatementState = 'ready' | 'not_pulled' | 'not_generated' | 'failed';

export interface StatementMeta {
  source: SourceKey;
  period: string;
  state: StatementState;
  /** gst_filed_returns.status. */
  status: string | null;
  /** ISO date of gst_filed_returns.updated_at (when the statement was pulled). */
  pulledAt: string | null;
  /** 2B gendt (ISO). */
  generatedOn: string | null;
  /** Sections the statement reads: drives whether the other side's document is compared at all. */
  sectionsRead: string[];
  /** Non-empty sections the adapter does not read: reported in the notes. */
  sectionsUnknown: string[];
  /** Suppliers whose 2A fetch failed (summary._meta.failed, extension 0.13.0+); null = unknown. */
  failedSuppliers: number | null;
  /** Their GSTINs (summary._meta.failedCtins, 0.13.0+); null = not recorded (older pulls). */
  failedCtins: string[] | null;
  /**
   * Why a 2A pull of 0.14.0+ could not read the credit and debit notes
   * (summary._meta.cdnProblem; the 2A then holds none, so the 2B's notes stay
   * not compared). Absent or null: read, or a pull before 0.14.0 (never reads them).
   */
  cdnProblem?: string | null;
  /** Suppliers whose 2A notes fetch failed (summary._meta.cdnFailed, 0.14.0+); null = unknown. */
  cdnFailedSuppliers?: number | null;
  /** Their GSTINs (summary._meta.cdnFailedCtins, 0.14.0+); null = not recorded. */
  cdnFailedCtins?: string[] | null;
  /**
   * A 2A with no documents and no _meta: an extension before 0.13.0 saved a
   * failed supplier-list call this way, so it may not be a real empty month.
   */
  suspectEmpty: boolean;
}

export interface Statement {
  meta: StatementMeta;
  docs: RecoDoc[];
}

/** One gst_filed_returns row, as the report builder reads it. */
export interface StatementRow {
  source: SourceKey;
  period: string;
  status: string | null;
  summary: unknown;
  updatedAt: string | null;
}

// ── Matching ────────────────────────────────────────────────────────────────

export interface SourceSet {
  key: SourceKey;
  /** Short label used in headers and sentences: '2A', '2B', '8A'. */
  label: string;
  docs: RecoDoc[];
  /** Whether THIS source reads the section of a document from another source (false = not compared). */
  covers: (d: RecoDoc) => boolean;
  /** Documents listed on their own, never paired (a 2B's ITC reversal entries are not the invoice itself). */
  solo?: (d: RecoDoc) => boolean;
}

export interface DocGroup {
  key: string;
  docs: Partial<Record<SourceKey, RecoDoc>>;
  /** The paired documents carry different dates (any pass). */
  dateDiffers: boolean;
  /** Paired through an amendment's original document number. */
  viaAmendment: boolean;
  /** A solo document's group: never offered to another source. */
  solo?: boolean;
}

// ── Reconciliation ──────────────────────────────────────────────────────────

/** 'itc_differs': the same figures, but one side gives no ITC (rejected in IMS). */
export type RecoStatus = 'matched' | 'differs' | 'itc_differs' | 'only_left' | 'only_right' | 'not_compared';

/** Display order of the statuses (summary and document list). */
export const STATUS_ORDER: RecoStatus[] = ['only_left', 'only_right', 'differs', 'itc_differs', 'not_compared', 'matched'];

export type ReasonCode =
  // Only in 2A
  | 'IN_LATER_2B' | 'IMS_ACCEPTED_LATER' | 'EXPECTED_NEXT_2B' | 'NOT_FILED_BY_SUPPLIER' | 'IMS_PENDING' | 'ONLY_2A_UNEXPLAINED'
  // Only in 2B, or not compared
  | 'ITC_REVERSAL' | 'NOT_COMPARED_SECTION' | 'QUARTERLY_2B' | 'EARLIER_PERIOD_IN_TIME' | 'EARLIER_PERIOD' | 'STALE_2A'
  | 'TWO_A_INCOMPLETE' | 'ONLY_2B_UNEXPLAINED'
  // Figures differ
  | 'AMENDED' | 'IMS_REJECTED' | 'DATE_DIFFERS' | 'CHANGED_AFTER_2B' | 'VALUE_DIFFERENCE'
  // Matched
  | 'MATCHED'
  // A year's 2A or 2B against its 8A (reasons8A.ts): not in 8A, only in 8A, both
  | 'RCM_NOT_IN_8A' | 'REJECTED_NOT_IN_8A' | 'ITC_NA_NOT_IN_8A' | 'REVERSAL_NOT_IN_8A' | 'AFTER_8A_WINDOW'
  | 'NOT_IN_ANY_2B' | 'TWO_B_NOT_PULLED' | 'EIGHT_A_BEFORE' | 'IN_2B_NOT_IN_8A' | 'NOT_IN_8A_SECTION'
  | 'ONLY_LEFT_8A_UNEXPLAINED' | 'EIGHT_A_2A_NOT_PULLED' | 'EIGHT_A_2B_NOT_PULLED' | 'ONLY_8A_UNEXPLAINED'
  | 'EIGHT_A_HOLDS_NO_ITC' | 'MATCHED_8A'
  // Notes (flags on any row; they never change the status)
  | 'RCM' | 'ITC_NA_POS' | 'ITC_NA_TIME' | 'ITC_NA_OTHER' | 'RULE_37A' | 'SUPPLIER_3B_PENDING' | 'SUPPLIER_CANCELLED' | 'EARLIER_YEAR_DOC';

/** Right minus left, signed (a credit note counts −1). */
export interface FigureDiff {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  tax: number;
  /** Every head and the taxable value within the tolerance. */
  same: boolean;
}

export interface RecoNote {
  code: ReasonCode;
  text: string;
}

export interface RecoRow {
  status: RecoStatus;
  reason: ReasonCode;
  /** The specific sentence for this row (dates, periods). */
  detail: string;
  /** What to do, for this row (the catalogue's action unless a rule gave a specific one). */
  action: string;
  /** true = checked against a neighbouring statement; false = inferred; null = needs no confirmation. */
  confirmed: boolean | null;
  /** e.g. "Found in the 2B of Aug 2026", "2B of Aug 2026 not pulled". */
  evidence: string;
  /** The neighbouring statement ('MM/YYYY') the reason relies on, if any. */
  refPeriod: string | null;
  notes: RecoNote[];
  left?: RecoDoc;
  right?: RecoDoc;
  diff: FigureDiff;
  dateDiffers: boolean;
  viaAmendment: boolean;
}

/** What a rule sees: the row before its reason is chosen. */
export interface RowDraft {
  status: RecoStatus;
  left?: RecoDoc;
  right?: RecoDoc;
  diff: FigureDiff;
  dateDiffers: boolean;
  viaAmendment: boolean;
}

export interface ReasonHit {
  detail: string;
  evidence?: string;
  confirmed: boolean | null;
  /** A specific action for this row; the catalogue's action otherwise. */
  action?: string;
  /** A rule may move a row to another status (a document rejected in IMS differs even at equal figures). */
  status?: RecoStatus;
  /** The neighbouring statement ('MM/YYYY') the reason relies on. */
  refPeriod?: string | null;
}

export interface ReasonRule<C> {
  code: ReasonCode;
  when: RecoStatus[];
  test: (row: RowDraft, ctx: C) => ReasonHit | null;
}

export interface NoteRule<C> {
  code: ReasonCode;
  /** The note's text for this row, or null when it does not apply. */
  test: (row: RowDraft, ctx: C) => string | null;
}

export interface PairConfig<C> {
  left: SourceKey;
  right: SourceKey;
  rules: ReasonRule<C>[];
  notes: NoteRule<C>[];
  /** Reason for a row no rule claimed, per status. */
  fallback: Record<RecoStatus, ReasonCode>;
  /** ₹ per head and on the taxable value. */
  tolerance: number;
  /** The "could not confirm / pull this" lines shown above the list. */
  explain?: (rows: RecoRow[], ctx: C) => string[];
}

export interface SummaryLine {
  status: RecoStatus;
  reason: ReasonCode;
  count: number;
  leftTaxable: number;
  rightTaxable: number;
  leftTax: number;
  rightTax: number;
  /** Right tax minus left tax over the rows that are compared (0 for not compared). */
  diff: number;
}

export interface RecoResult {
  left: { key: SourceKey; label: string };
  right: { key: SourceKey; label: string };
  rows: RecoRow[];
  summary: SummaryLine[];
  notes: string[];
}

export interface ReasonInfo {
  /** Short label (summary line). Never contains the word "total". */
  label: string;
  /** Default action. */
  action: string;
}
