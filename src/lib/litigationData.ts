import { supabase } from '@/integrations/supabase/client';

export interface LitigationMatter {
  id: string;
  client_id: string;
  matter_no: string;
  lifecycle: string;
  title: string | null;
  section_of_law: string | null;
  financial_years: string[] | null;
  authority: string | null;
  officer: string | null;
  jurisdiction: string | null;
  stage: string;
  status: string;
  priority: string | null;
  owner_user_id: string | null;
  reviewer_user_id: string | null;
  demand_tax: number;
  demand_interest: number;
  demand_penalty: number;
  demand_cess: number;
  paid_total: number;
  pre_deposit_total: number;
  computed_due_date: string | null;
  override_due_date: string | null;
  limitation_date: string | null;
  hearing_at: string | null;
  next_action: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
  client_name?: string;
  client_gstin?: string;
  owner_name?: string;
  notice_count?: number;
}

export interface MatterFilters {
  status?: string;
  lifecycle?: string;
  stage?: string;
  clientId?: string;
  ownerId?: string;
}

interface MatterEventInsert {
  matter_id: string;
  notice_id?: string | null;
  event_type: string;
  actor_user_id?: string | null;
  actor_name?: string | null;
  payload?: Record<string, unknown> | null;
}

interface HearingInsert {
  matter_id: string;
  scheduled_at: string;
  mode?: string | null;
  venue?: string | null;
  officer?: string | null;
  attended_by?: string[] | null;
  outcome?: string | null;
  adjourned?: boolean;
  next_date?: string | null;
  notes?: string | null;
}

interface PaymentInsert {
  matter_id: string;
  kind?: string;
  drc03_arn?: string | null;
  tax?: number;
  interest?: number;
  penalty?: number;
  cess?: number;
  paid_on?: string | null;
  remarks?: string | null;
}

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function sortMatters(rows: LitigationMatter[]): LitigationMatter[] {
  return rows.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? ''] ?? 3;
    const pb = PRIORITY_ORDER[b.priority ?? ''] ?? 3;
    if (pa !== pb) return pa - pb;
    const da = a.override_due_date ?? a.computed_due_date ?? '';
    const db = b.override_due_date ?? b.computed_due_date ?? '';
    if (da && db) return da.localeCompare(db);
    if (da) return -1;
    if (db) return 1;
    return 0;
  });
}

export async function fetchMatters(
  filters?: MatterFilters,
): Promise<{ data: LitigationMatter[] | null; error: any }> {
  let query = supabase
    .from('litigation_matters')
    .select('*, clients(name, gstin)');

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.lifecycle) query = query.eq('lifecycle', filters.lifecycle);
  if (filters?.stage) query = query.eq('stage', filters.stage);
  if (filters?.clientId) query = query.eq('client_id', filters.clientId);
  if (filters?.ownerId) query = query.eq('owner_user_id', filters.ownerId);

  const { data, error } = await query;
  if (error || !data) return { data: null, error };

  const ownerIds = [...new Set(data.map((r: any) => r.owner_user_id).filter(Boolean))];
  let ownerMap = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, first_name')
      .in('user_id', ownerIds);
    (profiles ?? []).forEach((p) => ownerMap.set(p.user_id, p.first_name));
  }

  const matterIds = data.map((r: any) => r.id);
  let noticeCounts = new Map<string, number>();
  if (matterIds.length > 0) {
    const { data: notices } = await supabase
      .from('gst_notices')
      .select('matter_id')
      .in('matter_id', matterIds)
      .is('deleted_at', null);
    (notices ?? []).forEach((n: any) => {
      noticeCounts.set(n.matter_id, (noticeCounts.get(n.matter_id) ?? 0) + 1);
    });
  }

  const mapped: LitigationMatter[] = data.map((r: any) => {
    const { clients, ...rest } = r;
    return {
      ...rest,
      client_name: clients?.name ?? undefined,
      client_gstin: clients?.gstin ?? undefined,
      owner_name: ownerMap.get(r.owner_user_id) ?? undefined,
      notice_count: noticeCounts.get(r.id) ?? 0,
    };
  });

  return { data: sortMatters(mapped), error: null };
}

