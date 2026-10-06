// From a notice and the portal data to its evidence cards — pure, so the
// Evidence tab, the batch builder and scripts/verify-reply-recipes.mjs all run
// the same thing.
import type { ClientLite, IssueLite, IssueTypeLite, NoticeLite, PlannedRecipe, PortalData, RecipeContext, RecipeKey, RecipeResult } from './types';
import { contextFor, inputsHash, planRecipes, runRecipe, type Plan } from './registry';

export interface EvidenceInputs {
  notice: NoticeLite;
  client: ClientLite;
  issues: IssueLite[];
  types: IssueTypeLite[];
  linkedDrc03: string[];
  data: PortalData;
  today: string;
}

export interface EvidenceCard {
  key: string;
  plan: PlannedRecipe;
  ctx: RecipeContext;
  result: RecipeResult;
  hash: string;
}

export const cardKey = (recipe: RecipeKey, issueId: string | null | undefined) => `${recipe}|${issueId ?? ''}`;

export function contextsOf(inp: Omit<EvidenceInputs, 'data'>, plan: Plan = planRecipes(inp.notice, inp.issues, inp.types)): { plan: Plan; ctxs: RecipeContext[] } {
  return { plan, ctxs: plan.planned.map((p) => contextFor(p, plan, inp.notice, inp.client, inp.linkedDrc03, inp.today)) };
}

export function computeEvidence(inp: EvidenceInputs): { cards: EvidenceCard[]; uncovered: Plan['uncovered'] } {
  const { plan, ctxs } = contextsOf(inp);
  const cards = plan.planned.map((p, i) => {
    const ctx = ctxs[i];
    const result = runRecipe(ctx, inp.data);
    return { key: cardKey(p.recipe, p.issue?.id), plan: p, ctx, result, hash: inputsHash(ctx, result) };
  });
  return { cards, uncovered: plan.uncovered };
}
