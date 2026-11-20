import { supabase } from '@/integrations/supabase/client';
import { classifyUnit, computeTax, DEFAULT_CHARGE_INCLUSIONS, testRrep, type BuilderRateCode } from '@/utils/builderRates';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import { overrideAgreementValue } from '@/lib/builderAgreementConfirmData';
import { unitBlock } from '@/lib/builderUnitBlocks';
import {
  buildEventWorking, computeLateDiscoveryInterest, isPeriodBefore, periodOfDate,
  type EventWorking, type LateDiscoveryInterest, type LateTranche, type PostingBasis, type WorkingUnitInput,
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

  const [
    { data: bookings }, { data: receipts }, { data: invoices }, { data: openings }, { data: openingAdjustments },
    { data: deeds }, { data: adopted },
  ] =
    await Promise.all([
      supabase.from('builder_bookings').select('*').in('unit_id', unitIds),
      supabase.from('builder_receipts').select('*').in('unit_id', unitIds).order('receipt_date'),
      supabase.from('builder_invoices').select('*').in('unit_id', unitIds),
      supabase.from('builder_opening_balances').select('*').in('unit_id', unitIds),
      supabase.from('builder_opening_balance_adjustments')
        .select('unit_id, consideration_adjusted, period_month').in('unit_id', unitIds),
      // The deed value, read here so every caller (BU event, the dastavej
      // auto-post, the late-discovery interest) takes it the same way.
      supabase.from('builder_units').select('id, dastavej_value').in('id', unitIds),
      // A value the firm approved after the client disputed it (20 Nov 2026,
      // builder_bu_adopt_client_value): the latest approval per unit.
      supabase.from('builder_bu_agreement_confirmations')
        .select('unit_id, adopted_value, adopted_at')
        .in('unit_id', unitIds).eq('status', 'OVERRIDDEN').not('adopted_value', 'is', null)
        .order('adopted_at', { ascending: false }),
    ]);
  const adoptedValue = new Map<string, number>();
  ((adopted || []) as { unit_id: string; adopted_value: number | null }[])
    .forEach((r) => { if (!adoptedValue.has(r.unit_id) && (Number(r.adopted_value) || 0) > 0) adoptedValue.set(r.unit_id, Number(r.adopted_value)); });
  const deedValue = new Map(((deeds || []) as { id: string; dastavej_value: number | null }[])
    .filter((d) => (Number(d.dastavej_value) || 0) > 0)
    .map((d) => [d.id, Number(d.dastavej_value)]));

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
  const opnAdjs = (openingAdjustments || []) as unknown as {
    unit_id: string; consideration_adjusted: number; period_month: string;
  }[];

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
      // The value taxed is the deed's when a deed value is recorded (the
      // firm, 18 Nov 2026: "as per the Dastavej only"), else the agreement
      // value: the one the firm approved after the client's dispute, else the
      // opening snapshot, then the classification engine.
      agreementValue: deedValue.get(u.id) ?? adoptedValue.get(u.id)
        ?? (opening?.agreement_value || cls?.agreementValue || 0),
      dastavejDate: u.dastavej_date,
      bookingId: booking?.id ?? null,
      bookingDate: booking?.booking_date ?? (hasOpeningActivity ? opening!.as_at_date : null),
      // The opening balance less what earlier invoices (milestone invoices
      // raised after onboarding) already adjusted from it in Table 11B.
      openingValueTaxed: Math.max(0, Math.round((
        (Number(opening?.cumulative_value_taxed) || 0)
        - opnAdjs
          .filter((a) => a.unit_id === u.id && isPeriodBefore(a.period_month, buPeriod))
          .reduce((s, a) => s + (Number(a.consideration_adjusted) || 0), 0)
        + Number.EPSILON) * 100) / 100),
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
/**
 * A BU differential invoice's number: <series>BU/<unit>, in the characters
 * Rule 46(b) allows (letters, digits, "/" and "-") and at most 16 of them —
 * "BU/Shed No.-004" made the portal reject Bapa Sitaram's Sep-26 GSTR-1.
 */
export const buInvoiceNo = (series: string | null | undefined, unitNo: string): string => {
  const clean = (x: string) => x.toUpperCase().replace(/[^A-Z0-9/-]/g, '');
  return `${clean(series || '')}BU/${clean(unitNo)}`.slice(0, 16);
};

/** The invoice date must fall in the return period it is reported in. */
const dateWithinPeriod = (date: string, period: string): string => {
  const m = /^(\d{2})\/(\d{4})$/.exec(period);
  if (!m) return date;
  const first = `${m[2]}-${m[1]}-01`;
  const lastDay = new Date(Date.UTC(Number(m[2]), Number(m[1]), 0)).getUTCDate();
  const last = `${m[2]}-${m[1]}-${String(lastDay).padStart(2, '0')}`;
  return date < first ? first : date > last ? last : date;
};

/**
 * Post a prepared event — all of it or none of it. There is no DB
 * transaction across these writes, so a failure part-way unposts whatever
 * was written (unpostBuEvent) before the error is shown, and an event that is
 * already POSTED is refused, so a retry can never post a second invoice.
 */
export async function postBuEvent(params: Parameters<typeof postBuEventRows>[0]): ReturnType<typeof postBuEventRows> {
  const { data: ev, error: evErr } = await supabase
    .from('builder_bu_events').select('status').eq('id', params.eventId).single();
  if (evErr || !ev) throw new Error(evErr?.message || 'Could not load the event');
  if ((ev as { status: string }).status === 'POSTED') {
    throw new Error('This event is already posted. Unpost it first to post again.');
  }

  // Receipts the differential subsumes must not sit in a filed GSTR-1: they
  // were reported in Table 11A there, and taking them out now would change a
  // filed return. Refuse before writing anything.
  const subsumeIds = Object.values(params.prepared.receiptsInBuMonth).flat();
  if (subsumeIds.length) {
    const { data: rc } = await supabase.from('builder_receipts').select('period_month').in('id', subsumeIds);
    const periods = [...new Set(((rc || []) as { period_month: string }[]).map((r) => r.period_month))];
    const { data: proj } = await supabase.from('builder_projects').select('client_id').eq('id', params.projectId).single();
    const clientId = (proj as { client_id: string } | null)?.client_id;
    if (clientId && periods.length) {
      const { data: filed } = await supabase.from('filing_status').select('period_month')
        .eq('client_id', clientId).in('return_type', ['GSTR-1', 'GSTR-1 (IFF)'])
        .in('period_month', periods).eq('status', 'Filed');
      if (filed && filed.length) {
        throw new Error(
          `GSTR-1 for ${(filed as { period_month: string }[]).map((f) => f.period_month).join(', ')} is filed, and it `
          + 'reports receipts this BU differential would take over. Post the event in the BU month before filing it, '
          + 'or ask for the filed return to be amended first.',
        );
      }
    }
  }

  // One post at a time per event: claim it in a single conditional UPDATE, so a
  // second click or tab finds the claim and stops before writing anything.
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: claimed, error: claimErr } = await supabase.from('builder_bu_events')
    .update({ posting_started_at: new Date().toISOString() })
    .eq('id', params.eventId).neq('status', 'POSTED')
    .or(`posting_started_at.is.null,posting_started_at.lt.${staleBefore}`)
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed?.length) {
    throw new Error('This event is already being posted (or was just posted). Wait a minute, then reload.');
  }

  try {
    const res = await postBuEventRows({ ...params, postingDate: dateWithinPeriod(params.postingDate, params.postingPeriod) });
    await supabase.from('builder_bu_events').update({ posting_started_at: null }).eq('id', params.eventId);
    return res;
  } catch (e) {
    try {
      await unpostBuEvent(params.eventId);
    } catch (undoErr) {
      throw new Error(
        `Posting failed part-way (${(e as Error).message}) and the partial posting could not be undone `
        + `(${(undoErr as Error).message}). Use Unpost on the event before trying again.`,
      );
    }
    throw new Error(`${(e as Error).message} — nothing was posted.`);
  }
}

