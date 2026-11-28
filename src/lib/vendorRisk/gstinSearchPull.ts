// The Vendor GSTIN Risk report's Pull (extension 0.19.3, mode gstin_search):
// which supplier GSTINs of the client to look up on the portal's logged-in
// Search Taxpayer, and, first, the FY's GSTR-2A / 2B months the report reads
// that are not pulled yet. docs/VENDOR_GSTIN_RISK.md, "Search Taxpayer lookup"
// and "Run ledger".
//
// The client's suppliers over the FY of the months picked come from every
// place the app holds them: the portal-pulled GSTR-2A / GSTR-2B
// (gst_filed_returns, every `ctin` in the summary), Import 2B's documents
// (twob_import_docs.supplier_gstin), the books register
// (books_register.supplier_gstin) and the vendor master uploaded on the report
// (vendor_master_entries.gstin). Only well-formed GSTINs with a good check
// character are asked (a mistyped one would only waste a portal request).
//
// Order of the lookups: missing first (no ok / not_found lookup, or the last
// attempt errored after the last answer), then stale (an answer older than
// LOOKUP_FRESH_DAYS, the oldest first); with none of either, all of them again
// (a refresh). The action 'missing' ("Re-pull missing") asks the missing only.
// At most MAX_PER_PULL per click; the next click takes the rest.
//
// The plan also records the run (vendor_lookup_runs, migration
// 20261128120000): a 'planned' row just before the lookup job is sent (its id
// rides on the job as run_id, and the extension updates it as it goes), or a
// 'refused' row when the extension is missing or too old, so a Pull that
// never started still leaves a trace the report shows.
import { supabase } from '@/integrations/supabase/client';
import type { PullJob, PullPlan, PullRun } from '@/lib/reportRegistry';
import { fyMonthsForKey } from '@/utils/allClientsReports';
import { compareVersions } from '@/lib/extensionVersion';
import { checkGstin, normGstin } from '@/lib/vendorRisk/gstin';
import { findRow, statementFromRow } from '@/lib/itcReco/sources';
import { isDue } from '@/lib/itcReco/fy8a';
import { istToday } from '@/lib/itcReco/dates';
import type { StatementRow } from '@/lib/itcReco/types';
import { fyOfPeriod } from '@/lib/reply/periods';

/** The extension that runs Search Taxpayer lookups with a run ledger (mode gstin_search). */
export const GSTIN_SEARCH_VERSION = '0.19.3';
export const GSTIN_SEARCH_MODE = 'gstin_search';
/** A lookup newer than this counts as fresh. */
export const LOOKUP_FRESH_DAYS = 30;
/** GSTINs per Pull (each looked up on the portal's own Search Taxpayer page, about 10 to 15 seconds each). */
export const MAX_PER_PULL = 150;
/** The Pull action that asks only the GSTINs with no usable answer ("Re-pull missing"). */
export const REPULL_MISSING = 'missing';
/** The extension that runs gstr2a2b_pull (one login, per-month want). */
const COMBINED_2A2B_VERSION = '0.13.0';

const PAGE = 1000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (p: string) => `${MON[+p.slice(0, 2) - 1] ?? '?'} ${p.slice(3)}`;
const pIdx = (p: string) => +p.slice(3) * 12 + +p.slice(0, 2);
const listMonths = (ps: string[]) => (ps.length <= 4 ? ps.map(monthLabel).join(', ') : `${ps.length} months, ${monthLabel(ps[0])} to ${monthLabel(ps[ps.length - 1])}`);

/** Every `ctin` (supplier GSTIN) anywhere in a pulled 2A / 2B summary. */
export const ctinsIn = (node: unknown, out: Set<string> = new Set(), depth = 0): Set<string> => {
  if (!node || typeof node !== 'object' || depth > 8) return out;
  if (Array.isArray(node)) { for (const x of node) ctinsIn(x, out, depth + 1); return out; }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'ctin' && typeof v === 'string') out.add(normGstin(v));
    else if (v && typeof v === 'object') ctinsIn(v, out, depth + 1);
  }
  return out;
};

