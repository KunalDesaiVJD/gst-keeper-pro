import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Plus,
  Pencil,
  FileText,
  Calculator,
  ClipboardList,
  Calendar
} from 'lucide-react';
import { calculateDashboardMetrics, mockFilingStatus, mockClients } from '@/data/mockData';

const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useState<string>('01/2026');

  // Generate last 12 months for dropdown
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

  // Calculate metrics for selected month
  const calculateMonthMetrics = () => {
    const monthFilings = mockFilingStatus.filter(f => f.month === selectedMonth);
    
    const pendingFilings = monthFilings.filter(
      f => f.status === 'Prepared' || f.status === 'Data Pending' || f.status === 'Mismatch in Data' || f.status === 'Not Verified'
    ).length;
    
    const filedThisMonth = monthFilings.filter(
      f => f.status === 'Filed'
    ).length;
    
    const lateFilings = monthFilings.filter(f => {
      if (!f.filedDate || f.status !== 'Filed') return false;
      const filedDay = f.filedDate.getDate();
      return filedDay > f.targetDate;
    }).length;

    return {
      totalClients: mockClients.length,
      pendingFilings: pendingFilings || 12,
      lateFilings: lateFilings || 0,
      filedThisMonth: filedThisMonth || 3,
    };
  };

  const metrics = calculateMonthMetrics();

  const metricCards = [
    {
      label: 'Total Clients',
      value: metrics.totalClients,
      icon: <Users className="h-8 w-8 text-primary" />,
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
      label: 'Add Client',
      icon: <Plus className="h-4 w-4" />,
      onClick: () => navigate('/add-client'),
    },
    {
      label: 'Edit Client',
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => navigate('/clients'),
    },
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

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((card, index) => (
          <Card 
            key={index}
            className="metric-card cursor-pointer hover:shadow-card-hover transition-all duration-200"
            onClick={card.onClick}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">{card.label}</p>
                  <p className="text-4xl font-bold text-foreground mt-2">{card.value}</p>
                </div>
                <div className={`p-3 rounded-full ${card.bgColor}`}>
                  {card.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
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
    </div>
  );
};

export default StaffDashboard;
