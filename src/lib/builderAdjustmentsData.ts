import { supabase } from '@/integrations/supabase/client';
import {
  classifyUnit, computeTax, testRrep,
  type BuilderRateCode, type ChargeInclusionSettings,
} from '@/utils/builderRates';
import { computeUnitLedger } from '@/utils/builderLedger';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import {
  buildReclassSchedule, creditNoteWindow, planBounceOffsets,
  type OffsetCandidate, type ReclassSchedule,
} from '@/utils/builderAdjustments';

const currentPeriod = (): string => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

// Data access for the corrections layer. Detection is deliberately derived from
// what was actually POSTED rather than from stored flags — a unit needs
// re-rating because 1.5% entries exist in the returns, not because a column
// says so.
//
// A crossing only ever needs a FORMAL correction (this Table 10 amendment
// mechanism) for a period whose GSTR-1 has already been filed — that return
// is closed, so the only way to fix it is to amend it. For a period that
// hasn't been filed yet, there is nothing to amend: the original receipt/
// invoice can simply be corrected in place before the return is ever
// generated (see resyncUnfiledPostings below). Conflating the two used to
// mean a crossing detected minutes after a data-entry mistake permanently
// locked a unit at the wrong rate forever, even once the mistake was fixed —
// this split is what stops that.

/** GSTR-1 periods already Filed for this client — the only ones a crossing
 *  needs a Table 10 amendment for. */
export async function fetchFiledPeriods(clientId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('filing_status')
    .select('period_month')
    .eq('client_id', clientId)
    .eq('return_type', 'GSTR-1')
    .eq('status', 'Filed');
  if (error) throw error;
  return new Set(((data || []) as { period_month: string }[]).map((r) => r.period_month));
}

export interface ReclassCandidate {
  unitId: string;
  unitNo: string;
  currentRateCode: BuilderRateCode;
  currentRatePct: number;
  grossConsideration: number;
  periods: { periodMonth: string; taxableValue: number }[];
  totalTaxableAtOldRate: number;
}

/**
 * Units carrying affordable-rate entries in ALREADY-FILED returns whose
 * current classification is no longer affordable — the only case a formal
 * Table 10 amendment is needed for. A crossing whose affected periods are
 * all still unfiled produces no candidate here; resyncUnfiledPostings()
 * handles those by correcting the postings directly instead.
 *
 * The trigger is always the Rs. 45 lakh limb — carpet area is physical and
 * cannot move. Typically a PLC, parking or club charge added long after
 * booking quietly pushes the unit over.
 */
export async function findReclassCandidates(
  projectId: string,
  classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }>,
  filedPeriods: Set<string>,
): Promise<ReclassCandidate[]> {
  const { data } = await supabase
    .from('builder_period_postings')
    .select('unit_id, unit_no, period_month, rate_code, taxable_value')
    .eq('project_id', projectId)
    .eq('rate_code', 'AFFORDABLE');

  type Row = { unit_id: string; unit_no: string; period_month: string; taxable_value: number };
  const rows = (data || []) as unknown as Row[];

  const byUnit = new Map<string, ReclassCandidate>();
  rows.forEach((r) => {
    const cls = classification[r.unit_id];
    // Still affordable, or unknown — nothing to correct.
    if (!cls || cls.rateCode === 'AFFORDABLE') return;
    // Not filed yet — resyncUnfiledPostings() will just correct it in place.
    if (!filedPeriods.has(r.period_month)) return;

    const entry = byUnit.get(r.unit_id) || {
      unitId: r.unit_id,
      unitNo: r.unit_no,
      currentRateCode: cls.rateCode as BuilderRateCode,
      currentRatePct: cls.ratePct,
      grossConsideration: cls.agreementValue,
      periods: [],
      totalTaxableAtOldRate: 0,
    };
    const existing = entry.periods.find((p) => p.periodMonth === r.period_month);
    const tv = Number(r.taxable_value) || 0;
    if (existing) existing.taxableValue += tv;
    else entry.periods.push({ periodMonth: r.period_month, taxableValue: tv });
    entry.totalTaxableAtOldRate += tv;
    byUnit.set(r.unit_id, entry);
  });

  // Net positives only: an 11B reversal can cancel out an 11A entry, leaving
  // nothing actually taxed at the old rate.
  return [...byUnit.values()]
    .map((c) => ({
      ...c,
      periods: c.periods.filter((p) => p.taxableValue > 0.005),
      totalTaxableAtOldRate: Math.round((c.totalTaxableAtOldRate + Number.EPSILON) * 100) / 100,
    }))
    .filter((c) => c.periods.length > 0 && c.totalTaxableAtOldRate > 0.005);
}

