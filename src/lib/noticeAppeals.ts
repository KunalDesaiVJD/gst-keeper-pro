// The Appeal workspace of a case (the firm's request of 25 October 2026): the
// case's appeals (notice_case_appeals, migration 20261025170000), each keyed
// by the order it is against, and for each its three documents (statement of
// facts, grounds of appeal, detailed written submission) kept in versions
// (notice_appeal_drafts). The notice assistant drafts or improves a document
// in the Edge Function notice-ai (action appeal) and keeps its answer as a new
// version; staff edit, save and mark a version final. Nothing is filed by the
// app. Read §33 of docs/NOTICES_LITIGATION_POSITIONS.md first.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { ASSIST_REFUSALS } from '@/lib/noticeAi';

export type AppealDocType = 'facts' | 'grounds' | 'submission';
export type AppealDraft = Database['public']['Tables']['notice_appeal_drafts']['Row'];
export type AppealRun = Database['public']['Tables']['notice_appeal_ai_runs']['Row'];

export const APPEAL_DOCS: { key: AppealDocType; label: string; hint: string }[] = [
  { key: 'facts', label: 'Statement of facts', hint: 'The facts in the order they happened, filed with APL 01.' },
  { key: 'grounds', label: 'Grounds of appeal', hint: 'Each ground on which the order is challenged, with the relief sought, filed with APL 01.' },
  { key: 'submission', label: 'Written submission', hint: 'The detailed argument for the hearing: each ground with its facts, evidence and law.' },
];
export const appealDocLabel = (k: string) => APPEAL_DOCS.find((d) => d.key === k)?.label ?? k;

export interface AppealDraftHead { version: number; status: 'draft' | 'final'; source: 'ai' | 'staff'; at: string; by: string | null }
export interface CaseAppeal {
  appeal_key: string;
  status: 'filed' | 'to_file';
  arn?: string;
  filed_on?: string;
  portal_status?: string;
  order_ref?: string;
  order_date?: string;
  order_comm_date?: string;
  order_form?: string;
  order_notice_id?: string;
  last_day?: string;
  disputed_tax?: number;
  disputed_total?: number;
  predeposit?: number;
  predeposit_pct?: number;
  second_appeal?: boolean;
  issues?: string[];
  demand?: number;
  drafts?: Partial<Record<AppealDocType, AppealDraftHead>>;
}

export const caseAppealsKey = (clientId: string, caseKey: string) => ['notice-case-appeals', clientId, caseKey] as const;
export function useCaseAppeals(clientId: string, caseKey: string | null | undefined) {
  return useQuery({
    queryKey: caseAppealsKey(clientId, caseKey ?? ''),
    enabled: !!clientId && !!caseKey,
    staleTime: 60_000,
    queryFn: async (): Promise<CaseAppeal[]> => {
      const { data, error } = await supabase.rpc('notice_case_appeals', { p_client_id: clientId, p_case_key: caseKey as string });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as CaseAppeal[];
    },
  });
}

const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Which appeals the Appeal view offers: every appeal filed, and an order not
 * yet appealed while it can still be (three months and the one of
 * condonation, s.107(1) and (4)) or once a draft for it exists.
 */
export function appealsShown(all: CaseAppeal[] | undefined, today = new Date().toISOString().slice(0, 10)): CaseAppeal[] {
  return (all ?? []).filter((a) => a.status === 'filed'
    || Object.keys(a.drafts ?? {}).length > 0
    || (a.last_day ? addMonths(a.last_day, 1) >= today : false));
}

export const appealDraftsKey = (clientId: string, appealKey: string) => ['notice-appeal-drafts', clientId, appealKey] as const;
export async function loadAppealDrafts(clientId: string, appealKey: string): Promise<AppealDraft[]> {
  const { data, error } = await supabase.from('notice_appeal_drafts')
    .select('id, client_id, case_key, appeal_key, doc_type, version, body, status, source, run_id, author_name, created_at')
    .eq('client_id', clientId).eq('appeal_key', appealKey)
    .order('version', { ascending: false }).limit(150);
  if (error) throw error;
  return (data ?? []) as AppealDraft[];
}

export const appealRunsKey = (clientId: string, appealKey: string) => ['notice-appeal-runs', clientId, appealKey] as const;
export function useAppealRuns(clientId: string, appealKey: string) {
  return useQuery({
    queryKey: appealRunsKey(clientId, appealKey),
    enabled: !!clientId && !!appealKey,
    queryFn: async (): Promise<AppealRun[]> => {
      const { data, error } = await supabase.from('notice_appeal_ai_runs').select('*')
        .eq('client_id', clientId).eq('appeal_key', appealKey).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
    // While the assistant is drafting, look again every few seconds.
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === 'running') ? 5_000 : false),
  });
}

