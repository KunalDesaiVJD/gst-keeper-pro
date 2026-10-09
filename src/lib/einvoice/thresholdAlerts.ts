// E-invoice threshold tracking: loads every client's per-FY turnover, assesses
// it with assessEinvoice (threshold.ts), and raises a one-off alert — plus an
// email to the client — when a client approaches or crosses the ₹5 crore limit.
//
// One round of queries for all clients (no per-client requests). Alerts are
// idempotent: einvoice_threshold_alerts is UNIQUE (client_id, financial_year,
// level), so a second staff member opening the page at the same time cannot
// send a second email — whoever loses the insert race skips the email.

import { supabase } from '@/integrations/supabase/client';
import { GST_FIRM, renderTemplate } from '@/lib/gstReminders';
import { assessEinvoice, type EinvoiceAssessment, type FyTurnover } from '@/lib/einvoice/threshold';

export interface EinvoiceClient {
  id: string;
  name: string;
  email: string | null;
  einvoice_applicable: boolean;
  einvoice_exemption: string | null;
  registration_type: string;
}

/**
 * Registration types that never issue e-invoices: a composition taxpayer
 * cannot issue a tax invoice, and a tax deductor / ISD has no outward supplies
 * of its own. They are left out of the assessment entirely.
 */
const NOT_ASSESSED = new Set(['Composition', 'Tax Deductor', 'ISD']);

export type EinvoiceAlertLevel = 'approaching' | 'crossed';

/**
 * What, if anything, needs attention for a client:
 *  - 'should_tick'  — e-invoicing is mandatory but the client is not ticked;
 *  - 'next_fy'      — this FY has crossed ₹5 crore, applies from next 1 April;
 *  - 'approaching'  — some year is at or above ₹4 crore.
 * Ticked and exempt clients need no attention.
 */
export type EinvoiceAttention = 'should_tick' | 'next_fy' | 'approaching';

export function einvoiceAttention(a: EinvoiceAssessment | undefined, ticked: boolean): EinvoiceAttention | null {
  if (!a || ticked || a.status === 'exempt') return null;
  if (a.status === 'mandatory') return 'should_tick';
  if (a.status === 'next_fy') return 'next_fy';
  if (a.status === 'approaching') return 'approaching';
  return null;
}

export const alertLevelFor = (att: EinvoiceAttention | null): EinvoiceAlertLevel | null =>
  att === 'approaching' ? 'approaching' : att ? 'crossed' : null;

const PAGE = 1000;

/** Reads every row of a query, a page at a time (PostgREST caps a response at 1000 rows). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

export interface EinvoiceData {
  assessments: Map<string, EinvoiceAssessment>;
  clientsById: Map<string, EinvoiceClient>;
}

/**
 * Loads the clients (all, or `clientIds`) and their per-FY turnover and
 * assesses each one. Entered aggregate turnover (client_annual_turnover)
 * takes precedence over this GSTIN's GSTR-1 sums (client_fy_gstr1_turnover)
 * for the same FY — assessEinvoice does the picking.
 */
export async function loadEinvoiceData(clientIds?: string[]): Promise<EinvoiceData> {
  const ids = clientIds?.filter(Boolean);
  if (ids && ids.length === 0) return { assessments: new Map(), clientsById: new Map() };

  const [clients, entered, gstr1] = await Promise.all([
    readAll<EinvoiceClient>((a, b) => {
      let q = supabase
        .from('clients')
        .select('id, name, email, einvoice_applicable, einvoice_exemption, registration_type')
        .order('id')
        .range(a, b);
      if (ids) q = q.in('id', ids);
      return q as unknown as PromiseLike<{ data: EinvoiceClient[] | null; error: { message: string } | null }>;
    }),
    readAll<{ client_id: string; financial_year: string; aggregate_turnover: number | null }>((a, b) => {
      let q = supabase
        .from('client_annual_turnover')
        .select('client_id, financial_year, aggregate_turnover')
        .not('aggregate_turnover', 'is', null)
        .order('id')
        .range(a, b);
      if (ids) q = q.in('client_id', ids);
      return q as unknown as PromiseLike<{ data: { client_id: string; financial_year: string; aggregate_turnover: number | null }[] | null; error: { message: string } | null }>;
    }),
    readAll<{ client_id: string; financial_year: string; turnover: number | null }>((a, b) => {
      // A view not in the generated types.
      let q = supabase
        .from('client_fy_gstr1_turnover' as never)
        .select('client_id, financial_year, turnover')
        .order('client_id')
        .order('financial_year')
        .range(a, b);
      if (ids) q = q.in('client_id' as never, ids as never);
      return q as unknown as PromiseLike<{ data: { client_id: string; financial_year: string; turnover: number | null }[] | null; error: { message: string } | null }>;
    }),
  ]);

  const years = new Map<string, FyTurnover[]>();
  const push = (clientId: string, y: FyTurnover) => {
    const arr = years.get(clientId);
    if (arr) arr.push(y); else years.set(clientId, [y]);
  };
  entered.forEach((r) => push(r.client_id, { financial_year: r.financial_year, turnover: Number(r.aggregate_turnover) || 0, source: 'entered' }));
  gstr1.forEach((r) => push(r.client_id, { financial_year: r.financial_year, turnover: Number(r.turnover) || 0, source: 'gstr1' }));

  const assessments = new Map<string, EinvoiceAssessment>();
  const clientsById = new Map<string, EinvoiceClient>();
  const today = new Date();
  clients.forEach((c) => {
    clientsById.set(c.id, c);
    if (NOT_ASSESSED.has(c.registration_type)) return;
    assessments.set(c.id, assessEinvoice({
      ticked: !!c.einvoice_applicable,
      exemption: c.einvoice_exemption,
      years: years.get(c.id) || [],
      today,
    }));
  });
  return { assessments, clientsById };
}

