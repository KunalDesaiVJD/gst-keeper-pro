-- Who can reach what: the link tables and the log are private (RLS on, no
-- policies, no anon or authenticated grants, like portal_sessions); staff read
-- the log through client_password_log_for (test_70); the mailer's functions
-- and the internal helpers are service role only.
BEGIN;
INSERT INTO clients (id, name, gstin, email) VALUES
 ('c4000000-0000-0000-0000-000000000001', 'Access Test Co', '24AAACA0000L1Z1', 'a@example.com');
INSERT INTO client_password_log (client_id, action, detail) VALUES ('c4000000-0000-0000-0000-000000000001', 'link_queued', 'seed');

SELECT t_eq((SELECT bool_and(relrowsecurity) FROM pg_class
              WHERE oid IN ('public.client_password_resets'::regclass, 'public.client_password_reset_attempts'::regclass,
                            'public.client_password_log'::regclass)),
  true, 'RLS on for the three private tables');
SELECT t_eq((SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('client_password_resets', 'client_password_reset_attempts', 'client_password_log')), 0::bigint, 'and no policies');

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOREACH t IN ARRAY ARRAY['client_password_resets', 'client_password_reset_attempts', 'client_password_log'] LOOP
      PERFORM t_eq(t_error(format('SELECT 1 FROM public.%I', t)) LIKE 'permission denied%', true, r || ' cannot read ' || t);
      PERFORM t_eq(t_error(format('INSERT INTO public.%I (client_id) VALUES (%L)', t, 'c4000000-0000-0000-0000-000000000001')) LIKE 'permission denied%',
        true, r || ' cannot insert into ' || t);
      PERFORM t_eq(t_error(format('UPDATE public.%I SET client_id = NULL', t)) LIKE 'permission denied%', true, r || ' cannot update ' || t);
      PERFORM t_eq(t_error(format('DELETE FROM public.%I', t)) LIKE 'permission denied%', true, r || ' cannot delete from ' || t);
    END LOOP;
    PERFORM t_eq(t_error('SELECT * FROM public.client_password_reset_claim(1)') LIKE 'permission denied%', true, r || ' cannot claim');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_mark(gen_random_uuid(), NULL)') LIKE 'permission denied%', true, r || ' cannot mark');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_ping()') LIKE 'permission denied%', true, r || ' cannot ping');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_sweep()') LIKE 'permission denied%', true, r || ' cannot sweep');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_limits_lock()') LIKE 'permission denied%', true, r || ' cannot take the limits lock');
    PERFORM t_eq(t_error($q$SELECT public.client_password_staff_request('c4000000-0000-0000-0000-000000000001', 'x')$q$) LIKE 'permission denied%',
      true, r || ' cannot file a staff request directly');
    PERFORM t_eq(t_error($q$SELECT public.client_password_reset_for_client('c4000000-0000-0000-0000-000000000001', NULL, false)$q$) LIKE 'permission denied%',
      true, r || ' cannot skip the address limit');
    PERFORM t_eq(t_error($q$SELECT public.client_password_has_open_link('c4000000-0000-0000-0000-000000000001')$q$) LIKE 'permission denied%',
      true, r || ' cannot ask whether a link is open');
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- Even if a grant slipped in later, RLS with no policies still shows nothing.
INSERT INTO client_password_resets (client_id, via, sent_to) VALUES ('c4000000-0000-0000-0000-000000000001', 'self', 'a@example.com');
GRANT SELECT, INSERT ON client_password_resets TO anon;
SET LOCAL ROLE anon;
SELECT t_eq((SELECT count(*) FROM client_password_resets), 0::bigint, 'RLS hides every row from anon');
SELECT t_eq(t_error($$INSERT INTO client_password_resets (client_id, via, sent_to, token_hash, claimed_at, expires_at)
  VALUES ('c4000000-0000-0000-0000-000000000001', 'self', 'x@example.com', repeat('0', 64), now(), now() + interval '1 hour')$$)
  LIKE 'new row violates row-level security policy%', true, 'and refuses a planted token hash');
RESET ROLE;
REVOKE SELECT, INSERT ON client_password_resets FROM anon;

-- The service role reaches all of it.
SET LOCAL ROLE service_role;
SELECT t_eq((SELECT count(*) FROM client_password_resets), 1::bigint, 'service role reads the links');
SELECT t_eq((SELECT count(*) FROM client_password_reset_claim(5)), 1::bigint, 'and claims them');
RESET ROLE;

-- The anon-facing functions.
SELECT t_eq((SELECT bool_and(has_function_privilege('anon', f, 'EXECUTE')) FROM unnest(ARRAY[
  'public.client_password_reset_request(text)', 'public.client_password_reset_check(text)',
  'public.client_password_reset_complete(text,text)', 'public.staff_set_client_password(uuid,uuid,text,text,boolean)',
  'public.staff_send_client_reset_link(uuid,uuid)', 'public.client_password_log_for(uuid,uuid,integer)']) f), true,
  'anon can ask, check, redeem and (as staff) reset and read the log');
SELECT t_eq(to_regprocedure('public.staff_set_client_password(uuid,uuid,text)') IS NULL, true, 'the old 3-argument version is gone');
SELECT t_eq(to_regprocedure('public.staff_set_client_password(uuid,uuid,text,text)') IS NULL, true, 'and the 4-argument one (one function, no overloads)');
SELECT t_eq((SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('client_password_reset_request', 'client_password_reset_check',
  'client_password_reset_complete', 'client_password_reset_claim', 'client_password_reset_mark', 'staff_set_client_password',
  'staff_send_client_reset_link', 'client_password_log_for', 'client_password_reset_sweep', 'client_password_reset_for_client',
  'client_password_staff_request', 'client_password_has_open_link')), true, 'all SECURITY DEFINER');
SELECT t_eq((SELECT bool_and(array_to_string(proconfig, ',') LIKE '%search_path=public, extensions%') FROM pg_proc
  WHERE proname IN ('client_password_reset_request', 'client_password_reset_check', 'client_password_reset_complete',
  'client_password_reset_claim', 'client_password_reset_mark', 'staff_set_client_password', 'staff_send_client_reset_link',
  'client_password_log_for', 'client_password_reset_sweep', 'client_password_reset_for_client', 'client_password_staff_request',
  'client_password_has_open_link')),
  true, 'with a fixed search_path that reaches pgcrypto');

-- The password rules helper.
SELECT t_eq(client_password_problem('Good#2026', '24AAACA0000L1Z1'), NULL::text, 'a good password');
SELECT t_eq(client_password_problem('24aaaca0000l1z1', '24AAACA0000L1Z1'), 'The new password cannot be your GSTIN.', 'own GSTIN');
SELECT t_eq(client_email_hint('x@y.com'), 'x•••@y.com', 'hint');
SELECT t_eq(client_email_hint(NULL), NULL::text, 'no hint without an address');
ROLLBACK;
