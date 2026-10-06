// Notices & Litigation · Reply Factory (/notices-reply-factory; roadmap Phase 4
// "Reply Factory I: read and compute"). Fixes audit R-08 (a notice is read
// when it lands, by the portal reader and — once switched on, with consent —
// the AI reader), R-10 / R-23 (evidence built from the portal figures,
// measured against the 70% target), R-11 (reply rules a partner approves),
// R-15 (the AI switch, spend, cap and audit on one page), R-25 (client
// document requests measured) and R-28 (due-date coverage measured). Tabs,
// filters and the open list live in the URL. Staff only.
import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { NoticesShell } from '@/components/notices/NoticesShell';
import { LoadError } from '@/components/notices/autopilot/parts';
import { FactoryStatusLine } from '@/components/notices/reply/factory/FactoryStatusLine';
import { OverviewTab } from '@/components/notices/reply/factory/OverviewTab';
import { RulesTab } from '@/components/notices/reply/factory/RulesTab';
import { AiReadingTab } from '@/components/notices/reply/factory/AiReadingTab';
import { ConsentTab } from '@/components/notices/reply/factory/ConsentTab';
import { useReplyFactoryStatus, type FactoryTab } from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const TABS: { key: FactoryTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'rules', label: 'Reply rules' },
  { key: 'ai', label: 'AI reading' },
  { key: 'consent', label: 'Client consent' },
];

// A count on a tab; on the open (navy) tab it turns light, as the module's tab bar does.
const Count: React.FC<{ n: number | null | undefined; label: string }> = ({ n, label }) => (n === null || n === undefined ? null : (
  <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold tabular-nums text-primary group-data-[state=active]/tab:bg-primary-foreground/20 group-data-[state=active]/tab:text-primary-foreground">
    {n.toLocaleString('en-IN')}<span className="sr-only"> {label}</span>
  </span>
));

const NoticesReplyFactoryPage: React.FC = () => {
  const { isStaffRole } = useAuth();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const status = useReplyFactoryStatus();

  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;

  const tab: FactoryTab = TABS.find((t) => t.key === sp.get('tab'))?.key ?? 'overview';
  // A new tab starts with its own filters.
  const setTab = (t: string) => setSp(t === 'overview' ? new URLSearchParams() : new URLSearchParams({ tab: t }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['reply-factory-status'] });
    qc.invalidateQueries({ queryKey: ['reply-factory'] });
    qc.invalidateQueries({ queryKey: ['reply-issue-types'] });
  };
  const s = status.data;
  const counts: Partial<Record<FactoryTab, { n: number; label: string }>> = s ? {
    ai: { n: s.ai.queue.queued + s.ai.queue.running, label: 'readings waiting or in progress' },
    consent: { n: s.ai.consent.with_consent, label: 'clients with consent' },
  } : {};

  return (
    <NoticesShell
      section="Reply Factory"
      status={<FactoryStatusLine s={s} />}
      actions={(
        <Button size="sm" variant="outline" className={WS_BTN} onClick={refresh} disabled={status.isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5', status.isFetching && 'animate-spin')} aria-hidden /> Refresh
        </Button>
      )}
    >
      {status.error && <LoadError what="the Reply Factory numbers" error={status.error} onRetry={() => status.refetch()} />}
      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList className={cn(TAB_LIST_CLASS, 'w-full sm:w-auto')} aria-label="Reply Factory">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>
              {t.label}<Count n={counts[t.key]?.n} label={counts[t.key]?.label ?? ''} />
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-0"><OverviewTab s={s} loading={status.isLoading} /></TabsContent>
        <TabsContent value="rules" className="mt-0"><RulesTab /></TabsContent>
        <TabsContent value="ai" className="mt-0"><AiReadingTab s={s} loading={status.isLoading} /></TabsContent>
        <TabsContent value="consent" className="mt-0"><ConsentTab /></TabsContent>
      </Tabs>
    </NoticesShell>
  );
};

export default NoticesReplyFactoryPage;
