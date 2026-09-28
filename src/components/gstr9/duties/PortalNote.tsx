import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, Note, useDiffLine } from '../ui';
import { useGoStep } from './helpers';

/**
 * Where "AS PER 3B" comes from (§5 data-source rule): the as-filed GSTR-3B
 * pulled from the portal on the Portal data step — never the app's own
 * GSTR-3B — with a month count, a link to go and fetch it, and the engine's
 * single "GSTR-3B not fetched for …" line (`missingKey`) when there is one.
 */
const PortalNote: React.FC<{ what: string; missingKey: 'dto.no3b' | 'dti.no3b' }> = ({ what, missingKey }) => {
  const { docs } = useWorkspace();
  const goStep = useGoStep();
  const missingLine = useDiffLine(missingKey);
  const counts = useMemo(() => {
    let fetched = 0;
    let typed = 0;
    let missing = 0;
    FY_MONTHS.forEach((m) => {
      const src = docs.portal.monthMeta[m]?.source;
      if (!src) missing += 1;
      else if (src === 'manual') typed += 1;
      else fetched += 1;
    });
    return { fetched, typed, missing };
  }, [docs.portal.monthMeta]);

  const parts = [
    `${counts.fetched} of 12 months from the portal`,
    counts.typed ? `${counts.typed} typed` : null,
    counts.missing ? `${counts.missing} not fetched` : null,
  ].filter(Boolean);

  return (
    <Note tone={counts.missing || missingLine ? 'warn' : 'info'}>
      <div className="space-y-1.5">
        <div>
          <span className="font-medium">As per 3B</span> is {what} of the <span className="font-medium">as-filed GSTR-3B</span> from the
          GST portal — never the app’s own GSTR-3B. <span className="tabular-nums">{parts.join(' · ')}.</span>{' '}
          <Button type="button" variant="link" className="h-auto gap-1 p-0 text-xs [&_svg]:size-3" onClick={() => goStep('portal')}>
            <RefreshCw aria-hidden="true" /> Fetch it on the Portal data step
          </Button>
        </div>
        {missingLine && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{missingLine.label}</span>
            <span className="text-muted-foreground">— months with book figures but no 3B to compare; their differences are shown muted.</span>
            <JustifyControl lineKey={missingKey} />
          </div>
        )}
      </div>
    </Note>
  );
};

export default PortalNote;
