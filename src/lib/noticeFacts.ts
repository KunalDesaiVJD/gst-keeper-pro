// One canonical notice set for every Notices screen (roadmap Phase 1 task 6).
//
// The definitions of open / overdue / due in 7 days / new / category / exposure
// live in the database view public.notice_facts (migration
// 20261006111000_notice_facts.sql; positions doc §2). Every tile, list and
// report reads the flags from there, so a number on the dashboard is the row
// count of the list it opens.
//
// Until that migration is applied to the live project, the view does not
// exist; the loaders below then fall back to the base tables and derive the
// same flags here (without the form-code short clocks, which need the rules
// table). Remove the fallback once the migration is live everywhere.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import type { Database } from '@/integrations/supabase/types';
import { classifyNoticeCategoryLegacy } from '@/utils/noticeCategoryClassifier';

export type NoticeFact = Database['public']['Views']['notice_facts']['Row'];
export type RefundFact = Database['public']['Views']['refund_facts']['Row'];
export type Drc03Fact = Database['public']['Views']['drc03_facts']['Row'];

export interface MatterExposure {
  matters: number;
  amount: number;
}

export type FactsSource = 'facts' | 'legacy';

const CLOSED_RE = /^(closed|withdrawn|dropped|disposed|deleted|adjudged)/i;
const DAY_MS = 86_400_000;

export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** Whole days from a to b, both YYYY-MM-DD calendar dates (no time-of-day drift). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = b.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

function isMissingRelation(error: { code?: string; message?: string } | null, name: string): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST200'
    || new RegExp(`(relation|table)\\b.*${name}`, 'i').test(error.message ?? '');
}

// ── Legacy derivation (fallback only) ──────────────────────────────────────
type LegacyNotice = Database['public']['Tables']['gst_notices']['Row'] & {
  clients?: { name: string | null; gstin: string | null; inactive_at_hand: boolean | null } | null;
};

function deriveLegacyFacts(rows: LegacyNotice[]): NoticeFact[] {
  const today = istToday();
  const now = Date.now();
  const facts = rows.map((g): NoticeFact => {
    const isOpen = !CLOSED_RE.test((g.staff_status || '').trim());
    const isReplied = !!g.reply_date;
    const due = g.extended_due_date || g.due_date || null;
    const daysToDue = due ? daysBetween(today, due) : null;
    const disputeKey = g.case_id || g.reference_number || g.id;
    return {
      id: g.id, client_id: g.client_id,
      client_name: g.clients?.name ?? null, client_gstin: g.clients?.gstin ?? null,
      client_inactive: g.clients?.inactive_at_hand ?? null,
      source: g.source, portal_key: g.portal_key, reference_number: g.reference_number, case_id: g.case_id,
      notice_type: g.notice_type, description: g.description, portal_status: g.status,
      issue_date: g.issue_date, due_date: g.due_date, extended_due_date: g.extended_due_date,
      hearing_date: g.hearing_date, reply_date: g.reply_date, reply_ref_number: g.reply_ref_number,
      order_date: g.order_date, order_number: g.order_number,
      submission_arn: g.submission_arn, submission_date: g.submission_date,
      staff_status: g.staff_status, close_reason: g.close_reason,
      priority: g.priority, default_priority: null, effective_priority: g.priority,
      assign_to: g.assign_to, assign_to_user_id: g.assign_to_user_id,
      amount_of_demand: g.amount_of_demand, financial_year: g.financial_year, issued_by: g.issued_by,
      remarks: g.remarks, pdf_url: g.pdf_url, matter_id: g.matter_id,
      first_seen_at: g.first_seen_at, last_seen_at: g.last_seen_at, pulled_at: g.pulled_at,
      created_at: g.created_at, updated_at: g.updated_at,
      form_code: null, form_label: null,
      category: classifyNoticeCategoryLegacy(g),
      is_refund_case: g.notice_type === 'Refunds',
      is_drc03_case: g.notice_type === 'Voluntary Payment',
      is_open: isOpen, is_replied: isReplied,
      effective_due: due,
      due_basis: g.extended_due_date ? 'extended' : g.due_date ? 'portal' : null,
      due_basis_note: null,
      days_to_due: daysToDue,
      is_overdue: isOpen && !isReplied && daysToDue !== null && daysToDue < 0,
      is_due_in_7: isOpen && !isReplied && daysToDue !== null && daysToDue >= 0 && daysToDue <= 7,
      is_new: !!g.first_seen_at && now - new Date(g.first_seen_at).getTime() < DAY_MS,
      is_unassigned: isOpen && !g.assign_to_user_id,
      dispute_key: disputeKey,
      exposure_amount: 0,
      today_ist: today,
    };
  });
  // Exposure once per dispute, at the latest open, unlinked notice with a demand.
  const leads = new Map<string, NoticeFact>();
  facts.forEach((f) => {
    if (!f.is_open || f.matter_id || !(Number(f.amount_of_demand) > 0)) return;
    const key = `${f.client_id}|${f.dispute_key}`;
    const cur = leads.get(key);
    if (!cur || (f.issue_date || '') > (cur.issue_date || '') || ((f.issue_date || '') === (cur.issue_date || '') && (f.id || '') < (cur.id || ''))) {
      leads.set(key, f);
    }
  });
  leads.forEach((f) => { f.exposure_amount = Number(f.amount_of_demand) || 0; });
  return facts;
}

