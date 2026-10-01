import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { DiffKpi } from '../gstr9c/bits';
import { Table5Card, Table7Card } from '../gstr9c/TurnoverPart';
import { Table11Card, Table9Card } from '../gstr9c/TaxPaidPart';
import { NoItcNote, Table12Card, Table14Card, Table16Card } from '../gstr9c/ItcPart';
import AdditionalLiabilityPart from '../gstr9c/AdditionalLiabilityPart';
import CertificationPart from '../gstr9c/CertificationPart';
import { OpenBadge, StepTab, StepTabsList } from '../reco/StepTabs';

interface TableDef {
  key: string;
  /** Trigger text: the table number, or a word for the untabled parts. */
  text: string;
  name: string;
  component: React.FC;
  /** The difference line the table carries. */
  diff?: string;
  itc?: boolean;
}

/** The statement's tables, one tab each, grouped by Part (row keys follow GSTR_9C_Offline_Utility.xlsm v2.8). */
const PARTS: Array<{ part: string | null; short: string; title: string; tables: TableDef[] }> = [
  {
    part: 'II',
    short: 'Turnover',
    title: 'Reconciliation of turnover declared in audited annual financial statement with turnover declared in annual return (GSTR-9)',
    tables: [
      { key: '5', text: '5', name: 'Reconciliation of gross turnover (with Table 6 reasons)', component: Table5Card, diff: 'gstr9c.5R' },
      { key: '7', text: '7', name: 'Reconciliation of taxable turnover (with Table 8 reasons)', component: Table7Card, diff: 'gstr9c.7G' },
    ],
  },
  {
    part: 'III',
    short: 'Tax paid',
    title: 'Reconciliation of tax paid',
    tables: [
      { key: '9', text: '9', name: 'Rate-wise liability and amount payable (with Table 10 reasons)', component: Table9Card, diff: 'gstr9c.9R' },
      { key: '11', text: '11', name: 'Additional amount payable but not paid', component: Table11Card },
    ],
  },
  {
    part: 'IV',
    short: 'ITC',
    title: 'Reconciliation of input tax credit (ITC)',
    tables: [
      { key: '12', text: '12', name: 'Reconciliation of net ITC (with Table 13 reasons)', component: Table12Card, diff: 'gstr9c.12F', itc: true },
      { key: '14', text: '14', name: 'ITC declared in GSTR-9 against ITC availed on expenses (with Table 15 reasons)', component: Table14Card, diff: 'gstr9c.14T', itc: true },
      { key: '16', text: '16', name: 'Tax payable on un-reconciled difference in ITC', component: Table16Card, itc: true },
    ],
  },
  {
    part: 'V',
    short: '',
    title: 'Additional liability due to non-reconciliation',
    tables: [{ key: 'liability', text: 'Liability', name: 'Additional liability due to non-reconciliation', component: AdditionalLiabilityPart }],
  },
  {
    part: null,
    short: '',
    title: 'Verification',
    tables: [{ key: 'certification', text: 'Verification', name: 'Verification — signatory and address', component: CertificationPart }],
  },
];

const TABLES = PARTS.flatMap((p) => p.tables);
const KPI_LINES: Array<{ key: string; label: string }> = [
  { key: 'gstr9c.5R', label: '5R · Un-reconciled turnover' },
  { key: 'gstr9c.7G', label: '7G · Un-reconciled taxable turnover' },
  { key: 'gstr9c.9R', label: '9R · Un-reconciled payment' },
  { key: 'gstr9c.12F', label: '12F · Un-reconciled net ITC' },
  { key: 'gstr9c.14T', label: '14T · Un-reconciled ITC by head' },
];

/** URL parameter that keeps the open table (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'gstr9ctab';
/** Earlier name of the parameter, still read so old links land on the same part. */
const OLD_TAB_PARAM = 'tab9c';
const OLD_TAB: Record<string, string> = { turnover: '5', tax: '9', itc: '12', liability: 'liability', certification: 'certification' };

/**
 * Step 11 — GSTR-9C, the official reconciliation statement. Every figure is
 * prefilled from the working (engine `workings.gstr9c`); italic figures are
 * computed and can be typed over, and each un-reconciled line carries its
 * justification. One tab per table, so each opens in one screen.
 */
const Gstr9cStep: React.FC = () => {
  const { workings } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM) ?? OLD_TAB[params.get(OLD_TAB_PARAM) ?? ''] ?? null;
  const tab = TABLES.some((t) => t.key === fromUrl) ? (fromUrl as string) : TABLES[0].key;
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    next.delete(OLD_TAB_PARAM);
    setParams(next, { replace: true });
  };
  const isOpen = (key?: string) => !!key && workings.diffs.some((d) => d.key === key && d.open);
  // The tiles carry every 9C difference line with its reason editor; the banner is only
  // needed for an open line that has no tile.
  const openElsewhere = workings.diffs.some((d) => d.step === 'gstr9c' && d.open && !KPI_LINES.some((k) => k.key === d.key));
  const current = TABLES.find((t) => t.key === tab);

  return (
    <div className="space-y-3">
      {openElsewhere && <OpenDifferences step="gstr9c" />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {KPI_LINES.map((k) => <DiffKpi key={k.key} lineKey={k.key} label={k.label} />)}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-2">
        <StepTabsList label="Tables of Form GSTR-9C" value={tab}>
          {PARTS.map((p, pi) => (
            <React.Fragment key={p.title}>
              {pi > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />}
              {p.part && (
                <span aria-hidden="true" title={`Part ${p.part} — ${p.title}`} className="whitespace-nowrap px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                  Pt {p.part}
                  {p.short && <span className="hidden font-medium normal-case tracking-normal xl:inline"> · {p.short}</span>}
                </span>
              )}
              {p.tables.map((t) => (
                <StepTab key={t.key} value={t.key} title={/^\d/.test(t.text) ? `Table ${t.text} — ${t.name}` : t.name} className="gap-1 px-2 tabular-nums">
                  {/^\d/.test(t.text) && <span className="sr-only">{p.part ? `Part ${p.part}, ` : ''}Table </span>}
                  {t.text}
                  <OpenBadge n={isOpen(t.diff) ? 1 : 0} showOk={false} />
                </StepTab>
              ))}
            </React.Fragment>
          ))}
        </StepTabsList>
        {current?.itc && <NoItcNote />}
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
        Prefilled from the working — never from the app’s own GSTR-1/3B. <span className="italic">Italic</span> figures are computed: type over one to override it, press
        Delete to restore it. Everything saves as you type.
      </p>
    </div>
  );
};

export default Gstr9cStep;
