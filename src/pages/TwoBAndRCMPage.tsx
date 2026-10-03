import React, { useState } from 'react';
import { FileText, Pause, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { WS_PAGE, WS_TABS_LIST, WS_TAB, WS_TAB_ACTIVE } from '@/components/workspace/theme';
import TwoBReconciliationPage from './TwoBReconciliationPage';
import SuspendedRecoPage from './SuspendedRecoPage';
import Import2BTab from './Import2BTab';

type TabType = '2b-reconciliation' | 'suspended-reco' | 'import-2b';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ElementType;
}

const TABS: TabConfig[] = [
  { id: 'import-2b', label: 'Import 2B', icon: FileSpreadsheet },
  { id: '2b-reconciliation', label: '2B Reconciliation', icon: FileText },
  { id: 'suspended-reco', label: 'Suspended Reco', icon: Pause },
];

const TwoBAndRCMPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('import-2b');

  return (
    <div className={WS_PAGE}>
      <PageHeader
        compact
        title="2B and RCM"
        subtitle="Import GSTR-2B, reconcile against books, track suspended & receivable items"
        icon={<FileText />}
      />

      {/* Tab Navigation */}
      <div role="tablist" aria-label="2B and RCM sections" className={WS_TABS_LIST}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={cn(WS_TAB, isActive && WS_TAB_ACTIVE)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[calc(100vh-200px)]">
        {activeTab === '2b-reconciliation' && <TwoBReconciliationPage />}
        {activeTab === 'suspended-reco' && <SuspendedRecoPage />}
        {activeTab === 'import-2b' && <Import2BTab />}
      </div>
    </div>
  );
};

export default TwoBAndRCMPage;