export async function fetchMatter(
  id: string,
): Promise<{ data: LitigationMatter | null; error: any }> {
  const { data, error } = await supabase
    .from('litigation_matters')
    .select('*, clients(name, gstin)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return { data: null, error };

  let ownerName: string | undefined;
  if (data.owner_user_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('user_id', data.owner_user_id)
      .maybeSingle();
    ownerName = profile?.first_name ?? undefined;
  }

  const { count } = await supabase
    .from('gst_notices')
    .select('id', { count: 'exact', head: true })
    .eq('matter_id', id)
    .is('deleted_at', null);

  const { clients, ...rest } = data as any;
  return {
    data: {
      ...rest,
      client_name: clients?.name ?? undefined,
      client_gstin: clients?.gstin ?? undefined,
      owner_name: ownerName,
      notice_count: count ?? 0,
    },
    error: null,
  };
}

export async function generateMatterNo(
  clientId: string,
): Promise<{ data: string | null; error: any }> {
  const year = new Date().getFullYear();
  const prefix = `M-${year}-`;

  const { data: existing, error } = await supabase
    .from('litigation_matters')
    .select('matter_no')
    .like('matter_no', `${prefix}%`)
    .order('matter_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { data: null, error };

  let seq = 1;
  if (existing?.matter_no) {
    const parts = existing.matter_no.split('-');
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }

  return { data: `${prefix}${String(seq).padStart(4, '0')}`, error: null };
}

export async function createMatter(
  input: {
    client_id: string;
    lifecycle?: string;
    title?: string | null;
    section_of_law?: string | null;
    financial_years?: string[] | null;
    authority?: string | null;
    officer?: string | null;
    jurisdiction?: string | null;
    stage?: string;
    priority?: string | null;
    owner_user_id?: string | null;
    reviewer_user_id?: string | null;
    demand_tax?: number;
    demand_interest?: number;
    demand_penalty?: number;
    demand_cess?: number;
    next_action?: string | null;
    computed_due_date?: string | null;
    override_due_date?: string | null;
    limitation_date?: string | null;
  },
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ data: LitigationMatter | null; error: any }> {
  const { data: matterNo, error: noErr } = await generateMatterNo(input.client_id);
  if (noErr || !matterNo) return { data: null, error: noErr ?? new Error('Failed to generate matter_no') };

  const { data, error } = await supabase
    .from('litigation_matters')
    .insert({ ...input, matter_no: matterNo })
    .select()
    .single();

  if (error || !data) return { data: null, error };

  await supabase.from('matter_events').insert({
    matter_id: data.id,
    event_type: 'created',
    actor_user_id: actorId ?? null,
    actor_name: actorName ?? null,
    payload: { matter_no: matterNo, lifecycle: data.lifecycle, stage: data.stage },
  });

  return { data: data as LitigationMatter, error: null };
}

export async function updateMatter(
  id: string,
  changes: Record<string, unknown>,
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ data: LitigationMatter | null; error: any }> {
  const { data: before, error: fetchErr } = await supabase
    .from('litigation_matters')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !before) return { data: null, error: fetchErr ?? new Error('Matter not found') };

  const { data, error } = await supabase
    .from('litigation_matters')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) return { data: null, error };

  if (changes.stage && changes.stage !== (before as any).stage) {
    await supabase.from('matter_stage_history').insert({
      matter_id: id,
      from_stage: (before as any).stage,
      to_stage: changes.stage as string,
      changed_by: actorId ?? null,
    });

    await logMatterEvent({
      matter_id: id,
      event_type: 'stage_changed',
      actor_user_id: actorId ?? null,
      actor_name: actorName ?? null,
      payload: { from: (before as any).stage, to: changes.stage },
    });
  }

  const trackedFields = [
    'title', 'lifecycle', 'section_of_law', 'authority', 'officer',
    'jurisdiction', 'priority', 'owner_user_id', 'reviewer_user_id',
    'demand_tax', 'demand_interest', 'demand_penalty', 'demand_cess',
    'next_action', 'computed_due_date', 'override_due_date', 'limitation_date',
    'financial_years',
  ];

  for (const field of trackedFields) {
    if (!(field in changes)) continue;
    if (field === 'stage') continue;
    const oldVal = (before as any)[field];
    const newVal = changes[field];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;

    await logMatterEvent({
      matter_id: id,
      event_type: 'field_changed',
      actor_user_id: actorId ?? null,
      actor_name: actorName ?? null,
      payload: { field, from: oldVal, to: newVal },
    });
  }

  return { data: data as LitigationMatter, error: null };
}

