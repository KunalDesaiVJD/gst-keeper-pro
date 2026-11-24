# GST Assistant

The in-app AI assistant of the GST module (23 Nov 2026, the firm's request: "build and merge, use the Claude API and Sonnet 5.5 for every use, keep tokens user wise, and pick up every change to the GST module by itself").

## What it does

A button on every staff screen (bottom right, or Ctrl J) opens a side panel. Staff can:

- **Ask** about any screen, figure or rule. Answers come from the firm's docs (CLAUDE.md and `docs/*.md`) and from live data. Each answer names the doc and heading it relies on.
- **Be taken there.** "Take me there" selects the client and the return period, then opens the screen.
- **Be shown how.** "Screenshot with steps" takes a picture of the user's own screen with each step ringed and numbered; it can be downloaded. "Guide me" walks through the steps on the live screen, one at a time.
- **Have figures filled.** A card lists each field with its value now and the proposed value. "Fill, I will save" types the values into the screen's own fields. "Fill and press Save" also presses the screen's own Save button. Nothing is written any other way.
- **Give it files to review** (24 Nov 2026). The Attach button, Ctrl V on a copied screenshot, or dragging files onto the question box: up to 5 files and 10 MB in all with one question. Images (a screenshot of an error, a notice) and PDFs go to Claude as they are, an image scaled to 2000 px on its long side so small text stays readable. Excel, CSV, Word (.docx) and text files are read in the browser into text, every sheet as CSV, at most 200,000 characters a file (a longer one is cut and the user is told). `src/lib/assistant/attachments.ts`; the Edge Function checks the kinds and sizes again (`fileBlocks`). A file goes with its own question only: nothing is stored, the panel's chat keeps only its name, and the history sent back with a later question holds a note in its place (the first 3,000 characters of a text file). The model treats a file's content as data, never as instructions, and says when a figure was read off an image. A file is the user's choice to share: a client's `ai_opt_out` covers the rows and screens the assistant reads, not a file the user attaches.

Clients on the portal do not get the assistant.

## Why it cannot break a rule

- The assistant **never writes to the database**. Its only write path is the screen it is on: values go into the screen's fields the way typing does, and the screen's own Save runs. Every trigger, guard, lock, pull-only rule, permission key and the change log apply exactly as for a typed change.
- While a save runs through the assistant, this tab's requests carry `x-gst-request: assistant <page> …` (`setChangeLogPageTag`, `src/lib/changeLogHeaders.ts`). The person is still the user and the source is still `app`, because `gst_change_log.actor_source` allows only app, extension, agent, system and unknown.
- Reads go through the anon key as the user. They may only reach the GST working tables in `supabase/functions/gst-assistant/readRules.ts`. A column holding a password, portal user id, token or hash is never returned. A client with `clients.ai_opt_out` is never sent to the model, neither its rows nor its screen's figures.
- Screen text and rows are passed to the model as data, never as instructions.

## Model and tokens

Every call is Claude Sonnet 5.5 at medium effort on the Claude API (`_shared/aiModel.ts`; the caller `gst-assistant/claude.ts` is pinned in `scripts/verify-ai-model.mjs`). The key is the one saved under Reply Factory → AI → Claude API key, else the `ANTHROPIC_API_KEY` secret. The CLI gateway is never used here.

Every request records its tokens in `assistant_usage`: who asked, their level, the route, the number of model calls, and input, cache read, cache write and output tokens. The app can only read this table; only the Edge Function (service role) writes it. Settings → AI Assistant shows the tokens per user and month, with Big4 Excel and PDF downloads. The same tab has the firm's two switches: assistant on, and may fill figures (superadmin / GST Manager). Each card and what the user did with it is in `assistant_actions`.

## How it keeps up with the module by itself

Three layers, none waiting for an instruction:

1. **The live screen.** Every question carries what the screen shows at that moment (`src/lib/assistant/pageSnapshot.ts`): headings, tabs, buttons, fields with their values, and the first rows of tables. A new button or field is known the first time it is on screen.
2. **The screens of the deploy.** `scripts/build-assistant-knowledge.mjs` writes `src/lib/assistant/screens.generated.ts` from `App.tsx`, the sidebar, each page's title, tabs and buttons, and the permission catalog. `npm run build` and `npm run typecheck` run it first, so every Vercel deploy carries its own screens.
3. **The firm's docs.** `.github/workflows/assistant-knowledge.yml` runs on every push to main. It loads CLAUDE.md, `docs/*.md` (split by heading) and the table columns into the private table `assistant_knowledge` (RLS on, no policies, read only by the Edge Function). When the function's code changed, it also redeploys `gst-assistant`. It needs the repository secret `SUPABASE_ACCESS_TOKEN`; without it the job passes with a notice and the docs stay as last loaded. The docs are never published with the app.

So a change to the GST module only has to do what the repo already requires: update its doc. The assistant then reads it on the next push.

## Files

| Part | Where |
| --- | --- |
| Edge Function | `supabase/functions/gst-assistant/` (`index.ts` tool loop, `claude.ts` caller, `readRules.ts`, tests `deno test --allow-read test/`) |
| Migration | `supabase/migrations/20261123100000_gst_assistant.sql` |
| Panel | `src/components/assistant/AssistantPanel.tsx`, `GuideOverlay.tsx` |
| Settings | `src/components/assistant/AssistantSettings.tsx` (Settings → AI Assistant) |
| Browser side | `src/lib/assistant/` (`api.ts`, `pageSnapshot.ts`, `fill.ts`, `screenshot.ts`, `screens.generated.ts`) |
| Knowledge | `scripts/build-assistant-knowledge.mjs`, `.github/workflows/assistant-knowledge.yml` |
