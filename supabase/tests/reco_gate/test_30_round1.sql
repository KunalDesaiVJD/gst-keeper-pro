-- Round 1 of the review of 20261021120000: one block per defect found, each
-- run as the public key (SET ROLE anon), as PostgREST sends the app's and the
-- extension's writes. Every block failed on the first draft of the migration.
-- People: Sonal superadmin, Gita GST Manager, Emil and Esha employees, a
-- client login.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Sonal'),
  ('00000000-0000-0000-0000-0000000000c2', 'Gita'),
  ('00000000-0000-0000-0000-0000000000c3', 'Emil'),
  ('00000000-0000-0000-0000-0000000000c4', 'Esha');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000c2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000c3', 'employee'),
  ('00000000-0000-0000-0000-0000000000c4', 'employee'),
  ('00000000-0000-0000-0000-0000000000c5', 'client');
INSERT INTO public.clients (id, name, gstin, regular_sub_type, builder_itc_type) VALUES
  ('31000000-0000-0000-0000-000000000001', 'A OLD MONTH', '24AAAAA3001A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000002', 'B DIFFERENCE', '24AAAAA3002A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000003', 'C AUGUST', '24AAAAA3003A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000004', 'D PULLED', '24AAAAA3004A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000005', 'E OTHER', '24AAAAA3005A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000006', 'F LEAVING', '24AAAAA3006A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000007', 'G NIL NO ROWS', '24AAAAA3007A1Z5', 'Builder', 'NO_ITC'),
  ('31000000-0000-0000-0000-000000000008', 'H ALLOWED THEN PULLED', '24AAAAA3008A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000009', 'I OVERRIDE KEPT', '24AAAAA3009A1Z5', 'Normal', NULL),
  ('31000000-0000-0000-0000-000000000010', 'Z CLEARED', '24AAAAA3010A1Z5', 'Normal', NULL);

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- ── 1. A row cannot move to another month or client (high) ───────────────
DO $$
DECLARE
  ca uuid := '31000000-0000-0000-0000-000000000001';
  cb uuid := '31000000-0000-0000-0000-000000000002';
  cc uuid := '31000000-0000-0000-0000-000000000003';
  cd uuid := '31000000-0000-0000-0000-000000000004';
  ce uuid := '31000000-0000-0000-0000-000000000005';
  s uuid := '00000000-0000-0000-0000-0000000000c1';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  g jsonb;
BEGIN
  -- (a) A forged "pull" in an old month (allowed there, as before 06/2026) cannot be moved into 09/2026.
  INSERT INTO public.suspended_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES (ca, '01/2000', 'portal', now());
  INSERT INTO public.gst_receivable_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES (ca, '01/2000', 'portal', now());
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET period_month = '09/2026' WHERE client_id = %L AND period_month = '01/2000'$q$, ca),
    'stays with its client and month', 'D1a: an old-month row is not moved into 09/2026');
  PERFORM t_raises(format($q$UPDATE public.gst_receivable_reco SET period_month = '09/2026' WHERE client_id = %L AND period_month = '01/2000'$q$, ca),
    'stays with its client and month', 'D1a: nor the receivable');
  g := public.gstr3b_push_gate(ca, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'D1a: the gate still blocks');
  PERFORM t_eq((SELECT count(*) FROM public.reco_opening_log WHERE client_id = ca AND period_month = '09/2026'), 0::bigint, 'D1a: nothing reached 09/2026');

  -- (b) A pulled difference cannot be cleared by a trip through an old month.
  PERFORM public.reco_record_pull(e, 'suspended', cb, '09/2026', '{"igst":5000,"cgst":0,"sgst":0}');
  PERFORM public.reco_record_pull(e, 'receivable', cb, '09/2026', z, z, z);
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET period_month = '12/2025', opening_igst = 0 WHERE client_id = %L AND period_month = '09/2026'$q$, cb),
    'stays with its client and month', 'D1b: a 09/2026 row is not moved to an old month');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET period_month = '12/2025' WHERE client_id = %L AND period_month = '09/2026'$q$, cb),
    'stays with its client and month', 'D1b: not even unchanged');
  g := public.gstr3b_push_gate(cb, '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 has a difference of ₹5000.00.', 'D1b: the difference still blocks');

  -- (c) August's pull cannot become September's.
  PERFORM public.reco_record_pull(e, 'suspended', cc, '08/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', cc, '08/2026', z, z, z);
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET period_month = '09/2026' WHERE client_id = %L AND period_month = '08/2026'$q$, cc),
    'stays with its client and month', 'D1c: a row is not moved between two new months');
  PERFORM t_eq((public.gstr3b_push_gate(cc, '09/2026')->>'ok')::boolean, false, 'D1c: September is still not pulled');

  -- (d) One client's pull cannot become another's.
  PERFORM public.reco_record_pull(e, 'receivable', cd, '09/2026', z, z, z);
  PERFORM t_raises(format($q$UPDATE public.gst_receivable_reco SET client_id = %L WHERE client_id = %L AND period_month = '09/2026'$q$, ce, cd),
    'stays with its client and month', 'D1d: a row is not moved to another client');
  PERFORM t_eq(public.gstr3b_push_gate(ce, '09/2026')->'receivable'->>'status', 'missing', 'D1d: the other client still has none');
