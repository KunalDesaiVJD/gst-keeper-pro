-- GSTR-3B direct filing needs the superadmin's approval (21 Nov 2026).
--
-- Reported by the firm: UNITED DEVELOPERS-NO ITC's GSTR-3B for 10/2026 was
-- filed directly on the portal, with Suspended Reco never pulled, and a
-- Filing Status pull (20 Nov) then marked it Filed. Nothing stopped it: the
-- direct-filing rule (20261009100000) covered GSTR-1 / GSTR-1 (IFF) only, and
-- gstr3b_push_gate (20261021120000) runs only on a push from GST Keeper. Eight
-- other October GSTR-3Bs were filed the same way while the gate refused them.
--
-- From the 10/2026 period a GSTR-3B / GSTR-3B (Q) becomes Filed (by a pull,
-- the dropdown or a manual attach) only when
--   * it was pushed through GST Keeper: pushed_at on either row of the
--     return (GSTR-3B, GSTR-3B (Q)). For a GSTR-3B that marker is written
--     only by a push whose gate passed (gstr3b_push_versions_record_push and
--     mark_filing_pushed, 20261021120000), so a push the reco check refused
--     does not count; or
--   * the superadmin approved a direct-filing request for it
--     (gstr1_direct_filing_approvals, the same table and dialog as GSTR-1).
-- A NIL tick does not excuse a GSTR-3B (it does a GSTR-1): the push gate asks
-- for the reco pulls on a Nil month too.
--
-- Rows already Filed are untouched (the guard looks only at a move into
-- Filed), so the nine October returns stay Filed.
--
-- Undo: re-create gstr1_direct_filing_rule_applies and
-- filing_status_guard_direct_filing from 20261009200000.

CREATE OR REPLACE FUNCTION public.gstr1_direct_filing_rule_applies(p_return_type text, p_period text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_period ~ '^[0-9]{2}/[0-9]{4}$'
     AND CASE
           WHEN p_return_type IN ('GSTR-1', 'GSTR-1 (IFF)')
             THEN (split_part(p_period, '/', 2)::int * 100 + split_part(p_period, '/', 1)::int) >= 202609
           WHEN p_return_type IN ('GSTR-3B', 'GSTR-3B (Q)')
             THEN (split_part(p_period, '/', 2)::int * 100 + split_part(p_period, '/', 1)::int) >= 202610
           ELSE false
         END;
$$;

COMMENT ON FUNCTION public.gstr1_direct_filing_rule_applies(text, text) IS
  'Direct-filing rule: GSTR-1 / GSTR-1 (IFF) from 09/2026, GSTR-3B / GSTR-3B (Q) from 10/2026 (20261121120000). Mirrored by directFilingRuleApplies in src/lib/directFilingApprovals.ts.';

CREATE OR REPLACE FUNCTION public.filing_status_guard_direct_filing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pushed timestamptz;
  v_nil    boolean;
  v_family text[];
  v_is3b   boolean;
BEGIN
  IF NEW.status::text <> 'Filed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'Filed' THEN RETURN NEW; END IF;
  IF NOT public.gstr1_direct_filing_rule_applies(NEW.return_type::text, NEW.period_month) THEN
    RETURN NEW;
  END IF;

  v_is3b := NEW.return_type::text IN ('GSTR-3B', 'GSTR-3B (Q)');
  v_family := CASE WHEN v_is3b THEN ARRAY['GSTR-3B', 'GSTR-3B (Q)']
                   ELSE ARRAY['GSTR-1', 'GSTR-1 (IFF)'] END;

  -- An upsert (INSERT ... ON CONFLICT DO UPDATE, as the extension's pull
  -- does) reaches BEFORE INSERT with only the incoming columns, so read the
  -- stored rows' marker, and the stored NIL flag of NEW's own type, as well.
  v_pushed := NEW.pushed_at;
  v_nil := COALESCE(NEW.is_nil, false) AND NOT v_is3b;
  IF v_pushed IS NULL OR NOT v_nil THEN
    SELECT COALESCE(v_pushed, max(fs.pushed_at)),
           v_nil OR (NOT v_is3b AND COALESCE(bool_or(fs.is_nil) FILTER (WHERE fs.return_type = NEW.return_type), false))
      INTO v_pushed, v_nil
      FROM public.filing_status fs
     WHERE fs.client_id = NEW.client_id
       AND fs.return_type::text = ANY (v_family)
       AND fs.period_month = NEW.period_month;
  END IF;
  IF v_pushed IS NOT NULL OR COALESCE(v_nil, false) THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM public.gstr1_direct_filing_approvals a
     WHERE a.client_id = NEW.client_id
       AND a.return_type = NEW.return_type::text
       AND a.period_month = NEW.period_month
       AND a.status = 'approved'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% for % was not pushed through GST Keeper%, so it cannot be marked Filed or pulled from the portal until a superadmin approves a direct-filing request (Filing Status → Request approval).',
    NEW.return_type::text, NEW.period_month,
    CASE WHEN v_is3b THEN ' with a passing reco check' ELSE '' END
    USING ERRCODE = 'check_violation';
END;
$$;
