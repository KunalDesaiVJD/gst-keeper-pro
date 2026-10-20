-- The note on a request filed for staff never sends anyone to a screen they
-- may not be able to open. Every staff level sees client requests on the
-- Dashboard and can open the reset dialog from them ("Reset password"), which
-- shows why no link reached the client (client_password_log_for, any staff
-- level); Edit Client is not open to every employee.
BEGIN;
SELECT t_eq(position('Edit Client' IN client_password_staff_note()), 0, 'the note does not send staff to Edit Client');
SELECT t_eq(client_password_staff_note(),
  'Asked for a reset link; none reached the client. Reset password shows why.', 'the note names the Dashboard''s own button');

INSERT INTO clients (id, name, gstin, email, client_password) VALUES
 ('c9700000-0000-0000-0000-000000000001', 'Why Co', '24AAACW9701A1Z1', NULL, 'x');
INSERT INTO user_roles (user_id, role) VALUES ('c9700000-0000-0000-0000-0000000000e1', 'employee');
SET LOCAL ROLE anon; SELECT client_password_reset_request('24AAACW9701A1Z1'); RESET ROLE;
SELECT t_eq((SELECT note FROM password_reset_requests WHERE user_id = 'c9700000-0000-0000-0000-000000000001'),
  client_password_staff_note(), 'the request carries the note');
-- Any employee (no permission key) reads why, as the dialog does.
SET LOCAL ROLE anon;
SELECT t_eq((SELECT detail FROM client_password_log_for('c9700000-0000-0000-0000-0000000000e1',
                                                        'c9700000-0000-0000-0000-000000000001', 50)
              WHERE action = 'fallback_request'),
  'Asked for a reset link, but there is no e-mail address on record. A request is waiting on the Dashboard.',
  'an employee can read why, through client_password_log_for');
RESET ROLE;
ROLLBACK;
