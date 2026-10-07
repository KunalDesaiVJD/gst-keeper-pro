// Litigation MIS · Overview (audit U-100-1, U-100-2, U-100-3, U-100-4): one
// screen that answers the partner's questions — what is at stake (demand split
// into tax, interest and penalty; pre-deposit, paid, outstanding; proposed vs
// confirmed; refunds apart), what falls due in the next 14 days, where the
// money sits by forum, which clients hold it, what needs attention and what
// moved in the last 30 days. Every figure opens the list it counts.
import React from 'react';
import { Link } from 'react-router-dom';
import { InfoTip, SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { fmtDay, fmtInr, fmtInrShort, plural } from '@/lib/noticeFormat';
import { isAppealClock30, sumMoney, type AgendaItem, type MisLinks, type MisReport } from './misData';
import { Amount, BarList, DaysChip, EmptyBox, MisTile } from './ui';

const Rupees: React.FC<{ v: number }> = ({ v }) => <span title={fmtInr(v)}>{fmtInrShort(v)}</span>;

const KIND: Record<AgendaItem['kind'], { label: string; variant: 'info' | 'warning' | 'destructive' | 'secondary' }> = {
  reply: { label: 'Reply due', variant: 'warning' },
  hearing: { label: 'Hearing', variant: 'info' },
  due: { label: 'Due', variant: 'warning' },
  limitation: { label: 'Limitation', variant: 'destructive' },
  appeal: { label: 'Appeal clock', variant: 'destructive' },
  attachment: { label: 'Attachment', variant: 'secondary' },
};

export const MisTiles: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const m = r.money;
  const nextHearing = r.hearings.next14[0];
  const nextClock = r.sets.clocks30.flatMap((x) => x.clocks.filter(isAppealClock30).map((c) => ({ c, x })))
    .sort((a, b) => a.c.date.localeCompare(b.c.date))[0];
  const split = [`tax ${fmtInrShort(m.tax)}`, `interest ${fmtInrShort(m.interest)}`, `penalty ${fmtInrShort(m.penalty)}`];
  if (m.cess > 0) split.push(`cess ${fmtInrShort(m.cess)}`);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <MisTile to={links.drill('demand')} label="Demand under dispute" accent="primary" value={<Rupees v={m.demand} />}
        hint={m.demand > 0 ? split.join(' · ') : 'none recorded'} />
      <MisTile to={links.drill('predeposit')} label="Pre-deposit" accent="info" value={<Rupees v={m.preDeposit} />}
        hint={r.sets.predeposit.length ? `on ${plural(r.sets.predeposit.length, 'matter')}` : 'none recorded'} />
      <MisTile to={links.drill('paid')} label="Paid against demand" accent="success" value={<Rupees v={m.paid} />}
        hint={r.sets.paid.length ? `on ${plural(r.sets.paid.length, 'matter')}` : 'none recorded'} />
      <MisTile to={links.drill('outstanding')} label="Outstanding" accent="destructive" value={<Rupees v={m.outstanding} />}
        hint={`proposed ${fmtInrShort(m.proposed)} · confirmed ${fmtInrShort(m.confirmed)}`} />
      <MisTile to={links.tab('hearings')} label="Hearings in the next 14 days" accent="warning" value={r.hearings.next14.length.toLocaleString('en-IN')}
        hint={nextHearing ? `next ${fmtDay(nextHearing.hearing.on)}${nextHearing.hearing.time ? ` ${nextHearing.hearing.time}` : ''} · ${nextHearing.matter.clientName}` : 'none fixed'} />
      <MisTile to={links.matters({ clock: 'appeal30' })} label="Appeal or limitation clock in 30 days" accent="destructive" strong={r.sets.clocks30.length > 0}
        value={r.sets.clocks30.length.toLocaleString('en-IN')}
        hint={nextClock ? `next ${fmtDay(nextClock.c.date)} · ${nextClock.x.clientName}` : 'no clock in 30 days'} />
    </div>
  );
};

