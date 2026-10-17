-- The platform pieces the staff migrations expect, as on the live project:
-- Supabase's roles, pgcrypto in the extensions schema, and the staff tables
-- as they stood before 20261014120000_staff_positions.sql. Fictional only.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  password text
);
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  is_first_login boolean DEFAULT true,
  UNIQUE (user_id, role)
);
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL,
  granted_by uuid,
  granted_at timestamptz DEFAULT now(),
  UNIQUE (user_id, permission_key)
);
-- The live policies these tables carried (open: the app has no auth session).
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can manage user_roles for development" ON public.user_roles FOR ALL TO public USING (true) WITH CHECK (true);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view profiles" ON public.profiles FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert profiles for development" ON public.profiles FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can delete profiles for development" ON public.profiles FOR DELETE TO public USING (true);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO public USING (auth.uid() = user_id);
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can manage permissions for development" ON public.user_permissions FOR ALL TO public USING (true) WITH CHECK (true);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- The live first-login function (clears the first-login flag).
CREATE FUNCTION public.complete_first_login(target_user_id uuid, old_password text, new_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE stored_hash text;
BEGIN
  SELECT password INTO stored_hash FROM public.profiles WHERE user_id = target_user_id;
  IF stored_hash IS NULL OR stored_hash != crypt(old_password, stored_hash) THEN RAISE EXCEPTION 'Current password is incorrect'; END IF;
  UPDATE public.profiles SET password = crypt(new_password, gen_salt('bf', 10)) WHERE user_id = target_user_id;
  UPDATE public.user_roles SET is_first_login = false WHERE user_id = target_user_id;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.complete_first_login(uuid, text, text) TO anon;

-- The old reset functions the positions migration revokes from the public key.
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, client_password text);
CREATE FUNCTION public.reset_employee_password(target_user_id uuid, new_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  UPDATE public.profiles SET password = crypt(new_password, gen_salt('bf', 10)) WHERE user_id = target_user_id;
  UPDATE public.user_roles SET is_first_login = false WHERE user_id = target_user_id;
  RETURN FOUND;
END $$;
CREATE FUNCTION public.reset_client_password(target_client_id uuid, new_password text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;

CREATE FUNCTION public.t_eq(p_actual anyelement, p_expected anyelement, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAILED %: expected [%], got [%]', p_label, p_expected, p_actual;
  END IF;
END $$;
-- Passes when p_sql raises an error whose message contains p_like.
CREATE FUNCTION public.t_raises(p_sql text, p_like text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_like in SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAILED %: raised [%], expected it to mention [%]', p_label, SQLERRM, p_like;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED %: did not raise', p_label;
END $$;
GRANT EXECUTE ON FUNCTION public.t_eq(anyelement, anyelement, text), public.t_raises(text, text, text) TO anon;
