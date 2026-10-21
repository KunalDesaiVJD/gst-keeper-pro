-- Every attached table: an insert, an update and a delete as the public key
-- with the app's header are each logged once, with the actor and the client,
-- and nothing fails inside the logger (no "_error" rows). History tables log
-- only the update and the delete. The list is the migration's own (section
-- 6): 107 tables with the sibling migrations' (00b_sibling_tables.sql), 95
-- full, 3 record (portal uploads and pushes) and 9 history.
SET search_path = public, extensions;

SELECT t_eq((SELECT count(*) FROM gst_change_log_tables)::int, 107, 'tables attached');
SELECT t_eq((SELECT count(*) FROM gst_change_log_tables WHERE mode = 'history')::int, 9, 'history tables');
SELECT t_eq((SELECT string_agg(table_name, ',' ORDER BY table_name) FROM gst_change_log_tables WHERE mode = 'record'),
            'gstr1_upload_versions,gstr1_upload_versions_quarantine,gstr3b_push_versions', 'record tables: the portal uploads and pushes');
SELECT t_eq((SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'gst_change_log_%' AND NOT tgisinternal)::int,
            98 * 4 + 9 * 3 + 2 + 8 * 2, 'triggers (4 per full or record table, 3 per history table, 2 guarding the log, 2 on each builder parent)');
SELECT t_eq((SELECT count(*) FROM gst_change_log_tables t WHERE to_regprocedure('public.' || public.gst_change_log_fn_name(t.table_name) || '()') IS NULL)::int, 0,
            'each table has its own logger function');
SELECT t_eq((SELECT count(*) FROM unnest(ARRAY['twob_import_docs', 'books_register', 'bills_not_in_2b', 'bills_not_in_books',
  'itc_summaries', 'suspended_reco', 'gst_receivable_reco', 'filing_status', 'gstr1_data', 'gstr1_manual_entries',
  'gstr3b_adjustments', 'gstr3b_push_versions', 'rcm_data', 'rcm_masters', 'rcm_versions', 'advance_receipts',
  'advance_adjustments', 'advance_opening_balances', 'advance_setoff_overrides', 'builder_units', 'builder_receipts',
  'clients', 'gst_credit_ledger_transactions', 'manual_source_allowances', 'twob_versions', 'itc_versions']) t
  WHERE t NOT IN (SELECT table_name FROM gst_change_log_tables))::int, 0, 'the GST working tables named by the firm are all attached');
-- Never logged twice: these have complete logs of their own.
SELECT t_eq((SELECT count(*) FROM gst_change_log_tables WHERE table_name IN ('annual_return_docs', 'annual_return_change_log',
  'client_liberal_log', 'gst_change_log'))::int, 0, 'complete logs are not logged again');

-- Fixture parents for the lookups (builder rows reach their client through
-- the project or unit; the update sheet's row versions through the row).
INSERT INTO builder_projects (id, client_id, name) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Moon Heights');
INSERT INTO builder_units (id, project_id, unit_no) VALUES ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'A-101');
INSERT INTO builder_bookings (id, unit_id) VALUES ('40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002');
INSERT INTO builder_receipts (id, unit_id) VALUES ('40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002');
INSERT INTO builder_bounce_reversals (id, project_id) VALUES ('40000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000001');
INSERT INTO builder_reclassifications (id, unit_id) VALUES ('40000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000002');
INSERT INTO builder_cancellations (id, project_id) VALUES ('40000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000001');
INSERT INTO builder_itc_reversal_workings (id, client_id) VALUES ('40000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002');
INSERT INTO gst_running_updates (id, client_id) VALUES ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000002');

-- The guard on manual_source_allowances lets the test write it directly.
SELECT set_config('app.manual_source_write', 'on', false);

CREATE TEMP TABLE t_seen (table_name text, ops text, actors text, errors int, clients int);
GRANT ALL ON t_seen TO anon;

SET ROLE anon;
SELECT t_request('anon', '{"x-gst-actor":"10000000-0000-0000-0000-000000000003","x-gst-source":"app","x-gst-request":"t20"}');
DO $$
DECLARE
  t record;
  c record;
  v_val text;
  v_col text;
  v_type text;
  v_cols text;
  v_vals text;
  v_where text;
  v_set text;
  v_from bigint;
  v_id text := quote_literal('50000000-0000-0000-0000-000000000000');
