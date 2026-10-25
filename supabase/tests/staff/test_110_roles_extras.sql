-- Roles plus extra permissions (20261025100000): people on a legacy role move
-- to the largest standard role they fully hold and keep the rest as extras,
-- with user_permissions unchanged; extras are set only by a GST Manager or the
-- superadmin and survive a role change. Fictional people only.

SET search_path = public, extensions;

-- Fixtures as they stood on 24 Oct: two employees on legacy roles.
SELECT set_config('app.staff_roles_write', 'on', false), set_config('app.position_sync', 'on', false);
INSERT INTO staff_positions (id, name, is_legacy) VALUES
 ('31000000-0000-0000-0000-000000000001', 'Legacy access 1 — Tara', true),
 ('31000000-0000-0000-0000-000000000002', 'Legacy access 2 — Uday', true);
INSERT INTO staff_position_permissions (position_id, permission_key)
SELECT '31000000-0000-0000-0000-000000000001'::uuid, k
  FROM unnest(ARRAY['send_client_emails', 'work_2b_import', 'add_edit_clients', 'edit_filing_status', 'export_data', 'unlock_sheets']) k
UNION ALL
SELECT '31000000-0000-0000-0000-000000000002'::uuid, k FROM unnest(ARRAY['send_client_emails', 'work_2b_import']) k;
INSERT INTO profiles (user_id, first_name, position_id) VALUES
 ('30000000-0000-0000-0000-000000000001', 'Tara', '31000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002', 'Uday', '31000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000009', 'Meera', NULL);
INSERT INTO user_roles (user_id, role) VALUES
 ('30000000-0000-0000-0000-000000000001', 'employee'),
 ('30000000-0000-0000-0000-000000000002', 'employee'),
 ('30000000-0000-0000-0000-000000000009', 'gst_manager');
INSERT INTO user_permissions (user_id, permission_key)
SELECT '30000000-0000-0000-0000-000000000001'::uuid, k
  FROM unnest(ARRAY['send_client_emails', 'work_2b_import', 'add_edit_clients', 'edit_filing_status', 'export_data', 'unlock_sheets']) k
UNION ALL
SELECT '30000000-0000-0000-0000-000000000002'::uuid, k FROM unnest(ARRAY['send_client_emails', 'work_2b_import']) k;
SELECT set_config('app.staff_roles_write', 'off', false), set_config('app.position_sync', 'off', false);

\ir ../../migrations/20261025100000_staff_roles_and_extras.sql

CREATE FUNCTION pg_temp.keys(u uuid) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(permission_key, ',' ORDER BY permission_key) FROM public.user_permissions WHERE user_id = u $$;
CREATE FUNCTION pg_temp.role_of(u uuid) RETURNS text LANGUAGE sql AS $$
  SELECT sp.name FROM public.profiles p JOIN public.staff_positions sp ON sp.id = p.position_id WHERE p.user_id = u $$;

DO $$
BEGIN
  ASSERT pg_temp.role_of('30000000-0000-0000-0000-000000000001') = 'GST Executive', 'Tara on GST Executive';
  ASSERT pg_temp.role_of('30000000-0000-0000-0000-000000000002') = 'GST Assistant', 'Uday on GST Assistant';
  ASSERT (SELECT string_agg(permission_key, ',') FROM staff_user_extra_permissions
           WHERE user_id = '30000000-0000-0000-0000-000000000001') = 'unlock_sheets', 'Tara keeps unlock_sheets as an extra';
  ASSERT NOT EXISTS (SELECT 1 FROM staff_user_extra_permissions WHERE user_id = '30000000-0000-0000-0000-000000000002'), 'Uday has no extras';
  ASSERT pg_temp.keys('30000000-0000-0000-0000-000000000001')
         = 'add_edit_clients,edit_filing_status,export_data,send_client_emails,unlock_sheets,work_2b_import', 'Tara same access';
  ASSERT pg_temp.keys('30000000-0000-0000-0000-000000000002') = 'send_client_emails,work_2b_import', 'Uday same access';
  ASSERT NOT EXISTS (SELECT 1 FROM staff_positions WHERE is_legacy), 'legacy roles gone';
END $$;

SET ROLE anon;

-- An employee cannot give extras; the public key cannot write the table.
DO $$
BEGIN
  BEGIN
    PERFORM staff_set_user_extras('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', ARRAY['export_data']);
    RAISE EXCEPTION 'employee gave an extra';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO staff_user_extra_permissions (user_id, permission_key) VALUES ('30000000-0000-0000-0000-000000000002', 'export_data');
    RAISE EXCEPTION 'direct write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM staff_set_user_extras('30000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000009', ARRAY['export_data']);
    RAISE EXCEPTION 'extras given to a GST Manager';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A GST Manager gives Uday an extra; it lands in user_permissions and the log.
SELECT staff_set_user_extras('30000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000002', ARRAY['export_data', 'export_data', ' ']);
DO $$
BEGIN
  ASSERT pg_temp.keys('30000000-0000-0000-0000-000000000002') = 'export_data,send_client_emails,work_2b_import', 'extra granted';
  ASSERT EXISTS (SELECT 1 FROM staff_position_log WHERE action = 'grant extra' AND user_id = '30000000-0000-0000-0000-000000000002'
                  AND permission_key = 'export_data' AND actor_id = '30000000-0000-0000-0000-000000000009'), 'grant logged';
END $$;

-- Moving Uday to GST Executive keeps the extra; taking it off then keeps the
-- role's own export_data.
SELECT staff_assign_position('30000000-0000-0000-0000-000000000002',
  (SELECT id FROM staff_positions WHERE name = 'GST Executive'), '30000000-0000-0000-0000-000000000009');
SELECT staff_set_user_extras('30000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000002', ARRAY[]::text[]);
DO $$
BEGIN
  ASSERT pg_temp.keys('30000000-0000-0000-0000-000000000002')
         = 'add_edit_clients,edit_filing_status,export_data,send_client_emails,work_2b_import', 'role keys kept';
  ASSERT EXISTS (SELECT 1 FROM staff_position_log WHERE action = 'revoke extra' AND user_id = '30000000-0000-0000-0000-000000000002'
                  AND actor_id = '30000000-0000-0000-0000-000000000009'), 'revoke logged';
END $$;

-- Back to GST Assistant with no extras: export_data goes.
SELECT staff_assign_position('30000000-0000-0000-0000-000000000002',
  (SELECT id FROM staff_positions WHERE name = 'GST Assistant'), '30000000-0000-0000-0000-000000000009');
DO $$
BEGIN
  ASSERT pg_temp.keys('30000000-0000-0000-0000-000000000002') = 'send_client_emails,work_2b_import', 'back to the role alone';
END $$;
