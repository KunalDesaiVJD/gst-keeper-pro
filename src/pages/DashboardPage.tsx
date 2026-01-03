import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import StaffDashboard from '@/components/dashboard/StaffDashboard';
import ClientDashboard from '@/components/dashboard/ClientDashboard';

const DashboardPage: React.FC = () => {
  const { user, isStaffRole } = useAuth();

  if (!user) return null;

  return isStaffRole() ? <StaffDashboard /> : <ClientDashboard />;
};

export default DashboardPage;
