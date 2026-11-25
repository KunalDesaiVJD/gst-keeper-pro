import React from 'react';
import { totalTax } from '@/lib/gstr9/engine';
import { BASIS_LABEL, DISPOSAL_LABEL, SHORTFALL_ROUTE_LABEL, type CapitalGoodsAsset, type CgSaleCalc } from '@/lib/gstr9/capitalGoods';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtIsoDate } from '../sales/CapitalGoodsSold';
import { StepLink } from './StepLink';
import { FigLink } from '../figure/FigLink';
import { salesCgAsset } from '../figure/targetsFinish';

const HEADS: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST'], ['x', 'Cess']];
const byHead = (t: Tax): string => HEADS.filter(([h]) => Math.abs(t[h]) >= 0.005).map(([h, l]) => `${l} ${fmtMoney(t[h])}`).join(' + ') || 'nil';

/** The computation of one asset, in the order a reviewer re-performs it. */
const Computation: React.FC<{ a: CapitalGoodsAsset; c: CgSaleCalc }> = ({ a, c }) => {
  const lines: Array<[string, React.ReactNode]> = [
    ['Purchase', `${a.invoiceNo || '—'} dated ${fmtIsoDate(a.invoiceDate) || '—'} · ITC taken ${byHead(c.itcTaken)} = ${fmtMoney(totalTax(c.itcTaken))}`],
    ['Disposal', `${a.disposalType ? DISPOSAL_LABEL[a.disposalType] : '—'} on ${fmtIsoDate(a.disposalDate) || '—'}${a.disposalInvoiceNo ? ` (invoice ${a.disposalInvoiceNo})` : ''} · value ${fmtMoney(a.disposalValue)}${a.rate !== null ? ` at ${a.rate}%` : ''}`],
  ];
  if (c.basis === 'sec18_6' && c.quarters !== null) {
    lines.push(
      ['Period held', `${fmtIsoDate(a.invoiceDate)} to ${fmtIsoDate(a.disposalDate)} = ${c.quarters} quarter${c.quarters === 1 ? '' : 's'} (a part counts in full)`],
      ['Reduction', `${c.quarters} × 5 = ${c.reductionPct}% · ${100 - (c.reductionPct ?? 0)}% of the ITC remains`],
      ['(b) ITC as reduced', `${byHead(c.reduced)} = ${fmtMoney(totalTax(c.reduced))}`],
    );
  }
  lines.push(
    ['(a) Tax on transaction value', `${byHead(c.outTax)} = ${fmtMoney(totalTax(c.outTax))}${c.outTaxComputed ? ' (from the rate)' : ' (as charged)'}`],
    ['Payable u/s 18(6)', `${fmtMoney(c.payable)} — ${c.higher === 'itc' ? '(b) is higher' : c.higher === 'tv' ? '(a) is higher' : c.higher === 'equal' ? '(a) and (b) are equal' : BASIS_LABEL[c.basis]}`],
    ['Shortfall (b) − (a)', totalTax(c.shortfall) > 0.005 ? `${byHead(c.shortfall)} = ${fmtMoney(totalTax(c.shortfall))} · ${SHORTFALL_ROUTE_LABEL[a.shortfallRoute]}` : 'nil'],
  );
  if (c.itcTaken.i + c.itcTaken.c + c.itcTaken.s + c.itcTaken.x !== totalTax(c.itcAfterR43)) {
    lines.push(['After Rule 43 reversals', `${byHead(c.itcAfterR43)} (for information; the basis is the ITC taken)`]);
  }
  return (
    <div className="rounded-md border px-3 py-2">
      {/* The asset's figures are typed on Sales › Capital goods sold: its name opens that row. */}
      <div className="mb-1 text-sm font-medium"><FigLink to={salesCgAsset(a.id)} className="text-left">{a.description || 'Asset'}</FigLink>{a.hsn ? <span className="ml-2 text-xs font-normal text-muted-foreground">HSN {a.hsn}</span> : null}</div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-[180px_1fr]">
        {lines.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
      {[...c.issues, ...c.notes].length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground">
          {c.issues.map((x) => <li key={x} className="text-destructive-strong">{x}</li>)}
          {c.notes.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
    </div>
  );
};

/** Annexure-5 — the s.18(6) computation schedule for capital goods sold in the year, and where each figure went. */
const Annexure5: React.FC = () => {
  const { workings, financialYear } = useWorkspace();
  const cg = workings.cg;
  return (
    <SectionCard
      title="Annexure-5 — Capital goods sold u/s 18(6)"
      description="Per asset: the ITC taken, reduced by 5 percentage points for every quarter or part since the purchase invoice, against the tax on the transaction value; the higher is payable (s.18(6), Rule 40(2), Rule 44(6))."
      excelRef="—"
      actions={<StepLink step="sales" extra={{ salestab: 'cgsold' }} className="text-xs">Capital goods sold</StepLink>}
    >
      {cg.assets.length === 0 ? (
        <Note tone="info">No capital goods sold in {financialYear}. Record a sale under Sales · Capital goods sold.</Note>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            {cg.assets.map((a) => <Computation key={a.id} a={a} c={cg.calc[a.id]} />)}
          </div>
          <div className="rounded-md border px-3 py-2 text-xs">
            <div className="mb-1 font-medium">Where the figures go</div>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-[300px_1fr]">
              <dt className="text-muted-foreground">Table 4 (sales outside the Sales ledgers)</dt>
              <dd className="tabular-nums">4B {fmtMoney(cg.table4.b2b.t)} · tax {fmtMoney(totalTax(cg.table4.b2b))}; 4A {fmtMoney(cg.table4.b2c.t)} · tax {fmtMoney(totalTax(cg.table4.b2c))}</dd>
              <dt className="text-muted-foreground">Table 7H (shortfall reversed)</dt>
              <dd className="tabular-nums">{byHead(cg.reversal)}</dd>
              <dt className="text-muted-foreground">of which in GSTR-3B 4(B)(2) / by DRC-03 / not yet</dt>
              <dd className="tabular-nums">{fmtMoney(totalTax(cg.reversed3b))} / {fmtMoney(totalTax(cg.drc03))} / {fmtMoney(totalTax(cg.notDone))}</dd>
              <dt className="text-muted-foreground">Paid as output tax on the invoice (Table 4)</dt>
              <dd className="tabular-nums">{byHead(cg.asOutputTax)}</dd>
              <dt className="text-muted-foreground">Not in the books' ITC ledger (ITC reco, Annexure-2 A3)</dt>
              <dd className="tabular-nums">{byHead(cg.notInBooks)}</dd>
              <dt className="text-muted-foreground">Outside the P&amp;L (Annexure-1, GSTR-9C 5O)</dt>
              <dd className="tabular-nums">{fmtMoney(cg.valueOutsidePl)}</dd>
            </dl>
          </div>
        </>
      )}
    </SectionCard>
  );
};

export default Annexure5;
