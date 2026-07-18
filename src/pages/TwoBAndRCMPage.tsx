import React, { useState } from 'react';
import { FileText, Pause, Wallet, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import TwoBReconciliationPage from './TwoBReconciliationPage';
import SuspendedRecoPage from './SuspendedRecoPage';
import GstReceivableRecoPage from './GstReceivableRecoPage';
import Import2BTab from './Import2BTab';

type TabType = '2b-reconciliation' | 'suspended-reco' | 'gst-receivable-reco' | 'import-2b';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: 'import-2b', label: 'Import 2B', icon: FileSpreadsheet },
  { id: '2b-reconciliation', label: '2B Reconciliation', icon: FileText },
  { id: 'suspended-reco', label: 'Suspended Reco', icon: Pause },
  { id: 'gst-receivable-reco', label: 'GST Receivable Reco', icon: Wallet },
];

const TwoBAndRCMPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('import-2b');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="2B and RCM"
        subtitle="Import GSTR-2B, reconcile against books, and track suspended & receivable items"
        icon={<FileText className="h-6 w-6" />}
      />

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
        {activeTab === 'gst-receivable-reco' && <GstReceivableRecoPage />}
        {activeTab === 'import-2b' && <Import2BTab />}
      </div>
    </div>
  );
};

export default TwoBAndRCMPage;
