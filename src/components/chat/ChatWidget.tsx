import React, { useEffect, useState, useCallback } from 'react';
import { MessageCircle, X, Users, User, ArrowLeft, Plus, UserPlus, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import MessageList from './MessageList';
import MentionInput from './MentionInput';
import { useChannelChat, ChatChannel } from '@/hooks/useChannelChat';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface StaffUser {
  id: string;
  name: string;
  role: string;
}

const ChatWidget: React.FC = () => {
  const { user } = useAuth();
  const {
    channels,
    activeChannelId,
    messages,
    isLoading,
    hasMore,
    totalUnread,
    selectChannel,
    loadMessages,
    loadMore,
    sendMessage,
    markAsRead,
    startDM,
    fetchChannels,
  } = useChannelChat();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<StaffUser[]>([]);
  const [showNewDM, setShowNewDM] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [existingMembers, setExistingMembers] = useState<string[]>([]);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);
  const [isAddingMembers, setIsAddingMembers] = useState(false);

  // Fetch all staff users for @mention and DM list
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
          .filter(u => u.id !== user?.id);
        setAllUsers(users);
      }
    };
    if (user) fetchUsers();
  }, [user]);

  const handleOpen = useCallback(() => {
    setIsChatOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsChatOpen(false);
    if (activeChannelId) markAsRead();
  }, [activeChannelId, markAsRead]);

  const handleSelectChannel = useCallback((channelId: string) => {
    selectChannel(channelId);
    loadMessages(channelId);
    markAsRead(channelId);
    setShowNewDM(false);
  }, [selectChannel, loadMessages, markAsRead]);

  const handleStartDM = useCallback(async (otherUserId: string) => {
    const channelId = await startDM(otherUserId);
    if (channelId) {
      loadMessages(channelId);
      markAsRead(channelId);
      setShowNewDM(false);
    }
  }, [startDM, loadMessages, markAsRead]);

  const handleSend = useCallback((text: string, mentionIds: string[]) => {
    sendMessage(text, mentionIds);
  }, [sendMessage]);

  const handleCreateGroup = useCallback(async () => {
    if (!user || !groupName.trim() || selectedGroupMembers.length === 0) {
      toast.error('Please enter a group name and select at least one member');
      return;
    }

    setIsCreatingGroup(true);
    try {
      // Create the group channel
      const { data: newChannel, error } = await supabase
        .from('chat_channels')
        .insert({ channel_type: 'group', name: groupName.trim(), created_by: user.id })
        .select()
        .single();

      if (error || !newChannel) throw error || new Error('Failed to create group');

      // Add all members including the creator
      const members = [user.id, ...selectedGroupMembers].map(uid => ({
        channel_id: newChannel.id,
        user_id: uid,
      }));

      await supabase.from('chat_channel_members').insert(members);

      // Reset state
      setShowNewGroup(false);
      setGroupName('');
      setSelectedGroupMembers([]);
      setGroupSearch('');

      // Refresh channels and navigate to new group
      await fetchChannels();
      selectChannel(newChannel.id);
      loadMessages(newChannel.id);
      toast.success('Group created successfully');
    } catch (error: any) {
      toast.error('Failed to create group: ' + error.message);
    } finally {
      setIsCreatingGroup(false);
    }
  }, [user, groupName, selectedGroupMembers, fetchChannels, selectChannel, loadMessages]);

  // Mark as read when messages change
  useEffect(() => {
    if (isChatOpen && activeChannelId && messages.length > 0) {
      markAsRead();
    }
  }, [isChatOpen, activeChannelId, messages.length, markAsRead]);

  if (!user) return null;

  const activeChannel = channels.find(c => c.id === activeChannelId);
  const channelDisplayName = activeChannel
    ? activeChannel.channel_type === 'group'
      ? activeChannel.name || 'Team Chat'
      : activeChannel.otherUserName || 'Direct Message'
    : '';

  const filteredDMUsers = allUsers.filter(u =>
    !dmSearch || u.name.toLowerCase().includes(dmSearch.toLowerCase())
  );

  const filteredGroupUsers = allUsers.filter(u =>
    !groupSearch || u.name.toLowerCase().includes(groupSearch.toLowerCase())
  );

  // Check if user already has DM with a user
  const existingDMChannelForUser = (userId: string) =>
    channels.find(c => c.channel_type === 'dm' && c.otherUserId === userId);

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
          {totalUnread > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {isChatOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[560px] bg-background border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary/5">
            <div className="flex items-center gap-2">
              {activeChannelId && (
                <Button variant="ghost" size="icon" onClick={() => { selectChannel(''); setShowNewDM(false); }} className="h-7 w-7">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <MessageCircle className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-sm">
                  {activeChannelId ? channelDisplayName : 'Messages'}
                </h3>
                {!activeChannelId && (
                  <p className="text-[10px] text-muted-foreground">{channels.length} conversations</p>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Channel List View */}
          {!activeChannelId && !showNewDM && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-2 border-b flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 flex items-center gap-2" onClick={() => setShowNewDM(true)}>
                  <Plus className="h-4 w-4" />
                  New Chat
                </Button>
                <Button variant="outline" size="sm" className="flex-1 flex items-center gap-2" onClick={() => setShowNewGroup(true)}>
                  <UserPlus className="h-4 w-4" />
                  New Group
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {/* Group channels */}
                  {channels.filter(c => c.channel_type === 'group').map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => handleSelectChannel(ch.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{ch.name || 'Team Chat'}</span>
                          {(ch.unreadCount || 0) > 0 && (
                            <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                              {ch.unreadCount}
                            </span>
                          )}
                        </div>
                        {ch.lastMessage && (
                          <p className="text-xs text-muted-foreground truncate">{ch.lastMessage}</p>
                        )}
                      </div>
                    </button>
                  ))}

                  {/* DM section header */}
                  <div className="flex items-center justify-between px-3 pt-3 pb-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Direct Messages</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNewDM(true)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* DM channels */}
                  {channels.filter(c => c.channel_type === 'dm').map(ch => (
                    <button
                      key={ch.id}
                      onClick={() => handleSelectChannel(ch.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left"
                    >
                      <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{ch.otherUserName || 'User'}</span>
                          {(ch.unreadCount || 0) > 0 && (
                            <span className="h-5 min-w-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                              {ch.unreadCount}
                            </span>
                          )}
                        </div>
                        {ch.lastMessage && (
                          <p className="text-xs text-muted-foreground truncate">{ch.lastMessage}</p>
                        )}
                      </div>
                    </button>
                  ))}

                  {channels.filter(c => c.channel_type === 'dm').length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No direct messages yet. Click + to start one.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* New DM user selection */}
          {!activeChannelId && showNewDM && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-2 border-b">
                <Input
                  value={dmSearch}
                  onChange={(e) => setDmSearch(e.target.value)}
                  placeholder="Search users..."
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {filteredDMUsers.map(u => {
                    const existing = existingDMChannelForUser(u.id);
                    return (
                      <button
                        key={u.id}
                        onClick={() => existing ? handleSelectChannel(existing.id) : handleStartDM(u.id)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                      >
                        <div className="h-8 w-8 rounded-full bg-accent flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-accent-foreground" />
                        </div>
                        <div>
                          <span className="text-sm font-medium">{u.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">({u.role})</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
              <div className="p-2 border-t">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => { setShowNewDM(false); setDmSearch(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Active channel messages */}
          {activeChannelId && (
            <>
              <MessageList
                messages={messages.map(m => ({
                  id: m.id,
                  sender_id: m.sender_id,
                  sender_name: m.sender_name,
                  sender_role: m.sender_role,
                  message: m.message,
                  mentions: m.mentions,
                  created_at: m.created_at,
                }))}
                isLoading={isLoading}
                hasMore={hasMore}
                onLoadMore={loadMore}
                allUsers={allUsers.map(u => ({ id: u.id, name: u.name }))}
              />
              <MentionInput
                onSend={handleSend}
                users={allUsers}
              />
            </>
          )}
        </div>
      )}

      {/* New Group Dialog */}
      <Dialog open={showNewGroup} onOpenChange={setShowNewGroup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Group Name</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name..."
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium">Add Members ({selectedGroupMembers.length} selected)</label>
              <Input
                value={groupSearch}
                onChange={(e) => setGroupSearch(e.target.value)}
                placeholder="Search employees..."
                className="mt-1"
              />
              <ScrollArea className="h-48 mt-2 border rounded-md">
                <div className="p-2 space-y-1">
                  {filteredGroupUsers.map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedGroupMembers.includes(u.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedGroupMembers(prev => [...prev, u.id]);
                          } else {
                            setSelectedGroupMembers(prev => prev.filter(id => id !== u.id));
                          }
                        }}
                      />
                      <div>
                        <span className="text-sm font-medium">{u.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">({u.role})</span>
                      </div>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowNewGroup(false); setGroupName(''); setSelectedGroupMembers([]); setGroupSearch(''); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateGroup} disabled={isCreatingGroup || !groupName.trim() || selectedGroupMembers.length === 0}>
              {isCreatingGroup ? 'Creating...' : 'Create Group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ChatWidget;
