// Demands with no work recorded (P3 of the law audit, 26 Oct 2026;
// notice_stale_demands, 20261027100000): an open demand still at New after
// its date has passed, of at least the amount set in Law rules
// (escalate_demand_rs). Shown to GST Managers and the superadmin on Home every
// day; nothing is e-mailed.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Panel } from '@/components/notices/ui/Panel';
import { noticeCaseHref } from '@/lib/noticeCases';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';

interface Stale {
  id: string; client_name: string | null; form_code: string | null; reference_number: string | null; financial_year: string | null;
  amount_of_demand: number | null; effective_due: string | null; days_overdue: number | null; due_basis_note: string | null;
}

export const StaleDemands: React.FC = () => {
  const q = useQuery({
    queryKey: ['notice-stale-demands'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Stale[]> => {
      const { data, error } = await supabase.rpc('notice_stale_demands');
      // Before 20261027100000: nothing to show.
      if (error) return [];
      return (data ?? []) as Stale[];
    },
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <Panel title={`Demands with no work recorded · ${rows.length}`}
      info="Open demands still at New after their date has passed, of at least the amount set in Notices · Settings → Law rules (escalate_demand_rs). Either the work is happening outside the system, or it has been missed: move each to its stage, or reply.">
      <ul className="divide-y">
        {rows.slice(0, 10).map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            <Link to={noticeCaseHref({ id: r.id })} className="min-w-0 flex-1 font-medium hover:underline">
              {r.client_name ?? 'Client'} · {r.form_code ?? 'Notice'}{r.financial_year ? ` · FY ${r.financial_year}` : ''}
              {r.reference_number && <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{r.reference_number}</span>}
            </Link>
            <span className="font-semibold">{r.amount_of_demand ? fmtInr(r.amount_of_demand) : ''}</span>
            <span className="text-xs text-destructive">due {r.effective_due ? fmtDate(r.effective_due) : '?'}, {r.days_overdue} days ago</span>
            {r.due_basis_note && <span className="basis-full text-[11px] text-muted-foreground">{r.due_basis_note}</span>}
          </li>
        ))}
      </ul>
      {rows.length > 10 && <p className="pt-1 text-[11px] text-muted-foreground">and {rows.length - 10} more</p>}
    </Panel>
  );
};
