import { supabase } from '@/integrations/supabase/client';
import { type BuilderRateCode } from '@/utils/builderRates';
import { summarisePeriod, type PeriodSummary, type PostingRow } from '@/utils/builderLedger';

// Data shaping for the builder working papers.
//
// Every figure here is read back from what the engines already computed and
// stored — the BU event's own unit rows, the postings feed, the FSI working.
// Nothing is recalculated for the report, so a working paper can never disagree
// with the return it supports.

/**
 * The builder papers, as the Reports page offers them. Each one folds in the
 * schedules that read the same data, as sheets of the one file:
 *   MONTHLY_RETURN  the return workpaper, or one project's liability when a project is chosen
 *   UNITS           the unit register with the re-rating & DRC-03 register, or one unit's ledger
 *   ADVANCES        the 11A / 11B roll-forward for a financial year
 *   COMPLETION      a BU event: the unit-wise working, the TDR / FSI reverse charge and the Rule 42 / 43 reversal
 *   MEMBER_STATEMENT  the client-facing statement of one unit
 */
export type ReportKind =
  | 'MONTHLY_RETURN'
  | 'UNITS'
  | 'ADVANCES'
  | 'COMPLETION'
  | 'MEMBER_STATEMENT';

export const REPORT_LABEL: Record<ReportKind, string> = {
  MONTHLY_RETURN: 'Monthly return',
  UNITS: 'Units',
  ADVANCES: 'Advances 11A / 11B',
  COMPLETION: 'Completion (BU)',
  MEMBER_STATEMENT: 'Member statement',
};

export const REPORT_DESCRIPTION: Record<ReportKind, string> = {
  MONTHLY_RETURN: 'What the period carries to GSTR-1 and 3B, with the documents, tables 7 / 11A / 11B and the FSI reverse charge behind it. Choose a project to see that project\'s liability alone.',
  UNITS: 'Every unit of a project on one schedule, footed to the project, with the units re-rated after crossing ₹45 lakh and their DRC-03. Choose a unit for its ledger.',
  ADVANCES: 'Month by month for a financial year: advances brought forward, received (11A), reversed, adjusted (11B) and carried forward, with the tax on each.',
  COMPLETION: 'One BU event: each unit\'s cut-off and differential, the TDR / FSI reverse charge of the project, and the Rule 42 / 43 ITC reversal at completion.',
  MEMBER_STATEMENT: 'A client-facing statement of one unit: what was agreed, paid, charged and remains.',
};

export interface ReportContext {
  clientName: string;
  clientGstin: string;
  projectName?: string;
  reraNumber?: string;
  periodMonth?: string;
  /** Financial year, 'YYYY-YY', for the year-based papers. */
  financialYear?: string;
  /** Who produced the paper, for the sign-off block. */
  preparedBy?: string;
}

// ─── 1. Unit-wise BU working ────────────────────────────────────────────────

export interface BuWorkingRow {
  unitNo: string;
  unitType: string;
  cutOffDate: string;
  cutOffSource: string;
  bookedAtCutOff: boolean;
  ratePct: number;
  agreementValue: number;
  valueTaxedUptoOpening: number;
  invoicedBefore: number;
  openAdvanceBefore: number;
  receivedUptoCutOff: number;
  differentialValue: number;
  differentialTaxableValue: number;
  differentialCgst: number;
  differentialSgst: number;
  interestDays: number;
  interestAmount: number;
  tieOutDiff: number;
}

export interface BuWorkingReport {
  buDate: string;
  buRefNo: string | null;
  postingPeriod: string;
  postingBasis: string;
  rows: BuWorkingRow[];
  taxable: BuWorkingRow[];
  unbooked: BuWorkingRow[];
  totals: {
    agreementValue: number; valueTaxed: number; differentialValue: number;
    taxableValue: number; cgst: number; sgst: number; interest: number;
  };
}

