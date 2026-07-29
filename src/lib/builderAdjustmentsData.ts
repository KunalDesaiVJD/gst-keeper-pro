import { supabase } from '@/integrations/supabase/client';
import { computeTax, type BuilderRateCode } from '@/utils/builderRates';
import {
  buildReclassSchedule, creditNoteWindow, planBounceOffsets,
  type OffsetCandidate, type ReclassSchedule,
} from '@/utils/builderAdjustments';

// Data access for the corrections layer. Detection is deliberately derived from
// what was actually POSTED rather than from stored flags — a unit needs
// re-rating because 1.5% entries exist in the returns, not because a column
// says so.

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
 * Units carrying affordable-rate entries in the returns whose current
 * classification is no longer affordable.
 *
 * The trigger is always the Rs. 45 lakh limb — carpet area is physical and
 * cannot move. Typically a PLC, parking or club charge added long after
 * booking quietly pushes the unit over.
 */
export async function findReclassCandidates(
  projectId: string,
  classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }>,
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
    .in('source_type', ['ADVANCE_11A', 'BOUNCE_REVERSAL']);

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
