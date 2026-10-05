import React, { useState } from 'react';
import { CopyPlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { newId } from '@/lib/gstr9/defaults';
import { loadPreviousYear } from '@/lib/gstr9/store';
import { FY_MONTHS, type MonthKey, type RcmCell } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';

const prevFY = (fy: string): string => {
  const start = Number(fy.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

const zeroMonths = (): Record<MonthKey, RcmCell> =>
  Object.fromEntries(FY_MONTHS.map((m) => [m, { taxable: 0 }])) as Record<MonthKey, RcmCell>;

/**
 * "Start from last year": copies the previous FY's ledger lists (names and
 * tags, never amounts) into an empty working. Shown only while Sales,
 * Purchases and RCM are all empty.
 */
export const CarryForwardCard: React.FC = () => {
  const { client, financialYear, docs, readOnly, update } = useWorkspace();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const empty = !docs.sales.partA.length && !docs.sales.partB.length && !docs.purchases.rows.length && !docs.rcm.categories.length;
  if (!empty || readOnly) return null;
  const prev = prevFY(financialYear);

  const run = async () => {
    setBusy(true);
    try {
      const ws = await loadPreviousYear(client.id, financialYear);
      if (!ws) {
        toast.info(`No working is saved for FY ${prev}. Start by entering the ledgers in Sales and Purchases.`);
        return;
      }
      const p = ws.docs;
      const n = { a: p.sales.partA.length, b: p.sales.partB.length, pr: p.purchases.rows.length, rcm: p.rcm.categories.length };
      if (!n.a && !n.b && !n.pr && !n.rcm) {
        toast.info(`The FY ${prev} working has no ledgers to copy.`);
        return;
      }
      const ok = await confirm({
        title: `Copy the ledger list from FY ${prev}?`,
        description: `${n.a} taxable and ${n.b} non-taxable income ledgers, ${n.pr} purchase / expense / capital-goods ledgers and ${n.rcm} RCM categor${n.rcm === 1 ? 'y' : 'ies'} will be added with their tags (Table 4 category, bifurcation, rate, supply type, 9C expense head, ITC table). Every amount starts at zero. Nothing in FY ${prev} changes.`,
        confirmText: 'Copy ledgers',
      });
      if (!ok) return;

      // Only fill a sheet that is still empty — someone may have started typing meanwhile.
      update('sales', (d) =>
        d.partA.length || d.partB.length
          ? d
          : {
              ...d,
              partA: p.sales.partA.map((r) => ({
                id: newId(), ledger: r.ledger, category: r.category, supplyType: r.supplyType, rate: r.rate,
                taxable: 0, igst: 0, cgst: 0, sgst: null, cess: 0,
              })),
              partB: p.sales.partB.map((r) => ({ id: newId(), ledger: r.ledger, nature: r.nature, amount: 0 })),
            },
        { action: `Copied the ledger list from FY ${prev}` },
      );
      update('purchases', (d) =>
        d.rows.length
          ? d
          : {
              ...d,
              rows: p.purchases.rows.map((r) => ({
                id: newId(), section: r.section, ledger: r.ledger, supplyType: r.supplyType, rate: r.rate, head: r.head,
                taxable: 0, igst: 0, cgst: 0, sgst: null, cess: 0,
              })),
            },
        { action: `Copied the ledger list from FY ${prev}` },
      );
      update('rcm', (d) =>
        d.categories.length
          ? d
          : {
              ...d,
              categories: p.rcm.categories.map((c) => ({
                id: newId(), name: c.name, rate: c.rate, supplyType: c.supplyType, itcTable: c.itcTable, months: zeroMonths(),
              })),
            },
        { action: `Copied the ledger list from FY ${prev}` },
      );
      toast.success(`Copied ${n.a + n.b + n.pr} ledgers and ${n.rcm} RCM categor${n.rcm === 1 ? 'y' : 'ies'} from FY ${prev}. Enter this year’s amounts.`);
    } catch (e) {
      toast.error(`Could not read FY ${prev}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="min-w-0 flex-1 text-xs">
        <span className="text-[13px] font-semibold">Start from last year</span>
        <span className="text-muted-foreground"> — copy FY {prev}’s ledger list (names and tags only, every amount at zero) so the team only types this year’s figures.</span>
      </div>
      <Button size="sm" className="h-7" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CopyPlus className="mr-1 h-3.5 w-3.5" />}
        Copy ledgers from FY {prev}
      </Button>
    </div>
  );
};

export default CarryForwardCard;
