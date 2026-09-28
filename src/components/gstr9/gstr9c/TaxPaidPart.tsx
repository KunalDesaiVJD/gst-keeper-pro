import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GSTR9C_T11_KEYS,
  GSTR9C_T9_OTHER_KEYS,
  GSTR9C_T9_RATE_KEYS,
  Gstr9cT11Key,
  Gstr9cT9OtherKey,
  Gstr9cT9RateKey,
} from '@/lib/gstr9/types';
import type { Workings } from '@/lib/gstr9/engine';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { ReasonsBox, RefStrip } from './bits';
import { FormGrid } from './FormGrid';
import { columnTotals, figs, FORM_HEADS, FormLine, headsText, n0, TAX_HEADS, toRateRow, toTax, useGoToStep } from './formLines';

const T9_LABEL: Record<Gstr9cT9RateKey | Gstr9cT9OtherKey | 'P' | 'Q' | 'R', string> = {
  A: '5%',
  B: '5% (RC)',
  B1: '6%',
  C: '12%',
  D: '12% (RC)',
  E: '18%',
  F: '18% (RC)',
  G: '28%',
  H: '28% (RC)',
  H1: '40%',
  H2: '40% (RC)',
  I: '3%',
  J: '0.25%',
  K: '0.10%',
  K1: 'Others %',
  K2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  L: 'Interest',
  M: 'Late fee',
  N: 'Penalty',
  O: 'Others',
  P: 'Total amount to be paid as per tables above',
  Q: 'Total amount payable as declared in annual return (GSTR-9)',
  R: 'Un-reconciled payment of amount',
};

type T9Source = Workings['gstr9c']['t9']['source'][string];

/** Chip for a Table 9 rate row, from the engine's `t9.source` (where the books figure comes from). */
const t9Chip = (k: Gstr9cT9RateKey, src: T9Source | undefined): { short: string; title: string } => {
  const rate = k === 'K1' ? 'any other rate, or with no rate set' : k === 'K2' ? '' : `${T9_LABEL[k].replace(' (RC)', '')}`;
  switch (src) {
    case 'sales':
      return { short: 'Books', title: `Sales Part A ledgers at ${rate} (PL-OUTPUT, net of credit notes)` };
    case 'rcm':
      return { short: 'Books · RCM', title: `RCM Part B categories at ${rate} (tax on inward supplies under reverse charge)` };
    case 'sales+rcm':
      return { short: 'Books · Sales + RCM', title: `Sales Part A ledgers and RCM Part B categories at ${rate}` };
    case 'typed':
      return { short: 'Typed', title: 'the figure derived from the books' };
    default:
      return { short: 'Not in books', title: 'Nothing in the books maps to this row — type the figure if any' };
  }
};

const T11_LABEL: Record<Gstr9cT11Key, string> = {
  A: '5%',
  A1: '6%',
  B: '12%',
  C: '18%',
  D: '28%',
  D1: '40%',
  E: '3%',
  F: '0.25%',
  G: '0.10%',
  G1: 'Others %',
  G2: 'Supplies on which e-commerce operator is required to pay tax u/s 9(5)',
  H: 'Interest',
  I: 'Late fee',
  J: 'Penalty',
  K: 'Others',
};
const T11_TAX_ONLY: Gstr9cT11Key[] = ['H', 'I', 'J', 'K'];

const PAYABLE_SOURCE: Record<string, string> = { portal: 'portal', '4N': '4N tax', override: 'typed on the GSTR-9 step' };

