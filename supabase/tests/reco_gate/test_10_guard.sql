-- From 06/2026 a reco's portal side changes only by the pull, an allowed
-- manual entry or an override (20261021120000). Run as the public key does
-- (SET ROLE anon): the app writes with it, and PostgREST's upsert is an
-- INSERT ... ON CONFLICT DO UPDATE of the columns it sends.
-- People: S superadmin, M GST Manager, E employee, X a client login.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Sonal'),
  ('00000000-0000-0000-0000-0000000000a2', 'Mehul'),
  ('00000000-0000-0000-0000-0000000000a3', 'Esha');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000a2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'employee'),
  ('00000000-0000-0000-0000-0000000000a4', 'client');
INSERT INTO public.clients (id, name, gstin) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ALPHA TRADERS', '24AAAAA0000A1Z5'),
  ('19999999-9999-9999-9999-999999999999', 'GONE LATER', '24AAAAA0000A1Z9');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

DO $$
DECLARE
  c1 uuid := '11111111-1111-1111-1111-111111111111';
  s uuid := '00000000-0000-0000-0000-0000000000a1';
  m uuid := '00000000-0000-0000-0000-0000000000a2';
  e uuid := '00000000-0000-0000-0000-0000000000a3';
  x uuid := '00000000-0000-0000-0000-0000000000a4';
  r record;
  a jsonb;
  v jsonb;
  n integer;
