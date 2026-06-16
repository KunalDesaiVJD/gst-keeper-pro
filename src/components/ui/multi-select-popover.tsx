import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ChevronDown, X, Search } from 'lucide-react';

interface MultiSelectPopoverProps {
  options: { value: string; label: string }[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
  searchable?: boolean;
  showSelectAll?: boolean;
  searchPlaceholder?: string;
}

export const MultiSelectPopover: React.FC<MultiSelectPopoverProps> = ({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = 'Select...',
  className = '',
  contentClassName = 'w-40',
  searchable = false,
  showSelectAll = false,
  searchPlaceholder = 'Search...',
}) => {
  const [query, setQuery] = useState('');

  const visibleOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, searchable, query]);

  const handleToggle = (value: string) => {
    if (selectedValues.includes(value)) {
      onSelectionChange(selectedValues.filter(v => v !== value));
    } else {
      onSelectionChange([...selectedValues, value]);
    }
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectionChange([]);
  };

  // Select All toggles all currently-visible (filtered) options, Excel-style.
  const visibleValues = visibleOptions.map(o => o.value);
  const allVisibleSelected = visibleValues.length > 0 && visibleValues.every(v => selectedValues.includes(v));
  const someVisibleSelected = visibleValues.some(v => selectedValues.includes(v));

  const handleSelectAllVisible = () => {
    if (allVisibleSelected) {
      onSelectionChange(selectedValues.filter(v => !visibleValues.includes(v)));
    } else {
      const merged = new Set([...selectedValues, ...visibleValues]);
      onSelectionChange(Array.from(merged));
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 justify-between text-xs ${className}`}
        >
          <span className="truncate">
            {selectedValues.length > 0
              ? `${selectedValues.length} selected`
              : placeholder}
          </span>
          <div className="flex items-center gap-1 ml-1">
            {selectedValues.length > 0 && (
              <X
                className="h-3 w-3 text-muted-foreground hover:text-foreground"
                onClick={handleClearAll}
              />
            )}
            <ChevronDown className="h-3 w-3" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`${contentClassName} p-2`} align="start">
        {searchable && (
          <div className="relative mb-2">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-7 text-xs"
            />
          </div>
        )}
        {showSelectAll && visibleOptions.length > 0 && (
          <label className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted cursor-pointer border-b mb-1 pb-2">
            <Checkbox
              checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
              onCheckedChange={handleSelectAllVisible}
            />
            <span className="truncate font-medium">(Select All)</span>
          </label>
        )}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {visibleOptions.length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">No matches</div>
          )}
          {visibleOptions.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={selectedValues.includes(option.value)}
                onCheckedChange={() => handleToggle(option.value)}
              />
              <span className="truncate">{option.label}</span>
            </label>
          ))}
        </div>
        {selectedValues.length > 0 && (
          <div className="border-t mt-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => onSelectionChange([])}
            >
              Clear all
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