END $$;

-- (e) An allowance counts only for its own client and month. The link is
-- forced here as the owner (no door lets the app write it).
RESET ROLE;
DO $$
DECLARE
  ca uuid := '31000000-0000-0000-0000-000000000001';
  ce uuid := '31000000-0000-0000-0000-000000000005';
  s uuid := '00000000-0000-0000-0000-0000000000c1';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  a uuid;
BEGIN
  a := (public.manual_source_allow(s, ca, '09/2026', 'reco:suspended', 'Portal password refused')).id;
  PERFORM public.reco_manual_opening(e, 'suspended', ca, '09/2026', 'not_applicable', NULL);
  PERFORM public.t_eq(public.gstr3b_push_gate(ca, '09/2026')->'suspended'->>'status', 'manual', 'D1e: the allowed client reads manual');
  PERFORM public.reco_door('manual', e);
  INSERT INTO public.suspended_reco (client_id, period_month, opening_source, opening_allowance_id) VALUES (ce, '09/2026', 'not_applicable', a);
  PERFORM public.reco_door(NULL, NULL);
  PERFORM public.t_eq(public.gstr3b_push_gate(ce, '09/2026')->'suspended'->>'status', 'not_pulled', 'D1e: another client''s allowance does not count');
  DELETE FROM public.suspended_reco WHERE client_id = ce AND period_month = '09/2026';
END $$;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- ── 2. A client with reco rows can be deleted; the log stays (medium) ────
DO $$
DECLARE
  cf uuid := '31000000-0000-0000-0000-000000000006';
  s uuid := '00000000-0000-0000-0000-0000000000c1';
  m uuid := '00000000-0000-0000-0000-0000000000c2';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  n bigint;
BEGIN
  PERFORM public.reco_record_pull(e, 'suspended', cf, '09/2026', '{"igst":0,"cgst":700,"sgst":0}');
  PERFORM public.reco_record_pull(e, 'receivable', cf, '09/2026', z, z, z);
  PERFORM public.manual_source_allow(s, cf, '08/2026', 'reco:receivable', 'Portal down for August');
  PERFORM public.reco_manual_opening(e, 'receivable', cf, '08/2026', 'not_applicable', NULL);
  DELETE FROM public.clients WHERE id = cf;
  PERFORM t_eq((SELECT count(*) FROM public.clients WHERE id = cf), 0::bigint, 'D2: the client with reco rows is deleted');
  PERFORM t_eq((SELECT count(*) FROM public.suspended_reco WHERE client_id = cf) + (SELECT count(*) FROM public.gst_receivable_reco WHERE client_id = cf), 0::bigint,
    'D2: with its reco rows');
  PERFORM t_eq((SELECT count(*) FROM public.manual_source_allowances WHERE client_id = cf), 0::bigint, 'D2: and its allowances');
  SELECT count(*) INTO n FROM public.reco_opening_log WHERE client_id = cf AND action = 'delete' AND reason = 'Client deleted' AND actor_id IS NULL;
  PERFORM t_eq(n, 3::bigint, 'D2: each reco row''s deletion is logged as the client''s deletion');
  PERFORM t_eq((SELECT count(*) FROM public.reco_opening_log WHERE client_id = cf AND action IN ('pull', 'manual')) >= 3, true,
    'D2: and the earlier history stays');
