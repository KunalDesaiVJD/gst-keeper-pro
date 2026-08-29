// Supabase's PostgREST caps every response at 1000 rows regardless of the
// range requested (confirmed live 2026-08-29: `Range: 0-2000` on gst_notices
// still comes back `Content-Range: 0-999/*`) — a project-level API setting,
// not something a single query can override. gst_notices already has 1055
// rows, past that cap, so two pages querying it with different .order()
// clauses can silently get two DIFFERENT arbitrary 1000-row slices and
// disagree on the same category's count. Paginate with .range() in a loop
// until a page comes back short, so every caller sees the full table.
import { supabase } from '@/integrations/supabase/client';

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  table: string,
  select: string,
  build: (query: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from> = (q) => q,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const query: any = build(supabase.from(table).select(select) as any);
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
