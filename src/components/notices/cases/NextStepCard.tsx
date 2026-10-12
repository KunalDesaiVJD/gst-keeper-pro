// What to do now on a case: the notice assistant's advice (one line, the steps,
// the date that governs, whether the case can simply be closed), or the usual
// step for its form until the advice is in. "Ask again" asks the assistant now.
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, RefreshCw, Sparkles, User, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { askCaseAdvice, useCaseAdvice, usualStep } from '@/lib/noticeAdvice';
import type { Track } from '@/lib/noticeCases';
import { fmtDate } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

export const NextStepCard: React.FC<{
  clientId: string; caseKey: string; track: Track; form: string | null; overdue: boolean; open: boolean;
}> = ({ clientId, caseKey, track, form, overdue, open }) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useCaseAdvice(clientId, caseKey);
  const [asking, setAsking] = useState(false);
  const row = q.data;
  const a = row?.advice ?? null;
  const busy = asking || row?.status === 'running' || row?.status === 'queued';

  const ask = async () => {
    setAsking(true);
    try {
      const r = await askCaseAdvice(clientId, caseKey, user?.firstName ?? null);
      if (r.error) toast.error(r.error);
      await qc.invalidateQueries({ queryKey: ['notice-case-advice', clientId, caseKey] });
      qc.invalidateQueries({ queryKey: ['notice-case-advice-map'] });
    } finally {
      setAsking(false);
    }
  };

  if (q.isLoading) return <Skeleton className="h-28 w-full" />;
  const usual = usualStep(form, track, overdue);
  const tone = a?.can_close ? 'success' : overdue ? 'destructive' : 'primary';

  return (
    <section aria-label="What to do now"
      className={cn('overflow-hidden rounded-xl border bg-card',
        tone === 'success' ? 'border-success/40' : tone === 'destructive' ? 'border-destructive/40' : 'border-primary/30')}>
      <div className={cn('flex flex-wrap items-start gap-3 p-4',
        tone === 'success' ? 'bg-success/5' : tone === 'destructive' ? 'bg-destructive/5' : 'bg-primary/5')}>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          tone === 'success' ? 'bg-success/15 text-success' : tone === 'destructive' ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary')}>
          {a?.can_close ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            What to do now{a ? ' · AI' : ` · usual step${form ? ` for ${form}` : ''}`}
          </div>
          <h2 className="mt-0.5 text-base font-semibold leading-snug">{a ? a.headline : open ? usual.headline : 'Closed: nothing to do'}</h2>
          <p className="mt-1 text-sm text-foreground/80">{a ? a.situation : open ? usual.detail : null}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> AI is reading the case</span>}
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={ask} disabled={busy}>
            {a ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
            {a ? 'Ask again' : 'Ask AI'}
          </Button>
        </div>
      </div>

      {a && (a.steps.length > 0 || a.deadline || a.overdue_note || a.cautions.length > 0 || a.can_close) && (
        <div className="grid gap-4 border-t p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {a.steps.length > 0 && (
            <ol className="space-y-2.5">
              {a.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{s.action}</span>
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {s.who === 'client' ? <User className="h-2.5 w-2.5" aria-hidden /> : <Building2 className="h-2.5 w-2.5" aria-hidden />}
                        {s.who === 'client' ? 'Client' : 'Firm'}
                      </span>
                      {s.by && <span className="text-[11px] font-medium text-warning">by {fmtDate(s.by)}</span>}
                    </div>
                    {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="space-y-2.5">
            {a.deadline && (
              <div className="flex gap-2 rounded-lg border p-2.5">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <div><div className="text-sm font-semibold">{fmtDate(a.deadline)}</div>{a.deadline_basis && <p className="text-xs text-muted-foreground">{a.deadline_basis}</p>}</div>
              </div>
            )}
            {a.can_close && (
              <div className="flex gap-2 rounded-lg border border-success/40 bg-success/5 p-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <div><div className="text-sm font-semibold">Can be closed</div>{a.close_reason && <p className="text-xs text-muted-foreground">{a.close_reason}</p>}</div>
              </div>
            )}
            {a.overdue_note && overdue && (
              <div className="flex gap-2 rounded-lg border border-destructive/30 p-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                <p className="text-xs text-foreground/80"><span className="font-semibold">Why it shows overdue: </span>{a.overdue_note}</p>
              </div>
            )}
            {a.cautions.length > 0 && (
              <div className="rounded-lg bg-muted/50 p-2.5">
                <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Check</div>
                <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/80">{a.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
      {a && <p className="border-t px-4 py-1.5 text-[10px] text-muted-foreground">AI guidance from the case's documents{row?.finished_at ? `, ${fmtDate(row.finished_at.slice(0, 10))}` : ''}. A partner decides; nothing is filed or closed by it.</p>}
    </section>
  );
};

export default NextStepCard;