export function scheduleFor(
  candidate: ReclassCandidate,
  postingPeriod: string,
): ReclassSchedule {
  return buildReclassSchedule({
    periods: candidate.periods,
    fromRateCode: 'AFFORDABLE',
    toRateCode: candidate.currentRateCode,
    postingPeriod,
  });
}

/** Persist a re-rating and its period schedule, ready to post. */
export async function saveReclassification(params: {
  candidate: ReclassCandidate;
  schedule: ReclassSchedule;
  postingPeriod: string;
  reason: string;
  userId: string | null;
}): Promise<string> {
  const { candidate: c, schedule: s } = params;
  const { data, error } = await supabase.from('builder_reclassifications').insert({
    unit_id: c.unitId,
    from_rate_code: 'AFFORDABLE',
    from_rate_pct: 1.5,
    to_rate_code: c.currentRateCode,
    to_rate_pct: c.currentRatePct,
    gross_before: 0,
    gross_after: c.grossConsideration,
    reason: params.reason || null,
    posting_period: params.postingPeriod,
    total_value_retaxed: s.totalValueRetaxed,
    total_differential_tax: s.totalDifferentialTax,
    total_interest: s.totalInterest,
    created_by: params.userId,
  }).select('id').single();
  if (error) throw error;

  const { error: pErr } = await supabase.from('builder_reclassification_periods').insert(
    s.periods.map((p) => ({
      reclassification_id: data.id,
      period_month: p.periodMonth,
      taxable_value: p.taxableValue,
      old_cgst: p.oldCgst,
      old_sgst: p.oldSgst,
      new_cgst: p.newCgst,
      new_sgst: p.newSgst,
      differential_tax: p.differentialTax,
      due_date: p.dueDate || null,
      interest_days: p.interestDays,
      interest_amount: p.interestAmount,
    })),
  );
  if (pErr) throw pErr;
  return data.id;
}

/**
 * Post a re-rating with no staff review step. The firm's position (§8 of
 * BUILDER_GST_POSITIONS.md) is that a unit crossing ₹45L was never
 * affordable — nothing about the correction is a judgment call once the
 * crossing itself is detected, so it is posted directly rather than staged
 * as a DRAFT waiting on a "Post" click.
 */
async function autoPostReclassification(params: {
  candidate: ReclassCandidate;
  schedule: ReclassSchedule;
  postingPeriod: string;
  userId: string | null;
}): Promise<string> {
  const { candidate: c, schedule: s } = params;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from('builder_reclassifications').insert({
    unit_id: c.unitId,
    from_rate_code: 'AFFORDABLE',
    from_rate_pct: 1.5,
    to_rate_code: c.currentRateCode,
    to_rate_pct: c.currentRatePct,
    gross_before: 0,
    gross_after: c.grossConsideration,
    reason: 'Auto-posted: gross consideration crossed ₹45,00,000 — the affordable concession never applied.',
    posting_period: params.postingPeriod,
    total_value_retaxed: s.totalValueRetaxed,
    total_differential_tax: s.totalDifferentialTax,
    total_interest: s.totalInterest,
    status: 'POSTED',
    posted_at: nowIso,
    posted_by: params.userId,
    created_by: params.userId,
  }).select('id').single();
  if (error) throw error;

  const { error: pErr } = await supabase.from('builder_reclassification_periods').insert(
    s.periods.map((p) => ({
      reclassification_id: data.id,
      period_month: p.periodMonth,
      taxable_value: p.taxableValue,
      old_cgst: p.oldCgst,
      old_sgst: p.oldSgst,
      new_cgst: p.newCgst,
      new_sgst: p.newSgst,
      differential_tax: p.differentialTax,
      due_date: p.dueDate || null,
      interest_days: p.interestDays,
      interest_amount: p.interestAmount,
    })),
  );
  if (pErr) throw pErr;
  return data.id;
}

