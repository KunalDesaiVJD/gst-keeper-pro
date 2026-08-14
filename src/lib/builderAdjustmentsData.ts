import { supabase } from '@/integrations/supabase/client';
import {
  classifyUnit, computeTax, testRrep, NOTIFIED_RATE_PCT, RATE_CODE_LABEL,
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

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
  /** The rate the affected periods were actually filed at. */
  oldRateCode: BuilderRateCode;
  currentRateCode: BuilderRateCode;
  currentRatePct: number;
  grossConsideration: number;
  periods: { periodMonth: string; taxableValue: number }[];
  totalTaxableAtOldRate: number;
}

/**
 * Units carrying ALREADY-FILED postings at a rate that no longer matches
 * their current live classification — the only case a formal Table 10
 * amendment is needed for. A crossing whose affected periods are all still
 * unfiled produces no candidate here; resyncUnfiledPostings() handles those
 * by correcting the postings directly instead.
 *
 * Not scoped to any one rate code: the Rs. 45 lakh affordable ceiling is the
 * most common trigger (a PLC, parking or club charge added long after
 * booking quietly pushes a residential unit over it), but a project's
 * commercial mix crossing the 15% RREP/REP threshold moves EVERY commercial
 * unit's rate at once, and is exactly as real a mismatch. Both are just "what
 * got filed no longer equals what the unit currently classifies as" — this
 * used to only check for the affordable case specifically (`.eq('rate_code',
 * 'AFFORDABLE')`), which is why a commercial RREP→REP move on Shree Maruti
 * Infra (14/08/2026) was invisible to this sweep even after the project's
 * carpet area mix was corrected — see resyncUnfiledPostings()'s doc comment
 * for the unfiled half of that same incident.
 */
