// The Reply Factory's overview: the roadmap Phase 4 acceptance, from
// reply_factory_status() — (a) due-date coverage of open notices, (b) evidence
// built automatically for the four target forms, (c) reading accuracy from
// people's verifications, (d) what the readers produced, (e) client document
// requests. Rebalanced 7 October 2026 (the firm's request): the sections sit in
// pairs of equal height, each carrying its own headline, so the old row of
// tiles that said the same again is gone; nothing is open by default. A count
// opens its list (?show=…) full width under the row it belongs to.
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import type { ReplyFactoryStatus } from '@/lib/replyFactory';
import { CoverageSection } from './CoverageSection';
import { AnnexuresSection } from './AnnexuresSection';
import { AccuracySection } from './AccuracySection';
import { ReadersSection } from './ReadersSection';
import { DocumentsSection } from './DocumentsSection';

const Full: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="min-w-0 xl:col-span-2">{children}</div>;

export const OverviewTab: React.FC<{ s: ReplyFactoryStatus | undefined; loading: boolean }> = ({ s, loading }) => {
  const [sp] = useSearchParams();
  const { canEditNoticeStatus } = useAuth();
  if (loading && !s) return <Skeleton className="h-96 w-full" />;
  if (!s) return null;
  const show = sp.get('show') ?? '';
  const open = (...prefixes: string[]) => prefixes.some((p) => show.startsWith(p));
  const canBuild = canEditNoticeStatus();

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
      <CoverageSection s={s} show={show} />
      <AnnexuresSection s={s} show={show} canBuild={canBuild} />
      {open('cov:') && <Full><CoverageSection s={s} show={show} part="list" /></Full>}
      {open('ann:') && <Full><AnnexuresSection s={s} show={show} canBuild={canBuild} part="list" /></Full>}

      <AccuracySection s={s} show={show} />
      <DocumentsSection s={s} show={show} />
      {open('acc:') && <Full><AccuracySection s={s} show={show} part="list" /></Full>}
      {open('docs:') && <Full><DocumentsSection s={s} show={show} part="list" /></Full>}

      <Full><ReadersSection s={s} show={show} /></Full>
      {open('iss:', 'rd:') && <Full><ReadersSection s={s} show={show} part="list" /></Full>}
    </div>
  );
};

export default OverviewTab;
