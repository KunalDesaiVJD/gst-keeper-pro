// The GST Assistant's reading of a remark (Edge Function gst-assistant, mode
// remark_effect; 25 Nov 2026). It only suggests: nothing is written until a
// person presses Apply on the working (remarkEffects.ts).
import { supabase } from '@/integrations/supabase/client';
import { currentActorId } from '@/lib/changeLogHeaders';
import { sessionsEndedAt } from '@/lib/assistant/api';
import type { DiffLine } from './engine';
import { EFFECT_KINDS, type CarriedEffect, type EffectDraft } from './remarkEffects';

export interface RemarkEffectRequest {
  clientId: string;
  financialYear: string;
  line: DiffLine;
  remark: string;
  figures: Record<string, unknown>;
  carried: CarriedEffect[];
}

export async function readRemarkWithAi(req: RemarkEffectRequest): Promise<{ ok: true; draft: EffectDraft } | { ok: false; error: string }> {
  const l = req.line;
  const { data, error } = await supabase.functions.invoke('gst-assistant', {
    body: {
      actorId: currentActorId(),
      sessionsEndedAt: sessionsEndedAt(),
      mode: 'remark_effect',
      clientId: req.clientId,
      financialYear: req.financialYear,
      line: { key: l.key, label: l.label, step: l.step, direction: l.direction, aLabel: l.aLabel, bLabel: l.bLabel, a: l.a, b: l.b, diff: l.diff, hasTax: l.hasTax, hasTaxable: l.hasTaxable },
      remark: req.remark.slice(0, 4000),
      figures: req.figures,
      carried: req.carried.slice(0, 50).map((c) => ({ kind: c.kind, amount: c.amount, lineLabel: c.lineLabel, remark: c.remark })),
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
  const d = data as { ok?: boolean; error?: string; effect?: Partial<EffectDraft> } | null;
  const e = d?.effect;
  if (!d?.ok || !e || !EFFECT_KINDS.includes(e.kind as never)) return { ok: false, error: d?.error || 'The assistant gave no reading.' };
  return {
    ok: true,
    draft: {
      kind: e.kind as EffectDraft['kind'],
      amount: { t: 0, i: 0, c: 0, s: 0, x: 0, ...(e.amount ?? {}) },
      summary: String(e.summary ?? ''),
      thisFy: String(e.thisFy ?? ''),
      nextFy: e.nextFy == null ? null : String(e.nextFy),
      confidence: e.confidence === 'high' || e.confidence === 'medium' ? e.confidence : 'low',
      ...(e.question ? { question: String(e.question) } : {}),
    },
  };
}
