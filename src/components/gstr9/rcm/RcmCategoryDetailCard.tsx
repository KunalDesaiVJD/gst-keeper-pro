import React from 'react';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { num, rcmCellTax, totalTax } from '@/lib/gstr9/engine';
import { FY_MONTHS, type Formulas, type MonthKey, type RcmCategory, type RcmCell } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { fmtMoney, fmtRate } from '../grid/money';
import { Money, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import {
  categoryName,
  cellOf,
  isTyped,
  monthLabel,
  TAX_HEAD_LABEL,
  TAX_HEADS,
  type TaxHead,
  typedMonthCount,
} from './rcmShared';

/** A month of one expense block: the stored cell plus its month key. */
type DetailRow = RcmCell & { id: MonthKey };

const stripId = ({ id: _id, ...cell }: DetailRow): RcmCell => cell;

/** The cell with every typed tax head cleared (and its remembered expression dropped). */
const withComputedTax = (cell: RcmCell): RcmCell => {
  const next: RcmCell = { taxable: num(cell.taxable) };
  if (cell.f?.taxable) next.f = { taxable: cell.f.taxable } as Formulas;
  return next;
};

const CategoryBlock: React.FC<{ cat: RcmCategory }> = ({ cat }) => {
  const { workings, update, readOnly, financialYear } = useWorkspace();
  const total = workings.rcm.categories[cat.id]?.total;
  const typedMonths = typedMonthCount(cat);
  const rate = num(cat.rate);

  const rows: DetailRow[] = FY_MONTHS.map((m) => ({ ...cellOf(cat, m), id: m }));

  const writeCat = (fn: (c: RcmCategory) => RcmCategory) =>
    update('rcm', (d) => ({ ...d, categories: d.categories.map((c) => (c.id === cat.id ? fn(c) : c)) }));

  const onRowsChange = (next: DetailRow[]) =>
    writeCat((c) => ({ ...c, months: { ...(c.months ?? {}), ...Object.fromEntries(next.map((r) => [r.id, stripId(r)])) } as Record<MonthKey, RcmCell> }));

  const resetTyped = () => {
    const before = cat;
    writeCat((c) => ({
      ...c,
      months: Object.fromEntries(FY_MONTHS.map((m) => [m, withComputedTax(cellOf(c, m))])) as Record<MonthKey, RcmCell>,
    }));
    toast(`${categoryName(cat)}: tax set back to the computed figures.`, {
      action: { label: 'Undo', onClick: () => writeCat(() => before) },
    });
  };

  /** Tax at the category rate with nothing typed — what a cleared cell goes back to. */
  const pure = (r: DetailRow) => rcmCellTax(cat, { taxable: num(r.taxable) });

  const taxCol = (h: TaxHead) =>
    moneyCol<DetailRow>(h, TAX_HEAD_LABEL[h], (r) => r[h] ?? null, (r, v) => ({ ...r, [h]: v }), {
      group: 'Tax — computed unless typed',
      width: h === 'x' ? 96 : 118,
      nullable: true,
      // The engine's figure (the sheet's =D52*2.5% / =+F52), muted while nothing is typed.
      placeholder: (r) => {
        const v = rcmCellTax(cat, r)[h];
        return Math.abs(v) < 0.005 && !num(r.taxable) ? null : v;
      },
      tone: (r) => (isTyped(r, h) && Math.abs(num(r[h]) - pure(r)[h]) > 0.005 ? 'warn' : undefined),
      title: (r) => {
        if (isTyped(r, h)) {
          return `Typed. At ${fmtRate(rate)} it would be ${fmtMoney(pure(r)[h])} — clear the cell to use the computed figure.`;
        }
        if (h === 's') return 'Mirrors CGST (the sheet’s =+F) — type to override.';
        return `Computed at ${fmtRate(rate)} — type to override.`;
      },
    });

  const columns: GridColumn<DetailRow>[] = [
    { key: 'month', header: 'Month', type: 'display', align: 'left', sticky: true, width: 92, value: (r) => monthLabel(r.id, financialYear) },
    moneyCol<DetailRow>('taxable', 'Taxable', (r) => num(r.taxable) || null, (r, v) => ({ ...r, taxable: v ?? 0 }), { width: 130 }),
    ...TAX_HEADS.map(taxCol),
  ];

  return (
    <AccordionItem value={cat.id} className="last:border-b-0">
      <AccordionTrigger className="gap-3 py-3 text-sm hover:no-underline">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left">
          <span className="font-medium">{categoryName(cat)}</span>
          <Badge variant="outline" className="text-[10px] font-normal">{fmtRate(rate)} · {cat.supplyType === 'inter' ? 'IGST' : 'CGST + SGST'}</Badge>
          <Badge variant="outline" className="text-[10px] font-normal">GSTR-9 {cat.itcTable || '6C'}</Badge>
          {typedMonths > 0 && (
            <Badge variant="warning" className="text-[10px] font-normal">
              Tax typed in {typedMonths} month{typedMonths === 1 ? '' : 's'}
            </Badge>
          )}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          Taxable <Money value={total?.t ?? 0} className="font-medium text-foreground" /> · Tax{' '}
          <Money value={total ? totalTax(total) : 0} className="font-medium text-foreground" />
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-2">
        <SheetGrid<DetailRow>
          label={`${categoryName(cat)} — month-wise RCM`}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.id}
          onRowsChange={onRowsChange}
          readOnly={readOnly}
          footer={[
            {
              key: 'total',
              label: 'Total',
              tone: 'total',
              cells: { taxable: total?.t ?? 0, i: total?.i ?? 0, c: total?.c ?? 0, s: total?.s ?? 0, x: total?.x ?? 0 },
            },
          ]}
        />
        {!readOnly && typedMonths > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={resetTyped}>
            <RotateCcw className="h-3.5 w-3.5" /> Use computed tax for every month
          </Button>
        )}
      </AccordionContent>
    </AccordionItem>
  );
};

/**
 * Each RCM expense as its own block, like the sheet (TAXABLE / IGST / CGST /
 * SGST by month): the tax shows the computed figure in italics until staff
 * type over it.
 */
const RcmCategoryDetailCard: React.FC = () => {
  const { docs } = useWorkspace();
  const cats = docs.rcm.categories;
  if (!cats.length) return null;
  return (
    <SectionCard
      title="Tax by expense"
      description="Open an expense to see or override its tax month by month. Italic figures are computed from the rate; typing replaces them and clearing a cell brings the computed figure back."
      excelRef="RCM rows 50–123 (one block per expense)"
    >
      <Accordion type="multiple" className="rounded-md border px-3">
        {cats.map((c) => (
          <CategoryBlock key={c.id} cat={c} />
        ))}
      </Accordion>
    </SectionCard>
  );
};

export default RcmCategoryDetailCard;
