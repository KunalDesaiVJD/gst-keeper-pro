// One row per client for the GSTIN-wise report (audit U-72-1, U-72-3, U-72-4;
// L-12, L-13): the client's notice counts (noticeCounts, the list's own flags),
// its open matters with their outstanding demand (as the command centre counts
// them: demand less paid and pre-deposit, never below zero), and the last good
// portal pull of its notices.
import { supabase } from '@/integrations/supabase/client';
import { emptyCounts, groupCounts, type Counts, type CountRow } from './noticeCounts';

export interface ClientContext {
  clients: { id: string; name: string; gstin: string; inactive_at_hand: boolean; notices_sync_excluded: boolean }[];
  sync: { client_id: string | null; step: string | null; last_status: string | null; last_success_at: string | null; last_attempt_at: string | null }[];
  matters: {
    client_id: string; status: string; stage: string; demand_tax: number; demand_interest: number; demand_penalty: number; demand_cess: number;
    paid_total: number; pre_deposit_total: number;
  }[];
}

export async function loadClientContext(): Promise<ClientContext> {
  const [clients, sync, matters] = await Promise.all([
    supabase.from('clients').select('id, name, gstin, inactive_at_hand, notices_sync_excluded').order('name'),
    supabase.from('client_sync_status').select('client_id, step, last_status, last_success_at, last_attempt_at').in('step', ['notices', 'login']),
    supabase.from('litigation_matters').select('client_id, status, stage, demand_tax, demand_interest, demand_penalty, demand_cess, paid_total, pre_deposit_total'),
  ]);
  const error = clients.error ?? sync.error ?? matters.error;
  if (error) throw error;
  return { clients: clients.data ?? [], sync: sync.data ?? [], matters: matters.data ?? [] };
}

export interface ClientReportRow {
  clientId: string;
  name: string;
  gstin: string;
  excluded: boolean;
  inactive: boolean;
  counts: Counts;
  matters: number;
  matterOutstanding: number;
  lastPull: string | null;
  /** No good pull in the last 24 hours (or never). */
  stale: boolean;
  loginFailed: boolean;
}

const DAY_MS = 86_400_000;

export function clientRows(rows: CountRow[], ctx: ClientContext, now = Date.now()): ClientReportRow[] {
  const { groups } = groupCounts(rows, (r) => r.client_id);
  const matterBy = new Map<string, { n: number; amount: number }>();
  // Open as the Matters list counts it, so the number opens a list of the same size.
  ctx.matters.filter((m) => (m.status || '').toLowerCase() !== 'closed' && m.stage !== 'closed').forEach((m) => {
    const cur = matterBy.get(m.client_id) ?? { n: 0, amount: 0 };
    cur.n += 1;
    cur.amount += Math.max(0, Number(m.demand_tax || 0) + Number(m.demand_interest || 0) + Number(m.demand_penalty || 0)
      + Number(m.demand_cess || 0) - Number(m.paid_total || 0) - Number(m.pre_deposit_total || 0));
    matterBy.set(m.client_id, cur);
  });
  const syncBy = new Map<string, ClientContext['sync']>();
  ctx.sync.forEach((s) => { if (s.client_id) syncBy.set(s.client_id, [...(syncBy.get(s.client_id) ?? []), s]); });
  // Names from the notices themselves for a client the clients query did not return.
  const fromNotices = new Map(rows.filter((r) => r.client_id).map((r) => [r.client_id as string, r]));
  const ids = new Set<string>([...groups.keys(), ...matterBy.keys()].filter(Boolean));
  const byId = new Map(ctx.clients.map((c) => [c.id, c]));
  return [...ids].map((id) => {
    const c = byId.get(id);
    const n = fromNotices.get(id);
    const s = syncBy.get(id) ?? [];
    const notices = s.find((x) => x.step === 'notices');
    const login = s.find((x) => x.step === 'login');
    const lastPull = notices?.last_success_at ?? null;
    const m = matterBy.get(id);
    return {
      clientId: id,
      name: c?.name ?? n?.client_name ?? 'Unknown client',
      gstin: c?.gstin ?? n?.client_gstin ?? '',
      excluded: !!c?.notices_sync_excluded,
      inactive: !!c?.inactive_at_hand,
      counts: groups.get(id) ?? emptyCounts(),
      matters: m?.n ?? 0,
      matterOutstanding: m?.amount ?? 0,
      lastPull,
      stale: !lastPull || now - new Date(lastPull).getTime() > DAY_MS,
      loginFailed: login?.last_status === 'failed' && (!lastPull || Date.parse(login.last_attempt_at ?? '') > Date.parse(lastPull)),
    };
  });
}
