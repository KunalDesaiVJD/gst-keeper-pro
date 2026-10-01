import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { taxOf, totalTax } from '@/lib/gstr9/engine';
import type { DiffLine } from '@/lib/gstr9/engine';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ExportMenu } from '../ExportMenu';
import { fmtMoney } from '../grid/money';
import { Note, OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { Table4, Table5 } from '../gstr9form/PartII';
import { Table6, Table7, Table8 } from '../gstr9form/PartIII';
import { Table9 } from '../gstr9form/PartIV';
import { Table14, Tables10to13 } from '../gstr9form/PartV';
import { Table15, Table16, Table17, Table18, Table19 } from '../gstr9form/PartVI';
import { StepLink } from '../gstr9form/shared';
import { OpenBadge, StepTab, StepTabsList } from '../reco/StepTabs';

/**
 * Step 10 — Form GSTR-9, Tables 4–19, assembled from the workings (the
 * firm's "GSTR-9" sheet). Every figure is an engine value (workings.g9);
 * only the few cells the sheet types by hand are entered here: 5I–5K, 6G
 * override, 6K–6M, 8E/8F/8H1, Table 9 payable overrides, 10, 11, 14–19.
 *
 * One tab per table of the form (grouped by Part), so each table opens in
 * one screen and any table is one click away.
 */

interface TableDef {
  key: string;
  /** Table number(s) as on the form. */
  no: string;
  name: string;
  component: React.FC;
  /** Which of this step's difference lines sit on the table. */
  owns?: (d: DiffLine) => boolean;
}

interface PartDef {
  part: string;
  /** Short name shown on wide screens. */
  short: string;
  title: string;
  tables: TableDef[];
}

const PARTS: PartDef[] = [
  {
    part: 'II',
    short: 'Supplies',
    title: 'Outward and inward supplies declared during the financial year',
    tables: [
      { key: '4', no: '4', name: 'Outward supplies on which tax is payable', component: Table4 },
      { key: '5', no: '5', name: 'Outward supplies on which tax is not payable', component: Table5, owns: (d) => d.key.startsWith('g9.t5.') },
    ],
  },
  {
    part: 'III',
    short: 'ITC',
    title: 'ITC as declared in returns filed during the financial year',
    tables: [
      { key: '6', no: '6', name: 'ITC availed during the financial year', component: Table6 },
      { key: '7', no: '7', name: 'ITC reversed and ineligible ITC', component: Table7 },
      { key: '8', no: '8', name: 'Other ITC related information', component: Table8, owns: (d) => d.key === 'g9.8D' },
    ],
  },
  {
    part: 'IV',
    short: 'Tax paid',
    title: 'Tax paid as declared in returns filed during the financial year',
    tables: [{ key: '9', no: '9', name: 'Tax paid', component: Table9, owns: (d) => d.key.startsWith('g9.t9.') }],
  },
  {
    part: 'V',
    short: 'Next FY',
    title: 'Transactions for the financial year declared in returns of the next financial year',
    tables: [
      { key: '10', no: '10–13', name: 'Declared in the next financial year, and total turnover', component: Tables10to13 },
      { key: '14', no: '14', name: 'Differential tax paid on account of 10 & 11', component: Table14 },
    ],
  },
  {
    part: 'VI',
    short: 'Other',
    title: 'Other information',
    tables: [
      { key: '15', no: '15', name: 'Demands and refunds', component: Table15 },
      { key: '16', no: '16', name: 'Composition, deemed supply, goods on approval', component: Table16 },
      { key: '17', no: '17', name: 'HSN summary of outward supplies', component: Table17 },
      { key: '18', no: '18', name: 'HSN summary of inward supplies', component: Table18 },
      { key: '19', no: '19', name: 'Late fee payable and paid', component: Table19 },
    ],
  },
];

const TABLES = PARTS.flatMap((p) => p.tables);

/** URL parameter that keeps the open table (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'gstr9tab';

const Figure: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <span className="whitespace-nowrap" title={hint}>
    <span className="text-muted-foreground">{label} </span>
    <span className="font-semibold tabular-nums text-foreground">{value}</span>
  </span>
);

const Gstr9FormStep: React.FC = () => {
  const { workings } = useWorkspace();
  const g = workings.g9;
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM);
  const tab = TABLES.some((t) => t.key === fromUrl) ? (fromUrl as string) : TABLES[0].key;
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };

  const openHere = workings.diffs.filter((d) => d.step === 'gstr9' && d.open);
  const portalFetched = g.t4Source === 'portal';

  return (
    <div className="space-y-3">
      <OpenDifferences step="gstr9" />

      {!portalFetched && (
        <Note tone="warn">
          The GSTR-9 system-computed figures (4A–4L, 6A, 6G, 8A and Table 9) aren&apos;t fetched yet, so those rows are blank or fall back to the as-filed GSTR-3B / 4N.
          Fetch or upload them on <StepLink step="portal">Portal data</StepLink>.
        </Note>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <StepTabsList
          label="Tables of Form GSTR-9"
          value={tab}
          actions={
            <>
              {/* The form's headline figures, on a wide screen (each is also on its table). */}
              <span className="hidden items-center gap-x-4 text-xs 2xl:flex">
                <Figure label="Turnover (5N + 10 − 11)" value={fmtMoney(g.totalTurnover.t)} />
                <Figure label="Tax on 4N" value={fmtMoney(totalTax(taxOf(g.t4.N)))} hint="All heads" />
                <Figure label="Net ITC (7J)" value={fmtMoney(totalTax(g.t7J))} hint={`Availed 6O ${fmtMoney(totalTax(g.t6.O))}`} />
              </span>
              <ExportMenu only={['gstr9pdf']} />
            </>
          }
        >
          {PARTS.map((p, pi) => (
            <React.Fragment key={p.part}>
              {pi > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />}
              <span aria-hidden="true" title={`Part ${p.part} — ${p.title}`} className="whitespace-nowrap px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                Pt {p.part}
                <span className="hidden font-medium normal-case tracking-normal xl:inline"> · {p.short}</span>
              </span>
              {p.tables.map((t) => (
                <StepTab key={t.key} value={t.key} title={`Table ${t.no} — ${t.name}`} className="gap-1 px-2 tabular-nums">
                  <span className="sr-only">Part {p.part}, Table </span>
                  {t.no}
                  <OpenBadge n={t.owns ? openHere.filter(t.owns).length : 0} showOk={false} />
                </StepTab>
              ))}
            </React.Fragment>
          ))}
        </StepTabsList>
        {TABLES.map((t) => {
          const C = t.component;
          return (
            <TabsContent key={t.key} value={t.key} className="mt-0">
              <C />
            </TabsContent>
          );
        })}
      </Tabs>

      <p className="text-[11px] text-muted-foreground">
        Columns follow the form: Taxable value, Central, State/UT, Integrated, Cess. Each row shows where its figure comes from; shaded cells are computed, white cells are typed.
      </p>
    </div>
  );
};

export default Gstr9FormStep;
