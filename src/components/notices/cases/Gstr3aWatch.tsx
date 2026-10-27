// GSTR-3A to ASMT-13 watch on Notices Home (section C of the law audit of
// 26 Oct 2026, src/lib/noticeGstr3aWatch.ts): return defaulter notices whose
// return is still not filed, before the officer assesses it in ASMT-13.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Panel } from '@/components/notices/ui/Panel';
import { addDays, istToday } from '@/lib/noticeFacts';
import { fmtDate } from '@/lib/noticeFormat';
import { gstr3aPeriod, gstr3aWatch, type FilingRow, type Gstr3aNotice, type WatchRow } from '@/lib/noticeGstr3aWatch';

async function loadWatch(): Promise<{ rows: WatchRow[]; names: Map<string, string> }> {
  const today = istToday();
  const n = await supabase.from('gst_notices').select('id, client_id, issue_date, reference_number')
    .eq('form_code', 'GSTR-3A').is('deleted_at', null).is('excluded_at', null).gte('issue_date', addDays(today, -150)).limit(1000);
  if (n.error) throw n.error;
  const notices = (n.data ?? []).filter((x): x is Gstr3aNotice => !!x.issue_date && !!x.client_id);
  if (!notices.length) return { rows: [], names: new Map() };
  const clients = [...new Set(notices.map((x) => x.client_id))];
  const periods = [...new Set(notices.map((x) => gstr3aPeriod(x.issue_date)))];
  const [f, a, c] = await Promise.all([
    supabase.from('filing_status').select('client_id, period_month, return_type, status').in('client_id', clients).in('period_month', periods),
    supabase.from('gst_notices').select('id, client_id, issue_date').eq('form_code', 'ASMT-13').is('deleted_at', null).in('client_id', clients),
    supabase.from('clients').select('id, name').in('id', clients),
  ]);
  for (const r of [f, a, c]) if (r.error) throw r.error;
  return {
    rows: gstr3aWatch(notices, (f.data ?? []) as FilingRow[], a.data ?? [], today),
    names: new Map((c.data ?? []).map((x) => [x.id, x.name])),
  };
}

const LINE: Record<WatchRow['state'], (r: WatchRow) => string> = {
  asmt13_issued: (r) => `ASMT-13 of ${fmtDate(r.asmt13?.issue_date)}: file by ${fmtDate(r.date)} and it is withdrawn (s.62(2))`,
  asmt13_can_issue: (r) => `15 days ran to ${fmtDate(r.date)}: ASMT-13 can issue any day (s.62(1))`,
  within_15: (r) => `File by ${fmtDate(r.date)}, before an ASMT-13 can issue`,
};

export const Gstr3aWatch: React.FC = () => {
  const q = useQuery({ queryKey: ['notice-gstr3a-watch'], queryFn: loadWatch, staleTime: 10 * 60_000 });
  const rows = q.data?.rows ?? [];
  if (!rows.length) return null;
  return (
    <Panel title={`Return defaulter notices, return not filed · ${rows.length}`}
      info="GSTR-3A notices of the last five months whose return Filing Status still shows not filed. The portal's GSTR-3A names no return, so the period is read as the month before the notice. Fifteen days after a GSTR-3A the officer may assess the tax in ASMT-13; an ASMT-13 is withdrawn if the return is filed within 60 days of it. GSTR-3A notices stay hidden everywhere else.">
      <ul className="divide-y">
        {rows.slice(0, 12).map((r) => (
          <li key={r.notice.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
            <Link to="/filing-status" className="min-w-0 flex-1 font-medium hover:underline">
              {q.data?.names.get(r.notice.client_id) ?? 'Client'} · {r.period} · {r.pending.join(', ')}
            </Link>
            <span className={r.state === 'within_15' ? 'text-xs text-warning' : 'text-xs text-destructive'}>{LINE[r.state](r)}</span>
          </li>
        ))}
      </ul>
      {rows.length > 12 && <p className="pt-1 text-[11px] text-muted-foreground">and {rows.length - 12} more</p>}
    </Panel>
  );
};
