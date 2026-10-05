import React, { useState } from 'react';
import { Copy, Loader2, Rows3 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { num, STANDARD_RATES, totalTax } from '@/lib/gstr9/engine';
import { loadPreviousYear } from '@/lib/gstr9/store';
import type { RcmCategory, RcmItcTable, SupplyType } from '@/lib/gstr9/types';
import { SheetGrid, type CellTone, type GridColumn } from '../grid/SheetGrid';
import { displayCol } from '../grid/columns';
import { fmtRate } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { ITC_TABLE_OPTIONS, newRcmCategory, previousFY, SHEET_BLOCKS, SUPPLY_OPTIONS } from './rcmShared';

const rateTone = (rate: number): CellTone => (num(rate) <= 0 || !STANDARD_RATES.includes(num(rate)) ? 'warn' : undefined);
const rateTitle = (rate: number): string => {
  const r = num(rate);
  if (r <= 0) return 'No rate — no tax will be computed for this expense.';
  if (!STANDARD_RATES.includes(r)) return `${fmtRate(r)} is not a GST rate in force — check it (it will fall in 9C Table 9 "other rates").`;
  return `Total rate — intra-state it is split ${fmtRate(r / 2)} CGST + ${fmtRate(r / 2)} SGST.`;
};

/**
 * The RCM expense categories — one per expense block of the sheet
 * (TRANSPORTATION EXP, DELIVERY EXP, OFFICE RENT EXPENSE, ADVOCATE FEES …).
 */
const RcmCategoriesCard: React.FC = () => {
  const { docs, workings, update, readOnly, client, financialYear } = useWorkspace();
  const cats = docs.rcm.categories;
  const [copying, setCopying] = useState(false);
  const prevFy = previousFY(financialYear);

  const setCats = (rows: RcmCategory[]) => update('rcm', (d) => ({ ...d, categories: rows }));

  const seed = (list: Array<Pick<RcmCategory, 'name' | 'rate' | 'supplyType' | 'itcTable'>>) =>
    update('rcm', (d) => (d.categories.length ? d : { ...d, categories: list.map((c) => newRcmCategory(c)) }));

  const copyPrevious = async () => {
    setCopying(true);
    try {
      const prev = await loadPreviousYear(client.id, financialYear);
      const list = prev?.docs.rcm.categories ?? [];
      if (!list.length) {
        toast.info(`No RCM expenses were saved for FY ${prevFy}.`);
        return;
      }
      seed(
        list.map((c) => ({
          name: c.name ?? '',
          rate: num(c.rate),
          supplyType: c.supplyType === 'inter' ? 'inter' : 'intra',
          itcTable: c.itcTable === '6D' || c.itcTable === '6F' ? c.itcTable : '6C',
        })),
      );
      toast.success(`Copied ${list.length} RCM expense${list.length === 1 ? '' : 's'} from FY ${prevFy}. Months are empty.`);
    } catch (e) {
      toast.error('Could not load the previous year: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCopying(false);
    }
  };

  const columns: GridColumn<RcmCategory>[] = [
    {
      key: 'name',
      header: 'RCM expense (ledger)',
      type: 'text',
      width: 240,
      sticky: true,
      value: (r) => r.name,
      onEdit: (r, e) => ({ ...r, name: e.text }),
    },
    {
      key: 'supply',
      header: 'Supply',
      type: 'select',
      width: 190,
      options: SUPPLY_OPTIONS,
      value: (r) => r.supplyType || 'intra',
      onEdit: (r, e) => ({ ...r, supplyType: (e.text || 'intra') as SupplyType }),
    },
    {
      key: 'table',
      header: 'GSTR-9 table',
      type: 'select',
      width: 210,
      options: ITC_TABLE_OPTIONS,
      value: (r) => r.itcTable || '6C',
      onEdit: (r, e) => ({ ...r, itcTable: (e.text || '6C') as RcmItcTable }),
    },
    displayCol<RcmCategory>('taxable', 'Taxable (year)', (r) => workings.rcm.categories[r.id]?.total.t ?? 0, { width: 130 }),
    {
      key: 'rate',
      header: 'Rate %',
      type: 'percent',
      width: 80,
      value: (r) => num(r.rate),
      onEdit: (r, e) => ({ ...r, rate: e.num ?? 0 }),
      tone: (r) => rateTone(r.rate),
      title: (r) => rateTitle(r.rate),
    },
    displayCol<RcmCategory>('tax', 'Tax (year)', (r) => {
      const t = workings.rcm.categories[r.id]?.total;
      return t ? totalTax(t) : 0;
    }, { width: 120 }),
  ];

  const empty = readOnly ? (
    'No RCM expenses were entered for this year.'
  ) : (
    <div className="space-y-3">
      <div>No RCM expenses yet. Add one per reverse-charge expense ledger, or start from:</div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={copyPrevious} disabled={copying}>
          {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
          Copy expenses from FY {prevFy}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => seed(SHEET_BLOCKS)}>
          <Rows3 className="h-3.5 w-3.5" /> The sheet’s four blocks
        </Button>
      </div>
    </div>
  );

  return (
    <SectionCard
      title="RCM expenses"
      description="One row per reverse-charge expense. The rate drives the tax (the sheet’s =D52*2.5%); the table decides where the ITC is reported in GSTR-9."
      excelRef="RCM rows 48 / 67 / 86 / 105 (expense blocks)"
    >
      <SheetGrid<RcmCategory>
        label="RCM expense categories"
        rows={cats}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={setCats}
        readOnly={readOnly}
        newRow={() => newRcmCategory()}
        canDelete
        addLabel="Add RCM expense"
        // Rate is shown after the taxable value; a block copied from the firm's list still pastes as name, rate, supply, table.
        pasteOrder={['name', 'rate', 'supply', 'table']}
        emptyText={empty}
        footer={
          cats.length
            ? [{ key: 'total', label: 'Total (Part B)', tone: 'total', cells: { taxable: workings.rcm.partB.t, tax: totalTax(workings.rcm.partB) } }]
            : undefined
        }
      />
      <Note tone="position">
        All RCM ITC is reported in <strong>6C</strong> (unregistered supplier, input services), as the sheet does, unless an expense is
        set to 6D (registered supplier) or 6F (import of services).
      </Note>
    </SectionCard>
  );
};

export default RcmCategoriesCard;
