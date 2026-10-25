import React from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { WS_PAGE } from '@/components/workspace/theme';
import { NoticesTopNav } from './NoticesTopNav';
import { MasterFilterBar } from './MasterFilterBar';
import type { MasterKey } from '@/lib/masterFilters';
import { SearchButton } from './SearchPalette';
import { useAuth } from '@/contexts/AuthContext';
import { useAutoEvidence } from '@/lib/reply/autoBuild';
import { cn } from '@/lib/utils';

/** One step of a record page's breadcrumb: the tab, the client, the record (UX audit, 25 October 2026). */
export interface Crumb { label: React.ReactNode; to?: string; mono?: boolean }

export const Breadcrumbs: React.FC<{ crumbs: Crumb[]; className?: string }> = ({ crumbs, className }) => (
  <nav aria-label="Breadcrumb" className={cn('flex flex-wrap items-center gap-1 text-xs text-muted-foreground', className)}>
    {crumbs.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span aria-hidden>›</span>}
        {c.to
          ? <Link to={c.to} className={cn('hover:text-foreground hover:underline', c.mono && 'font-mono')}>{c.label}</Link>
          : <span className={cn(i === crumbs.length - 1 && 'text-foreground', c.mono && 'font-mono')} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
      </React.Fragment>
    ))}
  </nav>
);

/**
 * One frame for every Notices & Litigation page (audit cross-cutting "house
 * style", U-02-2). A list page: the app's compact PageHeader (which leaves room
 * for the bell), search, the page's own actions, an optional status line, then
 * the module's tabs and the master filters. A record page (`record`: a case, a
 * notice, a refund, a client): the tabs and search stay, so nobody leaves the
 * module by opening something, and the breadcrumb (tab › client › record) takes
 * the place of the module title; the record's own header follows.
 */
export const NoticesShell: React.FC<{
  section: string;
  actions?: React.ReactNode;
  status?: React.ReactNode;
  /** Hide the module tabs. */
  hideNav?: boolean;
  /** A record page: tabs, search and the breadcrumb instead of the module title. */
  record?: boolean;
  crumbs?: Crumb[];
  /** The master filters this page applies (true: all five); the bar sits under the tabs. */
  master?: boolean | readonly MasterKey[];
  className?: string;
  children: React.ReactNode;
}> = ({ section, actions, status, hideNav, record, crumbs, master, className, children }) => {
  const { isStaffRole } = useAuth();
  // Evidence nobody has built yet, in the background (saved as Auto).
  useAutoEvidence(isStaffRole());
  if (record) {
    return (
      <div className={cn(WS_PAGE, className)}>
        <div className="flex flex-wrap items-center gap-2 md:pr-12">
          <div className="min-w-0 flex-1"><NoticesTopNav /></div>
          <SearchButton className="sm:w-56" />
        </div>
        {crumbs?.length ? <Breadcrumbs crumbs={crumbs} /> : null}
        {status}
        {children}
      </div>
    );
  }
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
      {master && <MasterFilterBar keys={master === true ? undefined : master} />}
      {crumbs?.length ? <Breadcrumbs crumbs={crumbs} /> : null}
      {children}
    </div>
  );
};

export default NoticesShell;
