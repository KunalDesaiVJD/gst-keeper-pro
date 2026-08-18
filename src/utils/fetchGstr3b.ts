// Fetches the three sources GSTR-3B is assembled from — GSTR-1 (outward),
// ITC Summary (Table 4) and RCM Summary (inward RCM) — and runs them through
// buildGstr3bJson(). Shared by the GSTR-3B page and the "Prepare GSTR-3B"
// dialog so both compute the return the exact same way.

import { supabase } from '@/integrations/supabase/client';
import { buildGstr3bJson, type Gstr3bAdjustment, type Gstr3bResult, type ItcData, type ItcRow, type RcmTotals } from './buildGstr3bJson';
import { fetchItcAutoLinkTotals } from '@/lib/itcAutoLink';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toShort = (mmYyyy: string) => {
  const [mm, yyyy] = (mmYyyy || '').split('/');
  return mm && yyyy ? `${SHORT[Number(mm) - 1]}-${String(yyyy).slice(-2)}` : '';
};

export async function fetchGstr3b(
  clientId: string,
  gstin: string,
  periodMonth: string, // MM/YYYY
): Promise<Gstr3bResult> {
  const short = toShort(periodMonth);
  const [g, itcRes, rcmRes, adjRes, fsiRes, filingRes, clientRes, autoLink] = await Promise.all([
    supabase.from('gstr1_data').select('raw_json').eq('client_id', clientId).eq('period_month', short).maybeSingle(),
    supabase.from('itc_summaries').select('data').eq('client_id', clientId).eq('period_month', periodMonth).maybeSingle(),
    supabase.from('rcm_data').select('taxable_value, cgst_2_5, cgst_9, sgst_2_5, sgst_9, igst_5, igst_18').eq('client_id', clientId).eq('month', short),
    // GSTR-3B Adjustments module — GSTR-1A / prior-period corrections that
    // don't come from GSTR-1/ITC Summary/RCM. See Gstr3bAdjustmentsPage.tsx.
    supabase.from('gstr3b_adjustments')
      .select('table_ref, label, taxable_value, igst, cgst, sgst, cess')
      .eq('client_id', clientId).eq('period_month', periodMonth),
    // Builder TDR/FSI reverse charge. It is a second, independent source of
    // 3.1(d) that never passes through rcm_data — the working is computed from
    // a posted BU event and lives in its own view. Reading only rcm_data left a
    // posted, approved FSI liability out of the return entirely, and because
    // the credit is blocked under the 1%/5% scheme this is cash, not paperwork.
    // Only PAY-treatment postings appear here; anything the client has elected
    // to ignore is excluded by the view itself.
    supabase.from('builder_rcm_postings')
      .select('taxable_value, cgst, sgst')
      .eq('client_id', clientId).eq('period_month', periodMonth),
    // Has this client's GSTR-3B (monthly or quarterly) for this period
    // already been filed? Drives the RCM reverse-charge exclusion below —
    // see RCM_RCHRG_FIX_FROM in buildGstr3bJson.ts.
    supabase.from('filing_status').select('status')
      .eq('client_id', clientId).eq('period_month', periodMonth)
      .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)']),
    // Builder Partial-ITC / No-ITC carpet-area apportionment — see
    // docs/BUILDER_GST_POSITIONS.md §7 and builderPartialItc.ts. Also carries
    // liberal_2b_reconciliation, which gates the row-5.1 auto-link below.
    supabase.from('clients').select('builder_itc_type, commercial_area, residential_area, liberal_2b_reconciliation').eq('id', clientId).maybeSingle(),
    fetchItcAutoLinkTotals(clientId, periodMonth),
  ]);

  const alreadyFiled = ((filingRes.data as { status: string }[]) || []).some((r) => r.status === 'Filed');

  let itc: ItcData | null = null;
  const rawItc = (itcRes.data as any)?.data;
  const parsed = typeof rawItc === 'string' ? JSON.parse(rawItc) : rawItc;
  if (parsed) itc = { section4A: parsed.section4A || [], section4B: parsed.section4B || [], section4D: parsed.section4D || [] };

  // ITC Summary's auto-linked rows (5.1, 5.4, 4B's "current month as per 2B
  // RECO", 4D's reclaim rows) are computed LIVE on that page and only ever
  // written back to itc_summaries.data on a manual Save — so reading the
  // saved snapshot for them drifts the moment Import 2B / 2B Reconciliation
  // changes without someone reopening and resaving ITC Summary. Patch them
  // with the same live figures ITC Summary itself would show right now,
  // mirroring its own auto-link effect exactly (including row 5.1 = eligible
  // + this period's reversal, gross not netted, per the ITC Summary fix this
  // mirrors). Liberal clients leave row 5.1 exactly as saved/typed — same
  // carve-out ITC Summary itself applies, since their invoices don't
  // necessarily go through Import 2B's classification at all.
  if (itc) {
    const isLiberal = !!clientRes.data?.liberal_2b_reconciliation;
    const { eligibleFromImport2B, reversalFromReco, reclaimFromReco, expenseOutFromReco } = autoLink;
    itc.section4A = itc.section4A.map((r: ItcRow) => {
      if (r.srNo === '5.1' && !isLiberal) {
        return { ...r, igst: eligibleFromImport2B.igst + reversalFromReco.igst, cgst: eligibleFromImport2B.cgst + reversalFromReco.cgst, sgst: eligibleFromImport2B.sgst + reversalFromReco.sgst };
      }
      if (r.srNo === '5.4') return { ...r, igst: reclaimFromReco.igst, cgst: reclaimFromReco.cgst, sgst: reclaimFromReco.sgst };
      return r;
    });
    itc.section4B = itc.section4B.map((r: ItcRow) =>
      (r.particular || '').includes('current month as per 2B RECO')
        ? { ...r, igst: reversalFromReco.igst, cgst: reversalFromReco.cgst, sgst: reversalFromReco.sgst }
        : r,
    );
    itc.section4D = itc.section4D.map((r: ItcRow) => {
      if (r.srNo === '(1)' || r.srNo === '1.1') return { ...r, igst: reclaimFromReco.igst, cgst: reclaimFromReco.cgst, sgst: reclaimFromReco.sgst };
      if (r.srNo === '1.2') return { ...r, igst: expenseOutFromReco.igst, cgst: expenseOutFromReco.cgst, sgst: expenseOutFromReco.sgst };
      return r;
    });
  }

  const rcmRows = ((rcmRes.data as any[]) || []);
  const rcm: RcmTotals = rcmRows.reduce((a, r) => ({
    taxable: a.taxable + (r.taxable_value || 0),
    igst: a.igst + (r.igst_5 || 0) + (r.igst_18 || 0),
    cgst: a.cgst + (r.cgst_2_5 || 0) + (r.cgst_9 || 0),
    sgst: a.sgst + (r.sgst_2_5 || 0) + (r.sgst_9 || 0),
  }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });

  // Fold the builder FSI legs in. Always intra-state — the place of supply for
  // development rights follows the land under s.12(3)(a) IGST Act — so they add
  // to CGST and SGST and never to IGST.
  type FsiLeg = { taxable_value: number | null; cgst: number | null; sgst: number | null };
  (((fsiRes.data as unknown) as FsiLeg[]) || []).forEach((r) => {
    rcm.taxable += Number(r.taxable_value) || 0;
    rcm.cgst += Number(r.cgst) || 0;
    rcm.sgst += Number(r.sgst) || 0;
  });

  const adjustments: Gstr3bAdjustment[] = ((adjRes.data as any[]) || []).map((a) => ({
    tableRef: a.table_ref,
    label: a.label,
    taxableValue: Number(a.taxable_value) || 0,
    igst: Number(a.igst) || 0,
    cgst: Number(a.cgst) || 0,
    sgst: Number(a.sgst) || 0,
    cess: Number(a.cess) || 0,
  }));

  const clientRow = clientRes.data as { builder_itc_type: string | null; commercial_area: number | null; residential_area: number | null } | null;

  return buildGstr3bJson({
    gstin, periodMonth, gstr1Raw: (g.data as any)?.raw_json ?? null, itc, rcm, adjustments, alreadyFiled,
    builderItcType: clientRow?.builder_itc_type ?? null,
    commercialArea: clientRow?.commercial_area ?? null,
    residentialArea: clientRow?.residential_area ?? null,
  });
}