export async function fetchBuWorking(buEventId: string): Promise<BuWorkingReport | null> {
  const { data: ev } = await supabase
    .from('builder_bu_events')
    .select('bu_date, bu_ref_no, posting_period, posting_basis')
    .eq('id', buEventId).maybeSingle();
  if (!ev) return null;
  const event = ev as unknown as {
    bu_date: string; bu_ref_no: string | null; posting_period: string; posting_basis: string;
  };

  const { data } = await supabase
    .from('builder_bu_event_units').select('*').eq('bu_event_id', buEventId);

  type Row = Record<string, unknown>;
  const unitIds = ((data || []) as Row[]).map((r) => r.unit_id as string);
  const { data: units } = unitIds.length
    ? await supabase.from('builder_units').select('id, unit_no').in('id', unitIds)
    : { data: [] as unknown[] };
  const noOf = new Map(((units || []) as unknown as { id: string; unit_no: string }[])
    .map((u) => [u.id, u.unit_no]));

  const rows: BuWorkingRow[] = ((data || []) as Row[]).map((r) => ({
    unitNo: noOf.get(r.unit_id as string) || '—',
    unitType: (r.unit_type as string) || '',
    cutOffDate: (r.cut_off_date as string) || '',
    cutOffSource: (r.cut_off_source as string) || 'BU',
    bookedAtCutOff: !!r.booked_at_cutoff,
    ratePct: Number(r.rate_pct) || 0,
    agreementValue: Number(r.agreement_value) || 0,
    valueTaxedUptoOpening: Number(r.value_taxed_upto_opening) || 0,
    invoicedBefore: Number(r.invoiced_before) || 0,
    // Value taxed less invoiced = open advances INCLUDING the opening
    // balance. Derived rather than read, because events saved before
    // 10/10/2026 stored the receipt-backed part only.
    openAdvanceBefore: Math.max(0, Math.round((
      (Number(r.value_taxed_upto_opening) || 0) - (Number(r.invoiced_before) || 0) + Number.EPSILON) * 100) / 100),
    receivedUptoCutOff: Number(r.received_upto_cutoff) || 0,
    differentialValue: Number(r.differential_value) || 0,
    differentialTaxableValue: Number(r.differential_taxable_value) || 0,
    differentialCgst: Number(r.differential_cgst) || 0,
    differentialSgst: Number(r.differential_sgst) || 0,
    interestDays: Number(r.interest_days) || 0,
    interestAmount: Number(r.interest_amount) || 0,
    tieOutDiff: Number(r.tie_out_diff) || 0,
  })).sort((a, b) => a.unitNo.localeCompare(b.unitNo, undefined, { numeric: true }));

  const taxable = rows.filter((r) => r.bookedAtCutOff);
  const sum = (f: (r: BuWorkingRow) => number, xs = taxable) =>
    Math.round((xs.reduce((s, r) => s + f(r), 0) + Number.EPSILON) * 100) / 100;

  return {
    buDate: event.bu_date,
    buRefNo: event.bu_ref_no,
    postingPeriod: event.posting_period,
    postingBasis: event.posting_basis,
    rows,
    taxable,
    unbooked: rows.filter((r) => !r.bookedAtCutOff),
    totals: {
      agreementValue: sum((r) => r.agreementValue, rows),
      valueTaxed: sum((r) => r.valueTaxedUptoOpening),
      differentialValue: sum((r) => r.differentialValue),
      taxableValue: sum((r) => r.differentialTaxableValue),
      cgst: sum((r) => r.differentialCgst),
      sgst: sum((r) => r.differentialSgst),
      interest: sum((r) => r.interestAmount),
    },
  };
}

// ─── 2 & 4. Postings-based reports ──────────────────────────────────────────

export interface PostingDoc {
  sourceType: string;
  gstr1Table: string;
  unitNo: string;
  docDate: string;
  ratePct: number;
  rateCode: BuilderRateCode;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  landDeduction: number;
}

export interface FsiLine {
  projectName: string;
  buDate: string;
  allocatedValue: number;
  residentialRcm: number;
  commercialRcm: number;
  totalRcm: number;
  cgst: number;
  sgst: number;
}

export interface PeriodReport {
  summary: PeriodSummary;
  documents: PostingDoc[];
  fsi: FsiLine[];
  fsiTotal: number;
}

