import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Note } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import type { Workspace } from '@/lib/noticeWorkspace';
import { daysBetween, istToday } from '@/lib/noticeFacts';
import { dueWords, fmtDate, fmtDateTime, noticeTitle } from '@/lib/noticeFormat';
import { downloadIcs } from '@/lib/noticeIcs';
import { downloadHearingPack } from '@/lib/noticeHearingPack';

/** The personal hearing on the notice, and the matter's hearings when it has one (Phase 6 adds the hearing kit). */
export const HearingsTab: React.FC<{ ws: Workspace; canEdit: boolean; onFix: () => void }> = ({ ws, canEdit, onFix }) => {
  const n = ws.notice;
  const today = istToday();
  const [packing, setPacking] = useState(false);
  const pack = () => {
    setPacking(true);
    downloadHearingPack(ws).catch((e) => toast.error(`Could not make the hearing pack: ${e instanceof Error ? e.message : String(e)}`)).finally(() => setPacking(false));
  };
  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        {n.hearing_date ? (
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Personal hearing · {fmtDate(n.hearing_date)}</div>
              <div className="text-xs text-muted-foreground">{dueWords(daysBetween(today, n.hearing_date)).replace('due ', '')}{n.hearing_note ? ` · ${n.hearing_note}` : ''}</div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" className="h-8 gap-1 text-xs" disabled={packing} onClick={pack}
                title="One PDF to carry: the notice and hearing, the demand by head, the issues with our stand, the reply, the papers on record and a checklist for the day">
                {packing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} Hearing pack
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => downloadIcs([{
                uid: `hearing-${n.id}`, date: n.hearing_date as string,
                title: `Hearing — ${ws.client?.name ?? ''} · ${noticeTitle(ws.fact, { fy: false })}`,
                description: `${n.hearing_note ?? ''}\n${n.reference_number ?? n.case_id ?? ''}`,
              }], `hearing-${n.reference_number || n.id}`)}><CalendarPlus className="h-3.5 w-3.5" /> .ics</Button>
              {canEdit && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onFix}>Change</Button>}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            No hearing fixed on this notice.
            {canEdit && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onFix}>Fix a hearing</Button>}
          </div>
        )}
      </div>
      {ws.matter && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground">
            Matter <Link to={`/litigation/${ws.matter.id}`} className="text-primary hover:underline">{ws.matter.matter_no}</Link> hearings
          </div>
          {ws.hearings.length === 0 ? <p className="text-xs text-muted-foreground">None recorded on the matter.</p> : (
            <ul className="divide-y rounded-md border">
              {ws.hearings.map((h) => (
                <li key={h.id} className="px-3 py-2 text-sm">
                  <div className="font-medium">{fmtDateTime(h.scheduled_at)}{h.adjourned ? ' · adjourned' : ''}</div>
                  <div className="text-xs text-muted-foreground">{[h.mode, h.venue, h.officer, h.outcome].filter(Boolean).join(' · ') || '—'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Note tone="info">A hearing fixed here shows on the calendar, the owner's 09:30 list and the Hearings page. The hearing pack is one PDF to carry: the notice, the demand, the issues with our stand, the reply, the papers on record and a checklist for the day.</Note>
    </div>
  );
};

export default HearingsTab;
