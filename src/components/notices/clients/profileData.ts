// Everything the client profile shows, in one load: the client record, the
// portal's taxpayer profile, sync health, the client's canonical notice set
// (notice_facts: the rows /notices-all?client= lists, so the counts agree),
// refunds and DRC-03 (refund_facts / drc03_facts), case folders, open matters,
// upcoming hearings and filed returns. Tables a database may not have yet
// (taxpayer profile, filed returns) load on their own and fail quietly.
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { loadDrc03Facts, loadRefundFacts, type Drc03Fact, type NoticeFact, type RefundFact } from '@/lib/noticeFacts';
import { loadUpcomingHearings, type HearingItem } from '@/lib/noticeCommandCentre';
import { classify, loadFailureRuns, type ClientBase, type ClientHealth, type FailureRun, type Step, type StepStatus } from './syncHealth';
import type { FolderItem } from './caseFolder';

type Tables = Database['public']['Tables'];
export type TaxpayerProfile = Tables['gst_taxpayer_profile']['Row'];
export type MatterLite = Pick<Tables['litigation_matters']['Row'],
  'id' | 'matter_no' | 'title' | 'stage' | 'status' | 'demand_tax' | 'demand_interest' | 'demand_penalty' | 'demand_cess' | 'paid_total' | 'pre_deposit_total'>;
export interface ClientRecord extends ClientBase { email: string | null; registration_date: string | null }
export interface ClientExtras {
  registration_type: string | null; mobile: string | null;
  target_date_group1: number | null; target_date_group2: number | null;
}
export interface FiledReturn { return_type: string; period_month: string; filed_date: string | null }

export interface ClientProfileData {
  client: ClientRecord | null;
  extras: ClientExtras | null;
  profile: TaxpayerProfile | null;
  health: ClientHealth | null;
  failRun: FailureRun | null;
  notices: NoticeFact[];
  refunds: RefundFact[];
  drc03: Drc03Fact[];
  folders: FolderItem[];
  matters: MatterLite[];
  hearings: HearingItem[];
  /** null when the filed-returns table could not be read. */
  filings: FiledReturn[] | null;
}

/** A refund whose portal status asks the taxpayer for something: a show-cause (RFD-08) or a deficiency memo (RFD-03) (U-57-1). */
export const refundNeedsReply = (r: RefundFact) => !r.is_closed && /rfd[- ]?0?8|rfd[- ]?0?3|show cause|deficiency/i.test(r.status ?? '');

/** Open matters' outstanding, as the command centre counts exposure. */
export const matterOutstanding = (m: MatterLite) => Math.max(0,
  Number(m.demand_tax ?? 0) + Number(m.demand_interest ?? 0) + Number(m.demand_penalty ?? 0) + Number(m.demand_cess ?? 0)
  - Number(m.paid_total ?? 0) - Number(m.pre_deposit_total ?? 0));

export async function loadClientProfile(clientId: string): Promise<ClientProfileData> {
  const [client, extras, profile, steps, notices, refunds, drc03, folders, matters, hearings, filings] = await Promise.all([
    supabase.from('clients').select('id, name, gstin, email, gst_user_id, assigned_accountant, inactive_at_hand, notices_sync_excluded, registration_date')
      .eq('id', clientId).maybeSingle(),
    supabase.from('clients').select('registration_type, mobile, target_date_group1, target_date_group2').eq('id', clientId).maybeSingle(),
    supabase.from('gst_taxpayer_profile').select('*').eq('client_id', clientId).maybeSingle(),
    supabase.from('client_sync_status').select('*').eq('client_id', clientId),
    fetchAllRows<NoticeFact>('notice_facts', '*', (q) => q.eq('client_id', clientId).order('id')),
    loadRefundFacts(clientId),
    loadDrc03Facts(clientId),
    fetchAllRows<FolderItem>('gst_case_folder_items', '*', (q) => q.eq('client_id', clientId).is('deleted_at', null).order('id')),
    supabase.from('litigation_matters')
      .select('id, matter_no, title, stage, status, demand_tax, demand_interest, demand_penalty, demand_cess, paid_total, pre_deposit_total')
      .eq('client_id', clientId).neq('status', 'Closed'),
    loadUpcomingHearings().catch(() => [] as HearingItem[]),
    supabase.from('gst_filed_returns').select('return_type, period_month, filed_date').eq('client_id', clientId).in('return_type', ['GSTR1', 'GSTR3B']),
  ]);
  if (client.error) throw client.error;
  if (steps.error) throw steps.error;
  if (matters.error) throw matters.error;
  const rec = (client.data ?? null) as ClientRecord | null;
  const byStep: Partial<Record<Step, StepStatus>> = {};
  (steps.data ?? []).forEach((s) => { if (s.step) byStep[s.step as Step] = s; });
  const health = rec ? classify(rec, byStep) : null;
  const failRun = health?.failReason ? (await loadFailureRuns([health]).catch(() => new Map<string, FailureRun>())).get(clientId) ?? null : null;
  return {
    client: rec,
    extras: extras.error ? null : (extras.data as ClientExtras | null),
    profile: profile.error ? null : profile.data ?? null,
    health,
    failRun,
    notices,
    refunds,
    drc03,
    folders,
    matters: (matters.data ?? []) as MatterLite[],
    hearings: hearings.filter((h) => h.client_id === clientId),
    filings: filings.error ? null : ((filings.data ?? []) as FiledReturn[]),
  };
}
