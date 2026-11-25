// The GST Assistant's call to its Edge Function (gst-assistant, 23 Nov 2026).
import { supabase } from '@/integrations/supabase/client';
import { currentActorId } from '@/lib/changeLogHeaders';
import { ASSISTANT_SCREENS } from './screens.generated';
import type { PageSnapshot } from './pageSnapshot';
import { forRequest, type Attachment } from './attachments';

export type AssistantAction =
  | { id: string; kind: 'navigate'; route: string; client_id?: string; period?: string; tab?: string; reason: string }
  | { id: string; kind: 'guide'; title: string; origin?: string; steps: { route?: string; target?: string; instruction: string }[] }
  | { id: string; kind: 'fill'; title: string; summary: string; fields: { target: string; value: string; row?: string; current?: string }[]; save_button?: string };

export interface AssistantAnswer {
  ok: boolean;
  error?: string;
  conversationId?: string;
  reply?: string;
  actions?: AssistantAction[];
  history?: unknown[];
  usage?: { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number };
  knowledge?: { docs: number; commit: string | null };
}

// The screens as the model reads them: short, without empty fields.
const SCREENS = ASSISTANT_SCREENS.filter((s) => !s.redirectsTo).map((s) => {
  const o: Record<string, unknown> = { route: s.route };
  if (s.menu) o.menu = s.menu;
  if (s.title) o.title = s.title;
  if (s.subtitle) o.about = s.subtitle;
  if (s.tabs.length) o.tabs = s.tabs;
  if (s.buttons.length) o.buttons = s.buttons.slice(0, 20);
  // A screen in tabs: each tab with what it shows, so a step names the tab first.
  if (s.sections.length) o.sections = s.sections.map((x) => ({ tab: x.tab, ...(x.tabs.length ? { tabs: x.tabs } : {}), buttons: x.buttons.slice(0, 16) }));
  if (s.staffOnly) o.staffOnly = true;
  return o;
});

export function sessionsEndedAt(): string | null {
  try {
    const u = JSON.parse(localStorage.getItem('vjdesai_user') || 'null') as { sessionsEndedAt?: string | null } | null;
    return u?.sessionsEndedAt ?? null;
  } catch {
    return null;
  }
}

export async function askAssistant(req: { question: string; conversationId: string | null; history: unknown[]; page: PageSnapshot; attachments?: Attachment[] }): Promise<AssistantAnswer> {
  const { data, error } = await supabase.functions.invoke('gst-assistant', {
    body: {
      actorId: currentActorId(),
      sessionsEndedAt: sessionsEndedAt(),
      conversationId: req.conversationId,
      question: req.question,
      history: req.history,
      page: req.page,
      screens: SCREENS,
      attachments: forRequest(req.attachments ?? []),
    },
  });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = ((await ctx.json()) as { error?: string }).error || msg;
    } catch { /* keep the message */ }
    return { ok: false, error: msg };
  }
  return data as AssistantAnswer;
}

/** Records what the user did with a card (applied, saved, cancelled, failed). */
export async function markAction(id: string, status: 'applied' | 'saved' | 'cancelled' | 'failed', result?: string): Promise<void> {
  await supabase.from('assistant_actions' as never).update({ status, result: result ?? null, decided_at: new Date().toISOString() } as never).eq('id' as never, id as never);
}
