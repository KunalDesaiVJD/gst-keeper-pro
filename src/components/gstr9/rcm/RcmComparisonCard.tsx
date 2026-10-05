import React from 'react';
import { FY_MONTHS, type MonthKey } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { diffTone, displayCol, taxFooter } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { JustifyControl, Note, SectionCard, useDiffLine } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { monthLabel, RCM_GRID_MAX_HEIGHT, TAX_HEAD_LABEL } from './rcmShared';

interface CmpRow {
  id: MonthKey;
}

const DIFF = 'Difference · Books − Portal';
const VALUE = 'Taxable value';

/**
 * The sheet's DIFFERENCE row (D43:G43), month by month, read Books − Portal,
 * with each month's justification on the same row.
 */
const RcmComparisonCard: React.FC = () => {
  const { workings, financialYear } = useWorkspace();
  const W = workings.rcm;
  const tol = workings.tolerance;
  const annual = W.partASource === 'gstr9';
  const annualLine = useDiffLine('rcm.annual');
  const withCess = Math.abs(W.diff.x) > 0.004 || FY_MONTHS.some((m) => Math.abs(W.diffMonths[m].x) > 0.004);

  // With only the annual 4G there is no portal figure per month: leave the month's portal and
  // difference blank rather than show the whole books figure as a difference.
  const noMonthly = (h: 't' | 'i' | 'c' | 's' | 'x') => (r: CmpRow) => (annual ? null : W.diffMonths[r.id][h]);
  const tone = (h: 't' | 'i' | 'c' | 's' | 'x') => (r: CmpRow) => (annual ? undefined : diffTone(W.diffMonths[r.id][h], tol));
  const annualTitle = () => (annual ? 'Only the annual GSTR-9 4G is available — compared for the year below.' : undefined);
  const heads = (['i', 'c', 's', 'x'] as const).filter((h) => h !== 'x' || withCess);

  const rows: CmpRow[] = FY_MONTHS.map((m) => ({ id: m }));
  const columns: GridColumn<CmpRow>[] = [
    { key: 'month', header: 'Month', type: 'display', align: 'left', sticky: true, width: 92, value: (r) => monthLabel(r.id, financialYear) },
    displayCol<CmpRow>('books', 'Books (Part B)', (r) => W.partBMonths[r.id].t, { group: VALUE, width: 130 }),
    displayCol<CmpRow>('portal', 'Portal (Part A)', (r) => (annual ? null : W.partAMonths[r.id].t), { group: VALUE, width: 130, title: annualTitle }),
    displayCol<CmpRow>('d.t', 'Value', noMonthly('t'), { group: DIFF, width: 120, tone: tone('t'), title: annualTitle }),
    ...heads.map((h) => displayCol<CmpRow>(`d.${h}`, TAX_HEAD_LABEL[h], noMonthly(h), { group: DIFF, width: 110, tone: tone(h), title: annualTitle })),
    {
      key: 'status',
      header: 'Status',
      type: 'display',
      align: 'center',
      width: 64,
      value: () => null,
      render: (r) => <JustifyControl lineKey={`rcm.${r.id}`} compact />,
    },
  ];

  return (
    <SectionCard
      title="Difference — books vs portal"
      description="Month by month. A difference beyond the tolerance needs a reason — click the status to write it."
      excelRef="RCM row 43 (D43:G43)"
    >
      <SheetGrid<CmpRow>
        label="RCM difference, books minus portal, by month"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        readOnly
        maxHeight={RCM_GRID_MAX_HEIGHT}
        footer={[
          {
            key: 'total',
            label: annual ? 'Total (portal = 4G)' : 'Total',
            tone: 'total',
            cells: {
              books: W.partB.t,
              portal: W.partA.t,
              'd.t': W.diff.t,
              ...taxFooter('d', W.diff, withCess),
            },
          },
        ]}
      />
      {annual && annualLine && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
          <span>
            <span className="font-medium">For the year, against GSTR-9 4G</span> (Books − 4G): value {fmtMoney(annualLine.diff.t)} · IGST{' '}
            {fmtMoney(annualLine.diff.i)} · CGST {fmtMoney(annualLine.diff.c)} · SGST {fmtMoney(annualLine.diff.s)}
          </span>
          <JustifyControl lineKey="rcm.annual" />
        </div>
      )}
      <Note tone="position">
        Differences read <strong>Books − Portal</strong>. The sheet’s D43 reads Part A − Part B, so its signs are the reverse of these. RCM tax
        is computed to the paisa, as the sheet does (=D52*2.5%); the portal rounds to the rupee, so differences of ±₹1–2 are normal and fall
        within the ₹{tol} tolerance.
      </Note>
    </SectionCard>
  );
};

export default RcmComparisonCard;
