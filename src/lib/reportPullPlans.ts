// What a Reports Hub "Pull" fetches for the reports that read more than the one
// return or month a plain pull covers (25 Oct 2026 audit of every report against
// extension 0.18.1):
//  - a comparison reads two returns (GSTR-3B vs GSTR-1, 3B vs 2A / 2B): both are
//    pulled, not only the 3B;
//  - a year report (the GSTR-3B annual summary, the credit and liability
//    statement, the portal ledgers) reads the whole financial year: every month
//    of it up to today is pulled, not only the months picked;
//  - a PAN report reads every GSTIN of the PAN: each one is pulled, not only the
//    client picked;
//  - an all-clients report reads every client's GSTR-3B of the month: the
//    clients still missing it are pulled in one run;
//  - a statement the portal gives for a whole year at once (credit reversal and
//    re-claimed, RCM liability / ITC) is pulled once a year, not once a month.
// Only what is missing is fetched; with nothing missing the months picked are
// pulled again (a refresh), as a plain Pull does. Every job uses a mode the
// extension already runs (0.17.0 and later), so nothing here needs a new
// extension: jobs[0] starts now and the next click fetches the rest.
import { supabase } from '@/integrations/supabase/client';
import type { PullJob, PullPlan } from '@/lib/reportRegistry';
import { fyMonthsForKey } from '@/utils/allClientsReports';
import { istToday } from '@/lib/itcReco/dates';

type Source = { mode: string; returnType: string; label: string };

export const SRC = {
  gstr3b: { mode: 'gstr3b_pull', returnType: 'GSTR3B', label: 'GSTR-3B' },
  gstr1: { mode: 'gstr1_pull', returnType: 'GSTR1', label: 'GSTR-1' },
  gstr2a: { mode: 'gstr2a_pull', returnType: 'GSTR2A', label: 'GSTR-2A' },
  gstr2b: { mode: 'gstr2b_pull', returnType: 'GSTR2B', label: 'GSTR-2B' },
} satisfies Record<string, Source>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (p: string) => { const [m, y] = p.split('/').map(Number); return `${MONTHS[m - 1] ?? '?'} ${y}`; };
const idx = (p: string) => { const [m, y] = p.split('/').map(Number); return y * 12 + m; };
const byPeriod = (a: string, b: string) => idx(a) - idx(b);
const valid = (periods: string[]) => [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)))].sort(byPeriod);

/** This month, IST, as MM/YYYY. */
const thisMonth = (): string => { const [y, m] = istToday().split('-'); return `${m}/${y}`; };

/**
 * The months of every FY among those picked, up to the last one there can be
 * data for: last month for a return (this month's is not filed yet), this
 * month for a ledger.
 */
export const fyMonthsUpTo = (periods: string[], upTo: 'last-month' | 'this-month'): string[] => {
  const cap = idx(thisMonth()) - (upTo === 'last-month' ? 1 : 0);
  return valid(valid(periods).flatMap((p) => fyMonthsForKey(p).months)).filter((p) => idx(p) <= cap);
};

/** One month per FY among those picked (the first picked of each), for a statement the portal gives a year at a time. */
export const oneMonthPerFy = (periods: string[]): string[] => {
  const seen = new Set<string>();
  return valid(periods).filter((p) => { const fy = fyMonthsForKey(p).fyLabel; if (seen.has(fy)) return false; seen.add(fy); return true; });
};

const ranges = (periods: string[]) => {
  if (!periods.length) return '';
  if (periods.length <= 3) return periods.map(monthLabel).join(', ');
  return `${periods.length} months, ${monthLabel(periods[0])} to ${monthLabel(periods[periods.length - 1])}`;
};

/** A pulled return the reports can read: its summary holds figures (a failed, pending or not-found pull leaves it empty). */
const usable = (summary: unknown) => !!summary && typeof summary === 'object' && Object.keys(summary as object).length > 0;

/** For each client, the periods of a return already pulled with figures. */
const pulledReturns = async (clientIds: string[], periods: string[], returnType: string): Promise<Map<string, Set<string>>> => {
  const have = new Map<string, Set<string>>();
  if (!clientIds.length || !periods.length) return have;
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('client_id, period_month, summary')
    .in('client_id', clientIds).in('period_month', periods).eq('return_type', returnType);
  if (error) throw error;
  for (const r of data || []) {
    if (!usable(r.summary)) continue;
    if (!have.has(r.client_id)) have.set(r.client_id, new Set());
    have.get(r.client_id)!.add(r.period_month);
  }
  return have;
};

const clientNames = async (ids: string[]): Promise<Map<string, string>> => {
  if (!ids.length) return new Map();
  const { data } = await supabase.from('clients').select('id, name').in('id', ids);
  return new Map((data || []).map((c) => [c.id, c.name]));
};

/**
 * The returns `sources` of `clientIds` over `periods`, only what is missing:
 * one job per (client, return), the selected client's first. With nothing
 * missing, the selected client's returns of `refresh` again.
 */
