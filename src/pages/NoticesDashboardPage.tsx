// Notices & Litigation · Command centre (roadmap Phase 2 task 2; mock §7,
// docs/notices-mission-audit/mocks/target-dashboard.png). A partner sees in
// ten seconds what needs action today, who owns it and what money is at stake.
// Every figure comes from one RPC (public.notices_command_centre) defined over
// the same views the lists read, so each number opens a list with the same
// count; the ranked plan is public.notice_plan. The dashboard counts only the
// notice types shown on it (contract §A): a superadmin or GST manager chooses
// them under "Notice types" (?types=1 opens the dialog), and a quiet line says
// what is left out. Rebalanced on 7 October 2026 (the firm's request): six tiles,
// then two rows of panels that end level, and the master filters under the tabs
// (client, FY, owner, form, priority), which every figure and link here keeps.
import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCommandCentre } from '@/lib/noticeCommandCentre';
import { canManageNoticeTypes } from '@/lib/noticeTypes';
import { Note } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WS_BTN } from '@/components/workspace/theme';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SyncNowButton } from '@/components/notices/SyncNowButton';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import { KindTabs } from '@/components/notices/cases/KindTabs';
import { AttentionList, NewFromPortal, StatStrip, Upcoming } from '@/components/notices/cases/HomeParts';
import { isTrack, useCaseCounts, type Track } from '@/lib/noticeCases';
import { NoticeTypesSettings } from '@/components/notices/types/NoticeTypesSettings';
import { AutopilotLine } from '@/components/notices/command/CommandCards';
import { masterForRpc, useMaster } from '@/lib/masterFilters';

const TYPE_PARAMS = ['types', 'tq', 'tneed', 'tdash'];

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const { m } = useMaster();
  const cc = useCommandCentre(user?.id ?? null, masterForRpc(m, user?.id ?? null));
  const counts = useCaseCounts(masterForRpc(m, user?.id ?? null));
  const kindParam = sp.get('kind');
  const kind: Track = isTrack(kindParam) ? kindParam : 'litigation';
  const setKind = (t: Track) => setSp((prev) => {
    const next = new URLSearchParams(prev);
    if (t === 'litigation') next.delete('kind'); else next.set('kind', t);
    return next;
  }, { replace: true });

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
    qc.invalidateQueries({ queryKey: ['notice-cases'] });
    qc.invalidateQueries({ queryKey: ['notice-case-counts'] });
  };
  const canEdit = canEditNoticeStatus();
  const canTypes = canManageNoticeTypes(user?.role);
  const data = cc.data;

  // The dialog and its filters live in the URL, so a link opens it as it was.
  const typesOpen = sp.get('types') === '1';
  // 'listed': the types off the dashboard that are still in the lists (HiddenTypesLine counts those).
  const openTypes = (dash?: 'listed') => setSp((prev) => {
    const next = new URLSearchParams(prev);
    next.set('types', '1');
    if (dash) next.set('tdash', dash);
    return next;
  }, { replace: true });
  const closeTypes = () => setSp((prev) => {
    const next = new URLSearchParams(prev);
    TYPE_PARAMS.forEach((k) => next.delete(k));
    return next;
  }, { replace: true });

  return (
    <NoticesShell
      section="Home"
      status={data ? <AutopilotLine cc={data} /> : null}
      master
      actions={<>
        {canTypes && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={() => openTypes()}>
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Notice types
          </Button>
        )}
        {canEdit && <AddNoticeDialog onSuccess={refresh} />}
        {canEdit && <SyncNowButton onStarted={refresh} />}
      </>}
    >
      {cc.error && (
        <Note tone="warn">
          Couldn't load the command centre: {cc.error instanceof Error ? cc.error.message : String(cc.error)}{' '}
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => cc.refetch()}><RefreshCw className="mr-1 h-3 w-3" /> Retry</Button>
        </Note>
      )}

      <KindTabs value={kind} counts={counts.data} onChange={setKind} />
      <StatStrip track={kind} c={counts.data?.[kind]} master={m} />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <AttentionList track={kind} master={m} />
        <div className="space-y-3">
          {kind !== 'other' && <NewFromPortal track={kind} />}
          {kind === 'litigation' && <Upcoming cc={data} master={m} />}
        </div>
      </div>

      <Dialog open={typesOpen} onOpenChange={(o) => { if (!o) closeTypes(); }}>
        <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto p-4 sm:max-w-5xl sm:p-6">
          <DialogHeader>
            <DialogTitle>Notice types</DialogTitle>
            <DialogDescription>Which kinds of notice need a reply, and which count on this dashboard.</DialogDescription>
          </DialogHeader>
          <NoticeTypesSettings urlState />
        </DialogContent>
      </Dialog>
    </NoticesShell>
  );
};

export default NoticesDashboardPage;
