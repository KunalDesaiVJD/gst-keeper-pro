-- Round 2 of the review of 20261021120000: one block per database defect,
-- run as the public key (SET ROLE anon), as PostgREST sends the app's and the
-- extension's writes. Every block failed on the round 1 migration (48eedfb).
-- The concurrent Clear Data / insert race is race.sh.
-- People: Ravi superadmin, Mona GST Manager, Neel employee.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Ravi'),
  ('00000000-0000-0000-0000-0000000000d2', 'Mona'),
  ('00000000-0000-0000-0000-0000000000d3', 'Neel');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000d2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000d3', 'employee');
INSERT INTO public.clients (id, name, gstin, regular_sub_type, builder_itc_type) VALUES
  ('32000000-0000-0000-0000-000000000001', 'HEADS SUSPENDED', '24AAAAA4001A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000002', 'HEADS RECEIVABLE', '24AAAAA4002A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000003', 'LEGACY OVERRIDE', '24AAAAA4003A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000004', 'LEGACY RE-OVERRIDE', '24AAAAA4004A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000005', 'PUSH NOT PULLED', '24AAAAA4005A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000006', 'PUSH READY', '24AAAAA4006A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000007', 'INSERT OVER A ROW', '24AAAAA4007A1Z5', 'Normal', NULL),
  ('32000000-0000-0000-0000-000000000008', 'ALLOWED, USED, PULLED', '24AAAAA4008A1Z5', 'Normal', NULL);

-- Defect 2 needs overrides made before the migration: written with the
-- triggers off (as the owner), with no opening_override_base, as the 8 live
-- Suspended Reco overrides are.
SET session_replication_role = replica;
INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst, opening_source, opening_portal_pulled_at,
                                   opening_override_justification, opening_override_at, opening_override_by)
VALUES ('32000000-0000-0000-0000-000000000003', '09/2026', 800, 'portal', now() - interval '2 days',
        'Reclaim posted next month', now() - interval '1 day', '00000000-0000-0000-0000-0000000000d1'),
       ('32000000-0000-0000-0000-000000000004', '09/2026', 800, 'portal', now() - interval '2 days',
        'Reclaim posted next month', now() - interval '1 day', '00000000-0000-0000-0000-0000000000d1');
SET session_replication_role = origin;
INSERT INTO public.bills_not_in_2b (client_id, period_month, input_igst, input_cgst, input_sgst, reversal_month) VALUES
  ('32000000-0000-0000-0000-000000000001', '09/2026', 0, 500, 500, 'Aug-26'),
  ('32000000-0000-0000-0000-000000000003', '09/2026', 0, 800, 0, 'Aug-26'),
  ('32000000-0000-0000-0000-000000000004', '09/2026', 0, 700, 0, 'Aug-26');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- ── 1. Heads that offset in the total do not pass (medium) ───────────────
DO $$
DECLARE
  ca uuid := '32000000-0000-0000-0000-000000000001';
  cb uuid := '32000000-0000-0000-0000-000000000002';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  m uuid := '00000000-0000-0000-0000-0000000000d2';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  d jsonb;
  g jsonb;
