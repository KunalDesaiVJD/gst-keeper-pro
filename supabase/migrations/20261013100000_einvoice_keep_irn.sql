-- E-invoice: "keep, don't re-send" (docs/GSTR1_EINVOICE_POSITIONS.md).
--
-- An e-invoice that a same-day pull saw on the portal's GSTR-1 draft is
-- LEFT OUT of the uploaded JSON, so the portal keeps its own record with
-- Source, IRN and IRN date (GSTN advisory para 6: an edited auto-populated
-- document loses them). One still pending auto-population is never left
-- out. The app never writes irn, irngendate or srctyp into an upload any
-- more.
--
-- a. einvoice_docs: the Excel's columns (irn_status, autopop_status,
--    autopop_date, error), gone_at (a pulled record the latest pull no
--    longer saw is marked, never deleted, so its IRN stays on record and it
--    reads as "IRN lost"), and a unique key that tells a credit note from a
--    debit note with the same number and keeps the pull's record and the
--    Excel's record of one document apart:
--    (client_id, period_month, section, ctin, doc_type, doc_key, source).
--    doc_key now holds the EXACT document number (upper-cased, inner
--    whitespace collapsed), not the separator-stripped one. The table was
--    empty when this was written (0 rows on 10 Oct 2026), so nothing is
--    rewritten.
-- b. einvoice_pulls: one row per (client, period, source), so a pull and an
--    Excel import are both recorded; generated_on, the date the portal
--    generated the pulled GSTR-1 file (a file generated before the pull day
--    is recorded as status 'stale' and nothing is saved from it).
-- c. gstr1_upload_versions: einvoice_kept (documents left out of the upload)
--    and ext_version (the extension that pushed). The payload stays the
--    books JSON.
-- d. client_einvoice_evidence(client) / client_einvoice_evidence_all(): is
--    this client an e-invoice issuer, by evidence, PAN-wide.
-- e. einvoice_excel_replace(): an e-invoice Excel import replaces the
--    period's Excel records in one transaction.
--
-- Extension 0.8.6 and older upsert einvoice_docs on the old key; after this
-- migration their pull reports "failed" and saves nothing (no data is lost:
-- nothing was ever pulled). Ship with extension 0.8.7.
--
-- RLS stays open to public (CLAUDE.md: the app has no Supabase auth session).

-- ---------------------------------------------------------------------------
-- a. einvoice_docs
-- ---------------------------------------------------------------------------
ALTER TABLE public.einvoice_docs
  ADD COLUMN IF NOT EXISTS irn_status     text,
  ADD COLUMN IF NOT EXISTS autopop_status text,
  ADD COLUMN IF NOT EXISTS autopop_date   text,
  ADD COLUMN IF NOT EXISTS error          text,
  ADD COLUMN IF NOT EXISTS gone_at        timestamptz;

ALTER TABLE public.einvoice_docs DROP CONSTRAINT IF EXISTS einvoice_docs_irn_status_check;
ALTER TABLE public.einvoice_docs ADD CONSTRAINT einvoice_docs_irn_status_check
  CHECK (irn_status IS NULL OR irn_status IN ('valid', 'cancelled'));
ALTER TABLE public.einvoice_docs DROP CONSTRAINT IF EXISTS einvoice_docs_autopop_status_check;
ALTER TABLE public.einvoice_docs ADD CONSTRAINT einvoice_docs_autopop_status_check
  CHECK (autopop_status IS NULL OR autopop_status IN ('done', 'pending', 'failed'));
ALTER TABLE public.einvoice_docs DROP CONSTRAINT IF EXISTS einvoice_docs_source_check;
ALTER TABLE public.einvoice_docs ADD CONSTRAINT einvoice_docs_source_check
  CHECK (source IN ('portal_gstr1', 'einvoice_excel'));
ALTER TABLE public.einvoice_docs DROP CONSTRAINT IF EXISTS einvoice_docs_doc_type_check;
ALTER TABLE public.einvoice_docs ADD CONSTRAINT einvoice_docs_doc_type_check
  CHECK (doc_type IN ('INV', 'CRN', 'DBN'));

-- The old key (client_id, period_month, section, ctin, doc_key), named by
-- Postgres when 20261009100000 created the table inline.
ALTER TABLE public.einvoice_docs
  DROP CONSTRAINT IF EXISTS einvoice_docs_client_id_period_month_section_ctin_doc_key_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.einvoice_docs'::regclass
       AND conname = 'einvoice_docs_identity_source_key'
  ) THEN
    ALTER TABLE public.einvoice_docs
      ADD CONSTRAINT einvoice_docs_identity_source_key
      UNIQUE (client_id, period_month, section, ctin, doc_type, doc_key, source);
  END IF;
