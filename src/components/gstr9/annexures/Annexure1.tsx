import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { cn } from '@/lib/utils';
import { totalTax } from '@/lib/gstr9/engine';
import type { Formulas, Tax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { MatrixTable, Note, SectionCard, SourceChip, useDiffLine, type MatrixRow } from '../ui';
import { SheetGrid, type GridColumn } from '../grid/SheetGrid';
import { moneyCol, lockSgst } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { HEAD_NAME, pickFormulas, putFormulas } from './taxRows';
import { StepLink } from './StepLink';

/** The two lines of Annexure-1 that staff type (the rest is computed). */
interface EntryRow {
  id: 'nongst' | 'return';
  label: string;
  hint: string;
  t: number;
  i: number;
  c: number;
  /** null = mirrors CGST. */
  s: number | null;
  x: number;
  /** Typed "=a+b" expressions by column key (kept in AnnexuresDoc.f under the field name). */
  f?: Formulas;
}

const FIELD: Record<EntryRow['id'], 'a1NonGstIncome' | 'a1SaleReturn'> = { nongst: 'a1NonGstIncome', return: 'a1SaleReturn' };

const hasTax = (r: EntryRow) => r.id === 'return';

/**
 * Payable − paid. A positive difference is tax short paid (a DRC-03
 * liability) and is the one flagged; an excess payment is only noted. Each
 * says which it is in words, not by colour alone.
 */
const PayDiff: React.FC<{ value: number; tolerance: number }> = ({ value, tolerance }) => {
  const short = value > tolerance;
  const excess = value < -tolerance;
  return (
    <span
      className={cn('tabular-nums', short && 'font-medium text-destructive-strong', excess && 'text-muted-foreground')}
      title={short ? 'Short paid — payable through DRC-03 (Annexure-3 row 1)' : excess ? 'Paid in excess of the books liability' : undefined}
    >
      {fmtMoney(value)}
      {short && <span className="ml-1 text-[10px] font-normal">short</span>}
      {excess && <span className="ml-1 text-[10px]">excess</span>}
    </span>
  );
};

const Entered: React.FC = () => <Badge variant="outline" className="text-[10px] font-normal">Typed below</Badge>;

const Annexure1: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const a = workings.ann1;
  const A = docs.annexures;
  const sr = A.a1SaleReturn;
  const gstr9Fetched = workings.g9.t4Source === 'portal';
  const rcmPartASource = workings.rcm.partASource;
  const paidLine = useDiffLine('ann1.paid');
  const paidReason = paidLine?.justification?.text?.trim();

  // ------------------------------------------------------------ Income reco (ANNEXURE B5:G15)
  const incomeRows: MatrixRow[] = [
    { key: 'A', code: 'A', label: 'Gross taxable income as per P/L', value: a.A, note: <span className="text-[11px] text-muted-foreground">Sales · Part A</span> },
    {
      key: 'A+', code: '', label: 'Net non-GST income as per P/L', value: { t: a.nonGst }, indent: true,
      note: A.a1NonGstIncome ? <Entered /> : <span className="text-[11px] text-muted-foreground">only if included in Table 4</span>,
    },
    {
      key: 'B', code: 'B', label: 'Sale return as per P/L', value: a.B,
      note: totalTax(sr) || sr.t ? <Entered /> : <span className="text-[11px] text-muted-foreground">only if not netted in Sales</span>,
    },
    { key: 'C', code: 'C', label: 'Total income from P/L (A + non-GST − B)', value: a.C, total: true },
    { key: 'D', code: 'D', label: 'Tax paid on RCM as per books', value: a.D, note: <span className="text-[11px] text-muted-foreground">RCM · Part B</span> },
    { key: 'E', code: 'E', label: 'Total as per books (C + D) — "total as per new GSTR-9"', value: a.E, total: true },
    {
      key: 'F', code: 'F', label: 'Total as per auto-calculated GSTR-9 (Table 4 total + RCM Part A)', value: a.F,
      note: <SourceChip meta={docs.portal.gstr9Meta} />,
    },
    { key: 'G', code: 'G', label: 'Difference (E − F)', value: a.G, total: true, signed: true, diffKey: 'ann1.income' },
  ];

  // ------------------------------------------------------------ Paid & payable (ANNEXURE C17:F21)
  const heads: Array<keyof Tax> = ['i', 'c', 's', 'x'];
  const paidRows: MatrixRow[] = [
    ...heads.map<MatrixRow>((h) => ({
      key: h,
      label: HEAD_NAME[h],
      value: { t: a.payable[h], i: a.paid[h], c: a.payDiff[h] },
      cells: { c: <PayDiff value={a.payDiff[h]} tolerance={workings.tolerance} /> },
    })),
    {
      key: 'total',
      label: 'Total',
      value: { t: totalTax(a.payable), i: totalTax(a.paid), c: totalTax(a.payDiff) },
      cells: { c: <PayDiff value={totalTax(a.payDiff)} tolerance={workings.tolerance} /> },
      total: true,
      diffKey: 'ann1.paid',
    },
  ];

  // ------------------------------------------------------------ The two typed lines
  const entryRows: EntryRow[] = [
    {
      id: 'nongst',
      label: 'Net non-GST income as per P/L',
      hint: 'Only if it is included in the Table 4 figures — it is added to C, as in the sheet (D9).',
      t: A.a1NonGstIncome, i: 0, c: 0, s: null, x: 0, f: pickFormulas(A.f, FIELD.nongst),
    },
    {
      id: 'return',
      label: 'B · Sale return as per P/L',
      hint: 'Only if returns are not already entered as negative rows in Sales — otherwise leave 0.',
      t: sr.t, i: sr.i, c: sr.c, s: Math.abs(sr.s - sr.c) < 0.005 ? null : sr.s, x: sr.x, f: pickFormulas(A.f, FIELD.return),
    },
  ];
  const entryCols: GridColumn<EntryRow>[] = [
    {
      key: 'label', header: 'Line', type: 'display', align: 'left', width: 440,
      value: (r) => r.label,
      render: (r) => (
        <div className="whitespace-normal py-1 leading-snug">
          <div className="font-medium">{r.label}</div>
          <div className="text-[11px] text-muted-foreground">{r.hint}</div>
        </div>
      ),
    },
    moneyCol<EntryRow>('t', 'Amount', (r) => r.t, (r, v) => ({ ...r, t: v ?? 0 }), { width: 140 }),
    moneyCol<EntryRow>('i', 'IGST', (r) => (hasTax(r) ? r.i : null), (r, v) => ({ ...r, i: v ?? 0 }), { editable: hasTax }),
    // SGST mirrors CGST and is locked (lockSgst): a CGST entry carries it.
    moneyCol<EntryRow>('c', 'CGST', (r) => (hasTax(r) ? r.c : null), (r, v) => ({ ...r, c: v ?? 0, s: null }), { editable: hasTax }),
    lockSgst(moneyCol<EntryRow>('s', 'SGST', (r) => (hasTax(r) ? r.s : null), (r) => r, {
      nullable: true,
      placeholder: (r) => (hasTax(r) ? r.c : null),
    })),
    moneyCol<EntryRow>('x', 'Cess', (r) => (hasTax(r) ? r.x : null), (r, v) => ({ ...r, x: v ?? 0 }), { editable: hasTax, width: 96 }),
  ];
  const onEntriesChange = (next: EntryRow[]) => {
    const ng = next.find((r) => r.id === 'nongst');
    const rt = next.find((r) => r.id === 'return');
    update('annexures', (d) => {
      let f = d.f;
      if (ng) f = putFormulas(f, FIELD.nongst, ng.f);
      if (rt) f = putFormulas(f, FIELD.return, rt.f);
      return {
        ...d,
        a1NonGstIncome: ng ? ng.t : d.a1NonGstIncome,
        a1SaleReturn: rt ? { t: rt.t, i: rt.i, c: rt.c, s: rt.s ?? rt.c, x: rt.x } : d.a1SaleReturn,
        f,
      };
    });
  };

  return (
    <div className="space-y-3">
      <SectionCard
        title="Annexure-1 — Income reconciliation"
        description="Income as per books (P/L and RCM) against the GSTR-9 the portal auto-calculates."
        excelRef="ANNEXURE B5:G15"
      >
        {!gstr9Fetched && (
          <Note tone="warn">
            The GSTR-9 system-computed figures are not fetched yet, so F holds only RCM Part A.{' '}
            <StepLink step="portal">Fetch them on Portal data</StepLink>
          </Note>
        )}
        {gstr9Fetched && rcmPartASource === 'none' && (
          <Note tone="info">RCM Part A (3.1(d) of the as-filed GSTR-3B) is not fetched; F has no RCM component.</Note>
        )}
        <MatrixTable
          rows={incomeRows}
          heads={['t', 'i', 'c', 's', 'x']}
          headLabels={{ t: 'Amount' }}
          label="Annexure-1 income reconciliation"
          // Figure columns as wide as their figures, so each label and its source fit on one line.
          className="[&_td:nth-child(2)]:min-w-[15rem] [&_th:nth-child(n+3)]:min-w-[6.5rem]"
        />

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lines you enter</h4>
          <SheetGrid<EntryRow>
            rows={entryRows}
            columns={entryCols}
            getRowId={(r) => r.id}
            onRowsChange={onEntriesChange}
            readOnly={readOnly}
            label="Annexure-1 entries: non-GST income and sale return"
          />
        </div>

        <Note tone="position">
          RCM Part B (D) adds every expense block; the sheet&apos;s RCM D28:D39 added only two of the four, so D and G can differ
          from the sheet by the missing blocks (§6 item 1).
        </Note>
      </SectionCard>

      <SectionCard
        title="Paid & payable"
        description="Tax payable as per books (E) against tax paid as per GSTR-9 Table 9 — cash plus ITC. The difference feeds Annexure-3 row 1."
        excelRef="ANNEXURE C17:G21"
      >
        {!gstr9Fetched && (
          <Note tone="warn">
            Table 9 (tax paid) comes from the GSTR-9 system-computed figures, which are not fetched yet.{' '}
            <StepLink step="portal">Portal data</StepLink>
          </Note>
        )}
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_15rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
          <MatrixTable
            rows={paidRows}
            heads={['t', 'i', 'c']}
            headLabels={{ t: 'Payable (books, E)', i: 'Paid (GSTR-9 Table 9)', c: 'Difference' }}
            label="Annexure-1 paid and payable"
            className="[&_th:nth-child(2)]:min-w-[8rem] [&_th:nth-child(n+3)]:min-w-[6.5rem]"
          />
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <div className="mb-0.5 font-semibold text-muted-foreground">Reason for the difference (sheet note G19)</div>
            {paidReason ? (
              <p className="whitespace-pre-wrap">{paidReason}</p>
            ) : (
              <p className="text-muted-foreground">
                Not written yet — use the status button on the Total line, e.g. &quot;export liability for October paid twice, under 3.1(a) and 3.1(b)&quot;.
              </p>
            )}
          </div>
        </div>
        <Note tone="position">SGST payable is taken from the SGST head; the sheet copied CGST (D21 = D20) (§6 item 6).</Note>
      </SectionCard>
    </div>
  );
};

export default Annexure1;