BEGIN
  -- (a) Suspended Reco: IGST 1,000 on the portal, the same reversal booked as CGST 500 + SGST 500.
  PERFORM public.reco_record_pull(e, 'suspended', ca, '09/2026', '{"igst":1000,"cgst":0,"sgst":0}');
  PERFORM public.reco_record_pull(e, 'receivable', ca, '09/2026', z, z, z);
  d := public.suspended_reco_difference(ca, '09/2026');
  PERFORM t_eq(ARRAY[(d->>'igst')::numeric, (d->>'cgst')::numeric, (d->>'sgst')::numeric, (d->>'total')::numeric],
    ARRAY[1000, -500, -500, 0]::numeric[], 'D1a: the heads offset to a total of 0');
  g := public.gstr3b_push_gate(ca, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'D1a: heads that offset block the push');
  PERFORM t_eq(g->'reasons'->0->>'code', 'suspended_difference', 'D1a: as a Suspended Reco difference');
  PERFORM t_eq(g->'reasons'->0->>'message',
    'Suspended Reco for Sep 2026 has a difference under IGST ₹1000.00, CGST ₹-500.00, SGST ₹-500.00 (total ₹0.00). Each head must tally, not only the total.',
    'D1a: naming each head');
  -- An override that puts the credit under the right heads clears it.
  PERFORM public.reco_override_opening(m, 'suspended', ca, '09/2026', '{"igst":0,"cgst":500,"sgst":500}', 'Portal shows IGST, books CGST and SGST');
  PERFORM t_eq((public.gstr3b_push_gate(ca, '09/2026')->>'ok')::boolean, true, 'D1a: an override by head clears it');

  -- (b) GST Receivable Reco: IGST 1,000 on the portal, books closing typed as CGST 500 + SGST 500.
  PERFORM public.reco_record_pull(e, 'suspended', cb, '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', cb, '09/2026', '{"igst":1000,"cgst":0,"sgst":0}', z, z);
  UPDATE public.gst_receivable_reco SET books_closing_cgst = 500, books_closing_sgst = 500 WHERE client_id = cb AND period_month = '09/2026';
  d := public.gst_receivable_reco_difference(cb, '09/2026');
  PERFORM t_eq(ARRAY[(d->>'igst')::numeric, (d->>'cgst')::numeric, (d->>'sgst')::numeric, (d->>'total')::numeric],
    ARRAY[1000, -500, -500, 0]::numeric[], 'D1b: the heads offset to a total of 0');
  g := public.gstr3b_push_gate(cb, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'D1b: heads that offset block the push');
  PERFORM t_eq(g->'reasons'->0->>'code', 'receivable_difference', 'D1b: as a GST Receivable Reco difference');
  -- Within ₹10 a head still reads 0: a ₹8 head left over passes.
  UPDATE public.gst_receivable_reco SET books_closing_igst = 992, books_closing_cgst = 0, books_closing_sgst = 0 WHERE client_id = cb AND period_month = '09/2026';
  PERFORM t_eq((public.gstr3b_push_gate(cb, '09/2026')->>'ok')::boolean, true, 'D1b: the ₹10 tolerance per head stays');
  -- One head off on its own keeps the plain wording.
  UPDATE public.gst_receivable_reco SET books_closing_igst = 750 WHERE client_id = cb AND period_month = '09/2026';
  PERFORM t_eq(public.gstr3b_push_gate(cb, '09/2026')->'reasons'->0->>'message', 'GST Receivable Reco for Sep 2026 has a difference of ₹250.00.',
    'D1b: a single head says the amount, as before');
END $$;

-- ── 2. An override made before the migration survives a re-pull (medium) ──
DO $$
DECLARE
  cl uuid := '32000000-0000-0000-0000-000000000003';
  cr uuid := '32000000-0000-0000-0000-000000000004';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  m uuid := '00000000-0000-0000-0000-0000000000d2';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  v jsonb;
  r public.suspended_reco;
BEGIN
  PERFORM public.reco_record_pull(e, 'receivable', cl, '09/2026', z, z, z);
  PERFORM t_eq((public.gstr3b_push_gate(cl, '09/2026')->>'ok')::boolean, true, 'D2: the legacy override clears the difference');
  -- The Pull on either reco page pulls both ledgers: the portal still shows 1,000.
  v := public.reco_record_pull(e, 'suspended', cl, '09/2026', '{"igst":0,"cgst":1000,"sgst":0}');
  PERFORM t_eq(v->>'override', 'kept', 'D2: a pull keeps an override with no recorded base');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cl AND period_month = '09/2026';
  PERFORM t_eq(r.opening_cgst, 800::numeric, 'D2: the overridden opening stays');
  PERFORM t_eq(r.opening_override_base, '{"igst":0,"cgst":1000,"sgst":0}'::jsonb, 'D2: its base is set from this pull');
  PERFORM t_eq((public.gstr3b_push_gate(cl, '09/2026')->>'ok')::boolean, true, 'D2: and the gate stays clear');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = cl AND reco = 'suspended' AND action = 'pull'),
    'Override by Ravi kept (no base was recorded; base set from this pull).', 'D2: the log says why it was kept');
  -- From then on the base decides: the same figure keeps it, another clears it.
  PERFORM t_eq(public.reco_record_pull(e, 'suspended', cl, '09/2026', '{"igst":0,"cgst":1000,"sgst":0}')->>'override', 'kept', 'D2: the same figure again keeps it');
  PERFORM t_eq(public.reco_record_pull(e, 'suspended', cl, '09/2026', '{"igst":0,"cgst":1200,"sgst":0}')->>'override', 'cleared', 'D2: a new figure clears it');

  -- A GST Manager re-overrides a legacy override before any pull: the base
  -- stays unknown (SQL NULL, never JSON null), so the next pull keeps it.
  PERFORM public.reco_record_pull(e, 'receivable', cr, '09/2026', z, z, z);
  PERFORM public.reco_override_opening(m, 'suspended', cr, '09/2026', '{"igst":0,"cgst":700,"sgst":0}', 'Books now show 700');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cr AND period_month = '09/2026';
  PERFORM t_eq(r.opening_override_base IS NULL, true, 'D2: a re-override of a legacy override stores no base');
  v := public.reco_record_pull(e, 'suspended', cr, '09/2026', '{"igst":0,"cgst":1000,"sgst":0}');
  PERFORM t_eq(v->>'override', 'kept', 'D2: the next pull keeps it');
  PERFORM t_eq((SELECT opening_cgst::text || '/' || (opening_override_base->>'cgst') FROM public.suspended_reco WHERE client_id = cr AND period_month = '09/2026'),
    '700/1000', 'D2: with the GST Manager''s figure and the pulled base');
  PERFORM t_eq((public.gstr3b_push_gate(cr, '09/2026')->>'ok')::boolean, true, 'D2: the gate passes');
