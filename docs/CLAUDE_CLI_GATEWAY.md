# GST Keeper's Claude CLI gateway

Built on 29 October 2026 ("go ahead, build it and deploy"), on the design the firm
already runs in its other project, for this project only. Nothing here calls the
other project.

## What it is

`api/claude-cli.ts` is a Vercel function deployed with the app (`gst.vjdesai.com/api/claude-cli`).
For each call it:

1. checks `Authorization: Bearer <CLAUDE_CLI_GATEWAY_SECRET>` (constant-time);
2. downloads each `storage` part from **this** project's storage with its service-role key,
   only from the buckets `return-pdfs` and `ai-cli-temp`, never a path with `..`;
3. starts a Vercel Sandbox (`vercel/sandbox/universal:latest`), writes the files and the prompt there;
4. runs `claude --print --output-format json --permission-mode dontAsk --allowedTools Read
   --no-session-persistence --model sonnet --effort medium` on the firm's Claude subscription
   (`CLAUDE_CODE_OAUTH_TOKEN`); the CLI opens each file with its Read tool, a scanned page or a photo as an image;
5. returns `{ text, truncated: false, model: "sonnet", provider: "claude-cli" }`, or 502 with no detail;
6. stops the sandbox.

The model and effort are two constants in the file, whatever a request names (CLAUDE.md:
every AI call is Sonnet at medium effort); `scripts/verify-ai-model.mjs` checks them against
`supabase/functions/_shared/aiModel.ts`.

## The request

```json
{ "system": "…",
  "parts": [ { "kind": "storage", "bucket": "return-pdfs", "path": "refund/…/x.pdf", "filename": "document.pdf", "mediaType": "application/pdf" },
             { "kind": "text", "text": "…" } ],
  "timeoutMs": 120000 }
```

`timeoutMs` is held between 30 seconds and 12 minutes. The Edge Functions (`notice-ai/cli.ts`,
shared by `notice-appeal-ai` and `notice-link-ai`) send a `storage` part only when
`CLAUDE_CLI_GATEWAY_FILES=1`; otherwise they send text only, as to any other gateway.

## How the reader uses it (notice-ai 1.7.0, `scan.ts`)

- A typed document goes as its text, as before.
- A scan of up to 12 pages goes as where it is stored.
- A longer scan: its first nine pages and its last three are copied into one PDF in the
  private bucket `ai-cli-temp`, read, and removed.
- A photo saved as `.pdf` goes as an image.
- A scan is started only with 100 seconds of the run left; otherwise it is handed back
  with its try not counted.
- The reading is marked "read from a scan", and any GSTIN in it whose check character fails is
  listed to confirm on the paper.

See §38 of `docs/NOTICES_LITIGATION_POSITIONS.md`.

## Setting it up

On the Vercel project of this app (Settings → Environment Variables, Production), then redeploy:

| Variable | Value |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | the firm's Claude subscription token (`claude setup-token`) |
| `CLAUDE_CLI_GATEWAY_SECRET` | a long random secret, the same one given to Supabase |
| `SUPABASE_URL` | `https://gcquafqxbykxkbexcdpy.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | this project's service-role key |

Vercel Sandbox needs the project's OIDC token (on by default) and Fluid compute; the function
runs for up to 800 seconds (`maxDuration`).

Then, on Supabase project `gcquafqxbykxkbexcdpy` (Edge Functions → Secrets):

| Secret | Value |
|---|---|
| `CLAUDE_CLI_GATEWAY_URL` | `https://gst.vjdesai.com/api/claude-cli` |
| `CLAUDE_CLI_GATEWAY_SECRET` | the same secret |
| `CLAUDE_CLI_GATEWAY_FILES` | `1` (only once this gateway answers; the other gateway does not take files from here) |

`notice-ai`'s `{"action":"status"}` answers `files: true` once the switch is on.
