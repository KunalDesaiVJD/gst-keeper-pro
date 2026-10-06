// Evidence recipes (roadmap Phase 4 "Evidence recipes"; audit R-10, R-23):
// what the rest of the app uses. Pure core in recipes/ (verified by
// scripts/verify-reply-recipes.mjs); database access in load.ts / build.ts;
// exports in export.ts (import it dynamically — it pulls in xlsx and jsPDF).
export * from './types';
export { resolvePeriod, periodsLabel, periodLabel, fyOfPeriod, fyMonths, normalizeFy, PERIOD_SOURCE_WORDS, monthRange, isPeriod } from './periods';
export { planRecipes, runRecipe, inputsHash, FORM_DEFAULTS, RECIPE_TITLES, isRecipeKey, loadNeeds } from './registry';
export { computeEvidence, cardKey, type EvidenceCard, type EvidenceInputs } from './evidence';
export { loadEvidence, loadAnnexureVersion, loadSavedAnnexures, type EvidenceBundle, type SavedAnnexure } from './load';
export {
  buildEvidenceForNotice, buildEvidenceForNotices, saveCard, saveCards, needsSave, currentOf, setNoticePeriod, queueMissing, mergePlans,
  type BuildOutcome, type QueueOutcome,
} from './build';
export { STATE_WORDS, TOLERANCE, RECIPE_VERSION } from './recipes/common';