/** The smaller second row of counts (U-100-4). */
export const MisCountsLine: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const clients = new Set(r.open.map((m) => m.clientId)).size;
  const link = 'font-medium text-primary underline underline-offset-2 hover:text-primary/80';
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <Link to={links.matters()} className={link}>{plural(r.open.length, 'open matter')}</Link>
      <Link to={links.tab('clients')} className={link}>{plural(clients, 'client')}</Link>
      {r.sets.refund.length > 0 && (
        <span>Refund at stake <Link to={links.matters({ lifecycle: 'refund' })} className={link}>
          <Rupees v={r.money.refund} /> on {plural(r.sets.refund.length, 'matter')}</Link> (kept out of demand)</span>
      )}
      <InfoTip label="How outstanding is worked out">Outstanding = demand − pre-deposit − paid, as recorded on each matter; interest is not accrued to date.</InfoTip>
    </p>
  );
};

// The badge says what kind of date it is; the line adds what the badge does not.
const detail = (a: AgendaItem) => (a.kind === 'hearing' ? [a.label, a.time && `${a.time} IST`].filter(Boolean).join(' · ')
  : /^(Due date|Reply|Reply due|Limitation)$/.test(a.label) ? '' : a.label);

const NextDays: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => (
  <SectionCard title="Next 14 days" info="Hearings, due dates, limitation and appeal clocks on open matters (IST)."
    actions={<Badge variant="secondary" className="text-[11px]">{plural(r.agenda.length, 'item')}</Badge>}>
    {r.sets.overdue.length > 0 && (
      <p className="rounded-md border border-destructive/40 px-2 py-1 text-xs">
        <Link to={links.matters({ clock: 'overdue' })} className="font-semibold text-destructive-strong underline underline-offset-2">
          {plural(r.sets.overdue.length, 'matter')}
        </Link>{' '}already past {r.sets.overdue.length === 1 ? 'its' : 'their'} next clock.
      </p>
    )}
    {r.agenda.length === 0 ? <EmptyBox className="p-4">Nothing falls due in the next 14 days.</EmptyBox> : (
      <ul className="max-h-[17rem] divide-y overflow-y-auto pr-1">
        {r.agenda.map((a) => (
          <li key={a.key} className="flex items-start gap-2 py-1.5 text-xs">
            <div className="w-[4.5rem] shrink-0">
              <div className="font-semibold">{fmtDay(a.date)}</div>
              <DaysChip days={a.days} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1">
                <Badge variant={KIND[a.kind].variant} className="text-[10px] font-medium">{KIND[a.kind].label}</Badge>
                {detail(a) && <span className="text-muted-foreground">{detail(a)}</span>}
              </div>
              <Link to={`/litigation/${a.matter.id}`} className="block truncate font-medium hover:underline">{a.matter.title}</Link>
              <span className="block truncate text-muted-foreground">{a.matter.clientName}</span>
            </div>
          </li>
        ))}
      </ul>
    )}
    <Link to={links.tab('hearings')} className="text-xs font-medium text-primary underline underline-offset-2">All upcoming hearings</Link>
  </SectionCard>
);

const ByForum: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => (
  <SectionCard title="Outstanding by forum" info="Where the money sits: ₹ outstanding and matters by forum. Forum is the matter's own, else read from its lifecycle and stage."
    actions={<Link to={links.tab('breakdown')} className="text-xs font-medium text-primary underline underline-offset-2">Breakdown</Link>}>
    <BarList rows={r.byForum.map((b) => ({ key: b.key, label: b.label, tone: b.tone, amount: b.money.outstanding, count: b.rows.length, to: links.drill(`forum:${b.key}`) }))} />
    <p className="text-[11px] text-muted-foreground">
      {r.sets.proposed.length > 0
        ? <Link to={links.drill('proposed')} className="text-primary underline underline-offset-2">Proposed <Rupees v={r.money.proposed} /></Link>
        : <>Proposed <Rupees v={0} /></>}
      {' '}still at the notice stage ·{' '}
      {r.sets.confirmed.length > 0
        ? <Link to={links.drill('confirmed')} className="text-primary underline underline-offset-2">confirmed <Rupees v={r.money.confirmed} /></Link>
        : <>confirmed <Rupees v={0} /></>}
      {' '}by an order or later.
    </p>
  </SectionCard>
);

