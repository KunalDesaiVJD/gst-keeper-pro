-- Capital goods register: one client-level list of capital goods (plant and
-- machinery) on which ITC was taken, shared by
--   * s.18(6) / Rule 40(2) / Rule 44(6) — capital goods sold (the Annual
--     Return's Purchases step, tab "Capital goods sold"; src/lib/gstr9/capitalGoods.ts),
--   * Rule 43 — common credit on capital goods (the Rule 42/43 working reads
--     the purchase columns and the use-class history).
-- docs/GSTR9_9C_WORKINGS.md §9.
--
-- RLS is open to public, as everywhere in this app (CLAUDE.md: the app has no
-- Supabase auth session). Every change is in gst_change_log. A trigger refuses
-- an edit in a locked Annual Return year, judged by the year of the date the
-- edit touches: the disposal columns by the year of the disposal date, the
-- purchase columns by the year of the purchase invoice. A new asset is judged
-- only by its disposal year, so an asset bought in a locked year can still be
-- entered for its sale.

CREATE TABLE IF NOT EXISTS public.capital_goods_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Purchase (Rule 43 reads these)
  description text NOT NULL DEFAULT '',
  hsn text NOT NULL DEFAULT '',
  invoice_no text NOT NULL DEFAULT '',
  invoice_date date,
  supplier_gstin text NOT NULL DEFAULT '',
  put_to_use_date date,
  use_class text NOT NULL DEFAULT 'taxable'
    CHECK (use_class IN ('taxable', 'exempt_or_non_business', 'common')),
  itc_igst numeric NOT NULL DEFAULT 0,
  itc_cgst numeric NOT NULL DEFAULT 0,
  itc_sgst numeric NOT NULL DEFAULT 0,
  itc_cess numeric NOT NULL DEFAULT 0,
  itc_route text NOT NULL DEFAULT 'normal' CHECK (itc_route IN ('normal', 'tran1', 'not_taken')),
  -- Rule 43 reversals made to date (typed until the Rule 43 working fills them)
  r43_reversed_igst numeric NOT NULL DEFAULT 0,
  r43_reversed_cgst numeric NOT NULL DEFAULT 0,
  r43_reversed_sgst numeric NOT NULL DEFAULT 0,
  r43_reversed_cess numeric NOT NULL DEFAULT 0,
  -- Disposal (s.18(6))
  disposal_type text CHECK (disposal_type IN ('sale', 'transfer', 'scrap', 'written_off')),
  disposal_date date,
  disposal_invoice_no text NOT NULL DEFAULT '',
  buyer_type text NOT NULL DEFAULT 'b2b' CHECK (buyer_type IN ('b2b', 'b2c')),
  supply_type text NOT NULL DEFAULT 'intra' CHECK (supply_type IN ('intra', 'inter')),
  rate numeric,
  disposal_value numeric NOT NULL DEFAULT 0,
  -- Output tax charged; all NULL = computed from the rate
  out_igst numeric,
  out_cgst numeric,
  out_sgst numeric,
  out_cess numeric,
  scrap_proviso boolean NOT NULL DEFAULT false,
  related_party boolean NOT NULL DEFAULT false,
  in_sales_ledger boolean NOT NULL DEFAULT false,
  shortfall_route text NOT NULL DEFAULT 'not_done'
    CHECK (shortfall_route IN ('reversed_4b2', 'drc03', 'output_tax', 'not_done')),
  posted_in_books boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS capital_goods_register_client_idx
  ON public.capital_goods_register (client_id, disposal_date);

-- Rule 43: the asset's use class from a date (taxable only / exempt or non-business only / common).
CREATE TABLE IF NOT EXISTS public.capital_goods_use_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES public.capital_goods_register(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  use_class text NOT NULL CHECK (use_class IN ('taxable', 'exempt_or_non_business', 'common')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (asset_id, from_date)
);

ALTER TABLE public.capital_goods_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capital_goods_use_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capital_goods_register_all ON public.capital_goods_register;
CREATE POLICY capital_goods_register_all ON public.capital_goods_register FOR ALL TO public USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS capital_goods_use_history_all ON public.capital_goods_use_history;
CREATE POLICY capital_goods_use_history_all ON public.capital_goods_use_history FOR ALL TO public USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_goods_register TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capital_goods_use_history TO anon, authenticated;

-- "2025-09-10" → "2025-26" (NULL for NULL).
CREATE OR REPLACE FUNCTION public.capital_goods_fy(p date)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE
    (extract(year FROM p)::int - (extract(month FROM p)::int < 4)::int)::text || '-' ||
    lpad(((extract(year FROM p)::int - (extract(month FROM p)::int < 4)::int + 1) % 100)::text, 2, '0') END
$$;

CREATE OR REPLACE FUNCTION public.capital_goods_year_locked(p_client uuid, p_fy text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_fy IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.annual_return_periods p
    WHERE p.client_id = p_client AND p.financial_year = p_fy AND p.status = 'locked')
$$;

CREATE OR REPLACE FUNCTION public.capital_goods_register_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid := COALESCE(NEW.client_id, OLD.client_id);
  v_years text[] := '{}';
  v_purchase boolean := false;
  v_disposal boolean := false;
  y text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_years := ARRAY[public.capital_goods_fy(NEW.disposal_date)];
  ELSIF TG_OP = 'DELETE' THEN
    v_years := ARRAY[public.capital_goods_fy(OLD.disposal_date), public.capital_goods_fy(OLD.invoice_date)];
  ELSE
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'CAPITAL_GOODS_CLIENT: an asset cannot move to another client.' USING ERRCODE = 'P0001';
    END IF;
    v_purchase := (OLD.description, OLD.hsn, OLD.invoice_no, OLD.invoice_date, OLD.supplier_gstin, OLD.put_to_use_date,
                   OLD.use_class, OLD.itc_igst, OLD.itc_cgst, OLD.itc_sgst, OLD.itc_cess, OLD.itc_route)
      IS DISTINCT FROM (NEW.description, NEW.hsn, NEW.invoice_no, NEW.invoice_date, NEW.supplier_gstin, NEW.put_to_use_date,
                   NEW.use_class, NEW.itc_igst, NEW.itc_cgst, NEW.itc_sgst, NEW.itc_cess, NEW.itc_route);
    v_disposal := (OLD.disposal_type, OLD.disposal_date, OLD.disposal_invoice_no, OLD.buyer_type, OLD.supply_type, OLD.rate,
                   OLD.disposal_value, OLD.out_igst, OLD.out_cgst, OLD.out_sgst, OLD.out_cess, OLD.scrap_proviso,
                   OLD.related_party, OLD.in_sales_ledger, OLD.shortfall_route, OLD.posted_in_books,
                   OLD.r43_reversed_igst, OLD.r43_reversed_cgst, OLD.r43_reversed_sgst, OLD.r43_reversed_cess)
      IS DISTINCT FROM (NEW.disposal_type, NEW.disposal_date, NEW.disposal_invoice_no, NEW.buyer_type, NEW.supply_type, NEW.rate,
                   NEW.disposal_value, NEW.out_igst, NEW.out_cgst, NEW.out_sgst, NEW.out_cess, NEW.scrap_proviso,
                   NEW.related_party, NEW.in_sales_ledger, NEW.shortfall_route, NEW.posted_in_books,
                   NEW.r43_reversed_igst, NEW.r43_reversed_cgst, NEW.r43_reversed_sgst, NEW.r43_reversed_cess);
    IF v_purchase THEN
      v_years := v_years || public.capital_goods_fy(OLD.invoice_date) || public.capital_goods_fy(NEW.invoice_date);
    END IF;
    -- A sale's figures (the purchase ones too) are part of the disposal year's working.
    IF v_disposal OR v_purchase THEN
      v_years := v_years || public.capital_goods_fy(OLD.disposal_date) || public.capital_goods_fy(NEW.disposal_date);
    END IF;
    NEW.updated_at := now();
  END IF;

  FOREACH y IN ARRAY v_years LOOP
    IF public.capital_goods_year_locked(v_client, y) THEN
      RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: FY % is locked for this client. Unlock it before editing this asset.', y
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS capital_goods_register_guard ON public.capital_goods_register;
CREATE TRIGGER capital_goods_register_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.capital_goods_register
  FOR EACH ROW EXECUTE FUNCTION public.capital_goods_register_guard();

CREATE OR REPLACE FUNCTION public.capital_goods_use_history_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.capital_goods_year_locked(COALESCE(NEW.client_id, OLD.client_id), public.capital_goods_fy(OLD.from_date))
     OR public.capital_goods_year_locked(COALESCE(NEW.client_id, OLD.client_id), public.capital_goods_fy(NEW.from_date)) THEN
    RAISE EXCEPTION 'ANNUAL_RETURN_LOCKED: the year of this change of use is locked for this client.' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS capital_goods_use_history_guard ON public.capital_goods_use_history;
CREATE TRIGGER capital_goods_use_history_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.capital_goods_use_history
  FOR EACH ROW EXECUTE FUNCTION public.capital_goods_use_history_guard();

-- The change log (docs/GST_CHANGE_LOG.md): each asset under the month of its sale, else of its purchase.
SELECT public.gst_change_log_attach('capital_goods_register',
  p_month => 'to_char(COALESCE(r.disposal_date, r.invoice_date), ''MM/YYYY'')',
  p_label => 'r.description',
  p_skip => '{updated_at,sort_order}');
SELECT public.gst_change_log_attach('capital_goods_use_history',
  p_month => 'to_char(r.from_date, ''MM/YYYY'')');

-- GSTR-9C 5O's capital goods part (t5OCg) is filled in from the register:
-- like the other filled-in figures, only the superadmin types over it
-- (src/lib/gstr9/sourceLock.ts; the live list, incl. the Rule 42 working's r42.final7C, plus t5OCg).
CREATE OR REPLACE FUNCTION public.annual_return_locked_fields(p_doc_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_doc_key
    WHEN 'portal' THEN ARRAY['manual', 'f']
    WHEN 'gstr9' THEN ARRAY['t6A1', 't6G', 't7.s17_5', 't9Payable', 't12', 'r42.final7C']
    WHEN 'annexures' THEN ARRAY['a3ExcessItc']
    WHEN 'gstr9c' THEN ARRAY['t5A', 't5OCg', 't5Q', 't7', 't7F', 't9', 't9Q', 't12A', 't12B', 't12C']
    WHEN 'notice' THEN ARRAY['deemedSupplies', 'unreturnedGoods', 'pendingDemands', 'prevYear8C', 'ineligible4D', 'itcUsed4A5', 'reversed4B2']
    ELSE ARRAY[]::text[]
  END;
$$;
