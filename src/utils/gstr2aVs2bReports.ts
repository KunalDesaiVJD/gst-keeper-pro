// Reports Hub: GSTR-2A vs GSTR-2B Reconciliation. Reads the portal-pulled 2A
// and 2B the extension saved in gst_filed_returns (never the Excel imports),
// hands them to the pure engine in src/lib/itcReco and renders its result. It
// also reads the next three months' 2B and the earlier months' 2A, when
// pulled, to confirm the reasons that depend on them; Pull fetches whatever of
// these is missing. Nothing here writes to the database.
// Positions: docs/GSTR2A_2B_RECO_POSITIONS.md.
import { supabase } from '@/integrations/supabase/client';
import { compareVersions } from '@/lib/extensionVersion';
import { addMonths, due2BDate, istToday, monthLabel } from '@/lib/itcReco/dates';
import { earlierPeriodsOf, isQuarterEnd, isStale2A, quarterOf, reconcile2A2B } from '@/lib/itcReco/reasons';
import { findRow, statementFromRow } from '@/lib/itcReco/sources';
import { toReportTable } from '@/lib/itcReco/table';
import type { SourceKey, StatementRow } from '@/lib/itcReco/types';
import type { PullJob, PullPlan } from '@/lib/reportRegistry';
import type { ReportTable } from './allClientsReports';
import { fetchClient } from './filedReturnReports';

const RETURN_TYPE: Record<'2A' | '2B', string> = { '2A': 'GSTR2A', '2B': 'GSTR2B' };
const SOURCE_OF: Record<string, SourceKey> = { GSTR2A: '2A', GSTR2B: '2B' };

/** The first extension version with the combined gstr2a2b_pull mode. */
export const COMBINED_PULL_VERSION = '0.13.0';

async function loadRows(clientId: string, periods: string[], sources: ('2A' | '2B')[]): Promise<StatementRow[]> {
  if (!periods.length) return [];
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, return_type, status, summary, updated_at')
    .eq('client_id', clientId)
    .in('return_type', sources.map((s) => RETURN_TYPE[s]))
    .in('period_month', periods);
  if (error) throw error;
  return (data || []).map((r) => ({
    source: SOURCE_OF[r.return_type],
    period: r.period_month,
    status: r.status,
    summary: r.summary,
    updatedAt: r.updated_at,
  }));
}

/** The months whose 2A and 2B a month's reconciliation reads first: M-2 (a quarterly 2B) to M+3 (later 2Bs). */
const AROUND = [-2, -1, 0, 1, 2, 3];

/** Everything one month's reconciliation reads: 2A and 2B of M-2 to M+3, then the earlier 2A the 2B points to. */
async function loadForMonth(clientId: string, month: string): Promise<StatementRow[]> {
  const around = AROUND.map((k) => addMonths(month, k));
  const rows = await loadRows(clientId, around, ['2A', '2B']);
  const twoB = statementFromRow(findRow(rows, '2B', month), '2B', month);
  const earlier = twoB.meta.state === 'ready' ? earlierPeriodsOf(twoB, month).filter((p) => !around.includes(p)) : [];
  return earlier.length ? [...rows, ...(await loadRows(clientId, earlier, ['2A']))] : rows;
}

export const buildGstr2aVs2bRecoReport = async (clientId: string, month: string): Promise<ReportTable> => {
  if (!/^\d{2}\/\d{4}$/.test(month || '')) throw new Error('Pick a month first.');
  const client = await fetchClient(clientId);
  const rows = await loadForMonth(clientId, month);
  const run = reconcile2A2B({ period: month, client: { name: client.name, gstin: client.gstin }, rows, today: istToday() });
  return toReportTable(run.result, { title: 'GSTR-2A vs GSTR-2B Reconciliation', client, period: month, left: run.twoA, right: run.twoB });
};

// ── Pull: only what is missing ──────────────────────────────────────────────

export interface PlanInput {
  periods: string[];
  rows: StatementRow[];
  today: string;
  extVersion: string | null;
}

const byPeriod = (a: string, b: string) => {
  const [am, ay] = a.split('/').map(Number);
  const [bm, by] = b.split('/').map(Number);
  return ay * 12 + am - (by * 12 + bm);
};

/**
 * For each selected month M: the 2A of M when not usable (missing, failed, an
 * old extension's empty pull) or stale (older than the 2B, or than 15 days); the
 * 2B of M and the next 2B (M+1; a quarterly 2B: M+3) once due and not usable;
 * the 2A of each earlier month M's 2B points to, and of the quarter's months for
 * a quarterly 2B. A 2B the portal did not generate is asked again only when
 * nothing else is missing (it is generated once the previous GSTR-3B is filed),
 * so it never blocks the rest. Nothing missing: 2A and 2B of the selected months
 * again (2A changes whenever a supplier files). Extension 0.13.0 or later gets
 * one combined job; an older one gets one return type per click.
 */
