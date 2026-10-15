// The reconciliation as the Reports Hub shows and exports it: one flat,
// serialisable row per document pair, every figure signed (a credit note is
// negative), with what each filter of the view needs already resolved (labels,
// ITC bucket, derived rate). Built from a RecoResult by viewModel.ts, merged
// across months by mergeViewData, and carried on ReportTable.reco so the view
// (ReasonReconciliationView) and the Excel / PDF read the same rows. Pure types.
import type { DocFamily, ReasonCode, RecoStatus, SourceKey } from './types';

/** Where a document's ITC sits in the 2B; null for a source that does not say (2A). */
export type ItcState = 'available' | 'not_available' | 'rejected' | 'reversal';

/** One side of a pair, as shown. Amounts are signed: a credit note (and a Rule 37A reversal) counts −1. */
export interface RecoSideView {
  /** RecoDoc.ref: unique within its statement. */
  ref: string;
  /** 'MM/YYYY' of the statement it came from (the 2A or 2B month). */
  statementPeriod: string;
  /** 'B2B' | 'CDNR' | 'B2BA' | …: the portal section. */
  section: string;
  family: DocFamily;
  /** 'Invoice', 'Credit note', 'Debit note (amended)', … */
  docType: string;
  isAmendment: boolean;
  original: { number: string | null; date: string | null } | null;
  number: string;
  /** ISO date. */
  date: string | null;
  docValue: number;
  /** Two-digit state code. */
  pos: string | null;
  reverseCharge: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** igst + cgst + sgst + cess, signed. */
  tax: number;
  /** Tax ÷ taxable × 100, to the nearest standard rate band when within 0.5; null when taxable is 0. */
  rate: number | null;
  /** 'MM/YYYY' the supplier reported it for. */
  supplierPeriod: string | null;
  /** ISO. */
  supplierFiledOn: string | null;
  supplierFiled: boolean | null;
  supplier3bFiled: boolean | null;
  /** ISO. */
  supplierCancelledFrom: string | null;
  itc: ItcState | null;
  /** 2B rsn: 'P' place of supply, 'C' time limit. */
  itcReason: string | null;
  imsStatus: string | null;
  irn: string | null;
}

export interface RecoViewNote {
  code: ReasonCode;
  /** REASONS[code].label */
  label: string;
  /** The row's own sentence. */
  text: string;
}

export interface RecoViewDiff {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  tax: number;
}

export interface RecoViewRow {
  /** Unique across merged months: `${period}|${index}`. */
  id: string;
  /** The month reconciled, 'MM/YYYY'. */
  period: string;
  status: RecoStatus;
  /** statusLabel(): 'Only in 2A', 'Matched', … */
  statusLabel: string;
  reason: ReasonCode;
  /** REASONS[reason].label */
  reasonLabel: string;
  /** The rule's sentence for this row (may be ''). */
  detail: string;
  /** reasonCell(): "label: detail" plus " (not confirmed)". */
  reasonText: string;
  action: string;
  /** evidenceCell(). */
  evidence: string;
  /** true = checked against a neighbouring statement; false = inferred; null = needs no confirmation. */
  confirmed: boolean | null;
  refPeriod: string | null;
  notes: RecoViewNote[];
  /** Supplier GSTIN ('' for imports). */
  ctin: string;
  supplierName: string;
  /** The pair's type: "Invoice", or "Invoice / Debit note" when the sides differ. */
  docType: string;
  /** right ?? left. */
  family: DocFamily;
  /** right ?? left. */
  section: string;
  isAmendment: boolean;
  /** "INV-1" or "INV-1 / INV/1" when the sides differ. */
  number: string;
  /** ISO, right ?? left. */
  date: string | null;
  dateDiffers: boolean;
  viaAmendment: boolean;
  reverseCharge: boolean;
  left: RecoSideView | null;
  right: RecoSideView | null;
  /** right minus left; null when the row is not compared. */
  diff: RecoViewDiff | null;
  /** |diff.tax|, 0 when not compared: for sorting and the "difference at least" filter. */
  absTaxDiff: number;
}

export interface RecoStatementView {
  period: string;
  /** ISO date the left statement (2A) was pulled. */
  leftPulledAt: string | null;
  /** ISO date the right statement (2B) was generated. */
  rightGeneratedOn: string | null;
  leftState: string;
  rightState: string;
}

export interface RecoViewData {
  left: { key: SourceKey; label: string };
  right: { key: SourceKey; label: string };
  client: { name: string; gstin: string | null };
  /** The months reconciled, in order. */
  periods: string[];
  rows: RecoViewRow[];
  /** The "could not confirm / not compared" lines, per month. */
  notes: { period: string; text: string }[];
  statements: RecoStatementView[];
  /** Months that could not be built, with why. */
  failed: { period: string; reason: string }[];
  /** ₹ per head within which figures count as the same. */
  tolerance: number;
}

// ── Aggregates (viewModel.ts computes them from any subset of rows) ──────────

export interface SideTotals { docs: number; taxable: number; igst: number; cgst: number; sgst: number; cess: number; tax: number }

export type StatusCounts = Record<RecoStatus, number>;

export interface SupplierLine {
  ctin: string;
  name: string;
  /** Rows of this supplier (all statuses). */
  rows: number;
  leftDocs: number;
  rightDocs: number;
  counts: StatusCounts;
  leftTaxable: number;
  rightTaxable: number;
  leftTax: number;
  rightTax: number;
  /** Right tax minus left tax over the compared rows. */
  diff: number;
}

export interface PeriodLine {
  period: string;
  rows: number;
  leftDocs: number;
  rightDocs: number;
  counts: StatusCounts;
  leftTaxable: number;
  rightTaxable: number;
  leftTax: number;
  rightTax: number;
  diff: number;
}

export interface ReasonLine {
  status: RecoStatus;
  statusLabel: string;
  reason: ReasonCode;
  reasonLabel: string;
  action: string;
  count: number;
  leftTaxable: number;
  rightTaxable: number;
  leftTax: number;
  rightTax: number;
  diff: number;
}

/** Any group-by of the rows (document type, section, ITC state, rate…). */
export interface GroupLine {
  key: string;
  label: string;
  rows: number;
  counts: StatusCounts;
  leftTax: number;
  rightTax: number;
  diff: number;
}
