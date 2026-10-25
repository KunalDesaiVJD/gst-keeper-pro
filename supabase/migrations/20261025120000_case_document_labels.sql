-- Case documents organised (Notices & Litigation → notice page → Documents and
-- Evidence tabs). The portal names case folder files as the officer or the
-- taxpayer uploaded them ("Binder2.pdf", "8A.pdf"); the app shows each with a
-- readable name and type worked out from the portal's JSON and the AI reader
-- (src/lib/caseDocuments.ts, src/lib/evidenceTypes.ts). This table keeps what a
-- person decided about one file instead: a name of their own, the type of
-- evidence, and whether it belongs on the Evidence tab at all. The original
-- filename is never changed (the portal's file and storage path stay as they are).
--
-- doc_key: the file's storage URL for a case folder file, 'upload:<matter_documents.id>'
-- for a file uploaded on the notice page. One row a (client, file).
-- Additive only (a label is made only on a notice page, so its client already
-- holds notices, which keep the client on record anyway). RLS open to public as every app table (CLAUDE.md: the app
-- has no Supabase auth session; login and the permission keys are the gate).

DO $$
BEGIN
  IF to_regclass('public.case_document_labels') IS NULL THEN
    CREATE TABLE public.case_document_labels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL REFERENCES public.clients(id),
      case_id text,
      doc_key text NOT NULL,
      title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 200),
      evidence_type text CHECK (evidence_type IS NULL OR evidence_type ~ '^[a-z0-9_]{2,40}$'),
      is_evidence boolean,
      note text CHECK (note IS NULL OR length(note) <= 500),
      set_by uuid,
      set_by_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT case_document_labels_one UNIQUE (client_id, doc_key)
    );
    COMMENT ON TABLE public.case_document_labels IS
      'A person''s name, evidence type and Evidence-tab choice for one case document; the portal file and its original name are never changed.';
    CREATE INDEX case_document_labels_case_idx ON public.case_document_labels (client_id, case_id);
    ALTER TABLE public.case_document_labels ENABLE ROW LEVEL SECURITY;
    CREATE POLICY case_document_labels_public ON public.case_document_labels
      FOR ALL TO public USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.case_document_labels_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'case_document_labels_touch'
                 AND tgrelid = 'public.case_document_labels'::regclass) THEN
    CREATE TRIGGER case_document_labels_touch BEFORE UPDATE ON public.case_document_labels
      FOR EACH ROW EXECUTE FUNCTION public.case_document_labels_touch();
  END IF;
END $$;
