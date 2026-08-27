-- Backing store for the "Additional Notice Folder" page (Notice Alert
-- parity: clicking a Reference No. on a case-linked row opens the full case
-- folder — Intimations/Notices/Replies/Orders/Closure, each with its own
-- attachments). Populated by the extension's existing Additional Notices
-- capture (content.js's handleNotices task-list loop), which already proved
-- out the case/folder + case/folder/items + PDF-download flow for the
-- ORDRS folder only — this generalizes that to every folder returned.
--
-- The exact field names the GST portal uses inside each folder type's
-- itemJson (issue date, due date, section number, etc.) are only proven for
-- ORDRS (docupdtl/crn) — everything else is unverified without live-testing
-- against a real client's case, so raw_json is the source of truth and the
-- typed columns below are best-effort, filled in only where we're confident.
create table if not exists public.gst_case_folder_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  case_id text not null, -- matches gst_notices.case_id for the parent row
  folder_section text, -- portal's own caseFolderTypeCd (e.g. 'ORDRS'); shown as-is if not one of the 5 known sections
  reference_number text,
  attachments jsonb not null default '[]'::jsonb, -- [{label, url}], PDFs already uploaded to storage
  raw_json jsonb, -- the parsed itemJson, verbatim — every field the portal actually returned
  pulled_at timestamptz not null default now()
);

create index if not exists gst_case_folder_items_case_idx
  on public.gst_case_folder_items (client_id, case_id);

alter table public.gst_case_folder_items enable row level security;

-- Same open-RLS convention as every other table in this app (see CLAUDE.md).
create policy "gst_case_folder_items_all_public" on public.gst_case_folder_items
  for all to public using (true) with check (true);
