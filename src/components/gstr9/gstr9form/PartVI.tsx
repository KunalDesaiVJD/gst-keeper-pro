import React from 'react';
import { addT, impliedRate, rateMismatch, rowTax } from '@/lib/gstr9/engine';
import type { HsnRow, Tax, ValTax } from '@/lib/gstr9/types';
import { newId, zVal } from '@/lib/gstr9/defaults';
import { GridColumn, SheetGrid } from '../grid/SheetGrid';
import { diffTone, displayCol, lockSgst, moneyCol, taxFooter, taxInCols } from '../grid/columns';
import { fmtRate } from '../grid/money';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FORM_GRID_MAX_H, FORM_HEAD_LABELS, particularsCol } from './helpers';
import { FixedRow, FixedRowDef, lockFollowerRows, useFixedRows } from './hooks';

// ---------------------------------------------------------------------------
// Table 15 — demands and refunds
// ---------------------------------------------------------------------------

type ExtKey = 'interest' | 'penalty' | 'lateFee' | 'others';
type T15Val = Tax & Partial<Record<ExtKey, number>>;
type T15Key = 'refundClaimed' | 'refundSanctioned' | 'refundRejected' | 'refundPending' | 'demandTotal' | 'demandPaid' | 'demandPending';

const T15_ROWS: Array<{ k: T15Key; code: string; label: string; demand: boolean }> = [
  { k: 'refundClaimed', code: '15A', label: 'Total Refund claimed', demand: false },
  { k: 'refundSanctioned', code: '15B', label: 'Total Refund sanctioned', demand: false },
  { k: 'refundRejected', code: '15C', label: 'Total Refund Rejected', demand: false },
  { k: 'refundPending', code: '15D', label: 'Total Refund Pending', demand: false },
  { k: 'demandTotal', code: '15E', label: 'Total demand of taxes', demand: true },
  { k: 'demandPaid', code: '15F', label: 'Total taxes paid in respect of E above', demand: true },
  { k: 'demandPending', code: '15G', label: 'Total demands pending out of E above', demand: true },
];
const DEMAND_ROWS = new Set(T15_ROWS.filter((r) => r.demand).map((r) => r.k as string));

const T15_DEFS: FixedRowDef<T15Val>[] = T15_ROWS.map((r) => ({
  id: r.k,
  code: r.code,
  label: r.label,
  read: (g) => g.t15[r.k],
  write: (g, v) => ({ ...g, t15: { ...g.t15, [r.k]: v } }),
  fKey: (c) => (r.demand || ['c', 's', 'i', 'x'].includes(c) ? `t15.${r.k}.${c}` : undefined),
}));
const T15_COLS = ['c', 's', 'i', 'x', 'interest', 'penalty', 'lateFee', 'others'];

type T15Row = FixedRow<T15Val>;

