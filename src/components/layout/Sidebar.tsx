import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  FileText,
  Calculator,
  ClipboardList,
  LogOut,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Settings,
  FileSpreadsheet,
  FileJson,
  Repeat,
  FolderDown,
  Users,
  Files,
  FileCheck2,
  Building,
  FileSignature
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import logoIcon from '@/assets/logo-icon.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: ('superadmin' | 'gst_manager' | 'employee' | 'client')[];
}

interface SidebarProps {
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

const CLIENT_NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    label: '2B and RCM',
    path: '/2b-and-rcm',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    label: 'ITC Summary',
    path: '/itc-summary',
    icon: <Calculator className="h-5 w-5" />,
  },
  {
    label: 'GSTR-1',
    path: '/gstr1-data',
    icon: <FileJson className="h-5 w-5" />,
  },
];

// Staff navigation - 2B and RCM is a single page with tabs
const STAFF_NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    label: 'Clients',
    path: '/clients',
    icon: <Users className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: '2B Reconciliation',
    path: '/2b-and-rcm',
    icon: <FileText className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'RCM Summary',
    path: '/rcm-summary',
    icon: <Repeat className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'ITC Summary',
    path: '/itc-summary',
    icon: <Calculator className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'GSTR-1',
    path: '/gstr1-data',
    icon: <FileJson className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'GSTR-3B',
    path: '/gstr3b',
    icon: <FileCheck2 className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'Filing Status',
    path: '/filing-status',
    icon: <ClipboardList className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'GSTR-3B Adjustments',
    path: '/gstr3b-adjustments',
    icon: <FileSignature className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager'],
  },
  {
    label: 'GST Update Sheet',
    path: '/gst-running-update',
    icon: <FileSpreadsheet className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  // "GST Reminders" now lives inside Settings -> GST Reminders tab (not a top-level nav item).
  // The whole promoter module is one destination: /builder is a sequential
  // workspace over setup, masters, receipts, BU, dastavej, adjustments, FSI and
  // the return. Reports stays separate — it is the output of a finished period,
  // read by a different person at a different time.
  {
    label: 'Builder',
    path: '/builder',
    icon: <Building className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  {
    label: 'Builder Reports',
    path: '/builder-reports',
    icon: <FolderDown className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
  // "Manage Masters" now lives inside Settings -> Masters tab (not a top-level nav item).
  {
    label: 'Reports',
    path: '/reports',
    icon: <FolderDown className="h-5 w-5" />,
    roles: ['superadmin', 'gst_manager', 'employee'],
  },
];

// Collapsible groups in the expanded rail. Order within `paths` is the order
// shown inside the group. The minimized (icon-only) rail keeps every page as a
// separate icon, so grouping only affects the expanded sidebar and the mobile
// drawer.
//
// "GST Working" holds the working sheets — the actual GSTR-3B return is its own
// page. The builder module no longer needs a group: it collapsed into the single
// /builder workspace, leaving only it and Builder Reports.
interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  paths: string[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'gst-working',
    label: 'GST Working',
    icon: <Files className="h-5 w-5" />,
    paths: ['/2b-and-rcm', '/rcm-summary', '/itc-summary'],
  },
];

const GROUPED_PATHS = new Set(NAV_GROUPS.flatMap((g) => g.paths));

const getRoleLabel = (role: string) => {
  switch (role) {
    case 'superadmin': return 'Super Admin';
    case 'gst_manager': return 'GST Manager';
    case 'employee': return 'Employee';
    case 'client': return 'Client';
    default: return role;
  }
};

/**
 * Shared hook returning the nav items the current user is allowed to see.
 * Single source of truth for the fixed rail, the minimized rail and the
 * mobile drawer.
 */
export const useSidebarNavItems = (): NavItem[] => {
  const { user, isStaffRole } = useAuth();
  const items = isStaffRole() ? STAFF_NAV_ITEMS : CLIENT_NAV_ITEMS;
  return items.filter(item => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });
};

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200',
    'before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:rounded-r-full before:transition-all',
    isActive
      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-sm before:h-6 before:bg-accent'
      : 'font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground before:h-0'
  );

/**
 * Full (expanded) sidebar contents — header, nav and user block.
 * Rendered both inside the fixed desktop rail and inside the mobile Sheet.
 */
