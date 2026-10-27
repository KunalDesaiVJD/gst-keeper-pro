// The order checker on the Appeal view (section C of the law audit of 26 Oct
// 2026): the order appealed read against its show cause notice, the time limit
// of its year and the hearings of the case (src/lib/noticeOrderCheck.ts). Each
// failure is a ground of appeal, which goes into the AI's guidance for the
// grounds, or is copied.
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, HelpCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/gstr9/ui';
import { SectionCard } from '@/components/notices/ui/Panel';
import { WS_BTN } from '@/components/workspace/theme';
import { supabase } from '@/integrations/supabase/client';
import { useCaseOverview } from '@/lib/noticeCases';
import { checkOrder, groundsText, orderRecord, type CheckPaper, type OrderCheck, type OrderCheckInput } from '@/lib/noticeOrderCheck';
import { cn } from '@/lib/utils';

const PAPER = 'id, form_code, section_of_law, financial_year, period_from, period_to, issue_date, reference_number, demand, hearing_date, case_id, source';

type PaperRow = CheckPaper & { id: string; case_id: string | null; source?: string | null };

async function loadOrderCheck(clientId: string, orderNoticeId: string): Promise<Omit<OrderCheckInput, 'din'> | null> {
  const o = await supabase.from('gst_notices').select(PAPER).eq('id', orderNoticeId).maybeSingle();
  if (o.error) throw o.error;
  const order = o.data as unknown as PaperRow | null;
  if (!order) return null;
  const [folder, papers, lim] = await Promise.all([
    order.reference_number
      ? supabase.from('gst_case_folder_items').select('raw_json').eq('client_id', clientId).eq('reference_number', order.reference_number).is('deleted_at', null).limit(1)
      : Promise.resolve({ data: [], error: null }),
    order.case_id
      ? supabase.from('gst_notices').select(PAPER).eq('client_id', clientId).eq('case_id', order.case_id).is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
    order.financial_year
      ? supabase.from('gst_limitation_years').select('fy, s73_order_by, s74_order_by, s73_basis').eq('fy', order.financial_year).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (folder.error) throw folder.error;
  if (papers.error) throw papers.error;
  const raw = (folder.data as { raw_json: unknown }[] | null)?.[0]?.raw_json ?? null;
  const rec = orderRecord(raw);
  let rows = (papers.data as unknown as PaperRow[] | null) ?? [];
  // The SCN the order names, else the case's latest DRC-01 before it.
  let scn: PaperRow | null = null;
  if (rec.scnRef) {
    scn = rows.find((r) => r.reference_number === rec.scnRef) ?? null;
    if (!scn) {
      const s = await supabase.from('gst_notices').select(PAPER).eq('client_id', clientId).eq('reference_number', rec.scnRef).is('deleted_at', null).limit(1);
      if (s.error) throw s.error;
      scn = ((s.data as unknown as PaperRow[] | null) ?? [])[0] ?? null;
      if (scn?.case_id && scn.case_id !== order.case_id) {
        const more = await supabase.from('gst_notices').select(PAPER).eq('client_id', clientId).eq('case_id', scn.case_id).is('deleted_at', null);
        if (more.error) throw more.error;
        rows = [...rows, ...((more.data as unknown as PaperRow[] | null) ?? [])];
      }
    }
  }
  if (!scn) {
    scn = rows.filter((r) => r.form_code === 'DRC-01' && r.issue_date && (!order.issue_date || r.issue_date <= order.issue_date))
      .sort((a, b) => (b.issue_date ?? '').localeCompare(a.issue_date ?? ''))[0] ?? null;
  }
  const hearings = rows.flatMap((r) => [r.hearing_date, r.form_code === 'ADJOURNMENT' ? r.issue_date : null]).filter((d): d is string => !!d);
  return {
    order: { ...order, raw, manual: !raw && (order.source === 'manual' || (order.reference_number ?? '').startsWith('manual:')) },
    scn, hearings,
    limitation: (lim.data as OrderCheckInput['limitation']) ?? null,
  };
}

const ICON: Record<OrderCheck['status'], React.ReactNode> = {
  ok: <CheckCircle2 className="h-4 w-4 text-success" aria-label="Passes" />,
  issue: <AlertTriangle className="h-4 w-4 text-destructive" aria-label="Fails: a ground of appeal" />,
  check: <HelpCircle className="h-4 w-4 text-warning" aria-label="To check by hand" />,
};

export const OrderCheckPanel: React.FC<{ clientId: string; caseKey: string; orderNoticeId: string; onUseGrounds?: (text: string) => void }> = ({ clientId, caseKey, orderNoticeId, onUseGrounds }) => {
  const q = useQuery({ queryKey: ['notice-order-check', clientId, orderNoticeId], queryFn: () => loadOrderCheck(clientId, orderNoticeId), staleTime: 60_000 });
  const ov = useCaseOverview(clientId, caseKey);
  const din = ov.data?.fields.din?.value ?? null;
  const checks = q.data ? checkOrder({ ...q.data, din }) : [];
  const grounds = groundsText(checks);
  const issues = checks.filter((c) => c.status === 'issue').length;
  const toCheck = checks.filter((c) => c.status === 'check').length;
  return (
    <SectionCard title="Order check"
      description={q.isLoading ? 'Reading the order' : issues ? `${issues} ground${issues === 1 ? '' : 's'} of appeal found${toCheck ? `, ${toCheck} to check by hand` : ''}` : toCheck ? `${toCheck} to check by hand` : 'Nothing found against the order'}
      info="The order is read against its show cause notice (section, period, tax head by head), the penalty its section allows, the time limit of its year, the hearings on record and its DIN or portal reference. A failure is a ground of appeal: use it in the grounds the AI drafts, or copy it. The check reads only what is on record; the papers decide."
      actions={grounds ? <>
        {onUseGrounds && <Button size="sm" variant="outline" className={WS_BTN} onClick={() => onUseGrounds(grounds)}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Use in the grounds
        </Button>}
        <Button size="sm" variant="ghost" className={WS_BTN}
          onClick={() => navigator.clipboard.writeText(grounds).then(() => toast.success('Copied.'), () => toast.error('Could not copy.'))}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy grounds
        </Button>
      </> : undefined}>
      {q.error ? <Note tone="warn">Couldn't read the order: {q.error instanceof Error ? q.error.message : String(q.error)}</Note>
        : q.isLoading ? <Skeleton className="h-24 w-full" />
        : !q.data ? <Note tone="info">The order is not on record as a notice, so it cannot be checked here.</Note>
        : (
          <ul className="divide-y">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2 py-1.5">
                <span className="mt-0.5 shrink-0">{ICON[c.status]}</span>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-sm', c.status === 'issue' && 'font-medium')}>{c.title} <span className="text-xs text-muted-foreground">{c.law}</span></div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
};

export default OrderCheckPanel;
