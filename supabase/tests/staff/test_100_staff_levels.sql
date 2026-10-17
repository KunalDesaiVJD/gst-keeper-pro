-- Staff levels change only through staff_set_level / staff_add_level /
-- staff_remove (20261017100000), sessions end only through
-- staff_end_sessions (20261017110000). Run as the public key (anon), as the
-- app does. Fictional people only.

SET search_path = public, extensions;

-- Fixtures (as the platform owner, the guard opened for setup).
SELECT set_config('app.staff_roles_write', 'on', false), set_config('app.position_sync', 'on', false);
INSERT INTO profiles (user_id, first_name, email, password) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Sam',   'sam@example.test',   crypt('Super-Pass-1', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000002', 'Gita',  'gita@example.test',  crypt('Gm-pass-12', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000003', 'Esha',  'esha@example.test',  crypt('Esha-pass-1', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000004', 'Mohan', 'mohan@example.test', crypt('Mohan-pass1', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000005', 'Ravi',  'ravi@example.test',  crypt('Ravi-pass-1', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000006', 'Neel',  'neel@example.test',  crypt('2026', gen_salt('bf', 4))),
 ('10000000-0000-0000-0000-000000000007', 'Nina',  'nina@example.test',  crypt('2026', gen_salt('bf', 4)));
INSERT INTO user_roles (user_id, role, is_first_login) VALUES
 ('10000000-0000-0000-0000-000000000001', 'superadmin', false),
 ('10000000-0000-0000-0000-000000000002', 'gst_manager', false),
 ('10000000-0000-0000-0000-000000000003', 'employee', true),
 ('10000000-0000-0000-0000-000000000004', 'employee', false),
 ('10000000-0000-0000-0000-000000000005', 'employee', false);
INSERT INTO user_permissions (user_id, permission_key) VALUES ('10000000-0000-0000-0000-000000000004', 'manage_employees');
INSERT INTO staff_positions (id, name) VALUES ('20000000-0000-0000-0000-000000000001', 'Article assistant');
INSERT INTO staff_position_permissions (position_id, permission_key) VALUES ('20000000-0000-0000-0000-000000000001', 'work_2b_import');
UPDATE profiles SET position_id = '20000000-0000-0000-0000-000000000001' WHERE user_id = '10000000-0000-0000-0000-000000000005';
SELECT set_config('app.staff_roles_write', 'off', false), set_config('app.position_sync', 'off', false);

SET ROLE anon;

-- 1. Direct writes refused
SELECT t_raises($$UPDATE user_roles SET role = 'superadmin' WHERE user_id = '10000000-0000-0000-0000-000000000005'$$, 'Staff levels change only', 'an employee made superadmin directly');
SELECT t_raises($$UPDATE user_roles SET role = 'gst_manager' WHERE user_id = '10000000-0000-0000-0000-000000000005'$$, 'Staff levels change only', 'an employee made GST Manager directly');
SELECT t_raises($$INSERT INTO user_roles (user_id, role) VALUES ('10000000-0000-0000-0000-000000000006', 'superadmin')$$, 'Staff levels change only', 'a level added directly');
SELECT t_raises($$DELETE FROM user_roles WHERE user_id = '10000000-0000-0000-0000-000000000002'$$, 'Staff levels change only', 'a level removed directly');
SELECT t_raises($$UPDATE user_roles SET user_id = '10000000-0000-0000-0000-000000000006' WHERE user_id = '10000000-0000-0000-0000-000000000002'$$, 'Staff levels change only', 'a level moved to another person');
SELECT t_raises($$UPDATE user_roles SET is_first_login = true WHERE user_id = '10000000-0000-0000-0000-000000000004'$$, 'Staff levels change only', 'first login set again directly');
SELECT t_raises($$DELETE FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000005'$$, 'Remove staff only', 'a staff profile deleted directly');
SELECT t_eq((SELECT count(*) FROM user_roles WHERE role = 'superadmin')::int, 1, 'still one superadmin');

-- 2. The first-login flag still clears (the sign-in functions)
SELECT t_eq(complete_first_login('10000000-0000-0000-0000-000000000003', 'Esha-pass-1', 'Esha-pass-2'), true, 'first login completes');
SELECT t_eq((SELECT is_first_login FROM user_roles WHERE user_id = '10000000-0000-0000-0000-000000000003'), false, 'first-login flag cleared');

-- 3. Changing a level: the superadmin, with their password
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000002', 'Gm-pass-12', '10000000-0000-0000-0000-000000000005', 'gst_manager')$$, 'Only the superadmin', 'a GST Manager cannot promote');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000004', 'Mohan-pass1', '10000000-0000-0000-0000-000000000005', 'gst_manager')$$, 'Only the superadmin', 'an employee manager cannot promote');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000001', 'wrong', '10000000-0000-0000-0000-000000000005', 'gst_manager')$$, 'password is not correct', 'the superadmin id without the password');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000001', NULL, '10000000-0000-0000-0000-000000000005', 'gst_manager')$$, 'password is not correct', 'no password');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000005', 'superadmin')$$, 'Employee or GST Manager', 'nobody is made superadmin');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000001', 'employee')$$, 'cannot be changed', 'the superadmin is not demoted');
SELECT t_raises($$SELECT staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000006', 'employee')$$, 'No staff account', 'a person without a level');
SELECT t_eq(staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000005', 'gst_manager'), true, 'the superadmin promotes');
SELECT t_eq(staff_level_of('10000000-0000-0000-0000-000000000005'), 'gst_manager', 'promoted');
SELECT t_eq(staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000005', 'gst_manager'), false, 'no change, nothing done');
SELECT t_eq(staff_set_level('10000000-0000-0000-0000-000000000001', 'Super-Pass-1', '10000000-0000-0000-0000-000000000005', 'employee'), true, 'the superadmin demotes');
SELECT t_eq((SELECT array_agg(permission_key) FROM user_permissions WHERE user_id = '10000000-0000-0000-0000-000000000005'), ARRAY['work_2b_import'], 'demoted: permissions from the position again');
SELECT t_eq((SELECT array_agg(position_name ORDER BY id) FROM staff_position_log WHERE action = 'level' AND user_id = '10000000-0000-0000-0000-000000000005'),
            ARRAY['Employee → GST Manager', 'GST Manager → Employee'], 'level changes logged');
SELECT t_eq((SELECT actor_id FROM staff_position_log WHERE action = 'level' ORDER BY id DESC LIMIT 1), '10000000-0000-0000-0000-000000000001'::uuid, 'by the superadmin');

-- 4. Adding a level
SELECT t_raises($$SELECT staff_add_level('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006', 'employee')$$, 'not allowed', 'a plain employee cannot add staff');
SELECT t_eq(staff_add_level('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006', 'employee'), true, 'an employee manager adds an Employee');
SELECT t_eq((SELECT role::text || '/' || is_first_login FROM user_roles WHERE user_id = '10000000-0000-0000-0000-000000000006'), 'employee/true', 'as an Employee, first login pending');
SELECT t_raises($$SELECT staff_add_level('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'gst_manager', 'Super-Pass-1')$$, 'already has a level', 'a second level is not added');
SELECT t_raises($$SELECT staff_add_level('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'gst_manager')$$, 'Only the superadmin', 'a GST Manager cannot add a GST Manager');
SELECT t_raises($$SELECT staff_add_level('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'superadmin', 'Super-Pass-1')$$, 'Employee or GST Manager', 'nobody is added as superadmin');
SELECT t_raises($$SELECT staff_add_level('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000099', 'employee')$$, 'profile first', 'a level needs a profile');
SELECT t_eq(staff_add_level('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'gst_manager', 'Super-Pass-1'), true, 'the superadmin adds a GST Manager');

-- 5. Removing staff
SELECT t_raises($$SELECT staff_remove('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000007')$$, 'Only the superadmin', 'an employee manager cannot remove a GST Manager');
SELECT t_raises($$SELECT staff_remove('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'Gm-pass-12')$$, 'Only the superadmin', 'a GST Manager cannot remove a GST Manager');
SELECT t_raises($$SELECT staff_remove('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$$, 'cannot be removed', 'the superadmin is never removed');
SELECT t_raises($$SELECT staff_remove('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004')$$, 'yourself', 'nobody removes themselves');
SELECT t_raises($$SELECT staff_remove('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006')$$, 'not allowed', 'a plain employee cannot remove staff');
SELECT t_eq(staff_remove('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000006'), true, 'an employee manager removes an Employee');
SELECT t_eq((SELECT count(*) FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000006')::int
          + (SELECT count(*) FROM user_roles WHERE user_id = '10000000-0000-0000-0000-000000000006')::int, 0, 'profile and level gone');
SELECT t_eq(staff_remove('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'Super-Pass-1'), true, 'the superadmin removes a GST Manager');
SELECT t_eq((SELECT count(*) FROM staff_position_log WHERE action IN ('added', 'removed'))::int, 4, 'adds and removals logged');

-- 6. The checks cannot be called on their own
SELECT t_raises($$SELECT staff_require_superadmin('10000000-0000-0000-0000-000000000001', 'x')$$, 'permission denied', 'superadmin check not callable');
SELECT t_raises($$SELECT staff_require_employee_manager('10000000-0000-0000-0000-000000000004')$$, 'permission denied', 'manager check not callable');

-- 7. Ending sessions
SELECT t_raises($$SELECT staff_end_sessions('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003')$$, 'not allowed', 'a plain employee cannot end another''s sessions');
SELECT t_raises($$SELECT staff_end_sessions('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')$$, 'Only the superadmin', 'a GST Manager cannot end the superadmin''s sessions');
SELECT t_raises($$SELECT staff_end_sessions('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002')$$, 'Only the superadmin', 'an employee manager cannot end a GST Manager''s sessions');
SELECT t_eq(staff_end_sessions('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003') IS NOT NULL, true, 'an employee manager ends an Employee''s sessions');
SELECT t_eq((SELECT sessions_ended_at IS NOT NULL FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000003'), true, 'stamped on the profile');
SELECT t_eq(staff_end_sessions('10000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005') IS NOT NULL, true, 'anyone ends their own');
SELECT t_eq(staff_end_sessions('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002') IS NOT NULL, true, 'the superadmin ends a GST Manager''s');
SELECT t_eq((SELECT count(*) FROM staff_position_log WHERE action = 'logged out')::int, 3, 'logged out logged');
-- Profiles cannot be updated with the public key at all (their policy needs an auth session).
UPDATE profiles SET sessions_ended_at = NULL WHERE user_id = '10000000-0000-0000-0000-000000000003';
SELECT t_eq((SELECT sessions_ended_at IS NOT NULL FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000003'), true, 'a session end is not undone directly');

RESET ROLE;
