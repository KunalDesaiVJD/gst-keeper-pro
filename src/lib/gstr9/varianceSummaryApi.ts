// The GST Assistant's summary of why the final GSTR-9 differs from the
// system-computed GSTR-9 (Edge Function gst-assistant, mode variance_summary;
// 26 Nov 2026). Without a key, with the assistant off, a client opted out of
// AI or any failure, the caller falls back to the rules summary (variance.ts).
import { supabase } from '@/integrations/supabase/client';
import { currentActorId } from '@/lib/changeLogHeaders';
import { sessionsEndedAt } from '@/lib/assistant/api';
import type { Workings } from './engine';
import { varianceRequestBody, type VarianceCell, type VarianceRemark, type VarianceSummary } from './variance';

export type VarianceAiAnswer = Pick<VarianceSummary, 'overall' | 'tables'> & { unexplained: Array<{ id: string; note: string }> };

export async function summariseWithAi(req: {
  clientId: string;
  financialYear: string;
  cells: VarianceCell[];
  remarks: VarianceRemark[];
  workings: Workings;
}): Promise<{ ok: true; answer: VarianceAiAnswer } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke('gst-assistant', {
    body: {
      actorId: currentActorId(),
      sessionsEndedAt: sessionsEndedAt(),
      mode: 'variance_summary',
      clientId: req.clientId,
      financialYear: req.financialYear,
      ...varianceRequestBody(req.cells, req.remarks, req.workings),
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
  const d = data as { ok?: boolean; error?: string; summary?: Partial<VarianceAiAnswer> } | null;
  const s = d?.summary;
  if (!d?.ok || !s || typeof s.overall !== 'string' || !Array.isArray(s.tables)) return { ok: false, error: d?.error || 'The assistant gave no summary.' };
  return {
    ok: true,
    answer: {
      overall: s.overall,
      tables: s.tables.filter((t) => t && typeof t.table === 'string' && typeof t.summary === 'string').map((t) => ({ table: t.table, summary: t.summary })),
      unexplained: (Array.isArray(s.unexplained) ? s.unexplained : []).filter((u) => u && typeof u.id === 'string').map((u) => ({ id: u.id, note: String(u.note ?? '') })),
    },
  };
}
