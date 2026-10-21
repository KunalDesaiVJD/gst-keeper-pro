import React from 'react';
import { useNavigate } from 'react-router-dom';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { WS_BTN } from '@/components/workspace/theme';
import { historyLink, type HistoryPageKey } from '@/lib/changeHistory';

/**
 * "History" on a GST working page: opens Change history filtered to this
 * page's client and month. Shown to whoever may see the change history
 * (superadmin, GST Manager, or the Change history key).
 */
export const ChangeHistoryButton: React.FC<{
  page: HistoryPageKey;
  clientId?: string | null;
  month?: string | null;
  className?: string;
}> = ({ page, clientId, month, className }) => {
  const { canViewChangeHistory } = useAuth();
  const navigate = useNavigate();
  if (!canViewChangeHistory()) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className={className ?? WS_BTN}
      onClick={() => navigate(historyLink(page, clientId, month))}
      title="Who changed what on this page, and when"
    >
      <History className="h-3.5 w-3.5" />
      History
    </Button>
  );
};

export default ChangeHistoryButton;
