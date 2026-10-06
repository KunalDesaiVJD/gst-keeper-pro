import React from 'react';
import { Scale } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { WS_PAGE } from '@/components/workspace/theme';
import { NoticesTopNav } from './NoticesTopNav';
import { SearchButton } from './SearchPalette';
import { useAuth } from '@/contexts/AuthContext';
import { useAutoEvidence } from '@/lib/reply/autoBuild';
import { cn } from '@/lib/utils';

/**
 * One header for every Notices & Litigation page (audit cross-cutting "house
 * style", U-02-2): the app's compact PageHeader (which leaves room for the
 * bell), search, the page's own actions, an optional status line, then the
 * module's tabs.
 */
export const NoticesShell: React.FC<{
  section: string;
  actions?: React.ReactNode;
  status?: React.ReactNode;
  /** Hide the module tabs (e.g. a full-page notice view that has a breadcrumb). */
  hideNav?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ section, actions, status, hideNav, className, children }) => {
  const { isStaffRole } = useAuth();
  // Evidence nobody has built yet, in the background (saved as Auto).
  useAutoEvidence(isStaffRole());
  return (
    <div className={cn(WS_PAGE, className)}>
      <PageHeader
        compact
        title="Notices & Litigation"
        subtitle={section}
        icon={<Scale />}
        actions={<><SearchButton />{actions}</>}
      />
      {status}
      {!hideNav && <NoticesTopNav />}
      {children}
    </div>
  );
};

export default NoticesShell;