/** Outward postings plus the FSI reverse charge for a period. */
export async function fetchPeriodReport(params: {
  clientId: string;
  periodMonth: string;
  projectId?: string;
}): Promise<PeriodReport> {
  let q = supabase.from('builder_period_postings').select('*')
    .eq('client_id', params.clientId).eq('period_month', params.periodMonth);
  if (params.projectId) q = q.eq('project_id', params.projectId);
  const { data } = await q;

  type Row = Record<string, unknown>;
  const documents: PostingDoc[] = ((data || []) as Row[]).map((r) => ({
    sourceType: r.source_type as string,
    gstr1Table: r.gstr1_table as string,
    unitNo: (r.unit_no as string) || '—',
    docDate: (r.doc_date as string) || '',
    ratePct: Number(r.rate_pct) || 0,
    rateCode: r.rate_code as BuilderRateCode,
    consideration: Number(r.consideration) || 0,
    taxableValue: Number(r.taxable_value) || 0,
    cgst: Number(r.cgst) || 0,
    sgst: Number(r.sgst) || 0,
    landDeduction: Number(r.land_deduction) || 0,
  })).sort((a, b) => (a.docDate || '').localeCompare(b.docDate || ''));

  let fq = supabase.from('builder_rcm_postings').select('*')
    .eq('client_id', params.clientId).eq('period_month', params.periodMonth);
  if (params.projectId) fq = fq.eq('project_id', params.projectId);
  const { data: fsiData } = await fq;

  const fsi: FsiLine[] = ((fsiData || []) as Row[]).map((r) => ({
    projectName: (r.project_name as string) || '',
    buDate: (r.bu_date as string) || '',
    allocatedValue: Number(r.allocated_value) || 0,
    residentialRcm: Number(r.residential_rcm) || 0,
    commercialRcm: Number(r.commercial_rcm) || 0,
    totalRcm: Number(r.taxable_tax) || 0,
    cgst: Number(r.cgst) || 0,
    sgst: Number(r.sgst) || 0,
  }));

  return {
    summary: summarisePeriod(documents.map((d) => ({
      source_type: d.sourceType as PostingRow['source_type'],
      gstr1_table: d.gstr1Table,
      rate_code: d.rateCode,
      rate_pct: d.ratePct,
      consideration: d.consideration,
      taxable_value: d.taxableValue,
      cgst: d.cgst,
      sgst: d.sgst,
      land_deduction: d.landDeduction,
    }))),
    documents,
    fsi,
    fsiTotal: Math.round((fsi.reduce((s, f) => s + f.totalRcm, 0) + Number.EPSILON) * 100) / 100,
  };
}

// ─── 3 & 5. Unit-level reports ──────────────────────────────────────────────

export interface LedgerEntry {
  date: string;
  period: string;
  kind: string;
  reference: string;
  consideration: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  tds: number;
  /** Value taxed after this entry — the running position. */
  runningValueTaxed: number;
  /** Set where the entry carries no tax, and why. Words, not colour. */
  status?: string;
}

export interface UnitLedgerReport {
  unitNo: string;
  unitType: string;
  carpetAreaSqM: number;
  ratePct: number;
  agreementValue: number;
  members: { name: string; pan: string | null; ratio: number }[];
  bookingDate: string | null;
  entries: LedgerEntry[];
  totals: {
    valueTaxed: number; cgst: number; sgst: number; tds: number; received: number;
  };
  balanceToTax: number;
  uncollected: number;
}

export interface Drc03PeriodRow {
  periodMonth: string;
  taxableValue: number;
  oldCgst: number;
  oldSgst: number;
  newCgst: number;
  newSgst: number;
  differentialTax: number;
  dueDate: string;
  interestDays: number;
  interestAmount: number;
}

/** The DRC-03 workpaper for one unit's re-rating — the document staff take to the GST portal's DRC-03 form. */
export interface Drc03Report {
  unitNo: string;
  fromRatePct: number;
  toRatePct: number;
  postingPeriod: string;
  dischargeMode: string;
  drc03Status: string;
  drc03Arn: string | null;
  drc03FiledDate: string | null;
  periods: Drc03PeriodRow[];
  totals: { valueRetaxed: number; differentialTax: number; interest: number };
}

/**
 * One unit's full history, in date order, with the running value taxed.
 *
 * Entries that carry no tax still appear — a bounced cheque, a collection
 * against an invoice, a funding swap — with the reason stated. Omitting them
 * would make the received column unexplainable.
 */
