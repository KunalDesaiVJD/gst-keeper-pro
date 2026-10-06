# Agent tests

- `*.test.ts` other than the end-to-end ones are plain unit tests:
  `npm test` (node:test with tsx). Two end-to-end files need a local database and
  are skipped without their environment variables: `agent.e2e.test.ts` and
  `read.e2e.test.ts`.
- `agent.e2e.test.ts` runs the real agent, driving the real extension (staged from
  `../extension`) in Chromium against `FakePortal` (`fakePortal.ts`, served through
  Playwright routing — no network) and a **local** PostgREST over a database that
  carries the notices and autopilot migrations. A test plays the person at the
  CAPTCHA wall through the same RPCs the app uses. It covers: switched off → nothing
  is touched; nobody at the wall → the job waits without opening the portal; a wrong
  CAPTCHA then the right one → the extension logs in and saves notices and
  applications, then logs out; a rejected password → failed with `login_failed`,
  grouped as a password fix; "Skip this client" → cancelled with `skipped_at_wall`.

Set up the database the way `supabase/tests/notices/run.sh` does (PostgreSQL 15/16:
`00_stub_platform.sql`, then every file in `migrations.txt`), serve it with PostgREST
(`db-anon-role = "anon"`, the same JWT secret as your anon token), then:

```
E2E_PGRST=http://127.0.0.1:54397 E2E_JWT_FILE=/path/to/anon.jwt \
  node --import tsx --test test/agent.e2e.test.ts
```

The test refuses any PostgREST that is not on 127.0.0.1 / localhost. Never point it
at the live project. Chromium comes from Playwright (`npx playwright install
chromium`).

## The notice reader (Claude API)

Never calls the real Claude API: every test points the SDK at `FakeAnthropic`
(`fakeAnthropic.ts`), a local HTTP server that records each request and answers
with a scripted streamed message or error. `readFixtures.ts` draws made-up notices
with pdf-lib (a DRC-01-style notice with a demand table, a "scan" without a text
layer, long PDFs) and the reading a model would return for each.

- `read.checks.test.ts` — normalising text, quote matching (Indian amounts such as
  1,23,456.00, dates in every common form, words in table order), values in quotes,
  sums by tax within ₹1, GSTIN, date order, the column formats, and a reading turned
  into `notice_read_finish`'s result. No PDF, no network.
- `read.pdf.test.ts` — page count and each page's text from the fixture PDFs, scans,
  the page limit, and the download's limits (size, type, timeout, redirects, host)
  against a local HTTP server.
- `read.claude.test.ts` — the request's shape (model, adaptive thinking, effort, JSON
  schema, `fallbacks: "default"`, PDF first, nothing about the client) and each
  outcome: refusal, 429 then success, 5xx, a refused key, max_tokens, a fallback
  mid-answer, a stream cut off, the agent stopping.
- `read.reader.test.ts` — the reader's loop with an in-memory stand-in for the
  database: off without a key, release / claim / finish, the day's cap, pausing on a
  refused key, the page limit.
- `read.e2e.test.ts` — the real agent (`startAgent`) against a **local** PostgREST over
  a database built like `supabase/tests/notices/run.sh` does, with the PDFs served as
  the app's storage serves them and `FakeAnthropic` answering per PDF. It checks:
  nothing claimed while reading is off; a client without consent is never claimed;
  a reading's checked fields applied to `gst_notices` (`read_fields` source `ai`,
  `verified` false), issues added (`extracted`, unverified), an `ai_audit_log` row
  with its cost; a staff-typed value kept as a conflict; another GSTIN applies
  nothing (`gstin_mismatch`); a scan applies nothing; a refusal; the day's cap stops
  claims; the heartbeat reports the reader.

```
E2E_READ_PGRST=http://127.0.0.1:54396 E2E_JWT_FILE=/path/to/anon.jwt \
  node --import tsx --test test/read.e2e.test.ts
```

Like the portal end-to-end test it refuses any PostgREST that is not on 127.0.0.1 /
localhost. It needs no Chromium (the autopilot stays off).
