-- Client login timed out (18 Nov 2026): authenticate_client's WHERE let the
-- planner run crypt() on every client's password before matching the GSTIN /
-- User ID. With 91 of 130 passwords bcrypt (cost 10) that took 6.6 s, over the
-- anon role's 3 s statement_timeout, so every client login failed as if the
-- password were wrong. Now the client rows are found by GSTIN / User ID first
-- (a materialized CTE), and crypt() runs only on those. Same arguments, same
-- result columns, same answer.
CREATE OR REPLACE FUNCTION public.authenticate_client(identifier text, pass text)
RETURNS TABLE(client_id uuid, client_name text, client_email text, gstin text, is_first_login boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH m AS MATERIALIZED (
    SELECT c.id, c.name, c.email, c.gstin, c.is_first_login, c.client_password
      FROM public.clients c
     WHERE upper(c.gstin) = upper(identifier)
        OR upper(c.client_user_id) = upper(identifier)
  )
  SELECT m.id, m.name, COALESCE(m.email, ''), m.gstin, COALESCE(m.is_first_login, true)
    FROM m
   WHERE m.client_password = crypt(pass, m.client_password)
   LIMIT 1;
END;
$$;
