import React, { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { OpenDifferences } from '../ui';
import { ExportMenu } from '../ExportMenu';
import InputTab from '../duties/InputTab';
import OutputTab from '../duties/OutputTab';
import { hasCess, openCount } from '../duties/helpers';

type DutiesTab = 'output' | 'input';

const OpenCount: React.FC<{ n: number }> = ({ n }) =>
  n > 0 ? (
    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${n} open difference${n === 1 ? '' : 's'}`}>
      {n}
    </Badge>
  ) : (
    <span className="inline-flex items-center text-success-strong">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">No open differences</span>
    </span>
  );

/**
 * Step 4 — Duties & Taxes: the month-wise GST ledgers from the books against
 * the as-filed GSTR-3B (DUTIES & TAXES-OUTPUT and DUTIES & TAXES-INPUT).
 */
const DutiesStep: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const [tab, setTab] = useState<DutiesTab>('output');
  const [cessChoice, setCessChoice] = useState<boolean | null>(null);
  const [compact, setCompact] = useState(false);

  // Cess columns are shown by default only when some cess figure exists (the workbook has none).
  const cessUsed = useMemo(() => {
    const o = docs.duties_output;
    const i = docs.duties_input;
    return (
      FY_MONTHS.some((m) => {
        const im = i.months[m];
        const pm = docs.portal.months[m];
        return hasCess(o.months[m].sales, o.months[m].creditNote, im.purchase, im.debitNote, im.suspRev, im.suspRev180, im.suspReclaim, im.suspReclaim180, pm.outTax, pm.itcExclRcm);
      }) ||
      hasCess(i.lastYearEffect, ...o.adjustments, ...i.adjustments) ||
      hasCess(workings.dto.asPerPl, workings.dti.asPerPl, workings.dti.rcmBooks, workings.dti.rcmPortal)
    );
  }, [docs.duties_output, docs.duties_input, docs.portal.months, workings.dto.asPerPl, workings.dti.asPerPl, workings.dti.rcmBooks, workings.dti.rcmPortal]);
  const cess = cessChoice ?? cessUsed;

  const outOpen = openCount(workings.diffs, 'dto');
  const inOpen = openCount(workings.diffs, 'dti');

  return (
    <div className="space-y-4">
      <OpenDifferences step="duties" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as DutiesTab)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="output" className="gap-2">
              Output (Cr side) <OpenCount n={outOpen} />
            </TabsTrigger>
            <TabsTrigger value="input" className="gap-2">
              Input (Dr side, excl. RCM) <OpenCount n={inOpen} />
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="dt-show-cess" checked={cess} onCheckedChange={setCessChoice} />
              <Label htmlFor="dt-show-cess" className="text-xs font-normal">
                Show cess
                {!cess && cessUsed && <span className="ml-1 font-medium text-destructive-strong">(cess figures hidden)</span>}
              </Label>
            </div>
            {tab === 'input' && (
              <div className="flex items-center gap-2">
                <Switch id="dt-compact" checked={compact} onCheckedChange={setCompact} />
                <Label htmlFor="dt-compact" className="text-xs font-normal">Compact view</Label>
              </div>
            )}
            <ExportMenu only={['excel']} />
          </div>
        </div>

        <TabsContent value="output" className="mt-4 space-y-4">
          <OutputTab cess={cess} />
        </TabsContent>
        <TabsContent value="input" className="mt-4 space-y-4">
          <InputTab cess={cess} compact={compact} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DutiesStep;
