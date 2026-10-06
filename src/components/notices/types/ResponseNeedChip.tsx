// A notice's reply need on a list row (contract §A): "Critical" red-bordered,
// "Optional" amber, "Info only" neutral; the tooltip says what it means. Small
// enough for a phone card's chip row, so it never widens the page.
import React from 'react';
import { Badge } from '@/components/gstr9/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { responseNeedDef } from '@/lib/noticeTypes';
import { cn } from '@/lib/utils';

export const ResponseNeedChip: React.FC<{ need: string | null | undefined; compact?: boolean; className?: string }> = ({ need, compact, className }) => {
  const def = responseNeedDef(need);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex shrink-0', className)}>
          <Badge variant={def.tone} className={cn('whitespace-nowrap font-medium', compact ? 'px-1.5 py-0 text-[10px]' : 'text-[11px]')}>
            <span className="sr-only">Reply need: </span>{def.chip}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">
        <span className="font-medium">{def.label}</span>: {def.hint}.
      </TooltipContent>
    </Tooltip>
  );
};

export default ResponseNeedChip;
