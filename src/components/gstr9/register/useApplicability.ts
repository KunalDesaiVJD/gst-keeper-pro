import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { applicability, type Applicability } from '@/lib/gstr9/applicability';
import { loadTurnoverEntry, type TurnoverEntry } from '@/lib/gstr9/register';

/** The client fields applicability reads (registration type and dates). */
export interface ApplicabilityClient {
  id: string;
  registration_type?: string | null;
  registration_date?: string | null;
  cancellation_date?: string | null;
  registration_cancellation_date?: string | null;
}

const KEY = 'annual-return-applicability';

/** One client's turnover row for the year and what it means for GSTR-9 / 9C (the workspace chip, the 9C step). */
export function useApplicability(client: ApplicabilityClient | null, financialYear: string): {
  entry: TurnoverEntry | null;
  result: Applicability | null;
  loading: boolean;
} {
  const q = useQuery({
    queryKey: [KEY, client?.id, financialYear],
    queryFn: () => loadTurnoverEntry(client!.id, financialYear),
    enabled: !!client,
    staleTime: 60_000,
  });
  const entry = q.data ?? null;
  // Only once the row is read: a failed read must not pass for "no turnover typed".
  const result = client && q.isSuccess
    ? applicability({
      financialYear,
      registrationType: client.registration_type ?? null,
      registrationDate: client.registration_date,
      cancellationDate: client.cancellation_date || client.registration_cancellation_date,
      turnover: entry?.aggregate_turnover ?? null,
      gstr9OptIn: !!entry?.gstr9_opt_in,
      gstr9cOptIn: !!entry?.gstr9c_opt_in,
    })
    : null;
  return { entry, result, loading: q.isLoading };
}

/** Drop the cached rows after the register saves, so an open workspace shows the new decision. */
export function useInvalidateApplicability(): () => void {
  const qc = useQueryClient();
  return useCallback(() => { void qc.invalidateQueries({ queryKey: [KEY] }); }, [qc]);
}