async function loadLegacyNotices(): Promise<NoticeFact[]> {
  const rows = await fetchAllRows<LegacyNotice>(
    'gst_notices',
    '*, clients(name, gstin, inactive_at_hand)',
    (q) => q.eq('source', 'notices').is('deleted_at', null).order('id'),
  );
  return deriveLegacyFacts(rows);
}

/** Every live portal notice with its canonical flags. */
export async function loadNoticeFacts(): Promise<{ rows: NoticeFact[]; source: FactsSource }> {
  try {
    const rows = await fetchAllRows<NoticeFact>('notice_facts', '*', (q) => q.order('id'));
    return { rows, source: 'facts' };
  } catch (e) {
    if (!isMissingRelation(e as { code?: string; message?: string }, 'notice_facts')) throw e;
    return { rows: await loadLegacyNotices(), source: 'legacy' };
  }
}

/** One client's notices (Company Profile). */
export async function loadClientNoticeFacts(clientId: string): Promise<NoticeFact[]> {
  const { data, error } = await supabase.from('notice_facts').select('*').eq('client_id', clientId)
    .order('issue_date', { ascending: false });
  if (!error) return data ?? [];
  if (!isMissingRelation(error, 'notice_facts')) throw error;
  const { data: legacy, error: legacyError } = await supabase.from('gst_notices')
    .select('*, clients(name, gstin, inactive_at_hand)')
    .eq('client_id', clientId).eq('source', 'notices').is('deleted_at', null)
    .order('issue_date', { ascending: false });
  if (legacyError) throw legacyError;
  return deriveLegacyFacts((legacy ?? []) as LegacyNotice[]);
}

const REFUND_CLOSED_RE = /disburs|withdraw|reject|recredit/i;
const DRC03_CLOSED_RE = /acknowledg/i;

/** Refund applications plus the refund case rows no application covers (same ARN = same case). */
export async function loadRefundFacts(clientId?: string): Promise<RefundFact[]> {
  let q = supabase.from('refund_facts').select('*');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q.order('filed_date', { ascending: false });
  if (!error) return data ?? [];
  if (!isMissingRelation(error, 'refund_facts')) throw error;

  let aq = supabase.from('gst_refund_applications')
    .select('id, client_id, arn, refund_type, filed_date, status, claimed_amount, sanctioned_amount, documents, clients(name, gstin)')
    .is('deleted_at', null);
  let cq = supabase.from('gst_notices')
    .select('id, client_id, case_id, notice_type, issue_date, staff_status, clients(name, gstin)')
    .eq('source', 'notices').eq('notice_type', 'Refunds').is('deleted_at', null);
  if (clientId) { aq = aq.eq('client_id', clientId); cq = cq.eq('client_id', clientId); }
  const [{ data: apps }, { data: cases }] = await Promise.all([aq, cq]);
  const out: RefundFact[] = [];
  const covered = new Set<string>();
  (apps ?? []).forEach((a) => {
    if (a.arn) covered.add(`${a.client_id}|${a.arn}`);
    out.push({
      origin: 'application', id: a.id, client_id: a.client_id, client_name: a.clients?.name ?? null,
      client_gstin: a.clients?.gstin ?? null, arn: a.arn, refund_type: a.refund_type, filed_date: a.filed_date,
      status: a.status, claimed_amount: a.claimed_amount, sanctioned_amount: a.sanctioned_amount,
      documents: a.documents, notice_id: null, is_closed: REFUND_CLOSED_RE.test(a.status || ''),
    });
  });
  (cases ?? []).forEach((c) => {
    if (!c.case_id) return;
    const key = `${c.client_id}|${c.case_id}`;
    if (covered.has(key)) return;
    covered.add(key);
    out.push({
      origin: 'case', id: c.id, client_id: c.client_id, client_name: c.clients?.name ?? null,
      client_gstin: c.clients?.gstin ?? null, arn: c.case_id, refund_type: c.notice_type, filed_date: c.issue_date,
      status: c.staff_status, claimed_amount: null, sanctioned_amount: null, documents: null, notice_id: c.id,
      is_closed: CLOSED_RE.test((c.staff_status || '').trim()),
    });
  });
  return out;
}

