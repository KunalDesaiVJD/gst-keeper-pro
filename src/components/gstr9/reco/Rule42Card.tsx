import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { emptyRule42, emptyRule42Month } from '@/lib/gstr9/defaults';
import { latestTrueUpPeriod, validPeriod, type R42Tag, type Rule42Period } from '@/lib/gstr9/rule42';
import type { MonthKey, Rule42Doc, Rule42Month, Tax, TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { KpiTile, Note, SectionCard } from '../ui';
import { SheetGrid, type GridColumn, type GridFooterRow } from '../grid/SheetGrid';
import { displayCol, moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { FigureTable, type FigColumn, type FigRow } from './FigureTable';
import { taxToIn, withFormulas } from './helpers';

// ITC reco › Rule 42/43 — the Rule 42 working (src/lib/gstr9/rule42.ts):
// month by month (quarter by quarter for QRMP) the provisional reversal
// against what each GSTR-3B reversed, then the annual final, the true-up and
// the interest. Edits go to docs.gstr9.r42; a quarter's entries sit on its
// last month (where the as-filed quarterly GSTR-3B sits).

type Head = 'i' | 'c' | 'x';
const HEADS: Array<{ h: Head; label: string }> = [
  { h: 'c', label: 'CGST (= SGST)' },
  { h: 'i', label: 'IGST' },
  { h: 'x', label: 'Cess' },
];
type TaxField = R42Tag | 'reversed';

interface PRow {
  id: string;
  p: Rule42Period;
  /** The month entries are stored on (the period's last month). */
  m: MonthKey;
  doc: Rule42Month;
}

const tot = (t: Tax) => t.i + t.c + t.s + t.x;
const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const RATIO_SOURCE: Record<Rule42Period['ratioSource'], string> = {
  typed: 'typed', portal: 'as-filed 3B', carried: 'last period with turnover', annual: "year's ratio (no 3B data)", none: 'no turnover',
};

const Rule42Card: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const R: Rule42Doc = docs.gstr9.r42 ?? emptyRule42();
  const W = workings.r42;
  const B = workings.builderRev;
  const [head, setHead] = useState<Head>('c');

  const setR = (fn: (r: Rule42Doc) => Rule42Doc) => update('gstr9', (d) => ({ ...d, r42: fn(d.r42 ?? emptyRule42()) }));

  const rows: PRow[] = useMemo(
    () => W.periods.map((p) => {
      const m = p.months[p.months.length - 1];
      return { id: p.key, p, m, doc: { ...emptyRule42Month(), ...(R.months?.[m] ?? {}) } };
    }),
    [W.periods, R.months],
  );

  const taxCell = (field: TaxField, header: string, computed?: (p: Rule42Period) => Tax): GridColumn<PRow> =>
    moneyCol<PRow>(
      `${field}.${head}`,
      header,
      (r) => (r.doc[field] ? (r.doc[field] as TaxIn)[head] : null),
      (r, n) => {
        const cur = r.doc[field] as TaxIn | null;
        if (n === null) return { ...r, doc: { ...r.doc, [field]: null } };
        const base: TaxIn = cur ? { ...cur } : computed ? taxToIn(computed(r.p)) : { i: 0, c: 0, s: null, x: 0 };
        base[head] = n;
        if (head === 'c') base.s = null; // SGST follows CGST
        return { ...r, doc: { ...r.doc, [field]: base } };
      },
      {
        nullable: true,
        width: 112,
        group: field === 'reversed' ? 'In the GSTR-3B' : 'Credit',
        placeholder: computed ? (r) => computed(r.p)[head] : undefined,
        title: () => (computed ? 'Spread from the Purchases / RCM tags by the month’s share of T — type to override' : 'The Rule 42 part of the 4(B)(1) of this return'),
      },
    );

  const columns: GridColumn<PRow>[] = [
    { key: 'period', header: 'Period', type: 'display', align: 'left', width: 120, sticky: true, value: (r) => r.p.label },
    displayCol<PRow>('itc', '4A credit', (r) => r.p.itc[head], { group: 'Credit', width: 112, title: () => 'GSTR-3B 4A total as filed' }),
    taxCell('cg', 'Capital goods (out)', (p) => p.cg),
    displayCol<PRow>('t', 'T', (r) => r.p.t[head], { group: 'Credit', width: 112 }),
    taxCell('t1', 'T1 non-business', (p) => p.t1),
    taxCell('t2', 'T2 exempt only', (p) => p.t2),
    taxCell('t3', 'T3 blocked', (p) => p.t3),
    taxCell('t4', 'T4 taxable only', (p) => p.t4),
    displayCol<PRow>('c2', 'C2 common', (r) => r.p.c2[head], { group: 'Credit', width: 112 }),
    moneyCol<PRow>('e', 'E exempt', (r) => r.doc.e, (r, n) => ({ ...r, doc: { ...r.doc, e: n } }), {
      nullable: true, group: 'Turnover', width: 124, placeholder: (r) => r.p.e,
      title: () => 'Exempt supplies: as-filed 3B 3.1(c) + 3.1(e) — type to override (e.g. other Schedule III items out, reverse charge outward in)',
    }),
    moneyCol<PRow>('f', 'F total', (r) => r.doc.f, (r, n) => ({ ...r, doc: { ...r.doc, f: n } }), {
      nullable: true, group: 'Turnover', width: 124, placeholder: (r) => r.p.f,
      title: () => 'Total turnover in the State: as-filed 3B 3.1(a) + (b) + (c) + (e) — type to override',
    }),
    {
      key: 'ratio', header: 'E ÷ F', type: 'display', group: 'Turnover', width: 96,
      value: (r) => pct(r.p.ratio),
      title: (r) => `From ${RATIO_SOURCE[r.p.ratioSource]}`,
      tone: (r) => (r.p.ratioSource === 'annual' || r.p.ratioSource === 'none' ? 'warn' : undefined),
    },
    displayCol<PRow>('d1', 'D1', (r) => r.p.d1[head], { group: 'Rule 42', width: 104 }),
    displayCol<PRow>('d2', 'D2', (r) => r.p.d2[head], { group: 'Rule 42', width: 96 }),
    displayCol<PRow>('prov', 'Provisional', (r) => r.p.provisional[head], { group: 'Rule 42', width: 112 }),
    taxCell('reversed', 'Reversed'),
    displayCol<PRow>('short', 'Short (excess)', (r) => r.p.short[head], {
      group: 'In the GSTR-3B', width: 116, tone: (r) => (r.p.short[head] > 0.5 ? 'warn' : undefined),
    }),
    {
      key: 'noint', header: 'Interest', type: 'select', width: 130, group: 'Interest u/s 50',
      options: [{ value: 'due', label: 'Due' }, { value: 'none', label: 'Not utilised' }],
      value: (r) => (r.doc.notUtilised ? 'none' : 'due'),
      title: () => 'Rule 88B(3): “Not utilised” only where the credit ledger never fell below the short reversal — give the reason',
      onEdit: (r, e) => ({ ...r, doc: { ...r.doc, notUtilised: e.text === 'none' } }),
    },
    {
      key: 'reason', header: 'Reason', type: 'text', width: 200, align: 'left', group: 'Interest u/s 50',
      value: (r) => r.doc.notUtilisedReason,
      editable: (r) => r.doc.notUtilised,
      placeholder: (r) => (r.doc.notUtilised ? 'Why no interest' : ''),
      onEdit: (r, e) => ({ ...r, doc: { ...r.doc, notUtilisedReason: e.text } }),
    },
    displayCol<PRow>('int', 'Amount', (r) => r.p.interest[head], { group: 'Interest u/s 50', width: 100 }),
  ];

  const onRowsChange = (next: PRow[]) =>
    setR((r) => {
      const months = { ...r.months };
      next.forEach((row) => {
        const d = row.doc;
        const clean = (v: TaxIn | null) => (v ? withFormulas(v, v.f) : null);
        months[row.m] = { ...d, t1: clean(d.t1), t2: clean(d.t2), t3: clean(d.t3), t4: clean(d.t4), cg: clean(d.cg), reversed: clean(d.reversed) };
      });
      return { ...r, months };
    });

  const sum = (k: keyof Rule42Period) => W.periods.reduce((s, p) => s + ((p[k] as Tax)[head] ?? 0), 0);
  const footer: GridFooterRow[] = [{
    key: 'total', label: 'Year', tone: 'total',
    cells: {
      itc: sum('itc'), [`cg.${head}`]: sum('cg'), t: sum('t'), [`t1.${head}`]: sum('t1'), [`t2.${head}`]: sum('t2'), [`t3.${head}`]: sum('t3'),
      [`t4.${head}`]: sum('t4'), c2: sum('c2'), e: W.periodsE, f: W.periodsF, d1: sum('d1'), d2: sum('d2'), prov: sum('provisional'),
      [`reversed.${head}`]: sum('reversed'), short: sum('short'), int: sum('interest'),
    },
  }];

  const H = (t: Tax) => t[head];
  const annualCols: FigColumn[] = [{ key: 'v', header: HEADS.find((x) => x.h === head)!.label, width: 140 }];
  const A = W.annual;
  const annualRows: FigRow[] = [
    { key: 't', label: 'T — credit on inputs and input services (4A less capital goods)', values: { v: H(A.t) } },
    { key: 't13', label: 'less T1 + T2 + T3', values: { v: -(H(A.t1) + H(A.t2) + H(A.t3)) }, kind: 'sub' },
    { key: 'c1', label: 'C1', values: { v: H(A.c1) } },
    { key: 't4', label: 'less T4 (taxable only)', values: { v: -H(A.t4) }, kind: 'sub' },
    { key: 'c2', label: 'C2 — common credit', values: { v: H(A.c2) }, kind: 'total' },
    { key: 'ef', label: `E ÷ F for the year: ${fmtMoney(A.e)} ÷ ${fmtMoney(A.f)} = ${pct(A.ratio)} (${A.ratioSource === 'books' ? 'Sales, books' : A.ratioSource === 'periods' ? 'Σ of the periods' : 'no turnover'})`, values: {} },
    { key: 'd1', label: 'D1 = E ÷ F × C2', values: { v: H(A.d1) } },
    { key: 'd2', label: 'D2 = 5% × C2 (non-business)', values: { v: H(A.d2) } },
    { key: 'final', code: '7C', label: 'Final for the year — GSTR-9 Table 7C', values: { v: H(A.final) }, kind: 'total' },
    { key: 'prov', label: 'Provisional, Σ of the periods', values: { v: H(W.provisional) } },
    { key: 'tu', label: 'True-up: final less provisional', values: { v: H(W.trueUp) } },
    { key: 'rev', label: 'Reversed in the GSTR-3Bs (Rule 42 part of 4(B)(1))', values: { v: H(W.reversed) } },
    { key: 'pay', label: `Still to reverse by ${W.postingPeriod} → Payables`, values: { v: H(W.payable) }, kind: 'total' },
    { key: 'rc', label: `Credit to take back by ${W.latestPeriod}`, values: { v: H(W.recredit) } },
    { key: 'itu', label: `Interest on the true-up, ${W.trueUpInterestDays} days from 1 April at 18%`, values: { v: H(W.interestTrueUp) } },
    { key: 'ish', label: 'Interest on short periods, from each return’s due date', values: { v: H(W.interestShort) } },
    { key: 'int', label: 'Interest u/s 50 → Payables', values: { v: H(W.interest) }, kind: 'total' },
  ];

  const postingOk = validPeriod(R.postingPeriod ?? '') || !R.postingPeriod;
  return (
    <SectionCard
      title="Rule 42 — common credit used for exempt supplies"
      description="Month by month (quarter by quarter for QRMP) the provisional reversal against what each GSTR-3B reversed, then the final for the year (rule 42(2)), the true-up and interest u/s 50. GSTR-9 7C takes the final figure while the working is on."
      excelRef="Rules 42(1), 42(2) · GSTR-9 7C"
      actions={(
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={!!R.enabled} disabled={readOnly || workings.ctx.noItcBuilder} onCheckedChange={(v) => setR((r) => ({ ...r, enabled: v }))} />
          Use for GSTR-9 7C
        </label>
      )}
    >
      {workings.ctx.noItcBuilder && <Note tone="info">No-ITC builder: every month’s credit is reversed in full, so there is nothing to apportion.</Note>}
      {!W.applies && !workings.ctx.noItcBuilder && (
        <Note tone="info">No exempt supplies in the year (Sales Part B classes) or no credit: Rule 42 does not bite. Classify Part B ledgers on Sales and tag credit use on Purchases and RCM first.</Note>
      )}
      <Note tone="position">
        7C is the final figure for the year; the part not yet reversed by a GSTR-3B goes to Payables with interest at 18% (true-up from 1 April after the year, short months from their due dates, unless the ledger never fell below). A re-credit is shown, never netted. Builder project credit keeps the carpet-area working of Builder › ITC Reversal.
      </Note>
      {W.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      {!workings.r42Turnover && (
        <Note tone="info">The turnover method is off: 7C and 7D take only the approved Builder ITC Reversal working; the periods below are shown, not used.</Note>
      )}
      {B.workings.length > 0 && (
        <div className="space-y-1 rounded border border-border bg-muted/30 p-2 text-xs">
          <div className="font-semibold">Builder project credit — approved Builder › ITC Reversal working{B.workings.length > 1 ? 's' : ''} posted in this year</div>
          {B.workings.map((b) => (
            <div key={b.id} className="flex flex-wrap gap-x-4 tabular-nums">
              <span className="min-w-40">{b.project}</span>
              <span>Completion {b.completionDate.split('-').reverse().join('-')}</span>
              <span>Posted in {b.postingPeriod}</span>
              <span>Rule 42 {fmtMoney(tot(b.r42))}</span>
              <span>Rule 43 {fmtMoney(tot(b.r43))}</span>
            </div>
          ))}
          <div className="text-muted-foreground">
            Into 7C {fmtMoney(tot(B.r42))} and 7D {fmtMoney(tot(B.r43))} (already in that GSTR-3B’s 4(B)(1), so kept out of 7E)
            {tot(B.recredit) > 0.5 ? `; re-credit ${fmtMoney(tot(B.recredit))} in 4(A)(5), check it in Table 6H` : ''}.
            Tag the project’s own credit T4 or T2 on Purchases so the turnover method covers only credit common to the whole business, or switch the turnover method off.
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <KpiTile label="7C (all heads)" value={fmtMoney(tot(workings.g9.t7.C))} hint={tot(B.r42) > 0.005 ? `incl. builder ${fmtMoney(tot(B.r42))}` : 'Final for the year'} />
        <KpiTile label="Reversed in 3B" value={fmtMoney(W.reversed.i + W.reversed.c + W.reversed.s + W.reversed.x)} />
        <KpiTile label="Still to reverse" value={fmtMoney(W.payable.i + W.payable.c + W.payable.s + W.payable.x)} tone={W.payable.i + W.payable.c + W.payable.x > 0.5 ? 'warn' : 'ok'} />
        <KpiTile label="Interest u/s 50" value={fmtMoney(W.interest.i + W.interest.c + W.interest.s + W.interest.x)} />
      </div>

      <div className="flex flex-wrap items-end gap-4 text-xs">
        <label className="flex items-center gap-2">
          <Switch checked={R.turnover !== false} disabled={readOnly} onCheckedChange={(v) => setR((r) => ({ ...r, turnover: v }))} />
          Turnover method (E ÷ F)
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={!!R.d2} disabled={readOnly} onCheckedChange={(v) => setR((r) => ({ ...r, d2: v }))} />
          D2 — common credit also used for non-business (5%)
        </label>
        {R.d2 && (
          <Input className="h-8 w-72 text-xs" disabled={readOnly} placeholder="Why D2 applies" defaultValue={R.d2Reason}
            onBlur={(e) => { const v = e.target.value; if (v !== R.d2Reason) setR((r) => ({ ...r, d2Reason: v })); }} />
        )}
        <label className="flex items-center gap-2">
          True-up in GSTR-3B of
          <Input className={`h-8 w-24 text-xs ${postingOk ? '' : 'border-destructive'}`} disabled={readOnly} placeholder={latestTrueUpPeriod(workings.ctx.financialYear)} defaultValue={R.postingPeriod ?? ''}
            onBlur={(e) => { const v = e.target.value.trim(); setR((r) => ({ ...r, postingPeriod: v ? v : null })); }} />
        </label>
        <div className="ml-auto flex items-center gap-1">
          {HEADS.map((x) => (
            <button key={x.h} type="button" onClick={() => setHead(x.h)}
              className={`rounded border px-2 py-1 ${head === x.h ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground'}`}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <SheetGrid<PRow> label="Rule 42 by tax period" rows={rows} columns={columns} getRowId={(r) => r.id} readOnly={readOnly} onRowsChange={onRowsChange} footer={footer} maxHeight="calc(100vh - 320px)" />

      <FigureTable label="Rule 42 — final for the year" columns={annualCols} rows={annualRows} />
    </SectionCard>
  );
};

export default Rule42Card;
