import React, { useCallback, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import type { StepKey } from '@/lib/gstr9/engine';
import type { Formulas, TaxIn } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { taxInCols } from '../grid/columns';
import { MatrixTable, Note, SectionCard, type MatrixRow } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

/** Small inline link to another step (keeps the client in the URL — the caller builds the params). */
export const StepLink: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-normal text-primary underline-offset-2 hover:underline"
  >
    {children}
    <ArrowRight className="h-3 w-3" aria-hidden="true" />
  </button>
);

type AdjRow = { id: string; v: TaxIn; f?: Formulas };

/**
 * PL-INPUT rows 71–81: total ITC as per the P&L, the suspended-ITC and RCM
 * adjustments, the net ITC for the year and its difference from the Duties &
 * Taxes ledgers. Every figure is the engine's; only row 75 is typed.
 */
export const PurchasesSummary: React.FC<{ onGo: (step: StepKey) => void }> = ({ onGo }) => {
  const { docs, workings, update, readOnly, financialYear } = useWorkspace();
  const p = workings.purchases;

  const rows: MatrixRow[] = [
    { key: '71', code: '71', label: 'Total ITC as per P&L', value: p.totalPl, total: true },
    {
      key: '73',
      code: '73',
      label: 'Less: suspended ITC as per Duties & Taxes (Dr − Cr)',
      value: p.suspended,
      indent: true,
      note: <StepLink onClick={() => onGo('duties')}>from the Duties &amp; Taxes step</StepLink>,
    },
    {
      key: '75',
      code: '75',
      label: 'Less: suspended ITC — other adjustments',
      value: p.otherAdj,
      indent: true,
      note: <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">typed below</Badge>,
    },
    {
      key: '77',
      code: '77',
      label: 'Add: RCM credit (books — RCM Part B)',
      value: p.rcmCredit,
      indent: true,
      note: <StepLink onClick={() => onGo('rcm')}>from the RCM step</StepLink>,
    },
    { key: '79', code: '79', label: `Net ITC for FY ${financialYear}`, value: p.netItc, total: true },
    {
      key: '80',
      code: '80',
      label: 'As per Duties & Taxes (net, after last-year effect)',
      value: p.dtNet,
      note: <StepLink onClick={() => onGo('duties')}>Duties &amp; Taxes</StepLink>,
    },
    { key: '81', code: '81', label: 'Difference (P&L − D&T)', value: p.diffVsDt, signed: true, total: true, diffKey: 'purchases.dt' },
  ];

  // The wrapper row carries the doc's formula map, so "=a+b" typed here is kept as f['suspendedOtherAdj.i'] etc.
  const adjRows = useMemo<AdjRow[]>(
    () => [{ id: 'r75', v: docs.purchases.suspendedOtherAdj, f: docs.purchases.f }],
    [docs.purchases.suspendedOtherAdj, docs.purchases.f],
  );
  const adjColumns = useMemo<GridColumn<AdjRow>[]>(
    () => [
      {
        key: 'label',
        header: 'PL-INPUT row 75',
        type: 'display',
        align: 'left',
        width: 280,
        value: () => 'Suspended ITC as per Duties & Taxes (other adj.)',
      },
      ...taxInCols<AdjRow>((r) => r.v, (r, t) => ({ ...r, v: t }), { prefix: 'suspendedOtherAdj', cess: true }),
    ],
    [],
  );
  const onAdjChange = useCallback(
    (next: AdjRow[]) => {
      const row = next[0];
      if (row) update('purchases', (d) => ({ ...d, suspendedOtherAdj: row.v, f: row.f ?? d.f }));
    },
    [update],
  );

  return (
    <SectionCard
      title="ITC as per P&L — summary"
      description="Net ITC for the year from the ledgers in (A)–(C), compared with the Duties & Taxes ledgers."
      excelRef="PL-INPUT rows 71–81"
    >
      {workings.ctx.noItcBuilder && (
        <Note>Builder on the no-ITC scheme: zero ITC is expected, so the difference below is for information only.</Note>
      )}

      <MatrixTable label="PL-INPUT rows 71 to 81" rows={rows} heads={['t', 'i', 'c', 's', 'x']} headLabels={{ t: 'Value' }} />

      <div className="space-y-1.5">
        <div className="text-xs font-medium">Row 75 — other suspended-ITC adjustments</div>
        <SheetGrid<AdjRow>
          label="PL-INPUT row 75, suspended ITC other adjustments"
          rows={adjRows}
          columns={adjColumns}
          getRowId={(r) => r.id}
          onRowsChange={onAdjChange}
          readOnly={readOnly}
        />
        <p className="text-[11px] text-muted-foreground">
          Any suspended ITC not already in the Duties &amp; Taxes suspense columns (row 73). It reduces the net ITC per head; the value column is unaffected, as in the sheet.
        </p>
      </div>

      <Note tone="position">
        The sheet labels row 77 “RCM credit as per portal”, but it reads RCM Part B — the books. Part B here adds all four expense blocks for
        both value and tax (the sheet’s taxable total adds only two), so the value in rows 77 and 79 can be higher than the sheet’s.
      </Note>
    </SectionCard>
  );
};

export default PurchasesSummary;
