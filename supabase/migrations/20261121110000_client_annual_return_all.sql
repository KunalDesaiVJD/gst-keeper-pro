-- Kunal, 21 Nov 2026: every existing client stays ticked for GSTR-9 / 9C for
-- now, as the Annual Return register showed every client before
-- 20261121100000. Untick per client in Edit Client → Services or in bulk on
-- the Clients page. New clients still start unticked (the column default).
UPDATE public.clients SET annual_return_assigned = true WHERE NOT annual_return_assigned;
