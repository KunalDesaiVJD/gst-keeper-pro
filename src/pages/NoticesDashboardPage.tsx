// Notices & Litigation · Command centre (roadmap Phase 2 task 2; mock §7,
// docs/notices-mission-audit/mocks/target-dashboard.png). A partner sees in
// ten seconds what needs action today, who owns it and what money is at stake.
// Every figure comes from one RPC (public.notices_command_centre) defined over
// the same views the lists read, so each number opens a list with the same
// count; the ranked plan is public.notice_plan.
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCommandCentre } from '@/lib/noticeCommandCentre';
import { Note } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SyncNowButton } from '@/components/notices/SyncNowButton';
import { AddNoticeDialog } from '@/components/notices/AddNoticeDialog';
import { TodaysPlan } from '@/components/notices/command/TodaysPlan';
import {
  AutopilotHealth, AutopilotLine, ClientsAttention, CommandTiles, ExposureByStage, Next14Days, ReplyPipeline,
} from '@/components/notices/command/CommandCards';

const NoticesDashboardPage: React.FC = () => {
  const { isStaffRole, user, canEditNoticeStatus, canManageNoticeAlerts } = useAuth();
  const qc = useQueryClient();
  const cc = useCommandCentre(user?.id ?? null);

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notices-command-centre'] });
    qc.invalidateQueries({ queryKey: ['notice-plan-top'] });
  };
  const canEdit = canEditNoticeStatus();
  const data = cc.data;

  return (
    <NoticesShell
      section="Command centre"
      status={data ? <AutopilotLine cc={data} /> : <Skeleton className="h-4 w-96 max-w-full" />}
      actions={<>
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
    </NoticesShell>
  );
};

export default NoticesDashboardPage;
