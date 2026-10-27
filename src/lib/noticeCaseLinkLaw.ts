// Linking notice cases by the shape GST law gives a proceeding (the firm, 27
// October 2026: two DRC-01s were linked into one case for Unity; "make some
// more stringent or stricter rules for linking ... We may also use AI ...
// should warn atleast for anything which is unusual"). Migration
// 20261027140000, §37 of docs/NOTICES_LITIGATION_POSITIONS.md.
//
// notice_case_link_check says what a link would break: "law" (two show cause
// proceedings in one case, the registration bucket, a circle) or "unusual".
// Every link a person makes goes through notice_case_link_set_checked /
// notice_case_review_decide_checked, which link at once only when nothing is
// wrong; otherwise they answer "confirm" with the problems, and the page asks
// the person (a reason of ten letters or more against the law) and sends the
// link again with it. The database refuses a link against the law without one,
// whatever screen sends it. The AI (Edge Function notice-link-ai, Sonnet at
// medium effort) gives a second opinion on request; it never links.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type LinkProblemLevel = 'law' | 'unusual';
export interface LinkProblem { code: string; level: LinkProblemLevel; text: string }
export interface LinkCheck {
  against_law: boolean;
  unusual: boolean;
  problems: LinkProblem[];
  proceedings: { case_key: string; scn_ref: string | null; first_date: string | null; financial_year: string | null; order_ref: string | null }[];
  shared_numbers: number;
}
export interface LinkPair { clientId: string; childKey: string; parentKey: string; kind: string | null }

/** A reason given to link against the law must be at least this long (the database asks the same). */
export const MIN_OVERRIDE_REASON = 10;

const needsMigration = (m: string) => /notice_case_link_(check|set_checked|review_decide_checked|checks)/.test(m);
const MIGRATION = 'Linking checks need migration 20261027140000_notice_case_link_law.sql on the database.';

const asCheck = (v: unknown): LinkCheck | null => {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<LinkCheck>;
  return { against_law: !!c.against_law, unusual: !!c.unusual, problems: c.problems ?? [], proceedings: c.proceedings ?? [], shared_numbers: c.shared_numbers ?? 0 };
};

export async function checkLink(p: LinkPair): Promise<LinkCheck | null> {
  const { data, error } = await supabase.rpc('notice_case_link_check', {
    p_client_id: p.clientId, p_child_key: p.childKey, p_parent_key: p.parentKey, p_kind: p.kind,
  });
  if (error) throw new Error(needsMigration(error.message) ? MIGRATION : error.message);
  return asCheck(data);
}

/** The check of several pairs at once (at most 40), keyed child>parent>kind. */
export async function checkLinks(pairs: LinkPair[]): Promise<Map<string, LinkCheck>> {
  const out = new Map<string, LinkCheck>();
  if (!pairs.length) return out;
  const { data, error } = await supabase.rpc('notice_case_link_checks', {
    p_items: pairs.slice(0, 40).map((p) => ({ client_id: p.clientId, child_key: p.childKey, parent_key: p.parentKey, kind: p.kind })),
  });
  if (error) {
    // An older database has no checks: the page works as before, without the warnings.
    if (needsMigration(error.message)) return out;
    throw error;
  }
  for (const r of (Array.isArray(data) ? data : []) as { client_id: string; child_key: string; parent_key: string; kind: string | null; check: unknown }[]) {
    const c = asCheck(r.check);
    if (c) out.set(pairKey({ clientId: r.client_id, childKey: r.child_key, parentKey: r.parent_key, kind: r.kind }), c);
  }
  return out;
}

export const pairKey = (p: LinkPair) => `${p.clientId}:${p.childKey}>${p.parentKey}:${p.kind ?? 'related'}`;

export function useLinkChecks(pairs: LinkPair[], enabled = true) {
  const key = pairs.map(pairKey).join('|');
  return useQuery({
    queryKey: ['notice-case-link-checks', key],
    queryFn: () => checkLinks(pairs),
    enabled: enabled && pairs.length > 0,
    staleTime: 60_000,
  });
}

export type GuardedStatus = 'linked' | 'confirm' | 'reason_needed';
export interface GuardedResult { status: GuardedStatus; check: LinkCheck | null }

/** Link through the law check: linked, or the problems to put to the person (send again with confirm). */
export async function setCaseLinkChecked(p: LinkPair, by: string | null, confirm: string | null): Promise<GuardedResult> {
  const { data, error } = await supabase.rpc('notice_case_link_set_checked', {
    p_client_id: p.clientId, p_child_key: p.childKey, p_parent_key: p.parentKey, p_kind: p.kind, p_by: by, p_confirm: confirm,
  });
  if (error) throw new Error(needsMigration(error.message) ? MIGRATION : error.message);
  const d = (data ?? {}) as { status?: GuardedStatus; check?: unknown };
  return { status: d.status ?? 'linked', check: asCheck(d.check) };
}

/** A review list decision to link, through the law check (other decisions pass straight through). */
export async function decideReviewChecked(item: { client_id: string; issue: string; child_key: string }, parentKey: string, kind: string | null,
  by: string | null, confirm: string | null): Promise<GuardedResult> {
  const { data, error } = await supabase.rpc('notice_case_review_decide_checked', {
    p_client_id: item.client_id, p_issue: item.issue, p_child_key: item.child_key, p_parent_key: parentKey,
    p_decision: 'link', p_kind: kind, p_by: by, p_confirm: confirm,
  });
  if (error) throw new Error(needsMigration(error.message) ? MIGRATION : error.message);
  const d = (data ?? {}) as { status?: string; check?: unknown };
  return { status: d.status === 'confirm' || d.status === 'reason_needed' ? d.status : 'linked', check: asCheck(d.check) };
}

export interface LinkOpinion { verdict: 'link' | 'keep_apart' | 'unsure'; kind: string; confidence: number; reasons: string[]; law: string[] }

/** The AI's second opinion on a pair (notice-link-ai); advice only. */
export async function askLinkAi(p: LinkPair, actor: string | null): Promise<{ opinion: LinkOpinion | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('notice-link-ai', {
    body: { client_id: p.clientId, child_key: p.childKey, parent_key: p.parentKey, kind: p.kind, actor },
  });
  if (error) return { opinion: null, error: 'The AI could not be reached. Try again in a minute.' };
  const d = (data ?? {}) as { opinion?: LinkOpinion; error?: string };
  if (d.error || !d.opinion) return { opinion: null, error: d.error ?? 'The AI gave no answer.' };
  return { opinion: d.opinion, error: null };
}

export const AI_VERDICT: Record<LinkOpinion['verdict'], { label: string; tone: 'success' | 'destructive' | 'warning' }> = {
  link: { label: 'Belong together', tone: 'success' },
  keep_apart: { label: 'Keep apart', tone: 'destructive' },
  unsure: { label: 'Not sure', tone: 'warning' },
};