END $$;

-- ── 3. An override is made only through its door, by its person (medium) ─
DO $$
DECLARE
  cd uuid := '31000000-0000-0000-0000-000000000004';
  m uuid := '00000000-0000-0000-0000-0000000000c2';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  r record;
BEGIN
  PERFORM public.reco_record_pull(e, 'suspended', cd, '09/2026', '{"igst":700,"cgst":0,"sgst":0}');
  PERFORM public.reco_override_opening(m, 'suspended', cd, '09/2026', '{"igst":100,"cgst":0,"sgst":0}', 'Portal shows 100 after DRC');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_igst = 0, opening_override_at = '2000-01-01' WHERE client_id = %L AND period_month = '09/2026'$q$, cd),
    'overridden only with the Override button', 'D3: changing the override time does not open the opening');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_igst = 0, opening_override_by = %L WHERE client_id = %L AND period_month = '09/2026'$q$,
    '00000000-0000-0000-0000-0000000000c1', cd),
    'overridden only with the Override button', 'D3: naming the superadmin does not either');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_igst = 0 WHERE client_id = %L AND period_month = '09/2026'$q$, cd),
    'comes only from the portal pull', 'D3: nor a plain write');
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_igst, opening_override_justification, opening_override_by, opening_override_at)
    VALUES (%L, '10/2026', 50, 'typed override', %L, now())$q$, cd, m),
    'overridden only with the Override button', 'D3: nor a new row carrying an override');
  PERFORM t_raises(format($q$SELECT public.reco_override_opening(%L, 'suspended', %L, '10/2026', '{"igst":0,"cgst":0,"sgst":0}'::jsonb, 'nothing pulled yet')$q$, m, cd),
    'Pull it from the portal first', 'D3: from 06/2026 only a pulled opening is overridden');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cd AND period_month = '09/2026';
  PERFORM t_eq(r.opening_igst, 100::numeric, 'D3: the overridden opening stands');
  PERFORM t_eq((SELECT count(*) FROM public.reco_opening_log WHERE client_id = cd AND period_month = '09/2026' AND reco = 'suspended' AND action = 'override'), 1::bigint,
    'D3: one override in the log');
  PERFORM t_eq((SELECT actor_id FROM public.reco_opening_log WHERE client_id = cd AND period_month = '09/2026' AND reco = 'suspended' AND action = 'override'), m,
    'D3: credited to the GST Manager who made it');
END $$;

-- ── 4. A pull is recorded only for a staff member (medium) ───────────────
DO $$
DECLARE
  ce uuid := '31000000-0000-0000-0000-000000000005';
  x uuid := '00000000-0000-0000-0000-0000000000c5';
BEGIN
  PERFORM t_raises(format($q$SELECT public.reco_record_pull(NULL, 'suspended', %L, '09/2026', '{"igst":0,"cgst":0,"sgst":0}'::jsonb, NULL, NULL, 'forged')$q$, ce),
    'saved only for a staff member', 'D4: an anonymous pull is refused');
  PERFORM t_raises(format($q$SELECT public.reco_record_pull(%L, 'suspended', %L, '09/2026', '{"igst":0,"cgst":0,"sgst":0}'::jsonb)$q$, x, ce),
    'saved only for a staff member', 'D4: a client login''s pull is refused');
  PERFORM t_raises(format($q$SELECT public.reco_record_pull('00000000-0000-0000-0000-0000000000ff', 'suspended', %L, '09/2026', '{"igst":0,"cgst":0,"sgst":0}'::jsonb)$q$, ce),
    'saved only for a staff member', 'D4: an unknown id''s pull is refused');
  PERFORM t_eq(public.gstr3b_push_gate(ce, '09/2026')->'suspended'->>'status', 'missing', 'D4: nothing was saved');
END $$;

-- ── 5. A month with no balance row on the portal is a pull of 0 (medium) ─
DO $$
DECLARE
  cg uuid := '31000000-0000-0000-0000-000000000007';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  g jsonb;
  r record;
