import React, { useCallback, useMemo } from 'react';
import { AlertTriangle, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { OutwardCategory, SalesRow, SupplyType } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { Note, SectionCard } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { moneyCol, taxFooter } from '../grid/columns';
import { fmtRate } from '../grid/money';
import {
  CATEGORY_OPTIONS,
  fillTaxFromRate,
  newSalesRow,
  setFormula,
  SUPPLY_OPTIONS,
  syncSupply,
  TAX_KEY,
  withAutoTax,
} from './salesEntry';

/** PL-OUTPUT Part A — taxable income, one row per ledger (returns as separate negative rows). */
const PartAGrid: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const rows = docs.sales.partA;
  const calc = workings.sales.rows;
  const partA = workings.sales.partA;

  const setRows = useCallback((next: SalesRow[]) => update('sales', (d) => ({ ...d, partA: next })), [update]);

  const columns = useMemo<GridColumn<SalesRow>[]>(() => {
    const ledger: GridColumn<SalesRow> = {
      key: 'ledger',
      header: 'Ledger',
      type: 'text',
      width: 230,
      sticky: true,
      align: 'left',
      value: (r) => r.ledger,
      onEdit: (r, e) => ({ ...r, ledger: e.text }),
    };

    const taxable = moneyCol<SalesRow>('taxable', 'Taxable value', (r) => r.taxable, (r, v) => withAutoTax(r, { ...r, taxable: v ?? 0 }), {
      width: 136,
    });
    const igst = moneyCol<SalesRow>(TAX_KEY.i, 'IGST', (r) => r.igst, (r, v) => syncSupply({ ...r, igst: v ?? 0 }));
    const cgst = moneyCol<SalesRow>(TAX_KEY.c, 'CGST', (r) => r.cgst, (r, v) => syncSupply({ ...r, cgst: v ?? 0 }));
    const sgstBase = moneyCol<SalesRow>(TAX_KEY.s, 'SGST', (r) => r.sgst, (r, v) => syncSupply({ ...r, sgst: v }), {
      nullable: true,
      placeholder: (r) => r.cgst,
      title: (r) => (r.sgst === null || r.sgst === undefined ? 'Mirrors CGST — type to override, clear to mirror again' : undefined),
    });
    // A pasted/typed SGST equal to CGST goes back to mirroring (the sheet's `=F` cell),
    // so pasting the sheet's SGST + CGST pair keeps them linked.
    const sgst: GridColumn<SalesRow> = {
      ...sgstBase,
      onEdit: (r, e) => {
        const out = sgstBase.onEdit!(r, e);
        if (!e.formula && out.sgst !== null && out.sgst !== undefined && Math.abs(out.sgst - out.cgst) < 0.005) {
          return setFormula({ ...out, sgst: null }, TAX_KEY.s, undefined);
        }
        return out;
      },
    };
    const rate: GridColumn<SalesRow> = {
      key: 'rate',
      header: 'Rate %',
      type: 'percent',
      width: 76,
      value: (r) => r.rate,
      formula: (r) => r.f?.rate,
      title: () => 'GST rate in percent (18 = 18%). Blank tax is filled from it, like the sheet’s =D*18% cells.',
      onEdit: (r, e) => setFormula(withAutoTax(r, { ...r, rate: e.num }), 'rate', e.formula),
    };
    const cess = moneyCol<SalesRow>(TAX_KEY.x, 'Cess', (r) => r.cess, (r, v) => ({ ...r, cess: v ?? 0 }), { width: 96 });
    const supply: GridColumn<SalesRow> = {
      key: 'supply',
      header: 'Supply',
      type: 'select',
      width: 104,
      options: SUPPLY_OPTIONS,
      value: (r) => r.supplyType,
      title: () => 'Inter-state → IGST, intra-state → CGST + SGST. Set automatically from the tax you enter.',
      onEdit: (r, e) => (e.text ? withAutoTax(r, { ...r, supplyType: e.text as SupplyType }) : r),
    };
    const category: GridColumn<SalesRow> = {
      key: 'category',
      header: 'GSTR-9 bucket',
      type: 'select',
      width: 164,
      options: CATEGORY_OPTIONS,
      value: (r) => r.category,
      tone: (r) => (calc[r.id]?.isReturn ? 'muted' : undefined),
      title: (r) => (calc[r.id]?.isReturn ? 'A return is reported in 4I (credit notes) whatever the bucket.' : 'GSTR-9 Table 4 row this ledger is reported in'),
      onEdit: (r, e) => (e.text ? { ...r, category: e.text as OutwardCategory } : r),
    };
    const implied: GridColumn<SalesRow> = {
      key: 'implied',
      header: 'Implied rate',
      type: 'display',
      width: 96,
      align: 'right',
      value: (r) => calc[r.id]?.impliedRate ?? null,
      tone: (r) => (calc[r.id]?.rateMismatch ? 'warn' : undefined),
      title: (r) => {
        const c = calc[r.id];
        if (!c || c.impliedRate === null) return 'No taxable value, so no implied rate';
        if (c.rateMismatch) return `Tax ÷ value gives ${fmtRate(c.impliedRate)}, but the rate entered is ${fmtRate(r.rate)}. Check the tax or the rate.`;
        return '(IGST + CGST + SGST) × 100 ÷ taxable value — the sheet’s column H';
      },
      render: (r) => {
        const c = calc[r.id];
        if (!c || c.impliedRate === null) return <span className="text-muted-foreground">—</span>;
        if (!c.rateMismatch) return <span>{fmtRate(c.impliedRate)}</span>;
        return (
          <span className="inline-flex items-center gap-1 font-semibold text-foreground">
            <AlertTriangle className="h-3 w-3 text-warning" aria-hidden />
            {fmtRate(c.impliedRate)}
          </span>
        );
      },
    };
    const kind: GridColumn<SalesRow> = {
      key: 'kind',
      header: 'Type',
      type: 'display',
      width: 100,
      align: 'left',
      value: (r) => (calc[r.id]?.isReturn ? 'Return' : 'Sales'),
      title: (r) => (calc[r.id]?.isReturn ? 'Negative value: a sales return, reported as a credit note in GSTR-9 Table 4I' : undefined),
      render: (r) =>
        calc[r.id]?.isReturn ? (
          <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">Return → 4I</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">Sales</span>
        ),
    };
    // Editable columns follow the firm's sheet (Particulars, Amount, IGST, SGST/CGST, Rate) so a copied block
    // pastes straight in; display columns are skipped by paste, so the implied-rate check can sit next to Rate.
    return [ledger, taxable, igst, cgst, sgst, rate, implied, cess, supply, category, kind];
  }, [calc]);

  // One footer row only: with two rows in the sticky tfoot of a scrolled grid, body text shows between them.
  const footer = useMemo<GridFooterRow[]>(
    () => [{ key: 'total', label: 'Total income — Part A', tone: 'total', cells: { taxable: partA.t, ...taxFooter('tax', partA, true) } }],
    [partA],
  );

  const mismatches = useMemo(() => rows.filter((r) => calc[r.id]?.rateMismatch).length, [rows, calc]);

  const onFill = () => {
    const { rows: next, changed } = fillTaxFromRate(rows);
    if (!changed) {
      toast.info('No ledger with a rate has blank tax — nothing to fill.');
      return;
    }
    setRows(next);
    toast.success(`Filled tax from the rate on ${changed} ledger${changed === 1 ? '' : 's'}.`);
  };

  return (
    <SectionCard
      title="Part A — Taxable income"
      description="Every taxable sales / service ledger, including exports, SEZ supplies and deemed exports on payment of tax."
      excelRef="PL-OUTPUT rows 8–35"
      actions={
        !readOnly && rows.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={onFill}>
            <Calculator className="mr-1 h-3.5 w-3.5" /> Fill tax from rate
          </Button>
        ) : undefined
      }
    >
      <Note tone="info">
        Show each ledger’s sales return in a <span className="font-medium">separate row with a negative value</span> — it is
        reported as a credit note in GSTR-9 Table 4I.
      </Note>
      <Note tone="position">
        Each ledger carries its GSTR-9 Table 4 bucket (B2B by default, as the sheet puts everything in B2B), so the books side of
        the outward reco is split by category. Totals are the same as the sheet’s.
      </Note>
      {mismatches > 0 && (
        <Note tone="warn">
          {mismatches} ledger{mismatches === 1 ? '’s' : 's’'} tax does not match the rate entered (highlighted in Implied rate).
          Check the tax or the rate.
        </Note>
      )}
      <SheetGrid<SalesRow>
        label="PL-OUTPUT Part A — taxable income"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={setRows}
        readOnly={readOnly}
        newRow={newSalesRow}
        canDelete
        addLabel="Add ledger"
        footer={footer}
        maxHeight={560}
        emptyText={
          <div className="space-y-1 py-2">
            <div className="font-medium text-foreground">No taxable income ledgers yet.</div>
            <div>
              Paste your PL-OUTPUT Part A rows (<span className="font-medium">Particulars → Rate</span>, row 10 onwards): click
              here and press Ctrl+V. Or use Add ledger.
            </div>
          </div>
        }
      />
    </SectionCard>
  );
};

export default PartAGrid;
