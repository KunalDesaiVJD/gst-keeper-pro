// Litigation MIS · Hearings (audit U-106-1..3): every upcoming hearing on an
// open matter, read from matter_hearings (not one date per matter) with the
// date and time in IST, mode, venue and officer, what the hearing is for, the
// client opening its matters, "—" where no amount was typed, and day chips
// counted in IST calendar days. The firm-wide list of notice and matter
// hearings is the module's Hearings page; this one is the matters' share.
import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { StageBadge } from '@/components/notices/StageBadge';
import { OwnerChip } from '@/components/notices/OwnerChip';
import { WS_BTN, WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { fmtDay, plural } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { cn } from '@/lib/utils';
import { HEARING_PURPOSE, type HearingItem, type MisLinks } from './misData';
import { DaysChip, EmptyBox, MatterAmount, MatterLink } from './ui';

const where = (h: HearingItem['hearing']) => [h.mode, h.venue, h.officer].filter(Boolean).join(' · ') || '—';
const going = (h: HearingItem['hearing']) => (h.attendees.length ? `Attending: ${h.attendees.join(', ')}` : '');

// A hearing date taken from a linked notice says so; a matter's own hearing is named by its forum.
const purpose = ({ hearing: h, matter: m }: HearingItem) => (h.noticeId ? `${h.label} (linked notice)` : HEARING_PURPOSE[m.forum]);

/** All-day calendar entries (the shared .ics helper is date-only), the time in the title. */
const exportIcs = (rows: HearingItem[]) => downloadIcs(rows.map((it) => ({
  uid: `matter-hearing-${it.hearing.key}`,
  date: it.hearing.on,
  title: `${it.hearing.time ? `${it.hearing.time} IST ` : ''}hearing — ${it.matter.clientName} · ${it.matter.matterNo}`,
  description: [it.matter.title, purpose(it), where(it.hearing), going(it.hearing), it.hearing.notes].filter(Boolean).join('\n'),
})), 'matter-hearings', 'GST Keeper matter hearings');
const year = (on: string) => on.slice(0, 4);

const When: React.FC<{ h: HearingItem['hearing'] }> = ({ h }) => (
  <span className="block whitespace-nowrap text-xs leading-tight">
    <span className="block font-semibold">{fmtDay(h.on)} {year(h.on)}{h.time ? ` · ${h.time}` : ''}</span>
    <DaysChip days={h.days} className="mt-0.5" />
  </span>
);

const HearingList: React.FC<{ rows: HearingItem[]; links: MisLinks; caption: string }> = ({ rows, links, caption }) => (
  <>
    <ul className="space-y-2 md:hidden">
      {rows.map((it) => { const { hearing: h, matter: m } = it; return (
        <li key={h.key} className="rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <When h={h} />
            <Badge variant="secondary" className="text-[10px]">{purpose(it)}</Badge>
          </div>
          <MatterLink m={m} className="mt-1.5" />
          <Link to={links.matters({ client: m.clientId })} className="block truncate text-xs text-muted-foreground hover:underline">{m.clientName}</Link>
          <p className="mt-1 break-words text-xs">{where(h)}</p>
          {going(h) && <p className="break-words text-xs">{going(h)}</p>}
          {h.notes && <p className="break-words text-xs text-muted-foreground">{h.notes}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StageBadge stage={m.stage} />
            <MatterAmount m={m} className="text-xs" />
            <OwnerChip name={m.ownerName} showName className="ml-auto" />
          </div>
        </li>
      ); })}
    </ul>
    <div className={cn(WS_TABLE_WRAP, 'hidden md:block')}>
      <table className={WS_TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={WS_TH}>When (IST)</th>
            <th scope="col" className={WS_TH}>Matter</th>
            <th scope="col" className={WS_TH}>Client</th>
            <th scope="col" className={WS_TH}>Purpose</th>
            <th scope="col" className={WS_TH}>Where · before</th>
            <th scope="col" className={WS_TH}>Stage</th>
            <th scope="col" className={WS_TH}>Owner</th>
            <th scope="col" className={cn(WS_TH, 'text-right')}>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => { const { hearing: h, matter: m } = it; return (
            <tr key={h.key} className={WS_TR}>
              <td className={WS_TD}><When h={h} /></td>
              <td className={cn(WS_TD, 'min-w-[13rem]')}><MatterLink m={m} /></td>
              <td className={cn(WS_TD, 'max-w-[12rem]')}>
                <Link to={links.matters({ client: m.clientId })} className="block truncate hover:underline">{m.clientName}</Link>
              </td>
              <td className={cn(WS_TD, 'text-xs')}>
                {h.noticeId ? <Link to={`/notices/${h.noticeId}?tab=hearings`} className="underline underline-offset-2">{purpose(it)}</Link> : purpose(it)}
              </td>
              <td className={cn(WS_TD, 'min-w-[12rem] text-xs')}>
                {where(h)}
                {going(h) && <div>{going(h)}</div>}
                {h.notes && <div className="text-muted-foreground">{h.notes}</div>}
              </td>
              <td className={cn(WS_TD, 'whitespace-nowrap')}><StageBadge stage={m.stage} /></td>
              <td className={cn(WS_TD, 'whitespace-nowrap')}><OwnerChip name={m.ownerName} showName /></td>
              <td className={WS_TD_NUM}><MatterAmount m={m} /></td>
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  </>
);

export const MisHearings: React.FC<{ next14: HearingItem[]; later: HearingItem[]; allHearings: number; links: MisLinks }> = ({ next14, later, allHearings, links }) => (
  <div className="space-y-3">
    <SectionCard
      title={<>Next 14 days <span className="font-normal text-muted-foreground">· {plural(next14.length, 'hearing')}</span></>}
      description="Hearings on open matters from today, in IST"
      actions={<>
        <Link to="/notices-hearings" className="text-xs font-medium text-primary underline underline-offset-2">
          All hearings on notices and matters ({allHearings.toLocaleString('en-IN')})
        </Link>
        {next14.length + later.length > 0 && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => exportIcs([...next14, ...later])}>
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Add to calendar (.ics)
          </Button>
        )}
      </>}
    >
      {next14.length === 0 ? <EmptyBox className="p-4">No hearing is fixed on an open matter in the next 14 days.</EmptyBox>
        : <HearingList rows={next14} links={links} caption="Hearings in the next 14 days" />}
    </SectionCard>
    <SectionCard
      title={<>Later <span className="font-normal text-muted-foreground">· {plural(later.length, 'hearing')}</span></>}
      description="Hearings fixed beyond the next 14 days"
    >
      {later.length === 0 ? <EmptyBox className="p-4">No later hearing is fixed.</EmptyBox>
        : <HearingList rows={later} links={links} caption="Hearings after the next 14 days" />}
    </SectionCard>
  </div>
);

export default MisHearings;
