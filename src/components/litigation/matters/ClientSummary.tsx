// One client's litigation at a glance (audit U-81-2): open matters, demand,
// what is paid and deposited, what is outstanding, the next hearing and the
// client's open notices — each tile opens the list it counts.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { noticesListHref } from '@/lib/noticeQueries';
import { fmtDate, fmtDateTime, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import { mattersHref, type MatterListRow } from '@/lib/litigationData';
import { MatterTile } from './MatterTiles';
import { clockWords } from './ClockCell';

export const ClientSummary: React.FC<{ clientId: string; rows: MatterListRow[] }> = ({ clientId, rows }) => {
  const notices = useQuery({
    queryKey: ['matter-client-notices', clientId],
    queryFn: async () => {
      const [all, loose] = await Promise.all([
        supabase.from('notice_facts').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_open', true),
        supabase.from('notice_facts').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('is_open', true).is('matter_id', null),
      ]);
      if (all.error) throw all.error;
      if (loose.error) throw loose.error;
      return { open: all.count ?? 0, loose: loose.count ?? 0 };
    },
  });
  const open = rows.filter((r) => r.open);
  const demand = open.reduce((s, r) => s + r.money.demand, 0);
  const paid = open.reduce((s, r) => s + r.money.paid, 0);
  const pre = open.reduce((s, r) => s + r.money.preDeposit, 0);
  const outstanding = open.reduce((s, r) => s + r.money.outstanding, 0);
  const hearing = open.flatMap((r) => r.clocks.filter((c) => c.kind === 'hearing' && c.days >= 0).map((c) => ({ c, r })))
    .sort((a, b) => a.c.date.localeCompare(b.c.date) || (a.c.at ?? '').localeCompare(b.c.at ?? ''))[0];
  const closed = rows.length - open.length;

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      <MatterTile label="Open matters" accent="primary" value={open.length.toLocaleString('en-IN')} to={mattersHref({ client: clientId, status: 'open' })}
        hint={closed ? `${plural(closed, 'closed matter')}` : 'none closed'} />
      <MatterTile label="Demand in open matters" accent="muted" value={fmtInrShort(demand)} title={fmtInr(demand)}
        hint={`paid ${fmtInrShort(paid)} · pre-deposit ${fmtInrShort(pre)}`} />
      <MatterTile label="Outstanding" accent={outstanding > 0 ? 'destructive' : 'success'} value={fmtInrShort(outstanding)} title={fmtInr(outstanding)}
        to={mattersHref({ client: clientId, status: 'open', sort: 'exposure' })} hint="demand − paid − pre-deposit" />
      <MatterTile label="Next hearing" accent="info"
        value={hearing ? clockWords(hearing.c.days) : 'none fixed'}
        hint={hearing ? `${hearing.c.at ? fmtDateTime(hearing.c.at) : fmtDate(hearing.c.date)} · ${hearing.r.matter_no}` : 'no upcoming hearing'}
        to={hearing ? `/litigation/${hearing.r.id}?tab=hearings` : undefined} />
      <MatterTile label="Open notices" accent="warning" to={noticesListHref({ filter: 'open', client: clientId })}
        value={notices.data ? notices.data.open.toLocaleString('en-IN') : '…'}
        hint={notices.data ? `${notices.data.loose} not in a matter` : notices.error ? 'could not load' : 'counting…'} />
    </div>
  );
};

export default ClientSummary;
