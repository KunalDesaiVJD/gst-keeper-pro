import React, { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Sidebar from './Sidebar';
import QuickActionsButton from './QuickActionsButton';
import ChatWidget from '@/components/chat/ChatWidget';
import { Loader2 } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { isAuthenticated, isLoading, isStaffRole } = useAuth();
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);

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
      <Sidebar 
        isMinimized={isSidebarMinimized} 
        onToggleMinimize={() => setIsSidebarMinimized(!isSidebarMinimized)} 
      />
      <main className={`min-h-screen p-6 transition-all duration-300 ${isSidebarMinimized ? 'ml-14' : 'ml-64'}`}>
        <Outlet />
      </main>
      {/* Quick actions floating button - only for staff */}
      {isStaffRole() && <QuickActionsButton />}
      {isStaffRole() && <ChatWidget />}
    </div>
  );
};

export default MainLayout;
