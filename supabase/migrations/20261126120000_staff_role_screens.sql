-- Screens in roles (26 Nov 2026).
--
-- User Control → Roles now chooses which parts of the software an employee
-- opens, as well as what they can do there: one `module_*` key per screen
-- (src/lib/permissionCatalog.ts SCREEN_KEYS), checked by the sidebar, every
-- route (MainLayout) and the GST Assistant panel. An employee holding no
-- screen key opens every screen, so nothing changes for anyone until a role
-- is given screens.
--
-- This gives every existing role every screen, so each role is written the
-- new way and keeps exactly the access it had. Only a role that names no
-- screen yet is filled, so running this again never undoes screens a GST
-- Manager has since taken off a role. Rows go through
-- staff_position_permissions, whose trigger logs each one and rebuilds the
-- holders' user_permissions (20261014120000). No new table or column; the
-- DB keeps no allow-list of keys.

INSERT INTO public.staff_position_permissions (position_id, permission_key)
SELECT sp.id, k.key
  FROM public.staff_positions sp
 CROSS JOIN (VALUES
   ('module_clients'), ('module_2b'), ('module_itc'), ('module_rcm'), ('module_update_sheet'),
   ('module_gstr1'), ('module_gstr3b'), ('module_filing_status'), ('module_annual_return'),
   ('module_advances'), ('module_builder'), ('module_notices'), ('module_reports'), ('module_assistant')
 ) AS k(key)
 WHERE NOT sp.is_legacy
   AND NOT EXISTS (SELECT 1 FROM public.staff_position_permissions x
                    WHERE x.position_id = sp.id AND x.permission_key LIKE 'module\_%')
ON CONFLICT (position_id, permission_key) DO NOTHING;

-- Check: every standard role names its screens.
-- SELECT sp.name, count(*) FILTER (WHERE spp.permission_key LIKE 'module\_%') AS screens
--   FROM public.staff_positions sp LEFT JOIN public.staff_position_permissions spp ON spp.position_id = sp.id
--  WHERE NOT sp.is_legacy GROUP BY sp.name ORDER BY sp.name;
