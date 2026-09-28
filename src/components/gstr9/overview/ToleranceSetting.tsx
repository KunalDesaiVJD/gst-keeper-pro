import React, { useMemo } from 'react';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

interface Row {
  id: 'tolerance';
  label: string;
  value: number;
}

/** The per-client/FY tolerance, a one-row grid so entry behaves like every other grid. */
export const ToleranceSetting: React.FC = () => {
  const { docs, update, readOnly } = useWorkspace();
  const rows: Row[] = [{ id: 'tolerance', label: 'Tolerance per head', value: docs.settings.tolerance }];
  const columns = useMemo<GridColumn<Row>[]>(
    () => [
      { key: 'label', header: 'Setting', type: 'display', value: (r) => r.label, width: 180, align: 'left' },
      moneyCol<Row>('value', 'Amount (₹)', (r) => r.value, (r, v) => ({ ...r, value: Math.max(0, v ?? 0) }), { width: 140 }),
    ],
    [],
  );

  return (
    <SectionCard title="Tolerance" description="A difference needs a reason when any head (IGST, CGST, SGST, Cess — or the value, where one is compared) exceeds this amount.">
      <SheetGrid
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={(next) => {
          const v = Math.max(0, Number(next[0]?.value) || 0);
          update('settings', (s) => ({ ...s, tolerance: v }));
        }}
        readOnly={readOnly}
        label="Tolerance"
      />
      <Note tone="position">Each head is checked on its own against this tolerance (default ₹10, per client and year). The workbook has no tolerance, and the old app netted the heads together.</Note>
    </SectionCard>
  );
};

export default ToleranceSetting;
