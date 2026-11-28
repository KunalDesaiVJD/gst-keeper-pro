import React, { useEffect, useMemo, useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MONTH_LABEL, tin } from '@/lib/gstr9/engine';
import { newId } from '@/lib/gstr9/defaults';
import { GST_RATES, hasRateLines, meaningfulLines, rateLinesTotal } from '@/lib/gstr9/rateWise';
import {
  BUILDER_RATE_CODES,
  BUILDER_RATE_SHORT,
  isBuilderRateCode,
  projectDefaultCode,
  receiptBreakup,
  type BuilderProjectRate,
} from '@/lib/gstr9/builderReceipts';
import type { DtRateLine, MonthKey, SupplyType, TaxIn } from '@/lib/gstr9/types';
import { type CellEdit, GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { lockSgst, moneyCol } from '../grid/columns';
import { fmtMoney, fmtRate } from '../grid/money';
import { autoTaxFor, setFormula, SUPPLY_OPTIONS, TAX_KEY } from '../sales/salesEntry';
import { Note } from '../ui';

// ---------------------------------------------------------------------------
// Entry aids for one rate line (tax from the rate, like the Sales step's lines)
// ---------------------------------------------------------------------------

const n0 = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

export const newRateLine = (rate: number | null = null, supplyType: SupplyType = 'intra'): DtRateLine => ({
  id: newId(),
  rate,
  supplyType,
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: null,
  cess: 0,
});

/** The line's IGST / CGST are blank, or exactly what its value × rate gives: only then is the tax refilled. */
const taxIsAuto = (l: DtRateLine): boolean => {
  if (!n0(l.igst) && !n0(l.cgst)) return true;
  const a = autoTaxFor(l);
  return !!a && near(n0(l.igst), a.igst) && near(n0(l.cgst), a.cgst);
};

/** After the value, rate or supply changed: refill the tax when it was blank or rate-computed (a typed figure is kept). */
const withAutoTax = (prev: DtRateLine, next: DtRateLine): DtRateLine => {
  if (!taxIsAuto(prev)) return next;
  const a = autoTaxFor(next);
  if (!a) return next;
  let out: DtRateLine = { ...next, igst: a.igst, cgst: a.cgst, sgst: null };
  out = setFormula(out, TAX_KEY.i, a.head === 'i' ? a.formula : undefined);
  out = setFormula(out, TAX_KEY.c, a.head === 'c' ? a.formula : undefined);
  return out;
};

/** Supply follows the heads that carry tax: IGST only → inter-state; CGST only → intra-state. */
const syncSupply = (l: DtRateLine): DtRateLine => {
  const i = n0(l.igst);
  const c = n0(l.cgst);
  const supplyType: SupplyType = i && !c ? 'inter' : c && !i ? 'intra' : l.supplyType;
  return supplyType === l.supplyType ? l : { ...l, supplyType };
};

/**
 * Builder clients: a line with a receipt and a type takes its rate, taxable value (2/3rd after the land
 * deduction) and tax from the receipt. Intra-state always (s.12(3)(a) IGST Act: the property's location).
 */
const fromReceipt = (l: DtRateLine): DtRateLine => {
  if (l.receipt === null || l.receipt === undefined || !isBuilderRateCode(l.rateCode)) return l;
  const b = receiptBreakup(l.receipt, l.rateCode);
  let out: DtRateLine = { ...l, rate: b.ratePct, supplyType: 'intra', taxable: b.taxable, igst: 0, cgst: 0, sgst: null };
  out = setFormula(out, 'rate', undefined);
  out = setFormula(out, 'taxable', undefined);
  const a = autoTaxFor(out);
  out = { ...out, igst: 0, cgst: a ? a.cgst : 0 };
  out = setFormula(out, TAX_KEY.i, undefined);
  return setFormula(out, TAX_KEY.c, a?.formula);
};

/** A rate or value typed by hand: the line no longer follows its receipt. */
const dropReceipt = (l: DtRateLine): DtRateLine => (l.receipt === null || l.receipt === undefined ? l : { ...l, receipt: null });

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface RateWiseSide {
  key: string;
  /** "Sales", "Credit note", "Purchase", "Debit note". */
  label: string;
  lines: DtRateLine[] | undefined;
  /** The group's figure as it stands (typed directly, or the lines' sum). */
  current: TaxIn;
}

interface Props {
  month: MonthKey | null;
  /** "Output tax" / "Input tax", for the title. */
  ledger: string;
  sides: RateWiseSide[];
  cess: boolean;
  readOnly: boolean;
  onClose: () => void;
  /** New lines per side; an empty list means "enter this group's books figure directly" (its figure stays as it is). */
  onApply: (lines: Record<string, DtRateLine[]>) => void;
  /** Builder clients (output side): the client's projects, to enter lines from receipts at the project's rate. */
  builderProjects?: BuilderProjectRate[] | null;
}

const HEADS: Array<['i' | 'c' | 's' | 'x', string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST'], ['x', 'Cess']];

/**
 * A month's rate-wise breakup: rate, supply and taxable value per line, the
 * tax filled from the rate (any figure can be typed over). Apply writes the
 * lines and their sum into the month's group; a group left with no lines keeps
 * its figure and is typed directly in the month grid again.
 */
const RateWiseDialog: React.FC<Props> = ({ month, ledger, sides, cess, readOnly, onClose, onApply, builderProjects }) => {
  const builder = !!builderProjects;
  const [active, setActive] = useState(sides[0]?.key ?? '');
  const [draft, setDraft] = useState<Record<string, DtRateLine[]>>({});

  // Fresh draft each time a month is opened.
  useEffect(() => {
    if (!month) return;
    setDraft(Object.fromEntries(sides.map((s) => [s.key, (s.lines ?? []).map((l) => ({ ...l }))])));
    setActive(sides.find((s) => hasRateLines(s.lines))?.key ?? sides[0]?.key ?? '');
    // Only when the month changes: the doc autosaving meanwhile must not wipe the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const side = sides.find((s) => s.key === active) ?? sides[0];
  const lines = draft[active] ?? [];
  const setLines = (next: DtRateLine[]) => setDraft((d) => ({ ...d, [active]: next }));
  const addRate = (rate: number) => setLines([...lines, newRateLine(rate)]);
  const addReceipt = () => {
    const only = builderProjects?.length === 1 ? builderProjects[0] : undefined;
    const code = projectDefaultCode(only);
    setLines([...lines, { ...newRateLine(null), receipt: null, rateCode: code, projectId: only?.id ?? null }]);
  };

  const columns = useMemo<GridColumn<DtRateLine>[]>(() => {
    const projOptions = (builderProjects ?? []).map((p) => ({ value: p.id, label: p.name }));
    const builderCols: GridColumn<DtRateLine>[] = builder
      ? [
          ...(projOptions.length
            ? [
                {
                  key: 'project',
                  header: 'Project',
                  type: 'select',
                  width: 140,
                  options: projOptions,
                  value: (r: DtRateLine) => r.projectId ?? null,
                  title: () => 'The builder project the receipt belongs to; its type follows the project’s units',
                  onEdit: (r: DtRateLine, e: CellEdit) => {
                    const p = builderProjects?.find((x) => x.id === e.text);
                    if (!p) return r;
                    return fromReceipt({ ...r, projectId: p.id, rateCode: projectDefaultCode(p) });
                  },
                } as GridColumn<DtRateLine>,
              ]
            : []),
          {
            key: 'rateCode',
            header: 'Type',
            type: 'select',
            width: 190,
            options: BUILDER_RATE_CODES.map((c) => ({ value: c, label: BUILDER_RATE_SHORT[c] })),
            value: (r) => (isBuilderRateCode(r.rateCode) ? r.rateCode : null),
            title: () => 'Notified rate on 2/3rd of the value (1/3rd deemed land, Notification 11/2017 para 2); the effective rate is on the whole amount',
            onEdit: (r, e) => (isBuilderRateCode(e.text) ? fromReceipt({ ...r, rateCode: e.text }) : r),
          },
          moneyCol<DtRateLine>('receipt', 'Receipts (incl. GST)', (r) => r.receipt ?? null, (r, v) => fromReceipt({ ...r, receipt: v }), {
            width: 140,
            nullable: true,
            title: () => 'Amount received, GST included: the taxable value (2/3rd after the land deduction) and tax are backed out at the type’s rate',
          }),
        ]
      : [];
    const cols: GridColumn<DtRateLine>[] = [
      ...builderCols,
      {
        key: 'rate',
        header: 'Rate %',
        type: 'percent',
        width: 80,
        value: (r) => r.rate,
        formula: (r) => r.f?.rate,
        title: () => 'GST rate in percent (18 = 18%). The tax is filled from it until a different figure is typed.',
        onEdit: (r, e) => setFormula(withAutoTax(r, dropReceipt({ ...r, rate: e.num })), 'rate', e.formula),
      },
      {
        key: 'supply',
        header: 'Supply',
        type: 'select',
        width: 112,
        options: SUPPLY_OPTIONS,
        value: (r) => r.supplyType,
        title: () => 'Inter-state → IGST, intra-state → CGST + SGST',
        onEdit: (r, e) => (e.text ? withAutoTax(r, { ...r, supplyType: e.text as SupplyType }) : r),
      },
      moneyCol<DtRateLine>('taxable', 'Taxable value', (r) => r.taxable, (r, v) => withAutoTax(r, dropReceipt({ ...r, taxable: v ?? 0 })), { width: 140 }),
      moneyCol<DtRateLine>(TAX_KEY.i, 'IGST', (r) => r.igst, (r, v) => syncSupply({ ...r, igst: v ?? 0 })),
      moneyCol<DtRateLine>(TAX_KEY.c, 'CGST', (r) => r.cgst, (r, v) => syncSupply({ ...r, cgst: v ?? 0, sgst: null })),
      lockSgst(moneyCol<DtRateLine>(TAX_KEY.s, 'SGST', (r) => r.sgst, (r) => r, { nullable: true, placeholder: (r) => r.cgst })),
    ];
    if (cess) cols.push(moneyCol<DtRateLine>(TAX_KEY.x, 'Cess', (r) => r.cess, (r, v) => ({ ...r, cess: v ?? 0 }), { width: 100 }));
    cols.push({
      key: 'implied',
      header: 'Check',
      type: 'display',
      width: 84,
      align: 'center',
      value: () => null,
      render: (r) => {
        const a = autoTaxFor(r);
        if (!a || (!n0(r.igst) && !n0(r.cgst))) return <span className="text-muted-foreground">—</span>;
        const ok = near(n0(r.igst), a.igst) && near(n0(r.cgst), a.cgst);
        return ok ? (
          <span className="text-[10px] text-success">At rate</span>
        ) : (
          <span className="text-[10px] font-medium text-warning" title={`${fmtRate(r.rate)} of the value gives ${fmtMoney(r.supplyType === 'inter' ? a.igst : a.cgst)}`}>
            Not at rate
          </span>
        );
      },
    });
    return cols;
  }, [cess, builder, builderProjects]);

  const total = rateLinesTotal(lines);
  const footer = useMemo<GridFooterRow[]>(
    () => [
      {
        key: 'total',
        label: 'Total',
        tone: 'total',
        cells: { taxable: total.t, [TAX_KEY.i]: total.i, [TAX_KEY.c]: total.c, [TAX_KEY.s]: total.s, ...(cess ? { [TAX_KEY.x]: total.x } : {}) },
      },
    ],
    [total, cess],
  );

  const cur = side ? tin(side.current) : { i: 0, c: 0, s: 0, x: 0 };
  const hadLines = side ? hasRateLines(side.lines) : false;
  const willHave = hasRateLines(lines);
  const changes = HEADS.filter(([h]) => (cess || h !== 'x') && !near(cur[h], total[h]));

  const apply = () => {
    onApply(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, meaningfulLines(v)])));
    onClose();
  };

  return (
    <Dialog open={!!month} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" aria-hidden />
            {month ? MONTH_LABEL[month] : ''} · {ledger} rate-wise
          </DialogTitle>
          <DialogDescription>
            Enter the month’s books figures rate by rate. The month’s {sides.map((s) => s.label.toLowerCase()).join(' and ')} become the totals
            of the lines below. Leave a side with no lines to type its books figure directly in the month grid.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div role="tablist" aria-label="Side" className="inline-flex rounded-md border bg-muted/40 p-0.5">
            {sides.map((s) => {
              const n = meaningfulLines(draft[s.key]).length;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  aria-selected={s.key === active}
                  onClick={() => setActive(s.key)}
                  className={cn(
                    'rounded px-3 py-1 text-xs font-medium transition-colors',
                    s.key === active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                  <span className="ml-1.5 opacity-80">{n ? `· ${n} line${n === 1 ? '' : 's'}` : '· direct'}</span>
                </button>
              );
            })}
          </div>

          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Add a line at</span>
              {GST_RATES.map((r) => (
                <Button key={r} type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => addRate(r)}>
                  <Plus className="mr-0.5 h-3 w-3" aria-hidden />
                  {fmtRate(r)}
                </Button>
              ))}
              {builder && (
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addReceipt}>
                  <Plus className="mr-0.5 h-3 w-3" aria-hidden />
                  From receipts
                </Button>
              )}
            </div>
          )}

          <SheetGrid<DtRateLine>
            label={`${side?.label ?? ''} rate-wise`}
            rows={lines}
            columns={columns}
            getRowId={(r) => r.id}
            onRowsChange={setLines}
            readOnly={readOnly}
            newRow={() => newRateLine()}
            canDelete
            addLabel="Add line"
            footer={footer}
            emptyText={`No rate lines — ${side?.label.toLowerCase() ?? 'this side'} is typed directly in the month grid.`}
            maxHeight="44vh"
          />

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="font-medium">{side?.label} for {month ? MONTH_LABEL[month] : ''}: </span>
            {willHave ? (
              changes.length ? (
                <span>
                  becomes the lines’ total —{' '}
                  {changes.map(([h, label]) => `${label} ${fmtMoney(cur[h])} → ${fmtMoney(total[h])}`).join(', ')}.
                </span>
              ) : (
                <span>the lines’ total equals the figure in the grid.</span>
              )
            ) : hadLines ? (
              <span>no lines — the figure stays as it is ({HEADS.filter(([h]) => cess || h !== 'x').map(([h, l]) => `${l} ${fmtMoney(cur[h])}`).join(', ')}) and is typed directly again.</span>
            ) : (
              <span>typed directly in the month grid.</span>
            )}
          </div>

          <Note tone="info">
            SGST follows CGST, as everywhere in the workings. Tax is value × rate (inter-state in IGST, intra-state half each in CGST and SGST)
            until a different figure is typed; “Not at rate” flags a line whose tax differs from its rate. You can paste rows copied from Excel
            (Rate, Supply, Taxable value, IGST, CGST …).
          </Note>
          {builder && (
            <Note tone="info">
              Builder: type the month’s receipts (GST included) and the project’s type. The consideration is the receipt less GST at the
              effective rate (1%, 5% or 12%); a third of it is deemed land and the rest is the taxable value, taxed at the notified rate
              (1.5%, 7.5% or 18%), as in the Builder module. Typing a rate or value by hand stops the line following its receipt.
            </Note>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {!readOnly && willHave && (
            <Button type="button" variant="ghost" className="mr-auto text-muted-foreground" onClick={() => setLines([])}>
              Enter {side?.label.toLowerCase()} directly instead
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="button" onClick={apply}>
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RateWiseDialog;

// ---------------------------------------------------------------------------
// Month-grid column
// ---------------------------------------------------------------------------

/**
 * The "Rates" cell of a month row: opens the month's rate-wise breakup. Shows
 * how many lines the month holds, or "Direct" when its figures are typed.
 */
export function rateWiseCol<R extends { id: MonthKey }>(lineCount: (r: R) => number, open: (m: MonthKey) => void): GridColumn<R> {
  return {
    key: 'rates',
    header: 'Rate-wise',
    type: 'display',
    width: 92,
    align: 'center',
    value: (r) => lineCount(r) || null,
    title: (r) =>
      lineCount(r)
        ? 'Books figures of this month come from its rate-wise breakup — click to see or change it'
        : 'Books figures typed directly — click to enter them rate by rate instead',
    activate: (r) => open(r.id),
    render: (r) => {
      const n = lineCount(r);
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open(r.id);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
            n ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Layers className="h-3 w-3" aria-hidden />
          {n ? `${n} rate${n === 1 ? '' : 's'}` : 'Direct'}
        </button>
      );
    },
  };
}
