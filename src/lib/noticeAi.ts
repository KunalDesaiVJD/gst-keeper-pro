// Notice Response AI Assistant (Notices Phase 7; migration 20261009100000 and the
// Edge Function notice-ai): what the notice page's Assistant tab and the Reply
// Factory's AI and Learning tabs read and write. The assistant runs in the Edge
// Function (it reaches Claude through the Claude CLI gateway, or the API key); the database decides who may be
// read, what an answer may use and what the firm's examples are. Read
// docs/REPLY_FACTORY_POSITIONS.md §13 before changing a rule here.
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { fmtAgo } from '@/lib/noticeFormat';

type Tables = Database['public']['Tables'];
export type AssistRun = Tables['ai_assist_runs']['Row'];
export type AiDocument = Tables['ai_documents']['Row'];
export type LearningPair = Tables['ai_learning_pairs']['Row'];
export type LearningResponse = Database['public']['Views']['ai_learning_responses']['Row'];
export type AssistMode = 'draft' | 'ask' | 'improve';

export interface AssistParagraph {
  issue_seq: number;
  heading: string;
  text: string;
  examples_used: string[];
}
export interface AssistOutput {
  answer: string;
  paragraphs: AssistParagraph[];
  client_questions: string[];
  cautions: string[];
  examples_used: string[];
}
export interface AssistExample {
  id: string;
  for_issue: string | number | null;
  issue_code: string | null;
  form_code: string | null;
  issue_title: string | null;
  allegation: string;
  response: string;
  origin: string;
  verified: boolean;
}

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function assistOutput(run: Pick<AssistRun, 'output'> | null | undefined): AssistOutput {
  const o = obj(run?.output);
  return {
    answer: str(o.answer),
    paragraphs: arr(o.paragraphs).map((p) => {
      const x = obj(p);
      return { issue_seq: Number(x.issue_seq) || 0, heading: str(x.heading), text: str(x.text), examples_used: arr(x.examples_used).map(String) };
    }).filter((p) => p.text.trim() !== ''),
    client_questions: arr(o.client_questions).map(String).filter(Boolean),
    cautions: arr(o.cautions).map(String).filter(Boolean),
    examples_used: arr(o.examples_used).map(String),
  };
}

export function assistExamples(run: Pick<AssistRun, 'examples'> | null | undefined): AssistExample[] {
  return arr(run?.examples).map((e) => {
    const x = obj(e);
    return {
      id: str(x.id), for_issue: (x.for_issue as string | number | null) ?? null, issue_code: str(x.issue_code) || null,
      form_code: str(x.form_code) || null, issue_title: str(x.issue_title) || null, allegation: str(x.allegation),
      response: str(x.response), origin: str(x.origin), verified: x.verified === true,
    };
  }).filter((e) => e.id);
}

/** Why the assistant could not answer, in words. */
export const ASSIST_REFUSALS: Record<string, string> = {
  off: 'AI is switched off. A GST manager switches it on under Reply Factory, AI.',
  no_consent: 'This client has no AI consent on file (Reply Factory, Client consent).',
  opted_out: 'This client asked that nothing of theirs be processed by AI.',
  capped: "Today's assistant spending cap is reached. Try tomorrow, or raise the cap under Reply Factory, AI.",
  no_key: 'Supabase has no way to reach Claude yet: set CLAUDE_CLI_GATEWAY_URL and CLAUDE_CLI_GATEWAY_SECRET (or ANTHROPIC_API_KEY) in Edge Functions, Secrets.',
  gone: 'This notice is no longer on record.',
  no_question: 'Type a question first.',
  no_text: 'Paste the text to improve first.',
  bad_request: 'The request was not understood.',
};

export const assistRefusal = (code: string | null | undefined) => (code ? ASSIST_REFUSALS[code] ?? `The assistant could not answer (${code}).` : null);

export interface AssistResult {
  run: AssistRun | null;
  error: string | null;
}

