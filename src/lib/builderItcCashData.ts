import { supabase } from '@/integrations/supabase/client';
import {
  computeNet4C, computePartialItcSplit, computeTotal4A, computeTotal4B,
  type ItcRowLike, type ItcTotals,
} from '@/utils/builderPartialItc';

/** The period's output tax, split by unit type — what the working paper sets off against. */
export interface OutputTaxSplit {
  residentialCgst: number;
  residentialSgst: number;
  commercialCgst: number;
  commercialSgst: number;
}

/**
 * Sum a builder client's period_postings for the period, split by the
 * posting unit's type. Every row in `builder_period_postings` carries a
 * `unit_id`, so the split is a client-side join against `builder_units`
 * rather than a second view — the postings feed already existed for GSTR-1;
 * this just re-groups it.
 */
export async function fetchBuilderOutputTaxSplit(params: {
  clientId: string;
  periodMonth: string;
  projectId?: string | null;
}): Promise<OutputTaxSplit> {
  let q = supabase
    .from('builder_period_postings')
    .select('unit_id, cgst, sgst')
    .eq('client_id', params.clientId)
    .eq('period_month', params.periodMonth);
  if (params.projectId) q = q.eq('project_id', params.projectId);
  const { data: postings, error } = await q;
  if (error) throw error;

  const rows = (postings || []) as { unit_id: string; cgst: number; sgst: number }[];
  const unitIds = [...new Set(rows.map((r) => r.unit_id))];
  const out: OutputTaxSplit = {
    residentialCgst: 0, residentialSgst: 0, commercialCgst: 0, commercialSgst: 0,
  };
  if (!unitIds.length) return out;

  const { data: units, error: uErr } = await supabase
    .from('builder_units').select('id, unit_type').in('id', unitIds);
  if (uErr) throw uErr;
  const typeOf = new Map(
    ((units || []) as { id: string; unit_type: string }[]).map((u) => [u.id, u.unit_type]),
  );

  rows.forEach((r) => {
    const isCommercial = typeOf.get(r.unit_id) === 'Commercial';
    if (isCommercial) {
      out.commercialCgst += Number(r.cgst) || 0;
      out.commercialSgst += Number(r.sgst) || 0;
    } else {
      out.residentialCgst += Number(r.cgst) || 0;
      out.residentialSgst += Number(r.sgst) || 0;
    }
  });
  return out;
}

/**
 * Net ITC available for the period (4C), for a Partial-ITC builder client —
 * the same figure the ITC Summary page shows, computed through the same
 * shared function so the two can never disagree.
 *
 * Returns null where the client isn't on Partial ITC, has no saved ITC
 * summary for the period yet, or has no carpet area synced to apportion by —
 * any of which means there is nothing yet for this working paper to show.
 */
export async function fetchNetItcAvailable(params: {
  clientId: string;
  periodMonth: string;
}): Promise<ItcTotals | null> {
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('builder_itc_type, commercial_area, residential_area')
    .eq('id', params.clientId)
    .maybeSingle();
  if (cErr) throw cErr;
  const c = client as { builder_itc_type: string | null; commercial_area: number | null; residential_area: number | null } | null;
  if (!c || c.builder_itc_type !== 'PARTIAL_ITC') return null;

  const { data: summary, error: sErr } = await supabase
    .from('itc_summaries')
    .select('data')
    .eq('client_id', params.clientId)
    .eq('period_month', params.periodMonth)
    .maybeSingle();
  if (sErr) throw sErr;
  const data = (summary as { data: unknown } | null)?.data as
    { section4A?: ItcRowLike[]; section4B?: (ItcRowLike & { particular: string; isHeader?: boolean })[] } | undefined;
  if (!data?.section4A) return null;

  const commercialArea = c.commercial_area || 0;
  const residentialArea = c.residential_area || 0;
  const partial = computePartialItcSplit({
    section4A: data.section4A, section4B: data.section4B || [], commercialArea, residentialArea,
  });
  if (!partial) return null;

  const total4A = computeTotal4A(data.section4A);
  const total4B = computeTotal4B({ isPartialITCClient: true, section4B: data.section4B || [], partial });
  return computeNet4C(total4A, total4B);
}
