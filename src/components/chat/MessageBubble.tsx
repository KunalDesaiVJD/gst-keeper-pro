import React from 'react';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';

interface MessageBubbleProps {
  senderName: string;
  senderRole: string;
  senderId: string;
  message: string;
  mentions: string[];
  createdAt: string;
  allUsers: { id: string; name: string }[];
}

const roleLabel = (role: string) => {
  switch (role) {
    case 'superadmin': return 'Superadmin';
    case 'gst_manager': return 'Manager';
    case 'employee': return 'Employee';
    case 'client': return 'Client';
    default: return role;
  }
};

const roleBadgeClass = (role: string) => {
  switch (role) {
    case 'superadmin': return 'bg-primary/15 text-primary';
    case 'gst_manager': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'employee': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    default: return 'bg-muted text-muted-foreground';
  }
};

const renderMessageWithMentions = (message: string, allUsers: { id: string; name: string }[]) => {
  // Match @Name patterns
  const parts = message.split(/(@\w+(?:\s\w+)?)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const mentionedName = part.slice(1);
      const found = allUsers.find(u => u.name.toLowerCase() === mentionedName.toLowerCase());
      if (found) {
        return (
          <span key={i} className="font-semibold text-primary bg-primary/10 rounded px-1">
            {part}
          </span>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  senderName,
  senderRole,
  senderId,
  message,
  mentions,
  createdAt,
  allUsers,
}) => {
  const { user } = useAuth();
  const isOwn = user?.id === senderId;

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isOwn
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-muted rounded-bl-md'
        }`}
      >
        {!isOwn && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">{senderName}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${roleBadgeClass(senderRole)}`}>
              {roleLabel(senderRole)}
            </span>
          </div>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">
          {renderMessageWithMentions(message, allUsers)}
        </p>
        <p className={`text-[10px] mt-1 ${isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {format(new Date(createdAt), 'dd MMM, HH:mm')}
        </p>
      </div>
    </div>
  );
};

export default MessageBubble;
