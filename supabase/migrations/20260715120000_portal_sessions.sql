-- Portal Agent: cloud-persisted login sessions.
--
-- When the agent runs on ephemeral cloud runners (GitHub Actions) there is no
-- local disk between runs, so a client's Playwright storageState (the logged-in
-- session cookies) is kept HERE instead. This lets the agent reuse a login for
-- hours across many runs so a human types a CAPTCHA only when a session actually
-- expires — not on every run.
--
-- SECURITY: these rows are session cookies (sensitive, like credentials). RLS is
-- ENABLED with NO policies, so the anon/publishable key CANNOT read them. Only the
-- service_role key (which bypasses RLS and lives only on the agent runner) can.

BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_sessions (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  storage_state jsonb NOT NULL,          -- Playwright storageState (cookies + origins)
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only service_role (bypasses RLS) may read/write.

COMMIT;