/**
 * Correct a unit's UNFILED receipts and invoices to its current
 * classification, in place.
 *
 * No amendment is needed here — nothing has been filed yet, so the original
 * document can simply carry the right figures once generation is due. Only
 * touches rows whose own `rate_code` disagrees with the target and whose
 * period is not in `filedPeriods`; a filed period's rows are left exactly as
 * filed (the DB trigger blocks writing to them anyway) and picked up by
 * `findReclassCandidates`/the Table 10 flow instead.
 *
 * Excludes DELAY_INTEREST invoices — they follow the client's own delay-
 * interest rate election, not the unit's classification.
 *
 * Known gap: does not touch `builder_advance_adjustments` rows that already
 * absorbed part of a resynced receipt into an invoice (11B). Those keep the
 * consideration/tax split computed at the time the invoice was raised. This
 * only matters if a unit's classification moves again in the same window an
 * invoice has already absorbed one of its receipts — narrow enough to flag
 * rather than build for now.
 */
export async function resyncUnfiledPostings(params: {
  unitId: string;
  targetRateCode: BuilderRateCode;
  filedPeriods: Set<string>;
}): Promise<{ receiptsUpdated: number; invoicesUpdated: number }> {
  const { unitId, targetRateCode, filedPeriods } = params;

  const [{ data: rcp }, { data: inv }] = await Promise.all([
    supabase.from('builder_receipts')
      .select('id, consideration, period_month')
      .eq('unit_id', unitId).neq('rate_code', targetRateCode),
    supabase.from('builder_invoices')
      .select('id, consideration, period_month')
      .eq('unit_id', unitId).neq('rate_code', targetRateCode).neq('invoice_type', 'DELAY_INTEREST'),
  ]);

  type Row = { id: string; consideration: number; period_month: string };
  const staleReceipts = ((rcp || []) as Row[]).filter((r) => !filedPeriods.has(r.period_month));
  const staleInvoices = ((inv || []) as Row[]).filter((r) => !filedPeriods.has(r.period_month));

  let receiptsUpdated = 0;
  for (const r of staleReceipts) {
    const t = computeTax(r.consideration, targetRateCode);
    const { error } = await supabase.from('builder_receipts').update({
      rate_code: targetRateCode, rate_pct: t.ratePct,
      taxable_value: t.taxableValue, cgst: t.cgst, sgst: t.sgst,
    }).eq('id', r.id);
    if (!error) receiptsUpdated++;
  }

  let invoicesUpdated = 0;
  for (const i of staleInvoices) {
    const t = computeTax(i.consideration, targetRateCode);
    const { error } = await supabase.from('builder_invoices').update({
      rate_code: targetRateCode, rate_pct: t.ratePct,
      taxable_value: t.taxableValue, cgst: t.cgst, sgst: t.sgst,
    }).eq('id', i.id);
    if (!error) invoicesUpdated++;
  }

  return { receiptsUpdated, invoicesUpdated };
}

export interface ReclassifySweepResult {
  /** Filed-period corrections posted as a formal Table 10 amendment. */
  posted: ReclassCandidate[];
  /** Units whose unfiled postings were corrected in place, no amendment. */
  resynced: { unitId: string; receiptsUpdated: number; invoicesUpdated: number }[];
}

/**
 * Detect and fix every re-rating a project currently needs, given a
 * classification map the caller has already computed.
 *
 * Splits on whether a unit's affected periods are filed: a filed period gets
 * a formal Table 10 amendment (skipped if one is already ACTIVE — POSTED,
 * not REVERSED — so this never double-posts); an unfiled period is corrected
 * directly via resyncUnfiledPostings(), for every unit in `classification`,
 * not just the ones with a filed-period mismatch — a unit can be resynced
 * many times over its life as staff correct entries, with no Table 10
 * involved at all until something is actually filed.
 */
