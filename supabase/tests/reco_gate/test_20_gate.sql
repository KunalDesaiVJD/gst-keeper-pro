-- The GSTR-3B push gate (gstr3b_push_gate, 20261021120000), as the app and
-- the extension call it with the public key. Pulled and zero passes; not
-- pulled, a difference, a missing row or an error blocks; an override clears
-- a difference; Nil returns are not exempt; the Builder + NO_ITC waiver
-- covers only the Suspended Reco difference; an allowed manual entry counts
-- until it is revoked; before 06/2026 only the Suspended Reco difference.
INSERT INTO public.profiles (user_id, first_name) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Sonal'),
  ('00000000-0000-0000-0000-0000000000b2', 'Mehul'),
  ('00000000-0000-0000-0000-0000000000b3', 'Esha');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000b2', 'gst_manager'),
  ('00000000-0000-0000-0000-0000000000b3', 'employee');
INSERT INTO public.clients (id, name, gstin, regular_sub_type, builder_itc_type) VALUES
  ('20000000-0000-0000-0000-000000000001', 'PULLED ZERO', '24AAAAA0001A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000002', 'NOT PULLED', '24AAAAA0002A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000003', 'SAVED ONLY', '24AAAAA0003A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000004', 'DIFFERENCE', '24AAAAA0004A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000005', 'OVERRIDDEN', '24AAAAA0005A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000006', 'NIL RETURN', '24AAAAA0006A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000007', 'KRISHNA INFRA-NO ITC', '24AAAAA0007A1Z5', 'Builder', 'NO_ITC'),
  ('20000000-0000-0000-0000-000000000008', 'MANUAL ALLOWED', '24AAAAA0008A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000009', 'RECEIVABLE FIGURES', '24AAAAA0009A1Z5', 'Normal', NULL),
  ('20000000-0000-0000-0000-000000000010', 'LEGACY PORTAL', '24AAAAA0010A1Z5', 'Normal', NULL);

-- Setup through the same doors the app and the extension use.
DO $$
DECLARE
  e uuid := '00000000-0000-0000-0000-0000000000b3';
  s uuid := '00000000-0000-0000-0000-0000000000b1';
  z jsonb := '{"igst":0,"cgst":0,"sgst":0}';
