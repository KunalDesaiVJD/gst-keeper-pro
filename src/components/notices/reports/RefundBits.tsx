// The small pieces the Refunds pages are built from: the steps of a refund
// with their dates, the bar that splits a claim into sanctioned / rejected /
// awaiting, and the colour and word for where a refund stands.
import React from 'react';
import { CalendarDays, Check, X } from 'lucide-react';
import { fmtDate, fmtInr, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { MONEY_PARTS, TONE_CELL, TONE_LABEL, TONE_TEXT, refundWhen, type Money, type RefundStep, type Tone } from './refundModel';

// ── Steps ───────────────────────────────────────────────────────────────────
const stepTone = (s: RefundStep) => (!s.done ? 'pending' : s.bad ? 'bad' : 'done');

/** The full road, each step with its date (the side panel; large on the refund's own page). */
export const StepRoad: React.FC<{ steps: RefundStep[]; large?: boolean }> = ({ steps, large }) => (
  <ol className="grid gap-0 sm:flex sm:flex-wrap sm:items-start" aria-label="Steps">
    {steps.map((s, i) => {
      const t = stepTone(s);
      return (
        <li key={s.key} className="flex items-start gap-2 sm:min-w-[6.5rem] sm:flex-1 sm:flex-col sm:items-center sm:gap-1 sm:text-center">
          <div className="flex items-center sm:w-full">
            <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === 0 ? 'bg-transparent' : s.done ? (t === 'bad' ? 'bg-destructive/50' : 'bg-success/50') : 'bg-border')} />
            <span className={cn('flex shrink-0 items-center justify-center rounded-full border-2', large ? 'h-8 w-8' : 'h-6 w-6',
              t === 'done' && 'border-success bg-success text-success-foreground', t === 'bad' && 'border-destructive bg-destructive text-destructive-foreground',
              t === 'pending' && 'border-muted-foreground/30 bg-card text-muted-foreground')}>
              {t === 'done' ? <Check className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden /> : t === 'bad' ? <X className={large ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden /> : <span className={cn('font-semibold', large ? 'text-xs' : 'text-[10px]')}>{i + 1}</span>}
            </span>
            <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === steps.length - 1 ? 'bg-transparent' : steps[i + 1]?.done ? 'bg-success/50' : 'bg-border')} />
          </div>
          <div className="pb-2 sm:pb-0">
            <div className={cn('font-medium leading-tight', large ? 'text-sm' : 'text-xs', !s.done && 'text-muted-foreground')}>{s.label}</div>
            <div className={cn('tabular-nums text-muted-foreground', large ? 'mt-0.5 text-[13px]' : 'text-[11px]')}>{s.done ? (s.date ? fmtDate(s.date) : 'date not captured') : 'to come'}</div>
          </div>
        </li>
      );
    })}
  </ol>
);

// ── Money ───────────────────────────────────────────────────────────────────
/** A claim split into its parts, as one bar (thin in the list, taller in the overview). */
export const MoneyBar: React.FC<{ m: Money; className?: string }> = ({ m, className }) => {
  if (m.claimed <= 0) return <div className={cn('h-1.5 w-full rounded-full bg-muted', className)} aria-hidden />;
  const parts = MONEY_PARTS.filter((p) => m[p.key] > 0);
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="img"
      aria-label={parts.map((p) => `${p.label} ${fmtInr(m[p.key])}`).join(', ')}>
      {parts.map((p) => (
        <div key={p.key} className={cn('h-full', p.bar)} style={{ width: `${(m[p.key] / m.claimed) * 100}%` }} title={`${p.label}: ${fmtInr(m[p.key])}`} />
      ))}
    </div>
  );
};

/** The legend of a money bar: each part with its amount and share. */
export const MoneyLegend: React.FC<{ m: Money }> = ({ m }) => (
  <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:flex sm:flex-wrap">
    {MONEY_PARTS.filter((p) => m[p.key] > 0 || p.key === 'sanctioned' || p.key === 'rejected').map((p) => (
      <li key={p.key} className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-sm', p.dot)} />
        <span className="truncate text-muted-foreground">{p.label}</span>
        <span className="ml-auto font-medium tabular-nums sm:ml-1">{fmtInrShort(m[p.key])}</span>
        <span className="w-9 text-right tabular-nums text-muted-foreground sm:w-auto">{m.claimed ? `${Math.round((m[p.key] / m.claimed) * 100)}%` : '—'}</span>
      </li>
    ))}
  </ul>
);

// ── Tones (the grid's cells and the register's status) ──────────────────────
/** A refund's standing as a small pill. */
export const TonePill: React.FC<{ tone: Tone; className?: string }> = ({ tone, className }) => (
  <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold', TONE_CELL[tone], TONE_TEXT[tone], className)}>
    {TONE_LABEL[tone]}
  </span>
);

// ── Year and period ──────────────────────────────────────────────────────────
/** The refund's financial year and period as one chip ("FY 2024-25 · Apr–Jun 2024"), on every page that shows a refund. */
export const RefundWhenChip: React.FC<{ r: RefundRow | null | undefined; className?: string }> = ({ r, className }) => {
  const w = r ? refundWhen(r) : null;
  if (!w) return null;
  const note = w.byFiling ? 'The application\'s period is not captured; the year is that of the filing date.'
    : w.fromAi ? 'Period read by the AI from the refund\'s papers.' : 'Period of the refund application (RFD-01) on the portal.';
  return (
    <span title={note} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] font-semibold text-primary', className)}>
      <CalendarDays className="h-3 w-3 shrink-0" aria-hidden />
      {w.fy}<span className="font-normal text-foreground/80">· {w.period ?? (w.byFiling ? 'period not captured' : '—')}</span>
    </span>
  );
};
