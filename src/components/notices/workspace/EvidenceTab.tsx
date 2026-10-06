// The notice's evidence (roadmap Phase 4 "Evidence recipes"; audit R-10,
// R-23): the workings that answer its issues from the portal figures the app
// holds — one per coded issue, else the form's own (DRC-01B: GSTR-1 v 3B;
// DRC-01C: 3B v 2B; ASMT-10 / DRC-01A: the year at a glance) — each with its
// annexure tables, every row's source, the data still missing and how to get
// it. Built on open and saved as 'Auto' when there is no version yet or the
// inputs changed; Rebuild saves it in the person's name.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { WS_BTN } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import type { Workspace } from '@/lib/noticeWorkspace';
import { fmtInr, plural } from '@/lib/noticeFormat';
import { istToday } from '@/lib/noticeFacts';
import { resolvePeriod, saveCards, PERIOD_SOURCE_WORDS, type AnnexureStatus } from '@/lib/reply';
import { toNotice } from '@/lib/reply/load';
import { EvidenceCard } from '@/components/notices/reply/evidence/EvidenceCard';
import { PeriodEditor } from '@/components/notices/reply/evidence/PeriodEditor';
import { useEvidence } from '@/components/notices/reply/evidence/useEvidence';
import { STATUS_LOOK } from '@/components/notices/reply/evidence/look';

export const EvidenceTab: React.FC<{ ws: Workspace; canEdit: boolean; onChanged: () => void }> = ({ ws, canEdit, onChanged }) => {
  const { user, canExportData } = useAuth();
  const n = ws.notice;
  const signature = useMemo(() => JSON.stringify([
    n.period_from, n.period_to, n.financial_year, n.form_code, n.demand, n.amount_of_demand, n.demand_total,
    ws.issues.map((i) => [i.id, i.issue_code, i.amount, i.period_from, i.period_to, i.demand]),
    ws.payments.map((p) => p.drc03_arn),
  ]), [n, ws.issues, ws.payments]);
  const ev = useEvidence(n.id, signature, onChanged);
  const [editPeriod, setEditPeriod] = useState(false);
  const [busy, setBusy] = useState(false);
  const noticePeriod = useMemo(() => resolvePeriod({ notice: toNotice(n as unknown as Record<string, unknown>), today: istToday() }), [n]);

  const afterPeriod = () => { setEditPeriod(false); onChanged(); ev.refresh(); };
  const base = {
    title: '',
    client: { name: ws.client?.name ?? 'Client', gstin: ws.client?.gstin ?? null },
    notice: { reference: n.reference_number ?? null, form: n.form_code ?? null },
  };

  if (ev.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (ev.error || !ev.data) {
    return (
      <div className="space-y-2">
        <Note tone="warn">Couldn’t build the evidence: {ev.error instanceof Error ? ev.error.message : 'unknown error'}</Note>
        <Button size="sm" variant="outline" className={WS_BTN} onClick={() => ev.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
      </div>
    );
  }
  const b = ev.data;
  const counts = b.cards.reduce<Partial<Record<AnnexureStatus, number>>>((a, c) => ({ ...a, [c.result.status]: (a[c.result.status] ?? 0) + 1 }), {});
  const toPay = b.cards.reduce((sum, c) => sum + (c.result.toPay ?? 0), 0);

  const rebuildAll = async () => {
    setBusy(true);
    try {
      const r = await saveCards(b.cards, ev.saved, { auto: false, actorName: user?.firstName ?? 'Staff' });
      const saved = r.cards.filter((c) => c.saved).length;
      const failed = r.cards.find((c) => c.error);
      if (failed) toast.error(`Could not save: ${failed.error}`);
      else toast.success(saved ? `Saved ${plural(saved, 'new version')}.` : 'Nothing changed; every working is current.');
      ev.refreshSaved();
      if (r.touchedIssues) onChanged();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5 text-sm">
          <p>
            Workings from the returns the extension pulled from the portal — never the app’s own drafts. Every row names its source.
          </p>
          <p className="text-xs text-muted-foreground">
            Notice period: {noticePeriod.periods.length ? `${noticePeriod.label} (${PERIOD_SOURCE_WORDS[noticePeriod.source]})` : 'not on record'}
            {canEdit && !editPeriod && (
              <> · <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => setEditPeriod(true)}>{noticePeriod.periods.length ? 'Change the period' : 'Set the period'}</button></>
            )}
          </p>
        </div>
        {canEdit && b.cards.length > 0 && (
          <Button size="sm" variant="outline" className={WS_BTN} onClick={rebuildAll} disabled={busy || ev.autoSaving}>
            {busy || ev.autoSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rebuild all
          </Button>
        )}
      </div>
      {editPeriod && (
        <div className="rounded-md border p-2.5">
          <PeriodEditor noticeId={n.id} idPrefix="ev-notice" periods={noticePeriod.periods} onSaved={afterPeriod} onCancel={() => setEditPeriod(false)} />
        </div>
      )}

      {b.cards.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <span>{plural(b.cards.length, 'working')}:</span>
          {(Object.keys(STATUS_LOOK) as AnnexureStatus[]).filter((k) => counts[k]).map((k) => (
            <Badge key={k} variant={STATUS_LOOK[k].tone} className="text-[11px]">{counts[k]} {STATUS_LOOK[k].label.toLowerCase()}</Badge>
          ))}
          {toPay > 0 && <span className="font-medium">· {fmtInr(toPay)} left to pay or reverse</span>}
        </p>
      )}

      {b.errors.length > 0 && (
        <Note tone="info">Some sources could not be read and are treated as not fetched: {b.errors.join('; ')}.</Note>
      )}

      {b.uncovered.length > 0 && (
        <Note tone="info" open>
          No automatic working for {b.uncovered.map((u) => `issue ${u.issue.seq} (${u.type?.title ?? u.issue.issueCode})`).join(', ')}.
          {b.uncovered.some((u) => u.type?.documents.length) && <> It needs: {[...new Set(b.uncovered.flatMap((u) => u.type?.documents ?? []))].join('; ')}.</>}
        </Note>
      )}

      {b.cards.length === 0 && b.uncovered.length === 0 && (
        <Note tone="info" open>
          No working applies yet: the notice has no coded issue{n.form_code ? `, and a ${n.form_code} has no working of its own` : ''}.
          Give its issues a type on the <Link to={`/notices/${n.id}?tab=issues`} className="font-medium text-primary underline underline-offset-2">Issues</Link> tab.
        </Note>
      )}

      {b.cards.map((card) => (
        <EvidenceCard
          key={card.key}
          card={card}
          versions={ev.saved.filter((a) => a.recipe === card.plan.recipe && (a.issueId ?? null) === (card.plan.issue?.id ?? null))}
          base={base}
          clientId={n.client_id}
          canEdit={canEdit}
          canExport={canExportData()}
          autoSaving={ev.autoSaving}
          onSaved={() => { ev.refreshSaved(); onChanged(); }}
          onPeriodSaved={afterPeriod}
        />
      ))}
    </div>
  );
};

export default EvidenceTab;