const APPEAL_REFUSALS: Record<string, string> = {
  ...ASSIST_REFUSALS,
  busy: 'The assistant is already drafting this document; its answer comes in a minute or two.',
  not_found: 'This appeal is no longer on record for the case.',
  no_text: 'There is no text to improve yet: draft it first, or type it and save.',
  gone: 'This appeal is no longer on record.',
};
export const appealRefusal = (code: string | null | undefined) => (code ? APPEAL_REFUSALS[code] ?? `The assistant could not start (${code}).` : null);

/** Ask the assistant to draft (or improve) one document; it answers in the background. */
export async function startAppealDraft(v: {
  clientId: string; caseKey: string; appealKey: string; docType: AppealDocType; mode: 'draft' | 'improve';
  text?: string | null; instructions?: string | null; actor: string | null;
}): Promise<{ runId: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('notice-ai', {
    body: {
      action: 'appeal', client_id: v.clientId, case_key: v.caseKey, appeal_key: v.appealKey, doc_type: v.docType, mode: v.mode,
      text: v.text ?? null, instructions: v.instructions ?? null, actor: v.actor,
    },
  });
  if (error) return { runId: null, error: 'The notice-ai Edge Function could not be reached. Try again in a minute.' };
  const d = (data ?? {}) as { run_id?: string; error?: string; id?: string; status?: string };
  if (d.error) return { runId: null, error: appealRefusal(d.error) };
  return { runId: d.run_id ?? d.id ?? null, error: d.status === 'failed' ? 'The assistant could not draft this time.' : null };
}

/** Save the text as a new version; refused when someone saved a newer one meanwhile. */
export async function saveAppealDraft(v: {
  clientId: string; caseKey: string; appealKey: string; docType: AppealDocType; body: string; status: 'draft' | 'final';
  expectVersion: number; actor: string | null;
}): Promise<{ version: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc('notice_appeal_draft_save', {
    p_client_id: v.clientId, p_case_key: v.caseKey, p_appeal_key: v.appealKey, p_doc_type: v.docType, p_body: v.body,
    p_status: v.status, p_expect_version: v.expectVersion, p_actor: v.actor,
  });
  if (error) return { version: null, error: error.message };
  const d = (data ?? {}) as { version?: number; error?: string };
  if (d.error === 'stale') return { version: d.version ?? null, error: `Someone saved version ${d.version} meanwhile. Reload it before saving, so nothing is lost.` };
  if (d.error === 'empty') return { version: null, error: 'There is nothing to save.' };
  if (d.error) return { version: null, error: `The draft was not saved (${d.error}).` };
  return { version: d.version ?? null, error: null };
}

/** What the assistant's answer said besides the text: questions for the client, cautions, precedents used. */
export function runNotes(run: AppealRun | null | undefined): { questions: string[]; cautions: string[]; precedents: { id: string; title: string; kind: string; same_client: boolean }[] } {
  const o = (run?.output && typeof run.output === 'object' ? run.output : {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);
  const used = new Set<string>(strs(o.precedents_used));
  for (const s of Array.isArray(o.sections) ? o.sections : []) for (const id of strs((s as Record<string, unknown>)?.precedents_used)) used.add(id);
  const given = (Array.isArray(run?.precedents) ? run?.precedents : []) as Record<string, unknown>[];
  return {
    questions: strs(o.client_questions),
    cautions: strs(o.cautions),
    precedents: given.filter((p) => used.has(String(p.id))).map((p) => ({
      id: String(p.id), title: String(p.title ?? ''), kind: String(p.kind ?? ''), same_client: p.same_client === true,
    })),
  };
}

/** The document as a Word file (.docx), one paragraph per line block. */
export async function downloadAppealDocx(fileName: string, title: string, body: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');
  const blocks = body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const first = blocks[0] === title ? blocks.slice(1) : blocks;
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: title, bold: true, size: 28 })] }),
        ...first.map((b) => {
          // A short block with no full stop reads as a heading.
          const heading = b.length <= 120 && !/[.:;]$/.test(b) && !b.includes('\n');
          return new Paragraph({
            spacing: { after: 160, line: 320 },
            alignment: heading ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
            children: b.split('\n').flatMap((line, i) => [
              ...(i ? [new TextRun({ text: '', break: 1 })] : []),
              new TextRun({ text: line, bold: heading }),
            ]),
          });
        }),
      ],
    }],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.docx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
