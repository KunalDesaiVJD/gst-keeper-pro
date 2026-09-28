import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExportMenu } from '../ExportMenu';
import { OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { DiffKpi } from '../gstr9c/bits';
import TurnoverPart from '../gstr9c/TurnoverPart';
import TaxPaidPart from '../gstr9c/TaxPaidPart';
import ItcPart from '../gstr9c/ItcPart';
import AdditionalLiabilityPart from '../gstr9c/AdditionalLiabilityPart';
import CertificationPart from '../gstr9c/CertificationPart';

/** Sub-tabs of the official statement, with the difference lines each one carries. */
const PARTS = [
  { key: 'turnover', label: 'Pt II · Turnover', tables: 'Tables 5–8', diffs: ['gstr9c.5R', 'gstr9c.7G'] },
  { key: 'tax', label: 'Pt III · Tax paid', tables: 'Tables 9–11', diffs: ['gstr9c.9R'] },
  { key: 'itc', label: 'Pt IV · ITC', tables: 'Tables 12–16', diffs: ['gstr9c.12F', 'gstr9c.14T'] },
  { key: 'liability', label: 'Pt V · Additional liability', tables: 'Part V', diffs: [] as string[] },
  { key: 'certification', label: 'Certification', tables: 'Verification', diffs: [] as string[] },
] as const;
type PartKey = (typeof PARTS)[number]['key'];

/** URL parameter that remembers the open sub-tab (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'tab9c';

/**
 * Step 11 — GSTR-9C, the official reconciliation statement. Every figure is
 * prefilled from the working (engine `workings.gstr9c`); italic figures are
 * computed and can be typed over, and each un-reconciled line carries its
 * justification. Row keys follow GSTR_9C_Offline_Utility.xlsm v2.8.
 */
const Gstr9cStep: React.FC = () => {
  const { workings } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM);
  const tab: PartKey = PARTS.some((p) => p.key === fromUrl) ? (fromUrl as PartKey) : 'turnover';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };
  const openIn = (keys: readonly string[]) => workings.diffs.filter((d) => keys.includes(d.key) && d.open).length;

  return (
    <div className="space-y-4">
      <OpenDifferences step="gstr9c" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-xs text-muted-foreground">
          Prefilled from the working — never from the app’s own GSTR-1/3B. <span className="italic">Italic</span> figures are computed: type over one to override
          it, press Delete to restore it. Everything saves as you type.
        </p>
        <ExportMenu only={['excel']} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <DiffKpi lineKey="gstr9c.5R" label="5R · Un-reconciled turnover" />
        <DiffKpi lineKey="gstr9c.7G" label="7G · Un-reconciled taxable turnover" />
        <DiffKpi lineKey="gstr9c.9R" label="9R · Un-reconciled payment" />
        <DiffKpi lineKey="gstr9c.12F" label="12F · Un-reconciled net ITC" />
        <DiffKpi lineKey="gstr9c.14T" label="14T · Un-reconciled ITC by head" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto w-max">
            {PARTS.map((p) => {
              const open = openIn(p.diffs);
              return (
                <TabsTrigger key={p.key} value={p.key} className="gap-1.5" title={p.tables}>
                  {p.label}
                  {open > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${open} open`}>
                      {open}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value="turnover" className="mt-3">
          <TurnoverPart />
        </TabsContent>
        <TabsContent value="tax" className="mt-3">
          <TaxPaidPart />
        </TabsContent>
        <TabsContent value="itc" className="mt-3">
          <ItcPart />
        </TabsContent>
        <TabsContent value="liability" className="mt-3">
          <AdditionalLiabilityPart />
        </TabsContent>
        <TabsContent value="certification" className="mt-3">
          <CertificationPart />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Gstr9cStep;
