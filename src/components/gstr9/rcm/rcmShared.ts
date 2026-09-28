// Small helpers shared by the RCM step's cards (the firm's "RCM" sheet).
// No tax logic lives here — every figure comes from computeWorkings() or
// the engine's rcmCellTax(); these only shape rows and labels.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONTH_LABEL, num } from '@/lib/gstr9/engine';
import { newId } from '@/lib/gstr9/defaults';
import { FY_MONTHS, MonthKey, RcmCategory, RcmCell, RcmItcTable, SupplyType } from '@/lib/gstr9/types';
import { fmtRate } from '../grid/money';

/** "apr" in FY 2024-25 → "Apr 2024"; "jan" → "Jan 2025". */
export const monthLabel = (m: MonthKey, financialYear: string): string => {
  const start = Number(financialYear.slice(0, 4));
  const year = FY_MONTHS.indexOf(m) < 9 ? start : start + 1;
  return Number.isFinite(year) ? `${MONTH_LABEL[m]} ${year}` : MONTH_LABEL[m];
};

/** Twelve empty RCM cells (taxable 0, tax computed from the rate). */
export const emptyRcmMonths = (): Record<MonthKey, RcmCell> =>
  Object.fromEntries(FY_MONTHS.map((m) => [m, { taxable: 0 }])) as Record<MonthKey, RcmCell>;

export const newRcmCategory = (init: Partial<Pick<RcmCategory, 'name' | 'rate' | 'supplyType' | 'itcTable'>> = {}): RcmCategory => ({
  id: newId(),
  name: init.name ?? '',
  rate: init.rate ?? 18,
  supplyType: init.supplyType ?? 'intra',
  itcTable: init.itcTable ?? '6C',
  months: emptyRcmMonths(),
});

/** A category's cell for a month, tolerant of docs saved without every month. */
export const cellOf = (cat: RcmCategory, m: MonthKey): RcmCell => cat.months?.[m] ?? { taxable: 0 };

export const TAX_HEADS = ['i', 'c', 's', 'x'] as const;
export type TaxHead = (typeof TAX_HEADS)[number];
export const TAX_HEAD_LABEL: Record<TaxHead, string> = { i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' };

/** Whether a tax head of the cell was typed (null/undefined = computed from the rate). */
export const isTyped = (cell: RcmCell, h: TaxHead): boolean => cell[h] !== null && cell[h] !== undefined;

/** Number of months in which any tax head of the category was typed over the computed figure. */
export const typedMonthCount = (cat: RcmCategory): number =>
  FY_MONTHS.filter((m) => TAX_HEADS.some((h) => isTyped(cellOf(cat, m), h))).length;

export const categoryName = (cat: Pick<RcmCategory, 'name'>): string => cat.name?.trim() || 'Unnamed expense';

/** Grid header for a category: "TRANSPORTATION EXP · 5%" (· IGST when inter-state). */
export const categoryHeader = (cat: RcmCategory): string =>
  `${categoryName(cat)} · ${fmtRate(num(cat.rate))}${cat.supplyType === 'inter' ? ' IGST' : ''}`;

export const SUPPLY_OPTIONS: Array<{ value: SupplyType; label: string }> = [
  { value: 'intra', label: 'Intra-state (CGST + SGST)' },
  { value: 'inter', label: 'Inter-state (IGST)' },
];

export const ITC_TABLE_OPTIONS: Array<{ value: RcmItcTable; label: string }> = [
  { value: '6C', label: '6C · Unregistered supplier' },
  { value: '6D', label: '6D · Registered supplier' },
  { value: '6F', label: '6F · Import of services' },
];

export const ITC_TABLE_LABEL: Record<RcmItcTable, string> = {
  '6C': 'Inward supplies from unregistered persons liable to reverse charge — input services',
  '6D': 'Inward supplies from registered persons liable to reverse charge — input services',
  '6F': 'Import of services (excluding inward supplies from SEZs)',
};

/** The four expense blocks of the firm's RCM sheet (rows 48, 67, 86, 105) — a quick start. */
export const SHEET_BLOCKS: Array<Pick<RcmCategory, 'name' | 'rate' | 'supplyType' | 'itcTable'>> = [
  { name: 'TRANSPORTATION EXP', rate: 5, supplyType: 'intra', itcTable: '6C' },
  { name: 'DELIVERY EXP', rate: 5, supplyType: 'intra', itcTable: '6C' },
  { name: 'OFFICE RENT EXPENSE', rate: 18, supplyType: 'intra', itcTable: '6C' },
  { name: 'ADVOCATE FEES', rate: 18, supplyType: 'intra', itcTable: '6C' },
];

/** The FY before "2024-25" → "2023-24". */
export const previousFY = (financialYear: string): string => {
  const start = Number(financialYear.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
};

/** Jump to another step of the workspace, keeping the open client (and everything else) in the URL. */
export const useGoToStep = () => {
  const [params, setParams] = useSearchParams();
  return useCallback(
    (step: string) => {
      const next = new URLSearchParams(params);
      next.set('step', step);
      setParams(next);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [params, setParams],
  );
};
