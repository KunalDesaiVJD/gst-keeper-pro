// "What the notice says" on the notice page (roadmap Phase 4 "Document
// intelligence"; audit R-08, R-28; per-notice spec "Header facts — a source
// badge per field"): section, financial year, tax period, DIN, reply due,
// hearing, officer and the demand by head, each with where it came from.
// Values the PDF reader filled are confirmed or cleared in one click; values a
// reader found that differ from the record are listed (the record is kept);
// the officer's own facts and grounds; the AI reader's state.
import React, { useState } from 'react';
import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import {
  conflictsOf, demandRows, fmtField, fmtPeriod, gstinMismatch, portalText, provenance, readableDocument, readBlock,
  replyDueSource, unappliedOf, verifyField, type Conflict, type Provenance, type ReadField, type Reading,
} from '@/lib/noticeReading';
import type { Workspace } from '@/lib/noticeWorkspace';
import { fmtDate, fmtFy, fmtInr } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';
import { ReadSourceChip, VerifyButtons } from './ReadSourceChip';
import { DemandTable } from './DemandTable';
import { PeriodEditor } from './PeriodEditor';
import { ReadingStatus } from './ReadingStatus';

interface Fact {
  key: string;
  label: string;
  value: string;
  sub?: string | null;
  prov: Provenance;
  /** The columns behind the value (Confirm / Clear act on those still to verify). */
  fields: ReadField[];
  mono?: boolean;
}

/** One chip for a value made of two columns: "verify" wins, then Typed, then the first. */
function combine(ps: Provenance[]): Provenance {
  const live = ps.filter((p) => p.kind !== 'empty');
  return live.find((p) => p.kind === 'verify') ?? live.find((p) => p.kind === 'typed') ?? live[0] ?? { kind: 'empty' };
}

function conflictText(c: Conflict): string {
  const by = c.reader === 'ai' ? 'the PDF' : 'the portal\'s case folder';
  const held = c.held === 'portal' ? `the portal says ${c.kept}` : `on record ${c.kept} (typed)`;
  return `${held}, ${by} says ${c.read} — kept ${c.kept}.`;
}

const PERIOD_FORMS = new Set(['DRC-01B', 'DRC-01C']);