export async function autoReclassifyProject(
  projectId: string,
  classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }>,
  userId: string | null,
  clientId: string,
): Promise<ReclassifySweepResult> {
  const unitIds = Object.keys(classification);
  if (!unitIds.length) return { posted: [], resynced: [] };

  const filedPeriods = await fetchFiledPeriods(clientId);

  const { data: existing } = await supabase
    .from('builder_reclassifications').select('unit_id').in('unit_id', unitIds).neq('status', 'REVERSED');
  const done = new Set(((existing || []) as { unit_id: string }[]).map((r) => r.unit_id));

  const candidates = (await findReclassCandidates(projectId, classification, filedPeriods))
    .filter((c) => !done.has(c.unitId));

  const postingPeriod = currentPeriod();
  for (const c of candidates) {
    const schedule = scheduleFor(c, postingPeriod);
    await autoPostReclassification({ candidate: c, schedule, postingPeriod, userId });
  }

  const resynced: ReclassifySweepResult['resynced'] = [];
  for (const unitId of unitIds) {
    const cls = classification[unitId];
    const r = await resyncUnfiledPostings({
      unitId, targetRateCode: cls.rateCode as BuilderRateCode, filedPeriods,
    });
    if (r.receiptsUpdated + r.invoicesUpdated > 0) resynced.push({ unitId, ...r });
  }

  return { posted: candidates, resynced };
}

/**
 * Void a POSTED reclassification: it and its Table 10 legs drop out of
 * `builder_period_postings` (every branch there already filters
 * `WHERE rc.status = 'POSTED'`), and the unit's live classification governs
 * again from this point on.
 *
 * Deliberately does NOT attempt to rewrite any builder_receipts/
 * builder_invoices row whose own rate_code may have been overwritten by an
 * edit made while the unit was locked — `handleSaveReceipt`/`handleSaveInvoice`
 * rewrite the derived tax on every save, so a receipt touched during the
 * locked window can carry the higher rate directly, not just via the Table 10
 * overlay. There is no reliable way to reconstruct "what it was before" from
 * `builder_reclassification_periods` alone, so the caller is responsible for
 * checking the affected unit's postings after reversing and re-saving any
 * that still carry the old (now-wrong) rate by hand.
 */