async function postBuEventRows(params: {
  eventId: string;
  projectId: string;
  prepared: PreparedEvent;
  postingPeriod: string;
  postingDate: string;
  docSeries: string | null;
  userId: string | null;
  /**
   * The filed month this posting is reported as an amendment of (GSTR-1
   * Table 10 and 11B(2)), when its own month was filed before it was
   * recorded. The invoice then keeps that month's date (`amendsDate`).
   */
  amendsPeriod?: string | null;
  amendsDate?: string | null;
}): Promise<{
  invoicesCreated: number; adjustmentsCreated: number; receiptsSubsumed: number; openingAdjustmentsCreated: number;
}> {
  let invoicesCreated = 0, adjustmentsCreated = 0, receiptsSubsumed = 0, openingAdjustmentsCreated = 0;

  for (const wu of params.prepared.working.taxable) {
    if (wu.invoiceValue <= 0 && wu.differentialValue <= 0) continue;

    const tax = computeTax(wu.invoiceValue, wu.rateCode);
    const { data: inv, error } = await supabase.from('builder_invoices').insert({
      booking_id: wu.bookingId,
      unit_id: wu.unitId,
      invoice_date: params.amendsPeriod && params.amendsDate ? params.amendsDate : params.postingDate,
      invoice_type: 'BU_DIFFERENTIAL',
      milestone_label: `${wu.cutOffSource === 'DASTAVEJ' ? 'Dastavej' : 'BU'} differential — cut-off ${wu.cutOffDate}`,
      consideration: tax.consideration,
      rate_code: wu.rateCode,
      rate_pct: tax.ratePct,
      taxable_value: tax.taxableValue,
      cgst: tax.cgst,
      sgst: tax.sgst,
      period_month: params.postingPeriod,
      amends_period: params.amendsPeriod || null,
      doc_series: params.docSeries,
      // A document number, so the invoice counts in Table 13 (documents issued).
      doc_no: buInvoiceNo(params.docSeries, wu.unitNo),
      created_by: params.userId,
    }).select('id').single();
    if (error) throw error;
    invoicesCreated += 1;

    // Link at once, so an undo (unpostBuEvent) can find this invoice even if
    // a later step fails.
    const { error: linkErr } = await supabase.from('builder_bu_event_units')
      .update({ invoice_id: inv.id }).eq('unit_id', wu.unitId).eq('bu_event_id', params.eventId);
    if (linkErr) throw linkErr;

    // Close out the advances this invoice re-covers.
    let toAdjust = wu.advanceToAdjust;
    const advances = params.prepared.openAdvances[wu.unitId] || [];
    const rows: {
      invoice_id: string; receipt_id: string; consideration_adjusted: number;
      taxable_value_adjusted: number; cgst: number; sgst: number;
      rate_code: string; rate_pct: number; period_month: string; amends_period: string | null; created_by: string | null;
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
        amends_period: params.amendsPeriod || null,
        created_by: params.userId,
      });
      toAdjust = Math.round((toAdjust - take + Number.EPSILON) * 100) / 100;
    }
    if (rows.length) {
      const { error: aErr } = await supabase.from('builder_advance_adjustments').insert(rows);
      if (aErr) throw aErr;
      adjustmentsCreated += rows.length;
    }

    // Whatever's left of toAdjust once real advances are exhausted is the
    // opening-balance portion of advanceToAdjust (proven in computeDifferential's
    // doc comment) — real receipts have nothing further to offer, so this is
    // the pre-onboarding money instead. Written to its own table since it has
    // no receipt_id to attach to (builder_advance_adjustments.receipt_id is
    // NOT NULL) — see 20260813150000_builder_opening_balance_adjustments.sql.
    if (toAdjust > 0.005) {
      const t = computeTax(toAdjust, wu.rateCode);
      const { error: obErr } = await supabase.from('builder_opening_balance_adjustments').insert({
        invoice_id: inv.id,
        unit_id: wu.unitId,
        consideration_adjusted: toAdjust,
        taxable_value_adjusted: t.taxableValue,
        cgst: t.cgst,
        sgst: t.sgst,
        rate_code: wu.rateCode,
        rate_pct: t.ratePct,
        period_month: params.postingPeriod,
        amends_period: params.amendsPeriod || null,
        created_by: params.userId,
      });
      if (obErr) throw obErr;
      openingAdjustmentsCreated += 1;
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
  }

  // Every unit in the event is now closed against it, taxable or not — an
  // unbooked unit is still covered, it simply carries no GST.
  const allUnitIds = params.prepared.working.units.map((u) => u.unitId);
  if (allUnitIds.length) {
    const { error: uErr } = await supabase.from('builder_units')
      .update({ bu_event_id: params.eventId }).in('id', allUnitIds);
    if (uErr) throw uErr;
  }

  const { error: stErr } = await supabase.from('builder_bu_events').update({
    status: 'POSTED',
    posted_at: new Date().toISOString(),
    posted_by: params.userId,
  }).eq('id', params.eventId);
  if (stErr) throw stErr;

  return { invoicesCreated, adjustmentsCreated, receiptsSubsumed, openingAdjustmentsCreated };
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
    // builder_advance_adjustments and builder_opening_balance_adjustments
    // both cascade on invoice delete.
    const { error } = await supabase.from('builder_invoices').delete().in('id', invoiceIds);
    if (error) throw error;
  }

  const steps = [
    await supabase.from('builder_receipts')
      .update({ subsumed_by_bu_event_id: null }).eq('subsumed_by_bu_event_id', eventId),
  ];
  const unitIds = rows.map((r) => r.unit_id);
  if (unitIds.length) {
    steps.push(await supabase.from('builder_units').update({ bu_event_id: null }).in('id', unitIds));
  }
  steps.push(await supabase.from('builder_bu_event_units').update({ invoice_id: null }).eq('bu_event_id', eventId));
  steps.push(await supabase.from('builder_bu_events')
    .update({ status: 'PREPARED', posted_at: null, posted_by: null, posting_started_at: null }).eq('id', eventId));
  const failed = steps.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/**
 * Unpost a posted event, but only when it's genuinely safe to do so
 * automatically. Shared by clearDastavejDate() and recheckStaleScheduleIII()
 * — both need the same two guards before calling unpostBuEvent():
 *   - its period already FILED → hard-blocked, always. The DB's own
 *     filed-period lock would reject the unpost anyway; this just gives a
 *     specific reason instead of a raw trigger error.
 *   - the event covers OTHER units too (a real project/block BU sweep, not
 *     a single-unit auto-post) → also blocked, since unposting it here would
 *     silently reverse everyone else's posting along with this one unit's.
 */
