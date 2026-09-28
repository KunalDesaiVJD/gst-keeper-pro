import React from 'react';
import { Lock } from 'lucide-react';
import ExportMenu from '../ExportMenu';
import { Note } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import DifferenceList from '../overview/DifferenceList';
import LockPanel from '../overview/LockPanel';
import ToleranceSetting from '../overview/ToleranceSetting';
import VersionHistory from '../overview/VersionHistory';
import { fmtWhen } from '../overview/steps';

/**
 * Step 13 — every difference line in one list (with its reason), the lock,
 * the tolerance setting and each sheet's version history.
 */
const ReviewStep: React.FC = () => {
  const { locked, period } = useWorkspace();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {locked ? (
          <Note tone="info" className="flex-1">
            <span className="inline-flex items-center gap-1 font-medium"><Lock className="h-3 w-3" /> Locked</span>
            {period?.locked_by ? ` by ${period.locked_by}` : ''}{period?.locked_at ? ` on ${fmtWhen(period.locked_at)}` : ''}. Nothing can be edited until the year is unlocked.
          </Note>
        ) : (
          <p className="text-sm text-muted-foreground">Give every open difference a reason (or fix the figure), then lock the year.</p>
        )}
        <ExportMenu />
      </div>

      <DifferenceList />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LockPanel />
        <ToleranceSetting />
      </div>

      <VersionHistory />
    </div>
  );
};

export default ReviewStep;
