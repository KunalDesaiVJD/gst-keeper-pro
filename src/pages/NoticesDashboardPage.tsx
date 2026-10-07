// Notices & Litigation · Command centre (roadmap Phase 2 task 2; mock §7,
// docs/notices-mission-audit/mocks/target-dashboard.png). A partner sees in
// ten seconds what needs action today, who owns it and what money is at stake.
// Every figure comes from one RPC (public.notices_command_centre) defined over
// the same views the lists read, so each number opens a list with the same
// count; the ranked plan is public.notice_plan. The dashboard counts only the
// notice types shown on it (contract §A): a superadmin or GST manager chooses
// them under "Notice types" (?types=1 opens the dialog), and a quiet line says
// what is left out.
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
import { TodaysPlan } from '@/components/notices/command/TodaysPlan';
import { NoticeTypesSettings } from '@/components/notices/types/NoticeTypesSettings';
import {
  AutopilotHealth, AutopilotLine, ClientsAttention, CommandTiles, ExposureByStage, HiddenTypesLine, Next14Days, ReplyPipeline,
} from '@/components/notices/command/CommandCards';

const TYPE_PARAMS = ['types', 'tq', 'tneed', 'tdash'];

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const cc = useCommandCentre(user?.id ?? null);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
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
      section="Command centre"
      status={data ? <AutopilotLine cc={data} /> : <Skeleton className="h-4 w-96 max-w-full" />}
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

      {data ? <CommandTiles cc={data} /> : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)}
        </div>
      )}
      {data && <HiddenTypesLine cc={data} onOpenTypes={canTypes ? () => openTypes('listed') : undefined} />}

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]">
        <TodaysPlan cc={data} />
        <div className="space-y-3">
          {data ? <ReplyPipeline cc={data} /> : <Skeleton className="h-64" />}
          {data ? <AutopilotHealth cc={data} canRunAlerts={canManageNoticeAlerts()} onAlertsRun={refresh} /> : <Skeleton className="h-64" />}
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        {data ? <Next14Days cc={data} /> : <Skeleton className="h-48" />}
        {data ? <ExposureByStage cc={data} /> : <Skeleton className="h-48" />}
        {data ? <ClientsAttention cc={data} /> : <Skeleton className="h-48" />}
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
