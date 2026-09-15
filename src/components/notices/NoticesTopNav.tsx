import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Send, LayoutDashboard, FileBarChart2, ChevronDown, ListOrdered, Building2, Briefcase, BarChart3 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/notices-dashboard' },
  { label: 'Notice', icon: Bell, to: '/notices-all' },
  { label: 'Submission', icon: Send, to: '/notices-all?filter=submitted' },
  { label: 'Litigation', icon: Briefcase, to: '/litigation' },
];

const REPORT_PATHS = ['/notices-report', '/notices-gstin-wise-count', '/litigation-mis'];

const navItemClass = (active: boolean) => cn(
  'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
  active ? 'border border-primary/40 bg-background text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground',
);

export const NoticesTopNav: React.FC = () => {
  const { pathname, search } = useLocation();
  const fullPath = pathname + search;

  const isReportActive = REPORT_PATHS.includes(pathname);

  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 p-1">
      {NAV_LINKS.map((item) => {
        const active = item.to.includes('?')
          ? fullPath === item.to
          : item.to === '/notices-all'
            ? pathname === '/notices-all' && search !== '?filter=submitted'
            : item.to === '/litigation'
              ? pathname.startsWith('/litigation')
              : pathname === item.to;
        return (
          <Link key={item.label} to={item.to} className={navItemClass(active)}>
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </Link>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(navItemClass(isReportActive), 'outline-none')}>
          <FileBarChart2 className="h-3.5 w-3.5" />
          Report
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem asChild>
            <Link to="/notices-report" className="flex items-center gap-2 text-xs">
              <ListOrdered className="h-3.5 w-3.5" /> Notice Summary
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/notices-gstin-wise-count" className="flex items-center gap-2 text-xs">
              <Building2 className="h-3.5 w-3.5" /> GSTIN Wise Notice Count
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/litigation-mis" className="flex items-center gap-2 text-xs">
              <BarChart3 className="h-3.5 w-3.5" /> Litigation MIS
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
};

export default NoticesTopNav;
