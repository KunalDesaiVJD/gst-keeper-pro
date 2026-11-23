// The client's capital goods register (capital_goods_register, migration
// 20261123120000): load, save the changed rows, delete. Client-level, shared
// with the Rule 42/43 working; the Annual Return shows the assets sold in the
// year it is working on (capitalGoods.ts). A write in a locked year is refused
// by the database (ANNUAL_RETURN_LOCKED).

import { supabase } from '@/integrations/supabase/client';
import type { CapitalGoodsAsset } from './capitalGoods';
import { YearLockedError } from './store';

const TABLE = 'capital_goods_register';
const HISTORY = 'capital_goods_use_history';

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const dateOrNull = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);

export const rowToAsset = (r: Row): CapitalGoodsAsset => {
  const out = [r.out_igst, r.out_cgst, r.out_sgst, r.out_cess];
  return {
    id: str(r.id),
    description: str(r.description),
    hsn: str(r.hsn),
    invoiceNo: str(r.invoice_no),
    invoiceDate: dateOrNull(r.invoice_date),
    supplierGstin: str(r.supplier_gstin),
    putToUseDate: dateOrNull(r.put_to_use_date),
    useClass: (str(r.use_class) || 'taxable') as CapitalGoodsAsset['useClass'],
    itc: { i: num(r.itc_igst), c: num(r.itc_cgst), s: num(r.itc_sgst), x: num(r.itc_cess) },
    itcRoute: (str(r.itc_route) || 'normal') as CapitalGoodsAsset['itcRoute'],
    rule43Reversed: { i: num(r.r43_reversed_igst), c: num(r.r43_reversed_cgst), s: num(r.r43_reversed_sgst), x: num(r.r43_reversed_cess) },
    disposalType: (r.disposal_type ? str(r.disposal_type) : null) as CapitalGoodsAsset['disposalType'],
    disposalDate: dateOrNull(r.disposal_date),
    disposalInvoiceNo: str(r.disposal_invoice_no),
    buyerType: (str(r.buyer_type) || 'b2b') as CapitalGoodsAsset['buyerType'],
    supplyType: (str(r.supply_type) || 'intra') as CapitalGoodsAsset['supplyType'],
    rate: numOrNull(r.rate),
    disposalValue: num(r.disposal_value),
    outTax: out.every((v) => v === null || v === undefined) ? null : { i: num(out[0]), c: num(out[1]), s: num(out[2] ?? out[1]), x: num(out[3]) },
    scrapProviso: !!r.scrap_proviso,
    relatedParty: !!r.related_party,
    inSalesLedger: !!r.in_sales_ledger,
    shortfallRoute: (str(r.shortfall_route) || 'not_done') as CapitalGoodsAsset['shortfallRoute'],
    postedInBooks: !!r.posted_in_books,
    note: str(r.note),
  };
};

/** The columns this app writes (SGST follows CGST, as everywhere in the workings). */
export const assetToRow = (a: CapitalGoodsAsset, clientId: string, updatedBy: string, sortOrder: number): Row => ({
  id: a.id,
  client_id: clientId,
  description: a.description,
  hsn: a.hsn,
  invoice_no: a.invoiceNo,
  invoice_date: a.invoiceDate,
  supplier_gstin: a.supplierGstin,
  put_to_use_date: a.putToUseDate,
  use_class: a.useClass,
  itc_igst: a.itc.i,
  itc_cgst: a.itc.c,
  itc_sgst: a.itc.c,
  itc_cess: a.itc.x,
  itc_route: a.itcRoute,
  r43_reversed_igst: a.rule43Reversed.i,
  r43_reversed_cgst: a.rule43Reversed.c,
  r43_reversed_sgst: a.rule43Reversed.c,
  r43_reversed_cess: a.rule43Reversed.x,
  disposal_type: a.disposalType,
  disposal_date: a.disposalDate,
  disposal_invoice_no: a.disposalInvoiceNo,
  buyer_type: a.buyerType,
  supply_type: a.supplyType,
  rate: a.rate,
  disposal_value: a.disposalValue,
  out_igst: a.outTax ? a.outTax.i : null,
  out_cgst: a.outTax ? a.outTax.c : null,
  out_sgst: a.outTax ? a.outTax.c : null,
  out_cess: a.outTax ? a.outTax.x : null,
  scrap_proviso: a.scrapProviso,
  related_party: a.relatedParty,
  in_sales_ledger: a.inSalesLedger,
  shortfall_route: a.shortfallRoute,
  posted_in_books: a.postedInBooks,
  note: a.note,
  sort_order: sortOrder,
  updated_by: updatedBy,
});

const lockAware = (e: { message?: string } | null): never => {
  if (e?.message?.includes('ANNUAL_RETURN_LOCKED')) throw new YearLockedError();
  throw e;
};

export async function loadCapitalGoods(clientId: string): Promise<CapitalGoodsAsset[]> {
  const { data, error } = await supabase
    .from(TABLE as never)
    .select('*')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  const assets = ((data ?? []) as Row[]).map(rowToAsset);
  // The changes of use (Rule 43). A failure here leaves each asset in its own class.
  const hist = await supabase.from(HISTORY as never).select('asset_id, from_date, use_class').eq('client_id', clientId).order('from_date', { ascending: true });
  const byAsset = new Map<string, CapitalGoodsAsset['useHistory']>();
  if (!hist.error) {
    ((hist.data ?? []) as Row[]).forEach((r) => {
      const id = str(r.asset_id);
      const list = byAsset.get(id) ?? [];
      list.push({ fromDate: str(r.from_date).slice(0, 10), useClass: str(r.use_class) as CapitalGoodsAsset['useClass'] });
      byAsset.set(id, list);
    });
  }
  return assets.map((a) => ({ ...a, useHistory: byAsset.get(a.id) ?? [] }));
}

/** Write the changed assets and delete the removed ones. */
export async function saveCapitalGoods(
  clientId: string,
  changed: Array<{ asset: CapitalGoodsAsset; sortOrder: number; historyChanged?: boolean }>,
  deletedIds: string[],
  updatedBy: string,
): Promise<void> {
  if (changed.length) {
    const rows = changed.map(({ asset, sortOrder }) => assetToRow(asset, clientId, updatedBy, sortOrder));
    const { error } = await supabase.from(TABLE as never).upsert(rows as never, { onConflict: 'id' });
    if (error) lockAware(error);
    // The use history of an asset whose changes of use were edited: the dates now held, the rest removed.
    for (const { asset } of changed.filter((c) => c.historyChanged)) {
      const list = asset.useHistory ?? [];
      const keep = list.map((h) => h.fromDate);
      let del = supabase.from(HISTORY as never).delete().eq('asset_id', asset.id);
      if (keep.length) del = del.not('from_date', 'in', `(${keep.join(',')})`);
      const d = await del;
      if (d.error) lockAware(d.error);
      if (list.length) {
        const rows = list.map((h) => ({ asset_id: asset.id, client_id: clientId, from_date: h.fromDate, use_class: h.useClass, updated_by: updatedBy }));
        const u = await supabase.from(HISTORY as never).upsert(rows as never, { onConflict: 'asset_id,from_date' });
        if (u.error) lockAware(u.error);
      }
    }
  }
  if (deletedIds.length) {
    const { error } = await supabase.from(TABLE as never).delete().eq('client_id', clientId).in('id', deletedIds);
    if (error) lockAware(error);
  }
}
