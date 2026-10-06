// Shared pieces of the evidence recipes: lookups over the pulled data, the
// month-by-month timing match, readiness and the fetch plan, the notice's own
// figures, and the per-head summary. Pure (no database, no clock).
import { pnum } from '@/lib/gstr9/portalParser';
import type {
  AnnexureColumn, AnnexureStatus, AnnexureSummary, ClientLite, FetchPlanItem, FiledReturn, FiledType, Head, HeadAmounts,
  HeadLine, PortalData, ReadinessCell, ReadinessSource, RecipeContext, ReadyState, SourceKey, SourceRef, SummaryLine,
} from '../types';
import { HEAD_LABEL, HEADS } from '../types';
import {
  classifyFiled, classifyStatement, isZeroHeads, parseGstr1, parseGstr2a, parseGstr2b, parseGstr3b, r2, zeroHeads,
  type Gstr1Figures, type Gstr2bParsed, type Gstr3bFigures, type PortalDoc, type RowState,
} from '../portal';
import { dueDateIso, fyLong, fyMarch, fyMonths, fyOfPeriod, periodLabel, periodsLabel, sortPeriods } from '../periods';

/** A difference of ₹10 or less in a head is a match (docs/GSTR9_9C_WORKINGS.md §6.15). */
export const TOLERANCE = 10;
/** Bump when a recipe's logic changes, so saved annexures are rebuilt as a new version. */
export const RECIPE_VERSION = 1;

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** "₹12,34,567" — whole rupees, for sentences. */
export const rupees = (n: number): string => `${n < 0 ? '−' : ''}₹${INR.format(Math.abs(Math.round(n)))}`;

export const FILED_LABEL: Record<FiledType, string> = {
  GSTR1: 'GSTR-1', GSTR3B: 'GSTR-3B', GSTR2B: 'GSTR-2B', GSTR2A: 'GSTR-2A', GSTR9_CALC: 'GSTR-9',
};

// ── Lookups (built once per data object) ───────────────────────────────────
export interface Lookup {
  filed: (type: FiledType, period: string) => FiledReturn | undefined;
  g3b: (period: string) => Gstr3bFigures | null;
  g1: (period: string) => Gstr1Figures | null;
  g2b: (period: string) => Gstr2bParsed | null;
  g2a: (period: string) => PortalDoc[] | null;
  state: (type: FiledType, period: string) => RowState;
}

const cache = new WeakMap<PortalData, Lookup>();

export function lookup(data: PortalData): Lookup {
  const hit = cache.get(data);
  if (hit) return hit;
  const byKey = new Map<string, FiledReturn>();
  for (const r of data.filed) byKey.set(`${r.type}|${r.period}`, r);
  const memo = new Map<string, unknown>();
  const once = <T,>(key: string, f: () => T): T => {
    if (!memo.has(key)) memo.set(key, f());
    return memo.get(key) as T;
  };
  const usable = (type: FiledType, p: string) => {
    const row = byKey.get(`${type}|${p}`);
    return row && classifyFiled(row, type).state === 'ready' ? row : undefined;
  };
  const l: Lookup = {
    filed: (type, p) => byKey.get(`${type}|${p}`),
    g3b: (p) => once(`3b|${p}`, () => { const r = usable('GSTR3B', p); return r ? parseGstr3b(r.summary) : null; }),
    g1: (p) => once(`1|${p}`, () => { const r = usable('GSTR1', p); return r ? parseGstr1(r.summary) : null; }),
    g2b: (p) => once(`2b|${p}`, () => { const r = usable('GSTR2B', p); return r ? parseGstr2b(r.summary) : null; }),
    g2a: (p) => once(`2a|${p}`, () => { const r = usable('GSTR2A', p); return r ? parseGstr2a(r.summary) : null; }),
    state: (type, p) => once(`st|${type}|${p}`, () => classifyFiled(byKey.get(`${type}|${p}`), type)),
  };
  cache.set(data, l);
  return l;
}

export const refOf = (row: FiledReturn | undefined, label?: string): SourceRef[] =>
  row ? [{ table: 'gst_filed_returns', period: row.period, label: label ?? FILED_LABEL[row.type], arn: row.arn, pulled_at: row.updatedAt, row_id: row.id }] : [];