export const Table15: React.FC = () => {
  const { rows, onRowsChange, readOnly } = useFixedRows<T15Val>(T15_DEFS, { cols: T15_COLS });
  const taxHeads: Array<keyof Tax> = ['c', 's', 'i', 'x'];
  const ext: Array<[ExtKey, string]> = [
    ['interest', 'Interest'],
    ['penalty', 'Penalty'],
    ['lateFee', 'Late fee'],
    ['others', 'Others'],
  ];
  const columns: GridColumn<T15Row>[] = [
    particularsCol<T15Row>('Details', 230),
    // SGST is the CGST figure and is locked (lockSgst): a CGST entry carries it.
    ...taxHeads.map((h) => {
      const col = moneyCol<T15Row>(h, FORM_HEAD_LABELS[h], (r) => r.v[h], (r, v) => ({ ...r, v: h === 'c' ? { ...r.v, c: v ?? 0, s: v ?? 0 } : { ...r.v, [h]: v ?? 0 } }), { width: 104 });
      return h === 's' ? lockSgst(col) : col;
    }),
    ...ext.map(([k, header]) =>
      moneyCol<T15Row>(
        k,
        header,
        (r) => (DEMAND_ROWS.has(r.id) ? r.v[k] ?? 0 : null),
        (r, v) => ({ ...r, v: { ...r.v, [k]: v ?? 0 } }),
        { width: 96, editable: (r) => DEMAND_ROWS.has(r.id) },
      ),
    ),
  ];
  return (
    <SectionCard title="15 · Particulars of demands and refunds" description="Typed here — not part of the firm's sheet. Interest, penalty, late fee and others apply to demands (15E–15G).">
      <SheetGrid<T15Row> rows={rows} columns={columns} getRowId={(r) => r.id} onRowsChange={onRowsChange} readOnly={readOnly} label="GSTR-9 Table 15" />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 16 — composition suppliers, deemed supply u/s 143, goods on approval
// ---------------------------------------------------------------------------

const T16_DEFS: FixedRowDef<ValTax>[] = [
  {
    id: '16A',
    code: '16A',
    label: 'Supplies received from composition taxpayers',
    title: 'Value only',
    read: (g) => ({ ...zVal(), t: g.t16.compositionSupplies }),
    write: (g, v) => ({ ...g, t16: { ...g.t16, compositionSupplies: v?.t ?? 0 } }),
    fKey: (c) => (c === 't' ? 't16.compositionSupplies' : undefined),
  },
  {
    id: '16B',
    code: '16B',
    label: 'Deemed supply under section 143',
    read: (g) => g.t16.deemedSupply,
    write: (g, v) => ({ ...g, t16: { ...g.t16, deemedSupply: v ?? zVal() } }),
    fKey: (c) => `t16.deemedSupply.${c}`,
  },
  {
    id: '16C',
    code: '16C',
    label: 'Goods sent on approval basis but not returned',
    read: (g) => g.t16.approvalNotReturned,
    write: (g, v) => ({ ...g, t16: { ...g.t16, approvalNotReturned: v ?? zVal() } }),
    fKey: (c) => `t16.approvalNotReturned.${c}`,
  },
];

type T16Row = FixedRow<ValTax>;

export const Table16: React.FC = () => {
  const heads: Array<keyof ValTax & string> = ['t', 'c', 's', 'i', 'x'];
  const { rows, onRowsChange, readOnly } = useFixedRows<ValTax>(T16_DEFS, { cols: heads });
  const valueOnly = (r: T16Row) => r.id === '16A';
  const columns: GridColumn<T16Row>[] = [
    particularsCol<T16Row>('Details', 300),
    ...heads.map((h) => {
      const col = moneyCol<T16Row>(
        h,
        FORM_HEAD_LABELS[h],
        (r) => (h !== 't' && valueOnly(r) ? null : r.v[h]),
        // SGST is the CGST figure and is locked (lockSgst): a CGST entry carries it.
        (r, v) => ({ ...r, v: h === 'c' ? { ...r.v, c: v ?? 0, s: v ?? 0 } : { ...r.v, [h]: v ?? 0 } }),
        { editable: (r) => h === 't' || !valueOnly(r) },
      );
      return h === 's' ? lockSgst(col) : col;
    }),
  ];
  return (
    <SectionCard
      title="16 · Information on supplies received from composition taxpayers, deemed supply under section 143 and goods sent on approval basis"
      description="Typed here — not part of the firm's sheet. 16A is value only."
    >
      <SheetGrid<T16Row> rows={rows} columns={columns} getRowId={(r) => r.id} onRowsChange={onRowsChange} readOnly={readOnly} label="GSTR-9 Table 16" />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Table 19 — late fee payable and paid
// ---------------------------------------------------------------------------

type T19Key = 'cgst' | 'sgst';
type T19Val = { payable: number; paid: number };
const T19_ROWS: Array<{ k: T19Key; code: string; label: string }> = [
  { k: 'cgst', code: '19A', label: 'Central Tax' },
  { k: 'sgst', code: '19B', label: 'State Tax' },
];
const T19_DEFS: FixedRowDef<T19Val>[] = T19_ROWS.map((r) => ({
  id: r.k,
  code: r.code,
  label: r.label,
  read: (g) => g.t19?.[r.k] ?? { payable: 0, paid: 0 },
  write: (g, v) => ({ ...g, t19: { ...g.t19, [r.k]: v ?? { payable: 0, paid: 0 } } }),
  fKey: (c) => `t19.${r.k}.${c}`,
  // State tax late fee is the Central tax late fee: locked, entered through Central tax.
  ...(r.k === 'sgst' ? { follows: 'cgst' } : {}),
}));

type T19Row = FixedRow<T19Val>;

export const Table19: React.FC = () => {
  const { workings } = useWorkspace();
  const tol = workings.tolerance;
  const { rows, onRowsChange, readOnly } = useFixedRows<T19Val>(T19_DEFS, { cols: ['payable', 'paid'] });
  const diff = (r: T19Row) => r.v.payable - r.v.paid;
  const columns: GridColumn<T19Row>[] = [
    particularsCol<T19Row>('Description', 180),
    lockFollowerRows(moneyCol<T19Row>('payable', 'Payable', (r) => r.v.payable, (r, v) => ({ ...r, v: { ...r.v, payable: v ?? 0 } }))),
    lockFollowerRows(moneyCol<T19Row>('paid', 'Paid', (r) => r.v.paid, (r, v) => ({ ...r, v: { ...r.v, paid: v ?? 0 } }))),
    displayCol<T19Row>('diff', 'Payable − Paid', (r) => diff(r), { tone: (r) => diffTone(diff(r), tol) }),
  ];
  return (
    <SectionCard title="19 · Late fee payable and paid" description="Typed here — not part of the firm's sheet.">
      <SheetGrid<T19Row> rows={rows} columns={columns} getRowId={(r) => r.id} onRowsChange={onRowsChange} readOnly={readOnly} label="GSTR-9 Table 19" />
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Tables 17 / 18 — HSN-wise summary
// ---------------------------------------------------------------------------

const HSN_PATTERN = /^\d{4}(\d{2}){0,2}$/;
/** The offline tool's / sheet's column order, for pasted blocks (Rate is shown after Taxable value on screen). */
const HSN_PASTE_ORDER = ['hsn', 'description', 'uqc', 'qty', 'concessional', 'rate', 'taxable', 'tax.i', 'tax.c', 'tax.s', 'tax.x'];
const CONCESSIONAL = [
  { value: 'N', label: 'No' },
  { value: 'Y', label: 'Yes' },
];

const blankHsn = (): HsnRow => ({
  id: newId(),
  hsn: '',
  description: '',
  uqc: '',
  qty: 0,
  concessional: false,
  rate: null,
  taxable: 0,
  igst: 0,
  cgst: 0,
  sgst: null,
  cess: 0,
});

const HsnGrid: React.FC<{ field: 't17' | 't18'; label: string }> = ({ field, label }) => {
  const { docs, update, readOnly } = useWorkspace();
  const rows = docs.gstr9[field];
  const implied = (r: HsnRow) => impliedRate(r.taxable, rowTax(r));

  const columns: GridColumn<HsnRow>[] = [
    {
      key: 'hsn',
      header: 'HSN',
      type: 'text',
      width: 96,
      sticky: true,
      value: (r) => r.hsn,
      onEdit: (r, e) => ({ ...r, hsn: e.text.replace(/\s+/g, '') }),
      tone: (r) => (r.hsn && !HSN_PATTERN.test(r.hsn) ? 'warn' : undefined),
      title: (r) => (r.hsn && !HSN_PATTERN.test(r.hsn) ? 'HSN / SAC should be 4, 6 or 8 digits' : undefined),
    },
    { key: 'description', header: 'Description', type: 'text', width: 160, value: (r) => r.description, onEdit: (r, e) => ({ ...r, description: e.text }) },
    { key: 'uqc', header: 'UQC', type: 'text', width: 72, value: (r) => r.uqc, onEdit: (r, e) => ({ ...r, uqc: e.text.trim().toUpperCase() }) },
    moneyCol<HsnRow>('qty', 'Total quantity', (r) => r.qty, (r, v) => ({ ...r, qty: v ?? 0 }), { width: 100 }),
    moneyCol<HsnRow>('taxable', 'Taxable value', (r) => r.taxable, (r, v) => ({ ...r, taxable: v ?? 0 }), { width: 120 }),
    {
      key: 'rate',
      header: 'Rate %',
      type: 'percent',
      width: 80,
      value: (r) => r.rate,
      onEdit: (r, e) => ({ ...r, rate: e.num }),
      tone: (r) => (rateMismatch(r.rate, implied(r)) ? 'warn' : undefined),
      title: (r) => {
        const ir = implied(r);
        return ir === null ? undefined : `Implied rate ${fmtRate(ir)}${rateMismatch(r.rate, ir) ? ' — does not match the rate' : ''}`;
      },
    },
    {
      key: 'concessional',
      header: 'Concessional',
      type: 'select',
      width: 96,
      options: CONCESSIONAL,
      value: (r) => (r.concessional ? 'Y' : 'N'),
      onEdit: (r, e) => ({ ...r, concessional: e.text === 'Y' }),
    },
    ...taxInCols<HsnRow>(
      (r) => ({ i: r.igst, c: r.cgst, s: r.sgst, x: r.cess }),
      (r, t) => ({ ...r, igst: t.i, cgst: t.c, sgst: t.s, cess: t.x }),
      { prefix: 'tax', cess: true },
    ),
  ];

  const totalTaxable = rows.reduce((s, r) => s + (Number(r.taxable) || 0), 0);
  const totalTax = addT(...rows.map((r) => rowTax(r)));

  return (
    <SheetGrid<HsnRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowsChange={(next) => update('gstr9', (d) => ({ ...d, [field]: next }))}
      readOnly={readOnly}
      newRow={blankHsn}
      canDelete
      addLabel="Add HSN"
      label={label}
      maxHeight={FORM_GRID_MAX_H}
      pasteOrder={HSN_PASTE_ORDER}
      emptyText="No HSN rows yet — paste the summary straight from Excel or the offline tool, or add a row."
      footer={[
        {
          key: 'total',
          label: `Total (${rows.length} row${rows.length === 1 ? '' : 's'})`,
          tone: 'total',
          cells: { taxable: totalTaxable, ...taxFooter('tax', totalTax, true) },
        },
      ]}
    />
  );
};

export const Table17: React.FC = () => (
  <SectionCard
    title="17 · HSN wise summary of outward supplies"
    description="Paste in this column order: HSN, Description, UQC, Quantity, Concessional (Y/N), Rate %, Taxable value, IGST, CGST, SGST, Cess. SGST left blank mirrors CGST."
  >
    <HsnGrid field="t17" label="GSTR-9 Table 17 HSN outward" />
  </SectionCard>
);

export const Table18: React.FC = () => (
  <SectionCard title="18 · HSN wise summary of inward supplies" description="Same column order as Table 17.">
    <HsnGrid field="t18" label="GSTR-9 Table 18 HSN inward" />
  </SectionCard>
);
