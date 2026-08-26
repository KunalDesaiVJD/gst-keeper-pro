-- Per-client sync-attempt history for the Notices Dashboard's "Company List"
-- page (matches Notice Alert's own Company List: Last Download Date, Status,
-- Status Message, and a "Sync Log" button). Nothing in this app previously
-- persisted the outcome of an extension portal-pull attempt — only the pulled
-- data itself (gst_notices etc). This table is purely additive: written by
-- the extension's existing "Sync All" (Notices) flow only, read by the app.
create table if not exists public.client_sync_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action text not null, -- e.g. 'notices' (matches the existing section-pull `mode` values)
  status text not null check (status in ('success', 'failed')),
  message text,
  created_at timestamptz not null default now()
);

create index if not exists client_sync_log_client_id_created_at_idx
  on public.client_sync_log (client_id, created_at desc);

alter table public.client_sync_log enable row level security;

-- Same open-RLS convention as every other table in this app (see CLAUDE.md):
-- auth.uid() is always NULL at runtime, so any auth-gated policy fails
-- closed. Login/permission gating happens in the app, not RLS.
create policy "client_sync_log_all_public" on public.client_sync_log
  for all to public using (true) with check (true);
