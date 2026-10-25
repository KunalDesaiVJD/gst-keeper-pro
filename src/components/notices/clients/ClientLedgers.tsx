// The client's DRC-03 payments in their own list (audit U-56-2 "move payments
// to their own list", U-57-1, U-57-2): one row per ARN, the latest first. The
// client's refunds are summed up in ClientRefunds (25 October 2026).
import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, FolderOpen } from 'lucide-react';
import { SectionCard } from '@/components/notices/ui/Panel';
import { Badge } from '@/components/gstr9/badge';
import type { Drc03Fact } from '@/lib/noticeFacts';
import { fmtDate, sentenceCase } from '@/lib/noticeFormat';

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

/** The latest DRC-03 payments (limit, newest first); All DRC-03 lists every one. */
export const Drc03List: React.FC<{ clientId: string; rows: Drc03Fact[]; caseIds: Set<string>; limit?: number }> = ({ clientId, rows, caseIds, limit }) => (
  <SectionCard title={`DRC-03 payments · ${rows.length}`}
    description={limit && rows.length > limit ? `The latest ${limit}` : 'Voluntary payments and payments against notices, one row per ARN'}
    actions={<Link to={`/drc03-all?client=${clientId}`} className="text-xs font-medium text-primary hover:underline">All DRC-03 →</Link>}>
    {rows.length === 0 ? <p className="text-xs text-muted-foreground">No DRC-03 on record.</p> : (
      <ul className="divide-y">
        {[...rows].sort((a, b) => (b.filed_date ?? '').localeCompare(a.filed_date ?? '')).slice(0, limit ?? rows.length).map((d) => {
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
