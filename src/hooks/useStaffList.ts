import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export function useStaffList() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
        supabase.from('profiles').select('user_id, first_name, email'),
        supabase.from('user_roles').select('user_id, role'),
      ]);
      if (cancelled) return;
      if (pErr || rErr) {
        // A failed load is not "nobody to pick" (audit U-12-1).
        setError((pErr || rErr)?.message ?? 'Could not load staff');
        setLoading(false);
        return;
      }
      const roleMap = new Map<string, string>();
      (roles ?? []).forEach((r) => roleMap.set(r.user_id, r.role));
      const list: StaffMember[] = (profiles ?? [])
        .filter((p) => {
          const role = roleMap.get(p.user_id);
          return role && role !== 'client';
        })
        .map((p) => ({
          userId: p.user_id,
          name: p.first_name || p.email?.split('@')[0] || 'Unknown',
          email: p.email || '',
          role: roleMap.get(p.user_id) || 'employee',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStaff(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  return { staff, loading, error, reload };
}

/** The staff member a client master's "assigned accountant" names (first name, or "Riya / 3"). */
export function matchStaffByName(staff: StaffMember[], name: string | null | undefined): StaffMember | null {
  const raw = (name || '').trim().toLowerCase();
  if (!raw) return null;
  const first = raw.split(/[\s/,(]+/)[0];
  const hits = staff.filter((s) => s.name.trim().toLowerCase() === raw || s.name.trim().toLowerCase().split(/\s+/)[0] === first);
  return hits.length === 1 ? hits[0] : null;
}