export async function fetchUnitLedger(unitId: string): Promise<UnitLedgerReport | null> {
  const { data: unit } = await supabase
    .from('builder_units')
    .select('id, unit_no, unit_type, carpet_area_sqm, base_consideration')
    .eq('id', unitId).maybeSingle();
  if (!unit) return null;
  const u = unit as unknown as {
    unit_no: string; unit_type: string; carpet_area_sqm: number; base_consideration: number;
  };

  const [{ data: bk }, { data: rcp }, { data: inv }, { data: ob }, { data: led }] =
    await Promise.all([
      supabase.from('builder_bookings').select('id, booking_date, total_consideration, status')
        .eq('unit_id', unitId).order('booking_date'),
      supabase.from('builder_receipts').select('*').eq('unit_id', unitId).order('receipt_date'),
      supabase.from('builder_invoices').select('*').eq('unit_id', unitId).order('invoice_date'),
      supabase.from('builder_opening_balances').select('*').eq('unit_id', unitId).maybeSingle(),
      supabase.from('builder_unit_ledger').select('*').eq('unit_id', unitId).maybeSingle(),
    ]);

  const bookings = (bk || []) as unknown as {
    id: string; booking_date: string; total_consideration: number; status: string;
  }[];
  const active = bookings.find((b) => b.status === 'Active') || bookings[0];

  const { data: mem } = active
    ? await supabase.from('builder_booking_members')
      .select('name, pan, ownership_ratio').eq('booking_id', active.id).order('sort_order')
    : { data: [] as unknown[] };

  const invoiceIds = ((inv || []) as unknown as { id: string }[]).map((i) => i.id);
  const { data: adj } = invoiceIds.length
    ? await supabase.from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds)
    : { data: [] as unknown[] };
  const { data: openingAdj } = invoiceIds.length
    ? await supabase.from('builder_opening_balance_adjustments').select('*').in('invoice_id', invoiceIds)
    : { data: [] as unknown[] };
  const { data: cn } = await supabase
    .from('builder_credit_notes').select('*').eq('unit_id', unitId).order('note_date');

  type R = Record<string, unknown>;
  const raw: Omit<LedgerEntry, 'runningValueTaxed'>[] = [];

  const opening = ob as unknown as Record<string, unknown> | null;
  if (opening && Number(opening.cumulative_value_taxed) > 0) {
    raw.push({
      date: (opening.as_at_date as string) || '',
      period: '', kind: 'Opening balance', reference: 'Carried in at onboarding',
      consideration: Number(opening.cumulative_value_taxed) || 0,
      taxableValue: 0,
      cgst: Number(opening.cumulative_cgst) || 0,
      sgst: Number(opening.cumulative_sgst) || 0,
      tds: Number(opening.cumulative_tds_194ia) || 0,
    });
  }

  ((rcp || []) as R[]).forEach((r) => {
    const bounced = r.cheque_status === 'Bounced';
    const swap = !!r.gst_already_discharged;
    const collection = r.receipt_nature === 'AGAINST_INVOICE';
    const subsumed = !!r.subsumed_by_bu_event_id;
    const posts = !bounced && !swap && !collection && !subsumed;
    raw.push({
      date: (r.receipt_date as string) || '',
      period: (r.period_month as string) || '',
      kind: 'Receipt',
      reference: [r.doc_no, r.instrument_type].filter(Boolean).join(' · ') || 'Receipt',
      consideration: posts ? Number(r.consideration) || 0 : 0,
      taxableValue: posts ? Number(r.taxable_value) || 0 : 0,
      cgst: posts ? Number(r.cgst) || 0 : 0,
      sgst: posts ? Number(r.sgst) || 0 : 0,
      tds: Number(r.tds_194ia) || 0,
      status: bounced ? 'Bounced — no consideration received'
        : subsumed ? 'Subsumed into the BU differential'
          : swap ? 'Replacement — GST already discharged'
            : collection ? 'Collection against an invoice'
              : undefined,
    });
  });

  ((inv || []) as R[]).forEach((i) => {
    raw.push({
      date: (i.invoice_date as string) || '',
      period: (i.period_month as string) || '',
      kind: String(i.invoice_type || 'Invoice').replace(/_/g, ' ').toLowerCase()
        .replace(/^./, (c) => c.toUpperCase()),
      reference: [i.doc_no, i.milestone_label].filter(Boolean).join(' · ') || 'Invoice',
      consideration: Number(i.consideration) || 0,
      taxableValue: Number(i.taxable_value) || 0,
      cgst: Number(i.cgst) || 0,
      sgst: Number(i.sgst) || 0,
      tds: 0,
    });
  });

  const invById = new Map(((inv || []) as R[]).map((i) => [i.id as string, i]));
  ((adj || []) as R[]).forEach((a) => {
    const i = invById.get(a.invoice_id as string);
    raw.push({
      date: (i?.invoice_date as string) || '',
      period: (a.period_month as string) || '',
      kind: 'Advance adjusted',
      reference: 'Table 11B — advance absorbed into the invoice',
      consideration: -(Number(a.consideration_adjusted) || 0),
      taxableValue: -(Number(a.taxable_value_adjusted) || 0),
      cgst: -(Number(a.cgst) || 0),
      sgst: -(Number(a.sgst) || 0),
      tds: 0,
    });
  });

  ((openingAdj || []) as R[]).forEach((a) => {
    const i = invById.get(a.invoice_id as string);
    raw.push({
      date: (i?.invoice_date as string) || '',
      period: (a.period_month as string) || '',
      kind: 'Opening balance adjusted',
      reference: 'Table 11B — opening balance absorbed into the invoice',
      consideration: -(Number(a.consideration_adjusted) || 0),
      taxableValue: -(Number(a.taxable_value_adjusted) || 0),
      cgst: -(Number(a.cgst) || 0),
      sgst: -(Number(a.sgst) || 0),
      tds: 0,
    });
  });

  ((cn || []) as R[]).forEach((c) => {
    const within = c.within_window !== false;
    raw.push({
      date: (c.note_date as string) || '',
      period: (c.period_month as string) || '',
      kind: 'Credit note',
      reference: String(c.reason || c.note_type || 'Credit note'),
      consideration: within ? -(Number(c.consideration) || 0) : 0,
      taxableValue: within ? -(Number(c.taxable_value) || 0) : 0,
      cgst: within ? -(Number(c.cgst) || 0) : 0,
      sgst: within ? -(Number(c.sgst) || 0) : 0,
      tds: 0,
      status: within ? undefined : 'Out of window — tax not adjustable',
    });
  });

  raw.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let running = 0;
  const entries: LedgerEntry[] = raw.map((e) => {
    running = Math.round((running + e.consideration + Number.EPSILON) * 100) / 100;
    return { ...e, runningValueTaxed: running };
  });

  const ledger = led as unknown as Record<string, unknown> | null;
  const agreementValue = Number(opening?.agreement_value)
    || Number(active?.total_consideration)
    || Number(u.base_consideration) || 0;
  const received = Number(ledger?.total_received) || 0;
  const sum = (f: (e: LedgerEntry) => number) =>
    Math.round((entries.reduce((s, e) => s + f(e), 0) + Number.EPSILON) * 100) / 100;

  return {
    unitNo: u.unit_no,
    unitType: u.unit_type,
    carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
    ratePct: 0,
    agreementValue,
    members: ((mem || []) as unknown as {
      name: string; pan: string | null; ownership_ratio: number;
    }[]).map((m) => ({ name: m.name, pan: m.pan, ratio: Number(m.ownership_ratio) || 0 })),
    bookingDate: active?.booking_date || null,
    entries,
    totals: {
      valueTaxed: running,
      cgst: sum((e) => e.cgst),
      sgst: sum((e) => e.sgst),
      tds: sum((e) => e.tds),
      received,
    },
    balanceToTax: Math.round((agreementValue - running + Number.EPSILON) * 100) / 100,
    uncollected: Math.round((agreementValue - received + Number.EPSILON) * 100) / 100,
  };
}

