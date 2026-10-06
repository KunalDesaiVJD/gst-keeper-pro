-- The command centre and the lists at 5,000 notices, as anon under the API's
-- 3 s statement timeout (roadmap Phase 2 acceptance: first paint < 1.5 s with
-- 5,000 notices — the database share of that must be well under it).
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id)
SELECT ('96969696-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Scale Client ' || g, '24SCALE' || lpad(g::text, 4, '0') || 'S1Z5', 'user' || g
  FROM generate_series(1, 50) g;
INSERT INTO gst_notices (client_id, source, portal_key, reference_number, case_id, notice_type, description, issue_date, due_date,
                         amount_of_demand, first_seen_at, assign_to_user_id, hearing_date)
SELECT ('96969696-0000-0000-0000-' || lpad((1 + g % 50)::text, 12, '0'))::uuid, 'notices', 'K' || g, 'ZDK' || g,
       CASE WHEN g % 4 = 0 THEN 'ADK' || g END,
       CASE WHEN g % 7 = 0 THEN 'Determination Of Tax' ELSE 'Notice' END,
       CASE WHEN g % 3 = 0 THEN 'Notice to return defaulter u/s 46 for not filing return'
            WHEN g % 3 = 1 THEN 'Scrutiny of returns ASMT-10' ELSE 'Show Cause Notice DRC-01' END,
       ist_today() - (g % 500), ist_today() + (g % 40) - 20,
       CASE WHEN g % 5 = 0 THEN (g % 97) * 10000 END,
       now() - (g % 30) * interval '1 day',
       CASE WHEN g % 3 = 0 THEN ('a9000000-0000-0000-0000-' || lpad((g % 6)::text, 12, '0'))::uuid END,
       CASE WHEN g % 50 = 0 THEN ist_today() + (g % 14) END
  FROM generate_series(1, 5000) g;
UPDATE gst_notices SET stage = (ARRAY['evidence','waiting_client','draft','partner_review'])[1 + (abs(hashtext(portal_key)) % 4)],
       edited_at = now()
 WHERE client_id::text LIKE '96969696%' AND assign_to_user_id IS NOT NULL;
INSERT INTO notice_issues (notice_id, title, amount, explained_amount, status)
SELECT id, 'Issue', 50000, 20000, 'explained' FROM gst_notices WHERE portal_key LIKE 'K%' AND portal_key::text ~ '0$';
SELECT t_eq((SELECT count(*) FROM gst_notices WHERE client_id::text LIKE '96969696%'), 5000::bigint, '5,000 notices');
ANALYZE gst_notices, clients, notice_issues, notice_events, matter_deadlines;   -- as autovacuum would

CREATE TEMP TABLE timings (what text, ms numeric) ON COMMIT DROP;
GRANT INSERT, SELECT ON timings TO anon;
SET LOCAL ROLE anon;
SET LOCAL statement_timeout = '3s';
DO $$
DECLARE t0 timestamptz; n bigint; j jsonb;
BEGIN
  t0 := clock_timestamp();
  j := public.notices_command_centre('a9000000-0000-0000-0000-000000000001');
  INSERT INTO timings VALUES ('command centre', extract(epoch FROM clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  PERFORM * FROM public.notice_plan WHERE in_plan ORDER BY plan_score DESC LIMIT 8;
  INSERT INTO timings VALUES ('plan top 8', extract(epoch FROM clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.notice_facts WHERE is_open;
  PERFORM * FROM public.notice_facts WHERE is_open ORDER BY effective_due NULLS LAST LIMIT 50;
  INSERT INTO timings VALUES ('list page + count', extract(epoch FROM clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  j := public.notices_search('ZDK4999');
  INSERT INTO timings VALUES ('search', extract(epoch FROM clock_timestamp() - t0) * 1000);
END;
$$;
RESET statement_timeout;
RESET ROLE;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM timings LOOP RAISE NOTICE 'scale: % % ms', r.what, round(r.ms); END LOOP;
END;
$$;
SELECT t_eq((SELECT bool_and(ms < 1500) FROM timings), true, 'each call under 1.5 s at 5,000 notices');
ROLLBACK;