async function guardedUnpost(buEventId: string): Promise<void> {
  const { data: eventRow, error: eErr } = await supabase
    .from('builder_bu_events').select('posting_period, project_id').eq('id', buEventId).single();
  if (eErr || !eventRow) throw new Error(eErr?.message || 'Could not load the posted event');
  const { posting_period: postingPeriod, project_id: projectId } =
    eventRow as { posting_period: string; project_id: string };

  const { data: projRow } = await supabase
    .from('builder_projects').select('client_id').eq('id', projectId).single();
  const clientId = (projRow as { client_id: string } | null)?.client_id;

  if (clientId && postingPeriod) {
    const { data: filed } = await supabase
      .from('filing_status').select('id')
      .eq('client_id', clientId).eq('return_type', 'GSTR-1')
      .eq('period_month', postingPeriod).eq('status', 'Filed').maybeSingle();
    if (filed) {
      throw new Error(
        `GSTR-1 for ${postingPeriod} is already filed — the posting can no longer be reversed `
        + 'automatically. Correct it with a credit note instead.',
      );
    }
  }

  const { count } = await supabase
    .from('builder_bu_event_units').select('unit_id', { count: 'exact', head: true })
    .eq('bu_event_id', buEventId);
  if ((count || 0) > 1) {
    throw new Error(
      'The posted event covers other units too — it can only be unposted from the BU Events page, so '
      + 'their postings are reviewed along with this one, not silently reversed automatically.',
    );
  }

  await unpostBuEvent(buEventId);
}

/**
 * Clear a wrong dastavej entirely — not a date that should move, which is
 * just an overwrite. Reused by both the Dastavej page's own Clear action and
 * the Book Unit dialog's pointer, so a stale date from a cancelled-then-
 * reregistered unit's earlier sale is handled the same way everywhere.
 */
export async function clearDastavejDate(unitId: string): Promise<void> {
  const { data: unitRow, error: uErr } = await supabase
    .from('builder_units').select('bu_event_id').eq('id', unitId).single();
  if (uErr || !unitRow) throw new Error(uErr?.message || 'Unit not found');
  const unit = unitRow as unknown as { bu_event_id: string | null };

  if (unit.bu_event_id) {
    await guardedUnpost(unit.bu_event_id);
  }

  const { error } = await supabase.from('builder_units')
    .update({ dastavej_date: null, dastavej_value: null }).eq('id', unitId);
  if (error) throw error;
}

export type ScheduleIIIRecheckResult = 'RECLASSIFIED' | 'UNCHANGED' | 'NO_DASTAVEJ' | 'BLOCKED';

/**
 * Self-healing check for the exact bug that hit Plot 148 at Shree Maruti
 * Infra: a dastavej auto-post ran while the unit still looked genuinely
 * unbooked, froze it Schedule III, and then an opening balance or booking
 * arrived afterward that would have changed that determination — with
 * nothing to ever notice, since the auto-post only fires once, at save time,
 * and short-circuits forever after on bu_event_id being set.
 *
 * Called after every opening-balance and booking save so this can never go
 * unnoticed again. Silent no-op for every case except the one it exists to
 * catch: a single-unit, unfiled, Schedule III event whose booked-at-cutoff
 * determination has genuinely changed since it posted. Never touches a real
 * differential already correctly posted, a multi-unit sweep, or a filed
 * period — those still need the normal manual correction paths.
 */