END $$;

-- ── 3. A recorded push carries the database's own gate answer (medium) ───
DO $$
DECLARE
  cn uuid := '32000000-0000-0000-0000-000000000005';
  cy uuid := '32000000-0000-0000-0000-000000000006';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
  pv public.gstr3b_push_versions;
BEGIN
  PERFORM t_eq((public.gstr3b_push_gate(cn, '09/2026')->>'ok')::boolean, false, 'D3: never pulled, the gate says no');
  -- An extension older than 0.16.0 (no gate), or a forged row claiming one.
  INSERT INTO public.gstr3b_push_versions (client_id, period_month, actor_id, status, summary, gate)
  VALUES (cn, '09/2026', e, 'ok', 'old extension', '{"ok":true}') RETURNING * INTO pv;
  PERFORM t_eq(pv.gate->>'ok', 'false', 'D3: the row keeps the database''s answer, not the one sent');
  PERFORM t_eq(pv.gate->>'checked_by', 'database', 'D3: marked as the database''s');
  PERFORM t_eq(pv.gate->>'sent_ok', 'true', 'D3: what the sender claimed is kept apart');
  PERFORM t_eq(pv.gate->'reasons'->0->>'code', 'suspended_not_pulled', 'D3: with the reasons');
  PERFORM t_eq((SELECT count(*) FROM public.filing_status WHERE client_id = cn AND status::text = 'Pushed'), 0::bigint,
    'D3: a push the gate did not pass does not mark the return Pushed');
  INSERT INTO public.gstr3b_push_versions (client_id, period_month, actor_id, status, summary)
  VALUES (cn, '09/2026', e, 'ok', 'old extension, no gate column') RETURNING * INTO pv;
  PERFORM t_eq(pv.gate->>'ok', 'false', 'D3: a row sent with no gate gets the database''s answer too');
  PERFORM t_raises(format($q$UPDATE public.gstr3b_push_versions SET gate = '{"ok":true}' WHERE id = %L$q$, pv.id),
    'keeps its client, month and gate check', 'D3: the gate of a recorded push cannot be rewritten');
  -- A client that passes: the push is recorded and marks the return Pushed, as before.
  PERFORM public.reco_record_pull(e, 'suspended', cy, '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', cy, '09/2026', z, z, z);
  INSERT INTO public.gstr3b_push_versions (client_id, period_month, actor_id, status, summary)
  VALUES (cy, '09/2026', e, 'ok', 'Filled 12') RETURNING * INTO pv;
  PERFORM t_eq(pv.gate->>'ok', 'true', 'D3: a passing gate is recorded');
  PERFORM t_eq((SELECT status::text FROM public.filing_status WHERE client_id = cy AND return_type = 'GSTR-3B' AND period_month = '09/2026'), 'Pushed',
    'D3: and marks the return Pushed');
  -- A failed push is recorded with the answer too, and marks nothing.
  INSERT INTO public.gstr3b_push_versions (client_id, period_month, actor_id, status, summary)
  VALUES (cn, '09/2026', e, 'failed', 'portal timed out') RETURNING * INTO pv;
  PERFORM t_eq(pv.gate->>'ok', 'false', 'D3: a failed push carries the answer as well');
