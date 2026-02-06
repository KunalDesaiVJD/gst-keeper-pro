import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  mentions: string[];
  created_at: string;
}

interface ProfileCache {
  [key: string]: { first_name: string; role: string };
}

const PAGE_SIZE = 30;

export const useChatMessages = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const profileCache = useRef<ProfileCache>({});
  const lastReadAt = useRef<string | null>(null);

  // Resolve sender profile
  const resolveProfile = useCallback(async (senderId: string): Promise<{ first_name: string; role: string }> => {
    if (profileCache.current[senderId]) return profileCache.current[senderId];

    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('user_id', senderId)
      .maybeSingle();

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', senderId)
      .maybeSingle();

    const result = {
      first_name: profile?.first_name || 'Unknown',
      role: roleData?.role || 'employee',
    };
    profileCache.current[senderId] = result;
    return result;
  }, []);

  // Enrich a raw message with profile data
  const enrichMessage = useCallback(async (raw: any): Promise<ChatMessage> => {
    const profile = await resolveProfile(raw.sender_id);
    return {
      id: raw.id,
      sender_id: raw.sender_id,
      sender_name: profile.first_name,
      sender_role: profile.role,
      message: raw.message,
      mentions: raw.mentions || [],
      created_at: raw.created_at,
    };
  }, [resolveProfile]);

  // Load messages
  const loadMessages = useCallback(async (before?: string) => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (before) {
        query = query.lt('created_at', before);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length < PAGE_SIZE) setHasMore(false);

      const enriched = await Promise.all((data || []).map(enrichMessage));
      const sorted = enriched.reverse();

      if (before) {
        setMessages(prev => [...sorted, ...prev]);
      } else {
        setMessages(sorted);
      }
    } catch (err) {
      console.error('Error loading messages:', err);
    } finally {
      setIsLoading(false);
    }
  }, [enrichMessage]);

  // Load more (older messages)
  const loadMore = useCallback(() => {
    if (messages.length > 0 && hasMore && !isLoading) {
      loadMessages(messages[0].created_at);
    }
  }, [messages, hasMore, isLoading, loadMessages]);

  // Send message
  const sendMessage = useCallback(async (text: string, mentionIds: string[]) => {
    if (!user || !text.trim()) return;

    const { error } = await supabase.from('chat_messages').insert({
      sender_id: user.id,
      message: text.trim(),
      mentions: mentionIds,
    });

    if (error) console.error('Error sending message:', error);
  }, [user]);

  // Mark as read
  const markAsRead = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    lastReadAt.current = now;
    setUnreadCount(0);

    await supabase.from('chat_read_status').upsert(
      { user_id: user.id, last_read_at: now },
      { onConflict: 'user_id' }
    );
  }, [user]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!user || isChatOpen) return;

    const { data: readData } = await supabase
      .from('chat_read_status')
      .select('last_read_at')
      .eq('user_id', user.id)
      .maybeSingle();

    const lr = readData?.last_read_at || '1970-01-01T00:00:00Z';
    lastReadAt.current = lr;

    const { count, error } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .gt('created_at', lr);

    if (!error && count) setUnreadCount(count);
  }, [user, isChatOpen]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('chat-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        async (payload) => {
          const enriched = await enrichMessage(payload.new);
          setMessages(prev => [...prev, enriched]);

          // Check if mentioned
          const mentions: string[] = payload.new.mentions || [];
          if (mentions.includes(user.id) && payload.new.sender_id !== user.id) {
            const senderProfile = await resolveProfile(payload.new.sender_id);
            // Use dynamic import to avoid circular deps
            const { toast } = await import('sonner');
            toast.info(`You were mentioned by ${senderProfile.first_name}`);
          }

          if (!isChatOpen && payload.new.sender_id !== user.id) {
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isChatOpen, enrichMessage, resolveProfile]);

  // Initial load + unread count
  useEffect(() => {
    if (user) {
      fetchUnreadCount();
    }
  }, [user, fetchUnreadCount]);

  return {
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
  };
};
