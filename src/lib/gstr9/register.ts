// Data for the applicability register (the Annual Return home): every
// client, its aggregate turnover and the client's wish for the year
// (client_annual_turnover), and its working's allotment and sign-off.

import { supabase } from '@/integrations/supabase/client';
import { toSignoffState, type SignoffChanges, type SignoffPeriod, type SignoffState } from './signoffFlow';
import { PERIOD_COLUMNS, type SignoffRow } from './store';

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

export interface RegisterData {
  clients: RegisterClient[];
  turnover: Map<string, TurnoverEntry>;
  /** Allotment and sign-off of every client's working (clients without a period row are absent — not started). */
  working: Map<string, SignoffState>;
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

/** The period without the payables snapshot (large, and not shown here). */
const REGISTER_PERIOD_COLUMNS = `client_id, ${PERIOD_COLUMNS.replace(/,\s*payables_at_lock/, '')}`;

type ChangesRow = { client_id: string | null; since_prepared: number | null; since_verified: number | null; last_change_at: string | null; last_change_by: string | null };

const changesOf = (c: Omit<ChangesRow, 'client_id'> | null | undefined): SignoffChanges | null =>
  c ? { sincePrepared: c.since_prepared ?? 0, sinceVerified: c.since_verified ?? 0, lastAt: c.last_change_at, lastBy: c.last_change_by } : null;

export async function loadRegister(financialYear: string): Promise<RegisterData> {
  const [clients, turnover, activity, periods, changes] = await Promise.all([
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
    allRows<SignoffPeriod & { client_id: string }>((a, b) =>
      supabase
        .from('annual_return_periods')
        .select(REGISTER_PERIOD_COLUMNS)
        .eq('financial_year', financialYear)
        .order('client_id')
        .range(a, b) as unknown as PromiseLike<{ data: (SignoffPeriod & { client_id: string })[] | null; error: { message: string } | null }>,
    ),
    allRows<ChangesRow>((a, b) =>
      supabase
        .from('annual_return_signoff_changes')
        .select('client_id, since_prepared, since_verified, last_change_at, last_change_by')
        .eq('financial_year', financialYear)
        .range(a, b),
    ),
  ]);

  const act = new Map(activity.filter((r) => r.client_id).map((r) => [r.client_id as string, r]));
  const chg = new Map(changes.filter((r) => r.client_id).map((r) => [r.client_id as string, r]));
  const working = new Map<string, SignoffState>();
  const ids = new Set<string>([...act.keys(), ...periods.map((p) => p.client_id)]);
  const byClient = new Map(periods.map((p) => [p.client_id, p]));
  ids.forEach((id) => {
    const a = act.get(id);
    working.set(id, toSignoffState(byClient.get(id) ?? null, { sheets: a?.sheets ?? 0, lastSavedAt: a?.last_saved_at ?? null, changes: changesOf(chg.get(id)) }));
  });

  return {
    clients,
    turnover: new Map(turnover.map(({ client_id, ...t }) => [client_id, t])),
    working,
  };
}

/** A sign-off RPC's returned row as the register's state. */
export const signoffStateOf = (r: SignoffRow): SignoffState =>
  toSignoffState(r, { sheets: r.sheets ?? 0, lastSavedAt: r.last_saved_at, changes: changesOf(r.changes) });

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
