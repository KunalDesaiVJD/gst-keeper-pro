// The warning before a person links two cases (the firm, 27 October 2026:
// "Though superadmin or any user try to override anything but should warn
// atleast for anything which is unusual for linking"). Every link a person
// makes goes through the law check (migration 20261027140000); when it finds
// anything, this dialog says what, in red for what GST law does not allow (two
// show cause proceedings in one case) and amber for what is unusual. The person
// can still link: against the law only with a reason of ten letters or more,
// which is kept with their name. "Ask the AI" asks for a second opinion
// (notice-link-ai, Sonnet at medium effort); it never links.
import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Scale, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/gstr9/badge';
import { cn } from '@/lib/utils';
import {
  AI_VERDICT, MIN_OVERRIDE_REASON, askLinkAi,
  type GuardedResult, type LinkCheck, type LinkOpinion, type LinkPair, type LinkProblem,
} from '@/lib/noticeCaseLinkLaw';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The problems of a check, as lines (used on suggestions and the review list too). */
export const LinkProblems: React.FC<{ problems: LinkProblem[]; compact?: boolean }> = ({ problems, compact }) => {
  if (!problems.length) return null;
  return (
    <ul className={cn('space-y-1', compact ? 'text-[11px]' : 'text-xs')}>
      {problems.map((p, i) => (
        <li key={`${p.code}-${i}`} className={cn('flex items-start gap-1.5 rounded-md border px-2 py-1',
          p.level === 'law' ? 'border-destructive/40 bg-destructive/5 text-destructive-strong' : 'border-warning/40 bg-warning/5')}>
          {p.level === 'law' ? <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />}
          <span><span className="font-semibold">{p.level === 'law' ? 'Against GST law. ' : 'Unusual. '}</span>{compact ? p.text.split('. ')[0] + '.' : p.text}</span>
        </li>
      ))}
    </ul>
  );
};

/** A short chip for a pair's check: nothing when clean. */
export const LinkCheckChip: React.FC<{ check: LinkCheck | undefined | null }> = ({ check }) => {
  if (!check || !check.problems.length) return null;
  const law = check.problems.filter((p) => p.level === 'law').length;
  return (
    <Badge variant={law ? 'destructive' : 'warning'} className="text-[10px]" title={check.problems.map((p) => p.text).join('\n\n')}>
      {law ? 'Against GST law' : `${check.problems.length} unusual`}
    </Badge>
  );
};

interface Pending {
  pair: LinkPair;
  check: LinkCheck | null;
  run: (confirm: string | null) => Promise<GuardedResult>;
  resolve: (linked: boolean) => void;
}

/**
 * attempt(pair, run): runs the link without a confirmation; when the check
 * finds anything, opens the warning and resolves once the person links anyway
 * (true) or cancels (false).
 */
export function useGuardedLink(by: string | null) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  const attempt = useCallback(async (pair: LinkPair, run: (confirm: string | null) => Promise<GuardedResult>): Promise<boolean> => {
    const r = await run(null);
    if (r.status === 'linked') return true;
    return new Promise<boolean>((resolve) => {
      const p = { pair, check: r.check, run, resolve };
      ref.current = p;
      setPending(p);
    });
  }, []);
  const close = useCallback((linked: boolean) => {
    ref.current?.resolve(linked);
    ref.current = null;
    setPending(null);
  }, []);
  const dialog = pending ? <LinkWarnDialog key={`${pending.pair.childKey}>${pending.pair.parentKey}`} pending={pending} by={by} onClose={close} /> : null;
  return { attempt, dialog };
}

const LinkWarnDialog: React.FC<{ pending: Pending; by: string | null; onClose: (linked: boolean) => void }> = ({ pending, by, onClose }) => {
  const check = pending.check;
  const law = !!check?.against_law;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState<{ loading: boolean; opinion: LinkOpinion | null; error: string | null }>({ loading: false, opinion: null, error: null });
  const short = law && reason.trim().length < MIN_OVERRIDE_REASON;

  const linkAnyway = async () => {
    setBusy(true);
    setErr(null);
    try {
      const text = reason.trim() || `Confirmed by ${by || 'a person'} after the warning`;
      const r = await pending.run(text);
      if (r.status === 'linked') onClose(true);
      else setErr(r.status === 'reason_needed' ? `Give a reason of at least ${MIN_OVERRIDE_REASON} letters to link against the law.` : 'The check changed meanwhile; read it again.');
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const ask = async () => {
    setAi({ loading: true, opinion: null, error: null });
    const r = await askLinkAi(pending.pair, by);
    setAi({ loading: false, opinion: r.opinion, error: r.error });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(false); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {law ? <Scale className="h-5 w-5 text-destructive" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />}
            {law ? 'GST law does not allow this link' : 'This link is unusual'}
          </DialogTitle>
          <DialogDescription>
            Linking <span className="font-mono">{pending.pair.childKey}</span> under <span className="font-mono">{pending.pair.parentKey}</span>
            {pending.pair.kind ? ` as ${pending.pair.kind}` : ''}. Read what the check found before you go on.
          </DialogDescription>
        </DialogHeader>

        <LinkProblems problems={check?.problems ?? []} />

        <div className="space-y-1.5 rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">Second opinion</span>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={ask} disabled={ai.loading}>
              {ai.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
              {ai.opinion ? 'Ask the AI again' : 'Ask the AI'}
            </Button>
            {ai.loading && <span className="text-[11px] text-muted-foreground">Reading both cases; this can take a minute.</span>}
          </div>
          {ai.error && <p className="text-[11px] text-destructive-strong">{ai.error}</p>}
          {ai.opinion && (
            <div className="space-y-1 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={AI_VERDICT[ai.opinion.verdict].tone} className="text-[10px]">{AI_VERDICT[ai.opinion.verdict].label}</Badge>
                <span className="text-[11px] text-muted-foreground">{ai.opinion.confidence}% sure{ai.opinion.kind !== 'none' ? ` · as ${ai.opinion.kind}` : ''}</span>
              </div>
              {ai.opinion.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{ai.opinion.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {ai.opinion.law.length > 0 && <p className="text-[11px] text-muted-foreground">Law: {ai.opinion.law.join('; ')}</p>}
              <p className="text-[11px] text-muted-foreground">Advice only: you decide.</p>
            </div>
          )}
        </div>

        <div className="space-y-1">
          <label htmlFor="link-reason" className="text-xs font-medium">
            {law ? 'Why link it anyway (required, kept with your name)' : 'Note (optional, kept with your name)'}
          </label>
          <Textarea id="link-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="text-xs"
            placeholder={law ? 'For example: the department merged both notices into one order, see order dated ...' : 'Why these belong together'} />
          {err && <p className="text-[11px] text-destructive-strong">{err}</p>}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Keep apart</Button>
          <Button variant={law ? 'destructive' : 'default'} onClick={linkAnyway} disabled={busy || short}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />} Link anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
