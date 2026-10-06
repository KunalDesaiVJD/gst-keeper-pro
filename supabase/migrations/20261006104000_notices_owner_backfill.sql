-- Notices Phase 0 · one owner field (docs/NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf: L-18 / R-12).
--
-- The edit dialog used to write only the free-text assign_to, while the work queue's
-- Mine / Unassigned tabs, the owner initials and the "assigned to you" alert read
-- assign_to_user_id — so an owner set in the dialog never reached the queue. The dialog
-- now writes both (a staff picker). This back-fills the id for owners typed earlier:
-- only where the id is empty and the typed name equals exactly ONE staff member's first
-- name (case and spaces ignored). Ambiguous or unknown names are left for staff to pick.
WITH staff AS (
  SELECT p.user_id, lower(btrim(p.first_name)) AS fname
    FROM public.profiles p
    JOIN public.user_roles r ON r.user_id = p.user_id AND r.role::text <> 'client'
   WHERE coalesce(btrim(p.first_name), '') <> ''
),
unique_names AS (
  SELECT fname, (array_agg(user_id))[1] AS user_id
    FROM staff
   GROUP BY fname
  HAVING count(*) = 1
)
UPDATE public.gst_notices n
   SET assign_to_user_id = u.user_id
  FROM unique_names u
 WHERE n.assign_to_user_id IS NULL
   AND n.assign_to IS NOT NULL
   AND lower(btrim(n.assign_to)) = u.fname;