export const SidebarContents: React.FC<{
  onToggleMinimize?: () => void;
  onNavigate?: () => void;
}> = ({ onToggleMinimize, onNavigate }) => {
  const { user, logout, isStaffRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navItems = useSidebarNavItems();

  // Each group holds whichever of its child pages this role can actually see,
  // in the order declared on the group.
  const groupsWithChildren = NAV_GROUPS.map((g) => ({
    ...g,
    children: navItems
      .filter((i) => g.paths.includes(i.path))
      .sort((a, b) => g.paths.indexOf(a.path) - g.paths.indexOf(b.path)),
    // A group counts as active while the current route is one of its pages —
    // including nested routes such as /builder-projects/:id/bookings.
    active: g.paths.some(
      (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
    ),
  })).filter((g) => g.children.length > 0);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Auto-open the group owning the current page (e.g. after a refresh).
  const activeKeys = groupsWithChildren.filter((g) => g.active).map((g) => g.key).join(',');
  useEffect(() => {
    if (!activeKeys) return;
    setOpenGroups((prev) => {
      const next = { ...prev };
      activeKeys.split(',').forEach((k) => { next[k] = true; });
      return next;
    });
  }, [activeKeys]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <>
      {/* Logo Section with Settings and User Control icons */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="bg-white rounded-lg px-3 py-2 mb-2 flex items-center justify-center">
          <img src={logo} alt="V. J. Desai & Co. LLP" className="h-8 w-auto object-contain max-w-full" />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-sidebar-foreground/70">GST Management System</p>

          {/* Icon buttons for Settings, User Control, and Minimize */}
          <div className="flex items-center gap-1">
            {onToggleMinimize && (
              <button
                onClick={onToggleMinimize}
                className="p-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
                title="Minimize sidebar"
                aria-label="Minimize sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {/* "User Control" now lives inside Settings -> User Control tab. */}
            {isStaffRole() && (
              <NavLink
                to="/settings"
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'p-2 rounded-lg transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )
                }
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="h-4 w-4" />
              </NavLink>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          // Each collapsible group renders once, in place of its first child;
          // its other children render nothing on their own turn.
          if (GROUPED_PATHS.has(item.path)) {
            const group = groupsWithChildren.find((g) => g.paths.includes(item.path));
            if (!group || item.path !== group.children[0].path) return null;
            const isOpen = !!openGroups[group.key];
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => setOpenGroups((o) => ({ ...o, [group.key]: !o[group.key] }))}
                  aria-expanded={isOpen}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    group.active
                      ? 'text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )}
                >
                  {group.icon}
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform duration-200', isOpen ? '' : '-rotate-90')}
                  />
                </button>
                {isOpen && (
                  <div className="mt-1 ml-4 pl-2 border-l border-sidebar-border/60 space-y-1">
                    {group.children.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        onClick={onNavigate}
                        className={navLinkClasses}
                      >
                        {child.icon}
                        <span>{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={navLinkClasses}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-sidebar-accent flex items-center justify-center">
            <span className="text-sm font-semibold text-sidebar-accent-foreground">
              {user?.firstName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-primary truncate">
              {user?.firstName}
            </p>
            <p className="text-xs text-sidebar-foreground/70">
              {user && getRoleLabel(user.role)}
            </p>
          </div>
          {/* Logout icon button */}
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
};

const Sidebar: React.FC<SidebarProps> = ({ isMinimized = false, onToggleMinimize }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = useSidebarNavItems();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (isMinimized) {
    return (
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-14 bg-sidebar text-sidebar-foreground flex-col shadow-sidebar z-50 transition-all duration-300">
        {/* Minimized header with expand button */}
        <div className="p-2 border-b border-sidebar-border flex flex-col items-center gap-2">
          <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center p-1">
            <img src={logoIcon} alt="V. J. Desai & Co. LLP" className="h-full w-auto object-contain" />
          </div>
          <button
            onClick={onToggleMinimize}
            className="p-1.5 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Minimized nav - icons only, with a tooltip carrying the label so the
            rail stays narrow without losing discoverability. */}
        <nav className="flex-1 py-4 px-2 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <Tooltip key={item.path} delayDuration={100}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center justify-center p-2 rounded-lg transition-all duration-200',
                      'before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-1 before:rounded-r-full before:transition-all',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground before:h-6 before:bg-accent'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground before:h-0'
                    )
                  }
                  aria-label={item.label}
                >
                  {item.icon}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        {/* Minimized user section */}
        <div className="border-t border-sidebar-border p-2 flex flex-col items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center">
            <span className="text-xs font-semibold text-sidebar-accent-foreground">
              {user?.firstName.charAt(0).toUpperCase()}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-destructive hover:bg-destructive/10 transition-colors"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex-col shadow-sidebar z-50 transition-all duration-300">
      <SidebarContents onToggleMinimize={onToggleMinimize} />
    </aside>
  );
};

export default Sidebar;
