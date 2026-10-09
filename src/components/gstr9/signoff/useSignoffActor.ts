import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { SignoffActor } from '@/lib/gstr9/signoffFlow';

/** The signed-in user as the sign-off rules see them (signoffFlow.ts). The database looks them up again by id. */
export function useSignoffActor(): SignoffActor {
  const { user, isStaffRole, canUnlockSheets } = useAuth();
  const isStaff = isStaffRole();
  const canUnlock = canUnlockSheets();
  return useMemo(() => {
    const role = user?.role ?? 'client';
    return {
      id: user?.id ?? '',
      name: user?.firstName || user?.email || 'staff',
      role,
      isStaff,
      isManager: isStaff && (role === 'superadmin' || role === 'gst_manager'),
      isSuperadmin: role === 'superadmin',
      canUnlock: isStaff && canUnlock,
    };
  }, [user?.id, user?.firstName, user?.email, user?.role, isStaff, canUnlock]);
}
