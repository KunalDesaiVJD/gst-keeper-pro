import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GSTR9C_T5_KEYS, GSTR9C_T5_SUB, Gstr9cT5Key } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { Note, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { ReasonsBox } from './bits';
import { FormGrid } from './FormGrid';
import { amount, C9_GRID_MAX_H, FormLine, n0, useGoToStep } from './formLines';

const T5_LABEL: Record<'A' | Gstr9cT5Key | 'P' | 'Q' | 'R', string> = {
  A: 'Turnover (including exports) as per audited financial statement',
  B: 'Unbilled revenue at the beginning of the FY',
  C: 'Unadjusted advances at the end of the FY',
  D: 'Deemed supply under Schedule I',
  E: 'Credit notes issued after the end of the FY but reflected in the annual return',
  F: 'Trade discounts accounted for in the financials but not permissible under GST',
  G: 'Turnover from April 2017 to June 2017',
  H: 'Unbilled revenue at the end of the FY',
  I: 'Unadjusted advances at the beginning of the FY',
  J: 'Credit notes accounted for in the financials but not permissible under GST',
  K: 'Adjustments on account of supply of goods by SEZ units to DTA units',
  L: 'Turnover for the period under composition scheme',
  M: 'Adjustments in turnover under section 15 and rules thereunder',
  N: 'Adjustments in turnover due to foreign exchange fluctuation',
  O: 'Adjustment in turnover due to reasons not listed above',
  P: 'Annual turnover after adjustments',
  Q: 'Turnover as declared in annual return (GSTR-9)',
  R: 'Un-reconciled turnover',
};

/** Rows the offline utility lets go either way. */
const T5_EITHER: Gstr9cT5Key[] = ['M', 'N', 'O'];
const signOf = (k: Gstr9cT5Key): string => (T5_EITHER.includes(k) ? '(+/−)' : GSTR9C_T5_SUB.includes(k) ? '(−)' : '(+)');

const T7_LABEL = {
  A: 'Annual turnover after adjustments (from 5P)',
  B: 'Value of exempted, nil rated, non-GST supplies, no-supply turnover',
  C: 'Zero rated supplies without payment of tax',
  D: 'Supplies on which tax is to be paid by recipient on reverse charge',
  D1: 'Supplies on which tax is to be paid by e-commerce operators u/s 9(5)',
  E: 'Taxable turnover as per adjustments above',
  F: 'Taxable turnover as per liability declared in annual return (GSTR-9)',
  G: 'Unreconciled taxable turnover',
} as const;

const T7_SOURCE: Record<'B' | 'C' | 'D' | 'D1', { short: string; title: string }> = {
  B: { short: 'GSTR-9 5D+5E+5F', title: 'GSTR-9 5D exempted + 5E nil rated + 5F non-GST (books, Sales Part B)' },
  C: { short: 'GSTR-9 5A+5B', title: 'GSTR-9 5A exports + 5B SEZ supplies without payment of tax (books, Sales Part B)' },
  D: { short: 'GSTR-9 5C', title: 'GSTR-9 5C supplies on which the recipient pays tax on reverse charge (books, Sales Part B)' },
  D1: { short: 'GSTR-9 5C1', title: 'GSTR-9 5C1 supplies on which the e-commerce operator pays tax u/s 9(5) (books, Sales Part B)' },
};

/** Part II — Tables 5 and 6: reconciliation of gross turnover. */
export const Table5Card: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const go = useGoToStep();
  const C = docs.gstr9c;
  const W = workings.gstr9c;
  const def = W.defaults;
  const auditMissing = workings.sales.auditReportTotal === null;
  const notInG9 = workings.sales.partBByNature.not_in_gstr9;
  const notInG9Total = n0(notInG9?.pos) + n0(notInG9?.neg);

  const t5Lines = useMemo<FormLine[]>(() => {
    const lines: FormLine[] = [
      {
        id: 'A',
        code: '5A',
        label: T5_LABEL.A,
        mode: 'override',
        heads: ['t'],
        stored: amount(C.t5A),
        def: { t: def.t5A },
        fKey: 't5A',
        write: (d, v) => ({ ...d, t5A: v ? n0(v.t) : null }),
        source: auditMissing ? 'Books A+B' : 'Audit report',
        sourceTitle: auditMissing
          ? 'Books: Sales Part A + Part B (PL-OUTPUT D52) — no audit-report total entered on the Sales step'
          : 'Total income as per the audit report (Sales step, PL-OUTPUT D54)',
      },
    ];
    GSTR9C_T5_KEYS.forEach((k) => {
      const sub = GSTR9C_T5_SUB.includes(k);
      lines.push({
        id: k,
        code: `5${k}`,
        label: T5_LABEL[k],
        hint: signOf(k),
        mode: 'typed',
        heads: ['t'],
        stored: { t: n0(C.t5[k]) },
        fKey: `t5.${k}`,
        write: (d, v) => ({ ...d, t5: { ...d.t5, [k]: n0(v?.t) } }),
        warn: sub ? (_h, v) => (v < 0 ? 'Enter this as a positive amount — the form subtracts it.' : null) : undefined,
      });
    });
    lines.push(
      {
        id: 'P',
        code: '5P',
        label: T5_LABEL.P,
        hint: '(A + B + C + D − E + F − G − H − I + J − K − L + M + N + O)',
        mode: 'computed',
        heads: ['t'],
        shown: { t: W.t5.P },
        emphasis: 'total',
      },
      {
        id: 'Q',
        code: '5Q',
        label: T5_LABEL.Q,
        mode: 'override',
        heads: ['t'],
        stored: amount(C.t5Q),
        def: { t: def.t5Q },
        fKey: 't5Q',
        write: (d, v) => ({ ...d, t5Q: v ? n0(v.t) : null }),
        source: 'GSTR-9 5N+10−11',
        sourceTitle: 'GSTR-9 total turnover: 5N + Table 10 − Table 11',
      },
      {
        id: 'R',
        code: '5R',
        label: T5_LABEL.R,
        hint: '(Q − P)',
        mode: 'computed',
        heads: ['t'],
        shown: { t: W.t5.R },
        emphasis: 'diff',
        diffKey: 'gstr9c.5R',
      },
    );
    return lines;
  }, [C.t5A, C.t5, C.t5Q, def.t5A, def.t5Q, W.t5.P, W.t5.R, auditMissing]);

  return (
    <SectionCard
      title="Table 5 · Reconciliation of gross turnover"
      description="Audited turnover adjusted to what the annual return declares. Type the adjustments as positive amounts; the sign shown is applied."
      excelRef="9C utility PT II (5) · 5A ← PL-OUTPUT D54"
    >
      {C.t5A === null && auditMissing && (
        <Note tone="warn">
          No audit-report total has been entered on the Sales step, so 5A uses books Part A + Part B ({fmtMoney(workings.sales.total)}).
          <Button type="button" variant="link" size="sm" className="ml-1 h-auto p-0 text-xs" onClick={() => go('sales')}>
            Open Sales <ArrowRight className="ml-0.5 h-3 w-3" />
          </Button>
        </Note>
      )}
      {Math.abs(notInG9Total) >= 0.005 && (
        <Note>
          {fmtMoney(notInG9Total)} of Part B income is tagged “Not reportable in GSTR-9”. It sits inside 5A but not in 5Q — if it is not turnover, remove it through
          5O so it does not show up as an un-reconciled difference.
        </Note>
      )}
      <FormGrid label="GSTR-9C Table 5" lines={t5Lines} heads={['t']} headLabels={{ t: 'Amount (₹)' }} maxHeight={C9_GRID_MAX_H} pinLast />
      <Note tone="position">
        5Q defaults to the GSTR-9 total turnover (5N + 10 − 11), where 5N is computed as 4N + 5M − 4G − 4G1 — the sheet types 5N by hand.
      </Note>
      <ReasonsBox field="t6Reasons" code="6" title="Reasons for un-reconciled difference in annual gross turnover" diffKey="gstr9c.5R" />
    </SectionCard>
  );
};

