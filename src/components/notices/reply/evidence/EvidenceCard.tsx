// One working on the Evidence tab (roadmap Phase 4; audit R-10, R-23): status
// and period, the result per head, what data it needed and what is missing
// (with the fetch), the annexure tables with a source on every row, Excel /
// PDF, the saved versions, and Rebuild (saved with the person's name).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/gstr9/badge';
import { KpiTile, Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { fmtDateTime, fmtInr, plural } from '@/lib/noticeFormat';
import { currentOf, PERIOD_SOURCE_WORDS, saveCard, type EvidenceCard as Card, type SavedAnnexure } from '@/lib/reply';
import { cn } from '@/lib/utils';
import { readinessCounts, statusLook } from './look';
import { HeadSummary } from './HeadSummary';
import { AnnexureTableView } from './AnnexureTableView';
import { ReadinessGrid } from './ReadinessGrid';
import { FetchPanel } from './FetchPanel';
import { PeriodEditor } from './PeriodEditor';
import { VersionHistory } from './VersionHistory';
import { ExportButtons, type ExportBase } from './ExportButtons';

const DETAILS = 'group rounded-md border bg-card';
const SUMMARY = 'flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden';
const Chevron = () => <span aria-hidden className="text-muted-foreground transition-transform group-open:rotate-90">›</span>;

export const EvidenceCard: React.FC<{
  card: Card;
  versions: SavedAnnexure[];
  base: ExportBase;
  clientId: string;
  canEdit: boolean;
  canExport: boolean;
  autoSaving: boolean;
  onSaved: () => void;
  onPeriodSaved: () => void;
}> = ({ card, versions, base, clientId, canEdit, canExport, autoSaving, onSaved, onPeriodSaved }) => {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const r = card.result;
  const s = r.summary;
  const look = statusLook(r.status);
  const current = currentOf(card, versions);
  const upToDate = !!current && current.inputsHash === card.hash && current.status === r.status;
  const counts = readinessCounts(r.readiness);
  const cellsTotal = Object.values(counts).reduce((a, b) => a + b, 0) - counts.not_due;
  const idp = `ev-${card.key.replace(/[^a-z0-9]/gi, '')}`;
  const needsPeriod = !r.periods.length;
  // Nothing compared yet (or nothing to compare): no zero-filled tables, only what is missing and how to get it.
  const computed = r.status === 'ready' || r.status === 'partial';
  const [first, ...rest] = computed ? r.tables : [];

  const rebuild = async () => {
    setBusy(true);
    try {
      const out = await saveCard(card, user?.firstName ?? 'Staff');
      if (out.error) toast.error(`Could not save: ${out.error}`);
      else if (out.unchanged) toast.info(`Nothing changed since version ${out.version}; it stays current.`);
      else toast.success(`Saved as version ${out.version}.`);
      onSaved();
    } finally { setBusy(false); }
  };

  const exportable = canExport && r.status !== 'needs_data' && r.status !== 'failed';
  const toolbar = exportable || canEdit ? (
    <>
      {exportable && (
        <ExportButtons model={{ ...base, title: r.title, status: look.label, periods: r.periods, summary: s, tables: r.tables, readiness: r.readiness, version: { number: current?.version ?? null, by: current?.generatedBy ?? null, at: current?.generatedAt ?? null } }} />
      )}
      {canEdit && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={rebuild} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rebuild
        </Button>
      )}
    </>
  ) : null;

  return (
    <SectionCard
      title={<span className="flex flex-wrap items-center gap-2">{r.title}<Badge variant={look.tone} className="text-[11px]">{look.label}</Badge></span>}
      description={
        <>
          {card.plan.reason} · {r.periods.length ? <>{card.ctx.period.label} <span className="text-muted-foreground">({PERIOD_SOURCE_WORDS[card.ctx.period.source]})</span></> : 'no period on record'}
        </>
      }
      // On a phone the buttons sit under the title instead, so the title keeps its width.
      actions={toolbar ? <div className="hidden flex-wrap items-center gap-2 md:flex">{toolbar}</div> : undefined}
    >
      {toolbar && <div className="flex flex-wrap items-center gap-2 md:hidden">{toolbar}</div>}
      <p className="text-sm">{s.headline}</p>

      {computed && s.heads.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile label="Per the notice" value={fmtInr(s.notice_total)} hint={s.notice_basis ?? 'Not stated'} />
          <KpiTile label="Computed" value={fmtInr(s.computed_total)} hint="From the portal returns" />
          <KpiTile label="Explained" value={fmtInr(s.explained_total)} hint={s.explained_total === null ? 'No notice figure to explain' : 'Notice − to pay'} tone={s.explained_total ? 'ok' : 'neutral'} />
          <KpiTile label="To pay" value={fmtInr(s.to_pay_total)} hint={s.to_pay_total > 0 ? 'After timing and payments' : 'Nothing left'} tone={s.to_pay_total > 0 ? 'error' : 'ok'} />
        </div>
      )}

      {needsPeriod && card.ctx.period.source === 'none' && (
        canEdit
          ? <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 p-2.5">
              <p className="text-xs font-medium">Set the tax period this notice covers</p>
              <PeriodEditor noticeId={card.ctx.notice.id} idPrefix={idp} periods={[]} onSaved={onPeriodSaved} />
            </div>
          : <Note tone="warn">This notice has no tax period on record. Someone who can edit notices needs to set it.</Note>
      )}

      {cellsTotal > 0 && (
        <details className={DETAILS} open={counts.ready < cellsTotal}>
          <summary className={SUMMARY}>
            <Chevron /> Data from the portal: {counts.ready} of {cellsTotal} ready
            {counts.not_fetched + counts.failed > 0 && <span className="text-xs font-normal text-muted-foreground">· {counts.not_fetched + counts.failed} to fetch</span>}
            {counts.not_filed > 0 && <span className="text-xs font-normal text-muted-foreground">· {counts.not_filed} not filed</span>}
          </summary>
          <div className="space-y-2 border-t p-3">
            <ReadinessGrid readiness={r.readiness} />
            <FetchPanel clientId={clientId} plan={r.readiness.plan} canEdit={canEdit} onQueued={onSaved} />
          </div>
        </details>
      )}

      {computed && <HeadSummary summary={s} />}

      {first && <AnnexureTableView table={first} />}
      {rest.map((t) => (
        <details key={t.key} className={DETAILS}>
          <summary className={SUMMARY}><Chevron /> {t.title} <span className="text-xs font-normal text-muted-foreground">({plural(t.rows.length, 'row')})</span></summary>
          <div className="border-t p-3"><AnnexureTableView table={t} caption={false} />{t.note && <p className="mt-1 text-xs text-muted-foreground">{t.note}</p>}</div>
        </details>
      ))}

      {s.missing.length > 0 && (
        <Note tone="warn">
          <span className="font-medium">Not compared:</span>
          <ul className="mt-0.5 list-disc pl-4">{s.missing.slice(0, 8).map((m) => <li key={m}>{m}</li>)}{s.missing.length > 8 && <li>and {s.missing.length - 8} more</li>}</ul>
        </Note>
      )}
      {!!s.documents?.length && (
        <div className="text-xs">
          <p className="font-medium">Documents the client needs to give</p>
          <ul className="list-disc pl-4">{s.documents.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
      {!!s.links?.length && (
        <p className="flex flex-wrap gap-3 text-xs">
          {s.links.map((l) => <Link key={l.to} to={l.to} className="font-medium text-primary underline underline-offset-2">{l.label}</Link>)}
        </p>
      )}
      {s.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}

      <details className={DETAILS}>
        <summary className={SUMMARY}>
          <Chevron /> Versions ({versions.length})
          <span className={cn('text-xs font-normal', upToDate ? 'text-muted-foreground' : 'text-foreground')}>
            · {upToDate && current
              ? `version ${current.version} is current — ${current.generatedBy ?? '—'}, ${fmtDateTime(current.generatedAt)}`
              : autoSaving ? 'saving…' : current ? `inputs changed since version ${current.version}` : 'not saved yet'}
          </span>
        </summary>
        <div className="border-t p-3"><VersionHistory versions={versions} base={base} canExport={canExport} /></div>
      </details>
    </SectionCard>
  );
};

export default EvidenceCard;