export const planReturns = async (args: {
  selectedClientId: string;
  clientIds?: string[];
  periods: string[];
  sources: Source[];
  refresh: string[];
}): Promise<PullPlan> => {
  const ids = [args.selectedClientId, ...(args.clientIds ?? []).filter((id) => id !== args.selectedClientId)];
  const periods = valid(args.periods);
  const names = ids.length > 1 ? await clientNames(ids) : new Map<string, string>();
  const jobs: PullJob[] = [];
  for (const src of args.sources) {
    const have = await pulledReturns(ids, periods, src.returnType);
    for (const id of ids) {
      const missing = periods.filter((p) => !have.get(id)?.has(p));
      if (!missing.length) continue;
      const who = id === args.selectedClientId ? '' : `${names.get(id) ?? 'another GSTIN of the PAN'}: `;
      jobs.push({
        mode: src.mode, periods: missing,
        ...(id === args.selectedClientId ? {} : { clientId: id }),
        label: `${who}${src.label} of ${ranges(missing)}`,
      });
    }
  }
  // The selected client's jobs first: they need no switch of login.
  jobs.sort((a, b) => Number(!!a.clientId) - Number(!!b.clientId));
  if (jobs.length) return { jobs };
  const refresh = valid(args.refresh);
  return {
    jobs: args.sources.map((src) => ({ mode: src.mode, periods: refresh, label: `${src.label} of ${ranges(refresh)}` })),
    note: 'Everything this report reads was pulled; pulling the selected months again.',
  };
};

/** The other GSTINs of the selected client's PAN (characters 3 to 12 of the GSTIN). */
export const panSiblings = async (clientId: string): Promise<string[]> => {
  const { data: me } = await supabase.from('clients').select('gstin').eq('id', clientId).maybeSingle();
  const pan = (me?.gstin || '').trim().toUpperCase().slice(2, 12);
  if (pan.length !== 10) return [];
  const { data } = await supabase.from('clients').select('id, gstin');
  return (data || []).filter((c) => (c.gstin || '').trim().toUpperCase().slice(2, 12) === pan && c.id !== clientId).map((c) => c.id);
};

/**
 * A portal ledger kept per month (credit, liability, cash): the months of the
 * FY up to this month that have no row yet. A month whose pull failed is
 * pulled again.
 */
export const planLedgerMonths = async (args: {
  clientId: string;
  periods: string[];
  mode: string;
  table: 'gst_credit_ledger_transactions' | 'gst_liability_ledger_entries' | 'gst_cash_ledger_entries';
  label: string;
}): Promise<PullPlan> => {
  const months = fyMonthsUpTo(args.periods, 'this-month');
  if (!months.length) return { jobs: [], note: 'No month of that financial year has started yet.' };
  const { data, error } = await supabase.from(args.table).select('period_month, description').eq('client_id', args.clientId).in('period_month', months);
  if (error) throw error;
  const good = new Set<string>();
  const failed = new Set<string>();
  for (const r of data || []) (String(r.description || '').startsWith('PULL FAILED') ? failed : good).add(r.period_month);
  const missing = months.filter((p) => !good.has(p) || failed.has(p));
  if (missing.length) return { jobs: [{ mode: args.mode, periods: missing, label: `${args.label} of ${ranges(missing)}` }] };
  const refresh = valid(args.periods);
  return { jobs: [{ mode: args.mode, periods: refresh, label: `${args.label} of ${ranges(refresh)}` }], note: 'Every month of the year was pulled; pulling the selected months again.' };
};

/** A statement the portal gives for a whole FY: one pull per FY picked. */
export const planOncePerFy = (mode: string, label: string) => async ({ periods }: { periods: string[] }): Promise<PullPlan> => {
  const one = oneMonthPerFy(periods);
  return { jobs: one.length ? [{ mode, periods: one, label: `${label} of ${one.map((p) => fyMonthsForKey(p).fyLabel).join(', ')}` }] : [] };
};

/**
 * An all-clients report of one month: the clients whose GSTR-3B (or 3B (Q))
 * of the month is in Filing Status, who have portal credentials and no portal
 * password issue, and whose GSTR-3B of the month is not pulled yet. One job a
 * month (the extension's all-clients run takes one period), several months on
 * the next clicks.
 */
export const planAllClientsGstr3b = async ({ periods }: { periods: string[] }): Promise<PullPlan> => {
  const months = valid(periods);
  const jobs: PullJob[] = [];
  let skipped = 0;
  for (const month of months) {
    const { data: fs, error } = await supabase
      .from('filing_status').select('client_id')
      .eq('period_month', month).in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']);
    if (error) throw error;
    const inFiling = [...new Set((fs || []).map((r) => r.client_id))];
    if (!inFiling.length) continue;
    const { data: cl } = await supabase.from('clients').select('id, gst_user_id, portal_login_issue').in('id', inFiling);
    const able = (cl || []).filter((c) => c.gst_user_id && !c.portal_login_issue).map((c) => c.id);
    skipped += inFiling.length - able.length;
    const have = await pulledReturns(able, [month], 'GSTR3B');
    const missing = able.filter((id) => !have.get(id)?.has(month));
    if (missing.length) jobs.push({ mode: 'gstr3b_pull', periods: [month], clientIds: missing, label: `GSTR-3B of ${monthLabel(month)} for ${missing.length} client${missing.length === 1 ? '' : 's'}` });
  }
  const left = skipped ? ` ${skipped} client${skipped === 1 ? ' has' : 's have'} no portal login saved or a password issue and ${skipped === 1 ? 'is' : 'are'} left out.` : '';
  if (!jobs.length) return { jobs, note: `Every client's GSTR-3B of the month${months.length === 1 ? '' : 's'} picked is already pulled.${left}` };
  return { jobs, note: `Each client needs its own CAPTCHA in the portal tab.${left}` };
};