// ─── Pickers for the reports page ───────────────────────────────────────────

export async function fetchBuilderClients() {
  const { data } = await supabase.from('clients')
    .select('id, name, gstin').eq('regular_sub_type', 'Builder').order('name');
  return (data || []) as { id: string; name: string; gstin: string | null }[];
}

export async function fetchProjects(clientId: string) {
  const { data } = await supabase.from('builder_projects')
    .select('id, name, rera_number').eq('client_id', clientId).order('name');
  return (data || []) as { id: string; name: string; rera_number: string | null }[];
}

export async function fetchPostedBuEvents(projectId: string) {
  const { data } = await supabase.from('builder_bu_events')
    .select('id, bu_date, bu_ref_no, posting_period')
    .eq('project_id', projectId).eq('status', 'POSTED')
    .order('bu_date', { ascending: false });
  return (data || []) as {
    id: string; bu_date: string; bu_ref_no: string | null; posting_period: string;
  }[];
}

export async function fetchProjectUnits(projectId: string) {
  const { data } = await supabase.from('builder_units')
    .select('id, unit_no, unit_type').eq('project_id', projectId).order('unit_no');
  return (data || []) as { id: string; unit_no: string; unit_type: string }[];
}

// ─── 6. TDR / FSI reverse-charge working paper ──────────────────────────────

export interface FsiWorkingLine {
  buDate: string;
  buRefNo: string | null;
  periodMonth: string;
  status: string;
  treatment: string;
  tdrFsiTotalValue: number;
  eventCarpetSqm: number;
  projectCarpetSqm: number;
  allocatedValue: number;
  residentialCarpetSqm: number;
  commercialCarpetSqm: number;
  unbookedResidentialCarpetSqm: number;
  unbookedResidentialValue: number;
  residentialPortion: number;
  residentialRcmUncapped: number;
  capAmount: number;
  capApplied: boolean;
  residentialRcm: number;
  commercialPortion: number;
  commercialRcm: number;
  totalRcm: number;
  cgst: number;
  sgst: number;
  /** Where the client-instruction trail stands, in words (held-back workings only). */
  consent: string;
}

