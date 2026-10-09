import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Lock } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { clientStage, displayName, nextSentence, STAGE_META } from '@/lib/gstr9/signoffFlow';
import { useWorkspace } from '../WorkspaceContext';
import { StageTrack } from '../signoff/StageTrack';
import CarryForwardCard from '../overview/CarryForwardCard';
import OverviewTiles from '../overview/OverviewTiles';
import PortalStatusCard from '../overview/PortalStatusCard';
import StepChecklist from '../overview/StepChecklist';
import { rupeesShort, useGoToStep } from '../overview/steps';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

/**
 * One line for where the year stands: status, prepared / verified, GSTIN
 * (the page header shows the client and FY), and the call to action while
 * differences still need a reason.
 */
const StatusStrip: React.FC = () => {
  const { client, financialYear, locked, workings: w, signoffState: st, isStaff } = useWorkspace();
  const go = useGoToStep();
  const stage = isStaff ? st.stage : clientStage(st);
  const meta = STAGE_META[stage];
  const stamps = [
    st.prepared && `Prepared ${displayName(st.prepared.name)} ${day(st.prepared.at)}`,
    st.verified && `Verified ${displayName(st.verified.name)} ${day(st.verified.at)}`,
    st.locked && `Locked ${displayName(st.locked.name)} ${day(st.locked.at)}`,
  ].filter(Boolean).join(' · ');
  const next = isStaff ? nextSentence(st) : null;
  const justified = w.diffs.filter((d) => d.justification?.text?.trim()).length;
  const sep = <span aria-hidden className="text-muted-foreground/60">·</span>;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground">Sign-off</span>
        <StageTrack state={st} />
        <Badge variant={meta.tone} className="gap-1 text-[10px]">
          {stage === 'locked' && <Lock className="h-3 w-3" aria-hidden />}
          {meta.label}
        </Badge>
      </span>
      {stamps && <span className="text-muted-foreground">{stamps}</span>}
      {next && !locked && <span className="text-muted-foreground">· Next: {next.replace(/^With /, '')}</span>}
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
        <Button size="sm" variant="outline" className="h-7" onClick={() => go('review', { reviewtab: 'signoff' })}>
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
