// The client's case folders (cross-cutting "per-notice information split across
// places"): one row per portal case with its kind in words, the portal's status,
// what needs a person and the last activity, each opening the folder.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import { Button } from '@/components/ui/button';
import type { NoticeFact } from '@/lib/noticeFacts';
import { fmtDate, noticeTitle, plural } from '@/lib/noticeFormat';
import { summarizeCase, type FolderItem } from './caseFolder';

const TONE = (s: string): 'destructive' | 'warning' | 'info' | 'secondary' =>
  /overdue|outstanding/i.test(s) ? 'destructive' : /awaited|hearing/i.test(s) ? 'warning' : /closed|paid/i.test(s) ? 'secondary' : 'info';

export const ClientCases: React.FC<{ clientId: string; folders: FolderItem[]; notices: NoticeFact[]; today: string }> = ({ clientId, folders, notices, today }) => {
  const [all, setAll] = useState(false);
  const cases = useMemo(() => {
    const byCase = new Map<string, FolderItem[]>();
    folders.forEach((f) => byCase.set(f.case_id, [...(byCase.get(f.case_id) ?? []), f]));
    notices.forEach((n) => { if (n.case_id && !byCase.has(n.case_id)) byCase.set(n.case_id, []); });
    return [...byCase.entries()].map(([caseId, items]) => {
      const ns = notices.filter((n) => n.case_id === caseId);
      const caseRow = ns.find((n) => !/^(notice|order)s?$/i.test((n.notice_type ?? '').trim())) ?? ns[0];
      const s = summarizeCase(items, {
        noticeType: caseRow?.notice_type, descriptions: ns.map((n) => n.description ?? ''), today,
        fallbackLabel: caseRow ? noticeTitle(caseRow, { fy: false }) : null,
      });
      return { caseId, s, open: ns.some((n) => n.is_open), last: s.last?.date ?? caseRow?.issue_date ?? null };
    }).sort((a, b) => Number(b.open) - Number(a.open) || (b.last ?? '').localeCompare(a.last ?? ''));
  }, [folders, notices, today]);
  const shown = all ? cases : cases.slice(0, 8);

  return (
    <SectionCard title={`Case folders · ${cases.length}`} description="Each portal case with its items, replies, orders and documents">
      {cases.length === 0 ? <p className="text-xs text-muted-foreground">No case folder on record for this client.</p> : (
        <>
          <ul className="divide-y">
            {shown.map(({ caseId, s, last }) => (
              <li key={caseId} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                <div className="min-w-0 flex-1">
                  <Link to={`/notices-case-folder/${clientId}/${encodeURIComponent(caseId)}`} className="break-words text-sm font-medium hover:underline">{s.label}</Link>
                  <div className="break-words text-xs text-muted-foreground">
                    Case <span className="font-mono">{caseId}</span>{last ? ` · last activity ${fmtDate(last)}` : ''} · {plural(s.events.length, 'item')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={TONE(s.portalStatus)} className="text-[11px]">{s.portalStatus}</Badge>
                  {s.alerts.filter((a) => a.tone === 'destructive').slice(0, 1).map((a) => <Badge key={a.text} variant="destructive" className="text-[11px]">{a.text}</Badge>)}
                </div>
              </li>
            ))}
          </ul>
          {cases.length > shown.length && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAll(true)}>Show all {cases.length} case folders</Button>
          )}
        </>
      )}
    </SectionCard>
  );
};

export default ClientCases;
