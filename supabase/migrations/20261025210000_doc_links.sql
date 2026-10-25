-- Short document links: https://gst.vjdesai.com/d/<id> instead of the storage
-- address (supabase/functions/_shared/docLink.ts, Edge Function doc-open).
--
-- <id> is base64url of the first 9 bytes of sha256('<bucket>/<object name>'),
-- made by the app without asking; doc_link_id makes the same one here. The
-- table only remembers which file an id names. Storage's own table cannot take
-- a trigger (it belongs to supabase_storage_admin), so a file uploaded since
-- the last fill is found on the first open of an id not yet known.
--
-- RLS on and no policies, on the footing of portal_sessions: the rows list
-- every stored path, and are read only by doc-open with the service role,
-- through doc_link_resolve. Every open is kept in doc_link_opens (same
-- footing).

CREATE TABLE IF NOT EXISTS public.doc_links (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{12}$'),
  bucket text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, name)
);
ALTER TABLE public.doc_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doc_links FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.doc_link_opens (
  seq bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  link_id text NOT NULL,
  actor_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('opened', 'refused', 'not_found', 'failed')),
  detail text
);
CREATE INDEX IF NOT EXISTS doc_link_opens_link_idx ON public.doc_link_opens (link_id, at DESC);
ALTER TABLE public.doc_link_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doc_link_opens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.doc_link_id(p_bucket text, p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog
AS $$
  SELECT translate(encode(substring(sha256(convert_to(p_bucket || '/' || p_name, 'UTF8')) FROM 1 FOR 9), 'base64'), '+/', '-_')
$$;

-- The file an id names, or no row. An id not yet known fills the table from
-- storage first (the files uploaded since the last fill).
CREATE OR REPLACE FUNCTION public.doc_link_resolve(p_id text)
RETURNS TABLE (bucket text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_id IS NULL OR p_id !~ '^[A-Za-z0-9_-]{12}$' THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT l.bucket, l.name FROM public.doc_links l WHERE l.id = p_id;
  IF FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.doc_links (id, bucket, name)
  SELECT public.doc_link_id(o.bucket_id, o.name), o.bucket_id, o.name
    FROM storage.objects o
   WHERE o.bucket_id IN ('return-pdfs', 'annual-return-evidence', 'chat-attachments')
     AND o.name IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.doc_links l WHERE l.bucket = o.bucket_id AND l.name = o.name)
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT l.bucket, l.name FROM public.doc_links l WHERE l.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_link_resolve(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.doc_link_resolve(text) TO service_role;

-- Every file stored today.
INSERT INTO public.doc_links (id, bucket, name)
SELECT public.doc_link_id(o.bucket_id, o.name), o.bucket_id, o.name
  FROM storage.objects o
 WHERE o.bucket_id IN ('return-pdfs', 'annual-return-evidence', 'chat-attachments')
   AND o.name IS NOT NULL
ON CONFLICT DO NOTHING;
