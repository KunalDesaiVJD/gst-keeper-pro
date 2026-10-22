import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import { formatINR } from '@/utils/builderRates';
import {
  codeRef, isClearedStatus, mailOutcome, parseEmailList, splitAnswered, type ConfirmStatus, type LegacyMail,
} from '@/lib/builderConfirmRules';

// Client confirmation of the agreement value behind a BU differential, by a
// tokenized e-mail link (no login). Since 21 Oct 2026 one e-mail goes per
// send: To and CC typed by staff, every outstanding unit listed, one link.
// Anyone it was sent to (To or CC, never the firm's own addresses) may answer
// on the page, which asks their name and e-mail, checks the e-mail against the
// request, e-mails a code to it (Edge Function bu-confirm-code) and records
// both on each unit they answer
// (supabase/migrations/20261021140000_bu_confirm_cc.sql). The per-unit rows in
// builder_bu_agreement_confirmations stay the record the posting gate reads.
// Per-unit links e-mailed before that keep working until a newer request
// about their unit is out.

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

/** A ticked unit someone answered (or a colleague asked about in another
 *  request) while the pop-up was open. */
export interface AnsweredMeanwhile {
  unitId: string;
  unitNo: string;
  status: string;
  respondedByName: string | null;
  respondedByEmail: string | null;
  respondedAt?: string | null;
  disputeNotes?: string | null;
  /** The request the unit is on now, its To and CC. */
  requestId?: string | null;
  requestTo?: string[] | null;
  requestCc?: string[] | null;
}

export interface SendConfirmResult {
  ok: boolean;
  /** The e-mail's outbox status after the send: sent, pending (goes with the
   *  next run), failed, sending/unknown (may have gone); 'answered' when every
   *  ticked unit was confirmed or accepted meanwhile; 'changed' when a ticked
   *  unit was disputed (or otherwise answered) meanwhile: nothing was sent,
   *  staff must see it first; 'error' when refused. */
  status: string;
  sent: number;
  requestId?: string;
  link?: string;
  reason?: string;
  /** Units confirmed or accepted meanwhile, left out of the e-mail. */
  skipped: AnsweredMeanwhile[];
  /** Units disputed (or otherwise answered) meanwhile: nothing was sent. */
  changed: AnsweredMeanwhile[];
  /** An earlier link to these units had reached the client when this was sent. */
  earlierLink?: boolean;
  /** Which units it had reached (null: a database before 20261021160000, which says only earlierLink). */
  earlierUnits?: string[] | null;
  /** Earlier e-mails still waiting in the outbox that this one replaced. */
  cancelledEarlier?: number;
}

/** The status, answer time and request of each ticked unit as the pop-up showed it. */
export type SeenStatuses = Record<string, { status: ConfirmStatus; responded_at: string | null; request_id?: string | null }>;

type AnsweredRow = {
  unit_id: string; unit_no: string; status: string; responded_by_name: string | null;
  responded_by_email: string | null; responded_at?: string | null; dispute_notes?: string | null;
  request_id?: string | null; request_to?: string[] | null; request_cc?: string[] | null;
};
type SendRpcResult = {
  sent?: boolean;
  request_id?: string;
  outbox_id?: string;
  link?: string;
  units?: number;
  earlier_link?: boolean;
  earlier_units?: string[] | null;
  cancelled_earlier?: number;
  already_answered?: AnsweredRow[];
};
const toAnswered = (a: AnsweredRow): AnsweredMeanwhile => ({
  unitId: a.unit_id, unitNo: a.unit_no, status: a.status,
  respondedByName: a.responded_by_name, respondedByEmail: a.responded_by_email,
  respondedAt: a.responded_at ?? null, disputeNotes: a.dispute_notes ?? null,
  requestId: a.request_id ?? null, requestTo: a.request_to ?? null, requestCc: a.request_cc ?? null,
});

