// The small pieces the Refunds pages are built from: the steps of a refund
// with their dates, the bar that splits a claim into sanctioned / rejected /
// awaiting, and the colour and word for where a refund stands.
import React from 'react';
import { Check, X } from 'lucide-react';
import { fmtDate, fmtInr, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { MONEY_PARTS, TONE_CELL, TONE_LABEL, TONE_TEXT, type Money, type RefundStep, type Tone } from './refundModel';

// ── Steps ───────────────────────────────────────────────────────────────────
const stepTone = (s: RefundStep) => (!s.done ? 'pending' : s.bad ? 'bad' : 'done');

/** The full road, each step with its date (the side panel). */
export const StepRoad: React.FC<{ steps: RefundStep[] }> = ({ steps }) => (
  <ol className="grid gap-0 sm:flex sm:flex-wrap sm:items-start" aria-label="Steps">
    {steps.map((s, i) => {
      const t = stepTone(s);
      return (
        <li key={s.key} className="flex items-start gap-2 sm:min-w-[6.5rem] sm:flex-1 sm:flex-col sm:items-center sm:gap-1 sm:text-center">
          <div className="flex items-center sm:w-full">
            <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === 0 ? 'bg-transparent' : s.done ? (t === 'bad' ? 'bg-destructive/50' : 'bg-success/50') : 'bg-border')} />
            <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
              t === 'done' && 'border-success bg-success text-success-foreground', t === 'bad' && 'border-destructive bg-destructive text-destructive-foreground',
              t === 'pending' && 'border-muted-foreground/30 bg-card text-muted-foreground')}>
              {t === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : t === 'bad' ? <X className="h-3.5 w-3.5" aria-hidden /> : <span className="text-[10px] font-semibold">{i + 1}</span>}
            </span>
            <span aria-hidden className={cn('hidden h-0.5 flex-1 sm:block', i === steps.length - 1 ? 'bg-transparent' : steps[i + 1]?.done ? 'bg-success/50' : 'bg-border')} />
          </div>
          <div className="pb-2 sm:pb-0">
            <div className={cn('text-xs font-medium leading-tight', !s.done && 'text-muted-foreground')}>{s.label}</div>
            <div className="text-[11px] tabular-nums text-muted-foreground">{s.done ? (s.date ? fmtDate(s.date) : 'date not captured') : 'to come'}</div>
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