BEGIN
  INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_nil) VALUES (cg, 'GSTR-3B', '09/2026', 'Prepared', true);
  PERFORM public.reco_record_pull(e, 'receivable', cg, '09/2026', z, NULL, z, '0.16.0');
  PERFORM public.reco_record_pull(e, 'suspended', cg, '09/2026', NULL, NULL, NULL, '0.16.0', true);
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cg AND period_month = '09/2026';
  PERFORM t_eq(r.opening_source || '/' || r.opening_portal_empty::text || '/' || r.opening_igst::text || '/' || r.opening_cgst::text || '/' || r.opening_sgst::text,
    'portal/true/0/0/0', 'D5: saved as a pull of 0, marked empty');
  g := public.gstr3b_push_gate(cg, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'D5: the Nil client passes by pulling, no allowance needed');
  PERFORM t_eq((g->'suspended'->>'empty')::boolean, true, 'D5: the gate says the portal had no balance row');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = cg AND reco = 'suspended' AND action = 'pull'),
    'No balance row on the portal for the month; saved as 0.', 'D5: and the log says so');
  -- A later pull that finds a row clears the mark.
  PERFORM public.reco_record_pull(e, 'suspended', cg, '09/2026', z, NULL, NULL, '0.16.0');
  PERFORM t_eq((SELECT opening_portal_empty FROM public.suspended_reco WHERE client_id = cg AND period_month = '09/2026'), false, 'D5: a pull with a row clears the mark');
  PERFORM t_raises(format($q$UPDATE public.suspended_reco SET opening_portal_empty = true WHERE client_id = %L AND period_month = '09/2026'$q$, cg),
    'comes only from the portal pull', 'D5: the mark is the pull''s to write');
END $$;

-- ── 6. A delete names who did it, or nobody (medium) ─────────────────────
DO $$
DECLARE
  cz uuid := '31000000-0000-0000-0000-000000000010';
  s uuid := '00000000-0000-0000-0000-0000000000c1';
  m uuid := '00000000-0000-0000-0000-0000000000c2';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  x uuid := '00000000-0000-0000-0000-0000000000c5';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  n integer;
BEGIN
  PERFORM public.reco_record_pull(e, 'suspended', cz, '09/2026', '{"igst":0,"cgst":10,"sgst":10}');
  PERFORM public.reco_record_pull(e, 'suspended', cz, '08/2026', z);
  -- A direct delete (an old Clear Data) names nobody, not the last saver.
  DELETE FROM public.suspended_reco WHERE client_id = cz AND period_month = '09/2026';
  PERFORM t_eq((SELECT actor_id FROM public.reco_opening_log WHERE client_id = cz AND period_month = '09/2026' AND action = 'delete'), NULL::uuid,
    'D6: a direct delete is not credited to the last person who pulled or saved');
  -- Clear Data through its door names who cleared.
  PERFORM t_raises(format($q$SELECT public.reco_clear(%L, 'suspended', %L, ARRAY['08/2026'])$q$, x, cz), 'Only staff', 'D6: a client login cannot clear');
  n := public.reco_clear(s, 'suspended', cz, ARRAY['08/2026']);
  PERFORM t_eq(n, 1, 'D6: Clear Data deletes the month');
  PERFORM t_eq((SELECT actor_id::text || '/' || reason FROM public.reco_opening_log WHERE client_id = cz AND period_month = '08/2026' AND action = 'delete'),
    s::text || '/Clear Data', 'D6: and the log names who cleared');
END $$;

-- ── 10. An open allowance does not outlive a pull (medium) ───────────────
DO $$
DECLARE
  ch uuid := '31000000-0000-0000-0000-000000000008';
  s uuid := '00000000-0000-0000-0000-0000000000c1';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  a public.manual_source_allowances;
  v jsonb;
