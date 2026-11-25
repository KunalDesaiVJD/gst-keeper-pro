import React from 'react';
import { History } from 'lucide-react';
import { tin } from '@/lib/gstr9/engine';
import { KIND_META, amountText, totalsByKind } from '@/lib/gstr9/remarkEffects';
import { useWorkspace } from '../WorkspaceContext';
import { SectionCard } from '../ui';
import { useGoToStep } from '../overview/steps';
import { Button } from '@/components/ui/button';
import { useCarriedEffects } from './useRemarkEffects';

const CLAUSE = { next_fy_t10: 'c10', next_fy_t11: 'c11', next_fy_t12: 'c12', next_fy_t13: 'c13' } as const;

/**
 * The FY after: what the previous FY's remarks gave effect to in this FY's
 * returns (its applied Tables 10 to 13), where each goes in this FY's
 * GSTR-9, and how Annexure-4 compares. Shown only when there is something.
 */
export const CarriedEffectsCard: React.FC<{ showGoTo?: boolean }> = ({ showGoTo }) => {
  const { docs, workings } = useWorkspace();
  const { carried, prevFy } = useCarriedEffects();
  const go = useGoToStep();
  if (!carried.length) return null;
  const totals = totalsByKind(carried);
  const a4 = docs.annexures.a4;

  return (
    <SectionCard
      title={`Effects carried from FY ${prevFy} remarks`}
      description={`Reasons recorded in FY ${prevFy} said these were given effect in this year's returns. They were reported in FY ${prevFy} GSTR-9 Part V; here they explain this year's differences and stay out of this year's own tables.`}
      actions={showGoTo && (
        <Button size="sm" variant="outline" onClick={() => go('annexures')}><History className="mr-1 h-3.5 w-3.5" />Annexure-4</Button>
      )}
    >
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[760px] border-collapse text-sm" aria-label={`Effects carried from FY ${prevFy}`}>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="border-b px-2 py-1.5 text-left font-semibold">FY {prevFy} line and remark</th>
              <th className="w-28 border-b px-2 py-1.5 text-left font-semibold">FY {prevFy} table</th>
              <th className="w-56 border-b px-2 py-1.5 text-right font-semibold">Amount</th>
              <th className="border-b px-2 py-1.5 text-left font-semibold">Effect in this FY</th>
            </tr>
          </thead>
          <tbody>
            {carried.map((c) => (
              <tr key={c.lineKey} className="align-top">
                <td className="border-b px-2 py-1.5">
                  <div className="font-medium">{c.lineLabel}</div>
                  {c.remark && <div className="whitespace-pre-wrap text-[11px] text-muted-foreground">{c.remark}</div>}
                </td>
                <td className="border-b px-2 py-1.5">{KIND_META[c.kind].short}</td>
                <td className="border-b px-2 py-1.5 text-right tabular-nums">{amountText(c.amount, KIND_META[c.kind].withTaxable)}</td>
                <td className="border-b px-2 py-1.5 text-[12px]">{c.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-0.5 text-[12px] text-muted-foreground">
        {(Object.keys(CLAUSE) as Array<keyof typeof CLAUSE>).filter((k) => totals[k]).map((k) => {
          const t = totals[k]!;
          const a = tin(a4[CLAUSE[k]]);
          const diff = Math.abs(a.i - t.i) + Math.abs(a.c - t.c) + Math.abs(a.x - t.x);
          return (
            <li key={k}>
              {KIND_META[k].short} from remarks: {amountText(t, false)}; Annexure-4 clause {CLAUSE[k].slice(1)} holds {amountText({ t: 0, ...a }, false)}
              {diff > 1 ? ' — fill Annexure-4 from last year\'s working, or check what else the clause holds.' : '.'}
              {k === 'next_fy_t13' && ` 6A1 of this year is ${amountText({ t: 0, ...workings.g9.t6.A1 }, false)}.`}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
};

export default CarriedEffectsCard;
