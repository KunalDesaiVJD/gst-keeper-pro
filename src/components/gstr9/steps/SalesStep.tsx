import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ClipboardPaste } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { StepTab, StepTabsList } from '../reco/StepTabs';
import { useWorkspace } from '../WorkspaceContext';
import { KpiTile, OpenDifferences, useDiffLine } from '../ui';
import { fmtMoney } from '../grid/money';
import PartAGrid from '../sales/PartAGrid';
import PartBGrid from '../sales/PartBGrid';
import AuditReconciliation from '../sales/AuditReconciliation';
import Table5Preview from '../sales/Table5Preview';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** URL parameter that remembers the open part (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'salestab';
const TABS = ['a', 'b', 'audit', 't5'] as const;
type TabKey = (typeof TABS)[number];

/** Small count pill on a tab trigger. */
const Count: React.FC<{ n: number; label: string }> = ({ n, label }) => (
  <Badge variant="secondary" className="h-4 min-w-4 justify-center rounded-full px-1.5 text-[10px] font-normal leading-none" title={label}>
    <span aria-hidden="true">{n}</span>
    <span className="sr-only">{label}</span>
  </Badge>
);

const SalesKpis: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const s = workings.sales;
  const line = useDiffLine('sales.audit');
  const returns = docs.sales.partA.filter((r) => s.rows[r.id]?.isReturn).length;

  let diffTone: 'ok' | 'warn' | 'error' | 'neutral' = 'neutral';
  let diffHint: string = 'Enter the audit report total';
  if (s.auditDiff !== null) {
    if (Math.abs(s.auditDiff) < 0.005) { diffTone = 'ok'; diffHint = 'Matched'; }
    else if (line?.open) { diffTone = 'error'; diffHint = line.stale ? 'Re-check the reason' : 'Reason needed'; }
    else if (line?.justification?.text?.trim()) diffHint = 'Justified';
    else diffHint = `Within ₹${workings.tolerance}`;
  }

  // Part A's tax is in its totals row (IGST · CGST · SGST · Cess), so it has no tile of its own.
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <KpiTile
        label="Part A — taxable value"
        value={fmtMoney(s.partA.t)}
        hint={`${plural(docs.sales.partA.length, 'ledger')}${returns ? ` · ${plural(returns, 'return')}` : ''}`}
      />
      <KpiTile label="Part B — non-taxable" value={fmtMoney(s.partBTotal)} hint={plural(docs.sales.partB.length, 'ledger')} />
      <KpiTile label="Books total (A + B)" value={fmtMoney(s.total)} hint="PL-OUTPUT D52" />
      <KpiTile
        label="As per audit report"
        value={s.auditReportTotal === null ? <span className="text-muted-foreground">Not entered</span> : fmtMoney(s.auditReportTotal)}
        hint="PL-OUTPUT D54"
        tone={s.auditReportTotal === null ? 'warn' : 'neutral'}
      />
      <KpiTile
        label="Difference (Report − Books)"
        value={s.auditDiff === null ? <span className="text-muted-foreground">—</span> : fmtMoney(s.auditDiff)}
        hint={diffHint}
        tone={diffTone}
      />
    </div>
  );
};

const EmptyExplainer: React.FC = () => (
  <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-2.5 text-sm">
    <ClipboardPaste className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    <div className="space-y-1">
      <div className="font-medium">Start from the P&amp;L income ledgers, the way the PL-OUTPUT sheet does.</div>
      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
        <li>
          Paste your PL-OUTPUT Part A rows (<span className="font-medium text-foreground">Particulars → Rate</span>) into the Part A
          grid. Returns stay as separate negative rows.
        </li>
        <li>Paste Part B (Particulars → Bifurcation) and check each ledger’s nature.</li>
        <li>Type the total income as per the audit report on the Audit report tab; any difference needs a reason.</li>
      </ol>
    </div>
  </div>
);

/** Step 2 — Sales (PL-OUTPUT): Part A taxable income, Part B non-taxable income, audit-report match. */
const SalesStep: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM);
  const tab: TabKey = TABS.some((t) => t === fromUrl) ? (fromUrl as TabKey) : 'a';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };

  const s = workings.sales;
  const auditLine = useDiffLine('sales.audit');
  const empty = docs.sales.partA.length === 0 && docs.sales.partB.length === 0 && docs.sales.auditReportTotal === null;
  const mismatches = docs.sales.partA.filter((r) => s.rows[r.id]?.rateMismatch).length;


  return (
    <div className="space-y-3">
      <OpenDifferences step="sales" />

      {empty ? <EmptyExplainer /> : <SalesKpis />}

      <Tabs value={tab} onValueChange={setTab}>
        <StepTabsList label="Sales" value={tab}>
            <StepTab value="a">
              Part A · Taxable
              <Count n={docs.sales.partA.length} label={plural(docs.sales.partA.length, 'ledger')} />
              {mismatches > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-foreground" title={`${plural(mismatches, 'rate check')}: tax does not match the rate`}>
                  <AlertTriangle className="h-3 w-3 text-warning" aria-hidden />
                  {plural(mismatches, 'rate check')}
                </span>
              )}
            </StepTab>
            <StepTab value="b">
              Part B · Non-taxable
              <Count n={docs.sales.partB.length} label={plural(docs.sales.partB.length, 'ledger')} />
            </StepTab>
            <StepTab value="audit">
              Audit report
              {auditLine?.open ? (
                <Badge variant="destructive" className="h-4 rounded-full px-1.5 text-[10px] font-medium leading-none">
                  {auditLine.stale ? 'Re-check' : 'Reason needed'}
                </Badge>
              ) : s.auditReportTotal === null ? (
                <span className="text-[10px] font-normal text-muted-foreground">not entered</span>
              ) : null}
            </StepTab>
            <StepTab value="t5">
              GSTR-9 Table 5
            </StepTab>
        </StepTabsList>

        <TabsContent value="a">
          <PartAGrid />
        </TabsContent>
        <TabsContent value="b">
          <PartBGrid />
        </TabsContent>
        <TabsContent value="audit">
          <AuditReconciliation />
        </TabsContent>
        <TabsContent value="t5">
          <Table5Preview />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SalesStep;
