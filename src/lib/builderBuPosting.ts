import { supabase } from '@/integrations/supabase/client';
import { classifyUnit, computeTax, DEFAULT_CHARGE_INCLUSIONS, testRrep } from '@/utils/builderRates';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import {
  buildEventWorking, isPeriodBefore, periodOfDate,
  type EventWorking, type PostingBasis, type WorkingUnitInput,
} from '@/utils/builderBuEvent';

// Preparing and posting a BU event.
//
// Preparing is a pure read: it gathers every unit in scope, splits their
// history at the opening of the BU month, and computes the working. Posting
// writes the consequences — a BU_DIFFERENTIAL invoice per taxable unit, the
// Table 11B adjustments that close out its open advances, and the subsumption
// of any receipt that fell inside the BU month.

export interface PreparedEvent {
  working: EventWorking;
  /** Receipts inside the BU month, per unit — subsumed on posting. */
  receiptsInBuMonth: Record<string, string[]>;
  /** Open advances per unit, oldest first, for the 11B leg. */
  openAdvances: Record<string, { receiptId: string; date: string; rateCode: string; available: number }[]>;
}

interface UnitRowLike {
  id: string;
  unit_no: string;
  unit_type: 'Residential' | 'Commercial';
  carpet_area_sqm: number;
  dastavej_date: string | null;
  status: string;
}

/**
 * Gather everything a BU event needs and compute its working.
 *
 * The split that matters: history is divided at the OPENING of the BU month.
 * Anything in periods before it forms the base the differential deducts;
 * anything inside the BU month is subsumed into the differential instead of
 * being taxed on its own account.
 */
