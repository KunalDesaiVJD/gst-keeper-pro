// Litigation MIS · Breakdown (audit U-102-1..3, U-103-1..3): one tab with a
// switch — forum (where the dispute sits), stage (the one stage vocabulary, in
// pipeline order, with its own tones) or lifecycle (labelled, never a raw code)
// — as bars sized by rupees with the matter count beside them, then the table
// with pre-deposit, paid, outstanding, share and a total row.
import React from 'react';
import { Link } from 'react-router-dom';
import { Note, SectionCard } from '@/components/gstr9/ui';
import { StageBadge } from '@/components/notices/StageBadge';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { cn } from '@/lib/utils';
import type { Bucket, MisLinks, MisReport } from './misData';
import { BarList, BucketTable, EmptyBox } from './ui';

export type BreakdownBy = 'forum' | 'stage' | 'lifecycle';
const BREAKDOWNS: { key: BreakdownBy; label: string }[] = [
  { key: 'forum', label: 'Forum' },
  { key: 'stage', label: 'Stage' },
  { key: 'lifecycle', label: 'Lifecycle' },
];

export const MisBreakdown: React.FC<{ r: MisReport; links: MisLinks; by: BreakdownBy }> = ({ r, links, by }) => {
  const buckets: Bucket[] = by === 'forum' ? r.byForum
    : by === 'stage' ? r.byStage.filter((b) => b.rows.length > 0)
    : r.byLifecycle;
  // Forum has no filter on the Matters list, so its counts open the page's own list.
  const countHref = (b: Bucket) => by === 'forum' ? links.drill(`forum:${b.key}`)
    : by === 'stage' ? links.matters({ stage: b.key })
    : links.matters({ lifecycle: b.key });
  const title = by === 'forum' ? 'Outstanding by forum' : by === 'stage' ? 'Outstanding by stage' : 'Outstanding by lifecycle';
  const description = by === 'forum' ? 'Where each open dispute sits, from notice to recovery'
    : by === 'stage' ? 'Open matters in pipeline order'
    : 'Open matters by lifecycle, largest outstanding first';
  const switcher = (
    <div role="group" aria-label="Break down by" className={cn(WS_TABS_LIST, 'p-0.5')}>
      {BREAKDOWNS.map((b) => (
        <Link key={b.key} to={links.tab('breakdown', { by: b.key === 'forum' ? undefined : b.key })} aria-current={b.key === by ? 'true' : undefined}
          className={cn(WS_TAB, 'h-7 px-3 text-xs', b.key === by && WS_TAB_ACTIVE)}>
          {b.label}
        </Link>
      ))}
    </div>
  );
  return (
    <SectionCard
      title={title}
      description={<>{description} · ₹ outstanding and number of matters</>}
    >
      {switcher}
      {r.open.length === 0 ? <EmptyBox>No open matter to break down.</EmptyBox> : (
        <>
          <BarList rows={buckets.map((b) => ({ key: b.key, label: b.label, tone: b.tone, amount: b.money.outstanding, count: b.rows.length, to: countHref(b) }))} />
          <BucketTable
            label={by === 'forum' ? 'Forum' : by === 'stage' ? 'Stage' : 'Lifecycle'}
            caption={title}
            buckets={buckets}
            total={r.money}
            countHref={countHref}
            renderLabel={by === 'stage' ? (b) => <StageBadge stage={b.key} /> : undefined}
          />
          {by === 'forum' && (
            <Note tone="info">
              The forum is the one recorded on the matter (adjudicating officer, Appellate Authority, GSTAT, High Court or Supreme
              Court), else read from its lifecycle; before the adjudicating officer it is split at the order, and recovery is shown
              apart. Proposed = outstanding before any order; confirmed = the rest.
            </Note>
          )}
          {by === 'lifecycle' && (
            <Note tone="info">
              A lifecycle mixes the subject (demand, refund, registration…) with the forum (appeal, tribunal, recovery), so an appeal
              against a demand is counted under Appeal. Refund matters show as refund at stake, never as demand.
            </Note>
          )}
        </>
      )}
    </SectionCard>
  );
};

export default MisBreakdown;