export async function closeMatter(
  id: string,
  reason: string,
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ error: any }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('litigation_matters')
    .update({ status: 'Closed', closed_at: now, closed_reason: reason, updated_at: now })
    .eq('id', id);

  if (error) return { error };

  await logMatterEvent({
    matter_id: id,
    event_type: 'closed',
    actor_user_id: actorId ?? null,
    actor_name: actorName ?? null,
    payload: { reason },
  });

  return { error: null };
}

export async function reopenMatter(
  id: string,
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ error: any }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('litigation_matters')
    .update({ status: 'Open', closed_at: null, closed_reason: null, updated_at: now })
    .eq('id', id);

  if (error) return { error };

  await logMatterEvent({
    matter_id: id,
    event_type: 'reopened',
    actor_user_id: actorId ?? null,
    actor_name: actorName ?? null,
  });

  return { error: null };
}

export async function linkNoticesToMatter(
  matterId: string,
  noticeIds: string[],
): Promise<{ error: any }> {
  for (const noticeId of noticeIds) {
    const { error } = await supabase
      .from('gst_notices')
      .update({ matter_id: matterId })
      .eq('id', noticeId);
    if (error) return { error };
  }

  await logMatterEvent({
    matter_id: matterId,
    event_type: 'notices_linked',
    payload: { notice_ids: noticeIds, count: noticeIds.length },
  });

  return { error: null };
}

export async function unlinkNotice(
  noticeId: string,
): Promise<{ error: any }> {
  const { data: notice } = await supabase
    .from('gst_notices')
    .select('matter_id')
    .eq('id', noticeId)
    .maybeSingle();

  const { error } = await supabase
    .from('gst_notices')
    .update({ matter_id: null })
    .eq('id', noticeId);

  if (error) return { error };

  if (notice?.matter_id) {
    await logMatterEvent({
      matter_id: notice.matter_id,
      event_type: 'notice_unlinked',
      payload: { notice_id: noticeId },
    });
  }

  return { error: null };
}

export async function fetchMatterNotices(
  matterId: string,
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabase
    .from('gst_notices')
    .select(
      'id, case_id, notice_type, description, issue_date, due_date, extended_due_date, ' +
      'staff_status, status, amount_of_demand, reference_number, financial_year, ' +
      'reply_date, order_date, order_number',
    )
    .eq('matter_id', matterId)
    .is('deleted_at', null)
    .order('issue_date', { ascending: false });

  return { data: data ?? null, error };
}

export async function fetchMatterEvents(
  matterId: string,
  limit = 50,
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_events')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return { data: data ?? null, error };
}

export async function fetchMatterHearings(
  matterId: string,
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_hearings')
    .select('*')
    .eq('matter_id', matterId)
    .order('scheduled_at', { ascending: false });

  return { data: data ?? null, error };
}

export async function addHearing(
  input: HearingInsert,
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ data: any | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_hearings')
    .insert(input)
    .select()
    .single();

  if (error || !data) return { data: null, error };

  await logMatterEvent({
    matter_id: input.matter_id,
    event_type: 'hearing_added',
    actor_user_id: actorId ?? null,
    actor_name: actorName ?? null,
    payload: { scheduled_at: input.scheduled_at, venue: input.venue ?? null },
  });

  if (input.scheduled_at) {
    await supabase
      .from('litigation_matters')
      .update({ hearing_at: input.scheduled_at, updated_at: new Date().toISOString() })
      .eq('id', input.matter_id);
  }

  return { data, error: null };
}

export async function fetchMatterPayments(
  matterId: string,
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_payments')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false });

  return { data: data ?? null, error };
}

