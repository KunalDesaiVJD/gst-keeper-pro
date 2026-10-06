// Litigation MIS · Ageing (audit U-104-1..3): the two views a partner acts on —
// time left on each matter's next clock and how long it has been untouched —
// and how long matters have been open (the Matters list's own age buckets, so
// its counts match). IST calendar days; tones that darken with urgency; bars
// sized by rupees with the matter count on each.
import React from 'react';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { fmtInrShort, plural } from '@/lib/noticeFormat';
import type { AgeBucket, Bucket, MisLinks, MisReport } from './misData';
import { BarList, EmptyBox } from './ui';

// One hue that darkens as the bucket gets worse (U-104-3).
const SHADE: Record<string, Record<string, string>> = {
  clock: { expired: 'bg-destructive', '0-7': 'bg-destructive/70', '8-30': 'bg-warning', '31-90': 'bg-warning/50', '90+': 'bg-success/60', none: 'bg-muted-foreground/40' },
  idle: { '0-29': 'bg-primary/30', '30-59': 'bg-primary/55', '60-89': 'bg-primary/80', '90+': 'bg-primary' },
  age: { '0-30': 'bg-primary/30', '31-90': 'bg-primary/45', '91-180': 'bg-primary/60', '181-365': 'bg-primary/80', '365+': 'bg-primary' },
};

const BucketCard: React.FC<{ title: string; description: string; buckets: Bucket[]; shade: keyof typeof SHADE; href: (b: Bucket) => string; footnote: React.ReactNode }> =
  ({ title, description, buckets, shade, href, footnote }) => {
    const n = buckets.reduce((s, b) => s + b.rows.length, 0);
    const amount = buckets.reduce((s, b) => s + b.money.outstanding, 0);
    return (
      <SectionCard title={title} description={description}>
        <BarList rows={buckets.map((b) => ({ key: b.key, label: b.label, tone: b.tone, barClass: SHADE[shade][b.key], amount: b.money.outstanding, count: b.rows.length, to: href(b) }))} />
        <p className="flex items-center justify-between gap-2 border-t pt-1.5 text-xs font-semibold">
          <span>Total · {plural(n, 'matter')}</span>
          <span className="tabular-nums">{fmtInrShort(amount)}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">{footnote}</p>
      </SectionCard>
    );
  };

export const MisAgeing: React.FC<{ r: MisReport; links: MisLinks }> = ({ r, links }) => {
  if (r.open.length === 0) return <EmptyBox>No open matter to age.</EmptyBox>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        <BucketCard
          title="Time left on the next clock"
          description="₹ outstanding · matters, by days to the earliest open clock"
          buckets={r.byClock}
          shade="clock"
          href={(b) => (b.key === 'expired' ? links.matters({ clock: 'overdue' }) : links.drill(`clock:${b.key}`))}
          footnote="Next clock = the earliest open clock, as the Matters list works it out: reply dues of linked notices, the matter's due date, hearings, appeal and attachment clocks, and its limitation date."
        />
        <BucketCard
          title="Untouched for"
          description="₹ outstanding · matters, by days since the matter last changed"
          buckets={r.byIdle}
          shade="idle"
          href={(b) => links.drill(`idle:${b.key}`)}
          footnote="Days since the matter record was last updated (stage, owner, amounts, next action…)."
        />
        <BucketCard
          title="Open for"
          description="₹ outstanding · matters, by days since the matter was opened"
          buckets={r.byAge}
          shade="age"
          href={(b) => links.matters({ age: b.key as AgeBucket })}
          footnote="Counted from the day the matter was created, in IST calendar days, as the Matters list counts it."
        />
      </div>
      <Note tone="info">
        A matter is aged from the day it was opened in the app, not from the notice or order date, because matters do not
        record that date yet. The time left on the clock is the figure to act on.
      </Note>
    </div>
  );
};

export default MisAgeing;
