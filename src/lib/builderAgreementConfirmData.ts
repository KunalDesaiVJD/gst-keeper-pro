import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import { formatINR } from '@/utils/builderRates';
import { isClearedStatus, parseEmailList, type ConfirmStatus } from '@/lib/builderConfirmRules';

// Client confirmation of the agreement value behind a BU differential, by a
// tokenized e-mail link (no login). Since 21 Oct 2026 one e-mail goes per
// send: To and CC typed by staff, every outstanding unit listed, one link.
// Anyone it was sent to (To or CC, never the firm's own addresses) may answer
// on the page, which asks their name and e-mail, checks the e-mail against the
// request, and records them on each unit they answer
// (supabase/migrations/20261021140000_bu_confirm_cc.sql). The per-unit rows in
// builder_bu_agreement_confirmations stay the record the posting gate reads.
// Per-unit links e-mailed before that keep working until a new request asks
// about their unit.

export interface AgreementConfirmUnit {
  unitId: string;
  unitNo: string;
  agreementValue: number;
  /** From builder_bu_event_units.cut_off_source — 'DASTAVEJ' for a
   *  single-unit dastavej-triggered auto-post, whose bu_date is literally the
   *  registered sale deed date, not a genuine BU permission date. */
  cutOffSource?: string;
  /** builder_bu_event_units.cut_off_date (ISO). */
  cutOffDate?: string;
}

// Address rules (valid, the firm's own, "Name <addr>" pastes) live in a pure
// module so scripts/verify-bu-confirm.mjs can run them.
export { EMAIL_RE, emailOk, isFirmAddress, parseEmailList } from '@/lib/builderConfirmRules';

export const AGREEMENT_CONFIRM_TEMPLATE = 'builder_bu_agreement_confirm_request';

const longDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** The client master's e-mail, split into addresses, to fill the To box;
 *  invalid: the parts left out (shown, so a bad master address is not lost). */
export async function fetchClientEmails(clientId: string): Promise<{ valid: string[]; invalid: string[] }> {
  const { data } = await supabase.from('clients').select('email').eq('id', clientId).maybeSingle();
  return parseEmailList(data?.email || '');
}

/** A ticked unit someone answered while the pop-up was open: left out of the send. */
export interface AnsweredMeanwhile {
  unitId: string;
  unitNo: string;
  status: string;
  respondedByName: string | null;
  respondedByEmail: string | null;
}

export interface SendConfirmResult {
  ok: boolean;
  /** The e-mail's outbox status after the send: sent, pending (goes with the
   *  next run), failed, sending/unknown (may have gone); 'answered' when every
   *  ticked unit was answered meanwhile; 'error' when refused. */
  status: string;
  sent: number;
  requestId?: string;
  link?: string;
  reason?: string;
  /** Units answered meanwhile, left out of the e-mail. */
  skipped: AnsweredMeanwhile[];
}

type SendRpcResult = {
  sent?: boolean;
  request_id?: string;
  outbox_id?: string;
  link?: string;
  units?: number;
  already_answered?: { unit_id: string; unit_no: string; status: string; responded_by_name: string | null; responded_by_email: string | null }[];
};

/**
 * Ask about some units of one BU event in ONE e-mail to everyone in To and
 * CC. The database writes the request, points each unit at it (status
 * PENDING; an earlier dispute cleared; the earlier link for the unit then
 * shows it replaced), gives the event's other taxable units a NOT_SENT row
 * (so they still block filing) and queues the e-mail, all or nothing. A unit
 * confirmed or accepted meanwhile is reported back instead: it is left out,
 * the e-mail is filled in again for the rest and sent. Then the e-mail is sent
 * at once.
 */
