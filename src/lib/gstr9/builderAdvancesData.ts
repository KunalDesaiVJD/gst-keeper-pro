// Builder clients: data access for the advance roll-forward (builderAdvances.ts).
// The chain of years comes from each year's gstr9c doc; a year is closed by its
// Annual Return lock or by annual_return_builder_close_year
// (20261123150000_annual_return_builder_advances.sql).

import { supabase } from '@/integrations/supabase/client';
import { normalizeBuilderAdv, type BuilderChainYear } from './builderAdvances';

const fyRange = (fy: string) => {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Every year of the client that holds a roll-forward, oldest first. */
export async function loadBuilderChain(clientId: string): Promise<BuilderChainYear[]> {
  const [docs, closes, periods] = await Promise.all([
    supabase.from('annual_return_docs').select('financial_year, data').eq('client_id', clientId).eq('doc_key', 'gstr9c'),
    supabase
      .from('annual_return_builder_closes' as never)
      .select('financial_year, closed_by_name, closed_at, close_reason')
      .eq('client_id', clientId)
      .is('reopened_at', null),
    supabase.from('annual_return_periods').select('financial_year, status, locked_at').eq('client_id', clientId),
  ]);
  if (docs.error) throw docs.error;
  if (closes.error) throw closes.error;
  if (periods.error) throw periods.error;
  const closeOf = new Map(
    ((closes.data ?? []) as Array<{ financial_year: string; closed_by_name: string | null; closed_at: string; close_reason: string }>).map((c) => [c.financial_year, c]),
  );
  const lockOf = new Map(
    ((periods.data ?? []) as Array<{ financial_year: string; status: string; locked_at: string | null }>)
      .filter((p) => p.status === 'locked')
      .map((p) => [p.financial_year, p]),
  );
  const out: BuilderChainYear[] = [];
  ((docs.data ?? []) as Array<{ financial_year: string; data: Record<string, unknown> | null }>).forEach((d) => {
    const doc = normalizeBuilderAdv(d.data?.builderAdv);
    if (!doc) return;
    const lock = lockOf.get(d.financial_year);
    const close = closeOf.get(d.financial_year);
    out.push({
      fy: d.financial_year,
      doc,
      closed: !!lock || !!close,
      closedHow: lock ? 'locked' : close ? 'closed' : null,
      closedBy: close?.closed_by_name ?? null,
      closedAt: close?.closed_at ?? lock?.locked_at ?? null,
      closeReason: close?.close_reason ?? null,
    });
  });
  return out.sort((a, b) => a.fy.localeCompare(b.fy));
}

const plain = (e: { message?: string } | null): Error => {
  const m = /BUILDER_ADV_[A-Z_]+:\s*(.*)$/.exec(e?.message ?? '');
  return new Error(m ? m[1] : e?.message ?? 'The request failed.');
};

export async function closeBuilderYear(clientId: string, fy: string, actorId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('annual_return_builder_close_year' as never, {
    p_client_id: clientId, p_financial_year: fy, p_actor_id: actorId, p_reason: reason,
  } as never);
  if (error) throw plain(error);
}

export async function reopenBuilderYear(clientId: string, fy: string, actorId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('annual_return_builder_reopen_year' as never, {
    p_client_id: clientId, p_financial_year: fy, p_actor_id: actorId, p_reason: reason,
  } as never);
  if (error) throw plain(error);
}

export interface BuilderYearMoney {
  /** Receipts dated in the FY, bounced cheques left out (consideration, excl. GST). */
  receipts: number;
  receiptCount: number;
  /** Refunds paid in the FY to cancelled members. */
  refunds: number;
  /** Cancellations with a refund paid in the FY — suggested 5O lines. */
  cancellations: Array<{ id: string; unit: string; date: string; refunded: number }>;
}

const chunks = <T,>(xs: T[], n = 150): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Money the Builder module recorded for the FY: the tie-out and the refund suggestions. */
export async function loadBuilderYearMoney(clientId: string, fy: string): Promise<BuilderYearMoney> {
  const { from, to } = fyRange(fy);
  const proj = await supabase.from('builder_projects').select('id').eq('client_id', clientId);
  if (proj.error) throw proj.error;
  const projectIds = (proj.data ?? []).map((p) => p.id as string);
  if (!projectIds.length) return { receipts: 0, receiptCount: 0, refunds: 0, cancellations: [] };
  const units = await supabase.from('builder_units').select('id, unit_no').in('project_id', projectIds);
  if (units.error) throw units.error;
  const unitNo = new Map((units.data ?? []).map((u) => [u.id as string, String(u.unit_no ?? '')]));
  let receipts = 0;
  let receiptCount = 0;
  for (const ids of chunks([...unitNo.keys()])) {
    let page = 0;
    for (;;) {
      const r = await supabase
        .from('builder_receipts')
        .select('id, consideration, cheque_status')
        .in('unit_id', ids)
        .gte('receipt_date', from)
        .lte('receipt_date', to)
        .order('id')
        .range(page * 1000, page * 1000 + 999);
      if (r.error) throw r.error;
      const rows = r.data ?? [];
      rows.forEach((x) => {
        if (x.cheque_status === 'Bounced') return;
        receipts += Number(x.consideration) || 0;
        receiptCount += 1;
      });
      if (rows.length < 1000) break;
      page += 1;
    }
  }
  const canc = await supabase.from('builder_cancellations').select('id, unit_id, cancellation_date').in('project_id', projectIds);
  if (canc.error) throw canc.error;
  const cancRows = canc.data ?? [];
  const byId = new Map(cancRows.map((c) => [c.id as string, c]));
  const refundedBy = new Map<string, number>();
  let refunds = 0;
  for (const ids of chunks(cancRows.map((c) => c.id as string))) {
    const r = await supabase.from('builder_refund_payments').select('cancellation_id, amount').in('cancellation_id', ids).gte('payment_date', from).lte('payment_date', to);
    if (r.error) throw r.error;
    (r.data ?? []).forEach((x) => {
      const a = Number(x.amount) || 0;
      refunds += a;
      refundedBy.set(x.cancellation_id as string, (refundedBy.get(x.cancellation_id as string) ?? 0) + a);
    });
  }
  const cancellations = [...refundedBy.entries()].map(([id, refunded]) => {
    const c = byId.get(id);
    return { id, unit: unitNo.get(String(c?.unit_id)) ?? '', date: String(c?.cancellation_date ?? ''), refunded: r2(refunded) };
  });
  return { receipts: r2(receipts), receiptCount, refunds: r2(refunds), cancellations };
}
