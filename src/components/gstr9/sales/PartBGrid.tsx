import React, { useCallback, useMemo } from 'react';
import type { NonTaxRow } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { SectionCard } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { landsIn, NATURE_OPTIONS, natureFromOption, newNonTaxRow } from './salesEntry';

/** PL-OUTPUT Part B — non-taxable income, each ledger tagged with its GSTR-9 Table 5 nature. */
const PartBGrid: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const rows = docs.sales.partB;
  const { partBTotal, partBByNature } = workings.sales;
  const t5H = workings.g9.t5.H.t;

  const setRows = useCallback((next: NonTaxRow[]) => update('sales', (d) => ({ ...d, partB: next })), [update]);

  const columns = useMemo<GridColumn<NonTaxRow>[]>(
    () => [
      {
        key: 'ledger',
        header: 'Ledger',
        type: 'text',
        width: 240,
        sticky: true,
        align: 'left',
        value: (r) => r.ledger,
        onEdit: (r, e) => ({ ...r, ledger: e.text }),
      },
      moneyCol<NonTaxRow>('amount', 'Amount', (r) => r.amount, (r, v) => ({ ...r, amount: v ?? 0 }), { width: 136 }),
      {
        key: 'nature',
        header: 'Nature (bifurcation)',
        type: 'select',
        width: 250,
        options: NATURE_OPTIONS,
        value: (r) => r.nature,
        title: () => 'Pick the GSTR-9 Table 5 nature. The sheet’s own labels (EXPORT SALE W/O, SEZ W/O, NON-GST) paste straight in.',
        onEdit: (r, e) => {
          const nature = natureFromOption(e.text);
          return nature ? { ...r, nature } : r;
        },
      },
      {
        key: 'lands',
        header: 'GSTR-9',
        type: 'display',
        width: 120,
        align: 'left',
        value: (r) => landsIn(r).code,
        title: (r) => {
          const l = landsIn(r);
          if (l.code === '—') return 'Part of the audit-report total only; not reported in GSTR-9 Table 5';
          return l.code === '5H' ? 'Negative amount: a credit note, reported in Table 5H' : `Reported in GSTR-9 Table ${l.code}`;
        },
        render: (r) => {
          const l = landsIn(r);
          if (l.code === '—') return <span className="text-[10px] text-muted-foreground">{l.note}</span>;
          return (
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">{l.code}</span>
              {l.note && <span className="text-[10px] text-muted-foreground">{l.note}</span>}
            </span>
          );
        },
      },
    ],
    [],
  );

  const footer = useMemo<GridFooterRow[]>(() => {
    const out: GridFooterRow[] = [{ key: 'total', label: 'Total income — Part B', tone: 'total', cells: { amount: partBTotal } }];
    if (Math.abs(t5H) > 0.004) out.push({ key: '5h', label: 'of which credit notes (→ 5H)', tone: 'muted', cells: { amount: -t5H } });
    const notIn = partBByNature.not_in_gstr9.pos + partBByNature.not_in_gstr9.neg;
    if (Math.abs(notIn) > 0.004) out.push({ key: 'not', label: 'of which not reportable in GSTR-9', tone: 'muted', cells: { amount: notIn } });
    return out;
  }, [partBTotal, partBByNature, t5H]);

  return (
    <SectionCard
      title="Part B — Non-taxable income"
      description="Exports and SEZ supplies without tax, exempt, nil-rated and non-GST income (interest, duty drawback, misc.)."
      excelRef="PL-OUTPUT rows 37–50"
    >
      <SheetGrid<NonTaxRow>
        label="PL-OUTPUT Part B — non-taxable income"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={setRows}
        readOnly={readOnly}
        newRow={newNonTaxRow}
        canDelete
        addLabel="Add ledger"
        footer={footer}
        maxHeight="max(300px, calc(100vh - 400px))"
        emptyText={
          <div className="space-y-1 py-2">
            <div className="font-medium text-foreground">No non-taxable income ledgers.</div>
            <div>
              Paste PL-OUTPUT Part B (<span className="font-medium">Particulars → Bifurcation</span>, row 41 onwards) here, or use
              Add ledger.
            </div>
          </div>
        }
      />
      <p className="text-[11px] text-muted-foreground">
        Enter credit notes as <span className="font-medium text-foreground">negative rows</span> — they go to GSTR-9 Table 5H, not the
        nature’s own row.
      </p>
    </SectionCard>
  );
};

export default PartBGrid;
