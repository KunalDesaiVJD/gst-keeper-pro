import React from 'react';
import { totalTax, tin } from '@/lib/gstr9/engine';
import { newId, zIn } from '@/lib/gstr9/defaults';
import type { AnnexureOtherPayment } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { KpiTile, Note, SectionCard } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { displayCol, taxFooter, taxInCols } from '../grid/columns';
import { FixedTaxGrid, type FixedTaxRow } from './FixedTaxGrid';
import { StepLink } from './StepLink';
import { ANNEX_TAB_PARAM, rupees } from './taxRows';

const Annexure3: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const w = workings.ann3;
  const A = docs.annexures;
  const tol = workings.tolerance;

  // ------------------------------------------------------------ Rows 1–3
  const topRows: FixedTaxRow[] = [
    {
      id: 'r1', no: '1', kind: 'computed', value: w.clause9,
      label: 'Clause 9 difference of GSTR-9',
      hint: 'Annexure-1 paid & payable: payable (books) − paid (Table 9)',
    },
    {
      id: 'r2', no: '2', kind: 'override', value: w.rcmToPay, stored: A.a3RcmToPay,
      label: 'RCM to be paid (as per RCM sheet)',
      hint: 'Suggested: RCM in the books (Part B) not paid on the portal (Part A), per head',
      defaultChip: 'Suggested', resetLabel: 'Use suggested', defaultValue: w.rcmToPaySuggested,
      onChange: (v) => update('annexures', (d) => ({ ...d, a3RcmToPay: v })),
    },
    {
      id: 'r3', no: '3', kind: 'override', value: w.excessItc, stored: A.a3ExcessItc,
      label: 'Excess ITC claimed as per reco',
      hint: 'Suggested: GSTR-9 Table 12 (ITC of the year reversed in the next year)',
      defaultChip: 'Suggested (Table 12)', resetLabel: 'Use suggested', defaultValue: w.excessItcSuggested,
      onChange: (v) => update('annexures', (d) => ({ ...d, a3ExcessItc: v })),
    },
  ];

  // ------------------------------------------------------------ Row 4 — any other payment (a list)
  type Other = AnnexureOtherPayment;
  const otherCols: GridColumn<Other>[] = [
    {
      key: 'description', header: 'Description', type: 'text', width: 300,
      value: (r) => r.description,
      onEdit: (r, e) => ({ ...r, description: e.text }),
    },
    ...taxInCols<Other>((r) => ({ i: r.i, c: r.c, s: r.s, x: r.x }), (r, t) => ({ ...r, ...t }), { prefix: 'o', cess: true }),
    displayCol<Other>('total', 'Total', (r) => totalTax(tin(r))),
  ];

  // ------------------------------------------------------------ Total → DRC-03
  const positive = (_h: string, v: number) => (v > tol ? ('error' as const) : undefined);
  const sumRows: FixedTaxRow[] = [
    { id: 'total', kind: 'computed', value: w.total, emphasis: true, label: 'Total (1 + 2 + 3 + 4)', hint: 'Signed, as the sheet (D46)' },
    { id: 'payable', kind: 'computed', value: w.payable, label: 'DRC-03 payable', hint: 'Heads that come out positive' },
    { id: 'excess', kind: 'computed', value: w.excessPaid, label: 'Excess paid — not payable by DRC-03', hint: 'Heads that come out negative, shown positive' },
    {
      id: 'already', kind: 'typed', value: w.alreadyPaid, stored: A.a3AlreadyPaid,
      label: 'Already paid by DRC-03', hint: 'DRC-03 already filed for this FY',
      onChange: (v) => update('annexures', (d) => ({ ...d, a3AlreadyPaid: v ?? zIn() })),
    },
    { id: 'balance', kind: 'computed', value: w.balance, emphasis: true, label: 'Balance to pay', tone: positive },
  ];

  const payable = totalTax(w.payable);
  const already = totalTax(w.alreadyPaid);
  const balance = totalTax(w.balance);
  const excess = totalTax(w.excessPaid);

  return (
    <SectionCard
      title="Annexure-3 — DRC-03 working"
      description="What remains to be paid through DRC-03 after the annual reconciliation."
      excelRef="ANNEXURE B39:G46"
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile label="DRC-03 payable" value={rupees(payable)} />
        <KpiTile label="Already paid by DRC-03" value={rupees(already)} />
        <KpiTile label="Balance to pay" value={rupees(balance)} tone={balance > tol ? 'error' : 'ok'} />
        <KpiTile label="Excess paid" value={rupees(excess)} hint="not payable by DRC-03" tone={excess > tol ? 'warn' : 'neutral'} />
      </div>

      <FixedTaxGrid rows={topRows} label="Annexure-3 rows 1 to 3" readOnly={readOnly} />
      <p className="text-[11px] text-muted-foreground">
        Row 1 follows{' '}
        <StepLink step="annexures" extra={{ [ANNEX_TAB_PARAM]: 'a1' }}>Annexure-1 paid &amp; payable</StepLink>; rows 2 and 3
        start from the suggestion (grey italics) — type over it to use your own figure. Table 12 is set on the{' '}
        <StepLink step="itc">ITC reco</StepLink> step.
      </p>

      <div className="space-y-1.5">
        <h4 className="text-sm font-semibold">4 · Any other payment (to be specified)</h4>
        <SheetGrid<Other>
          rows={A.a3Other}
          columns={otherCols}
          getRowId={(r) => r.id}
          onRowsChange={(rows) => update('annexures', (d) => ({ ...d, a3Other: rows }))}
          readOnly={readOnly}
          newRow={() => ({ id: newId(), description: '', ...zIn() })}
          canDelete
          addLabel="Add payment"
          emptyText="None. Add a line for any other tax to be paid through DRC-03, with what it is for."
          footer={
            A.a3Other.length
              ? [{ key: 'sum', label: 'Total — row 4', tone: 'total', cells: { ...taxFooter('o', w.other, true), total: totalTax(w.other) } }]
              : undefined
          }
          label="Annexure-3 row 4: any other payment"
        />
      </div>

      <FixedTaxGrid rows={sumRows} label="Annexure-3 total and DRC-03 balance" readOnly={readOnly} showNo={false} />

      <Note tone="position">
        The total keeps the sheet&apos;s signed sum; DRC-03 is payable only on heads that come out positive, excess paid is shown
        separately, and the DRC-03 already paid is set off. Rows 2 and 3 are prefilled with a suggestion you can overwrite — the
        sheet types them (§6 item 7).
      </Note>
    </SectionCard>
  );
};

export default Annexure3;
