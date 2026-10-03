import React, { useState } from 'react';
import { Receipt, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WS_PAGE, WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
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
    <div className={WS_PAGE}>
      {/* Tab strip (each tab carries its own compact header). */}
      <div role="tablist" aria-label="ITC Summary and GST Receivable Reco" className={WS_TABS_LIST}>
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
      <div>
        {activeTab === 'itc-summary' && <ITCSummaryPage />}
        {activeTab === 'gst-receivable-reco' && <GstReceivableRecoPage />}
      </div>
    </div>
  );
};

export default ITCAndReceivablePage;
