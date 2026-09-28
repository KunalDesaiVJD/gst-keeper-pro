import React, { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { computeWorkings, taxOf, tin } from '@/lib/gstr9/engine';
import { loadPreviousYear } from '@/lib/gstr9/store';
import type { AnnexuresDoc } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { MatrixTable, SectionCard } from '../ui';
import { FixedTaxGrid, type FixedTaxRow } from './FixedTaxGrid';
import { explicitTaxIn, hasAmount, previousFY } from './taxRows';

type ClauseKey = keyof AnnexuresDoc['a4'];

const Annexure4: React.FC = () => {
  const { client, financialYear, docs, workings, update, readOnly } = useWorkspace();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const a4 = docs.annexures.a4;
  const pfy = previousFY(financialYear);

  const clauses: Array<{ key: ClauseKey; no: string; label: string; hint?: string }> = [
    { key: 'c8', no: '1', label: 'Clause 8 — 8C', hint: `ITC of FY ${pfy} received in that year but availed in FY ${financialYear}. Feeds the notice format's "ITC brought forward".` },
    { key: 'c10', no: '2', label: 'Clause 10', hint: 'Supplies / tax declared through invoices, debit notes, amendments (+)' },
    { key: 'c11', no: '3', label: 'Clause 11', hint: 'Supplies / tax declared through amendments, credit notes (−)' },
    { key: 'c12', no: '4', label: 'Clause 12', hint: `ITC of FY ${pfy} reversed in FY ${financialYear}` },
    { key: 'c13', no: '5', label: 'Clause 13', hint: `ITC of FY ${pfy} availed in FY ${financialYear}` },
  ];

  const rows: FixedTaxRow[] = clauses.map((c) => ({
    id: c.key,
    no: c.no,
    label: c.label,
    hint: c.hint,
    kind: 'typed',
    stored: a4[c.key],
    value: tin(a4[c.key]),
    onChange: (v) => { if (v) update('annexures', (d) => ({ ...d, a4: { ...d.a4, [c.key]: v } })); },
  }));

  const fill = async () => {
    setBusy(true);
    try {
      const prev = await loadPreviousYear(client.id, financialYear);
      if (!prev) {
        toast.info(`FY ${pfy} hasn't been worked in the app — type the clauses from last year's filed GSTR-9.`);
        return;
      }
      const g = computeWorkings(prev.docs, { ...workings.ctx, financialYear: pfy }).g9;
      const next: AnnexuresDoc['a4'] = {
        c8: explicitTaxIn(g.t8.C),
        c10: explicitTaxIn(taxOf(g.t10)),
        c11: explicitTaxIn(taxOf(g.t11)),
        c12: explicitTaxIn(g.t12),
        c13: explicitTaxIn(g.t13),
      };
      const typed = (Object.keys(a4) as ClauseKey[]).some((k) => hasAmount(tin(a4[k])));
      if (typed) {
        const ok = await confirm({
          title: `Replace with the FY ${pfy} working?`,
          description: 'The clauses typed here will be overwritten with the figures from last year’s working in this app.',
          confirmText: 'Replace',
        });
        if (!ok) return;
      }
      update('annexures', (d) => ({ ...d, a4: next }));
      toast.success(`Filled clauses 8, 10, 11, 12 and 13 from the FY ${pfy} working.`);
    } catch (e) {
      toast.error('Could not load last year’s working: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Annexure-4 — Previous year's GSTR-9"
      description={`Clauses 8 (8C), 10, 11, 12 and 13 of the FY ${pfy} GSTR-9, as filed.`}
      excelRef="ANNEXURE B48:G55"
      actions={
        !readOnly && (
          <Button size="sm" variant="outline" onClick={fill} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <History className="mr-1 h-3.5 w-3.5" />}
            Fill from FY {pfy} working
          </Button>
        )
      }
    >
      <FixedTaxGrid rows={rows} label={`Annexure-4: FY ${pfy} GSTR-9 clauses`} readOnly={readOnly} labelHeader="Particular" labelWidth={300} />

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">Compare with this year</h4>
        <MatrixTable
          label="Clause 13 of the previous year next to 6A1 of this year"
          heads={['i', 'c', 's', 'x']}
          rows={[
            { key: 'c13', label: `Clause 13 of FY ${pfy} (above)`, value: tin(a4.c13) },
            { key: '6A1', label: `6A1 of FY ${financialYear} — ITC of a preceding FY availed this year`, value: workings.g9.t6.A1 },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Last year&apos;s clause 13 is the ITC availed this year for that year, so the two usually agree; 6A1 defaults to the
          Last Year Effect on the Duties &amp; Taxes step.
        </p>
      </div>
    </SectionCard>
  );
};

export default Annexure4;