/** One question to the assistant, answered when the Edge Function is done (up to a minute or two). */
export async function askAssistant(v: {
  noticeId: string;
  mode: AssistMode;
  issueId?: string | null;
  question?: string | null;
  text?: string | null;
  actor?: string | null;
}): Promise<AssistResult> {
  const { data, error } = await supabase.functions.invoke('notice-ai', {
    body: { action: 'assist', notice_id: v.noticeId, mode: v.mode, issue_id: v.issueId ?? null, question: v.question ?? null, text: v.text ?? null, actor: v.actor ?? null },
  });
  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/not found|404|failed to send|fetch/i.test(msg)) {
      return { run: null, error: 'The notice-ai Edge Function is not deployed yet, or could not be reached.' };
    }
    return { run: null, error: msg };
  }
  const d = obj(data);
  if (typeof d.error === 'string' && !d.id) return { run: null, error: assistRefusal(d.error) };
  const run = d as unknown as AssistRun;
  if (run.status === 'failed') return { run, error: run.error ?? 'The assistant could not answer.' };
  return { run, error: null };
}

/** What staff did with an answer: used paragraphs (as edited) become the firm's examples. */
export async function assistFeedback(runId: string, action: 'used' | 'discarded', items: { issue_id: string | null; text: string }[], actor: string | null) {
  const { data, error } = await supabase.rpc('ai_assist_feedback', {
    p_run_id: runId, p_action: action, p_items: items as unknown as Json, p_actor: actor,
  });
  if (error) throw error;
  return data ?? 0;
}

