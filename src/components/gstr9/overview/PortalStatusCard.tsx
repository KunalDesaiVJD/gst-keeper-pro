import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { gstr9PortalPresent, MONTH_LABEL } from '@/lib/gstr9/engine';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { SectionCard, SourceChip } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, monthsApplied, rupees, sumTax, useGoToStep } from './steps';

const T6A_SOURCE = { gstr9: 'GSTR-9 system-computed', monthly_3b: 'Σ 4A of the as-filed 3B', none: 'not available yet' } as const;
const RCM_SOURCE = { monthly: 'as-filed 3B 3.1(d), monthly', gstr9: 'GSTR-9 4G, annual', none: 'not available yet' } as const;

/** What has come from the portal: the GSTR-9 system-computed JSON and the as-filed GSTR-3B months. */
export const PortalStatusCard: React.FC = () => {
  const { docs, workings: w } = useWorkspace();
  const go = useGoToStep();
  const meta = docs.portal.gstr9Meta;
  const gstr9 = gstr9PortalPresent(docs);
  const applied = monthsApplied(w);

  return (
    <SectionCard
      title="Portal data"
      description="Straight from the client’s GST portal — never the app’s own GSTR-1/3B."
      actions={
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => go('portal')} aria-label="Go to Portal data">
          Open <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      }
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">GSTR-9 system-computed</span>
          <SourceChip meta={meta} />
        </div>
        <p className="text-xs text-muted-foreground">
          {meta?.fetchedAt
            ? `Fetched ${fmtWhen(meta.fetchedAt)}`
            : gstr9
              ? 'Figures entered'
              : 'Not fetched yet — Table 4, 6A, 8A and Table 9 come from here.'}
        </p>
        {gstr9 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">4N tax</dt>
            <dd className="text-right tabular-nums">{rupees(sumTax(w.g9.t4.N))}</dd>
            <dt className="text-muted-foreground">8A (2B)</dt>
            <dd className="text-right tabular-nums">{rupees(sumTax(w.g9.t8.A))}</dd>
          </dl>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">As-filed GSTR-3B</span>
          <span className="text-sm font-semibold tabular-nums">{applied.length}/12 months</span>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {FY_MONTHS.map((m) => {
            const ok = applied.includes(m);
            const src = docs.portal.monthMeta[m]?.source;
            return (
              <span
                key={m}
                title={ok ? `${MONTH_LABEL[m]}: applied${src ? ` (${src.replace(/_/g, ' ')})` : ''}` : `${MONTH_LABEL[m]}: not fetched`}
                className={cn(
                  'rounded border px-1 py-0.5 text-center text-[10px] font-medium',
                  ok ? 'border-success/40 bg-success/10 text-foreground' : 'border-dashed text-muted-foreground',
                )}
              >
                {MONTH_LABEL[m]}
                <span className="sr-only">{ok ? ' applied' : ' not fetched'}</span>
              </span>
            );
          })}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t pt-2 text-xs">
        <dt className="text-muted-foreground">6A from</dt>
        <dd className="text-right">{T6A_SOURCE[w.g9.t6ASource]}</dd>
        <dt className="text-muted-foreground">RCM (portal) from</dt>
        <dd className="text-right">{RCM_SOURCE[w.rcm.partASource]}</dd>
      </dl>
    </SectionCard>
  );
};

export default PortalStatusCard;
