// The notices and matters the master filters keep (lib/masterFilters), for pages
// whose rows do not carry every filtered field themselves (hearings, the
// calendar): their rows are kept when their notice or matter is in the scope.
import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { applyMasterToQuery, fyMatches, formMatches, masterCount, ownerMatches, type Master } from '@/lib/masterFilters';

export interface MasterScope {
  notices: Set<string>;
  matters: Set<string>;
}

interface MatterLite { id: string; client_id: string; financial_years: string[] | null; owner_user_id: string | null; priority: string | null }

export function matterMatches(r: MatterLite, m: Master, meId: string | null, forms: (string | null)[] = []): boolean {
  if (m.client && r.client_id !== m.client) return false;
  if (!ownerMatches(r.owner_user_id, m.owner, meId)) return false;
  if (m.priority && r.priority !== m.priority) return false;
  if (m.fy && !(m.fy === 'none' ? !(r.financial_years ?? []).length : fyMatches(r.financial_years ?? [], m.fy))) return false;
  if (m.form && !formMatches(forms.length ? forms : [null], m.form)) return false;
  return true;
}

export async function loadMasterScope(m: Master, meId: string | null): Promise<MasterScope> {
  const [notices, matters, links] = await Promise.all([
    fetchAllRows<{ id: string }>('notice_facts', 'id', (q) => applyMasterToQuery(q, m, meId).order('id')),
    fetchAllRows<MatterLite>('litigation_matters', 'id, client_id, financial_years, owner_user_id, priority', (q) => q.order('id')),
    m.form
      ? fetchAllRows<{ matter_id: string; form_code: string | null }>('notice_facts', 'matter_id, form_code', (q) => q.not('matter_id', 'is', null).order('id'))
      : Promise.resolve([] as { matter_id: string; form_code: string | null }[]),
  ]);
  const forms = new Map<string, (string | null)[]>();
  links.forEach((l) => forms.set(l.matter_id, [...(forms.get(l.matter_id) ?? []), l.form_code]));
  return {
    notices: new Set(notices.map((n) => n.id)),
    matters: new Set(matters.filter((r) => matterMatches(r, m, meId, forms.get(r.id) ?? [])).map((r) => r.id)),
  };
}

/** null while no master filter is set (everything is in scope). */
export function useMasterScope(m: Master, meId: string | null) {
  const on = masterCount(m) > 0;
  const q = useQuery({ queryKey: ['master-scope', m, meId], queryFn: () => loadMasterScope(m, meId), enabled: on, staleTime: 60_000 });
  return { scope: on ? q.data ?? null : null, loading: on && q.isLoading };
}

export function inScope(scope: MasterScope | null, row: { notice_id?: string | null; matter_id?: string | null }): boolean {
  if (!scope) return true;
  if (row.notice_id) return scope.notices.has(row.notice_id);
  if (row.matter_id) return scope.matters.has(row.matter_id);
  return false;
}