export async function addPayment(
  input: PaymentInsert,
  actorId?: string | null,
  actorName?: string | null,
): Promise<{ data: any | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_payments')
    .insert(input)
    .select()
    .single();

  if (error || !data) return { data: null, error };

  const total = (input.tax ?? 0) + (input.interest ?? 0) + (input.penalty ?? 0) + (input.cess ?? 0);

  const { data: matter } = await supabase
    .from('litigation_matters')
    .select('paid_total, pre_deposit_total')
    .eq('id', input.matter_id)
    .maybeSingle();

  if (matter) {
    const isPreDeposit = input.kind === 'pre_deposit';
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (isPreDeposit) {
      updates.pre_deposit_total = (matter.pre_deposit_total ?? 0) + total;
    } else {
      updates.paid_total = (matter.paid_total ?? 0) + total;
    }
    await supabase.from('litigation_matters').update(updates).eq('id', input.matter_id);
  }

  await logMatterEvent({
    matter_id: input.matter_id,
    event_type: 'payment_added',
    actor_user_id: actorId ?? null,
    actor_name: actorName ?? null,
    payload: {
      kind: input.kind ?? 'payment',
      tax: input.tax ?? 0,
      interest: input.interest ?? 0,
      penalty: input.penalty ?? 0,
      cess: input.cess ?? 0,
      total,
    },
  });

  return { data, error: null };
}

export async function fetchMatterDocuments(
  matterId: string,
): Promise<{ data: any[] | null; error: any }> {
  const { data, error } = await supabase
    .from('matter_documents')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false });

  return { data: data ?? null, error };
}

export async function fetchLitigationRules(): Promise<{
  data: Map<string, { value: number; unit: string }> | null;
  error: any;
}> {
  const { data, error } = await supabase
    .from('litigation_rules')
    .select('key, value, unit');

  if (error || !data) return { data: null, error };

  const map = new Map<string, { value: number; unit: string }>();
  data.forEach((r) => map.set(r.key, { value: r.value, unit: r.unit }));
  return { data: map, error: null };
}

interface SuggestedMatter {
  case_id: string;
  notices: any[];
  suggested_title: string;
  suggested_lifecycle: string;
}

const LIFECYCLE_HINTS: Record<string, string> = {
  'DRC-01': 'Assessment',
  'DRC-01A': 'Assessment',
  'ASMT-10': 'Scrutiny',
  'ASMT-12': 'Scrutiny',
  'DRC-07': 'Demand',
  'DRC-08': 'Demand',
  'MOV-07': 'Seizure',
  'MOV-09': 'Seizure',
  'MOV-10': 'Seizure',
  'ADT-01': 'Audit',
  'ADT-02': 'Audit',
  'ADT-04': 'Audit',
};

function inferLifecycle(types: string[]): string {
  for (const t of types) {
    const upper = (t ?? '').toUpperCase().trim();
    for (const [prefix, lifecycle] of Object.entries(LIFECYCLE_HINTS)) {
      if (upper.startsWith(prefix)) return lifecycle;
    }
  }
  return 'Assessment';
}

export async function suggestMatters(): Promise<{
  data: SuggestedMatter[] | null;
  error: any;
}> {
  const { data: notices, error } = await supabase
    .from('gst_notices')
    .select(
      'id, case_id, client_id, notice_type, description, issue_date, due_date, ' +
      'staff_status, amount_of_demand, financial_year, matter_id',
    )
    .is('deleted_at', null)
    .is('matter_id', null)
    .not('case_id', 'is', null)
    .order('issue_date', { ascending: true });

  if (error || !notices) return { data: null, error };

  const groups = new Map<string, any[]>();
  for (const n of notices) {
    if (!n.case_id) continue;
    const key = `${n.client_id}::${n.case_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const suggestions: SuggestedMatter[] = [];
  for (const [, group] of groups) {
    if (group.length < 1) continue;
    const types = group.map((n: any) => n.notice_type).filter(Boolean);
    const firstType = types[0] ?? 'Notice';
    const fy = group[0].financial_year ?? '';
    suggestions.push({
      case_id: group[0].case_id,
      notices: group,
      suggested_title: `${firstType}${fy ? ` - FY ${fy}` : ''}`,
      suggested_lifecycle: inferLifecycle(types),
    });
  }

  suggestions.sort((a, b) => b.notices.length - a.notices.length);
  return { data: suggestions, error: null };
}

async function logMatterEvent(params: MatterEventInsert): Promise<void> {
  await supabase.from('matter_events').insert({
    matter_id: params.matter_id,
    notice_id: params.notice_id ?? null,
    event_type: params.event_type,
    actor_user_id: params.actor_user_id ?? null,
    actor_name: params.actor_name ?? null,
    payload: params.payload ?? null,
  });
}
