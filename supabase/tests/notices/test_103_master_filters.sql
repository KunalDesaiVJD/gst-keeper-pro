-- Master filters (migration 20261009110000): client, financial year, owner, form
-- and priority, applied by the command centre the way the lists apply them, so
-- every number still equals the list it opens.
BEGIN;
INSERT INTO clients (id, name, gstin, gst_user_id, inactive_at_hand) VALUES
 ('10300000-0000-0000-0000-000000000001', 'Filter Mills', '24FILTR0000F1Z5', 'filter', false),
 ('10300000-0000-0000-0000-000000000002', 'Other Traders', '24OTHER0000O1Z5', 'other', false);
INSERT INTO gst_notices (id, client_id, source, portal_key, notice_type, description, issue_date, due_date, reference_number, financial_year, amount_of_demand) VALUES
 ('10300000-0000-0000-0000-0000000000a1', '10300000-0000-0000-0000-000000000001', 'notices', 'f1', 'Scrutiny Of Returns',
  'Notice for intimating discrepancies in the return after scrutiny (ASMT-10)', ist_today() - 5, ist_today() + 10, 'ZF-1', '2019-20', 100000),
 ('10300000-0000-0000-0000-0000000000a2', '10300000-0000-0000-0000-000000000001', 'notices', 'f2', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, ist_today() - 2, 'ZF-2', '2019-2020', 200000),
 ('10300000-0000-0000-0000-0000000000a3', '10300000-0000-0000-0000-000000000001', 'notices', 'f3', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, ist_today() + 2, 'ZF-3', NULL, 300000),
 ('10300000-0000-0000-0000-0000000000a4', '10300000-0000-0000-0000-000000000002', 'notices', 'o1', 'Determination Of Tax',
  'Show Cause Notice (DRC-01)', ist_today() - 5, ist_today() + 2, 'ZO-1', '2019-20', 400000);
UPDATE gst_notices SET assign_to_user_id = 'a1030000-0000-0000-0000-000000000001', assign_to = 'Riya', priority = 'High'
 WHERE id = '10300000-0000-0000-0000-0000000000a1';
INSERT INTO litigation_matters (id, client_id, matter_no, status, financial_years, priority, demand_tax) VALUES
 ('10300000-0000-0000-0000-0000000000b1', '10300000-0000-0000-0000-000000000001', 'M-103-1', 'Open', ARRAY['2019-2020'], 'High', 50000),
 ('10300000-0000-0000-0000-0000000000b2', '10300000-0000-0000-0000-000000000002', 'M-103-2', 'Open', NULL, NULL, 70000);
UPDATE gst_notices SET matter_id = '10300000-0000-0000-0000-0000000000b1' WHERE id = '10300000-0000-0000-0000-0000000000a2';

-- ── The year, however it is written ────────────────────────────────────────
SELECT t_eq(notice_fy_key('2019-2020') || ' ' || notice_fy_key('FY 2019/20') || ' ' || notice_fy_key('2019-20'),
            '2019-20 2019-20 2019-20', 'one key for every spelling of a year');
SELECT t_eq(notice_fy_key('') IS NULL AND notice_fy_key(NULL) IS NULL, true, 'nothing is no year');

-- ── A notice against the filters ───────────────────────────────────────────
SELECT t_eq(notice_master_match(NULL, NULL, NULL, NULL, NULL, NULL), true, 'no filters: everything');
SELECT t_eq(notice_master_match('{"fy": "2019-20"}', NULL, '2019-2020', NULL, NULL, NULL), true, 'a year written either way');
SELECT t_eq(notice_master_match('{"fy": "none"}', NULL, NULL, NULL, NULL, NULL)
            AND NOT notice_master_match('{"fy": "none"}', NULL, '2019-20', NULL, NULL, NULL), true, '"none": no year stated');
SELECT t_eq(notice_master_match('{"owner": "none"}', NULL, NULL, NULL, NULL, NULL)
            AND NOT notice_master_match('{"owner": "none"}', NULL, NULL, 'a1030000-0000-0000-0000-000000000001', NULL, NULL), true, 'owner none: unassigned');
SELECT t_eq(notice_master_match('{"form": "none"}', NULL, NULL, NULL, NULL, NULL)
            AND notice_master_match('{"form": "DRC-01", "priority": "High"}', NULL, NULL, NULL, 'DRC-01', 'High')
            AND NOT notice_master_match('{"form": "DRC-01", "priority": "Low"}', NULL, NULL, NULL, 'DRC-01', 'High'), true, 'form and priority');

-- ── The command centre counts what its lists show ──────────────────────────
DO $$
DECLARE
  f jsonb;
  cc jsonb;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    '{"client": "10300000-0000-0000-0000-000000000001"}'::jsonb,
    '{"fy": "2019-20"}'::jsonb,
    '{"fy": "none", "client": "10300000-0000-0000-0000-000000000001"}'::jsonb,
    '{"owner": "a1030000-0000-0000-0000-000000000001"}'::jsonb,
    '{"form": "DRC-01", "client": "10300000-0000-0000-0000-000000000001"}'::jsonb,
    '{"priority": "High"}'::jsonb]
  LOOP
    cc := notices_command_centre(NULL, f);
    PERFORM t_eq((cc -> 'tiles' ->> 'open')::bigint,
                 (SELECT count(*) FROM notice_facts n WHERE n.on_dashboard AND n.is_open
                     AND notice_master_match(f, n.client_id, n.financial_year, n.assign_to_user_id, n.form_code, n.effective_priority)),
                 'open = the filtered list: ' || f::text);
    PERFORM t_eq((cc -> 'tiles' -> 'overdue' ->> 'count')::bigint,
                 (SELECT count(*) FROM notice_facts n WHERE n.on_dashboard AND n.is_overdue
                     AND notice_master_match(f, n.client_id, n.financial_year, n.assign_to_user_id, n.form_code, n.effective_priority)),
                 'overdue = the filtered list: ' || f::text);
  END LOOP;
  cc := notices_command_centre(NULL, '{"client": "10300000-0000-0000-0000-000000000001"}');
  PERFORM t_eq((cc -> 'tiles' ->> 'open')::int, 3, 'one client: its three notices');
  PERFORM t_eq((cc -> 'tiles' -> 'exposure' ->> 'matters')::int, 1, 'and its one matter');
  cc := notices_command_centre(NULL, '{"fy": "2019-20"}');
  PERFORM t_eq((cc -> 'tiles' ->> 'open')::int, 3, 'FY 2019-20: the year written either way, both clients');
  PERFORM t_eq((cc -> 'tiles' -> 'exposure' ->> 'matters')::int, 1, 'and the matter of that year');
  cc := notices_command_centre(NULL, '{"form": "DRC-01"}');
  PERFORM t_eq((cc -> 'tiles' -> 'exposure' ->> 'matters')::int, 1, 'a matter by its notices'' form');
  PERFORM t_eq((cc -> 'clients' -> 0 ->> 'name') IS NOT NULL, true, 'the client list follows the filters');
  -- No filters: as before, and the one-argument call still works.
  PERFORM t_eq((notices_command_centre(NULL) -> 'tiles' ->> 'open')::bigint,
               (SELECT count(*) FROM notice_facts WHERE on_dashboard AND is_open), 'unfiltered as before');
END $$;
SELECT t_eq(matter_master_match('{"fy": "none"}', '10300000-0000-0000-0000-0000000000b2')
            AND NOT matter_master_match('{"fy": "none"}', '10300000-0000-0000-0000-0000000000b1'), true, 'a matter without a year');
ROLLBACK;
