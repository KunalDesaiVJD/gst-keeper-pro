// Data and actions for the notice workspace at /notices/:id (roadmap Phase 2
// task 1). Everything a notice page shows is loaded here in one go; every
// action writes as the signed-in staff member, so the database's event
// triggers attribute it (migrations 20261006112000 / 120000 / 121000) and the
// Activity tab, the bell and the alert engine pick it up. Phase 4 adds issue
// codes (reply_issue_types), document requests that serve an issue (from the
// code's list, or typed) and the client e-mail settings the page explains
// (migrations 20261008100000 / 130000).
import { supabase } from '@/integrations/supabase/client';
import type { Database, TablesUpdate } from '@/integrations/supabase/types';
import { addDays, istToday, loadNoticeFact, type NoticeFact, type NoticePlanRow } from '@/lib/noticeFacts';
import { updateNotices, staffEditFields, type NoticeActor } from '@/lib/noticeWrites';
import type { StageKey } from '@/lib/noticeStages';

type Tables = Database['public']['Tables'];
export type NoticeRow = Tables['gst_notices']['Row'];
export type NoticeIssue = Tables['notice_issues']['Row'];
export type NoticeDraft = Tables['notice_drafts']['Row'];
export type DocRequest = Tables['notice_doc_requests']['Row'];
export type NoticePayment = Tables['notice_payments']['Row'];
export type NoticeDocument = Tables['matter_documents']['Row'];
export type FolderItem = Tables['gst_case_folder_items']['Row'];
export type NoticeEvent = Tables['notice_events']['Row'];
export type Deadline = Tables['matter_deadlines']['Row'];
export type MatterRow = Tables['litigation_matters']['Row'];
export type MatterHearing = Tables['matter_hearings']['Row'];
export type Drc03Filing = Pick<Tables['gst_drc03_filings']['Row'],
  'id' | 'arn' | 'cause_of_payment' | 'filed_date' | 'period_from' | 'period_to' | 'cash_amount' | 'credit_amount' | 'status' | 'pdf_url'>;
export type SyncStatus = Database['public']['Views']['client_sync_status']['Row'];

export interface ClientInfo {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
  assigned_accountant: string | null;
}

export interface Workspace {
  fact: (NoticePlanRow | NoticeFact) & Partial<NoticePlanRow>;
  notice: NoticeRow;
  client: ClientInfo | null;
  issues: NoticeIssue[];
  drafts: NoticeDraft[];
  requests: DocRequest[];
  payments: NoticePayment[];
  documents: NoticeDocument[];
  folder: FolderItem[];
  events: NoticeEvent[];
  deadlines: Deadline[];
  matter: MatterRow | null;
  hearings: MatterHearing[];
  drc03: Drc03Filing[];
  related: NoticeFact[];
  sync: SyncStatus[];
}

export class NoticeNotFound extends Error {}

