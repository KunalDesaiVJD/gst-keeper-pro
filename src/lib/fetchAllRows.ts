// Supabase's PostgREST caps every response at 1000 rows regardless of the
// range requested (confirmed live 2026-08-29: `Range: 0-2000` on gst_notices
// still comes back `Content-Range: 0-999/*`) — a project-level API setting,
// not something a single query can override. gst_notices already has 1055
// rows, past that cap, so two pages querying it with different .order()
// clauses can silently get two DIFFERENT arbitrary 1000-row slices and
// disagree on the same category's count. Paginate with .range() in a loop
// until a page comes back short, so every caller sees the full table.
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  table: keyof Database['public']['Tables'],
  select: string,
  // The callback receives the .select() builder (filters, order, …). Typed loosely:
  // the builder's generic type for a runtime select string is not expressible here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (query: any) => any = (q) => q,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = build(supabase.from(table).select(select));
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchAllRows(${table}) page ${from}: ${error.message}`);
    if (!data) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
