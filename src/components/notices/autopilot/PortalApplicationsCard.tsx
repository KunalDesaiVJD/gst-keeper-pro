// "Applications on the portal" on the client profile (roadmap Phase 3; audit
// S-22): the portal's My Applications — appeals (APL-01) first, then
// rectification, objections to a provisional attachment, the s.128A waiver,
// compounding and provisional assessment — as the last sync read them.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/gstr9/ui';
import { supabase } from '@/integrations/supabase/client';
import { APPLICATION_TYPES, type PortalApplication } from '@/lib/autopilot';
import { fmtDate, sentenceCase } from '@/lib/noticeFormat';
import { ToneBadge } from './parts';

type AppRow = Pick<PortalApplication, 'id' | 'case_type_cd' | 'arn' | 'form_number' | 'form_description' | 'status' | 'filed_date' | 'last_seen_at'>;

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
  const q = useQuery({
    queryKey: ['portal-applications', clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<AppRow[]> => {
      const { data, error } = await supabase.from('gst_portal_applications')
        .select('id, case_type_cd, arn, form_number, form_description, status, filed_date, last_seen_at')
        .eq('client_id', clientId).is('deleted_at', null);
      if (error) throw error;
      return ((data ?? []) as AppRow[]).sort((a, b) => typeRank(a.case_type_cd) - typeRank(b.case_type_cd)
        || (b.filed_date ?? '').localeCompare(a.filed_date ?? ''));
    },
  });
  const rows = q.data ?? [];
  return (
    <SectionCard title="Applications on the portal" description="Appeals, rectifications, objections and waivers filed on the portal">
      {q.isLoading ? <Skeleton className="h-16 w-full" />
        : q.error ? <p className="text-xs text-muted-foreground">Couldn't read the applications: {q.error instanceof Error ? q.error.message : String(q.error)}</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">None read yet — the next sync reads them.</p>
        : (
          <ul className="divide-y">
            {rows.map((a) => (
              <li key={a.id} className="space-y-0.5 py-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium">
                    {a.form_number ? `${a.form_number} · ` : ''}{a.form_description ? sentenceCase(a.form_description) : typeLabel(a.case_type_cd)}
                  </span>
                  {a.status && <ToneBadge tone={statusTone(a.status)} className="shrink-0">{sentenceCase(a.status)}</ToneBadge>}
                </div>
                <div className="break-words text-muted-foreground">
                  {typeLabel(a.case_type_cd)} · ARN <span className="font-mono">{a.arn ?? '—'}</span> · filed {fmtDate(a.filed_date)}
                </div>
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
};

export default PortalApplicationsCard;