/** DRC-03 filings plus the voluntary-payment case rows no filing covers. */
export async function loadDrc03Facts(clientId?: string): Promise<Drc03Fact[]> {
  let q = supabase.from('drc03_facts').select('*');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q.order('filed_date', { ascending: false });
  if (!error) return data ?? [];
  if (!isMissingRelation(error, 'drc03_facts')) throw error;

  let fq = supabase.from('gst_drc03_filings')
    .select('id, client_id, arn, cause_of_payment, filed_date, status, pdf_url, clients(name, gstin)')
    .is('deleted_at', null);
  let cq = supabase.from('gst_notices')
    .select('id, client_id, case_id, description, issue_date, staff_status, pdf_url, clients(name, gstin)')
    .eq('source', 'notices').eq('notice_type', 'Voluntary Payment').is('deleted_at', null);
  if (clientId) { fq = fq.eq('client_id', clientId); cq = cq.eq('client_id', clientId); }
  const [{ data: filings }, { data: cases }] = await Promise.all([fq, cq]);
  const out: Drc03Fact[] = [];
  const covered = new Set<string>();
  (filings ?? []).forEach((d) => {
    if (d.arn) covered.add(`${d.client_id}|${d.arn}`);
    out.push({
      origin: 'filing', id: d.id, client_id: d.client_id, client_name: d.clients?.name ?? null,
      client_gstin: d.clients?.gstin ?? null, arn: d.arn, cause_of_payment: d.cause_of_payment,
      filed_date: d.filed_date, status: d.status, pdf_url: d.pdf_url, notice_id: null,
      is_closed: DRC03_CLOSED_RE.test(d.status || ''),
    });
  });
  (cases ?? []).forEach((c) => {
    if (!c.case_id) return;
    const key = `${c.client_id}|${c.case_id}`;
    if (covered.has(key)) return;
    covered.add(key);
    out.push({
      origin: 'case', id: c.id, client_id: c.client_id, client_name: c.clients?.name ?? null,
      client_gstin: c.clients?.gstin ?? null, arn: c.case_id, cause_of_payment: c.description,
      filed_date: c.issue_date, status: c.staff_status, pdf_url: c.pdf_url, notice_id: c.id,
      is_closed: CLOSED_RE.test((c.staff_status || '').trim()),
    });
  });
  return out;
}

/** Open litigation matters' outstanding demand (the notices' own share is on each NoticeFact). */
export async function loadMatterExposure(): Promise<Map<string, MatterExposure>> {
  const byClient = new Map<string, MatterExposure>();
  const { data, error } = await supabase.from('notice_exposure').select('client_id, amount').eq('kind', 'matter');
  if (error) return byClient; // view not there yet: notices-only exposure
  (data ?? []).forEach((r) => {
    if (!r.client_id) return;
    const cur = byClient.get(r.client_id) ?? { matters: 0, amount: 0 };
    cur.matters += 1;
    cur.amount += Number(r.amount) || 0;
    byClient.set(r.client_id, cur);
  });
  return byClient;
}
