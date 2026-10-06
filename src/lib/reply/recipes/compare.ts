// The month-by-month comparison behind the liability, ITC and RCM recipes:
// side A − side B per head, every month of the FYs the period touches, timing
// matched within each FY (first in, first out), a month that cannot be
// compared shown as one line, and the notice period's totals.
import type {
  AnnexureColumn, AnnexureRow, AnnexureTable, CellValue, Drc03Row, Head, HeadAmounts, PortalData, RecipeContext, SourceRef,
} from '../types';
import { HEAD_LABEL, HEADS } from '../types';
import { addHeads, r2, subHeads, zeroHeads } from '../portal';
import { fyOfPeriod, periodEndIso, periodLabel, periodOfDate, periodStartIso, periodsLabel, dateLabel, sortPeriods } from '../periods';
import { activeHeads, fifo, headCells, headColumns, rupees, TOLERANCE, treatment, type FifoOut, type Wording } from './common';

export type MonthGet =
  | { a: HeadAmounts; b: HeadAmounts; refs: SourceRef[]; extra?: Record<string, CellValue> }
  | { missing: string; refs: SourceRef[]; notDue?: boolean };

export interface CompareCore {
  heads: Head[];
  /** Months shown (the period and the rest of its FYs that are due). */
  months: string[];
  periodMonths: string[];
  compared: string[];
  periodCompared: string[];
  missing: { period: string; words: string; context: boolean }[];
  rows: Map<string, { a: HeadAmounts; b: HeadAmounts; diff: HeadAmounts }>;
  fifo: Record<Head, Map<string, FifoOut>>;
  /** Over the notice period's compared months. */
  totals: {
    a: HeadAmounts; b: HeadAmounts; diff: HeadAmounts;
    /** Σ positive differences (before timing). */
    gross: HeadAmounts;
    /** Settled by an opposite difference in another month of the same FY. */
    timing: HeadAmounts;
    /** Left open at the FY end. */
    residual: HeadAmounts;
    /** Negative differences left unused (not netted against other heads). */
    unused: HeadAmounts;
  };
  table: AnnexureTable;
}

export interface CompareSpec {
  key: string;
  title: string;
  note?: string;
  groupA: string;
  groupB: string;
  groupD: string;
  wording: Wording;
  extraColumns?: AnnexureColumn[];
}