/** Part II — Tables 7 and 8: reconciliation of taxable turnover. */
export const Table7Card: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const C = docs.gstr9c;
  const W = workings.gstr9c;
  const def = W.defaults;

  const t7Lines = useMemo<FormLine[]>(() => {
    const over = (k: 'B' | 'C' | 'D' | 'D1'): FormLine => ({
      id: k,
      code: `7${k}`,
      label: T7_LABEL[k],
      mode: 'override',
      heads: ['t'],
      stored: amount(C.t7?.[k]),
      def: { t: def.t7[k] },
      fKey: `t7.${k}`,
      write: (d, v) => ({ ...d, t7: { ...d.t7, [k]: v ? n0(v.t) : null } }),
      source: T7_SOURCE[k].short,
      sourceTitle: T7_SOURCE[k].title,
    });
    return [
      { id: 'A', code: '7A', label: T7_LABEL.A, mode: 'computed', heads: ['t'], shown: { t: W.t7.A }, source: '= 5P' },
      over('B'),
      over('C'),
      over('D'),
      over('D1'),
      { id: 'E', code: '7E', label: T7_LABEL.E, hint: '(A − B − C − D − D1)', mode: 'computed', heads: ['t'], shown: { t: W.t7.E }, emphasis: 'total' },
      {
        id: 'F',
        code: '7F',
        label: T7_LABEL.F,
        mode: 'override',
        heads: ['t'],
        stored: amount(C.t7F),
        def: { t: def.t7.F },
        fKey: 't7F',
        write: (d, v) => ({ ...d, t7F: v ? n0(v.t) : null }),
        source: 'GSTR-9 4N−4G−4G1+10−11',
        sourceTitle: 'GSTR-9 taxable turnover: 4N − 4G − 4G1 + Table 10 − Table 11',
      },
      { id: 'G', code: '7G', label: T7_LABEL.G, hint: '(F − E)', mode: 'computed', heads: ['t'], shown: { t: W.t7.G }, emphasis: 'diff', diffKey: 'gstr9c.7G' },
    ];
  }, [C.t7, C.t7F, def.t7, W.t7]);

  return (
    <SectionCard
      title="Table 7 · Reconciliation of taxable turnover"
      description="From adjusted turnover to taxable turnover. B–D1 and F are computed from the GSTR-9 working; type over any of them if the return says otherwise."
      excelRef="9C utility PT II (7)"
    >
      <FormGrid label="GSTR-9C Table 7" lines={t7Lines} heads={['t']} headLabels={{ t: 'Amount (₹)' }} />
      <Note tone="position">
        7B–7D1 come from GSTR-9 Table 5, which is built from the nature tagged on each Sales Part B ledger (every 5A–5F bucket), not from row positions as in
        the sheet.
      </Note>
      <ReasonsBox field="t8Reasons" code="8" title="Reasons for un-reconciled difference in taxable turnover" diffKey="gstr9c.7G" />
    </SectionCard>
  );
};
