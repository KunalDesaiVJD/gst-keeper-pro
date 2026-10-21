-- Round 3 of the review of 20261021120000: one block per database finding,
-- run as the public key (SET ROLE anon), as PostgREST sends the app's and the
-- extension's calls. Every block failed on the round 2 migration (d722ee4).
-- The GSTR-3B page's findings are checked by scripts/verify-reco-gate.mjs.
-- People: Ravi superadmin, Mona GST Manager, Neel employee.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'Sonal'),
  ('00000000-0000-0000-0000-0000000000e2', 'Mona'),
  ('00000000-0000-0000-0000-0000000000e3', 'Neel');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000e2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000e3', 'employee');
INSERT INTO public.clients (id, name, gstin, regular_sub_type, builder_itc_type) VALUES
  ('33000000-0000-0000-0000-000000000001', 'SORATH STYLE', '24AAAAA5001A1Z5', 'Normal', NULL),
  ('33000000-0000-0000-0000-000000000002', 'SORATH STYLE RE-OVERRIDE', '24AAAAA5002A1Z5', 'Normal', NULL),
  ('33000000-0000-0000-0000-000000000003', 'LEGACY AFTER THE PULL', '24AAAAA5003A1Z5', 'Normal', NULL),
  ('33000000-0000-0000-0000-000000000004', 'MARK PUSHED BLOCKED', '24AAAAA5004A1Z5', 'Normal', NULL),
  ('33000000-0000-0000-0000-000000000005', 'MARK PUSHED READY', '24AAAAA5005A1Z5', 'Normal', NULL);

-- Finding 1 needs overrides made before the migration that an older
-- extension's pull then wrote over (live: SORATH BUILDERS 08/2026, overridden
-- 20 Sep, pulled 19 Oct; NAVRATNA S G HIGHWAY 06/2026): the opening is the
-- pull's figure, the override stamps were left, no base. Written with the
-- triggers off (as the owner), as the old extension left them.
SET session_replication_role = replica;
INSERT INTO public.suspended_reco (client_id, period_month, opening_igst, opening_cgst, opening_sgst, opening_source,
                                   opening_portal_pulled_at, opening_override_justification, opening_override_at, opening_override_by)
VALUES ('33000000-0000-0000-0000-000000000001', '09/2026', 4575, 323235.2, 323235.2, 'portal', '2026-10-19 10:00+05:30',
        'Reclaimed in the next month', '2026-09-20 10:00+05:30', '00000000-0000-0000-0000-0000000000e1'),
       ('33000000-0000-0000-0000-000000000002', '09/2026', 4575, 323235.2, 323235.2, 'portal', '2026-10-19 10:00+05:30',
        'Reclaimed in the next month', '2026-09-20 10:00+05:30', '00000000-0000-0000-0000-0000000000e1'),
       -- The override came after the last pull: it still applies.
       ('33000000-0000-0000-0000-000000000003', '09/2026', 0, 700, 0, 'portal', '2026-09-18 10:00+05:30',
        'Books show 700', '2026-09-20 10:00+05:30', '00000000-0000-0000-0000-0000000000e1');
SET session_replication_role = origin;
INSERT INTO public.bills_not_in_2b (client_id, period_month, input_igst, input_cgst, input_sgst, reversal_month) VALUES
  ('33000000-0000-0000-0000-000000000003', '09/2026', 0, 700, 0, 'Aug-26');

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

-- ── 1. A legacy override a later pull had replaced is cleared (low) ──────
DO $$
DECLARE
  cs uuid := '33000000-0000-0000-0000-000000000001';
  cr uuid := '33000000-0000-0000-0000-000000000002';
  ca uuid := '33000000-0000-0000-0000-000000000003';
  e uuid := '00000000-0000-0000-0000-0000000000e3';
  m uuid := '00000000-0000-0000-0000-0000000000e2';
  pulled jsonb := '{"igst":4575,"cgst":300000,"sgst":300000}';
  v jsonb;
  r public.suspended_reco;