export async function requestAgreementConfirmations(params: {
  buEventId: string;
  clientId: string;
  projectName: string;
  buDate: string;
  /** The event is a single-unit dastavej post: its date is the sale deed's. */
  dastavejEvent: boolean;
  staffName: string | null;
  userId: string | null;
  to: string[];
  cc: string[];
  units: AgreementConfirmUnit[];
}): Promise<SendConfirmResult> {
  const skipped: AnsweredMeanwhile[] = [];
  const refuse = (reason: string): SendConfirmResult => ({ ok: false, status: 'error', sent: 0, reason, skipped });
  if (!params.userId) return refuse('Sign in again: who is sending is not known.');
  if (!params.units.length) return refuse('Tick at least one unit.');
  if (!params.to.length) return refuse('Enter at least one To address.');

  const { data: client } = await supabase
    .from('clients').select('name, gstin').eq('id', params.clientId).maybeSingle();
  if (!client) return refuse('Client not found.');

  const { data: tpl } = await supabase
    .from('email_templates').select('subject, body, is_active')
    .eq('key', AGREEMENT_CONFIRM_TEMPLATE).maybeSingle();
  if (!tpl) return refuse(`Template "${AGREEMENT_CONFIRM_TEMPLATE}" is missing.`);
  if (tpl.is_active === false) return refuse('The agreement confirmation template is switched off under Reminders.');
  if (!tpl.body.includes('{{confirm_link}}')) {
    return refuse('The template has no {{confirm_link}}: add it back under Reminders, Templates.');
  }

  const fill = (units: AgreementConfirmUnit[]): Record<string, string> => {
    const lines = units.map((u) => {
      const deed = !params.dastavejEvent && u.cutOffSource === 'DASTAVEJ' && u.cutOffDate
        ? ` (taxable from its sale deed of ${longDate(u.cutOffDate)})` : '';
      return `Unit ${u.unitNo}: Rs. ${formatINR(u.agreementValue)}${deed}`;
    });
    const total = units.reduce((a, u) => a + (Number(u.agreementValue) || 0), 0);
    return {
      contact_person: client.name,
      client_name: client.name,
      gstin: client.gstin ?? '',
      project_name: params.projectName,
      bu_date: longDate(params.buDate),
      cutoff_label: params.dastavejEvent ? 'registered sale deed (dastavej)' : 'building use permission',
      unit_count: `${units.length} unit${units.length === 1 ? '' : 's'}`,
      unit_table: lines.join('\n'),
      total_value: formatINR(total),
      // Left in place: the database makes the token and puts the link here.
      confirm_link: '{{confirm_link}}',
      staff_name: params.staffName || GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      firm_phone: GST_FIRM.phone,
    };
  };

  // Each round either sends or drops at least one unit answered meanwhile.
  let units = params.units;
  let res: SendRpcResult = {};
  for (;;) {
    const vars = fill(units);
    const { data, error } = await supabase.rpc('builder_bu_confirm_request_send', {
      p_bu_event_id: params.buEventId,
      p_unit_ids: units.map((u) => u.unitId),
      p_to: params.to,
      p_cc: params.cc,
      p_actor_id: params.userId,
      p_link_base: window.location.origin,
      p_subject: renderTemplate(tpl.subject, vars),
      p_body: renderTemplate(tpl.body, vars),
      p_render_vars: vars,
    });
    if (error) return refuse(error.message);
    res = (data || {}) as SendRpcResult;
    if (res.sent !== false) break;
    const answered = res.already_answered || [];
    const gone = new Set(answered.map((a) => a.unit_id));
    const left = units.filter((u) => !gone.has(u.unitId));
    if (!answered.length || left.length === units.length) return refuse('A ticked unit changed meanwhile. Check the list and send again.');
    skipped.push(...answered.map((a) => ({
      unitId: a.unit_id, unitNo: a.unit_no, status: a.status,
      respondedByName: a.responded_by_name, respondedByEmail: a.responded_by_email,
    })));
    if (!left.length) return { ok: false, status: 'answered', sent: 0, skipped, reason: 'Every ticked unit was answered meanwhile.' };
    units = left;
  }

  const sent = Number(res.units) || units.length;
  const base = { sent, requestId: res.request_id, link: res.link, skipped };
  if (!res.outbox_id) return { ok: false, status: 'unknown', ...base, reason: 'The e-mail was not queued.' };

  // Send it now (the function also drains on its daily run, so a failure here
  // leaves the row pending rather than lost).
  const { data: fn, error: fnErr } = await supabase.functions.invoke('send-gst-email', { body: { id: res.outbox_id } });
  if (!fnErr && (fn as { sent?: number } | null)?.sent === 1) return { ok: true, status: 'sent', ...base };
  const { data: after } = await supabase.from('email_outbox').select('status, error').eq('id', res.outbox_id).maybeSingle();
  const status = after?.status || 'unknown';
  if (status === 'sent') return { ok: true, status, ...base };
  return { ok: false, status, ...base, reason: after?.error || fnErr?.message || undefined };
}

export interface AgreementConfirmStatus {
  unitId: string;
  /** OVERRIDDEN = the firm accepted the value without the client's confirmation.
   *  NOT_SENT = no request asked about the unit yet (no row, or a row written
   *  for a unit left unticked; it blocks filing like PENDING). */
  status: ConfirmStatus;
  disputeNotes: string | null;
  overrideReason?: string | null;
  /** Who answered on the confirmation page, and when. */
  respondedByName?: string | null;
  respondedByEmail?: string | null;
  respondedAt?: string | null;
  /** The latest request that asked about the unit (null: a per-unit e-mail sent before 21 Oct 2026). */
  requestId?: string | null;
  sentAt?: string | null;
}

