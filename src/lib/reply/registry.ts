// Which recipes answer a notice: one per coded issue (reply_issue_types.
// recipe_key), else the form's default (DRC-01B → GSTR-1 v 3B, DRC-01C → 3B v
// 2B, ASMT-10 / DRC-01A → the year at a glance, GSTR-3A → filing status) — and
// what each needs loaded. Running a recipe never throws: a failure is an
// annexure with status "failed" and the reason.
import type {
  ClientLite, IssueLite, IssueTypeLite, NoticeLite, PlannedRecipe, PortalData, RecipeContext, RecipeKey, RecipeResult, FiledType,
} from './types';
import { fyContextMonths, RECIPE_VERSION, emptySummary } from './recipes/common';
import { fyMonths, fysOf, periodIndex, resolvePeriod, sortPeriods, PERIOD_SOURCE_WORDS } from './periods';
import { hashOf } from './hash';
import { gstr1Vs3b } from './recipes/liability';
import { gstr3bVs2a, gstr3bVs2b } from './recipes/itc';
import { fySummary } from './recipes/fySummary';
import { rcm } from './recipes/rcm';
import { interest } from './recipes/interest';
import { lateFee } from './recipes/lateFee';
import { itc164 } from './recipes/itc164';
import { filingStatus } from './recipes/filing';
import { cancelledSuppliers, itc175 } from './recipes/documentsOnly';
import { rule42 } from './recipes/rule42';
import { gstr9Vs3b } from './recipes/gstr9';

export const RECIPE_TITLES: Record<RecipeKey, string> = {
  gstr1_vs_3b: 'GSTR-1 v GSTR-3B: output tax',
  gstr3b_vs_2b: 'GSTR-3B v GSTR-2B: input tax credit',
  gstr3b_vs_2a: 'GSTR-3B v GSTR-2A: input tax credit',
  fy_summary: 'The year at a glance: liability, ITC and reverse charge',
  rcm: 'Reverse charge: credit v tax paid',
  interest: 'Interest on late GSTR-3B (s.50)',
  late_fee: 'Late fee on late returns (s.47)',
  itc_16_4: 'ITC after the s.16(4) time limit',
  filing_status: 'Return filing status',
  itc_17_5: 'Blocked credit (s.17(5))',
  cancelled_suppliers: 'Credit from suppliers whose registration was cancelled',
  rule_42: 'Rule 42 reversal of common credit',
  gstr9_vs_3b: 'GSTR-9 v GSTR-3B: tax payable v declared',
};

const RUN: Record<RecipeKey, (ctx: RecipeContext, data: PortalData) => RecipeResult> = {
  gstr1_vs_3b: gstr1Vs3b,
  gstr3b_vs_2b: gstr3bVs2b,
  gstr3b_vs_2a: gstr3bVs2a,
  fy_summary: fySummary,
  rcm,
  interest,
  late_fee: lateFee,
  itc_16_4: itc164,
  filing_status: filingStatus,
  itc_17_5: itc175,
  cancelled_suppliers: cancelledSuppliers,
  rule_42: rule42,
  gstr9_vs_3b: gstr9Vs3b,
};

export const isRecipeKey = (k: string | null | undefined): k is RecipeKey => !!k && k in RUN;

/** The form's own recipe when the notice has no coded issue. */
export const FORM_DEFAULTS: Record<string, RecipeKey> = {
  'DRC-01B': 'gstr1_vs_3b',
  'DRC-01C': 'gstr3b_vs_2b',
  'ASMT-10': 'fy_summary',
  'DRC-01A': 'fy_summary',
  'GSTR-3A': 'filing_status',
};
/** Forms about one comparison: their single uncoded issue is what the default recipe answers. */
const SINGLE_ISSUE_FORMS = new Set(['DRC-01B', 'DRC-01C']);

export interface Plan {
  planned: PlannedRecipe[];
  /** Coded issues no recipe answers (turnover mismatch, e-way bills, registration…), with their documents. */
  uncovered: { issue: IssueLite; type: IssueTypeLite | null }[];
}