export async function findReclassCandidates(
  projectId: string,
  classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }>,
  filedPeriods: Set<string>,
): Promise<ReclassCandidate[]> {
  const { data } = await supabase
    .from('builder_period_postings')
    .select('unit_id, unit_no, period_month, rate_code, taxable_value')
    .eq('project_id', projectId);

  type Row = {
    unit_id: string; unit_no: string; period_month: string; rate_code: string; taxable_value: number;
  };
  const rows = (data || []) as unknown as Row[];

  const byUnit = new Map<string, ReclassCandidate>();
  rows.forEach((r) => {
    const cls = classification[r.unit_id];
    // What was posted already agrees with the unit's current rate, or the
    // unit is unknown — nothing to correct.
    if (!cls || r.rate_code === cls.rateCode) return;
    // Not filed yet — resyncUnfiledPostings() will just correct it in place.
    if (!filedPeriods.has(r.period_month)) return;

    const entry = byUnit.get(r.unit_id) || {
      unitId: r.unit_id,
      unitNo: r.unit_no,
      oldRateCode: r.rate_code as BuilderRateCode,
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

// ─── Historical (pre-onboarding) receipts — DRC-03 ─────────────────────────
//
// A unit's history before this firm's onboarding sits only in the single-row
// builder_opening_balances snapshot — invisible to findReclassCandidates,
// which only ever reads builder_period_postings. A unit whose opening
// balance already correctly reflects a >45L position (so nothing ever posts
// as AFFORDABLE for it after onboarding) generates zero reclass candidates
// today — the crossing itself, and every year of s.50 interest that ran
// before onboarding, is silently invisible. builder_historical_receipts
// lets staff reconstruct that history by hand, date by date, only when a
// real case requires it; these periods are always treated as needing the
// DRC-03 treatment (never "unfiled resync") because they represent returns
// the firm already filed, years ago, just not through this app.

export interface HistoricalReceipt {
  id: string;
  receiptDate: string;
  amount: number;
  notes: string | null;
}

export async function fetchHistoricalReceipts(unitId: string): Promise<HistoricalReceipt[]> {
  const { data, error } = await supabase
    .from('builder_historical_receipts')
    .select('id, receipt_date, amount, notes')
    .eq('unit_id', unitId)
    .order('receipt_date', { ascending: true });
  if (error) throw error;
  type Row = { id: string; receipt_date: string; amount: number; notes: string | null };
  return ((data || []) as unknown as Row[]).map((r) => ({
    id: r.id, receiptDate: r.receipt_date, amount: Number(r.amount) || 0, notes: r.notes,
  }));
}

export async function addHistoricalReceipt(params: {
  unitId: string;
  receiptDate: string;
  amount: number;
  notes: string | null;
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('builder_historical_receipts').insert({
    unit_id: params.unitId,
    receipt_date: params.receiptDate,
    amount: params.amount,
    notes: params.notes,
    created_by: params.userId,
  });
  if (error) throw error;
}

export async function deleteHistoricalReceipt(id: string): Promise<void> {
  const { error } = await supabase.from('builder_historical_receipts').delete().eq('id', id);
  if (error) throw error;
}

export interface HistoricalReconciliation {
  historicalTotal: number;
  openingCumulativeReceipts: number;
  variance: number;
}

/** Does the manually entered date-wise history actually tally with the lump
 *  opening balance it's meant to break out? Surfaced to staff as a plain
 *  variance, not auto-forced to zero — partial history is a realistic case. */
export async function fetchHistoricalReconciliation(unitId: string): Promise<HistoricalReconciliation> {
  const [{ data: receipts }, { data: opening }] = await Promise.all([
    supabase.from('builder_historical_receipts').select('amount').eq('unit_id', unitId),
    supabase.from('builder_opening_balances').select('cumulative_receipts').eq('unit_id', unitId).maybeSingle(),
  ]);
  const historicalTotal = round2(((receipts || []) as { amount: number }[])
    .reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const openingCumulativeReceipts = round2(Number((opening as { cumulative_receipts?: number } | null)
    ?.cumulative_receipts) || 0);
  return {
    historicalTotal,
    openingCumulativeReceipts,
    variance: round2(historicalTotal - openingCumulativeReceipts),
  };
}

/**
 * Units whose manually entered historical receipts show them crossing ₹45L
 * before this firm ever tracked a posting for them — the case
 * findReclassCandidates structurally cannot see (it never reads
 * builder_historical_receipts). Buckets by receipt month and derives taxable
 * value at the AFFORDABLE rate exactly as the original (pre-onboarding)
 * filing would have — same 1/3rd land deduction this module uses everywhere.
 */
export async function findHistoricalReclassCandidates(
  classification: Record<string, { rateCode: string; ratePct: number; agreementValue: number }>,
): Promise<ReclassCandidate[]> {
  const unitIds = Object.keys(classification).filter((id) => classification[id].rateCode !== 'AFFORDABLE');
  if (!unitIds.length) return [];

  const { data } = await supabase
    .from('builder_historical_receipts')
    .select('unit_id, receipt_date, amount')
    .in('unit_id', unitIds);
  type Row = { unit_id: string; receipt_date: string; amount: number };
  const rows = (data || []) as unknown as Row[];
  if (!rows.length) return [];

  const { data: unitRows } = await supabase.from('builder_units').select('id, unit_no').in('id', unitIds);
  const unitNoOf = new Map(((unitRows || []) as { id: string; unit_no: string }[]).map((u) => [u.id, u.unit_no]));

  const byUnitPeriod = new Map<string, Map<string, number>>();
  rows.forEach((r) => {
    const m = /^(\d{4})-(\d{2})/.exec(r.receipt_date || '');
    if (!m) return;
    const periodMonth = `${m[2]}/${m[1]}`;
    const periods = byUnitPeriod.get(r.unit_id) || new Map<string, number>();
    periods.set(periodMonth, (periods.get(periodMonth) || 0) + (Number(r.amount) || 0));
    byUnitPeriod.set(r.unit_id, periods);
  });

  const candidates: ReclassCandidate[] = [];
  byUnitPeriod.forEach((periods, unitId) => {
    const cls = classification[unitId];
    const periodEntries = [...periods.entries()]
      .map(([periodMonth, amount]) => ({
        periodMonth,
        taxableValue: computeTax(round2(amount), 'AFFORDABLE').taxableValue,
      }))
      .filter((p) => p.taxableValue > 0.005);
    if (!periodEntries.length) return;
    candidates.push({
      unitId,
      unitNo: unitNoOf.get(unitId) || '',
      oldRateCode: 'AFFORDABLE',
      currentRateCode: cls.rateCode as BuilderRateCode,
      currentRatePct: cls.ratePct,
      grossConsideration: cls.agreementValue,
      periods: periodEntries,
      totalTaxableAtOldRate: round2(periodEntries.reduce((s, p) => s + p.taxableValue, 0)),
    });
  });
  return candidates;
}

/** Merge two candidate lists by unit — builder_reclassifications carries a
 *  UNIQUE(unit_id) constraint, so app-tracked and historical periods for the
 *  same unit must land in one saved row, not two. */
function mergeCandidates(a: ReclassCandidate[], b: ReclassCandidate[]): ReclassCandidate[] {
  const byUnit = new Map<string, ReclassCandidate>();
  [...a, ...b].forEach((c) => {
    const existing = byUnit.get(c.unitId);
    if (!existing) { byUnit.set(c.unitId, { ...c, periods: [...c.periods] }); return; }
    c.periods.forEach((p) => {
      const dup = existing.periods.find((e) => e.periodMonth === p.periodMonth);
      if (dup) dup.taxableValue = round2(dup.taxableValue + p.taxableValue);
      else existing.periods.push(p);
    });
    existing.totalTaxableAtOldRate = round2(existing.totalTaxableAtOldRate + c.totalTaxableAtOldRate);
  });
  return [...byUnit.values()];
}

export function scheduleFor(
  candidate: ReclassCandidate,
  postingPeriod: string,
): ReclassSchedule {
  return buildReclassSchedule({
    periods: candidate.periods,
    fromRateCode: candidate.oldRateCode,
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
    from_rate_code: c.oldRateCode,
    from_rate_pct: NOTIFIED_RATE_PCT[c.oldRateCode],
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
 * Post a re-rating with no staff review step. Once a mismatch between what
 * was filed and the unit's current live classification is detected, nothing
 * about the correction is a judgment call — the firm's position (§8 of
 * BUILDER_GST_POSITIONS.md) is that the old rate never applied, whether the
 * trigger is a residential unit crossing ₹45L or a project's commercial mix
 * crossing the 15% RREP/REP threshold — so it is posted directly rather than
 * staged as a DRAFT waiting on a "Post" click.
 */
async function autoPostReclassification(params: {
  candidate: ReclassCandidate;
  schedule: ReclassSchedule;
  postingPeriod: string;
  userId: string | null;
}): Promise<string> {
  const { candidate: c, schedule: s } = params;
  const nowIso = new Date().toISOString();
  const reason = c.oldRateCode === 'AFFORDABLE'
    ? 'Auto-posted: gross consideration crossed ₹45,00,000 — the affordable concession never applied.'
    : `Auto-posted: unit's classification moved from ${RATE_CODE_LABEL[c.oldRateCode]} to `
      + `${RATE_CODE_LABEL[c.currentRateCode]} — what was filed no longer matches its current rate.`;
  const { data, error } = await supabase.from('builder_reclassifications').insert({
    unit_id: c.unitId,
    from_rate_code: c.oldRateCode,
    from_rate_pct: NOTIFIED_RATE_PCT[c.oldRateCode],
    to_rate_code: c.currentRateCode,
    to_rate_pct: c.currentRatePct,
    gross_before: 0,
    gross_after: c.grossConsideration,
    reason,
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
 * A resynced invoice's own Table 11B adjustment legs (builder_advance_
 * adjustments and builder_opening_balance_adjustments, both keyed to
 * invoice_id) are resynced right along with it — same targetRateCode,
 * consideration_adjusted held fixed exactly like the invoice's own
 * consideration. This runs as a SEPARATE pass over every one of the unit's
 * unfiled, non-DELAY_INTEREST invoices (not just the ones whose own
 * rate_code needed updating this call) — an invoice resynced on an earlier
 * call already carries the target rate, so it would never re-enter the
 * "stale" set above, but its adjustment legs can still be the ones left
 * behind. Found exactly this live on Plot No. 148, Shree Maruti Infra,
 * 14/08/2026: an earlier commercial RREP→REP move had already resynced the
 * invoice to 18%, but its opening-balance offset was still frozen at the old
 * 5% — Table 7 and Table 11B disagreed on rate for the same invoice,
 * producing a phantom net liability that should have netted to zero.
 */
export async function resyncUnfiledPostings(params: {
  unitId: string;
  targetRateCode: BuilderRateCode;
  filedPeriods: Set<string>;
}): Promise<{ receiptsUpdated: number; invoicesUpdated: number }> {
  const { unitId, targetRateCode, filedPeriods } = params;

  const [{ data: rcp }, { data: allInv }] = await Promise.all([
    supabase.from('builder_receipts')
      .select('id, consideration, period_month')
      .eq('unit_id', unitId).neq('rate_code', targetRateCode),
    supabase.from('builder_invoices')
      .select('id, consideration, period_month, rate_code, invoice_type, milestone_label')
      .eq('unit_id', unitId).neq('invoice_type', 'DELAY_INTEREST'),
  ]);

  type Row = { id: string; consideration: number; period_month: string };
  const staleReceipts = ((rcp || []) as Row[]).filter((r) => !filedPeriods.has(r.period_month));

  type InvRow = Row & {
    rate_code: string; invoice_type: string; milestone_label: string | null;
  };
  const unfiledInvoices = ((allInv || []) as InvRow[]).filter((r) => !filedPeriods.has(r.period_month));
  const staleInvoices = unfiledInvoices.filter((r) => r.rate_code !== targetRateCode);

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

  // A BU_DIFFERENTIAL invoice's milestone_label ("BU differential — cut-off
  // ..." vs "Dastavej differential — cut-off ...") is written once, at post
  // time, from builder_bu_event_units.cut_off_source — resolveCutOff()'s
  // own <=/< off-by-one fix (13/08/2026) only corrects what NEW postings
  // compute; an already-posted invoice's label stays exactly as frozen, even
  // once its rate resyncs. Since this sweep already touches every one of the
  // unit's unfiled invoices, correct any label that disagrees with the
  // event's actual cut_off_source at the same time.
  const buInvoiceIds = unfiledInvoices.filter((i) => i.invoice_type === 'BU_DIFFERENTIAL').map((i) => i.id);
  const { data: cutOffRows } = buInvoiceIds.length
    ? await supabase.from('builder_bu_event_units')
      .select('invoice_id, cut_off_source').in('invoice_id', buInvoiceIds)
    : { data: [] };
  const cutOffByInvoice = new Map(
    ((cutOffRows || []) as { invoice_id: string; cut_off_source: string }[])
      .map((r) => [r.invoice_id, r.cut_off_source]),
  );
  for (const i of unfiledInvoices) {
    const cutOffSource = cutOffByInvoice.get(i.id);
    if (!cutOffSource || !i.milestone_label) continue;
    const expected = i.milestone_label.replace(
      /^(BU|Dastavej) differential/, `${cutOffSource === 'DASTAVEJ' ? 'Dastavej' : 'BU'} differential`,
    );
    if (expected !== i.milestone_label) {
      await supabase.from('builder_invoices').update({ milestone_label: expected }).eq('id', i.id);
    }
  }

  // Every unfiled invoice — freshly resynced above or already at the target
  // rate from an earlier call — gets its adjustment legs checked, since a
  // mismatch can be left behind either way. Batched by invoice_id IN (...)
  // rather than one query pair per invoice: a project with a couple hundred
  // units easily has that many invoices, and this sweep runs on every Ledger
  // tab load — an unbounded per-invoice round trip made the whole thing slow
  // enough on a large project (Shree Maruti Infra, ~160 units) to risk never
  // actually finishing before something (a re-render, a slow network) cut it
  // short, which is exactly how Plot 148's own adjustment leg was still
  // showing stale days after this fix first shipped.
  type AdjRow = { id: string; consideration_adjusted: number; rate_code: string; invoice_id: string };
  const invoiceIds = unfiledInvoices.map((i) => i.id);
  const [{ data: advAdjAll }, { data: openAdjAll }] = invoiceIds.length
    ? await Promise.all([
      supabase.from('builder_advance_adjustments')
        .select('id, consideration_adjusted, rate_code, invoice_id').in('invoice_id', invoiceIds),
      supabase.from('builder_opening_balance_adjustments')
        .select('id, consideration_adjusted, rate_code, invoice_id').in('invoice_id', invoiceIds),
    ])
    : [{ data: [] }, { data: [] }];

  for (const a of ((advAdjAll || []) as AdjRow[]).filter((a) => a.rate_code !== targetRateCode)) {
    const at = computeTax(a.consideration_adjusted, targetRateCode);
    await supabase.from('builder_advance_adjustments').update({
      rate_code: targetRateCode, rate_pct: at.ratePct,
      taxable_value_adjusted: at.taxableValue, cgst: at.cgst, sgst: at.sgst,
    }).eq('id', a.id);
  }
  for (const a of ((openAdjAll || []) as AdjRow[]).filter((a) => a.rate_code !== targetRateCode)) {
    const at = computeTax(a.consideration_adjusted, targetRateCode);
    await supabase.from('builder_opening_balance_adjustments').update({
      rate_code: targetRateCode, rate_pct: at.ratePct,
      taxable_value_adjusted: at.taxableValue, cgst: at.cgst, sgst: at.sgst,
    }).eq('id', a.id);
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

  const [appTracked, historical] = await Promise.all([
    findReclassCandidates(projectId, classification, filedPeriods),
    findHistoricalReclassCandidates(classification),
  ]);
  const candidates = mergeCandidates(appTracked, historical)
    .filter((c) => !done.has(c.unitId));

  // Every unit runs in isolation: one unit's failure (a network hiccup, a
  // constraint violation) must not silently strand every unit after it in
  // iteration order — a project can easily run to a couple hundred units, and
  // an unguarded loop here means one bad apple leaves the REST unswept with
  // no visible sign anything went wrong short of a generic toast upstream.
  // Exactly this shape of gap is why Plot 148's own adjustment leg was still
  // showing stale days after the fix for it first shipped.
  const postingPeriod = currentPeriod();
  for (const c of candidates) {
    try {
      const schedule = scheduleFor(c, postingPeriod);
      await autoPostReclassification({ candidate: c, schedule, postingPeriod, userId });
    } catch {
      // Leave it as a candidate — the next sweep (next Ledger tab load,
      // or Builder Returns' Generate) retries it from scratch.
    }
  }

  const resynced: ReclassifySweepResult['resynced'] = [];
  for (const unitId of unitIds) {
    const cls = classification[unitId];
    try {
      const r = await resyncUnfiledPostings({
        unitId, targetRateCode: cls.rateCode as BuilderRateCode, filedPeriods,
      });
      if (r.receiptsUpdated + r.invoicesUpdated > 0) resynced.push({ unitId, ...r });
    } catch {
      // Same reasoning — this unit's resync failed, but every other unit
      // still needs its turn.
    }
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
  const [{ data: adj }, { data: obAdj }] = invoiceIds.length
    ? await Promise.all([
      supabase.from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds),
      supabase.from('builder_opening_balance_adjustments').select('*').in('invoice_id', invoiceIds),
    ])
    : [{ data: [] }, { data: [] }];
  type Adjustment = { invoice_id: string; consideration_adjusted: number; cgst: number; sgst: number };
  const adjustments = (adj || []) as unknown as Adjustment[];
  const openingAdjustments = (obAdj || []) as unknown as Adjustment[];

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
    const unitOpeningAdjustments = openingAdjustments.filter((a) => invIds.has(a.invoice_id));
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
      openingAdjustments: unitOpeningAdjustments.map((a) => ({
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
export interface OriginalDocument {
  docType: 'INVOICE' | 'RECEIPT';
  docNo: string | null;
  docDate: string;
  amount: number;
}

export async function raiseCreditNote(params: {
  unitId: string;
  bookingId: string | null;
  noteDate: string;
  noteType: 'CANCELLATION' | 'CONVERSION' | 'DASTAVEJ_VARIANCE' | 'OTHER';
  consideration: number;
  rateCode: BuilderRateCode;
  originalDocDate: string;
  /** The actual invoice(s)/receipt voucher(s) this note reverses — auto-
   *  derived by the caller from the DB, never typed by hand. Empty for the
   *  standalone Raise Credit Note dialog, which has no linked booking to
   *  derive them from. */
  originalDocuments?: OriginalDocument[];
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
    original_documents: (params.originalDocuments || []) as never,
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
