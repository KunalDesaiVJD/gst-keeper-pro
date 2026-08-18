-- Drops "Transitional Credit Claimed" (TRAN-1/TRAN-2) entirely, by product
-- decision — never populated (0 rows live), report and catalog entry
-- removed in the same change. See 20260817200000_taxpayer_challan_
-- transitional.sql for where this table originally came from.

DROP TABLE IF EXISTS public.gst_transitional_credit;