export const assistRunsKey = (noticeId: string) => ['ai-assist-runs', noticeId] as const;
export async function loadAssistRuns(noticeId: string, limit = 6): Promise<AssistRun[]> {
  const { data, error } = await supabase.from('ai_assist_runs').select('*').eq('notice_id', noticeId)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export const caseDocsKey = (noticeId: string) => ['ai-case-docs', noticeId] as const;
/** The case's documents as the AI holds them (not what staff typed). */
export async function loadCaseDocuments(clientId: string, caseId: string | null, noticeId: string): Promise<AiDocument[]> {
  let q = supabase.from('ai_documents').select('*').eq('client_id', clientId).neq('source', 'workspace');
  q = caseId ? q.or(`case_id.eq.${caseId},notice_id.eq.${noticeId}`) : q.eq('notice_id', noticeId);
  const { data, error } = await q.order('priority', { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function requestCaseDocuments(noticeId: string): Promise<number> {
  const { data, error } = await supabase.rpc('ai_documents_request', { p_notice_id: noticeId });
  if (error) throw error;
  return data ?? 0;
}

export async function retryDocuments(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('ai_documents_retry', { p_ids: ids });
  if (error) throw error;
  return data ?? 0;
}

/** Wakes the reader now instead of at the next two-minute tick. */
export async function runReaderNow(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('notice-ai', { body: { action: 'tick' } });
  if (error) throw new Error('The notice-ai Edge Function is not deployed yet, or could not be reached.');
  const d = obj(data);
  return d.started ? 'The reader is running.' : d.ran === false ? `The reader did not run (${str(d.reason) || 'busy'}).` : 'The reader ran.';
}

// ── Learning ───────────────────────────────────────────────────────────────
export type Phase = 'all' | 'past' | 'ongoing';
export type Chosen = 'all' | 'yes' | 'no';
export interface LearningFilter {
  client: string | null;
  fy: string | null;
  form: string | null;
  phase: Phase;
  chosen: Chosen;
  q: string;
}

export const learningKey = (f: LearningFilter, page: number) => ['ai-learning', f, page] as const;

export async function loadLearningResponses(f: LearningFilter, page: number, pageSize = 50): Promise<{ rows: LearningResponse[]; total: number }> {
  let q = supabase.from('ai_learning_responses').select('*', { count: 'exact' });
  if (f.client) q = q.eq('client_id', f.client);
  if (f.fy) q = q.eq('financial_year', f.fy);
  if (f.form) q = q.eq('form_code', f.form);
  if (f.phase !== 'all') q = q.eq('phase', f.phase);
  if (f.chosen !== 'all') q = q.eq('learning_included', f.chosen === 'yes');
  const t = f.q.trim().replace(/[%,()]/g, ' ');
  if (t) q = q.or(`client_name.ilike.%${t}%,notice_ref.ilike.%${t}%,label.ilike.%${t}%,title.ilike.%${t}%`);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await q.order('response_date', { ascending: false, nullsFirst: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** The values the filters offer (from every response, not just the page shown). */
export async function loadLearningFacets(): Promise<{ clients: { id: string; name: string }[]; fys: string[]; forms: string[] }> {
  const { data, error } = await supabase.from('ai_learning_responses').select('client_id, client_name, financial_year, form_code').limit(5000);
  if (error) throw error;
  const clients = new Map<string, string>();
  const fys = new Set<string>();
  const forms = new Set<string>();
  for (const r of data ?? []) {
    if (r.client_id) clients.set(r.client_id, r.client_name ?? r.client_id);
    if (r.financial_year) fys.add(r.financial_year);
    if (r.form_code) forms.add(r.form_code);
  }
  return {
    clients: [...clients].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    fys: [...fys].sort().reverse(),
    forms: [...forms].sort(),
  };
}

export async function loadPairs(documentId: string): Promise<LearningPair[]> {
  const { data, error } = await supabase.from('ai_learning_pairs')
    .select('id, document_id, client_id, notice_id, issue_id, case_id, origin, form_code, section_of_law, financial_year, issue_code, issue_title, allegation, response, ai_text, seq, page, verified, outcome, included, decided_by_name, decided_at, uses, last_used_at, created_at, updated_at')
    .eq('document_id', documentId).order('seq', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as LearningPair[];
}

export async function setResponsesIncluded(ids: string[], include: boolean, actor: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('ai_learning_select', { p_document_ids: ids, p_include: include, p_actor: actor });
  if (error) throw error;
  return data ?? 0;
}

export async function setResponsesIncludedWhere(clientIds: string[] | null, phase: Phase, include: boolean, actor: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('ai_learning_select_where', {
    p_client_ids: clientIds, p_phase: phase === 'all' ? null : phase, p_include: include, p_actor: actor,
  });
  if (error) throw error;
  return data ?? 0;
}

export async function setPairsIncluded(ids: string[], include: boolean, actor: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('ai_learning_pair_set', { p_pair_ids: ids, p_include: include, p_actor: actor });
  if (error) throw error;
  return data ?? 0;
}

// ── Words ──────────────────────────────────────────────────────────────────
export const RESPONSE_SOURCE: Record<string, string> = {
  folder: 'Filed on the portal',
  draft: 'Approved draft',
  workspace: 'Typed on the notice page',
};
export const PAIR_ORIGIN: Record<string, string> = {
  portal_reply: 'Filed reply',
  draft: 'Draft',
  position: 'Position typed',
  assistant_edit: 'Assistant, as edited',
};
export const DOC_ROLE: Record<string, string> = {
  notice: 'Notice', reply: 'Reply', reply_support: 'Reply annexure', order: 'Order', application: 'Application', other: 'Other',
};
export const DOC_STATUS: Record<string, string> = {
  queued: 'Waiting', running: 'Reading', done: 'Read', failed: 'Failed', skipped: 'Skipped', cancelled: 'Not read',
};

export interface RunnerStatus {
  last_tick_at: string | null;
  last_work_at: string | null;
  last_error: string | null;
  key_ok: boolean | null;
  version: string | null;
}

export function runnerWords(r: RunnerStatus | null | undefined, enabled: boolean): { tone: 'success' | 'warning' | 'destructive' | 'secondary'; text: string } {
  if (!r || !r.last_tick_at) return enabled
    ? { tone: 'warning', text: 'Edge Function has not run yet' }
    : { tone: 'secondary', text: 'Edge Function idle' };
  if (r.key_ok === false) return { tone: 'destructive', text: 'API key missing or refused' };
  const ago = fmtAgo(r.last_tick_at);
  return Date.now() - Date.parse(r.last_tick_at) < 15 * 60_000
    ? { tone: 'success', text: `Ran ${ago}` }
    : { tone: enabled ? 'warning' : 'secondary', text: `Last ran ${ago}` };
}