export async function prepareBuEvent(params: {
  buDate: string;
  postingPeriod: string;
  postingBasis: PostingBasis;
  units: UnitRowLike[];
  /** Per unit: agreement value and rate, from the classification engine. */
  classification: Record<string, { agreementValue: number; rateCode: string; ratePct: number }>;
}): Promise<PreparedEvent> {
  const buPeriod = periodOfDate(params.buDate);
  const unitIds = params.units.map((u) => u.id);
  if (!unitIds.length) {
    return {
      working: buildEventWorking({
        buDate: params.buDate, buPeriod, postingPeriod: params.postingPeriod,
        postingBasis: params.postingBasis, units: [],
      }),
      receiptsInBuMonth: {},
      openAdvances: {},
    };
  }

  const [{ data: bookings }, { data: receipts }, { data: invoices }, { data: openings }] =
    await Promise.all([
      supabase.from('builder_bookings').select('*').in('unit_id', unitIds),
      supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
      supabase.from('builder_invoices').select('*').in('unit_id', unitIds),
      supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
    ]);

  const invoiceIds = ((invoices || []) as { id: string }[]).map((i) => i.id);
  const { data: adjustments } = invoiceIds.length
    ? await supabase.from('builder_advance_adjustments').select('*').in('invoice_id', invoiceIds)
    : { data: [] as unknown[] };

  type Rcpt = {
    id: string; unit_id: string; receipt_date: string; period_month: string;
    receipt_nature: string; cheque_status: string; gst_already_discharged: boolean;
    consideration: number; rate_code: string; bank_credit: number | null;
    cgst: number; sgst: number; tds_194ia: number; subsumed_by_bu_event_id: string | null;
  };
  type Inv = { id: string; unit_id: string; period_month: string; consideration: number };
  type Adj = { invoice_id: string; receipt_id: string; consideration_adjusted: number; period_month: string };
  type Bkg = { id: string; unit_id: string; booking_date: string; status: string };
  type Opn = {
    unit_id: string; cumulative_value_taxed: number; agreement_value: number;
    cumulative_receipts: number; as_at_date: string;
  };

  const rcpts = (receipts || []) as unknown as Rcpt[];
  const invs = (invoices || []) as unknown as Inv[];
  const adjs = (adjustments || []) as unknown as Adj[];
  const bkgs = (bookings || []) as unknown as Bkg[];
  const opns = (openings || []) as unknown as Opn[];

  const invoiceUnit = new Map(invs.map((i) => [i.id, i.unit_id]));
  const receiptsInBuMonth: PreparedEvent['receiptsInBuMonth'] = {};
  const openAdvances: PreparedEvent['openAdvances'] = {};

  const workingInputs: WorkingUnitInput[] = params.units.map((u) => {
    const cls = params.classification[u.id];
    const opening = opns.find((o) => o.unit_id === u.id);
    // The live booking, if any. A cancelled booking leaves the unit unbooked.
    const booking = bkgs.find((b) => b.unit_id === u.id && b.status === 'Active');
    // A unit with a recognised opening balance was demonstrably booked
    // before onboarding, even with no builder_bookings row — its as_at_date
    // stands in as the effective booking date so it isn't wrongly swept into
    // Schedule III just because this app never recorded a formal booking.
    const hasOpeningActivity = opening
      && ((Number(opening.agreement_value) || 0) > 0.005 || (Number(opening.cumulative_receipts) || 0) > 0.005);

    const unitReceipts = rcpts.filter((r) => r.unit_id === u.id);
    const posted = unitReceipts.filter(
      (r) => r.receipt_nature === 'ADVANCE' && r.cheque_status !== 'Bounced'
        && !r.gst_already_discharged && !r.subsumed_by_bu_event_id,
    );

    const advancesBefore = posted
      .filter((r) => isPeriodBefore(r.period_month, buPeriod))
      .reduce((s, r) => s + (Number(r.consideration) || 0), 0);

    // Receipts dated inside the BU month itself — covered by the differential.
    const inBuMonth = unitReceipts.filter(
      (r) => r.period_month === buPeriod && !r.subsumed_by_bu_event_id,
    );
    if (inBuMonth.length) receiptsInBuMonth[u.id] = inBuMonth.map((r) => r.id);

    const unitInvoices = invs.filter((i) => i.unit_id === u.id);
    const invoicesBefore = unitInvoices
      .filter((i) => isPeriodBefore(i.period_month, buPeriod))
      .reduce((s, i) => s + (Number(i.consideration) || 0), 0);

    const unitAdjs = adjs.filter((a) => invoiceUnit.get(a.invoice_id) === u.id);
    const adjustmentsBefore = unitAdjs
      .filter((a) => isPeriodBefore(a.period_month, buPeriod))
      .reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0);

    // Advances still open at the opening of the BU month — the 11B leg.
    openAdvances[u.id] = posted
      .filter((r) => isPeriodBefore(r.period_month, buPeriod))
      .map((r) => {
        const used = unitAdjs
          .filter((a) => a.receipt_id === r.id && isPeriodBefore(a.period_month, buPeriod))
          .reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0);
        return {
          receiptId: r.id, date: r.receipt_date, rateCode: r.rate_code,
          available: Math.round(((Number(r.consideration) || 0) - used + Number.EPSILON) * 100) / 100,
        };
      })
      .filter((a) => a.available > 0.005)
      .sort((a, b) => a.date.localeCompare(b.date));

    const receivedUptoCutOff = unitReceipts
      .filter((r) => r.cheque_status !== 'Bounced')
      .reduce((s, r) => s + (r.bank_credit === null || r.bank_credit === undefined
        ? (Number(r.consideration) || 0) + (Number(r.cgst) || 0) + (Number(r.sgst) || 0) - (Number(r.tds_194ia) || 0)
        : Number(r.bank_credit) || 0), 0);

    return {
      unitId: u.id,
      unitNo: u.unit_no,
      unitType: u.unit_type,
      carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
      rateCode: (cls?.rateCode || 'OTHER_RESIDENTIAL') as never,
      ratePct: cls?.ratePct || 0,
      agreementValue: opening?.agreement_value || cls?.agreementValue || 0,
      dastavejDate: u.dastavej_date,
      bookingId: booking?.id ?? null,
      bookingDate: booking?.booking_date ?? (hasOpeningActivity ? opening!.as_at_date : null),
      openingValueTaxed: Number(opening?.cumulative_value_taxed) || 0,
      advancesBefore,
      invoicesBefore,
      adjustmentsBefore,
      receivedUptoCutOff,
      receiptsInBuMonth: inBuMonth.length,
    };
  });

  return {
    working: buildEventWorking({
      buDate: params.buDate,
      buPeriod,
      postingPeriod: params.postingPeriod,
      postingBasis: params.postingBasis,
      units: workingInputs,
    }),
    receiptsInBuMonth,
    openAdvances,
  };
}

/**
 * Post a prepared event.
 *
 * Per taxable unit with something left to tax:
 *  1. a BU_DIFFERENTIAL invoice for `invoiceValue` — the Table 7 leg;
 *  2. Table 11B adjustments closing out its open advances;
 *  3. subsumption of every receipt inside the BU month, so the differential is
 *     not double-counted against them.
 *
 * The invoice is the GROSS leg while the working shows the NET differential;
 * the two agree because 11B reverses the advances the invoice re-covers.
 */
