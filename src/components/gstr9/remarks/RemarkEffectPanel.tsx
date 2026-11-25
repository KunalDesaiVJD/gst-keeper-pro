import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Sparkles, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DiffLine } from '@/lib/gstr9/engine';
import {
  EFFECT_KINDS, KIND_META, amountText, carriedFor, carriedReason, cleanAmount, effectOutOfDate,
  type EffectDraft, type RemarkEffect,
} from '@/lib/gstr9/remarkEffects';
import type { ValTax } from '@/lib/gstr9/types';
import { useWorkspace } from '../WorkspaceContext';
import { useCarriedEffects, useRemarkEffects } from './useRemarkEffects';

const HEADS: Array<[keyof ValTax, string]> = [['t', 'Value'], ['i', 'IGST'], ['c', 'CGST'], ['x', 'Cess']];

const draftOf = (e: RemarkEffect): EffectDraft => ({
  kind: e.kind, amount: e.amount, summary: e.summary, thisFy: e.thisFy, nextFy: e.nextFy, confidence: e.confidence, ...(e.question ? { question: e.question } : {}),
});

/** A short chip for the effect of a line's remark (Differences list). */
export const EffectChip: React.FC<{ effect: RemarkEffect | undefined; text: string | undefined }> = ({ effect, text }) => {
  if (!effect || effect.status === 'dismissed') return null;
  const meta = KIND_META[effect.kind];
  const stale = effectOutOfDate(text, effect);
  const applied = effect.status === 'applied';
  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-1 text-[11px]">
      <Badge variant={applied ? 'info' : 'outline'} className="h-4 gap-1 px-1.5 text-[10px] font-medium">
        <Sparkles className="h-2.5 w-2.5" />
        {applied ? (effect.wrote ? `Applied: ${meta.short}` : `Recorded: ${meta.short}`) : `Suggested: ${meta.label}`}
      </Badge>
      {meta.target && <span className="tabular-nums text-muted-foreground">{amountText(effect.amount, meta.withTaxable)}</span>}
      {stale && <span className="font-medium text-foreground">· remark changed, read again</span>}
    </span>
  );
};

/**
 * Inside a line's reason pop-over: what the remark means for GSTR-9, read by
 * the GST Assistant (or the rules), with Apply / Already in the table /
 * Dismiss, and Undo once applied. In the FY after, a ready reason from the
 * previous FY's carried effects.
 */
