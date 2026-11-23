// Loads the client's approved Builder ITC Reversal workings (builder_itc_reversal_workings,
// status APPROVED, the result frozen at approval) for the Annual Return (builderReversal.ts).

import { supabase } from '@/integrations/supabase/client';
import type { Tax } from './types';
import type { BuilderReversalWorking } from './builderReversal';

type Row = Record<string, unknown>;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const tx = (v: unknown): Tax => { const o = (v ?? {}) as Record<string, unknown>; return { i: n(o.i), c: n(o.c), s: n(o.s ?? o.c), x: n(o.x) }; };
const sum = (xs: Tax[]): Tax => xs.reduce((a, b) => ({ i: a.i + b.i, c: a.c + b.c, s: a.s + b.s, x: a.x + b.x }), { i: 0, c: 0, s: 0, x: 0 });

export async function loadApprovedBuilderReversals(clientId: string): Promise<BuilderReversalWorking[]> {
  const { data, error } = await supabase
    .from('builder_itc_reversal_workings' as never)
    .select('id, project_id, completion_date, posting_period, approved_at, result, builder_projects(name)')
    .eq('client_id', clientId)
    .eq('status', 'APPROVED');
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => {
    const res = (r.result ?? {}) as { years?: Array<Record<string, unknown>>; totalInterest?: unknown };
    const years = res.years ?? [];
    const proj = r.builder_projects as { name?: string } | null;
    return {
      id: String(r.id),
      project: proj?.name ?? 'Project',
      completionDate: String(r.completion_date ?? ''),
      postingPeriod: String(r.posting_period ?? ''),
      approvedAt: r.approved_at ? String(r.approved_at) : null,
      r42: sum(years.map((y) => tx(y.netR42))),
      r43: sum(years.map((y) => tx(y.netR43))),
      interest: tx(res.totalInterest),
    };
  });
}