export interface FsiWorkingReport {
  lines: FsiWorkingLine[];
  totals: {
    allocatedValue: number; residentialRcm: number; commercialRcm: number;
    totalRcm: number; cgst: number; sgst: number;
  };
}

/** Every saved TDR/FSI working of a project, one line per BU event, with the consent trail. */
export async function fetchFsiWorking(projectId: string): Promise<FsiWorkingReport> {
  type Row = Record<string, unknown>;
  const { data: wk } = await supabase
    .from('builder_fsi_workings').select('*').eq('project_id', projectId);
  const workings = (wk || []) as Row[];

  const eventIds = workings.map((w) => w.bu_event_id as string);
  const { data: ev } = eventIds.length
    ? await supabase.from('builder_bu_events').select('id, bu_date, bu_ref_no').in('id', eventIds)
    : { data: [] as unknown[] };
  const eventOf = new Map(((ev || []) as Row[]).map((e) => [e.id as string, e]));

  const { data: cs } = workings.length
    ? await supabase.from('builder_fsi_consents').select('*')
      .in('fsi_working_id', workings.map((w) => w.id as string))
    : { data: [] as unknown[] };
  const consentOf = new Map(((cs || []) as Row[]).map((c) => [c.fsi_working_id as string, c]));

  const n = (v: unknown): number => Number(v) || 0;
  const lines: FsiWorkingLine[] = workings.map((w) => {
    const e = eventOf.get(w.bu_event_id as string);
    const c = consentOf.get(w.id as string);
    let consent = '';
    if (w.treatment === 'IGNORE' && n(w.total_rcm) > 0) {
      consent = c?.approved_at ? 'Instruction approved'
        : c?.confirmation_received_at ? 'Awaiting GST Manager approval'
          : c?.email_sent_at ? 'Awaiting client reply' : 'Request not sent';
    }
    return {
      buDate: (e?.bu_date as string) || '',
      buRefNo: (e?.bu_ref_no as string) || null,
      periodMonth: w.period_month as string,
      status: w.status as string,
      treatment: w.treatment as string,
      tdrFsiTotalValue: n(w.tdr_fsi_total_value),
      eventCarpetSqm: n(w.event_carpet_sqm),
      projectCarpetSqm: n(w.project_carpet_sqm),
      allocatedValue: n(w.allocated_value),
      residentialCarpetSqm: n(w.residential_carpet_sqm),
      commercialCarpetSqm: n(w.commercial_carpet_sqm),
      unbookedResidentialCarpetSqm: n(w.unbooked_residential_carpet_sqm),
      unbookedResidentialValue: n(w.unbooked_residential_value),
      residentialPortion: n(w.residential_portion),
      residentialRcmUncapped: n(w.residential_rcm_uncapped),
      capAmount: n(w.cap_amount),
      capApplied: !!w.cap_applied,
      residentialRcm: n(w.residential_rcm),
      commercialPortion: n(w.commercial_portion),
      commercialRcm: n(w.commercial_rcm),
      totalRcm: n(w.total_rcm),
      cgst: n(w.cgst),
      sgst: n(w.sgst),
      consent,
    };
  }).sort((a, b) => a.buDate.localeCompare(b.buDate));

  const sum = (f: (l: FsiWorkingLine) => number): number =>
    Math.round((lines.reduce((s, l) => s + f(l), 0) + Number.EPSILON) * 100) / 100;
  return {
    lines,
    totals: {
      allocatedValue: sum((l) => l.allocatedValue),
      residentialRcm: sum((l) => l.residentialRcm),
      commercialRcm: sum((l) => l.commercialRcm),
      totalRcm: sum((l) => l.totalRcm),
      cgst: sum((l) => l.cgst),
      sgst: sum((l) => l.sgst),
    },
  };
}

// ─── 8. Unit register (lead schedule) ───────────────────────────────────────

export type { UnitPosition } from '@/lib/builderClientBulkData';

export async function fetchUnitRegister(clientId: string, projectId: string) {
  const { fetchClientUnitPositions } = await import('@/lib/builderClientBulkData');
  return fetchClientUnitPositions(clientId, projectId);
}

// ─── 9. Advances roll-forward (Table 11A / 11B) ─────────────────────────────

export interface RollforwardMonth {
  periodMonth: string;
  opening: number;
  received: number;
  reversed: number;
  adjusted: number;
  closing: number;
  receivedTax: number;
  reversedTax: number;
  adjustedTax: number;
}