/** A unit no longer holds up posting or filing. */
export const isAgreementCleared = (status: AgreementConfirmStatus['status'] | undefined): boolean =>
  isClearedStatus(status);

/**
 * Accept a unit's agreement value without the client's confirmation. The DB
 * checks who is acting (superadmin / GST Manager, or the
 * override_bu_agreement permission) and requires a reason of everyone but the
 * superadmin. A client's own confirmation is never replaced.
 */
export async function overrideAgreementValue(params: {
  buEventId: string; unitId: string; actorId: string; reason: string;
}): Promise<void> {
  const { error } = await supabase.rpc('builder_bu_agreement_override', {
    p_bu_event_id: params.buEventId,
    p_unit_id: params.unitId,
    p_actor_id: params.actorId,
    p_reason: params.reason,
  });
  if (error) throw error;
}

type ConfirmRow = {
  bu_event_id: string; unit_id: string; status: string; dispute_notes: string | null;
  override_reason: string | null; responded_by_name?: string | null; responded_by_email?: string | null;
  responded_at?: string | null; request_id?: string | null; sent_at?: string | null;
};
const CONFIRM_COLUMNS = 'bu_event_id, unit_id, status, dispute_notes, override_reason, responded_at, sent_at, '
  + 'responded_by_name, responded_by_email, request_id';
// Before 20261021140000 is applied the newer columns do not exist: read the
// older ones rather than show every unit as never sent.
const CONFIRM_COLUMNS_OLD = 'bu_event_id, unit_id, status, dispute_notes, override_reason, responded_at, sent_at';

/** Confirmation rows per BU event. A unit with no row, or a NOT_SENT row, has had no request yet. */
export async function fetchAgreementConfirmations(eventIds: string[]): Promise<Record<string, AgreementConfirmStatus[]>> {
  const out: Record<string, AgreementConfirmStatus[]> = {};
  if (!eventIds.length) return out;
  const table = () => supabase.from('builder_bu_agreement_confirmations');
  const first = await table().select(CONFIRM_COLUMNS).in('bu_event_id', eventIds);
  const res = first.error ? await table().select(CONFIRM_COLUMNS_OLD).in('bu_event_id', eventIds) : first;
  if (res.error) throw res.error;
  ((res.data || []) as unknown as ConfirmRow[]).forEach((r) => {
    (out[r.bu_event_id] ||= []).push({
      unitId: r.unit_id,
      status: r.status as AgreementConfirmStatus['status'],
      disputeNotes: r.dispute_notes,
      overrideReason: r.override_reason,
      respondedByName: r.responded_by_name ?? null,
      respondedByEmail: r.responded_by_email ?? null,
      respondedAt: r.responded_at ?? null,
      requestId: r.request_id ?? null,
      sentAt: r.sent_at ?? null,
    });
  });
  return out;
}

/** Confirmation status per unit for a BU event — 'NOT_SENT' for a unit no request has gone out for yet. */
export async function fetchAgreementConfirmationStatus(buEventId: string): Promise<AgreementConfirmStatus[]> {
  return (await fetchAgreementConfirmations([buEventId]))[buEventId] || [];
}

export interface AgreementConfirmRequest {
  id: string;
  buEventId: string;
  to: string[];
  cc: string[];
  unitIds: string[];
  sentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  /** The e-mail's outbox status (sent, pending, failed …), when known. */
  mailStatus: string | null;
  mailError: string | null;
}

/** The requests sent for these BU events, newest first. Empty before 20261021140000 is applied. */
export async function fetchConfirmRequests(eventIds: string[]): Promise<AgreementConfirmRequest[]> {
  if (!eventIds.length) return [];
  const { data, error } = await supabase
    .from('builder_bu_confirm_requests')
    .select('id, bu_event_id, to_emails, cc_emails, unit_ids, sent_at, created_at, created_by, outbox_id')
    .in('bu_event_id', eventIds)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  const outboxIds = data.map((r) => r.outbox_id).filter((x): x is string => !!x);
  const mail = new Map<string, { status: string; error: string | null }>();
  if (outboxIds.length) {
    const { data: ob } = await supabase.from('email_outbox').select('id, status, error').in('id', outboxIds);
    (ob || []).forEach((o) => mail.set(o.id, { status: o.status, error: o.error }));
  }
  return data.map((r) => ({
    id: r.id,
    buEventId: r.bu_event_id,
    to: r.to_emails || [],
    cc: r.cc_emails || [],
    unitIds: r.unit_ids || [],
    sentAt: r.sent_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
    mailStatus: r.outbox_id ? mail.get(r.outbox_id)?.status ?? null : null,
    mailError: r.outbox_id ? mail.get(r.outbox_id)?.error ?? null : null,
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
