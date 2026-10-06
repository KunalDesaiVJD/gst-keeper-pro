-- The client master's accountant read as a staff member (migration 20261006125000).
BEGIN;
INSERT INTO profiles (user_id, first_name, email) VALUES
 ('98989898-0000-0000-0000-00000000000a', 'Punit', 'punit@firm.test'),
 ('98989898-0000-0000-0000-00000000000b', 'Mukesh', 'mukesh@firm.test'),
 ('98989898-0000-0000-0000-00000000000c', 'Priya', 'priya@firm.test'),
 ('98989898-0000-0000-0000-00000000000d', 'Dhaval', 'dhaval@firm.test'),
 ('98989898-0000-0000-0000-00000000000e', 'Ruben', 'ruben@firm.test'),
 ('98989898-0000-0000-0000-00000000000f', 'Client Login', 'c@client.test');
INSERT INTO user_roles (user_id, role) VALUES
 ('98989898-0000-0000-0000-00000000000a', 'employee'), ('98989898-0000-0000-0000-00000000000b', 'employee'),
 ('98989898-0000-0000-0000-00000000000c', 'employee'), ('98989898-0000-0000-0000-00000000000d', 'employee'),
 ('98989898-0000-0000-0000-00000000000e', 'employee'), ('98989898-0000-0000-0000-00000000000f', 'client');
CREATE TEMP TABLE cases (accountant text, expected text);
INSERT INTO cases VALUES
 ('MUKESH/21', 'Mukesh'), ('MUKESH / 19', 'Mukesh'), ('PUNITBHAI/27', 'Punit'), ('PUNITBHAI', 'Punit'),
 ('Punitbhai /1', 'Punit'), ('DHAVAL BHAI', 'Dhaval'), ('Priyaben', 'Priya'), ('PRIYA', 'Priya'),
 ('Ruben', 'Ruben'), ('PRIYA,MUKESHBHAI/ 28', NULL), ('Krushangbhai / 6354580698', NULL),
 ('VIJAYBHAI /A/C-9998880257', NULL), ('NA', NULL), ('', NULL), (NULL, NULL), ('Paresh Purohit', NULL);
INSERT INTO clients (id, name, gstin, assigned_accountant)
SELECT ('98989898-0000-0000-0001-' || lpad(row_number() OVER ()::text, 12, '0'))::uuid, 'Client ' || row_number() OVER (),
       '24OWNER' || lpad(row_number() OVER ()::text, 6, '0') || 'Z5', accountant
  FROM cases;
SELECT t_eq((SELECT string_agg(coalesce(c.assigned_accountant, '(null)') || ' → ' || coalesce(o.name, '-') || ' (want ' || coalesce(k.expected, '-') || ')', '; ')
               FROM clients c JOIN cases k ON k.accountant IS NOT DISTINCT FROM c.assigned_accountant
               LEFT JOIN LATERAL notice_owner_for_client(c.id) o ON true
              WHERE c.id::text LIKE '98989898-0000-0000-0001-%'
                AND coalesce(o.name, '-') IS DISTINCT FROM coalesce(k.expected, '-')),
            NULL, 'every accountant spelling resolves as expected');
-- Two staff with the same first name: nobody is picked.
INSERT INTO profiles (user_id, first_name, email) VALUES ('98989898-0000-0000-0000-000000000010', 'Punit', 'punit2@firm.test');
INSERT INTO user_roles (user_id, role) VALUES ('98989898-0000-0000-0000-000000000010', 'employee');
SELECT t_eq((SELECT count(*) FROM clients c, LATERAL notice_owner_for_client(c.id) o WHERE c.assigned_accountant = 'PUNITBHAI/27'),
            0::bigint, 'two staff named Punit: no owner');
ROLLBACK;
