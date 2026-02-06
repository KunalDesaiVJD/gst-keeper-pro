import React, { useEffect, useState, useCallback } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MessageList from './MessageList';
import MentionInput from './MentionInput';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface StaffUser {
  id: string;
  name: string;
  role: string;
}

const ChatWidget: React.FC = () => {
  const { user } = useAuth();
  const {
    messages,
    isLoading,
    hasMore,
    unreadCount,
    isChatOpen,
    setIsChatOpen,
    loadMessages,
    loadMore,
    sendMessage,
    markAsRead,
  } = useChatMessages();

  const [allUsers, setAllUsers] = useState<StaffUser[]>([]);

  // Fetch all staff users for @mention
  useEffect(() => {
    const fetchUsers = async () => {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, first_name');
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (profiles && roles) {
        const roleMap = new Map(roles.map(r => [r.user_id, r.role]));
        const users: StaffUser[] = profiles
          .filter(p => roleMap.has(p.user_id))
          .map(p => ({
            id: p.user_id,
            name: p.first_name,
            role: roleMap.get(p.user_id) || 'employee',
          }))
          .filter(u => u.id !== user?.id); // Exclude self
        setAllUsers(users);
      }
    };
    if (user) fetchUsers();
  }, [user]);

  const handleOpen = useCallback(() => {
    setIsChatOpen(true);
    loadMessages();
    markAsRead();
  }, [setIsChatOpen, loadMessages, markAsRead]);

  const handleClose = useCallback(() => {
    setIsChatOpen(false);
    markAsRead();
  }, [setIsChatOpen, markAsRead]);

  const handleSend = useCallback((text: string, mentionIds: string[]) => {
    sendMessage(text, mentionIds);
  }, [sendMessage]);

  // Mark as read whenever new messages come in and chat is open
  useEffect(() => {
    if (isChatOpen && messages.length > 0) {
      markAsRead();
    }
  }, [isChatOpen, messages.length, markAsRead]);

  if (!user) return null;

  return (
    <>
      {/* Floating chat button */}
      {!isChatOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center"
          aria-label="Open chat"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {isChatOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[380px] h-[540px] bg-background border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary/5">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-sm">Team Chat</h3>
                <p className="text-[10px] text-muted-foreground">{allUsers.length + 1} members</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <MessageList
            messages={messages}
            isLoading={isLoading}
            hasMore={hasMore}
            onLoadMore={loadMore}
            allUsers={allUsers.map(u => ({ id: u.id, name: u.name }))}
          />

          {/* Input */}
          <MentionInput
            onSend={handleSend}
            users={allUsers}
          />
        </div>
      )}
    </>
  );
};

export default ChatWidget;
