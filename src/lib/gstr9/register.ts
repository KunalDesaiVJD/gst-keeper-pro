// Data for the applicability register (the Annual Return home): every
// client, its aggregate turnover and the client's wish for the year
// (client_annual_turnover), and how far its working has got.

import { supabase } from '@/integrations/supabase/client';
import type { PeriodStatus } from './store';

export interface RegisterClient {
  id: string;
  name: string;
  gstin: string | null;
  registration_type: string | null;
  regular_sub_type: string | null;
  registration_date: string | null;
  cancellation_date: string | null;
  registration_cancellation_date: string | null;
  inactive_at_hand: boolean | null;
}

export interface TurnoverEntry {
  aggregate_turnover: number | null;
  gstr9_opt_in: boolean;
  gstr9c_opt_in: boolean;
  applicability_note: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
}

export interface WorkingState {
  status: PeriodStatus;
  preparedBy: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  lastSavedAt: string | null;
  sheets: number;
}

export interface RegisterData {
  clients: RegisterClient[];
  turnover: Map<string, TurnoverEntry>;
  working: Map<string, WorkingState>;
}

const CLIENT_COLUMNS =
  'id, name, gstin, registration_type, regular_sub_type, registration_date, cancellation_date, registration_cancellation_date, inactive_at_hand';

/** PostgREST returns at most 1000 rows a request; read every page. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function loadRegister(financialYear: string): Promise<RegisterData> {
  const [clients, turnover, activity, periods] = await Promise.all([
    allRows<RegisterClient>((a, b) => supabase.from('clients').select(CLIENT_COLUMNS).order('name').range(a, b)),
    allRows<TurnoverEntry & { client_id: string }>((a, b) =>
      supabase
        .from('client_annual_turnover')
        .select('client_id, aggregate_turnover, gstr9_opt_in, gstr9c_opt_in, applicability_note, updated_by_name, updated_at')
        .eq('financial_year', financialYear)
        .range(a, b),
    ),
    allRows<{ client_id: string | null; last_saved_at: string | null; sheets: number | null }>((a, b) =>
      supabase.from('annual_return_activity').select('client_id, last_saved_at, sheets').eq('financial_year', financialYear).range(a, b),
    ),
    allRows<{ client_id: string; status: string; prepared_by_name: string | null; locked_by: string | null; locked_at: string | null }>((a, b) =>
      supabase
        .from('annual_return_periods')
        .select('client_id, status, prepared_by_name, locked_by, locked_at')
        .eq('financial_year', financialYear)
        .range(a, b),
    ),
  ]);

  const working = new Map<string, WorkingState>();
  activity.forEach((r) => {
    if (!r.client_id) return;
    working.set(r.client_id, { status: 'in_progress', preparedBy: null, lockedBy: null, lockedAt: null, lastSavedAt: r.last_saved_at, sheets: r.sheets ?? 0 });
  });
  periods.forEach((p) => {
    const w = working.get(p.client_id) ?? { status: 'not_started' as PeriodStatus, preparedBy: null, lockedBy: null, lockedAt: null, lastSavedAt: null, sheets: 0 };
    const status: PeriodStatus = p.status === 'locked' ? 'locked' : p.status === 'in_progress' || w.sheets > 0 ? 'in_progress' : 'not_started';
    working.set(p.client_id, { ...w, status, preparedBy: p.prepared_by_name, lockedBy: p.locked_by, lockedAt: p.locked_at });
  });

  return {
    clients,
    turnover: new Map(turnover.map(({ client_id, ...t }) => [client_id, t])),
    working,
  };
}

export type TurnoverPatch = { clientId: string } & Partial<Pick<TurnoverEntry, 'aggregate_turnover' | 'gstr9_opt_in' | 'gstr9c_opt_in' | 'applicability_note'>>;

/**
 * Save changes to several clients' rows at once. Only the fields given are
 * written (an upsert merges them), so the late-fee figures typed on the
 * client's page (exempt turnover, T1) are left alone.
 */
export async function saveTurnover(financialYear: string, patches: TurnoverPatch[], by: string): Promise<void> {
  if (!patches.length) return;
  const now = new Date().toISOString();
  // One upsert per set of fields: PostgREST needs every row of a bulk upsert to carry the same keys.
  const groups = new Map<string, TurnoverPatch[]>();
  patches.forEach((p) => {
    const k = Object.keys(p).filter((x) => x !== 'clientId').sort().join(',');
    groups.set(k, [...(groups.get(k) ?? []), p]);
  });
  for (const list of groups.values()) {
    const rows = list.map(({ clientId, ...fields }) => ({ client_id: clientId, financial_year: financialYear, ...fields, updated_at: now, updated_by_name: by }));
    const { error } = await supabase.from('client_annual_turnover').upsert(rows, { onConflict: 'client_id,financial_year' });
    if (error) throw new Error(error.message);
  }
}

/** One client's row for the year (the workspace's applicability chip). */
export async function loadTurnoverEntry(clientId: string, financialYear: string): Promise<TurnoverEntry | null> {
  const { data, error } = await supabase
    .from('client_annual_turnover')
    .select('aggregate_turnover, gstr9_opt_in, gstr9c_opt_in, applicability_note, updated_by_name, updated_at')
    .eq('client_id', clientId)
    .eq('financial_year', financialYear)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