export async function recheckStaleScheduleIII(params: {
  unitId: string;
  userId: string | null;
}): Promise<ScheduleIIIRecheckResult> {
  const { data: unitRow } = await supabase
    .from('builder_units').select('bu_event_id, dastavej_date').eq('id', params.unitId).maybeSingle();
  const unit = unitRow as { bu_event_id: string | null; dastavej_date: string | null } | null;
  if (!unit?.bu_event_id || !unit.dastavej_date) return 'NO_DASTAVEJ';

  const { data: euRow } = await supabase
    .from('builder_bu_event_units').select('booked_at_cutoff')
    .eq('bu_event_id', unit.bu_event_id).eq('unit_id', params.unitId).maybeSingle();
  if (!euRow || (euRow as { booked_at_cutoff: boolean }).booked_at_cutoff) return 'UNCHANGED';

  try {
    await guardedUnpost(unit.bu_event_id);
  } catch {
    // Filed period or a multi-unit event — leave the stale label in place,
    // this needs a human looking at the BU Events page, not a silent skip.
    return 'BLOCKED';
  }

  await autoPostDastavejDifferential({
    unitId: params.unitId, dastavejDate: unit.dastavej_date, userId: params.userId,
  });
  return 'RECLASSIFIED';
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
  /** The unit is in a prepared BU event dated on or before the deed: its line there is worked again; taxed when the BU posts. */
  | { action: 'IN_BU'; buDate: string }
  /** A unit already posted (by a BU event, or its own deed): its posting redone on the deed value. */
  | { action: 'REWORKED'; before: number; after: number; postingPeriod: string }
  /** As REWORKED, but the posting's GSTR-1 is filed: left as it is, for the register to flag. */
  | { action: 'FILED_KEPT'; postingPeriod: string }
  | { action: 'ALREADY_TAXED' }
  | { action: 'SCHEDULE_III' }
  | {
    action: 'POSTED'; differentialValue: number; cgst: number; sgst: number;
    /** The month the invoice and 11B landed in. */
    postingPeriod: string;
    /** Set when the deed's own month was already filed, so the posting moved to the first open month. */
    deedPeriodFiled: string | null;
  }
  | { action: 'EXCLUDED' };

const nextPeriod = (period: string): string => {
  const [mm, yyyy] = period.split('/').map(Number);
  return mm === 12 ? `01/${yyyy + 1}` : `${String(mm + 1).padStart(2, '0')}/${yyyy}`;
};

/**
 * The first month from `period` on whose GSTR-1 is not Filed. A deed dated in
 * a month already filed cannot post there (`builder_invoices_period_lock`), so
 * its differential is reported in the month it is recorded in, the first open
 * one, as a supply of the earlier month reported late.
 */
async function firstUnfiledGstr1Period(clientId: string, period: string): Promise<string> {
  const { data } = await supabase.from('filing_status').select('period_month')
    .eq('client_id', clientId).eq('return_type', 'GSTR-1').eq('status', 'Filed');
  const filed = new Set(((data || []) as { period_month: string }[]).map((r) => r.period_month));
  let p = period;
  for (let i = 0; i < 36 && filed.has(p); i += 1) p = nextPeriod(p);
  return p;
}

/** Insert the auto event and post it; a failed post leaves no PREPARED event behind. */
async function insertAndPostDastavejEvent(params: {
  unit: { id: string; project_id: string };
  dastavejDate: string;
  postingPeriod: string;
  prepared: PreparedEvent;
  wu: PreparedEvent['working']['units'][number];
  userId: string | null;
  /** The deed's own month, when filed: the posting amends it. */
  amendsPeriod: string | null;
}): Promise<void> {
  const { unit, dastavejDate, postingPeriod, prepared, wu, userId } = params;
  // An earlier failed auto-post (before this cleanup existed) may have left a
  // PREPARED event for this unit; clear it so the unit carries one event.
  const { data: stale } = await supabase.from('builder_bu_event_units')
    .select('bu_event_id, builder_bu_events!inner(status, notes)')
    .eq('unit_id', unit.id)
    .eq('builder_bu_events.status', 'PREPARED')
    .eq('builder_bu_events.notes', 'Auto-posted at dastavej registration');
  const staleIds = [...new Set(((stale || []) as { bu_event_id: string }[]).map((r) => r.bu_event_id))];
  if (staleIds.length) {
    await supabase.from('builder_bu_events').delete().in('id', staleIds).eq('status', 'PREPARED');
  }
  const { data: ev, error: evErr } = await supabase.from('builder_bu_events').insert({
    project_id: unit.project_id, bu_date: dastavejDate, scope: 'UNITS',
    posting_basis: 'DISCOVERY', posting_period: postingPeriod, status: 'PREPARED',
    notes: 'Auto-posted at dastavej registration', created_by: userId,
  }).select('id').single();
  if (evErr || !ev) throw new Error(evErr?.message || 'Could not record the event');
  try {
    await insertEventUnitRow(ev.id, wu);
    await postBuEvent({
      eventId: ev.id, projectId: unit.project_id, prepared, postingPeriod,
      postingDate: dastavejDate, docSeries: null, userId,
      amendsPeriod: params.amendsPeriod, amendsDate: params.amendsPeriod ? dastavejDate : null,
    });
  } catch (e) {
    // postBuEvent has already undone any rows it wrote; drop the event too,
    // so a retry starts clean instead of beside an orphan PREPARED event.
    await supabase.from('builder_bu_events').delete().eq('id', ev.id).eq('status', 'PREPARED');
    throw e;
  }
}

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
  // A unit already closed (a BU event came first, or the deed was saved
  // before): the dastavej value prevails, so its own posting is redone on
  // the deed value while that month's GSTR-1 is not filed (the firm,
  // 18 Nov 2026: no credit note for an unfiled month).
  if (unit.bu_event_id) return reworkPostedUnitToDeed({ unitId: unit.id, userId: params.userId });

  // In a prepared BU event dated on or before the deed: the BU came first, so
  // the balance is taxed at the BU (the firm, 19 Nov 2026); the unit's line in
  // that event is worked again on the deed value instead of a deed posting.
  {
    const { data: inPrepared } = await supabase.from('builder_bu_event_units')
      .select('bu_event_id, event:builder_bu_events!inner(id, bu_date, status)')
      .eq('unit_id', unit.id).eq('event.status', 'PREPARED');
    const ev = ((inPrepared || []) as unknown as { event: { id: string; bu_date: string } | null }[])
      .map((r) => r.event).filter((e): e is { id: string; bu_date: string } => !!e && e.bu_date <= params.dastavejDate)
      .sort((a, b) => a.bu_date.localeCompare(b.bu_date))[0];
    if (ev) {
      await refreshPreparedUnits({ buEventId: ev.id, unitIds: [unit.id], userId: params.userId });
      return { action: 'IN_BU', buDate: ev.bu_date };
    }
  }
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

  // The cut-off stays the deed date; only where it is REPORTED moves, when
  // the deed's month is already filed (Sep deed recorded while doing Oct).
  const deedPeriod = periodOfDate(params.dastavejDate);
  const postingPeriod = await firstUnfiledGstr1Period(project.client_id, deedPeriod);
  const deedPeriodFiled = postingPeriod === deedPeriod ? null : deedPeriod;
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
    await insertAndPostDastavejEvent({
      unit, dastavejDate: params.dastavejDate, postingPeriod, prepared, wu, userId: params.userId,
      amendsPeriod: deedPeriodFiled,
    });
    return { action: 'SCHEDULE_III' };
  }

  // The opening balance still unabsorbed at the BU month's opening.
  const openingContribution = wu.openingOpenAdvanceBefore;
  // A deed with an invoice still to raise always closes the unit, even when
  // its advances already cover the deed (no new tax): Table 7 carries the
  // deed value and Table 11B adjusts it from the advances, and any advance
  // beyond the deed is left open to refund or credit (the firm, 18 Nov 2026:
  // the dastavej value prevails; SWENI F-603). Only a unit already invoiced
  // to the deed has nothing to post.
  if (wu.differentialValue <= 0 && openingContribution <= 0.005 && wu.invoiceValue <= 0.005) {
    // The normal case the Dastavej page already assumes: ordinary advances
    // already cover the agreement value by the time the deed is executed.
    // Nothing to post — dastavej stays pure reconciliation.
    //
    // An opening balance is different: it never runs through the ordinary
    // milestone-invoice lifecycle the way real advances do, so if it alone
    // covers the agreement (net differential 0, Plot 148's exact case), this
    // dastavej is its ONE chance to ever reach a return — skipping here would
    // silently drop it, same bug as the invoice leg netting it out used to.
    return { action: 'ALREADY_TAXED' };
  }

  await insertAndPostDastavejEvent({
    unit, dastavejDate: params.dastavejDate, postingPeriod, prepared, wu, userId: params.userId,
    amendsPeriod: deedPeriodFiled,
  });

  return {
    action: 'POSTED', differentialValue: wu.differentialValue, cgst: wu.differentialCgst, sgst: wu.differentialSgst,
    postingPeriod, deedPeriodFiled,
  };
}

// ─── Late-discovery interest preview ───────────────────────────────────────
//
// For a dastavej/BU shortfall discovered long after the fact, where the
// buyer kept paying and each payment was already taxed as an ordinary
// advance in its own month — see computeLateDiscoveryInterest() for why the
// shortfall must not simply be reposted in full. This computes the same
// single-unit shortfall autoPostDastavejDifferential would, then prices
// interest against the unit's own later, un-subsumed advance receipts
// instead of posting a fresh differential for the whole amount.

