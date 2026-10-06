# Agent tests

- `*.test.ts` other than the end-to-end one are plain unit tests:
  `npm test` (node:test with tsx).
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
