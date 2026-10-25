// "Applications on the portal" on the client profile (roadmap Phase 3; audit
// S-22): the portal's My Applications — appeals (APL-01) first, then
// rectification, objections to a provisional attachment, the s.128A waiver,
// compounding and provisional assessment — as the last sync read them.
// An appeal says what it is against and opens the refund or case it belongs
// to (the firm, 25 October 2026).
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/notices/ui/Panel';
import { APPLICATION_TYPES } from '@/lib/autopilot';
import { fmtDate, plural, sentenceCase } from '@/lib/noticeFormat';
import { ToneBadge } from './parts';
import { appealLine, usePortalApps } from '@/lib/portalAppeal';

const typeRank = (code: string) => { const i = APPLICATION_TYPES.findIndex((t) => t.code === code); return i < 0 ? 99 : i; };
const typeLabel = (code: string) => APPLICATION_TYPES.find((t) => t.code === code)?.label ?? code;

function statusTone(status: string | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  const s = (status ?? '').toLowerCase();
  if (/reject|dismiss|withdrawn/.test(s)) return 'destructive';
  if (/(pending|submitted|filed|admitted|hearing|progress|awaited)/.test(s)) return 'warning';
  if (/(order issued|disposed|allowed|approved|closed|final)/.test(s)) return 'success';
  return 'secondary';
}

export const PortalApplicationsCard: React.FC<{ clientId: string }> = ({ clientId }) => {
  const q = usePortalApps(clientId);
  const rows = [...(q.data ?? [])].sort((a, b) => typeRank(a.row.case_type_cd) - typeRank(b.row.case_type_cd)
    || (b.row.filed_date ?? '').localeCompare(a.row.filed_date ?? ''));
  return (
    <SectionCard title="Applications on the portal" description="Appeals, rectifications, objections and waivers filed on the portal">
      {q.isLoading ? <Skeleton className="h-16 w-full" />
        : q.error ? <p className="text-xs text-muted-foreground">Couldn't read the applications: {q.error instanceof Error ? q.error.message : String(q.error)}</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">None read yet — the next sync reads them.</p>
        : (
          <ul className="divide-y">
            {rows.map(({ row: a, appeal, target, files }) => (
              <li key={a.id} className="space-y-0.5 py-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium">
                    {a.form_number ? `${a.form_number} · ` : ''}{a.form_description ? sentenceCase(a.form_description) : typeLabel(a.case_type_cd)}
                  </span>
                  {a.status && <ToneBadge tone={statusTone(a.status)} className="shrink-0">{sentenceCase(a.status)}</ToneBadge>}
                </div>
                <div className="break-words text-muted-foreground">
                  ARN <span className="font-mono">{a.arn ?? '—'}</span> · filed {fmtDate(a.filed_date)}
                  {appeal && appealLine(appeal) ? <> · {appealLine(appeal)}</> : null}
                </div>
                {files.length > 0 ? (
                  <div className="text-[11px] text-muted-foreground">{plural(files.length, 'file')} of the appeal in the app</div>
                ) : appeal && appeal.docs.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">{plural(appeal.docs.length, 'file')} filed with it, on the portal; downloaded at the next sync (extension 0.18.5)</div>
                )}
                {target ? (
                  <Link to={target.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {target.kind === 'refund' ? <>Open the refund <span className="font-mono">{target.key}</span></> : 'Open the case of the order'}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                ) : appeal?.order.ref ? (
                  <div className="text-[11px] text-muted-foreground">The order it is against is not on record in the app.</div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
};

export default PortalApplicationsCard;
