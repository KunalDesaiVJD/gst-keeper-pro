import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import { formatINR, type BuilderRateCode } from '@/utils/builderRates';
import { computeFsiWorking, type FsiUnit, type FsiWorking } from '@/utils/builderFsi';
import { prettyPeriodLabel } from '@/utils/builderLedger';

// Preparing, posting and consenting to the TDR/FSI reverse charge.
//
// The working is built from the BU event's own unit rows rather than from the
// live unit master: those rows froze booked-vs-unbooked at the cut-off, and
// that is exactly the split Notification 04/2019 turns on. Reading the master
// today would silently move the answer every time a unit was booked after BU.

export interface PreparedFsi {
  working: FsiWorking;
  units: FsiUnit[];
  buDate: string;
  periodMonth: string;
}

/**
 * Compute the FSI working for a BU event.
 *
 * `projectCarpetSqM` is the whole project's carpet area — the denominator that
 * apportions a project-level FSI cost across block-wise BU permissions.
 */
export async function prepareFsiWorking(params: {
  buEventId: string;
  projectId: string;
  tdrFsiTotalValue: number;
}): Promise<PreparedFsi | null> {
  const { data: ev } = await supabase
    .from('builder_bu_events')
    .select('id, bu_date, posting_period, project_id')
    .eq('id', params.buEventId)
    .maybeSingle();
  if (!ev) return null;
  const event = ev as unknown as { bu_date: string; posting_period: string };

  const { data: eu } = await supabase
    .from('builder_bu_event_units')
    .select('unit_id, unit_type, carpet_area_sqm, rate_code, agreement_value, booked_at_cutoff')
    .eq('bu_event_id', params.buEventId);

  type Row = {
    unit_id: string; unit_type: string; carpet_area_sqm: number;
    rate_code: string; agreement_value: number; booked_at_cutoff: boolean;
  };
  const units: FsiUnit[] = ((eu || []) as unknown as Row[]).map((r) => ({
    unitId: r.unit_id,
    unitType: r.unit_type === 'Commercial' ? 'Commercial' : 'Residential',
    carpetAreaSqM: Number(r.carpet_area_sqm) || 0,
    agreementValue: Number(r.agreement_value) || 0,
    rateCode: r.rate_code as BuilderRateCode,
    bookedAtCutOff: !!r.booked_at_cutoff,
  }));

  // The denominator is every non-cancelled unit in the project, whichever BU
  // event they belong to — a block's share of a project-level FSI cost.
  const { data: all } = await supabase
    .from('builder_units')
    .select('carpet_area_sqm, status')
    .eq('project_id', params.projectId);
  const projectCarpet = ((all || []) as unknown as { carpet_area_sqm: number; status: string }[])
    .filter((u) => u.status !== 'Cancelled')
    .reduce((s, u) => s + (Number(u.carpet_area_sqm) || 0), 0);

  return {
    working: computeFsiWorking({
      tdrFsiTotalValue: params.tdrFsiTotalValue,
      projectCarpetSqM: projectCarpet,
      units,
    }),
    units,
    buDate: event.bu_date,
    periodMonth: event.posting_period,
  };
}

/** Save (or replace) the working for a BU event. */
export async function saveFsiWorking(params: {
  projectId: string;
  buEventId: string;
  prepared: PreparedFsi;
  tdrFsiTotalValue: number;
  treatment: 'PAY' | 'IGNORE';
  notes: string | null;
  userId: string | null;
}): Promise<string> {
  const w = params.prepared.working;
  const { data, error } = await supabase.from('builder_fsi_workings').upsert({
    project_id: params.projectId,
    bu_event_id: params.buEventId,
    period_month: params.prepared.periodMonth,
    tdr_fsi_total_value: params.tdrFsiTotalValue,
    event_carpet_sqm: w.eventCarpetSqM,
    project_carpet_sqm: w.projectCarpetSqM,
    allocated_value: w.allocatedValue,
    residential_carpet_sqm: w.residentialCarpetSqM,
    commercial_carpet_sqm: w.commercialCarpetSqM,
    unbooked_residential_carpet_sqm: w.unbookedResidentialCarpetSqM,
    unbooked_residential_value: w.unbookedResidentialValue,
    residential_portion: w.residentialPortion,
    residential_rcm_uncapped: w.residentialRcmUncapped,
    cap_amount: w.capAmount,
    cap_applied: w.capApplied,
    residential_rcm: w.residentialRcm,
    commercial_portion: w.commercialPortion,
    commercial_rcm: w.commercialRcm,
    total_rcm: w.totalRcm,
    cgst: w.cgst,
    sgst: w.sgst,
    treatment: params.treatment,
    status: 'DRAFT',
    notes: params.notes,
    updated_by: params.userId,
  }, { onConflict: 'bu_event_id' }).select('id').single();
  if (error) throw error;
  return data.id;
}

