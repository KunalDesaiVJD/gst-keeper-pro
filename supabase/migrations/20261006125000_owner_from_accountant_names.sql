-- Notices · reading the client master's accountant as a staff member
-- (replaces notice_owner_for_client from 20261006115000_notice_alerts_engine.sql).
--
-- clients.assigned_accountant is typed by hand. On the live project it reads
-- "MUKESH/21", "PUNITBHAI/27", "YATINBHAI", "DHAVAL BHAI",
-- "Krushangbhai / 6354580698", "PRIYA,MUKESHBHAI/ 28". The old matcher dropped
-- only a trailing "/<digits>", so the Gujarati honorific (bhai, ben) and
-- anything else after a slash (a phone number, "A/C-…") kept 140 open notices of
-- Punit's and Yatin's clients without an owner.
--
-- Now the name is what comes before the first slash; candidates are the name,
-- its first word, and both without a trailing "bhai" / "ben". A client becomes
-- a staff member's when exactly one staff first name equals one of the
-- candidates — as before, two matches mean no owner. A value naming two people
-- ("PRIYA,MUKESHBHAI") gets no owner. Used by the new-notice trigger and
-- notices_auto_assign_open(); nothing is re-assigned by this file.

CREATE OR REPLACE FUNCTION public.notice_owner_for_client(p_client_id uuid)
RETURNS TABLE (user_id uuid, name text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT lower(btrim(regexp_replace(split_part(coalesce(c.assigned_accountant, ''), '/', 1), '\s+', ' ', 'g'))) AS v
      FROM public.clients c WHERE c.id = p_client_id
  ), cand AS (
    SELECT DISTINCT t.x AS cname
      FROM raw
     CROSS JOIN LATERAL (VALUES (raw.v),
                                (split_part(raw.v, ' ', 1)),
                                (btrim(regexp_replace(raw.v, '\s*(bhai|ben)$', ''))),
                                (regexp_replace(split_part(raw.v, ' ', 1), '(bhai|ben)$', ''))) AS t(x)
     WHERE raw.v <> '' AND raw.v !~ '[,&+]' AND length(t.x) >= 2
  ), staff AS (
    SELECT p.user_id, btrim(p.first_name) AS first_name, lower(btrim(p.first_name)) AS fname
      FROM public.profiles p
      JOIN public.user_roles r ON r.user_id = p.user_id AND r.role::text <> 'client'
     WHERE coalesce(btrim(p.first_name), '') <> ''
     GROUP BY p.user_id, p.first_name
  ), hit AS (
    SELECT DISTINCT s.user_id, s.first_name
      FROM staff s JOIN cand ON cand.cname = s.fname
  )
  SELECT h.user_id, h.first_name FROM hit h WHERE (SELECT count(*) FROM hit) = 1
$$;