/** All rows of a query, a page at a time (PostgREST caps one answer). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error instanceof Error ? error : new Error((error as { message?: string })?.message || 'read failed');
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

/** The client's supplier GSTINs over the months, valid ones only, and the client's own GSTIN left out. */
export async function supplierGstins(clientId: string, months: string[]): Promise<string[]> {
  const found = new Set<string>();
  const [own, filed, docs, books, master] = await Promise.all([
    supabase.from('clients').select('gstin').eq('id', clientId).maybeSingle(),
    allRows<{ summary: unknown }>((a, b) => supabase.from('gst_filed_returns').select('summary')
      .eq('client_id', clientId).in('return_type', ['GSTR2A', 'GSTR2B']).in('period_month', months).range(a, b)),
    allRows<{ supplier_gstin: string | null }>((a, b) => supabase.from('twob_import_docs').select('supplier_gstin')
      .eq('client_id', clientId).in('period_month', months).not('supplier_gstin', 'is', null).range(a, b)),
    allRows<{ supplier_gstin: string | null }>((a, b) => supabase.from('books_register').select('supplier_gstin')
      .eq('client_id', clientId).in('period_month', months).not('supplier_gstin', 'is', null).range(a, b)),
    allRows<{ gstin: string | null }>((a, b) => supabase.from('vendor_master_entries').select('gstin')
      .eq('client_id', clientId).range(a, b)),
  ]);
  for (const r of filed) ctinsIn(r.summary, found);
  for (const r of docs) if (r.supplier_gstin) found.add(normGstin(r.supplier_gstin));
  for (const r of books) if (r.supplier_gstin) found.add(normGstin(r.supplier_gstin));
  for (const r of master) if (r.gstin) found.add(normGstin(r.gstin));
  const self = normGstin(own.data?.gstin ?? '');
  return [...found].filter((g) => g && g !== self && checkGstin(g).valid).sort();
}

/** Per GSTIN: when it was last answered (ok / not_found) and when a lookup of it last failed. */
export interface LookupState { answeredAt: string | null; erroredAt: string | null }

async function lookupStates(gstins: string[]): Promise<Map<string, LookupState>> {
  const at = new Map<string, LookupState>();
  const get = (g: string) => at.get(g) ?? (at.set(g, { answeredAt: null, erroredAt: null }), at.get(g)!);
  for (let i = 0; i < gstins.length; i += 200) {
    const chunk = gstins.slice(i, i + 200);
    const { data, error } = await supabase.from('vendor_gstin_latest').select('gstin, looked_up_at').in('gstin', chunk);
    if (error) throw error;
    for (const r of data || []) if (r.gstin && r.looked_up_at) get(r.gstin).answeredAt = r.looked_up_at;
    const errs = await supabase.from('vendor_gstin_lookups').select('gstin, looked_up_at').in('gstin', chunk).eq('status', 'error');
    if (errs.error) throw errs.error;
    for (const r of errs.data || []) {
      if (!r.gstin || !r.looked_up_at) continue;
      const s = get(r.gstin);
      if (!s.erroredAt || r.looked_up_at > s.erroredAt) s.erroredAt = r.looked_up_at;
    }
  }
  return at;
}

/**
 * Missing: no answer at all, or the last attempt failed after the last answer
 * (an error never hides a good answer in the report, but it is asked again).
 */
export const isMissingLookup = (s: LookupState | undefined): boolean =>
  !s || !s.answeredAt || (!!s.erroredAt && Date.parse(s.erroredAt) > Date.parse(s.answeredAt));

/**
 * The lookup queue: missing first (never answered first, then the oldest
 * failure), then stale answers (oldest first); fresh answers only on a refresh
 * (nothing missing or stale) and never for 'missing'.
 */
export function lookupQueue(gstins: string[], states: Map<string, LookupState>, nowMs: number, action?: string): { queue: string[]; missing: number; stale: number; refresh: boolean } {
  const cutoff = nowMs - LOOKUP_FRESH_DAYS * 24 * 60 * 60 * 1000;
  const missing = gstins.filter((g) => isMissingLookup(states.get(g)));
  const stale = gstins.filter((g) => !isMissingLookup(states.get(g)) && Date.parse(states.get(g)!.answeredAt!) < cutoff);
  const t = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
  const byMissing = (a: string, b: string) => t(states.get(a)?.answeredAt) - t(states.get(b)?.answeredAt)
    || t(states.get(a)?.erroredAt) - t(states.get(b)?.erroredAt) || a.localeCompare(b);
  const byAge = (a: string, b: string) => t(states.get(a)?.answeredAt) - t(states.get(b)?.answeredAt) || a.localeCompare(b);
  if (action === REPULL_MISSING) return { queue: [...missing].sort(byMissing), missing: missing.length, stale: stale.length, refresh: false };
  const refresh = !missing.length && !stale.length;
  const queue = refresh ? [...gstins].sort(byAge) : [...[...missing].sort(byMissing), ...[...stale].sort(byAge)];
  return { queue, missing: missing.length, stale: stale.length, refresh };
}