export async function previewLateDiscoveryInterest(params: {
  unitId: string;
  dastavejDate: string;
}): Promise<LateDiscoveryInterest & { rateCode: BuilderRateCode; cutOffPeriod: string; bookedAtCutOff: boolean }> {
  const { data: unitRow, error: uErr } = await supabase
    .from('builder_units').select('*').eq('id', params.unitId).single();
  if (uErr || !unitRow) throw new Error(uErr?.message || 'Unit not found');
  const unit = unitRow as unknown as {
    id: string; project_id: string; unit_no: string; unit_type: 'Residential' | 'Commercial';
    carpet_area_sqm: number; base_consideration: number; status: string;
  };

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
    postingBasis: 'DISCOVERY',
    units: [{
      id: unit.id, unit_no: unit.unit_no, unit_type: unit.unit_type,
      carpet_area_sqm: unit.carpet_area_sqm, dastavej_date: params.dastavejDate, status: unit.status,
    }],
    classification: { [unit.id]: { agreementValue: cls.gross.gross, rateCode: cls.rateCode, ratePct: cls.ratePct } },
  });
  const wu = prepared.working.units[0];

  if (!wu.bookedAtCutOff || wu.differentialValue <= 0) {
    return {
      shortfallValue: 0, tranches: [], totalAllocated: 0, totalInterest: 0, residualUnrecovered: 0,
      rateCode: wu.rateCode, cutOffPeriod: postingPeriod, bookedAtCutOff: wu.bookedAtCutOff,
    };
  }

  // Ordinary advances dated AFTER the cut-off period, never subsumed by any
  // BU event — these are exactly the payments that, unknown to whoever
  // recorded them, were already covering this shortfall.
  const { data: rcp } = await supabase
    .from('builder_receipts')
    .select('period_month, consideration, receipt_date')
    .eq('unit_id', unit.id)
    .eq('receipt_nature', 'ADVANCE')
    .neq('cheque_status', 'Bounced')
    .eq('gst_already_discharged', false)
    .is('subsumed_by_bu_event_id', null);
  const laterReceipts = ((rcp || []) as unknown as { period_month: string; consideration: number; receipt_date: string }[])
    .filter((r) => !isPeriodBefore(r.period_month, postingPeriod) && r.period_month !== postingPeriod)
    .sort((a, b) => a.receipt_date.localeCompare(b.receipt_date));

  const tranches: LateTranche[] = laterReceipts.map((r) => ({
    periodMonth: r.period_month, amount: Number(r.consideration) || 0,
  }));

  const result = computeLateDiscoveryInterest({
    shortfallValue: wu.differentialValue, rateCode: wu.rateCode, cutOffPeriod: postingPeriod, tranches,
  });

  return { ...result, rateCode: wu.rateCode, cutOffPeriod: postingPeriod, bookedAtCutOff: true };
}

export async function saveLateDiscoveryInterest(params: {
  unitId: string;
  projectId: string;
  dastavejDate: string;
  preview: LateDiscoveryInterest & { rateCode: BuilderRateCode; cutOffPeriod: string };
  userId: string | null;
}): Promise<{ id: string }> {
  const { data, error } = await supabase.from('builder_dastavej_late_interest').insert({
    unit_id: params.unitId,
    project_id: params.projectId,
    dastavej_date: params.dastavejDate,
    cut_off_period: params.preview.cutOffPeriod,
    rate_code: params.preview.rateCode,
    shortfall_value: params.preview.shortfallValue,
    tranches: params.preview.tranches as never,
    total_allocated: params.preview.totalAllocated,
    total_interest: params.preview.totalInterest,
    residual_unrecovered: params.preview.residualUnrecovered,
    created_by: params.userId,
  }).select('id').single();
  if (error) throw error;
  return { id: data.id };
}

