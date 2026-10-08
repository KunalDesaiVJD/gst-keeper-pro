// The client's refunds and DRC-03 payments, each in its own list (audit U-56-2
// "move payments to their own list", U-57-1, U-57-2): one row per ARN (the
// refund_facts / drc03_facts views already merge a case row into its
// application), titled with the refund type, the money, and the portal status
// toned by what it asks of us; an RFD-08 or RFD-03 waiting for a reply says so.
import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, FolderOpen } from 'lucide-react';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import type { Drc03Fact, RefundFact } from '@/lib/noticeFacts';
import { fmtDate, fmtInrShort, plural, sentenceCase } from '@/lib/noticeFormat';
import { refundNeedsReply } from './profileData';

const firstDoc = (docs: unknown): string | null => {
  const d = Array.isArray(docs) ? (docs[0] as { url?: unknown } | undefined) : undefined;
  return typeof d?.url === 'string' ? d.url : null;
};

const FolderLink: React.FC<{ clientId: string; caseId: string; label: string }> = ({ clientId, caseId, label }) => (
  <Link to={`/notices-case-folder/${clientId}/${encodeURIComponent(caseId)}`}
    className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
    <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Case folder<span className="sr-only"> for {label}</span>
  </Link>
);
const PdfLink: React.FC<{ url: string; label: string }> = ({ url, label }) => (
  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline">
    <FileText className="h-3.5 w-3.5" aria-hidden /> PDF<span className="sr-only"> of {label}</span>
  </a>
);

export const RefundList: React.FC<{ clientId: string; rows: RefundFact[]; caseIds: Set<string> }> = ({ clientId, rows, caseIds }) => {
  const waiting = rows.filter(refundNeedsReply).length;
  return (
    <SectionCard title={`Refunds · ${rows.length}`}
      description={waiting ? `${plural(waiting, 'refund')} waiting for a reply` : 'Applications and refund cases, one row per ARN'}
      actions={<Link to={`/refunds-all?client=${clientId}`} className="text-xs font-medium text-primary hover:underline">All refunds →</Link>}>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">No refund application on record.</p> : (
        <ul className="divide-y">
          {rows.map((r) => {
            const label = `${sentenceCase(r.refund_type) || 'Refund'} ${r.arn ?? ''}`;
            const doc = firstDoc(r.documents);
            const needs = refundNeedsReply(r);
            return (
              <li key={`${r.origin}-${r.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium">{sentenceCase(r.refund_type) || 'Refund'}</div>
                  <div className="break-words text-xs text-muted-foreground">
                    <span className="font-mono">{r.arn ?? 'no ARN'}</span>{r.filed_date ? ` · filed ${fmtDate(r.filed_date)}` : ''}
                    {r.claimed_amount != null ? ` · claimed ${fmtInrShort(r.claimed_amount)}` : ''}
                    {r.sanctioned_amount != null ? ` · sanctioned ${fmtInrShort(r.sanctioned_amount)}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.status && (
                    <Badge variant={needs ? 'warning' : r.is_closed ? 'secondary' : 'info'} className="text-[11px]">
                      {needs ? `Reply needed · ${sentenceCase(r.status)}` : sentenceCase(r.status)}
                    </Badge>
                  )}
                  {r.arn && caseIds.has(r.arn) && <FolderLink clientId={clientId} caseId={r.arn} label={label} />}
                  {doc && <PdfLink url={doc} label={label} />}
                  {r.notice_id && <Link to={`/notices/${r.notice_id}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">Notice<span className="sr-only"> for {label}</span></Link>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
};

export const Drc03List: React.FC<{ clientId: string; rows: Drc03Fact[]; caseIds: Set<string> }> = ({ clientId, rows, caseIds }) => (
  <SectionCard title={`DRC-03 payments · ${rows.length}`} description="Voluntary payments and payments against notices, one row per ARN"
    actions={<Link to={`/drc03-all?client=${clientId}`} className="text-xs font-medium text-primary hover:underline">All DRC-03 →</Link>}>
    {rows.length === 0 ? <p className="text-xs text-muted-foreground">No DRC-03 on record.</p> : (
      <ul className="divide-y">
        {rows.map((d) => {
          const label = `DRC-03 ${d.arn ?? ''}`;
          return (
            <li key={`${d.origin}-${d.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="break-words font-medium">{sentenceCase(d.cause_of_payment) || 'DRC-03 payment'}</div>
                <div className="text-xs text-muted-foreground"><span className="font-mono">{d.arn ?? 'no ARN'}</span>{d.filed_date ? ` · filed ${fmtDate(d.filed_date)}` : ''}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.status && <Badge variant={d.is_closed ? 'secondary' : 'info'} className="text-[11px]">{sentenceCase(d.status)}</Badge>}
                {d.arn && caseIds.has(d.arn) && <FolderLink clientId={clientId} caseId={d.arn} label={label} />}
                {d.pdf_url && <PdfLink url={d.pdf_url} label={label} />}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </SectionCard>
);
