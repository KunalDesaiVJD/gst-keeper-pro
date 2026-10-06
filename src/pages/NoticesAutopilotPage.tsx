// Notices & Litigation · Portal autopilot (/notices-autopilot; roadmap Phase 3,
// target-sync.png). Fixes audit S-01 (an unattended path with a batched CAPTCHA
// wall), S-13 (no hard-coded schedule: the switches are settings this page
// shows), S-23 (the agent's in-app CAPTCHA prompt and schedule), U-07-1 (what a
// run is doing, live), U-51-1 (each failure with its one fix) and the
// cross-cutting "automation exposed as manual buttons". The office agent logs
// in for each client and needs a CAPTCHA typed by a person: the wall shows
// them while someone has it open. Tabs, filters and pages live in the URL.
import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { useAuth } from '@/contexts/AuthContext';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { SyncNowButton } from '@/components/notices/SyncNowButton';
import { AutopilotStatusLine } from '@/components/notices/autopilot/AutopilotStatusLine';
import { CaptchaWall } from '@/components/notices/autopilot/CaptchaWall';
import { QueueTab } from '@/components/notices/autopilot/QueueTab';
import { AttentionTab } from '@/components/notices/autopilot/AttentionTab';
import { FetchReportTab } from '@/components/notices/autopilot/FetchReportTab';
import { EmailsTab } from '@/components/notices/autopilot/EmailsTab';
import { AcceptanceTab } from '@/components/notices/autopilot/AcceptanceTab';
import { SettingsTab } from '@/components/notices/autopilot/SettingsTab';
import { LoadError } from '@/components/notices/autopilot/parts';
import { useAutopilotStatus, useRegistrationAlerts } from '@/lib/autopilot';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'wall', label: 'CAPTCHA wall' },
  { key: 'queue', label: 'Queue' },
  { key: 'attention', label: 'Needs a person' },
  { key: 'fetch', label: 'Fetch a report' },
  { key: 'emails', label: 'Portal e-mails' },
  { key: 'acceptance', label: 'Acceptance' },
  { key: 'settings', label: 'Settings' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// A count on a tab; on the open (navy) tab it turns light, as the module's tab bar does.
const Count: React.FC<{ n: number | null | undefined; strong?: boolean }> = ({ n, strong }) => (n === null || n === undefined ? null : (
  <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
    strong
      ? 'bg-warning/30 text-foreground group-data-[state=active]/tab:bg-card group-data-[state=active]/tab:!text-foreground'
      : 'bg-primary/10 text-primary group-data-[state=active]/tab:bg-primary-foreground/20 group-data-[state=active]/tab:text-primary-foreground')}>
    {n.toLocaleString('en-IN')}
  </span>
));

const NoticesAutopilotPage: React.FC = () => {
  const { isStaffRole, canEditNoticeStatus, canManageNoticeAlerts } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const status = useAutopilotStatus();
  const reg = useRegistrationAlerts();

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const tab: TabKey = TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'wall';
  // A new tab starts with its own filters.
  const setTab = (t: string) => setSp(t === 'wall' ? new URLSearchParams() : new URLSearchParams({ tab: t }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['autopilot-status'] });
    qc.invalidateQueries({ queryKey: ['autopilot-queue'] });
    qc.invalidateQueries({ queryKey: ['autopilot-badge'] });
  };
  const s = status.data;
  const counts: Partial<Record<TabKey, number>> = s ? {
    wall: s.queue.waiting_captcha + s.queue.needs_human,
    queue: s.queue.queued + s.queue.retrying + s.queue.waiting_captcha + s.queue.needs_human + s.queue.running
      + s.today.succeeded + s.today.failed + s.today.cancelled,
    attention: s.failures.reduce((n, g) => n + g.count, 0) + (reg.data?.length ?? 0),
  } : {};

  return (
    <NoticesShell
      section="Portal autopilot"
      status={<AutopilotStatusLine s={s} />}
      actions={canEditNoticeStatus() && <SyncNowButton onStarted={refresh} />}
    >
      {status.error && <LoadError what="the autopilot" error={status.error} onRetry={() => status.refetch()} />}
      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList className={cn(TAB_LIST_CLASS, 'w-full sm:w-auto')} aria-label="Portal autopilot">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>
              {t.label}<Count n={counts[t.key]} strong={t.key === 'wall' && !!counts.wall} />
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="wall" className="mt-0">
          <CaptchaWall status={s} canManage={canManageNoticeAlerts()} onOpenSettings={() => setTab('settings')} />
        </TabsContent>
        <TabsContent value="queue" className="mt-0"><QueueTab /></TabsContent>
        <TabsContent value="attention" className="mt-0">
          <AttentionTab status={s} loading={status.isLoading} onOpenWall={() => setTab('wall')} />
        </TabsContent>
        <TabsContent value="fetch" className="mt-0"><FetchReportTab onQueued={refresh} /></TabsContent>
        <TabsContent value="emails" className="mt-0">
          <EmailsTab status={s} canManage={canManageNoticeAlerts()} onOpenSettings={() => setTab('settings')} />
        </TabsContent>
        <TabsContent value="acceptance" className="mt-0"><AcceptanceTab /></TabsContent>
        <TabsContent value="settings" className="mt-0"><SettingsTab status={s} loading={status.isLoading} /></TabsContent>
      </Tabs>
    </NoticesShell>
  );
};

export default NoticesAutopilotPage;