/** One source line for a figure summed over months: the range and the latest pull. */
export function rangeRef(l: Lookup, type: FiledType, periods: string[], label?: string): SourceRef[] {
  const rows = periods.map((p) => l.filed(type, p)).filter((r): r is FiledReturn => !!r && classifyFiled(r, type).state === 'ready');
  if (!rows.length) return [];
  const latest = rows.map((r) => r.updatedAt ?? '').sort().pop() || null;
  return [{ table: 'gst_filed_returns', period: periodsLabel(rows.map((r) => r.period)), label: label ?? FILED_LABEL[type], pulled_at: latest }];
}

// ── When a return can exist ────────────────────────────────────────────────
/** The date from which a month's return can be on the portal (before it, a missing row is "not due"). */
export function availableFrom(type: FiledType, period: string, client: ClientLite): string {
  if (type === 'GSTR1') return dueDateIso(period, client.dueDay1 ?? 11);
  if (type === 'GSTR3B') return dueDateIso(period, client.dueDay2 ?? 20);
  if (type === 'GSTR2B') return dueDateIso(period, 14);
  return dueDateIso(period, 11);
}

export function cellState(l: Lookup, type: FiledType, period: string, ctx: RecipeContext): { state: ReadyState; why: string | null } {
  const s = l.state(type, period);
  if (s.state === 'not_fetched' && !l.filed(type, period) && ctx.today < availableFrom(type, period, ctx.client)) return { state: 'not_due', why: null };
  return s;
}

// ── Readiness and the fetch plan ───────────────────────────────────────────
const SOURCE_META: Record<SourceKey, { label: string; mode: string | null; scope: 'month' | 'fy' }> = {
  GSTR1: { label: 'GSTR-1', mode: 'gstr1_pull', scope: 'month' },
  GSTR3B: { label: 'GSTR-3B', mode: 'gstr3b_pull', scope: 'month' },
  GSTR2B: { label: 'GSTR-2B', mode: 'gstr2b_pull', scope: 'month' },
  GSTR2A: { label: 'GSTR-2A', mode: 'gstr2a_pull', scope: 'month' },
  RECLAIM: { label: 'Credit reversal and re-claimed statement', mode: 'revrclm_pull', scope: 'fy' },
  GSTR9: { label: 'GSTR-9', mode: 'gstr9_pull', scope: 'fy' },
  TURNOVER: { label: 'Annual turnover (typed in the app)', mode: null, scope: 'fy' },
  FILING: { label: 'Filing Status (the firm’s tracker)', mode: null, scope: 'month' },
};

export interface MonthNeed { key: 'GSTR1' | 'GSTR3B' | 'GSTR2B' | 'GSTR2A'; months: string[] }

export function monthSource(l: Lookup, ctx: RecipeContext, need: MonthNeed): ReadinessSource {
  const inPeriod = new Set(ctx.period.periods);
  const meta = SOURCE_META[need.key];
  const cells: ReadinessCell[] = sortPeriods(need.months).map((p) => {
    const row = l.filed(need.key, p);
    const s = cellState(l, need.key, p, ctx);
    return { period: p, state: s.state, status: s.why ?? row?.status ?? null, pulled_at: row?.updatedAt ?? null, arn: row?.arn ?? null, context: !inPeriod.has(p) };
  });
  return { key: need.key, label: meta.label, mode: meta.mode, scope: meta.scope, cells };
}

/** The reclaim statement for each FY ("03/YYYY" cells). */
export function reclaimSource(data: PortalData, fys: string[]): ReadinessSource {
  const cells: ReadinessCell[] = fys.map((fy) => {
    const rows = data.reclaims === null ? null : data.reclaims.filter((r) => r.financialYear === fyLong(fy));
    const s = classifyStatement(rows);
    const pulled = rows?.map((r) => r.pulledAt ?? '').sort().pop() || null;
    return { period: fyMarch(fy), state: s.state, status: s.why, pulled_at: pulled };
  });
  const meta = SOURCE_META.RECLAIM;
  return { key: 'RECLAIM', label: meta.label, mode: meta.mode, scope: 'fy', cells };
}

export function fyCellSource(key: SourceKey, cells: ReadinessCell[]): ReadinessSource {
  const meta = SOURCE_META[key];
  return { key, label: meta.label, mode: meta.mode, scope: meta.scope, cells };
}

