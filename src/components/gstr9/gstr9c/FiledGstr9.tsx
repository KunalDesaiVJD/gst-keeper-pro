import React, { useMemo } from 'react';
import type { Gstr9cDoc, Gstr9FiledFigures, Tax } from '@/lib/gstr9/types';
import { Note } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { FormGrid } from './FormGrid';
import { amount, figs, FormLine, n0, TAX_HEADS, toTax } from './formLines';

// The GSTR-9 as filed on the portal, typed from its filed summary (28 Nov 2026). The portal checks
// GSTR-9C 5Q and 9Q against it to the paisa; the working's GSTR-9 is computed from the books and can
// differ from what was filed, so 5Q and 9Q follow these figures once they are typed.

const EMPTY: Gstr9FiledFigures = { t5N: null, t10: null, t11: null, paid9: null, paid14: null };
const setFiled = (d: Gstr9cDoc, patch: Partial<Gstr9FiledFigures>): Gstr9cDoc => ({ ...d, filedG9: { ...EMPTY, ...(d.filedG9 ?? {}), ...patch } });

const WORKING = 'GSTR-9 working';
const WORKING_TITLE = 'Shown from the GSTR-9 working until typed. Type the figure from the filed GSTR-9, even when it is the same.';

/** On GSTR-9C Table 5: 5N, 10 and 11 of the filed GSTR-9. */
export const FiledTurnoverGrid: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const F = docs.gstr9c.filedG9 ?? EMPTY;
  const g9 = workings.g9;
  const tie = workings.gstr9c.g9Tie;
  const lines = useMemo<FormLine[]>(() => [
    { id: 'N', code: '5N', label: 'Total turnover (including advances), as filed', mode: 'override', heads: ['t'], stored: amount(F.t5N), def: { t: g9.t5.N.t }, fKey: 'filedG9.t5N', write: (d, v) => setFiled(d, { t5N: v ? n0(v.t) : null }), source: WORKING, sourceTitle: WORKING_TITLE },
    { id: '10', code: '10', label: 'Supplies / tax declared through amendments (+), as filed', mode: 'override', heads: ['t'], stored: amount(F.t10), def: { t: g9.t10.t }, fKey: 'filedG9.t10', write: (d, v) => setFiled(d, { t10: v ? n0(v.t) : null }), source: WORKING, sourceTitle: WORKING_TITLE },
    { id: '11', code: '11', label: 'Supplies / tax reduced through amendments (−), as filed', mode: 'override', heads: ['t'], stored: amount(F.t11), def: { t: g9.t11.t }, fKey: 'filedG9.t11', write: (d, v) => setFiled(d, { t11: v ? n0(v.t) : null }), source: WORKING, sourceTitle: WORKING_TITLE },
    { id: 'T', code: '5Q', label: 'Turnover as declared in GSTR-9 (5N + 10 − 11)', mode: 'computed', heads: ['t'], shown: { t: tie.turnover }, emphasis: 'total', diffKey: 'gstr9c.5Q' },
  ], [F.t5N, F.t10, F.t11, g9.t5.N.t, g9.t10.t, g9.t11.t, tie.turnover]);
  return (
    <div className="space-y-2">
      <FiledNote missing={tie.filed.turnover === null} what="5N, Table 10 and Table 11" />
      <FormGrid label="GSTR-9 as filed: turnover" lines={lines} heads={['t']} headLabels={{ t: 'Amount (₹)' }} pinLast />
    </div>
  );
};

/** On GSTR-9C Table 9: the tax paid in Tables 9 and 14 of the filed GSTR-9. */
export const FiledPaidGrid: React.FC = () => {
  const { docs, workings } = useWorkspace();
  const F = docs.gstr9c.filedG9 ?? EMPTY;
  const g9 = workings.g9;
  const tie = workings.gstr9c.g9Tie;
  const work9: Tax = { i: g9.t9.igst.paid, c: g9.t9.cgst.paid, s: g9.t9.sgst.paid, x: g9.t9.cess.paid };
  const work14: Tax = { i: g9.t14.igst.paid, c: g9.t14.cgst.paid, s: g9.t14.sgst.paid, x: g9.t14.cess.paid };
  const lines = useMemo<FormLine[]>(() => [
    { id: 'P9', code: '9', label: 'Tax paid in Table 9 (cash + ITC), as filed', mode: 'override', heads: TAX_HEADS, stored: figs(F.paid9, false), def: figs(work9, false) ?? {}, fKey: 'filedG9.paid9', write: (d, v) => setFiled(d, { paid9: v ? toTax(v) : null }), source: WORKING, sourceTitle: WORKING_TITLE },
    { id: 'P14', code: '14', label: 'Differential tax paid in Table 14, as filed', mode: 'override', heads: TAX_HEADS, stored: figs(F.paid14, false), def: figs(work14, false) ?? {}, fKey: 'filedG9.paid14', write: (d, v) => setFiled(d, { paid14: v ? toTax(v) : null }), source: WORKING, sourceTitle: WORKING_TITLE },
    { id: 'T', code: '9Q', label: 'Total amount paid as declared in GSTR-9 (9 + 14)', mode: 'computed', heads: TAX_HEADS, shown: figs(tie.paid, false) ?? {}, emphasis: 'total', diffKey: 'gstr9c.9Q' },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [F.paid9, F.paid14, g9.t9, g9.t14, tie.paid]);
  return (
    <div className="space-y-2">
      <FiledNote missing={!tie.filed.paid} what="the tax paid in Tables 9 and 14" />
      <FormGrid label="GSTR-9 as filed: tax paid" lines={lines} heads={TAX_HEADS} pinLast />
    </div>
  );
};

const FiledNote: React.FC<{ missing: boolean; what: string }> = ({ missing, what }) => (
  <Note tone={missing ? 'warn' : 'info'}>
    {missing
      ? `GSTR-9 as filed: type ${what} from the filed GSTR-9 summary. The portal checks this table against the filed GSTR-9 to the paisa, and the GSTR-9 working (computed from the books) can differ from it. Mark prepared, Verify, Review & lock and the Portal JSON wait for these figures.`
      : `GSTR-9 as filed: the figures below are the filed GSTR-9's, and this table must equal them.`}
  </Note>
);
