import React from 'react';
import { cn } from '@/lib/utils';

interface NoticesCardHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** Right-hand slot. A bare string renders as the module's muted count badge. */
  badge?: React.ReactNode;
  className?: string;
}

/**
 * Card header for the Notices & Litigation module: a flat rule under the title
 * rather than shadcn's CardHeader, whose CardTitle is 24px and far off this
 * module's 14px card-title scale.
 */
export const NoticesCardHeader: React.FC<NoticesCardHeaderProps> = ({
  title,
  description,
  badge,
  className,
}) => (
  <div className={cn('flex items-center justify-between gap-2 border-b px-4 py-3', className)}>
    <div className="min-w-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
    </div>
    {badge != null && (
      typeof badge === 'string' || typeof badge === 'number' ? (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
          {badge}
        </span>
      ) : badge
    )}
  </div>
);

export default NoticesCardHeader;
