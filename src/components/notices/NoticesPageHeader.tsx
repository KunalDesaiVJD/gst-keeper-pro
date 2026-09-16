import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoticesPageHeaderProps {
  title: string;
  /** Lucide icon component — sized and coloured here so every page matches. */
  icon: LucideIcon;
  /** Status line under the title: plain text, or nodes for dots, counts, links. */
  subtitle?: React.ReactNode;
  /** Right-aligned controls. Buttons should be size="sm" className="h-8 text-xs". */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Page header for the Notices & Litigation module, matching the dashboard.
 * The app-wide PageHeader renders a 24px Poppins title in a tinted icon box;
 * this module's design uses a 22px title and a solid primary tile, and reserves
 * Poppins for KPI numerals only.
 */
export const NoticesPageHeader: React.FC<NoticesPageHeaderProps> = ({
  title,
  icon: Icon,
  subtitle,
  actions,
  className,
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
    <div className="min-w-0">
      <h1 className="flex items-center gap-2.5 text-[22px] font-bold">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-primary">
          <Icon className="h-[18px] w-[18px] text-primary-foreground" />
        </span>
        <span className="truncate">{title}</span>
      </h1>
      {subtitle && (
        <div className="mt-1 flex flex-wrap items-center gap-3.5 text-xs text-muted-foreground">
          {subtitle}
        </div>
      )}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export default NoticesPageHeader;