export function compareMonthly(ctx: RecipeContext, monthsIn: string[], get: (p: string) => MonthGet, spec: CompareSpec): CompareCore {
  const inPeriod = new Set(ctx.period.periods);
  const got = new Map<string, MonthGet>();
  for (const p of monthsIn) got.set(p, get(p));
  // A context month that is not due yet is left out; a period month always shows.
  const months = sortPeriods(monthsIn.filter((p) => inPeriod.has(p) || !('missing' in (got.get(p) as MonthGet) && (got.get(p) as { notDue?: boolean }).notDue)));
  const rows = new Map<string, { a: HeadAmounts; b: HeadAmounts; diff: HeadAmounts }>();
  const missing: CompareCore['missing'] = [];
  for (const p of months) {
    const g = got.get(p) as MonthGet;
    if ('missing' in g) missing.push({ period: p, words: g.missing, context: !inPeriod.has(p) });
    else rows.set(p, { a: g.a, b: g.b, diff: subHeads(g.a, g.b) });
  }
  const compared = months.filter((p) => rows.has(p));
  const heads = activeHeads(...compared.flatMap((p) => [rows.get(p)!.a, rows.get(p)!.b]));

  // Timing: per head, per FY.
  const fifoBy = {} as Record<Head, Map<string, FifoOut>>;
  for (const h of HEADS) {
    const merged = new Map<string, FifoOut>();
    const byFy = new Map<string, { period: string; diff: number }[]>();
    for (const p of compared) {
      const fy = fyOfPeriod(p);
      byFy.set(fy, [...(byFy.get(fy) ?? []), { period: p, diff: r2(rows.get(p)!.diff[h]) }]);
    }
    for (const list of byFy.values()) for (const [k, v] of fifo(list)) merged.set(k, v);
    fifoBy[h] = merged;
  }

  const periodCompared = compared.filter((p) => inPeriod.has(p));
  const t = { a: zeroHeads(), b: zeroHeads(), diff: zeroHeads(), gross: zeroHeads(), timing: zeroHeads(), residual: zeroHeads(), unused: zeroHeads() };
  for (const p of periodCompared) {
    const r = rows.get(p)!;
    t.a = addHeads(t.a, r.a);
    t.b = addHeads(t.b, r.b);
    t.diff = addHeads(t.diff, r.diff);
    for (const h of HEADS) {
      const f = fifoBy[h].get(p);
      if (!f) continue;
      t.gross[h] += Math.max(0, f.diff);
      t.timing[h] += f.coveredBy.reduce((s, x) => s + x.amount, 0) + f.reversedBy.reduce((s, x) => s + x.amount, 0);
      t.residual[h] += f.residual;
      t.unused[h] += f.unused;
    }
  }

  // Running difference within each FY (a missing month adds nothing and shows none).
  const cumulative = new Map<string, HeadAmounts>();
  {
    let fy = '';
    let run = zeroHeads();
    for (const p of compared) {
      if (fyOfPeriod(p) !== fy) { fy = fyOfPeriod(p); run = zeroHeads(); }
      run = addHeads(run, rows.get(p)!.diff);
      cumulative.set(p, run);
    }
  }

  const allPeriod = months.every((p) => inPeriod.has(p));
  const columns: AnnexureColumn[] = [
    { key: 'month', label: 'Month', kind: 'text' },
    ...(allPeriod ? [] : [{ key: 'scope', label: 'In the notice', kind: 'text' as const }]),
    ...(spec.extraColumns ?? []),
    ...headColumns('a', spec.groupA, heads),
    ...headColumns('b', spec.groupB, heads),
    ...headColumns('d', spec.groupD, heads),
    ...headColumns('c', 'Cumulative difference in the FY', heads),
    { key: 'treatment', label: 'Treatment', kind: 'text' },
  ];
  const tableRows: AnnexureRow[] = months.map((p) => {
    const g = got.get(p) as MonthGet;
    const base: Record<string, CellValue> = { month: periodLabel(p), ...(allPeriod ? {} : { scope: inPeriod.has(p) ? 'Yes' : 'Same FY' }) };
    if ('missing' in g) return { kind: 'missing' as const, cells: { ...base, treatment: g.missing }, _source: g.refs };
    const r = rows.get(p)!;
    const per: Partial<Record<Head, FifoOut>> = {};
    for (const h of heads) per[h] = fifoBy[h].get(p);
    return {
      kind: 'data' as const,
      cells: {
        ...base, ...(g.extra ?? {}), ...headCells('a', heads, r.a), ...headCells('b', heads, r.b), ...headCells('d', heads, r.diff),
        ...headCells('c', heads, cumulative.get(p)!), treatment: treatment(per, heads, spec.wording),
      },
      _source: g.refs,
    };
  });
  if (periodCompared.length) {
    tableRows.push({
      kind: 'total',
      cells: { month: allPeriod ? 'Total' : 'Notice period', ...headCells('a', heads, t.a), ...headCells('b', heads, t.b), ...headCells('d', heads, t.diff), treatment: `${periodCompared.length} of ${ctx.period.periods.length} months compared` },
      _source: [],
    });
  }
  return {
    heads, months, periodMonths: ctx.period.periods, compared, periodCompared, missing, rows, fifo: fifoBy,
    totals: t, table: { key: spec.key, title: spec.title, note: spec.note, columns, rows: tableRows },
  };
}

// ── DRC-03 as a reconciling item ───────────────────────────────────────────
const LIABILITY_CAUSE = /gstr-?\s*1\b.*gstr-?\s*3b|liability mismatch/i;
const ITC_CAUSE = /itc mismatch|gstr-?\s*2[ab]\b.*gstr-?\s*3b/i;

export interface Drc03Pick { row: Drc03Row; counted: boolean; why: string }

/**
 * DRC-03s whose period overlaps the notice's: counted when the cause is this
 * comparison's (or the DRC-03 is linked to the notice and this is its only
 * money issue) and the portal row splits the tax by head.
 */