BEGIN
  -- The verifier's repro: the portal now shows 4,575 / 3,00,000 / 3,00,000.
  v := public.reco_record_pull(e, 'suspended', cs, '09/2026', pulled);
  PERFORM t_eq(v->>'override', 'cleared', 'F1: a legacy override a later pull had written over is cleared');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cs AND period_month = '09/2026';
  PERFORM t_eq(ARRAY[r.opening_igst, r.opening_cgst, r.opening_sgst], ARRAY[4575, 300000, 300000]::numeric[],
    'F1: the new portal figure is saved, not the old pulled one');
  PERFORM t_eq(r.opening_override_justification IS NULL AND r.opening_override_at IS NULL AND r.opening_override_by IS NULL
    AND r.opening_override_base IS NULL, true, 'F1: the stale override stamps are gone');
  PERFORM t_eq((SELECT reason FROM public.reco_opening_log WHERE client_id = cs AND reco = 'suspended' AND action = 'pull'),
    'Override by Sonal cleared: a later pull had already replaced it.', 'F1: the log says why');
  PERFORM t_eq(public.gstr3b_push_gate(cs, '09/2026')->'suspended'->'override', 'null'::jsonb,
    'F1: the gate no longer names an override');
  -- The next pull of the same figure has nothing to keep.
  PERFORM t_eq(public.reco_record_pull(e, 'suspended', cs, '09/2026', pulled)->>'override', NULL::text, 'F1: and stays cleared');

  -- A GST Manager re-overrides such a row before any new pull: the current,
  -- pulled opening is the base, so a pull of that figure keeps the new
  -- override and a pull of another figure clears it.
  PERFORM public.reco_override_opening(m, 'suspended', cr, '09/2026', '{"igst":4575,"cgst":0,"sgst":0}', 'Reversal reclaimed in Sep');
  SELECT * INTO r FROM public.suspended_reco WHERE client_id = cr AND period_month = '09/2026';
  PERFORM t_eq(r.opening_override_base, '{"igst":4575,"cgst":323235.2,"sgst":323235.2}'::jsonb,
    'F1: a re-override of a superseded legacy override takes the pulled opening as its base');
  PERFORM t_eq(public.reco_record_pull(e, 'suspended', cr, '09/2026', '{"igst":4575,"cgst":323235.2,"sgst":323235.2}')->>'override', 'kept',
    'F1: the same portal figure keeps the new override');
  PERFORM t_eq((SELECT opening_cgst FROM public.suspended_reco WHERE client_id = cr AND period_month = '09/2026'), 0::numeric,
    'F1: with the GST Manager''s figure');
  PERFORM t_eq(public.reco_record_pull(e, 'suspended', cr, '09/2026', pulled)->>'override', 'cleared',
    'F1: another portal figure clears it');

  -- A legacy override made after the last pull still applies (round 2's rule).
  PERFORM public.reco_record_pull(e, 'receivable', ca, '09/2026', '{"igst":0,"cgst":0,"sgst":0}', '{"igst":0,"cgst":0,"sgst":0}', '{"igst":0,"cgst":0,"sgst":0}');
  v := public.reco_record_pull(e, 'suspended', ca, '09/2026', '{"igst":0,"cgst":1000,"sgst":0}');
  PERFORM t_eq(v->>'override', 'kept', 'F1: an override made after the last pull is kept');
  PERFORM t_eq((SELECT opening_cgst::text || '/' || (opening_override_base->>'cgst') FROM public.suspended_reco WHERE client_id = ca AND period_month = '09/2026'),
    '700/1000', 'F1: with its figure and the pulled base');
  PERFORM t_eq((public.gstr3b_push_gate(ca, '09/2026')->>'ok')::boolean, true, 'F1: and the gate passes');
END $$;

-- ── 2. mark_filing_pushed marks a GSTR-3B only through the gate (low) ─────
DO $$
DECLARE
  cb uuid := '33000000-0000-0000-0000-000000000004';
  cy uuid := '33000000-0000-0000-0000-000000000005';
  e uuid := '00000000-0000-0000-0000-0000000000e3';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
BEGIN
  PERFORM t_eq(has_function_privilege('anon', 'public.mark_filing_pushed(uuid,text,text,uuid)', 'execute'), true,
    'F2: anon still calls it (the GSTR-1 page and the extension''s GSTR-1 NIL push)');
  PERFORM t_eq((public.gstr3b_push_gate(cb, '09/2026')->>'ok')::boolean, false, 'F2: never pulled, the gate says no');
  PERFORM t_raises(format($q$SELECT public.mark_filing_pushed(%L, 'GSTR-3B', '09/2026', %L)$q$, cb, e),
    'GSTR-3B is marked Pushed only by a push whose reconciliation check passes. Suspended Reco for Sep 2026 is not pulled from the portal.',
    'F2: GSTR-3B is refused while the gate does not pass, with the reasons');
  PERFORM t_raises(format($q$SELECT public.mark_filing_pushed(%L, 'GSTR-3B (Q)', '09/2026', %L)$q$, cb, e),
    'reconciliation check passes', 'F2: GSTR-3B (Q) too');
  PERFORM t_raises(format($q$SELECT public.mark_filing_pushed(%L, ' gstr 3b ', '09/2026', %L)$q$, cb, e),
    'reconciliation check passes', 'F2: whatever the spelling');
  PERFORM t_eq((SELECT count(*) FROM public.filing_status WHERE client_id = cb), 0::bigint, 'F2: nothing was marked');
  -- Other returns as before.
  PERFORM t_eq(public.mark_filing_pushed(cb, 'GSTR-1', '09/2026', e), 'Pushed', 'F2: GSTR-1 is marked as before');
  -- A client whose gate passes is marked, as before.
  PERFORM public.reco_record_pull(e, 'suspended', cy, '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', cy, '09/2026', z, z, z);
  PERFORM t_eq(public.mark_filing_pushed(cy, 'GSTR-3B', '09/2026', e), 'Pushed', 'F2: with a passing gate it marks Pushed');
  PERFORM t_eq((SELECT status::text FROM public.filing_status WHERE client_id = cy AND return_type = 'GSTR-3B' AND period_month = '09/2026'),
    'Pushed', 'F2: on the GSTR-3B row');
END $$;