export function planPullJobs({ periods, rows, today, extVersion }: PlanInput): PullPlan {
  const want = new Map<string, Set<'2A' | '2B'>>();
  const ask = (p: string, s: '2A' | '2B') => want.set(p, new Set([...(want.get(p) ?? []), s]));
  const state = (s: '2A' | '2B', p: string) => statementFromRow(findRow(rows, s, p), s, p);
  const isDue = (p: string) => today >= due2BDate(p);
  const usable2A = (p: string) => { const a = state('2A', p).meta; return a.state === 'ready' && !a.suspectEmpty; };
  const recheck = new Set<string>();
  const want2B = (p: string) => {
    if (!isDue(p)) return;
    const st = state('2B', p).meta.state;
    if (st === 'not_generated') recheck.add(p);
    else if (st !== 'ready') ask(p, '2B');
  };
  for (const m of periods) {
    const a = state('2A', m).meta;
    const b = state('2B', m);
    const bReady = b.meta.state === 'ready';
    if (!usable2A(m) || (bReady && isStale2A(a.pulledAt, b.meta.generatedOn, today))) ask(m, '2A');
    want2B(m);
    const quarter = bReady ? quarterOf(rows, m) : null;
    want2B(addMonths(m, quarter ? 3 : 1));
    if (!bReady) continue;
    const earlier = earlierPeriodsOf(b, m);
    for (const sp of [...(quarter ?? []), ...earlier]) if (!usable2A(sp)) ask(sp, '2A');
    // A quarter-end 2B holding documents of the quarter's earlier months: their
    // 2B (not generated for a quarterly taxpayer) tells which kind this is.
    if (!quarter && isQuarterEnd(m)) {
      for (const q of [addMonths(m, -2), addMonths(m, -1)]) if (earlier.includes(q) && isDue(q) && state('2B', q).meta.state === 'not_pulled') ask(q, '2B');
    }
  }
  let note: string | undefined;
  if (!want.size) {
    for (const m of periods) { ask(m, '2A'); if (isDue(m)) ask(m, '2B'); }
    for (const p of recheck) ask(p, '2B');
    note = 'Everything was pulled; pulling 2A and 2B of the selected months again'
      + `${[...recheck].some((p) => !periods.includes(p)) ? ', and the 2B the portal had not generated' : ''}.`;
  }
  const sorted = [...want.keys()].sort(byPeriod);
  const order: ('2A' | '2B')[] = ['2A', '2B'];
  if (extVersion && compareVersions(extVersion, COMBINED_PULL_VERSION) >= 0) {
    const w: Record<string, string[]> = {};
    for (const p of sorted) w[p] = order.filter((s) => want.get(p)?.has(s));
    return { jobs: [{ mode: 'gstr2a2b_pull', periods: sorted, want: w }], note };
  }
  const jobs: PullJob[] = [];
  const a = sorted.filter((p) => want.get(p)?.has('2A'));
  const b = sorted.filter((p) => want.get(p)?.has('2B'));
  if (a.length) jobs.push({ mode: 'gstr2a_pull', periods: a });
  if (b.length) jobs.push({ mode: 'gstr2b_pull', periods: b });
  return { jobs, note };
}

/** Words for what a job fetches: "GSTR-2B of Aug 2026", "GSTR-2A of Jun 2026, Jul 2026". */
export const describeJob = (job: PullJob): string => {
  if (job.want) {
    return job.periods.map((p) => `${(job.want?.[p] ?? ['2A', '2B']).map((s) => `GSTR-${s}`).join(' and ')} of ${monthLabel(p)}`).join('; ');
  }
  if (job.mode === 'gstr9_8a_pull') return `GSTR-9 Table 8A document details of ${job.periods.map((p) => `the year ending ${monthLabel(p)}`).join(', ')}`;
  if (job.mode === 'gstr9_pull') return `GSTR-9 system figures of ${job.periods.map((p) => `the year ending ${monthLabel(p)}`).join(', ')}`;
  const kind = job.mode === 'gstr2a_pull' ? 'GSTR-2A' : job.mode === 'gstr2b_pull' ? 'GSTR-2B' : job.mode;
  return `${kind} of ${job.periods.map(monthLabel).join(', ')}`;
};

export const planGstr2a2bPull = async ({ clientId, periods, extVersion }: { clientId: string; periods: string[]; extVersion: string | null }): Promise<PullPlan> => {
  const months = [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)))];
  const rows = await loadRows(clientId, [...new Set(months.flatMap((m) => AROUND.map((k) => addMonths(m, k))))], ['2A', '2B']);
  const earlier = new Set<string>();
  for (const m of months) {
    const b = statementFromRow(findRow(rows, '2B', m), '2B', m);
    if (b.meta.state === 'ready') for (const p of earlierPeriodsOf(b, m)) if (!rows.some((r) => r.source === '2A' && r.period === p)) earlier.add(p);
  }
  const all = earlier.size ? [...rows, ...(await loadRows(clientId, [...earlier], ['2A']))] : rows;
  return planPullJobs({ periods: months, rows: all, today: istToday(), extVersion });
};
