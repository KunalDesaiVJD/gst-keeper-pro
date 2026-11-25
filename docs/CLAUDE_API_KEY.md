# The Claude API key (direct Claude API calls)

From 4 November 2026 (Meet: "replace my current Vercel Sandbox AI analysis with direct
calls to the Claude API"), the AI Edge Functions `notice-ai` (1.8.0), `notice-appeal-ai`
(1.4.0) and `notice-link-ai` (1.2.0) call the Claude API themselves, through
`supabase/functions/notice-ai/claude.ts` (the `@anthropic-ai/sdk`, streamed, structured JSON
output, always at medium effort, with Sonnet 5.5 or the model chosen under Claude API key:
`_shared/aiModel.ts`, see "The model" below). Nothing runs in a Vercel Sandbox any more:
`api/claude-cli.ts` and `@vercel/sandbox` are removed. Versions since the model choice:
`notice-ai` 1.9.0, `notice-appeal-ai` 1.5.0, `notice-link-ai` 1.3.0, `ai-key` 1.1.0.

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
| `save` | the same, with their password | checks the format, then the key with Anthropic (below), saves into Vault only when Anthropic accepts it |
| `test` | superadmin, GST Manager | one tiny Claude call with the key and model in use: OK and the time, or the error |
| `remove` | the same, with their password | blanks the Vault secret, clears the mask |
| `models` | superadmin, GST Manager | the models of the key's account the AI can use, from Anthropic's live list, newest first |
| `set_model` | superadmin, GST Manager | `{ model }`: the model every Claude API call uses, checked against that live list; empty goes back to Sonnet 5.5 |

The actor id is checked against `user_roles` and `profiles.sessions_ended_at` before anything
else (403 for anyone else), and again by the database functions. A request body is at most
4 KB; the test call times out after 30 seconds. The key is never in an answer, a log line or
an error (`scrub`).

The page (`src/components/notices/reply/factory/ClaudeKeyCard.tsx`, `src/lib/claudeKey.ts`) is
shown only to a superadmin or a GST Manager, under the AI settings when the reader runs in
Supabase. The key is a password field, sent once and never shown again.

## The key check before a save

Like the CrownGlobe Ops design Meet shared (4 Nov 2026), a key is saved only once Anthropic
has accepted it. `ai-key` asks `GET https://api.anthropic.com/v1/models?limit=1` with the key
(`checkClaudeKey` in `notice-ai/claude.ts`; free, no model is called, 10-second timeout, no SDK
retries) and sorts the answer (`classifyKeyCheck`):

| answer | when | the admin reads |
|---|---|---|
| ok | 2xx | (saved) "Anthropic accepted the key, and it is saved." |
| refused (400) | 401 / 403, or error type `authentication_error` / `permission_error` | "Anthropic did not accept this key. Check that it was copied whole and has not been turned off." |
| no_credit (400) | 400 `invalid_request_error` saying "credit balance", or a 402 | "Anthropic knows this key, but its account has no API credit, so it was not saved. Add credit at console.anthropic.com › Settings › Billing (a Claude subscription does not cover the API), then paste it again." |
| unavailable (503) | a network error, a timeout, a 5xx or 529, a rate limit, any other answer | "Anthropic could not be reached to check the key, so it was not saved. Try again in a minute." |

Only "unavailable" is asked once more, and only when the request was not stopped. A key that
does not have the shape is refused before Anthropic is asked: "That does not look like an
Anthropic API key. It starts with sk-ant-. Copy it again from console.anthropic.com." A failed
check logs one line (`ai_key_check`): the status, the error type and the first 200 characters of
Anthropic's message, with any `sk-ant-…` scrubbed; never the key.

The same "no credit" answer during reading (a key that ran out after it was saved) pauses the
AI with reason `api_billing` and the sentence above (`classifyError`, `runner.ts` `PAUSES`),
instead of marking every document failed.

Where we keep our own way: the key stays in Vault, not in a table column; a cache of two minutes
(the design has ten seconds), because `ai-key` clears its own copy on every change and the other
functions follow within two minutes; and when the saved key cannot be read the functions fall back
to the `ANTHROPIC_API_KEY` secret, which is the firm's own key too.

## The model

Meet (4 Nov 2026): "provide model selection as well", "latest selection as well". Migration
`20261104120000_ai_api_model.sql` (additive): `ai_api_key.model`, `model_name`,
`model_set_by_name`, `model_set_at`; `ai_api_model_log` (RLS on, no policies); functions
`ai_api_model_status`, `ai_api_model_set`, `ai_api_model_read` (service role only; the first
two need a superadmin or a GST Manager, no password). Tests in `supabase/tests/ai_api_key/run.sh`
(`model_test.sql`).

- The list is Anthropic's own, live, for the key in use (`listClaudeModels`, every page of
  `GET /v1/models`), newest first, keeping only models that read PDFs, answer in a JSON schema,
  think adaptively and take medium effort (`usableModel`). A new model Anthropic releases shows
  up by itself; nothing in the code lists the choices.
- `set_model` takes only a model in that live list; the database takes only a `claude-…` id.
- The Edge Functions read the choice with the key (`rpcKeyReader` → `ai_api_model_read`,
  cached with it); nothing chosen, or a choice that cannot be read, is Sonnet 5.5 (`AI_MODEL`).
  The Claude API caller is made with that model (`apiCaller(client, model)`), and `pinned` sends
  it whatever a request names.
- The effort stays **medium** for every call. The office agent and the Claude CLI gateway stay on
  Sonnet.
- The server-side fallback (`fallbacks: "default"`) is sent only for the models that take it
  (`AI_FALLBACK_MODELS`: Fable 5.1, Opus 5.5, Opus 5, Sonnet 5.5); Haiku has none.
- Choosing a model with a known list price sets `ai_settings.price_in_per_mtok` /
  `price_out_per_mtok` (Haiku 5.5 $0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20,
  Fable 5.1 $10 / $50 per million tokens), so the daily caps follow the model; another model
  keeps the prices as they are.
- `node scripts/verify-ai-model.mjs` checks that the model comes only from this choice.
