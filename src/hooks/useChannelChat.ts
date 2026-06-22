import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ChannelMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  mentions: string[];
  created_at: string;
}

export interface ChatChannel {
  id: string;
  channel_type: 'group' | 'dm';
  name: string | null;
  created_at: string;
  // Computed fields
  otherUserName?: string;
  otherUserId?: string;
  unreadCount?: number;
  lastMessage?: string;
  lastMessageAt?: string;
}

interface ProfileCache {
  [key: string]: { first_name: string; role: string };
}

const PAGE_SIZE = 30;

export const useChannelChat = () => {
  const { user } = useAuth();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const profileCache = useRef<ProfileCache>({});

  const totalUnread = channels.reduce((sum, ch) => sum + (ch.unreadCount || 0), 0);

  const resolveProfile = useCallback(async (userId: string): Promise<{ first_name: string; role: string }> => {
    if (profileCache.current[userId]) return profileCache.current[userId];
    const { data: profile } = await supabase.from('profiles').select('first_name').eq('user_id', userId).maybeSingle();
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    const result = { first_name: profile?.first_name || 'Unknown', role: roleData?.role || 'employee' };
    profileCache.current[userId] = result;
    return result;
  }, []);

  // Fetch channels the user is a member of
  const fetchChannels = useCallback(async () => {
    if (!user) return;

    // Get all channel IDs the user is a member of
    const { data: memberships } = await supabase
      .from('chat_channel_members')
      .select('channel_id')
      .eq('user_id', user.id);

    if (!memberships || memberships.length === 0) {
      // Auto-join group channels
      const { data: groupChannels } = await supabase
        .from('chat_channels')
        .select('*')
        .eq('channel_type', 'group');
      
      if (groupChannels && groupChannels.length > 0) {
        for (const ch of groupChannels) {
          await supabase.from('chat_channel_members').insert({ channel_id: ch.id, user_id: user.id });
        }
        // Refetch
        return fetchChannels();
      }
      setChannels([]);
      return;
    }

    const channelIds = memberships.map(m => m.channel_id);
    const { data: channelData } = await supabase
      .from('chat_channels')
      .select('*')
      .in('id', channelIds)
      .order('created_at');

    if (!channelData) { setChannels([]); return; }

    // Get read status for each channel
    const { data: readStatuses } = await supabase
      .from('chat_channel_read_status')
      .select('channel_id, last_read_at')
      .eq('user_id', user.id)
      .in('channel_id', channelIds);

    const readMap = new Map((readStatuses || []).map(r => [r.channel_id, r.last_read_at]));

    // Enrich channels
    const enriched: ChatChannel[] = [];

    for (const ch of channelData) {
      let otherUserName: string | undefined;
      let otherUserId: string | undefined;

      if (ch.channel_type === 'dm') {
        const { data: members } = await supabase
          .from('chat_channel_members')
          .select('user_id')
          .eq('channel_id', ch.id)
          .neq('user_id', user.id);
        
        if (members && members.length > 0) {
          otherUserId = members[0].user_id;
          const profile = await resolveProfile(otherUserId);
          otherUserName = profile.first_name;
        }
      }

      // Count unread — exclude the current user's own messages so they don't
      // count toward their own unread badge.
      const lastRead = readMap.get(ch.id) || '1970-01-01T00:00:00Z';
      const { count } = await supabase
        .from('chat_channel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', ch.id)
        .neq('sender_id', user.id)
        .gt('created_at', lastRead);

      const unread = count || 0;

      // Get last message
      const { data: lastMsg } = await supabase
        .from('chat_channel_messages')
        .select('message, created_at')
        .eq('channel_id', ch.id)
        .order('created_at', { ascending: false })
        .limit(1);

      enriched.push({
        ...ch,
        channel_type: ch.channel_type as 'group' | 'dm',
        otherUserName,
        otherUserId,
        unreadCount: unread,
        lastMessage: lastMsg?.[0]?.message,
        lastMessageAt: lastMsg?.[0]?.created_at,
      });
    }

    // Collapse duplicate DM channels for the same user into one row (keep the
    // most recently active channel, fold unread counts into it) so a person
    // never appears more than once even if stray duplicate channels exist.
    const dmByUser = new Map<string, ChatChannel>();
    const deduped: ChatChannel[] = [];
    for (const ch of enriched) {
      if (ch.channel_type === 'dm' && ch.otherUserId) {
        const existing = dmByUser.get(ch.otherUserId);
        if (!existing) {
          dmByUser.set(ch.otherUserId, ch);
          deduped.push(ch);
          continue;
        }
        const existingTime = new Date(existing.lastMessageAt || existing.created_at).getTime();
        const chTime = new Date(ch.lastMessageAt || ch.created_at).getTime();
        if (chTime > existingTime) {
          ch.unreadCount = (ch.unreadCount || 0) + (existing.unreadCount || 0);
          deduped[deduped.indexOf(existing)] = ch;
          dmByUser.set(ch.otherUserId, ch);
        } else {
          existing.unreadCount = (existing.unreadCount || 0) + (ch.unreadCount || 0);
        }
      } else {
        deduped.push(ch);
      }
    }

    // Sort: group first, then DMs by last message
    deduped.sort((a, b) => {
      if (a.channel_type === 'group' && b.channel_type !== 'group') return -1;
      if (a.channel_type !== 'group' && b.channel_type === 'group') return 1;
      const aTime = a.lastMessageAt || a.created_at;
      const bTime = b.lastMessageAt || b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    setChannels(deduped);
  }, [user, resolveProfile]);

  // Load messages for active channel
  const loadMessages = useCallback(async (channelId?: string, before?: string) => {
    const cid = channelId || activeChannelId;
    if (!cid) return;

    setIsLoading(true);
    try {
      let query = supabase
        .from('chat_channel_messages')
        .select('*')
        .eq('channel_id', cid)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (before) query = query.lt('created_at', before);

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length < PAGE_SIZE) setHasMore(false);
      else setHasMore(true);

      const enriched: ChannelMessage[] = await Promise.all(
        (data || []).map(async (msg) => {
          const profile = await resolveProfile(msg.sender_id);
          return {
            id: msg.id,
            channel_id: msg.channel_id,
            sender_id: msg.sender_id,
            sender_name: profile.first_name,
            sender_role: profile.role,
            message: msg.message,
            mentions: msg.mentions || [],
            created_at: msg.created_at,
          };
        })
      );

      const sorted = enriched.reverse();
      if (before) {
        setMessages(prev => [...sorted, ...prev]);
      } else {
        setMessages(sorted);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeChannelId, resolveProfile]);

  // Send message
  const sendMessage = useCallback(async (text: string, mentionIds: string[]) => {
    if (!user || !activeChannelId || !text.trim()) return;

    await supabase.from('chat_channel_messages').insert({
      channel_id: activeChannelId,
      sender_id: user.id,
      message: text.trim(),
      mentions: mentionIds,
    });
  }, [user, activeChannelId]);

  // Mark channel as read
  const markAsRead = useCallback(async (channelId?: string) => {
    if (!user) return;
    const cid = channelId || activeChannelId;
    if (!cid) return;

    await supabase.from('chat_channel_read_status').upsert(
      { channel_id: cid, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'channel_id,user_id' }
    );

    setChannels(prev => prev.map(ch =>
      ch.id === cid ? { ...ch, unreadCount: 0 } : ch
    ));
  }, [user, activeChannelId]);

  // Start or find DM with a user
  const startDM = useCallback(async (otherUserId: string): Promise<string | null> => {
    if (!user) return null;

    // Find existing DM channel(s) with this user
    const { data: myChannels } = await supabase
      .from('chat_channel_members')
      .select('channel_id')
      .eq('user_id', user.id);

    const matchingDmIds: string[] = [];
    if (myChannels) {
      for (const mc of myChannels) {
        const { data: ch } = await supabase
          .from('chat_channels')
          .select('id')
          .eq('id', mc.channel_id)
          .eq('channel_type', 'dm')
          .maybeSingle();

        if (ch) {
          const { data: otherMember } = await supabase
            .from('chat_channel_members')
            .select('user_id')
            .eq('channel_id', ch.id)
            .eq('user_id', otherUserId)
            .maybeSingle();

          if (otherMember) matchingDmIds.push(ch.id);
        }
      }
    }

    if (matchingDmIds.length > 0) {
      // If duplicates exist, reuse the one with the most recent message so this
      // matches the channel the deduped list shows.
      const { data: latest } = await supabase
        .from('chat_channel_messages')
        .select('channel_id, created_at')
        .in('channel_id', matchingDmIds)
        .order('created_at', { ascending: false })
        .limit(1);
      const chosen = latest?.[0]?.channel_id || matchingDmIds[0];
      setActiveChannelId(chosen);
      return chosen;
    }

    // Create new DM channel
    const { data: newChannel, error } = await supabase
      .from('chat_channels')
      .insert({ channel_type: 'dm', created_by: user.id })
      .select()
      .single();

    if (error || !newChannel) return null;

    // Add both members
    await supabase.from('chat_channel_members').insert([
      { channel_id: newChannel.id, user_id: user.id },
      { channel_id: newChannel.id, user_id: otherUserId },
    ]);

    setActiveChannelId(newChannel.id);
    await fetchChannels();
    return newChannel.id;
  }, [user, fetchChannels]);

  // Select channel
  const selectChannel = useCallback((channelId: string) => {
    setActiveChannelId(channelId);
    setMessages([]);
    setHasMore(true);
  }, []);

  // Realtime subscription for new messages
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('channel-messages-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_channel_messages' },
        async (payload) => {
          const msg = payload.new as any;
          const profile = await resolveProfile(msg.sender_id);
          const enriched: ChannelMessage = {
            id: msg.id,
            channel_id: msg.channel_id,
            sender_id: msg.sender_id,
            sender_name: profile.first_name,
            sender_role: profile.role,
            message: msg.message,
            mentions: msg.mentions || [],
            created_at: msg.created_at,
          };

          // If it's for the active channel, add to messages
          if (msg.channel_id === activeChannelId) {
            setMessages(prev => [...prev, enriched]);
          }

          // Update channel list (unread, last message). Don't bump unread for
          // the user's own messages or for the channel they're currently viewing.
          const isOwnMessage = msg.sender_id === user.id;
          const isActiveChannel = msg.channel_id === activeChannelId;
          setChannels(prev => prev.map(ch => {
            if (ch.id === msg.channel_id) {
              return {
                ...ch,
                lastMessage: msg.message,
                lastMessageAt: msg.created_at,
                unreadCount: isActiveChannel || isOwnMessage ? (ch.unreadCount || 0) : (ch.unreadCount || 0) + 1,
              };
            }
            return ch;
          }));

          // Mention notification
          if (msg.mentions?.includes(user.id) && msg.sender_id !== user.id) {
            const { toast } = await import('sonner');
            toast.info(`${profile.first_name} mentioned you`);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, activeChannelId, resolveProfile]);

  // Initial load
  useEffect(() => {
    if (user) fetchChannels();
  }, [user, fetchChannels]);

  return {
    channels,
    activeChannelId,
    messages,
    isLoading,
    hasMore,
    totalUnread,
    selectChannel,
    loadMessages,
    sendMessage,
    markAsRead,
    startDM,
    fetchChannels,
    loadMore: useCallback(() => {
      if (messages.length > 0 && hasMore && !isLoading) {
        loadMessages(undefined, messages[0].created_at);
      }
    }, [messages, hasMore, isLoading, loadMessages]),
  };
};
