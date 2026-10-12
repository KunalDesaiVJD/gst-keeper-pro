// "What to do now" on a case (the firm's request of 12 October 2026): the
// notice assistant's advice (notice_case_advice, migration 20261013100000,
// written by the Edge Function notice-ai) and, until it is in, the usual step
// for the case's form under GST law. Guidance for staff: nothing is filed,
// paid or closed by it.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Track } from '@/lib/noticeCases';

export interface AdviceStep { action: string; detail: string; by: string; who: 'firm' | 'client' }
export interface Advice {
  headline: string;
  situation: string;
  steps: AdviceStep[];
  deadline: string;
  deadline_basis: string;
  overdue_note: string;
  can_close: boolean;
  close_reason: string;
  cautions: string[];
}
export interface AdviceRow {
  client_id: string;
  case_key: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  advice: Advice | null;
  finished_at: string | null;
  error: string | null;
  requested_by: string | null;
}

const adviceKey = (clientId: string, caseKey: string) => `${clientId}:${caseKey}`;

export function useCaseAdvice(clientId: string, caseKey: string) {
  return useQuery({
    queryKey: ['notice-case-advice', clientId, caseKey],
    enabled: !!clientId && !!caseKey,
    queryFn: async (): Promise<AdviceRow | null> => {
      const { data, error } = await supabase.from('notice_case_advice')
        .select('client_id, case_key, status, advice, finished_at, error, requested_by')
        .eq('client_id', clientId).eq('case_key', caseKey).maybeSingle();
      if (error) throw error;
      return (data as unknown as AdviceRow) ?? null;
    },
    // While the assistant is at it, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.status === 'running' || q.state.data?.status === 'queued' ? 5_000 : false),
  });
}

/** The advice of the cases on a list, by client and case key. */
export function useAdviceMap(rows: { client_id?: string | null; case_key?: string | null }[] | undefined) {
  const clients = [...new Set((rows ?? []).map((r) => r.client_id).filter((x): x is string => !!x))].sort();
  return useQuery({
    queryKey: ['notice-case-advice-map', clients],
    enabled: clients.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, AdviceRow>> => {
      const { data, error } = await supabase.from('notice_case_advice')
        .select('client_id, case_key, status, advice, finished_at, error, requested_by').in('client_id', clients);
      if (error) throw error;
      return new Map(((data ?? []) as unknown as AdviceRow[]).map((a) => [adviceKey(a.client_id, a.case_key), a]));
    },
  });
}
export const adviceOf = (m: Map<string, AdviceRow> | undefined, clientId: string, caseKey: string) => m?.get(adviceKey(clientId, caseKey));

/** Ask the assistant for this case now; answered in about half a minute. */
export async function askCaseAdvice(clientId: string, caseKey: string, actor: string | null): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('notice-ai', {
    body: { action: 'advise', client_id: clientId, case_key: caseKey, actor },
  });
  if (error) {
    // The function could not be reached: queue it for the next scheduled run instead.
    await supabase.rpc('notice_case_advice_request', { p_client_id: clientId, p_case_key: caseKey, p_actor: actor });
    return { error: 'The assistant could not be reached now; the case is queued for its next run.' };
  }
  const d = (data ?? {}) as { error?: string | null; status?: string };
  if (d.error === 'off') return { error: 'The AI reader is switched off (Reply Factory, AI settings).' };
  if (d.status === 'failed') return { error: 'The assistant could not answer this time.' };
  return { error: d.error ?? null };
}

// ── The usual step for the form, until the assistant's advice is in ─────────
interface Usual { headline: string; detail: string; late?: string }

