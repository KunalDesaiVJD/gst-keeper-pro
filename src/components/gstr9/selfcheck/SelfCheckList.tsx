import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ClipboardList, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { StepKey } from '@/lib/gstr9/engine';
import { ANSWER_LABEL, itemsForStep, SELF_CHECK_NOTE_MIN, type SelfCheckAuto, type SelfCheckItem } from '@/lib/gstr9/selfCheck';
import type { SelfCheckAnswer } from '@/lib/gstr9/types';
import { displayName } from '@/lib/gstr9/signoffFlow';
import { SectionCard } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { fmtWhen, stepMeta, useGoToStep } from '../overview/steps';
import { useSelfCheck } from './useSelfCheck';

const ANSWERS: SelfCheckAnswer[] = ['yes', 'no', 'na'];

/** One question: Yes / No / Not applicable, and the remark a No needs. */
export const SelfCheckQuestionRow: React.FC<{ item: SelfCheckItem; showStep?: boolean }> = ({ item, showStep }) => {
  const { readOnly, isStaff } = useWorkspace();
  const { setAnswer, setNote } = useSelfCheck();
  const go = useGoToStep();
  const { q, entry, hint, problem } = item;
  const editable = isStaff && !readOnly;
  const id = `selfcheck-${q.key}`;
  const noteMissing = entry?.answer === 'no' && problem;
  return (
    <li className={cn('rounded-md border px-3 py-2', problem ? 'border-destructive/40 bg-destructive/5' : 'bg-card')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[14rem] flex-1 space-y-0.5">
          <p id={`${id}-q`} className="text-sm leading-snug">
            {q.question}
            <span className="ml-1 text-destructive-strong" aria-hidden>*</span>
          </p>
          {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
          {showStep && (
            <button type="button" className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline" onClick={() => go(q.step)}>
              Asked on {stepMeta(q.step).n}. {stepMeta(q.step).label} <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          aria-labelledby={`${id}-q`}
          value={entry?.answer ?? ''}
          disabled={!editable}
          onValueChange={(v) => { if (v) setAnswer(q.key, v as SelfCheckAnswer); }}
          className="shrink-0 justify-end"
        >
          {ANSWERS.filter((a) => a !== 'na' || q.allowNa).map((a) => (
            <ToggleGroupItem
              key={a}
              value={a}
              className={cn(
                'h-7 px-2.5 text-xs',
                a === 'yes' && 'data-[state=on]:border-success/50 data-[state=on]:bg-success/10 data-[state=on]:text-success-strong',
                a === 'no' && 'data-[state=on]:border-destructive/50 data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive-strong',
              )}
            >
              {ANSWER_LABEL[a]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {entry?.answer === 'no' && (
        <div className="mt-1.5 space-y-1">
          <Textarea
            id={`${id}-note`}
            value={entry.note ?? ''}
            rows={2}
            disabled={!editable}
            aria-label={`Remark: ${q.short}`}
            aria-invalid={noteMissing ? true : undefined}
            className={cn('min-h-[3rem] text-sm', noteMissing && 'border-destructive/60')}
            placeholder="Why not, and what is being done (e.g. DRC-03 to be paid by 30 Dec with interest)"
            onChange={(e) => setNote(q.key, e.target.value)}
          />
          {noteMissing && <p className="text-[11px] text-destructive-strong">A No needs a remark of at least {SELF_CHECK_NOTE_MIN} characters.</p>}
        </div>
      )}
      {entry && !problem && (
        <p className="mt-1 text-[10px] text-muted-foreground">Answered by {displayName(entry.by)} · {fmtWhen(entry.at)}</p>
      )}
      {problem && !noteMissing && <p className="mt-1 text-[11px] text-destructive-strong">{problem}</p>}
    </li>
  );
};

/** A check the app makes itself, with a link to where it is fixed. */
export const SelfCheckAutoRow: React.FC<{ a: SelfCheckAuto }> = ({ a }) => {
  const go = useGoToStep();
  return (
    <li className="flex items-start gap-2 text-sm">
      {a.ok
        ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" aria-label="Passed" />
        : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" aria-label="Not passed" />}
      <span className="min-w-0 flex-1 leading-snug">
        {a.label}. <span className={cn('text-xs', a.ok ? 'text-muted-foreground' : 'text-destructive-strong')}>{a.detail}</span>
        {!a.ok && (
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
            onClick={() => go(a.step, a.step === 'review' ? { reviewtab: 'differences' } : a.key === 'json' ? { gstr9ctab: 'json' } : {})}
          >
            Fix <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </span>
    </li>
  );
};

/**
 * Under a step: the self-validation questions that step asks. Folded once all
 * are answered; shown to staff only.
 */
export const StepSelfCheck: React.FC<{ step: StepKey }> = ({ step }) => {
  const { isStaff } = useWorkspace();
  const { status } = useSelfCheck();
  const items = itemsForStep(status, step);
  const pending = items.filter((i) => i.problem).length;
  const [open, setOpen] = useState<boolean | null>(null);
  if (!isStaff || !items.length) return null;
  const shown = open ?? pending > 0;
  return (
    <SectionCard
      title={(
        <span className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden />
          Self-validation on this step
          <Badge variant={pending ? 'destructive' : 'success'} className="h-4 px-1.5 text-[10px] leading-none">
            {pending ? `${pending} to answer` : 'Answered'}
          </Badge>
        </span>
      )}
      description="Answer each before the working is marked prepared. A No needs a remark; it does not stop the working, but the verifier sees it."
      actions={(
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-expanded={shown} onClick={() => setOpen(!shown)}>
          {shown ? 'Hide' : 'Show'} <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', shown && 'rotate-180')} />
        </Button>
      )}
    >
      {shown && <ul className="space-y-1.5">{items.map((i) => <SelfCheckQuestionRow key={i.q.key} item={i} />)}</ul>}
    </SectionCard>
  );
};

/**
 * Every question and the app's own checks in one list (Review & lock → Sign-off,
 * and the Mark prepared dialog with `only` = the keys still pending when it opened).
 */
export const SelfCheckPanel: React.FC<{ only?: string[]; showAuto?: boolean }> = ({ only, showAuto = true }) => {
  const { status } = useSelfCheck();
  const items = only ? status.items.filter((i) => only.includes(i.q.key)) : status.items;
  const failing = status.auto.filter((a) => !a.ok);
  return (
    <div className="space-y-2">
      {showAuto && (
        <ul className="space-y-1">
          {(only ? failing : status.auto).map((a) => <SelfCheckAutoRow key={a.key} a={a} />)}
        </ul>
      )}
      {items.length > 0 && <ul className="space-y-1.5">{items.map((i) => <SelfCheckQuestionRow key={i.q.key} item={i} showStep />)}</ul>}
    </div>
  );
};

/** The card on Review & lock → Sign-off. */
export const SelfCheckCard: React.FC = () => {
  const { isStaff, signoffState } = useWorkspace();
  const { status } = useSelfCheck();
  if (!isStaff) return null;
  const submitted = signoffState.prepared ? 'Answered by the preparer before marking it prepared; the verifier checks the answers and remarks.' : 'The preparer answers every question, and the app’s checks must pass, before the working can be marked prepared.';
  return (
    <SectionCard
      title={(
        <span className="flex items-center gap-2">
          Preparer&rsquo;s self-validation
          <Badge variant={status.ok ? 'success' : 'destructive'} className="h-4 gap-1 px-1.5 text-[10px] leading-none">
            {status.ok ? <CheckCircle2 className="h-2.5 w-2.5" aria-hidden /> : <AlertTriangle className="h-2.5 w-2.5" aria-hidden />}
            {status.ok ? 'Complete' : `${status.pending + status.auto.filter((a) => !a.ok).length} to clear`}
          </Badge>
        </span>
      )}
      description={submitted}
    >
      <SelfCheckPanel />
    </SectionCard>
  );
};
