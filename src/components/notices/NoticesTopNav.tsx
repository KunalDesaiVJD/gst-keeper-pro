import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Building2, ChevronDown, FileWarning, ListOrdered, ReceiptIndianRupee, Wallet } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useNoticesNavCounts } from '@/lib/noticeCommandCentre';
import { cn } from '@/lib/utils';

type CountKey = 'queue' | 'open' | 'matters' | 'hearings';

interface NavItem { label: string; to: string; count?: CountKey; match: (p: string) => boolean }

// The target's tabs (audit U-03-1): each label opens the page it names.
const NAV: NavItem[] = [
  { label: 'Command centre', to: '/notices-dashboard', match: (p) => p === '/notices-dashboard' },
  { label: 'Work queue', to: '/notices-queue', count: 'queue', match: (p) => p === '/notices-queue' },
  { label: 'All notices', to: '/notices-all', count: 'open', match: (p) => p === '/notices-all' || /^\/notices\/[^/]+$/.test(p) },
  { label: 'Matters', to: '/litigation', count: 'matters', match: (p) => p === '/litigation' || p.startsWith('/litigation/') },
  { label: 'Hearings', to: '/notices-hearings', count: 'hearings', match: (p) => p === '/notices-hearings' },
  { label: 'Calendar', to: '/notices-calendar', match: (p) => p === '/notices-calendar' },
  {
    label: 'Clients', to: '/notices-company-list',
    match: (p) => p === '/notices-company-list' || p.startsWith('/notices-company/') || p.startsWith('/notices-case-folder/'),
  },
  { label: 'Autopilot', to: '/notices-autopilot', match: (p) => p === '/notices-autopilot' },
];

const REPORTS = [
  { label: 'Notice summary', to: '/notices-report', icon: ListOrdered },
  { label: 'GSTIN-wise count', to: '/notices-gstin-wise-count', icon: Building2 },
  { label: 'Refunds', to: '/refunds-all', icon: ReceiptIndianRupee },
  { label: 'DRC-03 payments', to: '/drc03-all', icon: Wallet },
  { label: 'Litigation MIS', to: '/litigation-mis', icon: BarChart3 },
];

export function noticesSectionLabel(pathname: string): string {
  return NAV.find((n) => n.match(pathname))?.label ?? REPORTS.find((r) => r.to === pathname)?.label ?? 'Notices';
}

export const NoticesTopNav: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const counts = useNoticesNavCounts(user?.id ?? null);
  const activeReport = REPORTS.find((r) => r.to === pathname);
  const current = NAV.find((n) => n.match(pathname))?.to ?? activeReport?.to ?? '';

  return (
    <>
      {/* Phones: one select instead of a rail wider than the screen (U-130-1). */}
      <div className="sm:hidden">
        <Select value={current} onValueChange={(to) => navigate(to)}>
          <SelectTrigger className="h-9 text-sm" aria-label="Notices section">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {NAV.map((n) => (
              <SelectItem key={n.to} value={n.to}>
                {n.label}{n.count && counts ? ` (${counts[n.count]})` : ''}
              </SelectItem>
            ))}
            {REPORTS.map((r) => <SelectItem key={r.to} value={r.to}>Reports · {r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Notices and litigation" className={cn(WS_TABS_LIST, 'hidden sm:inline-flex')}>
        {NAV.map((n) => {
          const active = n.match(pathname);
          const count = n.count && counts ? counts[n.count] : null;
          return (
            <Link key={n.to} to={n.to} aria-current={active ? 'page' : undefined} className={cn(WS_TAB, 'h-8 px-3', active && WS_TAB_ACTIVE)}>
              {n.label}
              {count !== null && (
                <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                  active ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary')}>
                  {count.toLocaleString('en-IN')}
                </span>
              )}
            </Link>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(WS_TAB, 'h-8 px-3 outline-none', activeReport && WS_TAB_ACTIVE)}
            aria-current={activeReport ? 'page' : undefined}>
            {activeReport ? `Reports · ${activeReport.label}` : 'Reports'} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {REPORTS.map((r) => (
              <DropdownMenuItem key={r.to} asChild>
                <Link to={r.to} className="flex items-center gap-2 text-sm" aria-current={r.to === pathname ? 'page' : undefined}>
                  <r.icon className="h-4 w-4" aria-hidden /> {r.label}
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild>
              <Link to="/notices-all?filter=auto_closed" className="flex items-center gap-2 text-sm">
                <FileWarning className="h-4 w-4" aria-hidden /> Closed automatically
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
};

export default NoticesTopNav;