const fyMonthsOf = (periods: string[]): string[] =>
  [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)).flatMap((p) => fyMonthsForKey(p).months))].sort((a, b) => pIdx(a) - pIdx(b));

/**
 * The FY's GSTR-2A / 2B months the report reads that are due and not usable
 * (not pulled, failed, or pulled empty when it should hold documents), as one
 * gstr2a2b_pull (0.13.0 and later) or one pull per return; the same reading
 * of a stored month as the report's (statementFromRow). A 2B the portal did
 * not generate is not asked again.
 */
export async function planVendorStatements(clientId: string, months: string[], extVersion: string | null | undefined, today = istToday()): Promise<{ jobs: PullJob[]; missing2A: string[]; missing2B: string[] }> {
  const { data, error } = await supabase
    .from('gst_filed_returns')
    .select('period_month, return_type, status, summary, updated_at')
    .eq('client_id', clientId)
    .in('return_type', ['GSTR2A', 'GSTR2B'])
    .in('period_month', months);
  if (error) throw error;
  const rows: StatementRow[] = (data || []).map((r) => ({ source: r.return_type === 'GSTR2A' ? '2A' : '2B', period: r.period_month, status: r.status, summary: r.summary, updatedAt: r.updated_at }));
  const want = new Map<string, ('2A' | '2B')[]>();
  for (const p of months) {
    for (const s of ['2A', '2B'] as const) {
      if (!isDue(s, p, today)) continue;
      const m = statementFromRow(findRow(rows, s, p), s, p).meta;
      if (m.state === 'not_generated') continue;
      if (m.state !== 'ready' || m.suspectEmpty) want.set(p, [...(want.get(p) ?? []), s]);
    }
  }
  const sorted = [...want.keys()].sort((a, b) => pIdx(a) - pIdx(b));
  const missing2A = sorted.filter((p) => want.get(p)!.includes('2A'));
  const missing2B = sorted.filter((p) => want.get(p)!.includes('2B'));
  if (!sorted.length) return { jobs: [], missing2A, missing2B };
  const words = [missing2A.length ? `GSTR-2A of ${listMonths(missing2A)}` : '', missing2B.length ? `GSTR-2B of ${listMonths(missing2B)}` : ''].filter(Boolean).join(' and ');
  if (extVersion && compareVersions(extVersion, COMBINED_2A2B_VERSION) >= 0) {
    const w: Record<string, string[]> = {};
    for (const p of sorted) w[p] = want.get(p)!;
    return { jobs: [{ mode: 'gstr2a2b_pull', periods: sorted, want: w, label: words }], missing2A, missing2B };
  }
  const jobs: PullJob[] = [];
  if (missing2A.length) jobs.push({ mode: 'gstr2a_pull', periods: missing2A, label: `GSTR-2A of ${listMonths(missing2A)}` });
  if (missing2B.length) jobs.push({ mode: 'gstr2b_pull', periods: missing2B, label: `GSTR-2B of ${listMonths(missing2B)}` });
  return { jobs, missing2A, missing2B };
}

/** Why a lookup Pull cannot start with this extension, or null. */
export const lookupRefusal = (extVersion: string | null | undefined): string | null => {
  // Only a 0.19.0+ extension knows the mode (an older one would run its ledger chain instead);
  // 0.19.3 is asked for: it records the run (vendor_lookup_runs) and falls back to the public page.
  if (extVersion === undefined) return null;
  if (!extVersion) return `No GST Keeper browser extension answered this page, so the vendor lookups did not start: install or enable extension v${GSTIN_SEARCH_VERSION} or later, reload this page and click Pull again.`;
  if (compareVersions(extVersion, GSTIN_SEARCH_VERSION) < 0) {
    return `The vendor lookups did not start: they need browser extension v${GSTIN_SEARCH_VERSION} or later and this one is v${extVersion}. Reload it from the updated extension folder (chrome://extensions → Reload), reload this page and click Pull again.`;
  }
  return null;
};

