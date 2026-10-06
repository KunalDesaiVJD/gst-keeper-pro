import React from 'react';
import { initials } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

/** Owner initials in a circle; a dashed circle with screen-reader text when nobody owns it (U-12-4). */
export const OwnerChip: React.FC<{ name: string | null | undefined; showName?: boolean; className?: string }> = ({ name, showName, className }) => (
  <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={name || 'Unassigned'}>
    {name ? (
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
        {initials(name)}
      </span>
    ) : (
      <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/60 text-[10px] text-muted-foreground">?</span>
    )}
    {showName ? <span className={cn('truncate text-xs', !name && 'text-muted-foreground')}>{name || 'Unassigned'}</span>
      : <span className="sr-only">{name ? `Owner ${name}` : 'Unassigned'}</span>}
  </span>
);

export default OwnerChip;
