import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDot, EqualApproximately, Info, MessageSquareText, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { diffStatus } from '@/lib/gstr9/engine';
import type { DiffLine, DiffStatusKind } from '@/lib/gstr9/engine';
import type { PortalMeta, Tax, ValTax } from '@/lib/gstr9/types';
import { fmtMoney } from './grid/money';
import { useWorkspace } from './WorkspaceContext';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const SectionCard: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The Excel sheet / cells this section reproduces, e.g. "PL-OUTPUT rows 10–33". */
  excelRef?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, description, excelRef, actions, children, className }) => (
  <Card className={className}>
    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-1.5 space-y-0 px-4 pb-2 pt-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <CardTitle className="text-[15px] leading-snug">{title}</CardTitle>
        {(description || excelRef) && (
          <CardDescription className="text-xs leading-snug">
            {description}
            {excelRef && <span className="ml-1 break-words rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:whitespace-nowrap">Excel: {excelRef}</span>}
          </CardDescription>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </CardHeader>
    <CardContent className="space-y-2.5 px-4 pb-3">{children}</CardContent>
  </Card>
);

/**
 * A note beside a table. Information and firm-position notes start folded to
 * one line (with "more" when there is more), so they don't push the figures
 * off the screen; warnings always show in full.
 */
export const Note: React.FC<{ tone?: 'info' | 'warn' | 'position'; children: React.ReactNode; className?: string; open?: boolean }> = ({ tone = 'info', children, className, open: startOpen }) => {
  const foldable = tone !== 'warn';
  const [open, setOpen] = useState(!!startOpen || !foldable);
  const [overflows, setOverflows] = useState(false);
  const textRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !foldable) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [foldable, open, children]);
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs',
        tone === 'info' && 'border-info/30 bg-info/5 text-foreground',
        tone === 'warn' && 'border-warning/40 bg-warning/10 text-foreground',
        tone === 'position' && 'border-primary/30 bg-primary/5 text-foreground',
        className,
      )}
    >
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />}
      <div ref={textRef} className={cn('min-w-0 flex-1', foldable && !open && 'line-clamp-1')}>
        {tone === 'position' && <span className="font-semibold">Firm position: </span>}
        {children}
      </div>
      {foldable && (overflows || open) && !startOpen && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded px-1 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
        >
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
};

export const KpiTile: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'ok' | 'warn' | 'error' | 'neutral' }> = ({ label, value, hint, tone = 'neutral' }) => (
  <div
    className={cn(
      'rounded-lg border bg-card px-3 py-1.5',
      tone === 'ok' && 'border-success/40',
      tone === 'warn' && 'border-warning/50',
      tone === 'error' && 'border-destructive/40',
    )}
  >
    <div className="truncate text-[11px] font-medium text-muted-foreground" title={label}>{label}</div>
    <div className={cn('text-[15px] font-semibold leading-tight tabular-nums', tone === 'error' && 'text-destructive-strong', tone === 'ok' && 'text-success-strong')}>{value}</div>
    {hint && <div className="truncate text-[11px] leading-tight text-muted-foreground" title={typeof hint === 'string' ? hint : undefined}>{hint}</div>}
  </div>
);

export const Money: React.FC<{ value: number | null | undefined; className?: string; signed?: boolean }> = ({ value, className, signed }) => (
  <span className={cn('tabular-nums', signed && value !== null && value !== undefined && value < -0.004 && 'text-destructive-strong', className)}>
    {fmtMoney(value ?? 0)}
  </span>
);

// ---------------------------------------------------------------------------
// Source of a portal figure
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  extension: 'Portal',
  upload: 'Uploaded',
  as_filed_3b: 'As-filed 3B',
  manual: 'Typed',
};

export const SourceChip: React.FC<{ meta?: PortalMeta | null; manual?: boolean; className?: string }> = ({ meta, manual, className }) => {
  const src = manual ? 'manual' : meta?.source ?? null;
  if (!src) return <Badge variant="outline" className={cn('text-[10px] font-normal text-muted-foreground', className)}>Not fetched</Badge>;
  const detail = [
    meta?.fetchedAt && `fetched ${new Date(meta.fetchedAt).toLocaleString('en-IN')}`,
    meta?.arn && `ARN ${meta.arn}`,
    meta?.filedDate && `filed ${meta.filedDate}`,
    meta?.status,
  ].filter(Boolean).join(' · ');
  const chip = (
    <Badge variant={src === 'manual' ? 'secondary' : 'info'} className={cn('text-[10px] font-normal', className)}>
      {SOURCE_LABEL[src] ?? src}
    </Badge>
  );
  if (!detail) return chip;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild><span>{chip}</span></TooltipTrigger>
        {/* Portalled so a chip inside a scrolling grid isn't clipped. */}
        <TooltipPrimitive.Portal>
          <TooltipContent className="text-xs">{detail}</TooltipContent>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
};

