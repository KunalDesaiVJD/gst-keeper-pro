-- NIL Return flag for filing_status. When set, a return (GSTR-1 or GSTR-3B)
-- for that client/period had zero activity and Documents Issued (Table 13,
-- GSTR-1 only) is not required before push. Default false so every existing
-- row keeps requiring Table 13 exactly as before.
alter table public.filing_status
  add column if not exists is_nil boolean not null default false;
