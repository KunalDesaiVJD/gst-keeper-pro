-- Filed GSTR-3B / GSTR-1 / GSTR-2B pulled directly from the GST portal's own
-- JSON APIs (return.gst.gov.in/api/gstr3b/summary, api/gstr1/summary,
-- gstr2b.gst.gov.in/api/gstr2b/getdata), one row per client+period+return
-- type. This is the "as-filed on the portal" figures, distinct from the
-- app's own computed/manual GSTR-1/3B drafts and from the Import 2B
-- reconciliation ledger — a separate source of truth for litigation /
-- GSTR-9 reconciliation use, not a replacement for the working drafts.
create table if not exists public.gst_filed_returns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_month text not null,
  return_type text not null,
  arn text,
  filed_date date,
  status text,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (client_id, period_month, return_type)
);

alter table public.gst_filed_returns enable row level security;

-- No Supabase Auth session exists at runtime (auth.uid() is always null) —
-- gate access at the app layer, same as every other table in this project.
create policy "gst_filed_returns_all" on public.gst_filed_returns
  for all to public using (true) with check (true);
