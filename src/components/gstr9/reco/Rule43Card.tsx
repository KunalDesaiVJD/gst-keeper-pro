import React, { useCallback, useMemo, useState } from 'react';
import { emptyRule42, emptyRule42Month } from '@/lib/gstr9/defaults';
import { ITC_ROUTE_LABEL, newCgAsset, type CapitalGoodsAsset, type UseClass } from '@/lib/gstr9/capitalGoods';
import { USE_CLASS_LABEL, type Rule43Asset, type Rule43Period } from '@/lib/gstr9/rule43';
import type { MonthKey, Rule42Doc, Rule42Month, Tax, TaxIn } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { KpiTile, Note, SectionCard } from '../ui';
import { SheetGrid, type GridColumn, type GridFooterRow } from '../grid/SheetGrid';
import { displayCol, lockSgst, moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { fmtIsoDate, parseDateInput } from '../purchases/CapitalGoodsSold';
import { taxToIn, withFormulas } from './helpers';

// ITC reco › Rule 42/43 — the Rule 43 working (src/lib/gstr9/rule43.ts): the
// client's capital goods register (shared with s.18(6) on Purchases › Capital
// goods sold) as Rule 43 reads it, then Tr and Te period by period against
// what each GSTR-3B reversed. The register's edits save to the register; the
// periods' "reversed" go to docs.gstr9.r42.months[m].reversed43.

type Head = 'i' | 'c' | 'x';
const HEADS: Array<{ h: Head; label: string }> = [
  { h: 'c', label: 'CGST (= SGST)' },
  { h: 'i', label: 'IGST' },
  { h: 'x', label: 'Cess' },
];
const tot = (t: Tax) => t.i + t.c + t.s + t.x;
const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const START = '2000-01-01';

const fyBounds = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
};

/** In this year's Rule 43 view: bought by the year end and not disposed of before it began. */
const inYear = (a: CapitalGoodsAsset, fy: string) => {
  const { from, to } = fyBounds(fy);
  if (a.invoiceDate && a.invoiceDate > to) return false;
  if (a.disposalType && a.disposalDate && a.disposalDate < from) return false;
  return true;
};

/** The last change of use as the grid shows it: its date and the class before it. */
const lastChange = (a: CapitalGoodsAsset): { date: string | null; before: UseClass | null } => {
  const h = (a.useHistory ?? []).slice().sort((x, y) => x.fromDate.localeCompare(y.fromDate));
  return h.length >= 2 ? { date: h[h.length - 1].fromDate, before: h[h.length - 2].useClass } : { date: null, before: null };
};

/** One change of use: `before` from the invoice (or the start), the asset's class from `date`. */
const withChange = (a: CapitalGoodsAsset, date: string | null, before: UseClass | null): CapitalGoodsAsset => {
  if (!date || !before) return { ...a, useHistory: [] };
  const start = a.invoiceDate && a.invoiceDate < date ? a.invoiceDate : START;
  return { ...a, useHistory: [{ fromDate: start, useClass: before }, { fromDate: date, useClass: a.useClass }] };
};

interface ARow { id: string; a: CapitalGoodsAsset; r: Rule43Asset | undefined }
interface PRow { id: string; p: Rule43Period; m: MonthKey; doc: Rule42Month }

