// Reports Hub: the GSTR-8A family. GSTR-8A here is GSTR-9 Table 8A, the
// year's ITC statement the portal builds from the suppliers' GSTR-1 / IFF (as
// GSTR-2B from FY 2023-24, GSTR-2A before). Three reports, each one client and
// one financial year (any month picked gives its year):
//   - GSTR-2A vs GSTR-8A, GSTR-2B vs GSTR-8A: the reason reconciliation view;
//   - GSTR-8A vs GSTR-2A vs GSTR-2B: every document in the three, side by side,
//     with the final ITC judgment for the year.
// Reads the portal-pulled 2A and 2B the extension saved in gst_filed_returns,
// the 8A document details (return_type GSTR9_8A: uploaded here, or pulled by
// extension 0.18.0 and read here, eightAPull.ts) and the GSTR-9 system figures
// (GSTR9_CALC) when pulled. The only write is the 8A upload.
// Positions: docs/GSTR8A_RECO_POSITIONS.md.
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { compareVersions } from '@/lib/extensionVersion';
import { parseGstr9Calc } from '@/lib/gstr9/portalParser';
import { fyOfPeriod, fyStartYear } from '@/lib/reply/periods';
import { istToday } from '@/lib/itcReco/dates';
import { check8AUpload, parse8AFile } from '@/lib/itcReco/eightA';
import { isPulled8A, read8APull } from '@/lib/itcReco/eightAPull';
import { assembleFy, eightAPeriod, fyLoadMonths, fyWindow, isDue, type FyStatements } from '@/lib/itcReco/fy8a';
import { fyPairTable } from '@/lib/itcReco/fyView';
import { reconcileFyPair } from '@/lib/itcReco/reasons8A';
import { findRow, isStored8A, statementFromRow } from '@/lib/itcReco/sources';
import { reconcileThreeWay, threeWayReportTable, type Portal8ATotal } from '@/lib/itcReco/threeWay';
import type { SourceKey, StatementRow } from '@/lib/itcReco/types';
import type { PullJob, PullPlan } from '@/lib/reportRegistry';
import type { ReportTable } from './allClientsReports';
import { fetchClient } from './filedReturnReports';
import { COMBINED_PULL_VERSION } from './gstr2aVs2bReports';

/** gst_filed_returns.return_type of the 8A document details (uploaded or pulled). */
export const GSTR9_8A = 'GSTR9_8A';
/** The extension that pulls the 8A document details itself (mode gstr9_8a_pull). */
export const EIGHT_A_PULL_VERSION = '0.18.0';
const SOURCE_OF: Record<string, SourceKey> = { GSTR2A: '2A', GSTR2B: '2B', [GSTR9_8A]: '8A' };

interface YearRows {
  rows: StatementRow[];
  calc: unknown | null;
  /** When the GSTR-9 system figures were pulled. */
  calcAt: string | null;
  /** They were pulled before the 8A now saved (seen live 25 Oct 2026: the portal
   * updates Table 8A until the next October, so figures pulled earlier fall short). */
  calcStale: boolean;
}

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
  const calcRow = all.find((r) => r.return_type === 'GSTR9_CALC');
  const eightRow = all.find((r) => r.return_type === GSTR9_8A);
  const calcAt = calcRow?.updated_at ?? null;
  const calcStale = !!calcAt && !!eightRow?.updated_at && has8A({ source: '8A', period: eightRow.period_month, status: eightRow.status, summary: eightRow.summary, updatedAt: eightRow.updated_at })
    && Date.parse(eightRow.updated_at) > Date.parse(calcAt);
  return { rows, calc: calcRow?.summary ?? null, calcAt, calcStale };
}

const fyOf = (month: string): string => {
  if (!/^\d{2}\/\d{4}$/.test(month || '')) throw new Error('Pick a month of the financial year first.');
  return fyOfPeriod(month);
};

