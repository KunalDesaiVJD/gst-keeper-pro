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
  className,
}) => (
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