export async function reverseReclassification(params: {
  reclassificationId: string;
  reason: string;
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('builder_reclassifications')
    .update({
      status: 'REVERSED',
      reversed_at: new Date().toISOString(),
      reversed_by: params.userId,
      reversal_reason: params.reason || null,
    })
    .eq('id', params.reclassificationId)
    .eq('status', 'POSTED');
  if (error) throw error;
}

/**
 * Same as {@link autoReclassifyProject}, but self-contained — loads the
 * project, units, charges, settings and RREP test itself, for callers (e.g.
 * Builder Returns' Generate) that don't already have a classification map on
 * hand. This is the safety net: whichever page a unit actually crossed ₹45L
 * on, generating the return always re-rates it first.
 */
export async function runAutoReclassSweep(
  projectId: string,
  userId: string | null,
): Promise<ReclassifySweepResult> {
  const { data: proj } = await supabase
    .from('builder_projects').select('*').eq('id', projectId).maybeSingle();
  if (!proj) return { posted: [], resynced: [] };
  const p = proj as unknown as {
    client_id: string; is_metro: boolean; carpet_area_source: string;
    manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  };

  const { data: unt } = await supabase.from('builder_units').select('*').eq('project_id', projectId);
  type Unit = {
    id: string; unit_type: 'Residential' | 'Commercial'; carpet_area_sqm: number;
    base_consideration: number; status: string;
  };
  const units = (unt || []) as unknown as Unit[];
  if (!units.length) return { posted: [], resynced: [] };
  const unitIds = units.map((u) => u.id);

  const [settings, { data: chg }, { data: rcp }, { data: inv }, { data: opn }] = await Promise.all([
    fetchBuilderSettings(p.client_id),
    supabase.from('builder_unit_charges').select('*').in('unit_id', unitIds),
    supabase.from('builder_receipts').select('*').in('unit_id', unitIds),
    supabase.from('builder_invoices').select('*').in('unit_id', unitIds),
    supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
  ]);
  type Charge = { unit_id: string; charge_head: string; amount: number; include_override: boolean | null };
  const cmap: Record<string, Charge[]> = {};
  ((chg || []) as unknown as Charge[]).forEach((c) => { (cmap[c.unit_id] ||= []).push(c); });

  type Receipt = {
    unit_id: string; consideration: number; cgst: number; sgst: number; tds_194ia: number;
    bank_credit: number | null; receipt_nature: string; cheque_status: string;
    gst_already_discharged: boolean; subsumed_by_bu_event_id: string | null;
  };
  const rmap: Record<string, Receipt[]> = {};
  ((rcp || []) as unknown as Receipt[]).forEach((r) => { (rmap[r.unit_id] ||= []).push(r); });

  type Invoice = { unit_id: string; id: string; consideration: number; cgst: number; sgst: number };
  const imap: Record<string, Invoice[]> = {};
  ((inv || []) as unknown as Invoice[]).forEach((i) => { (imap[i.unit_id] ||= []).push(i); });

  type Opening = {
    unit_id: string; agreement_value: number; cumulative_value_taxed: number;
    cumulative_cgst: number; cumulative_sgst: number; cumulative_receipts: number;
    cumulative_tds_194ia: number;
  };
  const omap: Record<string, Opening> = {};
  ((opn || []) as unknown as Opening[]).forEach((o) => { omap[o.unit_id] = o; });

  const invoiceIds = ((inv || []) as unknown as Invoice[]).map((i) => i.id);
  const { data: adj } = invoiceIds.length
    ? await supabase.from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds)
    : { data: [] };
  type Adjustment = { invoice_id: string; consideration_adjusted: number; cgst: number; sgst: number };
  const adjustments = (adj || []) as unknown as Adjustment[];

  let resi = 0, comm = 0;
  if (p.carpet_area_source === 'MANUAL') {
    resi = Number(p.manual_residential_carpet_sqm) || 0;
    comm = Number(p.manual_commercial_carpet_sqm) || 0;
  } else {
    units.forEach((u) => {
      if (u.status === 'Cancelled') return;
      if (u.unit_type === 'Residential') resi += Number(u.carpet_area_sqm) || 0;
      else comm += Number(u.carpet_area_sqm) || 0;
    });
  }
  const rrep = testRrep(resi, comm);

  const classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }> = {};
  units.forEach((u) => {
    const invIds = new Set((imap[u.id] || []).map((i) => i.id));
    const unitAdjustments = adjustments.filter((a) => invIds.has(a.invoice_id));
    // knownConsideration: money already recognised (opening + receipts/
    // invoices to date) — see classifyUnit()'s doc comment. agreementValue
    // is irrelevant to considerationRecognized, so 0 is fine here.
    const prelimLedger = computeUnitLedger({
      agreementValue: 0,
      opening: omap[u.id],
      receipts: (rmap[u.id] || []).map((r) => ({
        consideration: r.consideration, cgst: r.cgst, sgst: r.sgst,
        tds_194ia: r.tds_194ia, bank_credit: r.bank_credit,
        receipt_nature: r.receipt_nature as never, cheque_status: r.cheque_status as never,
        gst_already_discharged: r.gst_already_discharged,
        subsumed_by_bu_event_id: r.subsumed_by_bu_event_id,
      })),
      invoices: (imap[u.id] || []).map((i) => ({ consideration: i.consideration, cgst: i.cgst, sgst: i.sgst })),
      adjustments: unitAdjustments.map((a) => ({
        consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
      })),
    });
    const cls = classifyUnit({
      unitType: u.unit_type,
      carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
      baseConsideration: Number(u.base_consideration) || 0,
      charges: (cmap[u.id] || []).map((c) => ({
        charge_head: c.charge_head as never, amount: Number(c.amount) || 0,
        include_override: c.include_override,
      })),
      isMetro: p.is_metro ?? false,
      isRrep: rrep.isRrep,
      settings: settings as ChargeInclusionSettings,
      knownConsideration: prelimLedger.considerationRecognized,
    });
    classification[u.id] = { rateCode: cls.rateCode, ratePct: cls.ratePct, agreementValue: cls.gross.gross };
  });

  return autoReclassifyProject(projectId, classification, userId, p.client_id);
}

// ─── Bounce reversals ───────────────────────────────────────────────────────

/**
 * Raise a reversal for a receipt that bounced after its return was filed.
 *
 * Only valid on an un-invoiced advance. Where the amount was invoiced and the
 * booking stands, there is no s.34 ground — the sale did not change, the
 * payment failed — and GST has no bad-debt relief, so the liability stays.
 */
