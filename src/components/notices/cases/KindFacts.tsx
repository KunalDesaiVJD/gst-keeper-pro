// The facts a notice's kind of service needs (the firm's request of 9 October
// 2026: a refund page had "irrelevant fields" and blanks). A refund shows its
// application and amounts; a registration matter the application and the step
// it has reached; a record-only item (LUT, voluntary payment, approval) what it
// is. Each value comes from the portal or from what the AI read in the case's
// documents, and says which.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Loader2, X } from 'lucide-react';
import { SectionCard } from '@/components/notices/ui/Panel';
import {
  fmtReturnPeriod, KIND_STEPS, REFUND_REASONS, type AmountRead, type CaseOverview, type Track,
} from '@/lib/noticeCases';
import { fmtDate, fmtInr } from '@/lib/noticeFormat';
import type { RefundRow } from '@/components/notices/reports/ledgerData';
import { outcomeOf, refundSteps } from '@/components/notices/reports/refundModel';
import { TonePill } from '@/components/notices/reports/RefundBits';
import { cn } from '@/lib/utils';

interface Fact { label: string; value: string | null | undefined; sub?: string | null; mono?: boolean }

/** The facts in a grid; in a page's side rail (rail), one column and only the facts we hold. */
function FactGrid({ facts, rail }: { facts: Fact[]; rail?: boolean }) {
  const shown = rail ? facts.filter((f) => !!f.value) : facts;
  if (rail && !shown.length) return <p className="text-xs text-muted-foreground">Nothing read yet.</p>;
  return (
    <dl className={rail ? 'grid grid-cols-1 gap-y-2.5' : 'grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4'}>
      {shown.map((f) => (
        <div key={f.label} className="min-w-0 space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
          <dd className={cn('break-words text-[15px] font-semibold', f.mono && 'break-all font-mono text-[13px]', !f.value && 'font-normal text-muted-foreground')}>{f.value || '—'}</dd>
          {f.sub && <dd className="break-words text-xs text-muted-foreground">{f.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

const RailHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="border-b pb-1 pt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{children}</h3>
);

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
  /** In a page's side rail: one column, empty facts left out. */
  rail?: boolean;
  /** A refund: its row of the Refunds ledger, so the figures are the refund page's own. */
  row?: RefundRow | null;
  /** A refund: its own page. */
  refundLink?: string | null;
}> = ({ track, overview, loading, forms, notice, rail, row, refundLink }) => {
  const reading = overview?.reading;
  const allForms = [...new Set([...forms, ...(overview?.forms ?? [])])];
  const busy = (reading?.queued ?? 0) > 0;
  const status = busy
    ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> The AI is reading {reading?.queued} of the case's documents; the figures fill in as it goes.</span>
    : reading?.documents ? `Read from the portal and from ${reading.done} of the case's ${reading.documents} documents.` : 'Read from the portal.';

  if (track === 'refund') {
    const r = overview?.refund ?? {};
    const claimed = row?.claimed ?? r.claimed ?? r.refund_claimed?.value;
    // The amounts as the refund's own page gives them (orders read by their
    // figures), so the two pages never disagree; the case's AI read fills a
    // figure only where the refund has none. A notice's "rejected" (RFD-08) is
    // only the amount proposed for rejection, and is said so (27 Oct 2026).
    const proposed = r.refund_rejected && /rfd-?0?8|show cause|notice/i.test(r.refund_rejected.label ?? '') ? r.refund_rejected : undefined;
    const sanctioned = row ? (row.sanctioned ? { value: row.sanctioned, sub: row.fact.sanctioned_amount !== null ? 'from the portal' : row.read?.sanctioned ? `AI, from ${row.read.sanctioned.from}` : null } : null)
      : r.refund_sanctioned ? { value: r.refund_sanctioned.value, sub: fromAi(r.refund_sanctioned) } : null;
    const rejected = row ? (row.rejected ? { value: row.rejected, sub: row.read?.rejected ? `AI, from ${row.read.rejected.from}` : 'from the order, or claimed less sanctioned' } : null)
      : r.refund_rejected && !proposed ? { value: r.refund_rejected.value, sub: fromAi(r.refund_rejected) } : null;
    const paid = row?.read?.paid ? { value: row.read.paid.value, sub: `AI, from ${row.read.paid.from}` } : r.refund_paid ? { value: r.refund_paid.value, sub: fromAi(r.refund_paid) } : null;
    const provisional = row?.read?.provisional ? { value: row.read.provisional.value, sub: `AI, from ${row.read.provisional.from}` } : r.refund_provisional ? { value: r.refund_provisional.value, sub: fromAi(r.refund_provisional) } : null;
    const application: Fact[] = [
      { label: 'Refund application (ARN)', value: r.arn ?? row?.fact.arn, mono: true, sub: r.filed_on ? `filed ${fmtDate(r.filed_on)}` : row?.fact.filed_date ? `filed ${fmtDate(row.fact.filed_date)}` : null },
      { label: 'Reason', value: r.reason ? REFUND_REASONS[r.reason] ?? r.reason : null },
      {
        label: 'Period',
        value: r.period_from ? `${fmtReturnPeriod(r.period_from)}${r.period_to && r.period_to !== r.period_from ? ` to ${fmtReturnPeriod(r.period_to)}` : ''}`
          : overview?.fields.period_from ? `${fmtDate(overview.fields.period_from.value)}${overview.fields.period_to ? ` to ${fmtDate(overview.fields.period_to.value)}` : ''}` : null,
        sub: !r.period_from && overview?.fields.period_from ? `${overview.fields.period_from.source === 'ai' ? 'AI, from' : 'From'} ${overview.fields.period_from.label ?? 'the case'}` : null,
      },
      { label: 'Status on the portal', value: r.status ?? row?.fact.status },
    ];
    const money: { label: string; v: { value: number; sub: string | null } | null; tone?: 'good' | 'bad' }[] = [
      { label: 'Claimed', v: claimed != null ? { value: claimed, sub: row?.fact.claimed_amount != null || r.claimed != null ? 'as filed' : fromAi(r.refund_claimed) } : null },
      { label: 'Sanctioned provisionally', v: provisional },
      { label: 'Sanctioned', v: sanctioned, tone: 'good' },
      { label: 'Rejected', v: rejected, tone: 'bad' },
      { label: 'Proposed for rejection (notice)', v: proposed ? { value: proposed.value, sub: `${fromAi(proposed)}; a proposal, not the order` } : null },
      { label: 'Net payable', v: r.refund_net_payable ? { value: r.refund_net_payable.value, sub: fromAi(r.refund_net_payable) } : null },
      { label: 'Paid', v: paid, tone: 'good' },
    ];
    const shownMoney = rail ? money.filter((m) => m.v) : money;
    const steps = row ? refundSteps(row) : null;
    return (
      <SectionCard title="The refund"
        actions={refundLink && <Link to={refundLink} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Refund page <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>}>
        {row && <div className="flex flex-wrap gap-1.5"><TonePill tone={outcomeOf(row)} className="px-2.5 py-1 text-xs" /></div>}
        <RailHeading>Steps</RailHeading>
        {steps ? (
          <ol className="space-y-1.5" aria-label="Steps">
            {steps.map((st) => (
              <li key={st.key} className="flex items-center gap-2.5 text-sm">
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                  !st.done ? 'border-muted-foreground/30' : st.bad ? 'border-destructive bg-destructive text-destructive-foreground' : 'border-success bg-success text-success-foreground')}>
                  {st.done && (st.bad ? <X className="h-3 w-3" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />)}
                </span>
                <span className={cn('min-w-0 flex-1', !st.done && 'text-muted-foreground')}>{st.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{st.done ? (st.date ? fmtDate(st.date) : 'date not captured') : 'to come'}</span>
              </li>
            ))}
          </ol>
        ) : <KindSteps track="refund" forms={allForms} hasApplication={!!r.arn} />}
        <RailHeading>Application</RailHeading>
        <FactGrid facts={application} rail={rail} />
        <RailHeading>Amounts</RailHeading>
        {shownMoney.length === 0 ? <p className="text-sm text-muted-foreground">Nothing read yet.</p> : (
          <dl className={rail ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4'}>
            {shownMoney.map((m) => (
              <div key={m.label} className={cn('min-w-0 rounded-lg border border-l-4 bg-background px-3 py-2',
                !m.v ? 'border-l-border' : m.tone === 'good' ? 'border-l-success' : m.tone === 'bad' ? 'border-l-destructive' : 'border-l-border')}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.label}</dt>
                <dd className={cn('text-xl font-bold tabular-nums leading-tight', !m.v && 'font-normal text-muted-foreground',
                  m.v && m.tone === 'good' && 'text-success-strong', m.v && m.tone === 'bad' && 'text-destructive-strong')}>{m.v ? fmtInr(m.v.value) : '—'}</dd>
                {m.v?.sub && <dd className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">{m.v.sub}</dd>}
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">{status}</p>
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
        <FactGrid facts={facts} rail={rail} />
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
      <FactGrid facts={facts} rail={rail} />
    </SectionCard>
  );
};

export default KindFacts;