export const NoticeReadCard: React.FC<{
  ws: Workspace;
  reading: Reading | undefined;
  loading: boolean;
  /** Loading the readings failed: say so instead of guessing the reader's state. */
  error?: unknown;
  canEdit: boolean;
  onChanged: () => void;
}> = ({ ws, reading, loading, error, canEdit, onChanged }) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const n = ws.notice;
  const f = ws.fact;
  const verifying = (fields: ReadField[]) => fields.filter((k) => provenance(n, k).kind === 'verify');

  const due = replyDueSource({ due_basis: f.due_basis, due_basis_note: f.due_basis_note }, n);
  const amountGap = n.demand_total !== null && n.amount_of_demand !== null && Math.abs(Number(n.demand_total) - Number(n.amount_of_demand)) > 1;
  const facts: Fact[] = [
    { key: 'section', label: 'Section', value: fmtField('section_of_law', n.section_of_law), prov: provenance(n, 'section_of_law'), fields: ['section_of_law'] },
    { key: 'fy', label: 'Financial year', value: fmtFy(n.financial_year) || '—', prov: provenance(n, 'financial_year'), fields: ['financial_year'] },
    {
      key: 'period', label: 'Tax period', value: fmtPeriod(n.period_from, n.period_to) || '—',
      prov: combine([provenance(n, 'period_from'), provenance(n, 'period_to')]), fields: ['period_from', 'period_to'],
    },
    { key: 'din', label: 'DIN', value: n.din || '—', prov: provenance(n, 'din'), fields: ['din'], mono: !!n.din },
    {
      key: 'due', label: 'Reply due', value: f.effective_due ? fmtDate(f.effective_due) : '—', prov: due,
      fields: f.due_basis === 'portal' ? ['due_date'] : [],
      sub: f.response_need === 'none' ? 'No reply needed for this notice type'
        : f.due_basis === 'computed' ? f.due_basis_note : f.due_basis === 'extended' && n.due_date ? `original due ${fmtDate(n.due_date)}` : null,
    },
    {
      key: 'hearing', label: 'Hearing', value: n.hearing_date ? fmtDate(n.hearing_date) : '—', sub: n.hearing_note,
      prov: combine([provenance(n, 'hearing_date'), provenance(n, 'hearing_note')]), fields: ['hearing_date', 'hearing_note'],
    },
    { key: 'officer', label: 'Officer', value: n.issued_by || '—', prov: provenance(n, 'issued_by'), fields: ['issued_by'] },
    {
      key: 'amount', label: 'Amount of demand', value: Number(n.amount_of_demand) ? fmtInr(n.amount_of_demand) : '—',
      prov: provenance(n, 'amount_of_demand'), fields: ['amount_of_demand'],
      sub: amountGap ? `the demand by head adds up to ${fmtInr(n.demand_total)}` : null,
    },
  ];
  const demandProv = provenance(n, 'demand');
  const hasDemand = demandRows(n.demand).length > 0;
  const toVerify = [...facts.flatMap((x) => verifying(x.fields)), ...verifying(['demand'])];
  const valuesToVerify = facts.filter((x) => verifying(x.fields).length).length + (verifying(['demand']).length ? 1 : 0);

  const conflicts = [...conflictsOf(reading?.aiDone, n), ...conflictsOf(reading?.portal, n)];
  const unapplied = unappliedOf(reading?.aiDone);
  const mismatch = gstinMismatch(reading?.aiDone);
  const officer = portalText(reading?.portal);
  const block = readBlock(reading, !!readableDocument(n, ws.folder));
  // The Evidence tab can work from the financial year: ask for the period only when neither is on record.
  const missingPeriod = PERIOD_FORMS.has(f.form_code ?? '') && !n.period_from && !n.period_to && !n.financial_year;

  const act = async (key: string, what: string, fields: ReadField[], action: 'confirm' | 'clear') => {
    if (!user || !fields.length) return;
    setBusy(key);
    try {
      const results: string[] = [];
      for (const k of fields) results.push(await verifyField(n.id, k, action, user));
      if (results.includes('verified')) toast.info(`${what} is already confirmed, so it stays.`);
      else if (results.every((r) => r === 'nothing' || r === 'gone')) toast.info('Nothing to change: no reader filled this value.');
      else toast.success(action === 'confirm' ? `${what} confirmed.` : `${what} cleared — it is empty again.`);
      onChanged();
    } catch (e) {
      toast.error(`Couldn't ${action} ${what.toLowerCase()}: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };

  const sources = [reading?.portal ? 'the portal\'s case folder' : '', reading?.aiDone && reading.aiDone.outcome !== 'gstin_mismatch' ? 'the notice PDF' : '']
    .filter(Boolean).join(' and ');
  const description = sources
    ? `Read from ${sources}${toVerify.length ? ' — values marked "verify" need a person\'s check' : ''}.`
    : 'No reader has filled this notice yet: values are as typed or as the portal list shows them.';

  return (
    <SectionCard title="What the notice says" description={description}
      actions={canEdit && valuesToVerify > 1 && (
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy === 'all'}
          onClick={() => act('all', 'Every value read from the PDF', toVerify, 'confirm')}>
          Confirm all {valuesToVerify}<span className="sr-only"> values read from the PDF</span>
        </Button>
      )}>
      {mismatch && (
        <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-2.5 py-1.5 text-xs">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" aria-hidden />
          <p className="min-w-0 break-words">
            <span className="font-semibold text-destructive-strong">This PDF is addressed to another GSTIN — nothing was applied.</span>{' '}
            {mismatch.found ? <>It names <span className="font-mono">{mismatch.found}</span>; the client is <span className="font-mono">{mismatch.expected ?? ws.client?.gstin}</span>. </> : null}
            Check that the right PDF is attached to this notice before reading it again.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-4">
        {facts.map((x) => {
          const pending = verifying(x.fields);
          const empty = x.value === '—';
          return (
            <div key={x.key} className="min-w-0 space-y-0.5">
              <dt className="text-[11px] font-medium text-muted-foreground">{x.label}</dt>
              <dd className={cn('break-words text-sm font-semibold', x.mono && 'break-all font-mono text-[13px]', empty && 'font-normal text-muted-foreground')}>
                {x.value}
              </dd>
              {x.sub && <dd className="break-words text-xs text-muted-foreground">{x.sub}</dd>}
              {x.key === 'period' && missingPeriod && <dd className="text-xs font-medium text-destructive-strong">Tax period not on record. The Evidence tab needs it.</dd>}
              {(x.prov.kind !== 'empty' || (canEdit && x.key === 'period')) && (
                <dd className="flex flex-wrap items-center gap-1 pt-0.5">
                  <ReadSourceChip p={x.prov} />
                  {canEdit && pending.length > 0 && (
                    <VerifyButtons what={x.label.toLowerCase()} busy={busy === x.key}
                      onConfirm={() => act(x.key, x.label, pending, 'confirm')}
                      onClear={() => act(x.key, x.label, pending, 'clear')} />
                  )}
                  {canEdit && x.key === 'period' && (
                    <PeriodEditor noticeId={n.id} from={n.period_from} to={n.period_to} onSaved={onChanged}
                      label={n.period_from ? 'Change' : 'Set the period'} prominent={missingPeriod} />
                  )}
                </dd>
              )}
            </div>
          );
        })}
      </dl>

      {hasDemand && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold">Demand by head</span>
            <ReadSourceChip p={demandProv} />
            {canEdit && demandProv.kind === 'verify' && (
              <VerifyButtons what="demand by head" busy={busy === 'demand'}
                onConfirm={() => act('demand', 'The demand by head', ['demand'], 'confirm')}
                onClear={() => act('demand', 'The demand by head', ['demand'], 'clear')} />
            )}
          </div>
          <DemandTable demand={n.demand} caption="Demand by head and component" className="max-w-3xl" />
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-1 rounded-md border border-warning/60 px-2.5 py-1.5 text-xs">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden /> Different values found — the notice keeps what it had
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {conflicts.map((c) => <li key={`${c.reader}-${c.field}`} className="break-words"><span className="font-medium">{c.label}:</span> {conflictText(c)}</li>)}
          </ul>
        </div>
      )}

      {unapplied.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          Read from the PDF but not applied: {unapplied.map((u) => `${u.label.toLowerCase()} “${u.value}” (${u.why})`).join('; ')}.
        </p>
      )}

      {officer && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <button type="button" className="group inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
              Officer's facts and grounds
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1.5 pt-1.5 text-xs">
            {([['Subject', officer.subject], ['Facts', officer.facts], ['Grounds', officer.grounds], ['Reason', officer.reason]] as const)
              .filter(([, t]) => t)
              .map(([k, t]) => (
                <div key={k}>
                  <div className="font-semibold">{k}</div>
                  <p className="whitespace-pre-line break-words">{t}</p>
                </div>
              ))}
            {officer.hearingAsked !== null && <p>Personal hearing: {officer.hearingAsked ? 'offered' : 'not offered'} (as the portal shows it).</p>}
          </CollapsibleContent>
        </Collapsible>
      )}

      {loading && !reading ? <Skeleton className="h-10 w-full" />
        : error && !reading ? <p className="text-xs text-destructive-strong">Couldn't load what the readers found: {error instanceof Error ? error.message : String(error)}</p>
        : <ReadingStatus notice={n} reading={reading} block={block} canEdit={canEdit} onQueued={onChanged} />}
    </SectionCard>
  );
};

export default NoticeReadCard;
