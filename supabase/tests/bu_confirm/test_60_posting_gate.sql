-- The BU posting gate gives the same answer for the same statuses as before
-- this change, whether a unit's row came from a request or a per-unit e-mail:
-- blocked while any row of the period is not CONFIRMED or OVERRIDDEN.
BEGIN;
\ir fixtures.psql
SET LOCAL ROLE anon;

SELECT t_eq((SELECT prosrc LIKE '%NOT IN (''CONFIRMED'', ''OVERRIDDEN'')%' FROM pg_proc WHERE proname = 'builder_bu_agreement_confirmation_blocked'),
            true, 'the gate function is the one of 20261015100000');

-- Rows from per-unit e-mails (no request).
INSERT INTO builder_bu_agreement_confirmations (bu_event_id, unit_id, client_id, agreement_value_at_request, status)
SELECT eu.bu_event_id, eu.unit_id, 'c1000000-0000-0000-0000-000000000001', eu.agreement_value, 'PENDING'
  FROM builder_bu_event_units eu
 WHERE eu.bu_event_id = 'e1000000-0000-0000-0000-000000000001' AND eu.booked_at_cutoff;

CREATE TEMP TABLE gate_cases (n int, s1 text, s2 text, s3 text, blocked boolean);
INSERT INTO gate_cases VALUES
  (1, 'PENDING',    'PENDING',    'PENDING',    true),
  (2, 'CONFIRMED',  'CONFIRMED',  'CONFIRMED',  false),
  (3, 'OVERRIDDEN', 'OVERRIDDEN', 'OVERRIDDEN', false),
  (4, 'CONFIRMED',  'OVERRIDDEN', 'CONFIRMED',  false),
  (5, 'CONFIRMED',  'CONFIRMED',  'DISPUTED',   true),
  (6, 'CONFIRMED',  'PENDING',    'OVERRIDDEN', true),
  (7, 'DISPUTED',   'DISPUTED',   'DISPUTED',   true);

CREATE FUNCTION pg_temp.run_gate_cases(p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM gate_cases ORDER BY n LOOP
    UPDATE builder_bu_agreement_confirmations SET status = CASE unit_id
      WHEN 'a1000000-0000-0000-0000-000000000001' THEN r.s1
      WHEN 'a1000000-0000-0000-0000-000000000002' THEN r.s2 ELSE r.s3 END;
    PERFORM t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'),
                 r.blocked, p_label || ' case ' || r.n);
    PERFORM t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '11/2026'),
                 false, p_label || ' case ' || r.n || ', another period');
  END LOOP;
END $$;

SELECT pg_temp.run_gate_cases('per-unit rows');

-- The same rows after a request asked about them.
UPDATE builder_bu_agreement_confirmations SET status = 'PENDING';
SELECT t_send(ARRAY['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002',
                    'a1000000-0000-0000-0000-000000000003']::uuid[], ARRAY['owner@client.test'], NULL) IS NOT NULL;
SELECT t_eq((SELECT count(*) FROM builder_bu_agreement_confirmations WHERE request_id IS NOT NULL)::int, 3, 'every row on the request');
SELECT pg_temp.run_gate_cases('request rows');

-- A unit with no row at all (never sent) does not show in the DB gate, as
-- before; the BU Events page blocks it itself (isAgreementCleared).
DELETE FROM builder_bu_agreement_confirmations WHERE unit_id = 'a1000000-0000-0000-0000-000000000003';
UPDATE builder_bu_agreement_confirmations SET status = 'CONFIRMED';
SELECT t_eq(builder_bu_agreement_confirmation_blocked('c1000000-0000-0000-0000-000000000001', '10/2026'), false, 'a never-sent unit is the page''s check, as before');
ROLLBACK;
