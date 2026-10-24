// A year's 2A or 2B against its 8A, as the reconciliation view and the Big4
// Excel / PDF show it: the same RecoViewData as 2A vs 2B (viewModel.ts), with
// each row under the month of its document's date and the report named by the
// FY. Pure.
import { fyMarch, fyMonths } from '@/lib/reply/periods';
import type { ReportTable } from '@/utils/allClientsReports';
import type { FyPairRun } from './reasons8A';
import { recoReportTable, toViewData } from './viewModel';
import type { RecoStatementView, RecoViewData } from './viewTypes';

export function fyViewData(run: FyPairRun, client: { name: string; gstin: string | null }): RecoViewData {
  const { st } = run.ctx;
  const fy = st.fy;
  const side = run.result.left.key === '2A' ? st.twoA : st.twoB;
  const march = fyMarch(fy);
  const base = toViewData(run.result, { client, period: march, left: side.metas.get(march) ?? st.eightA.meta, right: st.eightA.meta, tolerance: 1 });
  const months = fyMonths(fy);
  const monthOf = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : march);
  const rows = base.rows.map((r, i) => {
    const p = months.includes(monthOf(r.date)) ? monthOf(r.date) : march;
    return { ...r, period: p, id: `${fy}|${p}|${i}` };
  });
  // Per month: when that month's 2A was pulled (2B: generated), against the 8A's date.
  const statements: RecoStatementView[] = months.map((p) => {
    const m = side.metas.get(p);
    return {
      period: p,
      leftPulledAt: side.source === '2A' ? m?.pulledAt ?? null : m?.generatedOn ?? m?.pulledAt ?? null,
      rightGeneratedOn: st.eightA.meta.generatedOn ?? st.eightA.meta.pulledAt,
      leftState: m?.state ?? 'not_pulled',
      rightState: st.eightA.meta.state,
    };
  });
  return {
    ...base,
    periods: months.filter((p) => rows.some((r) => r.period === p)),
    rows,
    notes: base.notes.map((n) => ({ ...n, period: march })),
    statements,
    fy,
  };
}

export const fyPairTable = (run: FyPairRun, client: { name: string; gstin: string | null }, title: string): ReportTable =>
  recoReportTable(fyViewData(run, client), { title });
