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
        className={cn(
          // w-auto is load-bearing: SelectTrigger is w-full by default, which
          // made these stretch into full-width stacked bars instead of pills.
          'h-auto w-auto gap-1 rounded-full border-0 px-2 py-0.5 text-[10.5px] font-semibold focus:ring-1',
          active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
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
