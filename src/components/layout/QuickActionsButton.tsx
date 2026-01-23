import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Calculator, 
  ClipboardList,
  FileSpreadsheet,
  Zap,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  path: string;
}

const QuickActionsButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  const quickActions: QuickAction[] = [
    {
      label: '2B Reconciliation',
      icon: <FileText className="h-4 w-4" />,
      path: '/2b-reconciliation',
    },
    {
      label: 'ITC Summary',
      icon: <Calculator className="h-4 w-4" />,
      path: '/itc-summary',
    },
    {
      label: 'RCM Summary',
      icon: <Calculator className="h-4 w-4" />,
      path: '/rcm-summary',
    },
    {
      label: 'Filing Status',
      icon: <ClipboardList className="h-4 w-4" />,
      path: '/filing-status',
    },
    {
      label: 'GST Running Update',
      icon: <FileSpreadsheet className="h-4 w-4" />,
      path: '/gst-running-update',
    },
  ];

  const handleActionClick = (path: string) => {
    navigate(path);
    setIsOpen(false);
  };

  return (
    <div className="fixed bottom-6 right-10 z-50">
      {/* Action items */}
      <div
        className={cn(
          'flex flex-col gap-2 mb-3 transition-all duration-300',
          isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        )}
      >
        {quickActions.map((action, index) => (
          <button
            key={action.path}
            onClick={() => handleActionClick(action.path)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg shadow-lg hover:bg-primary/90 transition-all duration-200 whitespace-nowrap',
              isOpen ? 'translate-x-0' : 'translate-x-full'
            )}
            style={{
              transitionDelay: isOpen ? `${index * 50}ms` : '0ms',
            }}
          >
            {action.icon}
            <span className="text-sm font-medium">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Main floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-all duration-300 hover:bg-primary/90 hover:scale-105',
          isOpen && 'rotate-45 bg-destructive hover:bg-destructive/90'
        )}
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Zap className="h-6 w-6" />
        )}
      </button>
    </div>
  );
};

export default QuickActionsButton;