// ---------------------------------------------------------------------------
// Differences and justifications
// ---------------------------------------------------------------------------

export const useDiffLine = (key: string): DiffLine | undefined => {
  const { workings } = useWorkspace();
  return useMemo(() => workings.diffs.find((d) => d.key === key), [workings.diffs, key]);
};

const diffSummary = (d: DiffLine): string => {
  const parts: string[] = [];
  if (d.hasTaxable && Math.abs(d.diff.t) > 0.004) parts.push(`Value ${fmtMoney(d.diff.t)}`);
  if (d.hasTax) {
    (['i', 'c', 's', 'x'] as const).forEach((h) => {
      if (Math.abs(d.diff[h]) > 0.004) parts.push(`${{ i: 'IGST', c: 'CGST', s: 'SGST', x: 'Cess' }[h]} ${fmtMoney(d.diff[h])}`);
    });
  }
  return parts.join(' · ') || 'No difference';
};

/**
 * Status + reason editor for one difference line. Shows "Matched", "Within
 * tolerance", "Reason needed", "Justified" or "Re-check" (the difference moved
 * after it was justified), and opens a small editor for the reason.
 */
export const JustifyControl: React.FC<{ lineKey: string; compact?: boolean; className?: string }> = ({ lineKey, compact, className }) => {
  const { justify, readOnly, workings } = useWorkspace();
  const d = useDiffLine(lineKey);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  if (!d) return null;
  const text = d.justification?.text?.trim() ?? '';
  const mag = Math.max(d.hasTax ? Math.max(...(['i', 'c', 's', 'x'] as const).map((h) => Math.abs(d.diff[h]))) : 0, d.hasTaxable ? Math.abs(d.diff.t) : 0);

  const st = diffStatus(d, workings.tolerance);
  const STATUS_LOOK: Record<DiffStatusKind, { variant: 'success' | 'secondary' | 'destructive' | 'warning' | 'info'; icon: React.ReactNode }> = {
    recheck: { variant: 'warning', icon: <RotateCcw className="h-3 w-3" /> },
    open: { variant: 'destructive', icon: <AlertTriangle className="h-3 w-3 text-destructive-strong" /> },
    justified: { variant: 'info', icon: <MessageSquareText className="h-3 w-3" /> },
    matched: { variant: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    info: { variant: 'secondary', icon: <CircleDot className="h-3 w-3" /> },
    // Its own shape ("≈"), so it never reads as "Matched" by colour alone.
    within: { variant: 'secondary', icon: <EqualApproximately className="h-3 w-3" /> },
  };
  const status = { label: st.label, ...STATUS_LOOK[st.kind] };

  const canWrite = !readOnly && (mag >= 0.005 || !!text);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(d.justification?.text ?? ''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canWrite && !text}
          className={cn('inline-flex items-center', className)}
          aria-label={`${d.label}: ${status.label}`}
          title={compact ? status.label : undefined}
        >
          <Badge variant={status.variant} className={cn('gap-1 whitespace-nowrap text-[10px] font-medium', compact && 'px-1.5')}>
            {status.icon}
            {!compact && status.label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-2" align="end">
        <div className="text-sm font-semibold">{d.label}</div>
        <div className="text-xs text-muted-foreground">
          {d.direction}: <span className="font-medium text-foreground">{diffSummary(d)}</span>
        </div>
        {d.stale && (
          <Note tone="warn">
            This difference has changed since it was justified by {d.justification?.by ?? 'someone'} ({d.justification?.at ? new Date(d.justification.at).toLocaleDateString('en-IN') : ''}). Re-check the reason.
          </Note>
        )}
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Reason for the difference, as it should read in the working / reply to the officer"
          rows={4}
          disabled={readOnly}
          aria-label="Justification"
        />
        {!readOnly && (
          <div className="flex justify-end gap-2">
            {text && (
              <Button size="sm" variant="ghost" onClick={() => { justify(d.key, '', d.diff); setOpen(false); }}>Clear</Button>
            )}
            <Button size="sm" onClick={() => { justify(d.key, draft, d.diff); setOpen(false); }} disabled={!draft.trim()}>
              Save reason
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

// ---------------------------------------------------------------------------
// Read-only matrix of computed figures (GSTR-9 form, annexures, notice …)
// ---------------------------------------------------------------------------

export type MatrixHead = 't' | 'i' | 'c' | 's' | 'x';
export const HEAD_LABEL: Record<MatrixHead, string> = { t: 'Taxable value', i: 'IGST', c: 'CGST', s: 'SGST / UTGST', x: 'Cess' };

export interface MatrixRow {
  key: string;
  /** Row letter/number, e.g. "4A". */
  code?: React.ReactNode;
  label: React.ReactNode;
  value?: Partial<ValTax> | Tax | null;
  /** Section heading row (no figures). */
  heading?: boolean;
  total?: boolean;
  indent?: boolean;
  /** Source chip / note shown after the label. */
  note?: React.ReactNode;
  /** Difference line key — shows a JustifyControl at the end of the row. */
  diffKey?: string;
  /** Highlight negatives as a warning (differences). */
  signed?: boolean;
  /** Replace the figure cells with custom content (e.g. inline inputs). */
  cells?: Partial<Record<MatrixHead, React.ReactNode>>;
}

export const MatrixTable: React.FC<{
  rows: MatrixRow[];
  heads: MatrixHead[];
  label: string;
  headLabels?: Partial<Record<MatrixHead, string>>;
  withDiffColumn?: boolean;
  className?: string;
}> = ({ rows, heads, label, headLabels, withDiffColumn, className }) => {
  const hasDiff = withDiffColumn ?? rows.some((r) => r.diffKey);
  return (
    <div className={cn('overflow-x-auto rounded-md border', className)}>
      <table className="w-full border-collapse text-xs" aria-label={label}>
        <thead className="bg-muted">
          <tr>
            <th className="w-14 border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">No.</th>
            <th className="min-w-[15rem] border-b border-r px-2 py-1.5 text-left font-semibold text-muted-foreground">Particulars</th>
            {heads.map((h) => (
              <th key={h} className="min-w-[7.5rem] border-b border-r px-2 py-1.5 text-right font-semibold text-muted-foreground whitespace-nowrap">
                {headLabels?.[h] ?? HEAD_LABEL[h]}
              </th>
            ))}
            {hasDiff && <th className="w-32 border-b px-2 py-1.5 text-right font-semibold text-muted-foreground">Status</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            r.heading ? (
              <tr key={r.key} className="bg-muted/50">
                <td className="border-b border-r px-2 py-1.5 font-semibold">{r.code}</td>
                <td colSpan={heads.length + 1 + (hasDiff ? 1 : 0)} className="border-b px-2 py-1.5 font-semibold">{r.label}</td>
              </tr>
            ) : (
              <tr key={r.key} className={cn(r.total && 'bg-muted/40 font-semibold')}>
                <td className="border-b border-r px-2 py-1.5 align-top text-muted-foreground">{r.code}</td>
                <td className={cn('border-b border-r px-2 py-1.5 align-top', r.indent && 'pl-6')}>
                  <span>{r.label}</span>
                  {r.note && <span className="ml-2 inline-flex align-middle">{r.note}</span>}
                </td>
                {heads.map((h) => (
                  <td key={h} className="border-b border-r px-2 py-1.5 text-right align-top tabular-nums whitespace-nowrap">
                    {r.cells?.[h] !== undefined
                      ? r.cells[h]
                      : r.value && (r.value as Record<string, number>)[h] !== undefined
                        ? <Money value={(r.value as Record<string, number>)[h]} signed={r.signed} />
                        : <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
                {hasDiff && (
                  <td className="border-b px-2 py-1 text-right align-top">
                    {r.diffKey ? <JustifyControl lineKey={r.diffKey} /> : null}
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
};

/** Open-difference list for one step (shown at the top of each step). */
export const OpenDifferences: React.FC<{ step: DiffLine['step']; className?: string }> = ({ step, className }) => {
  const { workings } = useWorkspace();
  const open = workings.diffs.filter((d) => d.step === step && d.open);
  if (!open.length) return null;
  return (
    <Note tone="warn" className={className}>
      <span className="font-medium">{open.length === 1 ? '1 difference needs a reason: ' : `${open.length} differences need a reason: `}</span>
      <span className="inline-flex flex-wrap gap-1 align-middle">
        {open.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1 rounded border bg-card px-1.5 py-0.5">
            {d.label}
            <JustifyControl lineKey={d.key} compact />
          </span>
        ))}
      </span>
    </Note>
  );
};
