// Saving evidence and acting on it: a recipe run becomes a version in
// reply_annexures through reply_annexure_save (same inputs → nothing new;
// built without a click → generated_by_name 'Auto'), missing portal data is
// queued on the office agent (autopilot_enqueue, origin 'evidence'), and the
// notice's tax period can be set when it is missing. buildEvidenceForNotice is
// the batch entry point (the Reply Factory's "Build evidence" button).
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { updateNotices, type NoticeActor } from '@/lib/noticeWrites';
import { describeEnqueue, friendlyDbError, type EnqueueResult } from '@/lib/autopilot';
import type { FetchPlanItem } from './types';
import type { EvidenceCard } from './evidence';
import { loadEvidence, type SavedAnnexure } from './load';
import { fyOfPeriod, isPeriod, periodEndIso, periodStartIso, sortPeriods } from './periods';

export interface SaveOutcome { id: string | null; version: number | null; unchanged: boolean; error?: string }

/** The current saved version of a card, if any. */
export const currentOf = (card: EvidenceCard, saved: SavedAnnexure[]): SavedAnnexure | undefined =>
  saved.find((a) => a.isCurrent && a.recipe === card.plan.recipe && (a.issueId ?? null) === (card.plan.issue?.id ?? null));

/** No version yet, or the inputs (or the status they lead to) changed since the current one. */
export const needsSave = (card: EvidenceCard, saved: SavedAnnexure[]): boolean => {
  const cur = currentOf(card, saved);
  return !cur || cur.inputsHash !== card.hash || cur.status !== card.result.status;
};

/** Saves a card as the next version (actorName null → 'Auto'). */
export async function saveCard(card: EvidenceCard, actorName: string | null): Promise<SaveOutcome> {
  const r = card.result;
  // The annexure records what it explains; the RPC moves an issue's explained amount only when an issue is named.
  const computed = r.status === 'ready' || r.status === 'partial';
  const { data, error } = await supabase.rpc('reply_annexure_save', {
    p_notice_id: card.ctx.notice.id,
    p_issue_id: card.plan.issue?.id ?? null,
    p_recipe_key: r.recipe,
    p_status: r.status,
    p_title: r.title,
    p_periods: r.periods,
    p_financial_year: r.financialYear,
    p_summary: r.summary as unknown as Json,
    p_tables: r.tables as unknown as Json,
    p_readiness: r.readiness as unknown as Json,
    p_inputs_hash: card.hash,
    p_explained: computed ? r.explained : null,
    p_to_pay: r.toPay,
    p_actor_name: actorName,
  });
  // Two people opening the notice at once: the other one saved this very version first.
  if (error?.code === '23505') return { id: null, version: null, unchanged: true };
  if (error) return { id: null, version: null, unchanged: false, error: error.message };
  const d = (data ?? {}) as { id?: string; version?: number; unchanged?: boolean; error?: string };
  if (d.error) return { id: null, version: null, unchanged: false, error: d.error === 'gone' ? 'The notice is no longer on record.' : d.error };
  return { id: d.id ?? null, version: d.version ?? null, unchanged: !!d.unchanged };
}

export interface BuildOutcome {
  noticeId: string;
  cards: { recipe: string; issueId: string | null; status: string; saved: boolean; version: number | null; error?: string }[];
  /** A saved version changed an issue's explained amount (reload the notice). */
  touchedIssues: boolean;
  error?: string;
}

/** Saves every card that needs it (auto: only new / changed inputs; a click saves all, unchanged ones stay as they are). */
export async function saveCards(cards: EvidenceCard[], saved: SavedAnnexure[], opts: { auto: boolean; actorName?: string | null }): Promise<Omit<BuildOutcome, 'noticeId'>> {
  const out: BuildOutcome['cards'] = [];
  let touched = false;
  for (const card of cards) {
    if (opts.auto && !needsSave(card, saved)) {
      out.push({ recipe: card.plan.recipe, issueId: card.plan.issue?.id ?? null, status: card.result.status, saved: false, version: currentOf(card, saved)?.version ?? null });
      continue;
    }
    const r = await saveCard(card, opts.auto ? null : opts.actorName ?? null);
    if (!r.error && !r.unchanged && card.plan.issue && card.result.explained !== null) touched = true;
    out.push({ recipe: card.plan.recipe, issueId: card.plan.issue?.id ?? null, status: card.result.status, saved: !r.error && !r.unchanged, version: r.version, ...(r.error ? { error: r.error } : {}) });
  }
  return { cards: out, touchedIssues: touched };
}

/**
 * Builds and saves a notice's evidence. auto: true saves only what is new or
 * changed, as 'Auto' (what the Evidence tab does on open, and the Reply
 * Factory's batch button); auto: false saves every card as the named person.
 */
