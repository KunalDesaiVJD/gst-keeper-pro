-- Rule 43 working (ITC reco › Rule 42/43, src/lib/gstr9/rule43.ts): GSTR-9 7D is
-- Σ Te from the working when it is on; like 7C (r42.final7C), only the superadmin
-- types over it (src/lib/gstr9/sourceLock.ts). The live list of 20261123120000
-- (capital goods register: t5OCg) plus r42.final7D.
CREATE OR REPLACE FUNCTION public.annual_return_locked_fields(p_doc_key text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_doc_key
    WHEN 'portal' THEN ARRAY['manual', 'f']
    WHEN 'gstr9' THEN ARRAY['t6A1', 't6G', 't7.s17_5', 't9Payable', 't12', 'r42.final7C', 'r42.final7D']
    WHEN 'annexures' THEN ARRAY['a3ExcessItc']
    WHEN 'gstr9c' THEN ARRAY['t5A', 't5OCg', 't5Q', 't7', 't7F', 't9', 't9Q', 't12A', 't12B', 't12C']
    WHEN 'notice' THEN ARRAY['deemedSupplies', 'unreturnedGoods', 'pendingDemands', 'prevYear8C', 'ineligible4D', 'itcUsed4A5', 'reversed4B2']
    ELSE ARRAY[]::text[]
  END;
$$;
