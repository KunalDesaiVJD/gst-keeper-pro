import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { maxAbs, totalTax } from '@/lib/gstr9/engine';
import { fmtMoney } from '../grid/money';
import RcmCategoriesCard from '../rcm/RcmCategoriesCard';
import RcmCategoryDetailCard from '../rcm/RcmCategoryDetailCard';
import RcmComparisonCard from '../rcm/RcmComparisonCard';
import RcmFlowsCard from '../rcm/RcmFlowsCard';
import RcmPartACard from '../rcm/RcmPartACard';
import RcmPartBCard from '../rcm/RcmPartBCard';
import { useRcmTab } from '../rcm/rcmShared';
import { CountBadge, OpenBadge, StepTab, StepTabsList } from '../reco/StepTabs';
import { KpiTile, Money, OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

const PART_A_SOURCE: Record<'monthly' | 'gstr9' | 'none', string> = {
  monthly: 'GSTR-3B 3.1(d), month by month',
  gstr9: 'GSTR-9 4G — annual only',
  none: 'Not fetched yet',
};

/** Headline figures of the sheet: Part B total, Part A total and the difference (the open count is on the comparison tab). */
const RcmSummary: React.FC = () => {
  const { workings } = useWorkspace();
  const W = workings.rcm;
  const tol = workings.tolerance;
  const diffMag = maxAbs(W.diff, true);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <KpiTile label="Part B — books (value)" value={<Money value={W.partB.t} />} hint={`Tax ${fmtMoney(totalTax(W.partB))}`} />
      <KpiTile
        label="Part A — portal (value)"
        value={<Money value={W.partA.t} />}
        hint={`Tax ${fmtMoney(totalTax(W.partA))} · ${PART_A_SOURCE[W.partASource]}`}
        tone={W.partASource === 'none' ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Difference (Books − Portal)"
        value={<Money value={totalTax(W.diff)} />}
        hint={`Tax · value ${fmtMoney(W.diff.t)}`}
        tone={diffMag < 0.005 ? 'ok' : diffMag > tol ? 'error' : 'neutral'}
      />
    </div>
  );
};

/**
 * Step 5 — RCM (the firm's "RCM" sheet): reverse-charge expenses as per books
 * (Part B, by expense and month) against 3.1(d) of the as-filed GSTR-3B
 * (Part A, from the portal), with the month-wise difference. The four parts
 * sit in tabs (?rcmtab=), the comparison first, so each is one click away.
 */
const RcmStep: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const cats = docs.rcm.categories;
  const [tab, setTab] = useRcmTab(cats.length > 0);
  const partASource = workings.rcm.partASource;

  return (
    <div className="space-y-3">
      <OpenDifferences step="rcm" />
      <RcmSummary />
      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <StepTabsList label="RCM working" value={tab}>
          <StepTab value="compare">
            Books vs portal <OpenBadge n={workings.stepOpen.rcm} />
          </StepTab>
          <StepTab value="books">Part B · books</StepTab>
          <StepTab value="portal">
            Part A · portal
            {partASource === 'none' && (
              <Badge variant="warning" className="h-4 px-1.5 text-[10px] font-normal leading-none">
                Not fetched
              </Badge>
            )}
            {partASource === 'gstr9' && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal leading-none">
                4G only
              </Badge>
            )}
          </StepTab>
          <StepTab value="expenses">
            Expenses &amp; flows <CountBadge n={cats.length} label={cats.length === 1 ? 'expense' : 'expenses'} />
          </StepTab>
        </StepTabsList>

        <TabsContent value="compare" className="mt-0 space-y-3">
          <RcmComparisonCard />
        </TabsContent>
        <TabsContent value="books" className="mt-0 space-y-3">
          <RcmPartBCard />
          <RcmCategoryDetailCard />
        </TabsContent>
        <TabsContent value="portal" className="mt-0 space-y-3">
          <RcmPartACard />
        </TabsContent>
        <TabsContent value="expenses" className="mt-0 space-y-3">
          <RcmCategoriesCard />
          <RcmFlowsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RcmStep;
