import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, Navigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyWithReload } from '@/lib/chunkReload';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar, { SidebarContents } from './Sidebar';
import NotificationBell from '@/components/notices/NotificationBell';
import SearchPalette from '@/components/notices/SearchPalette';
import AutopilotBadge from '@/components/notices/autopilot/AutopilotBadge';
import { Loader2, Lock, Menu } from 'lucide-react';
import { PERMISSION_LABEL, moduleForPath, type ModuleKey } from '@/lib/permissionCatalog';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { PageLoading } from './PageLoading';
import logo from '@/assets/logo.png';
import { checkForNewBuild, installBuildWatcher, newBuildAvailable } from '@/lib/buildVersion';

// The GST Assistant, loaded once a staff page is up.
// The assistant never takes the screen down with it: its own chunk reloads
// like a page's after a deploy, and an error in it hides only the panel.
const AssistantPanel = lazyWithReload(() => import('@/components/assistant/AssistantPanel'));
class AssistantBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('[GST Assistant]', error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** A screen the employee's role does not open (User Control → Roles). */
const NoScreenAccess: React.FC<{ module: ModuleKey | null }> = ({ module }) => (
  <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
    <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
    <h1 className="text-base font-semibold">This screen is not in your role</h1>
    <p className="mt-1 text-sm text-muted-foreground">
      Your role does not include {module ? <b>{PERMISSION_LABEL[module]?.replace(/^Open /, '')}</b> : 'this screen'}.
      Ask a GST Manager to add it to your role, or to give it to you as an extra.
    </p>
    <Button asChild size="sm" className="mt-4"><Link to="/dashboard">Go to Dashboard</Link></Button>
  </div>
);

const MainLayout: React.FC = () => {
  const { isAuthenticated, isLoading, isStaffRole, canOpenPath, canOpenModule } = useAuth();
  const location = useLocation();
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(true);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  // A newer build was deployed while this tab was open: its old page files are
  // gone, so the next page change loads the new build in full (buildVersion.ts).
  useEffect(() => { installBuildWatcher(); }, []);
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    if (newBuildAvailable()) window.location.reload();
    else void checkForNewBuild();
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop fixed rail (hidden below md) */}
      <Sidebar
        isMinimized={isSidebarMinimized}
        onToggleMinimize={() => setIsSidebarMinimized(!isSidebarMinimized)}
      />

      {/* Mobile drawer holding the exact same nav */}
      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col md:hidden [&>button]:right-3 [&>button]:top-6 [&>button]:p-1 [&>button]:text-sidebar-foreground [&>button]:opacity-100"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContents inDrawer onNavigate={() => setIsMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn('transition-all duration-300', isSidebarMinimized ? 'md:ml-14' : 'md:ml-64')}>
        {/* Mobile top bar with hamburger (hidden at md and up) */}
        <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-card px-4 py-2 shadow-sm">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation menu"
            onClick={() => setIsMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src={logo} alt="V. J. Desai & Co. LLP" className="h-7 w-auto object-contain" />
          <div className="ml-auto">{isStaffRole() && <NotificationBell />}</div>
        </header>

        {/* Desktop notification bell */}
        <div className="hidden md:fixed md:top-4 md:right-4 md:z-40 md:block">
          {isStaffRole() && <NotificationBell />}
        </div>

        <main className="min-h-screen px-4 pb-24 pt-4 md:px-6 md:pb-24 md:pt-6">
          {/* CAPTCHAs waiting for a person (portal autopilot), on every staff page. */}
          {isStaffRole() && <AutopilotBadge />}
          {/* The sidebar stays while the next page's code loads. */}
          {/* A page that fails shows a message here; the sidebar stays (never a blank screen). */}
          <ErrorBoundary resetKey={location.pathname}>
            {isStaffRole() && !canOpenPath(location.pathname)
              ? <NoScreenAccess module={moduleForPath(location.pathname)} />
              : <Suspense fallback={<PageLoading />}><Outlet /></Suspense>}
          </ErrorBoundary>
        </main>
        {isStaffRole() && canOpenModule('module_assistant') && <AssistantBoundary><Suspense fallback={null}><AssistantPanel /></Suspense></AssistantBoundary>}
      </div>

      {/* Ctrl K / ⌘K search over clients and notices - only for staff */}
      {isStaffRole() && <SearchPalette />}

      {/* Quick actions floating button - only for staff */}
    </div>
  );
};

export default MainLayout;
