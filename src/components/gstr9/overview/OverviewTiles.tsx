import React from 'react';
import type { DiffLine, StepKey } from '@/lib/gstr9/engine';
import { KpiTile } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { monthsApplied, nzT, rupees, stepMeta, sumTax, useGoToStep, worstHead } from './steps';

type Tone = 'ok' | 'warn' | 'error' | 'neutral';

/** Error while any line is open, warn when every difference is justified, ok when nothing needs a reason. */
const toneOf = (lines: DiffLine[]): Tone => (lines.some((d) => d.open) ? 'error' : lines.some((d) => d.requiresReason) ? 'warn' : 'ok');

const openHint = (lines: DiffLine[], unit: string): string => {
  const n = lines.filter((d) => d.open).length;
  return n ? ` · ${n} ${unit}${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a reason` : '';
};

const matched = (v: number) => Math.abs(v) < 0.005;

interface TileDef {
  key: string;
  step: StepKey;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone: Tone;
}

/** The headline checks of the working, each opening the step it comes from. */
export const OverviewTiles: React.FC = () => {
  const { workings: w } = useWorkspace();
  const go = useGoToStep();
  const by = (test: (key: string) => boolean) => w.diffs.filter((d) => test(d.key));
  const applied = monthsApplied(w).length;
  const tiles: TileDef[] = [];

  // Turnover — books (PL-OUTPUT Part A + B) vs the audit report (D56 = report − books).
  if (w.sales.auditReportTotal === null) {
    tiles.push({ key: 'turnover', step: 'sales', label: 'Turnover · books vs audit report', value: rupees(w.sales.total), hint: 'Books total · audit-report total not entered yet', tone: 'neutral' });
  } else {
    const d = w.sales.auditDiff ?? 0;
    tiles.push({
      key: 'turnover', step: 'sales', label: 'Turnover · books vs audit report',
      value: matched(d) ? 'Matched' : rupees(d),
      hint: `Report − books · books ${rupees(w.sales.total)} · report ${rupees(w.sales.auditReportTotal)}`,
      tone: toneOf(by((k) => k === 'sales.audit')),
    });
  }

  // Output tax — Duties & Taxes net vs the as-filed 3B, worst head.
  const outLines = by((k) => k.startsWith('dto.') && k !== 'dto.pl');
  if (!applied && !nzT(w.dto.totals.asPer3B)) {
    tiles.push({ key: 'out', step: 'duties', label: 'Output tax · books vs 3B', value: '—', hint: 'As-filed GSTR-3B not fetched yet', tone: 'neutral' });
  } else {
    const wh = worstHead(w.dto.totals.diff);
    tiles.push({
      key: 'out', step: 'duties', label: 'Output tax · books vs 3B',
      value: matched(wh.value) ? 'Matched' : `${rupees(wh.value)} ${wh.head}`,
      hint: `Books ${rupees(sumTax(w.dto.totals.net))} · 3B ${rupees(sumTax(w.dto.totals.asPer3B))}${openHint(outLines, 'month')}`,
      tone: toneOf(outLines),
    });
  }

  // ITC — Duties & Taxes (incl. RCM) vs the as-filed 3B, worst head.
  const itcLines = by((k) => k.startsWith('dti.'));
  if (!applied && !nzT(w.dti.totalItcPortal)) {
    tiles.push({ key: 'itc', step: 'duties', label: 'ITC · books vs 3B', value: '—', hint: 'As-filed GSTR-3B not fetched yet', tone: 'neutral' });
  } else {
    const wh = worstHead(w.dti.totalItcDiff);
    tiles.push({
      key: 'itc', step: 'duties', label: 'ITC · books vs 3B',
      value: matched(wh.value) ? 'Matched' : `${rupees(wh.value)} ${wh.head}`,
      hint: w.ctx.noItcBuilder
        ? 'Builder on the no-ITC scheme — shown for information'
        : `Books ${rupees(sumTax(w.dti.totalItcBooks))} · 3B ${rupees(sumTax(w.dti.totalItcPortal))} (incl. RCM)${openHint(itcLines, 'month')}`,
      tone: w.ctx.noItcBuilder ? 'neutral' : toneOf(itcLines),
    });
  }

  // Outward — books vs GSTR-9 auto-populated Table 4 (GSTR 9-OUTPUT D32).
  const outwardLines = by((k) => k.startsWith('out.'));
  if (w.g9.t4Source === 'none') {
    tiles.push({ key: 'outward', step: 'outward', label: 'Outward · books vs GSTR-9', value: '—', hint: 'GSTR-9 system-computed figures not fetched yet', tone: 'neutral' });
  } else {
    const d = w.outward.diffTotal;
    const wh = worstHead(d);
    tiles.push({
      key: 'outward', step: 'outward', label: 'Outward · books vs GSTR-9',
      value: matched(d.t) ? 'Matched' : rupees(d.t),
      hint: `Taxable value, books − GSTR-9 · tax ${matched(wh.value) ? 'matched' : `${rupees(wh.value)} ${wh.head}`}${openHint(outwardLines, 'line')}`,
      tone: toneOf(outwardLines),
    });
  }

  // 8D — ITC in GSTR-2B not availed.
  const t8D = sumTax(w.g9.t8.D);
  if (!nzT(w.g9.t8.A) && w.g9.t4Source === 'none') {
    tiles.push({ key: '8d', step: 'gstr9', label: 'Table 8D · 2B not availed', value: '—', hint: '8A (GSTR-2B) not fetched yet', tone: 'neutral' });
  } else {
    tiles.push({
      key: '8d', step: 'gstr9', label: 'Table 8D · 2B not availed',
      value: rupees(t8D),
      hint: `8A ${rupees(sumTax(w.g9.t8.A))} − (8B + 8C) ${rupees(sumTax(w.g9.t8.B) + sumTax(w.g9.t8.C))}`,
      tone: w.ctx.noItcBuilder ? 'neutral' : toneOf(by((k) => k === 'g9.8D')),
    });
  }

  // The open-difference count and its "Review & lock" call to action are on the
  // Overview's status line, so there is no sixth tile repeating it.

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => go(t.step)}
          title={`${t.label} — ${t.hint}. Go to ${stepMeta(t.step).label}`}
          className="rounded-lg text-left transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:h-full"
        >
          {/* KpiTile truncates its hint to one line; here it wraps to up to three, so the figures behind the check stay readable. */}
          <KpiTile label={t.label} value={t.value} hint={<span className="line-clamp-3 whitespace-normal">{t.hint}</span>} tone={t.tone} />
        </button>
      ))}
    </div>
  );
};

export default OverviewTiles;
