import React, { useState } from 'react';
import { Receipt, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import ITCSummaryPage from './ITCSummaryPage';
import GstReceivableRecoPage from './GstReceivableRecoPage';

type TabType = 'itc-summary' | 'gst-receivable-reco';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: 'itc-summary', label: 'ITC Summary', icon: Receipt },
  { id: 'gst-receivable-reco', label: 'GST Receivable Reco', icon: Wallet },
];

const ITCAndReceivablePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('itc-summary');

  return (
    <div className="space-y-6 animate-fade-in">
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
      <div>
        {activeTab === 'itc-summary' && <ITCSummaryPage />}
        {activeTab === 'gst-receivable-reco' && <GstReceivableRecoPage />}
      </div>
    </div>
  );
};

export default ITCAndReceivablePage;
