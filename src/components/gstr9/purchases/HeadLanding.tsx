import React, { useMemo } from 'react';
import { ArrowRight, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EXPENSE_HEAD_LABEL, EXPENSE_HEAD_ROW, maxAbs, resolveHead, totalTax, type StepKey } from '@/lib/gstr9/engine';
import type { ExpenseHead, ValTax } from '@/lib/gstr9/types';
import { Money, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { suggestHead } from './purchaseRows';

const HEADS = Object.keys(EXPENSE_HEAD_LABEL) as ExpenseHead[];

/**
 * "Where each ledger lands": how many PL-INPUT ledgers feed each GSTR-9C
 * Table 14 row (the firm's GSTR 9C sheet), with the engine's figures.
 */
export const HeadLanding: React.FC<{ onGo: (step: StepKey) => void }> = ({ onGo }) => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const rows = docs.purchases.rows;
  const c14 = workings.c14;

  const counts = useMemo(() => {
    const out = Object.fromEntries(HEADS.map((h) => [h, 0])) as Record<ExpenseHead, number>;
    rows.forEach((r) => {
      const h = workings.purchases.rows[r.id]?.head ?? resolveHead(r);
      out[h] += 1;
    });
    return out;
  }, [rows, workings.purchases.rows]);

  const { expenseRows, untagged, suggestions } = useMemo(() => {
    const expense = rows.filter((r) => r.section === 'expense');
    const open = expense.filter((r) => r.head === null);
    const sugg = open
      .map((r) => ({ id: r.id, head: suggestHead(r.ledger) }))
      .filter((s): s is { id: string; head: ExpenseHead } => !!s.head);
    return { expenseRows: expense, untagged: open, suggestions: sugg };
  }, [rows]);

  // Figures per head come from the engine's 9C working: A and B–O are the head totals, Q shows the tagged ledgers only.
  const figure = (h: ExpenseHead): ValTax => (h === 'other2' ? c14.qTagged : c14.rows[EXPENSE_HEAD_ROW[h]]);
  const landed = HEADS.filter((h) => counts[h] > 0);
  const showBalancing = maxAbs(c14.qBalancing, true) > 0.005;

  const applySuggestions = () => {
    const map = new Map(suggestions.map((s) => [s.id, s.head]));
    update('purchases', (d) => ({ ...d, rows: d.rows.map((r) => (r.head === null && map.has(r.id) ? { ...r, head: map.get(r.id)! } : r)) }));
    toast.success(`Tagged ${map.size} expense ledger${map.size === 1 ? '' : 's'} from their names — check them in grid (B).`, {
      action: {
        label: 'Undo',
        onClick: () =>
          update('purchases', (d) => ({ ...d, rows: d.rows.map((r) => (map.has(r.id) && r.head === map.get(r.id) ? { ...r, head: null } : r)) })),
      },
    });
  };

  return (
    <SectionCard
      title="Where each ledger lands"
      description="The 9C expense head of every ledger in (A)–(C), as it feeds GSTR-9C Table 14."
      excelRef="GSTR 9C rows 8–28"
      actions={
        <>
          {!readOnly && suggestions.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={applySuggestions}>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Suggest heads for {suggestions.length} untagged
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => onGo('expense')}>
            9C expense heads <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </>
      }
    >
      {landed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ledgers entered yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full border-collapse text-xs" aria-label="Ledgers per GSTR-9C expense head">
            <thead className="bg-muted">
              <tr>
                <th className="w-12 border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">Row</th>
                <th className="border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">9C expense head</th>
                <th className="w-20 border-b border-r px-2 py-1.5 text-right font-semibold text-muted-foreground">Ledgers</th>
                <th className="w-36 border-b border-r px-2 py-1.5 text-right font-semibold text-muted-foreground">Value</th>
                <th className="w-36 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">ITC (all heads)</th>
              </tr>
            </thead>
            <tbody>
              {landed.map((h) => {
                const v = figure(h);
                return (
                  <tr key={h}>
                    <td className="border-b border-r px-2 py-1.5 font-mono text-muted-foreground">{EXPENSE_HEAD_ROW[h]}</td>
                    <td className="border-b border-r px-2 py-1.5">{EXPENSE_HEAD_LABEL[h].replace(/^[A-Z] · /, '')}</td>
                    <td className="border-b border-r px-2 py-1.5 text-right tabular-nums">{counts[h]}</td>
                    <td className="border-b border-r px-2 py-1.5 text-right"><Money value={v.t} /></td>
                    <td className="border-b px-2 py-1.5 text-right"><Money value={totalTax(v)} /></td>
                  </tr>
                );
              })}
              {showBalancing && (
                <tr className="text-muted-foreground">
                  <td className="border-b border-r px-2 py-1.5 font-mono">Q</td>
                  <td className="border-b border-r px-2 py-1.5 italic" title="The sheet’s Q (D26) is net ITC less rows A2 to P, so anything not in a tagged ledger lands here too.">
                    Balancing figure (net ITC − rows A2 to P)
                  </td>
                  <td className="border-b border-r px-2 py-1.5 text-right">—</td>
                  <td className="border-b border-r px-2 py-1.5 text-right"><Money value={c14.qBalancing.t} /></td>
                  <td className="border-b px-2 py-1.5 text-right"><Money value={totalTax(c14.qBalancing)} /></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Note tone={untagged.length > 0 ? 'warn' : 'info'}>
        {expenseRows.length > 0 && (
          <span className="font-medium">
            {untagged.length === 0
              ? 'Every expense ledger is tagged. '
              : `${untagged.length} of ${expenseRows.length} expense ledger${expenseRows.length === 1 ? '' : 's'} ${untagged.length === 1 ? 'is' : 'are'} untagged. `}
          </span>
        )}
        Untagged expense ledgers fall into Q “Any other expense 2”, as in the sheet (where Q is the balancing row). Tagging them to E–N —
        rent &amp; insurance, bank charges, stationery, repair &amp; maintenance… — gives a truer GSTR-9C Table 14. The head also sets the
        GSTR-9 Table 6 split: A → inputs, O → capital goods, D → imports (6E); every other head counts as input services.
      </Note>
    </SectionCard>
  );
};

export default HeadLanding;
