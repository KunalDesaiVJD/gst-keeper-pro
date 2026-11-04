-- What Supabase brings, enough for the migration: the roles, pgcrypto in
-- extensions, a stand-in Vault (the real one encrypts; this one only stores),
-- and the app's user_roles / profiles.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, description, secret) VALUES (new_name, new_description, new_secret) RETURNING id $$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = coalesce(new_secret, secret) WHERE id = secret_id $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.profiles (user_id uuid, first_name text, password text);
INSERT INTO public.user_roles VALUES
  ('11111111-1111-1111-1111-111111111111', 'superadmin'),
  ('22222222-2222-2222-2222-222222222222', 'gst_manager'),
  ('33333333-3333-3333-3333-333333333333', 'employee');
INSERT INTO public.profiles VALUES
  ('11111111-1111-1111-1111-111111111111', 'Owner', extensions.crypt('owner-pass', extensions.gen_salt('bf'))),
  ('22222222-2222-2222-2222-222222222222', 'Manager', extensions.crypt('manager-pass', extensions.gen_salt('bf'))),
  ('33333333-3333-3333-3333-333333333333', 'Staff', extensions.crypt('staff-pass', extensions.gen_salt('bf')));
-- As on Supabase, the service role may look into Vault (the browser's roles may not).
GRANT USAGE ON SCHEMA vault TO service_role;
GRANT SELECT ON vault.secrets TO service_role;
