# The Claude API key (direct Claude API calls)

From 4 November 2026 (Meet: "replace my current Vercel Sandbox AI analysis with direct
calls to the Claude API"), the AI Edge Functions `notice-ai` (1.8.0), `notice-appeal-ai`
(1.4.0) and `notice-link-ai` (1.2.0) call the Claude API themselves, through
`supabase/functions/notice-ai/claude.ts` (the `@anthropic-ai/sdk`, streamed, structured JSON
output, always Sonnet at medium effort: `_shared/aiModel.ts`). Nothing runs in a Vercel
Sandbox any more: `api/claude-cli.ts` and `@vercel/sandbox` are removed.

## Which key is used

`notice-ai/backend.ts` → `_shared/claudeKey.ts`, in this order:

1. the key saved in the app (Reply Factory → AI → **Claude API key**);
2. the Edge Function secret `ANTHROPIC_API_KEY` (Supabase → Edge Functions → Secrets);
3. neither: the old Claude CLI gateway (`CLAUDE_CLI_GATEWAY_URL` / `CLAUDE_CLI_GATEWAY_SECRET`)
   if those secrets are still set, else nothing is read and the page says so.

A function instance keeps the key it read for two minutes at most (`KEY_CACHE_MS`); `ai-key`
clears its own copy at once on a save or a removal, so the other functions take a change
within two minutes.

## Where the key is kept

Migration `20261104100000_ai_api_key_vault.sql`:

- the key only in **Supabase Vault** (`vault.create_secret` / `vault.update_secret`, secret
  name `gst_keeper_claude_api_key`);
- `ai_api_key` (one row): the Vault secret's id, the masked key (`sk-ant-…a1b2`), its last four
  characters, who saved it and when; `ai_api_key_log`: every save, removal and test;
- both tables RLS on with **no policies**, all privileges revoked from `anon` and
  `authenticated` (like `portal_sessions`);
- functions `ai_api_key_status`, `ai_api_key_set`, `ai_api_key_remove`, `ai_api_key_read`,
  `ai_api_key_log_test`: SECURITY DEFINER, executable by the **service role only**;
- a save or a removal needs a superadmin or a GST Manager **and their own password**
  (`ai_api_key_admin`, checked with `crypt` against `profiles.password`); the key must match
  `^sk-ant-[A-Za-z0-9_-]{20,}$` (at most 300 characters);
- a removal overwrites the Vault secret with an empty string; no copy of the key is left.

Tests: `supabase/tests/ai_api_key/run.sh` (local PostgreSQL with a stand-in Vault).

## The Edge Function `ai-key`

`verify_jwt = false` (custom sign-in, no Supabase JWT, like `doc-open`). POST
`{ action, actorId, sessionsEndedAt, password?, key? }`:

| action | who | does |
|---|---|---|
| `status` | superadmin, GST Manager | masked key, saved by, saved at, which key is in use (`app` / `env` / `none`) |
| `save` | the same, with their password | checks the format, saves into Vault |
| `test` | superadmin, GST Manager | one tiny Claude call with the key in use: OK and the time, or the error |
| `remove` | the same, with their password | blanks the Vault secret, clears the mask |

The actor id is checked against `user_roles` and `profiles.sessions_ended_at` before anything
else (403 for anyone else), and again by the database functions. A request body is at most
4 KB; the test call times out after 30 seconds. The key is never in an answer, a log line or
an error (`scrub`).

The page (`src/components/notices/reply/factory/ClaudeKeyCard.tsx`, `src/lib/claudeKey.ts`) is
shown only to a superadmin or a GST Manager, under the AI settings when the reader runs in
Supabase. The key is a password field, sent once and never shown again.