BEGIN
  -- 1: pulled, all zero.
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000001', '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000001', '09/2026', z, z, z);
  -- 3: a Save only (the page's Save before any pull).
  INSERT INTO public.suspended_reco (client_id, period_month, portal_cgst) VALUES ('20000000-0000-0000-0000-000000000003', '09/2026', 0);
  INSERT INTO public.gst_receivable_reco (client_id, period_month, books_closing_cgst) VALUES ('20000000-0000-0000-0000-000000000003', '09/2026', 0);
  -- 4: pulled; the Suspended Reco opening is 1,000 with nothing in the books.
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000004', '09/2026', '{"igst":0,"cgst":1000,"sgst":0}');
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000004', '09/2026', z, z, z);
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000004', '10/2026', '{"igst":0,"cgst":9,"sgst":-9}');
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000004', '10/2026', z, z, z);
  -- 5: the same difference, then overridden by a GST Manager.
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000005', '09/2026', '{"igst":0,"cgst":1000,"sgst":0}');
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000005', '09/2026', z, z, z);
  -- 6: Nil return (GSTR-1 and GSTR-3B NIL), pulled for 09/2026 only.
  INSERT INTO public.filing_status (client_id, return_type, period_month, status, is_nil) VALUES
    ('20000000-0000-0000-0000-000000000006', 'GSTR-1', '09/2026', 'Filed', true),
    ('20000000-0000-0000-0000-000000000006', 'GSTR-3B', '09/2026', 'Prepared', true),
    ('20000000-0000-0000-0000-000000000006', 'GSTR-3B', '10/2026', 'Prepared', true);
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000006', '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000006', '09/2026', z, NULL, z);
  -- 7: Builder + NO_ITC: reversals in the books the portal never holds.
  INSERT INTO public.bills_not_in_2b (client_id, period_month, input_igst, input_cgst, input_sgst, reversal_month) VALUES
    ('20000000-0000-0000-0000-000000000007', '09/2026', 0, 41038.44, 41038.44, 'Aug-26');
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000007', '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000007', '09/2026', z, z, z);
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000007', '10/2026', '{"igst":0,"cgst":500,"sgst":500}', z, z);
  -- 8: allowed manual entries (Not Applicable) for both.
  PERFORM public.manual_source_allow(s, '20000000-0000-0000-0000-000000000008', '09/2026', 'reco:suspended', 'Portal password refused');
  PERFORM public.manual_source_allow(s, '20000000-0000-0000-0000-000000000008', '09/2026', 'reco:receivable', 'Portal password refused');
  PERFORM public.reco_manual_opening(e, 'suspended', '20000000-0000-0000-0000-000000000008', '09/2026', 'not_applicable', NULL);
  PERFORM public.reco_manual_opening(e, 'receivable', '20000000-0000-0000-0000-000000000008', '09/2026', 'not_applicable', NULL);
  -- 9: the receivable's Net ITC available from the month before (Filed), ITC
  -- utilised from the ledger, books closing typed.
  INSERT INTO public.filing_status (client_id, return_type, period_month, status) VALUES
    ('20000000-0000-0000-0000-000000000009', 'GSTR-3B', '08/2026', 'Filed');
  INSERT INTO public.itc_summaries (client_id, period_month, data) VALUES
    ('20000000-0000-0000-0000-000000000009', '08/2026', '{"section4A":[{"srNo":"(1)","igst":0,"cgst":0,"sgst":0},{"srNo":"(2)","igst":0,"cgst":0,"sgst":0},{"srNo":"(3)","igst":0,"cgst":0,"sgst":0},{"srNo":"(4)","igst":0,"cgst":0,"sgst":0},{"srNo":"5.1","igst":100,"cgst":2000,"sgst":"2000"}],"section4B":[{"particular":"4(B) ITC Reversed","isHeader":true,"cgst":99999},{"particular":"(1) As per rules 38, 42 & 43","igst":0,"cgst":100,"sgst":100}]}');
  INSERT INTO public.rcm_data (client_id, month, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18) VALUES
    ('20000000-0000-0000-0000-000000000009', 'Aug-26', 0, 50, 0, 50, 0, 0);
  PERFORM public.reco_record_pull(e, 'suspended', '20000000-0000-0000-0000-000000000009', '09/2026', z);
  PERFORM public.reco_record_pull(e, 'receivable', '20000000-0000-0000-0000-000000000009', '09/2026',
    '{"igst":10,"cgst":300,"sgst":300}', NULL, '{"igst":0,"cgst":0,"sgst":0}');
  UPDATE public.gst_receivable_reco SET books_closing_igst = 110, books_closing_cgst = 2250, books_closing_sgst = 2250
   WHERE client_id = '20000000-0000-0000-0000-000000000009' AND period_month = '09/2026';
  -- 10: a row marked 'portal' with no pull time (written before the pull door).
  PERFORM set_config('app.reco_write', 'pull', true);
  INSERT INTO public.suspended_reco (client_id, period_month, opening_source) VALUES ('20000000-0000-0000-0000-000000000010', '09/2026', 'portal');
  INSERT INTO public.gst_receivable_reco (client_id, period_month, opening_source, opening_portal_pulled_at) VALUES ('20000000-0000-0000-0000-000000000010', '09/2026', 'portal', now());
  PERFORM set_config('app.reco_write', '', true);
  -- 4 again, before 06/2026: a typed opening of 5.
  INSERT INTO public.suspended_reco (client_id, period_month, opening_cgst) VALUES ('20000000-0000-0000-0000-000000000004', '05/2026', 0);
  UPDATE public.suspended_reco SET opening_cgst = 5 WHERE client_id = '20000000-0000-0000-0000-000000000004' AND period_month = '05/2026';
END $$;

SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);

DO $$
DECLARE
  g jsonb;
  codes text;
  m uuid := '00000000-0000-0000-0000-0000000000b2';
  s uuid := '00000000-0000-0000-0000-0000000000b1';
  a uuid;