const USUAL: Record<string, Usual> = {
  'DRC-01A': { headline: 'Reply in Part B of DRC 01A, or pay through DRC 03', detail: 'Accept and pay the tax with interest, or dispute it in Part B with the reasons; a DRC 01 notice follows if it is not settled.', late: 'The date to reply has passed: check whether a DRC 01 has followed; if not, file Part B now.' },
  'DRC-01': { headline: 'File the reply in DRC 06 and ask for a hearing', detail: 'Reply to each ground with documents, or pay through DRC 03 to settle (under section 73, penalty is waived if paid within 30 days of the notice).', late: 'The reply date has passed: file the reply now and ask for a hearing before the order is passed.' },
  'DRC-01B': { headline: 'Explain the GSTR 1 vs GSTR 3B difference in Part B of DRC 01B', detail: 'Explain the difference or pay it through DRC 03 within 7 days.', late: 'The 7 days have passed: reply or pay now, before a DRC 01 is issued.' },
  'DRC-01C': { headline: 'Explain the ITC difference in Part B of DRC 01C', detail: 'Explain the excess ITC claimed over GSTR 2B, or reverse or pay it through DRC 03, within 7 days.', late: 'The 7 days have passed: reply or pay now; the portal may block GSTR 1 until it is answered.' },
  'ASMT-10': { headline: 'Reply in ASMT 11 explaining the discrepancies', detail: 'Explain each discrepancy with reconciliations, or pay through DRC 03, within 30 days.', late: 'The 30 days have passed: reply now, before proceedings under section 73 or 74 begin.' },
  'DRC-07': { headline: 'Appeal in APL 01 within 3 months, or pay the demand', detail: 'File the appeal with the pre deposit (10% of the disputed tax), or pay; unpaid demands go to recovery.', late: 'Check whether an appeal was filed; if not, see whether the one month of condonation is still open, else pay or expect recovery.' },
  'DRC-07A': { headline: 'Match the pre GST demand with the old law order', detail: 'Check the demand against the old law order and its appeal; pay it or show the stay.' },
  'RECT-ORDER': { headline: 'Check the rectified demand; appeal if still aggrieved', detail: 'Compare the revised figures with the original order; appeal in APL 01 within 3 months if needed.' },
  'ADT-01': { headline: 'Prepare the records for the audit and attend', detail: 'Collect the books and documents the notice asks for and attend on the date given.' },
  SUMMONS: { headline: 'Appear on the date with the documents named', detail: 'Attend in person or through an authorised person under section 70, with the documents the summons lists.' },
  'APL-HEARING': { headline: 'Prepare written submissions and attend the hearing', detail: 'File the written submissions and attend the appeal hearing on the date fixed.' },
  'RFD-06': { headline: 'Check the refund order: appeal any rejection, else close', detail: 'Compare sanctioned and rejected amounts; appeal in APL 01 within 3 months against a rejection, or confirm the payment (RFD 05) and close.', late: 'If the refund was paid and there is no appeal, close the case.' },
  'RFD-03': { headline: 'Fix the deficiencies and file a fresh RFD 01', detail: 'Correct what the memo lists and file a fresh refund application within the time limit.' },
  'RFD-08': { headline: 'Reply in RFD 09 within 15 days', detail: 'Answer the grounds for rejection with documents and ask for a hearing.', late: 'The 15 days have passed: reply now, before the order in RFD 06.' },
  'REG-03': { headline: 'Reply in REG 04 within 7 working days', detail: 'Give the clarification or documents the officer asks for.' },
  'REG-05': { headline: 'File a fresh application, or close', detail: 'If the registration is still wanted, apply again with the correct documents.' },
  'REG-17': { headline: 'Reply in REG 18 within 7 days', detail: 'File any pending returns first and show cause why the registration should not be cancelled.' },
  'REG-19': { headline: 'Apply for revocation in REG 21, or close', detail: 'If the client wants the registration back, file the pending returns, pay the dues and apply for revocation within the time allowed; else close.' },
  'REG-31': { headline: 'Reply to the suspension intimation', detail: 'File the pending returns or explain the mismatch so that the suspension is lifted.' },
};

const TRACK_USUAL: Record<Track, Usual> = {
  litigation: { headline: 'Read the latest notice and decide: reply, pay or close', detail: 'Reply by the due date with documents, pay through DRC 03, or close if it is settled.' },
  refund: { headline: 'Check where the refund stands', detail: 'Reply to any memo or notice, appeal a rejection, or close once the refund is paid.' },
  registration: { headline: 'Check what the registration notice needs', detail: 'Reply or file what is asked, or close if the matter is over.' },
  other: { headline: 'Nothing to reply to', detail: 'Kept for the record.' },
};

export function usualStep(form: string | null | undefined, track: Track, overdue: boolean): { headline: string; detail: string } {
  const u = (form && USUAL[form.toUpperCase()]) || TRACK_USUAL[track];
  return { headline: u.headline, detail: overdue && u.late ? u.late : u.detail };
}
