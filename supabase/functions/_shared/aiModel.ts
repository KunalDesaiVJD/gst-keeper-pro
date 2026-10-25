// The one model every AI call in GST Keeper uses, at the one effort (the
// firm's rule, 25 Oct 2026): Claude Sonnet at medium effort, through the
// Claude CLI gateway or the Claude API alike. Nothing reads a model or an
// effort from a setting, a request or a default anywhere else: the callers
// (notice-ai/claude.ts, notice-ai/cli.ts, agent/src/read/claude.ts) send these
// values whatever they are asked, the database refuses any other value in
// ai_settings (20261025190000), and `node scripts/verify-ai-model.mjs` (run by
// `npm run typecheck`) fails the build when code names another model or effort.
// agent/src/read/aiModel.ts is a copy for the office agent; the check keeps the
// two the same.

/** The Claude API model id. */
export const AI_MODEL = 'claude-sonnet-5-5';
/** The model as the Claude CLI gateway names it. */
export const AI_CLI_MODEL = 'sonnet';
/** The effort level of every call. */
export const AI_EFFORT = 'medium';
