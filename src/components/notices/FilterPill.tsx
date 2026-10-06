import React from 'react';
import { Select, SelectTrigger, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface FilterPillProps {
  label: string;
  /** Text shown when nothing is selected — the pill's "all" state. */
  allLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** Synthetic choices that aren't values in the data, e.g. "Unassigned". */
  extraOptions?: { value: string; label: string }[];
  className?: string;
}

/**
 * The module's filter control: a pill that reads as a label until it is set,
 * then takes on the primary tint. Replaces the labelled Selects that each page
 * used to stack above its table.
 */
export const FilterPill: React.FC<FilterPillProps> = ({
  label,
  allLabel,
  value,
  onChange,
  options,
  extraOptions,
  className,
}) => {
  const active = value !== 'all';
  const shown = value === 'all'
    ? allLabel
    : extraOptions?.find((o) => o.value === value)?.label ?? value;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={`${label}: ${shown}`}
        className={cn(
          // w-auto is load-bearing: SelectTrigger is w-full by default, which
          // made these stretch into full-width stacked bars instead of pills.
          'h-8 w-auto gap-1 rounded-full border px-2.5 text-xs font-medium focus:ring-2 focus:ring-ring',
          active ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{label}: {shown}</span>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value="all" className="text-xs">{allLabel}</SelectItem>
        {extraOptions?.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
        ))}
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default FilterPill;
