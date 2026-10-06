// The checks every piece of reply wording goes through before Save (the firm's
// rule, 6 October 2026: formal legal English with no hyphen or dash of any
// kind; contract §B, §C): each dash shown where it sits with what "Replace
// dashes" makes of it (the database's own reply_dehyphen rules), placeholders
// the renderer would not fill, the placeholders panel, and wording with its
// {{placeholders}} and [fill ins] marked. The words on these screens are the
// firm's reply area, so they hold no dashes either.
import React, { useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Plus, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import {
  REPLY_PLACEHOLDERS, placeholderMeaning, splitPlaceholders, type DashHit, type PlaceholderProblem,
} from '@/lib/replyFactory';
import { cn } from '@/lib/utils';

const MAX_SHOWN = 8;

/** A soft hyphen is invisible, so it is shown as the old printer's mark for one. */
const shownChar = (c: string) => (c === '­' ? '¬' : c);

/** "[ARN of FORM GST DRC 03]": a fill in the person completes in the draft. */
const FillIns: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\[[^\]\n]{1,160}\])/g).map((p, i) => (/^\[[^\]\n]+\]$/.test(p)
      ? <mark key={i} className="rounded bg-warning/25 px-0.5 text-foreground">{p}</mark>
      : <React.Fragment key={i}>{p}</React.Fragment>))}
  </>
);

/** Wording with line breaks kept, its {{placeholders}} marked (red when the app would not fill one) and, for a rendered reply, its [fill ins]. */
export const MarkedText: React.FC<{ text: string; fillIns?: boolean; className?: string }> = ({ text, fillIns, className }) => (
  <div className={cn('whitespace-pre-wrap break-words text-[13px] leading-relaxed', className)}>
    {splitPlaceholders(text).map((p, i) => (p.key === null
      ? (fillIns ? <FillIns key={i} text={p.text} /> : <React.Fragment key={i}>{p.text}</React.Fragment>)
      : (
        <mark key={i} title={placeholderMeaning(p.key) ?? 'Not a placeholder the app fills'}
          className={cn('rounded px-0.5 font-mono text-[0.92em]', p.known ? 'bg-primary/10 text-primary' : 'bg-destructive/15 text-destructive-strong')}>
          {p.text}
        </mark>
      )))}
  </div>
);

/** Every hyphen or dash in the fields, where it sits, and Replace dashes. */
export const DashCheck: React.FC<{ hits: DashHit[]; onReplace?: () => void; disabled?: boolean }> = ({ hits, onReplace, disabled }) => {
  const [all, setAll] = useState(false);
  if (hits.length === 0) return null;
  const shown = all ? hits : hits.slice(0, MAX_SHOWN);
  return (
    <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          {hits.length === 1 ? 'One hyphen or dash' : `${hits.length} hyphens or dashes`}: replies may not hold any.
        </p>
        {onReplace && (
          <Button type="button" size="sm" variant="outline" className={cn(WS_BTN, 'bg-card')} onClick={onReplace} disabled={disabled}>
            <Wand2 className="h-3.5 w-3.5" aria-hidden /> Replace dashes
          </Button>
        )}
      </div>
      <ul className="space-y-1">
        {shown.map((h, i) => (
          <li key={i} className="break-words">
            <span className="font-medium">{h.field}, line {h.line}</span>, {h.name}:{' '}
            <span className="rounded bg-card px-1 font-mono text-[11px]">
              {h.before}<mark className="rounded bg-destructive/15 px-0.5 font-bold text-destructive-strong">{shownChar(h.char)}</mark>{h.after}
            </span>
            {' '}becomes <span className="rounded bg-card px-1 font-mono text-[11px]">{h.becomes || '(nothing)'}</span>
          </li>
        ))}
      </ul>
      {hits.length > MAX_SHOWN && (
        <button type="button" className="text-[11px] font-medium text-primary underline underline-offset-2" onClick={() => setAll((a) => !a)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${hits.length}`}
        </button>
      )}
      {onReplace && (
        <p className="text-[11px] text-foreground/80">
          Replace dashes uses the database's own rules: between months a dash reads "to" (Apr to Sep), between figures it becomes a slash
          (2023/24), with a space on each side it becomes a comma, "/" with a dash after an amount goes, and any other dash becomes a space. Read
          the wording again afterwards.
        </p>
      )}
    </div>
  );
};

/** Placeholders the renderer would not fill as meant, each with its fix when there is an obvious one. */
export const PlaceholderCheck: React.FC<{ problems: PlaceholderProblem[]; onFix?: (p: PlaceholderProblem) => void }> = ({ problems, onFix }) => {
  if (problems.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        {problems.length === 1 ? 'One placeholder is' : `${problems.length} placeholders are`} not filled as meant.
      </p>
      <ul className="space-y-1">
        {problems.slice(0, MAX_SHOWN * 2).map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 break-words">
            <span>
              <span className="font-medium">{p.field}, line {p.line}</span>:{' '}
              <span className="rounded bg-card px-1 font-mono text-[11px]">{p.token}</span> {p.reason}
            </span>
            {onFix && p.fix && (
              <Button type="button" size="sm" variant="outline" className="h-7 bg-card px-2 text-[11px]" onClick={() => onFix(p)}>
                Use <span className="font-mono">{p.fix}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The all clear under the fields. */
export const ChecksPassed: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="flex items-center gap-1.5 text-xs text-success-strong">
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> {children}
  </p>
);

/** The placeholders a template may use and what each prints; Insert puts one in the wording at the cursor. */
export const PlaceholdersPanel: React.FC<{ onInsert?: (key: string) => void; defaultOpen?: boolean }> = ({ onInsert, defaultOpen }) => {
  const uid = useId();
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-md border bg-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`${uid}-list`}
        className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-left text-xs font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
        Placeholders ({REPLY_PLACEHOLDERS.length})
        <span className="font-normal text-muted-foreground">what each one prints{onInsert ? '; Insert puts it at the cursor' : ''}</span>
      </button>
      {open && (
        <ul id={`${uid}-list`} className="max-h-72 divide-y overflow-y-auto border-t">
          {REPLY_PLACEHOLDERS.map((p) => (
            <li key={p.key} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <code className="font-mono text-[11px] font-semibold text-primary">{`{{${p.key}}}`}</code>
                <p className="text-foreground/80">{p.meaning}</p>
              </div>
              {onInsert && (
                <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => onInsert(p.key)}>
                  <Plus className="h-3 w-3" aria-hidden /> Insert<span className="sr-only"> {`{{${p.key}}}`}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
