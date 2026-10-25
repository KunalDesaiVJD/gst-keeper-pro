// The financial year a dispute relates to, on every case and notice
// (migration 20261025160000). A stated FY wins; otherwise the year is read
// from the notice's period, the AI reading of its papers, the portal record in
// its case folder, another notice of the case, or the case it is linked to.
// basis says which, so the lists can say how sure the year is.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CaseView } from '@/lib/noticeCases';

export type DisputeBasis = 'notice' | 'period' | 'document' | 'portal' | 'case' | 'linked';

export interface DisputeYear {
  /** Financial years, 'YYYY-YY', oldest first; empty when unknown. */
  years: string[];
  basis: DisputeBasis | null;
  /** False for registration, which is not about a year. */
  applies: boolean;
}

/** Where a derived year came from, in a few words; nothing for a stated FY. */
export const DISPUTE_BASIS_NOTE: Record<DisputeBasis, string> = {
  notice: '',
  period: 'from its period',
  document: 'read from its papers',
  portal: 'from the portal record',
  case: 'from its case',
  linked: 'from the linked case',
};

const fyStart = (fy: string) => Number(fy.slice(0, 4));

/** "2019-20"; "2017-18 to 2021-22" for a run of years; "2018-19, 2020-21" otherwise. */
export function fmtDisputeYears(years: string[] | null | undefined): string {
  const ys = [...new Set(years ?? [])].sort();
  if (!ys.length) return '';
  const run = ys.every((y, i) => i === 0 || fyStart(y) === fyStart(ys[i - 1]) + 1);
  if (ys.length > 2 && run) return `${ys[0]} to ${ys[ys.length - 1]}`;
  return ys.join(', ');
}

/** The year as one line for an export: "2019-20 (from its period)", "Not stated", or "" for registration. */
export function disputeYearText(d: DisputeYear | undefined): string {
  if (!d?.applies) return '';
  if (!d.years.length) return 'Not stated';
  const note = d.basis ? DISPUTE_BASIS_NOTE[d.basis] : '';
  return `${fmtDisputeYears(d.years)}${note ? ` (${note})` : ''}`;
}

type Raw = { client_id: string | null; case_key: string | null; id?: string | null; applies: boolean | null; dispute_years: string[] | null; basis: string | null };
const toYear = (r: Raw): DisputeYear => ({ years: r.dispute_years ?? [], basis: (r.basis as DisputeBasis | null) ?? null, applies: r.applies !== false });

export const caseYearKey = (clientId: string, caseKey: string) => `${clientId}:${caseKey}`;

/** Dispute years of the cases on a list, keyed client:case_key, for the view the list shows. */
export function useCaseDisputeYears(rows: { client_id?: string | null }[] | undefined, view: CaseView = 'linked') {
  const clients = [...new Set((rows ?? []).map((r) => r.client_id).filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ['notice-case-dispute-years', view, clients],
    enabled: clients.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, DisputeYear>> => {
      const out = new Map<string, DisputeYear>();
      for (let i = 0; i < clients.length; i += 100) {
        const { data, error } = await supabase.from('notice_case_dispute_years')
          .select('client_id, case_key, applies, dispute_years, basis')
          .eq('scope', view === 'apart' ? 'apart' : 'linked').in('client_id', clients.slice(i, i + 100));
        if (error) throw error;
        for (const r of (data ?? []) as Raw[]) if (r.client_id && r.case_key) out.set(caseYearKey(r.client_id, r.case_key), toYear(r));
      }
      return out;
    },
  });
}

/** Dispute years of the given notices, keyed by notice id. */
export async function loadNoticeDisputeYears(ids: string[]): Promise<Map<string, DisputeYear>> {
  const out = new Map<string, DisputeYear>();
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await supabase.from('notice_dispute_years')
      .select('id, client_id, case_key, applies, dispute_years, basis').in('id', uniq.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as Raw[]) if (r.id) out.set(r.id, toYear(r));
  }
  return out;
}

export function useNoticeDisputeYears(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['notice-dispute-years', key],
    enabled: key.length > 0,
    staleTime: 60_000,
    queryFn: () => loadNoticeDisputeYears(key),
  });
}
