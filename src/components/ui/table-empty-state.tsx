import * as React from "react";

import { cn } from "@/lib/utils";

export interface TableEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** When provided, renders as a full-width table row (<tr><td colSpan>). */
  colSpan?: number;
  className?: string;
}

const EmptyStateBody: React.FC<Pick<TableEmptyStateProps, "icon" | "title" | "description">> = ({
  icon,
  title,
  description,
}) => (
  <div className="flex flex-col items-center justify-center gap-2 text-center">
    {icon ? (
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
    ) : null}
    <p className="text-sm font-medium text-foreground">{title}</p>
    {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
  </div>
);

export const TableEmptyState: React.FC<TableEmptyStateProps> = ({
  icon,
  title,
  description,
  colSpan,
  className,
}) => {
  if (typeof colSpan === "number") {
    return (
      <tr>
        <td colSpan={colSpan} className={cn("py-12", className)}>
          <EmptyStateBody icon={icon} title={title} description={description} />
        </td>
      </tr>
    );
  }

  return (
    <div className={cn("py-12", className)}>
      <EmptyStateBody icon={icon} title={title} description={description} />
    </div>
  );
};

TableEmptyState.displayName = "TableEmptyState";