export interface AdvanceRollforward {
  fy: string;
  broughtForwardOpening: number;
  months: RollforwardMonth[];
  totals: { received: number; reversed: number; adjusted: number; receivedTax: number; reversedTax: number; adjustedTax: number };
  closing: number;
}

/** 'YYYY-YY' → the twelve 'MM/YYYY' periods of that financial year. */
export const fyPeriods = (fy: string): string[] => {
  const start = Number(fy.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((i + 3) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${String(m).padStart(2, '0')}/${y}`;
  });
};

const pkey = (mmYYYY: string) => { const m = /^(\d{2})\/(\d{4})$/.exec(mmYYYY || ''); return m ? `${m[2]}${m[1]}` : ''; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The open-advance pool rolled forward month by month, read from the same
 * postings feed the returns are built from. Values are consideration (before
 * the 1/3rd land deduction), so the pool ties to the units' open advance.
 *
 * Brought forward = value taxed carried in at onboarding (opening balances)
 * plus every advance posted before the year, less every reversal and
 * adjustment before it.
 */
export async function fetchAdvanceRollforward(params: {
  clientId: string; fy: string; projectId?: string;
}): Promise<AdvanceRollforward> {
  const periods = fyPeriods(params.fy);
  const lastKey = pkey(periods[11]);
  const firstKey = pkey(periods[0]);
  let q = supabase.from('builder_period_postings')
    .select('source_type, period_month, consideration, cgst, sgst, project_id')
    .eq('client_id', params.clientId)
    .in('source_type', ['ADVANCE_11A', 'BOUNCE_REVERSAL', 'CANCELLATION_OFFSET', 'ADVANCE_11B', 'OPENING_11B']);
  if (params.projectId) q = q.eq('project_id', params.projectId);
  const { data } = await q;
  type Row = { source_type: string; period_month: string; consideration: number; cgst: number; sgst: number };
  const rows = ((data || []) as unknown as Row[]).filter((r) => pkey(r.period_month) && pkey(r.period_month) <= lastKey);

  // Opening balances carried in at onboarding are an open advance (positions §6).
  let pq = supabase.from('builder_projects').select('id').eq('client_id', params.clientId);
  if (params.projectId) pq = pq.eq('id', params.projectId);
  const { data: projs } = await pq;
  const projectIds = ((projs || []) as { id: string }[]).map((p) => p.id);
  let carriedIn = 0;
  if (projectIds.length) {
    const { data: units } = await supabase.from('builder_units').select('id').in('project_id', projectIds);
    const unitIds = ((units || []) as { id: string }[]).map((u) => u.id);
    if (unitIds.length) {
      const { data: ob } = await supabase.from('builder_opening_balances')
        .select('cumulative_value_taxed').in('unit_id', unitIds);
      carriedIn = ((ob || []) as { cumulative_value_taxed: number }[])
        .reduce((s, o) => s + (Number(o.cumulative_value_taxed) || 0), 0);
    }
  }

  const leg = (t: string) => (t === 'ADVANCE_11A' ? 'received' : t === 'ADVANCE_11B' || t === 'OPENING_11B' ? 'adjusted' : 'reversed');
  const before = rows.filter((r) => pkey(r.period_month) < firstKey)
    .reduce((s, r) => s + (Number(r.consideration) || 0), 0);
  const broughtForwardOpening = r2(carriedIn + before);

  let running = broughtForwardOpening;
  const months: RollforwardMonth[] = periods.map((p) => {
    const inMonth = rows.filter((r) => r.period_month === p);
    const sum = (k: string, f: (r: Row) => number) => r2(inMonth.filter((r) => leg(r.source_type) === k).reduce((s, r) => s + f(r), 0));
    const cons = (r: Row) => Number(r.consideration) || 0;
    const tax = (r: Row) => (Number(r.cgst) || 0) + (Number(r.sgst) || 0);
    // Reversals and adjustments are stored negative; shown as positive movements out.
    const m: RollforwardMonth = {
      periodMonth: p,
      opening: r2(running),
      received: sum('received', cons),
      reversed: r2(-sum('reversed', cons)),
      adjusted: r2(-sum('adjusted', cons)),
      closing: 0,
      receivedTax: sum('received', tax),
      reversedTax: r2(-sum('reversed', tax)),
      adjustedTax: r2(-sum('adjusted', tax)),
    };
    m.closing = r2(m.opening + m.received - m.reversed - m.adjusted);
    running = m.closing;
    return m;
  });
  const tot = (f: (m: RollforwardMonth) => number) => r2(months.reduce((s, m) => s + f(m), 0));
  return {
    fy: params.fy,
    broughtForwardOpening,
    months,
    totals: {
      received: tot((m) => m.received), reversed: tot((m) => m.reversed), adjusted: tot((m) => m.adjusted),
      receivedTax: tot((m) => m.receivedTax), reversedTax: tot((m) => m.reversedTax), adjustedTax: tot((m) => m.adjustedTax),
    },
    closing: r2(running),
  };
}

// ─── 10. ITC reversal at completion (Rule 42 / 43) ──────────────────────────

export interface ItcReversalReport {
  status: string;
  /** True when the figures are the frozen result of a submitted working. */
  frozen: boolean;
  completionDate: string;
  startFy: string;
  buFy: string;
  postingPeriod: string;
  totalCarpet: number;
  exemptCarpet: number;
  basisNote: string | null;
  result: import('@/utils/builderItcReversal').WorkingResult;
}

export async function fetchItcReversalReport(projectId: string, buEventId: string): Promise<ItcReversalReport | null> {
  const [{ fetchWorking, toYearInput }, { computeItcReversal }] = await Promise.all([
    import('@/lib/builderItcReversalData'),
    import('@/utils/builderItcReversal'),
  ]);
  const { working, years } = await fetchWorking(projectId, buEventId);
  if (!working) return null;
  const frozen = !!working.result && working.status !== 'DRAFT';
  const result = frozen && working.result ? working.result : computeItcReversal({
    completionDate: working.completion_date,
    totalCarpet: Number(working.total_carpet_sqm) || 0,
    exemptCarpet: Number(working.exempt_carpet_sqm) || 0,
    postingPeriod: working.posting_period,
    includeInterest: working.include_interest,
    years: years.map(toYearInput),
    references: {},
  });
  return {
    status: working.status,
    frozen,
    completionDate: working.completion_date,
    startFy: working.start_fy,
    buFy: working.bu_fy,
    postingPeriod: working.posting_period,
    totalCarpet: Number(working.total_carpet_sqm) || 0,
    exemptCarpet: Number(working.exempt_carpet_sqm) || 0,
    basisNote: working.basis_note,
    result,
  };
}

export async function fetchItcReversalEvents(projectId: string) {
  const { data } = await supabase.from('builder_itc_reversal_workings')
    .select('bu_event_id, completion_date, status').eq('project_id', projectId)
    .order('completion_date', { ascending: false });
  return ((data || []) as unknown as { bu_event_id: string | null; completion_date: string; status: string }[])
    .filter((w) => !!w.bu_event_id) as { bu_event_id: string; completion_date: string; status: string }[];
}

// ─── 11. Re-rating & DRC-03 register ────────────────────────────────────────

export interface Drc03RegisterLine {
  unitNo: string;
  triggeredOn: string;
  fromRatePct: number;
  toRatePct: number;
  grossBefore: number;
  grossAfter: number;
  postingPeriod: string;
  dischargeMode: string;
  status: string;
  valueRetaxed: number;
  differentialTax: number;
  interest: number;
  drc03Status: string;
  drc03Arn: string | null;
  drc03FiledDate: string | null;
}

export async function fetchDrc03Register(projectId: string): Promise<Drc03RegisterLine[]> {
  const { data: units } = await supabase.from('builder_units').select('id, unit_no').eq('project_id', projectId);
  const unitRows = (units || []) as { id: string; unit_no: string }[];
  if (!unitRows.length) return [];
  const noOf = new Map(unitRows.map((u) => [u.id, u.unit_no]));
  const { data } = await supabase.from('builder_reclassifications').select('*')
    .in('unit_id', unitRows.map((u) => u.id)).order('triggered_on');
  type R = Record<string, unknown>;
  return ((data || []) as R[]).map((r) => ({
    unitNo: noOf.get(r.unit_id as string) || '—',
    triggeredOn: (r.triggered_on as string) || '',
    fromRatePct: Number(r.from_rate_pct) || 0,
    toRatePct: Number(r.to_rate_pct) || 0,
    grossBefore: Number(r.gross_before) || 0,
    grossAfter: Number(r.gross_after) || 0,
    postingPeriod: (r.posting_period as string) || '',
    dischargeMode: (r.discharge_mode as string) || '',
    status: (r.status as string) || '',
    valueRetaxed: Number(r.total_value_retaxed) || 0,
    differentialTax: Number(r.total_differential_tax) || 0,
    interest: Number(r.total_interest) || 0,
    drc03Status: (r.drc03_status as string) || '',
    drc03Arn: (r.drc03_arn as string) || null,
    drc03FiledDate: (r.drc03_filed_date as string) || null,
  }));
}
