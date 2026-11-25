import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { computeWorkings, type DiffLine } from '@/lib/gstr9/engine';
import { loadPreviousYear } from '@/lib/gstr9/store';
import {
  KIND_META, amountText, carriedEffects, isNilAmount, suggestFromRules, toEffect, writeEffect,
  type CarriedEffect, type EffectDraft, type RemarkEffect,
} from '@/lib/gstr9/remarkEffects';
import { readRemarkWithAi } from '@/lib/gstr9/remarkEffectApi';
import { useWorkspace } from '../WorkspaceContext';
import { previousFY } from '../annexures/taxRows';

/** The previous FY's applied next-FY effects (read once per client and FY). */
export function useCarriedEffects(): { carried: CarriedEffect[]; prevFy: string; loading: boolean } {
  const { client, financialYear, workings } = useWorkspace();
  const prevFy = previousFY(financialYear);
  const q = useQuery({
    queryKey: ['annual-return-carried-effects', client.id, financialYear],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const prev = await loadPreviousYear(client.id, financialYear);
      if (!prev) return [] as CarriedEffect[];
      const w = computeWorkings(prev.docs, { ...workings.ctx, financialYear: prevFy });
      return carriedEffects(prev.docs.justifications, w.diffs);
    },
  });
  return { carried: q.data ?? [], prevFy, loading: q.isLoading };
}

/** Read a remark, and apply, record, dismiss or undo what it means. */
export function useRemarkEffects() {
  const { client, financialYear, docs, workings, update, me } = useWorkspace();
  const { carried } = useCarriedEffects();
  const [reading, setReading] = useState<string | null>(null);

  const setEffect = useCallback((lineKey: string, effect: RemarkEffect | undefined, action: string) => {
    update('justifications', (j) => {
      const cur = j.lines[lineKey];
      if (!cur) return j;
      const { effect: _old, ...rest } = cur;
      void _old;
      return { ...j, lines: { ...j.lines, [lineKey]: effect ? { ...rest, effect } : rest } };
    }, { action });
  }, [update]);

  /** Rules first (at once), then the GST Assistant's reading when it answers for the same remark. */
  const read = useCallback(async (line: DiffLine, remark: string) => {
    const text = remark.trim();
    if (!text) return;
    const prior = docs.justifications.lines[line.key]?.effect;
    if (prior?.status === 'applied') return; // an applied effect is undone first
    setEffect(line.key, toEffect(suggestFromRules(line, text, financialYear), 'rules', text), 'Remark read (rules)');
    setReading(line.key);
    try {
      const g = workings.g9;
      const res = await readRemarkWithAi({
        clientId: client.id, financialYear, line, remark: text, carried,
        figures: {
          t10: g.t10, t11: g.t11, t12: g.t12, t12Source: g.t12Source, t13: g.t13, t8C: g.t8.C, t6A1: g.t6.A1,
          residual: workings.itc?.residual, t12Suggested: workings.itc?.t12Suggested, t13Suggested: workings.itc?.t13Suggested,
        },
      });
      if (!res.ok) return;
      update('justifications', (j) => {
        const cur = j.lines[line.key];
        // Only over the rules' suggestion of the same remark.
        if (!cur || cur.text.trim() !== text || (cur.effect && cur.effect.status !== 'suggested')) return j;
        return { ...j, lines: { ...j.lines, [line.key]: { ...cur, effect: toEffect(res.draft, 'ai', text) } } };
      }, { action: 'Remark read (GST Assistant)' });
    } finally {
      setReading((k) => (k === line.key ? null : k));
    }
  }, [client.id, financialYear, docs.justifications.lines, workings, carried, setEffect, update]);

  /** Apply: add the amount to its table (write) or record it as already there (record). */
  const apply = useCallback((line: DiffLine, edited: EffectDraft, mode: 'write' | 'record') => {
    const j = docs.justifications.lines[line.key];
    if (!j?.effect) return;
    const meta = KIND_META[edited.kind];
    const base = toEffect(edited, j.effect.source, j.effect.remark);
    const now = new Date().toISOString();
    if (meta.target && mode === 'write' && !isNilAmount(base.amount)) {
      const restoreComputed = meta.target === 't12' && (docs.gstr9.t12 === null || docs.gstr9.t12 === undefined);
      update('gstr9', (g) => writeEffect(g, meta.target!, base.amount, 1, workings.g9.t12),
        { action: `From the remark on "${line.label}": ${meta.short} + ${amountText(base.amount, meta.withTaxable)}` });
      setEffect(line.key, { ...base, status: 'applied', wrote: true, written: base.amount, ...(restoreComputed ? { restoreComputed } : {}), decidedBy: me.name, decidedAt: now }, `Effect applied: ${meta.short}`);
      toast.success(`${meta.short} of FY ${financialYear}: added ${amountText(base.amount, meta.withTaxable)}.`);
    } else {
      setEffect(line.key, { ...base, status: 'applied', wrote: false, decidedBy: me.name, decidedAt: now }, `Effect recorded: ${meta.short}`);
    }
  }, [docs, workings.g9.t12, update, setEffect, me.name, financialYear]);

  /** Undo an applied effect: takes off exactly what was added. */
  const undo = useCallback((line: DiffLine) => {
    const e = docs.justifications.lines[line.key]?.effect;
    if (!e || e.status !== 'applied') return;
    const meta = KIND_META[e.kind];
    if (e.wrote && e.written && meta.target) {
      update('gstr9', (g) => {
        const out = writeEffect(g, meta.target!, e.written!, -1, workings.g9.t12);
        return e.restoreComputed ? { ...out, t12: null } : out;
      }, { action: `Undone from the remark on "${line.label}": ${meta.short} − ${amountText(e.written, meta.withTaxable)}` });
    }
    const { wrote: _w, written: _x, restoreComputed: _r, decidedBy: _b, decidedAt: _a, ...rest } = e;
    void _w; void _x; void _r; void _b; void _a;
    setEffect(line.key, { ...rest, status: 'suggested' }, `Effect undone: ${meta.short}`);
  }, [docs.justifications.lines, workings.g9.t12, update, setEffect]);

  const dismiss = useCallback((line: DiffLine) => {
    const e = docs.justifications.lines[line.key]?.effect;
    if (!e || e.status === 'applied') return;
    setEffect(line.key, { ...e, status: 'dismissed', decidedBy: me.name, decidedAt: new Date().toISOString() }, 'Effect dismissed');
  }, [docs.justifications.lines, setEffect, me.name]);

  return { read, apply, undo, dismiss, reading, carried };
}