const Rule43Card: React.FC = () => {
  const { docs, workings, update, readOnly, financialYear, capitalGoods, updateCapitalGoods, capitalGoodsLoaded } = useWorkspace();
  const R: Rule42Doc = docs.gstr9.r42 ?? emptyRule42();
  const W = workings.r43;
  const on = workings.r42.enabled;
  const [head, setHead] = useState<Head>('c');

  // ── Register (Rule 43 view) ──
  const byId = useMemo(() => new Map(W.assets.map((x) => [x.id, x])), [W.assets]);
  const aRows: ARow[] = useMemo(
    () => capitalGoods.filter((a) => inYear(a, financialYear)).map((a) => ({ id: a.id, a, r: byId.get(a.id) })),
    [capitalGoods, financialYear, byId],
  );
  const onAssets = useCallback((next: ARow[]) => {
    const hidden = capitalGoods.filter((a) => !inYear(a, financialYear));
    updateCapitalGoods([...hidden, ...next.map((x) => x.a)]);
  }, [capitalGoods, financialYear, updateCapitalGoods]);
  const newRow = useCallback((): ARow => {
    const a: CapitalGoodsAsset = { ...newCgAsset(crypto.randomUUID()), useClass: 'common', disposalType: null };
    return { id: a.id, a, r: undefined };
  }, []);

  const edit = (fn: (a: CapitalGoodsAsset) => CapitalGoodsAsset) => (row: ARow): ARow => ({ ...row, a: fn(row.a) });
  const USE_OPTS = (Object.keys(USE_CLASS_LABEL) as UseClass[]).map((v) => ({ value: v, label: USE_CLASS_LABEL[v] }));
  const itcHead = (h: 'i' | 'c' | 'x', label: string, width = 104) =>
    moneyCol<ARow>(`itc.${h}`, label, (r) => r.a.itc[h], (r, v) => edit((a) => {
      const itc = { ...a.itc, [h]: v ?? 0 };
      if (h === 'c') itc.s = itc.c;
      return { ...a, itc };
    })(r), { group: 'ITC on the asset', width });

  const aCols: GridColumn<ARow>[] = [
    { key: 'description', header: 'Asset', type: 'text', width: 190, sticky: true, value: (r) => r.a.description, onEdit: (r, e) => edit((a) => ({ ...a, description: e.text }))(r) },
    { key: 'invoiceNo', header: 'Invoice no.', type: 'text', width: 100, group: 'Purchase', value: (r) => r.a.invoiceNo, onEdit: (r, e) => edit((a) => ({ ...a, invoiceNo: e.text }))(r) },
    {
      key: 'invoiceDate', header: 'Invoice date', type: 'text', width: 100, group: 'Purchase', value: (r) => fmtIsoDate(r.a.invoiceDate), title: () => 'dd-mm-yyyy: the 60 months run from this month',
      onEdit: (r, e) => { const v = parseDateInput(e.text); return v === undefined ? r : edit((a) => ({ ...a, invoiceDate: v }))(r); },
    },
    {
      key: 'useClass', header: 'Use now', type: 'select', width: 170, group: 'Use', options: USE_OPTS, value: (r) => r.a.useClass,
      onEdit: (r, e) => {
        if (!e.text || !(e.text in USE_CLASS_LABEL)) return r;
        const ch = lastChange(r.a);
        return edit((a) => withChange({ ...a, useClass: e.text as UseClass }, ch.date, ch.before))(r);
      },
    },
    {
      key: 'changeDate', header: 'Since', type: 'text', width: 100, group: 'Use', value: (r) => fmtIsoDate(lastChange(r.a).date),
      title: () => 'dd-mm-yyyy the asset moved to its use now; blank = that use since purchase',
      onEdit: (r, e) => {
        const v = parseDateInput(e.text);
        if (v === undefined) return r;
        const before = lastChange(r.a).before ?? (r.a.useClass === 'common' ? 'exempt_or_non_business' : 'common');
        return edit((a) => withChange(a, v, v ? before : null))(r);
      },
    },
    {
      key: 'before', header: 'Use before', type: 'select', width: 170, group: 'Use', options: USE_OPTS,
      value: (r) => lastChange(r.a).before ?? '',
      editable: (r) => !!lastChange(r.a).date,
      title: () => 'Exempt / non-business only → common: Tc is the credit less 5 points for every quarter or part from the invoice (rule 43(1)(c))',
      onEdit: (r, e) => (e.text && e.text in USE_CLASS_LABEL ? edit((a) => withChange(a, lastChange(a).date, e.text as UseClass))(r) : r),
    },
    itcHead('i', 'IGST'),
    itcHead('c', 'CGST'),
    lockSgst(moneyCol<ARow>('itc.s', 'SGST', (r) => r.a.itc.c, (r) => r, { group: 'ITC on the asset', width: 104 })),
    itcHead('x', 'Cess', 84),
    {
      key: 'itcRoute', header: 'Credit', type: 'select', width: 130, group: 'ITC on the asset',
      options: (Object.keys(ITC_ROUTE_LABEL) as Array<keyof typeof ITC_ROUTE_LABEL>).map((v) => ({ value: v, label: ITC_ROUTE_LABEL[v] })),
      value: (r) => r.a.itcRoute,
      onEdit: (r, e) => (e.text && e.text in ITC_ROUTE_LABEL ? edit((a) => ({ ...a, itcRoute: e.text as CapitalGoodsAsset['itcRoute'] }))(r) : r),
    },
    displayCol<ARow>('tc', 'Tc', (r) => (r.r ? tot(r.r.tc) : null), { group: 'Rule 43', width: 110, title: (r) => (r.r?.quarters ? `Credit less ${r.r.quarters * 5} points (${r.r.quarters} quarters or part)` : 'Credit on the asset') }),
    displayCol<ARow>('tm', 'Tm = Tc ÷ 60', (r) => (r.r ? tot(r.r.tm) : null), { group: 'Rule 43', width: 110 }),
    { key: 'months', header: 'Months', type: 'display', width: 70, align: 'right', group: 'Rule 43', value: (r) => r.r?.monthsInYear ?? null, title: (r) => (r.r ? `${r.r.lifeUsed} of 60 months of life used by the year end` : undefined) },
    displayCol<ARow>('tr', 'Tr', (r) => (r.r ? tot(r.r.tr) : null), { group: 'Rule 43', width: 110 }),
    displayCol<ARow>('te', 'Te', (r) => (r.r ? tot(r.r.te) : null), { group: 'Rule 43', width: 110 }),
    {
      key: 'status', header: 'Status', type: 'display', width: 220, align: 'left', group: 'Rule 43',
      value: (r) => (r.r?.issues.length ? r.r.issues.join(' ') : r.r?.excluded ?? (r.r ? 'In Tr' : '')),
      tone: (r) => (r.r?.issues.length ? 'warn' : undefined),
    },
  ];
  const aFooter: GridFooterRow[] = [{
    key: 'total', label: `In common use (${W.commonCount})`, tone: 'total',
    cells: { tr: tot(W.tr), te: tot(W.te) },
  }];

  // ── Periods ──
  const setR = (fn: (r: Rule42Doc) => Rule42Doc) => update('gstr9', (d) => ({ ...d, r42: fn(d.r42 ?? emptyRule42()) }));
  const pRows: PRow[] = useMemo(
    () => W.periods.map((p) => {
      const m = p.months[p.months.length - 1];
      return { id: p.key, p, m, doc: { ...emptyRule42Month(), ...(R.months?.[m] ?? {}) } };
    }),
    [W.periods, R.months],
  );
  const pCols: GridColumn<PRow>[] = [
    { key: 'period', header: 'Period', type: 'display', align: 'left', width: 120, sticky: true, value: (r) => r.p.label },
    displayCol<PRow>('tr', 'Tr = Σ Tm', (r) => r.p.tr[head], { group: 'Rule 43', width: 116 }),
    { key: 'ratio', header: 'E ÷ F', type: 'display', group: 'Rule 43', width: 90, value: (r) => pct(r.p.ratio), title: () => 'The period’s E ÷ F from the Rule 42 working' },
    displayCol<PRow>('te', 'Te = E ÷ F × Tr', (r) => r.p.te[head], { group: 'Rule 43', width: 124 }),
    moneyCol<PRow>(`rev.${head}`, 'Reversed', (r) => (r.doc.reversed43 ? r.doc.reversed43[head] : null), (r, n) => {
      if (n === null) return { ...r, doc: { ...r.doc, reversed43: null } };
      const base: TaxIn = r.doc.reversed43 ? { ...r.doc.reversed43 } : taxToIn({ i: 0, c: 0, s: 0, x: 0 });
      base[head] = n;
      if (head === 'c') base.s = null;
      return { ...r, doc: { ...r.doc, reversed43: base } };
    }, { nullable: true, width: 116, group: 'In the GSTR-3B', title: () => 'The Rule 43 part of the 4(B)(1) of this return' }),
    displayCol<PRow>('short', 'Short (excess)', (r) => r.p.short[head], { group: 'In the GSTR-3B', width: 116, tone: (r) => (r.p.short[head] > 0.5 ? 'warn' : undefined) }),
    { key: 'days', header: 'Days', type: 'display', width: 64, align: 'right', group: 'Interest u/s 50', value: (r) => (r.p.notUtilised ? null : r.p.interestDays), title: (r) => (r.p.notUtilised ? 'Not utilised (set on the Rule 42 grid)' : 'From the return’s due date to the posting return') },
    displayCol<PRow>('int', 'Amount', (r) => r.p.interest[head], { group: 'Interest u/s 50', width: 100 }),
  ];
  const onPeriods = (next: PRow[]) => setR((r) => {
    const months = { ...r.months };
    next.forEach((row) => {
      const v = row.doc.reversed43 ?? null;
      months[row.m] = { ...emptyRule42Month(), ...(r.months?.[row.m] ?? {}), reversed43: v ? withFormulas(v, v.f) : null };
    });
    return { ...r, months };
  });
  const sum = (k: 'tr' | 'te' | 'reversed' | 'short' | 'interest') => W.periods.reduce((s, p) => s + p[k][head], 0);
  const pFooter: GridFooterRow[] = [{
    key: 'total', label: 'Year — 7D', tone: 'total',
    cells: { tr: sum('tr'), te: sum('te'), [`rev.${head}`]: sum('reversed'), short: sum('short'), int: sum('interest') },
  }];

  return (
    <SectionCard
      title="Rule 43 — capital goods used for taxable and exempt supplies"
      description="The capital goods register as Rule 43 reads it: each asset in common use gives Tm = Tc ÷ 60 a month for 60 months from its invoice; Te = E ÷ F × Tr each period, reversed in that period’s GSTR-3B. GSTR-9 7D takes Σ Te while the working is on (the Rule 42 switch)."
      excelRef="Rule 43 · GSTR-9 7D"
    >
      {!on && <Note tone="info">The working is off: 7D stays as typed in Table 7. Switch on “Use for GSTR-9 7C” above to bring 7D from here too.</Note>}
      <Note tone="position">
        Tc is the credit on the asset; one that moved from exempt or non-business use into common use counts its credit less 5 points for every quarter or part from the invoice (the same helper as s.18(6)). An asset leaves Tr from the month it is sold, and its sale is s.18(6)’s on Purchases › Capital goods sold. No annual re-computation: 7D is Σ Te; Te short in a return goes to Payables with interest from its due date.
      </Note>
      {W.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}

      <div className="grid gap-2 sm:grid-cols-4">
        <KpiTile label="Assets in common use" value={W.commonCount} hint={`Tr ${fmtMoney(tot(W.tr))}`} />
        <KpiTile label="7D (all heads)" value={fmtMoney(tot(workings.g9.t7.D))} hint={W.t7DSource === 'override' ? 'Typed over in Table 7' : tot(workings.builderRev.r43) > 0.005 ? `Σ Te + builder ${fmtMoney(tot(workings.builderRev.r43))}` : 'Σ Te'} />
        <KpiTile label="Still to reverse" value={fmtMoney(tot(W.payable))} tone={tot(W.payable) > 0.5 ? 'warn' : 'ok'} hint={tot(W.recredit) > 0.5 ? `Reversed ${fmtMoney(tot(W.recredit))} more than Te` : 'Goes to Payables'} />
        <KpiTile label="Interest u/s 50" value={fmtMoney(tot(W.interest))} />
      </div>

      <SheetGrid<ARow>
        label="Capital goods register — Rule 43"
        rows={aRows}
        columns={aCols}
        getRowId={(r) => r.id}
        onRowsChange={onAssets}
        readOnly={readOnly || !capitalGoodsLoaded}
        newRow={newRow}
        addLabel="Add capital good"
        footer={aFooter}
        rowTone={(r) => (r.r?.issues.length ? 'warn' : r.r?.excluded ? 'muted' : undefined)}
        maxHeight="max(260px, calc(100vh - 480px))"
        emptyText={<span>No capital goods in the register for {financialYear}. Add the assets used for both taxable and exempt supplies.</span>}
      />
      <p className="text-[11px] text-muted-foreground">
        The register is the client’s, across years, and shared with Purchases › Capital goods sold. Dates as dd-mm-yyyy; SGST is the CGST figure and is locked.
      </p>

      <div className="flex justify-end gap-1 text-xs">
        {HEADS.map((x) => (
          <button key={x.h} type="button" onClick={() => setHead(x.h)}
            className={`rounded border px-2 py-1 ${head === x.h ? 'border-primary bg-primary/10 font-semibold' : 'border-border text-muted-foreground'}`}>
            {x.label}
          </button>
        ))}
      </div>
      <SheetGrid<PRow> label="Rule 43 by tax period" rows={pRows} columns={pCols} getRowId={(r) => r.id} readOnly={readOnly} onRowsChange={onPeriods} footer={pFooter} maxHeight="calc(100vh - 320px)" />
    </SectionCard>
  );
};

export default Rule43Card;
