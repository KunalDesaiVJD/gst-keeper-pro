-- One history to read (gst_change_history): this log, the Annual Return
-- figure log and the Liberal switch log, each in the same shape. Deletes that
-- cascade from a client are logged; a TRUNCATE is recorded; a statement the
-- logger cannot read is refused.
SET search_path = public, extensions;

-- The existing logs, as their own triggers write them.
INSERT INTO annual_return_change_log (client_id, financial_year, doc_key, path, row_label, kind, old_value, new_value, action, changed_by, changed_at)
VALUES ('20000000-0000-0000-0000-000000000001', '2025-26', 'gstr9_t4', '{t4,a,taxable}', 'B2C supplies', 'edit', '1000', '1500', 'save', 'Gita', '2026-10-20T10:00:00+05:30');
INSERT INTO client_liberal_log (client_id, liberal, changed_by, changed_by_name, changed_at)
VALUES ('20000000-0000-0000-0000-000000000001', true, '10000000-0000-0000-0000-000000000001', 'Sam', '2026-10-20T11:00:00+05:30');

SET ROLE anon;
SELECT t_eq((SELECT log || '|' || table_name || '|' || op || '|' || actor_name || '|' || financial_year || '|' || row_label || '|' || (changed -> 't4.a.taxable')::text
               FROM gst_change_history WHERE log = 'annual_return_change_log'),
            'annual_return_change_log|annual_return_docs|UPDATE|Gita|2025-26|B2C supplies|{"new": 1500, "old": 1000}',
            'an Annual Return figure change, in the same shape');
SELECT t_eq((SELECT op || '|' || actor_name || '|' || (changed -> 'liberal_2b_reconciliation')::text
               FROM gst_change_history WHERE log = 'client_liberal_log'),
            'UPDATE|Sam|{"new": true, "old": false}', 'the Liberal switch, in the same shape');
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE log = 'gst_change_log')::int, (SELECT count(*) FROM gst_change_log)::int,
            'every log row is in the view');
-- The filters the page uses: client and month, newest first
SELECT t_eq((SELECT count(*) FROM gst_change_history
              WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND table_name = 'filing_status')::int,
            (SELECT count(*) FROM gst_change_log
              WHERE client_id = '20000000-0000-0000-0000-000000000001' AND period_month = '09/2026' AND table_name = 'filing_status')::int,
            'client and month filter');
RESET ROLE;

-- A client deleted: its ledger rows go with it, and each is logged with the client
INSERT INTO clients (id, name, gstin) VALUES ('20000000-0000-0000-0000-000000000009', 'GONE AWAY', '24GGGGG9999G1Z1');
INSERT INTO bills_not_in_books (client_id, period_month, supplier_gstin, input_igst)
SELECT '20000000-0000-0000-0000-000000000009', '09/2026', '24SSSSS' || lpad(g::text, 4, '0') || 'S1Z1', g FROM generate_series(1, 5) g;
SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000001","x-gst-source":"app","x-gst-request":"del-client"}');
DELETE FROM clients WHERE id = '20000000-0000-0000-0000-000000000009';
RESET ROLE;
SELECT t_eq((SELECT string_agg(table_name || ':' || n, ', ' ORDER BY table_name) FROM (SELECT table_name, count(*) n FROM gst_change_log
              WHERE request_id = 'del-client' AND op = 'DELETE' AND client_id = '20000000-0000-0000-0000-000000000009' GROUP BY 1) x),
            'bills_not_in_books:5, clients:1', 'a client delete logs its cascaded rows, with the client and the person');
SELECT t_eq((SELECT count(*) FROM gst_change_history WHERE client_id = '20000000-0000-0000-0000-000000000009')::int, 12,
            'the history outlives the client (6 rows in, 6 rows out)');

-- TRUNCATE skips row triggers: it is recorded with the number of rows
INSERT INTO gst_cash_ledger_entries (client_id, period_month, igst) VALUES ('20000000-0000-0000-0000-000000000001', '09/2026', 1), ('20000000-0000-0000-0000-000000000001', '09/2026', 2);
TRUNCATE gst_cash_ledger_entries;
SELECT t_eq((SELECT op || ':' || (changed ->> 'rows') FROM gst_change_log WHERE table_name = 'gst_cash_ledger_entries' ORDER BY id DESC LIMIT 1),
            'TRUNCATE:2', 'a truncate is recorded');

-- A statement the logger cannot read is refused (test_45); an expression
-- that can never be read is refused when attaching.
CREATE TABLE public.t_odd (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, n int);
GRANT ALL ON public.t_odd TO anon;
SELECT gst_change_log_attach('t_odd', p_client => '(CASE WHEN r.n = 0 THEN (1 / r.n)::text ELSE r.client_id::text END)::uuid', p_month => 'NULL');
SET ROLE anon;
SELECT t_raises($$INSERT INTO t_odd (client_id, n) VALUES ('20000000-0000-0000-0000-000000000001', 0)$$, 'division by zero', 'refused');
RESET ROLE;
SELECT t_eq((SELECT count(*) FROM t_odd)::int + (SELECT count(*) FROM gst_change_log WHERE table_name = 't_odd')::int, 0,
            'nothing saved, nothing logged');
-- A wrong expression is caught when attaching, never at a save
SELECT t_raises($$SELECT gst_change_log_attach('t_odd', p_month => 'r.no_such_column')$$, 'no_such_column', 'attach checks its expressions');
SELECT t_raises($$SELECT gst_change_log_attach('t_odd', p_summary => '{raw}')$$, 'no column raw', 'attach checks its column lists');
SELECT t_eq(gst_change_log_attach('no_such_table'), 'no_such_table: missing, skipped', 'a missing table is skipped');
DROP TABLE public.t_odd;
DROP FUNCTION public.gst_change_log_for_t_odd();
DELETE FROM gst_change_log_tables WHERE table_name = 't_odd';

-- A row moved to a new key (a builder opening balance keyed by its unit): both
-- sides are kept, marked as a key change.
INSERT INTO builder_projects (id, client_id, name) VALUES ('40000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'Sun Plaza');
INSERT INTO builder_units (id, project_id, unit_no) VALUES
 ('40000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000011', 'B-1'),
 ('40000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000011', 'B-2');
INSERT INTO builder_opening_balances (unit_id, agreement_value) VALUES ('40000000-0000-0000-0000-000000000012', 2500000);
UPDATE builder_opening_balances SET unit_id = '40000000-0000-0000-0000-000000000013' WHERE unit_id = '40000000-0000-0000-0000-000000000012';
SELECT t_eq((SELECT count(*) FROM gst_change_log WHERE table_name = 'builder_opening_balances' AND op = 'UPDATE' AND changed ->> '_key_changed' = 'true')::int, 2,
            'a key change keeps the old and the new row');
SELECT t_eq((SELECT changed -> 'new' ->> 'agreement_value' FROM gst_change_log WHERE table_name = 'builder_opening_balances' AND op = 'UPDATE'
              AND row_id = '40000000-0000-0000-0000-000000000013'), '2500000', 'with its figures');
