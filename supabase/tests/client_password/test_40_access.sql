-- Who can reach what: the link tables are private (RLS on, no policies, no
-- anon or authenticated grants, like portal_sessions); the log is readable,
-- written only by the functions; the mailer's functions are service role only.
BEGIN;
INSERT INTO clients (id, name, gstin, email) VALUES
 ('c4000000-0000-0000-0000-000000000001', 'Access Test Co', '24AAACA0000L1Z1', 'a@example.com');
INSERT INTO client_password_log (client_id, action, detail) VALUES ('c4000000-0000-0000-0000-000000000001', 'link_queued', 'seed');

SELECT t_eq((SELECT bool_and(relrowsecurity) FROM pg_class
              WHERE oid IN ('public.client_password_resets'::regclass, 'public.client_password_reset_attempts'::regclass)),
  true, 'RLS on for both private tables');
SELECT t_eq((SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('client_password_resets', 'client_password_reset_attempts')), 0::bigint, 'and no policies');

DO $$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOREACH t IN ARRAY ARRAY['client_password_resets', 'client_password_reset_attempts'] LOOP
      PERFORM t_eq(t_error(format('SELECT 1 FROM public.%I', t)) LIKE 'permission denied%', true, r || ' cannot read ' || t);
      PERFORM t_eq(t_error(format('INSERT INTO public.%I (client_id) VALUES (%L)', t, 'c4000000-0000-0000-0000-000000000001')) LIKE 'permission denied%',
        true, r || ' cannot insert into ' || t);
      PERFORM t_eq(t_error(format('UPDATE public.%I SET client_id = NULL', t)) LIKE 'permission denied%', true, r || ' cannot update ' || t);
      PERFORM t_eq(t_error(format('DELETE FROM public.%I', t)) LIKE 'permission denied%', true, r || ' cannot delete from ' || t);
    END LOOP;
    PERFORM t_eq(t_error('SELECT * FROM public.client_password_reset_claim(1)') LIKE 'permission denied%', true, r || ' cannot claim');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_mark(gen_random_uuid(), NULL)') LIKE 'permission denied%', true, r || ' cannot mark');
    PERFORM t_eq(t_error('SELECT public.client_password_reset_ping()') LIKE 'permission denied%', true, r || ' cannot ping');
    PERFORM t_eq((SELECT count(*) FROM public.client_password_log), 1::bigint, r || ' can read the log');
    PERFORM t_eq(t_error($q$INSERT INTO public.client_password_log (client_id, action) VALUES ('c4000000-0000-0000-0000-000000000001', 'staff_reset')$q$)
      LIKE 'permission denied%', true, r || ' cannot write the log');
    PERFORM t_eq(t_error('DELETE FROM public.client_password_log') LIKE 'permission denied%', true, r || ' cannot delete the log');
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
  'public.client_password_reset_complete(text,text)', 'public.staff_set_client_password(uuid,uuid,text,text)',
  'public.staff_send_client_reset_link(uuid,uuid)']) f), true, 'anon can ask, check, redeem and (as staff) reset');
SELECT t_eq(to_regprocedure('public.staff_set_client_password(uuid,uuid,text)') IS NULL, true, 'the old 3-argument version is gone');
SELECT t_eq((SELECT bool_and(prosecdef) FROM pg_proc WHERE proname IN ('client_password_reset_request', 'client_password_reset_check',
  'client_password_reset_complete', 'client_password_reset_claim', 'client_password_reset_mark', 'staff_set_client_password',
  'staff_send_client_reset_link')), true, 'all SECURITY DEFINER');
SELECT t_eq((SELECT bool_and(array_to_string(proconfig, ',') LIKE '%search_path=public, extensions%') FROM pg_proc
  WHERE proname IN ('client_password_reset_request', 'client_password_reset_check', 'client_password_reset_complete',
  'client_password_reset_claim', 'client_password_reset_mark', 'staff_set_client_password', 'staff_send_client_reset_link')),
  true, 'with a fixed search_path that reaches pgcrypto');

-- The password rules helper.
SELECT t_eq(client_password_problem('Good#2026', '24AAACA0000L1Z1'), NULL::text, 'a good password');
SELECT t_eq(client_password_problem('24aaaca0000l1z1', '24AAACA0000L1Z1'), 'The new password cannot be your GSTIN.', 'own GSTIN');
SELECT t_eq(client_email_hint('x@y.com'), 'x•••@y.com', 'hint');
SELECT t_eq(client_email_hint(NULL), NULL::text, 'no hint without an address');
ROLLBACK;
