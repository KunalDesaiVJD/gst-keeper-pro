import React, { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar, { SidebarContents } from './Sidebar';
import QuickActionsButton from './QuickActionsButton';
import ChatWidget from '@/components/chat/ChatWidget';
import { Loader2, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo.png';

const MainLayout: React.FC = () => {
  const { isAuthenticated, isLoading, isStaffRole } = useAuth();
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

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
          className="w-72 p-0 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col md:hidden"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContents onNavigate={() => setIsMobileNavOpen(false)} />
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
        </header>

        <main className="min-h-screen px-4 py-4 md:p-6">
          <Outlet />
        </main>
      </div>

      {/* Quick actions floating button - only for staff */}
      {isStaffRole() && <QuickActionsButton />}
      {isStaffRole() && <ChatWidget />}
    </div>
  );
};

export default MainLayout;
