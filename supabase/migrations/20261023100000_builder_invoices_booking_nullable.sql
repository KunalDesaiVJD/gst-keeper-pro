-- A unit onboarded through the opening-balance grid is Booked without a
-- builder_bookings row. Posting its BU differential raised an invoice with
-- booking_id NULL and failed on this NOT NULL, so such an event could never
-- post and the TDR/FSI working (which reads posted events only) stayed shut.
-- The invoice is still tied to its unit (unit_id NOT NULL, cascades with it).
ALTER TABLE public.builder_invoices ALTER COLUMN booking_id DROP NOT NULL;
