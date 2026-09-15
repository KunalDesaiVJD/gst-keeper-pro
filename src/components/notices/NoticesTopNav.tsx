import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ListOrdered, Building2, BarChart3 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Dashboard', to: '/notices-dashboard' },
  { label: 'Work Queue', to: '/notices-all' },
  { label: 'Matters', to: '/notices-all?filter=submitted' },
  { label: 'Hearings', to: '/litigation' },
  { label: 'Clients', to: '/notices-gstin-wise-count' },
];

const REPORT_PATHS = ['/notices-report', '/notices-gstin-wise-count', '/litigation-mis'];

const navItemClass = (active: boolean) => cn(
  'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
  active ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
);

export const NoticesTopNav: React.FC = () => {
  const { pathname, search } = useLocation();
  const fullPath = pathname + search;

  const isReportActive = REPORT_PATHS.includes(pathname);

  return (
    <nav className="inline-flex items-center gap-0.5 rounded-lg border bg-background p-[3px]">
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
            {item.label}
          </Link>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(navItemClass(isReportActive), 'outline-none')}>
          Reports ▾
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
