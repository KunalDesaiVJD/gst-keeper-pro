-- Rule 42 working of the Annual Return (src/lib/gstr9/rule42.ts): GSTR-9 7C
-- comes from the working while it is on, and the override of that figure
-- (gstr9.r42.final7C) is the superadmin's, like 7E and Table 12. Keep this
-- list in step with LOCKED_FIELDS in src/lib/gstr9/sourceLock.ts.
CREATE OR REPLACE FUNCTION public.annual_return_locked_fields(p_doc_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_doc_key
    WHEN 'portal' THEN ARRAY['manual', 'f']
    WHEN 'gstr9' THEN ARRAY['t6A1', 't6G', 't7.s17_5', 't9Payable', 't12', 'r42.final7C']
    WHEN 'annexures' THEN ARRAY['a3ExcessItc']
    WHEN 'gstr9c' THEN ARRAY['t5A', 't5Q', 't7', 't7F', 't9', 't9Q', 't12A', 't12B', 't12C']
    WHEN 'notice' THEN ARRAY['deemedSupplies', 'unreturnedGoods', 'pendingDemands', 'prevYear8C', 'ineligible4D', 'itcUsed4A5', 'reversed4B2']
    ELSE ARRAY[]::text[]
  END;
$$;
