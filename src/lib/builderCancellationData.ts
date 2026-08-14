// Booking cancellation + refund tracking — data access.
//
// Two GST-correction paths, chosen once per cancellation, never both:
//   CREDIT_NOTE — raised in full, immediately, via the existing §11 route.
//   SETOFF      — no credit note. Each refund payment (there can be several,
//                 across several months) nets against that payment's own
//                 period's Table 11A pool at the cancelled rate; whatever
//                 doesn't fit is forfeited permanently, never carried
//                 forward. See planCancellationOffset for why.
//
// A cancelled booking's receipts are stamped cancelled_via_id so they stop
// being offered up as "open advances" for a future booking on the same unit
// (see openAdvancesFor in BuilderBookingsPage.tsx) — this never touches an
// already-posted period's own Table 11A figures.

import { supabase } from '@/integrations/supabase/client';
import {
  classifyUnit, computeTax, formatINR, testRrep, type BuilderRateCode, type UnitType,
} from '@/utils/builderRates';
import { planCancellationOffset } from '@/utils/builderAdjustments';
import { computeUnitLedger, dateToPeriod, prettyPeriodLabel } from '@/utils/builderLedger';
import { fetchBuilderSettings } from '@/lib/builderSettings';
import {
  autoReclassifyProject, raiseCreditNote, findAvailableInPeriod, type OriginalDocument,
} from '@/lib/builderAdjustmentsData';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';

const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * What a cancellation credit note actually reverses — auto-derived, never
 * typed by hand. A booking's advances are taxed on a receipt voucher, not a
 * tax invoice (see the "Nature" split in the Bookings page); a formal
 * invoice only exists for whatever portion a milestone has since absorbed
 * (builder_advance_adjustments). So: reference the absorbed invoice(s) for
 * the invoiced portion, and the receipt voucher(s) for whatever is still a
 * bare, un-invoiced advance.
 */
async function buildOriginalDocuments(
  receipts: { id: string; consideration: number; receipt_date: string; doc_no: string | null }[],
  fallbackDate: string,
): Promise<OriginalDocument[]> {
  const receiptIds = receipts.map((r) => r.id);
  const { data: adjRows } = receiptIds.length
    ? await supabase.from('builder_advance_adjustments')
      .select('receipt_id, invoice_id, consideration_adjusted').in('receipt_id', receiptIds)
    : { data: [] };
  const adjustments = (adjRows || []) as { receipt_id: string; invoice_id: string; consideration_adjusted: number }[];

  const absorbedByReceipt = new Map<string, number>();
  const absorbedByInvoice = new Map<string, number>();
  adjustments.forEach((a) => {
    const amt = Number(a.consideration_adjusted) || 0;
    absorbedByReceipt.set(a.receipt_id, (absorbedByReceipt.get(a.receipt_id) || 0) + amt);
    absorbedByInvoice.set(a.invoice_id, (absorbedByInvoice.get(a.invoice_id) || 0) + amt);
  });

  const invoiceIds = [...absorbedByInvoice.keys()];
  const { data: invRows } = invoiceIds.length
    ? await supabase.from('builder_invoices').select('id, doc_no, invoice_date').in('id', invoiceIds)
    : { data: [] };
  const invoicesById = new Map(
    ((invRows || []) as { id: string; doc_no: string | null; invoice_date: string }[]).map((i) => [i.id, i]),
  );

  const documents: OriginalDocument[] = [];
  absorbedByInvoice.forEach((amount, invoiceId) => {
    const inv = invoicesById.get(invoiceId);
    documents.push({
      docType: 'INVOICE', docNo: inv?.doc_no || null, docDate: inv?.invoice_date || fallbackDate,
      amount: round2(amount),
    });
  });
  receipts.forEach((r) => {
    const remainder = round2((Number(r.consideration) || 0) - (absorbedByReceipt.get(r.id) || 0));
    if (remainder > 0.005) {
      documents.push({ docType: 'RECEIPT', docNo: r.doc_no, docDate: r.receipt_date, amount: remainder });
    }
  });
  return documents;
}