BEGIN
  FOR t IN SELECT table_name, mode, key_columns, only_columns FROM gst_change_log_tables ORDER BY table_name LOOP
    SELECT COALESCE(max(id), 0) INTO v_from FROM gst_change_log;
    v_cols := ''; v_vals := ''; v_where := '';
    FOR c IN SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attname = ANY (t.key_columns) AS is_key
               FROM pg_attribute a WHERE a.attrelid = ('public.' || t.table_name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum LOOP
      v_val := CASE
        WHEN c.name = 'client_id' THEN quote_literal('20000000-0000-0000-0000-000000000002')
        WHEN c.name = 'project_id' THEN quote_literal('40000000-0000-0000-0000-000000000001')
        WHEN c.name IN ('unit_id', 'from_unit_id') THEN quote_literal('40000000-0000-0000-0000-000000000002')
        WHEN c.name = 'booking_id' THEN quote_literal('40000000-0000-0000-0000-000000000003')
        WHEN c.name = 'receipt_id' THEN quote_literal('40000000-0000-0000-0000-000000000004')
        WHEN c.name = 'reversal_id' THEN quote_literal('40000000-0000-0000-0000-000000000005')
        WHEN c.name = 'reclassification_id' THEN quote_literal('40000000-0000-0000-0000-000000000006')
        WHEN c.name = 'cancellation_id' THEN quote_literal('40000000-0000-0000-0000-000000000007')
        WHEN c.name = 'working_id' THEN quote_literal('40000000-0000-0000-0000-000000000008')
        WHEN c.name = 'row_id' AND t.table_name = 'gst_update_row_versions' THEN quote_literal('40000000-0000-0000-0000-000000000009')
        WHEN c.is_key AND c.type = 'uuid' THEN v_id
        WHEN c.is_key THEN quote_literal('k')
        WHEN c.name = 'period_month' THEN quote_literal('09/2026')
        WHEN t.table_name = 'manual_source_allowances' AND c.name = 'scope' THEN quote_literal('filing:GSTR-3B')
        WHEN t.table_name = 'manual_source_allowances' AND c.name = 'reason' THEN quote_literal('Portal down all day')
        WHEN t.table_name = 'manual_source_allowances' AND c.name = 'allowed_by' THEN quote_literal('10000000-0000-0000-0000-000000000001')
      END;
      IF v_val IS NOT NULL THEN
        v_cols := v_cols || ', ' || quote_ident(c.name);
        v_vals := v_vals || ', ' || v_val;
        IF c.is_key THEN
          v_where := v_where || CASE WHEN v_where = '' THEN '' ELSE ' AND ' END || quote_ident(c.name) || ' = ' || v_val;
        END IF;
      END IF;
    END LOOP;
    -- A plain column to change: the first text, number or flag that is not a key, a link or a stamp.
    v_col := NULL;
    SELECT a.attname, format_type(a.atttypid, a.atttypmod) INTO v_col, v_type
      FROM pg_attribute a
     WHERE a.attrelid = ('public.' || t.table_name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT (a.attname = ANY (t.key_columns))
       AND a.attname NOT IN ('client_id', 'period_month', 'updated_at', 'reason', 'scope')
       AND a.attname NOT LIKE '%\_by' AND a.attname NOT LIKE '%\_id'
       AND (format_type(a.atttypid, a.atttypmod) IN ('text', 'integer', 'boolean') OR format_type(a.atttypid, a.atttypmod) LIKE 'numeric%')
       AND (t.only_columns IS NULL OR a.attname = ANY (t.only_columns))
     ORDER BY a.attnum LIMIT 1;
    IF v_col IS NULL THEN
      SELECT a.attname, 'timestamp' INTO v_col, v_type FROM pg_attribute a
       WHERE a.attrelid = ('public.' || t.table_name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND format_type(a.atttypid, a.atttypmod) LIKE 'timestamp%' AND a.attname <> 'updated_at'
       ORDER BY a.attnum LIMIT 1;
    END IF;
    v_set := quote_ident(v_col) || ' = ' || CASE v_type WHEN 'boolean' THEN 'true' WHEN 'text' THEN quote_literal('changed')
                                                     WHEN 'timestamp' THEN 'clock_timestamp()' ELSE '7' END;
    EXECUTE format('INSERT INTO public.%I (%s) VALUES (%s)', t.table_name, substr(v_cols, 3), substr(v_vals, 3));
    EXECUTE format('UPDATE public.%I SET %s WHERE %s', t.table_name, v_set, v_where);
    EXECUTE format('DELETE FROM public.%I WHERE %s', t.table_name, v_where);
    INSERT INTO t_seen
    SELECT t.table_name, string_agg(op, ',' ORDER BY id), string_agg(DISTINCT COALESCE(actor_name, '-') || '/' || actor_basis, ','),
           count(*) FILTER (WHERE changed ? '_error'), count(DISTINCT client_id)
      FROM gst_change_log WHERE id > v_from AND table_name = t.table_name;
  END LOOP;
END $$;
RESET ROLE;
SELECT set_config('app.manual_source_write', '', false);

SELECT t_eq((SELECT count(*) FROM t_seen)::int, 107, 'every table written');
SELECT t_eq((SELECT string_agg(table_name || '=' || COALESCE(ops, '(none)'), '; ') FROM t_seen s
              WHERE ops IS DISTINCT FROM (SELECT CASE WHEN mode IN ('full', 'record') THEN 'INSERT,UPDATE,DELETE' ELSE 'UPDATE,DELETE' END
                                            FROM gst_change_log_tables x WHERE x.table_name = s.table_name)),
            NULL::text, 'each table: its insert, update and delete logged once each (history tables: update and delete)');
SELECT t_eq((SELECT string_agg(table_name || '=' || actors, '; ') FROM t_seen WHERE actors <> 'Esha/header'), NULL::text,
            'every row names the header actor');
SELECT t_eq((SELECT sum(errors) FROM t_seen)::int, 0, 'no logger errors');
SELECT t_eq((SELECT string_agg(table_name || '=' || clients, ', ') FROM t_seen WHERE clients <> 1
              AND table_name NOT IN ('rcm_masters', 'expense_head_mappings')), NULL::text,
            'every client-scoped table finds its client (builder tables through the project or unit)');
SELECT t_eq((SELECT count(*) FROM gst_change_log
              WHERE id >= (SELECT min(id) FROM gst_change_log WHERE request_id = 't20') AND request_id IS DISTINCT FROM 't20')::int, 0,
            'the request id on every row');
