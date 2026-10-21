-- Fictional people and clients shared by the tests (as the platform owner).
SET search_path = public, extensions;
INSERT INTO profiles (user_id, first_name) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Sam'),
 ('10000000-0000-0000-0000-000000000002', 'Gita'),
 ('10000000-0000-0000-0000-000000000003', 'Esha');
INSERT INTO user_roles (user_id, role) VALUES
 ('10000000-0000-0000-0000-000000000001', 'superadmin'),
 ('10000000-0000-0000-0000-000000000002', 'gst_manager'),
 ('10000000-0000-0000-0000-000000000003', 'employee');
INSERT INTO clients (id, name, gstin, gst_user_id, gst_password, client_password, liberal_2b_reconciliation) VALUES
 ('20000000-0000-0000-0000-000000000001', 'SUNRISE TRADERS', '24AAAAA0000A1Z5', 'sunrise_gst', 'Portal-Secret-1', 'Client-Secret-1', false),
 ('20000000-0000-0000-0000-000000000002', 'MOONLIGHT FABRICS', '24BBBBB1111B1Z6', 'moon_gst', 'Portal-Secret-2', 'Client-Secret-2', false);
-- Fixtures are not the subject of the tests.
SELECT set_config('app.gst_change_log_retention', 'on', false);
DELETE FROM gst_change_log;
SELECT set_config('app.gst_change_log_retention', '', false);
