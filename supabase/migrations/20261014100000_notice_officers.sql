-- Notices · the officers' book (the firm's request of 12 October 2026: "keep an
-- option to add mobile number against each officer's name so that it would be
-- easy to reach out to the officer as and when required").
--
-- One row per officer, keyed by the name as the case shows it (case overview's
-- Officer: the notice or what the AI read in its documents), normalised so the
-- same officer written twice is one row. Staff add a mobile (and e-mail, office,
-- notes) from the case page; Notices · Settings lists the book.
--
-- Objects: notice_officers, notice_officer_key(), notice_officer_save().

CREATE OR REPLACE FUNCTION public.notice_officer_key(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

CREATE TABLE IF NOT EXISTS public.notice_officers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_key        text NOT NULL UNIQUE,
  name            text NOT NULL,
  mobile          text,
  email           text,
  office          text,
  notes           text,
  updated_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notice_officers_mobile_chk CHECK (mobile IS NULL OR mobile ~ '^[0-9+() -]{6,20}$')
);
COMMENT ON TABLE public.notice_officers IS
  'GST officers the firm deals with, keyed by the name as cases show it, with the mobile, e-mail and office staff saved.';
ALTER TABLE public.notice_officers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notice_officers_all ON public.notice_officers;
CREATE POLICY notice_officers_all ON public.notice_officers FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notice_officers TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notice_officer_save(p_name text, p_mobile text, p_email text DEFAULT NULL,
                                                      p_office text DEFAULT NULL, p_notes text DEFAULT NULL, p_actor text DEFAULT NULL)
RETURNS public.notice_officers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := public.notice_officer_key(p_name);
  v_row public.notice_officers;
BEGIN
  IF v_key IS NULL THEN RAISE EXCEPTION 'The officer''s name is needed'; END IF;
  INSERT INTO public.notice_officers AS o (name_key, name, mobile, email, office, notes, updated_by_name, updated_at)
  VALUES (v_key, left(btrim(p_name), 200), nullif(btrim(p_mobile), ''), nullif(btrim(p_email), ''),
          nullif(btrim(p_office), ''), nullif(btrim(p_notes), ''), left(p_actor, 120), now())
  ON CONFLICT (name_key) DO UPDATE
     SET mobile = EXCLUDED.mobile, email = EXCLUDED.email, office = EXCLUDED.office, notes = EXCLUDED.notes,
         updated_by_name = EXCLUDED.updated_by_name, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.notice_officer_save(text, text, text, text, text, text) TO anon, authenticated, service_role;
