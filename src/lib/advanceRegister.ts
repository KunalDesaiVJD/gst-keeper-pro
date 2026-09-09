// The advance register — Layer 2 of the advance set-off module.
//
// Layer 1 (advanceBalance.ts) derives the open advance from the filed GSTR-1
// JSONs, because Table 11A/11B carry only place of supply, rate and supply
// type. That gives the BALANCE. This layer records the receipt vouchers and
// the invoice legs that close them out, which is the linkage a working paper
// needs and the JSON can never provide.
//
// The two reconcile, they do not compete: the filed return stays the source of
// truth for the balance, and the register is checked against it. See
// docs/ADVANCE_SETOFF_POSITIONS.md §2.

import { supabase } from '@/integrations/supabase/client';
import {
  keyOf, parseKey, zeroTax, addTax, subTax, isTaxZero, periodOrdinal, describeKey,
  type TaxAmount, type AdvanceKey,
} from './advanceBalance';

export type SupplyNature = 'SERVICE' | 'GOODS';
export type ReceiptStatus = 'OPEN' | 'PARTIAL' | 'CLOSED' | 'REFUNDED' | 'WRITTEN_BACK';
export type AdjustmentReason = 'INVOICE' | 'REFUND_TO_PARTY' | 'CANCELLATION' | 'WRITE_BACK';

export interface AdvanceReceipt {
  id: string;
  client_id: string;
  project_id: string | null;
  receipt_no: string;
  receipt_date: string;
  period_month: string;
  party_gstin: string;
  party_name: string;
  pos: string;
  rate_pct: number;
  sply_ty: string;
  gross_amount: number;
  taxable_value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  supply_nature: SupplyNature;
  status: ReceiptStatus;
  source: string;
  notes: string;
  created_by_name: string | null;
  created_at: string;
}