export function drc03For(ctx: RecipeContext, data: PortalData, kind: 'liability' | 'itc'): { picks: Drc03Pick[]; counted: HeadAmounts } {
  const ps = ctx.period.periods;
  if (!ps.length || !data.drc03) return { picks: [], counted: zeroHeads() };
  const from = periodStartIso(ps[0]);
  const to = periodEndIso(ps[ps.length - 1]);
  const linked = new Set(ctx.linkedDrc03.filter(Boolean));
  const cause = kind === 'liability' ? LIABILITY_CAUSE : ITC_CAUSE;
  const picks: Drc03Pick[] = [];
  let counted = zeroHeads();
  for (const r of data.drc03) {
    const isLinked = !!r.arn && linked.has(r.arn);
    const overlaps = !!r.periodFrom && !!r.periodTo && r.periodFrom <= to && r.periodTo >= from;
    if (!overlaps && !isLinked) continue;
    const causeMatch = cause.test(r.cause ?? '');
    let ok = causeMatch || (isLinked && ctx.soleRecipe);
    let why = causeMatch ? 'Counted: paid for this comparison' : isLinked && ctx.soleRecipe ? 'Counted: linked to this notice' : 'Not counted: paid for another cause — link it on the Payments tab if it paid this';
    if (ok && !r.heads) { ok = false; why = 'Not counted: the portal row does not split the tax by head'; }
    if (ok) counted = addHeads(counted, r.heads as HeadAmounts);
    picks.push({ row: r, counted: ok, why });
  }
  return { picks, counted };
}

export function drc03Table(picks: Drc03Pick[], heads: Head[]): AnnexureTable {
  return {
    key: 'drc03',
    title: 'DRC-03 payments for the period',
    columns: [
      { key: 'arn', label: 'ARN', kind: 'text' },
      { key: 'date', label: 'Filed on', kind: 'text' },
      { key: 'cause', label: 'Cause', kind: 'text' },
      { key: 'period', label: 'Period', kind: 'text' },
      ...heads.map((h) => ({ key: `t_${h}`, label: HEAD_LABEL[h], kind: 'money' as const, group: 'Tax paid' })),
      { key: 'counted', label: 'Counted', kind: 'text' },
    ],
    rows: picks.map((p) => ({
      kind: 'data' as const,
      cells: {
        arn: p.row.arn ?? '—', date: dateLabel(p.row.filedDate), cause: p.row.cause ?? '—',
        period: p.row.periodFrom && p.row.periodTo ? `${dateLabel(p.row.periodFrom)} – ${dateLabel(p.row.periodTo)}` : '—',
        ...Object.fromEntries(heads.map((h) => [`t_${h}`, p.row.heads ? r2(p.row.heads[h]) : null])),
        counted: p.why,
      },
      _source: [{
        table: 'gst_drc03_filings', label: 'DRC-03', arn: p.row.arn, pulled_at: p.row.updatedAt, row_id: p.row.id,
        period: p.row.periodFrom && p.row.periodTo ? `${periodLabel(periodOfDate(p.row.periodFrom))} – ${periodLabel(periodOfDate(p.row.periodTo))}` : null,
      }],
    })),
  };
}

/** One sentence for the missing months: "GSTR-3B not fetched for Jun 2023, Jul 2023." */
export function missingSentences(core: Pick<CompareCore, 'missing'>): string[] {
  const groups = new Map<string, string[]>();
  for (const m of core.missing) groups.set(m.words, [...(groups.get(m.words) ?? []), m.period]);
  return [...groups.entries()].map(([w, ps]) => `${w}: ${periodsLabel(ps)}${ps.some((p) => core.missing.find((m) => m.period === p)?.context) ? ' (incl. months outside the notice used for timing)' : ''}.`);
}

export const sumTiming = (core: CompareCore, heads: Head[]): string =>
  heads.filter((h) => core.totals.timing[h] > TOLERANCE).map((h) => `${HEAD_LABEL[h]} ${rupees(core.totals.timing[h])}`).join(', ');