export async function raiseBounceReversal(params: {
  receipt: {
    id: string; unit_id: string; period_month: string; rate_code: string; rate_pct: number;
    consideration: number; taxable_value: number; cgst: number; sgst: number;
  };
  projectId: string;
  bouncedOn: string;
  userId: string | null;
}): Promise<void> {
  const r = params.receipt;
  const { error } = await supabase.from('builder_bounce_reversals').insert({
    receipt_id: r.id,
    unit_id: r.unit_id,
    project_id: params.projectId,
    bounced_on: params.bouncedOn,
    original_period: r.period_month,
    rate_code: r.rate_code,
    rate_pct: r.rate_pct,
    consideration: r.consideration,
    taxable_value: r.taxable_value,
    cgst: r.cgst,
    sgst: r.sgst,
    created_by: params.userId,
  });
  if (error) throw error;
}

/**
 * Months with positive Table 11A consideration at the same rate in the same
 * project, net of offsets already taken — what a reversal can be set against.
 */
export async function findOffsetCandidates(params: {
  projectId: string;
  rateCode: string;
  afterPeriod: string;
}): Promise<OffsetCandidate[]> {
  const { data } = await supabase
    .from('builder_period_postings')
    .select('period_month, consideration, source_type')
    .eq('project_id', params.projectId)
    .eq('rate_code', params.rateCode)
    // Cancellation set-offs (builderCancellationData.ts) draw on the exact
    // same per-period pool a bounce offset would — both must net out of the
    // same total, or the two mechanisms could jointly push a period negative
    // even though each looked capped on its own.
    .in('source_type', ['ADVANCE_11A', 'BOUNCE_REVERSAL', 'CANCELLATION_OFFSET']);

  type Row = { period_month: string; consideration: number; source_type: string };
  const byPeriod = new Map<string, number>();
  ((data || []) as unknown as Row[]).forEach((r) => {
    byPeriod.set(r.period_month, (byPeriod.get(r.period_month) || 0) + (Number(r.consideration) || 0));
  });

  const key = (p: string) => {
    const m = /^(\d{1,2})\/(\d{4})$/.exec(p || '');
    return m ? `${m[2]}${m[1].padStart(2, '0')}` : '';
  };
  const after = key(params.afterPeriod);

  return [...byPeriod.entries()]
    .filter(([period, available]) => key(period) > after && available > 0.005)
    .map(([periodMonth, available]) => ({
      periodMonth,
      available: Math.round((available + Number.EPSILON) * 100) / 100,
    }));
}

/**
 * Positive Table 11A pool at this rate, in this exact period — what a
 * cancellation refund set-off (builderCancellationData.ts) can draw against.
 * Single period only, unlike findOffsetCandidates' forward scan: a refund's
 * offset is capped to the month it's actually paid in, nothing carries.
 */
export async function findAvailableInPeriod(params: {
  projectId: string;
  rateCode: string;
  periodMonth: string;
}): Promise<number> {
  const { data } = await supabase
    .from('builder_period_postings')
    .select('consideration')
    .eq('project_id', params.projectId)
    .eq('rate_code', params.rateCode)
    .eq('period_month', params.periodMonth)
    .in('source_type', ['ADVANCE_11A', 'BOUNCE_REVERSAL', 'CANCELLATION_OFFSET']);
  const total = ((data || []) as { consideration: number }[])
    .reduce((s, r) => s + (Number(r.consideration) || 0), 0);
  return Math.max(0, Math.round((total + Number.EPSILON) * 100) / 100);
}