BEGIN
  -- Pulled and zero: passes.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000001', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'pulled and zero passes');
  PERFORM t_eq(g->'suspended'->>'status', 'pulled', 'the suspended reco reads as pulled');
  PERFORM t_eq(g->'suspended'->>'pulled_by_name', 'Esha', 'with who pulled it');
  PERFORM t_eq(jsonb_array_length(g->'reasons'), 0, 'and no reasons');

  -- No rows at all: blocked, both recos named.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000002', '09/2026');
  SELECT string_agg(r->>'code', ',' ORDER BY r->>'code') INTO codes FROM jsonb_array_elements(g->'reasons') r;
  PERFORM t_eq((g->>'ok')::boolean, false, 'a missing row blocks');
  PERFORM t_eq(codes, 'receivable_not_pulled,suspended_not_pulled', 'both recos are named');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 is not pulled from the portal.', 'in plain words');

  -- A Save without a pull: not pulled.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000003', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'a saved but not pulled row blocks');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 has no portal pull yet.', 'and says so');

  -- A difference blocks, with the amount; within ₹10 a head is 0.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000004', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'a difference blocks');
  PERFORM t_eq(g->'reasons'->0->>'code', 'suspended_difference', 'as a suspended reco difference');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for Sep 2026 has a difference of ₹1000.00.', 'with the amount');
  PERFORM t_eq((g->'suspended'->'difference'->>'cgst')::numeric, 1000::numeric, 'per head');
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000004', '10/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'a head of ₹10 or less reads 0 (from 06/2026)');

  -- Overridden by a GST Manager to the books: passes, and says who overrode.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000005', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'before the override it is blocked');
  PERFORM public.reco_override_opening(m, 'suspended', '20000000-0000-0000-0000-000000000005', '09/2026',
    '{"igst":0,"cgst":0,"sgst":0}', 'Books are right, portal reclaim pending');
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000005', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'an override that clears the difference passes');
  PERFORM t_eq(g->'suspended'->'override'->>'by_name', 'Mehul', 'and names who overrode');
  PERFORM t_eq(g->'suspended'->>'status', 'pulled', 'the opening is still the pulled one, overridden');

  -- Nil returns are not exempt: pulled passes, not pulled blocks.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000006', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'a pulled Nil return passes');
  PERFORM t_eq((g->'receivable'->'difference'->>'total')::numeric, 0::numeric, 'a pull with no set-off debit is ITC utilised 0');
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000006', '10/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'a Nil return not pulled is blocked');

  -- Builder + NO_ITC: the suspended difference is waived, the pull and the receivable are not.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000007', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'the NO_ITC builder''s suspended difference does not block');
  PERFORM t_eq((g->'suspended'->'difference'->>'total')::numeric, -82076.88::numeric, 'though it is there');
  PERFORM t_eq((g->'suspended'->>'waived')::boolean, true, 'and marked waived');
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000007', '10/2026');
  SELECT string_agg(r->>'code', ',' ORDER BY r->>'code') INTO codes FROM jsonb_array_elements(g->'reasons') r;
  PERFORM t_eq(codes, 'receivable_difference,suspended_not_pulled', 'the NO_ITC builder still needs the pull, and its receivable must tally');

  -- An allowed manual entry counts, and shows who allowed it and why; revoked, it blocks.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000008', '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'an allowed manual entry passes');
  PERFORM t_eq(g->'suspended'->>'status', 'manual', 'as manual');
  PERFORM t_eq(g->'suspended'->'allowance'->>'allowed_by_name' || ': ' || (g->'suspended'->'allowance'->>'reason'), 'Sonal: Portal password refused', 'allowed by whom and why');
  SELECT id INTO a FROM public.manual_source_allowances WHERE client_id = '20000000-0000-0000-0000-000000000008' AND scope = 'reco:receivable';
  PERFORM public.manual_source_revoke(s, a);
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000008', '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'The manual entry allowed for GST Receivable Reco for Sep 2026 was revoked. Pull it from the portal.', 'a revoked allowance blocks');

  -- The receivable's figures: Net ITC available from August (Filed), utilised 0.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000009', '09/2026');
  PERFORM t_eq((g->'receivable'->'difference'->'availed'->>'cgst')::numeric, 1950::numeric, 'availed = 4A (rows (1) to (4), RCM live, 5.1) - 4B (header left out)');
  PERFORM t_eq((g->'receivable'->'difference'->'availed'->>'igst')::numeric, 100::numeric, 'availed IGST');
  PERFORM t_eq((g->>'ok')::boolean, true, 'books equal to opening + availed passes');
  UPDATE public.gst_receivable_reco SET books_closing_cgst = 2000
   WHERE client_id = '20000000-0000-0000-0000-000000000009' AND period_month = '09/2026';
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000009', '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'GST Receivable Reco for Sep 2026 has a difference of ₹250.00.', 'a books difference blocks with its amount');

  -- A 'portal' row without a pull time is not a pull.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000010', '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'code', 'suspended_not_pulled', 'portal without a pull time is not pulled');
  PERFORM t_eq(jsonb_array_length(g->'reasons'), 1, 'the receivable with a pull time counts');

  -- Before 06/2026: the Suspended Reco difference only, no tolerance, no pull needed.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000002', '05/2026');
  PERFORM t_eq((g->>'ok')::boolean, true, 'before 06/2026 no pull is needed');
  PERFORM t_eq((g->'receivable'->>'required')::boolean, false, 'nor a receivable reco');
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000004', '05/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'Suspended Reco for May 2026 has a difference of ₹5.00.', 'before 06/2026 there is no ₹10 tolerance');

  -- Bad input answers, never raises.
  g := public.gstr3b_push_gate('20000000-0000-0000-0000-000000000001', 'Sep-26');
  PERFORM t_eq((g->>'ok')::boolean || '/' || (g->>'error'), 'false/true', 'a bad month is an error that blocks');
  g := public.gstr3b_push_gate('29999999-0000-0000-0000-000000000000', '09/2026');
  PERFORM t_eq(g->'reasons'->0->>'message', 'The reconciliation check could not run: no such client.', 'an unknown client blocks');
  g := public.gstr3b_push_gate(NULL, '09/2026');
  PERFORM t_eq((g->>'ok')::boolean, false, 'no client blocks');
END $$;

-- An error inside the check fails closed (the table it reads is gone).
RESET ROLE;
BEGIN;
ALTER TABLE public.bills_not_in_2b RENAME TO bills_not_in_2b_gone;
SET LOCAL ROLE anon;
SELECT t_eq((public.gstr3b_push_gate('20000000-0000-0000-0000-000000000001', '09/2026')->>'ok')::boolean, false, 'an error inside the check blocks');
SELECT t_eq(position('could not run' IN public.gstr3b_push_gate('20000000-0000-0000-0000-000000000001', '09/2026')->'reasons'->0->>'message') > 0, true, 'with the reason');
ROLLBACK;
