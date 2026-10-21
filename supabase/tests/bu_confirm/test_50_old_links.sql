-- Per-unit links e-mailed before this change keep working, on the new page
-- and through the old function, until a new request asks about their unit.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

-- Rows as the old app wrote them (direct table writes, one token per unit).
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status, sent_at)
SELECT eu.bu_event_id, eu.unit_id, 'c1000000-0000-0000-0000-000000000001', eu.agreement_value, 'PENDING', now()
  FROM builder_bu_event_units eu
 WHERE eu.bu_event_id = 'e1000000-0000-0000-0000-000000000001' AND eu.booked_at_cutoff;
SELECT max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000001') AS t1,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000002') AS t2,
       max(token) FILTER (WHERE unit_id = 'a1000000-0000-0000-0000-000000000003') AS t3
  FROM builder_bu_agreement_confirmations \gset

-- The old lookup is unchanged.
SELECT t_eq((SELECT unit_no || '/' || project_name || '/' || agreement_value || '/' || status FROM builder_bu_agreement_confirmation_lookup(:'t1')),
            'A-101/Test Heights/4500000/PENDING', 'the old lookup still answers');
-- The new page reads a per-unit link as a request of one unit.
SELECT t_eq(builder_bu_confirm_lookup(:'t1') ->> 'kind', 'unit', 'a per-unit link');
SELECT t_eq(t_states(:'t1'), 'A-101:PENDING', 'its one unit');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'t1', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000001', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')),
            'A-101:CONFIRMED', 'confirmed through the new page');
SELECT t_eq((SELECT responded_by_name || '/' || responded_by_email FROM builder_bu_agreement_confirmations WHERE token = :'t1'),
            'Rajesh Shah/rajesh@client.test', 'with who answered');
SELECT t_raises(format($q$SELECT builder_bu_confirm_respond(%L, jsonb_build_array(t_answer('a1000000-0000-0000-0000-000000000002', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')$q$, :'t1'),
                'not in this request', 'a per-unit link reaches only its unit');

-- The old answer function still works for an untouched link.
SELECT t_eq(builder_bu_agreement_confirm(:'t2', 'DISPUTE', 'Changed'), true, 'the old function records a dispute');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE token = :'t2'), 'DISPUTED', 'disputed');

-- A new request for A-102 and A-103 replaces their per-unit links.
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003']::uuid[],
              ARRAY['owner@client.test'], NULL) ->> 'token' AS tok \gset
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations)::int, 3, 'the same rows, not new ones');
SELECT t_eq((SELECT token FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), :'t3', 'the per-unit token is kept');
SELECT t_eq(t_states(:'t3'), 'A-103:REPLACED', 'the old link shows it replaced');
SELECT t_eq(t_states(:'t2'), 'A-102:REPLACED', 'the disputed one too');
SELECT t_eq(builder_bu_agreement_confirm(:'t3', 'CONFIRM', NULL), false, 'the old function no longer answers it');
SELECT t_eq(t_results(builder_bu_confirm_respond(:'t3', jsonb_build_array(
              t_answer('a1000000-0000-0000-0000-000000000003', 'CONFIRM')), 'Rajesh Shah', 'rajesh@client.test')),
            'A-103:REPLACED', 'nor does the new page through the old link');
SELECT t_eq((SELECT status FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003'), 'PENDING', 'still open, on the new request');
SELECT t_eq(t_states(:'tok'), 'A-102:PENDING,A-103:PENDING', 'the new link asks about both');
SELECT t_eq(t_states(:'t1'), 'A-101:CONFIRMED', 'the link not re-sent still shows its answer');
ROLLBACK;
