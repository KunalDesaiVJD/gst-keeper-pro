import React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Bot, Building2, CalendarDays, ChevronDown, FileText, FileWarning, Gavel, Home, Inbox, Layers, ListOrdered,
  ReceiptIndianRupee, Scale, Settings, Sparkles, Wallet, type LucideIcon,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useNoticesNavCounts } from '@/lib/noticeCommandCentre';
import { hrefWithMaster, readMaster } from '@/lib/masterFilters';
import { cn } from '@/lib/utils';

type CountKey = 'queue' | 'open' | 'matters' | 'hearings';

interface NavItem { label: string; to: string; icon: LucideIcon; count?: CountKey; match: (p: string) => boolean }

// Five tabs and a "More" menu (the firm's request of 9 October 2026: the menu was too
// long). Each label opens the page it names; the rest sit under More.
const NAV: NavItem[] = [
  { label: 'Home', icon: Home, to: '/notices-dashboard', match: (p) => p === '/notices-dashboard' },
  { label: 'Cases', icon: Layers, to: '/notices-cases', match: (p) => p === '/notices-cases' || p.startsWith('/notices-case/') },
  { label: 'Notices', icon: FileText, to: '/notices-all', count: 'open', match: (p) => p === '/notices-all' || /^\/notices\/[^/]+$/.test(p) },
  { label: 'Calendar', icon: CalendarDays, to: '/notices-calendar', match: (p) => p === '/notices-calendar' },
  {
    label: 'Clients', icon: Building2, to: '/notices-company-list',
    match: (p) => p === '/notices-company-list' || p.startsWith('/notices-company/') || p.startsWith('/notices-case-folder/'),
  },
];

const MORE: NavItem[] = [
  { label: 'Work queue', icon: Inbox, to: '/notices-queue', count: 'queue', match: (p) => p === '/notices-queue' },
  { label: 'Hearings', icon: Gavel, to: '/notices-hearings', count: 'hearings', match: (p) => p === '/notices-hearings' },
  { label: 'Matters', icon: Scale, to: '/litigation', count: 'matters', match: (p) => p === '/litigation' || p.startsWith('/litigation/') },
  { label: 'Autopilot', icon: Bot, to: '/notices-autopilot', match: (p) => p === '/notices-autopilot' },
  { label: 'Reply Factory', icon: Sparkles, to: '/notices-reply-factory', match: (p) => p === '/notices-reply-factory' },
  { label: 'Settings', icon: Settings, to: '/notices-settings', match: (p) => p === '/notices-settings' },
];

const REPORTS = [
  { label: 'Notice summary', to: '/notices-report', icon: ListOrdered },
  { label: 'GSTIN-wise count', to: '/notices-gstin-wise-count', icon: Building2 },
  { label: 'Refunds', to: '/refunds-all', icon: ReceiptIndianRupee },
  { label: 'DRC-03 payments', to: '/drc03-all', icon: Wallet },
  { label: 'Litigation MIS', to: '/litigation-mis', icon: BarChart3 },
];

export function noticesSectionLabel(pathname: string): string {
  return [...NAV, ...MORE].find((n) => n.match(pathname))?.label ?? REPORTS.find((r) => r.to === pathname)?.label ?? 'Notices';
}

export const NoticesTopNav: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // The master filters go along to the next page (lib/masterFilters).
  const [sp] = useSearchParams();
  const master = readMaster(sp);
  const go = (to: string) => hrefWithMaster(to, master);
  const { user } = useAuth();
  const counts = useNoticesNavCounts(user?.id ?? null);
  const activeReport = REPORTS.find((r) => r.to === pathname);
  const activeMore = MORE.find((n) => n.match(pathname));
  const current = [...NAV, ...MORE].find((n) => n.match(pathname))?.to ?? activeReport?.to ?? '';

  return (
    <>
      {/* Phones: one select instead of a rail wider than the screen (U-130-1). */}
      <div className="sm:hidden">
        <Select value={current} onValueChange={(to) => navigate(go(to))}>
          <SelectTrigger className="h-9 text-sm" aria-label="Notices section">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {[...NAV, ...MORE].map((n) => (
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
            <Link key={n.to} to={go(n.to)} aria-current={active ? 'page' : undefined} className={cn(WS_TAB, 'h-8 gap-1.5 px-3', active && WS_TAB_ACTIVE)}>
              <n.icon className="h-3.5 w-3.5" aria-hidden />{n.label}
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
          <DropdownMenuTrigger className={cn(WS_TAB, 'h-8 px-3 outline-none', (activeReport || activeMore) && WS_TAB_ACTIVE)}
            aria-current={activeReport || activeMore ? 'page' : undefined}>
            {activeMore ? activeMore.label : activeReport ? activeReport.label : 'More'} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {MORE.map((n) => {
              const count = n.count && counts ? counts[n.count] : null;
              return (
                <DropdownMenuItem key={n.to} asChild>
                  <Link to={go(n.to)} className="flex items-center justify-between gap-2 text-sm" aria-current={n.match(pathname) ? 'page' : undefined}>
                    <span className="flex items-center gap-2"><n.icon className="h-4 w-4" aria-hidden />{n.label}</span>{count ? <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString('en-IN')}</span> : null}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Reports</DropdownMenuLabel>
            {REPORTS.map((r) => (
              <DropdownMenuItem key={r.to} asChild>
                <Link to={go(r.to)} className="flex items-center gap-2 text-sm" aria-current={r.to === pathname ? 'page' : undefined}>
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