export const RemarkEffectPanel: React.FC<{ line: DiffLine; draftText: string; onUseReason: (text: string) => void }> = ({ line, draftText, onUseReason }) => {
  const { readOnly, financialYear } = useWorkspace();
  const { read, apply, undo, dismiss, reading } = useRemarkEffects();
  const { carried, prevFy } = useCarriedEffects();
  const j = line.justification;
  const e = j?.effect;
  const [edit, setEdit] = useState<EffectDraft | null>(e ? draftOf(e) : null);
  useEffect(() => { setEdit(e ? draftOf(e) : null); }, [e]);
  const fromPrev = useMemo(() => carriedFor(line.key, carried), [line.key, carried]);
  const saved = j?.text?.trim() ?? '';
  const busy = reading === line.key;
  const stale = effectOutOfDate(saved, e);

  const prevBlock = fromPrev.length > 0 && (
    <div className="rounded-md border border-info/40 bg-info/5 p-2 text-[11px]">
      <div className="font-semibold">Carried from FY {prevFy}</div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
        {fromPrev.map((c) => (
          <li key={c.lineKey}>{KIND_META[c.kind].short} of FY {prevFy}: {amountText(c.amount, KIND_META[c.kind].withTaxable)}. {c.effect}.</li>
        ))}
      </ul>
      {!readOnly && (
        <Button size="sm" variant="outline" className="mt-1 h-6 text-[11px]" onClick={() => onUseReason(carriedReason(fromPrev, prevFy))}>
          Use as reason
        </Button>
      )}
    </div>
  );

  if (!saved) return prevBlock || null;

  if (!e || e.status === 'dismissed') {
    return (
      <div className="space-y-2">
        {prevBlock}
        {!readOnly && (
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{e ? 'Effect dismissed.' : 'The remark has not been read yet.'}</span>
            <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={busy || draftText.trim() !== saved} onClick={() => void read(line, saved)}>
              {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              Read the remark
            </Button>
          </div>
        )}
      </div>
    );
  }

  const meta = KIND_META[(edit ?? e).kind];
  const applied = e.status === 'applied';
  const cur = edit ?? draftOf(e);
  const setAmt = (h: keyof ValTax, v: string) => {
    const n = Number(v.replace(/,/g, ''));
    setEdit({ ...cur, amount: cleanAmount({ ...cur.amount, [h]: Number.isFinite(n) ? n : 0, ...(h === 'c' ? { s: n } : {}) }, meta.withTaxable) });
  };

  return (
    <div className="space-y-2">
      {prevBlock}
      <div className={cn('space-y-1.5 rounded-md border p-2 text-[11px]', applied ? 'border-info/50 bg-info/5' : 'bg-muted/40')}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Sparkles className="h-3 w-3" />
            Effect on GSTR-9 of FY {financialYear}
          </span>
          <span className="text-muted-foreground">
            {busy ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />GST Assistant reading…</span>
              : e.source === 'ai' ? `GST Assistant · ${e.confidence}` : `Rules · ${e.confidence}`}
          </span>
        </div>
        {stale && <p className="font-medium text-foreground">The remark changed since this was read.{!applied && ' Read it again.'}</p>}

        {applied || readOnly ? (
          <p className="font-medium">{meta.label}{meta.target ? `: ${amountText(e.amount, meta.withTaxable)}` : ''}</p>
        ) : (
          <Select value={cur.kind} onValueChange={(k) => setEdit({ ...cur, kind: k as EffectDraft['kind'], thisFy: KIND_META[k as EffectDraft['kind']].thisFy, nextFy: KIND_META[k as EffectDraft['kind']].nextFy })}>
            <SelectTrigger className="h-7 text-xs" aria-label="Effect"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EFFECT_KINDS.map((k) => <SelectItem key={k} value={k} className="text-xs">{KIND_META[k].label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {!applied && !readOnly && meta.target && (
          <div className="grid grid-cols-4 gap-1">
            {HEADS.filter(([h]) => h !== 't' || meta.withTaxable).map(([h, label]) => (
              <label key={h} className="space-y-0.5">
                <span className="text-muted-foreground">{label}</span>
                <Input className="h-6 px-1 text-right text-[11px] tabular-nums" inputMode="decimal" value={String(cur.amount[h] || '')} onChange={(ev) => setAmt(h, ev.target.value)} aria-label={`${label} of the effect`} />
              </label>
            ))}
          </div>
        )}
        <p className="text-foreground">{e.summary}</p>
        <p><span className="text-muted-foreground">This FY: </span>{(applied ? e : cur).thisFy || meta.thisFy}</p>
        {meta.nextFy && <p><span className="text-muted-foreground">Next FY: </span>{(applied ? e : cur).nextFy || meta.nextFy}</p>}
        {e.question && !applied && <p className="italic text-muted-foreground">Unclear: {e.question}</p>}
        {applied && (
          <p className="text-muted-foreground">
            {e.wrote ? `Added to ${meta.short}` : meta.target ? `Recorded as already in ${meta.short}` : 'Recorded'} by {e.decidedBy ?? 'someone'}
            {e.decidedAt ? ` on ${new Date(e.decidedAt).toLocaleDateString('en-IN')}` : ''}.
          </p>
        )}

        {!readOnly && (
          <div className="flex flex-wrap justify-end gap-1.5 pt-0.5">
            {applied ? (
              <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => undo(line)}>
                <Undo2 className="mr-1 h-3 w-3" />Undo
              </Button>
            ) : (
              <>
                {stale && (
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={busy || draftText.trim() !== saved} onClick={() => void read(line, saved)}>Read again</Button>
                )}
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => dismiss(line)}><X className="mr-1 h-3 w-3" />Dismiss</Button>
                {meta.target ? (
                  <>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" disabled={busy} onClick={() => apply(line, cur, 'record')}>Already in {meta.short}</Button>
                    <Button size="sm" className="h-6 text-[11px]" disabled={busy || stale} onClick={() => apply(line, cur, 'write')}><Check className="mr-1 h-3 w-3" />Add to {meta.short}</Button>
                  </>
                ) : (
                  <Button size="sm" className="h-6 text-[11px]" disabled={busy || stale} onClick={() => apply(line, cur, 'record')}><Check className="mr-1 h-3 w-3" />Accept</Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
