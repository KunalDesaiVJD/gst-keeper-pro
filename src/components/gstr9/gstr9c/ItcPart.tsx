import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GSTR9C_T16_KEYS, Gstr9cT16Key } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { MatrixRow, MatrixTable, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { ReasonsBox, RefStrip } from './bits';
import { FormGrid } from './FormGrid';
import { C9_MATRIX_SCROLL, figs, FormLine, headsText, n0, TAX_HEADS, toTax, useGoToStep } from './formLines';

const T12_LABEL = {
  A: 'ITC availed as per audited annual financial statement / books of account',
  B: 'ITC booked in earlier financial years claimed in current financial year',
  C: 'ITC booked in current financial year to be claimed in subsequent financial years',
  D: 'ITC availed as per audited financial statement or books of account',
  E: 'ITC claimed in annual return (GSTR-9)',
  F: 'Un-reconciled ITC',
} as const;

const T12_SOURCE: Record<'A' | 'B' | 'C', { short: string; title: string }> = {
  A: { short: 'Books net ITC', title: 'Net ITC as per books — PL-INPUT row 79 (P&L ITC − suspended ITC − other adjustments + RCM)' },
  B: { short: 'Last Year Effect', title: 'Last Year Effect — Duties & Taxes-INPUT row 9 (previous-year ITC booked in this FY)' },
  C: { short: 'GSTR-9 Table 13', title: 'GSTR-9 Table 13 — ITC of this FY availed in the next FY (typed on the ITC reco step)' },
};

/** GSTR-9C Table 14 rows as the firm's "GSTR 9C" sheet lays them out (A1/A2 are the sheet's own sub-rows). */
const T14_ROWS: Array<{ k: string; label: string; indent?: boolean }> = [
  { k: 'A', label: 'Purchases' },
  { k: 'A1', label: 'Less: suspended ITC (reversed, net of reclaims)', indent: true },
  { k: 'A2', label: 'Net purchases (A − A1) — reported in 14A', indent: true },
  { k: 'B', label: 'Freight / carriage' },
  { k: 'C', label: 'Power and fuel' },
  { k: 'D', label: 'Imported goods (including received from SEZs)' },
  { k: 'E', label: 'Rent and insurance' },
  { k: 'F', label: 'Goods lost, stolen, destroyed, written off or disposed of by way of gift or free samples' },
  { k: 'G', label: 'Royalty' },
  { k: 'H', label: "Employees' cost (salaries, wages, bonus etc.)" },
  { k: 'I', label: 'Conveyance charges' },
  { k: 'J', label: 'Bank charges' },
  { k: 'K', label: 'Entertainment charges' },
  { k: 'L', label: 'Stationery expenses (including postage etc.)' },
  { k: 'M', label: 'Repair and maintenance' },
  { k: 'N', label: 'Other miscellaneous expenses' },
  { k: 'O', label: 'Capital goods' },
  { k: 'P', label: 'Any other expense 1 (RCM)' },
  { k: 'Q', label: 'Any other expense 2' },
];

const T16_LABEL: Record<Gstr9cT16Key, string> = {
  A: 'Central tax',
  B: 'State/UT tax',
  C: 'Integrated tax',
  D: 'Cess',
  E: 'Interest',
  F: 'Penalty',
};

const HEADS_9C = ['t', 'c', 's', 'i', 'x'] as const;
const HEAD_LABELS_9C = { t: 'Value', c: 'Central tax', s: 'State/UT tax', i: 'Integrated tax', x: 'Cess' };

/** Shown on every ITC table of a builder on the NO_ITC scheme. */
export const NoItcNote: React.FC = () => {
  const { workings } = useWorkspace();
  if (!workings.ctx.noItcBuilder) return null;
  return <Note>This client is a builder on the NO_ITC scheme: zero ITC is expected, so the ITC differences below are for information only.</Note>;
};

/** Part IV — Tables 12 and 13: reconciliation of net ITC. */
export const Table12Card: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const C = docs.gstr9c;
  const W = workings.gstr9c;
  const def = W.defaults;

  const t12Lines = useMemo<FormLine[]>(() => {
    const over = (k: 'A' | 'B' | 'C'): FormLine => {
      const field = `t12${k}` as const;
      return {
        id: k,
        code: `12${k}`,
        label: T12_LABEL[k],
        hint: k === 'B' ? '(+)' : k === 'C' ? '(−)' : undefined,
        mode: 'override',
        heads: TAX_HEADS,
        stored: figs(C[field], false),
        def: figs(def.t12[k], false) ?? {},
        fKey: field,
        write: (d, v) => ({ ...d, [field]: v ? toTax(v) : null }),
        source: T12_SOURCE[k].short,
        sourceTitle: T12_SOURCE[k].title,
      };
    };
    return [
      over('A'),
      over('B'),
      over('C'),
      { id: 'D', code: '12D', label: T12_LABEL.D, hint: '(A + B − C)', mode: 'computed', heads: TAX_HEADS, shown: figs(W.t12.D, false) ?? {}, emphasis: 'total' },
      { id: 'E', code: '12E', label: T12_LABEL.E, mode: 'computed', heads: TAX_HEADS, shown: figs(W.t12.E, false) ?? {}, source: '= GSTR-9 7J' },
      { id: 'F', code: '12F', label: T12_LABEL.F, hint: '(E − D)', mode: 'computed', heads: TAX_HEADS, shown: figs(W.t12.F, false) ?? {}, emphasis: 'diff', diffKey: 'gstr9c.12F' },
    ];
  }, [C, def.t12, W.t12]);

  return (
    <SectionCard
      title="Table 12 · Reconciliation of net input tax credit"
      description="Books ITC for the year against the ITC claimed in GSTR-9. A–C are computed; type over any of them if the audited figures differ."
      excelRef="9C utility PT IV (12) · 12A ← PL-INPUT row 79"
    >
      <FormGrid label="GSTR-9C Table 12" lines={t12Lines} heads={TAX_HEADS} labelWidth={320} />
      <Note tone="position">
        12B defaults to the Last Year Effect and 12C to GSTR-9 Table 13. Table 13 is typed on the ITC reco step (with the reco’s MAX(books − 7J, 0) shown as a
        suggestion), because the residual is often an unexplained difference rather than ITC availed next year.
      </Note>
      <ReasonsBox field="t13Reasons" code="13" title="Reasons for un-reconciled difference in ITC" diffKey="gstr9c.12F" />
    </SectionCard>
  );
};