export async function postBuEvent(params: {
  eventId: string;
  projectId: string;
  prepared: PreparedEvent;
  postingPeriod: string;
  postingDate: string;
  docSeries: string | null;
  userId: string | null;
}): Promise<{ invoicesCreated: number; adjustmentsCreated: number; receiptsSubsumed: number }> {
  let invoicesCreated = 0, adjustmentsCreated = 0, receiptsSubsumed = 0;

  for (const wu of params.prepared.working.taxable) {
    if (wu.invoiceValue <= 0 && wu.differentialValue <= 0) continue;

    const tax = computeTax(wu.invoiceValue, wu.rateCode);
    const { data: inv, error } = await supabase.from('builder_invoices').insert({
      booking_id: wu.bookingId,
      unit_id: wu.unitId,
      invoice_date: params.postingDate,
      invoice_type: 'BU_DIFFERENTIAL',
      milestone_label: `BU differential — cut-off ${wu.cutOffDate} (${wu.cutOffSource})`,
      consideration: tax.consideration,
      rate_code: wu.rateCode,
      rate_pct: tax.ratePct,
      taxable_value: tax.taxableValue,
      cgst: tax.cgst,
      sgst: tax.sgst,
      period_month: params.postingPeriod,
      doc_series: params.docSeries,
      created_by: params.userId,
    }).select('id').single();
    if (error) throw error;
    invoicesCreated += 1;

    // Close out the advances this invoice re-covers.
    let toAdjust = wu.advanceToAdjust;
    const advances = params.prepared.openAdvances[wu.unitId] || [];
    const rows: {
      invoice_id: string; receipt_id: string; consideration_adjusted: number;
      taxable_value_adjusted: number; cgst: number; sgst: number;
      rate_code: string; rate_pct: number; period_month: string; created_by: string | null;
    }[] = [];
    for (const a of advances) {
      if (toAdjust <= 0.005) break;
      const take = Math.round((Math.min(toAdjust, a.available) + Number.EPSILON) * 100) / 100;
      if (take <= 0) continue;
      const t = computeTax(take, a.rateCode as never);
      rows.push({
        invoice_id: inv.id,
        receipt_id: a.receiptId,
        consideration_adjusted: take,
        taxable_value_adjusted: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
        rate_code: a.rateCode,
        rate_pct: t.ratePct,
        period_month: params.postingPeriod,
        created_by: params.userId,
      });
      toAdjust = Math.round((toAdjust - take + Number.EPSILON) * 100) / 100;
    }
    if (rows.length) {
      const { error: aErr } = await supabase.from('builder_advance_adjustments').insert(rows);
      if (aErr) throw aErr;
      adjustmentsCreated += rows.length;
    }

    // Receipts inside the BU month are covered by the differential.
    const subsume = params.prepared.receiptsInBuMonth[wu.unitId] || [];
    if (subsume.length) {
      const { error: sErr } = await supabase.from('builder_receipts')
        .update({ subsumed_by_bu_event_id: params.eventId })
        .in('id', subsume);
      if (sErr) throw sErr;
      receiptsSubsumed += subsume.length;
    }

    await supabase.from('builder_bu_event_units')
      .update({ invoice_id: inv.id }).eq('unit_id', wu.unitId).eq('bu_event_id', params.eventId);
  }

  // Every unit in the event is now closed against it, taxable or not — an
  // unbooked unit is still covered, it simply carries no GST.
  const allUnitIds = params.prepared.working.units.map((u) => u.unitId);
  if (allUnitIds.length) {
    await supabase.from('builder_units')
      .update({ bu_event_id: params.eventId }).in('id', allUnitIds);
  }

  await supabase.from('builder_bu_events').update({
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    posted_by: params.userId,
  }).eq('id', params.eventId);

  return { invoicesCreated, adjustmentsCreated, receiptsSubsumed };
}

/**
 * Undo a posting. There is no lock on a posted event, so this has to leave the
 * data exactly as it was before: delete the differential invoices (their
 * adjustments cascade), release the subsumed receipts, and unlink the units.
 */
export async function unpostBuEvent(eventId: string): Promise<void> {
  const { data: eventUnits } = await supabase
    .from('builder_bu_event_units').select('invoice_id, unit_id').eq('bu_event_id', eventId);
  const rows = (eventUnits || []) as unknown as { invoice_id: string | null; unit_id: string }[];

  const invoiceIds = rows.map((r) => r.invoice_id).filter(Boolean) as string[];
  if (invoiceIds.length) {
    // builder_advance_adjustments cascades on invoice delete.
    const { error } = await supabase.from('builder_invoices').delete().in('id', invoiceIds);
    if (error) throw error;
  }

  await supabase.from('builder_receipts')
    .update({ subsumed_by_bu_event_id: null }).eq('subsumed_by_bu_event_id', eventId);

  const unitIds = rows.map((r) => r.unit_id);
  if (unitIds.length) {
    await supabase.from('builder_units').update({ bu_event_id: null }).in('id', unitIds);
  }
  await supabase.from('builder_bu_event_units').update({ invoice_id: null }).eq('bu_event_id', eventId);
  await supabase.from('builder_bu_events')
    .update({ status: 'PREPARED', posted_at: null, posted_by: null }).eq('id', eventId);
}