export interface CancelBookingParams {
  bookingId: string;
  unitId: string;
  projectId: string;
  cancellationDate: string;
  reason: string;
  forfeitureAmount: number;
  cancellationChargeTaxable: number;
  correctionMethod: 'CREDIT_NOTE' | 'SETOFF' | 'NONE';
  /** false (default) frees the unit for resale; true retires it permanently. */
  retireUnit: boolean;
  periodMonth: string;
  docSeriesPrefix: string | null;
  userId: string | null;
}

export interface CancelBookingResult {
  cancellationId: string;
  refundPayable: number;
  totalReceived: number;
  creditNoteId: string | null;
}

/**
 * Cancel a booking: freezes what was already taxed, corrects it (credit note
 * or leaves it for set-off later), taxes the forfeiture/charge split, frees
 * the unit, and stops its receipts being reused as open advances.
 *
 * A booking whose receipts span more than one rate code (re-rated mid-way)
 * is refused — splitting that correction correctly needs a human, not this
 * one-shot flow.
 */
export async function cancelBooking(params: CancelBookingParams): Promise<CancelBookingResult> {
  const { data: rcpts, error: rErr } = await supabase
    .from('builder_receipts')
    .select('id, consideration, rate_code, rate_pct, receipt_date, doc_no')
    .eq('booking_id', params.bookingId)
    .eq('receipt_nature', 'ADVANCE')
    .neq('cheque_status', 'Bounced')
    .is('subsumed_by_bu_event_id', null);
  if (rErr) throw rErr;
  const rows = (rcpts || []) as {
    id: string; consideration: number; rate_code: string; rate_pct: number; receipt_date: string; doc_no: string | null;
  }[];

  const rateCodes = new Set(rows.map((r) => r.rate_code));
  if (rateCodes.size > 1) {
    throw new Error(
      'This booking carries receipts taxed at more than one rate (likely re-rated mid-way) — '
      + 'raise the correction manually, one credit note per rate, instead of using this flow.',
    );
  }
  const rateCode = (rows[0]?.rate_code || 'AFFORDABLE') as BuilderRateCode;
  const ratePct = rows[0]?.rate_pct ?? 0;
  const totalReceived = round2(rows.reduce((s, r) => s + (Number(r.consideration) || 0), 0));
  const earliestReceiptDate = rows.reduce(
    (min, r) => (!min || r.receipt_date < min ? r.receipt_date : min),
    '' as string,
  ) || params.cancellationDate;

  const chargeTax = params.cancellationChargeTaxable > 0
    ? computeTax(params.cancellationChargeTaxable, rateCode)
    : null;
  const refundPayable = Math.max(0, round2(
    totalReceived - (params.forfeitureAmount || 0) - (chargeTax ? chargeTax.consideration + chargeTax.totalTax : 0),
  ));

  const { data: cxl, error: cErr } = await supabase.from('builder_cancellations').insert({
    booking_id: params.bookingId,
    unit_id: params.unitId,
    project_id: params.projectId,
    cancellation_date: params.cancellationDate,
    reason: params.reason || null,
    rate_code: rateCode,
    rate_pct: ratePct,
    total_received: totalReceived,
    forfeiture_amount: params.forfeitureAmount || 0,
    cancellation_charge_taxable: params.cancellationChargeTaxable || 0,
    correction_method: params.correctionMethod,
    refund_payable: refundPayable,
    refund_paid: 0,
    status: refundPayable > 0.005 ? 'OPEN' : 'SETTLED',
    created_by: params.userId,
  }).select('id').single();
  if (cErr || !cxl) throw cErr || new Error('Could not record the cancellation.');

  let creditNoteId: string | null = null;
  if (params.correctionMethod === 'CREDIT_NOTE' && totalReceived > 0.005) {
    const originalDocuments = await buildOriginalDocuments(rows, params.cancellationDate);
    const note = await raiseCreditNote({
      unitId: params.unitId,
      bookingId: params.bookingId,
      noteDate: params.cancellationDate,
      noteType: 'CANCELLATION',
      consideration: totalReceived,
      rateCode,
      originalDocDate: earliestReceiptDate,
      originalDocuments,
      periodMonth: params.periodMonth,
      docSeries: params.docSeriesPrefix,
      docNo: null,
      reason: params.reason || 'Booking cancelled',
      userId: params.userId,
    });
    creditNoteId = note.id;
  }

  let chargeInvoiceId: string | null = null;
  if (chargeTax) {
    const { data: inv, error: iErr } = await supabase.from('builder_invoices').insert({
      booking_id: params.bookingId,
      unit_id: params.unitId,
      invoice_date: params.cancellationDate,
      invoice_type: 'CANCELLATION_CHARGE',
      milestone_label: 'Cancellation charge',
      consideration: chargeTax.consideration,
      rate_code: rateCode,
      rate_pct: chargeTax.ratePct,
      taxable_value: chargeTax.taxableValue,
      cgst: chargeTax.cgst,
      sgst: chargeTax.sgst,
      period_month: params.periodMonth,
      doc_series: params.docSeriesPrefix,
      doc_no: null,
      created_by: params.userId,
    }).select('id').single();
    if (iErr) throw iErr;
    chargeInvoiceId = inv?.id ?? null;
  }

  await supabase.from('builder_cancellations').update({
    credit_note_id: creditNoteId,
    cancellation_charge_invoice_id: chargeInvoiceId,
  }).eq('id', cxl.id);

  if (rows.length) {
    await supabase.from('builder_receipts')
      .update({ cancelled_via_id: cxl.id })
      .in('id', rows.map((r) => r.id));
  }

  await supabase.from('builder_bookings').update({
    status: 'Cancelled',
    cancelled_on: params.cancellationDate,
    cancellation_reason: params.reason || null,
  }).eq('id', params.bookingId);

  await supabase.from('builder_units').update({
    status: params.retireUnit ? 'Cancelled' : 'Available',
  }).eq('id', params.unitId);

  // Once these receipts carry cancelled_via_id, computeUnitLedger will never
  // count them again (a re-booking of this unit must not inherit a refunded
  // member's money) — so this is the last moment a ₹45L crossing that
  // happened during this booking's life can still be caught. Never blocks
  // the cancellation itself if the check fails; the ongoing sweep already
  // exists as a backstop for a unit that's still live.
  try {
    await checkReclassificationOnCancellation({
      unitId: params.unitId, projectId: params.projectId, cancellationId: cxl.id, userId: params.userId,
    });
  } catch (e) {
    console.warn('[builderCancellation] frozen re-rating check failed:', (e as Error).message);
  }

  return { cancellationId: cxl.id, refundPayable, totalReceived, creditNoteId };
}

