import React, { useCallback, useMemo } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { PurchaseRowCalc } from '@/lib/gstr9/engine';
import type { ExpenseHead, InputSection, PurchaseRow } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn, type GridFooterRow } from '../grid/SheetGrid';
import { moneyCol, taxFooter, taxInCols } from '../grid/columns';
import { fmtRate } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import {
  changeSupply,
  defaultHeadLabel,
  fillFromRate,
  HEAD_OPTIONS,
  inferSupply,
  isStandardRate,
  newPurchaseRow,
  rateFlag,
  SECTION_META,
  spliceSection,
  SUPPLY_OPTIONS,
} from './purchaseRows';

/** PL-INPUT columns C–H (Head in books, Taxable value, IGST, CGST, SGST, Rate), then the rest — the paste order. */
const PURCHASE_PASTE_ORDER = ['ledger', 'taxable', 'tax.i', 'tax.c', 'tax.s', 'rate', 'tax.x', 'supply', 'head'];

/**
 * The PL-INPUT entry grid for one section. Pasting follows the sheet
 * (Head in books, Taxable value, IGST, CGST, SGST, Rate) so a block copied
 * from columns C–H pastes straight in; Cess, Supply and the 9C expense head
 * come after.
 */
function buildColumns(calc: Record<string, PurchaseRowCalc>): GridColumn<PurchaseRow>[] {
  const tax = taxInCols<PurchaseRow>(
    (r) => ({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess }),
    (r, t) => inferSupply({ ...r, igst: t.i, cgst: t.c, sgst: t.s, cess: t.x }),
    { prefix: 'tax' },
  ).map((c) => ({ ...c, width: 112 }));

  const ledger: GridColumn<PurchaseRow> = {
    key: 'ledger',
    header: 'Ledger (head in books)',
    type: 'text',
    width: 210,
    sticky: true,
    value: (r) => r.ledger,
    onEdit: (r, e) => ({ ...r, ledger: e.text }),
  };

  const taxable = moneyCol<PurchaseRow>('taxable', 'Taxable value', (r) => r.taxable, (r, v) => fillFromRate({ ...r, taxable: v ?? 0 }), {
    width: 124,
  });

  const rate: GridColumn<PurchaseRow> = {
    key: 'rate',
    header: 'Rate %',
    type: 'percent',
    width: 64,
    value: (r) => r.rate,
    onEdit: (r, e) => fillFromRate({ ...r, rate: e.num }),
    tone: (r) => (r.rate !== null && !isStandardRate(r.rate) ? 'warn' : undefined),
    title: (r) => {
      const f = rateFlag(r, calc[r.id]);
      return f?.kind === 'nonstandard_rate' ? f.message : undefined;
    },
  };

  const implied: GridColumn<PurchaseRow> = {
    key: 'implied',
    header: 'Implied',
    type: 'display',
    width: 76,
    align: 'right',
    value: (r) => calc[r.id]?.impliedRate ?? null,
    tone: (r) => {
      const f = rateFlag(r, calc[r.id]);
      return f && f.kind !== 'nonstandard_rate' ? 'warn' : undefined;
    },
    title: (r) => {
      const f = rateFlag(r, calc[r.id]);
      if (f && f.kind !== 'nonstandard_rate') return f.message;
      return calc[r.id]?.impliedRate !== null && calc[r.id]?.impliedRate !== undefined
        ? '(IGST + CGST + SGST) × 100 ÷ taxable value — the sheet’s column H'
        : undefined;
    },
    render: (r) => {
      const v = calc[r.id]?.impliedRate;
      if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
      const f = rateFlag(r, calc[r.id]);
      if (f && f.kind !== 'nonstandard_rate') {
        return (
          <span className="inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
            {fmtRate(v)}
          </span>
        );
      }
      return <span className="text-muted-foreground">{fmtRate(v)}</span>;
    },
  };

  const cess = moneyCol<PurchaseRow>('tax.x', 'Cess', (r) => r.cess, (r, v) => ({ ...r, cess: v ?? 0 }), { width: 84 });

  const supply: GridColumn<PurchaseRow> = {
    key: 'supply',
    header: 'Supply',
    type: 'select',
    width: 96,
    options: SUPPLY_OPTIONS,
    value: (r) => r.supplyType,
    onEdit: (r, e) => (e.text === 'inter' || e.text === 'intra' ? changeSupply(r, e.text) : r),
  };

  const head: GridColumn<PurchaseRow> = {
    key: 'head',
    header: '9C expense head',
    type: 'select',
    width: 230,
    options: HEAD_OPTIONS,
    value: (r) => r.head,
    placeholder: (r) => defaultHeadLabel(r.section),
    blankLabel: 'Section default',
    title: (r) => (r.head === null ? 'Section default — pick a head to tag this ledger' : undefined),
    onEdit: (r, e) => ({ ...r, head: (e.text || null) as ExpenseHead | null }),
  };

  // Paste order: Ledger, Taxable, IGST, CGST, SGST, Rate, Cess, Supply, Head (display columns are skipped).
  // Rate (and its check) right after the taxable value on screen; pastes keep the sheet's order (PURCHASE_PASTE_ORDER).
  return [ledger, taxable, rate, implied, ...tax, cess, supply, head];
}