/** What the office agent (or the extension) should fetch: not fetched or failed cells, per pull mode. */
export function fetchPlan(sources: ReadinessSource[]): FetchPlanItem[] {
  const byMode = new Map<string, FetchPlanItem>();
  for (const s of sources) {
    if (!s.mode) continue;
    const missing = s.cells.filter((c) => c.state === 'not_fetched' || c.state === 'failed').map((c) => c.period);
    if (!missing.length) continue;
    const cur = byMode.get(s.mode) ?? { mode: s.mode, label: s.label, periods: [] };
    cur.periods = sortPeriods([...cur.periods, ...missing]);
    byMode.set(s.mode, cur);
  }
  return [...byMode.values()];
}

export const STATE_WORDS: Record<ReadyState, string> = {
  ready: 'ready', not_fetched: 'not fetched', not_filed: 'not filed', failed: 'pull failed', not_due: 'not due yet',
};

/** "GSTR-3B not fetched" / "GSTR-2B not generated" for a month that could not be compared. */
export function missingWords(type: FiledType, state: ReadyState, why?: string | null): string {
  if (state === 'not_filed') return `${FILED_LABEL[type]} ${type === 'GSTR2B' ? 'not generated' : 'not filed'}`;
  if (state === 'failed') return `${FILED_LABEL[type]} ${why && /TTL_LIAB/.test(why) ? 'unreadable (no total liability)' : 'pull failed'}`;
  if (state === 'not_due') return `${FILED_LABEL[type]} not due yet`;
  return `${FILED_LABEL[type]} not fetched`;
}

// ── Months of the FYs a period touches ─────────────────────────────────────
/** Every started month of the FYs the period touches (the period plus its FY context). */
export function fyContextMonths(periods: string[], today: string): string[] {
  const fys = [...new Set(periods.map(fyOfPeriod))];
  return sortPeriods(fys.flatMap(fyMonths)).filter((p) => `${p.slice(3)}-${p.slice(0, 2)}-01` <= today);
}

// ── Matching a difference against later / earlier months (timing) ──────────
export interface FifoOut {
  period: string;
  diff: number;
  /** Earlier months whose opposite difference settled this one. */
  coveredBy: { period: string; amount: number }[];
  /** Later months whose opposite difference settled this one. */
  reversedBy: { period: string; amount: number }[];
  /** The positive difference left open at the end. */
  residual: number;
  /** For a negative month: the positive months it settled. */
  applied: { period: string; amount: number }[];
  /** The negative difference left unused at the end. */
  unused: number;
}

/**
 * First in, first out within one head and one financial year: a positive
 * difference (short paid / ITC above 2B / credit above tax) is settled by the
 * earliest opposite difference — before it ("paid earlier") or after it
 * ("reversed later"). What stays open at the year end is the residual.
 */
export function fifo(rows: { period: string; diff: number }[]): Map<string, FifoOut> {
  const out = new Map<string, FifoOut>();
  const pos: { period: string; left: number }[] = [];
  const neg: { period: string; left: number }[] = [];
  const eps = 0.005;
  for (const r of rows) out.set(r.period, { period: r.period, diff: r.diff, coveredBy: [], reversedBy: [], residual: 0, applied: [], unused: 0 });
  for (const r of rows) {
    const me = out.get(r.period) as FifoOut;
    if (r.diff > eps) {
      let amt = r.diff;
      while (amt > eps && neg.length) {
        const n = neg[0];
        const x = Math.min(amt, n.left);
        me.coveredBy.push({ period: n.period, amount: x });
        (out.get(n.period) as FifoOut).applied.push({ period: r.period, amount: x });
        n.left -= x; amt -= x;
        if (n.left <= eps) neg.shift();
      }
      if (amt > eps) pos.push({ period: r.period, left: amt });
    } else if (r.diff < -eps) {
      let amt = -r.diff;
      while (amt > eps && pos.length) {
        const p = pos[0];
        const x = Math.min(amt, p.left);
        (out.get(p.period) as FifoOut).reversedBy.push({ period: r.period, amount: x });
        me.applied.push({ period: p.period, amount: x });
        p.left -= x; amt -= x;
        if (p.left <= eps) pos.shift();
      }
      if (amt > eps) neg.push({ period: r.period, left: amt });
    }
  }
  for (const p of pos) (out.get(p.period) as FifoOut).residual = p.left;
  for (const n of neg) (out.get(n.period) as FifoOut).unused = n.left;
  return out;
}