export async function markLateDiscoveryInterestPaid(params: {
  id: string;
  arn: string;
  paidDate: string;
}): Promise<void> {
  const { error } = await supabase.from('builder_dastavej_late_interest')
    .update({ status: 'PAID', arn: params.arn, paid_date: params.paidDate }).eq('id', params.id);
  if (error) throw error;
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


/**
 * Redo one unit's posting in its (posted) event on the current deed value,
 * leaving every other unit of the event as it is. Only while the posting's
 * GSTR-1 is not Filed; a filed month is kept (FILED_KEPT) and the Dastavej
 * register flags the difference. The unit's invoice is deleted (its 11B
 * adjustments cascade), its receipts the event subsumed are released, its
 * working is prepared again as at the event's completion date and posted
 * again under the same invoice number and date (the firm, 18 Nov 2026).
 */
export async function reworkPostedUnitToDeed(params: {
  unitId: string; userId: string | null;
  /**
   * Redo the posting even when the value is unchanged: a receipt recorded
   * late for a month before the posting (already taxed there as an advance)
   * changes what the invoice must adjust in Table 11B (SWENI F-703).
   */
  force?: boolean;
}): Promise<DastavejAutoPostResult> {
  const { data: unitRow, error: uErr } = await supabase
    .from('builder_units').select('*').eq('id', params.unitId).single();
  if (uErr || !unitRow) throw new Error(uErr?.message || 'Unit not found');
  const unit = unitRow as unknown as {
    id: string; project_id: string; unit_no: string; unit_type: 'Residential' | 'Commercial';
    carpet_area_sqm: number; status: string; dastavej_date: string | null; dastavej_value: number | null;
    bu_event_id: string | null;
  };
  if (!unit.bu_event_id) return { action: 'ALREADY_DONE' };
  if (!params.force && !((Number(unit.dastavej_value) || 0) > 0)) return { action: 'ALREADY_DONE' };

  const { data: evRow, error: eErr } = await supabase
    .from('builder_bu_events').select('id, project_id, bu_date, posting_period, posting_basis, status')
    .eq('id', unit.bu_event_id).single();
  if (eErr || !evRow) throw new Error(eErr?.message || 'Could not load the posted event');
  const ev = evRow as { id: string; project_id: string; bu_date: string; posting_period: string; posting_basis: PostingBasis; status: string };
  if (ev.status !== 'POSTED') return { action: 'ALREADY_DONE' };

  const { data: euRow, error: euErr } = await supabase
    .from('builder_bu_event_units').select('*').eq('bu_event_id', ev.id).eq('unit_id', unit.id).single();
  if (euErr || !euRow) throw new Error(euErr?.message || 'Could not load the unit\'s working');
  const eu = euRow as { id: string; invoice_id: string | null; agreement_value: number; rate_code: string; rate_pct: number };
  const before = Number(eu.agreement_value) || 0;
  if (!params.force && Math.abs(before - Number(unit.dastavej_value)) <= 0.5) return { action: 'ALREADY_DONE' };

  const { data: proj } = await supabase.from('builder_projects').select('client_id').eq('id', ev.project_id).single();
  const clientId = (proj as { client_id: string } | null)?.client_id;
  if (clientId) {
    const { data: filed } = await supabase.from('filing_status').select('id')
      .eq('client_id', clientId).in('return_type', ['GSTR-1', 'GSTR-1 (IFF)'])
      .eq('period_month', ev.posting_period).eq('status', 'Filed').limit(1);
    if (filed && filed.length) return { action: 'FILED_KEPT', postingPeriod: ev.posting_period };
  }

  // The invoice being replaced: keep its number, date and series.
  let invoiceDate: string | null = null;
  let docSeries: string | null = null;
  let amendsPeriod: string | null = null;
  if (eu.invoice_id) {
    const { data: inv } = await supabase.from('builder_invoices')
      .select('invoice_date, doc_series, amends_period').eq('id', eu.invoice_id).maybeSingle();
    const i = inv as { invoice_date: string; doc_series: string | null; amends_period: string | null } | null;
    invoiceDate = i?.invoice_date ?? null;
    docSeries = i?.doc_series ?? null;
    amendsPeriod = i?.amends_period ?? null;
    const { error: dErr } = await supabase.from('builder_invoices').delete().eq('id', eu.invoice_id);
    if (dErr) throw dErr;
  }
  const { error: rErr } = await supabase.from('builder_receipts')
    .update({ subsumed_by_bu_event_id: null }).eq('subsumed_by_bu_event_id', ev.id).eq('unit_id', unit.id);
  if (rErr) throw rErr;
  await supabase.from('builder_bu_event_units').update({ invoice_id: null }).eq('id', eu.id);

  try {
    const prepared = await prepareBuEvent({
      buDate: ev.bu_date,
      postingPeriod: ev.posting_period,
      postingBasis: ev.posting_basis,
      units: [{
        id: unit.id, unit_no: unit.unit_no, unit_type: unit.unit_type,
        carpet_area_sqm: unit.carpet_area_sqm, dastavej_date: unit.dastavej_date, status: unit.status,
      }],
      classification: { [unit.id]: { agreementValue: before, rateCode: eu.rate_code, ratePct: Number(eu.rate_pct) || 0 } },
    });
    const w = prepared.working.units[0];
    const { error: wErr } = await supabase.from('builder_bu_event_units').update({
      cut_off_date: w.cutOffDate,
      cut_off_source: w.cutOffSource,
      booked_at_cutoff: w.bookedAtCutOff,
      agreement_value: w.agreementValue,
      value_taxed_upto_opening: w.valueTaxedUptoOpening,
      invoiced_before: w.invoicedBefore,
      open_advance_before: w.openAdvanceBefore,
      received_upto_cutoff: w.receivedUptoCutOff,
      differential_value: w.differentialValue,
      differential_taxable_value: w.differentialTaxableValue,
      differential_cgst: w.differentialCgst,
      differential_sgst: w.differentialSgst,
      interest_days: w.interestDays,
      interest_amount: w.interestAmount,
      tie_out_diff: w.tieOutDiff,
      subsumed_receipt_count: w.subsumedReceiptCount,
    }).eq('id', eu.id);
    if (wErr) throw wErr;
    await postBuEventRows({
      eventId: ev.id,
      projectId: ev.project_id,
      prepared,
      postingPeriod: ev.posting_period,
      postingDate: invoiceDate || dateWithinPeriod(ev.bu_date, ev.posting_period),
      docSeries,
      userId: params.userId,
      amendsPeriod,
      amendsDate: amendsPeriod ? invoiceDate : null,
    });
    return { action: 'REWORKED', before, after: w.agreementValue, postingPeriod: ev.posting_period };
  } catch (e) {
    throw new Error(
      `Unit ${unit.unit_no}: its old posting was taken off but the new one failed (${(e as Error).message}). `
      + 'Open BU Working and unpost / prepare the event again.',
    );
  }
}


/**
 * After receipts are saved: any unit among them already closed by a posted
 * event, whose new receipt falls in or before that posting's month and bears
 * its own tax, has its posting redone, so the closing invoice adjusts that
 * receipt in Table 11B (or subsumes it in the BU month) instead of the value
 * being taxed twice (the firm, 19 Nov 2026: GST is paid on the receipts and on
 * the balance only at the dastavej or BU, never twice). A filed month is kept
 * as it is (FILED_KEPT). Returns what was done per unit.
 */
export async function redoClosedUnitsForReceipts(params: {
  receipts: { unitId: string; periodMonth: string; gstAlreadyDischarged?: boolean }[];
  userId: string | null;
}): Promise<{ unitId: string; result: DastavejAutoPostResult }[]> {
  const ids = [...new Set(params.receipts.filter((r) => !r.gstAlreadyDischarged).map((r) => r.unitId))];
  if (!ids.length) return [];
  const { data: us } = await supabase.from('builder_units').select('id, bu_event_id').in('id', ids);
  const closed = ((us || []) as { id: string; bu_event_id: string | null }[]).filter((u) => u.bu_event_id);
  if (!closed.length) return [];
  const { data: evs } = await supabase.from('builder_bu_events').select('id, posting_period, status')
    .in('id', closed.map((u) => u.bu_event_id as string));
  const evById = new Map(((evs || []) as { id: string; posting_period: string; status: string }[]).map((e) => [e.id, e]));
  const key = (p: string) => { const [m, y] = p.split('/').map(Number); return (y || 0) * 100 + (m || 0); };
  const out: { unitId: string; result: DastavejAutoPostResult }[] = [];
  for (const u of closed) {
    const ev = evById.get(u.bu_event_id as string);
    if (!ev || ev.status !== 'POSTED') continue;
    const touches = params.receipts.some((r) => r.unitId === u.id && !r.gstAlreadyDischarged
      && key(r.periodMonth) <= key(ev.posting_period));
    if (!touches) continue;
    out.push({ unitId: u.id, result: await reworkPostedUnitToDeed({ unitId: u.id, userId: params.userId, force: true }) });
  }
  return out;
}


/** For units closed by a posted event: the month that posting went to (unit id → MM/YYYY). */
export async function closedUnitPostingPeriods(unitIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!unitIds.length) return out;
  const { data: us } = await supabase.from('builder_units').select('id, bu_event_id').in('id', unitIds);
  const closed = ((us || []) as { id: string; bu_event_id: string | null }[]).filter((u) => u.bu_event_id);
  if (!closed.length) return out;
  const { data: evs } = await supabase.from('builder_bu_events').select('id, posting_period, status')
    .in('id', closed.map((u) => u.bu_event_id as string)).eq('status', 'POSTED');
  const evById = new Map(((evs || []) as { id: string; posting_period: string }[]).map((e) => [e.id, e.posting_period]));
  closed.forEach((u) => { const p = evById.get(u.bu_event_id as string); if (p) out.set(u.id, p); });
  return out;
}

/** 'MM/YYYY' a later month than 'MM/YYYY' b. */
export const periodAfter = (a: string, b: string): boolean => {
  const k = (p: string) => { const [m, y] = p.split('/').map(Number); return (y || 0) * 100 + (m || 0); };
  return k(a) > k(b);
};


const syncing = new Set<string>();

/**
 * Keep every closed unit's posting in step with its ledger, automatically (the
 * firm, 19 Nov 2026: no Redo button). For each posted event of the project
 * whose GSTR-1 month is not Filed, its units are worked again as at the event;
 * a unit whose base moved since posting (a receipt added, edited, deleted or
 * bounced for an earlier month, an opening balance changed, a deed value
 * changed) or that has a receipt in the BU month not yet subsumed is redone
 * (`reworkPostedUnitToDeed`, force). Nothing is written for a unit that still
 * agrees; a deed value alone is left to the deed's own save. Runs from the
 * Ledger and BU Working when they load, and after a receipt is deleted or
 * bounced; one run per
 * project at a time. Returns the unit numbers redone.
 */
