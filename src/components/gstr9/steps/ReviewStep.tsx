import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { useWorkspace } from '../WorkspaceContext';
import DifferenceList from '../overview/DifferenceList';
import LockPanel from '../overview/LockPanel';
import ToleranceSetting from '../overview/ToleranceSetting';
import RevisionHistory from '../overview/RevisionHistory';
import VersionHistory from '../overview/VersionHistory';
import { fmtWhen, periodStatus, REVIEW_TAB_PARAM, type ReviewTab } from '../overview/steps';
import { StepTab, StepTabsList } from '../reco/StepTabs';

const TABS: ReviewTab[] = ['differences', 'signoff', 'history', 'snapshots'];

/**
 * Step 13 — every difference line in one list (with its reason), sign-off &
 * lock with the tolerance, the full revision history and the snapshots, one
 * tab each. The open tab is kept in the URL (?reviewtab=).
 */
const ReviewStep: React.FC = () => {
  const { locked, period, workings: w } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(REVIEW_TAB_PARAM) as ReviewTab | null;
  const tab: ReviewTab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'differences';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(REVIEW_TAB_PARAM, v);
    setParams(next, { replace: true });
  };

  const status = periodStatus(period);
  const ready = !locked && !!period?.prepared_by_name;
  const lockBadge = ready ? { label: 'Ready for review', tone: 'info' as const } : { label: status.label, tone: status.tone };

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-2">
      <StepTabsList
        label="Review & lock"
        value={tab}
        actionsClassName="ml-0 min-w-[16rem] flex-1 basis-0"
        actions={locked ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span>
              <span className="font-medium text-foreground">Locked</span>
              {period?.locked_by ? ` by ${period.locked_by}` : ''}{period?.locked_at ? ` on ${fmtWhen(period.locked_at)}` : ''}. Nothing can be edited until the year is unlocked.
            </span>
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Give every open difference a reason (or fix the figure), mark it ready for review; a GST manager or superadmin verifies and locks it.
          </p>
        )}
      >
        <StepTab value="differences">
          Differences
          <Badge variant={w.openCount ? 'destructive' : 'secondary'} className="h-4 px-1.5 text-[10px] leading-none">
            {w.openCount} open
          </Badge>
        </StepTab>
        <StepTab value="signoff">
          Sign-off &amp; lock
          <Badge variant={lockBadge.tone} className="h-4 gap-1 px-1.5 text-[10px] leading-none">
            {status.key === 'locked' && <Lock className="h-2.5 w-2.5" aria-hidden />}
            {lockBadge.label}
          </Badge>
        </StepTab>
        <StepTab value="history">Revision history</StepTab>
        <StepTab value="snapshots">Version snapshots</StepTab>
      </StepTabsList>

      <TabsContent value="differences" className="mt-0">
        <DifferenceList />
      </TabsContent>

      <TabsContent value="signoff" className="mt-0">
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <LockPanel />
          <ToleranceSetting />
        </div>
      </TabsContent>

      <TabsContent value="history" className="mt-0">
        <RevisionHistory />
      </TabsContent>

      <TabsContent value="snapshots" className="mt-0">
        <VersionHistory />
      </TabsContent>
    </Tabs>
  );
};

export default ReviewStep;
