// Every saved version of a working (who built it — a person, or "Auto" when it
// was built without a click — and when, with its result), and any earlier one
// opened read-only, exportable as it was.
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WS_TABLE, WS_TABLE_WRAP, WS_TD, WS_TD_NUM, WS_TH, WS_TR } from '@/components/workspace/theme';
import { fmtDateTime, fmtInr } from '@/lib/noticeFormat';
import { loadAnnexureVersion, periodsLabel, type AnnexureSummary, type AnnexureTable, type Readiness, type SavedAnnexure } from '@/lib/reply';
import { cn } from '@/lib/utils';
import { statusLook } from './look';
import { HeadSummary } from './HeadSummary';
import { AnnexureTableView } from './AnnexureTableView';
import { ExportButtons, type ExportBase } from './ExportButtons';

const VersionView: React.FC<{ id: string; base: ExportBase; canExport: boolean }> = ({ id, base, canExport }) => {
  const q = useQuery({ queryKey: ['annexure-version', id], queryFn: () => loadAnnexureVersion(id) });
  if (q.isLoading) return <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive-strong">Could not load this version.</p>;
  const v = q.data;
  const summary = v.summary as unknown as AnnexureSummary | null;
  const tables = (v.tables as unknown as AnnexureTable[] | null) ?? [];
  return (
    <div className="space-y-3">
      {canExport && summary && (
        <ExportButtons
          model={{
            ...base, title: v.title ?? base.title, status: statusLook(v.status).label, periods: v.periods ?? [], summary, tables,
            readiness: (v.readiness as unknown as Readiness | null) ?? null, version: { number: v.version, by: v.generated_by_name, at: v.generated_at },
          }}
        />
      )}
      {summary && <p className="text-sm">{summary.headline}</p>}
      {summary && <HeadSummary summary={summary} />}
      {tables.map((t) => <AnnexureTableView key={t.key} table={t} />)}
    </div>
  );
};

export const VersionHistory: React.FC<{ versions: SavedAnnexure[]; base: ExportBase; canExport: boolean }> = ({ versions, base, canExport }) => {
  const [open, setOpen] = useState<SavedAnnexure | null>(null);
  if (!versions.length) return <p className="text-xs text-muted-foreground">Not saved yet.</p>;
  return (
    <>
      <div className={WS_TABLE_WRAP} tabIndex={0} role="region" aria-label="Versions">
        <table className={WS_TABLE}>
          <thead>
            <tr>
              <th scope="col" className={WS_TH}>Version</th>
              <th scope="col" className={WS_TH}>Status</th>
              <th scope="col" className={WS_TH}>Built by</th>
              <th scope="col" className={WS_TH}>When</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>Explained</th>
              <th scope="col" className={cn(WS_TH, 'text-right')}>To pay</th>
              <th scope="col" className={WS_TH}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id} className={WS_TR}>
                <td className={WS_TD}>{v.version}{v.isCurrent && <span className="ml-1 text-xs text-muted-foreground">(current)</span>}</td>
                <td className={WS_TD}><Badge variant={statusLook(v.status).tone} className="text-[11px]">{statusLook(v.status).label}</Badge></td>
                <td className={WS_TD}>{v.generatedBy ?? '—'}</td>
                <td className={cn(WS_TD, 'whitespace-nowrap')}>{fmtDateTime(v.generatedAt)}</td>
                <td className={WS_TD_NUM}>{fmtInr(v.explained)}</td>
                <td className={WS_TD_NUM}>{fmtInr(v.toPay)}</td>
                <td className={WS_TD}>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(v)}>
                    View<span className="sr-only"> version {v.version}</span>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.title ?? 'Working'} — version {open?.version}</DialogTitle>
            <DialogDescription>
              {open ? `${statusLook(open.status).label} · ${periodsLabel(open.periods)} · built by ${open.generatedBy ?? '—'} on ${fmtDateTime(open.generatedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {open && <VersionView id={open.id} base={base} canExport={canExport} />}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VersionHistory;
