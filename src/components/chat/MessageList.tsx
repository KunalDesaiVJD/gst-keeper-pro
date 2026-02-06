import React, { useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import MessageBubble from './MessageBubble';
import { ChatMessage } from '@/hooks/useChatMessages';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  allUsers: { id: string; name: string }[];
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  hasMore,
  onLoadMore,
  allUsers,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);
  const isNearBottom = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check if near bottom (within 100px)
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;

    // Load more when scrolled to top
    if (el.scrollTop < 50 && hasMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore]);

  // Auto-scroll to bottom on new messages (only if near bottom)
  useEffect(() => {
    if (messages.length > prevMessageCount.current && isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  // Scroll to bottom on first load
  useEffect(() => {
    if (messages.length > 0 && prevMessageCount.current === 0) {
      bottomRef.current?.scrollIntoView();
    }
  }, [messages.length]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-3"
    >
      {isLoading && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <p className="text-center text-xs text-muted-foreground py-2">Beginning of chat</p>
      )}
      {messages.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">No messages yet</p>
          <p className="text-xs">Start the conversation!</p>
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          senderName={msg.sender_name}
          senderRole={msg.sender_role}
          senderId={msg.sender_id}
          message={msg.message}
          mentions={msg.mentions}
          createdAt={msg.created_at}
          allUsers={allUsers}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};

export default MessageList;
