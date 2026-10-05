import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/lib/gstr9/signoff';
import { useWorkspace } from '../WorkspaceContext';
import CarryForwardCard from '../overview/CarryForwardCard';
import OverviewTiles from '../overview/OverviewTiles';
import PortalStatusCard from '../overview/PortalStatusCard';
import StepChecklist from '../overview/StepChecklist';
import { fmtWhen, periodStatus, rupeesShort, useGoToStep } from '../overview/steps';

/**
 * One line for where the year stands: status, prepared / verified, GSTIN
 * (the page header shows the client and FY), and the call to action while
 * differences still need a reason.
 */
const StatusStrip: React.FC = () => {
  const { client, financialYear, period, locked, workings: w } = useWorkspace();
  const go = useGoToStep();
  const status = periodStatus(period);
  const justified = w.diffs.filter((d) => d.justification?.text?.trim()).length;
  const sep = <span aria-hidden className="text-muted-foreground/60">·</span>;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">Status</span>
        <Badge variant={status.tone} className="gap-1 text-[10px]">
          {status.key === 'locked' && <Lock className="h-3 w-3" aria-hidden />}
          {status.label}
        </Badge>
      </span>
      {period?.prepared_by_name ? (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-success-strong" aria-hidden />
          Ready for review — <span className="font-medium">{period.prepared_by_name}</span>
          {period.prepared_at && <span className="text-muted-foreground">{fmtWhen(period.prepared_at)}</span>}
        </span>
      ) : !locked ? (
        <span className="text-muted-foreground">Not marked ready for review</span>
      ) : null}
      {locked && (
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5 text-success-strong" aria-hidden />
          Verified &amp; locked by <span className="font-medium">{period?.reviewed_by_name ?? period?.locked_by ?? '—'}</span>
          {period?.reviewed_role && <span className="text-muted-foreground">({ROLE_LABEL[period.reviewed_role] ?? period.reviewed_role})</span>}
          {(period?.reviewed_at || period?.locked_at) && <span className="text-muted-foreground">{fmtWhen(period?.reviewed_at ?? period?.locked_at)}</span>}
        </span>
      )}
      {sep}
      <span className="inline-flex items-center gap-1">
        <span className="text-muted-foreground">GSTIN</span>
        <span className="font-mono">{client.gstin || '—'}</span>
      </span>
      {client.regular_sub_type === 'Builder' && client.builder_itc_type === 'NO_ITC' && (
        <Badge variant="secondary" className="text-[10px] font-normal">Builder · no ITC</Badge>
      )}
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Excel: MASTER B2:C7</span>

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {w.openCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              <span className="font-medium">{w.openCount === 1 ? '1 difference needs' : `${w.openCount} differences need`} a reason</span> before FY {financialYear} can be locked
              <span className="text-muted-foreground"> · {justified} justified · reason needed above {rupeesShort(w.tolerance)} on any head</span>
            </span>
          </span>
        ) : !locked ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-success-strong" aria-hidden />
            No open differences{justified ? ` · ${justified} justified` : ''}
          </span>
        ) : null}
        <Button size="sm" variant="outline" className="h-7" onClick={() => go('review')}>
          Review &amp; lock <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Button>
      </span>
    </div>
  );
};

/**
 * Step 0 — the MASTER sheet as a dashboard: status, the headline checks,
 * progress through every step, what came from the portal, and (for an empty
 * working) a start from last year's ledger list.
 */
const OverviewStep: React.FC = () => (
  <div className="space-y-3">
    <StatusStrip />

    {/* Only shown for an empty working, so it leads when it matters. */}
    <CarryForwardCard />

    <OverviewTiles />

    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
      <StepChecklist />
      <PortalStatusCard />
    </div>
  </div>
);

export default OverviewStep;