/** GSTR-9 Table 8A as the portal computed it, from a pulled GSTR9_CALC; null when not pulled or unreadable. */
const portal8AOf = (calc: unknown, fy: string, at: string | null = null, stale = false): Portal8ATotal | null => {
  if (!calc) return null;
  try {
    const p = parseGstr9Calc(calc, fy);
    const on = at ? new Date(at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : null;
    const note = `From the GSTR-9 system-computed figures (GSTR-9 pull${on ? `, ${on}` : ''}).`
      + (stale ? ' Pulled before the 8A file above, so it may not hold the 8A as it is now: Pull refreshes it.' : '');
    return p.found.t8A ? { igst: p.gstr9.t8A.i, cgst: p.gstr9.t8A.c, sgst: p.gstr9.t8A.s, cess: p.gstr9.t8A.x, note } : null;
  } catch {
    return null;
  }
};

/**
 * A pulled 8A (the portal's file as it came) → the stored 8A the reports read.
 * One the file cannot give is read as a failed pull, so the 8A is rebuilt and
 * the report says why.
 */
async function readPulled8A(rows: StatementRow[], gstin: string | null, fy: string): Promise<StatementRow[]> {
  return Promise.all(rows.map(async (r) => {
    if (r.source !== '8A' || !isPulled8A(r.summary)) return r;
    const got = await read8APull(r.summary, { gstin, fy });
    return got.stored
      ? { ...r, summary: got.stored as unknown as StatementRow['summary'] }
      : { ...r, status: `PULL FAILED: the pulled 8A could not be read (${got.problems.join('; ')})`, summary: {} };
  }));
}

async function yearOf(clientId: string, month: string): Promise<{ st: FyStatements; client: { name: string; gstin: string | null }; calc: unknown | null; calcAt: string | null; calcStale: boolean; fy: string }> {
  const fy = fyOf(month);
  const [client, year] = await Promise.all([fetchClient(clientId), loadYear(clientId, fy)]);
  const rows = await readPulled8A(year.rows, client.gstin || null, fy);
  const st = assembleFy({ fy, rows, today: istToday() });
  return { st, client: { name: client.name, gstin: client.gstin || null }, calc: year.calc, calcAt: year.calcAt, calcStale: year.calcStale, fy };
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
  const { st, client, calc, calcAt, calcStale, fy } = await yearOf(clientId, month);
  const anyReady = (side: FyStatements['twoA']) => [...side.metas.entries()].some(([p, m]) => st.window.includes(p) && m.state === 'ready');
  if (!anyReady(st.twoA) && !anyReady(st.twoB)) {
    throw new Error(`No GSTR-2A or GSTR-2B of FY ${fy} is pulled for ${client.name}. Use Pull on this report: it fetches the year's 2A and 2B.`);
  }
  const portal8A = portal8AOf(calc, fy, calcAt, calcStale);
  // A calculation older than the 8A file is shown, never held to.
  return threeWayReportTable(reconcileThreeWay(st, calcStale ? null : portal8A), st, { client, portal8A });
};

// ── Pull: the year's 2A and 2B that are missing, then GSTR-9 ────────────────

export interface FyPlanInput {
  fys: string[];
  rows: StatementRow[];
  /** FYs whose GSTR-9 system figures are already pulled (and not older than the 8A saved). */
  calcPulled: Set<string>;
  /** FYs whose 8A document details are saved (uploaded, or pulled with a file or as empty); absent = none known. */
  eightAHave?: Set<string>;
  today: string;
  extVersion: string | null;
}

/**
 * For each year, from extension 0.18.0 on (the firm, 25 Oct 2026: "fetch the
 * 8A straight from GSTR-9"):
 * - no 8A saved for a year that has ended: the 8A document details first,
 *   then the window's missing 2A and 2B, then GSTR-9's system figures;
 * - the 8A saved: the missing 2A and 2B, then the system figures when not
 *   pulled or pulled before the 8A;
 * - nothing missing: the 8A again (the portal updates it until the October
 *   after the year), then the system figures; never the last six months of
 *   2A and 2B again.
 * An older extension, or a year not ended: the 2A and 2B of every window month
 * that is due and not usable, then the system figures, then the last six
 * months again (planFy2a2bJobs), with a note to update or upload.
 */
export function planFyPullJobs(input: FyPlanInput): PullPlan {
  const { fys, today, extVersion, eightAHave } = input;
  const ended = (fy: string) => today >= `${fyStartYear(fy) + 1}-04-01`;
  const endedFys = fys.filter(ended);
  if (!eightAHave || !endedFys.length) return planFy2a2bJobs(input);
  const need8A = endedFys.filter((fy) => !eightAHave.has(fy));
  if (!extVersion || compareVersions(extVersion, EIGHT_A_PULL_VERSION) < 0) {
    const base = planFy2a2bJobs(input);
    if (!need8A.length) return base;
    const tip = `Extension ${EIGHT_A_PULL_VERSION} pulls the 8A document details by itself; until then the 8A is rebuilt from the 2B (or use Upload 8A).`;
    return { ...base, note: base.note ? `${base.note} ${tip}` : tip };
  }
  const missing = planFy2a2bJobs({ ...input, missingOnly: true });
  const calc = endedFys.filter((fy) => !input.calcPulled.has(fy));
  const calcJob: PullJob[] = calc.length ? [{ mode: 'gstr9_pull', periods: calc.map(eightAPeriod) }] : [];
  if (need8A.length) {
    return {
      jobs: [{ mode: 'gstr9_8a_pull', periods: need8A.map(eightAPeriod) }, ...missing.jobs, ...calcJob],
      note: "Pulling the portal's Table 8A document details from GSTR-9 first.",
    };
  }
  if (missing.jobs.length) return { jobs: [...missing.jobs, ...calcJob], note: missing.note };
  if (calcJob.length) return { jobs: calcJob, note: "The 8A, 2A and 2B of the year are saved; pulling GSTR-9's system figures (Table 8A as the portal computed it)." };
  return {
    jobs: [{ mode: 'gstr9_8a_pull', periods: endedFys.map(eightAPeriod) }],
    note: "Everything of the year is saved; fetching the portal's Table 8A document details again (the portal updates them until the October after the year).",
  };
}

function planFy2a2bJobs({ fys, rows, calcPulled, today, extVersion, missingOnly }: FyPlanInput & { missingOnly?: boolean }): PullPlan {
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
  if (!want.size && missingOnly) return { jobs: [] };
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

/** A saved 8A to read: an upload, or a pull that brought a file or JSON, or the portal's word that there is none. */
export const has8A = (row: StatementRow | undefined): boolean => {
  if (!row) return false;
  if (isStored8A(row.summary)) return true;
  if (isPulled8A(row.summary)) return row.summary.files.length > 0 || row.summary.json.length > 0 || !!row.summary.empty;
  return false;
};

export const planGstr8aPull = async ({ clientId, periods, extVersion }: { clientId: string; periods: string[]; extVersion: string | null }): Promise<PullPlan> => {
  const fys = [...new Set(periods.filter((p) => /^\d{2}\/\d{4}$/.test(p)).map(fyOfPeriod))];
  const loaded = await Promise.all(fys.map((fy) => loadYear(clientId, fy)));
  const calcPulled = new Set(fys.filter((_, i) => !!loaded[i].calc && !loaded[i].calcStale));
  const eightAHave = new Set(fys.filter((fy, i) => has8A(loaded[i].rows.find((r) => r.source === '8A' && r.period === eightAPeriod(fy)))));
  return planFyPullJobs({ fys, rows: loaded.flatMap((y) => y.rows), calcPulled, eightAHave, today: istToday(), extVersion });
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
