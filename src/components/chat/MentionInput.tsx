import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MentionUser {
  id: string;
  name: string;
  role: string;
}

interface MentionInputProps {
  onSend: (text: string, mentionIds: string[]) => void;
  users: MentionUser[];
}

const roleLabel = (role: string) => {
  switch (role) {
    case 'superadmin': return 'Superadmin';
    case 'gst_manager': return 'Manager';
    case 'employee': return 'Employee';
    default: return role;
  }
};

const MentionInput: React.FC<MentionInputProps> = ({ onSend, users }) => {
  const [text, setText] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    // Detect @ trigger
    const cursorPos = e.target.selectionStart || 0;
    const beforeCursor = val.slice(0, cursorPos);
    const atIdx = beforeCursor.lastIndexOf('@');

    if (atIdx !== -1 && (atIdx === 0 || beforeCursor[atIdx - 1] === ' ' || beforeCursor[atIdx - 1] === '\n')) {
      const query = beforeCursor.slice(atIdx + 1);
      if (!query.includes(' ') || query.length < 20) {
        setMentionFilter(query);
        setShowMentions(true);
        setSelectedIdx(0);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = useCallback((user: MentionUser) => {
    const cursorPos = inputRef.current?.selectionStart || text.length;
    const beforeCursor = text.slice(0, cursorPos);
    const atIdx = beforeCursor.lastIndexOf('@');
    const after = text.slice(cursorPos);
    const newText = beforeCursor.slice(0, atIdx) + `@${user.name} ` + after;
    setText(newText);
    setMentionIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
    setShowMentions(false);
    inputRef.current?.focus();
  }, [text]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(prev => Math.min(prev + 1, filteredUsers.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        insertMention(filteredUsers[selectedIdx]);
        return;
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text, mentionIds);
    setText('');
    setMentionIds([]);
  };

  return (
    <div className="relative border-t bg-background px-3 py-2">
      {showMentions && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-popover border rounded-lg shadow-lg max-h-40 overflow-y-auto z-50">
          {filteredUsers.map((u, i) => (
            <button
              key={u.id}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent ${
                i === selectedIdx ? 'bg-accent' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u);
              }}
            >
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-muted-foreground">({roleLabel(u.role)})</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... Use @ to mention"
          rows={1}
          className="flex-1 resize-none bg-muted rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary max-h-24 overflow-y-auto"
          style={{ minHeight: '36px' }}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!text.trim()}
          className="shrink-0 h-9 w-9 rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default MentionInput;