/** Part III — Tables 9 to 11: rate-wise liability and tax paid. */
const TaxPaidPart: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const go = useGoToStep();
  const C = docs.gstr9c;
  const W = workings.gstr9c;
  const def = W.defaults;

  const qSourceTitle = useMemo(() => {
    const g = workings.g9.t9;
    const parts = [
      `CGST: ${PAYABLE_SOURCE[g.cgst.payableSource]}`,
      `SGST: ${PAYABLE_SOURCE[g.sgst.payableSource]}`,
      `IGST: ${PAYABLE_SOURCE[g.igst.payableSource]}`,
      `Cess: ${PAYABLE_SOURCE[g.cess.payableSource]}`,
    ];
    return `GSTR-9 Table 9 tax payable (${parts.join(', ')})`;
  }, [workings.g9.t9]);

  const t9Lines = useMemo<FormLine[]>(() => {
    const lines: FormLine[] = GSTR9C_T9_RATE_KEYS.map((k) => {
      const src = t9Chip(k, W.t9.source[k]);
      return {
        id: k,
        code: `9${k}`,
        label: T9_LABEL[k],
        mode: 'override',
        heads: FORM_HEADS,
        stored: figs(C.t9?.[k]),
        def: figs(def.t9[k]) ?? {},
        fKey: `t9.${k}`,
        write: (d, v) => ({ ...d, t9: { ...d.t9, [k]: v ? toRateRow(v) : null } }),
        source: src.short,
        sourceTitle: src.title,
      };
    });
    GSTR9C_T9_OTHER_KEYS.forEach((k) => {
      lines.push({
        id: k,
        code: `9${k}`,
        label: T9_LABEL[k],
        mode: 'typed',
        heads: TAX_HEADS,
        stored: figs(C.t9Other?.[k], false) ?? {},
        fKey: `t9Other.${k}`,
        write: (d, v) => ({ ...d, t9Other: { ...d.t9Other, [k]: toTax(v ?? {}) } }),
      });
    });
    lines.push(
      { id: 'P', code: '9P', label: T9_LABEL.P, mode: 'computed', heads: FORM_HEADS, shown: figs(W.t9.P) ?? {}, emphasis: 'total' },
      {
        id: 'Q',
        code: '9Q',
        label: T9_LABEL.Q,
        mode: 'override',
        heads: TAX_HEADS,
        stored: figs(C.t9Q, false),
        def: figs(def.t9Q, false) ?? {},
        fKey: 't9Q',
        write: (d, v) => ({ ...d, t9Q: v ? toTax(v) : null }),
        source: 'GSTR-9 Table 9',
        sourceTitle: qSourceTitle,
      },
      { id: 'R', code: '9R', label: T9_LABEL.R, hint: '(Q − P)', mode: 'computed', heads: TAX_HEADS, shown: figs(W.t9.R, false) ?? {}, emphasis: 'diff', diffKey: 'gstr9c.9R' },
    );
    return lines;
  }, [C.t9, C.t9Other, C.t9Q, def.t9, def.t9Q, W.t9, qSourceTitle]);

  const t11Lines = useMemo<FormLine[]>(
    () =>
      GSTR9C_T11_KEYS.map((k) => ({
        id: k,
        code: `11${k}`,
        label: T11_LABEL[k],
        mode: 'typed' as const,
        heads: T11_TAX_ONLY.includes(k) ? TAX_HEADS : FORM_HEADS,
        stored: figs(C.t11?.[k]) ?? {},
        fKey: `t11.${k}`,
        write: (d, v) => ({ ...d, t11: { ...d.t11, [k]: toRateRow(v ?? {}) } }),
      })),
    [C.t11],
  );

  const k1Src = W.t9.source.K1;
  const k1Derived = (k1Src === 'sales' || k1Src === 'rcm' || k1Src === 'sales+rcm') && Math.abs(n0(W.t9.rows.K1?.t)) >= 0.005;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Table 9 · Reconciliation of rate-wise liability and amount payable"
        description="Rate rows are derived from the books — Sales Part A by rate, and the RC rows from RCM Part B by rate. Type over a row to override it; interest, late fee, penalty and others are typed."
        excelRef="9C utility PT III (9)"
      >
        {k1Derived && (
          <Note tone="warn">
            {fmtMoney(W.t9.rows.K1.t)} of value falls in 9K1 “Others %” — ledgers or RCM categories at a rate that is not one of the form’s rates, or with no
            rate set.
            <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => go('sales')}>
              Check the rates on Sales <ArrowRight className="ml-0.5 h-3 w-3" />
            </Button>
          </Note>
        )}
        <FormGrid label="GSTR-9C Table 9" lines={t9Lines} heads={FORM_HEADS} labelWidth={260} />
        <div className="grid gap-2 lg:grid-cols-2">
          <Note tone="position">
            RC rows add every RCM Part B expense block, taxable value included — the sheet’s Part B taxable total adds only two of the four blocks.
          </Note>
          <Note tone="position">
            9Q is the GSTR-9 Table 9 tax payable as the portal pre-fills it, else the 4N tax (the sheet mixes the two: IGST from the portal, CGST/SGST from 4N).
          </Note>
        </div>
        <ReasonsBox field="t10Reasons" code="10" title="Reasons for un-reconciled payment of amount" diffKey="gstr9c.9R" />
      </SectionCard>

      <SectionCard
        title="Table 11 · Additional amount payable but not paid"
        description="Due to the reasons in Tables 6, 8 and 10 — to be paid through cash. Typed."
        excelRef="9C utility PT III (11)"
      >
        <RefStrip
          items={[
            { label: '5R un-reconciled turnover', value: fmtMoney(W.t5.R) },
            { label: '7G un-reconciled taxable turnover', value: fmtMoney(W.t7.G) },
            { label: '9R un-reconciled payment', value: headsText(W.t9.R) },
          ]}
        />
        <FormGrid
          label="GSTR-9C Table 11"
          lines={t11Lines}
          heads={FORM_HEADS}
          labelWidth={260}
          footer={[{ key: 'total', label: 'Total', tone: 'total', cells: columnTotals(t11Lines, FORM_HEADS) }]}
        />
      </SectionCard>
    </div>
  );
};

export default TaxPaidPart;
