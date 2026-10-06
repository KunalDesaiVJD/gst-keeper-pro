// The Reply Factory's overview: the roadmap Phase 4 acceptance, from
// reply_factory_status() — (a) due-date coverage of open notices, (b) evidence
// built automatically for the four target forms, (c) reading accuracy from
// people's verifications, (d) what the readers produced, (e) client document
// requests. The headline tiles open the lists behind them; one list is open
// at a time (?show=…), inside the section it belongs to.
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { TileLink } from '@/components/notices/command/CommandCards';
import { useAuth } from '@/contexts/AuthContext';
import {
  ACCURACY_MIN_SAMPLE, AUTO_ANNEXURE_TARGET, DUE_COVERAGE_TARGET, DUE_EXACT_TARGET, factoryHref, fmtShare, shareOf, targetTone,
  type ReplyFactoryStatus,
} from '@/lib/replyFactory';
import { CoverageSection } from './CoverageSection';
import { AnnexuresSection } from './AnnexuresSection';
import { AccuracySection } from './AccuracySection';
import { ReadersSection } from './ReadersSection';
import { DocumentsSection } from './DocumentsSection';

const ACCENT = { ok: 'success', warn: 'warning', error: 'destructive', neutral: 'muted' } as const;

export const OverviewTab: React.FC<{ s: ReplyFactoryStatus | undefined; loading: boolean }> = ({ s, loading }) => {
  const [sp] = useSearchParams();
  const { canEditNoticeStatus } = useAuth();
  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  if (!s) return null;
  // One drill-down list at a time; by default the notices still missing a date.
  const show = sp.get('show') ?? 'cov:missing';
  const c = s.due_coverage; const a = s.annexures; const acc = s.accuracy; const d = s.documents;
  const dueShare = shareOf(acc.due_date_exact, acc.due_date_verified);
  const dmdShare = shareOf(acc.demand_within_1, acc.demand_verified);
  const missing = c.by_kind.missing ?? 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <TileLink to={factoryHref('overview', { show: 'cov:missing' })} label="Notices with a date"
          accent={ACCENT[targetTone(c.share, DUE_COVERAGE_TARGET)]} value={fmtShare(c.share)}
          hint={`${missing} of ${c.open} without · target ${DUE_COVERAGE_TARGET}%`} />
        <TileLink to={factoryHref('overview', { show: 'ann:auto' })} label="Built automatically"
          accent={ACCENT[targetTone(a.share_automatic, AUTO_ANNEXURE_TARGET)]} value={fmtShare(a.share_automatic)}
          hint={`${a.automatic} of ${a.target_open} · target ${AUTO_ANNEXURE_TARGET}%`} />
        <TileLink to={factoryHref('overview', { show: 'acc:due' })} label="Due date read exactly"
          accent={acc.due_date_verified >= ACCURACY_MIN_SAMPLE ? ACCENT[targetTone(dueShare, DUE_EXACT_TARGET)] : 'muted'}
          value={acc.due_date_verified >= ACCURACY_MIN_SAMPLE ? fmtShare(dueShare) : 'Too few yet'}
          hint={`${acc.due_date_exact} of ${acc.due_date_verified} · target ${DUE_EXACT_TARGET}%`} />
        <TileLink to={factoryHref('overview', { show: 'acc:demand' })} label="Demand within ₹1"
          accent={acc.demand_verified >= ACCURACY_MIN_SAMPLE ? ACCENT[targetTone(dmdShare, 100)] : 'muted'}
          value={acc.demand_verified >= ACCURACY_MIN_SAMPLE ? fmtShare(dmdShare) : 'Too few yet'}
          hint={`${acc.demand_within_1} of ${acc.demand_verified} · ${ACCURACY_MIN_SAMPLE} needed`} />
        <TileLink to={factoryHref('overview', { show: 'docs:open' })} label="Documents asked for"
          accent={d.open_over_7_days > 0 ? 'warning' : 'muted'} value={d.open.toLocaleString('en-IN')}
          hint={`${d.open_over_7_days} over 7 days · ${d.via_portal_90d} via portal`} />
      </div>

      <CoverageSection s={s} show={show} />
      <AnnexuresSection s={s} show={show} canBuild={canEditNoticeStatus()} />
      <AccuracySection s={s} show={show} />
      <ReadersSection s={s} show={show} />
      <DocumentsSection s={s} show={show} />
    </div>
  );
};

export default OverviewTab;