/**
 * Ask about some units of one BU event in ONE e-mail to everyone in To and
 * CC. The database writes the request, points each unit at it (status
 * PENDING; an earlier dispute moved to the history; the earlier link for the
 * unit shows it replaced once this e-mail is out), gives the event's other
 * taxable units a NOT_SENT row (so they still block filing) and queues the
 * e-mail, all or nothing. `seen` is what the pop-up showed: a unit answered
 * since is reported back instead. Units confirmed or accepted meanwhile are
 * left out, the e-mail is filled in again for the rest and sent; a unit
 * disputed meanwhile stops the send (status 'changed'), so staff see the
 * dispute before anything clears it. Then the e-mail is sent at once.
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
  seen: SeenStatuses;
}): Promise<SendConfirmResult> {
  const skipped: AnsweredMeanwhile[] = [];
  const refuse = (reason: string): SendConfirmResult => ({ ok: false, status: 'error', sent: 0, reason, skipped, changed: [] });
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
      p_seen: Object.fromEntries(units.map((u) => [u.unitId, params.seen[u.unitId] ?? null]).filter(([, v]) => v)),
    });
    if (error) return refuse(error.message);
    res = (data || {}) as SendRpcResult;
    if (res.sent !== false) break;
    const answered = (res.already_answered || []).map(toAnswered);
    const { cleared, changed } = splitAnswered(answered);
    if (changed.length) {
      // A dispute (or any answer but a confirmation) given since the pop-up
      // read the units, or a colleague's request about one sent meanwhile:
      // send nothing, show it.
      return { ok: false, status: 'changed', sent: 0, skipped: [...skipped, ...cleared], changed,
               reason: 'A ticked unit was answered meanwhile.' };
    }
    const gone = new Set(cleared.map((a) => a.unitId));
    const left = units.filter((u) => !gone.has(u.unitId));
    if (!cleared.length || left.length === units.length) return refuse('A ticked unit changed meanwhile. Check the list and send again.');
    skipped.push(...cleared);
    if (!left.length) return { ok: false, status: 'answered', sent: 0, skipped, changed: [], reason: 'Every ticked unit was answered meanwhile.' };
    units = left;
  }

  const sent = Number(res.units) || units.length;
  const base = {
    sent, requestId: res.request_id, link: res.link, skipped, changed: [] as AnsweredMeanwhile[],
    earlierLink: res.earlier_link === true, cancelledEarlier: Number(res.cancelled_earlier) || 0,
    earlierUnits: Array.isArray(res.earlier_units) ? res.earlier_units : null,
  };
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
  /** A per-unit e-mail of before 21 Oct 2026 asked about it (legacy_emails, recorded once) and went
   *  out, as the database counts it (its outbox row sent, or gone): its link may still answer. */
  legacyLink?: boolean;
  /** That per-unit e-mail and whether it went out (null: none on record). */
  legacy?: LegacyMail | null;
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
  legacy_emails?: string[] | null; legacy_outbox_id?: string | null;
};
const CONFIRM_COLUMNS = 'bu_event_id, unit_id, status, dispute_notes, override_reason, responded_at, sent_at, '
  + 'responded_by_name, responded_by_email, request_id, legacy_emails, legacy_outbox_id';
// Before 20261021140000 is applied the newer columns do not exist: read the
// older ones rather than show every unit as never sent.
const CONFIRM_COLUMNS_OLD = 'bu_event_id, unit_id, status, dispute_notes, override_reason, responded_at, sent_at';
/** A row a per-unit e-mail of before 21 Oct 2026 made (its addresses recorded once, legacy_emails). */
const hasLegacy = (r: ConfirmRow): boolean => Array.isArray(r.legacy_emails) && r.legacy_emails.length > 0;

/** Confirmation rows per BU event. A unit with no row, or a NOT_SENT row, has had no request yet. */
export async function fetchAgreementConfirmations(eventIds: string[]): Promise<Record<string, AgreementConfirmStatus[]>> {
  const out: Record<string, AgreementConfirmStatus[]> = {};
  if (!eventIds.length) return out;
  const table = () => supabase.from('builder_bu_agreement_confirmations');
  const first = await table().select(CONFIRM_COLUMNS).in('bu_event_id', eventIds);
  const res = first.error ? await table().select(CONFIRM_COLUMNS_OLD).in('bu_event_id', eventIds) : first;
  if (res.error) throw res.error;
  const rows = (res.data || []) as unknown as ConfirmRow[];
  // What became of each per-unit e-mail of before 21 Oct 2026 (finding of 21
  // Oct 2026: such a unit was shown "Asked" and its link said to take answers
  // when that e-mail had failed). A missing outbox row counts as out, as the
  // database's earlier_link counts it.
  const legacyIds = rows.filter((r) => hasLegacy(r) && r.legacy_outbox_id).map((r) => r.legacy_outbox_id as string);
  const legacyMail = new Map<string, { status: string; error: string | null; sentAt: string | null }>();
  if (legacyIds.length) {
    const { data: ob } = await supabase.from('email_outbox').select('id, status, error, sent_at').in('id', legacyIds);
    (ob || []).forEach((o) => legacyMail.set(o.id, { status: o.status, error: o.error, sentAt: o.sent_at }));
  }
  rows.forEach((r) => {
    const m = r.legacy_outbox_id ? legacyMail.get(r.legacy_outbox_id) : undefined;
    const legacy: LegacyMail | null = hasLegacy(r)
      ? { mail: mailOutcome(m?.status ?? null), error: m?.error ?? null, at: m?.sentAt || r.sent_at || null }
      : null;
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
      legacyLink: !!legacy && legacy.mail === 'out',
      legacy,
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
  /** When the e-mail went (email_outbox.sent_at). */
  mailSentAt: string | null;
  /** When it was sent, an earlier link to some of its units had reached the client. */
  earlierLink: boolean;
  /** Which of its units that link reached (null: sent before 20261021160000). */
  earlierUnits: string[] | null;
}

type RequestRow = {
  id: string; bu_event_id: string; to_emails: string[] | null; cc_emails: string[] | null; unit_ids: string[] | null;
  sent_at: string | null; created_at: string; created_by: string | null; outbox_id: string | null;
  earlier_link: boolean | null; earlier_units?: string[] | null;
};
const REQUEST_COLUMNS = 'id, bu_event_id, to_emails, cc_emails, unit_ids, sent_at, created_at, created_by, outbox_id, earlier_link, seq';

/** The requests sent for these BU events, newest first. Empty before 20261021140000 is applied. */
export async function fetchConfirmRequests(eventIds: string[]): Promise<AgreementConfirmRequest[]> {
  if (!eventIds.length) return [];
  const query = (cols: string) => supabase
    .from('builder_bu_confirm_requests')
    .select(cols)
    .in('bu_event_id', eventIds)
    .order('seq', { ascending: false });
  // earlier_units comes with 20261021160000: before it, read the rest.
  const first = await query(`${REQUEST_COLUMNS}, earlier_units`);
  const { data: raw, error } = first.error ? await query(REQUEST_COLUMNS) : first;
  const data = raw as unknown as RequestRow[] | null;
  if (error || !data) return [];
  const outboxIds = data.map((r) => r.outbox_id).filter((x): x is string => !!x);
  const mail = new Map<string, { status: string; error: string | null; sentAt: string | null }>();
  if (outboxIds.length) {
    const { data: ob } = await supabase.from('email_outbox').select('id, status, error, sent_at').in('id', outboxIds);
    (ob || []).forEach((o) => mail.set(o.id, { status: o.status, error: o.error, sentAt: o.sent_at }));
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
    mailSentAt: r.outbox_id ? mail.get(r.outbox_id)?.sentAt ?? null : null,
    earlierLink: r.earlier_link === true,
    earlierUnits: Array.isArray(r.earlier_units) ? r.earlier_units : null,
  }));
}

