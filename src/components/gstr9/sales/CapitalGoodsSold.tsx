import React, { useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { totalTax } from '@/lib/gstr9/engine';
import {
  BASIS_LABEL,
  computeCgSale,
  disposedInFy,
  DISPOSAL_LABEL,
  ITC_ROUTE_LABEL,
  newCgAsset,
  SHORTFALL_ROUTE_LABEL,
  taxFromRate,
  type CapitalGoodsAsset,
  type CgSaleCalc,
} from '@/lib/gstr9/capitalGoods';
import type { Tax } from '@/lib/gstr9/types';
import { SheetGrid, type GridColumn, type GridFooterRow } from '../grid/SheetGrid';
import { displayCol, lockSgst, moneyCol } from '../grid/columns';
import { fmtMoney } from '../grid/money';
import { KpiTile, Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';

/** Shown in this year's tab: sold in this FY, or a sale still without its date. */
export const showInYear = (a: CapitalGoodsAsset, fy: string): boolean => disposedInFy(a, fy) || (!!a.disposalType && !a.disposalDate);

const YES_NO = [{ value: 'yes', label: 'Yes', aliases: ['y', 'true'] }, { value: 'no', label: 'No', aliases: ['n', 'false'] }];
const yn = (v: string): boolean => v === 'yes';

/** "15-06-2022", "15/06/2022", "2022-06-15" → "2022-06-15"; blank → null; anything else → undefined (refused). */
export const parseDateInput = (raw: string): string | null | undefined => {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
    if (!m) return undefined;
    d = +m[1]; mo = +m[2]; y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
export const fmtIsoDate = (v: string | null): string => (v ? `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}` : '');

const dateCol = (key: string, header: string, get: (a: CapitalGoodsAsset) => string | null, set: (a: CapitalGoodsAsset, v: string | null) => CapitalGoodsAsset, group: string): GridColumn<CapitalGoodsAsset> => ({
  key, header, group, type: 'text', width: 100,
  value: (a) => fmtIsoDate(get(a)),
  title: () => 'dd-mm-yyyy',
  onEdit: (a, e) => {
    const v = parseDateInput(e.text);
    return v === undefined ? a : set(a, v);
  },
});

const selectCol = <V extends string>(key: string, header: string, options: Record<V, string>, get: (a: CapitalGoodsAsset) => V, set: (a: CapitalGoodsAsset, v: V) => CapitalGoodsAsset, group: string, width = 150): GridColumn<CapitalGoodsAsset> => ({
  key, header, group, type: 'select', width,
  options: (Object.keys(options) as V[]).map((v) => ({ value: v, label: options[v] })),
  value: (a) => get(a),
  onEdit: (a, e) => (e.text && e.text in options ? set(a, e.text as V) : a),
});

const boolCol = (key: string, header: string, get: (a: CapitalGoodsAsset) => boolean, set: (a: CapitalGoodsAsset, v: boolean) => CapitalGoodsAsset, group: string, title?: string): GridColumn<CapitalGoodsAsset> => ({
  key, header, group, type: 'select', width: 74, options: YES_NO,
  value: (a) => (get(a) ? 'yes' : 'no'),
  title: title ? () => title : undefined,
  onEdit: (a, e) => (e.text ? set(a, yn(e.text)) : a),
});

/** ITC / output tax per head, SGST locked to CGST (firm decision, 3 Oct 2026). */
const headCols = (prefix: string, group: string, get: (a: CapitalGoodsAsset) => Tax | null, set: (a: CapitalGoodsAsset, t: Tax | null) => CapitalGoodsAsset, placeholder?: (a: CapitalGoodsAsset) => Tax | null): GridColumn<CapitalGoodsAsset>[] => {
  const base = (a: CapitalGoodsAsset): Tax => get(a) ?? placeholder?.(a) ?? { i: 0, c: 0, s: 0, x: 0 };
  const nullable = !!placeholder;
  const head = (h: 'i' | 'c' | 'x', label: string, width = 104) => moneyCol<CapitalGoodsAsset>(`${prefix}.${h}`, label, (a) => (get(a) ? get(a)![h] : null), (a, v) => {
    if (v === null && nullable) return set(a, null);
    const t = { ...base(a), [h]: v ?? 0 };
    if (h === 'c') t.s = t.c;
    return set(a, t);
  }, { group, width, nullable, placeholder: placeholder ? (a) => placeholder(a)?.[h] ?? null : undefined });
  return [
    head('i', 'IGST'),
    head('c', 'CGST'),
    lockSgst(moneyCol<CapitalGoodsAsset>(`${prefix}.s`, 'SGST', (a) => (get(a) ? get(a)!.c : null), (a) => a, {
      group, width: 104, nullable: true, placeholder: (a) => (get(a)?.c ?? placeholder?.(a)?.c ?? 0),
    })),
    head('x', 'Cess', 84),
  ];
};

function buildColumns(calc: Record<string, CgSaleCalc>, taxOnValue: (a: CapitalGoodsAsset) => Tax): GridColumn<CapitalGoodsAsset>[] {
  const P = 'Purchase (ITC taken)';
  const S = 'Sale';
  const H = 'How the year dealt with it';
  const R = 's.18(6) computation';
  const c = (a: CapitalGoodsAsset) => calc[a.id];
  return [
    { key: 'description', header: 'Asset', type: 'text', width: 190, sticky: true, value: (a) => a.description, onEdit: (a, e) => ({ ...a, description: e.text }) },
    { key: 'hsn', header: 'HSN', type: 'text', width: 80, value: (a) => a.hsn, onEdit: (a, e) => ({ ...a, hsn: e.text.trim() }) },
    { key: 'invoiceNo', header: 'Invoice no.', group: P, type: 'text', width: 110, value: (a) => a.invoiceNo, onEdit: (a, e) => ({ ...a, invoiceNo: e.text }) },
    dateCol('invoiceDate', 'Invoice date', (a) => a.invoiceDate, (a, v) => ({ ...a, invoiceDate: v }), P),
    selectCol('itcRoute', 'ITC', ITC_ROUTE_LABEL, (a) => a.itcRoute, (a, v) => ({ ...a, itcRoute: v }), P, 160),
    ...headCols('itc', P, (a) => a.itc, (a, t) => ({ ...a, itc: t ?? { i: 0, c: 0, s: 0, x: 0 } })),
    selectCol('disposalType', 'Disposal', DISPOSAL_LABEL, (a) => a.disposalType ?? 'sale', (a, v) => ({ ...a, disposalType: v }), S, 170),
    dateCol('disposalDate', 'Date of sale', (a) => a.disposalDate, (a, v) => ({ ...a, disposalDate: v }), S),
    { key: 'disposalInvoiceNo', header: 'Sale invoice', group: S, type: 'text', width: 110, value: (a) => a.disposalInvoiceNo, onEdit: (a, e) => ({ ...a, disposalInvoiceNo: e.text }) },
    selectCol('buyerType', 'Buyer', { b2b: 'Registered (4B)', b2c: 'Unregistered (4A)' }, (a) => a.buyerType, (a, v) => ({ ...a, buyerType: v }), S, 150),
    selectCol('supplyType', 'Supply', { intra: 'Intra-State', inter: 'Inter-State' }, (a) => a.supplyType, (a, v) => ({ ...a, supplyType: v }), S, 110),
    { key: 'rate', header: 'Rate %', group: S, type: 'percent', width: 64, value: (a) => a.rate, onEdit: (a, e) => ({ ...a, rate: e.num }) },
    moneyCol<CapitalGoodsAsset>('disposalValue', 'Transaction value', (a) => a.disposalValue, (a, v) => ({ ...a, disposalValue: v ?? 0 }), { group: S, width: 124 }),
    ...headCols('out', 'Output tax charged (blank = from the rate)', (a) => a.outTax, (a, t) => ({ ...a, outTax: t }), taxOnValue),
    boolCol('scrapProviso', 'Scrap proviso', (a) => a.scrapProviso, (a, v) => ({ ...a, scrapProviso: v }), S, 'Refractory bricks, moulds and dies, jigs and fixtures supplied as scrap: tax on the transaction value only'),
    boolCol('relatedParty', 'Related party', (a) => a.relatedParty, (a, v) => ({ ...a, relatedParty: v }), S, 'Related or distinct person: type the open market value (Rule 28)'),
    boolCol('inSalesLedger', 'In Sales ledgers', (a) => a.inSalesLedger, (a, v) => ({ ...a, inSalesLedger: v }), H, 'Yes when the sale is already in a Sales (PL-OUTPUT Part A) ledger, so it is not added to Table 4 again'),
    selectCol('shortfallRoute', 'Shortfall', SHORTFALL_ROUTE_LABEL, (a) => a.shortfallRoute, (a, v) => ({ ...a, shortfallRoute: v }), H, 220),
    boolCol('postedInBooks', 'In ITC ledger', (a) => a.postedInBooks, (a, v) => ({ ...a, postedInBooks: v }), H, 'Yes when the shortfall is posted to the books’ ITC ledger (Duties & Taxes); else the ITC reco takes it as a reconciling item'),
    { key: 'quarters', header: 'Quarters', group: R, type: 'display', width: 72, align: 'right', value: (a) => c(a)?.quarters ?? null, render: (a) => <span className="tabular-nums">{c(a)?.quarters ?? '—'}</span> },
    { key: 'reduction', header: 'Less %', group: R, type: 'display', width: 64, align: 'right', value: (a) => c(a)?.reductionPct ?? null, render: (a) => <span className="tabular-nums">{c(a)?.reductionPct === null || c(a)?.reductionPct === undefined ? '—' : `${c(a)!.reductionPct}%`}</span> },
    displayCol<CapitalGoodsAsset>('reduced', 'ITC as reduced (b)', (a) => (c(a) ? totalTax(c(a)!.reduced) : null), { group: R, width: 124 }),
    displayCol<CapitalGoodsAsset>('tv', 'Tax on value (a)', (a) => (c(a) ? totalTax(c(a)!.outTax) : null), { group: R, width: 118 }),
    displayCol<CapitalGoodsAsset>('payable', 'Payable (higher)', (a) => c(a)?.payable ?? null, { group: R, width: 120 }),
    displayCol<CapitalGoodsAsset>('shortfall', 'Shortfall (b − a)', (a) => (c(a) ? totalTax(c(a)!.shortfall) : null), {
      group: R, width: 122, tone: (a) => (c(a) && totalTax(c(a)!.shortfall) > 0.005 ? 'warn' : undefined),
    }),
    {
      key: 'status', header: 'Basis / check', group: R, type: 'display', width: 260,
      value: (a) => (c(a)?.issues.length ? c(a)!.issues.join('; ') : c(a) ? BASIS_LABEL[c(a)!.basis] : ''),
      title: (a) => [...(c(a)?.issues ?? []), ...(c(a)?.notes ?? [])].join('\n') || undefined,
      render: (a) => {
        const x = c(a);
        if (!x) return null;
        if (x.issues.length) return <span className="inline-flex items-center gap-1 text-destructive-strong"><AlertTriangle className="h-3 w-3" aria-hidden="true" />{x.issues.join('; ')}</span>;
        return <span className="text-muted-foreground">{BASIS_LABEL[x.basis]}</span>;
      },
    },
  ];
}

/**
 * Sales step, tab "Capital goods sold": the assets of the client's
 * capital goods register sold in this year, and the s.18(6) computation of
 * each (Rule 40(2), Rule 44(6)). The register is client-level (shared with the
 * Rule 43 working); rows save on their own, as the other grids do.
 */
export const CapitalGoodsSold: React.FC = () => {
  const { capitalGoods, updateCapitalGoods, workings, readOnly, financialYear, capitalGoodsLoaded } = useWorkspace();
  const cg = workings.cg;
  const rows = useMemo(() => capitalGoods.filter((a) => showInYear(a, financialYear)), [capitalGoods, financialYear]);
  // Rows not yet in the year (no date) still get a computation on screen.
  const calc = useMemo(
    () => Object.fromEntries(rows.map((a) => [a.id, cg.calc[a.id] ?? computeCgSale(a)])) as Record<string, CgSaleCalc>,
    [rows, cg.calc],
  );
  const taxOnValue = useCallback((a: CapitalGoodsAsset): Tax => taxFromRate(a.disposalValue, a.rate, a.supplyType) ?? { i: 0, c: 0, s: 0, x: 0 }, []);
  const columns = useMemo(() => buildColumns(calc, taxOnValue), [calc, taxOnValue]);
  const undated = rows.filter((a) => !a.disposalDate).length;

  const onRowsChange = useCallback((next: CapitalGoodsAsset[]) => {
    const hidden = capitalGoods.filter((a) => !showInYear(a, financialYear));
    updateCapitalGoods([...hidden, ...next]);
  }, [capitalGoods, financialYear, updateCapitalGoods]);
  const newRow = useCallback(() => newCgAsset(crypto.randomUUID()), []);

  const sumOf = (pick: (c: CgSaleCalc) => number) => cg.assets.reduce((s, a) => s + (cg.calc[a.id] ? pick(cg.calc[a.id]) : 0), 0);
  const footer: GridFooterRow[] = [{
    key: 'total', label: `Sold in ${financialYear} (${cg.assets.length})`, tone: 'total',
    cells: {
      disposalValue: cg.assets.reduce((s, a) => s + a.disposalValue, 0),
      reduced: sumOf((c) => totalTax(c.reduced)),
      tv: sumOf((c) => totalTax(c.outTax)),
      payable: cg.payable,
      shortfall: sumOf((c) => totalTax(c.shortfall)),
    },
  }];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile label="Capital goods sold this year" value={cg.assets.length} hint={cg.incomplete ? `${cg.incomplete} to complete` : `Sale value ${fmtMoney(cg.assets.reduce((s, a) => s + a.disposalValue, 0))}`} tone={cg.incomplete ? 'warn' : 'neutral'} />
        <KpiTile label="Payable u/s 18(6) (higher of)" value={fmtMoney(cg.payable)} hint="Tax on value or ITC as reduced" />
        <KpiTile label="Shortfall reversed (GSTR-9 7H)" value={fmtMoney(totalTax(cg.reversal))} hint={totalTax(cg.asOutputTax) > 0.005 ? `+ ${fmtMoney(totalTax(cg.asOutputTax))} paid as output tax (Table 4)` : 'ITC as reduced less tax on value'} />
        <KpiTile label="Not yet reversed (payable)" value={fmtMoney(totalTax(cg.notDone))} hint="Goes to Payables, input side" tone={totalTax(cg.notDone) > 0.005 ? 'error' : 'ok'} />
      </div>
      <SectionCard
        title="Capital goods sold — s.18(6)"
        description={<>The higher of the tax on the transaction value and the ITC taken less 5 percentage points for every quarter or part of a quarter since the purchase invoice (Rule 40(2), Rule 44(6)). Each asset is computed here and lands in Table 4, 7H, the Annexures, Payables and GSTR-9C 5O; the full working is Annexure-5.</>}
        excelRef="Annexure-5"
      >
        {undated > 0 && (
          <Note tone="warn">
            {undated} asset{undated === 1 ? ' has' : 's have'} no date of sale yet, so {undated === 1 ? 'it is' : 'they are'} not in this year’s figures. Type the date of sale (a sale in another year moves to that year’s working).
          </Note>
        )}
        <SheetGrid<CapitalGoodsAsset>
          label="Capital goods sold"
          rows={rows}
          columns={columns}
          getRowId={(a) => a.id}
          onRowsChange={onRowsChange}
          readOnly={readOnly || !capitalGoodsLoaded}
          newRow={newRow}
          canDelete
          addLabel="Add asset sold"
          footer={footer}
          rowTone={(a) => (calc[a.id]?.issues.length ? 'warn' : !a.disposalDate ? 'muted' : undefined)}
          maxHeight="max(300px, calc(100vh - 460px))"
          emptyText={<span>No capital goods sold in {financialYear}. Use “Add asset sold”, or paste rows (Asset, HSN, invoice no., invoice date, …).</span>}
        />
        <p className="text-[11px] text-muted-foreground">
          Dates as dd-mm-yyyy. SGST is the CGST figure and is locked. Output tax left blank is worked from the rate (IGST inter-State, CGST + SGST intra-State).
          The register is the client’s, across years: an asset sold in another year shows in that year’s working.
        </p>
      </SectionCard>
      <Note tone="position">
        Firm positions (23 Nov 2026): the higher of is compared on the total and the shortfall is split over the heads of the ITC as reduced; ITC taken is the credit availed before any Rule 42/43 reversal; TRAN-1 credit counts as ITC taken from the original invoice date; quarters are three-month periods from the invoice date, a part counting in full. A shortfall paid as output tax on the invoice is in Table 4, any other in Table 7H. Written-off assets (s.17(5)(h)) are recorded but not computed.
      </Note>
    </div>
  );
};

export default CapitalGoodsSold;
