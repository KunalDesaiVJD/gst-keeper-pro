-- Portal Agent (pull/push RPA) — Phase 0: job queue + audit + verification.
--
-- The app enqueues a job (1-click); a local Playwright Agent on an office PC
-- polls this queue, drives the GST portal, and writes results + self-check
-- verifications back. Everything the Agent does is PULL (portal -> our tables)
-- or PUSH-SAVE (our JSON -> portal, saved not filed). It never offsets ITC,
-- never submits/files — that stays human (OTP/DSC).
--
-- NOTE: not applied to the live DB yet — this lives on the feat/portal-agent
-- branch until reviewed/confirmed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_month text,                          -- MM/YYYY where applicable
  job_type text NOT NULL,                     -- LOGIN_TEST | PULL_2B | PULL_LEDGERS |
                                              -- PULL_GSTR1 | PULL_FILING_STATUS |
                                              -- PUSH_GSTR1_SAVE | PUSH_GSTR3B_SAVE
  mode text NOT NULL DEFAULT 'live'
    CHECK (mode IN ('live', 'shadow')),       -- shadow = do everything EXCEPT the final Save (dry-run)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'running', 'needs_human',
                      'succeeded', 'failed', 'cancelled')),
  payload jsonb DEFAULT '{}',                 -- inputs (e.g. the JSON to push)
  result jsonb,                               -- outputs (parsed data / portal response)
  verified boolean,                           -- did the read-back / reconcile self-check pass?
  human_prompt jsonb,                         -- when status=needs_human: what the human must supply (e.g. captcha image ref)
  human_response jsonb,                       -- the app writes the human's answer here (e.g. captcha text)
  error text,
  attempts int NOT NULL DEFAULT 0,
  claimed_by text,                            -- agent instance id
  requested_by uuid,                          -- app user who enqueued
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_portal_jobs_status ON public.portal_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_portal_jobs_client ON public.portal_jobs (client_id, period_month);

CREATE TABLE IF NOT EXISTS public.portal_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.portal_jobs(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
  step text,
  message text,
  screenshot_path text,                       -- storage path of a screenshot for audit
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_job_events_job ON public.portal_job_events (job_id, created_at);

-- Every PULL is reconciled against the portal's own totals; every PUSH is read
-- back and diffed against what we sent. Each such self-check is recorded here.
CREATE TABLE IF NOT EXISTS public.portal_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.portal_jobs(id) ON DELETE CASCADE,
  client_id uuid,
  period_month text,
  check_type text NOT NULL,                   -- 2B_TOTAL_MATCH | LEDGER_CLOSING_MATCH |
                                              -- GSTR1_SUMMARY_MATCH | PUSH_READBACK_DIFF
  passed boolean NOT NULL,
  expected jsonb,                             -- portal figure
  actual jsonb,                               -- what we parsed / pushed
  diff jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_verifications_job ON public.portal_verifications (job_id);

ALTER TABLE public.portal_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view portal_jobs" ON public.portal_jobs;
CREATE POLICY "Anyone can view portal_jobs" ON public.portal_jobs FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage portal_jobs" ON public.portal_jobs;
CREATE POLICY "Staff can manage portal_jobs" ON public.portal_jobs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view portal_job_events" ON public.portal_job_events;
CREATE POLICY "Anyone can view portal_job_events" ON public.portal_job_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage portal_job_events" ON public.portal_job_events;
CREATE POLICY "Staff can manage portal_job_events" ON public.portal_job_events FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view portal_verifications" ON public.portal_verifications;
CREATE POLICY "Anyone can view portal_verifications" ON public.portal_verifications FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage portal_verifications" ON public.portal_verifications;
CREATE POLICY "Staff can manage portal_verifications" ON public.portal_verifications FOR ALL USING (true) WITH CHECK (true);

-- Agent liveness: the Agent upserts its last_seen every poll so the app can show
-- "agent online / last seen Ns ago".
CREATE TABLE IF NOT EXISTS public.portal_agent_heartbeat (
  agent_id text PRIMARY KEY,
  last_seen timestamptz NOT NULL DEFAULT now(),
  info jsonb
);
ALTER TABLE public.portal_agent_heartbeat ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view portal_agent_heartbeat" ON public.portal_agent_heartbeat;
CREATE POLICY "Anyone can view portal_agent_heartbeat" ON public.portal_agent_heartbeat FOR SELECT USING (true);
DROP POLICY IF EXISTS "Staff can manage portal_agent_heartbeat" ON public.portal_agent_heartbeat;
CREATE POLICY "Staff can manage portal_agent_heartbeat" ON public.portal_agent_heartbeat FOR ALL USING (true) WITH CHECK (true);

COMMIT;
