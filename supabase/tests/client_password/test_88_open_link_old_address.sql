-- A link counts as still open only while it went to the address on record.
-- The client's e-mail was mistyped; three links went there (Graph accepted
-- them); staff correct the address and the client asks again. That request is
-- refused by the per-client limit, so staff must be asked: the open link is
-- in a mailbox that is not the client's.
BEGIN;
INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c8800000-0000-0000-0000-000000000001', 'Typo Co', '24AAACT8801A1Z1', 'acounts@typo-co.example', 'x'),
 ('c8800000-0000-0000-0000-000000000002', 'Fixed Early Co', '24AAACT8802A1Z2', 'old@typo-co.example', 'x'),
 ('c8800000-0000-0000-0000-000000000003', 'Same Address Co', '24AAACT8803A1Z3', 'Same@Example.com', 'x');

DO $$
DECLARE r record;
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM client_password_reset_request('24AAACT8801A1Z1');
    FOR r IN SELECT * FROM client_password_reset_claim(10) LOOP
      PERFORM client_password_reset_mark(r.reset_id, NULL);
    END LOOP;
    UPDATE client_password_resets SET created_at = created_at - interval '2 minutes', claimed_at = claimed_at - interval '2 minutes';
  END LOOP;
END $$;
SELECT t_eq(client_password_has_open_link('c8800000-0000-0000-0000-000000000001'), true, 'a link is open at the address on record');

-- Staff correct the address (an Edit Client save).
UPDATE clients SET email = 'accounts@typo-co.example' WHERE id = 'c8800000-0000-0000-0000-000000000001';
SELECT t_eq(client_password_has_open_link('c8800000-0000-0000-0000-000000000001'), false,
  'a link to the old address is not open for the client');
SET LOCAL ROLE anon;
SELECT t_eq(client_password_reset_request('24AAACT8801A1Z1'), '{"ok": true}'::jsonb, 'the same answer');
RESET ROLE;
SELECT t_eq((SELECT string_agg(outcome || ' x' || n, ', ' ORDER BY outcome)
               FROM (SELECT outcome, count(*) AS n FROM client_password_reset_attempts
                      WHERE client_id = 'c8800000-0000-0000-0000-000000000001' GROUP BY outcome) o),
  'queued x3, staff_request x1', 'refused by the limit, so staff are asked');
SELECT t_eq((SELECT count(*) FROM password_reset_requests
              WHERE user_id = 'c8800000-0000-0000-0000-000000000001' AND status = 'pending'),
  1::bigint, 'one request for staff');

-- Not refused (one earlier link, a while ago): a link goes to the new address.
SELECT client_password_reset_request('24AAACT8802A1Z2');
UPDATE client_password_resets SET created_at = created_at - interval '5 minutes'
 WHERE client_id = 'c8800000-0000-0000-0000-000000000002';
UPDATE clients SET email = 'new@typo-co.example' WHERE id = 'c8800000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
SELECT client_password_reset_request('24AAACT8802A1Z2');
RESET ROLE;
SELECT t_eq((SELECT sent_to FROM client_password_resets
              WHERE client_id = 'c8800000-0000-0000-0000-000000000002' AND voided_at IS NULL),
  'new@typo-co.example', 'the open link goes to the address on record');

-- The same address written differently is still the same address.
SELECT client_password_reset_request('24AAACT8803A1Z3');
UPDATE clients SET email = 'same@example.com;' WHERE id = 'c8800000-0000-0000-0000-000000000003';
SELECT t_eq(client_password_has_open_link('c8800000-0000-0000-0000-000000000003'), true, 'case and separators do not matter');
ROLLBACK;
