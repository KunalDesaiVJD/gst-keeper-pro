import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ExportMenu from '../ExportMenu';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import CarryForwardCard from '../overview/CarryForwardCard';
import OverviewTiles from '../overview/OverviewTiles';
import PortalStatusCard from '../overview/PortalStatusCard';
import StepChecklist from '../overview/StepChecklist';
import { fmtWhen, periodStatus, useGoToStep } from '../overview/steps';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0 space-y-0.5">
    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-sm font-medium">{children}</dd>
  </div>
);

/**
 * Step 0 — the MASTER sheet as a dashboard: party details and status, the
 * headline checks, progress through every step, what came from the portal,
 * and (for an empty working) a start from last year's ledger list.
 */
const OverviewStep: React.FC = () => {
  const { client, financialYear, period, workings: w } = useWorkspace();
  const go = useGoToStep();
  const status = periodStatus(period);

  return (
    <div className="space-y-4">
      <SectionCard title="Party details" excelRef="MASTER B2:C7" actions={<ExportMenu />}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Party name">
            <span className="break-words">{client.name}</span>
            {client.regular_sub_type === 'Builder' && client.builder_itc_type === 'NO_ITC' && (
              <Badge variant="secondary" className="ml-2 align-middle text-[10px] font-normal">Builder · no ITC</Badge>
            )}
          </Field>
          <Field label="GSTIN"><span className="font-mono">{client.gstin || '—'}</span></Field>
          <Field label="Year">FY {financialYear}</Field>
          <Field label="Status">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant={status.tone} className="text-[10px]">{status.label}</Badge>
              {status.key === 'locked' && (
                <span className="text-xs font-normal text-muted-foreground">
                  {period?.locked_by ? `by ${period.locked_by}` : ''}{period?.locked_at ? ` · ${fmtWhen(period.locked_at)}` : ''}
                </span>
              )}
            </span>
          </Field>
        </dl>
      </SectionCard>

      {w.openCount > 0 && (
        <Note tone="warn" className="items-center [&>div]:flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-medium">{w.openCount === 1 ? '1 difference needs' : `${w.openCount} differences need`} a reason</span> before FY {financialYear} can be locked.
            </span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => go('review')}>
              Review &amp; lock <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </span>
        </Note>
      )}

      {/* Only shown for an empty working, so it leads when it matters. */}
      <CarryForwardCard />

      <OverviewTiles />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <StepChecklist />
        <div>
          <PortalStatusCard />
        </div>
      </div>
    </div>
  );
};

export default OverviewStep;