END $$;

COMMENT ON COLUMN public.einvoice_docs.source IS
  'Where the record came from: portal_gstr1 = the extension''s pull of the portal''s GSTR-1 JSON (documents on the draft that carry an IRN); einvoice_excel = an import of the GSTR-1 dashboard''s "Download details from e-invoices (Excel)".';
COMMENT ON COLUMN public.einvoice_docs.doc_key IS
  'The exact document number: trimmed, upper-cased, runs of whitespace collapsed to one space. Separators are kept: INV-001 and INV/001 are two documents.';
COMMENT ON COLUMN public.einvoice_docs.doc_type IS 'INV, or CRN / DBN from the note''s ntty (C / D).';
COMMENT ON COLUMN public.einvoice_docs.irn_status IS 'einvoice_excel only: valid | cancelled (e-invoice status on the IRP). A cancelled IRN is never used.';
COMMENT ON COLUMN public.einvoice_docs.autopop_status IS 'einvoice_excel only: done | pending | failed (GSTR-1 auto-population status). NULL when the file gives none, and for a pull.';
COMMENT ON COLUMN public.einvoice_docs.autopop_date IS 'einvoice_excel only: date of auto-population (or deletion), dd-mm-yyyy.';
COMMENT ON COLUMN public.einvoice_docs.error IS 'einvoice_excel only: error in auto-population / deletion, as the file gives it.';
COMMENT ON COLUMN public.einvoice_docs.gone_at IS
  'portal_gstr1 only: when a pull no longer saw this document on the draft with its IRN. The row is kept (never deleted) and reads as "IRN lost"; a later pull that sees it again sets it back to NULL.';
COMMENT ON COLUMN public.einvoice_docs.last_seen_at IS
  'When the latest pull (or import) saw the document: the same timestamp as that pull''s einvoice_pulls.pulled_at.';

-- ---------------------------------------------------------------------------
-- b. einvoice_pulls
-- ---------------------------------------------------------------------------
ALTER TABLE public.einvoice_pulls
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal_gstr1';
ALTER TABLE public.einvoice_pulls DROP CONSTRAINT IF EXISTS einvoice_pulls_source_check;
ALTER TABLE public.einvoice_pulls ADD CONSTRAINT einvoice_pulls_source_check
  CHECK (source IN ('portal_gstr1', 'einvoice_excel'));
ALTER TABLE public.einvoice_pulls DROP CONSTRAINT IF EXISTS einvoice_pulls_client_id_period_month_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.einvoice_pulls'::regclass
       AND conname = 'einvoice_pulls_client_period_source_key'
  ) THEN
    ALTER TABLE public.einvoice_pulls
      ADD CONSTRAINT einvoice_pulls_client_period_source_key UNIQUE (client_id, period_month, source);
  END IF;
END $$;
COMMENT ON COLUMN public.einvoice_pulls.source IS
  'portal_gstr1 = the extension''s pull of the portal''s GSTR-1 JSON; einvoice_excel = an import of the e-invoice Excel.';
ALTER TABLE public.einvoice_pulls
  ADD COLUMN IF NOT EXISTS generated_on date;
COMMENT ON COLUMN public.einvoice_pulls.generated_on IS
  'portal_gstr1 only: the date the portal generated the GSTR-1 file the pull read (from the ZIP entry name returns_<ddmmyyyy>_...). NULL when the name gave none.';
COMMENT ON COLUMN public.einvoice_pulls.status IS
  'ok | none | pending | failed | stale. stale = the portal served a file generated before the pull day: nothing was saved or marked, and the push gate does not accept it.';

-- ---------------------------------------------------------------------------
-- c. gstr1_upload_versions
-- ---------------------------------------------------------------------------
ALTER TABLE public.gstr1_upload_versions
  ADD COLUMN IF NOT EXISTS einvoice_kept integer,
  ADD COLUMN IF NOT EXISTS ext_version   text;
COMMENT ON COLUMN public.gstr1_upload_versions.einvoice_kept IS
  'UPLOAD rows: books documents left out of the uploaded JSON because the portal already holds them as e-invoices (extension 0.8.7+). NULL = not recorded. payload stays the books JSON.';
COMMENT ON COLUMN public.gstr1_upload_versions.ext_version IS
  'UPLOAD rows: version of the extension that made the push (0.8.7+).';

