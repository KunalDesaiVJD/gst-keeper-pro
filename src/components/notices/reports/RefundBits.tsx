// The small pieces the Refunds page is built from: the steps of a refund (a
// row of dots in the list, the full road with dates in the side panel), the
// bar that splits a claim into sanctioned / rejected / awaiting, and the chips
// for the cases linked to a refund.
import React from 'react';
import { Link } from 'react-router-dom';
import { Check, GitBranch, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { caseHref } from '@/lib/noticeCases';
import { fmtDate, fmtInr, fmtInrShort } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import type { RefundRow } from './ledgerData';
import { MONEY_PARTS, linkWord, type Money, type RefundStep } from './refundModel';

// ── Steps ───────────────────────────────────────────────────────────────────
const stepTone = (s: RefundStep) => (!s.done ? 'pending' : s.bad ? 'bad' : 'done');

/** The steps as a row of dots joined by a line, the last one done named under it. */
export const StepDots: React.FC<{ steps: RefundStep[] }> = ({ steps }) => {
  const last = [...steps].reverse().find((s) => s.done);
  return (
    <div className="min-w-0">
      <ol className="flex items-center" aria-label={`Steps: ${steps.map((s) => `${s.short} ${s.done ? 'done' : 'to come'}`).join(', ')}`}>
        {steps.map((s, i) => {
          const t = stepTone(s);
          return (
            <li key={s.key} className="flex items-center">
              {i > 0 && <span aria-hidden className={cn('h-0.5 w-3', s.done ? (t === 'bad' ? 'bg-destructive/60' : 'bg-success/60') : 'bg-border')} />}
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <span tabIndex={-1} className={cn('block h-2.5 w-2.5 rounded-full border',
                    t === 'done' && 'border-success bg-success', t === 'bad' && 'border-destructive bg-destructive', t === 'pending' && 'border-muted-foreground/40 bg-card')} />
                </TooltipTrigger>
                <TooltipContent className="text-xs">{s.label}{s.done ? (s.date ? ` · ${fmtDate(s.date)}` : ' · done') : ' · to come'}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {last && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{last.short}{last.date ? ` ${fmtDate(last.date)}` : ''}</div>}
    </div>
  );
};

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

// ── Links ───────────────────────────────────────────────────────────────────
/** One chip per linked case: what it is to this refund, open or closed; a page to open when there is one. */
export const LinkChips: React.FC<{ r: RefundRow; onOpenRefund?: (arn: string) => void; max?: number }> = ({ r, onOpenRefund, max = 3 }) => {
  if (!r.links.length) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = r.links.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((l) => {
        const word = linkWord(l.kind, l.dir);
        const cls = cn('inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium hover:bg-muted/60',
          l.kind === 'appeal' ? 'border-warning/60 bg-warning/10' : 'border-border bg-card');
        const body = (
          <>
            <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{word}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{l.key.slice(-6)}</span>
            {l.isOpen !== null && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', l.isOpen ? 'bg-info' : 'bg-muted-foreground/50')} aria-label={l.isOpen ? 'open' : 'closed'} />}
          </>
        );
        const title = `${word} ${l.key}${l.title ? ` · ${l.title}` : ''}${l.isOpen === null ? '' : l.isOpen ? ' · open' : ' · closed'}`;
        if (l.refund && onOpenRefund) return <button key={l.key} type="button" title={title} className={cls} onClick={(e) => { e.stopPropagation(); onOpenRefund(l.key); }}>{body}</button>;
        if (l.hasPage) return <Link key={l.key} to={caseHref(r.fact.client_id as string, l.key)} title={title} className={cls} onClick={(e) => e.stopPropagation()}>{body}</Link>;
        return <span key={l.key} title={title} className={cls}>{body}</span>;
      })}
      {r.links.length > max && <span className="text-[11px] text-muted-foreground">+{r.links.length - max}</span>}
    </span>
  );
};
