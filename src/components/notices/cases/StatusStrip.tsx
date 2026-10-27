// The status of a case or a notice as one labelled strip under its title (the
// firm, 27 October 2026: the chips in a row read as noise). Each cell says
// what it is ("Where it stands", "Next date", "Owner") above its value, so the
// eye finds the answer by its label, not by the colour of a pill.
import React from 'react';
import { cn } from '@/lib/utils';

export interface StatusCell {
  label: string;
  children: React.ReactNode;
  /** Hidden when false (a cell with nothing to say is left out). */
  show?: boolean;
  className?: string;
}

export const StatusStrip: React.FC<{ cells: StatusCell[]; className?: string }> = ({ cells, className }) => {
  const shown = cells.filter((c) => c.show !== false);
  if (!shown.length) return null;
  return (
    <div className={cn('grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:flex sm:flex-wrap sm:divide-y-0', className)}>
      {shown.map((c) => (
        <div key={c.label} className={cn('min-w-0 px-3.5 py-2 sm:flex-1 sm:basis-40', c.className)}>
          <div className="text-xs font-medium text-muted-foreground">{c.label}</div>
          <div className="mt-1 flex min-h-[1.5rem] flex-wrap items-center gap-1.5 text-sm font-medium">{c.children}</div>
        </div>
      ))}
    </div>
  );
};

export default StatusStrip;
