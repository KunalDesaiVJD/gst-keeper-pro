// One canonical notice set for every Notices screen (roadmap Phase 1 task 6).
//
// The definitions of open / overdue / due in 7 days / new / category / exposure
// / stage live in the database view public.notice_facts (migrations
// 20261006111000, 20261006116000, 20261006120000; positions doc §2). Every
// tile, list and report reads the flags from there, so a number on the
// dashboard is the row count of the list it opens. (The browser-side fallback
// for a database without the view was removed in Phase 2: the view is live.)
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import type { Database } from '@/integrations/supabase/types';

export type NoticeFact = Database['public']['Views']['notice_facts']['Row'];
export type NoticePlanRow = Database['public']['Views']['notice_plan']['Row'];
export type RefundFact = Database['public']['Views']['refund_facts']['Row'];
export type Drc03Fact = Database['public']['Views']['drc03_facts']['Row'];

export interface MatterExposure {
  matters: number;
  amount: number;
}

export type FactsSource = 'facts';

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

/** Adds n calendar days to a YYYY-MM-DD date. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Every live portal notice with its canonical flags. */
export async function loadNoticeFacts(): Promise<{ rows: NoticeFact[]; source: FactsSource }> {
  const rows = await fetchAllRows<NoticeFact>('notice_facts', '*', (q) => q.order('id'));
  return { rows, source: 'facts' };
}

/** One client's notices (Company Profile). */
export async function loadClientNoticeFacts(clientId: string): Promise<NoticeFact[]> {
  const { data, error } = await supabase.from('notice_facts').select('*').eq('client_id', clientId)
    .order('issue_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** One notice with its flags (the workspace). */
export async function loadNoticeFact(id: string): Promise<NoticePlanRow | NoticeFact | null> {
  // An open notice is in the plan (with its next action); a closed one only in the facts.
  const { data: plan, error } = await supabase.from('notice_plan').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (plan) return plan;
  const { data: fact, error: factError } = await supabase.from('notice_facts').select('*').eq('id', id).maybeSingle();
  if (factError) throw factError;
  return fact;
}

/** Refund applications plus the refund case rows no application covers (same ARN = same case). */
export async function loadRefundFacts(clientId?: string): Promise<RefundFact[]> {
  let q = supabase.from('refund_facts').select('*');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q.order('filed_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** DRC-03 filings plus the voluntary-payment case rows no filing covers. */
export async function loadDrc03Facts(clientId?: string): Promise<Drc03Fact[]> {
  let q = supabase.from('drc03_facts').select('*');
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q.order('filed_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Open litigation matters' outstanding demand (the notices' own share is on each NoticeFact). */
export async function loadMatterExposure(): Promise<Map<string, MatterExposure>> {
  const byClient = new Map<string, MatterExposure>();
  const { data, error } = await supabase.from('notice_exposure').select('client_id, amount').eq('kind', 'matter');
  if (error) throw error;
  (data ?? []).forEach((r) => {
    if (!r.client_id) return;
    const cur = byClient.get(r.client_id) ?? { matters: 0, amount: 0 };
    cur.matters += 1;
    cur.amount += Number(r.amount) || 0;
    byClient.set(r.client_id, cur);
  });
  return byClient;
}
