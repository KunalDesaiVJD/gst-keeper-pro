import { supabase } from '@/integrations/supabase/client';
import { RegistrationType, RETURN_TYPES_BY_REGISTRATION } from '@/types';

export interface SchemeHistoryEntry {
  id: string;
  client_id: string;
  old_scheme: string;
  new_scheme: string;
  effective_from_date: string;
  changed_by: string | null;
  changed_at: string;
  notes: string | null;
}

/**
 * Resolves the effective registration type for a client at a given period.
 * Period is in MM/YYYY format. Uses scheme history to determine the correct type.
 * Returns the client's current registration_type if no history applies.
 */
export async function resolveSchemeForPeriod(
  clientId: string,
  periodMonth: string, // MM/YYYY
  currentScheme: RegistrationType
): Promise<RegistrationType> {
  // Parse period to a comparable date (1st of that month)
  const [mm, yyyy] = periodMonth.split('/');
  if (!mm || !yyyy) return currentScheme;
  const periodDate = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);

  const { data: history } = await supabase
    .from('client_scheme_history')
    .select('*')
    .eq('client_id', clientId)
    .order('effective_from_date', { ascending: true });

  if (!history || history.length === 0) return currentScheme;

  // Walk through history timeline to find the scheme at this period
  // Before the first transition, use old_scheme of the first entry
  let effectiveScheme: string = (history[0] as any).old_scheme;

  for (const entry of history as any[]) {
    const effectiveDate = new Date(entry.effective_from_date);
    // Transition applies to months starting from the effective date's month
    const effectiveMonthStart = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), 1);
    
    if (periodDate >= effectiveMonthStart) {
      effectiveScheme = entry.new_scheme;
    } else {
      break;
    }
  }

  return effectiveScheme as RegistrationType;
}

/**
 * Fetch full scheme history for a client, ordered by effective date.
 */
export async function fetchSchemeHistory(clientId: string): Promise<SchemeHistoryEntry[]> {
  const { data, error } = await supabase
    .from('client_scheme_history')
    .select('*')
    .eq('client_id', clientId)
    .order('effective_from_date', { ascending: true });

  if (error) {
    console.error('Error fetching scheme history:', error);
    return [];
  }

  return (data || []) as SchemeHistoryEntry[];
}

/**
 * Get the returns applicable for a client at a given period
 */
export function getReturnsForScheme(scheme: RegistrationType): string[] {
  return RETURN_TYPES_BY_REGISTRATION[scheme] || [];
}
