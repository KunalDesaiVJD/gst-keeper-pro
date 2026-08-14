import { supabase } from '@/integrations/supabase/client';
import { type BuilderRateCode } from '@/utils/builderRates';
import { summarisePeriod, type PeriodSummary, type PostingRow } from '@/utils/builderLedger';

// Data shaping for the builder working papers.
//
// Every figure here is read back from what the engines already computed and
// stored — the BU event's own unit rows, the postings feed, the FSI working.
// Nothing is recalculated for the report, so a working paper can never disagree
// with the return it supports.

export type ReportKind =
  | 'BU_WORKING'
  | 'PROJECT_LIABILITY'
  | 'UNIT_LEDGER'
  | 'RETURN_WORKPAPER'
  | 'MEMBER_STATEMENT';

export const REPORT_LABEL: Record<ReportKind, string> = {
  BU_WORKING: 'Unit-wise BU working',
  PROJECT_LIABILITY: 'Project monthly liability',
  UNIT_LEDGER: 'Unit ledger',
  RETURN_WORKPAPER: 'Monthly return workpaper',
  MEMBER_STATEMENT: 'Member statement',
};

export const REPORT_DESCRIPTION: Record<ReportKind, string> = {
  BU_WORKING: "Every unit in a BU event: its cut-off, whether it was booked at that date, and the differential.",
  PROJECT_LIABILITY: 'One project, one period — the outward legs and the FSI reverse charge behind them.',
  UNIT_LEDGER: 'Every receipt, invoice and adjustment on a unit, with the running value taxed.',
  RETURN_WORKPAPER: 'What the client contributes to GSTR-1 and 3B for a period, with the documents behind it.',
  MEMBER_STATEMENT: 'A client-facing statement of one unit: what was agreed, paid, charged and remains.',
};

export interface ReportContext {
  clientName: string;
  clientGstin: string;
  projectName?: string;
  reraNumber?: string;
  periodMonth?: string;
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
    openAdvanceBefore: Number(r.open_advance_before) || 0,
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
