import React from 'react';
import { cn } from '@/lib/utils';
import type { PayableSideWorking } from '@/lib/gstr9/engine';
import { SIDE_LABEL, type PayableSide } from '@/lib/gstr9/payables';
import type { Tax } from '@/lib/gstr9/types';
import { fmtMoney } from '../grid/money';
import { sumTax } from '../overview/steps';

const HEADS: Array<[keyof Tax, string]> = [['i', 'IGST'], ['c', 'CGST'], ['s', 'SGST / UTGST'], ['x', 'Cess']];

type Tone = 'total' | 'muted' | 'balance' | 'warn' | undefined;

const Row: React.FC<{ label: React.ReactNode; value: Tax; tone?: Tone; note?: string; tolerance: number }> = ({ label, value, tone, note, tolerance }) => {
  const total = sumTax(value);
  const cell = (v: number) => {
    const owe = tone === 'balance' && v > tolerance;
    return (
      <td className={cn('whitespace-nowrap border-b px-2 py-1.5 text-right tabular-nums',
        tone === 'muted' && 'text-muted-foreground',
        owe && 'font-semibold text-destructive-strong',
        tone === 'balance' && !owe && 'text-success-strong',
        tone === 'warn' && v > 0.004 && 'font-medium text-destructive-strong')}>
        {v < -0.004 ? `(${fmtMoney(-v)})` : fmtMoney(v)}
      </td>
    );
  };
  return (
    <tr className={cn((tone === 'total' || tone === 'balance') && 'bg-muted/40 font-semibold')}>
      <td className={cn('border-b px-2 py-1.5', tone === 'muted' && 'text-muted-foreground')}>
        {label}
        {note && <div className="text-[11px] font-normal text-muted-foreground">{note}</div>}
      </td>
      {HEADS.map(([h]) => <React.Fragment key={h}>{cell(value[h])}</React.Fragment>)}
      {cell(total)}
    </tr>
  );
};

/**
 * One side of the payable disclosure: the Annexure-3 rows that make it up,
 * the payable (positive heads only — nothing is netted across heads or
 * against the other side), what is set off and the balance outstanding.
 */
export const PayableDisclosure: React.FC<{ side: PayableSide; data: PayableSideWorking; tolerance: number }> = ({ side, data, tolerance }) => {
  const has = (t: Tax) => sumTax(t) > 0.004 || Object.values(t).some((v) => Math.abs(v) > 0.004);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[720px] border-collapse text-xs" aria-label={`${SIDE_LABEL[side]} payable`}>
        <thead className="bg-muted">
          <tr className="text-muted-foreground">
            <th className="border-b px-2 py-1.5 text-left font-semibold">{SIDE_LABEL[side]}</th>
            {HEADS.map(([h, l]) => <th key={h} className="w-28 border-b px-2 py-1.5 text-right font-semibold">{l}</th>)}
            <th className="w-28 border-b px-2 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.components.map((c) => <Row key={c.key} label={c.label} value={c.value} tolerance={tolerance} tone="muted" />)}
          <Row label="Net" value={data.net} tolerance={tolerance} />
          <Row label="Payable" note="Heads that come out positive; a negative head is not netted against another head." value={data.payable} tone="total" tolerance={tolerance} />
          {has(data.excess) && <Row label="Paid / reversed in excess — not a payable" value={data.excess} tone="muted" tolerance={tolerance} />}
          <Row label="Set off by DRC-03" value={data.setOffDrc03} tolerance={tolerance} />
          <Row label="Set off in GSTR-3B" value={data.setOffGstr3b} tolerance={tolerance} />
          <Row label="Balance outstanding" value={data.balance} tone="balance" tolerance={tolerance} />
          {has(data.overSetOff) && <Row label="Set off beyond the payable" note="Check the register — more is set off than the working shows as payable." value={data.overSetOff} tone="warn" tolerance={tolerance} />}
        </tbody>
      </table>
    </div>
  );
};

export default PayableDisclosure;
