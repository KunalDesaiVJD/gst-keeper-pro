// Evidence recipes (roadmap Phase 4; audit R-10, R-23): the shapes shared by
// the pure recipe core (src/lib/reply/recipes), the loaders and the Evidence
// tab. A recipe takes what the extension pulled from the portal and returns
// an annexure: a summary per tax head, tables whose every row names its
// source, and the data it needed and found missing. Saved as a version in
// reply_annexures (summary / tables / readiness are these shapes as JSON).

export type RecipeKey =
  | 'gstr1_vs_3b'
  | 'gstr3b_vs_2b'
  | 'gstr3b_vs_2a'
  | 'fy_summary'
  | 'rcm'
  | 'interest'
  | 'late_fee'
  | 'itc_16_4'
  | 'filing_status'
  | 'itc_17_5'
  | 'cancelled_suppliers'
  | 'rule_42'
  | 'gstr9_vs_3b';

export type AnnexureStatus = 'ready' | 'partial' | 'needs_data' | 'not_applicable' | 'failed';

export type Head = 'igst' | 'cgst' | 'sgst' | 'cess';
export const HEADS: Head[] = ['igst', 'cgst', 'sgst', 'cess'];
export const HEAD_LABEL: Record<Head, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess' };
export type HeadAmounts = Record<Head, number>;

/** Where a figure came from. Every annexure row carries the list of these it was built from. */
export interface SourceRef {
  /** Table the figure was read from ('gst_filed_returns', 'gst_credit_reversal_reclaim_entries', …). */
  table: string;
  /** Return period 'MM/YYYY', a financial year '2023-24', or a range label. */
  period?: string | null;
  /** What the row is, in words: 'GSTR-3B', 'GSTR-2B', 'Credit reversal and re-claimed statement'. */
  label?: string | null;
  arn?: string | null;
  /** When the extension pulled it (gst_filed_returns.updated_at, statements' pulled_at). */
  pulled_at?: string | null;
  row_id?: string | null;
}

export type CellValue = string | number | null;

export interface AnnexureColumn {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'date' | 'int';
  /** Upper header for grouped columns ("GSTR-1", "Difference"). */
  group?: string;
}

export type RowKind = 'data' | 'total' | 'missing' | 'info';

export interface AnnexureRow {
  cells: Record<string, CellValue>;
  /** The source rows this row was built from (empty for a total of the rows above). */
  _source: SourceRef[];
  kind?: RowKind;
}

export interface AnnexureTable {
  key: string;
  title: string;
  note?: string;
  columns: AnnexureColumn[];
  rows: AnnexureRow[];
}

/** One line per tax head: the notice's figure, ours, and what is left to pay. */
export interface HeadLine {
  head: Head;
  /** What the notice says for this head (tax, or interest / fee for those recipes); null when not stated per head. */
  notice: number | null;
  computed: number;
  /** notice − computed. */
  difference: number | null;
  explained: number | null;
  to_pay: number;
}

/** A reconciliation line ("Difference", "Timing", "DRC-03 paid", "To pay"), per head. */
export interface SummaryLine {
  label: string;
  values: Partial<HeadAmounts>;
  kind?: 'figure' | 'reconciling' | 'result' | 'info';
  note?: string;
}

export interface AnnexureSummary {
  headline: string;
  /** What "computed" means here, e.g. "GSTR-1 − GSTR-3B for the period". */
  computed_label: string;
  heads: HeadLine[];
  lines: SummaryLine[];
  /** The notice's total when it is not stated per head. */
  notice_total: number | null;
  notice_basis: string | null;
  computed_total: number;
  to_pay_total: number;
  explained_total: number | null;
  notes: string[];
  /** Months or sources that could not be used, in words. */
  missing: string[];
  /** For a recipe that needs documents rather than portal data. */
  documents?: string[];
  /** Links the card offers (the Annual Return working, the client's page). */
  links?: { label: string; to: string }[];
}

// ── Readiness ───────────────────────────────────────────────────────────────
export type ReadyState = 'ready' | 'not_fetched' | 'not_filed' | 'failed' | 'not_due';

export type SourceKey = 'GSTR1' | 'GSTR3B' | 'GSTR2B' | 'GSTR2A' | 'RECLAIM' | 'GSTR9' | 'TURNOVER' | 'FILING';

export interface ReadinessCell {
  period: string;
  state: ReadyState;
  /** The portal's / extension's own status text, when there is a row. */
  status?: string | null;
  pulled_at?: string | null;
  arn?: string | null;
  /** Outside the notice's period (a month of the same FY used for timing). */
  context?: boolean;
}

export interface ReadinessSource {
  key: SourceKey;
  label: string;
  /** The extension / office-agent pull that fetches it (null when it is typed in the app). */
  mode: string | null;
  scope: 'month' | 'fy';
  cells: ReadinessCell[];
}

export interface FetchPlanItem {
  mode: string;
  label: string;
  /** MM/YYYY; an FY report uses the March that ends the year. */
  periods: string[];
}

export interface PeriodInfo {
  periods: string[];
  source: 'issue' | 'notice' | 'notice_fy' | 'issue_date' | 'none';
  label: string;
  /** "2023-24" when the period lies in one financial year. */
  financialYear: string | null;
  /** Taken from the issue date, not stated on the notice. */
  assumed: boolean;
}

