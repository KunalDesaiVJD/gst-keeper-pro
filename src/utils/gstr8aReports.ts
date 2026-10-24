// Reports Hub: the GSTR-8A family. GSTR-8A here is GSTR-9 Table 8A, the
// year's ITC statement the portal builds from the suppliers' GSTR-1 / IFF (as
// GSTR-2B from FY 2023-24, GSTR-2A before). Three reports, each one client and
// one financial year (any month picked gives its year):
//   - GSTR-2A vs GSTR-8A, GSTR-2B vs GSTR-8A: the reason reconciliation view;
//   - GSTR-8A vs GSTR-2A vs GSTR-2B: every document in the three, side by side,
//     with the final ITC judgment for the year.
// Reads the portal-pulled 2A and 2B the extension saved in gst_filed_returns,
// the 8A document details uploaded here (return_type GSTR9_8A) and the GSTR-9
// system figures (GSTR9_CALC) when pulled. The only write is the 8A upload.
// Positions: docs/GSTR8A_RECO_POSITIONS.md.
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { compareVersions } from '@/lib/extensionVersion';
import { parseGstr9Calc } from '@/lib/gstr9/portalParser';
import { fyOfPeriod, fyStartYear } from '@/lib/reply/periods';
import { istToday } from '@/lib/itcReco/dates';
import { check8AUpload, parse8AFile } from '@/lib/itcReco/eightA';
import { assembleFy, eightAPeriod, fyLoadMonths, fyWindow, isDue, type FyStatements } from '@/lib/itcReco/fy8a';
import { fyPairTable } from '@/lib/itcReco/fyView';
import { reconcileFyPair } from '@/lib/itcReco/reasons8A';
import { findRow, statementFromRow } from '@/lib/itcReco/sources';
import { reconcileThreeWay, threeWayReportTable } from '@/lib/itcReco/threeWay';
import type { SourceKey, StatementRow } from '@/lib/itcReco/types';
import type { PullJob, PullPlan } from '@/lib/reportRegistry';
import type { ReportTable } from './allClientsReports';
import { fetchClient } from './filedReturnReports';
import { COMBINED_PULL_VERSION } from './gstr2aVs2bReports';

/** gst_filed_returns.return_type of an uploaded 8A. */
export const GSTR9_8A = 'GSTR9_8A';
const SOURCE_OF: Record<string, SourceKey> = { GSTR2A: '2A', GSTR2B: '2B', [GSTR9_8A]: '8A' };

interface YearRows { rows: StatementRow[]; calc: unknown | null }

/** The year's 2A and 2B (April to December of the next year), its 8A and its GSTR-9 system figures. */
async function loadYear(clientId: string, fy: string): Promise<YearRows> {
  const months = fyLoadMonths(fy);
  const [main, extra] = await Promise.all([
    supabase
      .from('gst_filed_returns')
      .select('period_month, return_type, status, summary, updated_at')
      .eq('client_id', clientId)
      .in('return_type', ['GSTR2A', 'GSTR2B'])
      .in('period_month', months),
    supabase
      .from('gst_filed_returns')
      .select('period_month, return_type, status, summary, updated_at')
      .eq('client_id', clientId)
      .in('return_type', [GSTR9_8A, 'GSTR9_CALC'])
      .eq('period_month', eightAPeriod(fy)),
  ]);
  if (main.error) throw main.error;
  if (extra.error) throw extra.error;
  const all = [...(main.data || []), ...(extra.data || [])];
  const rows: StatementRow[] = all
    .filter((r) => SOURCE_OF[r.return_type])
    .map((r) => ({ source: SOURCE_OF[r.return_type], period: r.period_month, status: r.status, summary: r.summary, updatedAt: r.updated_at }));
  const calc = all.find((r) => r.return_type === 'GSTR9_CALC')?.summary ?? null;
  return { rows, calc };
}

const fyOf = (month: string): string => {
  if (!/^\d{2}\/\d{4}$/.test(month || '')) throw new Error('Pick a month of the financial year first.');
  return fyOfPeriod(month);
};

