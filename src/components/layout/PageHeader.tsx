import * as React from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional leading icon, shown in a rounded primary tint box. */
  icon?: React.ReactNode;
  /** Right-aligned action controls (buttons, etc.). */
  actions?: React.ReactNode;
  /** When rendered as a tab body, use a smaller heading (avoids double page-title). */
  embedded?: boolean;
  /**
   * The Annual Return (GSTR-9/9C) look: one dense row — small icon tile, a
   * text-lg title with the subtitle inline after a "·", and the actions on the
   * same line. Leaves room on the right for the fixed notification bell.
   */
  compact?: boolean;
  className?: string;
}

/**
 * The one page header for the whole app — title + subtitle + optional icon and a
 * right-aligned actions slot. Replaces the ~15 hand-copied header blocks so
 * typography, spacing and the action bar stay consistent everywhere.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  embedded = false,
  compact = false,
  className,
}) => compact ? (
  <div className={cn('flex flex-wrap items-center gap-2', !embedded && 'md:pr-12', className)}>
    <div className="mr-auto flex min-w-0 items-center gap-2">
      {icon && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </div>
      )}
      <h1 className={cn('truncate font-heading font-bold leading-tight text-foreground', embedded ? 'text-base' : 'text-lg')}>
        {title}
        {subtitle && <span className="font-semibold text-muted-foreground"> · {subtitle}</span>}
      </h1>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
) : (
  <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
    <div className="flex items-center gap-3 min-w-0">
      {icon && (
        <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0 flex items-center justify-center">
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <h1 className={cn('font-heading font-bold text-foreground', embedded ? 'text-xl' : 'text-2xl')}>
          {title}
        </h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
