import React, { useState } from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BulkSyncDialog } from './BulkSyncDialog';

// Floating "Sync from portal" trigger. Sits just above the Quick Actions button
// (which is at bottom-6 right-6) and opens the one-click Bulk Sync pop-up.
const BulkSyncButton: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-24 right-6 z-50 group flex items-center gap-2">
        <span className="pointer-events-none rounded-md bg-foreground/90 px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
          Sync from portal
        </span>
        <button
          onClick={() => setOpen(true)}
          aria-label="Sync from GST portal"
          className={cn(
            'h-14 w-14 rounded-full bg-blue-600 text-white shadow-lg flex items-center justify-center',
            'transition-all duration-300 hover:bg-blue-700 hover:scale-105',
          )}
        >
          <Globe className="h-6 w-6" />
        </button>
      </div>
      <BulkSyncDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

export default BulkSyncButton;
