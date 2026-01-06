import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  FileText,
  Calculator,
  ClipboardList,
  Calendar,
  Building2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import ClientManagementSection from './ClientManagementSection';
import UserManagementSection from './UserManagementSection';
import PasswordResetRequestsSection from './PasswordResetRequestsSection';
import { ReturnType } from '@/types';

interface DashboardMetrics {
  totalClients: number;
  pendingFilings: number;
  lateFilings: number;
  filedThisMonth: number;
}

interface ReturnMetrics {
  returnType: ReturnType;
  totalClients: number;
  pending: number;
  filed: number;
}


const StaffDashboard: React.FC = () => {
  const { user, canManageEmployees } = useAuth();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalClients: 0,
    pendingFilings: 0,
    lateFilings: 0,
    filedThisMonth: 0,
  });
  const [returnMetrics, setReturnMetrics] = useState<ReturnMetrics[]>([]);
  const [showReturnBreakdown, setShowReturnBreakdown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const generateMonths = () => {
    const months: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      months.push({ value, label });
    }
    return months;
  };

  const months = generateMonths();

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch clients with their selected returns and registration dates
      const { data: clientData, count: clientCount } = await supabase
        .from('clients')
        .select('id, selected_returns, registration_date, cancellation_date', { count: 'exact' });

      // Fetch filing status for the selected month
      const { data: filingData } = await supabase
        .from('filing_status')
        .select('status, filed_date, target_date, return_type, client_id')
        .eq('period_month', selectedMonth);

      // Helper to check if client is visible for the selected month
      const isClientVisibleForMonth = (client: any): boolean => {
        const [monthStr, yearStr] = selectedMonth.split('/');
        const periodDate = new Date(parseInt(yearStr), parseInt(monthStr) - 1, 1);
        
        const regDate = new Date(client.registration_date);
        const regMonth = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
        
        if (periodDate < regMonth) return false;
        
        if (client.cancellation_date) {
          const cancelDate = new Date(client.cancellation_date);
          const cancelMonth = new Date(cancelDate.getFullYear(), cancelDate.getMonth(), 1);
          if (periodDate > cancelMonth) return false;
        }
        
        return true;
      };

      // Filter clients visible for this month
      const visibleClients = clientData?.filter(isClientVisibleForMonth) || [];

      const pendingStatuses = ['Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified'];
      const pendingFilings = filingData?.filter(f => pendingStatuses.includes(f.status || ''))?.length || 0;
      const filedThisMonth = filingData?.filter(f => f.status === 'Filed')?.length || 0;
      
      const lateFilings = filingData?.filter(f => {
        if (f.status !== 'Filed' || !f.filed_date || !f.target_date) return false;
        const filedDay = new Date(f.filed_date).getDate();
        return filedDay > f.target_date;
      })?.length || 0;

      setMetrics({
        totalClients: visibleClients.length,
        pendingFilings,
        lateFilings,
        filedThisMonth,
      });

      // Calculate return-wise metrics using visible clients
      const allReturnTypes: ReturnType[] = ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08'];
      const returnMetricsData: ReturnMetrics[] = allReturnTypes.map(rt => {
        // Count visible clients with this return type selected
        const clientsWithReturn = visibleClients.filter(c => 
          (c.selected_returns || []).includes(rt)
        );
        
        const clientsWithReturnCount = clientsWithReturn.length;

        // Count filings for this return type
        const returnFilings = filingData?.filter(f => f.return_type === rt) || [];
        const filed = returnFilings.filter(f => f.status === 'Filed').length;
        
        // Pending = clients with return - filed (since not all have filing records yet)
        const pending = clientsWithReturnCount - filed;

        return {
          returnType: rt,
          totalClients: clientsWithReturnCount,
          pending: pending > 0 ? pending : 0,
          filed,
        };
      }).filter(rm => rm.totalClients > 0); // Only show returns with clients

      setReturnMetrics(returnMetricsData);
      // User metrics are now handled by UserManagementSection component
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, canManageEmployees]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        fetchMetrics();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'filing_status' }, () => {
        fetchMetrics();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_roles' }, () => {
        fetchMetrics();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMetrics]);

  const clientMetricCards = [
    {
      label: 'Total Clients',
      value: metrics.totalClients,
      icon: <Building2 className="h-8 w-8 text-primary" />,
      onClick: () => navigate('/clients'),
      bgColor: 'bg-primary/5',
    },
    {
      label: 'Pending Filings',
      value: metrics.pendingFilings,
      icon: <AlertTriangle className="h-8 w-8 text-warning" />,
      onClick: () => navigate('/filing-status?filter=pending'),
      bgColor: 'bg-warning/5',
    },
    {
      label: 'Late Filings',
      value: metrics.lateFilings,
      icon: <Clock className="h-8 w-8 text-destructive" />,
      onClick: () => navigate('/filing-status?filter=late'),
      bgColor: 'bg-destructive/5',
    },
    {
      label: 'Filed This Month',
      value: metrics.filedThisMonth,
      icon: <CheckCircle2 className="h-8 w-8 text-success" />,
      onClick: () => navigate('/filing-status?filter=filed'),
      bgColor: 'bg-success/5',
    },
  ];


  const quickActions = [
    {
      label: '2B Reconciliation',
      icon: <FileText className="h-4 w-4" />,
      onClick: () => navigate('/2b-reconciliation'),
    },
    {
      label: 'ITC Summary',
      icon: <Calculator className="h-4 w-4" />,
      onClick: () => navigate('/itc-summary'),
    },
    {
      label: 'Filing Status',
      icon: <ClipboardList className="h-4 w-4" />,
      onClick: () => navigate('/filing-status'),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with Month Selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your overview.</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map((month) => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Quick Actions - Moved to top */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-heading font-semibold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            {quickActions.map((action, index) => (
              <Button
                key={index}
                onClick={action.onClick}
                className="quick-action-btn"
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Password Reset Requests Section - All Staff can see */}
      <PasswordResetRequestsSection />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Client Management
          </CardTitle>
          <CardDescription>Overview of client filings and status</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Client Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {clientMetricCards.map((card, index) => (
              <Card 
                key={index}
                className="metric-card cursor-pointer hover:shadow-card-hover transition-all duration-200 border"
                onClick={card.onClick}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">{card.label}</p>
                      <p className="text-3xl font-bold text-foreground mt-1">
                        {isLoading ? '...' : card.value}
                      </p>
                    </div>
                    <div className={`p-2 rounded-full ${card.bgColor}`}>
                      {card.icon}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Return-wise Breakdown Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReturnBreakdown(!showReturnBreakdown)}
            className="text-sm text-muted-foreground mb-2"
          >
            {showReturnBreakdown ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
            {showReturnBreakdown ? 'Hide' : 'Show'} Return-wise Breakdown
          </Button>

          {/* Return-wise Breakdown */}
          {showReturnBreakdown && returnMetrics.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Return Type</th>
                    <th className="text-center p-2 font-medium">Total Clients</th>
                    <th className="text-center p-2 font-medium">Pending</th>
                    <th className="text-center p-2 font-medium">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {returnMetrics.map((rm) => (
                    <tr key={rm.returnType} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <Badge variant="outline">{rm.returnType}</Badge>
                      </td>
                      <td className="text-center p-2">{rm.totalClients}</td>
                      <td className="text-center p-2">
                        <span className="text-warning font-medium">{rm.pending}</span>
                      </td>
                      <td className="text-center p-2">
                        <span className="text-success font-medium">{rm.filed}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Management Section - Superadmin Only */}
      {canManageEmployees() && <UserManagementSection />}

      {/* Client Management Detail Section */}
      <ClientManagementSection />
    </div>
  );
};

export default StaffDashboard;