export interface Wording { positive: string; negative: string; covered: string; reversed: string; settles: string; open: string }

const monthsWords = (xs: { period: string; amount: number }[]) =>
  xs.filter((x) => x.amount > TOLERANCE).map((x) => `${periodLabel(x.period)} ${rupees(x.amount)}`).join(', ');

/** "IGST short ₹12,000; paid in Sep 2023 ₹12,000 (timing)" — one phrase per head with a difference. */
export function treatment(perHead: Partial<Record<Head, FifoOut>>, heads: Head[], w: Wording): string {
  const parts: string[] = [];
  for (const h of heads) {
    const f = perHead[h];
    if (!f || Math.abs(f.diff) <= TOLERANCE) continue;
    if (f.diff > 0) {
      const bits = [`${HEAD_LABEL[h]} ${w.positive} ${rupees(f.diff)}`];
      const c = monthsWords(f.coveredBy);
      const r = monthsWords(f.reversedBy);
      if (c) bits.push(`${w.covered} ${c}`);
      if (r) bits.push(`${w.reversed} ${r}`);
      if (f.residual > TOLERANCE) bits.push(`${rupees(f.residual)} ${w.open}`);
      parts.push(bits.join('; '));
    } else {
      const bits = [`${HEAD_LABEL[h]} ${w.negative} ${rupees(-f.diff)}`];
      const a = monthsWords(f.applied);
      if (a) bits.push(`${w.settles} ${a}`);
      parts.push(bits.join('; '));
    }
  }
  return parts.length ? parts.join(' · ') : 'Matches (within ₹10 per head)';
}

// ── Heads shown ────────────────────────────────────────────────────────────
/** Heads with any figure; IGST / CGST / SGST when everything is zero (a filed zero still shows). */
export function activeHeads(...sets: HeadAmounts[]): Head[] {
  const hs = HEADS.filter((h) => sets.some((s) => Math.abs(s[h]) > 0.005));
  return hs.length ? hs : ['igst', 'cgst', 'sgst'];
}

export const headColumns = (prefix: string, group: string, heads: Head[]): AnnexureColumn[] =>
  heads.map((h) => ({ key: `${prefix}_${h}`, label: HEAD_LABEL[h], kind: 'money' as const, group }));

export const headCells = (prefix: string, heads: Head[], v: HeadAmounts): Record<string, number> =>
  Object.fromEntries(heads.map((h) => [`${prefix}_${h}`, r2(v[h])]));

// ── The notice's own figures ───────────────────────────────────────────────
export type DemandPart = 'tax' | 'interest' | 'fee';

export interface NoticeFigures {
  perHead: HeadAmounts | null;
  total: number | null;
  basis: string | null;
  /** The figure is of the same kind as what the recipe computes (so "explained" means something). */
  comparable: boolean;
}

const demandHeads = (demand: unknown, part: DemandPart): HeadAmounts | null => {
  if (!demand || typeof demand !== 'object' || Array.isArray(demand)) return null;
  const d = demand as Record<string, unknown>;
  const o = zeroHeads();
  let any = false;
  for (const h of HEADS) {
    const row = d[h];
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const v = pnum((row as Record<string, unknown>)[part]);
      if (v) any = true;
      o[h] = v;
    }
  }
  return any ? o : null;
};

export function noticeFigures(ctx: RecipeContext, part: DemandPart): NoticeFigures {
  const words = part === 'tax' ? 'tax' : part;
  if (ctx.issue) {
    const ph = demandHeads(ctx.issue.demand, part);
    if (ph) return { perHead: ph, total: r2(HEADS.reduce((s, h) => s + ph[h], 0)), basis: `Issue ${ctx.issue.seq}: ${words} by head`, comparable: true };
    if (ctx.issue.amount > 0) return { perHead: null, total: ctx.issue.amount, basis: `Issue ${ctx.issue.seq}: amount (not split by head)`, comparable: true };
    if (!ctx.useNoticeDemand) return { perHead: null, total: null, basis: null, comparable: false };
  }
  if (ctx.useNoticeDemand) {
    const ph = demandHeads(ctx.notice.demand, part);
    if (ph) return { perHead: ph, total: r2(HEADS.reduce((s, h) => s + ph[h], 0)), basis: `The notice: ${words} by head`, comparable: true };
    const tot = ctx.notice.demandTotal ?? ctx.notice.amountOfDemand;
    // An intimation (DRC-01B / 01C) states only the difference in tax; other notices' totals mix tax, interest and penalty.
    const taxOnly = part === 'tax' && (ctx.notice.formCode === 'DRC-01B' || ctx.notice.formCode === 'DRC-01C');
    if (tot && tot > 0) return { perHead: null, total: tot, basis: taxOnly ? 'The notice: amount of the difference' : 'The notice: total demand (all components)', comparable: taxOnly };
  }
  return { perHead: null, total: null, basis: null, comparable: false };
}