export async function buildEvidenceForNotice(noticeId: string, opts: { auto: boolean; actorName?: string | null }): Promise<BuildOutcome> {
  try {
    const b = await loadEvidence(noticeId);
    const r = await saveCards(b.cards, b.saved, opts);
    return { noticeId, ...r };
  } catch (e) {
    return { noticeId, cards: [], touchedIssues: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The batch: builds several notices' evidence one after another (or a few at a
 * time), reporting progress. For the Reply Factory's "Build evidence" button.
 */
export async function buildEvidenceForNotices(
  noticeIds: string[],
  opts: { auto: boolean; actorName?: string | null; concurrency?: number },
  onProgress?: (done: number, total: number, last: BuildOutcome) => void,
): Promise<BuildOutcome[]> {
  const out: BuildOutcome[] = [];
  const queue = [...noticeIds];
  const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 2, 4)) }, async () => {
    while (queue.length) {
      const id = queue.shift() as string;
      const r = await buildEvidenceForNotice(id, opts);
      out.push(r);
      onProgress?.(out.length, noticeIds.length, r);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── The notice's tax period ────────────────────────────────────────────────
/** Sets period_from / period_to (first and last day) and, within one FY, financial_year — as the signed-in person. */
export async function setNoticePeriod(noticeId: string, from: string, to: string, actor: NoticeActor): Promise<void> {
  if (!isPeriod(from) || !isPeriod(to)) throw new Error('Pick the first and last month of the period.');
  const [a, b] = sortPeriods([from, to]).length === 2 ? sortPeriods([from, to]) : [from, from];
  const payload: { period_from: string; period_to: string; financial_year?: string } = { period_from: periodStartIso(a), period_to: periodEndIso(b) };
  if (fyOfPeriod(a) === fyOfPeriod(b)) payload.financial_year = fyOfPeriod(a);
  const { error } = await updateNotices([noticeId], payload, actor);
  if (error) throw new Error(error.message);
}

// ── Missing data → the office agent ────────────────────────────────────────
/** All cards' fetch plans as one per mode. */
export function mergePlans(plans: FetchPlanItem[][]): FetchPlanItem[] {
  const byMode = new Map<string, FetchPlanItem>();
  for (const p of plans.flat()) {
    const cur = byMode.get(p.mode) ?? { mode: p.mode, label: p.label, periods: [] };
    cur.periods = sortPeriods([...cur.periods, ...p.periods]);
    byMode.set(p.mode, cur);
  }
  return [...byMode.values()];
}

export interface QueueOutcome { ok: boolean; tone: 'success' | 'info' | 'warning'; text: string }

/** Queues FETCH_REPORT jobs for one client, one per pull mode with its periods (origin 'evidence'). */
export async function queueMissing(clientId: string, plan: FetchPlanItem[], actor: { id?: string | null; firstName?: string | null } | null): Promise<QueueOutcome> {
  if (!plan.length) return { ok: true, tone: 'info', text: 'Nothing is missing.' };
  const uuid = actor?.id && /^[0-9a-f-]{36}$/i.test(actor.id) ? actor.id : null;
  const total: EnqueueResult = { queued: 0, already: 0, run_id: null, eligible: 0, out_of_scope: 0, skipped: { no_credentials: 0, excluded: 0, inactive: 0 } };
  for (const item of plan) {
    const { data, error } = await supabase.rpc('autopilot_enqueue', {
      p_client_ids: [clientId], p_job_type: 'FETCH_REPORT', p_payload: { mode: item.mode, periods: item.periods },
      p_origin: 'evidence', p_priority: null, p_requested_by: uuid, p_requested_by_name: actor?.firstName ?? null, p_scope: 'all',
    });
    if (error) return { ok: false, tone: 'warning', text: friendlyDbError(error.message) };
    const d = (data ?? {}) as Partial<EnqueueResult>;
    total.queued += Number(d.queued ?? 0);
    total.already += Number(d.already ?? 0);
    total.skipped.no_credentials = Math.max(total.skipped.no_credentials, Number(d.skipped?.no_credentials ?? 0));
  }
  if (total.skipped.no_credentials && !total.queued && !total.already) {
    return { ok: false, tone: 'warning', text: 'Not queued: the client has no portal login saved. Add it on the client’s page.' };
  }
  const words = describeEnqueue(total);
  return {
    ok: true, tone: words.tone,
    text: total.queued
      ? `Queued ${total.queued} fetch${total.queued === 1 ? '' : 'es'} for the autopilot${total.already ? ` (${total.already} already in the queue)` : ''}. The evidence rebuilds when the data arrives and this tab is opened.`
      : total.already ? 'Already in the autopilot’s queue.' : words.text,
  };
}
