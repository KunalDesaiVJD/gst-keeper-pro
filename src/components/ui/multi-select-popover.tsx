import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface MultiSelectPopoverProps {
  options: { value: string; label: string }[];
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

export const MultiSelectPopover: React.FC<MultiSelectPopoverProps> = ({
  options,
  selectedValues,
  onSelectionChange,
  placeholder = 'Select...',
  className = '',
}) => {
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
      <PopoverContent className="w-40 p-2" align="start">
        <div className="max-h-48 overflow-y-auto space-y-1">
          {options.map((option) => (
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
