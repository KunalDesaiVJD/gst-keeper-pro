import React, { useCallback, useMemo } from 'react';
import { newId } from '@/lib/gstr9/defaults';
import type { AdjustmentRow, MonthKey, Tax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { taxFooter } from '../grid/columns';
import { mirroredTaxCols, monthOptions } from './helpers';

export interface AdjustmentTotal {
  key: string;
  label: React.ReactNode;
  value: Tax;
  /** Shown in the Reason column of the footer row. */
  note?: React.ReactNode;
  tone?: GridFooterRow['tone'];
}

/**
 * "OTHER ADJUSTMENTS IN CR / DR SIDE" — a free list (month, IGST, CGST, SGST
 * mirroring CGST, Cess, reason) with its totals in the footer.
 */
const AdjustmentsGrid: React.FC<{
  docKey: 'duties_output' | 'duties_input';
  label: string;
  cess: boolean;
  totals: AdjustmentTotal[];
  emptyText: string;
}> = ({ docKey, label, cess, totals, emptyText }) => {
  const { docs, update, readOnly, financialYear } = useWorkspace();
  const rows = docs[docKey].adjustments;

  const onRowsChange = useCallback(
    (next: AdjustmentRow[]) => {
      if (docKey === 'duties_output') update('duties_output', (d) => ({ ...d, adjustments: next }));
      else update('duties_input', (d) => ({ ...d, adjustments: next }));
    },
    [docKey, update],
  );

  const columns = useMemo<GridColumn<AdjustmentRow>[]>(
    () => [
      {
        key: 'month',
        header: 'Month',
        type: 'select',
        // Aliases accept the sheet's own month labels (MARCH, APR-24, …) when pasting.
        options: monthOptions(financialYear),
        width: 104,
        align: 'left',
        value: (r) => r.month ?? '',
        onEdit: (r, e) => ({ ...r, month: e.text ? (e.text as MonthKey) : null }),
      },
      ...mirroredTaxCols<AdjustmentRow>(
        (r) => ({ i: r.i, c: r.c, s: r.s, x: r.x }),
        (r, t) => ({ ...r, i: t.i, c: t.c, s: t.s, x: t.x }),
        { prefix: 'adj', cess },
      ),
      {
        key: 'reason',
        header: 'Reason',
        type: 'text',
        width: 300,
        align: 'left',
        value: (r) => r.reason,
        onEdit: (r, e) => ({ ...r, reason: e.text }),
      },
    ],
    [cess, financialYear],
  );

  const footer = useMemo<GridFooterRow[]>(
    () =>
      totals.map((t) => ({
        key: t.key,
        label: t.label,
        tone: t.tone ?? 'total',
        cells: { ...taxFooter('adj', t.value, cess), reason: t.note ? <span className="font-normal text-muted-foreground">{t.note}</span> : null },
      })),
    [totals, cess],
  );

  const newRow = useCallback((): AdjustmentRow => ({ id: newId(), month: null, i: 0, c: 0, s: null, x: 0, reason: '' }), []);

  return (
    <SheetGrid<AdjustmentRow>
      label={label}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowsChange={onRowsChange}
      readOnly={readOnly}
      newRow={newRow}
      canDelete
      addLabel="Add adjustment"
      footer={footer}
      emptyText={emptyText}
    />
  );
};

export default AdjustmentsGrid;
