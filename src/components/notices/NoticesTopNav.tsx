// Shared top nav for the Notices Dashboard family of pages (Dashboard,
// Company List, Company Profile) — was duplicated 3x as a plain NAV_ITEMS
// array + Link row per page; extracted here so the Report dropdown (added
// below) only needs to exist once.
//
// "Report" used to link to this app's own generic /reports Hub — a whole
// different report surface, unrelated to the Notices Dashboard. Confirmed
// live against Notice Alert (2026-08-26): their "Report" nav item is a
// dropdown with exactly two entries — "Notice Summary" and "GSTIN Wise
// Notice Count" — each its own dedicated page. Matches that instead.
import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, Send, LayoutDashboard, FileBarChart2, ChevronDown, ListOrdered, Building2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/notices-dashboard', active: true },
  { label: 'Notice', icon: Bell, to: '/notices-all', active: false },
  { label: 'Submission', icon: Send, to: '/notices-all?filter=submitted', active: false },
];

const navItemClass = (active: boolean) => cn(
  'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
  active ? 'border border-primary/40 bg-background text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground',
);

export const NoticesTopNav: React.FC = () => (
  <nav className="flex items-center gap-1 rounded-md border bg-muted/30 p-1">
    {NAV_LINKS.map((item) => (
      <Link key={item.label} to={item.to} className={navItemClass(item.active)}>
        <item.icon className="h-3.5 w-3.5" />
        {item.label}
      </Link>
    ))}
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(navItemClass(false), 'outline-none')}>
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
      </DropdownMenuContent>
    </DropdownMenu>
  </nav>
);

export default NoticesTopNav;