/**
 * Commit the working.
 *
 * PAY posts it to 3B Table 3.1(d), payable in cash. IGNORE holds it back and
 * arms the consent gate — the period will not file until the client's written
 * instruction is on file and a GST Manager has approved it.
 */
export async function postFsiWorking(params: {
  workingId: string;
  treatment: 'PAY' | 'IGNORE';
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('builder_fsi_workings').update({
    status: params.treatment === 'PAY' ? 'POSTED' : 'IGNORED',
    posted_at: new Date().toISOString(),
    posted_by: params.userId,
  }).eq('id', params.workingId);
  if (error) throw error;
}

// ─── Consent ────────────────────────────────────────────────────────────────

/**
 * Ask the client, in writing, to confirm the instruction not to pay.
 *
 * The figures are frozen onto the consent row as well as into the letter, so
 * the record still matches what was asked even if the working is later
 * re-prepared against changed inputs.
 */
export async function requestFsiConsent(params: {
  workingId: string;
  clientId: string;
  projectId: string;
  projectName: string;
  periodMonth: string;
  buDate: string;
  fsiValue: number;
  rcmAmount: number;
  staffName: string | null;
  userId: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const { data: client } = await supabase
    .from('clients').select('name, email, gstin').eq('id', params.clientId).maybeSingle();
  if (!client) return { ok: false, reason: 'Client not found.' };
  if (!client.email) return { ok: false, reason: 'No email address on file for this client.' };

  const { data: tpl } = await supabase
    .from('email_templates').select('subject, body, is_active')
    .eq('key', 'builder_fsi_consent').maybeSingle();
  if (!tpl) return { ok: false, reason: 'Template "builder_fsi_consent" is missing.' };
  if (tpl.is_active === false) return { ok: false, reason: 'The FSI consent template is inactive.' };

  const vars: Record<string, string> = {
    contact_person: client.name,
    client_name: client.name,
    gstin: client.gstin ?? '',
    project_name: params.projectName,
    bu_date: params.buDate,
    period: prettyPeriodLabel(params.periodMonth),
    fsi_value: formatINR(params.fsiValue),
    rcm_amount: formatINR(params.rcmAmount),
    staff_name: params.staffName || GST_FIRM.team,
    firm_name: GST_FIRM.name,
    firm_email: GST_FIRM.email,
    firm_phone: GST_FIRM.phone,
  };

  const { data: outbox, error: oErr } = await supabase.from('email_outbox').insert({
    client_id: params.clientId,
    to_email: client.email,
    kind: 'builder_fsi' as never,
    template_key: 'builder_fsi_consent',
    return_type: null,
    period_month: params.periodMonth,
    subject: renderTemplate(tpl.subject, vars),
    body: renderTemplate(tpl.body, vars),
    render_vars: vars,
    status: 'pending',
  }).select('id').single();
  if (oErr || !outbox) return { ok: false, reason: oErr?.message || 'Could not queue the email.' };

  const { error } = await supabase.from('builder_fsi_consents').upsert({
    fsi_working_id: params.workingId,
    client_id: params.clientId,
    project_id: params.projectId,
    period_month: params.periodMonth,
    fsi_value_at_request: params.fsiValue,
    rcm_at_request: params.rcmAmount,
    outbox_id: outbox.id,
    email_sent_at: new Date().toISOString(),
    // A fresh request supersedes any earlier confirmation and approval.
    confirmation_received_at: null,
    approved_at: null,
    approved_by: null,
    created_by: params.userId,
  }, { onConflict: 'fsi_working_id' });
  if (error) return { ok: false, reason: error.message };

  void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
  return { ok: true };
}

export async function recordFsiConfirmation(params: {
  workingId: string;
  documentUrl: string | null;
  notes: string | null;
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('builder_fsi_consents').update({
    confirmation_received_at: new Date().toISOString(),
    confirmation_document_url: params.documentUrl,
    notes: params.notes,
    received_by: params.userId,
  }).eq('fsi_working_id', params.workingId);
  if (error) throw error;
}

/**
 * GST Manager sign-off — the last of the three steps.
 *
 * Restricted by role rather than by row permission: this is the firm accepting
 * a client's position on its own filing, and that is not an employee's call.
 */
export async function approveFsiConsent(params: {
  workingId: string;
  userId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('builder_fsi_consents').update({
    approved_at: new Date().toISOString(),
    approved_by: params.userId,
  }).eq('fsi_working_id', params.workingId);
  if (error) throw error;
}

/** Is this client's period blocked by an outstanding FSI consent? */
export async function isFsiConsentBlocked(
  clientId: string,
  periodMonth: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('builder_fsi_consent_blocked', {
    _client_id: clientId,
    _period_month: periodMonth,
  });
  if (error) {
    console.warn('[builderFsi] consent gate check failed:', error.message);
    return false;
  }
  return data === true;
}