/** A dispute a later request asked about again (builder_bu_confirm_answer_history). */
export interface ClearedDispute {
  buEventId: string;
  unitId: string;
  notes: string | null;
  respondedByName: string | null;
  respondedByEmail: string | null;
  respondedAt: string | null;
  agreementValue: number | null;
  clearedAt: string;
}

/** The disputes later requests asked about again, newest first. Empty before 20261021140000 is applied. */
export async function fetchClearedDisputes(eventIds: string[]): Promise<ClearedDispute[]> {
  if (!eventIds.length) return [];
  const { data, error } = await supabase
    .from('builder_bu_confirm_answer_history')
    .select('bu_event_id, unit_id, dispute_notes, responded_by_name, responded_by_email, responded_at, agreement_value, cleared_at')
    .in('bu_event_id', eventIds)
    .order('cleared_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    buEventId: r.bu_event_id,
    unitId: r.unit_id,
    notes: r.dispute_notes,
    respondedByName: r.responded_by_name,
    respondedByEmail: r.responded_by_email,
    respondedAt: r.responded_at,
    agreementValue: r.agreement_value === null ? null : Number(r.agreement_value),
    clearedAt: r.cleared_at,
  }));
}

/** Which of these typed addresses count as the firm's own (its domain, or a
 *  staff member's profile e-mail, which the browser cannot tell). [] when the
 *  check cannot be made: the send refuses them anyway, naming them. */
export async function fetchFirmAddresses(actorId: string | null, addresses: string[]): Promise<string[]> {
  if (!actorId || !addresses.length) return [];
  const { data, error } = await supabase.rpc('builder_bu_confirm_firm_addresses', {
    p_actor_id: actorId, p_addresses: addresses,
  });
  if (error || !Array.isArray(data)) return [];
  return data as string[];
}

// ── The public page ─────────────────────────────────────────────────────────

/** Ask for a code to the reader's address and have it e-mailed. Throws the
 *  database's refusal (not on the e-mail, the firm's own, too many codes,
 *  nothing left to answer). codeId goes back with the typed code: only this
 *  page has it; ref is the mark on its e-mail (codeRef). status 'unknown':
 *  the mailer did not report back (not deployed, failed to start), so the
 *  code may not have gone. */
export async function askConfirmCode(token: string, email: string):
  Promise<{ status: 'sent' | 'failed' | 'unknown'; codeId: string; ref: string }> {
  const { data, error } = await supabase.rpc('builder_bu_confirm_code_request', { _token: token, _email: email });
  if (error) throw error;
  const codeId = (data as { code_id?: string } | null)?.code_id;
  if (!codeId) throw new Error('The code could not be asked for. Please try again.');
  const ref = codeRef(codeId);
  const { data: fn, error: fnErr } = await supabase.functions.invoke('bu-confirm-code', { body: { code_id: codeId } });
  if (fnErr) return { status: 'unknown', codeId, ref };
  const status = (fn as { status?: string } | null)?.status;
  return { status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'unknown', codeId, ref };
}

/** Check the code (with the id askConfirmCode gave): a proof to send with each answer, or why not. */
export async function verifyConfirmCode(token: string, email: string, code: string, codeId: string):
  Promise<{ proof: string | null; message: string }> {
  const { data, error } = await supabase.rpc('builder_bu_confirm_code_verify', {
    _token: token, _email: email, _code: code, _code_id: codeId,
  });
  if (error) return { proof: null, message: error.message };
  const r = (data || {}) as { ok?: boolean; proof?: string; message?: string };
  return r.ok && r.proof ? { proof: r.proof, message: '' } : { proof: null, message: r.message || 'The code could not be checked.' };
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