/**
 * Freezes the unit's classification using every receipt/invoice not
 * cancelled by an EARLIER cancellation (i.e. including the one this call
 * just stamped) and, if it crosses ₹45L, runs it through the same DRC-03
 * pipeline a live crossing would — scoped to just this unit via
 * autoReclassifyProject's classification map, so no other unit is touched.
 */
async function checkReclassificationOnCancellation(params: {
  unitId: string;
  projectId: string;
  cancellationId: string;
  userId: string | null;
}): Promise<void> {
  const { data: unit } = await supabase.from('builder_units')
    .select('unit_type, carpet_area_sqm, base_consideration').eq('id', params.unitId).maybeSingle();
  if (!unit) return;
  const u = unit as unknown as { unit_type: UnitType; carpet_area_sqm: number; base_consideration: number };

  const { data: proj } = await supabase.from('builder_projects')
    .select('client_id, is_metro, carpet_area_source, manual_residential_carpet_sqm, manual_commercial_carpet_sqm')
    .eq('id', params.projectId).maybeSingle();
  if (!proj) return;
  const p = proj as unknown as {
    client_id: string; is_metro: boolean; carpet_area_source: string;
    manual_residential_carpet_sqm: number; manual_commercial_carpet_sqm: number;
  };

  const [settings, { data: chg }, { data: rcp }, { data: inv }, { data: opn }, { data: allUnits }] = await Promise.all([
    fetchBuilderSettings(p.client_id),
    supabase.from('builder_unit_charges').select('charge_head, amount, include_override').eq('unit_id', params.unitId),
    supabase.from('builder_receipts').select('*').eq('unit_id', params.unitId),
    supabase.from('builder_invoices').select('*').eq('unit_id', params.unitId),
    supabase.from('builder_opening_balances').select('*').eq('unit_id', params.unitId).maybeSingle(),
    supabase.from('builder_units').select('unit_type, carpet_area_sqm, status').eq('project_id', params.projectId),
  ]);

  let resi = 0, comm = 0;
  if (p.carpet_area_source === 'MANUAL') {
    resi = Number(p.manual_residential_carpet_sqm) || 0;
    comm = Number(p.manual_commercial_carpet_sqm) || 0;
  } else {
    type UnitCarpet = { unit_type: string; carpet_area_sqm: number; status: string };
    ((allUnits || []) as unknown as UnitCarpet[]).forEach((au) => {
      if (au.status === 'Cancelled') return;
      if (au.unit_type === 'Residential') resi += Number(au.carpet_area_sqm) || 0;
      else comm += Number(au.carpet_area_sqm) || 0;
    });
  }
  const rrep = testRrep(resi, comm);

  type Receipt = {
    id: string; consideration: number; cgst: number; sgst: number; tds_194ia: number;
    bank_credit: number | null; receipt_nature: string; cheque_status: string;
    gst_already_discharged: boolean; subsumed_by_bu_event_id: string | null; cancelled_via_id: string | null;
  };
  const receipts = ((rcp || []) as unknown as Receipt[])
    .filter((r) => !r.cancelled_via_id || r.cancelled_via_id === params.cancellationId);

  type Invoice = { id: string; consideration: number; cgst: number; sgst: number };
  const invoices = (inv || []) as unknown as Invoice[];
  const invoiceIds = invoices.map((i) => i.id);
  const [{ data: adj }, { data: obAdj }] = invoiceIds.length
    ? await Promise.all([
      supabase.from('builder_advance_adjustments').select('consideration_adjusted, cgst, sgst, invoice_id')
        .in('invoice_id', invoiceIds),
      supabase.from('builder_opening_balance_adjustments').select('consideration_adjusted, cgst, sgst, invoice_id')
        .in('invoice_id', invoiceIds),
    ])
    : [{ data: [] }, { data: [] }];
  type Adjustment = { invoice_id: string; consideration_adjusted: number; cgst: number; sgst: number };
  const adjustments = (adj || []) as unknown as Adjustment[];
  const openingAdjustments = (obAdj || []) as unknown as Adjustment[];

  const ledger = computeUnitLedger({
    agreementValue: 0,
    opening: (opn || undefined) as never,
    receipts: receipts.map((r) => ({
      consideration: r.consideration, cgst: r.cgst, sgst: r.sgst, tds_194ia: r.tds_194ia,
      bank_credit: r.bank_credit, receipt_nature: r.receipt_nature as never,
      cheque_status: r.cheque_status as never, gst_already_discharged: r.gst_already_discharged,
      subsumed_by_bu_event_id: r.subsumed_by_bu_event_id,
    })),
    invoices: invoices.map((i) => ({ consideration: i.consideration, cgst: i.cgst, sgst: i.sgst })),
    adjustments: adjustments.map((a) => ({
      consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
    })),
    openingAdjustments: openingAdjustments.map((a) => ({
      consideration_adjusted: a.consideration_adjusted, cgst: a.cgst, sgst: a.sgst,
    })),
  });

  type Charge = { charge_head: string; amount: number; include_override: boolean | null };
  const cls = classifyUnit({
    unitType: u.unit_type,
    carpetAreaSqM: Number(u.carpet_area_sqm) || 0,
    baseConsideration: Number(u.base_consideration) || 0,
    charges: ((chg || []) as unknown as Charge[]).map((c) => ({
      charge_head: c.charge_head as never, amount: Number(c.amount) || 0, include_override: c.include_override,
    })),
    isMetro: p.is_metro ?? false,
    isRrep: rrep.isRrep,
    settings: settings as never,
    knownConsideration: ledger.considerationRecognized,
  });

  await autoReclassifyProject(
    params.projectId,
    { [params.unitId]: { rateCode: cls.rateCode, ratePct: cls.ratePct, agreementValue: cls.gross.gross } },
    params.userId,
    p.client_id,
  );
}