BEGIN
  -- Save before any pull: the current-total snapshot only. Allowed.
  INSERT INTO public.suspended_reco (client_id, period_month, portal_cgst, updated_by)
  VALUES (c1, '09/2026', 5, e)
  ON CONFLICT (client_id, period_month) DO UPDATE SET portal_cgst = EXCLUDED.portal_cgst, updated_by = EXCLUDED.updated_by;
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_source, 'manual', 'a Save before the pull makes a row with no opening source');

  -- The old Upload (CSV) upsert: refused.
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst, opening_source, opening_csv_period_month, opening_csv_uploaded_at, opening_csv_uploaded_by)
    VALUES (%L, '09/2026', 1200, 'csv', '08/2026', now(), %L)
    ON CONFLICT (client_id, period_month) DO UPDATE SET opening_cgst = EXCLUDED.opening_cgst, opening_source = EXCLUDED.opening_source,
      opening_csv_period_month = EXCLUDED.opening_csv_period_month, opening_csv_uploaded_at = EXCLUDED.opening_csv_uploaded_at,
      opening_csv_uploaded_by = EXCLUDED.opening_csv_uploaded_by$q$, c1, e),
    'comes only from the portal pull', 'the CSV upload is refused without an allowance');
  -- The old Not Applicable: refused.
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_source = 'not_applicable', opening_cgst = 0 WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'Not Applicable is refused without an allowance');
  -- A Save that changes the opening: refused. One that sends it unchanged: allowed.
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_cgst = 100 WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'a Save that writes the opening is refused');
  UPDATE public.suspended_reco SET opening_cgst = 0, opening_sgst = 0, opening_igst = 0, opening_source = 'manual', portal_cgst = 6
   WHERE client_id = c1 AND period_month = '09/2026';
  -- A forged pull (a direct write claiming the portal): refused.
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst, opening_source, opening_portal_pulled_at)
    VALUES (%L, '10/2026', 50, 'portal', now())$q$, c1),
    'comes only from the portal pull', 'a direct write claiming a pull is refused');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_source = 'portal', opening_portal_pulled_at = now() WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'an update claiming a pull is refused');

  -- GST Receivable Reco: books closing is typed; ITC utilised and DRC-03 are the pull's.
  INSERT INTO public.gst_receivable_reco (client_id, period_month, books_closing_cgst, updated_by)
  VALUES (c1, '09/2026', 300, e)
  ON CONFLICT (client_id, period_month) DO UPDATE SET books_closing_cgst = EXCLUDED.books_closing_cgst;
  UPDATE public.gst_receivable_reco SET books_closing_sgst = 300 WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_raises(format($q$UPDATE public.gst_receivable_reco SET drc_cgst = 10 WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'a typed DRC-03 is refused');
  PERFORM t_raises(format($q$UPDATE public.gst_receivable_reco SET utilized_cgst = 0 WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'a typed ITC utilised is refused');
  PERFORM t_raises(format($q$INSERT INTO public.gst_receivable_reco (client_id, period_month, drc_cgst) VALUES (%L, '10/2026', 7)$q$, c1),
    'comes only from the portal pull', 'a new row with a DRC-03 figure is refused');

  -- Manual entry without an allowance: refused.
  PERFORM t_raises(format($q$SELECT public.reco_manual_opening(%L, 'suspended', %L, '09/2026', 'csv', '{"igst":0,"cgst":1200,"sgst":1200}'::jsonb, NULL, NULL, '08/2026')$q$, e, c1),
    'No manual entry is allowed', 'reco_manual_opening needs an allowance');

  -- Allowances: the superadmin's alone, with a reason.
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco:suspended', 'portal password changed')$q$, e, c1),
    'Only the superadmin', 'an employee cannot allow');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco:suspended', 'portal password changed')$q$, m, c1),
    'Only the superadmin', 'a GST Manager cannot allow');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco:suspended', 'portal password changed')$q$, x, c1),
    'Only the superadmin', 'a client login cannot allow');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(NULL, %L, '09/2026', 'reco:suspended', 'portal password changed')$q$, c1),
    'Only the superadmin', 'nobody cannot allow');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco:suspended', ' abc ')$q$, s, c1),
    'at least 5 characters', 'a reason is needed');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, 'Sep-26', 'reco:suspended', 'portal password changed')$q$, s, c1),
    'MM/YYYY', 'the month must be MM/YYYY');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco suspended', 'portal password changed')$q$, s, c1),
    'Unknown allowance scope', 'the scope must look like kind:name');
  a := to_jsonb(public.manual_source_allow(s, c1, '09/2026', 'reco:suspended', 'portal password changed by the client'));
  PERFORM t_eq(a->>'allowed_by', s::text, 'the allowance records who allowed it');
  PERFORM t_eq(a->>'used_at', NULL, 'a new allowance is unused');
  PERFORM t_raises(format($q$SELECT public.manual_source_allow(%L, %L, '09/2026', 'reco:suspended', 'second one please')$q$, s, c1),
    'already allowed', 'one live allowance per client, month and scope');

  -- The table itself refuses direct writes.
  PERFORM t_raises(format($q$INSERT INTO public.manual_source_allowances (client_id, period_month, scope, reason, allowed_by) VALUES (%L, '09/2026', 'reco:receivable', 'typed by hand', %L)$q$, c1, s),
    'Only the superadmin gives or takes back', 'a direct insert of an allowance is refused');
  PERFORM t_raises(format($q$UPDATE public.manual_source_allowances SET used_at = now() WHERE id = %L$q$, a->>'id'),
    'Only the superadmin gives or takes back', 'a direct update of an allowance is refused');
  PERFORM t_raises(format($q$DELETE FROM public.manual_source_allowances WHERE id = %L$q$, a->>'id'),
    'Only the superadmin gives or takes back', 'a direct delete of an allowance is refused');

  -- Used once, by staff.
  PERFORM t_raises(format($q$SELECT public.reco_manual_opening(%L, 'suspended', %L, '09/2026', 'csv', '{"igst":0,"cgst":1200,"sgst":1200}'::jsonb, NULL, NULL, '08/2026')$q$, x, c1),
    'Only staff', 'a client login cannot enter an opening');
  v := public.reco_manual_opening(e, 'suspended', c1, '09/2026', 'csv', '{"igst":0,"cgst":1200,"sgst":1200}'::jsonb, NULL, NULL, '08/2026');
  PERFORM t_eq(v->>'allowance_id', a->>'id', 'the manual entry uses the allowance');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_source, 'csv', 'the allowed upload is recorded as CSV');
  PERFORM t_eq(r.opening_cgst, 1200::numeric, 'with its figures');
  PERFORM t_eq(r.opening_allowance_id::text, a->>'id', 'linked to its allowance');
  PERFORM t_eq(r.opening_csv_uploaded_by, e, 'stamped with who uploaded');
  PERFORM t_eq(r.portal_cgst, 6::numeric, 'the current-total snapshot is left as it was');
  PERFORM t_eq((SELECT used_by FROM public.manual_source_allowances WHERE id = (a->>'id')::uuid), e, 'the allowance records who used it');
  PERFORM t_raises(format($q$SELECT public.reco_manual_opening(%L, 'suspended', %L, '09/2026', 'not_applicable', NULL)$q$, e, c1),
    'No manual entry is allowed', 'an allowance is used once');

  -- Receivable: an allowed CSV upload carries ITC utilised and DRC-03.
  a := to_jsonb(public.manual_source_allow(s, c1, '09/2026', 'reco:receivable', 'GST portal down all day'));
  v := public.reco_manual_opening(m, 'receivable', c1, '09/2026', 'csv', '{"igst":10,"cgst":20,"sgst":30}'::jsonb,
    '{"igst":1,"cgst":2,"sgst":3}'::jsonb, '{"igst":0,"cgst":4,"sgst":4}'::jsonb, '07/2026');
  SELECT * INTO r FROM public.gst_receivable_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_source || r.opening_cgst::text || '/' || r.utilized_cgst::text || '/' || r.drc_cgst::text, 'csv20/2/4', 'the allowed receivable upload keeps opening, utilised and DRC-03');
  PERFORM t_eq(r.books_closing_cgst, 300::numeric, 'and leaves the typed books closing alone');

  -- Before 06/2026 nothing changes: the opening is typed.
  INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst, updated_by) VALUES (c1, '05/2026', 0, e);
  UPDATE public.suspended_reco SET opening_cgst = 77, opening_source = 'manual' WHERE client_id = c1 AND period_month = '05/2026';
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '05/2026';
  PERFORM t_eq(r.opening_cgst, 77::numeric, 'a typed opening before 06/2026 is kept');

  -- The pull: stamps who and when, clears CSV stamps and the allowance.
  v := public.reco_record_pull(e, 'suspended', c1, '09/2026', '{"igst":0,"cgst":500,"sgst":500}'::jsonb, NULL, NULL, '0.16.0');
  PERFORM t_eq((v->>'ok')::boolean, true, 'the pull is saved');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_source, 'portal', 'a pull is recorded as portal');
  PERFORM t_eq(r.opening_portal_pulled_by, e, 'with who asked for it');
  PERFORM t_eq(r.opening_portal_pulled_at IS NOT NULL, true, 'and when');
  PERFORM t_eq(r.opening_csv_period_month IS NULL AND r.opening_csv_uploaded_by IS NULL AND r.opening_allowance_id IS NULL, true,
    'the pull clears the CSV stamps and the allowance');
  PERFORM t_eq(r.opening_cgst, 500::numeric, 'the pulled opening replaces the manual one');
  PERFORM t_raises(format($q$SELECT public.reco_record_pull(%L, 'receivable', %L, '09/2026', '{"igst":0,"cgst":900,"sgst":900}'::jsonb)$q$, x, c1),
    'saved only for a staff member', 'a pull asked by a non-staff id is refused');
  v := public.reco_record_pull(m, 'receivable', c1, '09/2026', '{"igst":0,"cgst":900,"sgst":900}'::jsonb, '{"igst":0,"cgst":0,"sgst":0}'::jsonb, '{"igst":0,"cgst":0,"sgst":0}'::jsonb, '0.16.0');
  SELECT * INTO r FROM public.gst_receivable_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_portal_pulled_by, m, 'the receivable pull names who asked');
  PERFORM t_eq(r.utilized_cgst::text || '/' || r.drc_cgst::text || '/' || r.books_closing_cgst::text, '0/0/300', 'the pull writes utilised and DRC-03, not the books');
  PERFORM t_raises(format($q$SELECT public.reco_record_pull(%L, 'suspended', %L, '09/2026', '{"igst":"x","cgst":1,"sgst":1}'::jsonb)$q$, e, c1),
    'not a number', 'a pulled figure must be a number');
  PERFORM t_raises(format($q$SELECT public.reco_record_pull(%L, 'ledger', %L, '09/2026', '{"igst":0,"cgst":1,"sgst":1}'::jsonb)$q$, e, c1),
    'Unknown reco', 'only the two recos');

  -- Override: the superadmin and GST Managers, through reco_override_opening,
  -- with a reason; the time is the database's; a direct write is refused.
  v := public.reco_override_opening(m, 'suspended', c1, '09/2026', '{"igst":0,"cgst":450,"sgst":500}'::jsonb, 'Portal shows Rs 50 reclaimed late');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_cgst, 450::numeric, 'a GST Manager can override the opening');
  PERFORM t_eq(r.opening_source, 'portal', 'the override keeps the source');
  PERFORM t_eq(r.opening_override_by, m, 'the override names who made it');
  PERFORM t_eq(r.opening_override_base, '{"igst":0,"cgst":500,"sgst":500}'::jsonb, 'and keeps the pulled figure it replaced');
  PERFORM t_eq(r.opening_override_at > now() - interval '1 minute', true, 'the override time is the database''s');
  PERFORM t_raises(format($q$SELECT public.reco_override_opening(%L, 'suspended', %L, '09/2026', '{"igst":0,"cgst":1,"sgst":1}'::jsonb, 'employee wants it')$q$, e, c1),
    'Only the superadmin or a GST Manager', 'an employee cannot override');
  PERFORM t_raises(format($q$SELECT public.reco_override_opening(%L, 'suspended', %L, '09/2026', '{"igst":0,"cgst":1,"sgst":1}'::jsonb, 'ok')$q$, s, c1),
    'Give a reason', 'an override needs a reason');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_cgst = 1, opening_override_justification = 'typed by hand', opening_override_by = %L, opening_override_at = now() WHERE client_id = %L AND period_month = '09/2026'$q$, s, c1),
    'overridden only with the Override button', 'a direct override, even naming the superadmin, is refused');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_cgst = 1 WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'comes only from the portal pull', 'an overridden opening is not changed by a direct write');
  UPDATE public.suspended_reco SET portal_cgst = 7 WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_override_justification = NULL, opening_override_at = NULL, opening_override_by = NULL WHERE client_id = %L AND period_month = '09/2026'$q$, c1),
    'overridden only with the Override button', 'an override is not removed by hand');
  -- The superadmin overrides too.
  PERFORM public.reco_override_opening(s, 'receivable', c1, '09/2026', '{"igst":0,"cgst":800,"sgst":900}'::jsonb, 'Matches the ledger printout');
  -- A new pull of another figure clears the override.
  PERFORM public.reco_record_pull(m, 'suspended', c1, '09/2026', '{"igst":0,"cgst":520,"sgst":500}'::jsonb);
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = c1 AND period_month = '09/2026';
  PERFORM t_eq(r.opening_override_justification IS NULL AND r.opening_override_by IS NULL AND r.opening_override_base IS NULL, true, 'a new pull of another figure clears a stale override');
  PERFORM t_eq(r.opening_cgst, 520::numeric, 'and brings the new figure');
  PERFORM t_eq(r.opening_portal_pulled_by, m, 'and names the new puller');

  -- The pull closed the allowance the manual entry used: revoked by the
  -- puller (round 2), so no live allowance is left over a pulled month.
  SELECT to_jsonb(z) INTO a FROM public.manual_source_allowances z WHERE client_id = c1 AND period_month = '09/2026' AND scope = 'reco:suspended';
  PERFORM t_eq(a->>'revoked_by', e::text, 'the pull closed the used allowance, as revoked by the puller');
  PERFORM t_eq(a->>'used_by', e::text, 'and it still says who used it for the manual entry');
  -- Revoke: the superadmin's alone; a second revoke changes nothing.
  a := to_jsonb(public.manual_source_allow(s, c1, '10/2026', 'reco:suspended', 'portal down for the October pull'));
  PERFORM t_raises(format($q$SELECT public.manual_source_revoke(%L, %L)$q$, e, a->>'id'), 'Only the superadmin', 'an employee cannot revoke');
  v := to_jsonb(public.manual_source_revoke(s, (a->>'id')::uuid));
  PERFORM t_eq(v->>'revoked_by', s::text, 'the revoke records who');
  PERFORM t_eq(to_jsonb(public.manual_source_revoke(s, (a->>'id')::uuid))->>'revoked_at', v->>'revoked_at', 'a second revoke changes nothing');
  a := to_jsonb(public.manual_source_allow(s, c1, '10/2026', 'reco:suspended', 'portal locked the account again'));
  PERFORM t_eq(a->>'revoked_at', NULL, 'a new allowance can follow a revoked one');

  -- Everything is in the log, with who and why.
  SELECT count(*) INTO n FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended';
  PERFORM t_eq(n >= 5, true, 'the suspended reco changes are logged');
  PERFORM t_eq((SELECT actor_id FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'manual'), e,
    'the manual entry is logged with who');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'manual'),
    'portal password changed by the client', 'with the allowance''s reason');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'override'),
    'Portal shows Rs 50 reclaimed late', 'the override is logged with its reason');
  PERFORM t_eq((SELECT actor_id FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'override'), m,
    'and who overrode');
  SELECT count(*) INTO n FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'pull';
  PERFORM t_eq(n, 2, 'each pull is logged');
  PERFORM t_eq((SELECT count(*) FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '09/2026' AND reco = 'suspended' AND action = 'pull'
                   AND actor_id = e AND ext_version = '0.16.0'), 1::bigint, 'with who pulled and the extension version');
  PERFORM t_raises(format($q$INSERT INTO public.reco_opening_log (reco, client_id, period_month, action) VALUES ('suspended', %L, '09/2026', 'pull')$q$, c1),
    'row-level security', 'the log is not writable with the public key');

  -- Clear Data still deletes, and the delete is logged.
  DELETE FROM public.suspended_reco WHERE client_id = c1 AND period_month = '05/2026';
  SELECT count(*) INTO n FROM public.reco_opening_log WHERE client_id = c1 AND period_month = '05/2026' AND action = 'delete';
  PERFORM t_eq(n, 1, 'a cleared row is logged');

  -- What the app and the extension call is open to the public key; the internal helpers are not.
  PERFORM t_eq(has_function_privilege('anon', 'public.gstr3b_push_gate(uuid,text)', 'execute'), true, 'anon may call gstr3b_push_gate');
  PERFORM t_eq(has_function_privilege('anon', 'public.manual_source_allow(uuid,uuid,text,text,text)', 'execute'), true, 'anon may call manual_source_allow');
  PERFORM t_eq(has_function_privilege('anon', 'public.manual_source_revoke(uuid,uuid)', 'execute'), true, 'anon may call manual_source_revoke');
  PERFORM t_eq(has_function_privilege('anon', 'public.reco_record_pull(uuid,text,uuid,text,jsonb,jsonb,jsonb,text,boolean)', 'execute'), true, 'anon may call reco_record_pull');
  PERFORM t_eq(has_function_privilege('anon', 'public.reco_manual_opening(uuid,text,uuid,text,text,jsonb,jsonb,jsonb,text)', 'execute'), true, 'anon may call reco_manual_opening');
  PERFORM t_eq(has_function_privilege('anon', 'public.reco_override_opening(uuid,text,uuid,text,jsonb,text)', 'execute'), true, 'anon may call reco_override_opening');
  PERFORM t_eq(has_function_privilege('anon', 'public.reco_clear(uuid,text,uuid,text[])', 'execute'), true, 'anon may call reco_clear');
  PERFORM t_eq(has_function_privilege('anon', 'public.suspended_reco_difference(uuid,text)', 'execute'), true, 'anon may call suspended_reco_difference');
  PERFORM t_eq(has_function_privilege('anon', 'public.gst_receivable_reco_difference(uuid,text)', 'execute'), true, 'anon may call gst_receivable_reco_difference');
  PERFORM t_eq(has_function_privilege('anon', 'public.manual_source_take(uuid,uuid,text,text)', 'execute'), false, 'anon may not call manual_source_take');
  PERFORM t_eq(has_function_privilege('anon', 'public.reco_door(text,uuid,text,text)', 'execute'), false, 'anon may not call reco_door');
  PERFORM t_eq(to_regprocedure('public.reco_record_pull(uuid,text,uuid,text,jsonb,jsonb,jsonb,text)') IS NULL, true, 'the first draft''s pull signature is gone');
  PERFORM t_raises(format($q$SELECT public.manual_source_take(%L, %L, '09/2026', 'reco:suspended')$q$, e, c1),
    'permission denied', 'manual_source_take is refused to the public key');
END $$;

-- A client's deletion still removes its allowances (the cascade passes the guard).
RESET ROLE;
DO $$
DECLARE
  c9 uuid := '19999999-9999-9999-9999-999999999999';
BEGIN
  PERFORM public.manual_source_allow('00000000-0000-0000-0000-0000000000a1', c9, '09/2026', 'reco:suspended', 'client leaving the firm');
  DELETE FROM public.clients WHERE id = c9;
  PERFORM t_eq((SELECT count(*) FROM public.manual_source_allowances WHERE client_id = c9), 0::bigint, 'deleting a client removes its allowances');
END $$;
