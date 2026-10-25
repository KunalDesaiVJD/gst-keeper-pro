// Notices & Litigation · Home. A partner sees in ten seconds what is late, what
// is due and what is theirs. Laid out by the UX audit of 25 October 2026, which
// found the same four numbers three times over (kind cards, six figures, the
// work list's pills) and "my work" only under More: now four figures, each a
// filter on My work beneath them (one row per case over notices and demands,
// refunds and registration; Mine, Team, Unassigned, Review), and beside it the
// next 14 days, overdue by age and what came in this week. Other (LUT,
// approvals), which needs no action, is a line under the work and a kind on
// Cases. Every figure is read with the master filters under the tabs. A
// superadmin or GST manager chooses the notice types the figures count under
// Reply Factory → Notice types (?types=1 still opens it from an old link).
import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCommandCentre } from '@/lib/noticeCommandCentre';
import { Note } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SyncNowButton } from '@/components/notices/SyncNowButton';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import { Upcoming } from '@/components/notices/cases/HomeParts';
import { AttentionTiles, HomeFooter, MyWork, isWhen, isWho, sumCounts, useWhoCounts, type When, type Who } from '@/components/notices/cases/HomeWork';
import { useCaseCounts } from '@/lib/noticeCases';
import { AutopilotLine } from '@/components/notices/command/CommandCards';
import { masterForRpc, useMaster } from '@/lib/masterFilters';

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const { m } = useMaster();
  const meId = user?.id ?? null;
  const cc = useCommandCentre(meId, masterForRpc(m, meId));
  const counts = useCaseCounts(masterForRpc(m, meId));
  const who$ = useWhoCounts(m, meId);
  const total = sumCounts(counts.data);
  // Whose work and how urgent live in the URL (?work=mine|team|unassigned|review, ?when=overdue|due7).
  const workParam = sp.get('work');
  const who: Who = isWho(workParam) ? workParam : (who$.data?.mine ?? 0) > 0 ? 'mine' : 'team';
  const whenParam = sp.get('when');
  const when: When = isWhen(whenParam) ? whenParam : 'all';
  const pick = (w: Who, t: When) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    next.set('work', w);
    if (t === 'all') next.delete('when'); else next.set('when', t);
    return next;
  }, { replace: true });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  // The notice types dialog moved to Reply Factory → Notice types.
  if (sp.get('types') === '1') return <Navigate to="/notices-reply-factory?tab=types" replace />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-cases'] });
    qc.invalidateQueries({ queryKey: ['notice-case-counts'] });
    qc.invalidateQueries({ queryKey: ['notice-home-who'] });
  };
  const canEdit = canEditNoticeStatus();
  const data = cc.data;
  const loadError = cc.error ?? counts.error;

  return (
    <NoticesShell
      section="Home"
      status={data ? <AutopilotLine cc={data} /> : null}
      master
      actions={<>
        {canEdit && <AddNoticeDialog onSuccess={refresh} />}
        {canEdit && <SyncNowButton onStarted={refresh} />}
      </>}
    >
      {loadError && (
        <Note tone="warn">
          Couldn't load the figures: {loadError instanceof Error ? loadError.message : String(loadError)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => { cc.refetch(); counts.refetch(); }}><RefreshCw className="mr-1 h-3 w-3" /> Retry</Button>
        </Note>
      )}

      <AttentionTiles c={total} mine={who$.data?.mine} who={who} when={when} onPick={pick} />
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <MyWork who={who} when={when} master={m} meId={meId} onPick={pick}
          counts={{ mine: who$.data?.mine, review: who$.data?.review, team: total?.open, unassigned: total?.unassigned }} />
        <Upcoming cc={data} master={m} />
      </div>
      <HomeFooter counts={counts.data} master={m} />
    </NoticesShell>
  );
};

export default NoticesDashboardPage;