export function planRecipes(notice: NoticeLite, issues: IssueLite[], types: IssueTypeLite[]): Plan {
  const typeOf = new Map(types.map((t) => [t.code, t]));
  const planned: PlannedRecipe[] = [];
  const uncovered: Plan['uncovered'] = [];
  const seen = new Set<string>();
  const single = issues.length === 1;
  for (const issue of issues) {
    if (!issue.issueCode) continue;
    const t = typeOf.get(issue.issueCode) ?? null;
    const key = t?.recipeKey ?? null;
    if (!isRecipeKey(key)) { uncovered.push({ issue, type: t }); continue; }
    const id = `${key}|${issue.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    planned.push({ recipe: key, issue, reason: `Issue ${issue.seq}: ${t?.title ?? issue.issueCode}`, useNoticeDemand: single, documents: t?.documents ?? [] });
  }
  const form = notice.formCode ?? '';
  if (!planned.length && FORM_DEFAULTS[form]) {
    const key = FORM_DEFAULTS[form];
    const uncoded = issues.filter((i) => !i.issueCode);
    const issue = SINGLE_ISSUE_FORMS.has(form) && issues.length === 1 && uncoded.length === 1 ? uncoded[0] : null;
    const docs = types.find((t) => t.recipeKey === key && t.forms.includes(form))?.documents ?? types.find((t) => t.recipeKey === key)?.documents ?? [];
    planned.push({ recipe: key, issue, reason: `What a ${form} asks (no coded issue on the notice)`, useNoticeDemand: true, documents: docs });
  }
  return { planned, uncovered };
}

export function contextFor(p: PlannedRecipe, plan: Plan, notice: NoticeLite, client: ClientLite, linkedDrc03: string[], today: string): RecipeContext {
  const money = plan.planned.filter((x) => x.recipe !== 'filing_status');
  return {
    recipe: p.recipe, notice, client, issue: p.issue, useNoticeDemand: p.useNoticeDemand,
    period: resolvePeriod({ issue: p.issue, notice, today }), today, linkedDrc03, soleRecipe: money.length === 1, documents: p.documents,
  };
}

export function runRecipe(ctx: RecipeContext, data: PortalData): RecipeResult {
  try {
    return RUN[ctx.recipe](ctx, data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      recipe: ctx.recipe, status: 'failed', title: RECIPE_TITLES[ctx.recipe], periods: ctx.period.periods, financialYear: ctx.period.financialYear,
      summary: { ...emptySummary(`The working could not be built: ${msg}`, '—'), notes: ['This is a fault in the app, not in the data; tell the lead with the notice number.'] },
      tables: [], readiness: { period: ctx.period, sources: [], plan: [], notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
      explained: null, toPay: null, inputs: { v: RECIPE_VERSION, failed: msg },
    };
  }
}

/** The hash saved as inputs_hash: the recipe, the issue and everything it read. */
export const inputsHash = (ctx: RecipeContext, r: RecipeResult): string =>
  hashOf({ recipe: ctx.recipe, issue: ctx.issue?.id ?? null, period: ctx.period.periods, inputs: r.inputs });

// ── What to load ───────────────────────────────────────────────────────────
export interface LoadNeeds {
  /** Months per return type. */
  filed: Partial<Record<FiledType, string[]>>;
  reclaimFys: string[];
  rcmStatementFys: string[];
  annualFys: string[];
  gstr9: boolean;
  filingStatus: boolean;
  drc03: boolean;
  turnover: boolean;
}

const JAN_2022 = periodIndex('01/2022');

export function loadNeeds(ctxs: RecipeContext[]): LoadNeeds {
  const n: LoadNeeds = { filed: {}, reclaimFys: [], rcmStatementFys: [], annualFys: [], gstr9: false, filingStatus: false, drc03: false, turnover: false };
  const add = (t: FiledType, ms: string[]) => { n.filed[t] = sortPeriods([...(n.filed[t] ?? []), ...ms]); };
  for (const c of ctxs) {
    const ps = c.period.periods;
    if (!ps.length) continue;
    const fyAll = fyContextMonths(ps, c.today);
    const fyOnly = fysOf(ps).flatMap(fyMonths).filter((p) => `${p.slice(3)}-${p.slice(0, 2)}-01` <= c.today);
    const ge = (m: string[]) => m.filter((p) => periodIndex(p) >= JAN_2022);
    const lt = (m: string[]) => m.filter((p) => periodIndex(p) < JAN_2022);
    const fys = fysOf(ps);
    switch (c.recipe) {
      case 'gstr1_vs_3b': add('GSTR1', fyAll); add('GSTR3B', fyAll); n.drc03 = true; break;
      case 'gstr3b_vs_2b': add('GSTR3B', ge(fyAll)); add('GSTR2B', ge(fyAll)); n.reclaimFys.push(...fys); n.drc03 = true; break;
      case 'gstr3b_vs_2a': add('GSTR3B', fyAll); add('GSTR2A', fyAll); n.reclaimFys.push(...fys); n.drc03 = true; break;
      case 'fy_summary':
        add('GSTR1', fyAll); add('GSTR3B', fyAll); add('GSTR2B', ge(fyAll)); add('GSTR2A', lt(fyAll));
        n.reclaimFys.push(...fys); n.rcmStatementFys.push(...fys); n.drc03 = true; break;
      case 'rcm': add('GSTR3B', fyAll); n.rcmStatementFys.push(...fys); break;
      case 'interest': add('GSTR3B', ps); n.filingStatus = true; break;
      case 'late_fee': add('GSTR3B', ps); add('GSTR1', ps); n.filingStatus = true; n.turnover = true; break;
      case 'itc_16_4': add('GSTR3B', ps); add('GSTR2B', ge(ps)); add('GSTR2A', lt(ps)); n.filingStatus = true; n.gstr9 = true; break;
      case 'filing_status': add('GSTR3B', ps); add('GSTR1', ps); n.filingStatus = true; n.gstr9 = true; break;
      case 'rule_42': add('GSTR3B', fyOnly); n.turnover = true; break;
      case 'gstr9_vs_3b': add('GSTR3B', fyOnly); n.annualFys.push(...fys); break;
      default: break;
    }
  }
  n.reclaimFys = [...new Set(n.reclaimFys)];
  n.rcmStatementFys = [...new Set(n.rcmStatementFys)];
  n.annualFys = [...new Set(n.annualFys)];
  return n;
}