/** GSTR-9 Table 8A as the portal computed it, from a pulled GSTR9_CALC; null when not pulled or unreadable. */
const portal8AOf = (calc: unknown, fy: string): { igst: number; cgst: number; sgst: number; cess: number } | null => {
  if (!calc) return null;
  try {
    const p = parseGstr9Calc(calc, fy);
    return p.found.t8A ? { igst: p.gstr9.t8A.i, cgst: p.gstr9.t8A.c, sgst: p.gstr9.t8A.s, cess: p.gstr9.t8A.x } : null;
  } catch {
    return null;
  }
};

async function yearOf(clientId: string, month: string): Promise<{ st: FyStatements; client: { name: string; gstin: string | null }; calc: unknown | null; fy: string }> {
  const fy = fyOf(month);
  const [client, year] = await Promise.all([fetchClient(clientId), loadYear(clientId, fy)]);
  const st = assembleFy({ fy, rows: year.rows, today: istToday() });
  return { st, client: { name: client.name, gstin: client.gstin || null }, calc: year.calc, fy };
}

export const buildGstr2aVs8aReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { st, client } = await yearOf(clientId, month);
  return fyPairTable(reconcileFyPair('2A', st, client, istToday()), client, 'GSTR-2A vs GSTR-8A Reconciliation');
};

export const buildGstr2bVs8aReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { st, client } = await yearOf(clientId, month);
  return fyPairTable(reconcileFyPair('2B', st, client, istToday()), client, 'GSTR-2B vs GSTR-8A Reconciliation');
};

export const buildGstr8aThreeWayReport = async (clientId: string, month: string): Promise<ReportTable> => {
  const { st, client, calc, fy } = await yearOf(clientId, month);
  const anyReady = (side: FyStatements['twoA']) => [...side.metas.entries()].some(([p, m]) => st.window.includes(p) && m.state === 'ready');
  if (!anyReady(st.twoA) && !anyReady(st.twoB)) {
    throw new Error(`No GSTR-2A or GSTR-2B of FY ${fy} is pulled for ${client.name}. Use Pull on this report: it fetches the year's 2A and 2B.`);
  }
  return threeWayReportTable(reconcileThreeWay(st), st, { client, portal8A: portal8AOf(calc, fy) });
};

// ── Pull: the year's 2A and 2B that are missing, then GSTR-9 ────────────────

export interface FyPlanInput {
  fys: string[];
  rows: StatementRow[];
  /** FYs whose GSTR-9 system figures are already pulled. */
  calcPulled: Set<string>;
  today: string;
  extVersion: string | null;
}

/**
 * For each year: the 2A and 2B of every window month that is due and not
 * usable (a 2B the portal did not generate is asked again only when nothing
 * else is missing). Nothing missing: the GSTR-9 system figures (8A as the
 * portal computed it), once the year has ended and they are not pulled; else
 * the 2A and 2B of the window's last six due months again (2A changes whenever
 * a supplier files). The 8A document details are uploaded, not pulled.
 */
