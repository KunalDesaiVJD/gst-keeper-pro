import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from('profiles').select('user_id, first_name, email'),
        supabase.from('user_roles').select('user_id, role'),
      ]);
      if (cancelled) return;
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
  }, []);

  return { staff, loading };
}