export interface AdvanceAdjustment {
  id: string;
  receipt_id: string;
  client_id: string;
  project_id: string | null;
  invoice_no: string;
  invoice_date: string | null;
  period_month: string;
  rate_pct: number;
  consideration_adjusted: number;
  taxable_value_adjusted: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  reason: AdjustmentReason;
  /** The RA bill this recovery was made from — contractor projects only. */
  ra_bill_id: string | null;
  amends_adjustment_id: string | null;
  original_period: string | null;
  amendment_reason: string;
  created_by_name: string | null;
  created_at: string;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tax on a taxable amount, split by supply type. Same rule as the checker. */
export const taxForRate = (taxable: number, ratePct: number, splyTy: string): TaxAmount => {
  if (splyTy === 'INTRA') {
    // Computed as two independent halves so CGST and SGST are always equal —
    // halving a rounded total can't divide evenly on an odd amount.
    const half = r2((ratePct / 200) * taxable);
    return { taxable, igst: 0, cgst: half, sgst: half, cess: 0 };
  }
  return { taxable, igst: r2((ratePct / 100) * taxable), cgst: 0, sgst: 0, cess: 0 };
};

export const receiptKey = (r: AdvanceReceipt): AdvanceKey => ({
  pos: r.pos, ratePct: num(r.rate_pct), splyTy: r.sply_ty,
});

/**
 * Legs that actually count. An amended leg RESTATES the one it supersedes
 * rather than adding to it (§7), so a leg pointed at by another leg's
 * `amends_adjustment_id` drops out entirely.
 */
export function effectiveLegs(adjustments: AdvanceAdjustment[]): AdvanceAdjustment[] {
  const superseded = new Set(
    adjustments.map((a) => a.amends_adjustment_id).filter((id): id is string => !!id),
  );
  return adjustments.filter((a) => !superseded.has(a.id));
}

export interface ReceiptPosition {
  receipt: AdvanceReceipt;
  /** Legs closing this receipt, amendments already resolved. */
  legs: AdvanceAdjustment[];
  adjusted: number;
  open: number;
  /** Derived from the legs — the stored status is only an explicit closure. */
  derivedStatus: ReceiptStatus;
}

/**
 * Per-receipt position. `open` is what a later invoice can still absorb.
 *
 * A GOODS receipt always reports open = 0 for GST purposes: Notification
 * 66/2017-CT removed tax-on-receipt for advances against goods, so there is no
 * Table 11A liability to reverse. It stays in the register as a memo so a
 * later invoice is not mistakenly adjusted against it.
 */
export function receiptPositions(
  receipts: AdvanceReceipt[],
  adjustments: AdvanceAdjustment[],
): ReceiptPosition[] {
  const legs = effectiveLegs(adjustments);
  const byReceipt = new Map<string, AdvanceAdjustment[]>();
  legs.forEach((a) => {
    if (!byReceipt.has(a.receipt_id)) byReceipt.set(a.receipt_id, []);
    byReceipt.get(a.receipt_id)!.push(a);
  });

  return receipts.map((receipt) => {
    const mine = (byReceipt.get(receipt.id) || [])
      .sort((a, b) => periodOrdinal(a.period_month) - periodOrdinal(b.period_month));
    const adjusted = r2(mine.reduce((t, a) => t + num(a.taxable_value_adjusted), 0));
    const taxable = num(receipt.taxable_value);
    const isGoods = receipt.supply_nature === 'GOODS';
    const open = isGoods ? 0 : r2(Math.max(taxable - adjusted, 0));

    // An explicit closure (refund / write-back) wins over the arithmetic:
    // a receipt refunded to the party is closed even with value unadjusted.
    const closedExplicitly = mine.some((a) => a.reason === 'REFUND_TO_PARTY' || a.reason === 'WRITE_BACK' || a.reason === 'CANCELLATION');
    let derivedStatus: ReceiptStatus = 'OPEN';
    if (closedExplicitly && open <= 0.5) {
      const kind = mine.find((a) => a.reason !== 'INVOICE')?.reason;
      derivedStatus = kind === 'REFUND_TO_PARTY' ? 'REFUNDED' : 'WRITTEN_BACK';
    } else if (open <= 0.5) derivedStatus = 'CLOSED';
    else if (adjusted > 0) derivedStatus = 'PARTIAL';

    return { receipt, legs: mine, adjusted, open, derivedStatus };
  });
}

/**
 * The register's own closing position per advance key, as at `upto`.
 *
 * Built from receiptPositions so there is exactly ONE definition of "open" in
 * this module. Computing it independently here was a real bug: a refunded
 * receipt showed open = 0 on the Register tab and still-open in the
 * reconciliation, so rule 8 fired on a definitional difference rather than a
 * missing entry — the kind of false finding that trains people to ignore the
 * check.
 *
 * A refund, cancellation or write-back therefore closes the register position,
 * while buildTxpdFromLegs still reports only INVOICE legs in Table 11B. If the
 * firm's position is that a refunded advance also needs an 11B, the return
 * will be short and rule 8 surfaces exactly that — which is a real finding,
 * not a definitional artefact. See §10 of the doc: the treatment of a refunded
 * advance is recorded as open, not silently decided here.
 */
export function registerClosingByKey(
  receipts: AdvanceReceipt[],
  adjustments: AdvanceAdjustment[],
  upto: string,
): Map<string, TaxAmount> {
  const uptoOrd = periodOrdinal(upto);
  const inScope = receipts.filter((r) => periodOrdinal(r.period_month) <= uptoOrd);
  const legsInScope = adjustments.filter((a) => periodOrdinal(a.period_month) <= uptoOrd);

  const out = new Map<string, TaxAmount>();
  receiptPositions(inScope, legsInScope).forEach((p) => {
    if (p.open <= 0) return;
    const k = keyOf(receiptKey(p.receipt));
    // Tax on the still-open portion, at the receipt's own rate and supply
    // type — not the receipt's original tax, which covers the adjusted part
    // too.
    out.set(k, addTax(out.get(k) || zeroTax(), taxForRate(p.open, num(p.receipt.rate_pct), p.receipt.sply_ty)));
  });

  const cleaned = new Map<string, TaxAmount>();
  out.forEach((v, k) => { if (!isTaxZero(v)) cleaned.set(k, v); });
  return cleaned;
}

export interface RegisterReconcileRow {
  key: string;
  label: string;
  register: number;
  filed: number;
  difference: number;
}

/**
 * Register closing vs the closing derived from the filed returns. A divergence
 * is a soft finding, never a hard one: it means the paperwork and the return
 * disagree, which needs a human, but the RETURN is what was filed and the
 * register is not authority to block on.
 */
export function reconcileRegister(
  registerClosing: Map<string, TaxAmount>,
  filedClosing: Map<string, TaxAmount>,
  tolerance = 1,
): RegisterReconcileRow[] {
  const keys = new Set([...registerClosing.keys(), ...filedClosing.keys()]);
  const rows: RegisterReconcileRow[] = [];
  keys.forEach((k) => {
    const register = r2(registerClosing.get(k)?.taxable || 0);
    const filed = r2(filedClosing.get(k)?.taxable || 0);
    const difference = r2(register - filed);
    if (Math.abs(difference) > tolerance) {
      rows.push({ key: k, label: describeKey(parseKey(k)), register, filed, difference });
    }
  });
  return rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export interface SetoffAllocation {
  receiptId: string;
  receiptNo: string;
  receiptDate: string;
  partyName: string;
  ratePct: number;
  pos: string;
  splyTy: string;
  /** How much of this receipt the invoice absorbs. */
  amount: number;
  tax: TaxAmount;
}

/**
 * Allocate an invoice's taxable value across open receipts at the same key,
 * oldest first.
 *
 * FIFO is the default because it is the one rule that needs no judgement and
 * ages the ledger correctly — the oldest advance is the one most likely to
 * have been billed. It is a SUGGESTION: the workspace lets staff reallocate,
 * because only they know which advance a given invoice actually relates to.
 */
export function suggestAllocation(
  positions: ReceiptPosition[],
  key: AdvanceKey,
  invoiceTaxable: number,
): SetoffAllocation[] {
  const k = keyOf(key);
  const candidates = positions
    .filter((p) => p.open > 0 && keyOf(receiptKey(p.receipt)) === k)
    .sort((a, b) => a.receipt.receipt_date.localeCompare(b.receipt.receipt_date));

  const out: SetoffAllocation[] = [];
  let remaining = r2(invoiceTaxable);
  for (const p of candidates) {
    if (remaining <= 0) break;
    const amount = r2(Math.min(p.open, remaining));
    if (amount <= 0) continue;
    out.push({
      receiptId: p.receipt.id,
      receiptNo: p.receipt.receipt_no,
      receiptDate: p.receipt.receipt_date,
      partyName: p.receipt.party_name,
      ratePct: num(p.receipt.rate_pct),
      pos: p.receipt.pos,
      splyTy: p.receipt.sply_ty,
      amount,
      tax: taxForRate(amount, num(p.receipt.rate_pct), p.receipt.sply_ty),
    });
    remaining = r2(remaining - amount);
  }
  return out;
}

export interface RefundOffsetPlan {
  key: string;
  pos: string;
  ratePct: number;
  splyTy: string;
  /** Refund legs recorded in this period, before capping. */
  refundTotal: number;
  /** Table 11A reported in the draft for this key, the pool to net against. */
  availableInPeriod: number;
  /** What can actually be netted off — min(refund, available). */
  offsetAmount: number;
  /** Refund beyond the pool. Forfeited permanently, NOT carried forward. */
  forfeitedAmount: number;
}

/**
 * How a refunded (or cancelled / written-back) advance is reported.
 *
 * POSITION — mirrors the Builder module's SETOFF path exactly, on the firm's
 * instruction (Sept 2026). See docs/BUILDER_GST_POSITIONS.md §9 and §11 and
 * lib/builderCancellationData.ts, whose planCancellationOffset this follows.
 *
 *   A refund is NOT a Table 11B adjustment. Table 11B is for advances adjusted
 *   against invoices issued; a refund is a different event.
 *
 *   It nets against the REFUND MONTH'S OWN Table 11A pool at the same rate,
 *   capped at what that pool holds, because the portal rejects a negative
 *   Table 11A.
 *
 *   Whatever does not fit is FORFEITED PERMANENTLY and never carried forward.
 *   This is the cancellation rule, not the bounce rule — a bounce reversal
 *   carries forward, a cancellation does not (BUILDER_GST_POSITIONS §9).
 *
 * The alternative route, where the tax is genuinely to be recovered rather
 * than forfeited, is a credit note under s.34 — outside this module.
 */
export function planRefundOffsets(
  receipts: AdvanceReceipt[],
  adjustments: AdvanceAdjustment[],
  periodMonth: string,
  availableAtByKey: Map<string, number>,
): RefundOffsetPlan[] {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const refundByKey = new Map<string, number>();

  effectiveLegs(adjustments).forEach((a) => {
    if (a.reason === 'INVOICE') return;
    if (a.period_month !== periodMonth) return;
    const r = byId.get(a.receipt_id);
    if (!r || r.supply_nature === 'GOODS') return;
    const k = keyOf(receiptKey(r));
    refundByKey.set(k, r2((refundByKey.get(k) || 0) + num(a.taxable_value_adjusted)));
  });

  return Array.from(refundByKey.entries()).map(([key, refundTotal]) => {
    const k = parseKey(key);
    const availableInPeriod = Math.max(0, r2(availableAtByKey.get(key) || 0));
    const offsetAmount = r2(Math.min(refundTotal, availableInPeriod));
    return {
      key,
      pos: k.pos,
      ratePct: k.ratePct,
      splyTy: k.splyTy,
      refundTotal,
      availableInPeriod,
      offsetAmount,
      forfeitedAmount: r2(refundTotal - offsetAmount),
    };
  }).sort((a, b) => b.refundTotal - a.refundTotal);
}

/**
 * Table 11B groups for a period, built from the register's own INVOICE legs.
 * Same shape assembleGstr1Json emits, so it can be written straight into a
 * GSTR-1 draft.
 */
export function buildTxpdFromLegs(
  receipts: AdvanceReceipt[],
  adjustments: AdvanceAdjustment[],
  periodMonth: string,
): unknown[] {
  const byId = new Map(receipts.map((r) => [r.id, r]));
  const perKey = new Map<string, { pos: string; splyTy: string; ratePct: number; tax: TaxAmount }>();

  effectiveLegs(adjustments).forEach((a) => {
    if (a.reason !== 'INVOICE' || a.period_month !== periodMonth) return;
    const r = byId.get(a.receipt_id);
    if (!r || r.supply_nature === 'GOODS') return;
    const k = keyOf(receiptKey(r));
    const cur = perKey.get(k) || { pos: r.pos, splyTy: r.sply_ty, ratePct: num(r.rate_pct), tax: zeroTax() };
    cur.tax = addTax(cur.tax, {
      taxable: num(a.taxable_value_adjusted), igst: num(a.igst), cgst: num(a.cgst), sgst: num(a.sgst), cess: num(a.cess),
    });
    perKey.set(k, cur);
  });

  const groups = new Map<string, { pos: string; sply_ty: string; itms: unknown[] }>();
  perKey.forEach((v) => {
    const gk = `${v.pos}__${v.splyTy}`;
    if (!groups.has(gk)) groups.set(gk, { pos: v.pos, sply_ty: v.splyTy, itms: [] });
    groups.get(gk)!.itms.push({
      rt: v.ratePct,
      ad_amt: r2(v.tax.taxable),
      iamt: r2(v.tax.igst),
      camt: r2(v.tax.cgst),
      samt: r2(v.tax.sgst),
      csamt: r2(v.tax.cess),
    });
  });
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export interface RegisterData {
  receipts: AdvanceReceipt[];
  adjustments: AdvanceAdjustment[];
}

export async function fetchRegister(clientId: string): Promise<RegisterData> {
  if (!clientId) return { receipts: [], adjustments: [] };
  const [rRes, aRes] = await Promise.all([
    supabase.from('advance_receipts' as never).select('*').eq('client_id', clientId).order('receipt_date', { ascending: true }),
    supabase.from('advance_adjustments' as never).select('*').eq('client_id', clientId),
  ]);
  // A missing table (migration not applied) degrades to an empty register,
  // which is exactly how every client without one already behaves.
  return {
    receipts: rRes.error ? [] : ((rRes.data as unknown as AdvanceReceipt[]) || []),
    adjustments: aRes.error ? [] : ((aRes.data as unknown as AdvanceAdjustment[]) || []),
  };
}

/** True when this client uses the register at all — gates rules 7 and 8. */
export async function hasRegister(clientId: string): Promise<boolean> {
  if (!clientId) return false;
  const { data, error } = await supabase
    .from('advance_receipts' as never).select('id').eq('client_id', clientId).limit(1);
  if (error) return false;
  return ((data as unknown as { id: string }[]) || []).length > 0;
}

export async function saveReceipt(
  receipt: Partial<AdvanceReceipt> & { client_id: string },
  actor: { id: string | null; name: string },
): Promise<void> {
  const payload = {
    ...receipt,
    updated_at: new Date().toISOString(),
    ...(receipt.id ? {} : { created_by: actor.id, created_by_name: actor.name }),
  };
  const { error } = receipt.id
    ? await supabase.from('advance_receipts' as never).update(payload as never).eq('id', receipt.id)
    : await supabase.from('advance_receipts' as never).insert(payload as never);
  if (error) throw error;
}

export async function deleteReceipt(id: string): Promise<void> {
  const { error } = await supabase.from('advance_receipts' as never).delete().eq('id', id);
  if (error) throw error;
}

export async function saveAdjustments(
  legs: (Partial<AdvanceAdjustment> & { receipt_id: string; client_id: string; period_month: string })[],
  actor: { id: string | null; name: string },
): Promise<void> {
  if (legs.length === 0) return;
  const rows = legs.map((l) => ({ ...l, created_by: actor.id, created_by_name: actor.name }));
  const { error } = await supabase.from('advance_adjustments' as never).insert(rows as never);
  if (error) throw error;
}

export async function deleteAdjustment(id: string): Promise<void> {
  const { error } = await supabase.from('advance_adjustments' as never).delete().eq('id', id);
  if (error) throw error;
}
