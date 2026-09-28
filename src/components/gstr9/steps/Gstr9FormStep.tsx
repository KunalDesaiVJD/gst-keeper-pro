import React, { useState } from 'react';
import { taxOf, totalTax } from '@/lib/gstr9/engine';
import type { DiffLine } from '@/lib/gstr9/engine';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExportMenu } from '../ExportMenu';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import PartII from '../gstr9form/PartII';
import PartIII from '../gstr9form/PartIII';
import PartIV from '../gstr9form/PartIV';
import PartV from '../gstr9form/PartV';
import PartVI from '../gstr9form/PartVI';
import { StepLink } from '../gstr9form/shared';

/**
 * Step 10 — Form GSTR-9, Tables 4–19, assembled from the workings (the
 * firm's "GSTR-9" sheet). Every figure is an engine value (workings.g9);
 * only the few cells the sheet types by hand are entered here: 5I–5K, 6G
 * override, 6K–6M, 8E/8F/8H1, Table 9 payable overrides, 10, 11, 14–19.
 */

interface PartDef {
  key: string;
  label: string;
  tables: string;
  title: string;
  component: React.FC;
  /** Which of this step's difference lines are shown on the part. */
  owns: (d: DiffLine) => boolean;
}

const PARTS: PartDef[] = [
  {
    key: 'p2',
    label: 'Pt II',
    tables: 'Tables 4–5',
    title: 'Outward and inward supplies declared during the financial year',
    component: PartII,
    owns: (d) => d.key.startsWith('g9.t5.'),
  },
  { key: 'p3', label: 'Pt III', tables: 'Tables 6–8', title: 'ITC as declared in returns filed during the financial year', component: PartIII, owns: (d) => d.key === 'g9.8D' },
  { key: 'p4', label: 'Pt IV', tables: 'Table 9', title: 'Tax paid as declared in returns filed during the financial year', component: PartIV, owns: (d) => d.key.startsWith('g9.t9.') },
  {
    key: 'p5',
    label: 'Pt V',
    tables: 'Tables 10–14',
    title: 'Transactions for the financial year declared in returns of the next financial year',
    component: PartV,
    owns: () => false,
  },
  { key: 'p6', label: 'Pt VI', tables: 'Tables 15–19', title: 'Other information', component: PartVI, owns: () => false },
];

const TAB_STORAGE_KEY = 'gstk_gstr9_form_part';

const readTab = (): string => {
  try {
    const v = sessionStorage.getItem(TAB_STORAGE_KEY);
    if (v && PARTS.some((p) => p.key === v)) return v;
  } catch {
    /* storage unavailable */
  }
  return PARTS[0].key;
};

const Gstr9FormStep: React.FC = () => {
  const { workings } = useWorkspace();
  const g = workings.g9;
  const [tab, setTab] = useState<string>(readTab);
  const onTab = (v: string) => {
    setTab(v);
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };

  const openHere = workings.diffs.filter((d) => d.step === 'gstr9' && d.open);
  const portalFetched = g.t4Source === 'portal';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Columns follow the form: Taxable value, Central, State/UT, Integrated, Cess. Each row shows where its figure comes from; shaded cells are computed, white cells are typed.
        </p>
        <ExportMenu only={['gstr9pdf']} />
      </div>

      <OpenDifferences step="gstr9" />

      {!portalFetched && (
        <Note tone="warn">
          The GSTR-9 system-computed figures (4A–4L, 6A, 6G, 8A and Table 9) aren&apos;t fetched yet, so those rows are blank or fall back to the as-filed GSTR-3B / 4N.
          Fetch or upload them on <StepLink step="portal">Portal data</StepLink>.
        </Note>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiTile label="Total turnover (5N + 10 − 11)" value={fmtMoney(g.totalTurnover.t)} />
        <KpiTile label="Tax on 4N" value={fmtMoney(totalTax(taxOf(g.t4.N)))} hint="All heads" />
        <KpiTile label="Net ITC available (7J)" value={fmtMoney(totalTax(g.t7J))} hint={`Availed 6O ${fmtMoney(totalTax(g.t6.O))}`} />
        <KpiTile
          label="Open differences"
          value={openHere.length}
          hint={openHere.length ? 'Need a reason (8D, Table 9)' : 'None on this form'}
          tone={openHere.length ? 'error' : 'ok'}
        />
      </div>

      <Tabs value={tab} onValueChange={onTab}>
        <div className="overflow-x-auto">
          <TabsList className="h-auto w-max justify-start">
            {PARTS.map((p) => {
              const n = openHere.filter(p.owns).length;
              return (
                <TabsTrigger key={p.key} value={p.key} className="gap-1.5 px-3 py-1.5">
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.tables}</span>
                  {n > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${n} open`}>
                      {n}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        {PARTS.map((p) => {
          const C = p.component;
          return (
            <TabsContent key={p.key} value={p.key} className="mt-3 space-y-3">
              <h3 className="font-heading text-sm font-semibold text-muted-foreground">
                {p.label} · {p.title}
              </h3>
              <C />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
};

export default Gstr9FormStep;
