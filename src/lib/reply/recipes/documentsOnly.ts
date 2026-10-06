// Recipes that cannot be computed from the portal figures the app holds return
// "needs data" with the documents the issue code lists — never a guessed
// figure: blocked credits (s.17(5)) need the expense ledgers, cancelled
// suppliers need each supplier's cancellation date (the extension's GSTR-2A
// pull does not keep it). Also the "needs a period" answer every recipe gives
// when the notice states no tax period.
import type { PortalData, RecipeContext, RecipeKey, RecipeResult } from '../types';
import { PERIOD_SOURCE_WORDS } from '../periods';
import { emptySummary, RECIPE_VERSION } from './common';

const base = (ctx: RecipeContext, recipe: RecipeKey, title: string, headline: string, notes: string[], documents = ctx.documents): RecipeResult => ({
  recipe,
  status: 'needs_data',
  title,
  periods: ctx.period.periods,
  financialYear: ctx.period.financialYear,
  summary: { ...emptySummary(headline, '—'), notes, documents },
  tables: [],
  readiness: { period: ctx.period, sources: [], plan: [], notes: [`Period ${PERIOD_SOURCE_WORDS[ctx.period.source]}.`] },
  explained: null,
  toPay: null,
  inputs: { v: RECIPE_VERSION, recipe, periods: ctx.period.periods, documents: ctx.documents },
});

/** The notice states no tax period: say so, and let staff set it. */
export function needsPeriod(ctx: RecipeContext, title: string): RecipeResult {
  return base(ctx, ctx.recipe, title,
    'This notice has no tax period on record. Set the period the notice covers (from / to month) and the evidence builds itself.',
    ['DRC-01B and DRC-01C are always for a tax period; the portal reader fills it when the case folder carries it.'], []);
}

export function itc175(ctx: RecipeContext, _data: PortalData): RecipeResult {
  return base(ctx, 'itc_17_5', 'Blocked credit (s.17(5))',
    'Blocked credit cannot be worked out from the returns: GSTR-3B and GSTR-2B do not say what each purchase was for. It needs the documents below.',
    ['Table 4B(1) of GSTR-3B shows only what was reversed, not what should have been.']);
}

export function cancelledSuppliers(ctx: RecipeContext, _data: PortalData): RecipeResult {
  return base(ctx, 'cancelled_suppliers', 'Credit from suppliers whose registration was cancelled',
    'The portal data the app holds does not carry each supplier’s cancellation date, so the affected invoices cannot be listed. It needs the documents below.',
    ['The office agent’s GSTR-2A pull keeps each supplier’s invoices but not the cancellation date the portal shows beside them.']);
}

/** An issue code with no recipe (turnover mismatch, e-way bills, registration…). */
export function noRecipe(ctx: RecipeContext, title: string): RecipeResult {
  return base(ctx, ctx.recipe, title, 'There is no automatic working for this issue. It needs the documents below.', []);
}
