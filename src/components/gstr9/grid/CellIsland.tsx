import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Keeps clicks, keys and pastes inside a cell widget (a popover, a button)
 * away from the grid's own keyboard and mouse handling — React events bubble
 * through portals, so without this the grid would swallow what is typed into
 * a popover's box, and take the click meant for the button.
 */
export const CellIsland: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className={cn('inline-flex items-center gap-1', className)} onMouseDown={stop} onKeyDown={stop} onPaste={stop} onDoubleClick={stop}>
      {children}
    </span>
  );
};

export default CellIsland;
