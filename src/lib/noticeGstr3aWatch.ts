// GSTR-3A to ASMT-13 watch (the law audit of 26 October 2026, section C). A
// GSTR-3A is the notice to a return defaulter (s.46): if the return is not
// filed within 15 days of it, the officer may assess the tax to the best of
// judgement in ASMT-13 (s.62(1)); an ASMT-13 is deemed withdrawn when the return
// is filed within 60 days of it (s.62(2)). The portal's GSTR-3A names no return
// or period, so the period is read as the month before the notice's month (the
// portal issues it a few days after the GSTR-3B's due date), and the returns are
// those Filing Status holds for that month. Pure. GSTR-3A notices stay hidden
// everywhere else (Notice types). §36 of docs/NOTICES_LITIGATION_POSITIONS.md.

export interface Gstr3aNotice { id: string; client_id: string; issue_date: string; reference_number: string | null }
export interface FilingRow { client_id: string; period_month: string; return_type: string; status: string | null }
export interface Asmt13Row { id: string; client_id: string; issue_date: string | null }

export type WatchState = 'within_15' | 'asmt13_can_issue' | 'asmt13_issued';
export interface WatchRow {
  notice: Gstr3aNotice;
  period: string;
  pending: string[];
  state: WatchState;
  /** Within 15 days: the last day before ASMT-13 can issue; after an ASMT-13: the last day to file and have it withdrawn. */
  date: string;
  asmt13: Asmt13Row | null;
}

const WATCHED = new Set(['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-3B', 'GSTR-3B (Q)']);
const DONE = new Set(['Filed', 'Not to File']);

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** The return period a GSTR-3A is read as being for: the month before its own. */
export function gstr3aPeriod(issue: string): string {
  const [y, m] = issue.slice(0, 10).split('-').map(Number);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  return `${String(pm).padStart(2, '0')}/${py}`;
}

export function gstr3aWatch(notices: Gstr3aNotice[], filings: FilingRow[], asmt13: Asmt13Row[], today: string): WatchRow[] {
  const byKey = new Map<string, FilingRow[]>();
  for (const f of filings) {
    if (!WATCHED.has(f.return_type)) continue;
    const k = `${f.client_id}|${f.period_month}`;
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  const out: WatchRow[] = [];
  const seen = new Set<string>();
  for (const n of [...notices].sort((a, b) => b.issue_date.localeCompare(a.issue_date))) {
    const period = gstr3aPeriod(n.issue_date);
    const k = `${n.client_id}|${period}`;
    if (seen.has(k)) continue; // one row per client and period, the latest notice
    seen.add(k);
    const pending = (byKey.get(k) ?? []).filter((f) => !DONE.has(f.status ?? '')).map((f) => f.return_type).sort();
    if (!pending.length) continue;
    const a = asmt13.filter((x) => x.client_id === n.client_id && x.issue_date && x.issue_date >= n.issue_date)
      .sort((x, y) => (x.issue_date ?? '').localeCompare(y.issue_date ?? ''))[0] ?? null;
    const mark = addDays(n.issue_date, 15);
    if (a?.issue_date) out.push({ notice: n, period, pending, state: 'asmt13_issued', date: addDays(a.issue_date, 60), asmt13: a });
    else out.push({ notice: n, period, pending, state: today <= mark ? 'within_15' : 'asmt13_can_issue', date: mark, asmt13: null });
  }
  const rank: Record<WatchState, number> = { asmt13_issued: 0, asmt13_can_issue: 1, within_15: 2 };
  return out.sort((x, y) => rank[x.state] - rank[y.state] || x.date.localeCompare(y.date));
}
