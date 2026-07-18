import * as React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * Canonical mapping of filing/reconciliation status strings to badge variants.
 * Keys are lower-cased so lookups are case-insensitive.
 */
const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  filed: "success",
  "mismatch in data": "destructive",
  late: "destructive",
  "data pending": "warning",
  "prepared pending": "warning",
  pending: "warning",
  "data received": "info",
  prepared: "info",
  nil: "info",
};

export function getStatusVariant(status: string): BadgeVariant {
  return STATUS_VARIANTS[status?.trim().toLowerCase()] ?? "secondary";
}

export interface StatusBadgeProps {
  status: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => (
  <Badge variant={getStatusVariant(status)} className={cn("text-xs", className)}>
    {status}
  </Badge>
);

StatusBadge.displayName = "StatusBadge";
