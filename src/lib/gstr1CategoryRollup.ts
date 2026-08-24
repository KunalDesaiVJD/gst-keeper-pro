import { supabase } from '@/integrations/supabase/client';
import { monthsForFY } from '@/lib/annualReturnPeriods';

// Reuses the same low-level field access as buildGstr1Summary.ts (raw_json
// shape verified against real imports) but keeps SEZ-with-payment/without-
// payment and export-with-payment/without-payment split, which that
// utility's pre-aggregated output collapses — our 7 GSTR 9-Output
// categories need that split, buildGstr1Summary's tiles don't.

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

interface CatAcc { taxable: number; igst: number; cgst: number; sgst: number; }
const empty = (): CatAcc => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });

const sumTaxable = (itms: any[]): number => // eslint-disable-line @typescript-eslint/no-explicit-any
  (itms || []).reduce((t: number, it: any) => t + num((it?.itm_det || it || {}).txval), 0); // eslint-disable-line @typescript-eslint/no-explicit-any

const addTax = (acc: CatAcc, itms: any[]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  (itms || []).forEach((it: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const d = it?.itm_det || it || {};
    acc.igst += num(d.iamt);
    acc.cgst += num(d.camt);
    acc.sgst += num(d.samt);
  });
};

export type Gstr1Category = 'b2c' | 'b2b' | 'sez_with' | 'sez_without' | 'zero_rated' | 'deemed_export' | 'credit_note';
export type Gstr1CategoryTotals = Record<Gstr1Category, CatAcc>;

export interface RollupResult {
  complete: boolean;
  monthsPresent: number;
  monthsTotal: number;
  categories: Gstr1CategoryTotals | null;
}

/**
 * Rolls up a client's gstr1_data (per-month raw portal JSON) into the 7
 * categories GSTR 9-Output's auto-populated column needs, for a financial
 * year. Returns complete:false (and no categories) unless all 12 months
 * have raw_json present — a partial rollup would silently understate the
 * year, which is worse than making staff enter it by hand for that FY.
 */
export async function rollupGstr1Categories(clientId: string, financialYear: string): Promise<RollupResult> {
  const months = monthsForFY(financialYear);
  const { data, error } = await supabase
    .from('gstr1_data')
    .select('period_month, raw_json')
    .eq('client_id', clientId)
    .in('period_month', months);
  if (error) throw error;

  const byMonth = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  (data || []).forEach((r: { period_month: string; raw_json: unknown }) => {
    if (r.raw_json) byMonth.set(r.period_month, r.raw_json);
  });
  const monthsPresent = months.filter((m) => byMonth.has(m)).length;
  if (monthsPresent < months.length) {
    return { complete: false, monthsPresent, monthsTotal: months.length, categories: null };
  }

  const cats: Gstr1CategoryTotals = {
    b2c: empty(), b2b: empty(), sez_with: empty(), sez_without: empty(),
    zero_rated: empty(), deemed_export: empty(), credit_note: empty(),
  };

  months.forEach((m) => {
    const j = byMonth.get(m) || {};

    (j.b2b || []).forEach((party: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      (party.inv || []).forEach((inv: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const t = String(inv?.inv_typ || 'R').toUpperCase();
        const bucket = t === 'SEWP' ? cats.sez_with : t === 'SEWOP' ? cats.sez_without : t === 'DE' ? cats.deemed_export : cats.b2b;
        bucket.taxable += sumTaxable(inv.itms);
        addTax(bucket, inv.itms);
      });
    });

    (j.b2cl || []).forEach((state: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      (state.inv || []).forEach((inv: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        cats.b2c.taxable += sumTaxable(inv.itms);
        addTax(cats.b2c, inv.itms);
      });
    });

    (j.b2cs || []).forEach((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      cats.b2c.taxable += num(r.txval);
      cats.b2c.igst += num(r.iamt);
      cats.b2c.cgst += num(r.camt);
      cats.b2c.sgst += num(r.samt);
    });

    // Only exports WITH payment of tax count toward "zero rated" here —
    // exports WITHOUT payment are PL-Output Part B's "export_wo_tax" line,
    // a books-side bifurcation this rollup doesn't touch.
    (j.exp || []).forEach((exp: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const typ = String(exp?.exp_typ || 'WOPAY').toUpperCase();
      if (typ !== 'WPAY') return;
      (exp.inv || []).forEach((inv: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        cats.zero_rated.taxable += sumTaxable(inv.itms);
        addTax(cats.zero_rated, inv.itms);
      });
    });

    // Portal nets debit notes (+) against credit notes (-) into one figure.
    const noteSign = (nt: any): 1 | -1 => // eslint-disable-line @typescript-eslint/no-explicit-any
      String(nt?.ntty ?? nt?.typ ?? 'C').toUpperCase().startsWith('D') ? 1 : -1;
    const applyNote = (nt: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const sign = noteSign(nt);
      cats.credit_note.taxable += sign * num(nt.val);
      (nt.itms || []).forEach((it: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const d = it?.itm_det || it || {};
        cats.credit_note.igst += sign * num(d.iamt);
        cats.credit_note.cgst += sign * num(d.camt);
        cats.credit_note.sgst += sign * num(d.samt);
      });
    };
    (j.cdnr || []).forEach((party: any) => (party.nt || []).forEach(applyNote)); // eslint-disable-line @typescript-eslint/no-explicit-any
    (j.cdnur || []).forEach(applyNote);
  });

  return { complete: true, monthsPresent, monthsTotal: months.length, categories: cats };
}
