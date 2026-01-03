import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Plus,
  Pencil,
  FileText,
  Calculator,
  ClipboardList
} from 'lucide-react';
import { calculateDashboardMetrics } from '@/data/mockData';

const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const metrics = calculateDashboardMetrics();

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your overview.</p>
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
