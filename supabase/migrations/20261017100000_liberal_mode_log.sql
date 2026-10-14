-- Who switches a client between Strict and Liberal 2B Reconciliation, and when.
--
-- 14 Oct 2026 (the firm's option 3): Liberal mode also makes ITC Summary row
-- 5.1 a typed figure, and an audit found 11 Liberal clients whose Aug-26 ITC
-- had been typed there with no 2B behind it. The firm keeps the mode but wants
-- every switch recorded. Nothing recorded it: clients keeps only the flag.
--
-- The app does not hold a Supabase auth session (auth.uid() is NULL), so the
-- person is stamped by the app on the same UPDATE that flips the flag
-- (liberal_changed_by / liberal_changed_by_name / liberal_changed_at). The
-- BEFORE trigger keeps a stamp only when that update sent a new one (its
-- liberal_changed_at moved): a flip without one is recorded as "not recorded",
-- never with the previous person's name. The time is always the database's.
-- The AFTER trigger writes one row per switch to client_liberal_log, which the
-- app can read but not write (SELECT policy only; rows come from the trigger).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS liberal_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS liberal_changed_by uuid,
  ADD COLUMN IF NOT EXISTS liberal_changed_by_name text;

CREATE TABLE IF NOT EXISTS public.client_liberal_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  liberal boolean NOT NULL,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_liberal_log_client_idx ON public.client_liberal_log (client_id, changed_at DESC);

ALTER TABLE public.client_liberal_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_liberal_log_read ON public.client_liberal_log;
CREATE POLICY client_liberal_log_read ON public.client_liberal_log FOR SELECT TO public USING (true);
GRANT SELECT ON public.client_liberal_log TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.clients_liberal_stamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.liberal_2b_reconciliation THEN
      NEW.liberal_changed_at := now();
    ELSE
      NEW.liberal_changed_at := NULL;
      NEW.liberal_changed_by := NULL;
      NEW.liberal_changed_by_name := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.liberal_2b_reconciliation IS DISTINCT FROM OLD.liberal_2b_reconciliation THEN
    IF NEW.liberal_changed_at IS NOT DISTINCT FROM OLD.liberal_changed_at THEN
      NEW.liberal_changed_by := NULL;
      NEW.liberal_changed_by_name := NULL;
    END IF;
    NEW.liberal_changed_at := now();
  ELSE
    NEW.liberal_changed_at := OLD.liberal_changed_at;
    NEW.liberal_changed_by := OLD.liberal_changed_by;
    NEW.liberal_changed_by_name := OLD.liberal_changed_by_name;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clients_liberal_log_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.liberal_2b_reconciliation)
     OR (TG_OP = 'UPDATE' AND NEW.liberal_2b_reconciliation IS DISTINCT FROM OLD.liberal_2b_reconciliation) THEN
    INSERT INTO public.client_liberal_log (client_id, liberal, changed_by, changed_by_name, changed_at)
    VALUES (NEW.id, NEW.liberal_2b_reconciliation, NEW.liberal_changed_by, NEW.liberal_changed_by_name, COALESCE(NEW.liberal_changed_at, now()));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_liberal_stamp ON public.clients;
CREATE TRIGGER trg_clients_liberal_stamp BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_liberal_stamp();

DROP TRIGGER IF EXISTS trg_clients_liberal_log ON public.clients;
CREATE TRIGGER trg_clients_liberal_log AFTER INSERT OR UPDATE OF liberal_2b_reconciliation ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_liberal_log_write();