export interface RecordRefundPaymentParams {
  cancellationId: string;
  paymentDate: string;
  amount: number;
  instrumentType: string;
  instrumentRef: string;
  notes: string;
  userId: string | null;
  // Context needed for the offset calc and the confirmation email — the
  // caller already has all of this loaded, cheaper than re-querying here.
  clientId: string;
  projectId: string;
  rateCode: BuilderRateCode;
  correctionMethod: 'CREDIT_NOTE' | 'SETOFF' | 'NONE';
  unitNo: string;
  projectName: string;
  cancellationDate: string;
  cancellationReason: string | null;
}

export interface RecordRefundPaymentResult {
  offsetAmount: number;
  forfeitedAmount: number;
  refundPaid: number;
  status: 'OPEN' | 'SETTLED';
  emailQueued: boolean;
  emailSkippedReason?: string;
}

/**
 * Record one actual repayment to the cancelled member. For a SETOFF
 * cancellation this is also the moment the offset happens — computed fresh
 * against THIS payment's own period, since a cancellation refunded over
 * several months is several independent attempts, not one plan made upfront.
 */
export async function recordRefundPayment(params: RecordRefundPaymentParams): Promise<RecordRefundPaymentResult> {
  const periodMonth = dateToPeriod(params.paymentDate);
  let offsetAmount = 0, taxableValue = 0, cgst = 0, sgst = 0, forfeitedAmount = 0;

  if (params.correctionMethod === 'SETOFF') {
    const available = await findAvailableInPeriod({
      projectId: params.projectId,
      rateCode: params.rateCode,
      periodMonth,
    });
    const plan = planCancellationOffset({
      refundAmount: params.amount,
      availableInPeriod: available,
      rateCode: params.rateCode,
    });
    offsetAmount = plan.offsetAmount;
    taxableValue = plan.taxableValue;
    cgst = plan.cgst;
    sgst = plan.sgst;
    forfeitedAmount = plan.forfeitedAmount;
  }

  const { data: payment, error } = await supabase.from('builder_refund_payments').insert({
    cancellation_id: params.cancellationId,
    payment_date: params.paymentDate,
    period_month: periodMonth,
    amount: params.amount,
    instrument_type: params.instrumentType || null,
    instrument_ref: params.instrumentRef || null,
    notes: params.notes || null,
    offset_amount: offsetAmount,
    offset_taxable_value: taxableValue,
    offset_cgst: cgst,
    offset_sgst: sgst,
    forfeited_amount: forfeitedAmount,
    created_by: params.userId,
  }).select('id').single();
  if (error || !payment) throw error || new Error('Could not record the refund payment.');

  const { data: cxl } = await supabase.from('builder_cancellations')
    .select('refund_payable, refund_paid').eq('id', params.cancellationId).maybeSingle();
  const newPaid = round2((Number(cxl?.refund_paid) || 0) + params.amount);
  const newStatus: 'OPEN' | 'SETTLED' = newPaid >= (Number(cxl?.refund_payable) || 0) - 0.005 ? 'SETTLED' : 'OPEN';
  await supabase.from('builder_cancellations')
    .update({ refund_paid: newPaid, status: newStatus }).eq('id', params.cancellationId);

  let emailQueued = false;
  let emailSkippedReason: string | undefined;
  if (params.correctionMethod === 'SETOFF') {
    const res = await requestCancellationSetoffConfirmation({
      clientId: params.clientId,
      unitNo: params.unitNo,
      projectName: params.projectName,
      cancellationDate: params.cancellationDate,
      cancellationReason: params.cancellationReason,
      paymentDate: params.paymentDate,
      paymentAmount: params.amount,
      periodMonth,
      offsetAmount,
      forfeitedAmount,
    });
    emailQueued = res.ok;
    emailSkippedReason = res.reason;
    if (res.ok && res.outboxId) {
      await supabase.from('builder_refund_payments').update({ email_outbox_id: res.outboxId }).eq('id', payment.id);
    }
  }

  return { offsetAmount, forfeitedAmount, refundPaid: newPaid, status: newStatus, emailQueued, emailSkippedReason };
}

