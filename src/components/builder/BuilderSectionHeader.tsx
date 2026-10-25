import * as React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  /** One line on what the section does, printed under the title rather than run into it. */
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** A workspace step rather than its own route. */
  embedded?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * The heading of a Builder step or page.
 *
 * PageHeader's compact form runs the subtitle into the title after a "·", which
 * on these pages made one sentence-long heading ("Project — Bookings & Receipts ·
 * Advances bear tax on receipt …"). Here the title stays short and the
 * explanation sits under it in small type, so the eye lands on the step name
 * and the actions, and the explanation is there when wanted.
 */
export const BuilderSectionHeader: React.FC<Props> = ({ title, subtitle, icon, actions, embedded = false, className }) => (
  // Standalone, it is the page's top line: leave room for the fixed notification bell.
  <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 border-b pb-2.5', !embedded && 'md:pr-12', className)}>
    <div className="mr-auto flex min-w-0 items-start gap-2.5">
      {icon && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h2 className="font-heading text-base font-bold leading-tight text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export default BuilderSectionHeader;