export async function syncClosedUnitPostings(params: {
  projectId: string; userId: string | null;
  /** Only report which units would be redone; write nothing. */
  dryRun?: boolean;
}): Promise<string[]> {
  if (syncing.has(params.projectId)) return [];
  syncing.add(params.projectId);
  try {
    const { data: proj } = await supabase.from('builder_projects').select('client_id').eq('id', params.projectId).single();
    const clientId = (proj as { client_id: string } | null)?.client_id;
    if (!clientId) return [];
    const { data: evs } = await supabase.from('builder_bu_events')
      .select('id, bu_date, posting_period, posting_basis').eq('project_id', params.projectId).eq('status', 'POSTED');
    const events = (evs || []) as { id: string; bu_date: string; posting_period: string; posting_basis: PostingBasis }[];
    if (!events.length) return [];
    const periods = [...new Set(events.map((e) => e.posting_period))];
    const { data: filed } = await supabase.from('filing_status').select('period_month')
      .eq('client_id', clientId).in('return_type', ['GSTR-1', 'GSTR-1 (IFF)']).in('period_month', periods).eq('status', 'Filed');
    const filedSet = new Set(((filed || []) as { period_month: string }[]).map((f) => f.period_month));
    const open = events.filter((e) => !filedSet.has(e.posting_period));
    if (!open.length) return [];

    const { data: eus } = await supabase.from('builder_bu_event_units')
      .select('bu_event_id, unit_id, booked_at_cutoff, agreement_value, value_taxed_upto_opening, open_advance_before, rate_code, rate_pct')
      .in('bu_event_id', open.map((e) => e.id));
    const rows = (eus || []) as {
      bu_event_id: string; unit_id: string; booked_at_cutoff: boolean; agreement_value: number;
      value_taxed_upto_opening: number; open_advance_before: number; rate_code: string; rate_pct: number;
    }[];
    if (!rows.length) return [];
    const { data: us } = await supabase.from('builder_units')
      .select('id, unit_no, unit_type, carpet_area_sqm, dastavej_date, status, bu_event_id').in('id', rows.map((r) => r.unit_id));
    const units = (us || []) as (UnitRowLike & { bu_event_id: string | null })[];

    const stale: { id: string; no: string }[] = [];
    for (const ev of open) {
      const evRows = rows.filter((r) => r.bu_event_id === ev.id);
      const evUnits = units.filter((u) => u.bu_event_id === ev.id && evRows.some((r) => r.unit_id === u.id));
      if (!evUnits.length) continue;
      const prepared = await prepareBuEvent({
        buDate: ev.bu_date, postingPeriod: ev.posting_period, postingBasis: ev.posting_basis, units: evUnits,
        classification: Object.fromEntries(evRows.map((r) => [r.unit_id, {
          agreementValue: Number(r.agreement_value) || 0, rateCode: r.rate_code, ratePct: Number(r.rate_pct) || 0,
        }])),
      });
      const off = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.5;
      for (const w of prepared.working.units) {
        const r = evRows.find((x) => x.unit_id === w.unitId);
        if (!r) continue;
        const unsubsumed = w.bookedAtCutOff && (prepared.receiptsInBuMonth[w.unitId] || []).length > 0;
        // The base only: a deed value differing from the posted value is the
        // deed save's to rework (autoPostDastavejDifferential), not this
        // sweep's, so a unit the firm chose to leave is never redone on load.
        if (w.bookedAtCutOff !== r.booked_at_cutoff
          || off(w.valueTaxedUptoOpening, r.value_taxed_upto_opening) || off(w.openAdvanceBefore, r.open_advance_before)
          || unsubsumed) {
          stale.push({ id: w.unitId, no: w.unitNo });
        }
      }
    }
    if (params.dryRun) return stale.map((u) => u.no);
    const done: string[] = [];
    for (const u of stale) {
      const res = await reworkPostedUnitToDeed({ unitId: u.id, userId: params.userId, force: true });
      if (res.action === 'REWORKED') done.push(u.no);
    }
    return done;
  } finally {
    syncing.delete(params.projectId);
  }
}


/** Work again, as at the event, the lines of some units in a PREPARED event (and accept a deed's value). */
async function refreshPreparedUnits(params: {
  buEventId: string; unitIds: string[]; userId: string | null;
  /** The rate (and value) a unit carried in the event it leaves, when that event is already gone. */
  rates?: Record<string, { rate_code: string; rate_pct: number; agreement_value: number }>;
}): Promise<void> {
  const { data: evRow, error } = await supabase.from('builder_bu_events')
    .select('id, project_id, bu_date, posting_period, posting_basis, status').eq('id', params.buEventId).single();
  if (error || !evRow) throw new Error(error?.message || 'Could not load the BU event');
  const ev = evRow as { id: string; project_id: string; bu_date: string; posting_period: string; posting_basis: PostingBasis; status: string };
  if (ev.status !== 'PREPARED' || !params.unitIds.length) return;
  const { data: us } = await supabase.from('builder_units')
    .select('id, unit_no, unit_type, carpet_area_sqm, dastavej_date, dastavej_value, status').in('id', params.unitIds);
  const units = (us || []) as (UnitRowLike & { dastavej_value: number | null })[];
  const { data: prior } = await supabase.from('builder_bu_event_units')
    .select('unit_id, agreement_value, rate_code, rate_pct').eq('bu_event_id', ev.id).in('unit_id', params.unitIds);
  const priorBy = new Map(((prior || []) as { unit_id: string; agreement_value: number; rate_code: string; rate_pct: number }[]).map((r) => [r.unit_id, r]));
  // A unit new to the event takes the rate its own deed posting used.
  const missing = units.filter((u) => !priorBy.has(u.id)).map((u) => u.id);
  const rateBy = new Map<string, { rate_code: string; rate_pct: number; agreement_value: number }>();
  if (missing.length) {
    const { data: r } = await supabase.from('builder_bu_event_units')
      .select('unit_id, rate_code, rate_pct, agreement_value, created_at').in('unit_id', missing).order('created_at', { ascending: false });
    ((r || []) as { unit_id: string; rate_code: string; rate_pct: number; agreement_value: number }[])
      .forEach((x) => { if (!rateBy.has(x.unit_id)) rateBy.set(x.unit_id, x); });
  }
  const classification = Object.fromEntries(units.map((u) => {
    const p = priorBy.get(u.id) || params.rates?.[u.id] || rateBy.get(u.id);
    return [u.id, { agreementValue: Number(p?.agreement_value) || 0, rateCode: p?.rate_code || 'OTHER_RESIDENTIAL', ratePct: Number(p?.rate_pct) || 0 }];
  }));
  const prepared = await prepareBuEvent({
    buDate: ev.bu_date, postingPeriod: ev.posting_period, postingBasis: ev.posting_basis, units, classification,
  });
  for (const w of prepared.working.units) {
    const row = {
      bu_event_id: ev.id, unit_id: w.unitId,
      cut_off_date: w.cutOffDate, cut_off_source: w.cutOffSource, booked_at_cutoff: w.bookedAtCutOff,
      booking_id: w.bookingId, unit_type: w.unitType, carpet_area_sqm: w.carpetAreaSqM,
      rate_code: w.rateCode, rate_pct: w.ratePct, agreement_value: w.agreementValue,
      value_taxed_upto_opening: w.valueTaxedUptoOpening, invoiced_before: w.invoicedBefore,
      open_advance_before: w.openAdvanceBefore, received_upto_cutoff: w.receivedUptoCutOff,
      differential_value: w.differentialValue, differential_taxable_value: w.differentialTaxableValue,
      differential_cgst: w.differentialCgst, differential_sgst: w.differentialSgst,
      interest_days: w.interestDays, interest_amount: w.interestAmount, tie_out_diff: w.tieOutDiff,
      subsumed_receipt_count: w.subsumedReceiptCount,
    };
    const { error: e } = priorBy.has(w.unitId)
      ? await supabase.from('builder_bu_event_units').update(row).eq('bu_event_id', ev.id).eq('unit_id', w.unitId)
      : await supabase.from('builder_bu_event_units').insert(row);
    if (e) throw e;
    // The value is the registered deed's: accept it in place of the client's
    // confirmation when the acting person may (else it waits like any unit).
    const u = units.find((x) => x.id === w.unitId);
    if (w.bookedAtCutOff && params.userId && u && (Number(u.dastavej_value) || 0) > 0) {
      await overrideAgreementValue({
        buEventId: ev.id, unitId: w.unitId, actorId: params.userId,
        reason: `Value from the registered dastavej of ${u.dastavej_date} (deed value prevails)`,
      }).catch(() => undefined);
    }
  }
}