/** Allocate a reversal across later months and record what was taken. */
export async function applyBounceOffsets(params: {
  reversalId: string;
  remaining: number;
  rateCode: BuilderRateCode;
  candidates: OffsetCandidate[];
  alreadyAdjusted: number;
  totalConsideration: number;
  userId: string | null;
}): Promise<{ applied: number; carriedForward: number }> {
  const plan = planBounceOffsets({
    reversalConsideration: params.remaining,
    rateCode: params.rateCode,
    candidates: params.candidates,
  });
  if (plan.offsets.length) {
    const { error } = await supabase.from('builder_bounce_offsets').insert(
      plan.offsets.map((o) => ({
        reversal_id: params.reversalId,
        period_month: o.periodMonth,
        consideration: o.consideration,
        taxable_value: o.taxableValue,
        cgst: o.cgst,
        sgst: o.sgst,
        created_by: params.userId,
      })),
    );
    if (error) throw error;
  }
  const adjusted = Math.round((params.alreadyAdjusted + plan.applied + Number.EPSILON) * 100) / 100;
  await supabase.from('builder_bounce_reversals').update({
    adjusted_value: adjusted,
    status: adjusted >= params.totalConsideration - 0.005
      ? 'ADJUSTED' : adjusted > 0.005 ? 'PARTIAL' : 'OPEN',
  }).eq('id', params.reversalId);

  return { applied: plan.applied, carriedForward: plan.carriedForward };
}

// ─── Credit notes ───────────────────────────────────────────────────────────

/**
 * Raise a credit note.
 *
 * The window is measured from the ORIGINAL document's date, not today's. Past
 * it the note is still recorded — the trail matters — but flagged out of window
 * and excluded from the postings feed, because the tax cannot be adjusted.
 */
export async function raiseCreditNote(params: {
  unitId: string;
  bookingId: string | null;
  noteDate: string;
  noteType: 'CANCELLATION' | 'CONVERSION' | 'DASTAVEJ_VARIANCE' | 'OTHER';
  consideration: number;
  rateCode: BuilderRateCode;
  originalDocDate: string;
  periodMonth: string;
  docSeries: string | null;
  docNo: string | null;
  reason: string | null;
  userId: string | null;
}): Promise<{ id: string; withinWindow: boolean; expiryLabel: string }> {
  const win = creditNoteWindow(params.originalDocDate, params.noteDate);
  const t = computeTax(params.consideration, params.rateCode);
  const { data, error } = await supabase.from('builder_credit_notes').insert({
    unit_id: params.unitId,
    booking_id: params.bookingId,
    note_date: params.noteDate,
    note_type: params.noteType,
    consideration: t.consideration,
    rate_code: params.rateCode,
    rate_pct: t.ratePct,
    taxable_value: t.taxableValue,
    cgst: t.cgst,
    sgst: t.sgst,
    window_expiry: win.expiry || null,
    within_window: win.isOpen,
    period_month: params.periodMonth,
    doc_series: params.docSeries,
    doc_no: params.docNo,
    reason: params.reason,
    created_by: params.userId,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id, withinWindow: win.isOpen, expiryLabel: win.expiryLabel };
}

// ─── Excess tax ─────────────────────────────────────────────────────────────

/**
 * Restate a receipt taxed on its GST-inclusive figure, and book the excess.
 *
 * The restatement lowers the receipt's consideration, which lowers the unit's
 * value taxed, which RAISES its BU differential by the same amount. Both moves
 * are intended: the tax was overstated and the taxable base understated by the
 * grossed-up portion.
 */
export async function restateReceipt(params: {
  receipt: {
    id: string; unit_id: string; amount_entered: number; consideration: number;
    cgst: number; sgst: number; rate_code: string;
  };
  projectId: string;
  restated: {
    restatedConsideration: number; taxableValue: number; cgst: number; sgst: number;
    excessTax: number; originalTax: number; restatedTax: number;
  };
  treatment: 'ADJUST' | 'REFUND' | 'ABSORB';
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('builder_receipts').update({
    amount_is_gst_inclusive: true,
    consideration: params.restated.restatedConsideration,
    taxable_value: params.restated.taxableValue,
    cgst: params.restated.cgst,
    sgst: params.restated.sgst,
  }).eq('id', params.receipt.id);
  if (error) throw error;

  const { error: eErr } = await supabase.from('builder_excess_tax').insert({
    receipt_id: params.receipt.id,
    unit_id: params.receipt.unit_id,
    project_id: params.projectId,
    original_consideration: params.receipt.consideration,
    restated_consideration: params.restated.restatedConsideration,
    original_tax: params.restated.originalTax,
    restated_tax: params.restated.restatedTax,
    excess_tax: params.restated.excessTax,
    treatment: params.treatment,
    created_by: params.userId,
  });
  if (eErr) throw eErr;
}
