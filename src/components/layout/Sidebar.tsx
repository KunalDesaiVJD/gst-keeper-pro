import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  LayoutDashboard, 
  FileText, 
  Calculator, 
  ClipboardList, 
  LogOut,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Shield,
  Settings,
  FileSpreadsheet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: ('superadmin' | 'gst_manager' | 'employee' | 'client')[];
  children?: NavItem[];
}

interface SidebarProps {
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isMinimized = false, onToggleMinimize }) => {
  const { user, logout, canManageEmployees, isStaffRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [is2BRCMOpen, setIs2BRCMOpen] = useState(
    ['/2b-reconciliation', '/suspended-reco', '/rcm-summary'].includes(location.pathname)
  );

  // Base nav items - different for client vs staff
  const getNavItems = (): NavItem[] => {
    if (!isStaffRole()) {
      // Client only sees Dashboard and 2B Reconciliation
      return [
        {
          label: 'Dashboard',
          path: '/dashboard',
          icon: <LayoutDashboard className="h-5 w-5" />,
        },
        {
          label: '2B Reconciliation',
          path: '/2b-reconciliation',
          icon: <FileText className="h-5 w-5" />,
        },
      ];
    }

    // Staff navigation
    const items: NavItem[] = [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: <LayoutDashboard className="h-5 w-5" />,
      },
      {
        label: '2B and RCM',
        path: '/2b-rcm-group',
        icon: <FileText className="h-5 w-5" />,
        roles: ['superadmin', 'gst_manager', 'employee'],
        children: [
          {
            label: '2B Reconciliation',
            path: '/2b-reconciliation',
            icon: <FileText className="h-4 w-4" />,
          },
          {
            label: 'Suspended Reco',
            path: '/suspended-reco',
            icon: <FileText className="h-4 w-4" />,
          },
          {
            label: 'RCM Summary',
            path: '/rcm-summary',
            icon: <Calculator className="h-4 w-4" />,
          },
        ],
      },
      {
        label: 'ITC Summary',
        path: '/itc-summary',
        icon: <Calculator className="h-5 w-5" />,
        roles: ['superadmin', 'gst_manager', 'employee'],
      },
      {
        label: 'Filing Status',
        path: '/filing-status',
        icon: <ClipboardList className="h-5 w-5" />,
        roles: ['superadmin', 'gst_manager', 'employee'],
      },
      {
        label: 'GST Running Update',
        path: '/gst-running-update',
        icon: <FileSpreadsheet className="h-5 w-5" />,
        roles: ['superadmin', 'gst_manager', 'employee'],
      },
    ];

    return items;
  };

  const navItems = getNavItems();

  const filteredNavItems = navItems.filter(item => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'superadmin': return 'Super Admin';
      case 'gst_manager': return 'GST Manager';
      case 'employee': return 'Employee';
      case 'client': return 'Client';
      default: return role;
    }
  };

  // Check if any child route is active
  const isGroupActive = (children?: NavItem[]) => {
    if (!children) return false;
    return children.some(child => location.pathname === child.path);
  };

  if (isMinimized) {
    return (
      <aside className="fixed left-0 top-0 h-screen w-14 bg-sidebar text-sidebar-foreground flex flex-col shadow-sidebar z-50 transition-all duration-300">
        {/* Minimized header with expand button */}
        <div className="p-2 border-b border-sidebar-border flex flex-col items-center gap-2">
          <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center p-1">
            <img src={logo} alt="VJ Desai" className="h-full w-auto object-contain" />
          </div>
          <button
            onClick={onToggleMinimize}
            className="p-1.5 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Minimized nav - icons only */}
        <nav className="flex-1 py-4 px-2 space-y-2 overflow-y-auto">
          {filteredNavItems.map((item) => {
            if (item.children) {
              return item.children.map((child) => (
                <NavLink
                  key={child.path}
                  to={child.path}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center justify-center p-2 rounded-lg transition-all duration-200',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                    )
                  }
                  title={child.label}
                >
                  {child.icon}
                </NavLink>
              ));
            }
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-center p-2 rounded-lg transition-all duration-200',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )
                }
                title={item.label}
              >
                {item.icon}
              </NavLink>
            );
          })}
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
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col shadow-sidebar z-50 transition-all duration-300">
      {/* Logo Section with Settings and User Control icons */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-white rounded-lg flex items-center justify-center p-1">
              <img src={logo} alt="VJ Desai" className="h-full w-auto object-contain" />
            </div>
            <div>
              <h1 className="font-heading font-semibold text-sidebar-primary text-sm">
                VJ Desai & Co.
              </h1>
              <p className="text-xs text-sidebar-foreground/70">GST Management</p>
            </div>
          </div>
          
          {/* Icon buttons for Settings, User Control, and Minimize */}
          <div className="flex items-center gap-1">
            {onToggleMinimize && (
              <button
                onClick={onToggleMinimize}
                className="p-2 rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
                title="Minimize sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {canManageEmployees() && (
              <NavLink
                to="/user-control"
                className={({ isActive }) =>
                  cn(
                    'p-2 rounded-lg transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )
                }
                title="User Control"
              >
                <Shield className="h-4 w-4" />
              </NavLink>
            )}
            {isStaffRole() && (
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  cn(
                    'p-2 rounded-lg transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )
                }
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </NavLink>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {filteredNavItems.map((item) => {
          // If item has children, render as collapsible group
          if (item.children) {
            const isActive = isGroupActive(item.children);
            return (
              <Collapsible
                key={item.path}
                open={is2BRCMOpen || isActive}
                onOpenChange={setIs2BRCMOpen}
              >
                <CollapsibleTrigger
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 w-full',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {is2BRCMOpen || isActive ? (
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  ) : (
                    <ChevronRight className="h-4 w-4 ml-auto" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-4 pt-1 space-y-1">
                  {item.children.map((child) => (
                    <NavLink
                      key={child.path}
                      to={child.path}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                          isActive
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                        )
                      }
                    >
                      {child.icon}
                      <span>{child.label}</span>
                    </NavLink>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          }

          // Regular nav item
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                )
              }
            >
              {item.icon}
              <span>{item.label}</span>
              <ChevronRight className="h-4 w-4 ml-auto opacity-50" />
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
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