export const PurchaseSectionGrid: React.FC<{ section: InputSection }> = ({ section }) => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const confirm = useConfirm();
  const meta = SECTION_META[section];
  const rows = useMemo(() => docs.purchases.rows.filter((r) => r.section === section), [docs.purchases.rows, section]);
  const calc = workings.purchases.rows;
  const columns = useMemo(() => buildColumns(calc), [calc]);
  const total = workings.purchases.sections[section];
  const flagged = useMemo(() => rows.filter((r) => rateFlag(r, calc[r.id])), [rows, calc]);

  const onRowsChange = useCallback(
    (next: PurchaseRow[]) => update('purchases', (d) => ({ ...d, rows: spliceSection(d.rows, section, next) })),
    [update, section],
  );
  const newRow = useCallback(() => newPurchaseRow(section), [section]);

  const footer: GridFooterRow[] = [
    {
      key: 'total',
      label: `${meta.totalLabel} (${rows.length})`,
      tone: 'total',
      cells: { taxable: total.t, ...taxFooter('tax', total, true) },
    },
  ];

  const clearSection = async () => {
    const before = rows;
    const ok = await confirm({
      title: `Clear all ${before.length} ledger${before.length === 1 ? '' : 's'} in ${meta.title}?`,
      description: 'Use this to re-paste the section from the sheet. You can undo it from the notification.',
      confirmText: 'Clear section',
      destructive: true,
    });
    if (!ok) return;
    update('purchases', (d) => ({ ...d, rows: d.rows.filter((r) => r.section !== section) }));
    toast(`${meta.title} cleared`, {
      action: { label: 'Undo', onClick: () => update('purchases', (d) => ({ ...d, rows: spliceSection(d.rows, section, before) })) },
    });
  };

  return (
    <SectionCard
      title={meta.title}
      description={
        <>
          {meta.description} Default 9C head: <span className="italic">{defaultHeadLabel(section)}</span>.
        </>
      }
      excelRef={meta.excelRef}
      actions={
        !readOnly && rows.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive-strong" onClick={clearSection}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear section
          </Button>
        ) : undefined
      }
    >
      {flagged.length > 0 && (
        <Note tone="warn">
          <span className="font-medium">
            {flagged.length} ledger{flagged.length === 1 ? '' : 's'} where tax is not the GST rate on the value
          </span>{' '}
          — usually a partial or blocked credit, or a ledger mixing rates:{' '}
          {flagged.slice(0, 3).map((r, i) => (
            <React.Fragment key={r.id}>
              {i > 0 && '; '}
              <span className="font-medium">{r.ledger || '(no name)'}</span>
              {calc[r.id]?.impliedRate !== null && calc[r.id]?.impliedRate !== undefined && ` at ${calc[r.id]!.impliedRate}%`}
            </React.Fragment>
          ))}
          {flagged.length > 3 && `; and ${flagged.length - 3} more`}. Hover the highlighted cell for detail.
        </Note>
      )}
      <SheetGrid<PurchaseRow>
        label={`PL-INPUT ${meta.title}`}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={onRowsChange}
        readOnly={readOnly}
        newRow={newRow}
        canDelete
        addLabel="Add ledger"
        footer={footer}
        maxHeight="max(300px, calc(100vh - 460px))"
        pasteOrder={PURCHASE_PASTE_ORDER}
        emptyText={
          <span>
            No ledgers yet. Click here and paste PL-INPUT {meta.sheetRows}, columns C–H{' '}
            <span className="whitespace-nowrap">(Head in books → Rate)</span>, or use “Add ledger”.
          </span>
        }
      />
      <p className="text-[11px] text-muted-foreground">
        Paste straight from PL-INPUT {meta.sheetRows}, columns C–H (Head in books → Rate). SGST mirrors CGST until you type over it; tax is
        filled from the rate where a row has none.
      </p>
    </SectionCard>
  );
};

export default PurchaseSectionGrid;
