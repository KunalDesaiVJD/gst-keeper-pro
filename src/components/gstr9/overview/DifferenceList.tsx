import React, { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DiffLine } from '@/lib/gstr9/engine';
import { fmtMoney } from '../grid/money';
import { JustifyControl, SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, rupeesShort, STEP_META, stepMeta, useGoToStep } from './steps';

type Filter = 'open' | 'all' | 'justified';

const HEADS = [
  ['i', 'IGST'],
  ['c', 'CGST'],
  ['s', 'SGST'],
  ['x', 'Cess'],
] as const;

const hasText = (d: DiffLine) => !!d.justification?.text?.trim();

/** A difference figure: red only when it is what keeps the line open. */
const Amount: React.FC<{ v: number; tol: number; loud: boolean }> = ({ v, tol, loud }) => {
  const a = Math.abs(v);
  return (
    <span className={cn('tabular-nums', a < 0.005 ? 'text-muted-foreground' : loud && a > tol ? 'font-medium text-destructive-strong' : 'text-foreground')}>
      {fmtMoney(v)}
    </span>
  );
};

/** Every difference line of the working, grouped by step, with its status and reason. */
export const DifferenceList: React.FC = () => {
  const { workings: w } = useWorkspace();
  const go = useGoToStep();
  const [filter, setFilter] = useState<Filter>('open');

  const counts = useMemo(
    () => ({
      open: w.diffs.filter((d) => d.open).length,
      justified: w.diffs.filter(hasText).length,
      quiet: w.diffs.filter((d) => !d.open && !hasText(d)).length,
      all: w.diffs.length,
    }),
    [w.diffs],
  );
  const groups = useMemo(() => {
    const pick = (d: DiffLine) => (filter === 'open' ? d.open : filter === 'justified' ? hasText(d) : true);
    return STEP_META.map((s) => ({ step: s, lines: w.diffs.filter((d) => d.step === s.key && pick(d)) })).filter((g) => g.lines.length > 0);
  }, [w.diffs, filter]);

  const empty =
    filter === 'open'
      ? `No open differences. Every line is matched, within ${rupeesShort(w.tolerance)} on each head, or has a reason — the year can be locked.`
      : filter === 'justified'
        ? 'No line has a reason yet.'
        : 'No difference lines yet — they appear as figures are entered.';

  return (
    <SectionCard
      title="Differences"
      description={`${counts.open} open · ${counts.justified} justified · ${counts.quiet} matched, within ${rupeesShort(w.tolerance)} or for information. Each line reads in the direction shown (e.g. Books − 3B).`}
      actions={
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-8">
            <TabsTrigger value="open" className="h-7 gap-1 px-2.5 text-xs">
              Open
              <Badge variant={counts.open ? 'destructive' : 'secondary'} className="h-4 px-1.5 text-[10px] leading-none">{counts.open}</Badge>
            </TabsTrigger>
            <TabsTrigger value="all" className="h-7 gap-1 px-2.5 text-xs">
              All <span className="tabular-nums text-muted-foreground">{counts.all}</span>
            </TabsTrigger>
            <TabsTrigger value="justified" className="h-7 gap-1 px-2.5 text-xs">
              Justified <span className="tabular-nums text-muted-foreground">{counts.justified}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      {groups.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
          {filter === 'open' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />}
          {empty}
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-md border">
          <table className="w-full min-w-[980px] border-collapse text-xs" aria-label="Difference lines">
            <thead className="bg-muted">
              <tr className="text-muted-foreground">
                <th scope="col" className="border-b px-2 py-1.5 text-left font-semibold">Line</th>
                <th scope="col" className="w-32 border-b px-2 py-1.5 text-left font-semibold">Direction</th>
                <th scope="col" className="w-28 border-b px-2 py-1.5 text-right font-semibold">Value</th>
                {HEADS.map(([h, label]) => (
                  <th key={h} scope="col" className="w-24 border-b px-2 py-1.5 text-right font-semibold">{label}</th>
                ))}
                <th scope="col" className="w-32 border-b px-2 py-1.5 text-right font-semibold">Status</th>
                <th scope="col" className="w-10 border-b px-1 py-1.5"><span className="sr-only">Go to step</span></th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ step, lines }) => (
                <React.Fragment key={step.key}>
                  <tr className="bg-muted/50">
                    <td colSpan={9} className="border-b px-2 py-1">
                      <button
                        type="button"
                        onClick={() => go(step.key)}
                        className="inline-flex items-center gap-1.5 rounded text-xs font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-background text-[9px] text-muted-foreground">{step.n}</span>
                        {step.label}
                        <span className="font-normal text-muted-foreground">· {lines.length} line{lines.length === 1 ? '' : 's'}</span>
                      </button>
                    </td>
                  </tr>
                  {lines.map((d) => {
                    const j = d.justification;
                    const text = j?.text?.trim();
                    return (
                      <tr key={d.key} className={cn('align-top', d.open && 'bg-destructive/5')}>
                        <td className="border-b px-2 py-1.5">
                          <div className="font-medium text-foreground">{d.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {d.aLabel} vs {d.bLabel}
                            {d.informational && <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] font-normal">For information</Badge>}
                          </div>
                          {text && (
                            <div className={cn('mt-1 border-l-2 pl-2 text-[11px]', d.stale ? 'border-warning' : 'border-info/50')}>
                              <p className="whitespace-pre-wrap text-foreground">{text}</p>
                              <p className="text-muted-foreground">
                                {j?.by ? `${j.by} · ` : ''}{fmtWhen(j?.at)}
                                {d.stale && <span className="font-medium text-foreground"> · the difference has moved since — re-check</span>}
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="border-b px-2 py-1.5 text-muted-foreground">{d.direction}</td>
                        <td className="border-b px-2 py-1.5 text-right">
                          {d.hasTaxable ? <Amount v={d.diff.t} tol={w.tolerance} loud={d.open} /> : <span className="text-muted-foreground">—</span>}
                        </td>
                        {HEADS.map(([h]) => (
                          <td key={h} className="border-b px-2 py-1.5 text-right">
                            {d.hasTax ? <Amount v={d.diff[h]} tol={w.tolerance} loud={d.open} /> : <span className="text-muted-foreground">—</span>}
                          </td>
                        ))}
                        <td className="border-b px-2 py-1 text-right">
                          <JustifyControl lineKey={d.key} />
                        </td>
                        <td className="border-b px-1 py-0.5 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Go to ${stepMeta(d.step).label}`}
                            title={`Go to ${stepMeta(d.step).label}`}
                            onClick={() => go(d.step)}
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
};

export default DifferenceList;