/** Part IV — Tables 14 and 15: ITC by expense head. */
export const Table14Card: React.FC = () => {
  const { workings } = useWorkspace();
  const go = useGoToStep();
  const W = workings.gstr9c;

  const t14Rows = useMemo<MatrixRow[]>(() => {
    const rows: MatrixRow[] = T14_ROWS.map((r) => ({
      key: r.k,
      code: `14${r.k}`,
      label: r.label,
      indent: r.indent,
      value: W.t14.rows[r.k],
    }));
    rows.push(
      { key: 'R', code: '14R', label: 'Total amount of eligible ITC availed', value: W.t14.R, total: true },
      { key: 'S', code: '14S', label: 'ITC claimed in annual return (GSTR-9)', value: W.t14.S, note: <span className="text-[10px] text-muted-foreground">= GSTR-9 7J</span> },
      { key: 'T', code: '14T', label: 'Un-reconciled ITC (R − S)', value: W.t14.T, total: true, signed: true, diffKey: 'gstr9c.14T' },
    );
    return rows;
  }, [W.t14]);

  const qBal = workings.c14.qBalancing;
  const qBalNonZero = [qBal.t, qBal.i, qBal.c, qBal.s, qBal.x].some((v) => Math.abs(v) >= 0.005);

  return (
    <SectionCard
      title="Table 14 · Reconciliation of ITC declared in GSTR-9 with ITC availed on expenses"
      description="ITC by expense head, computed from the Purchases & ITC ledgers and their 9C expense heads. Change a head on the Purchases step."
      excelRef="GSTR 9C rows 8–30"
      actions={
        <Button type="button" size="sm" variant="outline" onClick={() => go('expense')}>
          9C expense heads <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      }
    >
      <MatrixTable label="GSTR-9C Table 14" rows={t14Rows} heads={[...HEADS_9C]} headLabels={HEAD_LABELS_9C} className={C9_MATRIX_SCROLL} />
      {qBalNonZero && (
        <Note>
          14Q includes a balancing figure (value {fmtMoney(qBal.t)}; {headsText(qBal)}) so that R equals books net ITC, as the sheet’s D26 does. A large
          balancing figure usually means ledgers are missing their expense head.
        </Note>
      )}
      <Note tone="position">
        14P is the full RCM Part B (every expense block) — the sheet’s Part B taxable total adds only two of the four blocks.
      </Note>
      <ReasonsBox field="t15Reasons" code="15" title="Reasons for un-reconciled difference in ITC" diffKey="gstr9c.14T" />
    </SectionCard>
  );
};

/** Part IV — Table 16: tax payable on the un-reconciled ITC. */
export const Table16Card: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const C = docs.gstr9c;
  const W = workings.gstr9c;

  const t16Lines = useMemo<FormLine[]>(
    () =>
      GSTR9C_T16_KEYS.map((k) => ({
        id: k,
        code: `16${k}`,
        label: T16_LABEL[k],
        mode: 'typed' as const,
        heads: ['t' as const],
        stored: { t: n0(C.t16?.[k]) },
        fKey: `t16.${k}`,
        write: (d, v) => ({ ...d, t16: { ...d.t16, [k]: n0(v?.t) } }),
        // B (State/UT tax) is the Central tax figure: locked, entered through A.
        ...(k === 'B' ? { follows: 'A' } : {}),
      })),
    [C.t16],
  );

  return (
    <SectionCard
      title="Table 16 · Tax payable on un-reconciled difference in ITC"
      description="Due to the reasons in Tables 13 and 15. Typed."
      excelRef="9C utility PT IV (16)"
    >
      <RefStrip
        items={[
          { label: '12F un-reconciled ITC', value: headsText(W.t12.F) },
          { label: '14T un-reconciled ITC', value: headsText(W.t14.T) },
        ]}
      />
      <FormGrid label="GSTR-9C Table 16" lines={t16Lines} heads={['t']} headLabels={{ t: 'Amount payable (₹)' }} labelWidth={220} />
    </SectionCard>
  );
};