END $$;

-- ── 4. An insert is always checked (low; the two-session race is race.sh) ─
DO $$
DECLARE
  ci uuid := '32000000-0000-0000-0000-000000000007';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  s uuid := '00000000-0000-0000-0000-0000000000d1';
BEGIN
  -- A row not pulled (a Save created it).
  INSERT INTO public.suspended_reco (client_id, period_month, portal_cgst) VALUES (ci, '09/2026', 0)
    ON CONFLICT (client_id, period_month) DO UPDATE SET portal_cgst = EXCLUDED.portal_cgst;
  -- An insert claiming a pull over it is refused by the guard itself, not
  -- left to the unique index (the shortcut skipped every check here).
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES (%L, '09/2026', 'portal', now())$q$, ci),
    'comes only from the portal pull', 'D4: an insert over an existing row is checked');
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES (%L, '09/2026', 'portal', now()) ON CONFLICT DO NOTHING$q$, ci),
    'comes only from the portal pull', 'D4: with ON CONFLICT DO NOTHING too');
  PERFORM t_raises(format($q$INSERT INTO public.suspended_reco (client_id, period_month, opening_override_justification, opening_override_by, opening_override_at) VALUES (%L, '09/2026', 'typed', %L, now()) ON CONFLICT DO NOTHING$q$, ci, s),
    'overridden only with the Override button', 'D4: and an override insert over an existing row');
  -- The app's Saves still pass, a new row and an existing one.
  INSERT INTO public.gst_receivable_reco (client_id, period_month, books_closing_cgst, updated_by) VALUES (ci, '09/2026', 10, e)
    ON CONFLICT (client_id, period_month) DO UPDATE SET books_closing_cgst = EXCLUDED.books_closing_cgst;
  INSERT INTO public.gst_receivable_reco (client_id, period_month, books_closing_cgst, updated_by) VALUES (ci, '09/2026', 20, e)
    ON CONFLICT (client_id, period_month) DO UPDATE SET books_closing_cgst = EXCLUDED.books_closing_cgst;
  INSERT INTO public.suspended_reco (client_id, period_month, portal_cgst, updated_by) VALUES (ci, '09/2026', 5, e)
    ON CONFLICT (client_id, period_month) DO UPDATE SET portal_cgst = EXCLUDED.portal_cgst;
  PERFORM t_eq((SELECT books_closing_cgst FROM public.gst_receivable_reco WHERE client_id = ci AND period_month = '09/2026'), 20::numeric,
    'D4: the Saves still go through');
END $$;

-- ── 6. A pull closes a live allowance as revoked, not as used (medium) ───
DO $$
DECLARE
  cu uuid := '32000000-0000-0000-0000-000000000008';
  s uuid := '00000000-0000-0000-0000-0000000000d1';
  e uuid := '00000000-0000-0000-0000-0000000000d3';
  a public.manual_source_allowances;
  g jsonb;
BEGIN
  -- Allowed, used for Not Applicable, then the pull works after all.
  a := public.manual_source_allow(s, cu, '09/2026', 'reco:suspended', 'portal password wrong');
  PERFORM public.reco_manual_opening(e, 'suspended', cu, '09/2026', 'not_applicable', NULL);
  PERFORM public.reco_record_pull(e, 'suspended', cu, '09/2026', '{"igst":0,"cgst":0,"sgst":0}');
  SELECT * INTO a FROM public.manual_source_allowances WHERE id = a.id;
  PERFORM t_eq(a.revoked_by, e, 'D6: the pull closes the used allowance, revoked by the puller');
  PERFORM t_eq(a.used_by, e, 'D6: the manual entry it was used for stays on record');
  PERFORM t_eq((SELECT count(*) FROM public.manual_source_allowances WHERE client_id = cu AND period_month = '09/2026'
                   AND scope = 'reco:suspended' AND revoked_at IS NULL), 0::bigint, 'D6: no live allowance is left over the pulled month');
  g := public.gstr3b_push_gate(cu, '09/2026');
  PERFORM t_eq(g->'suspended'->>'status', 'pulled', 'D6: the month reads pulled');
  PERFORM t_eq(g->'suspended'->'allowance', 'null'::jsonb, 'D6: with no manual allowance attached');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = cu AND reco = 'suspended' AND action = 'pull'),
    'The manual entry allowed for the month (used) was closed by this pull.', 'D6: the log says which');
END $$;