-- ---------------------------------------------------------------------------
-- d. E-invoice issuer, by evidence (PAN-wide)
-- ---------------------------------------------------------------------------
-- A client issues e-invoices when it, or any registration on the same PAN
-- (GSTIN characters 3 to 12; e-invoicing follows the PAN's aggregate
-- turnover), is ticked "E-invoice applicable", has e-invoice records, or
-- has a stored GSTR-1 JSON (imported or filed) carrying an IRN (64 hex
-- characters) or srctyp "E-Invoice". Independent of any exemption: a GTA
-- that issues IRNs anyway is still an issuer. Evidence on the client itself
-- is preferred to a same-PAN registration's, then the tick, the records,
-- the GSTR-1 JSON, the filed return.
CREATE OR REPLACE FUNCTION public.einvoice_evidence_rows(p_client_id uuid)
RETURNS TABLE (client_id uuid, issues_einvoices boolean, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cl AS (
    SELECT c.id, c.name, COALESCE(c.einvoice_applicable, false) AS ticked,
           CASE WHEN upper(btrim(c.gstin)) ~ '^[0-9]{2}[A-Z0-9]{13}$'
                THEN substring(upper(btrim(c.gstin)) FROM 3 FOR 10) END AS pan
      FROM public.clients c
  ),
  target AS (
    SELECT cl.* FROM cl WHERE p_client_id IS NULL OR cl.id = p_client_id
  ),
  -- Registrations whose evidence counts for a target: itself, or the same PAN.
  pair AS (
    SELECT t.id AS target_id, s.id AS src_id, s.name AS src_name, (s.id = t.id) AS own
      FROM target t
      JOIN cl s ON s.id = t.id OR (t.pan IS NOT NULL AND s.pan = t.pan)
  ),
  src AS (SELECT DISTINCT src_id FROM pair),
  ev AS (
    SELECT s.id AS src_id, 1 AS rnk, NULL::text AS detail FROM cl s WHERE s.ticked AND s.id IN (SELECT src_id FROM src)
    UNION ALL
    SELECT d.client_id, 2, count(*)::text
      FROM public.einvoice_docs d
     WHERE d.client_id IN (SELECT src_id FROM src)
     GROUP BY d.client_id
    UNION ALL
    (SELECT DISTINCT ON (g.client_id) g.client_id, 3, g.period_month
       FROM public.gstr1_data g
      WHERE g.client_id IN (SELECT src_id FROM src)
        AND g.raw_json IS NOT NULL
        AND (jsonb_path_exists(g.raw_json, '$.**.irn ? (@ like_regex "^[0-9a-fA-F]{64}$")')
             OR jsonb_path_exists(g.raw_json, '$.**.srctyp ? (@ like_regex "^e-?invoice$" flag "i")'))
      ORDER BY g.client_id, g.imported_at DESC NULLS LAST)
    UNION ALL
    (SELECT DISTINCT ON (f.client_id) f.client_id, 4, f.period_month
       FROM public.gst_filed_returns f
      WHERE f.client_id IN (SELECT src_id FROM src)
        AND f.full_json IS NOT NULL
        AND (jsonb_path_exists(f.full_json, '$.**.irn ? (@ like_regex "^[0-9a-fA-F]{64}$")')
             OR jsonb_path_exists(f.full_json, '$.**.srctyp ? (@ like_regex "^e-?invoice$" flag "i")'))
      ORDER BY f.client_id, f.full_json_pulled_at DESC NULLS LAST)
  ),
  best AS (
    SELECT DISTINCT ON (p.target_id) p.target_id, p.own, p.src_name, e.rnk, e.detail
      FROM pair p
      JOIN ev e ON e.src_id = p.src_id
     ORDER BY p.target_id, p.own DESC, e.rnk
  )
  SELECT t.id,
         (b.target_id IS NOT NULL),
         CASE
           WHEN b.target_id IS NULL THEN 'No sign of e-invoices for this client or any registration on its PAN'
           WHEN b.rnk = 1 AND b.own THEN 'Ticked "E-invoice applicable"'
           WHEN b.rnk = 1 THEN 'Ticked "E-invoice applicable" on ' || b.src_name || ' (same PAN)'
           WHEN b.rnk = 2 AND b.own THEN b.detail || ' e-invoice record(s) for this client'
           WHEN b.rnk = 2 THEN b.detail || ' e-invoice record(s) for ' || b.src_name || ' (same PAN)'
           WHEN b.rnk = 3 AND b.own THEN 'IRNs in this client''s GSTR-1 JSON for ' || b.detail
           WHEN b.rnk = 3 THEN 'IRNs in ' || b.src_name || '''s GSTR-1 JSON for ' || b.detail || ' (same PAN)'
           WHEN b.own THEN 'IRNs in this client''s filed GSTR-1 for ' || b.detail
           ELSE 'IRNs in ' || b.src_name || '''s filed GSTR-1 for ' || b.detail || ' (same PAN)'
         END
    FROM target t
    LEFT JOIN best b ON b.target_id = t.id;
$$;

CREATE OR REPLACE FUNCTION public.client_einvoice_evidence(p_client_id uuid)
RETURNS TABLE (issues_einvoices boolean, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.issues_einvoices, r.reason
    FROM public.einvoice_evidence_rows(p_client_id) r
   WHERE p_client_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.client_einvoice_evidence_all()
RETURNS TABLE (client_id uuid, issues_einvoices boolean, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.client_id, r.issues_einvoices, r.reason FROM public.einvoice_evidence_rows(NULL) r;
$$;

GRANT EXECUTE ON FUNCTION public.einvoice_evidence_rows(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_einvoice_evidence(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_einvoice_evidence_all() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.client_einvoice_evidence(uuid) IS
  'Does this client issue e-invoices, by evidence (tick, e-invoice records, IRNs in a stored GSTR-1 JSON), on itself or any registration on its PAN? One row; reason in plain words.';
COMMENT ON FUNCTION public.client_einvoice_evidence_all() IS
  'client_einvoice_evidence for every client (for the Clients page).';

-- ---------------------------------------------------------------------------
-- e. The e-invoice Excel import, in one transaction
-- ---------------------------------------------------------------------------
-- Deletes the client and period's einvoice_excel rows, inserts p_docs (one
-- JSON object per document, as src/lib/einvoice/einvoiceData.ts
-- excelDocPayload builds it) and records the import in einvoice_pulls. Any
-- error (a CHECK, the unique key, a bad value) rolls all three back, so a
-- failed import leaves the earlier one exactly as it was. Returns the number
-- of documents inserted. The pull's rows (portal_gstr1) are never touched.
CREATE OR REPLACE FUNCTION public.einvoice_excel_replace(
  p_client_id    uuid,
  p_period_month text,
  p_docs         jsonb,
  p_message      text,
  p_actor        uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_n   integer;
BEGIN
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'einvoice_excel_replace: no client' USING ERRCODE = '22023';
  END IF;
  IF p_period_month IS NULL OR p_period_month !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' THEN
    RAISE EXCEPTION 'einvoice_excel_replace: period must be MM/YYYY, got %', p_period_month USING ERRCODE = '22023';
  END IF;
  IF p_docs IS NULL OR jsonb_typeof(p_docs) <> 'array' THEN
    RAISE EXCEPTION 'einvoice_excel_replace: p_docs must be a JSON array' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.einvoice_docs
   WHERE client_id = p_client_id
     AND period_month = p_period_month
     AND source = 'einvoice_excel';

  INSERT INTO public.einvoice_docs (
    client_id, period_month, source, section, doc_type, doc_no, doc_key, ctin, doc_date,
    irn, irn_date, inv_typ, pos, doc_value, taxable, igst, cgst, sgst, cess,
    irn_status, autopop_status, autopop_date, error, raw, first_seen_at, last_seen_at, gone_at
  )
  SELECT p_client_id, p_period_month, 'einvoice_excel', d.section, d.doc_type, d.doc_no, d.doc_key,
         COALESCE(d.ctin, ''), d.doc_date, d.irn, d.irn_date, d.inv_typ, d.pos,
         COALESCE(d.doc_value, 0), COALESCE(d.taxable, 0), COALESCE(d.igst, 0), COALESCE(d.cgst, 0),
         COALESCE(d.sgst, 0), COALESCE(d.cess, 0),
         d.irn_status, d.autopop_status, d.autopop_date, d.error, d.raw, v_now, v_now, NULL
    FROM jsonb_to_recordset(p_docs) AS d(
      section text, doc_type text, doc_no text, doc_key text, ctin text, doc_date text,
      irn text, irn_date text, inv_typ text, pos text,
      doc_value numeric, taxable numeric, igst numeric, cgst numeric, sgst numeric, cess numeric,
      irn_status text, autopop_status text, autopop_date text, error text, raw jsonb
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.einvoice_pulls (client_id, period_month, source, status, docs_found, message, pulled_by, pulled_at)
  VALUES (p_client_id, p_period_month, 'einvoice_excel', 'ok', v_n, p_message, p_actor, v_now)
  ON CONFLICT (client_id, period_month, source) DO UPDATE
     SET status = EXCLUDED.status,
         docs_found = EXCLUDED.docs_found,
         message = EXCLUDED.message,
         pulled_by = EXCLUDED.pulled_by,
         pulled_at = EXCLUDED.pulled_at,
         generated_on = NULL;

  RETURN v_n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.einvoice_excel_replace(uuid, text, jsonb, text, uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.einvoice_excel_replace(uuid, text, jsonb, text, uuid) IS
  'E-invoice Excel import: replaces the client and period''s einvoice_excel records with p_docs and records the import in einvoice_pulls, in one transaction. Returns the documents inserted.';