export async function loadWorkspace(id: string): Promise<Workspace> {
  const [fact, noticeRes] = await Promise.all([
    loadNoticeFact(id),
    supabase.from('gst_notices').select('*').eq('id', id).maybeSingle(),
  ]);
  if (noticeRes.error) throw noticeRes.error;
  const notice = noticeRes.data;
  if (!notice || !fact || notice.deleted_at) throw new NoticeNotFound('This notice is not on record (it may have been removed by a portal sync).');

  const caseId = notice.case_id;
  const [client, issues, drafts, requests, payments, documents, folder, events, deadlines, matter, hearings, drc03, related, sync] = await Promise.all([
    supabase.from('clients').select('id, name, gstin, email, assigned_accountant').eq('id', notice.client_id).maybeSingle(),
    supabase.from('notice_issues').select('*').eq('notice_id', id).order('seq').order('created_at'),
    supabase.from('notice_drafts').select('*').eq('notice_id', id).order('version', { ascending: false }),
    supabase.from('notice_doc_requests').select('*').eq('notice_id', id).order('requested_at'),
    supabase.from('notice_payments').select('*').eq('notice_id', id).order('paid_on', { ascending: false, nullsFirst: false }),
    notice.matter_id
      ? supabase.from('matter_documents').select('*').or(`notice_id.eq.${id},matter_id.eq.${notice.matter_id}`).order('created_at', { ascending: false })
      : supabase.from('matter_documents').select('*').eq('notice_id', id).order('created_at', { ascending: false }),
    caseId
      ? supabase.from('gst_case_folder_items').select('*').eq('client_id', notice.client_id).eq('case_id', caseId).is('deleted_at', null)
      : Promise.resolve({ data: [] as FolderItem[], error: null }),
    supabase.from('notice_events').select('*').eq('notice_id', id).order('created_at', { ascending: false }).limit(300),
    supabase.from('matter_deadlines').select('*').eq('notice_id', id).order('deadline_date'),
    notice.matter_id
      ? supabase.from('litigation_matters').select('*').eq('id', notice.matter_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    notice.matter_id
      ? supabase.from('matter_hearings').select('*').eq('matter_id', notice.matter_id).order('scheduled_at')
      : Promise.resolve({ data: [] as MatterHearing[], error: null }),
    supabase.from('gst_drc03_filings')
      .select('id, arn, cause_of_payment, filed_date, period_from, period_to, cash_amount, credit_amount, status, pdf_url')
      .eq('client_id', notice.client_id).is('deleted_at', null).order('filed_date', { ascending: false }).limit(60),
    caseId
      ? supabase.from('notice_facts').select('*').eq('client_id', notice.client_id).eq('case_id', caseId).neq('id', id)
      : supabase.from('notice_facts').select('*').eq('client_id', notice.client_id).neq('id', id).eq('is_open', true)
          .order('issue_date', { ascending: false }).limit(5),
    supabase.from('client_sync_status').select('*').eq('client_id', notice.client_id),
  ]);
  for (const r of [client, issues, drafts, requests, payments, documents, folder, events, deadlines, matter, hearings, drc03, related, sync]) {
    if (r.error) throw r.error;
  }
  return {
    fact: fact as Workspace['fact'],
    notice,
    client: (client.data as ClientInfo | null) ?? null,
    issues: issues.data ?? [],
    drafts: drafts.data ?? [],
    requests: requests.data ?? [],
    payments: payments.data ?? [],
    documents: documents.data ?? [],
    folder: (folder.data as FolderItem[]) ?? [],
    events: events.data ?? [],
    deadlines: deadlines.data ?? [],
    matter: (matter.data as MatterRow | null) ?? null,
    hearings: (hearings.data as MatterHearing[]) ?? [],
    drc03: (drc03.data as Drc03Filing[]) ?? [],
    related: related.data ?? [],
    sync: sync.data ?? [],
  };
}

// ── Notice fields ──────────────────────────────────────────────────────────
async function update(id: string, payload: TablesUpdate<'gst_notices'>, actor: NoticeActor) {
  const { error } = await updateNotices([id], payload, actor);
  if (error) throw new Error(error.message);
}

export const setStage = (id: string, stage: StageKey, actor: NoticeActor, closeReason?: string | null) =>
  update(id, stage === 'closed' ? { stage, close_reason: closeReason ?? null } : { stage }, actor);

export const assignOwner = (id: string, owner: { userId: string; name: string } | null, actor: NoticeActor) =>
  update(id, { assign_to_user_id: owner?.userId ?? null, assign_to: owner?.name ?? null }, actor);

export const setPriority = (id: string, priority: 'High' | 'Medium' | 'Low' | null, actor: NoticeActor) =>
  update(id, { priority }, actor);

export async function logReply(id: string, v: { date: string; ref: string | null; arn: string | null }, actor: NoticeActor) {
  await update(id, {
    reply_date: v.date, reply_ref_number: v.ref,
    submission_arn: v.arn || undefined, submission_date: v.arn ? v.date : undefined,
    stage: 'filed',
  }, actor);
}

export async function logOrder(id: string, v: { date: string; number: string | null; demand: number | null }, actor: NoticeActor) {
  const payload: TablesUpdate<'gst_notices'> = { order_date: v.date, order_number: v.number, stage: 'order' };
  if (v.demand !== null) payload.amount_of_demand = v.demand;
  await update(id, payload, actor);
}

export const setHearing = (id: string, v: { date: string | null; note: string | null }, actor: NoticeActor) =>
  update(id, { hearing_date: v.date, hearing_note: v.note }, actor);

export const setExtension = (id: string, date: string | null, actor: NoticeActor) =>
  update(id, { extended_due_date: date }, actor);

export const setDetails = (id: string, payload: Pick<TablesUpdate<'gst_notices'>, 'amount_of_demand' | 'financial_year' | 'remarks' | 'issued_by'>, actor: NoticeActor) =>
  update(id, payload, actor);

// ── Activity notes ─────────────────────────────────────────────────────────
export async function addComment(notice: Pick<NoticeRow, 'id' | 'client_id'>, text: string, actor: NoticeActor, kind = 'comment') {
  const { error } = await supabase.from('notice_events').insert({
    notice_id: notice.id, client_id: notice.client_id, event_type: kind,
    new_value: { text }, actor_id: actor.id ?? null, actor_name: actor.firstName ?? 'Staff', source: 'staff',
    alert_processed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// ── Issues ─────────────────────────────────────────────────────────────────
export type IssueType = Tables['reply_issue_types']['Row'];

/** The firm's issue codes (reply_issue_types), in their order. Static: cache it. */
export async function loadIssueTypes(): Promise<IssueType[]> {
  const { data, error } = await supabase.from('reply_issue_types').select('*').order('sort').order('code');
  if (error) throw error;
  return data ?? [];
}
export const issueTypesQuery = { queryKey: ['reply-issue-types'], queryFn: loadIssueTypes, staleTime: 10 * 60_000 } as const;

export type IssueInput = Pick<NoticeIssue, 'title' | 'detail' | 'amount' | 'position' | 'annexure' | 'status'>
  & Partial<Pick<NoticeIssue, 'explained_amount' | 'issue_code' | 'period_from' | 'period_to' | 'explained_by'>>;

const ISSUE_FIELDS = ['title', 'detail', 'amount', 'explained_amount', 'position', 'annexure', 'status',
  'issue_code', 'period_from', 'period_to', 'explained_by'] as const;

/**
 * Adds or edits an issue; only the fields staff edit are written. Pass
 * explained_by: null when staff typed the explained amount, so an evidence
 * recipe leaves it alone from then on.
 */
export async function saveIssue(noticeId: string, issue: IssueInput & { id?: string; seq?: number }, actor: NoticeActor) {
  const payload: TablesUpdate<'notice_issues'> = {};
  for (const k of ISSUE_FIELDS) if (issue[k] !== undefined) (payload as Record<string, unknown>)[k] = issue[k];
  if (issue.id) {
    const { error } = await supabase.from('notice_issues').update({ ...payload, updated_by_name: actor.firstName ?? null }).eq('id', issue.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('notice_issues').insert({
    ...payload, title: issue.title, seq: issue.seq, notice_id: noticeId, created_by: actor.id ?? null, created_by_name: actor.firstName ?? null,
  });
  if (error) throw error;
}

export async function deleteIssue(id: string, actor: NoticeActor) {
  // Name the person first so the removal event carries them.
  await supabase.from('notice_issues').update({ updated_by_name: actor.firstName ?? null }).eq('id', id);
  const { error } = await supabase.from('notice_issues').delete().eq('id', id);
  if (error) throw error;
}

// ── Drafts ─────────────────────────────────────────────────────────────────
/** Saves the text: into the open draft, or as the next version when the latest is with / past review. */
export async function saveDraft(noticeId: string, body: string, latest: NoticeDraft | null, actor: NoticeActor, asNewVersion = false) {
  if (latest && !asNewVersion && (latest.status === 'draft' || latest.status === 'changes_requested')) {
    const { error } = await supabase.from('notice_drafts').update({ body, author_id: actor.id ?? null, author_name: actor.firstName ?? null }).eq('id', latest.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('notice_drafts').insert({
    notice_id: noticeId, version: (latest?.version ?? 0) + 1, body,
    author_id: actor.id ?? null, author_name: actor.firstName ?? null,
  });
  if (error) throw error;
}

// ── Reply options (Phase 4b): prepared by the database from the notice's facts,
// issues and annexures when it is fetched or changes (notice_reply_options).
export type ReplyOption = Tables['notice_reply_options']['Row'];

export const replyOptionsKey = (noticeId: string) => ['notice-reply-options', noticeId] as const;

export async function loadReplyOptions(noticeId: string): Promise<ReplyOption[]> {
  const { data, error } = await supabase.from('notice_reply_options').select('*').eq('notice_id', noticeId).order('sort').order('title');
  if (error) throw error;
  return data ?? [];
}

/** Starts the next draft version from an option (notice_reply_option_use); an existing draft is never overwritten. */
export async function startDraftFromOption(optionId: string, actor: NoticeActor): Promise<{ draftId: string | null; version: number | null }> {
  const { data, error } = await supabase.rpc('notice_reply_option_use', {
    p_option_id: optionId, p_author_id: actor.id ?? null, p_author_name: actor.firstName ?? null,
  });
  if (error) throw error;
  const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return { draftId: typeof o.draft_id === 'string' ? o.draft_id : null, version: typeof o.version === 'number' ? o.version : null };
}

/** Prepares the notice's options again from its current facts (forced), returning how many there are. */
export async function refreshReplyOptions(noticeId: string): Promise<number> {
  const { data, error } = await supabase.rpc('notice_reply_options_refresh', { p_notice_id: noticeId, p_force: true });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function setDraftStatus(draft: NoticeDraft, status: 'in_review' | 'approved' | 'changes_requested', actor: NoticeActor, note?: string) {
  const payload: TablesUpdate<'notice_drafts'> = { status };
  if (status === 'in_review') { payload.author_id = actor.id ?? null; payload.author_name = actor.firstName ?? null; }
  else { payload.reviewed_by = actor.id ?? null; payload.reviewed_by_name = actor.firstName ?? null; payload.reviewed_at = new Date().toISOString(); payload.review_note = note ?? null; }
  const { error } = await supabase.from('notice_drafts').update(payload).eq('id', draft.id);
  if (error) throw error;
}

// ── Client documents ───────────────────────────────────────────────────────
export interface DocItem { item: string; issue_id?: string | null; source?: 'manual' | 'catalogue' }

/** Asks for documents; an item from an issue code's list carries the issue and source 'catalogue'. */
export async function requestDocumentItems(noticeId: string, items: DocItem[], due: string | null, actor: NoticeActor) {
  const rows = items.map((d) => ({
    notice_id: noticeId, item: d.item, issue_id: d.issue_id ?? null, source: d.source ?? 'manual',
    due_date: due, requested_by: actor.id ?? null, requested_by_name: actor.firstName ?? null,
  }));
  const { error } = await supabase.from('notice_doc_requests').insert(rows);
  if (error) throw error;
}

export const requestDocuments = (noticeId: string, items: string[], due: string | null, actor: NoticeActor) =>
  requestDocumentItems(noticeId, items.map((item) => ({ item })), due, actor);

/** The firm's deadline for documents: three days before the reply is due, never sooner than two days (notice_doc_due_default). */
export function docDueDefault(effectiveDue: string | null | undefined): string {
  const today = istToday();
  if (!effectiveDue) return addDays(today, 5);
  const d = addDays(effectiveDue, -3);
  const floor = addDays(today, 2);
  return d > floor ? d : floor;
}

export interface CatalogueItem { item: string; issueId: string; issueSeq: number; issueTitle: string }

const docKey = (s: string) => s.trim().toLowerCase();

/** What the open coded issues need that this notice has not asked for yet (the same rule as notice_doc_requests_generate). */
export function catalogueFor(issues: NoticeIssue[], types: IssueType[], asked: string[]): CatalogueItem[] {
  const seen = new Set(asked.map(docKey));
  const out: CatalogueItem[] = [];
  [...issues].sort((a, b) => a.seq - b.seq).forEach((i, n) => {
    if (!i.issue_code || !['open', 'contest'].includes(i.status)) return;
    const t = types.find((x) => x.code === i.issue_code && x.is_active);
    for (const raw of t?.documents ?? []) {
      const item = raw.trim();
      if (!item || seen.has(docKey(item))) continue;
      seen.add(docKey(item));
      out.push({ item, issueId: i.id, issueSeq: n + 1, issueTitle: i.title });
    }
  });
  return out;
}

/** Why "Ask for what the issues need" adds nothing, in one sentence. */
export function catalogueWhyNot(issues: NoticeIssue[], types: IssueType[]): string {
  const open = issues.filter((i) => ['open', 'contest'].includes(i.status));
  const coded = open.filter((i) => i.issue_code);
  if (!issues.length) return 'No issues are listed yet — list them on the Issues tab first.';
  if (!open.length) return 'Every issue is explained or marked to pay, so nothing more is needed from the client.';
  if (!coded.length) return 'No open issue has an issue type — set the type on the Issues tab to get its document list.';
  const listed = coded.filter((i) => (types.find((t) => t.code === i.issue_code)?.documents ?? []).length > 0);
  if (!listed.length) return 'The issue types on this notice list no client documents.';
  return 'Everything the issues need is already asked for.';
}

export interface GenerateResult { added: number; items: string[]; dueDate: string | null; error?: string }

/** Adds, for every open coded issue, the documents its code lists that are not asked yet (notice_doc_requests_generate). */
export async function generateDocRequests(noticeId: string, actor: NoticeActor): Promise<GenerateResult> {
  const { data, error } = await supabase.rpc('notice_doc_requests_generate', {
    p_notice_id: noticeId, p_actor_id: actor.id ?? null, p_actor_name: actor.firstName ?? null,
  });
  if (error) throw error;
  const o = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return {
    added: Number(o.added ?? 0),
    items: Array.isArray(o.items) ? o.items.map(String) : [],
    dueDate: typeof o.due_date === 'string' ? o.due_date : null,
    error: typeof o.error === 'string' ? o.error : undefined,
  };
}

export interface ClientEmailSettings { mode: string | null; e12Active: boolean | null; maxRepeats: number | null; cooldownHrs: number | null }

/** Whether client e-mails (alert E12) go out: the alert engine's mode and the rule's own switch and ladder. */
export async function loadClientEmailSettings(): Promise<ClientEmailSettings> {
  const [s, r] = await Promise.all([
    supabase.from('notice_settings').select('alerts_mode').maybeSingle(),
    supabase.from('notice_alert_rules').select('is_active, max_repeats, cooldown_hrs').eq('alert_key', 'E12_client_docs').maybeSingle(),
  ]);
  return {
    mode: s.error ? null : s.data?.alerts_mode ?? null,
    e12Active: r.error || !r.data ? null : r.data.is_active,
    maxRepeats: r.data?.max_repeats ?? null,
    cooldownHrs: r.data?.cooldown_hrs ?? null,
  };
}
export const clientEmailSettingsQuery = { queryKey: ['client-email-settings'], queryFn: loadClientEmailSettings, staleTime: 60_000 } as const;

/** One honest line on automatic reminders. */
export function reminderNote(s: ClientEmailSettings | undefined): string | null {
  if (!s || s.mode === null) return null;
  if (s.mode === 'off' || s.e12Active === false) {
    return 'Automatic reminders are off: e-mails to clients are switched off, so nothing goes to the client by itself.';
  }
  const ladder = `up to ${s.maxRepeats ?? 3}, at least ${s.cooldownHrs ?? 72} h apart`;
  if (s.mode === 'preview') {
    return `Reminders go by themselves on the E12 ladder (${ladder}) only when client e-mails are live. They are in preview now: written to the outbox, not sent to the client.`;
  }
  return `Reminders go to the client by themselves on the E12 ladder: ${ladder}, once a request is due within a day or was asked three days ago.`;
}

export async function resolveRequest(id: string, status: 'received' | 'waived' | 'requested', actor: NoticeActor, note?: string | null, documentId?: string | null) {
  const { error } = await supabase.from('notice_doc_requests').update({
    status, note: note ?? null,
    resolved_by_name: status === 'requested' ? null : actor.firstName ?? null,
    resolved_at: status === 'requested' ? null : new Date().toISOString(),
    ...(documentId !== undefined ? { document_id: documentId } : {}),
  }).eq('id', id);
  if (error) throw error;
}

export interface DocEmailResult { sent: boolean; reason?: string; mode?: string; open?: number; to?: string }

/** E-mails the client the open requests (a preview while alerts are in preview). */
export async function emailDocumentRequests(noticeId: string, actor: NoticeActor, reminder = false): Promise<DocEmailResult> {
  const { data, error } = await supabase.rpc('notice_request_documents_send', {
    p_notice_id: noticeId, p_actor_id: actor.id ?? null, p_actor_name: actor.firstName ?? 'Staff', p_reminder: reminder,
  });
  if (error) throw error;
  return (data ?? { sent: false }) as unknown as DocEmailResult;
}

/** What happened to a client e-mail, as one line for a toast (the same wording everywhere). */
export function docEmailOutcome(r: DocEmailResult, what: 'request' | 'reminder'): { tone: 'success' | 'warning' | 'info'; text: string } {
  const noun = what === 'request' ? 'Request' : 'Reminder';
  if (r.sent) {
    return r.mode === 'live'
      ? { tone: 'success', text: `${noun} e-mailed to ${r.to}.` }
      : { tone: 'success', text: `${noun} written to the outbox as a preview; nothing was sent.` };
  }
  if (r.reason === 'no_client_email') return { tone: 'warning', text: 'The client has no e-mail on file — add it in Edit Client.' };
  if (r.reason === 'nothing_open') return { tone: 'info', text: 'Nothing to chase: every request is in.' };
  // Notice e-mails switched off (the mode, or the client-documents rule): nothing is written.
  return {
    tone: 'info',
    text: `Not e-mailed: e-mails to clients are switched off. ${what === 'request' ? 'The request is saved on the notice.' : 'The open requests stay on the notice.'}`,
  };
}

// ── Payments ───────────────────────────────────────────────────────────────
export async function linkPayment(noticeId: string, p: { kind: 'drc03' | 'pre_deposit' | 'other'; drc03_arn?: string | null; amount: number; paid_on: string | null; note?: string | null }, actor: NoticeActor) {
  const { error } = await supabase.from('notice_payments').insert({ ...p, notice_id: noticeId, created_by_name: actor.firstName ?? null });
  if (error) throw error;
}

export async function unlinkPayment(id: string) {
  const { error } = await supabase.from('notice_payments').delete().eq('id', id);
  if (error) throw error;
}

// ── Documents ──────────────────────────────────────────────────────────────
const BUCKET = 'return-pdfs';

export async function uploadDocument(notice: Pick<NoticeRow, 'id' | 'client_id' | 'matter_id'>, file: File, kind: string, actor: NoticeActor): Promise<string> {
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `notices/${notice.client_id}/uploads/${notice.id}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('matter_documents').insert({
    notice_id: notice.id, matter_id: notice.matter_id ?? null, kind, title: file.name, storage_path: path,
    mime: file.type || null, size_bytes: file.size, source: 'upload',
    uploaded_by: actor.id ?? null, uploaded_by_name: actor.firstName ?? null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export function documentUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// ── Deadlines ──────────────────────────────────────────────────────────────
export async function markDeadlineMet(id: string, met: boolean, actor: NoticeActor) {
  const { error } = await supabase.from('matter_deadlines').update({
    is_met: met, met_at: met ? new Date().toISOString() : null, met_by: met ? actor.firstName ?? 'Staff' : null,
  }).eq('id', id);
  if (error) throw error;
}

export async function overrideDeadline(id: string, date: string, note: string | null) {
  const { error } = await supabase.from('matter_deadlines').update({ deadline_date: date, source: 'override', notes: note }).eq('id', id);
  if (error) throw error;
}

/** Staff fields a direct table write must carry so the triggers can name the person. */
export const editStamp = staffEditFields;