/** One update of a run row (the app's side: a refused start). */
export async function updateLookupRun(id: string, patch: { status?: string; stop_reason?: string | null; finished_at?: string | null }): Promise<void> {
  const { error } = await supabase.from('vendor_lookup_runs').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * The Pull plan. `extVersion` is what ReportsPage passes every plan (the
 * installed extension's version, null when none answered); a caller that
 * leaves it out is not gated.
 */
export const planVendorGstinSearch = async (args: { clientId: string; periods: string[]; extVersion?: string | null; action?: string }): Promise<PullPlan> => {
  const months = fyMonthsOf(args.periods);
  if (!months.length) return { jobs: [], note: 'Pick a month first: the suppliers are those of its financial year.' };
  const fy = fyOfPeriod(months[0]);
  const refusal = lookupRefusal(args.extVersion);
  // 2A / 2B pulls run on any extension the app accepts; only the lookups are gated.
  const st = await planVendorStatements(args.clientId, months, args.extVersion ?? null);
  const gstins = await supplierGstins(args.clientId, months);
  const states = gstins.length ? await lookupStates(gstins) : new Map<string, LookupState>();
  const q = lookupQueue(gstins, states, Date.now(), args.action);
  const batch = q.queue.slice(0, MAX_PER_PULL);
  const more = q.queue.length - batch.length;
  const lookupJob: PullJob | null = !refusal && batch.length ? {
    mode: GSTIN_SEARCH_MODE,
    // The FY's first month: the extension reads the FY from it (the filing table's ask by FY).
    periods: months.slice(0, 1),
    gstins: batch,
    label: `the GST registration of ${batch.length} supplier GSTIN${batch.length === 1 ? '' : 's'} (Search Taxpayer)`,
  } : null;

  const notes: string[] = [];
  if (st.jobs.length) notes.push(`The report reads every month's GSTR-2A / 2B of FY ${fy}: pulling the ${st.jobs.map((j) => j.label).join('; ')} first${lookupJob ? '; the vendor lookups start on the next Pull' : ''}.`);
  if (!gstins.length) {
    notes.push(st.jobs.length
      ? 'No supplier GSTIN is known yet: the suppliers are read from the 2A / 2B once pulled.'
      : 'No supplier GSTIN found for this client in the year (GSTR-2A / 2B, Import 2B, the books register or a vendor master). Pull the 2A / 2B or upload a vendor master first.');
  } else if (args.action === REPULL_MISSING && !q.queue.length) {
    notes.push('Every supplier GSTIN already has a portal answer (or an uploaded sheet row) and no failed attempt after it: nothing missing to look up.');
  } else if (lookupJob) {
    if (q.refresh) notes.push(`Every supplier GSTIN was looked up in the last ${LOOKUP_FRESH_DAYS} days; looking them up again.`);
    else notes.push(`${q.missing} GSTIN${q.missing === 1 ? '' : 's'} with no answer or a failed last attempt${args.action === REPULL_MISSING ? '' : `, ${q.stale} older than ${LOOKUP_FRESH_DAYS} days`}.`);
    if (more > 0) notes.push(`${more} more GSTIN${more === 1 ? '' : 's'} left for the next Pull (at most ${MAX_PER_PULL} a Pull).`);
  }
  const jobs = [...st.jobs, ...(lookupJob ? [lookupJob] : [])];
  const blocked = refusal && batch.length ? refusal : undefined;

  const recordRun: PullPlan['recordRun'] = async ({ job, actorId, extVersion, refused }) => {
    const isLookup = !!job && job.mode === GSTIN_SEARCH_MODE;
    const why = refused || (!isLookup ? blocked : undefined);
    if (!isLookup && !why) return null;
    const asked = isLookup ? job!.gstins ?? [] : batch;
    const { data, error } = await supabase.from('vendor_lookup_runs').insert({
      client_id: args.clientId,
      fy,
      requested_by: actorId,
      planned: asked.length,
      gstins: asked,
      extension_version: extVersion,
      status: isLookup && !refused ? 'planned' : 'refused',
      stop_reason: isLookup && !refused ? null : why ?? null,
      finished_at: isLookup && !refused ? null : new Date().toISOString(),
      detail: { action: args.action ?? 'pull', missing: q.missing, stale: q.stale, refresh: q.refresh, left: more, gstr2a_missing: st.missing2A, gstr2b_missing: st.missing2B },
    }).select('id').single();
    if (error || !data) {
      // The ledger is a record, not a gate: a database without the migration still pulls.
      console.warn('vendor_lookup_runs: could not record the run', error);
      return null;
    }
    if (!isLookup || refused) return null;
    const run: PullRun = {
      id: data.id,
      failed: async (reason: string) => {
        try { await updateLookupRun(data.id, { status: 'refused', stop_reason: `The extension did not start the lookups: ${reason}`, finished_at: new Date().toISOString() }); }
        catch (e) { console.warn('vendor_lookup_runs: could not record the refusal', e); }
      },
    };
    return run;
  };

  return { jobs, ...(notes.length ? { note: notes.join(' ') } : {}), ...(blocked ? { blocked } : {}), recordRun };
};