/**
 * Approve disputed units' values (the client's figure, or one agreed with the
 * client) and work those units again at the approved value. The database checks
 * who is acting and that the event is still PREPARED; each unit is one call.
 * Returns the units approved and any refused, with the database's words.
 */
export async function adoptClientValues(params: {
  buEventId: string; actorId: string; reason?: string | null;
  items: { unitId: string; value: number }[];
}): Promise<{ done: string[]; failed: { unitId: string; message: string }[] }> {
  const done: string[] = [];
  const failed: { unitId: string; message: string }[] = [];
  for (const it of params.items) {
    const { error } = await supabase.rpc('builder_bu_adopt_client_value' as never, {
      p_bu_event_id: params.buEventId, p_unit_id: it.unitId, p_actor_id: params.actorId,
      p_value: it.value, p_reason: params.reason || null,
    } as never);
    if (error) failed.push({ unitId: it.unitId, message: error.message });
    else done.push(it.unitId);
  }
  if (done.length) await refreshPreparedUnits({ buEventId: params.buEventId, unitIds: done, userId: null });
  return { done, failed };
}

/**
 * A prepared BU event takes in its block's units whose own dastavej came
 * after the BU date (the firm, 19 Nov 2026: when the BU is earlier than the
 * dastavej the balance is taxed at the BU). Each such unit's single-unit deed
 * posting, in a month whose GSTR-1 is not Filed, is unposted and removed, and
 * the unit is worked in the BU event as at its date, on the deed value. The
 * event's blocks are those of its units (every unit for a full-project
 * event). Net tax is the same; it is reported as the BU's differential.
 * Returns the unit numbers moved.
 */
export async function moveLaterDeedsIntoBu(params: { buEventId: string; userId: string | null }): Promise<string[]> {
  const { data: evRow } = await supabase.from('builder_bu_events')
    .select('id, project_id, bu_date, scope, status').eq('id', params.buEventId).single();
  const ev = evRow as { id: string; project_id: string; bu_date: string; scope: string; status: string } | null;
  if (!ev || ev.status !== 'PREPARED') return [];
  const { data: proj } = await supabase.from('builder_projects').select('client_id').eq('id', ev.project_id).single();
  const clientId = (proj as { client_id: string } | null)?.client_id;

  const { data: own } = await supabase.from('builder_bu_event_units')
    .select('cut_off_source, unit:builder_units(unit_no)').eq('bu_event_id', ev.id);
  const ownRows = (own || []) as unknown as { cut_off_source: string; unit: { unit_no: string } | null }[];
  // A deed's own event (one unit, cut off at its dastavej) is not a BU and
  // takes in nothing (20 Nov 2026: run on every prepared event, a 13 Oct deed
  // event pulled at the 29 Oct ones).
  if (!ownRows.length || ownRows.every((r) => r.cut_off_source === 'DASTAVEJ')) return [];
  const blocks = new Set(ownRows.map((r) => (r.unit ? unitBlock({ unit_no: r.unit.unit_no }, new Map()) : null)));

  // The project's deed-only events dated after this BU, posted or not (a
  // unit whose deed event was unposted no longer names it, so the events
  // themselves are read, not builder_units.bu_event_id).
  const { data: evs } = await supabase.from('builder_bu_events')
    .select('id, posting_period, status, units:builder_bu_event_units(unit_id, cut_off_source, cut_off_date, rate_code, rate_pct, agreement_value, unit:builder_units(unit_no))')
    .eq('project_id', ev.project_id).neq('id', ev.id);
  type DeedEv = {
    id: string; posting_period: string; status: string;
    units: { unit_id: string; cut_off_source: string; cut_off_date: string; rate_code: string; rate_pct: number;
      agreement_value: number; unit: { unit_no: string } | null }[];
  };
  const deedEvs = ((evs || []) as unknown as DeedEv[]).filter((e) => e.units.length === 1
    && e.units[0].cut_off_source === 'DASTAVEJ'
    && e.units[0].cut_off_date > ev.bu_date
    && (ev.scope === 'FULL' || blocks.has(unitBlock({ unit_no: e.units[0].unit?.unit_no || '' }, new Map()))));
  if (!deedEvs.length) return [];
  const periods = [...new Set(deedEvs.map((e) => e.posting_period))];
  const filedSet = new Set<string>();
  if (clientId && periods.length) {
    const { data: filed } = await supabase.from('filing_status').select('period_month')
      .eq('client_id', clientId).in('return_type', ['GSTR-1', 'GSTR-1 (IFF)']).in('period_month', periods).eq('status', 'Filed');
    ((filed || []) as { period_month: string }[]).forEach((f) => filedSet.add(f.period_month));
  }
  const moved: string[] = [];
  for (const d of deedEvs.filter((e) => !filedSet.has(e.posting_period))) {
    const line = d.units[0];
    if (d.status === 'POSTED') await unpostBuEvent(d.id);
    // A unit is in one event only (UNIQUE unit_id): the deed event goes
    // first, then the unit is worked in the BU at the rate it carried there.
    const { error } = await supabase.from('builder_bu_events').delete().eq('id', d.id);
    if (error) throw error;
    await refreshPreparedUnits({
      buEventId: ev.id, unitIds: [line.unit_id], userId: params.userId,
      rates: { [line.unit_id]: { rate_code: line.rate_code, rate_pct: Number(line.rate_pct) || 0, agreement_value: Number(line.agreement_value) || 0 } },
    });
    moved.push(line.unit?.unit_no || '');
  }
  return moved;
}
