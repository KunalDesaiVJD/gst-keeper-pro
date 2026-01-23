import React, { useState } from 'react';
import { FileText, Calculator, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import TwoBReconciliationPage from './TwoBReconciliationPage';
import SuspendedRecoPage from './SuspendedRecoPage';
import RCMSummaryPage from './RCMSummaryPage';

type TabType = '2b-reconciliation' | 'suspended-reco' | 'rcm-summary';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: '2b-reconciliation', label: '2B Reconciliation', icon: FileText },
  { id: 'suspended-reco', label: 'Suspended Reco', icon: Pause },
  { id: 'rcm-summary', label: 'RCM Summary', icon: Calculator },
];

const TwoBAndRCMPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('2b-reconciliation');

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 p-1 bg-muted/50 rounded-lg w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[calc(100vh-200px)]">
        {activeTab === '2b-reconciliation' && <TwoBReconciliationPage />}
        {activeTab === 'suspended-reco' && <SuspendedRecoPage />}
        {activeTab === 'rcm-summary' && <RCMSummaryPage />}
      </div>
    </div>
  );
};

export default TwoBAndRCMPage;