BEGIN
  a := public.manual_source_allow(s, ch, '09/2026', 'reco:suspended', 'Portal down this morning');
  v := public.reco_record_pull(e, 'suspended', ch, '09/2026', '{"igst":0,"cgst":600,"sgst":600}', NULL, NULL, '0.16.0');
  PERFORM public.reco_record_pull(e, 'receivable', ch, '09/2026', z, z, z, '0.16.0');
  PERFORM t_eq(v->>'allowance_closed', a.id::text, 'D10: the pull closes the open allowance');
  PERFORM t_eq((SELECT used_by FROM public.manual_source_allowances WHERE id = a.id), e, 'D10: as used by the puller');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = ch AND reco = 'suspended' AND action = 'pull'),
    'The manual entry allowed for the month was closed by this pull.', 'D10: and the log says so');
  PERFORM t_raises(format($q$SELECT public.reco_manual_opening(%L, 'suspended', %L, '09/2026', 'not_applicable', NULL)$q$, e, ch),
    'already pulled from the portal', 'D10: Not Applicable cannot replace the pulled figure');
  -- Even with a fresh allowance, a pulled month is not entered by hand.
  PERFORM public.manual_source_revoke(s, a.id);
  PERFORM public.manual_source_allow(s, ch, '09/2026', 'reco:suspended', 'Second try by hand');
  PERFORM t_raises(format($q$SELECT public.reco_manual_opening(%L, 'suspended', %L, '09/2026', 'not_applicable', NULL)$q$, e, ch),
    'already pulled from the portal', 'D10: not even under a new allowance');
  PERFORM t_eq(public.gstr3b_push_gate(ch, '09/2026')->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 has a difference of ₹1200.00.',
    'D10: the portal''s difference still blocks');
END $$;

-- ── 11. A re-pull of the same figure keeps an override (medium) ──────────
DO $$
DECLARE
  ci uuid := '31000000-0000-0000-0000-000000000009';
  m uuid := '00000000-0000-0000-0000-0000000000c2';
  e uuid := '00000000-0000-0000-0000-0000000000c3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  v jsonb;
  g jsonb;
BEGIN
  PERFORM public.reco_record_pull(e, 'suspended', ci, '09/2026', '{"igst":0,"cgst":500,"sgst":500}');
  PERFORM public.reco_record_pull(e, 'receivable', ci, '09/2026', z, z, z);
  PERFORM public.reco_override_opening(m, 'suspended', ci, '09/2026', z, 'Reclaimed in GSTR-3B, portal lags');
  PERFORM public.reco_override_opening(m, 'suspended', ci, '09/2026', '{"igst":0,"cgst":0,"sgst":0.5}', 'Rounding on the portal');
  PERFORM t_eq((SELECT opening_override_base FROM public.suspended_reco WHERE client_id = ci AND period_month = '09/2026'),
    '{"igst":0,"cgst":500,"sgst":500}'::jsonb, 'D11: a second override keeps the pulled figure the first replaced');
  PERFORM t_eq((public.gstr3b_push_gate(ci, '09/2026')->>'ok')::boolean, true, 'D11: the override clears the difference');
  -- Pull on the GST Receivable Reco page pulls both: same portal figure.
  PERFORM public.reco_record_pull(e, 'receivable', ci, '09/2026', z, z, z);
  v := public.reco_record_pull(e, 'suspended', ci, '09/2026', '{"igst":0,"cgst":500,"sgst":500}');
  PERFORM t_eq(v->>'override', 'kept', 'D11: a re-pull of the same figure keeps the override');
  g := public.gstr3b_push_gate(ci, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'D11: and the gate stays clear');
  PERFORM t_eq(g->'suspended'->'override'->>'by_name', 'Gita', 'D11: still credited to its maker');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = ci AND reco = 'suspended' AND action = 'pull' AND reason LIKE 'Override%'),
    'Override by Gita kept: the portal figure is the one it was made against.', 'D11: the log says it was kept');
  -- The portal moves: the override is stale and goes.
  v := public.reco_record_pull(e, 'suspended', ci, '09/2026', '{"igst":0,"cgst":600,"sgst":500}');
  PERFORM t_eq(v->>'override', 'cleared', 'D11: a different figure clears it');
  g := public.gstr3b_push_gate(ci, '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 has a difference of ₹1100.00.', 'D11: and the new difference blocks');
  PERFORM t_eq((SELECT count(*) FROM public.reco_opening_log WHERE client_id = ci AND reco = 'suspended' AND action = 'pull'
                   AND reason = 'Override by Gita cleared: the portal figure is not the one it was made against.'), 1::bigint,
    'D11: the log names the cleared override');
END $$;
