// A cancellation the client asked for (section C of the law audit of 26 Oct
// 2026, L7). A REG-19 that follows the client's own REG-16 needs nothing done:
// it is closed as information. One that follows a REG-17 or REG-31 is the
// officer's own (suo motu) and stays open for revocation (REG-21) or appeal.
// The portal's REG-19 does not say which, so the page reads the client's
// papers: a REG-16 among its portal applications, or no REG-17 or REG-31 in the
// 18 months before. Closing stays a person's click (§36).
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/gstr9/ui';
import { WS_BTN } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { addDays } from '@/lib/noticeFacts';
import { fmtDate } from '@/lib/noticeFormat';
import type { Workspace } from '@/lib/noticeWorkspace';

type Basis = { kind: 'applied'; arn: string | null; on: string | null } | { kind: 'no_scn' } | { kind: 'suo_motu' };

async function cancellationBasis(clientId: string, issue: string): Promise<Basis> {
  const [apps, scn] = await Promise.all([
    supabase.from('gst_portal_applications').select('arn, filed_date, form_number').eq('client_id', clientId).is('deleted_at', null)
      .ilike('form_number', '%REG%16%').lte('filed_date', issue).order('filed_date', { ascending: false }).limit(1),
    supabase.from('gst_notices').select('id').eq('client_id', clientId).is('deleted_at', null).in('form_code', ['REG-17', 'REG-31'])
      .gte('issue_date', addDays(issue, -548)).lte('issue_date', issue).limit(1),
  ]);
  if (apps.error) throw apps.error;
  if (scn.error) throw scn.error;
  const a = apps.data?.[0];
  if (a) return { kind: 'applied', arn: a.arn, on: a.filed_date };
  return (scn.data?.length ?? 0) > 0 ? { kind: 'suo_motu' } : { kind: 'no_scn' };
}

export const VoluntaryCancelNote: React.FC<{ ws: Workspace; canClose: boolean; onClose: (reason: string) => void }> = ({ ws, canClose, onClose }) => {
  const n = ws.notice;
  const on = n.form_code === 'REG-19' && n.stage !== 'closed' && !!n.issue_date;
  const q = useQuery({ queryKey: ['notice-reg19-basis', n.id], queryFn: () => cancellationBasis(n.client_id, n.issue_date as string), enabled: on, staleTime: 10 * 60_000 });
  if (!on || !q.data || q.data.kind === 'suo_motu') return null;
  const b = q.data;
  const line = b.kind === 'applied'
    ? `The client applied for this cancellation (REG-16${b.arn ? ` ${b.arn}` : ''}${b.on ? ` of ${fmtDate(b.on)}` : ''}). Nothing is to be answered; close it as information. The final return (GSTR-10) is due within three months of this order (s.45).`
    : 'No show cause notice for cancellation (REG-17 or REG-31) is on record in the 18 months before this order, so it reads as a cancellation the client applied for. If so, close it as information; the final return (GSTR-10) is due within three months of the order (s.45). If the officer cancelled it, keep it open: revocation (REG-21) or appeal.';
  return (
    <Note tone="info" open>
      <span className="inline-flex flex-wrap items-center gap-2">{line}
        {canClose && (
          <Button size="sm" variant="outline" className={WS_BTN}
            onClick={() => onClose(b.kind === 'applied' ? 'Cancellation applied for by the client (REG-16); information only' : 'Cancellation read as applied for by the client; no REG-17 or REG-31 on record')}>
            Close as information
          </Button>
        )}
      </span>
    </Note>
  );
};
