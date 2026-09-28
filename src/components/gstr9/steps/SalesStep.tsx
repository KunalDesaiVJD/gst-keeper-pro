import React from 'react';
import { ClipboardPaste } from 'lucide-react';
import { totalTax } from '@/lib/gstr9/engine';
import { useWorkspace } from '../WorkspaceContext';
import ExportMenu from '../ExportMenu';
import { KpiTile, OpenDifferences, useDiffLine } from '../ui';
import { fmtMoney } from '../grid/money';
import PartAGrid from '../sales/PartAGrid';
import PartBGrid from '../sales/PartBGrid';
import AuditReconciliation from '../sales/AuditReconciliation';
import Table5Preview from '../sales/Table5Preview';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <KpiTile
        label="Part A — taxable value"
        value={fmtMoney(s.partA.t)}
        hint={`${plural(docs.sales.partA.length, 'ledger')}${returns ? ` · ${plural(returns, 'return')}` : ''}`}
      />
      <KpiTile label="Part A — total tax" value={fmtMoney(totalTax(s.partA))} hint="IGST + CGST + SGST + Cess" />
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
  <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm">
    <ClipboardPaste className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    <div className="space-y-1">
      <div className="font-medium">Start from the P&amp;L income ledgers, the way the PL-OUTPUT sheet does.</div>
      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
        <li>
          Paste your PL-OUTPUT Part A rows (<span className="font-medium text-foreground">Particulars → Rate</span>) into the Part A
          grid. Returns stay as separate negative rows.
        </li>
        <li>Paste Part B (Particulars → Bifurcation) and check each ledger’s nature.</li>
        <li>Type the total income as per the audit report below; any difference needs a reason.</li>
      </ol>
    </div>
  </div>
);

/** Step 2 — Sales (PL-OUTPUT): Part A taxable income, Part B non-taxable income, audit-report match. */
const SalesStep: React.FC = () => {
  const { docs } = useWorkspace();
  const empty = docs.sales.partA.length === 0 && docs.sales.partB.length === 0 && docs.sales.auditReportTotal === null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2">
        <OpenDifferences step="sales" className="min-w-0 flex-1" />
        <div className="ml-auto">
          <ExportMenu only={['excel']} />
        </div>
      </div>

      {empty ? <EmptyExplainer /> : <SalesKpis />}

      <PartAGrid />
      <PartBGrid />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <AuditReconciliation />
        <Table5Preview />
      </div>
    </div>
  );
};

export default SalesStep;
