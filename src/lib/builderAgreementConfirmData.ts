import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import { formatINR } from '@/utils/builderRates';

// Per-unit client confirmation of the agreement value behind a BU
// differential — a tokenized email link, no client login required. Mirrors
// requestFsiConsent()/isFsiConsentBlocked() in builderFsiData.ts, but runs
// per unit (many rows per BU event) and skips FSI's second staff-approval
// tier: the client's own token click is the record.

export interface AgreementConfirmUnit {
  unitId: string;
  unitNo: string;
  agreementValue: number;
  /** From builder_bu_event_units.cut_off_source — 'DASTAVEJ' for a
   *  single-unit dastavej-triggered auto-post, whose bu_date is literally the
   *  registered sale deed date, not a genuine BU permission date. */
  cutOffSource?: string;
}

/**
 * Queue one confirmation request per unit. A fresh request for a unit
 * supersedes any earlier one (upsert on the (bu_event_id, unit_id) pair),
 * clearing a prior response — re-sending is how staff re-open a DISPUTED
 * confirmation after correcting the working.
 */
export async function requestAgreementConfirmations(params: {
  buEventId: string;
  clientId: string;
  projectName: string;
  buDate: string;
  staffName: string | null;
  userId: string | null;
  units: AgreementConfirmUnit[];
}): Promise<{ ok: boolean; sent: number; reason?: string }> {
  const { data: client } = await supabase
    .from('clients').select('name, email, gstin').eq('id', params.clientId).maybeSingle();
  if (!client) return { ok: false, sent: 0, reason: 'Client not found.' };
  if (!client.email) return { ok: false, sent: 0, reason: 'No email address on file for this client.' };

  const { data: tpl } = await supabase
    .from('email_templates').select('subject, body, is_active')
    .eq('key', 'builder_bu_agreement_confirm').maybeSingle();
  if (!tpl) return { ok: false, sent: 0, reason: 'Template "builder_bu_agreement_confirm" is missing.' };
  if (tpl.is_active === false) return { ok: false, sent: 0, reason: 'The agreement confirmation template is inactive.' };

  let sent = 0;
  for (const unit of params.units) {
    const { data: existing } = await supabase
      .from('builder_bu_agreement_confirmations')
      .select('id, token')
      .eq('bu_event_id', params.buEventId).eq('unit_id', unit.unitId).maybeSingle();

    const { data: row, error: upErr } = await supabase
      .from('builder_bu_agreement_confirmations')
      .upsert({
        id: existing?.id,
        bu_event_id: params.buEventId,
        unit_id: unit.unitId,
        client_id: params.clientId,
        agreement_value_at_request: unit.agreementValue,
        status: 'PENDING',
        responded_at: null,
        dispute_notes: null,
        created_by: params.userId,
      }, { onConflict: 'bu_event_id,unit_id' })
      .select('id, token').single();
    if (upErr || !row) continue;

    const confirmLink = `${window.location.origin}/agreement-confirm/${row.token}`;
    const vars: Record<string, string> = {
      contact_person: client.name,
      client_name: client.name,
      gstin: client.gstin ?? '',
      unit_no: unit.unitNo,
      project_name: params.projectName,
      bu_date: params.buDate,
      cutoff_label: unit.cutOffSource === 'DASTAVEJ'
        ? 'registered sale deed (dastavej)' : 'building use permission',
      agreement_value: formatINR(unit.agreementValue),
      confirm_link: confirmLink,
      staff_name: params.staffName || GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      firm_phone: GST_FIRM.phone,
    };

    const { data: outbox, error: oErr } = await supabase.from('email_outbox').insert({
      client_id: params.clientId,
      to_email: client.email,
      kind: 'builder_agreement_confirm' as never,
      template_key: 'builder_bu_agreement_confirm',
      return_type: null,
      period_month: null,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      render_vars: vars,
      status: 'pending',
    }).select('id').single();
    if (oErr || !outbox) continue;

    await supabase.from('builder_bu_agreement_confirmations')
      .update({ outbox_id: outbox.id, sent_at: new Date().toISOString() })
      .eq('id', row.id);
    sent += 1;
  }

  if (sent > 0) void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
  return { ok: sent > 0, sent, reason: sent === 0 ? 'Nothing was queued.' : undefined };
}

export interface AgreementConfirmStatus {
  unitId: string;
  status: 'PENDING' | 'CONFIRMED' | 'DISPUTED' | 'NOT_SENT';
  disputeNotes: string | null;
}

/** Confirmation status per unit for a BU event — 'NOT_SENT' for a unit no request has gone out for yet. */
export async function fetchAgreementConfirmationStatus(buEventId: string): Promise<AgreementConfirmStatus[]> {
  const { data, error } = await supabase
    .from('builder_bu_agreement_confirmations')
    .select('unit_id, status, dispute_notes')
    .eq('bu_event_id', buEventId);
  if (error) throw error;
  type Row = { unit_id: string; status: string; dispute_notes: string | null };
  return ((data || []) as unknown as Row[]).map((r) => ({
    unitId: r.unit_id, status: r.status as AgreementConfirmStatus['status'], disputeNotes: r.dispute_notes,
  }));
}

/** Is this client's period blocked by an outstanding BU agreement confirmation? */
export async function isBuAgreementConfirmationBlocked(
  clientId: string,
  periodMonth: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('builder_bu_agreement_confirmation_blocked', {
    _client_id: clientId,
    _period_month: periodMonth,
  });
  if (error) {
    console.warn('[builderAgreementConfirm] gate check failed:', error.message);
    return false;
  }
  return data === true;
}