const Attention: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const rows: { label: string; n: number; to: string }[] = [
    { label: 'Next clock already past', n: r.sets.overdue.length, to: links.matters({ clock: 'overdue' }) },
    { label: 'Next clock within 7 days', n: r.sets.due7.length, to: links.drill('due7') },
    { label: 'Nobody owns it', n: r.sets.unassigned.length, to: links.matters({ owner: 'none' }) },
    { label: 'Waiting for partner review', n: r.sets.review.length, to: links.matters({ stage: 'partner_review' }) },
    { label: 'No next action written', n: r.sets.noaction.length, to: links.drill('noaction') },
    { label: 'Untouched for 30 days or more', n: r.sets.idle30.length, to: links.drill('idle30') },
    { label: 'No amount recorded', n: r.sets.nodemand.length, to: links.drill('nodemand') },
  ];
  return (
    <SectionCard title="Needs attention" info="Open matters; each count opens its list.">
      <ul className="divide-y">
        {rows.map((x) => (
          <li key={x.label}>
            {x.n > 0 ? (
              <Link to={x.to} className="flex items-center justify-between gap-2 rounded px-1 py-1.5 text-xs hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 truncate">{x.label}</span>
                <span className="shrink-0 font-semibold tabular-nums text-destructive-strong">{x.n.toLocaleString('en-IN')}</span>
              </Link>
            ) : (
              <div className="flex items-center justify-between gap-2 px-1 py-1.5 text-xs">
                <span className="min-w-0 truncate">{x.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">0</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
};

const TopClients: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const top = r.byClient.slice(0, 5);
  const share = top.reduce((s, c) => s + c.share, 0);
  return (
    <SectionCard title="Top clients" info="By outstanding, with each client's share of the firm's outstanding."
      actions={<Link to={links.tab('clients')} className="text-xs font-medium text-primary underline underline-offset-2">All clients</Link>}>
      {top.length === 0 ? <EmptyBox className="p-4">No client has an open matter.</EmptyBox> : (
        <ul className="divide-y">
          {top.map((c) => (
            <li key={c.clientId} className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,6rem)_auto] items-center gap-2 py-1.5 text-xs">
              <Link to={links.matters({ client: c.clientId })} className="min-w-0 truncate font-medium hover:underline">
                {c.name}<span className="sr-only">, {plural(c.rows.length, 'open matter')}</span>
              </Link>
              <span className="h-2 rounded-full bg-muted" aria-hidden>
                {c.share > 0 && <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, c.share * 100)}%` }} />}
              </span>
              <span className="whitespace-nowrap text-right tabular-nums">
                <Amount value={c.money.outstanding} recorded={c.money.recorded > 0} className="font-semibold" />
                <span className="text-muted-foreground"> · {Math.round(c.share * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {top.length > 1 && r.money.outstanding > 0 && (
        <p className="text-[11px] text-muted-foreground">
          The top {top.length} hold {Math.round(share * 100)}% of {fmtInrShort(r.money.outstanding)} outstanding.
        </p>
      )}
    </SectionCard>
  );
};

const MoveStat: React.FC<{ label: string; n: number; to: string; amount: number; what: string }> = ({ label, n, to, amount, what }) => (
  <div className="min-w-0">
    <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
    <div className="text-lg font-semibold leading-tight tabular-nums">
      {n > 0 ? <Link to={to} className="text-primary underline underline-offset-2">{plural(n, 'matter')}</Link> : 'none'}
    </div>
    <div className="text-[11px] text-muted-foreground">{what} <span className="font-semibold tabular-nums text-foreground">{fmtInrShort(amount)}</span></div>
  </div>
);

const Movement: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  const opened = sumMoney(r.opened30);
  const closed = sumMoney(r.sets.closed30);
  return (
    <SectionCard title="Last 30 days" info="Matters opened and closed in the last 30 days, with their demand.">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <MoveStat label="Opened" n={r.opened30.length} to={links.matters({ status: 'all', age: '0-30' })} amount={opened.demand} what="demand added" />
        <MoveStat label="Closed" n={r.sets.closed30.length} to={links.drill('closed30')} amount={closed.demand} what="demand closed" />
      </div>
    </SectionCard>
  );
};

export const MisOverview: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => (
  <div className="space-y-3">
    <MisTiles r={r} links={links} />
    <MisCountsLine r={r} links={links} />
    <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
      <NextDays r={r} links={links} />
      <ByForum r={r} links={links} />
      <Attention r={r} links={links} />
    </div>
    <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2"><TopClients r={r} links={links} /></div>
      <Movement r={r} links={links} />
    </div>
  </div>
);

export default MisOverview;
