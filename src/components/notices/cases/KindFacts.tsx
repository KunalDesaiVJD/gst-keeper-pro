// The facts a notice's kind of service needs (the firm's request of 9 October
// 2026: a refund page had "irrelevant fields" and blanks). A refund shows its
// application and amounts; a registration matter the application and the step
// it has reached; a record-only item (LUT, voluntary payment, approval) what it
// is. Each value comes from the portal or from what the AI read in the case's
// documents, and says which.
import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/notices/ui/Panel';
import {
  fmtReturnPeriod, KIND_STEPS, REFUND_REASONS, type AmountRead, type CaseOverview, type Track,
} from '@/lib/noticeCases';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

interface Fact { label: string; value: string | null | undefined; sub?: string | null; mono?: boolean }

function FactGrid({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
      {facts.map((f) => (
        <div key={f.label} className="min-w-0 space-y-0.5">
          <dt className="text-[11px] font-medium text-muted-foreground">{f.label}</dt>
          <dd className={cn('break-words text-sm font-semibold', f.mono && 'break-all font-mono text-[13px]', !f.value && 'font-normal text-muted-foreground')}>{f.value || '—'}</dd>
          {f.sub && <dd className="break-words text-[11px] text-muted-foreground">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

const amt = (a: AmountRead | undefined): Fact['value'] => (a ? fmtInr(a.value) : null);
const fromAi = (a: AmountRead | undefined) => (a ? `AI, from ${a.label ?? 'a case document'}` : null);

/** The steps of the matter, each ticked when one of its forms is in the case. */
export const KindSteps: React.FC<{ track: Track; forms: string[]; hasApplication?: boolean }> = ({ track, forms, hasApplication }) => {
  const steps = KIND_STEPS[track];
  if (!steps) return null;
  const have = new Set(forms);
  if (hasApplication) have.add('__APPLICATION');
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Steps">
      {steps.map((s, i) => {
        const done = s.forms.some((f) => have.has(f));
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="h-px w-4 bg-border" aria-hidden />}
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', done ? 'border-success/50 bg-success/10 font-medium text-foreground' : 'text-muted-foreground')}>
              {done && <Check className="h-3 w-3 text-success" aria-hidden />}{s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

export const KindFacts: React.FC<{
  track: Track;
  overview: CaseOverview | undefined;
  loading: boolean;
  forms: string[];
  /** The notice on screen, when the card sits on a notice's page. */
  notice?: { form_label?: string | null; issue_date?: string | null; reference_number?: string | null; financial_year?: string | null; description?: string | null };
}> = ({ track, overview, loading, forms, notice }) => {
  const reading = overview?.reading;
  const allForms = [...new Set([...forms, ...(overview?.forms ?? [])])];
  const busy = (reading?.queued ?? 0) > 0;
  const status = busy
    ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading {reading?.queued} of the case's documents; the figures fill in as it goes.</span>
    : reading?.documents ? `Read from the portal and from ${reading.done} of the case's ${reading.documents} documents.` : 'Read from the portal.';

  if (track === 'refund') {
    const r = overview?.refund ?? {};
    const claimed = r.claimed ?? r.refund_claimed?.value;
    const facts: Fact[] = [
      { label: 'Refund application (ARN)', value: r.arn, mono: true, sub: r.filed_on ? `filed ${fmtDate(r.filed_on)}` : null },
      { label: 'Reason', value: r.reason ? REFUND_REASONS[r.reason] ?? r.reason : null },
      {
        label: 'Period',
        value: r.period_from ? `${fmtReturnPeriod(r.period_from)}${r.period_to && r.period_to !== r.period_from ? ` to ${fmtReturnPeriod(r.period_to)}` : ''}`
          : overview?.fields.period_from ? `${fmtDate(overview.fields.period_from.value)}${overview.fields.period_to ? ` to ${fmtDate(overview.fields.period_to.value)}` : ''}` : null,
        sub: !r.period_from && overview?.fields.period_from ? `${overview.fields.period_from.source === 'ai' ? 'AI, from' : 'From'} ${overview.fields.period_from.label ?? 'the case'}` : null,
      },
      { label: 'Status on the portal', value: r.status },
      { label: 'Claimed', value: claimed != null ? fmtInr(claimed) : null, sub: r.claimed != null ? 'as filed' : fromAi(r.refund_claimed) },
      { label: 'Sanctioned provisionally', value: amt(r.refund_provisional), sub: fromAi(r.refund_provisional) },
      { label: 'Sanctioned', value: amt(r.refund_sanctioned), sub: fromAi(r.refund_sanctioned) },
      { label: 'Rejected or inadmissible', value: amt(r.refund_rejected), sub: fromAi(r.refund_rejected) },
      { label: 'Net payable', value: amt(r.refund_net_payable), sub: fromAi(r.refund_net_payable) },
      { label: 'Paid', value: amt(r.refund_paid), sub: fromAi(r.refund_paid) },
    ];
    return (
      <SectionCard title="The refund" description={status}>
        <KindSteps track="refund" forms={allForms} hasApplication={!!r.arn} />
        <FactGrid facts={facts} />
      </SectionCard>
    );
  }

  if (track === 'registration') {
    const g = overview?.registration ?? {};
    const facts: Fact[] = [
      { label: 'Application', value: g.application_type ? g.application_type[0].toUpperCase() + g.application_type.slice(1) : null, sub: g.label ? `AI, from ${g.label}` : null },
      { label: 'Application ARN', value: g.application_arn, mono: true },
      { label: 'Applied on', value: g.application_date ? fmtDate(g.application_date) : null },
      { label: 'Reply due', value: overview?.fields.reply_due?.value ? fmtDate(overview.fields.reply_due.value) : null },
      { label: 'Officer', value: overview?.fields.officer?.value },
    ];
    return (
      <SectionCard title="The registration matter" description={status}>
        <KindSteps track="registration" forms={allForms} />
        <FactGrid facts={facts} />
      </SectionCard>
    );
  }

  // Record only: LUT, voluntary payments, approvals.
  const facts: Fact[] = [
    { label: 'What it is', value: notice?.form_label ?? null },
    { label: 'Dated', value: notice?.issue_date ? fmtDate(notice.issue_date) : null },
    { label: 'Reference', value: notice?.reference_number ?? null, mono: true },
    { label: 'Financial year', value: notice?.financial_year ?? overview?.fields.financial_year?.value ?? null },
  ];
  return (
    <SectionCard title="For the record" description={loading ? 'Loading…' : 'Nothing to do: kept so the client\'s history is complete.'}>
      <FactGrid facts={facts} />
    </SectionCard>
  );
};

export default KindFacts;
