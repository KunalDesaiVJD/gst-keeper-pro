import React from 'react';
import type { Tax, ValTax } from '@/lib/gstr9/types';
import { zVal } from '@/lib/gstr9/defaults';
import { GridColumn, SheetGrid } from '../grid/SheetGrid';
import { diffTone, displayCol, moneyCol } from '../grid/columns';
import { MatrixRow, MatrixTable, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FORM_HEAD_LABELS, FORM_HEADS, particularsCol } from './helpers';
import { FixedRow, FixedRowDef, useFixedRows } from './hooks';
import { RowSrc, Src, StepLink } from './shared';

const VT_ORDER: Array<keyof ValTax & string> = ['t', 'c', 's', 'i', 'x'];

// ---------------------------------------------------------------------------
// Tables 10 & 11 (typed) · 12 & 13 (ITC reco) · total turnover
// ---------------------------------------------------------------------------

const T10_DEFS: FixedRowDef<ValTax>[] = [
  {
    id: 't10',
    code: '10',
    label: 'Supplies / tax declared through Invoices/Debit Note/Amendments (+)',
    title: 'Form wording: Supplies / tax declared through Amendments (+) (net of debit notes)',
    read: (g) => g.t10,
    write: (g, v) => ({ ...g, t10: v ?? zVal() }),
    fKey: (c) => `t10.${c}`,
  },
  {
    id: 't11',
    code: '11',
    label: 'Supplies / tax declared through Amendments/Credit Note (−)',
    title: 'Form wording: Supplies / tax reduced through Amendments (−) (net of credit notes)',
    read: (g) => g.t11,
    write: (g, v) => ({ ...g, t11: v ?? zVal() }),
    fKey: (c) => `t11.${c}`,
  },
];

type VRow = FixedRow<ValTax>;

export const Tables10to13: React.FC = () => {
  const { workings } = useWorkspace();
  const g = workings.g9;
  const { rows, onRowsChange, readOnly } = useFixedRows<ValTax>(T10_DEFS, { cols: VT_ORDER });

  const columns: GridColumn<VRow>[] = [
    particularsCol<VRow>('Particulars', 360),
    ...VT_ORDER.map((h) => moneyCol<VRow>(h, FORM_HEAD_LABELS[h], (r) => r.v[h], (r, v) => ({ ...r, v: { ...r.v, [h]: v ?? 0 } }))),
  ];

  const t12Src =
    g.t12Source === 'override' ? (
      <RowSrc step="itc" src={<Src kind="typed" title="Typed in ITC reco" />} />
    ) : (
      <RowSrc step="itc" src={<Src kind="computed" title="MAX(7J − ITC as per books, 0) per head (GSTR 9-INPUT row 27)" />} />
    );
  const matrix: MatrixRow[] = [
    { key: '12', code: '12', label: 'ITC of the financial year reversed in the next financial year', value: g.t12, note: t12Src },
    {
      key: '13',
      code: '13',
      label: 'ITC of the financial year availed in the next financial year',
      value: g.t13,
      note: <RowSrc step="itc" src={<Src kind="typed" title="Typed in ITC reco (suggestion shown there)" />} />,
    },
    {
      key: 'tt',
      code: '',
      label: 'Total turnover (5N + 10 − 11)',
      value: g.totalTurnover,
      total: true,
      note: <Src kind="computed" />,
    },
  ];

  return (
    <SectionCard
      title="10–13 · Transactions for the financial year declared in the next financial year"
      description="Declared in returns of April to September (or up to the annual return of the previous year, whichever is earlier). 10 and 11 are typed here; 12 and 13 come from ITC reco."
      excelRef="GSTR-9 rows 106–112"
      actions={<StepLink step="itc">ITC reco</StepLink>}
    >
      <SheetGrid<VRow> rows={rows} columns={columns} getRowId={(r) => r.id} onRowsChange={onRowsChange} readOnly={readOnly} label="GSTR-9 Tables 10 and 11" />
      <MatrixTable rows={matrix} heads={FORM_HEADS} headLabels={FORM_HEAD_LABELS} label="GSTR-9 Tables 12, 13 and total turnover" />
      <Note tone="position">
        Table 13 is typed (the ITC reco suggests MAX(books − 7J, 0) next to it) because the residual is often an unexplained monthly difference; Table 12 follows the sheet
        (MAX(7J − books, 0)) and can be overridden there.
      </Note>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 14 — differential tax paid on account of 10 & 11
// ---------------------------------------------------------------------------

type T14Key = 'igst' | 'cgst' | 'sgst' | 'cess' | 'interest';
type T14Val = { payable: number; paid: number };
const T14_ROWS: Array<{ k: T14Key; label: string; tax?: keyof Tax }> = [
  { k: 'igst', label: 'Integrated Tax', tax: 'i' },
  { k: 'cgst', label: 'Central Tax', tax: 'c' },
  { k: 'sgst', label: 'State/UT Tax', tax: 's' },
  { k: 'cess', label: 'Cess', tax: 'x' },
  { k: 'interest', label: 'Interest' },
];
const T14_TAX = Object.fromEntries(T14_ROWS.map((r) => [r.k, r.tax])) as Record<T14Key, keyof Tax | undefined>;
const T14_DEFS: FixedRowDef<T14Val>[] = T14_ROWS.map((r) => ({
  id: r.k,
  code: '',
  label: r.label,
  read: (g) => g.t14[r.k],
  write: (g, v) => ({ ...g, t14: { ...g.t14, [r.k]: v ?? { payable: 0, paid: 0 } } }),
  fKey: (c) => `t14.${r.k}.${c}`,
}));

type T14Row = FixedRow<T14Val>;

export const Table14: React.FC = () => {
  const { workings } = useWorkspace();
  const tol = workings.tolerance;
  const ref = workings.notice.outward.r2; // tax of Table 10 − Table 11
  const { rows, onRowsChange, readOnly } = useFixedRows<T14Val>(T14_DEFS, { cols: ['payable', 'paid'] });
  const diff = (r: T14Row) => r.v.payable - r.v.paid;

  const columns: GridColumn<T14Row>[] = [
    particularsCol<T14Row>('Description', 180),
    moneyCol<T14Row>('payable', 'Payable', (r) => r.v.payable, (r, v) => ({ ...r, v: { ...r.v, payable: v ?? 0 } })),
    moneyCol<T14Row>('paid', 'Paid', (r) => r.v.paid, (r, v) => ({ ...r, v: { ...r.v, paid: v ?? 0 } })),
    displayCol<T14Row>('diff', 'Payable − Paid', (r) => diff(r), { tone: (r) => diffTone(diff(r), tol) }),
    displayCol<T14Row>('ref', 'Tax in 10 − 11 (ref.)', (r) => (T14_TAX[r.id as T14Key] ? ref[T14_TAX[r.id as T14Key]!] : null), {
      width: 140,
      tone: () => 'muted',
    }),
  ];

  return (
    <SectionCard title="14 · Differential tax paid on account of declaration in 10 & 11 above" description="Typed here — not part of the firm's sheet.">
      <SheetGrid<T14Row> rows={rows} columns={columns} getRowId={(r) => r.id} onRowsChange={onRowsChange} readOnly={readOnly} label="GSTR-9 Table 14" />
    </SectionCard>
  );
};