// ─── Auto-post at dastavej ─────────────────────────────────────────────────
//
// The Dastavej Reconciliation page's own premise is that registration itself
// creates no GST — by the time the deed is executed, the unit is normally
// already fully taxed through ordinary advances. That is true for most units.
// It stops being true the moment a unit registers EARLY, before its advances
// catch up to the agreement value: the deed is a completed transfer either
// way, so the remaining balance has to be taxed at that point, not left open
// until some future BU event that may be a long way off.
//
// This runs the same differential math a BU event does, scoped to the one
// unit, dated at the dastavej date, and only acts when there is something to
// act on:
//   - already fully taxed (the normal case) → does nothing, silently;
//   - unbooked at this date → Schedule III, recorded so it shows immediately;
//   - a real shortfall → posts it, so the deed's own assumption becomes true
//     instead of merely hoped for.
// Setting bu_event_id here is what keeps a LATER real BU event from taxing
// the same unit again — BuilderBuEventsPage already excludes any unit that
// already carries one.

export type DastavejAutoPostResult =
  | { action: 'ALREADY_DONE' }
  | { action: 'ALREADY_TAXED' }
  | { action: 'SCHEDULE_III' }
  | { action: 'POSTED'; differentialValue: number; cgst: number; sgst: number }
  | { action: 'EXCLUDED' };

