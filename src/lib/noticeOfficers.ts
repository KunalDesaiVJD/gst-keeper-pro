// The officers' book (notice_officers, migration 20261014100000): a mobile,
// e-mail and office against each officer's name as the cases show it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Officer {
  id: string; name_key: string; name: string; mobile: string | null; email: string | null;
  office: string | null; notes: string | null; updated_by_name: string | null; updated_at: string;
}

/** Same as public.notice_officer_key: lower case, letters and digits only, single spaces. */
export const officerKey = (name: string | null | undefined) =>
  (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null;

/** A name worth a contact: not a state, "System Generated" or a blank. */
export const isOfficerName = (name: string | null | undefined) =>
  !!name && name.trim().length > 3 && !/^(system generated|centre|center|state)$/i.test(name.trim()) && /\s/.test(name.trim());

export function useOfficers() {
  return useQuery({
    queryKey: ['notice-officers'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, Officer>> => {
      const { data, error } = await supabase.from('notice_officers').select('*').order('name');
      if (error) throw error;
      return new Map(((data ?? []) as Officer[]).map((o) => [o.name_key, o]));
    },
  });
}

export function useSaveOfficer() {
  const qc = useQueryClient();
  return async (v: { name: string; mobile: string; email?: string; office?: string; notes?: string; actor?: string | null }) => {
    const { error } = await supabase.rpc('notice_officer_save', {
      p_name: v.name, p_mobile: v.mobile, p_email: v.email ?? null, p_office: v.office ?? null, p_notes: v.notes ?? null, p_actor: v.actor ?? null,
    });
    if (error) throw new Error(/mobile_chk/.test(error.message) ? 'The mobile number should be digits (with + or spaces).' : error.message);
    await qc.invalidateQueries({ queryKey: ['notice-officers'] });
  };
}

export async function deleteOfficer(id: string): Promise<void> {
  const { error } = await supabase.from('notice_officers').delete().eq('id', id);
  if (error) throw error;
}