export function planFyPullJobs({ fys, rows, calcPulled, today, extVersion }: FyPlanInput): PullPlan {
  const want = new Map<string, Set<'2A' | '2B'>>();
  const ask = (p: string, s: '2A' | '2B') => want.set(p, new Set([...(want.get(p) ?? []), s]));
  const recheck: string[] = [];
  for (const fy of fys) {
    for (const p of fyWindow(fy)) {
      for (const s of ['2A', '2B'] as const) {
        if (!isDue(s, p, today)) continue;
        const m = statementFromRow(findRow(rows, s, p), s, p).meta;
        if (m.state === 'not_generated') { if (s === '2B') recheck.push(p); continue; }
        if (m.state !== 'ready' || m.suspectEmpty) ask(p, s);
      }
    }
  }
  const byPeriod = (a: string, b: string) => {
    const [am, ay] = a.split('/').map(Number);
    const [bm, by] = b.split('/').map(Number);
    return ay * 12 + am - (by * 12 + bm);
  };
  let note: string | undefined;
  if (!want.size) {
    const g9 = fys.filter((fy) => !calcPulled.has(fy) && today >= `${fyStartYear(fy) + 1}-04-01`);
    if (g9.length) {
      return {
        jobs: g9.map((fy) => ({ mode: 'gstr9_pull', periods: [eightAPeriod(fy)] })),
        note: 'Every 2A and 2B of the year is pulled; pulling the GSTR-9 system figures (Table 8A as the portal computed it).',
      };
    }
    for (const fy of fys) {
      const due = fyWindow(fy).filter((p) => isDue('2B', p, today)).slice(-6);
      for (const p of due) { ask(p, '2A'); ask(p, '2B'); }
    }
    for (const p of recheck) ask(p, '2B');
    note = "Everything of the year was pulled; pulling 2A and 2B of the year's last six months again (they change whenever a supplier files).";
  }
  const sorted = [...want.keys()].sort(byPeriod);
  if (!sorted.length) return { jobs: [], note: note ?? 'Nothing to pull for this year yet.' };
  if (extVersion && compareVersions(extVersion, COMBINED_PULL_VERSION) >= 0) {
    const w: Record<string, string[]> = {};
    for (const p of sorted) w[p] = (['2A', '2B'] as const).filter((s) => want.get(p)?.has(s));
    return { jobs: [{ mode: 'gstr2a2b_pull', periods: sorted, want: w }], note };
  }
  const jobs: PullJob[] = [];
  const a = sorted.filter((p) => want.get(p)?.has('2A'));
  const b = sorted.filter((p) => want.get(p)?.has('2B'));
  if (a.length) jobs.push({ mode: 'gstr2a_pull', periods: a });
  if (b.length) jobs.push({ mode: 'gstr2b_pull', periods: b });
  return { jobs, note };
}

export const planGstr8aPull = async ({ clientId, periods, extVersion }: { clientId: string; periods: string[]; extVersion: string | null }): Promise<PullPlan> => {
  const fys = [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)).map(fyOfPeriod))];
  const loaded = await Promise.all(fys.map((fy) => loadYear(clientId, fy)));
  const calcPulled = new Set(fys.filter((_, i) => !!loaded[i].calc));
  return planFyPullJobs({ fys, rows: loaded.flatMap((y) => y.rows), calcPulled, today: istToday(), extVersion });
};

// ── Upload: the portal's Table 8A document details ──────────────────────────

/**
 * Saves the portal's 8A file (Excel or JSON) for the client and the FY of the
 * first month picked, replacing an earlier upload of that year. Checks the
 * file's GSTIN and year first. Returns what was saved, in words.
 */
export async function uploadGstr8a({ clientId, periods, file, uploadedBy }: { clientId: string; periods: string[]; file: File; uploadedBy: string | null }): Promise<string> {
  const month = periods.find((p) => /^\d{2}\/\d{4}$/.test(p));
  if (!month) throw new Error('Pick a month of the financial year the 8A is for.');
  const fy = fyOfPeriod(month);
  const client = await fetchClient(clientId);
  const parsed = parse8AFile(await file.arrayBuffer(), file.name);
  const stored = check8AUpload(parsed, { gstin: client.gstin || null, fy }, { at: new Date().toISOString(), name: uploadedBy });
  const { error } = await supabase.from('gst_filed_returns').upsert(
    {
      client_id: clientId,
      period_month: eightAPeriod(fy),
      return_type: GSTR9_8A,
      status: 'Uploaded',
      summary: stored as unknown as Json,
      updated_at: stored.uploadedAt,
    },
    { onConflict: 'client_id,period_month,return_type' },
  );
  if (error) throw error;
  const skipped = stored.warnings.length ? ` ${stored.warnings.length} warning${stored.warnings.length === 1 ? '' : 's'}: see the report's notes.` : '';
  return `8A of FY ${fy} saved for ${client.name}: ${stored.docs.length} documents from ${stored.sheetsRead.join(', ')}.${skipped}`;
}
