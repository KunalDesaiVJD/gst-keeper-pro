import React from 'react';
import { maxAbs, totalTax } from '@/lib/gstr9/engine';
import ExportMenu from '../ExportMenu';
import { fmtMoney } from '../grid/money';
import RcmCategoriesCard from '../rcm/RcmCategoriesCard';
import RcmCategoryDetailCard from '../rcm/RcmCategoryDetailCard';
import RcmComparisonCard from '../rcm/RcmComparisonCard';
import RcmFlowsCard from '../rcm/RcmFlowsCard';
import RcmPartACard from '../rcm/RcmPartACard';
import RcmPartBCard from '../rcm/RcmPartBCard';
import { KpiTile, Money, OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

const PART_A_SOURCE: Record<'monthly' | 'gstr9' | 'none', string> = {
  monthly: 'GSTR-3B 3.1(d), month by month',
  gstr9: 'GSTR-9 4G — annual only',
  none: 'Not fetched yet',
};

/** Headline figures of the sheet: Part B total, Part A total, the difference, and what still needs a reason. */
const RcmSummary: React.FC = () => {
  const { workings } = useWorkspace();
  const W = workings.rcm;
  const tol = workings.tolerance;
  const diffMag = maxAbs(W.diff, true);
  const open = workings.stepOpen.rcm;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
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
        <KpiTile
          label="Differences needing a reason"
          value={open}
          hint={open ? 'Write the reason on the month’s row below' : 'None open'}
          tone={open ? 'error' : 'ok'}
        />
      </div>
      <ExportMenu only={['excel']} />
    </div>
  );
};

/**
 * Step 5 — RCM (the firm's "RCM" sheet): reverse-charge expenses as per books
 * (Part B, by expense and month) against 3.1(d) of the as-filed GSTR-3B
 * (Part A, from the portal), with the month-wise difference.
 */
const RcmStep: React.FC = () => (
  <div className="space-y-4">
    <OpenDifferences step="rcm" />
    <RcmSummary />
    <RcmCategoriesCard />
    <RcmPartBCard />
    <RcmCategoryDetailCard />
    <RcmPartACard />
    <RcmComparisonCard />
    <RcmFlowsCard />
  </div>
);

export default RcmStep;