// ── Summary ────────────────────────────────────────────────────────────────
/** Per head: notice vs computed vs difference, explained (notice − to pay) and to pay. */
export function buildHeads(shown: Head[], fig: NoticeFigures, computed: HeadAmounts, toPay: HeadAmounts): {
  lines: HeadLine[]; explainedTotal: number | null; toPayTotal: number; computedTotal: number;
} {
  // A head the notice names stays in, even when the returns show nothing in it.
  const heads = HEADS.filter((h) => shown.includes(h) || (!!fig.perHead && Math.abs(fig.perHead[h]) > 0.005));
  const lines: HeadLine[] = heads.map((h) => {
    const n = fig.perHead ? r2(fig.perHead[h]) : null;
    return {
      head: h,
      notice: n,
      computed: r2(computed[h]),
      difference: n === null ? null : r2(n - computed[h]),
      explained: n === null || !fig.comparable ? null : r2(Math.max(0, n - toPay[h])),
      to_pay: r2(toPay[h]),
    };
  });
  const toPayTotal = r2(heads.reduce((s, h) => s + toPay[h], 0));
  const computedTotal = r2(heads.reduce((s, h) => s + computed[h], 0));
  let explainedTotal: number | null = null;
  if (fig.comparable) {
    if (fig.perHead) explainedTotal = r2(lines.reduce((s, l) => s + (l.explained ?? 0), 0));
    else if (fig.total !== null) explainedTotal = r2(Math.max(0, fig.total - toPayTotal));
  }
  return { lines, explainedTotal, toPayTotal, computedTotal };
}

/** A residual per head after the ₹10 tolerance (heads never netted). */
export const toPayOf = (residual: HeadAmounts): HeadAmounts => {
  const o = zeroHeads();
  for (const h of HEADS) o[h] = residual[h] > TOLERANCE ? r2(residual[h]) : 0;
  return o;
};

export const line = (label: string, values: HeadAmounts, kind: SummaryLine['kind'] = 'figure', note?: string): SummaryLine =>
  ({ label, values: Object.fromEntries(HEADS.map((h) => [h, r2(values[h])])), kind, ...(note ? { note } : {}) });

export function emptySummary(headline: string, computedLabel: string): AnnexureSummary {
  return {
    headline, computed_label: computedLabel, heads: [], lines: [], notice_total: null, notice_basis: null,
    computed_total: 0, to_pay_total: 0, explained_total: null, notes: [], missing: [],
  };
}

/** ready: everything compared; partial: something missing; needs_data: nothing in the period compared. */
export function statusOf(periodCompared: number, periodTotal: number, anyMissing: boolean): AnnexureStatus {
  if (!periodTotal || !periodCompared) return 'needs_data';
  return anyMissing || periodCompared < periodTotal ? 'partial' : 'ready';
}

export const nonZero = (v: HeadAmounts): boolean => !isZeroHeads(v);
export const fmtHeadsWords = (v: HeadAmounts, heads: Head[] = HEADS): string =>
  heads.filter((h) => Math.abs(v[h]) > TOLERANCE).map((h) => `${HEAD_LABEL[h]} ${rupees(v[h])}`).join(', ');

/** The source references a recipe hashes: what each row was, when it was pulled. */
export function inputsOf(l: Lookup, types: FiledType[], months: string[]): unknown[] {
  const out: unknown[] = [];
  for (const t of types) for (const p of sortPeriods(months)) {
    const r = l.filed(t, p);
    out.push(r ? [t, p, r.id, r.updatedAt, r.status, r.arn, r.filedDate] : [t, p, null]);
  }
  return out;
}