export async function autoPostDastavejDifferential(params: {
  unitId: string;
  dastavejDate: string;
  userId: string | null;
}): Promise<DastavejAutoPostResult> {
  const { data: unitRow, error: uErr } = await supabase
    .from('builder_units').select('*').eq('id', params.unitId).single();
  if (uErr || !unitRow) throw new Error(uErr?.message || 'Unit not found');
  const unit = unitRow as unknown as {
    id: string; project_id: string; unit_no: string; unit_type: 'Residential' | 'Commercial';
    carpet_area_sqm: number; base_consideration: number; status: string; dastavej_date: string | null;
    bu_event_id: string | null; onboarding_status: 'LIVE' | 'CLOSED_PRE_ONBOARDING';
  };
  // A re-save of the same (or an edited) date on a unit already closed
  // against an event never re-runs it here — unposting is a deliberate,
  // separate action on the BU Working page.
  if (unit.bu_event_id) return { action: 'ALREADY_DONE' };
  // Resolved under the firm's earlier records before this project was
  // onboarded here — this software has no reliable pre-onboarding history to
  // compute a differential against. The date is still saved by the caller for
  // the register; only the automatic posting is skipped. See
  // docs/BUILDER_GST_POSITIONS.md §14.
  if (unit.onboarding_status === 'CLOSED_PRE_ONBOARDING') return { action: 'EXCLUDED' };

  const { data: projectRow, error: pErr } = await supabase
    .from('builder_projects').select('*').eq('id', unit.project_id).single();
  if (pErr || !projectRow) throw new Error(pErr?.message || 'Project not found');
  const project = projectRow as unknown as {
    id: string; client_id: string; is_metro: boolean; carpet_area_source: 'DERIVED' | 'MANUAL';
    manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  };

  const [{ data: chargeRows }, { data: allUnits }, settings] = await Promise.all([
    supabase.from('builder_unit_charges').select('*').eq('unit_id', unit.id),
    supabase.from('builder_units').select('unit_type, carpet_area_sqm, status').eq('project_id', unit.project_id),
    fetchBuilderSettings(project.client_id),
  ]);

  const rrep = project.carpet_area_source === 'MANUAL'
    ? testRrep(project.manual_residential_carpet_sqm, project.manual_commercial_carpet_sqm)
    : testRrep(
      ((allUnits || []) as { unit_type: string; carpet_area_sqm: number; status: string }[])
        .filter((u) => u.unit_type === 'Residential' && u.status !== 'Cancelled')
        .reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0),
      ((allUnits || []) as { unit_type: string; carpet_area_sqm: number; status: string }[])
        .filter((u) => u.unit_type === 'Commercial' && u.status !== 'Cancelled')
        .reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0),
    );

  const cls = classifyUnit({
    unitType: unit.unit_type,
    carpetAreaSqM: Number(unit.carpet_area_sqm) || 0,
    baseConsideration: Number(unit.base_consideration) || 0,
    charges: ((chargeRows || []) as { charge_head: string; amount: number; include_override: boolean | null }[])
      .map((c) => ({ charge_head: c.charge_head as never, amount: Number(c.amount) || 0, include_override: c.include_override })),
    isMetro: !!project.is_metro,
    isRrep: rrep.isRrep,
    settings: settings || DEFAULT_CHARGE_INCLUSIONS,
  });

  const postingPeriod = periodOfDate(params.dastavejDate);
  const prepared = await prepareBuEvent({
    buDate: params.dastavejDate,
    postingPeriod,
    postingBasis: 'DISCOVERY', // posted the moment its own trigger happens — no lag, no s.50 interest
    units: [{
      id: unit.id, unit_no: unit.unit_no, unit_type: unit.unit_type,
      carpet_area_sqm: unit.carpet_area_sqm, dastavej_date: params.dastavejDate, status: unit.status,
    }],
    classification: { [unit.id]: { agreementValue: cls.gross.gross, rateCode: cls.rateCode, ratePct: cls.ratePct } },
  });

  const wu = prepared.working.units[0];
  if (!wu.bookedAtCutOff) {
    // Still worth recording: sets bu_event_id so the Dastavej page's
    // Schedule III detection fires now rather than waiting on a future
    // project-wide sweep to happen to notice this unit.
    const { data: ev, error: evErr } = await supabase.from('builder_bu_events').insert({
      project_id: unit.project_id, bu_date: params.dastavejDate, scope: 'UNITS',
      posting_basis: 'DISCOVERY', posting_period: postingPeriod, status: 'PREPARED',
      notes: 'Auto-posted at dastavej registration', created_by: params.userId,
    }).select('id').single();
    if (evErr || !ev) throw new Error(evErr?.message || 'Could not record the event');
    await insertEventUnitRow(ev.id, wu);
    await postBuEvent({
      eventId: ev.id, projectId: unit.project_id, prepared, postingPeriod,
      postingDate: params.dastavejDate, docSeries: null, userId: params.userId,
    });
    return { action: 'SCHEDULE_III' };
  }

  if (wu.differentialValue <= 0) {
    // The normal case the Dastavej page already assumes: ordinary advances
    // already cover the agreement value by the time the deed is executed.
    // Nothing to post — dastavej stays pure reconciliation.
    return { action: 'ALREADY_TAXED' };
  }

  const { data: ev, error: evErr } = await supabase.from('builder_bu_events').insert({
    project_id: unit.project_id, bu_date: params.dastavejDate, scope: 'UNITS',
    posting_basis: 'DISCOVERY', posting_period: postingPeriod, status: 'PREPARED',
    notes: 'Auto-posted at dastavej registration', created_by: params.userId,
  }).select('id').single();
  if (evErr || !ev) throw new Error(evErr?.message || 'Could not record the event');
  await insertEventUnitRow(ev.id, wu);
  await postBuEvent({
    eventId: ev.id, projectId: unit.project_id, prepared, postingPeriod,
    postingDate: params.dastavejDate, docSeries: null, userId: params.userId,
  });

  return { action: 'POSTED', differentialValue: wu.differentialValue, cgst: wu.differentialCgst, sgst: wu.differentialSgst };
}

async function insertEventUnitRow(eventId: string, w: EventWorking['units'][number]): Promise<void> {
  const { error } = await supabase.from('builder_bu_event_units').insert({
    bu_event_id: eventId, unit_id: w.unitId, cut_off_date: w.cutOffDate, cut_off_source: w.cutOffSource,
    booked_at_cutoff: w.bookedAtCutOff, booking_id: w.bookingId, unit_type: w.unitType,
    carpet_area_sqm: w.carpetAreaSqM, rate_code: w.rateCode, rate_pct: w.ratePct,
    agreement_value: w.agreementValue, value_taxed_upto_opening: w.valueTaxedUptoOpening,
    invoiced_before: w.invoicedBefore, open_advance_before: w.openAdvanceBefore,
    received_upto_cutoff: w.receivedUptoCutOff, differential_value: w.differentialValue,
    differential_taxable_value: w.differentialTaxableValue, differential_cgst: w.differentialCgst,
    differential_sgst: w.differentialSgst, interest_days: w.interestDays, interest_amount: w.interestAmount,
    tie_out_diff: w.tieOutDiff, subsumed_receipt_count: w.subsumedReceiptCount,
  });
  if (error) throw error;
}
