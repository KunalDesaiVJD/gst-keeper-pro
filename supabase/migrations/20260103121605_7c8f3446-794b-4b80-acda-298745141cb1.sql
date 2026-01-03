-- Temporarily allow authenticated or anon users to view clients for development
-- This will be replaced with proper auth later

-- Drop restrictive policy
DROP POLICY IF EXISTS "Staff can view all clients" ON public.clients;

-- Create a more permissive policy for development (allows anonymous access)
CREATE POLICY "Anyone can view clients for development"
ON public.clients
FOR SELECT
USING (true);

-- Same for bills_not_in_2b
DROP POLICY IF EXISTS "Staff can view all 2B data" ON public.bills_not_in_2b;
CREATE POLICY "Anyone can view 2B data for development"
ON public.bills_not_in_2b
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Staff can manage 2B data" ON public.bills_not_in_2b;
CREATE POLICY "Anyone can manage 2B data for development"
ON public.bills_not_in_2b
FOR ALL
USING (true)
WITH CHECK (true);

-- Same for bills_not_in_books
DROP POLICY IF EXISTS "Staff can view all books data" ON public.bills_not_in_books;
CREATE POLICY "Anyone can view books data for development"
ON public.bills_not_in_books
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Staff can manage books data" ON public.bills_not_in_books;
CREATE POLICY "Anyone can manage books data for development"
ON public.bills_not_in_books
FOR ALL
USING (true)
WITH CHECK (true);

-- Same for filing_status
DROP POLICY IF EXISTS "Staff can view all filing status" ON public.filing_status;
CREATE POLICY "Anyone can view filing status for development"
ON public.filing_status
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Staff can manage filing status" ON public.filing_status;
CREATE POLICY "Anyone can manage filing status for development"
ON public.filing_status
FOR ALL
USING (true)
WITH CHECK (true);

-- Same for itc_summaries
DROP POLICY IF EXISTS "Staff can view ITC" ON public.itc_summaries;
CREATE POLICY "Anyone can view ITC for development"
ON public.itc_summaries
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Staff can manage ITC" ON public.itc_summaries;
CREATE POLICY "Anyone can manage ITC for development"
ON public.itc_summaries
FOR ALL
USING (true)
WITH CHECK (true);