/** Assessments only, keyed by client id. */
export async function loadEinvoiceAssessments(clientIds?: string[]): Promise<Map<string, EinvoiceAssessment>> {
  return (await loadEinvoiceData(clientIds)).assessments;
}

export interface EinvoiceAlertSyncResult {
  /** Clients that needed an alert (approaching / crossed, not ticked, not exempt). */
  candidates: number;
  /** New alert rows recorded this run. */
  created: number;
  /** Emails queued this run. */
  emailed: number;
  /** New alerts for clients with no email on file. */
  noEmail: number;
  failed: number;
}

const ACTION_LINE: Record<EinvoiceAttention, string> = {
  approaching: 'We will set up e-invoicing for you before it becomes applicable — please make sure your billing software can generate IRNs.',
  next_fy: 'E-invoicing will apply to you from 1 April of the next financial year; from then every B2B invoice, credit/debit note and export invoice must carry an IRN. We will set it up for you before then.',
  should_tick: 'E-invoicing applies to you; every B2B invoice, credit/debit note and export invoice must carry an IRN.',
};

const fmtRupees = (n: number) => Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/**
 * Records one alert per (client, deciding FY, level) for clients that are
 * approaching or have crossed the limit and are not ticked as e-invoice
 * clients, and emails the client (when an email is on file) through
 * email_outbox. Already-alerted (client, FY, level) pairs are skipped, so this
 * is safe to run on every page load.
 */
export async function syncEinvoiceThresholdAlerts(
  assessments: Map<string, EinvoiceAssessment>,
  clientsById: Map<string, EinvoiceClient>,
  actor?: { id?: string | null; name?: string | null } | null,
): Promise<EinvoiceAlertSyncResult> {
  const res: EinvoiceAlertSyncResult = { candidates: 0, created: 0, emailed: 0, noEmail: 0, failed: 0 };

  const due: { client: EinvoiceClient; att: EinvoiceAttention; level: EinvoiceAlertLevel; fy: string; turnover: number }[] = [];
  assessments.forEach((a, clientId) => {
    const client = clientsById.get(clientId);
    if (!client || client.einvoice_exemption) return;
    const att = einvoiceAttention(a, !!client.einvoice_applicable);
    const level = alertLevelFor(att);
    if (!att || !level || !a.decidingYear) return;
    due.push({ client, att, level, fy: a.decidingYear.financial_year, turnover: a.decidingYear.turnover });
  });
  res.candidates = due.length;
  if (!due.length) return res;

  // One read of the existing alerts for these clients.
  const existing = await readAll<{ client_id: string; financial_year: string; level: string }>((a, b) =>
    supabase
      .from('einvoice_threshold_alerts')
      .select('client_id, financial_year, level')
      .in('client_id', [...new Set(due.map((d) => d.client.id))])
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: { client_id: string; financial_year: string; level: string }[] | null; error: { message: string } | null }>,
  );
  const seen = new Set(existing.map((e) => `${e.client_id}|${e.financial_year}|${e.level}`));
  const fresh = due.filter((d) => !seen.has(`${d.client.id}|${d.fy}|${d.level}`));
  if (!fresh.length) return res;

  const { data: tpl } = await supabase
    .from('email_templates')
    .select('subject, body, is_active')
    .eq('key', 'einvoice_threshold_alert')
    .maybeSingle();
  const canEmail = !!tpl && tpl.is_active !== false;

  for (const d of fresh) {
    // Claim the alert first: the unique constraint decides who sends the email.
    const { data: alert, error } = await supabase
      .from('einvoice_threshold_alerts')
      .insert({ client_id: d.client.id, financial_year: d.fy, level: d.level, turnover: d.turnover })
      .select('id')
      .single();
    if (error || !alert) {
      if (error && error.code !== '23505') res.failed += 1; // 23505 = someone else just raised it
      continue;
    }
    res.created += 1;

    if (!d.client.email) { res.noEmail += 1; continue; }
    if (!canEmail) continue;

    const vars: Record<string, string> = {
      contact_person: d.client.name,
      client_name: d.client.name,
      financial_year: d.fy,
      turnover: fmtRupees(d.turnover),
      status_phrase: d.level === 'approaching' ? 'approaching' : 'above',
      action_line: ACTION_LINE[d.att],
      staff_name: actor?.name || GST_FIRM.team,
      firm_name: GST_FIRM.name,
      firm_email: GST_FIRM.email,
      firm_phone: GST_FIRM.phone,
    };
    const { data: out, error: outErr } = await supabase
      .from('email_outbox')
      .insert({
        client_id: d.client.id,
        to_email: d.client.email,
        kind: 'einvoice_threshold' as never,
        template_key: 'einvoice_threshold_alert',
        return_type: null,
        period_month: null,
        subject: renderTemplate(tpl.subject, vars),
        body: renderTemplate(tpl.body, vars),
        render_vars: vars,
        status: 'pending',
      })
      .select('id')
      .single();
    if (outErr || !out) { res.failed += 1; continue; }
    res.emailed += 1;
    await supabase.from('einvoice_threshold_alerts').update({ email_outbox_id: out.id }).eq('id', alert.id);
  }

  // Flush once so the emails go out now; the daily cron is the backstop.
  if (res.emailed) void supabase.functions.invoke('send-gst-email', { body: {} }).catch(() => {});
  return res;
}