/**
 * Ask the client to confirm the set-off treatment once the period it landed
 * in is filed — mirrors requestFsiConsent() in builderFsiData.ts exactly.
 * Fired once per refund payment, not once per cancellation: a cancellation
 * refunded across several months sends one email per month it touches.
 */
export async function requestCancellationSetoffConfirmation(params: {
  clientId: string;
  unitNo: string;
  projectName: string;
  cancellationDate: string;
  cancellationReason: string | null;
  paymentDate: string;
  paymentAmount: number;
  periodMonth: string;
  offsetAmount: number;
  forfeitedAmount: number;
}): Promise<{ ok: boolean; outboxId?: string; reason?: string }> {
  const { data: client } = await supabase
    .from('clients').select('name, email, gstin').eq('id', params.clientId).maybeSingle();
  if (!client) return { ok: false, reason: 'Client not found.' };
  if (!client.email) return { ok: false, reason: 'No email address on file for this client.' };

  const { data: tpl } = await supabase
    .from('email_templates').select('subject, body, is_active')
    .eq('key', 'builder_cancellation_setoff').maybeSingle();
  if (!tpl) return { ok: false, reason: 'Template "builder_cancellation_setoff" is missing.' };
  if (tpl.is_active === false) return { ok: false, reason: 'The cancellation set-off template is inactive.' };

  const vars: Record<string, string> = {
    contact_person: client.name,
    client_name: client.name,
    gstin: client.gstin ?? '',
    unit_no: params.unitNo,
    project_name: params.projectName,
    cancellation_date: params.cancellationDate,
    cancellation_reason_clause: params.cancellationReason ? ` (${params.cancellationReason})` : '',
    period: prettyPeriodLabel(params.periodMonth),
    payment_date: params.paymentDate,
    payment_amount: formatINR(params.paymentAmount),
    offset_amount: formatINR(params.offsetAmount),
    forfeited_clause: params.forfeitedAmount > 0.005
      ? `${formatINR(params.forfeitedAmount)} of this payment could not be set off against `
        + `${prettyPeriodLabel(params.periodMonth)}'s collections and has been permanently written off — `
        + 'it will not be carried to a later month.'
      : '',
    staff_name: GST_FIRM.team,
    firm_name: GST_FIRM.name,
    firm_email: GST_FIRM.email,
    firm_phone: GST_FIRM.phone,
  };

  const { data: outbox, error } = await supabase.from('email_outbox').insert({
    client_id: params.clientId,
    to_email: client.email,
    kind: 'builder_cancellation' as never,
    template_key: 'builder_cancellation_setoff',
    return_type: null,
    period_month: params.periodMonth,
    subject: renderTemplate(tpl.subject, vars),
    body: renderTemplate(tpl.body, vars),
    render_vars: vars,
    status: 'pending',
  }).select('id').single();
  if (error || !outbox) return { ok: false, reason: error?.message || 'Could not queue the email.' };
  return { ok: true, outboxId: outbox.id };
}
