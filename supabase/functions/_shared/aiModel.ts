// The model and effort of every AI call in GST Keeper. The effort is always
// medium (the firm's rule, 25 Oct 2026). The model is Claude Sonnet 5.5 unless a
// GST Manager or the superadmin has chosen another under Reply Factory → AI →
// Claude API key (4 Nov 2026, Meet: "provide model selection as well"), from the
// list Anthropic's Models API gives for the key in use; that choice is read with
// the key (claudeKey.ts, ai_api_model_read, 20261104120000) and applies to the
// Claude API only. The Claude CLI gateway keeps Sonnet. Nothing else reads a
// model or an effort: the callers (notice-ai/claude.ts, notice-ai/cli.ts,
// agent/src/read/claude.ts) send these values or the chosen model whatever a
// request names, the database refuses any other value in ai_settings
// (20261025190000), and `node scripts/verify-ai-model.mjs` (run by
// `npm run typecheck`) fails the build when code names a model or effort
// elsewhere. agent/src/read/aiModel.ts is a copy for the office agent (which
// stays on Sonnet); the check keeps the two the same.

/** The Claude API model id used when none is chosen. */
export const AI_MODEL = 'claude-sonnet-5-5';
/** The model as the Claude CLI gateway names it. */
export const AI_CLI_MODEL = 'sonnet';
/** The effort level of every call. */
export const AI_EFFORT = 'medium';

/** Models that take the API's own fallback on a policy decline (server-side fallback beta). */
export const AI_FALLBACK_MODELS: readonly string[] = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'];

/** Whether a request to this model may carry `fallbacks: "default"`. */
export function takesFallback(model: string): boolean {
  return AI_FALLBACK_MODELS.includes(model);
}

/** The shape of a Claude model id (what ai_api_model_set takes too). */
export function isClaudeModelId(s: unknown): s is string {
  return typeof s === 'string' && /^claude-[a-z0-9][a-z0-9.-]{2,60}$/.test(s);
}