export interface Readiness {
  period: PeriodInfo;
  sources: ReadinessSource[];
  plan: FetchPlanItem[];
  notes: string[];
}

// ── Inputs ──────────────────────────────────────────────────────────────────
export type FiledType = 'GSTR1' | 'GSTR3B' | 'GSTR2B' | 'GSTR2A' | 'GSTR9_CALC';

/** A gst_filed_returns row as the extension saved it. */
export interface FiledReturn {
  id: string;
  period: string;
  type: FiledType;
  arn: string | null;
  filedDate: string | null;
  status: string | null;
  summary: unknown;
  updatedAt: string | null;
}

/** The firm's own Filing Status tracker (filing_status). */
export interface FilingStatusRow {
  id: string;
  returnType: string;
  period: string;
  status: string | null;
  filedDate: string | null;
  arn: string | null;
  targetDate: number | null;
  updatedAt: string | null;
}

/** Electronic credit reversal and re-claimed statement (gst_credit_reversal_reclaim_entries). */
export interface ReclaimRow {
  id: string;
  /** "2023-2024", as the extension stores it. */
  financialYear: string;
  period: string | null;
  isOpening: boolean;
  description: string | null;
  claimed: HeadAmounts;
  reversed: HeadAmounts;
  reclaimed: HeadAmounts;
  closing: HeadAmounts;
  pulledAt: string | null;
}

/** RCM liability / ITC statement (gst_rcm_liability_itc_entries). */
export interface RcmStatementRow {
  id: string;
  financialYear: string;
  period: string | null;
  isOpening: boolean;
  description: string | null;
  closing: HeadAmounts;
  pulledAt: string | null;
}

export interface Drc03Row {
  id: string;
  arn: string | null;
  cause: string | null;
  filedDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Tax per head; null when the portal row carries only the cash / credit totals. */
  heads: HeadAmounts | null;
  total: number;
  status: string | null;
  updatedAt: string | null;
}

export interface TurnoverRow {
  id: string;
  /** "2023-24". */
  financialYear: string;
  aggregate: number | null;
  exempt: number | null;
  directExempt: number | null;
  updatedAt: string | null;
}

/** The Annual Return working of one FY (annual_return_docs), as stored. */
export interface AnnualWorking {
  financialYear: string;
  docs: Record<string, unknown>;
  updatedAt: Record<string, string>;
}

export interface PortalData {
  /** GSTR-1 / 3B / 2B / 2A rows of the months loaded. */
  filed: FiledReturn[];
  /** GSTR-9 rows (filed date only). */
  gstr9: FiledReturn[];
  /** null when the table could not be read. */
  filingStatus: FilingStatusRow[] | null;
  reclaims: ReclaimRow[] | null;
  /** FYs ("2023-24") whose reclaim statement was asked for. */
  reclaimFys: string[];
  rcmStatement: RcmStatementRow[] | null;
  drc03: Drc03Row[] | null;
  turnover: TurnoverRow[] | null;
  annual: AnnualWorking[] | null;
  /** Tables that could not be read, in words. */
  errors: string[];
}

export interface NoticeLite {
  id: string;
  clientId: string;
  formCode: string | null;
  referenceNumber: string | null;
  issueDate: string | null;
  financialYear: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  demand: unknown;
  demandTotal: number | null;
  amountOfDemand: number | null;
}

export interface IssueLite {
  id: string;
  seq: number;
  title: string;
  issueCode: string | null;
  amount: number;
  explainedAmount: number;
  explainedBy: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  demand: unknown;
  status: string;
}

export interface ClientLite {
  id: string;
  name: string;
  gstin: string | null;
  /** Due day of GSTR-1 (target_date_group1) and GSTR-3B (target_date_group2). */
  dueDay1: number | null;
  dueDay2: number | null;
}

export interface IssueTypeLite {
  code: string;
  title: string;
  recipeKey: string | null;
  documents: string[];
  forms: string[];
}

/** What a recipe is asked to answer. */
export interface RecipeContext {
  recipe: RecipeKey;
  notice: NoticeLite;
  client: ClientLite;
  /** The issue this recipe answers (null for the form default). */
  issue: IssueLite | null;
  /** The notice's (or its only issue's) figures stand for this recipe. */
  useNoticeDemand: boolean;
  period: PeriodInfo;
  /** IST date the recipe runs on (YYYY-MM-DD). */
  today: string;
  /** ARNs of DRC-03s linked to this notice on its Payments tab. */
  linkedDrc03: string[];
  /** Only one money recipe on the notice: a linked DRC-03 counts against it whatever its cause. */
  soleRecipe: boolean;
  documents: string[];
}

export interface RecipeResult {
  recipe: RecipeKey;
  status: AnnexureStatus;
  title: string;
  periods: string[];
  financialYear: string | null;
  summary: AnnexureSummary;
  tables: AnnexureTable[];
  readiness: Readiness;
  /** For reply_annexure_save: what the issue's explained amount becomes (null: leave it). */
  explained: number | null;
  toPay: number | null;
  /** The inputs actually used (hashed into inputs_hash). */
  inputs: unknown;
}

/** One card on the Evidence tab: a recipe for an issue (or the form's default). */
export interface PlannedRecipe {
  recipe: RecipeKey;
  issue: IssueLite | null;
  /** Why this recipe applies, in words. */
  reason: string;
  useNoticeDemand: boolean;
  documents: string[];
}
