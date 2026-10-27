import React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3, Bot, Building2, CalendarDays, ChevronDown, FileText, Home, Layers, ListOrdered,
  ReceiptIndianRupee, RefreshCw, Scale, Settings, Sparkles, Wallet, type LucideIcon,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WS_TAB, WS_TAB_ACTIVE, WS_TABS_LIST } from '@/components/workspace/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useNoticesNavCounts } from '@/lib/noticeCommandCentre';
import { useCaseCounts } from '@/lib/noticeCases';
import { hrefWithMaster, readMaster } from '@/lib/masterFilters';
import { cn } from '@/lib/utils';

interface NavItem { label: string; to: string; icon: LucideIcon; match: (p: string) => boolean }

// Six tabs, each the home of one kind of thing, and a More menu in two groups
// (the UX audit of 25 October 2026). A record opens under the tab of its kind:
// a notice or a case under Cases (every list opens a notice's case), a refund
// under Refunds, a client under Clients. Pages with nothing on record (Matters
// and the Litigation MIS while no matter exists) stay out of the menu.
const NAV: NavItem[] = [
  { label: 'Home', icon: Home, to: '/notices-dashboard', match: (p) => p === '/notices-dashboard' },
  {
    label: 'Cases', icon: Layers, to: '/notices-cases',
    match: (p) => p === '/notices-cases' || p.startsWith('/notices-case/') || p.startsWith('/notices-open/') || p.startsWith('/notices-case-folder/') || /^\/notices\/[^/]+$/.test(p),
  },
  { label: 'Notices', icon: FileText, to: '/notices-all', match: (p) => p === '/notices-all' },
  { label: 'Calendar', icon: CalendarDays, to: '/notices-calendar', match: (p) => p === '/notices-calendar' },
  { label: 'Refunds', icon: ReceiptIndianRupee, to: '/refunds-all', match: (p) => p === '/refunds-all' || p.startsWith('/refunds/') },
  { label: 'Clients', icon: Building2, to: '/notices-company-list', match: (p) => p === '/notices-company-list' || p.startsWith('/notices-company/') },
];

const MATTERS: NavItem = { label: 'Matters', icon: Scale, to: '/litigation', match: (p) => p === '/litigation' || p.startsWith('/litigation/') };

const REPORTS: NavItem[] = [
  { label: 'Notice summary', to: '/notices-report', icon: ListOrdered, match: (p) => p === '/notices-report' },
  { label: 'DRC-03 payments', to: '/drc03-all', icon: Wallet, match: (p) => p === '/drc03-all' },
  { label: 'Litigation MIS', to: '/litigation-mis', icon: BarChart3, match: (p) => p === '/litigation-mis' },
];

const SETUP: NavItem[] = [
  { label: 'Portal sync', icon: RefreshCw, to: '/notices-portal-sync', match: (p) => p === '/notices-portal-sync' },
  { label: 'Autopilot', icon: Bot, to: '/notices-autopilot', match: (p) => p === '/notices-autopilot' },
  { label: 'Reply Factory', icon: Sparkles, to: '/notices-reply-factory', match: (p) => p === '/notices-reply-factory' },
  { label: 'Settings', icon: Settings, to: '/notices-settings', match: (p) => p === '/notices-settings' },
];

/** Open cases the firm acts on (notices and demands, registration; refunds are on Refunds): the number Home counts. */
function useOpenCases(): number | null {
  const counts = useCaseCounts(null);
  if (!counts.data) return null;
  return (['litigation', 'registration'] as const).reduce((s, t) => s + (counts.data?.[t]?.open ?? 0), 0);
}

export const NoticesTopNav: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // The master filters go along to the next page (lib/masterFilters).
  const [sp] = useSearchParams();
  const master = readMaster(sp);
  const go = (to: string) => hrefWithMaster(to, master);
  const { user } = useAuth();
  const nav = useNoticesNavCounts(user?.id ?? null);
  const openCases = useOpenCases();
  // Matters and its MIS show once a matter is on record (or while one is open).
  const hasMatters = (nav?.matters ?? 0) > 0 || MATTERS.match(pathname) || pathname === '/litigation-mis';
  const work = hasMatters ? [MATTERS] : [];
  const reports = REPORTS.filter((r) => r.to !== '/litigation-mis' || hasMatters);
  const menu = [...work, ...reports, ...SETUP];
  const activeMore = menu.find((n) => n.match(pathname));
  const current = [...NAV, ...menu].find((n) => n.match(pathname))?.to ?? '';

  const menuItem = (n: NavItem, count?: number | null) => (
    <DropdownMenuItem key={n.to} asChild>
      <Link to={go(n.to)} className="flex items-center justify-between gap-2 text-sm" aria-current={n.match(pathname) ? 'page' : undefined}>
        <span className="flex items-center gap-2"><n.icon className="h-4 w-4" aria-hidden />{n.label}</span>
        {count ? <span className="text-xs tabular-nums text-muted-foreground">{count.toLocaleString('en-IN')}</span> : null}
      </Link>
    </DropdownMenuItem>
  );

  return (
    <>
      {/* Phones: one select instead of a rail wider than the screen (U-130-1). */}
      <div className="sm:hidden">
        <Select value={current} onValueChange={(to) => navigate(go(to))}>
          <SelectTrigger className="h-9 text-sm" aria-label="Notices section">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {NAV.map((n) => (
              <SelectItem key={n.to} value={n.to}>{n.label}{n.to === '/notices-cases' && openCases !== null ? ` (${openCases})` : ''}</SelectItem>
            ))}
            {work.map((n) => <SelectItem key={n.to} value={n.to}>{n.label}</SelectItem>)}
            <SelectGroup><SelectLabel>Reports</SelectLabel>{reports.map((r) => <SelectItem key={r.to} value={r.to}>{r.label}</SelectItem>)}</SelectGroup>
            <SelectGroup><SelectLabel>Setup</SelectLabel>{SETUP.map((r) => <SelectItem key={r.to} value={r.to}>{r.label}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Notices and litigation" className={cn(WS_TABS_LIST, 'hidden sm:inline-flex')}>
        {NAV.map((n) => {
          const active = n.match(pathname);
          const count = n.to === '/notices-cases' ? openCases : null;
          return (
            <Link key={n.to} to={go(n.to)} aria-current={active ? 'page' : undefined} className={cn(WS_TAB, 'h-8 gap-1.5 px-3', active && WS_TAB_ACTIVE)}
              title={n.to === '/notices-cases' ? 'Open cases: notices and demands, refunds, registration' : undefined}>
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
          <DropdownMenuTrigger className={cn(WS_TAB, 'h-8 px-3 outline-none', activeMore && WS_TAB_ACTIVE)}
            aria-current={activeMore ? 'page' : undefined}>
            {activeMore ? activeMore.label : 'More'} <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {work.map((n) => menuItem(n, nav?.matters))}
            {work.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Reports</DropdownMenuLabel>
            {reports.map((r) => menuItem(r))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Setup</DropdownMenuLabel>
            {SETUP.map((r) => menuItem(r))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
};

export default NoticesTopNav;
