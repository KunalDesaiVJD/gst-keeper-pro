import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function StaffGuard({ children }: { children: React.ReactNode }) {
  const { isStaffRole } = useAuth();
  if (!isStaffRole()) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
