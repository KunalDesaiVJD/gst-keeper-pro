import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { 
  LayoutDashboard, 
  FileText, 
  Calculator, 
  ClipboardList, 
  LogOut,
  Users,
  ChevronRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: ('superadmin' | 'gst_manager' | 'employee' | 'client')[];
}

const Sidebar: React.FC = () => {
  const { user, logout, canManageEmployees, isStaffRole } = useAuth();
  const navigate = useNavigate();

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
        label: '2B Reconciliation',
        path: '/2b-reconciliation',
        icon: <FileText className="h-5 w-5" />,
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
    ];

    // Add Employee Management for Superadmin
    if (canManageEmployees()) {
      items.push({
        label: 'Manage Employees',
        path: '/manage-employees',
        icon: <Users className="h-5 w-5" />,
        roles: ['superadmin'],
      });
    }

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

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col shadow-sidebar z-50">
      {/* Logo Section */}
      <div className="p-4 border-b border-sidebar-border">
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {filteredNavItems.map((item) => (
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
        ))}
      </nav>

      {/* User Section */}
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 mb-3">
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
        </div>
        
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
